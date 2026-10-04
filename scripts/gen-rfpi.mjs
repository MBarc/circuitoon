// Generates the Raspberry Pi touch displays, the RF parts and the MEMS microphones: the original
// 7" Raspberry Pi Touch Display (2015), Touch Display 2 in 7" and 5", the GY-GPSV3-NEO-M8N GPS
// board, the RTL-SDR Blog V4 dongle, the bare TDK ICS-40300, Knowles SPU0410LR5H-QB and TDK
// ICS-43434 microphones and Adafruit's ICS-43434 breakout (product 6049). Pin orders are transcribed
// from the sources cited on each part below (maker datasheets, maker photos and design files,
// cross-checked against a second, independent source). .superpowers/rfpi-pinouts.md has a table per
// part for the independent pinout review.
//
// Run from the repo root: `node scripts/gen-rfpi.mjs` (add `--check` to compare with modules/ without writing).
// It overwrites those files in modules/ in place; re-run after changing a part's pins or art,
// then `git diff` the result before committing. src/format/rfpi.test.ts pins the order.
//
// The DSI display ribbon is one pin per connector ("DSI"), not one per FPC contact. Its 15
// contacts are MIPI DSI differential pairs, I2C and power that only ever travel together on the
// flat cable: nobody wires them one by one, and a sheet with 15 loose DSI wires would invite a
// jumper-wire hookup that cannot work. One pin stands for the cable: wire it to the Pi's DSI port
// and the sheet says "use the FFC". The power header and J1 are real wire-to-wire connections, so
// they keep one pin per contact.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { usbPort } from './lib/usb.mjs'

const METAL = '#C9CED6', TIN = '#D5DAE1', HOLE = '#6B727C', CHIP = '#1E2126', GOLD = '#E0B43C', GOLD_HOLE = '#8A6A1E'
const BEZEL = '#1B1F24', BACK = '#B8BEC7', BACK_DARK = '#9AA1AB', GREEN = '#2F9E6E', GREEN_DARK = '#237A55'
const BLUE = '#1E4F8A', BLACK = '#2B2F36', WHITE = '#F4F6F8', FPC = '#E8A33D', FFC = '#E9ECEF', FFC_BLUE = '#3D6FD6'
const BEIGE = '#E9DDC4', SMD = '#C8A27A', RED = '#E0483E', WIRE_BLACK = '#2B2F36', LED_RED = '#E0483E', BATTERY = '#D5DAE1'

/** A short gold trace from `(x, y0)` to `(x, y1)`, for a pad's lead out to the body edge. */
const vtrace = (x, y0, y1, w = 3, fill = GOLD) => r(x - w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0), fill, { outline: false })
const htrace = (y, x0, x1, w = 3, fill = GOLD) => r(Math.min(x0, x1), y - w / 2, Math.abs(x1 - x0), w, fill, { outline: false })
/** A round header pad with its hole. */
const ring = (x, y, d = 8, fill = GOLD) => [r(x - d / 2, y - d / 2, d, d, fill, { radius: d / 2, outline: false }), r(x - 1.5, y - 1.5, 3, 3, GOLD_HOLE, { radius: 1.5, outline: false })]
/** A plated mounting hole. */
const mount = (x, y, d = 12) => [r(x - d / 2, y - d / 2, d, d, TIN, { radius: d / 2, outline: false }), r(x - d / 4, y - d / 4, d / 2, d / 2, HOLE, { radius: d / 4, outline: false })]

// =============================================================================================
// Displays

// ---------------------------------------------------------------------------------------------
// 1. Raspberry Pi Touch Display, the original 7" 800 x 480 DSI panel (2015), seen from the back.
//    Its adapter board ("Raspberry Pi Display V1.1") carries the 15-way DSI FFC connector
//    ("RPI-DISPLAY") on one edge and a 5-pin header beside it. Silkscreen, from the end nearest the
//    DSI connector: 5V, INT, SDA, SCL, GND (Raspberry Pi's documentation drawing "The location of
//    the display's 5 V and GND pins", display_plugs.png; Adafruit's product photo 2718-03 shows the
//    same silkscreen next to the connector). Power is 5 V, 200 mA typical at full brightness, from
//    the Pi's GPIO 5V and GND by jumper wires (or the board's micro-USB "PWR IN"; Raspberry Pi warns
//    not to use both). SDA and SCL are the touch controller's I2C, needed only on the oldest Pis
//    (B+ and later carry it on the DSI cable); INT is not used ("Interrupts aren't used. Leave it
//    disconnected.", 6by9, Raspberry Pi engineer, forum t=227980). The micro-USB, the USB-A and the
//    panel FPC are drawn, not pinned. Drawn with the adapter board's DSI edge at the left.
{
  const wu = 24, hu = 15, W = wu * 10, H = hu * 10
  const types = {
    '5V': { type: 'power_in', supply: '5V' }, GND: { type: 'ground' }, SDA: { type: 'io' }, SCL: { type: 'io' },
    INT: { type: 'output' },
    DSI: { type: 'passive' },
  }
  const top = side('top', ['5V', 'INT', 'SDA', 'SCL', 'GND'], types, wu)
  const left = side('left', ['DSI'], types, hu)
  const bx = 70, by = 8, bw = 120, bh = 122
  const y = left.pos.DSI
  const shapes = [
    // Bezel (the glass edge) and the metal back of the panel.
    r(0, 0, W, H, BEZEL, { radius: 8 }),
    r(10, 8, W - 20, H - 16, BACK, { radius: 4 }),
    ...[[24, 20], [W - 24, 20], [24, H - 20], [W - 24, H - 20]].flatMap(([x, yy]) => [r(x - 6, yy - 6, 12, 12, BACK_DARK, { radius: 2 }), r(x - 2, yy - 2, 4, 4, HOLE, { radius: 2, outline: false })]),
    // The panel's own FPC running into the adapter board's PANEL connector.
    r(bx + 40, by + bh - 6, 40, H - 8 - (by + bh - 6), FPC, { outline: false }),
    // Adapter board with its corner standoffs; the 5-pin header on its top edge, labels below it.
    r(bx, by, bw, bh, GREEN, { radius: 4 }),
    ...mount(bx + 8, by + 46, 8), ...mount(bx + bw - 8, by + 8, 8), ...mount(bx + 8, by + bh - 8, 8), ...mount(bx + bw - 8, by + bh - 8, 8),
    r(top.at[0] - 6, 2, top.at[top.at.length - 1] - top.at[0] + 12, 10, BLACK, { radius: 1 }),
    ...top.at.map((x) => r(x - 2, 5, 4, 4, GOLD, { outline: false })),
    // DSI ribbon from the left edge into the FFC connector on the board's edge.
    r(0, y - 10, bx + 14, 20, FFC, { outline: false }),
    r(bx - 30, y - 10, 6, 20, FFC_BLUE, { outline: false }),
    r(bx + 4, y - 14, 14, 28, BEIGE, { radius: 1 }),
    // Chips, the micro-USB PWR IN, the USB-A and the PANEL connector.
    r(bx + 34, by + 50, 22, 22, CHIP, { radius: 1 }),
    r(bx + 64, by + 48, 50, 10, GREEN_DARK, { outline: false, label: 'Raspberry Pi Display', labelColor: WHITE, labelSize: 4.5 }),
    r(bx + 72, by + 62, 14, 14, CHIP, { radius: 1 }),
    r(bx + 6, by + bh - 34, 18, 12, METAL, { radius: 2, label: 'PWR IN', labelSize: 3.5 }),
    r(bx + bw - 32, by + bh - 40, 26, 22, METAL, { radius: 1 }),
    r(bx + bw - 28, by + bh - 32, 18, 6, HOLE, { outline: false }),
    r(bx + 40, by + bh - 16, 40, 8, BEIGE, { radius: 1, label: 'PANEL', labelSize: 4 }),
    r(W - 46, 34, 30, 10, BACK, { outline: false, label: '7in 800x480', labelColor: BLACK, labelSize: 4.5 }),
  ]
  write('lcd-rpi-touch-display-7.json', moduleJson({
    inside: true, id: 'lcd-rpi-touch-display-7', name: 'Raspberry Pi Touch Display 7" (2015, DSI, 5V INT SDA SCL GND)', category: 'Displays',
    source: 'https://www.raspberrypi.com/documentation/accessories/display.html https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/accessories/display/images/display_plugs.png https://www.adafruit.com/product/2718 https://cdn-shop.adafruit.com/970x728/2718-03.jpg https://datasheets.raspberrypi.com/display/7-inch-display-product-brief.pdf https://forums.raspberrypi.com/viewtopic.php?t=227980',
    pins: [...left.pins, ...top.pins], wu, hu, electrical: { model: 'display', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2-3. Raspberry Pi Touch Display 2, 7" and 5" (720 x 1280, native portrait), seen from the back
//    as in the product brief's mechanical drawings (RP-009106-MM, RP-010430-MM): the 15-way DSI FFC
//    connector J2 low on the centre strip, the small 2-pin power connector J1 just to its left.
//    J1's silkscreen numbers pin 1 at the red lead (5 V) and pin 2 at the black (GND)
//    (Raspberry Pi's documentation photo touch-display-2-ffc.jpg); the supplied cable runs red to
//    the Pi's GPIO pin 2 (5 V) and black to pin 6 (GND) (Touch Display 2 documentation, step 3).
//    No I2C on J1: touch and backlight travel on the DSI cable. The power lead is drawn from J1 to
//    the left edge, where its two pins sit; the FFC from J2 down to the bottom edge.
function td2({ file, id, name, inch, wu, hu, source }) {
  const W = wu * 10, H = hu * 10
  const types = { '5V': { type: 'power_in', supply: '5V' }, GND: { type: 'ground' }, DSI: { type: 'passive' } }
  const left = side('left', ['5V', 'GND'], types, hu)
  const bottom = side('bottom', ['DSI'], types, wu)
  const cx = bottom.pos.DSI, jy = Math.round(H * 0.62)
  const [y5, yg] = left.at
  const sx = cx - 22
  const shapes = [
    r(0, 0, W, H, BEZEL, { radius: 8 }),
    r(10, 10, W - 20, H - 20, BACK, { radius: 3 }),
    // The two long rails of the back plate and the four corner clips.
    r(cx - 26, 22, 3, H - 60, BACK_DARK, { outline: false }), r(cx + 23, 22, 3, H - 60, BACK_DARK, { outline: false }),
    ...[[24, 26], [W - 24, 26], [24, H - 26], [W - 24, H - 26]].flatMap(([x, y]) => [r(x - 8, y - 6, 16, 12, BACK_DARK, { radius: 2 }), r(x - 2, y - 2, 4, 4, HOLE, { radius: 2, outline: false })]),
    // Standoffs a Pi mounts on.
    ...[[cx - 36, Math.round(H * 0.42)], [cx + 36, Math.round(H * 0.42)], [cx - 36, Math.round(H * 0.74)], [cx + 36, Math.round(H * 0.74)]].flatMap(([x, y]) => [r(x - 5, y - 5, 10, 10, TIN, { radius: 5 }), r(x - 2, y - 2, 4, 4, HOLE, { radius: 2, outline: false })]),
    // Centre PCB strip with J1's arm; J1 sits on the arm with pin 1 (red, 5 V) above pin 2 (black, GND).
    r(cx - 20, jy - 30, 40, 44, GREEN, { radius: 2 }),
    r(sx - 22, y5 - 12, 26, yg - y5 + 24, GREEN, { radius: 2 }),
    r(4, y5 - 2, sx - 18, 4, RED, { radius: 1, outline: false }),
    r(4, yg - 2, sx - 18, 4, WIRE_BLACK, { radius: 1, outline: false }),
    r(sx - 16, y5 - 7, 14, yg - y5 + 14, WHITE, { radius: 1 }),
    r(sx - 4, y5 - 1.5, 4, 3, METAL, { outline: false }), r(sx - 4, yg - 1.5, 4, 3, METAL, { outline: false }),
    r(sx + 4, y5 - 10, 12, 8, GREEN, { outline: false, label: 'J1', labelColor: WHITE, labelSize: 4 }),
    // J2 and the FFC down to the bottom edge.
    r(cx - 12, jy, 24, H - jy, FFC, { outline: false }),
    r(cx - 12, jy + 16, 24, 5, FFC_BLUE, { outline: false }),
    r(cx - 17, jy - 6, 34, 12, BEIGE, { radius: 1, label: 'J2', labelColor: BLACK, labelSize: 4 }),
    r(cx - 30, 34, 60, 12, BACK, { outline: false, label: 'Touch Display 2', labelColor: BLACK, labelSize: 5 }),
    r(cx - 30, 46, 60, 10, BACK, { outline: false, label: `${inch}in 720x1280`, labelColor: BLACK, labelSize: 4.5 }),
  ]
  write(file, moduleJson({ inside: true, id, name, category: 'Displays', source, pins: [...left.pins, ...bottom.pins], wu, hu, electrical: { model: 'display', params: {} }, shapes }))
}

td2({
  file: 'lcd-rpi-touch-display-2-7.json', id: 'lcd-rpi-touch-display-2-7', name: 'Raspberry Pi Touch Display 2, 7" (DSI, J1 5V GND)', inch: 7, wu: 14, hu: 22,
  source: 'https://www.raspberrypi.com/documentation/accessories/touch-display-2.html https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/accessories/touch-display-2/images/touch-display-2-ffc.jpg https://pip-assets.raspberrypi.com/categories/1083-raspberry-pi-touch-display-2/documents/RP-009106-MM-8-touch-display-2-product-brief.pdf https://www.adafruit.com/product/6079',
})
td2({
  file: 'lcd-rpi-touch-display-2-5.json', id: 'lcd-rpi-touch-display-2-5', name: 'Raspberry Pi Touch Display 2, 5" (DSI, J1 5V GND)', inch: 5, wu: 12, hu: 18,
  source: 'https://www.raspberrypi.com/documentation/accessories/touch-display-2.html https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/accessories/touch-display-2/images/touch-display-2-ffc.jpg https://pip-assets.raspberrypi.com/categories/1083-raspberry-pi-touch-display-2/documents/RP-010430-MM-1-touch-display-2-5-inch-product-brief.pdf https://pip-assets.raspberrypi.com/categories/1083-raspberry-pi-touch-display-2/documents/RP-009106-MM-8-touch-display-2-product-brief.pdf',
})

// =============================================================================================
// Communication

// ---------------------------------------------------------------------------------------------
// 4. GY-GPSV3-NEO-M8N GPS board (blue, marked "GY-GPSV3-NEO" and "HW-448"), u-blox NEO-M8N with a
//    backup cell, an EEPROM and a 3.3 V regulator. Component side, header J1 at the top: VCC, RX,
//    TX, GND left to right (ShillehTek's and OpenELAB's product photos show the same silkscreen);
//    the u.FL antenna jack sits at the bottom right. This variant has no PPS pin (its time-pulse
//    only drives an LED); 5-pin clones with PPS are other boards. VCC takes 3 to 5 V (vendor
//    rating, regulated on board); the UART goes straight to the NEO-M8N, whose VCC is 2.7 to 3.6 V
//    and whose inputs take at most 3.6 V when VCC > 3.1 V (u-blox NEO-M8 data sheet UBX-15031086,
//    sections 4.1 and 4.2; OpenELAB: "Treat the serial interface as 3.3V logic"). RX is the
//    module's input (NEO-M8 pin 21 RXD), TX its output (pin 20 TXD).
{
  const wu = 10, hu = 12, W = wu * 10, H = hu * 10
  const types = {
    VCC: { type: 'power_in', supply: '3V3/5V' }, GND: { type: 'ground' },
    RX: { type: 'input' },
    TX: { type: 'output' }, ANT: { type: 'passive' },
  }
  const top = side('top', ['VCC', 'RX', 'TX', 'GND'], types, wu)
  const bottom = side('bottom', [null, null, null, null, null, 'ANT', null, null], types, wu)
  const ax = bottom.pos.ANT
  const shapes = [
    r(0, 0, W, H, BLUE, { radius: 4 }),
    ...mount(12, 12), ...mount(W - 12, 12), ...mount(12, H - 12), ...mount(W - 12, H - 12),
    // Header J1 along the top.
    ...top.at.flatMap((x) => ring(x, 7)),
    // Backup cell, regulator, EEPROM.
    r(8, 30, 18, 18, BATTERY, { radius: 9 }),
    r(34, 30, 12, 8, CHIP, { radius: 1 }),
    r(8, 66, 14, 20, CHIP, { radius: 1 }),
    // The NEO-M8N can, centred.
    r(30, 44, 50, 46, METAL, { radius: 2 }),
    r(34, 50, 42, 34, WHITE, { radius: 1, label: 'NEO-M8N', labelColor: BLACK, labelSize: 6 }),
    r(52, 30, 6, 4, LED_RED, { radius: 1, outline: false }),
    // u.FL jack and its trace to the antenna pin.
    vtrace(ax, H - 22, H, 2),
    r(ax - 7, H - 30, 14, 14, GOLD, { radius: 2 }),
    r(ax - 4, H - 27, 8, 8, TIN, { radius: 4, outline: false }),
    r(ax - 1.5, H - 24.5, 3, 3, GOLD_HOLE, { radius: 1.5, outline: false }),
  ]
  write('gps-neo-m8n-gy-gpsv3.json', moduleJson({
    footprint: 'legs', inside: true, id: 'gps-neo-m8n-gy-gpsv3', name: 'GPS module NEO-M8N (GY-GPSV3, VCC RX TX GND, u.FL)', category: 'Communication',
    source: 'https://shillehtek.com/blogs/shillehtek-product-manuals/gps-module-neo-m8n-antenna-battery-arduino-esp32-manual https://openelab.io/products/u-blox-neo-m8n-0 https://content.u-blox.com/sites/default/files/NEO-M8-FW3_DataSheet_UBX-15031086.pdf',
    pins: [...top.pins, ...bottom.pins], wu, hu, electrical: { model: 'radio', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 5. RTL-SDR Blog V4 (R828D tuner, RTL2832U), a USB dongle: "USB Connector: USB-A Male",
//    "Input Connector: 1x SMA" (RTL-SDR Blog V4 datasheet), an SMA female antenna port (RTL-SDR
//    Blog store page); "Typical Current Draw 250 - 270 mA" (datasheet), recorded as 270 mA. The plug
//    is one USB port (USB design 1.1): a USB-A plug device that goes straight into a host's socket.
//    It used to be four contact pins (VBUS, D-, D+, GND); a sheet saved with those keeps its copy
//    and is asked to place the part again. ANT is the SMA jack. The software bias tee can put
//    4.5 V, 180 mA on ANT, for an LNA only (that current comes from USB too, on top of the 270 mA).
{
  const wu = 17, hu = 6, W = wu * 10, H = hu * 10
  const types = { ANT: { type: 'passive' } }
  const left = { pins: [usbPort('USB', 'left', { connector: 'A', gender: 'plug', role: 'device', version: '2.0', draw: 270 })] }
  const right = side('right', ['ANT'], types, hu)
  const y = right.pos.ANT
  const shapes = [
    // USB-A plug shell with its contact tongue.
    r(0, 6, 44, H - 12, METAL, { radius: 1 }),
    r(3, 10, 36, H - 20, '#F4F6F8', { radius: 1 }),
    // Black aluminium case.
    r(40, 2, W - 66, H - 4, BLACK, { radius: 6 }),
    r(54, 16, 70, 12, BLACK, { outline: false, label: 'RTL-SDR Blog', labelColor: WHITE, labelSize: 6 }),
    r(54, 30, 70, 12, BLACK, { outline: false, label: 'V4', labelColor: WHITE, labelSize: 6 }),
    r(W - 34, y - 6, 3, 3, LED_RED, { radius: 1.5, outline: false }),
    // SMA jack: hex nut and threaded barrel.
    r(W - 28, y - 13, 12, 26, GOLD, { radius: 2 }),
    r(W - 16, y - 9, 16, 18, GOLD, { radius: 1 }),
    ...[0, 1, 2].map((i) => r(W - 14 + i * 5, y - 9, 1.5, 18, GOLD_HOLE, { outline: false })),
  ]
  write('rtl-sdr-blog-v4.json', moduleJson({
    inside: true, id: 'rtl-sdr-blog-v4', name: 'RTL-SDR Blog V4 USB dongle (USB-A plug, SMA antenna)', category: 'Communication',
    source: 'https://www.rtl-sdr.com/wp-content/uploads/2024/12/RTLSDR_V4_Datasheet_V_1_0.pdf https://www.rtl-sdr.com/v4/ https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/ https://en.wikipedia.org/wiki/USB_hardware#Pinouts',
    pins: [...left.pins, ...right.pins], wu, hu, electrical: { model: 'radio', params: {} }, shapes,
  }))
}

// =============================================================================================
// Sensors: MEMS microphones. The bare packages are drawn from the top (lid up, pads underneath)
// with each pad brought out to its nearest edge in its physical order; the datasheets give the
// pads in a bottom view, mirrored here. Every GND pad is its own pin: the datasheets list them as
// separate ground pins to connect, and none says they are joined inside.

/** A metal mic lid with its sound-port mark. */
const lid = (x, y, w, h, label, port, ly = y + h / 2 - 6) => [
  r(x, y, w, h, METAL, { radius: 3 }),
  r(x + 3, y + 3, w - 6, h - 6, TIN, { radius: 2, outline: false }),
  r(x + w / 2 - 20, ly, 40, 12, TIN, { outline: false, label, labelColor: BLACK, labelSize: 5 }),
  ...(port ? [r(port[0] - 3, port[1] - 3, 6, 6, HOLE, { radius: 3, outline: false })] : []),
]
const pin1 = (x, y) => r(x - 2, y - 2, 4, 4, BLACK, { radius: 2, outline: false })

// ---------------------------------------------------------------------------------------------
// 6. TDK InvenSense ICS-40300, analog MEMS mic, 4.72 x 3.76 x 3.5 mm, bottom port (DS-ICS-40300-00
//    rev 1.0 and 1.3, Figure 2 "BOTTOM VIEW", Table 4): one column of OUTPUT (1), GND (6), VDD (5),
//    the opposite edge GND (2) and GND (4), the sound-port ring GND (3) between them, nearer 2 and
//    4. Seen from the top that column is on the right: right OUTPUT, GND 6, VDD top to bottom; left
//    GND 2, GND 3 (ring), GND 4. VDD 1.5 to 3.63 V; output DC offset 0.8 V. The pin-compatible
//    INMP411 (DS-INMP411-00) has the same pin table and bottom view.
{
  const wu = 12, hu = 6, W = wu * 10, H = hu * 10
  const types = { OUTPUT: { type: 'output' }, VDD: { type: 'power_in', supply: '1V8/3V3' }, GND: { type: 'ground' } }
  // Names follow the GND, GND 2 ... convention in array order: pads 2, 3, 4, 6 (kicad.mjs lists the pads).
  const left = side('left', ['GND', 'GND 2|GND', 'GND 3|GND'], types, hu)
  const right = side('right', ['OUTPUT', 'GND 4|GND', 'VDD'], types, hu)
  const shapes = [
    ...left.at.map((y) => htrace(y, 0, 40)), ...right.at.map((y) => htrace(y, W - 40, W)),
    ...lid(30, 4, W - 60, H - 8, 'ICS-40300', [44, H / 2], 38),
    pin1(W - 36, 10),
  ]
  write('mic-ics-40300.json', moduleJson({
    inside: true, id: 'mic-ics-40300', name: 'Microphone ICS-40300 (TDK, analog MEMS, bare SMD)', category: 'Sensors',
    source: 'https://datasheet.octopart.com/ICS-40300-InvenSense-datasheet-27080197.pdf https://cdn.eicom.ru/media/PDF/8097381.pdf https://invensense.tdk.com/products/analog/ics-40300/ https://www.farnell.com/datasheets/1838551.pdf',
    pins: [...left.pins, ...right.pins], wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 7. Knowles SPU0410LR5H-QB, analog "zero height" MEMS mic, 3.76 x 3.00 x 1.10 mm, bottom port
//    (Knowles datasheet rev B section 6 and rev H section 4: pin 1 OUTPUT, 4 VDD, 2, 3, 5 and 6
//    GROUND; the pad drawing is a bottom view, pin 1 top right, the top view's pin 1 mark top
//    left). Seen from the top: top row OUTPUT (1), GND (5), VDD (4) left to right; bottom row GND
//    (2) left, GND (3) right, the port ring GND (6) between them. VDD 1.5 to 3.6 V.
{
  const wu = 8, hu = 12, W = wu * 10, H = hu * 10
  const types = { OUTPUT: { type: 'output' }, VDD: { type: 'power_in', supply: '1V8/3V3' }, GND: { type: 'ground' } }
  // Names in array order: GND is pad 5, GND 2 pad 2, GND 3 the ring (pad 6), GND 4 pad 3.
  const top = side('top', ['OUTPUT', 'GND', 'VDD'], types, wu)
  const bottom = side('bottom', ['GND 2|GND', 'GND 3|GND', 'GND 4|GND'], types, wu)
  const shapes = [
    ...top.at.map((x) => vtrace(x, 0, 42)), ...bottom.at.map((x) => vtrace(x, H - 42, H)),
    r(8, 40, W - 16, H - 80, METAL, { radius: 3 }),
    r(11, 43, W - 22, H - 86, TIN, { radius: 2, outline: false }),
    r(W / 2 - 18, H / 2 - 12, 36, 10, TIN, { outline: false, label: 'SPU0410', labelColor: BLACK, labelSize: 5 }),
    r(W / 2 - 18, H / 2 - 2, 36, 10, TIN, { outline: false, label: 'LR5H-QB', labelColor: BLACK, labelSize: 4.5 }),
    pin1(16, 48),
    r(W / 2 - 3, H - 52, 6, 6, HOLE, { radius: 3, outline: false }),
  ]
  write('mic-spu0410lr5h-qb.json', moduleJson({
    inside: true, id: 'mic-spu0410lr5h-qb', name: 'Microphone SPU0410LR5H-QB (Knowles, analog MEMS, bare SMD)', category: 'Sensors',
    source: 'https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/384/SPU0410LR5H-QB_RevH_3-27-13.pdf https://datasheet.octopart.com/SPU0410LR5H-QB-Knowles-Acoustics-datasheet-8852744.pdf https://www.flux.ai/jecstronic/spu0410lr5h-qb',
    pins: [...top.pins, ...bottom.pins], wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 8. TDK InvenSense ICS-43434, I2S MEMS mic, 3.5 x 2.65 x 0.98 mm, bottom port (DS-000069 rev 1.2,
//    Figure 3 "Pin Configuration (top view, terminal side down)" and Table 8): the port ring GND
//    (3) at the top, SCK (4) left and LR (2) right below it, VDD (5), SD (6), WS (1) along the
//    bottom. VDD 1.65 to 3.63 V; digital inputs to VDD + 0.3 V. KiCad's ICS-43434 symbol and
//    footprint (Sensor_Audio) and Adafruit's 6049 board file number the pins the same way.
{
  const wu = 10, hu = 11, W = wu * 10, H = hu * 10
  const types = {
    WS: { type: 'input' },
    LR: { type: 'input' },
    GND: { type: 'ground' }, SCK: { type: 'input' }, VDD: { type: 'power_in', supply: '1V8/3V3' },
    SD: { type: 'output' },
  }
  const top = side('top', ['GND'], types, wu)
  const left = side('left', ['SCK'], types, hu)
  const right = side('right', ['LR'], types, hu)
  const bottom = side('bottom', ['VDD', 'SD', 'WS'], types, wu)
  const shapes = [
    ...top.at.map((x) => vtrace(x, 0, 36)), ...bottom.at.map((x) => vtrace(x, H - 36, H)),
    ...left.at.map((y) => htrace(y, 0, 28)), ...right.at.map((y) => htrace(y, W - 28, W)),
    ...lid(26, 34, W - 52, H - 68, 'ICS-43434', [W / 2, 44], H / 2),
  ]
  write('mic-ics-43434.json', moduleJson({
    inside: true, id: 'mic-ics-43434', name: 'Microphone ICS-43434 (TDK, I2S MEMS, bare SMD)', category: 'Sensors',
    source: 'https://cdn-shop.adafruit.com/product-files/6049/6049_DS-000069-ICS-43434-v1.2.pdf https://www.mouser.com/datasheet/2/400/ds_000069_ics_43434_v1_2-2581173.pdf https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/Sensor_Audio.kicad_symdir/ICS-43434.kicad_sym https://github.com/adafruit/Adafruit-I2S-MEMS-Microphone-Breakout-PCB',
    pins: [...top.pins, ...left.pins, ...right.pins, ...bottom.pins], wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 9. Adafruit I2S MEMS Microphone Breakout - ICS-43434 (product 6049). Mic side up, header at the
//    bottom: 3V, GND, BCLK, DOUT, LRCL, SEL left to right. Adafruit's board file (JP2 pads 1-6:
//    VDD, GND, BCLK, DATA, WS, SELECT) and the silkscreen on the back of the board (SEL ... 3V,
//    read from behind) agree. "VIN/Logic: 3.3V": 3V feeds the mic directly (1.65 to 3.63 V). DOUT
//    is the mic's SD through 68 Ohm with a 47 kOhm pull-down; SEL is pulled to GND by 47 kOhm (left
//    channel) and picks the right channel when tied high.
{
  const wu = 8, hu = 7, W = wu * 10, H = hu * 10
  const types = {
    '3V': { type: 'power_in', supply: '3V3' }, GND: { type: 'ground' }, BCLK: { type: 'input' }, DOUT: { type: 'output' }, LRCL: { type: 'input' },
    SEL: { type: 'input' },
  }
  const bottom = side('bottom', ['3V', 'GND', 'BCLK', 'DOUT', 'LRCL', 'SEL'], types, wu)
  const shapes = [
    r(0, 0, W, H, BLACK, { radius: 5 }),
    ...mount(12, 12, 14), ...mount(W - 12, 12, 14),
    ...bottom.at.flatMap((x) => ring(x, H - 7)),
    r(W / 2 - 8, 6, 16, 18, METAL, { radius: 2 }),
    r(W / 2 - 5, 9, 10, 12, TIN, { radius: 1, outline: false }),
    r(10, 26, 6, 8, SMD, { radius: 1, outline: false }), r(18, 26, 6, 8, SMD, { radius: 1, outline: false }),
    r(W / 2 - 22, 26, 44, 9, BLACK, { outline: false, label: 'ICS-43434', labelColor: WHITE, labelSize: 5 }),
  ]
  write('mic-ics-43434-adafruit-6049.json', moduleJson({
    footprint: 'legs', inside: true, id: 'mic-ics-43434-adafruit-6049', name: 'I2S MEMS microphone breakout ICS-43434 (Adafruit 6049)', category: 'Sensors',
    source: 'https://www.adafruit.com/product/6049 https://github.com/adafruit/Adafruit-I2S-MEMS-Microphone-Breakout-PCB https://cdn-shop.adafruit.com/970x728/6049-02.jpg https://cdn-shop.adafruit.com/product-files/6049/6049_DS-000069-ICS-43434-v1.2.pdf',
    pins: bottom.pins, wu, hu, electrical: { model: 'sensor', params: {} }, shapes,
  }))
}

finish('gen-rfpi.mjs')
