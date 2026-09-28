// Frames and notes in the Sheet, the standalone SVG (inline colors, stated font, tight bounds), the
// focus box, and the caption geometry the layout relies on.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Diagram } from '../format/diagram.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'
import { buttonLed } from '../samples/buttonLed.ts'
import { contentBounds, focusBounds, renderSheetSvg } from './exportSvg.tsx'
import { CAPTION_SIZE, captionAnchor, captionBox } from './captionBox.ts'
import { annotationRect, wrapNote } from './annotationGeometry.ts'
import { INK, Part } from './Part.tsx'
import { DARK_THEME, LIGHT_THEME, SITE_THEME } from './theme.ts'

const withNotes = (): Diagram => ({
  ...structuredClone(buttonLed),
  annotations: [
    { uid: 'a1', type: 'frame', x: 20, y: 0, w: 480, h: 200, label: 'Loop' },
    { uid: 'a2', type: 'text', x: 30, y: 220, text: 'Press S1 to light D1.' },
  ],
})
const inside = (r: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h

describe('standalone SVG', () => {
  it('draws frames and notes with inline colors, a stated font and its own size', () => {
    const { svg, width, height } = renderSheetSvg(withNotes())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="')).toBe(true)
    expect(svg).toContain(`width="${width}" height="${height}"`)
    expect(svg).toContain('font-family="')
    expect(svg).not.toContain('var(--')
    expect(svg).toContain('data-annotation="a1"')
    expect(svg).toContain('>Loop<')
    expect(svg).toContain('Press S1 to light D1.')
    expect(svg).toContain('#F7F8F3')
    expect(renderSheetSvg(withNotes(), { dark: true }).svg).toContain('#1B211E')
  })
  it('fits the content tightly: every part, wire and note inside, nothing far outside', () => {
    const d = withNotes()
    const box = contentBounds(d)
    for (const p of d.parts) expect(inside(bodyRect(p, layoutModule(d.modules[p.module])), box)).toBe(true)
    for (const a of d.annotations!) expect(inside(annotationRect(a), box)).toBe(true)
    expect(box.w).toBeLessThan(620)
    expect(box.h).toBeLessThan(330)
  })
  it('focuses on chosen parts and the wires touching them', () => {
    const d = structuredClone(buttonLed)
    const all = contentBounds(d)
    const focus = focusBounds(d, ['p4'])
    expect(focus.w * focus.h).toBeLessThan(all.w * all.h)
    expect(inside(bodyRect(d.parts[3], layoutModule(d.modules.led)), focus)).toBe(true)
  })
})

describe('shared geometry', () => {
  it('puts the caption box where Part draws the caption', () => {
    const m = load('resistor')
    const a = captionAnchor(m, 0)
    const html = renderToStaticMarkup(createElement('svg', null, createElement(Part, { module: m, caption: 'R1  220 Ω' })))
    expect(html).toContain(`y="${a.y}"`)
    const box = captionBox({ x: 100, y: 50, designator: 'R1', values: { resistance: { value: 220, unit: 'ohm' } } }, m)
    expect(box.y).toBe(50 + a.y - 8)
    expect(box.x + box.w / 2).toBeCloseTo(100 + a.x, 6)
  })
  it('includes a frame\'s label tab in its bounds, and wraps note text at 48 characters', () => {
    const r = annotationRect({ uid: 'a', type: 'frame', x: 0, y: 20, w: 100, h: 50, label: 'Power' })
    expect(r.y).toBe(12)
    expect(wrapNote('word '.repeat(20).trim()).split('\n').every((l) => l.length <= 48)).toBe(true)
  })
})

describe('dark theme', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  it('cases wires and junction dots in a light color that stands clear of the dark paper', () => {
    expect(contrast(DARK_THEME.casing, DARK_THEME.paper)).toBeGreaterThan(7)
    expect(LIGHT_THEME.casing).toBe(INK)
    const { svg } = renderSheetSvg(structuredClone(buttonLed), { dark: true })
    expect(svg).toContain(`stroke="${DARK_THEME.casing}"`)
    expect(svg).toContain(`r="2.4" fill="${DARK_THEME.casing}"`)
  })
  it('outlines captions in the paper color, so a light caption stays legible on a white breadboard', () => {
    // A caption over a mounted part sits on the board's white body, where the dark theme's light ink
    // alone would vanish; the paper-colored halo keeps the contrast of ink on paper around every glyph.
    expect(contrast(DARK_THEME.ink, DARK_THEME.halo!)).toBeGreaterThan(7)
    expect(contrast(LIGHT_THEME.ink, LIGHT_THEME.halo!)).toBeGreaterThan(7)
    for (const [dark, theme] of [[true, DARK_THEME], [false, LIGHT_THEME]] as const) {
      const { svg } = renderSheetSvg(structuredClone(buttonLed), { dark })
      const captions = [...svg.matchAll(/<text [^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`font-size="${CAPTION_SIZE}" font-weight="700" fill="${theme.ink}"`))
      expect(captions.length).toBeGreaterThan(0)
      for (const t of captions) {
        expect(t).toContain(`stroke="${theme.halo}"`)
        expect(t).toContain('paint-order="stroke"')
      }
    }
  })
  it('draws no halo on the site, whose paper comes from CSS', () => {
    expect(SITE_THEME.halo).toBeUndefined()
  })
})
