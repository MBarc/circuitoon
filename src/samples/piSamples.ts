// The Raspberry Pi samples (firmware spec 8) for the start screen: an 18650 cell and a charge-and-boost module feed the
// Pi 4's header 5V (a wall charger would need a plug and an outlet on the sheet); an LED on GPIO17 through 330 ohm;
// the second adds a push button on GPIO27 to ground, read with the internal pull-up. Each carries its code, so Run works at once.
import { type Diagram, DIAGRAM_FORMAT } from '../format/diagram.ts'
import { modulesById } from '../library.ts'

const embed = (ids: string[]) => Object.fromEntries(ids.filter((id) => modulesById[id]).map((id) => [id, modulesById[id]]))
const w = (uid: string, a: string, ap: string, b: string, bp: string, color: string) => ({ uid, from: { part: a, pin: ap }, to: { part: b, pin: bp }, color, colorSet: true as const, gauge: 22 })

const BLINK = `from gpiozero import LED
from signal import pause

led = LED(17)
led.blink()
pause()
`
const BUTTON = `from gpiozero import LED, Button
from signal import pause

led = LED(17)
button = Button(27)

button.when_pressed = led.on
button.when_released = led.off
pause()
`
const base = (title: string, source: string, file: string, extra: Diagram['parts'], wires: Diagram['connections']): Diagram => ({
  format: DIAGRAM_FORMAT,
  title,
  modules: embed(['battery-18650-cell', 'ip5306-usbc-module', 'rpi-4-model-b', 'resistor', 'led', 'push-button']),
  parts: [
    { uid: 'p1', designator: 'BT1', module: 'battery-18650-cell', x: 20, y: 10 },
    { uid: 'p6', designator: 'PS1', module: 'ip5306-usbc-module', x: 130, y: 10 },
    { uid: 'p2', designator: 'U1', module: 'rpi-4-model-b', x: 120, y: 130, code: { language: 'python-rpi', source, file } },
    { uid: 'p3', designator: 'R1', module: 'resistor', x: 520, y: 150, values: { resistance: { value: 330, unit: 'ohm' } } },
    { uid: 'p4', designator: 'D1', module: 'led', x: 620, y: 150, values: { color: 'red' } },
    ...extra,
  ],
  connections: [
    w('w8', 'p1', '+', 'p6', 'B+', 'red'), w('w9', 'p1', '-', 'p6', 'B-', 'black'),
    w('w1', 'p6', '5V+', 'p2', '5V', 'red'), w('w2', 'p6', '5V-', 'p2', 'GND', 'black'),
    w('w3', 'p2', 'GPIO17', 'p3', '1', 'yellow'), w('w4', 'p3', '2', 'p4', 'A', '#F48C06'), w('w5', 'p4', 'K', 'p2', 'GND 2', 'black'),
    ...wires,
  ],
})

export const piBlinkSample = base('Blink on a Raspberry Pi', BLINK, 'blink.py', [], [])
export const piButtonSample = base('Button lights an LED on a Pi', BUTTON, 'button.py', [{ uid: 'p5', designator: 'S1', module: 'push-button', x: 540, y: 270 }], [w('w6', 'p2', 'GPIO27', 'p5', '1', 'blue'), w('w7', 'p5', '2', 'p2', 'GND 3', 'black')])

export const PI_SAMPLES = [
  { diagram: piBlinkSample, box: { x: 0, y: 0, w: 720, h: 440 }, blurb: 'A Pi 4 blinks an LED with gpiozero. Press Run.' },
  { diagram: piButtonSample, box: { x: 0, y: 0, w: 720, h: 440 }, blurb: 'A button on GPIO27 lights the LED while it is held.' },
]
