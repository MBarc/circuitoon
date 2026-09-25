import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { addPart, moveParts } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
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
