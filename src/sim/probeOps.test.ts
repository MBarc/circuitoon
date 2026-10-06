// Spec 6.2: probe ids are P plus an integer, unique; renaming and removing; a deleted part takes its
// probes with it, so no probe dangles in memory.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from '../agent/layout.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { deleteSelection } from '../editor/ops.ts'
import { addProbe, nextProbeId, removeProbe, renameProbe } from './probes.ts'

describe('probe editing ops', () => {
  it('never gives an exponent id after a long saved one', () => {
    const d = { probes: [{ id: 'P999999999999999999999', at: { part: 'R1' } }] } as unknown as Parameters<typeof nextProbeId>[0]
    expect(nextProbeId(d)).toBe('P1000000000000000000000')
    expect(nextProbeId({ probes: [] } as unknown as Parameters<typeof nextProbeId>[0])).toBe('P1')
  })
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
  it('add trims and clamps a name as rename does (40 characters; blank is no name); renaming a missing probe changes nothing', () => {
    const laid = layoutNetlist(ledNetlist())
    if (!laid.ok) throw new Error(laid.errors.join('; '))
    const s = laid.value.diagram
    const long = `  ${'x'.repeat(50)}  `
    const added = addProbe(s, { part: 'D1', pin: 'A' }, long).diagram
    expect(added.probes?.[0].name).toBe('x'.repeat(40))
    expect(added.probes?.[0]).toEqual(renameProbe(addProbe(s, { part: 'D1', pin: 'A' }).diagram, 'P1', long).probes?.[0])
    expect(addProbe(s, { part: 'D1' }, '   ').diagram.probes?.[0]).toEqual({ id: 'P1', at: { part: 'D1' } })
    expect(renameProbe(added, 'P9', 'other')).toBe(added)
    expect(renameProbe(s, 'P1', 'other')).toBe(s)
  })
})
