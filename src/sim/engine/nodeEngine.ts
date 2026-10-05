// The engine in Node (spec 2, ruling R22): a worker_threads Worker that runs this same file. In the
// CLI bundle that file is plugin/dist-cli/circuitoon.mjs, with ngspice.mjs and ngspice.wasm beside
// it; from the source tree (vitest) it is this .ts file, and the engine is in public/sim/.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { EngineHost, type FromWorker, type HostOptions, type ToWorker } from './host.ts'
import { createCore, loadEngineFiles } from './ngspice.ts'
import { serve } from './workerLoop.ts'

const WASM = 'ngspice.wasm'

/** The directory with the engine: beside this file (the bundle), else public/sim from the source tree. */
export function engineDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const dir of [here, join(here, '..', '..', '..', 'public', 'sim')]) if (existsSync(join(dir, WASM))) return dir
  return null
}

export function createNodeEngineHost(opts: Omit<HostOptions, 'spawn'> = {}): EngineHost {
  return new EngineHost({
    ...opts,
    spawn: () => {
      const dir = engineDir()
      if (!dir) throw new Error(`the simulation engine (${WASM}) is not installed beside the circuitoon CLI`)
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { circuitoonSim: dir } })
      return {
        post: (m: ToWorker) => w.postMessage(m),
        onMessage: (cb) => void w.on('message', (m: FromWorker) => cb(m)),
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
