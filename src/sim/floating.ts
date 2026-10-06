// DC-path classification (spec 2, revision 5, and 4.4; fix-round ruling on Task 12), before
// solving. Three node states:
// - driven: reached from a source's + terminal (or a fed rail output) along conducting elements in
//   their conducting direction: resistors, closed contacts and a GPIO's state resistor both ways,
//   diodes anode to cathode, rails in to out (and back only through a body diode), a rail only
//   when its input return is defined (a board whose ground is switched off regulates nothing). The
//   walk never enters a return (a cell's -, a rail or load return), so a load tied to ground never
//   lets ground "drive" the supply side.
// - defined: not driven, but reached from a source's - through resistors and contacts only (a
//   pull-down to ground is a real 0 V).
// - floating: neither. Never reported as a voltage.
// Capacitors (in `op`), loads, open contacts and input leakage never conduct here. A board whose domain is not
// driven is unpowered (R30 names the open switch that would power it). Islands keep the undirected
// grouping (dcFind), for numerics and reference naming only: each island holding a source is
// referenced to the return of its source with the largest imax, else the highest open-circuit
// voltage, ties by part uid; a USB host's return reads as the device's ground net past the cable. Pure.
import { naturalCompare } from '../agent/order.ts'
import { type Analysis, type Circuit, type Device, gpioBranch, netNode } from './model.ts'

export interface Island { reference: string; source: string; nodes: string[] }
export type NodeState = 'driven' | 'defined' | 'floating'
/**
 * `driven` and `defined` are node ids (net nodes, pin taps, internal nodes); `defined` includes
 * every driven node. `islandOf` covers every node of a source's undirected component, floating ones
 * included, so check the state before reading a voltage.
 */
export interface Classification { driven: Set<string>; defined: Set<string>; islands: Island[]; islandOf: Map<string, number> }

type Cell = Extract<Device, { kind: 'cell' }>
type Kind = Pick<Analysis, 'kind'>
const OP: Kind = { kind: 'op' }

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
    case 'switch':
      return [d.a, d.b]
    case 'gpio':
      return [d.node, d.vdd, d.ret]
  }
}

/** The resistive pairs, conducting both ways: resistors, closed contacts and a GPIO's state resistor (never its leakage). */
function resistive(d: Device): [string, string][] {
  if (d.kind === 'resistor' || (d.kind === 'switch' && d.closed)) return [[d.a, d.b]]
  const g = d.kind === 'gpio' ? gpioBranch(d) : null
  return g && !g.leak ? [[g.a, g.b]] : []
}
/** A capacitor is open in `op`; later analyses couple its plates. */
const capacitorPairs = (d: Device, a: Kind): [string, string][] => (d.kind === 'capacitor' && a.kind !== 'op' ? [[d.a, d.b]] : [])

/** The undirected terminal pairs that group nodes into islands (numerics and references only, not driven). */
export function dcEdges(d: Device, a: Kind = OP): [string, string][] {
  switch (d.kind) {
    case 'diode':
      return [[d.a, d.k]]
    case 'cell':
      return [[d.p, d.int], [d.int, d.n]]
    case 'rail':
      // Groups in, ctl, o and out; inRet and ret are returns and join nothing here.
      return [[d.in, d.ctl], [d.in, d.o], [d.o, d.out]]
    default:
      return [...resistive(d), ...capacitorPairs(d, a)]
  }
}

/** The directed arcs along which a device carries drive (the fix-round ruling on Task 12). */
export function driveArcs(d: Device, a: Kind = OP): [string, string][] {
  switch (d.kind) {
    case 'diode':
      return [[d.a, d.k]]
    case 'rail':
      return [[d.in, d.ctl], [d.in, d.o], [d.o, d.out], ...(d.rail.reverse === 'body-diode' ? ([[d.out, d.o], [d.o, d.in]] as [string, string][]) : [])]
    default:
      return [...resistive(d), ...capacitorPairs(d, a)].flatMap(([x, y]): [string, string][] => [[x, y], [y, x]])
  }
}

/** Union-find over the DC paths and the pin senses, with `extra` joins (a switch closed in thought). */
export function dcFind(c: Circuit, extra: [string, string][] = [], a: Kind = OP): (node: string) => string {
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
  for (const d of c.devices) for (const [x, y] of dcEdges(d, a)) join(x, y)
  for (const [x, y] of extra) join(x, y)
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
type Reach = { driven: Set<string>; defined: Set<string> }
/** `off`: devices left out (they carry no drive), as if removed from the sheet. */
function reach(c: Circuit, extra: [string, string][] = [], a: Kind = OP, off: Set<Device> = new Set()): Reach {
  const all = reachWith(c, extra, a, off)
  // Fix wave finding 1: a rail regulates only when its input return is defined. `defined` grows from
  // the sources' returns through resistance, which no rail carries, so one more pass settles it.
  // ponytail: one pass; a rail whose return is defined only through another dead rail's output would need a fixpoint loop.
  const dead = new Set([...off, ...c.devices.filter((d) => d.kind === 'rail' && !all.defined.has(d.inRet))])
  return dead.size > off.size ? reachWith(c, extra, a, dead) : all
}
function reachWith(c: Circuit, extra: [string, string][], a: Kind, dead: Set<Device>): Reach {
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
  for (const [x, y] of extra) both(x, y)
  for (const d of c.devices) {
    if (!dead.has(d)) for (const [x, y] of driveArcs(d, a)) arc(drive, x, y)
    for (const [x, y] of resistive(d)) arc(hold, x, y), arc(hold, y, x)
  }
  const cells = cellsOf(c)
  const seeds = cells.flatMap((d) => [d.p, d.int])
  const netOrSelf = (n: string) => netOf.get(n) ?? n
  const returns = new Set<string>()
  for (const d of c.devices) {
    if (d.kind === 'cell' || d.kind === 'load') returns.add(netOrSelf(d.n))
    else if (d.kind === 'rail') returns.add(netOrSelf(d.ret)).add(netOrSelf(d.inRet))
  }
  // A net holding a source's + is a supply, even when it is also another cell's - (a stack).
  for (const n of seeds) returns.delete(netOrSelf(n))
  // ponytail: a return net never carries drive, so a node fed only through a part's ground pin (a load wired upside down) reads defined, not driven; walk returns too if such sheets matter.
  const driven = walk(seeds, drive, (n) => returns.has(netOrSelf(n)))
  const held = walk(cells.map((d) => d.n), hold, (n) => driven.has(n))
  return { driven, defined: new Set([...driven, ...held]) }
}

/** A domain is powered when its pin node is driven and its return node is defined (both node ids). */
export function powered(_c: Circuit, cls: Classification, pin: string, ret: string): boolean {
  return cls.driven.has(pin) && cls.defined.has(ret)
}

/**
 * Whether a rail's input is powered by something other than the rail itself: its own body diode,
 * backfed from its output (a DevKit's 3V3 pin fed from a battery), does not count.
 */
export function inputPowered(c: Circuit, rail: Extract<Device, { kind: 'rail' }>): boolean {
  const r = reach(c, [], OP, new Set([rail]))
  return r.driven.has(rail.in) && r.defined.has(rail.inRet)
}

/**
 * Ruling R30: the part uid of the open latching switch whose closing alone would power `node`, or
 * null. When `node` is not driven, the switch that would drive it (high side, or a low-side switch
 * that would let its rail regulate); else, given `ret` that is not defined, the switch that would
 * define it (low side). A group's poles close together (a DPST breaking both sides).
 */
export function openSwitchFor(c: Circuit, node: string, ret?: string): string | null {
  const base = reach(c)
  const fixes = !base.driven.has(node)
    ? (r: Reach) => r.driven.has(node)
    : ret !== undefined && !base.defined.has(ret)
      ? (r: Reach) => r.defined.has(ret)
      : null
  if (!fixes) return null
  for (const o of c.openContacts) if (fixes(reach(c, o.pairs))) return o.part
  return null
}

/** `analysis` decides what conducts: a capacitor is open only in `op`. */
export function classify(c: Circuit, analysis: Kind = OP): Classification {
  const find = dcFind(c, [], analysis)
  const nodes = new Set<string>()
  for (const t of c.taps) nodes.add(netNode(t.net)).add(t.node)
  for (const d of c.devices) for (const n of deviceNodes(d)) nodes.add(n)
  const byRoot = new Map<string, Cell[]>()
  for (const cell of cellsOf(c)) {
    const r = find(cell.p)
    const list = byRoot.get(r)
    if (list) list.push(cell)
    else byRoot.set(r, [cell])
  }
  // A USB host's return is its cable end (H1_USB_GND); the island reads to the far end, the
  // device's own ground net, which is what a probe on the sheet names.
  const groundOf = (n: string) => {
    const net = c.taps.find((t) => t.node === n)?.net
    const cable = net === undefined ? undefined : c.devices.find((d) => d.kind === 'resistor' && d.role === 'cable' && d.id.endsWith('.gnd') && d.a === netNode(net))
    return cable?.kind === 'resistor' ? cable.b : n
  }
  const strongest = (list: Cell[]) =>
    [...list].sort((a, b) => (b.imax?.value ?? -1) - (a.imax?.value ?? -1) || b.volts.value - a.volts.value || naturalCompare(a.part, b.part) || (a.id < b.id ? -1 : 1))[0]
  const members = new Map<string, string[]>()
  for (const n of [...nodes].sort()) {
    const r = find(n)
    if (!byRoot.has(r)) continue
    const list = members.get(r)
    if (list) list.push(n)
    else members.set(r, [n])
  }
  const islands: Island[] = [...byRoot.entries()]
    .map(([root, list]) => ({ ref: strongest(list), nodes: members.get(root) ?? [] }))
    .sort((a, b) => naturalCompare(a.ref.part, b.ref.part) || (a.ref.id < b.ref.id ? -1 : 1))
    .map(({ ref, nodes: ns }) => ({ reference: groundOf(ref.n), source: ref.id, nodes: ns }))
  const islandOf = new Map<string, number>()
  islands.forEach((isl, i) => isl.nodes.forEach((n) => islandOf.set(n, i)))
  return { ...reach(c, [], analysis), islands, islandOf }
}

const memo = new WeakMap<Circuit, Map<Analysis['kind'], Classification>>()
export function classifyCached(c: Circuit, analysis: Kind = OP): Classification {
  let byKind = memo.get(c)
  if (!byKind) memo.set(c, (byKind = new Map()))
  let hit = byKind.get(analysis.kind)
  if (!hit) byKind.set(analysis.kind, (hit = classify(c, analysis)))
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
