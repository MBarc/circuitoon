import { describe, expect, it } from 'vitest'
import { computeRoutes, wireColor, wireWidth, wirePaths, type Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'

describe('wire color and gauge', () => {
  it('takes named colors and hex, falls back to black', () => {
    expect(wireColor('red')).toBe('#E0483E')
    expect(wireColor('#12ab9F')).toBe('#12ab9F')
    expect(wireColor('#123')).toBe(wireColor('black'))
  })
  it('draws lower gauge numbers thicker', () => {
    expect(wireWidth(16)).toBeGreaterThan(wireWidth(22))
    expect(wireWidth(22)).toBe(3)
    expect(wireWidth(30)).toBeGreaterThanOrEqual(1.5)
  })
})

describe('wirePaths', () => {
  const two: ModuleDef = {
    format: 'circuitoon-module/1', id: 'two', name: 'Two',
    pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
  }
  const d = (connections: Diagram['connections']): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { two },
    parts: [
      { uid: 'a', designator: 'A', module: 'two', x: 0, y: 0 },
      { uid: 'b', designator: 'B', module: 'two', x: 100, y: 0 },
    ],
    connections,
  })

  it('draws a straight wire between facing pins', () => {
    const [w] = wirePaths(d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }]))
    expect(w.d).toBe('M48 20 L92 20')
  })
  it('puts a hop on the later wire where two wires cross', () => {
    const vert: ModuleDef = {
      format: 'circuitoon-module/1', id: 'vert', name: 'Vert',
      pins: [{ name: 'T', side: 'top' }, { name: 'B', side: 'bottom' }],
    }
    const diagram = d([
      { uid: 'w1', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } },
      { uid: 'w2', from: { part: 'c', pin: 'T' }, to: { part: 'e', pin: 'B' } },
    ])
    diagram.modules.vert = vert
    diagram.parts.push({ uid: 'c', designator: 'C', module: 'vert', x: 50, y: 60 }, { uid: 'e', designator: 'E', module: 'vert', x: 50, y: -60 })
    const [w1, w2] = wirePaths(diagram)
    expect(w1.d).toBe('M48 20 L92 20')
    expect(w2.d).toBe('M70 52 L70 25 A5 5 0 0 0 70 15 L70 -22')
  })
  it('skips a connection whose pin does not exist', () => {
    expect(wirePaths(d([{ uid: 'w', from: { part: 'a', pin: 'nope' }, to: { part: 'b', pin: 'L' } }]))).toEqual([])
  })
  it('routes around a part that sits between two pins', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    diagram.parts[1] = { ...diagram.parts[1], x: 200 }
    diagram.parts.push({ uid: 'c', designator: 'C', module: 'two', x: 100, y: 0 })
    const r = computeRoutes(diagram).get('w')!
    expect(r.blocked).toBe(false)
    expect(r.points.length).toBeGreaterThan(2)
    // No horizontal segment may pass through c's body (x 100..140, y 0..30).
    const throughC = r.points.some((p, i) => {
      const q = r.points[i - 1]
      return i > 0 && p.y === q.y && p.y > 0 && p.y < 30 && Math.min(p.x, q.x) < 140 && Math.max(p.x, q.x) > 100
    })
    expect(throughC).toBe(false)
  })
  it('follows a rotated part', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    diagram.parts[1] = { ...diagram.parts[1], rotation: 90 }
    const r = computeRoutes(diagram).get('w')!
    // b is at (100, 0), body 40 x 30, pivot (20, 10); its L stub tip, local (-8, 20), turns to world (110, -18)
    expect(r.points[r.points.length - 1]).toEqual({ x: 110, y: -18 })
  })
  it('reuses previous routes for wires not listed in only', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    const prev = computeRoutes(diagram)
    const moved = { ...diagram, parts: diagram.parts.map((p) => (p.uid === 'b' ? { ...p, y: 50 } : p)) }
    expect(computeRoutes(moved, { only: new Set(), prev }).get('w')).toBe(prev.get('w'))
  })
})
