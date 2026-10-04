// Net labels in the agent toolkit: verify treats a connection made through labels exactly like one
// made by wires, and labels as infrastructure (never extra parts, never extra connections, no
// capacity); the netlist's net-level `"label": true` is parsed and validated (piece B lays it out).
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import { load } from '../format/builtinModules.testing.ts'
import { libraryLookup } from './catalog.ts'
import { verifyDiagram } from './verify.ts'
import { parseNetlist } from './netlist.ts'

const ids = ['battery-holder-2xaa', 'resistor', 'led', 'net-label']
const modules = Object.fromEntries(ids.map((id) => [id, load(id)]))

const intent = (nets?: unknown[]) => ({
  format: 'circuitoon-netlist/1',
  title: 'LED',
  parts: [
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'R1', module: 'resistor' },
    { ref: 'D1', module: 'led' },
  ],
  nets: nets ?? [
    { name: 'VCC', pins: ['BT1.+', 'R1.1'], label: true },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'], label: true },
  ],
})

const p = (uid: string, module: string, x: number, extra: Partial<PartInstance> = {}): PartInstance => ({ uid, designator: uid, module, x, y: 0, ...extra })
const lbl = (uid: string, net: string, x: number) => p(uid, 'net-label', x, { y: 100, values: { net } })
const w = (uid: string, a: string, b: string): Connection => {
  const end = (s: string) => ({ part: s.split('.')[0], pin: s.split('.')[1] })
  return { uid, from: end(a), to: end(b) }
}

/** VCC and GND are joined only through labels; LED_A is a wire. */
function sheet(names = { vcc: ['VCC', 'VCC'], gnd: ['GND', 'GND'] }): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 'LED', modules, intent: intent(),
    parts: [
      p('BT1', 'battery-holder-2xaa', 0), p('R1', 'resistor', 200), p('D1', 'led', 400),
      lbl('NL1', names.vcc[0], 0), lbl('NL2', names.vcc[1], 200), lbl('NL3', names.gnd[0], 400), lbl('NL4', names.gnd[1], 600),
    ],
    connections: [
      w('w1', 'BT1.+', 'NL1.NET'), w('w2', 'R1.1', 'NL2.NET'), w('w3', 'R1.2', 'D1.A'),
      w('w4', 'D1.K', 'NL3.NET'), w('w5', 'BT1.-', 'NL4.NET'),
    ],
  }
}
const rules = (d: Diagram) => verifyDiagram(d, libraryLookup).map((f) => f.rule)

describe('verify with net labels', () => {
  it('passes a circuit whose nets are joined through labels, labels not counted as extra parts', () => {
    expect(verifyDiagram(sheet(), libraryLookup)).toEqual([])
  })
  it('finds the missing connection when a label is misnamed', () => {
    const f = verifyDiagram(sheet({ vcc: ['VCC', 'VCC'], gnd: ['GND', 'GDN'] }), libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['missing-connection'])
    expect(f[0].message).toMatch(/^Net GND is not connected/)
  })
  it('finds a merge made through labels', () => {
    expect(rules(sheet({ vcc: ['VCC', 'X'], gnd: ['GND', 'X'] }))).toContain('merge')
  })
  it('never reports a label as an extra connection, and gives a label pin no capacity limit', () => {
    const d = sheet()
    d.parts.push(lbl('NL5', 'VCC', 800))
    d.connections.push(w('w6', 'NL5.NET', 'NL2.NET'), w('w7', 'NL5.NET', 'NL1.NET'))
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
})

describe('netlist "label"', () => {
  it('parses label: true onto the net', () => {
    const r = parseNetlist(intent(), libraryLookup)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.intent.nets.map((n) => n.label ?? false)).toEqual([true, false, true])
  })
  it('accepts label: false and leaves it off', () => {
    const r = parseNetlist(intent([{ name: 'A', pins: ['R1.1', 'D1.A'], label: false }]), libraryLookup)
    expect(r.ok && r.intent.nets[0].label).toBe(undefined)
  })
  it('refuses a label that is not true or false', () => {
    const r = parseNetlist(intent([{ name: 'A', pins: ['R1.1', 'D1.A'], label: 'yes' }]), libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('nets[0].label: must be true or false')
  })
  it('refuses a label on a net with a mains terminal', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Lamp',
      parts: [{ ref: 'E1', module: 'lamp-holder-e26' }, { ref: 'E2', module: 'lamp-holder-e26' }],
      nets: [{ name: 'LIVE', pins: ['E1.L', 'E2.L'], label: true }],
    }
    const r = parseNetlist(raw, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/nets\[0\]\.label: net LIVE joins mains terminal E1 L; mains is always drawn as wires/)
  })
  it('refuses a label on a net with a USB port', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'ESP32 on a Pi',
      parts: [{ ref: 'U1', module: 'rpi-4-model-b' }, { ref: 'U2', module: 'esp32-devkitc-v4' }],
      nets: [{ name: 'USB', pins: ['U1.USB2-1', 'U2.USB'], label: true }],
    }
    const r = parseNetlist(raw, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/nets\[0\]\.label: net USB joins USB port U1 USB2-1; USB is always drawn as a cable or a plug-in, never as labels/)
  })
  it('refuses net-label parts in the parts list (the layout places labels)', () => {
    const raw = intent()
    raw.parts.push({ ref: 'NL1', module: 'net-label' })
    const r = parseNetlist(raw, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/parts\[3\]\.module: net-label is not a part/)
  })
})
