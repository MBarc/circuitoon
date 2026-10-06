// The editing surface: an SVG sheet. Dragging the paper draws a selection rectangle (Shift adds to
// the selection); a middle-button drag, Space+drag or a finger on the paper pans, and the wheel zooms.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { brokenStub, computeRoutes, labelAnchor, moduleOf, pinTargets, resolveEndpoint, routingKey, wireColor, wirePaths, wireStripe, wireWidth, type PartInstance, type PinTarget, type Routes } from '../format/diagram.ts'
import { coveredHoles, holeEndAt, holeKey, plugsOf, splitBoards, takenHoles } from '../format/breadboard.ts'
import type { Pt } from '../format/geometry.ts'
import { Part, INK } from '../render/Part.tsx'
import { LegDots, TakenHoles } from '../render/Boards.tsx'
import { WireLabel } from '../render/WireLabel.tsx'
import { CableLayer } from '../render/CableEnd.tsx'
import { FrameMark, NoteMark } from '../render/Annotations.tsx'
import { BLOCKED_STROKE, Bolts, HazardOutline, PluggedLink, Stripe, boltInsets } from '../render/Mains.tsx'
import { isPluggedIn } from '../format/usb.ts'
import { type LabelLook, type WireLook, drawnColor, holdLabelLooks, holdLooks, newWireColor, startColor } from '../format/mainsLook.ts'
import { flagRect, labelName, labelsOf } from '../format/netLabels.ts'
import { cellGate } from './hoverCell.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { addWire, cycleGpio, EMPTY_SELECTION, flipContact, momentaryGroup, marqueeSelection, moveAnnotations, moveParts, reconnectWire, sameEndpoint, setWireRoute, settleDrop, settleMounts, settleSeats, settlingOf, updateWire, withMounted } from './ops.ts'
import { netlist, netPoints } from '../format/netlist.ts'
import { bendHandleAt, insertBend, isOrthogonal, moveSegment, removeBend, segmentHandleAt, segmentsOf, toRoute, type Axis } from '../format/wireEdit.ts'
import { lookupModule, placeOnSheet, placementModule } from './myParts.ts'
import { bodyRect } from '../format/geometry.ts'
import { isNetLabel, layoutModule, type ModuleDef } from '../format/module.ts'
import { MODULE_MIME } from './LibraryPanel.tsx'
import type { Connection, Diagram, Endpoint } from '../format/diagram.ts'
import type { Selection } from './ops.ts'
import { partCaption } from '../format/values.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { SimLayer, currentFindings, shownResult } from './SimLayer.tsx'
import { ProbeLayer } from './ProbeLayer.tsx'
import { addProbe } from '../sim/probes.ts'
import { gridOnly, snapMove, type SnapResult } from './snap.ts'
import { dragSnap, overlaps, type DragSnap } from './dragSnap.ts'
import { GuideLayer } from './GuideLayer.tsx'

export type View = { x: number; y: number; scale: number }
const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID
const NO_HOLES: ReadonlySet<string> = new Set()

type Drag = { pointer: number } & (
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; moving: string[]; settling: string[]; base: Diagram }
  | { kind: 'wire'; from: Endpoint; origin: Pt; cursor: Pt; over: Endpoint | null; refused?: Pt | null }
  | { kind: 'reconnect'; uid: string; end: 'from' | 'to'; origin: Pt; cursor: Pt; over: Endpoint | null; refused?: Pt | null }
  | { kind: 'segment'; uid: string; index: number; axis: Axis; start: Pt; points: Pt[]; base: Diagram }
  | { kind: 'annotations'; start: Pt; uids: string[]; base: Diagram }
  // `before` is the selection to restore on Escape; `moved` turns true past MARQUEE_MIN screen px.
  | { kind: 'marquee'; client: Pt; start: Pt; cursor: Pt; add: boolean; before: Selection; moved: boolean }
)

/** A press on the paper that moves less than this (screen px) is a click, not a selection rectangle. */
const MARQUEE_MIN = 3
const rectOf = (a: Pt, b: Pt) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })
/** Whether a key event belongs to a text field, where Space types a space. */
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')

/** Segments shorter than this get no handle: there is no room to grab one. A 20 px pin run gets one. */
const MIN_HANDLE_SEGMENT = 20

const samePoints = (a: Pt[], b: Pt[]) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)

/** Length in px of the red stub drawn at a broken connection's resolvable end. */
const BROKEN_STUB = 20
/** The red stub drawn at a broken connection's one resolvable end, or null when neither end resolves. */
function stubOf(d: Diagram, c: Connection): { d: string; ends: Pt[] } | null {
  const at = brokenStub(d, c)
  if (!at) return null
  const dir = at.dir ?? { x: 0, y: -1 }
  const tip = { x: at.end.x + dir.x * BROKEN_STUB, y: at.end.y + dir.y * BROKEN_STUB }
  return { d: `M${at.end.x} ${at.end.y}L${tip.x} ${tip.y}`, ends: [at.end, tip] }
}

/** The whole wire as a plain polyline, out to both endpoints: the drawn path of a cable stops
 * inside its connectors, so the selection and problem glows and the hit corridor use this to take
 * them in too. */
const polyline = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')

/** Path data for a filled circle at `p` with radius `r`, as two arcs: draws a whole net's worth of
 * highlight dots as one `<path>` instead of one `<circle>` element per point (Ruling 19). */
const circlePath = (p: Pt, r: number) => `M${p.x - r} ${p.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

/**
 * One part's pin hit-targets (the invisible circles wires attach to), at the stub tips or, for a
 * plugged leg, on the leg's own hole (`pinTargets`). Memoized so dragging a wire across the
 * sheet, which changes `hoveredPin` every pointer move, only re-renders the one part whose pin is
 * actually being hovered instead of rebuilding this layer for every part on the sheet each frame.
 * The targets are a new array each render, so they are compared by position.
 */
const PinTargets = memo(
  function PinTargets({ part, targets, hoveredPin }: { part: PartInstance; targets: PinTarget[]; hoveredPin: string | null }) {
    return (
      <>
        {targets.map((t) => (
          <circle
            key={t.name}
            className={hoveredPin === t.name ? 'pin-hit target' : 'pin-hit'}
            data-pin={t.name}
            data-pin-part={part.uid}
            cx={t.at.x}
            cy={t.at.y}
            r={6}
          >
            <title>{`${part.designator} ${t.label ?? t.name}`}</title>
          </circle>
        ))}
      </>
    )
  },
  (a, b) =>
    a.part === b.part &&
    a.hoveredPin === b.hoveredPin &&
    a.targets.length === b.targets.length &&
    a.targets.every((t, i) => t.name === b.targets[i].name && t.label === b.targets[i].label && t.at.x === b.targets[i].at.x && t.at.y === b.targets[i].at.y),
)

export interface CanvasApi {
  addAtCenter: (moduleId: string) => void
  /** Places a module (a custom part just saved) in the middle of the view. */
  addModuleAtCenter: (m: ModuleDef) => void
  /** Where the pointer is on the sheet (world px), or null when it is not over the sheet. */
  pointer: () => Pt | null
}

export function Canvas({ store, onReady }: { store: EditorStore; onReady?: (api: CanvasApi) => void }) {
  const { diagram, selection, highlight, reveal, snapObjects, simulate, simTool, sim } = useEditorState(store)
  // While simulating: the readings to draw (the last good ones, stale, after a failed solve) and the current findings.
  const simOutcome = simulate && sim?.phase === 'done' ? sim.outcome : undefined
  const simShown = shownResult(simOutcome)
  // A failed outcome's findings are a new array per call; memoised so SimLayer's memo holds.
  const simFindings = useMemo(() => currentFindings(simOutcome), [simOutcome])
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: -20, y: -40, scale: 1.5 })
  const [drag, setDrag] = useState<Drag | null>(null)
  // Space held (outside a text field): a left drag pans, for trackpads with no middle button.
  const [spaceDown, setSpaceDown] = useState(false)
  // The store hears about any pan (and Space held ready to pan), so arrow keys never nudge then.
  const panActive = spaceDown || drag?.kind === 'pan'
  useEffect(() => {
    store.panning = panActive
    return () => {
      store.panning = false
    }
  }, [store, panActive])
  // The last pointer position over the sheet (client px), for pasting under the pointer.
  const lastClient = useRef<Pt | null>(null)
  // A momentary button this press holds while simulating (spec 4.0): released on pointer up or cancel.
  const heldRef = useRef(false)
  // The pin or hole under the pointer while nothing is being dragged, for net highlighting.
  const [hover, setHover] = useState<Endpoint | null>(null)
  // The net label under the pointer (its body or its pin), for lighting every label of its name.
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)
  const hoverCells = useRef(cellGate())
  const settled = useRef<Routes>(new Map())
  const [editing, setEditing] = useState<{ uid: string; anchor: Pt; initial: string; token: number } | null>(null)
  const editRef = useRef<HTMLInputElement>(null)
  // Only ever increases, so every label-editor session gets a token no earlier session can match.
  const tokenSeqRef = useRef(0)
  // The token of the currently open session, or null when none is open (cleared on commit or
  // cancel). Enter commits without blurring the input, so a blur can still land afterward (or,
  // worse, after a later session has already opened on another wire and taken over editRef);
  // commit/cancel only act when the token they were called with still matches this, so a stale
  // call from an already-closed session is a no-op instead of a wrong-wire re-commit.
  const activeTokenRef = useRef<number | null>(null)
  // Smart guides: the open drag's snap targets, the guides to draw for its last move, and that
  // move (pointer and whether Ctrl or Cmd was held), so pressing or releasing the key mid-drag
  // re-snaps without waiting for the pointer to move.
  const dragSnapRef = useRef<DragSnap | null>(null)
  const [guides, setGuides] = useState<SnapResult | null>(null)
  const lastMove = useRef<{ client: Pt; off: boolean } | null>(null)
  // The last seat check (settleSeats), by the parts array it ran on: a part drag checks the
  // grid position before snapping, and the drag highlight then reuses the same answer.
  const seatCache = useRef<{ parts: PartInstance[]; uids: string[]; result: ReturnType<typeof settleSeats> } | null>(null)
  const seatsOf = (d: Diagram, uids: string[]) => {
    const c = seatCache.current
    if (c && c.parts === d.parts && c.uids === uids) return c.result
    const result = settleSeats(d, uids)
    seatCache.current = { parts: d.parts, uids, result }
    return result
  }

  useEffect(() => {
    const el = svgRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    // Wheel must be non-passive so the page does not scroll while zooming.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0015)))
        const wx = v.x + (e.clientX - r.left) / v.scale
        const wy = v.y + (e.clientY - r.top) / v.scale
        return { scale, x: wx - (e.clientX - r.left) / scale, y: wy - (e.clientY - r.top) / scale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: view.x + (e.clientX - r.left) / view.scale, y: view.y + (e.clientY - r.top) / view.scale }
  }

  function placeModule(moduleId: string | ModuleDef, at: Pt) {
    // The sheet's own copy when it has one (placing never changes the parts already there), else the
    // library, then My parts.
    const d = store.getState().diagram
    const found = typeof moduleId === 'string' ? (moduleOf(d, moduleId) ?? lookupModule(moduleId)) : moduleId
    if (!found) return
    const m = placementModule(d, found)
    const lay = layoutModule(m)
    const { diagram: next, uid } = placeOnSheet(d, m, snap(at.x - lay.w / 2), snap(at.y - lay.h / 2))
    // Dropped with every leg on free holes of a board, the new part plugs in: one undo step.
    store.commit(settleMounts(next, [uid]))
    store.select({ parts: [uid], wires: [] })
  }

  useEffect(() => {
    onReady?.({
      addAtCenter: (id) => placeModule(id, { x: view.x + size.w / view.scale / 2, y: view.y + size.h / view.scale / 2 }),
      addModuleAtCenter: (m) => placeModule(m, { x: view.x + size.w / view.scale / 2, y: view.y + size.h / view.scale / 2 }),
      pointer: () => (lastClient.current ? toWorld({ clientX: lastClient.current.x, clientY: lastClient.current.y }) : null),
    })
  })

  useEffect(() => {
    // Only on the page or the sheet: Space on a focused button presses it, in a field it types.
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return
      const t = e.target
      if (t !== document.body && !(t instanceof Element && t.closest('.canvas-wrap'))) return
      e.preventDefault()
      setSpaceDown(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    const onBlur = () => setSpaceDown(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Parts that move this drag: the selection plus whatever is mounted on a dragged board.
  const draggingParts = drag?.kind === 'parts' ? drag.moving : null
  const reshaping = drag?.kind === 'segment' ? drag.uid : null
  // While frames and notes are dragged the wires keep their settled routes (a moving frame label
  // would otherwise re-route the whole sheet every frame); the drop routes them around it.
  const movingNotes = drag?.kind === 'annotations'
  // Routes depend only on parts, modules, annotations (wires keep off frame labels, A18.3) and each
  // wire's ends and fixed route, so title, color and wire label edits skip re-routing.
  const endpointsKey = useMemo(() => routingKey(diagram.connections), [diagram.connections])
  const routes = useMemo(() => {
    if (draggingParts) {
      const moving = new Set(draggingParts)
      const only = new Set(diagram.connections.filter((c) => moving.has(c.from.part) || moving.has(c.to.part)).map((c) => c.uid))
      // Lanes are skipped while dragging (much cheaper per frame); the full route on drop applies them.
      return computeRoutes(diagram, { only, prev: settled.current, occupancy: false })
    }
    // Reshaping one wire changes only that wire's route; everything else keeps its settled route
    // until the drag ends and the full route (with lanes) runs again.
    if (reshaping) return computeRoutes(diagram, { only: new Set([reshaping]), prev: settled.current, occupancy: false })
    if (movingNotes) return settled.current
    const all = computeRoutes(diagram)
    settled.current = all
    return all
  }, [diagram.parts, diagram.modules, diagram.annotations, endpointsKey, draggingParts, reshaping, movingNotes])
  // Path data only changes with the routes or the wires themselves, not with pan, zoom or selection.
  const wires = useMemo(() => wirePaths(diagram, routes), [routes, diagram.connections])
  // The wire looks (mains identity colours, hazard marks, and the role colour of a low-voltage wire
  // with no stored colour): once per edit, held while a part or segment drag is open, like the
  // checker (the analysis needs every position). It reads the cached analyses, so an edit the checker
  // has already analysed costs no second enumeration.
  const busy = drag?.kind === 'parts' || drag?.kind === 'segment'
  const looksRef = useRef<Map<string, WireLook>>(new Map())
  const looks = useMemo(() => holdLooks(looksRef, diagram, busy), [diagram.parts, diagram.connections, diagram.modules, busy])
  // Net label colours (their nets' roles), held the same way.
  const flagsRef = useRef<Map<string, LabelLook>>(new Map())
  const flags = useMemo(() => holdLabelLooks(flagsRef, diagram, busy), [diagram.parts, diagram.connections, diagram.modules, busy])
  // Every label sharing a name with a selected or hovered label: each gets a glow, so a reader sees where the net goes.
  const litLabels = useMemo(() => {
    const all = labelsOf(diagram)
    const names = new Set(all.filter((l) => l.name && (selection.parts.includes(l.part.uid) || l.part.uid === hoverLabel)).map((l) => l.name))
    return names.size ? all.filter((l) => names.has(l.name)).map((l) => l.part.uid) : []
  }, [diagram.parts, diagram.modules, selection.parts, hoverLabel])
  // Boards draw below every other part; the leg overlays follow mounts and positions.
  const layers = useMemo(() => splitBoards(diagram), [diagram.parts, diagram.modules])
  // Seated plug-in devices put their captions beside the outlet (and covered lead labels inside).
  const seated = useMemo(() => seatedLabels(diagram), [diagram.parts, diagram.modules])
  // While parts are dragged, the same seat check the drop runs: the dragged parts count as loose
  // (their old legs neither show nor push a part that stays put out of its holes), and each seat
  // is green when the drop would mount it, red when only some legs land.
  const settling = useMemo(
    () => (drag?.kind === 'parts' ? seatsOf(diagram, drag.settling) : null),
    [diagram.parts, diagram.modules, drag],
  )
  const plugs = useMemo(() => settling?.plugs ?? plugsOf(diagram), [settling, diagram.parts, diagram.modules])
  const seats = useMemo(() => (settling ? [...settling.seats.values()].flatMap((s) => s ?? []) : []), [settling])
  // While a wire is drawn or an end moved, holes under a mounted part's body show as unavailable
  // (the red seat mark): nothing plugs in there, and hovering or dropping on one picks nothing.
  const drawing = drag?.kind === 'wire' || drag?.kind === 'reconnect'
  const covered = useMemo(() => (drawing ? coveredHoles(diagram) : []), [drawing, diagram.parts, diagram.modules])
  // Holes that already hold as many legs and wire ends as they take (one, on a breadboard): a
  // wire end is never dropped there, and the used hole under the pointer shows the same red mark.
  // The end being moved never blocks its own hole.
  const moved = drag?.kind === 'reconnect' ? { wire: drag.uid, end: drag.end } : undefined
  const taken = useMemo(
    () => (drawing ? takenHoles(diagram, moved) : NO_HOLES),
    [drawing, moved?.wire, moved?.end, diagram.parts, diagram.connections, diagram.modules],
  )
  // Rebuilt only when parts, connections or modules actually change, so moving the pointer between
  // hover targets (which changes `hover` every frame) never rebuilds the netlist itself.
  const nl = useMemo(() => netlist(diagram), [diagram.parts, diagram.connections, diagram.modules])
  const net = useMemo(() => (hover && !drag ? netPoints(diagram, hover, nl) : []), [hover, drag, diagram, nl])

  const vw = size.w / view.scale
  const vh = size.h / view.scale

  // A problem's Select asks for its parts and wires to be shown: pan (and zoom out if they do not
  // fit) only when they are not already fully in view.
  useEffect(() => {
    if (!reveal) return
    const d = store.getState().diagram
    const sel = store.getState().selection
    const pts: Pt[] = []
    for (const uid of sel.parts) {
      const p = d.parts.find((q) => q.uid === uid)
      const m = p && moduleOf(d, p.module)
      if (!p || !m) continue
      const r = bodyRect(p, layoutModule(m))
      pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h })
    }
    for (const uid of sel.wires) {
      const w = wires.find((x) => x.conn.uid === uid)
      const c = w ? null : d.connections.find((x) => x.uid === uid)
      pts.push(...(w?.points ?? (c && stubOf(d, c)?.ends) ?? []))
    }
    if (!pts.length) return
    const pad = 40
    const x0 = Math.min(...pts.map((p) => p.x)) - pad
    const y0 = Math.min(...pts.map((p) => p.y)) - pad
    const x1 = Math.max(...pts.map((p) => p.x)) + pad
    const y1 = Math.max(...pts.map((p) => p.y)) + pad
    setView((v) => {
      const w = size.w / v.scale
      const h = size.h / v.scale
      if (x0 >= v.x && y0 >= v.y && x1 <= v.x + w && y1 <= v.y + h) return v
      const scale = Math.max(MIN_SCALE, Math.min(v.scale, size.w / (x1 - x0), size.h / (y1 - y0)))
      return { scale, x: (x0 + x1) / 2 - size.w / scale / 2, y: (y0 + y1) / 2 - size.h / scale / 2 }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  function openLabelEditor(uid: string) {
    const anchor = labelAnchor(wires.find((w) => w.conn.uid === uid)?.points ?? [])
    if (!anchor) return
    const wire = diagram.connections.find((c) => c.uid === uid)
    store.select({ parts: [], wires: [uid] })
    const token = ++tokenSeqRef.current
    activeTokenRef.current = token
    setEditing({ uid, anchor, initial: wire?.label ?? '', token })
  }
  function commitLabelEdit(token: number) {
    if (token !== activeTokenRef.current) return // a stale commit from an already-closed session
    activeTokenRef.current = null
    const cur = editing
    setEditing(null)
    if (!cur) return
    const value = (editRef.current?.value ?? cur.initial).trim()
    const label = value || undefined
    const s = store.getState()
    const wire = s.diagram.connections.find((c) => c.uid === cur.uid)
    if (wire && (wire.label ?? undefined) !== label) store.commit(updateWire(s.diagram, cur.uid, { label }))
  }
  function cancelLabelEdit(token: number) {
    if (token !== activeTokenRef.current) return // a stale cancel from an already-closed session
    activeTokenRef.current = null
    setEditing(null)
  }
  /** Commits a new shape for one wire, from its full polyline, as one undo step. */
  function commitShape(uid: string, points: Pt[]) {
    const s = store.getState()
    // Nothing changed (Alt+click on an existing corner, a refused bend removal): no commit, so an
    // automatic wire stays automatic and no empty undo step is added.
    const current = routes.get(uid)?.points
    if (current && samePoints(current, points)) return
    if (s.diagram.connections.some((c) => c.uid === uid)) store.commit(setWireRoute(s.diagram, uid, toRoute(points)))
  }
  /**
   * The routed polyline of a wire that can be reshaped by hand, or null. Every route is orthogonal
   * (a blocked one is a dashed L the user can reshape clear); this guards against a diagonal anyway.
   */
  function editablePoints(uid: string): Pt[] | null {
    const points = routes.get(uid)?.points
    const drawn = wires.find((w) => w.conn.uid === uid)?.points
    return points && drawn && isOrthogonal(points) && isOrthogonal(drawn) ? points : null
  }
  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (e.altKey) return // Alt+click adds bends; a quick second one must not open the name editor
    // A drag holds pointer capture on the svg itself, so e.target is always the svg; look up
    // what is actually under the cursor, as pinUnder does.
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const bendEl = under?.closest('[data-vertex-index]')
    if (bendEl) {
      const uid = bendEl.getAttribute('data-wire-uid')!
      const points = editablePoints(uid)
      if (points) commitShape(uid, removeBend(points, Number(bendEl.getAttribute('data-vertex-index'))))
      return
    }
    const wireEl = under?.closest('[data-wire]')
    if (wireEl) openLabelEditor(wireEl.getAttribute('data-wire')!)
  }
  // Panning or zooming moves the anchor out from under the editor, so either one closes it (with a commit).
  useEffect(() => {
    if (editing) commitLabelEdit(editing.token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.x, view.y, view.scale])
  useEffect(() => {
    if (editing) {
      editRef.current?.focus()
      editRef.current?.select()
    }
  }, [editing])

  /** Ends a part drag as one undo step: moved parts that are seated mount, the rest unmount. */
  function finishPartsDrag(d: Extract<Drag, { kind: 'parts' }>, click: boolean) {
    // A press without movement changes nothing, mounts included (settleDrop returns `now` then).
    const moved = store.getState().diagram !== d.base
    if (store.dragging) store.preview(settleDrop(d.base, store.getState().diagram, d.settling))
    store.end()
    // Spec 6.3: a click on a switch while simulating flips it and saves the new position.
    if (click && !moved && store.getState().simulate && d.uids.length === 1) {
      const next = flipContact(store.getState().diagram, d.uids[0])
      if (next) store.commit(next)
    }
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Commit a half-typed inspector field (it saves on blur) before the selection changes and unmounts it.
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
    // One gesture at a time: a second finger or button does not start another drag.
    if (drag) return
    // A press starts a gesture (or a selection change); the net lit by hovering goes out, and the
    // next pointer move after the gesture lights whatever is under the pointer then.
    setHover(null)
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as Element
    const pointer = e.pointerId
    e.currentTarget.setPointerCapture(pointer)
    // A middle-button drag, or Space+drag, pans from anywhere on the sheet and keeps the selection.
    if (e.button === 1 || spaceDown) {
      setDrag({ pointer, kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
      return
    }
    // Everything else (wires, part and mark drags, the selection rectangle) is the primary button only.
    if (e.button !== 0) return
    // A simulation badge selects the parts its findings name (spec 6.3).
    const badge = target.closest('[data-sim-badge]')
    if (badge) {
      store.select({ parts: badge.getAttribute('data-sim-badge')!.split(' '), wires: [] })
      store.reveal()
      return
    }
    // The Probe tool (spec 6.2): a pin or hole, the nearer end of a wire, or a part. Anything else does nothing.
    if (store.getState().simTool === 'probe') {
      const d0 = store.getState().diagram
      const end = endUnder(e)
      let at: { part: string; pin?: string } | null = end ? { part: end.part, pin: end.pin } : null
      const wireEl = at ? null : target.closest('[data-wire]')
      const conn = wireEl ? d0.connections.find((c) => c.uid === wireEl.getAttribute('data-wire')) : undefined
      if (conn) {
        const p = toWorld(e)
        const dist = (ep: Endpoint) => {
          const r = resolveEndpoint(d0, ep)
          return r ? Math.hypot(r.end.x - p.x, r.end.y - p.y) : Infinity
        }
        const ep = dist(conn.from) <= dist(conn.to) ? conn.from : conn.to
        at = { part: ep.part, pin: ep.pin }
      }
      const partEl = at ? null : target.closest('[data-part]')
      if (partEl) at = { part: partEl.getAttribute('data-part')! }
      if (at) store.commit(addProbe(d0, at).diagram)
      return
    }
    // Explicit wire-edit handles of the selected wire come first: they sit on top of everything.
    const handleEl = target.closest('[data-wire-end]')
    if (handleEl) {
      const uid = handleEl.getAttribute('data-wire-uid')!
      const end = handleEl.getAttribute('data-wire-end') as 'from' | 'to'
      const w = wires.find((w) => w.conn.uid === uid)
      const origin = w ? w.ends[end === 'from' ? 1 : 0] : toWorld(e)
      setDrag({ pointer, kind: 'reconnect', uid, end, origin, cursor: toWorld(e), over: null })
      store.setGesture(true)
      return
    }
    const segEl = target.closest('[data-seg-index]')
    if (segEl) {
      const uid = segEl.getAttribute('data-wire-uid')!
      const index = Number(segEl.getAttribute('data-seg-index'))
      const points = editablePoints(uid)
      const seg = points && segmentsOf(points).find((sg) => sg.i === index)
      if (seg) {
        setDrag({ pointer, kind: 'segment', uid, index, axis: seg.axis, start: toWorld(e), points, base: store.begin() })
        store.setGesture(true)
      }
      return
    }
    // A single press on a bend does nothing (double-click removes it); it must not fall
    // through to the paper and clear the selection.
    if (target.closest('[data-vertex-index]')) return
    // A press on a pin or a hole starts a wire there, by the same terminal-hit policy hover and
    // drop use, so a hole under an ordinary wire's hit stroke still starts a wire; a press on the
    // wire anywhere else selects it. A pin ends at its stub tip, or at its leg's hole when plugged
    // (Ruling 25). Between holes, a press drags the board as usual.
    // Alt+press on the selected wire adds a bend there (a wire edit), even over a hole.
    const sel0 = store.getState().selection
    const bending = e.altKey && sel0.parts.length === 0 && sel0.wires.length === 1 && target.closest('[data-wire]')?.getAttribute('data-wire') === sel0.wires[0]
    // A full hole starts no wire: its one wire end or leg is already there.
    const end = bending ? null : endUnder(e, takenHoles(store.getState().diagram))
    const at = end && resolveEndpoint(store.getState().diagram, end)
    if (end && at) {
      setDrag({ pointer, kind: 'wire', from: end, origin: at.end, cursor: toWorld(e), over: null })
      store.setGesture(true)
      return
    }
    const wireEl = target.closest('[data-wire]')
    if (wireEl) {
      const uid = wireEl.getAttribute('data-wire')!
      const sel = store.getState().selection
      if (e.altKey && sel.parts.length === 0 && sel.wires.length === 1 && sel.wires[0] === uid) {
        const points = editablePoints(uid)
        if (points) commitShape(uid, insertBend(points, toWorld(e)))
        return
      }
      if (e.shiftKey) store.select({ parts: sel.parts, wires: sel.wires.includes(uid) ? sel.wires.filter((u) => u !== uid) : [...sel.wires, uid] })
      else store.select({ parts: [], wires: [uid] })
      return
    }
    // A frame (by its border or label tab) or a note: select it, and drag it on the grid as one undo step.
    const noteEl = target.closest('[data-annotation]')
    if (noteEl) {
      const uid = noteEl.getAttribute('data-annotation')!
      const sel = store.getState().selection
      let notes = sel.annotations ?? []
      if (e.shiftKey) notes = notes.includes(uid) ? notes.filter((u) => u !== uid) : [...notes, uid]
      else if (!notes.includes(uid)) notes = [uid]
      store.select({ parts: e.shiftKey ? sel.parts : [], wires: e.shiftKey ? sel.wires : [], annotations: notes })
      if (notes.includes(uid)) {
        const base = store.begin()
        dragSnapRef.current = dragSnap(base, [], [], notes)
        setGuides(null)
        lastMove.current = null
        setDrag({ pointer, kind: 'annotations', start: toWorld(e), uids: notes, base })
        store.setGesture(true)
      }
      return
    }
    const partEl = target.closest('[data-part]')
    if (partEl) {
      const uid = partEl.getAttribute('data-part')!
      const sel = store.getState().selection
      let parts = sel.parts
      if (e.shiftKey) parts = parts.includes(uid) ? parts.filter((u) => u !== uid) : [...parts, uid]
      else if (!parts.includes(uid)) parts = [uid]
      store.select({ parts, wires: e.shiftKey ? sel.wires : [] })
      // Spec 4.0: a button is held closed while the pointer is down, never saved.
      if (store.getState().simulate && !e.shiftKey) {
        const group = momentaryGroup(store.getState().diagram, uid)
        if (group) {
          heldRef.current = true
          store.setHeld({ part: uid, group })
        }
      }
      if (parts.includes(uid)) {
        const base = store.begin()
        const moving = withMounted(base, parts)
        const settlingParts = settlingOf(base, parts)
        dragSnapRef.current = dragSnap(base, moving, settlingParts, [])
        setGuides(null)
        lastMove.current = null
        setDrag({ pointer, kind: 'parts', start: toWorld(e), uids: parts, moving, settling: settlingParts, base })
        store.setGesture(true)
      }
      return
    }
    // The paper: a selection rectangle, which replaces the selection (Shift adds to it). A click
    // without a drag clears the selection, or with Shift keeps it. A finger has no middle button or
    // Space, so on touch a drag on the paper pans (and a tap still clears the selection).
    if (e.pointerType === 'touch') {
      store.select(EMPTY_SELECTION)
      setDrag({ pointer, kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
      return
    }
    const w = toWorld(e)
    setDrag({ pointer, kind: 'marquee', client: { x: e.clientX, y: e.clientY }, start: w, cursor: w, add: e.shiftKey, before: store.getState().selection, moved: false })
    store.setGesture(true)
  }
  // With pointer capture the event target is always the svg, so look up what is under the cursor.
  function pinUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]')
    return el ? { part: el.getAttribute('data-pin-part')!, pin: el.getAttribute('data-pin')! } : null
  }
  /**
   * The hole or pad under the pointer on the topmost part there, if that part has hole groups (a
   * board, or any module with interior pads) and a hole is within 3.5 px (`holeEndAt`). Walks the
   * full elementsFromPoint stack, not just the topmost element, so a wire or label drawn over a
   * board does not hide the hole beneath it; a part drawn above the board (which has no holes of
   * its own there) still occludes it, since it is the first part found, and so does a note.
   */
  function holeUnder(e: { clientX: number; clientY: number }, used: ReadonlySet<string> = NO_HOLES): Endpoint | null {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      // A note drawn over a board hides its holes: a press there grabs the note, not a hole.
      if (el.closest('[data-annotation]')) return null
      const partEl = el.closest('[data-part]')
      if (partEl) return holeEndAt(store.getState().diagram, partEl.getAttribute('data-part')!, toWorld(e), used)
    }
    return null
  }
  /**
   * The one terminal-hit policy, shared by hover, pressing and dropping a wire end: a pin first (its
   * target sits on top), else a hole or pad on the topmost part under the pointer, skipping the
   * holes in `used` (full ones, when a wire end is placed).
   */
  function endUnder(e: { clientX: number; clientY: number }, used: ReadonlySet<string> = NO_HOLES): Endpoint | null {
    return pinUnder(e) ?? holeUnder(e, used)
  }
  /** While a wire end is placed: the terminal it would take (never a full hole), and the center of a full hole under the pointer, for the red mark. */
  function dropUnder(e: { clientX: number; clientY: number }): { over: Endpoint | null; refused: Pt | null } {
    const over = endUnder(e, taken)
    const hole = over ? null : holeUnder(e)
    const full = hole && taken.has(holeKey(hole.part, hole.pin, hole.hole ?? 0)) ? resolveEndpoint(store.getState().diagram, hole) : null
    return { over, refused: full ? full.end : null }
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    lastClient.current = { x: e.clientX, y: e.clientY }
    if (!drag) {
      const over = endUnder(e)
      setHover((h) => (h === over || (h && over && sameEndpoint(store.getState().diagram, h, over)) ? h : over))
      // The label under the pointer: from the pin it is over, else by hit-testing, once per grid cell crossed.
      if (over || hoverCells.current.moved(toWorld(e))) {
        const d = store.getState().diagram
        const uid = over?.part ?? document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-part]')?.getAttribute('data-part') ?? null
        const p = uid ? d.parts.find((q) => q.uid === uid) : undefined
        setHoverLabel(p && isNetLabel(moduleOf(d, p.module)) ? p.uid : null)
        if (over) hoverCells.current.reset()
      }
      return
    }
    if (e.pointerId !== drag.pointer) return
    if (drag.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
    else if (drag.kind === 'marquee') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) >= MARQUEE_MIN
      const cursor = toWorld(e)
      setDrag({ ...drag, cursor, moved })
      // The selection follows the rectangle live, so the outlines show what the release will pick.
      if (moved) store.select(marqueeSelection(store.getState().diagram, rectOf(drag.start, cursor), drag.add ? drag.before : EMPTY_SELECTION))
    } else if (drag.kind === 'parts' || drag.kind === 'annotations') {
      if (!store.dragging) return
      lastMove.current = { client: { x: e.clientX, y: e.clientY }, off: e.ctrlKey || e.metaKey }
      dragTo(drag, lastMove.current.client, lastMove.current.off)
    } else if (drag.kind === 'segment') {
      if (!store.dragging) return
      const p = toWorld(e)
      const delta = drag.axis === 'h' ? p.y - drag.start.y : p.x - drag.start.x
      const moved = moveSegment(drag.points, drag.index, delta)
      // Back where it began, or a move the stub rule cancels out: show the starting diagram, so an
      // automatic wire stays automatic and no undo step is recorded.
      if (samePoints(moved, drag.points)) store.preview(drag.base)
      else store.preview(setWireRoute(drag.base, drag.uid, toRoute(moved)))
    } else if (drag.kind === 'wire') setDrag({ ...drag, cursor: toWorld(e), ...dropUnder(e) })
    else if (drag.kind === 'reconnect') setDrag({ ...drag, cursor: toWorld(e), ...dropUnder(e) })
  }
  /**
   * Moves the dragged parts or marks for the pointer at `client`: on the grid, then snapped to other
   * objects unless snapping is off or `off` (Ctrl or Cmd held). A part that would sit on a board or
   * an outlet at its grid position is being seated: the holes decide, and nothing else snaps.
   */
  function dragTo(d: Extract<Drag, { kind: 'parts' | 'annotations' }>, client: Pt, off: boolean) {
    const p = toWorld({ clientX: client.x, clientY: client.y })
    const raw = { x: p.x - d.start.x, y: p.y - d.start.y }
    const move = (dx: number, dy: number) => (d.kind === 'parts' ? moveParts(d.base, d.uids, dx, dy) : moveAnnotations(d.base, d.uids, dx, dy))
    const grid = gridOnly(raw)
    const onGrid = move(grid.dx, grid.dy)
    const snapping = dragSnapRef.current
    if (!snapping || off || !store.getState().snapObjects || (d.kind === 'parts' && seating(d, snapping, onGrid, grid))) {
      store.preview(onGrid)
      setGuides(null)
      return
    }
    const r = snapMove(snapping.index, snapping.moving, raw, view.scale)
    const snapped = r.dx === grid.dx && r.dy === grid.dy ? onGrid : move(r.dx, r.dy)
    // A snap must never be what puts a part into a board or an outlet: where the snapped move
    // would seat (or partly seat) a part the plain grid move does not, the grid move stands.
    if (snapped !== onGrid && d.kind === 'parts' && seating(d, snapping, snapped, r)) {
      store.preview(onGrid)
      setGuides(null)
      return
    }
    store.preview(snapped)
    setGuides(r.guides.length || r.gaps.length ? r : null)
  }
  /** Whether a moving part would be seated (or partly seated) in a board or outlet at `at`. */
  function seating(d: Extract<Drag, { kind: 'parts' }>, snapping: DragSnap, at: Diagram, delta: { dx: number; dy: number }): boolean {
    if (!d.settling.length || !snapping.boards.length) return false
    const near = snapping.settling.some((r) => snapping.boards.some((b) => overlaps({ ...r, x: r.x + delta.dx, y: r.y + delta.dy }, b)))
    if (!near) return false
    for (const seat of seatsOf(at, d.settling).seats.values()) if (seat) return true
    return false
  }

  // Pressing or releasing Ctrl (Cmd on a Mac) mid-drag turns object snapping off or back on at once.
  const snapDrag = drag?.kind === 'parts' || drag?.kind === 'annotations' ? drag : null
  useEffect(() => {
    if (!snapDrag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return
      const last = lastMove.current
      const off = e.ctrlKey || e.metaKey
      if (!last || last.off === off || !store.dragging) return
      lastMove.current = { ...last, off }
      dragTo(snapDrag, last.client, off)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
    // Re-bound every render, so the key sees the current view (the wheel can zoom mid-drag).
  })

  function releaseHeld() {
    if (!heldRef.current) return
    heldRef.current = false
    store.setHeld(null)
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    releaseHeld()
    if (!drag || e.pointerId !== drag.pointer) return
    if (drag.kind === 'parts') finishPartsDrag(drag, true)
    if (drag.kind === 'segment') store.end()
    if (drag.kind === 'annotations') store.end()
    if (drag.kind === 'marquee' && !drag.moved && !drag.add) store.select(EMPTY_SELECTION)
    if (drag.kind === 'wire') {
      const to = endUnder(e, taken)
      const s = store.getState()
      // The start part may have been deleted or undone away while the wire was being drawn.
      const exists = (ep: Endpoint) => s.diagram.parts.some((p) => p.uid === ep.part)
      const added = to && exists(drag.from) && exists(to) && addWire(s.diagram, drag.from, to, { ...s.wireStyle, color: newWireColor(s.diagram, drag.from, to, s.wireStyle.color) })
      if (added) {
        store.commit(added.diagram)
        store.select({ parts: [], wires: [added.uid] })
      }
      // Spec 6.3: a click on a GPIO pin while simulating cycles its state.
      else if (to && s.simulate && s.simTool === 'select' && sameEndpoint(s.diagram, to, drag.from)) {
        const next = cycleGpio(s.diagram, drag.from.part, drag.from.pin)
        if (next) store.commit(next)
      }
    }
    if (drag.kind === 'reconnect') {
      const to = endUnder(e, taken)
      const next = to && reconnectWire(store.getState().diagram, drag.uid, drag.end, to, store.getState().wireStyle)
      if (next) {
        store.commit(next)
        store.select({ parts: [], wires: [drag.uid] })
      }
    }
    if (drag.kind !== 'pan') store.setGesture(false)
    setDrag(null)
    setHover(null)
  }
  function onPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    releaseHeld()
    if (!drag || e.pointerId !== drag.pointer) return
    if (drag.kind === 'parts') finishPartsDrag(drag, false)
    // A reshape the browser took away (lost capture, cancelled touch) is abandoned, not kept.
    if (drag.kind === 'segment') store.cancel()
    if (drag.kind === 'annotations') store.end()
    if (drag.kind !== 'pan') store.setGesture(false)
    setDrag(null)
    setHover(null)
  }

  // Escape abandons a wire, part, segment, annotation or selection-rectangle drag. For parts,
  // segments and annotations, the editor's key handler calls store.cancel(); a rectangle puts the
  // selection back as it was before the press.
  const marqueeBefore = drag?.kind === 'marquee' ? drag.before : null
  useEffect(() => {
    if (!drag || drag.kind === 'pan') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (marqueeBefore) store.select(marqueeBefore)
      store.setGesture(false)
      setDrag(null)
      setHover(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag?.kind])

  const renderPart = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    const label = !!m && isNetLabel(m)
    return m ? (
      <g key={p.uid} data-part={p.uid} data-label-lit={litLabels.includes(p.uid) ? '' : undefined}>
        {label && litLabels.includes(p.uid) && (() => {
          const r = flagRect(p, m, flags.get(p.uid) === 'ground' || flags.get(p.uid) === 'mains')
          return <rect className="label-lit" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={6} pointerEvents="none" />
        })()}
        {selection.parts.includes(p.uid) && (() => {
          const r = label ? flagRect(p, m, flags.get(p.uid) === 'ground' || flags.get(p.uid) === 'mains') : bodyRect(p, layoutModule(m))
          return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={6} fill="none" stroke="var(--focus)" strokeWidth={1.5} strokeDasharray="5 4" />
        })()}
        <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={label ? undefined : partCaption(p, m)} values={p.values}
          netName={label ? labelName(p) : undefined} netLook={label ? (flags.get(p.uid) ?? (labelName(p) ? 'signal' : 'unnamed')) : undefined}
          captionX={seated.get(p.uid)?.caption.x} captionY={seated.get(p.uid)?.caption.y}
          captionAnchor={seated.get(p.uid)?.anchor} labelInset={seated.get(p.uid)?.labelInset} />
      </g>
    ) : null
  }

  return (
    <div
      className="canvas-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MODULE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(MODULE_MIME)
        if (id) {
          e.preventDefault()
          placeModule(id, toWorld(e))
        }
      }}
    >
      <svg
        ref={svgRef}
        className={`${drag?.kind === 'pan' ? 'canvas panning' : spaceDown ? 'canvas space-pan' : 'canvas'}${simTool === 'probe' ? ' probing' : ''}`}
        viewBox={`${view.x} ${view.y} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          setHover(null)
          setHoverLabel(null)
          hoverCells.current.reset()
          lastClient.current = null
        }}
        // A middle press would start the browser's autoscroll; the middle drag pans instead.
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label="Wiring sheet editor"
      >
        <defs>
          <pattern id="editor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth={0.6 / Math.max(1, view.scale / 1.5)} />
          </pattern>
        </defs>
        <rect x={view.x} y={view.y} width={vw} height={vh} fill="var(--paper)" />
        <rect x={view.x} y={view.y} width={vw} height={vh} fill="url(#editor-grid)" />
        {/* Group frames sit below the boards, as in the Sheet; notes come after the wire name tags. */}
        {(diagram.annotations ?? []).filter((a) => a.type === 'frame').map((a) => (
          <FrameMark key={a.uid} a={a} interactive selected={!!selection.annotations?.includes(a.uid)} />
        ))}
        {layers.boards.map(renderPart)}
        <TakenHoles plugs={plugs} />
        {layers.others.map(renderPart)}
        <LegDots plugs={plugs} />
        <g pointerEvents="none">
          {seats.flatMap((s, i) => (s.outline ? [<rect key={`outline-${i}`} className="seat-bad" x={s.outline.x} y={s.outline.y} width={s.outline.w} height={s.outline.h} rx={6} />] : []))}
          {seats.flatMap((s, i) =>
            s.holes.map((h, j) => <circle key={`${i}-${j}`} className={s.status === 'seated' ? 'seat-ok' : 'seat-bad'} cx={h.x} cy={h.y} r={4} />),
          )}
          {seats.flatMap((s, i) => (s.blocked ?? []).map((h, j) => <circle key={`blocked-${i}-${j}`} className="seat-bad" cx={h.x} cy={h.y} r={4} />))}
          {covered.map((c) => <circle key={`covered-${c.board}-${c.group}-${c.hole}`} className="seat-bad" data-covered-hole="" cx={c.at.x} cy={c.at.y} r={4} />)}
          {drawing && drag.refused && <circle className="seat-bad" data-used-hole="" cx={drag.refused.x} cy={drag.refused.y} r={4} />}
        </g>
        {highlight && (
          <g className={`problem-glow ${highlight.severity}`} fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
            {highlight.wires.map((uid) => {
              const w = wires.find((x) => x.conn.uid === uid)
              const c = w ? null : diagram.connections.find((x) => x.uid === uid)
              const path = w ? (w.conn.ends ? polyline(w.points) : w.d) : c && stubOf(diagram, c)?.d
              return path ? <path key={uid} d={path} strokeWidth={wireWidth(w?.conn.gauge) + 12} /> : null
            })}
          </g>
        )}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {wires.map(({ conn, d, blocked, points }) => {
            const w = wireWidth(conn.gauge)
            const dash = blocked ? BLOCKED_STROKE : {}
            const selected = selection.wires.includes(conn.uid)
            const dimmed = drag?.kind === 'reconnect' && drag.uid === conn.uid
            const look = looks.get(conn.uid)
            const name = drawnColor(conn, looks)
            const stripe = wireStripe(name)
            return (
              <g key={conn.uid} data-wire={conn.uid} opacity={dimmed ? 0.3 : undefined}>
                {selected && <path d={conn.ends ? polyline(points) : d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={w + 10} />}
                {isPluggedIn(diagram, conn) ? <PluggedLink d={d} casing={INK} /> : (
                  <>
                    {look?.hazard && <HazardOutline d={d} width={w} />}
                    <path d={d} stroke={INK} strokeWidth={w + 2.2} {...dash} />
                    <path className="wire-color" d={d} stroke={wireColor(name)} strokeWidth={w} {...dash} />
                    {stripe && <Stripe d={d} width={w} color={stripe} blocked={blocked} />}
                  </>
                )}
                <path d={conn.ends ? polyline(points) : d} className="wire-hit" strokeWidth={Math.max(12, w + 8)} />
              </g>
            )
          })}
        </g>
        <CableLayer wires={wires} dim={drag?.kind === 'reconnect' ? drag.uid : null} looks={looks} />
        {wires.map(({ conn, points, cables }) => (looks.get(conn.uid)?.hazard && !(drag?.kind === 'reconnect' && drag.uid === conn.uid) ? <Bolts key={`bolt-${conn.uid}`} points={points} insets={boltInsets(cables)} /> : null))}
        {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
        {/* Name tags in their own layer after every wire, so a labeled wire crossing under a
            later one still shows its tag on top. Each tag keeps data-wire so a click or
            double-click on it still selects or edits that wire. */}
        <g>
          {wires.map(({ conn, points }) => {
            const dimmed = drag?.kind === 'reconnect' && drag.uid === conn.uid
            const anchor = conn.label && !dimmed ? labelAnchor(points) : null
            return anchor ? (
              <g key={conn.uid} data-wire={conn.uid}>
                <WireLabel x={anchor.x} y={anchor.y} text={conn.label!} />
              </g>
            ) : null
          })}
        </g>
        {(diagram.annotations ?? []).filter((a) => a.type === 'text').map((a) => (
          <NoteMark key={a.uid} a={a} interactive selected={!!selection.annotations?.includes(a.uid)} />
        ))}
        {simOutcome && (
          <SimLayer diagram={diagram} result={simShown?.result ?? null} stale={!!simShown?.stale} circuit={sim?.phase === 'done' ? sim.circuit : null} findings={simFindings} />
        )}
        {/* Probes (saved with the sheet) show "-" until Simulate gives them readings. */}
        {(diagram.probes?.length ?? 0) > 0 && <ProbeLayer diagram={diagram} readings={simShown?.result.probes ?? null} stale={!!simShown?.stale} />}
        {/* A connection the netlist could not join (a missing part, pin, group or hole) has no
            route to draw, but a short dashed red stub at whichever end still resolves lets a
            user find and repair it instead of a wire silently vanishing from the sheet. Drawn after the
            name tags so no label (a tag or a board's column number) hides it. It carries
            data-wire like any wire, so a click selects it and Delete removes the connection. */}
        {diagram.connections.map((c) => {
          if (!nl.broken.includes(c.uid)) return null
          const stub = stubOf(diagram, c)
          if (!stub) return null
          const d = stub.d
          return (
            <g key={c.uid} data-wire={c.uid} fill="none" strokeLinecap="round">
              <title>{`${c.uid}: cannot resolve both ends`}</title>
              {selection.wires.includes(c.uid) && <path d={d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={12} />}
              <path className="wire-broken" d={d} strokeWidth={2.5} />
              <path className="wire-hit" d={d} strokeWidth={12} />
            </g>
          )
        })}
        {highlight && (
          <g className={`problem-hi ${highlight.severity}`} pointerEvents="none">
            {highlight.parts.map((uid) => {
              const p = diagram.parts.find((q) => q.uid === uid)
              const m = p && moduleOf(diagram, p.module)
              if (!p || !m) return null
              const r = bodyRect(p, layoutModule(m))
              return (
                <g key={uid}>
                  <rect className="problem-halo" x={r.x - 7} y={r.y - 7} width={r.w + 14} height={r.h + 14} rx={8} />
                  <SeverityMark severity={highlight.severity} at={{ x: r.x - 16, y: r.y - 16, size: 18 }} />
                </g>
              )
            })}
            {highlight.pins.map((ep) => {
              const at = resolveEndpoint(diagram, ep)
              return at ? <circle key={`${ep.part}/${ep.pin}`} className="problem-pin" cx={at.end.x} cy={at.end.y} r={6.5} /> : null
            })}
          </g>
        )}
        {net.length > 0 && <path className="net-hi" d={net.map((p) => circlePath(p, 4)).join('')} pointerEvents="none" />}
        {drag?.kind === 'wire' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(startColor(diagram, drag.from, store.getState().wireStyle.color))} strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {drag?.kind === 'reconnect' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(diagram.connections.find((c) => c.uid === drag.uid)?.color ?? looks.get(drag.uid)?.color ?? undefined)}
            strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {(drag?.kind === 'wire' || drag?.kind === 'reconnect') && drag.over?.hole !== undefined && (() => {
          const at = resolveEndpoint(diagram, drag.over!)
          return at ? <circle className="hole-target" cx={at.end.x} cy={at.end.y} r={4.5} /> : null
        })()}
        {snapDrag && guides && <GuideLayer snap={guides} scale={view.scale} />}
        {diagram.parts.map((p) => {
          const m = moduleOf(diagram, p.module)
          if (!m) return null
          const hoveredPin =
            (drag?.kind === 'wire' || drag?.kind === 'reconnect') && drag.over?.part === p.uid ? drag.over.pin : null
          return <PinTargets key={p.uid} part={p} targets={pinTargets(diagram, p, m)} hoveredPin={hoveredPin} />
        })}
        {drag?.kind === 'marquee' && drag.moved && (() => {
          const r = rectOf(drag.start, drag.cursor)
          return <rect className="marquee" x={r.x} y={r.y} width={r.w} height={r.h} pointerEvents="none" />
        })()}
        {selection.wires.length === 1 &&
          !drag &&
          (() => {
            const w = wires.find((w) => w.conn.uid === selection.wires[0])
            if (!w) return null
            // Handles index the routed geometry the edits work on (with its collinear bends); the
            // segment bars are drawn on the drawn path, which may be nudged a few px clear of
            // another wire.
            // A polyline with a diagonal step (never routed, only guarded) gets no segment or bend handles.
            const pts = editablePoints(w.conn.uid) ?? []
            const segHandles = segmentsOf(pts)
              .filter((sg) => Math.abs(sg.b.x - sg.a.x) + Math.abs(sg.b.y - sg.a.y) >= MIN_HANDLE_SEGMENT)
              .map((sg) => {
                const h = sg.axis === 'h'
                // Indices come from the routed polyline; the bar sits on the drawn line.
                const { x: cx, y: cy } = segmentHandleAt(sg, w.points)
                return (
                  <rect
                    key={`seg-${sg.i}`}
                    className="wire-seg-handle"
                    data-seg-index={sg.i}
                    data-wire-uid={w.conn.uid}
                    x={cx - (h ? 6 : 2.5)}
                    y={cy - (h ? 2.5 : 6)}
                    width={h ? 12 : 5}
                    height={h ? 5 : 12}
                    rx={2.5}
                    fill="white"
                    stroke="var(--focus)"
                    strokeWidth={1.5}
                    style={{ cursor: h ? 'ns-resize' : 'ew-resize' }}
                  >
                    <title>Drag to move this part of the wire</title>
                  </rect>
                )
              })
            const bendHandles = w.conn.route
              ? pts.slice(1, -1).map((bend, k) => {
                  // On the drawn corner, which may be nudged a few px clear of another wire.
                  const p = bendHandleAt(bend, w.points)
                  return (
                    <rect
                      key={`bend-${k + 1}`}
                      className="wire-bend-handle"
                      data-vertex-index={k + 1}
                      data-wire-uid={w.conn.uid}
                      x={p.x - 2.5}
                      y={p.y - 2.5}
                      width={5}
                      height={5}
                      fill="white"
                      stroke="var(--focus)"
                      strokeWidth={1.5}
                    >
                      <title>Double-click to remove this bend</title>
                    </rect>
                  )
                })
              : []
            return [...segHandles, ...bendHandles, ...(['from', 'to'] as const).map((end, i) => (
              <circle
                key={`handle-${end}`}
                className="wire-end-handle"
                data-wire-end={end}
                data-wire-uid={w.conn.uid}
                cx={w.ends[i].x}
                cy={w.ends[i].y}
                r={6}
                fill="white"
                stroke="var(--focus)"
                strokeWidth={2}
              >
                <title>Drag to reconnect</title>
              </circle>
            ))]
          })()}
      </svg>
      <div className="zoom-readout" aria-live="polite">{Math.round((view.scale / 1.5) * 100)}%</div>
      {editing && (
        <input
          ref={editRef}
          key={editing.uid}
          className="wire-label-editor"
          style={{ left: (editing.anchor.x - view.x) * view.scale, top: (editing.anchor.y - view.y) * view.scale }}
          defaultValue={editing.initial}
          aria-label="Wire label"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitLabelEdit(editing.token)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelLabelEdit(editing.token)
            }
          }}
          onBlur={() => commitLabelEdit(editing.token)}
        />
      )}
    </div>
  )
}
