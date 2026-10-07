// The code worker in Node (circuitoon run, the tests): a worker_threads Worker that runs this same
// file, as nodeEngine.ts does (plan ruling R22 of the live simulation): the CLI bundle in the plugin,
// this .ts file under vitest. Pyodide loads from the directory the host names (ensurePy's cache or
// --py-dir).
import { constants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { CodeWorkerLike } from '../host.ts'
import { PY_JSGLOBALS } from '../limits.ts'
import type { FromCode, ToCode } from '../protocol.ts'
import { type PyodideLike, serveCode } from '../worker/serve.ts'

export function spawnNodeCodeWorker(): CodeWorkerLike {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { circuitoonCode: true } })
  return {
    post: (m: ToCode) => w.postMessage(m),
    onMessage: (cb) => void w.on('message', (m: FromCode) => cb(m)),
    onError: (cb) => {
      w.on('error', (e) => cb(e instanceof Error ? e.message : String(e)))
      w.on('exit', (code) => code !== 0 && cb(`the code worker exited (${code})`))
    },
    terminate: () => void w.terminate(),
  }
}

const data = workerData as { circuitoonCode?: boolean } | null
if (!isMainThread && data?.circuitoonCode) {
  serveCode(
    (m) => parentPort!.postMessage(m),
    (cb) => void parentPort!.on('message', cb),
    async (indexURL, lock) => {
      // Pyodide's NODEFS setup reads the fs flags through process.binding('constants'), which Node's
      // permission model refuses (the run's confined process, runProcess.ts); fs.constants holds them.
      const proc = process as unknown as { binding: (name: string) => unknown }
      const binding = proc.binding
      proc.binding = (name) => (name === 'constants' ? { fs: constants } : binding.call(process, name))
      const mod = (await import(pathToFileURL(join(indexURL, 'pyodide.mjs')).href)) as { loadPyodide: (o: object) => Promise<PyodideLike> }
      const g = globalThis as unknown as Record<string, unknown>
      return mod.loadPyodide({ indexURL, lockFileContents: lock, jsglobals: Object.fromEntries(PY_JSGLOBALS.map((n) => [n, g[n]])) })
    },
  )
}
