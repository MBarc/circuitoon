// Module definition format (circuitoon-module/1): types, validation and pin layout.
// Spec: docs/PRD.md, "Module definition format". Erasable TS only, so node can run it directly.
import { REQUIREMENTS, type Requirement, claimInternalNodes, validateMains } from './mainsModel.ts'

export const MODULE_FORMAT = 'circuitoon-module/1'
export const GRID = 10 // px per grid unit at 100% zoom; also the pin pitch
export const LEAD = 8 // px a pin stub sticks out from the body
/** Most wire ends a pin or pad may declare it takes. */
export const CAPACITY_MAX = 8

export type Side = 'top' | 'bottom' | 'left' | 'right'
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
export const PIN_TYPES = ['power_in', 'power_out', 'ground', 'input', 'output', 'io', 'passive', 'nc'] as const
export type PinType = (typeof PIN_TYPES)[number]

/**
 * What a pin can and cannot do, from the maker's datasheet (PRD "Pin capabilities"). Every field is
 * optional and a missing field claims nothing: the pin rules fire only on what is set here.
 */
export interface PinCaps {
  /** Reads only: no output driver (ESP32 GPIO34-39, Nano A6/A7). It must never be the only thing driving a net. */
  inputOnly?: true
  /** Drives only: it must not be read as an input (MCP23017 GPA7/GPB7). */
  outputOnly?: true
  /** Wired to the board's SPI flash or PSRAM (ESP32 GPIO6-11): nothing may be connected to it. */
  flash?: true
  /** No internal pull-up or pull-down: a switch on it needs an external resistor. */
  noPullup?: true
  /**
   * A strapping pin, read at reset: the level the boot needs. "high" or "low": the other level
   * changes how the chip starts (download mode, the flash voltage); "either": both levels boot
   * normally, it only changes a detail (`note` says which).
   */
  strapping?: 'high' | 'low' | 'either'
  /** One plain sentence on what the pin does at boot or why it is limited, shown by explain and in findings. */
  note?: string
}
export const STRAPPING_LEVELS = ['high', 'low', 'either'] as const

export interface PinDef {
  name: string
  side: Side
  label?: string
  type?: PinType
  supply?: string
  bus?: { length: number }
  /** How many wire ends the pin or pad takes (a Dupont socket or a solder joint takes one; a screw terminal may take two). Default 1. */
  capacity?: number
  /** Terminal requirement (spec 1.2): drives polarity and earth rules only. */
  mains?: Requirement
  /** An intentional bond to PE (a metal enclosure, a class 1 supply secondary). */
  bond?: 'pe'
  /** What the pin can and cannot do (input only, strapping, flash ...), from the datasheet. */
  caps?: PinCaps
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
  /** Resistor color band slot 1 to 4; the renderer colors it from the part's resistance. */
  band?: 1 | 2 | 3 | 4
}
export interface Art {
  w: number
  h: number
  /** "inside" draws pin names inside the body next to each pin, like board silkscreen, instead
   * of beside the pin stub; "tips" draws them past each stub tip, along the pin (the DIP chips).
   * Opt-in: set on the built-in dev boards, off by default. */
  pinLabels?: 'inside' | 'tips'
  shapes: ArtShape[]
}

/**
 * A hole group: one electrical node whose holes sit inside the body (a breadboard strip or rail,
 * or a single header pad drawn in its true position). Wires reference it by `name`, like a pin.
 */
export interface HoleGroup {
  name: string
  label?: string
  /** Hole centers in module-local px, each on a 10 px grid point inside the body. */
  at: [number, number][]
  /** Marks a power rail, drawn and named as + or -. */
  rail?: '+' | '-'
  /** "pad" draws each position as a header pad instead of a breadboard hole. */
  holeStyle?: 'pad'
  /** Electrical type and supply rails, as on a pin (an interior header pad). Breadboard rails set neither: + and - are markings, not voltages. */
  type?: PinType
  supply?: string
  /** How many wire ends the pin or pad takes (a Dupont socket or a solder joint takes one; a screw terminal may take two). Default 1. */
  capacity?: number
  /** Terminal requirement (spec 1.2): drives polarity and earth rules only. */
  mains?: Requirement
  /** An intentional bond to PE (a metal enclosure, a class 1 supply secondary). */
  bond?: 'pe'
  /** What the pad can and cannot do, as on a pin. */
  caps?: PinCaps
}

export interface ModuleDef {
  format: typeof MODULE_FORMAT
  id: string
  version?: number
  name: string
  category?: string
  /** Where the pinout came from: one URL, or several joined by a space. */
  source?: string
  pins: PinEntry[]
  internal?: string[][]
  size?: { w: number; h: number }
  art?: Art
  electrical?: unknown
  states?: string[]
  /** Pins inside the body, as hole groups (breadboards, interior headers). */
  holes?: HoleGroup[]
  /** false lets wires route over the part (a breadboard); parts mounted on it are still obstacles. */
  obstacle?: boolean
  /**
   * What the part covers seen from above when it stands on a breadboard, for a part drawn from the
   * side (standing upright, or a breakout whose face is drawn): a rect in module px (art
   * coordinates), or "legs" when it covers nothing beyond its own leg holes. Left out, the drawn
   * body is the footprint (see bodyShapes in breadboard.ts).
   */
  footprint?: 'legs' | { x: number; y: number; w: number; h: number }
  /**
   * A net label (the built-in `net-label`): a named flag with one pin. Every label pin with the same
   * name (the part's `values.net`, trimmed, case-sensitive) is one electrical node. Not a physical
   * part: never in the bill of materials, never mounted, never an extra part in verification.
   */
  netLabel?: true
}

export const isSpacer = (p: PinEntry): p is SpacerDef => 'spacer' in p && p.spacer === true

/** A net label module (`netLabel: true`): see ModuleDef.netLabel. */
export const isNetLabel = (m: ModuleDef | undefined): boolean => m?.netLabel === true

/** Opt-in flag (`art.pinLabels: "inside"`) for drawing pin names inside the body, like board
 * silkscreen, instead of beside the pin stub. Off for every module that does not set it. */
export const usesInsideLabels = (m: ModuleDef): boolean => m.art?.pinLabels === 'inside'

/**
 * Opt-in flag (`art.pinLabels: "tips"`) for drawing each pin name past its stub tip, along the pin:
 * for a body too thin to hold its labels inside (a DIP chip drawn at its true 0.3 inch width).
 */
export const usesTipLabels = (m: ModuleDef): boolean => m.art?.pinLabels === 'tips'

/**
 * How far, in px, a part's pin stubs and labels reach past its body: a stub and a label beside it
 * (LEAD + 10), or with labels past the tips, the stub, a 2 px gap and the longest label at the
 * 7 px label font (about 4.5 px a character plus its halo). Placement and exports keep this room.
 */
export function pinRoom(m: ModuleDef): number {
  if (!usesTipLabels(m)) return LEAD + 10
  const longest = Math.max(0, ...m.pins.filter((p): p is PinDef => !isSpacer(p)).map((p) => (p.label ?? p.name).length))
  return LEAD + 2 + Math.ceil(longest * 4.5 + 3)
}

/** Sides whose pin names draw inside the body: every side for an "inside" module (a board's
 * left/right headers, a small OLED's top header), none otherwise. */
export const insideLabelSides = (m: ModuleDef): Side[] => (usesInsideLabels(m) ? [...SIDES] : [])

/** A board accepts mounted parts: it has hole groups and is not a routing obstacle (breadboards, rail strips). */
export const isBoard = (m: ModuleDef | undefined): boolean => !!m && !!m.holes?.length && m.obstacle === false

export type ValidationResult = { ok: true; module: ModuleDef } | { ok: false; errors: string[] }

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPos = (v: unknown): v is number => isNum(v) && v > 0

/**
 * The magnitudes a part value can have, shared by module defaults, the overrides a diagram
 * stores and the value field: exactly 0 (where the param allows it), or 1e-15 to 1e12 either
 * sign. formatValue shows every one of them with an SI prefix (p to G); anything smaller or larger
 * is no real part and cannot be shown (1e-320 once captioned as "NaN pΩ").
 */
export const VALUE_MIN = 1e-15
export const VALUE_MAX = 1e12

/** True when `v` is a finite number that is 0 or has a magnitude from VALUE_MIN to VALUE_MAX. */
export const representableValue = (v: unknown): v is number =>
  isNum(v) && (v === 0 || (Math.abs(v) >= VALUE_MIN && Math.abs(v) <= VALUE_MAX))

/**
 * The editable value params: each has one unit and a valid range, shared by module defaults, the
 * per-part overrides a diagram stores and the value field (parseValue). Every value must be
 * representable (see VALUE_MIN); on top of that a 0 ohm resistor is a real part (a jumper), a
 * capacitance must be above 0 and a voltage may be negative.
 */
export const PARAM_RULES: Record<string, { unit: string; valid: (v: number) => boolean; range: string; optional?: boolean }> = {
  resistance: { unit: 'ohm', valid: (v) => v >= 0, range: '0, or from 1e-15 to 1e12' },
  capacitance: { unit: 'F', valid: (v) => v > 0, range: 'from 1e-15 to 1e12' },
  voltage: { unit: 'V', valid: () => true, range: '0, or a magnitude from 1e-15 to 1e12' },
  // The nominal RMS line-to-neutral voltage of an AC source (an outlet). A separate param from the
  // DC `voltage`, so every param keeps one unit.
  acVoltage: { unit: 'VAC', valid: (v) => v >= 1 && v <= 1000, range: 'from 1 to 1000' },
  // A fuse's rating. Optional: a fuse holder leaves the default out, so the rating is unknown until
  // the user sets it (a missing rating is never guessed).
  fuseRating: { unit: 'A', valid: (v) => v > 0 && v <= 100, range: 'above 0, up to 100', optional: true },
}

/** True when `v` is a valid value for the named param: representable and allowed by PARAM_RULES. */
export function validParamValue(name: string, v: unknown): v is number {
  return Object.hasOwn(PARAM_RULES, name) && representableValue(v) && PARAM_RULES[name].valid(v)
}

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
  if (raw.category !== undefined && typeof raw.category !== 'string') errors.push('category: must be a string')
  if (raw.source !== undefined && typeof raw.source !== 'string') errors.push('source: must be a string (one or more URLs)')

  // Electrical metadata shared by pins and hole groups.
  const checkType = (t: Record<string, unknown>, at: string) => {
    if (t.type !== undefined && !PIN_TYPES.includes(t.type as PinType)) errors.push(`${at}.type: must be one of ${PIN_TYPES.join(', ')}`)
  }
  const checkMains = (t: Record<string, unknown>, at: string) => {
    if (t.mains !== undefined && !(REQUIREMENTS as readonly unknown[]).includes(t.mains)) errors.push(`${at}.mains: must be one of "L", "N", "PE", "line"`)
    if (t.bond !== undefined && t.bond !== 'pe') errors.push(`${at}.bond: must be "pe"`)
  }
  const checkCaps = (t: Record<string, unknown>, at: string) => {
    if (t.caps === undefined) return
    const c = t.caps
    if (!isObj(c)) return void errors.push(`${at}.caps: must be an object (inputOnly, outputOnly, flash, noPullup, strapping, note)`)
    for (const k of Object.keys(c))
      if (!['inputOnly', 'outputOnly', 'flash', 'noPullup', 'strapping', 'note'].includes(k)) errors.push(`${at}.caps.${k}: unknown capability`)
    for (const k of ['inputOnly', 'outputOnly', 'flash', 'noPullup'])
      if (c[k] !== undefined && c[k] !== true) errors.push(`${at}.caps.${k}: must be true when present`)
    if (c.inputOnly && c.outputOnly) errors.push(`${at}.caps: a pin cannot be both inputOnly and outputOnly`)
    if (c.strapping !== undefined && !(STRAPPING_LEVELS as readonly unknown[]).includes(c.strapping)) errors.push(`${at}.caps.strapping: must be "high", "low" or "either"`)
    if (c.note !== undefined && (typeof c.note !== 'string' || c.note.trim() === '')) errors.push(`${at}.caps.note: must be a non-empty string`)
  }
  const checkSupply = (t: Record<string, unknown>, at: string) => {
    if (t.supply !== undefined && typeof t.supply !== 'string') errors.push(`${at}.supply: must be a string`)
    else if (typeof t.supply === 'string' && !/^[^/\s]+(\/[^/\s]+)*$/.test(t.supply))
      errors.push(`${at}.supply: must be one or more rail names separated by "/", for example "3V3/5V"`)
  }

  const names = new Set<string>()
  // A board has only hole groups, so its pin list may be empty.
  const hasHoles = Array.isArray(raw.holes) && raw.holes.length > 0
  if (!Array.isArray(raw.pins) || (raw.pins.length === 0 && !hasHoles)) errors.push('pins: required, at least one pin')
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
      checkType(p, at)
      checkMains(p, at)
      if (p.bus !== undefined && !(isObj(p.bus) && Number.isInteger(p.bus.length) && (p.bus.length as number) >= 2))
        errors.push(`${at}.bus: must be { "length": <whole number, 2 or more> }`)
      if (p.label !== undefined && typeof p.label !== 'string') errors.push(`${at}.label: must be a string`)
      checkSupply(p, at)
      checkCaps(p, at)
      if (p.capacity !== undefined && !(Number.isInteger(p.capacity) && (p.capacity as number) >= 1 && (p.capacity as number) <= CAPACITY_MAX))
        errors.push(`${at}.capacity: must be a whole number from 1 to ${CAPACITY_MAX}`)
    })

  const positions = new Set<string>()
  if (raw.holes !== undefined) {
    if (!Array.isArray(raw.holes)) errors.push('holes: must be a list of hole groups')
    else
      raw.holes.forEach((g, i) => {
        const at = `holes[${i}]`
        if (!isObj(g)) return void errors.push(`${at}: must be an object`)
        if (typeof g.name !== 'string' || g.name === '') errors.push(`${at}.name: required`)
        else if (names.has(g.name)) errors.push(`${at}.name: duplicate name "${g.name}" (pins and hole groups share one namespace)`)
        else names.add(g.name)
        if (g.label !== undefined && typeof g.label !== 'string') errors.push(`${at}.label: must be a string`)
        if (g.rail !== undefined && g.rail !== '+' && g.rail !== '-') errors.push(`${at}.rail: must be "+" or "-"`)
        if (g.holeStyle !== undefined && g.holeStyle !== 'pad') errors.push(`${at}.holeStyle: must be "pad"`)
        checkType(g, at)
        checkMains(g, at)
        checkSupply(g, at)
        checkCaps(g, at)
        if (g.capacity !== undefined) {
          if (g.holeStyle !== 'pad') errors.push(`${at}.capacity: only pins and header pads (holeStyle "pad") take a capacity`)
          else if (!(Number.isInteger(g.capacity) && (g.capacity as number) >= 1 && (g.capacity as number) <= CAPACITY_MAX))
            errors.push(`${at}.capacity: must be a whole number from 1 to ${CAPACITY_MAX}`)
        }
        if (!Array.isArray(g.at) || g.at.length === 0) return void errors.push(`${at}.at: required, at least one [x, y] position`)
        g.at.forEach((p, j) => {
          if (!(Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) return void errors.push(`${at}.at[${j}]: must be [x, y]`)
          if (p[0] % GRID !== 0 || p[1] % GRID !== 0) errors.push(`${at}.at[${j}]: must sit on the 10 px grid`)
          const key = `${p[0]},${p[1]}`
          if (positions.has(key)) errors.push(`${at}.at[${j}]: another hole already sits at ${p[0]}, ${p[1]}`)
          positions.add(key)
        })
      })
  }
  if (raw.obstacle !== undefined && typeof raw.obstacle !== 'boolean') errors.push('obstacle: must be true or false')
  if (raw.netLabel !== undefined) {
    if (raw.netLabel !== true) errors.push('netLabel: must be true when present')
    else if (!Array.isArray(raw.pins) || raw.pins.length !== 1 || (Array.isArray(raw.holes) && raw.holes.length) || raw.internal !== undefined)
      errors.push('netLabel: a net label has exactly one pin and no hole groups or internal joins')
  }
  if (raw.footprint !== undefined && raw.footprint !== 'legs' && !(isObj(raw.footprint) && isNum(raw.footprint.x) && isNum(raw.footprint.y) && isPos(raw.footprint.w) && isPos(raw.footprint.h)))
    errors.push('footprint: must be "legs" or { "x", "y", "w", "h" } in module px, with w and h above 0')

  // Pins and hole groups only: internal nodes (a plug's prongs) have no pin stub to power.
  const pinNames = new Set(names)
  claimInternalNodes(raw, names, errors)
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

  if (raw.size !== undefined && !(isObj(raw.size) && isPos(raw.size.w) && isPos(raw.size.h)))
    errors.push('size: must be { "w": <units>, "h": <units> } with positive numbers')

  if (raw.art !== undefined) {
    const art = raw.art
    if (!isObj(art) || !isPos(art.w) || !isPos(art.h) || !Array.isArray(art.shapes))
      errors.push('art: must be { "w", "h", "shapes": [...] } with positive w and h')
    else {
      if (art.pinLabels !== undefined && art.pinLabels !== 'inside' && art.pinLabels !== 'tips') errors.push('art.pinLabels: must be "inside" or "tips"')
      art.shapes.forEach((s, i) => {
        const at = `art.shapes[${i}]`
        if (!isObj(s) || s.type !== 'rect') return void errors.push(`${at}: only "rect" shapes are supported`)
        for (const k of ['x', 'y', 'w', 'h']) if (!isNum(s[k])) errors.push(`${at}.${k}: must be a number`)
        if (typeof s.fill !== 'string') errors.push(`${at}.fill: required color`)
        if (s.radius !== undefined && !isNum(s.radius)) errors.push(`${at}.radius: must be a number`)
        if (s.outline !== undefined && typeof s.outline !== 'boolean') errors.push(`${at}.outline: must be true or false`)
        if (s.label !== undefined && typeof s.label !== 'string') errors.push(`${at}.label: must be a string`)
        if (s.labelColor !== undefined && typeof s.labelColor !== 'string') errors.push(`${at}.labelColor: must be a string`)
        if (s.labelSize !== undefined && !isPos(s.labelSize)) errors.push(`${at}.labelSize: must be a positive number`)
        if (s.band !== undefined && !(Number.isInteger(s.band) && (s.band as number) >= 1 && (s.band as number) <= 4))
          errors.push(`${at}.band: must be a whole number from 1 to 4`)
      })
    }
  }

  if (!errors.length && Array.isArray(raw.holes)) {
    const lay = computeLayout(raw as unknown as ModuleDef)
    ;(raw.holes as HoleGroup[]).forEach((g, i) =>
      g.at.forEach(([x, y], j) => {
        if (x < 0 || y < 0 || x > lay.w || y > lay.h) errors.push(`holes[${i}].at[${j}]: outside the body (0 to ${lay.w}, 0 to ${lay.h})`)
      }),
    )
  }

  if (isObj(raw.electrical) && raw.electrical.params !== undefined) {
    const params = raw.electrical.params
    if (!isObj(params)) errors.push('electrical.params: must be an object')
    else
      for (const [name, rule] of Object.entries(PARAM_RULES)) {
        if (!Object.hasOwn(params, name)) continue
        const p = params[name]
        const at = `electrical.params.${name}`
        if (!isObj(p)) {
          errors.push(`${at}: must be { "unit": "${rule.unit}", "default": <number> }`)
          continue
        }
        if (p.unit !== rule.unit) errors.push(`${at}.unit: must be "${rule.unit}"`)
        if (!(rule.optional && p.default === undefined) && !validParamValue(name, p.default))
          errors.push(`${at}.default: must be ${rule.range}${rule.optional ? ', or left out' : ''}`)
      }
  }

  // Enumerated part choices (a fuse holder's fitted or absent fuse); the first choice is the default.
  if (isObj(raw.electrical) && raw.electrical.settings !== undefined) {
    const s = raw.electrical.settings
    if (!isObj(s)) errors.push('electrical.settings: must be an object of setting name to a list of choices')
    else
      for (const [k, v] of Object.entries(s))
        if (!Array.isArray(v) || v.length < 2 || v.some((c) => typeof c !== 'string' || c === '') || new Set(v).size !== v.length)
          errors.push(`electrical.settings.${k}: must be a list of 2 or more different choices, the first the default`)
  }

  if (isObj(raw.electrical) && raw.electrical.i2c !== undefined) validateI2c(raw.electrical.i2c, raw.electrical.settings, pinNames, errors)

  if (isObj(raw.electrical) && raw.electrical.external !== undefined) {
    const ext = raw.electrical.external
    if (!Array.isArray(ext)) errors.push('electrical.external: must be a list of { "pin", "volts", "via" }')
    else
      ext.forEach((e, i) => {
        const at = `electrical.external[${i}]`
        if (!isObj(e)) return void errors.push(`${at}: must be { "pin", "volts", "via" }`)
        if (typeof e.pin !== 'string' || !pinNames.has(e.pin)) errors.push(`${at}.pin: no pin named "${String(e.pin)}"`)
        if (!isPos(e.volts)) errors.push(`${at}.volts: must be a number above 0`)
        if (typeof e.via !== 'string' || e.via.trim() === '') errors.push(`${at}.via: required, what powers the pin (for example "USB")`)
        if (e.diode !== undefined && typeof e.diode !== 'boolean') errors.push(`${at}.diode: must be true or false`)
        if (e.max !== undefined && !(isNum(e.max) && isPos(e.volts) && e.max >= e.volts)) errors.push(`${at}.max: must be a number, at least volts`)
      })
  }

  // Ground pins that are one return for checking (across a switch the checker does not model).
  if (isObj(raw.electrical) && raw.electrical.commonReturn !== undefined) {
    const groups = raw.electrical.commonReturn
    const grounds = new Set([...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])]
      .filter((p): p is Record<string, unknown> => isObj(p) && p.type === 'ground' && typeof p.name === 'string').map((p) => p.name as string))
    if (!Array.isArray(groups)) errors.push('electrical.commonReturn: must be a list of ground pin name groups')
    else
      groups.forEach((g, i) => {
        if (!Array.isArray(g) || g.length < 2) return void errors.push(`electrical.commonReturn[${i}]: needs 2 or more ground pin names`)
        g.forEach((n, j) => {
          if (typeof n !== 'string' || !grounds.has(n)) errors.push(`electrical.commonReturn[${i}][${j}]: no ground pin named "${String(n)}"`)
        })
      })
  }

  // Which ground each output (or USB pin) returns to.
  if (isObj(raw.electrical) && raw.electrical.returns !== undefined) {
    const returns = raw.electrical.returns
    const items = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])]
      .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.name === 'string')
    const ext = Array.isArray(raw.electrical.external) ? raw.electrical.external.filter(isObj).map((e) => e.pin) : []
    const outs = new Set(items.filter((p) => p.type === 'power_out' || ext.includes(p.name)).map((p) => p.name as string))
    const grounds = new Set(items.filter((p) => p.type === 'ground').map((p) => p.name as string))
    if (!isObj(returns)) errors.push('electrical.returns: must be an object of output pin name to ground pin name')
    else
      for (const [out, g] of Object.entries(returns)) {
        if (!outs.has(out)) errors.push(`electrical.returns.${out}: no power_out or external pin named "${out}"`)
        if (typeof g !== 'string' || !grounds.has(g)) errors.push(`electrical.returns.${out}: no ground pin named "${String(g)}"`)
      }
  }

  // A voltage value is the voltage of named outputs: required when there is more than one to choose from.
  if (isObj(raw.electrical)) {
    const el = raw.electrical
    const hasVoltage = isObj(el.params) && el.params.voltage !== undefined
    const outs = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])]
      .filter((p): p is Record<string, unknown> => isObj(p) && p.type === 'power_out' && typeof p.name === 'string')
      .map((p) => p.name as string)
    if (el.voltageOutputs !== undefined) {
      if (!hasVoltage) errors.push('electrical.voltageOutputs: only for a module with a voltage param')
      if (!Array.isArray(el.voltageOutputs) || el.voltageOutputs.length === 0) errors.push('electrical.voltageOutputs: must be a list of power_out pin names')
      else
        el.voltageOutputs.forEach((n, i) => {
          if (typeof n !== 'string' || !outs.includes(n)) errors.push(`electrical.voltageOutputs[${i}]: no power_out pin named "${String(n)}"`)
        })
    } else if (hasVoltage && outs.length > 1)
      errors.push(`electrical.voltageOutputs: required, the module has a voltage value and ${outs.length} power_out pins; name the ones the value sets`)
  }

  validateMains(raw, names, errors)
  // Only a plug whose fields are already valid is measured.
  if (!errors.length && isObj(raw.electrical) && isObj(raw.electrical.plug) && Array.isArray(raw.electrical.plug.profiles)) {
    const lay = computeLayout(raw as unknown as ModuleDef)
    raw.electrical.plug.profiles.forEach((pr, i) =>
      (pr as { contacts: { at: { x: number; y: number } }[] }).contacts.forEach((c, j) => {
        if (c.at.x < 0 || c.at.y < 0 || c.at.x > lay.w || c.at.y > lay.h)
          errors.push(`electrical.plug.profiles[${i}].contacts[${j}].at: outside the body (0 to ${lay.w}, 0 to ${lay.h})`)
      }),
    )
  }

  return errors.length ? { ok: false, errors } : { ok: true, module: raw as unknown as ModuleDef }
}

/** A 7-bit I2C address. */
const isAddress = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0x7f
/** A setting choice that names an address: "0x3C". */
export const parseAddress = (s: string): number | null => (/^0x[0-9a-f]{1,2}$/i.test(s) && isAddress(parseInt(s, 16)) ? parseInt(s, 16) : null)
/** An address as the user reads it: "0x3C". */
export const addressText = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`

function validateI2c(i2c: unknown, settings: unknown, pins: Set<string>, errors: string[]) {
  const at = 'electrical.i2c'
  if (!isObj(i2c)) return void errors.push(`${at}: must be { "sda", "scl", "address"?, "pullups"? }`)
  for (const k of Object.keys(i2c)) if (!['sda', 'scl', 'address', 'pullups'].includes(k)) errors.push(`${at}.${k}: unknown field`)
  for (const k of ['sda', 'scl'])
    if (typeof i2c[k] !== 'string' || !pins.has(i2c[k] as string)) errors.push(`${at}.${k}: no pin named "${String(i2c[k])}"`)
  if (i2c.pullups !== undefined && typeof i2c.pullups !== 'boolean') errors.push(`${at}.pullups: must be true or false (leave it out when not known)`)
  const a = i2c.address
  if (a === undefined) return
  const forms = '{ "fixed" }, { "base", "pins" } or { "setting" }'
  if (!isObj(a)) return void errors.push(`${at}.address: must be ${forms}`)
  if (a.fixed !== undefined) {
    if (!isAddress(a.fixed)) errors.push(`${at}.address.fixed: must be a 7-bit address (0 to 127)`)
    if (Object.keys(a).length > 1) errors.push(`${at}.address: "fixed" takes no other field`)
  } else if (a.base !== undefined) {
    if (!isAddress(a.base)) errors.push(`${at}.address.base: must be a 7-bit address (0 to 127)`)
    if (!Array.isArray(a.pins) || !a.pins.length) return void errors.push(`${at}.address.pins: required, a list of { "pin", "add", "floating"? }`)
    a.pins.forEach((p, i) => {
      const pa = `${at}.address.pins[${i}]`
      if (!isObj(p)) return void errors.push(`${pa}: must be { "pin", "add", "floating"? }`)
      if (typeof p.pin !== 'string' || !pins.has(p.pin)) errors.push(`${pa}.pin: no pin named "${String(p.pin)}"`)
      if (!(Number.isInteger(p.add) && (p.add as number) > 0 && (p.add as number) <= 0x7f)) errors.push(`${pa}.add: must be a whole number from 1 to 127`)
      if (p.floating !== undefined && p.floating !== 0 && p.floating !== 1) errors.push(`${pa}.floating: must be 0 or 1 (the level the board pulls the pin to when nothing is connected)`)
    })
  } else if (a.setting !== undefined) {
    const choices = isObj(settings) ? settings[a.setting as string] : undefined
    if (typeof a.setting !== 'string' || !Array.isArray(choices)) errors.push(`${at}.address.setting: no setting named "${String(a.setting)}" in electrical.settings`)
    else if (choices.some((c) => typeof c !== 'string' || parseAddress(c) === null)) errors.push(`${at}.address.setting: every choice of electrical.settings.${a.setting} must be an address such as "0x3C"`)
  } else errors.push(`${at}.address: must be ${forms}`)
}

/** How a device's I2C address is set: fixed, by address pins, or by a part setting (a resistor or jumper on the board). */
export type I2cAddress = { fixed: number } | { base: number; pins: { pin: string; add: number; floating?: 0 | 1 }[] } | { setting: string }
export interface I2cSpec {
  sda: string
  scl: string
  address?: I2cAddress
  /** true: the board has pull-ups on SDA and SCL; false: it has none; undefined: not known. */
  pullups?: boolean
}

/** The module's I2C device data (`electrical.i2c`), or null. Trusts validateModule. */
export function i2cOf(m: ModuleDef): I2cSpec | null {
  const e = m.electrical
  return isObj(e) && isObj(e.i2c) && typeof e.i2c.sda === 'string' && typeof e.i2c.scl === 'string' ? (e.i2c as unknown as I2cSpec) : null
}

/** A pin's or hole group's capabilities, or undefined. */
export function pinCaps(m: ModuleDef, name: string): PinCaps | undefined {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  return pin ? pin.caps : holeGroupOf(m, name)?.caps
}

/**
 * Groups of ground pins the wiring checker treats as one return (`electrical.commonReturn`): a
 * charger's B- and OUT- on either side of its protection switch. Not joined on the sheet.
 */
export function commonReturn(m: ModuleDef): string[][] {
  const e = m.electrical
  if (!isObj(e) || !Array.isArray(e.commonReturn)) return []
  return e.commonReturn.filter((g): g is string[] => Array.isArray(g) && g.every((n) => typeof n === 'string'))
}

/** The ground pin each output or USB pin returns to (`electrical.returns`), as declared. */
export function declaredReturns(m: ModuleDef): Record<string, string> {
  const e = m.electrical
  if (!isObj(e) || !isObj(e.returns)) return {}
  return Object.fromEntries(Object.entries(e.returns).filter((x): x is [string, string] => typeof x[1] === 'string'))
}

/**
 * The outputs whose voltage is the part's `voltage` value: `electrical.voltageOutputs`, or the
 * module's only power_out. Empty when the module has no voltage param.
 */
export function voltageOutputs(m: ModuleDef): string[] {
  const e = m.electrical
  if (!isObj(e) || !isObj(e.params) || e.params.voltage === undefined) return []
  if (Array.isArray(e.voltageOutputs)) return e.voltageOutputs.filter((n): n is string => typeof n === 'string')
  const outs = [...m.pins.filter((p): p is PinDef => !isSpacer(p)), ...(m.holes ?? [])].filter((p) => p.type === 'power_out')
  return outs.length === 1 ? [outs[0].name] : []
}

/**
 * A pin that carries a voltage when the part is powered through a connector the sheet does not
 * draw: a dev board's 5V pin while it sits on USB (`via` "USB"). From `electrical.external`.
 */
export interface ExternalPower {
  pin: string
  volts: number
  via: string
  /** A diode sits between the connector and the pin (per the board's schematic): the pin can raise its net, never pull it down. */
  diode?: boolean
  /** The most the pin itself takes when something else raises it (Pico VSYS: 5.5 V); else its accepted rails. */
  max?: number
}

/** The module's `electrical.external` entries that are well formed (validateModule reports the rest). */
export function externalPower(m: ModuleDef): ExternalPower[] {
  const e = m.electrical
  if (!isObj(e) || !Array.isArray(e.external)) return []
  return e.external.filter((x): x is ExternalPower => isObj(x) && typeof x.pin === 'string' && isPos(x.volts) && typeof x.via === 'string')
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
function computeLayout(m: ModuleDef): ModuleLayout {
  const wu = Math.max(
    m.size?.w ?? 0,
    Math.ceil((m.art?.w ?? 0) / GRID),
    Math.max(slotsOn(m, 'top'), slotsOn(m, 'bottom')) + 2,
    4,
  )
  const hu = Math.max(
    m.size?.h ?? 0,
    Math.ceil((m.art?.h ?? 0) / GRID),
    Math.max(slotsOn(m, 'left'), slotsOn(m, 'right')) + (m.netLabel ? 1 : 2),
    // A net label is a slim flag: two units tall, its one pin at the middle of its edge.
    m.netLabel ? 2 : 3,
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

// Modules are never mutated after load, so layouts can be cached by object identity.
const layoutCache = new WeakMap<ModuleDef, ModuleLayout>()

export function layoutModule(m: ModuleDef): ModuleLayout {
  let lay = layoutCache.get(m)
  if (!lay) layoutCache.set(m, (lay = computeLayout(m)))
  return lay
}

const groupCache = new WeakMap<ModuleDef, Map<string, HoleGroup>>()

/**
 * A module's hole group named `name`, or undefined: a map lookup, built once per module (cached by
 * module identity, like the hole and shape caches). The first group of a name wins, as a scan would.
 */
export function holeGroupOf(m: ModuleDef, name: string): HoleGroup | undefined {
  let map = groupCache.get(m)
  if (!map) {
    map = new Map()
    for (const g of m.holes ?? []) if (!map.has(g.name)) map.set(g.name, g)
    groupCache.set(m, map)
  }
  return map.get(name)
}

/**
 * How many wire ends a pin or header pad takes: its `capacity`, default 1. A breadboard hole always
 * takes one (a hole holds one leg or one wire end), whatever its group says.
 */
export function terminalCapacity(m: ModuleDef, name: string): number {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  if (pin) return pin.capacity ?? 1
  const g = holeGroupOf(m, name)
  return g?.holeStyle === 'pad' ? (g.capacity ?? 1) : 1
}

/** A module's enumerated part settings (`electrical.settings`): each name with its choices, the first the default. */
export function moduleSettings(m: ModuleDef): Record<string, string[]> {
  const e = m.electrical
  if (!isObj(e) || !isObj(e.settings)) return {}
  return Object.fromEntries(
    Object.entries(e.settings).filter((x): x is [string, string[]] => Array.isArray(x[1]) && x[1].length > 1 && x[1].every((c) => typeof c === 'string')),
  )
}

/** A part's choice for one setting: its stored choice when the module offers it, else the module's first choice; null when the module has no such setting. */
export function partSetting(part: { settings?: Record<string, string> }, m: ModuleDef, name: string): string | null {
  const all = moduleSettings(m)
  if (!Object.hasOwn(all, name)) return null
  const choices = all[name]
  const stored = part.settings?.[name]
  return stored !== undefined && choices.includes(stored) ? stored : choices[0]
}
