// Spec 4.3 and 9 against the real engine: LED accuracy, a battery's sag, and for each of the LDO,
// buck and boost: dead input, the threshold edges, an output short (the input pays for it),
// backfeed above vout, two in parallel on one output, and power conservation within 1 %; plus
// boost pass-through, battery -> LDO -> GPIO -> LED and battery -> host -> USB cable -> device
// conserving current, and a dead-rail load drawing nothing.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { ledHandCalc, ledModel } from './ledModels.ts'
import { type Corner, netNode } from './model.ts'
import type { RawRun } from './spice.ts'
import { type PartSpec, boardModule, q, boostModule, buckModule, cellModule, hostModule, ldoModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

async function solve(d: Diagram, corner: Corner = 'typical'): Promise<RawRun> {
  const r = await engine.run(buildCircuit(d), { kind: 'op', corner }, 1)
  if (r.status !== 'ok') throw new Error(`solve: ${JSON.stringify(r)}`)
  return r.raw
}
const I = (raw: RawRun, part: string, pin: string) => raw.pins[part]?.[pin] ?? 0
const R = (uid: string, ohms: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
const near = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-9))

/** A cell into a regulator, the regulator into a load (or a short), plus extra parts and wires. */
function rig(reg: ModuleDef, vin: number, load: number, more: { parts?: PartSpec[]; wires?: [string, string][] } = {}): Diagram {
  return sheet([{ uid: 'bt1', module: cellModule(vin, 0.01) }, { uid: 'u1', module: reg }, R('r1', load), ...(more.parts ?? [])],
    [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND'], ...(more.wires ?? [])])
}
const OUT = netNode('U1_OUT')
const IN = netNode('BT1_+')

describe('accuracy (spec 9)', () => {
  it('LED + 150 ohm + 5 V puts the anode at the hand calculation, 2.0008 V within 1 mV', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']]))
    const anode = raw.v[netNode('D1_A')]
    expect(Math.abs(anode - ledHandCalc(5, 150 + 1e-6, ledModel('red', 2).model).anode)).toBeLessThan(1e-5)
    expect(Math.abs(anode - 2.0008)).toBeLessThan(1e-3)
  }, 60_000)
  it('a battery under load sags by its rInternal, and read() signs delivered current positive', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    expect(raw.v[IN]).toBeCloseTo((3.7 * 10) / 10.05, 6)
    // Task 13 review: a cell delivering current reads positive delivered.
    expect(raw.dev['bt1.cell']).toBeCloseTo(3.7 / 10.05, 6)
  }, 60_000)
})

// `open` is the module for the short and the off edges: a boost's pass-through diode (offPath
// 'diode') carries a short straight from the input and the input sags below vinMin, so the
// converter is off (pinned in the pass-through block below), and it holds an "off" output one diode
// drop under the input; the rail's own short and off edges are the boost without that path.
// `on` pairs are [vin, the model's V(out)]: the LDO at its edge sits k ln 2 (3.5 mV) under vout plus
// the 10 mA x 0.1 ohm rout drop; at 4.0 V the 88 mA load drops 8.8 mV across rout below 4.0 - 1.1;
// the buck's 0.5 A drops 50 mV; the boost's 0.2 A drops 20 mV.
const boostOpen = () => boostModule({ offPath: 'open' }, 'test-boost-open')
const buckIq = () => buckModule({ iq: q(0.005, 'A') }, 'test-buck-iq')
const KINDS = [
  { kind: 'LDO', mod: ldoModule, open: ldoModule, id: 'u1.rail.ldo', vin: 5, vout: 3.3, load: 33, on: [[4.4, 3.3 - 0.0135], [4.0, 2.9 - 0.0088]], off: [] as number[] },
  { kind: 'buck', mod: buckIq, open: buckIq, id: 'u1.rail.buck', vin: 12, vout: 5, load: 10, on: [[6.1, 5 - 0.05], [23.9, 5 - 0.05]], off: [5.9, 24.1] },
  { kind: 'boost', mod: boostModule, open: boostOpen, id: 'u1.rail.boost', vin: 3.7, vout: 5, load: 25, on: [[2.95, 5 - 0.02]], off: [2.85, 4.35] },
] as const

describe.each(KINDS)('the $kind model (spec 4.3)', ({ mod, open, id, vin, vout, load, on, off }) => {
  it('dead input: no output and no negative node', async () => {
    const raw = await solve(rig(mod(), 0, load))
    expect(raw.v[OUT]).toBeLessThan(0.05)
    for (const v of Object.values(raw.v)) expect(v).toBeGreaterThan(-1e-3)
  }, 60_000)
  it('input at each threshold edge', async () => {
    for (const [v, want] of on) expect(Math.abs((await solve(rig(mod(), v, load))).v[OUT] - want)).toBeLessThan(0.005)
    for (const v of off) expect((await solve(rig(open(), v, load))).v[OUT]).toBeLessThan(0.05)
  }, 60_000)
  it('output shorted: it converges and the input pays for the short, rout included', async () => {
    const raw = await solve(rig(open(), vin, 0))
    const iout = raw.dev[id]
    expect(iout).toBeGreaterThan(5)
    const pin = raw.v[IN] * I(raw, 'u1', 'IN')
    expect(pin).toBeGreaterThanOrEqual(iout * iout * 0.1 * 0.99)
  }, 60_000)
  it('output backfed above vout: it neither sinks nor fights', async () => {
    const raw = await solve(rig(mod(), vin, load, { parts: [{ uid: 'bt2', module: cellModule(6, 0.01, 'cell-b') }, R('r2', 1)], wires: [['bt2.+', 'r2.1'], ['r2.2', 'u1.OUT'], ['bt2.-', 'u1.GND']] }))
    // Off reads as solver zero: the boost gives -3e-82 A, so "never sinks" is > -1 pA, not >= 0.
    expect(raw.dev[id]).toBeGreaterThan(-1e-12)
    expect(raw.dev[id]).toBeLessThan(1e-3)
    // Nothing flows back out of the input either (every rail here blocks reverse current). The boost's
    // pass-through Schottky, reverse biased, leaks its IS (0.25 uA, measured -2.53e-7 A), so 0.3 uA there.
    expect(I(raw, 'u1', 'IN')).toBeGreaterThanOrEqual(mod === boostModule ? -3e-7 : -1e-9)
  }, 60_000)
  it('two in parallel on one output share the load', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(vin, 0.01) }, { uid: 'u1', module: mod() }, { uid: 'u2', module: mod() }, R('r1', 10)],
      [['bt1.+', 'u1.IN'], ['bt1.+', 'u2.IN'], ['bt1.-', 'u1.GND'], ['bt1.-', 'u2.GND'], ['u1.OUT', 'u2.OUT'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    const [a, b] = [raw.dev[id], raw.dev[id.replace('u1', 'u2')]]
    expect(a).toBeGreaterThan(0.05)
    expect(b).toBeGreaterThan(0.05)
    near(a + b, raw.v[OUT] / 10)
    expect(Math.abs(raw.v[OUT] - vout)).toBeLessThan(0.05)
  }, 60_000)
  it('conserves power: input = output + losses, within 1 %', async () => {
    const raw = await solve(rig(mod(), vin, load))
    const m = buildCircuit(rig(mod(), vin, load)).devices.find((d) => d.id === id)!
    if (m.kind !== 'rail') throw new Error('no rail')
    const iout = raw.dev[id]
    // A rail output reads positive delivered (Task 13 review).
    expect(iout).toBeGreaterThan(0)
    const vctl = raw.v[m.ctl] - raw.v[m.ret]
    const pin = raw.v[IN] * I(raw, 'u1', 'IN')
    const pout = raw.v[OUT] * iout
    const eff = m.rail.efficiency?.value ?? 1
    const iq = m.rail.iq.value * raw.v[IN]
    const losses = m.rail.kind === 'ldo' ? (raw.v[IN] - raw.v[OUT]) * iout + iq : vctl * iout * (1 / eff - 1) + (vctl - raw.v[OUT]) * iout + iq
    near(pin, pout + losses)
  }, 60_000)
})

describe('pass-through and whole chains (spec 4.2, 4.6, 4.7)', () => {
  it('a dead-input LDO creates no energy: its output power is at most its input power', async () => {
    const raw = await solve(rig(ldoModule(), 0, 33))
    const pout = raw.v[OUT] * raw.dev['u1.rail.ldo']
    const pin = raw.v[IN] * I(raw, 'u1', 'IN')
    // Before the ruling the softplus floor pushed k ln 2 / rout into the load: 1.4e-5 W measured here from a 0 V input.
    expect(pout).toBeLessThanOrEqual(pin + 1e-12)
  }, 60_000)
  it('a disabled boost passes its input through a diode drop (pass-through)', async () => {
    const v = (await solve(rig(boostModule(), 2.5, 100))).v[OUT]
    expect(v).toBeGreaterThan(1.8)
    expect(v).toBeLessThan(2.5)
  }, 60_000)
  it.each([0.5, 0.3])('a boost with pass-through on a weak cell (%s ohm) under a 2 A load converges to the edge state (fix wave, finding 2)', async (ohms) => {
    // 3.7 V cannot deliver 11 W through this rInternal, so the converter settles at its undervoltage
    // edge (Task 28 flags it). Before the fix this failed op ("timestep too small").
    const d = (offPath: 'diode' | 'open') => sheet([{ uid: 'bt1', module: cellModule(3.7, ohms) }, { uid: 'u1', module: boostModule({ offPath }, `test-boost-${offPath}`) }, R('r1', 2.5)],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']])
    const raw = await solve(d('diode'))
    expect(raw.v[IN]).toBeGreaterThan(2.85)
    expect(raw.v[IN]).toBeLessThan(2.9)
    // The pass-through is reverse biased there, so it is the same state as without it.
    const open = await solve(d('open'))
    near(raw.v[OUT], open.v[OUT], 0.001)
    expect(raw.v[OUT]).toBeGreaterThan(raw.v[IN] - 0.35)
  }, 60_000)
  it('a shorted boost output with pass-through: the input pays through the diode and the converter is off', async () => {
    const raw = await solve(rig(boostModule(), 3.7, 0))
    expect(I(raw, 'u1', 'IN')).toBeGreaterThan(5)
    near(I(raw, 'u1', 'IN'), raw.dev['bt1.cell'])
    expect(Math.abs(raw.dev['u1.rail.boost'])).toBeLessThan(1e-12)
    expect(raw.v[IN]).toBeLessThan(2.9)
  }, 60_000)
  it('a body diode carries backfeed to the input; a blocking LDO does not', async () => {
    const back = { parts: [{ uid: 'bt2', module: cellModule(5, 0.01, 'cell-b') }, R('r2', 1)], wires: [['bt2.+', 'r2.1'], ['r2.2', 'u1.OUT'], ['bt2.-', 'u1.GND']] as [string, string][] }
    expect(I(await solve(rig(ldoModule({ reverse: 'body-diode' }, 'test-ldo-body'), 3, 100, back)), 'u1', 'IN')).toBeLessThan(-0.5)
    expect(I(await solve(rig(ldoModule(), 3, 100, back)), 'u1', 'IN')).toBeGreaterThan(0)
  }, 60_000)
  it('battery -> LDO -> GPIO high -> LED: the battery covers the LED, the draw and iq', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(5, 0.01) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high' } }, R('r1', 150), { uid: 'd1', module: 'led' }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND']]))
    const delivered = -I(raw, 'bt1', '+')
    expect(I(raw, 'd1', 'A')).toBeGreaterThan(0.005)
    near(delivered, I(raw, 'd1', 'A') + 0.05 + 0.005)
  }, 60_000)
  it('battery -> host rail -> USB cable -> device: the host delivers what the device takes, through both conductors', async () => {
    const d = sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']])
    const raw = await solve(d)
    // A rail output reads positive delivered (Task 13 review): the host source here, a cell device.
    near(raw.dev['h1.source'], 0.05 + 0.005)
    const c = buildCircuit(d)
    const flow = (id: string) => {
      const r = c.devices.find((x) => x.id === id)
      if (r?.kind !== 'resistor') throw new Error(`no ${id}`)
      return (raw.v[r.a] - raw.v[r.b]) / r.ohms.value
    }
    const vbus = flow(c.usb[0].vbus)
    near(vbus, raw.dev['h1.source'])
    near(-flow(c.usb[0].gnd), vbus)
  }, 60_000)
  it('battery -> host rail -> USB cable -> device: the cell pays for the device through both conductors (spec 4.7)', async () => {
    // A host whose USB port is the output of a `ron` switch rail from VIN, fed by a cell.
    const host: ModuleDef = {
      format: 'circuitoon-module/1', id: 'test-host-railed', name: 'test-host-railed',
      pins: [{ name: 'VIN', type: 'power_in', side: 'left' }, { name: 'GND', type: 'ground', side: 'left' },
        { name: 'USB', type: 'usb', side: 'right', usb: { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', source: 500 } }],
      electrical: { model: 'computer', sim: { usbPorts: { USB: { gnd: 'GND' } }, power: {
        domains: [{ name: 'VIN', pin: 'VIN', ret: 'GND', nominal: 5 }, { name: 'USB', pin: 'USB#vbus', ret: 'USB#gnd', nominal: 5 }],
        rails: [{ id: 'usb', inputs: [{ domain: 'VIN', via: 'direct' }], output: 'USB', kind: 'switch', ron: q(0.2, 'ohm'), reverse: 'blocks' }],
      } } },
    }
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'h1', module: host }, { uid: 'u1', module: boardModule() }],
      [['bt1.+', 'h1.VIN'], ['bt1.-', 'h1.GND'], ['h1.USB', 'u1.USB']])
    const c = buildCircuit(d)
    const raw = await solve(d)
    const draw = 0.05 + 0.005
    near(raw.dev['bt1.cell'], draw)
    const dev = (id: string) => {
      const r = c.devices.find((x) => x.id === id)
      if (r?.kind !== 'resistor') throw new Error(`no ${id}`)
      return { ...r, amps: (raw.v[r.a] - raw.v[r.b]) / r.ohms.value }
    }
    const [vbus, gnd] = [dev(c.usb[0].vbus), dev(c.usb[0].gnd)]
    near(vbus.amps, draw)
    near(-gnd.amps, draw)
    // The device's port sees the cell less its rInternal, the 1 mOhm rail input, ron and both conductors.
    const drop = draw * (0.05 + 0.001 + 0.2 + vbus.ohms.value + gnd.ohms.value)
    near(raw.v[vbus.b] - raw.v[gnd.b], 5 - drop, 0.001)
  }, 60_000)
  it('a load on a dead rail draws (almost) nothing', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(0, 0.01) }, { uid: 'u1', module: boardModule() }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    // Measured 1.1e-18 A: the rail output and the load fold-back are exactly 0 at 0 V (Task 15 ruling).
    expect(Math.abs(I(raw, 'u1', 'VIN'))).toBeLessThan(1e-6)
  }, 60_000)
})
