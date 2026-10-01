// How a wire reaches a hole of a breadboard in use (Ruling W1): by one straight run from an edge of
// the board. Along its own strip only from the strip's outer end (never from across the centre
// channel, where other strips continue the line), or across the strip. Each way out reports the
// holes it passes over, those in use (a wire end, a leg, a hole under a body) and the empty ones,
// so a caller takes the cleanest. Shared by the router and the layout's choice of holes. Pure.
import type { Pt, Rect } from './geometry.ts'

export interface BoardStrip {
  /** The hole group's name. */
  id: string
  /** Its holes, in world px. */
  holes: Pt[]
  /** A power rail (crossing one on the way to the edge is the usual way in). */
  rail?: boolean
}
export interface HoleExit {
  /** Outward direction. */
  dir: Pt
  /** Where the run meets the board's edge. */
  edge: Pt
  /** Along the hole's own strip (from its outer end), rather than across it. */
  along: boolean
  /** Holes of other strips the run passes over: in use, empty terminal-strip holes (running along a row), and empty rail holes. */
  crossUsed: number
  crossEmpty: number
  crossRail: number
  /** Holes of its own strip the run passes over: in use (another wire's end, a leg), and empty. */
  ownUsed: number
  ownEmpty: number
}

/**
 * How unclean a way out is, lowest best. Every hole the run passes over counts: one in use most
 * (another wire's end or a leg, of any strip: the wire reads as plugged in there, or covers that
 * end), then an empty hole of another terminal strip (the run would lie along a row of holes), a
 * rail crossed on the way to the edge, and least its own empty holes. A run across its strip
 * rather than along it costs a little more, so a strip is entered from its own end where that is
 * as clean.
 */
export const exitDirt = (x: HoleExit): number => 12 * (x.crossUsed + x.ownUsed) + 6 * x.crossEmpty + 2 * x.crossRail + x.ownEmpty + (x.along ? 0 : 3)

const DIRS: Pt[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]
const NEAR = 3

/**
 * The ways out from hole `p` of strip `own` on a board with body `rect` and hole groups `strips`.
 * `used` says whether a hole is in use. A run along the strip toward a line of holes that another
 * strip continues (across the centre channel) is never offered.
 */
export function holeExits(rect: Rect, strips: BoardStrip[], own: string, p: Pt, used: (q: Pt) => boolean): HoleExit[] {
  const mine = strips.find((s) => s.id === own)
  const holes = mine?.holes ?? [p]
  const flat = holes.length > 1 && holes.every((q) => Math.abs(q.y - holes[0].y) < 0.5)
  const upright = holes.length > 1 && holes.every((q) => Math.abs(q.x - holes[0].x) < 0.5)
  const out: HoleExit[] = []
  for (const dir of DIRS) {
    const along = (dir.x !== 0 && flat) || (dir.y !== 0 && upright)
    const edge = { x: dir.x < 0 ? rect.x : dir.x > 0 ? rect.x + rect.w : p.x, y: dir.y < 0 ? rect.y : dir.y > 0 ? rect.y + rect.h : p.y }
    const ahead = (q: Pt) => (q.x - p.x) * dir.x + (q.y - p.y) * dir.y
    const onLine = (q: Pt) => (dir.x !== 0 ? Math.abs(q.y - p.y) < NEAR : Math.abs(q.x - p.x) < NEAR)
    if (along) {
      // Another strip continuing the line beyond this one's end (two or more of its holes on it: the
      // other half across the centre channel): the run would cross over to it. A rail crossed on
      // the way out (one hole on the line) does not count.
      const end = Math.max(...holes.map(ahead))
      if (strips.some((s) => s.id !== own && s.holes.filter((q) => onLine(q) && ahead(q) > end).length >= 2)) continue
    }
    let crossUsed = 0
    let crossEmpty = 0
    let crossRail = 0
    let ownUsed = 0
    let ownEmpty = 0
    for (const s of strips)
      for (const q of s.holes) {
        if (!onLine(q) || ahead(q) <= NEAR) continue
        if (s.id === own) {
          if (used(q)) ownUsed++
          else ownEmpty++
        } else if (used(q)) crossUsed++
        else if (s.rail) crossRail++
        else crossEmpty++
      }
    out.push({ dir, edge, along, crossUsed, crossEmpty, crossRail, ownUsed, ownEmpty })
  }
  return out
}
