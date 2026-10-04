// The KiCad mapping of the built-in parts (`kicad`, PRD "KiCad mapping"): every footprint is a
// known KiCad library footprint and every pad it names exists on it, every pin of a mapped part has
// a pad (bar the few listed below), and the pad numbers of the parts that matter most follow the
// package pinout (KiCad's own symbols for the Nano, the Pico and the MCP23017/18).
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isBoard, isNetLabel, type KicadDef, type ModuleDef } from './module.ts'
import { load, moduleFiles, pinsOf } from './builtinModules.testing.ts'
import { KNOWN_FOOTPRINTS } from './kicadFootprints.testing.ts'
import { validateModule } from './module.ts'

const modules: ModuleDef[] = moduleFiles().map(load)
const { UNMAPPED } = (await import(pathToFileURL(resolve('scripts/lib/kicad.mjs')).href)) as { UNMAPPED: Record<string, string> }

/** Pins a mapped part leaves without a pad, on purpose: the footprint has no such pad. */
const NO_PAD: Record<string, string[]> = {
  'rpi-pico': ['SWCLK', 'GND DBG', 'SWDIO'],
  'rpi-pico-h': ['SWCLK', 'GND DBG', 'SWDIO'],
  'rpi-pico-w': ['SWCLK', 'GND DBG', 'SWDIO'],
  'rpi-pico-2': ['SWCLK', 'GND DBG', 'SWDIO'],
  'rpi-pico-2-w': ['SWCLK', 'GND DBG', 'SWDIO'],
  'rfm95-lora-breakout': ['ANT'],
  'gps-neo-m8n-gy-gpsv3': ['ANT'],
  'rtl-sdr-blog-v4': ['ANT'],
}

/** Each footprint of a mapping with its pin-to-pad map. */
const footprintsOf = (k: KicadDef): { footprint: string; pins: Record<string, string> }[] =>
  k.headers ? k.headers.map((h) => ({ footprint: h.footprint, pins: h.pins })) : [{ footprint: k.footprint!, pins: k.pins ?? {} }]

const padOf = (m: ModuleDef, name: string): string | undefined => {
  for (const f of footprintsOf(m.kicad!)) if (Object.hasOwn(f.pins, name)) return f.pins[name]
  return undefined
}
const byId = (id: string) => modules.find((m) => m.id === id)!

describe('the KiCad mapping of the built-in parts', () => {
  it('maps every part except the infrastructure and the listed exceptions', () => {
    const missing = modules.filter((m) => !m.kicad && !isNetLabel(m) && !isBoard(m) && !Object.hasOwn(UNMAPPED, m.id)).map((m) => m.id)
    expect(missing).toEqual([])
    // Breadboards, rail strips and net labels have no PCB meaning; outlets (hole groups too) are mapped.
    expect(modules.filter((m) => !m.kicad && (isNetLabel(m) || isBoard(m))).map((m) => m.id).sort()).toEqual(
      ['breadboard-full', 'breadboard-half', 'breadboard-mini', 'breadboard-tiny', 'net-label', 'power-rail-strip'],
    )
    for (const id of Object.keys(UNMAPPED)) expect(byId(id)?.kicad, id).toBeUndefined()
  })

  it('names only known KiCad footprints, and only pads they have', () => {
    for (const m of modules.filter((x) => x.kicad))
      for (const f of footprintsOf(m.kicad!)) {
        expect(Object.hasOwn(KNOWN_FOOTPRINTS, f.footprint), `${m.id}: ${f.footprint}`).toBe(true)
        for (const [pin, pad] of Object.entries(f.pins)) expect(KNOWN_FOOTPRINTS[f.footprint], `${m.id} ${pin}`).toContain(pad)
      }
  })

  it('gives every pin and pad group of a mapped part a pad, bar the listed few', () => {
    for (const m of modules.filter((x) => x.kicad)) {
      const names = [...pinsOf(m).map((p) => p.name), ...(m.holes ?? []).map((g) => g.name)]
      const unpadded = names.filter((n) => padOf(m, n) === undefined)
      expect(unpadded, m.id).toEqual(NO_PAD[m.id] ?? [])
    }
  })

  it('marks every stand-in mains footprint as a placeholder, with a note', () => {
    const placeholders = modules.filter((m) => m.kicad?.placeholder)
    for (const m of placeholders) expect(m.kicad!.note, m.id).toMatch(/Placeholder/)
    for (const id of ['outlet-schuko-cee7-3', 'plug-us-5-15p', 'lamp-holder-e27', 'fuse-holder-5x20-inline', 'ssr-fotek-25da', 'relay-module-1ch-5v'])
      expect(byId(id).kicad!.placeholder, id).toBe(true)
    // Real board parts keep their own footprint.
    for (const id of ['hlk-pm01', 'irm-03-5', 'terminal-block-mstb-508-2']) expect(byId(id).kicad!.placeholder, id).toBeUndefined()
  })

  it('numbers the pads of the key parts by their package pinout', () => {
    const pads = (id: string, pins: Record<string, string>) => {
      const m = byId(id)
      expect(Object.fromEntries(Object.keys(pins).map((n) => [n, padOf(m, n)])), id).toEqual(pins)
    }
    // KiCad's Arduino_Nano_v3.x symbol: 1 D1/TX, 2 D0/RX, 4 GND, 15 D12, 16 D13, 27 +5V, 30 VIN.
    pads('arduino-nano', { TX1: '1', RX0: '2', 'GND 2': '4', D12: '15', D13: '16', '3V3': '17', '5V': '27', GND: '29', VIN: '30' })
    // KiCad's RaspberryPi_Pico symbol: 1 GPIO0, 3 GND, 20 GPIO15, 21 GPIO16, 36 3V3, 39 VSYS, 40 VBUS.
    pads('rpi-pico', { GP0: '1', GND: '3', GP15: '20', GP16: '21', '3V3(OUT)': '36', VSYS: '39', VBUS: '40', AGND: '33', RUN: '30' })
    // MCP23017 (MCP23017x-x-SP): 9 VDD, 10 VSS, 12 SCK, 13 SDA, 15 A0, 18 RESET, 20 INTA, 21 GPA0, 28 GPA7.
    pads('mcp23017-dip28', { GPB0: '1', GPB7: '8', VDD: '9', VSS: '10', SCL: '12', SDA: '13', A0: '15', A2: '17', RESET: '18', INTB: '19', INTA: '20', GPA0: '21', GPA7: '28' })
    // MCP23018 (MCP23018x-x-SP): 1 VSS, 3 GPB0, 11 VDD, 12 SCL, 15 ADDR, 16 RESET, 19 INTA, 27 GPA7.
    pads('mcp23018-dip28', { VSS: '1', GPB0: '3', VDD: '11', SCL: '12', SDA: '13', ADDR: '15', RESET: '16', INTB: '18', INTA: '19', GPA0: '20', GPA7: '27' })
    pads('led', { K: '1', A: '2' })
    pads('capacitor-electrolytic', { '+': '1', '-': '2' })
    pads('hlk-pm01', { 'AC 1': '1', 'AC 2': '2', '-Vo': '3', '+Vo': '4' })
    pads('irm-03-5', { 'AC/L': '1', 'AC/N': '3', '-V': '14', '+V': '16' })
    pads('ws2812d-5mm', { DOUT: '1', VDD: '2', GND: '3', DIN: '4' })
    pads('dht22-bare', { VCC: '1', DATA: '2', NC: '3', GND: '4' })
  })

  it('numbers every pad of the strips of the key boards in physical order', () => {
    // Written out from the makers' pinouts (DOIT DevKit V1, Espressif DevKitC V4 J2/J3, the CJMCU-2317's
    // three rows seen from the chip side, the 4.0" ST7796S module's header and SD header), not
    // derived from the modules, so a swap in a module or the mapping fails here.
    const strips: Record<string, string[][]> = {
      'esp32-devkit-v1-30': [
        ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
        ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND 2', '3V3'],
      ],
      'esp32-devkitc-v4': [
        ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'D2', 'D3', 'CMD', '5V'],
        ['GND 2', 'IO23', 'IO22', 'TX', 'RX', 'IO21', 'GND 3', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'D1', 'D0', 'CLK'],
      ],
      'mcp23017-cjmcu-2317': [
        ['GND', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7'],
        ['VCC', 'INTB', 'GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7'],
        ['A2', 'A1', 'A0', 'RESET', 'NC', 'NC 2', 'SDA', 'SCL', 'GND 2', 'VCC 2'],
      ],
      'lcd-st7796s-4in-spi-touch': [
        ['VCC', 'GND', 'CS', 'RESET', 'DC/RS', 'SDI(MOSI)', 'SCK', 'LED', 'SDO(MISO)', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'],
        ['SD_CS', 'SD_MOSI', 'SD_MISO', 'SD_SCK'],
      ],
    }
    for (const [id, rows] of Object.entries(strips)) {
      const headers = byId(id).kicad!.headers!
      expect(headers.map((h) => h.pins), id).toEqual(rows.map((row) => Object.fromEntries(row.map((n, i) => [n, String(i + 1)]))))
      headers.forEach((h, i) => expect(h.footprint, `${id} header ${i}`).toBe(`Connector_PinSocket_2.54mm:PinSocket_1x${String(rows[i].length).padStart(2, '0')}_P2.54mm_Vertical`))
    }
  })

  it('gives each row of a dev board or breakout its own socket strip, pin 1 its first pin', () => {
    const v1 = byId('esp32-devkit-v1-30').kicad!
    expect(v1.headers!.map((h) => [h.footprint.split(':')[1], Object.keys(h.pins)[0], h.pins.EN ?? h.pins.D23])).toEqual([
      ['PinSocket_1x15_P2.54mm_Vertical', 'EN', '1'],
      ['PinSocket_1x15_P2.54mm_Vertical', 'D23', '1'],
    ])
    expect(v1.headers![0].pins.VIN).toBe('15')
    expect(v1.headers![1].pins['3V3']).toBe('15')
    const cj = byId('mcp23017-cjmcu-2317').kicad!
    expect(cj.headers!.map((h) => Object.entries(h.pins).filter(([, p]) => p === '1' || p === '10').map(([n]) => n))).toEqual([['GND', 'GPA7'], ['VCC', 'GPB7'], ['A2', 'VCC 2']])
    const lcd = byId('lcd-st7796s-4in-spi-touch').kicad!
    expect(lcd.headers!.map((h) => [h.footprint.split(':')[1], Object.keys(h.pins).length])).toEqual([['PinSocket_1x14_P2.54mm_Vertical', 14], ['PinSocket_1x04_P2.54mm_Vertical', 4]])
  })
})

describe('kicad field validation', () => {
  const base = { format: 'circuitoon-module/1', id: 'x', name: 'X', pins: [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }, { name: 'C', side: 'right' }], internal: [['B', 'C']] }
  const errors = (kicad: unknown) => {
    const r = validateModule({ ...base, kicad })
    return r.ok ? [] : r.errors
  }
  it('accepts a footprint with pads, or headers', () => {
    expect(errors({ footprint: 'Lib:Fp', pins: { A: '1', B: '2', C: '2' } })).toEqual([])
    expect(errors({ headers: [{ footprint: 'Lib:Fp', pins: { A: '1' } }, { name: 'right', footprint: 'Lib:Fp', pins: { B: '1', C: '2' } }] })).toEqual([])
  })
  it('names what is wrong', () => {
    expect(errors({})).toEqual(['kicad: give exactly one of "footprint" or "headers"'])
    expect(errors({ footprint: 'NoColon' })).toEqual(['kicad.footprint: must be a KiCad library id, "Library:Footprint"'])
    expect(errors({ footprint: 'Lib:Fp', pins: { Z: '1' } })).toEqual(['kicad.pins.Z: no pin or hole group named "Z"'])
    expect(errors({ footprint: 'Lib:Fp', pins: { A: '1', B: '1' } })).toEqual(['kicad.pins.B: pad "1" is already "A", and the part does not join them'])
    expect(errors({ footprint: 'Lib:Fp', pins: { A: 'pad one' } })).toEqual(['kicad.pins.A: must be a pad number such as "1"'])
    expect(errors({ headers: [{ footprint: 'Lib:Fp', pins: { A: '1' } }, { footprint: 'Lib:Fp', pins: { A: '1' } }] })).toEqual(['kicad.headers[1].pins.A: "A" is mapped twice'])
    expect(errors({ footprint: 'Lib:Fp', placeholder: 'yes', extra: 1 })).toEqual(['kicad.extra: unknown field', 'kicad.placeholder: must be true when present'])
  })
})
