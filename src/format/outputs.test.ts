// Regression test for the built-in relay, servo, motor driver, radio and level shifter modules
// (scripts/gen-outputs.mjs): every pin must sit in the physical order transcribed from the sources
// in each module's `source` (maker pages, datasheets, vendor photos with legible silkscreen,
// cross-checked against a second source). A wrong pin is worse than a missing part, so a change
// here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { isSpacer, layoutModule, type Side } from './module.ts'
import { load, pinsOf, pin } from './builtinModules.testing.ts'


type Want = { category: string; sides: Partial<Record<Side, (string | null)[]>>; internal: string[][]; inside: boolean }
const parts: Record<string, Want> = {
  // Relay text readable, "high/low level trigger" edge at the bottom: output terminal left, input right.
  'relay-module-1ch-5v.json': {
    category: 'Motors and actuators', inside: true, internal: [],
    sides: { left: ['NO', null, 'COM', null, 'NC'], right: ['IN', null, 'DC-', null, 'DC+'] },
  },
  // Lead order in the JR connector: brown, red, orange.
  'servo-sg90.json': { category: 'Motors and actuators', inside: true, internal: [], sides: { left: ['GND', 'VCC', 'PWM'] } },
  // Heatsink at the top; OUT4 sits above OUT3 on the right-hand terminal.
  'l298n-module.json': {
    category: 'Motors and actuators', inside: true, internal: [],
    sides: {
      left: [null, null, 'OUT1', null, 'OUT2'],
      right: [null, null, 'OUT4', null, 'OUT3'],
      bottom: ['+12V', null, 'GND', null, '+5V', null, 'ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'],
    },
  },
  // Adafruit's component-side photos: G1..G5 and the ANT pad on top, the main header at the bottom.
  'rfm95-lora-breakout.json': {
    category: 'Communication', inside: true, internal: [],
    sides: {
      top: ['G1', 'G2', 'G3', 'G4', 'G5', null, null, 'ANT', null],
      bottom: ['VIN', 'GND', 'EN', 'G0', 'SCK', 'MISO', 'MOSI', 'CS', 'RST'],
    },
  },
  // SparkFun BOB-12009 layout: high-voltage row on top.
  'level-shifter-bss138-4ch.json': {
    category: 'Communication', inside: true, internal: [['GND', 'GND 2']],
    sides: { top: ['HV1', 'HV2', 'HV', 'GND', 'HV3', 'HV4'], bottom: ['LV1', 'LV2', 'LV', 'GND 2', 'LV3', 'LV4'] },
  },
}

describe('built-in relay, servo, motor driver, radio and level shifter keep the physical pin order', () => {
  for (const [file, want] of Object.entries(parts)) {
    const m = load(file)
    it(`${file}: every side matches the source, in order, on pitch`, () => {
      expect(m.category).toBe(want.category)
      expect(m.source).toMatch(/^https?:\/\/\S+ https?:\/\//)
      expect(m.art?.pinLabels === 'inside').toBe(want.inside)
      expect([...new Set(m.pins.map((p) => p.side))].sort()).toEqual(Object.keys(want.sides).sort())
      for (const [side, names] of Object.entries(want.sides)) {
        expect(m.pins.filter((p) => p.side === side).map((p) => (isSpacer(p) ? null : p.name))).toEqual(names)
      }
      const lay = layoutModule(m)
      for (const p of lay.pins) expect((p.side === 'top' || p.side === 'bottom' ? p.edge.x : p.edge.y) % 10).toBe(0)
    })
    it(`${file}: nets joined on the part are internal, nothing else`, () => {
      const norm = (g: string[][]) => g.map((x) => [...x].sort()).sort()
      expect(norm(m.internal ?? [])).toEqual(norm(want.internal))
    })
  }

  it('the RFM95W G1 sits above VIN and the level shifter rows face each other', () => {
    const lay = layoutModule(load('rfm95-lora-breakout.json'))
    const at = (n: string) => lay.pins.find((p) => p.name === n)!.edge.x
    expect(at('G1')).toBe(at('VIN'))
    const ls = layoutModule(load('level-shifter-bss138-4ch.json'))
    const x = (n: string) => ls.pins.find((p) => p.name === n)!.edge.x
    for (const [h, l] of [['HV1', 'LV1'], ['HV', 'LV'], ['GND', 'GND 2'], ['HV4', 'LV4']]) expect(x(h)).toBe(x(l))
  })

  it('types the rails and signals', () => {
    const relay = load('relay-module-1ch-5v.json')
    expect(pin(relay, 'DC+')).toMatchObject({ type: 'power_in', supply: '5V' })
    expect(pin(relay, 'DC-')?.type).toBe('ground')
    expect(pin(relay, 'IN')?.type).toBe('input')
    for (const n of ['NO', 'COM', 'NC']) expect(pin(relay, n)?.type).toBe('passive')
    const servo = load('servo-sg90.json')
    expect(pin(servo, 'VCC')).toMatchObject({ type: 'power_in', supply: '5V' })
    expect(pin(servo, 'PWM')?.type).toBe('input')
    const l298n = load('l298n-module.json')
    for (const n of ['OUT1', 'OUT2', 'OUT3', 'OUT4']) expect(pin(l298n, n)?.type).toBe('output')
    for (const n of ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']) expect(pin(l298n, n)?.type).toBe('input')
    expect(pin(l298n, '+12V')?.type).toBe('power_in')
    const rfm = load('rfm95-lora-breakout.json')
    expect(pin(rfm, 'VIN')?.supply?.split('/')).toEqual(['3V3', '5V'])
    expect(pin(rfm, 'MISO')?.type).toBe('output')
    const ls = load('level-shifter-bss138-4ch.json')
    expect(pin(ls, 'GND 2')?.label).toBe('GND')
    expect(pin(ls, 'HV')?.type).toBe('power_in')
    expect(pin(ls, 'LV')?.type).toBe('power_in')
    for (const file of Object.keys(parts))
      for (const p of pinsOf(load(file))) {
        if ((p.label ?? p.name) === 'GND') expect(p.type).toBe('ground')
        if (p.type === 'power_in' || p.type === 'power_out') expect(p.supply).toBeTruthy()
      }
  })
})
