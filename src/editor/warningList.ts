// Ordering the warnings a diagram file opened with, for the toolbar's warnings panel. Pure, so the
// rule that no electrical-value replacement is ever hidden is unit-tested.
import { VALUE_DROPPED } from '../format/diagram.ts'

export interface LoadWarning {
  text: string
  /** A value override (resistance, capacitance, voltage) the file asked for was replaced by the
   * module default: the sheet now shows a different electrical value than the file. */
  valueReplaced: boolean
}

/** How many warnings the panel shows before "Show all". */
export const COLLAPSED_COUNT = 3

/** Every warning, value replacements first, otherwise in the order the file produced them. */
export function orderWarnings(warnings: string[]): LoadWarning[] {
  const all = warnings.map((text) => ({ text, valueReplaced: text.endsWith(VALUE_DROPPED) }))
  return [...all.filter((w) => w.valueReplaced), ...all.filter((w) => !w.valueReplaced)]
}

/**
 * The warnings the panel lists: all of them when expanded; otherwise the first COLLAPSED_COUNT,
 * widened so every value replacement stays in view even when there are more than that.
 */
export function shownWarnings(warnings: LoadWarning[], expanded: boolean): LoadWarning[] {
  if (expanded) return warnings
  const values = warnings.filter((w) => w.valueReplaced).length
  return warnings.slice(0, Math.max(COLLAPSED_COUNT, values))
}
