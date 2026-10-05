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
    // engine.json is revalidated every time; the engine files are named by its hash, so a new
    // engine is never mixed with a cached old one.
    const res = await fetch(`${BASE}engine.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`the simulation engine is not installed (${BASE}engine.json: HTTP ${res.status})`)
    const manifest = (await res.json()) as EngineManifest
    const v = `?v=${manifest.wasmSha256}`
    const wasm = await fetchBytes(`${BASE}ngspice.wasm${v}`, manifest.wasmBytes, progress)
    // An absolute URL: Vite's dev server rewrites a relative or root import of a public file (?import) and refuses it.
    const glue = new URL(`${BASE}ngspice.mjs${v}`, self.location.href).href
    const { default: factory } = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
    return { core: await createCore(factory, wasm), info: { name: 'ngspice', version: manifest.ngspice, build: manifest.build } }
  },
)
