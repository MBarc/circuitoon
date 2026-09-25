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
