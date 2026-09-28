// The router keeps wires off part captions and frame labels (amendment A18.3), and like hole
// avoidance this never blocks a wire: when no route clears the labels, one over them is drawn.
import { describe, expect, it } from 'vitest'
import { type Annotation, type Diagram, type PartInstance, computeRoutes, partObstacles, routeAvoid, routeWire } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import type { Pt, Rect } from './geometry.ts'
import { captionBox } from '../render/captionBox.ts'
import { annotationRect, frameTab } from '../render/annotationGeometry.ts'

/** Two-lead part, body 40 x 30: L edge at local (0, 20), R edge at local (40, 20), stubs 8 px out. */
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}
const part = (uid: string, x: number, y: number): PartInstance => ({ uid, designator: uid, module: 'two', x, y })
/** A.R faces B.L on y = 20, from x = 48 to x = 292: with nothing in the way, one straight wire. */
const sheet = (extra: PartInstance[] = [], annotations: Annotation[] = []): Diagram => ({
  format: 'circuitoon-diagram/1', title: 'labels', modules: { two },
  parts: [part('A', 0, 0), part('B', 300, 0), ...extra],
  connections: [{ uid: 'w1', from: { part: 'A', pin: 'R' }, to: { part: 'B', pin: 'L' } }],
  ...(annotations.length ? { annotations } : {}),
})
const route = (d: Diagram) => computeRoutes(d).get('w1')!
/** True when any segment of `pts` passes through `r` (edges included). */
const crosses = (pts: Pt[], r: Rect) =>
  pts.slice(1).some((b, i) => {
    const a = pts[i]
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)]
    return x1 >= r.x && x0 <= r.x + r.w && y1 >= r.y && y0 <= r.y + r.h
  })

describe('router label avoidance (A18.3)', () => {
  it('routes straight when no label is in the way', () => {
    expect(route(sheet()).points).toEqual([{ x: 48, y: 20 }, { x: 292, y: 20 }])
  })
  it('routes around a frame label in the way', () => {
    const frame: Annotation = { uid: 'a1', type: 'frame', x: 140, y: 20, w: 60, h: 100, label: 'grp' }
    const tab = frameTab(frame)
    expect(crosses([{ x: 48, y: 20 }, { x: 292, y: 20 }], tab)).toBe(true)
    const r = route(sheet([], [frame]))
    expect(r.blocked).toBe(false)
    expect(crosses(r.points, tab)).toBe(false)
  })
  it('routes around a text note in the way', () => {
    const note: Annotation = { uid: 'a1', type: 'text', x: 140, y: 0, text: 'A note in the way' }
    const box = annotationRect(note)
    expect(crosses([{ x: 48, y: 20 }, { x: 292, y: 20 }], box)).toBe(true)
    const r = route(sheet([], [note]))
    expect(r.blocked).toBe(false)
    expect(crosses(r.points, box)).toBe(false)
  })
  it('never blocks a wire for a note: over one no route can clear, it is still routed', () => {
    const note: Annotation = { uid: 'a1', type: 'text', x: -1500, y: -10, text: 'x'.repeat(500) }
    const r = route({ ...sheet([], [note]), parts: [part('A', 0, -200), part('B', 0, 200)], connections: [{ uid: 'w1', from: { part: 'A', pin: 'R' }, to: { part: 'B', pin: 'L' } }] })
    expect(r.blocked).toBe(false)
    expect(crosses(r.points, annotationRect(note))).toBe(true)
  })
  it("routes around another part's caption in the way", () => {
    const c = part('C', 150, 0)
    const box = captionBox(c, two)
    const moved = { ...c, y: 20 - (box.y + box.h / 2) }
    const cap = captionBox(moved, two)
    expect(crosses([{ x: 48, y: 20 }, { x: 292, y: 20 }], cap)).toBe(true)
    const r = route(sheet([moved]))
    expect(r.blocked).toBe(false)
    expect(crosses(r.points, cap)).toBe(false)
  })
  it('never blocks a wire: over a label no route can clear, it is still routed', () => {
    // A label tab 3,000 px wide across the path: every route between the pins crosses it.
    const frame: Annotation = { uid: 'a1', type: 'frame', x: -1500, y: 20, w: 3000, h: 100, label: 'x'.repeat(540) }
    const r = route({ ...sheet([], [frame]), parts: [part('A', 0, -200), part('B', 0, 200)], connections: [{ uid: 'w1', from: { part: 'A', pin: 'R' }, to: { part: 'B', pin: 'L' } }] })
    expect(r.blocked).toBe(false)
    expect(crosses(r.points, frameTab(frame))).toBe(true)
  })
  it('drops label avoidance before hole avoidance when no route clears both', () => {
    // A wall across the path at x = 170: other strips' holes above y = 20, label text below it.
    // Every route between the pins crosses the wall, so it crosses either holes or text; the router
    // gives up the text first (a wire over a hole reads as plugged in there).
    const ys = (from: number, to: number) => Array.from({ length: (to - from) / 10 + 1 }, (_, i) => from + i * 10)
    const holeWall = ys(-4000, 20).map((y) => ({ x: 170, y }))
    const textWall = ys(30, 4000).map((y) => ({ x: 170, y }))
    const d = sheet()
    const holes = { groups: [{ key: JSON.stringify(['X', 'strip']), at: holeWall }], legGroup: new Map<string, string>() }
    const r = routeWire(d, d.connections[0], partObstacles(d), undefined, routeAvoid(d, holes, { captions: new Map(), tabs: textWall }))!
    expect(r.blocked).toBe(false)
    const wall = (pts: { x: number; y: number }[]) => ({ x: 170, y: Math.min(...pts.map((p) => p.y)), w: 0, h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) })
    expect(crosses(r.points, wall(holeWall))).toBe(false)
    expect(crosses(r.points, wall(textWall))).toBe(true)
  })
})

describe('wires over holes they do not use (fallback flag)', () => {
  const ys = (from: number, to: number) => Array.from({ length: (to - from) / 10 + 1 }, (_, i) => from + i * 10)
  const strip = (at: Pt[]) => ({ groups: [{ key: JSON.stringify(['X', 'strip']), at }], legGroup: new Map<string, string>() })
  const noText = { captions: new Map<string, Pt[]>(), tabs: [] }
  it('is not set on a route that clears every hole', () => {
    const d = sheet()
    const r = routeWire(d, d.connections[0], partObstacles(d), undefined, routeAvoid(d, strip([{ x: 170, y: 20 }]), noText))!
    expect(r.blocked).toBe(false)
    expect(r.fallback).toBeUndefined()
  })
  it('is set when no route clears the holes and the wire is routed over them', () => {
    const d = sheet()
    const r = routeWire(d, d.connections[0], partObstacles(d), undefined, routeAvoid(d, strip(ys(-4000, 4000).map((y) => ({ x: 170, y }))), noText))!
    expect(r.blocked).toBe(false)
    expect(r.fallback).toBe(true)
  })
  it('is set on a hand-drawn route across a hole of a strip the wire does not use, and not on one that misses it', () => {
    const d = sheet()
    const over = { ...d.connections[0], route: [[120, 20], [220, 20]] as [number, number][] }
    expect(routeWire(d, over, partObstacles(d), undefined, routeAvoid(d, strip([{ x: 170, y: 20 }]), noText))!.fallback).toBe(true)
    const clear = { ...d.connections[0], route: [[120, 20], [120, 80], [220, 80], [220, 20]] as [number, number][] }
    expect(routeWire(d, clear, partObstacles(d), undefined, routeAvoid(d, strip([{ x: 170, y: 20 }]), noText))!.fallback).toBeUndefined()
  })
})
