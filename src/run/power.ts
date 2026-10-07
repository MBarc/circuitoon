// Power while code runs (firmware spec 4.5). Run waits for the first solve and refuses a board that is
// not powered ("U1 has no power: connect 5V and GND"); a running board stops only when one of its
// loads, at the typical corner's duty-weighted average, is under its minVolts ("U1 lost power"): a dip
// in one PWM combination is reported by the solve's findings but does not stop it, as a real Pi rides
// through on its capacitors. The decision reads the averaged budget readings, never a union finding.
// The 5V input under Raspberry Pi's documented 4.63 V warning threshold gives a note and stops
// nothing. Pure.
import type { Circuit } from '../sim/model.ts'
import type { SimResult } from '../sim/results.ts'

/** Raspberry Pi's under-voltage warning threshold, volts (ruling R8). Source: https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation/asciidoc/computers/raspberry-pi/power-supplies.adoc */
export const PI_UNDER_VOLTAGE = 4.63

export interface BoardPower {
  powered: boolean
  /** The board's 5V domain (ruling R9), or null when it has none or it floats. */
  inputVolts: number | null
  /** The load furthest under (or nearest) its minVolts, for messages; null with no load. */
  lowest: { domain: string; volts: number | null; minVolts: number } | null
}

export const NO_POWER = (ref: string): string => `${ref} has no power: connect 5V and GND`
export const LOST_POWER = (ref: string): string => `${ref} lost power`
export const underVoltageNote = (ref: string, volts: number): string =>
  `${ref}'s 5V input is at ${Number(volts.toFixed(2))} V, below the ${PI_UNDER_VOLTAGE} V where a real Raspberry Pi warns of under-voltage.`

export function boardPower(c: Circuit, r: SimResult, uid: string): BoardPower {
  const rows = r.budget.filter((b) => b.kind === 'domain' && b.part === uid)
  const volts = (domain: string) => {
    const v = rows.find((b) => b.id === `${uid}.domain.${domain}`)?.volts.typical
    return v?.kind === 'value' ? v.value : null
  }
  const loads = c.devices.filter((d): d is Extract<Circuit['devices'][number], { kind: 'load' }> => d.kind === 'load' && d.part === uid)
  let lowest: BoardPower['lowest'] = null
  let powered = loads.length > 0
  for (const l of loads) {
    const v = volts(l.domain)
    const ok = v !== null && v >= l.minVolts.value
    if (!ok) powered = false
    const margin = v === null ? -Infinity : v - l.minVolts.value
    const was = lowest ? (lowest.volts === null ? -Infinity : lowest.volts - lowest.minVolts) : Infinity
    if (margin < was) lowest = { domain: l.domain, volts: v, minVolts: l.minVolts.value }
  }
  return { powered, inputVolts: volts('5V'), lowest }
}

export const underVoltage = (p: BoardPower): boolean => p.inputVolts !== null && p.inputVolts < PI_UNDER_VOLTAGE
