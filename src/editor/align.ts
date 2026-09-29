// Align, Distribute and arrow-key nudges for a selection of parts, frames and notes. Every result
// keeps parts on the 10 px grid (so pins stay on breadboard holes), moves a selected board with the
// parts plugged into it, and never pulls a plugged-in part out of a board that is not moving.
import { type Annotation, type Diagram, moduleOf } from '../format/diagram.ts'
import { bodyRect, type Rect } from '../format/geometry.ts'
import { isBoard, layoutModule } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { moveAnnotations, moveParts, settleMounts, settlingOf, type Selection } from './ops.ts'
import { GRID } from './snap.ts'

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** One thing Align and Distribute move: a part (a board carries its own) or a frame or note. */
export interface AlignItem {
  kind: 'part' | 'note'
  uid: string
  /** Its drawn body (a part) or box (a frame's border, a note's card), in world px. */
  rect: Rect
  /** Its stored position, which is what lands on the grid. */
  at: { x: number; y: number }
}

const snapGrid = (v: number) => Math.round(v / GRID) * GRID || 0

/** The box a frame or note snaps and aligns by: a frame's border (not its label tab), a note's card. */
export const annotationBox = (a: Annotation): Rect => (a.type === 'frame' ? { x: a.x, y: a.y, w: a.w ?? 0, h: a.h ?? 0 } : annotationRect(a))

/**
 * What Align and Distribute act on in `sel`, in sheet order. A part plugged into a selected board
 * moves with that board, so it is not an item of its own. A part plugged into a board that is not
 * selected is `skipped`: moving it would pull its legs out of the holes.
 */
export function alignable(d: Diagram, sel: Selection): { items: AlignItem[]; skipped: string[] } {
  const chosen = new Set(sel.parts)
  const items: AlignItem[] = []
  const skipped: string[] = []
  for (const p of d.parts) {
    if (!chosen.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    if (p.mount && !isBoard(m)) {
      if (!chosen.has(p.mount.board)) skipped.push(p.uid)
      continue
    }
    items.push({ kind: 'part', uid: p.uid, rect: bodyRect(p, layoutModule(m)), at: { x: p.x, y: p.y } })
  }
  const notes = new Set(sel.annotations ?? [])
  for (const a of d.annotations ?? []) if (notes.has(a.uid)) items.push({ kind: 'note', uid: a.uid, rect: annotationBox(a), at: { x: a.x, y: a.y } })
  return { items, skipped }
}

/**
 * Moves each item by its wanted (dx, dy), rounded so its position lands on the grid, as one new
 * sheet. Moved parts settle as after a drag (a free part dropped onto free holes plugs in).
 * Returns `d` itself when nothing moves.
 */
function applyMoves(d: Diagram, moves: { item: AlignItem; dx: number; dy: number }[]): Diagram {
  let next = d
  const moved: string[] = []
  for (const { item, dx, dy } of moves) {
    const gx = snapGrid(item.at.x + dx) - item.at.x
    const gy = snapGrid(item.at.y + dy) - item.at.y
    if (!gx && !gy) continue
    if (item.kind === 'part') {
      next = moveParts(next, [item.uid], gx, gy)
      moved.push(item.uid)
    } else next = moveAnnotations(next, [item.uid], gx, gy)
  }
  return moved.length ? settleMounts(next, moved) : next
}

/** Lines the selected items up on one edge or centre of their bounding box: one edit. */
export function alignSelection(d: Diagram, sel: Selection, how: AlignHow): Diagram {
  const { items } = alignable(d, sel)
  if (items.length < 2) return d
  const x0 = Math.min(...items.map((i) => i.rect.x))
  const y0 = Math.min(...items.map((i) => i.rect.y))
  const x1 = Math.max(...items.map((i) => i.rect.x + i.rect.w))
  const y1 = Math.max(...items.map((i) => i.rect.y + i.rect.h))
  return applyMoves(
    d,
    items.map((item) => {
      const { x, y, w, h } = item.rect
      switch (how) {
        case 'left': return { item, dx: x0 - x, dy: 0 }
        case 'center': return { item, dx: (x0 + x1) / 2 - (x + w / 2), dy: 0 }
        case 'right': return { item, dx: x1 - (x + w), dy: 0 }
        case 'top': return { item, dx: 0, dy: y0 - y }
        case 'middle': return { item, dx: 0, dy: (y0 + y1) / 2 - (y + h / 2) }
        default: return { item, dx: 0, dy: y1 - (y + h) }
      }
    }),
  )
}

/**
 * Spaces three or more selected items evenly along `axis`: the first and last (by centre) stay,
 * and the others move so the gaps between neighbours are equal. Items that overlap too much for
 * any gap get evenly spaced centres instead. Each position is rounded to the grid. One edit.
 */
export function distributeSelection(d: Diagram, sel: Selection, axis: 'x' | 'y'): Diagram {
  const { items } = alignable(d, sel)
  if (items.length < 3) return d
  const s = (i: AlignItem) => (axis === 'x' ? i.rect.x : i.rect.y)
  const len = (i: AlignItem) => (axis === 'x' ? i.rect.w : i.rect.h)
  const mid = (i: AlignItem) => s(i) + len(i) / 2
  const sorted = [...items].sort((a, b) => mid(a) - mid(b) || s(a) - s(b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const n = sorted.length
  const gap = (s(last) + len(last) - s(first) - sorted.reduce((t, i) => t + len(i), 0)) / (n - 1)
  let cursor = s(first)
  const moves = sorted.map((item, k) => {
    let want: number
    if (gap >= 0) {
      want = cursor - s(item)
      cursor += len(item) + gap
    } else want = mid(first) + ((mid(last) - mid(first)) * k) / (n - 1) - mid(item)
    if (k === 0 || k === n - 1) want = 0
    return axis === 'x' ? { item, dx: want, dy: 0 } : { item, dx: 0, dy: want }
  })
  return applyMoves(d, moves)
}

/**
 * Moves the selected parts (a board with its plugged-in parts) and frames and notes by (dx, dy),
 * as an arrow key does. Moved parts settle as after a drag. Returns `d` itself when nothing moves.
 */
export function nudgeSelection(d: Diagram, sel: Selection, dx: number, dy: number): Diagram {
  let next = sel.parts.length ? moveParts(d, sel.parts, dx, dy) : d
  if (next !== d) next = settleMounts(next, settlingOf(d, sel.parts))
  if (sel.annotations?.length) next = moveAnnotations(next, sel.annotations, dx, dy)
  return next
}
