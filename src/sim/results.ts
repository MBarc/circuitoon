// Results (spec 5.1, 4.4): raw engine output mapped back to readings on nets and parts, the supply
// budget, and probe readings. A floating node is never a voltage; each voltage names its island's
// reference and never subtracts across the numerical joins; mains reads "undefined". Currents are
// positive into a pin; a source's current is reported as delivered. Readings outside a rail's
// model are marked, not hidden (spec 4.1, 4.2). Node ids are model.ts's (netNode for a net's
// display name, `<uid>:<pin>` taps); readings are keyed and referenced by display net names. Pure.
import type { Probe, ProbeAnchor } from '../format/diagram.ts'
import type { Provenance } from '../format/simModel.ts'
import { nodeKey } from '../format/netlist.ts'
import { type Classification, nodeState } from './floating.ts'
import { type Basis, type Circuit, type Corner, type Device, netNode } from './model.ts'
import { type RawRun, foldValue } from './spice.ts'

export type Trust = 'ok' | 'outside-model'
export type Reading = { kind: 'value'; value: number; reference: string; trust: Trust } | { kind: 'floating' } | { kind: 'undefined'; why: string }
export type CurrentReading = { kind: 'value'; value: number; trust: Trust } | { kind: 'indeterminate'; why: string }
export interface PartRun { pins: Record<string, CurrentReading>; power: Reading; state?: 'lit' | 'dark' }
export interface Run { nets: Record<string, Reading>; parts: Record<string, PartRun> }
export type SimCode =
  | 'sim-short' | 'sim-source-conflict' | 'sim-over-abs-max' | 'sim-over-limit' | 'sim-brownout' | 'sim-dropout' | 'sim-converter-off'
  | 'sim-min-load' | 'sim-outside-model' | 'sim-floating-input' | 'sim-no-convergence' | 'sim-incomplete' | 'sim-estimate'
export interface SimFinding {
  code: SimCode
  severity: 'error' | 'warning' | 'note'
  parts: string[]
  message: string
  corner?: Corner
  basis: Basis
  inputs: string[]
  raw?: string
  /** The pins a pin-level finding is about (a floating input, a pin over its limit), for the editor to mark. */
  pins?: { part: string; pin: string }[]
}
export interface DomainBudget {
  id: string
  kind: 'source' | 'rail' | 'domain'
  part: string
  label: string
  volts: { typical: Reading; peak: Reading }
  /**
   * A source: what it delivers. A rail: what its output delivers. A domain: the magnitude of the
   * current through the domain pin, whatever it feeds (the part's own draw, a rail, a pass-through).
   */
  amps: { typical: CurrentReading; peak: CurrentReading }
  /** Domain rows only: the part's own declared load on the domain (its draw, folded back at low voltage). */
  ownDraw?: { typical: CurrentReading; peak: CurrentReading }
  limit?: { value: number; kind: string; basis: Provenance | 'user' }
  headroom?: number
  basis: Basis
}
export interface ProbeReading { id: string; name?: string; at: ProbeAnchor; voltage?: { typical: Reading; peak: Reading }; part?: { typical: PartRun; peak: PartRun } }
export interface SimResult {
  format: 'circuitoon-sim/1'
  revision: number
  corners: { typical: Run; peak: Run }
  budget: DomainBudget[]
  findings: SimFinding[]
  unsimulated: { part: string; reason: string }[]
  probes: ProbeReading[]
  /** What each simulated part's data leaves out (Circuit.unaccounted), listed next to the budget. */
  unaccounted: { part: string; items: string[] }[]
  /** Notes the circuit carries (a relay shown at rest, an LED colour with no model); ruling R29. */
  notes: string[]
  engine: { name: 'ngspice'; version: string; build: string; runs: number; ms: number }
}
/**
 * A failed or unavailable outcome still carries the topological findings (a short, supplies that
 * fight, a floating input, the notes), decided before the engine runs; empty when the solve threw
 * before the circuit was built.
 */
export type SimOutcome =
  | { status: 'ok'; result: SimResult }
  | { status: 'failed'; revision: number; finding: SimFinding; findings: SimFinding[]; lastGood?: { revision: number; result: SimResult } }
  | { status: 'unavailable'; reason: string; findings: SimFinding[] }

export interface Outside { nets: Set<string>; parts: Set<string>; rails: Set<string> }
export const NO_OUTSIDE: Outside = { nets: new Set(), parts: new Set(), rails: new Set() }
/** An LED is drawn lit above this current (ruling R18). */
export const LIT_AMPS = 1e-4

const RANK = { user: 0, datasheet: 0, representative: 1, estimate: 2 } as const
/** The weakest provenance among the inputs (user = datasheet > representative > estimate); topology with none (spec 5.1). */
export function basisOf(params: { basis: Provenance | 'user' }[]): Basis {
  if (!params.length) return 'topology'
  const worst = Math.max(...params.map((p) => RANK[p.basis]))
  if (worst === 2) return 'estimate'
  if (worst === 1) return 'representative'
  return params.some((p) => p.basis === 'datasheet') ? 'datasheet' : 'user'
}

const NET = netNode('')
/** A node's display name: a net node's name, a pin tap's net, else the node id (an internal node). */
const nameOf = (c: Circuit, node: string) => (node.startsWith(NET) ? node.slice(NET.length) : (c.taps.find((t) => t.node === node)?.net ?? node))
const trustOf = (out: Outside, net: string, part?: string): Trust => (out.nets.has(net) || (part !== undefined && out.parts.has(part)) ? 'outside-model' : 'ok')
/** A solved, non-floating node's island (spec 2: islandOf includes floating nodes, which a tie gives a solver number). */
function islandOf(cls: Classification, raw: RawRun, node: string): number | undefined {
  return nodeState(cls, node) === 'floating' || raw.v[node] === undefined || !Number.isFinite(raw.v[node]) ? undefined : cls.islandOf.get(node)
}

/** A node's voltage to its island's reference, or floating (spec 4.4). */
function voltageOf(c: Circuit, cls: Classification, raw: RawRun, node: string, out: Outside, part?: string): Reading {
  const isl = islandOf(cls, raw, node)
  if (isl === undefined) return { kind: 'floating' }
  const ref = cls.islands[isl].reference
  return { kind: 'value', value: raw.v[node] - (raw.v[ref] ?? 0), reference: nameOf(c, ref), trust: trustOf(out, nameOf(c, node), part) }
}
/** The voltage between two nodes of one island, or floating. Its reference is `b`, the row's own return, not spec 4.4's island reference (which node readings name). */
function across(c: Circuit, cls: Classification, raw: RawRun, a: string, b: string, out: Outside, part?: string): Reading {
  const ia = islandOf(cls, raw, a)
  if (ia === undefined || ia !== islandOf(cls, raw, b)) return { kind: 'floating' }
  return { kind: 'value', value: raw.v[a] - raw.v[b], reference: nameOf(c, b), trust: trustOf(out, nameOf(c, a), part) }
}

export function readRun(c: Circuit, cls: Classification, raw: RawRun, out: Outside = NO_OUTSIDE): Run {
  const mains = new Set(c.mains.map((k) => c.pinNet[k]).filter((n): n is string => !!n))
  const nets: Record<string, Reading> = {}
  for (const net of [...new Set(Object.values(c.pinNet))].sort())
    nets[net] = mains.has(net) ? { kind: 'undefined', why: 'mains wiring is not simulated' } : voltageOf(c, cls, raw, netNode(net), out)
  const parts: Record<string, PartRun> = {}
  for (const uid of Object.keys(c.parts)) {
    const taps = c.taps.filter((t) => t.part === uid)
    const trust: Trust = out.parts.has(uid) ? 'outside-model' : 'ok'
    const pins: Record<string, CurrentReading> = {}
    // A floating tap carries no real current, so it is left out of the power sum (an unwired GPIO
    // never hides a board's power). Power is a value when the solved taps share one island.
    let power = 0
    const islands = new Set<number>()
    for (const t of taps) {
      const i = raw.pins[uid]?.[t.pin]
      const isl = i === undefined || !Number.isFinite(i) ? undefined : islandOf(cls, raw, t.node)
      if (isl === undefined) {
        pins[t.pin] = { kind: 'indeterminate', why: 'nothing drives this pin (floating)' }
        continue
      }
      pins[t.pin] = { kind: 'value', value: i!, trust }
      power += raw.v[t.node] * i!
      islands.add(isl)
    }
    const [only] = islands
    const run: PartRun = {
      pins,
      power: islands.size === 1
        ? { kind: 'value', value: power, reference: nameOf(c, cls.islands[only].reference), trust }
        : { kind: 'undefined', why: !taps.length ? 'not simulated' : islands.size ? 'it spans separate circuits' : 'nothing drives it (floating)' },
    }
    const led = c.devices.find((d): d is Extract<Device, { kind: 'diode' }> => d.kind === 'diode' && d.role === 'led' && d.part === uid)
    if (led) {
      const anode = c.taps.find((t) => t.node === led.a)
      const i = anode && pins[anode.pin]?.kind === 'value' ? raw.pins[uid]?.[anode.pin] : undefined
      run.state = i !== undefined && Math.abs(i) > LIT_AMPS ? 'lit' : 'dark'
    }
    parts[uid] = run
  }
  return { nets, parts }
}

const amps = (value: number | undefined, trust: Trust): CurrentReading =>
  value === undefined || !Number.isFinite(value) ? { kind: 'indeterminate', why: 'not solved (floating)' } : { kind: 'value', value, trust }

export function budget(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>, out: Outside = NO_OUTSIDE): DomainBudget[] {
  const both = <T>(f: (raw: RawRun, corner: Corner) => T) => ({ typical: f(raws.typical, 'typical'), peak: f(raws.peak, 'peak') })
  const headroom = (limit: number | undefined, a: { typical: CurrentReading; peak: CurrentReading }) =>
    limit !== undefined && a.typical.kind === 'value' && a.peak.kind === 'value' ? { headroom: limit - Math.max(Math.abs(a.typical.value), Math.abs(a.peak.value)) } : {}
  const ref = (uid: string) => c.parts[uid]?.ref ?? uid
  const rows: DomainBudget[] = []
  // Switch rails (`kind: 'switch'`: a load switch, an OR diode) compile to resistors and diodes, not
  // rail devices, so they get no row: their current shows on the domains either side.
  for (const d of c.devices) {
    if (d.kind === 'cell') {
      const lim = d.imax
      const a = both((raw) => amps(raw.dev[d.id], out.parts.has(d.part) ? 'outside-model' : 'ok'))
      rows.push({
        id: d.id, kind: 'source', part: d.part, label: `${d.role === 'cell' ? ref(d.part) : `${ref(d.part)} ${d.domain ?? 'output'}`} delivering`,
        volts: both((raw) => across(c, cls, raw, d.p, d.n, out, d.part)), amps: a,
        ...(lim ? { limit: { value: lim.value, kind: lim.label.endsWith('sourceCurrent') ? 'sourceCurrent' : 'imax', basis: lim.basis } } : {}),
        ...headroom(lim?.value, a), basis: basisOf([d.volts, d.rInternal, ...(lim ? [lim] : [])]),
      })
    }
    if (d.kind === 'rail') {
      // The rail's current is its output sense as solved: what it delivers to the outside. The 1 mA
      // internal feedback load (spice.ts FEEDBACK_LOAD) sits inside that sense, so it is not in this
      // number; the rail's input pays it, so it shows in the upstream source's row.
      const a = both((raw) => amps(raw.dev[d.id], out.rails.has(d.id) ? 'outside-model' : 'ok'))
      const r = d.rail
      rows.push({
        id: d.id, kind: 'rail', part: d.part, label: `${ref(d.part)} ${r.output} ${r.kind === 'ldo' ? 'regulator' : r.kind}`,
        volts: both((raw) => across(c, cls, raw, d.out, d.ret, out, d.part)), amps: a,
        ...(r.ioutMax ? { limit: { value: r.ioutMax.value, kind: 'ioutMax', basis: r.ioutMax.basis } } : {}),
        ...headroom(r.ioutMax?.value, a), basis: basisOf([r.vout, r.dropout, r.ioutMax, r.iq, r.rout].filter((x) => x !== undefined)),
      })
    }
  }
  for (const dom of c.domains) {
    const loads = c.devices.filter((d): d is Extract<Device, { kind: 'load' }> => d.kind === 'load' && d.part === dom.part && d.domain === dom.name)
    const volts = both((raw) => across(c, cls, raw, dom.pin, dom.ret, out, dom.part))
    const tap = c.taps.find((t) => t.node === dom.pin)
    const a = both((raw, corner) => {
      const v = volts[corner]
      const i = tap && raw.pins[tap.part]?.[tap.pin]
      return v.kind === 'value' && i !== undefined ? amps(Math.abs(i), v.trust) : amps(undefined, 'ok')
    })
    const ownDraw = both((raw, corner) => {
      const v = volts[corner]
      if (v.kind !== 'value') return amps(undefined, 'ok')
      return amps(loads.reduce((s, l) => s + (corner === 'peak' ? l.peak.value : l.typical.value) * foldValue(v.value, l.minVolts.value), 0), v.trust)
    })
    rows.push({ id: `${dom.part}.domain.${dom.name}`, kind: 'domain', part: dom.part, label: `${ref(dom.part)} ${dom.name}`, volts, amps: a, ownDraw, basis: basisOf(loads.flatMap((l) => [l.typical, l.peak])) })
  }
  return rows
}

const NOT_SIMULATED: PartRun = { pins: {}, power: { kind: 'undefined', why: 'not simulated' } }

export function probeReadings(probes: Probe[], c: Circuit, corners: { typical: Run; peak: Run }): ProbeReading[] {
  return probes.map((p) => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}), at: p.at }
    if (p.at.pin === undefined) return { ...base, part: { typical: corners.typical.parts[p.at.part] ?? NOT_SIMULATED, peak: corners.peak.parts[p.at.part] ?? NOT_SIMULATED } }
    const net = c.pinNet[nodeKey(p.at.part, p.at.pin)]
    const read = (run: Run): Reading => (net !== undefined && run.nets[net]) || { kind: 'floating' }
    return { ...base, voltage: { typical: read(corners.typical), peak: read(corners.peak) } }
  })
}
