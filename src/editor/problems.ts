// The editor's view of the wiring checker: the Problems list, the toolbar badge and the wire
// panel's broken notice. Checking needs every position (mounts depend on them), so it runs once
// per edit, never per drag frame: while a gesture is open the list from before it stays up, and
// the drop (or cancel) checks again.
import { useMemo } from 'react'
import { type BrokenConnection, type Finding, brokenConnections, checkDiagram } from '../format/checks.ts'
import type { Diagram } from '../format/diagram.ts'
import { type EditorStore, useEditorState } from './store.ts'

interface Checked {
  d: Pick<Diagram, 'parts' | 'connections' | 'modules'>
  findings: Finding[]
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
  const findings = checkDiagram(d)
  cache.set(store, { d: { parts: d.parts, connections: d.connections, modules: d.modules }, findings })
  return findings
}

/** `problemsOf`, re-read whenever the store changes. */
export function useProblems(store: EditorStore): Finding[] {
  useEditorState(store)
  return problemsOf(store)
}

/**
 * `brokenConnections`, rebuilt only when the connections, the modules, or which parts exist (and
 * their modules) change. Whether an end resolves does not depend on positions or mounts, so a
 * drag, which replaces the parts every frame, reuses the list.
 */
export function useBrokenConnections(d: Diagram): BrokenConnection[] {
  const partsKey = d.parts.map((p) => JSON.stringify([p.uid, p.module, p.designator])).join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => brokenConnections(d), [d.connections, d.modules, partsKey])
}
