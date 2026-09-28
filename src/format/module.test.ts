import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { insideLabelSides, layoutModule, usesInsideLabels, validParamValue, commonReturn, declaredReturns, externalPower, validateModule, voltageOutputs, partSetting, type ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'

const base = { format: 'circuitoon-module/1', id: 'thing', name: 'Thing' }

describe('validateModule', () => {
  it('accepts a minimal module', () => {
    expect(validateModule({ ...base, pins: [{ name: 'A', side: 'left' }] }).ok).toBe(true)
  })
  it('rejects a missing format instead of guessing', () => {
    const r = validateModule({ id: 'thing', name: 'Thing', pins: [{ name: 'A', side: 'left' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/^format: missing/)
  })
  it('names the path of each problem', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }, { name: 'A', side: 'middle' }, { spacer: true, side: 'top', name: 'X' }],
      internal: [['A', 'B']],
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'pins[1].side: must be top, bottom, left or right',
        'pins[1].name: duplicate pin name "A"',
        'pins[2]: a spacer takes no name',
        'internal[0][1]: no pin named "B"',
      ])
  })
  it('accepts a string source and rejects any other type', () => {
    const pins = [{ name: 'A', side: 'left' }]
    expect(validateModule({ ...base, pins, source: 'https://example.com/a https://example.com/b' }).ok).toBe(true)
    const r = validateModule({ ...base, pins, source: ['https://example.com/a'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['source: must be a string (one or more URLs)'])
  })
  it('rejects an object-valued pin label', () => {
    const r = validateModule({ ...base, pins: [{ name: 'A', side: 'left', label: { x: 1 } }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['pins[0].label: must be a string'])
  })
  it('rejects an object-valued shape label', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 40, h: 30, shapes: [{ type: 'rect', x: 0, y: 0, w: 40, h: 30, fill: '#fff', label: { t: 'x' } }] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['art.shapes[0].label: must be a string'])
  })
  it('accepts a supply list of rails separated by "/" and rejects empty tokens', () => {
    const pin = (supply: string) => validateModule({ ...base, pins: [{ name: 'VCC', side: 'left', type: 'power_in', supply }] })
    for (const ok of ['5V', '3V3', 'VDD', '3V3/5V', '1V8/3V3/5V']) expect(pin(ok).ok).toBe(true)
    for (const bad of ['', '/', '3V3/', '/5V', '3V3//5V', ' 3V3/5V', '3V3 / 5V']) {
      const r = pin(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors).toEqual(['pins[0].supply: must be one or more rail names separated by "/", for example "3V3/5V"'])
    }
  })
  it('checks the other optional fields rendering reads', () => {
    const r = validateModule({
      ...base,
      category: 7,
      pins: [{ name: 'A', side: 'left', supply: 5 }],
      size: { w: 0, h: 3 },
      art: {
        w: -1, h: 30,
        shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', radius: '2', outline: 'yes', labelColor: 1, labelSize: 0 }],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'category: must be a string',
        'pins[0].supply: must be a string',
        'size: must be { "w": <units>, "h": <units> } with positive numbers',
        'art: must be { "w", "h", "shapes": [...] } with positive w and h',
      ])
    const r2 = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', radius: '2', outline: 'yes', labelColor: 1, labelSize: 0 }] },
    })
    if (!r2.ok)
      expect(r2.errors).toEqual([
        'art.shapes[0].radius: must be a number',
        'art.shapes[0].outline: must be true or false',
        'art.shapes[0].labelColor: must be a string',
        'art.shapes[0].labelSize: must be a positive number',
      ])
    expect(r2.ok).toBe(false)
  })
  it('checks resistance, capacitance and voltage params for their unit and a valid default', () => {
    const params = (p: unknown) => validateModule({ ...base, pins: [{ name: 'A', side: 'left' }], electrical: { params: p } })
    expect(params({ resistance: { unit: 'ohm', default: 0 }, capacitance: { unit: 'F', default: 1e-7 }, voltage: { unit: 'V', default: -5 } }).ok).toBe(true)
    expect(params({ forwardVoltage: { unit: 'V', default: 2 }, color: { default: 'red' } }).ok).toBe(true)
    const r = params({ resistance: { unit: 'F', default: -1 }, capacitance: { unit: 'F', default: 0 }, voltage: { default: 'high' } })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'electrical.params.resistance.unit: must be "ohm"',
        'electrical.params.resistance.default: must be 0, or from 1e-15 to 1e12',
        'electrical.params.capacitance.default: must be from 1e-15 to 1e12',
        'electrical.params.voltage.unit: must be "V"',
        'electrical.params.voltage.default: must be 0, or a magnitude from 1e-15 to 1e12',
      ])
    const bad = params([])
    expect(!bad.ok && bad.errors).toEqual(['electrical.params: must be an object'])
  })
  it('checks electrical.external: an existing pin, volts above 0 and what powers it', () => {
    const ext = (e: unknown) => validateModule({ ...base, pins: [{ name: '5V', side: 'left', type: 'power_in', supply: '5V' }], electrical: { model: 'mcu', external: e } })
    const good = ext([{ pin: '5V', volts: 5, via: 'USB' }])
    expect(good.ok).toBe(true)
    if (good.ok) expect(externalPower(good.module)).toEqual([{ pin: '5V', volts: 5, via: 'USB' }])
    expect(!ext({}).ok && (ext({}) as { errors: string[] }).errors).toEqual(['electrical.external: must be a list of { "pin", "volts", "via" }'])
    const bad = ext([{ pin: 'VIN', volts: 0, via: '' }, { pin: '5V', volts: Infinity, via: 'USB' }, 'x'])
    expect(!bad.ok && bad.errors).toEqual([
      'electrical.external[0].pin: no pin named "VIN"',
      'electrical.external[0].volts: must be a number above 0',
      'electrical.external[0].via: required, what powers the pin (for example "USB")',
      'electrical.external[1].volts: must be a number above 0',
      'electrical.external[2]: must be { "pin", "volts", "via" }',
    ])
    const diode = ext([{ pin: '5V', volts: 5, via: 'USB', diode: true, max: 5.5 }])
    expect(diode.ok && externalPower(diode.module)).toEqual([{ pin: '5V', volts: 5, via: 'USB', diode: true, max: 5.5 }])
    const badDiode = ext([{ pin: '5V', volts: 5, via: 'USB', diode: 'yes', max: 4 }])
    expect(!badDiode.ok && badDiode.errors).toEqual(['electrical.external[0].diode: must be true or false', 'electrical.external[0].max: must be a number, at least volts'])
  })
  it('checks electrical.commonReturn: groups of 2 or more ground pins', () => {
    const pins = [{ name: 'G1', side: 'left', type: 'ground' }, { name: 'G2', side: 'left', type: 'ground' }, { name: 'X', side: 'left' }]
    const v = (commonReturn: unknown) => validateModule({ ...base, pins, electrical: { commonReturn } })
    const ok = v([['G1', 'G2']])
    expect(ok.ok && commonReturn(ok.module)).toEqual([['G1', 'G2']])
    const bad = v([['G1'], ['G1', 'X'], 'G2'])
    expect(!bad.ok && bad.errors).toEqual([
      'electrical.commonReturn[0]: needs 2 or more ground pin names',
      'electrical.commonReturn[1][1]: no ground pin named "X"',
      'electrical.commonReturn[2]: needs 2 or more ground pin names',
    ])
    expect(!v({}).ok).toBe(true)
  })
  it('checks electrical.returns: an output or USB pin to a ground pin', () => {
    const pins = [
      { name: 'OUT', side: 'left', type: 'power_out', supply: '5V' }, { name: '5V', side: 'left', type: 'power_in', supply: '5V' },
      { name: 'G', side: 'left', type: 'ground' }, { name: 'X', side: 'left' },
    ]
    const v = (returns: unknown) => validateModule({ ...base, pins, electrical: { external: [{ pin: '5V', volts: 5, via: 'USB' }], returns } })
    const ok = v({ OUT: 'G', '5V': 'G' })
    expect(ok.ok && declaredReturns(ok.module)).toEqual({ OUT: 'G', '5V': 'G' })
    const bad = v({ X: 'G', OUT: 'X' })
    expect(!bad.ok && bad.errors).toEqual([
      'electrical.returns.X: no power_out or external pin named "X"',
      'electrical.returns.OUT: no ground pin named "X"',
    ])
    expect(!v([]).ok).toBe(true)
  })
  it('binds a voltage value to named outputs: required when there are several, the only one otherwise', () => {
    const pins = [
      { name: '5V', side: 'left', type: 'power_out', supply: '5V' },
      { name: 'ADJ', side: 'left', type: 'power_out', supply: 'ADJ' },
      { name: 'IN', side: 'left', type: 'power_in', supply: '12V' },
    ]
    const v = (electrical: Record<string, unknown>, p: unknown[] = pins) => validateModule({ ...base, pins: p, electrical })
    const params = { voltage: { unit: 'V', default: 3.3 } }
    const two = v({ params })
    expect(!two.ok && two.errors).toEqual(['electrical.voltageOutputs: required, the module has a voltage value and 2 power_out pins; name the ones the value sets'])
    const named = v({ params, voltageOutputs: ['ADJ'] })
    expect(named.ok).toBe(true)
    if (named.ok) expect(voltageOutputs(named.module)).toEqual(['ADJ'])
    const bad = v({ params, voltageOutputs: ['IN', 'X'] })
    expect(!bad.ok && bad.errors).toEqual([
      'electrical.voltageOutputs[0]: no power_out pin named "IN"',
      'electrical.voltageOutputs[1]: no power_out pin named "X"',
    ])
    expect(!v({ voltageOutputs: ['5V'] }).ok).toBe(true)
    const single = v({ params }, [pins[0], pins[2]])
    expect(single.ok && voltageOutputs(single.module)).toEqual(['5V'])
    expect(voltageOutputs(load('battery-9v'))).toEqual(['+'])
    expect(voltageOutputs(load('lm2596-buck-module'))).toEqual(['OUT+'])
  })
  it('shares one magnitude contract with value entry: 0 where allowed, else 1e-15 to 1e12', () => {
    const at = (name: string, v: number) => validParamValue(name, v)
    for (const name of ['resistance', 'capacitance', 'voltage']) {
      expect(at(name, 1e-15)).toBe(true)
      expect(at(name, 1e12)).toBe(true)
      expect(at(name, 1e-320)).toBe(false)
      expect(at(name, 9.99e-16)).toBe(false)
      expect(at(name, 1.01e12)).toBe(false)
    }
    expect(at('resistance', 0)).toBe(true)
    expect(at('voltage', 0)).toBe(true)
    expect(at('voltage', -1e-320)).toBe(false)
    expect(at('voltage', -2e12)).toBe(false)
    expect(at('capacitance', 0)).toBe(false)
    const tiny = validateModule({ ...base, pins: [{ name: 'A', side: 'left' }], electrical: { params: { resistance: { unit: 'ohm', default: 1e-320 } } } })
    expect(!tiny.ok && tiny.errors).toEqual([`electrical.params.resistance.default: must be ${'0, or from 1e-15 to 1e12'}`])
  })
  it('accepts a shape band from 1 to 4', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 4 }] },
    })
    expect(r.ok).toBe(true)
  })
  it('accepts art.pinLabels "inside" and rejects any other value', () => {
    const pins = [{ name: 'A', side: 'left' }]
    expect(validateModule({ ...base, pins, art: { w: 10, h: 10, shapes: [], pinLabels: 'inside' } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, art: { w: 10, h: 10, shapes: [], pinLabels: 'outside' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['art.pinLabels: must be "inside"'])
  })
  it('rejects a shape band outside 1 to 4 or non-integer', () => {
    const r = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 5 }] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['art.shapes[0].band: must be a whole number from 1 to 4'])
    const r2 = validateModule({
      ...base,
      pins: [{ name: 'A', side: 'left' }],
      art: { w: 4, h: 3, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3, fill: '#fff', band: 1.5 }] },
    })
    expect(r2.ok).toBe(false)
  })
})

describe('layoutModule', () => {
  const m = (pins: ModuleDef['pins'], extra: Partial<ModuleDef> = {}) =>
    ({ ...base, pins, ...extra }) as ModuleDef

  it('grows the body to fit pins plus corner margin, on the 10 px grid', () => {
    const lay = layoutModule(m(Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, side: 'top' as const }))))
    expect(lay.w).toBe(80)
    expect(lay.pins.map((p) => p.edge.x)).toEqual([20, 30, 40, 50, 60, 70])
  })
  it('keeps array order: top to bottom on the left side', () => {
    const lay = layoutModule(m([{ name: 'A', side: 'left' }, { name: 'B', side: 'left' }]))
    expect(lay.pins.map((p) => [p.name, p.edge.y])).toEqual([['A', 20], ['B', 30]])
  })
  it('spacers take a slot but make no pin', () => {
    const lay = layoutModule(m([{ name: '+', side: 'top' }, { spacer: true, side: 'top' }, { name: '-', side: 'top' }]))
    expect(lay.pins.map((p) => p.edge.x)).toEqual([20, 40])
  })
  it('pin stubs point outward', () => {
    const lay = layoutModule(m([{ name: 'A', side: 'right' }]))
    expect(lay.pins[0].end).toEqual({ x: lay.w + 8, y: lay.pins[0].edge.y })
  })
  it('art can make the body bigger than the pins need', () => {
    expect(layoutModule(m([{ name: 'A', side: 'left' }], { art: { w: 120, h: 90, shapes: [] } }))).toMatchObject({ w: 120, h: 90 })
  })
})

describe('usesInsideLabels', () => {
  const pins: ModuleDef['pins'] = [{ name: 'A', side: 'left' }]
  const m = (extra: Partial<ModuleDef> = {}): ModuleDef => ({ ...base, pins, ...extra }) as ModuleDef
  it('is false with no art and false with art but no pinLabels flag', () => {
    expect(usesInsideLabels(m())).toBe(false)
    expect(usesInsideLabels(m({ art: { w: 10, h: 10, shapes: [] } }))).toBe(false)
  })
  it('is true only when art.pinLabels is "inside"', () => {
    expect(usesInsideLabels(m({ art: { w: 10, h: 10, shapes: [], pinLabels: 'inside' } }))).toBe(true)
  })
  it('draws inside labels on every side, so a top header (a small OLED) reads like one on the left or right', () => {
    expect(insideLabelSides(m())).toEqual([])
    expect(insideLabelSides(m({ art: { w: 10, h: 10, shapes: [], pinLabels: 'inside' } })).sort()).toEqual(['bottom', 'left', 'right', 'top'])
  })
  it('is set only on the header and pad parts (ESP32, Pico, Arduino Nano and D1 mini boards, DIP chips, display, storage, power, AC-DC, sensor, relay, motor driver and radio modules, multi-lead LEDs, terminal adapter, USB panel-mount cables), never on any other built-in module', () => {
    const dir = join(import.meta.dirname, '..', '..', 'modules')
    const boardFiles = new Set([
      'esp32-devkitc-v4.json', 'esp32-devkit-v1-30.json', 'esp32-s3-devkitc-1.json',
      'esp32-c3-supermini.json', 'xiao-esp32c3.json', 'xiao-esp32s3.json', 'esp32-cam.json',
      'rpi-pico.json', 'rpi-pico-h.json', 'rpi-pico-w.json', 'rpi-pico-2.json', 'rpi-pico-2-w.json',
      'mcp23017-dip28.json', 'mcp23018-dip28.json',
      'lcd-st7796s-4in-spi-touch.json', 'tft-ili9341-28-spi-touch.json', 'tft-ili9341-24-spi.json', 'tft-st7735-18-spi.json',
      'tft-st7789-154-spi.json', 'oled-ssd1306-091-i2c.json', 'oled-ssd1306-096-i2c.json', 'oled-ssd1306-096-i2c-vcc-gnd.json',
      'oled-sh1106-13-i2c.json', 'oled-sh1106-13-i2c-vcc-gnd.json',
      'microsd-spi-3v3.json', 'microsd-spi-5v.json',
      'ip5306-usbc-module.json', 'tp4056-module.json', 'ams1117-33-module.json', 'lm2596-buck-module.json',
      'ws2812b-strip.json', 'ws2812d-5mm.json', 'dht22-module.json', 'dht22-bare.json',
      'bme280-module-4pin.json', 'bme280-module-6pin.json', 'pir-hc-sr501.json', 'ultrasonic-hc-sr04.json',
      'arduino-nano.json', 'wemos-d1-mini.json', 'relay-module-1ch-5v.json', 'l298n-module.json',
      'rfm95-lora-breakout.json', 'level-shifter-bss138-4ch.json', 'servo-sg90.json',
      'esp32-terminal-board-38.json', 'usb-panel-mount-microusb.json', 'usb-panel-mount-usbc.json',
      'hlk-pm01.json', 'hlk-pm03.json', 'irm-03-5.json', 'irm-03-3v3.json', 'irm-05-5.json',
    ])
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.filter((f) => boardFiles.has(f))).toHaveLength(boardFiles.size)
    for (const file of files) {
      const r = validateModule(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      if (!r.ok) throw new Error(`${file}: ${r.errors.join('; ')}`)
      expect(usesInsideLabels(r.module)).toBe(boardFiles.has(file))
    }
  })
})

describe('mains value params', () => {
  const pins = [{ name: 'A', side: 'left' }]
  it('accepts an acVoltage from 1 to 1000 VAC and rejects anything else', () => {
    expect(validateModule({ ...base, pins, electrical: { params: { acVoltage: { unit: 'VAC', default: 230 } } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { params: { acVoltage: { unit: 'V', default: 2000 } } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.params.acVoltage.unit: must be "VAC"', 'electrical.params.acVoltage.default: must be from 1 to 1000'])
  })
  it('lets a fuseRating leave its default out (unknown), but not give a bad one', () => {
    expect(validateModule({ ...base, pins, electrical: { params: { fuseRating: { unit: 'A' } } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { params: { fuseRating: { unit: 'A', default: 0 } } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.params.fuseRating.default: must be above 0, up to 100, or left out'])
  })
  it('checks electrical.settings: a list of 2 or more different choices', () => {
    expect(validateModule({ ...base, pins, electrical: { settings: { fuse: ['fitted', 'absent'] } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { settings: { fuse: ['fitted'] } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.settings.fuse: must be a list of 2 or more different choices, the first the default'])
  })
  it('reads a part setting: its stored choice when valid, else the first choice', () => {
    const m = { ...base, pins, electrical: { settings: { fuse: ['fitted', 'absent'] } } } as ModuleDef
    expect(partSetting({}, m, 'fuse')).toBe('fitted')
    expect(partSetting({ settings: { fuse: 'absent' } }, m, 'fuse')).toBe('absent')
    expect(partSetting({ settings: { fuse: 'blown' } }, m, 'fuse')).toBe('fitted')
    expect(partSetting({}, m, 'colour')).toBeNull()
  })
})
