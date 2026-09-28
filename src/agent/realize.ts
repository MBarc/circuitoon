// Turning intent nets into wires on a placed sheet (agent toolkit spec 2.2). Pins a part joins
// inside itself are one node, taking as many wire ends as their capacities add up to. Two nodes get
// one direct wire; more nodes chain through nodes that take two ends; otherwise every node is wired
// to the net's strips: strips named in the net, strips its mounted legs sit in, or a free strip the
// layout claims (ground nets a - rail first, power nets a + rail, signal nets column strips only),
// joined to each other by jumpers. A net's strips are extended by a jumper to a claimed strip only
// while their free holes, together, are fewer than the nodes still to wire, so no hole is held in
// reserve that the net could use (amendment A5); "strip full" means every hole really is taken.
// Never two wire ends in one hole, never a wire into a leg's hole, and everything added for a strip
// is `routing: true`. A repeat block's pins on a shared net go to its own local strips (amendment A18.1),
// which are chained to each other and joined to the rest of the net by one trunk wire. Pure.
import { type Connection, type Diagram, type Endpoint, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { plugsOf } from '../format/breadboard.ts'
import { type Pt, worldHoles } from '../format/geometry.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { normalizeEnds } from '../format/cables.ts'
import { type Intent, type IntentNet, type Terminal, terminalKey, terminalName } from './netlist.ts'
import { internalComponent } from './internal.ts'
import { naturalCompare } from './order.ts'

/**
 * A repeat block's own distribution point for one shared net (amendment A18.1): rail strips the
 * placement added beside the block (routing infrastructure, not in the intent). The block's pins on
 * that net are wired into these strips only, the strips are chained to each other, and one trunk
 * wire joins them to the rest of the net.
 */
export interface LocalDistribution {
  /** Index of the net in `intent.nets`. */
  net: number
  /** Refs of the rail strips, in order. */
  strips: string[]
  /** The rail of each strip the net takes. */
  rail: '+' | '-'
  /** Refs of the block's parts, whose pins on the net use these strips. */
  refs: string[]
}

export interface Realization {
  connections: Connection[]
  /** Wire uid to the name of the net it realizes. */
  netOfWire: Map<string, string>
}

export type NetKind = 'ground' | 'power' | 'signal'
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
/** "a", "a and b", "a, b and c". */
const joinList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

function typeOf(m: ModuleDef, name: string): string | undefined {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  return pin ? pin.type : m.holes?.find((g) => g.name === name)?.type
}

/** Whether a net carries ground, power or a signal, from the types of its component pins. */
export function netKind(intent: Intent, n: IntentNet): NetKind {
  const mods = new Map(intent.parts.map((p) => [p.ref, intent.modules[p.module]]))
  const types = n.terminals.filter((t) => !t.infra).map((t) => typeOf(mods.get(t.ref)!, t.name))
  return types.includes('ground') ? 'ground' : types.some((t) => t === 'power_in' || t === 'power_out') ? 'power' : 'signal'
}

export function realize(intent: Intent, d: Diagram, locals: LocalDistribution[] = []): { ok: true; value: Realization } | { ok: false; errors: string[] } {
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
  const kindOf = (n: IntentNet): NetKind => netKind(intent, n)
  // Local strips serve only their block's net: never claimed by another net.
  const localBoards = new Set(locals.flatMap((l) => l.strips))

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
  const ncKeys = new Set(intent.nc.map((t) => terminalKey(t.ref, t.name)))
  /** Pins joined inside a part that one net borrowed (below), so no other net takes them too. */
  const borrowed = new Set<string>()
  /**
   * The pins a node's part joins to it inside itself (an ESP32's GND 2 and GND 3 beside GND) that
   * the netlist leaves free: on no net, not nc, not plugged into a board, not already borrowed.
   */
  const joinedSpares = (n: Node): Terminal[] => {
    const { ref } = n.members[0]
    const m = modOf(ref)
    const comp = internalComponent(m, n.members[0].name)
    const names = new Set(n.members.map((t) => t.name))
    return [...new Set((m.internal ?? []).flat())]
      .filter((name) => !names.has(name) && internalComponent(m, name) === comp && !m.holes?.some((g) => g.name === name))
      .filter((name) => {
        const k = terminalKey(ref, name)
        return !netOfTerminal.has(k) && !ncKeys.has(k) && !legBy.has(k) && !borrowed.has(k)
      })
      .sort(naturalCompare)
      .map((name) => ({ ref, name, infra: false }))
  }
  /** Whether the nodes can be wired as one chain: both ends take one wire, every inner node two. */
  const chainable = (nodes: Node[]) => nodes.length === 2 || nodes.filter((n) => capOf(n) >= 2).length >= nodes.length - 2
  const chainUp = (ni: number, nodes: Node[]) => {
    const first = (n: Node) => pointOf(pinEnd(n.members[0]))
    const wide = nodes.filter((n) => capOf(n) >= 2)
    const inner = nodes.length === 2 ? [] : wide.slice(0, nodes.length - 2)
    const outer = nodes.filter((n) => !inner.includes(n))
    const chain = [outer[0], ...inner, outer[1]]
    for (let k = 1; k < chain.length; k++) {
      const a = take(chain[k - 1], first(chain[k]))
      wire(ni, a, take(chain[k], pointOf(a)), false)
    }
  }
  const claim = (ni: number, at: Pt, kind: NetKind, board?: string): Strip | null => {
    const rank = (s: Strip) => (kind === 'ground' ? (s.rail === '-' ? 0 : s.rail ? -1 : 1) : kind === 'power' ? (s.rail === '+' ? 0 : s.rail ? -1 : 1) : s.rail ? -1 : 0)
    let best: Strip | null = null
    let bestRank = 0
    let bestDist = 0
    for (const s of strips.values()) {
      const r = rank(s)
      if (r < 0 || localBoards.has(s.board) || owner.has(s.key) || reserved.has(s.key) || (board !== undefined && s.board !== board) || free(s).length !== s.holes.length) continue
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
    // The net's local distribution points (A18.1): each block's strips, and the nodes they serve.
    const groups = locals
      .filter((l) => l.net === ni)
      .map((l) => ({ refs: new Set(l.refs), strips: l.strips.map((b) => strips.get(groupKey(b, l.rail))).filter((x): x is Strip => !!x) }))
      .filter((g) => g.strips.length)
    for (const g of groups) for (const st of g.strips) owner.set(st.key, ni)
    const groupOf = (n: Node) => groups.find((g) => g.refs.has(n.members[0].ref))
    const own = nodes.filter((n) => !groupOf(n))
    // Local strips carry their block's pins. A net with no strips of its own whose other pins are
    // two or more claims one for them, so each block keeps a single trunk; a lone other pin's wire
    // is itself the trunk. Only when nothing can be claimed do the other pins go into the local
    // strips (below, `reach` falls back to them).
    if (!dps.length && groups.length && own.length >= 2) {
      const pts = own.map(first)
      const s = claim(ni, { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }, kind)
      if (s) dps.push(s)
    }

    if (!dps.length && !groups.length) {
      if (nodes.length < 2) continue
      if (chainable(nodes)) {
        chainUp(ni, nodes)
        continue
      }
      const pts = nodes.map(first)
      const center = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
      const s = claim(ni, center, kind)
      if (!s) {
        // No strip to claim: the pins each part joins inside itself that the netlist leaves free
        // take a wire each too (verify counts them as the same node), so a net a pin or two short
        // still chains. Used only here, so a net that fits never moves to a pin it did not list.
        const spares = nodes.map(joinedSpares)
        const grown = nodes.map((n, i) => ({ members: [...n.members, ...spares[i]], left: new Map([...n.left, ...spares[i].map((t): [string, number] => [t.name, terminalCapacity(modOf(t.ref), t.name)])]) }))
        if (chainable(grown)) {
          for (const t of spares.flat()) borrowed.add(terminalKey(t.ref, t.name))
          chainUp(ni, grown)
          continue
        }
        const counted = spares.flat()
        const inside = new Set(counted.map((t) => t.ref)).size === 1 ? 'the part' : 'their parts'
        const also = counted.length ? `, even counting the free ${counted.length === 1 ? 'pin' : 'pins'} joined to them inside ${inside} (${joinList(counted.map(terminalName))})` : ''
        errors.push(`needs a distribution point: net ${net.name} joins ${nodes.length} pins (${nodes.map((n) => terminalName(n.members[0])).join(', ')}), but a header pin takes one wire${also}. Add a breadboard, a rail strip or a terminal block to the netlist.`)
        continue
      }
      dps.push(s)
    }

    /** The nearest pair of free holes between `from` and `to`, or null when either side has none. */
    const nearestPair = (from: Strip[], to: Strip[]): [Strip, Strip] | null => {
      let pick: [Strip, Strip, number] | null = null
      for (const a of from)
        for (const b of to) {
          const fa = free(a)
          const fb = free(b)
          if (!fa.length || !fb.length) continue
          const dd = Math.min(...fa.flatMap((i) => fb.map((j) => dist(a.holes[i], b.holes[j]))))
          if (!pick || dd < pick[2]) pick = [a, b, dd]
        }
      return pick && [pick[0], pick[1]]
    }
    /** Joins `list` into one tree by jumpers, the nearest pair of free holes first (Prim); the strips left unjoined. */
    const joinAll = (list: Strip[]): Strip[] => {
      const joined = list.slice(0, 1)
      const rest = list.slice(1)
      while (rest.length) {
        const pick = nearestPair(joined, rest)
        if (!pick || !jumper(ni, pick[0], pick[1])) break
        joined.push(pick[1])
        rest.splice(rest.indexOf(pick[1]), 1)
      }
      return rest
    }

    // Join the net's strips, then each block's strips among themselves, and each block to the rest
    // of the net by one trunk wire (to the net's own strips when it has any).
    let unjoined = joinAll(dps)
    const pool = [...dps]
    for (const g of groups) {
      unjoined = [...unjoined, ...joinAll(g.strips)]
      if (pool.length) {
        const pick = nearestPair(g.strips, dps.length ? dps : pool)
        if (!pick || !jumper(ni, pick[0], pick[1])) unjoined = [...unjoined, ...g.strips]
      }
      pool.push(...g.strips)
    }
    if (unjoined.length) {
      errors.push(`strip full: net ${net.name} cannot join ${unjoined.map(stripName).join(', ')}: no free hole left`)
      continue
    }

    // Every pin of a block goes to the nearest of its block's strips.
    let stuck = false
    for (const node of nodes) {
      const g = groupOf(node)
      if (!g) continue
      const at = first(node)
      const target = nearestDp(g.strips, at)
      if (!target) {
        errors.push(`strip full: net ${net.name} has no free hole left on ${g.strips.map(stripName).join(', ')}`)
        stuck = true
        break
      }
      const e = take(node, at)
      wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))!), true)
    }
    if (stuck) continue

    // One wire from every other node to the nearest strip with a free hole. Only while the strips
    // hold fewer free holes than the nodes still to wire is one of them extended by a jumper to a
    // claimed strip (A5: a hole is never held back when the net has enough). A net whose only
    // strips are local ones (one other pin, or nothing left to claim) wires its other pins to those.
    const reach = dps.length ? dps : pool
    const totalFree = () => reach.reduce((sum, s) => sum + free(s).length, 0)
    for (const [k, node] of own.entries()) {
      const at = first(node)
      while (totalFree() < own.length - k) {
        const from = nearestDp(reach, at)
        const ext = from && (claim(ni, from.holes[0], kind, from.board) ?? claim(ni, at, kind))
        if (!from || !ext || !jumper(ni, from, ext)) break
        reach.push(ext)
      }
      const target = nearestDp(reach, at)
      if (!target) {
        errors.push(`strip full: net ${net.name} has no free hole left on ${reach.map(stripName).join(', ')}`)
        break
      }
      const e = take(node, at)
      wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))!), true)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { connections, netOfWire } }
}
