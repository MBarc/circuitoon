// Editor state with undo history. Commits push the previous diagram onto the undo stack.
// A drag uses begin/preview/end so the whole gesture is a single undo step. Any other edit
// (commit, undo, redo, load) made while a drag is open closes the drag first, so the history
// never mixes a half-finished gesture with another change.
import { useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { EMPTY_SELECTION, type Selection, type WireStyle } from './ops.ts'

export interface EditorState {
  diagram: Diagram
  selection: Selection
  /** Color and gauge for the next wire drawn; follows the last values picked. */
  wireStyle: WireStyle
}

const HISTORY_LIMIT = 200

export class EditorStore {
  private state: EditorState
  private past: Diagram[] = []
  private future: Diagram[] = []
  private txBase: Diagram | null = null
  private unsaved = false
  private gesture = false
  private listeners = new Set<() => void>()

  constructor(diagram: Diagram) {
    this.state = { diagram, selection: EMPTY_SELECTION, wireStyle: { color: 'black', gauge: 22 } }
  }

  getState = (): EditorState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  /** True between begin() and end() or cancel(). */
  get dragging() {
    return this.txBase !== null
  }
  /** True when the document changed since it was loaded or last saved. */
  get dirty() {
    return this.unsaved
  }
  /** True while a canvas-only gesture (wire draw, reconnect drag) is in progress. Not undo history. */
  get gestureActive() {
    return this.gesture
  }

  /** Marks whether such a gesture is active, so keyboard shortcuts can stay quiet during it. */
  setGesture(active: boolean) {
    if (this.gesture === active) return
    this.gesture = active
    this.set({})
  }

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private prune(d: Diagram, sel: Selection): Selection {
    const parts = new Set(d.parts.map((p) => p.uid))
    const wires = new Set(d.connections.map((c) => c.uid))
    return { parts: sel.parts.filter((u) => parts.has(u)), wires: sel.wires.filter((u) => wires.has(u)) }
  }

  private pushPast(d: Diagram) {
    this.past.push(d)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  commit(next: Diagram) {
    this.end()
    if (next === this.state.diagram) return
    this.pushPast(this.state.diagram)
    this.unsaved = true
    this.set({ diagram: next, selection: this.prune(next, this.state.selection) })
  }

  /** Starts a gesture; returns the diagram to derive previews from. */
  begin(): Diagram {
    if (this.txBase) return this.txBase
    this.txBase = this.state.diagram
    return this.txBase
  }

  /** Shows an in-progress gesture. Ignored when no gesture is open (it was closed or cancelled). */
  preview(next: Diagram) {
    if (!this.txBase) return
    this.set({ diagram: next })
  }

  end() {
    const base = this.txBase
    this.txBase = null
    if (base && base !== this.state.diagram) {
      this.pushPast(base)
      this.unsaved = true
      this.set({})
    }
  }

  /** Abandons the open gesture: restores the diagram it started from, with no history entry. */
  cancel() {
    const base = this.txBase
    if (!base) return
    this.txBase = null
    this.set({ diagram: base, selection: this.prune(base, this.state.selection) })
  }

  markSaved() {
    if (!this.unsaved) return
    this.unsaved = false
    this.set({})
  }

  undo() {
    this.end()
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.state.diagram)
    this.unsaved = true
    this.set({ diagram: prev, selection: this.prune(prev, this.state.selection) })
  }

  redo() {
    this.end()
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state.diagram)
    this.unsaved = true
    this.set({ diagram: next, selection: this.prune(next, this.state.selection) })
  }

  select(selection: Selection) {
    this.set({ selection })
  }

  setWireStyle(wireStyle: WireStyle) {
    this.set({ wireStyle })
  }

  /** Replaces the whole document (import, new sheet) and clears history. */
  load(diagram: Diagram) {
    this.end()
    this.past = []
    this.future = []
    this.unsaved = false
    this.set({ diagram, selection: EMPTY_SELECTION })
  }
}

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
