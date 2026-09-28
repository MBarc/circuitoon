// Verification (spec 3 and the verify list of spec 10), on a hand-realized LED circuit: R1 legs in
// columns 1 and 7, D1 in 8 and 12, an unused tilt switch S1 in 15 and 16, BT1 off the board.
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import { load } from '../format/builtinModules.testing.ts'
import { libraryLookup } from './catalog.ts'
import { NO_INTENT, verifyDiagram } from './verify.ts'

const ids = ['breadboard-half', 'battery-holder-2xaa', 'battery-holder-4xaa', 'resistor', 'led', 'tilt-switch-sw520d', 'esp32-devkitc-v4', 'power-rail-strip', 'mcp23017-cjmcu-2317']
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
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([
      ['missing-connection', 'Net LED_A is not connected: R1 2, D1 + are on 2 separate pieces.'],
      ['merge', 'Nets GND and LED_A are joined on the sheet (BT1 -, R1 2); they must stay separate.'],
    ])
  })
  it('allows an nc pin that sits alone in its strip', () => {
    const d = sheet()
    ;(d.intent as Record<string, unknown>).nc = ['S1.2']
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('allows a rail strip the intent does not list: boards are infrastructure', () => {
    const d = sheet()
    d.parts.push({ uid: 'PR1', designator: 'PR1', module: 'power-rail-strip', x: 0, y: 500 })
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('finds a part the sheet lacks', () => {
    const d = sheet()
    d.parts = d.parts.filter((p) => p.uid !== 'D1')
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([['part-missing', 'D1 (led) is in the intent but not on the sheet.']])
  })
  it('finds a duplicated part, without calling its intended connections extra', () => {
    const d = sheet()
    d.parts.push({ uid: 'D1b', designator: 'D1', module: 'led', x: 400, y: 300 })
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => [x.rule, x.message])).toEqual([['part-duplicate', '2 parts on the sheet are named D1; the intent has one.']])
    expect(f[0].parts).toEqual(['D1', 'D1b'])
  })
  it('still reports a real extra connection on another part when a part is duplicated', () => {
    const d = sheet()
    d.parts.push({ uid: 'D1b', designator: 'D1', module: 'led', x: 400, y: 300 })
    d.connections.push(wire('w4', hole('c15-top', 2), hole('c7-top', 2)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['part-duplicate', 'extra-connection'])
    expect(f[1].parts).toEqual(['S1'])
  })
  it('finds a part whose module is not embedded', () => {
    const d = sheet()
    d.modules = { ...d.modules }
    delete d.modules.led
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([
      ['module-missing', `D1's module "led" is not embedded in the sheet.`],
      ['mount', 'D1 is set to plug into BB1 but is not seated (cannot-mount), so its legs connect nothing.'],
      ['missing-connection', 'Net GND is not connected: D1 K, BT1 - are on 2 separate pieces.'],
      ['missing-connection', 'Net LED_A is not connected: R1 2, D1 A are on 2 separate pieces.'],
    ])
  })
  it('reports an intent that is not a valid netlist', () => {
    const d = sheet()
    ;(d.intent as Record<string, unknown>).format = 'circuitoon-netlist/9'
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([
      ['intent', 'intent is not a valid netlist: format: unsupported "circuitoon-netlist/9" (expected "circuitoon-netlist/1")'],
    ])
  })
  it('finds a part that is not mounted on its requested board at all', () => {
    const d = sheet()
    d.parts[3] = { uid: 'D1', designator: 'D1', module: 'led', x: 400, y: 300 }
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([
      ['mount', 'D1 should plug into BB1 but is not mounted on it.'],
      ['missing-connection', 'Net GND is not connected: D1 -, BT1 - are on 2 separate pieces.'],
      ['missing-connection', 'Net LED_A is not connected: R1 2, D1 + are on 2 separate pieces.'],
    ])
  })
  it('lets a pad that declares capacity 2 take two wire ends, and only then', () => {
    const pads = (cap?: number): Diagram => {
      // Under an id of its own: a changed copy of a library part stored under the library id is drift.
      const m = { ...structuredClone(modules['mcp23017-cjmcu-2317']), id: 'my-expander' }
      const gnd = m.holes!.find((g) => g.name === 'GND')!
      if (cap === undefined) delete gnd.capacity
      else gnd.capacity = cap
      return {
        format: 'circuitoon-diagram/1', title: 't', modules: { ...modules, 'my-expander': m },
        parts: [
          { uid: 'U2', designator: 'U2', module: 'my-expander', x: 0, y: 0 },
          { uid: 'BT1', designator: 'BT1', module: 'battery-holder-2xaa', x: 300, y: 0 },
          { uid: 'R1', designator: 'R1', module: 'resistor', x: 300, y: 200 },
        ],
        connections: [
          { uid: 'w1', from: { part: 'BT1', pin: '-' }, to: { part: 'U2', pin: 'GND', hole: 0 } },
          { uid: 'w2', from: { part: 'R1', pin: '1' }, to: { part: 'U2', pin: 'GND', hole: 0 } },
        ],
        intent: {
          format: 'circuitoon-netlist/1', title: 't',
          modules: { 'my-expander': m },
          parts: [{ ref: 'U2', module: 'my-expander' }, { ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'R1', module: 'resistor' }],
          nets: [{ name: 'GND', pins: ['U2.GND', 'BT1.-', 'R1.1'] }],
        },
      }
    }
    expect(verifyDiagram(pads(2), libraryLookup)).toEqual([])
    const one = verifyDiagram(pads(), libraryLookup)
    expect(one.map((x) => [x.rule, x.message])).toEqual([['capacity', 'U2 GND hole 0 holds 2 wire ends but takes one.']])
    expect(one[0].wires).toEqual(['w1', 'w2'])
  })
})

describe('verifyDiagram against the library (stored modules are not trusted)', () => {
  it('blocks a stored library module whose pins were swapped, even when it matches its own wiring', () => {
    const d = sheet()
    const led = structuredClone(modules.led)
    const pins = led.pins as { name: string }[]
    const [a, k] = [pins.findIndex((p) => p.name === 'A'), pins.findIndex((p) => p.name === 'K')]
    ;[pins[a].name, pins[k].name] = [pins[k].name, pins[a].name]
    d.modules = { ...d.modules, led }
    const f = verifyDiagram(d, libraryLookup).filter((x) => x.rule === 'module-drift')
    expect(f.map((x) => [x.severity, x.parts])).toEqual([['error', ['D1']]])
    expect(f[0].message).toContain('no longer matches the current library')
    expect(f[0].message).toContain('pins A/K')
    expect(f[0].message).toContain('Lay the sheet out again')
    expect(f[0].message).not.toMatch(/tamper/i)
  })
  it('blocks a stored copy with no version whose pins were swapped (content decides, not the version)', () => {
    const d = sheet()
    const led = structuredClone(modules.led)
    delete led.version
    const pins = led.pins as { name: string }[]
    const [a, k] = [pins.findIndex((p) => p.name === 'A'), pins.findIndex((p) => p.name === 'K')]
    ;[pins[a].name, pins[k].name] = [pins[k].name, pins[a].name]
    d.modules = { ...d.modules, led }
    const f = verifyDiagram(d, libraryLookup).filter((x) => x.rule === 'module-drift')
    expect(f.map((x) => x.severity)).toEqual(['error'])
    expect(f[0].message).toContain('pins A/K')
  })
  it('blocks a changed pin capacity, mains field, hole group, internal join or electrical data', () => {
    const cases: ((m: Record<string, unknown>) => void)[] = [
      (m) => void ((m.pins as Record<string, unknown>[]).find((p) => p.name === 'A')!.capacity = 2),
      (m) => void ((m.pins as Record<string, unknown>[]).find((p) => p.name === 'A')!.mains = 'L'),
      (m) => void (m.internal = [['A', 'K']]),
      (m) => void (m.electrical = {}),
      (m) => void (m.holes = []),
    ]
    for (const change of cases) {
      const d = sheet()
      const led = structuredClone(modules.led) as unknown as Record<string, unknown>
      change(led)
      d.modules = { ...d.modules, led: led as unknown as Diagram['modules'][string] }
      expect(verifyDiagram(d, libraryLookup).filter((x) => x.rule === 'module-drift').map((x) => x.severity), String(change)).toEqual(['error'])
    }
  })
  it('only warns when the stored copy differs in art, name, source, category or version alone', () => {
    const variants = [
      { name: 'LED (old name)' },
      { art: { ...structuredClone(modules.led.art!), shapes: [] } },
      { source: 'https://example.com/old', category: 'Old' },
      { version: 9 },
    ]
    for (const v of variants) {
      const d = sheet()
      d.modules = { ...d.modules, led: { ...structuredClone(modules.led), ...v } }
      const f = verifyDiagram(d, libraryLookup)
      expect(f.map((x) => [x.rule, x.severity]), JSON.stringify(Object.keys(v))).toEqual([['module-drift', 'warning']])
      expect(f[0].message).not.toMatch(/tamper/i)
      expect(f[0].parts).toEqual(['D1'])
    }
  })
  it('only warns when the library changed art or name alone, even without a version bump', () => {
    const d = sheet()
    const newer = { ...structuredClone(modules.led), name: 'LED (revised)' }
    const lookup = (id: string) => (id === 'led' ? newer : libraryLookup(id))
    expect(verifyDiagram(d, lookup).map((x) => [x.rule, x.severity])).toEqual([['module-drift', 'warning']])
  })
  it('blocks a changed built-in part embedded in intent.modules under its library id', () => {
    const d = sheet()
    const led = structuredClone(modules.led)
    const pins = led.pins as { name: string }[]
    const [a, k] = [pins.findIndex((p) => p.name === 'A'), pins.findIndex((p) => p.name === 'K')]
    ;[pins[a].name, pins[k].name] = [pins[k].name, pins[a].name]
    ;(d.intent as { modules?: unknown }).modules = { led }
    const f = verifyDiagram(d, libraryLookup)
    const drift = f.filter((x) => x.rule === 'module-drift')
    expect(drift.map((x) => [x.severity, x.parts])).toEqual([['error', ['D1']]])
    expect(drift[0].message).toContain('pins A/K')
    // The netlist's own guard is no longer hidden either.
    expect(f.some((x) => x.rule === 'intent' && x.message.includes('built-in part'))).toBe(true)
  })
  it('counts only a real library board as infrastructure: a stored module marked as a board is still an extra part', () => {
    const d = sheet()
    const fake = { ...structuredClone(modules['power-rail-strip']), id: 'my-strip', name: 'My strip' }
    d.modules = { ...d.modules, 'my-strip': fake }
    d.parts.push({ uid: 'PR1', designator: 'PR1', module: 'my-strip', x: 0, y: 500 })
    expect(verifyDiagram(d, libraryLookup).map((x) => [x.rule, x.message])).toEqual([['extra-part', 'PR1 (my-strip) is on the sheet but not in the intent.']])
  })
  it('still verifies an embedded part that is not in the library', () => {
    const d = sheet()
    const mine = { ...structuredClone(modules.led), id: 'my-led', name: 'My LED' }
    d.modules = { ...d.modules, 'my-led': mine }
    d.parts[3] = { ...d.parts[3], module: 'my-led' }
    const intent = d.intent as { parts: { ref: string; module: string }[]; modules?: unknown }
    intent.parts = intent.parts.map((p) => (p.ref === 'D1' ? { ...p, module: 'my-led' } : p))
    intent.modules = { 'my-led': mine }
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
})
