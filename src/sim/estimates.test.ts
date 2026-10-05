// Spec 3.1 and 3.4: the voltage-keyed battery fallback and the category load estimates, each
// flagged `estimate`, and simOf reading electrical.sim.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'
import { cellEstimate, loadEstimate } from './estimates.ts'

describe('battery fallback by nominal voltage (spec 3.1 table)', () => {
  it.each([
    [3.0, 15, 'lithium coin cell'],
    [1.5, 0.15, 'alkaline AA'],
    [4.5, 0.45, 'alkaline AA'],
    [6, 0.6, 'alkaline AA'],
    [3.7, 0.05, 'Li-ion 18650'],
    [7.4, 0.1, 'Li-ion 18650'],
    [9, 1.5, 'alkaline 9 V'],
    // Series counts (ruling R33): Li-ion only as 1 or 2 cells, alkaline up to 6, coin and 9 V single.
    [12, 0.1, 'unknown'],
    [11.1, 0.1, 'unknown'],
    [14.8, 0.1, 'unknown'],
  ])('%s V: %s ohm (%s)', (v, ohms, assumed) => {
    const e = cellEstimate(v)
    expect(e.rInternal.value).toBeCloseTo(ohms, 9)
    expect(e.rInternal.provenance).toBe('estimate')
    expect(e.rInternal.note).toBeTruthy()
    expect(e.assumed).toBe(assumed)
  })
})

describe('category load estimates (spec 3.4 table)', () => {
  it.each([
    ['esp32-devkit-v1-30', 0.08, 0.5],
    ['esp32-s3-devkitc-1', 0.08, 0.5],
    ['esp32-c3-supermini', 0.03, 0.35],
    ['xiao-esp32c3', 0.03, 0.35],
    ['arduino-uno-r3', 0.025, 0.06],
    ['rpi-pico', 0.025, 0.06],
    ['oled-ssd1306-096-i2c', 0.015, 0.04],
    ['tft-ili9341-24-spi', 0.06, 0.12],
    ['bme280-module-4pin', 0.002, 0.01],
    ['rfm95-lora-breakout', 0.03, 0.25],
  ])('%s: typical %s A, peak %s A, both estimates', (id, typical, peak) => {
    const e = loadEstimate(load(id))
    expect(e?.typical.value).toBeCloseTo(typical, 9)
    expect(e?.peak.value).toBeCloseTo(peak, 9)
    expect(e?.typical.provenance).toBe('estimate')
    expect(e?.peak.note).toBeTruthy()
  })
  it('gives nothing for a part outside the table', () => {
    expect(loadEstimate(load('relay-module-1ch-5v'))).toBeNull()
    expect(loadEstimate(load('resistor'))).toBeNull()
  })
})

describe('simOf', () => {
  it('reads electrical.sim, and is null without it', () => {
    const m = load('resistor')
    expect(simOf(m)).toBeNull()
    expect(simOf({ ...m, electrical: { ...(m.electrical as object), sim: { limits: [] } } })).toEqual({ limits: [] })
  })
})
