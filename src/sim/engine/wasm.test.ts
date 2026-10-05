// The engine binary as committed (spec 2.2): byte-identical to engine.json's hash in both copies, and
// built without threads: it imports no memory (a shared-memory build imports a shared one), so the
// site needs no SharedArrayBuffer and no COOP/COEP headers.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..', '..')
describe('the committed engine binary', () => {
  for (const dir of ['public/sim', 'plugin/dist-cli'])
    it(`${dir}/ngspice.wasm matches engine.json and imports no memory`, async () => {
      const wasm = readFileSync(join(root, dir, 'ngspice.wasm'))
      const manifest = JSON.parse(readFileSync(join(root, dir, 'engine.json'), 'utf8'))
      expect(wasm.length).toBe(manifest.wasmBytes)
      expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.wasmSha256)
      const mod = await WebAssembly.compile(wasm)
      expect(WebAssembly.Module.imports(mod).filter((i) => i.kind === 'memory')).toEqual([])
      expect(readFileSync(join(root, dir, 'ngspice.mjs'), 'utf8')).not.toMatch(/new SharedArrayBuffer|USE_PTHREADS/)
    })
})
