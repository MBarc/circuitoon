import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { serializeDiagram } from '../format/diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'
import { readDiagramFile } from './files.ts'
import { COLLAPSED_COUNT, orderWarnings, shownWarnings } from './warningList.ts'
import { LoadWarnings } from './LoadWarnings.tsx'

/** Astra's reproduction: three parts with missing modules ahead of a resistor whose override
 * {value: 220, unit: "F"} is replaced by the 1 kohm default. */
async function openWithFourWarnings(): Promise<string[]> {
  const d = structuredClone(buttonLed)
  const resistor = d.parts.findIndex((p) => p.designator === 'R1')
  const others = d.parts.filter((_, i) => i !== resistor)
  others.forEach((p, i) => (p.module = `missing-${i}`))
  d.parts = [...others, { ...d.parts[resistor], values: { resistance: { value: 220, unit: 'F' } } }]
  const r = await readDiagramFile(new File([serializeDiagram(d)], 'four.circuitoon.json'))
  if (!r.ok) throw new Error(r.message)
  return r.warnings
}

describe('load warnings', () => {
  it('reproduces the case: the value replacement comes after three other warnings in file order', async () => {
    const w = await openWithFourWarnings()
    expect(w).toHaveLength(4)
    expect(w.slice(0, 3).every((x) => /is not embedded/.test(x))).toBe(true)
    expect(w[3]).toMatch(/R1 has resistance 220 F/)
  })

  it('lists value replacements first and marks them, keeping file order otherwise', async () => {
    const w = await openWithFourWarnings()
    const ordered = orderWarnings(w)
    expect(ordered.map((x) => x.text)).toEqual([w[3], w[0], w[1], w[2]])
    expect(ordered.map((x) => x.valueReplaced)).toEqual([true, false, false, false])
  })

  it('collapsed, shows the first few but never hides a value replacement; expanded, shows all', () => {
    const other = Array.from({ length: 6 }, (_, i) => `parts[${i}]: module "m${i}" is not embedded in this file`)
    const values = Array.from({ length: 5 }, (_, i) => `parts[${i}].values.resistance: R${i} has resistance -1 ohm, but ...; it was dropped and the module default is shown`)
    const all = orderWarnings([...other, ...values])
    expect(shownWarnings(all, false)).toHaveLength(5)
    expect(shownWarnings(all, false).every((x) => x.valueReplaced)).toBe(true)
    expect(shownWarnings(orderWarnings(other), false)).toHaveLength(COLLAPSED_COUNT)
    expect(shownWarnings(all, true)).toHaveLength(11)
  })

  it('renders the value warning in the collapsed panel, tagged, with "Show all 4"', async () => {
    const w = await openWithFourWarnings()
    const html = renderToStaticMarkup(createElement(LoadWarnings, { warnings: w, onDismiss: () => {} }))
    expect(html).toContain('R1 has resistance 220 F, but resistance must be in ohm')
    expect(html).toContain('Value replaced')
    expect(html).toContain('Show all 4')
    expect(html).toContain('Opened with 4 warnings')
    expect(html).toContain('1 value was replaced by the part default')
  })

  it('renders every warning when expanded', async () => {
    const w = await openWithFourWarnings()
    const html = renderToStaticMarkup(createElement(LoadWarnings, { warnings: w, onDismiss: () => {}, initiallyExpanded: true }))
    for (const x of w) expect(html).toContain(x.replaceAll('"', '&quot;'))
    expect(html).toContain('Show fewer')
  })
})
