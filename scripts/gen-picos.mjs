// Generates the 5 built-in Raspberry Pi Pico family module JSON files (Pico, Pico H, Pico W,
// Pico 2, Pico 2 W). All five share one 40-pin castellated header plus the 3-pin SWD debug port;
// the header table below is transcribed from the official Raspberry Pi pinout diagrams and
// datasheets cited in each board's `source`.
//
// Run from the repo root: `node scripts/gen-picos.mjs`
// It overwrites the 5 files in modules/ in place; re-run after changing the header table, art or
// the shared rules here, then `git diff` the result before committing. src/format/picos.test.ts
// pins the order.
//
// View: component side up, micro-USB at the top, as in the official pinout diagrams.
// Left row = pins 1 to 20 top to bottom, right row = pins 40 to 21 top to bottom.
// Bottom = the SWD debug port, left to right as seen from the top: SWCLK, GND, SWDIO
// (Pico / Pico 2: pads on the bottom edge; Pico H: 3-pin JST SH on the bottom edge, pin 1 = SWCLK;
// Pico W / Pico 2 W: three pads inside the board above the wireless module, drawn in the art at
// their real spot with traces to the bottom-edge pins, as the official diagram leads them out).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const PCB = '#2F9E6E', PCB_DARK = '#237A55', GOLD = '#E0B43C', HOLE = '#8A6A1E'
const METAL = '#C9CED6', CAN = '#D5DAE1', DARK = '#1B1F24', CHIP_TXT = '#D5DAE1'
const WHITE = '#F4F1EA', HEADER = '#2B2F36', LED_GREEN = '#6BE08A'

// Pin spec shorthand: 'NAME' or 'NAME|label'.
// Left row: physical pins 1..20, top to bottom.
const LEFT = [
  'GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND 2|GND', 'GP6', 'GP7',
  'GP8', 'GP9', 'GND 3|GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND 4|GND', 'GP14', 'GP15',
]
// Right row: physical pins 40..21, top to bottom.
const RIGHT = [
  'VBUS', 'VSYS', 'GND 5|GND', '3V3_EN', '3V3(OUT)', 'ADC_VREF', 'GP28/ADC2', 'AGND', 'GP27/ADC1', 'GP26/ADC0',
  'RUN', 'GP22', 'GND 6|GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND 7|GND', 'GP17', 'GP16',
]
// Debug port, left to right as seen from the component side.
const BOTTOM = ['SWCLK', 'GND DBG|GND', 'SWDIO']

// Types per the datasheets' pin descriptions (VBUS = micro-USB 5 V, VSYS = 1.8-5.5 V system input,
// 3V3(OUT) = on-board SMPS output). AGND is the analog ground reference for GP26-28; the
// datasheet treats it as a separate analog ground plane ("can be connected to digital ground"),
// so it is a ground pin but not joined to GND here.
const TYPES = {
  VBUS: { type: 'power_in', supply: '5V' },
  VSYS: { type: 'power_in', supply: 'VSYS' },
  '3V3(OUT)': { type: 'power_out', supply: '3V3' },
  '3V3_EN': { type: 'input' },
  RUN: { type: 'input' },
  ADC_VREF: { type: 'input' },
  AGND: { type: 'ground' },
  SWCLK: { type: 'input' },
}
const typeOf = (name) => TYPES[name] ?? (name === 'GND' || name.startsWith('GND ') ? { type: 'ground' } : {})

function pinsFor(side, list) {
  return list.map((s) => {
    const [name, label] = s.split('|')
    const t = typeOf(name)
    const p = { name, side }
    if (label) p.label = label
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    return p
  })
}
const GROUNDS = [...LEFT, ...RIGHT, ...BOTTOM].map((s) => s.split('|')[0]).filter((n) => n === 'GND' || n.startsWith('GND '))

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

// Geometry: 20 pins per side + one unit margin top and bottom plus one spare unit so the pin
// rows sit 2 units in from both ends (22 + 1 = 23 units), 12 units wide so both rows of inside
// labels and the chip fit. Pins land at y = 20..210, the debug pins at x = 50, 60, 70.
const WU = 12, HU = 23, W = WU * 10, H = HU * 10
const pinYs = Array.from({ length: 20 }, (_, i) => (Math.ceil((HU - 19) / 2) + i) * 10)
const dbgXs = [0, 1, 2].map((i) => (Math.ceil((WU - 2) / 2) + i) * 10)

// Castellated edge pads: a gold pad per pin with a half-hole on the board edge.
function castellations(withHeaders) {
  const shapes = []
  for (const x of [0, W - 10]) {
    if (withHeaders) shapes.push(r(x + 1, pinYs[0] - 5, 8, pinYs[19] - pinYs[0] + 10, HEADER, { radius: 1, outline: false }))
    for (const y of pinYs) {
      if (withHeaders) shapes.push(r(x + 3, y - 2, 4, 4, GOLD, { radius: 0.5, outline: false }))
      else {
        shapes.push(r(x, y - 3.5, 10, 7, GOLD, { radius: 1.5, outline: false }))
        shapes.push(r(x === 0 ? -1.5 : W - 1.5, y - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false }))
      }
    }
  }
  return shapes
}

const mountHole = (x, y) => [r(x, y, 11, 11, GOLD, { radius: 5.5, outline: false }), r(x + 3, y + 3, 5, 5, '#F4F1EA', { radius: 2.5, outline: false })]
const mountHoles = () => [...mountHole(26, 12), ...mountHole(W - 37, 12), ...mountHole(26, H - 23), ...mountHole(W - 37, H - 23)]
const usb = () => [r(W / 2 - 13, -7, 26, 19, METAL, { radius: 2 }), r(W / 2 - 8, -3, 16, 5, DARK, { radius: 1, outline: false })]
const led = () => r(28, 30, 7, 5, LED_GREEN, { radius: 1 })
const bootsel = () => [r(30, 46, 14, 20, WHITE, { radius: 3 }), r(33, 51, 8, 10, CAN, { radius: 4, outline: false })]
const chip = (y, name, s = 36) => r(W / 2 - s / 2, y, s, s, DARK, { radius: 2, label: name, labelColor: CHIP_TXT, labelSize: 6.5 })
const flash = () => [r(W / 2 + 2, 36, 14, 16, DARK, { radius: 1 }), r(W / 2 - 16, 40, 12, 10, DARK, { radius: 1 })]
const plate = (y, text) => r(W / 2 - 22, y, 44, 14, PCB, { outline: false, label: text, labelColor: '#FFFFFF', labelSize: 9 })

// Debug pads on the bottom edge (Pico, Pico 2).
const edgeDebug = () => dbgXs.flatMap((x) => [r(x - 3.5, H - 10, 7, 10, GOLD, { radius: 1.5, outline: false }), r(x - 1.5, H - 3, 3, 3, HOLE, { radius: 1.5, outline: false })])
// JST SH 3-pin side-entry connector on the bottom edge (Pico H).
const jstDebug = () => [r(dbgXs[0] - 8, H - 16, dbgXs[2] - dbgXs[0] + 16, 16, WHITE, { radius: 1.5 }), ...dbgXs.map((x) => r(x - 2, H - 6, 4, 6, METAL, { outline: false }))]
// Wireless boards: SWD pads inside the board at `y`, traced to the bottom-edge pins; the can is
// drawn after the traces so they pass under it.
const traceDebug = (y) => dbgXs.flatMap((x) => [r(x - 0.75, y, 1.5, H - y, PCB_DARK, { outline: false })])
const padDebug = (y) => [
  r(dbgXs[0] - 7, y - 7, dbgXs[2] - dbgXs[0] + 14, 14, PCB, { radius: 1, outline: false }),
  ...dbgXs.flatMap((x) => [r(x - 3.5, y - 3.5, 7, 7, GOLD, { radius: 3.5, outline: false }), r(x - 1.5, y - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false })]),
]
const wirelessCan = (y, text) => r(W / 2 - 22, y, 44, 32, CAN, { radius: 2, label: text, labelSize: 9 })
const antenna = () => [r(W / 2 - 14, H - 20, 28, 2, GOLD, { outline: false }), ...[0, 1, 2, 3].map((i) => r(W / 2 - 14 + i * 8.67, H - 20, 2, 8, GOLD, { outline: false }))]

const SRC = {
  pico: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf https://datasheets.raspberrypi.com/pico/Pico-R3-A4-Pinout.pdf',
  picoW: 'https://datasheets.raspberrypi.com/picow/pico-w-datasheet.pdf https://datasheets.raspberrypi.com/picow/PicoW-A4-Pinout.pdf',
  pico2: 'https://datasheets.raspberrypi.com/pico/pico-2-datasheet.pdf https://datasheets.raspberrypi.com/pico/Pico-2-Pinout.pdf',
  pico2W: 'https://datasheets.raspberrypi.com/picow/pico-2-w-datasheet.pdf https://datasheets.raspberrypi.com/picow/pico-2-w-pinout.pdf',
  picoH: 'https://pip.raspberrypi.com/documents/RP-008314-DS https://datasheets.raspberrypi.com/debug/debug-connector-specification.pdf',
}

function build({ id, name, source, shapes }) {
  const m = {
    format: 'circuitoon-module/1', id, version: 1, name, category: 'Microcontrollers', source,
    pins: [...pinsFor('left', LEFT), ...pinsFor('right', RIGHT), ...pinsFor('bottom', BOTTOM)],
    internal: [GROUNDS],
    size: { w: WU, h: HU },
    electrical: { model: 'mcu', params: {} },
    art: { w: W, h: H, pinLabels: 'inside', shapes: [r(0, 0, W, H, PCB, { radius: 4 }), ...shapes] },
  }
  writeFileSync(OUT + id + '.json', JSON.stringify(m, null, 2) + '\n')
  console.log(id, 'pins', LEFT.length + RIGHT.length + BOTTOM.length, 'body', W, 'x', H)
}

// Pico / Pico 2 / Pico H: chip in the middle, debug port on the bottom edge.
const plain = (chipName, label, debug, withHeaders = false) => [
  ...castellations(withHeaders), ...mountHoles(), ...usb(), led(), ...bootsel(), ...flash(),
  chip(116, chipName), plate(164, label), ...debug(),
]
// Pico W / Pico 2 W: chip higher up, SWD pads above the wireless can, antenna at the bottom.
const wireless = (chipName, label) => [
  ...castellations(false), ...mountHoles(), ...usb(), led(), ...bootsel(), ...flash(),
  chip(115, chipName, 28), ...traceDebug(151), ...padDebug(151), wirelessCan(160, label), ...antenna(),
]

build({ id: 'rpi-pico', name: 'Raspberry Pi Pico', source: SRC.pico, shapes: plain('RP2040', 'Pico', edgeDebug) })
build({ id: 'rpi-pico-h', name: 'Raspberry Pi Pico H (with headers and debug connector)', source: `${SRC.pico} ${SRC.picoH}`, shapes: plain('RP2040', 'Pico H', jstDebug, true) })
build({ id: 'rpi-pico-w', name: 'Raspberry Pi Pico W', source: SRC.picoW, shapes: wireless('RP2040', 'Pico W') })
build({ id: 'rpi-pico-2', name: 'Raspberry Pi Pico 2', source: SRC.pico2, shapes: plain('RP2350', 'Pico 2', edgeDebug) })
build({ id: 'rpi-pico-2-w', name: 'Raspberry Pi Pico 2 W', source: SRC.pico2W, shapes: wireless('RP2350', 'Pico 2 W') })
