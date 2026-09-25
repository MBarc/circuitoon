import { describe, expect, it } from 'vitest'
import { addToOccupancy, routeOrthogonal, occupancyOf } from './router.ts'
import type { Pt, Rect } from './geometry.ts'

/** Axis-aligned segments of a route, skipping the first and last (they attach to pins). */
function interiorSegments(pts: Pt[]) {
  const segs: { axis: 'h' | 'v'; at: number; lo: number; hi: number }[] = []
  for (let i = 2; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i]
    if (a.y === b.y) segs.push({ axis: 'h', at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
    else if (a.x === b.x) segs.push({ axis: 'v', at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
  }
  return segs
}
function sharesInteriorRun(a: Pt[], b: Pt[]) {
  const segsA = interiorSegments(a)
  const segsB = interiorSegments(b)
  return segsA.some((sa) => segsB.some((sb) => sa.axis === sb.axis && sa.at === sb.at && Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo) > 0))
}

const right = { x: 1, y: 0 }
const left = { x: -1, y: 0 }
const up = { x: 0, y: -1 }
const down = { x: 0, y: 1 }

function orthogonal(pts: Pt[]) {
  return pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)
}
function crosses(pts: Pt[], r: Rect) {
  // Samples every segment each pixel and checks for points strictly inside the rect.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true
    }
  }
  return false
}

describe('routeOrthogonal', () => {
  it('draws a straight wire between facing pins', () => {
    expect(routeOrthogonal({ from: { x: 48, y: 20 }, fromDir: right, to: { x: 92, y: 20 }, toDir: left, obstacles: [] }))
      .toEqual([{ x: 48, y: 20 }, { x: 92, y: 20 }])
  })
  it('goes around an obstacle, orthogonally, without entering it', () => {
    const wall: Rect = { x: 60, y: -40, w: 20, h: 100 }
    const pts = routeOrthogonal({ from: { x: 48, y: 20 }, fromDir: right, to: { x: 132, y: 20 }, toDir: left, obstacles: [wall] })!
    expect(pts).not.toBeNull()
    expect(orthogonal(pts)).toBe(true)
    expect(crosses(pts, wall)).toBe(false)
    expect(pts[0]).toEqual({ x: 48, y: 20 })
    expect(pts[pts.length - 1]).toEqual({ x: 132, y: 20 })
  })
  it('prefers fewer bends over a slightly shorter path', () => {
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 100, y: 58 }, toDir: up, obstacles: [] })!
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 58 }])
  })
  it('returns null when the target is walled in', () => {
    const box: Rect[] = [
      { x: 180, y: -60, w: 120, h: 20 }, { x: 180, y: 80, w: 120, h: 20 },
      { x: 180, y: -60, w: 20, h: 160 }, { x: 280, y: -60, w: 20, h: 160 },
    ]
    expect(routeOrthogonal({ from: { x: 0, y: 20 }, fromDir: right, to: { x: 232, y: 20 }, toDir: right, obstacles: box }, { margins: [60] })).toBeNull()
  })
  it('routes 20 wires across a 200-part sheet quickly', () => {
    const parts: Rect[] = []
    for (let r = 0; r < 10; r++) for (let c = 0; c < 20; c++) parts.push({ x: c * 100, y: r * 100, w: 60, h: 40 })
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) {
      const pts = routeOrthogonal({
        from: { x: 68, y: 20 + (i % 10) * 100 }, fromDir: right,
        to: { x: 1492 - (i % 5) * 100, y: 920 - (i % 10) * 100 }, toDir: left, obstacles: parts,
      })
      expect(pts).not.toBeNull()
    }
    expect(performance.now() - t0).toBeLessThan(400)
  })
  it('gives up quickly on endpoints too far apart to search', () => {
    const t0 = performance.now()
    const far = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 200000, y: 200000 }, toDir: left, obstacles: [] })
    const wide = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 200000, y: 0 }, toDir: left, obstacles: [] })
    expect(far).toBeNull()
    expect(wide).toBeNull()
    expect(performance.now() - t0).toBeLessThan(50)
  })
  it('returns null when facing tips share a grid cell inside an obstacle', () => {
    const obstacles = [{ x: 40, y: 10, w: 20, h: 20 }]
    expect(routeOrthogonal({ from: { x: 48, y: 20 }, fromDir: right, to: { x: 52, y: 20 }, toDir: left, obstacles })).toBeNull()
  })

  describe('occupancy', () => {
    // A wall forces both wires to detour the same way: over the top, across, and back down.
    // Like adjacent header pins 10 px apart, both routes' shortest paths coincide on that detour.
    const wall: Rect = { x: 40, y: -20, w: 20, h: 150 }
    const req = (fromY: number, toY: number, occupied?: ReturnType<typeof occupancyOf>) => ({
      from: { x: 0, y: fromY }, fromDir: right, to: { x: 100, y: toY }, toDir: left, obstacles: [wall], occupied,
    })

    it('lets the shortest paths of two parallel routes overlap without occupancy', () => {
      const p1 = routeOrthogonal(req(0, 0))!
      const p2 = routeOrthogonal(req(10, 10))!
      expect(sharesInteriorRun(p1, p2)).toBe(true)
    })

    it('gives the second route its own lane when it sees the first route as occupied', () => {
      const p1 = routeOrthogonal(req(0, 0))!
      const occ = occupancyOf([p1])
      const p2 = routeOrthogonal(req(10, 10, occ))!
      expect(orthogonal(p2)).toBe(true)
      expect(crosses(p2, wall)).toBe(false)
      expect(sharesInteriorRun(p1, p2)).toBe(false)
    })

    it('still reaches adjacent facing pins 10 px apart when the shared cell is occupied', () => {
      // Pin pair at x=0/10, facing each other, 10 px apart vertically: the very first and last
      // steps necessarily land on grid nodes the other wire already used, and must not be blocked.
      const p1 = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 20, y: 0 }, toDir: left, obstacles: [] })!
      const occ = occupancyOf([p1])
      const p2 = routeOrthogonal({ from: { x: 0, y: 10 }, fromDir: right, to: { x: 20, y: 10 }, toDir: left, obstacles: [], occupied: occ })
      expect(p2).not.toBeNull()
    })

    it('records each run on its own axis, keeps earlier runs as it grows, and stores far-off runs too', () => {
      const occ = occupancyOf([[{ x: 0, y: 0 }, { x: 30, y: 0 }]])
      addToOccupancy(occ, [{ x: 30, y: -2000 }, { x: 30, y: 4000 }]) // grows the dense grid
      addToOccupancy(occ, [{ x: 9_000_000, y: 50 }, { x: 9_000_020, y: 50 }]) // past the dense limit
      addToOccupancy(occ, [{ x: 48, y: 5 }, { x: 48, y: 25 }]) // off the grid: nothing the search visits
      expect([occ.at(0, 0), occ.at(10, 0), occ.at(30, 0), occ.at(40, 0)]).toEqual([1, 1, 3, 0])
      expect([occ.at(30, -2000), occ.at(30, 4000), occ.at(30, 4010)]).toEqual([2, 2, 0])
      expect([occ.at(9_000_000, 50), occ.at(9_000_020, 50), occ.at(9_000_030, 50)]).toEqual([1, 1, 0])
      expect(occ.at(48, 10)).toBe(0)
      expect(occ.size).toBe(4 + 600 + 3) // the vertical run shares (30, 0) with the first
      const out = new Uint8Array(4 * 2)
      occ.copyWindow(8_999_990, 40, 4, 2, 10, out)
      expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
      occ.copyWindow(-10, -10, 4, 2, 10, out)
      expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
    })

    it('adds no cost for crossing an occupied run perpendicular to the path', () => {
      // A horizontal run occupied at y=50 from x=0 to x=100; a straight vertical route from
      // (50,0) to (50,100) crosses it at a right angle, never running along it on the same axis.
      const occ = occupancyOf([[{ x: 0, y: 50 }, { x: 100, y: 50 }]])
      const plain = routeOrthogonal({ from: { x: 50, y: 0 }, fromDir: down, to: { x: 50, y: 100 }, toDir: up, obstacles: [] })
      const withOcc = routeOrthogonal({ from: { x: 50, y: 0 }, fromDir: down, to: { x: 50, y: 100 }, toDir: up, obstacles: [], occupied: occ })
      expect(withOcc).toEqual(plain)
    })
  })
})

describe('free-direction ends (holes)', () => {
  it('leaves a free start in whichever direction reaches the goal straight', () => {
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 100, y: 0 }, toDir: left, obstacles: [] })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 0, y: -100 }, toDir: down, obstacles: [] })).toEqual([{ x: 0, y: 0 }, { x: 0, y: -100 }])
  })
  it('joins two free ends with a single bend', () => {
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 50, y: 30 }, toDir: null, obstacles: [] })!
    expect(pts).toHaveLength(3)
    expect(orthogonal(pts)).toBe(true)
    expect(pts[2]).toEqual({ x: 50, y: 30 })
  })
  it('arrives at a free goal from any side', () => {
    // The pin leaves right and may not reverse, so it comes back to the hole from the right.
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 0, y: 30 }, toDir: null, obstacles: [] })).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ])
  })
  it('still goes around obstacles from a free start', () => {
    const block = { x: 40, y: -20, w: 20, h: 40 }
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 100, y: 0 }, toDir: null, obstacles: [block] })!
    expect(orthogonal(pts)).toBe(true)
    expect(crosses(pts, block)).toBe(false)
  })
})
