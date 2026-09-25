// Generates the built-in chip and display module JSON files: the MCP23017/MCP23018 DIP-28 I/O
// expanders and the small SPI TFT and I2C OLED display modules. Pin lists are transcribed from the
// sources cited on each part below (Microchip datasheets; the module maker's pinout table and
// board photos for the displays).
//
// Run from the repo root: `node scripts/gen-parts.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites those files in modules/ in place; re-run after changing a part's pin list or art,
// then `git diff` the result before committing. src/format/parts.test.ts pins the order.
import { emit, finish, log } from './lib/gen-output.mjs'
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
  emit(OUT + file, JSON.stringify(m, null, 2) + '\n')
  const n = m.pins.filter((p) => !p.spacer).length
  log(file, 'pins', n, 'body', m.art.w, 'x', m.art.h)
}

function moduleJson({ id, name, category, source, pins, wu, hu, electrical, shapes }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category, source, pins }
  m.size = { w: wu, h: hu }
  m.electrical = electrical
  // Header parts draw pin names inside the body beside each pin, like the silkscreen.
  m.art = { w: wu * 10, h: hu * 10, pinLabels: 'inside', shapes }
  return m
}

// ---------------------------------------------------------------------------------------------
// Chips: top-view DIP-28, notch at the top, pin 1 at top left. Left = pins 1 to 14 top to bottom,
// right = pins 28 down to 15 top to bottom (the array order).

function dip28({ file, id, name, source, byNumber, mark, types }) {
  if (byNumber.length !== 28) throw new Error(`${file}: need 28 pins`)
  const wu = 10, hu = 19
  const W = wu * 10, H = hu * 10
  const ys = slots(hu, 14)
  const left = byNumber.slice(0, 14), right = byNumber.slice(14).reverse()
  const pins = [...pinsFor('left', left, types), ...pinsFor('right', right, types)]
  const shapes = [
    r(0, 0, W, H, CHIP, { radius: 3 }),
    ...ys.flatMap((y) => [
      r(1, y - 2, 8, 4, METAL, { radius: 1, outline: false }),
      r(W - 9, y - 2, 8, 4, METAL, { radius: 1, outline: false }),
    ]),
    r(W / 2 - 8, 2, 16, 8, CHIP_MARK, { radius: 4 }),
    r(13, 11, 5, 5, CHIP_MARK, { radius: 2.5, outline: false }),
    r(15, H - 20, W - 30, 12, CHIP, { outline: false, label: mark, labelColor: METAL, labelSize: 7 }),
  ]
  write(file, moduleJson({ id, name, category: 'Chips', source, pins, wu, hu, electrical: { model: 'io-expander', params: {} }, shapes }))
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
  types: chipTypes({ A0: { type: 'input' }, A1: { type: 'input' }, A2: { type: 'input' }, GPA7: { type: 'output' }, GPB7: { type: 'output' } }),
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
})

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
  write(file, moduleJson({ id, name, category: 'Displays', source, pins, wu, hu, electrical: { model: 'display', params: {} }, shapes }))
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
  write('oled-ssd1306-091-i2c.json', moduleJson({
    id: 'oled-ssd1306-091-i2c', name: '0.91" OLED 128x32 SSD1306 (I2C)', category: 'Displays',
    source: 'https://www.lcdwiki.com/0.91inch_IIC_OLED_Module_SSD1306_SKU:MC091GX https://www.lcdwiki.com/res/MC091GX/0.91inch_IIC_OLED_Module_MC091GX_User_Manual_EN.pdf',
    pins: pinsFor('left', left, oledTypes), wu, hu, electrical: { model: 'display', params: {} }, shapes,
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
  write('tft-st7789-154-spi.json', moduleJson({
    id: 'tft-st7789-154-spi', name: '1.54" TFT 240x240 ST7789 (SPI, 8-pin with CS)', category: 'Displays',
    source: 'https://www.lcdwiki.com/1.54inch_IPS_Module https://www.makerfocus.com/products/1-54inch-tft-lcd-display-module',
    pins: pinsFor('top', top, types), wu, hu, electrical: { model: 'display', params: {} }, shapes,
  }))
}

finish('gen-parts.mjs')
