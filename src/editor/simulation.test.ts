// Spec 6.1: a solve on every connectivity or value change, never on a pure move.
import { describe, expect, it } from 'vitest'
import { solveKey } from './simulation.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const base = sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 100, unit: 'ohm' } } }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])

describe('solveKey', () => {
  it('ignores a pure move', () => {
    const moved = { ...base, parts: base.parts.map((p) => (p.uid === 'r1' ? { ...p, x: p.x + 200, y: p.y + 70 } : p)) }
    expect(solveKey(moved, null)).toBe(solveKey(base, null))
  })
  it('changes with a value, a wire, a held button or a module', () => {
    const k = solveKey(base, null)
    expect(solveKey({ ...base, parts: base.parts.map((p) => (p.uid === 'r1' ? { ...p, values: { resistance: { value: 220, unit: 'ohm' } } } : p)) }, null)).not.toBe(k)
    expect(solveKey({ ...base, connections: base.connections.slice(1) }, null)).not.toBe(k)
    expect(solveKey(base, { part: 'b1', group: 's' })).not.toBe(k)
    expect(solveKey({ ...base, modules: { ...base.modules, resistor: { ...base.modules.resistor } } }, null)).not.toBe(k)
  })
})
