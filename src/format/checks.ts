// The wiring checker: mistakes a hobbyist would make on the real bench, found from the
// connectivity the netlist already computes (wires, breadboard strips, plugged legs, internal
// joins) and each pin's `type` and `supply`. It never claims more than that data supports: a pin
// with no `type` is unknown and never triggers a rule. Pure, no React. Spec:
// docs/superpowers/specs/2026-09-26-wiring-checker-design.md.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf, resolveEndpoint } from './diagram.ts'
import { type MountIssue, mountIssues, plugsOf } from './breadboard.ts'
import { type HoleGroup, type ModuleDef, type PinDef, type PinType, isObj, isSpacer } from './module.ts'
import { netlist, nodeKey } from './netlist.ts'

export type Severity = 'error' | 'warning'
export type RuleId =
  | 'short'
  | 'supply-too-high'
  | 'supply-too-low'
  | 'supply-unknown'
  | 'supplies-fight'
  | 'supplies-parallel'
  | 'outputs-fight'
  | 'no-power'
  | 'no-ground'
  | 'mount'
  | 'leg-hole-shared'
  | 'broken'

/** Rule order within one severity and one subject, and each rule's short heading. */
export const RULES: Record<RuleId, { severity: Severity; title: string }> = {
  broken: { severity: 'error', title: 'Broken connection' },
  short: { severity: 'error', title: 'Short circuit' },
  'supplies-fight': { severity: 'error', title: 'Supplies fight' },
  'supply-too-high': { severity: 'error', title: 'Voltage too high' },
  'supply-too-low': { severity: 'warning', title: 'Voltage too low' },
  'supply-unknown': { severity: 'warning', title: 'Set the supply voltage' },
  'supplies-parallel': { severity: 'warning', title: 'Supplies tied together' },
  'outputs-fight': { severity: 'warning', title: 'Outputs fight' },
  'no-power': { severity: 'warning', title: 'No power' },
  'no-ground': { severity: 'warning', title: 'No ground' },
  mount: { severity: 'warning', title: 'Not plugged in' },
  'leg-hole-shared': { severity: 'warning', title: 'Two in one hole' },
}
const RULE_ORDER = Object.keys(RULES) as RuleId[]

export interface Finding {
  /** Stable while the problem stays the same: the rule plus what it involves. */
  id: string
  rule: RuleId
  severity: Severity
  /** One sentence in plain words, naming designators and pin labels. */
  message: string
  /** What the finding is about, for sorting and button names: a designator, or a wire's name. */
  subject: string
  /** Everything to highlight: part uids, pins (and hole groups), wire uids. */
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

// ---- Voltages ----

/**
 * Each "/"-separated rail of a supply string, in volts: "3V3" is 3.3, "1V8" 1.8, "5V" 5, "3.7V"
 * 3.7. `ADJ` (set by the user) and anything unparseable are null: unknown.
 */
export function parseSupply(s: string): (number | null)[] {
  return s.split('/').map((rail) => {
    const plain = /^(\d+(?:\.\d+)?)V$/i.exec(rail)
    if (plain) return Number(plain[1])
    const split = /^(\d+)V(\d+)$/i.exec(rail)
    return split ? Number(`${split[1]}.${split[2]}`) : null
  })
}

/** Known rails only when every rail is known; one unknown rail makes the whole range unknown. */
function knownRails(supply: string | undefined): number[] | null {
  if (!supply) return null
  const rails = parseSupply(supply)
  return rails.every((v): v is number => v !== null) ? rails : null
}

const EPS = 1e-9
const volts = (v: number) => `${Number(v.toFixed(2))} V`

/** "A", "A or B", "A, B or C". */
function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
/** "A", "A and B", "A, B and C". */
function andList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ---- Naming ----

/** A wire end as the user reads it: the part's designator (its uid when missing), the pin label or name, and the hole or bus offset. */
export function endpointName(d: Diagram, ep: Endpoint): string {
  const part = d.parts.find((p) => p.uid === ep.part)
  const m = part && moduleOf(d, part.module)
  const pin = m?.pins.find((p) => !isSpacer(p) && p.name === ep.pin)
  const label = pin && !isSpacer(pin) ? (pin.label ?? pin.name) : ep.pin
  const at = ep.hole !== undefined ? ` hole ${ep.hole}` : ep.offset !== undefined ? `[${ep.offset}]` : ''
  return `${part?.designator ?? ep.part} ${label}${at}`
}

export interface BrokenConnection {
  uid: string
  /** The wire's label, or its two ends ("R1 Anode to BB1 c2-top hole 9"). */
  name: string
  /** The ends that do not resolve, named the same way. */
  missing: string[]
}

/** Every connection in `netlist(d).broken` (an end names a missing part, pin, group or hole), in file order, named for the user. */
export function brokenConnections(d: Diagram): BrokenConnection[] {
  const out: BrokenConnection[] = []
  for (const c of d.connections) {
    const ends = [c.from, c.to].filter((ep) => !resolveEndpoint(d, ep))
    if (!ends.length) continue
    out.push({ uid: c.uid, name: wireName(d, c), missing: ends.map((ep) => endpointName(d, ep)) })
  }
  return out
}

const wireName = (d: Diagram, c: Connection) => c.label || `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`

// ---- Terminals ----

/** A node of the netlist that belongs to a part: a pin, or a hole group (a breadboard strip or a header pad). */
interface Terminal {
  part: PartInstance
  name: string
  /** Silkscreen label when the pin has one, else its name. */
  label: string
  type?: PinType
  supply?: string
  /** A hole group with no type: a breadboard strip or rail, which only conducts. */
  bare: boolean
}

const termName = (t: Terminal) => `${t.part.designator} ${t.label}`
const termPin = (t: Terminal): Endpoint => ({ part: t.part.uid, pin: t.name })

/** Per module: power outputs joined inside to a power input of the same part (a charger's OUT+ is its B+), which pass a supply on rather than make one. */
const passCache = new WeakMap<ModuleDef, Set<string>>()
function passThrough(m: ModuleDef): Set<string> {
  let set = passCache.get(m)
  if (!set) {
    set = new Set()
    const type = new Map(m.pins.filter((p): p is PinDef => !isSpacer(p)).map((p) => [p.name, p.type]))
    for (const g of m.internal ?? [])
      if (g.some((n) => type.get(n) === 'power_in')) for (const n of g) if (type.get(n) === 'power_out') set.add(n)
    passCache.set(m, set)
  }
  return set
}

/** A dev board takes its power over USB, which the sheet does not draw, so it is never called unpowered. */
const usbPowered = (m: ModuleDef) => isObj(m.electrical) && m.electrical.model === 'mcu'

/**
 * A pin or group of another part that may carry power to a power input: a supply, another power
 * input (a board's 5V pin carries its USB power), a passive pin (a switch, a fuse, a jumper), or a
 * pin with no type (unknown). A bare breadboard strip only conducts, so it never counts.
 */
const mayFeed = (t: Terminal) => !t.bare && (t.type === undefined || t.type === 'power_out' || t.type === 'power_in' || t.type === 'passive')

// ---- The checker ----

/** Natural order, so U2 sorts before U10. */
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Every wiring problem on the sheet, errors first, then by subject (a designator, in natural order), then by rule. */
export function checkDiagram(d: Diagram): Finding[] {
  const partByUid = new Map(d.parts.map((p) => [p.uid, p]))
  const plugs = plugsOf(d)
  const nl = netlist(d, plugs)
  const brokenSet = new Set(nl.broken)
  const findings: Omit<Finding, 'id' | 'severity'>[] = []
  const add = (rule: RuleId, subject: string, message: string, parts: string[], pins: Endpoint[], wires: string[]) =>
    void findings.push({ rule, subject, message, parts: [...new Set(parts)], pins, wires })

  // What each node key names, looked up once per module.
  const infoCache = new Map<string, Map<string, { pin?: PinDef; group?: HoleGroup }>>()
  const defsOf = (m: ModuleDef) => {
    let map = infoCache.get(m.id)
    if (!map) {
      map = new Map()
      for (const p of m.pins) if (!isSpacer(p)) map.set(p.name, { pin: p })
      for (const g of m.holes ?? []) map.set(g.name, { group: g })
      infoCache.set(m.id, map)
    }
    return map
  }
  const terminal = (key: string): Terminal | null => {
    const [uid, name] = JSON.parse(key) as [string, string]
    const part = partByUid.get(uid)
    const m = part && moduleOf(d, part.module)
    const def = m && defsOf(m).get(name)
    if (!part || !def) return null
    const src = def.pin ?? def.group!
    return { part, name, label: src.label ?? name, type: src.type, supply: src.supply, bare: !def.pin && !src.type }
  }

  // Wires per net, and which parts have a wire that conducts or a plugged leg.
  const netWires: string[][] = nl.nets.map(() => [])
  const connected = new Set<string>(plugs.map((pl) => pl.part))
  for (const c of d.connections) {
    if (brokenSet.has(c.uid)) continue
    connected.add(c.from.part)
    connected.add(c.to.part)
    const i = nl.netOf.get(nodeKey(c.from.part, c.from.pin))
    if (i !== undefined) netWires[i].push(c.uid)
  }

  const netTerms = nl.nets.map((keys) => keys.map(terminal).filter((t): t is Terminal => t !== null))

  nl.nets.forEach((_, i) => {
    const terms = netTerms[i]
    const wires = netWires[i]
    const outs = terms.filter((t) => t.type === 'power_out')
    const grounds = terms.filter((t) => t.type === 'ground')

    if (outs.length && grounds.length) {
      const [o, g] = [outs[0], grounds[0]]
      add('short', o.part.designator, `${termName(o)} is wired straight to ground (${termName(g)}): short circuit.`,
        [...outs, ...grounds].map((t) => t.part.uid), [...outs, ...grounds].map(termPin), wires)
    }

    // Supplies: one per part (joined outputs of one board are one supply), pass-throughs left out.
    const byPart = new Map<string, { term: Terminal; v: number | null }>()
    for (const t of outs) {
      const m = moduleOf(d, t.part.module)!
      if (passThrough(m).has(t.name)) continue
      const rails = knownRails(t.supply)
      const v = rails ? Math.max(...rails) : null
      const prev = byPart.get(t.part.uid)
      if (!prev || (v !== null && (prev.v === null || v > prev.v))) byPart.set(t.part.uid, { term: t, v })
    }
    const sources = [...byPart.values()]
    const known = sources.filter((s): s is { term: Terminal; v: number } => s.v !== null).sort((a, b) => b.v - a.v)
    if (sources.length > 1) {
      const hi = known[0]
      const lo = known[known.length - 1]
      const pins = sources.map((s) => termPin(s.term))
      const parts = sources.map((s) => s.term.part.uid)
      if (hi && lo && hi.v - lo.v > EPS)
        add('supplies-fight', hi.term.part.designator,
          `${termName(hi.term)} (${volts(hi.v)}) and ${termName(lo.term)} (${volts(lo.v)}) are wired together: the two supplies fight.`, parts, pins, wires)
      else
        add('supplies-parallel', sources[0].term.part.designator,
          `${andList(sources.map((s) => termName(s.term)))} are ${sources.length === 2 ? 'two' : sources.length} supplies tied together; power this net from one of them.`, parts, pins, wires)
    }

    for (const t of terms) {
      if (t.type !== 'power_in') continue
      const accepts = knownRails(t.supply)
      if (!accepts) continue
      const max = Math.max(...accepts)
      const min = Math.min(...accepts)
      const hi = known[0]
      const involve = (s: Terminal) => [[t.part.uid, s.part.uid], [termPin(t), termPin(s)]] as const
      if (hi && hi.v > max + EPS) {
        const [parts, pins] = involve(hi.term)
        add('supply-too-high', t.part.designator, `${termName(t)} accepts up to ${volts(max)} but gets ${volts(hi.v)} from ${termName(hi.term)}.`, [...parts], [...pins], wires)
        continue
      }
      const adjustable = sources.find((s) => s.v === null && /^ADJ$/i.test(s.term.supply ?? ''))
      if (adjustable) {
        const [parts, pins] = involve(adjustable.term)
        const list = [...new Set(accepts)].sort((a, b) => a - b).map(volts)
        add('supply-unknown', t.part.designator,
          `${termName(adjustable.term)} is adjustable; set it to a voltage ${termName(t)} accepts (${orList(list)}).`, [...parts], [...pins], wires)
        continue
      }
      if (hi && sources.every((s) => s.v !== null) && hi.v < min - EPS) {
        const [parts, pins] = involve(hi.term)
        add('supply-too-low', t.part.designator, `${termName(t)} needs at least ${volts(min)}; ${termName(hi.term)} gives only ${volts(hi.v)}.`, [...parts], [...pins], wires)
      }
    }

    const drivers = terms.filter((t) => t.type === 'output')
    if (drivers.length > 1)
      add('outputs-fight', drivers[0].part.designator,
        `${andList(drivers.map(termName))} ${drivers.length === 2 ? 'both' : 'all'} drive this net: ${drivers.length === 2 ? 'two' : drivers.length} outputs fight.`,
        drivers.map((t) => t.part.uid), drivers.map(termPin), wires)
  })

  // Per part: power and ground reach it from another part.
  const others = (t: Terminal, key: string) => {
    const i = nl.netOf.get(key)
    return i === undefined ? [] : netTerms[i].filter((o) => o.part !== t.part)
  }
  for (const p of d.parts) {
    if (!connected.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    const terms = [...defsOf(m).keys()].map((n) => terminal(nodeKey(p.uid, n))).filter((t): t is Terminal => t !== null)
    const ins = terms.filter((t) => t.type === 'power_in')
    if (ins.length && !usbPowered(m)) {
      const fed =
        ins.some((t) => others(t, nodeKey(p.uid, t.name)).some(mayFeed)) ||
        terms.some((t) => t.type === 'power_out' && others(t, nodeKey(p.uid, t.name)).some((o) => o.type === 'power_out'))
      if (!fed)
        add('no-power', p.designator, `${p.designator} has no power: connect ${orList([...new Set(ins.map((t) => t.label))])}.`, [p.uid], ins.map(termPin), [])
    }
    const grounds = terms.filter((t) => t.type === 'ground')
    if (grounds.length && !grounds.some((t) => others(t, nodeKey(p.uid, t.name)).some((o) => !o.bare))) {
      const labels = [...new Set(grounds.map((t) => t.label))]
      const what = labels.length > 3 ? `${labels[0]} or another of its ground pins` : orList(labels)
      add('no-ground', p.designator, `${p.designator} has no ground: connect ${what}.`, [p.uid], grounds.map(termPin), [])
    }
  }

  for (const issue of mountIssues(d)) {
    const p = partByUid.get(issue.part)
    if (!p) continue
    const board = partByUid.get(issue.board)
    add('mount', p.designator, mountMessage(p, board, issue), board ? [p.uid, board.uid] : [p.uid], [], [])
  }

  // A wire end in the very hole a plugged leg fills. A wire to the plugged pin itself also ends
  // in that hole on the sheet, by design (it shows the strip the jumper goes into), so only an end
  // that names the hole is flagged.
  const legIn = new Map(plugs.map((pl) => [JSON.stringify([pl.board, pl.group, pl.hole]), pl]))
  for (const c of d.connections) {
    if (brokenSet.has(c.uid)) continue
    for (const ep of [c.from, c.to]) {
      const board = partByUid.get(ep.part)
      const m = board && moduleOf(d, board.module)
      if (!board || !m?.holes?.some((g) => g.name === ep.pin)) continue
      const pl = legIn.get(JSON.stringify([ep.part, ep.pin, ep.hole ?? 0]))
      const leg = pl && partByUid.get(pl.part)
      if (!pl || !leg) continue
      const legTerm = terminal(nodeKey(pl.part, pl.pin))
      add('leg-hole-shared', board.designator,
        `A wire ends in ${endpointName(d, { ...ep, hole: ep.hole ?? 0 })}, where the ${leg.designator} ${legTerm?.label ?? pl.pin} leg already sits: physically, one hole takes one leg. Move the wire to another hole of the strip.`,
        [board.uid, leg.uid], [{ part: pl.part, pin: pl.pin }], [c.uid])
    }
  }

  for (const b of brokenConnections(d)) {
    const c = d.connections.find((w) => w.uid === b.uid)!
    const parts = [c.from.part, c.to.part].filter((u) => partByUid.has(u))
    add('broken', b.name,
      `The wire ${b.name} is broken: ${andList(b.missing)} ${b.missing.length > 1 ? 'are' : 'is'} not on the sheet, so it connects nothing.`, parts, [], [b.uid])
  }

  const rank = (s: Severity) => (s === 'error' ? 0 : 1)
  const sorted = findings
    .map((f) => ({ ...f, severity: RULES[f.rule].severity }))
    .sort((a, b) =>
      rank(a.severity) - rank(b.severity) ||
      natural.compare(a.subject, b.subject) ||
      RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
    )
  const seen = new Map<string, number>()
  return sorted.map((f) => {
    const base = [f.rule, f.parts.join(','), f.pins.map((p) => `${p.part}.${p.pin}`).join(','), f.wires.join(',')].join('|')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: n ? `${base}#${n}` : base, ...f }
  })
}

function mountMessage(p: PartInstance, board: PartInstance | undefined, issue: MountIssue): string {
  const at = board?.designator ?? issue.board
  switch (issue.reason) {
    case 'missing-board':
      return `${p.designator} is set to plug into a board that is not on the sheet (${at}), so its legs connect nothing.`
    case 'not-a-board':
      return `${p.designator} is set to plug into ${at}, which is not a breadboard, so its legs connect nothing.`
    case 'cannot-mount':
      return `${p.designator} cannot plug into a board (it is a board itself, has a bus pin or has no legs), so its legs connect nothing.`
    case 'partial':
      return `Not every leg of ${p.designator} sits in a hole of ${at}, so none of its legs connect. Move it until every leg sits in a hole.`
    case 'obscured':
      return `Some legs of ${p.designator} sit under another board drawn over ${at}, so none of its legs connect. Move it clear of that board.`
    case 'conflict':
      return `A leg of ${p.designator} needs a hole of ${at} that another part's leg already fills, so none of its legs connect. Move one of them.`
  }
}
