// Frames and notes in the editor model: move (one undo step), edit (clipped to the file limits, no-ops
// skipped), delete, and the selection pruned with them.
import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { deleteSelection, moveAnnotations, updateAnnotation } from './ops.ts'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, emptyDiagram, type Diagram } from '../format/diagram.ts'

const sheet = (): Diagram => ({
  ...emptyDiagram(),
  annotations: [
    { uid: 'a1', type: 'frame', x: 0, y: 0, w: 100, h: 60, label: 'Power' },
    { uid: 'a2', type: 'text', x: 10, y: 80, text: 'Note' },
  ],
})

describe('annotation edits', () => {
  it('moves a note as one undo step', () => {
    const s = new EditorStore(sheet())
    const base = s.begin()
    s.preview(moveAnnotations(base, ['a2'], 20, 10))
    s.end()
    expect(s.getState().diagram.annotations![1]).toMatchObject({ x: 30, y: 90 })
    s.undo()
    expect(s.getState().diagram.annotations![1]).toMatchObject({ x: 10, y: 80 })
  })
  it('moves a frame alone, not the parts inside it', () => {
    const d: Diagram = { ...sheet(), parts: [{ uid: 'p1', designator: 'R1', module: 'resistor', x: 20, y: 20 }] }
    const next = moveAnnotations(d, ['a1'], 30, 0)
    expect(next.annotations![0]).toMatchObject({ x: 30, y: 0 })
    expect(next.parts).toBe(d.parts)
    expect(next.annotations![1]).toBe(d.annotations![1])
  })
  it('returns the same diagram for a zero move or an unchanged edit', () => {
    const d = sheet()
    expect(moveAnnotations(d, ['a1'], 0, 0)).toBe(d)
    expect(moveAnnotations(emptyDiagram(), ['a1'], 10, 0).annotations).toBeUndefined()
    expect(updateAnnotation(d, 'a1', { label: 'Power' })).toBe(d)
    expect(updateAnnotation(d, 'a2', { text: 'Note' })).toBe(d)
    expect(updateAnnotation(d, 'nope', { label: 'x' })).toBe(d)
  })
  it('clips labels and text to the file limits, and drops an empty label', () => {
    const d = sheet()
    expect(updateAnnotation(d, 'a1', { label: 'x'.repeat(100) }).annotations![0].label).toHaveLength(ANNOTATION_LABEL_MAX)
    expect(updateAnnotation(d, 'a2', { text: 'y'.repeat(600) }).annotations![1].text).toHaveLength(ANNOTATION_TEXT_MAX)
    expect('label' in updateAnnotation(d, 'a1', { label: '' }).annotations![0]).toBe(false)
    const unlabelled: Diagram = { ...d, annotations: [{ uid: 'a1', type: 'frame', x: 0, y: 0, w: 100, h: 60 }] }
    expect(updateAnnotation(unlabelled, 'a1', { label: '' })).toBe(unlabelled)
  })
  it('deletes selected annotations and prunes them from the selection', () => {
    const d = sheet()
    expect(deleteSelection(d, { parts: [], wires: [], annotations: ['a1'] }).annotations!.map((a) => a.uid)).toEqual(['a2'])
    expect(deleteSelection(emptyDiagram(), { parts: [], wires: [] })).not.toHaveProperty('annotations')
    expect(deleteSelection(d, { parts: [], wires: [] }).annotations).toBe(d.annotations)
    const s = new EditorStore(d)
    s.select({ parts: [], wires: [], annotations: ['a1', 'a2'] })
    s.commit(deleteSelection(d, { parts: [], wires: [], annotations: ['a1'] }))
    expect(s.getState().selection).toEqual({ parts: [], wires: [], annotations: ['a2'] })
    s.commit(deleteSelection(s.getState().diagram, s.getState().selection))
    expect(s.getState().selection).toEqual({ parts: [], wires: [] })
    s.undo()
    expect(s.getState().diagram.annotations!.map((a) => a.uid)).toEqual(['a2'])
  })
})
