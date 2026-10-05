// DC-path classification (spec 2, revision 5, and 4.4), before solving: every node is driven or
// floating. Driven means a source's + terminal or a rail output reaches it through conducting
// elements; capacitors, open switches (no element), input-leakage resistors, loads, and a rail's
// return path do not count, so a board behind an open switch is unpowered even when its ground is
// shared, and a wired input held only by leakage floats. Islands are the components that hold a
// source; each one's reference is the return of its source with the largest imax, else the highest
// open-circuit voltage, ties by part uid. A floating node is never reported as a voltage. Pure.
import { naturalCompare } from '../agent/order.ts'
import { type Circuit, type Device, netNode } from './model.ts'

export interface Island { reference: string; source: string; nodes: string[] }
export interface Classification { driven: Set<string>; islands: Island[]; islandOf: Map<string, number> }

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

/** The terminal pairs of a device that count as a DC path (spec 2, revision 5). */
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
      // Input to output only: in, ctl, o and out. inRet and ret are returns, never a path.
      return [[d.in, d.ctl], [d.in, d.o], [d.o, d.out]]
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

/** Ruling R30: the part uid of the open latching switch whose closing alone would connect `node` to a source, or null. */
export function openSwitchFor(c: Circuit, node: string): string | null {
  const cells = cellsOf(c)
  const reaches = (find: (n: string) => string) => cells.some((d) => find(d.p) === find(node))
  if (reaches(dcFind(c))) return null
  for (const o of c.openContacts) if (reaches(dcFind(c, [[netNode(o.a), netNode(o.b)]]))) return o.part
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
  return { driven: new Set(islandOf.keys()), islands, islandOf }
}

const memo = new WeakMap<Circuit, Classification>()
export function classifyCached(c: Circuit): Classification {
  let hit = memo.get(c)
  if (!hit) memo.set(c, (hit = classify(c)))
  return hit
}

/** A sheet pin's node state: floating when its net is not driven or it is on no simulated net. */
export function pinState(c: Circuit, cls: Classification, key: string): 'driven' | 'floating' {
  const net = c.pinNet[key]
  return net !== undefined && cls.driven.has(netNode(net)) ? 'driven' : 'floating'
}
