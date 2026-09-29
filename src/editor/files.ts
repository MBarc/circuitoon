// Opening and saving diagram files. Shared by the start screen and the editor toolbar.
import { type Diagram, validateDiagram } from '../format/diagram.ts'

export type OpenResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }

export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Reads and checks a diagram file. Never rejects: every failure comes back as a message. */
export async function readDiagramFile(file: File): Promise<OpenResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: `${file.name} is larger than 5 MB, so it was not opened.` }
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, message: `${file.name} is not valid JSON, so nothing was opened.` }
  }
  try {
    const r = validateDiagram(raw)
    if (!r.ok) return { ok: false, message: `${file.name} is not a Circuitoon diagram: ${r.errors.slice(0, 3).join('; ')}` }
    return { ok: true, diagram: r.diagram, warnings: r.warnings }
  } catch (err) {
    return { ok: false, message: `${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  // Some browsers start the download after click() returns, so revoke on the next task.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return `${base || 'Untitled sheet'}.circuitoon.json`
}

export const EXPORT_SUFFIX = '.circuitoon.json'
// Refused in file names on Windows or macOS, plus every control character.
// eslint-disable-next-line no-control-regex
const NOT_IN_NAMES = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/**
 * A file name base the user typed, made safe to save: characters Windows or macOS refuse and
 * control characters removed, a typed `.circuitoon.json` or `.json` dropped (the suffix is added
 * once, on export), trimmed, trailing dots dropped, and "circuitoon" when nothing is left.
 */
export function cleanBaseName(name: string): string {
  let base = name.replace(NOT_IN_NAMES, '').trim()
  const lower = base.toLowerCase()
  if (lower.endsWith(EXPORT_SUFFIX)) base = base.slice(0, -EXPORT_SUFFIX.length)
  else if (lower.endsWith('.json')) base = base.slice(0, -'.json'.length)
  base = base.replace(/[.\s]+$/, '').trim()
  return base || 'circuitoon'
}

/** The file name base Export offers: the one last chosen for this sheet, else one from its title. */
export function defaultBaseName(title: string, remembered?: string | null): string {
  return remembered || exportFileName(title).slice(0, -EXPORT_SUFFIX.length)
}

type Writable = { write(data: string): Promise<void>; close(): Promise<void> }
type SaveOptions = { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }
/** The part of the File System Access API's `window.showSaveFilePicker` that Export uses. */
export type SavePicker = (opts: SaveOptions) => Promise<{ name: string; createWritable(): Promise<Writable> }>

export type PickerResult = { status: 'saved'; base: string } | { status: 'cancelled' } | { status: 'unavailable' } | { status: 'failed'; message: string }

const errorName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : '')

/**
 * Saves `text` through the browser's Save As dialog, suggesting `base` + `.circuitoon.json`.
 * Cancelled when the user closes the dialog; unavailable when the picker cannot be used here (the
 * caller then asks for a name itself); failed, with a message, when the chosen file cannot be
 * written. A browser that refuses the two-part extension is asked again with plain `.json`.
 */
export async function saveWithPicker(picker: SavePicker, base: string, text: string): Promise<PickerResult> {
  const ask = (ext: string) => picker({ suggestedName: base + EXPORT_SUFFIX, types: [{ description: 'Circuitoon diagram', accept: { 'application/json': [ext] } }] })
  let handle: Awaited<ReturnType<SavePicker>>
  try {
    handle = await ask(EXPORT_SUFFIX).catch((e: unknown) => {
      if (errorName(e) === 'TypeError') return ask('.json')
      throw e
    })
  } catch (e) {
    return errorName(e) === 'AbortError' ? { status: 'cancelled' } : { status: 'unavailable' }
  }
  try {
    const out = await handle.createWritable()
    await out.write(text)
    await out.close()
  } catch (e) {
    return { status: 'failed', message: `${handle.name} could not be saved: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { status: 'saved', base: cleanBaseName(handle.name) }
}
