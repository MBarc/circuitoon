// Low-voltage wire colours: GND black, positive supply rails red, signals any other colour. Mains
// wiring keeps its regional identity colours and is exempt. Net roles come from the checker's own
// supply and ground knowledge; a wire is judged only when its colour was set, and an uncoloured
// wire is drawn in its role's colour.
import { describe, expect, it } from 'vitest'
import { checkDiagram, endpointRole, netRoles } from './checks.ts'
import { type Connection, type Diagram, type PartInstance, colorFamily } from './diagram.ts'
import type { ModuleDef, PinDef } from './module.ts'
import { newWireColor, wireLooks } from './mainsLook.ts'
import { serializeDiagram, validateDiagram } from './diagram.ts'
import { carryWireStyle, updateWire } from '../editor/ops.ts'
import { NEW_WIRE_COLOR } from '../editor/store.ts'
import { at, sheet as mainsSheet, w as mainsWire } from './mains.testing.ts'

const mod = (id: string, pins: PinDef[], extra: Partial<ModuleDef> = {}): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins, ...extra })
const cell = mod('cell', [{ name: '+', side: 'top', type: 'power_out', supply: '3.7V' }, { name: '-', side: 'top', type: 'ground' }],
  { electrical: { model: 'voltage_source', params: { voltage: { unit: 'V', default: 3.7 } } } })
const chip = mod('chip', [
  { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3/5V' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'D', side: 'right', type: 'input' },
  { name: 'Q', side: 'right', type: 'output' },
])
const neg = mod('neg', [{ name: 'OUT', side: 'right', type: 'power_out', supply: '-5V' }, { name: 'GND', side: 'right', type: 'ground' }])
const old = mod('old', [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }])
const buck = mod('buck', [{ name: 'OUT+', side: 'right', type: 'power_out', supply: 'ADJ' }, { name: 'OUT-', side: 'right', type: 'ground' }])
/** A power input with no supply listed: its voltage is unknown. */
const nosupply = mod('nosupply', [{ name: 'VCC', side: 'left', type: 'power_in' }, { name: 'GND', side: 'left', type: 'ground' }])
const MODULES = { cell, chip, neg, old, buck, nosupply }

let seq = 0
const part = (designator: string, module: keyof typeof MODULES): PartInstance => ({ uid: designator.toLowerCase(), designator, module, x: seq++ * 200, y: 300 })
const wire = (uid: string, a: string, b: string, color?: string): Connection => {
  const end = (s: string) => {
    const [p, ...pin] = s.split('.')
    return { part: p, pin: pin.join('.') }
  }
  // A colour given here was chosen on purpose (colorSet), like one picked in the Inspector.
  return { uid, from: end(a), to: end(b), ...(color ? { color, colorSet: true as const } : {}) }
}
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: MODULES, parts, connections })

/** BT1 powers U1 (3.7 V into VCC), U1 Q drives U2 D, both chips grounded to BT1 -. */
const circuit = (colors: { vcc?: string; gnd?: string; sig?: string; gnd2?: string } = {}) =>
  sheet([part('BT1', 'cell'), part('U1', 'chip'), part('U2', 'chip')], [
    wire('w1', 'bt1.+', 'u1.VCC', colors.vcc),
    wire('w2', 'bt1.-', 'u1.GND', colors.gnd),
    wire('w3', 'u1.GND', 'u2.GND', colors.gnd2),
    wire('w4', 'u1.Q', 'u2.D', colors.sig),
  ])
const colorRules = (d: Diagram) => checkDiagram(d).filter((f) => f.rule.startsWith('wire-color'))

describe('colorFamily', () => {
  it('reads named black and red, and dark or saturated red hex values, as those colours', () => {
    expect(colorFamily('black')).toBe('black')
    expect(colorFamily('BLACK')).toBe('black')
    expect(colorFamily('#000000')).toBe('black')
    expect(colorFamily('#2B2F36')).toBe('black')
    expect(colorFamily('red')).toBe('red')
    expect(colorFamily('#FF0000')).toBe('red')
    expect(colorFamily('#E0483E')).toBe('red')
    expect(colorFamily('#C62828')).toBe('red')
  })
  it('reads every other colour as other: orange, pink, brown, blue, gray, white, green-yellow', () => {
    for (const c of ['orange', 'pink', 'brown', 'blue', 'gray', 'white', 'green-yellow', 'yellow', '#F48C06', '#F07AB0', '#8B5A2B', '#9AA2AD', '#3D6FD6'])
      expect(colorFamily(c), c).toBe('other')
  })
})

describe('net roles', () => {
  const d = circuit()
  const role = (part: string, pin: string) => endpointRole(d, { part, pin })
  it('a net with a ground pin is ground, one with a positive supply is supply, anything else signal', () => {
    expect(role('bt1', '-')).toBe('ground')
    expect(role('u2', 'GND')).toBe('ground')
    expect(role('bt1', '+')).toBe('supply')
    expect(role('u1', 'VCC')).toBe('supply')
    expect(role('u1', 'Q')).toBe('signal')
  })
  it('a pin on no net takes its own role: a lone power input at a known positive rail is supply', () => {
    expect(role('u2', 'VCC')).toBe('supply')
    expect(role('u2', 'Q')).toBe('signal')
  })
  it('an adjustable output is a positive supply; a power pin whose rail does not parse (-5V) is not judged at all', () => {
    const b = sheet([part('PS1', 'buck'), part('PS2', 'neg')], [])
    expect(endpointRole(b, { part: 'ps1', pin: 'OUT+' })).toBe('supply')
    expect(endpointRole(b, { part: 'ps2', pin: 'OUT' })).toBeNull()
  })
  it('a net holding a power pin with an unknown supply is not judged, even beside a signal', () => {
    const b = sheet([part('PS2', 'neg'), part('U1', 'chip'), part('X1', 'nosupply')], [wire('w1', 'ps2.OUT', 'u1.D', 'red'), wire('w2', 'x1.VCC', 'u1.Q', 'black')])
    expect(endpointRole(b, { part: 'u1', pin: 'D' })).toBeNull()
    expect(endpointRole(b, { part: 'x1', pin: 'VCC' })).toBeNull()
    expect(checkDiagram(b).filter((f) => f.rule.startsWith('wire-color'))).toEqual([])
  })
  it('an untyped pin is signal, even wired to a signal', () => {
    const u = sheet([part('X1', 'old'), part('U1', 'chip')], [wire('w1', 'x1.A', 'u1.D')])
    expect(endpointRole(u, { part: 'x1', pin: 'A' })).toBe('signal')
    expect(endpointRole(u, { part: 'x1', pin: 'B' })).toBe('signal')
  })
  it('a net that holds both a ground and a supply (a short, or cells in series) has no colour role', () => {
    const series = sheet([part('BT1', 'cell'), part('BT2', 'cell')], [wire('w1', 'bt1.+', 'bt2.-')])
    expect(endpointRole(series, { part: 'bt1', pin: '+' })).toBeNull()
  })
  it('lists a role per net of the netlist', () => {
    const r = netRoles(d)
    expect(r.roles).toHaveLength(r.netlist.nets.length)
    expect([...r.roles].sort()).toEqual(['ground', 'signal', 'supply'])
  })
})

describe('colour rules', () => {
  it('a sheet coloured by the convention has no colour findings', () => {
    expect(colorRules(circuit({ vcc: 'red', gnd: 'black', gnd2: 'black', sig: 'blue' }))).toEqual([])
  })
  it('wires with no stored colour are not judged', () => {
    expect(colorRules(circuit())).toEqual([])
  })
  it('wire-color-ground: one warning per ground net, naming each wire that is not black and saying the fix', () => {
    const f = colorRules(circuit({ gnd: 'blue', gnd2: 'green', vcc: 'red', sig: 'blue' }))
    expect(f.map((x) => [x.rule, x.severity, x.wires])).toEqual([['wire-color-ground', 'warning', ['w2', 'w3']]])
    expect(f[0].message).toContain('BT1 - to U1 GND')
    expect(f[0].message).toContain('U1 GND to U2 GND')
    expect(f[0].message).toMatch(/black/)
    expect(f[0].select.wires).toEqual(['w2', 'w3'])
  })
  it('wire-color-supply: a supply wire that is not red', () => {
    const f = colorRules(circuit({ vcc: 'orange' }))
    expect(f.map((x) => [x.rule, x.wires])).toEqual([['wire-color-supply', ['w1']]])
    expect(f[0].message).toContain('BT1 + to U1 VCC')
    expect(f[0].message).toMatch(/red/)
  })
  it('wire-color-signal: a signal wire that is red or black', () => {
    expect(colorRules(circuit({ sig: 'red' })).map((x) => [x.rule, x.wires])).toEqual([['wire-color-signal', ['w4']]])
    expect(colorRules(circuit({ sig: '#000000' })).map((x) => x.rule)).toEqual(['wire-color-signal'])
    expect(colorRules(circuit({ sig: 'white' }))).toEqual([])
  })
  it('an id that stays the same when another wire of the net is recoloured', () => {
    const a = colorRules(circuit({ gnd: 'blue' }))[0].id
    const b = colorRules(circuit({ gnd: 'blue', gnd2: 'green' }))[0].id
    expect(a).toBe(b)
  })
  it('a net with both a ground and a supply is not judged', () => {
    const series = sheet([part('BT1', 'cell'), part('BT2', 'cell')], [wire('w1', 'bt1.+', 'bt2.-', 'blue')])
    expect(colorRules(series)).toEqual([])
  })
  it('never blocks: every colour finding is a warning', () => {
    const f = colorRules(circuit({ gnd: 'red', vcc: 'black', sig: 'red' }))
    expect(f.map((x) => x.rule).sort()).toEqual(['wire-color-ground', 'wire-color-signal', 'wire-color-supply'])
    expect(f.every((x) => x.severity === 'warning')).toBe(true)
  })
})

describe('mains exemption', () => {
  it('mains wires keep their identity colours and are never judged by the low-voltage rules', () => {
    // A US lamp: L black, N white, PE green, all stored explicitly.
    const d = mainsSheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200)],
      [mainsWire('xs1|L', 'e1|L', { color: 'black' }), mainsWire('xs1|N', 'e1|N', { color: 'white' }), mainsWire('xs1|PE', 'e1|PE', { color: 'green' })])
    expect(colorRules(d)).toEqual([])
    expect(endpointRole(d, { part: 'xs1', pin: 'L' })).toBeNull()
  })
})

describe('drawn colour of an uncoloured wire', () => {
  it('ground wires draw black and supply wires red; a signal wire keeps the default', () => {
    const looks = wireLooks(circuit())
    expect(looks.get('w1')?.color).toBe('red')
    expect(looks.get('w2')?.color).toBe('black')
    expect(looks.get('w4')?.color ?? null).toBeNull()
  })
  it('a wire with a stored colour keeps it: the look is only used when the wire stores none', () => {
    expect(wireLooks(circuit({ vcc: 'orange' })).get('w1')?.color ?? null).toBeNull()
  })
})

describe('the colour a new wire starts with', () => {
  const d = circuit()
  const ep = (part: string, pin: string) => ({ part, pin })
  it('black when it starts from or ends on a ground net', () => {
    expect(newWireColor(d, ep('u2', 'GND'), ep('u2', 'D'), 'blue')).toBe('black')
    expect(newWireColor(d, ep('u2', 'D'), ep('bt1', '-'), 'blue')).toBe('black')
  })
  it('red for a supply', () => {
    expect(newWireColor(d, ep('u2', 'VCC'), ep('u2', 'D'), 'blue')).toBe('red')
    expect(newWireColor(d, ep('u2', 'D'), ep('bt1', '+'), 'blue')).toBe('red')
  })
  it("the user's default for a signal", () => {
    expect(newWireColor(d, ep('u2', 'D'), ep('u1', 'Q'), 'blue')).toBe('blue')
  })
})

describe('only a colour chosen on purpose is judged (colorSet)', () => {
  const stored = (d: Diagram) => ({ ...d, connections: d.connections.map((c) => ({ uid: c.uid, from: c.from, to: c.to, color: 'black', gauge: 22 })) })
  it('an old sheet whose editor-drawn wires all stored black raises no colour warning', () => {
    expect(colorRules(stored(circuit()))).toEqual([])
  })
  it('picking red on a signal wire in the Inspector marks the colour as chosen, and it warns', () => {
    const d = updateWire(stored(circuit()), 'w4', { color: 'red' })
    expect(d.connections.find((c) => c.uid === 'w4')).toMatchObject({ color: 'red', colorSet: true })
    expect(colorRules(d).map((f) => [f.rule, f.wires])).toEqual([['wire-color-signal', ['w4']]])
  })
  it('a label or gauge edit does not mark the colour as chosen', () => {
    const d = updateWire(stored(circuit()), 'w4', { label: 'SIG', gauge: 24 })
    expect(d.connections.find((c) => c.uid === 'w4')!.colorSet).toBeUndefined()
  })
  it('validates and round-trips the flag: true or absent, never anything else', () => {
    const d = circuit({ sig: 'blue' })
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r.ok && r.diagram.connections.find((c) => c.uid === 'w4')!.colorSet).toBe(true)
    const bad = JSON.parse(serializeDiagram(d))
    bad.connections[3].colorSet = 'yes'
    const v = validateDiagram(bad)
    expect(v.ok ? [] : v.errors).toContain('connections[3].colorSet: must be true when present')
  })
})

describe('the new-wire default after a recolour', () => {
  const style = { color: NEW_WIRE_COLOR, gauge: 22 }
  it('fixing a ground wire to black leaves the default blue, so the next signal wire comes out blue', () => {
    const after = carryWireStyle(style, { color: 'black' })
    expect(after.color).toBe('blue')
    const d = circuit()
    expect(newWireColor(d, { part: 'u2', pin: 'D' }, { part: 'u1', pin: 'Q' }, after.color)).toBe('blue')
  })
  it('red, or a hex that reads as red or black, is never carried over; any other colour, gauge and cable are', () => {
    expect(carryWireStyle(style, { color: 'red' }).color).toBe('blue')
    expect(carryWireStyle(style, { color: '#000000' }).color).toBe('blue')
    expect(carryWireStyle(style, { color: 'yellow' }).color).toBe('yellow')
    expect(carryWireStyle({ ...style, ends: { from: 'jst-sh' } }, { gauge: 18 })).toEqual({ color: 'blue', gauge: 18, ends: { from: 'jst-sh' } })
  })
})
