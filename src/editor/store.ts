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
import type { SimOutcome } from '../sim/results.ts'
import type { Circuit } from '../sim/model.ts'
import type { RunPins } from '../format/simState.ts'
import type { RunFinding, ServoView } from '../run/core.ts'
import type { RunStatus } from '../run/protocol.ts'

/** The colour new wires start with until the user picks one. */
export const NEW_WIRE_COLOR = 'blue'

/** What the simulation shows now (spec 6.1); live state, never saved and never undo history. */
export type SimView =
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'solving' }
  | { phase: 'done'; outcome: SimOutcome; circuit: Circuit | null; runSeq?: Record<string, number> }

/** One Serial line (firmware spec 5.3): output, an error, a note from the simulator, or the echo of a typed line. */
export interface SerialLine { text: string; stream: 'out' | 'err' | 'note' | 'echo' }
/** Serial keeps this many lines (spec 5.3). */
export const SERIAL_MAX = 5000
/** One board's run in the editor (spec 2.1, 6.1). `source` is what it started with, so the dock can say "Code changed". */
export interface BoardRunView {
  status: RunStatus | 'idle'
  source: string
  file: string
  serial: SerialLine[]
  /** Lines ever appended this session (monotonic; survives the trim to SERIAL_MAX and Clear). */
  serialSeq?: number
  /** input() is waiting, with this prompt. */
  prompt: string | null
  /** The first Run's download. */
  progress: { loaded: number; total: number } | null
  /** Why Run did not start, or why the board stopped ("U1 has no power: connect 5V and GND"). */
  message: string | null
}
/** Live run state (spec 2.3): transient like `held`; never saved, never undo history. */
export interface RunView {
  boards: Record<string, BoardRunView>
  pins: RunPins
  seq: Record<string, number>
  moving: string[]
  servos: Record<string, ServoView>
  findings: RunFinding[]
}
export const EMPTY_RUN: RunView = { boards: {}, pins: {}, seq: {}, moving: [], servos: {}, findings: [] }
/** The code dock (spec 6.1): open or collapsed, the tab shown, and its height (remembered per browser). */
export interface DockState { open: boolean; tab: string | null; height: number }
export const DOCK_HEIGHT_KEY = 'circuitoon.dockHeight'
/** Below this the editor and the serial log are squeezed out; a saved height under it is discarded. */
export const DOCK_MIN_HEIGHT = 200
const DOCK_HEIGHT = 260
function loadDockHeight(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(DOCK_HEIGHT_KEY))
    return v >= DOCK_MIN_HEIGHT ? v : DOCK_HEIGHT
  } catch {
    return DOCK_HEIGHT
  }
}

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
  /** Simulate is on (spec 6.1). Not saved. */
  simulate: boolean
  /** The Probe tool (spec 6.2) or ordinary editing. */
  simTool: 'select' | 'probe'
  sim: SimView | null
  /** A momentary button held down while simulating (spec 4.0, 6.3): closed only while held, never saved. */
  held: { part: string; group: string } | null
  /** Code running on boards (firmware spec 2.3). Not saved. */
  run: RunView
  dock: DockState
  /** The sheet came from a link with code on it, and its first Run has not been confirmed (spec 2.6). */
  linkCode: boolean
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

  constructor(diagram: Diagram, opts: { linkCode?: boolean } = {}) {
    const ends = loadNewWireEnds()
    // New wires start blue: a signal colour (red and black mean power and ground), so a plain signal
    // wire never raises wire-color-signal. Ground and supply wires still take black and red by role.
    const wireStyle: WireStyle = ends ? { color: NEW_WIRE_COLOR, gauge: 22, ends } : { color: NEW_WIRE_COLOR, gauge: 22 }
    this.state = { diagram, selection: EMPTY_SELECTION, wireStyle, highlight: null, reveal: 0, snapObjects: loadSnapObjects(), simulate: false, simTool: 'select', sim: null, held: null, run: EMPTY_RUN, dock: { open: true, tab: null, height: loadDockHeight() }, linkCode: !!opts.linkCode }
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

  setSimulate(on: boolean) {
    if (on === this.state.simulate) return
    this.set(on ? { simulate: true } : { simulate: false, simTool: 'select', sim: null, held: null })
  }
  setSimTool(simTool: 'select' | 'probe') {
    if (simTool !== this.state.simTool) this.set({ simTool })
  }
  setSim(sim: SimView | null) {
    this.set({ sim })
  }
  setHeld(held: { part: string; group: string } | null) {
    const h = this.state.held
    if (h === held || (h && held && h.part === held.part && h.group === held.group)) return
    this.set({ held })
  }

  setRun(patch: Partial<RunView>) {
    this.set({ run: { ...this.state.run, ...patch } })
  }
  /** Sets (or with null, forgets) one board's run view. */
  setBoardRun(uid: string, patch: Partial<BoardRunView> | null) {
    const boards = { ...this.state.run.boards }
    if (patch === null) delete boards[uid]
    else boards[uid] = { ...(boards[uid] ?? { status: 'idle', source: '', file: 'main.py', serial: [], prompt: null, progress: null, message: null }), ...patch }
    this.setRun({ boards })
  }
  /** Adds Serial lines, keeping the last SERIAL_MAX (spec 5.3). */
  appendSerial(uid: string, lines: SerialLine[]) {
    const b = this.state.run.boards[uid]
    if (!b || !lines.length) return
    const serial = [...b.serial, ...lines]
    this.setBoardRun(uid, { serial: serial.length > SERIAL_MAX ? serial.slice(serial.length - SERIAL_MAX) : serial, serialSeq: (b.serialSeq ?? b.serial.length) + lines.length })
  }
  setDock(patch: Partial<DockState>) {
    const dock = { ...this.state.dock, ...patch }
    if (patch.height !== undefined)
      try {
        globalThis.localStorage?.setItem(DOCK_HEIGHT_KEY, String(Math.round(dock.height)))
      } catch {
        // storage refused: the height is kept for this page only
      }
    this.set({ dock })
  }
  confirmLinkCode() {
    if (this.state.linkCode) this.set({ linkCode: false })
  }
  /** Boards starting or running. */
  get activeRuns(): string[] {
    return Object.entries(this.state.run.boards).filter(([, b]) => b.status === 'starting' || b.status === 'running').map(([uid]) => uid)
  }

  /** Replaces the whole document (import, new sheet) and clears history. */
  load(diagram: Diagram) {
    this.end()
    this.coalesce = null
    this.past = []
    this.future = []
    this.unsaved = false
    this.set({ diagram, selection: EMPTY_SELECTION, highlight: null, held: null, run: EMPTY_RUN, dock: { ...this.state.dock, tab: null }, linkCode: false })
  }
}

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
