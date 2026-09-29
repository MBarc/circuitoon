// Rectangles the layout keeps apart: a part's body and caption (tight: what must never overlap
// another part's, spec 2.1), the same with room for pin stubs and labels (what free placement spaces
// out), and a bucketed index to test a candidate spot against everything placed so far. Pure.
import type { PartInstance } from '../format/diagram.ts'
import { type Rect, bodyRect } from '../format/geometry.ts'
import { LEAD, layoutModule, pinRoom, type ModuleDef } from '../format/module.ts'
import { captionBox } from '../render/captionBox.ts'

/** Room kept around a free part's body for its pin stubs and the labels beside them. */
export const PIN_ROOM = LEAD + 10

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
export const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })
export const shift = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy })
/** True when two rectangles share area; touching edges do not count. */
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Body plus caption. */
export function tightFootprint(p: PartInstance, m: ModuleDef): Rect {
  return union(bodyRect(p, layoutModule(m)), captionBox(p, m))
}

/** Body grown by PIN_ROOM (more for labels past the pin tips, see pinRoom), plus caption. */
export function footprint(p: PartInstance, m: ModuleDef): Rect {
  return union(grow(bodyRect(p, layoutModule(m)), Math.max(PIN_ROOM, pinRoom(m))), captionBox(p, m))
}

const CELL = 200

/** Placed rectangles bucketed on a 200 px grid, so a spot test looks only at its neighbours. */
export class RectIndex {
  private cells = new Map<string, Rect[]>()
  private keys(r: Rect): string[] {
    const out: string[] = []
    for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++)
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) out.push(`${cx},${cy}`)
    return out
  }
  add(r: Rect) {
    for (const k of this.keys(r)) {
      const list = this.cells.get(k)
      if (list) list.push(r)
      else this.cells.set(k, [r])
    }
  }
  hits(r: Rect): boolean {
    for (const k of this.keys(r)) for (const o of this.cells.get(k) ?? []) if (intersects(o, r)) return true
    return false
  }
}
