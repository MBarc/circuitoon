// Regression test for the Raspberry Pi touch displays, the GPS board, the RTL-SDR dongle and the
// MEMS microphones (scripts/gen-rfpi.mjs): every pin must sit in the physical order transcribed from
// the sources in each module's `source` (maker datasheets, maker photos and board files, cross-checked
// against a second source; .superpowers/rfpi-pinouts.md has the tables). A wrong pin is worse than a
// missing part, so a change here must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { isSpacer, layoutModule, type Side } from './module.ts'
import { load, pinsOf, pin } from './builtinModules.testing.ts'

type Want = { category: string; sides: Partial<Record<Side, (string | null)[]>> }
const parts: Record<string, Want> = {
  // Adapter board silkscreen from the DSI connector end: 5V, INT, SDA, SCL, GND.
  'lcd-rpi-touch-display-7.json': { category: 'Displays', sides: { left: ['DSI'], top: ['5V', 'INT', 'SDA', 'SCL', 'GND'] } },
  // J1 pin 1 (red, 5 V) above pin 2 (black, GND); J2 DSI below.
  'lcd-rpi-touch-display-2-7.json': { category: 'Displays', sides: { left: ['5V', 'GND'], bottom: ['DSI'] } },
  'lcd-rpi-touch-display-2-5.json': { category: 'Displays', sides: { left: ['5V', 'GND'], bottom: ['DSI'] } },
  // GY-GPSV3-NEO-M8N: header J1 VCC RX TX GND, u.FL bottom right.
  'gps-neo-m8n-gy-gpsv3.json': { category: 'Communication', sides: { top: ['VCC', 'RX', 'TX', 'GND'], bottom: [null, null, null, null, null, 'ANT', null, null] } },
  // The USB-A plug is one port (USB design 1.1); SMA at the far end.
  'rtl-sdr-blog-v4.json': { category: 'Communication', sides: { left: ['USB'], right: ['ANT'] } },
  // Top view: pads 2, 3 (ring), 4 on the left; 1, 6, 5 on the right.
  'mic-ics-40300.json': { category: 'Sensors', sides: { left: ['GND', 'GND 2', 'GND 3'], right: ['OUTPUT', 'GND 4', 'VDD'] } },
  // Top view: pads 1, 5, 4 along the top; 2, 6 (ring), 3 along the bottom.
  'mic-spu0410lr5h-qb.json': { category: 'Sensors', sides: { top: ['OUTPUT', 'GND', 'VDD'], bottom: ['GND 2', 'GND 3', 'GND 4'] } },
  // Top view: ring 3 on top, 4 left, 2 right, 5 6 1 along the bottom.
  'mic-ics-43434.json': { category: 'Sensors', sides: { top: ['GND'], left: ['SCK'], right: ['LR'], bottom: ['VDD', 'SD', 'WS'] } },
  // Adafruit 6049, mic side up: JP2 pads 1-6.
  'mic-ics-43434-adafruit-6049.json': { category: 'Sensors', sides: { bottom: ['3V', 'GND', 'BCLK', 'DOUT', 'LRCL', 'SEL'] } },
}

describe('built-in Pi displays, GPS, RTL-SDR and MEMS microphones keep the physical pin order', () => {
  for (const [file, want] of Object.entries(parts)) {
    const m = load(file)
    it(`${file}: every side matches the source, in order, on pitch`, () => {
      expect(m.category).toBe(want.category)
      expect(m.source).toMatch(/^https?:\/\/\S+ https?:\/\//)
      expect(m.art?.pinLabels).toBe('inside')
      expect(m.internal ?? []).toEqual([])
      expect([...new Set(m.pins.map((p) => p.side))].sort()).toEqual(Object.keys(want.sides).sort())
      for (const [side, names] of Object.entries(want.sides)) {
        expect(m.pins.filter((p) => p.side === side).map((p) => (isSpacer(p) ? null : p.name))).toEqual(names)
      }
      const lay = layoutModule(m)
      for (const p of lay.pins) expect((p.side === 'top' || p.side === 'bottom' ? p.edge.x : p.edge.y) % 10).toBe(0)
      for (const p of pinsOf(m)) {
        if ((p.label ?? p.name) === 'GND') expect(p.type).toBe('ground')
        if (p.type === 'power_in' || p.type === 'power_out') expect(p.supply).toBeTruthy()
      }
    })
  }

  it('types the rails and signals as their sources state', () => {
    for (const f of ['lcd-rpi-touch-display-7.json', 'lcd-rpi-touch-display-2-7.json', 'lcd-rpi-touch-display-2-5.json']) {
      expect(pin(load(f), '5V')).toMatchObject({ type: 'power_in', supply: '5V' })
      expect(pin(load(f), 'DSI')?.type).toBe('passive')
    }
    const gps = load('gps-neo-m8n-gy-gpsv3.json')
    expect(pin(gps, 'VCC')).toMatchObject({ type: 'power_in', supply: '3V3/5V' })
    expect(pin(gps, 'RX')?.type).toBe('input')
    expect(pin(gps, 'TX')?.type).toBe('output')
    const sdr = load('rtl-sdr-blog-v4.json')
    // Datasheet: "USB Connector: USB-A Male", "Typical Current Draw 250 - 270 mA".
    expect(pin(sdr, 'USB')).toMatchObject({ type: 'usb', usb: { connector: 'A', gender: 'plug', role: 'device', version: '2.0', draw: 270 } })
    for (const f of ['mic-ics-40300.json', 'mic-spu0410lr5h-qb.json']) {
      expect(pin(load(f), 'OUTPUT')?.type).toBe('output')
      expect(pin(load(f), 'VDD')).toMatchObject({ type: 'power_in', supply: '1V8/3V3' })
    }
    const mic = load('mic-ics-43434.json')
    for (const n of ['WS', 'LR', 'SCK']) expect(pin(mic, n)?.type).toBe('input')
    expect(pin(mic, 'SD')?.type).toBe('output')
    expect(pin(load('mic-ics-43434-adafruit-6049.json'), '3V')).toMatchObject({ type: 'power_in', supply: '3V3' })
  })

  it('numbers the bare mic pads by the datasheet pin numbers', () => {
    expect(load('mic-ics-43434.json').kicad?.pins).toEqual({ WS: '1', LR: '2', GND: '3', SCK: '4', VDD: '5', SD: '6' })
  })
})
