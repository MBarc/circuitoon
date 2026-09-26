// The wiring checker: mistakes a hobbyist would make on the real bench, found from the
// connectivity the netlist already computes (wires, breadboard strips, plugged legs, internal
// joins), each pin's `type` and `supply`, the voltage set on a part (a battery, a buck) and the
// pins a board powers from its USB connector (`electrical.external`). It never claims more than
// that data supports: a pin with no `type` is unknown and never triggers a rule. Pure, no React. Spec:
// docs/superpowers/specs/2026-09-26-wiring-checker-design.md.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf, resolveEndpoint } from './diagram.ts'
import { type MountIssue, mountIssues, plugsOf } from './breadboard.ts'
import { type ExternalPower, type HoleGroup, type ModuleDef, type PinDef, type PinType, externalPower, isSpacer } from './module.ts'
import { netlist, nodeKey } from './netlist.ts'
import { partValue, primaryParam } from './values.ts'

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
  /**
   * The rule plus the sorted terminals (or wires) that cause the problem: the same while the
   * problem stays the same, whatever order the wires were drawn in and whatever else joins the net.
   */
  id: string
  rule: RuleId
  severity: Severity
  /** One sentence in plain words, naming designators and pin labels. */
  message: string
  /** What the finding is about, for sorting: a designator, or a wire's name. */
  subject: string
  /** The pin, hole or wire it is about, for its Select button's name ("U1 VCC"). */
  target: string
  /** Everything to highlight: part uids, pins (and hole groups), wire uids. */
  parts: string[]
  pins: Endpoint[]
  wires: string[]
  /** What Select selects: the part a mount problem is about (not its board), the wire a hole or broken problem is about. */
  select: { parts: string[]; wires: string[] }
}

// ---- Voltages ----

/** Why a supply's voltage is not known: an `ADJ` rail (the user sets it) or a rail that does not parse. */
export type UnknownReason = 'adjustable' | 'unknown'

export interface ParsedSupply {
  /** Each rail that parses, in volts, in order. */
  volts: number[]
  /** Null when every rail parses; else why not: `adjustable` when any rail is `ADJ`. */
  unknown: UnknownReason | null
}

/**
 * The "/"-separated rails of a supply string: "3V3" is 3.3 V, "1V8" 1.8, "5V" 5, "3.7V" 3.7.
 * `ADJ` (set by the user) is adjustable; anything else that does not parse to a finite number,
 * a negative rail ("-5V") included, is unknown. One unknown rail makes the whole supply unknown.
 */
export function parseSupply(s: string): ParsedSupply {
  const volts: number[] = []
  let unknown: UnknownReason | null = null
  for (const rail of s.split('/')) {
    const plain = /^(\d+(?:\.\d+)?)V$/i.exec(rail)
    const split = /^(\d+)V(\d+)$/i.exec(rail)
    const v = plain ? Number(plain[1]) : split ? Number(`${split[1]}.${split[2]}`) : NaN
    if (Number.isFinite(v)) volts.push(v)
    else if (/^ADJ$/i.test(rail)) unknown = 'adjustable'
    else unknown ??= 'unknown'
  }
  return { volts, unknown }
}

/** An input's accepted rails, or null when any is unknown (then nothing is claimed about it). */
function knownRails(supply: string | undefined): number[] | null {
  if (!supply) return null
  const p = parseSupply(supply)
  return p.unknown ? null : p.volts
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

/** The connection named for the user when an end does not resolve (a missing part, pin, group or hole), else null. */
export function brokenConnection(d: Diagram, c: Connection): BrokenConnection | null {
  const ends = [c.from, c.to].filter((ep) => !resolveEndpoint(d, ep))
  return ends.length ? { uid: c.uid, name: wireName(d, c), missing: ends.map((ep) => endpointName(d, ep)) } : null
}

/** Every connection in `netlist(d).broken`, in file order, named for the user. */
export function brokenConnections(d: Diagram): BrokenConnection[] {
  return d.connections.map((c) => brokenConnection(d, c)).filter((b): b is BrokenConnection => b !== null)
}

const wireName = (d: Diagram, c: Connection) => c.label || `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`

// ---- Modules ----

/** What the checker reads off a module once: its pins and hole groups by name, and their electrical components. */
interface ModuleInfo {
  module: ModuleDef
  defs: Map<string, { pin?: PinDef; group?: HoleGroup }>
  /**
   * Each pin or hole group's electrical component inside the part: the transitive closure of the
   * `internal` groups, as the netlist joins them. Named by one member.
   */
  comp: Map<string, string>
  /** Power outputs whose component holds a power input (a charger's OUT+ is its B+): they pass a supply on, not make one. */
  pass: Set<string>
  /** Pins that carry a voltage while the part is on USB or a barrel jack (`electrical.external`). */
  external: Map<string, ExternalPower>
  /** The part's `ground` pins and hole groups: the reference its sources return to. */
  grounds: string[]
  /**
   * True when the part's `voltage` value (partValue, the same rule the Inspector shows) is the
   * voltage of every supply it makes: a battery's +, an adjustable buck's OUT+ (it replaces ADJ).
   */
  valued: boolean
}

const infoCache = new WeakMap<ModuleDef, ModuleInfo>()
function moduleInfo(m: ModuleDef): ModuleInfo {
  let info = infoCache.get(m)
  if (info) return info
  const defs = new Map<string, { pin?: PinDef; group?: HoleGroup }>()
  for (const p of m.pins) if (!isSpacer(p)) defs.set(p.name, { pin: p })
  for (const g of m.holes ?? []) defs.set(g.name, { group: g })
  const up = new Map<string, string>()
  const find = (n: string): string => {
    let r = n
    while (up.has(r) && up.get(r) !== r) r = up.get(r)!
    return r
  }
  for (const g of m.internal ?? []) for (let i = 1; i < g.length; i++) {
    const [a, b] = [find(g[0]), find(g[i])]
    if (a !== b) up.set(a, b)
  }
  const comp = new Map([...defs.keys()].map((n) => [n, find(n)]))
  const type = (n: string) => { const d = defs.get(n)!; return (d.pin ?? d.group)!.type }
  const fedComps = new Set([...defs.keys()].filter((n) => type(n) === 'power_in').map((n) => comp.get(n)))
  const pass = new Set([...defs.keys()].filter((n) => type(n) === 'power_out' && fedComps.has(comp.get(n))))
  const external = new Map(externalPower(m).filter((e) => defs.has(e.pin)).map((e) => [e.pin, e]))
  const grounds = [...defs.keys()].filter((n) => type(n) === 'ground')
  info = { module: m, defs, comp, pass, external, grounds, valued: primaryParam(m)?.name === 'voltage' }
  infoCache.set(m, info)
  return info
}

// ---- Terminals and sources ----

/** A node of the netlist that belongs to a part: a pin, or a hole group (a breadboard strip or a header pad). */
interface Terminal {
  key: string
  part: PartInstance
  info: ModuleInfo
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

/** A supply on a net: a power output, a battery terminal, or a pin carrying a board's USB power. */
interface Source {
  term: Terminal
  /** One per electrical component of one part: joined outputs are one supply, separate ones stay separate. */
  id: string
  v: number | null
  unknown: UnknownReason | null
  /** Set when the voltage comes from a connector the sheet does not draw (a board on USB). */
  external?: ExternalPower
  /** An output of a part that itself runs on external power (a dev board's 3V3 regulator). */
  onBoard: boolean
}

/** The supply `t` makes, if any. Pass-through outputs make none. */
function sourceOf(t: Terminal): Source | null {
  const id = JSON.stringify([t.part.uid, t.info.comp.get(t.name)])
  const external = t.info.external.get(t.name)
  if (external) return { term: t, id, v: external.volts, unknown: null, external, onBoard: false }
  if (t.type !== 'power_out' || t.info.pass.has(t.name)) return null
  const onBoard = t.info.external.size > 0
  // The value set on the sheet (a battery's voltage, a buck's output) wins over the module's supply.
  const value = t.info.valued ? partValue(t.part, t.info.module) : null
  if (value) return value.value > 0 ? { term: t, id, v: value.value, unknown: null, onBoard } : { term: t, id, v: null, unknown: 'unknown', onBoard }
  const p = t.supply ? parseSupply(t.supply) : { volts: [], unknown: 'unknown' as const }
  return p.unknown || !p.volts.length
    ? { term: t, id, v: null, unknown: p.unknown ?? 'unknown', onBoard }
    : { term: t, id, v: Math.max(...p.volts), unknown: null, onBoard }
}

/** How a source is named in a message: a pin on external power says so ("U1 VIN (USB)"). */
const sourceName = (s: Source) => (s.external ? `${termName(s.term)} (${s.external.via})` : termName(s.term))

/**
 * Something on a power input's net that may feed it: a supply (a power output or a pin on USB
 * power), a passive pin (a switch, a fuse, a jumper) or an untyped pin, which could pass power on
 * from elsewhere. Another part's power input feeds nothing, and a bare breadboard strip only conducts.
 */
const mayFeed = (t: Terminal) => !t.bare && (t.type === undefined || t.type === 'power_out' || t.type === 'passive' || t.info.external.has(t.name))
const supplies = (t: Terminal) => t.type === 'power_out' || t.info.external.has(t.name)

// ---- The checker ----

/** Natural order, so U2 sorts before U10. */
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

type Draft = Omit<Finding, 'id' | 'severity'> & { causes: string[] }

/** Every wiring problem on the sheet, errors first, then by subject (a designator, in natural order), then by rule. */
export function checkDiagram(d: Diagram): Finding[] {
  const partByUid = new Map(d.parts.map((p) => [p.uid, p]))
  const plugs = plugsOf(d)
  const nl = netlist(d, plugs)
  const brokenSet = new Set(nl.broken)
  const findings: Draft[] = []
  /**
   * One finding. `causes` are the terminal keys (or wire uids) that make it what it is; its id is
   * built from them alone, so it stays the same when wires are redrawn in another order or an
   * unrelated wire joins the net.
   */
  const add = (f: { rule: RuleId; subject: string; target: string; message: string; parts: string[]; pins: Endpoint[]; wires: string[]; select?: Finding['select']; causes: string[] }) => {
    const parts = [...new Set(f.parts)]
    findings.push({ ...f, parts, select: f.select ?? { parts, wires: f.wires } })
  }

  const terminal = (key: string): Terminal | null => {
    const [uid, name] = JSON.parse(key) as [string, string]
    const part = partByUid.get(uid)
    const m = part && moduleOf(d, part.module)
    if (!part || !m) return null
    const info = moduleInfo(m)
    const def = info.defs.get(name)
    if (!def) return null
    const src = def.pin ?? def.group!
    return { key, part, info, name, label: src.label ?? name, type: src.type, supply: src.supply, bare: !def.pin && !src.type }
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

  nl.nets.forEach((keys, i) => {
    const terms = netTerms[i]
    const wires = netWires[i]
    const onNet = new Set(keys)

    // Short: a supply whose own return (its part's ground) is on the same net. Two cells in series
    // (BT1 + to BT2 -) are fine; a cell's + on a board ground that is wired back to its - is not.
    const shorted = new Set<string>()
    for (const t of terms) {
      if (!supplies(t)) continue
      const id = JSON.stringify([t.part.uid, t.info.comp.get(t.name)])
      const own = t.info.grounds.find((g) => onNet.has(nodeKey(t.part.uid, g)))
      if (own === undefined || shorted.has(id)) continue
      shorted.add(id)
      const ownTerm = terms.find((o) => o.part === t.part && o.name === own)!
      const via = terms.find((o) => o.type === 'ground' && o.part !== t.part)
      const message = via
        ? `${termName(t)} is wired to ${termName(via)}, which leads back to ${termName(ownTerm)}: short circuit.`
        : `${termName(t)} is wired straight to ground (${termName(ownTerm)}): short circuit.`
      const involved = via ? [t, via, ownTerm] : [t, ownTerm]
      add({ rule: 'short', subject: t.part.designator, target: termName(t), message, parts: involved.map((x) => x.part.uid), pins: involved.map(termPin), wires, causes: [t.key, ownTerm.key] })
    }

    // Supplies: one per electrical component of a part. A pin on a board's USB power gives way
    // when a supply drawn on the sheet feeds the same net: the board then runs from that supply.
    const byId = new Map<string, Source>()
    for (const t of terms) {
      const s = sourceOf(t)
      if (!s) continue
      const prev = byId.get(s.id)
      if (!prev || (s.v !== null && (prev.v === null || s.v > prev.v))) byId.set(s.id, s)
    }
    let sources = [...byId.values()]
    if (sources.some((s) => s.external) && sources.some((s) => !s.external && !s.onBoard)) sources = sources.filter((s) => !s.external)
    const known = (list: Source[]) => list.filter((s): s is Source & { v: number } => s.v !== null).sort((a, b) => b.v - a.v)
    const all = known(sources)
    if (sources.length > 1) {
      const [hi, lo] = [all[0], all[all.length - 1]]
      const pins = sources.map((s) => termPin(s.term))
      const parts = sources.map((s) => s.term.part.uid)
      const causes = sources.map((s) => s.term.key)
      if (hi && lo && hi.v - lo.v > EPS) {
        const named = (s: Source & { v: number }) => `${termName(s.term)} (${volts(s.v)}${s.external ? ` from ${s.external.via}` : ''})`
        add({ rule: 'supplies-fight', subject: hi.term.part.designator, target: termName(hi.term),
          message: `${named(hi)} and ${named(lo)} are wired together: the two supplies fight.`, parts, pins, wires, causes })
      } else
        add({ rule: 'supplies-parallel', subject: sources[0].term.part.designator, target: termName(sources[0].term),
          message: `${andList(sources.map(sourceName))} are ${sources.length === 2 ? 'two' : sources.length} supplies tied together; power this net from one of them.`, parts, pins, wires, causes })
    }

    for (const t of terms) {
      if (t.type !== 'power_in') continue
      // A pin on its board's USB power that still acts as a supply here gives power, it does not take it.
      const self = sources.find((s) => s.term === t)
      if (self?.external) continue
      const accepts = knownRails(t.supply)
      if (!accepts) continue
      const feeding = sources.filter((s) => s !== self)
      const known = all.filter((s) => s !== self)
      const max = Math.max(...accepts)
      const min = Math.min(...accepts)
      const hi = known[0]
      const involve = (s: Source) => ({ parts: [t.part.uid, s.term.part.uid], pins: [termPin(t), termPin(s.term)], wires, causes: [t.key, s.term.key], target: termName(t), subject: t.part.designator })
      if (hi && hi.v > max + EPS) {
        add({ rule: 'supply-too-high', message: `${termName(t)} accepts up to ${volts(max)} but gets ${volts(hi.v)} from ${sourceName(hi)}.`, ...involve(hi) })
        continue
      }
      const adjustable = feeding.find((s) => s.unknown === 'adjustable')
      if (adjustable) {
        const list = [...new Set(accepts)].sort((a, b) => a - b).map(volts)
        add({ rule: 'supply-unknown', message: `${termName(adjustable.term)} is adjustable; set it to a voltage ${termName(t)} accepts (${orList(list)}).`, ...involve(adjustable) })
        continue
      }
      if (hi && feeding.every((s) => s.v !== null) && hi.v < min - EPS)
        add({ rule: 'supply-too-low', message: `${termName(t)} needs at least ${volts(min)}; ${sourceName(hi)} gives only ${volts(hi.v)}.`, ...involve(hi) })
    }

    const drivers = terms.filter((t) => t.type === 'output')
    if (drivers.length > 1)
      add({ rule: 'outputs-fight', subject: drivers[0].part.designator, target: termName(drivers[0]),
        message: `${andList(drivers.map(termName))} ${drivers.length === 2 ? 'both' : 'all'} drive this net: ${drivers.length === 2 ? 'two' : drivers.length} outputs fight.`,
        parts: drivers.map((t) => t.part.uid), pins: drivers.map(termPin), wires, causes: drivers.map((t) => t.key) })
  })

  // Per part: power and ground reach it from another part.
  const others = (t: Terminal) => {
    const i = nl.netOf.get(t.key)
    return i === undefined ? [] : netTerms[i].filter((o) => o.part !== t.part)
  }
  const isAre = (n: number) => (n === 1 ? 'is' : 'are')
  for (const p of d.parts) {
    if (!connected.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    const terms = [...moduleInfo(m).defs.keys()].map((n) => terminal(nodeKey(p.uid, n))).filter((t): t is Terminal => t !== null)
    const ins = terms.filter((t) => t.type === 'power_in')
    // A part with a pin on USB power is its own supply.
    if (ins.length && !moduleInfo(m).external.size) {
      const fed =
        ins.some((t) => others(t).some(mayFeed)) ||
        terms.some((t) => t.type === 'power_out' && others(t).some(supplies))
      if (!fed) {
        const wired = [...new Set(ins.filter((t) => others(t).length).map((t) => t.label))]
        const message = wired.length
          ? `${p.designator} has no power: ${andList(wired)} ${isAre(wired.length)} connected but nothing supplies ${wired.length === 1 ? 'it' : 'them'}.`
          : `${p.designator} has no power: connect ${orList([...new Set(ins.map((t) => t.label))])}.`
        add({ rule: 'no-power', subject: p.designator, target: p.designator, message, parts: [p.uid], pins: ins.map(termPin), wires: [], causes: ins.map((t) => t.key) })
      }
    }
    const grounds = terms.filter((t) => t.type === 'ground')
    if (grounds.length && !grounds.some((t) => others(t).some((o) => !o.bare))) {
      const wired = [...new Set(grounds.filter((t) => others(t).length).map((t) => t.label))]
      const labels = [...new Set(grounds.map((t) => t.label))]
      const what = labels.length > 3 ? `${labels[0]} or another of its ground pins` : orList(labels)
      const message = wired.length
        ? `${p.designator} has no ground: ${andList(wired)} ${isAre(wired.length)} connected but ${wired.length === 1 ? 'leads' : 'lead'} to no other part.`
        : `${p.designator} has no ground: connect ${what}.`
      add({ rule: 'no-ground', subject: p.designator, target: p.designator, message, parts: [p.uid], pins: grounds.map(termPin), wires: [], causes: grounds.map((t) => t.key) })
    }
  }

  for (const issue of mountIssues(d)) {
    const p = partByUid.get(issue.part)
    if (!p) continue
    const board = partByUid.get(issue.board)
    add({ rule: 'mount', subject: p.designator, target: p.designator, message: mountMessage(p, board, issue),
      parts: board ? [p.uid, board.uid] : [p.uid], pins: [], wires: [], select: { parts: [p.uid], wires: [] }, causes: [p.uid] })
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
      const hole = JSON.stringify([ep.part, ep.pin, ep.hole ?? 0])
      const pl = legIn.get(hole)
      const leg = pl && partByUid.get(pl.part)
      if (!pl || !leg) continue
      const legTerm = terminal(nodeKey(pl.part, pl.pin))
      const where = endpointName(d, { ...ep, hole: ep.hole ?? 0 })
      add({ rule: 'leg-hole-shared', subject: board.designator, target: where,
        message: `A wire ends in ${where}, where leg ${legTerm?.label ?? pl.pin} of ${leg.designator} sits: physically, one hole takes one leg. Move the wire to another hole of the strip.`,
        parts: [board.uid, leg.uid], pins: [{ part: pl.part, pin: pl.pin }], wires: [c.uid], select: { parts: [], wires: [c.uid] }, causes: [c.uid, hole] })
    }
  }

  for (const b of brokenConnections(d)) {
    const c = d.connections.find((w) => w.uid === b.uid)!
    const parts = [c.from.part, c.to.part].filter((u) => partByUid.has(u))
    add({ rule: 'broken', subject: b.name, target: b.name,
      message: `The wire ${b.name} is broken: ${andList(b.missing)} ${b.missing.length > 1 ? 'are' : 'is'} not on the sheet, so it connects nothing.`,
      parts, pins: [], wires: [b.uid], select: { parts: [], wires: [b.uid] }, causes: [b.uid] })
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
  return sorted.map(({ causes, ...f }) => {
    const base = `${f.rule}|${[...new Set(causes)].sort().join(',')}`
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
