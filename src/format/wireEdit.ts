// Hand editing of a wire's polyline: shift a straight run, add a bend, remove a bend. Every
// function is pure, takes the full polyline (pin stub tip to pin stub tip) and returns a new one
// that stays horizontal-or-vertical everywhere. Collinear bends the user added are kept, so a
// straight run can be split and its halves moved on their own.
import { GRID } from './module.ts'
import type { Pt, Rect } from './geometry.ts'

export type Axis = 'h' | 'v'
export interface Segment {
  /** Index of the segment's first point in the polyline; the segment runs from points[i] to points[i + 1]. */
  i: number
  a: Pt
  b: Pt
  axis: Axis
}

/** Shortest stub, in px, kept attached to a pin when the run touching it is moved. */
const STUB = 10

const snap = (v: number) => Math.round(v / GRID) * GRID + 0
const same = (p: Pt, q: Pt) => p.x === q.x && p.y === q.y
const key = (p: Pt) => `${p.x},${p.y}`
const axisOf = (a: Pt, b: Pt): Axis => (a.y === b.y ? 'h' : a.x === b.x ? 'v' : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'h' : 'v')
const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)

/** True when q sits on the straight line r..p, strictly between them (a bend the wire runs straight through). */
function straight(r: Pt, q: Pt, p: Pt): boolean {
  if (r.x === q.x && q.x === p.x) return (q.y - r.y) * (p.y - q.y) > 0
  if (r.y === q.y && q.y === p.y) return (q.x - r.x) * (p.x - q.x) > 0
  return false
}
/** True when q is on the line r..p but the wire folds back at it (a spike). */
function spike(r: Pt, q: Pt, p: Pt): boolean {
  return ((r.x === q.x && q.x === p.x) || (r.y === q.y && q.y === p.y)) && !straight(r, q, p)
}

/** Every non-zero-length segment of a polyline, with its axis. */
export function segmentsOf(points: Pt[]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!same(a, b)) out.push({ i, a, b, axis: axisOf(a, b) })
  }
  return out
}

/**
 * Drops repeated points and spikes (a point the wire runs out to and straight back from). Unlike
 * `simplify`, a collinear bend the wire runs straight through is kept.
 */
export function tidy(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    if (out.length && same(out[out.length - 1], p)) continue
    while (out.length >= 2 && spike(out[out.length - 2], out[out.length - 1], p)) out.pop()
    if (out.length && same(out[out.length - 1], p)) continue
    out.push({ x: p.x, y: p.y })
  }
  return out
}

/** Unit vector (on one axis) from a toward b. */
function unit(a: Pt, b: Pt): Pt {
  return axisOf(a, b) === 'h' ? { x: Math.sign(b.x - a.x), y: 0 } : { x: 0, y: Math.sign(b.y - a.y) }
}

/**
 * Moves segment i (points[i]..points[i + 1]) sideways by `delta` px, snapped to the grid. A
 * neighbor at right angles stretches to follow; a neighbor on the same line (a split run) stays
 * put and a short connector joins them. The first and last segments touch pins, so moving one
 * leaves a stub of STUB px on the pin, along its original direction, and moves the rest.
 */
export function moveSegment(points: Pt[], i: number, delta: number): Pt[] {
  const d = snap(delta)
  const n = points.length - 1
  if (d === 0 || i < 0 || i >= n || same(points[i], points[i + 1])) return points.map((p) => ({ ...p }))
  const axis = axisOf(points[i], points[i + 1])
  const shift = (p: Pt): Pt => (axis === 'h' ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y })
  const perpendicular = (j: number) => axisOf(points[j], points[j + 1]) !== axis && !same(points[j], points[j + 1])

  let head: Pt[]
  let start: Pt
  if (i === 0) {
    const u = unit(points[0], points[1])
    const stub = { x: points[0].x + u.x * STUB, y: points[0].y + u.y * STUB }
    head = [points[0], stub]
    start = shift(stub)
  } else {
    head = points.slice(0, perpendicular(i - 1) ? i : i + 1)
    start = shift(points[i])
  }
  let tail: Pt[]
  let end: Pt
  if (i + 1 === n) {
    const u = unit(points[n], points[n - 1])
    const stub = { x: points[n].x + u.x * STUB, y: points[n].y + u.y * STUB }
    tail = [stub, points[n]]
    end = shift(stub)
  } else {
    tail = points.slice(perpendicular(i + 1) ? i + 2 : i + 1)
    end = shift(points[i + 1])
  }
  return tidy([...head, start, end, ...tail])
}

/** Adds a vertex where `at`, projected onto the nearest segment and snapped to the grid, lands. */
export function insertBend(points: Pt[], at: Pt): Pt[] {
  let best: { i: number; p: Pt; dist: number } | null = null
  for (const s of segmentsOf(points)) {
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi))
    const p = s.axis === 'h' ? { x: clamp(at.x, s.a.x, s.b.x), y: s.a.y } : { x: s.a.x, y: clamp(at.y, s.a.y, s.b.y) }
    const dist = len(p, at)
    if (!best || dist < best.dist) best = { i: s.i, p, dist }
  }
  const copy = points.map((p) => ({ ...p }))
  if (!best) return copy
  const a = points[best.i]
  const b = points[best.i + 1]
  const along = axisOf(a, b) === 'h'
  const lo = along ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
  const hi = along ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
  const v = Math.min(hi, Math.max(lo, snap(along ? best.p.x : best.p.y)))
  const p = along ? { x: v, y: a.y } : { x: a.x, y: v }
  if (same(p, a) || same(p, b)) return copy
  copy.splice(best.i + 1, 0, p)
  return copy
}

/** Axis of the first (or, with `last`, final) non-zero segment. */
function endAxis(points: Pt[], last: boolean): Axis | null {
  const segs = segmentsOf(points)
  const s = last ? segs[segs.length - 1] : segs[0]
  return s ? s.axis : null
}

/**
 * Removes interior vertex k. When its neighbors no longer line up, one corner joins them: in an
 * orthogonal wire that is the opposite corner of the pair (so the bend flips across), otherwise
 * the corner that keeps the longer neighbor's axis. Bends that end up straight because of the
 * removal are merged away; collinear bends the user placed elsewhere are kept. Refused (the
 * polyline comes back unchanged) for an endpoint, or when the result would leave a pin sideways.
 */
export function removeBend(points: Pt[], k: number): Pt[] {
  const copy = points.map((p) => ({ ...p }))
  if (k <= 0 || k >= points.length - 1) return copy
  const a = points[k - 1]
  const q = points[k]
  const b = points[k + 1]
  const mid: Pt[] = []
  if (a.x !== b.x && a.y !== b.y) {
    const c1 = { x: b.x, y: a.y } // a..c runs horizontally
    const c2 = { x: a.x, y: b.y } // a..c runs vertically
    if (same(c1, q)) mid.push(c2)
    else if (same(c2, q)) mid.push(c1)
    else {
      const aLonger = len(a, q) >= len(q, b)
      const keep = aLonger ? axisOf(a, q) : axisOf(q, b)
      // Keep a..c on the longer axis when a's side is longer, else c..b.
      mid.push(aLonger ? (keep === 'h' ? c1 : c2) : keep === 'h' ? c2 : c1)
    }
  }
  const userStraight = new Set<string>()
  for (let j = 1; j < points.length - 1; j++) if (straight(points[j - 1], points[j], points[j + 1])) userStraight.add(key(points[j]))

  let out = tidy([...points.slice(0, k), ...mid, ...points.slice(k + 1)])
  // Merge bends this removal left straight, keeping the ones that were already straight.
  for (let j = 1; j < out.length - 1; ) {
    if (straight(out[j - 1], out[j], out[j + 1]) && !userStraight.has(key(out[j]))) out.splice(j, 1)
    else j++
  }
  out = tidy(out)
  if (endAxis(out, false) !== endAxis(points, false) || endAxis(out, true) !== endAxis(points, true)) return copy
  return out
}

/** The bends between the two pin stub tips, as stored in `Connection.route`. */
export function toRoute(points: Pt[]): [number, number][] {
  return points.slice(1, -1).map((p) => [p.x, p.y])
}

/** True when any segment passes through the inside of a part body (running along its edge is fine). */
export function manualRouteBlocked(points: Pt[], obstacles: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    for (const r of obstacles) {
      if (a.y === b.y) {
        if (a.y > r.y && a.y < r.y + r.h && Math.min(Math.max(a.x, b.x), r.x + r.w) - Math.max(Math.min(a.x, b.x), r.x) > 0) return true
      } else if (a.x === b.x) {
        if (a.x > r.x && a.x < r.x + r.w && Math.min(Math.max(a.y, b.y), r.y + r.h) - Math.max(Math.min(a.y, b.y), r.y) > 0) return true
      }
    }
  }
  return false
}
