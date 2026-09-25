// Editor state with undo history. Commits push the previous diagram onto the undo stack.
// A drag uses begin/preview/end so the whole gesture is a single undo step.
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
    if (next === this.state.diagram) return
    this.pushPast(this.state.diagram)
    this.set({ diagram: next, selection: this.prune(next, this.state.selection) })
  }

  /** Starts a gesture; returns the diagram to derive previews from. */
  begin(): Diagram {
    this.txBase = this.state.diagram
    return this.txBase
  }

  preview(next: Diagram) {
    this.set({ diagram: next })
  }

  end() {
    const base = this.txBase
    this.txBase = null
    if (base && base !== this.state.diagram) {
      this.pushPast(base)
      this.set({})
    }
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.state.diagram)
    this.set({ diagram: prev, selection: this.prune(prev, this.state.selection) })
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state.diagram)
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
    this.past = []
    this.future = []
    this.txBase = null
    this.set({ diagram, selection: EMPTY_SELECTION })
  }
}

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
