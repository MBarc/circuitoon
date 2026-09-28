// Layout on the fixture sizes of spec 10 (5, 30, 120 parts and the typewriter-like topology): every
// part placed, zero body and caption overlaps, nothing blocked, mounts seated, and a clean verify.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeDiagram } from '../format/diagram.ts'
import { openLinkPayload, payloadFromHash } from '../format/link.ts'
import { runGate } from '../cli/gate.ts'
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

  it('typewriter-like: crossings stay at the measured level (A15: 6698 to 3061; A18: 1707)', () => {
    // A ceiling at the value measured after A18 plus a small margin, so a regression shows here.
    const r = layoutNetlist(typewriter())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.report.wireCrossings).toBeLessThanOrEqual(1750)
  }, 60_000)

  // Amendment A4: the full fixture's gate plus link round trip. The PNG writer is a stand-in (the
  // real browser path is covered in src/cli/gate.test.ts and by hand), so this runs everywhere.
  it('typewriter-like: gate passes and its link decodes back to the same sheet', async () => {
    const r = layoutNetlist(typewriter())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const text = serializeDiagram(r.value.diagram)
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-tw-gate-'))
    const png = (_svg: unknown, _scale: number, out: string) => {
      writeFileSync(out, 'png')
      return { ok: true as const, width: 1, height: 1 }
    }
    const io = { stdout: () => {}, stderr: () => {}, cwd: dir, env: {} }
    const g = await runGate(new TextEncoder().encode(text), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io, png })
    expect(g.report.blocking).toEqual([])
    expect(g.code).toBe(0)
    expect(g.report.artifacts.map((a) => a.kind)).toEqual(['svg', 'png', 'focus-png', 'link'])
    const payload = payloadFromHash(new URL(g.report.link.url!).hash)
    const back = await openLinkPayload(payload!)
    if (!back.ok) throw new Error(back.message)
    expect(back.warnings).toEqual([])
    expect(serializeDiagram(back.diagram)).toBe(text)
  }, 60_000)
})
