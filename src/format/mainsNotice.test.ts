// Honesty in the product (spec 6): a mains sheet always carries the notice, in the Problems panel,
// in the drawing and in exported JSON; the empty state speaks only of the drawn connections.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { serializeDiagram, validateDiagram } from './diagram.ts'
import { MAINS_NOTICE, analyseMains, hasMains, withSheetNotes } from './mains.ts'
import { checkDiagram } from './checks.ts'
import { Sheet } from '../render/Sheet.tsx'
import { EditorStore } from '../editor/store.ts'
import { ProblemList } from '../editor/Inspector.tsx'
import { at, sheet, w } from './mains.testing.ts'
import { load } from './builtinModules.testing.ts'
import { MAINS_NOTICE_FONT, NOTICE_MIN_WIDTH, noticeHeight, noticeLines } from '../render/Mains.tsx'

const mainsSheet = sheet([at('xs1', 'XS1', 't-outlet')], [])
const relayOnly = sheet([at('k1', 'K1', 't-relay')], [])
const noMains = sheet([at('u1', 'U1', 't-mcu')], [])
const list = (d: ReturnType<typeof sheet>) => {
  const s = new EditorStore(d)
  return renderToStaticMarkup(createElement(ProblemList, { store: s, findings: checkDiagram(d) }))
}

describe('the mains notice', () => {
  it('says exactly what the spec says', () => {
    expect(MAINS_NOTICE).toBe('Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.')
  })
  it('appears for a mains source or connection point: an outlet or a plug', () => {
    expect(hasMains(mainsSheet)).toBe(true)
    expect(hasMains(sheet([at('p1', 'P1', 't-plug-us')], []))).toBe(true)
    expect(hasMains(sheet([at('a1', 'A1', 't-charger-uk')], []))).toBe(true)
    expect(hasMains(noMains)).toBe(false)
  })
  it('appears for a part whose mains pins are wired to something that could carry mains, not for one left unwired', () => {
    expect(hasMains(relayOnly)).toBe(false)
    expect(hasMains(sheet([at('k1', 'K1', 't-relay'), at('e1', 'E1', 't-lamp', 200)], [w('k1|COM', 'e1|L')]))).toBe(true)
    expect(hasMains(sheet([at('ps1', 'PS1', 't-psu'), at('x1', 'X1', 't-term', 200)], [w('ps1|AC1', 'x1|1')]))).toBe(true)
    expect(hasMains(sheet([at('ps1', 'PS1', 't-psu')], []))).toBe(false)
    // A relay switching a low-voltage board: its contacts carry nothing that could be mains.
    expect(hasMains(sheet([at('k1', 'K1', 't-relay'), at('u1', 'U1', 't-mcu', 200)], [w('k1|COM', 'u1|VCC')]))).toBe(false)
  })
  it('does not appear for a battery circuit whose switch merely carries AC ratings (a KCD1), though the analysis still runs', () => {
    const kcd1 = load('rocker-switch-kcd1')
    const bat = load('battery-holder-2xaa')
    const led = load('led')
    const d = sheet(
      [at('bt1', 'BT1', bat.id), at('sw1', 'SW1', kcd1.id, 200), at('d1', 'D1', led.id, 400)],
      [w('bt1|+', 'sw1|1'), w('sw1|2', 'd1|A'), w('d1|K', 'bt1|-')],
      { [kcd1.id]: kcd1, [bat.id]: bat, [led.id]: led },
    )
    expect(hasMains(d)).toBe(false)
    expect(analyseMains(d)).not.toBeNull()
    expect(renderToStaticMarkup(createElement(Sheet, { diagram: d, box: { x: 0, y: 0, w: 400, h: 200 }, label: 'b' }))).not.toContain('Mains wiring')
    expect(list(d)).not.toContain(MAINS_NOTICE)
    expect(withSheetNotes(d).notes).toBeUndefined()
    // The same switch between an outlet and a lamp is on a mains sheet.
    const lit = sheet([at('xs1', 'XS1', 't-outlet'), at('sw1', 'SW1', kcd1.id, 200), at('e1', 'E1', 't-lamp', 400)], [w('xs1|L', 'sw1|1'), w('sw1|2', 'e1|L')], { [kcd1.id]: kcd1 })
    expect(hasMains(lit)).toBe(true)
  })
  it('the Problems panel shows it with the new empty state, and not on a sheet without mains', () => {
    const html = list(mainsSheet)
    expect(html).toContain(MAINS_NOTICE)
    expect(html).toContain('No problems found in the drawn connections.')
    expect(list(relayOnly)).not.toContain(MAINS_NOTICE)
    const plain = list(noMains)
    expect(plain).not.toContain(MAINS_NOTICE)
    expect(plain).toContain('No problems found in the drawn connections.')
  })
  it('is never beside a clean claim when a check did not finish', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = sheet([at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100))], ks.map((k) => w('xs1|L', `s${k}|1`)))
    const html = list(d)
    expect(html).toContain('Mains checks did not finish: 17 switches and relays.')
    expect(html).not.toContain('No problems found')
  })
  it('is drawn into the sheet, whole, in a footer the sheet reserves below the drawing (what image, print and PDF exports render)', () => {
    // 80 px is narrower than any band: the sheet widens to the 320 px minimum for its footer.
    for (const w of [80, 400, 1200]) {
      const html = renderToStaticMarkup(createElement(Sheet, { diagram: mainsSheet, box: { x: 0, y: 0, w, h: 200 }, label: 'm' }))
      const band = Math.max(w, NOTICE_MIN_WIDTH)
      const lines = noticeLines(MAINS_NOTICE, band - 32)
      // Every word, in order, across the drawn lines.
      expect(lines.join(' ')).toBe(MAINS_NOTICE)
      for (const l of lines) expect(html).toContain(`>${l}</text>`)
      // No line wider than the band, by the conservative measure.
      for (const l of lines) expect(l.length * 0.62 * MAINS_NOTICE_FONT).toBeLessThanOrEqual(band - 32)
      // The viewBox grows by the footer (and to the band's width), so the notice never covers the drawing or overflows.
      expect(html).toContain(`viewBox="0 0 ${band} ${200 + noticeHeight(lines.length)}"`)
    }
    // A word longer than a line is split with hyphens, and no piece overruns.
    const long = noticeLines('Mains wiring: Supercalifragilisticexpialidocious enclosures', 60)
    for (const l of long) expect(l.length * 0.62 * MAINS_NOTICE_FONT).toBeLessThanOrEqual(60)
    expect(long.join(' ').replace(/- /g, '')).toBe('Mains wiring: Supercalifragilisticexpialidocious enclosures')
    const plain = renderToStaticMarkup(createElement(Sheet, { diagram: noMains, box: { x: 0, y: 0, w: 400, h: 200 }, label: 'r' }))
    expect(plain).not.toContain('Mains wiring')
    expect(plain).toContain('viewBox="0 0 400 200"')
  })
  it('is stored in exported JSON as a sheet note, once, and removed when the sheet has no mains part', () => {
    const out = withSheetNotes(mainsSheet)
    expect(out.notes).toEqual([MAINS_NOTICE])
    expect(withSheetNotes(out)).toBe(out)
    expect(withSheetNotes({ ...noMains, notes: [MAINS_NOTICE, 'mine'] }).notes).toEqual(['mine'])
    const r = validateDiagram(JSON.parse(serializeDiagram(out)))
    expect(r.ok && r.diagram.notes).toEqual([MAINS_NOTICE])
  })
  it('drops notes that are not strings, with a warning', () => {
    const r = validateDiagram({ ...JSON.parse(serializeDiagram(mainsSheet)), notes: [MAINS_NOTICE, 7] })
    expect(r.ok && r.diagram.notes).toEqual([MAINS_NOTICE])
    expect(r.ok && r.warnings).toContain('notes[1]: must be a string, so it was dropped')
  })
})
