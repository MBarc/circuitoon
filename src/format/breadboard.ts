// Breadboards on a diagram: which world grid point is which hole, and which mounted legs plug
// into which holes. Pure; per-board hole lookups are cached by part object identity, and parts
// are replaced (never mutated) on every edit, so a moved board simply gets a fresh index.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import { type Pt, type WorldHoleGroup, plugPoints, worldHoles } from './geometry.ts'
import { type ModuleDef, isBoard } from './module.ts'

const OFF = 2 ** 25
/** One number per world grid point (x and y within +-2^25 px). */
export const pointKey = (x: number, y: number): number => (x + OFF) * 2 ** 26 + (y + OFF)

export interface HoleIndex {
  groups: WorldHoleGroup[]
  /** Point key to [group index, hole index]. */
  byPoint: Map<number, [number, number]>
}

const indexCache = new WeakMap<PartInstance, { m: ModuleDef; index: HoleIndex }>()

/** World hole positions of a part with hole groups, and a lookup from grid point to hole. */
export function holeIndex(part: PartInstance, m: ModuleDef): HoleIndex {
  const hit = indexCache.get(part)
  if (hit && hit.m === m) return hit.index
  const groups = worldHoles(part, m)
  const byPoint = new Map<number, [number, number]>()
  groups.forEach((g, gi) => g.at.forEach((p, hi) => byPoint.set(pointKey(p.x, p.y), [gi, hi])))
  const index = { groups, byPoint }
  indexCache.set(part, { m, index })
  return index
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

/**
 * Every plugged leg on the sheet, from each part's `mount` and positions: a mounted part's pin
 * plugs into the hole its plug point sits on. A leg off every hole plugs nothing; a mount to a
 * missing part or to a part that is not a board plugs nothing.
 */
export function plugsOf(d: Diagram): Plug[] {
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const out: Plug[] = []
  for (const p of d.parts) {
    if (!p.mount) continue
    const board = byUid.get(p.mount.board)
    const bm = board && moduleOf(d, board.module)
    const m = moduleOf(d, p.module)
    if (!board || board === p || !bm || !m || !isBoard(bm)) continue
    const idx = holeIndex(board, bm)
    for (const pp of plugPoints(p, m)) {
      const hit = idx.byPoint.get(pointKey(pp.at.x, pp.at.y))
      if (hit) out.push({ part: p.uid, pin: pp.pin, board: board.uid, group: idx.groups[hit[0]].name, hole: hit[1], at: pp.at })
    }
  }
  return out
}
