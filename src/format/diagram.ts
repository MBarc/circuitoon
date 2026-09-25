// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.
// The router here is a placeholder elbow router; the real one comes out of the routing spike.

import { type ModuleDef, type PlacedPin, layoutModule } from './module.ts'

export const DIAGRAM_FORMAT = 'circuitoon-diagram/1'

export interface PartInstance {
  uid: string
  designator: string
  module: string
  x: number
  y: number
  rotation?: 0 | 90 | 180 | 270
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
export interface Diagram {
  format: typeof DIAGRAM_FORMAT
  title: string
  modules: Record<string, ModuleDef>
  parts: PartInstance[]
  connections: Connection[]
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

type Pt = { x: number; y: number }

function pinWorld(d: Diagram, ep: Endpoint): { pin: PlacedPin; end: Pt; dir: Pt } | null {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && d.modules[part.module]
  const pin = mod && layoutModule(mod).pins.find((p) => p.name === ep.pin)
  if (!part || !pin) return null
  return { pin, end: { x: part.x + pin.end.x, y: part.y + pin.end.y }, dir: pin.dir }
}

/** Polyline for a connection: manual `route` bends if present, else a simple elbow. */
export function wirePoints(d: Diagram, c: Connection): Pt[] | null {
  const a = pinWorld(d, c.from)
  const b = pinWorld(d, c.to)
  if (!a || !b) return null
  if (c.route) return [a.end, ...c.route.map(([x, y]) => ({ x, y })), b.end]
  const a2 = { x: a.end.x + a.dir.x * GRID_STEP, y: a.end.y + a.dir.y * GRID_STEP }
  const b2 = { x: b.end.x + b.dir.x * GRID_STEP, y: b.end.y + b.dir.y * GRID_STEP }
  const mid = a.dir.x === 0 ? { x: a2.x, y: b2.y } : { x: b2.x, y: a2.y }
  return dedupe([a.end, a2, mid, b2, b.end])
}
const GRID_STEP = 10

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && q.x === p.x && q.y === p.y) continue
    const r = out[out.length - 2]
    // Drop the middle point of three collinear points.
    if (q && r && ((r.x === q.x && q.x === p.x) || (r.y === q.y && q.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}

const HOP = 5

/**
 * SVG path data for each wire. Where a wire crosses a wire earlier in the file, the later
 * one gets a small hop arc, as in the hand-drawn reference sheets.
 */
export function wirePaths(d: Diagram): { conn: Connection; d: string; ends: Pt[] }[] {
  const drawn: Pt[][] = []
  const out: { conn: Connection; d: string; ends: Pt[] }[] = []
  for (const conn of d.connections) {
    const pts = wirePoints(d, conn)
    if (!pts) continue
    let path = `M${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      const horiz = s.y === e.y
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const hits: number[] = []
      for (const other of drawn)
        for (let j = 1; j < other.length; j++) {
          const os = other[j - 1]
          const oe = other[j]
          if (horiz && os.x === oe.x) {
            const within = (os.x - Math.min(s.x, e.x) > HOP) && (Math.max(s.x, e.x) - os.x > HOP)
            if (within && s.y > Math.min(os.y, oe.y) && s.y < Math.max(os.y, oe.y)) hits.push(os.x)
          } else if (!horiz && os.y === oe.y) {
            const within = (os.y - Math.min(s.y, e.y) > HOP) && (Math.max(s.y, e.y) - os.y > HOP)
            if (within && s.x > Math.min(os.x, oe.x) && s.x < Math.max(os.x, oe.x)) hits.push(os.y)
          }
        }
      hits.sort((p, q) => (p - q) * dir)
      for (const h of hits) {
        const sweep = dir > 0 ? 1 : 0
        if (horiz) path += ` L${h - HOP * dir} ${s.y} A${HOP} ${HOP} 0 0 ${sweep} ${h + HOP * dir} ${s.y}`
        else path += ` L${s.x} ${h - HOP * dir} A${HOP} ${HOP} 0 0 ${sweep} ${s.x} ${h + HOP * dir}`
      }
      path += ` L${e.x} ${e.y}`
    }
    drawn.push(pts)
    out.push({ conn, d: path, ends: [pts[0], pts[pts.length - 1]] })
  }
  return out
}
