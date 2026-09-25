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
