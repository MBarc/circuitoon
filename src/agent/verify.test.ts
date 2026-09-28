// Verification (spec 3 and the verify list of spec 10), on a hand-realized LED circuit: R1 legs in
// columns 1 and 7, D1 in 8 and 12, an unused tilt switch S1 in 15 and 16, BT1 off the board.
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import { load } from '../format/builtinModules.testing.ts'
import { libraryLookup } from './catalog.ts'
import { NO_INTENT, verifyDiagram } from './verify.ts'

const ids = ['breadboard-half', 'battery-holder-2xaa', 'battery-holder-4xaa', 'resistor', 'led', 'tilt-switch-sw520d', 'esp32-devkitc-v4']
const modules = Object.fromEntries(ids.map((id) => [id, load(id)]))

const intent = () => ({
  format: 'circuitoon-netlist/1',
  title: 'LED on a breadboard',
  parts: [
    { ref: 'BB1', module: 'breadboard-half' },
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
    { ref: 'D1', module: 'led', on: 'BB1' },
    { ref: 'S1', module: 'tilt-switch-sw520d', on: 'BB1' },
  ],
  nets: [
    { name: 'VCC', pins: ['BT1.+', 'R1.1'] },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'] },
  ],
} as Record<string, unknown>)

const hole = (pin: string, h: number) => ({ part: 'BB1', pin, hole: h })

function sheet(): Diagram {
  const parts: PartInstance[] = [
    { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 },
    { uid: 'BT1', designator: 'BT1', module: 'battery-holder-2xaa', x: 0, y: 300 },
    { uid: 'R1', designator: 'R1', module: 'resistor', x: 30, y: 40, values: { resistance: { value: 220, unit: 'ohm' } }, mount: { board: 'BB1' } },
    { uid: 'D1', designator: 'D1', module: 'led', x: 100, y: 40, mount: { board: 'BB1' } },
    { uid: 'S1', designator: 'S1', module: 'tilt-switch-sw520d', x: 150, y: 0, mount: { board: 'BB1' } },
  ]
  const connections: Connection[] = [
    { uid: 'w1', from: { part: 'BT1', pin: '+' }, to: hole('c1-top', 1), color: 'red', routing: true },
    { uid: 'w2', from: hole('c7-top', 1), to: hole('c8-top', 1), color: 'blue', routing: true },
    { uid: 'w3', from: hole('c12-top', 1), to: { part: 'BT1', pin: '-' }, color: 'black', routing: true },
  ]
  return { format: 'circuitoon-diagram/1', title: 'LED on a breadboard', modules, parts, connections, intent: intent() }
}
const rules = (d: Diagram) => verifyDiagram(d, libraryLookup).map((f) => f.rule)
const wire = (uid: string, from: Connection['from'], to: Connection['to']): Connection => ({ uid, from, to, routing: true })

describe('verifyDiagram', () => {
  it('passes the realized circuit: routing wires, strips, and an unused seated leg alone in its strip', () => {
    expect(verifyDiagram(sheet(), libraryLookup)).toEqual([])
  })
  it('blocks a hand edit that adds a second wire to a header pin', () => {
    const d = sheet()
    d.connections.push(wire('w4', { part: 'BT1', pin: '+' }, hole('c1-top', 2)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['capacity'])
    expect(f[0].message).toBe('BT1 + holds 2 wire ends but takes one.')
    expect(f[0].wires).toEqual(['w1', 'w4'])
  })
  it('blocks a wire into a hole a leg already fills', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c1-top', 0), hole('c1-top', 3)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['capacity'])
    expect(f[0].message).toBe('BB1 c1-top hole 0 holds a leg and 1 wire end but takes one.')
  })
  it('finds a missing connection', () => {
    const d = sheet()
    d.connections = d.connections.filter((c) => c.uid !== 'w2')
    expect(rules(d)).toEqual(['missing-connection'])
  })
  it('finds a merge through a strip', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c7-top', 2), hole('c12-top', 2)))
    expect(rules(d)).toEqual(['merge'])
  })
  it('finds a merge through a part\'s internal join', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules,
      parts: [
        { uid: 'U1', designator: 'U1', module: 'esp32-devkitc-v4', x: 0, y: 0 },
        { uid: 'R1', designator: 'R1', module: 'resistor', x: 300, y: 0 },
        { uid: 'R2', designator: 'R2', module: 'resistor', x: 300, y: 100 },
      ],
      connections: [
        { uid: 'w1', from: { part: 'U1', pin: 'GND' }, to: { part: 'R1', pin: '1' } },
        { uid: 'w2', from: { part: 'U1', pin: 'GND 2' }, to: { part: 'R2', pin: '1' } },
      ],
      intent: {
        format: 'circuitoon-netlist/1', title: 't',
        parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'R1', module: 'resistor' }, { ref: 'R2', module: 'resistor' }],
        nets: [{ name: 'A', pins: ['U1.GND', 'R1.1'] }, { name: 'B', pins: ['U1.GND 2', 'R2.1'] }],
      },
    }
    expect(rules(d)).toEqual(['merge'])
  })
  it('finds an extra component connection, but allows the routing infrastructure it goes through', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c15-top', 1), hole('c1-top', 2)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['extra-connection'])
    expect(f[0].message).toMatch(/^S1 1 is connected to /)
  })
  it('finds a connection to a pin listed as nc', () => {
    const d = sheet()
    ;(d.intent as Record<string, unknown>).nc = ['S1.2']
    d.connections.push(wire('w4', hole('c16-top', 1), hole('c12-top', 2)))
    expect(rules(d)).toEqual(['nc'])
  })
  it('finds value drift after loading (220 to 2200 ohm)', () => {
    const d = sheet()
    d.parts[2] = { ...d.parts[2], values: { resistance: { value: 2200, unit: 'ohm' } } }
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['value-drift'])
    expect(f[0].message).toContain('R1 resistance is 2.2 k')
  })
  it('compares effective values on both sides (amendment A2): an override the intent lacks is drift', () => {
    const d = sheet()
    const parts = (d.intent as { parts: Record<string, unknown>[] }).parts
    parts[2] = { ref: 'R1', module: 'resistor', on: 'BB1' }
    d.parts[2] = { ...d.parts[2], values: { resistance: { value: 2200, unit: 'ohm' } } }
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['value-drift'])
    expect(f[0].message).toMatch(/^R1 resistance is 2\.2 k.* on the sheet but 1 k.* in the intent\.$/)
  })
  it('compares effective values on both sides (amendment A2): a dropped override is drift, a restated default is not', () => {
    const dropped = sheet()
    delete dropped.parts[2].values
    const f = verifyDiagram(dropped, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['value-drift'])
    expect(f[0].message).toMatch(/^R1 resistance is 1 k.* on the sheet but 220 .* in the intent\.$/)
    const restated = sheet()
    ;(restated.intent as { parts: Record<string, unknown>[] }).parts[2] = { ref: 'R1', module: 'resistor', on: 'BB1' }
    restated.parts[2] = { ...restated.parts[2], values: { resistance: { value: 1000, unit: 'ohm' } } }
    expect(verifyDiagram(restated, libraryLookup)).toEqual([])
  })
  it('compares other part state both ways (amendment A2): a key only on the sheet is drift', () => {
    const d = sheet()
    d.parts[3] = { ...d.parts[3], values: { color: 'blue' } }
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['value-drift'])
    expect(f[0].message).toBe('D1 color is "blue" on the sheet but null in the intent.')
  })
  it('finds a swapped module, an unseated mount and an extra part', () => {
    const swapped = sheet()
    swapped.parts[1] = { ...swapped.parts[1], module: 'battery-holder-4xaa' }
    expect(rules(swapped)).toEqual(['module-mismatch'])
    const loose = sheet()
    loose.parts[3] = { ...loose.parts[3], x: 105 }
    expect(rules(loose)).toContain('mount')
    const extra = sheet()
    extra.parts.push({ uid: 'R9', designator: 'R9', module: 'resistor', x: 400, y: 300 })
    expect(rules(extra)).toEqual(['extra-part'])
  })
  it('reports a missing intent with the gate\'s message', () => {
    const d = sheet()
    delete d.intent
    expect(verifyDiagram(d, libraryLookup).map((f) => f.message)).toEqual([NO_INTENT])
  })
  it('catches drift after a hand edit that moves a jumper onto the ground strip', () => {
    const d = sheet()
    d.connections[1] = { ...d.connections[1], to: hole('c12-top', 3) }
    expect(rules(d)).toEqual(expect.arrayContaining(['merge', 'missing-connection']))
  })
})
