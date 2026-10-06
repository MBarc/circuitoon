// Firmware spec 4.3 and 9 (the PWM checkpoint): a run-state change re-solved end to end at 200 parts,
// p95 at most 50 ms with no PWM, and at most 200 ms with one group of 3 PWM pins (an RGB LED on a
// shared resistor: 8 typical and 2 peak texts). Measured like solve.perf.test.ts; budgets are never
// relaxed: on a busy machine, rerun on a quiet one.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { solve } from './session.ts'
import { type PartSpec, cellModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

/** 200 parts: a 5 V supply, a Pi 4, an RGB LED (three LEDs on one 220 ohm resistor on GPIO17, 27, 22), and 97 resistor-LED pairs on the supply. */
const parts: PartSpec[] = [{ uid: 'bt1', module: cellModule(5, 0.02) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'rc', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } } }]
const wires: [string, string][] = [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['rc.2', 'u1.GND 2']]
for (const [i, pin] of ['GPIO17', 'GPIO27', 'GPIO22'].entries()) {
  parts.push({ uid: `c${i}`, module: 'led' })
  wires.push([`u1.${pin}`, `c${i}.A`], [`c${i}.K`, 'rc.1'])
}
for (let i = 0; i < 97; i++) {
  parts.push({ uid: `r${i}`, module: 'resistor', values: { resistance: { value: 150 + i, unit: 'ohm' } } }, { uid: `d${i}`, module: 'led' })
  wires.push(['bt1.+', `r${i}.1`], [`r${i}.2`, `d${i}.A`], [`d${i}.K`, 'bt1.-'])
}
const d = sheet(parts, wires)

async function p95(round: (k: number) => Promise<void>): Promise<number> {
  const times: number[] = []
  for (let k = 0; k < 45; k++) {
    const t0 = performance.now()
    await round(k)
    if (k >= 5) times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length * 0.95)]
}

describe('run-state solve budgets (spec 4.3, the PWM checkpoint)', () => {
  it('has 200 parts', () => expect(d.parts).toHaveLength(200))
  it('re-solves a run-state change with no PWM in p95 50 ms or less', async () => {
    const ms = await p95(async (k) => {
      const runPins: RunPins = { u1: { GPIO17: k % 2 ? 'high' : 'low', GPIO27: 'low', GPIO22: 'low' } }
      const { outcome } = await solve(d, engine, k, { runPins })
      expect(outcome.status).toBe('ok')
    })
    console.log(`no PWM: p95 ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThanOrEqual(50)
  }, 300_000)
  it('re-solves one group of 3 PWM pins (10 texts) in p95 200 ms or less', async () => {
    const ms = await p95(async (k) => {
      const runPins: RunPins = { u1: { GPIO17: { pwm: (k % 60 + 1) / 64 }, GPIO27: { pwm: 0.5 }, GPIO22: { pwm: 0.25 } } }
      const { outcome } = await solve(d, engine, k, { runPins })
      expect(outcome.status === 'ok' && outcome.result.engine.runs).toBe(10)
    })
    console.log(`3 PWM pins: p95 ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThanOrEqual(200)
  }, 300_000)
})
