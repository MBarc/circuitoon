// Regression test for the built-in power modules (scripts/gen-power.mjs), the rocker switch and
// the passive buzzer: every pad must sit in the physical order transcribed from the sources in each
// module's `source` (vendor photos with legible silkscreen, cross-checked against a second source).
// A wrong pad is worse than a missing part, so a change here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { isSpacer, layoutModule, type Side } from './module.ts'
import { load, pinsOf, pin, withoutUsb } from './builtinModules.testing.ts'


// Each side lists its slots in array order; null is a spacer (a physical gap between pads).
type Want = { sides: Partial<Record<Side, (string | null)[]>>; internal: string[][] }
const power: Record<string, Want> = {
  // Component side, USB-C at the right: battery pads on the left edge, K and 5V out on the bottom.
  'ip5306-usbc-module.json': {
    sides: { left: ['B-', null, 'B+'], bottom: ['K', null, null, null, null, '5V+', null, '5V-'] },
    internal: [['B-', '5V-']],
  },
  // Component side, USB-C at the left: IN+ on the LED edge; OUT+, B+, B-, OUT- down the far end.
  'tp4056-module.json': {
    sides: { left: ['IN+', null, null, null, null, null, 'IN-'], right: ['OUT+', null, 'B+', null, 'B-', null, 'OUT-'] },
    internal: [['IN-', 'OUT-'], ['B+', 'OUT+']],
  },
  // Regulator side, header at the bottom: straight below the SOT-223's GND, OUT, VIN legs.
  'ams1117-33-module.json': { sides: { bottom: ['GND', 'OUT', 'VIN'] }, internal: [] },
  // Component side, LM2596 at the left: inputs at the left corners, outputs at the right.
  'lm2596-buck-module.json': {
    sides: { left: ['IN+', null, null, null, null, null, 'IN-'], right: ['OUT+', null, null, null, null, null, 'OUT-'] },
    internal: [['IN-', 'OUT-']],
  },
  // Component side as in Pololu's pinout diagram, ENABLE end at the left: the five 0.1 in holes below
  // the top-left mounting hole, the four at the far end above the bottom-right one.
  'pololu-u3v70f5-boost.json': {
    sides: { left: [null, 'ENABLE', 'GND', 'GND 2', 'VIN', 'VIN 2'], right: ['GND 3', 'GND 4', 'VOUT', 'VOUT 2', null, null] },
    internal: [['GND', 'GND 2', 'GND 3', 'GND 4'], ['VIN', 'VIN 2'], ['VOUT', 'VOUT 2']],
  },
}

describe('built-in power modules keep the physical pad order', () => {
  for (const [file, want] of Object.entries(power)) {
    const m = withoutUsb(load(file))
    it(`${file}: every side matches the source, slot for slot, on pitch`, () => {
      expect(m.category).toBe('Power')
      expect(m.source).toMatch(/^https:\/\/\S+ https:\/\//)
      expect(m.art?.pinLabels).toBe('inside')
      expect([...new Set(m.pins.map((p) => p.side))].sort()).toEqual(Object.keys(want.sides).sort())
      for (const [side, slots] of Object.entries(want.sides)) {
        const got = m.pins.filter((p) => p.side === side).map((p) => (isSpacer(p) ? null : p.name))
        expect(got).toEqual(slots)
      }
      const lay = layoutModule(m)
      for (const side of Object.keys(want.sides)) {
        const at = lay.pins.filter((p) => p.side === side).map((p) => (side === 'top' || side === 'bottom' ? p.edge.x : p.edge.y))
        for (const v of at) expect(v % 10).toBe(0)
      }
    })
    it(`${file}: nets joined on the board are internal, nothing else`, () => {
      const norm = (g: string[][]) => g.map((x) => [...x].sort()).sort()
      expect(norm(m.internal ?? [])).toEqual(norm(want.internal))
    })
  }

  it('types the rails: battery-side pins are the 3.7 V cell, the adjustable output is ADJ, inputs list what they accept, grounds are ground', () => {
    const ip = load('ip5306-usbc-module.json')
    expect(pin(ip, 'B+')).toMatchObject({ type: 'power_in', supply: '3.7V' })
    expect(pin(ip, '5V+')).toMatchObject({ type: 'power_out', supply: '5V' })
    expect(pin(ip, 'K')).toMatchObject({ type: 'input' })
    const tp = load('tp4056-module.json')
    expect(pin(tp, 'IN+')).toMatchObject({ type: 'power_in', supply: '5V' })
    expect(pin(tp, 'B+')).toMatchObject({ type: 'power_in', supply: '3.7V' })
    expect(pin(tp, 'OUT+')).toMatchObject({ type: 'power_out', supply: '3.7V' })
    const ams = load('ams1117-33-module.json')
    expect(pin(ams, 'OUT')).toMatchObject({ type: 'power_out', supply: '3V3' })
    expect(pin(ams, 'VIN')?.supply?.split('/')).toContain('5V')
    const lm = load('lm2596-buck-module.json')
    expect(pin(lm, 'OUT+')).toMatchObject({ type: 'power_out', supply: 'ADJ' })
    expect(pin(lm, 'IN+')?.supply?.split('/')).toContain('7.4V')
    for (const m of [ip, tp, ams, lm]) for (const p of pinsOf(m)) if (/-$|^GND$/.test(p.name)) expect(p.type).toBe('ground')
  })

  it('the U3V70F5 takes a 1S cell on VIN and gives 5 V on VOUT, with ENABLE an input and every GND labelled GND', () => {
    const u = load('pololu-u3v70f5-boost.json')
    expect(pin(u, 'VIN')).toMatchObject({ type: 'power_in', supply: '3V3/3.7V/5V' })
    expect(pin(u, 'VOUT 2')).toMatchObject({ type: 'power_out', supply: '5V', label: 'VOUT' })
    expect(pin(u, 'ENABLE')).toMatchObject({ type: 'input' })
    for (const n of ['GND', 'GND 2', 'GND 3', 'GND 4']) expect(pin(u, n)?.type).toBe('ground')
    expect(pin(u, 'GND 3')?.label).toBe('GND')
  })

  it('the LM2596 output voltage is its editable value', () => {
    expect(load('lm2596-buck-module.json').electrical).toMatchObject({ params: { voltage: { unit: 'V', default: 5 } } })
  })
})

describe('rocker switch and passive buzzer', () => {
  it('KCD1-101 is a two-terminal switch with pins 1 and 2', () => {
    const m = load('rocker-switch-kcd1.json')
    expect(m.category).toBe('Switches')
    expect(pinsOf(m).map((p) => [p.name, p.side, p.type])).toEqual([['1', 'left', 'passive'], ['2', 'right', 'passive']])
    expect(m.electrical).toMatchObject({ model: 'switch', terminals: { a: '1', b: '2' } })
  })

  it('the 12 mm passive buzzer is polarized with + on the left, - on the right, both labeled', () => {
    const m = load('buzzer-12mm-passive.json')
    expect(m.category).toBe('Indicators')
    expect(m.name).toBe('Passive buzzer 12 mm')
    expect(pinsOf(m).map((p) => [p.name, p.label, p.side])).toEqual([['+', '+', 'left'], ['-', '-', 'right']])
  })
})
