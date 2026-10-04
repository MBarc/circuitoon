// The netlist input contract (spec 1): endpoints, labels, holes, duplicates, embedded modules,
// values, mounts, nc, groups, notes and repeats, each rule with its exact error.
import { describe, expect, it } from 'vitest'
import { parseNetlist, type Intent } from './netlist.ts'
import { libraryLookup } from './catalog.ts'

const led = () => ({
  format: 'circuitoon-netlist/1',
  title: 'LED on a breadboard',
  parts: [
    { ref: 'BB1', module: 'breadboard-half' },
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
    { ref: 'D1', module: 'led', on: 'BB1' },
  ] as Record<string, unknown>[],
  nets: [
    { name: 'VCC', pins: [{ ref: 'BT1', pin: '+' }, { ref: 'R1', pin: '1' }] },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'] },
  ] as { name: string; pins: unknown[] }[],
  wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
})
const parse = (raw: unknown) => parseNetlist(raw, libraryLookup)
const ok = (raw: unknown): Intent => {
  const r = parse(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.intent
}
const errors = (raw: unknown) => {
  const r = parse(raw)
  return r.ok ? [] : r.errors
}

describe('parseNetlist', () => {
  it('parses the spec example: object and string endpoints, colors, ends and the modules used', () => {
    const i = ok(led())
    expect(i.nets.map((n) => [n.name, n.terminals, n.color])).toEqual([
      ['VCC', [{ ref: 'BT1', name: '+', infra: false }, { ref: 'R1', name: '1', infra: false }], 'red'],
      ['LED_A', [{ ref: 'R1', name: '2', infra: false }, { ref: 'D1', name: 'A', infra: false }], undefined],
      ['GND', [{ ref: 'D1', name: 'K', infra: false }, { ref: 'BT1', name: '-', infra: false }], 'black'],
    ])
    expect(i.ends).toBe('dupont-male')
    expect(Object.keys(i.modules)).toEqual(['battery-holder-2xaa', 'breadboard-half', 'led', 'resistor'])
    expect(i.parts.find((p) => p.ref === 'R1')).toEqual({ ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' })
  })
  it('matches an exact pin name before a label, and a label only when one pin has it', () => {
    const n = led()
    // Adapted: no built-in display pin carries a MOSI label (the ST7796S pin is named "SDI(MOSI)"),
    // so the label case uses the LED's "+" silkscreen label on its A pin.
    n.parts.push({ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'DS1', module: 'lcd-st7796s-4in-spi-touch' }, { ref: 'D2', module: 'led' })
    n.nets.push({ name: 'L2', pins: ['U1.IO23', 'D2.+'] }, { name: 'G', pins: ['U1.GND', 'DS1.GND'] })
    const i = ok(n)
    expect(i.nets.find((x) => x.name === 'L2')!.terminals[1]).toEqual({ ref: 'D2', name: 'A', infra: false })
    expect(i.nets.find((x) => x.name === 'G')!.terminals[0]).toEqual({ ref: 'U1', name: 'GND', infra: false })
  })
  it('rejects a label shared by several pins, naming them', () => {
    const n = led()
    n.parts.push({ ref: 'U9', module: 'twin' })
    ;(n as Record<string, unknown>).modules = {
      twin: { format: 'circuitoon-module/1', id: 'twin', name: 'Twin', pins: [{ name: 'G1', label: 'GND', side: 'left' }, { name: 'G2', label: 'GND', side: 'left' }] },
    }
    n.nets.push({ name: 'X', pins: ['U9.GND', 'BT1.-'] })
    expect(errors(n)).toContain('nets[3].pins[0]: "GND" is the label of 2 pins on U9 (G1, G2); name one of them')
  })
  it('resolves hole groups: an index, an omitted index, the string form, and an index out of range', () => {
    const n = led()
    n.nets.push({ name: 'S', pins: [{ ref: 'BB1', group: 'c20-top', hole: 2 }, 'BB1.c21-top'] })
    expect(ok(n).nets[3].terminals).toEqual([
      { ref: 'BB1', name: 'c20-top', infra: true, hole: 2 },
      { ref: 'BB1', name: 'c21-top', infra: true },
    ])
    n.nets[3].pins[0] = { ref: 'BB1', group: 'c20-top', hole: 5 }
    expect(errors(n)).toEqual(['nets[3].pins[0].hole: BB1 c20-top has holes 0 to 4', 'nets[3].pins: a net joins at least 2 pins'])
  })
  it('rejects duplicate refs, duplicate net names and an endpoint in two nets', () => {
    const n = led()
    n.parts.push({ ref: 'R1', module: 'resistor' })
    n.nets.push({ name: 'GND', pins: ['R1.1', 'D1.A'] })
    expect(errors(n)).toEqual([
      'parts[4].ref: duplicate "R1"',
      'nets[3].name: duplicate net "GND"',
    ])
    const m = led()
    m.nets.push({ name: 'X', pins: ['R1.1', 'D1.K'] })
    expect(errors(m)).toEqual([
      'nets[3].pins[0]: R1 1 is already in net "VCC"',
      'nets[3].pins[1]: D1 K is already in net "GND"',
      'nets[3].pins: a net joins at least 2 pins',
    ])
  })
  it('rejects an embedded module that reuses a built-in id, a bad ref and an unknown module', () => {
    const n = led() as Record<string, unknown> & ReturnType<typeof led>
    n.modules = { resistor: { format: 'circuitoon-module/1', id: 'resistor', name: 'Mine', pins: [{ name: 'A', side: 'left' }] } }
    n.parts.push({ ref: '1R', module: 'resistor' }, { ref: 'X1', module: 'no-such-part' })
    expect(errors(n)).toEqual([
      'modules.resistor: "resistor" is a built-in part; give the embedded module its own id',
      'parts[4].ref: required, a letter then letters, digits or _ (for example "R1")',
      'parts[5].module: no built-in or embedded module "no-such-part"',
    ])
  })
  it('rejects a bad value, a mount on a part that is not a board, and nc on a pin that is in a net', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.parts[2] = { ...n.parts[2], values: { resistance: { value: 220, unit: 'F' } }, on: 'BT1' }
    n.nc = ['D1.K', 'BB1.c30-top']
    expect(errors(n)).toEqual([
      'parts[2].values.resistance: must be { "value": <number>, "unit": "ohm" } within 0, or from 1e-15 to 1e12',
      'parts[2].on: BT1 (battery-holder-2xaa) is not a breadboard or rail strip',
      'nc[0]: D1 K is in net "GND", so it cannot be not connected',
      'nc[1]: BB1 c30-top is a breadboard hole group, not a pin',
    ])
  })
  it('rejects a part in two groups, a note near nothing and a string endpoint without a dot', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.groups = [{ name: 'Power', parts: ['BT1'] }, { name: 'Again', parts: ['BT1'] }]
    n.notes = [{ text: 'Hello', near: 'Nowhere' }]
    n.nets.push({ name: 'Z', pins: ['R1', 'D1.A'] })
    expect(errors(n)).toEqual([
      'nets[3].pins[0]: "R1" must be "REF.PIN"',
      'nets[3].pins[1]: D1 A is already in net "LED_A"',
      'nets[3].pins: a net joins at least 2 pins',
      'groups[1].parts[0]: BT1 is already in group "Power"',
      'notes[0].near: must name a part ref or a group',
    ])
  })
  it('expands a repeat: shared GND joins the outside net, a reused channel is rejected, refs collide', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.parts.push({ ref: 'U1', module: 'esp32-devkitc-v4' })
    n.nets[2].pins.push('U1.GND')
    const repeat = (bindings: unknown[]) => ({
      name: 'sw', count: bindings.length,
      template: { parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }], nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }], ports: ['SIG', 'GND'] },
      bindings, shared: { GND: 'GND' },
    })
    n.repeat = repeat([{ SIG: 'U1.IO4' }, { SIG: 'U1.IO5' }])
    const i = ok(n)
    expect(i.nets.find((x) => x.name === 'GND')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['D1.K', 'BT1.-', 'U1.GND', 'S_1.2', 'S_2.2'])
    expect(i.nets.find((x) => x.name === 'sw_2.SIG')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['S_2.1', 'U1.IO5'])
    expect(i.copies.map((c) => c.id)).toEqual(['sw_1', 'sw_2'])
    n.repeat = repeat([{ SIG: 'U1.IO4' }, { SIG: 'U1.IO4' }])
    expect(errors(n)).toContain('repeat.bindings[1].SIG: U1.IO4 is already bound by copy 1 port SIG')
    n.repeat = repeat([{ SIG: 'D1.A' }, { SIG: 'U1.IO5' }])
    expect(errors(n)).toContain('repeat.bindings[0].SIG: D1 A is already in net "LED_A"')
  })
})

// Ruling T3 (Task 2 review): binding reuse is re-checked after pin resolution, and a binding may
// not take an endpoint a top-level net already uses (reuse is what `shared` is for).
describe('parseNetlist repeat bindings after pin resolution', () => {
  const base = (bindings: unknown[], extraNets: { name: string; pins: unknown[] }[] = []) => ({
    format: 'circuitoon-netlist/1',
    title: 'Switches on a display',
    parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'DS1', module: 'lcd-st7796s-4in-spi-touch' }, { ref: 'N1', module: 'arduino-nano' }],
    nets: [{ name: 'GND', pins: ['U1.GND', 'DS1.GND'] }, ...extraNets],
    repeat: {
      name: 'sw', count: bindings.length,
      template: { parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }], nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }], ports: ['SIG', 'GND'] },
      bindings, shared: { GND: 'GND' },
    },
  })
  it('counts a label and the pin name it resolves to as one endpoint bound twice', () => {
    expect(parse(base([{ SIG: 'N1.REF' }, { SIG: 'N1.AREF' }])).ok).toBe(false)
    expect(errors(base([{ SIG: 'N1.REF' }, { SIG: 'N1.AREF' }]))).toEqual([
      'repeat.bindings[1].SIG: N1.AREF is already bound by copy 1 port SIG (N1 AREF)',
      'repeat.template.nets[0] (copy 2).pins: a net joins at least 2 pins',
    ])
    expect(errors(base([{ SIG: { ref: 'N1', pin: 'AREF' } }, { SIG: 'N1.REF' }]))).toEqual([
      'repeat.bindings[1].SIG: N1.REF is already bound by copy 1 port SIG (N1 AREF)',
      'repeat.template.nets[0] (copy 2).pins: a net joins at least 2 pins',
    ])
  })
  it('reports a textually identical reuse once (from expansion), not again as a net conflict', () => {
    expect(errors(base([{ SIG: 'U1.IO4' }, { SIG: { ref: 'U1', pin: 'IO4' } }]))).toEqual([
      'repeat.template.nets[0] (copy 2).pins: a net joins at least 2 pins',
      'repeat.bindings[1].SIG: U1.IO4 is already bound by copy 1 port SIG',
    ])
  })
  it('rejects a binding to an endpoint a top-level net uses, including the net a shared port joins', () => {
    expect(errors(base([{ SIG: 'U1.IO4' }, { SIG: 'U1.GND' }]))).toEqual([
      'repeat.bindings[1].SIG: U1 GND is already in net "GND"',
      'repeat.template.nets[0] (copy 2).pins: a net joins at least 2 pins',
    ])
    expect(errors(base([{ SIG: 'U1.IO4' }, { SIG: 'N1.REF' }], [{ name: 'REF', pins: ['U1.IO23', 'N1.AREF'] }]))).toEqual([
      'repeat.bindings[1].SIG: N1 AREF is already in net "REF"',
      'repeat.template.nets[0] (copy 2).pins: a net joins at least 2 pins',
    ])
  })
  it('accepts the shared net joining every copy and distinct resolved bindings', () => {
    const i = ok(base([{ SIG: 'N1.REF' }, { SIG: 'U1.IO4' }]))
    expect(i.nets.find((x) => x.name === 'GND')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['U1.GND', 'DS1.GND', 'S_1.2', 'S_2.2'])
    expect(i.nets.find((x) => x.name === 'sw_1.SIG')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['S_1.1', 'N1.AREF'])
  })
})

describe('USB in a netlist', () => {
  const base = {
    format: 'circuitoon-netlist/1', title: 'USB',
    parts: [{ ref: 'U1', module: 'rpi-4-model-b' }, { ref: 'U2', module: 'esp32-devkit-v1-30' }],
    nets: [{ name: 'USB', pins: ['U1.USB2-1', 'U2.USB'] }],
  }
  it('takes a net of two USB ports', () => {
    expect(parseNetlist(base, libraryLookup).ok).toBe(true)
  })
  it('refuses USB plugs as the cable end of every wire: the layout picks a USB link\'s cable', () => {
    const r = parseNetlist({ ...base, wires: { ends: 'usb-c' } }, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['wires.ends: "usb-c" is a USB plug: a net of two USB ports gets its USB cable from the layout, so leave it out here'])
  })
})
