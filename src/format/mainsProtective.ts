// Protective conductors (spec 1.6): every wire and part edge on any simple path between a source's
// earth terminal and a protective terminal (a class 1 part's PE terminal or a declared bond), found on
// a terminal-level graph with every contact position conducting. A path passes only through terminals
// declared for mains that carry no L or N role (PE terminals, terminal blocks, lever connectors,
// contacts, fuses) and breadboard strips (Ruling 35). An ordinary or SELV/PELV pin, an L, N or line
// terminal, a converter input or a socket's L or N hole is never on a path, and a declared bond is a
// path's end only (Ruling 36), so a functional DC ground joined to a bonded minus is never protective.
// Parallel and redundant paths are all included: an edge is on some path exactly when its biconnected
// block is on the block-cut tree path between the two ends. Pure; cached per graph.
import { type PartInstance, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { isBoard } from './module.ts'
import { nodeKey } from './netlist.ts'
import { type MainsInfo, mainsOf } from './mainsModel.ts'
import { type GTerm, type MainsGraph, termAt } from './mainsGraph.ts'
import { lvClass } from './mainsRules.ts'

export type ThroughKind = 'switch' | 'relay' | 'ssr' | 'fuse'
/** A switch, relay, SSR or fuse on a protective path: every kind of its edges on a path (sorted), and every wire of a full source-to-terminal path through each such edge and of its block. */
export interface Through { part: PartInstance; kinds: ThroughKind[]; wires: string[] }
/** A breadboard strip (a hole group of a board without mains data) on a protective path (Ruling 35). */
export interface Strip { part: string; group: string }
export interface ProtectivePaths { wires: Set<string>; through: Through[]; strips: Strip[] }
interface PEdge { a: number; b: number; wire?: string; through?: { part: PartInstance; kind: ThroughKind } }

/** Biconnected blocks (Tarjan, iterative, parallel edges kept apart): block id per edge and cut vertices. */
function blocks(n: number, edges: PEdge[]): { blockOf: Int32Array; cut: Uint8Array; count: number } {
  const adj: number[][] = Array.from({ length: n }, () => [])
  edges.forEach((e, i) => {
    adj[e.a].push(i)
    adj[e.b].push(i)
  })
  const tin = new Int32Array(n).fill(-1)
  const low = new Int32Array(n)
  const blockOf = new Int32Array(edges.length).fill(-1)
  const cut = new Uint8Array(n)
  const estack: number[] = []
  let time = 0
  let count = 0
  for (let root = 0; root < n; root++) {
    if (tin[root] >= 0) continue
    tin[root] = low[root] = time++
    let children = 0
    // Frames: vertex, the edge it was reached by (skipped once, so a parallel edge still counts), next adjacency index.
    const stack: [number, number, number][] = [[root, -1, 0]]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [v, via] = top
      if (top[2] < adj[v].length) {
        const ei = adj[v][top[2]++]
        if (ei === via) continue
        const e = edges[ei]
        const u = e.a === v ? e.b : e.a
        if (tin[u] < 0) {
          estack.push(ei)
          tin[u] = low[u] = time++
          stack.push([u, ei, 0])
          if (v === root) children++
        } else if (tin[u] < tin[v]) {
          estack.push(ei)
          low[v] = Math.min(low[v], tin[u])
        }
      } else {
        stack.pop()
        if (!stack.length) continue
        const parent = stack[stack.length - 1][0]
        low[parent] = Math.min(low[parent], low[v])
        if (low[v] >= tin[parent]) {
          if (parent !== root) cut[parent] = 1
          let ei: number
          do {
            ei = estack.pop()!
            blockOf[ei] = count
          } while (ei !== via)
          count++
        }
      }
    }
    if (children > 1) cut[root] = 1
  }
  return { blockOf, cut, count }
}

const cache = new WeakMap<MainsGraph, ProtectivePaths>()

/** Terminals of a module that carry L or N: never on a protective path (Ruling 36). */
const liveCache = new WeakMap<MainsInfo, Set<string>>()
function liveTerminals(info: MainsInfo): Set<string> {
  let s = liveCache.get(info)
  if (!s) {
    s = new Set([
      ...[...info.requirement].filter(([, r]) => r !== 'PE').map(([n]) => n),
      ...(info.acInput ? [info.acInput.a, info.acInput.b] : []),
      ...info.acSources.flatMap((x) => [...x.live, ...x.neutral]),
      ...info.sockets.flatMap((x) => x.contacts.filter((c) => c.role !== 'PE').map((c) => c.group)),
      ...(info.plug?.profiles.flatMap((pr) => pr.contacts.filter((c) => c.mains !== 'PE').map((c) => c.pin)) ?? []),
      ...info.conducts.flatMap((c) => c.pins),
    ])
    liveCache.set(info, s)
  }
  return s
}

/** How a terminal takes part: a path may pass through it, only end at it (a declared bond), pass through a breadboard strip, or never touch it. */
type Role = 'pass' | 'end' | 'strip' | null
function roleOf(t: GTerm | null): Role {
  if (!t) return null
  if (!t.info.any) return isBoard(t.module) && (t.module.holes ?? []).some((h) => h.name === t.name) ? 'strip' : null
  if (t.info.bonds.has(t.name)) return 'end'
  if (lvClass(t) !== null || liveTerminals(t.info).has(t.name)) return null
  return 'pass'
}

export function protectivePaths(g: MainsGraph): ProtectivePaths {
  const hit = cache.get(g)
  if (hit) return hit
  // Vertices: one per pass-through terminal or strip; an end-only terminal gets a fresh vertex per
  // edge, so no path can go on through it. Every end-only vertex is a protective terminal.
  const ids = new Map<string, number>()
  const keyOf: string[] = []
  const isStrip: boolean[] = []
  const T = new Set<number>()
  const role = (key: string): Role => roleOf(termAt(g, key))
  const vertex = (key: string, r: Role): number => {
    let i = r === 'end' ? undefined : ids.get(key)
    if (i === undefined) {
      i = keyOf.length
      keyOf.push(key)
      isStrip.push(r === 'strip')
      if (r === 'end') T.add(i)
      else ids.set(key, i)
    }
    return i
  }
  const edges: PEdge[] = []
  const join = (ka: string, kb: string, extra: Omit<PEdge, 'a' | 'b'> = {}) => {
    const ra = role(ka)
    const rb = role(kb)
    if (ra === null || rb === null || ka === kb) return
    edges.push({ a: vertex(ka, ra), b: vertex(kb, rb), ...extra })
  }
  for (const c of g.d.connections) if (!g.broken.has(c.uid)) join(nodeKey(c.from.part, c.from.pin), nodeKey(c.to.part, c.to.pin), { wire: c.uid })
  for (const pl of plugsOf(g.d)) join(nodeKey(pl.part, pl.pin), nodeKey(pl.board, pl.group))
  for (const part of g.mainsParts) {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    // An internal group is one conductor: every two of its members are joined directly (an ordinary
    // first member does not cut the rest apart, and no member stands between two others).
    for (const grp of m.internal ?? []) {
      const keys = grp.map((n) => nodeKey(part.uid, n)).filter((k) => role(k) !== null)
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) join(keys[i], keys[j])
    }
    for (const c of info.contacts)
      for (const pole of c.poles) for (const other of [pole.no, pole.nc]) if (other) join(nodeKey(part.uid, pole.com), nodeKey(part.uid, other), { through: { part, kind: c.kind } })
    for (const e of info.protective) join(nodeKey(part.uid, e.from), nodeKey(part.uid, e.to), { through: { part, kind: 'fuse' } })
    // A class 1 part's earth (a PE terminal or a PE plug contact) is a protective terminal that a path
    // may also pass through (spec 1.6 lists PE terminals among what a path passes through).
    if (info.protection === 'class-1')
      for (const n of [...[...info.requirement].filter(([, r]) => r === 'PE').map(([x]) => x), ...(info.plug?.profiles.flatMap((pr) => pr.contacts.filter((c) => c.mains === 'PE').map((c) => c.pin)) ?? [])]) {
        const i = ids.get(nodeKey(part.uid, n))
        if (i !== undefined) T.add(i)
      }
  }
  const S = new Set(g.sources.flatMap((s) => s.keys.PE).map((k) => ids.get(k)).filter((i): i is number => i !== undefined))
  const out: ProtectivePaths = { wires: new Set(), through: [], strips: [] }
  const nv = keyOf.length
  if (S.size && T.size && edges.length) {
    const { blockOf, cut, count } = blocks(nv, edges)
    // Block-cut tree: blocks are 0..count-1, cut vertex v is count + v.
    const adj = new Map<number, Set<number>>()
    const link = (x: number, y: number) => {
      ;(adj.get(x) ?? adj.set(x, new Set()).get(x)!).add(y)
      ;(adj.get(y) ?? adj.set(y, new Set()).get(y)!).add(x)
    }
    const anyBlock = new Int32Array(nv).fill(-1)
    edges.forEach((e, i) => {
      for (const v of [e.a, e.b]) {
        anyBlock[v] = blockOf[i]
        if (cut[v]) link(blockOf[i], count + v)
      }
    })
    const treeNode = (v: number) => (cut[v] ? count + v : anyBlock[v])
    const marked = new Uint8Array(count)
    for (const s of S) {
      const from = treeNode(s)
      if (from < 0) continue
      const prev = new Map<number, number>([[from, -1]])
      const queue = [from]
      for (let q = 0; q < queue.length; q++)
        for (const y of adj.get(queue[q]) ?? [])
          if (!prev.has(y)) {
            prev.set(y, queue[q])
            queue.push(y)
          }
      for (const t of T) {
        // A source earth that is itself the terminal has no path to explain.
        if (t === s) continue
        let x = treeNode(t)
        if (x < 0 || !prev.has(x)) continue
        for (; x !== -1; x = prev.get(x)!) if (x < count) marked[x] = 1
      }
    }
    const blockWires: string[][] = Array.from({ length: count }, () => [])
    const onPath = new Uint8Array(nv)
    const adjP: number[][] = Array.from({ length: nv }, () => [])
    edges.forEach((e, i) => {
      if (!marked[blockOf[i]]) return
      if (e.wire) {
        out.wires.add(e.wire)
        blockWires[blockOf[i]].push(e.wire)
      }
      adjP[e.a].push(i)
      adjP[e.b].push(i)
      onPath[e.a] = onPath[e.b] = 1
    })
    for (let v = 0; v < nv; v++)
      if (onPath[v] && isStrip[v]) {
        const [part, group] = JSON.parse(keyOf[v]) as [string, string]
        out.strips.push({ part, group })
      }
    // The whole source-to-terminal path through a prohibited edge (spec 3: the finding highlights its
    // path): a shortest route over protective edges from a source's earth to one end, and from the other
    // end to a protective terminal, plus the wires of its own block (a parallel loop). One entry per
    // part, holding the wires of every one of its edges on a path. The search arrays are shared, stamped per search.
    const stamp = new Int32Array(nv)
    const prevE = new Int32Array(nv)
    const queue = new Int32Array(nv)
    let run = 0
    const route = (from: Set<number>, to: number, skip: number): number[] | null => {
      run++
      let tail = 0
      for (const v of from) {
        stamp[v] = run
        prevE[v] = -1
        queue[tail++] = v
      }
      for (let q = 0; q < tail && stamp[to] !== run; q++) {
        const v = queue[q]
        for (const ei of adjP[v]) {
          if (ei === skip) continue
          const u = edges[ei].a === v ? edges[ei].b : edges[ei].a
          if (stamp[u] === run) continue
          stamp[u] = run
          prevE[u] = ei
          queue[tail++] = u
        }
      }
      if (stamp[to] !== run) return null
      const steps: number[] = []
      for (let v = to; prevE[v] !== -1; ) {
        const ei = prevE[v]
        steps.push(ei)
        v = edges[ei].a === v ? edges[ei].b : edges[ei].a
      }
      return steps
    }
    const byPart = new Map<PartInstance, { kinds: Set<ThroughKind>; wires: Set<string> }>()
    edges.forEach((e, i) => {
      if (!marked[blockOf[i]] || !e.through) return
      const way = [[route(S, e.a, i), route(T, e.b, i)], [route(S, e.b, i), route(T, e.a, i)]].find(([x, y]) => x && y) ?? [[], []]
      let entry = byPart.get(e.through.part)
      if (!entry) byPart.set(e.through.part, (entry = { kinds: new Set(), wires: new Set() }))
      entry.kinds.add(e.through.kind)
      for (const x of blockWires[blockOf[i]]) entry.wires.add(x)
      for (const k of way.flatMap((xs) => xs ?? [])) if (edges[k].wire) entry.wires.add(edges[k].wire!)
    })
    for (const [part, { kinds, wires }] of byPart) out.through.push({ part, kinds: [...kinds].sort(), wires: [...wires] })
  }
  cache.set(g, out)
  return out
}
