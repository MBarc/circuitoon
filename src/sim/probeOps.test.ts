// Spec 6.2: probe ids are P plus an integer, unique; renaming and removing; a deleted part takes its
// probes with it, so no probe dangles in memory.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from '../agent/layout.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { deleteSelection } from '../editor/ops.ts'
import { addProbe, removeProbe, renameProbe } from './probes.ts'

describe('probe editing ops', () => {
  it('adds, renames and removes probes, and deleting a part takes its probes with it', () => {
    const laid = layoutNetlist(ledNetlist())
    if (!laid.ok) throw new Error(laid.errors.join('; '))
    const s = laid.value.diagram
    const a = addProbe(s, { part: 'D1', pin: 'A' })
    expect(a.id).toBe('P1')
    const b = addProbe(a.diagram, { part: 'R1' }, 'resistor')
    expect(b.id).toBe('P2')
    expect(renameProbe(b.diagram, 'P1', 'anode').probes?.[0]).toEqual({ id: 'P1', name: 'anode', at: { part: 'D1', pin: 'A' } })
    expect(removeProbe(b.diagram, 'P1').probes?.map((p) => p.id)).toEqual(['P2'])
    expect(deleteSelection(b.diagram, { parts: ['D1'], wires: [] }).probes?.map((p) => p.id)).toEqual(['P2'])
    expect(deleteSelection(b.diagram, { parts: ['D1', 'R1'], wires: [] }).probes).toBeUndefined()
  })
})
