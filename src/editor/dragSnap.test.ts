import { describe, expect, it } from 'vitest'
import { dragSnap } from './dragSnap.ts'
import { snapMove } from './snap.ts'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

/** Body 40 x 30; pin L's stub tip at (-20, 20) from its corner, pin R's at (60, 20). */
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
const sheet = (): Diagram => ({
  format: 'circuitoon-diagram/1', title: 't', modules: { two },
  parts: [
    { uid: 'a', designator: 'A', module: 'two', x: 0, y: 0, rotation: 0 },
    { uid: 'b', designator: 'B', module: 'two', x: 200, y: 40, rotation: 0 },
    { uid: 'c', designator: 'C', module: 'two', x: 400, y: 300, rotation: 0 },
  ],
  connections: [
    { uid: 'w1', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } },
    { uid: 'w2', from: { part: 'c', pin: 'L' }, to: { part: 'b', pin: 'R' } },
  ],
  annotations: [{ uid: 'f', type: 'frame', x: -100, y: -100, w: 700, h: 600, label: 'All' }],
})

describe('dragSnap', () => {
  it('links each wire with one end on the dragged parts, dragged end first', () => {
    const s = dragSnap(sheet(), ['a'], ['a'], [])!
    expect(s.moving).toEqual({ x: 0, y: 0, w: 40, h: 30 })
    const [link] = s.index.links
    expect(s.index.links).toHaveLength(1)
    expect(link.from.y).toBe(20)
    expect(link.to.y).toBe(60)
    // Dragging A down 36 puts its R pin level with B's L pin: the wire comes out straight.
    expect(snapMove(s.index, s.moving, { x: 0, y: 36 }, 1.5)).toMatchObject({ dy: 40, by: { y: 'pin' } })
  })
  it('snaps to frames but never counts a frame in a row of equal gaps', () => {
    const s = dragSnap(sheet(), ['a'], ['a'], [])!
    expect(s.index.spacers).toHaveLength(2)
    expect(s.index.edges.x.some((e) => e.v === -100)).toBe(true)
  })
  it('snaps a frame or note drag to the parts', () => {
    const s = dragSnap(sheet(), [], [], ['f'])!
    expect(s.moving).toEqual({ x: -100, y: -100, w: 700, h: 600 })
    expect(s.index.edges.x).toHaveLength(9)
    expect(s.index.links).toEqual([])
  })
  it('has nothing to snap when nothing moves', () => {
    expect(dragSnap(sheet(), [], [], [])).toBeNull()
  })
})
