// Mounting a part on its board during layout (agent toolkit spec 2.2): every grid position and
// rotations 0 and 90 degrees, in a fixed order (rotation, then row-major from the board's top-left).
// A candidate is accepted when `seatOn` reports it seated, it joins no two different nets (or a net
// and a leg on no net) in one strip, and its body and caption clear every other part mounted on
// that board and the board's own caption. Among accepted candidates the one with the best net
// affinity wins, as a person builds on a breadboard: each leg in a strip that already carries its
// own net scores 2 (D1's anode in R1's column, so no jumper is needed), and each leg in a rail no
// net has claimed costs 1. Ties go to the first candidate in the fixed order, so the search stays
// deterministic. Pure.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { holeAt, holeIndex, plugsOf, seatOn } from '../format/breadboard.ts'
import { type Rotation, bodyRect, plugPoints } from '../format/geometry.ts'
import { GRID, LEAD, layoutModule } from '../format/module.ts'
import { captionBox } from '../render/captionBox.ts'
import { intersects, tightFootprint } from './footprint.ts'

/** The index of the net a pin (or a board's hole group) is in, or undefined when it is in no net. */
export type NetOfPin = (part: string, pin: string) => number | undefined

/**
 * Whether a leg on `net` (null: on no net) clashes with a strip that already carries `prior`
 * (undefined: nothing yet). A leg on no net keeps its strip to itself.
 */
export const netClash = (prior: number | null | undefined, net: number | null): boolean =>
  prior !== undefined && (prior === null || net === null || prior !== net)

/**
 * The first strip of `board` where part `uid` (seated in `d`) puts two different nets, or a net
 * and a leg on no net, counting strips the netlist names in a net; null when there is none.
 * The same rule the mount search applies to every candidate.
 */
export function stripClash(d: Diagram, uid: string, board: string, netOf: NetOfPin): string | null {
  const b = d.parts.find((p) => p.uid === board)!
  const stripNet = new Map<string, number | null>()
  for (const g of moduleOf(d, b.module)!.holes ?? []) {
    const n = netOf(board, g.name)
    if (n !== undefined) stripNet.set(g.name, n)
  }
  const plugs = plugsOf(d).filter((pl) => pl.board === board)
  for (const pl of plugs) if (pl.part !== uid) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null)
  const mine = new Map<string, number | null>()
  for (const pl of plugs) {
    if (pl.part !== uid) continue
    const net = netOf(uid, pl.pin) ?? null
    if (netClash(stripNet.get(pl.group), net) || netClash(mine.get(pl.group), net)) return pl.group
    mine.set(pl.group, net)
  }
  return null
}

/**
 * Places part `uid` (already in `d.parts`) on `board`. `d` holds the board and the parts mounted on
 * it so far. `prefer` (a position the part already has) wins every tie, so a second pass only moves
 * a part when that scores better. Returns the part mounted and its score, or an error naming the
 * part and why no position fits.
 */
export function mountPart(
  d: Diagram,
  uid: string,
  board: string,
  netOf: NetOfPin,
  prefer?: PartInstance,
): { ok: true; part: PartInstance; score: number } | { ok: false; error: string } {
  const me = d.parts.find((p) => p.uid === uid)!
  const m = moduleOf(d, me.module)!
  const b = d.parts.find((p) => p.uid === board)!
  const bm = moduleOf(d, b.module)!
  const others = d.parts.filter((p) => p.uid !== uid)
  const plugs = plugsOf({ ...d, parts: others })
  // The net each strip of this board already carries (null: a leg on no net keeps it to itself).
  // A strip the netlist names in a net (BB1.top-) carries that net before any leg lands in it.
  const stripNet = new Map<string, number | null>()
  for (const g of bm.holes ?? []) {
    const n = netOf(board, g.name)
    if (n !== undefined) stripNet.set(g.name, n)
  }
  for (const pl of plugs) if (pl.board === board) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null)
  const rails = new Set((bm.holes ?? []).filter((g) => g.rail).map((g) => g.name))
  // Every other part mounted on this board, and the board's own caption (layout refuses any
  // caption overlap, and a part's body or caption over the board's name hides it).
  const neighbours = [...others.filter((p) => p.mount?.board === board).map((p) => tightFootprint(p, moduleOf(d, p.module)!)), captionBox(b, bm)]
  const idx = holeIndex(b, bm)
  const area = bodyRect(b, layoutModule(bm))
  const lay = layoutModule(m)
  // The best score any candidate can reach: every leg whose net some strip already carries.
  const carried = new Set([...stripNet.values()].filter((n): n is number => n !== null))
  const bound = 2 * plugPoints(me, m).filter((pp) => carried.has(netOf(uid, pp.pin) ?? -1)).length
  let reason = 'no position puts every leg on a free hole'
  /** The candidate's score, or null when it is not accepted. */
  const judge = (cand: PartInstance): number | null => {
    if (seatOn({ ...d, parts: [...others, cand] }, uid, board, plugs)?.status !== 'seated') return null
    const mine = new Map<string, number | null>()
    let score = 0
    for (const pp of plugPoints(cand, m)) {
      const hit = holeAt(idx, pp.at)!
      const group = idx.groups[hit[0]].name
      const net = netOf(uid, pp.pin) ?? null
      const prior = stripNet.get(group)
      for (const p of [prior, mine.get(group)])
        if (netClash(p, net)) {
          reason = 'every position where its legs fit would join two different nets in one strip'
          return null
        }
      if (net !== null && prior === net) score += 2
      else if (prior === undefined && rails.has(group)) score -= 1
      mine.set(group, net)
    }
    const fp = tightFootprint(cand, m)
    if (neighbours.some((r) => intersects(r, fp))) {
      reason = 'every position where its legs fit overlaps another part on the board'
      return null
    }
    return score
  }
  let best: PartInstance | null = null
  let bestScore = -Infinity
  if (prefer) {
    const s = judge({ ...prefer, mount: { board } })
    if (s !== null) {
      best = { ...prefer, mount: { board } }
      bestScore = s
    }
  }
  // Amendment A1: a whole number of grid steps, so every candidate stays on the board's grid.
  const reach = Math.ceil((Math.max(lay.w, lay.h) + LEAD) / GRID) * GRID
  const x0 = b.x + Math.floor((area.x - b.x) / GRID) * GRID - reach
  const y0 = b.y + Math.floor((area.y - b.y) / GRID) * GRID - reach
  search: for (const rotation of [0, 90] as Rotation[])
    for (let y = y0; y <= area.y + area.h; y += GRID)
      for (let x = x0; x <= area.x + area.w; x += GRID) {
        if (bestScore >= bound) break search
        const cand: PartInstance = { ...me, x, y, rotation, mount: { board } }
        const s = judge(cand)
        if (s !== null && s > bestScore) {
          best = cand
          bestScore = s
        }
      }
  return best ? { ok: true, part: best, score: bestScore } : { ok: false, error: `${b.designator} has no place for ${me.designator} (${m.id}): ${reason}.` }
}
