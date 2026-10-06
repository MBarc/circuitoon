// RunCore (firmware spec 2.3, 3.4, 4.4, 4.5): what sits between running boards and the simulation,
// shared by the editor (real time) and the CLI's driver (virtual time). It samples every board into
// run pin states, writes each solve back into every board's input table (thresholded levels, edge
// counters, voltages, "solved through" the sequence the request was sampled at), keeps the servos'
// angles, and raises the run-time findings, each once per run. `at(board)` is that board's run time.
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { nodeKey } from '../format/netlist.ts'
import { simOf, withLibraryData } from '../format/simModel.ts'
import type { RunPinState, RunPins } from '../format/simState.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimOutcome } from '../sim/results.ts'
import { gpioPin } from './boards.ts'
import { LevelTracker, type Thresholds, thresholdsOf } from './levels.ts'
import { type BoardMemory, NPINS, type PinIn, readAllOut, writeIn } from './memory.ts'
import { type BoardPower, boardPower } from './power.ts'
import { BoardSampler, INPUT_STATE, type SampledPin } from './sampler.ts'
import { servoLimitsOf, servoTarget, slewToward } from './servo.ts'

export type RunCode = 'undefined-level' | 'floating-read' | 'servo-signal'
export interface RunFinding { code: RunCode; severity: 'warning'; parts: string[]; pins: { part: string; pin: string }[]; message: string; key: string }
export interface ServoView { angle: number; target: number; moving: boolean }
export interface CoreBoard { uid: string; ref: string; memory: BoardMemory; module: ModuleDef }
/** Spec 5.2's words, shown once when a board has not yielded for 2 s (editor) or 5 s (CLI) while something waits. */
export const NEVER_PAUSES = (ref: string): string => `${ref}'s code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop.`

interface Entry {
  b: CoreBoard
  sampler: BoardSampler
  levels: LevelTracker
  th: Thresholds
  detail: Record<string, SampledPin>
  /** The pin states sampled at each code sequence not yet applied: a solve is read with the modes it was sampled with. */
  sampled: Map<number, Record<string, RunPinState>>
}
interface Servo { angle: number; target: number; t: number }

export class RunCore {
  private entries = new Map<string, Entry>()
  private last = ''
  private servoState = new Map<string, Servo>()
  private warnedServos = new Set<string>()
  private moving: string[] = []

  add(b: CoreBoard): void {
    this.entries.set(b.uid, { b, sampler: new BoardSampler(), levels: new LevelTracker(b.uid), th: thresholdsOf(b.module), detail: {}, sampled: new Map() })
    this.last = ''
  }

  remove(uid: string): void {
    this.entries.delete(uid)
    this.last = ''
  }

  get boards(): CoreBoard[] {
    return [...this.entries.values()].map((e) => e.b)
  }

  /**
   * Samples every board (spec 2.3). `changed` only when a quantised state or a servo's moving flag
   * moved since the last sample, so store.run is written only then; `seq` is each board's code
   * sequence for the solve's "solved through".
   */
  sample(at: (b: CoreBoard) => number): { pins: RunPins; seq: Record<string, number>; changed: boolean; findings: RunFinding[] } {
    const pins: RunPins = {}
    const seq: Record<string, number> = {}
    const findings: RunFinding[] = []
    for (const e of this.entries.values()) {
      const now = at(e.b)
      const s = e.sampler.sample(e.b.memory, now)
      pins[e.b.uid] = s.pins
      seq[e.b.uid] = s.seq
      e.detail = s.detail
      // One code sequence numbers one set of modes, so a later sample at the same sequence replaces it harmlessly.
      e.sampled.set(s.seq, s.pins)
      for (const pin of e.levels.check(now))
        findings.push({
          code: 'undefined-level', severity: 'warning', parts: [e.b.uid], pins: [{ part: e.b.uid, pin }], key: `undefined-level|${e.b.uid}|${pin}`,
          message: `${e.b.ref} ${pin} reads ${e.levels.get(pin)!.volts.toFixed(1)} V, between the low and high thresholds`,
        })
    }
    const key = JSON.stringify([pins, this.moving])
    const changed = key !== this.last
    this.last = key
    return { pins, seq, changed, findings }
  }

  /**
   * A solve back into the boards (spec 4.4): input pins' levels and edges, solved through `seq`; and
   * each board's power (spec 4.5). Only pins whose mode is still the one sampled for this solve are
   * written; a pin set up while it was in flight waits for the next. A failed solve still marks the
   * boards solved through `seq`, so no read waits on it.
   */
  apply(o: SimOutcome, c: Circuit | null, seq: Record<string, number>, at: (b: CoreBoard) => number): { findings: RunFinding[]; power: Record<string, BoardPower> } {
    const findings: RunFinding[] = []
    const power: Record<string, BoardPower> = {}
    const ok = o.status === 'ok' && c !== null
    for (const e of this.entries.values()) {
      const sq = seq[e.b.uid]
      const sampled = sq === undefined ? undefined : e.sampled.get(sq)
      if (sq !== undefined) for (const k of e.sampled.keys()) if (k < sq) e.sampled.delete(k)
      if (!ok) {
        if (sq !== undefined) writeIn(e.b.memory, [], sq)
        continue
      }
      power[e.b.uid] = boardPower(c, o.result, e.b.uid)
      // A board added after this solve was sampled: nothing of it was solved.
      if (sq === undefined || !sampled) continue
      const now = at(e.b)
      const nets = o.result.corners.typical.nets
      const rows: (PinIn | null)[] = Array.from({ length: NPINS }, () => null)
      readAllOut(e.b.memory).rows.forEach((r, bcm) => {
        const pin = gpioPin(bcm)
        const state = INPUT_STATE[r.mode]
        if (state === undefined || sampled[pin] !== state) return
        const net = c.pinNet[nodeKey(e.b.uid, pin)]
        const u = e.levels.update(pin, net === undefined ? undefined : nets[net], e.th, now)
        rows[bcm] = u.row
        if (u.finding === 'floating-read')
          findings.push({
            code: 'floating-read', severity: 'warning', parts: [e.b.uid], pins: [{ part: e.b.uid, pin }], key: `floating-read|${e.b.uid}|${pin}`,
            message: `${e.b.ref} ${pin} is read by the code but nothing drives it: it floats, so each read is random. Turn on a pull-up or pull-down in the code, or wire it to a signal.`,
          })
      })
      writeIn(e.b.memory, rows, sq)
    }
    return { findings, power }
  }

  /** The output on a net that a servo could follow: its declared or bit-banged duty and frequency (ruling R23). */
  private driverOn(c: Circuit, net: string): SampledPin | null {
    for (const e of this.entries.values())
      for (const [pin, s] of Object.entries(e.detail))
        if (s.duty !== null && s.freqHz && c.pinNet[nodeKey(e.b.uid, pin)] === net) return s
    return null
  }

  /**
   * Every servo's angle at `nowMs` (spec 3.4): toward the target its signal commands, at its slew
   * rate. `moving` (the servos still slewing) is part of the run state: the next sample reports a
   * change when it changes, so the moving draw is keyed (spec 2.3).
   */
  servos(d: Diagram, c: Circuit | null, nowMs: number, library?: ModuleLookup): { views: Record<string, ServoView>; moving: string[]; findings: RunFinding[] } {
    const views: Record<string, ServoView> = {}
    const moving: string[] = []
    const findings: RunFinding[] = []
    if (!c) return { views, moving, findings }
    for (const p of d.parts) {
      const stored = d.modules[p.module]
      const m = stored && withLibraryData(stored, library)
      const lim = servoLimitsOf(m)
      if (!lim) continue
      const net = c.pinNet[nodeKey(p.uid, simOf(m)!.servo!.signal)]
      const drive = net === undefined ? null : this.driverOn(c, net)
      const st = this.servoState.get(p.uid)
      let target = st?.target ?? null
      if (drive) {
        const t = servoTarget(drive.duty!, drive.freqHz!, lim)
        if ('angle' in t) target = t.angle
        else if (!this.warnedServos.has(p.uid)) {
          this.warnedServos.add(p.uid)
          findings.push({
            code: 'servo-signal', severity: 'warning', parts: [p.uid], pins: [], key: `servo-signal|${p.uid}`,
            message: `${p.designator}'s signal is ${t.why}, which a servo does not follow (0.4 to 2.6 ms pulses at 40 to 330 Hz): it holds its last angle.`,
          })
        }
      }
      if (target === null) continue
      // Ruling R24: a servo starts where it is first commanded; it slews from there on.
      const angle = st ? slewToward(st.angle, target, nowMs - st.t, lim) : target
      this.servoState.set(p.uid, { angle, target, t: nowMs })
      const view = { angle, target, moving: Math.abs(angle - target) > 1e-6 }
      views[p.uid] = view
      if (view.moving) moving.push(p.uid)
    }
    this.moving = moving
    return { views, moving, findings }
  }
}
