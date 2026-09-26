// Part values: SI-prefixed formatting and parsing, standard value series, and resistor color
// bands. Pure and unit-tested; the editor and renderer just call into these.

import { PARAM_RULES, isObj, representableValue, validParamValue, type ArtShape, type ModuleDef } from './module.ts'

const OHM = 'Ω' // ohm sign, U+2126 (not the Greek capital omega, U+03A9)
const OMEGA = 'Ω'
const MICRO = 'µ'

const UNIT_SYMBOLS: Record<string, string> = { ohm: OHM, F: 'F', V: 'V', A: 'A' }

/** SI prefixes usable on a part value, smallest exponent first. */
const PREFIXES: { exp: number; symbol: string }[] = [
  { exp: -12, symbol: 'p' },
  { exp: -9, symbol: 'n' },
  { exp: -6, symbol: MICRO },
  { exp: -3, symbol: 'm' },
  { exp: 0, symbol: '' },
  { exp: 3, symbol: 'k' },
  { exp: 6, symbol: 'M' },
  { exp: 9, symbol: 'G' },
]

/** Rounds to `digits` significant digits, avoiding float noise like 4.699999999999999. */
function roundSig(x: number, digits: number): number {
  if (x === 0) return 0
  const magnitude = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(x))))
  return Math.round(x * magnitude) / magnitude
}

/**
 * A number with its proper unit symbol and an SI prefix chosen so the shown mantissa is
 * 1 to 999, at most 3 significant digits, no trailing zeros. Examples: 220 ohm -> "220 Ω",
 * 4700 ohm -> "4.7 kΩ", 1e-7 F -> "100 nF".
 */
export function formatValue(value: number, unit: string): string {
  const symbol = UNIT_SYMBOLS[unit] ?? unit
  if (value === 0) return `0 ${symbol}`
  const abs = Math.abs(value)
  let idx = 0
  for (let i = 0; i < PREFIXES.length; i++) if (abs / Math.pow(10, PREFIXES[i].exp) >= 1) idx = i
  let scaled = roundSig(value / Math.pow(10, PREFIXES[idx].exp), 3)
  // Rounding can push the mantissa up to 1000 (for example 999999 rounds to "1000 kΩ"); when
  // that happens and a larger prefix exists, re-round against it instead.
  if (Math.abs(scaled) >= 1000 && idx < PREFIXES.length - 1) {
    idx += 1
    scaled = roundSig(value / Math.pow(10, PREFIXES[idx].exp), 3)
  }
  return `${scaled} ${PREFIXES[idx].symbol}${symbol}`
}

/** Single-character SI prefixes accepted on input; case matters (M is mega, m is milli). */
const PREFIX_MULT: Record<string, number> = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, [MICRO]: 1e-6, n: 1e-9, p: 1e-12 }

/** True when `s` spells out the given unit (its full name or sign), case-insensitively. Empty means the unit was left implied, which is always accepted. */
function matchesUnit(s: string, unit: string): boolean {
  if (s === '') return true
  const low = s.toLowerCase()
  if (unit === 'ohm') return low === 'ohm' || low === 'ohms' || s === OHM || s === OMEGA
  if (unit === 'F') return low === 'f'
  if (unit === 'V') return low === 'v'
  return low === unit.toLowerCase()
}

/** Splits a trailing unit-ish suffix into an optional leading SI prefix and the rest. */
function splitPrefix(suffix: string): { mult: number; rest: string } {
  const head = suffix[0]
  if (head !== undefined && Object.hasOwn(PREFIX_MULT, head)) return { mult: PREFIX_MULT[head], rest: suffix.slice(1) }
  return { mult: 1, rest: suffix }
}

/** The value param that uses `unit` (resistance for ohm, capacitance for F, voltage for V), if any. */
const paramForUnit = (unit: string): string | undefined => Object.keys(PARAM_RULES).find((name) => PARAM_RULES[name].unit === unit)

/**
 * Rejects what a file could not hold either: a value that is not representable (0, or a magnitude
 * from 1e-15 to 1e12; VALUE_MIN in module.ts) or that the unit's param does not allow (PARAM_RULES:
 * 0 ohm is fine, a voltage may be 0 or negative, a capacitance must be above 0; a unit with no
 * param must be positive). Otherwise rounds to 6 significant digits, so a multiplication like
 * `100 * 1e-9` (which lands on 1.0000000000000001e-7 in floating point) comes out as the clean
 * 1e-7 rather than carrying that noise into the diagram; the rounded value is checked again, so
 * rounding can never carry it past a limit.
 */
function finish(v: number, unit: string): number | null {
  const param = paramForUnit(unit)
  const ok = (x: number) => (param ? validParamValue(param, x) : representableValue(x) && x > 0)
  if (!ok(v)) return null
  const rounded = roundSig(v, 6) + 0 // + 0 turns -0 into 0
  return ok(rounded) ? rounded : null
}

/**
 * Parses free-typed value text for a param of the given unit: "4.7k", "4k7", "4.7 kΩ",
 * "4.7kohm", "220", "1M", "100n", "100nF", "0.1u", "10µ", "10uF", "3.7", "3.7V", "-12", "0".
 * Returns null for empty, non-numeric or wrong-unit-suffix input, and for a value out of range for
 * the unit (see `finish`).
 */
export function parseValue(text: string, unit: string): number | null {
  const t = text.trim()
  if (!t) return null

  // Embedded decimal point, e.g. "4k7" meaning 4.7k, or "1u5" meaning 1.5u.
  const embedded = /^(-?\d+)([A-Za-zµ])(\d+)([A-Za-zΩΩ]*)$/.exec(t)
  if (embedded) {
    const [, whole, letter, frac, rest] = embedded
    if (!Object.hasOwn(PREFIX_MULT, letter) || !matchesUnit(rest, unit)) return null
    return finish(Number(`${whole}.${frac}`) * PREFIX_MULT[letter], unit)
  }

  const m = /^(-?\d*\.?\d+)\s*([A-Za-zµΩΩ]*)$/.exec(t)
  if (!m) return null
  const [, numStr, suffixRaw] = m
  const n = Number(numStr)
  if (!Number.isFinite(n)) return null
  if (suffixRaw === '') return finish(n, unit)
  const { mult, rest } = splitPrefix(suffixRaw)
  if (!matchesUnit(rest, unit)) return null
  return finish(n * mult, unit)
}

/**
 * Builds a standard value series: `decades` steps of x1, x10, x100, ... over `mantissas`, then
 * one final value. Each entry is rounded to 6 significant digits (see `finish`), because the
 * mantissa-times-power-of-ten multiplication otherwise leaves float noise like
 * 2.1999999999999998e-11 instead of the exact 2.2e-11.
 */
function series(mantissas: number[], base: number, decades: number, final: number): number[] {
  const values: number[] = []
  for (let k = 0; k < decades; k++) for (const m of mantissas) values.push(roundSig(m * base * Math.pow(10, k), 6))
  values.push(roundSig(final, 6))
  return values
}

/** E12 series, 10 ohm to 1 Mohm inclusive. */
export const RESISTOR_VALUES: number[] = series([10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82], 1, 5, 1_000_000)

/** E6 series, 10 pF to 1000 uF inclusive (values in farads). */
export const CAPACITOR_VALUES: number[] = series([10, 15, 22, 33, 47, 68], 1e-12, 8, 1000e-6)

const DIGIT_COLORS = [
  '#1B1B1B', // 0 black
  '#8B5A2B', // 1 brown
  '#D8413A', // 2 red
  '#F08A24', // 3 orange
  '#F4C430', // 4 yellow
  '#2F9E6E', // 5 green
  '#3D6FD6', // 6 blue
  '#8E5BD6', // 7 violet
  '#9AA2AD', // 8 gray
  '#F5F5F5', // 9 white
]
const GOLD = '#E0B43C'
const SILVER = '#C0C6CE'

function multiplierColor(exp: number): string | null {
  if (exp >= 0 && exp <= 9) return DIGIT_COLORS[exp]
  if (exp === -1) return GOLD
  if (exp === -2) return SILVER
  return null
}

/** The exponent and two-digit mantissa (10 to 99) that reproduce `value` exactly, if any. */
function twoDigitMantissa(value: number): { mantissa: number; exp: number } | null {
  for (let exp = -1; exp <= 6; exp++) {
    const scaled = value / Math.pow(10, exp)
    const rounded = Math.round(scaled)
    if (rounded >= 10 && rounded <= 99 && Math.abs(scaled - rounded) < 1e-6) return { mantissa: rounded, exp }
  }
  return null
}

/**
 * Hex fills for a standard 4-band resistor code (digit, digit, multiplier, gold tolerance), for
 * a value that fits two significant digits between 1 ohm and 99 Mohm. Null otherwise.
 */
export function resistorBands(ohms: number): [string, string, string, string] | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null
  const found = twoDigitMantissa(ohms)
  if (!found) return null
  const mult = multiplierColor(found.exp)
  if (!mult) return null
  const d1 = Math.floor(found.mantissa / 10)
  const d2 = found.mantissa % 10
  return [DIGIT_COLORS[d1], DIGIT_COLORS[d2], mult, GOLD]
}

/** A resistor body color used when the value has no clean 2-digit band code (or the module has
 * no `resistance` value at all): a neutral tan, close to the paper-toned body most resistor art
 * uses. */
const NEUTRAL_BAND_FILL = '#E6D3A8'

/**
 * Fill color for each numbered band shape (1-based slot) in a module's art. Uses the standard
 * 4-band resistor code when the part's resistance forms a clean 2-digit mantissa, and a single
 * black band for 0 ohm; otherwise every band shows the resistor body color instead of a stale or
 * misleading code, using the largest non-band shape's own fill (the body the bands sit on) or a
 * neutral tan when there is none. Null when the module has no band shapes at all.
 */
export function bandFills(m: ModuleDef, values?: Record<string, unknown>): string[] | null {
  const bandShapes = m.art?.shapes.filter((s) => s.band) ?? []
  if (bandShapes.length === 0) return null
  const maxBand = Math.max(...bandShapes.map((s) => s.band!))
  const resolved = partValue({ values }, m)
  const bands = resolved?.name === 'resistance' ? resistorBands(resolved.value) : null
  if (bands) return bands.slice(0, maxBand)
  const bodyShapes = m.art!.shapes.filter((s) => !s.band)
  const body = bodyShapes.reduce<ArtShape | undefined>((best, s) => (!best || s.w * s.h > best.w * best.h ? s : best), undefined)
  const fallback = body?.fill ?? NEUTRAL_BAND_FILL
  const fills = Array.from({ length: maxBand }, () => fallback)
  // A 0 ohm resistor is marked with one black band in the middle: the band slot nearest the
  // center of the band group.
  if (resolved?.name === 'resistance' && resolved.value === 0) {
    const lo = Math.min(...bandShapes.map((s) => s.x))
    const hi = Math.max(...bandShapes.map((s) => s.x + s.w))
    const mid = (lo + hi) / 2
    const center = bandShapes.reduce((best, s) => (Math.abs(s.x + s.w / 2 - mid) < Math.abs(best.x + best.w / 2 - mid) ? s : best))
    fills[center.band! - 1] = DIGIT_COLORS[0]
  }
  return fills
}

/**
 * The only param names the value field, caption and (for resistance) band coloring apply to,
 * in priority order. A module can carry other numeric params (an LED's forward voltage, its max
 * current) that are not meant to be user-editable values here, so those are never picked, no
 * matter how plausible their unit looks.
 */
export const PRIMARY_PARAM_NAMES = Object.keys(PARAM_RULES)

/**
 * The first of `resistance`, `capacitance` or `voltage` present in its own unit (ohm, F, V) with
 * a default in range for it (see PARAM_RULES). A param in another unit is skipped, so a
 * resistance given in farads is never shown as ohms.
 */
export function primaryParam(m: ModuleDef): { name: string; unit: string; default: number } | null {
  const electrical = m.electrical
  if (!isObj(electrical) || !isObj(electrical.params)) return null
  for (const name of PRIMARY_PARAM_NAMES) {
    const param = electrical.params[name]
    if (!isObj(param)) continue
    const def = param.default
    if (param.unit === PARAM_RULES[name].unit && validParamValue(name, def)) return { name, unit: PARAM_RULES[name].unit, default: def }
  }
  return null
}

/**
 * The part's chosen value for its primary param, or the module default when unset. A stored
 * override is only used when its unit matches the param's unit and its value is in range for the
 * param (see PARAM_RULES). Loading a file drops any other override with a warning
 * (`validateDiagram`), so the fallback to the default here is never silent for an imported sheet.
 */
export function partValue(part: { values?: Record<string, unknown> }, m: ModuleDef): { name: string; unit: string; value: number } | null {
  const p = primaryParam(m)
  if (!p) return null
  const stored = part.values?.[p.name]
  if (isObj(stored) && stored.unit === p.unit && validParamValue(p.name, stored.value)) return { name: p.name, unit: p.unit, value: stored.value }
  return { name: p.name, unit: p.unit, value: p.default }
}

/** "R1  4.7 kΩ" when the part has an editable value, else just its designator. Shared by the live editor canvas and the read-only sheet preview. */
export function partCaption(part: { designator: string; values?: Record<string, unknown> }, m: ModuleDef): string {
  const v = partValue(part, m)
  return v ? `${part.designator}  ${formatValue(v.value, v.unit)}` : part.designator
}
