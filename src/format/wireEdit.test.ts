import { describe, expect, it } from 'vitest'
import { bendHandleAt, insertBend, isOrthogonal, manualRouteBlocked, moveSegment, removeBend, segmentHandleAt, segmentsOf, tidy, toRoute } from './wireEdit.ts'
import type { Pt } from './geometry.ts'

const P = (...xy: [number, number][]): Pt[] => xy.map(([x, y]) => ({ x, y }))

/** Every segment is horizontal or vertical. */
function orthogonal(pts: Pt[]) {
  return pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)
}

/** The straight fallback drawn for a wire that cannot be routed. */
const diagonal = P([48, 20], [300, 180])

describe('isOrthogonal', () => {
  it('is true when every step is horizontal or vertical', () => {
    expect(isOrthogonal(P([0, 0], [50, 0], [50, 40], [50, 40]))).toBe(true)
    expect(isOrthogonal(P([0, 0]))).toBe(true)
  })
  it('is false when any step is diagonal', () => {
    expect(isOrthogonal(diagonal)).toBe(false)
    expect(isOrthogonal(P([0, 0], [50, 0], [60, 10]))).toBe(false)
  })
})

describe('segmentsOf', () => {
  it('lists each segment with its start index and axis', () => {
    expect(segmentsOf(P([0, 0], [50, 0], [50, 40]))).toEqual([
      { i: 0, a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, axis: 'h' },
      { i: 1, a: { x: 50, y: 0 }, b: { x: 50, y: 40 }, axis: 'v' },
    ])
  })
  it('skips zero-length segments', () => {
    expect(segmentsOf(P([0, 0], [0, 0], [30, 0])).map((s) => s.i)).toEqual([1])
  })
})

describe('tidy', () => {
  it('drops repeated points and spikes that fold back on themselves', () => {
    expect(tidy(P([0, 0], [0, 0], [20, 0], [20, 30], [20, 10], [40, 10]))).toEqual(P([0, 0], [20, 0], [20, 10], [40, 10]))
  })
  it('keeps a collinear bend that runs on in the same direction', () => {
    expect(tidy(P([0, 0], [20, 0], [40, 0]))).toEqual(P([0, 0], [20, 0], [40, 0]))
  })
})

describe('moveSegment', () => {
  // A U-shaped wire: stub right, down, across, up, stub right.
  const u = P([48, 20], [60, 20], [60, 60], [80, 60], [80, 20], [92, 20])

  it('shifts an interior segment and stretches its neighbors', () => {
    expect(moveSegment(u, 2, 40)).toEqual(P([48, 20], [60, 20], [60, 100], [80, 100], [80, 20], [92, 20]))
    expect(moveSegment(u, 1, 10)).toEqual(P([48, 20], [70, 20], [70, 60], [80, 60], [80, 20], [92, 20]))
  })
  it('snaps the move to the 10 px grid', () => {
    expect(moveSegment(u, 2, 37)).toEqual(moveSegment(u, 2, 40))
    expect(moveSegment(u, 2, 4)).toEqual(u)
  })
  // A wider U whose pin runs (48..80 and 120..152) have room past the stub.
  const wide = P([48, 20], [80, 20], [80, 60], [120, 60], [120, 20], [152, 20])

  it('keeps a stub at the start pin, ending on the first grid line 10 px out, when moving the first segment', () => {
    const out = moveSegment(wide, 0, 30)
    expect(out).toEqual(P([48, 20], [60, 20], [60, 50], [80, 50], [80, 60], [120, 60], [120, 20], [152, 20]))
    expect(orthogonal(out)).toBe(true)
  })
  it('keeps a stub at the end pin, ending on the first grid line 10 px out, when moving the last segment', () => {
    const out = moveSegment(wide, 4, -30)
    expect(out).toEqual(P([48, 20], [80, 20], [80, 60], [120, 60], [120, -10], [140, -10], [140, 20], [152, 20]))
    expect(orthogonal(out)).toBe(true)
  })
  it('leaves every stored point on the 10 px grid', () => {
    for (const [i, dd] of [[0, 30], [4, -30], [1, -40], [3, 40], [2, 20]]) {
      const bends = toRoute(moveSegment(wide, i, dd))
      for (const [x, y] of bends) expect(x % 10 === 0 && y % 10 === 0).toBe(true)
    }
  })
  it('does nothing when the stub would take up the whole pin run', () => {
    // u's pin runs are 12 px: the stub reaches the grid line at 60 (and 80), their far ends.
    expect(moveSegment(u, 0, 30)).toEqual(u)
    expect(moveSegment(u, 4, -30)).toEqual(u)
  })
  it('turns a straight two-pin wire into a U with a stub at each pin', () => {
    const out = moveSegment(P([0, 0], [100, 0]), 0, 40)
    expect(out).toEqual(P([0, 0], [10, 0], [10, 40], [90, 40], [90, 0], [100, 0]))
  })
  it('moves one half of a split run on its own, adding a connector instead of a diagonal', () => {
    // [60,60]..[70,60]..[80,60] is one run split by a collinear bend at 70.
    const split = P([48, 20], [60, 20], [60, 60], [70, 60], [80, 60], [80, 20], [92, 20])
    const out = moveSegment(split, 3, 20)
    expect(out).toEqual(P([48, 20], [60, 20], [60, 60], [70, 60], [70, 80], [80, 80], [80, 20], [92, 20]))
    expect(orthogonal(out)).toBe(true)
  })
  it('keeps the start and end points fixed and never returns a diagonal', () => {
    for (let i = 0; i < 5; i++)
      for (const d of [-50, -20, 10, 30]) {
        const out = moveSegment(u, i, d)
        expect(out[0]).toEqual(u[0])
        expect(out.at(-1)).toEqual(u.at(-1))
        expect(orthogonal(out)).toBe(true)
      }
  })
  it('never shortens the run on a pin past the stub when moving the run next to it', () => {
    expect(moveSegment(wide, 1, -40)).toEqual(P([48, 20], [60, 20], [60, 60], [120, 60], [120, 20], [152, 20]))
    // the run before the last one, toward the end pin
    expect(moveSegment(wide, 3, 40)).toEqual(P([48, 20], [80, 20], [80, 60], [140, 60], [140, 20], [152, 20]))
    // u's pin runs already end at the stub, so the run next to them cannot come any closer.
    expect(moveSegment(u, 1, -20)).toEqual(u)
    expect(moveSegment(u, 3, 30)).toEqual(u)
    // Moving away from the pin is not limited.
    expect(moveSegment(u, 1, 10)[1]).toEqual({ x: 70, y: 20 })
  })
  it('returns a diagonal fallback unchanged', () => {
    expect(moveSegment(diagonal, 0, 40)).toEqual(diagonal)
  })
  it('does not mutate its input', () => {
    const copy = structuredClone(u)
    moveSegment(u, 2, 40)
    expect(u).toEqual(copy)
  })
})

describe('insertBend', () => {
  const l = P([0, 0], [100, 0], [100, 60])
  it('adds a collinear vertex at the snapped projection onto the nearest segment', () => {
    expect(insertBend(l, { x: 43, y: 6 })).toEqual(P([0, 0], [40, 0], [100, 0], [100, 60]))
    expect(insertBend(l, { x: 95, y: 28 })).toEqual(P([0, 0], [100, 0], [100, 30], [100, 60]))
  })
  it('does nothing when the snapped point lands on an existing vertex', () => {
    expect(insertBend(l, { x: 99, y: 2 })).toEqual(l)
  })
  it('returns a diagonal fallback unchanged', () => {
    expect(insertBend(diagonal, { x: 170, y: 100 })).toEqual(diagonal)
  })
})

describe('removeBend', () => {
  it('drops a collinear bend', () => {
    expect(removeBend(P([0, 0], [40, 0], [100, 0]), 1)).toEqual(P([0, 0], [100, 0]))
  })
  it('collapses a U into a straight run when one of its bottom corners is removed', () => {
    const u = P([48, 20], [60, 20], [60, 60], [80, 60], [80, 20], [92, 20])
    expect(removeBend(u, 2)).toEqual(P([48, 20], [92, 20]))
  })
  it('keeps collinear bends the user added elsewhere on the wire', () => {
    const u = P([48, 20], [60, 20], [60, 60], [70, 60], [80, 60], [80, 100], [92, 100])
    // Corners next to a pin flip; the untouched collinear bend at (70, 60) stays.
    expect(removeBend(u, 1)).toEqual(P([48, 20], [48, 60], [70, 60], [80, 60], [80, 100], [92, 100]))
    expect(removeBend(u, 5)).toEqual(P([48, 20], [60, 20], [60, 60], [70, 60], [92, 60], [92, 100]))
    expect(removeBend(u, 3)).toEqual(P([48, 20], [60, 20], [60, 60], [80, 60], [80, 100], [92, 100]))
    // Flipping the corner at (60, 40) merges runs; the corners it straightens go, but the
    // user's own collinear bend at (30, 0) stays.
    expect(removeBend(P([0, 0], [30, 0], [60, 0], [60, 40], [100, 40], [100, 80], [120, 80]), 3)).toEqual(
      P([0, 0], [30, 0], [100, 0], [100, 80], [120, 80]),
    )
  })
  it('flips a staircase corner to the other side, keeping the wire orthogonal', () => {
    const stairs = P([0, 0], [20, 0], [20, 40], [60, 40], [60, 80], [100, 80])
    const out = removeBend(stairs, 3)
    expect(out).toEqual(P([0, 0], [20, 0], [20, 80], [100, 80]))
    expect(orthogonal(out)).toBe(true)
  })
  it('returns a polyline with a diagonal step unchanged', () => {
    const skew = P([0, 0], [100, 0], [110, 10], [110, 50])
    expect(removeBend(skew, 2)).toEqual(skew)
    expect(removeBend(P([0, 0], [40, 0], [300, 180]), 1)).toEqual(P([0, 0], [40, 0], [300, 180]))
  })
  it('never removes an endpoint', () => {
    const l = P([0, 0], [100, 0], [100, 60])
    expect(removeBend(l, 0)).toEqual(l)
    expect(removeBend(l, 2)).toEqual(l)
  })
  it('refuses a removal that would send the wire back over its pin', () => {
    // The sample's black wire: leaves the pin going right, then up, then far left.
    const w = P([458, 50], [478, 50], [478, 34], [110, 34], [110, 82])
    expect(removeBend(w, 2)).toEqual(w)
  })
  it('flips the corner of an L, even though the wire then leaves its pin sideways', () => {
    expect(removeBend(P([0, 0], [100, 0], [100, 60]), 1)).toEqual(P([0, 0], [0, 60], [100, 60]))
  })
  it('removes either bend of a Z', () => {
    const z = P([0, 0], [40, 0], [40, 60], [100, 60])
    expect(removeBend(z, 1)).toEqual(P([0, 0], [0, 60], [100, 60]))
    expect(removeBend(z, 2)).toEqual(P([0, 0], [100, 0], [100, 60]))
  })
})

describe('toRoute', () => {
  it('keeps only the interior points as [x, y] pairs', () => {
    expect(toRoute(P([48, 20], [60, 20], [60, 60], [92, 60]))).toEqual([[60, 20], [60, 60]])
    expect(toRoute(P([0, 0], [10, 0]))).toEqual([])
  })
})

describe('manualRouteBlocked', () => {
  const body = { x: 100, y: 0, w: 40, h: 30 }
  it('is true when a segment runs through a part body', () => {
    expect(manualRouteBlocked(P([48, 20], [200, 20]), [body])).toBe(true)
    expect(manualRouteBlocked(P([120, -20], [120, 60]), [body])).toBe(true)
  })
  it('is true for any diagonal segment, even one clear of every body', () => {
    expect(manualRouteBlocked(diagonal, [])).toBe(true)
    expect(manualRouteBlocked(P([0, 200], [10, 210]), [body])).toBe(true)
  })
  it('is false for a wire that only runs along or around a body edge', () => {
    expect(manualRouteBlocked(P([48, 0], [200, 0]), [body])).toBe(false)
    expect(manualRouteBlocked(P([48, 20], [60, 20], [60, 60], [200, 60]), [body])).toBe(false)
  })
})

describe('segmentHandleAt', () => {
  const seg = { i: 2, a: { x: 60, y: 60 }, b: { x: 100, y: 60 }, axis: 'h' as const }
  it('is the segment midpoint when the drawn wire matches the route', () => {
    expect(segmentHandleAt(seg, P([48, 20], [60, 20], [60, 60], [100, 60], [100, 20]))).toEqual({ x: 80, y: 60 })
  })
  it('follows the drawn segment where separation nudged it a few px', () => {
    expect(segmentHandleAt(seg, P([48, 20], [60, 20], [60, 64], [100, 64], [100, 20]))).toEqual({ x: 80, y: 64 })
    const v = { i: 1, a: { x: 60, y: 20 }, b: { x: 60, y: 60 }, axis: 'v' as const }
    expect(segmentHandleAt(v, P([48, 20], [56, 20], [56, 60], [100, 60]))).toEqual({ x: 56, y: 40 })
  })
  it('ignores drawn segments that are far away or do not span the midpoint', () => {
    expect(segmentHandleAt(seg, P([48, 20], [60, 20], [60, 80], [100, 80]))).toEqual({ x: 80, y: 60 })
    expect(segmentHandleAt(seg, P([0, 64], [50, 64]))).toEqual({ x: 80, y: 60 })
  })
})

describe('bendHandleAt', () => {
  it('is the bend itself when the drawn wire matches the route', () => {
    expect(bendHandleAt({ x: 60, y: 60 }, P([48, 20], [60, 20], [60, 60], [100, 60]))).toEqual({ x: 60, y: 60 })
  })
  it('follows the drawn corner where separation nudged it a few px', () => {
    expect(bendHandleAt({ x: 60, y: 60 }, P([48, 20], [64, 20], [64, 64], [100, 64]))).toEqual({ x: 64, y: 64 })
    expect(bendHandleAt({ x: 60, y: 60 }, P([48, 20], [60, 20], [60, 52], [100, 52]))).toEqual({ x: 60, y: 52 })
  })
  it('puts a collinear bend (no drawn corner) onto the nudged run', () => {
    expect(bendHandleAt({ x: 80, y: 60 }, P([48, 20], [60, 20], [60, 64], [120, 64], [120, 20]))).toEqual({ x: 80, y: 64 })
  })
  it('stays put when nothing drawn is within 8 px', () => {
    expect(bendHandleAt({ x: 60, y: 60 }, P([48, 20], [70, 20], [70, 80], [100, 80]))).toEqual({ x: 60, y: 60 })
  })
})
