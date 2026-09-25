import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { addPart, moveParts, settleDrop, settleMounts } from './ops.ts'
import { emptyDiagram, type Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const m: ModuleDef = { format: 'circuitoon-module/1', id: 'x', name: 'X', pins: [{ name: 'A', side: 'left' }] }

describe('EditorStore', () => {
  it('undoes and redoes commits', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    expect(s.getState().diagram.parts).toHaveLength(1)
    s.undo()
    expect(s.getState().diagram.parts).toHaveLength(0)
    expect(s.canRedo).toBe(true)
    s.redo()
    expect(s.getState().diagram.parts).toHaveLength(1)
  })
  it('records a whole drag as one undo step', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    for (let i = 1; i <= 5; i++) s.preview(moveParts(base, ['p1'], i * 10, 0))
    s.end()
    expect(s.getState().diagram.parts[0].x).toBe(50)
    s.undo()
    expect(s.getState().diagram.parts[0].x).toBe(0)
    expect(s.canUndo).toBe(false)
  })
  it('a drag that goes nowhere adds no history', () => {
    const s = new EditorStore(emptyDiagram())
    s.begin()
    s.end()
    expect(s.canUndo).toBe(false)
  })
  it('drops selected uids that no longer exist', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    s.select({ parts: ['p1'], wires: [] })
    s.undo()
    expect(s.getState().selection).toEqual({ parts: [], wires: [] })
  })
  it('notifies subscribers', () => {
    const s = new EditorStore(emptyDiagram())
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.select({ parts: [], wires: [] })
    off()
    s.select({ parts: [], wires: [] })
    expect(calls).toBe(1)
  })
})

describe('EditorStore drag safety', () => {
  it('a commit during a drag keeps both the drag and the commit as separate undo steps', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    s.preview(moveParts(base, ['p1'], 30, 0))
    s.commit(addPart(s.getState().diagram, m, 100, 0).diagram)
    expect(s.dragging).toBe(false)
    const d = s.getState().diagram
    expect(d.parts).toHaveLength(2)
    expect(d.parts[0].x).toBe(30)
    s.undo()
    expect(s.getState().diagram.parts).toHaveLength(1)
    expect(s.getState().diagram.parts[0].x).toBe(30)
    s.undo()
    expect(s.getState().diagram.parts[0].x).toBe(0)
    expect(s.canUndo).toBe(false)
    // Late pointer moves and end() from the canvas must not change anything.
    s.preview(moveParts(base, ['p1'], 90, 0))
    expect(s.getState().diagram.parts[0].x).toBe(0)
    s.end()
    expect(s.canUndo).toBe(false)
  })
  it('undo during a drag closes the drag first, then undoes it', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    s.preview(moveParts(base, ['p1'], 20, 0))
    s.undo()
    expect(s.dragging).toBe(false)
    expect(s.getState().diagram.parts[0].x).toBe(0)
    expect(s.canRedo).toBe(true)
  })
  it('begin while already dragging keeps the first base', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    s.preview(moveParts(base, ['p1'], 20, 0))
    expect(s.begin()).toBe(base)
    s.end()
    s.undo()
    expect(s.getState().diagram).toBe(base)
    expect(s.canUndo).toBe(false)
  })
  it('cancel restores the base with no history entry', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    expect(s.dragging).toBe(true)
    s.preview(moveParts(base, ['p1'], 20, 0))
    s.cancel()
    expect(s.dragging).toBe(false)
    expect(s.getState().diagram).toBe(base)
    expect(s.canUndo).toBe(false)
    expect(s.dirty).toBe(false)
  })
  it('load during a drag closes it and clears history', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    s.preview(moveParts(base, ['p1'], 20, 0))
    s.load(emptyDiagram())
    expect(s.dragging).toBe(false)
    expect(s.canUndo).toBe(false)
  })
})

describe('EditorStore gesture flag', () => {
  it('tracks a canvas-only gesture without touching undo history', () => {
    const s = new EditorStore(emptyDiagram())
    expect(s.gestureActive).toBe(false)
    s.setGesture(true)
    expect(s.gestureActive).toBe(true)
    s.setGesture(false)
    expect(s.gestureActive).toBe(false)
    expect(s.canUndo).toBe(false)
  })
  it('notifies subscribers only when the flag actually changes', () => {
    const s = new EditorStore(emptyDiagram())
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.setGesture(true)
    s.setGesture(true)
    expect(calls).toBe(1)
    s.setGesture(false)
    expect(calls).toBe(2)
    off()
  })
})

describe('EditorStore dirty flag', () => {
  it('starts clean and is set by commit', () => {
    const s = new EditorStore(emptyDiagram())
    expect(s.dirty).toBe(false)
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    expect(s.dirty).toBe(true)
  })
  it('markSaved clears it; undo and redo set it', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    s.markSaved()
    expect(s.dirty).toBe(false)
    s.undo()
    expect(s.dirty).toBe(true)
    s.markSaved()
    s.redo()
    expect(s.dirty).toBe(true)
  })
  it('a drag with a change sets it; a drag without one does not', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    s.begin()
    s.end()
    expect(s.dirty).toBe(false)
    const base = s.begin()
    s.preview(moveParts(base, ['p1'], 10, 0))
    s.end()
    expect(s.dirty).toBe(true)
  })
  it('load clears it', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    s.load(emptyDiagram())
    expect(s.dirty).toBe(false)
  })
  it('a no-op commit does not set it', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(s.getState().diagram)
    expect(s.dirty).toBe(false)
  })
})

describe('EditorStore part drags that mount or unmount', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  /** Board b at the origin; part u with legs at x = u.x and u.x + 40, row y = 20 when u.y is 0. */
  const sheet = (x: number, mounted: boolean): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'u', designator: 'R1', module: 'two', x, y: 0, ...(mounted ? { mount: { board: 'b' } } : {}) },
    ],
    connections: [],
  })
  /** What the canvas does: move previews while dragging, then settle the moved parts and end. */
  function drag(s: EditorStore, dx: number) {
    const base = s.begin()
    for (let i = 1; i <= 3; i++) s.preview(moveParts(base, ['u'], (dx * i) / 3, 0))
    s.preview(settleMounts(s.getState().diagram, ['u']))
    s.end()
  }
  const u = (s: EditorStore) => s.getState().diagram.parts[1]

  it('a drag that mounts undoes and redoes as one step', () => {
    const s = new EditorStore(sheet(300, false))
    drag(s, -270)
    expect(u(s)).toMatchObject({ x: 30, mount: { board: 'b' } })
    s.undo()
    expect(u(s).x).toBe(300)
    expect(u(s)).not.toHaveProperty('mount')
    expect(s.canUndo).toBe(false)
    s.redo()
    expect(u(s)).toMatchObject({ x: 30, mount: { board: 'b' } })
    expect(s.canRedo).toBe(false)
  })
  it('a drag that unmounts undoes and redoes as one step', () => {
    const s = new EditorStore(sheet(10, true))
    drag(s, 60)
    expect(u(s).x).toBe(70)
    expect(u(s)).not.toHaveProperty('mount')
    s.undo()
    expect(u(s)).toMatchObject({ x: 10, mount: { board: 'b' } })
    expect(s.canUndo).toBe(false)
    s.redo()
    expect(u(s).x).toBe(70)
    expect(u(s)).not.toHaveProperty('mount')
  })
  it('a press without movement changes no mount and adds no history', () => {
    // u is seated but not mounted (a file saved that way): only a real move may mount it.
    const start = sheet(10, false)
    const s = new EditorStore(start)
    const base = s.begin()
    s.preview(settleDrop(base, s.getState().diagram, ['u']))
    s.end()
    expect(s.getState().diagram).toBe(start)
    expect(u(s)).not.toHaveProperty('mount')
    expect(s.canUndo).toBe(false)
  })
  it('Escape during a drag leaves mounts untouched', () => {
    const start = sheet(10, true)
    const s = new EditorStore(start)
    const base = s.begin()
    s.preview(moveParts(base, ['u'], 300, 0))
    s.cancel()
    expect(s.getState().diagram).toBe(start)
    expect(u(s).mount).toEqual({ board: 'b' })
    expect(s.canUndo).toBe(false)
  })
})
