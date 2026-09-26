// Wires from holes a part sits over, and the blocked fallback: no route is ever drawn as a diagonal.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeRoutes, pinTargets, routeWire, partObstacles, resolveEndpoint, validateDiagram, wirePaths, type Diagram } from './diagram.ts'
import { bodyRect, type Pt } from './geometry.ts'
import { layoutModule, validateModule, type ModuleDef } from './module.ts'
import { routeOrthogonal } from './router.ts'
import { moveParts } from '../editor/ops.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (id: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')))
  if (!r.ok) throw new Error(`${id}: ${r.errors.join('; ')}`)
  return r.module
}
const orthogonal = (pts: Pt[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)

const board = load('breadboard-full')

function sheet(part: { module: ModuleDef; x: number; y: number }, from: { pin: string; hole: number }): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { 'breadboard-full': board, [part.module.id]: part.module },
    parts: [
      { uid: 'bb', designator: 'BB1', module: 'breadboard-full', x: 0, y: 0 },
      { uid: 'u', designator: 'U1', module: part.module.id, x: part.x, y: part.y, mount: { board: 'bb' } },
    ],
    connections: [{ uid: 'w', from: { part: 'bb', ...from }, to: { part: 'bb', pin: 'top+', hole: 0 } }],
  }
}

describe('hole ends under a part', () => {
  it('routes a jumper from a hole under a resistor body orthogonally, not blocked', () => {
    const d = sheet({ module: load('resistor'), x: 30, y: 40 }, { pin: 'c1-top', hole: 0 })
    expect(resolveEndpoint(d, d.connections[0].from)!.end).toEqual({ x: 30, y: 60 })
    expect(partObstacles(d)).toEqual([{ x: 30, y: 40, w: 60, h: 40 }])
    const r = computeRoutes(d).get('w')!
    expect(r.blocked).toBe(false)
    expect(orthogonal(r.points)).toBe(true)
    expect(r.points[0]).toEqual({ x: 30, y: 60 })
    expect(r.points.at(-1)).toEqual({ x: 50, y: 20 })
  })
  it('routes a wire from a hole under a DIP-28 body', () => {
    const dip = load('mcp23017-dip28')
    const d = sheet({ module: dip, x: 60, y: 60 }, { pin: 'c10-top', hole: 4 })
    const body = bodyRect(d.parts[1], layoutModule(dip))
    const hole = resolveEndpoint(d, d.connections[0].from)!.end
    // The hole really is inside the body, not on its edge.
    expect(hole.x > body.x && hole.x < body.x + body.w && hole.y > body.y && hole.y < body.y + body.h).toBe(true)
    const r = computeRoutes(d).get('w')!
    expect(r.blocked).toBe(false)
    expect(orthogonal(r.points)).toBe(true)
  })
  it('treats a hole on an off-grid board as covered where the router starts, its grid node', () => {
    // Board 5 px left of the grid: c1-top hole 0 is at (25, 60), just outside the resistor body
    // grown by the clearance (x from 26), but its grid node (30, 60) is inside it.
    const d = sheet({ module: load('resistor'), x: 30, y: 40 }, { pin: 'c1-top', hole: 0 })
    d.parts[0] = { ...d.parts[0], x: -5 }
    d.parts[1] = { ...d.parts[1], mount: undefined }
    expect(resolveEndpoint(d, d.connections[0].from)!.end).toEqual({ x: 25, y: 60 })
    const r = computeRoutes(d).get('w')!
    expect(r.blocked).toBe(false)
    expect(orthogonal(r.points)).toBe(true)
  })
  it('still routes around a part that covers neither end', () => {
    const d = sheet({ module: load('resistor'), x: 30, y: 40 }, { pin: 'c10-top', hole: 0 })
    const r = computeRoutes(d).get('w')!
    expect(r.blocked).toBe(false)
    // The resistor body (x 30..90, y 40..80) is not crossed.
    const inside = r.points.some((p) => p.x > 30 && p.x < 90 && p.y > 40 && p.y < 80)
    expect(inside).toBe(false)
  })
})

describe('no diagonal ever', () => {
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  it('draws a blocked route as an orthogonal L, horizontal first, flagged blocked', () => {
    // Part c sits right on a's R stub, so the router cannot even leave the pin.
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { two },
      parts: [
        { uid: 'a', designator: 'A', module: 'two', x: 0, y: 0 },
        { uid: 'b', designator: 'B', module: 'two', x: 200, y: 40 },
        { uid: 'c', designator: 'C', module: 'two', x: 50, y: 0 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }],
    }
    const r = routeWire(d, d.connections[0], partObstacles(d))!
    expect(r.blocked).toBe(true)
    expect(r.points).toEqual([{ x: 48, y: 20 }, { x: 192, y: 20 }, { x: 192, y: 60 }])
    expect(computeRoutes(d).get('w')).toEqual(r)
  })
  it('keeps every route orthogonal on a crowded sheet, blocked ones included', () => {
    // Deterministic jumble of overlapping parts (some off the grid) with wires between random pins.
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
    const parts = Array.from({ length: 40 }, (_, i) => ({
      uid: `p${i}`, designator: `P${i}`, module: 'two', x: rnd(16) * 10 + (i % 7 === 0 ? 3 : 0), y: rnd(12) * 10 + (i % 5 === 0 ? 7 : 0),
      rotation: ([0, 90, 180, 270] as const)[rnd(4)],
    }))
    const connections = Array.from({ length: 60 }, (_, i) => ({
      uid: `w${i}`, from: { part: `p${rnd(40)}`, pin: rnd(2) ? 'L' : 'R' }, to: { part: `p${rnd(40)}`, pin: rnd(2) ? 'L' : 'R' },
    }))
    const routes = [...computeRoutes({ format: 'circuitoon-diagram/1', title: 't', modules: { two }, parts, connections }).values()]
    expect(routes.some((r) => r?.blocked)).toBe(true)
    for (const r of routes) expect(orthogonal(r!.points)).toBe(true)
  })
  it('starts a blocked wire from a top pin vertically, along its stub', () => {
    const vert: ModuleDef = { format: 'circuitoon-module/1', id: 'vert', name: 'Vert', pins: [{ name: 'T', side: 'top' }, { name: 'B', side: 'bottom' }] }
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { vert, two },
      parts: [
        { uid: 'a', designator: 'A', module: 'vert', x: 0, y: 100 },
        { uid: 'b', designator: 'B', module: 'two', x: 200, y: 0 },
        // Sits right on a's T stub, so the router cannot leave the pin.
        { uid: 'c', designator: 'C', module: 'two', x: 0, y: 60 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'T' }, to: { part: 'b', pin: 'L' } }],
    }
    const r = routeWire(d, d.connections[0], partObstacles(d))!
    const a0 = resolveEndpoint(d, d.connections[0].from)!.end
    const b0 = resolveEndpoint(d, d.connections[0].to)!.end
    expect(r.blocked).toBe(true)
    expect(r.points).toEqual([a0, { x: a0.x, y: b0.y }, b0])
  })
  it('puts a corner between stored bends that do not line up', () => {
    // A loaded file whose second bend is off both axes of the first.
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { two },
      parts: [
        { uid: 'a', designator: 'A', module: 'two', x: 0, y: 0 },
        { uid: 'b', designator: 'B', module: 'two', x: 200, y: 40 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' }, route: [[80, 20], [120, 60]] }],
    }
    const r = computeRoutes(d).get('w')!
    expect(r.points).toEqual([{ x: 48, y: 20 }, { x: 80, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 60 }, { x: 192, y: 60 }])
    expect(orthogonal(r.points)).toBe(true)
  })
  it('joins an off-grid pin tip to the grid without a diagonal', () => {
    // A tip between grid lines on both axes (a part loaded off the grid).
    const pts = routeOrthogonal({ from: { x: 81, y: 23 }, fromDir: { x: 1, y: 0 }, to: { x: 157, y: 67 }, toDir: { x: 0, y: -1 }, obstacles: [] })!
    expect(orthogonal(pts)).toBe(true)
    expect(pts[0]).toEqual({ x: 81, y: 23 })
    expect(pts[1].y).toBe(23) // leaves along its stub
    expect(pts.at(-1)).toEqual({ x: 157, y: 67 })
    expect(pts.at(-2)!.x).toBe(157) // arrives along its stub
  })
})

describe('a wire to a plugged leg (Ruling 25)', () => {
  const resistor = load('resistor')
  /** R1 at (30, 40): leg 1 in c1 row a (30, 60), leg 2 in c7 row a (90, 60). R2 off the board, above it. */
  function legSheet(mounted: boolean): Diagram {
    return {
      format: 'circuitoon-diagram/1', title: 't', modules: { 'breadboard-full': board, resistor },
      parts: [
        { uid: 'bb', designator: 'BB1', module: 'breadboard-full', x: 0, y: 0 },
        { uid: 'r1', designator: 'R1', module: 'resistor', x: 30, y: 40, ...(mounted ? { mount: { board: 'bb' } } : {}) },
        { uid: 'r2', designator: 'R2', module: 'resistor', x: 200, y: -120 },
      ],
      connections: [{ uid: 'w', from: { part: 'r1', pin: '1' }, to: { part: 'r2', pin: '2' } }],
    }
  }
  it('starts on the leg hole, orthogonal and not blocked', () => {
    const d = legSheet(true)
    expect(resolveEndpoint(d, d.connections[0].from)).toEqual({ end: { x: 30, y: 60 }, dir: null })
    const r = computeRoutes(d).get('w')!
    expect(r.blocked).toBe(false)
    expect(orthogonal(r.points)).toBe(true)
    expect(r.points[0]).toEqual({ x: 30, y: 60 })
  })
  it('starts at the stub tip, along the stub, when the part is not mounted', () => {
    const d = legSheet(false)
    const tip = resolveEndpoint(d, d.connections[0].from)!
    expect(tip.dir).toEqual({ x: -1, y: 0 })
    expect(tip.end.x).toBeLessThan(30)
    expect(tip.end.y).toBe(60)
    expect(computeRoutes(d).get('w')!.points[0]).toEqual(tip.end)
  })
  it('keeps the stub tip for a mount that plugs nothing (partial)', () => {
    const d = legSheet(true)
    d.parts = d.parts.map((p) => (p.uid === 'r1' ? { ...p, x: 35 } : p))
    expect(resolveEndpoint(d, d.connections[0].from)!.dir).toEqual({ x: -1, y: 0 })
  })
  it('carries the wire end with the leg when the board moves', () => {
    const d = moveParts(legSheet(true), ['bb'], 50, 30)
    expect(d.parts[1]).toMatchObject({ x: 80, y: 70 })
    const r = computeRoutes(d).get('w')!
    expect(r.points[0]).toEqual({ x: 80, y: 90 })
    expect(r.blocked).toBe(false)
    expect(orthogonal(r.points)).toBe(true)
  })
  it('keeps a hand-routed wire orthogonal from the leg hole', () => {
    const d = legSheet(true)
    d.connections = [{ ...d.connections[0], route: [[100, -40]] }]
    const r = computeRoutes(d).get('w')!
    expect(r.points[0]).toEqual({ x: 30, y: 60 })
    expect(orthogonal(r.points)).toBe(true)
  })
  it("puts a plugged leg's hit target on its own hole, not by the neighbouring one", () => {
    const d = legSheet(true)
    const targets = pinTargets(d, d.parts[1], resistor)
    expect(Object.fromEntries(targets.map((t) => [t.name, t.at]))).toEqual({ '1': { x: 30, y: 60 }, '2': { x: 90, y: 60 } })
  })
  it('does not flag a wire from a plugged leg blocked when separation nudges it inside that part', () => {
    // An earlier wire runs down x = 50 inside R1's body; the leg wire's second segment shares that
    // lane, so separation nudges it. R1 covers the leg's hole, so (as in routeWire) R1 is no
    // obstacle for this wire and the nudged wire stays clear.
    const d = legSheet(true)
    d.connections = [
      { uid: 'w0', from: { part: 'bb', pin: 'c20-top', hole: 0 }, to: { part: 'bb', pin: 'c20-top', hole: 4 }, route: [[220, 50], [50, 50], [50, 90], [220, 90]] },
      { ...d.connections[0], route: [[50, 60], [50, 70], [300, 70]] },
    ]
    const routes = computeRoutes(d)
    expect(routes.get('w')!.blocked).toBe(false)
    const drawn = wirePaths(d, routes).find((w) => w.conn.uid === 'w')!
    expect(drawn.points.some((p, i) => p.x !== routes.get('w')!.points[i]?.x)).toBe(true) // it was nudged
    expect(drawn.blocked).toBe(false)
  })
  it('keeps the hit target at the stub tip for an unplugged leg', () => {
    const partial = legSheet(true)
    partial.parts = partial.parts.map((p) => (p.uid === 'r1' ? { ...p, x: 35 } : p))
    for (const d of [legSheet(false), partial]) {
      const part = d.parts[1]
      const targets = pinTargets(d, part, resistor)
      expect(targets.map((t) => t.at)).toEqual(targets.map((t) => resolveEndpoint(d, { part: part.uid, pin: t.name })!.end))
      expect(targets.find((t) => t.name === '1')!.at.x).toBeLessThan(part.x)
    }
  })
})

describe('huge coordinates (B1)', () => {
  it('loads two hole ends 10^12 px apart clamped, with a warning, and routes them in well under a second', () => {
    const raw = {
      format: 'circuitoon-diagram/1', title: 't', modules: { 'breadboard-full': board },
      parts: [
        { uid: 'a', designator: 'BB1', module: 'breadboard-full', x: 0, y: 0 },
        { uid: 'b', designator: 'BB2', module: 'breadboard-full', x: 1e12, y: 1e12 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'c1-top', hole: 0 }, to: { part: 'b', pin: 'c1-top', hole: 0 } }],
    }
    const r = validateDiagram(raw)
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.warnings.some((w) => w.includes('clamped'))).toBe(true)
    expect(Math.abs(r.diagram.parts[1].x)).toBeLessThanOrEqual(100_000)
    const t = performance.now()
    const routes = computeRoutes(r.diagram)
    wirePaths(r.diagram, routes)
    expect(performance.now() - t).toBeLessThan(500)
    expect(routes.get('w')).not.toBeNull()
  })
})
