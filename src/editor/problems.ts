// The editor's view of the wiring checker: the Problems list, the toolbar badge and the canvas
// light of a hovered problem. Checking needs every position (mounts depend on them), so it runs
// once per edit, never per drag frame: while a gesture is open the list from before it stays up,
// and the drop (or cancel) checks again.
import { useEffect } from 'react'
import { type Finding, checkDiagram } from '../format/checks.ts'
import type { Diagram } from '../format/diagram.ts'
import { type EditorStore, type Highlight, useEditorState } from './store.ts'

interface Checked {
  d: Pick<Diagram, 'parts' | 'connections' | 'modules'>
  findings: Finding[]
  /** True when the checker threw on this sheet: the list says so instead of breaking the panel. */
  failed: boolean
}

/** One entry per store, so the badge and the list share one check. */
const cache = new WeakMap<EditorStore, Checked>()

/**
 * The store's findings: checked again only when the parts, wires or modules change (a title or a
 * selection change reuses the list), and never while a drag is open.
 */
export function problemsOf(store: EditorStore): Finding[] {
  const d = store.getState().diagram
  const hit = cache.get(store)
  if (hit && (store.dragging || (hit.d.parts === d.parts && hit.d.connections === d.connections && hit.d.modules === d.modules))) return hit.findings
  let findings: Finding[] = []
  let failed = false
  try {
    findings = checkDiagram(d)
  } catch (err) {
    // A checker bug must never take the editor down: the list shows one row saying so.
    console.error('The wiring checker hit an error on this sheet', err)
    failed = true
  }
  cache.set(store, { d: { parts: d.parts, connections: d.connections, modules: d.modules }, findings, failed })
  return findings
}

/** True when the last check of the store's sheet threw (see `problemsOf`). */
export function checkFailed(store: EditorStore): boolean {
  problemsOf(store)
  return cache.get(store)?.failed ?? false
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** True for an error or a warning; a note (severity info) is not a problem and is never counted as one. */
export const isProblem = (f: Finding): boolean => f.severity !== 'info'

/** "3 errors, 4 warnings": the counts by severity of problems (never notes), for the list heading and the toolbar badge's name. */
export function severityCounts(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.filter((f) => f.severity === 'warning').length
  return [errors && plural(errors, 'error'), warnings && plural(warnings, 'warning')].filter(Boolean).join(', ')
}

/** What a problem row lights on the canvas. */
export const highlightOf = (f: Finding): Highlight => ({ id: f.id, severity: f.severity, parts: f.parts, pins: f.pins, wires: f.wires })

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Keeps the canvas light true to the list: a light whose finding is gone (fixed by an edit, an
 * undo, another sheet) goes out, and one whose finding now involves other parts, pins or wires
 * follows it.
 */
export function reconcileHighlight(store: EditorStore, findings: Finding[]) {
  const h = store.getState().highlight
  if (!h?.id) return
  const f = findings.find((x) => x.id === h.id)
  if (!f) store.setHighlight(null)
  else if (!same(highlightOf(f), h)) store.setHighlight(highlightOf(f))
}

/** `problemsOf`, re-read whenever the store changes; the canvas light is kept in step with it. */
export function useProblems(store: EditorStore): Finding[] {
  const { highlight } = useEditorState(store)
  const findings = problemsOf(store)
  useEffect(() => reconcileHighlight(store, findings), [store, findings, highlight])
  return findings
}
