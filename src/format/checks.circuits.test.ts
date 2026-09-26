// The wiring checker on real hobby circuits built from the built-in parts: what a correct hookup
// must not be nagged about, and the damaging ones it must catch. From the Claude review's
// realistic-circuit sheets, with the findings the review rulings expect.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'
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
  it('USB-C panel into a TP4056 charging an 18650, boosted by an IP5306 into ESP32 VIN', () => {
    const d = sheet([
      at('u1', 'U1', 'tp4056-module'), at('bt1', 'BT1', 'battery-18650-holder', -300), at('u2', 'U2', 'ip5306-usbc-module', 300),
      at('u3', 'U3', 'esp32-devkit-v1-30', 600), at('j1', 'J1', 'usb-panel-mount-usbc', -600),
    ], [
      ['j1|VBUS', 'u1|IN+'], ['j1|GND', 'u1|IN-'], ['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-'],
      ['u1|OUT+', 'u2|B+'], ['u1|OUT-', 'u2|B-'], ['u2|5V+', 'u3|VIN'], ['u2|5V-', 'u3|GND'],
    ])
    expect(found(d)).toEqual([])
  })
  it('a 9 V battery into an LM2596 set to 5 V, into ESP32 VIN', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module', 0, volts(5)), at('u2', 'U2', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
    expect(found(d)).toEqual([])
  })
  it('an LM2596 left at its 5 V default counts as 5 V too', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module'), at('u2', 'U2', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
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

describe('damaging or dead circuits are caught', () => {
  it('a TP4056 output (one cell, 3.7 V) straight into ESP32 VIN is too low', () => {
    const d = sheet([at('u1', 'U1', 'tp4056-module'), at('bt1', 'BT1', 'battery-18650-cell', -300), at('u3', 'U3', 'esp32-devkit-v1-30', 600)],
      [['bt1|+', 'u1|B+'], ['bt1|-', 'u1|B-'], ['u1|OUT+', 'u3|VIN'], ['u1|OUT-', 'u3|GND']])
    expect(found(d)).toEqual(['supply-too-low: U3 VIN needs at least 5 V; BT1 + gives only 3.7 V.'])
  })
  it('an LM2596 set to 12 V into ESP32 VIN is too high', () => {
    const d = sheet([at('bt1', 'BT1', 'battery-9v', -300), at('u1', 'U1', 'lm2596-buck-module', 0, volts(12)), at('u2', 'U2', 'esp32-devkit-v1-30', 400)],
      [['bt1|+', 'u1|IN+'], ['bt1|-', 'u1|IN-'], ['u1|OUT+', 'u2|VIN'], ['u1|OUT-', 'u2|GND']])
    const f = checkDiagram(d)
    expect(f.map((x) => `${x.severity} ${x.rule}: ${x.message}`)).toEqual(['error supply-too-high: U2 VIN accepts up to 5 V but gets 12 V from U1 OUT+.'])
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
  it('a Nano on USB, its 5V pin into ESP32 3V3: the two supplies fight', () => {
    const d = sheet([at('u1', 'U1', 'esp32-devkit-v1-30'), at('u2', 'U2', 'arduino-nano', 400)], [['u2|5V', 'u1|3V3'], ['u2|GND', 'u1|GND']])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule}: ${f.message}`)).toEqual([
      'error supplies-fight: U2 5V (5 V from USB) and U1 3V3 (3.3 V) are wired together: the two supplies fight.',
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
