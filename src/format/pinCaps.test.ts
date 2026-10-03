// The pin capabilities and I2C data the built-in parts carry, pinned per board, so a generator
// change cannot drop or move one (sources: the comments in scripts/lib/pin-caps.mjs,
// scripts/gen-boards.mjs, gen-parts.mjs and gen-sensors.mjs).
import { describe, expect, it } from 'vitest'
import { load, moduleFiles, pinsOf } from './builtinModules.testing.ts'
import { i2cOf, pinCaps } from './module.ts'

/** Each capped pin of a module as "NAME kind[,kind]" (strapping with its level). */
const capped = (id: string) => {
  const m = load(id)
  return [...pinsOf(m), ...(m.holes ?? [])].filter((p) => p.caps).map((p) => {
    const c = p.caps!
    const kinds = [c.inputOnly && 'inputOnly', c.outputOnly && 'outputOnly', c.flash && 'flash', c.noPullup && 'noPullup', c.strapping && `strap-${c.strapping}`].filter(Boolean)
    return `${p.name} ${kinds.join(',') || 'note'}`
  }).sort()
}

describe('pin capabilities of the built-in boards', () => {
  it('ESP32 DevKit V1: GPIO34-39 input only with no pulls, strapping D2 D5 D12 D15, no flash pins on the header', () => {
    expect(capped('esp32-devkit-v1-30')).toEqual([
      'D12 strap-low', 'D15 strap-either', 'D2 strap-low', 'D34 inputOnly,noPullup', 'D35 inputOnly,noPullup', 'D5 strap-either', 'VN inputOnly,noPullup', 'VP inputOnly,noPullup',
    ])
  })
  it('ESP32 DevKitC V4 and its terminal board: the flash pins (GPIO6-11), GPIO0 too', () => {
    expect(capped('esp32-devkitc-v4')).toEqual([
      'CLK flash', 'CMD flash', 'D0 flash', 'D1 flash', 'D2 flash', 'D3 flash',
      'IO0 strap-high', 'IO12 strap-low', 'IO15 strap-either', 'IO2 strap-low', 'IO34 inputOnly,noPullup', 'IO35 inputOnly,noPullup', 'IO5 strap-either',
      'VN inputOnly,noPullup', 'VP inputOnly,noPullup',
    ])
    expect(capped('esp32-terminal-board-38')).toEqual([
      'CLK flash', 'CMD flash', 'P0 strap-high', 'P12 strap-low', 'P15 strap-either', 'P2 strap-low', 'P34 inputOnly,noPullup', 'P35 inputOnly,noPullup', 'P5 strap-either',
      'SD0 flash', 'SD1 flash', 'SD2 flash', 'SD3 flash', 'SVN inputOnly,noPullup', 'SVP inputOnly,noPullup',
    ])
    expect(pinCaps(load('esp32-devkitc-v4'), 'D0')?.note).toBe('D0 is GPIO7, a line of the module\'s SPI flash.')
  })
  it('ESP32-CAM: the strapping pins it breaks out, and IO16 noted as the PSRAM chip select', () => {
    expect(capped('esp32-cam')).toEqual(['IO0 strap-high', 'IO12 strap-low', 'IO15 strap-either', 'IO16 note', 'IO2 strap-low'])
    expect(pinCaps(load('esp32-cam'), 'IO16')?.note).toMatch(/^IO16 is the chip select of the board's PSRAM/)
  })
  it('ESP32-S3: GPIO0, 3, 45, 46, and the octal-memory note on 35-37', () => {
    expect(capped('esp32-s3-devkitc-1')).toEqual(['0 strap-high', '3 strap-either', '35 note', '36 note', '37 note', '45 strap-low', '46 strap-low'])
    expect(capped('xiao-esp32s3')).toEqual(['D2 strap-either'])
    expect(pinCaps(load('xiao-esp32s3'), 'D2')?.note).toMatch(/^D2 is GPIO3\. /)
  })
  it('the download-only strapping pins say so: ESP32 GPIO2, S3 GPIO46, C3 GPIO8', () => {
    const only = (id: string) => pinsOf(load(id)).filter((p) => p.caps?.downloadOnly).map((p) => p.name)
    expect(only('esp32-devkitc-v4')).toEqual(['IO2'])
    expect(only('esp32-devkit-v1-30')).toEqual(['D2'])
    expect(only('esp32-s3-devkitc-1')).toEqual(['46'])
    expect(only('esp32-c3-supermini')).toEqual(['8'])
    expect(only('xiao-esp32c3')).toEqual(['D8'])
    for (const id of ['esp32-devkitc-v4', 'esp32-s3-devkitc-1', 'esp32-c3-supermini'])
      for (const p of pinsOf(load(id)).filter((x) => x.caps?.downloadOnly)) expect(p.caps!.note).toMatch(/a normal boot is unaffected\.$/)
  })
  it('ESP32-C3: GPIO2, 8 and 9 high at reset', () => {
    expect(capped('esp32-c3-supermini')).toEqual(['2 strap-high', '8 strap-high', '9 strap-high'])
    expect(capped('xiao-esp32c3')).toEqual(['D0 strap-high', 'D8 strap-high', 'D9 strap-high'])
  })
  it('Arduino Nano: A6 and A7 are analog inputs only', () => {
    expect(capped('arduino-nano')).toEqual(['A6 inputOnly,noPullup', 'A7 inputOnly,noPullup'])
  })
  it('MCP23017, chip and CJMCU-2317 breakout: GPA7 and GPB7 output only', () => {
    expect(capped('mcp23017-dip28')).toEqual(['GPA7 outputOnly', 'GPB7 outputOnly'])
    expect(capped('mcp23017-cjmcu-2317')).toEqual(['GPA7 outputOnly', 'GPB7 outputOnly'])
  })
  it('only the boards above carry caps (the Picos, the D1 mini and the rest claim nothing)', () => {
    const withCaps = moduleFiles().map((f) => f.replace('.json', '')).filter((id) => capped(id).length)
    expect(withCaps).toEqual(['arduino-nano', 'esp32-c3-supermini', 'esp32-cam', 'esp32-devkit-v1-30', 'esp32-devkitc-v4', 'esp32-s3-devkitc-1', 'esp32-terminal-board-38', 'mcp23017-cjmcu-2317', 'mcp23017-dip28', 'xiao-esp32c3', 'xiao-esp32s3'])
  })
})

describe('I2C data of the built-in parts', () => {
  it('declares address and pull-ups only where sourced', () => {
    const i2c = Object.fromEntries(moduleFiles().map((f) => load(f)).filter((m) => i2cOf(m)).map((m) => [m.id, i2cOf(m)]))
    expect(i2c).toEqual({
      'bme280-module-4pin': { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } },
      'bme280-module-6pin': { sda: 'SDA', scl: 'SCL', address: { base: 0x76, pins: [{ pin: 'SDO', add: 1, floating: 0 }] }, pullups: true },
      'mcp23017-cjmcu-2317': { sda: 'SDA', scl: 'SCL', address: { base: 0x20, pins: [{ pin: 'A0', add: 1 }, { pin: 'A1', add: 2 }, { pin: 'A2', add: 4 }] } },
      'mcp23017-dip28': { sda: 'SDA', scl: 'SCL', address: { base: 0x20, pins: [{ pin: 'A0', add: 1 }, { pin: 'A1', add: 2 }, { pin: 'A2', add: 4 }] }, pullups: false },
      'mcp23018-dip28': { sda: 'SDA', scl: 'SCL' },
      'oled-sh1106-13-i2c': { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } },
      'oled-sh1106-13-i2c-vcc-gnd': { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } },
      'oled-ssd1306-091-i2c': { sda: 'SDA', scl: 'SCL' },
      'oled-ssd1306-096-i2c': { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } },
      'oled-ssd1306-096-i2c-vcc-gnd': { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } },
    })
    expect((load('oled-ssd1306-096-i2c').electrical as { settings: unknown }).settings).toEqual({ address: ['0x3C', '0x3D'] })
    expect((load('bme280-module-4pin').electrical as { settings: unknown }).settings).toEqual({ address: ['0x76', '0x77'] })
  })
  it('never marks an SPI display as I2C, whatever its pins are called', () => {
    for (const id of ['tft-st7789-154-spi', 'tft-st7735-18-spi']) expect(i2cOf(load(id))).toBeNull()
  })
})
