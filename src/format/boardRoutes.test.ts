// Ruling W1 (sharpening C1): a breadboard with parts mounted on it is in the way of every wire that
// does not end on it, empty holes included: wires route around it. A wire that ends on it enters by
// one straight run from the board edge nearest its hole. A board with nothing mounted is still a
// flat surface wires may cross (C1). No rule ever blocks a wire: when no route keeps off a
// populated board, the wire crosses it, flagged `overBoard`, and the readability check reports it.
import { describe, expect, it } from 'vitest'
import { type Diagram, type PartInstance, computeRoutes, moduleOf, obstaclesFor, partObstacles, resolveEndpoint, wirePaths } from './diagram.ts'
import { manualRouteBlocked } from './wireEdit.ts'
import { type Pt, type Rect, bodyRect } from './geometry.ts'
import { layoutModule } from './module.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { readabilityFindings } from '../agent/readabilityWarnings.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const led = (): Diagram => {
  const r = layoutNetlist(ledNetlist())
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}
const rectOf = (d: Diagram, uid: string): Rect => {
  const p = d.parts.find((x) => x.uid === uid)!
  return bodyRect(p, layoutModule(moduleOf(d, p.module)!))
}
/** Length of the polyline strictly inside `r`. */
const insideLength = (pts: Pt[], r: Rect) => {
  let n = 0
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    if (a.y === b.y && a.y > r.y && a.y < r.y + r.h) n += Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.w) - Math.max(Math.min(a.x, b.x), r.x))
    if (a.x === b.x && a.x > r.x && a.x < r.x + r.w) n += Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.h) - Math.max(Math.min(a.y, b.y), r.y))
  }
  return n
}
/** Two loose resistors, one left and one right of BB1, wired to each other straight across it. */
const across = (d: Diagram, y?: number): Diagram => {
  const bb = rectOf(d, 'BB1')
  const at = y ?? Math.round((bb.y + bb.h / 2) / 10) * 10
  const ra: PartInstance = { uid: 'RA', designator: 'RA', module: 'resistor', x: bb.x - 140, y: at - 20 }
  const rb: PartInstance = { uid: 'RB', designator: 'RB', module: 'resistor', x: bb.x + bb.w + 80, y: at - 20 }
  return {
    ...d,
    modules: { ...d.modules, resistor: libraryLookup('resistor')! },
    parts: [...d.parts, ra, rb],
    connections: [...d.connections, { uid: 'x', from: { part: 'RA', pin: '2' }, to: { part: 'RB', pin: '1' } }],
  }
}

describe('a populated breadboard in the way', () => {
  it('a wire between two parts beside it routes around it, never over its empty holes', () => {
    const d = across(led())
    const r = computeRoutes(d).get('x')!
    expect(r.blocked).toBe(false)
    expect(r.overBoard).toBeUndefined()
    expect(insideLength(r.points, rectOf(d, 'BB1'))).toBe(0)
  })
  it('a board with nothing mounted is still crossed straight (Ruling C1)', () => {
    const base = led()
    const empty: Diagram = { ...base, parts: base.parts.filter((p) => !p.mount), connections: [] }
    const r = computeRoutes(across(empty)).get('x')!
    expect(insideLength(r.points, rectOf(empty, 'BB1'))).toBeGreaterThan(0)
  })
  it('a wire ending on it enters by one straight run from the nearest edge', () => {
    const d = led()
    const bb = rectOf(d, 'BB1')
    const routes = computeRoutes(d)
    const onBoard = d.connections.filter((c) => (c.from.part === 'BB1') !== (c.to.part === 'BB1'))
    expect(onBoard.length).toBeGreaterThan(0)
    for (const c of onBoard) {
      const pts = routes.get(c.uid)!.points
      const hole = resolveEndpoint(d, c.from.part === 'BB1' ? c.from : c.to)!.end
      const path = c.from.part === 'BB1' ? pts : [...pts].reverse()
      expect(path[0]).toEqual(hole)
      // Everything after the first run lies outside the board.
      expect(insideLength(path.slice(1), bb), c.uid).toBe(0)
      // That run heads straight for the nearest edge.
      const dx = Math.sign(path[1].x - hole.x)
      const dy = Math.sign(path[1].y - hole.y)
      const toEdge = dx < 0 ? hole.x - bb.x : dx > 0 ? bb.x + bb.w - hole.x : dy < 0 ? hole.y - bb.y : bb.y + bb.h - hole.y
      const nearest = Math.min(hole.x - bb.x, bb.x + bb.w - hole.x, hole.y - bb.y, bb.y + bb.h - hole.y)
      expect(toEdge, c.uid).toBeLessThanOrEqual(nearest + 20)
    }
  })
  it('never blocks a wire: with no way around, it crosses the board, flagged and reported', () => {
    const base = led()
    const bb = rectOf(base, 'BB1')
    // RA sits on the board's surface (not mounted), so no route can keep off the board.
    const d = across(base)
    const ra = d.parts.find((p) => p.uid === 'RA')!
    ra.x = bb.x + 40
    ra.y = bb.y + bb.h / 2 - 20
    const routes = computeRoutes(d)
    const r = routes.get('x')!
    expect(r.blocked).toBe(false)
    expect(r.overBoard).toBe(true)
    expect(readabilityFindings(d, routes).some((f) => f.rule === 'wire-over-board' && f.wires.includes('x'))).toBe(true)
  })
  it('blocks a wire whose every straight way out of its hole runs through a part, as routed and as drawn', () => {
    // Four loose resistors box in the hole BT1 + is wired to (c6-top hole 1): each straight run from
    // it to the board's edge crosses a body.
    const base = led()
    const c = base.connections.find((x) => x.from.part === 'BT1' && x.from.pin === '+')!
    const h = resolveEndpoint(base, c.to)!.end
    const res = (uid: string, x: number, y: number): PartInstance => ({ uid, designator: uid, module: 'resistor', x, y })
    const d: Diagram = {
      ...base,
      modules: { ...base.modules, resistor: libraryLookup('resistor')! },
      parts: [...base.parts, res('X1', h.x - 75, h.y - 20), res('X2', h.x + 15, h.y - 20), res('X3', h.x - 30, h.y - 55), res('X4', h.x - 30, h.y + 15)],
    }
    const routes = computeRoutes(d)
    const r = routes.get(c.uid)!
    const own = obstaclesFor(partObstacles(d), resolveEndpoint(d, c.from)!, resolveEndpoint(d, c.to)!)
    expect(manualRouteBlocked(r.points, own)).toBe(true)
    expect(r.blocked).toBe(true)
    expect(wirePaths(d, routes).find((w) => w.conn.uid === c.uid)!.blocked).toBe(true)
    // Every route reported clear is clear.
    for (const w of d.connections) {
      const rw = routes.get(w.uid)!
      if (!rw.blocked) expect(manualRouteBlocked(rw.points, obstaclesFor(partObstacles(d), resolveEndpoint(d, w.from)!, resolveEndpoint(d, w.to)!)), w.uid).toBe(false)
    }
  })
})
