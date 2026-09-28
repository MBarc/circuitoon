// Turning intent nets into wires on a placed sheet (agent toolkit spec 2.2). Pins a part joins
// inside itself are one node, taking as many wire ends as their capacities add up to. Two nodes get
// one direct wire; more nodes chain through nodes that take two ends; otherwise every node is wired
// to the net's strips: strips named in the net, strips its mounted legs sit in, or a free strip the
// layout claims (ground nets a - rail first, power nets a + rail, signal nets column strips only),
// joined to each other by jumpers. A net's strips are extended by a jumper to a claimed strip only
// while their free holes, together, are fewer than the nodes still to wire, so no hole is held in
// reserve that the net could use (amendment A5); "strip full" means every hole really is taken.
// Never two wire ends in one hole, never a wire into a leg's hole, and everything added for a strip
// is `routing: true`. Pure.
import { type Connection, type Diagram, type Endpoint, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { plugsOf } from '../format/breadboard.ts'
import { type Pt, worldHoles } from '../format/geometry.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { normalizeEnds } from '../format/cables.ts'
import { type Intent, type IntentNet, type Terminal, terminalKey, terminalName } from './netlist.ts'
import { internalComponent } from './internal.ts'
import { naturalCompare } from './order.ts'

export interface Realization {
  connections: Connection[]
  /** Wire uid to the name of the net it realizes. */
  netOfWire: Map<string, string>
}

type NetKind = 'ground' | 'power' | 'signal'
const SIGNAL_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple', 'white', 'brown', 'pink', 'gray']

interface Strip {
  key: string
  board: string
  name: string
  rail?: '+' | '-'
  holes: Pt[]
}
interface Node {
  members: Terminal[]
  /** Wire ends each member still takes. */
  left: Map<string, number>
}

const groupKey = (board: string, group: string) => JSON.stringify([board, group])
const holeKey = (board: string, group: string, hole: number) => JSON.stringify([board, group, hole])
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

function typeOf(m: ModuleDef, name: string): string | undefined {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  return pin ? pin.type : m.holes?.find((g) => g.name === name)?.type
}

export function realize(intent: Intent, d: Diagram): { ok: true; value: Realization } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const plugs = plugsOf(d)
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  const modOf = (ref: string) => moduleOf(d, partBy.get(ref)!.module)!
  const used = new Set(plugs.map((pl) => holeKey(pl.board, pl.group, pl.hole)))
  const legBy = new Map(plugs.map((pl) => [terminalKey(pl.part, pl.pin), pl]))
  const netOfTerminal = new Map<string, number>()
  intent.nets.forEach((n, i) => n.terminals.forEach((t) => netOfTerminal.set(terminalKey(t.ref, t.name), i)))

  // Every strip and rail on the sheet, boards in natural ref order.
  const strips = new Map<string, Strip>()
  for (const p of [...d.parts].sort((a, b) => naturalCompare(a.uid, b.uid))) {
    const m = moduleOf(d, p.module)
    if (!m || !isBoard(m)) continue
    for (const g of worldHoles(p, m)) strips.set(groupKey(p.uid, g.name), { key: groupKey(p.uid, g.name), board: p.uid, name: g.name, rail: g.rail, holes: g.at })
  }
  const owner = new Map<string, number>()
  const reserved = new Set<string>()
  for (const pl of plugs) {
    const ni = netOfTerminal.get(terminalKey(pl.part, pl.pin))
    if (ni === undefined) reserved.add(groupKey(pl.board, pl.group))
    else owner.set(groupKey(pl.board, pl.group), ni)
  }
  const preferred = new Map<string, number>()
  intent.nets.forEach((n, i) => {
    for (const t of n.terminals) {
      if (!t.infra) continue
      const g = groupKey(t.ref, t.name)
      const was = owner.get(g)
      if (reserved.has(g)) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg on no net sits in that strip`)
      else if (was !== undefined && was !== i) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg of net ${intent.nets[was].name} sits in that strip`)
      else owner.set(g, i)
      if (t.hole !== undefined) preferred.set(g, t.hole)
    }
  })
  if (errors.length) return { ok: false, errors }

  const free = (s: Strip) => s.holes.flatMap((_, i) => (used.has(holeKey(s.board, s.name, i)) ? [] : [i]))
  const nearestHole = (s: Strip, at: Pt): number | null => {
    const pref = preferred.get(s.key)
    if (pref !== undefined && !used.has(holeKey(s.board, s.name, pref))) return pref
    let best: number | null = null
    for (const i of free(s)) if (best === null || dist(s.holes[i], at) < dist(s.holes[best], at)) best = i
    return best
  }
  const stripName = (s: Strip) => `${s.board} ${s.name}`
  const pinEnd = (t: Terminal): Endpoint => (modOf(t.ref).holes?.some((g) => g.name === t.name) ? { part: t.ref, pin: t.name, hole: t.hole ?? 0 } : { part: t.ref, pin: t.name })
  const pointOf = (ep: Endpoint): Pt => resolveEndpoint(d, ep)!.end
  const kindOf = (n: IntentNet): NetKind => {
    const types = n.terminals.filter((t) => !t.infra).map((t) => typeOf(modOf(t.ref), t.name))
    return types.includes('ground') ? 'ground' : types.some((t) => t === 'power_in' || t === 'power_out') ? 'power' : 'signal'
  }

  const connections: Connection[] = []
  const netOfWire = new Map<string, string>()
  const ends = intent.ends ? normalizeEnds({ from: intent.ends, to: intent.ends }) : undefined
  let signal = 0
  const colors = intent.nets.map((n) => {
    const kind = kindOf(n)
    return n.color ?? (kind === 'ground' ? 'black' : kind === 'power' ? 'red' : SIGNAL_COLORS[signal++ % SIGNAL_COLORS.length])
  })
  const wire = (ni: number, from: Endpoint, to: Endpoint, routing: boolean) => {
    const uid = `w${connections.length + 1}`
    connections.push({ uid, from, to, color: colors[ni], gauge: 22, ...(ends ? { ends } : {}), ...(routing ? { routing: true } : {}) })
    netOfWire.set(uid, intent.nets[ni].name)
  }
  const holeEnd = (s: Strip, i: number): Endpoint => {
    used.add(holeKey(s.board, s.name, i))
    return { part: s.board, pin: s.name, hole: i }
  }
  /** The member of `node` with an end left, nearest `toward`; takes that end. */
  const take = (node: Node, toward: Pt): Endpoint => {
    let best: Terminal | null = null
    for (const t of node.members) {
      if (!node.left.get(t.name)) continue
      if (!best || dist(pointOf(pinEnd(t)), toward) < dist(pointOf(pinEnd(best)), toward)) best = t
    }
    node.left.set(best!.name, node.left.get(best!.name)! - 1)
    return pinEnd(best!)
  }
  const capOf = (n: Node) => [...n.left.values()].reduce((a, b) => a + b, 0)
  const claim = (ni: number, at: Pt, kind: NetKind, board?: string): Strip | null => {
    const rank = (s: Strip) => (kind === 'ground' ? (s.rail === '-' ? 0 : s.rail ? -1 : 1) : kind === 'power' ? (s.rail === '+' ? 0 : s.rail ? -1 : 1) : s.rail ? -1 : 0)
    let best: Strip | null = null
    let bestRank = 0
    let bestDist = 0
    for (const s of strips.values()) {
      const r = rank(s)
      if (r < 0 || owner.has(s.key) || reserved.has(s.key) || (board !== undefined && s.board !== board) || free(s).length !== s.holes.length) continue
      const dd = dist(s.holes[0], at)
      if (!best || r < bestRank || (r === bestRank && dd < bestDist)) {
        best = s
        bestRank = r
        bestDist = dd
      }
    }
    if (best) owner.set(best.key, ni)
    return best
  }
  const jumper = (ni: number, a: Strip, b: Strip): boolean => {
    let pick: [number, number, number] | null = null
    for (const i of free(a))
      for (const j of free(b)) {
        const dd = dist(a.holes[i], b.holes[j])
        if (!pick || dd < pick[2]) pick = [i, j, dd]
      }
    if (!pick) return false
    wire(ni, holeEnd(a, pick[0]), holeEnd(b, pick[1]), true)
    return true
  }
  const nearestDp = (dps: Strip[], at: Pt): Strip | null => {
    let best: Strip | null = null
    let bestDist = 0
    for (const s of dps) {
      const f = free(s)
      if (!f.length) continue
      const dd = Math.min(...f.map((i) => dist(s.holes[i], at)))
      if (!best || dd < bestDist) {
        best = s
        bestDist = dd
      }
    }
    return best
  }

  for (const [ni, net] of intent.nets.entries()) {
    const kind = kindOf(net)
    const dps: Strip[] = []
    const addDp = (s: Strip | undefined) => {
      if (s && !dps.includes(s)) dps.push(s)
    }
    for (const t of net.terminals) if (t.infra) addDp(strips.get(groupKey(t.ref, t.name)))
    const legStrips = net.terminals.flatMap((t) => {
      const pl = legBy.get(terminalKey(t.ref, t.name))
      return pl ? [groupKey(pl.board, pl.group)] : []
    })
    for (const k of [...new Set(legStrips)].sort(naturalCompare)) addDp(strips.get(k))
    // Loose pins (not plugged, not strips), one node per part-internal component, in natural order.
    const byComp = new Map<string, Terminal[]>()
    for (const t of net.terminals) {
      if (t.infra || legBy.has(terminalKey(t.ref, t.name))) continue
      const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`
      byComp.set(c, [...(byComp.get(c) ?? []), t])
    }
    const nodes: Node[] = [...byComp.keys()].sort(naturalCompare).map((c) => {
      const members = byComp.get(c)!
      return { members, left: new Map(members.map((t) => [t.name, terminalCapacity(modOf(t.ref), t.name)])) }
    })
    const first = (n: Node) => pointOf(pinEnd(n.members[0]))

    if (!dps.length) {
      if (nodes.length < 2) continue
      const wide = nodes.filter((n) => capOf(n) >= 2)
      if (nodes.length === 2 || wide.length >= nodes.length - 2) {
        const inner = nodes.length === 2 ? [] : wide.slice(0, nodes.length - 2)
        const outer = nodes.filter((n) => !inner.includes(n))
        const chain = [outer[0], ...inner, outer[1]]
        for (let k = 1; k < chain.length; k++) {
          const a = take(chain[k - 1], first(chain[k]))
          wire(ni, a, take(chain[k], pointOf(a)), false)
        }
        continue
      }
      const pts = nodes.map(first)
      const center = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
      const s = claim(ni, center, kind)
      if (!s) {
        errors.push(`needs a distribution point: net ${net.name} joins ${nodes.length} pins (${nodes.map((n) => terminalName(n.members[0])).join(', ')}), but a header pin takes one wire. Add a breadboard, a rail strip or a terminal block to the netlist.`)
        continue
      }
      dps.push(s)
    }

    // Join the strips: the nearest pair of free holes first (Prim).
    const joined = [dps[0]]
    const rest = dps.slice(1)
    let full = false
    while (rest.length && !full) {
      let pick: [Strip, Strip, number] | null = null
      for (const a of joined)
        for (const b of rest) {
          const fa = free(a)
          const fb = free(b)
          if (!fa.length || !fb.length) continue
          const dd = Math.min(...fa.flatMap((i) => fb.map((j) => dist(a.holes[i], b.holes[j]))))
          if (!pick || dd < pick[2]) pick = [a, b, dd]
        }
      if (!pick || !jumper(ni, pick[0], pick[1])) full = true
      else {
        joined.push(pick[1])
        rest.splice(rest.indexOf(pick[1]), 1)
      }
    }
    if (full) {
      errors.push(`strip full: net ${net.name} cannot join ${rest.map(stripName).join(', ')}: no free hole left`)
      continue
    }

    // One wire from every node to the nearest strip with a free hole. Only while the strips hold
    // fewer free holes than the nodes still to wire is one of them extended by a jumper to a
    // claimed strip (A5: a hole is never held back when the net has enough).
    const totalFree = () => dps.reduce((sum, s) => sum + free(s).length, 0)
    for (const [k, node] of nodes.entries()) {
      const at = first(node)
      while (totalFree() < nodes.length - k) {
        const from = nearestDp(dps, at)
        const ext = from && (claim(ni, from.holes[0], kind, from.board) ?? claim(ni, at, kind))
        if (!from || !ext || !jumper(ni, from, ext)) break
        dps.push(ext)
      }
      const target = nearestDp(dps, at)
      if (!target) {
        errors.push(`strip full: net ${net.name} has no free hole left on ${dps.map(stripName).join(', ')}`)
        break
      }
      const e = take(node, at)
      wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))!), true)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { connections, netOfWire } }
}
