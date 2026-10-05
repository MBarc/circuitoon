// The worker side of the engine (both workers): load the core once, then answer each run in order.
// A run is synchronous inside the worker; the host (host.ts) terminates the worker on a timeout.
// Anything thrown (a WASM abort, ngspice's exit) is answered as a failed run, never left unanswered.
import type { NgspiceCore } from './ngspice.ts'
import { DEBUG_HANG_TEXT, type EngineInfo, type FromWorker, type ToWorker } from './host.ts'

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
        const t0 = performance.now()
        try {
          // Debug only: hang here so the tests can prove the host terminates a stuck worker.
          if (m.text === DEBUG_HANG_TEXT) for (;;) performance.now()
          const r = core.op(m.text)
          const ms = performance.now() - t0
          post(r.ok
            ? { type: 'result', id: m.id, ok: true, vectors: r.vectors, ms, heap: core.heapBytes() }
            : { type: 'result', id: m.id, ok: false, error: r.error, ms, heap: core.heapBytes() })
        } catch (e) {
          post({ type: 'result', id: m.id, ok: false, error: `the simulation engine stopped: ${why(e)}`, ms: performance.now() - t0, heap: 0 })
        }
      }, () => undefined)
    } catch (e) {
      post({ type: 'fatal', error: why(e) })
    }
  })
}
