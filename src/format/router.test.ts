import { describe, expect, it } from 'vitest'
import { routeOrthogonal } from './router.ts'
import type { Pt, Rect } from './geometry.ts'

const right = { x: 1, y: 0 }
const left = { x: -1, y: 0 }
const up = { x: 0, y: -1 }

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
})
