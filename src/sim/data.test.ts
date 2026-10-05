// The sourced simulation data (spec 3.4): every patch in scripts/sim-data is what its module file
// holds, and every value carries honest provenance.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'

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
