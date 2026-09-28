import { describe, expect, it } from 'vitest'
import { isBoard, validateModule, type ModuleDef } from './module.ts'
import { brokenStub, computeRoutes, partObstacles, resolveEndpoint, routeWire, serializeDiagram, validateDiagram, type Diagram, type PartInstance } from './diagram.ts'
import { load } from './builtinModules.testing.ts'
import { routeOrthogonal } from './router.ts'
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

/**
 * A full breadboard with `n` resistors mounted flat, nine to a row, seven columns apart, both legs
 * of each wired to one battery holder below the board.
 */
function resistorRows(n: number): Diagram {
  const modules = { 'breadboard-full': load('breadboard-full'), resistor: load('resistor'), 'battery-holder-2xaa': load('battery-holder-2xaa') }
  const rs: PartInstance[] = Array.from({ length: n }, (_, i) => ({
    uid: `R${i + 1}`, designator: `R${i + 1}`, module: 'resistor', x: 30 + 70 * (i % 9), y: 40 + 70 * Math.floor(i / 9), mount: { board: 'BB1' },
  }))
  return {
    format: 'circuitoon-diagram/1', title: 'rows', modules,
    parts: [{ uid: 'BB1', designator: 'BB1', module: 'breadboard-full', x: 0, y: 0 }, ...rs, { uid: 'BT1', designator: 'BT1', module: 'battery-holder-2xaa', x: 200, y: 400 }],
    connections: rs.flatMap((r) => ['1', '2'].map((pin) => ({ uid: `w${r.uid}.${pin}`, from: { part: r.uid, pin }, to: { part: 'BT1', pin: '+' } }))),
  }
}
/** Generous: isolated runs measure about 31 ms (see the console line). */
const BOARD_BUDGET_MS = 500

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
  it('routes wires across a board, which is not an obstacle, but never over a hole the wire does not end in', () => {
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
    // The board's holes sit at y = 0..40, so the wire crosses the board on the free row below them.
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 48, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 50 }, { x: 180, y: 50 }, { x: 180, y: 20 }, { x: 192, y: 20 }], blocked: false })
  })
  it('routes a wire from a hole center off the end of its own strip, not along a row of other strips', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'a', designator: 'R1', module: 'two', x: 100, y: -10 }],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'a', pin: 'L' } }],
    }
    // R1's pin tip sits 2 px past the board's last strip: the goal node itself is never refused.
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 10, y: 10 }, { x: 10, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 10 }, { x: 92, y: 10 }], blocked: false })
  })
  it('lets a pin stub point into a strip: the first node along the stub is never avoided', () => {
    // Two strips at x = 10 and 20. A pin tip left of the board points right, into them: its first
    // node is s1's hole (the start) and the next is s2's, the only way forward.
    const avoid = [10, 20].flatMap((x) => [10, 20, 30, 40, 50].map((y) => ({ x, y })))
    const pts = routeOrthogonal({ from: { x: 2, y: 30 }, fromDir: { x: 1, y: 0 }, to: { x: 60, y: 90 }, toDir: null, obstacles: [], avoid })
    expect(pts).not.toBeNull()
    expect(pts![1].y).toBe(30)
  })
  it('never blocks a wire because of hole avoidance: a row of mounted resistors on a full breadboard', () => {
    // Before the retry, R4's leg 2 (column 30) had only other strips' holes around it: blocked.
    const d = resistorRows(4)
    const blocked = [...computeRoutes(d)].filter(([, r]) => !r || r.blocked).map(([uid]) => uid)
    expect(d.connections).toHaveLength(8)
    expect(blocked).toEqual([])
  })
  it('routes 40 wires on a full breadboard with 20 mounted parts within budget', { timeout: 60_000, retry: 2 }, () => {
    const d = resistorRows(20)
    expect(d.connections).toHaveLength(40)
    computeRoutes(d) // warm-up
    // Best of three, retried twice: the full suite runs files in parallel, so one slow sample is
    // CPU contention, not a regression.
    let ms = Infinity
    for (let k = 0; k < 3; k++) {
      const t = performance.now()
      computeRoutes(d)
      ms = Math.min(ms, performance.now() - t)
    }
    console.log(`computeRoutes full breadboard, 20 parts / 40 wires: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(BOARD_BUDGET_MS)
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
