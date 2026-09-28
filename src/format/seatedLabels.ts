// Where a plug-in device seated on an outlet puts its caption and lead labels. Under the device (the
// usual place) they would land on the outlet's caption or, on a duplex, under the other device; so the
// caption goes beside the outlet, level with the device, and the labels of leads another part covers
// are drawn inside the device. Pure; one pass over the seated devices.
import { type Diagram, moduleOf } from './diagram.ts'
import { layoutModule } from './module.ts'
import { type Pt, type Rect, bodyRect, worldPins } from './geometry.ts'
import { mainsOf } from './mainsModel.ts'

export interface SeatedLabels {
  /** The caption's anchor point, part-local (the part is drawn translated to its x and y). */
  caption: Pt
  anchor: 'start' | 'middle'
  /** Another part covers the leads: their labels go inside the body, this far in from the edge; null otherwise. */
  labelInset: number | null
}

/** Gap between the outlet's edge and a caption, px. */
const GAP = 8
/** The least a covered lead's label sits in from the body edge, and its clearance from the cover. */
const INSET = 6
const CLEAR = 4
const inside = (r: Rect, p: Pt) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h
/** How far from a pin's body edge, along its direction, the rectangle begins (negative: it overlaps the body). */
function coverFrom(r: Rect, edge: Pt, dir: Pt): number {
  if (dir.y > 0) return r.y - edge.y
  if (dir.y < 0) return edge.y - (r.y + r.h)
  if (dir.x > 0) return r.x - edge.x
  return edge.x - (r.x + r.w)
}

/**
 * Per seated plug-in device uid, where its caption and lead labels go; and per outlet with a device
 * seated on it, its caption above its body (the devices' leads leave below it). Other parts are left out.
 */
export function seatedLabels(d: Pick<Diagram, 'parts' | 'modules'>): Map<string, SeatedLabels> {
  const out = new Map<string, SeatedLabels>()
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const rects = new Map<string, Rect>()
  const rectOf = (uid: string): Rect | null => {
    const hit = rects.get(uid)
    if (hit) return hit
    const q = byUid.get(uid)
    const qm = q && moduleOf(d, q.module)
    if (!q || !qm) return null
    const r = bodyRect(q, layoutModule(qm))
    rects.set(uid, r)
    return r
  }
  for (const p of d.parts) {
    const board = p.mount && byUid.get(p.mount.board)
    const m = moduleOf(d, p.module)
    const bm = board && moduleOf(d, board.module)
    if (!board || !m || !bm || !mainsOf(bm).sockets.length || !mainsOf(m).plug) continue
    const outlet = rectOf(board.uid)!
    const box = rectOf(p.uid)!
    let labelInset: number | null = null
    for (const w of worldPins(p, m))
      for (const q of d.parts) {
        if (q === p || q === board) continue
        const r = rectOf(q.uid)
        if (!r || !inside(r, w.end)) continue
        labelInset = Math.max(labelInset ?? INSET, CLEAR - coverFrom(r, w.edge, w.dir))
      }
    out.set(p.uid, { caption: { x: outlet.x + outlet.w + GAP - p.x, y: box.y + box.h / 2 - p.y }, anchor: 'start', labelInset })
    if (!out.has(board.uid)) out.set(board.uid, { caption: { x: outlet.x + outlet.w / 2 - board.x, y: outlet.y - GAP - board.y }, anchor: 'middle', labelInset: null })
  }
  return out
}
