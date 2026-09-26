// Shared 2D geometry: rotation about the grid pivot, world pin positions, polyline cleanup.
import { GRID, type ModuleDef, type PinType, layoutModule } from './module.ts'

export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Rotation = 0 | 90 | 180 | 270
export type Placement = { x: number; y: number; rotation?: Rotation }

// Adding 0 turns -0 into 0, so results compare cleanly.
const z = (n: number) => n + 0

/** Rotation center: the grid point at or up-left of the body center, so pins stay on grid. */
export function pivot(w: number, h: number): Pt {
  return { x: Math.floor(w / 2 / GRID) * GRID, y: Math.floor(h / 2 / GRID) * GRID }
}

/** Rotates a vector clockwise on screen (y points down). */
export function rotateVec(v: Pt, rot: Rotation): Pt {
  switch (rot) {
    case 90: return { x: z(-v.y), y: z(v.x) }
    case 180: return { x: z(-v.x), y: z(-v.y) }
    case 270: return { x: z(v.y), y: z(-v.x) }
    default: return { x: z(v.x), y: z(v.y) }
  }
}

export function toWorld(part: Placement, lay: { w: number; h: number }, local: Pt): Pt {
  const c = pivot(lay.w, lay.h)
  const r = rotateVec({ x: local.x - c.x, y: local.y - c.y }, part.rotation ?? 0)
  return { x: part.x + c.x + r.x, y: part.y + c.y + r.y }
}

export function bodyRect(part: Placement, lay: { w: number; h: number }): Rect {
  const a = toWorld(part, lay, { x: 0, y: 0 })
  const b = toWorld(part, lay, { x: lay.w, y: lay.h })
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export interface WorldPin {
  name: string
  label?: string
  type: PinType
  edge: Pt
  end: Pt
  dir: Pt
  bus?: { length: number }
}

export function worldPins(part: Placement, m: ModuleDef): WorldPin[] {
  const lay = layoutModule(m)
  const rot = part.rotation ?? 0
  return lay.pins.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    edge: toWorld(part, lay, p.edge),
    end: toWorld(part, lay, p.end),
    dir: rotateVec(p.dir, rot),
    bus: p.bus,
  }))
}

export interface WorldHoleGroup {
  name: string
  label?: string
  rail?: '+' | '-'
  style: 'hole' | 'pad'
  /** Hole centers in world px, in the group's `at` order. */
  at: Pt[]
}

/** Every hole group of a placed module, with its hole centers in world px. Empty for a module without holes. */
export function worldHoles(part: Placement, m: ModuleDef): WorldHoleGroup[] {
  if (!m.holes?.length) return []
  const lay = layoutModule(m)
  return m.holes.map((g) => ({
    name: g.name,
    label: g.label,
    rail: g.rail,
    style: g.holeStyle ?? 'hole',
    at: g.at.map(([x, y]) => toWorld(part, lay, { x, y })),
  }))
}

export interface PlugPoint {
  pin: string
  at: Pt
}

/**
 * Where each pin plugs into a board: its edge point on the body, always a grid point, so a leg
 * lands exactly on a hole. A bus pin has no plug point.
 */
export function plugPoints(part: Placement, m: ModuleDef): PlugPoint[] {
  return worldPins(part, m).filter((p) => !p.bus).map((p) => ({ pin: p.name, at: p.edge }))
}

/** Removes repeated points and the middle point of any three collinear axis-aligned points. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && q.x === p.x && q.y === p.y) continue
    const r = out[out.length - 2]
    if (q && r && ((r.x === q.x && q.x === p.x) || (r.y === q.y && q.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}
