// Wire colours for a laid-out sheet, by the role the checker gives each net (netRoles): ground
// black, positive supplies red, signals from SIGNAL_PALETTE (no red, no black). A net's wires share
// one colour. Signal nets are coloured in netlist order, each taking the first palette colour no
// neighbour has yet (a neighbour shares a component part with it); when every colour is taken by
// a neighbour, the one fewest neighbours use. A colour the netlist gives a net (wires.color) wins,
// and counts as taken. A net with no colour role (mains, or both a ground and a supply) keeps the
// colour it was realized with. Pure.
import type { Connection, Diagram } from '../format/diagram.ts'
import { ROLE_COLORS, netRoles } from '../format/checks.ts'
import { nodeKey } from '../format/netlist.ts'
import type { Intent } from './netlist.ts'

/** Readable on the light and dark sheet, and never red or black (those mean power and ground). */
export const SIGNAL_PALETTE = ['blue', 'green', 'yellow', 'orange', 'purple', 'brown', 'pink', 'gray', '#00A6A6', '#6B8E23']

export function colorByRole(intent: Intent, d: Diagram, netOfWire: Map<string, string>): Connection[] {
  const roles = netRoles(d)
  const firstWire = new Map<string, Connection>()
  for (const c of d.connections) {
    const net = netOfWire.get(c.uid)
    if (net !== undefined && !firstWire.has(net)) firstWire.set(net, c)
  }
  const partsOf = new Map(intent.nets.map((n) => [n.name, new Set(n.terminals.filter((t) => !t.infra).map((t) => t.ref))]))
  const neighbours = (a: string, b: string) => [...partsOf.get(a)!].some((r) => partsOf.get(b)!.has(r))
  const chosen = new Map<string, string>()
  const signals: string[] = []
  for (const n of intent.nets) {
    const c = firstWire.get(n.name)
    if (!c) continue
    if (n.color) {
      chosen.set(n.name, n.color)
      continue
    }
    const role = roles.roleOfKey(nodeKey(c.from.part, c.from.pin))
    if (role === 'signal') signals.push(n.name)
    else if (role) chosen.set(n.name, ROLE_COLORS[role]!)
  }
  for (const net of signals) {
    const used = new Map<string, number>()
    for (const [other, color] of chosen) if (neighbours(net, other)) used.set(color, (used.get(color) ?? 0) + 1)
    const free = SIGNAL_PALETTE.find((c) => !used.has(c))
    chosen.set(net, free ?? SIGNAL_PALETTE.reduce((best, c) => (used.get(c)! < used.get(best)! ? c : best)))
  }
  return d.connections.map((c) => {
    const color = chosen.get(netOfWire.get(c.uid) ?? '')
    return color && color !== c.color ? { ...c, color } : c
  })
}
