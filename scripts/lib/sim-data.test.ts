// Ruling R1: a module's sourced electrical.sim comes from scripts/sim-data/<id>.json, merged into
// the module file by emit() for every generator and by gen-sim.mjs for hand-written modules.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The helpers are plain JS for the generators; load them untyped.
const { withSim } = await import(new URL('./sim-data.mjs', import.meta.url).href)

describe('withSim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-data-'))
  writeFileSync(join(dir, 'led.json'), JSON.stringify({ id: 'led', sim: { limits: [] }, review: [] }))
  const url = pathToFileURL(`${dir}/`)
  const text = `${JSON.stringify({ id: 'led', electrical: { model: 'led', params: {} }, kicad: {} }, null, 2)}\n`
  it('puts the patch under electrical.sim of a module file, keeping every other key in place', () => {
    const out = JSON.parse(withSim('C:/x/modules/led.json', text, url))
    expect(out.electrical).toEqual({ model: 'led', params: {}, sim: { limits: [] } })
    expect(Object.keys(out)).toEqual(['id', 'electrical', 'kicad'])
    // Generators on Windows pass backslash paths (fileURLToPath).
    expect(JSON.parse(withSim('C:\\x\\modules\\led.json', text, url)).electrical.sim).toEqual({ limits: [] })
  })
  it('leaves files that are not modules, and modules without a patch, untouched', () => {
    expect(withSim('C:/x/plugin/dist-cli/circuitoon.mjs', 'code', url)).toBe('code')
    expect(withSim('C:/x/modules/resistor.json', text, url)).toBe(text)
  })
})
