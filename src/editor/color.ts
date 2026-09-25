// Helpers for the inspector's custom color field.
import { wireColor } from '../format/diagram.ts'

/** The hex the custom color field shows for a stored wire color (a named color shows its hex). */
export function shownHex(stored: string): string {
  return stored.startsWith('#') ? stored : wireColor(stored)
}

/**
 * True when the typed value is a real edit. Leaving the field with the value it showed, in any
 * letter case, or retyping the stored color name, is not an edit and must not add an undo step.
 */
export function hexEditChanged(stored: string, typed: string): boolean {
  const v = typed.trim().toLowerCase()
  return v !== shownHex(stored).toLowerCase() && v !== stored.toLowerCase()
}
