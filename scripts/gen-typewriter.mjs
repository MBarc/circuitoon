// Generates the parts added so the Spirit Typewriter sheet can be built from built-in parts: the
// SW-520D and SW-460D ball tilt switches, the 38-pin ESP32 screw terminal adapter, the 6 mm and
// 12 mm 4-pin tactile switches, the WH148 panel potentiometer, the micro-USB and USB-C panel-mount
// extension cables, JST-XH board headers (2, 3, 4 pin) and 0.1 in Dupont housings (1x2, 1x3,
// 1x4). Pin orders are transcribed from the sources cited on each part below (maker datasheets,
// vendor photos with legible silkscreen, cross-checked against a second, independent source).
//
// Run from the repo root: `node scripts/gen-typewriter.mjs`
// It overwrites those files in modules/ in place; re-run after changing a part's pins or art,
// then `git diff` the result before committing. src/format/typewriter.test.ts pins the order.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const METAL = '#C9CED6', TIN = '#D5DAE1', LEAD = '#B8BEC7', DARK = '#1B1F24', BLACK = '#2B2F36'
const GREY = '#3A3F47', GOLD = '#E0B43C', RED = '#E0483E', HOLE = '#6B727C', MOUNT = '#15181C'
const TERMINAL = '#3FA34D', TERMINAL_DARK = '#2E7D3A', NATURAL = '#EEF0EC', NATURAL_IN = '#D6DAD2'
const PHENOLIC = '#C8742B', CAN = '#B8BEC7', WHITE = '#FFFFFF'

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

/** Pin positions (px) along a side `len` units long with `n` slots, per computeLayout. */
function slots(len, n) {
  const s0 = Math.ceil((len - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * 10)
}

/**
 * Pins for one side from a slot list: 'NAME' or 'NAME|label' is a pin, null is a spacer (a
 * physical gap). `types` maps the label (or the name) to { type, supply }. Returns the pins and
 * the px position of every pin along the side, by name.
 */
function side(sideName, list, types, len) {
  const at = slots(len, list.length)
  const pos = {}
  const pins = list.map((s, i) => {
    if (s === null) return { spacer: true, side: sideName }
    const [name, label] = s.split('|')
    const p = { name, side: sideName }
    if (label) p.label = label
    const t = types[label ?? name] ?? {}
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    pos[name] = at[i]
    return p
  })
  return { pins, pos }
}

function write(file, m) {
  writeFileSync(OUT + file, JSON.stringify(m, null, 2) + '\n')
  const n = m.pins.filter((p) => !p.spacer).length
  console.log(file, 'pins', n, 'body', m.art.w, 'x', m.art.h)
}

/** `inside`: draw pin names inside the body, like silkscreen (dense headers only). */
function moduleJson({ id, name, category, source, pins, internal, wu, hu, electrical, states, inside, shapes }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category, source, pins }
  if (internal) m.internal = internal
  m.size = { w: wu, h: hu }
  m.electrical = electrical
  if (states) m.states = states
  m.art = inside ? { w: wu * 10, h: hu * 10, pinLabels: 'inside', shapes } : { w: wu * 10, h: hu * 10, shapes }
  return m
}

const passive = { type: 'passive' }

// =============================================================================================
// Sensors: ball tilt switches

// ---------------------------------------------------------------------------------------------
// 1. SW-520D roller-ball tilt switch (Beelee / BAILIN). Ø5.2 x 11.5 mm can, both Ø0.6 mm leads
//    out of the same end, 2.4 mm apart. Two balls; unpolarized. Closed (ON) when the lead end
//    points down (more than 10 deg below horizontal), open when the cap end points down. Drawn
//    standing on its leads, which is the closed position.
{
  const wu = 5, hu = 6, W = wu * 10, H = hu * 10
  const bottom = side('bottom', ['1', '2'], { 1: passive, 2: passive }, wu)
  const xs = [bottom.pos['1'], bottom.pos['2']]
  const shapes = [
    ...xs.map((x) => r(x - 1.5, 38, 3, H - 38, LEAD, { outline: false })),
    r(12, 3, 26, 38, BLACK, { radius: 5 }),
    r(16, 8, 4, 22, GREY, { radius: 2, outline: false }),
    r(14, 34, 22, 6, GREY, { radius: 1, outline: false }),
  ]
  write('tilt-switch-sw520d.json', moduleJson({
    id: 'tilt-switch-sw520d', name: 'SW-520D ball tilt switch', category: 'Sensors',
    source: 'https://www.tme.com/Document/f1e6cedd8cb7feeb250b353b6213ec6c/SW-520D.pdf https://www.sunrom.com/p/sw520d-sw-520d-tilt-sensor',
    pins: bottom.pins, wu, hu,
    electrical: { model: 'switch', terminals: { a: '1', b: '2' }, params: {} }, states: ['open', 'closed'], shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2. SW-460D double-ball vibration switch (YUKUTO SW-460 series). Axial: Ø4.7 x 15 mm tube, one
//    Ø0.6 mm lead out of each end. The silver ("argent") end is pin 1 (left), the gold end pin 2
//    (right); it conducts when the gold end is low or the switch is shaken, and rests open when
//    the silver end is more than 10 deg down. Unpolarized electrically.
{
  const wu = 8, hu = 4, W = wu * 10, H = hu * 10
  const left = side('left', ['1'], { 1: passive }, hu)
  const right = side('right', ['2'], { 2: passive }, hu)
  const shapes = [
    r(0, H / 2 - 1.5, 16, 3, LEAD, { radius: 1.5 }),
    r(W - 16, H / 2 - 1.5, 16, 3, LEAD, { radius: 1.5 }),
    r(12, 11, 56, 18, GREY, { radius: 6 }),
    r(12, 11, 10, 18, METAL, { radius: 4 }),
    r(58, 11, 10, 18, GOLD, { radius: 4 }),
    r(24, 14, 32, 3, '#5A6069', { radius: 1.5, outline: false }),
  ]
  write('tilt-switch-sw460d.json', moduleJson({
    id: 'tilt-switch-sw460d', name: 'SW-460D ball vibration switch (axial)', category: 'Sensors',
    source: 'https://evelta.com/content/datasheets/SW-460D.pdf https://www.lcsc.com/product-detail/Vibration-Sensors_SHOU-HAN-SW-460D_C5379903.html',
    pins: [...left.pins, ...right.pins], wu, hu,
    electrical: { model: 'switch', terminals: { a: '1', b: '2' }, params: {} }, states: ['open', 'closed'], shapes,
  }))
}

// =============================================================================================
// Microcontrollers: ESP32 38-pin screw terminal adapter

// ---------------------------------------------------------------------------------------------
// 3. "FOR ESP32 TERMINAL ADAPTER" (77 x 63 mm black board, four M3 corner holes, two rows of
//    sockets per side for 0.9 in and 1.0 in wide 38-pin DevKits, a 19-way 3.5 mm screw terminal
//    strip along each long edge). Seen from the component side with the silkscreen upright:
//    top strip 5V ... 3V3 left to right, bottom strip CLK ... GND. Read right to left they are the
//    DevKitC V4's two headers (3V3 ... 5V and GND ... CLK), so the DevKit seats antenna to the
//    right. Silkscreen names are used as printed (P13, SD2, SVP; "3U3" and "5U" are the board
//    font's V). No power input of its own: power comes through the DevKit.
{
  const wu = 26, hu = 21, W = wu * 10, H = hu * 10
  const types = {
    '3V3': { type: 'power_out', supply: '3V3' }, '5V': { type: 'power_in', supply: '5V' }, GND: { type: 'ground' },
    EN: { type: 'input' }, SVP: { type: 'input' }, SVN: { type: 'input' }, P34: { type: 'input' }, P35: { type: 'input' },
  }
  const topList = ['5V', 'CMD', 'SD3', 'SD2', 'P13', 'GND', 'P12', 'P14', 'P27', 'P26', 'P25', 'P33', 'P32', 'P35', 'P34', 'SVN', 'SVP', 'EN', '3V3']
  const bottomList = ['CLK', 'SD0', 'SD1', 'P15', 'P2', 'P0', 'P4', 'P16', 'P17', 'P5', 'P18', 'P19', 'GND 2|GND', 'P21', 'RX', 'TX', 'P22', 'P23', 'GND 3|GND']
  const top = side('top', topList, types, wu)
  const bottom = side('bottom', bottomList, types, wu)
  const xs = slots(wu, 19)
  const x0 = xs[0] - 6, x1 = xs[18] + 6
  // Screw terminal strip kept in the outer 12 px so the inside labels clear it.
  const strip = (y) => [
    r(x0, y, x1 - x0, 10, TERMINAL, { radius: 1 }),
    ...xs.map((x) => r(x - 3, y + 2, 6, 6, METAL, { radius: 3, outline: false })),
    ...xs.map((x) => r(x - 2.5, y + 4.5, 5, 1, HOLE, { outline: false })),
  ]
  const socket = (y) => [
    r(x0 + 20, y, x1 - x0 - 40, 8, DARK, { radius: 1 }),
    ...xs.slice(2, 17).map((x) => r(x - 1.5, y + 2.5, 3, 3, GREY, { outline: false })),
  ]
  const shapes = [
    r(0, 0, W, H, BLACK, { radius: 4 }),
    ...[[4, 4], [W - 14, 4], [4, H - 14], [W - 14, H - 14]].map(([x, y]) => r(x, y, 10, 10, MOUNT, { radius: 5 })),
    ...strip(1), ...strip(H - 11),
    ...socket(48), ...socket(62), ...socket(H - 70), ...socket(H - 56),
    r(W / 2 - 60, 86, 120, 16, BLACK, { outline: false, label: 'FOR ESP32', labelColor: WHITE, labelSize: 11 }),
    r(W / 2 - 60, 106, 120, 14, BLACK, { outline: false, label: 'TERMINAL ADAPTER', labelColor: WHITE, labelSize: 8 }),
  ]
  write('esp32-terminal-board-38.json', moduleJson({
    id: 'esp32-terminal-board-38', name: 'ESP32 38-pin screw terminal adapter', category: 'Microcontrollers',
    source: 'https://protosupplies.com/product/esp32-s-screw-terminal-adapter/ https://www.otronic.nl/en/breakout-board-for-esp32-s-38-pins.html',
    pins: [...top.pins, ...bottom.pins], internal: [['GND', 'GND 2', 'GND 3']], wu, hu,
    electrical: { model: 'breakout', params: {} }, inside: true, shapes,
  }))
}

// =============================================================================================
// Switches: 4-pin tactile switches

// ---------------------------------------------------------------------------------------------
// 4/5. Tactile switches, Omron B3F numbering (the switches carry no numbers). Top view, legs out
//      of the left and right sides: 4 top left, 3 top right, 2 bottom left, 1 bottom right. The
//      legs facing each other across the body are one net (4-3 and 2-1); pressing joins the two
//      nets, so the switch sits between legs on the same side (4.5 mm apart on the 6 mm switch,
//      5 mm on the 12 mm one). Same arrangement on Same Sky's TS13 (numbered differently there).
function tactile({ file, id, name, source, size, cap }) {
  const wu = size, hu = size, W = wu * 10, H = hu * 10
  const types = { 1: passive, 2: passive, 3: passive, 4: passive }
  const left = side('left', ['4', null, '2'], types, hu)
  const right = side('right', ['3', null, '1'], types, hu)
  const b = 10, bw = W - 20
  const c = Math.round(bw * cap)
  const corner = size > 6 ? [[b + 5, b + 5], [W - b - 13, b + 5], [b + 5, H - b - 13], [W - b - 13, H - b - 13]] : []
  const shapes = [
    ...[left.pos['4'], left.pos['2']].map((y) => r(0, y - 1.5, b + 2, 3, LEAD, { radius: 1.5 })),
    ...[right.pos['3'], right.pos['1']].map((y) => r(W - b - 2, y - 1.5, b + 2, 3, LEAD, { radius: 1.5 })),
    r(b, b, bw, bw, BLACK, { radius: 2 }),
    r(b + 3, b + 3, bw - 6, bw - 6, METAL, { radius: 2 }),
    ...corner.map(([x, y]) => r(x, y, 8, 8, BLACK, { radius: 4, outline: false })),
    r(W / 2 - c / 2, H / 2 - c / 2, c, c, size > 6 ? RED : DARK, { radius: c / 2 }),
  ]
  write(file, moduleJson({
    id, name, category: 'Switches', source, pins: [...left.pins, ...right.pins], internal: [['4', '3'], ['2', '1']], wu, hu,
    electrical: { model: 'switch', terminals: { a: '1', b: '3' }, params: { normallyOpen: { default: true } } },
    states: ['released', 'pressed'], shapes,
  }))
}

const B3F = 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf https://www.sameskydevices.com/product/resource/ts13.pdf'
tactile({ file: 'tactile-switch-12mm-4pin.json', id: 'tactile-switch-12mm-4pin', name: 'Tactile switch 12 mm (4-pin)', source: B3F, size: 10, cap: 0.55 })
tactile({ file: 'tactile-switch-6mm-4pin.json', id: 'tactile-switch-6mm-4pin', name: 'Tactile switch 6 mm (4-pin)', source: B3F, size: 6, cap: 0.45 })

// =============================================================================================
// Passives: panel potentiometer

// ---------------------------------------------------------------------------------------------
// 6. WH148 16 mm panel potentiometer, 10 kOhm linear (B103), with a round knob on the shaft.
//    Front view (shaft toward you, lugs down): lugs 1, 2 (wiper, named W like the trimmer pot so parts swap), 3 left to right at 5 mm pitch.
{
  const wu = 8, hu = 9, W = wu * 10, H = hu * 10
  const bottom = side('bottom', ['1', null, 'W', null, '3'], { 1: passive, W: passive, 3: passive }, wu)
  const xs = [bottom.pos['1'], bottom.pos['W'], bottom.pos['3']]
  const shapes = [
    ...xs.map((x) => r(x - 2, 68, 4, H - 68, LEAD, { outline: false })),
    r(10, 2, 60, 60, CAN, { radius: 30 }),
    r(18, 10, 44, 44, BLACK, { radius: 22 }),
    r(24, 16, 32, 32, GREY, { radius: 16, outline: false }),
    r(38.5, 14, 3, 16, WHITE, { radius: 1.5, outline: false }),
    r(12, 58, 56, 12, PHENOLIC, { radius: 2 }),
    ...xs.map((x) => r(x - 3, 61, 6, 6, TIN, { radius: 3, outline: false })),
  ]
  write('potentiometer-panel-10k.json', moduleJson({
    id: 'potentiometer-panel-10k', name: 'Panel potentiometer 10 k (WH148, with knob)', category: 'Passives',
    source: 'https://rhtecp.com/upload/202205/23/WH148.pdf https://www.handsontec.com/dataspecs/passive/WH148%20Pot-meter.pdf',
    pins: bottom.pins, wu, hu,
    electrical: { model: 'potentiometer', terminals: { a: '1', wiper: 'W', b: '3' }, params: { resistance: { unit: 'ohm', default: 10000 } } },
    shapes,
  }))
}

// =============================================================================================
// Connectors

// ---------------------------------------------------------------------------------------------
// 7/8. USB panel-mount extension cables: a bulkhead socket (left, flange with two screw ears) on a
//      short cable to a plug (right). The pins are the plug's conductors in USB cable order
//      (VBUS red, D- white, D+ green, GND black). Micro-B: pin 4 (ID) is left as a gap; it is
//      not wired to anything in a flashing or charging hookup. USB-C: CC is carried through as
//      well, since a C-to-C link needs it for the two ends to detect each other.
function usbPanel({ file, id, name, source, list, hu, tip }) {
  const wu = 12, W = wu * 10, H = hu * 10
  const types = { VBUS: passive, 'D-': passive, 'D+': passive, GND: { type: 'ground' }, CC: passive }
  const right = side('right', list, types, hu)
  const ys = Object.values(right.pos)
  const y0 = ys[0] - 8, y1 = ys[ys.length - 1] + 8
  const shapes = [
    r(4, H / 2 - 30, 26, 60, BLACK, { radius: 4 }),
    r(10, H / 2 - 26, 14, 8, MOUNT, { radius: 4, outline: false }),
    r(10, H / 2 + 18, 14, 8, MOUNT, { radius: 4, outline: false }),
    r(9, H / 2 - 10, 16, 20, METAL, { radius: tip }),
    r(13, H / 2 - 4, 8, 8, DARK, { radius: 2, outline: false }),
    r(30, H / 2 - 4, 38, 8, BLACK, { radius: 3 }),
    r(66, y0, 44, y1 - y0, GREY, { radius: 4 }),
    r(108, y0 + 4, W - 108, y1 - y0 - 8, METAL, { radius: 2 }),
  ]
  write(file, moduleJson({
    id, name, category: 'Connectors', source, pins: right.pins, wu, hu,
    electrical: { model: 'connector', params: {} }, inside: true, shapes,
  }))
}

usbPanel({
  file: 'usb-panel-mount-microusb.json', id: 'usb-panel-mount-microusb', name: 'USB panel-mount extension (micro-USB)',
  source: 'https://www.adafruit.com/product/3258 https://en.wikipedia.org/wiki/USB_hardware#Pinouts',
  list: ['VBUS', 'D-', 'D+', null, 'GND'], hu: 7, tip: 3,
})
usbPanel({
  file: 'usb-panel-mount-usbc.json', id: 'usb-panel-mount-usbc', name: 'USB panel-mount extension (USB-C)',
  source: 'https://en.wikipedia.org/wiki/USB-C#Receptacles https://en.wikipedia.org/wiki/USB_hardware#Pinouts',
  list: ['VBUS', 'D-', 'D+', 'GND', null, 'CC'], hu: 8, tip: 8,
})

// ---------------------------------------------------------------------------------------------
// 9-11. JST-XH top-entry board header (B2B-XH-A, B3B-XH-A, B4B-XH-A). 2.5 mm pitch, drawn at the
//       0.1 in grid. Front view as in the JST drawing (latch slots up, posts down): circuit 1 at
//       the left, marked with a dot above it.
function jstXh(n) {
  const wu = n + 3, hu = 5, W = wu * 10, H = hu * 10
  const names = Array.from({ length: n }, (_, i) => `${i + 1}|${i + 1}`)
  const bottom = side('bottom', names, Object.fromEntries(names.map((_, i) => [String(i + 1), passive])), wu)
  const xs = Object.values(bottom.pos)
  const shapes = [
    ...xs.map((x) => r(x - 1.5, 36, 3, H - 36, METAL, { outline: false })),
    r(6, 8, W - 12, 30, NATURAL, { radius: 2 }),
    r(10, 14, W - 20, 20, NATURAL_IN, { radius: 1 }),
    ...xs.map((x) => r(x - 2.5, 17, 5, 13, '#B9BEB5', { radius: 1, outline: false })),
    r(W / 2 - 5, 8, 10, 5, NATURAL_IN, { outline: false }),
    r(xs[0] - 2, 9.5, 4, 4, DARK, { radius: 2, outline: false }),
  ]
  write(`jst-xh-${n}.json`, moduleJson({
    id: `jst-xh-${n}`, name: `JST-XH connector, ${n}-pin (2.5 mm)`, category: 'Connectors',
    source: 'https://www.jst-mfg.com/product/pdf/eng/eXH.pdf https://www.jst-mfg.com/product/detail_e.php?series=277',
    pins: bottom.pins, wu, hu, electrical: { model: 'connector', params: {} }, shapes,
  }))
}
for (const n of [2, 3, 4]) jstXh(n)

// ---------------------------------------------------------------------------------------------
// 12-14. 0.1 in (2.54 mm) Dupont crimp housings, 1x2, 1x3, 1x4, for the crimped jumper ends.
//        Mating face toward you, wire side down: position 1 at the left, marked with the small
//        triangle the housings carry (drawn as a light tick above position 1).
function dupont(n) {
  const wu = n + 3, hu = 5, W = wu * 10, H = hu * 10
  const names = Array.from({ length: n }, (_, i) => `${i + 1}|${i + 1}`)
  const bottom = side('bottom', names, Object.fromEntries(names.map((_, i) => [String(i + 1), passive])), wu)
  const xs = Object.values(bottom.pos)
  const shapes = [
    ...xs.map((x) => r(x - 1.5, 36, 3, H - 36, METAL, { outline: false })),
    r(xs[0] - 7, 6, xs[n - 1] - xs[0] + 14, 32, DARK, { radius: 1 }),
    ...xs.map((x) => r(x - 3, 13, 6, 6, GREY, { radius: 0.5, outline: false })),
    ...xs.map((x) => r(x - 1, 15, 2, 2, METAL, { outline: false })),
    r(xs[0] - 2, 8, 4, 3, '#9AA0A6', { outline: false }),
  ]
  write(`dupont-1x${n}.json`, moduleJson({
    id: `dupont-1x${n}`, name: `Dupont housing 1x${n} (0.1 in)`, category: 'Connectors',
    source: `https://www.pololu.com/product/${1900 + n - 1} https://www.pololu.com/category/71/0.1-inch-2.54mm-crimp-connector-housings`,
    pins: bottom.pins, wu, hu, electrical: { model: 'connector', params: {} }, shapes,
  }))
}
for (const n of [2, 3, 4]) dupont(n)
