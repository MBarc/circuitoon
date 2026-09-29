import { describe, expect, it } from 'vitest'
import { alignable, alignSelection, distributeSelection, nudgeSelection } from './align.ts'
import type { Annotation, Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

/** Body 40 x 30, pins at (0, 20) and (40, 20) on the grid. */
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
/** Body 50 x 30: its centre is half a grid step off. */
const wide: ModuleDef = { format: 'circuitoon-module/1', id: 'wide', name: 'Wide', size: { w: 5, h: 3 }, pins: [{ name: 'L', side: 'left' }] }
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({
    name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
  })),
}
const part = (uid: string, x: number, y: number, extra: Partial<PartInstance> = {}): PartInstance => ({ uid, designator: uid, module: 'two', x, y, rotation: 0, ...extra })
const sheet = (parts: PartInstance[], annotations?: Annotation[]): Diagram => ({
  format: 'circuitoon-diagram/1', title: 't', modules: { two, wide, bb }, parts, connections: [], ...(annotations ? { annotations } : {}),
})
const pos = (d: Diagram): Record<string, number[]> => Object.fromEntries([...d.parts.map((p) => [p.uid, [p.x, p.y]]), ...(d.annotations ?? []).map((a) => [a.uid, [a.x, a.y]])])
const all = (d: Diagram) => ({ parts: d.parts.map((p) => p.uid), wires: [], annotations: (d.annotations ?? []).map((a) => a.uid) })

describe('align', () => {
  const d = sheet([part('a', 0, 0), part('b', 100, 50), part('c', 200, 110)])
  it('aligns left, right and centre edges of every selected part to the selection box', () => {
    expect(pos(alignSelection(d, all(d), 'left'))).toEqual({ a: [0, 0], b: [0, 50], c: [0, 110] })
    expect(pos(alignSelection(d, all(d), 'right'))).toEqual({ a: [200, 0], b: [200, 50], c: [200, 110] })
    // The box runs 0..240: centre 120, so each 40 wide body goes to 100.
    expect(pos(alignSelection(d, all(d), 'center'))).toEqual({ a: [100, 0], b: [100, 50], c: [100, 110] })
  })
  it('aligns top, middle and bottom', () => {
    expect(pos(alignSelection(d, all(d), 'top'))).toEqual({ a: [0, 0], b: [100, 0], c: [200, 0] })
    expect(pos(alignSelection(d, all(d), 'bottom'))).toEqual({ a: [0, 110], b: [100, 110], c: [200, 110] })
    // The box runs 0..140: middle 70, so each 30 tall body wants 55, rounded to the grid (60).
    expect(pos(alignSelection(d, all(d), 'middle'))).toEqual({ a: [0, 60], b: [100, 60], c: [200, 60] })
  })
  it('keeps every part on the grid when centres cannot meet exactly', () => {
    const mixed = sheet([part('a', 0, 0), { ...part('w', 100, 50), module: 'wide' }])
    const out = alignSelection(mixed, all(mixed), 'center')
    for (const p of out.parts) expect([p.x % 10, p.y % 10]).toEqual([0, 0])
  })
  it('rounds a note with a ragged edge to the grid', () => {
    const withNote = sheet([part('a', 0, 0)], [{ uid: 'n', type: 'text', x: 100, y: 100, text: 'abc' }])
    const out = alignSelection(withNote, all(withNote), 'right')
    for (const [x, y] of Object.values(pos(out))) expect([x % 10, y % 10]).toEqual([0, 0])
  })
  it('aligns frames by their box', () => {
    const f = sheet([part('a', 0, 0)], [{ uid: 'f', type: 'frame', x: 60, y: 200, w: 200, h: 100, label: 'Power' }])
    expect(pos(alignSelection(f, all(f), 'left'))).toEqual({ a: [0, 0], f: [0, 200] })
    expect(pos(alignSelection(f, all(f), 'bottom'))).toEqual({ a: [0, 270], f: [60, 200] })
  })
  it('needs two items, and returns the same sheet when nothing moves', () => {
    expect(alignSelection(d, { parts: ['a'], wires: [] }, 'left')).toBe(d)
    const lined = alignSelection(d, all(d), 'left')
    expect(alignSelection(lined, all(lined), 'left')).toBe(lined)
  })
  it('moves a selected board with the parts plugged into it', () => {
    const s = sheet([part('b', 0, 0, { module: 'bb' }), part('p', 10, 0, { mount: { board: 'b' } }), part('x', 300, 200)])
    const out = alignSelection(s, { parts: ['b', 'x'], wires: [] }, 'bottom')
    // The board (0..60 tall) drops to share the part's bottom (230): 170 down, its part with it.
    expect(pos(out)).toMatchObject({ b: [0, 170], p: [10, 170], x: [300, 200] })
    expect(out.parts.find((q) => q.uid === 'p')?.mount).toEqual({ board: 'b' })
  })
  it('leaves a plugged-in part alone when its board is not selected', () => {
    const s = sheet([part('b', 0, 0, { module: 'bb' }), part('p', 10, 0, { mount: { board: 'b' } }), part('x', 300, 200), part('y', 500, 100)])
    const sel = { parts: ['p', 'x', 'y'], wires: [] }
    expect(alignable(s, sel)).toMatchObject({ skipped: ['p'] })
    const out = alignSelection(s, sel, 'top')
    expect(pos(out)).toMatchObject({ p: [10, 0], x: [300, 100], y: [500, 100] })
    expect(out.parts.find((q) => q.uid === 'p')?.mount).toEqual({ board: 'b' })
  })
})

describe('distribute', () => {
  it('spaces three or more items with equal gaps between the outer two', () => {
    const d = sheet([part('a', 0, 0), part('b', 50, 40), part('c', 300, 80)])
    // Span 0..340 holds 120 of bodies: two gaps of 110, so b goes to 150.
    expect(pos(distributeSelection(d, all(d), 'x'))).toEqual({ a: [0, 0], b: [150, 40], c: [300, 80] })
  })
  it('rounds each position to the grid', () => {
    const d = sheet([part('a', 0, 0), part('b', 50, 0), part('c', 310, 0)])
    const out = distributeSelection(d, all(d), 'x')
    // Gaps of 115 are not on the grid: b goes to 155 rounded, 160.
    expect(pos(out).b).toEqual([160, 0])
  })
  it('spaces vertically, sorted by position, not selection order', () => {
    const d = sheet([part('c', 0, 300), part('a', 0, 0), part('b', 0, 200)])
    expect(pos(distributeSelection(d, all(d), 'y'))).toEqual({ a: [0, 0], b: [0, 150], c: [0, 300] })
  })
  it('spaces centres evenly when the items overlap too much for any gap', () => {
    // Bodies 0..40, 10..50 and 60..100 hold 120 px in a 100 px span: centres 20 and 80 stay, b goes to 50.
    const d = sheet([part('a', 0, 0), part('b', 10, 0), part('c', 60, 0)])
    expect(pos(distributeSelection(d, all(d), 'x'))).toEqual({ a: [0, 0], b: [30, 0], c: [60, 0] })
  })
  it('needs three items', () => {
    const d = sheet([part('a', 0, 0), part('b', 50, 0)])
    expect(distributeSelection(d, all(d), 'x')).toBe(d)
  })
})

describe('nudge', () => {
  it('moves the selected parts and marks by a grid step, and plugs a part into holes it lands on', () => {
    const s = sheet([part('b', 0, 0, { module: 'bb' }), part('x', 10, 10)], [{ uid: 'n', type: 'text', x: 200, y: 0, text: 'hi' }])
    const out = nudgeSelection(s, { parts: ['x'], wires: [], annotations: ['n'] }, 0, -10)
    expect(pos(out)).toMatchObject({ x: [10, 0], n: [200, -10] })
    expect(out.parts.find((q) => q.uid === 'x')?.mount).toEqual({ board: 'b' })
  })
  it('returns the same sheet when nothing is selected', () => {
    const s = sheet([part('x', 10, 10)])
    expect(nudgeSelection(s, { parts: [], wires: [] }, 10, 0)).toBe(s)
  })
})
