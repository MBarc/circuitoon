// The engine in the browser: a module Web Worker (browserWorker.ts), spawned only when Simulate is
// first turned on, so the engine is never in the main bundle (spec 8).
import { EngineHost, type FromWorker, type HostOptions, type ToWorker } from './host.ts'

export function createBrowserEngineHost(opts: Omit<HostOptions, 'spawn'> = {}): EngineHost {
  return new EngineHost({
    // The first download may be slow: two minutes before the engine counts as unavailable.
    loadTimeoutMs: 120_000,
    ...opts,
    spawn: () => {
      const w = new Worker(new URL('./browserWorker.ts', import.meta.url), { type: 'module' })
      return {
        post: (m: ToWorker) => w.postMessage(m),
        onMessage: (cb) => w.addEventListener('message', (e: MessageEvent<FromWorker>) => cb(e.data)),
        onExit: (cb) => w.addEventListener('error', () => cb()),
        terminate: () => w.terminate(),
      }
    },
  })
}
