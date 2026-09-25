// Regression test: for every built-in module with exactly one pin on the left side and one on
// the right, the lead art (the shape(s) touching the body's left edge, x=0, and its right edge,
// x=art.w) must be vertically centered on that pin's edge, not just visually close. A module
// whose art height rounds to an odd number of grid units throws this off by half a grid unit,
// because layoutModule's single-pin-per-side placement always lands on a whole grid line, and
// only an even-unit body has a whole grid line exactly at its vertical center.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSpacer, layoutModule, validateModule } from './module.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()

describe('left/right lead art meets the pin edge', () => {
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const result = validateModule(raw)
    if (!result.ok) continue
    const m = result.module
    if (!m.art) continue
    const realPins = m.pins.filter((p) => !isSpacer(p))
    const left = realPins.filter((p) => p.side === 'left')
    const right = realPins.filter((p) => p.side === 'right')
    if (left.length !== 1 || right.length !== 1) continue

    it(`${file}: left and right leads are centered on their pin edge`, () => {
      const art = m.art!
      const lay = layoutModule(m)
      // Art is centered inside the computed body; for these two-lead parts that offset is
      // normally zero, but the test accounts for it anyway rather than assuming it.
      const ax = (lay.w - art.w) / 2
      const ay = (lay.h - art.h) / 2

      const leftPin = lay.pins.find((p) => p.side === 'left')!
      const rightPin = lay.pins.find((p) => p.side === 'right')!
      const leftLeads = art.shapes.filter((s) => Math.abs(s.x + ax) < 0.01)
      const rightLeads = art.shapes.filter((s) => Math.abs(s.x + s.w + ax - lay.w) < 0.01)

      expect(leftLeads.length, 'expected at least one shape touching x=0').toBeGreaterThan(0)
      expect(rightLeads.length, 'expected at least one shape touching x=art.w').toBeGreaterThan(0)

      for (const s of leftLeads) expect(Math.abs(s.y + s.h / 2 + ay - leftPin.edge.y)).toBeLessThanOrEqual(1)
      for (const s of rightLeads) expect(Math.abs(s.y + s.h / 2 + ay - rightPin.edge.y)).toBeLessThanOrEqual(1)
    })
  }
})
