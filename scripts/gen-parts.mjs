// Generates the built-in chip, display and storage module JSON files: the MCP23017/MCP23018 DIP-28
// I/O expanders and the CJMCU-2317 MCP23017 breakout, the small SPI TFT and I2C OLED display modules and the SPI microSD modules. Pin
// lists are transcribed from the sources cited on each part below (Microchip datasheets; the
// module maker's pinout table and board photos for the displays and microSD modules).
//
// Run from the repo root: `node scripts/gen-parts.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites those files in modules/ in place; re-run after changing a part's pin list or art,
// then `git diff` the result before committing. src/format/parts.test.ts pins the order.
import { emit, finish, log } from './lib/gen-output.mjs'
import { moduleText } from './lib/kicad.mjs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const GOLD = '#E0B43C', HOLE = '#8A6A1E', METAL = '#C9CED6'
const CHIP = '#1E2126', CHIP_MARK = '#3A3F47'
const BLUE = '#1E4F8A', MOUNT = '#123356', SCREEN = '#1B1F24', SCREEN_IN = '#262C34', FRAME = '#B8C2CC'
const GLASS = '#101418', OLED_BLUE = '#7FC8F8', OLED_YELLOW = '#F2C94C', FPC = '#C8742B'

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

/** Pin positions (px) along a side `len` units long with `n` slots, per computeLayout. */
function slots(len, n) {
  const s0 = Math.ceil((len - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * 10)
}

// Pin spec shorthand: 'NAME' or 'NAME|label'; type and supply come from the part's typer.
function pinsFor(side, list, types) {
  return list.map((s) => {
    const [name, label] = s.split('|')
    const t = types(label ?? name)
    const p = { name, side }
    if (label) p.label = label
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    if (t.caps) p.caps = t.caps
    return p
  })
}

/** Type table: silkscreen text to { type, supply }; anything unlisted is plain io. */
const typer = (table) => (text) => table[text] ?? {}

/** A gold header strip with a hole per pin, vertical (left/right) or horizontal (top). */
function header(side, W, H, at) {
  const a0 = at[0] - 5, a1 = at[at.length - 1] + 5
  const shapes = []
  if (side === 'top') {
    shapes.push(r(a0, 2, a1 - a0, 8, GOLD, { radius: 2, outline: false }))
    for (const x of at) shapes.push(r(x - 1.5, 4.5, 3, 3, HOLE, { radius: 1.5, outline: false }))
  } else {
    const x = side === 'left' ? 2 : W - 10
    shapes.push(r(x, a0, 8, a1 - a0, GOLD, { radius: 2, outline: false }))
    for (const y of at) shapes.push(r(x + 2.5, y - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false }))
  }
  return shapes
}

const mountHoles = (W, H, inset = 5, s = 8) => [
  [inset, inset], [W - inset - s, inset], [inset, H - inset - s], [W - inset - s, H - inset - s],
].map(([x, y]) => r(x, y, s, s, MOUNT, { radius: s / 2, outline: false }))

function write(file, m) {
  emit(OUT + file, moduleText(m))
  const n = m.pins.filter((p) => !p.spacer).length
  log(file, 'pins', n, 'body', m.art.w, 'x', m.art.h)
}

function moduleJson({ id, name, category, source, pins, wu, hu, electrical, shapes, pinLabels = 'inside', footprint }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category, source, pins }
  m.size = { w: wu, h: hu }
  // A breakout plugged in by one header row stands upright: it covers only its leg holes.
  if (footprint) m.footprint = footprint
  m.electrical = electrical
  // Header parts draw pin names inside the body beside each pin, like the silkscreen; a DIP chip,
  // too thin at its true width, draws them past each pin's tip.
  m.art = { w: wu * 10, h: hu * 10, pinLabels, shapes }
  return m
}

// ---------------------------------------------------------------------------------------------
// Chips: top-view DIP-28 at true breadboard scale (Ruling C2): the 300 mil package's two pin rows
// are 0.3 inch (30 px) apart, so on a breadboard the pins land in rows e and f and the body lies
// over the centre channel only. Drawn with the notch at the left, the datasheet's package drawing
// (notch at the top, pin 1 top left) turned a quarter anticlockwise: bottom = pins 1 to 14 left to
// right, top = pins 28 down to 15 left to right (the array order, unchanged). The pin names draw
// past each pin's tip, since a 30 px body has no room for them inside.

function dip28({ file, id, name, source, byNumber, mark, types, i2c }) {
  if (byNumber.length !== 28) throw new Error(`${file}: need 28 pins`)
  const wu = 16, hu = 3
  const W = wu * 10, H = hu * 10
  const xs = slots(wu, 14)
  const bottom = byNumber.slice(0, 14), top = byNumber.slice(14).reverse()
  const pins = [...pinsFor('bottom', bottom, types), ...pinsFor('top', top, types)]
  // The package spans the pins plus half a pitch at each end; the legs are 3 px leads out to the
  // pin rows, so the holes under them stay free (only the package covers holes).
  const x0 = xs[0] - 9, x1 = xs[xs.length - 1] + 9
  const shapes = [
    ...xs.flatMap((x) => [r(x - 1.5, 0, 3, 5, METAL, { outline: false }), r(x - 1.5, H - 5, 3, 5, METAL, { outline: false })]),
    r(x0, 4, x1 - x0, H - 8, CHIP, { radius: 2 }),
    // The notch at the pin 1 end, and the pin 1 dot beside pin 1.
    r(x0 + 1, H / 2 - 4, 6, 8, CHIP_MARK, { radius: 3 }),
    r(xs[0] - 2, H - 11, 4, 4, CHIP_MARK, { radius: 2, outline: false }),
    r(xs[2], 9, xs[11] - xs[2], 12, CHIP, { outline: false, label: mark, labelColor: METAL, labelSize: 8 }),
  ]
  write(file, moduleJson({ id, name, category: 'Chips', source, pins, wu, hu, electrical: { model: 'io-expander', params: {}, ...(i2c ? { i2c } : {}) }, shapes, pinLabels: 'tips' }))
}

// Duplicate datasheet names get a numbered pin name and the datasheet text as label.
function numberDuplicates(names) {
  const seen = new Map()
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1
    seen.set(n, k)
    return k === 1 ? n : `${n} ${k}|${n}`
  })
}

const chipTypes = (extra) => typer({
  VDD: { type: 'power_in', supply: '3V3/5V' }, VSS: { type: 'ground' }, NC: { type: 'nc' },
  SCL: { type: 'input' }, SDA: { type: 'io' }, RESET: { type: 'input' }, INTA: { type: 'output' }, INTB: { type: 'output' },
  ...extra,
})

// MCP23017 pin capabilities and I2C data, from the datasheet (DS20001952D, 2022):
//   - Table 2-1: GPA7 and GPB7 "Bidirectional I/O pin ... / Output only (MCP23017)"; the Features
//     list says the same. Cross-checked: Adafruit_CircuitPython_MCP230xx issue #57 ("Datasheet
//     Change Due To Issue Discovered In MCP23017 Chip": SDA can be corrupted when GPA7/GPB7 are
//     inputs, so Microchip made them output only).
//   - Section 3.3.1: the I2C client address is 0 1 0 0 A2 A1 A0, so 0x20 plus A2A1A0; Table 2-1:
//     A0-A2 "Hardware address pin. Must be externally biased." (no default when left open).
//   - A bare chip has no pull-up on SDA or SCL: the datasheet specifies its I2C timing with an
//     external RPU of 1 kOhm on SCL and SDA (I2C AC characteristics test conditions).
const MCP23017_CAPS = { outputOnly: true, note: 'Microchip made GPA7 and GPB7 output only in datasheet revision D; read inputs on the other 14 pins.' }
const MCP23017_ADDRESS = { base: 0x20, pins: [{ pin: 'A0', add: 1 }, { pin: 'A1', add: 2 }, { pin: 'A2', add: 4 }] }

// 1. MCP23017, 28-pin SPDIP. Table 2-1 (SPDIP column). GPA7/GPB7 are output-only on the MCP23017
//    per the current datasheet revision. Pin 12 is "SCK" in that table (shared with the MCP23S17);
//    it is the I2C clock, SCL.
dip28({
  file: 'mcp23017-dip28.json', id: 'mcp23017-dip28', name: 'MCP23017 I/O expander (DIP-28)', mark: 'MCP23017',
  source: 'https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23017-Data-Sheet-DS20001952.pdf',
  byNumber: numberDuplicates([
    'GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC',
    'A0', 'A1', 'A2', 'RESET', 'INTB', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7',
  ]),
  types: chipTypes({ A0: { type: 'input' }, A1: { type: 'input' }, A2: { type: 'input' }, GPA7: { type: 'output', caps: MCP23017_CAPS }, GPB7: { type: 'output', caps: MCP23017_CAPS } }),
  i2c: { sda: 'SDA', scl: 'SCL', address: MCP23017_ADDRESS, pullups: false },
})

// 2. MCP23018, 28-pin PDIP. Table 1-1 (28L PDIP/SOIC column): NC on 2, 14, 17 and 28; one analog
//    ADDR pin instead of A0 to A2; open-drain GPIO outputs.
dip28({
  file: 'mcp23018-dip28.json', id: 'mcp23018-dip28', name: 'MCP23018 I/O expander (DIP-28)', mark: 'MCP23018',
  source: 'https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23018-Data-Sheet-DS20002103.pdf',
  byNumber: numberDuplicates([
    'VSS', 'NC', 'GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'SCL', 'SDA', 'NC',
    'ADDR', 'RESET', 'NC', 'INTB', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7', 'NC',
  ]),
  types: chipTypes({ ADDR: { type: 'input' } }),
  // The address is set by the voltage on ADDR (a resistor divider), which is not modelled; whether
  // SDA/SCL need pull-ups is left unknown here (not cross-checked for this chip).
  i2c: { sda: 'SDA', scl: 'SCL' },
})

// 3. MCP23017 breakout sold as CJMCU-2317 (MCP23017/MCP23S17 dual-marked). Seen from the component
//    side (chip up), turned so the 2x10 header is at the left: the outer column (board edge) is
//    GND, INTA, GPA0-GPA7; the inner column VCC, INTB, GPB0-GPB7; the single 1x10 header at the
//    right edge is A2, A1, A0, RESET, NC/SO, NC/CS, SDA/SI, SCL/SCK, GND, VCC, top to bottom. The
//    silkscreen is on the back ("VCC/GND", "ITB/ITA", "B0/A0" ... beside the double row: inner/outer).
//    Sources agree: digitaltown photos of both sides, the Warlib1975 Fritzing part's BREADBOARD view
//    (component side; its PCB view is mirrored, so do not cross-check against that one) and the
//    EasyEDA footprint + symbol (component side, outer column GND/ITA/A0-A7), the ShillehTek manual
//    (inner column port B, outer column port A); the Microchip datasheet for the pin functions.
//
//    Every header position is a single-position pad hole group, none an edge pin: an edge pin's
//    inside label sits where the inner pad of the double row is, and pads never plug into a
//    breadboard, so with edge pins the board could seat with only part of its header connected.
//    With no pins the part never mounts (on a real breadboard the 2x10 header shorts each A/B pair).
//    The header columns keep their true 10 px pitch; the gap to the single row is widened so the
//    labels fit. Names follow the datasheet where the silkscreen is ambiguous ("A0" is both an
//    address pin and GPA0), with the silkscreen text as label.
{
  const id = 'mcp23017-cjmcu-2317'
  const W = 180, H = 110
  const PCB = '#2B2F36', HOUSING = '#1B1F24', SILK = '#E8ECF1'
  const OUTER = 40, INNER = 50, SINGLE = 170
  const ys = Array.from({ length: 10 }, (_, i) => 10 + i * 10)
  const gp = (port) => Array.from({ length: 8 }, (_, i) => `GP${port}${i}`)
  const columns = [
    { x: OUTER, align: 'right', list: ['GND', 'INTA|ITA', ...gp('A')] },
    { x: INNER, align: 'left', list: ['VCC', 'INTB|ITB', ...gp('B')] },
    { x: SINGLE, align: 'right', list: ['A2', 'A1', 'A0', 'RESET', 'NC|NC/SO', 'NC 2|NC/CS', 'SDA|SDA/SI', 'SCL|SCL/SCK', 'GND 2|GND', 'VCC 2|VCC'] },
  ]
  const types = typer({
    VCC: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' }, NC: { type: 'nc' },
    SCL: { type: 'input' }, SDA: { type: 'io' }, RESET: { type: 'input' }, A0: { type: 'input' }, A1: { type: 'input' }, A2: { type: 'input' },
    INTA: { type: 'output' }, INTB: { type: 'output' }, GPA7: { type: 'output', caps: MCP23017_CAPS }, GPB7: { type: 'output', caps: MCP23017_CAPS },
  })
  const holes = []
  // Silkscreen-style text beside each pad, right-aligned before it or left-aligned after it.
  const labels = []
  for (const c of columns)
    c.list.forEach((s, i) => {
      const [name, label] = s.split('|')
      // Type by pin function (the name, "GND 2" as GND); plain GPIO is io.
      const t = types(name.replace(/ \d+$/, ''))
      const g = { name }
      if (label) g.label = label
      g.at = [[c.x, ys[i]]]
      g.holeStyle = 'pad'
      g.type = t.type ?? 'io'
      if (t.supply) g.supply = t.supply
      if (t.caps) g.caps = t.caps
      holes.push(g)
      const text = label ?? name
      const w = Math.ceil(text.length * 4.2)
      const x = c.align === 'right' ? c.x - 7 - w : c.x + 7
      labels.push(r(x, ys[i] - 4, w, 8, PCB, { outline: false, label: text, labelColor: SILK, labelSize: 6.5 }))
    })
  const shapes = [
    r(0, 0, W, H, PCB, { radius: 3 }),
    // Black header housings on the component side, under the pads.
    r(OUTER - 6, 3, INNER - OUTER + 12, H - 6, HOUSING, { radius: 2 }),
    r(SINGLE - 6, 3, 12, H - 6, HOUSING, { radius: 2 }),
    // SSOP-28 lying across the board, leads above and below; resistor array above, three resistors below.
    r(88, 34, 36, 4, METAL, { outline: false }),
    r(88, 64, 36, 4, METAL, { outline: false }),
    r(84, 38, 44, 26, CHIP, { radius: 1, label: 'MCP23017', labelColor: METAL, labelSize: 6 }),
    r(98, 16, 16, 9, CHIP, { radius: 1 }),
    ...[92, 102, 112].map((x) => r(x, 74, 6, 9, CHIP, { radius: 1 })),
    r(84, 92, 44, 8, PCB, { outline: false, label: 'CJMCU-2317', labelColor: SILK, labelSize: 5.5 }),
    ...labels,
  ]
  const m = {
    format: 'circuitoon-module/1', id, version: 1,
    name: 'MCP23017 breakout CJMCU-2317 (chip side; labels are on the back)', category: 'Chips',
    source: [
      'https://www.digitaltown.co.uk/MCP23017.php',
      'https://github.com/Warlib1975/Fritzing-parts/blob/master/CJMCU2317-MCP23017.fzpz',
      'https://easyeda.com/component/1ae26967fb344abea8ad222656426ee7',
      'https://easyeda.com/component/25f3bfff95674c649e0437107b895aa7',
      'https://shillehtek.com/blogs/shillehtek-product-manuals/mcp23017-i2c-16bit-io-port-expander-presoldered-manual',
      'https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23017-Data-Sheet-DS20001952.pdf',
    ].join(' '),
    pins: [],
    holes,
    internal: [['GND', 'GND 2'], ['VCC', 'VCC 2']],
    size: { w: W / 10, h: H / 10 },
    // Pull-ups on SDA/SCL: Studio Pieters says the 8-pin "103" array on this board is the I2C
    // pull-ups, but no second source confirms it for this layout, so they stay unknown. Nothing
    // says the board pulls A0-A2, so they have no default either (the chip needs them biased).
    electrical: { model: 'io-expander', params: {}, i2c: { sda: 'SDA', scl: 'SCL', address: MCP23017_ADDRESS } },
    art: { w: W, h: H, shapes },
  }
  emit(OUT + 'mcp23017-cjmcu-2317.json', moduleText(m))
  log('mcp23017-cjmcu-2317.json', 'pads', holes.length, 'body', W, 'x', H)
}

// ---------------------------------------------------------------------------------------------
// SPI TFT modules (lcdwiki MSP series, sold under Hosyond and other brands). Seen from the screen
// side, turned so the main header is at the left: pin 1 (VCC, square pad) at the top. The 4-pin
// SD card header sits on the opposite edge, SD_CS (square pad) at the top.

const tftTypes = typer({
  VCC: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' },
  CS: { type: 'input' }, RESET: { type: 'input' }, 'DC/RS': { type: 'input' }, DC: { type: 'input' }, A0: { type: 'input' },
  'SDI(MOSI)': { type: 'input' }, SDA: { type: 'input' }, SCK: { type: 'input' }, LED: { type: 'input' }, 'SDO(MISO)': { type: 'output' },
  T_CLK: { type: 'input' }, T_CS: { type: 'input' }, T_DIN: { type: 'input' }, T_DO: { type: 'output' }, T_IRQ: { type: 'output' },
  SD_CS: { type: 'input' }, SD_MOSI: { type: 'input' }, SD_MISO: { type: 'output' }, SD_SCK: { type: 'input' },
})
const tft14 = (dc) => ['VCC', 'GND', 'CS', 'RESET', dc, 'SDI(MOSI)', 'SCK', 'LED', 'SDO(MISO)', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ']
const SD4 = ['SD_CS', 'SD_MOSI', 'SD_MISO', 'SD_SCK']

/** `lx`/`rx`: px kept clear for the left/right pin labels; `touch` adds the resistive panel frame. */
function tft({ file, id, name, source, left, right, wu, hu, lx, rx, touch, mark }) {
  const W = wu * 10, H = hu * 10
  const pins = [...pinsFor('left', left, tftTypes), ...pinsFor('right', right, tftTypes)]
  const x0 = lx, x1 = W - rx, y0 = 8, y1 = H - 8
  const glass = touch
    ? [r(x0, y0, x1 - x0, y1 - y0, FRAME, { radius: 3 }), r(x0 + 4, y0 + 4, x1 - x0 - 8, y1 - y0 - 8, SCREEN, { radius: 1 })]
    : [r(x0, y0, x1 - x0, y1 - y0, SCREEN, { radius: 2 })]
  const inset = touch ? 12 : 8
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 6 }),
    ...mountHoles(W, H),
    ...header('left', W, H, slots(hu, left.length)),
    ...header('right', W, H, slots(hu, right.length)),
    ...glass,
    r(x0 + inset, y0 + inset, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, SCREEN_IN, { outline: false, label: mark, labelColor: '#8FA3B8', labelSize: 9 }),
  ]
  write(file, moduleJson({ id, name, category: 'Displays', source, pins, wu, hu, electrical: { model: 'display', params: {} }, shapes }))
}

// 3. 4.0" 480x320 ST7796S with XPT2046 touch (lcdwiki MSP4021; the Hosyond 4.0" module). Silkscreen
//    "DC/RS". SD header J4: SD_CS, SD_MOSI, SD_MISO, SD_SCK (schematic J4 pins 1 to 4).
tft({
  file: 'lcd-st7796s-4in-spi-touch.json', id: 'lcd-st7796s-4in-spi-touch', name: '4.0" SPI TFT 480x320 ST7796S (touch)',
  source: 'https://www.lcdwiki.com/4.0inch_SPI_Module_ST7796 https://www.lcdwiki.com/res/MSP4021/4.0inch_SPI_Schematic.pdf',
  left: tft14('DC/RS'), right: SD4, wu: 36, hu: 22, lx: 58, rx: 48, touch: true, mark: '480x320 ST7796S',
})

// 4. 2.8" 240x320 ILI9341 with XPT2046 touch (lcdwiki MSP2807). Silkscreen "DC".
tft({
  file: 'tft-ili9341-28-spi-touch.json', id: 'tft-ili9341-28-spi-touch', name: '2.8" TFT 240x320 ILI9341 (SPI, touch)',
  source: 'https://www.lcdwiki.com/2.8inch_SPI_Module_ILI9341_SKU:MSP2807 https://www.lcdwiki.com/res/MSP2807/MSP2807-2.8-SPI.pdf',
  left: tft14('DC'), right: SD4, wu: 32, hu: 20, lx: 58, rx: 48, touch: true, mark: '240x320 ILI9341',
})

// 5. 2.4" 240x320 ILI9341 (lcdwiki MSP2401/MSP2402). The same 14-pin header on both; the T_ pins
//    only connect on the touch version (MSP2402).
tft({
  file: 'tft-ili9341-24-spi.json', id: 'tft-ili9341-24-spi', name: '2.4" TFT 240x320 ILI9341 (SPI; T_ pins on touch version)',
  source: 'https://www.lcdwiki.com/2.4inch_SPI_Module_ILI9341_SKU:MSP2402 https://www.lcdwiki.com/res/MSP2402/MSP2402-2.4-SPI.pdf',
  left: tft14('DC'), right: SD4, wu: 31, hu: 18, lx: 58, rx: 48, touch: false, mark: '240x320 ILI9341',
})

// 6. 1.8" 128x160 ST7735S, 8-pin header (lcdwiki MSP1803). Other 1.8" boards use other orders.
tft({
  file: 'tft-st7735-18-spi.json', id: 'tft-st7735-18-spi', name: '1.8" TFT 128x160 ST7735 (SPI, 8-pin)',
  source: 'https://www.lcdwiki.com/1.8inch_SPI_Module_ST7735S_SKU:MSP1803 https://www.lcdwiki.com/res/MSP1803/MSP1803-1.8-SPI.pdf',
  left: ['VCC', 'GND', 'CS', 'RESET', 'A0', 'SDA', 'SCK', 'LED'], right: SD4, wu: 22, hu: 12, lx: 40, rx: 46, touch: false, mark: '128x160',
})

// ---------------------------------------------------------------------------------------------
// Small modules with the header along the top edge (or the left edge of the 0.91" OLED).

const oledTypes = typer({ VCC: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' }, SCL: { type: 'input' }, SDA: { type: 'io' } })

// I2C on the 0.96" and 1.3" modules: the address is 0x3C (8-bit 0x78) as shipped, 0x3D (0x7A) with
// the address resistor on the back moved (lcdwiki MC130GX: "Solder the 0x78 side resistance ...
// (default)"; the MC096 and MC130 schematics show the 0x78/0x7A resistor pair on SA0; Addicore:
// "Default: 0x78, Solder Selectable: 0x7A"). It is a part setting, so a moved resistor can be
// recorded in the Inspector. Pull-ups: the lcdwiki schematics fit 4.7 kOhm on SCL and SDA, but
// these modules are sold by many makers and generic boards are reported without them, so they
// stay unknown (the checker then asks to check).
const OLED_I2C = { settings: { address: ['0x3C', '0x3D'] }, i2c: { sda: 'SDA', scl: 'SCL', address: { setting: 'address' } } }

/** Blue PCB, black glass with a yellow/blue text hint, FPC tail under the glass. */
function oled({ file, id, name, source, top, wu, hu }) {
  const W = wu * 10, H = hu * 10
  const xs = slots(wu, top.length)
  const pins = pinsFor('top', top, oledTypes)
  const gy = 32, gh = H - gy - 20
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 5 }),
    ...mountHoles(W, H, 4, 9),
    ...header('top', W, H, xs),
    r(5, gy, W - 10, gh, GLASS, { radius: 2 }),
    r(12, gy + 7, (W - 24) * 0.55, 6, OLED_YELLOW, { radius: 1, outline: false }),
    r(12, gy + 18, W - 24, 5, OLED_BLUE, { radius: 1, outline: false }),
    r(12, gy + 27, (W - 24) * 0.7, 5, OLED_BLUE, { radius: 1, outline: false }),
    r(W / 2 - 18, gy + gh, 36, 10, FPC, { radius: 1 }),
  ]
  write(file, moduleJson({ id, name, category: 'Displays', source, pins, wu, hu, electrical: { model: 'display', params: {}, ...OLED_I2C }, shapes, footprint: 'legs' }))
}

// 7/8. 0.96" 128x64 SSD1306 I2C. Both power orders are widespread: lcdwiki sells both (MC096GX
//      GND first, MC096VX VCC first) and Addicore lists them as pinout A and B.
oled({
  file: 'oled-ssd1306-096-i2c.json', id: 'oled-ssd1306-096-i2c', name: '0.96" OLED 128x64 SSD1306 (I2C, GND VCC SCL SDA)',
  source: 'https://www.lcdwiki.com/0.96inch_OLED_Module_MC096GX https://www.addicore.com/products/oled-display-128x64-0-96in-monochrome',
  top: ['GND', 'VCC', 'SCL', 'SDA'], wu: 13, hu: 13,
})
oled({
  file: 'oled-ssd1306-096-i2c-vcc-gnd.json', id: 'oled-ssd1306-096-i2c-vcc-gnd', name: '0.96" OLED 128x64 SSD1306 (I2C, VCC GND SCL SDA)',
  source: 'https://lcdwiki.com/0.96inch_OLED_Module_(IIC-4P_SKU:MC096VX) https://www.addicore.com/products/oled-display-128x64-0-96in-monochrome',
  top: ['VCC', 'GND', 'SCL', 'SDA'], wu: 13, hu: 13,
})

// 9/10. 1.3" 128x64 SH1106 I2C: lcdwiki MC130GX (GND first) and MC130VX (VCC first).
oled({
  file: 'oled-sh1106-13-i2c.json', id: 'oled-sh1106-13-i2c', name: '1.3" OLED 128x64 SH1106 (I2C, GND VCC SCL SDA)',
  source: 'https://www.lcdwiki.com/1.3inch_IIC_OLED_Module_SKU:MC130GX https://shillehtek.com/blogs/shillehtek-product-manuals/1-3-i2c-white-oled-display-module-4-pin-sh1106-manual',
  top: ['GND', 'VCC', 'SCL', 'SDA'], wu: 15, hu: 15,
})
oled({
  file: 'oled-sh1106-13-i2c-vcc-gnd.json', id: 'oled-sh1106-13-i2c-vcc-gnd', name: '1.3" OLED 128x64 SH1106 (I2C, VCC GND SCL SDA)',
  source: 'https://www.lcdwiki.com/1.3inch_IIC_OLED_Module_SKU:MC130VX https://electropeak.com/learn/interfacing-sh1106-1-3-inch-i2c-oled-128x64-display-with-arduino/',
  top: ['VCC', 'GND', 'SCL', 'SDA'], wu: 15, hu: 15,
})

// 11. 0.91" 128x32 SSD1306 I2C (lcdwiki MC091GX). Header on the short left edge, silkscreen
//     reading bottom to top GND VCC SCL SDA, GND the square pad at the bottom.
{
  const wu = 22, hu = 7, W = wu * 10, H = hu * 10
  const left = ['SDA', 'SCL', 'VCC', 'GND']
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    ...header('left', W, H, slots(hu, left.length)),
    r(36, 6, W - 60, H - 12, GLASS, { radius: 2 }),
    r(44, 16, (W - 76) * 0.6, 6, OLED_BLUE, { radius: 1, outline: false }),
    r(44, 28, (W - 76) * 0.8, 6, OLED_BLUE, { radius: 1, outline: false }),
    r(44, 40, (W - 76) * 0.45, 6, OLED_BLUE, { radius: 1, outline: false }),
    r(W - 24, 12, 14, H - 24, FPC, { radius: 1 }),
  ]
  write('oled-ssd1306-091-i2c.json', moduleJson({footprint: 'legs', 
    id: 'oled-ssd1306-091-i2c', name: '0.91" OLED 128x32 SSD1306 (I2C)', category: 'Displays',
    source: 'https://www.lcdwiki.com/0.91inch_IIC_OLED_Module_SSD1306_SKU:MC091GX https://www.lcdwiki.com/res/MC091GX/0.91inch_IIC_OLED_Module_MC091GX_User_Manual_EN.pdf',
    // I2C bus pins only: no source found gives this module's address, and its pull-ups stay unknown as above.
    pins: pinsFor('left', left, oledTypes), wu, hu, electrical: { model: 'display', params: {}, i2c: { sda: 'SDA', scl: 'SCL' } }, shapes,
  }))
}

// 12. 1.54" 240x240 ST7789 IPS, 8-pin header along the top (lcdwiki 1.54inch IPS Module MSP1541).
//     3.3 V only. Some 1.54" boards have 7 pins (no CS); this is the 8-pin one.
{
  const wu = 15, hu = 18, W = wu * 10, H = hu * 10
  const top = ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BLK']
  const types = typer({
    GND: { type: 'ground' }, VCC: { type: 'power_in', supply: '3V3' },
    SCL: { type: 'input' }, SDA: { type: 'input' }, RES: { type: 'input' }, DC: { type: 'input' }, CS: { type: 'input' }, BLK: { type: 'input' },
  })
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 5 }),
    ...mountHoles(W, H, 4, 9),
    ...header('top', W, H, slots(wu, top.length)),
    r(8, 32, W - 16, W - 16, SCREEN, { radius: 2 }),
    r(16, 40, W - 32, W - 32, SCREEN_IN, { outline: false, label: '240x240 ST7789', labelColor: '#8FA3B8', labelSize: 8 }),
  ]
  write('tft-st7789-154-spi.json', moduleJson({footprint: 'legs', 
    id: 'tft-st7789-154-spi', name: '1.54" TFT 240x240 ST7789 (SPI, 8-pin with CS)', category: 'Displays',
    source: 'https://www.lcdwiki.com/1.54inch_IPS_Module https://www.makerfocus.com/products/1-54inch-tft-lcd-display-module',
    pins: pinsFor('top', top, types), wu, hu, electrical: { model: 'display', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// microSD card modules (SPI), 6-pin header along the left edge seen from the socket side.

const sdTypes = (vcc) => typer({
  [vcc.name]: { type: 'power_in', supply: vcc.supply }, GND: { type: 'ground' },
  CS: { type: 'input' }, MOSI: { type: 'input' }, CLK: { type: 'input' }, SCK: { type: 'input' }, MISO: { type: 'output' },
})
const SOCKET = '#C9CED6', SOCKET_IN = '#AEB5BF', CARD = '#1B1F24'

/** Metal push-push socket with its row of contacts toward the header and the card slot at the right. */
const sdSocket = (x, y, w, h) => [
  ...Array.from({ length: 8 }, (_, i) => r(x - 6, y + 8 + i * ((h - 16) / 7) - 1, 8, 2, GOLD, { outline: false })),
  r(x, y, w, h, SOCKET, { radius: 2 }),
  r(x + 6, y + 6, w - 12, h - 12, SOCKET_IN, { radius: 1, outline: false }),
  r(x + w - 10, y + h / 2 - 10, 8, 20, CARD, { radius: 1 }),
]

// 13. microSD module, 3.3 V only (no regulator, no level shifter; 10k pull-ups), 20 x 18 mm.
//     Back silkscreen 3V3, CS, MOSI, CLK, MISO, GND along the header; the same order top to bottom
//     from the socket side with the header at the left.
{
  const wu = 13, hu = 10, W = wu * 10, H = hu * 10
  const left = ['3V3', 'CS', 'MOSI', 'CLK', 'MISO', 'GND']
  const ys = slots(hu, left.length)
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    ...header('left', W, H, ys),
    ...ys.slice(1, 5).map((y) => r(42, y - 2, 8, 4, '#2B2F36', { radius: 1, outline: false })),
    ...sdSocket(62, 12, 60, H - 24),
  ]
  write('microsd-spi-3v3.json', moduleJson({footprint: 'legs', 
    id: 'microsd-spi-3v3', name: 'microSD card module (SPI, 3.3 V only: 3V3 CS MOSI CLK MISO GND)', category: 'Communication',
    source: 'https://protosupplies.com/product/microsd-card-module/ https://www.amazon.com/dp/B0H67347LH',
    pins: pinsFor('left', left, sdTypes({ name: '3V3', supply: '3V3' })), wu, hu, electrical: { model: 'storage', params: {} }, shapes,
  }))
}

// 14. microSD module, 5 V (AMS1117-3.3 regulator and 74LVC125A level shifter; silkscreen "MicroSD
//     Card Adapter"), 42 x 24 mm. Front silkscreen GND, VCC, MISO, MOSI, SCK, CS top to bottom with
//     the header at the left.
{
  const wu = 18, hu = 10, W = wu * 10, H = hu * 10
  const left = ['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS']
  const ys = slots(hu, left.length)
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    // Three corner holes; the header covers the top left one.
    ...mountHoles(W, H, 4, 9).slice(1),
    ...header('left', W, H, ys),
    r(52, 8, 30, 8, METAL, { radius: 1 }),
    r(48, 14, 38, 26, CHIP, { radius: 1, label: 'AMS1117', labelColor: METAL, labelSize: 5.5 }),
    ...Array.from({ length: 7 }, (_, i) => r(50 + i * 5, 55, 2.5, 3, METAL, { outline: false })),
    ...Array.from({ length: 7 }, (_, i) => r(50 + i * 5, 78, 2.5, 3, METAL, { outline: false })),
    r(48, 58, 38, 20, CHIP, { radius: 1, label: 'LVC125A', labelColor: METAL, labelSize: 5 }),
    ...sdSocket(106, 12, 62, H - 24),
  ]
  write('microsd-spi-5v.json', moduleJson({footprint: 'legs', 
    id: 'microsd-spi-5v', name: 'microSD card module (SPI, 5 V with level shifter: GND VCC MISO MOSI SCK CS)', category: 'Communication',
    source: 'https://www.amazon.com/dp/B0B779R5TZ https://envistiamall.com/blogs/learn/micro-sd-card-spi-module-user-guide',
    pins: pinsFor('left', left, sdTypes({ name: 'VCC', supply: '5V' })), wu, hu, electrical: { model: 'storage', params: {} }, shapes,
  }))
}

finish('gen-parts.mjs')
