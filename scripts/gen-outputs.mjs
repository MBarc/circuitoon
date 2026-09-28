// Generates the built-in output, motor and communication modules: the 1-channel 5 V relay module
// (high/low trigger jumper), the SG90 micro servo, the L298N dual H-bridge module, Adafruit's RFM95W
// LoRa breakout and the 4-channel BSS138 logic level shifter. Pin orders are transcribed from the
// sources cited on each part below (maker pages and datasheets, vendor photos with legible
// silkscreen, cross-checked against a second, independent source).
//
// Run from the repo root: `node scripts/gen-outputs.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites those files in modules/ in place; re-run after changing a part's pins or art,
// then `git diff` the result before committing. src/format/outputs.test.ts pins the order.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { cleared } from './lib/mains.mjs'

// Mains values come only from src/format/mainsEvidence.ts. Both parts are NOT VERIFIED for their
// insulation class alone; Michael's ruling B2 clears them with isolation "unknown" (the Songle and
// Fotek sheets give dielectric test voltages only, never a class).
const relayEv = cleared('relay-module-1ch-5v', 'B2')
const ssrEv = cleared('ssr-fotek-25da', 'B2')
/** The Songle relay's contact ratings and its stated coil-to-contact class; "unknown" when the datasheet states none. */
const SONGLE = { url: relayEv.sources.join(' '), isolation: relayEv.isolation?.value ?? 'unknown', ratings: relayEv.ratings.map((x) => ({ service: x.service, volts: x.volts, amps: x.amps })) }
const FOTEK = {
  url: ssrEv.sources.join(' '), top: ssrEv.pins.value.top, bottom: ssrEv.pins.value.bottom,
  control: ssrEv.extra.control.value, load: ssrEv.extra.load.value, leakage: ssrEv.extra.leakage.value,
  amps: ssrEv.ratings[0].amps, maxVolts: ssrEv.ratings[0].volts, conditions: ssrEv.ratings[0].conditions, isolation: ssrEv.isolation?.value ?? 'unknown',
}

const METAL = '#C9CED6', TIN = '#D5DAE1', HOLE = '#6B727C', CHIP = '#1E2126', GOLD = '#E0B43C', GOLD_HOLE = '#8A6A1E'
const RED_PCB = '#C8322B', BLUE = '#1E4F8A', TERMINAL = '#2F7FD0', RELAY = '#2B5FB8'
const SMD = '#C8A27A', LED_RED = '#E0483E', LED_GREEN = '#3FB56B', BLACK = '#2B2F36', CAP = '#B8BEC7', CAP_TOP = '#8E96A1'
const SERVO = '#3D7BE0', SERVO_DARK = '#2A5FB8', WHITE = '#F4F6F8'
const WIRE_BROWN = '#8B5A2B', WIRE_RED = '#E0483E', WIRE_ORANGE = '#F08A24'
const SSR_BODY = '#23272D', SSR_EAR = '#3A3F48'

/** A screw terminal block of `n` ways along a vertical edge; `x` its left, `ys` the screw centres. */
function terminalV(x, ys, w = 22) {
  const y0 = ys[0] - 9, y1 = ys[ys.length - 1] + 9
  return [
    r(x, y0, w, y1 - y0, TERMINAL, { radius: 2 }),
    ...ys.flatMap((y) => [
      r(x + w / 2 - 6, y - 6, 12, 12, METAL, { radius: 6 }),
      r(x + w / 2 - 4, y - 0.75, 8, 1.5, HOLE, { outline: false }),
    ]),
  ]
}

/** A screw terminal block along a horizontal edge; `y` its top, `xs` the screw centres. */
function terminalH(y, xs, h = 22) {
  const x0 = xs[0] - 9, x1 = xs[xs.length - 1] + 9
  return [
    r(x0, y, x1 - x0, h, TERMINAL, { radius: 2 }),
    ...xs.flatMap((x) => [
      r(x - 6, y + h / 2 - 6, 12, 12, METAL, { radius: 6 }),
      r(x - 0.75, y + h / 2 - 4, 1.5, 8, HOLE, { outline: false }),
    ]),
  ]
}

/** A gold header strip along a horizontal edge at `y` (top of strip), a hole per pin. */
function headerH(y, at) {
  const a0 = at[0] - 5, a1 = at[at.length - 1] + 5
  return [
    r(a0, y, a1 - a0, 8, GOLD, { radius: 2, outline: false }),
    ...at.map((x) => r(x - 1.5, y + 2.5, 3, 3, GOLD_HOLE, { radius: 1.5, outline: false })),
  ]
}

// =============================================================================================
// Motors and actuators

// ---------------------------------------------------------------------------------------------
// 1. 1-channel 5 V relay module with optocoupler and high/low trigger jumper (the red board with a
//    Songle SRD-05VDC-SL-C, HiLetgo and many others). Seen from the component side with the relay
//    text readable and the "1 Relay Module high/low level trigger" edge at the bottom: the output
//    terminal at the left reads NO, COM, NC top to bottom (NC by that edge), the input terminal at
//    the right IN, DC-, DC+ top to bottom (DC+ by that edge). Both are 5 mm screw terminals. The
//    L/H jumper sets the trigger level (low or high). The contacts are the Songle relay's (datasheet
//    SRD series V1 and the older sheet's FORM C figures: 10 A 125 VAC, 7 A 240 VAC, 7 A 28 VDC,
//    resistive); the clone board around them has no rating of its own, so they are `unverified`
//    (spec 1.4). Songle states only a 1500 VAC 1 min coil-to-contact dielectric test, never an
//    insulation class, so the isolation is "unknown" (ruling B2) and IN, DC- and DC+ count as live
//    whenever the contacts carry mains.
{
  const wu = 20, hu = 10, W = wu * 10, H = hu * 10
  const types = {
    NO: { type: 'passive' }, COM: { type: 'passive' }, NC: { type: 'passive' },
    IN: { type: 'input' }, 'DC-': { type: 'ground' }, 'DC+': { type: 'power_in', supply: '5V' },
  }
  const left = side('left', ['NO', null, 'COM', null, 'NC'], types, hu)
  const right = side('right', ['IN', null, 'DC-', null, 'DC+'], types, hu)
  const hole = (x, y) => [r(x, y, 10, 10, '#E9EDF0', { radius: 5, outline: false }), r(x + 2.5, y + 2.5, 5, 5, '#8A2A24', { radius: 2.5, outline: false })]
  const shapes = [
    r(0, 0, W, H, RED_PCB, { radius: 4 }),
    ...hole(4, 4), ...hole(4, H - 14), ...hole(W - 14, 4), ...hole(W - 14, H - 14),
    ...terminalV(2, left.at),
    ...terminalV(W - 24, right.at),
    // The relay cube with its markings.
    r(34, 10, 84, 72, RELAY, { radius: 3 }),
    r(40, 20, 72, 12, RELAY, { outline: false, label: 'SONGLE', labelColor: '#FFFFFF', labelSize: 7 }),
    r(40, 50, 72, 12, RELAY, { outline: false, label: 'SRD-05VDC-SL-C', labelColor: '#FFFFFF', labelSize: 6 }),
    // Trigger jumper (L / H), optocoupler, driver parts and LEDs.
    r(128, 12, 16, 22, BLACK, { radius: 2, label: 'L H', labelColor: '#FFFFFF', labelSize: 4.5 }),
    r(130, 40, 12, 10, WHITE, { radius: 1 }),
    r(150, 20, 8, 5, SMD, { radius: 1, outline: false }),
    r(150, 44, 8, 5, SMD, { radius: 1, outline: false }),
    r(130, 58, 12, 8, CHIP, { radius: 1 }),
    r(150, 70, 6, 5, LED_RED, { radius: 1, outline: false }),
    r(128, 74, 6, 5, LED_GREEN, { radius: 1, outline: false }),
    r(34, 86, 120, 10, RED_PCB, { outline: false, label: 'high/low level trigger', labelColor: '#FFFFFF', labelSize: 5 }),
  ]
  write('relay-module-1ch-5v.json', moduleJson({
    inside: true, id: 'relay-module-1ch-5v', name: 'Relay module 1 channel 5 V (SRD-05VDC, high/low trigger jumper)', category: 'Motors and actuators',
    source: SONGLE.url,
    pins: [...left.pins, ...right.pins], wu, hu,
    electrical: {
      model: 'relay', params: {},
      // The contacts are the Songle relay's; the board around them is a clone with no rating of its own (spec 1.4).
      contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }],
      domains: [{ name: 'contacts', pins: ['NO', 'COM', 'NC'], kind: 'mains' }, { name: 'control', pins: ['IN', 'DC-', 'DC+'], kind: 'selv' }],
      // Ruling B2: the Songle datasheet states no class (1500 VAC coil to contacts is a test voltage), so this is 'unknown'.
      isolation: SONGLE.isolation,
      ratings: SONGLE.ratings.map((x) => ({ pins: ['NO', 'COM', 'NC'], kind: 'switching', service: x.service, volts: x.volts, amps: x.amps, provenance: 'unverified' })),
    },
    shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2. Tower Pro SG90 micro servo, seen from above with its three-wire lead leaving at the left. The
//    JR connector carries, in lead order, brown Ground, red +V (4.8 to 6 V: Tower Pro's product page gives
//    "Operating voltage: 4.8v" and "Voltages from 4.8V - 6V are fine"; the Handsontec sheet gives
//    torque and speed at 4.8 V only), orange PWM signal
//    (Tower Pro / Handsontec datasheet: "PWM=Orange, Vcc=Red, Ground=Brown", connector pinout
//    Ground, +V Power, Signal). The pins are the connector's contacts; the wires are drawn in their
//    colors from the connector to the case.
{
  const wu = 15, hu = 7, W = wu * 10, H = hu * 10
  const types = { GND: { type: 'ground' }, VCC: { type: 'power_in', supply: '4.8V/5V/6V' }, PWM: { type: 'input' } }
  const left = side('left', ['GND', 'VCC', 'PWM'], types, hu)
  const colors = { GND: WIRE_BROWN, VCC: WIRE_RED, PWM: WIRE_ORANGE }
  const shapes = [
    // Wires from the connector into the case, then the connector housing at the edge.
    ...['GND', 'VCC', 'PWM'].map((n) => r(34, left.pos[n] - 2, 36, 4, colors[n], { radius: 1, outline: false })),
    r(0, left.pos.GND - 7, 38, left.pos.PWM - left.pos.GND + 14, BLACK, { radius: 2 }),
    ...['GND', 'VCC', 'PWM'].map((n) => r(31, left.pos[n] - 2.5, 5, 5, colors[n], { radius: 1, outline: false })),
    // Mounting ears, case, gear bump and the white horn on the output shaft.
    r(58, 28, 88, 14, SERVO_DARK, { radius: 3 }),
    r(63, 32, 5, 5, '#123356', { radius: 2.5, outline: false }),
    r(136, 32, 5, 5, '#123356', { radius: 2.5, outline: false }),
    r(68, 8, 68, 54, SERVO, { radius: 3 }),
    r(108, 12, 24, 24, SERVO_DARK, { radius: 12, outline: false }),
    r(100, 16, 44, 16, WHITE, { radius: 8 }),
    r(114, 16, 16, 16, WHITE, { radius: 8 }),
    r(119, 21, 6, 6, CAP_TOP, { radius: 3, outline: false }),
    r(72, 44, 36, 12, SERVO, { outline: false, label: 'SG90', labelColor: '#FFFFFF', labelSize: 8 }),
  ]
  write('servo-sg90.json', moduleJson({
    inside: true, id: 'servo-sg90', name: 'Micro servo SG90', category: 'Motors and actuators',
    source: 'https://handsontec.com/dataspecs/motor_fan/SG90-Servo.pdf https://www.airsupplylab.com/embedded-info/emb_hardware-information/emb-hwinfo_tower-pro-sg90-micro-servo.html https://www.towerpro.com.tw/product/sg90-7/',
    pins: left.pins, wu, hu, electrical: { model: 'servo', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 3. L298N dual H-bridge module (the red 43 x 43 mm board with the black heatsink). Seen from the
//    component side with the heatsink at the top: OUT1 above OUT2 on the left terminal (motor A),
//    OUT4 above OUT3 on the right terminal (motor B); along the bottom edge the power terminal
//    +12V, GND, +5V left to right, then the logic header ENA, IN1, IN2, IN3, IN4, ENB (Last Minute
//    Engineers' pinout; Random Nerd Tutorials' photo shows the same, with "+5V" printed at the
//    right-hand screw and "IN1 IN2 IN3 IN4" on the header). ENA and ENB carry jumpers to the +5V
//    posts behind them (remove them to drive the enables with PWM); those posts sit inside the
//    body and are not pinned. With the 5V-EN jumper fitted the +5V terminal is the on-board
//    regulator's output (motor supply up to 12 V); without it, it is the logic supply input.
//    Modelled as shipped, jumper fitted: +12V takes 7 to 12 V (the 78M05 needs about 2 V of
//    headroom to hold 5 V, and the jumper must come off above 12 V) and +5V is a 5 V output. The
//    name says so; a jumper-off variant (+12V to 35 V, +5V a logic input) would be its own part.
//    Checked again (2026-09-26): the 78M05's own input rating is higher, but the module guide
//    cited in `source` says "If your motor power supply is higher than 12V, you must remove the
//    jumper to prevent damage to the onboard 5V regulator", so with the jumper fitted 12 V stays
//    the top rail.
{
  const wu = 17, hu = 17, W = wu * 10, H = hu * 10
  const types = {
    OUT1: { type: 'output' }, OUT2: { type: 'output' }, OUT3: { type: 'output' }, OUT4: { type: 'output' },
    '+12V': { type: 'power_in', supply: '7V/7.4V/9V/12V' }, GND: { type: 'ground' }, '+5V': { type: 'power_out', supply: '5V' },
    ENA: { type: 'input' }, IN1: { type: 'input' }, IN2: { type: 'input' }, IN3: { type: 'input' }, IN4: { type: 'input' }, ENB: { type: 'input' },
  }
  const left = side('left', [null, null, 'OUT1', null, 'OUT2'], types, hu)
  const right = side('right', [null, null, 'OUT4', null, 'OUT3'], types, hu)
  const bottom = side('bottom', ['+12V', null, 'GND', null, '+5V', null, 'ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'], types, wu)
  const hole = (x, y) => [r(x, y, 12, 12, '#E9EDF0', { radius: 6, outline: false }), r(x + 3, y + 3, 6, 6, '#8A2A24', { radius: 3, outline: false })]
  const diodes = (x) => [0, 1, 2, 3].map((i) => r(x, 22 + i * 13, 16, 9, BLACK, { radius: 1, label: 'M7', labelColor: METAL, labelSize: 4 }))
  const hdr = bottom.at.slice(3)
  const shapes = [
    r(0, 0, W, H, RED_PCB, { radius: 4 }),
    ...hole(4, 4), ...hole(W - 16, 4), ...hole(4, H - 16), ...hole(W - 16, H - 16),
    // Heatsink with its fins over the L298N (Multiwatt15), legs down.
    ...[0, 1, 2, 3, 4].map((i) => r(52 + i * 15, 0, 5, 16, BLACK, { outline: false })),
    r(48, 10, 74, 26, BLACK, { radius: 2 }),
    r(52, 36, 66, 18, '#3A3F47', { radius: 1, label: 'L298N', labelColor: METAL, labelSize: 7 }),
    ...Array.from({ length: 8 }, (_, i) => r(55 + i * 8.5, 54, 2.5, 12, METAL, { outline: false })),
    ...diodes(24), ...diodes(W - 40),
    // Capacitors, 78M05 regulator.
    r(46, 70, 28, 28, CAP, { radius: 14 }), r(52, 76, 16, 16, CAP_TOP, { radius: 8, outline: false }),
    r(98, 80, 28, 28, CAP, { radius: 14 }), r(104, 86, 16, 16, CAP_TOP, { radius: 8, outline: false }),
    r(84, 62, 22, 16, BLACK, { radius: 1, label: '78M05', labelColor: METAL, labelSize: 4.5 }),
    // Motor terminals at the sides, power terminal and logic header at the bottom.
    ...terminalV(2, [left.pos.OUT1, left.pos.OUT2]),
    ...terminalV(W - 24, [right.pos.OUT4, right.pos.OUT3]),
    ...terminalH(H - 24, [bottom.pos['+12V'], bottom.pos.GND, bottom.pos['+5V']]),
    // 5V-EN jumper behind the power terminal.
    r(bottom.pos.GND - 6, H - 44, 14, 10, BLACK, { radius: 1 }),
    ...headerH(H - 10, hdr),
    // Enable jumpers on the posts behind ENA / ENB (drawn above the labels).
    r(bottom.pos.ENA - 4, H - 56, 8, 14, BLACK, { radius: 1 }),
    r(bottom.pos.ENB - 4, H - 56, 8, 14, BLACK, { radius: 1 }),
  ]
  write('l298n-module.json', moduleJson({
    inside: true, id: 'l298n-module', name: 'L298N dual H-bridge motor driver module (5V jumper fitted)', category: 'Motors and actuators',
    source: 'https://lastminuteengineers.com/l298n-dc-stepper-driver-arduino-tutorial/ https://randomnerdtutorials.com/esp32-dc-motor-l298n-motor-driver-control-speed-direction/',
    pins: [...left.pins, ...right.pins, ...bottom.pins], wu, hu, electrical: { model: 'motor_driver', params: {} }, shapes,
  }))
}

// =============================================================================================
// Communication

// ---------------------------------------------------------------------------------------------
// 4. Adafruit RFM95W LoRa radio breakout (product 3072; 3071 is the 433 MHz RFM96W on the same
//    board). Component side, as in Adafruit's photos: the bottom header reads VIN, GND, EN, G0, SCK,
//    MISO, MOSI, CS, RST left to right; the top row G1 ... G5 starts above VIN, and the ANT pad (with
//    the uFL / SMA footprint) sits at the top right. VIN takes 3.3 to 5 V (regulator and level
//    shifter on board); G1 to G5 are 3.3 V logic only ("GPIO: 3V logic" on the back).
{
  const wu = 11, hu = 12, W = wu * 10, H = hu * 10
  const types = {
    VIN: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' }, EN: { type: 'input' }, G0: { type: 'output' },
    SCK: { type: 'input' }, MISO: { type: 'output' }, MOSI: { type: 'input' }, CS: { type: 'input' }, RST: { type: 'input' },
    G1: { type: 'io' }, G2: { type: 'io' }, G3: { type: 'io' }, G4: { type: 'io' }, G5: { type: 'io' }, ANT: { type: 'passive' },
  }
  const top = side('top', ['G1', 'G2', 'G3', 'G4', 'G5', null, null, 'ANT', null], types, wu)
  const bottom = side('bottom', ['VIN', 'GND', 'EN', 'G0', 'SCK', 'MISO', 'MOSI', 'CS', 'RST'], types, wu)
  const ring = (x, y) => [r(x - 4, y - 4, 8, 8, GOLD, { radius: 4, outline: false }), r(x - 1.5, y - 1.5, 3, 3, GOLD_HOLE, { radius: 1.5, outline: false })]
  const castell = (y) => Array.from({ length: 8 }, (_, i) => r(43 + i * 7.5, y, 4, 5, GOLD, { outline: false }))
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 5 }),
    ...top.at.filter((x) => x !== top.pos.ANT).flatMap((x) => ring(x, 7)),
    ...bottom.at.flatMap((x) => ring(x, H - 7)),
    // Antenna pads (ground either side of the ANT hole).
    r(top.pos.ANT - 13, 3, 9, 14, GOLD, { radius: 1, outline: false }),
    r(top.pos.ANT + 4, 3, 9, 14, GOLD, { radius: 1, outline: false }),
    ...ring(top.pos.ANT, 20),
    // RFM95W can with castellated pads, level shifter and regulator at the left.
    ...castell(26), ...castell(H - 34),
    r(40, 30, 64, 56, METAL, { radius: 2, label: 'RFM95W', labelSize: 7 }),
    r(12, 34, 20, 24, CHIP, { radius: 1 }),
    r(12, 66, 14, 10, CHIP, { radius: 1 }),
    r(12, 82, 8, 5, SMD, { radius: 1, outline: false }),
  ]
  write('rfm95-lora-breakout.json', moduleJson({
    inside: true, id: 'rfm95-lora-breakout', name: 'LoRa RFM95W breakout (Adafruit 3072, 868/915 MHz)', category: 'Communication',
    source: 'https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/pinouts https://www.adafruit.com/product/3072 https://cdn-shop.adafruit.com/970x728/3072-14.jpg',
    pins: [...top.pins, ...bottom.pins], wu, hu, electrical: { model: 'radio', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 5. 4-channel BSS138 bi-directional logic level converter (SparkFun BOB-12009 layout, the common
//    red and blue boards). Component side with the high-voltage row at the top: HV1, HV2, HV, GND,
//    HV3, HV4 left to right; the low-voltage row at the bottom: LV1, LV2, LV, GND, LV3, LV4
//    (SparkFun's annotated photo; the blue clone in Fred's Cave's guide has the same silkscreen).
//    Both GND pads are one net. LV takes the low rail (1.8 to 3.3 V), HV the high rail (to 5 V).
//    8 units wide: six pins a row plus a unit of corner margin each side is what the layout gives
//    the body, so the art is drawn at that size and its pads sit exactly on the pins.
{
  const wu = 8, hu = 8, W = wu * 10, H = hu * 10
  const data = Object.fromEntries(['HV1', 'HV2', 'HV3', 'HV4', 'LV1', 'LV2', 'LV3', 'LV4'].map((n) => [n, { type: 'io' }]))
  const types = { ...data, HV: { type: 'power_in', supply: '3V3/5V' }, LV: { type: 'power_in', supply: '1V8/3V3' }, GND: { type: 'ground' } }
  const top = side('top', ['HV1', 'HV2', 'HV', 'GND', 'HV3', 'HV4'], types, wu)
  const bottom = side('bottom', ['LV1', 'LV2', 'LV', 'GND 2|GND', 'LV3', 'LV4'], types, wu)
  const pad = (x, y) => [r(x - 4, y - 4, 8, 8, TIN, { radius: 4, outline: false }), r(x - 1.5, y - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false })]
  // Four BSS138 (SOT-23) FETs across the middle, one per channel, centred on the board.
  const fets = [0, 1, 2, 3].flatMap((i) => {
    const x = W / 2 - 30 + i * 16, y = H / 2 - 5
    return [
      r(x + 1, y - 3, 2.5, 3, METAL, { outline: false }), r(x + 8.5, y - 3, 2.5, 3, METAL, { outline: false }),
      r(x + 4.75, y + 10, 2.5, 3, METAL, { outline: false }),
      r(x, y, 12, 10, CHIP, { radius: 1 }),
    ]
  })
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 3 }),
    ...top.at.flatMap((x) => pad(x, 7)),
    ...bottom.at.flatMap((x) => pad(x, H - 7)),
    ...fets,
  ]
  write('level-shifter-bss138-4ch.json', moduleJson({
    inside: true, id: 'level-shifter-bss138-4ch', name: 'Logic level shifter 4 channel (BSS138, SparkFun layout)', category: 'Communication',
    source: 'https://learn.sparkfun.com/tutorials/bi-directional-logic-level-converter-hookup-guide/all https://cdn.sparkfun.com/assets/f/d/5/8/4/526842ae757b7f5c108b456b.png https://www.fredscave.com/interface/int-04logic-level-shifter.html',
    pins: [...top.pins, ...bottom.pins], internal: [['GND', 'GND 2']], wu, hu, electrical: { model: 'level_shifter', params: {} }, shapes,
  }))
}

// =============================================================================================
// Mains

// ---------------------------------------------------------------------------------------------
// Fotek SSR-25DA solid state relay (Fotek SSR series catalogue, PDF created 2022-06-21, pages 05
// and 28-29; the series page agrees). Seen from the case face in Fotek's product photo: load
// terminals 1 (left) and 2 (right) on top, each marked ~, with "24 - 380VAC" between them; control
// terminals 4 (-, left) and 3 (+, right) below, "4 - 32VDC" between them. Rated 25 A max at 24-380
// VAC for a resistive load, on a heatsink with thermal grease (Fotek's HS-50 heatsink is rated 15 A,
// so 25 A needs a larger one; lamps need a rating over 4 times the lamp current): the `conditions`.
// Off, the output still leaks up to 5 mA (FOTEK.leakage), so its OFF state is a leakage path, never
// an open contact (spec 1.5); the checker adds that edge for an `ssr` pole. The control input takes
// 4-32 VDC (turn-off below 3.5 VDC, 12 mA max) from whatever drives it, so it is a power input with
// those rails and a 3.3 V supply is reported too low (controller ruling). Fotek states "Isolation
// strength 4 KVrms" and "Insulation strength 100 MOhm / 500 VDC", test values, not a class: isolation
// "unknown" (ruling B2). The part is widely counterfeited; these values are the genuine Fotek's.
{
  const wu = 9, hu = 12, W = wu * 10, H = hu * 10
  const [cmin, cmax] = FOTEK.control
  const [lmin, lmax] = FOTEK.load
  const types = { 1: { type: 'passive' }, 2: { type: 'passive' }, 3: { type: 'power_in', supply: `${cmin}V/${cmax}V` }, 4: { type: 'ground' } }
  // The screws sit near the case corners: the two terminals of a row with four empty slots between.
  const row = ([a, b]) => [a, null, null, null, null, b]
  const top = side('top', row(FOTEK.top), types, wu)
  const bottom = side('bottom', row(FOTEK.bottom), types, wu)
  const screw = (x, y) => [
    r(x - 9, y - 9, 18, 18, TIN, { radius: 3 }), r(x - 6, y - 6, 12, 12, METAL, { radius: 6 }),
    r(x - 4, y - 0.75, 8, 1.5, HOLE, { outline: false }), r(x - 0.75, y - 4, 1.5, 8, HOLE, { outline: false }),
  ]
  const mark = (x, y, label) => r(x - 10, y - 5, 20, 10, SSR_BODY, { outline: false, label, labelColor: WHITE, labelSize: 7 })
  write('ssr-fotek-25da.json', moduleJson({
    inside: true, id: 'ssr-fotek-25da', category: 'Mains',
    name: `Fotek SSR-25DA solid state relay (${cmin}-${cmax} VDC in, ${lmin}-${lmax} VAC ${FOTEK.amps} A out)`, source: FOTEK.url,
    pins: [...top.pins, ...bottom.pins], wu, hu,
    electrical: {
      model: 'ssr', contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2' }] }],
      domains: [{ name: 'load', pins: ['1', '2'], kind: 'mains' }, { name: 'control', pins: ['3', '4'], kind: 'selv' }],
      isolation: FOTEK.isolation,
      ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: FOTEK.maxVolts, amps: FOTEK.amps, provenance: 'datasheet', conditions: FOTEK.conditions }],
    },
    shapes: [
      // Black case with its mounting ears, the terminal screws, the white label and the input LED.
      r(0, 0, W, H, SSR_BODY, { radius: 4 }),
      r(W / 2 - 6, 3, 12, 6, SSR_EAR, { radius: 3, outline: false }), r(W / 2 - 6, H - 9, 12, 6, SSR_EAR, { radius: 3, outline: false }),
      ...top.at.flatMap((x) => screw(x, 20)), ...bottom.at.flatMap((x) => screw(x, H - 20)),
      // Between each row, what the case prints: the load's ~ marks and the input's polarity (4 -, 3 +).
      mark(W / 2, 20, '~ ~'), mark(W / 2, H - 20, '- +'),
      r(8, 36, W - 16, 46, WHITE, { radius: 2 }),
      r(10, 38, W - 20, 12, WHITE, { outline: false, label: 'FOTEK', labelColor: SSR_BODY, labelSize: 7 }),
      r(10, 50, W - 20, 12, WHITE, { outline: false, label: 'SSR-25DA', labelColor: SSR_BODY, labelSize: 7 }),
      r(10, 64, W - 20, 10, WHITE, { outline: false, label: `${lmin}-${lmax}VAC`, labelColor: SSR_BODY, labelSize: 5 }),
      r(W / 2 - 3, 86, 6, 5, LED_RED, { radius: 2, outline: false }),
    ],
  }))
}

finish('gen-outputs.mjs')
