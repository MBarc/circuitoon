import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { Toolbar } from './Toolbar.tsx'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import './editor.css'

function useEditorKeys(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const s = store.getState()
      if (store.dragging) {
        // Mid-drag, only Escape does anything: it snaps the dragged parts back.
        if (e.key === 'Escape') store.cancel()
        return
      }
      // A wire-draw or reconnect drag lives only in Canvas state, so the store would not
      // otherwise know to hold off; store.gestureActive covers that gap.
      const gesture = store.gestureActive
      if (mod && key === 'z') {
        if (gesture) return
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (mod && key === 'y') {
        if (gesture) return
        e.preventDefault()
        store.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (gesture) return
        if (s.selection.parts.length || s.selection.wires.length) {
          e.preventDefault()
          store.commit(deleteSelection(s.diagram, s.selection))
        }
      } else if (key === 'r' && !mod) {
        if (gesture) return
        if (s.selection.parts.length) store.commit(rotateParts(s.diagram, s.selection.parts))
      } else if (e.key === 'Escape') {
        // A wire-draw or reconnect gesture handles its own Escape (Canvas.tsx cancels the drag);
        // clearing the selection here too would fight with that.
        if (gesture) return
        store.select(EMPTY_SELECTION)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}

/** Asks the browser to confirm closing or reloading the tab while there are unsaved changes. */
function useUnloadGuard(store: EditorStore) {
  const dirty = useSyncExternalStore(store.subscribe, () => store.dirty)
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}

export function Editor({ initial, warnings, onClose }: { initial: Diagram; warnings?: string[]; onClose: () => void }) {
  const store = useMemo(() => new EditorStore(initial), [initial])
  const canvasApi = useRef<{ addAtCenter: (moduleId: string) => void } | null>(null)
  useEditorKeys(store)
  useUnloadGuard(store)
  return (
    <div className="editor">
      <Toolbar store={store} warnings={warnings} onClose={onClose} />
      <LibraryPanel onAdd={(id) => canvasApi.current?.addAtCenter(id)} />
      <Canvas store={store} onReady={(api) => (canvasApi.current = api)} />
      <Inspector store={store} />
    </div>
  )
}
