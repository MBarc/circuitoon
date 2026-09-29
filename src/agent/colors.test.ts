// The layout colours wires by role (the checker's net roles): ground black, positive supplies red,
// signals from a palette without red or black. A net's wires share one colour, and signal nets that
// share a part get different colours while the palette lasts. Every worked example lays out with no
// colour warning.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkDiagram, endpointRole } from '../format/checks.ts'
import { colorFamily } from '../format/diagram.ts'
import { layoutNetlist } from './layout.ts'
import { loadPartial } from './partial.ts'
import { SIGNAL_PALETTE } from './colors.ts'

const DIR = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples')
const TW = join(DIR, 'spirit-typewriter')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

const laid = (raw: unknown, keep?: NonNullable<Parameters<typeof layoutNetlist>[1]>['keep']) => {
  const r = layoutNetlist(raw, { keep })
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value
}
const examples = [
  ...readdirSync(DIR).filter((f) => f.endsWith('.netlist.json')).map((f) => ({ name: f, value: () => laid(read(join(DIR, f))) })),
  ...readdirSync(TW).filter((f) => f.endsWith('.partial.json')).map((f) => ({
    name: `spirit-typewriter/${f}`,
    value: () => {
      const p = loadPartial(read(join(TW, f)))
      if (!p.ok) throw new Error(p.errors.join('\n'))
      return laid(p.intent, p.keep)
    },
  })),
]

describe('the signal palette', () => {
  it('holds neither red nor black, and no colour twice', () => {
    expect(SIGNAL_PALETTE.map(colorFamily).every((f) => f === 'other')).toBe(true)
    expect(new Set(SIGNAL_PALETTE).size).toBe(SIGNAL_PALETTE.length)
  })
})

describe('layout colours wires by role', () => {
  it('ground black, supply red, signals from the palette, one colour per net (no netlist colours)', () => {
    const plain = {
      format: 'circuitoon-netlist/1', title: 'Two sensors',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
      nets: [
        { name: '3V3', pins: ['U1.3V3', 'U2.VIN'] },
        { name: 'GND', pins: ['U1.GND', 'U2.GND'] },
        { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
        { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
      ],
    }
    const { diagram, netOfWire } = laid(plain)
    const colorsOf = new Map<string, Set<string>>()
    for (const c of diagram.connections) {
      const net = netOfWire.get(c.uid)!
      colorsOf.set(net, (colorsOf.get(net) ?? new Set()).add(c.color!))
    }
    for (const s of colorsOf.values()) expect(s.size).toBe(1)
    // The layout chose every colour on purpose, so the colour rules judge each one.
    expect(diagram.connections.every((c) => c.colorSet === true)).toBe(true)
    const one = (net: string) => [...colorsOf.get(net)!][0]
    expect(one('GND')).toBe('black')
    expect(one('3V3')).toBe('red')
    expect(SIGNAL_PALETTE).toContain(one('SCL'))
    expect(SIGNAL_PALETTE).toContain(one('SDA'))
    // SCL and SDA both touch U1 and U2: neighbours, so they differ.
    expect(one('SCL')).not.toBe(one('SDA'))
    expect(endpointRole(diagram, { part: diagram.parts.find((p) => p.designator === 'U2')!.uid, pin: 'GND' })).toBe('ground')
  })
  it('the eight tilt channels, all on U1, get eight different colours', () => {
    const { diagram, netOfWire } = laid(read(join(DIR, 'tilt-sensors-8.netlist.json')))
    const sig = new Map<string, string>()
    for (const c of diagram.connections) {
      const net = netOfWire.get(c.uid)!
      if (/^tilt_\d+\.SIG$/.test(net)) sig.set(net, c.color!)
    }
    expect(sig.size).toBe(8)
    expect(new Set(sig.values()).size).toBe(8)
  })
  it('ten signal nets on one board get ten different colours (neighbours differ while the palette lasts)', () => {
    const pins = ['IO4', 'IO5', 'IO13', 'IO14', 'IO16', 'IO17', 'IO18', 'IO19', 'IO21', 'IO22']
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Ten LEDs',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, ...pins.map((_, i) => ({ ref: `R${i + 1}`, module: 'resistor' }))],
      nets: pins.map((p, i) => ({ name: `S${i + 1}`, pins: [`U1.${p}`, `R${i + 1}.1`] })),
    }
    const { diagram, netOfWire } = laid(raw)
    const byNet = new Map(diagram.connections.map((c) => [netOfWire.get(c.uid)!, c.color!]))
    expect(new Set(byNet.values()).size).toBe(10)
    for (const c of byNet.values()) expect(colorFamily(c)).toBe('other')
  })
  it('a signal net with no neighbour reuses the first colour', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Two apart',
      parts: [{ ref: 'R1', module: 'resistor' }, { ref: 'R2', module: 'resistor' }, { ref: 'R3', module: 'resistor' }, { ref: 'R4', module: 'resistor' }],
      nets: [{ name: 'A', pins: ['R1.2', 'R2.1'] }, { name: 'B', pins: ['R3.2', 'R4.1'] }],
    }
    const { diagram } = laid(raw)
    expect(new Set(diagram.connections.map((c) => c.color))).toEqual(new Set([SIGNAL_PALETTE[0]]))
  })
  for (const ex of examples)
    it(`${ex.name}: no colour warning`, () => {
      const { diagram } = ex.value()
      const colors = checkDiagram(diagram).filter((f) => f.rule.startsWith('wire-color'))
      expect(colors.map((f) => f.message)).toEqual([])
    }, 60_000)
})
