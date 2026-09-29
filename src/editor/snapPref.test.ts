import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSnapObjects, saveSnapObjects } from './snapPref.ts'
import { EditorStore } from './store.ts'
import { addPart, moveParts } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const g = globalThis as { localStorage?: unknown }
function fakeStorage() {
  const m = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
  return m
}
afterEach(() => {
  delete g.localStorage
  vi.useRealTimers()
})

describe('Snap to objects, remembered per browser', () => {
  it('is on by default and remembers being turned off', () => {
    const m = fakeStorage()
    expect(loadSnapObjects()).toBe(true)
    saveSnapObjects(false)
    expect(m.get('circuitoon.snapObjects')).toBe('off')
    expect(loadSnapObjects()).toBe(false)
    saveSnapObjects(true)
    expect(loadSnapObjects()).toBe(true)
  })
  it('never throws when storage is missing or refuses', () => {
    expect(loadSnapObjects()).toBe(true)
    g.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }
    expect(loadSnapObjects()).toBe(true)
    expect(() => saveSnapObjects(false)).not.toThrow()
  })
  it('starts the store with the remembered setting and saves a change', () => {
    const m = fakeStorage()
    saveSnapObjects(false)
    const s = new EditorStore(emptyDiagram())
    expect(s.getState().snapObjects).toBe(false)
    s.setSnapObjects(true)
    expect(s.getState().snapObjects).toBe(true)
    expect(m.has('circuitoon.snapObjects')).toBe(false)
  })
})

describe('coalesced commits (arrow-key nudges)', () => {
  const mod: ModuleDef = { format: 'circuitoon-module/1', id: 'x', name: 'X', pins: [{ name: 'A', side: 'left' }] }
  const fresh = () => new EditorStore(addPart(emptyDiagram(), mod, 0, 0).diagram)
  const x = (s: EditorStore) => s.getState().diagram.parts[0].x

  it('folds consecutive commits with the same key into one undo step', () => {
    vi.useFakeTimers()
    const s = fresh()
    for (let i = 0; i < 5; i++) {
      s.commit(moveParts(s.getState().diagram, ['p1'], 10, 0), 'nudge:p1')
      vi.advanceTimersByTime(100)
    }
    expect(x(s)).toBe(50)
    s.undo()
    expect(x(s)).toBe(0)
    expect(s.canUndo).toBe(false)
  })
  it('starts a new step after a pause, another edit, an undo or a different key', () => {
    vi.useFakeTimers()
    const s = fresh()
    const nudge = (key = 'nudge:p1') => s.commit(moveParts(s.getState().diagram, ['p1'], 10, 0), key)
    nudge()
    vi.advanceTimersByTime(1500)
    nudge()
    s.undo()
    expect(x(s)).toBe(10)
    nudge()
    s.commit({ ...s.getState().diagram, title: 'x' })
    nudge()
    s.undo()
    expect(x(s)).toBe(20)
    nudge('nudge:other')
    nudge()
    s.undo()
    expect(x(s)).toBe(30)
  })
})
