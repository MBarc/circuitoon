// Hand editing of a wire's polyline: shift a straight run, add a bend, remove a bend. Every
// function is pure, takes the full polyline (pin stub tip to pin stub tip) and returns a new one
// that stays horizontal-or-vertical everywhere. A polyline with a diagonal step (the straight
// fallback drawn for a wire that cannot be routed) comes back unchanged: there is no run to edit. Collinear bends the user added are kept, so a
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

/** True when every step of the polyline is horizontal or vertical. */
export function isOrthogonal(points: Pt[]): boolean {
  for (let i = 1; i < points.length; i++) if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false
  return true
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
 * Length of the stub on a pin whose tip is `p` and whose run leaves along unit `u`: out to the
 * first grid line at least STUB px from the tip, so the bend it ends at is stored on the grid.
 */
function stubLength(p: Pt, u: Pt): number {
  const v = u.x !== 0 ? p.x : p.y
  const s = u.x !== 0 ? u.x : u.y
  const end = s > 0 ? Math.ceil((v + STUB) / GRID) * GRID : Math.floor((v - STUB) / GRID) * GRID
  return (end - v) * s
}

/**
 * Moves segment i (points[i]..points[i + 1]) sideways by `delta` px, snapped to the grid. A
 * neighbor at right angles stretches to follow; a neighbor on the same line (a split run) stays
 * put and a short connector joins them. The first and last segments touch pins, so moving one
 * leaves a stub on the pin, along its original direction, out to the first grid line at least
 * STUB px from the tip (see `stubLength`), and moves the rest; when the stub would take up the
 * whole run, nothing moves.
 */
export function moveSegment(points: Pt[], i: number, delta: number): Pt[] {
  let d = snap(delta)
  const n = points.length - 1
  const unchanged = () => points.map((p) => ({ ...p }))
  if (d === 0 || i < 0 || i >= n || same(points[i], points[i + 1]) || !isOrthogonal(points)) return unchanged()
  const axis = axisOf(points[i], points[i + 1])
  const perpendicular = (j: number) => axisOf(points[j], points[j + 1]) !== axis && !same(points[j], points[j + 1])
  // Moving the run next to a pin's run slides that run's far end along it: never let the pin's
  // run get shorter than the stub (or shorter than it already is, if it is below that).
  const keepStub = (pin: number, next: number) => {
    if (!perpendicular(Math.min(pin, next))) return // a split run: a connector is inserted instead
    const u = unit(points[pin], points[next])
    const along = (points[next].x - points[pin].x) * u.x + (points[next].y - points[pin].y) * u.y
    const sign = axis === 'h' ? u.y : u.x // how d moves points[next] along u
    const change = d * sign
    const min = Math.min(0, stubLength(points[pin], u) - along)
    if (change < min) d = min * sign
  }
  if (i === 1) keepStub(0, 1)
  if (i === n - 2 && n >= 2) keepStub(n, n - 1)
  if (d === 0) return unchanged()
  const shift = (p: Pt): Pt => (axis === 'h' ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y })

  let head: Pt[]
  let start: Pt
  // The stub on a pin, or null when it would reach (or pass) the far end of the pin's run.
  const stubOf = (pin: number, next: number): Pt | null => {
    const u = unit(points[pin], points[next])
    const l = stubLength(points[pin], u)
    return l < len(points[pin], points[next]) ? { x: points[pin].x + u.x * l, y: points[pin].y + u.y * l } : null
  }
  if (i === 0) {
    const stub = stubOf(0, 1)
    if (!stub) return unchanged()
    head = [points[0], stub]
    start = shift(stub)
  } else {
    head = points.slice(0, perpendicular(i - 1) ? i : i + 1)
    start = shift(points[i])
  }
  let tail: Pt[]
  let end: Pt
  if (i + 1 === n) {
    const stub = stubOf(n, n - 1)
    if (!stub) return unchanged()
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
  if (!isOrthogonal(points)) return points.map((p) => ({ ...p }))
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

/** Unit direction the wire leaves its first point (or, with `last`, its final point). */
function endDir(points: Pt[], last: boolean): Pt | null {
  const segs = segmentsOf(points)
  const s = last ? segs[segs.length - 1] : segs[0]
  if (!s) return null
  return last ? unit(s.b, s.a) : unit(s.a, s.b)
}
/** True when the wire now leaves a pin straight back the way it used to come out (over the part). */
function reversed(before: Pt | null, after: Pt | null): boolean {
  return !!before && !!after && before.x * after.x + before.y * after.y < 0
}

/**
 * Removes interior vertex k. When its neighbors no longer line up, one corner joins them: the
 * opposite corner of the pair, so the bend flips across. Bends that end up straight because of the
 * removal are merged away; collinear bends the user placed elsewhere are kept. Refused (the
 * polyline comes back unchanged) for an endpoint, or when the result would leave a pin in the
 * opposite direction (back over the part); leaving it sideways is allowed.
 */
export function removeBend(points: Pt[], k: number): Pt[] {
  const copy = points.map((p) => ({ ...p }))
  if (k <= 0 || k >= points.length - 1 || !isOrthogonal(points)) return copy
  const a = points[k - 1]
  const q = points[k]
  const b = points[k + 1]
  const mid: Pt[] = []
  if (a.x !== b.x && a.y !== b.y) {
    // Orthogonal steps a..q..b that do not line up make q one corner of their box; use the other.
    const c1 = { x: b.x, y: a.y } // a..c runs horizontally
    mid.push(same(c1, q) ? { x: a.x, y: b.y } : c1)
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
  if (reversed(endDir(points, false), endDir(out, false)) || reversed(endDir(points, true), endDir(out, true))) return copy
  return out
}

/** The bends between the two pin stub tips, as stored in `Connection.route`. */
export function toRoute(points: Pt[]): [number, number][] {
  return points.slice(1, -1).map((p) => [p.x, p.y])
}

/**
 * True when any segment passes through the inside of a part body (running along its edge is
 * fine), or is diagonal (a hand-shaped wire should never have one, so it is drawn as blocked).
 */
export function manualRouteBlocked(points: Pt[], obstacles: Rect[]): boolean {
  if (!isOrthogonal(points)) return true
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

/** Largest sideways nudge the renderer's lane separation applies (see `separate` in diagram.ts). */
const MAX_NUDGE = 8

/**
 * Where to draw a routed segment's handle: its midpoint, moved onto the drawn wire where the
 * renderer nudged that run a few px clear of another wire. `drawn` is the wire's drawn polyline;
 * the nearest drawn segment on the same axis, within MAX_NUDGE, that spans the midpoint wins.
 */
export function segmentHandleAt(seg: Segment, drawn: Pt[]): Pt {
  const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 }
  const h = seg.axis === 'h'
  let best: number | null = null
  for (const s of segmentsOf(drawn)) {
    if (s.axis !== seg.axis) continue
    const fixed = h ? s.a.y : s.a.x
    const offset = Math.abs(fixed - (h ? mid.y : mid.x))
    const along = h ? mid.x : mid.y
    const lo = h ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y)
    const hi = h ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y)
    if (offset > MAX_NUDGE || along < lo || along > hi) continue
    if (best === null || offset < Math.abs(best - (h ? mid.y : mid.x))) best = fixed
  }
  if (best === null) return mid
  return h ? { x: mid.x, y: best } : { x: best, y: mid.y }
}

/**
 * Where to draw a bend's handle: on the drawn wire where the renderer nudged it a few px clear of
 * another wire. The nearest drawn corner within MAX_NUDGE on both axes wins; failing that (a
 * collinear bend, which the drawn wire has no corner for), the bend moves straight across onto a
 * drawn run within MAX_NUDGE that passes it.
 */
export function bendHandleAt(bend: Pt, drawn: Pt[]): Pt {
  let best: Pt | null = null
  for (const p of drawn) {
    if (Math.abs(p.x - bend.x) > MAX_NUDGE || Math.abs(p.y - bend.y) > MAX_NUDGE) continue
    if (!best || len(p, bend) < len(best, bend)) best = p
  }
  if (best) return { x: best.x, y: best.y }
  for (const s of segmentsOf(drawn)) {
    const h = s.axis === 'h'
    const offset = Math.abs(h ? s.a.y - bend.y : s.a.x - bend.x)
    const along = h ? bend.x : bend.y
    const lo = h ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y)
    const hi = h ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y)
    if (offset > MAX_NUDGE || along < lo || along > hi) continue
    const p = h ? { x: bend.x, y: s.a.y } : { x: s.a.x, y: bend.y }
    if (!best || len(p, bend) < len(best, bend)) best = p
  }
  return best ?? { x: bend.x, y: bend.y }
}
