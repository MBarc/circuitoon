// The editing surface: an SVG sheet you can pan (drag the background) and zoom (wheel).
import { useEffect, useMemo, useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { computeRoutes, wireColor, wirePaths, wireWidth, type Routes } from '../format/diagram.ts'
import type { Pt } from '../format/geometry.ts'
import { Part, INK } from '../render/Part.tsx'
import { addPart, EMPTY_SELECTION, moveParts } from './ops.ts'
import { modulesById } from '../library.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { MODULE_MIME } from './LibraryPanel.tsx'
import type { Diagram } from '../format/diagram.ts'

export type View = { x: number; y: number; scale: number }
const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

type Drag =
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; base: Diagram }

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
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
    else if (drag?.kind === 'parts') {
      const p = toWorld(e)
      store.preview(moveParts(drag.base, drag.uids, snap(p.x - drag.start.x), snap(p.y - drag.start.y)))
    }
  }
  function onPointerUp() {
    if (drag?.kind === 'parts') store.end()
    setDrag(null)
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
        onPointerCancel={onPointerUp}
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
            return (
              <g key={conn.uid} data-wire={conn.uid}>
                <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={dash} />
                <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={dash} />
              </g>
            )
          })}
        </g>
        {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
      </svg>
      <div className="zoom-readout" aria-live="polite">{Math.round((view.scale / 1.5) * 100)}%</div>
    </div>
  )
}
