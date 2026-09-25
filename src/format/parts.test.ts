// Regression test for the built-in chips and display modules: every pin must sit in the real
// physical order transcribed from the source in each module's `source` (Microchip datasheets for
// the chips, the module maker's pinout and board photos for the displays). A wrong pin is worse
// than a missing part, so a change here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSpacer, layoutModule, validateModule, type ModuleDef, type Side } from './module.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (file: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (!r.ok) throw new Error(`${file}: ${r.errors.join('; ')}`)
  return r.module
}

/** Datasheet pin 1 to 28 of a DIP-28, as names; returns the Circuitoon sides for a top view with
 * pin 1 at top left: left is pins 1 to 14 top to bottom, right is pins 28 down to 15. */
function dip28(byNumber: string[]): { left: string[]; right: string[] } {
  expect(byNumber).toHaveLength(28)
  return { left: byNumber.slice(0, 14), right: byNumber.slice(14).reverse() }
}

// MCP23017 DS20001952D Table 2-1, SPDIP column.
const mcp23017 = [
  'GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC',
  'A0', 'A1', 'A2', 'RESET', 'INTB', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7',
]
// MCP23018 DS20002103B Table 1-1, 28L PDIP/SOIC column (NC on 2, 14, 17, 28).
const mcp23018 = [
  'VSS', 'NC', 'GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'SCL', 'SDA', 'NC',
  'ADDR', 'RESET', 'NC', 'INTB', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7', 'NC',
]

// lcdwiki "Interface Definition" order, silkscreen text; header at the left seen from the screen side.
const tft14 = (dc: string) => ['VCC', 'GND', 'CS', 'RESET', dc, 'SDI(MOSI)', 'SCK', 'LED', 'SDO(MISO)', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ']
const sd4 = ['SD_CS', 'SD_MOSI', 'SD_MISO', 'SD_SCK']

type Want = { category: string; sides: Partial<Record<Side, string[]>> }
const parts: Record<string, Want> = {
  'mcp23017-dip28.json': { category: 'Chips', sides: dip28(mcp23017) },
  'mcp23018-dip28.json': { category: 'Chips', sides: dip28(mcp23018) },
  'lcd-st7796s-4in-spi-touch.json': { category: 'Displays', sides: { left: tft14('DC/RS'), right: sd4 } },
  'tft-ili9341-28-spi-touch.json': { category: 'Displays', sides: { left: tft14('DC'), right: sd4 } },
  'tft-ili9341-24-spi.json': { category: 'Displays', sides: { left: tft14('DC'), right: sd4 } },
  'tft-st7735-18-spi.json': { category: 'Displays', sides: { left: ['VCC', 'GND', 'CS', 'RESET', 'A0', 'SDA', 'SCK', 'LED'], right: sd4 } },
  'tft-st7789-154-spi.json': { category: 'Displays', sides: { top: ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BLK'] } },
  'oled-ssd1306-096-i2c.json': { category: 'Displays', sides: { top: ['GND', 'VCC', 'SCL', 'SDA'] } },
  'oled-ssd1306-096-i2c-vcc-gnd.json': { category: 'Displays', sides: { top: ['VCC', 'GND', 'SCL', 'SDA'] } },
  'oled-sh1106-13-i2c.json': { category: 'Displays', sides: { top: ['GND', 'VCC', 'SCL', 'SDA'] } },
  'oled-sh1106-13-i2c-vcc-gnd.json': { category: 'Displays', sides: { top: ['VCC', 'GND', 'SCL', 'SDA'] } },
  // Header on the short left edge: GND is the square pad at the bottom.
  'oled-ssd1306-091-i2c.json': { category: 'Displays', sides: { left: ['SDA', 'SCL', 'VCC', 'GND'] } },
  // Socket side up, header at the left, top to bottom.
  'microsd-spi-3v3.json': { category: 'Communication', sides: { left: ['3V3', 'CS', 'MOSI', 'CLK', 'MISO', 'GND'] } },
  'microsd-spi-5v.json': { category: 'Communication', sides: { left: ['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS'] } },
}

/** Supply of the power input where it is not the usual '3V3/5V'. */
const supplies: Record<string, string> = {
  'tft-st7789-154-spi.json': '3V3',
  'microsd-spi-3v3.json': '3V3',
  'microsd-spi-5v.json': '5V',
}

describe('built-in chips and displays keep the physical pin order', () => {
  for (const [file, want] of Object.entries(parts)) {
    const m = load(file)
    it(`${file}: every side matches the source pinout, on pitch`, () => {
      expect(m.category).toBe(want.category)
      expect(m.source).toMatch(/^https:\/\//)
      expect(m.art?.pinLabels).toBe('inside')
      const lay = layoutModule(m)
      const used = new Set(lay.pins.map((p) => p.side))
      expect([...used].sort()).toEqual(Object.keys(want.sides).sort())
      for (const [side, names] of Object.entries(want.sides)) {
        const pins = lay.pins.filter((p) => p.side === side)
        expect(pins.map((p) => p.label ?? p.name)).toEqual(names)
        const along = (p: (typeof pins)[number]) => (side === 'top' || side === 'bottom' ? p.edge.x : p.edge.y)
        pins.forEach((p, i) => i && expect(along(p) - along(pins[i - 1])).toBe(10))
      }
    })
    it(`${file}: power pins are typed with a supply, grounds are joined`, () => {
      const pins = m.pins.filter((p) => !isSpacer(p))
      const grounds = pins.filter((p) => !isSpacer(p) && p.type === 'ground').map((p) => (isSpacer(p) ? '' : p.name))
      expect(grounds.length).toBeGreaterThan(0)
      if (grounds.length > 1) expect(m.internal?.some((g) => grounds.every((n) => g.includes(n)))).toBe(true)
      const power = pins.filter((p) => !isSpacer(p) && p.type === 'power_in')
      expect(power.length).toBeGreaterThan(0)
      // A 3.3 V only module lists 3V3, a 5 V only one 5V; one that takes either rail lists both.
      for (const p of power) if (!isSpacer(p)) expect(p.supply).toBe(supplies[file] ?? '3V3/5V')
    })
  }

  it('MCP23017 and MCP23018 differ where the datasheets say (ADDR instead of A0 to A2, VSS on pin 1)', () => {
    const a = load('mcp23017-dip28.json'), b = load('mcp23018-dip28.json')
    const names = (m: ModuleDef) => m.pins.flatMap((p) => (isSpacer(p) ? [] : [p.name]))
    expect(names(a)).toEqual(expect.arrayContaining(['A0', 'A1', 'A2']))
    expect(names(b)).toContain('ADDR')
    expect(names(b)).not.toContain('A0')
    // NC pins are typed nc so nothing suggests wiring them.
    for (const m of [a, b]) for (const p of m.pins) if (!isSpacer(p) && (p.label ?? p.name) === 'NC') expect(p.type).toBe('nc')
  })

  it('names the 2.4" TFT for both versions (T_ pins wired only on touch)', () => {
    expect(load('tft-ili9341-24-spi.json').name).toBe('2.4" TFT 240x320 ILI9341 (SPI; T_ pins on touch version)')
  })

  it('names the two microSD modules by supply, and only the 3.3 V one lacks a regulator', () => {
    expect(load('microsd-spi-3v3.json').name).toContain('3.3 V only')
    expect(load('microsd-spi-5v.json').name).toContain('5 V with level shifter')
    // MISO is the card's output on both.
    for (const f of ['microsd-spi-3v3.json', 'microsd-spi-5v.json'])
      expect(load(f).pins.find((p) => !isSpacer(p) && p.name === 'MISO')).toMatchObject({ type: 'output' })
  })

  it('displays use the display electrical model', () => {
    for (const file of Object.keys(parts).filter((f) => parts[f].category === 'Displays'))
      expect(load(file).electrical).toEqual({ model: 'display', params: {} })
  })
})
