import { describe, expect, it } from 'vitest'
import { layoutModule, validateModule, type ModuleDef } from './module.ts'

const base = { format: 'circuitoon-module/1', id: 'thing', name: 'Thing' }

describe('validateModule', () => {
  it('accepts a minimal module', () => {
    expect(validateModule({ ...base, pins: [{ name: 'A', side: 'left' }] }).ok).toBe(true)
  })
  it('rejects a missing format instead of guessing', () => {
    const r = validateModule({ id: 'thing', name: 'Thing', pins: [{ name: 'A', side: 'left' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/^format: missing/)
  })
  it('names the path of each problem', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }, { name: 'A', side: 'middle' }, { spacer: true, side: 'top', name: 'X' }],
      internal: [['A', 'B']],
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'pins[1].side: must be top, bottom, left or right',
        'pins[1].name: duplicate pin name "A"',
        'pins[2]: a spacer takes no name',
        'internal[0][1]: no pin named "B"',
      ])
  })
  it('accepts a string source and rejects any other type', () => {
    const pins = [{ name: 'A', side: 'left' }]
    expect(validateModule({ ...base, pins, source: 'https://example.com/a https://example.com/b' }).ok).toBe(true)
    const r = validateModule({ ...base, pins, source: ['https://example.com/a'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['source: must be a string (one or more URLs)'])
  })
  it('rejects an object-valued pin label', () => {
    const r = validateModule({ ...base, pins: [{ name: 'A', side: 'left', label: { x: 1 } }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['pins[0].label: must be a string'])
  })
  it('rejects an object-valued shape label', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 40, h: 30, shapes: [{ type: 'rect', x: 0, y: 0, w: 40, h: 30, fill: '#fff', label: { t: 'x' } }] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['art.shapes[0].label: must be a string'])
  })
  it('checks the other optional fields rendering reads', () => {
    const r = validateModule({
      ...base,
      category: 7,
      pins: [{ name: 'A', side: 'left', supply: 5 }],
      size: { w: 0, h: 3 },
      art: {
        w: -1, h: 30,
        shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', radius: '2', outline: 'yes', labelColor: 1, labelSize: 0 }],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'category: must be a string',
        'pins[0].supply: must be a string',
        'size: must be { "w": <units>, "h": <units> } with positive numbers',
        'art: must be { "w", "h", "shapes": [...] } with positive w and h',
      ])
    const r2 = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', radius: '2', outline: 'yes', labelColor: 1, labelSize: 0 }] },
    })
    if (!r2.ok)
      expect(r2.errors).toEqual([
        'art.shapes[0].radius: must be a number',
        'art.shapes[0].outline: must be true or false',
        'art.shapes[0].labelColor: must be a string',
        'art.shapes[0].labelSize: must be a positive number',
      ])
    expect(r2.ok).toBe(false)
  })
  it('accepts a shape band from 1 to 4', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 4 }] },
    })
    expect(r.ok).toBe(true)
  })
  it('rejects a shape band outside 1 to 4 or non-integer', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 5 }] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['art.shapes[0].band: must be a whole number from 1 to 4'])
    const r2 = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 1.5 }] },
    })
    expect(r2.ok).toBe(false)
  })
})

describe('layoutModule', () => {
  const m = (pins: ModuleDef['pins'], extra: Partial<ModuleDef> = {}) =>
    ({ ...base, pins, ...extra }) as ModuleDef

  it('grows the body to fit pins plus corner margin, on the 10 px grid', () => {
    const lay = layoutModule(m(Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, side: 'top' as const }))))
    expect(lay.w).toBe(80)
    expect(lay.pins.map((p) => p.edge.x)).toEqual([20, 30, 40, 50, 60, 70])
  })
  it('keeps array order: top to bottom on the left side', () => {
    const lay = layoutModule(m([{ name: 'A', side: 'left' }, { name: 'B', side: 'left' }]))
    expect(lay.pins.map((p) => [p.name, p.edge.y])).toEqual([['A', 20], ['B', 30]])
  })
  it('spacers take a slot but make no pin', () => {
    const lay = layoutModule(m([{ name: '+', side: 'top' }, { spacer: true, side: 'top' }, { name: '-', side: 'top' }]))
    expect(lay.pins.map((p) => p.edge.x)).toEqual([20, 40])
  })
  it('pin stubs point outward', () => {
    const lay = layoutModule(m([{ name: 'A', side: 'right' }]))
    expect(lay.pins[0].end).toEqual({ x: lay.w + 8, y: lay.pins[0].edge.y })
  })
  it('art can make the body bigger than the pins need', () => {
    expect(layoutModule(m([{ name: 'A', side: 'left' }], { art: { w: 120, h: 90, shapes: [] } }))).toMatchObject({ w: 120, h: 90 })
  })
})
