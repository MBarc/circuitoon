// The engine in Node (spec 2, ruling R22): a worker_threads Worker that runs this same file. In the
// CLI bundle that file is plugin/dist-cli/circuitoon.mjs, with ngspice.mjs and ngspice.wasm beside
// it; from the source tree (vitest) it is this .ts file, and the engine is in public/sim/.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { EngineHost, type FromWorker, type HostOptions, type ToWorker } from './host.ts'
import { createCore, type EngineManifest, type NgFactory } from './ngspice.ts'
import { serve } from './workerLoop.ts'

const WASM = 'ngspice.wasm'

/** The directory with the engine: beside this file (the bundle), else public/sim from the source tree. */
export function engineDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const dir of [here, join(here, '..', '..', '..', 'public', 'sim')]) if (existsSync(join(dir, WASM))) return dir
  return null
}

/** The factory, wasm bytes and manifest from an engine directory (public/sim or plugin/dist-cli). */
export async function loadEngineFiles(dir: string): Promise<{ factory: NgFactory; wasm: Uint8Array; manifest: EngineManifest }> {
  const manifest = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8')) as EngineManifest
  // A variable specifier: bundlers leave it alone, so the glue is loaded from disk at run time.
  const glue = pathToFileURL(join(dir, 'ngspice.mjs')).href
  const mod = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
  return { factory: mod.default, wasm: new Uint8Array(readFileSync(join(dir, 'ngspice.wasm'))), manifest }
}

export function createNodeEngineHost(opts: Omit<HostOptions, 'spawn'> = {}): EngineHost {
  return new EngineHost({
    ...opts,
    spawn: () => {
      const dir = engineDir()
      if (!dir) throw new Error(`the simulation engine (${WASM}) is not installed beside the circuitoon CLI`)
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { circuitoonSim: dir } })
      // A CLI that forgets dispose() still exits: the host's load and run timers keep the process
      // alive while it waits on the worker, and nothing else does. unref() goes after on('message'),
      // which would ref the worker's port again.
      return {
        post: (m: ToWorker) => w.postMessage(m),
        onMessage: (cb) => void w.on('message', (m: FromWorker) => cb(m)).unref(),
        onExit: (cb) => void w.on('exit', cb),
        terminate: () => void w.terminate(),
      }
    },
  })
}

// The worker side: only when this file was started as the engine worker.
const data = workerData as { circuitoonSim?: string } | null
if (!isMainThread && data?.circuitoonSim) {
  const dir = data.circuitoonSim
  serve(
    (m) => parentPort!.postMessage(m),
    (cb) => void parentPort!.on('message', cb),
    async () => {
      const { factory, wasm, manifest } = await loadEngineFiles(dir)
      return { core: await createCore(factory, wasm), info: { name: 'ngspice', version: manifest.ngspice, build: manifest.build } }
    },
  )
}
