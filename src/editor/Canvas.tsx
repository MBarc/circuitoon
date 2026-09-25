// The editing surface: an SVG sheet you can pan (drag the background) and zoom (wheel).
import { useEffect, useMemo, useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { computeRoutes, wireColor, wirePaths, wireWidth, type Routes } from '../format/diagram.ts'
import type { Pt } from '../format/geometry.ts'
import { Part, INK } from '../render/Part.tsx'
import { addPart, addWire, EMPTY_SELECTION, moveParts } from './ops.ts'
import { modulesById } from '../library.ts'
import { bodyRect, worldPins } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { MODULE_MIME } from './LibraryPanel.tsx'
import type { Diagram, Endpoint } from '../format/diagram.ts'

export type View = { x: number; y: number; scale: number }
const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

type Drag =
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; base: Diagram }
  | { kind: 'wire'; from: Endpoint; origin: Pt; cursor: Pt; over: Endpoint | null }

export function Canvas({ store, onReady }: { store: EditorStore; onReady?: (api: { addAtCenter: (moduleId: string) => void }) => void }) {
  const { diagram, selection } = useEditorState(store)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: -20, y: -40, scale: 1.5 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const settled = useRef<Routes>(new Map())

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
    const m = modulesById[moduleId]
    if (!m) return
    const lay = layoutModule(m)
    const { diagram: next, uid } = addPart(store.getState().diagram, m, snap(at.x - lay.w / 2), snap(at.y - lay.h / 2))
    store.commit(next)
    store.select({ parts: [uid], wires: [] })
  }

  useEffect(() => {
    onReady?.({ addAtCenter: (id) => placeModule(id, { x: view.x + size.w / view.scale / 2, y: view.y + size.h / view.scale / 2 }) })
  })

  const draggingParts = drag?.kind === 'parts' ? drag.uids : null
  const routes = useMemo(() => {
    if (draggingParts) {
      const moving = new Set(draggingParts)
      const only = new Set(diagram.connections.filter((c) => moving.has(c.from.part) || moving.has(c.to.part)).map((c) => c.uid))
      return computeRoutes(diagram, { only, prev: settled.current })
    }
    const all = computeRoutes(diagram)
    settled.current = all
    return all
  }, [diagram, draggingParts])
  const wires = wirePaths(diagram, routes)

  const vw = size.w / view.scale
  const vh = size.h / view.scale

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as Element
    e.currentTarget.setPointerCapture(e.pointerId)
    const pinEl = e.button === 0 ? target.closest('[data-pin]') : null
    if (pinEl) {
      const from = { part: pinEl.getAttribute('data-pin-part')!, pin: pinEl.getAttribute('data-pin')! }
      const origin = { x: Number(pinEl.getAttribute('cx')), y: Number(pinEl.getAttribute('cy')) }
      setDrag({ kind: 'wire', from, origin, cursor: toWorld(e), over: null })
      return
    }
    const wireEl = e.button === 0 ? target.closest('[data-wire]') : null
    if (wireEl) {
      const uid = wireEl.getAttribute('data-wire')!
      const sel = store.getState().selection
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
      if (parts.includes(uid)) setDrag({ kind: 'parts', start: toWorld(e), uids: parts, base: store.begin() })
      return
    }
    if (!e.shiftKey) store.select(EMPTY_SELECTION)
    setDrag({ kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
  }
  // With pointer capture the event target is always the svg, so look up what is under the cursor.
  function pinUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]')
    return el ? { part: el.getAttribute('data-pin-part')!, pin: el.getAttribute('data-pin')! } : null
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
    else if (drag?.kind === 'parts') {
      const p = toWorld(e)
      store.preview(moveParts(drag.base, drag.uids, snap(p.x - drag.start.x), snap(p.y - drag.start.y)))
    } else if (drag?.kind === 'wire') setDrag({ ...drag, cursor: toWorld(e), over: pinUnder(e) })
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'parts') store.end()
    if (drag?.kind === 'wire') {
      const to = pinUnder(e)
      const s = store.getState()
      const added = to && addWire(s.diagram, drag.from, to, s.wireStyle)
      if (added) {
        store.commit(added.diagram)
        store.select({ parts: [], wires: [added.uid] })
      }
    }
    setDrag(null)
  }

  useEffect(() => {
    if (drag?.kind !== 'wire') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrag(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag?.kind])

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
        onPointerCancel={() => { if (drag?.kind === 'parts') store.end(); setDrag(null) }}
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
        {diagram.parts.map((p) => {
          const m = diagram.modules[p.module]
          return m ? (
            <g key={p.uid} data-part={p.uid}>
              {selection.parts.includes(p.uid) && (() => {
                const r = bodyRect(p, layoutModule(m))
                return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={6} fill="none" stroke="var(--focus)" strokeWidth={1.5} strokeDasharray="5 4" />
              })()}
              <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={p.designator} />
            </g>
          ) : null
        })}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {wires.map(({ conn, d, blocked }) => {
            const w = wireWidth(conn.gauge)
            const dash = blocked ? '6 5' : undefined
            const selected = selection.wires.includes(conn.uid)
            return (
              <g key={conn.uid} data-wire={conn.uid}>
                {selected && <path d={d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={w + 10} />}
                <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={dash} />
                <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={dash} />
                <path d={d} className="wire-hit" strokeWidth={Math.max(12, w + 8)} />
              </g>
            )
          })}
        </g>
        {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
        {drag?.kind === 'wire' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(store.getState().wireStyle.color)} strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
          />
        )}
        {diagram.parts.flatMap((p) => {
          const m = diagram.modules[p.module]
          if (!m) return []
          return worldPins(p, m).map((wp) => {
            const over = drag?.kind === 'wire' && drag.over?.part === p.uid && drag.over.pin === wp.name
            return (
              <circle
                key={`${p.uid}:${wp.name}`}
                className={over ? 'pin-hit target' : 'pin-hit'}
                data-pin={wp.name}
                data-pin-part={p.uid}
                cx={wp.end.x}
                cy={wp.end.y}
                r={6}
              >
                <title>{`${p.designator} ${wp.label ?? wp.name}`}</title>
              </circle>
            )
          })
        })}
      </svg>
      <div className="zoom-readout" aria-live="polite">{Math.round((view.scale / 1.5) * 100)}%</div>
    </div>
  )
}
