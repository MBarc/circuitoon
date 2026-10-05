// The sourced simulation data (spec 3.4): every patch in scripts/sim-data is what its module file
// holds, and every value carries honest provenance.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'
import { LED_COLOURS } from './ledModels.ts'

const DIR = join(import.meta.dirname, '..', '..', 'scripts', 'sim-data')
export const patches = (): { id: string; sim: unknown; review: unknown[] }[] =>
  readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))

describe('sourced simulation data', () => {
  it('matches each module file exactly', () => {
    for (const p of patches()) expect(simOf(load(p.id)), p.id).toEqual(p.sim)
  })
  it('has been checked by two independent reviewers (spec 3.4)', () => {
    for (const p of patches()) expect(p.review.length, p.id).toBeGreaterThanOrEqual(2)
  })
})

describe('LED colours (spec 3.4, ruling R12)', () => {
  it('gives every colour a sourced absolute maximum between 10 and 200 mA', () => {
    for (const [colour, c] of Object.entries(LED_COLOURS)) {
      expect(c.absMaxCurrent?.source, colour).toMatch(/^https?:\/\//)
      expect(c.absMaxCurrent!.value, colour).toBeGreaterThan(0.01)
      expect(c.absMaxCurrent!.value, colour).toBeLessThan(0.2)
    }
  })
})

const CELLS = ['battery-18650-cell', 'battery-9v', 'battery-aa', 'battery-aaa', 'battery-cr1220', 'battery-cr2016', 'battery-cr2025', 'battery-cr2032', 'battery-lr44']
const HOLDERS = ['battery-18650-holder', 'battery-18650-holder-2s', 'battery-holder-2xaa', 'battery-holder-3xaaa', 'battery-holder-4xaa', 'battery-holder-cr2032']

describe('batteries, resistors and the KCD1 (spec 3.1, 3.4)', () => {
  it('gives every built-in voltage source an rInternal and a sourceCurrent limit, by chemistry', () => {
    for (const id of [...CELLS, ...HOLDERS]) {
      const sim = simOf(load(id))
      expect(sim?.modelParams?.rInternal?.unit, id).toBe('ohm')
      expect(sim?.limits?.filter((l) => l.kind === 'sourceCurrent' && 'part' in l.of), id).toHaveLength(1)
    }
  })
  it('labels a loose cell representative and a holder an estimate (the holder is not the cell)', () => {
    // The LR44 sheet gives only a 3 to 9 ohm range; its midpoint is an estimate (reviewer 1's correction).
    for (const id of CELLS) expect(simOf(load(id))?.modelParams?.rInternal?.provenance, id).toBe(id === 'battery-lr44' ? 'estimate' : 'representative')
    for (const id of HOLDERS) {
      const r = simOf(load(id))?.modelParams?.rInternal
      expect(r?.provenance, id).toBe('estimate')
      expect(r?.note, id).toMatch(/cell/i)
    }
  })
  it('gives a coin cell far more internal resistance than an 18650 (spec 3.1)', () => {
    expect(simOf(load('battery-cr2032'))!.modelParams!.rInternal.value).toBeGreaterThan(50 * simOf(load('battery-18650-cell'))!.modelParams!.rInternal.value)
  })
  it('rates the resistors by package power and the KCD1 by its datasheet contact resistance', () => {
    expect(simOf(load('resistor'))?.limits).toEqual([expect.objectContaining({ of: { part: true }, kind: 'power', value: 0.25, provenance: 'representative' })])
    expect(simOf(load('resistor-half-watt'))?.limits).toEqual([expect.objectContaining({ kind: 'power', value: 0.5 })])
    expect(simOf(load('rocker-switch-kcd1'))?.modelParams?.contactResistance).toMatchObject({ unit: 'ohm', provenance: 'datasheet' })
  })
})

describe('ESP32 DevKits (spec 3.4)', () => {
  for (const [id, five] of [['esp32-devkit-v1-30', 'VIN'], ['esp32-devkitc-v4', '5V']] as const)
    it(`${id}: three domains, a USB diode and an LDO, a chip draw labelled as chip, GPIO and limits`, () => {
      const sim = simOf(load(id))!
      expect(sim.usbPorts).toEqual({ USB: { gnd: 'GND' } })
      expect(sim.power!.domains.map((d) => d.name).sort()).toEqual(['3V3', five, 'USB'].sort())
      expect(sim.power!.rails!.map((r) => r.kind).sort()).toEqual(['ldo', 'switch'])
      const draw = sim.power!.draw!.find((d) => d.domain === '3V3')!
      expect(draw.typical.note).toMatch(/chip, not board/)
      expect(draw.peak?.note).toBeTruthy()
      expect(draw.minVolts).toBeDefined()
      expect(sim.gpio!.domain).toBe('3V3')
      expect(sim.gpio!.pins.length).toBeGreaterThan(15)
      expect(sim.limits!.some((l) => l.kind === 'ioTotalCurrent')).toBe(true)
    })
})
