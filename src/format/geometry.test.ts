import { describe, expect, it } from 'vitest'
import { bodyRect, pivot, rotateVec, simplify, toWorld, worldPins } from './geometry.ts'
import type { ModuleDef } from './module.ts'

const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}

describe('rotation', () => {
  it('pivots on the grid point at or up-left of the body center', () => {
    expect(pivot(60, 40)).toEqual({ x: 30, y: 20 })
    expect(pivot(50, 30)).toEqual({ x: 20, y: 10 })
  })
  it('rotates clockwise on screen', () => {
    expect(rotateVec({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: 10 })
    expect(rotateVec({ x: 10, y: 0 }, 180)).toEqual({ x: -10, y: 0 })
    expect(rotateVec({ x: 10, y: 0 }, 270)).toEqual({ x: 0, y: -10 })
  })
  it('maps local points to world points through the pivot', () => {
    // body 40 x 30, pivot (20, 10); local (40, 20) is 20 right, 10 down of the pivot
    expect(toWorld({ x: 100, y: 100 }, { w: 40, h: 30 }, { x: 40, y: 20 })).toEqual({ x: 140, y: 120 })
    expect(toWorld({ x: 100, y: 100, rotation: 90 }, { w: 40, h: 30 }, { x: 40, y: 20 })).toEqual({ x: 110, y: 130 })
  })
  it('swaps the body rect on quarter turns', () => {
    expect(bodyRect({ x: 0, y: 0 }, { w: 40, h: 30 })).toEqual({ x: 0, y: 0, w: 40, h: 30 })
    // pivot (20, 10): x spans -20..20 and y spans -10..20 around it; a quarter turn maps that to x -20..10, y -20..20
    expect(bodyRect({ x: 0, y: 0, rotation: 90 }, { w: 40, h: 30 })).toEqual({ x: 0, y: -10, w: 30, h: 40 })
  })
  it('keeps pins on the grid and turns their direction', () => {
    const [l, r] = worldPins({ x: 100, y: 100, rotation: 90 }, two)
    // L edge is local (0, 20): 20 left and 10 below the pivot (20, 10); turned, 10 left and 20 above
    expect(l.edge).toEqual({ x: 110, y: 90 })
    expect(l.dir).toEqual({ x: 0, y: -1 })
    expect(l.end).toEqual({ x: 110, y: 82 })
    expect(r.dir).toEqual({ x: 0, y: 1 })
    for (const p of [l, r]) expect([p.edge.x % 10, p.edge.y % 10]).toEqual([0, 0])
  })
})

describe('simplify', () => {
  it('drops repeated and collinear points', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }])
  })
})
