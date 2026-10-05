// The engine's Web Worker (spec 2.2): fetches engine.json, then ngspice.wasm with determinate
// progress (ruling R25: bytes over the manifest's wasmBytes), then imports the separate glue from
// public/sim at run time. Never part of the main bundle.
import { createCore, type EngineManifest, type NgFactory } from './ngspice.ts'
import type { FromWorker, ToWorker } from './host.ts'
import { serve } from './workerLoop.ts'

const scope = self as unknown as { postMessage(m: FromWorker): void; addEventListener(t: 'message', f: (e: MessageEvent<ToWorker>) => void): void }
const BASE = `${import.meta.env.BASE_URL}sim/`

async function fetchBytes(url: string, total: number, progress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`could not load ${url} (HTTP ${res.status})`)
  const chunks: Uint8Array[] = []
  let loaded = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    progress(Math.min(loaded, total), total)
  }
  const out = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

serve(
  (m) => scope.postMessage(m),
  (cb) => scope.addEventListener('message', (e) => cb(e.data)),
  async (progress) => {
    const manifest = (await (await fetch(`${BASE}engine.json`)).json()) as EngineManifest
    const wasm = await fetchBytes(`${BASE}ngspice.wasm`, manifest.wasmBytes, progress)
    const glue = `${BASE}ngspice.mjs`
    const { default: factory } = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
    return { core: await createCore(factory, wasm), info: { name: 'ngspice', version: manifest.ngspice, build: manifest.build } }
  },
)
