// The engine's worker lifecycle (spec 2.3), shared by the browser and Node: the worker is spawned
// on first use; each run has a 5 s timeout, after which the worker is terminated and recreated and
// the run retried once (a second timeout is a failure); the worker is recycled when the engine is
// dead (ngspice exited, a WASM trap, a timeout, the worker exiting) and after 2,000 engine runs,
// always between runs, but not after an ordinary circuit failure (ruling, amending spec 2.3). Loading has its own timeout, after which the
// engine is "unavailable", so a caller (sim, gate) always gets an answer. Requests run one at a time.
// A request is a batch of runs in one message (a solve's two corners: one worker round trip); the
// timeout, the retry and recycling apply per message, and every run answered counts as an engine run.

export interface EngineInfo { name: 'ngspice'; version: string; build: string }
export type ToWorker = { type: 'run'; id: number; texts: string[] }
/** One run's answer. `dead`: the engine cannot be used again (ngspice exited or the run trapped), so the worker is recycled. */
export type RunAnswer =
  | { ok: true; vectors: Record<string, number>; warnings?: string[]; ms: number }
  | { ok: false; error: string; dead?: boolean; ms: number }
export type FromWorker =
  | { type: 'ready'; engine: EngineInfo }
  | { type: 'progress'; loaded: number; total: number }
  /** One answer per text, in order, up to and including the first failure (the rest are not run). */
  | { type: 'result'; id: number; runs: RunAnswer[]; heap: number }
  | { type: 'fatal'; error: string }
export interface WorkerLike {
  post(m: ToWorker): void
  onMessage(cb: (m: FromWorker) => void): void
  onExit(cb: () => void): void
  terminate(): void
}
export type TextOutcome = { status: 'ok'; vectors: Record<string, number>; warnings?: string[]; ms: number } | { status: 'failed'; error: string } | { status: 'unavailable'; reason: string }

export const RUN_TIMEOUT_MS = 5000
export const RECYCLE_RUNS = 2000
/** How long the worker may take to load the engine before it counts as unavailable (Node; the browser passes its own, for slow downloads). */
export const LOAD_TIMEOUT_MS = 30_000
/** Debug only: a run text the worker answers by busy-looping, so the tests can prove a hung run is terminated. */
export const DEBUG_HANG_TEXT = '* circuitoon: debug hang'

export interface HostOptions {
  spawn: () => WorkerLike
  /** A number, or a function read before every run (the visual check's failure knob, Task 34). */
  timeoutMs?: number | (() => number)
  loadTimeoutMs?: number
  recycleRuns?: number
  onProgress?: (loaded: number, total: number) => void
}

type Answer = Extract<FromWorker, { type: 'result' }> | 'timeout'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class EngineHost {
  private opts: HostOptions
  private worker: WorkerLike | null = null
  private ready: Promise<EngineInfo> | null = null
  /** While the engine loads: fails the load now (dispose or recycle during a load). */
  private abortLoad: ((why: string) => void) | null = null
  private waiting = new Map<number, (a: Answer) => void>()
  private onWorker = 0
  private seq = 0
  private queue: Promise<unknown> = Promise.resolve()
  info: EngineInfo | null = null
  /** Engine runs that returned an answer, over every worker. */
  runs = 0
  spawned = 0
  /** The WASM heap size the last run reported, in bytes. */
  lastHeap = 0

  constructor(opts: HostOptions) {
    this.opts = opts
  }

  init(): Promise<EngineInfo> {
    if (this.ready) return this.ready
    const ready = new Promise<EngineInfo>((resolve, reject) => {
      let w: WorkerLike
      try {
        w = this.opts.spawn()
      } catch (e) {
        return reject(new Error(message(e)))
      }
      this.spawned++
      this.worker = w
      const limit = this.opts.loadTimeoutMs ?? LOAD_TIMEOUT_MS
      const fail = (why: string) => {
        clearTimeout(timer)
        this.abortLoad = null
        reject(new Error(why))
      }
      const timer = setTimeout(() => fail(`the simulation engine did not load within ${limit / 1000} s`), limit)
      this.abortLoad = fail
      w.onMessage((m) => {
        if (m.type === 'ready') {
          clearTimeout(timer)
          this.abortLoad = null
          resolve((this.info = m.engine))
        } else if (m.type === 'fatal') fail(m.error)
        else if (m.type === 'progress') this.opts.onProgress?.(m.loaded, m.total)
        else if (m.type === 'result') {
          this.lastHeap = m.heap
          this.waiting.get(m.id)?.(m)
          this.waiting.delete(m.id)
        }
      })
      // The worker exited on its own (loading, mid-run or idle): fail what waits on it and start
      // a fresh one on the next request.
      w.onExit(() => {
        if (this.worker !== w) return
        fail('the simulation engine stopped while loading')
        this.recycle()
      })
    })
    this.ready = ready
    // A failed load does not stick: the next request tries again.
    ready.catch(() => {
      if (this.ready === ready) this.recycle()
    })
    return ready
  }

  private timeout(): number {
    const t = this.opts.timeoutMs
    return typeof t === 'function' ? t() : (t ?? RUN_TIMEOUT_MS)
  }

  private once(texts: string[]): Promise<Answer> {
    const id = ++this.seq
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve('timeout')
      }, this.timeout())
      this.waiting.set(id, (a) => {
        clearTimeout(timer)
        resolve(a)
      })
      this.worker!.post({ type: 'run', id, texts })
    })
  }

  private recycle(): void {
    this.abortLoad?.('the simulation engine was stopped while loading')
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.onWorker = 0
    for (const done of this.waiting.values()) done('timeout')
    this.waiting.clear()
  }

  /** One engine run of a SPICE text, queued behind any run in progress. */
  async runText(text: string): Promise<TextOutcome> {
    return (await this.runTexts([text]))[0]
  }

  /**
   * Engine runs of several SPICE texts in one worker message, queued behind any request in
   * progress: one outcome per text, in order, up to and including the first that is not ok.
   */
  runTexts(texts: string[]): Promise<TextOutcome[]> {
    const next = this.queue.then(() => this.attempt(texts))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async attempt(texts: string[]): Promise<TextOutcome[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.init()
      } catch (e) {
        return [{ status: 'unavailable', reason: message(e) }]
      }
      const a = await this.once(texts)
      if (a === 'timeout') {
        this.recycle()
        continue
      }
      this.runs += a.runs.length
      this.onWorker += a.runs.length
      // An ordinary circuit failure leaves the engine usable; only a dead engine is replaced.
      if (a.runs.some((r) => !r.ok && r.dead) || this.onWorker >= (this.opts.recycleRuns ?? RECYCLE_RUNS)) this.recycle()
      return a.runs.map((r): TextOutcome => (!r.ok ? { status: 'failed', error: r.error } : r.warnings ? { status: 'ok', vectors: r.vectors, warnings: r.warnings, ms: r.ms } : { status: 'ok', vectors: r.vectors, ms: r.ms }))
    }
    return [{ status: 'failed', error: `the simulation engine did not answer within ${this.timeout() / 1000} s, twice` }]
  }

  dispose(): void {
    this.recycle()
  }
}
