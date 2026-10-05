// Simulation data on a module (spec 3): every new simulation value lives under one optional
// object, `electrical.sim`, so nothing that exists changes (`electrical.params` and
// `electrical.ratings` keep their meaning). Types and the parsed view here; validateSim is added
// with the sourced data (Task 16). Pure, erasable TS (npm run validate runs it under Node).
import { type ModuleDef, isObj } from './module.ts'

export type Provenance = 'datasheet' | 'representative' | 'estimate'
export const PROVENANCES: readonly Provenance[] = ['datasheet', 'representative', 'estimate']
export type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1'
/** One number with its unit and where it came from: provenance is per value, never per part. */
export interface Quantity { value: number; unit: SimUnit; source?: string; provenance: Provenance; note?: string }
export const LIMIT_KINDS = ['current', 'absMaxCurrent', 'power', 'vinMax', 'vinMin', 'sourceCurrent', 'ioTotalCurrent'] as const
export type LimitKind = (typeof LIMIT_KINDS)[number]
export interface Limit {
  of: { pin: string } | { domain: string } | { part: true }
  kind: LimitKind
  value: number
  source?: string
  provenance: Provenance
  conditions?: string
}
/** A named supply domain: a pin, its explicit return and a nominal voltage (spec 3.2). */
export interface PowerDomain { name: string; pin: string; ret: string; nominal: number }
export interface Draw { domain: string; typical: Quantity; peak?: Quantity & { note: string }; minVolts?: Quantity }
export const RAIL_KINDS = ['ldo', 'buck', 'boost', 'switch'] as const
export type RailKind = (typeof RAIL_KINDS)[number]
export interface Rail {
  id: string
  /** Several inputs: diode-OR (the highest wins) unless `direct`. */
  inputs: { domain: string; via: 'direct' | 'diode' }[]
  output: string
  kind: RailKind
  vout?: Quantity
  dropout?: Quantity
  iq?: Quantity
  ioutMax?: Quantity
  efficiency?: Quantity
  vinMin?: Quantity
  vinMax?: Quantity
  rout?: Quantity
  /** Output to input path. */
  reverse: 'blocks' | 'body-diode'
  /** Buck and boost only: input to output through the inductor and diode when disabled. */
  offPath?: 'open' | 'diode'
  minLoad?: { amps: Quantity; note: string }
  ron?: Quantity
  vf?: Quantity
}
export interface SourceSpec { domain: string; voltage: 'param:voltage' | Quantity; rInternal: Quantity; imax?: Quantity }
export interface PowerSpec { domains: PowerDomain[]; draw?: Draw[]; rails?: Rail[]; source?: SourceSpec }
export interface GpioSpec { domain: string; pins: string[]; outputResistance: Quantity; pullup?: Quantity; pulldown?: Quantity; inputLeakage?: Quantity }
export interface SimSpec {
  /** Physics: diode is, n, rs; rInternal; contactResistance; dcr. */
  modelParams?: Record<string, Quantity>
  limits?: Limit[]
  power?: PowerSpec
  gpio?: GpioSpec
  /** A USB pin's ground pin (spec 4.7). */
  usbPorts?: Record<string, { gnd: string }>
}

/** The module's `electrical.sim`, or null. Trusts validateModule (validateSim, Task 16). */
export function simOf(m: ModuleDef | undefined): SimSpec | null {
  const e = m?.electrical
  return isObj(e) && isObj(e.sim) ? (e.sim as SimSpec) : null
}
