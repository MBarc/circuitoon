// The sourced simulation data (spec 3.4): every patch in scripts/sim-data is what its module file
// holds, and every value carries honest provenance.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'
import { LED_COLOURS } from './ledModels.ts'

const DIR = join(import.meta.dirname, '..', '..', 'scripts', 'sim-data')
export const patches = (): { id: string; sim: Record<string, unknown>; unaccounted?: string[]; review: unknown[] }[] =>
  readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))

describe('sourced simulation data', () => {
  it('matches each module file exactly', () => {
    // A patch's unaccounted list lands in the module as sim.unaccounted (Phase C checkpoint, finding 4).
    for (const p of patches()) expect(simOf(load(p.id)), p.id).toEqual(p.unaccounted?.length ? { ...p.sim, unaccounted: p.unaccounted } : p.sim)
  })
  it('has been checked by two independent reviewers (spec 3.4)', () => {
    for (const p of patches()) expect(p.review.length, p.id).toBeGreaterThanOrEqual(2)
  })
  it('words what the editor and the CLI show in plain terms: no solver names, no board-internal refs (spec 5.2)', () => {
    for (const p of patches()) {
      const minLoad = ((p.sim.power as { rails?: { minLoad?: { note: string } }[] } | undefined)?.rails ?? []).flatMap((r) => (r.minLoad ? [r.minLoad.note] : []))
      for (const text of [...(p.unaccounted ?? []), ...minLoad]) expect(text, p.id).not.toMatch(/rInternal|\biq\b|solver|\((?:U|IC|D|R)\d+\)|\b(?:RN|RP)\d[A-D]\b/)
    }
  })
})

describe('LED colours (spec 3.4, ruling R12)', () => {
  it('gives every colour a sourced absolute maximum between 10 and 200 mA', () => {
    for (const [colour, c] of Object.entries(LED_COLOURS)) {
      expect(c.absMaxCurrent?.source, colour).toMatch(/^https?:\/\//)
      expect(c.absMaxCurrent!.value, colour).toBeGreaterThan(0.01)
      expect(c.absMaxCurrent!.value, colour).toBeLessThan(0.2)
    }
  })
})

const CELLS = ['battery-18650-cell', 'battery-9v', 'battery-aa', 'battery-aaa', 'battery-cr1220', 'battery-cr2016', 'battery-cr2025', 'battery-cr2032', 'battery-lr44']
const HOLDERS = ['battery-18650-holder', 'battery-18650-holder-2s', 'battery-holder-2xaa', 'battery-holder-3xaaa', 'battery-holder-4xaa', 'battery-holder-cr2032']

describe('batteries, resistors and the KCD1 (spec 3.1, 3.4)', () => {
  it('gives every built-in voltage source an rInternal and a sourceCurrent limit, by chemistry', () => {
    for (const id of [...CELLS, ...HOLDERS]) {
      const sim = simOf(load(id))
      expect(sim?.modelParams?.rInternal?.unit, id).toBe('ohm')
      expect(sim?.limits?.filter((l) => l.kind === 'sourceCurrent' && 'part' in l.of), id).toHaveLength(1)
    }
  })
  it('labels a loose cell representative and a holder an estimate (the holder is not the cell)', () => {
    // The LR44 sheet gives only a 3 to 9 ohm range; its midpoint is an estimate (reviewer 1's correction).
    for (const id of CELLS) expect(simOf(load(id))?.modelParams?.rInternal?.provenance, id).toBe(id === 'battery-lr44' ? 'estimate' : 'representative')
    for (const id of HOLDERS) {
      const r = simOf(load(id))?.modelParams?.rInternal
      expect(r?.provenance, id).toBe('estimate')
      expect(r?.note, id).toMatch(/cell/i)
    }
  })
  it('gives a coin cell far more internal resistance than an 18650 (spec 3.1)', () => {
    expect(simOf(load('battery-cr2032'))!.modelParams!.rInternal.value).toBeGreaterThan(50 * simOf(load('battery-18650-cell'))!.modelParams!.rInternal.value)
  })
  it('rates the resistors by package power and the KCD1 by its datasheet contact resistance', () => {
    expect(simOf(load('resistor'))?.limits).toEqual([expect.objectContaining({ of: { part: true }, kind: 'power', value: 0.25, provenance: 'representative' })])
    expect(simOf(load('resistor-half-watt'))?.limits).toEqual([expect.objectContaining({ kind: 'power', value: 0.5 })])
    expect(simOf(load('rocker-switch-kcd1'))?.modelParams?.contactResistance).toMatchObject({ unit: 'ohm', provenance: 'datasheet' })
  })
})

describe('ESP32 DevKits (spec 3.4)', () => {
  for (const [id, five] of [['esp32-devkit-v1-30', 'VIN'], ['esp32-devkitc-v4', '5V']] as const)
    it(`${id}: three domains, a USB diode and an LDO, a chip draw labelled as chip, GPIO and limits`, () => {
      const sim = simOf(load(id))!
      expect(sim.usbPorts).toEqual({ USB: { gnd: 'GND' } })
      expect(sim.power!.domains.map((d) => d.name).sort()).toEqual(['3V3', five, 'USB'].sort())
      expect(sim.power!.rails!.map((r) => r.kind).sort()).toEqual(['ldo', 'switch'])
      const draw = sim.power!.draw!.find((d) => d.domain === '3V3')!
      expect(draw.typical.note).toMatch(/chip, not board/)
      expect(draw.peak?.note).toBeTruthy()
      expect(draw.minVolts).toBeDefined()
      expect(sim.gpio!.domain).toBe('3V3')
      expect(sim.gpio!.pins.length).toBeGreaterThan(15)
      expect(sim.limits!.some((l) => l.kind === 'ioTotalCurrent')).toBe(true)
      // Phase C checkpoint: the ESP32's 3.6 V supply maximum on the 3V3 pin.
      expect(sim.limits!.find((l) => l.kind === 'vinMax' && 'domain' in l.of && l.of.domain === '3V3')).toMatchObject({ value: 3.6, provenance: 'datasheet' })
    })
})

describe('displays and the MCP23017 breakout (spec 3.4)', () => {
  it('gives the OLED a pixel-dependent draw with its conditions', () => {
    const d = simOf(load('oled-ssd1306-096-i2c'))!.power!.draw!.find((x) => x.domain === 'VCC')!
    expect(d.peak!.value).toBeGreaterThan(d.typical.value)
    expect(d.peak!.note).toMatch(/pixel/i)
  })
  it('splits the LCD into its controller and its backlight', () => {
    const sim = simOf(load('lcd-st7796s-4in-spi-touch'))!
    expect(sim.power!.draw!.map((d) => d.domain).sort()).toEqual(['LED', 'VCC'])
  })
  it('gives the MCP23017 breakout a chip draw and per-pin limits', () => {
    const sim = simOf(load('mcp23017-cjmcu-2317'))!
    expect(sim.power!.draw!.length).toBeGreaterThan(0)
    // The datasheet's 25 mA per pin is an absolute maximum, so the pins carry absMaxCurrent only (controller ruling).
    expect(sim.limits!.some((l) => l.kind === 'absMaxCurrent' && 'pin' in l.of && l.of.pin === 'GPA0')).toBe(true)
  })
  it('gives the MCP23017 its 16 GPIO pins on VCC, with a pull-up and no pull-down (Phase C checkpoint)', () => {
    const g = simOf(load('mcp23017-cjmcu-2317'))!.gpio!
    expect(g.domain).toBe('VCC')
    expect(g.pins).toEqual([...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `GPA${i}`), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `GPB${i}`)])
    expect([g.pullup?.value, g.pulldown, g.inputLeakage?.value, g.outputResistance.value]).toEqual([66700, undefined, 1e-6, 75])
  })
})

describe('the IP5306 and AMS1117 modules (spec 3.4)', () => {
  it('models the IP5306 as a boost with its light-load shutdown', () => {
    const r = simOf(load('ip5306-usbc-module'))!.power!.rails!.find((x) => x.kind === 'boost')!
    expect(r.inputs).toEqual([{ domain: 'BAT', via: 'direct' }])
    expect(r.output).toBe('OUT')
    expect(r.minLoad?.note).toBeTruthy()
    expect(r.efficiency!.note).toBeTruthy()
  })
  it('models the AMS1117 as an LDO from VIN to OUT', () => {
    const r = simOf(load('ams1117-33-module'))!.power!.rails![0]
    expect([r.kind, r.output, r.vout?.value]).toEqual(['ldo', 'OUT', 3.3])
  })
})

describe('external supplies (spec 4.7)', () => {
  const ids = ['computer-usb-port', 'charger-usb-5v-us', 'hlk-pm01', 'irm-05-5', 'adapter-barrel-us']
  it.each(ids)('%s is a standalone source with an imax', (id) => {
    const s = simOf(load(id))!.power!.source!
    expect(s.imax?.unit).toBe('A')
    expect(s.rInternal.provenance).toBe('estimate')
  })
  it('lets a barrel adapter take the user voltage', () => {
    expect(simOf(load('adapter-barrel-us'))!.power!.source!.voltage).toBe('param:voltage')
  })
})

describe('Arduino Uno, Nano and Pi Pico (spec 3.4)', () => {
  it.each([['arduino-uno-r3', '5V'], ['arduino-nano', '5V'], ['rpi-pico', '3V3']])('%s: chip draw labelled as chip, a regulator, GPIO on %s', (id, io) => {
    const sim = simOf(load(id))!
    expect(sim.power!.draw!.some((d) => /chip, not board/.test(d.typical.note ?? ''))).toBe(true)
    expect(sim.power!.rails!.some((r) => r.kind !== 'switch')).toBe(true)
    expect(sim.gpio!.domain).toBe(io)
  })
})
