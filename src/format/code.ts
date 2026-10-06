// Code on a part (firmware spec 3.1): `code: { language, source, file? }`, an optional part key
// (the diagram format stays circuitoon-diagram/1; older readers keep unknown part keys). Wrong types
// or an oversized source drop the code; unknown keys inside it are dropped; a language this build
// does not know is kept with a warning, so newer sheets survive older editors. Pure; imports only
// types from module.ts (Task 5), which imports KNOWN_LANGUAGES from here.

import type { ModuleDef } from './module.ts'

/** Every language a slice plans (ruling R2): modules may name any of them; RUNNABLE is what this build runs. */
export const KNOWN_LANGUAGES = ['python-rpi', 'arduino-avr', 'micropython'] as const
export const RUNNABLE: readonly string[] = ['python-rpi']
export const LANGUAGE_NAMES: Record<string, string> = { 'python-rpi': 'Raspberry Pi Python', 'arduino-avr': 'Arduino C++', micropython: 'MicroPython' }
/** The file extensions an upload of each language may have (spec 6.2: `.ino` on a Pi is refused). */
export const LANGUAGE_EXT: Record<string, string[]> = { 'python-rpi': ['.py'], 'arduino-avr': ['.ino', '.cpp'], micropython: ['.py'] }
export const SOURCE_MAX_BYTES = 256 * 1024
export const FILE_NAME_MAX = 255

export interface PartCode { language: string; source: string; file?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length
export const languageName = (id: string): string => LANGUAGE_NAMES[id] ?? `"${id}"`

/** Why a code file name cannot be kept (spec 3.1: at most 255 characters, no path separators), or null. */
export function fileProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return 'it must be text'
  if (name.length > FILE_NAME_MAX) return `it is over ${FILE_NAME_MAX} characters`
  if (/[\\/]/.test(name)) return 'it has a path separator'
  return null
}

/** A part's `code` as loaded: the value to keep (the same object when nothing changed), or null to drop it, and the warnings in words. */
export function checkCode(raw: unknown, who: string): { code: PartCode | null; warnings: string[] } {
  const drop = (why: string) => ({ code: null, warnings: [`${who}'s code was dropped: ${why}`] })
  if (!isObj(raw)) return drop('it must be { "language", "source", "file" }')
  if (typeof raw.language !== 'string' || raw.language === '') return drop('its language must be text')
  if (typeof raw.source !== 'string') return drop('its source must be text')
  if (utf8Bytes(raw.source) > SOURCE_MAX_BYTES) return drop('its source is over 256 KB')
  const warnings: string[] = []
  const extra = Object.keys(raw).filter((k) => k !== 'language' && k !== 'source' && k !== 'file')
  if (extra.length) warnings.push(`${who}'s code had keys this version does not know (${extra.join(', ')}), which were dropped`)
  const badFile = raw.file === undefined ? null : fileProblem(raw.file)
  if (badFile) warnings.push(`${who}'s code file name was dropped: ${badFile}`)
  if (!(KNOWN_LANGUAGES as readonly string[]).includes(raw.language))
    warnings.push(`${who}'s code is in "${raw.language}", which this version of Circuitoon does not know; it is kept but will not run`)
  if (!extra.length && !badFile) return { code: raw as unknown as PartCode, warnings }
  return { code: { language: raw.language, source: raw.source, ...(raw.file !== undefined && !badFile ? { file: raw.file as string } : {}) }, warnings }
}


/** The languages a module's code may be in (firmware spec 3.2): none on a custom part in this slice. */
export function languagesOf(m: ModuleDef | undefined): string[] {
  return m && m.custom !== true ? (m.firmware?.languages ?? []) : []
}

/** "U1 is an Arduino Uno R3; its code is Raspberry Pi Python and won't run" for a known language the board does not take (kept, spec 3.1); else null. `m` is the module with its library data. */
export function languageMismatch(who: string, m: ModuleDef, language: string): string | null {
  if (!(KNOWN_LANGUAGES as readonly string[]).includes(language) || languagesOf(m).includes(language)) return null
  return `${who} is ${/^[aeiou]/i.test(m.name) ? 'an' : 'a'} ${m.name}; its code is ${languageName(language)} and won't run`
}
