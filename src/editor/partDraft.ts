// The part maker dialog's working copy of a part (a draft): rows per side that the person edits, and
// the conversions to and from a part spec. Pure, so it is unit-tested apart from the dialog.
import { SIDES, isSpacer, validateModule, type ModuleDef, type PinCaps, type PinEntry, type PinType, type Side } from '../format/module.ts'
import { type BuildResult, type PartSpec, type PartStyle, type PastedPin, DEFAULT_CATEGORY, DEFAULT_COLORS, SPEC_FORMAT, buildPart, customId, specFromModule, unmodeled } from '../format/partMaker.ts'
import { type MyPart, freeId } from './myParts.ts'
import { modulesById } from '../library.ts'

export interface PinRow {
  /** Stable React key and focus target. */
  key: number
  spacer: boolean
  name: string
  type: PinType | ''
  supply: string
  /** Kept from an imported or edited part; the dialog does not edit them. */
  label?: string
  caps?: PinCaps
}
export interface Draft {
  name: string
  category: string
  maker: string
  /** Datasheet and pinout links, one per line (or separated by spaces). */
  source: string
  style: PartStyle
  color: string
  /** False: the body fits the pins. True: `w` x `h` grid units. */
  sized: boolean
  w: number
  h: number
  pins: Record<Side, PinRow[]>
  internal?: string[][]
  /** The module id while editing a saved part: it stays, so sheets using the part follow the edit. */
  id?: string
}

let nextKey = 1
export const rowKey = (): number => nextKey++

export const pinRow = (name = '', type: PinType | '' = '', supply = ''): PinRow => ({ key: rowKey(), spacer: false, name, type, supply })
export const gapRow = (): PinRow => ({ key: rowKey(), spacer: true, name: '', type: '', supply: '' })

export function emptyDraft(): Draft {
  return { name: '', category: DEFAULT_CATEGORY, maker: '', source: '', style: 'board', color: DEFAULT_COLORS.board, sized: false, w: 8, h: 6, pins: { left: [pinRow()], right: [], top: [], bottom: [] } }
}

/** The draft for a saved part, to edit it. */
export function draftFromPart(p: MyPart): Draft {
  const spec = specFromModule(p.module)
  const pins = { left: [], right: [], top: [], bottom: [] } as Record<Side, PinRow[]>
  for (const side of SIDES)
    for (const s of spec.pins[side] ?? []) {
      if (s === null || typeof s === 'string' || s.spacer) {
        pins[side].push(s === null || typeof s !== 'string' ? gapRow() : pinRow(s))
        continue
      }
      pins[side].push({ ...pinRow(s.name ?? '', s.type ?? '', s.supply ?? ''), ...(s.label !== undefined ? { label: s.label } : {}), ...(s.caps ? { caps: s.caps } : {}) })
    }
  const auto = !spec.body?.w && !spec.body?.h
  const lay = p.module.size ?? { w: 8, h: 6 }
  return {
    name: spec.name,
    category: spec.category ?? DEFAULT_CATEGORY,
    maker: p.maker ?? '',
    source: typeof spec.source === 'string' ? spec.source.split(/\s+/).filter(Boolean).join('\n') : (spec.source ?? []).join('\n'),
    style: spec.style ?? 'board',
    color: spec.body?.color ?? DEFAULT_COLORS[spec.style ?? 'board'],
    sized: !auto,
    w: spec.body?.w ?? lay.w,
    h: spec.body?.h ?? lay.h,
    pins,
    ...(spec.internal ? { internal: spec.internal } : {}),
    id: p.module.id,
  }
}

/** The part spec for a draft. A new part's id comes from its name; `taken` ids are avoided by the caller. */
export function specFromDraft(d: Draft): PartSpec {
  const pins: PartSpec['pins'] = {}
  for (const side of SIDES) {
    const rows = d.pins[side]
    if (!rows.length) continue
    pins[side] = rows.map((r) => {
      if (r.spacer) return null
      const o: Record<string, unknown> = { name: r.name.trim() }
      if (r.label !== undefined) o.label = r.label
      if (r.type) o.type = r.type
      if (r.supply.trim()) o.supply = r.supply.trim()
      if (r.caps) o.caps = r.caps
      return o
    })
  }
  const source = d.source.split(/\s+/).filter(Boolean)
  const spec: PartSpec = {
    format: SPEC_FORMAT,
    name: d.name.trim(),
    category: d.category.trim() || DEFAULT_CATEGORY,
    style: d.style,
    body: d.sized ? { w: d.w, h: d.h, color: d.color } : { color: d.color },
    pins,
  }
  if (source.length) spec.source = source
  if (d.id) spec.id = d.id
  // Joins name pins; keep only those whose pins all still exist.
  if (d.internal?.length) {
    const names = new Set(SIDES.flatMap((s) => d.pins[s].filter((r) => !r.spacer).map((r) => r.name.trim())))
    const kept = d.internal.filter((g) => g.every((n) => names.has(n)))
    if (kept.length) spec.internal = kept
  }
  return spec
}

/** The id a new part would get. */
export const draftId = (d: Draft): string => d.id ?? customId({ name: d.name.trim() || 'part' })

/** The id the dialog saves under: an edited part keeps its exact id; a new one gets a free id from its name. */
export const saveId = (d: Draft, editingId: string | null, taken: Set<string>): string => editingId ?? freeId(draftId(d), taken)

/** Why a part built with id `id` cannot be saved, or null: it would replace another part, or change the edited part's id. */
export function idClash(id: string, editingId: string | null, taken: Set<string>): string | null {
  if (editingId !== null && id !== editingId) return `Saving would change its id from ${editingId} to ${id}, so sheets using it would lose it. Nothing was saved.`
  if (editingId === null && (taken.has(id) || Object.hasOwn(modulesById, id))) return `Another part in My parts already has the id ${id}. Change the name.`
  return null
}

/** Pins pasted into the draft: each lands at the end of its side (a pasted "Right:" line switches sides). An empty first row on a side is replaced. */
export function addPasted(d: Draft, pasted: PastedPin[]): Draft {
  const pins = { ...d.pins }
  for (const side of SIDES) pins[side] = [...pins[side]]
  for (const { side, pin } of pasted) {
    const rows = pins[side]
    if (rows.length === 1 && !rows[0].spacer && !rows[0].name.trim() && !rows[0].type && !rows[0].supply) rows.pop()
    rows.push(pinRow(pin.name ?? '', pin.type ?? '', pin.supply ?? ''))
  }
  return { ...d, pins }
}

/** The draft with the row at `from` on `side` moved to index `to` (clamped). */
export function moveRow(d: Draft, side: Side, from: number, to: number): Draft {
  const rows = [...d.pins[side]]
  if (from < 0 || from >= rows.length) return d
  const [row] = rows.splice(from, 1)
  rows.splice(Math.max(0, Math.min(rows.length, to)), 0, row)
  return { ...d, pins: { ...d.pins, [side]: rows } }
}

/** The draft with the row at `from` on `side` moved to the end of `to`. */
export function moveRowToSide(d: Draft, side: Side, from: number, to: Side): Draft {
  if (side === to) return moveRow(d, side, from, d.pins[side].length - 1)
  const rows = [...d.pins[side]]
  const [row] = rows.splice(from, 1)
  if (!row) return d
  return { ...d, pins: { ...d.pins, [side]: rows, [to]: [...d.pins[to], row] } }
}

export const pinCount = (d: Draft, side: Side): number => d.pins[side].filter((r) => !r.spacer).length

/**
 * What the dialog saves for a draft under `id`. A part the part maker cannot rebuild exactly (see
 * unmodeled: an imported resistor, a board with holes) is edited in place unless `converted`: its
 * name, category, links and each pin's type and voltage change, and every other field is kept as it
 * was. The dialog keeps its pins' names, order and sides fixed until the person converts it.
 */
export function savedModule(d: Draft, id: string, editing: ModuleDef | null, converted: boolean): BuildResult {
  if (!editing || converted || !unmodeled(editing).length) return buildPart({ ...specFromDraft(d), id })
  const seen = { left: 0, right: 0, top: 0, bottom: 0 } as Record<Side, number>
  const pins = editing.pins.map((p): PinEntry => {
    const r = d.pins[p.side][seen[p.side]++]
    if (isSpacer(p) || !r || r.spacer) return p
    const { type: _t, supply: _s, ...rest } = p
    return { ...rest, ...(r.type ? { type: r.type } : {}), ...(r.supply.trim() ? { supply: r.supply.trim() } : {}) }
  })
  const { source: _src, ...base } = editing
  const source = d.source.split(/\s+/).filter(Boolean).join(' ')
  const m: ModuleDef = { ...base, name: d.name.trim(), ...(d.category.trim() ? { category: d.category.trim() } : {}), ...(source ? { source } : {}), pins }
  const v = validateModule(m)
  return v.ok ? { ok: true, module: m, notes: [] } : { ok: false, errors: v.errors }
}
