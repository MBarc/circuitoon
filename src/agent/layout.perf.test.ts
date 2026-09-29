// The layout budget (spec 2.3): 120 parts in under 2 s, routing included, on the 120-part fixture
// and on the 98-part typewriter-like one. After one warm-up run (JIT and per-module caches), the
// median of five runs is timed, so one run slowed by a parallel test does not fail the budget.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from './layout.ts'
import { ledRails, typewriter } from './fixtures.testing.ts'

const cases: [string, () => unknown][] = [
  ['120 parts', () => ledRails(57, 3)],
  ['typewriter-like (98 parts)', () => typewriter(false)],
]
const RUNS = 5

describe('layout performance', () => {
  for (const [name, make] of cases)
    it(`${name}: under 2 s including routing (median of ${RUNS})`, () => {
      layoutNetlist(make())
      const t: number[] = []
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now()
        const r = layoutNetlist(make())
        t.push(performance.now() - s)
        expect(r.ok).toBe(true)
      }
      t.sort((a, b) => a - b)
      expect(t[Math.floor(RUNS / 2)]).toBeLessThan(2000)
    }, 120_000)
})
