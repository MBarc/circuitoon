// Smart-guide budget: a drag's snap targets are sorted once at drag start (dragSnap), and every
// pointer move after that (snapMove) is a few binary searches plus one pass over the spacers, so
// guides never slow a drag on a big sheet. Timed on the 120-part layout fixture, the 98-part
// typewriter-like one, a synthetic 2,000-object sheet, and Michael's own typewriter sheet when a
// copy is present at .superpowers/fixtures/typewriter-sheet.circuitoon.json (never committed).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from '../agent/layout.ts'
import { ledRails, typewriter } from '../agent/fixtures.testing.ts'
import { type Diagram, validateDiagram } from '../format/diagram.ts'
import { buildSnapIndex, snapMove } from './snap.ts'
import { dragSnap } from './dragSnap.ts'
import { settlingOf, withMounted } from './ops.ts'
import type { Rect } from '../format/geometry.ts'

function laidOut(netlist: unknown): Diagram {
  const r = layoutNetlist(netlist)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value.diagram
}

function median(fn: () => void, runs = 9): number {
  for (let i = 0; i < 2; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

/** 1,000 pointer moves in a sweep across the sheet, at the default zoom. */
const MOVES = Array.from({ length: 1000 }, (_, i) => ({ x: ((i * 37) % 900) - 450 + (i % 7) * 0.9, y: ((i * 53) % 700) - 350 + (i % 5) * 1.3 }))

/** The part with the most wires: the heaviest drag on the sheet (most pin links). */
function busiest(d: Diagram): string {
  const n = new Map<string, number>()
  for (const c of d.connections) for (const e of [c.from.part, c.to.part]) n.set(e, (n.get(e) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const sheets: [string, () => Diagram][] = [
  ['120-part layout fixture', () => laidOut(ledRails(57, 3))],
  ['typewriter-like fixture (98 parts)', () => laidOut(typewriter())],
]
const mine = join(import.meta.dirname, '..', '..', '.superpowers', 'fixtures', 'typewriter-sheet.circuitoon.json')
if (existsSync(mine))
  sheets.push([
    "Michael's typewriter sheet",
    () => {
      const r = validateDiagram(JSON.parse(readFileSync(mine, 'utf8')))
      if (!r.ok) throw new Error(r.errors.join('; '))
      return r.diagram
    },
  ])

describe('smart guide performance', () => {
  for (const [name, make] of sheets)
    it(`${name}: drag start under 15 ms, 1,000 moves under 60 ms (medians)`, () => {
      const d = make()
      const uid = busiest(d)
      const moving = withMounted(d, [uid])
      const settling = settlingOf(d, [uid])
      const start = median(() => dragSnap(d, moving, settling, []))
      const snap = dragSnap(d, moving, settling, [])!
      expect(snap.index.links.length).toBeGreaterThan(0)
      const moves = median(() => {
        for (const m of MOVES) snapMove(snap.index, snap.moving, m, 1.5)
      })
      console.log(`${name}: ${d.parts.length} parts, ${snap.index.links.length} pin links; drag start ${start.toFixed(2)} ms, 1,000 moves ${moves.toFixed(2)} ms`)
      expect(start).toBeLessThan(15)
      expect(moves).toBeLessThan(60)
    }, 120_000)

  it('2,000 objects and 200 pin links: index under 15 ms, 1,000 moves under 250 ms (medians)', () => {
    const objects: Rect[] = []
    for (let i = 0; i < 2000; i++) objects.push({ x: (i % 50) * 90, y: Math.floor(i / 50) * 70, w: 40 + (i % 4) * 10, h: 30 + (i % 3) * 10 })
    const pins = Array.from({ length: 200 }, (_, i) => ({ from: { x: 20 + (i % 10) * 10, y: 10 + i * 10 }, to: { x: 900 + (i % 13) * 10, y: 20 + i * 10 } }))
    const build = median(() => buildSnapIndex({ objects, pins }))
    const idx = buildSnapIndex({ objects, pins })
    const moving = { x: 2000, y: 1400, w: 60, h: 40 }
    const moves = median(() => {
      for (const m of MOVES) snapMove(idx, moving, m, 1.5)
    })
    console.log(`2,000 objects: index ${build.toFixed(2)} ms, 1,000 moves ${moves.toFixed(2)} ms`)
    expect(build).toBeLessThan(15)
    expect(moves).toBeLessThan(250)
  })
})
