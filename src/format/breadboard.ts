// Breadboards on a diagram: which world grid point is which hole, which parts sit validly on a
// board, and which mounted legs plug into which holes. Pure; per-board hole lookups are cached
// by part object identity, and parts are replaced (never mutated) on every edit, so a moved
// board simply gets a fresh index.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import { type PlugPoint, type Pt, type WorldHoleGroup, plugPoints, worldHoles } from './geometry.ts'
import { GRID, type ModuleDef, isBoard, isSpacer } from './module.ts'

const OFF = 2 ** 25
/**
 * One number per world grid point. Unique only for whole-number x and y within +-2^25 px, so
 * lookups go through `holeAt`, which checks both and compares the found hole exactly.
 */
export const pointKey = (x: number, y: number): number => (x + OFF) * 2 ** 26 + (y + OFF)
const inRange = (n: number) => Number.isInteger(n) && n > -OFF && n < OFF

export interface HoleIndex {
  groups: WorldHoleGroup[]
  /** Point key to [group index, hole index]. Look up through `holeAt`. */
  byPoint: Map<number, [number, number]>
}

const indexCache = new WeakMap<PartInstance, { m: ModuleDef; index: HoleIndex }>()

/** World hole positions of a part with hole groups, and a lookup from grid point to hole. */
export function holeIndex(part: PartInstance, m: ModuleDef): HoleIndex {
  const hit = indexCache.get(part)
  if (hit && hit.m === m) return hit.index
  const groups = worldHoles(part, m)
  const byPoint = new Map<number, [number, number]>()
  groups.forEach((g, gi) =>
    g.at.forEach((p, hi) => {
      if (inRange(p.x) && inRange(p.y)) byPoint.set(pointKey(p.x, p.y), [gi, hi])
    }),
  )
  const index = { groups, byPoint }
  indexCache.set(part, { m, index })
  return index
}

/** The [group index, hole index] whose center is exactly `pt`, or null. A fractional or out-of-range point never matches. */
export function holeAt(index: HoleIndex, pt: Pt): [number, number] | null {
  if (!inRange(pt.x) || !inRange(pt.y)) return null
  const hit = index.byPoint.get(pointKey(pt.x, pt.y))
  if (!hit) return null
  const at = index.groups[hit[0]].at[hit[1]]
  return at.x === pt.x && at.y === pt.y ? hit : null
}

export interface HoleRef {
  board: string
  group: string
  hole: number
}

/** The hole of `part` whose center is within `radius` px of `p`, or null. Holes sit on grid points. */
export function holeAtPoint(part: PartInstance, m: ModuleDef, p: Pt, radius = 3.5): HoleRef | null {
  const gx = Math.round(p.x / GRID) * GRID
  const gy = Math.round(p.y / GRID) * GRID
  if (Math.hypot(p.x - gx, p.y - gy) > radius) return null
  const idx = holeIndex(part, m)
  const hit = holeAt(idx, { x: gx, y: gy })
  return hit ? { board: part.uid, group: idx.groups[hit[0]].name, hole: hit[1] } : null
}

export interface Plug {
  part: string
  pin: string
  board: string
  group: string
  hole: number
  /** The hole center, which is also the pin's plug point. */
  at: Pt
}

/** Where a part's legs land on one board: all of them on free holes (seated), or only some. */
export interface Seat {
  status: 'seated' | 'partial'
  board: string
  /** The hole centers the legs land on, in plug point order (taken ones included). */
  holes: Pt[]
}

/** One key per hole on the sheet; JSON keeps any character in a uid or group name unambiguous. */
const holeKey = (board: string, group: string, hole: number): string => JSON.stringify([board, group, hole])

/** Holes holding a leg of a part outside `ignore`. */
const takenBy = (plugs: Plug[], ignore: ReadonlySet<string>): Set<string> =>
  new Set(plugs.filter((p) => !ignore.has(p.part)).map((p) => holeKey(p.board, p.group, p.hole)))

/** A part that may mount, with its plug points. Null for a missing part or module, a board, and a part with a bus pin or no pins. */
function mountable(d: Diagram, uid: string): { part: PartInstance; pts: PlugPoint[] } | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || isBoard(m) || m.pins.some((p) => !isSpacer(p) && p.bus)) return null
  const pts = plugPoints(part, m)
  return pts.length ? { part, pts } : null
}

interface Fit {
  board: PartInstance
  groups: WorldHoleGroup[]
  /** Per plug point, the [group, hole] it lands on, or null. */
  hits: ([number, number] | null)[]
  landed: number
}

/** How plug points land on one part; null when that part is not a board. */
function fitOn(d: Diagram, board: PartInstance, pts: PlugPoint[]): Fit | null {
  const bm = moduleOf(d, board.module)
  if (!bm || !isBoard(bm)) return null
  const idx = holeIndex(board, bm)
  const hits = pts.map((pp) => holeAt(idx, pp.at))
  return { board, groups: idx.groups, hits, landed: hits.filter(Boolean).length }
}

function seatFrom(fit: Fit, pts: PlugPoint[], taken: ReadonlySet<string>): Seat | null {
  if (!fit.landed) return null
  const seated = fit.hits.every((h) => h && !taken.has(holeKey(fit.board.uid, fit.groups[h[0]].name, h[1])))
  return { status: seated ? 'seated' : 'partial', board: fit.board.uid, holes: pts.filter((_, i) => fit.hits[i]).map((pp) => pp.at) }
}

/**
 * Where part `uid` would mount as it stands. Seated: every plug point lands exactly on a hole of
 * one board and none of those holes holds a leg (in `plugs`) of a part outside `ignore`, which
 * defaults to the part itself. Partial: some legs land, or land on taken holes. Null: no leg
 * lands on any board, or the part cannot mount (a board, a part with a bus pin or no pins).
 * With legs on several boards the board with the most landed legs is the candidate; a tie goes
 * to the board earlier in `d.parts`.
 */
export function seatOf(d: Diagram, uid: string, plugs: Plug[], ignore: ReadonlySet<string> = new Set([uid])): Seat | null {
  const me = mountable(d, uid)
  if (!me) return null
  let best: Fit | null = null
  for (const b of d.parts) {
    const fit = b === me.part ? null : fitOn(d, b, me.pts)
    if (fit && fit.landed > (best?.landed ?? 0)) best = fit
  }
  return best && seatFrom(best, me.pts, takenBy(plugs, ignore))
}

/** `seatOf` on one given board (a part's own mount), whatever other board also fits. Null when `board` is missing or not a board. */
export function seatOn(d: Diagram, uid: string, board: string, plugs: Plug[], ignore: ReadonlySet<string> = new Set([uid])): Seat | null {
  const me = mountable(d, uid)
  const b = me && d.parts.find((p) => p.uid === board)
  const fit = me && b && b !== me.part ? fitOn(d, b, me.pts) : null
  return me && fit && seatFrom(fit, me.pts, takenBy(plugs, ignore))
}

export interface MountIssue {
  part: string
  board: string
  /** partial covers any fit short of every leg on a hole, including no leg at all. */
  reason: 'missing-board' | 'not-a-board' | 'cannot-mount' | 'partial' | 'conflict'
}

/**
 * Walks mounted parts in `d.parts` order. A mount is valid when its part is seated on its own
 * `mount.board` given the holes earlier valid mounts took; only valid mounts plug. An invalid
 * mount keeps its data (for repair) and is reported with the reason it plugs nothing.
 */
function mounts(d: Diagram): { plugs: Plug[]; issues: MountIssue[] } {
  const plugs: Plug[] = []
  const issues: MountIssue[] = []
  const taken = new Set<string>()
  for (const p of d.parts) {
    if (!p.mount) continue
    const at = p.mount.board
    const issue = (reason: MountIssue['reason']) => void issues.push({ part: p.uid, board: at, reason })
    const board = d.parts.find((b) => b.uid === at)
    if (!board) {
      issue('missing-board')
      continue
    }
    if (!isBoard(moduleOf(d, board.module))) {
      issue('not-a-board')
      continue
    }
    const me = board === p ? null : mountable(d, p.uid)
    if (!me) {
      issue('cannot-mount')
      continue
    }
    const fit = fitOn(d, board, me.pts)!
    if (fit.landed < me.pts.length) issue('partial')
    else if (seatFrom(fit, me.pts, taken)!.status !== 'seated') issue('conflict')
    else
      me.pts.forEach((pp, i) => {
        const [gi, hi] = fit.hits[i]!
        const group = fit.groups[gi].name
        taken.add(holeKey(board.uid, group, hi))
        plugs.push({ part: p.uid, pin: pp.pin, board: board.uid, group, hole: hi, at: pp.at })
      })
  }
  return { plugs, issues }
}

/**
 * Every plugged leg on the sheet, from each part's `mount` and positions: each pin of a validly
 * mounted part plugs into the hole its plug point sits on. An invalid mount plugs nothing (see
 * `mountIssues`).
 */
export function plugsOf(d: Diagram): Plug[] {
  return mounts(d).plugs
}

/**
 * Every mount that plugs nothing, and why: its board is missing or not a board, the part cannot
 * mount, not every leg lands on a hole, or a hole is already taken by an earlier valid mount.
 */
export function mountIssues(d: Diagram): MountIssue[] {
  return mounts(d).issues
}

/** Boards first, so parts on a board draw above it whatever the file order; file order is kept within each list. */
export function splitBoards(d: Diagram): { boards: PartInstance[]; others: PartInstance[] } {
  const boards: PartInstance[] = []
  const others: PartInstance[] = []
  for (const p of d.parts) (isBoard(moduleOf(d, p.module)) ? boards : others).push(p)
  return { boards, others }
}
