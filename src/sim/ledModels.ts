// LED and diode models (spec 4): an LED is a diode whose IS is refitted so V = forwardVoltage at
// 20 mA, with N and RS held per colour, so forwardVoltage stays the user's knob. This table is the
// one place per-colour data lives (ruling R12). Each colour's absolute maximum and curve come from one
// representative Kingbright 5 mm datasheet. Red, green, yellow and orange keep the spike's red curve
// shape (an estimate); blue and white refit RS (N held at 3.73) through two datasheet points. Ruling R18: the body
// diode and the Schottky fit are modelling choices.
import type { DiodeModel } from './model.ts'

/** Thermal voltage at 27 C, the temperature ngspice solves at (TNOM). */
export const VT = (1.380649e-23 * 300.15) / 1.602176634e-19
export const LED_FIT_AMPS = 0.02

export interface LedColour {
  n: number
  rs: number
  /** Where N and RS come from. */
  shape: string
  /** From one representative 5 mm datasheet for the colour (`representative`, spec 3.4). */
  absMaxCurrent?: { value: number; source: string }
}
// Blue and white rise faster than the spike shape: their RS (23.3 ohm) is solved so that, with IS fitted
// at 3.3 V and 20 mA, the curve also passes 3.0 V at 10 mA. Two points fix only N*VT*ln2 + 0.01*RS, so N
// is held at the spike's 3.73 (a physical ideality) and RS takes the rest.
export const LED_COLOURS: Record<string, LedColour> = {
  red: { n: 3.73, rs: 7.5, shape: 'spike curve; limit from Kingbright WP7113ID datasheet, p. 2', absMaxCurrent: { value: 0.03, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf' } },
  green: { n: 3.73, rs: 7.5, shape: 'spike curve; limit from Kingbright WP7113GD datasheet, p. 2', absMaxCurrent: { value: 0.025, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113GD.pdf' } },
  yellow: { n: 3.73, rs: 7.5, shape: 'spike curve; limit from Kingbright WP7113YD datasheet, p. 2', absMaxCurrent: { value: 0.03, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113YD.pdf' } },
  orange: { n: 3.73, rs: 7.5, shape: 'spike curve; limit from Kingbright WP7113SED datasheet, p. 2', absMaxCurrent: { value: 0.03, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113SED.pdf' } },
  blue: { n: 3.73, rs: 23.3, shape: 'fitted to Kingbright WP7113QBC/D datasheet points: 3.0 V at 10 mA, 3.3 V at 20 mA (p. 3 graph, p. 2 table), representative', absMaxCurrent: { value: 0.03, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QBC-D.pdf' } },
  white: { n: 3.73, rs: 23.3, shape: 'fitted to Kingbright WP7113QWC/D datasheet points: 3.0 V at 10 mA, 3.3 V at 20 mA (p. 3 graph, p. 2 table), representative', absMaxCurrent: { value: 0.03, source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QWC-D.pdf' } },
}

/** The IS that puts the diode at `v` volts when `i` amps flow. */
export function fitIs(v: number, i: number, n: number, rs: number): number {
  return i / (Math.exp((v - i * rs) / (n * VT)) - 1)
}

export function diodeVoltage(m: DiodeModel, i: number): number {
  return m.n * VT * Math.log(i / m.is + 1) + i * m.rs
}

export function ledModel(colour: string | undefined, forwardVoltage: number): { model: DiodeModel; colour: string; known: boolean } {
  const key = (colour ?? 'red').trim().toLowerCase()
  const known = Object.hasOwn(LED_COLOURS, key)
  const c = known ? LED_COLOURS[key] : LED_COLOURS.red
  return { model: { is: fitIs(forwardVoltage, LED_FIT_AMPS, c.n, c.rs), n: c.n, rs: c.rs }, colour: known ? key : 'red', known }
}

/** A regulator's body diode: silicon (modelling choice). */
export const BODY_DIODE: DiodeModel = { is: 1e-12, n: 1, rs: 0.01 }

/**
 * A near-ideal diode (modelling choice): a blocking `ron` switch rail's one-way element, in series
 * with ron. N 0.01 gives about 3 mV at 50 mA; IS 0.1 uA is its reverse leakage.
 */
export const IDEAL_DIODE: DiodeModel = { is: 1e-7, n: 0.01, rs: 0 }

/** A Schottky with `vf` volts at `at` amps (N 1.05, no RS): OR inputs, off paths and `vf` switch rails. */
export function schottky(vf: number, at = 0.1): DiodeModel {
  return { is: fitIs(vf, at, 1.05, 0), n: 1.05, rs: 0 }
}

/** Newton on volts = I * ohms + V_diode(I): the test reference for an LED in series with a resistor. */
export function ledHandCalc(volts: number, ohms: number, m: DiodeModel): { amps: number; anode: number } {
  let i = 0.01
  for (let k = 0; k < 100; k++) {
    const f = i * (ohms + m.rs) + m.n * VT * Math.log(i / m.is + 1) - volts
    const df = ohms + m.rs + (m.n * VT) / (i + m.is)
    i -= f / df
  }
  return { amps: i, anode: volts - i * ohms }
}
