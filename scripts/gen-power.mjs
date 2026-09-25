// Generates the built-in power modules: the IP5306 USB-C charge/boost board, the TP4056 USB-C
// charger with protection, the 3-pin AMS1117 3.3 V regulator and the LM2596 buck converter.
// Pad names and positions are transcribed from the sources cited on each part below (vendor
// photos with legible silkscreen, cross-checked against a second, independent source).
//
// Run from the repo root: `node scripts/gen-power.mjs`
// It overwrites those files in modules/ in place; re-run after changing a part's pins or art,
// then `git diff` the result before committing. src/format/power.test.ts pins the order.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const METAL = '#C9CED6', TIN = '#D5DAE1', HOLE = '#6B727C', CHIP = '#1E2126', CHIP_MARK = '#3A3F47'
const BLUE = '#1E4F8A', BLACK_PCB = '#2B2F36', MOUNT = '#123356', CAP = '#B8BEC7', CAP_TOP = '#8E96A1'
const SMD = '#C8A27A', LED_RED = '#E0483E', LED_BLUE = '#4FA3F7', POT = '#3D6FD6', BRASS = '#D9A93B'

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

/** Pin positions (px) along a side `len` units long with `n` slots, per computeLayout. */
function slots(len, n) {
  const s0 = Math.ceil((len - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * 10)
}

/**
 * Pins for one side from a slot list: a string is a pin name, null is a spacer. `types` maps a
 * name to { type, supply }. Returns the pins and the px position of every slot along the side.
 */
function side(sideName, list, types, len) {
  const at = slots(len, list.length)
  const pins = list.map((n) => {
    if (n === null) return { spacer: true, side: sideName }
    const p = { name: n, side: sideName }
    const t = types[n] ?? {}
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    return p
  })
  const pos = Object.fromEntries(list.flatMap((n, i) => (n === null ? [] : [[n, at[i]]])))
  return { pins, pos }
}

/** A tinned through-hole solder pad with its hole, centered on (cx, cy), kept in the outer 12 px. */
const pad = (cx, cy, s = 8) => [
  r(cx - s / 2, cy - s / 2, s, s, TIN, { radius: s / 2, outline: false }),
  r(cx - 1.5, cy - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false }),
]

/** An SOP/SOIC chip body with `n` legs per long side, legs top and bottom. */
function sop(x, y, w, h, n, label, labelSize = 5) {
  const legs = []
  const pitch = w / n
  for (let i = 0; i < n; i++) {
    const lx = x + pitch * (i + 0.5) - 1.5
    legs.push(r(lx, y - 3, 3, 3, METAL, { outline: false }), r(lx, y + h, 3, 3, METAL, { outline: false }))
  }
  return [...legs, r(x, y, w, h, CHIP, { radius: 1, label, labelColor: METAL, labelSize })]
}

function write(file, m) {
  writeFileSync(OUT + file, JSON.stringify(m, null, 2) + '\n')
  const n = m.pins.filter((p) => !p.spacer).length
  console.log(file, 'pins', n, 'body', m.art.w, 'x', m.art.h)
}

function moduleJson({ id, name, source, pins, internal, wu, hu, electrical, shapes }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category: 'Power', source, pins }
  if (internal) m.internal = internal
  m.size = { w: wu, h: hu }
  m.electrical = electrical
  // Pad names drawn inside the body beside each pad, like the silkscreen.
  m.art = { w: wu * 10, h: hu * 10, pinLabels: 'inside', shapes }
  return m
}

// ---------------------------------------------------------------------------------------------
// 1. IP5306 USB-C charge/boost board (the black "X-150" board sold as "IP5306 Type-C 5V 2.1A power
//    bank module"; 25 x 20 mm). Seen from the component side with the USB-C input at the right:
//    battery pads on the left edge, "-" above "+" (next to a battery symbol); on the bottom edge
//    the K (key) pad at the far left, then the output pads "+" "5V" "-" at the right. The USB-C
//    socket is charge input only (drawn, not wired). Optional USB-A output sits on the back.
//    Battery and output grounds are the same net (IP5306 has no low-side switch).
{
  const wu = 12, hu = 10, W = wu * 10, H = hu * 10
  const types = {
    'B+': { type: 'power_in', supply: 'VBAT' }, 'B-': { type: 'ground' }, K: { type: 'input' },
    '5V+': { type: 'power_out', supply: '5V' }, '5V-': { type: 'ground' },
  }
  const left = side('left', ['B-', null, 'B+'], types, hu)
  const bottom = side('bottom', ['K', null, null, null, null, '5V+', null, '5V-'], types, wu)
  const shapes = [
    r(0, 0, W, H, BLACK_PCB, { radius: 4 }),
    // Four charge-level LEDs along the top, left of the chip.
    ...[16, 26, 36, 46].map((x) => r(x, 7, 6, 4, LED_RED, { radius: 1, outline: false })),
    ...sop(56, 18, 26, 16, 4, 'IP5306'),
    r(28, 44, 30, 30, '#8E949C', { radius: 4, label: '2R2', labelSize: 8 }),
    r(66, 44, 8, 5, SMD, { radius: 1, outline: false }),
    r(66, 54, 8, 5, SMD, { radius: 1, outline: false }),
    // USB-C receptacle at the right edge, opening facing out.
    r(W - 30, 34, 30, 30, METAL, { radius: 4 }),
    r(W - 7, 40, 4, 18, '#8A9099', { radius: 2, outline: false }),
    ...pad(7, left.pos['B-']), ...pad(7, left.pos['B+']),
    ...[bottom.pos.K, bottom.pos['5V+'], bottom.pos['5V-']].flatMap((x) => pad(x, H - 7)),
  ]
  write('ip5306-usbc-module.json', moduleJson({
    id: 'ip5306-usbc-module', name: 'IP5306 USB-C charge/boost module (18650, 5 V out)',
    source: 'https://done.land/components/power/powersupplies/battery/chargers/charge-discharge/ip5306/x-150/ https://www.amazon.com/dp/B0DDLF99HN',
    pins: [...left.pins, ...bottom.pins], internal: [['B-', '5V-']], wu, hu,
    electrical: { model: 'power_bank', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2. TP4056 USB-C charger with DW01A/8205A protection (the common blue 26 x 17 mm board). Seen
//    from the component side with the USB-C socket at the left: IN+ and IN- pads at the two left
//    corners (IN+ on the LED edge); at the right end, top to bottom, OUT+, B+, B-, OUT-.
//    OUT+ is B+; IN- is OUT- (the protection FETs sit between B- and OUT-).
{
  const wu = 13, hu = 9, W = wu * 10, H = hu * 10
  const types = {
    'IN+': { type: 'power_in', supply: '5V' }, 'IN-': { type: 'ground' },
    'OUT+': { type: 'power_out', supply: 'VBAT' }, 'B+': { type: 'power_in', supply: 'VBAT' },
    'B-': { type: 'ground' }, 'OUT-': { type: 'ground' },
  }
  const left = side('left', ['IN+', null, null, null, null, null, 'IN-'], types, hu)
  const right = side('right', ['OUT+', null, 'B+', null, 'B-', null, 'OUT-'], types, hu)
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    // USB-C receptacle on the left edge between the IN pads.
    r(0, 30, 28, 30, METAL, { radius: 4 }),
    r(3, 36, 4, 18, '#8A9099', { radius: 2, outline: false }),
    r(36, 7, 8, 5, LED_RED, { radius: 1, outline: false }),
    r(50, 7, 8, 5, LED_BLUE, { radius: 1, outline: false }),
    ...sop(38, 32, 28, 22, 4, 'TP4056'),
    r(80, 18, 12, 12, CHIP, { radius: 1 }),
    ...sop(78, 46, 16, 22, 4, '8205', 4),
    r(46, 66, 8, 5, SMD, { radius: 1, outline: false }),
    ...pad(7, left.pos['IN+']), ...pad(7, left.pos['IN-']),
    ...['OUT+', 'B+', 'B-', 'OUT-'].flatMap((n) => pad(W - 7, right.pos[n])),
  ]
  write('tp4056-module.json', moduleJson({
    id: 'tp4056-module', name: 'TP4056 Li-ion charger (USB-C, with protection)',
    source: 'https://www.amazon.com/dp/B07PKND8KG https://www.addicore.com/products/tp4056-tc4056a-lithium-battery-charger-and-protection-module https://www.teachmemicro.com/tp4056-charging-module-pinout-wiring-charging-current-and-arduino-use/',
    pins: [...left.pins, ...right.pins], internal: [['IN-', 'OUT-'], ['B+', 'OUT+']], wu, hu,
    electrical: { model: 'charger', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 3. AMS1117-3.3 regulator, the small 3-pin board. Silkscreen (on the capacitor side) GND OUT VIN;
//    seen from the regulator side with the header at the bottom the pins run GND, OUT, VIN left to
//    right, straight below the SOT-223's own GND, OUT, VIN legs. Input 4.75 to 12 V.
{
  const wu = 8, hu = 10, W = wu * 10, H = hu * 10
  const types = {
    GND: { type: 'ground' }, OUT: { type: 'power_out', supply: '3V3' }, VIN: { type: 'power_in', supply: '5V/9V/12V' },
  }
  const bottom = side('bottom', ['GND', 'OUT', 'VIN'], types, wu)
  const xs = ['GND', 'OUT', 'VIN'].map((n) => bottom.pos[n])
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    r(24, 6, 32, 12, METAL, { radius: 1 }),
    ...xs.map((x) => r(x - 2, 44, 4, 12, METAL, { outline: false })),
    r(14, 16, 52, 30, CHIP, { radius: 1, label: 'AMS1117', labelColor: METAL, labelSize: 6 }),
    r(26, 34, 28, 8, CHIP, { outline: false, label: '3.3', labelColor: METAL, labelSize: 5 }),
    r(64, 8, 6, 4, LED_RED, { radius: 1, outline: false }),
    ...xs.flatMap((x) => pad(x, H - 7)),
  ]
  write('ams1117-33-module.json', moduleJson({
    id: 'ams1117-33-module', name: 'AMS1117 3.3 V regulator module (3-pin, GND OUT VIN)',
    source: 'https://www.amazon.com/dp/B07CP4P5XJ https://protosupplies.com/product/ams1117-5v-to-3-3v-step-down-regulator-module/',
    pins: bottom.pins, wu, hu, electrical: { model: 'regulator', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 4. LM2596 adjustable buck converter (the common blue 43 x 21 mm board with the blue trimmer).
//    Seen from the component side with the LM2596 at the left: IN+ top left, IN- bottom left,
//    OUT+ top right, OUT- bottom right. Input and output grounds are one net. The output voltage
//    is set with the trimmer; it is the part's editable value.
{
  const wu = 17, hu = 9, W = wu * 10, H = hu * 10
  const types = {
    'IN+': { type: 'power_in', supply: '5V/9V/12V/24V' }, 'IN-': { type: 'ground' },
    'OUT+': { type: 'power_out', supply: 'VOUT' }, 'OUT-': { type: 'ground' },
  }
  const gap = [null, null, null, null, null]
  const left = side('left', ['IN+', ...gap, 'IN-'], types, hu)
  const right = side('right', ['OUT+', ...gap, 'OUT-'], types, hu)
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    r(10, 36, 10, 10, MOUNT, { radius: 5, outline: false }),
    r(W - 20, 36, 10, 10, MOUNT, { radius: 5, outline: false }),
    // LM2596S (TO-263): tab up, five legs down.
    r(40, 8, 30, 8, METAL, { radius: 1 }),
    ...[43, 49, 55, 61, 67].map((x) => r(x - 1.5, 44, 3, 8, METAL, { outline: false })),
    r(36, 14, 38, 30, CHIP, { radius: 1, label: 'LM2596S', labelColor: METAL, labelSize: 6 }),
    // Input capacitor under the regulator, diode beside it.
    r(26, 48, 26, 26, CAP, { radius: 13 }),
    r(32, 54, 14, 14, CAP_TOP, { radius: 7, outline: false }),
    r(56, 60, 20, 10, CHIP, { radius: 1, label: 'SS34', labelColor: METAL, labelSize: 5 }),
    // Trimmer with its brass screw, inductor, output capacitor.
    r(82, 6, 34, 16, POT, { radius: 2, label: '103', labelColor: '#FFFFFF', labelSize: 6 }),
    r(108, 9, 6, 6, BRASS, { radius: 3, outline: false }),
    r(82, 30, 40, 40, BLACK_PCB, { radius: 8, label: '470', labelColor: METAL, labelSize: 9 }),
    r(128, 46, 26, 26, CAP, { radius: 13 }),
    r(134, 52, 14, 14, CAP_TOP, { radius: 7, outline: false }),
    ...pad(7, left.pos['IN+']), ...pad(7, left.pos['IN-']),
    ...pad(W - 7, right.pos['OUT+']), ...pad(W - 7, right.pos['OUT-']),
  ]
  write('lm2596-buck-module.json', moduleJson({
    id: 'lm2596-buck-module', name: 'LM2596 buck converter module (adjustable)',
    source: 'https://www.amazon.com/dp/B08NV3JCBC https://www.instructables.com/How-to-Use-DC-to-DC-Buck-Converter-LM2596/',
    pins: [...left.pins, ...right.pins], internal: [['IN-', 'OUT-']], wu, hu,
    electrical: { model: 'buck_converter', params: { voltage: { unit: 'V', default: 5 } } }, shapes,
  }))
}
