// Spec 3.2, 3.3, 4.6, 4.7: a board's domains, its draw as a voltage-aware load, its rails with the
// spec's defaults, its GPIO states, an external source, the USB cable between a host and a device,
// and the cases that are not simulated (hub, host without data, incomplete rail).
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { boardModule, cellModule, hostModule, ldoModule, q, sheet } from './testing.ts'
import type { Device } from './model.ts'
import type { ModuleDef } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'

const byId = (devs: Device[], id: string) => devs.find((d) => d.id === id)

describe('power models', () => {
  it('records domains, a voltage-aware load with the 90 % minVolts default, and both rails with defaults', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule() }], []))
    expect(c.domains.map((d) => `${d.name}:${d.pin}/${d.ret}`)).toEqual(['VIN:u1:VIN/u1:GND', 'USB:u1:USB#vbus/u1:GND', '3V3:u1:3V3/u1:GND'])
    const load3 = byId(c.devices, 'u1.draw.3V3')!
    expect(load3.kind === 'load' && [load3.typical.value, load3.peak.value, load3.peakNote, load3.minVolts.value, load3.minVolts.basis]).toEqual([0.05, 0.25, 'radio', 0.9 * 3.3, 'estimate'])
    const ldo = byId(c.devices, 'u1.rail.ldo')!
    expect(ldo.kind === 'rail' && [ldo.in, ldo.out, ldo.ret, ldo.rail.rout.value, ldo.rail.rout.basis, ldo.rail.offPath]).toEqual(['u1.rail.ldo#in', 'u1:3V3', 'u1:GND', 0.1, 'estimate', 'open'])
    expect(byId(c.devices, 'u1.rail.ldo.in.VIN')).toMatchObject({ kind: 'resistor', role: 'rail-input', a: 'u1:VIN', b: 'u1.rail.ldo#in' })
    expect(byId(c.devices, 'u1.rail.usb-diode')).toMatchObject({ kind: 'diode', role: 'switch-rail', k: 'u1:VIN' })
  })
  it('takes a user override of the draw, marked user', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.12, unit: 'A' } } }], []))
    const l = byId(c.devices, 'u1.draw.3V3')!
    expect(l.kind === 'load' && [l.typical.value, l.typical.basis]).toEqual([0.12, 'user'])
  })
  it('uses the category estimate on a board with domains and no draw', () => {
    const m: ModuleDef = { ...boardModule({ draw: false }), id: 'test-esp32-board' }
    const c = buildCircuit(sheet([{ uid: 'u1', module: m }], []))
    const l = byId(c.devices, 'u1.draw.VIN')!
    expect(l.kind === 'load' && [l.typical.value, l.typical.basis]).toEqual([0.08, 'estimate'])
  })
  it('compiles GPIO states from the real IO domain node (spec 4.6)', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high', 'gpio.IO2': 'input-pulldown' } }], []))
    expect(byId(c.devices, 'u1.gpio.IO1')).toMatchObject({ kind: 'resistor', role: 'gpio', a: 'u1:3V3', b: 'u1:IO1' })
    expect(byId(c.devices, 'u1.gpio.IO2')).toMatchObject({ kind: 'resistor', role: 'pull', a: 'u1:IO2', b: 'u1:GND' })
    expect(c.gpio.map((g) => `${g.pin}:${g.state}`)).toEqual(['IO1:high', 'IO2:input-pulldown'])
    const low = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'low' } }], []))
    expect(byId(low.devices, 'u1.gpio.IO1')).toMatchObject({ a: 'u1:IO1', b: 'u1:GND' })
  })
  it('joins a host and a device by a cable on both conductors, with the host port limit', () => {
    const c = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']]))
    expect(byId(c.devices, 'h1.source')).toMatchObject({ kind: 'cell', role: 'external', p: 'h1:USB#vbus', n: 'h1:USB#gnd' })
    expect(byId(c.devices, 'usb.w1.vbus')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'h1:USB#vbus', b: 'u1:USB#vbus' })
    expect(byId(c.devices, 'usb.w1.gnd')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'h1:USB#gnd', b: 'u1:GND' })
    expect(c.usb).toEqual([expect.objectContaining({ host: 'h1', device: 'u1', limit: expect.objectContaining({ value: 0.5, basis: 'datasheet' }) })])
  })
  it('lets an external source sim.imax override replace its sourceCurrent limit, as user', () => {
    const h = hostModule()
    const withLimit: ModuleDef = { ...h, electrical: { ...(h.electrical as object), sim: { ...(h.electrical as { sim: object }).sim, limits: [{ of: { part: true }, kind: 'sourceCurrent', value: 0.5, provenance: 'datasheet', source: 'https://example.com/x' }] } } }
    const c = buildCircuit(sheet([{ uid: 'h1', module: withLimit, values: { 'sim.imax': { value: 1, unit: 'A' } } }], []))
    const s = byId(c.devices, 'h1.source')!
    expect(s.kind === 'cell' && [s.imax?.value, s.imax?.basis]).toEqual([1, 'user'])
    expect(c.limits.map((l) => [l.kind, l.value.value, l.value.basis])).toEqual([['sourceCurrent', 1, 'user']])
  })
  it('takes a param:voltage source from the part value, and skips the part when it has none', () => {
    const h = hostModule()
    const e = h.electrical as { sim: { power: { source: object } } }
    const m = (dflt: number | null): ModuleDef => ({ ...h, electrical: { ...e, params: { voltage: { unit: 'V', default: dflt } }, sim: { ...e.sim, power: { ...e.sim.power, source: { ...e.sim.power.source, voltage: 'param:voltage' } } } } })
    const s = byId(buildCircuit(sheet([{ uid: 'h1', module: m(9) }], [])).devices, 'h1.source')!
    expect(s.kind === 'cell' && [s.volts.value, s.volts.basis]).toEqual([9, 'user'])
    const none = buildCircuit(sheet([{ uid: 'h1', module: m(null) }], []))
    expect([none.devices, none.domains, none.unsimulated]).toEqual([[], [], [{ part: 'h1', reason: 'no voltage value' }]])
  })
  it('does not simulate USB power from a host with no power data, or through a hub (ruling R7)', () => {
    const c = buildCircuit(sheet([{ uid: 'j1', module: 'computer-usb-port' }, { uid: 'u1', module: boardModule() }], [['j1.USB', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered from J1 over USB, which has no power data' })
    // P1 is a downstream (host-role) port of the hub.
    const h = buildCircuit(sheet([{ uid: 'x1', module: 'usb-hub-powered-4port' }, { uid: 'u1', module: boardModule() }], [['x1.P1', 'u1.USB']]))
    expect(h.unsimulated).toContainEqual({ part: 'u1', reason: 'powered through a hub: not simulated yet' })
  })
  it('lists a part whose rail lacks a required field, naming it (spec 3.1)', () => {
    const bad = ldoModule({ dropout: undefined }, 'test-bad-ldo')
    const c = buildCircuit(sheet([{ uid: 'u1', module: bad }, { uid: 'bt1', module: cellModule(5, 0.1) }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'incomplete power data: rail ldo needs dropout' })
  })
  it('lists an output-only GPIO with no state set as not simulated (spec 3.3)', () => {
    const m = boardModule()
    const outOnly: ModuleDef = { ...m, id: 'test-out-only', pins: m.pins.map((p) => ('name' in p && p.name === 'IO2' ? { ...p, caps: { outputOnly: true as const } } : p)) }
    const c = buildCircuit(sheet([{ uid: 'u1', module: outOnly }], []))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'pin IO2: output-only pin with no state set' })
  })
  it('takes the AC-DC converter output as a source only when powered in the saved state', () => {
    const hlk = load('hlk-pm01')
    const withSource: ModuleDef = { ...hlk, electrical: { ...(hlk.electrical as object), sim: { power: { domains: [{ name: 'OUT', pin: '+Vo', ret: '-Vo', nominal: 5 }], source: { domain: 'OUT', voltage: q(5, 'V'), rInternal: q(0.1, 'ohm', 'estimate') } } } } }
    const parts = (values: Record<string, unknown>) => [{ uid: 'o1', module: 'outlet-us-5-15r-duplex' }, { uid: 's1', module: 'rocker-switch-kcd1', values }, { uid: 'p1', module: withSource }]
    const wires: [string, string][] = [['o1.L1', 's1.1'], ['s1.2', 'p1.AC 1'], ['o1.N1', 'p1.AC 2']]
    expect(byId(buildCircuit(sheet(parts({ 'contact.s': 'closed' }), wires)).devices, 'p1.source')).toMatchObject({ kind: 'cell', role: 'external' })
    const off = buildCircuit(sheet(parts({}), wires))
    expect(byId(off.devices, 'p1.source')).toBeUndefined()
    expect(off.notes.join(' ')).toContain('P1: its mains input is off')
  })
})
