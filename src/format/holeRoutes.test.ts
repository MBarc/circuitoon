// Wires from holes a part sits over, and the blocked fallback: no route is ever drawn as a diagonal.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeRoutes, routeWire, partObstacles, resolveEndpoint, type Diagram } from './diagram.ts'
import { bodyRect, type Pt } from './geometry.ts'
import { layoutModule, validateModule, type ModuleDef } from './module.ts'
import { routeOrthogonal } from './router.ts'

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
