// Sample sheet for the landing page: a 9V battery lights an LED through a push button and
// a 220 ohm resistor. Uses the built-in modules, embedded like an exported diagram would.
import { type Diagram, DIAGRAM_FORMAT } from '../format/diagram.ts'
import { modulesById } from '../library.ts'

const use = ['battery-9v', 'push-button', 'resistor', 'led']

export const buttonLed: Diagram = {
  format: DIAGRAM_FORMAT,
  title: 'Button lights an LED',
  modules: Object.fromEntries(use.filter((id) => modulesById[id]).map((id) => [id, modulesById[id]])),
  parts: [
    { uid: 'p1', designator: 'BT1', module: 'battery-9v', x: 40, y: 90, values: { voltage: { value: 9, unit: 'V' } } },
    { uid: 'p2', designator: 'S1', module: 'push-button', x: 180, y: 30 },
    { uid: 'p3', designator: 'R1', module: 'resistor', x: 290, y: 30, values: { resistance: { value: 220, unit: 'ohm' } } },
    { uid: 'p4', designator: 'D1', module: 'led', x: 410, y: 30, values: { color: 'red' } },
  ],
  connections: [
    { uid: 'w1', from: { part: 'p1', pin: '+' }, to: { part: 'p2', pin: '1' }, color: 'red', gauge: 22 },
    { uid: 'w2', from: { part: 'p2', pin: '2' }, to: { part: 'p3', pin: '1' }, color: 'yellow', gauge: 22 },
    { uid: 'w3', from: { part: 'p3', pin: '2' }, to: { part: 'p4', pin: 'A' }, color: '#F48C06', gauge: 24 },
    { uid: 'w4', from: { part: 'p4', pin: 'K' }, to: { part: 'p1', pin: '-' }, color: 'black', gauge: 22,
      route: [[478, 50], [478, 14], [110, 14]] },
  ],
}

export const captions: Record<string, string> = { p1: 'BT1  9 V', p2: 'S1', p3: 'R1  220 \u2126', p4: 'D1  red' }
