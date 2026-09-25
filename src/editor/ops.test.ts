import { describe, expect, it } from 'vitest'
import { addPart, addWire, deleteSelection, moveParts, nextDesignator, rotateParts, updatePart, updateWire } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const resistor: ModuleDef = {
  format: 'circuitoon-module/1', id: 'resistor', name: 'Resistor',
  pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
}
const style = { color: 'red', gauge: 22 }

function twoResistors() {
  const a = addPart(emptyDiagram(), resistor, 0, 0)
  const b = addPart(a.diagram, resistor, 100, 0)
  return b.diagram
}

describe('ops', () => {
  it('adds parts with fresh uids and designators, embedding the module once', () => {
    const d = twoResistors()
    expect(d.parts.map((p) => [p.uid, p.designator])).toEqual([['p1', 'R1'], ['p2', 'R2']])
    expect(Object.keys(d.modules)).toEqual(['resistor'])
    expect(nextDesignator(d, resistor)).toBe('R3')
  })
  it('moves and rotates only the given parts', () => {
    const d = rotateParts(moveParts(twoResistors(), ['p2'], 20, -10), ['p2'])
    expect(d.parts[0]).toMatchObject({ x: 0, y: 0, rotation: 0 })
    expect(d.parts[1]).toMatchObject({ x: 120, y: -10, rotation: 90 })
    expect(rotateParts(rotateParts(rotateParts(d, ['p2']), ['p2']), ['p2']).parts[1].rotation).toBe(0)
  })
  it('adds a wire, refusing self-loops and duplicates in either direction', () => {
    const d = twoResistors()
    const w = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    expect(w.uid).toBe('w1')
    expect(w.diagram.connections[0]).toEqual({ uid: 'w1', from: { part: 'p1', pin: '2' }, to: { part: 'p2', pin: '1' }, color: 'red', gauge: 22 })
    expect(addWire(w.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: '2' }, style)).toBeNull()
    expect(addWire(d, { part: 'p1', pin: '1' }, { part: 'p1', pin: '1' }, style)).toBeNull()
  })
  it('deleting a part deletes its wires', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = deleteSelection(w.diagram, { parts: ['p2'], wires: [] })
    expect(d.parts.map((p) => p.uid)).toEqual(['p1'])
    expect(d.connections).toEqual([])
  })
  it('updates designators and wire properties', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = updateWire(updatePart(w.diagram, 'p1', { designator: 'RLIM' }), 'w1', { color: '#123456', gauge: 18, label: 'LED+' })
    expect(d.parts[0].designator).toBe('RLIM')
    expect(d.connections[0]).toMatchObject({ color: '#123456', gauge: 18, label: 'LED+' })
  })
})
