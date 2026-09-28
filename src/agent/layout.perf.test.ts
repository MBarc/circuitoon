// The layout budget (spec 2.3): 120 parts in under 2 s, routing included, measured after one warm-up
// run (JIT and per-module caches), on the 120-part fixture and on the 98-part typewriter-like one.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from './layout.ts'
import { ledRails, typewriter } from './fixtures.testing.ts'

const cases: [string, () => unknown][] = [
  ['120 parts', () => ledRails(57, 3)],
  ['typewriter-like (98 parts)', typewriter],
]

describe('layout performance', () => {
  for (const [name, make] of cases)
    it(`${name}: under 2 s including routing`, () => {
      layoutNetlist(make())
      const t0 = performance.now()
      const r = layoutNetlist(make())
      const ms = performance.now() - t0
      expect(r.ok).toBe(true)
      expect(ms).toBeLessThan(2000)
    }, 60_000)
})
