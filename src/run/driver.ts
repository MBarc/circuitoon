// circuitoon run's driver (firmware spec 7, ruling R16): the boards' code in Node workers on a virtual
// clock. Every wait reports where its board is and until when; when every board waits, the driver
// moves the clock to the earliest of those, the next press or release and the end; samples; solves
// when a run pin state, a code sequence, a press or a servo's motion changed; writes the inputs back;
// and grants every board its clock (H.grant: other wakes never move a board). Pin reads and time calls step 10 us and sync at the horizon (the next 16 ms,
// press or end), so busy-waits end and polling loops reach presses. Deterministic: the same sheet and
// options give the same run. A board that sends nothing for `realLimitMs` of real time never pauses.
import type { Diagram } from '../format/diagram.ts'
import { RUNNABLE, languagesOf } from '../format/code.ts'
import type { ModuleDef } from '../format/module.ts'
import { simOf, withLibraryData } from '../format/simModel.ts'
import { type RunPinState, type RunPins, contactPosition, isActive, switchGroups } from '../format/simState.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import type { Engine } from '../sim/engine/engine.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimFinding, SimOutcome } from '../sim/results.ts'
import { solve } from '../sim/session.ts'
import { boardKindOf } from './boards.ts'
import { type CoreBoard, NEVER_PAUSES, RunCore, type RunFinding } from './core.ts'
import { BoardRun, type CodeWorkerLike } from './host.ts'
import { F, H, INPUT, grant, writeLine } from './memory.ts'
import { spawnNodeCodeWorker } from './node/codeWorker.ts'
import { LOST_POWER, NO_POWER, boardPower, underVoltage, underVoltageNote } from './power.ts'
import type { RunStatus, SandboxProbe } from './protocol.ts'

export interface Press { uid: string; atMs: number; forMs: number }
export interface DriveOptions {
  diagram: Diagram
  boards: string[]
  forMs: number
  inputs: string[]
  presses: Press[]
  engine: Engine
  py: { indexURL: string; lock: string }
  spawn?: () => CodeWorkerLike
  /** Real time a board may run without yielding (spec 7: 5 s). */
  realLimitMs?: number
  /** The built-in parts (libraryLookup) and our Python files (PY_FILES), passed in so this file loads in plain Node (the run's child process). */
  library: ModuleLookup
  files: Record<string, string>
}
export interface SerialEntry { t: number; stream: 'out' | 'err' | 'note'; text: string }
export interface DriveBoard { uid: string; ref: string; status: RunStatus | 'not-started'; serial: SerialEntry[]; probe?: SandboxProbe }
export interface DriveResult {
  boards: DriveBoard[]
  timeline: { t: number; uid: string; pin: string; state: string }[]
  findings: (SimFinding | RunFinding)[]
  simulatedMs: number
  /** Every solve, in order (tests integrate readings over time; the CLI does not print them). */
  solves: { t: number; outcome: SimOutcome }[]
  neverPauses: string[]
  lostPower: string[]
  incomplete: { uid: string; why: string }[]
}

export const stateText = (s: RunPinState): string => (typeof s === 'string' ? s : `pwm ${Number((s.pwm * 100).toFixed(1))}%`)

interface Live { b: DriveBoard; run: BoardRun; module: ModuleDef; blocked: { nowMs: number; untilMs: number } | null; t: number; heard: number; ended: boolean; noted: boolean }

/** A latching switch flipped (ruling R17: a press on a latching switch flips it at its time). */
function flipped(d: Diagram, uid: string): Diagram {
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const m = d.modules[p.module]
      const g = switchGroups(m).find((x) => x.kind === 'switch' && !x.momentary)
      if (!g) return p
      const on = isActive(contactPosition(p, m, g))
      return { ...p, values: { ...p.values, [`contact.${g.id}`]: g.changeover ? (on ? 'nc' : 'no') : on ? 'open' : 'closed' } }
    }),
  }
}

export async function drive(o: DriveOptions): Promise<DriveResult> {
  const library = o.library
  const realLimit = o.realLimitMs ?? 5000
  const res: DriveResult = { boards: [], timeline: [], findings: [], simulatedMs: 0, solves: [], neverPauses: [], lostPower: [], incomplete: [] }
  let sheet = o.diagram
  let held: { part: string; group: string } | null = null
  // Presses become events: a button is held from its time for its length; a latching switch flips.
  const events: { atMs: number; apply: () => void }[] = []
  for (const p of o.presses) {
    const part = sheet.parts.find((x) => x.uid === p.uid)!
    const group = switchGroups(sheet.modules[part.module]).find((g) => g.momentary)
    if (group) events.push({ atMs: p.atMs, apply: () => (held = { part: p.uid, group: group.id }) }, { atMs: p.atMs + p.forMs, apply: () => (held = null) })
    else events.push({ atMs: p.atMs, apply: () => (sheet = flipped(sheet, p.uid)) })
  }
  events.sort((a, b) => a.atMs - b.atMs)

  const seen = new Set<string>()
  const addFindings = (list: (SimFinding | RunFinding)[]) => {
    for (const f of list) {
      const key = `${f.code}|${f.message}`
      if (!seen.has(key)) (seen.add(key), res.findings.push(f))
    }
  }
  let revision = 0
  let last = null as { outcome: SimOutcome; circuit: Circuit } | null
  let pins: RunPins = {}
  let seq: Record<string, number> = {}
  let moving: string[] = []
  const findingsOf = (x: SimOutcome) => (x.status === 'ok' ? x.result.findings : x.status === 'failed' ? [x.finding, ...x.findings] : x.findings)
  const solveAt = async (t: number, keep = true) => {
    last = await solve(sheet, o.engine, ++revision, { library, held, runPins: pins, moving, runSeq: seq })
    res.solves.push({ t, outcome: last.outcome })
    if (keep) addFindings(findingsOf(last.outcome))
    return last
  }

  // A message from a board re-runs the settle check (set while settling).
  let notify = () => {}
  // Which boards can start (spec 7 exit 3): code, a language they run, sim data, and power.
  // In the saved state, before the code sets its pins: its findings count only if no board starts
  // (a started board's first solve, due at once, reports what persists).
  const first = await solveAt(0, false)
  const live: Live[] = []
  const core = new RunCore()
  for (const uid of o.boards) {
    const part = sheet.parts.find((p) => p.uid === uid)
    const b: DriveBoard = { uid, ref: part?.designator ?? uid, status: 'not-started', serial: [] }
    res.boards.push(b)
    const stored = part && sheet.modules[part.module]
    const m = stored && withLibraryData(stored, library)
    const kind = boardKindOf(m)
    const why = !part || !m || !kind ? `${b.ref} is not a board that runs code`
      : !part.code ? `${b.ref} has no code`
      : !RUNNABLE.includes(part.code.language) || !languagesOf(m).includes(part.code.language) ? `${b.ref} cannot run its code (${part.code.language})`
      : !simOf(m)?.power ? `${b.ref} has no simulation data`
      : first.outcome.status !== 'ok' || !boardPower(first.circuit, first.outcome.result, uid).powered ? NO_POWER(b.ref)
      : null
    if (why) {
      res.incomplete.push({ uid, why })
      continue
    }
    const entry: Live = { b, module: m!, blocked: null, t: 0, heard: performance.now(), ended: false, noted: false, run: null as unknown as BoardRun }
    entry.run = new BoardRun({
      board: kind!, source: part!.code!.source, file: part!.code!.file ?? 'main.py', mode: 'virtual', py: o.py, files: o.files, spawn: o.spawn ?? spawnNodeCodeWorker,
      on: (msg) => {
        if (msg.type === 'block') (entry.blocked = { nowMs: msg.nowMs, untilMs: msg.untilMs }), (entry.t = msg.nowMs), (entry.heard = performance.now())
        else if (msg.type === 'ready') entry.heard = performance.now()
        else if (msg.type === 'probe') b.probe = msg.probe
        else if (msg.type === 'out') b.serial.push({ t: entry.t, stream: msg.stream, text: msg.text })
        else if (msg.type === 'exit' || msg.type === 'fatal') {
          if (msg.type === 'fatal') b.serial.push({ t: entry.t, stream: 'err', text: `${msg.error}\n` })
          entry.ended = true
        }
        notify()
      },
    })
    live.push(entry)
    core.add({ uid, ref: b.ref, memory: entry.run.memory, module: m! })
    // Its first horizon, before any grant: time calls and pin reads sync there (the first 16 ms sample, a press or the end).
    entry.run.memory.f64[F.horizonMs] = Math.min(16, events[0]?.atMs ?? Infinity, o.forMs)
    entry.run.start()
  }
  if (!live.length) addFindings(findingsOf(first.outcome))

  /** Resolves when every live board waits or has ended; stops a board that never pauses. */
  const settle = () => new Promise<void>((resolve) => {
    const check = () => {
      const now = performance.now()
      for (const e of live)
        if (!e.ended && !e.blocked && e.run.status !== 'starting' && now - e.heard > realLimit) {
          e.ended = true
          e.b.serial.push({ t: e.t, stream: 'note', text: `${NEVER_PAUSES(e.b.ref)}\n` })
          res.neverPauses.push(e.b.uid)
          void e.run.stop()
        }
      if (live.every((e) => e.ended || e.blocked)) {
        clearInterval(timer)
        notify = () => {}
        resolve()
      }
    }
    const timer = setInterval(check, 100)
    notify = check
    check()
  })

  let T = 0
  const at = (b: CoreBoard) => Math.max(T, live.find((e) => e.b.uid === b.uid)?.t ?? 0)
  // A solve is due: the first step, and after a press or release.
  let pending = true
  let idle = 0
  const shown = new Map<string, string>()
  for (;;) {
    await settle()
    for (const e of live) if (e.ended && core.boards.some((b) => b.uid === e.b.uid)) core.remove(e.b.uid)
    const running = live.filter((e) => !e.ended)
    if (!running.length) break
    // Boards step 10 us per call, so the present is at least where the slowest of them is.
    T = Math.max(T, Math.min(...running.map((e) => e.blocked!.nowMs)))
    // The present: sample where the boards are, and solve when anything changed.
    const s = core.sample(at)
    addFindings(s.findings)
    pins = s.pins
    seq = s.seq
    for (const [uid, byPin] of Object.entries(pins))
      for (const [pin, st] of Object.entries(byPin)) {
        const text = stateText(st)
        if (shown.get(`${uid}|${pin}`) !== text) {
          res.timeline.push({ t: T, uid, pin, state: text })
          shown.set(`${uid}|${pin}`, text)
        }
      }
    const sv = core.servos(sheet, last?.circuit ?? null, T, library)
    addFindings(sv.findings)
    const moved = JSON.stringify(sv.moving) !== JSON.stringify(moving)
    moving = sv.moving
    let woke = false
    if (s.changed || pending || moved) {
      pending = false
      woke = true
      const r = await solveAt(T)
      const a = core.apply(r.outcome, r.circuit, seq, at)
      addFindings(a.findings)
      for (const e of running) {
        const p = a.power[e.b.uid]
        if (!p || e.ended) continue
        if (!p.powered) {
          e.b.serial.push({ t: T, stream: 'note', text: `${LOST_POWER(e.b.ref)}\n` })
          res.lostPower.push(e.b.uid)
          e.ended = true
          await e.run.stop()
        } else if (underVoltage(p) && !e.noted) {
          e.noted = true
          e.b.serial.push({ t: T, stream: 'note', text: `${underVoltageNote(e.b.ref, p.inputVolts!)}\n` })
        }
      }
    }
    for (const e of running)
      if (!e.ended && Atomics.load(e.run.memory.i32, H.inputState) === INPUT.waiting && o.inputs.length) {
        writeLine(e.run.memory, o.inputs.shift()!)
        woke = true
      }
    if (T >= o.forMs) {
      await Promise.all(running.filter((e) => !e.ended).map((e) => e.run.stop()))
      break
    }
    if (!woke) {
      // Nothing new now: move the clock to the next thing that happens.
      T = Math.max(T, Math.min(...running.filter((e) => !e.ended).map((e) => e.blocked!.untilMs), events[0]?.atMs ?? Infinity, o.forMs))
      while (events.length && events[0].atMs <= T) {
        events.shift()!.apply()
        pending = true
      }
      // A press or the end is solved at its time before any board moves on.
      if (pending || T >= o.forMs) continue
    }
    if (++idle > 100_000) throw new Error(`the run made no progress at ${T} ms`)
    if (!woke) idle = 0
    const horizon = Math.min(T + 16, events[0]?.atMs ?? Infinity, o.forMs)
    for (const e of running) {
      if (e.ended) continue
      e.blocked = null
      // Its clock jumps to at least T, so what it prints next is stamped from there.
      e.t = Math.max(e.t, T)
      e.heard = performance.now()
      // The grant last: the inputs and lines written above only woke it; this lets it move (ruling R16).
      grant(e.run.memory, T, horizon)
    }
  }
  await Promise.all(live.map((e) => e.run.done))
  for (const e of live) e.b.status = res.neverPauses.includes(e.b.uid) ? 'error' : e.run.status
  // A board stepping 10 us at a time can sync a hair past the end.
  res.simulatedMs = Math.min(T, o.forMs)
  return res
}
