import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import type { Diagram } from '../format/diagram.ts'
import { deleteSelection, rotateParts } from './ops.ts'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { downloadText, exportFileName, readDiagramFile } from './files.ts'
import { LoadWarnings } from './LoadWarnings.tsx'

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
        downloadText(exportFileName(diagram.title), serializeDiagram(diagram))
        store.markSaved()
      }}>Export JSON</button>
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
    </header>
  )
}
