// Smart guides for a drag, as in diagramming tools: while parts, frames or notes move, their bounding box
// snaps to the edges and centres of the other objects, a pin lines up with the pin it is wired to,
// and a gap to a neighbour snaps to match an equal gap in the same row or column. Pure: the canvas
// builds a SnapIndex once when a drag starts, then asks snapMove for every pointer move.
//
// Grid first: every move stays a whole number of 10 px grid steps, so every pin stays on the grid
// (and on breadboard holes). A target an on-grid move cannot reach exactly (a note's ragged right
// edge, a centre half a step off) is never snapped to and never gets a guide: a guide only ever
// shows an alignment that is really there.
import type { Pt, Rect } from '../format/geometry.ts'

export const GRID = 10
/** How close (screen px, at the current zoom) an edge, centre or gap must be to snap. */
export const SNAP_PX = 6
/**
 * How close (screen px) a pin must be to the level of a pin it is wired to. A little wider than
 * SNAP_PX, so it pulls across one grid step at the default zoom: a straight wire is the point.
 */
export const PIN_SNAP_PX = 10

export type Axis = 'x' | 'y'
/** What decided an axis: the grid alone, an edge or centre, a wired pin, or an equal gap. */
export type SnapBy = 'grid' | 'edge' | 'pin' | 'spacing'

/**
 * A guide line. `axis` is the coordinate that lines up: an 'x' guide is a vertical line at x = `at`
 * running from y = `from` to y = `to`; a 'y' guide is horizontal. A pin guide joins the two pins
 * (`ends`, the moving one first).
 */
export interface Guide {
  axis: Axis
  at: number
  from: number
  to: number
  kind: 'edge' | 'pin'
  ends?: [Pt, Pt]
}

/** An equal-spacing marker: the gap from `from` to `to` along `axis`, drawn across at `at`. */
export interface SpacingMark {
  axis: Axis
  from: number
  to: number
  at: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
  gaps: SpacingMark[]
  by: { x: SnapBy; y: SnapBy }
}

/** A dragged pin at drag start (`from`) and the fixed pin it is wired to (`to`). */
export interface PinLink {
  from: Pt
  to: Pt
}

/** One snap target on an axis: its value, and the extent of its object on the other axis. */
interface Edge {
  v: number
  lo: number
  hi: number
}

interface PinDelta {
  d: number
  link: PinLink
}

/** Everything a drag snaps to, sorted once when the drag starts. */
export interface SnapIndex {
  edges: Record<Axis, Edge[]>
  pins: Record<Axis, PinDelta[]>
  links: PinLink[]
  spacers: Rect[]
}

const snapGrid = (v: number) => Math.round(v / GRID) * GRID || 0
const onGrid = (d: number) => Math.abs(d - Math.round(d / GRID) * GRID) < 1e-6
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6

// Axis views of a rectangle: its start and size along `a`, and the other axis.
const start = (r: Rect, a: Axis) => (a === 'x' ? r.x : r.y)
const size = (r: Rect, a: Axis) => (a === 'x' ? r.w : r.h)
const end = (r: Rect, a: Axis) => start(r, a) + size(r, a)
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x')
const shifted = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h })

/** The first index in `arr` (sorted by `key`) whose key is at least `v`. */
function lowerBound<T>(arr: T[], v: number, key: (t: T) => number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) < v - 1e-6) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Sorts the targets of one drag: the edges and centres of `objects` (the bodies of every part
 * and the boxes of every frame and note that stay put), the wired `pins`, and the `spacers` whose
 * gaps count for equal spacing (default: the objects; the canvas leaves frames out, since a frame
 * contains its row rather than standing in it).
 */
export function buildSnapIndex({ objects, spacers, pins = [] }: { objects: Rect[]; spacers?: Rect[]; pins?: PinLink[] }): SnapIndex {
  const edges = (a: Axis): Edge[] => {
    const b = other(a)
    const out: Edge[] = []
    for (const r of objects) {
      const lo = start(r, b)
      const hi = end(r, b)
      out.push({ v: start(r, a), lo, hi }, { v: start(r, a) + size(r, a) / 2, lo, hi }, { v: end(r, a), lo, hi })
    }
    return out.sort((p, q) => p.v - q.v)
  }
  const deltas = (a: Axis): PinDelta[] => pins.map((link) => ({ d: link.to[a] - link.from[a], link })).sort((p, q) => p.d - q.d)
  return { edges: { x: edges('x'), y: edges('y') }, pins: { x: deltas('x'), y: deltas('y') }, links: pins, spacers: spacers ?? objects }
}

/** The grid-only move: what a drag does with snapping off (or Ctrl held). */
export function gridOnly(raw: Pt): SnapResult {
  return { dx: snapGrid(raw.x), dy: snapGrid(raw.y), guides: [], gaps: [], by: { x: 'grid', y: 'grid' } }
}

interface Pick {
  d: number
  dist: number
}
const better = (a: Pick | null, b: Pick | null) => (b && (!a || b.dist < a.dist) ? b : a)

/** The spacers that share a row (axis 'x') or column (axis 'y') with `m`: overlapping it across. */
const rowOf = (spacers: Rect[], m: Rect, a: Axis) => {
  const b = other(a)
  const lo = start(m, b)
  const hi = end(m, b)
  return spacers.filter((s) => start(s, b) < hi && end(s, b) > lo)
}

interface Neighbours {
  row: Rect[]
  before: Rect | null
  after: Rect | null
  /** Each spacer in the row with its nearest spacer after it along the axis, and the gap between. */
  pairs: { a: Rect; b: Rect; gap: number }[]
}

/** The row around `m`, its nearest neighbour on each side, and the gaps between the others. */
function neighbours(spacers: Rect[], m: Rect, a: Axis): Neighbours {
  const row = rowOf(spacers, m, a)
  const mid = start(m, a) + size(m, a) / 2
  let before: Rect | null = null
  let after: Rect | null = null
  for (const s of row) {
    if (end(s, a) <= mid && (!before || end(s, a) > end(before, a))) before = s
    if (start(s, a) >= mid && (!after || start(s, a) < start(after, a))) after = s
  }
  const sorted = [...row].sort((p, q) => start(p, a) - start(q, a))
  const pairs: Neighbours['pairs'] = []
  for (const s of sorted) {
    const i = lowerBound(sorted, end(s, a), (r) => start(r, a))
    const next = sorted[i]
    // The gap the moving object sits in is not a gap between two other objects.
    if (next && next !== s && !(s === before && next === after)) pairs.push({ a: s, b: next, gap: start(next, a) - end(s, a) })
  }
  return { row, before, after, pairs }
}

/** The best equal-spacing move along `a` within `t` of `raw`, for `m` at its drag-start place (already moved across). */
function spacingPick(idx: SnapIndex, m: Rect, a: Axis, raw: number, t: number): Pick | null {
  const moved = a === 'x' ? shifted(m, raw, 0) : shifted(m, 0, raw)
  const { before, after, pairs } = neighbours(idx.spacers, moved, a)
  if (!before && !after) return null
  let best: Pick | null = null
  const consider = (d: number) => {
    const dist = Math.abs(d - raw)
    if (dist <= t && onGrid(d)) best = better(best, { d, dist })
  }
  for (const { gap } of pairs) {
    if (gap <= 0) continue
    if (before) consider(end(before, a) + gap - start(m, a))
    if (after) consider(start(after, a) - gap - end(m, a))
  }
  // Centred between the two neighbours: equal gaps either side.
  if (before && after && start(after, a) - end(before, a) > size(m, a)) consider((end(before, a) + start(after, a)) / 2 - (start(m, a) + size(m, a) / 2))
  return best
}

/** The move along `a` for a drag of `m` whose other axis has already moved by `across`. */
function pickAxis(idx: SnapIndex, m: Rect, a: Axis, raw: number, across: number, t: number, tp: number): { d: number; by: SnapBy } {
  // A wired pin within reach wins outright.
  let pin: Pick | null = null
  const pins = idx.pins[a]
  for (let i = lowerBound(pins, raw - tp, (p) => p.d); i < pins.length && pins[i].d <= raw + tp + 1e-6; i++)
    if (onGrid(pins[i].d)) pin = better(pin, { d: pins[i].d, dist: Math.abs(pins[i].d - raw) })
  if (pin) return { d: pin.d, by: 'pin' }
  // Then the closest edge or centre, or equal gap; an edge wins a tie.
  let edge: Pick | null = null
  const edges = idx.edges[a]
  for (const ref of [start(m, a), start(m, a) + size(m, a) / 2, end(m, a)]) {
    for (let i = lowerBound(edges, ref + raw - t, (e) => e.v); i < edges.length && edges[i].v <= ref + raw + t + 1e-6; i++) {
      const d = edges[i].v - ref
      if (onGrid(d)) edge = better(edge, { d, dist: Math.abs(d - raw) })
    }
  }
  const across2 = a === 'x' ? shifted(m, 0, across) : shifted(m, across, 0)
  const gap = spacingPick(idx, across2, a, raw, t)
  if (edge && (!gap || edge.dist <= gap.dist)) return { d: edge.d, by: 'edge' }
  if (gap) return { d: gap.d, by: 'spacing' }
  return { d: snapGrid(raw), by: 'grid' }
}

/** Guide lines for every edge, centre or wired pin that truly lines up with `m` where it ends up. */
function guidesAt(idx: SnapIndex, m: Rect, dx: number, dy: number): Guide[] {
  const out: Guide[] = []
  for (const a of ['x', 'y'] as const) {
    const b = other(a)
    const edges = idx.edges[a]
    const seen: number[] = []
    for (const v of [start(m, a), start(m, a) + size(m, a) / 2, end(m, a)]) {
      if (seen.some((s) => same(s, v))) continue
      seen.push(v)
      let lo = start(m, b)
      let hi = end(m, b)
      let hit = false
      for (let i = lowerBound(edges, v, (e) => e.v); i < edges.length && same(edges[i].v, v); i++) {
        hit = true
        lo = Math.min(lo, edges[i].lo)
        hi = Math.max(hi, edges[i].hi)
      }
      if (hit) out.push({ axis: a, at: v, from: lo, to: hi, kind: 'edge' })
    }
  }
  for (const { from, to } of idx.links) {
    const p = { x: from.x + dx, y: from.y + dy }
    if (same(p.x, to.x) && same(p.y, to.y)) continue
    for (const a of ['x', 'y'] as const) {
      if (!same(p[a], to[a])) continue
      const b = other(a)
      out.push({ axis: a, at: to[a], from: Math.min(p[b], to[b]), to: Math.max(p[b], to[b]), kind: 'pin', ends: [p, { ...to }] })
    }
  }
  return out
}

/** Equal-spacing markers for `m` where it ends up: a gap to a neighbour that matches another gap in its row. */
function gapsAt(idx: SnapIndex, m: Rect): SpacingMark[] {
  const out: SpacingMark[] = []
  for (const a of ['x', 'y'] as const) {
    const b = other(a)
    const { before, after, pairs } = neighbours(idx.spacers, m, a)
    const mark = (p: Rect, q: Rect) => {
      const at = (Math.max(start(p, b), start(q, b)) + Math.min(end(p, b), end(q, b))) / 2
      const g = { axis: a, from: end(p, a), to: start(q, a), at }
      if (!out.some((o) => o.axis === g.axis && same(o.from, g.from) && same(o.to, g.to) && same(o.at, g.at))) out.push(g)
    }
    const gBefore = before ? start(m, a) - end(before, a) : null
    const gAfter = after ? start(after, a) - end(m, a) : null
    for (const [g, side] of [[gBefore, 'before'], [gAfter, 'after']] as const) {
      if (g === null || g <= 0) continue
      const matches = pairs.filter((p) => same(p.gap, g))
      const both = gBefore !== null && gAfter !== null && same(gBefore, gAfter)
      if (!matches.length && !both) continue
      if (side === 'before') mark(before!, m)
      else mark(m, after!)
      for (const p of matches) mark(p.a, p.b)
    }
  }
  return out
}

/**
 * Where a drag of `moving` (its bounding box at drag start) lands for the pointer's raw move `raw`
 * (world px) at zoom `scale`, and the guides and spacing markers to draw there. Each axis is
 * decided on its own: a wired pin within PIN_SNAP_PX wins, then the closest edge, centre or equal
 * gap within SNAP_PX, else the plain grid. Every result is a whole number of grid steps.
 */
export function snapMove(idx: SnapIndex, moving: Rect, raw: Pt, scale: number): SnapResult {
  const t = SNAP_PX / scale
  const tp = PIN_SNAP_PX / scale
  const y = pickAxis(idx, moving, 'y', raw.y, snapGrid(raw.x), t, tp)
  const x = pickAxis(idx, moving, 'x', raw.x, y.d, t, tp)
  const dx = x.d || 0
  const dy = y.d || 0
  const final = shifted(moving, dx, dy)
  return { dx, dy, guides: guidesAt(idx, final, dx, dy), gaps: gapsAt(idx, final), by: { x: x.by, y: y.by } }
}

/** The bounding box of `rects`, or null when there are none. */
export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
