// Spec 6.2: probe tags show typical with peak when it differs ("4.38 V (peak 4.21 V)"), say
// "floating", "undefined" or "-" (Simulate off) as words, mark readings outside the model, and
// use eight colours with 3:1 contrast on the sheet paper in both themes. Tags keep off parts.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROBE_COLORS, ProbeLayer, TAG_RESERVE, partText, placeTags, probeColor, readingText, tagText, tagWidth } from './ProbeLayer.tsx'
import { resolveEndpoint } from '../format/diagram.ts'
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
    expect(readingText({ typical: { kind: 'undefined', why: 'not simulated (mains)' }, peak: { kind: 'undefined', why: 'not simulated (mains)' } })).toBe('not simulated (mains)')
    expect(readingText(undefined)).toBe('-')
    expect(readingText({ typical: v(2.1, 'outside-model'), peak: v(2.1, 'outside-model') })).toBe('2.1 V, outside model')
    expect(readingText({ typical: v(4.38, 'outside-model'), peak: v(4.21, 'outside-model') })).toBe('4.38 V (peak 4.21 V), outside model')
  })
  it('reads a part probe as its largest pin current and its power', () => {
    const run = { pins: { A: { kind: 'value' as const, value: 0.0123, trust: 'ok' as const }, K: { kind: 'value' as const, value: -0.0123, trust: 'ok' as const } }, power: v(0.0251) }
    expect(partText({ typical: run, peak: run })).toBe('12.3 mA, 25.1 mW')
    const none = { pins: {}, power: { kind: 'undefined' as const, why: 'not simulated' } }
    expect(partText({ typical: none, peak: none })).toBe('not simulated')
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
    expect(t.box.x + t.box.w <= board.x || t.box.x >= board.x + board.w || t.box.y + t.box.h <= board.y || t.box.y >= board.y + board.h).toBe(true)
  })
  it('lands a hole probe on the hole it was placed on', () => {
    const d = sheet([{ uid: 'bb', module: 'breadboard-half' }], [])
    const [t] = placeTags({ ...d, probes: [{ id: 'P1', at: { part: 'bb', pin: 'top+', hole: 10 } }] }, [{ id: 'P1', text: 'P1 5 V' }])
    expect(t.from).toEqual(resolveEndpoint(d, { part: 'bb', pin: 'top+', hole: 10 })!.end)
    expect(t.from).not.toEqual(resolveEndpoint(d, { part: 'bb', pin: 'top+' })!.end)
  })
  it('shows a reading whole, cutting only a long name', () => {
    expect(tagText('P5', '4.38 V (peak 4.21 V), outside model')).toBe('P5 4.38 V (peak 4.21 V), outside model')
    expect(tagText('battery plus terminal after switch', '3.3 V')).toBe('battery plus te… 3.3 V')
    const d = sheet([{ uid: 'r1', module: 'resistor' }], [])
    const long = 'P5 4.38 V (peak 4.21 V), outside model'
    const [t] = placeTags({ ...d, probes: [{ id: 'P5', at: { part: 'r1', pin: '2' } }] }, [{ id: 'P5', text: long }])
    expect(Math.max(t.box.w, t.box.h)).toBe(tagWidth(long))
    const html = renderToStaticMarkup(createElement('svg', null, createElement(ProbeLayer, { diagram: { ...d, probes: [{ id: 'P5', at: { part: 'r1', pin: '2' } }] }, readings: [{ id: 'P5', at: { part: 'r1', pin: '2' }, voltage: { typical: v(4.38, 'outside-model'), peak: v(4.21, 'outside-model') } }] })))
    expect(html).toContain('>P5 4.38 V (peak 4.21 V), outside model</text>')
  })
  it('dashes a tag whose reading is outside the model, and only that one', () => {
    const d = sheet([{ uid: 'r1', module: 'resistor' }], [])
    const probes = [{ id: 'P1', at: { part: 'r1', pin: '1' } }, { id: 'P2', at: { part: 'r1', pin: '2' } }]
    const readings = [{ id: 'P1', at: probes[0].at, voltage: { typical: v(3.1, 'outside-model'), peak: v(3.1, 'outside-model') } }, { id: 'P2', at: probes[1].at, voltage: { typical: v(1), peak: v(1) } }]
    const html = renderToStaticMarkup(createElement('svg', null, createElement(ProbeLayer, { diagram: { ...d, probes }, readings })))
    expect(html).toMatch(/class="probe-tag outside" data-probe="P1"/)
    expect(html).toMatch(/class="probe-tag" data-probe="P2"/)
  })
  it('keeps a tag in place whatever it reads (Simulate on or off)', () => {
    const d = { ...sheet([{ uid: 'r1', module: 'resistor' }], []), probes: [{ id: 'P1', at: { part: 'r1', pin: '2' } }] }
    const off = placeTags(d, [{ id: 'P1', text: 'P1 -', reserve: tagText('P1', TAG_RESERVE) }])[0]
    const on = placeTags(d, [{ id: 'P1', text: 'P1 1.88 V', reserve: tagText('P1', TAG_RESERVE) }])[0]
    expect([on.tip, on.box.y]).toEqual([off.tip, off.box.y])
  })
  it('puts tags level where a level spot fits', () => {
    const d = { ...sheet([{ uid: 'r1', module: 'resistor' }], []), probes: [{ id: 'P1', at: { part: 'r1' } }] }
    expect(placeTags(d, [{ id: 'P1', text: 'P1 4 mA, 2 mW' }])[0].vertical).toBe(false)
  })
  it('colours a probe by its number, so removing one never recolours the rest', () => {
    expect(probeColor('P1', 5)).toBe(PROBE_COLORS[0])
    expect(probeColor('P3', 0)).toBe(PROBE_COLORS[2])
    expect(probeColor('P9', 0)).toBe(PROBE_COLORS[0])
    expect(probeColor('X', 3)).toBe(PROBE_COLORS[3])
  })
})
