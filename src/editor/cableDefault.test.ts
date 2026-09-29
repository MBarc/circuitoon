import { afterEach, describe, expect, it } from 'vitest'
import { loadNewWireEnds, saveNewWireEnds } from './cableDefault.ts'
import { EditorStore } from './store.ts'
import { emptyDiagram } from '../format/diagram.ts'

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
})

describe('the new-wire cable, remembered per browser', () => {
  it('saves and loads normalized ends, and forgets them for a plain wire', () => {
    const m = fakeStorage()
    saveNewWireEnds({ from: 'dupont-male', to: 'bare' })
    expect(loadNewWireEnds()).toEqual({ from: 'dupont-male' })
    saveNewWireEnds(undefined)
    expect(m.size).toBe(0)
    expect(loadNewWireEnds()).toBeUndefined()
  })
  it('ignores junk and unknown kinds in storage', () => {
    const m = fakeStorage()
    m.set('circuitoon.newWire.ends', '{not json')
    expect(loadNewWireEnds()).toBeUndefined()
    m.set('circuitoon.newWire.ends', JSON.stringify({ from: 'usb-c', to: 'jst-ph' }))
    expect(loadNewWireEnds()).toEqual({ to: 'jst-ph' })
    m.set('circuitoon.newWire.ends', '7')
    expect(loadNewWireEnds()).toBeUndefined()
  })
  it('never throws when storage is missing or refuses', () => {
    expect(loadNewWireEnds()).toBeUndefined()
    expect(() => saveNewWireEnds({ to: 'banana' })).not.toThrow()
    g.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }
    expect(loadNewWireEnds()).toBeUndefined()
    expect(() => saveNewWireEnds({ to: 'banana' })).not.toThrow()
    expect(() => new EditorStore(emptyDiagram())).not.toThrow()
  })
  it('starts the store with the remembered cable, and remembers the one picked next', () => {
    const m = fakeStorage()
    saveNewWireEnds({ from: 'alligator', to: 'alligator' })
    const store = new EditorStore(emptyDiagram())
    expect(store.getState().wireStyle).toEqual({ color: 'blue', gauge: 22, ends: { from: 'alligator', to: 'alligator' } })
    store.setWireStyle({ color: 'red', gauge: 22, ends: { from: 'jst-sh', to: 'jst-sh' } })
    expect(JSON.parse(m.get('circuitoon.newWire.ends')!)).toEqual({ from: 'jst-sh', to: 'jst-sh' })
  })
})
