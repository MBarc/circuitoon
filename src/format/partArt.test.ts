// A part spec's own art (`art: { shapes, pinLabels? }`): drawn on the body under the pins the part
// maker places, validated with the module rules, kept through specFromModule, and the lint note on
// the photo it was drawn from, and the look check on a custom part (generic box art, no photo).
import { describe, expect, it } from 'vitest'
import { ART_OVERHANG, buildPart, customLook, lintModule, moduleFromSpec, specFromModule, unmodeled, validateSpec, type PartSpec } from './partMaker.ts'
import { ART_LABEL_MAX, ART_LABEL_SIZE_MAX, ART_SHAPES_MAX, validateModule } from './module.ts'

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

  it(`lets a shape stick out of a side with no pins by at most ${ART_OVERHANG} px (a jack, a plug), no further`, () => {
    // AMP has pins on the left and right only: the top and bottom are free.
    const at = (y: number, h: number) => validateSpec({ ...AMP, art: { shapes: [AMP.art!.shapes[0], { type: 'rect', x: 30, y, w: 20, h, fill: '#C9CED6' }] } })
    expect(at(80 - 10, 10 + ART_OVERHANG).ok).toBe(true)
    expect(at(-ART_OVERHANG, 30).ok).toBe(true)
    expect(at(70, 11 + ART_OVERHANG)).toEqual({ ok: false, errors: [`art.shapes[1]: reaches 21 px past the body's bottom edge (80 px); at most ${ART_OVERHANG} px may stick out`] })
    expect(at(-25, 30)).toEqual({ ok: false, errors: [`art.shapes[1]: reaches 25 px past the body's top edge; at most ${ART_OVERHANG} px may stick out`] })
  })

  it('refuses a shape that sticks out of a side with pins, where it would cover the pin stubs', () => {
    const at = (x: number, w: number) => validateSpec({ ...AMP, art: { shapes: [AMP.art!.shapes[0], { type: 'rect', x, y: 30, w, h: 20, fill: '#C9CED6' }] } })
    expect(at(-6, 20)).toEqual({ ok: false, errors: ['art.shapes[1]: sticks out 6 px past the left edge, which has pins: it would cover their stubs. Only a side without pins may have a shape sticking out.'] })
    expect(at(90, 15)).toEqual({ ok: false, errors: ['art.shapes[1]: sticks out 5 px past the right edge, which has pins: it would cover their stubs. Only a side without pins may have a shape sticking out.'] })
    expect(at(0, 100).ok).toBe(true)
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

const PHOTO = 'https://example.com/amp.jpg'
const GENERIC_TODO = "find the maker's product photo, draw its art per the art guide (references/art.md in the circuitoon-custom-part skill), record the photo URL in `photo`, rebuild the part with `module new`, embed it and lay out again."
const PHOTO_TODO = 'record the product photo URL you drew it from in `photo`, or "none: <why>" if no photo of this part exists anywhere.'
const PHOTO_ERROR = 'photo: must be an http(s) URL of a product photo of this exact part, at most 500 characters, or "none: <why>" (a reason of 10 to 200 characters) when no photo of it exists'
const NONE_WHY = 'none: a hand-wound coil made for this project'
const BARE_NONE = 'has "photo": "none" with no reason. Shops sell nearly every generic part (a panel jack, a USB audio adapter, a speaker) with a product photo: find one and record its URL in `photo`. Only when no photo of it exists anywhere, write "none: <why>".'

describe('the photo field', () => {
  it('is carried from the spec onto the module and back', () => {
    const m = moduleFromSpec({ ...AMP, photo: PHOTO })
    expect(m.photo).toBe(PHOTO)
    expect(specFromModule(m).photo).toBe(PHOTO)
    expect(specFromModule(moduleFromSpec({ ...AMP, art: undefined, photo: NONE_WHY })).photo).toBe(NONE_WHY)
    expect(unmodeled(m)).toEqual([])
    expect('photo' in moduleFromSpec(AMP)).toBe(false)
  })

  it('is validated in the spec with its exact path', () => {
    const r = validateSpec({ ...AMP, photo: 'a photo' })
    expect(r.ok ? [] : r.errors).toEqual([PHOTO_ERROR])
  })

  it('takes "none: <why>" with a reason of 10 to 200 characters, and a bare "none" (old sheets)', () => {
    expect(validateSpec({ ...AMP, photo: NONE_WHY }).ok).toBe(true)
    expect(validateSpec({ ...AMP, photo: 'none' }).ok).toBe(true)
    for (const bad of ['none:', 'none: short', `none: ${'x'.repeat(201)}`, 'None: a hand-wound coil made here'])
      expect(validateSpec({ ...AMP, photo: bad }).ok, bad).toBe(false)
  })
})

describe('how a custom part looks', () => {
  it('is a problem when the part is drawn as the generic box or has no photo, with the fix for that reason', () => {
    expect(customLook(moduleFromSpec({ ...AMP, art: undefined, photo: PHOTO }))).toEqual({ code: 'custom-part-look', message: `is drawn as the generic box: ${GENERIC_TODO}` })
    expect(customLook(moduleFromSpec({ ...AMP, art: undefined }))).toEqual({ code: 'custom-part-look', message: `is drawn as the generic box and has no \`photo\`: ${GENERIC_TODO}` })
    expect(customLook(moduleFromSpec(AMP))).toEqual({ code: 'custom-part-look', message: `has no \`photo\`: ${PHOTO_TODO}` })
    const none = customLook(moduleFromSpec({ ...AMP, art: undefined, photo: NONE_WHY }))
    expect(none?.code).toBe('custom-part-look')
    expect(none?.message).toBe("is drawn as the generic box: draw its art per the art guide (references/art.md in the circuitoon-custom-part skill) from the maker's drawing or the typical part, rebuild the part with `module new`, embed it and lay out again.")
    expect(customLook(moduleFromSpec({ ...AMP, photo: PHOTO }))).toBeNull()
    expect(customLook(moduleFromSpec({ ...AMP, photo: NONE_WHY }))).toEqual({ code: 'custom-part-no-photo', message: 'has no photo ("a hand-wound coil made for this project"), so its art was not drawn from a photo of the real part. Say so when you present the design.' })
    expect(customLook(moduleFromSpec({ ...AMP, photo: 'none' }))).toEqual({ code: 'custom-part-look', message: BARE_NONE })
  })

  it('takes the generated chip drawing as a real look (a bare chip looks like that), but still wants a photo', () => {
    const chip = { name: 'Test op amp (DIP-8)', style: 'chip' as const, source: 'https://example.com/opamp', pins: { left: ['OUT1', 'IN1-', 'IN1+', 'GND'], right: ['VCC', 'OUT2', 'IN2-', 'IN2+'] } }
    expect(customLook(moduleFromSpec({ ...chip, photo: PHOTO }))).toBeNull()
    expect(customLook(moduleFromSpec({ ...chip, photo: NONE_WHY }))?.code).toBe('custom-part-no-photo')
    expect(customLook(moduleFromSpec(chip))).toEqual({ code: 'custom-part-look', message: `has no \`photo\`: ${PHOTO_TODO}` })
  })

  it('applies to any module it is given, custom or not (the callers pass only parts outside the library)', () => {
    const m = moduleFromSpec({ ...AMP, art: undefined, photo: PHOTO })
    const { custom: _c, ...plain } = m
    expect(customLook({ ...plain, id: 'hand-made-amp' })?.code).toBe('custom-part-look')
  })

  it('is a lint warning only when asked (module new and check ask, the editor does not)', () => {
    const generic = moduleFromSpec({ ...AMP, art: undefined })
    expect(lintModule(generic)).toEqual({ ok: true, errors: [], warnings: [] })
    const r = lintModule(generic, { look: true })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([{ code: 'custom-part-look', message: `Test mono amp ${customLook(generic)!.message}` }])
    expect(lintModule(moduleFromSpec({ ...AMP, photo: PHOTO }), { look: true }).warnings).toEqual([])
  })
})

describe('art shape limits', () => {
  const m = (shapes: unknown[]) => ({ format: 'circuitoon-module/1', id: 'x', name: 'x', pins: [{ name: 'A', side: 'left' }], art: { w: 40, h: 30, shapes } })
  const rect = (extra: object = {}) => ({ type: 'rect', x: 0, y: 0, w: 40, h: 30, fill: '#2F9E6E', ...extra })
  const errors = (shapes: unknown[]) => { const r = validateModule(m(shapes)); return r.ok ? [] : r.errors }
  it('caps the shape count, label length, radius and label size, in spec and module art alike', () => {
    expect(errors(Array.from({ length: ART_SHAPES_MAX }, () => rect()))).toEqual([])
    expect(errors(Array.from({ length: ART_SHAPES_MAX + 1 }, () => rect()))).toEqual([`art.shapes: at most ${ART_SHAPES_MAX} shapes (${ART_SHAPES_MAX + 1} given)`])
    expect(errors([rect({ label: 'x'.repeat(ART_LABEL_MAX) })])).toEqual([])
    expect(errors([rect({ label: 'x'.repeat(ART_LABEL_MAX + 1) })])).toEqual([`art.shapes[0].label: at most ${ART_LABEL_MAX} characters`])
    expect(errors([rect({ radius: -1 })])).toEqual(['art.shapes[0].radius: must be a number, 0 or more'])
    expect(errors([rect({ labelSize: ART_LABEL_SIZE_MAX + 1 })])).toEqual([`art.shapes[0].labelSize: must be a number above 0, at most ${ART_LABEL_SIZE_MAX}`])
    const spec = validateSpec({ name: 'X', body: { w: 4, h: 3 }, pins: { left: ['A'] }, art: { shapes: [rect({ label: 'x'.repeat(ART_LABEL_MAX + 1) })] } })
    expect(spec).toEqual({ ok: false, errors: [`art.shapes[0].label: at most ${ART_LABEL_MAX} characters`] })
  })
})
