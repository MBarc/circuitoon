// Opening and saving diagram files. Shared by the start screen and the editor toolbar.
import { type Diagram, validateDiagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'

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
    const r = validateDiagram(raw, { library: libraryLookup })
    if (!r.ok) return { ok: false, message: `${file.name} is not a Circuitoon diagram: ${r.errors.slice(0, 3).join('; ')}` }
    return { ok: true, diagram: r.diagram, warnings: r.warnings }
  } catch (err) {
    return { ok: false, message: `${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
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

/**
 * A kind of file the editor saves: the suffix after the base name, the extension the Save As
 * dialog is given (and a plainer one to retry with, when a browser refuses a two-part extension),
 * and a looser suffix a typed name may end in.
 */
export interface FileKind {
  suffix: string
  ext: string
  retryExt?: string
  loose: string
  description: string
  mime: string
}
export const SHEET_FILE: FileKind = { suffix: EXPORT_SUFFIX, ext: EXPORT_SUFFIX, retryExt: '.json', loose: '.json', description: 'Circuitoon diagram', mime: 'application/json' }
export const BOM_FILE: FileKind = { suffix: '-bom.csv', ext: '.csv', loose: '.csv', description: 'Bill of materials (CSV)', mime: 'text/csv' }
/** A custom part (a module), for My parts, a netlist's `modules` or a library submission. */
export const PART_FILE: FileKind = { suffix: '.circuitoon-part.json', ext: '.circuitoon-part.json', retryExt: '.json', loose: '.json', description: 'Circuitoon part', mime: 'application/json' }
export const KICAD_FILE: FileKind = { suffix: '.net', ext: '.net', loose: '.net', description: 'KiCad netlist', mime: 'text/plain' }
/** The longest file name base Export writes (the whole name stays well under every OS limit). */
export const BASE_NAME_MAX = 120
// Refused in file names on Windows or macOS, plus every control character.
// eslint-disable-next-line no-control-regex
const NOT_IN_NAMES = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/**
 * A file name base the user typed, made safe to save: characters Windows or macOS refuse and
 * control characters removed, a typed suffix of the kind dropped (`.circuitoon.json` or `.json` for
 * a sheet, `-bom.csv` or `.csv` for a bill of materials, `.net` for a KiCad netlist: the suffix is added once, on export), a
 * Windows device name (CON, COM1, ...) prefixed with `_`, cut to BASE_NAME_MAX characters, trimmed,
 * trailing dots dropped, and "circuitoon" when nothing is left.
 */
export function cleanBaseName(name: string, kind: FileKind = SHEET_FILE): string {
  let base = name.replace(NOT_IN_NAMES, '').trim()
  const lower = base.toLowerCase()
  if (lower.endsWith(kind.suffix)) base = base.slice(0, -kind.suffix.length)
  else if (lower.endsWith(kind.loose)) base = base.slice(0, -kind.loose.length)
  // A Windows device name, alone or before an extension, cannot be a file name there.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base)) base = `_${base}`
  base = base.slice(0, BASE_NAME_MAX).replace(/[.\s]+$/, '').trim()
  return base || 'circuitoon'
}

/** The file name base Export offers: the one last chosen for this sheet, else one from its title. */
export function defaultBaseName(title: string, remembered?: string | null): string {
  return remembered || cleanBaseName(exportFileName(title).slice(0, -EXPORT_SUFFIX.length))
}

type Writable = { write(data: string): Promise<void>; close(): Promise<void> }
type SaveOptions = { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }
/** The part of the File System Access API's `window.showSaveFilePicker` that Export uses. */
export type SavePicker = (opts: SaveOptions) => Promise<{ name: string; createWritable(): Promise<Writable> }>

export type PickerResult = { status: 'saved'; base: string } | { status: 'cancelled' } | { status: 'unavailable' } | { status: 'failed'; message: string }

const errorName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : '')

/**
 * Saves `text` through the browser's Save As dialog, suggesting `base` + the kind's suffix
 * (`.circuitoon.json` for a sheet, `-bom.csv` for a bill of materials, `.net` for a KiCad netlist). Cancelled when the user
 * closes the dialog; unavailable when the picker cannot be used here (the caller then asks for a
 * name itself); failed, with a message, when the chosen file cannot be written. A browser that
 * refuses a sheet's two-part extension is asked again with plain `.json`.
 */
export async function saveWithPicker(picker: SavePicker, base: string, text: string, kind: FileKind = SHEET_FILE): Promise<PickerResult> {
  const ask = (ext: string) => picker({ suggestedName: base + kind.suffix, types: [{ description: kind.description, accept: { [kind.mime]: [ext] } }] })
  let handle: Awaited<ReturnType<SavePicker>>
  try {
    handle = await ask(kind.ext).catch((e: unknown) => {
      if (errorName(e) === 'TypeError' && kind.retryExt) return ask(kind.retryExt)
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
  return { status: 'saved', base: cleanBaseName(handle.name, kind) }
}
