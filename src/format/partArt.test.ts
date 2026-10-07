// A part spec's own art (`art: { shapes, pinLabels? }`): drawn on the body under the pins the part
// maker places, validated with the module rules, kept through specFromModule, and the lint note on
// a custom part still drawn as the generated generic box.
import { describe, expect, it } from 'vitest'
import { ART_OVERHANG, buildPart, lintModule, moduleFromSpec, specFromModule, unmodeled, validateSpec, type PartSpec } from './partMaker.ts'
import { validateModule } from './module.ts'

const AMP: PartSpec = {
  name: 'Test mono amp',
  source: 'https://example.com/amp',
  body: { w: 10, h: 8 },
  pins: { left: [{ name: 'VIN', type: 'power_in', supply: '5V' }, { name: 'GND', type: 'ground' }, { name: 'A+', type: 'input' }], right: [{ name: 'OUT+', type: 'output' }, { name: 'OUT-', type: 'output' }] },
  art: {
    pinLabels: 'inside',
    shapes: [
      { type: 'rect', x: 0, y: 0, w: 100, h: 80, fill: '#1E4F8A', radius: 6 },
      { type: 'rect', x: 40, y: 30, w: 20, h: 20, fill: '#1B1F24', radius: 2, label: 'AMP', labelColor: '#F7F8F3', labelSize: 6 },
    ],
  },
}

describe('spec art', () => {
  it('is drawn as given, on a body the size of body.w x body.h grid units', () => {
    const r = buildPart(AMP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.module.art).toEqual({ w: 100, h: 80, pinLabels: 'inside', shapes: AMP.art!.shapes })
    expect(r.module.size).toEqual({ w: 10, h: 8 })
    expect(validateModule(r.module).ok).toBe(true)
  })

  it('takes the body size from art.w and art.h (px), so module new output art can be copied in whole', () => {
    const plain = moduleFromSpec({ ...AMP, art: undefined, body: undefined })
    const again = moduleFromSpec({ ...AMP, body: undefined, art: { ...plain.art!, shapes: [...plain.art!.shapes, { type: 'rect', x: 4, y: 4, w: 6, h: 6, fill: '#C9CED6', radius: 3 }] } })
    expect(again.art!.w).toBe(plain.art!.w)
    expect(again.size).toEqual(plain.size)
  })

  it('leaves the labels beside the stubs when pinLabels is left out', () => {
    const m = moduleFromSpec({ ...AMP, art: { shapes: AMP.art!.shapes } })
    expect(m.art!.pinLabels).toBeUndefined()
  })

  it('refuses art with no body size, sizes that disagree, or a size off the grid', () => {
    expect(validateSpec({ ...AMP, body: undefined })).toEqual({ ok: false, errors: ['art: give the body size: body.w and body.h in grid units (or art.w and art.h in px, multiples of 10)'] })
    expect(validateSpec({ ...AMP, art: { ...AMP.art, w: 120 } })).toEqual({ ok: false, errors: ['art.w: 120 px does not match body.w (10 grid units, 100 px)'] })
    expect(validateSpec({ ...AMP, body: undefined, art: { ...AMP.art, w: 105, h: 80 } })).toEqual({ ok: false, errors: ['art.w: must be a multiple of 10 px, from 20 to 4000'] })
  })

  it('refuses invalid shapes with the exact path, as the module rules do', () => {
    const bad = (s: unknown) => validateSpec({ ...AMP, art: { shapes: [AMP.art!.shapes[0], s] } })
    expect(bad({ type: 'circle', x: 0, y: 0, w: 4, h: 4, fill: '#000000' })).toEqual({ ok: false, errors: ['art.shapes[1]: only "rect" shapes are supported'] })
    expect(bad({ type: 'rect', x: 'a', y: 0, w: 4, h: 4 })).toEqual({ ok: false, errors: ['art.shapes[1].x: must be a number within +-4000', 'art.shapes[1].fill: required color'] })
    expect(bad({ type: 'rect', x: 0, y: 0, w: 4, h: 4, fill: '#000000', band: 1 })).toEqual({ ok: false, errors: ['art.shapes[1].band: built-in parts only'] })
    expect(bad({ type: 'rect', x: 0, y: 0, w: 4, h: 4, fill: '#000000', horn: true })).toEqual({ ok: false, errors: ['art.shapes[1].horn: built-in parts only'] })
    expect(validateSpec({ ...AMP, art: { shapes: [] } })).toEqual({ ok: false, errors: ['art.shapes: at least one shape'] })
    expect(validateSpec({ ...AMP, art: { shapes: AMP.art!.shapes, pinLabels: 'outside' } })).toEqual({ ok: false, errors: ['art.pinLabels: must be "inside" or "tips"'] })
    expect(validateSpec({ ...AMP, art: { shapes: AMP.art!.shapes, extra: 1 } })).toEqual({ ok: false, errors: ['art.extra: unknown field (allowed: w, h, pinLabels, shapes)'] })
  })

  it(`lets a shape stick out of the body by at most ${ART_OVERHANG} px (a jack, a plug), no further`, () => {
    const at = (x: number, w: number) => validateSpec({ ...AMP, art: { shapes: [AMP.art!.shapes[0], { type: 'rect', x, y: 30, w, h: 20, fill: '#C9CED6' }] } })
    expect(at(100 - 10, 10 + ART_OVERHANG).ok).toBe(true)
    expect(at(-ART_OVERHANG, 30).ok).toBe(true)
    expect(at(90, 11 + ART_OVERHANG)).toEqual({ ok: false, errors: [`art.shapes[1]: reaches 21 px past the body's right edge (100 px); at most ${ART_OVERHANG} px may stick out`] })
    expect(at(-25, 30)).toEqual({ ok: false, errors: [`art.shapes[1]: reaches 25 px past the body's left edge; at most ${ART_OVERHANG} px may stick out`] })
  })

  it('refuses a body too small for the pins instead of growing it under the drawing', () => {
    const r = buildPart({ ...AMP, body: { w: 10, h: 4 }, art: { shapes: [{ type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#1E4F8A' }] } })
    expect(r).toEqual({ ok: false, errors: ['body.h: the pins need at least 5 grid units with this art (4 given)'] })
  })

  it('survives specFromModule, so the dialog edits the part without losing its art', () => {
    const m = moduleFromSpec(AMP)
    const spec = specFromModule(m)
    expect(spec.art).toEqual({ pinLabels: 'inside', shapes: AMP.art!.shapes })
    expect(spec.body).toMatchObject({ w: 10, h: 8 })
    expect(moduleFromSpec(spec)).toEqual(m)
    expect(unmodeled(m)).toEqual([])
  })

  it('specFromModule leaves art out for a part with the generated drawing', () => {
    expect(specFromModule(moduleFromSpec({ ...AMP, art: undefined })).art).toBeUndefined()
  })
})

describe('lint note on generic art', () => {
  it('notes a custom part drawn as the generated generic box, never as an error or a warning', () => {
    const r = lintModule(moduleFromSpec({ ...AMP, art: undefined }))
    expect(r.ok).toBe(true)
    expect(r.notes).toEqual([{ code: 'generic-art', message: 'Drawn as a generic box: draw its art from a photo of the real part (see the art guide, references/art.md in the circuitoon-custom-part skill).' }])
    expect(r.warnings.some((w) => w.code === 'generic-art')).toBe(false)
  })

  it('says nothing for a part with its own art', () => {
    expect(lintModule(moduleFromSpec(AMP)).notes).toEqual([])
  })
})
