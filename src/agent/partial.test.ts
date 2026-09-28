// The partial format (spec 2.1 --keep): only intent and part positions are read; kept parts stay put,
// the rest are placed around them; the site refuses the file.
import { describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { loadPartial } from './partial.ts'
import { verifyDiagram } from './verify.ts'
import { ledNetlist, tiltSensors } from './fixtures.testing.ts'

const partial = (parts: unknown[]) => ({ format: 'circuitoon-partial/1', title: 'LED', intent: ledNetlist(), parts, connections: [{ uid: 'ignored' }] })

describe('loadPartial', () => {
  it('reads the intent and the parts that have coordinates', () => {
    const r = loadPartial(partial([{ designator: 'BT1', x: 600, y: 300 }, { designator: 'R1' }, { designator: 'BB1', x: 40, y: 40, rotation: 90 }]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.intent).toEqual(ledNetlist())
    expect([...r.keep]).toEqual([
      ['BT1', { x: 600, y: 300, rotation: 0 }],
      ['BB1', { x: 40, y: 40, rotation: 90 }],
    ])
  })
  it('refuses a missing intent, half a position, off-grid positions and a bad rotation', () => {
    const r = loadPartial({ format: 'circuitoon-partial/1', parts: [{ designator: 'A', x: 5 }, { designator: 'B', x: 15, y: 20 }, { designator: 'C', x: 0, y: 0, rotation: 45 }] })
    expect(r).toEqual({
      ok: false,
      errors: [
        'intent: required, the netlist the sheet was laid out from',
        'parts[0]: give both x and y, or neither',
        'parts[1]: x and y must be on the 10 px grid',
        'parts[2].rotation: must be 0, 90, 180 or 270',
      ],
    })
  })
  it('refuses a null rotation rather than reading it as 0', () => {
    expect(loadPartial(partial([{ designator: 'BT1', x: 600, y: 300, rotation: null }]))).toEqual({ ok: false, errors: ['parts[0].rotation: must be 0, 90, 180 or 270'] })
  })
  it('refuses a sheet, a non-object, a missing parts list, a part without a designator and a designator given twice', () => {
    expect(loadPartial([])).toEqual({ ok: false, errors: ['partial must be a JSON object'] })
    expect(loadPartial({ format: 'circuitoon-diagram/1', intent: ledNetlist(), parts: [] })).toEqual({
      ok: false,
      errors: ['format: must be "circuitoon-partial/1" (copy the sheet, change its format, and delete x and y on the parts to place again)'],
    })
    expect(loadPartial({ format: 'circuitoon-partial/1', intent: ledNetlist() })).toEqual({ ok: false, errors: ['parts: required list'] })
    expect(loadPartial(partial([{ x: 0, y: 0 }, 'R1', { designator: 'BT1', x: 0, y: 0 }, { designator: 'BT1' }]))).toEqual({
      ok: false,
      errors: ['parts[0].designator: required', 'parts[1].designator: required', 'parts[3].designator: BT1 is already listed at parts[2]'],
    })
  })
  it('is never a sheet the site opens', () => {
    expect(validateDiagram(partial([{ designator: 'BT1', x: 600, y: 300 }])).ok).toBe(false)
  })
  it('re-lays out around the kept parts: kept positions stay, the rest seat and verify clean', () => {
    const p = loadPartial(partial([{ designator: 'BT1', x: 600, y: 300 }]))
    if (!p.ok) throw new Error(p.errors.join('\n'))
    const r = layoutNetlist(p.intent, { keep: p.keep })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.diagram.parts.find((x) => x.uid === 'BT1')).toMatchObject({ x: 600, y: 300 })
    expect(mountIssues(r.value.diagram)).toEqual([])
    expect(verifyDiagram(r.value.diagram, libraryLookup)).toEqual([])
  })
  it('round trips a laid-out sheet: every part kept stays exactly where it was (amendment A6)', () => {
    const first = layoutNetlist(ledNetlist())
    if (!first.ok) throw new Error(first.errors.join('\n'))
    const sheet = first.value.diagram
    const p = loadPartial({ ...sheet, format: 'circuitoon-partial/1' })
    if (!p.ok) throw new Error(p.errors.join('\n'))
    const r = layoutNetlist(p.intent, { keep: p.keep })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    for (const q of sheet.parts) expect(r.value.diagram.parts.find((x) => x.uid === q.uid), q.uid).toMatchObject({ x: q.x, y: q.y, rotation: q.rotation ?? 0 })
    expect(verifyDiagram(r.value.diagram, libraryLookup)).toEqual([])
  })
  it('keeps a repeat member (amendment A6) and places the missing members around it', () => {
    const p = loadPartial({ format: 'circuitoon-partial/1', intent: tiltSensors(), parts: [{ designator: 'S_1', x: 1500, y: 900 }, { designator: 'S_2' }] })
    if (!p.ok) throw new Error(p.errors.join('\n'))
    const r = layoutNetlist(p.intent, { keep: p.keep })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.diagram.parts.find((x) => x.uid === 'S_1')).toMatchObject({ x: 1500, y: 900, rotation: 0 })
    expect(verifyDiagram(r.value.diagram, libraryLookup)).toEqual([])
  })
})
