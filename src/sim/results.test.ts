// Spec 5.1 and 4.4: readings mapped back to nets and parts, each voltage relative to its island's
// reference; floating nodes read "floating" (a probe on a source-less island included), mains reads
// "undefined"; per-pin currents (positive into the pin), power and LED state; the supply budget.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { classify } from './floating.ts'
import { ledHandCalc, ledModel } from './ledModels.ts'
import { basisOf, budget, probeReadings, readRun } from './results.ts'
import { FEEDBACK_LOAD, type RawRun } from './spice.ts'
import { boardModule, cellModule, ldoModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
async function solved(d: Diagram) {
  const c = buildCircuit(d)
  const cls = classify(c)
  const raws: Record<'typical' | 'peak', RawRun> = { typical: { v: {}, pins: {}, dev: {} }, peak: { v: {}, pins: {}, dev: {} } }
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, 1)
    if (r.status !== 'ok') throw new Error(JSON.stringify(r))
    raws[corner] = r.raw
  }
  return { c, cls, raws, run: readRun(c, cls, raws.typical) }
}

describe('readings', () => {
  const led = sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']])
  it('reads nets relative to the island reference, currents into pins, power and LED state', async () => {
    const { run } = await solved(led)
    const hand = ledHandCalc(5, 150, ledModel('red', 2).model)
    expect(run.nets.D1_A).toMatchObject({ kind: 'value', reference: 'GND', trust: 'ok' })
    expect(run.nets.D1_A.kind === 'value' && run.nets.D1_A.value).toBeCloseTo(hand.anode, 5)
    expect(run.parts.d1.pins.A).toMatchObject({ kind: 'value' })
    expect(run.parts.d1.pins.A.kind === 'value' && run.parts.d1.pins.A.value).toBeCloseTo(hand.amps, 6)
    expect(run.parts.r1.power.kind === 'value' && run.parts.r1.power.value).toBeCloseTo(hand.amps ** 2 * 150, 6)
    expect(run.parts.d1.state).toBe('lit')
    expect(run.parts.bt1.power.kind === 'value' && run.parts.bt1.power.value).toBeLessThan(0)
  }, 60_000)
  it('reads a capacitor-only plate and a source-less island as floating, probes included', async () => {
    const { c, raws, run } = await solved(sheet(
      [{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 100), { uid: 'c1', module: 'capacitor-ceramic' }, R('r8', 100), R('r9', 100)],
      [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1'], ['r8.1', 'r9.1'], ['r8.2', 'r9.2']],
    ))
    // The plate's pin node is tied for numerics, so the solver gives it a number; the classification says floating.
    expect(raws.typical.v['c1:2']).toBeTypeOf('number')
    expect(run.nets.C1_2).toEqual({ kind: 'floating' })
    expect(run.parts.c1.pins['2']).toMatchObject({ kind: 'indeterminate' })
    const probes = probeReadings([{ id: 'P1', at: { part: 'r8', pin: '1' } }, { id: 'P2', at: { part: 'r8' } }], c, { typical: run, peak: run })
    expect(probes[0].voltage?.typical).toEqual({ kind: 'floating' })
    expect(probes[1].part?.typical.power).toMatchObject({ kind: 'undefined' })
  }, 60_000)
  it('reads mains wiring as undefined, never a number', () => {
    const d = sheet([{ uid: 'o1', module: 'outlet-us-5-15r-duplex' }, { uid: 'p1', module: 'hlk-pm01' }], [['o1.L1', 'p1.AC 1'], ['o1.N1', 'p1.AC 2']])
    const c = buildCircuit(d)
    const run = readRun(c, classify(c), { v: {}, pins: {}, dev: {} })
    const net = c.pinNet[JSON.stringify(['o1', 'L1'])]
    expect(run.nets[net]).toEqual({ kind: 'undefined', why: 'mains wiring is not simulated' })
  })
  it('budgets each source, rail and domain with its limit and headroom', async () => {
    const { c, cls, raws } = await solved(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }, R('r1', 33)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    const b = budget(c, cls, raws)
    const rail = b.find((x) => x.kind === 'rail')!
    expect(rail.volts.typical.kind === 'value' && rail.volts.typical.value).toBeCloseTo(3.29, 1)
    expect(rail.limit).toEqual({ value: 0.8, kind: 'ioutMax', basis: 'datasheet' })
    // rout is the estimated default (ROUT_DEFAULT), so it lowers the row's basis.
    expect(rail.basis).toBe('estimate')
    expect(rail.headroom).toBeCloseTo(0.8 - 0.1, 1)
    const src = b.find((x) => x.kind === 'source')!
    expect(src.amps.typical.kind === 'value' && src.amps.typical.value).toBeGreaterThan(0.1)
    expect(src.limit).toMatchObject({ kind: 'sourceCurrent', value: 2 })
    expect(b.filter((x) => x.kind === 'domain').map((x) => x.label)).toEqual(['U1 IN', 'U1 OUT'])
  }, 60_000)
  it('reads a rail as delivered (its feedback load paid upstream), labels sources delivering, and gives switch rails no row', async () => {
    const { c, cls, raws } = await solved(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule({ draw: false }) }, R('r1', 33)], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.3V3', 'r1.1'], ['r1.2', 'u1.GND']]))
    const b = budget(c, cls, raws)
    expect(b.filter((x) => x.kind === 'rail').map((x) => x.id)).toEqual(['u1.rail.ldo'])
    const rail = b.find((x) => x.kind === 'rail')!
    const src = b.find((x) => x.kind === 'source')!
    expect(src.label).toBe('BT1 delivering')
    const v = rail.volts.typical.kind === 'value' ? rail.volts.typical.value : Number.NaN
    const out = rail.amps.typical.kind === 'value' ? rail.amps.typical.value : Number.NaN
    const inA = src.amps.typical.kind === 'value' ? src.amps.typical.value : Number.NaN
    // Delivered: the resistor plus the board's own 3V3 draw (an estimate here), never the feedback load.
    const dom = b.find((x) => x.label === 'U1 3V3')!.ownDraw!.typical
    expect(out).toBeCloseTo(v / 33 + (dom.kind === 'value' ? dom.value : Number.NaN), 5)
    expect(inA).toBeCloseTo(out + 0.005 + FEEDBACK_LOAD, 4)
    expect(b.find((x) => x.label === 'U1 USB')!.volts.typical).toEqual({ kind: 'floating' })
    // Domain rows: the current through the domain pin (VIN carries what the battery delivers), and the declared draw apart.
    const vin = b.find((x) => x.label === 'U1 VIN')!
    expect(vin.amps.typical.kind === 'value' && vin.amps.typical.value).toBeCloseTo(inA, 6)
    expect(vin.ownDraw?.typical).toEqual({ kind: 'value', value: 0, trust: 'ok' })
    const d3 = b.find((x) => x.label === 'U1 3V3')!
    expect(d3.amps.typical.kind === 'value' && d3.amps.typical.value).toBeCloseTo(v / 33, 6)
    expect(d3.ownDraw?.typical).toEqual(dom)
    // The board's IO1, IO2 and USB#vbus float, yet its power is a value: VIN in, less what 3V3 hands r1.
    const run = readRun(c, cls, raws.typical)
    expect(run.parts.u1.pins.IO1).toMatchObject({ kind: 'indeterminate' })
    const vv = vin.volts.typical.kind === 'value' ? vin.volts.typical.value : Number.NaN
    expect(run.parts.u1.power).toMatchObject({ kind: 'value', reference: 'GND' })
    expect(run.parts.u1.power.kind === 'value' && run.parts.u1.power.value).toBeCloseTo(vv * inA - v * (v / 33), 6)
  }, 60_000)
  it('takes the weakest provenance as the basis, user and datasheet alike', () => {
    expect(basisOf([])).toBe('topology')
    expect(basisOf([{ basis: 'user' }, { basis: 'datasheet' }])).toBe('datasheet')
    expect(basisOf([{ basis: 'user' }])).toBe('user')
    expect(basisOf([{ basis: 'datasheet' }, { basis: 'representative' }])).toBe('representative')
    expect(basisOf([{ basis: 'estimate' }, { basis: 'representative' }])).toBe('estimate')
  })
})
