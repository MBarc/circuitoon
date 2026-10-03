// The wiring checker on real hobby circuits built from the built-in parts: what a correct hookup
// must not be nagged about, and the damaging ones it must catch. From the Claude review's
// realistic-circuit sheets, with the findings the review rulings expect.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RULES, checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { type ModuleDef, externalPower, validateModule } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { at as mat, dupont, sheet as mainsSheet, w as mw } from './mains.testing.ts'

type Wire = [string, string]
let n = 0
/** A sheet of built-in parts; a wire end is "uid|pin" or "uid|group|hole". */
function sheet(parts: PartInstance[], wires: Wire[]): Diagram {
  return built(rawSheet(parts, wires))
}
function rawSheet(parts: PartInstance[], wires: Wire[]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  for (const p of parts) modules[p.module] = load(p.module)
  const ep = (s: string) => {
    const [part, pin, hole] = s.split('|')
    return hole === undefined ? { part, pin } : { part, pin, hole: Number(hole) }
  }
  const connections: Connection[] = wires.map(([a, b]) => ({ uid: `w${++n}`, from: ep(a), to: ep(b) }))
  return { format: 'circuitoon-diagram/1', title: 't', modules, parts, connections }
}
/** Every sheet the tests build, for the order-independence property at the end. */
const fixtures: Diagram[] = []
const built = (d: Diagram) => (fixtures.push(d), d)
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
    // Only a note (never a problem): no second source says whether the 4-pin BME280 board has I2C pull-ups.
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}`)).toEqual(['info i2c-pullups-unknown'])
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
    `supplies-fight: When USB is plugged in, U2 ${pin} gets 5 V from USB, which pushes current back into ${what} (${v}) and can damage the cells. Add a diode from ${what} + to ${pin}, or unplug ${what} before plugging in USB.`
  it('a pin wired straight to USB (Pico VBUS): an LM2596 at 5 V is a warning not to power both', () => {
    expect(found(lm2596(5, 'rpi-pico', 'VBUS'))).toEqual(['supplies-parallel: U2 VBUS also gets 5 V from USB; do not power VBUS and USB at the same time.'])
  })
  it('a pin behind the USB diode (ESP32 VIN): an LM2596 at 5 V, set or default, is fine', () => {
    expect(found(lm2596(5, 'esp32-devkit-v1-30', 'VIN'))).toEqual([])
    const d = sheet([at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module'), at('u2', 'U2', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
    expect(found(d)).toEqual([])
  })
  it('an LM2596 at 15 V into ESP32 VIN: the diode blocks USB, and VIN is fed too much', () => {
    expect(checkDiagram(lm2596(15, 'esp32-devkit-v1-30', 'VIN')).map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error supply-too-high: U2 VIN accepts up to 12 V but U1 OUT+ is set to 15 V. Set U1 to 12 V or move the wire to a 12 V pin.',
    ])
  })
  it('an LM2596 at 5.2 V into Pico VSYS is fine (VSYS takes up to 5.5 V); at 6 V it is too high', () => {
    expect(found(lm2596(5.2, 'rpi-pico', 'VSYS'))).toEqual([])
    expect(found(lm2596(6, 'rpi-pico', 'VSYS'))).toEqual(['supply-too-high: U2 VSYS accepts up to 5.5 V but U1 OUT+ is set to 6 V. Set U1 to 5.5 V or move the wire to a 5.5 V pin.'])
  })
  it('an 18650 into Pico VSYS: USB pushes current into the cell through the diode', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-18650-holder'), at('u2', 'U2', 'rpi-pico', 400)], [['bt1|+', 'u2|VSYS'], ['bt1|-', 'u2|GND']])
    expect(found(d)).toEqual([pushes('VSYS', 'BT1', '3.7 V')])
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
    expect(found(d)).toEqual([pushes('VIN', 'BT1', '3.7 V')])
  })
  it('a 3.7 V cell into a Nano 5V pin: USB pushes current into the cell', () => {
    const d = sheet([at('u2', 'U2', 'arduino-nano'), at('bt1', 'BT1', 'battery-18650-holder', 400)], [['bt1|+', 'u2|5V'], ['bt1|-', 'u2|GND']])
    expect(found(d)).toEqual([pushes('5V', 'BT1', '3.7 V')])
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
      'error supply-too-high: U1 VCC accepts up to 3.3 V but gets 6 V from BT1 + and BT2 + in series. Use a 3.3 V supply instead.',
    ])
  })
  it('two cells wired + to - both ways round are a shorted stack', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-aa'), at('bt2', 'BT2', 'battery-aa', 200)], [['bt1|+', 'bt2|-'], ['bt2|+', 'bt1|-']])
    expect(checkDiagram(d).map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error short: BT1 + and BT2 + are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: BT1 + to BT2 -, or BT2 + to BT1 -.',
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
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 VSYS (USB). Move the wire to a 3.3 V pin.'])
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
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 5V. Use a 3.3 V supply instead.'])
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
      'error supplies-fight: U2 5V+ (5 V) and U1 3V3 (3.3 V) are wired together: the two supplies fight, and the higher one drives current into the lower one, which can damage both. Remove the wire from U2 5V+ to U1 3V3.',
    ])
  })
  it('a 9 V battery into ESP32-C3 3.3 fights its regulator', () => {
    const d = sheet([at('u1', 'U1', 'esp32-c3-supermini'), at('bt1', 'BT1', 'battery-9v', 400)], [['bt1|+', 'u1|3.3'], ['bt1|-', 'u1|G']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}`)).toEqual(['error supplies-fight'])
  })
  it('a battery + to a board ground that leads back to its - is a short', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('bt1', 'BT1', 'battery-18650-holder', 400)], [['bt1|+', 'u1|GND'], ['bt1|-', 'u1|GND 2']])
    expect(found(d)).toEqual(['short: BT1 + is wired to U1 GND, which leads back to BT1 -: short circuit. Nothing limits the current, so BT1 and the wires can overheat. Remove the wire from BT1 + to U1 GND.'])
  })
  it('a Nano on USB, its 5V pin into ESP32 3V3: USB pushes current into the 3.3 V rail through the diode', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'arduino-nano', 400)], [['u2|5V', 'u1|3V3'], ['u2|GND', 'u1|GND']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error supplies-fight: When USB is plugged in, U2 5V gets 5 V from USB, which pushes current back into U1 3V3 (3.3 V) and can damage it. Remove the wire from U2 5V to U1 3V3.',
    ])
  })
  it('ESP32 VIN (USB 5 V) into a 3.3 V only BME280 is too high', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u2|VCC', 'u1|VIN'], ['u2|GND', 'u1|GND']])
    expect(found(d)).toEqual(['supply-too-high: U2 VCC accepts up to 3.3 V but gets 5 V from U1 VIN (USB). Move the wire to a 3.3 V pin.'])
  })
  it('two sensors with their VCCs tied only to each other have no power', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-4pin', 400), at('u3', 'U3', 'oled-ssd1306-096-i2c', 700)], [
      ['u2|VIN', 'u3|VCC'], ['u2|GND', 'u1|GND'], ['u3|GND', 'u1|GND 2'],
      ['u2|SDA', 'u1|D21'], ['u2|SCL', 'u1|D22'], ['u3|SDA', 'u1|D21'], ['u3|SCL', 'u1|D22'],
    ])
    expect(found(d)).toEqual([
      "no-power: U2 has no power: VIN is connected but nothing supplies it. Connect it to a 3.3 V or 5 V supply, such as a board's 3V3 or 5V pin.",
      "no-power: U3 has no power: VCC is connected but nothing supplies it. Connect it to a 3.3 V or 5 V supply, such as a board's 3V3 or 5V pin.",
      'i2c-pullups-unknown: The I2C bus at U1 D21 (SDA) and U1 D22 (SCL), with U2 and U3 on it, has no pull-up resistor wired on SDA and SCL, and it is not known whether U2 and U3 have pull-ups on board: check whether a module provides pull-ups; if none does, add a 4.7 kOhm resistor from SDA and another from SCL to the logic supply.',
    ])
  })
  it('sensors on a breadboard + rail that is never jumpered to a supply have no power', () => {
    const d = sheet([
      at('bb', 'BB1', 'breadboard-half', 0, { y: 300 }), at('u1', 'U1', 'rpi-pico', 400), at('u2', 'U2', 'bme280-module-6pin', 700), at('u3', 'U3', 'oled-ssd1306-096-i2c', 900),
    ], [['u1|GND', 'bb|top-|0'], ['u2|VCC', 'bb|top+|3'], ['u2|GND', 'bb|top-|3'], ['u3|VCC', 'bb|top+|5'], ['u3|GND', 'bb|top-|5']])
    expect(found(d)).toEqual([
      "no-power: U2 has no power: VCC is connected but nothing supplies it. U2 VCC needs 3.3 V and U3 VCC accepts 3.3 V or 5 V: connect it to a 3.3 V supply, such as a board's 3V3 pin.",
      "no-power: U3 has no power: VCC is connected but nothing supplies it. U2 VCC needs 3.3 V and U3 VCC accepts 3.3 V or 5 V: connect it to a 3.3 V supply, such as a board's 3V3 pin.",
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
  const d = rawSheet(parts.filter((p) => !ids.has(p.module)), wires)
  return built({ ...d, parts, modules: { ...d.modules, ...Object.fromEntries(mods.map((m) => [m.id, m])) } })
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
    expect(found(d)).toEqual(['supply-unknown: U1 VCC voltage depends on U2 OUT+ (adjustable) and U3 OUT+ (adjustable) and cannot be checked. Give U2 OUT+ and U3 OUT+ a voltage (set its value, or a supply in its module) to check it.'])
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
    expect(found(d)).toEqual(['supply-unknown: U1 VCC voltage depends on U2 OUT+ (adjustable) and cannot be checked. Give U2 OUT+ a voltage (set its value, or a supply in its module) to check it.'])
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
      'supply-unknown: U2 GND is not connected to BT1 -, the ground of the supply feeding U2 VCC: connect them.',
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
    expect(found(sheetWith([twin()], parts, wires))).toEqual(['supply-unknown: U3 VCC voltage depends on U2 B (its return is not known) and cannot be checked. Say in the module of U2 which ground B returns to (electrical.returns) to check it.'])
  })
  it('with returns declared, output B sits on the pack: 8 V is too high', () => {
    expect(found(sheetWith([twin({ A: 'GA', B: 'GB' })], parts, wires))).toEqual([
      'supply-too-high: U3 VCC accepts up to 5 V but gets 8 V from BT1 + and U2 B in series. Use a 5 V supply instead.',
    ])
  })
  it('a Pico sensor grounded on AGND is fine: AGND is a GND pin (one ground component, no returns needed)', () => {
    const d = sheet([at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u1|3V3(OUT)', 'u2|VCC'], ['u1|AGND', 'u2|GND']])
    expect(found(d)).toEqual([])
    for (const id of ['rpi-pico', 'rpi-pico-h', 'rpi-pico-w', 'rpi-pico-2', 'rpi-pico-2-w'])
      expect((load(id).electrical as { returns?: unknown }).returns).toBeUndefined()
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
      'supplies-fight: BT3 + (3.7 V) and BT1 + (3 V) are wired together: the two supplies fight, and the higher one drives current into the lower one, which can damage both. Remove the wire from BT1 + to BT3 +.',
      'supply-too-high: U2 VCC accepts up to 3.3 V but gets 9 V from BT2 +. Use a 3.3 V supply instead.',
    ])
  })
})

// The hobbyist review's sheets (built-in parts only). Each case: parts, wires, the rules expected.
type Case = [name: string, parts: PartInstance[], wires: Wire[], expected: string[]]
const bb = () => at('bb', 'BB1', 'breadboard-half', 0, { y: 400 })
const set = (v: number) => volts(v)
const hobby: Case[] = [
  ['C1 ESP32 V1 + BME280-4 via breadboard rails on 3V3', [at('u1', 'U1', 'esp32-devkit-v1-30', -400), bb(), at('u2', 'U2', 'bme280-module-4pin', 500)],
    [['u1|3V3', 'bb|top+|0'], ['u1|GND', 'bb|top-|0'], ['u2|VIN', 'bb|top+|5'], ['u2|GND', 'bb|top-|5'], ['u2|SDA', 'u1|D21'], ['u2|SCL', 'u1|D22']], ['i2c-pullups-unknown']],
  ['C2 ESP32-S3 + BME280-6 + SSD1306 on 3V3', [at('u1', 'U1', 'esp32-s3-devkitc-1'), at('u2', 'U2', 'bme280-module-6pin', 400), at('u3', 'U3', 'oled-ssd1306-096-i2c', 600)],
    [['u2|VCC', 'u1|3V3'], ['u2|GND', 'u1|G'], ['u3|VCC', 'u2|VCC'], ['u3|GND', 'u1|G 2'], ['u2|SDA', 'u1|8'], ['u2|SCL', 'u1|9'], ['u3|SDA', 'u2|SDA'], ['u3|SCL', 'u2|SCL']], []],
  ['C6 Nano + HC-SR04 + SG90 + relay on 5V', [at('u1', 'U1', 'arduino-nano'), at('u2', 'U2', 'ultrasonic-hc-sr04', 400), at('m1', 'M1', 'servo-sg90', 600), at('k1', 'K1', 'relay-module-1ch-5v', 800)],
    [['u2|VCC', 'u1|5V'], ['u2|GND', 'u1|GND'], ['m1|VCC', 'u1|5V'], ['m1|GND', 'u1|GND 2'], ['m1|PWM', 'u1|D9'], ['k1|DC+', 'u1|5V'], ['k1|DC-', 'u1|GND'], ['k1|IN', 'u1|D7'], ['u2|Trig', 'u1|D2'], ['u2|Echo', 'u1|D3']], []],
  ['C9 L298N on 2S 18650, ESP32 drives IN1..4, common ground', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'l298n-module', 400), at('bt1', 'BT1', 'battery-18650-holder-2s', 700)],
    [['bt1|+', 'u2|+12V'], ['bt1|-', 'u2|GND'], ['u2|GND', 'u1|GND'], ['u2|IN1', 'u1|D25'], ['u2|IN2', 'u1|D26'], ['u2|IN3', 'u1|D27'], ['u2|IN4', 'u1|D14']], []],
  ['C14 4xAA > rocker switch > SG90, ESP32 on USB, common ground', [at('bt1', 'BT1', 'battery-holder-4xaa'), at('s1', 'S1', 'rocker-switch-kcd1', 300), at('m1', 'M1', 'servo-sg90', 600), at('u1', 'U1', 'esp32-devkit-v1-30', 900)],
    [['bt1|+', 's1|1'], ['s1|2', 'm1|VCC'], ['bt1|-', 'm1|GND'], ['m1|GND', 'u1|GND'], ['m1|PWM', 'u1|D13']], []],
  ['C16 Nano 5V to ESP32 V1 VIN, both behind USB diodes', [at('u1', 'U1', 'arduino-nano'), at('u2', 'U2', 'esp32-devkit-v1-30', 500)], [['u1|5V', 'u2|VIN'], ['u1|GND', 'u2|GND']], []],
  ['C18 D1 mini 5V also fed by an LM2596 at 5 V', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300, set(5)), at('u2', 'U2', 'wemos-d1-mini', 600)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|5V'], ['u1|OUT-', 'u2|GND']], []],
  ['W1 reversed rail: ESP32 3V3 on top-, GND on top+, BME280 by the marks', [at('u1', 'U1', 'esp32-devkit-v1-30', -400), bb(), at('u2', 'U2', 'bme280-module-4pin', 500)],
    [['u1|3V3', 'bb|top-|0'], ['u1|GND', 'bb|top+|0'], ['u2|VIN', 'bb|top+|5'], ['u2|GND', 'bb|top-|5']], ['reversed']],
  ['W2 HC-SR04 on ESP32 3V3', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'ultrasonic-hc-sr04', 400)], [['u2|VCC', 'u1|3V3'], ['u2|GND', 'u1|GND']], ['supply-too-low']],
  ['W3 BME280-6 on Nano 5V', [at('u1', 'U1', 'arduino-nano'), at('u2', 'U2', 'bme280-module-6pin', 400)], [['u2|VCC', 'u1|5V'], ['u2|GND', 'u1|GND']], ['supply-too-high']],
  ['W4 WS2812 DIN from a 3.3 V GPIO (not checked)', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('l1', 'L1', 'ws2812b-strip', 400)], [['l1|5V', 'u1|VIN'], ['l1|GND', 'u1|GND'], ['l1|DIN', 'u1|D5']], []],
  ['W5 9 V battery, both leads in the + rail', [at('bt1', 'BT1', 'battery-9v', -400), bb()], [['bt1|+', 'bb|top+|0'], ['bt1|-', 'bb|top+|3']], ['short']],
  ['W5b 9 V on the rails, then a jumper + rail to - rail', [at('bt1', 'BT1', 'battery-9v', -400), bb(), at('u2', 'U2', 'servo-sg90', 500)],
    [['bt1|+', 'bb|top+|0'], ['bt1|-', 'bb|top-|0'], ['bb|top+|10', 'bb|top-|11'], ['u2|VCC', 'bb|top+|5'], ['u2|GND', 'bb|top-|5']], ['short']],
  ['W6 ESP32 3V3 tied to Pico 3V3(OUT)', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'rpi-pico', 500)], [['u1|3V3', 'u2|3V3(OUT)'], ['u1|GND', 'u2|GND']], ['supplies-parallel']],
  ['W7 servo on 4xAA, PWM from an ESP32 with no ground wired', [at('bt1', 'BT1', 'battery-holder-4xaa'), at('m1', 'M1', 'servo-sg90', 300), at('u1', 'U1', 'esp32-devkit-v1-30', 600)],
    [['bt1|+', 'm1|VCC'], ['bt1|-', 'm1|GND'], ['m1|PWM', 'u1|D13']], ['no-ground']],
  ['W7b LM2596 powers a sensor whose GND goes only to the ESP32', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300), at('u2', 'U2', 'bme280-module-4pin', 600), at('u3', 'U3', 'esp32-devkit-v1-30', 900)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u2|GND', 'u3|GND'], ['u2|SDA', 'u3|D21']], ['supply-unknown']],
  ['W8 sensors on the bottom rails, 3V3 into the top rail', [at('u1', 'U1', 'esp32-devkit-v1-30', -400), bb(), at('u2', 'U2', 'bme280-module-4pin', 500), at('u3', 'U3', 'oled-ssd1306-096-i2c', 700)],
    [['u1|3V3', 'bb|top+|0'], ['u1|GND', 'bb|top-|0'], ['u2|VIN', 'bb|bottom+|5'], ['u2|GND', 'bb|bottom-|5'], ['u3|VCC', 'bb|bottom+|9'], ['u3|GND', 'bb|bottom-|9'], ['u2|SDA', 'u1|D21']],
    ['no-ground', 'no-power', 'no-power']],
  ['W9 9 V straight into ESP32 3V3', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'esp32-devkit-v1-30', 400)], [['bt1|+', 'u1|3V3'], ['bt1|-', 'u1|GND']], ['supplies-fight']],
  ['W10 LM2596 at 7.4 V into an SG90', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300, set(7.4)), at('m1', 'M1', 'servo-sg90', 600)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'm1|VCC'], ['u1|OUT-', 'm1|GND']], ['supply-too-high']],
  ['W11 Nano 5V into Pico 3V3(OUT)', [at('u1', 'U1', 'arduino-nano'), at('u2', 'U2', 'rpi-pico', 400)], [['u1|5V', 'u2|3V3(OUT)'], ['u1|GND', 'u2|GND']], ['supplies-fight']],
  ['W12 9 V reversed into an LM2596', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300), at('u2', 'U2', 'esp32-devkit-v1-30', 600)],
    [['bt1|+', 'u1|IN-'], ['bt1|-', 'u1|IN+'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']], ['reversed']],
  ['W13 OLED VCC and GND swapped', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'oled-ssd1306-096-i2c', 400)], [['u2|GND', 'u1|3V3'], ['u2|VCC', 'u1|GND']], ['reversed']],
  ['W14 level shifter swapped: LV on 5V, HV on 3V3', [at('u1', 'U1', 'esp32-devkitc-v4'), at('u2', 'U2', 'level-shifter-bss138-4ch', 400)],
    [['u2|LV', 'u1|5V'], ['u2|HV', 'u1|3V3'], ['u2|GND', 'u1|GND']], ['supply-too-high']],
  ['W15 9 V and 4xAA on one rail', [at('bt1', 'BT1', 'battery-9v'), at('bt2', 'BT2', 'battery-holder-4xaa', 300), at('m1', 'M1', 'servo-sg90', 600)],
    [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['m1|VCC', 'bt1|+'], ['m1|GND', 'bt1|-']], ['supplies-fight']],
  ['W16 WS2812 strip on 4xAA (6 V): one row for its joined 5V pins', [at('bt1', 'BT1', 'battery-holder-4xaa'), at('l1', 'L1', 'ws2812b-strip', 400)], [['bt1|+', 'l1|5V'], ['bt1|-', 'l1|GND']], ['supply-too-high']],
  ['W17 9 V through a rocker switch into a BME280-6', [at('bt1', 'BT1', 'battery-9v'), at('s1', 'S1', 'rocker-switch-kcd1', 300), at('u2', 'U2', 'bme280-module-6pin', 600)],
    [['bt1|+', 's1|1'], ['s1|2', 'u2|VCC'], ['bt1|-', 'u2|GND']], ['supply-too-high']],
  ['W18 18650 reversed in a TP4056', [at('bt1', 'BT1', 'battery-18650-holder'), at('u1', 'U1', 'tp4056-module', 300)], [['bt1|+', 'u1|B-'], ['bt1|-', 'u1|B+']], ['reversed']],
  ['W19 5 V microSD module on ESP32 3V3', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'microsd-spi-5v', 400)], [['u2|VCC', 'u1|3V3'], ['u2|GND', 'u1|GND']], ['supply-too-low']],
  ['W20 DevKitC 5V into Pico VSYS, both on USB', [at('u1', 'U1', 'esp32-devkitc-v4'), at('u2', 'U2', 'rpi-pico', 400)], [['u1|5V', 'u2|VSYS'], ['u1|GND', 'u2|GND']], []],
  ['W21 3V3 jumpered to GND on one board', [at('u1', 'U1', 'esp32-c3-supermini')], [['u1|3.3', 'u1|G']], ['short']],
  ['W22 AMS1117 fed backwards from ESP32 3V3', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'ams1117-33-module', 400), at('u3', 'U3', 'bme280-module-6pin', 700)],
    [['u2|OUT', 'u1|3V3'], ['u2|GND', 'u1|GND'], ['u3|VCC', 'u2|VIN'], ['u3|GND', 'u2|GND']], ['supplies-parallel', 'no-power']],
  ['W23 relay DC+ on ESP32 3V3', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('k1', 'K1', 'relay-module-1ch-5v', 400)], [['k1|DC+', 'u1|3V3'], ['k1|DC-', 'u1|GND'], ['k1|IN', 'u1|D23']], ['supply-too-low']],
  ['W24 PIR on XIAO 3V3', [at('u1', 'U1', 'xiao-esp32s3'), at('u2', 'U2', 'pir-hc-sr501', 400)], [['u2|VCC', 'u1|3V3'], ['u2|GND', 'u1|GND']], ['supply-too-low']],
  ['W25 2S 18650 into Pico 2 VSYS', [at('bt1', 'BT1', 'battery-18650-holder-2s'), at('u1', 'U1', 'rpi-pico-2', 400)], [['bt1|+', 'u1|VSYS'], ['bt1|-', 'u1|GND']], ['supply-too-high']],
  ['W26 L298N +5V to Nano 5V, 9 V on both', [at('bt1', 'BT1', 'battery-9v'), at('u2', 'U2', 'l298n-module', 300), at('u1', 'U1', 'arduino-nano', 600)],
    [['bt1|+', 'u2|+12V'], ['bt1|-', 'u2|GND'], ['u2|+5V', 'u1|5V'], ['u2|GND', 'u1|GND'], ['u1|VIN', 'bt1|+']], []],
  ['W27 sensor between battery + and ESP32 GND, battery - unwired', [at('bt1', 'BT1', 'battery-holder-3xaaa'), at('u2', 'U2', 'oled-ssd1306-096-i2c', 300), at('u1', 'U1', 'esp32-devkit-v1-30', 600)],
    [['bt1|+', 'u2|VCC'], ['u2|GND', 'u1|GND']], ['no-ground', 'supply-unknown']],
  ['W28 TP4056 OUT+ into ESP32 3V3', [at('bt1', 'BT1', 'battery-18650-holder'), at('u1', 'U1', 'tp4056-module', 300), at('u2', 'U2', 'esp32-devkit-v1-30', 600)],
    [['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-'], ['u1|OUT+', 'u2|3V3'], ['u1|OUT-', 'u2|GND']], ['supplies-fight']],
  ['X1 L298N (5V jumper fitted) on 24 V: above the 12 V the module guide allows with the jumper on', [at('bt1', 'BT1', 'battery-18650-holder-2s', 0, set(24)), at('u2', 'U2', 'l298n-module', 400)],
    [['bt1|+', 'u2|+12V'], ['bt1|-', 'u2|GND']], ['supply-too-high']],
  ['X2 servo on 4xAA, PWM from a grounded ESP32, no common ground', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'bme280-module-4pin', 300), at('bt1', 'BT1', 'battery-holder-4xaa', 600), at('m1', 'M1', 'servo-sg90', 900)],
    [['u2|VIN', 'u1|3V3'], ['u2|GND', 'u1|GND'], ['bt1|+', 'm1|VCC'], ['bt1|-', 'm1|GND'], ['m1|PWM', 'u1|D13']], ['no-common-ground']],
  ['X3 WS2812 strip fed at both ends from ESP32 VIN', [at('u1', 'U1', 'esp32-devkit-v1-30'), at('l1', 'L1', 'ws2812b-strip', 400)],
    [['l1|5V', 'u1|VIN'], ['l1|GND', 'u1|GND'], ['l1|5V 2', 'u1|VIN'], ['l1|GND 2', 'u1|GND 2'], ['l1|DIN', 'u1|D5']], []],
  ['X4 reversed rail, one sensor by the marks and one wired right', [at('u1', 'U1', 'esp32-devkit-v1-30', -400), bb(), at('u2', 'U2', 'bme280-module-4pin', 500), at('u3', 'U3', 'oled-ssd1306-096-i2c', 700)],
    [['u1|3V3', 'bb|top-|0'], ['u1|GND', 'bb|top+|0'], ['u2|VIN', 'bb|top+|5'], ['u2|GND', 'bb|top-|5'], ['u3|VCC', 'bb|top-|9'], ['u3|GND', 'bb|top+|9']], ['reversed']],
  ['X5 9 V into Nano VIN', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'arduino-nano', 400)], [['bt1|+', 'u1|VIN'], ['bt1|-', 'u1|GND']], []],
  ['X6 9 V into ESP32 V1 VIN (its regulator takes up to 15 V)', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'esp32-devkit-v1-30', 400)], [['bt1|+', 'u1|VIN'], ['bt1|-', 'u1|GND']], []],
  ['X7 USB-C panel into TP4056, cell on B', [at('j1', 'J1', 'usb-panel-mount-usbc'), at('u1', 'U1', 'tp4056-module', 300), at('bt1', 'BT1', 'battery-18650-cell', 600)],
    [['j1|VBUS', 'u1|IN+'], ['j1|GND', 'u1|IN-'], ['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-']], []],
  ['X8 USB-C panel VBUS into ESP32-C3 5V', [at('j1', 'J1', 'usb-panel-mount-usbc'), at('u1', 'U1', 'esp32-c3-supermini', 300)], [['j1|VBUS', 'u1|5V'], ['j1|GND', 'u1|G']], []],
  ['X9 CR2032 holder powering a BME280-6', [at('bt1', 'BT1', 'battery-holder-cr2032'), at('u1', 'U1', 'bme280-module-6pin', 300)], [['bt1|+', 'u1|VCC'], ['bt1|-', 'u1|GND']], []],
  ['X10 two LM2596 in parallel at 5 V', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300), at('u2', 'U2', 'lm2596-buck-module', 600), at('m1', 'M1', 'servo-sg90', 900)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['bt1|+', 'u2|IN+'], ['bt1|-', 'u2|IN-'], ['u1|OUT+', 'u2|OUT+'], ['u1|OUT-', 'm1|GND'], ['u1|OUT+', 'm1|VCC']], ['supplies-parallel']],
  ['X11 LM2596 at its default 5 V into a BME280-6', [at('bt1', 'BT1', 'battery-9v'), at('u1', 'U1', 'lm2596-buck-module', 300), at('u2', 'U2', 'bme280-module-6pin', 600)],
    [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VCC'], ['u1|OUT-', 'u2|GND']], ['supply-too-high']],
  ['X12 Pico 3V3(OUT) into ESP32 VIN', [at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'esp32-devkit-v1-30', 400)], [['u1|3V3(OUT)', 'u2|VIN'], ['u1|GND', 'u2|GND']], ['supplies-fight']],
  ['X13 ESP32-S3 5V into BME280-4 and HC-SR04', [at('u1', 'U1', 'esp32-s3-devkitc-1'), at('u2', 'U2', 'bme280-module-4pin', 400), at('u3', 'U3', 'ultrasonic-hc-sr04', 600)],
    [['u2|VIN', 'u1|5V'], ['u2|GND', 'u1|G'], ['u3|VCC', 'u1|5V'], ['u3|GND', 'u1|G 3']], []],
  ...['oled-ssd1306-096-i2c|VCC|GND', 'dht22-module|+|-', 'tft-st7789-154-spi|VCC|GND', 'microsd-spi-3v3|3V3|GND'].map((s): Case => {
    const [m, vcc, gnd] = s.split('|')
    return [`X9b 2xAA (3 V) into ${m}: within 90% of 3.3 V`, [at('bt1', 'BT1', 'battery-holder-2xaa'), at('u1', 'U1', m, 300)], [['bt1|+', `u1|${vcc}`], ['bt1|-', `u1|${gnd}`]], []]
  }),
]

describe('the hobbyist review sheets', () => {
  for (const [name, parts, wires, expected] of hobby)
    it(name, () => {
      expect(rules(sheet(parts, wires))).toEqual(expected)
    })
})

describe('diode-fed USB pins resolve the same whatever the part order', () => {
  // A 3 V pack lifts Nano GND 3 V above Pico GND; Nano 5V (8 V over Pico GND) and Pico VSYS share a
  // net that also feeds a BME280. The Nano's diode wins: the sensor and Pico VSYS both see 8 V.
  const parts = [at('u1', 'U1', 'arduino-nano'), at('u2', 'U2', 'rpi-pico', 300), at('bt1', 'BT1', 'battery-holder-2xaa', 600), at('u3', 'U3', 'bme280-module-4pin', 900)]
  const wires: Wire[] = [['bt1|-', 'u2|GND'], ['bt1|+', 'u1|GND'], ['u1|5V', 'u2|VSYS'], ['u3|VIN', 'u2|VSYS'], ['u3|GND', 'u2|GND 2']]
  it('Nano first or Pico first: the sensor overvoltage and the VSYS limit both appear', () => {
    const a = checkDiagram(sheet(parts, wires))
    const b = checkDiagram(sheet([...parts].reverse(), wires))
    expect(a.map((f) => f.id).sort()).toEqual(b.map((f) => f.id).sort())
    expect(a.map((f) => f.message).sort()).toEqual([
      'U2 VSYS accepts up to 5.5 V but gets 8 V from BT1 + and U1 5V in series. Use a 5.5 V supply instead.',
      'U3 VIN accepts up to 5 V but gets 8 V from BT1 + and U1 5V in series. Use a 5 V supply instead.',
    ])
  })
})

/** A seeded shuffle, so a failure can be replayed. */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list]
  let x = seed
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648
    const j = x % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe("a short needs the supply's own return", () => {
  const two = (returns?: Record<string, string>) => custom({
    id: 'two-gnd', pins: [
      { name: 'A', side: 'right', type: 'power_out', supply: '5V' }, { name: 'GA', side: 'right', type: 'ground' }, { name: 'GB', side: 'right', type: 'ground' },
    ], ...(returns ? { electrical: { returns } } : {}),
  })
  it('output A returns to GB: A wired to GA is no short, A wired to GB is', () => {
    expect(rules(sheetWith([two({ A: 'GB' })], [at('u1', 'U1', 'two-gnd')], [['u1|A', 'u1|GA']]))).not.toContain('short')
    expect(rules(sheetWith([two({ A: 'GB' })], [at('u1', 'U1', 'two-gnd')], [['u1|A', 'u1|GB']]))).toContain('short')
  })
  it('with no return declared among two grounds, no short can be claimed', () => {
    expect(rules(sheetWith([two()], [at('u1', 'U1', 'two-gnd')], [['u1|A', 'u1|GA']]))).not.toContain('short')
  })
})

describe('board GPIOs are signal pins', () => {
  it('two Picos, each powering an OLED, UART between them with no shared ground: no common ground', () => {
    const d = sheet([at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'rpi-pico', 300), at('d1', 'DS1', 'oled-ssd1306-096-i2c', 600), at('d2', 'DS2', 'oled-ssd1306-096-i2c', 900)],
      [['u1|3V3(OUT)', 'd1|VCC'], ['u1|GND', 'd1|GND'], ['u2|3V3(OUT)', 'd2|VCC'], ['u2|GND', 'd2|GND'], ['u1|GP0', 'u2|GP1']])
    expect(rules(d)).toEqual(['no-common-ground'])
  })
  it('the same with the grounds joined is quiet', () => {
    const d = sheet([at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'rpi-pico', 300)], [['u1|GND', 'u2|GND'], ['u1|GP0', 'u2|GP1'], ['u1|GP1', 'u2|GP0']])
    expect(rules(d)).toEqual([])
  })
  it('GPIOs are io (input-only pins input); power, ground, flash and control pins keep their types', () => {
    const type = (id: string, pin: string) => (load(id).pins.find((p) => 'name' in p && p.name === pin) as { type?: string } | undefined)?.type
    expect(['IO23', 'IO0', 'TX', 'RX'].map((n) => type('esp32-devkitc-v4', n))).toEqual(['io', 'io', 'io', 'io'])
    expect(['IO34', 'VP', 'CMD', 'CLK', 'D0'].map((n) => type('esp32-devkitc-v4', n))).toEqual(['input', 'input', undefined, undefined, undefined])
    expect(['D23', 'TX0', 'RX2', 'D34'].map((n) => type('esp32-devkit-v1-30', n))).toEqual(['io', 'io', 'io', 'input'])
    expect(['4', '0', '48', 'TX', 'RST'].map((n) => type('esp32-s3-devkitc-1', n))).toEqual(['io', 'io', 'io', 'io', 'input'])
    expect(['0', '10', '21'].map((n) => type('esp32-c3-supermini', n))).toEqual(['io', 'io', 'io'])
    for (const id of ['xiao-esp32c3', 'xiao-esp32s3']) expect(['D0', 'D10'].map((n) => type(id, n))).toEqual(['io', 'io'])
    expect(['IO4', 'U0R', 'U0T', 'GND/R'].map((n) => type('esp32-cam', n))).toEqual(['io', 'io', 'io', 'passive'])
    expect(['D2', 'D13', 'A0', 'A5', 'RX0', 'TX1', 'A6', 'REF'].map((n) => type('arduino-nano', n === 'REF' ? 'AREF' : n))).toEqual(['io', 'io', 'io', 'io', 'io', 'io', 'input', 'input'])
    expect(['D0', 'D8', 'TX', 'RX', 'A0', 'RST'].map((n) => type('wemos-d1-mini', n))).toEqual(['io', 'io', 'io', 'io', 'input', 'input'])
    for (const id of ['rpi-pico', 'rpi-pico-h', 'rpi-pico-w', 'rpi-pico-2', 'rpi-pico-2-w'])
      expect(['GP0', 'GP28/ADC2', 'SWDIO', 'RUN'].map((n) => type(id, n))).toEqual(['io', 'io', undefined, 'input'])
    expect(['P13', 'P0', 'RX', 'TX', 'SD2', 'CMD', 'P34'].map((n) => type('esp32-terminal-board-38', n))).toEqual(['io', 'io', 'io', 'io', undefined, undefined, 'input'])
  })
})

describe('mains sheets (synthetic parts): every mains rule is reached, and its message is checked below', () => {
  /** A mains sheet from the synthetic fixtures, registered for the checks at the end of this file. */
  const mains = (parts: PartInstance[], wires: Connection[]) => built(mainsSheet(parts, wires))
  const has = (d: Diagram, rule: string) => expect(rules(d)).toContain(rule)
  const lamp = (x: number, id = 'e1', module = 't-lamp') => mat(id, id.toUpperCase(), module, x)
  it('shorts, two outlets joined, a shared neutral, mains on a GPIO', () => {
    has(mains([mat('xs1', 'XS1', 't-outlet')], [mw('xs1|L', 'xs1|N')]), 'mains-short')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('xs2', 'XS2', 't-outlet-2', 200)], [mw('xs1|L', 'xs2|N')]), 'mains-cross-source')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('xs2', 'XS2', 't-outlet-2', 200)], [mw('xs1|N', 'xs2|N')]), 'mains-shared-neutral')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('u1', 'U1', 't-mcu', 200)], [mw('xs1|L', 'u1|IO')]), 'mains-to-low-voltage')
  })
  it('voltage, ratings and missing data', () => {
    has(mains([mat('xs1', 'XS1', 't-outlet-eu'), lamp(200)], [mw('xs1|L', 'e1|L'), mw('xs1|N', 'e1|N')]), 'mains-voltage')
    const block = (module: string) => mains([mat('xs1', 'XS1', 't-outlet-eu'), mat('x1', 'X1', module, 200)], [mw('xs1|L', 'x1|1')])
    has(block('t-term-125'), 'mains-rating')
    has(block('t-term-dc'), 'rating-unknown')
    has(block('t-term-cond'), 'rating-conditional')
    has(block('t-term-unverified'), 'rating-unverified')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('x1', 'X1', 't-undeclared', 200)], [mw('xs1|L', 'x1|A')]), 'data-missing')
  })
  it('polarity, earth and a ground joined to earth', () => {
    has(mains([mat('xs1', 'XS1', 't-outlet'), lamp(200)], [mw('xs1|N', 'e1|L'), mw('xs1|L', 'e1|N')]), 'polarity')
    has(mains([mat('xs1', 'XS1', 't-outlet'), lamp(200, 'e1', 't-lamp-c1')], [mw('xs1|L', 'e1|L'), mw('xs1|N', 'e1|N')]), 'earth')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('u1', 'U1', 't-mcu', 200)], [mw('xs1|PE', 'u1|GND')]), 'earth-bond')
  })
  it('fuses, cables and checks that did not finish', () => {
    const lit = mains([mat('xs1', 'XS1', 't-outlet'), lamp(200)], [mw('xs1|L', 'e1|L'), mw('xs1|N', 'e1|N')])
    has(lit, 'unprotected')
    has(lit, 'cable-unverified')
    const fused = (settings: Record<string, string>) =>
      mains([mat('xs1', 'XS1', 't-outlet'), mat('f1', 'F1', 't-fuse', 200, 0, { settings }), lamp(400)], [mw('xs1|L', 'f1|1'), mw('f1|2', 'e1|L'), mw('e1|N', 'xs1|N')])
    has(fused({ fuse: 'fitted' }), 'fuse-rating-unknown')
    has(fused({ fuse: 'absent' }), 'no-power')
    has(mains([mat('xs1', 'XS1', 't-outlet'), lamp(200)], [dupont('xs1|L', 'e1|L'), mw('xs1|N', 'e1|N')]), 'mains-cable')
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    has(mains([mat('xs1', 'XS1', 't-outlet'), ...ks.map((k) => mat(`s${k}`, `S${k}`, 't-switch', k * 100, 300))], ks.map((k) => mw('xs1|L', `s${k}|1`))), 'mains-incomplete')
  })
  it('plugs that do not fit the outlet they are over', () => {
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('xp1', 'XP1', 't-plug-uk')], []), 'plug-mismatch')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('xp1', 'XP1', 't-plug-us', 10, 0, { mount: { board: 'xs1' } })], []), 'plug-mismatch')
    has(mains([mat('xs1', 'XS1', 't-outlet'), mat('xp2', 'XP2', 't-plug-us', 600, 600)], [mw('xs1|L', 'xp2|L')]), 'live-prong')
  })
})

describe('parallel battery banks (Ruling V1)', () => {
  const holder = (uid: string, designator: string, x: number, extra: Partial<PartInstance> = {}) => at(uid, designator, 'battery-18650-holder', x, extra)
  const all = (d: Diagram) => checkDiagram(d).map((x) => `${x.severity} ${x.rule}: ${x.message}`)
  const advice = 'Charge every cell to the same voltage, within about 0.1 V, before connecting them, and use matching cells.'
  it('Michael\'s 1S4P pack on an IP5306: one note, no supplies-parallel', () => {
    const d = built(JSON.parse(readFileSync(new URL('./fixtures/battery-bank-1s4p.circuitoon.json', import.meta.url), 'utf8')) as Diagram)
    const findings = checkDiagram(d)
    expect(findings.filter((x) => x.rule === 'supplies-parallel')).toEqual([])
    // His sheet also has two wire ends in one breadboard hole (w9 and w11): hole-shared, listed first.
    expect(findings.map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual([
      'error hole-shared: 2 wire ends share Power Breadboard c2-top hole 2: Power Breadboard c1-top hole 2 to Power Breadboard c2-top hole 2 and Power Breadboard c2-top hole 2 to U1 B+. Physically, one hole takes one wire end. Move one of them to a free hole of the same strip.',
      `info battery-bank: BT1-BT4 form a parallel battery bank (4P, 3.7 V). ${advice}`,
    ])
    const bank = findings.find((x) => x.rule === 'battery-bank')!
    expect(bank.parts).toHaveLength(4)
    expect(bank.pins).toHaveLength(8)
    expect(bank.target).toBe('BT1-BT4')
  })
  it('two cells feeding loads: named by designator, one supply at the bank voltage', () => {
    const d = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'ip5306-usbc-module', 400), at('u2', 'U2', 'bme280-module-4pin', 700)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt2|+', 'u1|B+'], ['bt2|-', 'u1|B-'], ['bt1|+', 'u2|VIN'], ['bt1|-', 'u2|GND']])
    expect(all(d)).toEqual([`info battery-bank: BT1 and BT2 form a parallel battery bank (2P, 3.7 V). ${advice}`])
  })
  it('a bank still gets the voltage checks of one supply: too high for a 3.3 V input', () => {
    const d = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt2|+', 'u1|VCC'], ['bt2|-', 'u1|GND']])
    expect(all(d)).toEqual([
      'error supply-too-high: U1 VCC accepts up to 3.3 V but gets 3.7 V from BT1 + and BT2 + in parallel. Use a 3.3 V supply instead.',
      `info battery-bank: BT1 and BT2 form a parallel battery bank (2P, 3.7 V). ${advice}`,
    ])
  })
  it('two banks stacked in series (2S2P) are two banks, and the stack adds up', () => {
    const d = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), holder('bt3', 'BT3', 400), holder('bt4', 'BT4', 600), at('u1', 'U1', 'esp32-devkit-v1-30', 800)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt3|+', 'bt4|+'], ['bt3|-', 'bt4|-'], ['bt1|+', 'bt3|-'], ['bt4|+', 'u1|VIN'], ['bt2|-', 'u1|GND']])
    expect(all(d)).toEqual([
      `info battery-bank: BT1 and BT2 form a parallel battery bank (2P, 3.7 V). ${advice}`,
      `info battery-bank: BT3 and BT4 form a parallel battery bank (2P, 3.7 V). ${advice}`,
    ])
  })
  it('a series stack is not a bank and stays unaffected', () => {
    const d = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'bt2|-'], ['bt2|+', 'u1|VIN'], ['bt1|-', 'u1|GND']])
    expect(found(d)).toEqual([])
  })
  it('different chemistries or voltages still warn: 18650 with a 9 V battery, 1 AA with a 2 x AA holder, a CR2032 with a 2 x AA holder', () => {
    const pair = (a: string, b: string) => sheet([at('bt1', 'BT1', a), at('bt2', 'BT2', b, 200)], [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-']])
    expect(rules(pair('battery-18650-holder', 'battery-9v'))).toEqual(['supplies-fight'])
    expect(rules(pair('battery-aa', 'battery-holder-2xaa'))).toEqual(['supplies-fight'])
    // The same 3 V, but a lithium coin cell beside two alkaline AAs: not a bank.
    expect(found(pair('battery-cr2032', 'battery-holder-2xaa'))).toEqual(['supplies-parallel: BT1 + and BT2 + are two supplies tied together; power this net from one of them.'])
    // A bank beside a 9 V battery: one fight, naming every cell.
    const nine = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('bt3', 'BT3', 'battery-9v', 400)], [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt3|+', 'bt2|+'], ['bt3|-', 'bt2|-']])
    expect(all(nine)).toEqual(['error supplies-fight: BT3 + (9 V) and BT1 + and BT2 + (3.7 V in parallel) are wired together: the supplies fight, and the higher one drives current into the lower one, which can damage both. Separate them.'])
    // The same holder set to different voltages (a full cell beside a flat one) fights.
    const d = sheet([holder('bt1', 'BT1', 0, volts(4.2)), holder('bt2', 'BT2', 200, volts(3.7))], [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-']])
    expect(rules(d)).toEqual(['supplies-fight'])
  })
  it('a battery bank tied to a non-battery supply still warns, naming every cell: USB 5 V, a buck output', () => {
    const usb = sheet([at('bt1', 'BT1', 'battery-holder-4xaa', 0, volts(5)), at('bt2', 'BT2', 'battery-holder-4xaa', 200, volts(5)), at('u1', 'U1', 'rpi-pico', 400)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt2|+', 'u1|VBUS'], ['bt2|-', 'u1|GND']])
    const buck = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'lm2596-buck-module', 400, volts(3.7)), at('bt3', 'BT3', 'battery-9v', 700)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['u1|OUT+', 'bt2|+'], ['u1|OUT-', 'bt2|-'], ['bt3|+', 'u1|IN+'], ['bt3|-', 'u1|IN-']])
    for (const [d, other] of [[usb, 'U1 VBUS'], [buck, 'U1 OUT+']] as const) {
      expect(rules(d)).not.toContain('battery-bank')
      expect(rules(d)).toContain('supplies-parallel')
      const tied = found(d).filter((x) => x.startsWith('supplies-parallel')).join(' ')
      for (const n of ['BT1', 'BT2', other]) expect(tied).toContain(n)
    }
  })
  it('a bank on a pin behind the USB diode is named as every cell when USB pushes current back', () => {
    const d = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'rpi-pico', 400)],
      [['bt1|+', 'bt2|+'], ['bt1|-', 'bt2|-'], ['bt2|+', 'u1|VSYS'], ['bt2|-', 'u1|GND']])
    expect(all(d)).toEqual(['error supplies-fight: When USB is plugged in, U1 VSYS gets 5 V from USB, which pushes current back into BT1 and BT2 (3.7 V) and can damage the cells. Add a diode from BT1 + to VSYS, or unplug BT1 and BT2 before plugging in USB.'])
  })
  it('cells joined only on +: no bank; with the - sides apart nothing flows, joined only through a charger\'s common return they still warn', () => {
    const apart = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'ip5306-usbc-module', 400)],
      [['bt1|+', 'u1|B+'], ['bt2|+', 'u1|B+'], ['bt1|-', 'u1|B-']])
    expect(rules(apart)).not.toContain('battery-bank')
    expect(rules(apart)).not.toContain('supplies-parallel')
    const through = sheet([holder('bt1', 'BT1', 0), holder('bt2', 'BT2', 200), at('u1', 'U1', 'tp4056-module', 400)],
      [['bt1|+', 'u1|B+'], ['bt2|+', 'u1|B+'], ['bt1|-', 'u1|B-'], ['bt2|-', 'u1|OUT-']])
    expect(rules(through)).not.toContain('battery-bank')
    expect(rules(through)).toContain('supplies-parallel')
  })
})

describe('pin capabilities and I2C on the built-in parts', () => {
  /** The pin and I2C findings only (these small sheets leave some power pins unwired on purpose). */
  const kinds = (d: Diagram) => checkDiagram(d).filter((f) => /^(pin|i2c)-/.test(f.rule)).map((f) => `${f.severity} ${f.rule}`)
  /** An ESP32 DevKit V1 on USB, plus the given parts and wires. */
  const v1 = (parts: PartInstance[], wires: Wire[]) => sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), ...parts], wires)
  it('a relay driven from input-only D34 is an error; from D13 it is fine', () => {
    const relay = (pin: string) => v1([at('k1', 'K1', 'relay-module-1ch-5v', 400)], [['k1|DC+', 'u1|VIN'], ['k1|DC-', 'u1|GND'], ['k1|IN', `u1|${pin}`]])
    expect(found(relay('D34'))).toEqual(["pin-input-only: U1 D34 is input only (GPIO34 is one of the ESP32's sensor inputs, GPIO34-39): it cannot drive K1 IN, and nothing else on the net does. Move the wire to a GPIO that can output, such as D32."])
    expect(found(relay('D13'))).toEqual([])
  })
  it('anything on a DevKitC flash pin is an error', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkitc-v4'), at('k1', 'K1', 'relay-module-1ch-5v', 400)], [['k1|DC+', 'u1|5V'], ['k1|DC-', 'u1|GND'], ['k1|IN', 'u1|D0']])
    expect(kinds(d)).toEqual(['error pin-flash'])
  })
  it('a tilt switch on MCP23017 GPA7 is an error; on GPA6 it is fine', () => {
    const tilt = (pin: string) => sheet([at('u1', 'U1', 'mcp23017-dip28'), at('s1', 'S1', 'tilt-switch-sw520d', 300)], [['u1|' + pin, 's1|1'], ['s1|2', 'u1|VSS']])
    expect(kinds(tilt('GPA7'))).toEqual(['error pin-output-only'])
    expect(kinds(tilt('GPA6'))).toEqual([])
  })
  it('a pull-up on D12 (must be low at reset) warns; a button on D35 with no pull-up warns', () => {
    expect(kinds(v1([at('r1', 'R1', 'resistor', 400)], [['r1|1', 'u1|D12'], ['r1|2', 'u1|3V3']]))).toEqual(['warning pin-strapping'])
    expect(kinds(v1([at('s1', 'S1', 'push-button', 400)], [['s1|1', 'u1|D35'], ['s1|2', 'u1|GND']]))).toEqual(['warning pin-no-pullup'])
    expect(kinds(v1([at('s1', 'S1', 'push-button', 400), at('r1', 'R1', 'resistor', 600)], [['s1|1', 'u1|D35'], ['s1|2', 'u1|GND'], ['r1|1', 'u1|D35'], ['r1|2', 'u1|3V3']]))).toEqual([])
  })
  /** An MCP23017 on the ESP32's I2C pins, powered, RESET high, with the given address pin wiring. */
  const mcp = (u: string, x: number, address: Wire[]): [PartInstance, Wire[]] => [at(u, u.toUpperCase(), 'mcp23017-dip28', x),
    [[`${u}|VDD`, 'u1|3V3'], [`${u}|VSS`, 'u1|GND'], [`${u}|RESET`, 'u1|3V3'], [`${u}|SDA`, 'u1|D21'], [`${u}|SCL`, 'u1|D22'], ...address]]
  const low = (u: string): Wire[] => ['A0', 'A1', 'A2'].map((a): Wire => [`${u}|${a}`, 'u1|GND'])
  it('a bare MCP23017 with no pull-ups warns; an address pin left open warns', () => {
    const [p, w] = mcp('u2', 400, low('u2'))
    expect(kinds(v1([p], w))).toEqual(['warning i2c-pullups'])
    const [q, x] = mcp('u2', 400, low('u2').slice(1))
    expect(kinds(v1([q], x))).toEqual(['warning i2c-pullups', 'warning i2c-address-floating'])
  })
  it('two GY-BME280 boards with SDO left open are both at 0x76: an error; SDO to 3V3 on one fixes it', () => {
    const two = (extra: Wire[]) => v1([at('u2', 'U2', 'bme280-module-6pin', 400), at('u3', 'U3', 'bme280-module-6pin', 600)], [
      ...['u2', 'u3'].flatMap((u): Wire[] => [[`${u}|VCC`, 'u1|3V3'], [`${u}|GND`, 'u1|GND'], [`${u}|SDA`, 'u1|D21'], [`${u}|SCL`, 'u1|D22']]), ...extra])
    expect(found(two([]))).toEqual(["i2c-address-clash: U2 and U3 are both at I2C address 0x76 on the bus at U1 D21 (SDA) and U1 D22 (SCL): they answer together and the bus fails. Give each its own address: wire U3's address pins (SDO) differently."])
    expect(found(two([['u3|SDO', 'u1|3V3']]))).toEqual([])
  })
  // Review fixes (2026-10-02).
  it("address pins tied only to each other float (the other chip's inputs drive nothing); tied to GND they clash", () => {
    const [p2, w2] = mcp('u2', 400, [])
    const [p3, w3] = mcp('u3', 600, [])
    const each = (to: (a: string) => string): Wire[] => ['A0', 'A1', 'A2'].map((a): Wire => [`u2|${a}`, to(a)])
    const floating = kinds(v1([p2, p3], [...w2, ...w3, ...each((a) => `u3|${a}`)]))
    expect(floating.filter((k) => k.includes('address'))).toEqual(['warning i2c-address-floating', 'warning i2c-address-floating'])
    const grounded = kinds(v1([p2, p3], [...w2, ...w3, ...each((a) => `u3|${a}`), ...each(() => 'u1|GND')]))
    expect(grounded.filter((k) => k.includes('address'))).toEqual(['error i2c-address-clash'])
  })
  it("an address pin on the chip's own VCC net is high; one wired only to a connector comes from another sheet (not floating)", () => {
    const [p2, w2] = mcp('u2', 400, [['u2|A0', 'u1|3V3'], ['u2|A1', 'u1|GND']])
    const [p3, w3] = mcp('u3', 600, [['u3|A0', 'u3|VDD'], ['u3|A1', 'u1|GND'], ['u3|A2', 'j1|1']])
    const d = v1([p2, p3, at('j1', 'J1', 'jst-xh-2', 800)], [...w2, ...w3, ['u2|A2', 'u1|GND']])
    expect(kinds(d).filter((k) => k.includes('address'))).toEqual([])
  })
  it('a key matrix through GPA7 (GPA7 -> switch -> GPA0) is not a read of GPA7', () => {
    const d = sheet([at('u1', 'U1', 'mcp23017-dip28'), at('s1', 'S1', 'push-button', 300)], [['u1|GPA7', 's1|1'], ['s1|2', 'u1|GPA0']])
    expect(kinds(d)).toEqual([])
  })
  it('a tilt switch on GPA7 names a real free pin of the chip (its GPIOs are untyped)', () => {
    const d = sheet([at('u1', 'U1', 'mcp23017-dip28'), at('s1', 'S1', 'tilt-switch-sw520d', 300)], [['u1|GPA7', 's1|1'], ['s1|2', 'u1|VSS']])
    expect(found(d).filter((m) => m.startsWith('pin-'))).toEqual([
      'pin-output-only: U1 GPA7 is output only (Microchip made GPA7 and GPB7 output only in datasheet revision D; read inputs on the other 14 pins), but it is wired to S1 (a switch) as an input. Use another pin to read it, such as GPB0.',
    ])
  })
  it('a resistor to the same rail as the switch is no pull-up: D34 with a switch and a resistor both to GND still warns', () => {
    const d = v1([at('s1', 'S1', 'push-button', 400), at('r1', 'R1', 'resistor', 600)], [['s1|1', 'u1|D34'], ['s1|2', 'u1|GND'], ['r1|1', 'u1|D34'], ['r1|2', 'u1|GND']])
    expect(kinds(d)).toEqual(['warning pin-no-pullup'])
  })
  it('a download-only strapping pin (D2) says it matters only when flashing, not that the board fails to boot', () => {
    const [m] = checkDiagram(v1([at('r1', 'R1', 'resistor', 400)], [['r1|1', 'u1|D2'], ['r1|2', 'u1|3V3']])).filter((f) => f.rule === 'pin-strapping')
    expect(m.message).toBe('U1 D2 is a strapping pin that only matters when flashing over serial (GPIO2 high at reset makes uploads over USB fail; a normal boot is unaffected), but R1 pulls it up to the supply, so uploads can fail. Move that circuit to a GPIO that is not a strapping pin, such as D32, or make sure it is low while you upload.')
  })
})

describe('every message ends with what to do', () => {
  const VERBS = ['connect', 'move', 'swap', 'remove', 'set', 'use', 'add', 'separate', 'delete', 'power', 'keep', 'give', 'drag', 'do', 'say', 'wire', 'unplug', 'split', 'check', 'fit', 'turn', 'charge']
  /** True when a clause of the last sentence starts with an instruction. */
  const acts = (message: string) => {
    const last = message.split(/(?<=\.) /).pop()!
    return last.split(/: |; /).some((c) => VERBS.includes(c.split(' ')[0].toLowerCase()))
  }
  it('on the rules the sheets above do not all reach: outputs fight, mounts, broken wires, unknown voltages', () => {
    const drv = custom({ id: 'drv', pins: [{ name: 'Q', side: 'right', type: 'output' }, { name: 'G', side: 'right', type: 'ground' }] })
    const two = custom({ id: 'two-leads', pins: [{ name: 'L', side: 'left', type: 'passive' }, { name: 'R', side: 'right', type: 'passive' }] })
    sheetWith([drv], [at('u1', 'U1', 'drv'), at('u2', 'U2', 'drv', 200)], [['u1|Q', 'u2|Q'], ['u1|G', 'u2|G']])
    sheetWith([two], [at('r1', 'R1', 'two-leads', 0, { mount: { board: 'zz' } }), at('r2', 'R2', 'two-leads', 200, { mount: { board: 'r1' } })], [['r1|L', 'gone|X']])
    sheetWith([adjBuck()], [at('u2', 'U2', 'adj-buck'), at('u3', 'U3', 'adj-buck', 200), at('u1', 'U1', 'bme280-module-6pin', 400)],
      [['u2|OUT-', 'u1|GND'], ['u2|OUT+', 'u3|OUT-'], ['u3|OUT+', 'u1|VCC']])
    const board = custom({ id: 'strips', pins: [], size: { w: 10, h: 6 }, obstacle: false,
      holes: Array.from({ length: 9 }, (_, i) => ({ name: `s${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y]) })) })
    const legs = custom({ id: 'legs', pins: [{ name: 'L', side: 'left', type: 'passive' }, { name: 'R', side: 'right', type: 'passive' }] })
    const hole = sheetWith([board, legs], [at('bb', 'BB1', 'strips'), at('r1', 'R1', 'legs', 10, { mount: { board: 'bb' } }), at('r2', 'R2', 'legs', 300)], [['bb|s1|1', 'r2|L']])
    expect(rules(hole)).toContain('leg-hole-shared')
    // R1's body covers s2 to s4, holes 0 and 1: a wire end in s3 hole 1, and R3's leg in s3 hole 0.
    const under = sheetWith([board, legs], [at('bb', 'BB1', 'strips'), at('r1', 'R1', 'legs', 10, { mount: { board: 'bb' } }), at('r2', 'R2', 'legs', 300), at('r3', 'R3', 'legs', 30, { y: -10, mount: { board: 'bb' } })], [['bb|s3|1', 'r2|L']])
    expect(checkDiagram(under).filter((f) => f.rule === 'covered-hole')).toHaveLength(2)
    const shared = sheetWith([board, legs], [at('bb', 'BB1', 'strips'), at('r2', 'R2', 'legs', 300)], [['bb|s7|2', 'r2|L'], ['bb|s7|2', 'r2|R']])
    expect(rules(shared)).toContain('hole-shared')
    // Wire colours: a blue ground and an orange supply, then a red signal.
    const colored = sheetWith([drv], [at('u1', 'U1', 'drv'), at('u2', 'U2', 'drv', 200), at('bt1', 'BT1', 'battery-9v', 400)], [['u1|G', 'u2|G'], ['bt1|+', 'u2|Q']])
    const recolor: Record<string, string> = { 'u1|G': 'blue', 'bt1|+': 'orange' }
    const d = built({ ...colored, connections: colored.connections.map((c) => ({ ...c, color: recolor[`${c.from.part}|${c.from.pin}`], colorSet: true as const })) })
    expect(rules(d)).toEqual(expect.arrayContaining(['wire-color-ground', 'wire-color-supply']))
    const sig = built({ ...colored, connections: [{ uid: 'wsig', from: { part: 'u1', pin: 'Q' }, to: { part: 'u2', pin: 'Q' }, color: 'red', colorSet: true }] })
    expect(rules(sig)).toContain('wire-color-signal')
    // Net labels: one with no name, one alone, and two carrying mains from an outlet to a lamp.
    const labels = sheetWith([], [at('u1', 'U1', 'bme280-module-4pin'), at('n1', 'NL1', 'net-label', 300), at('n2', 'NL2', 'net-label', 400, { values: { net: 'SDA' } })],
      [['u1|SCL', 'n1|NET'], ['u1|SDA', 'n2|NET']])
    expect(rules(labels)).toEqual(expect.arrayContaining(['label-unnamed', 'label-alone']))
    const live = built(mainsSheet([mat('o', 'XS1', 't-outlet'), mat('l', 'E1', 't-lamp', 300), mat('m1', 'NL1', 'net-label', 100, 0, { values: { net: 'LIVE' } }), mat('m2', 'NL2', 'net-label', 200, 0, { values: { net: 'LIVE' } })],
      [mw('o|L', 'm1|NET'), mw('m2|NET', 'l|L'), mw('o|N', 'l|N')], { 'net-label': load('net-label') }))
    expect(rules(live)).toContain('label-mains')
  })
  it('on every finding of every sheet built in this file', () => {
    const missing: string[] = []
    const seen = new Set<string>()
    for (const d of fixtures)
      for (const f of checkDiagram(d)) {
        seen.add(f.rule)
        if (!acts(f.message)) missing.push(`${f.rule}: ${f.message}`)
      }
    if (missing.length) console.log('NOACT\n' + [...new Set(missing)].join('\n'))
    expect(missing).toEqual([])
    // Every rule is reached here.
    expect([...seen].sort()).toEqual(Object.keys(RULES).sort())
  })
})

describe('round 6: diode constraints, diode loops, compatible advice, S3 memory pins', () => {
  it('the Nano/Pico/3 V case gives both 8 V findings whatever the uids', () => {
    const run = (nano: string, pico: string) => {
      const parts = [at(nano, 'U1', 'arduino-nano'), at(pico, 'U2', 'rpi-pico', 300), at('bt1', 'BT1', 'battery-holder-2xaa', 600), at('u3', 'U3', 'bme280-module-4pin', 900)]
      return checkDiagram(sheet(parts, [[`bt1|-`, `${pico}|GND`], ['bt1|+', `${nano}|GND`], [`${nano}|5V`, `${pico}|VSYS`], ['u3|VIN', `${pico}|VSYS`], ['u3|GND', `${pico}|GND 2`]]))
        .map((f) => f.message).sort()
    }
    const want = [
      'U2 VSYS accepts up to 5.5 V but gets 8 V from BT1 + and U1 5V in series. Use a 5.5 V supply instead.',
      'U3 VIN accepts up to 5 V but gets 8 V from BT1 + and U1 5V in series. Use a 5 V supply instead.',
    ]
    expect(run('u1', 'u2')).toEqual(want)
    expect(run('u2', 'u1')).toEqual(want)
  })
  it('crossed power leads between two Nanos (N1 5V to N2 GND, N2 5V to N1 GND) are a short', () => {
    const d = sheet([at('n1', 'U1', 'arduino-nano'), at('n2', 'U2', 'arduino-nano', 300)], [['n1|5V', 'n2|GND'], ['n2|5V', 'n1|GND']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error short: U1 5V and U2 5V are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: U1 5V to U2 GND, or U2 5V to U1 GND.',
    ])
  })
  it('a battery in series with a board USB pin, both the same way round, is a short', () => {
    const d = sheet([at('u1', 'U1', 'arduino-nano'), at('bt1', 'BT1', 'battery-9v', 300)], [['u1|5V', 'bt1|-'], ['bt1|+', 'u1|GND']])
    expect(rules(d)).toEqual(['short'])
  })
  it('no-power advice fits the input: 3.3 V only, 3.3 V or 5 V, a range, or unknown', () => {
    const unfed = (m: string, vcc: string) => sheet([at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', m, 300), at('bb', 'BB1', 'breadboard-half', 0, { y: 400 })],
      [['u1|GND', 'u2|GND'], [`u2|${vcc}`, 'bb|top+|3']])
    expect(found(unfed('bme280-module-6pin', 'VCC'))).toEqual(["no-power: U2 has no power: VCC is connected but nothing supplies it. Connect it to a 3.3 V supply, such as a board's 3V3 pin."])
    expect(found(unfed('bme280-module-4pin', 'VIN'))).toEqual(["no-power: U2 has no power: VIN is connected but nothing supplies it. Connect it to a 3.3 V or 5 V supply, such as a board's 3V3 or 5V pin."])
    const vin = sheet([at('u1', 'U1', 'arduino-nano'), at('bt1', 'BT1', 'battery-9v', 300), at('u2', 'U2', 'l298n-module', 600), at('bb', 'BB1', 'breadboard-half', 0, { y: 400 })],
      [['u2|GND', 'bt1|-'], ['u2|+12V', 'bb|top+|3'], ['u2|IN1', 'u1|D5'], ['u1|GND', 'bt1|-']])
    expect(found(vin)).toEqual(['no-power: U2 has no power: +12V is connected but nothing supplies it. Connect it to a 7 V to 12 V supply, such as a 9 V battery.'])
    const bare = custom({ id: 'bare-in', pins: [{ name: 'VCC', side: 'left', type: 'power_in' }, { name: 'GND', side: 'left', type: 'ground' }] })
    const q = sheetWith([bare], [at('u1', 'U1', 'rpi-pico'), at('u2', 'U2', 'bare-in', 300), at('bb', 'BB1', 'breadboard-half', 0, { y: 400 })],
      [['u1|GND', 'u2|GND'], ['u2|VCC', 'bb|top+|3']])
    expect(found(q)).toEqual(['no-power: U2 has no power: VCC is connected but nothing supplies it. Connect it to a compatible supply.'])
  })
  it('ESP32-S3 GPIO35-37 stay untyped (octal flash/PSRAM on N8R8 and similar)', () => {
    const type = (pin: string) => (load('esp32-s3-devkitc-1').pins.find((p) => 'name' in p && p.name === pin) as { type?: string } | undefined)?.type
    expect(['35', '36', '37', '38'].map(type)).toEqual([undefined, undefined, undefined, 'io'])
  })
})

describe('hotfix: Astra re-review 6', () => {
  const nanos = (extra: Wire[]) => sheet([at('n1', 'U1', 'arduino-nano'), at('n2', 'U2', 'arduino-nano', 300)], [['n1|5V', 'n2|GND'], ['n2|5V', 'n1|GND'], ...extra])
  it('crossed Nano power leads plus a wire to a missing pin: the short and the broken wire, no crash', () => {
    const d = nanos([['n1|5V', 'n2|BAD']])
    expect(() => checkDiagram(d)).not.toThrow()
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error short: U1 5V and U2 5V are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: U1 5V to U2 GND, or U2 5V to U1 GND.',
      'error broken: The wire U1 5V to U2 BAD is broken: U2 BAD is not on the sheet, so it connects nothing. Delete it, and draw it again if you still need it.',
    ])
  })
  it('crossed Nano power leads plus a signal wire into the loop: only the power leads are offered for removal', () => {
    const d = nanos([['n1|D2', 'n2|GND']])
    expect(found(d)).toEqual([
      'short: U1 5V and U2 5V are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: U1 5V to U2 GND, or U2 5V to U1 GND.',
    ])
  })
  it('a loop closed through breadboard rails names the jumpers that carry it, not a parallel spare', () => {
    // U1 5V and U2 GND share the top+ rail (two jumpers from U2 GND: neither alone breaks the loop).
    const d = sheet([at('n1', 'U1', 'arduino-nano'), at('n2', 'U2', 'arduino-nano', 300), at('bb', 'BB1', 'breadboard-half', 0, { y: 400 })],
      [['n1|5V', 'bb|top+|0'], ['n2|GND', 'bb|top+|4'], ['n2|GND 2', 'bb|top+|8'], ['n2|5V', 'n1|GND']])
    expect(found(d)).toEqual([
      'short: U1 5V and U2 5V are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of these wires: U1 5V to BB1 + rail (top), or U2 5V to U1 GND.',
    ])
  })
  it('two Nanos tied 5V to 5V feeding a BME280: the overvoltage names U1 whatever the uids', () => {
    const run = (a: string, b: string) => found(sheet([at(a, 'U1', 'arduino-nano'), at(b, 'U2', 'arduino-nano', 300), at('s1', 'U3', 'bme280-module-6pin', 600)],
      [[`${a}|5V`, `${b}|5V`], [`${a}|GND`, `${b}|GND`], ['s1|VCC', `${b}|5V`], ['s1|GND', `${b}|GND 2`]]))
    const want = ['supply-too-high: U3 VCC accepts up to 3.3 V but gets 5 V from U1 5V (USB). Move the wire to a 3.3 V pin.']
    expect(run('n1', 'n2')).toEqual(want)
    expect(run('n2', 'n1')).toEqual(want)
    expect(run('zz', 'aa')).toEqual(want)
  })
  it('a 3.3 V only sensor and a 5 V only sensor on one unfed rail: split the rail, never one voltage for both', () => {
    const d = sheet([at('bb', 'BB1', 'breadboard-half', 0, { y: 300 }), at('u1', 'U1', 'rpi-pico', 400), at('u2', 'U2', 'bme280-module-6pin', 700), at('u3', 'U3', 'ultrasonic-hc-sr04', 900)],
      [['u1|GND', 'bb|top-|0'], ['u2|VCC', 'bb|top+|3'], ['u2|GND', 'bb|top-|3'], ['u3|VCC', 'bb|top+|5'], ['u3|GND', 'bb|top-|5']])
    const split = 'U2 VCC needs 3.3 V and U3 VCC needs 5 V: these parts need different supply voltages; split the rail and power each part from a supply it accepts.'
    expect(found(d)).toEqual([
      `no-power: U2 has no power: VCC is connected but nothing supplies it. ${split}`,
      `no-power: U3 has no power: VCC is connected but nothing supplies it. ${split}`,
    ])
  })
  it('loads on a shared rail that all accept the same rails keep the plain advice', () => {
    const d = sheet([at('bb', 'BB1', 'breadboard-half', 0, { y: 300 }), at('u1', 'U1', 'rpi-pico', 400), at('u2', 'U2', 'bme280-module-4pin', 700), at('u3', 'U3', 'oled-ssd1306-096-i2c', 900)],
      [['u1|GND', 'bb|top-|0'], ['u2|VIN', 'bb|top+|3'], ['u2|GND', 'bb|top-|3'], ['u3|VCC', 'bb|top+|5'], ['u3|GND', 'bb|top-|5']])
    expect(found(d)).toEqual([
      "no-power: U2 has no power: VIN is connected but nothing supplies it. Connect it to a 3.3 V or 5 V supply, such as a board's 3V3 or 5V pin.",
      "no-power: U3 has no power: VCC is connected but nothing supplies it. Connect it to a 3.3 V or 5 V supply, such as a board's 3V3 or 5V pin.",
    ])
  })
})

/** Every finding reduced to what a user sees, with uids mapped back through `back`. */
function normalized(d: Diagram, back: (uid: string) => string = (u) => u): string[] {
  return checkDiagram(d).map((f) => JSON.stringify([f.rule, f.severity, f.message, f.pins.map((p) => `${back(p.part)}.${p.pin}`).sort()])).sort()
}
/** The sheet with every part and wire uid renamed (a seeded permutation of fresh names). */
function renamed(d: Diagram, seed: number): { d: Diagram; back: (uid: string) => string } {
  const names = shuffled(d.parts.map((_, i) => `p${i}x`), seed)
  const to = new Map(d.parts.map((p, i) => [p.uid, names[i]]))
  const from = new Map([...to].map(([a, b]) => [b, a]))
  const r = (u: string) => to.get(u) ?? u
  const ep = (e: Connection['from']) => ({ ...e, part: r(e.part) })
  return {
    d: {
      ...d,
      parts: d.parts.map((p) => ({ ...p, uid: r(p.uid), ...(p.mount ? { mount: { ...p.mount, board: r(p.mount.board) } } : {}) })),
      connections: d.connections.map((c, i) => ({ ...c, uid: `c${(i * 7 + seed) % 1000}-${i}`, from: ep(c.from), to: ep(c.to) })),
    },
    back: (u) => from.get(u) ?? u,
  }
}

describe('order and uid independence (every sheet built above)', () => {
  it('shuffling the parts and the wires never changes the finding ids', () => {
    expect(fixtures.length).toBeGreaterThan(80)
    for (const d of fixtures) {
      const ids = (x: Diagram) => checkDiagram(x).map((f) => f.id).sort()
      const want = ids(d)
      for (const seed of [1, 2, 3]) expect(ids({ ...d, parts: shuffled(d.parts, seed), connections: shuffled(d.connections, seed + 7) })).toEqual(want)
    }
  })
  it('shuffling and renaming every uid never changes what the findings say', () => {
    for (const d of fixtures) {
      const want = normalized(d)
      for (const seed of [1, 2, 3]) {
        const { d: x, back } = renamed({ ...d, parts: shuffled(d.parts, seed), connections: shuffled(d.connections, seed + 11) }, seed)
        expect(normalized(x, back)).toEqual(want)
      }
    }
  })
})
