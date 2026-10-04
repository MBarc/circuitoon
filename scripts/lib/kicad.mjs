// The KiCad mapping (`kicad` field, PRD "KiCad mapping") of every generated built-in part, applied
// by the module generators as they write each file (`moduleText`). Hand-written parts carry their
// `kicad` field in their own JSON. Footprint and symbol names are KiCad's standard libraries
// (gitlab.com/kicad/libraries/kicad-footprints, kicad-symbols); pad numbers were read from each
// footprint file. src/format/kicadFootprints.testing.ts lists every footprint used with its pads,
// and src/format/kicadMap.test.ts checks each mapping against it.
//
// Pad numbering follows the part's physical pin order: header pin 1 is the first pin in the order
// the module lists them (the order the generator transcribed from the board), a chip's pad is its
// package pin number. A part whose layout is not known well enough is left unmapped (see UNMAPPED):
// a wrong pad is worse than a missing one.

const pad2 = (n) => String(n).padStart(2, '0')
/** A 0.1 in socket strip a breakout's header pins plug into. */
export const socket = (n) => `Connector_PinSocket_2.54mm:PinSocket_1x${pad2(n)}_P2.54mm_Vertical`
/** A 0.1 in pin header (a Dupont housing or a servo cable plugs onto it; wire leads solder to it). */
export const pinHeader = (n) => `Connector_PinHeader_2.54mm:PinHeader_1x${pad2(n)}_P2.54mm_Vertical`
/** A JST-XH top-entry header: a 2.5 mm wire-to-board connector for leads. */
export const jstXh = (n) => `Connector_JST:JST_XH_B${n}B-XH-A_1x${pad2(n)}_P2.50mm_Vertical`
/** A 5.0 mm screw terminal (Phoenix MKDS 1,5): the stand-in a mains part is wired to. */
export const screwTerminal = (n) => `TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-${n}_1x${pad2(n)}_P5.00mm_Horizontal`

// USB ports are never header pads: each comes in as its own USB connector (src/format/kicad.ts).
const names = (m, side) => m.pins.filter((p) => !p.spacer && p.side === side && p.type !== 'usb').map((p) => p.name)
const numbered = (list) => Object.fromEntries(list.map((n, i) => [n, String(i + 1)]))
/** One footprint for the pins of one side, pad 1 the first pin. */
const oneRow = (m, side, fp = socket) => {
  const list = names(m, side)
  return { footprint: fp(list.length), pins: numbered(list) }
}
/** One header per side, each a strip numbered in pin order from the side's first pin. */
const rows = (m, sides, fp = socket) => ({
  headers: sides.map((s) => {
    const list = names(m, s)
    return { name: `${s} header, pin 1 ${list[0]}`, footprint: fp(list.length), pins: numbered(list) }
  }),
})
/** Two named groups of pins as headers. */
const groups = (list) => ({ headers: list.map(([name, pins, fp]) => ({ name, footprint: fp(pins.length), pins: numbered(pins) })) })

const WIRE_PADS = 'The module has solder pads, not header pins: wire them to these headers.'

// Dev boards: one socket strip per header row. The row spacing differs between makers and clones
// (the 38-pin ESP32 boards come 0.9 in and 1.0 in wide), and KiCad has no footprint for most of
// them, so each row is its own footprint to place at the board's real spacing.
const BOARD_NOTE = 'Each header is its own socket strip: place them at the board\'s real row spacing.'
const devBoard = (m) => ({ ...rows(m, ['left', 'right']), note: BOARD_NOTE })

/** The Pico family: KiCad's Pico footprint, pads 1-20 down the left, 21-40 up the right. The three debug pads are not on it. */
const pico = (symbol) => (m) => {
  const pins = {}
  names(m, 'left').forEach((n, i) => (pins[n] = String(i + 1)))
  names(m, 'right').forEach((n, i) => (pins[n] = String(40 - i)))
  return {
    ...(symbol ? { symbol } : {}),
    footprint: 'Module:RaspberryPi_Pico_Common_THT',
    pins,
    note: 'The debug pads (SWCLK, GND, SWDIO) are not on this footprint.',
  }
}

/** A DIP-28 chip drawn pins 1-14 along the bottom (left to right) and 28-15 along the top. */
const dip28 = (symbol, value) => (m) => {
  const pins = {}
  names(m, 'bottom').forEach((n, i) => (pins[n] = String(i + 1)))
  names(m, 'top').forEach((n, i) => (pins[n] = String(28 - i)))
  return { symbol, footprint: 'Package_DIP:DIP-28_W7.62mm', pins, value }
}

/** A mains part wired to the board: a screw terminal stand-in, its pads in `pins` order. */
const mainsTerminal = (pins, note) => {
  const pads = [...new Set(Object.values(pins))].length
  return { footprint: screwTerminal(pads), pins, placeholder: true, note }
}
const OUTLET_NOTE = 'Placeholder: an outlet is a panel part; wire it to this terminal block. Choose a terminal rated for the mains current.'
const PLUG_NOTE = 'Placeholder: a cord plug is not a board part; this terminal block is where its cord would land. Choose a terminal rated for the mains current.'

/** A terminal block whose wire side and board side ("1" and "1 pcb") are the same pad. */
const terminalBlock = (n, footprint, note) => {
  const pins = {}
  for (let i = 1; i <= n; i++) {
    pins[String(i)] = String(i)
    pins[`${i} pcb`] = String(i)
  }
  return { footprint, pins, ...(note ? { note } : {}) }
}

// The Arduino family (gen-arduino.mjs). Uno-shaped boards fit KiCad's Module:Arduino_UNO_R3, whose
// pads (and the MCU_Module:Arduino_UNO_R3 / Arduino_Leonardo symbols) run 1-8 down the power
// header, 9-14 the analog one, then 15 D0 up the digital side to 32 at its top (SCL): the module
// lists the left side top to bottom (pad 1 first) and the right side top to bottom (pad 32 first).
// Nano-shaped boards use Module:Arduino_Nano as the Nano does. Mega, Due, Micro and Pro Mini have no
// KiCad footprint: one socket strip per header.
const unoR3 = (value, symbol, skip = []) => (m) => {
  const pins = {}
  names(m, 'left').filter((n) => !skip.includes(n)).forEach((n, i) => (pins[n] = String(i + 1)))
  names(m, 'right').forEach((n, i) => (pins[n] = String(32 - i)))
  return {
    ...(symbol ? { symbol } : {}), footprint: 'Module:Arduino_UNO_R3', pins, value,
    ...(skip.length ? { note: `The ${skip.join(', ')} pins are not on this footprint.` } : {}),
  }
}
const nanoForm = (value, symbol) => (m) => {
  const pins = {}
  names(m, 'left').forEach((n, i) => (pins[n] = String(16 + i)))
  names(m, 'right').forEach((n, i) => (pins[n] = String(15 - i)))
  return { ...(symbol ? { symbol } : {}), footprint: 'Module:Arduino_Nano', pins, value }
}
/** Mega-shaped boards: three left headers (8 each), three right (10, 8, 8), the 2 x 18 as two rows from its 5V end. */
const megaForm = (value) => (m) => {
  const l = names(m, 'left'), rt = names(m, 'right')
  const ys = [...new Set(m.holes.map((g) => g.at[0][1]))].sort((a, b) => a - b)
  const row = (y) => m.holes.filter((g) => g.at[0][1] === y).sort((a, b) => b.at[0][0] - a.at[0][0]).map((g) => g.name)
  return {
    ...groups([
      ['power header, pin 1 NC', l.slice(0, 8), socket], ['analog header, pin 1 A0', l.slice(8, 16), socket], [`analog header, pin 1 ${l[16]}`, l.slice(16), socket],
      [`digital header, pin 1 ${rt[0]}`, rt.slice(0, 10), socket], ['digital header, pin 1 D7', rt.slice(10, 18), socket], ['communication header, pin 1 D14', rt.slice(18), socket],
      ['2 x 18 header, even row, pin 1 5V', row(ys[0]), socket], ['2 x 18 header, odd row, pin 1 5V', row(ys[1]), socket],
    ]),
    value,
    note: 'Each header is its own socket strip: place them at the board\'s real positions.',
  }
}
const proMini = (value) => (m) => ({
  ...groups([
    ['left header, pin 1 TXO', names(m, 'left'), socket], ['right header, pin 1 RAW', names(m, 'right'), socket],
    ['programming header, pin 1 BLK', names(m, 'top'), socket], ['A4 A5 pads', ['A4', 'A5'], socket], ['A6 A7 pads', ['A6', 'A7'], socket],
  ]),
  value,
  note: 'Each header is its own socket strip: place them at the board\'s real positions.',
})
const ARDUINO = {
  'arduino-uno-r3': unoR3('Arduino Uno R3', 'MCU_Module:Arduino_UNO_R3'),
  'arduino-uno-r4-minima': unoR3('Arduino Uno R4 Minima'),
  'arduino-uno-r4-wifi': unoR3('Arduino Uno R4 WiFi', undefined, ['OFF', 'GND 4', 'VRTC']),
  'arduino-leonardo': unoR3('Arduino Leonardo', 'MCU_Module:Arduino_Leonardo'),
  'arduino-zero': unoR3('Arduino Zero'),
  'arduino-mega-2560': megaForm('Arduino Mega 2560'),
  'arduino-due': megaForm('Arduino Due'),
  'arduino-micro': (m) => ({ ...devBoard(m), value: 'Arduino Micro' }),
  'arduino-nano-every': nanoForm('Arduino Nano Every', 'MCU_Module:Arduino_Nano_Every'),
  'arduino-nano-33-iot': nanoForm('Arduino Nano 33 IoT'),
  'arduino-nano-33-ble': nanoForm('Arduino Nano 33 BLE'),
  'arduino-nano-esp32': nanoForm('Arduino Nano ESP32', 'MCU_Module:Arduino_Nano_ESP32'),
  'arduino-nano-rp2040-connect': nanoForm('Arduino Nano RP2040 Connect', 'MCU_Module:Arduino_Nano_RP2040_Connect'),
  'arduino-pro-mini-5v': proMini('Arduino Pro Mini 5V'),
  'arduino-pro-mini-3v3': proMini('Arduino Pro Mini 3.3V'),
}

const KICAD = {
  // Microcontrollers
  'esp32-devkit-v1-30': devBoard,
  'esp32-devkitc-v4': devBoard,
  'esp32-s3-devkitc-1': devBoard,
  'esp32-c3-supermini': devBoard,
  'esp32-cam': devBoard,
  'xiao-esp32c3': devBoard,
  'xiao-esp32s3': devBoard,
  'wemos-d1-mini': devBoard,
  // KiCad's Nano footprint and symbol number the pins as Arduino does: 1 D1/TX ... 15 D12 down one
  // side, 16 D13 ... 30 VIN up the other. The module draws D13 ... VIN on the left, D12 ... TX1 on the right.
  'arduino-nano': (m) => {
    const pins = {}
    names(m, 'left').forEach((n, i) => (pins[n] = String(16 + i)))
    names(m, 'right').forEach((n, i) => (pins[n] = String(15 - i)))
    return { symbol: 'MCU_Module:Arduino_Nano_v3.x', footprint: 'Module:Arduino_Nano', pins, value: 'Arduino Nano' }
  },
  ...ARDUINO,
  'rpi-pico': pico('MCU_Module:RaspberryPi_Pico'),
  'rpi-pico-h': pico('MCU_Module:RaspberryPi_Pico'),
  'rpi-pico-w': pico('MCU_Module:RaspberryPi_Pico_W'),
  'rpi-pico-2': pico(),
  'rpi-pico-2-w': pico(),

  // Chips
  'mcp23017-dip28': dip28('Interface_Expansion:MCP23017x-x-SP', 'MCP23017'),
  'mcp23018-dip28': dip28('Interface_Expansion:MCP23018x-x-SP', 'MCP23018'),
  // Three 1x10 rows of pads (two side by side, one apart): a socket strip each, numbered top to bottom.
  'mcp23017-cjmcu-2317': (m) => {
    const cols = [...new Set(m.holes.map((g) => g.at[0][0]))].sort((a, b) => a - b)
    const headers = cols.map((x, i) => {
      const list = m.holes.filter((g) => g.at[0][0] === x).sort((a, b) => a.at[0][1] - b.at[0][1]).map((g) => g.name)
      return { name: `row ${i + 1} of 3 (chip side, left to right), pin 1 ${list[0]}`, footprint: socket(list.length), pins: numbered(list) }
    })
    return { headers, value: 'CJMCU-2317', note: 'Each row is its own socket strip: place them as the board\'s rows sit.' }
  },

  // Displays: the main header, and the SD card header on the far edge where the board has one.
  'lcd-st7796s-4in-spi-touch': (m) => ({ ...rows(m, ['left', 'right']), value: 'ST7796S 4.0in' }),
  'tft-ili9341-28-spi-touch': (m) => ({ ...rows(m, ['left', 'right']), value: 'ILI9341 2.8in' }),
  'tft-ili9341-24-spi': (m) => ({ ...rows(m, ['left', 'right']), value: 'ILI9341 2.4in' }),
  'tft-st7735-18-spi': (m) => ({ ...rows(m, ['left', 'right']), value: 'ST7735 1.8in' }),
  'tft-st7789-154-spi': (m) => ({ ...oneRow(m, 'top'), value: 'ST7789 1.54in' }),
  'oled-ssd1306-096-i2c': (m) => ({ ...oneRow(m, 'top'), value: 'SSD1306 0.96in' }),
  'oled-ssd1306-096-i2c-vcc-gnd': (m) => ({ ...oneRow(m, 'top'), value: 'SSD1306 0.96in' }),
  'oled-sh1106-13-i2c': (m) => ({ ...oneRow(m, 'top'), value: 'SH1106 1.3in' }),
  'oled-sh1106-13-i2c-vcc-gnd': (m) => ({ ...oneRow(m, 'top'), value: 'SH1106 1.3in' }),
  'oled-ssd1306-091-i2c': (m) => ({ ...oneRow(m, 'left'), value: 'SSD1306 0.91in' }),

  // Communication
  'microsd-spi-3v3': (m) => ({ ...oneRow(m, 'left'), value: 'microSD 3.3V' }),
  'microsd-spi-5v': (m) => ({ ...oneRow(m, 'left'), value: 'microSD 5V' }),
  'level-shifter-bss138-4ch': (m) => ({ ...rows(m, ['top', 'bottom']), value: 'BSS138 level shifter' }),
  // The bottom header and the G1-G5 row above it; ANT is the antenna pad, not a header pin.
  'rfm95-lora-breakout': (m) => ({
    ...groups([
      ['bottom header, pin 1 VIN', names(m, 'bottom'), socket],
      ['top row, pin 1 G1', names(m, 'top').filter((n) => n !== 'ANT'), socket],
    ]),
    value: 'RFM95W',
    note: 'ANT is the antenna pad, not on these headers.',
  }),

  // GPS: the 4-pin header; ANT is the u.FL jack on the module, not a header pin.
  'gps-neo-m8n-gy-gpsv3': (m) => ({ ...oneRow(m, 'top'), value: 'GY-NEO-M8N', note: 'ANT is the u.FL jack on the module, not on this header.' }),

  // Raspberry Pi 4, 5 and Zero 2 W: the 40-pin header as the 2 x 20 socket a Pi plugs onto, pad n the
  // header's physical pin n (the hole groups are in physical order, gen-usb.mjs). The camera and
  // display connectors are flat-cable sockets, not on it; the USB ports come in as USB connectors.
  ...Object.fromEntries(['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w'].map((id) => [id, (m) => ({
    footprint: 'Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical',
    pins: Object.fromEntries(m.holes.map((g, i) => [g.name, String(i + 1)])),
    value: m.name,
    note: 'The 40-pin header as the 2 x 20 socket the Pi plugs onto; the camera and display connectors are not on it.',
  })])),

  // Sensors
  'bme280-module-4pin': (m) => ({ ...oneRow(m, 'bottom'), value: 'BME280' }),
  'bme280-module-6pin': (m) => ({ ...oneRow(m, 'bottom'), value: 'GY-BME280' }),
  'dht22-module': (m) => ({ ...oneRow(m, 'bottom'), value: 'DHT22 module' }),
  // DHT22 is ASAIR's AM2302: pins 1 VCC, 2 DATA, 3 NC, 4 GND, as the module draws them.
  'dht22-bare': () => ({ footprint: 'Sensor:ASAIR_AM2302_P2.54mm_Vertical', pins: { VCC: '1', DATA: '2', NC: '3', GND: '4' }, value: 'DHT22' }),
  // TDK's DS-000069 pin numbers, which KiCad's ICS-43434 symbol and footprint use.
  'mic-ics-43434': () => ({ symbol: 'Sensor_Audio:ICS-43434', footprint: 'Sensor_Audio:InvenSense_ICS-43434-6_3.5x2.65mm', pins: { WS: '1', LR: '2', GND: '3', SCK: '4', VDD: '5', SD: '6' }, value: 'ICS-43434' }),
  'mic-ics-43434-adafruit-6049': (m) => ({ ...oneRow(m, 'bottom'), value: 'ICS-43434 breakout' }),
  'pir-hc-sr501': (m) => ({ ...oneRow(m, 'bottom'), value: 'HC-SR501' }),
  'ultrasonic-hc-sr04': (m) => ({ ...oneRow(m, 'bottom'), value: 'HC-SR04' }),
  'tilt-switch-sw520d': () => ({ footprint: pinHeader(2), pins: { 1: '1', 2: '2' }, value: 'SW-520D', note: 'Solder the switch\'s two leads into these pads.' }),
  'tilt-switch-sw460d': () => ({ footprint: 'Resistor_THT:R_Axial_DIN0617_L17.0mm_D6.0mm_P20.32mm_Horizontal', pins: { 1: '1', 2: '2' }, value: 'SW-460D', note: 'An axial footprint long enough for the 15 mm tube.' }),

  // Indicators
  // Worldsemi numbers the legs 1 DOUT, 2 VDD, 3 GND, 4 DIN; KiCad's 4-lead 5 mm LED has pads 1-4 in a row.
  'ws2812d-5mm': () => ({ footprint: 'LED_THT:LED_D5.0mm-4_RGB', pins: { DOUT: '1', VDD: '2', GND: '3', DIN: '4' }, value: 'WS2812D-F5' }),
  'ws2812b-strip': (m) => ({
    ...groups([
      ['input leads, pin 1 GND', names(m, 'left'), jstXh],
      ['output leads, pin 1 GND', names(m, 'right'), jstXh],
    ]),
    value: 'WS2812B strip',
    note: 'The strip is wired to the board: a lead connector for each end.',
  }),

  // Power
  'ip5306-usbc-module': (m) => ({
    ...groups([
      ['battery pads, pin 1 B-', names(m, 'left'), pinHeader],
      ['bottom pads, pin 1 K', names(m, 'bottom'), pinHeader],
    ]),
    value: 'IP5306 module',
    note: WIRE_PADS,
  }),
  'tp4056-module': (m) => ({
    ...groups([
      ['input pads, pin 1 IN+', names(m, 'left'), pinHeader],
      ['output pads, pin 1 OUT+', names(m, 'right'), pinHeader],
    ]),
    value: 'TP4056 module',
    note: WIRE_PADS,
  }),
  'lm2596-buck-module': (m) => ({
    ...groups([
      ['input pads, pin 1 IN+', names(m, 'left'), pinHeader],
      ['output pads, pin 1 OUT+', names(m, 'right'), pinHeader],
    ]),
    value: 'LM2596 module',
    note: WIRE_PADS,
  }),
  'ams1117-33-module': (m) => ({ ...oneRow(m, 'bottom'), value: 'AMS1117-3.3 module' }),

  // Motors and actuators
  'servo-sg90': (m) => ({ ...oneRow(m, 'left', pinHeader), value: 'SG90', note: 'The servo cable plugs onto this header.' }),
  'relay-module-1ch-5v': (m) => ({
    headers: [
      { name: 'contacts NO COM NC (screw terminal on the module)', footprint: screwTerminal(3), pins: numbered(names(m, 'left')) },
      { name: 'control header, pin 1 IN', footprint: socket(3), pins: numbered(names(m, 'right')) },
    ],
    value: 'Relay module 5V',
    placeholder: true,
    note: 'Placeholder for the contacts: they are screw terminals on the module, wired to this terminal block. Rate it for what the relay switches.',
  }),

  // Connectors
  'jst-xh-2': () => ({ footprint: jstXh(2), pins: { 1: '1', 2: '2' } }),
  'jst-xh-3': () => ({ footprint: jstXh(3), pins: { 1: '1', 2: '2', 3: '3' } }),
  'jst-xh-4': () => ({ footprint: jstXh(4), pins: { 1: '1', 2: '2', 3: '3', 4: '4' } }),
  'dupont-1x2': () => ({ footprint: pinHeader(2), pins: { 1: '1', 2: '2' }, note: 'The pin header the housing plugs onto.' }),
  'dupont-1x3': () => ({ footprint: pinHeader(3), pins: { 1: '1', 2: '2', 3: '3' }, note: 'The pin header the housing plugs onto.' }),
  'dupont-1x4': () => ({ footprint: pinHeader(4), pins: { 1: '1', 2: '2', 3: '3', 4: '4' }, note: 'The pin header the housing plugs onto.' }),
  'usb-panel-mount-microusb': (m) => ({ ...oneRow(m, 'right', pinHeader), value: 'USB panel mount', note: 'The cable\'s leads solder to this header.' }),
  'usb-panel-mount-usbc': (m) => ({ ...oneRow(m, 'right', pinHeader), value: 'USB-C panel mount', note: 'The cable\'s leads solder to this header.' }),

  // Switches
  // Both footprints have two pads named 1 and two named 2; each pair is a leg pair the switch joins.
  'tactile-switch-6mm-4pin': () => ({ symbol: 'Switch:SW_Push', footprint: 'Button_Switch_THT:SW_PUSH_6mm', pins: { 1: '1', 2: '1', 3: '2', 4: '2' } }),
  'tactile-switch-12mm-4pin': () => ({ symbol: 'Switch:SW_Push', footprint: 'Button_Switch_THT:SW_PUSH-12mm', pins: { 1: '1', 2: '1', 3: '2', 4: '2' } }),
  'potentiometer-panel-10k': () => ({ symbol: 'Device:R_Potentiometer', footprint: jstXh(3), pins: { 1: '1', W: '2', 3: '3' }, note: 'A panel potentiometer is wired to the board: a lead connector, wiper on pin 2.' }),

  // Mains: real footprints where the part is a board part, stand-ins where it is wired to the board.
  'hlk-pm01': () => ({ symbol: 'Converter_ACDC:HLK-PM01', footprint: 'Converter_ACDC:Converter_ACDC_Hi-Link_HLK-PMxx', pins: { 'AC 1': '1', 'AC 2': '2', '-Vo': '3', '+Vo': '4' }, value: 'HLK-PM01' }),
  'hlk-pm03': () => ({ symbol: 'Converter_ACDC:HLK-PM03', footprint: 'Converter_ACDC:Converter_ACDC_Hi-Link_HLK-PMxx', pins: { 'AC 1': '1', 'AC 2': '2', '-Vo': '3', '+Vo': '4' }, value: 'HLK-PM03' }),
  'irm-03-5': () => ({ symbol: 'Converter_ACDC:IRM-03-5', footprint: 'Converter_ACDC:Converter_ACDC_MeanWell_IRM-03-xx_THT', pins: { 'AC/L': '1', 'AC/N': '3', '-V': '14', '+V': '16' }, value: 'IRM-03-5' }),
  'irm-03-3v3': () => ({ symbol: 'Converter_ACDC:IRM-03-3.3', footprint: 'Converter_ACDC:Converter_ACDC_MeanWell_IRM-03-xx_THT', pins: { 'AC/L': '1', 'AC/N': '3', '-V': '14', '+V': '16' }, value: 'IRM-03-3.3' }),
  'irm-05-5': () => ({ symbol: 'Converter_ACDC:IRM-05-5', footprint: 'Converter_ACDC:Converter_ACDC_MeanWell_IRM-05-xx_THT', pins: { 'AC/N': '1', 'AC/L': '2', '-V': '3', '+V': '4' }, value: 'IRM-05-5' }),
  'lamp-holder-e26': () => mainsTerminal({ L: '1', N: '2' }, 'Placeholder: a lamp holder is wired to the board through this terminal block. Choose one rated for the lamp.'),
  'lamp-holder-e27': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, 'Placeholder: a lamp holder is wired to the board through this terminal block. Choose one rated for the lamp.'),
  'fuse-holder-5x20-inline': () => mainsTerminal({ 1: '1', 2: '2' }, 'Placeholder: an in-line fuse holder lives on the cable. On a board, use a PCB fuse holder for 5 x 20 mm fuses instead.'),
  'ssr-fotek-25da': () => ({
    headers: [
      { name: 'load terminals 1 2', footprint: screwTerminal(2), pins: { 1: '1', 2: '2' } },
      { name: 'control terminals 4 (-) 3 (+)', footprint: screwTerminal(2), pins: { 4: '1', 3: '2' } },
    ],
    value: 'SSR-25DA',
    placeholder: true,
    note: 'Placeholder: the relay is panel-mounted with screw terminals; these terminal blocks are where its wires land. Keep the load side apart from the control side.',
  }),
  'terminal-block-mstb-508-2': () => terminalBlock(2, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_2-G-5,08_1x02_P5.08mm_Horizontal'),
  'terminal-block-mstb-508-3': () => terminalBlock(3, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_3-G-5,08_1x03_P5.08mm_Horizontal'),
  'terminal-block-mstb-508-4': () => terminalBlock(4, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_4-G-5,08_1x04_P5.08mm_Horizontal'),
  'terminal-block-mstb-508-5': () => terminalBlock(5, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_5-G-5,08_1x05_P5.08mm_Horizontal'),
  'terminal-block-mstb-508-6': () => terminalBlock(6, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_6-G-5,08_1x06_P5.08mm_Horizontal'),
  'terminal-block-mc-381-2': () => terminalBlock(2, 'Connector_Phoenix_MC:PhoenixContact_MC_1,5_2-G-3.81_1x02_P3.81mm_Horizontal'),
  'terminal-block-mc-381-3': () => terminalBlock(3, 'Connector_Phoenix_MC:PhoenixContact_MC_1,5_3-G-3.81_1x03_P3.81mm_Horizontal'),
  'terminal-block-mc-381-4': () => terminalBlock(4, 'Connector_Phoenix_MC:PhoenixContact_MC_1,5_4-G-3.81_1x04_P3.81mm_Horizontal'),
  'terminal-block-mc-381-5': () => terminalBlock(5, 'Connector_Phoenix_MC:PhoenixContact_MC_1,5_5-G-3.81_1x05_P3.81mm_Horizontal'),
  'terminal-block-mc-381-6': () => terminalBlock(6, 'Connector_Phoenix_MC:PhoenixContact_MC_1,5_6-G-3.81_1x06_P3.81mm_Horizontal'),
  'terminal-block-kf2edg-508-2': () => terminalBlock(2, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_2-G-5,08_1x02_P5.08mm_Horizontal', 'A clone of the Phoenix MSTBA header: check its hole size against the clone\'s datasheet.'),
  'terminal-block-kf2edg-508-3': () => terminalBlock(3, 'Connector_Phoenix_MSTB:PhoenixContact_MSTBA_2,5_3-G-5,08_1x03_P5.08mm_Horizontal', 'A clone of the Phoenix MSTBA header: check its hole size against the clone\'s datasheet.'),
  'terminal-block-kf301-500-2': () => terminalBlock(2, screwTerminal(2), 'A clone of the Phoenix MKDS 1,5: check its hole size against the clone\'s datasheet.'),
  'terminal-block-kf301-500-3': () => terminalBlock(3, screwTerminal(3), 'A clone of the Phoenix MKDS 1,5: check its hole size against the clone\'s datasheet.'),
  'outlet-us-5-15r-duplex': () => mainsTerminal({ L1: '1', L2: '1', N1: '2', N2: '2', PE1: '3', PE2: '3' }, OUTLET_NOTE),
  'outlet-us-5-20r-duplex': () => mainsTerminal({ L1: '1', L2: '1', N1: '2', N2: '2', PE1: '3', PE2: '3' }, OUTLET_NOTE),
  'outlet-jp-1-15r-duplex': () => mainsTerminal({ L1: '1', L2: '1', N1: '2', N2: '2' }, OUTLET_NOTE),
  'outlet-jp-1-15r-duplex-polarized': () => mainsTerminal({ L1: '1', L2: '1', N1: '2', N2: '2' }, OUTLET_NOTE),
  'outlet-uk-bs1363': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, OUTLET_NOTE),
  'outlet-schuko-cee7-3': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, OUTLET_NOTE),
  'outlet-fr-cee7-5': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, OUTLET_NOTE),
  'outlet-au-as3112': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, OUTLET_NOTE),
  'plug-us-5-15p': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, PLUG_NOTE),
  'plug-us-1-15p': () => mainsTerminal({ L: '1', N: '2' }, PLUG_NOTE),
  'plug-jp-1-15p': () => mainsTerminal({ L: '1', N: '2' }, PLUG_NOTE),
  'plug-eu-cee7-7': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, PLUG_NOTE),
  'plug-eu-cee7-16': () => mainsTerminal({ L: '1', N: '2' }, PLUG_NOTE),
  'plug-uk-bs1363-3lead': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, PLUG_NOTE),
  'plug-uk-bs1363-2lead': () => mainsTerminal({ L: '1', N: '2' }, PLUG_NOTE),
  'plug-au-as3112-3lead': () => mainsTerminal({ L: '1', N: '2', PE: '3' }, PLUG_NOTE),
  'plug-au-as3112-2lead': () => mainsTerminal({ L: '1', N: '2' }, PLUG_NOTE),
  // Wall adapters reach the board through their DC plug: the barrel jack it plugs into (pad 1 the centre pin).
  ...Object.fromEntries(['us', 'eu', 'uk', 'au'].flatMap((c) => [
    [`adapter-barrel-${c}`, () => ({ footprint: 'Connector_BarrelJack:BarrelJack_Horizontal', pins: { '+': '1', '-': '2' }, value: 'DC jack', note: 'The jack the adapter plugs into; pad 1 is the centre pin, so this assumes a centre-positive adapter.' })],
    [`charger-usb-5v-${c}`, () => ({ footprint: jstXh(2), pins: { '5V': '1', GND: '2' }, value: 'USB 5V input', note: 'The charger reaches the board through a cable: a 2-pin lead connector for its 5V and GND.' })],
  ])),
}

/**
 * Generated parts deliberately left without a mapping, and why (the exporter gives them a generic
 * pin header and a warning). Kept here so a new part is a choice, not an omission.
 */
export const UNMAPPED = {
  'l298n-module': 'The real board\'s logic header (ENA and ENB jumper pins beside IN1-IN4) is not transcribed pin for pin.',
  'esp32-terminal-board-38': 'A carrier board with screw terminals: it is wired to, not mounted on, a PCB.',
  'lcd-rpi-touch-display-7': 'A panel wired to the Pi by its DSI flat cable and jumper wires: it is not mounted on a PCB.',
  'lcd-rpi-touch-display-2-7': 'A panel wired to the Pi by its DSI flat cable and power lead: it is not mounted on a PCB.',
  'lcd-rpi-touch-display-2-5': 'A panel wired to the Pi by its DSI flat cable and power lead: it is not mounted on a PCB.',
  'computer-usb-port': 'A computer: only its USB port comes in, as a USB connector (src/format/kicad.ts).',
  'usb-hub-fe11s-circuitneato': 'A hub board cabled to the project, not mounted on it; its USB ports come in as USB connectors.',
  'usb-hub-powered-4port': 'A boxed hub cabled to the project; its USB ports come in as USB connectors.',
  'rtl-sdr-blog-v4': 'A USB dongle: its plug comes in as a USB connector (src/format/kicad.ts), and the SMA antenna jack stays on the dongle.',
  'mic-ics-40300': 'KiCad has no footprint for its land pattern: Knowles_LGA-6_4.72x3.76mm (same size) puts the port ring 3.29 mm from the pad row, the ICS-40300 2.62 mm.',
  'mic-spu0410lr5h-qb': 'KiCad has no footprint for its 3.76 x 3.00 mm LGA-6 package.',
  'wago-221-412': 'A wire splice: it joins wires off the board.',
  'wago-221-413': 'A wire splice: it joins wires off the board.',
  'wago-221-415': 'A wire splice: it joins wires off the board.',
}

/** The module's KiCad mapping, or undefined for a part without one (breadboards and the parts in UNMAPPED). */
export function kicadFor(m) {
  const f = KICAD[m.id]
  return f ? f(m) : undefined
}

/** A generated module with its KiCad mapping (last, after its art), as the JSON text written to modules/. */
export function moduleText(m) {
  const kicad = kicadFor(m)
  return JSON.stringify(kicad ? { ...m, kicad } : m, null, 2) + '\n'
}
