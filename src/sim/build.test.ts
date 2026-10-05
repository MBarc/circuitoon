// Spec 2 and 4: the circuit build. Every terminal of every simulated part; nets named as extract
// names them; singletons `<ref>_<pin>`; a 0 ohm resistor, a closed switch and a fuse are real
// contact branches; open switches and buttons add nothing; relays sit at rest; capacitors are
// emitted; mains nodes stay out; the build is deterministic.
import { describe, expect, it } from 'vitest'
import { Builder, buildCircuit } from './build.ts'
import { cellModule, sheet } from './testing.ts'
import { type Device, netNode } from './model.ts'
import type { ModuleDef } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'
import { toKicadNetlist } from '../format/kicad.ts'
import { checkKicadNetlist } from '../format/sexpr.testing.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { sheetNets } from '../agent/extract.ts'

const kinds = (devs: Device[]) => devs.map((d) => `${d.kind}:${d.id}`)

describe('buildCircuit: primitives', () => {
  const ledSheet = sheet(
    [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
    [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
  )
  it('names nets as extract does and taps every pin that carries a device', () => {
    const c = buildCircuit(ledSheet)
    expect(c.nets).toEqual(['BT1_+', 'D1_A', 'GND'])
    expect(c.taps.map((t) => `${t.node}@${t.net}`)).toEqual(['bt1:+@BT1_+', 'bt1:-@GND', 'd1:A@D1_A', 'd1:K@GND', 'r1:1@BT1_+', 'r1:2@D1_A'])
    expect(kinds(c.devices)).toEqual(['cell:bt1.cell', 'diode:d1.led', 'resistor:r1.r'])
    expect(c.pinNet[JSON.stringify(['d1', 'A'])]).toBe('D1_A')
  })
  it('compiles the cell with its own rInternal, the LED from forwardVoltage, and the legacy LED limit', () => {
    const c = buildCircuit(ledSheet)
    const cell = c.devices.find((d) => d.kind === 'cell')!
    expect(cell.kind === 'cell' && [cell.volts.value, cell.volts.basis, cell.rInternal.value, cell.rInternal.basis]).toEqual([5, 'user', 1e-6, 'representative'])
    const led = c.devices.find((d) => d.kind === 'diode')!
    expect(led.kind === 'diode' && led.model.is).toBeCloseTo(9.4e-11, 12)
    expect(c.limits.filter((l) => l.part === 'd1').map((l) => [l.kind, l.value.value, l.value.basis, l.value.label])).toEqual([['current', 0.02, 'representative', 'led.D1.maxCurrent'], ['absMaxCurrent', 0.03, 'representative', 'led-colours.red.absMaxCurrent']])
  })
  it('falls back to the default forwardVoltage outside 1.0 to 5.0 V, with a note', () => {
    const fallback = buildCircuit(ledSheet).devices.find((d) => d.kind === 'diode')!
    for (const value of [0.1, 0.99, 5.01]) {
      const c = buildCircuit(sheet([{ uid: 'd1', module: 'led', values: { forwardVoltage: { value, unit: 'V' } } }], []))
      expect(c.devices[0]).toEqual(fallback)
      expect(c.notes).toEqual([`D1: forwardVoltage ${value} V is outside 1.0 to 5.0 V; the default 2 V is used`])
    }
    // A non-number (NaN, Infinity) is no stored value at all (isNum), so the default applies silently.
    expect(buildCircuit(sheet([{ uid: 'd1', module: 'led', values: { forwardVoltage: { value: Number.NaN, unit: 'V' } } }], [])).devices[0]).toEqual(fallback)
    const ok = buildCircuit(sheet([{ uid: 'd1', module: 'led', values: { forwardVoltage: { value: 3.1, unit: 'V' } } }], []))
    expect(ok.notes).toEqual([])
    expect(ok.devices[0].kind === 'diode' && ok.devices[0].model.is).not.toBe(fallback.kind === 'diode' && fallback.model.is)
  })
  it('makes a 0 ohm resistor a contact branch, never R = 0', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(3, 0.1) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 0, unit: 'ohm' } } }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    const r = c.devices.find((d) => d.kind === 'resistor')!
    expect(r.kind === 'resistor' && [r.role, r.ohms.value, r.ohms.basis]).toEqual(['contact', 0.02, 'estimate'])
  })
  it('splits a potentiometer at its position, at least 1 ohm each side', () => {
    const c = buildCircuit(sheet([{ uid: 'p1', module: 'potentiometer', values: { position: 0.25 } }], []))
    expect(c.devices.map((d) => d.kind === 'resistor' && d.ohms.value)).toEqual([2500, 7500])
    const end = buildCircuit(sheet([{ uid: 'p1', module: 'potentiometer', values: { position: 0 } }], []))
    expect(end.devices.map((d) => d.kind === 'resistor' && d.ohms.value)).toEqual([1, 10000])
  })
  // Fix wave 7b: every contact is a switch device at its position (an open one compiles to nothing),
  // where an open contact used to be no device at all.
  const states = (devs: Device[]) => devs.map((d) => d.kind === 'switch' && `${d.id}:${d.closed ? 'closed' : 'open'}`)
  it('closes a switch only in its saved position, and a button only while held', () => {
    const open = buildCircuit(sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], []))
    expect(states(open.devices)).toEqual(['s1.s.1.no:open'])
    expect(open.devices[0]).toMatchObject({ a: 's1:1', b: 's1:2', latching: true, ron: { value: 0.05, basis: 'datasheet' } })
    const closed = buildCircuit(sheet([{ uid: 's1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }], []))
    expect(states(closed.devices)).toEqual(['s1.s.1.no:closed'])
    const b = sheet([{ uid: 'b1', module: 'push-button' }], [])
    expect(states(buildCircuit(b).devices)).toEqual(['b1.s.1.no:open'])
    expect(buildCircuit(b).devices[0]).toMatchObject({ latching: false })
    expect(states(buildCircuit(b, { held: { part: 'b1', group: 's' } }).devices)).toEqual(['b1.s.1.no:closed'])
  })
  it('shows a relay at rest (NC closed, NO open) with a note', () => {
    const c = buildCircuit(sheet([{ uid: 'k1', module: 'relay-module-1ch-5v' }], []))
    const sw = c.devices.filter((d) => d.kind === 'switch').map((d) => d.kind === 'switch' && [d.contact, d.a, d.b, d.closed, d.latching])
    expect(sw).toEqual([['nc', 'k1:COM', 'k1:NC', true, false], ['no', 'k1:COM', 'k1:NO', false, false]])
    expect(c.openContacts).toEqual([])
    expect(c.notes.join(' ')).toContain('K1: shown at rest')
  })
  it('emits a capacitor, and names a singleton pin <ref>_<pin>', () => {
    const c = buildCircuit(sheet([{ uid: 'c1', module: 'capacitor-ceramic' }], []))
    expect(c.devices[0]).toMatchObject({ kind: 'capacitor', a: 'c1:1', b: 'c1:2', farads: 1e-7 })
    expect(c.taps.map((t) => t.net)).toEqual(['C1_1', 'C1_2'])
  })
  it('lists a powered part with no power data, and keeps conductors and boards out', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: 'bme280-module-4pin' }, { uid: 'bb1', module: 'breadboard-half' }, { uid: 'j1', module: 'jst-xh-2' }], []))
    expect(c.unsimulated).toEqual([{ part: 'u1', reason: 'no power data' }])
    expect(Object.keys(c.parts)).toEqual([])
  })
  it('is deterministic whatever the part order', () => {
    const a = buildCircuit(ledSheet)
    const b = buildCircuit({ ...ledSheet, parts: [...ledSheet.parts].reverse() })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('buildCircuit: fix round 1', () => {
  it('lets a battery sim.imax override replace the module sourceCurrent limit, as user', () => {
    const bt = (values?: Record<string, unknown>) => buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1), ...(values ? { values } : {}) }], [])).limits.map((l) => [l.kind, l.value.value, l.value.basis])
    expect(bt()).toEqual([['sourceCurrent', 2, 'representative']])
    expect(bt({ 'sim.imax': { value: 3, unit: 'A' } })).toEqual([['sourceCurrent', 3, 'user']])
  })

  const withPower = (id: string): ModuleDef => {
    const m = load(id)
    return { ...m, electrical: { ...(m.electrical as object), sim: { power: { domains: [], rails: [{ id: 'r', inputs: [], output: 'X', kind: 'ldo', reverse: 'blocks' }] }, limits: [{ of: { part: true }, kind: 'current', value: 1, provenance: 'datasheet', source: 'https://example.com/x' }] } } }
  }
  it('purges a skipped part: a relay or latching switch with sim.power leaves no taps, notes, devices or open contacts', () => {
    const c = buildCircuit(sheet([{ uid: 'k1', module: withPower('relay-module-1ch-5v') }, { uid: 's1', module: withPower('rocker-switch-kcd1') }], []))
    expect([c.taps, c.devices, c.limits, c.openContacts, c.notes, c.parts]).toEqual([[], [], [], [], [], {}])
    const reason = 'incomplete power data: rail r needs vout, dropout, ioutMax'
    expect(c.unsimulated).toEqual([{ part: 'k1', reason }, { part: 's1', reason }])
  })
  it('purges limits, domains, GPIOs and USB paths of a skipped part', () => {
    const b = new Builder(sheet([{ uid: 'r1', module: 'resistor' }], []), {})
    b.limit({ part: 'r1', of: { part: true }, kind: 'current', value: b.user(1, 'x') })
    b.domain({ part: 'r1', name: 'VIN', pin: '1', ret: '2', nominal: 5 })
    b.gpio({ part: 'r1', pin: '1', state: null, domain: 'VIN', key: 'k' })
    b.usbPath({ host: 'h1', hostPort: 'USB', device: 'r1', devicePort: 'USB', vbus: 'a', gnd: 'b', limit: b.user(0.5, 'y') })
    b.skip('r1', 'test')
    const c = b.done()
    expect([c.limits, c.domains, c.gpio, c.usb]).toEqual([[], [], [], []])
  })

  it('keeps a net label spelled "d1:A" apart from part d1 pin A', () => {
    const d = sheet(
      [{ uid: 'd1', module: 'led' }, { uid: 'r1', module: 'resistor' }, { uid: 'r2', module: 'resistor' }, { uid: 'l1', module: 'net-label', values: { net: 'd1:A' } }],
      [['r1.1', 'l1.NET'], ['r2.1', 'l1.NET']],
    )
    const c = buildCircuit(d)
    const tap = (node: string) => c.taps.find((t) => t.node === node)!
    expect([tap('r1:1').net, tap('d1:A').net]).toEqual(['d1:A', 'D1_A'])
    expect(c.pinNet[JSON.stringify(['r1', '1'])]).toBe('d1:A')
    const b = new Builder(d, {})
    expect(b.node('r1', '1')).toBe(netNode('d1:A'))
    const nodes = new Set(c.taps.map((t) => t.node))
    expect(c.taps.filter((t) => nodes.has(netNode(t.net)))).toEqual([])
  })

  it('skips a resistor or voltage source with no value (only an explicit 0 ohm is a jumper)', () => {
    const bare = (model: string, terminals: Record<string, string>): ModuleDef => ({
      format: 'circuitoon-module/1', id: `bare-${model}`, name: model, pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }], electrical: { model, terminals },
    })
    const c = buildCircuit(sheet([{ uid: 'r1', module: bare('resistor', { a: '1', b: '2' }) }, { uid: 'v1', module: bare('voltage_source', { pos: '1', neg: '2' }) }], []))
    expect([c.devices, c.taps, c.parts]).toEqual([[], [], {}])
    expect(c.unsimulated).toEqual([{ part: 'r1', reason: 'no resistance value' }, { part: 'v1', reason: 'no voltage value' }])
  })
})

describe('buildCircuit: net names shared with extract and KiCad (spec 2, fix wave finding 6)', () => {
  it('gives a labelled net, GND and the 3V3 rail the same name in the simulator, extract and KiCad', () => {
    const d = sheet([
      { uid: 'u1', module: 'esp32-devkit-v1-30' }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 330, unit: 'ohm' } } }, { uid: 'd1', module: 'led' },
      { uid: 'l1', module: 'net-label', values: { net: 'LED_SIG' } }, { uid: 'l2', module: 'net-label', values: { net: 'LED_SIG' } },
    ], [['u1.3V3', 'r1.1'], ['r1.2', 'l1.NET'], ['l2.NET', 'd1.A'], ['d1.K', 'u1.GND']])
    const sim = buildCircuit(d).pinNet
    const at = (uid: string, pin: string) => sim[JSON.stringify([uid, pin])]
    const extract = new Set(sheetNets(d).nets.map((n) => n.name))
    const kicad = new Set(checkKicadNetlist(toKicadNetlist(d, { library: libraryLookup }).text).nets.map((n) => n.name))
    expect([at('r1', '2'), at('d1', 'A'), at('d1', 'K'), at('r1', '1')]).toEqual(['LED_SIG', 'LED_SIG', 'GND', '3V3'])
    for (const name of ['LED_SIG', 'GND', '3V3']) {
      expect(extract.has(name)).toBe(true)
      expect(kicad.has(name)).toBe(true)
    }
  })
})
