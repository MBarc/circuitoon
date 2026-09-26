// The editing surface: an SVG sheet you can pan (drag the background) and zoom (wheel).
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { brokenStub, computeRoutes, labelAnchor, moduleOf, pinTargets, resolveEndpoint, routingKey, wireColor, wirePaths, wireWidth, type PartInstance, type PinTarget, type Routes } from '../format/diagram.ts'
import { holeEndAt, plugsOf, splitBoards } from '../format/breadboard.ts'
import type { Pt } from '../format/geometry.ts'
import { Part, INK } from '../render/Part.tsx'
import { LegDots, TakenHoles } from '../render/Boards.tsx'
import { WireLabel } from '../render/WireLabel.tsx'
import { addPart, addWire, EMPTY_SELECTION, moveParts, reconnectWire, sameEndpoint, setWireRoute, settleDrop, settleMounts, settleSeats, settlingOf, updateWire, withMounted } from './ops.ts'
import { netlist, netPoints } from '../format/netlist.ts'
import { bendHandleAt, insertBend, isOrthogonal, moveSegment, removeBend, segmentHandleAt, segmentsOf, toRoute, type Axis } from '../format/wireEdit.ts'
import { modulesById } from '../library.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { MODULE_MIME } from './LibraryPanel.tsx'
import type { Diagram, Endpoint } from '../format/diagram.ts'
import { partCaption } from '../format/values.ts'

export type View = { x: number; y: number; scale: number }
const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

type Drag = { pointer: number } & (
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; moving: string[]; settling: string[]; base: Diagram }
  | { kind: 'wire'; from: Endpoint; origin: Pt; cursor: Pt; over: Endpoint | null }
  | { kind: 'reconnect'; uid: string; end: 'from' | 'to'; origin: Pt; cursor: Pt; over: Endpoint | null }
  | { kind: 'segment'; uid: string; index: number; axis: Axis; start: Pt; points: Pt[]; base: Diagram }
)

/** Segments shorter than this get no handle: there is no room to grab one. A 20 px pin run gets one. */
const MIN_HANDLE_SEGMENT = 20

const samePoints = (a: Pt[], b: Pt[]) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)

/** Length in px of the red stub drawn at a broken connection's resolvable end. */
const BROKEN_STUB = 20
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

export function Canvas({ store, onReady }: { store: EditorStore; onReady?: (api: { addAtCenter: (moduleId: string) => void }) => void }) {
  const { diagram, selection } = useEditorState(store)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: -20, y: -40, scale: 1.5 })
  const [drag, setDrag] = useState<Drag | null>(null)
  // The pin or hole under the pointer while nothing is being dragged, for net highlighting.
  const [hover, setHover] = useState<Endpoint | null>(null)
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

  function placeModule(moduleId: string, at: Pt) {
    const m = Object.hasOwn(modulesById, moduleId) ? modulesById[moduleId] : undefined
    if (!m) return
    const lay = layoutModule(m)
    const { diagram: next, uid } = addPart(store.getState().diagram, m, snap(at.x - lay.w / 2), snap(at.y - lay.h / 2))
    // Dropped with every leg on free holes of a board, the new part plugs in: one undo step.
    store.commit(settleMounts(next, [uid]))
    store.select({ parts: [uid], wires: [] })
  }

  useEffect(() => {
    onReady?.({ addAtCenter: (id) => placeModule(id, { x: view.x + size.w / view.scale / 2, y: view.y + size.h / view.scale / 2 }) })
  })

  // Parts that move this drag: the selection plus whatever is mounted on a dragged board.
  const draggingParts = drag?.kind === 'parts' ? drag.moving : null
  const reshaping = drag?.kind === 'segment' ? drag.uid : null
  // Routes depend only on parts, modules and each wire's ends and fixed route, so title, color and label edits skip re-routing.
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
    const all = computeRoutes(diagram)
    settled.current = all
    return all
  }, [diagram.parts, diagram.modules, endpointsKey, draggingParts, reshaping])
  // Path data only changes with the routes or the wires themselves, not with pan, zoom or selection.
  const wires = useMemo(() => wirePaths(diagram, routes), [routes, diagram.connections])
  // Boards draw below every other part; the leg overlays follow mounts and positions.
  const layers = useMemo(() => splitBoards(diagram), [diagram.parts, diagram.modules])
  // While parts are dragged, the same seat check the drop runs: the dragged parts count as loose
  // (their old legs neither show nor push a part that stays put out of its holes), and each seat
  // is green when the drop would mount it, red when only some legs land.
  const settling = useMemo(
    () => (drag?.kind === 'parts' ? settleSeats(diagram, drag.settling) : null),
    [diagram.parts, diagram.modules, drag],
  )
  const plugs = useMemo(() => settling?.plugs ?? plugsOf(diagram), [settling, diagram.parts, diagram.modules])
  const seats = useMemo(() => (settling ? [...settling.seats.values()].flatMap((s) => s ?? []) : []), [settling])
  // Rebuilt only when parts, connections or modules actually change, so moving the pointer between
  // hover targets (which changes `hover` every frame) never rebuilds the netlist itself.
  const nl = useMemo(() => netlist(diagram), [diagram.parts, diagram.connections, diagram.modules])
  const net = useMemo(() => (hover && !drag ? netPoints(diagram, hover, nl) : []), [hover, drag, diagram, nl])

  const vw = size.w / view.scale
  const vh = size.h / view.scale

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
  function finishPartsDrag(d: Extract<Drag, { kind: 'parts' }>) {
    // A press without movement changes nothing, mounts included (settleDrop returns `now` then).
    if (store.dragging) store.preview(settleDrop(d.base, store.getState().diagram, d.settling))
    store.end()
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
    // Explicit wire-edit handles of the selected wire come first: they sit on top of everything.
    const handleEl = e.button === 0 ? target.closest('[data-wire-end]') : null
    if (handleEl) {
      const uid = handleEl.getAttribute('data-wire-uid')!
      const end = handleEl.getAttribute('data-wire-end') as 'from' | 'to'
      const w = wires.find((w) => w.conn.uid === uid)
      const origin = w ? w.ends[end === 'from' ? 1 : 0] : toWorld(e)
      setDrag({ pointer, kind: 'reconnect', uid, end, origin, cursor: toWorld(e), over: null })
      store.setGesture(true)
      return
    }
    const segEl = e.button === 0 ? target.closest('[data-seg-index]') : null
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
    if (e.button === 0 && target.closest('[data-vertex-index]')) return
    // A press on a pin or a hole starts a wire there, by the same terminal-hit policy hover and
    // drop use, so a hole under an ordinary wire's hit stroke still starts a wire; a press on the
    // wire anywhere else selects it. A pin ends at its stub tip, or at its leg's hole when plugged
    // (Ruling 25). Between holes, a press drags the board as usual.
    // Alt+press on the selected wire adds a bend there (a wire edit), even over a hole.
    const sel0 = store.getState().selection
    const bending = e.altKey && sel0.parts.length === 0 && sel0.wires.length === 1 && target.closest('[data-wire]')?.getAttribute('data-wire') === sel0.wires[0]
    const end = e.button === 0 && !bending ? endUnder(e) : null
    const at = end && resolveEndpoint(store.getState().diagram, end)
    if (end && at) {
      setDrag({ pointer, kind: 'wire', from: end, origin: at.end, cursor: toWorld(e), over: null })
      store.setGesture(true)
      return
    }
    const wireEl = e.button === 0 ? target.closest('[data-wire]') : null
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
    const partEl = e.button === 0 ? target.closest('[data-part]') : null
    if (partEl) {
      const uid = partEl.getAttribute('data-part')!
      const sel = store.getState().selection
      let parts = sel.parts
      if (e.shiftKey) parts = parts.includes(uid) ? parts.filter((u) => u !== uid) : [...parts, uid]
      else if (!parts.includes(uid)) parts = [uid]
      store.select({ parts, wires: e.shiftKey ? sel.wires : [] })
      if (parts.includes(uid)) {
        const base = store.begin()
        setDrag({ pointer, kind: 'parts', start: toWorld(e), uids: parts, moving: withMounted(base, parts), settling: settlingOf(base, parts), base })
        store.setGesture(true)
      }
      return
    }
    if (!e.shiftKey) store.select(EMPTY_SELECTION)
    setDrag({ pointer, kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
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
   * its own there) still occludes it, since it is the first part found.
   */
  function holeUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const partEl = el.closest('[data-part]')
      if (partEl) return holeEndAt(store.getState().diagram, partEl.getAttribute('data-part')!, toWorld(e))
    }
    return null
  }
  /**
   * The one terminal-hit policy, shared by hover, pressing and dropping a wire end: a pin first (its
   * target sits on top), else a hole or pad on the topmost part under the pointer.
   */
  function endUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    return pinUnder(e) ?? holeUnder(e)
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) {
      const over = endUnder(e)
      setHover((h) => (h === over || (h && over && sameEndpoint(store.getState().diagram, h, over)) ? h : over))
      return
    }
    if (e.pointerId !== drag.pointer) return
    if (drag.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
    else if (drag.kind === 'parts') {
      if (!store.dragging) return
      const p = toWorld(e)
      store.preview(moveParts(drag.base, drag.uids, snap(p.x - drag.start.x), snap(p.y - drag.start.y)))
    } else if (drag.kind === 'segment') {
      if (!store.dragging) return
      const p = toWorld(e)
      const delta = drag.axis === 'h' ? p.y - drag.start.y : p.x - drag.start.x
      const moved = moveSegment(drag.points, drag.index, delta)
      // Back where it began, or a move the stub rule cancels out: show the starting diagram, so an
      // automatic wire stays automatic and no undo step is recorded.
      if (samePoints(moved, drag.points)) store.preview(drag.base)
      else store.preview(setWireRoute(drag.base, drag.uid, toRoute(moved)))
    } else if (drag.kind === 'wire') setDrag({ ...drag, cursor: toWorld(e), over: endUnder(e) })
    else if (drag.kind === 'reconnect') setDrag({ ...drag, cursor: toWorld(e), over: endUnder(e) })
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag || e.pointerId !== drag.pointer) return
    if (drag.kind === 'parts') finishPartsDrag(drag)
    if (drag.kind === 'segment') store.end()
    if (drag.kind === 'wire') {
      const to = endUnder(e)
      const s = store.getState()
      // The start part may have been deleted or undone away while the wire was being drawn.
      const exists = (ep: Endpoint) => s.diagram.parts.some((p) => p.uid === ep.part)
      const added = to && exists(drag.from) && exists(to) && addWire(s.diagram, drag.from, to, s.wireStyle)
      if (added) {
        store.commit(added.diagram)
        store.select({ parts: [], wires: [added.uid] })
      }
    }
    if (drag.kind === 'reconnect') {
      const to = endUnder(e)
      const next = to && reconnectWire(store.getState().diagram, drag.uid, drag.end, to)
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
    if (!drag || e.pointerId !== drag.pointer) return
    if (drag.kind === 'parts') finishPartsDrag(drag)
    // A reshape the browser took away (lost capture, cancelled touch) is abandoned, not kept.
    if (drag.kind === 'segment') store.cancel()
    if (drag.kind !== 'pan') store.setGesture(false)
    setDrag(null)
    setHover(null)
  }

  // Escape abandons a wire, part or segment drag. For parts and segments, the editor's key
  // handler calls store.cancel().
  useEffect(() => {
    if (drag?.kind !== 'wire' && drag?.kind !== 'parts' && drag?.kind !== 'reconnect' && drag?.kind !== 'segment') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      store.setGesture(false)
      setDrag(null)
      setHover(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag?.kind])

  const renderPart = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    return m ? (
      <g key={p.uid} data-part={p.uid}>
        {selection.parts.includes(p.uid) && (() => {
          const r = bodyRect(p, layoutModule(m))
          return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={6} fill="none" stroke="var(--focus)" strokeWidth={1.5} strokeDasharray="5 4" />
        })()}
        <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={partCaption(p, m)} values={p.values} />
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
        className={drag?.kind === 'pan' ? 'canvas panning' : 'canvas'}
        viewBox={`${view.x} ${view.y} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => setHover(null)}
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
        {layers.boards.map(renderPart)}
        <TakenHoles plugs={plugs} />
        {layers.others.map(renderPart)}
        <LegDots plugs={plugs} />
        <g pointerEvents="none">
          {seats.flatMap((s, i) =>
            s.holes.map((h, j) => <circle key={`${i}-${j}`} className={s.status === 'seated' ? 'seat-ok' : 'seat-bad'} cx={h.x} cy={h.y} r={4} />),
          )}
        </g>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {wires.map(({ conn, d, blocked }) => {
            const w = wireWidth(conn.gauge)
            const dash = blocked ? '6 5' : undefined
            const selected = selection.wires.includes(conn.uid)
            const dimmed = drag?.kind === 'reconnect' && drag.uid === conn.uid
            return (
              <g key={conn.uid} data-wire={conn.uid} opacity={dimmed ? 0.3 : undefined}>
                {selected && <path d={d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={w + 10} />}
                <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={dash} />
                <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={dash} />
                <path d={d} className="wire-hit" strokeWidth={Math.max(12, w + 8)} />
              </g>
            )
          })}
        </g>
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
        {/* A connection the netlist could not join (a missing part, pin, group or hole) has no
            route to draw, but a short dashed red stub at whichever end still resolves lets a
            user find and repair it instead of a wire silently vanishing from the sheet. Drawn after the
            name tags so no label (a tag or a board's column number) hides it. It carries
            data-wire like any wire, so a click selects it and Delete removes the connection. */}
        {diagram.connections.map((c) => {
          if (!nl.broken.includes(c.uid)) return null
          const at = brokenStub(diagram, c)
          if (!at) return null
          const dir = at.dir ?? { x: 0, y: -1 }
          const tip = { x: at.end.x + dir.x * BROKEN_STUB, y: at.end.y + dir.y * BROKEN_STUB }
          const d = `M${at.end.x} ${at.end.y}L${tip.x} ${tip.y}`
          return (
            <g key={c.uid} data-wire={c.uid} fill="none" strokeLinecap="round">
              <title>{`${c.uid}: cannot resolve both ends`}</title>
              {selection.wires.includes(c.uid) && <path d={d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={12} />}
              <path className="wire-broken" d={d} strokeWidth={2.5} />
              <path className="wire-hit" d={d} strokeWidth={12} />
            </g>
          )
        })}
        {net.length > 0 && <path className="net-hi" d={net.map((p) => circlePath(p, 4)).join('')} pointerEvents="none" />}
        {drag?.kind === 'wire' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(store.getState().wireStyle.color)} strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {drag?.kind === 'reconnect' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(diagram.connections.find((c) => c.uid === drag.uid)?.color)}
            strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {(drag?.kind === 'wire' || drag?.kind === 'reconnect') && drag.over?.hole !== undefined && (() => {
          const at = resolveEndpoint(diagram, drag.over!)
          return at ? <circle className="hole-target" cx={at.end.x} cy={at.end.y} r={4.5} /> : null
        })()}
        {diagram.parts.map((p) => {
          const m = moduleOf(diagram, p.module)
          if (!m) return null
          const hoveredPin =
            (drag?.kind === 'wire' || drag?.kind === 'reconnect') && drag.over?.part === p.uid ? drag.over.pin : null
          return <PinTargets key={p.uid} part={p} targets={pinTargets(diagram, p, m)} hoveredPin={hoveredPin} />
        })}
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
