// The mains look (spec 5): wires on mains and earth nodes default to their region's colours by
// identity, energized wires are marked, and a new wire from a mains terminal takes its colour.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidColor, serializeDiagram, validateDiagram, wireColor, wireStripe } from './diagram.ts'
import { identityColor, newWireColor, wireLooks } from './mainsLook.ts'
import { Sheet } from '../render/Sheet.tsx'
import { at, sheet, w } from './mains.testing.ts'

const us = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200), at('u1', 'U1', 't-mcu', 400)],
  [w('xs1|L', 'e1|L', { color: undefined }), w('xs1|N', 'e1|N', { color: undefined }), w('xs1|PE', 'e1|PE', { color: undefined })])
const eu = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('e1', 'E1', 't-lamp-230', 200), at('x1', 'X1', 't-term', 400)],
  [w('xs1|L', 'e1|L', { color: undefined }), w('xs1|N', 'e1|N', { color: undefined }), w('xs1|PE', 'x1|1', { color: undefined })])

describe('identity colours', () => {
  it('US and Japan: L black, N white, PE green', () => {
    expect(['L', 'N', 'PE'].map((pin) => identityColor(us, { part: 'xs1', pin }))).toEqual(['black', 'white', 'green'])
  })
  it('Europe, UK and AU: L brown, N blue, PE green-yellow', () => {
    expect(['L', 'N', 'PE'].map((pin) => identityColor(eu, { part: 'xs1', pin }))).toEqual(['brown', 'blue', 'green-yellow'])
  })
  it('a node whose identity depends on the state has no colour (Resolution 19): never shown as PE when it can be L', () => {
    // K1 COM is L while released (through NC) and PE while energized (through NO), never both.
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200)], [w('xs1|L', 'k1|NC'), w('xs1|PE', 'k1|NO')])
    expect(identityColor(d, { part: 'k1', pin: 'COM' })).toBeNull()
    expect(identityColor(d, { part: 'k1', pin: 'NC' })).toBe('black')
  })
  it('a pin off mains has no identity colour, and a sheet without mains has none at all', () => {
    expect(identityColor(us, { part: 'u1', pin: 'IO' })).toBeNull()
    expect(identityColor(sheet([at('u1', 'U1', 't-mcu')], []), { part: 'u1', pin: 'IO' })).toBeNull()
  })
})

describe('wire looks', () => {
  it('marks energized wires as hazards, colours earth wires without the hazard, leaves other wires alone', () => {
    const looks = wireLooks(eu)
    const [l, n, pe] = eu.connections.map((c) => looks.get(c.uid))
    expect(l).toEqual({ color: 'brown', hazard: true })
    expect(n).toEqual({ color: 'blue', hazard: true })
    expect(pe).toEqual({ color: 'green-yellow', hazard: false })
  })
  it('a new wire from a mains terminal takes its identity colour; from a low-voltage pin it keeps the style colour', () => {
    expect(newWireColor(eu, { part: 'xs1', pin: 'L' }, { part: 'e1', pin: 'L' }, 'red')).toBe('brown')
    expect(newWireColor(us, { part: 'u1', pin: 'IO' }, { part: 'u1', pin: 'GND' }, 'red')).toBe('red')
  })
  it('green-yellow is a valid colour that round-trips, drawn green with a yellow stripe', () => {
    expect(isValidColor('green-yellow')).toBe(true)
    expect(wireColor('green-yellow')).toBe('#2F9E6E')
    expect(wireStripe('green-yellow')).toBe('#F4B400')
    expect(wireStripe('red')).toBeNull()
    const d = { ...eu, connections: eu.connections.map((c) => ({ ...c, color: 'green-yellow' })) }
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r.ok && r.diagram.connections.every((c) => c.color === 'green-yellow')).toBe(true)
  })
  it('the sheet draws identity colours, the hazard outline and the lightning markers', () => {
    const html = renderToStaticMarkup(createElement(Sheet, { diagram: eu, box: { x: -20, y: -20, w: 700, h: 300 }, label: 'eu' }))
    expect(html).toContain('stroke="#8B5A2B"')
    expect(html).toContain('class="wire-hazard"')
    expect(html).toContain('data-bolt')
    expect(html).toContain('stroke="#F4B400"')
  })
})

describe('drawing reuses the cached analysis', () => {
  it('rendering a sheet the checker has already analysed runs no second analysis', async () => {
    const { checkDiagram } = await import('./checks.ts')
    const { mainsStats } = await import('./mains.ts')
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('e1', 'E1', 't-lamp-230', 200)], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])
    checkDiagram(d)
    const before = mainsStats.runs
    renderToStaticMarkup(createElement(Sheet, { diagram: d, box: { x: -20, y: -20, w: 700, h: 300 }, label: 'eu' }))
    wireLooks(d)
    expect(mainsStats.runs).toBe(before)
  })
})

describe('lightning markers', () => {
  const bolts = (html: string) => [...html.matchAll(/d="M([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]) - 1, Number(m[2]) + 7])
  it('sit past each end connector, never on it', async () => {
    const { Bolts } = await import('../render/Mains.tsx')
    const html = renderToStaticMarkup(createElement(Bolts, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], insets: [16 + 14, 16] }))
    expect(bolts(html)).toEqual([[30, 0], [184, 0]])
  })
  it('a wire too short for two gets one, at its middle', async () => {
    const { Bolts } = await import('../render/Mains.tsx')
    const html = renderToStaticMarkup(createElement(Bolts, { points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], insets: [30, 30] }))
    expect(bolts(html)).toEqual([[30, 0]])
  })
})
