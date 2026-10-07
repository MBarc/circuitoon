// Code files in the editor (firmware spec 5.3, 6.1, 6.2): reading an upload (refused with the reason:
// over 256 KB, not UTF-8, an extension that does not fit the language), naming a download, the
// starter comment for Write code, and the Serial helpers (traceback line links, announcements).
import { LANGUAGE_EXT, type PartCode, SOURCE_MAX_BYTES, fileProblem, languageName } from '../format/code.ts'
import type { SerialLine } from './store.ts'

export function readCodeFile(name: string, bytes: Uint8Array, language: string): { ok: true; code: PartCode } | { ok: false; why: string } {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  const allowed = LANGUAGE_EXT[language] ?? []
  if (!allowed.includes(ext)) return { ok: false, why: `${name} is not ${languageName(language)} code: it needs a ${allowed.join(' or ')} file` }
  if (bytes.length > SOURCE_MAX_BYTES) return { ok: false, why: `${name} is over 256 KB` }
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, why: `${name} is not UTF-8 text` }
  }
  return { ok: true, code: { language, source, ...(fileProblem(name) ? {} : { file: name }) } }
}

export const downloadName = (code: PartCode, designator: string): string => code.file ?? `${designator}${(LANGUAGE_EXT[code.language] ?? ['.txt'])[0]}`

export const starterCode = (designator: string, board: string): string =>
  [
    `# Code for ${designator} (${board}). Press Run in the code dock to start it.`,
    '# gpiozero and RPi.GPIO work here. For example, to blink an LED on GPIO17:',
    '#',
    '#   from gpiozero import LED',
    '#   from signal import pause',
    '#',
    '#   led = LED(17)',
    '#   led.blink()',
    '#   pause()',
    '',
  ].join('\n')

/** A traceback reference to the script's own file (`File "blink.py", line 12`), split for a link. */
export function lineRef(text: string, file: string): { before: string; ref: string; line: number; after: string } | null {
  const m = /File "([^"]+)", line (\d+)/.exec(text)
  if (!m || m[1] !== file) return null
  return { before: text.slice(0, m.index), ref: m[0], line: Number(m[2]), after: text.slice(m.index + m[0].length) }
}

/** What a screen reader hears for the lines since `from`: the last three at most. */
export const announcement = (lines: SerialLine[], from: number): string => lines.slice(Math.max(from, lines.length - 3)).map((l) => l.text).join('. ')
