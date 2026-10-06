// Net labels: named flags that join every label pin of the same name into one electrical node,
// as on a real schematic, so a long or many-ended connection needs no drawn wire. The name is the
// part's `values.net`, trimmed; matching is exact and case-sensitive (SDA and sda are two nets, as
// in KiCad and in a netlist's net names). An empty name joins nothing. Pure.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import { isNetLabel, isSpacer, layoutModule, type ModuleDef } from './module.ts'
import { type Rect, type Rotation, toWorld } from './geometry.ts'
import { natural } from './words.ts'

/** The key a label's name is stored under in `values`. */
export const LABEL_VALUE = 'net'

/** A label's name: its stored `values.net`, trimmed; empty when missing or not text. */
export function labelName(part: Pick<PartInstance, 'values'>): string {
  const v = part.values?.[LABEL_VALUE]
  return typeof v === 'string' ? v.trim() : ''
}

/** The one pin of a net label module (its tag point). */
export function labelPin(m: ModuleDef): string {
  const pin = m.pins.find((p) => !isSpacer(p))
  return pin && !isSpacer(pin) ? pin.name : ''
}

/** A label part with its name and pin. */
export interface PlacedLabel {
  part: PartInstance
  name: string
  pin: string
}

const cache = new WeakMap<Diagram['parts'], { modules: Diagram['modules']; result: PlacedLabel[] }>()

/** Every net label on the sheet (named or not), in sheet order. Cached per parts and modules. */
export function labelsOf(d: Pick<Diagram, 'parts' | 'modules'>): PlacedLabel[] {
  const hit = cache.get(d.parts)
  if (hit && hit.modules === d.modules) return hit.result
  const result: PlacedLabel[] = []
  for (const part of d.parts) {
    const m = moduleOf(d, part.module)
    if (m && isNetLabel(m)) result.push({ part, name: labelName(part), pin: labelPin(m) })
  }
  cache.set(d.parts, { modules: d.modules, result })
  return result
}

/** Named labels grouped by name, each group in sheet order. */
export function labelGroups(d: Pick<Diagram, 'parts' | 'modules'>): Map<string, PlacedLabel[]> {
  const out = new Map<string, PlacedLabel[]>()
  for (const l of labelsOf(d)) {
    if (!l.name) continue
    const list = out.get(l.name)
    if (list) list.push(l)
    else out.set(l.name, [l])
  }
  return out
}

/** Whether the part `uid` is a net label. */
export function isLabelPart(d: Pick<Diagram, 'parts' | 'modules'>, uid: string): boolean {
  return labelsOf(d).some((l) => l.part.uid === uid)
}

/**
 * The flag's height and the depth of its point, in px (module-local; the body is two units tall).
 * Under one grid unit, so labels on neighbouring header pins (0.1 inch apart) stack without touching.
 */
export const FLAG_H = 8.6
export const FLAG_POINT = 5
/** Room the ground mark or the mains bolt takes at the flag's square end, in px. */
export const FLAG_MARK = 7
/** Width of one character of the flag's 7 px bold name, a little generous so text never overruns. */
const CHAR_W = 4.6
/** Longest name the flag shows whole; a longer one is cut with an ellipsis (the Inspector shows it all). */
export const FLAG_MAX_CHARS = 24

/** The name as the flag shows it: "?" for an unnamed label, cut at FLAG_MAX_CHARS. */
export function flagText(name: string): string {
  if (!name) return '?'
  return name.length > FLAG_MAX_CHARS ? `${name.slice(0, FLAG_MAX_CHARS - 1)}…` : name
}

/**
 * The flag's width in px from its point (the pin, at local x 0) to its square end: the point, the
 * name with padding, and room for the ground mark when `ground`. Never narrower than 28 px.
 */
export function flagWidth(name: string, ground = false): number {
  return Math.max(20, Math.ceil(FLAG_POINT + 3 + flagText(name).length * CHAR_W + 4 + (ground ? FLAG_MARK : 0)))
}

/**
 * The drawn flag of label `part` in world px (rotation applied), from its point to its square end:
 * what the editor outlines when the label is selected or shares a name with the hovered one. The
 * ground mark widens a ground label's flag; `ground` says whether it is drawn.
 */
export function flagRect(part: { x: number; y: number; rotation?: Rotation; values?: Record<string, unknown> }, m: ModuleDef, ground = false): Rect {
  return flagBox(part, m, flagWidth(labelName(part), ground), FLAG_H)
}
/** A box `w` long from the label's point and `h` across, centred on its pin, in world px: a flag of any size (a probe's tag). */
export function flagBox(part: { x: number; y: number; rotation?: Rotation }, m: ModuleDef, w: number, h: number): Rect {
  const lay = layoutModule(m)
  const mid = lay.pins[0]?.edge.y ?? lay.h / 2
  const a = toWorld(part, lay, { x: 0, y: mid - h / 2 })
  const b = toWorld(part, lay, { x: w, y: mid + h / 2 })
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** The other labels with the same name as label `uid`, in designator order; empty for an unnamed label or a part that is not one. */
export function labelMates(d: Pick<Diagram, 'parts' | 'modules'>, uid: string): PartInstance[] {
  const me = labelsOf(d).find((l) => l.part.uid === uid)
  if (!me?.name) return []
  return labelsOf(d).filter((l) => l.name === me.name && l.part.uid !== uid).map((l) => l.part).sort((a, b) => natural.compare(a.designator, b.designator))
}
