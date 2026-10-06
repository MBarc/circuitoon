// Spec 6.2: probe tags show typical with peak when it differs ("4.38 V (peak 4.21 V)"), say
// "floating", "undefined" or "-" (Simulate off) as words, mark readings outside the model, and
// use eight colours with 3:1 contrast on the sheet paper in both themes. Tags keep off parts.
import { describe, expect, it } from 'vitest'
import { PROBE_COLORS, partText, placeTags, readingText } from './ProbeLayer.tsx'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { sheet } from '../sim/testing.ts'

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
const v = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, reference: 'GND', trust })

describe('probe tags', () => {
  it('reads typical, with peak when it differs, and says the states in words', () => {
    expect(readingText({ typical: v(4.38), peak: v(4.21) })).toBe('4.38 V (peak 4.21 V)')
    expect(readingText({ typical: v(3.3), peak: v(3.3) })).toBe('3.3 V')
    expect(readingText({ typical: { kind: 'floating' }, peak: { kind: 'floating' } })).toBe('floating')
    expect(readingText({ typical: { kind: 'undefined', why: 'mains' }, peak: { kind: 'undefined', why: 'mains' } })).toBe('undefined')
    expect(readingText(undefined)).toBe('-')
    expect(readingText({ typical: v(2.1, 'outside-model'), peak: v(2.1, 'outside-model') })).toBe('2.1 V (outside the model)')
  })
  it('reads a part probe as its largest pin current and its power', () => {
    const run = { pins: { A: { kind: 'value' as const, value: 0.0123, trust: 'ok' as const }, K: { kind: 'value' as const, value: -0.0123, trust: 'ok' as const } }, power: v(0.0251) }
    expect(partText({ typical: run, peak: run })).toBe('12.3 mA, 25.1 mW')
  })
  it('uses eight colours with at least 3:1 contrast on both papers', () => {
    expect(PROBE_COLORS).toHaveLength(8)
    for (const c of PROBE_COLORS) {
      expect(contrast(c, '#F7F8F3'), c).toBeGreaterThanOrEqual(3)
      expect(contrast(c, '#DDDFE0'), c).toBeGreaterThanOrEqual(3)
    }
  })
  it('places tags clear of part bodies and of each other', () => {
    const d = sheet([{ uid: 'r1', module: 'resistor' }, { uid: 'r2', module: 'resistor' }], [])
    const tags = placeTags({ ...d, probes: [{ id: 'P1', at: { part: 'r1', pin: '1' } }, { id: 'P2', at: { part: 'r1', pin: '2' } }, { id: 'P3', at: { part: 'r2' } }] }, [{ id: 'P1', text: 'P1 3.3 V' }, { id: 'P2', text: 'P2 1.2 V' }, { id: 'P3', text: 'P3 4 mA, 2 mW' }])
    expect(tags).toHaveLength(3)
    const bodies = d.parts.map((p) => bodyRect(p, layoutModule(d.modules[p.module])))
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const t of tags) for (const b of bodies) expect(hit(t.box, b)).toBe(false)
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) expect(hit(tags[i].box, tags[j].box)).toBe(false)
  })
  it('leads a breadboard hole probe out past the board edge, its tag off the board', () => {
    const d = sheet([{ uid: 'bb', module: 'breadboard-half' }], [])
    const [t] = placeTags({ ...d, probes: [{ id: 'P1', at: { part: 'bb', pin: 'top+' } }] }, [{ id: 'P1', text: 'P1 5 V' }])
    const board = bodyRect(d.parts[0], layoutModule(d.modules['breadboard-half']))
    expect(t.box.y + t.box.h).toBeLessThanOrEqual(board.y)
  })
})
