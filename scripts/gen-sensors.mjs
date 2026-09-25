// Generates the built-in addressable LEDs and sensor modules: the WS2812B LED strip segment, the
// WS2812D-F5 5 mm through-hole addressable LED, the DHT22 (3-pin module and bare 4-pin sensor),
// the BME280 I2C boards (4-pin with regulator, 6-pin GY-BME280), the HC-SR501 PIR motion sensor
// and the HC-SR04 ultrasonic distance sensor. Pin orders are transcribed from the sources cited on
// each part below (datasheets, vendor photos with legible silkscreen, cross-checked against a
// second, independent source).
//
// Run from the repo root: `node scripts/gen-sensors.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites those files in modules/ in place; re-run after changing a part's pins or art,
// then `git diff` the result before committing. src/format/sensors.test.ts pins the order.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'

const METAL = '#C9CED6', HOLE = '#6B727C', LEAD = '#B8BEC7', CHIP = '#1E2126'
const GOLD = '#E0B43C', GOLD_HOLE = '#8A6A1E', COPPER = '#D98C2B', BLACK_PCB = '#2B2F36'
const BLUE = '#1E4F8A', GREEN = '#2F9E6E', PURPLE = '#7B3FA0', MOUNT_DARK = '#1B1F24'
const WHITE_CASE = '#EEF0EC', GRILLE = '#9AA0A6', LENS = '#F4F6F8', LENS_SHADE = '#DDE2E7'
const LED_BODY = '#F2F2EE', POT = '#F08A24', SMD = '#C8A27A', LED_R = '#E0483E', LED_G = '#3FB56B', LED_B = '#4F8EF7'

/** A gold header strip along the bottom edge with a hole per pin, kept in the outer 12 px. */
function bottomHeader(H, at) {
  const a0 = at[0] - 5, a1 = at[at.length - 1] + 5
  return [
    r(a0, H - 10, a1 - a0, 8, GOLD, { radius: 2, outline: false }),
    ...at.map((x) => r(x - 1.5, H - 7.5, 3, 3, GOLD_HOLE, { radius: 1.5, outline: false })),
  ]
}

/** Component legs running from `y0` straight down to the body's bottom edge. */
const legs = (H, at, y0) => at.map((x) => r(x - 1.5, y0, 3, H - y0, LEAD, { outline: false }))

// =============================================================================================
// Addressable LEDs (Indicators)

// ---------------------------------------------------------------------------------------------
// 1. WS2812B LED strip, a 5-LED segment (60 LEDs/m look). Seen from the LED side with the data
//    arrows pointing right: the input pads at the left edge read GND, Din, 5V top to bottom, and
//    the output pads at the right edge GND, Dout, 5V (Pololu's close-up of the WS2812B strip
//    silkscreen; Last Minute Engineers' strip pinout draws the same GND, DIN, +5V order). The two
//    5V pads and the two GND pads are the strip's power rails.
{
  const wu = 32, hu = 6, W = wu * 10, H = hu * 10
  const types = {
    GND: { type: 'ground' }, '5V': { type: 'power_in', supply: '5V' },
    DIN: { type: 'input' }, DOUT: { type: 'output' },
  }
  const left = side('left', ['GND', 'DIN', '5V'], types, hu)
  const right = side('right', ['GND 2|GND', 'DOUT', '5V 2|5V'], types, hu)
  const copper = (x, y) => r(x - 5, y - 3, 10, 6, COPPER, { radius: 3, outline: false })
  const pitch = 54, x0 = 43
  const leds = [0, 1, 2, 3, 4].flatMap((i) => {
    const x = x0 + i * pitch
    return [
      r(x, 16, 26, 26, LED_BODY, { radius: 2 }),
      r(x + 5, 21, 16, 16, '#FFFFFF', { radius: 8 }),
      r(x + 8, 25, 3, 4, LED_R, { radius: 1, outline: false }),
      r(x + 12, 25, 3, 4, LED_G, { radius: 1, outline: false }),
      r(x + 16, 25, 3, 4, LED_B, { radius: 1, outline: false }),
      // Data-direction arrow printed after every LED.
      r(x + 29, 44, 20, 9, BLACK_PCB, { outline: false, label: '→', labelColor: '#FFFFFF', labelSize: 9 }),
    ]
  })
  const shapes = [
    r(0, 0, W, H, BLACK_PCB, { radius: 3 }),
    // Copper rails along the edges (5V along the bottom, GND along the top), faint.
    r(12, 3, W - 24, 2, '#4A4F57', { outline: false }),
    r(12, H - 5, W - 24, 2, '#4A4F57', { outline: false }),
    ...leds,
    ...left.at.map((y) => copper(6, y)),
    ...right.at.map((y) => copper(W - 6, y)),
  ]
  write('ws2812b-strip.json', moduleJson({
    inside: true, id: 'ws2812b-strip', name: 'WS2812B LED strip (5-LED segment, pads GND DIN 5V)', category: 'Indicators',
    source: 'https://www.pololu.com/product/2547 https://a.pololu-files.com/picture/0J5802.1200.jpg https://lastminuteengineers.com/ws2812b-arduino-tutorial/',
    pins: [...left.pins, ...right.pins], internal: [['GND', 'GND 2'], ['5V', '5V 2']], wu, hu,
    electrical: { model: 'addressable_led', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2. WS2812D-F5, the 5 mm through-hole addressable RGB LED. Worldsemi's datasheet ("Mechanical
//    Dimensions & PIN Configuration") numbers the legs 1 DOUT, 2 VDD, 3 GND, 4 DIN; its front
//    elevation shows them 4, 3, 2, 1 left to right with pin 1 on the flat side of the rim and
//    pin 2 (VDD) the longest. Drawn the same way: DIN, GND, VDD, DOUT left to right, flat at right.
{
  const wu = 7, hu = 10, W = wu * 10, H = hu * 10
  const types = {
    DIN: { type: 'input' }, GND: { type: 'ground' }, VDD: { type: 'power_in', supply: '5V' }, DOUT: { type: 'output' },
  }
  const bottom = side('bottom', ['DIN', 'GND', 'VDD', 'DOUT'], types, wu)
  const shapes = [
    ...legs(H, bottom.at, 50),
    // Rim: rounded on the left, cut flat on the right (pin 1, DOUT).
    r(13, 42, 42, 10, LENS_SHADE, { radius: 2 }),
    r(17, 6, 36, 42, LENS, { radius: 16 }),
    r(23, 12, 6, 12, '#FFFFFF', { radius: 3, outline: false }),
    r(28, 28, 4, 5, LED_R, { radius: 1, outline: false }),
    r(33, 28, 4, 5, LED_G, { radius: 1, outline: false }),
    r(38, 28, 4, 5, LED_B, { radius: 1, outline: false }),
    r(52, 42, 3, 10, '#8E96A1', { outline: false }),
  ]
  write('ws2812b-5mm.json', moduleJson({
    inside: true, id: 'ws2812b-5mm', name: 'WS2812 5 mm through-hole RGB LED (WS2812D-F5, DIN GND VDD DOUT)', category: 'Indicators',
    source: 'https://www.tme.eu/Document/6ea29838e05beac06400c47a846319d2/WS2812D-F5.pdf https://www.hobbyelectronica.nl/en/product/rgb-led-ws2812d-f5/',
    pins: bottom.pins, wu, hu, electrical: { model: 'addressable_led', params: {} }, shapes,
  }))
}

// =============================================================================================
// Sensors

/** The DHT22's white case with its grille, `x, y` its top left, 60 x 90 px. */
function dht22Case(x, y) {
  const grille = []
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 4; col++) grille.push(r(x + 9 + col * 11, y + 24 + row * 10, 7, 5, GRILLE, { radius: 1, outline: false }))
  return [
    r(x + 16, y, 28, 18, WHITE_CASE, { radius: 4 }),
    r(x + 24, y + 4, 10, 10, '#FFFFFF', { radius: 5 }),
    r(x, y + 12, 60, 78, WHITE_CASE, { radius: 3 }),
    ...grille,
  ]
}

// ---------------------------------------------------------------------------------------------
// 3. DHT22 on the common 3-pin breakout (black PCB, pull-up on board). Seen from the grille side
//    with the header at the bottom the silkscreen reads "+ out -" left to right (components101's
//    module photo; ShillehTek's module pinout shows VCC, DATA, GND in the same order).
{
  const wu = 8, hu = 14, W = wu * 10, H = hu * 10
  // Pin names are the silkscreen; + and - are labeled VCC and GND on the sheet because a lone
  // "-" drawn reading bottom to top (as bottom-edge labels are) looks like "|".
  const types = { VCC: { type: 'power_in', supply: '3V3/5V' }, out: { type: 'io' }, GND: { type: 'ground' } }
  const bottom = side('bottom', ['+|VCC', 'out', '-|GND'], types, wu)
  const shapes = [
    r(0, 40, W, H - 40, BLACK_PCB, { radius: 4 }),
    ...dht22Case(10, 4),
    r(W - 16, 102, 8, 8, SMD, { radius: 1, outline: false }),
    r(8, 102, 8, 8, MOUNT_DARK, { radius: 4, outline: false }),
    ...bottomHeader(H, bottom.at),
  ]
  write('dht22-module.json', moduleJson({
    inside: true, id: 'dht22-module', name: 'DHT22 temperature/humidity module (3-pin: + out -)', category: 'Sensors',
    source: 'https://components101.com/sensors/dht22-pinout-specs-datasheet https://components101.com/sites/default/files/components/DHT22-Sensor.jpg https://shillehtek.com/blogs/shillehtek-product-manuals/dht22-digital-temperature-and-humidity-sensor-module-with-cable',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 4. DHT22 / AM2302 bare sensor. Aosong's datasheet: "Pin sequence number: 1 2 3 4 (from left to
//    right direction)", 1 VDD, 2 DATA, 3 NULL, 4 GND, seen from the grille side. The DATA line
//    needs an external pull-up.
{
  const wu = 7, hu = 13, W = wu * 10, H = hu * 10
  const types = { VCC: { type: 'power_in', supply: '3V3/5V' }, DATA: { type: 'io' }, NC: { type: 'nc' }, GND: { type: 'ground' } }
  const bottom = side('bottom', ['VCC', 'DATA', 'NC', 'GND'], types, wu)
  const shapes = [...legs(H, bottom.at, 90), ...dht22Case(5, 2)]
  write('dht22-bare.json', moduleJson({
    inside: true, id: 'dht22-bare', name: 'DHT22 / AM2302 sensor (bare, 4-pin: VCC DATA NC GND)', category: 'Sensors',
    source: 'https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf https://lastminuteengineers.com/dht11-dht22-arduino-tutorial/',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 5. BME280 on the common purple 4-pin board (LDO regulator and I2C level shifter on the back, so
//    3.3 V or 5 V). Seen from the sensor side, header at the bottom: VIN, GND, SCL, SDA left to
//    right, the mounting hole top left and the sensor can top right (Last Minute Engineers'
//    pinout; Makerguides lists the same order).
{
  const wu = 7, hu = 8, W = wu * 10, H = hu * 10
  const types = { VIN: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' }, SCL: { type: 'input' }, SDA: { type: 'io' } }
  const bottom = side('bottom', ['VIN', 'GND', 'SCL', 'SDA'], types, wu)
  const shapes = [
    r(0, 0, W, H, PURPLE, { radius: 4 }),
    r(6, 5, 16, 16, GOLD, { radius: 8 }),
    r(10, 9, 8, 8, MOUNT_DARK, { radius: 4, outline: false }),
    r(44, 7, 16, 16, METAL, { radius: 2 }),
    r(49, 12, 3, 3, HOLE, { radius: 1.5, outline: false }),
    r(30, 12, 8, 5, SMD, { radius: 1, outline: false }),
    ...bottomHeader(H, bottom.at),
  ]
  write('bme280-i2c-module.json', moduleJson({
    inside: true, id: 'bme280-i2c-module', name: 'BME280 sensor module (I2C, 4-pin: VIN GND SCL SDA)', category: 'Sensors',
    source: 'https://lastminuteengineers.com/bme280-arduino-tutorial/ https://www.makerguides.com/how-to-interface-bme280-pressure-sensor-with-arduino/',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 6. GY-BME280, the 6-pin purple board (no regulator: 3.3 V only). The labels are on the back,
//    reading VCC, GND, SCL, SDA, CSB, SDO down the header with the mounting holes on the other
//    edge (ShillehTek's back-side pinout; ProtoSupplies lists the same 1 x 6 order). Seen from the
//    sensor side with the header at the bottom that is VCC ... SDO left to right. CSB is pulled
//    up (I2C); SDO picks the address (0x76 low, 0x77 high).
{
  const wu = 9, hu = 8, W = wu * 10, H = hu * 10
  const types = {
    VCC: { type: 'power_in', supply: '3V3' }, GND: { type: 'ground' }, SCL: { type: 'input' }, SDA: { type: 'io' },
    CSB: { type: 'input' }, SDO: { type: 'io' },
  }
  const bottom = side('bottom', ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], types, wu)
  const shapes = [
    r(0, 0, W, H, PURPLE, { radius: 4 }),
    r(5, 5, 16, 16, GOLD, { radius: 8 }),
    r(9, 9, 8, 8, MOUNT_DARK, { radius: 4, outline: false }),
    r(W - 21, 5, 16, 16, GOLD, { radius: 8 }),
    r(W - 17, 9, 8, 8, MOUNT_DARK, { radius: 4, outline: false }),
    r(38, 8, 14, 14, METAL, { radius: 2 }),
    r(42, 12, 3, 3, HOLE, { radius: 1.5, outline: false }),
    ...[26, 34, 56, 64].map((x) => r(x, 26, 5, 8, SMD, { radius: 1, outline: false })),
    ...bottomHeader(H, bottom.at),
  ]
  write('bme280-module-6pin.json', moduleJson({
    inside: true, id: 'bme280-module-6pin', name: 'GY-BME280 sensor module (6-pin, 3.3 V: VCC GND SCL SDA CSB SDO)', category: 'Sensors',
    source: 'https://shillehtek.com/blogs/shillehtek-product-manuals/bme280-environmental-sensor-raspberry-pi-arduino-esp32-i2c-humidity-pressure-and-temperature-measurement https://protosupplies.com/product/gy-bme280-pressure-humidity-temperature-sensor-module/',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 7. HC-SR501 PIR motion sensor, seen from the dome side with the header at the bottom: GND, OUT,
//    VCC left to right. ProtoSupplies' photo with the dome lifted shows the silkscreen "VCC OUT
//    GND" with the header at the top (so GND OUT VCC once turned header-down); Last Minute
//    Engineers' dome-up pinout, Handsontec's and ProtoSupplies' pot-side photos (VCC OUT GND from
//    that side) agree. The two trimmers (sensitivity, time) and the trigger jumper sit on the back
//    along the edge opposite the header; they are drawn peeking out at the top edge, where they
//    are seen from the dome side (sensitivity left, time right, jumper at the far left).
{
  const wu = 12, hu = 12, W = wu * 10, H = hu * 10
  const types = { GND: { type: 'ground' }, OUT: { type: 'output' }, VCC: { type: 'power_in', supply: '5V/9V/12V' } }
  const bottom = side('bottom', ['GND', 'OUT', 'VCC'], types, wu)
  const shapes = [
    r(0, 8, W, H - 8, GREEN, { radius: 4 }),
    // Trimmers and jumper on the back, peeking out above the top edge.
    r(8, 0, 8, 12, CHIP, { radius: 1 }),
    r(9, 1, 6, 4, '#F4B400', { radius: 1, outline: false }),
    r(34, 1, 16, 10, POT, { radius: 3 }),
    r(70, 1, 16, 10, POT, { radius: 3 }),
    r(6, 52, 8, 8, '#E9EDF0', { radius: 4, outline: false }),
    r(W - 14, 52, 8, 8, '#E9EDF0', { radius: 4, outline: false }),
    // Fresnel lens: square base with the dome on it.
    r(22, 14, 76, 76, LENS_SHADE, { radius: 6 }),
    r(26, 18, 68, 68, LENS, { radius: 34 }),
    r(38, 28, 14, 10, '#FFFFFF', { radius: 5, outline: false }),
    ...bottomHeader(H, bottom.at),
  ]
  write('pir-hc-sr501.json', moduleJson({
    inside: true, id: 'pir-hc-sr501', name: 'PIR motion sensor HC-SR501 (dome side: GND OUT VCC)', category: 'Sensors',
    source: 'https://protosupplies.com/product/hc-sr501-pir-motion-sensing-module/ https://lastminuteengineers.com/pir-sensor-arduino-tutorial/ http://www.handsontec.com/dataspecs/SR501%20Motion%20Sensor.pdf',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 8. HC-SR04 ultrasonic distance sensor, seen from the transducer side with the header at the
//    bottom: VCC, Trig, Echo, GND left to right (ElecFreaks' HC-SR04 datasheet "Vcc Trig Echo
//    GND"; Last Minute Engineers' pinout agrees). 5 V only.
{
  const wu = 19, hu = 9, W = wu * 10, H = hu * 10
  const types = { VCC: { type: 'power_in', supply: '5V' }, Trig: { type: 'input' }, Echo: { type: 'output' }, GND: { type: 'ground' } }
  const bottom = side('bottom', ['VCC', 'Trig', 'Echo', 'GND'], types, wu)
  const can = (x) => [
    r(x, 10, 66, 66, METAL, { radius: 33 }),
    r(x + 8, 18, 50, 50, '#8E96A1', { radius: 25, outline: false }),
    r(x + 14, 24, 38, 38, '#5E656F', { radius: 19, outline: false }),
  ]
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    ...[[4, 4], [W - 10, 4], [4, H - 10], [W - 10, H - 10]].map(([x, y]) => r(x, y, 6, 6, '#123356', { radius: 3, outline: false })),
    ...can(8),
    ...can(W - 74),
    r(78, 6, 34, 12, METAL, { radius: 6, label: '12.000', labelSize: 5 }),
    r(76, 24, 38, 12, BLUE, { outline: false, label: 'HC-SR04', labelColor: '#FFFFFF', labelSize: 7 }),
    ...bottomHeader(H, bottom.at),
  ]
  write('ultrasonic-hc-sr04.json', moduleJson({
    inside: true, id: 'ultrasonic-hc-sr04', name: 'Ultrasonic distance sensor HC-SR04 (VCC Trig Echo GND)', category: 'Sensors',
    source: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf https://lastminuteengineers.com/arduino-sr04-ultrasonic-sensor-tutorial/',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

finish('gen-sensors.mjs')
