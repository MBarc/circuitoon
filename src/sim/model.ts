// The engine-neutral circuit (spec 2): what build.ts makes from a sheet and spice.ts compiles. A
// Device keeps its component identity and its full values; reducing it for an analysis happens in
// the compiler. Node ids are `net:<name>` nets (netNode; names are sheetNets names or `<ref>_<pin>`
// singletons, user text that must never meet a pin id), `<uid>:<pin>` pin taps (each behind a 0 V
// sense, ruling R19; a USB port's `<port>#vbus` is a pin here) and `<device id>#<name>` internal
// nodes. Types, plus netNode and gpioBranch.
import type { Limit, LimitKind, Provenance, RailKind } from '../format/simModel.ts'
import type { GpioState } from '../format/simState.ts'

/**
 * The node id of the net with this display name. Names are user text (a label "d1:A"), so the
 * prefix keeps them apart from `<uid>:<pin>` taps.
 */
// ponytail: collides only with a part whose uid is literally "net"; editor uids are p<N>. Escape uids if that ever matters.
export const netNode = (name: string): string => `net:${name}`

export type Basis = Provenance | 'user' | 'topology'
export type Corner = 'typical' | 'peak'
/** Only `op` in this slice; a union so transient can be added later (spec 2). `classify` takes only the kind. */
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

/**
 * A switch, relay or SSR contact: one per pole and throw (`no`: com to no, `nc`: com to nc), at its
 * saved position. Closed, it conducts through `ron` (the contact resistance); open, it is no element
 * at all (spec 4 table). `latching`: a switch the user sets (not a button, relay or SSR); its open
 * `no` contacts are what ruling R30 may name.
 */
export interface SwitchDevice { kind: 'switch'; id: string; part: string; group: string; contact: 'no' | 'nc'; latching: boolean; a: string; b: string; closed: boolean; ron: Param }
/**
 * A GPIO pin (spec 4.6): its state and the values every state compiles from, so a state change is a
 * parameter change. `node` is the pin tap, `vdd` and `ret` the IO domain's pin and return nodes.
 * `leakage` is the input leakage as a resistance (derived), absent when the board states none.
 */
export interface GpioDevice {
  kind: 'gpio'; id: string; part: string; pin: string; node: string; vdd: string; ret: string; domain: string; state: GpioState
  params: { outputResistance: Param; pullup?: Param; pulldown?: Param; leakage?: Param }
}

export type Device =
  | { kind: 'resistor'; id: string; part: string; a: string; b: string; ohms: Param; role: 'resistor' | 'contact' | 'cable' | 'rail-input' | 'switch-rail' }
  | { kind: 'diode'; id: string; part: string; a: string; k: string; model: DiodeModel; role: 'led' | 'rail-input' | 'switch-rail' }
  | { kind: 'cell'; id: string; part: string; p: string; n: string; int: string; volts: Param; rInternal: Param; imax?: Param; role: 'cell' | 'external'; domain?: string }
  | { kind: 'capacitor'; id: string; part: string; a: string; b: string; farads: number }
  | { kind: 'load'; id: string; part: string; p: string; n: string; domain: string; typical: Param; peak: Param; peakLabel?: string; minVolts: Param }
  | { kind: 'rail'; id: string; part: string; rail: ResolvedRail; in: string; inRet: string; out: string; ret: string; ctl: string; o: string; outDomain: string }
  | SwitchDevice
  | GpioDevice

/**
 * The one resistor a GPIO pin's state compiles to (spec 4.6), or null: the output resistance from
 * the IO domain (high) or to its return (low), a pull, else the input leakage to the return.
 * `leak` marks the leakage, which is never a DC path (spec 2).
 */
export function gpioBranch(d: GpioDevice): { a: string; b: string; ohms: Param; leak: boolean } | null {
  const p = d.params
  if (d.state === 'high') return { a: d.vdd, b: d.node, ohms: p.outputResistance, leak: false }
  if (d.state === 'low') return { a: d.node, b: d.ret, ohms: p.outputResistance, leak: false }
  if (d.state === 'input-pullup' && p.pullup) return { a: d.vdd, b: d.node, ohms: p.pullup, leak: false }
  if (d.state === 'input-pulldown' && p.pulldown) return { a: d.node, b: d.ret, ohms: p.pulldown, leak: false }
  return p.leakage ? { a: d.node, b: d.ret, ohms: p.leakage, leak: true } : null
}

/** A part pin that carries a device: its net (display name; the net node is netNode(net)) and the pin node behind the sense. */
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
  /** Every sheet part's reference by uid, simulated or not (findings name unsimulated parts too). */
  refs: Record<string, string>
  domains: SimDomain[]
  limits: ResolvedLimit[]
  gpio: GpioPin[]
  usb: UsbPath[]
  /** Net of every node key the sheet joins (and every tapped pin), for probes and floating inputs. */
  pinNet: Record<string, string>
  /** Node keys on mains wiring: never in the solver (readings say so). */
  mains: string[]
  /**
   * Latching switch groups at rest, from the switch devices: every open `no` contact of a part's
   * group (all its poles, closed together), as pin node pairs. Ruling R30 names the one that leaves a
   * board unpowered.
   */
  openContacts: { part: string; group: string; pairs: [string, string][] }[]
  unsimulated: { part: string; reason: string }[]
  /** Node keys of connector pins that lead off the sheet (build.ts connector()): an input on their net is driven from elsewhere. */
  offSheet: string[]
  /** What each simulated part's data leaves out (its sim.unaccounted), for the budgets to list. */
  unaccounted: { part: string; items: string[] }[]
  notes: string[]
}

/** Taps and devices by part uid, and taps by pin node and by net name: lookups the results and findings repeat per part. */
export interface CircuitIndex { tapsOf: Map<string, PinTap[]>; devicesOf: Map<string, Device[]>; tapAt: Map<string, PinTap>; tapsOn: Map<string, PinTap[]> }
const indexes = new WeakMap<Circuit, CircuitIndex>()
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}
/** The circuit's index, built once per circuit (a circuit is never changed after build). */
export function indexOf(c: Circuit): CircuitIndex {
  let ix = indexes.get(c)
  if (!ix) {
    ix = { tapsOf: new Map(), devicesOf: new Map(), tapAt: new Map(), tapsOn: new Map() }
    for (const t of c.taps) {
      push(ix.tapsOf, t.part, t)
      push(ix.tapsOn, t.net, t)
      ix.tapAt.set(t.node, t)
    }
    for (const d of c.devices) push(ix.devicesOf, d.part, d)
    indexes.set(c, ix)
  }
  return ix
}
