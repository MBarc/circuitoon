// The code worker in the browser (firmware spec 2.6): a module worker whose script response carries
// the CSP (vite.config.ts in dev and preview, the service worker on the built site: its name must
// keep matching /codeWorker[^/]*\.(js|ts)/), so it loads only our own scripts and files. Pyodide
// comes from the versioned directory the page prefetched (prefetch.ts).
import { PY_JSGLOBALS } from '../limits.ts'
import type { FromCode, ToCode } from '../protocol.ts'
import { type PyodideLike, serveCode } from '../worker/serve.ts'

const scope = self as unknown as Record<string, unknown> & { postMessage(m: FromCode): void; addEventListener(t: 'message', f: (e: MessageEvent<ToCode>) => void): void }

serveCode(
  (m) => scope.postMessage(m),
  (cb) => scope.addEventListener('message', (e) => cb(e.data)),
  async (indexURL, lock) => {
    const { loadPyodide } = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide: (o: object) => Promise<PyodideLike> }
    return loadPyodide({ indexURL, lockFileContents: lock, jsglobals: Object.fromEntries(PY_JSGLOBALS.map((n) => [n, scope[n]])) })
  },
)
