// Generates the USB host parts and hubs (docs/superpowers/specs/2026-10-04-usb-design.md): the
// Raspberry Pi 4 Model B, Raspberry Pi 5 and Raspberry Pi Zero 2 W, a generic computer USB port, the
// Circuitneato FE1.1s USB hub board and a generic powered 4-port USB 2.0 hub. Pinouts and ports are
// transcribed from the sources cited on each part (maker documentation and drawings, cross-checked
// against a second source); .superpowers/usb-pinouts.md has a table per part for the independent
// review. src/format/usbParts.test.ts and usbHosts.test.ts pin the result.
//
// Run from the repo root: `node scripts/gen-usb.mjs` (add `--check` to compare with modules/ without writing).
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, write } from './lib/parts.mjs'
import { portSide, usbPort } from './lib/usb.mjs'

const PI_GREEN = '#2E7D4F', PI_DARK = '#215C3A', BLACK = '#2B2F36', METAL = '#C9CED6', TIN = '#D5DAE1', HOLE = '#6B727C'
const BEIGE = '#E9DDC4', WHITE = '#F4F6F8', SILK = '#F4F6F8', BLUE = '#3D6FD6', CHIP = '#1E2126', GOLD = '#E0B43C'
const HUB_BLACK = '#1F2328', CASE = '#E9ECEF', CASE_DARK = '#BFC5CD'

// =============================================================================================
// The 40-pin GPIO header (Raspberry Pi 4, 5 and Zero 2 W: the same J8). Physical pin order from
// Raspberry Pi's documentation ("GPIO and the 40-pin header", GPIO-Pinout-Diagram-2.png) and gpiozero's
// board data (gpiozero/pins/data.py, PLUS_J8 and PI4_J8); pinout.xyz agrees pin for pin. Seen from
// the component side with the header along the top edge (the gpiozero board drawings and the
// mechanical drawings put it there, the USB and Ethernet ports at the right): pin 1 at the left
// end, odd pins on the inner row, even pins (2, 4: 5V) on the board edge. The pads are drawn one
// row lower than true (rows at 2 and 3 grid units instead of about 1 and 2) so each pin's name fits
// above or below it.
const J8 = [
  '3V3', '5V', 'GPIO2', '5V', 'GPIO3', 'GND', 'GPIO4', 'GPIO14', 'GND', 'GPIO15',
  'GPIO17', 'GPIO18', 'GPIO27', 'GND', 'GPIO22', 'GPIO23', '3V3', 'GPIO24', 'GPIO10', 'GND',
  'GPIO9', 'GPIO25', 'GPIO11', 'GPIO8', 'GND', 'GPIO7', 'GPIO0', 'GPIO1', 'GPIO5', 'GND',
  'GPIO6', 'GPIO12', 'GPIO13', 'GND', 'GPIO19', 'GPIO16', 'GPIO26', 'GPIO20', 'GND', 'GPIO21',
]
// Notes from the same documentation page: "Pins GPIO2 and GPIO3 have fixed pull-up resistors" (they
// are I2C1); "GPIO pins 0 and 1 are present on the board (physical pins 27 and 28), but are reserved
// for advanced use" (ID_SD and ID_SC, the HAT ID EEPROM bus).
const J8_NOTES = {
  GPIO2: 'GPIO2 is I2C SDA and has a fixed pull-up resistor to 3.3 V on the board, so it reads high when nothing drives it.',
  GPIO3: 'GPIO3 is I2C SCL and has a fixed pull-up resistor to 3.3 V on the board, so it reads high when nothing drives it.',
  GPIO0: 'GPIO0 (ID_SD) is reserved for advanced use: the HAT ID EEPROM. Leave it unconnected unless you add one.',
  GPIO1: 'GPIO1 (ID_SC) is reserved for advanced use: the HAT ID EEPROM. Leave it unconnected unless you add one.',
}
/** The header as hole groups: pad k at column (k - 1) / 2 from `x0`, odd pins on row `yOdd`, even on `yEven`. */
function header40(x0, yEven, yOdd) {
  const seen = {}
  return J8.map((fn, i) => {
    const k = i + 1
    seen[fn] = (seen[fn] ?? 0) + 1
    const name = seen[fn] === 1 ? fn : `${fn} ${seen[fn]}`
    const g = { name, ...(name !== fn ? { label: fn } : {}), at: [[x0 + Math.floor(i / 2) * 10, k % 2 ? yOdd : yEven]], holeStyle: 'pad' }
    if (fn === '3V3') Object.assign(g, { type: 'power_out', supply: '3V3' })
    else if (fn === '5V') Object.assign(g, { type: 'power_in', supply: '5V' })
    else if (fn === 'GND') g.type = 'ground'
    else g.type = 'io'
    if (J8_NOTES[name]) g.caps = { note: J8_NOTES[name] }
    return g
  })
}
const j8Internal = (holes) => ['GND', '3V3', '5V'].map((fn) => holes.filter((g) => (g.label ?? g.name) === fn).map((g) => g.name))
/** Silkscreen-style names beside the header: even row above, odd row below. */
function j8Labels(holes, yEven, yOdd, fill) {
  return holes.map((g) => {
    const [x, y] = g.at[0]
    const text = (g.label ?? g.name).replace(/^GPIO/, '').replace('3V3', '3V')
    return r(x - 4.5, y === yEven ? yEven - 13 : yOdd + 6, 9, 7, fill, { outline: false, label: text, labelColor: SILK, labelSize: text.length > 2 ? 3.6 : 4.2 })
  })
}
const mountHole = (x, y) => [r(x - 6, y - 6, 12, 12, TIN, { radius: 6, outline: false }), r(x - 3, y - 3, 6, 6, HOLE, { radius: 3, outline: false })]
/** A stacked USB-A pair at the right edge, centred at y: metal shell with its two tongues. */
const usbStack = (W, y, tongue) => [r(W - 66, y - 25, 70, 50, METAL, { radius: 2 }), r(W - 6, y - 20, 4, 15, tongue, { outline: false }), r(W - 6, y + 5, 4, 15, tongue, { outline: false })]
const ethernet = (W, y) => [r(W - 82, y - 31, 86, 62, METAL, { radius: 2 }), r(W - 14, y - 18, 12, 36, BLACK, { radius: 1, outline: false })]
const microHdmi = (x, H) => r(x - 12, H - 16, 24, 18, METAL, { radius: 2 })
const ffc = (x, y, w, h, label) => r(x, y, w, h, BEIGE, { radius: 1, label, labelColor: BLACK, labelSize: 4 })

// Raspberry Pi USB facts (Raspberry Pi documentation, "Universal Serial Bus (USB)" and "Power
// supply"): Pi 4 "offers two USB 3.0 ports and two USB 2.0 ports", "1200mA total across all ports";
// Pi 5 "600mA if using a 3A supply, 1600mA if using a 5A supply", "The power budget is shared
// between the USB ports and the fan header"; typical bare-board active current consumption Pi 4
// 600 mA, Pi 5 800 mA, Zero 2 W 350 mA (the draw recorded on each board's power input). Each host
// port's own limit is its version's USB default (the docs give only the totals).
const USB3_HOST = { connector: 'A', gender: 'receptacle', role: 'host', version: '3.0', speed: 'super' }
const USB2_HOST = { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', speed: 'high' }

// ---------------------------------------------------------------------------------------------
// 1. Raspberry Pi 4 Model B (85 x 56 mm, drawn 340 x 220 px at 0.1 in per 10 px). Mechanical
//    drawing RP-008343-DS and gpiozero's B4 board art: at the right edge, top to bottom, the
//    Ethernet jack, the USB 3.0 pair (blue) and the USB 2.0 pair; along the bottom, USB-C power
//    (11.2 mm from the left), micro HDMI 0 and 1, the CSI "CAMERA" connector and the audio jack;
//    the DSI "DISPLAY" connector near the left edge. The camera and display connectors are one pin
//    each (their flat cables travel whole, as on the Touch Display parts).
{
  const wu = 34, hu = 22, W = wu * 10, H = hu * 10, yEven = 20, yOdd = 30
  const holes = header40(30, yEven, yOdd)
  const pins = [
    ...portSide('right', hu, [
      [110, usbPort('USB3-1', 'right', USB3_HOST, 'USB3')], [120, usbPort('USB3-2', 'right', USB3_HOST, 'USB3')],
      [180, usbPort('USB2-1', 'right', USB2_HOST, 'USB2')], [190, usbPort('USB2-2', 'right', USB2_HOST, 'USB2')],
    ]),
    ...portSide('bottom', wu, [
      // The USB-C power input; the docs: "the USB controller used on previous models is located on the
      // USB type C port and is disabled by default", so it is a device port, not charge-only.
      [40, usbPort('USB-C', 'bottom', { connector: 'C', gender: 'receptacle', role: 'device', version: '2.0', draw: 600 }, 'PWR')],
      [180, { name: 'CAMERA', side: 'bottom', type: 'passive' }],
    ]),
    ...portSide('left', hu, [[110, { name: 'DISPLAY', side: 'left', type: 'passive' }]]),
  ]
  const shapes = [
    r(0, 0, W, H, PI_GREEN, { radius: 12 }),
    ...mountHole(14, 14), ...mountHole(242, 14), ...mountHole(14, 206), ...mountHole(242, 206),
    r(24, yEven - 6, 202, yOdd - yEven + 12, BLACK, { radius: 1 }),
    ...j8Labels(holes, yEven, yOdd, PI_GREEN),
    r(240, 34, 14, 14, BLACK, { radius: 1 }),
    r(95, 82, 56, 56, METAL, { radius: 3, label: 'BCM2711', labelColor: BLACK, labelSize: 7 }),
    r(160, 86, 34, 48, CHIP, { radius: 2, label: 'RAM', labelColor: TIN, labelSize: 6 }),
    r(30, 58, 46, 30, METAL, { radius: 2, label: 'WiFi', labelColor: BLACK, labelSize: 6 }),
    ...ethernet(W, 40), ...usbStack(W, 115, BLUE), ...usbStack(W, 185, BLACK),
    r(28, H - 18, 32, 20, METAL, { radius: 5 }),
    microHdmi(102, H), microHdmi(155, H),
    ffc(174, 140, 12, 66, ''), r(198, H - 26, 26, 26, BLACK, { radius: 13 }),
    ffc(8, 84, 12, 52, ''),
    r(30, 150, 120, 14, PI_GREEN, { outline: false, label: 'Raspberry Pi 4 Model B', labelColor: SILK, labelSize: 7 }),
  ]
  write('rpi-4-model-b.json', moduleJson({
    firmware: { languages: ['python-rpi'] },
    inside: true, id: 'rpi-4-model-b', name: 'Raspberry Pi 4 Model B', category: 'Computers',
    source: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html https://pip.raspberrypi.com/documents/RP-008343-DS https://github.com/gpiozero/gpiozero/blob/master/gpiozero/pins/data.py https://pinout.xyz/',
    pins, wu, hu, holes, internal: j8Internal(holes),
    electrical: {
      model: 'computer', params: {},
      // The header's 5V pins are the board's 5 V rail, fed from the USB-C input.
      external: [{ pin: '5V', volts: 5, via: 'USB-C' }],
      usbBudget: [{ ports: ['USB3-1', 'USB3-2', 'USB2-1', 'USB2-2'], mA: 1200, note: '1.2 A across all four ports' }],
    },
    shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 2. Raspberry Pi 5 (85 x 56 mm). Mechanical drawing RP-008347-DS and gpiozero's B5 board art: at
//    the right edge, top to bottom, the USB 2.0 pair, the USB 3.0 pair (blue) and the Ethernet jack
//    (the Pi 4 order reversed; "two blue USB 3.0 ports in the middle, and two black USB 2.0 ports at
//    the top", Kennesaw State's Raspberry Pi 5 record); along the bottom, USB-C power (11.2 mm),
//    micro HDMI 0 (25.8 mm) and 1 (39.2 mm), then the two four-lane MIPI connectors, CAM/DISP 1 and
//    CAM/DISP 0 left to right (gpiozero's art labels them 1 and 0), each one pin. The supply
//    setting picks the shared USB limit: 1.6 A with a 5 A supply (the official 27 W one), 600 mA otherwise.
const CAM_DISP_NOTE = "Which connector is 0 and which is 1 rests on one source (gpiozero's board art: 1 on the left, 0 on the right); check the silkscreen on your board."
{
  const wu = 34, hu = 22, W = wu * 10, H = hu * 10, yEven = 20, yOdd = 30
  const holes = header40(30, yEven, yOdd)
  const ports = ['USB2-1', 'USB2-2', 'USB3-1', 'USB3-2']
  const pins = [
    ...portSide('right', hu, [
      [30, usbPort('USB2-1', 'right', USB2_HOST, 'USB2')], [40, usbPort('USB2-2', 'right', USB2_HOST, 'USB2')],
      [100, usbPort('USB3-1', 'right', USB3_HOST, 'USB3')], [110, usbPort('USB3-2', 'right', USB3_HOST, 'USB3')],
    ]),
    ...portSide('bottom', wu, [
      [40, usbPort('USB-C', 'bottom', { connector: 'C', gender: 'receptacle', role: 'device', draw: 800 }, 'PWR')],
      [190, { name: 'CAM/DISP 1', side: 'bottom', type: 'passive', caps: { note: CAM_DISP_NOTE } }],
      [210, { name: 'CAM/DISP 0', side: 'bottom', type: 'passive', caps: { note: CAM_DISP_NOTE } }],
    ]),
  ]
  const shapes = [
    r(0, 0, W, H, PI_GREEN, { radius: 12 }),
    ...mountHole(14, 14), ...mountHole(242, 14), ...mountHole(14, 206), ...mountHole(242, 206),
    r(24, yEven - 6, 202, yOdd - yEven + 12, BLACK, { radius: 1 }),
    ...j8Labels(holes, yEven, yOdd, PI_GREEN),
    r(30, 58, 40, 40, METAL, { radius: 2, label: 'WiFi', labelColor: BLACK, labelSize: 6 }),
    r(84, 104, 60, 50, METAL, { radius: 3, label: 'BCM2712', labelColor: BLACK, labelSize: 7 }),
    r(100, 58, 44, 30, CHIP, { radius: 2, label: 'RAM', labelColor: TIN, labelSize: 6 }),
    r(160, 62, 34, 34, CHIP, { radius: 2, label: 'RP1', labelColor: TIN, labelSize: 6 }),
    ...usbStack(W, 35, BLACK), ...usbStack(W, 105, BLUE), ...ethernet(W, 180),
    r(28, H - 18, 32, 20, METAL, { radius: 5 }),
    microHdmi(102, H), microHdmi(155, H),
    ffc(184, 148, 12, 62, ''), ffc(204, 148, 12, 62, ''),
    r(4, 70, 10, 60, BEIGE, { radius: 1 }),
    r(30, 162, 70, 14, PI_GREEN, { outline: false, label: 'Raspberry Pi 5', labelColor: SILK, labelSize: 7 }),
  ]
  write('rpi-5.json', moduleJson({
    firmware: { languages: ['python-rpi'] },
    inside: true, id: 'rpi-5', name: 'Raspberry Pi 5', category: 'Computers',
    source: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html https://pip.raspberrypi.com/documents/RP-008347-DS https://github.com/gpiozero/gpiozero/blob/master/gpiozero/pins/data.py https://pinout.xyz/ https://aegisdigitalmuseum.kennesaw.edu/items/show/300',
    pins, wu, hu, holes, internal: j8Internal(holes),
    electrical: {
      model: 'computer', params: {},
      settings: { supply: ['5V 5A (27 W)', '5V 3A'] },
      external: [{ pin: '5V', volts: 5, via: 'USB-C' }],
      usbBudget: [
        { ports, mA: 1600, setting: ['supply', '5V 5A (27 W)'], note: '1.6 A across all four ports with a 5 A supply, shared with the fan header' },
        { ports, mA: 600, setting: ['supply', '5V 3A'], note: '600 mA across all four ports with a 3 A supply, shared with the fan header' },
      ],
    },
    shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 3. Raspberry Pi Zero 2 W (65 x 30 mm, drawn 260 x 120 px). Mechanical drawing RP-008358-DS: the
//    header along the top (pin 1, the square pad, at the left of the inner row), along the bottom
//    mini HDMI (12.4 mm), the micro USB "USB" data port (41.4 mm) and the micro USB "PWR IN" (54 mm);
//    the camera connector on the right edge (gpiozero's ZERO2 art). The docs: "Raspberry Pi Zero
//    boards have one micro USB on-the-go (OTG) port", 480 Mbps: the USB port is dual, USB 2.0 high
//    speed. PWR IN is power only ("a corner port that is power-only (PWR)", Wevolver's Zero 2 W
//    guide; "no data lines exist on this port", Industrial Monitor Direct). The header ships
//    unpopulated (pads).
{
  const wu = 26, hu = 12, W = wu * 10, H = hu * 10, yEven = 20, yOdd = 30
  const holes = header40(30, yEven, yOdd)
  const pins = [
    ...portSide('bottom', wu, [
      [160, usbPort('USB', 'bottom', { connector: 'micro-B', gender: 'receptacle', role: 'dual', version: '2.0', speed: 'high' })],
      [210, usbPort('PWR IN', 'bottom', { connector: 'micro-B', gender: 'receptacle', role: 'device', power: 'only', draw: 350 })],
    ]),
    ...portSide('right', hu, [[60, { name: 'CAMERA', side: 'right', type: 'passive' }]]),
  ]
  const shapes = [
    r(0, 0, W, H, PI_GREEN, { radius: 10 }),
    ...mountHole(14, 14), ...mountHole(242, 14), ...mountHole(14, 106), ...mountHole(242, 106),
    r(24, yEven - 6, 202, yOdd - yEven + 12, PI_DARK, { radius: 1 }),
    ...j8Labels(holes, yEven, yOdd, PI_GREEN),
    r(70, 52, 50, 46, METAL, { radius: 3, label: 'RP3A0', labelColor: BLACK, labelSize: 7 }),
    r(30, 52, 30, 30, CHIP, { radius: 2 }),
    r(34, H - 22, 30, 22, METAL, { radius: 2 }),
    r(148, H - 16, 24, 18, METAL, { radius: 2 }), r(198, H - 16, 24, 18, METAL, { radius: 2 }),
    ffc(W - 14, 40, 12, 44, ''),
    r(130, 60, 96, 12, PI_GREEN, { outline: false, label: 'Raspberry Pi Zero 2 W', labelColor: SILK, labelSize: 6 }),
  ]
  write('rpi-zero-2-w.json', moduleJson({
    firmware: { languages: ['python-rpi'] },
    inside: true, id: 'rpi-zero-2-w', name: 'Raspberry Pi Zero 2 W', category: 'Computers',
    source: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html https://pip.raspberrypi.com/documents/RP-008358-DS https://github.com/gpiozero/gpiozero/blob/master/gpiozero/pins/data.py https://pinout.xyz/ https://www.wevolver.com/article/raspberry-pi-zero-2-w-pinout-comprehensive-guide-for-engineers https://industrialmonitordirect.com/blogs/knowledgebase/raspberry-pi-zero-w-2-usb-hub-not-working-fix',
    pins, wu, hu, holes, internal: j8Internal(holes),
    electrical: { model: 'computer', params: {}, external: [{ pin: '5V', volts: 5, via: 'micro USB' }] },
    shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 4. A computer's USB port: a laptop drawn small, with one USB-A host port at its right edge. USB
//    2.0, so it supplies the USB 2.0 default, 500 mA (USB 2.0 specification); a port that gives more
//    is a different part.
{
  const wu = 14, hu = 10, W = wu * 10, H = hu * 10
  const pins = portSide('right', hu, [[60, usbPort('USB', 'right', USB2_HOST)]])
  const shapes = [
    // Lid with its screen, then the base with keyboard rows; the port on the base's right side.
    r(16, 4, W - 32, 56, CASE_DARK, { radius: 4 }),
    r(22, 10, W - 44, 44, '#1B2733', { radius: 2 }),
    r(30, 18, 50, 6, '#3D6FD6', { radius: 1, outline: false }), r(30, 28, 70, 4, '#5C646E', { radius: 1, outline: false }), r(30, 36, 40, 4, '#5C646E', { radius: 1, outline: false }),
    r(2, 58, W - 4, 36, CASE, { radius: 5 }),
    ...[0, 1, 2].map((i) => r(14, 64 + i * 7, W - 40, 5, CASE_DARK, { radius: 1, outline: false })),
    r(W / 2 - 18, 86, 36, 5, CASE_DARK, { radius: 2, outline: false }),
  ]
  write('computer-usb-port.json', moduleJson({
    id: 'computer-usb-port', name: 'Computer USB port (USB 2.0, USB-A)', category: 'Computers',
    source: 'https://www.usb.org/document-library/usb-20-specification',
    pins, wu, hu, electrical: { model: 'computer', params: {} }, shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 5. Circuitneato FE1.1s USB hub (the board with four USB-A sockets; 94 x 28 mm, drawn 370 x 110 px).
//    Circuitneato's photo and "How to Use the FE1.1s USB Hub": USB-C upstream at the left end, the
//    four USB-A downstream sockets along the bottom edge numbered 4, 3, 2, 1 from the left, and a
//    2 x 3 pad block at the top right, D+ D- GND over SCL SDA 5V. The pads are the upstream bus
//    without the USB-C ("same pinout as downstream ports": 5V, D-, D+, GND) and the I2C lines for an
//    external EEPROM. The guide: the board runs "allowing up to 500mA to all of the downstream ports
//    individually, 2A combined", and "External 5V and GND pins enable supplemental power without
//    using the USB port": the 5V pad is the hub's 5 V rail, so with it wired the hub is
//    self-powered, without it every downstream draw comes through the upstream USB-C. FE1.1s data
//    sheet: USB 2.0 high speed, at most 100 mA itself (Icc, four high-speed ports).
{
  const wu = 37, hu = 11, W = wu * 10, H = hu * 10
  const down = (n) => usbPort(`P${n}`, 'bottom', { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high', source: 500 }, String(n))
  const pins = [
    ...portSide('left', hu, [[20, usbPort('USB-C', 'left', { connector: 'C', gender: 'receptacle', role: 'device', hub: 'upstream', version: '2.0', speed: 'high', draw: 100 })]]),
    ...portSide('bottom', wu, [[40, down(4)], [140, down(3)], [240, down(2)], [340, down(1)]]),
  ]
  const pad = (name, x, y, t) => ({ name, at: [[x, y]], holeStyle: 'pad', ...t })
  const holes = [
    pad('D+', 340, 20, { type: 'io' }), pad('D-', 350, 20, { type: 'io' }), pad('GND', 360, 20, { type: 'ground' }),
    pad('SCL', 340, 30, { type: 'io' }), pad('SDA', 350, 30, { type: 'io' }),
    pad('5V', 360, 30, { type: 'power_in', supply: '5V', caps: { note: `With external 5 V wired here, set the board's "Disable USB Power" jumper, which stops the hub back-feeding the host's USB port. Older red versions of this board are bus-powered only, 500 mA total for all four ports.` } }),
  ]
  const socket = (x) => [r(x - 24, H - 34, 48, 36, METAL, { radius: 2 }), r(x - 16, H - 6, 32, 6, '#8A9099', { radius: 1, outline: false })]
  const shapes = [
    r(0, 0, W, H, HUB_BLACK, { radius: 4 }),
    r(-4, 8, 30, 26, METAL, { radius: 6 }),
    ...[[70, 22], [190, 22], [190, 70], [70, 78]].flatMap(([x, y]) => [r(x - 6, y - 6, 12, 12, TIN, { radius: 6, outline: false }), r(x - 3, y - 3, 6, 6, HOLE, { radius: 3, outline: false })]),
    r(120, 12, 50, 18, CHIP, { radius: 1, label: 'FE1.1s', labelColor: TIN, labelSize: 6 }),
    ...socket(40), ...socket(140), ...socket(240), ...socket(340),
    ...[['D+', 340, 11], ['D-', 350, 11], ['GND', 360, 11], ['SCL', 340, 39], ['SDA', 350, 39], ['5V', 360, 39]].map(([t, x, y]) => r(x - 4.5, y - 3.5, 9, 7, HUB_BLACK, { outline: false, label: t, labelColor: SILK, labelSize: 3.4 })),
    r(220, 14, 90, 12, HUB_BLACK, { outline: false, label: 'Circuitneato', labelColor: SILK, labelSize: 7 }),
  ]
  write('usb-hub-fe11s-circuitneato.json', moduleJson({
    inside: true, id: 'usb-hub-fe11s-circuitneato', name: 'USB 2.0 hub board FE1.1s (Circuitneato, USB-C in, 4 x USB-A)', category: 'Connectors',
    source: 'https://circuitneato.com/how-to-use-the-fe1-1s-usb-hub/ https://circuitneato.com/media/2025/06/00032-2-1.jpg https://cdn-shop.adafruit.com/product-files/2991/FE1.1s%20Data%20Sheet%20(Rev.%201.0).pdf',
    pins, wu, hu, holes,
    electrical: {
      model: 'hub', params: {},
      usbHub: { power: { pin: '5V' } },
      usbBudget: [{ ports: ['P1', 'P2', 'P3', 'P4'], mA: 2000, note: 'the board gives 2 A combined' }],
    },
    shapes,
  }))
}

// ---------------------------------------------------------------------------------------------
// 6. A generic powered USB 2.0 hub: a USB-B upstream socket and a 5 V DC input at the left, four
//    USB-A downstream sockets at the right. With its DC input wired it is self-powered (each port
//    gives the USB 2.0 default, 500 mA); without it, bus-powered (100 mA a port, everything drawn
//    through the upstream port). Both figures are the USB 2.0 specification's.
{
  const wu = 14, hu = 14, W = wu * 10, H = hu * 10
  const down = (n) => usbPort(`P${n}`, 'right', { connector: 'A', gender: 'receptacle', role: 'host', hub: 'downstream', version: '2.0', speed: 'high' }, String(n))
  const pins = [
    ...portSide('left', hu, [
      [30, usbPort('UP', 'left', { connector: 'B', gender: 'receptacle', role: 'device', hub: 'upstream', version: '2.0', speed: 'high' })],
      [90, { name: 'DC+', side: 'left', type: 'power_in', supply: '5V' }], [100, { name: 'DC-', side: 'left', type: 'ground' }],
    ]),
    ...portSide('right', hu, [[30, down(1)], [60, down(2)], [90, down(3)], [120, down(4)]]),
  ]
  const shapes = [
    r(0, 0, W, H, CASE, { radius: 10 }),
    r(10, 10, W - 20, H - 20, CASE_DARK, { radius: 6, outline: false }),
    ...[30, 60, 90, 120].flatMap((y) => [r(W - 30, y - 9, 32, 18, METAL, { radius: 2 }), r(W - 8, y - 6, 6, 12, BLACK, { outline: false })]),
    r(-2, 20, 22, 20, METAL, { radius: 3 }), r(-2, 25, 10, 10, BLACK, { radius: 1, outline: false }),
    r(-2, 82, 20, 26, BLACK, { radius: 4, label: 'DC', labelColor: SILK, labelSize: 5 }),
    r(40, 54, 60, 32, CASE, { radius: 4, label: 'USB 2.0 HUB', labelColor: BLACK, labelSize: 6 }),
    ...[30, 60, 90, 120].map((y) => r(W - 46, y - 3, 6, 6, '#2F9E6E', { radius: 3, outline: false })),
  ]
  write('usb-hub-powered-4port.json', moduleJson({
    inside: true, id: 'usb-hub-powered-4port', name: 'Powered USB 2.0 hub, 4 ports (generic: USB-B up, 5 V DC in)', category: 'Connectors',
    source: 'https://www.usb.org/document-library/usb-20-specification',
    pins, wu, hu,
    electrical: { model: 'hub', params: {}, usbHub: { power: { pin: 'DC+' } } },
    shapes,
  }))
}

finish('gen-usb.mjs')
