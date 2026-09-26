import { describe, expect, it } from 'vitest'
import { isBoard, validateModule, type ModuleDef } from './module.ts'
import { brokenStub, computeRoutes, partObstacles, resolveEndpoint, routeWire, serializeDiagram, validateDiagram, type Diagram } from './diagram.ts'
import { plugPoints, worldHoles } from './geometry.ts'
import { netlist } from './netlist.ts'

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

const errorsOf = (raw: unknown) => {
  const r = validateModule(raw)
  return r.ok ? [] : r.errors
}

describe('hole groups in modules', () => {
  it('accepts hole groups with an empty pin list, pads, rails and obstacle false', () => {
    const m = { ...bb, holes: [...bb.holes!, { name: 'VCC', at: [[60, 60]], holeStyle: 'pad' }, { name: 'r', at: [[0, 0]], rail: '+' }] }
    expect(validateModule(m).ok).toBe(true)
  })
  it('still needs a pin when there are no hole groups', () => {
    expect(errorsOf({ ...bb, holes: undefined })).toEqual(['pins: required, at least one pin'])
  })
  it('names every hole group mistake by path', () => {
    const raw = {
      ...bb, obstacle: 'no',
      holes: [
        { name: 's1', at: [[10, 10]] },
        { name: 's1', at: [[15, 10]] },
        { name: 'x', at: [] },
        { name: 'y', at: [[10, 10]], rail: 'x', holeStyle: 'round' },
        { at: [[20, 20]] },
      ],
    }
    expect(errorsOf(raw)).toEqual([
      'holes[1].name: duplicate name "s1" (pins and hole groups share one namespace)',
      'holes[1].at[0]: must sit on the 10 px grid',
      'holes[2].at: required, at least one [x, y] position',
      'holes[3].rail: must be "+" or "-"',
      'holes[3].holeStyle: must be "pad"',
      'holes[3].at[0]: another hole already sits at 10, 10',
      'holes[4].name: required',
      'obstacle: must be true or false',
    ])
  })
  it('refuses a hole group named like a pin', () => {
    expect(errorsOf({ ...two, holes: [{ name: 'L', at: [[10, 10]] }] })).toEqual([
      'holes[0].name: duplicate name "L" (pins and hole groups share one namespace)',
    ])
  })
  it('refuses a hole outside the body', () => {
    expect(errorsOf({ ...bb, holes: [{ name: 'far', at: [[200, 10]] }] })).toEqual(['holes[0].at[0]: outside the body (0 to 100, 0 to 60)'])
  })
  it('accepts a type and supply on a hole group, checked like a pin', () => {
    const pad = (g: Record<string, unknown>) => ({ ...bb, holes: [...bb.holes!, { name: 'VCC', at: [[60, 60]], holeStyle: 'pad', ...g }] })
    expect(validateModule(pad({ type: 'power_in', supply: '3V3/5V' })).ok).toBe(true)
    expect(errorsOf(pad({ type: 'volts', supply: '3V3//5V' }))).toEqual([
      'holes[9].type: must be one of power_in, power_out, ground, input, output, io, passive, nc',
      'holes[9].supply: must be one or more rail names separated by "/", for example "3V3/5V"',
    ])
    expect(errorsOf(pad({ supply: 5 }))).toEqual(['holes[9].supply: must be a string'])
  })
  it('lets internal join hole groups', () => {
    expect(validateModule({ ...bb, internal: [['s1', 's9']] }).ok).toBe(true)
  })
  it('calls a module with holes and obstacle false a board, and nothing else', () => {
    expect(isBoard(bb)).toBe(true)
    expect(isBoard({ ...bb, obstacle: undefined })).toBe(false)
    expect(isBoard(two)).toBe(false)
    expect(isBoard(undefined)).toBe(false)
  })
})

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'p', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'q', designator: 'R2', module: 'two', x: 200, y: 0 },
    ],
    connections: [{ uid: 'w1', from: { part: 'b', pin: 's9', hole: 4 }, to: { part: 'q', pin: 'L' } }],
  }
}

describe('hole endpoints and mounts in diagrams', () => {
  it('loads a mounted part and a wire into a hole with no warnings, and round-trips them', () => {
    const d = sheet()
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r).toEqual({ ok: true, diagram: d, warnings: [] })
  })
  it('refuses a hole index that is not a whole number', () => {
    const d = sheet()
    d.connections[0].from.hole = 1.5
    const r = validateDiagram(d)
    expect(r.ok ? [] : r.errors).toEqual(['connections[0].from.hole: must be a whole number, 0 or more'])
  })
  it('loads a hole past the end of its group, with a warning', () => {
    const d = sheet()
    d.connections[0].from.hole = 7
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual(['connections[0].from.hole: group "s9" has 5 holes (0 to 4)'])
  })
  it('warns about a hole index on a plain pin', () => {
    const d = sheet()
    d.connections[0].to.hole = 0
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual(['connections[0].to.hole: pin "L" is not a hole group'])
  })
  it('refuses a malformed mount', () => {
    const d = sheet() as unknown as { parts: Record<string, unknown>[] }
    d.parts[1].mount = 'b'
    const r = validateDiagram(d)
    expect(r.ok ? [] : r.errors).toEqual(['parts[1].mount: must be { "board": <part uid> }'])
  })
  it('loads mounts that point nowhere useful, with warnings', () => {
    const d = sheet()
    d.parts[1].mount = { board: 'zz' }
    d.parts[2].mount = { board: 'p' }
    d.parts.push({ uid: 's', designator: 'R3', module: 'two', x: 300, y: 0, mount: { board: 's' } })
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual([
      'parts[1].mount.board: no part with uid "zz"',
      'parts[2].mount.board: part "p" is not a board (a module with holes and "obstacle": false)',
      'parts[3].mount.board: a part cannot be mounted on itself',
    ])
  })
})

describe('mounts that load but do not plug', () => {
  it('warns about a partial fit, a hole conflict and a part that cannot mount', () => {
    const d = sheet()
    d.modules.busy = { format: 'circuitoon-module/1', id: 'busy', name: 'Busy', pins: [{ name: 'X', side: 'left' }, { name: 'bus', side: 'right', bus: { length: 2 } }] }
    d.parts.push(
      { uid: 'c', designator: 'R3', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'e', designator: 'R4', module: 'two', x: 70, y: 0, mount: { board: 'b' } },
      { uid: 'f', designator: 'U1', module: 'busy', x: 10, y: 20, mount: { board: 'b' } },
    )
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual([
      'parts[3].mount: a leg of "c" sits on a hole another mounted part already uses, so it plugs into nothing',
      'parts[4].mount: not every leg of "e" sits on a hole of board "b", so it plugs into nothing',
      'parts[5].mount: part "f" cannot mount (boards, parts with a bus pin and parts with no pins never do)',
    ])
    expect(r.ok && r.diagram.parts[3].mount).toEqual({ board: 'b' })
  })
  it('warns once about a mounted part whose module is not embedded', () => {
    const d = sheet()
    d.parts[1] = { ...d.parts[1], module: 'gone' }
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual(['parts[1]: module "gone" is not embedded in this file'])
  })
  it('warns about a mount onto a part whose module is not embedded (not a board, unknown module)', () => {
    const d = sheet()
    d.parts[0] = { ...d.parts[0], module: 'gone' }
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual([
      'parts[0]: module "gone" is not embedded in this file',
      'parts[1].mount: part "b" is not a board (its module "gone" is not embedded in this file)',
    ])
  })
})

describe('hole geometry', () => {
  it('places hole centers in world px, in list order', () => {
    const [s1] = worldHoles({ x: 100, y: 100 }, bb)
    expect(s1.name).toBe('s1')
    expect(s1.style).toBe('hole')
    expect(s1.at).toEqual([{ x: 110, y: 110 }, { x: 110, y: 120 }, { x: 110, y: 130 }, { x: 110, y: 140 }, { x: 110, y: 150 }])
  })
  it('turns holes with the board', () => {
    // local (10, 10) is (-40, -20) from the pivot (50, 30); a quarter turn makes it (20, -40)
    expect(worldHoles({ x: 100, y: 100, rotation: 90 }, bb)[0].at[0]).toEqual({ x: 170, y: 90 })
  })
  it('has no holes for a module without hole groups', () => {
    expect(worldHoles({ x: 0, y: 0 }, two)).toEqual([])
  })
  it('plugs each pin in at its edge point, rotated with the part', () => {
    expect(plugPoints({ x: 110, y: 100 }, two)).toEqual([{ pin: 'R', at: { x: 150, y: 120 } }, { pin: 'L', at: { x: 110, y: 120 } }])
    expect(plugPoints({ x: 0, y: 0, rotation: 90 }, two)).toEqual([{ pin: 'R', at: { x: 10, y: 30 } }, { pin: 'L', at: { x: 10, y: -10 } }])
  })
  it('gives a bus pin no plug point', () => {
    const rail: ModuleDef = {
      format: 'circuitoon-module/1', id: 'rail', name: 'Rail',
      pins: [{ name: 'bus', side: 'top', bus: { length: 5 } }, { name: 'X', side: 'bottom' }],
    }
    expect(plugPoints({ x: 0, y: 0 }, rail).map((p) => p.pin)).toEqual(['X'])
  })
})

describe('resolveEndpoint', () => {
  const d = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 100, y: 100, rotation: 90 }, { uid: 'q', designator: 'R1', module: 'two', x: 0, y: 0 }],
    connections: [],
  })
  it('resolves a hole to its rotated center with a free direction', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1', hole: 0 })).toEqual({ end: { x: 170, y: 90 }, dir: null })
  })
  it('treats a missing hole index as hole 0', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1' })).toEqual({ end: { x: 170, y: 90 }, dir: null })
  })
  it('is null for a hole past the end, a missing group or a missing part', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1', hole: 5 })).toBeNull()
    expect(resolveEndpoint(d(), { part: 'b', pin: 'nope' })).toBeNull()
    expect(resolveEndpoint(d(), { part: 'zz', pin: 's1' })).toBeNull()
  })
  it('resolves a pin to its stub tip and direction', () => {
    expect(resolveEndpoint(d(), { part: 'q', pin: 'R' })).toEqual({ end: { x: 48, y: 20 }, dir: { x: 1, y: 0 } })
  })
})

describe('brokenStub', () => {
  const d = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'q', designator: 'R1', module: 'two', x: 0, y: 0 }],
    connections: [],
  })
  it('finds the one end that resolves, from either side', () => {
    expect(brokenStub(d(), { uid: 'w1', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'b', pin: 's1', hole: 99 } })).toEqual({ end: { x: 10, y: 10 }, dir: null })
    expect(brokenStub(d(), { uid: 'w2', from: { part: 'b', pin: 's1', hole: 99 }, to: { part: 'q', pin: 'L' } })).toEqual({ end: { x: -8, y: 20 }, dir: { x: -1, y: 0 } })
  })
  it('is null when neither end resolves', () => {
    expect(brokenStub(d(), { uid: 'w3', from: { part: 'zz', pin: 'x' }, to: { part: 'b', pin: 'nope' } })).toBeNull()
  })
})

describe('routing with boards and holes', () => {
  it('routes wires straight over a board, which is not an obstacle', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [
        { uid: 'a', designator: 'R1', module: 'two', x: 0, y: 0 },
        { uid: 'b', designator: 'BB1', module: 'bb', x: 60, y: -10 },
        { uid: 'c', designator: 'R2', module: 'two', x: 200, y: 0 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'c', pin: 'L' } }],
    }
    expect(partObstacles(d)).toHaveLength(2)
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 48, y: 20 }, { x: 192, y: 20 }], blocked: false })
  })
  it('routes a wire from a hole center', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'a', designator: 'R1', module: 'two', x: 100, y: -10 }],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'a', pin: 'L' } }],
    }
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 10, y: 10 }, { x: 92, y: 10 }], blocked: false })
  })
  it('turns a manual route horizontally first at a hole end', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'a', designator: 'R1', module: 'two', x: 100, y: 50 }],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'a', pin: 'L' }, route: [[50, 40]] }],
    }
    expect(computeRoutes(d).get('w')).toEqual({
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 50, y: 70 }, { x: 92, y: 70 }],
      blocked: false,
    })
  })
})

describe('wires with unresolved hole ends are skipped, not crashed on', () => {
  const twoParts = (boardModule: string, modules: Diagram['modules']): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules,
    parts: [
      { uid: 'b', designator: 'BB1', module: boardModule, x: 0, y: 0 },
      { uid: 'a', designator: 'R1', module: 'two', x: 200, y: 0 },
    ],
    connections: [{ uid: 'w', from: { part: 'b', pin: 's9', hole: 4 }, to: { part: 'a', pin: 'L' } }],
  })

  it('does not route a wire whose hole group was removed from the board', () => {
    const shrunk: ModuleDef = { ...bb, holes: bb.holes!.filter((g) => g.name !== 's9') }
    const d = twoParts('bb', { bb: shrunk, two })
    expect(resolveEndpoint(d, d.connections[0].from)).toBeNull()
    expect(routeWire(d, d.connections[0], partObstacles(d))).toBeNull()
    expect(computeRoutes(d).get('w')).toBeNull()
    expect(netlist(d).broken).toEqual(['w'])
  })
  it('does not route a wire whose hole index is beyond a shortened group', () => {
    const shortened: ModuleDef = { ...bb, holes: bb.holes!.map((g) => (g.name === 's9' ? { ...g, at: g.at.slice(0, 2) } : g)) }
    const d = twoParts('bb', { bb: shortened, two })
    expect(resolveEndpoint(d, d.connections[0].from)).toBeNull()
    expect(routeWire(d, d.connections[0], partObstacles(d))).toBeNull()
    expect(computeRoutes(d).get('w')).toBeNull()
    expect(netlist(d).broken).toEqual(['w'])
  })
  it('does not route a wire whose board part has no embedded module', () => {
    const d = twoParts('gone', { two })
    expect(resolveEndpoint(d, d.connections[0].from)).toBeNull()
    expect(routeWire(d, d.connections[0], partObstacles(d))).toBeNull()
    expect(computeRoutes(d).get('w')).toBeNull()
    expect(netlist(d).broken).toEqual(['w'])
  })
})
