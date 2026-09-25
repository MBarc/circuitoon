// Regression test for the built-in power modules (scripts/gen-power.mjs), the rocker switch and
// the passive buzzer: every pad must sit in the physical order transcribed from the sources in each
// module's `source` (vendor photos with legible silkscreen, cross-checked against a second source).
// A wrong pad is worse than a missing part, so a change here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSpacer, layoutModule, validateModule, type ModuleDef, type PinDef, type Side } from './module.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (file: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (!r.ok) throw new Error(`${file}: ${r.errors.join('; ')}`)
  return r.module
}
const pinsOf = (m: ModuleDef): PinDef[] => m.pins.filter((p): p is PinDef => !isSpacer(p))
const pin = (m: ModuleDef, name: string) => pinsOf(m).find((p) => p.name === name)

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
}

describe('built-in power modules keep the physical pad order', () => {
  for (const [file, want] of Object.entries(power)) {
    const m = load(file)
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

  it('types the rails: battery in is VBAT, outputs name their rail, grounds are ground', () => {
    const ip = load('ip5306-usbc-module.json')
    expect(pin(ip, 'B+')).toMatchObject({ type: 'power_in', supply: 'VBAT' })
    expect(pin(ip, '5V+')).toMatchObject({ type: 'power_out', supply: '5V' })
    expect(pin(ip, 'K')).toMatchObject({ type: 'input' })
    const tp = load('tp4056-module.json')
    expect(pin(tp, 'IN+')).toMatchObject({ type: 'power_in', supply: '5V' })
    expect(pin(tp, 'B+')).toMatchObject({ type: 'power_in', supply: 'VBAT' })
    expect(pin(tp, 'OUT+')).toMatchObject({ type: 'power_out', supply: 'VBAT' })
    const ams = load('ams1117-33-module.json')
    expect(pin(ams, 'OUT')).toMatchObject({ type: 'power_out', supply: '3V3' })
    expect(pin(ams, 'VIN')?.supply?.split('/')).toContain('5V')
    const lm = load('lm2596-buck-module.json')
    expect(pin(lm, 'OUT+')).toMatchObject({ type: 'power_out' })
    for (const m of [ip, tp, ams, lm]) for (const p of pinsOf(m)) if (/-$|^GND$/.test(p.name)) expect(p.type).toBe('ground')
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
