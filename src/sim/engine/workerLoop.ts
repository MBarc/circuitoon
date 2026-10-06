// The worker side of the engine (both workers): load the core once, then answer each run in order.
// A run is synchronous inside the worker; the host (host.ts) terminates the worker on a timeout.
// Anything thrown (a WASM abort, ngspice's exit) is answered as a failed run, never left unanswered.
import type { NgspiceCore } from './ngspice.ts'
import { DEBUG_HANG_TEXT, type EngineInfo, type FromWorker, type RunAnswer, type ToWorker } from './host.ts'

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function serve(
  post: (m: FromWorker) => void,
  listen: (cb: (m: ToWorker) => void) => void,
  load: (progress: (loaded: number, total: number) => void) => Promise<{ core: NgspiceCore; info: EngineInfo }>,
): void {
  const loading = load((loaded, total) => post({ type: 'progress', loaded, total }))
  loading.then(
    ({ info }) => post({ type: 'ready', engine: info }),
    (e) => post({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }),
  )
  listen((m) => {
    try {
      if (m.type !== 'run') return
      void loading.then(({ core }) => {
        // The texts in order, stopping at the first failure: one answer per run made.
        const runs: RunAnswer[] = []
        let heap = 0
        for (const text of m.texts) {
          const t0 = performance.now()
          try {
            // Debug only: hang here so the tests can prove the host terminates a stuck worker.
            if (text === DEBUG_HANG_TEXT) for (;;) performance.now()
            const r = core.op(text)
            const ms = performance.now() - t0
            heap = core.heapBytes()
            runs.push(r.ok ? { ok: true, vectors: r.vectors, ...(r.warnings && { warnings: r.warnings }), ms } : { ok: false, error: r.error, dead: core.dead, ms })
          } catch (e) {
            heap = 0
            runs.push({ ok: false, error: `the simulation engine stopped: ${why(e)}`, dead: true, ms: performance.now() - t0 })
          }
          if (!runs[runs.length - 1].ok) break
        }
        post({ type: 'result', id: m.id, runs, heap })
      }, () => undefined)
    } catch (e) {
      post({ type: 'fatal', error: why(e) })
    }
  })
}
