// Generates the Arduino board family (the Nano itself stays in gen-boards.mjs, unchanged):
//   shield boards: Uno R3, Uno R4 Minima, Uno R4 WiFi, Leonardo, Zero, Mega 2560 Rev3, Due;
//   small boards:  Micro, Nano Every, Nano 33 IoT, Nano 33 BLE / BLE Sense, Nano ESP32,
//                  Nano RP2040 Connect, Pro Mini 5 V / 16 MHz and 3.3 V / 8 MHz.
// Every board is drawn as Arduino's own "full pinout" sheets draw it: component side up, USB at
// the top. Pin lists are transcribed from the sources cited on each board, in physical header
// order (top to bottom on each side); `row` numbers place each header where it sits on the real
// board (0.1 in per row from the USB edge), so the gaps between headers are real gaps.
//
// Run from the repo root: `node scripts/gen-arduino.mjs` (add `--check` to compare with modules/).
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, slots, write } from './lib/parts.mjs'
import { S3_STRAP, strapCaps } from './lib/pin-caps.mjs'

const TEAL = '#17708A', BLUE = '#1E4F8A', DARK = '#1B1F24', CHIP = '#2B2F36', BTN = '#3A3F47'
const METAL = '#C9CED6', CAN = '#D5DAE1', GOLD = '#E0B43C', HOLE = '#8A6A1E', SILK = '#F4F1EA'

// ---- Shared pin facts --------------------------------------------------------------------------

// ATmega328P (DS40002061, pin descriptions): "ADC7:6 ... serve as analog inputs to the A/D
// converter", with no port, so no output and no pull-up. Same cap as the Nano in gen-boards.mjs.
const AVR_ADC_ONLY = (n) => ({ inputOnly: true, noPullup: true, note: `${n} goes only to the ADC: read it with analogRead.` })
// 3.3 V boards: the Due, Zero, Nano 33 IoT / BLE, ESP32 and RP2040 Connect datasheets each say the
// I/O is 3.3 V and not 5 V tolerant (quoted at each board); the SparkFun Pro Mini 3.3 V guide says
// 5 V parts need level shifting. Every signal pin of those boards carries this note.
const IO33 = { note: 'This board runs its pins at 3.3 V: 5 V on this pin can damage it.' }

/**
 * Pin type rules shared by every board: GNDs are ground, Dn / An pins are general I/O. `own` maps a
 * pin name to its type entry and overrides the rules; `caps` adds pin capabilities; `io33` gives
 * every signal pin without its own caps the 3.3 V note.
 */
const typer = ({ own = {}, caps = {}, io33 = false }) => (name) => {
  const base = own[name] ?? (/^GND( \d+)?$/.test(name) ? { type: 'ground' } : /^[DA]\d+$/.test(name) ? { type: 'io' } : {})
  const signal = base.type === 'io' || base.type === 'input' || base.type === 'output'
  const c = caps[name] ?? (io33 && signal ? IO33 : undefined)
  return c ? { ...base, caps: c } : base
}

/**
 * Pins for one side from [row, spec] pairs: `spec` is 'NAME' or 'NAME|label', `row` the grid row
 * (from the body's top edge) the pin must sit on. Spacers fill the gaps between headers and pad the
 * ends so the layout's centring (computeLayout) puts every pin on its row; it throws if no padding can.
 */
function place(sideName, rows, len, typeOf) {
  const first = rows[0][0], last = rows[rows.length - 1][0]
  const span = last - first + 1
  for (let n = span; n <= len; n++)
    for (let lead = 0; lead <= n - span; lead++) {
      const s0 = Math.ceil((len - (n - 1)) / 2)
      if (s0 < 1 || s0 + n - 1 > len - 1 || s0 + lead !== first) continue
      const list = Array(n).fill(null)
      for (const [row, spec] of rows) list[lead + row - first] = spec
      const at = slots(len, n)
      return list.map((spec, i) => {
        if (spec === null) return { spacer: true, side: sideName }
        const [name, label] = spec.split('|')
        if (at[i] !== rowOf(rows, spec) * 10) throw new Error(`${name} landed off its row`)
        const t = typeOf(name)
        const p = { name, side: sideName }
        if (label) p.label = label
        if (t.type) p.type = t.type
        if (t.supply) p.supply = t.supply
        if (t.caps) p.caps = t.caps
        return p
      })
    }
  throw new Error(`no spacer padding puts ${sideName} rows ${first}-${last} on a ${len}-unit side`)
}
const rowOf = (rows, spec) => rows.find(([, s]) => s === spec)[0]
/** Consecutive rows from `start` for a header's pins. */
const header = (start, specs) => specs.map((s, i) => [start + i, s])

// ---- Shared art ----------------------------------------------------------------------------------

/** A black female header housing along one edge, a hole per pin row (shield boards). */
const housing = (x, rows) => {
  const y0 = rows[0] * 10 - 5, y1 = rows[rows.length - 1] * 10 + 5
  return [
    r(x, y0, 9, y1 - y0, DARK, { radius: 1 }),
    ...rows.map((row) => r(x + 3, row * 10 - 1.5, 3, 3, BTN, { radius: 0.5, outline: false })),
  ]
}
/** Gold castellated pads with holes along both long edges (Nano-size boards), as on the Nano. */
const padStrips = (W, ys) => {
  const y0 = ys[0] - 5, y1 = ys[ys.length - 1] + 5
  return [2, W - 10].flatMap((x) => [
    r(x, y0, 8, y1 - y0, GOLD, { radius: 2, outline: false }),
    ...ys.map((y) => r(x + 2.5, y - 1.5, 3, 3, HOLE, { radius: 1.5, outline: false })),
  ])
}
/** A 2 x 3 ICSP / SPI header, drawn only (a two-row header is not pinned). */
const icsp = (x, y) => [r(x, y, 26, 17, DARK, { radius: 1 }), ...[0, 1, 2].flatMap((i) => [0, 1].map((j) => r(x + 4 + i * 8, y + 4 + j * 7, 3, 3, METAL, { radius: 0.5, outline: false })))]
const usbB = (x) => [r(x, -12, 46, 50, METAL, { radius: 2 }), r(x + 8, -10, 30, 6, '#8A9099', { radius: 1, outline: false })]
const usbC = (x, w = 30) => [r(x, -8, w, 22, METAL, { radius: 5 }), r(x + 5, -4, w - 10, 4, '#8A9099', { radius: 2, outline: false })]
const usbMicro = (x) => [r(x, -7, 24, 18, METAL, { radius: 2 }), r(x + 4, -5, 16, 3, '#8A9099', { radius: 1, outline: false })]
const usbMini = (x) => [r(x, -8, 26, 24, METAL, { radius: 2 }), r(x + 5, -6, 16, 4, '#8A9099', { radius: 1, outline: false })]
const barrelJack = (x) => [r(x, -14, 38, 58, DARK, { radius: 3 }), r(x + 12, -12, 14, 6, BTN, { radius: 2, outline: false })]
const resetButton = (x, y, s = 20) => [r(x, y, s, s, METAL, { radius: 2 }), r(x + s / 2 - 5, y + s / 2 - 5, 10, 10, BTN, { radius: 5, outline: false })]
/** A square QFP chip with its name; `pins` draws metal leads on all four sides. */
const qfp = (x, y, s, label, size = 6) => [
  r(x - 3, y + 3, s + 6, s - 6, METAL, { radius: 1, outline: false }),
  r(x + 3, y - 3, s - 6, s + 6, METAL, { radius: 1, outline: false }),
  r(x, y, s, s, CHIP, { radius: 2, label, labelColor: CAN, labelSize: size }),
]
/** A metal-can radio module (u-blox NINA / NORA, ESP32-S3-MINI) with its antenna end. */
const radioCan = (x, y, w, h, label, size = 5) => [r(x, y, w, h, CAN, { radius: 2, label, labelColor: CHIP, labelSize: size })]
const led = (x, y, fill) => r(x, y, 5, 4, fill, { radius: 1 })
/** Silkscreen text plate (no outline). */
const silk = (x, y, w, h, text, size) => r(x, y, w, h, TEAL, { outline: false, label: text, labelColor: SILK, labelSize: size })

// ---- Shield boards (Uno, Leonardo, Zero, Mega, Due) ------------------------------------------------
//
// Rows, read off Arduino's full-pinout sheets and KiCad's Module:Arduino_UNO_R3 footprint (pads 1-8
// power, 9-14 analog on one line; 15-22 D0-D7, a 0.16 in gap, 23-32 D8-SCL on the other):
// left (power, analog): power header rows 11-18, analog 20-25 (Mega and Due: A0-A7 20-27, A8-A15
// 29-36); right (digital): SCL ... D8 rows 7-16 (really 7.4-16.4: the 0.16 in step between D8 and
// D7 does not fit the grid, so the upper header is drawn 0.04 in high), D7 ... D0 rows 18-25 (Mega
// and Due: D14-D21 rows 27-34).
const R3_POWER = (first) => header(11, [first, 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND 2|GND', 'VIN'])
const R3_DIGITAL_HI = (scl, sda) => header(7, [scl, sda, 'AREF', 'GND 3|GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'])
const R3_DIGITAL_LO = header(18, ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1|D1/TX', 'D0|D0/RX'])

/** Shield-board art: PCB, header housings, the parts every one has, then the board's own. */
function shieldArt(W, H, left, right, extra) {
  const lr = left.map(([row]) => row), rr = right.map(([row]) => row)
  // One housing per header: split the rows where they jump.
  const runs = (rows) => rows.reduce((acc, row) => (acc.length && row === acc[acc.length - 1].at(-1) + 1 ? acc[acc.length - 1].push(row) : acc.push([row]), acc), [])
  return [
    r(0, 0, W, H, TEAL, { radius: 5 }),
    ...runs(lr).flatMap((rows) => housing(2, rows)),
    ...runs(rr).flatMap((rows) => housing(W - 11, rows)),
    ...extra,
  ]
}

function shield({ file, id, name, source, W = 210, H = 270, left, right, own, caps, io33, internal, external, holes, art }) {
  const typeOf = typer({ own, caps, io33 })
  const pins = [...place('left', left, H / 10, typeOf), ...place('right', right, H / 10, typeOf)]
  const electrical = { model: 'mcu', params: {} }
  if (external) electrical.external = [external]
  const m = moduleJson({ id, name, category: 'Microcontrollers', source, pins, internal, wu: W / 10, hu: H / 10, electrical, inside: true, holes, shapes: shieldArt(W, H, left, right, [...art, ...(holes ? holeLabels(holes) : [])]) })
  write(file, m)
}

// Supplies shared by the shield boards.
const VIN_7_12 = { type: 'power_in', supply: '7V/7.4V/9V/12V' }
const P5 = { type: 'power_in', supply: '5V' }
const P33 = { type: 'power_out', supply: '3V3' }
const P5_OUT = { type: 'power_out', supply: '5V' }
const IN = { type: 'input' }

// 1. Arduino Uno R3 (A000066). Datasheet sec. 5 JANALOG: 1 NC, 2 IOREF ("connected to 5V"), 3 Reset,
//    4 +3V3, 5 +5V, 6-7 GND, 8 VIN, 9-14 A0-A5 (A4/SDA, A5/SCL); JDIGITAL lists AREF, GND and the
//    SDA/SCL pair as "(duplicated)" A4/A5. Order and rows from the full pinout (top view, USB at the
//    top) and KiCad's MCU_Module:Arduino_UNO_R3 symbol (1 NC ... 14 A5, 15 D0 ... 28 D13, 29 GND,
//    30 AREF, 31 SDA, 32 SCL). Schematic: USBVCC reaches +5V through T1 (FDN340P), a P-FET switched
//    off by the LMV358 comparator when VIN is present: a switch, not a diode. VIN: the pinout says
//    "6-20V input"; Arduino recommends 7-12 V, the Nano's range here.
shield({
  file: 'arduino-uno-r3.json', id: 'arduino-uno-r3', name: 'Arduino Uno R3',
  source: 'https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf https://docs.arduino.cc/resources/pinouts/A000066-full-pinout.pdf https://docs.arduino.cc/resources/schematics/A000066-schematics.pdf https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/MCU_Module.kicad_symdir/Arduino_UNO_R3.kicad_sym https://gitlab.com/kicad/libraries/kicad-footprints/-/blob/master/Module.pretty/Arduino_UNO_R3.kicad_mod',
  left: [...R3_POWER('NC'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])],
  right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO],
  own: { NC: { type: 'nc' }, IOREF: P5_OUT, RESET: IN, '3V3': P33, '5V': P5, VIN: VIN_7_12, SCL: { type: 'io' }, SDA: { type: 'io' }, AREF: IN },
  internal: [['GND', 'GND 2', 'GND 3'], ['5V', 'IOREF'], ['SDA', 'A4'], ['SCL', 'A5']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  art: [
    ...barrelJack(14), ...usbB(124), ...resetButton(178, 6),
    r(100, 62, 20, 20, CHIP, { radius: 2 }), r(84, 92, 22, 9, METAL, { radius: 4.5 }),
    // ATmega328P DIP-28, lying along the analog header, legs on both sides.
    ...Array.from({ length: 14 }, (_, i) => [r(50, 116 + i * 9.5, 4, 3, METAL, { outline: false }), r(80, 116 + i * 9.5, 4, 3, METAL, { outline: false })]).flat(),
    r(53, 112, 28, 138, CHIP, { radius: 2 }),
    silk(50, 252, 34, 9, 'ATMEGA328P', 4),
    led(124, 112, '#F4B400'), led(124, 120, '#F4B400'), led(124, 128, '#F4B400'), led(150, 238, '#3FB56B'),
    silk(100, 150, 70, 16, 'UNO', 13), silk(100, 168, 70, 10, 'R3', 8),
    ...icsp(128, 248),
  ],
})

// 2/3. Uno R4 Minima (ABX00080) and Uno R4 WiFi (ABX00087). Datasheet tables (Minima sec. 10.1,
//    WiFi sec. 12.1): pin 1 is BOOT ("Mode selection") where the R3 has NC; IOREF is "connected to
//    5 V"; "The UNO R4 Minima operates on 5 V, as does all pins on this board except for the 3.3V pin";
//    "Recommended input voltage (VIN) is 6-24 V"; "Power via USB supplies about ~4.7 V (due to
//    Schottky drop)", so USB reaches +5V through a diode. The full pinout notes "A4 and A5 are the
//    same pins of D18/SDA and D19/SCL". BOOT is the RA4M1's MD pin (schematic: BOOT to MD/P201):
//    the RA4M1 datasheet (Arduino's copy) calls MD "Pins for setting the operating mode", single-chip
//    mode or SCI/USB boot mode; Renesas' forum and the RA boot mode guide give the levels (MD high at
//    reset: single-chip mode, your program; low: boot mode), and Arduino's R4 Minima cheat sheet
//    flashes the bootloader by shorting BOOT to GND.
const R4_SOURCE = 'https://docs.arduino.cc/resources/datasheets/ra4m1-datasheet.pdf https://community.renesas.com/mcu/ra/f/forum/52046/how-to-bootload-the-ra4m1 https://www.hackster.io/IKTech95/introduction-to-ra-mcus-boot-modes-cf488d https://github.com/arduino/docs-content/blob/main/content/hardware/uno/boards/uno-r4-minima/tutorials/cheat-sheet/cheat-sheet.md'
const R4_BOOT = { strapping: 'high', note: 'BOOT is the RA4M1\'s MD pin: low at reset starts the chip\'s own boot mode instead of your sketch.' }
const R4_OWN = { BOOT: IN, IOREF: P5_OUT, RESET: IN, '3V3': P33, '5V': P5, VIN: { type: 'power_in', supply: '7V/7.4V/9V/12V/24V' }, SCL: { type: 'io' }, SDA: { type: 'io' }, AREF: IN }
const R4_LEFT = [...R3_POWER('BOOT'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])]
const R4_INTERNAL = [['GND', 'GND 2', 'GND 3'], ['5V', 'IOREF'], ['SDA', 'A4'], ['SCL', 'A5']]
const R4_USB = { pin: '5V', volts: 5, via: 'USB', diode: true }
const r4Art = (extra) => [
  ...barrelJack(14), ...usbC(130), ...resetButton(178, 6),
  ...qfp(96, 148, 40, 'RA4M1', 6),
  ...icsp(92, 246),
  ...extra,
]
shield({
  file: 'arduino-uno-r4-minima.json', id: 'arduino-uno-r4-minima', name: 'Arduino Uno R4 Minima',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00080-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00080-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00080-schematics.pdf ${R4_SOURCE}`,
  left: R4_LEFT, right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO],
  own: R4_OWN, caps: { BOOT: R4_BOOT }, internal: R4_INTERNAL, external: R4_USB,
  art: r4Art([
    r(60, 40, 20, 26, CHIP, { radius: 2 }), r(96, 46, 16, 16, CHIP, { radius: 2 }),
    led(150, 74, '#F4B400'), led(150, 82, '#F4B400'), led(150, 90, '#F4B400'), led(110, 216, '#3FB56B'),
    silk(60, 110, 76, 14, 'UNO R4', 10), silk(60, 126, 76, 10, 'MINIMA', 7),
  ]),
})
// R4 WiFi only: the OFF / GND / VRTC header above BOOT on the same edge (datasheet 12.3: 1 OFF "For
// controlling power supply", 2 GND, VRTC "Battery connection to power RTC only"; the full pinout
// draws them in line with the power header, four rows above BOOT). Arduino's "VRTC & OFF Pins"
// guide: VRTC takes "a voltage within the range of 1.6 - 3.3 V"; shorting OFF to GND turns off the
// 5 V step-down converter, which only turns the board off when it runs from VIN or the barrel jack.
// The 2 x 3 ESP32-S3 header, the Qwiic connector and the ICSP header are drawn, not pinned.
shield({
  file: 'arduino-uno-r4-wifi.json', id: 'arduino-uno-r4-wifi', name: 'Arduino Uno R4 WiFi',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00087-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00087-schematics.pdf https://docs.arduino.cc/tutorials/uno-r4-wifi/vrtc-off ${R4_SOURCE}`,
  left: [...header(7, ['OFF', 'GND 4|GND', 'VRTC']), ...R4_LEFT], right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO],
  own: { ...R4_OWN, OFF: IN, VRTC: { type: 'power_in', supply: '3V/3V3' } },
  caps: { BOOT: R4_BOOT, OFF: { note: 'OFF tied to GND switches off the 5 V converter, so the board turns off when it runs from VIN or the barrel jack.' } },
  internal: [['GND', 'GND 2', 'GND 3', 'GND 4'], ['5V', 'IOREF'], ['SDA', 'A4'], ['SCL', 'A5']], external: R4_USB,
  art: r4Art([
    // ESP32-S3-MINI-1 module, the 12 x 8 LED matrix, the ESP header and the Qwiic connector.
    ...radioCan(56, 14, 60, 40, 'ESP32-S3', 6),
    r(50, 120, 40, 120, '#2A1F1F', { radius: 2 }),
    ...Array.from({ length: 12 }, (_, i) => Array.from({ length: 8 }, (_, j) => r(53 + j * 4.6, 123 + i * 9.6, 2.5, 4, '#E5484D', { radius: 1, outline: false }))).flat(),
    ...icsp(140, 66), r(146, 224, 22, 12, '#F4F1EA', { radius: 1 }),
    silk(96, 96, 72, 14, 'UNO R4', 10), silk(96, 112, 72, 10, 'WiFi', 7),
  ]),
})

// 4. Leonardo (A000057). Full pinout: the R3 layout, top header ~D3/SCL, D2/SDA, AREF, GND, D13 ...
//    D8; power header NC, IOREF, RESET, +3V3, +5V, GND, GND, VIN; A0-A5. KiCad's
//    MCU_Module:Arduino_Leonardo symbol (on the Arduino_UNO_R3 footprint) agrees pin for pin and
//    names the top pair SDA/D2 (31) and SCL/D3 (32): the same nets as D2 and D3. Schematic: the "+5V
//    AUTO SELECTOR" switches VUSB to +5V through T1 (FDN340P), as on the Uno. VIN 7-12 V nominal
//    (tech specs; the pinout says 6-20 V input).
shield({
  file: 'arduino-leonardo.json', id: 'arduino-leonardo', name: 'Arduino Leonardo',
  source: 'https://docs.arduino.cc/resources/pinouts/A000057-full-pinout.pdf https://docs.arduino.cc/resources/schematics/A000057-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/hero/boards/leonardo/tech-specs.yml https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/MCU_Module.kicad_symdir/Arduino_Leonardo.kicad_sym',
  left: [...R3_POWER('NC'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])],
  right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO],
  own: { NC: { type: 'nc' }, IOREF: P5_OUT, RESET: IN, '3V3': P33, '5V': P5, VIN: VIN_7_12, SCL: { type: 'io' }, SDA: { type: 'io' }, AREF: IN },
  internal: [['GND', 'GND 2', 'GND 3'], ['5V', 'IOREF'], ['SDA', 'D2'], ['SCL', 'D3']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  art: [
    ...barrelJack(14), ...usbMicro(136), ...resetButton(178, 6),
    ...qfp(96, 140, 40, '32U4', 7),
    led(110, 40, '#F4B400'), led(120, 40, '#F4B400'), led(130, 40, '#F4B400'), led(140, 40, '#3FB56B'),
    silk(60, 90, 100, 16, 'LEONARDO', 10),
    ...icsp(92, 248),
  ],
})

// 5. Zero (ABX00003). Full pinout: the R3 layout, power header ATN, IOREF, RESET, +3V3, +5V, GND,
//    GND, VIN; top header SCL (PA23), SDA (PA22), AREF, GND, D13 ... D8. SDA/SCL are their own pins
//    (ArduinoCore-samd variant: 20 SDA PA22, 21 SCL PA23; A4 PA05, A5 PB02), not A4/A5. Schematic
//    (v4.0, J2): pin 2 (IOREF) joins +3V3, pin 1 (ATN) is drawn with no connection, and the pinout
//    gives ATN no port, so ATN is a no-connect here. Native USB: XUSB, fuse, USBVCC, then TR1
//    (PMV48XP) to +5V, a switch. Tech specs: "I/O Voltage: 3.3V", "Input voltage (nominal): 5-18V".
shield({
  file: 'arduino-zero.json', id: 'arduino-zero', name: 'Arduino Zero',
  source: 'https://docs.arduino.cc/resources/pinouts/ABX00003-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00003-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/hero/boards/zero/tech-specs.yml https://github.com/arduino/ArduinoCore-samd/blob/master/variants/arduino_zero/variant.cpp',
  left: [...R3_POWER('ATN'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'])],
  right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO],
  own: { ATN: { type: 'nc' }, IOREF: P33, RESET: IN, '3V3': P33, '5V': P5, VIN: { type: 'power_in', supply: '5V/7V/7.4V/9V/12V' }, SCL: { type: 'io' }, SDA: { type: 'io' }, AREF: IN },
  io33: true,
  caps: { ATN: { note: 'ATN has no connection on the Zero v4.0 schematic.' } },
  internal: [['GND', 'GND 2', 'GND 3'], ['3V3', 'IOREF']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  art: [
    ...barrelJack(14), ...usbMicro(78), ...usbMicro(140), ...resetButton(180, 26),
    ...qfp(110, 186, 34, 'SAMD21', 6), r(116, 104, 26, 26, CHIP, { radius: 2, label: 'EDBG', labelColor: CAN, labelSize: 5 }),
    silk(60, 150, 100, 16, 'ZERO', 12),
    ...icsp(100, 248), r(66, 256, 26, 9, DARK, { radius: 1 }),
  ],
})

// 6/7. Mega 2560 Rev3 (A000067) and Due (A000062). The R3 headers plus A6-A15 (Due: A6-A11, DAC0,
//    DAC1, CANRX, CANTX), the communication header D14-D21 and a 2 x 18 header at the far end. The
//    2 x 18 is a two-row header inside the body: pads in their true position. Datasheet tables
//    ("Digital Pins D22 - D53 LHS / RHS"): one row is +5V, D22, D24 ... D52, GND, the other +5V, D23
//    ... D53, GND; the D22-D53 pinout page (top view, USB at the left) puts +5V at the digital-header
//    end and the even row on the inner side. Drawn with USB at the top, that end is on the right
//    and the even row is the upper one (row 38, odd row 39; really rows 37-38, moved down one so the
//    pin numbers fit between them and the analog header).
const MEGA_W = 210, MEGA_H = 420
const DOUBLE = (supply5) => {
  const col = (i) => MEGA_W - 10 - i * 10
  const row = (y, nums, n5, ng) => [
    { name: n5, label: '5V', at: [[col(0), y]], holeStyle: 'pad', ...supply5 },
    ...nums.map((d, i) => ({ name: `D${d}`, at: [[col(i + 1), y]], holeStyle: 'pad', type: 'io' })),
    { name: ng, label: 'GND', at: [[col(17), y]], holeStyle: 'pad', type: 'ground' },
  ]
  const evens = Array.from({ length: 16 }, (_, i) => 22 + 2 * i)
  return [...row(380, evens, '5V 2', 'GND 4'), ...row(390, evens.map((d) => d + 1), '5V 3', 'GND 5')]
}
/** Silkscreen numbers for the 2 x 18 pads: the inner row's above it, the outer row's below. */
function holeLabels(holes) {
  return holes.map((g) => {
    const [x, y] = g.at[0]
    const text = (g.label ?? g.name).replace(/^D/, '')
    const w = Math.max(9, text.length * 3.6)
    return r(x - w / 2, y === 380 ? y - 13 : y + 5, w, 7, TEAL, { outline: false, label: text, labelColor: SILK, labelSize: 4.2 })
  })
}
const doubleHousing = r(24, 374, 182, 22, DARK, { radius: 1 })
const MEGA_COMM = header(27, ['D14|TX3', 'D15|RX3', 'D16|TX2', 'D17|RX2', 'D18|TX1', 'D19|RX1', 'D20|SDA', 'D21|SCL'])

// Mega: datasheet sec. 5.1 / 5.2 and the full pinout (D21/SCL and D20/SDA at the top of the digital
// header are PD0/PD1, the same port pins as D21/D20 on the communication header). Schematic: USBVCC
// to +5V through T1 (PMV48XP), switched by the LMV358, as on the Uno. VIN: "6-20 V input" (pinout),
// 7-12 V recommended.
shield({
  file: 'arduino-mega-2560.json', id: 'arduino-mega-2560', name: 'Arduino Mega 2560 Rev3', W: MEGA_W, H: MEGA_H,
  source: 'https://docs.arduino.cc/resources/datasheets/A000067-datasheet.pdf https://docs.arduino.cc/resources/pinouts/A000067-full-pinout.pdf https://docs.arduino.cc/resources/schematics/A000067-schematics.pdf',
  left: [...R3_POWER('NC'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']), ...header(29, ['A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'])],
  right: [...R3_DIGITAL_HI('SCL', 'SDA'), ...R3_DIGITAL_LO, ...MEGA_COMM],
  own: { NC: { type: 'nc' }, IOREF: P5_OUT, RESET: IN, '3V3': P33, '5V': P5, VIN: VIN_7_12, SCL: { type: 'io' }, SDA: { type: 'io' }, AREF: IN },
  internal: [['GND', 'GND 2', 'GND 3', 'GND 4', 'GND 5'], ['5V', 'IOREF', '5V 2', '5V 3'], ['SDA', 'D20'], ['SCL', 'D21']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  holes: DOUBLE(P5),
  art: [
    ...barrelJack(14), ...usbB(124), ...resetButton(178, 6),
    r(100, 62, 20, 20, CHIP, { radius: 2 }), r(84, 92, 22, 9, METAL, { radius: 4.5 }),
    ...qfp(84, 176, 50, 'ATMEGA2560', 5.5),
    led(124, 112, '#F4B400'), led(124, 120, '#F4B400'), led(124, 128, '#F4B400'), led(150, 300, '#3FB56B'),
    silk(66, 252, 90, 16, 'MEGA', 13), silk(66, 270, 90, 10, '2560 Rev3', 7),
    ...icsp(96, 318), doubleHousing,
  ],
})

// Due: datasheet sec. 6.2 tables and the full pinout (A000056 sheet). The top pair is SCL1/SDA1
// (PA18/PA17, TWI0), not D21/D20 (PB13/PB12): the datasheet table labels them "D21/SCL1, D20/SDA1",
// but the pinout gives their own ports, so they are separate pins here. IOREF is "connected to
// 3.3 V"; "Unlike most traditional Arduino boards, the Arduino Due board runs at 3.3 V ... the
// maximum voltage that the I/O pins can tolerate is 3.3 V"; VIN 7-12 V (6-16 V permissible).
// Schematic: USBVCC (programming port) to +5V through T1 (PMV48XP), the native port's USBVCCU2
// through T2. The SPI and JTAG headers are drawn, not pinned (SPI on the Due is only on its 2 x 3
// header, not on D11-D13).
shield({
  file: 'arduino-due.json', id: 'arduino-due', name: 'Arduino Due', W: MEGA_W, H: MEGA_H,
  source: 'https://docs.arduino.cc/resources/datasheets/A000062-datasheet.pdf https://docs.arduino.cc/resources/pinouts/A000056-full-pinout.pdf https://docs.arduino.cc/resources/schematics/A000056-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/mega/boards/due/tech-specs.yml',
  left: [...R3_POWER('NC'), ...header(20, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']), ...header(29, ['A8', 'A9', 'A10', 'A11', 'DAC0', 'DAC1', 'CANRX', 'CANTX'])],
  right: [...R3_DIGITAL_HI('SCL1', 'SDA1'), ...R3_DIGITAL_LO, ...MEGA_COMM],
  own: { NC: { type: 'nc' }, IOREF: P33, RESET: IN, '3V3': P33, '5V': P5, VIN: VIN_7_12, SCL1: { type: 'io' }, SDA1: { type: 'io' }, AREF: IN,
    DAC0: { type: 'io' }, DAC1: { type: 'io' }, CANRX: { type: 'io' }, CANTX: { type: 'io' } },
  io33: true,
  internal: [['GND', 'GND 2', 'GND 3', 'GND 4', 'GND 5'], ['5V', '5V 2', '5V 3'], ['3V3', 'IOREF']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  holes: DOUBLE(P5).map((g) => (g.type === 'io' ? { ...g, caps: IO33 } : g)),
  art: [
    ...barrelJack(14), ...usbMicro(70), ...usbMicro(132), ...resetButton(178, 22),
    r(100, 60, 20, 20, CHIP, { radius: 2 }),
    ...qfp(80, 170, 58, 'SAM3X8E', 6),
    led(110, 108, '#F4B400'), led(120, 108, '#F4B400'), led(130, 108, '#3FB56B'),
    silk(66, 256, 90, 18, 'DUE', 14),
    ...icsp(96, 300), r(130, 330, 40, 12, DARK, { radius: 1 }), doubleHousing,
  ],
})

// ---- Small boards (Micro, the Nano family, Pro Mini) -------------------------------------------------
//
// Two 0.6 in rows like the Nano in gen-boards.mjs (same body, pad strips and inside labels), USB at
// the top with one empty row above the headers for it.
function small({ file, id, name, source, left, right, top = 1, wu = 8, own, caps, io33, internal, external, pcb = TEAL, art, topPins, holes }) {
  const n = Math.max(left.length, right.length)
  const hu = n + top + 2
  const W = wu * 10, H = hu * 10
  const first = Math.ceil((hu - (n + top - 1)) / 2) + top
  const typeOf = typer({ own, caps, io33 })
  const rows = (list) => list.map((s, i) => [first + i, s])
  const pins = [
    ...(topPins ? place('top', topPins.map((s, i) => [Math.ceil((wu - topPins.length + 1) / 2) + i, s]), wu, typeOf) : []),
    ...place('left', rows(left), hu, typeOf), ...place('right', rows(right), hu, typeOf),
  ]
  const ys = left.map((_, i) => (first + i) * 10)
  const electrical = { model: 'mcu', params: {} }
  if (external) electrical.external = [external]
  const m = moduleJson({ id, name, category: 'Microcontrollers', source, pins, internal, wu, hu, electrical, inside: true, holes, shapes: [r(0, 0, W, H, pcb, { radius: 5 }), ...padStrips(W, ys), ...art(W, H)] })
  write(file, m)
}

// Shared Nano-form names. Left: D13, 3V3, AREF, A0-A7, 5V, RST, GND, VIN; right: D12 ... D2, GND,
// RST, RX, TX (each datasheet's "Headers" table numbers them 1-15 down the left and 16-30 up the
// right, 16 TX at the bottom, 30 D12 at the top; the full pinouts draw the same rows).
const NANO_LEFT = (aref, fiveV, rst2) => ['D13', '3V3', aref, 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', fiveV, rst2, 'GND', 'VIN']
const NANO_RIGHT = (rst, rx, tx) => ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND 2|GND', rst, rx, tx]
const nanoArt = (usb, body) => (W, H) => [...usb(W), ...body(W, H)]

// 8. Micro (A000053). Full pinout, top view, USB at the top: left D13, +3V3, AREF, A0-A5, NC, NC,
//    +5V, RESET, GND, VIN, CIPO/D14, SCK/D15; right D12 ... D4, D3/SCL, D2/SDA, GND, RESET, D0/RX,
//    D1/TX, D17/SS, D16/COPI. Schematic: "+5V SELECTOR (USB)" switches VUSB to +5V through T1
//    (FDN340P/PMV48XP), no diode. VIN: the pinout says "6-9 V input"; the tech specs say 7-12 V
//    nominal; only the rails both cover are listed.
small({
  file: 'arduino-micro.json', id: 'arduino-micro', name: 'Arduino Micro',
  source: 'https://docs.arduino.cc/resources/pinouts/A000053-full-pinout.pdf https://docs.arduino.cc/resources/schematics/A000053-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/hero/boards/micro/tech-specs.yml',
  left: ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'NC', 'NC 2|NC', '5V', 'RESET', 'GND', 'VIN', 'D14|CIPO', 'D15|SCK'],
  right: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3|D3/SCL', 'D2|D2/SDA', 'GND 2|GND', 'RESET 2|RESET', 'D0|D0/RX', 'D1|D1/TX', 'D17|SS', 'D16|COPI'],
  own: { '3V3': P33, AREF: IN, NC: { type: 'nc' }, 'NC 2': { type: 'nc' }, '5V': P5, RESET: IN, 'RESET 2': IN, VIN: { type: 'power_in', supply: '7V/7.4V/9V' } },
  internal: [['GND', 'GND 2'], ['RESET', 'RESET 2']],
  external: { pin: '5V', volts: 5, via: 'USB' },
  art: nanoArt((W) => usbMicro(W / 2 - 12), (W, H) => [
    r(W / 2 - 14, 70, 28, 28, CHIP, { radius: 2, label: '32U4', labelColor: CAN, labelSize: 6 }),
    ...resetButton(W / 2 - 8, 132, 16),
    led(W / 2 - 12, 120, '#F4B400'), led(W / 2 + 7, 120, '#3FB56B'),
    r(W / 2 - 10, H - 30, 20, 14, DARK, { radius: 1 }),
  ]),
})

// 9. Nano Every (ABX00028). Datasheet sec. 6.2: AREF "Analog Reference; can be used as GPIO", A6/A7
//    "ADC in; can be used as GPIO" (the ATmega4809 gives them a port, unlike the 328P), "+5V Power
//    Out", RST on both sides. Schematic: VUSB to +5V through D2 (PMEG6020), a Schottky diode. VIN:
//    "7-21 V input" (full pinout).
const NANO_SOURCE_KICAD = 'https://gitlab.com/kicad/libraries/kicad-footprints/-/blob/master/Module.pretty/Arduino_Nano.kicad_mod'
small({
  file: 'arduino-nano-every.json', id: 'arduino-nano-every', name: 'Arduino Nano Every',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00028-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00028-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00028-schematics.pdf https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/MCU_Module.kicad_symdir/Arduino_Nano_Every.kicad_sym ${NANO_SOURCE_KICAD}`,
  left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RST 2|RST', 'RX', 'TX'),
  own: { '3V3': P33, AREF: { type: 'io' }, '5V': P5, RST: IN, 'RST 2': IN, VIN: VIN_7_12, RX: { type: 'io' }, TX: { type: 'io' } },
  internal: [['GND', 'GND 2'], ['RST', 'RST 2']],
  external: { pin: '5V', volts: 5, via: 'USB', diode: true },
  art: nanoArt((W) => usbMicro(W / 2 - 12), (W, H) => [
    ...resetButton(W / 2 - 8, 24, 16),
    r(W / 2 - 13, 60, 26, 26, CHIP, { radius: 2, label: '4809', labelColor: CAN, labelSize: 6 }),
    r(W / 2 - 9, 100, 18, 18, CHIP, { radius: 2 }),
    led(W / 2 - 12, 132, '#F4B400'), led(W / 2 + 7, 132, '#3FB56B'),
  ]),
})

// 10/11. Nano 33 IoT (ABX00027) and Nano 33 BLE / BLE Sense (ABX00030, ABX00031). Datasheet
//    "Headers" tables: AREF "can be used as GPIO"; pin 12 VUSB "Normally NC; can be connected to VUSB
//    pin of the USB connector by shorting a jumper" (the pinouts print it +5V); "only supports 3.3V
//    I/Os and is NOT 5V tolerant"; "the 5V pin does NOT supply voltage". VIN "5-21 V input" (full
//    pinouts). No header pin carries USB power as shipped, so no `external`.
const NANO33_OWN = { '3V3': P33, AREF: { type: 'io' }, '5V': { type: 'nc' }, RST: IN, 'RST 2': IN, VIN: { type: 'power_in', supply: '5V/7V/7.4V/9V/12V' }, RX: { type: 'io' }, TX: { type: 'io' } }
const VUSB_NC = { note: 'This pin is not connected as shipped; shorting the VUSB jumper on the board puts USB 5 V on it.' }
small({
  file: 'arduino-nano-33-iot.json', id: 'arduino-nano-33-iot', name: 'Arduino Nano 33 IoT',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00027-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00027-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00027-schematics.pdf ${NANO_SOURCE_KICAD}`,
  left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RST 2|RST', 'RX', 'TX'),
  own: NANO33_OWN, io33: true, caps: { '5V': VUSB_NC },
  internal: [['GND', 'GND 2'], ['RST', 'RST 2']],
  art: nanoArt((W) => usbMicro(W / 2 - 12), (W, H) => [
    ...resetButton(W / 2 - 8, 24, 16),
    r(W / 2 - 12, 58, 24, 24, CHIP, { radius: 2, label: 'SAMD21', labelColor: CAN, labelSize: 4.5 }),
    ...radioCan(W / 2 - 16, H - 66, 32, 54, 'NINA', 6),
  ]),
})
// BLE and BLE Sense: the two full pinouts are identical row for row; the Sense adds its sensors on
// an internal I2C bus, not on the headers (datasheet sec. 1).
small({
  file: 'arduino-nano-33-ble.json', id: 'arduino-nano-33-ble', name: 'Arduino Nano 33 BLE / BLE Sense',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00030-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00030-full-pinout.pdf https://docs.arduino.cc/resources/datasheets/ABX00031-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00031-full-pinout.pdf ${NANO_SOURCE_KICAD}`,
  left: NANO_LEFT('AREF', '5V', 'RST'), right: NANO_RIGHT('RST 2|RST', 'RX', 'TX'),
  own: NANO33_OWN, io33: true, caps: { '5V': VUSB_NC },
  internal: [['GND', 'GND 2'], ['RST', 'RST 2']],
  art: nanoArt((W) => usbMicro(W / 2 - 12), (W, H) => [
    ...resetButton(W / 2 - 8, 24, 16),
    r(W / 2 - 10, 60, 20, 20, CHIP, { radius: 2 }),
    ...radioCan(W / 2 - 16, H - 70, 32, 46, 'NINA', 6), r(W / 2 - 16, H - 24, 32, 12, '#6E9C3A', { radius: 1 }),
  ]),
})

// 12. Nano ESP32 (ABX00083). Datasheet sec. 12.1/12.2: D13, +3V3, BOOT0, A0-A7, VBUS ("USB power
//    (5V)"), BOOT1, GND, VIN; D12 ... D2, GND, RESET, RX0, TX0 (the pinout prints BOOT0/1 as B0/B1).
//    "All digital & analog pins on the Nano ESP32 are 3.3 V"; "VBUS ... is supplied directly from
//    the USB-C power source"; VIN "6-21 V". The cheat sheet's pin map: BOOT0 = GPIO46, BOOT1 = GPIO0,
//    A2 = GPIO3, the ESP32-S3 strapping pins it breaks out (S3_STRAP in lib/pin-caps.mjs).
small({
  file: 'arduino-nano-esp32.json', id: 'arduino-nano-esp32', name: 'Arduino Nano ESP32',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00083-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00083-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00083-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/nano/boards/nano-esp32/tutorials/cheat-sheet/cheat-sheet.md https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/MCU_Module.kicad_symdir/Arduino_Nano_ESP32.kicad_sym ${NANO_SOURCE_KICAD}`,
  left: ['D13', '3V3', 'B0', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'VBUS', 'B1', 'GND', 'VIN'],
  right: NANO_RIGHT('RST', 'RX0', 'TX0'),
  own: { '3V3': P33, B0: { type: 'io' }, B1: { type: 'io' }, VBUS: P5, RST: IN, VIN: VIN_7_12, RX0: { type: 'io' }, TX0: { type: 'io' } },
  io33: true, caps: strapCaps(S3_STRAP, { B0: 46, B1: 0, A2: 3 }),
  internal: [['GND', 'GND 2']],
  external: { pin: 'VBUS', volts: 5, via: 'USB' },
  art: nanoArt((W) => usbC(W / 2 - 13, 26), (W, H) => [
    ...resetButton(W / 2 - 8, 24, 16),
    r(W / 2 - 12, 56, 24, 24, CHIP, { radius: 2 }),
    ...radioCan(W / 2 - 16, H - 70, 32, 48, 'NORA', 6), r(W / 2 - 16, H - 22, 32, 10, '#6E9C3A', { radius: 1 }),
  ]),
})

// 13. Nano RP2040 Connect (ABX00053). Datasheet sec. 5.2/5.3: REF "NC" ("The analog reference
//    voltage is fixed at +3.3V"), VUSB, REC "BOOTSEL"; "A4-A7 are connected to the Nina W102 ADC.
//    Additionally, A4 and A5 are shared with the I2C bus of the RP2040 and are each pulled up with
//    4.7 KΩ resistors"; "3.3V jumper (connected)", "VUSB jumper (disconnected)"; VIN 4-20 V. The
//    technical reference: "A4 and A5 are I2C only, while A6 and A7 can only be used as inputs",
//    "has the 5V pin (VUSB) disabled by default", and to enter the bootloader "Place a jumper wire
//    between the REC and GND pins on the board, then press the reset button". The full pinout prints
//    REC as the RP2040's QSPI_CSn, which the RP2040 datasheet's boot ROM reads at reset (low: USB boot).
small({
  file: 'arduino-nano-rp2040-connect.json', id: 'arduino-nano-rp2040-connect', name: 'Arduino Nano RP2040 Connect',
  source: `https://docs.arduino.cc/resources/datasheets/ABX00053-datasheet.pdf https://docs.arduino.cc/resources/pinouts/ABX00053-full-pinout.pdf https://docs.arduino.cc/resources/schematics/ABX00053-schematics.pdf https://github.com/arduino/docs-content/blob/main/content/hardware/nano/boards/nano-rp2040-connect/tutorials/rp2040-01-technical-reference/rp2040-01-technical-reference.md https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/MCU_Module.kicad_symdir/Arduino_Nano_RP2040_Connect.kicad_sym ${NANO_SOURCE_KICAD}`,
  left: NANO_LEFT('AREF|REF', '5V', 'REC'), right: NANO_RIGHT('RST', 'RX', 'TX'),
  own: { '3V3': P33, AREF: { type: 'nc' }, '5V': { type: 'nc' }, REC: IN, RST: IN, VIN: { type: 'power_in', supply: '5V/7V/7.4V/9V/12V' }, RX: { type: 'io' }, TX: { type: 'io' }, A6: IN, A7: IN },
  io33: true,
  caps: {
    AREF: { note: 'REF is not connected on this board: the analog reference is fixed at 3.3 V.' },
    '5V': { note: 'This pin is not connected as shipped; shorting the VUSB pads on the board puts USB 5 V on it.' },
    REC: { strapping: 'high', note: 'REC is the RP2040\'s BOOTSEL line: low at reset starts the USB bootloader instead of your sketch.' },
    D3: { noPullup: true, note: 'D3 cannot use the internal pull-up (Arduino technical reference: "digital pin 3 cannot be configured as INPUT_PULLUP"): add an external resistor.' },
    A4: { note: 'A4 is the board\'s I2C SDA, pulled up to 3.3 V with 4.7 kΩ and shared with the onboard chips: use it for I2C only.' },
    A5: { note: 'A5 is the board\'s I2C SCL, pulled up to 3.3 V with 4.7 kΩ and shared with the onboard chips: use it for I2C only.' },
    A6: { inputOnly: true, note: 'A6 is read by the Wi-Fi module\'s ADC: use it as an analog input only.' },
    A7: { inputOnly: true, note: 'A7 is read by the Wi-Fi module\'s ADC: use it as an analog input only.' },
  },
  internal: [['GND', 'GND 2']],
  art: nanoArt((W) => usbMicro(W / 2 - 12), (W, H) => [
    ...resetButton(W / 2 - 8, 24, 16),
    r(W / 2 - 13, 56, 26, 26, CHIP, { radius: 2, label: 'RP2040', labelColor: CAN, labelSize: 4.5 }),
    ...radioCan(W / 2 - 16, H - 66, 32, 54, 'NINA', 6),
  ]),
})

// 14/15. Pro Mini, SparkFun DEV-11113 (5 V / 16 MHz) and DEV-11114 (3.3 V / 8 MHz), the boards
//    Arduino's own Pro Mini page points to. Pad positions from SparkFun's v14 Eagle board (top view):
//    left edge TXO, RXI, RST, GND, 2 ... 9; right edge RAW, GND, RST, VCC, A3, A2, A1, A0, 13, 12,
//    11, 10; the six-pin programming header on the short edge BLK (GND), GND, VCC, RXI, TXO, GRN
//    (DTR); A4/A5 and A6/A7 as pad pairs inside the board, near A3 and near 13 (Eagle: 0.11 in in from
//    the right row; drawn 0.3 in in so the right-hand labels stay clear). The edge rows are 0.6 in
//    apart on the board and 0.8 in here: six programming pins need an 8-unit edge. The SparkFun graphical
//    datasheet draws the same rows. The programming header's TXO, RXI, VCC and GND are the same nets
//    as the edge pins (one Eagle signal each). RAW feeds the regulator: "anywhere from 3.4 to 12V"
//    (3.3 V guide), "Raw: 5V-16V (6V-12V recommended)" (5 V graphical datasheet); VCC is the
//    regulator's output. No USB: power it from the sheet.
const PRO_MINI_SOURCE = 'https://cdn.sparkfun.com/datasheets/Dev/Arduino/Boards/Arduino-Pro-Mini-v14.zip https://cdn.sparkfun.com/datasheets/Dev/Arduino/Boards/Arduino-Pro-Mini-v14.pdf https://learn.sparkfun.com/tutorials/using-the-arduino-pro-mini-33v/all https://docs.arduino.cc/retired/boards/arduino-pro-mini/'
function proMini({ file, id, name, gd, vcc, raw, io33 }) {
  const holes = [['A4', 70], ['A5', 60], ['A6', 120], ['A7', 110]].map(([n, y]) => {
    const g = { name: n, at: [[50, y]], holeStyle: 'pad', type: n === 'A6' || n === 'A7' ? 'input' : 'io' }
    const caps = n === 'A6' || n === 'A7' ? AVR_ADC_ONLY(n) : io33 ? IO33 : undefined
    return caps ? { ...g, caps } : g
  })
  const padLabel = ([n, y]) => r(26, y - 4, 18, 8, BLUE, { outline: false, label: n, labelColor: SILK, labelSize: 5.5 })
  small({
    file, id, name, source: `${gd} ${PRO_MINI_SOURCE}`, wu: 8, top: 1, pcb: BLUE, holes,
    topPins: ['GND 3|BLK', 'GND 4|GND', 'VCC 2|VCC', 'RXI 2|RXI', 'TXO 2|TXO', 'DTR|GRN'],
    left: ['TXO', 'RXI', 'RST', 'GND', 'D2|2', 'D3|3', 'D4|4', 'D5|5', 'D6|6', 'D7|7', 'D8|8', 'D9|9'],
    right: ['RAW', 'GND 2|GND', 'RST 2|RST', 'VCC', 'A3', 'A2', 'A1', 'A0', 'D13|13', 'D12|12', 'D11|11', 'D10|10'],
    own: { 'GND 3': { type: 'ground' }, 'GND 4': { type: 'ground' }, VCC: vcc, 'VCC 2': vcc, RAW: raw, RST: IN, 'RST 2': IN, DTR: IN,
      TXO: { type: 'io' }, RXI: { type: 'io' }, 'TXO 2': { type: 'io' }, 'RXI 2': { type: 'io' } },
    io33,
    internal: [['GND', 'GND 2', 'GND 3', 'GND 4'], ['RST', 'RST 2'], ['VCC', 'VCC 2'], ['TXO', 'TXO 2'], ['RXI', 'RXI 2']],
    art: (W, H) => [
      r(W / 2 - 13, 70, 26, 26, CHIP, { radius: 2, label: '328P', labelColor: CAN, labelSize: 5.5 }),
      ...resetButton(W / 2 - 13, H - 22, 16),
      ...[['A5', 60], ['A4', 70], ['A7', 110], ['A6', 120]].map(padLabel),
    ],
  })
}
proMini({
  file: 'arduino-pro-mini-5v.json', id: 'arduino-pro-mini-5v', name: 'Arduino Pro Mini 5V / 16MHz',
  gd: 'https://cdn.sparkfun.com/assets/learn_tutorials/1/0/4/Graphical_Datasheet_Arduino_ProMini-5V_16MHzV2.png',
  vcc: { type: 'power_out', supply: '5V' }, raw: VIN_7_12,
})
proMini({
  file: 'arduino-pro-mini-3v3.json', id: 'arduino-pro-mini-3v3', name: 'Arduino Pro Mini 3.3V / 8MHz',
  gd: 'https://cdn.sparkfun.com/assets/learn_tutorials/1/0/4/Graphical_Datasheet_Arduino_ProMini-3_3V_8MHzV2.png',
  vcc: { type: 'power_out', supply: '3V3' }, raw: { type: 'power_in', supply: '3.7V/5V/7.4V/9V/12V' }, io33: true,
})

finish('gen-arduino.mjs')
