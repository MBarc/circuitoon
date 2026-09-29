// One breadboard hole takes one wire end or one leg. holeUses counts what each board hole holds
// (verify's capacity, the checker's hole-shared and the editor's takenHoles all read it); the
// editor refuses a wire end or a leg in a full hole, and the checker flags a sheet that already has
// two wire ends in one.
import { describe, expect, it } from 'vitest'
import { holeEndAt, holeKey, holeUses, plugsOf, seatOf, takenHoles } from './breadboard.ts'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, Endpoint, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'

/** Nine strips s1..s9 of five holes: strip i at x = 10 i, holes at y = 10..50. */
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({ name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]) })),
}
/** The same board with a pad group P that declares it takes two wire ends. */
const bb2: ModuleDef = { ...bb, id: 'bb2', holes: [...bb.holes!, { name: 'P', at: [[10, 60], [20, 60]], holeStyle: 'pad', capacity: 2 }], size: { w: 10, h: 7 } }
/** Two-lead part, body 40 x 30: at (10, 0) on the board its legs sit in s1 and s5, hole 1. */
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'two', pins: [{ name: 'L', side: 'left', type: 'passive' }, { name: 'R', side: 'right', type: 'passive' }] }
/** A header with an interior pad group: several wires to one pad are a header matter, not a breadboard hole. */
const hdr: ModuleDef = { format: 'circuitoon-module/1', id: 'hdr', name: 'hdr', size: { w: 6, h: 4 }, pins: [{ name: 'A', side: 'left' }], holes: [{ name: 'GND', at: [[30, 20]], holeStyle: 'pad' }] }

const outlet = load('outlet-uk-bs1363')
const modules = { bb, bb2, two, hdr, outlet }
const part = (uid: string, module: keyof typeof modules, extra: Partial<PartInstance> = {}): PartInstance => ({ uid, designator: uid.toUpperCase(), module, x: 300, y: 300, ...extra })
const h = (part: string, pin: string, hole: number): Endpoint => ({ part, pin, hole })
const w = (uid: string, from: Endpoint, to: Endpoint): Connection => ({ uid, from, to })
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules, parts, connections })
const board = () => part('bb1', 'bb', { x: 0, y: 0 })
const r1 = () => part('r1', 'two', { x: 10, y: 0, mount: { board: 'bb1' } })

describe('holeUses', () => {
  it('counts legs, wire ends that name a hole and wires to a plugged pin, each in its hole', () => {
    const d = sheet([board(), r1(), part('r2', 'two')], [
      w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' }),
      w('w2', { part: 'r2', pin: 'R' }, h('bb1', 's7', 2)),
      w('w3', { part: 'r1', pin: 'L' }, { part: 'r2', pin: 'L' }),
    ])
    const u = holeUses(d)
    expect(u.get(holeKey('bb1', 's7', 2))).toMatchObject({ cap: 1, legs: [], ends: [{ wire: 'w1', end: 'from', viaPin: false }, { wire: 'w2', end: 'to', viaPin: false }] })
    const leg = u.get(holeKey('bb1', 's1', 1))!
    expect(leg.legs.map((l) => l.pin)).toEqual(['L'])
    expect(leg.ends).toEqual([{ wire: 'w3', end: 'from', viaPin: true }])
    expect(u.has(holeKey('bb1', 's7', 3))).toBe(false)
  })
  it('skips the wires it is told to (broken ones), and never counts a pad of a module that is not a board', () => {
    const d = sheet([board(), part('j1', 'hdr'), part('r2', 'two')], [
      w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' }),
      w('w2', h('bb1', 's7', 2), { part: 'r2', pin: 'R' }),
      w('w3', h('j1', 'GND', 0), { part: 'r2', pin: 'L' }),
      w('w4', h('j1', 'GND', 0), { part: 'r2', pin: 'R' }),
    ])
    expect(holeUses(d, new Set(['w2'])).get(holeKey('bb1', 's7', 2))!.ends.map((e) => e.wire)).toEqual(['w1'])
    expect([...holeUses(d).keys()]).toEqual([holeKey('bb1', 's7', 2)])
  })
})

describe('takenHoles', () => {
  const d = () => sheet([board(), r1(), part('r2', 'two')], [w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' })])
  it('holds a hole with a wire end and a hole with a leg, not a free neighbour', () => {
    const t = takenHoles(d())
    expect(t.has(holeKey('bb1', 's7', 2))).toBe(true)
    expect(t.has(holeKey('bb1', 's1', 1))).toBe(true)
    expect(t.has(holeKey('bb1', 's7', 3))).toBe(false)
  })
  it('never counts the wire end being moved against its own hole, only that end', () => {
    expect(takenHoles(d(), { wire: 'w1', end: 'from' }).has(holeKey('bb1', 's7', 2))).toBe(false)
    expect(takenHoles(d(), { wire: 'w1', end: 'to' }).has(holeKey('bb1', 's7', 2))).toBe(true)
  })
  it('respects a hole group that declares it takes two', () => {
    const one = sheet([part('bb1', 'bb2', { x: 0, y: 0 }), part('r2', 'two')], [w('w1', h('bb1', 'P', 0), { part: 'r2', pin: 'L' })])
    expect(takenHoles(one).has(holeKey('bb1', 'P', 0))).toBe(false)
    const both = { ...one, connections: [...one.connections, w('w2', h('bb1', 'P', 0), { part: 'r2', pin: 'R' })] }
    expect(takenHoles(both).has(holeKey('bb1', 'P', 0))).toBe(true)
  })
})

describe('holeEndAt with taken holes', () => {
  it('picks nothing on a full hole and the free hole next to it', () => {
    const d = sheet([board(), part('r2', 'two')], [w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' })])
    const t = takenHoles(d)
    expect(holeEndAt(d, 'bb1', { x: 70, y: 30 }, t)).toBeNull()
    expect(holeEndAt(d, 'bb1', { x: 70, y: 40 }, t)).toEqual(h('bb1', 's7', 3))
    // Without the set (hovering), the used hole still picks: its net lights.
    expect(holeEndAt(d, 'bb1', { x: 70, y: 30 })).toEqual(h('bb1', 's7', 2))
  })
})

describe('seating on a hole with a wire end', () => {
  it('does not seat a part whose leg lands in a hole a wire end fills, and marks that hole', () => {
    const loose = part('r1', 'two', { x: 10, y: 0 })
    const free = sheet([board(), loose, part('r2', 'two')], [w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' })])
    expect(seatOf(free, 'r1', plugsOf(free))?.status).toBe('seated')
    const used = { ...free, connections: [...free.connections, w('w2', h('bb1', 's1', 1), { part: 'r2', pin: 'R' })] }
    const seat = seatOf(used, 'r1', plugsOf(used))!
    expect(seat.status).toBe('partial')
    expect(seat.blocked).toEqual([{ x: 10, y: 20 }])
  })
})

describe('checker: hole-shared', () => {
  it('flags two wire ends in one breadboard hole as an error, naming the hole and both wires', () => {
    const d = sheet([board(), part('r2', 'two'), part('r3', 'two')], [
      w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' }),
      w('w2', { part: 'r3', pin: 'R' }, h('bb1', 's7', 2)),
    ])
    const [f, ...more] = checkDiagram(d).filter((x) => x.rule === 'hole-shared')
    expect(more).toEqual([])
    expect(f.severity).toBe('error')
    expect(f.id).toBe('hole-shared|["hole","bb1","s7",2]')
    expect(f.target).toBe('BB1 s7 hole 2')
    expect(f.message).toBe('2 wire ends share BB1 s7 hole 2: BB1 s7 hole 2 to R2 L and R3 R to BB1 s7 hole 2. Physically, one hole takes one wire end. Move one of them to a free hole of the same strip.')
    expect(f.parts).toEqual(['bb1', 'r2', 'r3'])
    expect(f.wires).toEqual(['w1', 'w2'])
    expect(f.select).toEqual({ parts: [], wires: ['w1', 'w2'] })
  })
  it('passes one wire per hole, a wire beside a leg (leg-hole-shared), wires to a plugged pin and many wires on a header pad', () => {
    const d = sheet([board(), r1(), part('r2', 'two'), part('j1', 'hdr')], [
      w('w1', h('bb1', 's7', 2), { part: 'r2', pin: 'L' }),
      w('w2', h('bb1', 's7', 3), { part: 'r2', pin: 'R' }),
      w('w3', h('bb1', 's1', 1), { part: 'r2', pin: 'L' }),
      w('w4', { part: 'r1', pin: 'R' }, { part: 'r2', pin: 'R' }),
      w('w5', { part: 'r1', pin: 'R' }, { part: 'r2', pin: 'L' }),
      w('w6', h('j1', 'GND', 0), { part: 'r2', pin: 'L' }),
      w('w7', h('j1', 'GND', 0), { part: 'r2', pin: 'R' }),
    ])
    const rules = checkDiagram(d).map((f) => f.rule)
    expect(rules).not.toContain('hole-shared')
    expect(rules).toContain('leg-hole-shared')
  })
  it("leaves a mains outlet's socket contacts alone: they are not breadboard holes", () => {
    const g = outlet.holes![0].name
    const d = sheet([part('xs1', 'outlet', { x: 0, y: 0 }), part('r2', 'two')], [w('w1', h('xs1', g, 0), { part: 'r2', pin: 'L' }), w('w2', h('xs1', g, 0), { part: 'r2', pin: 'R' })])
    expect(checkDiagram(d).map((f) => f.rule)).not.toContain('hole-shared')
    expect(takenHoles(d).size).toBe(0)
  })
})
