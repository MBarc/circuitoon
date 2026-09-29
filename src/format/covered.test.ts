// Holes under a mounted part's body: a part lying on a breadboard covers the holes its drawn body
// sits over (not its own leg holes), whatever kind of part it is. Layout, seating, the checker and
// verify all read them from coveredHoles.
import { describe, expect, it } from 'vitest'
import { bodyShapes, coveredHoles, holeEndAt, mountIssues, plugsOf, seatOf, seatOn } from './breadboard.ts'
import type { Diagram, PartInstance } from './diagram.ts'
import type { Rotation } from './geometry.ts'
import type { ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'

const board = load('breadboard-full')
const modules: Record<string, ModuleDef> = { 'breadboard-full': board }
for (const id of ['resistor', 'led', 'capacitor-ceramic', 'capacitor-electrolytic', 'mcp23017-dip28']) modules[id] = load(id)

const bb: PartInstance = { uid: 'BB1', designator: 'BB1', module: 'breadboard-full', x: 0, y: 0 }
const on = (uid: string, module: string, x: number, y: number, rotation: Rotation = 0): PartInstance => ({ uid, designator: uid, module, x, y, rotation, mount: { board: 'BB1' } })
const sheet = (...parts: PartInstance[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules, parts: [bb, ...parts], connections: [] })
/** "group hole" per covered hole of part `uid`, sorted. */
const under = (d: Diagram, uid: string) => coveredHoles(d).filter((c) => c.by === uid).map((c) => `${c.group} ${c.hole}`).sort()

describe('bodyShapes', () => {
  it("is a resistor's drawn body without its two leads", () => {
    // The leads (0..12 and 48..60, 3 px thick) reach the pin edge points; the body and bands do not.
    const rects = bodyShapes(modules.resistor)
    expect(rects.some((r) => r.x === 8 && r.y === 12 && r.w === 44 && r.h === 16)).toBe(true)
    expect(rects.some((r) => r.h === 3)).toBe(false)
  })
  it('is the whole body for a module with no art', () => {
    const plain: ModuleDef = { format: 'circuitoon-module/1', id: 'plain', name: 'Plain', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
    expect(bodyShapes(plain)).toEqual([{ x: 0, y: 0, w: 40, h: 30 }])
  })
})

describe('coveredHoles', () => {
  it('covers the five holes between a flat resistor\'s legs, not the leg holes', () => {
    // R1 at (30, 40): legs in c1 and c7 on row a (y = 60); the body spans x 38..82, y 52..68.
    const d = sheet(on('R1', 'resistor', 30, 40))
    expect(plugsOf(d).map((p) => p.group).sort()).toEqual(['c1-top', 'c7-top'])
    expect(under(d, 'R1')).toEqual(['c2-top 0', 'c3-top 0', 'c4-top 0', 'c5-top 0', 'c6-top 0'])
  })
  it('turns the footprint with the part: a resistor on end covers the holes of its own column', () => {
    // Turned 90 degrees about its pivot (30, 20): legs at (60, 100) and (60, 160), across the
    // channel; the body spans y 108..152.
    const d = sheet(on('R1', 'resistor', 30, 110, 90))
    expect(plugsOf(d).map((p) => `${p.group} ${p.hole}`).sort()).toEqual(['c4-bot 3', 'c4-top 4'])
    expect(under(d, 'R1')).toEqual(['c4-bot 0', 'c4-bot 1', 'c4-bot 2'])
  })
  it("covers what an LED's drawn dome and rim sit over, but not the holes under its leads", () => {
    // LED at (30, 40): legs at (30, 60) and (70, 60); dome x 41..59 y 44..68, rim x 39..61 y 65..71.
    // The hole at (40, 60) lies under the anode lead only.
    const d = sheet(on('D1', 'led', 30, 40))
    expect(under(d, 'D1')).toEqual(['c2-top 1', 'c3-top 0', 'c3-top 1', 'c4-top 1'])
  })
  it('covers the holes under a ceramic and an electrolytic capacitor body', () => {
    const d = sheet(on('C1', 'capacitor-ceramic', 30, 40), on('C2', 'capacitor-electrolytic', 130, 40))
    expect(under(d, 'C1')).toEqual(['c2-top 0', 'c2-top 1', 'c3-top 0', 'c3-top 1', 'c4-top 0', 'c4-top 1'])
    // Body x 142..168, y 44..76 in world px: columns c13 and c14 (x = 150, 160), rows y = 60, 70.
    expect(under(d, 'C2')).toEqual(['c13-top 0', 'c13-top 1', 'c14-top 0', 'c14-top 1'])
  })
  it('covers every hole between the pin rows of a DIP chip across the channel', () => {
    // Turned 90 degrees, the DIP-28 lies 190 wide and 100 tall; its pin rows land on rows a and i.
    const d = sheet(on('U1', 'mcp23017-dip28', 60, 20, 90))
    expect(mountIssues(d)).toEqual([])
    const legs = new Set(plugsOf(d).map((p) => `${p.group} ${p.hole}`))
    const covered = under(d, 'U1')
    expect(covered.length).toBeGreaterThan(0)
    expect(covered.filter((h) => legs.has(h))).toEqual([])
    // Only the rows strictly between the two pin rows.
    const ys = new Set(coveredHoles(d).filter((c) => c.by === 'U1').map((c) => c.at.y))
    const legYs = [...new Set(plugsOf(d).map((p) => p.at.y))].sort((a, b) => a - b)
    expect(legYs).toHaveLength(2)
    for (const y of ys) expect(y > legYs[0] && y < legYs[1]).toBe(true)
  })
  it('covers nothing for a part that is not validly mounted', () => {
    const d = sheet({ ...on('R1', 'resistor', 35, 40) })
    expect(coveredHoles(d)).toEqual([])
  })
  it('loads a sheet whose part covers another leg unchanged: both still plug in', () => {
    // D1's legs land in c2-top and c6-top hole 0, which R1's body covers.
    const d = sheet(on('R1', 'resistor', 30, 40), on('D1', 'led', 40, 40))
    expect(mountIssues(d)).toEqual([])
    expect(plugsOf(d).filter((p) => p.part === 'D1')).toHaveLength(2)
    expect(under(d, 'R1')).toEqual(expect.arrayContaining(['c2-top 0', 'c6-top 0']))
  })
})

describe('seating around covered holes', () => {
  it('does not seat a part with a leg in a hole under another part\'s body', () => {
    const d = sheet(on('R1', 'resistor', 30, 40), { uid: 'D1', designator: 'D1', module: 'led', x: 40, y: 40 })
    const s = seatOf(d, 'D1', plugsOf(d))!
    expect(s.status).toBe('partial')
    expect(s.blocked).toEqual([{ x: 80, y: 60 }, { x: 40, y: 60 }])
    // One row down, clear of R1's body, it seats.
    expect(seatOf({ ...d, parts: [bb, d.parts[1], { ...d.parts[2], y: 50 }] }, 'D1', plugsOf(d))!.status).toBe('seated')
  })
  it('does not seat a part whose body would cover another part\'s leg', () => {
    // D1 mounted at (60, 40): legs at (60, 60) and (100, 60). R1 dropped at (30, 40) would cover (60, 60).
    const d = sheet(on('D1', 'led', 60, 40), { uid: 'R1', designator: 'R1', module: 'resistor', x: 30, y: 40 })
    const s = seatOn(d, 'R1', 'BB1', plugsOf(d))!
    expect(s.status).toBe('partial')
    expect(s.blocked).toEqual([{ x: 60, y: 60 }])
  })
  it('does not seat a part whose body would cover a wire end', () => {
    const d = sheet({ uid: 'R1', designator: 'R1', module: 'resistor', x: 30, y: 40 })
    expect(seatOf(d, 'R1', [])!.status).toBe('seated')
    d.connections = [{ uid: 'w', from: { part: 'BB1', pin: 'c4-top', hole: 0 }, to: { part: 'BB1', pin: 'c20-top', hole: 0 } }]
    const s = seatOf(d, 'R1', [])!
    expect(s.status).toBe('partial')
    expect(s.blocked).toEqual([{ x: 60, y: 60 }])
  })
  it('lets a part that moves with it (ignored) cover and be covered', () => {
    const d = sheet(on('R1', 'resistor', 30, 40), { uid: 'D1', designator: 'D1', module: 'led', x: 40, y: 40 })
    expect(seatOf(d, 'D1', plugsOf(d), new Set(['D1', 'R1']))!.status).toBe('seated')
  })
})

describe('picking a hole for a wire end', () => {
  it('never picks a hole under a part body: hovering, pressing or dropping there finds nothing', () => {
    const d = sheet(on('R1', 'resistor', 30, 40))
    expect(holeEndAt(d, 'BB1', { x: 60, y: 60 })).toBeNull()
    expect(holeEndAt(d, 'BB1', { x: 60, y: 70 })).toEqual({ part: 'BB1', pin: 'c4-top', hole: 1 })
    // A leg's own hole still picks (a jumper to the leg's strip is flagged by the checker instead).
    expect(holeEndAt(d, 'BB1', { x: 30, y: 60 })).toEqual({ part: 'BB1', pin: 'c1-top', hole: 0 })
  })
})
