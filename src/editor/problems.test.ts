import { describe, expect, it } from 'vitest'
import { highlightOf, isProblem, problemsOf, reconcileHighlight, severityCounts } from './problems.ts'
import { EditorStore } from './store.ts'
import { moveParts } from './ops.ts'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const bat: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bat', name: 'Battery',
  pins: [{ name: '+', side: 'top', type: 'power_out', supply: '5V' }, { name: '-', side: 'top', type: 'ground' }],
}
/** A 100 x 60 board with one strip s1 at x = 10. */
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: [{ name: 's1', at: [[10, 10], [10, 20], [10, 30]] }],
}
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left', type: 'passive' }, { name: 'R', side: 'right', type: 'passive' }] }

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bat, bb, two },
    parts: [
      { uid: 'b', designator: 'BT1', module: 'bat', x: 300, y: 0 },
      { uid: 'bb', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'r', designator: 'R1', module: 'two', x: 400, y: 0 },
    ],
    connections: [{ uid: 'w1', from: { part: 'b', pin: '+' }, to: { part: 'b', pin: '-' } }],
  }
}

describe('problemsOf', () => {
  it('checks the sheet, and reuses the list while parts, wires and modules stay the same', () => {
    const s = new EditorStore(sheet())
    const first = problemsOf(s)
    expect(first.map((f) => f.rule)).toEqual(['short'])
    s.commit({ ...s.getState().diagram, title: 'renamed' })
    s.select({ parts: ['b'], wires: [] })
    expect(problemsOf(s)).toBe(first)
  })
  it('keeps the list from before a drag for every drag frame, and checks again when the drag ends', () => {
    const s = new EditorStore(sheet())
    const before = problemsOf(s)
    const base = s.begin()
    // Mid-drag R1 hangs half on the board: a real mount problem, not reported until the drop.
    s.preview({ ...base, parts: base.parts.map((p) => (p.uid === 'r' ? { ...p, x: 13, y: 0, mount: { board: 'bb' } } : p)) })
    expect(problemsOf(s)).toBe(before)
    s.end()
    const after = problemsOf(s)
    expect(after).not.toBe(before)
    expect(after.map((f) => f.rule)).toContain('mount')
  })
  it('gives up the frozen list when a drag is cancelled', () => {
    const s = new EditorStore(sheet())
    const before = problemsOf(s)
    const base = s.begin()
    s.preview(moveParts(base, ['r'], 10, 0))
    s.cancel()
    expect(problemsOf(s)).toBe(before)
  })
  it('keeps one list per store', () => {
    const a = new EditorStore(sheet())
    const b = new EditorStore({ ...sheet(), connections: [] })
    expect(problemsOf(a)).toHaveLength(1)
    expect(problemsOf(b)).toEqual([])
  })
})

describe('EditorStore highlight and reveal', () => {
  it('sets and clears the highlight without touching history or the diagram', () => {
    const s = new EditorStore(sheet())
    const d = s.getState().diagram
    const h = { severity: 'error' as const, parts: ['b'], pins: [], wires: ['w1'] }
    s.setHighlight(h)
    expect(s.getState().highlight).toBe(h)
    expect(s.getState().diagram).toBe(d)
    expect(s.canUndo).toBe(false)
    s.setHighlight(null)
    expect(s.getState().highlight).toBeNull()
  })
  it('puts the light out on load, undo and redo', () => {
    const s = new EditorStore(sheet())
    const h = { severity: 'error' as const, parts: ['b'], pins: [], wires: ['w1'] }
    s.commit({ ...s.getState().diagram, connections: [] })
    s.setHighlight(h)
    s.undo()
    expect(s.getState().highlight).toBeNull()
    s.setHighlight(h)
    s.redo()
    expect(s.getState().highlight).toBeNull()
    s.setHighlight(h)
    s.load(sheet())
    expect(s.getState().highlight).toBeNull()
  })
  it('keeps the light in step with its finding: gone when the finding is, following it when it changes', () => {
    const s = new EditorStore(sheet())
    const short = problemsOf(s).find((f) => f.rule === 'short')!
    s.setHighlight(highlightOf(short))
    // The same short, now through a second wire too: the light follows it.
    s.commit({ ...s.getState().diagram, connections: [...s.getState().diagram.connections, { uid: 'w2', from: { part: 'b', pin: '+' }, to: { part: 'b', pin: '-' } }] })
    const again = problemsOf(s).find((f) => f.rule === 'short')!
    expect(again.id).toBe(short.id)
    reconcileHighlight(s, problemsOf(s))
    expect(s.getState().highlight?.wires).toEqual(['w1', 'w2'])
    // The short fixed: the light goes out.
    s.commit({ ...s.getState().diagram, connections: [] })
    reconcileHighlight(s, problemsOf(s))
    expect(s.getState().highlight).toBeNull()
  })
  it('leaves a light that belongs to no finding alone', () => {
    const s = new EditorStore(sheet())
    const h = { severity: 'error' as const, parts: ['b'], pins: [], wires: [] }
    s.setHighlight(h)
    reconcileHighlight(s, [])
    expect(s.getState().highlight).toBe(h)
  })
  it('counts problems by severity', () => {
    const s = new EditorStore(sheet())
    expect(severityCounts(problemsOf(s))).toBe('1 error')
    s.commit({ ...s.getState().diagram, connections: [{ uid: 'w9', from: { part: 'b', pin: '+' }, to: { part: 'r', pin: 'L' } }] })
    expect(severityCounts(problemsOf(s))).toBe('1 warning')
    expect(severityCounts([])).toBe('')
    // A note (severity info) is not a problem: never counted.
    const note = { ...problemsOf(s)[0], severity: 'info' as const }
    expect(isProblem(note)).toBe(false)
    expect(severityCounts([...problemsOf(s), note])).toBe('1 warning')
    expect(severityCounts([note])).toBe('')
  })
  it('counts reveal requests so the canvas can pan to the selection', () => {
    const s = new EditorStore(sheet())
    const n = s.getState().reveal
    s.reveal()
    expect(s.getState().reveal).toBe(n + 1)
  })
})
