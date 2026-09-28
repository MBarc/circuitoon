// Where a part's caption (designator and value) is drawn: 8.5 px bold text centered under the
// rotated body, below any pin stubs pointing down. Shared by Part.tsx and the layout's overlap
// checks, so both always agree.
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from '../format/geometry.ts'
import { LEAD, layoutModule, type ModuleDef } from '../format/module.ts'
import { partCaption } from '../format/values.ts'

export const CAPTION_SIZE = 8.5
/** Average advance of one bold 8.5 px character, rounded up so a box never undershoots the text. */
const CAPTION_CHAR = 5.4

export type CaptionPart = { x: number; y: number; rotation?: Rotation; designator: string; values?: Record<string, unknown> }

/** The caption anchor in part-local px (text-anchor middle, on the baseline). */
export function captionAnchor(m: ModuleDef, rotation: Rotation = 0): Pt {
  const box = bodyRect({ x: 0, y: 0, rotation }, layoutModule(m))
  const stubsDown = worldPins({ x: 0, y: 0, rotation }, m).some((p) => p.dir.y > 0)
  return { x: box.x + box.w / 2, y: box.y + box.h + (stubsDown ? LEAD : 0) + 15 }
}

/** The caption's box in world px (8 px above the baseline, 2 below). */
export function captionBox(part: CaptionPart, m: ModuleDef, text = partCaption(part, m)): Rect {
  const a = captionAnchor(m, part.rotation ?? 0)
  const w = text.length * CAPTION_CHAR
  return { x: part.x + a.x - w / 2, y: part.y + a.y - 8, w, h: 10 }
}
