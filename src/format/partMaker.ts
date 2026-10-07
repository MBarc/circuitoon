// The part maker's core, shared by the editor's New part dialog and `circuitoon module new|check`.
// A part spec (name, category, body, pins per side in physical order) becomes a custom module with
// Sticker-style art; lintModule says what is wrong or doubtful about any module; parsePinLines turns
// pasted lines ("1 VCC power", "GND") into pins. Pure and erasable TS, so node runs it directly.
//
// A custom part is user-made and unverified: `custom: true` and an id starting with "custom-", so it
// never collides with a built-in id. The checker treats it like any part, using the pin types given.
import {
  CUSTOM_PREFIX, GRID, MODULE_FORMAT, MODULE_PX_MAX, PIN_TYPES, SIDES, artShapeErrors, isCustom, isObj, isNum, isSpacer, layoutModule, photoError, validateModule,
  type Art, type ArtShape, type ModuleDef, type PinCaps, type PinDef, type PinEntry, type PinType, type Side,
} from './module.ts'
import { parseSupply } from './checks.ts'

export const SPEC_FORMAT = 'circuitoon-part-spec/1'
export const PART_FILE_SUFFIX = '.circuitoon-part.json'

/** One pin in a spec: a name, null for a spacer (a physical gap), or the pin's fields. */
export type PinSpec = string | null | PinSpecObject
export interface PinSpecObject {
  name?: string
  label?: string
  type?: PinType
  supply?: string
  caps?: PinCaps
  spacer?: true
}
export type PartStyle = 'board' | 'chip'
export interface PartSpec {
  format?: typeof SPEC_FORMAT
  name: string
  /** Kebab-case; the module id is this when it starts with "custom-", else "custom-" + this (or + the name, made kebab-case). Kept exactly, never cut. */
  id?: string
  category?: string
  /** The datasheet and pinout URLs, one string separated by spaces or a list. */
  source?: string | string[]
  version?: number
  /** "board": a header strip and the pin names inside the body (the default); "chip": a dark body with the names past the pin tips. */
  style?: PartStyle
  /** Body size in grid units (10 px each) and colour (#RRGGBB). Left out, the size fits the pins and their labels. */
  body?: { w?: number; h?: number; color?: string }
  /**
   * The part's own drawing, in place of the generated one: rects in module px on a body of body.w x
   * body.h grid units (or art.w x art.h px, multiples of 10), origin at its top left. The pins are
   * still placed from `pins`, over the drawing. Left out, the part maker draws a board or a chip.
   */
  art?: SpecArt
  /** Pins per side in physical order: left and right top to bottom, top and bottom left to right. */
  pins: Partial<Record<Side, PinSpec[]>>
  /** Pins joined inside the part (all its GND pins). */
  internal?: string[][]
  /** One sentence on what the part is, for the closest-match search. */
  description?: string
  /** Typical uses ("plant monitor"), for the closest-match search. */
  uses?: string[]
  /** The product photo the art was drawn from (an http(s) URL), or "none" when no photo exists (see ModuleDef.photo). */
  photo?: string
}

/** A spec's own art: the module art language without `band`, `capCode` and `horn` (built-in parts only). `w` and `h` (px) are optional, so a module's art copies in whole. */
export interface SpecArt {
  w?: number
  h?: number
  /** "inside": pin names inside the body beside each pin (boards); "tips": past the stub tips (chips); left out: beside the stub, outside the body. */
  pinLabels?: Art['pinLabels']
  shapes: ArtShape[]
}

export const DEFAULT_CATEGORY = 'Custom'
export const DEFAULT_COLORS: Record<PartStyle, string> = { board: '#2F9E6E', chip: '#2B2F36' }
/** Swatches the editor offers: the library's PCB and body colours. */
export const BODY_COLORS = ['#2F9E6E', '#1E4F8A', '#2B2F36', '#7B3FA0', '#C0392B', '#F4B400', '#EEF0EC', '#D98C2B']
const UNITS_MAX = MODULE_PX_MAX / GRID
const NAME_MAX = 120
/** Pins and gaps a side may hold: each takes 10 px, and the body keeps a unit at each end, within the 4000 px cap. */
export const SLOTS_MAX = UNITS_MAX - 2
const PIN_NAME_MAX = 60
/** A paste longer than this is refused whole (a part has at most 4 x SLOTS_MAX pins, one a line). */
export const PASTE_LINES_MAX = 2000
export const PASTE_CHARS_MAX = 200_000
const ID_MAX = 200

const GOLD = '#E0B43C'
export const HOLE_FILL = '#8A6A1E'
const PLATE = '#F7F8F3'
const INK = '#23282F'
const METAL = '#C9CED6'
/** Pin labels: 7 px bold, about 4.5 px a character plus the halo (as module.ts pinRoom). */
const labelPx = (n: number) => (n ? Math.ceil(n * 4.5 + 3) : 0)
/** The renderer's inset for labels inside a body with a header strip (Part.tsx HEADER_INSET). */
const INSET = 12
const PLATE_H = 16
const PLATE_CHARS = 22
const COLOR_RE = /^#[0-9a-f]{6}$/i
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SPEC_KEYS = ['format', 'name', 'id', 'category', 'source', 'description', 'uses', 'photo', 'version', 'style', 'body', 'art', 'pins', 'internal']
const ART_KEYS = ['w', 'h', 'pinLabels', 'shapes']
const BUILT_IN_SHAPE_KEYS = ['band', 'capCode', 'horn']
const SHAPE_KEYS = ['type', 'x', 'y', 'w', 'h', 'fill', 'radius', 'outline', 'label', 'labelColor', 'labelSize']
/** How far, in px, a spec art shape may reach past the body's edge: a jack, a USB plug or a cable stub sticking out, as built-in boards draw their USB ports. */
export const ART_OVERHANG = 20
const PIN_KEYS = ['name', 'label', 'type', 'supply', 'caps', 'spacer']

/** A name made kebab-case for an id: "My Sensor (v2)" is "my-sensor-v2". */
export function slugify(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return slug || 'part'
}

/** The module id for a spec: its id exactly ("custom-" added when missing), else "custom-" + its name, kebab-case. */
export function customId(spec: Pick<PartSpec, 'id' | 'name'>): string {
  const base = spec.id ?? slugify(spec.name)
  return base.startsWith(CUSTOM_PREFIX) ? base : CUSTOM_PREFIX + base
}

export type SpecResult = { ok: true; spec: PartSpec } | { ok: false; errors: string[] }

/** Checks a parsed JSON value against the part spec format. Errors name the exact path. */
export function validateSpec(raw: unknown): SpecResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['spec must be a JSON object'] }
  for (const k of Object.keys(raw)) if (!SPEC_KEYS.includes(k)) errors.push(`${k}: unknown field (allowed: ${SPEC_KEYS.join(', ')})`)
  if (raw.format !== undefined && raw.format !== SPEC_FORMAT) errors.push(`format: must be "${SPEC_FORMAT}" when present`)
  if (typeof raw.name !== 'string' || raw.name.trim() === '') errors.push('name: required')
  else if (raw.name.length > NAME_MAX) errors.push(`name: at most ${NAME_MAX} characters`)
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !ID_RE.test(raw.id) || raw.id.length > ID_MAX)) errors.push(`id: must be lowercase kebab-case, for example "my-sensor", at most ${ID_MAX} characters`)
  if (raw.category !== undefined && (typeof raw.category !== 'string' || raw.category.trim() === '' || raw.category.length > 60)) errors.push('category: must be a non-empty string, at most 60 characters')
  if (raw.description !== undefined && typeof raw.description !== 'string') errors.push('description: must be a string (one sentence)')
  if (raw.uses !== undefined && !(Array.isArray(raw.uses) && raw.uses.every((u) => typeof u === 'string'))) errors.push('uses: must be a list of strings')
  if (raw.photo !== undefined && photoError(raw.photo)) errors.push(photoError(raw.photo)!)
  if (raw.source !== undefined && typeof raw.source !== 'string' && !(Array.isArray(raw.source) && raw.source.every((s) => typeof s === 'string')))
    errors.push('source: must be a string or a list of strings (URLs)')
  if (raw.version !== undefined && !(Number.isInteger(raw.version) && (raw.version as number) >= 1)) errors.push('version: must be a whole number, 1 or more')
  if (raw.style !== undefined && raw.style !== 'board' && raw.style !== 'chip') errors.push('style: must be "board" or "chip"')
  if (raw.body !== undefined) {
    const b = raw.body
    if (!isObj(b)) errors.push('body: must be { "w"?, "h"?, "color"? }')
    else {
      for (const k of Object.keys(b)) if (!['w', 'h', 'color'].includes(k)) errors.push(`body.${k}: unknown field`)
      for (const k of ['w', 'h'] as const)
        if (b[k] !== undefined && !(Number.isInteger(b[k]) && (b[k] as number) >= 2 && (b[k] as number) <= UNITS_MAX)) errors.push(`body.${k}: must be a whole number of grid units from 2 to ${UNITS_MAX}`)
      if (b.color !== undefined && (typeof b.color !== 'string' || !COLOR_RE.test(b.color))) errors.push('body.color: must be a colour like "#2F9E6E"')
    }
  }
  let count = 0
  if (!isObj(raw.pins)) errors.push('pins: required, { "left": [...], "right": [...], "top": [...], "bottom": [...] }')
  else
    for (const [side, list] of Object.entries(raw.pins)) {
      if (!SIDES.includes(side as Side)) {
        errors.push(`pins.${side}: unknown side (left, right, top or bottom)`)
        continue
      }
      if (!Array.isArray(list)) {
        errors.push(`pins.${side}: must be a list`)
        continue
      }
      if (list.length > SLOTS_MAX) {
        errors.push(`pins.${side}: at most ${SLOTS_MAX} pins and gaps a side (${list.length} given), so the body stays within ${MODULE_PX_MAX} px`)
        continue
      }
      list.forEach((p, i) => {
        const at = `pins.${side}[${i}]`
        if (p === null) return
        if (typeof p === 'string') {
          if (p.trim() === '') errors.push(`${at}: a pin name may not be empty`)
          else if (p.trim().length > PIN_NAME_MAX) errors.push(`${at}: a pin name is at most ${PIN_NAME_MAX} characters`)
          else count++
          return
        }
        if (!isObj(p)) return void errors.push(`${at}: must be a name, null (a gap) or { "name", "type"?, "supply"?, ... }`)
        for (const k of Object.keys(p)) if (!PIN_KEYS.includes(k)) errors.push(`${at}.${k}: unknown field`)
        if (p.spacer !== undefined) {
          if (p.spacer !== true) errors.push(`${at}.spacer: must be true`)
          else if (Object.keys(p).length > 1) errors.push(`${at}: a spacer takes no other field`)
          return
        }
        if (typeof p.name !== 'string' || p.name.trim() === '') errors.push(`${at}.name: required`)
        else if (p.name.trim().length > PIN_NAME_MAX) errors.push(`${at}.name: at most ${PIN_NAME_MAX} characters`)
        else count++
        if (p.label !== undefined && (typeof p.label !== 'string' || p.label.length > PIN_NAME_MAX)) errors.push(`${at}.label: must be a string, at most ${PIN_NAME_MAX} characters`)
        // A USB port needs its connector and role, which the part maker does not ask for.
        if (p.type !== undefined && (!PIN_TYPES.includes(p.type as PinType) || p.type === 'usb')) errors.push(`${at}.type: must be one of ${PIN_TYPES.filter((t) => t !== 'usb').join(', ')}`)
        if (p.supply !== undefined && typeof p.supply !== 'string') errors.push(`${at}.supply: must be a string such as "3V3" or "3V3/5V"`)
      })
    }
  if (isObj(raw.pins) && count === 0) errors.push('pins: at least one pin')
  if (raw.art !== undefined) {
    const sides = isObj(raw.pins) ? SIDES.filter((s) => Array.isArray((raw.pins as Record<string, unknown>)[s]) && ((raw.pins as Record<string, unknown[]>)[s]).some((p) => p !== null)) : []
    artSpecErrors(raw.art, isObj(raw.body) ? raw.body : {}, new Set(sides), errors)
  }
  if (raw.internal !== undefined && !(Array.isArray(raw.internal) && raw.internal.every((g) => Array.isArray(g) && g.every((n) => typeof n === 'string'))))
    errors.push('internal: must be a list of pin-name groups')
  return errors.length ? { ok: false, errors } : { ok: true, spec: raw as unknown as PartSpec }
}

/** The body in px a spec's art is drawn on: body.w and body.h (grid units), else art.w and art.h; null when neither gives a side. */
function artBox(art: Record<string, unknown>, body: Record<string, unknown>): { w: number; h: number } | null {
  const side = (k: 'w' | 'h') => (Number.isInteger(body[k]) ? (body[k] as number) * GRID : Number.isInteger(art[k]) ? (art[k] as number) : null)
  const w = side('w')
  const h = side('h')
  return w !== null && h !== null ? { w, h } : null
}

/** A spec's `art`: the module rules for every shape (artShapeErrors), plus the body box, no built-in-only fields, and shapes on the body. */
function artSpecErrors(art: unknown, body: Record<string, unknown>, pinned: Set<Side>, errors: string[]) {
  if (!isObj(art)) return void errors.push('art: must be { "shapes": [...], "pinLabels"? }')
  for (const k of Object.keys(art)) if (!ART_KEYS.includes(k)) errors.push(`art.${k}: unknown field (allowed: ${ART_KEYS.join(', ')})`)
  if (art.pinLabels !== undefined && art.pinLabels !== 'inside' && art.pinLabels !== 'tips') errors.push('art.pinLabels: must be "inside" or "tips"')
  for (const k of ['w', 'h'] as const) {
    const v = art[k]
    if (v === undefined) continue
    if (!(Number.isInteger(v) && (v as number) % GRID === 0 && (v as number) >= 2 * GRID && (v as number) <= MODULE_PX_MAX)) errors.push(`art.${k}: must be a multiple of 10 px, from 20 to ${MODULE_PX_MAX}`)
    else if (Number.isInteger(body[k]) && (body[k] as number) * GRID !== v) errors.push(`art.${k}: ${v} px does not match body.${k} (${body[k]} grid units, ${(body[k] as number) * GRID} px)`)
  }
  const box = artBox(art, body)
  if (!box) errors.push('art: give the body size: body.w and body.h in grid units (or art.w and art.h in px, multiples of 10)')
  if (!Array.isArray(art.shapes)) return void errors.push('art.shapes: required, a list of rects')
  if (!art.shapes.length) return void errors.push('art.shapes: at least one shape')
  const shapeErrors = artShapeErrors(art.shapes)
  errors.push(...shapeErrors)
  art.shapes.forEach((s, i) => {
    const at = `art.shapes[${i}]`
    if (!isObj(s)) return
    for (const k of BUILT_IN_SHAPE_KEYS) if (s[k] !== undefined) errors.push(`${at}.${k}: built-in parts only`)
    for (const k of Object.keys(s)) if (!SHAPE_KEYS.includes(k) && !BUILT_IN_SHAPE_KEYS.includes(k)) errors.push(`${at}.${k}: unknown field (allowed: ${SHAPE_KEYS.join(', ')})`)
    for (const k of ['fill', 'labelColor']) if (typeof s[k] === 'string' && !COLOR_RE.test(s[k] as string)) errors.push(`${at}.${k}: must be a colour like "#2F9E6E"`)
    if (!box || shapeErrors.some((e) => e.startsWith(`${at}.`) || e.startsWith(`${at}:`)) || ![s.x, s.y, s.w, s.h].every(isNum)) return
    const [x, y, w, h] = [s.x, s.y, s.w, s.h] as number[]
    const past: [Side, string, number][] = [['left', 'left edge', -x], ['top', 'top edge', -y], ['right', `right edge (${box.w} px)`, x + w - box.w], ['bottom', `bottom edge (${box.h} px)`, y + h - box.h]]
    for (const [side, edge, by] of past) {
      // The art is drawn over the pin stubs: a shape sticking out of a side with pins would hide them.
      if (by > 0 && pinned.has(side)) errors.push(`${at}: sticks out ${by} px past the ${side} edge, which has pins: it would cover their stubs. Only a side without pins may have a shape sticking out.`)
      else if (by > ART_OVERHANG) errors.push(`${at}: reaches ${by} px past the body's ${edge}; at most ${ART_OVERHANG} px may stick out`)
    }
  })
}

/**
 * Pin entries for one side, from the spec, in order. Every pin gets an explicit label (its name
 * unless the spec gives one): the renderer hides unlabelled names on a part with one or two pins
 * (a resistor's "1" and "2"), and a custom part's names are the point of it.
 */
function sideEntries(side: Side, list: PinSpec[]): PinEntry[] {
  return list.map((p): PinEntry => {
    if (p === null || (typeof p === 'object' && p.spacer)) return { spacer: true, side }
    if (typeof p === 'string') return { name: p.trim(), side, label: p.trim() }
    const pin: PinDef = { name: p.name!.trim(), side, label: p.label !== undefined && p.label !== '' ? p.label : p.name!.trim() }
    if (p.type) pin.type = p.type
    if (p.supply !== undefined && p.supply.trim() !== '') pin.supply = p.supply.trim()
    if (p.caps && Object.keys(p.caps).length) pin.caps = p.caps
    return pin
  })
}

/**
 * Repeated names get a number in physical order, the add-part convention: a second GND becomes
 * "GND 2" with the label "GND", so the sheet still shows the silkscreen. Returns what was renamed.
 */
function numberRepeats(pins: PinEntry[]): string[] {
  const named = pins.filter((p): p is PinDef => !isSpacer(p))
  const taken = new Set(named.map((p) => p.name))
  const seen = new Map<string, number>()
  const renamed: string[] = []
  for (const p of named) {
    const n = (seen.get(p.name) ?? 0) + 1
    seen.set(p.name, n)
    if (n === 1) continue
    let k = n
    while (taken.has(`${p.name} ${k}`)) k++
    const base = p.name
    p.label ??= base
    p.name = `${base} ${k}`
    taken.add(p.name)
    renamed.push(`${base} -> ${p.name}`)
  }
  return renamed
}

/** Slot positions (px) along a side `len` units long with `n` slots, as module.ts computeLayout places them. */
function slotPx(len: number, n: number): number[] {
  const s0 = Math.ceil((len - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * GRID)
}

/** A module's short name for its plate: up to the first " (", cut to PLATE_CHARS. */
export function plateText(name: string): string {
  const short = name.split(' (')[0].trim() || name.trim()
  return short.length > PLATE_CHARS ? `${short.slice(0, PLATE_CHARS - 3).trimEnd()}...` : short
}
const plateWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.62) + 12

interface Geometry {
  wu: number
  hu: number
  /** Space the labels take from each edge, in px. */
  zone: Record<Side, number>
  plate: boolean
  /** Labels on two sides cross in a corner. */
  crowded: boolean
}

const labelText = (p: PinEntry) => (isSpacer(p) ? '' : (p.label ?? p.name))

/** Positions (px) of each side's non-spacer pins on a wu x hu body. */
function pinPositions(pins: PinEntry[], wu: number, hu: number): Record<Side, number[]> {
  const out = { top: [], right: [], bottom: [], left: [] } as Record<Side, number[]>
  for (const side of SIDES) {
    const entries = pins.filter((p) => p.side === side)
    const at = slotPx(side === 'top' || side === 'bottom' ? wu : hu, entries.length)
    entries.forEach((p, i) => {
      if (!isSpacer(p)) out[side].push(at[i])
    })
  }
  return out
}

/** Board style: does a corner hold labels from two sides that cross? */
function cornersCross(pins: PinEntry[], wu: number, hu: number, zone: Record<Side, number>): boolean {
  const at = pinPositions(pins, wu, hu)
  const W = wu * GRID
  const H = hu * GRID
  // A left or right label is a horizontal band at its pin's y; a top or bottom label a vertical one at its pin's x.
  for (const [h, hx0, hx1] of [['left', INSET - 4, zone.left + 4], ['right', W - zone.right - 4, W - INSET + 4]] as const)
    for (const [v, vy0, vy1] of [['top', INSET - 4, zone.top + 4], ['bottom', H - zone.bottom - 4, H - INSET + 4]] as const) {
      if (!at[h].length || !at[v].length) continue
      const rows = at[h].some((y) => y > vy0 && y < vy1)
      const cols = at[v].some((x) => x > hx0 && x < hx1)
      if (rows && cols) return true
    }
  return false
}

/** Body size in units: the given size, else the smallest that fits the pins, their labels and the name plate. */
function geometry(pins: PinEntry[], style: PartStyle, plate: string, given?: { w?: number; h?: number }): Geometry {
  const slots = (s: Side) => pins.filter((p) => p.side === s).length
  const has = (s: Side) => pins.some((p) => p.side === s && !isSpacer(p))
  const longest = (s: Side) => pins.reduce((n, p) => (p.side === s ? Math.max(n, labelText(p).length) : n), 0)
  const zone = { top: 6, right: 6, bottom: 6, left: 6 } as Record<Side, number>
  if (style === 'board') for (const s of SIDES) if (has(s)) zone[s] = INSET + labelPx(longest(s)) + 4
  const pw = plateWidth(plate, 8)
  const minW = Math.max(slots('top'), slots('bottom')) + 2
  const minH = Math.max(slots('left'), slots('right')) + 2
  const fits = (wu: number, hu: number) => wu * GRID - zone.left - zone.right >= pw && hu * GRID - zone.top - zone.bottom >= PLATE_H
  if (given?.w !== undefined || given?.h !== undefined) {
    const wu = Math.max(given.w ?? minW, minW, 4)
    const hu = Math.max(given.h ?? minH, minH, 3)
    return { wu, hu, zone, plate: fits(wu, hu), crowded: style === 'board' && cornersCross(pins, wu, hu, zone) }
  }
  let wu = Math.max(minW, 4, Math.ceil((zone.left + zone.right + pw) / GRID))
  let hu = Math.max(minH, 3, Math.ceil((zone.top + zone.bottom + PLATE_H) / GRID))
  // Grow the shorter way first until no corner holds crossing labels (bounded: the body cap).
  while (style === 'board' && cornersCross(pins, wu, hu, zone) && (wu < UNITS_MAX || hu < UNITS_MAX)) {
    if (hu <= wu && hu < UNITS_MAX) hu++
    else wu++
  }
  return { wu, hu, zone, plate: true, crowded: style === 'board' && cornersCross(pins, wu, hu, zone) }
}

/** A Sticker rect. */
const rect = (x: number, y: number, w: number, h: number, fill: string, extra: Partial<ArtShape> = {}): ArtShape => ({ type: 'rect', x, y, w, h, fill, ...extra })

/** Gold header strips along each side with pins, one per run of pins, and a hole per pin, kept in the outer INSET px. */
function headers(pins: PinEntry[], W: number, H: number): ArtShape[] {
  const out: ArtShape[] = []
  for (const side of SIDES) {
    const entries = pins.filter((p) => p.side === side)
    const at = slotPx(side === 'top' || side === 'bottom' ? W / GRID : H / GRID, entries.length)
    const runs: number[][] = []
    let run: number[] = []
    entries.forEach((p, i) => {
      if (isSpacer(p)) {
        if (run.length) runs.push(run)
        run = []
      } else run.push(at[i])
    })
    if (run.length) runs.push(run)
    for (const r of runs) {
      const a0 = r[0] - 5
      const len = r[r.length - 1] + 5 - a0
      if (side === 'left') out.push(rect(2, a0, 8, len, GOLD, { radius: 2, outline: false }))
      if (side === 'right') out.push(rect(W - 10, a0, 8, len, GOLD, { radius: 2, outline: false }))
      if (side === 'top') out.push(rect(a0, 2, len, 8, GOLD, { radius: 2, outline: false }))
      if (side === 'bottom') out.push(rect(a0, H - 10, len, 8, GOLD, { radius: 2, outline: false }))
      for (const a of r) {
        if (side === 'left') out.push(rect(4.5, a - 1.5, 3, 3, HOLE_FILL, { radius: 1.5, outline: false }))
        if (side === 'right') out.push(rect(W - 7.5, a - 1.5, 3, 3, HOLE_FILL, { radius: 1.5, outline: false }))
        if (side === 'top') out.push(rect(a - 1.5, 4.5, 3, 3, HOLE_FILL, { radius: 1.5, outline: false }))
        if (side === 'bottom') out.push(rect(a - 1.5, H - 7.5, 3, 3, HOLE_FILL, { radius: 1.5, outline: false }))
      }
    }
  }
  return out
}

/** Relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The art for a spec on a W x H px body. */
function partArt(pins: PinEntry[], style: PartStyle, color: string, name: string, g: Geometry): ModuleDef['art'] {
  const W = g.wu * GRID
  const H = g.hu * GRID
  const text = plateText(name)
  if (style === 'chip') {
    const light = luminance(color) > 0.3
    const shapes = [
      rect(0, 0, W, H, color, { radius: 3 }),
      // The pin 1 mark: beside the first left pin (top left), else bottom left, where a DIP drawn
      // lying down has its pin 1 (the library's convention).
      rect(5, pins.some((p) => p.side === 'left') || !pins.some((p) => p.side === 'bottom') ? 5 : H - 11, 6, 6, light ? INK : METAL, { radius: 3, outline: false }),
    ]
    if (g.plate) shapes.push(rect((W - plateWidth(text, 8)) / 2, (H - PLATE_H) / 2, plateWidth(text, 8), PLATE_H, color, { outline: false, label: text, labelColor: light ? INK : PLATE, labelSize: 8 }))
    return { w: W, h: H, pinLabels: 'tips', shapes }
  }
  const shapes = [rect(0, 0, W, H, color, { radius: 6 }), ...headers(pins, W, H)]
  if (g.plate) {
    // The name plate, centred in the room the labels leave.
    const x0 = g.zone.left
    const y0 = g.zone.top
    const pw = plateWidth(text, 8)
    const cx = x0 + (W - g.zone.right - x0) / 2
    const cy = y0 + (H - g.zone.bottom - y0) / 2
    shapes.push(rect(Math.round(cx - pw / 2), Math.round(cy - PLATE_H / 2), pw, PLATE_H, PLATE, { radius: 3, label: text, labelColor: INK, labelSize: 8 }))
  }
  return { w: W, h: H, pinLabels: 'inside', shapes }
}

export type BuildResult = { ok: true; module: ModuleDef; notes: string[] } | { ok: false; errors: string[] }

/** A part spec as a custom module, with what was adjusted on the way (`notes`). Never throws. */
export function buildPart(raw: unknown): BuildResult {
  const v = validateSpec(raw)
  if (!v.ok) return v
  const spec = v.spec
  const style = spec.style ?? 'board'
  const notes: string[] = []
  const pins: PinEntry[] = []
  // The module lists sides in one fixed order; each side keeps its physical order.
  for (const side of ['left', 'right', 'top', 'bottom'] as Side[]) for (const p of sideEntries(side, spec.pins[side] ?? [])) pins.push(p)
  // Trailing and leading gaps on a side would only move its pins: kept, they are the user's choice.
  const renamed = numberRepeats(pins)
  if (renamed.length) notes.push(`Repeated pin names were numbered in physical order: ${renamed.join(', ')}. If they are joined inside the part, list them in "internal".`)
  const box = spec.art ? artBox(spec.art as unknown as Record<string, unknown>, (spec.body ?? {}) as Record<string, unknown>)! : null
  const g = geometry(pins, style, plateText(spec.name), box ? { w: box.w / GRID, h: box.h / GRID } : spec.body)
  if (box) {
    // The drawing is made for its box: a body grown under it would leave the pins off the drawing.
    const need = { w: g.wu, h: g.hu }
    const small = (['w', 'h'] as const).flatMap((k) => (need[k] * GRID > box[k] ? [`body.${k}: the pins need at least ${need[k]} grid units with this art (${box[k] / GRID} given)`] : []))
    if (small.length) return { ok: false, errors: small }
  } else {
    if (!g.plate) notes.push('The body is too small for the name plate, so it was left out.')
    if (g.crowded) notes.push('Pin labels on two sides meet in a corner at this body size; make the body larger or leave the size out.')
  }
  const color = spec.body?.color ?? DEFAULT_COLORS[style]
  const source = Array.isArray(spec.source) ? spec.source.map((s) => s.trim()).filter(Boolean).join(' ') : spec.source?.trim()
  const uses = (spec.uses ?? []).map((u) => u.trim()).filter(Boolean)
  const m: ModuleDef = {
    format: MODULE_FORMAT,
    id: customId(spec),
    version: spec.version ?? 1,
    name: spec.name.trim(),
    category: spec.category?.trim() || DEFAULT_CATEGORY,
    ...(source ? { source } : {}),
    ...(spec.description?.trim() ? { description: spec.description.trim() } : {}),
    ...(uses.length ? { uses } : {}),
    ...(spec.photo ? { photo: spec.photo } : {}),
    custom: true,
    pins,
    ...(spec.internal?.length ? { internal: spec.internal } : {}),
    size: { w: g.wu, h: g.hu },
    art: spec.art ? { w: g.wu * GRID, h: g.hu * GRID, ...(spec.art.pinLabels ? { pinLabels: spec.art.pinLabels } : {}), shapes: structuredClone(spec.art.shapes) } : partArt(pins, style, color, spec.name, g),
  }
  const r = validateModule(m)
  if (!r.ok) return { ok: false, errors: r.errors }
  return { ok: true, module: m, notes }
}

/** A part spec as a custom module; throws an Error listing every problem when the spec is not valid. */
export function moduleFromSpec(spec: unknown): ModuleDef {
  const r = buildPart(spec)
  if (!r.ok) throw new Error(`Not a valid part spec: ${r.errors.join('; ')}`)
  return r.module
}

/** The art's body colour (its largest shape's fill). */
function bodyColor(m: ModuleDef): string | undefined {
  let best: ArtShape | undefined
  for (const s of m.art?.shapes ?? []) if (!best || s.w * s.h > best.w * best.h) best = s
  return best && COLOR_RE.test(best.fill) ? best.fill : undefined
}

/** The same art: size, label mode and shapes (key order aside at the top level). */
const sameArt = (a: Art | undefined, b: Art | undefined) =>
  !!a && !!b && a.w === b.w && a.h === b.h && a.pinLabels === b.pinLabels && JSON.stringify(a.shapes) === JSON.stringify(b.shapes)

/** The art the part maker would draw for this module's pins, name, style and size (its generic board or chip). */
function generatedArt(m: ModuleDef): Art | undefined {
  const r = buildPart(plainSpec(m))
  return r.ok ? r.module.art : undefined
}

/**
 * The spec a custom module was built from, near enough to edit it again (the size kept only when it
 * differs from the automatic one). A drawing of its own that the spec can carry (not the generated
 * one) comes back as `art`; one it cannot (a resistor's bands) is left out (see unmodeled).
 */
export function specFromModule(m: ModuleDef): PartSpec {
  const spec = plainSpec(m)
  const art = m.art
  if (!art || sameArt(art, generatedArt(m)) || art.w % GRID || art.h % GRID) return spec
  const own: PartSpec = { ...spec, body: { ...(spec.body?.color ? { color: spec.body.color } : {}), w: art.w / GRID, h: art.h / GRID }, art: { ...(art.pinLabels ? { pinLabels: art.pinLabels } : {}), shapes: art.shapes } }
  const r = buildPart(own)
  return r.ok && sameArt(r.module.art, art) && r.module.size?.w === m.size?.w && r.module.size?.h === m.size?.h ? own : spec
}

/** specFromModule without art: what the part maker's own drawing is made from. */
function plainSpec(m: ModuleDef): PartSpec {
  const style: PartStyle = m.art?.pinLabels === 'tips' ? 'chip' : 'board'
  const pins: Partial<Record<Side, PinSpec[]>> = {}
  for (const p of m.pins) {
    const list = (pins[p.side] ??= [])
    if (isSpacer(p)) {
      list.push(null)
      continue
    }
    const o: PinSpecObject = { name: p.name }
    // A label equal to the name is the part maker's own, so a renamed pin takes its new name.
    if (p.label !== undefined && p.label !== p.name) o.label = p.label
    if (p.type) o.type = p.type
    if (p.supply) o.supply = p.supply
    if (p.caps) o.caps = p.caps
    list.push(o)
  }
  const color = bodyColor(m)
  const spec: PartSpec = {
    format: SPEC_FORMAT,
    name: m.name,
    id: m.id,
    category: m.category ?? DEFAULT_CATEGORY,
    ...(m.source ? { source: m.source } : {}),
    ...(m.description ? { description: m.description } : {}),
    ...(m.uses?.length ? { uses: m.uses } : {}),
    ...(m.photo ? { photo: m.photo } : {}),
    ...(m.version && m.version > 1 ? { version: m.version } : {}),
    style,
    pins,
    ...(m.internal?.length ? { internal: m.internal } : {}),
  }
  const auto = buildPart({ ...spec, body: color ? { color } : undefined })
  const sized = auto.ok && m.size && (auto.module.size?.w !== m.size.w || auto.module.size?.h !== m.size.h)
  spec.body = { ...(sized && m.size ? { w: m.size.w, h: m.size.h } : {}), ...(color ? { color } : {}) }
  return spec
}

// ---- Lint ----

export interface LintIssue {
  code: string
  message: string
  /** The pin it is about, when it is about one. */
  pin?: string
}
export interface LintReport {
  ok: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
}

const ART_GUIDE = 'draw its art per the art guide (references/art.md in the circuitoon-custom-part skill)'
const REBUILD = 'rebuild the part with `module new`, embed it and lay out again.'

/**
 * Whether a part made outside the library looks like the real thing, the message without the
 * part's name: null when it does. Callers pass only parts outside the library (the gate and check
 * every embedded part not in it, module new and check likewise). custom-part-look (the gate
 * blocks): drawn as the generic box the part maker generates, or no `photo`; the generated chip
 * counts as a real look, since a bare chip looks like that. custom-part-no-photo (a warning):
 * `"photo": "none"` with a real look.
 */
// ponytail: "generic" is exact equality with the generated art, so one added shape (and any URL
// in photo) passes, as does "none" on a part that has a maker; compare shape counts or check the
// source's maker domain if agents start gaming it.
export function customLook(m: ModuleDef): LintIssue | null {
  const generic = !m.art || (m.art.pinLabels !== 'tips' && sameArt(m.art, generatedArt(m)))
  if (generic) {
    if (m.photo === 'none') return { code: 'custom-part-look', message: `is drawn as the generic box: ${ART_GUIDE} from the maker's drawing or the typical part, ${REBUILD}` }
    return { code: 'custom-part-look', message: `is drawn as the generic box${m.photo === undefined ? ' and has no `photo`' : ''}: find the maker's product photo, ${ART_GUIDE}, record the photo URL in \`photo\`, ${REBUILD}` }
  }
  if (m.photo === undefined) return { code: 'custom-part-look', message: 'has no `photo`: record the product photo URL you drew it from in `photo`, or "none" if no photo of this part exists anywhere.' }
  if (m.photo === 'none') return { code: 'custom-part-no-photo', message: 'has "photo": "none", so its art was not drawn from a photo of the real part. Say so when you present the design.' }
  return null
}

/** Pin names that are power or ground by convention. */
const POWER_NAME = /^(v(cc|dd|in|bus|bat|sys|s|\+)?|vcc\d*|vdd\d*|gnd\d*|vss|agnd|dgnd|pgnd|3v3|3\.3v|5v|12v|v\+|v-|\+|-|\+?\d+(\.\d+)?v\d*)$/i
const GROUND_NAME = /^(gnd\d*|vss|agnd|dgnd|pgnd|v-|-|0v)$/i

/**
 * What is wrong (errors) or doubtful (warnings) about a module: everything validateModule finds,
 * plus duplicate pin names, art that does not match its pins, impossible pin capabilities, power
 * pins without a type or supply, supplies that do not parse and a missing source; with `look`,
 * how a part made outside the library looks (customLook), as a warning; the caller says whether it is one.
 */
export function lintModule(raw: unknown, opts: { look?: boolean } = {}): LintReport {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []
  const v = validateModule(raw)
  if (!v.ok) {
    for (const e of v.errors) {
      const dup = /duplicate pin name "(.*)"/.exec(e)
      errors.push(dup ? { code: 'duplicate-pin', message: `Two pins are named "${dup[1]}": every pin needs its own name (a second GND is "GND 2" with the label "GND").`, pin: dup[1] } : { code: 'invalid', message: e })
    }
    return { ok: false, errors, warnings }
  }
  const m = v.module
  const pins = m.pins.filter((p): p is PinDef => !isSpacer(p))
  for (const p of pins) {
    const shown = p.label ?? p.name
    const c = p.caps
    if (c?.outputOnly && p.type === 'input') errors.push({ code: 'type-caps', message: `${p.name} is typed input but marked output only.`, pin: p.name })
    if (c?.inputOnly && p.type === 'output') errors.push({ code: 'type-caps', message: `${p.name} is typed output but marked input only.`, pin: p.name })
    const power = p.type === 'power_in' || p.type === 'power_out' || p.type === 'ground'
    if (c && power && (c.inputOnly || c.outputOnly || c.strapping || c.flash)) warnings.push({ code: 'caps-on-power', message: `${p.name} is a power or ground pin with signal capabilities (input only, output only, strapping or flash); check the datasheet.`, pin: p.name })
    if (!p.type && POWER_NAME.test(shown)) {
      const want = GROUND_NAME.test(shown) ? 'ground' : 'power_in (or power_out if the part supplies it)'
      warnings.push({ code: 'power-untyped', message: `${p.name} looks like a power pin but has no type, so the checker cannot check its supply. Set it to ${want} if the datasheet agrees.`, pin: p.name })
    }
    if ((p.type === 'power_in' || p.type === 'power_out') && !p.supply) warnings.push({ code: 'power-no-supply', message: `${p.name} is a power pin with no supply voltage, so wrong-voltage hookups are not caught. Give the rails it takes, for example "3V3/5V".`, pin: p.name })
    if (p.type === 'ground' && p.supply) warnings.push({ code: 'ground-supply', message: `${p.name} is a ground pin with a supply voltage; a ground takes none.`, pin: p.name })
    if (p.supply && parseSupply(p.supply).unknown === 'unknown') warnings.push({ code: 'supply-unknown', message: `${p.name}'s supply "${p.supply}" is not a voltage the checker reads; write rails like "3V3", "5V" or "3V3/5V" ("ADJ" when it is set by the user).`, pin: p.name })
  }
  if (pins.length && pins.every((p) => !p.type)) warnings.push({ code: 'no-types', message: 'No pin has a type, so the wiring checker can check nothing about this part.' })
  const urls = (m.source ?? '').split(/\s+/).filter(Boolean)
  if (!urls.length) warnings.push({ code: 'no-source', message: 'No source: cite the maker\'s datasheet or pinout page (and a second source that agrees) in "source".' })
  else if (urls.some((u) => !/^https?:\/\/\S+$/.test(u))) warnings.push({ code: 'source-not-url', message: '"source" should be URLs separated by spaces.' })
  if (!isCustom(m)) warnings.push({ code: 'not-custom', message: `Not marked as a custom part: a part made outside the library should have "custom": true and an id starting with "${CUSTOM_PREFIX}".` })
  if (m.name.length > NAME_MAX) warnings.push({ code: 'long-name', message: `The name is over ${NAME_MAX} characters.` })
  if (m.firmware) warnings.push({ code: 'firmware-custom', message: 'Code on custom parts is not supported yet, so this part\'s "firmware" is ignored.' })
  lintArt(m, errors, warnings)
  // How it looks: for agents (module new and check), never in the editor's dialog, where people make parts.
  const look = opts.look ? customLook(m) : null
  if (look) warnings.push({ ...look, message: `${m.name} ${look.message}` })
  return { ok: errors.length === 0, errors, warnings }
}

/** Art that does not match the pins: a body that grows past the drawing, or header holes off every pin. */
function lintArt(m: ModuleDef, errors: LintIssue[], warnings: LintIssue[]) {
  const art = m.art
  if (!art) return
  const lay = layoutModule(m)
  if (art.w < lay.w || art.h < lay.h)
    warnings.push({ code: 'art-pins', message: `The art is ${art.w} x ${art.h} px but the pins need a body of ${lay.w} x ${lay.h} px, so some pins would stick out of empty paper.` })
  if (!isCustom(m)) return
  const ax = (lay.w - art.w) / 2
  const ay = (lay.h - art.h) / 2
  for (const s of art.shapes) {
    if (s.fill !== HOLE_FILL || s.w > 4 || s.h > 4) continue
    const x = ax + s.x + s.w / 2
    const y = ay + s.y + s.h / 2
    const near = lay.pins.some((p) => (p.dir.x !== 0 ? Math.abs(p.edge.y - y) < 0.5 && Math.abs(p.edge.x - x) <= INSET : Math.abs(p.edge.x - x) < 0.5 && Math.abs(p.edge.y - y) <= INSET))
    if (!near) {
      errors.push({ code: 'art-pins', message: `A header hole is drawn at ${x}, ${y} with no pin there: the art does not match the pins. Rebuild the part from its spec.` })
      return
    }
  }
}

// ---- Pasted pins ----

const TYPE_WORDS: Record<string, PinType> = {
  power: 'power_in', pwr: 'power_in', power_in: 'power_in', 'power-in': 'power_in', vin: 'power_in', supply: 'power_in',
  power_out: 'power_out', 'power-out': 'power_out', pwr_out: 'power_out', vout: 'power_out',
  ground: 'ground', gnd: 'ground',
  in: 'input', input: 'input',
  out: 'output', output: 'output',
  io: 'io', 'i/o': 'io', gpio: 'io', bidir: 'io', bidirectional: 'io',
  passive: 'passive',
  nc: 'nc', 'n/c': 'nc', 'no-connect': 'nc',
}
const SUPPLY_RE = /^((\d+(\.\d+)?V|\d+V\d+|ADJ)(\/(\d+(\.\d+)?V|\d+V\d+|ADJ))*)$/i
const HEADER_WORDS = new Set(['pin', 'no', 'no.', '#', 'number', 'name', 'type', 'function', 'supply', 'voltage', 'label', 'description'])

export interface PastedPin {
  side: Side
  pin: PinSpecObject
}

/**
 * Pins from pasted lines, one pin a line: an optional pin number, the name, then optionally a type
 * word (power, ground, in, out, io, passive, nc, power_out ...) and a supply ("3V3", "5V", "3V3/5V").
 * Separators are spaces, tabs, commas, semicolons or "|". A line "Left:" (or Right, Top, Bottom)
 * sends the lines after it to that side; blank lines, lines starting with "#" (comments) and a header row are skipped; "#" or "-" inside a name is part of it.
 * A line it cannot read is reported by number and left out, never guessed.
 */
export function parsePinLines(text: string, side: Side = 'left'): { pins: PastedPin[]; errors: string[] } {
  const pins: PastedPin[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/, PASTE_LINES_MAX + 1)
  if (text.length > PASTE_CHARS_MAX || lines.length > PASTE_LINES_MAX)
    return { pins, errors: [`This is too long to paste: at most ${PASTE_LINES_MAX} lines and ${PASTE_CHARS_MAX} characters (a part has at most ${SLOTS_MAX} pins a side). Nothing was added.`] }
  let at = side
  lines.forEach((line, i) => {
    const n = i + 1
    const body = line.trim()
    // Only a whole line starting with "#" is a comment: "#" inside a name (RESET#, #CS) is the name.
    if (!body || body.startsWith('#')) return
    const head = /^(left|right|top|bottom)\s*:?\s*$/i.exec(body)
    if (head) {
      at = head[1].toLowerCase() as Side
      return
    }
    const tokens = body.split(/[\s,;|]+/).filter(Boolean)
    if (tokens.every((t) => HEADER_WORDS.has(t.toLowerCase()))) return
    // A leading pin number ("1", "12.", "pin 3" is read as the number 3) is the order, already given by the line.
    if (/^(pin)$/i.test(tokens[0]) && /^\d+\.?$/.test(tokens[1] ?? '')) tokens.splice(0, 2)
    else if (/^(pin)?\d+\.?$/i.test(tokens[0]) && tokens.length > 1) tokens.shift()
    const [name, ...rest] = tokens
    if (!name) return void errors.push(`Line ${n}: no pin name.`)
    // "1 - ground": a pin named "-" of type ground, or a dash between the number and the name? Not guessed.
    if (name === '-' && rest.length) return void errors.push(`Line ${n}: a lone "-" could be a pin named "-" or a separator. Write the pin name right after the number (for example "1 GND ground"), or "1 -" alone for a pin named "-".`)
    const pin: PinSpecObject = { name }
    for (const t of rest) {
      const type = Object.hasOwn(TYPE_WORDS, t.toLowerCase()) ? TYPE_WORDS[t.toLowerCase()] : undefined
      if (type && !pin.type) pin.type = type
      else if (SUPPLY_RE.test(t) && !pin.supply) pin.supply = t.toUpperCase()
      else return void errors.push(`Line ${n}: "${t}" is not a pin type or a supply voltage (types: power, power_out, ground, in, out, io, passive, nc; supplies like 3V3 or 5V).`)
    }
    pins.push({ side: at, pin })
  })
  return { pins, errors }
}

/** What a module field is, for the list of what the part maker would drop. */
const FIELD_WORDS: Record<string, string> = {
  electrical: 'electrical data (values, I2C, power and mains)', holes: 'hole groups', art: 'its own drawing', size: 'its body size',
  kicad: 'its KiCad footprint', states: 'states', obstacle: 'routing over it', footprint: 'a breadboard footprint', netLabel: 'the net label role', pins: 'pin details (bus, capacity, mains roles)',
}

/**
 * What the part maker cannot rebuild from this module's spec, in words: empty for a part it made,
 * else the fields a rebuild would change or drop (an imported resistor's value, a board's holes).
 */
export function unmodeled(m: ModuleDef): string[] {
  const r = buildPart(specFromModule(m))
  if (!r.ok) return ['pins the part maker cannot draw']
  // A pin's label defaults to its name (parts saved before labels were explicit have none).
  const labelled = (x: ModuleDef) => ({ ...x, pins: x.pins.map((p) => (isSpacer(p) ? p : { ...p, label: p.label ?? p.name })) }) as unknown as Record<string, unknown>
  const rebuilt = labelled(r.module)
  const own = labelled(m)
  const keys = new Set([...Object.keys(own), ...Object.keys(rebuilt)])
  // The category, source, description, uses and photo are edited in the dialog; a missing category only gains the default.
  for (const k of ['format', 'id', 'custom', 'version', 'name', 'category', 'source', 'description', 'uses', 'photo', 'internal']) keys.delete(k)
  return [...keys].filter((k) => JSON.stringify(own[k]) !== JSON.stringify(rebuilt[k])).map((k) => FIELD_WORDS[k] ?? k)
}
