// circuitoon bom: the bill of materials as text, as CSV with -o, and as JSON matching its schema;
// invalid input exits 2 like every command, with one error envelope under --json.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bomCsv, bomLines } from '../format/bom.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { tiltSensors } from '../agent/fixtures.testing.ts'
import { USAGE } from './main.ts'

// Wires only (--labels none), so the repeat block keeps its local rail strips (DP1...), which the bill marks as added.
const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(tiltSensors()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json', '--labels', 'none'], { cwd: dir })).code).toBe(0)
  return dir
}

describe('circuitoon bom', () => {
  it('prints the bill as lines, layout-added strips marked', async () => {
    const dir = await laidOut()
    const r = await cli(['bom', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^Bill of materials: /)
    expect(r.out).toMatch(/\d+ x Power rail strip, .*DP1.*\(\d+ added by layout\)/)
    expect(r.out).toMatch(/\d+ x .*jumper, 22 AWG, black/)
  })
  it('writes the CSV with -o, and --json matches its schema and the same bill', async () => {
    const dir = await laidOut()
    const r = await cli(['bom', 'sheet.json', '-o', 'out/bom.csv', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('bom'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/bom/1', ok: true, sheet: 'sheet.json', output: 'out/bom.csv' })
    expect(readFileSync(join(dir, 'out', 'bom.csv'), 'utf8')).toBe(bomCsv(out.bom))
    expect(out.lines).toEqual(bomLines(out.bom))
    const plain = JSON.parse((await cli(['bom', 'sheet.json', '--json'], { cwd: dir })).out)
    expect(plain.output).toBeNull()
    const text = await cli(['bom', 'sheet.json', '-o', 'b.csv'], { cwd: dir })
    expect(text.out).toContain('Wrote b.csv')
  })
  it('agrees with gate: the same CSV bytes', async () => {
    const dir = await laidOut()
    await cli(['bom', 'sheet.json', '-o', 'bom.csv'], { cwd: dir })
    await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'none.exe') } })
    expect(readFileSync(join(dir, 'bom.csv'), 'utf8')).toBe(readFileSync(join(dir, 'out', 'bom.csv'), 'utf8'))
  })
  it('exits 2 on a missing file, a file that is not a sheet, or a second sheet; one envelope under --json', async () => {
    const dir = tempDir()
    expect((await cli(['bom'], { cwd: dir })).code).toBe(2)
    expect((await cli(['bom', 'missing.json'], { cwd: dir })).code).toBe(2)
    writeFileSync(join(dir, 'x.json'), '{"format":"nope"}')
    const r = await cli(['bom', 'x.json', '--json'], { cwd: dir })
    expect(r.code).toBe(2)
    const env = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('error'), env)).toEqual([])
    expect(env.error.code).toBe('input')
    expect((await cli(['bom', 'x.json', 'y.json'], { cwd: dir })).code).toBe(2)
  })
  it('is in the usage text', () => {
    expect(USAGE).toContain('bom <sheet.json> [-o <bom.csv>] [--json]')
  })
})

describe('the bill with net labels (rule V3)', () => {
  it('1-main: jumpers and Dupont ends with labels on are close to wires only, the difference being the breadboard strips labels do without', async () => {
    const { readFileSync: read } = await import('node:fs')
    const { loadPartial } = await import('../agent/partial.ts')
    const { layoutNetlist } = await import('../agent/layout.ts')
    const { billOfMaterials } = await import('../format/bom.ts')
    const p = loadPartial(JSON.parse(read(new URL('../../plugin/skills/circuitoon-design/references/examples/spirit-typewriter/1-main.partial.json', import.meta.url), 'utf8')))
    if (!p.ok) throw new Error(p.errors.join('; '))
    const count = (labels: 'auto' | 'none') => {
      const r = layoutNetlist(p.intent, { keep: p.keep, labels })
      if (!r.ok) throw new Error(r.errors.join('; '))
      const bom = billOfMaterials(r.value.diagram)
      const jumpers = bom.wires.filter((w) => w.cable === 'Dupont F-F jumper').reduce((n, w) => n + w.count, 0)
      const ends = bom.connectors.find((c) => c.kind === 'dupont-female')?.count ?? 0
      // Nets that go through BB1 when drawn as wires: each takes one wire per pin into a strip, where
      // the same net drawn with labels takes one fewer (pin to pin), more when it spans several strips.
      const viaStrips = new Set(r.value.diagram.connections.filter((c) => c.from.part === 'BB1' || c.to.part === 'BB1').map((c) => r.value.netOfWire.get(c.uid)))
      return { jumpers, ends, viaStrips: viaStrips.size, labelled: bom.wires.filter((w) => w.labelled).length }
    }
    const on = count('auto')
    const off = count('none')
    expect(on.labelled).toBeGreaterThan(0)
    expect(on.ends).toBe(2 * on.jumpers)
    expect(off.ends).toBe(2 * off.jumpers)
    expect(off.jumpers - on.jumpers).toBeGreaterThan(0)
    expect(off.jumpers - on.jumpers).toBeLessThanOrEqual(2 * off.viaStrips)
  }, 120_000)
})
