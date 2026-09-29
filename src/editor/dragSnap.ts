// The snap targets of one part, frame or note drag (see snap.ts), built once when the drag starts.
import { type Diagram, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { bodyRect, type Rect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { annotationBox } from './align.ts'
import { buildSnapIndex, GRID, unionRect, type PinLink, type SnapIndex } from './snap.ts'

/**
 * What a part, frame or note drag snaps to, built once when the drag starts (see snap.ts): the
 * index of every object that stays put, the moving selection's box, and, for parts, the boards and
 * outlets a moving part could be seated in (their bodies grown by a grid step), so a pointer move
 * far from any board skips the seat check.
 */
export interface DragSnap {
  index: SnapIndex
  moving: Rect
  /** Bodies of the moving parts that settle on drop, at drag start. */
  settling: Rect[]
  boards: Rect[]
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Builds the snap targets for a drag of `parts` (with what they carry) and `notes` over sheet `d`. */
export function dragSnap(d: Diagram, parts: string[], settling: string[], notes: string[]): DragSnap | null {
  const moving = new Set(parts)
  const movingNotes = new Set(notes)
  const loose = new Set(settling)
  const objects: Rect[] = []
  const spacers: Rect[] = []
  const mine: Rect[] = []
  const settlingRects: Rect[] = []
  const boards: Rect[] = []
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!m) continue
    const r = bodyRect(p, layoutModule(m))
    if (moving.has(p.uid)) {
      mine.push(r)
      if (loose.has(p.uid)) settlingRects.push(r)
      continue
    }
    objects.push(r)
    spacers.push(r)
    if (m.holes?.length) boards.push(grow(r, GRID))
  }
  for (const a of d.annotations ?? []) {
    const r = annotationBox(a)
    if (movingNotes.has(a.uid)) {
      mine.push(r)
      continue
    }
    objects.push(r)
    // A frame holds a row rather than standing in it: its gaps never count for equal spacing.
    if (a.type !== 'frame') spacers.push(r)
  }
  const box = unionRect(mine)
  if (!box) return null
  // Every wire with exactly one end on the moving parts: that end, where it will be drawn once the
  // parts come loose, and the fixed end, where it is drawn now.
  const pins: PinLink[] = []
  if (moving.size) {
    const looseSheet = settling.length ? { ...d, parts: d.parts.map((p) => (loose.has(p.uid) && p.mount ? { ...p, mount: undefined } : p)) } : d
    for (const c of d.connections) {
      const fromMoves = moving.has(c.from.part)
      if (fromMoves === moving.has(c.to.part)) continue
      const a = resolveEndpoint(looseSheet, fromMoves ? c.from : c.to)
      const b = resolveEndpoint(d, fromMoves ? c.to : c.from)
      if (a && b) pins.push({ from: a.end, to: b.end })
    }
  }
  return { index: buildSnapIndex({ objects, spacers, pins }), moving: box, settling: settlingRects, boards }
}
