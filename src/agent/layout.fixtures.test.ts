// Layout on the fixture sizes of spec 10 (5, 30, 120 parts and the typewriter-like topology): every
// part placed, zero body and caption overlaps, nothing blocked, mounts seated, and a clean verify.
import { describe, expect, it } from 'vitest'
import { serializeDiagram } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { verifyDiagram } from './verify.ts'
import { channelTable } from './tables.ts'
import { fiveParts, ledRails, typewriter } from './fixtures.testing.ts'

const cases: [string, () => unknown, number][] = [
  ['5 parts', fiveParts, 5],
  ['30 parts', () => ledRails(13, 1), 30],
  ['120 parts', () => ledRails(57, 3), 120],
  ['typewriter-like', typewriter, 98],
]

describe('layout fixtures', () => {
  for (const [name, make, count] of cases)
    it(`${name}: all placed, no overlaps, nothing blocked, mounts seated, verifies clean`, () => {
      const r = layoutNetlist(make())
      if (!r.ok) throw new Error(r.errors.join('\n'))
      const d = r.value.diagram
      // Every intended part, plus only the rail strips layout adds as routing infrastructure (A18.1).
      const refs = new Set(r.value.intent.parts.map((p) => p.ref))
      expect(d.parts.filter((p) => refs.has(p.uid))).toHaveLength(count)
      expect(d.parts.filter((p) => !refs.has(p.uid)).every((p) => p.module === 'power-rail-strip')).toBe(true)
      expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
      expect(mountIssues(d)).toEqual([])
      expect(verifyDiagram(d, libraryLookup)).toEqual([])
    }, 60_000)

  it('typewriter-like: 42 copies, 84 switches, one channel per ball, DIPs across the channel, deterministic', () => {
    const a = layoutNetlist(typewriter())
    const b = layoutNetlist(typewriter())
    if (!a.ok || !b.ok) throw new Error('layout failed')
    expect(a.value.intent.copies).toHaveLength(42)
    expect(a.value.diagram.parts.filter((p) => p.module === 'tilt-switch-sw520d')).toHaveLength(84)
    expect(new Set(channelTable(a.value.intent).map((c) => c.endpoint)).size).toBe(42)
    expect(a.value.diagram.parts.filter((p) => p.module === 'mcp23017-dip28').every((p) => p.rotation === 90 && p.mount)).toBe(true)
    expect(serializeDiagram(a.value.diagram)).toBe(serializeDiagram(b.value.diagram))
  }, 60_000)

  it('typewriter-like: copies beside their expanders at least halve the crossings (amendment A15, baseline 6698)', () => {
    const r = layoutNetlist(typewriter())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.report.wireCrossings).toBeLessThanOrEqual(3349)
  }, 60_000)

  // Amendment A4: the full fixture's gate plus link round trip. Gate (Task 16) and link (Task 13)
  // do not exist yet; the layout and verify half is covered above.
  it.todo('typewriter-like: gate passes and its link decodes back to the same sheet (Tasks 13 and 16)')
})
