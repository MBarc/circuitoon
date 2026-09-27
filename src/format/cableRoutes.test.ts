// Wires with connectors leave a pin straight along its axis for at least the connector's reach,
// so the connector always sits on a full-length straight end segment, even from an off-grid pin.
import { describe, expect, it } from 'vitest'
import { partObstacles, resolveEndpoint, routeWire, routingKey, wirePaths, type Connection, type Diagram } from './diagram.ts'
import { manualRouteBlocked } from './wireEdit.ts'
import { END_SIZE, endPlacement, type EndKind } from './cables.ts'
import type { ModuleDef } from './module.ts'
import type { Pt, Rotation } from './geometry.ts'
import { routeOrthogonal } from './router.ts'

const quad: ModuleDef = {
  format: 'circuitoon-module/1', id: 'quad', name: 'Quad',
  pins: [{ name: 'T', side: 'top' }, { name: 'R', side: 'right' }, { name: 'B', side: 'bottom' }, { name: 'L', side: 'left' }],
}
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}

function sheet(pin: string, kind: EndKind, rotation: Rotation = 0, far = { x: 400, y: 400 }, route?: [number, number][]): Diagram {
  const c: Connection = { uid: 'w', from: { part: 'q', pin }, to: { part: 'f', pin: 'L' }, ends: { from: kind, to: kind } }
  if (route) c.route = route
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { quad, two },
    // Off the grid on both axes, so every pin tip is too.
    parts: [
      { uid: 'q', designator: 'Q', module: 'quad', x: 203, y: 204, rotation },
      { uid: 'f', designator: 'F', module: 'two', x: far.x + 7, y: far.y + 3 },
    ],
    connections: [c],
  }
}

function expectFullLength(d: Diagram, which: 'from' | 'to' = 'from') {
  const [w] = wirePaths(d)
  const kind = d.connections[0].ends![which]!
  const pts = which === 'from' ? w.points : [...w.points].reverse()
  const ep = resolveEndpoint(d, d.connections[0][which])!
  const run = Math.abs(pts[1].x - pts[0].x) + Math.abs(pts[1].y - pts[0].y)
  expect(run).toBeGreaterThanOrEqual(END_SIZE[kind].reach)
  const place = endPlacement(w.points, which, END_SIZE[kind].reach)!
  expect(place.scale).toBe(1)
  // The connector faces back along the wire, which leaves along the pin.
  expect(place.back).toEqual(ep.dir)
  expect(w.cables[which === 'from' ? 0 : 1]).toMatchObject({ scale: 1, back: ep.dir })
  // Never doubling back on itself.
  for (let i = 2; i < w.points.length; i++) {
    const [a, b, c] = [w.points[i - 2], w.points[i - 1], w.points[i]]
    expect((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)).toBeGreaterThanOrEqual(0)
  }
}

describe('cable ends on off-grid pins', () => {
  for (const pin of ['T', 'R', 'B', 'L'])
    for (const kind of ['dupont-male', 'alligator', 'banana', 'jst-sh'] as EndKind[])
      it(`gives a ${kind} on the ${pin} pin its full reach`, () => {
        expectFullLength(sheet(pin, kind))
        expectFullLength(sheet(pin, kind, 0, { x: -300, y: -250 }))
      })
  for (const rotation of [90, 180, 270] as Rotation[])
    it(`does so on a part rotated ${rotation} degrees`, () => {
      for (const pin of ['T', 'R', 'B', 'L']) expectFullLength(sheet(pin, 'alligator', rotation))
    })
  it('gives the far end its full reach too', () => {
    expectFullLength(sheet('R', 'banana'), 'to')
    expectFullLength(sheet('R', 'banana', 0, { x: -300, y: -250 }), 'to')
  })
  it('keeps a plain wire from an off-grid pin as it was: a short jog onto the grid', () => {
    const d = sheet('R', 'dupont-male')
    delete d.connections[0].ends
    const [w] = wirePaths(d)
    const run = Math.abs(w.points[1].x - w.points[0].x) + Math.abs(w.points[1].y - w.points[0].y)
    expect(run).toBeLessThan(10)
  })
  it('gives a hand-routed wire a straight lead-out when its first bend is too close', () => {
    // The first stored bend is 2 px past the tip: the lead-out still runs the connector's reach.
    const d = sheet('R', 'dupont-male')
    const tip = resolveEndpoint(d, d.connections[0].from)!.end
    const manual = sheet('R', 'dupont-male', 0, { x: 400, y: 400 }, [[tip.x + 2, tip.y], [tip.x + 2, 300], [380, 300]])
    expectFullLength(manual)
    expectFullLength(manual, 'to')
    // A bend behind the lead-out is reached by turning off it, never by doubling back over it.
    const back = sheet('R', 'dupont-male', 0, { x: 400, y: 400 }, [[tip.x + 5, tip.y], [tip.x + 5, 350], [100, 350], [100, 423]])
    const [w] = wirePaths(back)
    expectFullLength(back)
    for (let i = 2; i < w.points.length; i++) {
      const a = w.points[i - 2], b = w.points[i - 1], c = w.points[i]
      const reverses = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
      expect(reverses).toBe(false)
    }
  })
  it('routes two facing pins in line straight, sharing the run', () => {
    const d = sheet('R', 'dupont-male')
    const tip = resolveEndpoint(d, d.connections[0].from)!.end
    // Put F's L pin tip on the same line, 40 px away.
    const f = d.parts[1]
    const ftip = resolveEndpoint(d, d.connections[0].to)!.end
    f.x += tip.x + 40 - ftip.x
    f.y += tip.y - ftip.y
    const [w] = wirePaths(d)
    expect(w.points).toHaveLength(2)
  })
  it('hooks round to arrive along a lead-out that starts behind the other pin, never doubling back', () => {
    // A 9V's + (tip 420,412, up) clipped to a resistor's left lead (tip 432,350, facing left): the
    // lead-out in front of the resistor starts left of the battery terminal.
    const obstacles = [{ x: 400, y: 420, w: 80, h: 90 }, { x: 440, y: 330, w: 60, h: 40 }]
    const pts = routeOrthogonal({ from: { x: 420, y: 412 }, fromDir: { x: 0, y: -1 }, to: { x: 432, y: 350 }, toDir: { x: -1, y: 0 }, obstacles, fromLead: 30, toLead: 30 })!
    const reverses = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    for (let i = 2; i < pts.length; i++) expect(reverses(pts[i - 2], pts[i - 1], pts[i])).toBe(false)
    const last = pts.length - 1
    expect(pts[last].x - pts[last - 1].x).toBeGreaterThanOrEqual(29)
    expect(pts[last - 1].y).toBe(350)
    expect(pts[0].y - pts[1].y).toBeGreaterThanOrEqual(29)
  })
  it('re-routes when a cable end changes', () => {
    const a = sheet('R', 'bare')
    const b = sheet('R', 'banana')
    expect(routingKey(a.connections)).not.toBe(routingKey(b.connections))
  })
})

describe('lead-outs never tunnel through a part', () => {
  const block: ModuleDef = { format: 'circuitoon-module/1', id: 'block', name: 'Block', size: { w: 3, h: 4 }, pins: [{ name: 'P', side: 'top' }] }
  const base = (bx: number, by: number, rotated = false): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { two, block },
    parts: [
      { uid: 'a', designator: 'A', module: 'two', x: 2, y: 0 }, // R tip at (50, 20), facing right
      rotated ? { uid: 'k', designator: 'K', module: 'two', x: bx, y: by, rotation: 90 } : { uid: 'k', designator: 'K', module: 'block', x: bx, y: by },
      { uid: 'b', designator: 'B', module: 'two', x: 300, y: 100 },
    ],
    connections: [{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' }, ends: { from: 'alligator' } }],
  })
  it('does not accept a lead-out running through a body right in front of the pin', () => {
    // A part turned 90 degrees spans x 55..85, y -10..30, across the pin's line: the search would
    // start past it at x=90, so the 30 px lead-out would pass straight through it.
    const d = base(55, 0, true)
    expect(partObstacles(d)[1]).toEqual({ x: 55, y: -10, w: 30, h: 40 })
    const r = routeWire(d, d.connections[0], partObstacles(d))!
    expect(r.blocked || !manualRouteBlocked(r.points, partObstacles(d))).toBe(true)
  })
  it('drops the lead-out, not the route, when only the lead-out is blocked', () => {
    // A body on the lead-out's line past the first grid node: a plain route turns before it.
    const d = base(66, 0)
    const r = routeWire(d, d.connections[0], partObstacles(d))!
    expect(r.blocked).toBe(false)
    expect(manualRouteBlocked(r.points, partObstacles(d))).toBe(false)
  })
})
