// The mains conduction graph (spec 1.2). Nodes are the sheet's nets: wires, internal joins and
// plugged contacts already join those at zero ohms. Typed edges join nets through a part: fitted
// fuses (protective; an absent fuse is open), loads, leakage paths, energy that crosses an
// inadequate isolation barrier or an undeclared mains terminal (energize), and the contacts of
// switches, relays and SSRs, whose edges depend on the state. Identity (which source conductor a
// node is) closes over nets, fitted fuses and closed contacts; energization closes onward over
// loads, leakage and energize edges. Pure; one state at a time, in reused typed arrays.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import type { Plug } from './breadboard.ts'
import { type Netlist, nodeKey } from './netlist.ts'
import { type ModuleDef, type PinType, isNetLabel, isSpacer, partSetting } from './module.ts'
import { paramValue } from './values.ts'
import { andList, natural } from './words.ts'
import type { Acc } from './mainsRules.ts'
import { type Conductor, type ContactGroup, type MainsInfo, type Region, type SocketFamily, isolationAdequate, mainsOf, uncoveredPins } from './mainsModel.ts'

/** Identity is one 30-bit mask: three bits (L, N, PE) per source. More sources than this: see mains-incomplete. */
export const MAX_SOURCES = 10
const CI: Record<Conductor, number> = { L: 0, N: 1, PE: 2 }
const COND: Conductor[] = ['L', 'N', 'PE']
export const bitOf = (s: number, c: Conductor): number => 1 << (s * 3 + CI[c])
const every = (c: number) => {
  let m = 0
  for (let s = 0; s < MAX_SOURCES; s++) m |= 1 << (s * 3 + c)
  return m
}
export const L_MASK = every(0)
export const N_MASK = every(1)
export const PE_MASK = every(2)
export const LN_MASK = L_MASK | N_MASK
/**
 * A power bit beside the source bits (which use bits 0 to MAX_SOURCES - 1): set on energy that has
 * reached a node from L or N without crossing an isolation barrier (over nets, fitted fuses, closed
 * contacts, loads, leakage, and a mains terminal's undeclared conduction). Energy across a barrier
 * that is not protective separation drops it: that side may be live (rule 1), but it is not mains
 * wiring, so the DC checks still run there (final review 1).
 */
export const MAINS_POW = 1 << 15
/** The source and conductor of a mask with exactly one bit set. */
export function decodeSingle(x: number): { s: number; c: Conductor } {
  const b = 31 - Math.clz32(x)
  return { s: Math.floor(b / 3), c: COND[b % 3] }
}

export interface GTerm { key: string; part: PartInstance; module: ModuleDef; info: MainsInfo; name: string; label: string; type?: PinType }
export interface GSource {
  index: number
  id: string
  part: PartInstance
  volts: number
  region: Region | null
  /** False when no standard fixes which slot is L (an unpolarized Japanese outlet, Schuko, French, Europlug): polarity downstream is unknowable. */
  polarized: boolean
  live: number[]
  neutral: number[]
  earth: number[]
  keys: Record<Conductor, string[]>
}
/** Sockets whose L side no standard fixes (Resolution 22; `cee7-5` by ruling B5: the plug enters one way, but no standard says which hole is L). */
const UNPOLARIZED_SOCKETS: SocketFamily[] = ['nema-1-15r', 'cee7-3', 'cee7-5', 'cee7-16']
export interface GEdge {
  kind: 'protective' | 'load' | 'leakage' | 'energize'
  a: number
  b: number
  part: PartInstance
  names: [string, string]
  /** Energy flows a to b only (across an isolation barrier). */
  directed: boolean
  /** A protective edge whose fuse is fitted (every other edge: true). */
  fitted: boolean
  /** A protective edge's rating in amps; null when unknown. */
  rating: number | null
  why: 'isolation' | 'undeclared' | null
}
export interface GGroup { part: PartInstance; def: ContactGroup; nodes: number[]; closed: [number, number][][]; leak: [number, number][][] }
export interface GConverter { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number]; outputs: string[]; plugIn: boolean }
export interface GLoad { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number] | null }
export interface MainsGraph {
  d: Diagram
  n: number
  members: string[][]
  nodeOf: Map<string, number>
  wires: string[][]
  /** Connections the netlist left out (an end does not resolve): they conduct nothing. */
  broken: Set<string>
  sources: GSource[]
  edges: GEdge[]
  groups: GGroup[]
  converters: GConverter[]
  loads: GLoad[]
  mainsParts: PartInstance[]
  /** Parts with a wire or a plugged contact. */
  connected: Set<string>
  /** Parts with a validly plugged leg: a plug-in device or cord plug seated in its outlet (a partial or invalid mount plugs nothing). */
  seated: Set<string>
  termCache: Map<string, GTerm | null>
}

/** Every named terminal of a module: pins (not spacers), hole groups and internal nodes. */
function terminalNames(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => (isSpacer(p) ? [] : [p.name])), ...(m.holes ?? []).map((g) => g.name), ...info.internalNodes]
}

/** A converter's DC outputs: its power_out pins outside the mains domain. */
function outputsOf(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => (isSpacer(p) ? [] : [p])), ...(m.holes ?? [])]
    .filter((p) => p.type === 'power_out' && info.domainOf.get(p.name)?.kind !== 'mains').map((p) => p.name)
}

export function buildMainsGraph(d: Diagram, plugs: Plug[], nl: Netlist): MainsGraph | null {
  const mainsParts = d.parts.filter((p) => {
    const m = moduleOf(d, p.module)
    return !!m && mainsOf(m).any
  })
  if (!mainsParts.length) return null
  const members: string[][] = nl.nets.slice()
  const nodeOf = new Map<string, number>()
  members.forEach((keys, i) => keys.forEach((k) => nodeOf.set(k, i)))
  const node = (part: string, name: string): number => {
    const k = nodeKey(part, name)
    let i = nodeOf.get(k)
    if (i === undefined) {
      i = members.length
      members.push([k])
      nodeOf.set(k, i)
    }
    return i
  }
  const sources: GSource[] = []
  const edges: GEdge[] = []
  const groups: GGroup[] = []
  const converters: GConverter[] = []
  const loads: GLoad[] = []
  const edge = (e: Partial<GEdge> & Pick<GEdge, 'kind' | 'a' | 'b' | 'part' | 'names'>) =>
    edges.push({ directed: false, fitted: true, rating: null, why: null, ...e })
  for (const p of mainsParts) {
    const m = moduleOf(d, p.module)!
    const info = mainsOf(m)
    for (const t of terminalNames(m, info)) node(p.uid, t)
    for (const src of info.acSources) {
      const volts = paramValue(p, m, 'acVoltage')
      if (volts === null) continue
      sources.push({
        index: sources.length, id: `${p.uid}:${src.id}`, part: p, volts, region: info.region,
        polarized: !info.sockets.some((x) => UNPOLARIZED_SOCKETS.includes(x.family)),
        live: src.live.map((n) => node(p.uid, n)), neutral: src.neutral.map((n) => node(p.uid, n)), earth: src.earth.map((n) => node(p.uid, n)),
        keys: { L: src.live.map((n) => nodeKey(p.uid, n)), N: src.neutral.map((n) => nodeKey(p.uid, n)), PE: src.earth.map((n) => nodeKey(p.uid, n)) },
      })
    }
    for (const e of info.protective)
      edge({ kind: 'protective', a: node(p.uid, e.from), b: node(p.uid, e.to), part: p, names: [e.from, e.to],
        fitted: partSetting(p, m, 'fuse') !== 'absent', rating: e.rating ?? paramValue(p, m, 'fuseRating') })
    for (const c of info.conducts) {
      const [a, b] = [node(p.uid, c.pins[0]), node(p.uid, c.pins[1])]
      edge({ kind: c.kind, a, b, part: p, names: c.pins })
      if (c.kind === 'load') loads.push({ part: p, a, b, names: c.pins, range: c.range })
    }
    if (info.acInput) {
      const { a, b, range } = info.acInput
      const [na, nb] = [node(p.uid, a), node(p.uid, b)]
      // A converter's input draws current between its terminals, like a load.
      edge({ kind: 'load', a: na, b: nb, part: p, names: [a, b] })
      converters.push({ part: p, a: na, b: nb, names: [a, b], range, outputs: outputsOf(m, info), plugIn: !!info.plug })
    }
    // Energy crosses an isolation barrier that is not protective separation (spec 1.3), and reaches
    // every pin of a converter that no domain covers (Resolution 27: the data is missing, so that pin
    // is taken as live; rule 12 names it).
    const primary = info.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins)
    const declared = info.domains.filter((x) => x.kind !== 'mains').flatMap((x) => x.pins)
    const exposed = [...(isolationAdequate(info) ? [] : declared), ...(info.acInput ? uncoveredPins(m, info) : [])]
    const from = primary.length ? primary : info.acInput ? [info.acInput.a, info.acInput.b] : []
    for (const a of from) for (const b of exposed) edge({ kind: 'energize', a: node(p.uid, a), b: node(p.uid, b), part: p, names: [a, b], directed: true, why: 'isolation' })
    // A mains terminal whose conduction the module does not declare: energy passes both ways
    // between it and every other mains terminal of the part (spec 1.2, conservative).
    for (const t of info.terminals) {
      if (info.declaredConduction.has(t)) continue
      for (const o of info.terminals) if (o !== t) edge({ kind: 'energize', a: node(p.uid, t), b: node(p.uid, o), part: p, names: [t, o], why: 'undeclared' })
    }
    for (const def of info.contacts) {
      const closed: [number, number][][] = [[], []]
      const leak: [number, number][][] = [[], []]
      const nodes: number[] = []
      for (const pole of def.poles) {
        const com = node(p.uid, pole.com)
        const no = pole.no !== null ? node(p.uid, pole.no) : null
        const nc = pole.nc !== null ? node(p.uid, pole.nc) : null
        nodes.push(com, ...(no !== null ? [no] : []), ...(nc !== null ? [nc] : []))
        if (def.kind === 'ssr') {
          if (no !== null) {
            leak[0].push([com, no])
            closed[1].push([com, no])
          }
        } else {
          if (nc !== null) closed[0].push([com, nc])
          if (no !== null) closed[1].push([com, no])
        }
      }
      groups.push({ part: p, def, nodes, closed, leak })
    }
  }
  const broken = new Set(nl.broken)
  const wires: string[][] = members.map(() => [])
  const connected = new Set<string>(plugs.map((pl) => pl.part))
  for (const c of d.connections) {
    if (broken.has(c.uid)) continue
    connected.add(c.from.part)
    connected.add(c.to.part)
    const i = nodeOf.get(nodeKey(c.from.part, c.from.pin))
    if (i !== undefined) wires[i].push(c.uid)
  }
  return { d, n: members.length, members, nodeOf, wires, broken, sources, edges, groups, converters, loads, mainsParts, connected, seated: new Set(plugs.map((pl) => pl.part)), termCache: new Map() }
}

/** The terminal a node key names, with its module's mains data; null for a missing part or name. Cached per graph. */
export function termAt(g: MainsGraph, key: string): GTerm | null {
  if (g.termCache.has(key)) return g.termCache.get(key)!
  const [uid, name] = JSON.parse(key) as [string, string]
  const part = g.d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(g.d, part.module)
  let t: GTerm | null = null
  // A net label is no terminal: it only joins nets (which the netlist already did).
  if (part && m && !isNetLabel(m)) {
    const info = mainsOf(m)
    const pin = m.pins.find((p) => !isSpacer(p) && p.name === name)
    const def = pin && !isSpacer(pin) ? pin : m.holes?.find((h) => h.name === name)
    if (def || info.internalNodes.includes(name)) t = { key, part, module: m, info, name, label: def?.label ?? name, type: def?.type }
  }
  g.termCache.set(key, t)
  return t
}

export const termName = (t: GTerm): string => `${t.part.designator} ${t.label}`

export function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]
    x = parent[x]
  }
  return x
}
export function union(parent: Int32Array, a: number, b: number) {
  const ra = find(parent, a)
  const rb = find(parent, b)
  if (ra !== rb) parent[ra] = rb
}
const identity = (n: number) => Int32Array.from({ length: n }, (_, i) => i)

/** Component root per node when every edge and every contact position conducts at once (spec 1.5). */
export function possibleRoots(g: MainsGraph): Int32Array {
  const parent = identity(g.n)
  for (const e of g.edges) union(parent, e.a, e.b)
  for (const grp of g.groups) for (const list of [...grp.closed, ...grp.leak]) for (const [a, b] of list) union(parent, a, b)
  for (let i = 0; i < g.n; i++) parent[i] = find(parent, i)
  return parent
}

export interface Prepared {
  g: MainsGraph
  /** Possible-connectivity root per node. */
  possible: Int32Array
  /** The nodes this analysis covers: every node in a possible-connectivity component with a source terminal or a converter input (a view narrows it to one enumeration unit). Only these can carry identity or energy. */
  relevant: Int32Array
  /** 1 for a node in `relevant`. */
  inRel: Uint8Array
  /** The sources, contact groups, loads, converters, fuses and energy edges with terminals in `relevant`. A view's sources keep their global `index` but list only their nodes inside the view. */
  sources: GSource[]
  groupIdx: number[]
  loadIdx: number[]
  converterIdx: number[]
  protective: GEdge[]
  /** Load, leakage and energize edges inside `relevant`. */
  energy: GEdge[]
  /** Union-find bases: nets plus fitted fuses (identity), nets alone (the unprotected rule), nets plus every fuse (an empty holder taken as fitted, Resolution 28). */
  base: Int32Array
  bareBase: Int32Array
  fitBase: Int32Array
  /** True when some fuse holder is empty (only then is `fitRoot` computed). */
  anyAbsent: boolean
  // Scratch, reused by every state and shared by views; only `relevant` entries are ever read or written.
  parent: Int32Array
  bareParent: Int32Array
  fitParent: Int32Array
  root: Int32Array
  /** Read it through bareRoots(p), which fills it for the current state on first use. */
  bareRoot: Int32Array
  fitRoot: Int32Array
  /** Identity mask at each root. */
  ident: Uint32Array
  /** Energizing sources (one bit per source) at each root. */
  power: Uint16Array
  /** Per contact group: 0 released or off, 1 energized or on. */
  groupState: Int8Array
  /** The distinct roots holding identity in this state. */
  srcRoots: number[]
}

export function prepare(g: MainsGraph): Prepared {
  const possible = possibleRoots(g)
  const live = new Set<number>()
  for (const s of g.sources) for (const x of [...s.live, ...s.neutral, ...s.earth]) live.add(possible[x])
  for (const c of g.converters) live.add(possible[c.a]).add(possible[c.b])
  const relevant = Int32Array.from([...Array(g.n).keys()].filter((i) => live.has(possible[i])))
  const inRel = new Uint8Array(g.n)
  for (const i of relevant) inRel[i] = 1
  const base = identity(g.n)
  const bareBase = identity(g.n)
  const fitBase = identity(g.n)
  let anyAbsent = false
  for (const e of g.edges) {
    if (e.kind !== 'protective') continue
    union(fitBase, e.a, e.b)
    if (e.fitted) union(base, e.a, e.b)
    else anyAbsent = true
  }
  return {
    g, possible, relevant, inRel,
    sources: g.sources,
    groupIdx: g.groups.flatMap((grp, i) => (grp.nodes.some((x) => inRel[x]) ? [i] : [])),
    loadIdx: g.loads.flatMap((l, i) => (inRel[l.a] ? [i] : [])),
    converterIdx: g.converters.flatMap((c, i) => (inRel[c.a] ? [i] : [])),
    protective: g.edges.filter((e) => e.kind === 'protective' && inRel[e.a]),
    energy: g.edges.filter((e) => e.kind !== 'protective' && inRel[e.a] && inRel[e.b]),
    base, bareBase, fitBase, anyAbsent,
    parent: new Int32Array(g.n), bareParent: new Int32Array(g.n), fitParent: new Int32Array(g.n),
    root: identity(g.n), bareRoot: identity(g.n), fitRoot: identity(g.n),
    ident: new Uint32Array(g.n), power: new Uint16Array(g.n), groupState: new Int8Array(g.groups.length), srcRoots: [],
  }
}

/** Moves energy one step along a-b (a to b only when directed, across an isolation barrier, which drops MAINS_POW). True when anything changed. */
export function flow(root: Int32Array, power: Uint16Array, a: number, b: number, directed: boolean): boolean {
  const ra = root[a]
  const rb = root[b]
  if (ra === rb) return false
  let moved = false
  const f = power[ra] & ~power[rb] & (directed ? ~MAINS_POW : 0xffff)
  if (f) {
    power[rb] |= f
    moved = true
  }
  if (!directed) {
    const back = power[rb] & ~power[ra]
    if (back) {
      power[ra] |= back
      moved = true
    }
  }
  return moved
}

/**
 * The fixed shape of one analysis, flattened once into typed arrays so a state walks plain numbers:
 * each group's contact pairs per position, only those with both ends in the analysis (a view's
 * multi-pole group may have a pole outside it, and scratch entries outside `relevant` are never
 * written); the source terminals in the order analyseState applies them; and the energy edges. The
 * pairs of group `gi` in position `s` are `closedAB[2 * j]` and `closedAB[2 * j + 1]` for `j` from
 * `closedAt[gi * 2 + s]` up to `closedAt[gi * 2 + s + 1]` (the same for leakage).
 */
interface Plan {
  closedAt: Int32Array
  closedAB: Int32Array
  leakAt: Int32Array
  leakAB: Int32Array
  /** The groups that leak in some position (an SSR's OFF leakage, say): the rest need no per-state visit. */
  leakGroupIdx: Int32Array
  /** Source terminals: node, identity bit, and the power bit it starts (0 for earth). */
  srcNode: Int32Array
  srcBit: Uint32Array
  srcPow: Uint16Array
  /** The energy edges the fixed point iterates: every one whose far end can pass energy on. */
  energyA: Int32Array
  energyB: Int32Array
  energyDir: Uint8Array
  /**
   * Directed edges into a dead end: a node whose component over nets, every fuse and every contact
   * and leakage pair in any position holds no end of an undirected edge or leak pair and no tail of a
   * directed edge. In any state its root lies inside that component, so energy reaching it goes no
   * further: these are applied once, after the fixed point, with the same result.
   */
  sinkA: Int32Array
  sinkB: Int32Array
  /**
   * Dead ends whose power is known before any state: some tail into them always carries every source
   * the view can energize with (a source's L or N sits on the tail's base component, so on its root in
   * every state). Such a node always ends with `allPow`, so it takes that in one step, and its edges
   * are left out of `sinkA`.
   */
  sinkFull: Int32Array
  allPow: number
  anyLeak: boolean
  /** What no state changes, per node (see steadyOf). */
  steady: Steady
  /**
   * The union-find over base roots only: every relevant node's root in `base` (`reps`, the nodes the
   * state's unions and finds walk), the rest with their base root (`others`, `othersRep`), and the
   * closed pairs with each end replaced by its base root (`closedRep`). Unions only ever link roots,
   * so starting from the base roots gives every node the same root as starting from `base` itself.
   * The same over `fitBase` for the fitted-fuse pass.
   */
  reps: Int32Array
  /** The first `moving` of `reps` lie where a closed pair can join them; the rest are their own root in every state, so the unions and finds skip them. */
  moving: number
  others: Int32Array
  othersRep: Int32Array
  closedRep: Int32Array
  fitReps: Int32Array
  fitMoving: number
  fitOthers: Int32Array
  fitOthersRep: Int32Array
  closedFitRep: Int32Array
}
/**
 * A WeakMap with a one-entry front: the per-state code asks for the same analysis's tables state after
 * state, and comparing one pointer is cheaper than a lookup. It holds its last key until another
 * replaces it.
 */
export class FrontMap<K extends object, V> {
  private map = new WeakMap<K, V>()
  private lastKey: K | null = null
  private lastValue: V | undefined = undefined
  get(k: K): V | undefined {
    if (k === this.lastKey) return this.lastValue
    const v = this.map.get(k)
    if (v !== undefined) {
      this.lastKey = k
      this.lastValue = v
    }
    return v
  }
  set(k: K, v: V): this {
    this.map.set(k, v)
    this.lastKey = k
    this.lastValue = v
    return this
  }
}

const plans = new FrontMap<Prepared, Plan>()

function planOf(p: Prepared): Plan {
  let plan = plans.get(p)
  if (plan) return plan
  const { g, inRel } = p
  const pairs = (which: 'closed' | 'leak') => {
    const at = new Int32Array(g.groups.length * 2 + 1)
    const ab: number[] = []
    for (let gi = 0; gi < g.groups.length; gi++)
      for (let s = 0; s < 2; s++) {
        at[gi * 2 + s] = ab.length / 2
        // Only the view's groups are ever applied; the others keep an empty range.
        if (p.groupIdx.includes(gi)) for (const [a, b] of g.groups[gi][which][s]) if (inRel[a] && inRel[b]) ab.push(a, b)
      }
    at[g.groups.length * 2] = ab.length / 2
    return { at, ab: Int32Array.from(ab) }
  }
  const closed = pairs('closed')
  const leak = pairs('leak')
  const leakGroupIdx = Int32Array.from(p.groupIdx.filter((gi) => leak.at[gi * 2] < leak.at[gi * 2 + 1] || leak.at[gi * 2 + 1] < leak.at[gi * 2 + 2]))
  const node: number[] = []
  const bit: number[] = []
  const pow: number[] = []
  for (const s of p.sources) {
    for (const x of s.live) node.push(x), bit.push(bitOf(s.index, 'L')), pow.push((1 << s.index) | MAINS_POW)
    for (const x of s.neutral) node.push(x), bit.push(bitOf(s.index, 'N')), pow.push((1 << s.index) | MAINS_POW)
    for (const x of s.earth) node.push(x), bit.push(bitOf(s.index, 'PE')), pow.push(0)
  }
  // Components that can never pass energy on (see Plan.sinkA): joined over nets, every fuse, and
  // every contact and leak pair; a component feeds when it holds a tail or an undirected end.
  const reach = p.fitBase.slice()
  for (const ab of [closed.ab, leak.ab]) for (let j = 0; j < ab.length; j += 2) union(reach, ab[j], ab[j + 1])
  const feeds = new Uint8Array(g.n)
  for (const e of p.energy) {
    feeds[find(reach, e.a)] = 1
    if (!e.directed) feeds[find(reach, e.b)] = 1
  }
  for (let j = 0; j < leak.ab.length; j++) feeds[find(reach, leak.ab[j])] = 1
  const core = p.energy.filter((e) => !e.directed || feeds[find(reach, e.b)])
  // Power a node's root holds in every state: that of the source terminals on its base component.
  const baseRoot = p.base.slice()
  const staticPow = new Uint16Array(g.n)
  let allPow = 0
  for (let k = 0; k < node.length; k++) {
    staticPow[find(baseRoot, node[k])] |= pow[k]
    allPow |= pow[k]
  }
  const full = new Set<number>()
  for (const e of p.energy) if (e.directed && !feeds[find(reach, e.b)] && staticPow[find(baseRoot, e.a)] === allPow) full.add(e.b)
  const sink = p.energy.filter((e) => e.directed && !feeds[find(reach, e.b)] && !full.has(e.b))
  // A base root outside every component that holds a closed pair is never joined to anything: its root is itself in every state.
  const switched = new Uint8Array(g.n)
  for (let j = 0; j < closed.ab.length; j++) switched[find(reach, closed.ab[j])] = 1
  const over = (forest: Int32Array) => {
    const f = forest.slice()
    const moving: number[] = []
    const fixed: number[] = []
    const others: number[] = []
    const othersRep: number[] = []
    for (const i of p.relevant) {
      const r = find(f, i)
      if (r !== i) others.push(i), othersRep.push(r)
      else if (switched[find(reach, i)]) moving.push(i)
      else fixed.push(i)
    }
    return { reps: Int32Array.from([...moving, ...fixed]), moving: moving.length, others: Int32Array.from(others), othersRep: Int32Array.from(othersRep), closed: closed.ab.map((x) => find(f, x)) }
  }
  const b = over(p.base)
  const fb = p.anyAbsent ? over(p.fitBase) : b
  const steady: Steady = { fixed: new Uint8Array(g.n), ident: new Uint32Array(g.n), powerKnown: new Uint8Array(g.n), power: new Uint16Array(g.n) }
  const baseIdent = new Uint32Array(g.n)
  for (let k = 0; k < node.length; k++) baseIdent[find(baseRoot, node[k])] |= bit[k]
  const fullRoot = new Uint8Array(g.n)
  for (const x of full) fullRoot[find(baseRoot, x)] = 1
  for (const i of p.relevant) {
    const r = find(baseRoot, i)
    const fixed = !switched[find(reach, i)]
    steady.fixed[i] = fixed ? 1 : 0
    if (fixed) steady.ident[i] = baseIdent[r]
    // Power only grows and never passes allPow: a root that starts with all of it ends with exactly
    // that; a fixed dead end fed all of it across a barrier (which drops MAINS_POW) ends with that and its own.
    if (staticPow[r] === allPow) {
      steady.powerKnown[i] = 1
      steady.power[i] = allPow
    } else if (fixed && fullRoot[r]) {
      steady.powerKnown[i] = 1
      steady.power[i] = staticPow[r] | (allPow & ~MAINS_POW)
    }
  }
  plan = {
    reps: b.reps, moving: b.moving, others: b.others, othersRep: b.othersRep, closedRep: b.closed,
    fitReps: fb.reps, fitMoving: fb.moving, fitOthers: fb.others, fitOthersRep: fb.othersRep, closedFitRep: fb.closed,
    closedAt: closed.at, closedAB: closed.ab, leakAt: leak.at, leakAB: leak.ab, leakGroupIdx,
    srcNode: Int32Array.from(node), srcBit: Uint32Array.from(bit), srcPow: Uint16Array.from(pow),
    energyA: Int32Array.from(core, (e) => e.a), energyB: Int32Array.from(core, (e) => e.b), energyDir: Uint8Array.from(core, (e) => (e.directed ? 1 : 0)),
    sinkA: Int32Array.from(sink, (e) => e.a), sinkB: Int32Array.from(sink, (e) => e.b), sinkFull: Int32Array.from(full), allPow,
    anyLeak: leak.ab.length > 0, steady,
  }
  plans.set(p, plan)
  return plan
}

/**
 * Identity and energization for the state in `p.groupState`, over `p.relevant` only: resetting and
 * walking just these nodes keeps a state's cost independent of the rest of the sheet. Results live in
 * `p` until the next call (`bareRoot` only through bareRoots, on first use). The hot path of the
 * enumeration, so it reads the flattened plan and allocates nothing; analyseStatePlain is the
 * reference it is checked against (see plainPath).
 *
 * Callers check `p.sources.length <= MAX_SOURCES` first (mains-incomplete otherwise; a unit's view
 * numbers its own sources, see viewOf): beyond ten sources the identity bits of one source alias
 * another's and the power bits overflow.
 *
 * Energization starts from L and N of every source (Ruling 33: N is a live conductor, and on an
 * unpolarized outlet no standard fixes which slot is L), then crosses loads, leakage and energize
 * edges: a switched-off lamp's L terminal is energized from the neutral across its filament. A rule
 * that must decide a branch is switched off reads identity (no L), never power.
 */
export function analyseState(p: Prepared): void {
  if (plainPath.on) return plainRef(plainPath.analyseState)(p)
  const plan = planOf(p)
  bareFor = null
  const { parent, fitParent, anyAbsent, root, fitRoot, ident, power, groupState, groupIdx } = p
  const { reps, moving, others, othersRep, closedAt, closedRep } = plan
  for (let k = 0; k < moving; k++) parent[reps[k]] = reps[k]
  for (let t = 0; t < groupIdx.length; t++) {
    const at = groupIdx[t] * 2 + groupState[groupIdx[t]]
    for (let j = closedAt[at], end = closedAt[at + 1]; j < end; j++) union(parent, closedRep[2 * j], closedRep[2 * j + 1])
  }
  for (let k = 0; k < reps.length; k++) {
    const i = reps[k]
    root[i] = k < moving ? find(parent, i) : i
    ident[i] = 0
    power[i] = 0
  }
  for (let k = 0; k < others.length; k++) {
    const i = others[k]
    root[i] = root[othersRep[k]]
    ident[i] = 0
    power[i] = 0
  }
  if (anyAbsent) {
    const { fitReps, fitMoving, fitOthers, fitOthersRep, closedFitRep } = plan
    for (let k = 0; k < fitMoving; k++) fitParent[fitReps[k]] = fitReps[k]
    for (let t = 0; t < groupIdx.length; t++) {
      const at = groupIdx[t] * 2 + groupState[groupIdx[t]]
      for (let j = closedAt[at], end = closedAt[at + 1]; j < end; j++) union(fitParent, closedFitRep[2 * j], closedFitRep[2 * j + 1])
    }
    for (let k = 0; k < fitReps.length; k++) fitRoot[fitReps[k]] = k < fitMoving ? find(fitParent, fitReps[k]) : fitReps[k]
    for (let k = 0; k < fitOthers.length; k++) fitRoot[fitOthers[k]] = fitRoot[fitOthersRep[k]]
  }
  const { srcNode, srcBit, srcPow } = plan
  const srcRoots = p.srcRoots
  srcRoots.length = 0
  for (let k = 0; k < srcNode.length; k++) {
    const r = root[srcNode[k]]
    if (!ident[r]) srcRoots.push(r)
    ident[r] |= srcBit[k]
    power[r] |= srcPow[k]
  }
  const { energyA, energyB, energyDir, leakAt, leakAB, leakGroupIdx, anyLeak } = plan
  for (let changed = true; changed; ) {
    changed = false
    for (let k = 0; k < energyA.length; k++) if (flow(root, power, energyA[k], energyB[k], energyDir[k] === 1)) changed = true
    if (anyLeak)
      for (let t = 0; t < leakGroupIdx.length; t++) {
        const gi = leakGroupIdx[t]
        const at = gi * 2 + groupState[gi]
        for (let j = leakAt[at], end = leakAt[at + 1]; j < end; j++) if (flow(root, power, leakAB[2 * j], leakAB[2 * j + 1], false)) changed = true
      }
  }
  const { sinkA, sinkB, sinkFull, allPow } = plan
  // Both are directed edges, across a barrier: they never carry MAINS_POW.
  for (let k = 0; k < sinkA.length; k++) {
    const f = power[root[sinkA[k]]] & ~MAINS_POW
    if (f) power[root[sinkB[k]]] |= f
  }
  const fullPow = allPow & ~MAINS_POW
  for (let k = 0; k < sinkFull.length; k++) power[root[sinkFull[k]]] |= fullPow
}

/**
 * The relevant nodes of `p` split by their root in `base`: `reps` are the base roots, and each of
 * `others` always shares its root (and so its identity and energy) with `othersRep` at the same
 * position, in every state. A per-node pass over a state can visit `reps` alone and copy the rest.
 */
export function baseReps(p: Prepared): { reps: Int32Array; others: Int32Array; othersRep: Int32Array } {
  return planOf(p)
}

/**
 * What no contact state changes, per relevant node of `p`: `fixed` is 1 when no closed pair can join
 * the node's component, so its root is its base root in every state and holds the identity `ident`
 * (that of the source terminals on its base component; identity crosses nothing else); `powerKnown`
 * is 1 when its energy is `power` in every state. Rules use it to skip work whose answer is known.
 */
export interface Steady { fixed: Uint8Array; ident: Uint32Array; powerKnown: Uint8Array; power: Uint16Array }
export function steadyOf(p: Prepared): Steady {
  return planOf(p).steady
}

/** The analysis whose `bareRoot` holds the current state (null: none since the last analyseState). */
let bareFor: Prepared | null = null

/**
 * The roots over nets and the current state's closed contacts alone, no fuse (rule 8 reads them to
 * tell a load is unfused), for the state analyseState last put in `p`. Made on first use per state:
 * most sheets fuse every load, and then no state needs them.
 */
export function bareRoots(p: Prepared): Int32Array {
  if (bareFor === p) return p.bareRoot
  const { closedAt, closedAB } = planOf(p)
  const { relevant: rel, bareParent, bareBase, bareRoot, groupState, groupIdx } = p
  for (let k = 0; k < rel.length; k++) bareParent[rel[k]] = bareBase[rel[k]]
  for (let t = 0; t < groupIdx.length; t++) {
    const at = groupIdx[t] * 2 + groupState[groupIdx[t]]
    for (let j = closedAt[at], end = closedAt[at + 1]; j < end; j++) union(bareParent, closedAB[2 * j], closedAB[2 * j + 1])
  }
  for (let k = 0; k < rel.length; k++) bareRoot[rel[k]] = find(bareParent, rel[k])
  bareFor = p
  return bareRoot
}

/**
 * Test seam: when `on`, the enumeration takes its plain paths (the state analysis and the per-state
 * rule loops as they were before the Task 11 optimisations, with no shortcut), which the differential
 * tests compare the fast paths against: findings, converters, hazards and identity must be identical.
 * The two reference implementations (`analyseState`, `identityRules`) live in the test-only module
 * mainsPlain.testing.ts, which fills them in here, so the production bundle carries neither. Never set
 * outside tests.
 */
export const plainPath: {
  on: boolean
  analyseState: ((p: Prepared) => void) | null
  identityRules: ((acc: Acc, mask: number) => void) | null
} = { on: false, analyseState: null, identityRules: null }

/** The plain path's reference, registered by mainsPlain.testing.ts; setting plainPath.on without it is a test bug. */
export function plainRef<T>(f: T | null): T {
  if (!f) throw new Error('plainPath.on needs mainsPlain.testing.ts imported')
  return f
}

/** For the plain reference, which fills `bareRoot` itself: records that `p` holds the current state's bare roots. */
export function markBareRoots(p: Prepared): void {
  bareFor = p
}


export const identAt = (p: Prepared, node: number): number => p.ident[p.root[node]]
/** Energizing sources at a node. Energy starts from L and N and crosses loads (see analyseState): use identity, not this, to tell a branch is switched off. */
export const powerAt = (p: Prepared, node: number): number => p.power[p.root[node]]
/** A node is hazardous when it holds L or N identity or is energized (spec 1.2). */
export const hazardAt = (p: Prepared, node: number): boolean => (identAt(p, node) & LN_MASK) !== 0 || powerAt(p, node) !== 0
/** A node is on mains wiring when it holds L or N identity or energy that crossed no isolation barrier (MAINS_POW): the DC rules skip only these. */
export const mainsAt = (p: Prepared, node: number): boolean => (identAt(p, node) & LN_MASK) !== 0 || (powerAt(p, node) & MAINS_POW) !== 0

/** Up to this many candidate groups in a unit the checker enumerates every state; beyond, it reports mains-incomplete for that unit (spec 1.5, final review 2). */
export const MAX_GROUPS = 16

/**
 * The contact groups whose state can matter: any of their contacts lies in a possible-connectivity
 * component that holds a source terminal or a converter input. Every contact position conducts in
 * that graph, so a switch in the middle of a chain is never missed.
 */
export function candidateGroups(g: MainsGraph, possible: Int32Array = possibleRoots(g)): number[] {
  const live = new Set<number>()
  for (const s of g.sources) for (const x of [...s.live, ...s.neutral, ...s.earth]) live.add(possible[x])
  for (const c of g.converters) live.add(possible[c.a]).add(possible[c.b])
  return g.groups.flatMap((grp, i) => (grp.nodes.some((x) => live.has(possible[x])) ? [i] : []))
}

const orderCache = new Map<number, Uint32Array>()
/** Every k-bit mask, fewest groups on first, then by value (a converter's first unknown state names the fewest groups). */
export function masksByPopcount(k: number): Uint32Array {
  const hit = orderCache.get(k)
  if (hit) return hit
  const pop = (x: number) => {
    let c = 0
    for (; x; x &= x - 1) c++
    return c
  }
  const out = Uint32Array.from(Array.from({ length: 1 << k }, (_, i) => i).sort((a, b) => pop(a) - pop(b) || a - b))
  orderCache.set(k, out)
  return out
}

/** Puts the candidates in the state `mask` (bit k is cands[k]); every other group in the view is released or off. */
export function setState(p: Prepared, cands: number[], mask: number): void {
  for (const gi of p.groupIdx) p.groupState[gi] = 0
  for (let k = 0; k < cands.length; k++) if ((mask >>> k) & 1) p.groupState[cands[k]] = 1
}

/**
 * setState for a whole enumeration: after `setState(p, cands, 0)`, only the candidates change between
 * states (every other group in the view stays released or off), so this sets just those.
 */
export function setCandidates(p: Prepared, cands: number[], mask: number): void {
  const { groupState } = p
  for (let k = 0; k < cands.length; k++) groupState[cands[k]] = (mask >>> k) & 1
}

/**
 * `p` narrowed to `nodes`: the same scratch arrays, the lists cut to what has a terminal among them.
 * The view numbers its own sources from 0 (`index`, and its graph's `sources` in that order), so the
 * MAX_SOURCES identity and power bits hold per unit, never per sheet (final review 2). Anything that
 * leaves the view names a source by its id or part, never by index (see absorb, mergeUnpolarized).
 */
export function viewOf(p: Prepared, nodes: number[]): Prepared {
  const g = p.g
  const inRel = new Uint8Array(g.n)
  for (const i of nodes) inRel[i] = 1
  const within = (xs: number[]) => xs.filter((x) => inRel[x])
  const sources = p.sources.map((s) => ({ ...s, live: within(s.live), neutral: within(s.neutral), earth: within(s.earth) }))
    .filter((s) => s.live.length + s.neutral.length + s.earth.length > 0)
    .map((s, index) => ({ ...s, index }))
  return {
    ...p, g: { ...g, sources }, relevant: Int32Array.from(nodes), inRel, srcRoots: [],
    sources,
    groupIdx: p.groupIdx.filter((gi) => g.groups[gi].nodes.some((x) => inRel[x])),
    loadIdx: p.loadIdx.filter((i) => inRel[g.loads[i].a]),
    converterIdx: p.converterIdx.filter((i) => inRel[g.converters[i].a]),
    protective: p.protective.filter((e) => inRel[e.a]),
    energy: p.energy.filter((e) => inRel[e.a] && inRel[e.b]),
  }
}

export interface Unit { view: Prepared; cands: number[] }

/**
 * The enumeration units (Resolution 25): the relevant nodes grouped by possible-connectivity
 * component, merging components that one multi-pole group spans (its poles switch together), those
 * one class 1 part's terminals span (its earth is judged against its L and N), and those a bonded
 * part's secondary and bond pins span (its SELV or PELV class is judged in the same state), and those
 * the prongs of a plug that is not seated span (its live prongs are one finding).
 * Components cannot affect each other, so each unit's states are enumerated on their own.
 */
export function units(p: Prepared, cands: number[]): Unit[] {
  const g = p.g
  const up = new Map<number, number>()
  const top = (x: number): number => {
    while (up.has(x)) x = up.get(x)!
    return x
  }
  /** Puts the components of `nodes` (those in the analysis) in one unit. */
  const join = (nodes: number[]) => {
    const roots = [...new Set(nodes.filter((i) => p.inRel[i] === 1).map((i) => p.possible[i]))]
    for (const r of roots.slice(1)) {
      const [a, b] = [top(roots[0]), top(r)]
      if (a !== b) up.set(a, b)
    }
  }
  const termNodes = (part: PartInstance, names: Iterable<string>) =>
    [...names].map((n) => g.nodeOf.get(nodeKey(part.uid, n))).filter((i): i is number => i !== undefined)
  for (const gi of cands) join(g.groups[gi].nodes)
  for (const part of g.mainsParts) {
    const info = mainsOf(moduleOf(g.d, part.module)!)
    // A class 1 part's earth is judged in the states of its own L and N (rule 7): its components enumerate together.
    if (info.protection === 'class-1') join(termNodes(part, info.terminals))
    // A bonded part's secondary is judged SELV or PELV by the identity of its bond pins in the same state
    // (Resolution 9): its non-mains domain pins and its bonds enumerate together.
    if (info.bonds.size) join(termNodes(part, [...info.bonds, ...info.domains.filter((dm) => dm.kind !== 'mains').flatMap((dm) => dm.pins)]))
    // A plug that is not seated is judged by all its live prongs at once (the live-prong rule): its prongs enumerate together.
    if (info.plug && !g.seated.has(part.uid)) join(termNodes(part, info.plug.profiles.flatMap((pr) => pr.contacts.map((c) => c.pin))))
  }
  const byUnit = new Map<number, number[]>()
  for (const i of p.relevant) {
    const u = top(p.possible[i])
    const list = byUnit.get(u)
    if (list) list.push(i)
    else byUnit.set(u, [i])
  }
  return [...byUnit.values()].map((nodes) => {
    const view = viewOf(p, nodes)
    return { view, cands: cands.filter((gi) => view.groupIdx.includes(gi)) }
  })
}

/**
 * The candidate positions (0 to k-1) whose condition in state `mask` a finding needs (Resolution 24).
 * `holds` has bit m set for every state m the finding holds in. A condition is dropped only when the
 * finding holds in every state that agrees with the conditions still kept, so the phrase is both
 * minimal and complete.
 */
export function minimalWitness(holds: Uint32Array, k: number, mask: number): number[] {
  const has = (m: number) => ((holds[m >>> 5] >>> (m & 31)) & 1) === 1
  const allHold = (free: number) => {
    const fixed = mask & ~free
    for (let sub = free; ; sub = (sub - 1) & free) {
      if (!has(fixed | sub)) return false
      if (sub === 0) return true
    }
  }
  const kept: number[] = []
  let free = 0
  for (let j = 0; j < k; j++) {
    if (allHold(free | (1 << j))) free |= 1 << j
    else kept.push(j)
  }
  return kept
}

/** One minimal witness: the candidate positions (0 to k-1) it fixes, and their conditions (bit j of `mask`). */
export interface Witness { kept: number[]; mask: number }

/** At most this many witnesses are returned: the cover stops here, and consensus falls back to the cover past it. */
const MAX_WITNESSES = 32
/** Consensus gives up past this many cubes in its working list (some not yet absorbed), keeping its cost bounded. */
const CONSENSUS_WORK = 256

type Cube = { care: number; val: number }
const contains = (a: Cube, b: Cube) => (a.care & b.care) === a.care && (b.val & a.care) === a.val

/**
 * The minimal witnesses of a finding (Ruling 31): each prime implicant of the states it holds in, so
 * the phrase names every way the finding comes about, never one picked by position. A greedy cover
 * of the holding states comes first (each cube minimal, see minimalWitness), then iterated consensus
 * with absorption turns it into every prime implicant. Bounded: when the cover needs more than
 * MAX_WITNESSES cubes it stops there (the list then covers only some of the states), and when there
 * are more than MAX_WITNESSES prime implicants, or consensus outgrows its work limit, the cover is
 * returned. statePhrase counts whatever the listed witnesses leave out, so the words stay exact.
 */
export function minimalWitnesses(holds: Uint32Array, k: number): Witness[] {
  const has = (m: number) => ((holds[m >>> 5] >>> (m & 31)) & 1) === 1
  const all = (1 << k) - 1
  // Holding in every state needs no condition: skip the cover, whose minimal-witness search would visit every subset.
  let every = true
  if (k >= 5 && !plainPath.on) for (let x = 0; x <= all >>> 5 && every; x++) every = holds[x] === 0xffffffff
  else for (let m = 0; m <= all && every; m++) every = has(m)
  if (every) return [{ kept: [], mask: 0 }]
  const cover: Cube[] = []
  let full = true
  const covered = (m: number) => {
    for (let c = 0; c < cover.length; c++) if ((m & cover[c].care) === cover[c].val) return true
    return false
  }
  for (let m = 0; m <= all; m++) {
    // A word of 32 states the finding never holds in is passed at once.
    if ((m & 31) === 0 && holds[m >>> 5] === 0 && !plainPath.on) {
      m += 31
      continue
    }
    if (!has(m) || covered(m)) continue
    if (cover.length === MAX_WITNESSES) {
      full = false
      break
    }
    const care = minimalWitness(holds, k, m).reduce((x, j) => x | (1 << j), 0)
    cover.push({ care, val: m & care })
  }
  const out = full ? consensus(cover) ?? cover : cover
  return out.map((c) => ({ kept: [...Array(k).keys()].filter((j) => (c.care >>> j) & 1), mask: c.val }))
}

/** Every prime implicant, from a cover made of prime implicants; null past MAX_WITNESSES or the work limit. */
function consensus(cover: Cube[]): Cube[] | null {
  const list: (Cube | null)[] = cover.slice()
  for (let i = 0; i < list.length; i++)
    for (let j = 0; j < i; j++) {
      const [a, b] = [list[i], list[j]]
      if (!a || !b) continue
      const clash = a.care & b.care & (a.val ^ b.val)
      if (!clash || (clash & (clash - 1)) !== 0) continue
      const care = (a.care | b.care) & ~clash
      const c = { care, val: (a.val | b.val) & care }
      if (list.some((x) => x && contains(x, c))) continue
      // Absorb what the new cube contains; it meets every earlier cube when the scan reaches it.
      for (let x = 0; x < list.length; x++) if (list[x] && contains(c, list[x]!)) list[x] = null
      list.push(c)
      if (list.length > CONSENSUS_WORK) return null
      if (!list[i]) break
    }
  const primes = list.filter((x): x is Cube => x !== null)
  return primes.length > MAX_WITNESSES ? null : primes
}

const WORDS: Record<ContactGroup['kind'], [string, string]> = { switch: ['off', 'on'], relay: ['released', 'energized'], ssr: ['off', 'on'] }
/** A switch with a changeover pole is worded by the contact its poles are switched to (Ruling 31). */
const CHANGEOVER: [string, string] = ['switched to NC', 'switched to NO']
const wordsOf = (def: ContactGroup): [string, string] => (def.kind === 'switch' && def.poles.some((x) => x.nc !== null) ? CHANGEOVER : WORDS[def.kind])

/**
 * A contact group by its part's designator; on a part with several groups, followed by a label a
 * reader finds on the part: its COM pin labels ("K1 (COM1)"), or its place among the groups when two
 * groups share those labels.
 */
export function groupName(g: MainsGraph, gi: number): string {
  const grp = g.groups[gi]
  const mates = g.groups.filter((x) => x.part === grp.part)
  if (mates.length < 2) return grp.part.designator
  const m = moduleOf(g.d, grp.part.module)
  const label = (name: string) => {
    const pin = m?.pins.find((p) => !isSpacer(p) && p.name === name)
    return pin && !isSpacer(pin) ? (pin.label ?? pin.name) : name
  }
  const coms = (x: GGroup) => andList(x.def.poles.map((pole) => label(pole.com)))
  const mine = coms(grp)
  const unique = mates.every((x) => x === grp || coms(x) !== mine)
  return `${grp.part.designator} (${unique ? mine : `contact group ${mates.indexOf(grp) + 1}`})`
}

/** One witness in words, conditions in designator order: "when K1 is released, S1 is on and S2 is off"; "when S1 and S2 are both on" when all share one word. */
function witnessPhrase(g: MainsGraph, cands: number[], w: Witness): string {
  const conds = w.kept.map((j) => {
    const gi = cands[j]
    return { name: groupName(g, gi), word: wordsOf(g.groups[gi].def)[(w.mask >>> j) & 1] }
  }).sort((a, b) => natural.compare(a.name, b.name))
  const word = conds[0].word
  if (conds.length > 1 && conds.every((c) => c.word === word)) {
    const list = conds.map((c) => c.name)
    return list.length === 2 && (word === 'on' || word === 'energized') ? `when ${list[0]} and ${list[1]} are both ${word}` : `when ${andList(list)} are ${word}`
  }
  return `when ${andList(conds.map((c) => `${c.name} is ${c.word}`))}`
}

/** A phrase lists at most this many witnesses; the states the rest cover are counted. */
export const PHRASE_WITNESSES = 4

/**
 * The conditions a finding needs, in words: its minimal witnesses joined with "or" ("when S1 is on,
 * or when S2 is on"), fewest conditions first; '' when a witness needs none (it holds in every
 * state). Past PHRASE_WITNESSES, and when given the finding's `holds`, the states the listed
 * witnesses leave out are counted ("or in 12 other switch combinations"); without it they are named
 * only as "other switch combinations".
 */
export function statePhrase(g: MainsGraph, cands: number[], witnesses: Witness[], holds?: Uint32Array): string {
  if (!witnesses.length || witnesses.some((x) => !x.kept.length)) return ''
  const sorted = witnesses
    .map((x) => ({ w: x, n: x.kept.length, text: witnessPhrase(g, cands, x) }))
    .sort((a, b) => a.n - b.n || natural.compare(a.text, b.text))
  const shown = sorted.slice(0, PHRASE_WITNESSES)
  let rest = 0
  if (holds && sorted.length > shown.length) {
    const cubes = shown.map((x) => ({ care: x.w.kept.reduce((c, j) => c | (1 << j), 0), mask: x.w.mask }))
    for (let m = 0; m < 1 << cands.length; m++) {
      if (!((holds[m >>> 5] >>> (m & 31)) & 1)) continue
      let shown = false
      for (let c = 0; c < cubes.length && !shown; c++) shown = (m & cubes[c].care) === (cubes[c].mask & cubes[c].care)
      if (!shown) rest++
    }
  }
  // Without `holds` the rest cannot be counted, but is never left out silently.
  const tail = rest ? `, or in ${rest} other switch combination${rest === 1 ? '' : 's'}` : !holds && sorted.length > shown.length ? ', or in other switch combinations' : ''
  return shown.map((x) => x.text).join(', or ') + tail
}
