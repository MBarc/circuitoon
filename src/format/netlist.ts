// Nets: sets of pins and hole groups joined by wires, mounted legs and `internal` groups. Feeds
// hover highlighting now and the V2 simulation later. Pure.
import { type Diagram, moduleOf } from './diagram.ts'
import { type Plug, plugsOf } from './breadboard.ts'

/** One key per part pin or hole group; JSON keeps any character in a uid or name unambiguous. */
export const nodeKey = (part: string, pin: string): string => JSON.stringify([part, pin])

export interface Netlist {
  /** Each net's node keys, sorted; nets sorted by their first node. Single nodes are left out. */
  nets: string[][]
  /** Node key to its index in `nets`. */
  netOf: Map<string, number>
}

export function netlist(d: Diagram, plugs: Plug[] = plugsOf(d)): Netlist {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) root = up
    for (let cur = k; cur !== root; ) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const c of d.connections) join(nodeKey(c.from.part, c.from.pin), nodeKey(c.to.part, c.to.pin))
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    for (const group of m?.internal ?? []) for (let i = 1; i < group.length; i++) join(nodeKey(p.uid, group[0]), nodeKey(p.uid, group[i]))
  }
  for (const pl of plugs) join(nodeKey(pl.part, pl.pin), nodeKey(pl.board, pl.group))

  const byRoot = new Map<string, string[]>()
  for (const k of parent.keys()) {
    const r = find(k)
    const list = byRoot.get(r)
    if (list) list.push(k)
    else byRoot.set(r, [k])
  }
  const nets = [...byRoot.values()].filter((n) => n.length > 1).map((n) => n.sort())
  nets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const netOf = new Map<string, number>()
  nets.forEach((n, i) => n.forEach((k) => netOf.set(k, i)))
  return { nets, netOf }
}
