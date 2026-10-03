// The editor's view of the wiring checker: the Problems list, the toolbar badge and the canvas
// light of a hovered problem. Checking needs every position (mounts depend on them), so it runs
// once per edit, never per drag frame: while a gesture is open the list from before it stays up,
// and the drop (or cancel) checks again.
import { useEffect } from 'react'
import { type Finding, checkDiagram } from '../format/checks.ts'
import type { Diagram } from '../format/diagram.ts'
import { moduleDrift, updateLines, updateParts } from '../format/moduleDrift.ts'
import { andList } from '../format/words.ts'
import { modulesById } from '../library.ts'
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
    findings = [...driftFindings(d), ...checkDiagram(d)]
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

const libraryOf = (id: string) => (Object.hasOwn(modulesById, id) ? modulesById[id] : undefined)

/**
 * One finding per stored built-in part older than the library (Ruling D1): a warning when the
 * library only adds or describes data (Update parts takes it), an error when its pins, holes,
 * internal joins or geometry changed (the part must be placed again). Errors first.
 */
export function driftFindings(d: Pick<Diagram, 'parts' | 'modules'>): Finding[] {
  const out: Finding[] = []
  for (const id of Object.keys(d.modules).sort()) {
    const lib = libraryOf(id)
    const drift = lib && moduleDrift(d.modules[id], lib)
    if (!drift) continue
    const parts = d.parts.filter((p) => p.module === id)
    if (!parts.length) continue
    const names = andList(parts.map((p) => p.designator))
    const them = parts.length === 1 ? 'it' : 'them'
    const message =
      drift.kind === 'block'
        ? `${names}: the library's ${lib.name} has changed: ${drift.what.join(', ')}. ${names} ${parts.length === 1 ? 'is' : 'are'} drawn from old part data; delete ${them} and place ${them} again from the Parts panel.`
        : `${names}: the library has newer data for ${lib.name}: ${drift.what.join(', ')}. The wiring stays as drawn; Update parts to current library takes it, so the checks use it.`
    out.push({
      id: `module-drift|${id}`, rule: 'module-drift', severity: drift.kind === 'block' ? 'error' : 'warning', message,
      subject: parts[0].designator, target: names, parts: parts.map((p) => p.uid), pins: [], wires: [],
      select: { parts: parts.map((p) => p.uid), wires: [] },
    })
  }
  return out.sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'))
}

/** True when Update parts to current library would change the sheet. */
export const canUpdateParts = (d: Diagram): boolean => updateParts(d, libraryOf).updated.length > 0

/**
 * Update parts to current library (Ruling D1): every stored built-in part whose drift is the update
 * kind takes the library copy, as one undo step. Returns the lines saying what changed (blocking
 * drift is listed as left alone), and the sheet it committed, or null when nothing changed.
 */
export function updatePartsInStore(store: EditorStore): { diagram: Diagram; lines: string[] } | null {
  const u = updateParts(store.getState().diagram, libraryOf)
  if (!u.updated.length) return null
  store.commit(u.diagram)
  return { diagram: u.diagram, lines: updateLines(u) }
}
