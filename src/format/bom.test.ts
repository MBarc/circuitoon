// The bill of materials: parts grouped by module and value with designator ranges, each module's
// category and source, infrastructure the layout added, wires by cable, gauge and colour, connector
// counts, and an RFC 4180 CSV that never starts a cell with a formula.
import { describe, expect, it } from 'vitest'
import { billOfMaterials, bomCsv, bomLines, csvField, designatorRanges } from './bom.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef, PinDef } from './module.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sheet } from '../render/Sheet.tsx'
import { wireColor } from './diagram.ts'
import { modulesById } from '../library.ts'

const pins2: PinDef[] = [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }]
const resistor: ModuleDef = { format: 'circuitoon-module/1', id: 'resistor', name: 'Resistor (1/4 W)', category: 'Passives', pins: pins2,
  electrical: { params: { resistance: { unit: 'ohm', default: 220 } } } }
const holder: ModuleDef = { format: 'circuitoon-module/1', id: 'holder', name: '18650 holder (1 cell)', category: 'Batteries',
  pins: [{ name: '+', side: 'top', type: 'power_out', supply: '3.7V' }, { name: '-', side: 'top', type: 'ground' }] }
const board: ModuleDef = { format: 'circuitoon-module/1', id: 'mcu', name: 'Dev board', category: 'Boards', source: 'https://example.com/a https://example.com/b',
  pins: [{ name: 'IO', side: 'right', type: 'io' }, { name: 'GND', side: 'left', type: 'ground' }] }
const strip: ModuleDef = { format: 'circuitoon-module/1', id: 'power-rail-strip', name: 'Power rail strip', category: 'Prototyping', pins: [] }

const part = (designator: string, module: string, extra: Partial<PartInstance> = {}): PartInstance => ({ uid: designator.toLowerCase(), designator, module, x: 0, y: 0, ...extra })
const ohm = (value: number) => ({ values: { resistance: { value, unit: 'ohm' } } })
const wire = (uid: string, a: string, b: string, extra: Partial<Connection> = {}): Connection => {
  const end = (s: string) => {
    const [p, pin] = s.split('.')
    return { part: p, pin }
  }
  return { uid, from: end(a), to: end(b), ...extra }
}
const sheet = (parts: PartInstance[], connections: Connection[] = []): Diagram => ({
  format: 'circuitoon-diagram/1', title: 'Bench', modules: { resistor, holder, mcu: board, 'power-rail-strip': strip }, parts, connections,
})

describe('designatorRanges', () => {
  it('sorts naturally and joins runs of three or more', () => {
    expect(designatorRanges(['BT3', 'BT1', 'BT4', 'BT2'])).toBe('BT1-BT4')
    expect(designatorRanges(['R10', 'R2', 'R1', 'R3', 'R9'])).toBe('R1-R3, R9, R10')
    expect(designatorRanges(['R1', 'R2'])).toBe('R1, R2')
    expect(designatorRanges(['U1'])).toBe('U1')
    expect(designatorRanges(['MCP Breadboard 3', 'MCP Breadboard 1', 'MCP Breadboard 2'])).toBe('MCP Breadboard 1 to MCP Breadboard 3')
    expect(designatorRanges(['J1-3', 'J1-1', 'J1-2'])).toBe('J1-1 to J1-3')
    expect(designatorRanges(['sw_1.S', 'sw_2.S'])).toBe('sw_1.S, sw_2.S')
    expect(designatorRanges(['J1', 'X', 'D1'])).toBe('D1, J1, X')
  })
})

describe('parts', () => {
  const d = sheet([part('BT3', 'holder'), part('BT1', 'holder'), part('BT2', 'holder'), part('BT4', 'holder'),
    part('R1', 'resistor', ohm(330)), part('R2', 'resistor', ohm(100_000)), part('R3', 'resistor', ohm(100_000)), part('U1', 'mcu')])
  const bom = billOfMaterials(d)
  it('groups by module plus value, with sorted designator ranges', () => {
    expect(bomLines(bom).slice(0, 4)).toEqual([
      '4 x 18650 holder (1 cell), BT1-BT4',
      '1 x Dev board, U1',
      '1 x Resistor (1/4 W), 330 Ω, R1',
      '2 x Resistor (1/4 W), 100 kΩ, R2, R3',
    ])
  })
  it("carries each module's category and its source links", () => {
    const u1 = bom.parts.find((p) => p.module === 'mcu')!
    expect(u1.category).toBe('Boards')
    expect(u1.source).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(bom.parts.find((p) => p.module === 'holder')!.source).toEqual([])
  })
  it('counts parts whose module is missing under its id, never dropping them', () => {
    const b = billOfMaterials(sheet([part('X1', 'gone')]))
    expect(b.parts.map((p) => [p.name, p.count, p.refs])).toEqual([['gone', 1, 'X1']])
  })
  it('marks infrastructure the layout added, and custom parts', () => {
    const b = billOfMaterials(sheet([part('U1', 'mcu'), part('DP1', 'power-rail-strip'), part('DP2', 'power-rail-strip')]), { added: new Set(['DP1', 'DP2']), custom: new Set(['mcu']) })
    const dp = b.parts.find((p) => p.module === 'power-rail-strip')!
    expect([dp.count, dp.added]).toEqual([2, 2])
    expect(b.parts.find((p) => p.module === 'mcu')!.custom).toBe(true)
    expect(bomLines(b)).toContain('2 x Power rail strip, DP1, DP2 (added by layout)')
  })
})

describe('wires', () => {
  const d = sheet([part('U1', 'mcu'), part('U2', 'mcu'), part('BT1', 'holder')], [
    wire('w1', 'u1.IO', 'u2.IO', { color: 'blue', ends: { from: 'dupont-male', to: 'dupont-male' } }),
    wire('w2', 'u2.GND', 'u1.GND', { color: 'black', gauge: 22, ends: { from: 'dupont-male', to: 'dupont-male' } }),
    wire('w3', 'bt1.-', 'u1.GND', { color: 'black', ends: { from: 'dupont-male', to: 'dupont-male' }, routing: true }),
    wire('w4', 'bt1.+', 'u2.IO', { color: 'red', gauge: 20, ends: { from: 'dupont-female', to: 'dupont-male' } }),
    wire('w5', 'u2.IO', 'bt1.+', { color: 'red', gauge: 20, ends: { from: 'dupont-male', to: 'dupont-female' } }),
    wire('w6', 'u1.IO', 'u2.GND', { color: 'yellow', ends: { from: 'jst-xh', to: 'ferrule' } }),
    wire('w7', 'u1.IO', 'u2.GND'),
  ])
  const bom = billOfMaterials(d)
  it('counts wires by cable, ends either way round, gauge and colour', () => {
    expect(bom.wires.map((w) => [w.cable, w.gauge, w.color, w.count, w.added])).toEqual([
      ['Dupont M-F jumper', 20, 'red', 2, 0],
      ['Dupont M-M jumper', 22, 'black', 2, 1],
      ['Dupont M-M jumper', 22, 'blue', 1, 0],
      ['Ferrule to JST-XH plug lead', 22, 'yellow', 1, 0],
      ['Hookup wire', 22, 'black', 1, 0],
    ])
    expect(bomLines(bom)).toContain('2 x Dupont M-M jumper, 22 AWG, black (1 added by layout)')
  })
  it('an uncoloured wire takes the colour it is drawn in', () => {
    const plain = billOfMaterials(sheet([part('U1', 'mcu'), part('BT1', 'holder')], [wire('w1', 'bt1.+', 'u1.IO'), wire('w2', 'bt1.-', 'u1.GND')]))
    // BT1 + is a supply net (drawn red), BT1 - a ground (black).
    expect(plain.wires.map((w) => w.color).sort()).toEqual(['black', 'red'])
  })
  it('lists every wire under the colour the sheet draws it in, uncoloured ones by their role', () => {
    const use = ['battery-18650-holder', 'esp32-devkit-v1-30', 'oled-ssd1306-096-i2c']
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 'Drawn', modules: Object.fromEntries(use.map((id) => [id, modulesById[id]])),
      parts: [part('BT1', 'battery-18650-holder'), part('U1', 'esp32-devkit-v1-30', { x: 300 }), part('DS1', 'oled-ssd1306-096-i2c', { x: 700 }), part('BT2', 'battery-18650-holder', { y: 300 })],
      connections: [wire('p', 'u1.3V3', 'ds1.VCC'), wire('g', 'bt1.-', 'u1.GND'), wire('s', 'u1.D21', 'ds1.SDA'), wire('c', 'bt2.-', 'ds1.GND', { color: 'green' })],
    }
    const svg = renderToStaticMarkup(createElement(Sheet, { diagram: d, box: { x: 0, y: 0, w: 1200, h: 800 }, label: 'b' }))
    const drawn = d.connections.map((c) => new RegExp(`data-wire="${c.uid}"[^]*?class="wire-color"[^>]*stroke="([^"]+)"`).exec(svg)![1]).sort()
    const listed = billOfMaterials(d).wires.flatMap((w) => Array(w.count).fill(wireColor(w.color))).sort()
    expect(listed).toEqual(drawn)
    expect(billOfMaterials(d).wires.map((w) => `${w.color} x${w.count}`).sort()).toEqual(['black x2', 'green x1', 'red x1'])
  })
  it('counts connectors per kind (not bare, stripped or solid-core ends)', () => {
    expect(bom.connectors.map((c) => [c.name, c.count])).toEqual([
      ['Dupont female', 2],
      ['Dupont male', 8],
      ['Ferrule', 1],
      ['JST-XH plug', 1],
    ])
  })
})

describe('CSV', () => {
  it('quotes every field and doubles quotes (RFC 4180)', () => {
    expect(csvField('plain')).toBe('"plain"')
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(4)).toBe('"4"')
  })
  it('guards against formula injection with a leading apostrophe', () => {
    for (const bad of ['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx']) expect(csvField(bad), bad).toBe(`"'${bad.replace(/"/g, '""')}"`)
    expect(csvField('BT1-BT4')).toBe('"BT1-BT4"')
  })
  it('writes a header, one row per part, wire and connector, with CRLF line ends and ASCII units', () => {
    const d = sheet([part('R1', 'resistor', ohm(4700)), part('=cmd', 'mcu')], [wire('w1', 'r1.1', 'r1.2', { color: 'blue', ends: { from: 'dupont-male', to: 'dupont-male' } })])
    const csv = bomCsv(billOfMaterials(d))
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe('"Type","Qty","Description","Value","Designators","Category","Source","Notes"')
    expect(rows).toContain('"Part","1","Resistor (1/4 W)","4.7 kohm","R1","Passives","",""')
    expect(rows).toContain(`"Part","1","Dev board","","'=cmd","Boards","https://example.com/a https://example.com/b",""`)
    expect(rows).toContain('"Wire","1","Dupont M-M jumper","22 AWG, blue","","","",""')
    expect(rows).toContain('"Connector","2","Dupont male","","","","",""')
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.includes('\n') && !/[^\r]\n/.test(csv)).toBe(true)
  })
})
