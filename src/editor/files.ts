// Opening and saving diagram files. Shared by the start screen and the editor toolbar.
import { type Diagram, validateDiagram } from '../format/diagram.ts'

export type OpenResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }

export async function readDiagramFile(file: File): Promise<OpenResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, message: `${file.name} is not valid JSON, so nothing was opened.` }
  }
  const r = validateDiagram(raw)
  if (!r.ok) return { ok: false, message: `${file.name} is not a Circuitoon diagram: ${r.errors.slice(0, 3).join('; ')}` }
  return { ok: true, diagram: r.diagram, warnings: r.warnings }
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export function exportFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return `${base || 'Untitled sheet'}.circuitoon.json`
}
