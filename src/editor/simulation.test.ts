// Spec 6.1: a solve on every connectivity or value change, never on a pure move.
import { describe, expect, it } from 'vitest'
import { followStore, solveKey } from './simulation.ts'
import { EditorStore } from './store.ts'
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

describe('followStore', () => {
  const move = (d: typeof base) => ({ ...d, parts: d.parts.map((p) => (p.uid === 'r1' ? { ...p, x: p.x + 40 } : p)) })
  const start = () => {
    const s = new EditorStore({ ...base, connections: base.connections.slice(1) })
    s.setSimulate(true)
    const calls: unknown[] = []
    followStore(s, (_d, held) => calls.push(held))
    return { s, calls }
  }
  it('solves at once, skips drag frames, and solves a drop that changes connectivity', () => {
    const { s, calls } = start()
    expect(calls).toHaveLength(1)
    const from = s.begin()
    s.preview(move(from))
    s.preview({ ...move(from), connections: base.connections })
    expect(calls).toHaveLength(1)
    s.end()
    expect(calls).toHaveLength(2)
  })
  it('never solves a pure move, and solves a probe edit', () => {
    const { s, calls } = start()
    s.commit(move(s.getState().diagram))
    s.select({ parts: ['r1'], wires: [] })
    expect(calls).toHaveLength(1)
    s.commit({ ...s.getState().diagram, probes: [{ id: 'P1', at: { part: 'r1', pin: '1' } }] })
    expect(calls).toHaveLength(2)
  })
  it('solves a button press and its release during the still drag it starts', () => {
    const { s, calls } = start()
    s.begin()
    s.setHeld({ part: 'b1', group: 's' })
    expect(calls).toEqual([null, { part: 'b1', group: 's' }])
    s.setHeld(null)
    expect(calls).toEqual([null, { part: 'b1', group: 's' }, null])
    s.end()
    expect(calls).toHaveLength(3)
  })
})
