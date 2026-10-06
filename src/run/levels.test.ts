// Firmware spec 4.4: input levels thresholded in one shared function. Above inputHigh reads 1, below
// inputLow 0, in between keeps the last level (Schmitt hysteresis) and warns once past 100 ms; a
// floating input reads a random level per result (seeded, ruling R21) and warns once; edges are
// counted from successive levels; the first result sets the level without an edge.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import type { Reading } from '../sim/results.ts'
import { LevelTracker, mulberry32, thresholdsOf } from './levels.ts'

const v = (value: number): Reading => ({ kind: 'value', value, reference: 'GND', trust: 'ok' })
const th = { low: 0.8, high: 2.0 }

describe('reading pins (spec 4.4)', () => {
  it('takes the thresholds from the board data, else 30 and 70 percent of the GPIO domain', () => {
    const pi = thresholdsOf(load('rpi-4-model-b'))
    expect(pi.low).toBeLessThan(pi.high)
    expect(thresholdsOf(undefined)).toEqual({ low: 0.3 * 3.3, high: 0.7 * 3.3 })
  })
  it('applies hysteresis and counts edges, the first result without one', () => {
    const t = new LevelTracker('u1')
    const seq = [0.1, 1.4, 2.5, 1.4, 0.5, 3.0].map((x, i) => t.update('GPIO17', v(x), th, i * 20).row)
    expect(seq.map((r) => r.level)).toEqual([0, 0, 1, 1, 0, 1])
    expect(seq.at(-1)).toMatchObject({ rising: 2, falling: 1, status: 'value', volts: 3.0 })
  })
  it('warns once when a level dwells between the thresholds for more than 100 ms', () => {
    const t = new LevelTracker('u1')
    expect(t.update('GPIO17', v(1.4), th, 0).finding).toBeNull()
    expect(t.update('GPIO17', v(1.4), th, 90).finding).toBeNull()
    expect(t.check(150)).toEqual(['GPIO17'])
    expect(t.update('GPIO17', v(1.4), th, 300).finding).toBeNull()
    expect(t.check(400)).toEqual([])
  })
  it('reads a floating input at random per result, the same way every run, and warns once', () => {
    const a = new LevelTracker('u1')
    const b = new LevelTracker('u1')
    const levels = (t: LevelTracker) => Array.from({ length: 20 }, (_, i) => t.update('GPIO4', { kind: 'floating' }, th, i).row.level)
    const first = levels(a)
    expect(first).toEqual(levels(b))
    expect(new Set(first)).toEqual(new Set([0, 1]))
    const c = new LevelTracker('u1')
    expect(c.update('GPIO4', { kind: 'floating' }, th, 0).finding).toBe('floating-read')
    expect(c.update('GPIO4', { kind: 'floating' }, th, 1).finding).toBeNull()
    expect(c.update('GPIO4', { kind: 'floating' }, th, 1).row.status).toBe('floating')
  })
  it('keeps the level on an undefined reading', () => {
    const t = new LevelTracker('u1')
    t.update('GPIO5', v(3), th, 0)
    expect(t.update('GPIO5', { kind: 'undefined', why: 'not simulated (mains)' }, th, 1).row).toMatchObject({ level: 1, status: 'undefined' })
  })
  it('has a deterministic PRNG', () => {
    const r = mulberry32(42)
    expect([r(), r()]).toEqual([mulberry32(42)(), (() => { const s = mulberry32(42); s(); return s() })()])
  })
})
