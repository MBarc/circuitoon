// Firmware spec 2.3: a pin table becomes run pin states. Declared PWM is used as declared (duty 0 or
// 1 as low or high); a plain output toggling at 50 Hz or faster (10 edges in the fixed 100 ms window)
// is PWM with duty = high time / window, anything slower shows its latch, so 1 Hz and 10 Hz blinks
// stay on and off and 200 Hz is averaged; duty is quantised to 1/64 and moves only past a step.
import { describe, expect, it } from 'vitest'
import { makeHw, type RunClock } from './bridge.ts'
import { H, MODE, boardMemory, setOut, writeLocked } from './memory.ts'
import { BoardSampler, DUTY_STEP, quantize } from './sampler.ts'

/**
 * Drives GPIO17 as a square wave through the real write path in 50 us steps (whole steps per period,
 * so the duty is exact); samples every 16 ms; returns each sample's state. With samples every 16 ms
 * the window's base is 112 ms back.
 */
function squareWave(hz: number, duty: number, ms: number) {
  const m = boardMemory()
  const clock: RunClock & { t: number } = { t: 0, epochMs: 0, now: () => clock.t, block() {}, poll() {} }
  const hw = makeHw(m, clock, { board: 'pi4', onPrompt() {}, flush() {} })
  hw.setup(17, MODE.output)
  const s = new BoardSampler()
  const states: unknown[] = []
  const period = Math.round(1000 / hz / 0.05)
  const high = Math.round(period * duty)
  for (let step = 0; step * 0.05 <= ms; step++) {
    clock.t = step * 0.05
    hw.output(17, step % period < high ? 1 : 0)
    if (step % 320 === 0) states.push(s.sample(m, clock.t).pins.GPIO17)
  }
  return states
}

describe('the sampler (spec 2.3)', () => {
  it('shows a 1 Hz blink as on and off, never averaged', () => {
    const st = squareWave(1, 0.5, 2000)
    expect(new Set(st.map((x) => JSON.stringify(x)))).toEqual(new Set(['"high"', '"low"']))
  })
  it('shows a 10 Hz blink as on and off too (2 edges per window, under 10)', () => {
    expect(squareWave(10, 0.5, 1000).every((x) => x === 'high' || x === 'low')).toBe(true)
  })
  it('averages 200 Hz into PWM once a full window has passed, within a duty step', () => {
    const st = squareWave(200, 0.5, 1000).slice(8) as { pwm: number }[]
    expect(st.every((x) => typeof x === 'object' && Math.abs(x.pwm - 0.5) <= DUTY_STEP)).toBe(true)
  })
  it('measures duty exactly when the window holds whole periods (250 Hz: 28 in 112 ms)', () => {
    const st = squareWave(250, 0.25, 1000)
    expect(st.slice(8)).toEqual(st.slice(8).map(() => ({ pwm: 0.25 })))
  })
  it('uses a declared PWM descriptor as declared, and duty 0 or 1 as low or high', () => {
    const m = boardMemory()
    const s = new BoardSampler()
    const set = (duty: number) => writeLocked(m, H.outSeq, () => setOut(m, 18, { mode: MODE.output, pwmActive: true, duty, freq: 50 }))
    set(0.3)
    expect(s.sample(m, 0).pins.GPIO18).toEqual({ pwm: Math.round(0.3 / DUTY_STEP) * DUTY_STEP })
    expect(s.sample(m, 16).detail.GPIO18).toMatchObject({ freqHz: 50 })
    set(0)
    expect(s.sample(m, 32).pins.GPIO18).toBe('low')
    set(1)
    expect(s.sample(m, 48).pins.GPIO18).toBe('high')
  })
  it('quantises duty to 1/64 and moves only past a step', () => {
    expect(quantize(null, 0.505)).toBe(0.5)
    expect(quantize(0.5, 0.51)).toBe(0.5)
    expect(quantize(0.5, 0.52)).toBe(33 / 64)
  })
  it('names input modes, leaves unused pins out, and reports the code sequence', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => {
      setOut(m, 27, { mode: MODE.pullup })
      setOut(m, 22, { mode: MODE.pulldown })
      setOut(m, 4, { mode: MODE.input })
    })
    Atomics.store(m.i32, H.codeSeq, 7)
    const r = new BoardSampler().sample(m, 0)
    expect(r.pins).toEqual({ GPIO4: 'input', GPIO22: 'input-pulldown', GPIO27: 'input-pullup' })
    expect(r.seq).toBe(7)
  })
  it('stays sane when an edge lands after the sample time was taken (changedUs later than now)', () => {
    const m = boardMemory()
    const s = new BoardSampler()
    const put = (latch: 0 | 1, rising: number, falling: number, changedUs: number) =>
      writeLocked(m, H.outSeq, () => setOut(m, 17, { mode: MODE.output, latch, rising, falling, highUs: 0, changedUs }))
    put(1, 10, 10, 0)
    s.sample(m, 0)
    put(1, 30, 29, 200_000) // the worker wrote at 200 ms; the main thread took now = 112 ms first
    const r = s.sample(m, 112).pins.GPIO17
    // no high time was recorded, so it must not read as high (the wrapped elapsed time made it 'high')
    expect(r).toBe('low')
  })
})
