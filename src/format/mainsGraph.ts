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
import { type ModuleDef, type PinType, isSpacer, partSetting } from './module.ts'
import { paramValue } from './values.ts'
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
  return { d, n: members.length, members, nodeOf, wires, broken, sources, edges, groups, converters, loads, mainsParts, connected, termCache: new Map() }
}

/** The terminal a node key names, with its module's mains data; null for a missing part or name. Cached per graph. */
export function termAt(g: MainsGraph, key: string): GTerm | null {
  if (g.termCache.has(key)) return g.termCache.get(key)!
  const [uid, name] = JSON.parse(key) as [string, string]
  const part = g.d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(g.d, part.module)
  let t: GTerm | null = null
  if (part && m) {
    const info = mainsOf(m)
    const pin = m.pins.find((p) => !isSpacer(p) && p.name === name)
    const def = pin && !isSpacer(pin) ? pin : m.holes?.find((h) => h.name === name)
    if (def || info.internalNodes.includes(name)) t = { key, part, module: m, info, name, label: def?.label ?? name, type: def?.type }
  }
  g.termCache.set(key, t)
  return t
}

export const termName = (t: GTerm): string => `${t.part.designator} ${t.label}`

function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]
    x = parent[x]
  }
  return x
}
function union(parent: Int32Array, a: number, b: number) {
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

/** Moves energy one step along a-b (a to b only when directed). True when anything changed. */
function flow(p: Prepared, a: number, b: number, directed: boolean): boolean {
  const ra = p.root[a]
  const rb = p.root[b]
  if (ra === rb) return false
  let moved = false
  const f = p.power[ra] & ~p.power[rb]
  if (f) {
    p.power[rb] |= f
    moved = true
  }
  if (!directed) {
    const back = p.power[rb] & ~p.power[ra]
    if (back) {
      p.power[ra] |= back
      moved = true
    }
  }
  return moved
}

/**
 * Identity and energization for the state in `p.groupState`, over `p.relevant` only: resetting and
 * walking just these nodes keeps a state's cost independent of the rest of the sheet. Results live in
 * `p` until the next call.
 */
export function analyseState(p: Prepared): void {
  const { g } = p
  for (const i of p.relevant) {
    p.parent[i] = p.base[i]
    p.bareParent[i] = p.bareBase[i]
    if (p.anyAbsent) p.fitParent[i] = p.fitBase[i]
  }
  for (const gi of p.groupIdx)
    for (const [a, b] of g.groups[gi].closed[p.groupState[gi]]) {
      union(p.parent, a, b)
      union(p.bareParent, a, b)
      if (p.anyAbsent) union(p.fitParent, a, b)
    }
  for (const i of p.relevant) {
    p.root[i] = find(p.parent, i)
    p.bareRoot[i] = find(p.bareParent, i)
    if (p.anyAbsent) p.fitRoot[i] = find(p.fitParent, i)
    p.ident[i] = 0
    p.power[i] = 0
  }
  p.srcRoots.length = 0
  for (const s of p.sources) {
    const put = (nodes: number[], c: Conductor) => {
      for (const x of nodes) {
        const r = p.root[x]
        if (!p.ident[r]) p.srcRoots.push(r)
        p.ident[r] |= bitOf(s.index, c)
      }
    }
    put(s.live, 'L')
    put(s.neutral, 'N')
    put(s.earth, 'PE')
    for (const x of s.live) p.power[p.root[x]] |= 1 << s.index
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const e of p.energy) if (flow(p, e.a, e.b, e.directed)) changed = true
    for (const gi of p.groupIdx) for (const [a, b] of g.groups[gi].leak[p.groupState[gi]]) if (flow(p, a, b, false)) changed = true
  }
}

export const identAt = (p: Prepared, node: number): number => p.ident[p.root[node]]
export const powerAt = (p: Prepared, node: number): number => p.power[p.root[node]]
/** A node is hazardous when it holds L or N identity or is energized (spec 1.2). */
export const hazardAt = (p: Prepared, node: number): boolean => (identAt(p, node) & LN_MASK) !== 0 || powerAt(p, node) !== 0
