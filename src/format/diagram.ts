// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.

import { GRID, type ModuleDef, isBoard, layoutModule, validateModule, isObj, isNum } from './module.ts'
import { type Pt, type Rect, type Rotation, bodyRect, simplify, toWorld, worldPins } from './geometry.ts'
import { addToOccupancy, inGrown, Occupancy, onGrid, routeOrthogonal } from './router.ts'
import { PRIMARY_PARAM_NAMES } from './values.ts'
import { manualRouteBlocked, tidy } from './wireEdit.ts'
import { mountIssues, plugOfPin } from './breadboard.ts'

export const DIAGRAM_FORMAT = 'circuitoon-diagram/1'

export interface PartInstance {
  uid: string
  designator: string
  module: string
  x: number
  y: number
  rotation?: Rotation
  values?: Record<string, unknown>
  /** The board this part is plugged into. Its pins join the hole groups their plug points sit on. */
  mount?: { board: string }
}
export interface Endpoint {
  part: string
  pin: string
  offset?: number
  /** Which hole of a hole group the wire ends in (default 0). */
  hole?: number
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
  /** True when no clear route exists and the wire is drawn as an orthogonal L fallback (dashed). */
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

/** Part bodies wires must route around. A module with `obstacle: false` (a breadboard) is not one. */
export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    return m && m.obstacle !== false ? [bodyRect(p, layoutModule(m))] : []
  })
}

/** A wire end in world px: where the wire attaches, and the way it must leave (null: any way, a hole). */
export interface ResolvedEnd {
  end: Pt
  dir: Pt | null
}

/**
 * Resolves a connection end. A pin resolves to its stub tip and outward direction; a hole group
 * resolves to the center of hole `ep.hole` (default 0), which a wire may leave in any direction.
 * A pin whose leg is validly plugged into a board (Ruling 25) resolves to that leg's hole, also
 * with no direction: a jumper to that pin goes into the same strip as the leg, and the stub tip
 * would sit over the neighbouring hole. Null when the part, pin, group or hole does not exist.
 */
export function resolveEndpoint(d: Diagram, ep: Endpoint): ResolvedEnd | null {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && moduleOf(d, part.module)
  if (!part || !mod) return null
  const group = mod.holes?.find((g) => g.name === ep.pin)
  if (group) {
    const local = group.at[ep.hole ?? 0]
    return local ? { end: toWorld(part, layoutModule(mod), { x: local[0], y: local[1] }), dir: null } : null
  }
  const pin = worldPins(part, mod).find((p) => p.name === ep.pin)
  if (!pin) return null
  const hole = part.mount ? plugOfPin(d, part.uid, pin.name) : null
  return hole ? { end: hole, dir: null } : { end: pin.end, dir: pin.dir }
}

/**
 * A broken connection's one resolvable end, so the editor can still draw a short repair stub
 * there (the other end names a missing part, pin, group or hole and has no coordinate at all).
 * Null when neither end resolves.
 */
export function brokenStub(d: Diagram, c: Connection): ResolvedEnd | null {
  return resolveEndpoint(d, c.from) ?? resolveEndpoint(d, c.to)
}

/**
 * A hand-routed wire keeps its stored bends; only its end segments stretch to reach a moved
 * pin. Where a pin tip and its neighbouring bend no longer line up, a corner is added so the
 * wire still leaves the pin along its stub, and every segment stays horizontal or vertical.
 * Two stored bends that do not line up (a hand-edited file) get a corner between them too,
 * horizontal first. Collinear bends are kept (the user may have split a run to move its halves
 * separately), so this polyline is also what the editing handles work on; only spikes and
 * repeats are dropped.
 */
function manualPoints(a: ResolvedEnd, b: ResolvedEnd, route: [number, number][]): Pt[] {
  const bends = route.map(([x, y]) => ({ x, y }))
  const corner = (pin: ResolvedEnd, next: Pt | undefined): Pt[] => {
    if (!next || next.x === pin.end.x || next.y === pin.end.y) return []
    // A hole end may leave any way; it turns horizontally first, like a pin on a left or right edge.
    const horizontal = pin.dir === null || pin.dir.x !== 0
    return [horizontal ? { x: next.x, y: pin.end.y } : { x: pin.end.x, y: next.y }]
  }
  // No bends left (every one removed by hand): still one corner, never a diagonal.
  const head = corner(a, bends.length ? bends[0] : b.end)
  const tail = bends.length ? corner(b, bends[bends.length - 1]) : []
  const pts = [a.end, ...head, ...bends, ...tail, b.end]
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    if (p.x !== q.x && p.y !== q.y) out.push({ x: q.x, y: p.y })
    out.push(q)
  }
  return tidy(out)
}

/**
 * The obstacles one wire must avoid: all of them, minus any body over one of its hole ends. A
 * hole under a part (a leg's hole, a hole under a DIP body) has no exit direction and every grid
 * node around it is inside that body, so the wire may leave through the part covering it, as a
 * real jumper slides out from under one. Only this wire's obstacle list changes; every other
 * wire still routes around the part. A pin end always has an exit (its stub), so it drops nothing.
 */
function obstaclesFor(obstacles: Rect[], a: ResolvedEnd, b: ResolvedEnd): Rect[] {
  // The router starts a hole end at its grid node, so that is the point a body must cover (a
  // board placed off the grid has its holes between grid lines).
  const free = [a, b].filter((e) => e.dir === null).map((e) => onGrid(e.end, GRID))
  if (!free.length) return obstacles
  return obstacles.filter((r) => !free.some((p) => inGrown(p, r)))
}

/**
 * Stand-in for a wire with no clear route: an L leaving `a` along its stub (vertically from a top
 * or bottom pin, horizontally from a side pin or a hole), like manualPoints' corner rule.
 */
function blockedPoints(a: ResolvedEnd, b: ResolvedEnd): Pt[] {
  const vertical = a.dir !== null && a.dir.x === 0
  return tidy([a.end, vertical ? { x: a.end.x, y: b.end.y } : { x: b.end.x, y: a.end.y }, b.end])
}

export function routeWire(d: Diagram, c: Connection, obstacles: Rect[], occupied?: Occupancy): WireRoute | null {
  const a = resolveEndpoint(d, c.from)
  const b = resolveEndpoint(d, c.to)
  if (!a || !b) return null
  const own = obstaclesFor(obstacles, a, b)
  if (c.route) {
    const points = manualPoints(a, b, c.route)
    return { points, blocked: manualRouteBlocked(points, own) }
  }
  const points = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles: own, occupied })
  // Never a diagonal: an unroutable wire is still drawn orthogonal, dashed, and flagged.
  return points ? { points, blocked: false } : { points: blockedPoints(a, b), blocked: true }
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

const HOP = 5

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
/** Shortest the run on a pin may be left by a nudge (unless it was already shorter). */
const MIN_PIN_RUN = 2

/**
 * Nudges each interior segment (every segment but the first and last, which attach to pins and
 * never move) sideways when it runs along the same grid line as an already-drawn wire's segment,
 * so both stay visible even where the router itself left them sharing a lane (a manual route, or
 * an obstacle that forces two auto routes together). Moving a segment moves both its endpoints,
 * so the segments on either side of it stretch to keep up rather than detach from it. A nudge
 * that would turn the run on a pin back over the pin, or leave it shorter than MIN_PIN_RUN px, is
 * skipped; when no nudge is allowed the segment stays where it is.
 */
function separate(points: Pt[], verticals: Seg[], horizontals: Seg[]): Pt[] {
  const pts = points.map((p) => ({ ...p }))
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
    const allowed = (moved: number) =>
      pinRuns.every((tip) => {
        const before = at - (horiz ? tip.y : tip.x)
        const after = (moved - (horiz ? tip.y : tip.x)) * Math.sign(before)
        return after >= Math.min(MIN_PIN_RUN, Math.abs(before))
      })
    let pick: number | null = null
    for (const nudge of NUDGES) {
      const moved = at + nudge
      if (!allowed(moved)) continue
      pick = moved
      if (!overlapsAt(segs, moved, lo, hi)) break
    }
    if (pick !== null) {
      if (horiz) { a.y = pick; b.y = pick } else { a.x = pick; b.x = pick }
    }
  }
  return pts
}

/**
 * SVG path data for each routed wire. Where a wire crosses a wire earlier in the file, the
 * later one gets a small hop arc, as in hand-drawn wiring sheets. Earlier wires' segments are
 * indexed by position, so each new segment only checks the ones in its span. An interior segment
 * that would otherwise run right on top of an earlier wire is nudged 4 px clear first (see
 * `separate`), so the hop and label-anchor geometry below is already the drawn, separated shape.
 */
export function wirePaths(d: Diagram, routes: Routes = computeRoutes(d)) {
  const verticals: Seg[] = [] // at = x, lo..hi = y range
  const horizontals: Seg[] = [] // at = y, lo..hi = x range
  const out: { conn: Connection; d: string; points: Pt[]; ends: Pt[]; blocked: boolean }[] = []
  for (const conn of d.connections) {
    const route = routes.get(conn.uid)
    if (!route) continue
    // Drawn geometry drops collinear bends: nudging one half of a split run would otherwise
    // pull the other half into a diagonal.
    const pts = separate(simplify(route.points), verticals, horizontals)
    let path = `M${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      const horiz = s.y === e.y
      const vert = s.x === e.x
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const hits = horiz === vert ? [] : horiz ? crossings(verticals, s.x, e.x, s.y) : crossings(horizontals, s.y, e.y, s.x)
      hits.sort((p, q) => (p - q) * dir)
      for (const hit of hits) {
        const sweep = dir > 0 ? 1 : 0
        if (horiz) path += ` L${hit - HOP * dir} ${s.y} A${HOP} ${HOP} 0 0 ${sweep} ${hit + HOP * dir} ${s.y}`
        else path += ` L${s.x} ${hit - HOP * dir} A${HOP} ${HOP} 0 0 ${sweep} ${s.x} ${hit + HOP * dir}`
      }
      path += ` L${e.x} ${e.y}`
    }
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      if (s.x === e.x) insert(verticals, { at: s.x, lo: Math.min(s.y, e.y), hi: Math.max(s.y, e.y) })
      if (s.y === e.y) insert(horizontals, { at: s.y, lo: Math.min(s.x, e.x), hi: Math.max(s.x, e.x) })
    }
    out.push({ conn, d: path, points: pts, ends: [pts[0], pts[pts.length - 1]], blocked: route.blocked })
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
      if (p.rotation !== undefined && ![0, 90, 180, 270].includes(p.rotation as number))
        errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
      if (p.mount !== undefined && !(isObj(p.mount) && typeof p.mount.board === 'string' && p.mount.board !== ''))
        errors.push(`${at}.mount: must be { "board": <part uid> }`)
      if (p.values !== undefined) {
        if (!isObj(p.values)) errors.push(`${at}.values: must be an object`)
        else
          for (const [key, entry] of Object.entries(p.values)) {
            // Only entries meant to carry a number-with-unit are checked here: the primary
            // value param names, and any entry that already looks like one (has a "value" key).
            // Other part state (an LED's color, a switch's default) is opaque and left alone.
            const looksLikeValue = PRIMARY_PARAM_NAMES.includes(key) || (isObj(entry) && 'value' in entry)
            if (!looksLikeValue) continue
            if (!(isObj(entry) && isNum(entry.value) && typeof entry.unit === 'string'))
              warnings.push(`${at}.values.${key}: value must be a finite number with a string unit`)
          }
      }
    })

  // Mount targets are checked once every part is known, since a board may come later in the list.
  if (Array.isArray(raw.parts))
    raw.parts.forEach((p, i) => {
      if (!isObj(p) || !isObj(p.mount) || typeof p.mount.board !== 'string' || p.mount.board === '') return
      const board = p.mount.board
      const at = `parts[${i}].mount.board`
      if (board === p.uid) return void warnings.push(`${at}: a part cannot be mounted on itself`)
      const modId = partModule.get(board)
      if (modId === undefined) return void warnings.push(`${at}: no part with uid "${board}"`)
      const m = modules.get(modId)
      if (m && !isBoard(m)) warnings.push(`${at}: part "${board}" is not a board (a module with holes and "obstacle": false)`)
    })

  const checkEnd = (ep: unknown, at: string) => {
    if (!isObj(ep) || typeof ep.part !== 'string' || typeof ep.pin !== 'string')
      return void errors.push(`${at}: must be { "part": <uid>, "pin": <name> }`)
    if (ep.offset !== undefined && !isNum(ep.offset)) errors.push(`${at}.offset: must be a number`)
    if (ep.hole !== undefined && !(Number.isInteger(ep.hole) && (ep.hole as number) >= 0))
      errors.push(`${at}.hole: must be a whole number, 0 or more`)
    const modId = partModule.get(ep.part)
    if (modId === undefined) return void warnings.push(`${at}: no part with uid "${ep.part}"`)
    const m = modules.get(modId)
    if (!m) return
    const group = m.holes?.find((g) => g.name === ep.pin)
    if (group) {
      if (typeof ep.hole === 'number' && Number.isInteger(ep.hole) && ep.hole >= group.at.length)
        warnings.push(`${at}.hole: group "${ep.pin}" has ${group.at.length} holes (0 to ${group.at.length - 1})`)
    } else if (!m.pins.some((p) => 'name' in p && p.name === ep.pin)) warnings.push(`${at}: part "${ep.part}" has no pin "${ep.pin}"`)
    else if (ep.hole !== undefined) warnings.push(`${at}.hole: pin "${ep.pin}" is not a hole group`)
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
      else if (Array.isArray(c.route))
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
  const diagram = raw as unknown as Diagram
  // Mounts that load but plug nothing. A missing target, a self mount, and a non-board target
  // whose module is embedded are already warned about above; a non-board target whose module is
  // not embedded is caught below instead (its own "not embedded" warning is separate).
  for (const { part, board, reason } of mountIssues(diagram)) {
    const i = diagram.parts.findIndex((p) => p.uid === part)
    const at = `parts[${i}].mount`
    if (reason === 'cannot-mount' && board !== part && modules.has(diagram.parts[i].module))
      warnings.push(`${at}: part "${part}" cannot mount (boards, parts with a bus pin and parts with no pins never do)`)
    else if (reason === 'not-a-board' && !modules.has(partModule.get(board)!))
      warnings.push(`${at}: part "${board}" is not a board (its module "${partModule.get(board)}" is not embedded in this file)`)
    else if (reason === 'partial') warnings.push(`${at}: not every leg of "${part}" sits on a hole of board "${board}", so it plugs into nothing`)
    else if (reason === 'conflict') warnings.push(`${at}: a leg of "${part}" sits on a hole another mounted part already uses, so it plugs into nothing`)
  }
  return { ok: true, diagram, warnings }
}

export function serializeDiagram(d: Diagram): string {
  return JSON.stringify(d, null, 2) + '\n'
}

export function emptyDiagram(title = 'Untitled sheet'): Diagram {
  return { format: DIAGRAM_FORMAT, title, modules: {}, parts: [], connections: [] }
}
