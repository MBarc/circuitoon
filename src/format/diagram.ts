// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.

import { type ModuleDef, layoutModule } from './module.ts'
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from './geometry.ts'
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
  return NAMED_COLORS[c.toLowerCase()] ?? NAMED_COLORS.black
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

export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = d.modules[p.module]
    return m ? [bodyRect(p, layoutModule(m))] : []
  })
}

function endpoint(d: Diagram, ep: Endpoint) {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && d.modules[part.module]
  return (part && mod && worldPins(part, mod).find((p) => p.name === ep.pin)) || null
}

export function routeWire(d: Diagram, c: Connection, obstacles: Rect[]): WireRoute | null {
  const a = endpoint(d, c.from)
  const b = endpoint(d, c.to)
  if (!a || !b) return null
  if (c.route) return { points: [a.end, ...c.route.map(([x, y]) => ({ x, y })), b.end], blocked: false }
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
