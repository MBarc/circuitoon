// Netlists the layout tests and the visual checks share. Plain data (no imports), so a script can
// load this file with Node's type stripping.

/** The spec's example (section 1): a battery lights an LED through a 220 ohm resistor on a breadboard. */
export function ledNetlist() {
  return {
    format: 'circuitoon-netlist/1',
    title: 'LED on a breadboard',
    parts: [
      { ref: 'BB1', module: 'breadboard-half' },
      { ref: 'BT1', module: 'battery-holder-2xaa' },
      { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
      { ref: 'D1', module: 'led', on: 'BB1' },
    ],
    nets: [
      { name: 'VCC', pins: [{ ref: 'BT1', pin: '+' }, { ref: 'R1', pin: '1' }] },
      { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'BT1.-'] },
    ],
    wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
  }
}

/** Eight tilt switches (a repeat) on ESP32 inputs, their grounds on a rail strip. */
export function tiltSensors() {
  const inputs = ['IO13', 'IO14', 'IO25', 'IO26', 'IO27', 'IO32', 'IO33', 'IO4']
  return {
    format: 'circuitoon-netlist/1',
    title: 'Eight tilt sensors',
    parts: [
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      { ref: 'BB1', module: 'power-rail-strip' },
    ],
    nets: [{ name: 'GND', pins: ['U1.GND', 'BB1.-'] }],
    repeat: {
      name: 'tilt',
      count: inputs.length,
      template: {
        parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }],
        nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }],
        ports: ['SIG', 'GND'],
      },
      bindings: inputs.map((io) => ({ SIG: `U1.${io}` })),
      shared: { GND: 'GND' },
    },
    wires: { color: { GND: 'black' }, ends: 'dupont-female' },
  }
}

/** Five parts: the LED example with a push button between the battery and the resistor, all on the board. */
export function fiveParts() {
  const n = ledNetlist()
  return {
    ...n,
    title: 'Button, resistor and LED on a breadboard',
    parts: [...n.parts, { ref: 'S1', module: 'push-button', on: 'BB1' }],
    nets: [
      { name: 'VCC', pins: ['BT1.+', 'S1.1'] },
      { name: 'SW', pins: ['S1.2', 'R1.1'] },
      { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'BT1.-'] },
    ],
  }
}

/**
 * The Spirit Typewriter's power sheet cut down to its mini breadboard: R1 feeds the ON LED D1, and
 * R2 and R3 halve the battery voltage for J1 (R3 stands on end). Before covered holes counted, the
 * layout plugged three wire ends into holes under R3's body.
 */
export function divider() {
  const r = (ref: string, value: number) => ({ ref, module: 'resistor', values: { resistance: { value, unit: 'ohm' } }, on: 'BB5' })
  return {
    format: 'circuitoon-netlist/1',
    title: 'Battery voltage divider',
    parts: [
      { ref: 'BT1', module: 'battery-18650-holder' },
      { ref: 'D1', module: 'led' },
      { ref: 'BB5', module: 'breadboard-mini' },
      r('R1', 330),
      r('R2', 100000),
      r('R3', 100000),
      { ref: 'J1', module: 'dupont-1x3' },
    ],
    nets: [
      { name: 'BAT', pins: ['BT1.+', 'R2.1'] },
      { name: '5V', pins: ['R1.1', 'J1.1'] },
      { name: 'LED_ON', pins: ['R1.2', 'D1.A'] },
      { name: 'VSENSE', pins: ['R2.2', 'R3.1', 'J1.3'] },
      { name: 'GND', pins: ['BT1.-', 'R3.2', 'D1.K', 'J1.2'] },
    ],
    wires: { ends: 'dupont-male' },
  }
}

/**
 * A battery on `rails` rail strips feeding `pairs` resistor and LED pairs (a repeat with only shared
 * ports), plus an ESP32 with a BME280 on I2C: 4 + rails + 2 * pairs parts.
 */
export function ledRails(pairs: number, rails: number) {
  const railRefs = Array.from({ length: rails }, (_, i) => `RAIL${i + 1}`)
  return {
    format: 'circuitoon-netlist/1',
    title: `${pairs} LEDs on ${rails} rail strip${rails === 1 ? '' : 's'}`,
    parts: [
      { ref: 'BT1', module: 'battery-holder-2xaa' },
      ...railRefs.map((ref) => ({ ref, module: 'power-rail-strip' })),
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      { ref: 'U2', module: 'bme280-module-4pin' },
    ],
    nets: [
      { name: 'VCC', pins: ['BT1.+', ...railRefs.map((r) => `${r}.+`)] },
      { name: 'GND', pins: ['BT1.-', ...railRefs.map((r) => `${r}.-`)] },
      { name: '3V3', pins: ['U1.3V3', 'U2.VIN'] },
      { name: 'GND_MCU', pins: ['U1.GND', 'U2.GND'] },
      { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
      { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
    ],
    repeat: {
      name: 'led',
      count: pairs,
      template: {
        parts: [{ ref: 'R', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } } }, { ref: 'D', module: 'led' }],
        nets: [{ name: 'VCC', pins: ['R.1'] }, { name: 'MID', pins: ['R.2', 'D.A'] }, { name: 'GND', pins: ['D.K'] }],
        ports: ['VCC', 'GND'],
      },
      bindings: Array.from({ length: pairs }, () => ({})),
      shared: { VCC: 'VCC', GND: 'GND' },
    },
    wires: { ends: 'dupont-male' },
  }
}

/**
 * The Spirit-Typewriter-like topology (spec 10): an ESP32 DevKitC, three MCP23017 (DIP-28) on half
 * breadboards, 42 balls of two tilt switches each sharing one expander channel (a repeat with
 * explicit bindings), two ST7796S SPI LCDs, an SSD1306 OLED, a microSD module, an 18650 and IP5306
 * power chain and a KCD1 rocker switch. 98 parts. The LCD data pins are `SDI(MOSI)` and
 * `SDO(MISO)`, their exact names in the catalog (amendment A4).
 */
export function typewriter() {
  const boards = ['BB1', 'BB2', 'BB3']
  const bank = (u: string, b: string) => Array.from({ length: 8 }, (_, i) => `${u}.GP${b}${i}`)
  const channels = [...bank('U2', 'A'), ...bank('U2', 'B'), ...bank('U3', 'A'), ...bank('U3', 'B'), ...bank('U4', 'A'), 'U4.GPB0', 'U4.GPB1']
  return {
    format: 'circuitoon-netlist/1',
    title: 'Spirit Typewriter (layout fixture)',
    parts: [
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      ...boards.map((ref) => ({ ref, module: 'breadboard-half' })),
      ...boards.map((b, i) => ({ ref: `U${i + 2}`, module: 'mcp23017-dip28', on: b })),
      { ref: 'DS1', module: 'lcd-st7796s-4in-spi-touch' },
      { ref: 'DS2', module: 'lcd-st7796s-4in-spi-touch' },
      { ref: 'DS3', module: 'oled-ssd1306-096-i2c' },
      { ref: 'SD1', module: 'microsd-spi-3v3' },
      { ref: 'BT1', module: 'battery-18650-holder' },
      { ref: 'U5', module: 'ip5306-usbc-module' },
      { ref: 'SW1', module: 'rocker-switch-kcd1' },
    ],
    nets: [
      { name: '3V3', pins: ['U1.3V3', 'U2.VDD', 'U3.VDD', 'U4.VDD', 'U2.RESET', 'U3.RESET', 'U4.RESET', 'U3.A0', 'U4.A1', 'DS1.VCC', 'DS1.LED', 'DS2.VCC', 'DS2.LED', 'DS3.VCC', 'SD1.3V3', ...boards.flatMap((b) => [`${b}.top+`, `${b}.bottom+`])] },
      { name: 'GND', pins: ['U1.GND', 'U2.VSS', 'U3.VSS', 'U4.VSS', 'U2.A0', 'U2.A1', 'U2.A2', 'U3.A1', 'U3.A2', 'U4.A0', 'U4.A2', 'DS1.GND', 'DS2.GND', 'DS3.GND', 'SD1.GND', 'BT1.-', 'U5.B-', 'U5.5V-', ...boards.flatMap((b) => [`${b}.top-`, `${b}.bottom-`])] },
      { name: 'SCL', pins: ['U1.IO22', 'U2.SCL', 'U3.SCL', 'U4.SCL', 'DS3.SCL'] },
      { name: 'SDA', pins: ['U1.IO21', 'U2.SDA', 'U3.SDA', 'U4.SDA', 'DS3.SDA'] },
      { name: 'SCK', pins: ['U1.IO18', 'DS1.SCK', 'DS2.SCK', 'SD1.CLK'] },
      { name: 'MOSI', pins: ['U1.IO23', 'DS1.SDI(MOSI)', 'DS2.SDI(MOSI)', 'SD1.MOSI'] },
      { name: 'MISO', pins: ['U1.IO19', 'DS1.SDO(MISO)', 'DS2.SDO(MISO)', 'SD1.MISO'] },
      { name: 'LCD_DC', pins: ['U1.IO4', 'DS1.DC/RS', 'DS2.DC/RS'] },
      { name: 'LCD_RST', pins: ['U1.IO16', 'DS1.RESET', 'DS2.RESET'] },
      { name: 'LCD1_CS', pins: ['U1.IO5', 'DS1.CS'] },
      { name: 'LCD2_CS', pins: ['U1.IO17', 'DS2.CS'] },
      { name: 'SD_CS', pins: ['U1.IO13', 'SD1.CS'] },
      { name: 'BAT', pins: ['BT1.+', 'U5.B+'] },
      { name: 'VSW', pins: ['U5.5V+', 'SW1.1'] },
      { name: '5V', pins: ['SW1.2', 'U1.5V'] },
    ],
    repeat: {
      name: 'ball',
      count: channels.length,
      template: {
        parts: [{ ref: 'SA', module: 'tilt-switch-sw520d' }, { ref: 'SB', module: 'tilt-switch-sw520d' }],
        nets: [{ name: 'CH', pins: ['SA.1', 'SB.1'] }, { name: 'GND', pins: ['SA.2', 'SB.2'] }],
        ports: ['CH', 'GND'],
      },
      bindings: channels.map((ch) => ({ CH: ch })),
      shared: { GND: 'GND' },
    },
    groups: [
      { name: 'Power', parts: ['BT1', 'U5', 'SW1'] },
      { name: 'Displays', parts: ['DS1', 'DS2', 'DS3', 'SD1'] },
    ],
    notes: [{ text: 'Each ball holds two tilt switches wired in parallel on one expander channel.', near: 'U2' }],
    wires: { ends: 'dupont-male' },
  }
}

/** An MCP23017 DIP-28 seated across a half breadboard with every pin wired to a Dupont header through its strip (Ruling C3). */
export function dipWired() {
  const names = ['GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC 2', 'GPA7', 'GPA6', 'GPA5', 'GPA4', 'GPA3', 'GPA2', 'GPA1', 'GPA0', 'INTA', 'INTB', 'RESET', 'A2', 'A1', 'A0']
  return {
    format: 'circuitoon-netlist/1',
    title: 'DIP-28 on a half breadboard',
    parts: [
      { ref: 'BB1', module: 'breadboard-half' },
      { ref: 'U1', module: 'mcp23017-dip28', on: 'BB1' },
      ...Array.from({ length: 7 }, (_, i) => ({ ref: `J${i + 1}`, module: 'dupont-1x4' })),
    ],
    nets: names.map((n, i) => ({ name: `N${i + 1}`, pins: [`U1.${n}`, `J${Math.floor(i / 4) + 1}.${(i % 4) + 1}`] })),
    wires: { ends: 'dupont-male' },
  }
}
