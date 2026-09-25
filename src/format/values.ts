// Part values: SI-prefixed formatting and parsing, standard value series, and resistor color
// bands. Pure and unit-tested; the editor and renderer just call into these.

import { isNum, isObj, type ModuleDef } from './module.ts'

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
const PREFIX_MULT: Record<string, number> = { M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, [MICRO]: 1e-6, n: 1e-9, p: 1e-12 }

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

/**
 * Rejects non-finite, negative or zero values; otherwise rounds to 6 significant digits, so a
 * multiplication like `100 * 1e-9` (which lands on 1.0000000000000001e-7 in floating point)
 * comes out as the clean 1e-7 rather than carrying that noise into the diagram.
 */
function finish(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null
  return roundSig(v, 6)
}

/**
 * Parses free-typed value text for a param of the given unit: "4.7k", "4k7", "4.7 kΩ",
 * "4.7kohm", "220", "1M", "100n", "100nF", "0.1u", "10µ", "10uF", "3.7", "3.7V". Returns null
 * for empty, negative, zero, non-numeric or wrong-unit-suffix input.
 */
export function parseValue(text: string, unit: string): number | null {
  const t = text.trim()
  if (!t) return null

  // Embedded decimal point, e.g. "4k7" meaning 4.7k, or "1u5" meaning 1.5u.
  const embedded = /^(-?\d+)([A-Za-zµ])(\d+)([A-Za-zΩΩ]*)$/.exec(t)
  if (embedded) {
    const [, whole, letter, frac, rest] = embedded
    if (!Object.hasOwn(PREFIX_MULT, letter) || !matchesUnit(rest, unit)) return null
    return finish(Number(`${whole}.${frac}`) * PREFIX_MULT[letter])
  }

  const m = /^(-?\d*\.?\d+)\s*([A-Za-zµΩΩ]*)$/.exec(t)
  if (!m) return null
  const [, numStr, suffixRaw] = m
  const n = Number(numStr)
  if (!Number.isFinite(n)) return null
  if (suffixRaw === '') return finish(n)
  const { mult, rest } = splitPrefix(suffixRaw)
  if (!matchesUnit(rest, unit)) return null
  return finish(n * mult)
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

/**
 * The only param names the value field, caption and (for resistance) band coloring apply to,
 * in priority order. A module can carry other numeric params (an LED's forward voltage, its max
 * current) that are not meant to be user-editable values here, so those are never picked, no
 * matter how plausible their unit looks.
 */
const PRIMARY_PARAM_NAMES = ['resistance', 'capacitance', 'voltage']

/** The first of `resistance`, `capacitance` or `voltage` present with a matching unit and a numeric default. */
export function primaryParam(m: ModuleDef): { name: string; unit: string; default: number } | null {
  const electrical = m.electrical
  if (!isObj(electrical) || !isObj(electrical.params)) return null
  for (const name of PRIMARY_PARAM_NAMES) {
    const param = electrical.params[name]
    if (!isObj(param)) continue
    const unit = param.unit
    const def = param.default
    if ((unit === 'ohm' || unit === 'F' || unit === 'V') && isNum(def)) return { name, unit, default: def }
  }
  return null
}

/** The part's chosen value for its primary param, or the module default when unset. */
export function partValue(part: { values?: Record<string, unknown> }, m: ModuleDef): { name: string; unit: string; value: number } | null {
  const p = primaryParam(m)
  if (!p) return null
  const stored = part.values?.[p.name]
  if (isObj(stored) && isNum(stored.value) && typeof stored.unit === 'string') return { name: p.name, unit: stored.unit, value: stored.value }
  return { name: p.name, unit: p.unit, value: p.default }
}

/** "R1  4.7 kΩ" when the part has an editable value, else just its designator. Shared by the live editor canvas and the read-only sheet preview. */
export function partCaption(part: { designator: string; values?: Record<string, unknown> }, m: ModuleDef): string {
  const v = partValue(part, m)
  return v ? `${part.designator}  ${formatValue(v.value, v.unit)}` : part.designator
}
