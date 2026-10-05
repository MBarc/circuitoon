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
