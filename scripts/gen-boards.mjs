// Generates the 9 built-in microcontroller board module JSON files (the ESP32 DevKitC V4, DevKit V1
// 30-pin, S3-DevKitC-1, C3 SuperMini, XIAO ESP32-C3/S3, ESP32-CAM, the Arduino Nano and the
// Wemos / LOLIN D1 mini). Pin lists are transcribed from the sources cited on each board below.
//
// Run from the repo root: `node scripts/gen-boards.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites the 9 files in modules/ in place; re-run after changing a board's pin list,
// art or the shared header/pinLabels rules here, then `git diff` the result before committing.
import { emit, finish, log } from './lib/gen-output.mjs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const PCB = '#2B2F36', CAN = '#D5DAE1', METAL = '#C9CED6', GOLD = '#E0B43C', HOLE = '#8A6A1E'
const DARK = '#1B1F24', BTN = '#3A3F47', XIAO = '#1E3A5F'

// Pin spec shorthand: 'NAME' or 'NAME|label' ; type inferred from table T.
function pinsFor(side, list, types) {
  return list.map((s) => {
    const [name, label] = s.split('|')
    const t = types(name, label ?? name)
    const p = { name, side }
    if (label) p.label = label
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    return p
  })
}
const spacers = (side, n) => Array.from({ length: n }, () => ({ spacer: true, side }))

/** Pin y positions (px) on a side of `n` slots in a body `hu` units tall, per computeLayout. */
function slotYs(hu, n) {
  const s0 = Math.ceil((hu - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * 10)
}

function headers(W, ys) {
  // A gold strip under each pin row, with a darker hole per pin.
  const shapes = []
  const y0 = ys[0] - 5, y1 = ys[ys.length - 1] + 5
  for (const x of [2, W - 10]) {
    shapes.push({ type: 'rect', x, y: y0, w: 8, h: y1 - y0, fill: GOLD, radius: 2, outline: false })
    for (const y of ys) shapes.push({ type: 'rect', x: x + 2.5, y: y - 1.5, w: 3, h: 3, fill: HOLE, radius: 1.5, outline: false })
  }
  return shapes
}

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

function build({ file, id, name, source, left, right, top = 0, bottom = 0, wu, types, art, internal }) {
  const nl = left.length + top + bottom, nr = right.length + top + bottom
  const hu = Math.max(nl, nr) + 2
  const W = wu * 10, H = hu * 10
  const slots = slotYs(hu, Math.max(nl, nr))
  const pinYs = slots.slice(top, top + Math.max(left.length, right.length))
  const pins = [
    ...spacers('left', top), ...pinsFor('left', left, types), ...spacers('left', bottom),
    ...spacers('right', top), ...pinsFor('right', right, types), ...spacers('right', bottom),
  ]
  const shapes = [r(0, 0, W, H, art.pcb ?? PCB, { radius: 5 }), ...headers(W, pinYs), ...art.shapes(W, H, pinYs)]
  const m = {
    format: 'circuitoon-module/1', id, version: 1, name, category: 'Microcontrollers', source,
    pins,
  }
  if (internal) m.internal = internal
  m.size = { w: wu, h: hu }
  m.electrical = { model: 'mcu', params: {} }
  // Every generated board is a two-row header part: pin names always draw inside the body,
  // beside each pin, like the board's own silkscreen (see art.pinLabels in the PRD).
  m.art = { w: W, h: H, pinLabels: 'inside', shapes }
  emit(OUT + file, JSON.stringify(m, null, 2) + '\n')
  log(file, 'pins', left.length + right.length, 'body', W, 'x', H, 'first/last pin y', pinYs[0], pinYs[pinYs.length - 1])
}

// Type rule shared by all boards (brief: 3V3 power_out, 5V/VIN power_in, GND ground, input-only GPIO input).
function typer({ gnd = [], v33 = [], v5 = [], inputs = [], other = {} }) {
  return (name) => {
    if (other[name]) return other[name]
    if (gnd.some((g) => name === g || name.startsWith(g + ' '))) return { type: 'ground' }
    if (v33.some((g) => name === g || name.startsWith(g + ' '))) return { type: 'power_out', supply: '3V3' }
    if (v5.includes(name)) return { type: 'power_in', supply: '5V' }
    if (inputs.includes(name)) return { type: 'input' }
    return {}
  }
}

// Shared art bits
const usbMicro = (W, H, top) => r(W / 2 - 11, top ? -5 : H - 12, 22, 17, METAL, { radius: 2 })
const button = (x, y, s = 12) => [r(x, y, s, s, BTN, { radius: 2 }), r(x + s / 2 - 3, y + s / 2 - 3, 6, 6, DARK, { radius: 3, outline: false })]
const led = (x, y, fill) => r(x, y, 5, 4, fill, { radius: 1 })
const antennaBars = (x, y, w) => [
  r(x, y, w, 2.5, GOLD, { outline: false }),
  ...[0, 1, 2, 3].map((i) => r(x + i * (w - 2.5) / 3, y, 2.5, 12, GOLD, { outline: false })),
]

// 1. ESP32-DevKitC V4 (Espressif). Vendor diagram: antenna at top, micro USB at bottom.
build({
  file: 'esp32-devkitc-v4.json', id: 'esp32-devkitc-v4', name: 'ESP32 DevKitC V4 (38 pin)',
  source: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/_images/esp32_devkitC_v4_pinlayout.png',
  left: ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'D2', 'D3', 'CMD', '5V'],
  right: ['GND 2|GND', 'IO23', 'IO22', 'TX', 'RX', 'IO21', 'GND 3|GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'D1', 'D0', 'CLK'],
  top: 2, wu: 12,
  types: typer({ gnd: ['GND'], v33: ['3V3'], v5: ['5V'], inputs: ['EN', 'VP', 'VN', 'IO34', 'IO35'] }),
  internal: [['GND', 'GND 2', 'GND 3']],
  art: {
    shapes: (W, H) => [
      r(W / 2 - 26, 4, 52, 32, DARK, { radius: 2 }), ...antennaBars(W / 2 - 18, 12, 36),
      r(W / 2 - 26, 36, 52, 64, CAN, { radius: 3, label: 'ESP32', labelSize: 10 }),
      r(W / 2 - 10, 150, 20, 20, DARK, { radius: 2 }),
      led(W / 2 - 18, 126, '#E5484D'),
      ...button(36, H - 30), ...button(W - 48, H - 30),
      usbMicro(W, H, false),
    ],
  },
})

// 2. DOIT ESP32 DevKit V1, 30 pin. No official DOIT page; photo-based pinouts from two independent sites agree.
build({
  file: 'esp32-devkit-v1-30.json', id: 'esp32-devkit-v1-30', name: 'ESP32 DevKit V1 (30 pin, DOIT)',
  source: 'https://mischianti.org/doit-esp32-dev-kit-v1-high-resolution-pinout-and-specs/ https://lastminuteengineers.com/esp32-pinout-reference/',
  left: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
  right: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND 2|GND', '3V3'],
  top: 2, wu: 12,
  types: typer({ gnd: ['GND'], v33: ['3V3'], v5: ['VIN'], inputs: ['EN', 'VP', 'VN', 'D34', 'D35'] }),
  internal: [['GND', 'GND 2']],
  art: {
    shapes: (W, H) => [
      r(W / 2 - 26, 4, 52, 30, DARK, { radius: 2 }), ...antennaBars(W / 2 - 18, 12, 36),
      r(W / 2 - 26, 34, 52, 60, CAN, { radius: 3, label: 'ESP32', labelSize: 10 }),
      r(W / 2 - 9, 124, 18, 18, DARK, { radius: 2 }),
      led(W / 2 - 20, 106, '#E5484D'), led(W / 2 + 15, 106, '#3D6FD6'),
      ...button(36, H - 28), ...button(W - 48, H - 28),
      usbMicro(W, H, false),
    ],
  },
})

// 3. ESP32-S3-DevKitC-1 v1.1 (Espressif). Antenna at top, two USB-C at bottom.
build({
  file: 'esp32-s3-devkitc-1.json', id: 'esp32-s3-devkitc-1', name: 'ESP32-S3-DevKitC-1',
  source: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/_images/ESP32-S3_DevKitC-1_pinlayout_v1.1.jpg',
  left: ['3V3', '3V3 2|3V3', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'G'],
  right: ['G 2|G', 'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'G 3|G', 'G 4|G'],
  top: 2, wu: 12,
  types: typer({ gnd: ['G'], v33: ['3V3'], v5: ['5V'], inputs: ['RST'] }),
  internal: [['G', 'G 2', 'G 3', 'G 4'], ['3V3', '3V3 2']],
  art: {
    shapes: (W, H) => [
      r(W / 2 - 26, 4, 52, 30, DARK, { radius: 2 }), ...antennaBars(W / 2 - 18, 12, 36),
      r(W / 2 - 26, 34, 52, 70, CAN, { radius: 3, label: 'ESP32-S3', labelSize: 9 }),
      r(W / 2 - 9, 182, 18, 18, DARK, { radius: 2 }),
      r(W / 2 - 16, 140, 9, 9, '#F4F1EA', { radius: 2 }),
      ...button(36, H - 44), ...button(W - 48, H - 44),
      r(36, H - 14, 20, 19, METAL, { radius: 3 }), r(W - 56, H - 14, 20, 19, METAL, { radius: 3 }),
    ],
  },
})

// 4. ESP32-C3 SuperMini (Nologo). Seen from the component side (USB-C at top); the Nologo pin diagram
//    shows the back (silkscreen side), so its columns are mirrored relative to this view.
build({
  file: 'esp32-c3-supermini.json', id: 'esp32-c3-supermini', name: 'ESP32-C3 SuperMini',
  source: 'https://www.nologo.tech/en/product/esp32/esp32c3SuperMini/esp32C3SuperMini.html https://lastminuteengineers.com/esp32-c3-super-mini-pinout-reference/',
  left: ['5', '6', '7', '8', '9', '10', '20', '21'],
  right: ['5V', 'G', '3.3', '4', '3', '2', '1', '0'],
  wu: 8,
  types: typer({ gnd: ['G'], v33: ['3.3'], v5: ['5V'] }),
  art: {
    shapes: (W, H) => [
      r(W / 2 - 13, -6, 26, 22, METAL, { radius: 3 }),
      ...button(W / 2 - 15, 20, 11), ...button(W / 2 + 4, 20, 11),
      r(W / 2 - 16, 40, 32, 30, DARK, { radius: 2, label: 'ESP32-C3', labelColor: '#D5DAE1', labelSize: 5.5 }),
      led(W / 2 + 8, 33, '#3D6FD6'),
      r(W / 2 - 15, H - 18, 30, 12, '#D8413A', { radius: 2, label: 'C3', labelColor: '#FFFFFF', labelSize: 7 }),
    ],
  },
})

// 5/6. Seeed XIAO ESP32-C3 / ESP32-S3, front view with USB-C at top.
const xiaoLeft = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6']
const xiaoRight = ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7']
const xiaoTypes = typer({ gnd: ['GND'], v33: ['3V3'], v5: ['5V'] })
build({
  file: 'xiao-esp32c3.json', id: 'xiao-esp32c3', name: 'Seeed XIAO ESP32-C3',
  source: 'https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/ https://files.seeedstudio.com/wiki/XIAO_WiFi/XIAO_ESP32-C3_front_pinout.png',
  left: xiaoLeft, right: xiaoRight, wu: 9, types: xiaoTypes,
  art: {
    pcb: XIAO,
    shapes: (W, H) => [
      r(W / 2 - 12, -6, 24, 24, METAL, { radius: 3 }),
      r(W / 2 - 17, 22, 34, 44, CAN, { radius: 3, label: 'ESP32-C3', labelSize: 5.5 }),
      led(W / 2 + 15, 8, '#E5484D'),
      ...button(W / 2 - 17, H - 17, 10), r(W / 2 - 5, H - 17, 10, 10, '#D9C27A', { radius: 5 }), ...button(W / 2 + 7, H - 17, 10),
    ],
  },
})
build({
  file: 'xiao-esp32s3.json', id: 'xiao-esp32s3', name: 'Seeed XIAO ESP32-S3',
  source: 'https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/ https://files.seeedstudio.com/wiki/SeeedStudio-XIAO-ESP32S3/img/XIAO_ESP32-S3_front_pinout.png',
  left: xiaoLeft, right: xiaoRight, wu: 9, types: xiaoTypes,
  art: {
    pcb: XIAO,
    shapes: (W, H) => [
      r(W / 2 - 12, -6, 24, 24, METAL, { radius: 3 }),
      ...button(W / 2 - 25, 2, 8), ...button(W / 2 + 17, 2, 8),
      r(W / 2 - 17, 22, 34, 42, CAN, { radius: 3, label: 'ESP32-S3', labelSize: 5.5 }),
      r(W / 2 - 17, H - 19, 10, 10, '#D9C27A', { radius: 5 }), r(W / 2 - 3, H - 18, 20, 8, DARK, { radius: 1 }),
    ],
  },
})

// 7. AI Thinker ESP32-CAM, camera side up with the microSD slot at the top edge. No USB.
//    Pins sit on the top half of the board, so spacers below them fill the rest of the length.
build({
  file: 'esp32-cam.json', id: 'esp32-cam', name: 'ESP32-CAM (AI Thinker)',
  source: 'https://randomnerdtutorials.com/esp32-cam-ai-thinker-pinout/ https://mischianti.org/esp32-cam-high-resolution-pinout-and-specs/ https://github.com/prusa3d/Prusa-Firmware-ESP32-Cam/blob/master/doc/AI_Thinker-ESP32-cam/README.md',
  left: ['5V', 'GND', 'IO12', 'IO13', 'IO15', 'IO14', 'IO2', 'IO4'],
  right: ['3V3', 'IO16', 'IO0', 'GND 2|GND', 'VCC', 'U0R', 'U0T', 'GND/R'],
  bottom: 6, wu: 11,
  types: typer({ gnd: ['GND'], v33: ['3V3', 'VCC'], v5: ['5V'], other: { 'GND/R': { type: 'passive' } } }),
  internal: [['GND', 'GND 2']],
  art: {
    shapes: (W, H) => [
      r(W / 2 - 21, 4, 42, 44, METAL, { radius: 3 }),
      r(W / 2 - 16, 10, 32, 32, DARK, { radius: 3 }), r(W / 2 - 8, 18, 16, 16, BTN, { radius: 8 }), r(W / 2 - 4, 22, 8, 8, '#141414', { radius: 4, outline: false }),
      r(W / 2 - 6, 48, 12, 38, '#C8742B', { radius: 1 }),
      r(W / 2 - 23, 104, 46, 12, '#E8E4D8', { radius: 2 }),
      r(W - 30, 122, 12, 12, '#FFE08A', { radius: 2 }),
      r(12, H - 26, W - 24, 16, PCB, { outline: false, label: 'ESP32-CAM', labelColor: '#F4F1EA', labelSize: 9 }),
    ],
  },
})

// 8. Arduino Nano (ATmega328P, 2 x 15 pins). Arduino's full pinout (A000005) shows the component
//    side with the mini-USB at the top: D13, 3V3, AREF (silkscreen "REF"), A0-A7, 5V, RST, GND,
//    VIN down the left and D12 ... D2, GND, RST, RX0, TX1 down the right (Last Minute Engineers'
//    pinout draws the same rows and silkscreen). The two RST pins and the two GND pins are
//    each one net. The 2 x 3 ICSP header at the bottom end is a two-row header: drawn, not pinned.
build({
  file: 'arduino-nano.json', id: 'arduino-nano', name: 'Arduino Nano (ATmega328P)',
  source: 'https://docs.arduino.cc/resources/pinouts/A000005-full-pinout.pdf https://docs.arduino.cc/hardware/nano/ https://lastminuteengineers.com/arduino-nano-pinout/',
  left: ['D13', '3V3', 'AREF|REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
  right: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND 2|GND', 'RST 2|RST', 'RX0', 'TX1'],
  top: 1, wu: 8,
  types: typer({
    gnd: ['GND'], v33: ['3V3'], v5: ['5V'], inputs: ['AREF', 'A6', 'A7', 'RST', 'RST 2'],
    other: { VIN: { type: 'power_in', supply: '7V/7.4V/9V/12V' } },
  }),
  internal: [['GND', 'GND 2'], ['RST', 'RST 2']],
  art: {
    pcb: '#17708A',
    shapes: (W, H) => [
      // Mini-USB overhanging the top edge.
      r(W / 2 - 13, -8, 26, 24, METAL, { radius: 2 }),
      r(W / 2 - 8, -6, 16, 4, '#8A9099', { radius: 1, outline: false }),
      r(W / 2 - 16, 50, 32, 32, DARK, { radius: 2, label: 'ATMEGA', labelColor: CAN, labelSize: 5 }),
      r(W / 2 - 16, 72, 32, 8, DARK, { outline: false, label: '328P', labelColor: CAN, labelSize: 5 }),
      ...button(W / 2 - 7, 96, 14),
      led(W / 2 - 16, 122, '#F4B400'), led(W / 2 - 7, 122, '#E5484D'), led(W / 2 + 2, 122, '#3FB56B'), led(W / 2 + 11, 122, '#F4B400'),
      // ICSP header (2 x 3) at the bottom end, not wired on the sheet.
      r(W / 2 - 9, H - 26, 18, 14, GOLD, { radius: 2, outline: false }),
      ...[0, 1, 2].flatMap((i) => [4, 10].map((dy) => r(W / 2 - 7.5 + i * 6, H - 26 + dy - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false }))),
    ],
  },
})

// 9. Wemos / LOLIN D1 mini (ESP8266). LOLIN's v3.1.0 photos: component side with the antenna at the
//    top and micro-USB at the bottom reads RST, A0, D0, D5, D6, D7, D8, 3V3 down the left and TX, RX,
//    D1, D2, D3, D4, GND, 5V down the right (the back silkscreen gives the same rows by GPIO
//    number, mirrored; Random Nerd Tutorials' pinout of the older ESP-12 board agrees). Older boards
//    and clones print "G" for GND.
build({
  file: 'wemos-d1-mini.json', id: 'wemos-d1-mini', name: 'Wemos / LOLIN D1 mini (ESP8266)',
  source: 'https://www.wemos.cc/en/latest/d1/d1_mini_3.1.0.html https://www.wemos.cc/en/latest/_static/boards/d1_mini_v3.1.0_1_16x16.jpg https://www.wemos.cc/en/latest/_static/boards/d1_mini_v3.1.0_2_16x16.jpg https://randomnerdtutorials.com/esp8266-pinout-reference-gpios/',
  left: ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'],
  right: ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V'],
  top: 2, bottom: 2, wu: 10,
  types: typer({ gnd: ['GND'], v33: ['3V3'], v5: ['5V'], inputs: ['RST', 'A0'] }),
  art: {
    pcb: '#1E4F8A',
    shapes: (W, H) => [
      // PCB antenna meander along the top edge.
      r(18, 6, W - 36, 2.5, GOLD, { outline: false }),
      ...[0, 1, 2, 3, 4].map((i) => r(18 + i * (W - 38.5) / 4, 6, 2.5, 12, GOLD, { outline: false })),
      r(W / 2 - 14, 36, 28, 28, DARK, { radius: 2, label: 'ESP8266', labelColor: CAN, labelSize: 4.5 }),
      r(W / 2 - 4, 72, 22, 16, DARK, { radius: 1, label: '4MB', labelColor: CAN, labelSize: 4.5 }),
      // Reset button at the bottom left, micro-USB at the bottom centre.
      r(8, H - 20, 12, 14, '#E9EDF0', { radius: 2 }),
      r(W / 2 - 11, H - 14, 22, 17, METAL, { radius: 2 }),
    ],
  },
})

finish('gen-boards.mjs')
