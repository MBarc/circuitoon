// The KiCad netlist export (format/kicad.ts): the file Pcbnew reads (checked by a strict reader that
// follows KiCad's lexer and Pcbnew's netlist parser, since kicad-cli is not installed here),
// references and values in KiCad's form, nets merged through breadboard strips and named from labels
// and roles, infrastructure left out, and the generic fallback for a part without a mapping. Two
// golden files pin the whole output: Michael's battery-bank sheet and the ESP32 + BME280 netlist.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Diagram, type PartInstance, DIAGRAM_FORMAT, validateDiagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { genericFootprint, intentSource, kicadNetName, kicadRef, mappingOf, quote, siValue, stableUuid, toKicadNetlist, writeKicad } from './kicad.ts'
import { load } from './builtinModules.testing.ts'
import { checkKicadNetlist, parseSexpr } from './sexpr.testing.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'

const lib = (id: string) => libraryLookup(id)
const MODS = ['resistor', 'led', 'battery-9v', 'breadboard-mini', 'net-label', 'esp32-devkit-v1-30', 'outlet-schuko-cee7-3', 'tactile-switch-6mm-4pin']
const modules: Record<string, ModuleDef> = Object.fromEntries(MODS.map((id) => [id, load(id)]))
let seq = 0
const part = (uid: string, designator: string, module: string, extra: Partial<PartInstance> = {}): PartInstance => ({ uid, designator, module, x: (seq++ % 6) * 120, y: Math.floor(seq / 6) * 160, ...extra })
const wire = (uid: string, a: [string, string], b: [string, string]) => ({ uid, from: { part: a[0], pin: a[1] }, to: { part: b[0], pin: b[1] } })
const sheet = (parts: PartInstance[], connections: ReturnType<typeof wire>[], extra: Record<string, ModuleDef> = {}): Diagram => ({ format: DIAGRAM_FORMAT, title: 'Test sheet', modules: { ...modules, ...extra }, parts, connections })

/** A battery lights an LED through a resistor; R1 and D1 meet in a mini breadboard strip, and a net label names the battery's + net. */
const ledSheet = () => sheet(
  [
    part('bt', 'BT1', 'battery-9v'),
    part('r', 'R1', 'resistor', { values: { resistance: { value: 330, unit: 'ohm' } } }),
    part('d', 'D1', 'led'),
    part('bb', 'BB1', 'breadboard-mini'),
    part('l1', 'NL1', 'net-label', { values: { net: 'VBAT' } }),
    part('l2', 'NL2', 'net-label', { values: { net: 'VBAT' } }),
  ],
  [
    wire('w1', ['bt', '+'], ['l1', 'NET']),
    wire('w2', ['l2', 'NET'], ['r', '1']),
    wire('w3', ['r', '2'], ['bb', 'c3-top']),
    wire('w4', ['d', 'A'], ['bb', 'c3-top']),
    wire('w5', ['d', 'K'], ['bt', '-']),
  ],
)

describe('KiCad netlist text', () => {
  it('is a netlist Pcbnew reads: one export, version E, components with footprints and UUIDs, numbered nets', () => {
    const x = toKicadNetlist(ledSheet(), { library: lib })
    const n = checkKicadNetlist(x.text)
    expect(n.comps.map((c) => [c.ref, c.value, c.footprint, `${c.lib}:${c.part}`])).toEqual([
      ['BT1', '9V', 'Battery:BatteryHolder_MPD_BA9VPC_1xPP3', 'Device:Battery'],
      ['D1', 'LED', 'LED_THT:LED_D5.0mm', 'Device:LED'],
      ['R1', '330', 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 'Device:R'],
    ])
    expect(n.nets.map((net) => net.code)).toEqual([1, 2, 3])
    expect(x.components).toBe(3)
    expect(x.nets).toBe(3)
    expect(x.warnings).toEqual([])
    expect(x.text.startsWith('(export (version "E")\n')).toBe(true)
    expect(x.text.endsWith(')\n')).toBe(true)
  })

  it('joins pins through a breadboard strip and leaves the breadboard and net labels out', () => {
    const n = checkKicadNetlist(toKicadNetlist(ledSheet(), { library: lib }).text)
    const nets = Object.fromEntries(n.nets.map((net) => [net.name, net.nodes.map((x) => `${x.ref}.${x.pin}`)]))
    // R1 pin 2 and the LED's anode (pad 2) share strip c3-top: a direct connection.
    expect(nets).toEqual({
      VBAT: ['BT1.1', 'R1.1'],
      D1_A: ['D1.2', 'R1.2'],
      GND: ['BT1.2', 'D1.1'],
    })
    expect(n.comps.some((c) => /BB|NL/.test(c.ref))).toBe(false)
  })

  it('names nets from labels, then ground and supply rails, then a pin', () => {
    const d = ledSheet()
    d.parts = d.parts.filter((p) => !p.uid.startsWith('l'))
    d.connections = [...d.connections.filter((c) => !['w1', 'w2'].includes(c.uid)), wire('w6', ['bt', '+'], ['r', '1'])]
    const names = checkKicadNetlist(toKicadNetlist(d, { library: lib }).text).nets.map((x) => x.name)
    expect(names).toEqual(['9V', 'D1_A', 'GND'])
  })

  it('splits a dev board into one socket strip per header, U1A and U1B', () => {
    const d = sheet([part('u', 'U1', 'esp32-devkit-v1-30'), part('r', 'R1', 'resistor')], [wire('w1', ['u', 'D23'], ['r', '1']), wire('w2', ['u', 'GND'], ['r', '2'])])
    const x = toKicadNetlist(d, { library: lib })
    const n = checkKicadNetlist(x.text)
    expect(n.comps.map((c) => [c.ref, c.footprint.split(':')[1], `${c.lib}:${c.part}`])).toEqual([
      ['R1', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 'Device:R'],
      ['U1A', 'PinSocket_1x15_P2.54mm_Vertical', 'Connector_Generic:Conn_01x15'],
      ['U1B', 'PinSocket_1x15_P2.54mm_Vertical', 'Connector_Generic:Conn_01x15'],
    ])
    // GND (left header pin 14) and GND 2 (right header pin 14) are one net, joined inside the board.
    expect(n.nets.find((net) => net.name === 'GND')!.nodes.map((x) => `${x.ref}.${x.pin}.${x.pinfunction}`)).toEqual(['R1.2.2', 'U1A.14.GND', 'U1B.14.GND 2'])
    expect(n.nets.find((net) => net.name === 'U1_D23')!.nodes.map((x) => `${x.ref}.${x.pin}`)).toEqual(['R1.1', 'U1B.1'])
    expect(x.notes).toEqual(["U1: Each header is its own socket strip: place them at the board's real row spacing."])
  })

  it('gives a part without a mapping a generic pin header and a warning', () => {
    const custom: ModuleDef = { format: 'circuitoon-module/1', id: 'my-sensor', name: 'My sensor (3 pin)', pins: [{ name: 'VCC', side: 'left', type: 'power_in' }, { name: 'OUT', side: 'left' }, { name: 'GND', side: 'left', type: 'ground' }] }
    const d = sheet([part('s', 'S 1', 'my-sensor'), part('r', 'R1', 'resistor')], [wire('w1', ['s', 'OUT'], ['r', '1'])], { 'my-sensor': custom })
    const x = toKicadNetlist(d, { library: lib })
    const n = checkKicadNetlist(x.text)
    expect(n.comps.find((c) => c.ref === 'S_1')).toMatchObject({ value: 'My sensor', footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical', lib: 'Circuitoon', part: 'my-sensor' })
    expect(n.nets[0].nodes.map((x) => `${x.ref}.${x.pin}.${x.pinfunction}`)).toEqual(['R1.1.1', 'S_1.2.OUT'])
    expect(x.unmapped).toEqual([{ ref: 'S_1', module: 'my-sensor' }])
    expect(x.warnings).toEqual(['S_1 (my-sensor): no KiCad footprint is known for this part, so it comes in on a generic PinHeader_1x03_P2.54mm_Vertical with a pad per pin in Circuitoon\'s order. Choose its real footprint in KiCad.'])
  })

  it('warns about a placeholder footprint and puts joined pins on one pad', () => {
    const d = sheet([part('o', 'J1', 'outlet-schuko-cee7-3'), part('s', 'SW1', 'tactile-switch-6mm-4pin'), part('r', 'R1', 'resistor')], [wire('w1', ['s', '1'], ['r', '1']), wire('w2', ['s', '3'], ['r', '2'])])
    const x = toKicadNetlist(d, { library: lib })
    const n = checkKicadNetlist(x.text)
    expect(x.placeholders).toEqual([{ ref: 'J1', module: 'outlet-schuko-cee7-3' }])
    expect(x.warnings[0]).toMatch(/^J1 \(outlet-schuko-cee7-3\): Placeholder: an outlet is a panel part/)
    expect(n.comps.find((c) => c.ref === 'J1')!.footprint).toBe('TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-3_1x03_P5.00mm_Horizontal')
    expect(n.nets.map((net) => net.nodes.map((x) => `${x.ref}.${x.pin}.${x.pinfunction}`))).toEqual([['R1.1.1', 'SW1.1.1/2'], ['R1.2.2', 'SW1.2.3/4']])
  })

  it('exports a sheet saved before its parts had a mapping with the library\'s, and an outdated copy as unmapped', () => {
    const old = { ...modules.resistor }
    delete old.kicad
    expect(mappingOf(old, lib).kicad).toEqual(modules.resistor.kicad)
    expect(mappingOf(old).kicad).toBeUndefined()
    const moved = { ...old, pins: [{ name: 'A', side: 'left' as const }, { name: 'B', side: 'right' as const }] }
    expect(mappingOf(moved, lib)).toEqual({ stale: true })
  })

  it('exports a netlist too, joining nets a part joins inside itself', () => {
    const raw = { format: 'circuitoon-netlist/1', title: 'Nano blink', parts: [{ ref: 'U1', module: 'esp32-devkit-v1-30' }, { ref: 'R1', module: 'resistor', values: { resistance: { value: 4700, unit: 'ohm' } } }], nets: [{ name: 'SIG', pins: ['U1.D2', 'R1.1'] }, { name: 'GND', pins: ['U1.GND', 'R1.2'] }] }
    const r = parseNetlist(raw, lib)
    if (!r.ok) throw new Error(r.errors.join('; '))
    const x = writeKicad(intentSource(r.intent), { library: lib })
    const n = checkKicadNetlist(x.text)
    expect(n.comps.find((c) => c.ref === 'R1')!.value).toBe('4.7k')
    expect(n.nets.map((net) => [net.name, net.nodes.map((y) => `${y.ref}.${y.pin}`)])).toEqual([['GND', ['R1.2', 'U1A.14', 'U1B.14']], ['SIG', ['R1.1', 'U1B.12']]])
  })
})

describe('KiCad names and values', () => {
  it('keeps references to letters, digits and _, starting with a letter', () => {
    expect(kicadRef('R1')).toBe('R1')
    expect(kicadRef('Front Display')).toBe('Front_Display')
    expect(kicadRef('R1/2')).toBe('R1_2')
    expect(kicadRef('1R')).toBe('X1R')
    expect(kicadRef('  ')).toBe('X')
  })
  it('writes values the KiCad way', () => {
    expect([330, 4700, 10000, 1e6, 2.2e6, 0, 999999, 1e-7, 1e-5, 4.7e-6, 2.2e-12, 0.5].map(siValue)).toEqual(['330', '4.7k', '10k', '1M', '2.2M', '0', '1M', '100n', '10u', '4.7u', '2.2p', '500m'])
  })
  it('keeps net names to characters KiCad takes', () => {
    expect(kicadNetName('SDA')).toBe('SDA')
    expect(kicadNetName('U2_DC/RS')).toBe('U2_DC_RS')
    expect(kicadNetName('LED PWR')).toBe('LED_PWR')
    expect(kicadNetName('+5V')).toBe('+5V')
  })
  it('quotes every string, escaping quotes, backslashes and line breaks', () => {
    expect(quote('4.0" TFT \\ x\ny')).toBe('"4.0\\" TFT \\\\ x\\ny"')
    expect(parseSexpr(`(a ${quote('4.0" TFT \\ x\ny')})`).map(String)).toEqual(['a,4.0" TFT \\ x\ny'])
  })
  it('sizes the generic header to the pin count', () => {
    expect([1, 3, 40, 41, 100].map(genericFootprint)).toEqual([
      'Connector_PinHeader_2.54mm:PinHeader_1x01_P2.54mm_Vertical',
      'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
      'Connector_PinHeader_2.54mm:PinHeader_1x40_P2.54mm_Vertical',
      'Connector_PinHeader_2.54mm:PinHeader_2x21_P2.54mm_Vertical',
      'Connector_PinHeader_2.54mm:PinHeader_2x40_P2.54mm_Vertical',
    ])
  })
  it('gives each part a stable UUID of its own', () => {
    expect(stableUuid('p1')).toBe(stableUuid('p1'))
    expect(stableUuid('p1')).not.toBe(stableUuid('p2'))
    expect(stableUuid('p1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('the strict netlist reader', () => {
  it('refuses what Pcbnew would refuse', () => {
    expect(() => parseSexpr('(a (b "c")')).toThrow('1 unclosed "("')
    expect(() => parseSexpr('(a))')).toThrow('unbalanced ")"')
    expect(() => parseSexpr('(a "b)')).toThrow('unterminated string')
    const good = toKicadNetlist(ledSheet(), { library: lib }).text
    expect(() => checkKicadNetlist(good.replace('(footprint "LED_THT:LED_D5.0mm")', '(footprint "LED D5")'))).toThrow('is not a "Lib:Name" id')
    expect(() => checkKicadNetlist(good.replace('(code "1")', '(code "2")'))).toThrow('two nets share a code')
    expect(() => checkKicadNetlist(good.replace('(ref "D1")', '(ref "R1")'))).toThrow('reference R1 is used twice')
  })
})

const FIXTURES = join(import.meta.dirname, 'fixtures')
/** Compares with a golden file; UPDATE_GOLDEN=1 rewrites it. */
function golden(file: string, text: string) {
  const path = join(FIXTURES, file)
  if (process.env.UPDATE_GOLDEN) writeFileSync(path, text)
  expect(text).toBe(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))
}

describe('golden files', () => {
  it("Michael's battery-bank sheet", () => {
    const r = validateDiagram(JSON.parse(readFileSync(join(FIXTURES, 'battery-bank-1s4p.circuitoon.json'), 'utf8')))
    if (!r.ok) throw new Error(r.errors.join('; '))
    const x = toKicadNetlist(r.diagram, { library: lib })
    checkKicadNetlist(x.text)
    expect(x.unmapped).toEqual([])
    golden('battery-bank-1s4p.net', x.text)
  })
  it('the ESP32 + BME280 example netlist', () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples', 'esp32-bme280.netlist.json'), 'utf8'))
    const r = parseNetlist(raw, lib)
    if (!r.ok) throw new Error(r.errors.join('; '))
    const x = writeKicad(intentSource(r.intent), { library: lib, source: 'esp32-bme280.netlist.json' })
    checkKicadNetlist(x.text)
    golden('esp32-bme280.net', x.text)
  })
})
