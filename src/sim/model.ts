// The engine-neutral circuit (spec 2): what build.ts makes from a sheet and spice.ts compiles. A
// Device keeps its component identity and its full values; reducing it for an analysis happens in
// the compiler. Node ids are net names (nameNets), `<ref>_<pin>` singletons, `<uid>:<pin>` pin taps
// (each behind a 0 V sense, ruling R19) and `<device id>#<name>` internal nodes. Pure types.
import type { Limit, LimitKind, Provenance, RailKind } from '../format/simModel.ts'
import type { GpioState } from '../format/simState.ts'

export type Basis = Provenance | 'user' | 'topology'
export type Corner = 'typical' | 'peak'
/** Only `op` in this slice; a union so transient can be added later (spec 2). */
export type Analysis = { kind: 'op'; corner: Corner }
/** A resolved number with its provenance and the label findings list it under ("led.D1.limits.current"). */
export interface Param { value: number; basis: Provenance | 'user'; label: string; note?: string }
export interface DiodeModel { is: number; n: number; rs: number }

export interface ResolvedRail {
  id: string
  kind: RailKind
  output: string
  inputs: string[]
  vout?: Param
  dropout?: Param
  iq: Param
  ioutMax?: Param
  efficiency?: Param
  vinMin?: Param
  vinMax?: Param
  rout: Param
  reverse: 'blocks' | 'body-diode'
  offPath: 'open' | 'diode'
  minLoad?: { amps: Param; note: string }
}

export type Device =
  | { kind: 'resistor'; id: string; part: string; a: string; b: string; ohms: Param; role: 'resistor' | 'contact' | 'cable' | 'gpio' | 'pull' | 'leak' | 'rail-input' | 'switch-rail' }
  | { kind: 'diode'; id: string; part: string; a: string; k: string; model: DiodeModel; role: 'led' | 'rail-input' | 'switch-rail' }
  | { kind: 'cell'; id: string; part: string; p: string; n: string; int: string; volts: Param; rInternal: Param; imax?: Param; role: 'cell' | 'external'; domain?: string }
  | { kind: 'capacitor'; id: string; part: string; a: string; b: string; farads: number }
  | { kind: 'load'; id: string; part: string; p: string; n: string; domain: string; typical: Param; peak: Param; peakNote?: string; minVolts: Param }
  | { kind: 'rail'; id: string; part: string; rail: ResolvedRail; in: string; inRet: string; out: string; ret: string; ctl: string; o: string; outDomain: string }

/** A part pin that carries a device: its net and the pin node behind the sense. */
export interface PinTap { part: string; pin: string; net: string; node: string }
export interface SimDomain { part: string; name: string; pin: string; ret: string; nominal: number }
/** A limit to check results against, resolved to a part. */
export interface ResolvedLimit { part: string; of: Limit['of']; kind: LimitKind | 'fuse'; value: Param; conditions?: string }
export interface GpioPin { part: string; pin: string; state: GpioState | null; domain: string; key: string }
/** A USB link that carries power: the cable's two conductor devices and the host port's limit. */
export interface UsbPath { host: string; hostPort: string; device: string; devicePort: string; vbus: string; gnd: string; limit: Param }
export interface SimPart { uid: string; ref: string; designator: string; module: string; name: string; model: string }

export interface Circuit {
  /** Every net and singleton node name, sorted. */
  nets: string[]
  taps: PinTap[]
  devices: Device[]
  /** Simulated parts by uid. */
  parts: Record<string, SimPart>
  domains: SimDomain[]
  limits: ResolvedLimit[]
  gpio: GpioPin[]
  usb: UsbPath[]
  /** Net of every node key the sheet joins (and every tapped pin), for probes and floating inputs. */
  pinNet: Record<string, string>
  /** Node keys on mains wiring: never in the solver (readings say so). */
  mains: string[]
  /** Latching switch contacts that are open now, as the nets they would join (ruling R30 names the one that leaves a board unpowered). */
  openContacts: { part: string; group: string; a: string; b: string }[]
  unsimulated: { part: string; reason: string }[]
  notes: string[]
}
