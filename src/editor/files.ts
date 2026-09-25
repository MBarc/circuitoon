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
