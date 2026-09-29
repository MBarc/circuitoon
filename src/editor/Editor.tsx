import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { EditorStore } from './store.ts'
import { Canvas, type CanvasApi } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { Toolbar } from './Toolbar.tsx'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { nudgeSelection } from './align.ts'
import { GRID } from './snap.ts'
import { clipText, clipToPaste, copySelection, cutMemo, cutSelection, pasteClip, planPaste, type PasteMemo } from './clipboard.ts'
import './editor.css'

/** Arrow keys as a one-grid-step move. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** Keys that belong to a text field, where the editor's shortcuts never apply. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

// The last copied clip, per tab: the fallback when the paste cannot read the system clipboard at
// all. Module state, so it survives opening another sheet.
let memoryClip: string | null = null
// The last paste, so a repeat of the same clip at the same spot steps one grid step further.
let lastPaste: PasteMemo = null

/**
 * Copy, cut and paste of parts, wires, frames and notes through the browser's own clipboard events
 * (Ctrl or Cmd with C, X, V): they reach the system clipboard without a permission prompt. Never in
 * a text field or the Inspector, and never over a text selection, so ordinary text copy and paste
 * keep working there.
 */
function useEditorClipboard(store: EditorStore, canvas: { current: CanvasApi | null }) {
  useEffect(() => {
    // By focus, not the event target: a clipboard event targets the selection's node, and a stray
    // caret left in the Inspector's text must not turn the sheet's shortcuts off.
    const mine = () => {
      const t = document.activeElement
      if (t instanceof Element && (t.closest(TEXT_FIELD) || t.closest('.inspector'))) return false
      if (store.dragging || store.gestureActive) return false
      return true
    }
    const textSelected = () => {
      const sel = window.getSelection()
      return !!sel && !sel.isCollapsed && sel.toString() !== ''
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!mine() || textSelected()) return
      const s = store.getState()
      // A cut takes out what it copied: a selected board goes with its mounted parts.
      const cut = e.type === 'cut' ? cutSelection(s.diagram, s.selection) : null
      const clip = cut?.clip ?? copySelection(s.diagram, s.selection)
      if (!clip) return
      e.preventDefault()
      const text = clipText(clip)
      memoryClip = text
      e.clipboardData?.setData('text/plain', text)
      if (cut) {
        store.commit(cut.diagram)
        // The first paste after a cut puts the items back where they were.
        lastPaste = cutMemo(text)
      } else lastPaste = null
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!mine()) return
      // No clipboardData means the clipboard cannot be read here; then the remembered clip stands in.
      const found = clipToPaste(e.clipboardData ? e.clipboardData.getData('text/plain') : null, memoryClip)
      if (!found) return
      const { clip, text } = found
      e.preventDefault()
      const plan = planPaste(clip, text, lastPaste, canvas.current?.pointer() ?? null)
      lastPaste = plan.memo
      const [dx, dy] = plan.delta
      const { diagram, selection } = pasteClip(store.getState().diagram, clip, dx, dy)
      store.commit(diagram)
      store.select(selection)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [store, canvas])
}

function useEditorKeys(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest(TEXT_FIELD)) return
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
        if (s.selection.parts.length || s.selection.wires.length || s.selection.annotations?.length) {
          e.preventDefault()
          store.commit(deleteSelection(s.diagram, s.selection))
        }
      } else if (Object.hasOwn(ARROWS, e.key) && !mod && !e.altKey) {
        // A nudge: one grid step, five with Shift. A run of nudges to the same selection is one undo step.
        // Only from the sheet (focus on the canvas or nowhere): in the Inspector or the Parts list
        // arrows scroll and move between controls. Never while the canvas pans.
        if (gesture || store.panning) return
        const focus = document.activeElement
        if (focus && focus !== document.body && !focus.closest('.canvas-wrap')) return
        const sel = s.selection
        if (!sel.parts.length && !sel.annotations?.length) return
        e.preventDefault()
        const step = GRID * (e.shiftKey ? 5 : 1)
        const [ux, uy] = ARROWS[e.key]
        store.commit(nudgeSelection(s.diagram, sel, ux * step, uy * step), `nudge:${JSON.stringify([sel.parts, sel.annotations ?? []])}`)
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

export function Editor({ initial, warnings, onClose, onDirty }: { initial: Diagram; warnings?: string[]; onClose: () => void; onDirty?: (dirty: boolean) => void }) {
  const store = useMemo(() => new EditorStore(initial), [initial])
  const canvasApi = useRef<CanvasApi | null>(null)
  useEditorKeys(store)
  useEditorClipboard(store, canvasApi)
  useUnloadGuard(store)
  // Tells the owner whether there are unsaved changes (EditorApp asks before a link replaces them).
  const dirty = useSyncExternalStore(store.subscribe, () => store.dirty)
  // A block body: an expression body would return onDirty's result, which React would later call as
  // the effect's cleanup ("is not a function") once an edit made the sheet dirty.
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  return (
    <div className="editor">
      <Toolbar store={store} warnings={warnings} onClose={onClose} />
      <LibraryPanel onAdd={(id) => canvasApi.current?.addAtCenter(id)} />
      <Canvas store={store} onReady={(api) => (canvasApi.current = api)} />
      <Inspector store={store} />
    </div>
  )
}
