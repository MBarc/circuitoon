// The defaults and category estimates the simulator uses where a part gives no number (spec 3.1,
// 3.2, 3.4, 4.7). Each is flagged `estimate` (the cable `representative`), and each row is the one
// place to replace later. The fold-back below a load's minimum voltage is a modelling choice, not
// datasheet behaviour.
import type { ModuleDef } from '../format/module.ts'
import type { Quantity, SimUnit } from '../format/simModel.ts'

const est = (value: number, unit: SimUnit, note: string): Quantity => ({ value, unit, provenance: 'estimate', note })

export const CONTACT_OHMS = est(0.02, 'ohm', 'default contact resistance of a closed switch, jumper or fuse')
export const ROUT_DEFAULT = est(0.1, 'ohm', 'default regulator output resistance')
export const IQ_DEFAULT = est(0, 'A', 'quiescent current not given; taken as 0')
export const CABLE_OHMS: Quantity = { value: 0.1, unit: 'ohm', provenance: 'representative', note: 'one conductor of a typical 1 m USB cable (spec 4.7)' }
export const PLUG_OHMS = est(0.02, 'ohm', 'a plug pushed straight into a socket: contact resistance per conductor')
export const OR_DIODE_VF = est(0.35, 'V', 'Schottky OR diode, 0.35 V at 100 mA (modelling choice)')
/** A `direct` rail input (ruling R17): 1 milliohm, never 0. */
export const RAIL_DIRECT_OHMS = 0.001
/** A load's minimum voltage when its draw gives none: 90 % of its domain's nominal (spec 3.2). */
export const MIN_VOLTS_FRACTION = 0.9
/** The unsimulated reason sim-incomplete counts (spec 3.1). */
export const NO_POWER_DATA = 'no power data'

/** The voltage-keyed fallback for a battery without its own rInternal (spec 3.1 table). */
export function cellEstimate(nominal: number): { rInternal: Quantity; assumed: string } {
  // A lithium coin cell is 2.4 V to just under 3 V; exactly 3 V is a legacy 2 x AA holder (below).
  if (nominal >= 2.4 && nominal < 3) return { rInternal: est(15, 'ohm', 'assumed a lithium coin cell'), assumed: 'lithium coin cell' }
  if (nominal === 9) return { rInternal: est(1.5, 'ohm', 'assumed an alkaline 9 V battery'), assumed: 'alkaline 9 V' }
  // Ruling R33: a voltage-keyed guess only where the series count is common: Li-ion as 1 or 2 cells,
  // alkaline as 1 to 6 (coin and 9 V are single, above). 12 V, 11.1 V (3S) and the like are unknown.
  for (let k = 1; k <= 6; k++) {
    const per = nominal / k
    const cells = `${k} cell${k > 1 ? 's' : ''} in series`
    if (k <= 2 && per >= 3.6 && per <= 4.2) return { rInternal: est(0.05 * k, 'ohm', `assumed Li-ion 18650, ${cells}, 0.05 ohm each`), assumed: 'Li-ion 18650' }
    if (per >= 1.2 && per <= 1.6) return { rInternal: est(0.15 * k, 'ohm', `assumed alkaline AA, ${cells}, 0.15 ohm each`), assumed: 'alkaline AA' }
  }
  return { rInternal: est(0.1, 'ohm', 'unknown chemistry: 0.1 ohm assumed'), assumed: 'unknown' }
}

export interface LoadEstimate { typical: Quantity; peak: Quantity & { note: string }; row: string }
const modelOf = (m: ModuleDef) => (m.electrical as { model?: unknown } | undefined)?.model
const C3_CLASS = /esp32-?c[36]/
const ROWS: { row: string; match: (m: ModuleDef) => boolean; typical: number; peak: number; note: string }[] = [
  { row: 'mcu, ESP32/ESP32-S3 class', match: (m) => modelOf(m) === 'mcu' && m.id.includes('esp32') && !C3_CLASS.test(m.id), typical: 0.08, peak: 0.5, note: 'Wi-Fi transmit bursts' },
  { row: 'mcu, ESP32-C3/C6 class', match: (m) => modelOf(m) === 'mcu' && C3_CLASS.test(m.id), typical: 0.03, peak: 0.35, note: 'radio transmit bursts' },
  { row: 'mcu, AVR/RP2040 boards', match: (m) => modelOf(m) === 'mcu', typical: 0.025, peak: 0.06, note: 'every peripheral busy' },
  { row: 'display, OLED', match: (m) => modelOf(m) === 'display' && m.id.includes('oled'), typical: 0.015, peak: 0.04, note: 'all pixels on' },
  { row: 'display, TFT with backlight', match: (m) => modelOf(m) === 'display', typical: 0.06, peak: 0.12, note: 'backlight dominates' },
  { row: 'sensor, breakout', match: (m) => modelOf(m) === 'sensor' || modelOf(m) === 'breakout', typical: 0.002, peak: 0.01, note: 'measuring' },
  { row: 'radio', match: (m) => modelOf(m) === 'radio', typical: 0.03, peak: 0.25, note: 'transmit' },
]

/** The load a powered part draws by category (spec 3.4), or null outside the table. */
export function loadEstimate(m: ModuleDef): LoadEstimate | null {
  const r = ROWS.find((x) => x.match(m))
  if (!r) return null
  return {
    row: r.row,
    typical: est(r.typical, 'A', `category estimate: ${r.row}`),
    peak: { ...est(r.peak, 'A', `category estimate: ${r.row}`), note: r.note },
  }
}
