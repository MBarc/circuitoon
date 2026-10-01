import { describe, expect, it } from 'vitest'
import { cellGate, gridCell } from './hoverCell.ts'

describe('hover work once per grid cell', () => {
  it('names the 10 px cell a point is in, negative coordinates included', () => {
    expect(gridCell({ x: 0, y: 0 })).toBe('0,0')
    expect(gridCell({ x: 9.9, y: 19 })).toBe('0,1')
    expect(gridCell({ x: -0.1, y: -10 })).toBe('-1,-1')
  })
  it('says yes once per cell crossed, and again after a reset', () => {
    const g = cellGate()
    expect([{ x: 1, y: 1 }, { x: 5, y: 8 }, { x: 9, y: 9 }, { x: 11, y: 9 }, { x: 12, y: 9 }, { x: 3, y: 3 }].map((p) => g.moved(p))).toEqual([true, false, false, true, false, true])
    g.reset()
    expect(g.moved({ x: 3, y: 3 })).toBe(true)
  })
})
