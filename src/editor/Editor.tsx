import { useEffect, useMemo, useRef } from 'react'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { buttonLed } from '../samples/buttonLed.ts'
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

export function Editor() {
  // Opens on the sample sheet so the first view shows what the editor does.
  const store = useMemo(() => new EditorStore(structuredClone(buttonLed)), [])
  const canvasApi = useRef<{ addAtCenter: (moduleId: string) => void } | null>(null)
  useEditorKeys(store)
  return (
    <div className="editor">
      <header className="toolbar">
        <a className="wordmark" href="#/">Circuitoon</a>
      </header>
      <LibraryPanel onAdd={(id) => canvasApi.current?.addAtCenter(id)} />
      <Canvas store={store} onReady={(api) => (canvasApi.current = api)} />
      <aside className="inspector" aria-label="Properties" />
    </div>
  )
}
