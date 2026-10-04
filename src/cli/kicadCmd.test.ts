// circuitoon kicad: a sheet or a netlist as a KiCad netlist, printed or written with -o, with a JSON
// report matching its schema; unmapped parts are warnings (exit 0), and input that is neither a sheet
// nor a netlist exits 2 with one error envelope under --json.
import { describe, expect, it } from 'vitest'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { checkKicadNetlist } from '../format/sexpr.testing.ts'
import { USAGE } from './main.ts'

const SHEET = resolve('src/format/fixtures/battery-bank-1s4p.circuitoon.json')
const NETLIST = resolve('plugin/skills/circuitoon-design/references/examples/esp32-bme280.netlist.json')

describe('circuitoon kicad', () => {
  it('prints a sheet as a KiCad netlist, notes on stderr', async () => {
    const dir = tempDir()
    copyFileSync(SHEET, join(dir, 'bank.json'))
    const r = await cli(['kicad', 'bank.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.out).toBe(readFileSync(resolve('src/format/fixtures/battery-bank-1s4p.net'), 'utf8').replace(/\r\n/g, '\n').replace('(source "Untitled sheet.circuitoon.json")', '(source "bank.json")'))
    expect(checkKicadNetlist(r.out).comps.length).toBe(16)
    expect(r.err).toContain("note: U2: Each header is its own socket strip: place them at the board's real row spacing.")
  })

  it('writes -o and reports in JSON matching its schema', async () => {
    const dir = tempDir()
    copyFileSync(NETLIST, join(dir, 'n.json'))
    const r = await cli(['kicad', 'n.json', '-o', 'out/board.net', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('kicad'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/kicad/1', ok: true, input: 'n.json', source: 'netlist', output: 'out/board.net', components: 3, unmapped: [], placeholders: [] })
    expect(out.netlist).toBeUndefined()
    checkKicadNetlist(readFileSync(join(dir, 'out', 'board.net'), 'utf8'))
    const plain = JSON.parse((await cli(['kicad', 'n.json', '--json'], { cwd: dir })).out)
    expect(plain.output).toBeNull()
    expect(schemaErrors(loadSchema('kicad'), plain)).toEqual([])
    expect(plain.netlist).toMatch(/^\(export \(version "E"\)/)
    const text = await cli(['kicad', 'n.json', '-o', 'b.net'], { cwd: dir })
    expect(text.out).toBe('Wrote b.net: 3 components, 4 nets. Open it in KiCad\'s PCB Editor with File > Import > Netlist.\n')
  })

  it('exits 0 with warnings for a part without a KiCad footprint', async () => {
    const dir = tempDir()
    const n = { format: 'circuitoon-netlist/1', title: 'Motor', parts: [{ ref: 'U1', module: 'l298n-module' }, { ref: 'R1', module: 'resistor' }], nets: [{ name: 'EN', pins: ['U1.ENA', 'R1.1'] }] }
    writeFileSync(join(dir, 'm.json'), JSON.stringify(n))
    const r = await cli(['kicad', 'm.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('kicad'), out)).toEqual([])
    expect(out.unmapped).toEqual([{ ref: 'U1', module: 'l298n-module' }])
    expect(out.warnings[0]).toMatch(/^U1 \(l298n-module\): no KiCad footprint is known for this part, so it comes in on a generic PinHeader_1x13_P2.54mm_Vertical/)
    const text = await cli(['kicad', 'm.json', '-o', 'm.net'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.out).toContain('1 on a generic footprint')
    expect(text.err).toMatch(/^warning: U1 \(l298n-module\)/)
  })

  it('exits 2 on a missing file, a file that is neither a sheet nor a netlist, or a second file', async () => {
    const dir = tempDir()
    expect((await cli(['kicad'], { cwd: dir })).code).toBe(2)
    expect((await cli(['kicad', 'missing.json'], { cwd: dir })).code).toBe(2)
    writeFileSync(join(dir, 'x.json'), '{"format":"nope"}')
    const r = await cli(['kicad', 'x.json', '--json'], { cwd: dir })
    expect(r.code).toBe(2)
    const env = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('error'), env)).toEqual([])
    expect(env.error.message).toMatch(/neither a Circuitoon sheet nor a netlist/)
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ format: 'circuitoon-netlist/1', title: 'x', parts: [], nets: [{ name: 'A', pins: ['Q1.X'] }] }))
    expect((await cli(['kicad', 'bad.json'], { cwd: dir })).code).toBe(2)
    expect((await cli(['kicad', 'x.json', 'y.json'], { cwd: dir })).code).toBe(2)
  })

  it('is in the usage', () => {
    expect(USAGE).toContain('kicad <sheet.json|netlist.json> [-o <out.net>] [--json]')
  })
})
