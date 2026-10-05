// The engine's worker lifecycle (spec 2.3), shared by the browser and Node: the worker is spawned
// on first use; each run has a 5 s timeout, after which the worker is terminated and recreated and
// the run retried once (a second timeout is a failure); the worker is recycled after any failure
// and after 2,000 engine runs, always between runs. Loading has its own timeout, after which the
// engine is "unavailable", so a caller (sim, gate) always gets an answer. Requests run one at a time.

export interface EngineInfo { name: 'ngspice'; version: string; build: string }
export type ToWorker = { type: 'run'; id: number; text: string }
export type FromWorker =
  | { type: 'ready'; engine: EngineInfo }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: number; ok: true; vectors: Record<string, number>; ms: number; heap: number }
  | { type: 'result'; id: number; ok: false; error: string; ms: number; heap: number }
  | { type: 'fatal'; error: string }
export interface WorkerLike {
  post(m: ToWorker): void
  onMessage(cb: (m: FromWorker) => void): void
  onExit(cb: () => void): void
  terminate(): void
}
export type TextOutcome = { status: 'ok'; vectors: Record<string, number>; ms: number } | { status: 'failed'; error: string } | { status: 'unavailable'; reason: string }

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
      const timer = setTimeout(() => reject(new Error(`the simulation engine did not load within ${limit / 1000} s`)), limit)
      w.onMessage((m) => {
        if (m.type === 'ready') {
          clearTimeout(timer)
          resolve((this.info = m.engine))
        } else if (m.type === 'fatal') {
          clearTimeout(timer)
          reject(new Error(m.error))
        }
        else if (m.type === 'progress') this.opts.onProgress?.(m.loaded, m.total)
        else if (m.type === 'result') {
          this.lastHeap = m.heap
          this.waiting.get(m.id)?.(m)
          this.waiting.delete(m.id)
        }
      })
      w.onExit(() => {
        if (this.worker !== w) return
        clearTimeout(timer)
        reject(new Error('the simulation engine stopped while loading'))
        for (const done of this.waiting.values()) done('timeout')
        this.waiting.clear()
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

  private once(text: string): Promise<Answer> {
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
      this.worker!.post({ type: 'run', id, text })
    })
  }

  private recycle(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.onWorker = 0
    for (const done of this.waiting.values()) done('timeout')
    this.waiting.clear()
  }

  /** One engine run of a SPICE text, queued behind any run in progress. */
  runText(text: string): Promise<TextOutcome> {
    const next = this.queue.then(() => this.attempt(text))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async attempt(text: string): Promise<TextOutcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.init()
      } catch (e) {
        return { status: 'unavailable', reason: message(e) }
      }
      const a = await this.once(text)
      if (a === 'timeout') {
        this.recycle()
        continue
      }
      this.runs++
      this.onWorker++
      if (!a.ok) {
        this.recycle()
        return { status: 'failed', error: a.error }
      }
      if (this.onWorker >= (this.opts.recycleRuns ?? RECYCLE_RUNS)) this.recycle()
      return { status: 'ok', vectors: a.vectors, ms: a.ms }
    }
    return { status: 'failed', error: `the simulation engine did not answer within ${this.timeout() / 1000} s, twice` }
  }

  dispose(): void {
    this.recycle()
  }
}
