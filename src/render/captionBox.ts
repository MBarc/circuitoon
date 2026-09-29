// Where a part's caption (designator and value) is drawn: 8.5 px bold text centered under the
// rotated body, below any pin stubs pointing down, or where seatedLabels.ts moves it for a plug-in
// device seated on an outlet (and that outlet). Shared by Part.tsx, the router's label avoidance,
// the export bounds and the layout's overlap checks, so all of them agree.
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from '../format/geometry.ts'
import { LEAD, layoutModule, pinRoom, type ModuleDef, usesTipLabels } from '../format/module.ts'
import { partCaption } from '../format/values.ts'

export const CAPTION_SIZE = 8.5
/** Average advance of one bold 8.5 px character, rounded up so a box never undershoots the text. */
const CAPTION_CHAR = 5.4

export type CaptionPart = { x: number; y: number; rotation?: Rotation; designator: string; values?: Record<string, unknown> }

/** The caption anchor in part-local px (text-anchor middle, on the baseline). */
export function captionAnchor(m: ModuleDef, rotation: Rotation = 0): Pt {
  const box = bodyRect({ x: 0, y: 0, rotation }, layoutModule(m))
  const stubsDown = worldPins({ x: 0, y: 0, rotation }, m).some((p) => p.dir.y > 0)
  // Below the stubs, and below the names past their tips on a part that draws them there.
  return { x: box.x + box.w / 2, y: box.y + box.h + (stubsDown ? (usesTipLabels(m) ? pinRoom(m) : LEAD) : 0) + 15 }
}

/** The caption's box in world px (8 px above the baseline, 2 below). */
export function captionBox(part: CaptionPart, m: ModuleDef, text = partCaption(part, m)): Rect {
  const a = captionAnchor(m, part.rotation ?? 0)
  const w = text.length * CAPTION_CHAR
  return { x: part.x + a.x - w / 2, y: part.y + a.y - 8, w, h: 10 }
}

/** A caption seatedLabels (src/format/seatedLabels.ts) moves: its part-local anchor and text anchor. */
export type CaptionSeat = { caption: Pt; anchor: 'start' | 'middle' }

/**
 * The caption's box in world px where it is drawn: `seat` for a seated plug-in device or its outlet
 * (Part.tsx draws a 'start' caption vertically centred on the anchor, a 'middle' one on its
 * baseline), else under the body as `captionBox`.
 */
export function placedCaptionBox(part: CaptionPart, m: ModuleDef, seat: CaptionSeat | undefined, text = partCaption(part, m)): Rect {
  if (!seat) return captionBox(part, m, text)
  const w = text.length * CAPTION_CHAR
  const { x, y } = seat.caption
  return seat.anchor === 'start' ? { x: part.x + x, y: part.y + y - 5, w, h: 10 } : { x: part.x + x - w / 2, y: part.y + y - 8, w, h: 10 }
}

/**
 * The boxes, in world px, that a part's pin names drawn past the pin tips (`art.pinLabels: "tips"`)
 * take: one per pin, 8 px across, from 2 px past the stub tip out to the longest name's length
 * (pinRoom), so every name of the part gets the same box. Empty for any other part. The router
 * keeps wires off them like captions, and layout keeps wire ends out of the holes under them.
 */
export function tipLabelBoxes(part: { x: number; y: number; rotation?: Rotation }, m: ModuleDef): Rect[] {
  if (!usesTipLabels(m)) return []
  const len = pinRoom(m) - LEAD - 2
  return worldPins(part, m).filter((p) => !p.bus).map((p) => {
    const x = p.end.x + p.dir.x * 2
    const y = p.end.y + p.dir.y * 2
    return p.dir.x !== 0
      ? { x: p.dir.x > 0 ? x : x - len, y: y - 4, w: len, h: 8 }
      : { x: x - 4, y: p.dir.y > 0 ? y : y - len, w: 8, h: len }
  })
}
