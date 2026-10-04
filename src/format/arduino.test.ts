// Regression test for the Arduino family (scripts/gen-arduino.mjs): each header lists its pins in
// the physical order of Arduino's full pinouts (component side, USB at the top; SparkFun's v14
// board for the Pro Mini), written out here from the sources rather than derived from the modules,
// so a swapped pin fails. A wrong pin is worse than a missing board: re-check any change against
// the module's `source`.
import { describe, expect, it } from 'vitest'
import { externalPower, layoutModule, type ModuleDef } from './module.ts'
import { load, pin, pinsOf, withoutUsb } from './builtinModules.testing.ts'

const R3_POWER = (first: string) => [first, 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN']
const A0_5 = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
const R3_DIGITAL = (scl = 'SCL', sda = 'SDA') => [scl, sda, 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1/TX', 'D0/RX']
const COMM = ['TX3', 'RX3', 'TX2', 'RX2', 'TX1', 'RX1', 'SDA', 'SCL']
const NANO_LEFT = (aref: string, five: string, rst: string) => ['D13', '3V3', aref, 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', five, rst, 'GND', 'VIN']
const NANO_RIGHT = (rx: string, tx: string) => ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', rx, tx]
const PM_LEFT = ['TXO', 'RXI', 'RST', 'GND', '2', '3', '4', '5', '6', '7', '8', '9']
const PM_RIGHT = ['RAW', 'GND', 'RST', 'VCC', 'A3', 'A2', 'A1', 'A0', '13', '12', '11', '10']

// Silkscreen text (label ?? name), top to bottom, and the grid row of the first pin of each side
// where the header position matters (shield boards: Arduino's sheets and KiCad's UNO R3 footprint).
const boards: Record<string, { left: string[]; right: string[]; top?: string[] }> = {
  'arduino-uno-r3': { left: [...R3_POWER('NC'), ...A0_5], right: R3_DIGITAL() },
  'arduino-uno-r4-minima': { left: [...R3_POWER('BOOT'), ...A0_5], right: R3_DIGITAL() },
  'arduino-uno-r4-wifi': { left: ['OFF', 'GND', 'VRTC', ...R3_POWER('BOOT'), ...A0_5], right: R3_DIGITAL() },
  'arduino-leonardo': { left: [...R3_POWER('NC'), ...A0_5], right: R3_DIGITAL() },
  'arduino-zero': { left: [...R3_POWER('ATN'), ...A0_5], right: R3_DIGITAL() },
  'arduino-mega-2560': {
    left: [...R3_POWER('NC'), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'],
    right: [...R3_DIGITAL(), ...COMM],
  },
  'arduino-due': {
    left: [...R3_POWER('NC'), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'DAC0', 'DAC1', 'CANRX', 'CANTX'],
    right: [...R3_DIGITAL('SCL1', 'SDA1'), ...COMM],
  },
  'arduino-micro': {
    left: ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'NC', 'NC', '5V', 'RESET', 'GND', 'VIN', 'CIPO', 'SCK'],
    right: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3/SCL', 'D2/SDA', 'GND', 'RESET', 'D0/RX', 'D1/TX', 'SS', 'COPI'],
  },
  'arduino-nano-every': { left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RX', 'TX') },
  'arduino-nano-33-iot': { left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RX', 'TX') },
  'arduino-nano-33-ble': { left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RX', 'TX') },
  'arduino-nano-esp32': { left: ['D13', '3V3', 'B0', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'VBUS', 'B1', 'GND', 'VIN'], right: NANO_RIGHT('RX0', 'TX0') },
  'arduino-nano-rp2040-connect': { left: NANO_LEFT('REF', '5V', 'REC'), right: NANO_RIGHT('RX', 'TX') },
  'arduino-pro-mini-5v': { left: PM_LEFT, right: PM_RIGHT, top: ['BLK', 'GND', 'VCC', 'RXI', 'TXO', 'GRN'] },
  'arduino-pro-mini-3v3': { left: PM_LEFT, right: PM_RIGHT, top: ['BLK', 'GND', 'VCC', 'RXI', 'TXO', 'GRN'] },
}

const rowsOf = (m: ModuleDef, side: 'left' | 'right' | 'top') => layoutModule(m).pins.filter((p) => p.side === side)

describe('Arduino boards keep the physical header order', () => {
  for (const [id, want] of Object.entries(boards)) {
    const m = withoutUsb(load(id))
    it(`${id}: rows match the source pinout, in the Microcontrollers group`, () => {
      expect(m.category).toBe('Microcontrollers')
      expect(m.source).toMatch(/^https:\/\//)
      for (const side of ['left', 'right', 'top'] as const) expect(rowsOf(m, side).map((p) => p.label ?? p.name)).toEqual(want[side] ?? [])
    })
    it(`${id}: grounds joined, power pins carry a supply, kicad pads on every pin`, () => {
      const pins = pinsOf(m)
      const grounds = [...pins, ...(m.holes ?? [])].filter((p) => p.type === 'ground').map((p) => p.name)
      expect(m.internal?.some((g) => grounds.every((n) => g.includes(n)))).toBe(true)
      for (const p of pins) if (p.type === 'power_in' || p.type === 'power_out') expect(p.supply, p.name).toBeTruthy()
      expect(m.kicad).toBeTruthy()
    })
  }

  it('places the shield headers where they sit on the board (rows from the USB edge)', () => {
    const y = (id: string, name: string) => layoutModule(load(id)).pins.find((p) => p.name === name)!.edge.y / 10
    for (const id of ['arduino-uno-r3', 'arduino-uno-r4-minima', 'arduino-leonardo', 'arduino-zero', 'arduino-mega-2560', 'arduino-due']) {
      expect([y(id, 'GND 3'), y(id, 'D8'), y(id, 'D7'), y(id, 'D0')], id).toEqual([10, 16, 18, 25])
      expect([y(id, 'IOREF'), y(id, 'VIN'), y(id, 'A0'), y(id, 'A5')], id).toEqual([12, 18, 20, 25])
    }
    expect([y('arduino-uno-r4-wifi', 'OFF'), y('arduino-uno-r4-wifi', 'BOOT')]).toEqual([7, 11])
    expect([y('arduino-mega-2560', 'A8'), y('arduino-mega-2560', 'A15'), y('arduino-mega-2560', 'D14'), y('arduino-mega-2560', 'D21')]).toEqual([29, 36, 27, 34])
  })

  it('draws the Mega and Due 2 x 18 header as pads: 5V at the digital end, the even row inside', () => {
    for (const id of ['arduino-mega-2560', 'arduino-due']) {
      const m = load(id)
      const row = (y: number) => m.holes!.filter((g) => g.at[0][1] === y).sort((a, b) => b.at[0][0] - a.at[0][0]).map((g) => g.label ?? g.name)
      const evens = Array.from({ length: 16 }, (_, i) => `D${22 + 2 * i}`)
      expect(row(380), id).toEqual(['5V', ...evens, 'GND'])
      expect(row(390), id).toEqual(['5V', ...evens.map((d) => `D${Number(d.slice(1)) + 1}`), 'GND'])
      expect(m.internal, id).toContainEqual(expect.arrayContaining(['5V', '5V 2', '5V 3']))
    }
  })

  it('joins the duplicated pins: SDA/SCL with A4/A5 (Uno, R4, Mega D20/D21), D2/D3 (Leonardo), IOREF with its rail', () => {
    expect(load('arduino-uno-r3').internal).toEqual(expect.arrayContaining([['SDA', 'A4'], ['SCL', 'A5'], ['5V', 'IOREF']]))
    expect(load('arduino-uno-r4-wifi').internal).toEqual(expect.arrayContaining([['SDA', 'A4'], ['SCL', 'A5']]))
    expect(load('arduino-leonardo').internal).toEqual(expect.arrayContaining([['SDA', 'D2'], ['SCL', 'D3']]))
    expect(load('arduino-mega-2560').internal).toEqual(expect.arrayContaining([['SDA', 'D20'], ['SCL', 'D21']]))
    // Zero and Due: the top pair is its own I2C port, not A4/A5 or D20/D21; IOREF is 3.3 V.
    for (const id of ['arduino-zero', 'arduino-due']) {
      const m = load(id)
      expect(m.internal!.flat().filter((n) => /^S[CD]A?L?1?$/.test(n)), id).toEqual([])
      expect(m.internal, id).toContainEqual(['3V3', 'IOREF'])
    }
    expect(load('arduino-pro-mini-5v').internal).toEqual(expect.arrayContaining([['TXO', 'TXO 2'], ['RXI', 'RXI 2'], ['VCC', 'VCC 2']]))
  })

  it('types the supplies and the USB pin from each board\'s documents', () => {
    expect(pin(load('arduino-uno-r3'), 'VIN')).toMatchObject({ type: 'power_in', supply: '7V/7.4V/9V/12V' })
    expect(pin(load('arduino-uno-r4-minima'), 'VIN')).toMatchObject({ type: 'power_in', supply: '7V/7.4V/9V/12V/24V' })
    expect(pin(load('arduino-uno-r4-wifi'), 'VRTC')).toMatchObject({ type: 'power_in', supply: '3V/3V3' })
    expect(externalPower(load('arduino-uno-r3'))).toEqual([{ pin: '5V', volts: 5, via: 'USB' }])
    expect(externalPower(load('arduino-uno-r4-minima'))).toEqual([{ pin: '5V', volts: 5, via: 'USB', diode: true }])
    expect(externalPower(load('arduino-nano-every'))).toEqual([{ pin: '5V', volts: 5, via: 'USB', diode: true }])
    expect(externalPower(load('arduino-nano-esp32'))).toEqual([{ pin: 'VBUS', volts: 5, via: 'USB' }])
    // Nano 33 and RP2040 Connect: the 5V pin is open until a jumper is soldered, so no USB pin.
    for (const id of ['arduino-nano-33-iot', 'arduino-nano-33-ble', 'arduino-nano-rp2040-connect']) {
      expect(externalPower(load(id)), id).toEqual([])
      expect(pin(load(id), '5V'), id).toMatchObject({ type: 'nc' })
    }
    expect(pin(load('arduino-pro-mini-3v3'), 'VCC')).toMatchObject({ type: 'power_out', supply: '3V3' })
    expect(pin(load('arduino-pro-mini-5v'), 'VCC')).toMatchObject({ type: 'power_out', supply: '5V' })
  })

  it('marks the pins that cannot do everything', () => {
    const caps = (id: string, n: string) => pin(load(id), n)?.caps ?? load(id).holes?.find((g) => g.name === n)?.caps
    expect(caps('arduino-uno-r4-minima', 'BOOT')).toMatchObject({ strapping: 'high' })
    expect(caps('arduino-nano-esp32', 'B0')).toMatchObject({ strapping: 'low', downloadOnly: true })
    expect(caps('arduino-nano-esp32', 'B1')).toMatchObject({ strapping: 'high' })
    expect(caps('arduino-nano-esp32', 'A2')).toMatchObject({ strapping: 'either' })
    expect(caps('arduino-nano-rp2040-connect', 'REC')).toMatchObject({ strapping: 'high' })
    for (const n of ['A6', 'A7']) {
      expect(caps('arduino-nano-rp2040-connect', n), n).toMatchObject({ inputOnly: true })
      expect(caps('arduino-pro-mini-5v', n), n).toMatchObject({ inputOnly: true, noPullup: true })
    }
    // 3.3 V boards: every signal pin says so; 5 V boards do not.
    for (const id of ['arduino-due', 'arduino-zero', 'arduino-nano-33-iot', 'arduino-nano-33-ble', 'arduino-pro-mini-3v3'])
      expect(caps(id, 'D2')?.note, id).toMatch(/3\.3 V/)
    expect(caps('arduino-due', 'D22')?.note).toMatch(/3\.3 V/)
    for (const id of ['arduino-uno-r3', 'arduino-uno-r4-wifi', 'arduino-mega-2560', 'arduino-pro-mini-5v']) expect(caps(id, 'D2'), id).toBeUndefined()
  })

  it('numbers the KiCad pads as KiCad\'s footprints and symbols do', () => {
    const pads = (id: string) => load(id).kicad!.pins!
    // Module:Arduino_UNO_R3 (and the UNO R3 / Leonardo symbols): 1 NC, 8 VIN, 9 A0, 14 A5, 15 D0, 28 D13, 29 GND, 30 AREF, 31 SDA, 32 SCL.
    expect(pads('arduino-uno-r3')).toMatchObject({ NC: '1', VIN: '8', A0: '9', A5: '14', D0: '15', D7: '22', D8: '23', D13: '28', 'GND 3': '29', AREF: '30', SDA: '31', SCL: '32' })
    expect(pads('arduino-uno-r4-wifi')).toMatchObject({ BOOT: '1', A5: '14', D0: '15', SCL: '32' })
    expect(load('arduino-leonardo').kicad!.symbol).toBe('MCU_Module:Arduino_Leonardo')
    // Module:Arduino_Nano (Arduino_Nano_ESP32 symbol): 1 TX, 2 RX, 3 RESET, 4 GND, 16 D13, 18 B0, 27 VBUS, 28 B1, 30 VIN.
    expect(pads('arduino-nano-esp32')).toMatchObject({ TX0: '1', RX0: '2', RST: '3', 'GND 2': '4', D13: '16', B0: '18', VBUS: '27', B1: '28', VIN: '30' })
    expect(pads('arduino-nano-rp2040-connect')).toMatchObject({ AREF: '18', REC: '28' })
  })
})
