// The mains rules (spec section 3). Per-state rules run for every enumerated contact state of one
// enumeration unit and report findings by a stable key; each finding keeps one bit per state it holds
// in, so its wording names exactly the conditions it needs (Resolution 24). Static rules run once
// afterwards on what the states established (which nodes were ever hazardous, at what voltage). Pure.
import type { Endpoint } from './diagram.ts'
import type { RuleId } from './checks.ts'
import { nodeKey } from './netlist.ts'
import { type GConverter, type GEdge, type GTerm, type MainsGraph, type Prepared, LN_MASK, bitOf, decodeSingle, minimalWitnesses, statePhrase } from './mainsGraph.ts'
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
