// Firmware spec 4.2: with PWM pins a solve sends one text per run in one runAll; readings and LED glow
// are the duty-weighted average; findings are the union over every run, deduplicated by key, keeping
// the worst reading, so an LED with no resistor at 50 % still blocks; the peak corner is every PWM pin
// high and every PWM pin low; pins that share part of the circuit add pwm-approximate.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { solve } from './session.ts'
import { type PartSpec, boardModule, cellModule, q, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const ohm = (uid: string, v: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: v, unit: 'ohm' } } })
const board = (extra: PartSpec[], wires: [string, string][], u1 = boardModule()) =>
  sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: u1 }, ...extra], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])
const ledOn = (d: ReturnType<typeof board>, runPins: RunPins) => solve(d, engine, 1, { runPins })

describe('solving with PWM (spec 4.2)', () => {
  const lit = board([ohm('r1', 150), { uid: 'd1', module: 'led' }], [['u1.IO1', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND']])
  it('averages the LED current by duty, in one runAll of 2 typical and 2 peak runs', async () => {
    const full = await ledOn(lit, { u1: { IO1: 'high' } })
    const half = await ledOn(lit, { u1: { IO1: { pwm: 0.5 } } })
    if (full.outcome.status !== 'ok' || half.outcome.status !== 'ok') throw new Error('solve failed')
    const a = (o: typeof full.outcome) => (o.status === 'ok' ? o.result.corners.typical.parts.d1.pins.A : null)
    const iFull = a(full.outcome)!.kind === 'value' ? (a(full.outcome) as { value: number }).value : NaN
    const iHalf = a(half.outcome)!.kind === 'value' ? (a(half.outcome) as { value: number }).value : NaN
    expect(iHalf / iFull).toBeCloseTo(0.5, 2)
    expect(half.outcome.result.engine.runs).toBe(4)
    expect(half.outcome.result.pwm).toEqual({ pins: [{ part: 'u1', pin: 'IO1', duty: 0.5 }], runs: 4, approximate: false })
    expect(half.outcome.result.corners.peak.parts.d1.pins.A).toEqual(full.outcome.result.corners.peak.parts.d1.pins.A)
  }, 60_000)
  it('still blocks an LED with no resistor at 50 % duty (the union keeps the high run)', async () => {
    // The test board's 30 ohm pin holds a bare LED to 37 mA, under IO1's 40 mA absolute maximum, so it
    // would not block even fully high. A 15 ohm pin gives 59 mA high (past that datasheet limit: it
    // blocks) and about 30 mA averaged (under it), so only the union over the runs blocks.
    const stiff = boardModule({}, 'test-board-stiff')
    ;(stiff.electrical as { sim: { gpio: { outputResistance: unknown } } }).sim.gpio.outputResistance = q(15, 'ohm')
    const bare = board([{ uid: 'd1', module: 'led' }], [['u1.IO1', 'd1.A'], ['d1.K', 'u1.GND']], stiff)
    const { outcome } = await ledOn(bare, { u1: { IO1: { pwm: 0.5 } } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    expect(outcome.result.findings.some((f) => f.severity === 'error' && f.code === 'sim-over-abs-max')).toBe(true)
  }, 60_000)
  it('notes pwm-approximate when two PWM pins share a resistor', async () => {
    const shared = board([ohm('r1', 100), ohm('r2', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['rc.2', 'u1.GND']])
    const { outcome } = await ledOn(shared, { u1: { IO1: { pwm: 0.5 }, IO2: { pwm: 0.25 } } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    const note = outcome.result.findings.find((f) => f.code === 'pwm-approximate')
    expect(note).toMatchObject({ severity: 'note', parts: ['u1'], pins: [{ part: 'u1', pin: 'IO1' }, { part: 'u1', pin: 'IO2' }] })
    expect(note!.message).toBe('U1 IO1 and IO2 share part of the circuit, so their averaged readings assume their PWM cycles overlap at random; the real overlap depends on timing and may differ.')
    expect(outcome.result.pwm?.approximate).toBe(true)
  }, 60_000)
  it('is unchanged without PWM: 2 engine runs, no pwm field', async () => {
    const { outcome } = await ledOn(lit, { u1: { IO1: 'high' } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    expect([outcome.result.engine.runs, outcome.result.pwm]).toEqual([2, undefined])
  }, 60_000)
})
