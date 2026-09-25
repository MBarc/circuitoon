import { describe, expect, it } from 'vitest'
import { holeIndex, plugsOf, pointKey } from './breadboard.ts'
import type { Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'

/** A 100 x 60 test board (pivot 50, 30): nine vertical strips s1..s9 at x = 10..90, five holes each at y = 10..50. */
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({
    name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
  })),
}
/** Two-lead part, body 40 x 30 (pivot 20, 10): L edge at local (0, 20), R edge at local (40, 20), stubs 8 px out. */
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'p2', designator: 'R2', module: 'two', x: 50, y: 10, mount: { board: 'b' } },
    ],
    connections: [],
  }
}

describe('holeIndex', () => {
  it('maps each world grid point to its group and hole', () => {
    const d = sheet()
    const idx = holeIndex(d.parts[0], bb)
    expect(idx.byPoint.size).toBe(45)
    expect(idx.byPoint.get(pointKey(50, 30))).toEqual([4, 2])
    expect(idx.groups[4].name).toBe('s5')
    expect(idx.byPoint.get(pointKey(55, 30))).toBeUndefined()
  })
  it('is cached per part object and rebuilt for a moved part', () => {
    const d = sheet()
    expect(holeIndex(d.parts[0], bb)).toBe(holeIndex(d.parts[0], bb))
    const moved = { ...d.parts[0], x: 100 }
    expect(holeIndex(moved, bb).byPoint.get(pointKey(110, 10))).toEqual([0, 0])
  })
})

describe('plugsOf', () => {
  it('plugs every leg of every mounted part into the hole under it', () => {
    expect(plugsOf(sheet())).toEqual([
      { part: 'p1', pin: 'R', board: 'b', group: 's5', hole: 1, at: { x: 50, y: 20 } },
      { part: 'p1', pin: 'L', board: 'b', group: 's1', hole: 1, at: { x: 10, y: 20 } },
      { part: 'p2', pin: 'R', board: 'b', group: 's9', hole: 2, at: { x: 90, y: 30 } },
      { part: 'p2', pin: 'L', board: 'b', group: 's5', hole: 2, at: { x: 50, y: 30 } },
    ])
  })
  it('plugs nothing for unmounted parts, missing or non-board targets, or legs off the holes', () => {
    const d = sheet()
    d.parts[1] = { ...d.parts[1], mount: undefined }
    d.parts[2] = { ...d.parts[2], mount: { board: 'zz' } }
    d.parts.push({ uid: 'p3', designator: 'R3', module: 'two', x: 200, y: 0, mount: { board: 'p1' } })
    d.parts.push({ uid: 'p4', designator: 'R4', module: 'two', x: 15, y: 0, mount: { board: 'b' } })
    expect(plugsOf(d)).toEqual([])
  })
})
