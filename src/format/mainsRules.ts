// The mains rules (spec section 3). Per-state rules run for every enumerated contact state of one
// enumeration unit and report findings by a stable key; each finding keeps one bit per state it holds
// in, so its wording names exactly the conditions it needs (Resolution 24). Static rules run once
// afterwards on what the states established (which nodes were ever hazardous, at what voltage). Pure.
import { type Endpoint, type PartInstance, moduleOf } from './diagram.ts'
import type { RuleId } from './checks.ts'
import { nodeKey } from './netlist.ts'
import { type GConverter, type GEdge, type GLoad, type GSource, type GTerm, type MainsGraph, type Prepared, LN_MASK as LN, L_MASK as L_, MAX_SOURCES, N_MASK as N_, PE_MASK as PE_, bareRoots, bitOf, decodeSingle, groupName, hazardAt, identAt, minimalWitnesses, plainPath, statePhrase, termAt, termName } from './mainsGraph.ts'
import { type Conductor, type ContactGroup, type MainsInfo, type Rating, isolationAdequate, mainsOf, uncoveredPins } from './mainsModel.ts'
import { type ThroughKind, protectivePaths } from './mainsProtective.ts'
import { andList, natural, orList } from './words.ts'
import { END_NAMES, type EndKind, endKind } from './cables.ts'
import { isBoard } from './module.ts'

/**
 * The identity masks as this module's own constants: the per-state loops read them millions of times
 * per edit, and a test runner that imports through module getters would make every read a call.
 */
const LN_MASK = LN
const L_MASK = L_
const N_MASK = N_
const PE_MASK = PE_

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
  /** An uncertain polarity clause, merged into its outlets' one warning (Ruling 37, mergeUnpolarized); never reaches the checker. */
  unpolarized?: { outlets: number; clause: string; doublePole: boolean }
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
    // Ruling 34: rule 4's wrong mains voltage finding is the converter's one finding; point to it.
    const names = andList(volts.map((x) => x.designator))
    states.push(volts.length === 1
      ? `${poss(volts)} mains voltage is outside its input range (see the wrong mains voltage finding for ${names})`
      : `${poss(volts)} mains voltages are outside their input ranges (see the wrong mains voltage findings for ${names})`)
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
/** Per accumulator: each finding of rule 1 already seen, by watch position and code, with its state bits and path record (so a repeat costs no key lookup). */
const lowVoltageSeen = new WeakMap<Acc, Map<number, { holds: Uint32Array; rec: PathRec }>>()
/** Codes are below this (a 10-bit source mask, the PELV bit and the direct bit), so position * CODES + code is one number per finding. */
const CODES = 4096

/** Rule 1, per state: a hazardous node holding a low-voltage terminal. Allocation-free once a finding has its paths. */
function lowVoltageRule(acc: Acc, mask: number) {
  const { p, srcIdx, srcLN } = acc
  let paths = pathCache.get(acc)
  if (!paths) pathCache.set(acc, (paths = new Map()))
  const plain = plainPath.on
  let known = lowVoltageSeen.get(acc)
  if (!known) lowVoltageSeen.set(acc, (known = new Map()))
  const list = watchList(p)
  for (let wi = 0; wi < list.length; wi++) {
    const w = list[wi]
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
    const hit = plain ? undefined : known.get(wi * CODES + code)
    if (hit) {
      hit.holds[mask >>> 5] |= 1 << (mask & 31)
      if (hit.rec.states < PATH_STATES) {
        hit.rec.states++
        for (const wire of energyPathWires(p, w.node, sourcesOfMask(sm))) hit.rec.wires.add(wire)
      }
      continue
    }
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
    if (rec) known.set(wi * CODES + code, { holds: acc.seen.get(key)!.holds, rec })
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
  const rank = (c: Conductor) => CONDS.indexOf(c)
  // Name the side carrying L first, then N; two of one conductor by designator, so the words never depend on part order.
  const first = rank(a) < rank(b) || (rank(a) === rank(b) && natural.compare(s.part.designator, t.part.designator) <= 0)
  const [x, cx, y, cy] = first ? [s, a, t, b] : [t, b, s, a]
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

/** Finding keys for rules 2 and 3 in one view, made once: per source its two shorts, per source pair and conductor pair its cross key; and each source's place in the view by global index. */
interface IdentityKeys { short: string[][]; cross: string[]; local: Int32Array }
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
  const local = new Int32Array(MAX_SOURCES).fill(-1)
  p.sources.forEach((s, i) => (local[s.index] = i))
  k = { short: p.sources.map((s) => [`mains-short|${s.id}|N`, `mains-short|${s.id}|PE`]), cross, local }
  identityCache.set(p, k)
  return k
}

/**
 * A finding's state bits by a rule's own slot number, per accumulator: a finding seen again costs an
 * array read instead of a key lookup. `slotHit` records state `mask` and returns true when the slot
 * is filled; `slotFill` takes the keyed path (reporting the finding when new) and fills it. The same
 * key always has the same slot, so this changes no result and no report order.
 */
type Slots = (Uint32Array | undefined)[]
function slotsOf(cache: WeakMap<Acc, Slots>, acc: Acc): Slots {
  let s = cache.get(acc)
  if (!s) cache.set(acc, (s = []))
  return s
}
function slotHit(slots: Slots, q: number, mask: number): boolean {
  const h = slots[q]
  if (h === undefined) return false
  h[mask >>> 5] |= 1 << (mask & 31)
  return true
}
function slotFill(acc: Acc, slots: Slots, q: number, key: string, mask: number, first: () => (when: string) => MainsDraft): void {
  if (!mark(acc, key, mask)) report(acc, key, mask, first)
  slots[q] = acc.seen.get(key)!.holds
}
const identitySlots = new WeakMap<Acc, Slots>()

/**
 * Rules 2 and 3, per state and allocation-free once a finding is known: one source's L on its N or PE;
 * two sources' conductors on one node. Only the sources present on a root are visited (in view order,
 * which is global index order), so a root holding one source's conductor alone costs nothing.
 */
function identityRules(acc: Acc, mask: number) {
  if (plainPath.on) return identityRulesPlain(acc, mask)
  const { p } = acc
  const src = p.sources
  const n = src.length
  const keys = identityKeys(p)
  const slots = slotsOf(identitySlots, acc)
  for (let q = 0; q < p.srcRoots.length; q++) {
    const r = p.srcRoots[q]
    const x = p.ident[r]
    // Bit s * 3 set for each source with any conductor here, for each with L or N here, and for each
    // whose L meets its own N or PE. Two sources' earths may meet, so a pair needs L or N on one side.
    const present = (x | (x >>> 1) | (x >>> 2)) & L_MASK
    const ln = (x | (x >>> 1)) & L_MASK
    const shorts = x & L_MASK & ((x >>> 1) | (x >>> 2))
    if (!shorts && (!ln || !(present & (present - 1)))) continue
    for (let rest = present; rest; rest &= rest - 1) {
      const sb = 31 - Math.clz32(rest & -rest)
      const i = keys.local[sb / 3]
      const s = src[i]
      if ((x >>> sb) & 1) {
        if ((x >>> (sb + 1)) & 1 && !slotHit(slots, i * 2, mask)) slotFill(acc, slots, i * 2, keys.short[i][0], mask, () => shortDraft(p, r, s, 'N'))
        if ((x >>> (sb + 2)) & 1 && !slotHit(slots, i * 2 + 1, mask)) slotFill(acc, slots, i * 2 + 1, keys.short[i][1], mask, () => shortDraft(p, r, s, 'PE'))
      }
      for (let more = rest & (rest - 1); more; more &= more - 1) {
        const tb = 31 - Math.clz32(more & -more)
        if (!(((ln >>> sb) | (ln >>> tb)) & 1)) continue
        const j = keys.local[tb / 3]
        const t = src[j]
        for (let a = 0; a < 3; a++) {
          if (!((x >>> (sb + a)) & 1)) continue
          for (let b = 0; b < 3; b++) {
            if (!((x >>> (tb + b)) & 1) || (a === 2 && b === 2)) continue
            const c = (i * n + j) * 9 + a * 3 + b
            if (!slotHit(slots, 2 * n + c, mask)) slotFill(acc, slots, 2 * n + c, keys.cross[c], mask, () => crossDraft(p, r, s, CONDS[a], t, CONDS[b]))
          }
        }
      }
    }
  }
}

/** Rules 2 and 3 over every source pair of every root: the reference for identityRules (see plainPath). */
function identityRulesPlain(acc: Acc, mask: number) {
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
    // Ruling 34: a converter fed outside its input range has one finding, rule 4's mains-voltage.
    if (st.kind === 'voltage') return []
    return draft('no-power', `${d}'s mains input is not a complete connection (${st.why}), ${none}. ${st.fix}`)
  })
}

export const STATIC_RULES: ((acc: Acc) => MainsDraft[])[] = [converterPower]

export function staticDrafts(acc: Acc): MainsDraft[] {
  return STATIC_RULES.flatMap((rule) => rule(acc))
}

// ---- Rule 4: a load's or converter's range excludes its source's voltage ----

/** True when L of source `s` is on one of the identities and N on the other. */
const acrossIdent = (x: number, y: number, s: number): boolean => {
  const L = 1 << (s * 3)
  const N = L << 1
  return ((x & L) !== 0 && (y & N) !== 0) || ((x & N) !== 0 && (y & L) !== 0)
}

/** The source (global index) whose L and N sit across nodes a and b, either way round, in the current state; null when none does. */
export function across(p: Prepared, a: number, b: number): number | null {
  // L and N on one node is a short (rule 2), not a supply across the load.
  if (p.root[a] === p.root[b]) return null
  const x = p.ident[p.root[a]]
  const y = p.ident[p.root[b]]
  if (!x || !y) return null
  for (let k = 0; k < p.sources.length; k++) if (acrossIdent(x, y, p.sources[k].index)) return p.sources[k].index
  return null
}

/** True when one of `nodes` has root `r` in `roots`, where root `hb` counts as `ha` (see acrossRoots). */
function onRoot(nodes: number[], roots: Int32Array, r: number, ha: number, hb: number): boolean {
  for (let k = 0; k < nodes.length; k++) {
    const q = roots[nodes[k]]
    if ((q === hb ? ha : q) === r) return true
  }
  return false
}

/** L and N of one source reach a and b over `roots`, where root `hb` counts as `ha` (one extra edge joining them; -1 for none). */
function acrossRoots(p: Prepared, roots: Int32Array, a: number, b: number, ha: number, hb: number): boolean {
  const ra = roots[a] === hb ? ha : roots[a]
  const rb = roots[b] === hb ? ha : roots[b]
  if (ra === rb) return false
  for (let k = 0; k < p.sources.length; k++) {
    const s = p.sources[k]
    if ((onRoot(s.live, roots, ra, ha, hb) && onRoot(s.neutral, roots, rb, ha, hb)) || (onRoot(s.live, roots, rb, ha, hb) && onRoot(s.neutral, roots, ra, ha, hb))) return true
  }
  return false
}

/** Resolution 28: in the current contact state, with every empty fuse holder taken as fitted, L and N of one source reach a and b. False when no holder is empty. */
export function acrossFit(p: Prepared, a: number, b: number): boolean {
  return p.anyAbsent && acrossRoots(p, p.fitRoot, a, b, -1, -1)
}

/**
 * Resolution 28: in the current contact state, with only the empty holder edge `h` added to what
 * conducts as drawn, L and N of one source reach a and b. One edge joins two roots, so nothing is
 * rebuilt: the root of h.b counts as the root of h.a.
 */
export function acrossWith(p: Prepared, h: GEdge, a: number, b: number): boolean {
  return acrossRoots(p, p.root, a, b, p.root[h.a], p.root[h.b])
}

const rangeText = (r: [number, number]) => (r[0] === r[1] ? volt(r[0]) : `${volt(r[0])} to ${volt(r[1])}`)

/** What rule 4 judges in one view: a load (its global index in `load`) or a converter input (in `converter`), with the range it accepts. */
interface Judged { part: GTerm['part']; a: number; b: number; range: [number, number] | null; load: number; converter: number }
/**
 * Per view: the judged items, their nodes and ranges in typed arrays for the per-state loop (a range
 * of [0, -1] when there is none), and their finding keys (item by source slot), each key made on
 * first use, so a state allocates nothing.
 */
interface VoltageTable { items: Judged[]; a: Int32Array; b: Int32Array; lo: Float64Array; hi: Float64Array; load: Int32Array; keys: (string | undefined)[] }
const voltageCache = new WeakMap<Prepared, VoltageTable>()
function voltageTable(p: Prepared): VoltageTable {
  let t = voltageCache.get(p)
  if (t) return t
  const g = p.g
  const items: Judged[] = [
    ...p.loadIdx.map((i): Judged => ({ part: g.loads[i].part, a: g.loads[i].a, b: g.loads[i].b, range: g.loads[i].range, load: i, converter: -1 })),
    ...p.converterIdx.map((i): Judged => ({ part: g.converters[i].part, a: g.converters[i].a, b: g.converters[i].b, range: g.converters[i].range, load: -1, converter: i })),
  ]
  t = {
    items, a: Int32Array.from(items.map((x) => x.a)), b: Int32Array.from(items.map((x) => x.b)),
    lo: Float64Array.from(items.map((x) => (x.range ? x.range[0] : 0))), hi: Float64Array.from(items.map((x) => (x.range ? x.range[1] : -1))),
    load: Int32Array.from(items.map((x) => x.load)), keys: [],
  }
  voltageCache.set(p, t)
  return t
}

function voltageDraft(g: MainsGraph, it: Judged, s: number): (when: string) => MainsDraft {
  const src = g.sources[s]
  const d = it.part.designator
  const v = volt(src.volts)
  const range = it.range
  const base = { subject: d, target: d, parts: [it.part.uid, src.part.uid], pins: [], wires: [], causes: [nodeKey(it.part.uid, '#range'), ...src.keys.L, ...src.keys.N] }
  // Resolution 14: a load with no range is never skipped in silence.
  if (!range)
    return (when) => ({ ...base, rule: 'data-missing', message: `${d}'s module gives no voltage range, so whether ${src.part.designator}'s ${v} suits it is not checked${when}. Add its rated voltage (electrical.conducts range) from the datasheet.` })
  return (when) => ({
    ...base, rule: 'mains-voltage',
    message: it.converter >= 0
      ? `${d} takes ${rangeText(range)} AC, but ${src.part.designator} gives ${v}${when}. Use a converter made for ${v}.`
      : `${d} is made for ${rangeText(range)} AC, but ${src.part.designator} gives ${v}${when}. Use one made for ${v}, or power it from an outlet it is made for.`,
  })
}

/**
 * Per unit: the items still worth a look. An item that can have no finding (every source of the unit
 * inside its range) leaves once its load is known to get a supply, and a converter input that can
 * have none never enters, so a large unit costs little per state after its first few states.
 */
interface VoltageWork { t: VoltageTable; list: Int32Array; n: number; must: Uint8Array }
const workCache = new WeakMap<Acc, VoltageWork>()
function voltageWork(acc: Acc): VoltageWork {
  let w = workCache.get(acc)
  if (w) return w
  const t = voltageTable(acc.p)
  const must = Uint8Array.from(t.items, (it) => (!it.range || [...acc.srcVolts].some((v) => v < it.range![0] || v > it.range![1]) ? 1 : 0))
  const list = Int32Array.from([...t.items.keys()].filter((k) => must[k] || t.items[k].load >= 0))
  w = { t, list, n: list.length, must }
  workCache.set(acc, w)
  return w
}

const voltageSlots = new WeakMap<Acc, Slots>()
/**
 * Rule 4, per state: every source whose L and N sit across a load or a converter input, against the
 * range it accepts (a load with none gets data-missing, Resolution 14). It also records, for the
 * protection rules, which loads get a supply as drawn, which would with every empty holder fitted, and
 * which single empty holder alone restores one in this state (Resolution 28: a state that can occur).
 * Allocation-free once a finding is known.
 */
function voltageRule(acc: Acc, mask: number) {
  const { p, srcIdx, srcVolts } = acc
  const w = voltageWork(acc)
  const { t, list, must } = w
  const slots = slotsOf(voltageSlots, acc)
  const plain = plainPath.on
  const { root, ident } = p
  const S = srcIdx.length
  for (let q = 0; q < w.n; q++) {
    const k = list[q]
    const ra = root[t.a[k]]
    const rb = root[t.b[k]]
    const x = ident[ra]
    const y = ident[rb]
    let supplied = false
    // A shorted load (both ends on one node) is not supplied: rule 2 reports the short.
    if (x && y && ra !== rb)
      for (let j = 0; j < S; j++) {
        const s = srcIdx[j]
        if (!acrossIdent(x, y, s)) continue
        supplied = true
        const v = srcVolts[j]
        if (v >= t.lo[k] && v <= t.hi[k]) continue
        if (!plain && slotHit(slots, k * S + j, mask)) continue
        const it = t.items[k]
        let key = t.keys[k * S + j]
        if (key === undefined) t.keys[k * S + j] = key = `${it.range ? 'mains-voltage' : 'data-missing|range'}|${it.part.uid}|${it.load}|${it.converter}|${s}`
        slotFill(acc, slots, k * S + j, key, mask, () => voltageDraft(p.g, it, s))
      }
    const load = t.load[k]
    if (load < 0) continue
    if (supplied) {
      acc.loadComplete[load] = 1
      // Supplied as drawn is supplied with every holder fitted too.
      if (p.anyAbsent) acc.loadFit[load] = 1
      // Nothing left to learn about it: no finding is possible, and a supplied load needs no holder named (Resolution 28).
      if (!must[k]) {
        list[q--] = list[--w.n]
        continue
      }
    }
    if (!p.anyAbsent || !acrossFit(p, t.a[k], t.b[k])) continue
    acc.loadFit[load] = 1
    if (supplied) continue
    for (let h = 0; h < p.protective.length; h++) {
      const e = p.protective[h]
      if (e.fitted || !acrossWith(p, e, t.a[k], t.b[k])) continue
      let set = acc.loadFixers.get(load)
      if (!set) acc.loadFixers.set(load, (set = new Set()))
      set.add(e.part)
    }
  }
}

STATE_RULES.push(voltageRule)

// ---- Rule 5: ratings (spec 1.4) ----

/** Why a terminal on mains has no relevant rating: none at all, only DC ones, (a contact) no AC switching one, or (a passive terminal) only AC switching ones. */
type Missing = 'none' | 'dc' | 'switching' | 'terminal'
interface Group { terms: GTerm[]; v: number; rating: Rating | null; why: Missing; alt: Rating | null }
/** Terminals of one part under one finding, so a six-way terminal block gives one line, not six. */
function grouped() {
  const map = new Map<string, Group>()
  return {
    add(key: string, t: GTerm, v: number, rating: Rating | null, why: Missing = 'none', alt: Rating | null = null) {
      const e = map.get(key)
      if (!e) map.set(key, { terms: [t], v, rating, why, alt })
      else {
        if (!e.terms.includes(t)) e.terms.push(t)
        e.v = Math.max(e.v, v)
      }
    },
    entries: (): Group[] => [...map.values()].map((e) => ({ ...e, terms: e.terms.sort((a, b) => natural.compare(termName(a), termName(b))) })),
  }
}

/**
 * Rule 5, once, over what the states established: every terminal a module declares for mains that
 * sat on a hazardous node, relevance first (AC or AC/DC service; a switching rating for a contact, an
 * insulation or terminal rating otherwise), adequacy second (at least the highest voltage it got).
 * A converter's input pair is judged by its range (rule 4); ordinary and low-voltage pins by rule 1.
 */
function ratingRules(acc: Acc): MainsDraft[] {
  const { p } = acc
  const g = p.g
  const bad = grouped()
  const unknown = grouped()
  const cond = grouped()
  const unverified = grouped()
  for (const i of p.relevant) {
    if (!acc.hazardAny[i]) continue
    const v = acc.volts[i]
    for (const key of g.members[i]) {
      const t = termAt(g, key)
      if (!t || !t.info.any || lvClass(t) !== null) continue
      if (t.info.acInput && (t.name === t.info.acInput.a || t.name === t.info.acInput.b)) continue
      const switching = t.info.contactTerminals.has(t.name)
      const mine = t.info.ratings.filter((r) => r.pins.includes(t.name))
      const relevant = mine.filter((r) => r.service !== 'dc' && (switching ? r.kind === 'switching' : r.kind !== 'switching'))
      if (!relevant.length) {
        const why: Missing = switching ? 'switching' : mine.some((r) => r.service !== 'dc') ? 'terminal' : mine.length ? 'dc' : 'none'
        unknown.add(`${t.part.uid}|${why}`, t, v, null, why)
        continue
      }
      const adequate = relevant.filter((r) => r.volts >= v).sort((a, b) => a.volts - b.volts)
      if (!adequate.length) {
        const best = relevant.reduce((a, b) => (b.volts > a.volts ? b : a))
        bad.add(`${t.part.uid}|${t.info.ratings.indexOf(best)}`, t, v, best)
        continue
      }
      // An adequate datasheet rating with no conditions settles it; otherwise the lowest adequate one is reported.
      if (adequate.some((r) => !r.conditions && r.provenance === 'datasheet')) continue
      // Either route settles it on the real build: a datasheet rating whose conditions hold, or an
      // unconditional rating that proves to hold for this exact part. When both exist, name both.
      const withTerms = adequate.find((r) => r.conditions && r.provenance === 'datasheet')
      const unproven = adequate.find((r) => !r.conditions && r.provenance === 'unverified')
      const idx = (r: Rating) => t.info.ratings.indexOf(r)
      if (withTerms && unproven) {
        cond.add(`${t.part.uid}|${idx(withTerms)}|${idx(unproven)}`, t, v, withTerms, 'none', unproven)
        continue
      }
      const r = withTerms ?? unproven ?? adequate[0]
      const rk = `${t.part.uid}|${idx(r)}`
      if (r.conditions) cond.add(rk, t, v, r)
      if (r.provenance === 'unverified') unverified.add(rk, t, v, r)
    }
  }
  const draft = (rule: RuleId, e: Group, message: string): MainsDraft => ({
    rule, subject: e.terms[0].part.designator, target: termName(e.terms[0]), message,
    parts: [e.terms[0].part.uid], pins: e.terms.map(endpointOf), wires: [], causes: e.terms.map((t) => t.key),
  })
  const names = (e: Group) => andList(e.terms.map(termName))
  const one = (e: Group) => e.terms.length === 1
  const whose = (e: Group) => `${e.terms[0].part.designator}'s ${volt(e.rating!.volts)} AC rating`
  return [
    ...bad.entries().map((e) => draft('mains-rating', e, `${names(e)} ${one(e) ? 'is' : 'are'} rated ${volt(e.rating!.volts)} AC, but ${one(e) ? 'gets' : 'get'} ${volt(e.v)}. Use a part rated for at least ${volt(e.v)} AC.`)),
    ...unknown.entries().map((e) => {
      const them = one(e) ? 'it' : 'them'
      const kind = e.why === 'switching' ? 'AC switching' : e.why === 'terminal' ? 'AC terminal or insulation' : 'AC'
      const where = e.why === 'switching' ? `${one(e) ? 'switches' : 'switch'} mains` : `${one(e) ? 'is' : 'are'} on mains`
      const gives = e.why === 'dc' ? `gives only a DC rating for ${them}` : `gives no ${kind} rating for ${them}`
      return draft('rating-unknown', e, `${names(e)} ${where} (${volt(e.v)}), but ${e.terms[0].part.designator}'s module ${gives}, so Circuitoon cannot tell whether ${one(e) ? 'it is' : 'they are'} safe there. Check the datasheet for an ${kind} rating of at least ${volt(e.v)}.`)
    }),
    ...cond.entries().map((e) => draft('rating-conditional', e, e.alt
      ? `${whose(e)} holds only ${e.rating!.conditions}, and its ${volt(e.alt.volts)} AC rating, which has no conditions, is not verified for this exact part (${e.terms[0].module.name}). Circuitoon cannot confirm either from the drawing: check the conditions on the real build, or check the maker's data for the part you use.`
      : `${whose(e)} holds only ${e.rating!.conditions}. Circuitoon cannot see that on the drawing: check it on the real build.`)),
    ...unverified.entries().map((e) => draft('rating-unverified', e, `${whose(e)} is not verified for this exact part (${e.terms[0].module.name}). Check the maker's data for the part you use.`)),
    ...isolationUnverified(acc),
  ]
}

/** A part's analysed node of terminal `name`, when some state made it hazardous. */
function hotTerm(acc: Acc, part: GTerm['part'], name: string): boolean {
  const i = acc.p.g.nodeOf.get(nodeKey(part.uid, name))
  return i !== undefined && acc.hazardAny[i] === 1
}

/** Resolution 26: a module whose isolation class comes from a similar part, not this exact one (a relay clone board), once its mains side is on mains. */
function isolationUnverified(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    if (info.isolationProvenance !== 'unverified') return []
    const mainsSide = info.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins)
    if (!mainsSide.some((n) => hotTerm(acc, part, n))) return []
    const d = part.designator
    const kind = info.contacts[0]?.kind
    const sides = kind === 'ssr' ? 'its control side and its load side' : kind ? 'its coil and its contacts' : 'mains and its low-voltage side'
    return [{
      rule: 'rating-unverified', subject: d, target: d,
      message: `${d}'s insulation between ${sides} is not verified for this exact part (${m.name}). Check the maker's data for the part you use.`,
      parts: [part.uid], pins: [], wires: [], causes: [nodeKey(part.uid, '#isolation')],
    }]
  })
}

// ---- Rule 12: missing data (spec 1.2, 3) ----

/**
 * Rule 12, once: a mains part on mains whose module leaves out how its mains terminals conduct (the
 * graph then lets energy pass between all of them), or a converter whose pins sit outside every
 * domain (taken as live, Resolution 27). A load with no voltage range is rule 4's (per state).
 */
function dataMissing(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    const d = part.designator
    const label = (n: string) => termAt(g, nodeKey(part.uid, n))?.label ?? n
    const out: MainsDraft[] = []
    const undeclared = [...info.terminals].filter((t) => !info.declaredConduction.has(t)).sort(natural.compare)
    if (undeclared.some((n) => hotTerm(acc, part, n))) {
      const one = undeclared.length === 1
      const names = andList(undeclared.map(label))
      out.push({
        rule: 'data-missing', subject: d, target: d,
        message: one
          ? `${d}'s module does not say how ${names} conducts, so the mains checks assume the worst for it: mains on it reaches every other mains terminal of ${d}, and theirs reaches it. Add conduction data to its module (electrical.internal, conducts, contacts or protective).`
          : `${d}'s module does not say how ${names} conduct, so the mains checks assume the worst for them: mains on any of them reaches the others. Add conduction data to its module (electrical.internal, conducts, contacts or protective).`,
        parts: [part.uid], pins: undeclared.map((n) => ({ part: part.uid, pin: n })), wires: [], causes: undeclared.map((n) => nodeKey(part.uid, n)),
      })
    }
    const uncovered = info.acInput ? uncoveredPins(m, info) : []
    if (uncovered.length && (hotTerm(acc, part, info.acInput!.a) || hotTerm(acc, part, info.acInput!.b))) {
      const one = uncovered.length === 1
      out.push({
        rule: 'data-missing', subject: d, target: d,
        message: `${d}'s module leaves ${andList(uncovered.map(label))} outside every domain (electrical.domains), so the checks treat ${one ? 'it' : 'them'} as live. Add its domains and isolation from the datasheet.`,
        parts: [part.uid], pins: uncovered.map((n) => ({ part: part.uid, pin: n })), wires: [], causes: [nodeKey(part.uid, '#domains')],
      })
    }
    return out
  })
}

STATIC_RULES.push(ratingRules, dataMissing)

// ---- Rule 6: polarity (spec 3; Resolution 22, Ruling 37) ----

/** Up to this many L and N terminals of one part are judged as one claim (one bit each, two masks in one exact number); a part with more is judged in chunks of this size. */
const REQ_CHUNK = 26

/**
 * The last finding one table entry recorded (its code within the entry, and its state bits), so the
 * same finding in the next state costs one comparison, not a key lookup: the enumeration visits up to
 * 65,536 states, and an unpolarized outlet makes every lamp, switch and fuse report in each.
 */
interface Last { code: number; holds: Uint32Array | null }
const lastOf = (): Last => ({ code: 0, holds: null })
/** Records state `mask` when the entry's last finding has `code`; false otherwise (the caller takes the keyed path). */
function repeat(l: Last, code: number, mask: number): boolean {
  if (l.holds === null || l.code !== code) return false
  l.holds[mask >>> 5] |= 1 << (mask & 31)
  return true
}
/** The keyed path: records state `mask` under `key` (reporting it when new) and makes it the entry's last finding. */
function remember(acc: Acc, l: Last, code: number, key: string, mask: number, first: () => (when: string) => MainsDraft): void {
  if (!mark(acc, key, mask)) report(acc, key, mask, first)
  l.code = code
  l.holds = acc.seen.get(key)!.holds
}

/** One part's terminals that require L or N (a chunk of at most REQ_CHUNK) and its finding keys by code; `vals` holds their identities for one judgement, and `lOnN`, `nOnL` and `um` its result (see judgeTerms). */
interface ReqPart { part: PartInstance; terms: GTerm[]; nodes: Int32Array; wantL: Uint8Array; keys: Map<number, string>; maybeKeys: Map<number, string>; wrong: Last; maybe: Last; vals: Uint32Array; lOnN: number; nOnL: number; um: number }
/**
 * A single-pole contact group that can carry a neutral: its candidate position (-1 when it never
 * switches here); `at[s]`, the node its closed contact touches in position s, or -1 when that position
 * is open or leads nowhere a neutral would matter (see farSides); whether it is a changeover (both
 * throws wired); the word for its open position; and its keys.
 */
interface PolGroup { gi: number; pos: number; changeover: boolean; openWord: string; at: Int32Array; key: string; maybeKeys: Map<number, string>; last: Last }
interface PolFuse { e: GEdge; key: string; maybeKeys: Map<number, string>; last: Last }
/** A class 1 part's earth terminal (a PE pin or PE plug contact) and the part's other mains terminals. */
interface EarthTerm { t: GTerm; node: number; others: Int32Array; noPe: string; onLive: string }
interface PolarityTable {
  /** L and N bits of the view's polarized sources, and of its unpolarized ones. */
  pol: number
  unpol: number
  /** The unpolarized sources (global index). */
  unpolList: number[]
  parts: ReqPart[]
  groups: PolGroup[]
  fuses: PolFuse[]
  /** Terminals requiring L, N or line, with their key for being on earth only. */
  lines: { t: GTerm; node: number; key: string }[]
  earths: EarthTerm[]
  /** Per source in the view: its N and PE bits (0 when the module itself joins them), and the key of their join. */
  npe: Uint32Array
  npeKeys: string[]
  grounds: { t: GTerm; node: number; key: string }[]
  bondNodes: Int32Array
  /**
   * Findings whose identity no contact can change (every node they read carries the same identity in
   * every state): each is reported in the first state visited and marked in every state at once, so
   * the per-state loops never see it. `fixedDone` once they have run.
   */
  fixed: ((mask: number) => void)[]
  fixedDone: boolean
}
const polarityCache = new WeakMap<Acc, PolarityTable>()

/** The earth terminals of a class 1 module: pins requiring PE, and PE plug contacts. */
function earthNames(info: MainsInfo): string[] {
  return [...[...info.requirement].filter(([, r]) => r === 'PE').map(([n]) => n), ...(info.plug?.profiles.flatMap((pr) => pr.contacts.filter((c) => c.mains === 'PE').map((c) => c.pin)) ?? [])]
    .filter((n, i, all) => all.indexOf(n) === i)
}

/**
 * The identity bits each node of the view can ever carry: the closure from the source terminals over
 * nets, every fuse edge (fitted or not) and, with `contacts`, every contact position at once. Without
 * `contacts` and over fitted fuses only, the bits a node carries in every state. `skip` leaves one
 * contact group or fuse out (what reaches its ends without it). Once per view, so the per-state rules
 * below judge only what can go wrong.
 */
function identityReach(p: Prepared, contacts: boolean, skip: { group?: number; edge?: GEdge } = {}): (i: number) => number {
  const g = p.g
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.has(r)) r = parent.get(r)!
    return r
  }
  const union = (a: number, b: number) => {
    if (!p.inRel[a] || !p.inRel[b]) return
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const e of p.protective) if ((contacts || e.fitted) && e !== skip.edge) union(e.a, e.b)
  if (contacts) for (const gi of p.groupIdx) if (gi !== skip.group) for (const list of g.groups[gi].closed) for (const [a, b] of list) union(a, b)
  const bits = new Map<number, number>()
  for (const s of p.sources)
    for (const [nodes, c] of [[s.live, 'L'], [s.neutral, 'N'], [s.earth, 'PE']] as const)
      for (const x of nodes) bits.set(find(x), (bits.get(find(x)) ?? 0) | bitOf(s.index, c))
  return (i) => bits.get(find(i)) ?? 0
}

/** True when a net has a wire or a terminal besides the given one: a contact throw on it leads somewhere. */
const wired = (g: MainsGraph, i: number) => g.wires[i].length > 0 || g.members[i].length > 1

/**
 * True when net `i` holds a terminal that a neutral feeds: a mains terminal of a part other than
 * `owner` (a load, a converter input, another switch or fuse, a terminal block), never an earth: a
 * PE terminal, a declared bond or a source's or socket's earth.
 */
function feedsMains(g: MainsGraph, i: number, owner: PartInstance): boolean {
  return g.members[i].some((k) => {
    const t = termAt(g, k)
    if (!t || t.part === owner || !t.info.terminals.has(t.name) || t.info.bonds.has(t.name) || t.info.requirement.get(t.name) === 'PE') return false
    return !t.info.acSources.some((s) => s.earth.includes(t.name)) && !t.info.sockets.some((s) => s.contacts.some((c) => c.group === t.name && c.role === 'PE'))
  })
}

/**
 * The ends of a contact or fuse that lose the neutral when it opens and feed something through it:
 * no neutral (nor unpolarized conductor) reaches the end without it (`without`), it feeds a mains
 * terminal of another part, and it does not carry earth itself. A switch between N and PE, or with
 * one side open, is in no neutral path.
 */
function farSide(p: Prepared, without: (i: number) => number, i: number, owner: PartInstance, nLike: number): boolean {
  const x = without(i)
  return !(x & nLike) && !(x & PE_MASK) && feedsMains(p.g, i, owner)
}

/**
 * What rules 6 and 7 judge in one unit, made once, so a state allocates nothing once its findings are
 * known. Only what can go wrong enters: a terminal that can reach the conductor it must not carry (or
 * an unpolarized source), a contact or fuse in a path a neutral feeds, an earth terminal that is not
 * always on PE, and a terminal or ground that can reach PE.
 */
function polarityTable(acc: Acc): PolarityTable {
  let t = polarityCache.get(acc)
  if (t) return t
  const { p } = acc
  const g = p.g
  const can = identityReach(p, true)
  const always = identityReach(p, false)
  const bits = (polarized: boolean) => p.sources.reduce((m, s) => (s.polarized === polarized ? m | bitOf(s.index, 'L') | bitOf(s.index, 'N') : m), 0)
  const [pol, unpol] = [bits(true), bits(false)]
  const nLike = (N_MASK & pol) | unpol
  /** True when a terminal needing conductor `want` can be on the other one, or on an unpolarized source. */
  const risky = (i: number, want: 'L' | 'N') => (can(i) & (((want === 'L' ? N_MASK : L_MASK) & pol) | unpol)) !== 0
  const unpolSrc = [...new Set(p.sources.filter((s) => !s.polarized).map((s) => s.index))]
  const node = (part: PartInstance, n: string) => g.nodeOf.get(nodeKey(part.uid, n))
  const inView = (i: number | undefined): i is number => i !== undefined && p.inRel[i] === 1
  const byPart = new Map<PartInstance, GTerm[]>()
  const lines: PolarityTable['lines'] = []
  const grounds: PolarityTable['grounds'] = []
  const bondNodes: number[] = []
  for (const i of p.relevant)
    for (const k of g.members[i]) {
      const term = termAt(g, k)
      if (!term) continue
      const req = term.info.requirement.get(term.name)
      if ((req === 'L' || req === 'N') && risky(i, req)) (byPart.get(term.part) ?? byPart.set(term.part, []).get(term.part)!).push(term)
      const onPE = (can(i) & PE_MASK) !== 0
      if ((req === 'L' || req === 'N' || req === 'line') && onPE) lines.push({ t: term, node: i, key: `earth|${term.key}|line-on-pe` })
      if (term.info.bonds.has(term.name)) bondNodes.push(i)
      else if (onPE && term.type === 'ground' && lvClass(term) !== null) grounds.push({ t: term, node: i, key: `earth-bond|${term.key}` })
    }
  const parts: ReqPart[] = []
  for (const [part, list] of byPart) {
    list.sort((a, b) => natural.compare(termName(a), termName(b)))
    for (let s = 0; s < list.length; s += REQ_CHUNK) {
      const terms = list.slice(s, s + REQ_CHUNK)
      parts.push({ part, terms, nodes: Int32Array.from(terms, (x) => g.nodeOf.get(x.key)!), wantL: Uint8Array.from(terms, (x) => (x.info.requirement.get(x.name) === 'L' ? 1 : 0)), keys: new Map(), maybeKeys: new Map(), wrong: lastOf(), maybe: lastOf(), vals: new Uint32Array(terms.length), lOnN: 0, nOnL: 0, um: 0 })
    }
  }
  const groups = p.groupIdx.flatMap((gi): PolGroup[] => {
    const grp = g.groups[gi]
    const pole = grp.def.poles[0]
    const com = node(grp.part, pole.com)!
    if (grp.def.poles.length !== 1 || !(can(com) & nLike)) return []
    const without = identityReach(p, true, { group: gi })
    // A throw counts only when it leads somewhere a neutral would matter (either end of its pair is a far side).
    const at = Int32Array.from([pole.nc, pole.no], (name) => {
      const other = name === null ? undefined : node(grp.part, name)
      if (!inView(other) || !wired(g, other)) return -1
      return farSide(p, without, com, grp.part, nLike) || farSide(p, without, other, grp.part, nLike) ? com : -1
    })
    if (at[0] < 0 && at[1] < 0) return []
    // A throw whose contact is not wired never closes onto anything: the group is then single-pole, its open position the other one.
    const throws = [pole.nc, pole.no].map((name) => name !== null && wired(g, node(grp.part, name)!))
    const changeover = throws[0] && throws[1]
    const kind = grp.def.kind
    const words = kind === 'relay' ? ['released', 'energized'] : pole.nc !== null && kind === 'switch' ? ['switched to NC', 'switched to NO'] : ['off', 'on']
    const openWord = words[throws[1] ? 0 : 1]
    return [{ gi, pos: acc.cands.indexOf(gi), changeover, openWord, at, key: `polarity|${grp.part.uid}|${grp.def.id}|neutral`, maybeKeys: new Map(), last: lastOf() }]
  })
  const fuses = p.protective.flatMap((e): PolFuse[] => {
    if (!(can(e.a) & nLike)) return []
    const without = identityReach(p, true, { edge: e })
    if (!farSide(p, without, e.a, e.part, nLike) && !(p.inRel[e.b] && farSide(p, without, e.b, e.part, nLike))) return []
    return [{ e, key: `polarity|${e.part.uid}|${e.names.join('-')}|neutral`, maybeKeys: new Map(), last: lastOf() }]
  })
  // Split off what no contact can change (see PolarityTable.fixed).
  const fixed: ((mask: number) => void)[] = []
  const staticParts = parts.filter((r) => {
    const nodes = Array.from(r.nodes)
    if (nodes.every((i) => can(i) === always(i))) {
      nodes.forEach((i, k) => (r.vals[k] = always(i)))
      judgeTerms(r, pol, unpol, unpolSrc)
    } else {
      // No polarized conductor can reach it, and the unpolarized outlets it reaches are the same in every state.
      const canPol = nodes.reduce((m, i) => m | can(i), 0) & pol
      const least = sourcesBits(unpolSrc, nodes.reduce((m, i) => m | always(i), 0))
      if (canPol || least !== sourcesBits(unpolSrc, nodes.reduce((m, i) => m | can(i), 0))) return false
      r.lOnN = r.nOnL = 0
      r.um = least
    }
    const { lOnN, nOnL, um } = r
    if (lOnN | nOnL) fixed.push((mask) => everyState(acc, wrongKey(r, lOnN, nOnL), mask, () => wrongWayDraft(acc.p, r, lOnN, nOnL)))
    if (um) fixed.push((mask) => everyState(acc, maybeKey(r, um), mask, () => maybeWrongDraft(acc.p, r, um)))
    return true
  })
  const staticGroups = groups.filter((c) => {
    const com = c.at[0] >= 0 ? c.at[0] : c.at[1]
    const grp = g.groups[c.gi]
    const pole = grp.def.poles[0]
    const throwAt = node(grp.part, (c.at[1] >= 0 ? pole.no : pole.nc)!)!
    if (c.changeover || can(com) !== (always(com) | always(throwAt))) return false
    const code = carryCode(pol, unpol, unpolSrc, can(com))
    if (code) fixed.push((mask) => everyState(acc, groupKey(g, c, code), mask, () => groupDraft(acc.p, c, [com, throwAt], code < 0 ? 0 : code)))
    return true
  })
  const staticFuses = fuses.filter((f) => {
    const { a, b, fitted } = f.e
    const other = fitted || !p.inRel[b] ? 0 : always(b)
    if (can(a) !== (always(a) | other)) return false
    const code = carryCode(pol, unpol, unpolSrc, can(a))
    if (code) fixed.push((mask) => everyState(acc, fuseKey(f, code), mask, () => fuseDraft(acc.p, f.e, code < 0 ? 0 : code)))
    return true
  })
  const earths: EarthTerm[] = []
  for (const part of g.mainsParts) {
    const info = mainsOf(moduleOf(g.d, part.module)!)
    if (info.protection !== 'class-1') continue
    const pe = earthNames(info)
    const others = Int32Array.from([...info.terminals].filter((n) => !pe.includes(n)).map((n) => node(part, n)).filter(inView))
    for (const n of pe) {
      const i = node(part, n)
      const term = termAt(g, nodeKey(part.uid, n))
      // An earth that carries PE in every state can never lack it (nor carry L or N without a short, which rule 2 reports).
      if (!inView(i) || !term || always(i) & PE_MASK) continue
      earths.push({ t: term, node: i, others, noPe: `earth|${term.key}|no-pe`, onLive: `earth|${term.key}|pe-live` })
    }
  }
  t = {
    pol, unpol, unpolList: unpolSrc,
    parts: parts.filter((r) => !staticParts.includes(r)), groups: groups.filter((c) => !staticGroups.includes(c)), fuses: fuses.filter((f) => !staticFuses.includes(f)),
    lines, earths, fixed, fixedDone: false,
    npe: Uint32Array.from(p.sources, (s) => (joinedInside(g, s) ? 0 : bitOf(s.index, 'N') | bitOf(s.index, 'PE'))), npeKeys: p.sources.map((s) => `earth|${s.id}|N-PE`),
    grounds, bondNodes: Int32Array.from(bondNodes),
  }
  polarityCache.set(acc, t)
  return t
}

/** True when a source's module itself joins its N and its earth (one terminal, or one internal group): that join is the supply's, not one beyond the outlet. */
function joinedInside(g: MainsGraph, s: GSource): boolean {
  const name = (k: string) => (JSON.parse(k) as [string, string])[1]
  const [ns, pes] = [s.keys.N.map(name), s.keys.PE.map(name)]
  if (ns.some((n) => pes.includes(n))) return true
  const internal = moduleOf(g.d, s.part.module)?.internal ?? []
  return internal.some((grp) => grp.some((n) => ns.includes(n)) && grp.some((n) => pes.includes(n)))
}

/** The sources in `list` (one bit per global index) whose L or N is in identity `x`: the unpolarized outlets behind it. */
function sourcesBits(list: number[], x: number): number {
  let m = 0
  for (let j = 0; j < list.length; j++) if (x & (bitOf(list[j], 'L') | bitOf(list[j], 'N'))) m |= 1 << list[j]
  return m
}

/** Judges a part's terminals from their identities in `r.vals`: which need L but are on N, which need N but are on L (polarized sources), and the unpolarized sources behind the rest. */
function judgeTerms(r: ReqPart, pol: number, unpol: number, unpolSrc: number[]): void {
  let lOnN = 0
  let nOnL = 0
  let um = 0
  for (let k = 0; k < r.vals.length; k++) {
    const all = r.vals[k]
    const x = all & pol
    const onL = (x & L_MASK) !== 0 && !(x & N_MASK)
    const onN = (x & N_MASK) !== 0 && !(x & L_MASK)
    if (r.wantL[k] && onN) lOnN |= 1 << k
    else if (!r.wantL[k] && onL) nOnL |= 1 << k
    else if (all & unpol && !(x & LN_MASK)) um |= sourcesBits(unpolSrc, all)
  }
  r.lOnN = lOnN
  r.nOnL = nOnL
  r.um = um
}

/** A contact or fuse carrying identity `x`: -1 for a definite neutral (polarized source), the unpolarized sources for an uncertain one, 0 for neither. */
function carryCode(pol: number, unpol: number, unpolSrc: number[], x: number): number {
  if (x & pol & N_MASK && !(x & pol & L_MASK)) return -1
  if (!(x & pol & LN_MASK) && x & unpol && !(x & unpol & L_MASK && x & unpol & N_MASK)) return sourcesBits(unpolSrc, x)
  return 0
}

/** Records a finding in every state of the unit at once (it holds whatever the contacts do). */
function everyState(acc: Acc, key: string, mask: number, first: () => (when: string) => MainsDraft): void {
  if (!mark(acc, key, mask)) report(acc, key, mask, first)
  const holds = acc.seen.get(key)!.holds
  const n = acc.total
  for (let m = 0; m < n; m += 32) holds[m >>> 5] = n - m >= 32 ? 0xffffffff : (1 << (n - m)) - 1
}

const wrongKey = (r: ReqPart, lOnN: number, nOnL: number) => keyFor(r.keys, lOnN * 2 ** REQ_CHUNK + nOnL, () => `polarity|${r.part.uid}|${r.terms[0].key}|${lOnN}|${nOnL}`)
const maybeKey = (r: ReqPart, um: number) => keyFor(r.maybeKeys, um, () => `polarity|maybe|${r.part.uid}|${r.terms[0].key}|${um}`)
const groupKey = (g: MainsGraph, c: PolGroup, code: number) => (code < 0 ? c.key : keyFor(c.maybeKeys, code, () => `polarity|maybe|${g.groups[c.gi].part.uid}|${g.groups[c.gi].def.id}|${code}`))
const fuseKey = (f: PolFuse, code: number) => (code < 0 ? f.key : keyFor(f.maybeKeys, code, () => `polarity|maybe|${f.e.part.uid}|${f.e.names.join('-')}|${code}`))

/** The finding key for `code` in `keys`, made on first use. */
function keyFor(keys: Map<number, string>, code: number, make: () => string): string {
  let k = keys.get(code)
  if (k === undefined) keys.set(code, (k = make()))
  return k
}

/** The sources (global index) whose L or N is in identity `x`. */
const lnSources = (p: Prepared, x: number) => sourcesIn(p, x, 0)

/** The wires on the ways L and N of the given sources reach each node (spec 3: a finding highlights its path). */
const pathsTo = (p: Prepared, nodes: ArrayLike<number>, sources: number[]) =>
  [...new Set(Array.from(nodes).flatMap((i) => energyPathWires(p, i, sources)))]

/** Terminals that require L or N (a lamp's centre contact and shell): each on the conductor it needs. Definite from a polarized source, uncertain from an unpolarized one. */
function terminalPolarity(acc: Acc, t: PolarityTable, mask: number) {
  const { p } = acc
  const { root, ident } = p
  for (let q = 0; q < t.parts.length; q++) {
    const r = t.parts[q]
    for (let k = 0; k < r.nodes.length; k++) r.vals[k] = ident[root[r.nodes[k]]]
    judgeTerms(r, t.pol, t.unpol, t.unpolList)
    const { lOnN, nOnL, um } = r
    // Resolution 24: the key holds which terminals are on which wrong conductor.
    const code = lOnN * 2 ** REQ_CHUNK + nOnL
    if (code && !repeat(r.wrong, code, mask)) remember(acc, r.wrong, code, wrongKey(r, lOnN, nOnL), mask, () => wrongWayDraft(p, r, lOnN, nOnL))
    // The claim is about the part (its polarity is not known) and the outlets that make it so; it names every L and N terminal of the part.
    if (um && !repeat(r.maybe, um, mask)) remember(acc, r.maybe, um, maybeKey(r, um), mask, () => maybeWrongDraft(p, r, um))
  }
}

function wrongWayDraft(p: Prepared, r: ReqPart, lOnN: number, nOnL: number): (when: string) => MainsDraft {
  const pick = (m: number) => r.terms.filter((_, k) => (m >>> k) & 1)
  const [onN, onL] = [pick(lOnN), pick(nOnL)]
  const terms = [...onN, ...onL]
  const nodes = terms.map((x) => p.g.nodeOf.get(x.key)!)
  const d = r.part.designator
  const names = (xs: GTerm[]) => andList(xs.map(termName))
  const is = (xs: GTerm[]) => (xs.length === 1 ? 'is' : 'are')
  const wires = pathsTo(p, nodes, lnSources(p, nodes.reduce((m, i) => m | identAt(p, i), 0)))
  // The module's own words for what reversing it does, when N is on L (a lamp's screw shell); never guessed.
  const hazard = onL.length && r.terms[0].info.polarityHazard ? `${r.terms[0].info.polarityHazard} ` : ''
  const swap = `${hazard}Swap the L and N wires to ${d}.`
  return (when) => ({
    rule: 'polarity', subject: d, target: termName(terms[0]),
    message: onN.length && onL.length
      ? `${d} is wired the wrong way round${when}: ${names(onN)} ${is(onN)} on N and ${names(onL)} ${is(onL)} on L. ${swap}`
      : onL.length
      ? `${names(onL)} should be on N but ${is(onL)} on L${when}. ${swap}`
      : `${names(onN)} should be on L but ${is(onN)} on N${when}. ${swap}`,
    parts: [r.part.uid], pins: terms.map(endpointOf), wires, causes: terms.map((x) => x.key),
  })
}

/**
 * An uncertain claim is one clause of its outlet's warning (Ruling 37): the draft carries the clause
 * (its conditions included) and the outlets behind it; mergeUnpolarized joins the clauses.
 */
function maybeWrongDraft(p: Prepared, r: ReqPart, um: number): (when: string) => MainsDraft {
  const d = r.part.designator
  const wires = pathsTo(p, r.nodes, sourcesOfMask(um))
  return (when) => ({
    rule: 'polarity', subject: d, target: termName(r.terms[0]), message: '',
    parts: [r.part.uid], pins: r.terms.map(endpointOf), wires, causes: [],
    unpolarized: { outlets: um, clause: `${andList(r.terms.map(termName))} may be on the wrong conductor${when}`, doublePole: false },
  })
}

/**
 * A single-pole switch, relay or SSR, or a fuse, in a neutral path: it carries a neutral and no L
 * (definite from a polarized source, uncertain from an unpolarized one), and an end that loses the
 * neutral when it opens feeds another part (see farSide). A single-pole group (no second throw wired)
 * is in the neutral whatever its own state (its open state is exactly the harm), so the finding also
 * holds in the state that differs only in that group, and its own position is never a condition. A
 * changeover carries a neutral in the position it is in, so its position stays in the phrase.
 */
function carrierPolarity(acc: Acc, t: PolarityTable, mask: number) {
  const { p } = acc
  const g = p.g
  const { root, ident, inRel, groupState } = p
  for (let q = 0; q < t.groups.length; q++) {
    const c = t.groups[q]
    const a = c.at[groupState[c.gi]]
    if (a < 0) continue
    const code = carryCode(t.pol, t.unpol, t.unpolList, ident[root[a]])
    if (!code) continue
    if (!repeat(c.last, code, mask)) remember(acc, c.last, code, groupKey(g, c, code), mask, () => groupDraft(p, c, [a], code < 0 ? 0 : code))
    if (!c.changeover && c.pos >= 0) {
      const m = mask ^ (1 << c.pos)
      c.last.holds![m >>> 5] |= 1 << (m & 31)
    }
  }
  for (let q = 0; q < t.fuses.length; q++) {
    const f = t.fuses[q]
    const e = f.e
    // An empty holder is open: either side tells which conductor it sits in.
    const code = carryCode(t.pol, t.unpol, t.unpolList, ident[root[e.a]] | (e.fitted || !inRel[e.b] ? 0 : ident[root[e.b]]))
    if (code && !repeat(f.last, code, mask)) remember(acc, f.last, code, fuseKey(f, code), mask, () => fuseDraft(p, e, code < 0 ? 0 : code))
  }
}

/** `ends`: the nodes whose energizing paths explain it (both ends of the contact when it is reported for every state at once, whatever state is current). */
function groupDraft(p: Prepared, c: PolGroup, ends: number[], um: number): (when: string) => MainsDraft {
  const g = p.g
  const grp = g.groups[c.gi]
  const name = groupName(g, c.gi)
  const d = grp.part.designator
  const wires = pathsTo(p, ends, um ? sourcesOfMask(um) : lnSources(p, ends.reduce((m, i) => m | identAt(p, i), 0)))
  const base = { rule: 'polarity' as const, subject: d, target: d, parts: [grp.part.uid], pins: [], wires }
  const open = c.changeover ? 'whatever it disconnects stays live' : `with ${name} ${c.openWord}, what it feeds stays live`
  return um
    ? (when) => ({ ...base, message: '', causes: [], unpolarized: { outlets: um, clause: `${name} may switch the neutral${when}`, doublePole: true } })
    : (when) => ({ ...base, message: `${name} switches the neutral${when}: ${open}. Move ${name} into the L wire.`, causes: [nodeKey(grp.part.uid, grp.def.id)] })
}

function fuseDraft(p: Prepared, e: GEdge, um: number): (when: string) => MainsDraft {
  const d = e.part.designator
  const ends = [e.a, ...(p.inRel[e.b] ? [e.b] : [])]
  const wires = pathsTo(p, ends, um ? sourcesOfMask(um) : lnSources(p, ends.reduce((m, i) => m | identAt(p, i), 0)))
  const base = { rule: 'polarity' as const, subject: d, target: d, parts: [e.part.uid], pins: e.names.map((n) => ({ part: e.part.uid, pin: n })), wires }
  // An empty holder has no fuse to blow: it is the holder that sits in the neutral.
  const which = e.fitted ? d : `${d}'s holder`
  return um
    ? (when) => ({ ...base, message: '', causes: [], unpolarized: { outlets: um, clause: `${which} may be in the neutral${when}`, doublePole: false } })
    : (when) => ({
      ...base,
      message: e.fitted
        ? `${d} is in the neutral${when}: when it blows, what it feeds stays live. Move ${d} into the L wire.`
        : `${which} is in the neutral${when}: a fuse there would not disconnect L from what it feeds. Move ${d} into the L wire.`,
      causes: e.names.map((n) => nodeKey(e.part.uid, n)),
    })
}

/**
 * Ruling 37: every uncertain polarity clause behind the same unpolarized outlets becomes one warning
 * for those outlets, listing the parts in designator order, each with its own conditions. Definite
 * findings and every other draft pass through unchanged.
 */
export function mergeUnpolarized(g: MainsGraph, drafts: MainsDraft[]): MainsDraft[] {
  const out: MainsDraft[] = []
  const byOutlets = new Map<number, MainsDraft[]>()
  for (const d of drafts) {
    if (!d.unpolarized) out.push(d)
    else (byOutlets.get(d.unpolarized.outlets) ?? byOutlets.set(d.unpolarized.outlets, []).get(d.unpolarized.outlets)!).push(d)
  }
  for (const [outlets, items] of byOutlets) {
    items.sort((a, b) => natural.compare(a.subject, b.subject) || natural.compare(a.unpolarized!.clause, b.unpolarized!.clause))
    const srcs = sourcesOfMask(outlets).map((s) => g.sources[s].part)
    const names = [...new Set(srcs.map((x) => x.designator))].sort(natural.compare)
    const parts = [...new Set(items.map((x) => x.subject))]
    const doubles = [...new Set(items.filter((x) => x.unpolarized!.doublePole).map((x) => x.subject))]
    const either = doubles.length ? `, or a double-pole switch or relay in place of ${andList(doubles)}` : ''
    out.push({
      rule: 'polarity', subject: names[0], target: names[0],
      message: `${unpolarizedWords(g, outlets)}: ${items.map((x) => x.unpolarized!.clause).join('; ')}. Use a polarized plug and outlet for ${andList(parts)}${either}.`,
      parts: [...new Set([...srcs.map((x) => x.uid), ...items.flatMap((x) => x.parts)])],
      pins: items.flatMap((x) => x.pins), wires: [...new Set(items.flatMap((x) => x.wires))],
      causes: srcs.map((x) => nodeKey(x.uid, '#polarity-unknown')),
    })
  }
  return out
}

/** "XS1 is an unpolarized outlet, so which of its slots is L is not known", for the sources in `mask`. */
function unpolarizedWords(g: MainsGraph, mask: number): string {
  const names = [...new Set(sourcesOfMask(mask).map((s) => g.sources[s].part.designator))].sort(natural.compare)
  return names.length === 1
    ? `${names[0]} is an unpolarized outlet, so which of its slots is L is not known`
    : `${andList(names)} are unpolarized outlets, so which of their slots is L is not known`
}

function polarityRule(acc: Acc, mask: number) {
  const t = polarityTable(acc)
  if (!t.fixedDone) {
    t.fixedDone = true
    for (const f of t.fixed) f(mask)
  }
  terminalPolarity(acc, t, mask)
  carrierPolarity(acc, t, mask)
}

// ---- Rule 7: earth (spec 1.6, 3) ----

const earthAdvice = (t: GTerm) => `a fault inside ${t.part.designator} may leave its metal live. Wire ${termName(t)} to the outlet's earth.`

/**
 * Rule 7, per state: a class 1 part's earth without PE identity while the part is on mains (or on L
 * or N instead); N and PE of one source joined beyond the outlet; a terminal that must carry L or N on
 * earth only; a low-voltage ground on earth where nothing on its net declares a bond (a warning).
 */
function earthRules(acc: Acc, mask: number) {
  const { p } = acc
  const plain = plainPath.on
  const { root, ident, power } = p
  const t = polarityTable(acc)
  for (const e of t.earths) {
    const x = ident[root[e.node]]
    if (x & PE_MASK) continue
    if (x & LN_MASK) {
      if (!mark(acc, e.onLive, mask)) report(acc, e.onLive, mask, () => peLiveDraft(p, e))
      continue
    }
    let live = false
    for (let k = 0; k < e.others.length && !live; k++) {
      const r = root[e.others[k]]
      live = (ident[r] & LN_MASK) !== 0 || power[r] !== 0
    }
    if (live && !mark(acc, e.noPe, mask)) report(acc, e.noPe, mask, () => {
      const wires = p.g.wires[e.node].slice()
      return (when) => ({ rule: 'earth', subject: e.t.part.designator, target: termName(e.t),
        message: `${termName(e.t)} is not connected to earth${when}: ${earthAdvice(e.t)}`,
        parts: [e.t.part.uid], pins: [endpointOf(e.t)], wires, causes: [e.t.key] })
    })
  }
  for (let q = 0; q < p.srcRoots.length; q++) {
    const r = p.srcRoots[q]
    const x = p.ident[r]
    // No source has both its N and its PE here: no join to look for.
    if (!(x & N_MASK & (x >>> 1)) && !plain) continue
    for (let i = 0; i < t.npe.length; i++) {
      if (!t.npe[i] || (x & t.npe[i]) !== t.npe[i]) continue
      const key = t.npeKeys[i]
      if (mark(acc, key, mask)) continue
      const s = p.sources[i]
      report(acc, key, mask, () => {
        const d = s.part.designator
        const keys = [...s.keys.N, ...s.keys.PE]
        const wires = wiresOfRoot(p, r)
        return (when) => ({ rule: 'earth', subject: d, target: `${d} N`,
          message: `${d} N is joined to earth${when}: neutral and earth are joined only at the main panel, and a join here puts current on the earth wire. Remove the wire that joins them.`,
          parts: [s.part.uid], pins: keys.map(pinOfKey), wires, causes: keys })
      })
    }
  }
  for (const l of t.lines) {
    const x = ident[root[l.node]]
    if (!(x & PE_MASK) || x & LN_MASK) continue
    if (!mark(acc, l.key, mask)) report(acc, l.key, mask, () => {
      const wires = wiresOfRoot(p, p.root[l.node])
      const req = l.t.info.requirement.get(l.t.name)
      const to = req === 'L' || req === 'N' ? req : 'L or N'
      return (when) => ({ rule: 'earth', subject: l.t.part.designator, target: termName(l.t),
        message: `${termName(l.t)} is joined to earth${when}, but it is a mains terminal of ${l.t.part.designator} and must never be on earth. Wire it to ${to}.`,
        parts: [l.t.part.uid], pins: [endpointOf(l.t)], wires, causes: [l.t.key] })
    })
  }
  for (const gr of t.grounds) {
    const r = p.root[gr.node]
    if (!(p.ident[r] & PE_MASK)) continue
    let bonded = false
    for (let k = 0; k < t.bondNodes.length && !bonded; k++) bonded = p.root[t.bondNodes[k]] === r
    if (bonded || mark(acc, gr.key, mask)) continue
    report(acc, gr.key, mask, () => {
      const wires = wiresOfRoot(p, r)
      return (when) => ({ rule: 'earth-bond', subject: gr.t.part.designator, target: termName(gr.t),
        message: `${termName(gr.t)} is joined to earth${when}, but nothing on this net declares a bond to earth. Remove the join unless the supply is meant to be earthed (a class 1 supply with an earthed output).`,
        parts: [gr.t.part.uid], pins: [endpointOf(gr.t)], wires, causes: [gr.t.key] })
    })
  }
}

function peLiveDraft(p: Prepared, e: EarthTerm): (when: string) => MainsDraft {
  const x = identAt(p, e.node)
  const on = x & L_MASK && x & N_MASK ? 'L and N' : x & L_MASK ? 'L' : 'N'
  const d = e.t.part.designator
  const wires = pathsTo(p, [e.node], lnSources(p, x))
  return (when) => ({ rule: 'earth', subject: d, target: termName(e.t),
    message: `${termName(e.t)} is on ${on} instead of earth${when}: ${d}'s metal may be live. Wire ${termName(e.t)} to the outlet's earth, and nothing else to it.`,
    parts: [e.t.part.uid], pins: [endpointOf(e.t)], wires, causes: [e.t.key, nodeKey(e.t.part.uid, '#pe-live')] })
}

/**
 * A class 1 earth terminal on a node no source can reach (outside every enumeration unit), while its
 * part is on mains in some state: never earthed, so the finding holds in every state. The per-state
 * rule cannot see it, since that node is in no unit.
 */
function orphanEarth(acc: Acc): MainsDraft[] {
  const { p } = acc
  const g = p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const info = mainsOf(moduleOf(g.d, part.module)!)
    if (info.protection !== 'class-1') return []
    const pe = earthNames(info)
    if (![...info.terminals].some((n) => !pe.includes(n) && hotTerm(acc, part, n))) return []
    return pe.flatMap((n): MainsDraft[] => {
      const key = nodeKey(part.uid, n)
      const i = g.nodeOf.get(key)
      const t = termAt(g, key)
      if (i === undefined || p.inRel[i] || !t) return []
      return [{ rule: 'earth', subject: part.designator, target: termName(t), message: `${termName(t)} is not connected to earth: ${earthAdvice(t)}`,
        parts: [part.uid], pins: [endpointOf(t)], wires: [...g.wires[i]], causes: [key] }]
    })
  })
}

const THROUGH_WORDS: Record<ThroughKind, string> = { switch: 'a switch', relay: 'a relay', ssr: 'a solid state relay', fuse: 'a fuse' }

/** A protective conductor through a switch, relay, SSR or fuse (spec 3 rule 7), with the protective path it sits on highlighted. */
function earthPathRule(acc: Acc): MainsDraft[] {
  return protectivePaths(acc.p.g).through.map(({ part, kinds, wires }) => ({
    rule: 'earth', subject: part.designator, target: part.designator,
    message: `The earth path runs through ${part.designator} (${andList(kinds.map((k) => THROUGH_WORDS[k]))}). Earth must never pass through a switch, relay or fuse, because opening it may leave a part unearthed. Wire earth straight.`,
    parts: [part.uid], pins: [], wires, causes: [nodeKey(part.uid, '#earth-path')],
  }))
}

STATE_RULES.push(polarityRule, earthRules)
STATIC_RULES.push(orphanEarth, earthPathRule)

// ---- Rule 8: the project's own wiring is fused (spec 1.7, 3) ----

/**
 * What rule 8 judges in one view, made once so a state allocates nothing: the (load end, source)
 * pairs that some state could leave unfused, each with the source's L bit and L nodes and its finding
 * key (made on first use). A pair enters only when the end reaches the source's L over nets and every
 * contact position at once, no fuse: a fully fused circuit costs nothing per state.
 */
interface ProtTable { end: Int32Array; load: GLoad[]; src: GSource[]; bit: Uint32Array; live: Int32Array[]; keys: (string | undefined)[] }
const protCache = new WeakMap<Prepared, ProtTable>()
function protTable(p: Prepared): ProtTable {
  let t = protCache.get(p)
  if (t) return t
  const g = p.g
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.has(r)) r = parent.get(r)!
    return r
  }
  for (const gi of p.groupIdx)
    for (const list of g.groups[gi].closed)
      for (const [a, b] of list) {
        if (!p.inRel[a] || !p.inRel[b]) continue
        const [ra, rb] = [find(a), find(b)]
        if (ra !== rb) parent.set(ra, rb)
      }
  const pairs: { end: number; load: GLoad; src: GSource }[] = []
  for (const i of p.loadIdx) {
    const ld = g.loads[i]
    for (const end of [ld.a, ld.b])
      for (const s of p.sources) if (s.live.some((n) => find(n) === find(end))) pairs.push({ end, load: ld, src: s })
  }
  t = {
    end: Int32Array.from(pairs, (x) => x.end), load: pairs.map((x) => x.load), src: pairs.map((x) => x.src),
    bit: Uint32Array.from(pairs, (x) => bitOf(x.src.index, 'L')), live: pairs.map((x) => Int32Array.from(x.src.live)), keys: [],
  }
  protCache.set(p, t)
  return t
}

const unprotectedSlots = new WeakMap<Acc, Slots>()
/** Per accumulator, by slot: the unfused wiring gathered over the states a rule 8 finding holds in. */
const unprotectedPaths = new WeakMap<Acc, (PathRec | undefined)[] & { byKey: Map<string, PathRec> }>()
/**
 * Rule 8, per state (spec 3: a cut-set check per state): a load terminal on a source's L that still
 * reaches that source's L with every fuse taken out (nets and closed contacts only, bareRoots). An
 * empty holder is open already (the load then gets no L there, and fuseRules says why). A fuse inside
 * a plug-in device or cord plug is a protective edge like any other, so it protects everything behind
 * it. Allocation-free once a finding is known.
 */
function unprotectedRule(acc: Acc, mask: number) {
  const { p } = acc
  const t = protTable(p)
  const slots = slotsOf(unprotectedSlots, acc)
  let recs = unprotectedPaths.get(acc)
  if (!recs) unprotectedPaths.set(acc, (recs = Object.assign([], { byKey: new Map<string, PathRec>() })))
  const plain = plainPath.on
  const { root, ident } = p
  for (let q = 0; q < t.end.length; q++) {
    const end = t.end[q]
    if (!(ident[root[end]] & t.bit[q])) continue
    const bareRoot = bareRoots(p)
    const br = bareRoot[end]
    const live = t.live[q]
    let unfused = false
    for (let m = 0; m < live.length && !unfused; m++) unfused = bareRoot[live[m]] === br
    if (!unfused) continue
    let rec = recs[q]
    if (plain || !slotHit(slots, q, mask)) {
      let key = t.keys[q]
      // One finding per load and source, whichever end carries L: both ends' slots share its record.
      if (key === undefined) t.keys[q] = key = `unprotected|${t.load[q].part.uid}|${t.src[q].id}`
      if (!rec) {
        rec = recs.byKey.get(key)
        if (!rec) recs.byKey.set(key, (rec = { states: 0, wires: new Set() }))
        recs[q] = rec
      }
      const made = rec
      slotFill(acc, slots, q, key, mask, () => unprotectedDraft(t.load[q], t.src[q], made))
    }
    // The highlight is the union over the states it holds in (Ruling 33, as rule 1), up to PATH_STATES of them.
    if (rec && rec.states < PATH_STATES) {
      rec.states++
      for (const i of p.relevant) if (bareRoot[i] === br) for (const wire of p.g.wires[i]) rec.wires.add(wire)
    }
  }
}

function unprotectedDraft(ld: GLoad, s: GSource, rec: PathRec): (when: string) => MainsDraft {
  // The unfused wiring: every wire on the nets joined to the source's L without a fuse, in any state the finding holds in.
  const [d, src] = [ld.part.designator, s.part.designator]
  return (when) => ({
    rule: 'unprotected', subject: d, target: d,
    message: `Nothing fuses the L wire from ${src} to ${d}${when}: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.`,
    parts: [ld.part.uid, s.part.uid], pins: [], wires: [...rec.wires], causes: [nodeKey(ld.part.uid, ld.names[0]), ...s.keys.L],
  })
}

/**
 * Rule 8, once: a fitted fuse with no rating on a node that is ever hazardous; and a load that never
 * gets mains because a fuse holder is empty. Resolution 28: a load is told so only when it is proven
 * (it gets L and N of one source in some state with every empty holder taken as fitted, and in none as
 * drawn), and a holder is named only when fitting it alone restores a supply in a state that can
 * occur. Nothing about empty holders is claimed when the checks did not finish.
 */
function fuseRules(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  const out: MainsDraft[] = []
  for (const e of g.edges) {
    if (e.kind !== 'protective' || !e.fitted || e.rating !== null || !(acc.hazardAny[e.a] || acc.hazardAny[e.b])) continue
    const d = e.part.designator
    out.push({ rule: 'fuse-rating-unknown', subject: d, target: d,
      message: `${d} has a fuse fitted but no rating, so the drawing does not say which fuse to fit. Set its rating in amps.`,
      parts: [e.part.uid], pins: e.names.map((n) => ({ part: e.part.uid, pin: n })), wires: [], causes: e.names.map((n) => nodeKey(e.part.uid, n)) })
  }
  if (acc.incomplete) return out
  g.loads.forEach((ld, i) => {
    if (acc.loadComplete[i] || !acc.loadFit[i]) return
    const holders = [...(acc.loadFixers.get(i) ?? [])].sort((x, y) => natural.compare(x.designator, y.designator))
    const d = ld.part.designator
    const names = holders.map((h) => h.designator)
    out.push({ rule: 'no-power', subject: d, target: d,
      message: holders.length
        ? `${d} has no mains power: ${andList(names)} ${holders.length === 1 ? 'has' : 'have'} no fuse fitted. Fit a fuse in ${orList(names)}.`
        : `${d} has no mains power: every supply path to it runs through more than one empty fuse holder. Fit a fuse in every empty holder on its supply path.`,
      parts: [ld.part.uid, ...holders.map((h) => h.uid)], pins: [], wires: [],
      causes: [nodeKey(ld.part.uid, ld.names[0]), ...holders.map((h) => nodeKey(h.uid, '#absent'))] })
  })
  return out
}

// ---- Rule 9: cables on mains and on the earth path (spec 1.8, Ruling 35) ----

/** Wire ends that are clearly unsuitable for mains or earth (spec 1.8). */
export const UNSUITABLE_ENDS: ReadonlySet<EndKind> = new Set<EndKind>(['dupont-male', 'dupont-female', 'alligator', 'jst-xh', 'jst-ph', 'jst-sh', 'grove', 'banana', 'solid-jumper'])
/** At this gauge or thinner a wire is clearly unsuitable (spec 1.8). */
const THIN_AWG = 24
const CABLE_ADVICE = 'Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.'
/** An end kind in a sentence: END_NAMES is written for a select, so a common noun loses its capital ("alligator clip"); names keep theirs ("Dupont female"). */
const endWords = (k: EndKind): string => (/^(Dupont|JST|Grove)/.test(END_NAMES[k]) ? END_NAMES[k] : END_NAMES[k].charAt(0).toLowerCase() + END_NAMES[k].slice(1))

/** A wire end as the user reads it (as checks.ts names wire ends). */
function wireEnd(g: MainsGraph, ep: Endpoint): string {
  const t = termAt(g, nodeKey(ep.part, ep.pin))
  const name = t ? termName(t) : `${g.d.parts.find((x) => x.uid === ep.part)?.designator ?? ep.part} ${ep.pin}`
  return ep.hole !== undefined ? `${name} hole ${ep.hole}` : name
}

/**
 * Rule 9, once: every wire on a net that is ever hazardous, and every protective conductor (Task 8's
 * paths), is either clearly unsuitable (mains-cable) or cannot be checked (cable-unverified). A
 * functional DC ground joined to a bonded minus is not protective, so it is not judged here.
 */
function cableRules(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  const pe = protectivePaths(g)
  const out: MainsDraft[] = []
  for (const c of g.d.connections) {
    if (g.broken.has(c.uid)) continue
    const i = g.nodeOf.get(nodeKey(c.from.part, c.from.pin))
    const live = i !== undefined && acc.hazardAny[i] === 1
    if (!live && !pe.wires.has(c.uid)) continue
    const name = c.label || `${wireEnd(g, c.from)} to ${wireEnd(g, c.to)}`
    const what = live ? 'carries mains' : 'is part of the earth path'
    const ends = [...new Set([endKind(c.ends, 'from'), endKind(c.ends, 'to')].filter((k) => UNSUITABLE_ENDS.has(k)))]
    const gauge = c.gauge ?? 22
    const reasons = [...(ends.length ? [`has ${andList(ends.map(endWords))} ends`] : []), ...(gauge >= THIN_AWG ? [`is ${gauge} AWG`] : [])]
    const base = { subject: name, target: name, parts: [c.from.part, c.to.part], pins: [], wires: [c.uid], select: { parts: [], wires: [c.uid] }, causes: [c.uid] }
    out.push(reasons.length
      ? { ...base, rule: 'mains-cable', message: `The wire ${name} ${what}, but it ${reasons.join(' and ')}. ${CABLE_ADVICE}` }
      : { ...base, rule: 'cable-unverified', message: `The wire ${name} ${what}. Circuitoon cannot check its insulation or rating: ${CABLE_ADVICE.charAt(0).toLowerCase()}${CABLE_ADVICE.slice(1)}` })
  }
  return [...out, ...stripRule(acc, pe.strips)]
}

/**
 * Ruling 35: a breadboard strip (a hole group of a board without mains data) on a net that is ever
 * hazardous, or on a protective path, is rated for neither. One finding per board, its strips in
 * name order, those on mains first.
 */
function stripRule(acc: Acc, earthStrips: { part: string; group: string }[]): MainsDraft[] {
  const { p } = acc
  const g = p.g
  const byBoard = new Map<string, { board: PartInstance; live: Map<string, GTerm>; earth: Map<string, GTerm> }>()
  const add = (t: GTerm, live: boolean) => {
    let e = byBoard.get(t.part.uid)
    if (!e) byBoard.set(t.part.uid, (e = { board: t.part, live: new Map(), earth: new Map() }))
    if (live) {
      e.live.set(t.key, t)
      e.earth.delete(t.key)
    } else if (!e.live.has(t.key)) e.earth.set(t.key, t)
  }
  const strip = (t: GTerm | null): t is GTerm => !!t && !t.info.any && isBoard(t.module) && !!t.module.holes?.some((h) => h.name === t.name)
  for (const i of p.relevant) {
    if (!acc.hazardAny[i]) continue
    for (const k of g.members[i]) {
      const t = termAt(g, k)
      if (strip(t)) add(t, true)
    }
  }
  for (const s of earthStrips) {
    const t = termAt(g, nodeKey(s.part, s.group))
    if (strip(t)) add(t, false)
  }
  return [...byBoard.values()].map(({ board, live, earth }): MainsDraft => {
    const sorted = (m: Map<string, GTerm>) => [...m.values()].sort((a, b) => natural.compare(termName(a), termName(b)))
    const [on, pe] = [sorted(live), sorted(earth)]
    const clauses = [
      ...(on.length ? [`${andList(on.map(termName))} ${on.length === 1 ? 'carries' : 'carry'} mains`] : []),
      ...(pe.length ? [`${andList(pe.map(termName))} ${pe.length === 1 ? 'is' : 'are'} on the earth path`] : []),
    ]
    const terms = [...on, ...pe]
    const wires = [...new Set(terms.flatMap((t) => g.wires[g.nodeOf.get(t.key)!] ?? []))]
    return {
      rule: 'mains-cable', subject: board.designator, target: termName(terms[0]),
      message: `${clauses.join(' and ')}, but a breadboard strip is not rated for mains or protective earth. Use rated terminals, such as a terminal block or a lever connector, in place of the breadboard.`,
      parts: [board.uid], pins: terms.map(endpointOf), wires, causes: terms.map((t) => t.key),
    }
  })
}

// ---- Rule 13: the checks did not finish (spec 1.5, 6) ----

/** What the per-state rules would have judged, which an incomplete sheet does not check (spec 6: list what was not checked). */
const NOT_CHECKED = 'Not checked: mains on low-voltage wiring, shorts, outlets joined to each other, mains voltages, polarity, earthing, fuses in the L wire and which loads get power.'

function incompleteRule(acc: Acc): MainsDraft[] {
  if (!acc.incomplete) return []
  const g = acc.p.g
  const groups = acc.incomplete === 'groups'
  const what = groups ? `${acc.cands.length} switches and relays` : `${g.sources.length} AC sources`
  const parts = [...new Set(groups ? acc.cands.map((i) => g.groups[i].part) : g.sources.map((s) => s.part))].sort((a, b) => natural.compare(a.designator, b.designator))
  return [{ rule: 'mains-incomplete', subject: parts[0].designator, target: parts[0].designator,
    message: `Mains checks did not finish: ${what}. ${NOT_CHECKED} Split the drawing or check the rest by hand.`,
    parts: parts.map((x) => x.uid), pins: [], wires: [], causes: ['#mains-incomplete'] }]
}

STATE_RULES.push(unprotectedRule)
STATIC_RULES.push(fuseRules, cableRules, incompleteRule)
