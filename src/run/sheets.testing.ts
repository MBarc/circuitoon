// Pi 4 sheets for the run tests: a 5 V supply on the header, an LED on GPIO17 through 330 ohm, a
// push button from GPIO27 to ground; code on U1 (uid u1).
import type { Diagram } from '../format/diagram.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const withCode = (d: Diagram, source: string, file = 'main.py'): Diagram => ({ ...d, parts: d.parts.map((p) => (p.uid === 'u1' ? { ...p, code: { language: 'python-rpi', source, file } } : p)) })

export const BLINK = 'from gpiozero import LED\nfrom signal import pause\n\nled = LED(17)\nled.blink()\npause()\n'

function pi(extra: Parameters<typeof sheet>[0] = [], wires: [string, string][] = []): Diagram {
  return sheet(
    [{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 330, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }, { uid: 's1', module: 'push-button' }, ...extra],
    [['bt1.-', 'u1.GND'], ['u1.GPIO17', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND 2'], ['u1.GPIO27', 's1.1'], ['s1.2', 'u1.GND 3'], ...wires],
  )
}

export const piBlink = (source = BLINK): Diagram => withCode(pi([], [['bt1.+', 'u1.5V']]), source, 'blink.py')
export const piButton = (source: string): Diagram => withCode(pi([], [['bt1.+', 'u1.5V']]), source)
/** A second LED straight across the 5 V supply, with no resistor (a blocking finding in any state). */
export const piBareLed = (source: string): Diagram => withCode(pi([{ uid: 'd2', module: 'led' }], [['bt1.+', 'u1.5V'], ['bt1.+', 'd2.A'], ['d2.K', 'bt1.-']]), source)
/** An SG90 (M1, uid m1) on the supply, its signal on GPIO18. */
export const piServo = (source: string): Diagram =>
  withCode(pi([{ uid: 'm1', module: 'servo-sg90' }], [['bt1.+', 'u1.5V'], ['u1.GPIO18', 'm1.PWM'], ['bt1.+', 'm1.VCC'], ['bt1.-', 'm1.GND']]), source)
/** The supply reaches the Pi through a closed rocker switch (SW1, uid sw1), so a press can cut it. */
export const piSwitched = (source: string): Diagram =>
  withCode(pi([{ uid: 'sw1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }], [['bt1.+', 'sw1.1'], ['sw1.2', 'u1.5V']]), source)
