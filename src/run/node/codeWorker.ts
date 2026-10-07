// The code worker in Node (circuitoon run, the tests): a worker_threads Worker that runs this same
// file, as nodeEngine.ts does (plan ruling R22 of the live simulation): the CLI bundle in the plugin,
// this .ts file under vitest. Pyodide loads from the directory the host names (ensurePy's cache or
// --py-dir).
import { constants, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { CodeWorkerLike } from '../host.ts'
import { PY_JSGLOBALS } from '../limits.ts'
import type { FromCode, SandboxProbe, ToCode } from '../protocol.ts'
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

const can = (f: () => unknown) => {
  try {
    f()
    return true
  } catch {
    return false
  }
}

/** What this thread can do: a confined process (runProcess.ts) denies writes, processes, addons, WASI and code from strings. */
export function probeSandbox(paths: string[]): SandboxProbe {
  const p = process.permission
  return {
    permission: !!p,
    codeFromStrings: can(() => new Function('return 1')),
    read: paths.map((path) => can(() => (statSync(path).isDirectory() ? readdirSync(path) : readFileSync(path)))),
    write: p ? p.has('fs.write') : true,
    childProcess: p ? p.has('child') : true,
    addons: p ? p.has('addon') : true,
    wasi: p ? p.has('wasi') : true,
  }
}

/** Why a process under the permission model is not confined as it should be, or null. */
export function sandboxHole(p: SandboxProbe): string | null {
  if (p.codeFromStrings) return 'it can build code from strings'
  if (p.permission && (p.write || p.childProcess || p.addons || p.wasi)) return 'it can write files, start processes, or load addons or WASI'
  return null
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
      const py = await mod.loadPyodide({ indexURL, lockFileContents: lock, jsglobals: Object.fromEntries(PY_JSGLOBALS.map((n) => [n, g[n]])) })
      // In the run's confined process, the code thread checks its own confinement before any user
      // code: Node's permission model denies writes, processes, addons and WASI here, and the V8 flag
      // code from strings, but it does not confine reads in worker threads, so reads rely on the
      // in-worker sandbox (serve.ts). The home folder's readability is recorded, not required.
      if (process.permission) {
        const probe = probeSandbox([homedir()])
        parentPort!.postMessage({ type: 'probe', probe } satisfies FromCode)
        const hole = sandboxHole(probe)
        if (hole) throw new Error(`the code's sandbox did not hold (${hole}); not running the code`)
      }
      return py
    },
  )
}
