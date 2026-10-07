// Firmware spec 4.3 and 9 (the PWM checkpoint): a run-state change re-solved end to end at 200 parts,
// p95 at most 50 ms with no PWM, and at most 200 ms with one group of 3 PWM pins (an RGB LED on a
// shared resistor: 8 typical and 2 peak texts). Measured like solve.perf.test.ts; budgets are never
// relaxed: on a busy machine, rerun on a quiet one.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { solve } from './session.ts'
import { pwmPerfSheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

const d = pwmPerfSheet()

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
