// Protective conductors (spec 1.6): every wire and part edge on any simple path between a source's
// earth terminal and a protective terminal (a class 1 part's PE terminal or a declared bond), found on
// a terminal-level graph with every contact position conducting. A low-voltage pin is never a vertex,
// so a functional DC ground reaching PE through a part's DC pin is never on a path. Parallel and
// redundant paths are all included: an edge is on some path exactly when its biconnected block is on
// the block-cut tree path between the two ends. Pure; cached per graph.
import { type PartInstance, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { nodeKey } from './netlist.ts'
import { mainsOf } from './mainsModel.ts'
import { type MainsGraph, termAt } from './mainsGraph.ts'
import { lvClass } from './mainsRules.ts'

/** A switch, relay, SSR or fuse on a protective path, with every wire of a full source-to-terminal path through it and of its own block. */
export interface Through { part: PartInstance; kind: 'switch' | 'relay' | 'ssr' | 'fuse'; wires: string[] }
export interface ProtectivePaths { wires: Set<string>; through: Through[] }
interface PEdge { a: number; b: number; wire?: string; through?: { part: PartInstance; kind: Through['kind'] } }

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

export function protectivePaths(g: MainsGraph): ProtectivePaths {
  const hit = cache.get(g)
  if (hit) return hit
  const ids = new Map<string, number>()
  // A vertex is a terminal declared for mains, or a declared bond; never an ordinary, SELV or PELV pin.
  const vertex = (key: string): number | null => {
    const t = termAt(g, key)
    if (!t || !(lvClass(t) === null || t.info.bonds.has(t.name))) return null
    let i = ids.get(key)
    if (i === undefined) ids.set(key, (i = ids.size))
    return i
  }
  const edges: PEdge[] = []
  const join = (ka: string, kb: string, extra: Omit<PEdge, 'a' | 'b'> = {}) => {
    const a = vertex(ka)
    const b = vertex(kb)
    if (a !== null && b !== null && a !== b) edges.push({ a, b, ...extra })
  }
  for (const c of g.d.connections) if (!g.broken.has(c.uid)) join(nodeKey(c.from.part, c.from.pin), nodeKey(c.to.part, c.to.pin), { wire: c.uid })
  for (const pl of plugsOf(g.d)) join(nodeKey(pl.part, pl.pin), nodeKey(pl.board, pl.group))
  const T = new Set<number>()
  for (const part of g.mainsParts) {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    for (const grp of m.internal ?? []) for (let i = 1; i < grp.length; i++) join(nodeKey(part.uid, grp[0]), nodeKey(part.uid, grp[i]))
    for (const c of info.contacts)
      for (const pole of c.poles) for (const other of [pole.no, pole.nc]) if (other) join(nodeKey(part.uid, pole.com), nodeKey(part.uid, other), { through: { part, kind: c.kind } })
    for (const e of info.protective) join(nodeKey(part.uid, e.from), nodeKey(part.uid, e.to), { through: { part, kind: 'fuse' } })
    // Protective terminals: declared bonds, and a class 1 part's earth (a PE terminal or a PE plug contact).
    const earths = info.protection === 'class-1'
      ? [...[...info.requirement].filter(([, r]) => r === 'PE').map(([n]) => n), ...(info.plug?.profiles.flatMap((pr) => pr.contacts.filter((c) => c.mains === 'PE').map((c) => c.pin)) ?? [])]
      : []
    for (const n of [...info.bonds, ...earths]) {
      const i = vertex(nodeKey(part.uid, n))
      if (i !== null) T.add(i)
    }
  }
  const S = new Set(g.sources.flatMap((s) => s.keys.PE).map((k) => ids.get(k)).filter((i): i is number => i !== undefined))
  const out: ProtectivePaths = { wires: new Set(), through: [] }
  if (S.size && T.size && edges.length) {
    const { blockOf, cut, count } = blocks(ids.size, edges)
    // Block-cut tree: blocks are 0..count-1, cut vertex v is count + v.
    const adj = new Map<number, Set<number>>()
    const link = (x: number, y: number) => {
      ;(adj.get(x) ?? adj.set(x, new Set()).get(x)!).add(y)
      ;(adj.get(y) ?? adj.set(y, new Set()).get(y)!).add(x)
    }
    const anyBlock = new Int32Array(ids.size).fill(-1)
    edges.forEach((e, i) => {
      for (const v of [e.a, e.b]) {
        anyBlock[v] = blockOf[i]
        if (cut[v]) link(blockOf[i], count + v)
      }
    })
    const treeNode = (v: number) => (cut[v] ? count + v : anyBlock[v])
    const marked = new Set<number>()
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
        for (; x !== -1; x = prev.get(x)!) if (x < count) marked.add(x)
      }
    }
    const blockWires = new Map<number, string[]>()
    edges.forEach((e, i) => {
      if (!marked.has(blockOf[i]) || !e.wire) return
      out.wires.add(e.wire)
      blockWires.set(blockOf[i], [...(blockWires.get(blockOf[i]) ?? []), e.wire])
    })
    // The whole source-to-terminal path through a prohibited edge (spec 3: the finding highlights its
    // path): a shortest route over protective edges from a source's earth to one end, and from the other
    // end to a protective terminal, plus the wires of its own block (a parallel loop). One entry per
    // part, holding the wires of every one of its edges on a path.
    const adjP = new Map<number, number[]>()
    edges.forEach((e, i) => {
      if (!marked.has(blockOf[i])) return
      for (const v of [e.a, e.b]) (adjP.get(v) ?? adjP.set(v, []).get(v)!).push(i)
    })
    const route = (from: Set<number>, to: number, skip: number): number[] | null => {
      const prev = new Map<number, number>()
      const queue: number[] = []
      for (const v of from) {
        prev.set(v, -1)
        queue.push(v)
      }
      for (let q = 0; q < queue.length && !prev.has(to); q++)
        for (const ei of adjP.get(queue[q]) ?? []) {
          if (ei === skip) continue
          const u = edges[ei].a === queue[q] ? edges[ei].b : edges[ei].a
          if (!prev.has(u)) {
            prev.set(u, ei)
            queue.push(u)
          }
        }
      if (!prev.has(to)) return null
      const steps: number[] = []
      for (let v = to; prev.get(v) !== -1; ) {
        const ei = prev.get(v)!
        steps.push(ei)
        v = edges[ei].a === v ? edges[ei].b : edges[ei].a
      }
      return steps
    }
    const byPart = new Map<PartInstance, { kind: Through['kind']; wires: Set<string> }>()
    edges.forEach((e, i) => {
      if (!marked.has(blockOf[i]) || !e.through) return
      const way = [[route(S, e.a, i), route(T, e.b, i)], [route(S, e.b, i), route(T, e.a, i)]].find(([x, y]) => x && y) ?? [[], []]
      let entry = byPart.get(e.through.part)
      if (!entry) byPart.set(e.through.part, (entry = { kind: e.through.kind, wires: new Set() }))
      for (const x of blockWires.get(blockOf[i]) ?? []) entry.wires.add(x)
      for (const k of way.flatMap((xs) => xs ?? [])) if (edges[k].wire) entry.wires.add(edges[k].wire!)
    })
    for (const [part, { kind, wires }] of byPart) out.through.push({ part, kind, wires: [...wires] })
  }
  cache.set(g, out)
  return out
}
