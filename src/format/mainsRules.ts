// The mains rules (spec section 3). Per-state rules run for every enumerated contact state of one
// enumeration unit and report findings by a stable key; each finding keeps one bit per state it holds
// in, so its wording names exactly the conditions it needs (Resolution 24). Static rules run once
// afterwards on what the states established (which nodes were ever hazardous, at what voltage). Pure.
import type { Endpoint } from './diagram.ts'
import type { RuleId } from './checks.ts'
import { nodeKey } from './netlist.ts'
import { type GConverter, type GEdge, type GSource, type GTerm, type MainsGraph, type Prepared, LN_MASK, PE_MASK, bitOf, decodeSingle, identAt, minimalWitnesses, statePhrase, termAt, termName } from './mainsGraph.ts'
import { type Conductor, isolationAdequate } from './mainsModel.ts'
import { andList, natural } from './words.ts'

export interface MainsDraft {
  rule: RuleId
  subject: string
  target: string
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
  causes: string[]
  select?: { parts: string[]; wires: string[] }
}
export type Availability = 'powered' | 'unpowered' | 'unknown'
/**
 * Why a converter is unknown, which decides what the user is told to do: `wiring` (rewire the input),
 * `fuse` (an input reaches the outlet only through an empty holder), `voltage` (the source is outside
 * its input range: replace it, never rewire), `incomplete` (the checks did not finish: check by hand).
 */
export type UnknownKind = 'wiring' | 'fuse' | 'voltage' | 'incomplete'
/** A converter's availability, why it is not powered, and the one action that fixes it (null when powered or unpowered). */
export interface ConverterStatus { state: Availability; why: string | null; kind: UnknownKind | null; fix: string | null }
/** One bit per state a finding holds in, and its builder (given the state phrase). */
interface Sighting { holds: Uint32Array; build: (when: string) => MainsDraft }
export interface Acc {
  p: Prepared
  cands: number[]
  total: number
  seen: Map<string, Sighting>
  /** Per node: hazardous in at least one state. */
  hazardAny: Uint8Array
  /** Per node: the highest voltage of a source that made it hazardous. */
  volts: Float64Array
  /** Per node: every identity bit it had in any state (Resolution 19 reads it). */
  identUnion: Uint32Array
  /** Per converter (global index): availability over the states seen. */
  converters: (ConverterStatus | null)[]
  /** Per load (global index): L and N of one source across it in some state as drawn; and with every empty fuse holder taken as fitted. */
  loadComplete: Uint8Array
  loadFit: Uint8Array
  /** Per load (global index): the empty fuse holders whose fitting alone puts L and N of one source across it in some enumerated (so realizable) contact state (Resolution 28). */
  loadFixers: Map<number, Set<GEdge['part']>>
  incomplete: 'groups' | 'sources' | null
  /** Drafts of the units already enumerated (see absorb). */
  finished: MainsDraft[]
  /** The distinct sources of `p` (global index), each one's L and N bits and its voltage, highest first: fixed per unit, so a state allocates nothing. */
  srcIdx: Int32Array
  srcLN: Uint32Array
  srcVolts: Float64Array
}

export function newAcc(p: Prepared, cands: number[], incomplete: 'groups' | 'sources' | null): Acc {
  const g = p.g
  return {
    p, cands, total: incomplete ? 0 : 2 ** cands.length, seen: new Map(),
    hazardAny: new Uint8Array(g.n), volts: new Float64Array(g.n), identUnion: new Uint32Array(g.n),
    converters: g.converters.map(() => null), loadComplete: new Uint8Array(g.loads.length), loadFit: new Uint8Array(g.loads.length), loadFixers: new Map(),
    incomplete, finished: [], ...sourceTable(p),
  }
}

function sourceTable(p: Prepared): Pick<Acc, 'srcIdx' | 'srcLN' | 'srcVolts'> {
  const idx = [...new Set(p.sources.map((s) => s.index))].sort((a, b) => p.g.sources[b].volts - p.g.sources[a].volts)
  return {
    srcIdx: Int32Array.from(idx),
    srcLN: Uint32Array.from(idx.map((i) => bitOf(i, 'L') | bitOf(i, 'N'))),
    srcVolts: Float64Array.from(idx.map((i) => p.g.sources[i].volts)),
  }
}

/** Records that a finding holds in state `mask`. `first` runs only the first time (while that state is still in `p`) and returns the builder. */
export function report(acc: Acc, key: string, mask: number, first: () => (when: string) => MainsDraft): void {
  let s = acc.seen.get(key)
  if (!s) acc.seen.set(key, (s = { holds: new Uint32Array(Math.max(1, Math.ceil(acc.total / 32))), build: first() }))
  s.holds[mask >>> 5] |= 1 << (mask & 31)
}

/**
 * Records state `mask` for a finding already seen and returns true; false when `key` is new (the
 * caller then calls `report` with its builder). Allocates nothing, so a per-state rule can check its
 * findings without making a closure each state.
 */
export function mark(acc: Acc, key: string, mask: number): boolean {
  const s = acc.seen.get(key)
  if (!s) return false
  s.holds[mask >>> 5] |= 1 << (mask & 31)
  return true
}

export const volt = (v: number) => `${Number(v.toFixed(1))} V`
export const endpointOf = (t: GTerm): Endpoint => ({ part: t.part.uid, pin: t.name })
export const pinOfKey = (key: string): Endpoint => {
  const [part, pin] = JSON.parse(key) as [string, string]
  return { part, pin }
}
/** The sources (by global index) holding L or N in identity `x`, or energizing with `e`. */
export function sourcesIn(p: Prepared, x: number, e: number): number[] {
  return [...new Set(p.sources.map((s) => s.index))].filter((i) => x & (bitOf(i, 'L') | bitOf(i, 'N')) || (e >> i) & 1)
}
/** "XS1 (120 V)", "XS1 (120 V) and XS2 (230 V)". */
export const sourcesText = (g: MainsGraph, list: number[]) => andList(list.map((s) => `${g.sources[s].part.designator} (${volt(g.sources[s].volts)})`))
/** The wires on every node whose root is `r` in the current state. */
export function wiresOfRoot(p: Prepared, r: number): string[] {
  const out: string[] = []
  for (const i of p.relevant) if (p.root[i] === r) out.push(...p.g.wires[i])
  return out
}

/** Per state, on the hot path: no allocation, and no source loop for a node already at the highest voltage. */
function track(acc: Acc) {
  const { p, srcIdx, srcLN, srcVolts } = acc
  const top = srcVolts.length ? srcVolts[0] : 0
  const rel = p.relevant
  for (let k = 0; k < rel.length; k++) {
    const i = rel[k]
    const r = p.root[i]
    const x = p.ident[r]
    const e = p.power[r]
    acc.identUnion[i] |= x
    if (!(x & LN_MASK) && !e) continue
    acc.hazardAny[i] = 1
    if (acc.volts[i] >= top) continue
    // Highest voltage first: the first source that makes the node hazardous sets it.
    for (let j = 0; j < srcIdx.length; j++)
      if (x & srcLN[j] || (e >> srcIdx[j]) & 1) {
        if (srcVolts[j] > acc.volts[i]) acc.volts[i] = srcVolts[j]
        break
      }
  }
}

const POWERED: ConverterStatus = { state: 'powered', why: null, kind: null, fix: null }
export const UNPOWERED: ConverterStatus = { state: 'unpowered', why: null, kind: null, fix: null }
const rewire = (c: GConverter) => (c.plugIn ? 'Plug it fully into one outlet.' : `Wire ${c.names[0]} and ${c.names[1]} to L and N of one outlet.`)
const wiring = (c: GConverter, why: string): ConverterStatus => ({ state: 'unknown', why, kind: 'wiring', fix: rewire(c) })
/** The status of a converter whose input the enumeration never reached (Resolution 11). */
const notChecked = (c: GConverter): ConverterStatus => ({ state: 'unknown', why: 'the mains checks did not finish', kind: 'incomplete', fix: `Check ${c.part.designator}'s input by hand.` })

/** A converter's input in the current state (spec 1.3). */
export function inputState(p: Prepared, c: GConverter): ConverterStatus {
  const ra = p.root[c.a]
  const rb = p.root[c.b]
  const ia = p.ident[ra]
  const ib = p.ident[rb]
  if (!ia && !ib) return !p.power[ra] && !p.power[rb] ? UNPOWERED : wiring(c, 'it gets mains only through a load or a leakage path')
  if (ra === rb) return wiring(c, 'its two inputs are joined to each other')
  if (!ia || !ib) return oneInput(p, c, ia ? 1 : 0)
  const single = (x: number) => (x & (x - 1)) === 0
  const sourceCount = (x: number) => p.g.sources.filter((s) => x & (bitOf(s.index, 'L') | bitOf(s.index, 'N') | bitOf(s.index, 'PE'))).length
  if (!single(ia) || !single(ib)) return wiring(c, sourceCount(ia | ib) > 1 ? 'its inputs come from two different outlets' : 'an input is on more than one conductor')
  const a = decodeSingle(ia)
  const b = decodeSingle(ib)
  if (a.s !== b.s) return wiring(c, 'its inputs come from two different outlets')
  if (a.c === b.c) return wiring(c, `both inputs are on ${a.c}`)
  if (a.c === 'PE' || b.c === 'PE') return wiring(c, 'an input is on earth')
  const v = p.g.sources[a.s].volts
  if (v < c.range[0] || v > c.range[1])
    return { state: 'unknown', why: `it takes ${volt(c.range[0])} to ${volt(c.range[1])} AC but gets ${volt(v)}`, kind: 'voltage', fix: `Use a converter rated for ${volt(v)} in place of ${c.part.designator}.` }
  return POWERED
}

/** Input `side` (0 or 1) has no identity: it reaches the outlet only through a load or leakage, only through an empty fuse holder, or not at all. */
function oneInput(p: Prepared, c: GConverter, side: 0 | 1): ConverterStatus {
  const x = side ? c.b : c.a
  const name = c.names[side]
  if (throughLoad(p, c, x)) return wiring(c, `${name} reaches the outlet only through a load or a leakage path`)
  if (p.anyAbsent && p.sources.some((s) => s.live.some((t) => p.fitRoot[t] === p.fitRoot[x]) || s.neutral.some((t) => p.fitRoot[t] === p.fitRoot[x])))
    return { state: 'unknown', why: `${name} reaches the outlet only through an empty fuse holder`, kind: 'fuse', fix: 'Fit a fuse in the empty holder.' }
  return wiring(c, `only ${c.names[side ? 0 : 1]} is connected to an outlet`)
}

/**
 * True when node `x` reaches a node with identity through loads and leakage paths (an OFF SSR
 * included) in the current state, never through the converter's own input: energy on `x` that only
 * came across the converter itself is not a path to the outlet.
 */
function throughLoad(p: Prepared, c: GConverter, x: number): boolean {
  const g = p.g
  const seen = new Set([p.root[x]])
  const queue = [p.root[x]]
  const step = (a: number, b: number) => {
    const [ra, rb] = [p.root[a], p.root[b]]
    for (const [from, to] of [[ra, rb], [rb, ra]]) if (seen.has(from) && !seen.has(to)) {
      seen.add(to)
      queue.push(to)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    if (p.ident[queue[q]]) return true
    for (const e of p.energy) if ((e.kind === 'load' || e.kind === 'leakage') && !(e.part === c.part && e.a === c.a && e.b === c.b)) step(e.a, e.b)
    for (const gi of p.groupIdx) for (const [a, b] of g.groups[gi].leak[p.groupState[gi]]) if (p.inRel[a] && p.inRel[b]) step(a, b)
  }
  return false
}

/**
 * How a load fed only by unknown converters is told about them (checks.ts, supply-unknown): what is
 * wrong with their inputs and what to do, grouped by kind, converters in designator order.
 */
export function unknownFeedWords(list: { designator: string; status: ConverterStatus }[]): { state: string; fix: string } {
  const sorted = [...list].sort((a, b) => natural.compare(a.designator, b.designator))
  const of = (kinds: UnknownKind[]) => sorted.filter((x) => kinds.includes(x.status.kind ?? 'wiring'))
  const poss = (xs: typeof sorted) => andList(xs.map((x) => `${x.designator}'s`))
  const states: string[] = []
  const fixes: string[] = []
  const bad = of(['wiring', 'fuse'])
  if (bad.length) {
    states.push(bad.length === 1 ? `${poss(bad)} mains input is not a complete connection` : `${poss(bad)} mains inputs are not complete connections`)
    fixes.push(`Complete ${poss(bad)} mains input${bad.length === 1 ? '' : 's'} first.`)
  }
  const volts = of(['voltage'])
  if (volts.length) {
    states.push(volts.length === 1 ? `${poss(volts)} mains input is outside its rating` : `${poss(volts)} mains inputs are outside their ratings`)
    fixes.push(...volts.map((x) => x.status.fix!))
  }
  const open = of(['incomplete'])
  if (open.length) {
    states.push(`the mains checks did not finish for ${andList(open.map((x) => x.designator))}`)
    fixes.push(`Check ${poss(open)} input${open.length === 1 ? '' : 's'} by hand.`)
  }
  return { state: andList(states), fix: fixes.join(' ') }
}

/** Powered in any state wins; unknown wins over unpowered (keeping the first unknown reason); unpowered only when so in every state. */
function combine(cur: ConverterStatus | null, st: ConverterStatus): ConverterStatus {
  if (!cur) return st
  if (cur.state === 'powered') return cur
  if (st.state === 'powered') return st
  return cur.state === 'unpowered' && st.state === 'unknown' ? st : cur
}

function availabilityRule(acc: Acc) {
  for (const i of acc.p.converterIdx) acc.converters[i] = combine(acc.converters[i], inputState(acc.p, acc.p.g.converters[i]))
}

export const STATE_RULES: ((acc: Acc, mask: number) => void)[] = [availabilityRule]

// ---- Rule 1: mains reaching low-voltage wiring (spec 1.3, 1.4) ----

export type LvClass = 'ordinary' | 'separated' | 'secondary'

/** A converter's pin outside every domain and not declared for mains: its data does not say how it is separated (Resolution 27). */
const uncovered = (t: GTerm) => !!t.info.acInput && !t.info.domainOf.has(t.name) && !t.info.terminals.has(t.name)

/**
 * How a terminal counts when mains reaches it: a pin of a part with no mains data (a GPIO, a
 * breadboard strip) or an undeclared pin of a mains part is ordinary; a pin in a non-mains domain is
 * separated (protective separation) or a secondary without it, as is a converter's pin outside every
 * domain (Resolution 27); null for a terminal the module declares for mains (the rating rules take
 * it). Whether a separated side is SELV or PELV is decided per state by `effectiveClass`, never by the
 * domain's label (Resolution 9).
 */
export function lvClass(t: GTerm): LvClass | null {
  if (!t.info.any) return 'ordinary'
  const dom = t.info.domainOf.get(t.name)
  if (dom && dom.kind !== 'mains') return isolationAdequate(t.info) ? 'separated' : 'secondary'
  if (uncovered(t)) return 'secondary'
  return t.info.terminals.has(t.name) ? null : 'ordinary'
}

/** The analysed nodes of a part's declared bonds (`bond: "pe"`). */
const bondNodes = (p: Prepared, t: GTerm): number[] =>
  [...t.info.bonds].map((b) => p.g.nodeOf.get(nodeKey(t.part.uid, b))).filter((i): i is number => i !== undefined && p.inRel[i] === 1)

/** Spec 1.3, Resolution 9: PELV in this state when one of the part's declared bonds sits on PE identity, SELV otherwise. */
export function effectiveClass(p: Prepared, t: GTerm): 'SELV' | 'PELV' {
  return bondNodes(p, t).some((i) => identAt(p, i) & PE_MASK) ? 'PELV' : 'SELV'
}

/** The analysed nodes of a part's own mains side: its mains domain pins, else its converter input (as the graph's energize edges start from). */
function primaryNodes(p: Prepared, t: GTerm): number[] {
  const mains = t.info.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins)
  const names = mains.length ? mains : t.info.acInput ? [t.info.acInput.a, t.info.acInput.b] : []
  return names.map((n) => p.g.nodeOf.get(nodeKey(t.part.uid, n))).filter((i): i is number => i !== undefined && p.inRel[i] === 1)
}

interface Watch {
  node: number
  /** The low-voltage terminals on the node, in designator order. */
  terms: GTerm[]
  /** The worst class among them. */
  cls: LvClass
  /** The first separated terminal (whose part's bonds decide SELV or PELV), and those bond nodes. */
  sep: GTerm | null
  bonds: Int32Array
  /** For a secondary: the nodes of its part's own mains side (mains domain pins, or its input). Mains reaching the node while none of these carries any was wired there. */
  primary: Int32Array
  /** The finding key per (source mask, PELV bit, direct bit), made once so a state allocates nothing. */
  keys: Map<number, string>
}
const watchCache = new WeakMap<Prepared, Watch[]>()
/** The relevant nodes holding a low-voltage terminal, with those terminals (sorted) and the worst class among them. Once per view. */
function watchList(p: Prepared): Watch[] {
  let list = watchCache.get(p)
  if (list) return list
  list = []
  for (const i of p.relevant) {
    const classed = p.g.members[i].flatMap((k) => {
      const t = termAt(p.g, k)
      const c = t && lvClass(t)
      return t && c ? [{ t, c }] : []
    })
    if (!classed.length) continue
    const cls = (['secondary', 'separated', 'ordinary'] as const).find((c) => classed.some((x) => x.c === c))!
    const sep = cls === 'separated' ? classed.find((x) => x.c === 'separated')!.t : null
    list.push({
      node: i, terms: classed.map((x) => x.t).sort((a, b) => natural.compare(termName(a), termName(b))), cls,
      sep, bonds: Int32Array.from(sep ? bondNodes(p, sep) : []), primary: Int32Array.from(cls === 'secondary' ? primaryNodes(p, classed.find((x) => x.c === 'secondary')!.t) : []), keys: new Map(),
    })
  }
  watchCache.set(p, list)
  return list
}

/**
 * The wires on the ways energy reaches net `node` in the current state (spec 3: a path finding
 * highlights the path, not only where it ends; Ruling 33). For each of the given sources (every source
 * when omitted) and each of its conductors L and N, a shortest chain of nets from that conductor's
 * nets to `node`, over what conducts in this state (closed contacts, fitted fuses) and what carries
 * energy (loads, leakage, energize edges, one way across a barrier). The search from one conductor
 * never continues from a net that carries the source's other conductor: that search covers it, and
 * going on would route through unrelated loads. Nets, not roots, so a switch that is on elsewhere
 * adds nothing. Runs for a bounded number of states per finding, never on every state.
 */
export function energyPathWires(p: Prepared, node: number, from?: number[]): string[] {
  const g = p.g
  const both = (a: number, b: number) => p.inRel[a] === 1 && p.inRel[b] === 1
  const links: [number, number, boolean][] = [
    ...p.energy.map((e): [number, number, boolean] => [e.a, e.b, e.directed]),
    ...p.protective.filter((e) => e.fitted && both(e.a, e.b)).map((e): [number, number, boolean] => [e.a, e.b, false]),
    ...p.groupIdx.flatMap((gi) => [...g.groups[gi].closed[p.groupState[gi]], ...g.groups[gi].leak[p.groupState[gi]]]
      .filter(([a, b]) => both(a, b)).map(([a, b]): [number, number, boolean] => [a, b, false])),
  ]
  const on = new Set<number>([node])
  for (const s of p.sources) {
    if (from && !from.includes(s.index)) continue
    for (const [nodes, other] of [[s.live, bitOf(s.index, 'N')], [s.neutral, bitOf(s.index, 'L')]] as const) {
      const prev = new Map<number, number>()
      const queue: number[] = []
      for (const x of nodes) if (!prev.has(x)) {
        prev.set(x, -1)
        queue.push(x)
      }
      for (let q = 0; q < queue.length && !prev.has(node); q++) {
        const x = queue[q]
        if (prev.get(x) !== -1 && p.ident[p.root[x]] & other) continue
        for (const [a, b, directed] of links) {
          const next = a === x ? b : !directed && b === x ? a : -1
          if (next >= 0 && !prev.has(next)) {
            prev.set(next, x)
            queue.push(next)
          }
        }
      }
      for (let x = prev.has(node) ? node : -1; x !== -1; x = prev.get(x)!) on.add(x)
    }
  }
  return [...on].flatMap((i) => g.wires[i])
}

/** Why a secondary terminal counts as mains, and what to use instead, by the kind of part it belongs to. `also` when a wire already brings mains there. */
function secondaryWords(t: GTerm, also: boolean): { cause: string; counts: string; fix: string } {
  const d = t.part.designator
  const iso = t.info.isolation
  const a = also ? 'also ' : ''
  if (uncovered(t))
    return { cause: `${d}'s data ${a}does not state how ${termName(t)} is separated from mains`, counts: 'that pin', fix: 'use a part whose datasheet states how every pin is separated from mains.' }
  const contact = t.info.contacts[0]?.kind
  if (contact) {
    const sides = contact === 'ssr' ? 'its control side and its load side' : 'its coil and its contacts'
    const how = iso === 'basic' ? 'only basic' : iso === 'none' ? 'missing' : 'unknown'
    return { cause: `${d}'s insulation between ${sides} is ${a}${how}`, counts: 'that side', fix: 'use a relay or SSR whose datasheet states reinforced or double insulation.' }
  }
  const how = iso === 'basic' ? 'basic insulation' : iso === 'none' ? 'no insulation at all' : 'insulation of unknown quality'
  return { cause: `${d}'s low-voltage side is ${a}separated from mains only by ${how}`, counts: 'that side', fix: 'use a converter with reinforced or double isolation.' }
}

/**
 * Rule 1's words. A secondary reached only across its own part's barrier says why that side counts as
 * mains; mains that a wire brings onto the node (L or N identity there) is said directly, with the
 * secondary's reason added when there is one.
 */
function lowVoltageDraft(w: Watch, direct: boolean, from: string, effective: 'SELV' | 'PELV', sourceKeys: string[], wires: string[], when: string): MainsDraft {
  const names = andList(w.terms.map(termName))
  const one = w.terms.length === 1
  const lead = w.terms[0]
  const sec = w.cls === 'secondary' ? secondaryWords(w.terms.find((t) => lvClass(t) === 'secondary')!, direct) : null
  let message: string
  if (sec && !direct) {
    message = `${sec.cause}, so ${names} may be live${when}: ${sec.counts} counts as mains. Do not wire it to anything a person can touch; ${sec.fix}`
  } else if (w.cls === 'separated') {
    message = `${names} ${one ? 'is' : 'are'} on a ${effective} low-voltage side that must never meet mains, but ${one ? 'gets' : 'get'} mains from ${from}${when}. Remove the wire that joins ${one ? 'it' : 'them'} to mains.`
  } else {
    const parts = [...new Set(w.terms.filter((t) => lvClass(t) === 'ordinary').map((t) => t.part.designator))]
    const single = parts.length === 1
    const harm = parts.length ? ` ${andList(parts)} ${single ? 'is a low-voltage part' : 'are low-voltage parts'}: ${single ? 'it' : 'they'} may be destroyed, and anything touching ${single ? 'it' : 'them'} may become live.` : ''
    message = sec
      ? `${names} ${one ? 'gets' : 'get'} mains from ${from}${when}.${harm} Remove the wire that brings mains there. ${sec.cause}, so it counts as mains even without that wire: do not wire it to anything a person can touch; ${sec.fix}`
      : `${names} ${one ? 'gets' : 'get'} mains from ${from}${when}.${harm} Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.`
  }
  return { rule: 'mains-to-low-voltage', subject: lead.part.designator, target: termName(lead), message, parts: [...new Set(w.terms.map((t) => t.part.uid))], pins: w.terms.map(endpointOf), wires, causes: [...w.terms.map((t) => t.key), ...sourceKeys] }
}

/** The sources (global index, ascending) of a source mask. */
const sourcesOfMask = (m: number): number[] => {
  const out: number[] = []
  for (let i = 0; m >>> i; i++) if ((m >>> i) & 1) out.push(i)
  return out
}

/** A finding's highlight gathers the energizing paths of up to this many of the states it holds in (Ruling 33); past it a state costs one check. */
const PATH_STATES = 32
interface PathRec { states: number; wires: Set<string> }
const pathCache = new WeakMap<Acc, Map<string, PathRec>>()

/** Rule 1, per state: a hazardous node holding a low-voltage terminal. Allocation-free once a finding has its paths. */
function lowVoltageRule(acc: Acc, mask: number) {
  const { p, srcIdx, srcLN } = acc
  let paths = pathCache.get(acc)
  if (!paths) pathCache.set(acc, (paths = new Map()))
  for (const w of watchList(p)) {
    const r = p.root[w.node]
    const x = p.ident[r] & LN_MASK
    const e = p.power[r]
    if (!x && !e) continue
    // Resolution 24: the key holds the whole claim (terminals, sources, effective class, and for a
    // secondary whether a wire brings mains there), so each claim keeps its own conditions and path.
    let sm = 0
    for (let j = 0; j < srcIdx.length; j++) if (x & srcLN[j] || (e >> srcIdx[j]) & 1) sm |= 1 << srcIdx[j]
    let pelv = 0
    for (let b = 0; b < w.bonds.length && !pelv; b++) if (p.ident[p.root[w.bonds[b]]] & PE_MASK) pelv = 1
    // A secondary is reached directly when a wire brings L or N there, or when its own mains side carries nothing in this state.
    let direct = w.cls === 'secondary' ? 1 : 0
    if (direct && !x)
      for (let k = 0; k < w.primary.length && direct; k++) {
        const q = p.root[w.primary[k]]
        if (p.ident[q] & LN_MASK || p.power[q]) direct = 0
      }
    const code = sm * 4 + pelv * 2 + direct
    let key = w.keys.get(code)
    if (key === undefined) w.keys.set(code, (key = `mains-to-low-voltage|${w.terms.map((t) => t.key).join(',')}|${sm}|${pelv ? 'PELV' : 'SELV'}|${direct}`))
    let rec = paths.get(key)
    if (!mark(acc, key, mask)) {
      const made: PathRec = (rec = { states: 0, wires: new Set() })
      paths.set(key, made)
      report(acc, key, mask, () => {
        const srcs = sourcesOfMask(sm)
        const from = sourcesText(p.g, srcs)
        const sourceKeys = srcs.flatMap((i) => [...p.g.sources[i].keys.L, ...p.g.sources[i].keys.N])
        return (when) => lowVoltageDraft(w, direct === 1, from, pelv ? 'PELV' : 'SELV', sourceKeys, [...made.wires], when)
      })
    }
    if (rec && rec.states < PATH_STATES) {
      rec.states++
      for (const wire of energyPathWires(p, w.node, sourcesOfMask(sm))) rec.wires.add(wire)
    }
  }
}

// ---- Rules 2 and 3: identities that must never meet (spec 3) ----

const CONDS: Conductor[] = ['L', 'N', 'PE']

function shortDraft(p: Prepared, r: number, s: GSource, other: 'N' | 'PE') {
  const wires = wiresOfRoot(p, r)
  const d = s.part.designator
  const keys = [...s.keys.L, ...s.keys[other]]
  return (when: string): MainsDraft => ({
    rule: 'mains-short', subject: d, target: `${d} L`,
    message: other === 'N'
      ? `${d} L and N are joined${when}: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.`
      : `${d} L is joined to earth${when}: a short circuit to earth, which may put mains on everything earthed until the breaker trips. Remove the wire that joins them.`,
    parts: [s.part.uid], pins: keys.map(pinOfKey), wires, causes: keys,
  })
}

function crossDraft(p: Prepared, r: number, s: GSource, a: Conductor, t: GSource, b: Conductor) {
  // Name the side carrying L first, then N.
  const rank = (c: Conductor) => CONDS.indexOf(c)
  const [x, cx, y, cy] = rank(a) <= rank(b) ? [s, a, t, b] : [t, b, s, a]
  const wires = wiresOfRoot(p, r)
  const [X, Y] = [x.part.designator, y.part.designator]
  const keys = [...x.keys[cx], ...y.keys[cy]]
  const text = (when: string) =>
    cx === 'L' && cy === 'L' ? `${X} L and ${Y} L are joined${when}. The two outlets may be on different phases, so up to twice the mains voltage can appear across the wiring, or one phase is shorted to the other. Power this part of the circuit from one outlet.`
    : cx === 'L' && cy === 'N' ? `${X} L is joined to ${Y} N${when}: current from one outlet returns through the other, which can overload a shared neutral or get past a breaker. Power this part of the circuit from one outlet.`
    : cx === 'L' ? `${X} L is joined to ${Y}'s earth${when}: a short circuit to earth from another outlet. Remove the wire that joins them.`
    : cx === 'N' && cy === 'N' ? `${X} N and ${Y} N are joined${when}: the two outlets share a neutral here. When a breaker switches one outlet off, its neutral can still carry current from the other. Keep each outlet's neutral separate.`
    : `${X} N is joined to ${Y}'s earth${when}: neutral current may flow on the earth wire. Keep each outlet's neutral apart from earth.`
  return (when: string): MainsDraft => ({
    rule: cx === 'N' && cy === 'N' ? 'mains-shared-neutral' : 'mains-cross-source', subject: X, target: `${X} ${cx}`, message: text(when),
    parts: [x.part.uid, y.part.uid], pins: keys.map(pinOfKey), wires, causes: keys,
  })
}

/** Finding keys for rules 2 and 3 in one view, made once: per source its two shorts, per source pair and conductor pair its cross key. */
interface IdentityKeys { short: string[][]; cross: string[] }
const identityCache = new WeakMap<Prepared, IdentityKeys>()
function identityKeys(p: Prepared): IdentityKeys {
  let k = identityCache.get(p)
  if (k) return k
  const n = p.sources.length
  const cross: string[] = new Array(n * n * 9).fill('')
  p.sources.forEach((s, i) => p.sources.forEach((t, j) => {
    if (t.index <= s.index) return
    CONDS.forEach((a, ai) => CONDS.forEach((b, bi) => {
      if (a === 'PE' && b === 'PE') return
      const pair = [`${s.id}:${a}`, `${t.id}:${b}`].sort().join('+')
      cross[(i * n + j) * 9 + ai * 3 + bi] = `${a === 'N' && b === 'N' ? 'mains-shared-neutral' : 'mains-cross-source'}|${pair}`
    }))
  }))
  k = { short: p.sources.map((s) => [`mains-short|${s.id}|N`, `mains-short|${s.id}|PE`]), cross }
  identityCache.set(p, k)
  return k
}

/** Rules 2 and 3, per state and allocation-free once a finding is known: one source's L on its N or PE; two sources' conductors on one node. */
function identityRules(acc: Acc, mask: number) {
  const { p } = acc
  const src = p.sources
  const n = src.length
  const keys = identityKeys(p)
  for (let q = 0; q < p.srcRoots.length; q++) {
    const r = p.srcRoots[q]
    const x = p.ident[r]
    for (let i = 0; i < n; i++) {
      const s = src[i]
      const sb = s.index * 3
      if (!((x >>> sb) & 7)) continue
      if ((x >>> sb) & 1) {
        if ((x >>> (sb + 1)) & 1 && !mark(acc, keys.short[i][0], mask)) report(acc, keys.short[i][0], mask, () => shortDraft(p, r, s, 'N'))
        if ((x >>> (sb + 2)) & 1 && !mark(acc, keys.short[i][1], mask)) report(acc, keys.short[i][1], mask, () => shortDraft(p, r, s, 'PE'))
      }
      for (let j = 0; j < n; j++) {
        const t = src[j]
        if (t.index <= s.index) continue
        const tb = t.index * 3
        if (!((x >>> tb) & 7)) continue
        for (let a = 0; a < 3; a++) {
          if (!((x >>> (sb + a)) & 1)) continue
          for (let b = 0; b < 3; b++) {
            if (!((x >>> (tb + b)) & 1) || (a === 2 && b === 2)) continue
            const key = keys.cross[(i * n + j) * 9 + a * 3 + b]
            if (!mark(acc, key, mask)) report(acc, key, mask, () => crossDraft(p, r, s, CONDS[a], t, CONDS[b]))
          }
        }
      }
    }
  }
}

STATE_RULES.push(lowVoltageRule, identityRules)

export function visitState(acc: Acc, mask: number): void {
  track(acc)
  for (const rule of STATE_RULES) rule(acc, mask)
}

/** The drafts of one unit's findings, each worded with every one of its minimal witnesses (Resolution 24, Ruling 31). */
export function finishStates(acc: Acc): MainsDraft[] {
  return [...acc.seen.values()].map((s) => {
    const when = statePhrase(acc.p.g, acc.cands, minimalWitnesses(s.holds, acc.cands.length), s.holds)
    return s.build(when ? ` ${when}` : '')
  })
}

/** Folds one enumerated unit into the sheet's accumulator. */
export function absorb(into: Acc, unit: Acc): void {
  for (const i of unit.p.relevant) {
    into.hazardAny[i] |= unit.hazardAny[i]
    into.volts[i] = Math.max(into.volts[i], unit.volts[i])
    into.identUnion[i] |= unit.identUnion[i]
  }
  unit.converters.forEach((c, i) => {
    if (c) into.converters[i] = combine(into.converters[i], c)
  })
  unit.loadComplete.forEach((v, i) => (into.loadComplete[i] |= v))
  unit.loadFit.forEach((v, i) => (into.loadFit[i] |= v))
  for (const [i, hs] of unit.loadFixers) for (const h of hs) (into.loadFixers.get(i) ?? into.loadFixers.set(i, new Set()).get(i)!).add(h)
  into.finished.push(...finishStates(unit))
}

/**
 * When the states were not enumerated (too many groups or sources): every node a source's L or N
 * could reach is taken as hazardous at the highest such voltage. A converter is unknown when any
 * source terminal (L, N or PE) shares a possible-connectivity component with an input; unpowered only
 * when none does, which is a proof, not an enumeration result (Resolution 11).
 */
export function conservative(acc: Acc): void {
  const { p } = acc
  const g = p.g
  const reach = new Map<number, number>()
  const any = new Set<number>()
  for (const s of g.sources) {
    for (const x of [...s.live, ...s.neutral]) reach.set(p.possible[x], Math.max(reach.get(p.possible[x]) ?? 0, s.volts))
    for (const x of [...s.live, ...s.neutral, ...s.earth]) any.add(p.possible[x])
  }
  for (const i of p.relevant) {
    const v = reach.get(p.possible[i])
    if (v === undefined) continue
    acc.hazardAny[i] = 1
    acc.volts[i] = v
  }
  g.converters.forEach((c, i) => {
    acc.converters[i] = any.has(p.possible[c.a]) || any.has(p.possible[c.b]) ? notChecked(c) : UNPOWERED
  })
}

/** Rule 11 (spec 1.3): a converter that is not powered, when it is wired or plugged at all. */
function converterPower(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.converters.flatMap((c, i): MainsDraft[] => {
    const st = acc.converters[i] ?? UNPOWERED
    if (st.state === 'powered' || !g.connected.has(c.part.uid)) return []
    const d = c.part.designator
    const keys = c.names.map((n) => nodeKey(c.part.uid, n))
    const draft = (rule: RuleId, message: string): MainsDraft[] => [{ rule, subject: d, target: d, message, parts: [c.part.uid], pins: keys.map(pinOfKey), wires: [], causes: keys }]
    const none = 'so its outputs are not counted as a supply'
    // Nothing was checked when the enumeration did not finish: say so, and never ask to rewire (not "no power").
    if (st.kind === 'incomplete') return draft('supply-unknown', `The mains checks did not finish, so ${d}'s mains input was not checked and its outputs are not counted as a supply. ${st.fix}`)
    if (st.state === 'unpowered') return draft('no-power', `${d} has no mains input, so its outputs supply nothing. ${rewire(c)}`)
    if (st.kind === 'voltage') return draft('no-power', `${d}'s mains input is outside its rating (${st.why}), ${none}. ${st.fix}`)
    return draft('no-power', `${d}'s mains input is not a complete connection (${st.why}), ${none}. ${st.fix}`)
  })
}

export const STATIC_RULES: ((acc: Acc) => MainsDraft[])[] = [converterPower]

export function staticDrafts(acc: Acc): MainsDraft[] {
  return STATIC_RULES.flatMap((rule) => rule(acc))
}
