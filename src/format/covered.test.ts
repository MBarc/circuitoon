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
for (const id of ['resistor', 'led', 'capacitor-ceramic', 'capacitor-electrolytic', 'mcp23017-dip28', 'dht22-bare', 'ws2812d-5mm', 'tilt-switch-sw520d', 'potentiometer', 'potentiometer-panel-10k', 'jst-xh-4', 'dupont-1x4']) modules[id] = load(id)

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
  it('covers only the channel under a DIP chip seated in rows e and f: every strip keeps 4 free holes', () => {
    // The DIP-28 is 30 px tall (a 300 mil package); at (10, 100) its pins land on rows e and f.
    const d = sheet(on('U1', 'mcp23017-dip28', 10, 100))
    expect(mountIssues(d)).toEqual([])
    expect(new Set(plugsOf(d).map((p) => p.at.y))).toEqual(new Set([100, 130]))
    expect(under(d, 'U1')).toEqual([])
  })
  it('covers the holes between the pin rows of a wide chip, whatever it is', () => {
    // A made-up chip with no art, 40 x 70 px: pins in c3 rows a and f; its body (x 30..70) covers
    // rows b to e of c2 to c4 between them.
    const wide: ModuleDef = { format: 'circuitoon-module/1', id: 'wide', name: 'Wide', size: { w: 4, h: 7 }, pins: [{ name: 'T', side: 'top' }, { name: 'B', side: 'bottom' }] }
    const d = { ...sheet(on('U1', 'wide', 30, 60)), modules: { ...modules, wide } }
    expect(mountIssues(d)).toEqual([])
    expect(under(d, 'U1')).toEqual(['c2-top', 'c3-top', 'c4-top'].flatMap((g) => [1, 2, 3, 4].map((h) => `${g} ${h}`)))
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

describe('upright parts: the top-view footprint, not the side view drawn', () => {
  // A DHT22 standing in row a, pins in c3 to c6: its drawn face (x 35..95, up to y -70) would cover
  // both top rails; standing up, it covers its top view, 15.1 mm wide and reaching 5 mm in front of
  // its pins: row a beside the pins (c2 and c7) and row b across the case.
  const dht = () => on('U1', 'dht22-bare', 30, -70)
  it('leaves the top rails free under a DHT22 in row a', () => {
    const d = sheet(dht())
    expect(plugsOf(d).map((p) => `${p.group} ${p.hole}`)).toEqual(['c3-top 0', 'c4-top 0', 'c5-top 0', 'c6-top 0'])
    expect(under(d, 'U1')).toEqual(['c2-top 0', 'c2-top 1', 'c3-top 1', 'c4-top 1', 'c5-top 1', 'c6-top 1', 'c7-top 0', 'c7-top 1'])
  })
  it('lets a pull-up resistor stand beside it, from the + rail down into row c', () => {
    // R1 turned 90 degrees: legs in top+ at (90, 20) and c7 row c at (90, 80), body over x 82..98.
    const d = sheet(dht(), { uid: 'R1', designator: 'R1', module: 'resistor', x: 60, y: 30, rotation: 90 })
    expect(seatOf(d, 'R1', plugsOf(d))!.status).toBe('seated')
  })
  it('covers nothing beyond the leg holes for footprint "legs" (headers, tilt switch, pots, 5 mm LED)', () => {
    for (const id of ['ws2812d-5mm', 'tilt-switch-sw520d', 'potentiometer', 'potentiometer-panel-10k', 'jst-xh-4', 'dupont-1x4']) {
      expect(modules[id].footprint, id).toBe('legs')
      expect(bodyShapes(modules[id]), id).toEqual([])
    }
  })
  it('uses a footprint rect instead of the art', () => {
    expect(bodyShapes(modules['dht22-bare'])).toEqual([{ x: 5, y: 119, w: 60, h: 31 }])
  })
})
