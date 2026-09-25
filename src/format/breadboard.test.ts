import { describe, expect, it } from 'vitest'
import { holeAt, holeIndex, mountIssues, plugsOf, pointKey, seatOf, seatOn, splitBoards } from './breadboard.ts'
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

describe('holeAt', () => {
  it('finds a hole only at its exact world point', () => {
    const idx = holeIndex(sheet().parts[0], bb)
    expect(holeAt(idx, { x: 50, y: 20 })).toEqual([4, 1])
    expect(pointKey(50, 20.1)).toBe(pointKey(50, 20))
    expect(holeAt(idx, { x: 50, y: 20.1 })).toBeNull()
    expect(holeAt(idx, { x: 55, y: 20 })).toBeNull()
    expect(holeAt(idx, { x: 2 ** 40, y: 20 })).toBeNull()
  })
  it('plugs nothing for a part a fraction of a px off the holes', () => {
    const d = sheet()
    d.parts = [d.parts[0], { ...d.parts[1], y: 0.1 }]
    expect(plugsOf(d)).toEqual([])
  })
  it('plugs nothing, and does not throw, past +-2^25 px', () => {
    const d = sheet()
    const far = 2 ** 26
    d.parts = [{ ...d.parts[0], x: far }, { ...d.parts[1], x: far + 10 }]
    expect(() => plugsOf(d)).not.toThrow()
    expect(plugsOf(d)).toEqual([])
  })
})

describe('seatOf', () => {
  const loose = (x: number, y: number): Diagram => {
    const d = sheet()
    d.parts = [d.parts[0], { uid: 'u', designator: 'R9', module: 'two', x, y }]
    return d
  }
  it('is seated when every leg lands on a free hole of one board', () => {
    expect(seatOf(loose(10, 0), 'u', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 50, y: 20 }, { x: 10, y: 20 }] })
  })
  it('is partial when only some legs land', () => {
    expect(seatOf(loose(70, 0), 'u', [])).toEqual({ status: 'partial', board: 'b', holes: [{ x: 70, y: 20 }] })
  })
  it('is null when no leg lands on a board', () => {
    expect(seatOf(loose(10, 60), 'u', [])).toBeNull()
  })
  it('is partial when a leg lands on a hole another mounted part already uses', () => {
    const d = loose(50, 0)
    d.parts.push({ uid: 'q', designator: 'R8', module: 'two', x: 10, y: 0, mount: { board: 'b' } })
    expect(seatOf(d, 'u', plugsOf(d))).toEqual({ status: 'partial', board: 'b', holes: [{ x: 90, y: 20 }, { x: 50, y: 20 }] })
    // A part moving with it does not block it.
    expect(seatOf(d, 'u', plugsOf(d), new Set(['u', 'q']))!.status).toBe('seated')
  })
  it('never seats a board or a part with a bus pin', () => {
    const d = loose(10, 0)
    expect(seatOf(d, 'b', [])).toBeNull()
    d.modules.busy = { format: 'circuitoon-module/1', id: 'busy', name: 'Busy', pins: [{ name: 'X', side: 'left' }, { name: 'bus', side: 'right', bus: { length: 2 } }] }
    d.parts[1] = { ...d.parts[1], module: 'busy' }
    expect(seatOf(d, 'u', [])).toBeNull()
  })
  it('never seats a part with no pins', () => {
    const d = loose(10, 0)
    d.modules.bare = { format: 'circuitoon-module/1', id: 'bare', name: 'Bare', pins: [], holes: [{ name: 'h', at: [[0, 0]] }] }
    d.parts[1] = { ...d.parts[1], module: 'bare' }
    expect(seatOf(d, 'u', [])).toBeNull()
  })
  it('picks the board with the most landed legs, then the earlier board', () => {
    // Board c overlaps b 40 px to the right: holes at x = 50..130.
    const d = loose(10, 0)
    d.parts.unshift({ uid: 'c', designator: 'BB2', module: 'bb', x: 40, y: 0 })
    expect(seatOf(d, 'u', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 50, y: 20 }, { x: 10, y: 20 }] })
    // Both legs on both boards: the first board in the list wins.
    d.parts[2] = { ...d.parts[2], x: 50 }
    expect(seatOf(d, 'u', [])!.board).toBe('c')
    d.parts.reverse()
    expect(seatOf(d, 'u', [])!.board).toBe('b')
  })
})

describe('seatOn', () => {
  it('checks one given board, whatever other board also fits', () => {
    const d = sheet()
    d.parts = [d.parts[0], { uid: 'c', designator: 'BB2', module: 'bb', x: 40, y: 0 }, { uid: 'u', designator: 'R9', module: 'two', x: 50, y: 0 }]
    expect(seatOf(d, 'u', [])!.board).toBe('b')
    expect(seatOn(d, 'u', 'c', [])).toEqual({ status: 'seated', board: 'c', holes: [{ x: 90, y: 20 }, { x: 50, y: 20 }] })
    expect(seatOn(d, 'u', 'u', [])).toBeNull()
    expect(seatOn(d, 'u', 'zz', [])).toBeNull()
  })
})

describe('splitBoards', () => {
  it('puts boards first, keeping file order within each layer', () => {
    const d = sheet()
    d.parts = [d.parts[1], d.parts[0], d.parts[2]]
    const { boards, others } = splitBoards(d)
    expect(boards.map((p) => p.uid)).toEqual(['b'])
    expect(others.map((p) => p.uid)).toEqual(['p1', 'p2'])
  })
})

describe('mounts that do not fit', () => {
  it('plugs only the first of two parts on the same holes', () => {
    const d = sheet()
    d.parts.push({ uid: 'p3', designator: 'R3', module: 'two', x: 10, y: 0, mount: { board: 'b' } })
    expect(plugsOf(d).map((p) => p.part)).toEqual(['p1', 'p1', 'p2', 'p2'])
    expect(mountIssues(d)).toEqual([{ part: 'p3', board: 'b', reason: 'conflict' }])
  })
  it('plugs nothing for a partial mount or a mounted part with a bus pin, and keeps the mount data', () => {
    const d = sheet()
    d.parts[1] = { ...d.parts[1], x: 70 }
    d.modules.busy = { format: 'circuitoon-module/1', id: 'busy', name: 'Busy', pins: [{ name: 'X', side: 'left' }, { name: 'bus', side: 'right', bus: { length: 2 } }] }
    d.parts[2] = { ...d.parts[2], module: 'busy' }
    expect(plugsOf(d)).toEqual([])
    expect(d.parts[1].mount).toEqual({ board: 'b' })
    expect(mountIssues(d)).toEqual([
      { part: 'p1', board: 'b', reason: 'partial' },
      { part: 'p2', board: 'b', reason: 'cannot-mount' },
    ])
  })
  it('names a missing target and a target that is not a board', () => {
    const d = sheet()
    d.parts[1] = { ...d.parts[1], mount: { board: 'zz' } }
    d.parts[2] = { ...d.parts[2], mount: { board: 'p1' } }
    expect(mountIssues(d)).toEqual([
      { part: 'p1', board: 'zz', reason: 'missing-board' },
      { part: 'p2', board: 'p1', reason: 'not-a-board' },
    ])
  })
  it('has no issues when every mount fits', () => {
    expect(mountIssues(sheet())).toEqual([])
  })
})
