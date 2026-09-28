import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import type { Diagram } from '../format/diagram.ts'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { severityCounts, useProblems } from './problems.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { downloadText, exportFileName, readDiagramFile } from './files.ts'
import { LoadWarnings } from './LoadWarnings.tsx'
import { MAINS_NOTICE, hasMains, withSheetNotes } from '../format/mains.ts'

export function Toolbar({ store, warnings, onClose }: { store: EditorStore; warnings?: string[]; onClose: () => void }) {
  const { diagram, selection } = useEditorState(store)
  const fileRef = useRef<HTMLInputElement>(null)
  // The sheet the user agreed to replace when they chose Import, and the latest import request.
  const importBase = useRef<Diagram | null>(null)
  const importSeq = useRef(0)
  const [error, setError] = useState<string | null>(null)
  // Warnings the open sheet was loaded with; every one stays reachable until dismissed.
  const [loadWarnings, setLoadWarnings] = useState<{ list: string[]; key: number } | null>(warnings?.length ? { list: warnings, key: 0 } : null)
  const hasSel = selection.parts.length + selection.wires.length > 0
  const findings = useProblems(store)
  const errors = findings.filter((f) => f.severity === 'error').length
  const mains = hasMains(diagram)

  /** True when there is nothing to lose, or the user agrees to discard it. */
  const okToDiscard = () => !store.dirty || window.confirm(`Discard unsaved changes to ${diagram.title}?`)

  async function importFile(file: File) {
    const seq = ++importSeq.current
    const base = importBase.current
    const r = await readDiagramFile(file)
    // A newer import has started since this one; its result wins.
    if (seq !== importSeq.current) return
    if (!r.ok) return setError(r.message)
    // The sheet was edited while the file was being read: ask again before replacing that work.
    const now = store.getState().diagram
    if (now !== base && store.dirty && !window.confirm(`Discard unsaved changes to ${now.title}?`)) return
    store.load(r.diagram)
    setError(null)
    setLoadWarnings(r.warnings.length ? { list: r.warnings, key: seq } : null)
  }

  return (
    <header className="toolbar">
      <button type="button" className="wordmark" onClick={() => okToDiscard() && onClose()} title="Back to the start screen">Circuitoon</button>
      <span className="title">{diagram.title}</span>
      <button type="button" className="tool" disabled={!store.canUndo} onClick={() => store.undo()}>Undo</button>
      <button type="button" className="tool" disabled={!store.canRedo} onClick={() => store.redo()}>Redo</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" disabled={!selection.parts.length} onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate</button>
      <button type="button" className="tool" disabled={!hasSel} onClick={() => store.commit(deleteSelection(diagram, selection))}>Delete</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" onClick={() => {
        if (!okToDiscard()) return
        store.load(emptyDiagram())
        setError(null)
        setLoadWarnings(null)
      }}>New sheet</button>
      <button type="button" className="tool" onClick={() => {
        if (!okToDiscard()) return
        importBase.current = store.getState().diagram
        fileRef.current?.click()
      }}>Import JSON</button>
      <button type="button" className="tool" onClick={() => {
        downloadText(exportFileName(diagram.title), serializeDiagram(withSheetNotes(diagram)))
        store.markSaved()
      }}>Export JSON</button>
      {findings.length > 0 && (
        <button
          type="button"
          className={`tool problems-badge ${errors ? 'error' : 'warning'}`}
          title="Show the wiring problems in the side panel"
          aria-label={`${findings.length === 1 ? '1 problem' : `${findings.length} problems`}: ${severityCounts(findings)}. Show them in the side panel`}
          onClick={() => {
            // With nothing selected the side panel lists them; move focus to that list.
            store.select(EMPTY_SELECTION)
            requestAnimationFrame(() => document.getElementById('problems-title')?.focus())
          }}
        >
          <SeverityMark severity={errors ? 'error' : 'warning'} />
          {findings.length === 1 ? '1 problem' : `${findings.length} problems`}
        </button>
      )}
      {mains && <span className="mains-badge" role="note" title={MAINS_NOTICE} aria-label={MAINS_NOTICE}>Mains: drawn connections only</span>}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importFile(f)
          e.target.value = ''
        }}
      />
      {error && <p className="message error" role="alert">{error}</p>}
      {loadWarnings && <LoadWarnings key={loadWarnings.key} warnings={loadWarnings.list} onDismiss={() => setLoadWarnings(null)} />}
      {mains && <p className="print-notice">{MAINS_NOTICE}</p>}
    </header>
  )
}
