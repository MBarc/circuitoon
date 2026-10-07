// The editor's run controller (firmware spec 2.1, 2.3, 4.5, 5.2 to 5.4), loaded with import() on the
// first Run. One per editor store. Run turns Simulate on, shows "starting" while Python downloads and
// the first solve lands, refuses an unpowered board, then starts the code in its own worker. The
// sampler runs every 16 ms by setTimeout, or after a solve completes if one is in flight, whichever
// comes later; results are written back to every board; Serial is batched per sample. Stop removes
// the board's run pin states, so the saved states apply again; deleting the board, changing its
// module or turning Simulate off stops it; editing its code does not.
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { boardKindOf } from '../run/boards.ts'
import { prefetchPy } from '../run/browser/prefetch.ts'
import { type CoreBoard, NEVER_PAUSES, RunCore, type RunFinding } from '../run/core.ts'
import { BoardRun, type CodeWorkerLike } from '../run/host.ts'
import { F, H, writeLine } from '../run/memory.ts'
import { LOST_POWER, NO_POWER, boardPower, underVoltage, underVoltageNote } from '../run/power.ts'
import type { FromCode } from '../run/protocol.ts'
import { PY_FILES } from '../run/pyFiles.ts'
import { runBlocker } from './running.ts'
import type { EditorStore, RunView, SerialLine, SimView } from './store.ts'

export const browserSpawn = (): CodeWorkerLike => {
  const w = new Worker(new URL('../run/browser/codeWorker.ts', import.meta.url), { type: 'module' })
  return {
    post: (m) => w.postMessage(m),
    onMessage: (cb) => w.addEventListener('message', (e: MessageEvent<FromCode>) => cb(e.data)),
    onError: (cb) => w.addEventListener('error', (e) => cb(e.message || 'the code worker failed')),
    terminate: () => w.terminate(),
  }
}
interface Deps { spawn?: () => CodeWorkerLike; prefetch?: typeof prefetchPy; isolated?: () => boolean }
const nowAbs = () => performance.timeOrigin + performance.now()
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const SAMPLE_MS = 16
const NEVER_PAUSES_MS = 2000

export class RunController {
  private store: EditorStore
  private deps: Deps
  private runs = new Map<string, { run: BoardRun; module: string; ref: string; noted: Set<string> }>()
  private core = new RunCore()
  private batch = new Map<string, SerialLine[]>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSample = 0
  private inFlight = false
  private seenSim: SimView | null = null
  private seenParts: unknown = null
  private unsubscribe: () => void

  constructor(store: EditorStore, deps: Deps = {}) {
    this.store = store
    this.deps = deps
    this.unsubscribe = store.subscribe(() => this.follow())
  }

  private ref(uid: string): string {
    return this.store.getState().diagram.parts.find((p) => p.uid === uid)?.designator ?? uid
  }

  /** The next finished solve (or the current one, when Simulate already has a result and none is pending). */
  private nextSolve(): Promise<Extract<SimView, { phase: 'done' }> | null> {
    const { sim: s, simulate } = this.store.getState()
    if (!simulate) return Promise.resolve(null)
    if (s?.phase === 'done' && !this.inFlight) return Promise.resolve(s)
    return new Promise((resolve) => {
      const off = this.store.subscribe(() => {
        const st = this.store.getState()
        if (!st.simulate) return off(), resolve(null)
        if (st.sim?.phase === 'done') off(), resolve(st.sim)
      })
    })
  }

  async run(uid: string): Promise<void> {
    const s = this.store.getState()
    const env = this.deps.isolated ? { isolated: this.deps.isolated(), serviceWorkers: true } : undefined
    const blocked = runBlocker(s, uid, env)
    const part = s.diagram.parts.find((p) => p.uid === uid)
    if (blocked || !part?.code || this.runs.has(uid) || s.run.boards[uid]?.status === 'starting') {
      if (blocked) this.store.setBoardRun(uid, { status: 'idle', message: blocked })
      return
    }
    const code = part.code
    const m = withLibraryData(s.diagram.modules[part.module], libraryLookup)
    this.store.setSimulate(true)
    this.store.setBoardRun(uid, { status: 'starting', source: code.source, file: code.file ?? 'main.py', serial: [], prompt: null, progress: null, message: null })
    this.store.setDock({ open: true, tab: uid })
    let py: { indexURL: string; lock: string }
    try {
      py = await (this.deps.prefetch ?? prefetchPy)((loaded, total) => this.store.setBoardRun(uid, { progress: { loaded, total } }))
    } catch (e) {
      this.store.setBoardRun(uid, { status: 'error', progress: null, message: `Python could not load: ${why(e)}` })
      return
    }
    // The first solve (spec 2.1, 4.5): refuse a board it shows unpowered.
    const first = await this.nextSolve()
    if (this.store.getState().run.boards[uid]?.status !== 'starting') return
    // Simulate was turned off while starting: that is a Stop.
    if (!first) return void this.store.setBoardRun(uid, { status: 'stopped', progress: null })
    const ok = first?.outcome.status === 'ok' && first.circuit && boardPower(first.circuit, first.outcome.result, uid).powered
    if (!ok) {
      this.store.setBoardRun(uid, { status: 'idle', progress: null, message: NO_POWER(part.designator) })
      return
    }
    this.store.setBoardRun(uid, { progress: null })
    const run = new BoardRun({
      board: boardKindOf(m)!, source: code.source, file: code.file ?? 'main.py', mode: 'real', py, files: PY_FILES,
      spawn: this.deps.spawn ?? browserSpawn,
      on: (msg) => this.onMessage(uid, msg),
    })
    this.runs.set(uid, { run, module: part.module, ref: part.designator, noted: new Set() })
    this.core.add({ uid, ref: part.designator, memory: run.memory, module: m })
    run.start()
    this.schedule()
  }

  private onMessage(uid: string, msg: FromCode): void {
    if (msg.type === 'ready') this.store.setBoardRun(uid, { status: 'running' })
    else if (msg.type === 'out') this.serial(uid, msg.text, msg.stream)
    else if (msg.type === 'prompt') this.store.setBoardRun(uid, { prompt: msg.text })
    else if (msg.type === 'exit') this.finish(uid, msg.status)
    else if (msg.type === 'fatal') {
      this.serial(uid, `${msg.error}\n`, 'err')
      this.finish(uid, 'error')
    }
  }

  private serial(uid: string, text: string, stream: SerialLine['stream']): void {
    const lines = text.replace(/\n$/, '').split('\n').map((t) => ({ text: t, stream }))
    this.batch.set(uid, [...(this.batch.get(uid) ?? []), ...lines])
  }

  private flush(): void {
    for (const [uid, lines] of this.batch) this.store.appendSerial(uid, lines)
    this.batch.clear()
  }

  /** A board ended (spec 5.4): its run pin states go, so the saved states apply again. */
  private finish(uid: string, status: 'done' | 'stopped' | 'error'): void {
    if (!this.runs.has(uid)) return
    this.runs.delete(uid)
    this.core.remove(uid)
    this.flush()
    const run = this.store.getState().run
    const { [uid]: _gone, ...pins } = run.pins
    const { [uid]: _s, ...seq } = run.seq
    if (uid in run.pins || uid in run.seq) this.store.setRun({ pins, seq })
    // After Open or New the sheet has no view of this board: none is made for it.
    if (run.boards[uid]) this.store.setBoardRun(uid, { status, prompt: null })
  }

  private stopping = new Set<string>()
  async stop(uid: string): Promise<void> {
    const r = this.runs.get(uid)
    if (!r) {
      if (this.store.getState().run.boards[uid]?.status === 'starting') this.store.setBoardRun(uid, { status: 'stopped', progress: null })
      return
    }
    // Store changes arrive while a board stops; one Stop per board at a time.
    if (this.stopping.has(uid)) return
    this.stopping.add(uid)
    try {
      const how = await r.run.stop()
      if (how !== 'stopped') this.finish(uid, 'stopped')
    } finally {
      this.stopping.delete(uid)
    }
  }

  /** Reset (spec 5.4): Stop, then Run in a fresh worker with the files already fetched. */
  async reset(uid: string): Promise<void> {
    await this.stop(uid)
    await this.run(uid)
  }

  sendLine(uid: string, line: string): void {
    const r = this.runs.get(uid)
    const prompt = this.store.getState().run.boards[uid]?.prompt
    if (!r || prompt === null || prompt === undefined) return
    // Output batched before the prompt comes before its echo.
    this.flush()
    this.store.appendSerial(uid, [{ text: `${prompt}${line}`, stream: 'echo' }])
    this.store.setBoardRun(uid, { prompt: null })
    writeLine(r.run.memory, line)
  }

  async runAll(): Promise<void> {
    for (const p of this.store.getState().diagram.parts) if (p.code && !this.runs.has(p.uid)) await this.run(p.uid)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((uid) => this.stop(uid)))
  }

  private at = (b: CoreBoard) => nowAbs() - b.memory.f64[F.startMs]

  private schedule(): void {
    if (this.timer || !this.runs.size) return
    const wait = Math.max(0, SAMPLE_MS - (performance.now() - this.lastSample))
    this.timer = setTimeout(() => {
      this.timer = null
      this.sample()
    }, wait)
  }

  /** One sample (spec 2.3), unless a solve is in flight: then the solve's arrival samples. */
  private sample(): void {
    if (!this.runs.size) return
    if (this.inFlight) return
    this.lastSample = performance.now()
    const st = this.store.getState()
    // Servos first: their moving flags are part of the sample's change test.
    const sv = this.core.servos(st.diagram, st.sim?.phase === 'done' ? st.sim.circuit : null, performance.now(), libraryLookup)
    const s = this.core.sample(this.at)
    this.addFindings([...s.findings, ...sv.findings])
    // Never pauses (spec 5.2): 2 s with no yield while a timer or callback waits.
    for (const [uid, r] of this.runs) {
      const m = r.run.memory
      if (Atomics.load(m.i32, H.pending) && nowAbs() - m.f64[F.lastYieldMs] > NEVER_PAUSES_MS && !r.noted.has('pauses')) {
        r.noted.add('pauses')
        this.serial(uid, NEVER_PAUSES(r.ref), 'note')
      }
    }
    this.flush()
    // Only the keys that changed: followStore compares pins, moving and seq by identity, and a solve is
    // waited for only when one of them changed (so a solve was requested).
    const patch: Partial<RunView> = {}
    if (s.changed && JSON.stringify(s.pins) !== JSON.stringify(st.run.pins)) patch.pins = s.pins
    if (JSON.stringify(s.seq) !== JSON.stringify(st.run.seq)) patch.seq = s.seq
    if (JSON.stringify(sv.moving) !== JSON.stringify(st.run.moving)) patch.moving = sv.moving
    this.inFlight = Object.keys(patch).length > 0
    if (JSON.stringify(sv.views) !== JSON.stringify(st.run.servos)) patch.servos = sv.views
    if (Object.keys(patch).length) this.store.setRun(patch)
    this.schedule()
  }

  private addFindings(list: RunFinding[]): void {
    if (!list.length) return
    const have = new Set(this.store.getState().run.findings.map((f) => f.key))
    const add = list.filter((f) => !have.has(f.key))
    if (add.length) this.store.setRun({ findings: [...this.store.getState().run.findings, ...add] })
  }

  /** Store changes: a new solve, a deleted or changed board, Simulate turned off. */
  private follow(): void {
    const st = this.store.getState()
    if (!st.simulate && this.runs.size) return void this.stopAll()
    if (st.diagram.parts !== this.seenParts) {
      this.seenParts = st.diagram.parts
      for (const [uid, r] of this.runs) {
        const p = st.diagram.parts.find((x) => x.uid === uid)
        if (!p || p.module !== r.module) void this.stop(uid)
      }
    }
    // store.load (Open, New) resets `run` to EMPTY_RUN: a running board with no view left means the sheet was replaced, even if the new sheet has a part with the same uid.
    for (const uid of this.runs.keys()) if (!st.run.boards[uid]) void this.stop(uid)
    if (st.sim !== this.seenSim && st.sim?.phase === 'done') {
      this.seenSim = st.sim
      this.inFlight = false
      const a = this.core.apply(st.sim.outcome, st.sim.circuit, st.sim.runSeq ?? {}, this.at)
      this.addFindings(a.findings)
      for (const [uid, r] of this.runs) {
        const p = a.power[uid]
        if (!p) continue
        if (!p.powered) {
          // Solves keep landing while it stops: say it once.
          if (!r.noted.has('power')) {
            r.noted.add('power')
            this.serial(uid, LOST_POWER(r.ref), 'note')
            this.flush()
          }
          void this.stop(uid)
        } else if (underVoltage(p) && !r.noted.has('volts')) {
          r.noted.add('volts')
          this.serial(uid, underVoltageNote(r.ref, p.inputVolts!), 'note')
        }
      }
      if (performance.now() - this.lastSample >= SAMPLE_MS) this.sample()
      else this.schedule()
    }
  }

  dispose(): void {
    void this.stopAll()
    this.unsubscribe()
    if (this.timer) clearTimeout(this.timer)
    if (controllers.get(this.store) === this) controllers.delete(this.store)
  }
}

const controllers = new WeakMap<EditorStore, RunController>()
export function controllerFor(store: EditorStore, deps?: Deps): RunController {
  let c = controllers.get(store)
  if (!c) controllers.set(store, (c = new RunController(store, deps)))
  return c
}
