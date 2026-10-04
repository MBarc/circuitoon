import { describe, expect, it } from 'vitest'
import { CABLE_PRESETS, END_KINDS, END_SIZE, endKind, endPlacement, isEndKind, normalizeEnds, presetEnds, presetOf, sharedCable, swapEnds } from './cables.ts'

describe('end kinds and presets', () => {
  it('knows every end kind, bare first', () => {
    expect(END_KINDS[0]).toBe('bare')
    expect(END_KINDS).toContain('jst-sh')
    expect(isEndKind('dupont-male')).toBe(true)
    expect(isEndKind('dupont')).toBe(false)
    expect(isEndKind(3)).toBe(false)
    expect(isEndKind('toString')).toBe(false)
  })
  it('lists the presets in the order the brief gives, Wire first', () => {
    expect(CABLE_PRESETS.map((p) => p.name)).toEqual([
      'Wire', 'Dupont M-M', 'Dupont M-F', 'Dupont F-F', 'Solid-core jumper', 'Alligator leads', 'Alligator to Dupont M',
      'Stripped hookup wire', 'Ferrules', 'JST-XH lead', 'JST-PH lead', 'Qwiic / STEMMA QT end (per wire)', 'Grove end (per wire)', 'Banana leads',
      'USB A to micro-B cable', 'USB A to mini-B cable', 'USB A to B cable', 'USB A to C cable', 'USB C to C cable', 'USB C to micro-B cable',
    ])
    expect(new Set(CABLE_PRESETS.map((p) => p.id)).size).toBe(CABLE_PRESETS.length)
  })
  it('reads a missing end as bare', () => {
    expect(endKind(undefined, 'from')).toBe('bare')
    expect(endKind({ to: 'alligator' }, 'from')).toBe('bare')
    expect(endKind({ to: 'alligator' }, 'to')).toBe('alligator')
  })
  it('normalizes: bare ends are left out, and no ends at all is undefined', () => {
    expect(normalizeEnds({ from: 'bare', to: 'bare' })).toBeUndefined()
    expect(normalizeEnds({})).toBeUndefined()
    expect(normalizeEnds(undefined)).toBeUndefined()
    expect(normalizeEnds({ from: 'bare', to: 'jst-ph' })).toEqual({ to: 'jst-ph' })
    expect(normalizeEnds({ from: 'dupont-male', to: 'dupont-female' })).toEqual({ from: 'dupont-male', to: 'dupont-female' })
  })
  it('finds the preset a wire matches, either way round, or null for a custom pair', () => {
    expect(presetOf(undefined)?.id).toBe('wire')
    expect(presetOf({ from: 'dupont-male', to: 'dupont-male' })?.id).toBe('dupont-mm')
    expect(presetOf({ from: 'dupont-female', to: 'dupont-male' })?.id).toBe('dupont-mf')
    expect(presetOf({ from: 'dupont-male', to: 'alligator' })?.id).toBe('alligator-dupont')
    expect(presetOf({ from: 'banana', to: 'jst-xh' })).toBeNull()
    expect(presetOf({ to: 'dupont-male' })).toBeNull()
  })
  it('gives a preset as normalized ends', () => {
    expect(presetEnds('wire')).toBeUndefined()
    expect(presetEnds('dupont-mf')).toEqual({ from: 'dupont-male', to: 'dupont-female' })
    expect(presetEnds('nope')).toBeUndefined()
  })
  it('reads several wires as one preset, one Custom pair, or Mixed', () => {
    expect(sharedCable([undefined, { from: 'bare' }])).toBe('wire')
    expect(sharedCable([{ from: 'dupont-male', to: 'dupont-female' }, { from: 'dupont-female', to: 'dupont-male' }])).toBe('dupont-mf')
    expect(sharedCable([{ from: 'banana', to: 'jst-xh' }, { from: 'jst-xh', to: 'banana' }])).toBe('custom')
    expect(sharedCable([{ from: 'banana', to: 'jst-xh' }, { from: 'banana', to: 'jst-ph' }])).toBe('mixed')
    expect(sharedCable([{ from: 'banana', to: 'jst-xh' }, undefined])).toBe('mixed')
    expect(sharedCable([])).toBe('mixed')
  })
  it('swaps ends', () => {
    expect(swapEnds({ from: 'alligator', to: 'dupont-male' })).toEqual({ from: 'dupont-male', to: 'alligator' })
    expect(swapEnds({ to: 'banana' })).toEqual({ from: 'banana' })
    expect(swapEnds(undefined)).toBeUndefined()
  })
  it('sizes every end kind, bare taking no room', () => {
    for (const k of END_KINDS) {
      expect(END_SIZE[k].trim).toBeLessThanOrEqual(END_SIZE[k].reach)
      if (k !== 'bare') expect(END_SIZE[k].reach).toBeGreaterThan(0)
    }
    expect(END_SIZE.bare).toEqual({ reach: 0, trim: 0, exposed: false })
  })
})

describe('endPlacement', () => {
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]
  it('puts the from end on the first segment, facing back along it', () => {
    expect(endPlacement(L, 'from', 20)).toEqual({ at: { x: 0, y: 0 }, back: { x: 1, y: 0 }, angle: 0, scale: 1, room: 100 })
  })
  it('puts the to end on the last segment, facing back along it', () => {
    expect(endPlacement(L, 'to', 20)).toEqual({ at: { x: 100, y: 50 }, back: { x: 0, y: -1 }, angle: 270, scale: 1, room: 50 })
  })
  it('orients correctly for all four directions', () => {
    const at = { x: 50, y: 50 }
    const cases: [{ x: number; y: number }, { x: number; y: number }, number][] = [
      [{ x: 90, y: 50 }, { x: 1, y: 0 }, 0],
      [{ x: 50, y: 90 }, { x: 0, y: 1 }, 90],
      [{ x: 10, y: 50 }, { x: -1, y: 0 }, 180],
      [{ x: 50, y: 10 }, { x: 0, y: -1 }, 270],
    ]
    for (const [next, back, angle] of cases) {
      const p = endPlacement([at, next, { x: 200, y: 200 }], 'from', 20)!
      expect(p.back).toEqual(back)
      expect(p.angle).toBe(angle)
    }
  })
  it('squashes a connector on a short end segment, down to 60 percent, never less', () => {
    const short = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 40 }]
    expect(endPlacement(short, 'from', 20)!.scale).toBeCloseTo(0.75)
    const tiny = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 40 }]
    expect(endPlacement(tiny, 'from', 20)!.scale).toBe(0.6)
  })
  it('shares a single straight segment between both ends, in proportion to their reach', () => {
    const line = [{ x: 0, y: 0 }, { x: 30, y: 0 }]
    expect(endPlacement(line, 'from', 20, 20)).toMatchObject({ scale: 0.75, room: 15 })
    expect(endPlacement(line, 'to', 20, 20)).toMatchObject({ at: { x: 30, y: 0 }, back: { x: -1, y: 0 }, angle: 180 })
    // A bare far end reserves nothing: a 29 px alligator fits a 44 px straight wire whole.
    expect(endPlacement([{ x: 0, y: 0 }, { x: 44, y: 0 }], 'from', 29, 0)).toMatchObject({ scale: 1, room: 44 })
    // Unequal pairs split the run by reach: a banana (28) and a JST-SH (8) on 30 px squash alike.
    const banana = endPlacement(line, 'from', 28, 8)!
    const sh = endPlacement(line, 'to', 8, 28)!
    expect(banana.room + sh.room).toBeCloseTo(30)
    expect(banana.scale).toBeCloseTo(sh.scale)
    // With room for both, both are whole.
    expect(endPlacement([{ x: 0, y: 0 }, { x: 40, y: 0 }], 'from', 28, 8)!.scale).toBe(1)
    expect(endPlacement([{ x: 0, y: 0 }, { x: 40, y: 0 }], 'to', 8, 28)!.scale).toBe(1)
  })
  it('skips repeated points to find the segment the end sits on', () => {
    const p = endPlacement([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 40 }], 'from', 20)!
    expect(p.back).toEqual({ x: 0, y: 1 })
  })
  it('is null for a polyline with no length, or a diagonal end', () => {
    expect(endPlacement([{ x: 0, y: 0 }], 'from', 20)).toBeNull()
    expect(endPlacement([{ x: 0, y: 0 }, { x: 0, y: 0 }], 'to', 20)).toBeNull()
    expect(endPlacement([{ x: 0, y: 0 }, { x: 10, y: 10 }], 'to', 20)).toBeNull()
  })
})
