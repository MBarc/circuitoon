// Editor state with undo history. Commits push the previous diagram onto the undo stack.
// A drag uses begin/preview/end so the whole gesture is a single undo step. Any other edit
// (commit, undo, redo, load) made while a drag is open closes the drag first, so the history
// never mixes a half-finished gesture with another change.
import { useSyncExternalStore } from 'react'
import type { Diagram, Endpoint } from '../format/diagram.ts'
import type { Severity } from '../format/checks.ts'
import { EMPTY_SELECTION, type Selection, type WireStyle } from './ops.ts'
import { loadNewWireEnds, saveNewWireEnds, usbEnds } from './cableDefault.ts'
import { loadSnapObjects, saveSnapObjects } from './snapPref.ts'

/** The colour new wires start with until the user picks one. */
export const NEW_WIRE_COLOR = 'blue'

export interface EditorState {
  diagram: Diagram
  selection: Selection
  /** Color, gauge and cable for the next wire drawn; follows the last values picked. The cable is
   * also remembered per browser. */
  wireStyle: WireStyle
  /** What a hovered or focused problem row lights on the canvas; not undo history. */
  highlight: Highlight | null
  /** Counts requests to pan the canvas to the selection (a problem's Select). */
  reveal: number
  /** Whether a drag snaps to other objects' edges, wired pins and equal gaps (the grid always applies). Remembered per browser. */
  snapObjects: boolean
}

export interface Highlight {
  /** The finding it lights, so the light can follow it or go out with it. */
  id?: string
  severity: Severity
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

const HISTORY_LIMIT = 200
/** Commits with the same coalesce key (arrow-key nudges) this close together fold into one undo step. */
const COALESCE_MS = 1000

export class EditorStore {
  private state: EditorState
  private past: Diagram[] = []
  private future: Diagram[] = []
  private txBase: Diagram | null = null
  private unsaved = false
  private gesture = false
  /** The last commit's coalesce key and time; any other history change clears it. */
  private coalesce: { key: string; at: number } | null = null
  private listeners = new Set<() => void>()

  constructor(diagram: Diagram) {
    const ends = loadNewWireEnds()
    // New wires start blue: a signal colour (red and black mean power and ground), so a plain signal
    // wire never raises wire-color-signal. Ground and supply wires still take black and red by role.
    const wireStyle: WireStyle = ends ? { color: NEW_WIRE_COLOR, gauge: 22, ends } : { color: NEW_WIRE_COLOR, gauge: 22 }
    this.state = { diagram, selection: EMPTY_SELECTION, wireStyle, highlight: null, reveal: 0, snapObjects: loadSnapObjects() }
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

  /**
   * True while the canvas pans (a middle-button, Space or touch drag) or Space is held ready to
   * pan. Not state anyone renders, so setting it notifies nobody; the arrow-key nudge reads it.
   */
  panning = false

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
    const notes = new Set((d.annotations ?? []).map((a) => a.uid))
    const kept = { parts: sel.parts.filter((u) => parts.has(u)), wires: sel.wires.filter((u) => wires.has(u)) }
    const annotations = sel.annotations?.filter((u) => notes.has(u)) ?? []
    return annotations.length ? { ...kept, annotations } : kept
  }

  private pushPast(d: Diagram) {
    this.coalesce = null
    this.past.push(d)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  /**
   * Makes an edit one undo step. With `coalesceKey`, an edit that follows a commit with the same key
   * within COALESCE_MS joins that commit's step instead (a run of arrow-key nudges undoes at once).
   */
  commit(next: Diagram, coalesceKey?: string) {
    this.end()
    if (next === this.state.diagram) return
    const now = Date.now()
    const joins = coalesceKey !== undefined && this.coalesce?.key === coalesceKey && now - this.coalesce.at <= COALESCE_MS && this.past.length > 0
    if (!joins) this.pushPast(this.state.diagram)
    this.coalesce = coalesceKey === undefined ? null : { key: coalesceKey, at: now }
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
    this.coalesce = null
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.state.diagram)
    this.unsaved = true
    this.set({ diagram: prev, selection: this.prune(prev, this.state.selection), highlight: null })
  }

  redo() {
    this.end()
    this.coalesce = null
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state.diagram)
    this.unsaved = true
    this.set({ diagram: next, selection: this.prune(next, this.state.selection), highlight: null })
  }

  select(selection: Selection) {
    this.set({ selection })
  }

  setWireStyle(wireStyle: WireStyle) {
    // A USB cable picked for a USB link is never the next plain wire's cable: new USB links get
    // theirs from their ports (ops.addWire), and a GPIO wire with USB plugs would be nonsense.
    if (usbEnds(wireStyle.ends)) wireStyle = { ...wireStyle, ends: this.state.wireStyle.ends }
    const was = this.state.wireStyle.ends
    if (was?.from !== wireStyle.ends?.from || was?.to !== wireStyle.ends?.to) saveNewWireEnds(wireStyle.ends)
    this.set({ wireStyle })
  }

  setHighlight(highlight: Highlight | null) {
    if (highlight !== this.state.highlight) this.set({ highlight })
  }

  /** Asks the canvas to bring the current selection into view. */
  reveal() {
    this.set({ reveal: this.state.reveal + 1 })
  }

  /** Turns snapping to objects on or off for drags, and remembers the choice in this browser. */
  setSnapObjects(on: boolean) {
    if (on === this.state.snapObjects) return
    saveSnapObjects(on)
    this.set({ snapObjects: on })
  }

  /** Replaces the whole document (import, new sheet) and clears history. */
  load(diagram: Diagram) {
    this.end()
    this.coalesce = null
    this.past = []
    this.future = []
    this.unsaved = false
    this.set({ diagram, selection: EMPTY_SELECTION, highlight: null })
  }
}

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
