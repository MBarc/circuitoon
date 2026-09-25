import { describe, expect, it } from 'vitest'
import { isBoard, validateModule, type ModuleDef } from './module.ts'
import { serializeDiagram, validateDiagram, type Diagram } from './diagram.ts'

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
