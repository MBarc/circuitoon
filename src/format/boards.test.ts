// Regression test for the built-in microcontroller boards: each header row must list its pins
// in the physical order transcribed from the vendor pinout (see each module's `source`), top to
// bottom as seen from the component side, and every pin must land on the 10 px grid in that
// order. A wrong pin is worse than a missing board, so a change here must be re-checked against
// the source.
import { describe, expect, it } from 'vitest'
import { isSpacer, layoutModule } from './module.ts'
import { load, pin, pinsOf } from './builtinModules.testing.ts'


// Silkscreen text (label ?? name), top to bottom.
const boards: Record<string, { left: string[]; right: string[] }> = {
  'esp32-devkitc-v4.json': {
    left: ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'D2', 'D3', 'CMD', '5V'],
    right: ['GND', 'IO23', 'IO22', 'TX', 'RX', 'IO21', 'GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'D1', 'D0', 'CLK'],
  },
  'esp32-devkit-v1-30.json': {
    left: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
    right: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'],
  },
  'esp32-s3-devkitc-1.json': {
    left: ['3V3', '3V3', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'G'],
    right: ['G', 'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'G', 'G'],
  },
  'esp32-c3-supermini.json': {
    left: ['5', '6', '7', '8', '9', '10', '20', '21'],
    right: ['5V', 'G', '3.3', '4', '3', '2', '1', '0'],
  },
  'xiao-esp32c3.json': {
    left: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    right: ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7'],
  },
  'xiao-esp32s3.json': {
    left: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    right: ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7'],
  },
  'esp32-cam.json': {
    left: ['5V', 'GND', 'IO12', 'IO13', 'IO15', 'IO14', 'IO2', 'IO4'],
    right: ['3V3', 'IO16', 'IO0', 'GND', 'VCC', 'U0R', 'U0T', 'GND/R'],
  },
  // Arduino A000005 full pinout, component side, mini-USB at the top (AREF is silkscreened REF).
  'arduino-nano.json': {
    left: ['D13', '3V3', 'REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
    right: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
  },
  // LOLIN D1 mini v3.1.0, component side, antenna at the top, USB at the bottom.
  'wemos-d1-mini.json': {
    left: ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'],
    right: ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V'],
  },
}

describe('built-in boards keep the physical header order', () => {
  for (const [file, want] of Object.entries(boards)) {
    const m = load(file)
    it(`${file}: rows match the source pinout, on pitch, facing each other`, () => {
      expect(m.category).toBe('Microcontrollers')
      expect(m.source).toMatch(/^https:\/\//)
      expect(m.pins.every((p) => isSpacer(p) || p.side === 'left' || p.side === 'right')).toBe(true)
      const lay = layoutModule(m)
      for (const side of ['left', 'right'] as const) {
        const pins = lay.pins.filter((p) => p.side === side)
        expect(pins.map((p) => p.label ?? p.name)).toEqual(want[side])
        pins.forEach((p, i) => i && expect(p.edge.y - pins[i - 1].edge.y).toBe(10))
      }
      // Both rows start at the same height, as on the real header.
      expect(lay.pins.find((p) => p.side === 'left')!.edge.y).toBe(lay.pins.find((p) => p.side === 'right')!.edge.y)
      expect(lay.w).toBeGreaterThanOrEqual(60)
    })
    it(`${file}: every ground pin is joined, power pins carry a supply`, () => {
      const pins = pinsOf(m)
      const grounds = pins.filter((p) => p.type === 'ground').map((p) => p.name)
      if (grounds.length > 1) expect(m.internal?.some((g) => grounds.every((n) => g.includes(n)))).toBe(true)
      for (const p of pins) if (p.type === 'power_in' || p.type === 'power_out') expect(p.supply).toBeTruthy()
    })
  }

  it('the Nano joins its two RST pins and types its analog-only and supply pins', () => {
    const m = load('arduino-nano.json')
    expect(m.internal).toContainEqual(['RST', 'RST 2'])
    for (const n of ['A6', 'A7', 'AREF']) expect(pin(m, n)).toMatchObject({ type: 'input' })
    expect(pin(m, 'VIN')).toMatchObject({ type: 'power_in', supply: '7V/7.4V/9V/12V' })
    expect(pin(m, '3V3')).toMatchObject({ type: 'power_out', supply: '3V3' })
  })
})
