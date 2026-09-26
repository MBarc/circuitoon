// The wiring checker on real hobby circuits built from the built-in parts: what a correct hookup
// must not be nagged about, and the damaging ones it must catch. From the Claude review's
// realistic-circuit sheets, with the findings the review rulings expect.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { type ModuleDef, externalPower, validateModule } from './module.ts'
import { load } from './builtinModules.testing.ts'

type Wire = [string, string]
let n = 0
/** A sheet of built-in parts; a wire end is "uid|pin" or "uid|group|hole". */
function sheet(parts: PartInstance[], wires: Wire[]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  for (const p of parts) modules[p.module] = load(p.module)
  const ep = (s: string) => {
    const [part, pin, hole] = s.split('|')
    return hole === undefined ? { part, pin } : { part, pin, hole: Number(hole) }
  }
  const connections: Connection[] = wires.map(([a, b]) => ({ uid: `w${++n}`, from: ep(a), to: ep(b) }))
  return { format: 'circuitoon-diagram/1', title: 't', modules, parts, connections }
}
const at = (uid: string, designator: string, module: string, x = 0, extra: Partial<PartInstance> = {}): PartInstance =>
  ({ uid, designator, module, x, y: 0, rotation: 0, ...extra })
const volts = (v: number) => ({ values: { voltage: { value: v, unit: 'V' } } })
/** Each finding as "rule: message". */
const found = (d: Diagram) => checkDiagram(d).map((f) => `${f.rule}: ${f.message}`)
const rules = (d: Diagram) => checkDiagram(d).map((f) => f.rule)

describe('correct circuits give no findings', () => {
  it('ESP32 DevKit V1 with a BME280 on its 3V3', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-4pin', 400)],
      [['u2|VIN', 'u1|3V3'], ['u2|GND', 'u1|GND'], ['u2|SDA', 'u1|D21'], ['u2|SCL', 'u1|D22']])
    expect(found(d)).toEqual([])
  })
  it('Arduino Nano on a 9 V battery at VIN, a relay module on its 5V pin', () => {
    const d = sheet([at('u1', 'U1', 'arduino-nano'), at('k1', 'K1', 'relay-module-1ch-5v', 400), at('bt1', 'BT1', 'battery-9v', -300)],
      [['bt1|+', 'u1|VIN'], ['bt1|-', 'u1|GND'], ['k1|DC+', 'u1|5V'], ['k1|DC-', 'u1|GND 2'], ['k1|IN', 'u1|D7']])
    expect(found(d)).toEqual([])
  })
  it('two AA cells, a resistor and an LED on a breadboard', () => {
    // R1 legs in c3-top and c9-top; D1 across the channel, anode in c9-top, cathode in c9-bot.
    const d = sheet([
      at('bb', 'BB1', 'breadboard-half', 0, { y: 300 }), at('r1', 'R1', 'resistor', 50, { y: 340, mount: { board: 'bb' } }),
      at('d1', 'D1', 'led', 90, { y: 390, rotation: 90, mount: { board: 'bb' } }), at('bt1', 'BT1', 'battery-holder-2xaa', -300),
    ], [['bt1|+', 'bb|top+|0'], ['bt1|-', 'bb|top-|0'], ['bb|top+|2', 'bb|c3-top|2'], ['bb|c9-bot|2', 'bb|top-|5']])
    expect(found(d)).toEqual([])
  })
  it('a 4 x AA pack powering an SG90 servo, its signal from an ESP32, common ground', () => {
    const wires: Wire[] = [['bt1|+', 'm1|VCC'], ['bt1|-', 'm1|GND'], ['m1|GND', 'u1|GND'], ['m1|PWM', 'u1|D13']]
    const parts = [at('u1', 'U1', 'esp32-devkit-v1-30'), at('m1', 'M1', 'servo-sg90', 400), at('bt1', 'BT1', 'battery-holder-4xaa', 700)]
    expect(found(sheet(parts, wires))).toEqual([])
    // Rechargeable NiMH cells: the pack's value set to 4.8 V.
    parts[2] = at('bt1', 'BT1', 'battery-holder-4xaa', 700, volts(4.8))
    expect(found(sheet(parts, wires))).toEqual([])
  })
  it('two AA cells in series are not a short', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-aa'), at('bt2', 'BT2', 'battery-aa', 200), at('d1', 'D1', 'led', 400), at('r1', 'R1', 'resistor', 600)],
      [['bt1|+', 'bt2|-'], ['bt2|+', 'r1|1'], ['r1|2', 'd1|A'], ['d1|K', 'bt1|-']])
    expect(rules(d)).not.toContain('short')
  })
  it('a relay powered from ESP32 VIN, which carries its USB 5 V', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('k1', 'K1', 'relay-module-1ch-5v', 400)],
      [['k1|DC+', 'u1|VIN'], ['k1|DC-', 'u1|GND'], ['k1|IN', 'u1|D23']])
    expect(found(d)).toEqual([])
  })
})

describe('a drawn supply on a pin that also carries USB power (the board is assumed on USB)', () => {
  const lm2596 = (v: number, board: string, pin: string) => sheet(
    [at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module', 0, volts(v)), at('u2', 'U2', board, 400)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', `u2|${pin}`], ['u1|OUT-', 'u2|GND']])
  const pushes = (pin: string, what: string, v: string) =>
    `supplies-fight: U2 ${pin} (5 V from USB) is above ${what} (${v}): USB will push current into ${what} through the ${pin} diode.`
  it('a pin wired straight to USB (Pico VBUS): an LM2596 at 5 V is a warning not to power both', () => {
    expect(found(lm2596(5, 'rpi-pico', 'VBUS'))).toEqual(['supplies-parallel: U2 VBUS also gets 5 V from USB; do not power VBUS and USB at the same time.'])
  })
  it('a pin behind the USB diode (ESP32 VIN): an LM2596 at 5 V, set or default, is fine', () => {
    expect(found(lm2596(5, 'esp32-devkit-v1-30', 'VIN'))).toEqual([])
    const d = sheet([at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module'), at('u2', 'U2', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
    expect(found(d)).toEqual([])
  })
  it('an LM2596 at 12 V into ESP32 VIN: the diode blocks USB, and VIN is fed too much', () => {
    expect(checkDiagram(lm2596(12, 'esp32-devkit-v1-30', 'VIN')).map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error supply-too-high: U2 VIN accepts up to 5 V but gets 12 V from U1 OUT+.',
    ])
  })
  it('an LM2596 at 5.2 V into Pico VSYS is fine (VSYS takes up to 5.5 V); at 6 V it is too high', () => {
    expect(found(lm2596(5.2, 'rpi-pico', 'VSYS'))).toEqual([])
    expect(found(lm2596(6, 'rpi-pico', 'VSYS'))).toEqual(['supply-too-high: U2 VSYS accepts up to 5.5 V but gets 6 V from U1 OUT+.'])
  })
  it('an 18650 into Pico VSYS: USB pushes current into the cell through the diode', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-18650-holder'), at('u2', 'U2', 'rpi-pico', 400)], [['bt1|+', 'u2|VSYS'], ['bt1|-', 'u2|GND']])
    expect(found(d)).toEqual([pushes('VSYS', 'BT1 +', '3.7 V')])
  })
  it('USB-C panel into a TP4056 charging an 18650, boosted by an IP5306 into ESP32 VIN: fine', () => {
    const d = sheet([
      at('u1', 'U1', 'tp4056-module'), at('bt1', 'BT1', 'battery-18650-holder', -300), at('u2', 'U2', 'ip5306-usbc-module', 300),
      at('u3', 'U3', 'esp32-devkit-v1-30', 600), at('j1', 'J1', 'usb-panel-mount-usbc', -600),
    ], [
      ['j1|VBUS', 'u1|IN+'], ['j1|GND', 'u1|IN-'], ['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-'],
      ['u1|OUT+', 'u2|B+'], ['u1|OUT-', 'u2|B-'], ['u2|5V+', 'u3|VIN'], ['u2|5V-', 'u3|GND'],
    ])
    expect(found(d)).toEqual([])
  })
  it('a TP4056 output (one cell, 3.7 V) straight into ESP32 VIN: USB pushes current into the cell', () => {
    const d = sheet([at('u1', 'U1', 'tp4056-module'), at('bt1', 'BT1', 'battery-18650-cell', -300), at('u2', 'U2', 'esp32-devkit-v1-30', 600)],
      [['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
    expect(found(d)).toEqual([pushes('VIN', 'BT1 +', '3.7 V')])
  })
  it('a 3.7 V cell into a Nano 5V pin: USB pushes current into the cell', () => {
    const d = sheet([at('u2', 'U2', 'arduino-nano'), at('bt1', 'BT1', 'battery-18650-holder', 400)], [['bt1|+', 'u2|5V'], ['bt1|-', 'u2|GND']])
    expect(found(d)).toEqual([pushes('5V', 'BT1 +', '3.7 V')])
  })
  it('a pin wired straight to USB (ESP32-C3 5V) still fights a 9 V battery', () => {
    const d = sheet([at('u2', 'U2', 'esp32-c3-supermini'), at('bt1', 'BT1', 'battery-9v', 400)], [['bt1|+', 'u2|5V'], ['bt1|-', 'u2|G']])
    expect(rules(d)).toEqual(['supplies-fight'])
  })
  it('which USB pins sit behind a diode, per board schematic', () => {
    const diode = (id: string) => Object.fromEntries(externalPower(load(id)).map((e) => [e.pin, e.diode === true]))
    expect(diode('esp32-devkitc-v4')).toEqual({ '5V': true })
    expect(diode('esp32-devkit-v1-30')).toEqual({ VIN: true })
    expect(diode('esp32-s3-devkitc-1')).toEqual({ '5V': true })
    expect(diode('arduino-nano')).toEqual({ '5V': true })
    expect(diode('wemos-d1-mini')).toEqual({ '5V': true })
    expect(diode('esp32-terminal-board-38')).toEqual({ '5V': true })
    expect(diode('esp32-c3-supermini')).toEqual({ '5V': false })
    expect(diode('xiao-esp32c3')).toEqual({ '5V': false })
    expect(diode('xiao-esp32s3')).toEqual({ '5V': false })
    for (const id of ['rpi-pico', 'rpi-pico-h', 'rpi-pico-w', 'rpi-pico-2', 'rpi-pico-2-w']) {
      expect(diode(id)).toEqual({ VBUS: false, VSYS: true })
      expect(externalPower(load(id)).find((e) => e.pin === 'VSYS')?.max).toBe(5.5)
    }
  })
})

describe('series stacks and references', () => {
  it('two 2 x AA holders in series (6 V) into a 3.3 V BME280 are too high, not too low', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-holder-2xaa'), at('bt2', 'BT2', 'battery-holder-2xaa', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['bt1|-', 'u1|GND'], ['bt1|+', 'bt2|-'], ['bt2|+', 'u1|VCC']])
    expect(checkDiagram(d).map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error supply-too-high: U1 VCC accepts up to 3.3 V but gets 6 V from BT1 + and BT2 + in series.',
    ])
  })
  it('two cells wired + to - both ways round are a shorted stack', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-aa'), at('bt2', 'BT2', 'battery-aa', 200)], [['bt1|+', 'bt2|-'], ['bt2|+', 'bt1|-']])
    expect(checkDiagram(d).map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error short: BT1 + and BT2 + are wired in a loop, each + to the next -: short circuit.',
    ])
  })
  it('a single cell and the junction of a series pair stay quiet', () => {
    const one = sheet([at('bt1', 'BT1', 'battery-holder-3xaaa'), at('u1', 'U1', 'oled-ssd1306-096-i2c', 400)], [['bt1|-', 'u1|GND'], ['bt1|+', 'u1|VCC']])
    expect(found(one)).toEqual([])
    const pair = sheet([at('bt1', 'BT1', 'battery-aa'), at('bt2', 'BT2', 'battery-aa', 200)], [['bt1|+', 'bt2|-']])
    expect(rules(pair)).not.toContain('short')
    expect(rules(pair)).not.toContain('supplies-fight')
  })
})

describe('Pico VSYS carries USB power through its diode', () => {
  it('VSYS into a 3.3 V only BME280 is too high', () => {
    const d = sheet([at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u2|VCC', 'u1|VSYS'], ['u2|GND', 'u1|GND']])
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 VSYS (USB).'])
  })
  it('VSYS into an OLED that takes 5 V is fine', () => {
    const d = sheet([at('u1', 'U1', 'rpi-pico-w'), at('u2', 'U2', 'oled-ssd1306-096-i2c', 400)], [['u2|VCC', 'u1|VSYS'], ['u2|GND', 'u1|GND']])
    expect(found(d)).toEqual([])
  })
})

describe('the ESP32 DevKitC V4 on the 38-pin terminal board', () => {
  it('powers a sensor from its 5V terminal like the DevKitC itself', () => {
    const ok = sheet([at('u1', 'U1', 'esp32-terminal-board-38'), at('u2', 'U2', 'oled-ssd1306-096-i2c', 400)], [['u2|VCC', 'u1|5V'], ['u2|GND', 'u1|GND']])
    expect(found(ok)).toEqual([])
    const bad = sheet([at('u1', 'U1', 'esp32-terminal-board-38'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u2|VCC', 'u1|5V'], ['u2|GND', 'u1|GND']])
    expect(rules(bad)).toEqual(['supply-too-high'])
  })
})

describe('damaging or dead circuits are caught', () => {
  it('a voltage value applies only to its named output: a fixed 5 V output next to an adjustable one stays 5 V', () => {
    const mixed = validateModule({
      format: 'circuitoon-module/1', id: 'mixed-reg', name: 'Fixed 5 V plus adjustable',
      pins: [
        { name: '5V', side: 'right', type: 'power_out', supply: '5V' },
        { name: 'ADJ', side: 'right', type: 'power_out', supply: 'ADJ' },
        { name: 'GND', side: 'right', type: 'ground' },
      ],
      electrical: { model: 'regulator', params: { voltage: { unit: 'V', default: 3.3 } }, voltageOutputs: ['ADJ'] },
    })
    if (!mixed.ok) throw new Error(mixed.errors.join('; '))
    const d = sheet([at('u2', 'U2', 'bme280-module-6pin', 400)], [['u1|5V', 'u2|VCC'], ['u1|GND', 'u2|GND']])
    d.modules = { ...d.modules, 'mixed-reg': mixed.module }
    d.parts = [at('u1', 'U1', 'mixed-reg'), ...d.parts]
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 5V.'])
  })
  it('two unpowered TP4056 boards tied B+ to B+: a pass-through output feeds nothing', () => {
    const d = sheet([at('u1', 'U1', 'tp4056-module'), at('u2', 'U2', 'tp4056-module', 300)], [['u1|OUT+', 'u2|OUT+'], ['u1|OUT-', 'u2|OUT-']])
    expect(rules(d)).toEqual(['no-power', 'no-power'])
  })
  it('an 18650 holder set to 9 V into an OLED is too high (the value on the sheet counts)', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-18650-holder', 0, volts(9)), at('u1', 'U1', 'oled-ssd1306-096-i2c', 400)],
      [['bt1|+', 'u1|VCC'], ['bt1|-', 'u1|GND']])
    expect(rules(d)).toEqual(['supply-too-high'])
  })
  it('an IP5306 5 V output into ESP32 3V3 fights its regulator', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'ip5306-usbc-module', 400), at('bt1', 'BT1', 'battery-18650-holder', 700)],
      [['bt1|+', 'u2|B+'], ['bt1|-', 'u2|B-'], ['u2|5V+', 'u1|3V3'], ['u2|5V-', 'u1|GND']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error supplies-fight: U2 5V+ (5 V) and U1 3V3 (3.3 V) are wired together: the two supplies fight.',
    ])
  })
  it('a 9 V battery into ESP32-C3 3.3 fights its regulator', () => {
    const d = sheet([at('u1', 'U1', 'esp32-c3-supermini'), at('bt1', 'BT1', 'battery-9v', 400)], [['bt1|+', 'u1|3.3'], ['bt1|-', 'u1|G']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}`)).toEqual(['error supplies-fight'])
  })
  it('a battery + to a board ground that leads back to its - is a short', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('bt1', 'BT1', 'battery-18650-holder', 400)], [['bt1|+', 'u1|GND'], ['bt1|-', 'u1|GND 2']])
    expect(found(d)).toEqual(['short: BT1 + is wired to U1 GND, which leads back to BT1 -: short circuit.'])
  })
  it('a Nano on USB, its 5V pin into ESP32 3V3: USB pushes current into the 3.3 V rail through the diode', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'arduino-nano', 400)], [['u2|5V', 'u1|3V3'], ['u2|GND', 'u1|GND']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error supplies-fight: U2 5V (5 V from USB) is above U1 3V3 (3.3 V): USB will push current into U1 3V3 through the 5V diode.',
    ])
  })
  it('ESP32 VIN (USB 5 V) into a 3.3 V only BME280 is too high', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u2|VCC', 'u1|VIN'], ['u2|GND', 'u1|GND']])
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 VIN (USB).'])
  })
  it('two sensors with their VCCs tied only to each other have no power', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-4pin', 400), at('u3', 'U3', 'oled-ssd1306-096-i2c', 700)], [
      ['u2|VIN', 'u3|VCC'], ['u2|GND', 'u1|GND'], ['u3|GND', 'u1|GND 2'],
      ['u2|SDA', 'u1|D21'], ['u2|SCL', 'u1|D22'], ['u3|SDA', 'u1|D21'], ['u3|SCL', 'u1|D22'],
    ])
    expect(found(d)).toEqual([
      'no-power: U2 has no power: VIN is connected but nothing supplies it.',
      'no-power: U3 has no power: VCC is connected but nothing supplies it.',
    ])
  })
  it('sensors on a breadboard + rail that is never jumpered to a supply have no power', () => {
    const d = sheet([
      at('bb', 'BB1', 'breadboard-half', 0, { y: 300 }), at('u1', 'U1', 'rpi-pico', 400), at('u2', 'U2', 'bme280-module-6pin', 700), at('u3', 'U3', 'oled-ssd1306-096-i2c', 900),
    ], [['u1|GND', 'bb|top-|0'], ['u2|VCC', 'bb|top+|3'], ['u2|GND', 'bb|top-|3'], ['u3|VCC', 'bb|top+|5'], ['u3|GND', 'bb|top-|5']])
    expect(found(d)).toEqual([
      'no-power: U2 has no power: VCC is connected but nothing supplies it.',
      'no-power: U3 has no power: VCC is connected but nothing supplies it.',
    ])
  })
  it('an ESP32-CAM has no USB: wired up without its 5V it has no power', () => {
    const d = sheet([at('u1', 'U1', 'esp32-cam'), at('u2', 'U2', 'bme280-module-4pin', 400)], [['u2|VIN', 'u1|3V3'], ['u2|GND', 'u1|GND']])
    expect(found(d)).toEqual(['no-power: U1 has no power: connect 5V.'])
  })
})

/** A custom module, validated like an imported one. */
function custom(raw: Record<string, unknown>): ModuleDef {
  const r = validateModule({ format: 'circuitoon-module/1', name: String(raw.id), ...raw })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.module
}
/** A sheet of built-in parts plus custom modules. */
function sheetWith(mods: ModuleDef[], parts: PartInstance[], wires: Wire[]): Diagram {
  const ids = new Set(mods.map((m) => m.id))
  const d = sheet(parts.filter((p) => !ids.has(p.module)), wires)
  return { ...d, parts, modules: { ...d.modules, ...Object.fromEntries(mods.map((m) => [m.id, m])) } }
}

describe('grounds are joined only where the module says so', () => {
  it('a pass-through part with two separate grounds: a cell between them is not a short', () => {
    const thru = custom({
      id: 'thru', pins: [
        { name: 'IN', side: 'left', type: 'power_in', supply: '5V' }, { name: 'G1', side: 'left', type: 'ground' },
        { name: 'OUT', side: 'right', type: 'power_out', supply: '5V' }, { name: 'G2', side: 'right', type: 'ground' },
      ], internal: [['IN', 'OUT']],
    })
    const d = sheetWith([thru], [at('u1', 'U1', 'thru'), at('bt1', 'BT1', 'battery-aa', 300)], [['bt1|+', 'u1|G1'], ['bt1|-', 'u1|G2']])
    expect(rules(d)).not.toContain('short')
  })
  it('the TP4056 declares B- and OUT- one return (across its protection switch)', () => {
    expect((load('tp4056-module').electrical as { commonReturn?: unknown }).commonReturn).toEqual([['B-', 'OUT-']])
  })
})

/** An adjustable output with its own ground, like a buck with no value set. */
const adjBuck = () => custom({
  id: 'adj-buck', pins: [{ name: 'OUT+', side: 'right', type: 'power_out', supply: 'ADJ' }, { name: 'OUT-', side: 'right', type: 'ground' }],
})

describe('an unknown voltage anywhere on the path is unknown', () => {
  it('an adjustable supply below a 3 V pack: no "only 3 V"; the setting counts the pack', () => {
    const d = sheetWith([adjBuck()], [at('u2', 'U2', 'adj-buck'), at('bt1', 'BT1', 'battery-holder-2xaa', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['u2|OUT-', 'u1|GND'], ['u2|OUT+', 'bt1|-'], ['bt1|+', 'u1|VCC']])
    expect(found(d)).toEqual([
      'supply-unknown: U2 OUT+ is adjustable; set it so U1 VCC sees 3.3 V: 0.3 V on U2 OUT+, since the other supplies between U1 VCC and U1 GND add 3 V.',
    ])
  })
  it('two unknowns on the path: it cannot be checked', () => {
    const d = sheetWith([adjBuck()], [at('u2', 'U2', 'adj-buck'), at('u3', 'U3', 'adj-buck', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['u2|OUT-', 'u1|GND'], ['u2|OUT+', 'u3|OUT-'], ['u3|OUT+', 'u1|VCC']])
    expect(found(d)).toEqual(['supply-unknown: U1 VCC voltage depends on U2 OUT+ (adjustable) and U3 OUT+ (adjustable) and cannot be checked.'])
  })
  it('a 3 V pack below an adjustable supply: the setting advice accounts for the pack', () => {
    const d = sheetWith([adjBuck()], [at('bt1', 'BT1', 'battery-holder-2xaa'), at('u2', 'U2', 'adj-buck', 200), at('u1', 'U1', 'bme280-module-4pin', 400)],
      [['bt1|-', 'u1|GND'], ['bt1|+', 'u2|OUT-'], ['u2|OUT+', 'u1|VIN']])
    expect(found(d)).toEqual([
      'supply-unknown: U2 OUT+ is adjustable; set it so U1 VIN sees 3.3 V or 5 V: 0.3 V or 2 V on U2 OUT+, since the other supplies between U1 VIN and U1 GND add 3 V.',
    ])
  })
  it('a pack too high for any setting of the adjustable above it is not advised', () => {
    const d = sheetWith([adjBuck()], [at('bt1', 'BT1', 'battery-9v'), at('u2', 'U2', 'adj-buck', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['bt1|-', 'u1|GND'], ['bt1|+', 'u2|OUT-'], ['u2|OUT+', 'u1|VCC']])
    expect(found(d)).toEqual(['supply-unknown: U1 VCC voltage depends on U2 OUT+ (adjustable) and cannot be checked.'])
  })
})

describe("a load whose ground does not reach its supply's return", () => {
  it('two 3 V packs in series, the sensor ground unwired: only the missing ground, no "only 3 V"', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-holder-2xaa'), at('bt2', 'BT2', 'battery-holder-2xaa', 200), at('u1', 'U1', 'bme280-module-4pin', 400)],
      [['bt1|+', 'bt2|-'], ['bt2|+', 'u1|VIN'], ['u1|SDA', 'bt1|-']])
    expect(rules(d)).toEqual(['no-ground'])
  })
  it('a sensor grounded to a board that the battery never returns to: it cannot be checked', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-6pin', 400), at('bt1', 'BT1', 'battery-9v', 700)],
      [['u2|GND', 'u1|GND'], ['bt1|+', 'u2|VCC'], ['u2|SDA', 'u1|D21']])
    expect(found(d)).toEqual([
      'no-ground: BT1 has no ground: connect -.',
      'supply-unknown: U2 VCC voltage cannot be checked: U2 GND does not connect back to the return of BT1 +.',
    ])
  })
})

describe('each output returns to a known ground, or nothing definite is said', () => {
  const twin = (returns?: Record<string, string>) => custom({
    id: 'twin-iso', pins: [
      { name: 'A', side: 'right', type: 'power_out', supply: '5V' }, { name: 'GA', side: 'right', type: 'ground' },
      { name: 'B', side: 'right', type: 'power_out', supply: '5V' }, { name: 'GB', side: 'right', type: 'ground' },
    ], ...(returns ? { electrical: { returns } } : {}),
  })
  const wires: Wire[] = [['bt1|-', 'u2|GA'], ['bt1|+', 'u2|GB'], ['u2|B', 'u3|VCC'], ['u3|GND', 'u2|GA']]
  const parts = [at('u2', 'U2', 'twin-iso'), at('bt1', 'BT1', 'battery-holder-2xaa', 200), at('u3', 'U3', 'oled-ssd1306-096-i2c', 400)]
  it('two isolated outputs with no returns declared: the load cannot be checked', () => {
    expect(found(sheetWith([twin()], parts, wires))).toEqual(['supply-unknown: U3 VCC voltage depends on U2 B (its return is not known) and cannot be checked.'])
  })
  it('with returns declared, output B sits on the pack: 8 V is too high', () => {
    expect(found(sheetWith([twin({ A: 'GA', B: 'GB' })], parts, wires))).toEqual([
      'supply-too-high: U3 VCC accepts up to 5 V but gets 8 V from BT1 + and U2 B in series.',
    ])
  })
  it('every Pico output and USB pin returns to GND, not AGND', () => {
    for (const id of ['rpi-pico', 'rpi-pico-h', 'rpi-pico-w', 'rpi-pico-2', 'rpi-pico-2-w'])
      expect((load(id).electrical as { returns?: unknown }).returns).toEqual({ '3V3(OUT)': 'GND', VBUS: 'GND', VSYS: 'GND' })
  })
})

describe('a fight stays with the nets it touches', () => {
  it('a 3 V pack against Nano USB on 5V, and a 9 V battery into a BME280, one ground: both are found', () => {
    const d = sheet([at('u1', 'U1', 'arduino-nano'), at('bt1', 'BT1', 'battery-holder-2xaa', 300), at('bt2', 'BT2', 'battery-9v', 500), at('u2', 'U2', 'bme280-module-6pin', 700)],
      [['bt1|+', 'u1|5V'], ['bt1|-', 'u1|GND'], ['bt2|-', 'u1|GND 2'], ['bt2|+', 'u2|VCC'], ['u2|GND', 'u1|GND']])
    expect(rules(d)).toEqual(['supplies-fight', 'supply-too-high'])
  })
  it('two cells fighting, and a 9 V battery into a BME280, one ground: both are found; a load on the fight is not', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-holder-2xaa'), at('bt3', 'BT3', 'battery-18650-holder', 200), at('bt2', 'BT2', 'battery-9v', 500),
      at('u2', 'U2', 'bme280-module-6pin', 700), at('u3', 'U3', 'oled-ssd1306-096-i2c', 900)],
    [['bt1|+', 'bt3|+'], ['bt1|-', 'bt3|-'], ['bt2|-', 'bt1|-'], ['bt2|+', 'u2|VCC'], ['u2|GND', 'bt1|-'], ['u3|VCC', 'bt1|+'], ['u3|GND', 'bt1|-']])
    expect(found(d)).toEqual([
      'supplies-fight: BT3 + (3.7 V) and BT1 + (3 V) are wired together: the two supplies fight.',
      'supply-too-high: U2 VCC accepts up to 3.3 V but gets 9 V from BT2 +.',
    ])
  })
})
