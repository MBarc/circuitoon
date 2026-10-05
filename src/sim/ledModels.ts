// LED and diode models (spec 4): an LED is a diode whose IS is refitted so V = forwardVoltage at
// 20 mA, with N and RS held per colour, so forwardVoltage stays the user's knob. This table is the
// one place per-colour data lives (ruling R12). Until Task 20 sources each colour, every colour
// carries the spike's red curve shape (an estimate) and no absolute maximum. Ruling R18: the body
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
const SPIKE = 'the spike red LED curve (IS 93.2p, N 3.73, RS 7.5): an estimate of the shape'
export const LED_COLOURS: Record<string, LedColour> = {
  red: { n: 3.73, rs: 7.5, shape: SPIKE },
  green: { n: 3.73, rs: 7.5, shape: SPIKE },
  yellow: { n: 3.73, rs: 7.5, shape: SPIKE },
  orange: { n: 3.73, rs: 7.5, shape: SPIKE },
  blue: { n: 3.73, rs: 7.5, shape: SPIKE },
  white: { n: 3.73, rs: 7.5, shape: SPIKE },
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
