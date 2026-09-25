// Module definition format (circuitoon-module/1): types, validation and pin layout.
// Spec: docs/PRD.md, "Module definition format". Erasable TS only, so node can run it directly.

export const MODULE_FORMAT = 'circuitoon-module/1'
export const GRID = 10 // px per grid unit at 100% zoom; also the pin pitch
export const LEAD = 8 // px a pin stub sticks out from the body

export type Side = 'top' | 'bottom' | 'left' | 'right'
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
export const PIN_TYPES = ['power_in', 'power_out', 'ground', 'input', 'output', 'io', 'passive', 'nc'] as const
export type PinType = (typeof PIN_TYPES)[number]

export interface PinDef {
  name: string
  side: Side
  label?: string
  type?: PinType
  supply?: string
  bus?: { length: number }
}
export interface SpacerDef {
  spacer: true
  side: Side
}
export type PinEntry = PinDef | SpacerDef

export interface ArtShape {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  fill: string
  radius?: number
  outline?: boolean
  label?: string
  labelColor?: string
  labelSize?: number
}
export interface Art {
  w: number
  h: number
  shapes: ArtShape[]
}

export interface ModuleDef {
  format: typeof MODULE_FORMAT
  id: string
  version?: number
  name: string
  category?: string
  pins: PinEntry[]
  internal?: string[][]
  size?: { w: number; h: number }
  art?: Art
  electrical?: unknown
  states?: string[]
}

export const isSpacer = (p: PinEntry): p is SpacerDef => 'spacer' in p && p.spacer === true

export type ValidationResult = { ok: true; module: ModuleDef } | { ok: false; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Checks a parsed JSON value against the module format. Errors name the exact path. */
export function validateModule(raw: unknown): ValidationResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['module must be a JSON object'] }

  if (raw.format === undefined) errors.push('format: missing (expected "circuitoon-module/1")')
  else if (raw.format !== MODULE_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${MODULE_FORMAT}")`)
  if (typeof raw.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id))
    errors.push('id: required, lowercase kebab-case (for example "mcp23017-breakout")')
  if (typeof raw.name !== 'string' || raw.name.trim() === '') errors.push('name: required')
  if (raw.version !== undefined && !(Number.isInteger(raw.version) && (raw.version as number) >= 1))
    errors.push('version: must be a whole number, 1 or more')

  const names = new Set<string>()
  if (!Array.isArray(raw.pins) || raw.pins.length === 0) errors.push('pins: required, at least one pin')
  else
    raw.pins.forEach((p, i) => {
      const at = `pins[${i}]`
      if (!isObj(p)) return void errors.push(`${at}: must be an object`)
      if (!SIDES.includes(p.side as Side)) errors.push(`${at}.side: must be top, bottom, left or right`)
      if (p.spacer !== undefined) {
        if (p.spacer !== true) errors.push(`${at}.spacer: must be true`)
        if (p.name !== undefined) errors.push(`${at}: a spacer takes no name`)
        return
      }
      if (typeof p.name !== 'string' || p.name === '') return void errors.push(`${at}.name: required`)
      if (names.has(p.name)) errors.push(`${at}.name: duplicate pin name "${p.name}"`)
      names.add(p.name)
      if (p.type !== undefined && !PIN_TYPES.includes(p.type as PinType))
        errors.push(`${at}.type: must be one of ${PIN_TYPES.join(', ')}`)
      if (p.bus !== undefined && !(isObj(p.bus) && Number.isInteger(p.bus.length) && (p.bus.length as number) >= 2))
        errors.push(`${at}.bus: must be { "length": <whole number, 2 or more> }`)
    })

  if (raw.internal !== undefined) {
    if (!Array.isArray(raw.internal)) errors.push('internal: must be a list of pin-name groups')
    else
      raw.internal.forEach((group, i) => {
        if (!Array.isArray(group) || group.length < 2) return void errors.push(`internal[${i}]: needs 2 or more pin names`)
        group.forEach((n, j) => {
          if (!names.has(n as string)) errors.push(`internal[${i}][${j}]: no pin named "${String(n)}"`)
        })
      })
  }

  if (raw.size !== undefined && !(isObj(raw.size) && isNum(raw.size.w) && isNum(raw.size.h)))
    errors.push('size: must be { "w": <units>, "h": <units> }')

  if (raw.art !== undefined) {
    const art = raw.art
    if (!isObj(art) || !isNum(art.w) || !isNum(art.h) || !Array.isArray(art.shapes))
      errors.push('art: must be { "w", "h", "shapes": [...] }')
    else
      art.shapes.forEach((s, i) => {
        const at = `art.shapes[${i}]`
        if (!isObj(s) || s.type !== 'rect') return void errors.push(`${at}: only "rect" shapes are supported`)
        for (const k of ['x', 'y', 'w', 'h']) if (!isNum(s[k])) errors.push(`${at}.${k}: must be a number`)
        if (typeof s.fill !== 'string') errors.push(`${at}.fill: required color`)
      })
  }

  return errors.length ? { ok: false, errors } : { ok: true, module: raw as unknown as ModuleDef }
}

export interface PlacedPin {
  name: string
  label?: string
  side: Side
  type: PinType
  /** Point on the body edge, in part-local px. */
  edge: { x: number; y: number }
  /** Tip of the pin stub, where wires attach. */
  end: { x: number; y: number }
  /** Outward unit direction. */
  dir: { x: number; y: number }
  bus?: { length: number }
}
export interface ModuleLayout {
  w: number
  h: number
  pins: PlacedPin[]
}

const slotsOn = (m: ModuleDef, side: Side) =>
  m.pins.filter((p) => p.side === side).reduce((n, p) => n + (!isSpacer(p) && p.bus ? p.bus.length : 1), 0)

/**
 * Body size and pin positions, per the PRD geometry rules: body is the largest of `size`,
 * `art`, and what the pins need plus one unit of corner margin; pins sit on grid points,
 * centered along their side, in array order (left to right, top to bottom).
 */
export function layoutModule(m: ModuleDef): ModuleLayout {
  const wu = Math.max(
    m.size?.w ?? 0,
    Math.ceil((m.art?.w ?? 0) / GRID),
    Math.max(slotsOn(m, 'top'), slotsOn(m, 'bottom')) + 2,
    4,
  )
  const hu = Math.max(
    m.size?.h ?? 0,
    Math.ceil((m.art?.h ?? 0) / GRID),
    Math.max(slotsOn(m, 'left'), slotsOn(m, 'right')) + 2,
    3,
  )
  const pins: PlacedPin[] = []
  for (const side of SIDES) {
    const entries = m.pins.filter((p) => p.side === side)
    const n = slotsOn(m, side)
    if (!n) continue
    const len = side === 'top' || side === 'bottom' ? wu : hu
    let slot = Math.ceil((len - (n - 1)) / 2)
    for (const p of entries) {
      const span = !isSpacer(p) && p.bus ? p.bus.length : 1
      if (!isSpacer(p)) {
        const along = (slot + (span - 1) / 2) * GRID
        const dir = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[side]
        const edge =
          side === 'top' ? { x: along, y: 0 }
          : side === 'bottom' ? { x: along, y: hu * GRID }
          : side === 'left' ? { x: 0, y: along }
          : { x: wu * GRID, y: along }
        pins.push({
          name: p.name,
          label: p.label,
          side,
          type: p.type ?? 'io',
          edge,
          end: { x: edge.x + dir.x * LEAD, y: edge.y + dir.y * LEAD },
          dir,
          bus: p.bus,
        })
      }
      slot += span
    }
  }
  return { w: wu * GRID, h: hu * GRID, pins }
}
