// Firmware spec 4.2 and ruling R1: PWM pins split into groups that interact through anything but the
// supply and ground nets; one baseline run, plus each exact group's other combinations (weights: the
// product of d or 1 - d) and one flip per pin of a superposition group (weight |d - round(d)|); the
// average is X0 + sum of w (X - X0). Exact for separate groups; superposition is exact for a linear
// circuit, checked against all 16 combinations of 4 pins summed through separate resistors.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { mixRaws, pwmGroups, pwmPlan } from './pwm.ts'
import { type PartSpec, boardModule, cellModule, sheet } from './testing.ts'

/** A board with IO1..IOn; `wiring` adds parts and wires on its pins. */
function boardWith(n: number, parts: PartSpec[], wires: [string, string][]) {
  const b = boardModule({}, 'test-pwm-board')
  const pins = Array.from({ length: n }, (_, i) => `IO${i + 1}`)
  const e = b.electrical as { sim: { gpio: { pins: string[] } } }
  e.sim.gpio.pins = pins
  b.pins = [...b.pins.filter((p) => !('name' in p) || !/^IO\d+$/.test(p.name)), ...pins.map((name, i) => ({ name, side: (i % 2 ? 'right' : 'left') as 'left' | 'right', type: 'io' as const }))]
  ;(e.sim as { limits?: unknown[] }).limits = []
  return sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: b }, ...parts], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])
}
const ohm = (uid: string, v: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: v, unit: 'ohm' } } })
const pwm = (duties: number[]): RunPins => ({ u1: Object.fromEntries(duties.map((d, i) => [`IO${i + 1}`, { pwm: d }])) })

describe('PWM groups and plans (spec 4.2, ruling R1)', () => {
  it('keeps pins that only share ground in separate groups, and joins pins that share a resistor', () => {
    const sep = boardWith(3, [ohm('r1', 330), ohm('r2', 330), ohm('r3', 330)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND'], ['u1.IO2', 'r2.1'], ['r2.2', 'u1.GND'], ['u1.IO3', 'r3.1'], ['r3.2', 'u1.GND']])
    expect(pwmGroups(buildCircuit(sep, { runPins: pwm([0.5, 0.5, 0.5]) })).map((g) => g.length)).toEqual([1, 1, 1])
    const shared = boardWith(3, [ohm('r1', 100), ohm('r2', 100), ohm('r3', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['r3.2', 'rc.1'], ['rc.2', 'u1.GND']])
    expect(pwmGroups(buildCircuit(shared, { runPins: pwm([0.5, 0.5, 0.5]) })).map((g) => g.length)).toEqual([3])
  })
  it('plans one baseline plus a run per other combination, with weights summing to 1', () => {
    const d = boardWith(2, [ohm('r1', 330), ohm('r2', 330)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND'], ['u1.IO2', 'r2.1'], ['r2.2', 'u1.GND']])
    const p = pwmPlan(buildCircuit(d, { runPins: pwm([0.5, 0.1]) }))!
    expect(p.runs).toEqual([{ 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'low' }, { 'u1.gpio.IO1': 'high', 'u1.gpio.IO2': 'low' }, { 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'high' }])
    expect(p.weights.map((w) => Number(w.toFixed(6)))).toEqual([0.4, 0.5, 0.1])
    expect(p.approximate).toEqual([])
    expect(p.peak).toEqual([{ 'u1.gpio.IO1': 'high', 'u1.gpio.IO2': 'high' }, { 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'low' }])
    expect(pwmPlan(buildCircuit(d))).toBeNull()
  })
  it('enumerates a group of 3 exactly (8 typical runs), and marks it approximate (ruling R6)', () => {
    const d = boardWith(3, [ohm('r1', 100), ohm('r2', 100), ohm('r3', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['r3.2', 'rc.1'], ['rc.2', 'u1.GND']])
    const p = pwmPlan(buildCircuit(d, { runPins: pwm([0.2, 0.5, 0.7]) }))!
    expect(p.runs).toHaveLength(8)
    expect(p.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12)
    expect(p.approximate.map((g) => g.length)).toEqual([3])
  })
  it('keys every planned run by the id of a pwm GpioDevice the build made (a mistyped key falls back to high)', () => {
    const d = boardWith(5, [ohm('r1', 330), ohm('r2', 330), ohm('r3', 330), ohm('r4', 330), ohm('r5', 330), ohm('rc', 330)],
      [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['u1.IO4', 'r4.1'], ['u1.IO5', 'r5.1'],
        ['r2.2', 'rc.1'], ['r3.2', 'rc.1'], ['r4.2', 'rc.1'], ['r5.2', 'rc.1'], ['rc.2', 'u1.GND']])
    const c = buildCircuit(d, { runPins: pwm([0.3, 0.2, 0.6, 0.7, 0.5]) })
    const ids = c.devices.filter((x) => x.kind === 'gpio' && x.state === 'pwm').map((x) => x.id).sort()
    expect(ids).toHaveLength(5)
    const p = pwmPlan(c)!
    expect(p.groups.map((g) => g.length)).toEqual([1, 4])
    expect(p.runs).toHaveLength(1 + 1 + 4)
    for (const run of [...p.runs, ...p.peak]) expect(Object.keys(run).sort()).toEqual(ids)
    expect(p.pins.map((x) => x.id).sort()).toEqual(ids)
    // The superposition group's baseline is round(d) (0.5 rounds up); its flip weights are |d - round(d)|.
    expect(p.runs[0]).toEqual({ 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'low', 'u1.gpio.IO3': 'high', 'u1.gpio.IO4': 'high', 'u1.gpio.IO5': 'high' })
    expect(p.runs[1]['u1.gpio.IO1']).toBe('high')
    expect(p.runs[3]['u1.gpio.IO3']).toBe('low')
    expect(p.weights.map((w) => Number(w.toFixed(6)))).toEqual([-0.7, 0.3, 0.2, 0.4, 0.3, 0.5])
    expect(p.approximate.map((g) => g.length)).toEqual([4])
  })
  it('mixes raw runs by weight, and a missing value is NaN', () => {
    const m = mixRaws([{ v: { a: 1, b: 2 }, pins: { u: { p: 1 } }, dev: { x: 4 } }, { v: { a: 3 }, pins: { u: { p: 3 } }, dev: { x: 8 } }], [0.25, 0.75])
    expect(m.v.a).toBe(2.5)
    expect(m.v.b).toBeNaN()
    expect([m.pins.u.p, m.dev.x]).toEqual([2.5, 7])
  })
})

describe('superposition against the exact result (spec 4.2)', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('matches all 16 combinations for 4 pins summed through separate resistors', async () => {
    const d = boardWith(4, [ohm('r1', 1000), ohm('r2', 2000), ohm('r3', 4000), ohm('r4', 8000), ohm('rs', 1000)],
      [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['u1.IO4', 'r4.1'], ['r1.2', 'rs.1'], ['r2.2', 'rs.1'], ['r3.2', 'rs.1'], ['r4.2', 'rs.1'], ['rs.2', 'u1.GND']])
    const duties = [0.2, 0.45, 0.6, 0.9]
    const c = buildCircuit(d, { runPins: pwm(duties) })
    const p = pwmPlan(c)!
    expect(p.runs).toHaveLength(5)
    const runs = await engine.runAll(c, p.runs.map((pins) => ({ kind: 'op', corner: 'typical', pins })), 1)
    const avg = mixRaws(runs.map((r) => (r.status === 'ok' ? r.raw : { v: {}, pins: {}, dev: {} })), p.weights)
    const ids = duties.map((_, i) => `u1.gpio.IO${i + 1}`)
    let exact = 0
    for (let k = 0; k < 16; k++) {
      const pins = Object.fromEntries(ids.map((id, i) => [id, (k >> i) & 1 ? 'high' : 'low'])) as Record<string, 'high' | 'low'>
      const w = duties.reduce((acc, dd, i) => acc * ((k >> i) & 1 ? dd : 1 - dd), 1)
      const [r] = await engine.runAll(c, [{ kind: 'op', corner: 'typical', pins }], 2)
      if (r.status !== 'ok') throw new Error('solve failed')
      exact += w * r.raw.v['net:R1_2']
    }
    expect(avg.v['net:R1_2']).toBeCloseTo(exact, 4)
    expect(p.approximate.map((g) => g.length)).toEqual([4])
  }, 120_000)
})
