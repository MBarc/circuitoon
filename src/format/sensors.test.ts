// Regression test for the built-in addressable LEDs and sensor modules (scripts/gen-sensors.mjs):
// every pin must sit in the physical order transcribed from the sources in each module's `source`
// (datasheets, vendor photos with legible silkscreen, cross-checked against a second source).
// A wrong pin is worse than a missing part, so a change here must be re-checked against the source.
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

type Want = { category: string; sides: Partial<Record<Side, string[]>>; internal: string[][] }
const parts: Record<string, Want> = {
  // LED side, data arrows pointing right: input pads at the left, output pads at the right.
  'ws2812b-strip.json': {
    category: 'Indicators', sides: { left: ['GND', 'DIN', '5V'], right: ['GND 2', 'DOUT', '5V 2'] },
    internal: [['GND', 'GND 2'], ['5V', '5V 2']],
  },
  // WS2812D-F5 datasheet front elevation: legs 4, 3, 2, 1 left to right (flat side at pin 1).
  'ws2812b-5mm.json': { category: 'Indicators', sides: { bottom: ['DIN', 'GND', 'VDD', 'DOUT'] }, internal: [] },
  // Grille side, header at the bottom: silkscreen "+ out -".
  'dht22-module.json': { category: 'Sensors', sides: { bottom: ['+', 'out', '-'] }, internal: [] },
  // Aosong datasheet: pins 1 to 4 left to right from the grille side.
  'dht22-bare.json': { category: 'Sensors', sides: { bottom: ['VCC', 'DATA', 'NC', 'GND'] }, internal: [] },
  // Sensor side, header at the bottom.
  'bme280-i2c-module.json': { category: 'Sensors', sides: { bottom: ['VIN', 'GND', 'SCL', 'SDA'] }, internal: [] },
  'bme280-module-6pin.json': { category: 'Sensors', sides: { bottom: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'] }, internal: [] },
  // Dome side, header at the bottom (the pot side reads VCC OUT GND).
  'pir-hc-sr501.json': { category: 'Sensors', sides: { bottom: ['GND', 'OUT', 'VCC'] }, internal: [] },
  // Transducer side, header at the bottom.
  'ultrasonic-hc-sr04.json': { category: 'Sensors', sides: { bottom: ['VCC', 'Trig', 'Echo', 'GND'] }, internal: [] },
}

describe('built-in addressable LEDs and sensors keep the physical pin order', () => {
  for (const [file, want] of Object.entries(parts)) {
    const m = load(file)
    it(`${file}: every side matches the source, in order, on pitch`, () => {
      expect(m.category).toBe(want.category)
      expect(m.source).toMatch(/^https?:\/\/\S+ https?:\/\//)
      expect(m.art?.pinLabels).toBe('inside')
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

  it('the strip output pads show the silkscreen text', () => {
    const m = load('ws2812b-strip.json')
    expect(pin(m, 'GND 2')?.label).toBe('GND')
    expect(pin(m, '5V 2')?.label).toBe('5V')
  })

  it('types the rails and signals', () => {
    const strip = load('ws2812b-strip.json')
    expect(pin(strip, 'DIN')?.type).toBe('input')
    expect(pin(strip, 'DOUT')?.type).toBe('output')
    const led = load('ws2812b-5mm.json')
    expect(pin(led, 'VDD')).toMatchObject({ type: 'power_in', supply: '5V' })
    expect(pin(led, 'DIN')?.type).toBe('input')
    expect(pin(led, 'DOUT')?.type).toBe('output')
    expect(pin(load('dht22-bare.json'), 'NC')?.type).toBe('nc')
    expect(pin(load('dht22-module.json'), '+')).toMatchObject({ type: 'power_in', label: 'VCC' })
    expect(pin(load('dht22-module.json'), '-')).toMatchObject({ type: 'ground', label: 'GND' })
    // The 6-pin GY-BME280 has no regulator; the 4-pin board does.
    expect(pin(load('bme280-module-6pin.json'), 'VCC')?.supply).toBe('3V3')
    expect(pin(load('bme280-i2c-module.json'), 'VIN')?.supply?.split('/')).toContain('5V')
    expect(pin(load('pir-hc-sr501.json'), 'OUT')?.type).toBe('output')
    expect(pin(load('ultrasonic-hc-sr04.json'), 'Trig')?.type).toBe('input')
    expect(pin(load('ultrasonic-hc-sr04.json'), 'Echo')?.type).toBe('output')
    for (const file of Object.keys(parts))
      for (const p of pinsOf(load(file))) if ((p.label ?? p.name) === 'GND') expect(p.type).toBe('ground')
  })
})
