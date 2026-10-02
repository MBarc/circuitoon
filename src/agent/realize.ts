// Turning intent nets into wires on a placed sheet (agent toolkit spec 2.2). Pins a part joins
// inside itself are one node, taking as many wire ends as their capacities add up to. Two nodes get
// one direct wire; more nodes chain through nodes that take two ends; otherwise every node is wired
// to the net's strips: strips named in the net, strips its mounted legs sit in, or a free strip the
// layout claims (ground nets a - rail first, power nets a + rail, signal nets column strips only),
// joined to each other by jumpers. A net's strips are extended by a jumper to a claimed strip only
// while their free holes, together, are fewer than the nodes still to wire, so no hole is held in
// reserve that the net could use (amendment A5); "strip full" means every hole really is taken.
// Never two wire ends in one hole, never a wire into a leg's hole or a hole under a mounted part's
// body, and everything added for a strip
// is `routing: true`. A repeat block's pins on a shared net go to its own local strips (amendment A18.1),
// which are chained to each other and joined to the rest of the net by one trunk wire. Pure.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { FANOUT_MIN, type LabelMode, LabelPlacer, type LabelSpot, autoLabels, edgeExits } from './labelling.ts'
import { coveredHoles, plugsOf } from '../format/breadboard.ts'
import { type Pt, worldHoles } from '../format/geometry.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { normalizeEnds } from '../format/cables.ts'
import { tipLabelBoxes } from '../render/captionBox.ts'
import { type BoardStrip, exitDirt, holeExits } from '../format/boardEntry.ts'
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
  /** Net labels the layout placed (net-label parts), and the nets drawn with them, in netlist order. */
  labels: PartInstance[]
  labelled: string[]
  /** Nets that wanted labels but had an endpoint with no clear spot, so they are wired (more spacing may make room). */
  unlabelled: string[]
}

export interface RealizeOptions {
  /**
   * Which nets get net labels (default none: only the nets that ask, `"label": true`; Ruling W1).
   * A mains net or one with local strips never does.
   */
  labels?: LabelMode
  /** The net-label module; without it no net is labelled. */
  labelModule?: ModuleDef
  /** Spare boards placed as hubs (Ruling W1): a signal net that claims a strip takes one of theirs first. */
  hubs?: string[]
  /** Parked boards (no connection, in the "Not yet wired" frame): never claimed. */
  parked?: string[]
}

export type NetKind = 'ground' | 'power' | 'signal'
/** A pin farther than this (px, along the grid) from its net's strips may get a local strip on a hub (Ruling W1). */
const FAR = 300
/** A hole whose cheapest straight way out passes over another hole costs at least this (holeChoice). */
const DIRTY = 600
/** Holes at the inner end of a hub half-row kept for the jumpers that join the net's half-rows. */
const JUMPER_HOLES = 3
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

export function realize(intent: Intent, d: Diagram, locals: LocalDistribution[] = [], opts: RealizeOptions = {}): { ok: true; value: Realization } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const plugs = plugsOf(d)
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  const modOf = (ref: string) => moduleOf(d, partBy.get(ref)!.module)!
  const used = new Set(plugs.map((pl) => holeKey(pl.board, pl.group, pl.hole)))
  // A hole under a mounted part's body takes nothing; a strip counts as unclaimed with it covered.
  const covered = new Map<string, number>()
  const coveredBy = new Map<string, Set<string>>()
  for (const c of coveredHoles(d)) {
    const g = groupKey(c.board, c.group)
    used.add(holeKey(c.board, c.group, c.hole))
    covered.set(g, (covered.get(g) ?? 0) + 1)
    coveredBy.set(g, (coveredBy.get(g) ?? new Set<string>()).add(c.by))
  }
  /** Why full strips are full when bodies cover some of their holes: " (the other holes there lie under U2's body)". */
  const under = (list: Strip[]) => {
    const parts = [...new Set(list.flatMap((s) => [...(coveredBy.get(s.key) ?? [])]))].sort(naturalCompare)
    return parts.length ? ` (the other holes there lie under ${joinList(parts.map((u) => `${partBy.get(u)?.designator ?? u}'s body`))})` : ''
  }
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
  // Holes under a mounted part's pin names drawn past its tips (a DIP chip's rows b to d and g to i,
  // Ruling C3): free, but a wire end there would hide a name, so they are taken last.
  const labelled = new Set<string>()
  for (const p of new Set(plugs.map((pl) => pl.part))) {
    const part = partBy.get(p)!
    const boxes = tipLabelBoxes(part, modOf(p))
    if (!boxes.length) continue
    for (const s of strips.values())
      s.holes.forEach((h, i) => {
        if (boxes.some((r) => h.x >= r.x && h.x <= r.x + r.w && h.y >= r.y && h.y <= r.y + r.h)) labelled.add(holeKey(s.board, s.name, i))
      })
  }
  /** The free holes of `s`, those clear of pin names only when it has any. */
  const clear = (s: Strip) => {
    const f = free(s)
    const c = f.filter((i) => !labelled.has(holeKey(s.board, s.name, i)))
    return c.length ? c : f
  }
  // Ruling W1: a wire ends on a board in use by one straight run in from an edge, so a hole is
  // chosen whose run toward the wire's other end crosses no other strip's hole in use, and that lies
  // on no run already planned for another wire's hole.
  const boardRect = new Map<string, { x: number; y: number; w: number; h: number }>()
  const rectOf = (board: string) => {
    let r = boardRect.get(board)
    if (!r) boardRect.set(board, (r = bodyRect(partBy.get(board)!, layoutModule(modOf(board)))))
    return r
  }
  const runs = new Map<string, [Pt, Pt][]>()
  /** Where wire ends already sit, by board. */
  const wiredAt = new Map<string, Pt[]>()
  const onSeg = (p: Pt, [a, b]: [Pt, Pt]) =>
    Math.abs(a.x - b.x) < 1 ? Math.abs(p.x - a.x) <= 3 && p.y >= Math.min(a.y, b.y) - 3 && p.y <= Math.max(a.y, b.y) + 3 : Math.abs(p.y - a.y) <= 3 && p.x >= Math.min(a.x, b.x) - 3 && p.x <= Math.max(a.x, b.x) + 3
  /** The straight run from hole `i` of `s` out to the board edge that heads best toward `at`. */
  const boardStrips = new Map<string, BoardStrip[]>()
  const stripsOfBoard = (board: string) => {
    let list = boardStrips.get(board)
    if (!list) boardStrips.set(board, (list = [...strips.values()].filter((o) => o.board === board).map((o) => ({ id: o.name, holes: o.holes, rail: !!o.rail }))))
    return list
  }
  /** Each hole's key by its position, per board (built once), so whether a hole is in use is one lookup. */
  const keyAt = new Map<string, Map<string, string>>()
  const usedAt = (board: string) => {
    let m = keyAt.get(board)
    if (!m) {
      keyAt.set(board, (m = new Map()))
      for (const o of strips.values()) if (o.board === board) o.holes.forEach((p, j) => m!.set(`${Math.round(p.x)},${Math.round(p.y)}`, holeKey(o.board, o.name, j)))
    }
    const at = m
    return (q: Pt) => {
      const k = at.get(`${Math.round(q.x)},${Math.round(q.y)}`)
      return k !== undefined && used.has(k)
    }
  }
  /** The cleanest straight way out of hole `i` of `s` (boardEntry.ts), and how unclean it is, plus its run. */
  const exitOf = (s: Strip, i: number, at: Pt): { run: [Pt, Pt]; dirt: number; ownUsed: number } => {
    const r = rectOf(s.board)
    const h = s.holes[i]
    const exits = holeExits(r, stripsOfBoard(s.board), s.name, h, usedAt(s.board))
    const cost = (e: { edge: Pt }) => dist(h, e.edge) + dist(e.edge, at)
    const best = exits.reduce<(typeof exits)[number] | null>((a, x) => (!a || exitDirt(x) < exitDirt(a) || (exitDirt(x) === exitDirt(a) && cost(x) < cost(a)) ? x : a), null)
    return best ? { run: [h, best.edge], dirt: exitDirt(best), ownUsed: best.ownUsed } : { run: [h, h], dirt: 99, ownUsed: 0 }
  }
  const runClash = (s: Strip, i: number, at: Pt): number => {
    const { run, dirt } = exitOf(s, i, at)
    let n = dirt
    for (const r of runs.get(s.board) ?? []) if (onSeg(s.holes[i], r)) n += 10
    // A rail hole level with a strip whose legs or wires are in use, or which is the hub's or a
    // mounted part's strip, would stand in the way of that strip's own straight way out to the edge.
    if (s.rail) {
      const h = s.holes[i]
      const along = Math.abs(s.holes[0].y - s.holes[s.holes.length - 1].y) < 1 ? 'x' : 'y'
      for (const o of strips.values()) {
        if (o.board !== s.board || o === s || o.rail) continue
        if ((owner.has(o.key) || o.holes.some((p, j) => used.has(holeKey(o.board, o.name, j)))) && o.holes.some((p) => Math.abs(p[along] - h[along]) < 3)) n += 12
      }
    }
    return n
  }
  /** The best free hole of `s` for a wire toward `at`, and its cost: near, with a clean straight way out. */
  const holeChoice = (s: Strip, at: Pt): { i: number; cost: number } | null => {
    const pref = preferred.get(s.key)
    if (pref !== undefined && !used.has(holeKey(s.board, s.name, pref))) return { i: pref, cost: 0 }
    let best: { i: number; cost: number } | null = null
    for (const i of clear(s)) {
      // A hole right beside another wire's end costs a little: wire ends a hole apart leave in pairs
      // one grid step apart, which reads as crowded.
      const h = s.holes[i]
      const beside = (wiredAt.get(s.board) ?? []).filter((q) => Math.abs(q.x - h.x) + Math.abs(q.y - h.y) <= 12).length
      const c = dist(h, at) + 100 * runClash(s, i, at) + 25 * beside
      if (!best || c < best.cost) best = { i, cost: c }
    }
    return best
  }
  const nearestHole = (s: Strip, at: Pt): number | null => {
    const best = holeChoice(s, at)
    if (best) runs.set(s.board, [...(runs.get(s.board) ?? []), exitOf(s, best.i, at).run])
    return best?.i ?? null
  }
  /** Of `list`, the strip whose best hole for a wire toward `at` costs least (Ruling W1: a clean way in counts, not distance alone). */
  const bestDp = (list: Strip[], at: Pt): Strip | null => {
    let best: Strip | null = null
    let bestCost = Infinity
    for (const st of list) {
      const c = holeChoice(st, at)
      if (c && c.cost < bestCost) {
        best = st
        bestCost = c.cost
      }
    }
    return best
  }
  const stripName = (s: Strip) => `${s.board} ${s.name}`
  const pinEnd = (t: Terminal): Endpoint => (modOf(t.ref).holes?.some((g) => g.name === t.name) ? { part: t.ref, pin: t.name, hole: t.hole ?? 0 } : { part: t.ref, pin: t.name })
  const pointOf = (ep: Endpoint): Pt => resolveEndpoint(d, ep)!.end
  const kindOf = (n: IntentNet): NetKind => netKind(intent, n)
  // Local strips serve only their block's net, and parked boards nothing: never claimed by another net.
  const localBoards = new Set([...locals.flatMap((l) => l.strips), ...(opts.parked ?? [])])
  const hubs = new Set(opts.hubs ?? [])

  const connections: Connection[] = []
  const netOfWire = new Map<string, string>()
  const ends = intent.ends ? normalizeEnds({ from: intent.ends, to: intent.ends }) : undefined
  let signal = 0
  const colors = intent.nets.map((n) => {
    const kind = kindOf(n)
    return n.color ?? (kind === 'ground' ? 'black' : kind === 'power' ? 'red' : SIGNAL_COLORS[signal++ % SIGNAL_COLORS.length])
  })
  const wire = (ni: number, from: Endpoint, to: Endpoint, routing: boolean, toLabel = false) => {
    const uid = `w${connections.length + 1}`
    // The layout chooses every colour on purpose (the netlist's, else by role): colorSet, so it is judged.
    // A stub to a net label is drawn plain: no connector belongs at a label.
    connections.push({ uid, from, to, color: colors[ni], colorSet: true, gauge: 22, ...(ends && !toLabel ? { ends } : {}), ...(routing ? { routing: true } : {}) })
    netOfWire.set(uid, intent.nets[ni].name)
  }
  const holeEnd = (s: Strip, i: number): Endpoint => {
    used.add(holeKey(s.board, s.name, i))
    wiredAt.set(s.board, [...(wiredAt.get(s.board) ?? []), s.holes[i]])
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
    const rank = (s: Strip) => (kind === 'ground' ? (s.rail === '-' ? 0 : s.rail ? -1 : 1) : kind === 'power' ? (s.rail === '+' ? 0 : s.rail ? -1 : 1) : s.rail ? -1 : hubs.size && !hubs.has(s.board) ? 1 : 0)
    let best: Strip | null = null
    let bestRank = 0
    let bestDist = 0
    for (const s of strips.values()) {
      const r = rank(s)
      if (r < 0 || localBoards.has(s.board) || (hubPlan.size > 0 && hubs.has(s.board)) || owner.has(s.key) || reserved.has(s.key) || (board !== undefined && s.board !== board) || free(s).length !== s.holes.length - (covered.get(s.key) ?? 0)) continue
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
    for (const i of clear(a))
      for (const j of clear(b)) {
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

  // Net labels (piece B): a labelled net gets one label per endpoint (a loose pin, a repeat copy or
  // group's pins, the net's strips), each joined to it by short routing stubs, instead of wires
  // running between them. All or nothing per net: when one endpoint finds no clear spot, the net is
  // wired as before.
  const mode = opts.labels ?? 'none'
  const placer = opts.labelModule && (mode !== 'none' || intent.nets.some((n) => n.label)) ? new LabelPlacer(d, opts.labelModule) : null
  const labels: PartInstance[] = []
  const labelledNets: string[] = []
  const unlabelled: string[] = []
  const groupOfRef = new Map<string, string>()
  for (const g of intent.groups) for (const r of g.refs) groupOfRef.set(r, `group ${g.name}`)
  for (const c of intent.copies) for (const r of c.refs) groupOfRef.set(r, `copy ${c.id}`)
  const mainsNet = (n: IntentNet) => n.terminals.some((t) => mainsOf(modOf(t.ref)).terminals.has(t.name))
  /** Whether a net is drawn with labels, from its endpoints (each node's first pin, and the net's strips as one). */
  const wants = (net: IntentNet, kind: NetKind, ends: { at: Pt; group: string | undefined }[]) =>
    ends.length >= 2 && (!!net.label || mode === 'all' || (mode === 'auto' && autoLabels({ kind, ends })))
  /** The loose pins of a net as nodes (one per part-internal component, in natural order), and its first strip. */
  const shapeOf = (net: IntentNet) => {
    const byComp = new Map<string, Terminal[]>()
    let strip: Strip | undefined
    for (const t of net.terminals) {
      const pl = legBy.get(terminalKey(t.ref, t.name))
      if (t.infra || pl) {
        strip ??= strips.get(t.infra ? groupKey(t.ref, t.name) : groupKey(pl!.board, pl!.group))
        continue
      }
      const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`
      byComp.set(c, [...(byComp.get(c) ?? []), t])
    }
    return { heads: [...byComp.keys()].sort(naturalCompare).map((c) => byComp.get(c)![0]), strip }
  }

  // Dense groups first (FANOUT_MIN or more labelled pins or pads on one side of a part: a header, a
  // display connector, an expander's pads): their labels are reserved as one ordered row beside the
  // part, on the side the pins face, in pin order, so the stubs run short and never cross. Pads
  // inside a body all leave by the edge nearest to them as a group, their labels at 10 px pitch.
  const rowSpots = new Map<string, LabelSpot>()
  if (placer) {
    const byPart = new Map<string, { key: string; name: string; at: Pt; dir: Pt | null }[]>()
    intent.nets.forEach((net, ni) => {
      if (locals.some((l) => l.net === ni) || mainsNet(net)) return
      const { heads, strip } = shapeOf(net)
      const ends = [...heads.map((t) => ({ at: pointOf(pinEnd(t)), group: groupOfRef.get(t.ref) })), ...(strip ? [{ at: strip.holes[0], group: groupOfRef.get(strip.board) }] : [])]
      if (!wants(net, kindOf(net), ends)) return
      const seen = new Set<string>()
      for (const t of heads) {
        if (seen.has(t.ref)) continue
        seen.add(t.ref)
        const at = resolveEndpoint(d, pinEnd(t))
        if (at) byPart.set(t.ref, [...(byPart.get(t.ref) ?? []), { key: `${ni}|${t.ref}`, name: net.name, at: at.end, dir: at.dir }])
      }
    })
    for (const [ref, items] of [...byPart].sort((a, b) => naturalCompare(a[0], b[0]))) {
      if (items.length < FANOUT_MIN) continue
      const body = bodyRect(partBy.get(ref)!, layoutModule(modOf(ref)))
      // A pad leaves with its column of pads (same x) by the nearer side edge, or with its row
      // (same y) by the nearer top or bottom edge; a pad alone by its nearest edge.
      const pads = items.filter((x) => !x.dir)
      const padDir = (p: Pt): Pt => {
        const inColumn = pads.filter((o) => o.at.x === p.x).length >= 2
        const inRow = pads.filter((o) => o.at.y === p.y).length >= 2
        if (inColumn && (!inRow || pads.filter((o) => o.at.x === p.x).length >= pads.filter((o) => o.at.y === p.y).length))
          return p.x - body.x <= body.x + body.w - p.x ? { x: -1, y: 0 } : { x: 1, y: 0 }
        if (inRow) return p.y - body.y <= body.y + body.h - p.y ? { x: 0, y: -1 } : { x: 0, y: 1 }
        return edgeExits(body, p)[0].dir
      }
      const sides = new Map<string, { dir: Pt; list: typeof items }>()
      for (const x of items) {
        const dir = x.dir ?? padDir(x.at)
        const k = `${dir.x},${dir.y}`
        sides.set(k, { dir, list: [...(sides.get(k)?.list ?? []), x] })
      }
      for (const { dir, list } of sides.values()) {
        if (list.length < FANOUT_MIN) continue
        const across = dir.x !== 0
        const along = (p: Pt) => (across ? p.y : p.x)
        // Pin order along the side; of two pads level with each other, the one nearer the edge first.
        const toEdge = (p: Pt) => (dir.x < 0 ? p.x - body.x : dir.x > 0 ? body.x + body.w - p.x : dir.y < 0 ? p.y - body.y : body.y + body.h - p.y)
        const sorted = [...list].sort((a, b) => along(a.at) - along(b.at) || toEdge(a.at) - toEdge(b.at))
        const own = sorted.every((x, i) => i === 0 || along(x.at) - along(sorted[i - 1].at) >= 10)
        const mid = sorted.reduce((a, x) => a + along(x.at), 0) / sorted.length
        // The row's line: the pin tips for pins, the body edge for pads.
        const pinsOnly = sorted.every((x) => x.dir)
        const edge = (p: Pt): Pt =>
          pinsOnly ? p : across ? { x: dir.x < 0 ? body.x : body.x + body.w, y: p.y } : { x: p.x, y: dir.y < 0 ? body.y : body.y + body.h }
        const slots = sorted.map((x, i) => {
          const at = own ? along(x.at) : Math.round(mid - ((sorted.length - 1) / 2) * 10 + i * 10)
          const base = edge(x.at)
          return across ? { x: base.x, y: at } : { x: at, y: base.y }
        })
        const row = placer.row(sorted.map((x, i) => ({ name: x.name, slot: slots[i] })), dir, ref)
        if (row) sorted.forEach((x, i) => rowSpots.set(x.key, row[i]))
      }
    }
  }

  const labelNet = (ni: number, net: IntentNet, kind: NetKind, nodes: Node[], dps: Strip[], local: boolean): boolean => {
    if (!placer || local || mainsNet(net)) return false
    const head = (n: Node) => pointOf(pinEnd(n.members[0]))
    const ends = [
      ...nodes.map((n) => ({ at: head(n), group: groupOfRef.get(n.members[0].ref) })),
      ...(dps.length ? [{ at: dps[0].holes[0], group: groupOfRef.get(dps[0].board) }] : []),
    ]
    if (!wants(net, kind, ends)) return false
    // One label per endpoint: the pins one part puts on the net share a label (an expander's GND and
    // address pads), every other pin gets its own, right at the pin, so no wire loops back from a
    // neighbouring part (a ball's two switches each get theirs); the net's strips share one.
    const clusters = new Map<string, Node[]>()
    for (const n of nodes) {
      const key = `part ${n.members[0].ref}`
      clusters.set(key, [...(clusters.get(key) ?? []), n])
    }
    if (clusters.size + (dps.length ? 1 : 0) < 2) return false
    const before = placer.mark()
    const fail = () => {
      placer.rollback(before)
      unlabelled.push(net.name)
      return false
    }
    const pinOf = (node: Node) => node.members.find((x) => (node.left.get(x.name) ?? 0) > 0)
    const plan: { spot: LabelSpot; from: Pt; pins: { node: Node; t: Terminal }[]; hole?: { s: Strip; i: number } }[] = []
    // Endpoints with no room for a label of their own are wired to the nearest label of the net
    // (a label takes any number of wires), so one crowded pin never costs the whole net its labels.
    const orphans: { node: Node; t: Terminal; at: Pt }[] = []
    for (const group of clusters.values()) {
      let found: (typeof plan)[number] | null = null
      const held = rowSpots.get(`${ni}|${group[0].members[0].ref}`)
      const first = held && pinOf(group[0])
      if (held && first) found = { spot: held, from: pointOf(pinEnd(first)), pins: [] }
      for (const node of found ? [] : group) {
        const t = pinOf(node)
        const at = t && resolveEndpoint(d, pinEnd(t))
        if (!t || !at) continue
        // A pin leads out along its stub; a pad inside a body (a breakout's header) out past each
        // edge of that body in turn, nearest first, so pads in an inner row take the far side.
        const exits = at.dir ? [{ dir: at.dir, base: at.end }] : edgeExits(bodyRect(partBy.get(t.ref)!, layoutModule(modOf(t.ref))), at.end)
        const spot = exits.reduce<LabelSpot | null>((got, e) => got ?? placer.spot(net.name, at.end, e.dir, { base: e.base, own: t.ref }), null)
        if (spot) {
          found = { spot, from: at.end, pins: [] }
          break
        }
      }
      if (!found) {
        for (const node of group) {
          const t = pinOf(node)
          if (!t) return fail()
          orphans.push({ node, t, at: pointOf(pinEnd(t)) })
        }
        continue
      }
      for (const node of group) {
        const t = pinOf(node)
        if (!t) return fail()
        found.pins.push({ node, t })
      }
      // A reserved row spot is kept off already; any other spot is held while the net is planned.
      if (!held) placer.commit(found.spot, found.from)
      plan.push(found)
    }
    if (dps.length) {
      let found: (typeof plan)[number] | null = null
      search: for (const s of dps) {
        const rect = bodyRect(partBy.get(s.board)!, layoutModule(modOf(s.board)))
        for (const i of clear(s))
          for (const exit of edgeExits(rect, s.holes[i])) {
            const spot = placer.spot(net.name, s.holes[i], exit.dir, { base: exit.base, own: s.board })
            if (spot) {
              found = { spot, from: s.holes[i], pins: [], hole: { s, i } }
              break search
            }
          }
      }
      if (found) plan.push(found)
    }
    if (plan.length < 2) return fail()
    const nearest = (at: Pt) => plan.reduce((a, b) => (dist(b.spot.tip, at) < dist(a.spot.tip, at) ? b : a))
    for (const o of orphans) nearest(o.at).pins.push({ node: o.node, t: o.t })
    if (dps.length && !plan.some((p) => p.hole)) {
      const target = nearest(dps[0].holes[0])
      const i = nearestHole(dps[0], target.spot.tip)
      if (i === null) return fail()
      target.hole = { s: dps[0], i }
    }
    if (orphans.length || (dps.length && !plan.some((p) => p.hole && p.from === p.hole.s.holes[p.hole.i]))) unlabelled.push(net.name)
    // Every endpoint has its spot: join the net's strips (if more than one), then the stubs.
    placer.rollback(before)
    const joined = dps.slice(0, 1)
    const rest = dps.slice(1)
    while (rest.length) {
      let pick: [Strip, Strip, number] | null = null
      for (const a of joined)
        for (const b of rest)
          for (const i of free(a)) for (const j of free(b)) if (!pick || dist(a.holes[i], b.holes[j]) < pick[2]) pick = [a, b, dist(a.holes[i], b.holes[j])]
      if (!pick || !jumper(ni, pick[0], pick[1])) {
        errors.push(`strip full: net ${net.name} cannot join ${rest.map(stripName).join(', ')}: no free hole left${under(rest)}`)
        return true
      }
      joined.push(pick[1])
      rest.splice(rest.indexOf(pick[1]), 1)
    }
    for (const p of plan) {
      const part = placer.commit(p.spot, p.from)
      labels.push(part)
      const to: Endpoint = { part: part.uid, pin: 'NET' }
      for (const { node, t } of p.pins) {
        node.left.set(t.name, node.left.get(t.name)! - 1)
        wire(ni, pinEnd(t), to, true, true)
      }
      if (p.hole) {
        // A hole the joining jumpers took is replaced by the strip's free hole nearest the label.
        const i = used.has(holeKey(p.hole.s.board, p.hole.s.name, p.hole.i)) ? nearestHole(p.hole.s, p.spot.tip) : p.hole.i
        if (i === null) {
          errors.push(`strip full: net ${net.name} has no free hole left on ${stripName(p.hole.s)}${under([p.hole.s])}`)
          return true
        }
        wire(ni, holeEnd(p.hole.s, i), to, true, true)
      }
    }
    labelledNets.push(net.name)
    return true
  }

  // Ruling W1: a hub breadboard is laid out so every wire into it can be traced. Its strips come in
  // rows (two half-strips on one line, the centre channel between them), and a wire from off the
  // board only ever takes the outer hole of a half-strip, entering from the board's edge on that
  // half's side: never one hole behind another wire's end, never across the channel. A net served
  // from both sides takes as many rows as its busier side has wires; its half-strips are joined
  // on the board by short jumpers (across the channel in a row, and from row to row on one side).
  // Nets take rows in the pin order of the part most of them reach (two displays on one bus share
  // their order, so both ribbons stay flat), a supply pin of that part keeping its place too for
  // the supply net's own rows, with an empty row between nets where the board has room.
  type HubRow = { halves: [Strip, Strip] }
  const hubRows: HubRow[] = []
  /** Which way a half-strip's holes run from its outer end (away from the other half) to its inner end. */
  const outward = (half: Strip, other: Strip) => {
    const o = other.holes.reduce((a, h) => ({ x: a.x + h.x / other.holes.length, y: a.y + h.y / other.holes.length }), { x: 0, y: 0 })
    return half.holes.map((h, i) => ({ i, d: dist(h, o) })).sort((a, b) => b.d - a.d).map((x) => x.i)
  }
  const hub = [...hubs][0]
  let rowsHorizontal = true
  let hubMid: Pt = { x: 0, y: 0 }
  if (hub) {
    const list = [...strips.values()].filter((st) => st.board === hub && !st.rail && st.holes.length > 1)
    rowsHorizontal = list.length > 0 && list[0].holes.every((h) => Math.abs(h.y - list[0].holes[0].y) < 0.5)
    const line = (st: Strip) => Math.round(rowsHorizontal ? st.holes[0].y : st.holes[0].x)
    const along = (st: Strip) => (rowsHorizontal ? st.holes[0].x : st.holes[0].y)
    const byLine = new Map<number, Strip[]>()
    for (const st of list) byLine.set(line(st), [...(byLine.get(line(st)) ?? []), st])
    for (const k of [...byLine.keys()].sort((a, b) => a - b)) {
      const pair = byLine.get(k)!.sort((a, b) => along(a) - along(b))
      if (pair.length === 2 && !pair.some((st) => owner.has(st.key) || reserved.has(st.key))) hubRows.push({ halves: [pair[0], pair[1]] })
    }
    const all = list.flatMap((st) => st.holes)
    hubMid = { x: all.reduce((a, h) => a + h.x, 0) / Math.max(1, all.length), y: all.reduce((a, h) => a + h.y, 0) / Math.max(1, all.length) }
  }
  /** 0 for the half on the low side (west, or north for upright rows), 1 for the other. */
  const sideOf = (p: Pt) => ((rowsHorizontal ? p.x : p.y) < (rowsHorizontal ? hubMid.x : hubMid.y) ? 0 : 1)
  /** Order along the rows' stacking axis. */
  const stackOf = (p: Pt) => (rowsHorizontal ? p.y : p.x)
  /** The nodes of a net served from the hub: every node of a hub net, or of a supply net those clearly nearer the hub than its own strips. */
  const nodesOfNet = (net: IntentNet) => {
    const byComp = new Map<string, Terminal[]>()
    for (const t of net.terminals) {
      if (t.infra || legBy.has(terminalKey(t.ref, t.name))) continue
      const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`
      byComp.set(c, [...(byComp.get(c) ?? []), t])
    }
    return [...byComp.keys()].sort(naturalCompare).map((c) => byComp.get(c)!)
  }
  const netStrips = (net: IntentNet) => {
    const keys = new Set<string>()
    for (const t of net.terminals) {
      if (t.infra) keys.add(groupKey(t.ref, t.name))
      const pl = legBy.get(terminalKey(t.ref, t.name))
      if (pl) keys.add(groupKey(pl.board, pl.group))
    }
    return [...keys].flatMap((k) => (strips.get(k) ? [strips.get(k)!] : []))
  }
  const hubbedNode = (at: Pt, own: Strip[]) => {
    const there = own.length ? Math.min(...own.flatMap((st) => st.holes.map((h) => dist(h, at)))) : Infinity
    return dist(at, hubMid) < there && there > FAR
  }
  /** The rows each planned net takes on the hub, and for a supply net whether it is fed by a trunk from its own strips. */
  const hubPlan = new Map<number, { rows: HubRow[]; trunk: boolean }>()
  if (hub && hubRows.length) {
    const needs: { ni: number; at: Pt; ends: Terminal[] }[] = []
    intent.nets.forEach((net, ni) => {
      if (net.label || kindOf(net) !== 'signal' || netStrips(net).length) return
      const caps = new Map<string, { cap: number; t: Terminal }>()
      for (const t of net.terminals) {
        const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`
        caps.set(c, { cap: (caps.get(c)?.cap ?? 0) + terminalCapacity(modOf(t.ref), t.name), t: caps.get(c)?.t ?? t })
      }
      const list = [...caps.values()]
      if (list.length < 3 || list.filter((x) => x.cap >= 2).length >= list.length - 2) return
      needs.push({ ni, at: pointOf(pinEnd((list.find((x) => modOf(x.t.ref).category === 'Microcontrollers') ?? list[0]).t)), ends: list.map((x) => x.t) })
    })
    const reach = new Map<string, number>()
    for (const n of needs) for (const t of new Set(n.ends.map((x) => x.ref))) reach.set(t, (reach.get(t) ?? 0) + 1)
    const lead = [...reach].sort((a, b) => b[1] - a[1] || Number(modOf(a[0]).category === 'Microcontrollers') - Number(modOf(b[0]).category === 'Microcontrollers') || naturalCompare(a[0], b[0]))[0]?.[0]
    const hubbedNets = new Set(needs.map((n) => n.ni))
    const plan: number[] = []
    if (lead) {
      const pins = intent.nets.flatMap((net, ni) => net.terminals.filter((t) => t.ref === lead && !t.infra).map((t) => ({ ni, at: pointOf(pinEnd(t)) })))
      for (const pin of pins.sort((a, b) => stackOf(a.at) - stackOf(b.at))) {
        const net = intent.nets[pin.ni]
        if (plan.includes(pin.ni)) continue
        if (hubbedNets.has(pin.ni) || (kindOf(net) !== 'signal' && !net.label && netStrips(net).length)) plan.push(pin.ni)
      }
    }
    for (const n of needs) if (!plan.includes(n.ni)) plan.push(n.ni)
    // Rows each net needs: as many as its busier side has wires (a supply net's trunk counts on the
    // side facing its own strips).
    const want = plan.map((ni) => {
      const net = intent.nets[ni]
      const supply = !hubbedNets.has(ni)
      const own = netStrips(net)
      const ends = nodesOfNet(net).map((m) => pointOf(pinEnd(m[0]))).filter((at) => !supply || hubbedNode(at, own))
      if (supply && ends.length < 2) return 0
      const count = [0, 0]
      for (const at of ends) count[sideOf(at)]++
      if (supply && own.length) count[sideOf(own[0].holes[0])]++
      return Math.max(1, ...count)
    })
    const total = want.reduce((a, b) => a + b, 0)
    const gap = total + plan.filter((_, i) => want[i]).length - 1 <= hubRows.length ? 1 : 0
    let at = 0
    plan.forEach((ni, i) => {
      if (!want[i] || at + want[i] > hubRows.length) return
      const rows = hubRows.slice(at, at + want[i])
      for (const r of rows) for (const h of r.halves) owner.set(h.key, ni)
      hubPlan.set(ni, { rows, trunk: !hubbedNets.has(ni) })
      at += want[i] + gap
    })
  }
  /**
   * Wires a planned hub net: each item (a node, or the trunk from the net's own strips) takes the
   * outer hole of a half-strip on its side, rows in stacking order; then the half-strips are joined.
   */
  const wireHub = (ni: number, items: ({ node: Node; at: Pt } | { trunk: Strip; at: Pt })[]) => {
    const { rows } = hubPlan.get(ni)!
    const bySide: (typeof items)[] = [[], []]
    for (const it of items) bySide[sideOf(it.at)].push(it)
    for (const side of [0, 1] as const) {
      bySide[side].sort((a, b) => stackOf(a.at) - stackOf(b.at))
      bySide[side].forEach((it, k) => {
        // The inner JUMPER_HOLES holes of each half-row are the joining jumpers' own: a wire from
        // off the board never takes one. Past its rows, an item takes the outermost free hole left
        // in any of them; with none, a free strip of the hub joined by a jumper.
        const outerFree = (row: HubRow) => {
          const half = row.halves[side]
          const order = outward(half, row.halves[1 - side]).slice(0, half.holes.length - JUMPER_HOLES)
          const i = order.find((j) => !used.has(holeKey(half.board, half.name, j)))
          return i === undefined ? null : { half, i }
        }
        let spot = k < rows.length ? outerFree(rows[k]) : null
        for (const row of rows) spot ??= outerFree(row)
        if (!spot) {
          const ext = [...strips.values()].find((st) => hubs.has(st.board) && !st.rail && !owner.has(st.key) && !reserved.has(st.key) && free(st).length === st.holes.length)
          if (ext) {
            owner.set(ext.key, ni)
            jumper(ni, rows[rows.length - 1].halves[side], ext)
            const i = free(ext)[0]
            spot = { half: ext, i }
          }
        }
        if (!spot) return void errors.push(`strip full: net ${intent.nets[ni].name} has no free hole left on its hub rows`)
        const { half, i } = spot
        if ('node' in it) {
          const e = take(it.node, half.holes[i])
          wire(ni, e, holeEnd(half, i), true)
        } else {
          const from = nearestHole(it.trunk, half.holes[i])
          if (from === null) return void errors.push(`strip full: net ${intent.nets[ni].name} has no free hole left on ${stripName(it.trunk)}`)
          wire(ni, holeEnd(it.trunk, from), holeEnd(half, i), true)
        }
      })
    }
    // Joins: across the channel in each row that has wires on the other side from the spine, and
    // from row to row on the spine side (holes alternating one and two in from the inner end, so
    // no two jumpers share a line).
    const spine: 0 | 1 = bySide[1].length > bySide[0].length ? 1 : 0
    // The jumpers' holes, innermost first; one already taken (by a jumper above) gives way to the next free one.
    const inner = (half: Strip, other: Strip, back = 0) => {
      const order = outward(half, other)
      const want = order[half.holes.length - 1 - back]
      if (!used.has(holeKey(half.board, half.name, want))) return want
      return [...order].reverse().find((j) => !used.has(holeKey(half.board, half.name, j))) ?? want
    }
    const pin = (half: Strip, i: number): Endpoint => holeEnd(half, i)
    rows.forEach((row, k) => {
      const far = row.halves[1 - spine]
      const nearHalf = row.halves[spine]
      const wired = (h: Strip) => connections.some((c) => [c.from, c.to].some((e) => e.part === h.board && e.pin === h.name))
      if (wired(far)) wire(ni, pin(nearHalf, inner(nearHalf, far)), pin(far, inner(far, nearHalf)), true)
      if (k + 1 < rows.length) {
        const next = rows[k + 1]
        const back = 1 + (k % 2)
        wire(ni, pin(nearHalf, inner(nearHalf, far, back)), pin(next.halves[spine], inner(next.halves[spine], next.halves[1 - spine], back)), true)
      }
    })
  }
  /**
   * The free strip nearest `at` that net `ni` may claim (its kind's rail first, by a little), never
   * on a hub (its rows are planned); claimed, or null when there is none.
   */
  const localClaim = (ni: number, at: Pt, kind: NetKind): Strip | null => {
    const rank = (st: Strip) => (kind === 'ground' ? (st.rail === '-' ? 0 : st.rail ? -1 : 1) : kind === 'power' ? (st.rail === '+' ? 0 : st.rail ? -1 : 1) : st.rail ? -1 : 0)
    let best: Strip | null = null
    let bestCost = Infinity
    for (const st of strips.values()) {
      if (rank(st) < 0 || localBoards.has(st.board) || hubs.has(st.board) || owner.has(st.key) || reserved.has(st.key) || free(st).length !== st.holes.length - (covered.get(st.key) ?? 0)) continue
      const cost = Math.min(...free(st).map((i) => dist(st.holes[i], at))) + 50 * rank(st)
      if (cost < bestCost) {
        best = st
        bestCost = cost
      }
    }
    if (best) owner.set(best.key, ni)
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
    if (labelNet(ni, net, kind, nodes, dps, groups.length > 0)) continue
    const plannedHub = hubPlan.get(ni)
    if (plannedHub && !plannedHub.trunk && !groups.length) {
      wireHub(ni, nodes.map((n) => ({ node: n, at: first(n) })))
      continue
    }
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
      errors.push(`strip full: net ${net.name} cannot join ${unjoined.map(stripName).join(', ')}: no free hole left${under(unjoined)}`)
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
        errors.push(`strip full: net ${net.name} has no free hole left on ${g.strips.map(stripName).join(', ')}${under(g.strips)}`)
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
    // Nearest pins first (Ruling W1): a pin right beside the net's strips takes a hole there before
    // a far one does, so the far ones are the ones that get a local strip of their own.
    const toStrips = (n: Node) => Math.min(...reach.flatMap((st) => st.holes.map((h) => dist(h, first(n)))))
    // A supply net with rows planned on the hub: the pins clearly nearer the hub than the net's own
    // strips take them, fed by one trunk from the nearest of those strips.
    let rest = own
    const hubbed = plannedHub?.trunk && dps.length ? own.filter((n) => hubbedNode(first(n), dps)) : []
    if (hubbed.length) rest = own.filter((n) => !hubbed.includes(n))
    const queue = rest.map((n) => ({ n, d: toStrips(n) })).sort((a, b) => a.d - b.d).map((x) => x.n)
    for (const [k, node] of queue.entries()) {
      const at = first(node)
      // Ruling W1: a pin far from every strip of its net, with a free strip much nearer, gets that
      // strip, joined to the net by one trunk jumper, so the parts there take short wires instead
      // of each running back across the sheet (displays beside a hub, batteries beside a rail).
      const near = nearestDp(reach, at)
      const far = near ? Math.min(...free(near).map((i) => dist(near.holes[i], at))) : Infinity
      if (near && far > FAR && rest.length - k >= 1) {
        const local = localClaim(ni, at, kind)
        // For a lone pin, only a rail or a strip on another board: a jumper across one board to a
        // nearer column saves nothing.
        if (local && rest.length - k < 2 && local.board === near.board && !local.rail) owner.delete(local.key)
        else if (local) {
          const there = Math.min(...local.holes.map((h) => dist(h, at)))
          if (there * 2 < far && jumper(ni, near, local)) reach.push(local)
          else owner.delete(local.key)
        }
      }
      while (totalFree() < rest.length - k) {
        const from = nearestDp(reach, at)
        const ext = from && (claim(ni, from.holes[0], kind, from.board) ?? claim(ni, at, kind))
        if (!from || !ext || !jumper(ni, from, ext)) break
        reach.push(ext)
      }
      let target = bestDp(reach, at)
      // Ruling W1: a wire must reach its hole by a clean straight run. When every free hole of the
      // net's strips can only be reached over other holes because another wire already ends in that
      // strip (its outer hole is taken), a free strip beside it is claimed and joined by one short
      // jumper instead.
      const was = target && holeChoice(target, at)
      const wiredAlready = (st: Strip) => connections.some((c) => [c.from, c.to].some((e) => e.part === st.board && e.pin === st.name))
      if (target && was && was.cost >= DIRTY && wiredAlready(target) && exitOf(target, was.i, at).ownUsed > 0) {
        const ext = claim(ni, target.holes[0], kind, target.board)
        const now = ext && holeChoice(ext, at)
        if (ext && now && now.cost < was.cost && jumper(ni, target, ext)) {
          reach.push(ext)
          target = ext
        } else if (ext) owner.delete(ext.key)
      }
      if (!target) {
        errors.push(`strip full: net ${net.name} has no free hole left on ${reach.map(stripName).join(', ')}${under(reach)}`)
        break
      }
      const e = take(node, at)
      wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))!), true)
    }
    // The supply pins served from the hub, last, so the trunk can leave from whichever of the net's
    // strips (rails included) has the cleanest way out toward the hub.
    if (hubbed.length) {
      const trunk = bestDp(reach, hubMid)
      if (trunk) wireHub(ni, [{ trunk, at: trunk.holes[0] }, ...hubbed.map((n) => ({ node: n, at: first(n) }))])
      else errors.push(`strip full: net ${net.name} has no free hole left on ${reach.map(stripName).join(', ')}${under(reach)}`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { connections, netOfWire, labels, labelled: labelledNets, unlabelled } }
}
