// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.

import { type ModuleDef, layoutModule, validateModule, isObj, isNum } from './module.ts'
import { type Pt, type Rect, type Rotation, type WorldPin, bodyRect, simplify, worldPins } from './geometry.ts'
import { routeOrthogonal } from './router.ts'

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
 */
function manualPoints(a: WorldPin, b: WorldPin, route: [number, number][]): Pt[] {
  const bends = route.map(([x, y]) => ({ x, y }))
  const corner = (pin: WorldPin, next: Pt | undefined): Pt[] => {
    if (!next || next.x === pin.end.x || next.y === pin.end.y) return []
    return [pin.dir.x !== 0 ? { x: next.x, y: pin.end.y } : { x: pin.end.x, y: next.y }]
  }
  const head = corner(a, bends[0])
  const tail = bends.length ? corner(b, bends[bends.length - 1]) : []
  return simplify([a.end, ...head, ...bends, ...tail, b.end])
}

export function routeWire(d: Diagram, c: Connection, obstacles: Rect[]): WireRoute | null {
  const a = endpoint(d, c.from)
  const b = endpoint(d, c.to)
  if (!a || !b) return null
  if (c.route) return { points: manualPoints(a, b, c.route), blocked: false }
  const points = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles })
  return points ? { points, blocked: false } : { points: [a.end, b.end], blocked: true }
}

/**
 * Routes every connection. With `only`, connections outside the set keep their route from
 * `prev` (used while dragging so only the moving part's wires are re-routed each frame).
 */
export function computeRoutes(d: Diagram, opts: { only?: Set<string>; prev?: Routes } = {}): Routes {
  const obstacles = partObstacles(d)
  const out: Routes = new Map()
  for (const c of d.connections) {
    if (opts.only && !opts.only.has(c.uid) && opts.prev?.has(c.uid)) out.set(c.uid, opts.prev.get(c.uid)!)
    else out.set(c.uid, routeWire(d, c, obstacles))
  }
  return out
}

const HOP = 5

/**
 * SVG path data for each routed wire. Where a wire crosses a wire earlier in the file, the
 * later one gets a small hop arc, as in hand-drawn wiring sheets.
 */
export function wirePaths(d: Diagram, routes: Routes = computeRoutes(d)) {
  const drawn: Pt[][] = []
  const out: { conn: Connection; d: string; ends: Pt[]; blocked: boolean }[] = []
  for (const conn of d.connections) {
    const route = routes.get(conn.uid)
    if (!route) continue
    const pts = route.points
    let path = `M${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      const horiz = s.y === e.y
      const vert = s.x === e.x
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const hits: number[] = []
      if (horiz !== vert)
        for (const other of drawn)
          for (let j = 1; j < other.length; j++) {
            const os = other[j - 1]
            const oe = other[j]
            if (horiz && os.x === oe.x) {
              const within = os.x - Math.min(s.x, e.x) > HOP && Math.max(s.x, e.x) - os.x > HOP
              if (within && s.y > Math.min(os.y, oe.y) && s.y < Math.max(os.y, oe.y)) hits.push(os.x)
            } else if (vert && os.y === oe.y) {
              const within = os.y - Math.min(s.y, e.y) > HOP && Math.max(s.y, e.y) - os.y > HOP
              if (within && s.x > Math.min(os.x, oe.x) && s.x < Math.max(os.x, oe.x)) hits.push(os.y)
            }
          }
      hits.sort((p, q) => (p - q) * dir)
      for (const hit of hits) {
        const sweep = dir > 0 ? 1 : 0
        if (horiz) path += ` L${hit - HOP * dir} ${s.y} A${HOP} ${HOP} 0 0 ${sweep} ${hit + HOP * dir} ${s.y}`
        else path += ` L${s.x} ${hit - HOP * dir} A${HOP} ${HOP} 0 0 ${sweep} ${s.x} ${hit + HOP * dir}`
      }
      path += ` L${e.x} ${e.y}`
    }
    drawn.push(pts)
    out.push({ conn, d: path, ends: [pts[0], pts[pts.length - 1]], blocked: route.blocked })
  }
  return out
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

  return errors.length ? { ok: false, errors } : { ok: true, diagram: raw as unknown as Diagram, warnings }
}

export function serializeDiagram(d: Diagram): string {
  return JSON.stringify(d, null, 2) + '\n'
}

export function emptyDiagram(title = 'Untitled sheet'): Diagram {
  return { format: DIAGRAM_FORMAT, title, modules: {}, parts: [], connections: [] }
}
