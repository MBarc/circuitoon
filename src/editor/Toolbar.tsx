import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { deleteSelection, rotateParts } from './ops.ts'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { downloadText, exportFileName, readDiagramFile } from './files.ts'

export function Toolbar({ store, notice, onClose }: { store: EditorStore; notice?: string; onClose: () => void }) {
  const { diagram, selection } = useEditorState(store)
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(notice ? { kind: 'info', text: notice } : null)
  const hasSel = selection.parts.length + selection.wires.length > 0

  /** True when there is nothing to lose, or the user agrees to discard it. */
  const okToDiscard = () => !store.dirty || window.confirm(`Discard unsaved changes to ${diagram.title}?`)

  async function importFile(file: File) {
    const r = await readDiagramFile(file)
    if (!r.ok) return setMessage({ kind: 'error', text: r.message })
    store.load(r.diagram)
    setMessage(r.warnings.length ? { kind: 'info', text: `Opened with warnings: ${r.warnings.slice(0, 3).join('; ')}` } : null)
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
        setMessage(null)
      }}>New sheet</button>
      <button type="button" className="tool" onClick={() => okToDiscard() && fileRef.current?.click()}>Import JSON</button>
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
      {message && <p className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </header>
  )
}
