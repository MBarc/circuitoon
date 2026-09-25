import { useEffect, useMemo, useRef } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import './editor.css'

function useEditorKeys(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const s = store.getState()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        store.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.parts.length || s.selection.wires.length) {
          e.preventDefault()
          store.commit(deleteSelection(s.diagram, s.selection))
        }
      } else if (key === 'r' && !mod) {
        if (s.selection.parts.length) store.commit(rotateParts(s.diagram, s.selection.parts))
      } else if (e.key === 'Escape') store.select(EMPTY_SELECTION)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}

export function Editor({ initial, notice, onClose }: { initial: Diagram; notice?: string; onClose: () => void }) {
  const store = useMemo(() => new EditorStore(initial), [initial])
  const canvasApi = useRef<{ addAtCenter: (moduleId: string) => void } | null>(null)
  useEditorKeys(store)
  return (
    <div className="editor">
      <header className="toolbar">
        <button type="button" className="wordmark" onClick={onClose} title="Back to the start screen">Circuitoon</button>
        {notice && <p className="message">{notice}</p>}
      </header>
      <LibraryPanel onAdd={(id) => canvasApi.current?.addAtCenter(id)} />
      <Canvas store={store} onReady={(api) => (canvasApi.current = api)} />
      <Inspector store={store} />
    </div>
  )
}
