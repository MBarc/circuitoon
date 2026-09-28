// Resolution 30: the Inspector never runs a mains analysis while a gesture is open.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { setWireRoute } from './ops.ts'
import { mainsStats } from '../format/mains.ts'
import { type WireLook, holdLooks } from '../format/mainsLook.ts'
import { at, sheet, w } from '../format/mains.testing.ts'

describe('Inspector during a gesture', () => {
  it('a selected colorless wire on a mains sheet, reshaped: no analysis per preview frame, one after the drop', () => {
    const wire = w('xs1|L', 'e1|L', { color: undefined })
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200)], [wire, w('xs1|N', 'e1|N')])
    const store = new EditorStore(d)
    store.select({ parts: [], wires: [wire.uid] })
    // What the Inspector does on each render.
    const held = { current: new Map<string, WireLook>() }
    const render = () => holdLooks(held, store.getState().diagram, store.dragging || store.gestureActive)
    const colour = render().get(wire.uid)?.color
    const before = mainsStats.runs
    const base = store.begin()
    for (let k = 1; k <= 5; k++) {
      store.preview(setWireRoute(base, wire.uid, [[100 + k * 10, 60]]))
      expect(render().get(wire.uid)?.color).toBe(colour)
    }
    expect(mainsStats.runs).toBe(before)
    store.end()
    render()
    expect(mainsStats.runs).toBe(before + 1)
  })
  it('the Inspector takes its look only through holdLooks', () => {
    const src = readFileSync('src/editor/Inspector.tsx', 'utf8')
    expect(src).toContain('holdLooks(')
    expect(src).not.toMatch(/\bwireLooks\(/)
  })
})
