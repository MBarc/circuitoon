// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.

import { type ModuleDef, PARAM_RULES, layoutModule, validateModule, validParamValue, isObj, isNum } from './module.ts'
import { type Pt, type Rect, type Rotation, type WorldPin, bodyRect, simplify, worldPins } from './geometry.ts'
import { addToOccupancy, Occupancy, routeOrthogonal } from './router.ts'
import { manualRouteBlocked, tidy } from './wireEdit.ts'

/** How every load warning about a dropped value override ends: the part now shows its module
 * default instead of the value the file asked for. The editor lists these warnings first. */
export const VALUE_DROPPED = 'it was dropped and the module default is shown'

export const DIAGRAM_FORMAT = 'circuitoon-diagram/1'

export interface PartInstance {
  uid: string
  designator: string
  module: string
  x: number
  y: number
  rotation?: Rotation
  values?: Record<string, unknown>
}
export interface Endpoint {
  part: string
  pin: string
  offset?: number
}
export interface Connection {
  uid: string
  from: Endpoint
  to: Endpoint
  color?: string
  gauge?: number
  label?: string
  route?: [number, number][]
}
export interface Annotation {
  uid: string
  type: 'frame' | 'text'
  x: number
  y: number
  w?: number
  h?: number
  label?: string
  text?: string
}
export interface Diagram {
  format: typeof DIAGRAM_FORMAT
  title: string
  modules: Record<string, ModuleDef>
  parts: PartInstance[]
  connections: Connection[]
  annotations?: Annotation[]
}

export const NAMED_COLORS: Record<string, string> = {
  red: '#E0483E',
  black: '#2B2F36',
  blue: '#3D6FD6',
  green: '#2F9E6E',
  yellow: '#F4B400',
  orange: '#F48C06',
  white: '#FFFFFF',
  purple: '#8E5BD6',
  gray: '#9AA2AD',
  brown: '#8B5A2B',
  pink: '#F07AB0',
}

/** Named color or #RRGGBB; anything else falls back to black. */
export function wireColor(c: string | undefined): string {
  if (!c) return NAMED_COLORS.black
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  const key = c.toLowerCase()
  return Object.hasOwn(NAMED_COLORS, key) ? NAMED_COLORS[key] : NAMED_COLORS.black
}

/** Drawn width in px for an AWG gauge (16 to 30, default 22). Thicker wire, smaller number. */
export function wireWidth(gauge = 22): number {
  const g = Math.min(30, Math.max(16, gauge))
  return Math.max(1.5, 3 * Math.pow(1.1229, 22 - g))
}

export interface WireRoute {
  points: Pt[]
  /** True when no clear route exists and the wire is drawn as a straight fallback. */
  blocked: boolean
}
/** Route per connection uid; null means an endpoint names a missing part or pin. */
export type Routes = Map<string, WireRoute | null>

/**
 * The embedded module a part uses. Own keys only, so a module named "constructor" or
 * "toString" in a file is simply missing rather than an Object prototype member.
 */
export function moduleOf(d: Pick<Diagram, 'modules'>, id: string): ModuleDef | undefined {
  return Object.hasOwn(d.modules, id) ? d.modules[id] : undefined
}

export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    return m ? [bodyRect(p, layoutModule(m))] : []
  })
}

function endpoint(d: Diagram, ep: Endpoint) {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && moduleOf(d, part.module)
  return (part && mod && worldPins(part, mod).find((p) => p.name === ep.pin)) || null
}

/**
 * A hand-routed wire keeps its stored bends; only its end segments stretch to reach a moved
 * pin. Where a pin tip and its neighbouring bend no longer line up, a corner is added so the
 * wire still leaves the pin along its stub, and every segment stays horizontal or vertical.
 * Collinear bends are kept (the user may have split a run to move its halves separately), so
 * this polyline is also what the editing handles work on; only spikes and repeats are dropped.
 */
function manualPoints(a: WorldPin, b: WorldPin, route: [number, number][]): Pt[] {
  const bends = route.map(([x, y]) => ({ x, y }))
  const corner = (pin: WorldPin, next: Pt | undefined): Pt[] => {
    if (!next || next.x === pin.end.x || next.y === pin.end.y) return []
    return [pin.dir.x !== 0 ? { x: next.x, y: pin.end.y } : { x: pin.end.x, y: next.y }]
  }
  // No bends left (every one removed by hand): still one corner, never a diagonal.
  const head = corner(a, bends.length ? bends[0] : b.end)
  const tail = bends.length ? corner(b, bends[bends.length - 1]) : []
  return tidy([a.end, ...head, ...bends, ...tail, b.end])
}

export function routeWire(d: Diagram, c: Connection, obstacles: Rect[], occupied?: Occupancy): WireRoute | null {
  const a = endpoint(d, c.from)
  const b = endpoint(d, c.to)
  if (!a || !b) return null
  if (c.route) {
    const points = manualPoints(a, b, c.route)
    return { points, blocked: manualRouteBlocked(points, obstacles) }
  }
  const points = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles, occupied })
  return points ? { points, blocked: false } : { points: [a.end, b.end], blocked: true }
}

/**
 * Routes every connection in file order, feeding each auto route the grid lanes every earlier
 * route (auto or manual) already used, so a wire whose shortest path would run alongside an
 * earlier one takes its own lane instead. With `only`, connections outside the set keep their
 * route from `prev` (used while dragging so only the moving part's or reshaped wire's routes are
 * recomputed each frame); those kept routes still seed the lanes the `only` routes see.
 * `occupancy: false` routes every wire as if it were alone on the sheet (no lanes), which is much
 * cheaper; the editor uses it for the wires it re-routes on each drag frame, and the full route
 * on drop applies lanes again.
 */
export function computeRoutes(d: Diagram, opts: { only?: Set<string>; prev?: Routes; occupancy?: boolean } = {}): Routes {
  const obstacles = partObstacles(d)
  const out: Routes = new Map()
  const occupied = opts.occupancy === false ? undefined : new Occupancy()
  for (const c of d.connections) {
    if (opts.only && !opts.only.has(c.uid) && opts.prev?.has(c.uid)) {
      const kept = opts.prev.get(c.uid)!
      out.set(c.uid, kept)
      if (kept && occupied) addToOccupancy(occupied, kept.points)
    }
  }
  for (const c of d.connections) {
    if (out.has(c.uid)) continue
    const route = routeWire(d, c, obstacles, occupied)
    out.set(c.uid, route)
    if (route && occupied) addToOccupancy(occupied, route.points)
  }
  return out
}

/**
 * A key that changes exactly when some wire's routing inputs change: its uid, both endpoints and
 * its stored route. Serialized as structured tuples, so no two different sets of endpoints share a
 * key however their names are spelled (part "p.a" pin "R" and part "p" pin "a.R" differ).
 */
export function routingKey(connections: Connection[]): string {
  return JSON.stringify(connections.map((c) => [c.uid, c.from.part, c.from.pin, c.to.part, c.to.pin, c.route ?? null]))
}

const HOP = 5

/**
 * Groups sorted crossing positions into bridges: crossings closer together than a hop's width
 * (2 * HOP) share one bridge, so arcs never overlap or join with a line running backward.
 * Returns each bridge's first and last crossing, in the order given.
 */
function bridges(hits: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && Math.abs(h - last[1]) < 2 * HOP) last[1] = h
    else out.push([h, h])
  }
  return out
}

/** Axis-aligned segments of drawn wires, kept sorted by their fixed coordinate. */
type Seg = { at: number; lo: number; hi: number }

/** Index of the first segment whose `at` is greater than `v`. */
function upper(segs: Seg[], v: number): number {
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].at <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Positions along a segment (spanning `from..to` at cross coordinate `c`) where it crosses a
 * perpendicular segment in `segs`, at least HOP away from either end so the arc fits.
 */
function crossings(segs: Seg[], from: number, to: number, c: number): number[] {
  const hits: number[] = []
  const min = Math.min(from, to)
  const max = Math.max(from, to)
  for (let i = upper(segs, min + HOP); i < segs.length && segs[i].at < max - HOP; i++) {
    const o = segs[i]
    if (c > o.lo && c < o.hi) hits.push(o.at)
  }
  return hits
}

function insert(segs: Seg[], seg: Seg) {
  segs.splice(upper(segs, seg.at), 0, seg)
}

/** True when a segment at cross-coordinate `at` spanning `lo..hi` overlaps an indexed one. */
function overlapsAt(segs: Seg[], at: number, lo: number, hi: number): boolean {
  let i = upper(segs, at)
  while (i > 0 && segs[i - 1].at === at) {
    i--
    if (Math.min(hi, segs[i].hi) - Math.max(lo, segs[i].lo) > 0) return true
  }
  return false
}

/** Perpendicular nudges tried, in order, until one clears the earlier wire (or the last allowed one is used regardless). */
const NUDGES = [4, -4, 8, -8]
const MAX_NUDGE = 8

/** Bucket size, in px, of the part-body index separation checks nudges against. */
const BUCKET = 160
/** A query or body covering more buckets than this just scans every body instead. */
const MAX_BUCKETS = 256

/**
 * Part bodies bucketed on a coarse grid, so checking a nudge against the bodies near one segment
 * does not scan every part on the sheet.
 */
class ObstacleIndex {
  private buckets = new Map<number, Rect[]>()
  private wide: Rect[] = []
  readonly all: Rect[]
  constructor(rects: Rect[]) {
    this.all = rects
    for (const r of rects) {
      const [c0, r0, c1, r1] = this.span(r.x, r.y, r.x + r.w, r.y + r.h)
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_BUCKETS) {
        this.wide.push(r)
        continue
      }
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const k = cx * 1_000_003 + cy
          const list = this.buckets.get(k)
          if (list) list.push(r)
          else this.buckets.set(k, [r])
        }
    }
  }
  private span(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    return [Math.floor(x0 / BUCKET), Math.floor(y0 / BUCKET), Math.floor(x1 / BUCKET), Math.floor(y1 / BUCKET)]
  }
  /** Bodies overlapping the box x0..x1, y0..y1 (each once). */
  near(x0: number, y0: number, x1: number, y1: number): Rect[] {
    const hit = (r: Rect) => r.x <= x1 && r.x + r.w >= x0 && r.y <= y1 && r.y + r.h >= y0
    const [c0, r0, c1, r1] = this.span(x0, y0, x1, y1)
    if (!((c1 - c0 + 1) * (r1 - r0 + 1) <= MAX_BUCKETS)) return this.all.filter(hit)
    const out = new Set<Rect>()
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) for (const r of this.buckets.get(cx * 1_000_003 + cy) ?? []) if (hit(r)) out.add(r)
    for (const r of this.wide) if (hit(r)) out.add(r)
    return [...out]
  }
}
/** Shortest the run on a pin may be left by a nudge (unless it was already shorter). */
const MIN_PIN_RUN = 2

/**
 * Nudges each interior segment (every segment but the first and last, which attach to pins and
 * never move) sideways when it runs along the same grid line as an already-drawn wire's segment,
 * so both stay visible even where the router itself left them sharing a lane (a manual route, or
 * an obstacle that forces two auto routes together). Moving a segment moves both its endpoints,
 * so the segments on either side of it stretch to keep up rather than detach from it. A nudge
 * that would turn the run on a pin back over the pin, leave it shorter than MIN_PIN_RUN px, or put
 * the moved segment or either stretched neighbour inside a part body (where it was clear before)
 * is skipped; when no nudge is allowed the segment stays where it is. Every segment a nudge
 * moves or stretches is checked at that point, so a wire clear before separation is still clear
 * after it. `forced` reports a nudge applied where the geometry was already blocked.
 */
function separate(points: Pt[], verticals: Seg[], horizontals: Seg[], index: ObstacleIndex): { pts: Pt[]; forced: boolean } {
  const pts = points.map((p) => ({ ...p }))
  let forced = false
  for (let k = 2; k <= pts.length - 2; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    const horiz = a.y === b.y
    if (!horiz && a.x !== b.x) continue // not axis-aligned, so not a lane to share; leave it
    const segs = horiz ? horizontals : verticals
    const at = horiz ? a.y : a.x
    const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
    const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
    if (!overlapsAt(segs, at, lo, hi)) continue
    // The runs on the pins, when this segment touches one: pts[0]..a, and b..pts[last].
    const pinRuns: Pt[] = []
    if (k === 2) pinRuns.push(pts[0])
    if (k === pts.length - 2) pinRuns.push(pts[pts.length - 1])
    // The moved segment and the two it stretches, before and after a nudge.
    const local = (moved: number): Pt[] => {
      const shift = (p: Pt): Pt => (horiz ? { x: p.x, y: moved } : { x: moved, y: p.y })
      return [pts[k - 2], shift(a), shift(b), pts[k + 1]]
    }
    const before = local(at)
    const xs = before.map((p) => p.x)
    const ys = before.map((p) => p.y)
    const bodies = index.near(Math.min(...xs) - MAX_NUDGE, Math.min(...ys) - MAX_NUDGE, Math.max(...xs) + MAX_NUDGE, Math.max(...ys) + MAX_NUDGE)
    const wasBlocked = bodies.length > 0 && manualRouteBlocked(before, bodies)
    const allowed = (moved: number) =>
      pinRuns.every((tip) => {
        const before = at - (horiz ? tip.y : tip.x)
        const after = (moved - (horiz ? tip.y : tip.x)) * Math.sign(before)
        return after >= Math.min(MIN_PIN_RUN, Math.abs(before))
      }) && (wasBlocked || bodies.length === 0 || !manualRouteBlocked(local(moved), bodies))
    let pick: number | null = null
    for (const nudge of NUDGES) {
      const moved = at + nudge
      if (!allowed(moved)) continue
      pick = moved
      if (!overlapsAt(segs, moved, lo, hi)) break
    }
    if (pick !== null) {
      if (horiz) { a.y = pick; b.y = pick } else { a.x = pick; b.x = pick }
      if (wasBlocked) forced = true
    }
  }
  return { pts, forced }
}

/**
 * SVG path data for each routed wire. Where a wire crosses a wire earlier in the file, the
 * later one gets a small hop arc, as in hand-drawn wiring sheets. Earlier wires' segments are
 * indexed by position, so each new segment only checks the ones in its span. An interior segment
 * that would otherwise run right on top of an earlier wire is nudged 4 px clear first (see
 * `separate`), so the hop and label-anchor geometry below is already the drawn, separated shape.
 */
export function wirePaths(d: Diagram, routes: Routes = computeRoutes(d)) {
  const index = new ObstacleIndex(partObstacles(d))
  const verticals: Seg[] = [] // at = x, lo..hi = y range
  const horizontals: Seg[] = [] // at = y, lo..hi = x range
  const out: { conn: Connection; d: string; points: Pt[]; ends: Pt[]; blocked: boolean }[] = []
  for (const conn of d.connections) {
    const route = routes.get(conn.uid)
    if (!route) continue
    // Drawn geometry drops collinear bends: nudging one half of a split run would otherwise
    // pull the other half into a diagonal.
    const simple = simplify(route.points)
    const { pts, forced } = separate(simple, verticals, horizontals, index)
    let path = `M${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      const horiz = s.y === e.y
      const vert = s.x === e.x
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const hits = horiz === vert ? [] : horiz ? crossings(verticals, s.x, e.x, s.y) : crossings(horizontals, s.y, e.y, s.x)
      hits.sort((p, q) => (p - q) * dir)
      for (const [first, last] of bridges(hits)) {
        const sweep = dir > 0 ? 1 : 0
        // One arc HOP high over the whole group; its half-width stretches to span every crossing.
        const rx = HOP + Math.abs(last - first) / 2
        const start = first - HOP * dir
        const end = last + HOP * dir
        if (horiz) path += ` L${start} ${s.y} A${rx} ${HOP} 0 0 ${sweep} ${end} ${s.y}`
        else path += ` L${s.x} ${start} A${HOP} ${rx} 0 0 ${sweep} ${s.x} ${end}`
      }
      path += ` L${e.x} ${e.y}`
    }
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      if (s.x === e.x) insert(verticals, { at: s.x, lo: Math.min(s.y, e.y), hi: Math.max(s.y, e.y) })
      if (s.y === e.y) insert(horizontals, { at: s.y, lo: Math.min(s.x, e.x), hi: Math.max(s.x, e.x) })
    }
    // Blocked describes what is drawn. Separation keeps a clear wire clear (see `separate`), so
    // the drawn geometry only needs checking again when the wire started out blocked or a nudge
    // was forced through a body.
    const moved = pts.some((p, i) => p.x !== simple[i].x || p.y !== simple[i].y)
    const blocked = moved && (route.blocked || forced) ? manualRouteBlocked(pts, index.all) : route.blocked
    out.push({ conn, d: path, points: pts, ends: [pts[0], pts[pts.length - 1]], blocked })
  }
  return out
}

/**
 * Midpoint of a routed wire's longest straight run, for placing its name tag. Ties keep the
 * first longest segment found. Null for a route with fewer than two points (nothing to anchor to).
 */
export function labelAnchor(route: Pt[]): { x: number; y: number; horizontal: boolean } | null {
  const points = simplify(route) // a run split by a collinear bend is still one run
  if (points.length < 2) return null
  let best = { i: 1, len: -1 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) // segments are axis-aligned, so Manhattan length is true length
    if (len > best.len) best = { i, len }
  }
  const a = points[best.i - 1]
  const b = points[best.i]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: a.y === b.y }
}

export function isValidColor(c: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(c) || Object.hasOwn(NAMED_COLORS, c.toLowerCase())
}

export type DiagramResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; errors: string[] }

/** Largest |x| or |y|, in px, a part position or a stored route point may have. */
export const COORD_LIMIT = 100_000
/** Most points a stored route may have. */
export const ROUTE_POINT_LIMIT = 200

/**
 * Checks a parsed diagram file. Structural problems refuse the load (errors); a connection
 * that names a missing part or pin still loads (warning), so no wire is silently dropped.
 */
export function validateDiagram(raw: unknown): DiagramResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['diagram must be a JSON object'] }

  if (raw.format === undefined) errors.push(`format: missing (expected "${DIAGRAM_FORMAT}")`)
  else if (raw.format !== DIAGRAM_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${DIAGRAM_FORMAT}")`)
  if (typeof raw.title !== 'string') errors.push('title: required')

  // A Map, so keys such as "__proto__" or "constructor" are ordinary names.
  const modules = new Map<string, ModuleDef>()
  if (!isObj(raw.modules)) errors.push('modules: required, an object of embedded modules')
  else
    for (const [key, m] of Object.entries(raw.modules)) {
      const r = validateModule(m)
      if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`))
      else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`)
      else modules.set(key, r.module)
    }

  const uids = new Set<string>()
  const claim = (uid: unknown, at: string) => {
    if (typeof uid !== 'string' || uid === '') errors.push(`${at}.uid: required`)
    else if (uids.has(uid)) errors.push(`${at}.uid: duplicate "${uid}"`)
    else uids.add(uid)
  }

  // Fixes applied to a loadable file (a clamped position, a dropped route), by list index. The
  // input is never mutated; the returned diagram carries fixed copies of just those entries.
  const partFixes = new Map<number, Partial<PartInstance>>()
  const fix = (i: number, patch: Partial<PartInstance>) => partFixes.set(i, { ...partFixes.get(i), ...patch })
  const droppedRoutes = new Set<number>()

  const partModule = new Map<string, string>()
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  else
    raw.parts.forEach((p, i) => {
      const at = `parts[${i}]`
      if (!isObj(p)) return void errors.push(`${at}: must be an object`)
      claim(p.uid, at)
      if (typeof p.designator !== 'string') errors.push(`${at}.designator: required`)
      if (typeof p.module !== 'string') errors.push(`${at}.module: required`)
      else {
        if (typeof p.uid === 'string') partModule.set(p.uid, p.module)
        if (!modules.has(p.module)) warnings.push(`${at}: module "${p.module}" is not embedded in this file`)
      }
      if (!isNum(p.x) || !isNum(p.y)) errors.push(`${at}: x and y must be numbers`)
      else if (Math.abs(p.x) > COORD_LIMIT || Math.abs(p.y) > COORD_LIMIT) {
        const clamp = (v: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, v))
        fix(i, { x: clamp(p.x), y: clamp(p.y) })
        warnings.push(`${at}: position (${p.x}, ${p.y}) is beyond +-${COORD_LIMIT}, so it was clamped to (${clamp(p.x)}, ${clamp(p.y)})`)
      }
      if (p.rotation !== undefined && ![0, 90, 180, 270].includes(p.rotation as number))
        errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
      if (p.values !== undefined) {
        if (!isObj(p.values)) errors.push(`${at}.values: must be an object`)
        else {
          const who = typeof p.designator === 'string' && p.designator !== '' ? p.designator : `part ${i}`
          const dropped: string[] = []
          for (const [key, entry] of Object.entries(p.values)) {
            // An override of an editable value param (resistance, capacitance, voltage) that is
            // malformed, in the wrong unit or out of range is dropped with a warning, so the
            // module default is shown and the user is told, rather than a different value being
            // substituted silently.
            if (Object.hasOwn(PARAM_RULES, key)) {
              const rule = PARAM_RULES[key]
              const where = `${at}.values.${key}: ${who} has ${key}`
              const problem =
                !(isObj(entry) && isNum(entry.value) && typeof entry.unit === 'string') ? `${where} ${JSON.stringify(entry)}, which is not a number with a unit`
                : entry.unit !== rule.unit ? `${where} ${entry.value} ${entry.unit}, but ${key} must be in ${rule.unit}`
                : !validParamValue(key, entry.value) ? `${where} ${entry.value} ${entry.unit}, but ${key} must be ${rule.range}`
                : null
              if (problem) {
                dropped.push(key)
                warnings.push(`${problem}; ${VALUE_DROPPED}`)
              }
              continue
            }
            // Any other entry that looks like a number-with-unit (has a "value" key) is checked
            // for shape. Other part state (an LED's color, a switch's default) is opaque.
            if (isObj(entry) && 'value' in entry && !(isNum(entry.value) && typeof entry.unit === 'string'))
              warnings.push(`${at}.values.${key}: value must be a finite number with a string unit`)
          }
          if (dropped.length) {
            const values = p.values
            fix(i, { values: Object.fromEntries(Object.entries(values).filter(([k]) => !dropped.includes(k))) })
          }
        }
      }
    })

  const checkEnd = (ep: unknown, at: string) => {
    if (!isObj(ep) || typeof ep.part !== 'string' || typeof ep.pin !== 'string')
      return void errors.push(`${at}: must be { "part": <uid>, "pin": <name> }`)
    if (ep.offset !== undefined && !isNum(ep.offset)) errors.push(`${at}.offset: must be a number`)
    const modId = partModule.get(ep.part)
    if (modId === undefined) return void warnings.push(`${at}: no part with uid "${ep.part}"`)
    const m = modules.get(modId)
    if (m && !m.pins.some((p) => 'name' in p && p.name === ep.pin)) warnings.push(`${at}: part "${ep.part}" has no pin "${ep.pin}"`)
  }

  if (!Array.isArray(raw.connections)) errors.push('connections: required list')
  else
    raw.connections.forEach((c, i) => {
      const at = `connections[${i}]`
      if (!isObj(c)) return void errors.push(`${at}: must be an object`)
      claim(c.uid, at)
      checkEnd(c.from, `${at}.from`)
      checkEnd(c.to, `${at}.to`)
      if (c.color !== undefined && !(typeof c.color === 'string' && isValidColor(c.color)))
        errors.push(`${at}.color: must be a named color or #RRGGBB`)
      if (c.gauge !== undefined && !(Number.isInteger(c.gauge) && (c.gauge as number) >= 16 && (c.gauge as number) <= 30))
        errors.push(`${at}.gauge: must be a whole number from 16 to 30`)
      if (c.route !== undefined && !(Array.isArray(c.route) && c.route.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))))
        errors.push(`${at}.route: must be a list of [x, y] points`)
      else if (Array.isArray(c.route) && c.route.length > ROUTE_POINT_LIMIT) {
        droppedRoutes.add(i)
        warnings.push(`${at}.route: more than ${ROUTE_POINT_LIMIT} points, so the route was dropped and the wire is routed automatically`)
      } else if (Array.isArray(c.route) && (c.route as [number, number][]).some(([x, y]) => Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT)) {
        droppedRoutes.add(i)
        warnings.push(`${at}.route: a point is beyond +-${COORD_LIMIT}, so the route was dropped and the wire is routed automatically`)
      } else if (Array.isArray(c.route))
        for (let k = 1; k < c.route.length; k++) {
          const [px, py] = c.route[k - 1] as [number, number]
          const [qx, qy] = c.route[k] as [number, number]
          if (px !== qx && py !== qy) warnings.push(`${at}.route[${k}]: diagonal step from route[${k - 1}] (each step should be horizontal or vertical)`)
        }
      if (c.label !== undefined && typeof c.label !== 'string') errors.push(`${at}.label: must be a string`)
    })

  if (raw.annotations !== undefined) {
    if (!Array.isArray(raw.annotations)) errors.push('annotations: must be a list')
    else
      raw.annotations.forEach((a, i) => {
        const at = `annotations[${i}]`
        if (!isObj(a)) return void errors.push(`${at}: must be an object`)
        claim(a.uid, at)
        for (const k of ['label', 'text']) if (a[k] !== undefined && typeof a[k] !== 'string') errors.push(`${at}.${k}: must be a string`)
      })
  }

  if (errors.length) return { ok: false, errors }
  let diagram = raw as unknown as Diagram
  if (partFixes.size || droppedRoutes.size)
    diagram = {
      ...diagram,
      parts: diagram.parts.map((p, i) => (partFixes.has(i) ? { ...p, ...partFixes.get(i) } : p)),
      connections: diagram.connections.map((c, i) => {
        if (!droppedRoutes.has(i)) return c
        const { route: _dropped, ...rest } = c
        return rest
      }),
    }
  return { ok: true, diagram, warnings }
}

export function serializeDiagram(d: Diagram): string {
  return JSON.stringify(d, null, 2) + '\n'
}

export function emptyDiagram(title = 'Untitled sheet'): Diagram {
  return { format: DIAGRAM_FORMAT, title, modules: {}, parts: [], connections: [] }
}
