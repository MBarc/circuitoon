import { describe, expect, it } from 'vitest'
import { COORD_LIMIT, emptyDiagram, type Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { CLIP_FORMAT, clipText, clipToPaste, copySelection, cutMemo, cutSelection, parseClip, pasteClip, pasteDelta, planPaste, type Clip } from './clipboard.ts'
import { MAX_FILE_BYTES } from './files.ts'
import { LINK_MAX_CONNECTIONS, LINK_MAX_PARTS } from '../format/link.ts'
import { marqueeSelection } from './ops.ts'

const resistor: ModuleDef = {
  format: 'circuitoon-module/1', id: 'resistor', name: 'Resistor',
  pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
  electrical: { params: { resistance: { unit: 'ohm', default: 1000 } } },
}
const led: ModuleDef = { format: 'circuitoon-module/1', id: 'led', name: 'LED', pins: [{ name: 'A', side: 'left' }, { name: 'K', side: 'right' }] }
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({
    name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
  })),
}

/** R1 and R2 side by side, D1 far away, a wire R1-R2 (hand-shaped) and R2-D1, a frame and a note. */
function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 'Sheet', modules: { resistor, led, bb },
    parts: [
      { uid: 'p1', designator: 'R1', module: 'resistor', x: 0, y: 0, values: { resistance: { value: 220, unit: 'ohm' } } },
      { uid: 'p2', designator: 'R2', module: 'resistor', x: 100, y: 0, rotation: 90 },
      { uid: 'p3', designator: 'D1', module: 'led', x: 500, y: 500 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'p1', pin: '2' }, to: { part: 'p2', pin: '1' }, color: 'red', route: [[70, 20], [70, 40]] },
      { uid: 'w2', from: { part: 'p2', pin: '2' }, to: { part: 'p3', pin: 'A' } },
    ],
    annotations: [
      { uid: 'a1', type: 'frame', x: -20, y: -20, w: 200, h: 100 },
      { uid: 'a2', type: 'text', x: 0, y: 200, text: 'Hi' },
    ],
  }
}

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

describe('marqueeSelection', () => {
  it('selects parts and marks fully inside, plus wires with both ends on selected parts', () => {
    const d = sheet()
    const sel = marqueeSelection(d, rect(-10, -30, 300, 150))
    expect(sel.parts).toEqual(['p1', 'p2'])
    expect(sel.wires).toEqual(['w1'])
    // The frame's box starts at -20, outside the rectangle.
    expect(sel.annotations ?? []).toEqual([])
  })
  it('leaves out a part only partly inside', () => {
    const d = sheet()
    expect(marqueeSelection(d, rect(-10, -30, 90, 150)).parts).toEqual(['p1'])
    expect(marqueeSelection(d, rect(5, -30, 90, 150)).parts).toEqual([])
  })
  it('takes frames and notes whose whole box is inside', () => {
    const d = sheet()
    expect(marqueeSelection(d, rect(-30, -30, 250, 150)).annotations).toEqual(['a1'])
    expect(marqueeSelection(d, rect(-5, 190, 100, 50))).toEqual({ parts: [], wires: [], annotations: ['a2'] })
  })
  it('adds to a base selection, each item once, and joins wires across old and new parts', () => {
    const d = sheet()
    const sel = marqueeSelection(d, rect(400, 400, 300, 300), { parts: ['p2'], wires: ['w1'], annotations: ['a2'] })
    expect(sel.parts).toEqual(['p2', 'p3'])
    expect(sel.wires).toEqual(['w1', 'w2'])
    expect(sel.annotations).toEqual(['a2'])
  })
  it('selects nothing from an empty rectangle', () => {
    expect(marqueeSelection(sheet(), rect(2000, 2000, 10, 10))).toEqual({ parts: [], wires: [] })
  })
})

describe('copySelection', () => {
  it('copies the parts, the wires between them, the marks and only the modules in use', () => {
    const clip = copySelection(sheet(), { parts: ['p1', 'p2'], wires: ['w2'], annotations: ['a2'] })!
    expect(clip.format).toBe(CLIP_FORMAT)
    expect(clip.parts.map((p) => p.uid)).toEqual(['p1', 'p2'])
    // w2 runs to D1, which is not copied.
    expect(clip.connections.map((c) => c.uid)).toEqual(['w1'])
    expect(clip.annotations.map((a) => a.uid)).toEqual(['a2'])
    expect(Object.keys(clip.modules)).toEqual(['resistor'])
  })
  it('returns null when nothing copyable is selected', () => {
    expect(copySelection(sheet(), { parts: [], wires: ['w1'] })).toBeNull()
    expect(copySelection(sheet(), { parts: [], wires: [] })).toBeNull()
  })
})

describe('clip text', () => {
  it('round-trips through clipText and parseClip', () => {
    const clip = copySelection(sheet(), { parts: ['p1', 'p2'], wires: [], annotations: ['a1'] })!
    const back = parseClip(clipText(clip))!
    expect(back).toEqual(clip)
    expect(JSON.parse(clipText(clip)).format).toBe('circuitoon-clip/1')
  })
  it('accepts only the clip format tag and a valid body', () => {
    const clip = copySelection(sheet(), { parts: ['p1'], wires: [] })!
    expect(parseClip('hello')).toBeNull()
    expect(parseClip('')).toBeNull()
    expect(parseClip(JSON.stringify({ ...clip, format: 'circuitoon-diagram/1' }))).toBeNull()
    expect(parseClip(JSON.stringify({ ...clip, parts: [{ uid: 'p1' }] }))).toBeNull()
    expect(parseClip(JSON.stringify({ ...clip, parts: 'x' }))).toBeNull()
    expect(parseClip('[1,2]')).toBeNull()
  })
})

describe('pasteClip', () => {
  it('pastes with fresh uids and the next free designators, selecting what it pasted', () => {
    const d = sheet()
    const clip = copySelection(d, { parts: ['p1', 'p2', 'p3'], wires: [], annotations: ['a1', 'a2'] })!
    const { diagram, selection } = pasteClip(d, clip, 10, 10)
    const added = diagram.parts.slice(3)
    expect(added.map((p) => [p.uid, p.designator, p.module])).toEqual([['p4', 'R3', 'resistor'], ['p5', 'R4', 'resistor'], ['p6', 'D2', 'led']])
    expect(diagram.annotations!.slice(2).map((a) => a.uid)).toEqual(['a3', 'a4'])
    expect(selection).toEqual({ parts: ['p4', 'p5', 'p6'], wires: ['w3', 'w4'], annotations: ['a3', 'a4'] })
    // The originals are untouched.
    expect(diagram.parts.slice(0, 3)).toEqual(d.parts)
  })
  it('keeps values and rotation, and offsets positions and hand-shaped routes', () => {
    const d = sheet()
    const clip = copySelection(d, { parts: ['p1', 'p2'], wires: [] })!
    const { diagram } = pasteClip(d, clip, 30, -20)
    const [a, b] = diagram.parts.slice(3)
    expect(a).toMatchObject({ x: 30, y: -20, values: { resistance: { value: 220, unit: 'ohm' } } })
    expect(b).toMatchObject({ x: 130, y: -20, rotation: 90 })
    const w = diagram.connections.at(-1)!
    expect(w).toMatchObject({ uid: 'w3', from: { part: a.uid, pin: '2' }, to: { part: b.uid, pin: '1' }, color: 'red', route: [[100, 0], [100, 20]] })
  })
  it('remaps hole ends and keeps a mount only when its board comes along', () => {
    const d: Diagram = {
      ...emptyDiagram(), modules: { bb, resistor },
      parts: [
        { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
        { uid: 'r', designator: 'R1', module: 'resistor', x: 10, y: 0, mount: { board: 'b' } },
      ],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 2 }, to: { part: 'r', pin: '1' } }],
    }
    const both = pasteClip(d, copySelection(d, { parts: ['b', 'r'], wires: [] })!, 0, 200).diagram
    expect(both.parts.slice(2)).toEqual([
      { uid: 'p1', designator: 'U1', module: 'bb', x: 0, y: 200 },
      { uid: 'p2', designator: 'R2', module: 'resistor', x: 10, y: 200, mount: { board: 'p1' } },
    ])
    expect(both.connections[1]).toMatchObject({ from: { part: 'p1', pin: 's1', hole: 2 }, to: { part: 'p2', pin: '1' } })
    const alone = pasteClip(d, copySelection(d, { parts: ['r'], wires: [] })!, 0, 200).diagram
    expect(alone.parts[2]).not.toHaveProperty('mount')
  })
  it('adds the modules a clip carries into another sheet, and keeps a module the sheet already has', () => {
    const clip = copySelection(sheet(), { parts: ['p1', 'p3'], wires: [] })!
    const other: Diagram = { ...emptyDiagram(), modules: { resistor: { ...resistor, name: 'Mine' } } }
    const { diagram } = pasteClip(other, clip, 10, 10)
    expect(Object.keys(diagram.modules).sort()).toEqual(['led', 'resistor'])
    expect(diagram.modules.resistor.name).toBe('Mine')
    expect(diagram.parts.map((p) => p.designator)).toEqual(['R1', 'D1'])
  })
  it('does not add an annotations key to a sheet that has none when the clip has no marks', () => {
    const clip = copySelection(sheet(), { parts: ['p1'], wires: [] })!
    expect(pasteClip(emptyDiagram(), clip, 10, 10).diagram).not.toHaveProperty('annotations')
  })
  it('skips a part whose module neither the clip nor the sheet has, and its wires', () => {
    const clip: Clip = { ...copySelection(sheet(), { parts: ['p1', 'p2'], wires: [] })!, modules: {} }
    const { diagram, selection } = pasteClip(emptyDiagram(), clip, 0, 0)
    expect(diagram.parts).toEqual([])
    expect(diagram.connections).toEqual([])
    expect(selection).toEqual({ parts: [], wires: [] })
  })
  it('stops the offset at the coordinate limit, keeping the block rigid', () => {
    const d: Diagram = { ...sheet(), parts: [{ uid: 'p1', designator: 'R1', module: 'resistor', x: COORD_LIMIT - 20, y: 0 }], connections: [], annotations: [] }
    const clip = copySelection(d, { parts: ['p1'], wires: [] })!
    const { diagram } = pasteClip(d, clip, 100, 100)
    expect(diagram.parts[1]).toMatchObject({ x: COORD_LIMIT, y: 100 })
  })
})

describe('pasteDelta', () => {
  const clip = () => copySelection(sheet(), { parts: ['p1', 'p2'], wires: [] })!
  it('steps one grid step further from the source on each repeated paste', () => {
    expect(pasteDelta(clip(), 1, null)).toEqual([10, 10])
    expect(pasteDelta(clip(), 3, null)).toEqual([30, 30])
  })
  it('centres the clip under the pointer on the grid, stepping on from there', () => {
    // R1 body starts at 0,0 and R2 rotated sits to its right; the centre comes from their boxes.
    const [dx, dy] = pasteDelta(clip(), 1, { x: 1000, y: 1000 })
    expect(dx % 10).toBe(0)
    expect(dy % 10).toBe(0)
    const [dx2, dy2] = pasteDelta(clip(), 2, { x: 1000, y: 1000 })
    expect([dx2 - dx, dy2 - dy]).toEqual([10, 10])
  })
})

describe('boards carry their mounted parts', () => {
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  // U1 is seated on the board (the placement ops.test mounts); R1 off the board is not mounted.
  const board = (): Diagram => ({
    ...emptyDiagram(), modules: { bb, two, resistor },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'u', designator: 'U1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'r', designator: 'R1', module: 'resistor', x: 400, y: 0 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'b', pin: 's1', hole: 2 }, to: { part: 'u', pin: 'L' } },
      { uid: 'w2', from: { part: 'u', pin: 'R' }, to: { part: 'r', pin: '1' } },
    ],
  })
  it('copies a selected board with the parts mounted on it, and the wires between them', () => {
    const clip = copySelection(board(), { parts: ['b'], wires: [] })!
    expect(clip.parts.map((p) => p.uid)).toEqual(['b', 'u'])
    expect(clip.connections.map((c) => c.uid)).toEqual(['w1'])
    expect(Object.keys(clip.modules)).toEqual(['bb', 'two'])
  })
  it('pastes the carried parts still mounted on the pasted board', () => {
    const d = board()
    const { diagram, selection } = pasteClip(d, copySelection(d, { parts: ['b'], wires: [] })!, 0, 200)
    const [nb, nu] = diagram.parts.slice(3)
    expect(nu.mount).toEqual({ board: nb.uid })
    expect(selection.parts).toEqual([nb.uid, nu.uid])
  })
  it('cuts a board together with its mounted parts, in one edit', () => {
    const d = board()
    const cut = cutSelection(d, { parts: ['b'], wires: [] })!
    expect(cut.clip.parts.map((p) => p.uid)).toEqual(['b', 'u'])
    expect(cut.diagram.parts.map((p) => p.uid)).toEqual(['r'])
    expect(cut.diagram.connections).toEqual([])
  })
  it('cuts a mounted part alone when only it is selected, leaving the board', () => {
    const cut = cutSelection(board(), { parts: ['u'], wires: [] })!
    expect(cut.diagram.parts.map((p) => p.uid)).toEqual(['b', 'r'])
  })
  it('returns null for a cut with nothing copyable', () => {
    expect(cutSelection(board(), { parts: [], wires: ['w1'] })).toBeNull()
  })
})

describe('clipToPaste', () => {
  const text = clipText(copySelection(sheet(), { parts: ['p1'], wires: [] })!)
  const other = clipText(copySelection(sheet(), { parts: ['p3'], wires: [] })!)
  it('uses a clip on the system clipboard', () => {
    expect(clipToPaste(text, other)?.text).toBe(text)
  })
  it('pastes nothing when the system clipboard holds anything else, even with a remembered clip', () => {
    expect(clipToPaste('hello', text)).toBeNull()
    expect(clipToPaste('', text)).toBeNull()
    expect(clipToPaste('{"format":"circuitoon-diagram/1"}', text)).toBeNull()
  })
  it('falls back to the remembered clip only when the system clipboard cannot be read', () => {
    expect(clipToPaste(null, text)?.text).toBe(text)
    expect(clipToPaste(null, text)?.clip.parts[0].uid).toBe('p1')
    expect(clipToPaste(null, null)).toBeNull()
  })
})

describe('planPaste', () => {
  const clip = copySelection(sheet(), { parts: ['p1', 'p2'], wires: [] })!
  const text = clipText(clip)
  const pointer = { x: 1000, y: 1000 }
  it('puts the first paste after a cut back where it was, even with the pointer over the sheet', () => {
    const first = planPaste(clip, text, cutMemo(text), pointer)
    expect(first.delta).toEqual([0, 0])
    // The next one, off the sheet, steps one grid step on from there.
    expect(planPaste(clip, text, first.memo, null).delta).toEqual([10, 10])
  })
  it('ignores a cut memo for a different clip', () => {
    expect(planPaste(clip, text, cutMemo('other'), null).delta).toEqual([10, 10])
  })
  it('steps a repeat at the same pointer spot one grid step on, and starts again elsewhere', () => {
    const a = planPaste(clip, text, null, pointer)
    const b = planPaste(clip, text, a.memo, pointer)
    expect([b.delta[0] - a.delta[0], b.delta[1] - a.delta[1]]).toEqual([10, 10])
    const c = planPaste(clip, text, b.memo, { x: 2000, y: 1000 })
    expect(c.delta).toEqual(pasteDelta(clip, 1, { x: 2000, y: 1000 }))
  })
})

describe('parseClip limits', () => {
  const clip = copySelection(sheet(), { parts: ['p1'], wires: [] })!
  it('refuses clip text over the 5 MB file limit, even when it is valid JSON', () => {
    const huge = clipText(clip) + ' '.repeat(MAX_FILE_BYTES)
    expect(parseClip(huge)).toBeNull()
  })
  it('refuses a clip with more parts or wires than a link may carry', () => {
    const p = clip.parts[0]
    const parts = Array.from({ length: LINK_MAX_PARTS + 1 }, (_, i) => ({ ...p, uid: `p${i}`, designator: `R${i}` }))
    expect(parseClip(JSON.stringify({ ...clip, parts }))).toBeNull()
    const two = copySelection(sheet(), { parts: ['p1', 'p2'], wires: [] })!
    const w = two.connections[0]
    const connections = Array.from({ length: LINK_MAX_CONNECTIONS + 1 }, (_, i) => ({ ...w, uid: `w${i}` }))
    expect(parseClip(JSON.stringify({ ...two, connections }))).toBeNull()
  })
  it('returns null for malformed clips without throwing', () => {
    for (const body of [{ modules: null }, { parts: [null] }, { connections: [{ from: 5 }] }, { annotations: [{ type: 'frame' }] }, { modules: { x: { id: 7 } } }])
      expect(() => expect(parseClip(JSON.stringify({ ...clip, ...body }))).toBeNull()).not.toThrow()
  })
  it('returns null when the diagram check itself throws', () => {
    const realSome = Array.prototype.some
    Array.prototype.some = function () {
      throw new Error('kaboom')
    }
    try {
      expect(parseClip(clipText(clip))).toBeNull()
    } finally {
      Array.prototype.some = realSome
    }
  })
})
