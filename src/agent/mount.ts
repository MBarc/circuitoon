// Mounting a part on its board during layout (agent toolkit spec 2.2): every grid position and
// rotations 0 and 90 degrees, in a fixed order (rotation, then row-major from the board's top-left).
// A candidate is accepted when `seatOn` reports it seated, it joins no two different nets (or a net
// and a leg on no net) in one strip, and its body and caption clear every other part mounted on
// that board. The first accepted candidate wins. Pure.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { holeAt, holeIndex, plugsOf, seatOn } from '../format/breadboard.ts'
import { type Rotation, bodyRect, plugPoints } from '../format/geometry.ts'
import { GRID, LEAD, layoutModule } from '../format/module.ts'
import { intersects, tightFootprint } from './footprint.ts'

/** The index of the net a pin (or a board's hole group) is in, or undefined when it is in no net. */
export type NetOfPin = (part: string, pin: string) => number | undefined

/**
 * Places part `uid` (already in `d.parts`) on `board`. `d` holds the board and the parts mounted on
 * it so far. Returns the part mounted, or an error naming the part and why no position fits.
 */
export function mountPart(d: Diagram, uid: string, board: string, netOf: NetOfPin): { ok: true; part: PartInstance } | { ok: false; error: string } {
  const me = d.parts.find((p) => p.uid === uid)!
  const m = moduleOf(d, me.module)!
  const b = d.parts.find((p) => p.uid === board)!
  const bm = moduleOf(d, b.module)!
  const others = d.parts.filter((p) => p !== me)
  const plugs = plugsOf({ ...d, parts: others })
  // The net each strip of this board already carries (null: a leg on no net keeps it to itself).
  // A strip the netlist names in a net (BB1.top-) carries that net before any leg lands in it.
  const stripNet = new Map<string, number | null>()
  for (const g of bm.holes ?? []) {
    const n = netOf(board, g.name)
    if (n !== undefined) stripNet.set(g.name, n)
  }
  for (const pl of plugs) if (pl.board === board) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null)
  const neighbours = others.filter((p) => p.mount?.board === board).map((p) => tightFootprint(p, moduleOf(d, p.module)!))
  const idx = holeIndex(b, bm)
  const area = bodyRect(b, layoutModule(bm))
  const lay = layoutModule(m)
  // Amendment A1: a whole number of grid steps, so every candidate stays on the board's grid.
  const reach = Math.ceil((Math.max(lay.w, lay.h) + LEAD) / GRID) * GRID
  const x0 = b.x + Math.floor((area.x - b.x) / GRID) * GRID - reach
  const y0 = b.y + Math.floor((area.y - b.y) / GRID) * GRID - reach
  let reason = 'no position puts every leg on a free hole'
  for (const rotation of [0, 90] as Rotation[])
    for (let y = y0; y <= area.y + area.h; y += GRID)
      for (let x = x0; x <= area.x + area.w; x += GRID) {
        const cand: PartInstance = { ...me, x, y, rotation, mount: { board } }
        if (seatOn({ ...d, parts: [...others, cand] }, uid, board, plugs)?.status !== 'seated') continue
        const mine = new Map<string, number | null>()
        let clash = false
        for (const pp of plugPoints(cand, m)) {
          const hit = holeAt(idx, pp.at)!
          const group = idx.groups[hit[0]].name
          const net = netOf(uid, pp.pin) ?? null
          for (const prior of [stripNet.get(group), mine.get(group)])
            if (prior !== undefined && (prior === null || net === null || prior !== net)) clash = true
          if (clash) break
          mine.set(group, net)
        }
        if (clash) {
          reason = 'every position where its legs fit would join two different nets in one strip'
          continue
        }
        const fp = tightFootprint(cand, m)
        if (neighbours.some((r) => intersects(r, fp))) {
          reason = 'every position where its legs fit overlaps another part on the board'
          continue
        }
        return { ok: true, part: cand }
      }
  return { ok: false, error: `${b.designator} has no place for ${me.designator} (${m.id}): ${reason}.` }
}
