// DC-path classification (spec 2, revision 5, and 4.4; fix-round ruling on Task 12), before
// solving. Three node states:
// - driven: reached from a source's + terminal (or a fed rail output) along conducting elements in
//   their conducting direction: resistors and contacts both ways, diodes anode to cathode, rails in
//   to out (and back only through a body diode). The walk never enters a return (a cell's -, a rail
//   or load return), so a load tied to ground never lets ground "drive" the supply side.
// - defined: not driven, but reached from a source's - through resistors and contacts only (a
//   pull-down to ground is a real 0 V).
// - floating: neither. Never reported as a voltage.
// Capacitors, loads and input-leakage resistors never conduct here. A board whose domain is not
// driven is unpowered (R30 names the open switch that would power it). Islands keep the undirected
// grouping (dcFind), for numerics and reference naming only: each island holding a source is
// referenced to the return of its source with the largest imax, else the highest open-circuit
// voltage, ties by part uid. Pure.
import { naturalCompare } from '../agent/order.ts'
import { type Circuit, type Device, netNode } from './model.ts'

export interface Island { reference: string; source: string; nodes: string[] }
export type NodeState = 'driven' | 'defined' | 'floating'
/**
 * `driven` and `defined` are node ids (net nodes, pin taps, internal nodes); `defined` includes
 * every driven node. `islandOf` covers every node of a source's undirected component, floating ones
 * included, so check the state before reading a voltage.
 */
export interface Classification { driven: Set<string>; defined: Set<string>; islands: Island[]; islandOf: Map<string, number> }

type Cell = Extract<Device, { kind: 'cell' }>

export function deviceNodes(d: Device): string[] {
  switch (d.kind) {
    case 'resistor':
    case 'capacitor':
      return [d.a, d.b]
    case 'diode':
      return [d.a, d.k]
    case 'cell':
      return [d.p, d.int, d.n]
    case 'load':
      return [d.p, d.n]
    case 'rail':
      return [d.in, d.inRet, d.out, d.ret, d.ctl, d.o]
  }
}

/** The undirected terminal pairs that group nodes into islands (numerics and references only, not driven). */
export function dcEdges(d: Device): [string, string][] {
  switch (d.kind) {
    case 'capacitor':
    case 'load':
      return []
    case 'resistor':
      return d.role === 'leak' ? [] : [[d.a, d.b]]
    case 'diode':
      return [[d.a, d.k]]
    case 'cell':
      return [[d.p, d.int], [d.int, d.n]]
    case 'rail':
      // Groups in, ctl, o and out; inRet and ret are returns and join nothing here.
      return [[d.in, d.ctl], [d.in, d.o], [d.o, d.out]]
  }
}

/** The directed arcs along which a device carries drive (the fix-round ruling on Task 12). */
export function driveArcs(d: Device): [string, string][] {
  switch (d.kind) {
    case 'capacitor':
    case 'load':
    case 'cell':
      return []
    case 'resistor':
      return d.role === 'leak' ? [] : [[d.a, d.b], [d.b, d.a]]
    case 'diode':
      return [[d.a, d.k]]
    case 'rail':
      return [[d.in, d.ctl], [d.in, d.o], [d.o, d.out], ...(d.rail.reverse === 'body-diode' ? ([[d.out, d.o], [d.o, d.in]] as [string, string][]) : [])]
  }
}

/** Union-find over the DC paths and the pin senses, with `extra` joins (a switch closed in thought). */
export function dcFind(c: Circuit, extra: [string, string][] = []): (node: string) => string {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    for (let cur = x; cur !== r; ) {
      const next = parent.get(cur)!
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  const join = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const t of c.taps) join(netNode(t.net), t.node)
  for (const d of c.devices) for (const [a, b] of dcEdges(d)) join(a, b)
  for (const [a, b] of extra) join(a, b)
  return find
}

const cellsOf = (c: Circuit): Cell[] => c.devices.filter((d): d is Cell => d.kind === 'cell')

/** Breadth-first walk from `seeds` along `adj`, never entering a `stop` node (seeds always count). */
function walk(seeds: string[], adj: Map<string, string[]>, stop: (n: string) => boolean): Set<string> {
  const seen = new Set(seeds)
  const queue = [...seeds]
  for (let i = 0; i < queue.length; i++)
    for (const nb of adj.get(queue[i]) ?? [])
      if (!seen.has(nb) && !stop(nb)) {
        seen.add(nb)
        queue.push(nb)
      }
  return seen
}

/** The driven and defined node sets, with `extra` joins (a switch closed in thought). */
function reach(c: Circuit, extra: [string, string][] = []): { driven: Set<string>; defined: Set<string> } {
  const drive = new Map<string, string[]>()
  const hold = new Map<string, string[]>()
  const arc = (m: Map<string, string[]>, a: string, b: string) => {
    const l = m.get(a)
    if (l) l.push(b)
    else m.set(a, [b])
  }
  const both = (a: string, b: string) => {
    for (const m of [drive, hold]) arc(m, a, b), arc(m, b, a)
  }
  // A pin tap and its net are one point (a 0 V sense), so a return blocks its whole net.
  const netOf = new Map<string, string>()
  for (const t of c.taps) {
    netOf.set(t.node, netNode(t.net))
    both(netNode(t.net), t.node)
  }
  for (const [a, b] of extra) both(a, b)
  for (const d of c.devices) {
    for (const [a, b] of driveArcs(d)) arc(drive, a, b)
    if (d.kind === 'resistor' && d.role !== 'leak') arc(hold, d.a, d.b), arc(hold, d.b, d.a)
  }
  const cells = cellsOf(c)
  const returns = new Set<string>()
  const ret = (n: string) => returns.add(netOf.get(n) ?? n)
  for (const d of c.devices) {
    if (d.kind === 'cell') ret(d.n)
    else if (d.kind === 'load') ret(d.n)
    else if (d.kind === 'rail') ret(d.ret), ret(d.inRet)
  }
  // ponytail: a load or rail return is treated as ground even when wired to a supply (a low-side load); model low-side switching if parts need it.
  const isReturn = (n: string) => returns.has(netOf.get(n) ?? n)
  const driven = walk(cells.flatMap((d) => [d.p, d.int]), drive, isReturn)
  const held = walk(cells.map((d) => d.n), hold, (n) => driven.has(n))
  return { driven, defined: new Set([...driven, ...held]) }
}

/** Ruling R30: the part uid of the open latching switch whose closing alone would drive `node`, or null. */
export function openSwitchFor(c: Circuit, node: string): string | null {
  if (reach(c).driven.has(node)) return null
  for (const o of c.openContacts) if (reach(c, [[netNode(o.a), netNode(o.b)]]).driven.has(node)) return o.part
  return null
}

export function classify(c: Circuit): Classification {
  const find = dcFind(c)
  const nodes = new Set<string>()
  for (const t of c.taps) nodes.add(netNode(t.net)).add(t.node)
  for (const d of c.devices) for (const n of deviceNodes(d)) nodes.add(n)
  const byRoot = new Map<string, Cell[]>()
  for (const cell of cellsOf(c)) {
    const r = find(cell.p)
    byRoot.set(r, [...(byRoot.get(r) ?? []), cell])
  }
  const strongest = (list: Cell[]) =>
    [...list].sort((a, b) => (b.imax?.value ?? -1) - (a.imax?.value ?? -1) || b.volts.value - a.volts.value || naturalCompare(a.part, b.part) || (a.id < b.id ? -1 : 1))[0]
  const members = new Map<string, string[]>()
  for (const n of [...nodes].sort()) {
    const r = find(n)
    if (byRoot.has(r)) members.set(r, [...(members.get(r) ?? []), n])
  }
  const islands: Island[] = [...byRoot.entries()]
    .map(([root, list]) => ({ ref: strongest(list), nodes: members.get(root) ?? [] }))
    .sort((a, b) => naturalCompare(a.ref.part, b.ref.part) || (a.ref.id < b.ref.id ? -1 : 1))
    .map(({ ref, nodes: ns }) => ({ reference: ref.n, source: ref.id, nodes: ns }))
  const islandOf = new Map<string, number>()
  islands.forEach((isl, i) => isl.nodes.forEach((n) => islandOf.set(n, i)))
  return { ...reach(c), islands, islandOf }
}

const memo = new WeakMap<Circuit, Classification>()
export function classifyCached(c: Circuit): Classification {
  let hit = memo.get(c)
  if (!hit) memo.set(c, (hit = classify(c)))
  return hit
}

/** A node's state: driven (powered), defined (held by a return through resistance) or floating. */
export function nodeState(cls: Classification, node: string): NodeState {
  return cls.driven.has(node) ? 'driven' : cls.defined.has(node) ? 'defined' : 'floating'
}

/** A sheet pin's state (by node key); floating when it is on no simulated net. */
export function pinState(c: Circuit, cls: Classification, key: string): NodeState {
  const net = c.pinNet[key]
  return net === undefined ? 'floating' : nodeState(cls, netNode(net))
}
