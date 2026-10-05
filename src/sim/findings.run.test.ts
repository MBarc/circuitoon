// Spec 5.2 value codes, each both ways, against the real engine; spec 4.2's upstream marking; 4.5's
// corners; and the examples the spec gives: an LED on 5 V with no resistor is a "likely damage"
// warning; a GPIO sinking over its limit; brownout and dropout blocking on datasheet values but
// only warning on estimates; an AMS1117-like LDO on 3xAA in dropout at peak only.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { classify } from './floating.ts'
import { analyseFindings } from './findings.ts'
import type { Corner } from './model.ts'
import type { RawRun } from './spice.ts'
import { boardModule, boostModule, cellModule, hostModule, ldoModule, q, sheet } from './testing.ts'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
async function analyse(d: Diagram) {
  const c = buildCircuit(d)
  const cls = classify(c)
  const raws = {} as Record<Corner, RawRun>
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, 1)
    if (r.status !== 'ok') throw new Error(JSON.stringify(r))
    raws[corner] = r.raw
  }
  return analyseFindings(c, cls, raws)
}
const of = (r: Awaited<ReturnType<typeof analyse>>, code: string) => r.findings.filter((f) => f.code === code)
/**
 * For the two edge-of-enable cases: the pinned finding, or the solver giving up (sim-no-convergence)
 * on a state real undervoltage lockout never holds. Either is accepted; the test logs which, and the
 * implementer records it in the ledger.
 */
async function analyseOrFailure(d: Diagram): Promise<Awaited<ReturnType<typeof analyse>> | 'no-convergence'> {
  const c = buildCircuit(d)
  const cls = classify(c)
  const raws = {} as Record<Corner, RawRun>
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, 1)
    if (r.status === 'failed') return 'no-convergence'
    if (r.status !== 'ok') throw new Error(JSON.stringify(r))
    raws[corner] = r.raw
  }
  return analyseFindings(c, cls, raws)
}
const board = (values: Record<string, unknown> = {}, vin = 5, rint = 0.05, mod = boardModule()) =>
  sheet([{ uid: 'bt1', module: cellModule(vin, rint) }, { uid: 'u1', module: mod, values }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']])

describe('value findings', () => {
  it('an LED on 5 V with no resistor: over its representative absolute maximum, a "likely damage" warning only', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'd1', module: 'led' }], [['bt1.+', 'd1.A'], ['d1.K', 'bt1.-']]))
    const [f] = of(r, 'sim-over-abs-max')
    expect(f).toMatchObject({ severity: 'warning', basis: 'representative', corner: 'typical', parts: ['d1'] })
    expect(f.message).toMatch(/^Likely: D1 carries .* absolute maximum: damage is likely\./)
    expect(of(r, 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('a resistor over its power rating, and quiet at a sensible value', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', ohms)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])
    expect(of(await analyse(d(10)), 'sim-over-limit')).toEqual([expect.objectContaining({ severity: 'warning', parts: ['r1'], basis: 'representative' })])
    expect(of(await analyse(d(1000)), 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('a GPIO sinking over its datasheet limit, and quiet through 1 k', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'low' } }, { uid: 'bt2', module: cellModule(5, 0.05, 'cell-b') }, R('r1', ohms)],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['bt2.+', 'r1.1'], ['r1.2', 'u1.IO1'], ['bt2.-', 'u1.GND']])
    const [f] = of(await analyse(d(150)), 'sim-over-limit')
    expect(f).toMatchObject({ severity: 'warning', basis: 'datasheet', parts: ['u1'] })
    expect(f.message).toMatch(/^U1 IO1 carries 27\.\d mA, above its 20 mA rating\.$/)
    expect(of(await analyse(d(1000)), 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('brownout and dropout block on datasheet values, and are "likely" warnings on estimates; quiet on 5 V', async () => {
    const sourced = await analyse(board({}, 3.3, 0.05, boardModule({ minVolts: 3.0 })))
    expect(of(sourced, 'sim-brownout')[0]).toMatchObject({ severity: 'error', basis: 'datasheet', corner: 'typical' })
    expect(of(sourced, 'sim-dropout')[0]).toMatchObject({ severity: 'error', basis: 'datasheet' })
    const estimated = await analyse(board({}, 3.3))
    const b = of(estimated, 'sim-brownout')[0]
    expect(b).toMatchObject({ severity: 'warning', basis: 'estimate' })
    expect(b.message).toMatch(/^Likely: /)
    const fine = await analyse(board())
    expect([...of(fine, 'sim-brownout'), ...of(fine, 'sim-dropout')]).toEqual([])
  }, 60_000)
  it('an LDO on 3xAA (4.5 V) in dropout at peak only: a warning labelled with the peak', async () => {
    const r = await analyse(board({}, 4.5, 0.45))
    const d = of(r, 'sim-dropout')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ corner: 'peak', severity: 'warning' })
    expect(d[0].message).toMatch(/^At peak \(radio\): /)
  }, 60_000)
  it('a boost below its input range while a board expects power is off; quiet in range', async () => {
    const d = (vin: number, rint = 0.01) => sheet([{ uid: 'bt1', module: cellModule(vin, rint) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule() }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']])
    const off = of(await analyse(d(2.5)), 'sim-converter-off')
    expect(off[0]).toMatchObject({ severity: 'error', basis: 'datasheet' })
    expect(off[0].message).toContain('is off')
    expect(of(await analyse(d(3.7)), 'sim-converter-off')).toEqual([])
  }, 60_000)
  it('an input at the edge of the enable window: outside the model, upstream marked (spec 4.2), or no convergence', async () => {
    const r = await analyseOrFailure(sheet([{ uid: 'bt1', module: cellModule(2.875, 1e-6) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule() }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']]))
    console.info(`ledger: edge of enable gave ${r === 'no-convergence' ? 'sim-no-convergence' : 'the pinned finding'}`)
    if (r === 'no-convergence') return
    expect(of(r, 'sim-converter-off').some((f) => f.message.includes('edge of its range'))).toBe(true)
    expect(r.outside.rails.has('u1.rail.boost')).toBe(true)
    expect(r.outside.nets.has('BT1_+')).toBe(true)
    expect(r.outside.parts.has('bt1')).toBe(true)
  }, 60_000)
  it('an overloaded weak battery settles at the edge of the enable window, which is flagged (spec 4.2), or no convergence', async () => {
    const r = await analyseOrFailure(sheet([{ uid: 'bt1', module: cellModule(3.2, 1) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.4, unit: 'A' } } }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']]))
    console.info(`ledger: weak battery gave ${r === 'no-convergence' ? 'sim-no-convergence' : 'the pinned finding'}`)
    if (r === 'no-convergence') return
    expect(of(r, 'sim-converter-off').some((f) => f.message.includes('edge of its range'))).toBe(true)
  }, 60_000)
  it('a boost under its minimum load warns, and does not above it', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.01) }, { uid: 'u1', module: boostModule({ minLoad: { amps: q(0.05, 'A'), note: 'it shuts itself off after 32 s' } }) }, R('r1', ohms)],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']])
    const [f] = of(await analyse(d(1000)), 'sim-min-load')
    expect(f).toMatchObject({ severity: 'warning' })
    expect(f.message).toContain('it shuts itself off after 32 s')
    expect(of(await analyse(d(50)), 'sim-min-load')).toEqual([])
  }, 60_000)
  it('an LDO past ioutMax is outside its model and over its rating, and marks upstream readings', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }, R('r1', 3)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(of(r, 'sim-outside-model')).toHaveLength(1)
    expect(of(r, 'sim-over-limit').some((f) => f.message.includes('U1 OUT regulator supplies'))).toBe(true)
    expect([...r.outside.nets].sort()).toEqual(expect.arrayContaining(['BT1_+', 'U1_OUT']))
    expect(r.outside.parts.has('bt1')).toBe(true)
  }, 60_000)
  it('a USB host port asked for more than it gives', async () => {
    const r = await analyse(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.6, unit: 'A' } } }], [['h1.USB', 'u1.USB']]))
    expect(of(r, 'sim-over-limit').some((f) => f.message.includes('over USB to U1'))).toBe(true)
  }, 60_000)
  it('a board behind an open switch, ground shared: not powered, naming the switch (ruling R30)', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1' }, { uid: 'u1', module: boardModule() }],
      [['bt1.+', 's1.1'], ['s1.2', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    const [f] = of(r, 'sim-brownout')
    expect(f).toMatchObject({ severity: 'warning', basis: 'topology', parts: ['u1', 's1'] })
    expect(f.message).toBe('U1 3V3 is not powered in the current state: S1 is open. Set S1 to its operating position to simulate U1 running.')
  }, 60_000)
  it('a shorted LDO output: the short, over its rating and outside its model, its voltages and upstream marked', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u1.GND']]))
    expect(of(r, 'sim-short')).toHaveLength(1)
    expect(of(r, 'sim-outside-model')).toHaveLength(1)
    expect(of(r, 'sim-over-limit').some((f) => f.message.includes('U1 OUT regulator supplies'))).toBe(true)
    expect(r.outside.rails.has('u1.rail.ldo')).toBe(true)
    expect(r.outside.nets.has('BT1_+')).toBe(true)
    expect([...r.outside.parts].sort()).toEqual(['bt1', 'u1'])
  }, 60_000)
  it('a board behind an open low-side switch: not powered, naming the switch (ruling R30)', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1' }, { uid: 'u1', module: boardModule() }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 's1.1'], ['s1.2', 'u1.GND']]))
    expect(of(r, 'sim-brownout')[0]).toMatchObject({ severity: 'warning', basis: 'topology', parts: ['u1', 's1'] })
  }, 60_000)
  it('phantom power: a GPIO high into the input-pullup of another board back-powers it, a brownout, never an open switch', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high' } }, { uid: 'u2', module: boardModule(), values: { 'gpio.IO1': 'input-pullup' } }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'u2.IO1'], ['u2.GND', 'u1.GND']]))
    const b = of(r, 'sim-brownout').filter((f) => f.parts.includes('u2'))
    expect(b.length).toBeGreaterThan(0)
    expect(b.every((f) => f.basis !== 'topology' && f.message.includes('browns out'))).toBe(true)
  }, 60_000)
  it('an unplugged board: not powered, a topology warning that never blocks (ruling R30)', async () => {
    const r = await analyse(sheet([{ uid: 'u1', module: boardModule() }], []))
    const [f] = of(r, 'sim-brownout')
    expect(f).toMatchObject({ severity: 'warning', basis: 'topology' })
    expect(f.message).toContain('is not powered in the current state')
    expect(r.findings.some((x) => x.severity === 'error')).toBe(false)
  }, 60_000)
})

// After Phase C: the same rules on the sourced modules (spec 9 findings list).
describe('value findings on the sourced modules', () => {
  it('the IP5306 module under its sourced minimum load warns', async () => {
    const boost = simOf(load('ip5306-usbc-module'))!.power!.rails!.find((x) => x.kind === 'boost')!
    // A load drawing a fifth of the minimum load at the boost's output voltage.
    const ohms = boost.vout!.value / (boost.minLoad!.amps.value / 5)
    const r = await analyse(sheet([{ uid: 'bt1', module: 'battery-18650-holder' }, { uid: 'u5', module: 'ip5306-usbc-module' }, R('r1', ohms)],
      [['bt1.+', 'u5.B+'], ['bt1.-', 'u5.B-'], ['u5.5V+', 'r1.1'], ['r1.2', 'u5.5V-']]))
    expect(of(r, 'sim-min-load').some((f) => f.parts.includes('u5') && f.severity === 'warning')).toBe(true)
  }, 60_000)
  it('an ESP32 DevKit on 3xAAA through the AMS1117 module: dropout at peak is a warning; at typical its severity follows its basis', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: 'battery-holder-3xaaa' }, { uid: 'u2', module: 'ams1117-33-module' }, { uid: 'u1', module: 'esp32-devkit-v1-30' }],
      [['bt1.+', 'u2.VIN'], ['bt1.-', 'u2.GND'], ['u2.OUT', 'u1.3V3'], ['u2.GND', 'u1.GND']]))
    const d = of(r, 'sim-dropout').find((f) => f.parts.includes('u2'))
    expect(d).toBeDefined()
    // The DevKit's own LDO, backfed through its 3V3 pin, delivers nothing: never in dropout.
    expect(of(r, 'sim-dropout').filter((f) => f.parts.includes('u1'))).toEqual([])
    if (d!.corner === 'peak') expect(d!.severity).toBe('warning')
    else expect(d!.severity).toBe(['datasheet', 'user', 'topology'].includes(d!.basis) ? 'error' : 'warning')
  }, 60_000)
})
