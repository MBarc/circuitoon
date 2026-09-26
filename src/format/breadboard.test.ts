import { describe, expect, it } from 'vitest'
import { holeAt, holeAtPoint, holeEndAt, holeIndex, mountIssues, plugOfPin, plugsOf, pointKey, seatOf, seatOn, splitBoards } from './breadboard.ts'
import { computeRoutes, validateDiagram, type Diagram } from './diagram.ts'
import { netlist, nodeKey } from './netlist.ts'
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
  it('picks the board with the most landed legs, then the board drawn on top (later in the list)', () => {
    // Board c overlaps b 40 px to the right: holes at x = 50..130.
    const d = loose(10, 0)
    d.parts.unshift({ uid: 'c', designator: 'BB2', module: 'bb', x: 40, y: 0 })
    expect(seatOf(d, 'u', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 50, y: 20 }, { x: 10, y: 20 }] })
    // Both legs on both boards: boards draw in list order, so the later one is on top and wins.
    d.parts[2] = { ...d.parts[2], x: 50 }
    expect(seatOf(d, 'u', [])!.board).toBe('b')
    d.parts.reverse()
    expect(seatOf(d, 'u', [])!.board).toBe('c')
  })
  it('on identical stacked boards, mounts on the one whose holes are shown and picked', () => {
    const d = loose(10, 0)
    d.parts.splice(1, 0, { uid: 'b2', designator: 'BB2', module: 'bb', x: 0, y: 0 })
    expect(splitBoards(d).boards.map((p) => p.uid)).toEqual(['b', 'b2'])
    expect(seatOf(d, 'u', [])!.board).toBe('b2')
  })
  it('never mounts on a board whose plug point an upper board covers (Astra B5 partial overlap)', () => {
    // Lower board b at x = 0, upper b2 at x = 40 (body 40..140). Legs at (10, 20) and (50, 20) both
    // land on b, but b2 covers (50, 20), where the visible strip is b2.s1, not b.s5.
    const d = loose(10, 0)
    d.parts.splice(1, 0, { uid: 'b2', designator: 'BB2', module: 'bb', x: 40, y: 0 })
    // b is obscured; b2 takes only one leg, so the part shows red and does not mount.
    expect(seatOf(d, 'u', [])).toEqual({ status: 'partial', board: 'b2', holes: [{ x: 50, y: 20 }] })
    expect(seatOn(d, 'u', 'b', [])!.status).toBe('partial')
    // A stored mount on b loads but plugs nothing, reported as obscured.
    d.parts[2] = { ...d.parts[2], mount: { board: 'b' } }
    expect(mountIssues(d)).toEqual([{ part: 'u', board: 'b', reason: 'obscured' }])
    expect(plugsOf(d)).toEqual([])
    const loaded = validateDiagram(JSON.parse(JSON.stringify(d)))
    expect(loaded.ok && loaded.warnings).toContain('parts[2].mount: a board drawn above board "b" covers a leg of "u", so it plugs into nothing')
    // The same boards the other way round: b2 is below, nothing covers b, so the part seats on b.
    const flipped = { ...d, parts: [d.parts[1], d.parts[0], d.parts[2]] }
    expect(mountIssues(flipped)).toEqual([])
    expect(seatOf(flipped, 'u', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 50, y: 20 }, { x: 10, y: 20 }] })
  })
  it('still picks the upper of two boards that both fit every leg', () => {
    // Both legs on both boards (b2 20 px right of b); b2 is later, so on top, and wins.
    const d = loose(30, 0)
    d.parts.splice(1, 0, { uid: 'b2', designator: 'BB2', module: 'bb', x: 20, y: 0 })
    expect(seatOf(d, 'u', [])).toEqual({ status: 'seated', board: 'b2', holes: [{ x: 70, y: 20 }, { x: 30, y: 20 }] })
    d.parts[2] = { ...d.parts[2], mount: { board: 'b2' } }
    expect(mountIssues(d)).toEqual([])
  })
  it('does not count a board beside, not above, the candidate as covering it', () => {
    // b2 sits right of b's body (x from 110), later in the list but covering no plug point.
    const d = loose(10, 0)
    d.parts.splice(1, 0, { uid: 'b2', designator: 'BB2', module: 'bb', x: 110, y: 0 })
    expect(seatOf(d, 'u', [])!.status).toBe('seated')
  })
})

describe('seatOn', () => {
  it('checks one given board, whatever other board also fits', () => {
    const d = sheet()
    d.parts = [d.parts[0], { uid: 'c', designator: 'BB2', module: 'bb', x: 40, y: 0 }, { uid: 'u', designator: 'R9', module: 'two', x: 50, y: 0 }]
    expect(seatOf(d, 'u', [])!.board).toBe('c')
    // c is drawn above b and covers both legs, so b is obscured: partial, never seated.
    expect(seatOn(d, 'u', 'b', [])).toEqual({ status: 'partial', board: 'b', holes: [{ x: 90, y: 20 }, { x: 50, y: 20 }] })
    // With c below b, seatOn(b) seats on b.
    const below = { ...d, parts: [d.parts[1], d.parts[0], d.parts[2]] }
    expect(seatOn(below, 'u', 'b', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 90, y: 20 }, { x: 50, y: 20 }] })
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

describe('holeAtPoint', () => {
  it('finds the hole within 3.5 px of the pointer', () => {
    const d = sheet()
    expect(holeAtPoint(d.parts[0], bb, { x: 11, y: 12 })).toEqual({ board: 'b', group: 's1', hole: 0 })
    expect(holeAtPoint(d.parts[0], bb, { x: 52, y: 48 })).toEqual({ board: 'b', group: 's5', hole: 4 })
  })
  it('finds nothing between holes or off the board', () => {
    const d = sheet()
    expect(holeAtPoint(d.parts[0], bb, { x: 14, y: 14 })).toBeNull()
    expect(holeAtPoint(d.parts[0], bb, { x: 100, y: 10 })).toBeNull()
  })
  it('follows a rotated board', () => {
    const turned = { ...sheet().parts[0], x: 100, y: 100, rotation: 90 as const }
    expect(holeAtPoint(turned, bb, { x: 170, y: 90 })).toEqual({ board: 'b', group: 's1', hole: 0 })
  })
  it('finds the holes of a board placed off the world grid, in its own coordinates', () => {
    // At x = 5 the holes sit between world grid lines: s1 hole 0 is at (15, 10).
    const off = { ...sheet().parts[0], x: 5 }
    expect(holeAtPoint(off, bb, { x: 15, y: 10 })).toEqual({ board: 'b', group: 's1', hole: 0 })
    expect(holeAtPoint(off, bb, { x: 17, y: 12 })).toEqual({ board: 'b', group: 's1', hole: 0 })
    expect(holeAtPoint(off, bb, { x: 10, y: 10 })).toBeNull()
    expect(holeAtPoint(off, bb, { x: 20, y: 10 })).toBeNull()
    const frac = { ...sheet().parts[0], x: 2.5, y: 0.25, rotation: 270 as const }
    const at = holeIndex(frac, bb).groups[8].at[4]
    expect(holeAtPoint(frac, bb, { x: at.x + 1, y: at.y - 1 })).toEqual({ board: 'b', group: 's9', hole: 4 })
  })
  it('finds nothing on a module without holes', () => {
    expect(holeAtPoint({ uid: 'p', designator: 'R1', module: 'two', x: 0, y: 0 }, two, { x: 0, y: 20 })).toBeNull()
  })
})

describe('holeEndAt', () => {
  /** A header module: one pad group inside a 40 x 20 body, pins on no side, a routing obstacle (the default). */
  const header: ModuleDef = {
    format: 'circuitoon-module/1', id: 'hdr', name: 'Header', pins: [], size: { w: 4, h: 2 },
    holes: [{ name: 'P1', at: [[10, 10], [30, 10]], holeStyle: 'pad' }],
  }
  const withHeader = (): Diagram => {
    const d = sheet()
    d.modules.hdr = header
    d.parts.push({ uid: 'h', designator: 'J1', module: 'hdr', x: 200, y: 0 })
    return d
  }
  it('resolves a hole on a board and a pad on any module with hole groups, not only boards', () => {
    const d = withHeader()
    expect(holeEndAt(d, 'b', { x: 11, y: 12 })).toEqual({ part: 'b', pin: 's1', hole: 0 })
    expect(holeEndAt(d, 'h', { x: 231, y: 9 })).toEqual({ part: 'h', pin: 'P1', hole: 1 })
  })
  it('resolves nothing between pads, on a part without holes, or on a missing part or module', () => {
    const d = withHeader()
    expect(holeEndAt(d, 'h', { x: 220, y: 10 })).toBeNull()
    expect(holeEndAt(d, 'p1', { x: 10, y: 20 })).toBeNull()
    expect(holeEndAt(d, 'zz', { x: 10, y: 20 })).toBeNull()
    d.parts.push({ uid: 'x', designator: 'X1', module: 'gone', x: 0, y: 0 })
    expect(holeEndAt(d, 'x', { x: 10, y: 10 })).toBeNull()
  })
  it('gives a pad end a wire can start and finish on: it conducts and routes', () => {
    const d = withHeader()
    const from = holeEndAt(d, 'h', { x: 210, y: 10 })!
    const to = holeEndAt(d, 'b', { x: 90, y: 50 })!
    d.connections.push({ uid: 'w1', from, to })
    const n = netlist(d)
    expect(n.broken).toEqual([])
    expect(n.netOf.get(nodeKey('h', 'P1'))).toBe(n.netOf.get(nodeKey('b', 's9')))
    const r = computeRoutes(d).get('w1')!
    expect(r.blocked).toBe(false)
    expect(r.points[0]).toEqual({ x: 210, y: 10 })
    expect(r.points[r.points.length - 1]).toEqual({ x: 90, y: 50 })
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

describe('plug cache', () => {
  it('is shared per parts array and answers plugOfPin from it', () => {
    const d = sheet()
    expect(plugsOf(d)).toBe(plugsOf({ ...d }))
    expect(plugOfPin(d, 'p1', 'R')).toEqual({ x: 50, y: 20 })
    expect(plugOfPin(d, 'p1', 'nope')).toBeNull()
  })
  it('never serves a stale answer after a part is replaced in place', () => {
    const d = sheet()
    expect(plugsOf(d)).toHaveLength(4)
    d.parts[1] = { ...d.parts[1], x: 15 } // legs now between holes: the mount plugs nothing
    expect(plugsOf(d)).toHaveLength(2)
    expect(plugOfPin(d, 'p1', 'R')).toBeNull()
  })
})
