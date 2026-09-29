import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import type { Diagram } from '../format/diagram.ts'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { isProblem, severityCounts, useProblems } from './problems.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { EXPORT_SUFFIX, defaultBaseName, downloadText, readDiagramFile, saveWithPicker, type SavePicker } from './files.ts'
import { ExportDialog } from './ExportDialog.tsx'
import { LoadWarnings } from './LoadWarnings.tsx'
import { MAINS_NOTICE, hasMains, withSheetNotes } from '../format/mains.ts'

export function Toolbar({ store, warnings, onClose }: { store: EditorStore; warnings?: string[]; onClose: () => void }) {
  const { diagram, selection } = useEditorState(store)
  const fileRef = useRef<HTMLInputElement>(null)
  // The sheet the user agreed to replace when they chose Import, and the latest import request.
  const importBase = useRef<Diagram | null>(null)
  const importSeq = useRef(0)
  const [error, setError] = useState<string | null>(null)
  // The file name base last chosen on Export for the open sheet, offered next time; the in-app
  // naming dialog, when the browser has no Save As dialog, is open while this holds its first name.
  const lastName = useRef<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  // Warnings the open sheet was loaded with; every one stays reachable until dismissed.
  const [loadWarnings, setLoadWarnings] = useState<{ list: string[]; key: number } | null>(warnings?.length ? { list: warnings, key: 0 } : null)
  const hasSel = selection.parts.length + selection.wires.length + (selection.annotations?.length ?? 0) > 0
  // The badge counts problems only: a note (a parallel battery bank) is not one.
  const findings = useProblems(store).filter(isProblem)
  const errors = findings.filter((f) => f.severity === 'error').length
  const mains = hasMains(diagram)

  /** True when there is nothing to lose, or the user agrees to discard it. */
  const okToDiscard = () => !store.dirty || window.confirm(`Discard unsaved changes to ${diagram.title}?`)

  /** A new or imported sheet starts with its own file name again. */
  function loaded() {
    lastName.current = null
    setError(null)
  }

  const exportText = () => serializeDiagram(withSheetNotes(store.getState().diagram))

  /**
   * Export JSON: the browser's own Save As dialog where there is one (showSaveFilePicker), else the
   * in-app naming dialog, then a download. Cancelling either saves nothing.
   */
  async function exportJson() {
    const base = defaultBaseName(store.getState().diagram.title, lastName.current)
    const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker) {
      const r = await saveWithPicker(picker.bind(window), base, exportText())
      if (r.status === 'saved') {
        lastName.current = r.base
        setError(null)
        store.markSaved()
      }
      if (r.status === 'failed') setError(r.message)
      if (r.status !== 'unavailable') return
    }
    setNaming(base)
  }

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
    loaded()
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
        loaded()
        setLoadWarnings(null)
      }}>New sheet</button>
      <button type="button" className="tool" onClick={() => {
        if (!okToDiscard()) return
        importBase.current = store.getState().diagram
        fileRef.current?.click()
      }}>Import JSON</button>
      <button type="button" className="tool" aria-haspopup="dialog" onClick={() => void exportJson()}>Export JSON</button>
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
      {naming !== null && (
        <ExportDialog
          initial={naming}
          onCancel={() => setNaming(null)}
          onExport={(base) => {
            setNaming(null)
            lastName.current = base
            downloadText(base + EXPORT_SUFFIX, exportText())
            store.markSaved()
          }}
        />
      )}
    </header>
  )
}
