// Firmware spec 5.1 and 7: the gate's static scan finds the same unsupported modules and gpiozero
// names the run-time refuses, read from the Python stand-ins themselves.
import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_GPIOZERO, UNSUPPORTED_MODULES, unsupportedImports } from './unsupported.ts'

describe('unsupported imports (spec 5.1)', () => {
  it('reads the lists from the Python files', () => {
    expect(Object.keys(UNSUPPORTED_MODULES).sort()).toEqual(['lgpio', 'picamera2', 'pigpio', 'serial', 'smbus', 'smbus2', 'spidev'])
    expect(UNSUPPORTED_GPIOZERO.MCP3008).toBe('needs SPI devices, coming in a later update')
  })
  it('finds them in import, from-import and attribute forms, once each', () => {
    const src = 'import smbus2 as bus, time\nfrom spidev import SpiDev\nfrom gpiozero import LED, MCP3008\nimport gpiozero\nx = gpiozero.MCP3202(0)\n# import pigpio (a comment)\n'
    expect(unsupportedImports(src)).toEqual([
      { name: 'smbus2', why: 'smbus2 needs I2C devices, coming in a later update' },
      { name: 'spidev', why: 'spidev needs SPI devices, coming in a later update' },
      { name: 'gpiozero.MCP3008', why: 'gpiozero.MCP3008 needs SPI devices, coming in a later update' },
      { name: 'gpiozero.MCP3202', why: 'gpiozero.MCP3202 needs SPI devices, coming in a later update' },
    ])
    expect(unsupportedImports('from gpiozero import LED\nimport time\n')).toEqual([])
  })
  it('reads a parenthesised from-import across lines, and does not run on across newlines without parentheses', () => {
    expect(unsupportedImports('from gpiozero import (\n  LED,\n  MCP3008,\n)\n').map((u) => u.name)).toEqual(['gpiozero.MCP3008'])
    expect(unsupportedImports('from gpiozero import LED\nMCP3008 = 1\n')).toEqual([])
  })
})
