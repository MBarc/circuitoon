// The wiring checker: mistakes a hobbyist would make on the real bench, found from the
// connectivity the netlist already computes (wires, breadboard strips, plugged legs, internal
// joins), each pin's `type` and `supply`, the voltage set on a part (a battery, a buck) and the
// pins a board powers from its USB connector (`electrical.external`). It never claims more than
// that data supports: a pin with no `type` is unknown and never triggers a rule. Pure, no React. Spec:
// docs/superpowers/specs/2026-09-26-wiring-checker-design.md.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf, resolveEndpoint } from './diagram.ts'
import { type MountIssue, mountIssues, plugsOf } from './breadboard.ts'
import { type ExternalPower, type HoleGroup, type ModuleDef, type PinDef, type PinType, commonReturn, declaredReturns, externalPower, isSpacer, voltageOutputs } from './module.ts'
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
  'supply-unknown': { severity: 'warning', title: 'Check the supply voltage' },
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
  /** The part's `ground` pins and hole groups, in module order. */
  grounds: string[]
  /**
   * The ground each supply pin returns to: `electrical.returns`, else the part's only ground
   * component (grounds in one commonReturn group count as one); null when that is ambiguous.
   */
  returnOf: Map<string, string | null>
  /** Pins and hole groups that may be supplies: power outputs and pins on USB power. */
  sourceNames: string[]
  /** Ground pins the module declares one return for checking (`electrical.commonReturn`). */
  commonReturn: string[][]
  /**
   * The outputs whose voltage is the part's `voltage` value (partValue, the same rule the
   * Inspector shows): `electrical.voltageOutputs`, or the only power_out (a battery's +, an
   * adjustable buck's OUT+, where it replaces ADJ). Other outputs keep their supply rail.
   */
  valued: Set<string>
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
  const sourceNames = [...defs.keys()].filter((n) => (type(n) === 'power_out' && !pass.has(n)) || external.has(n))
  // Ground components, with commonReturn groups merged: one of them is the only possible return.
  const joined = commonReturn(m).filter((g) => g.every((n) => defs.has(n)))
  const retComp = (g: string) => {
    const group = joined.find((j) => j.includes(g))
    return group ? comp.get(group[0])! : comp.get(g)!
  }
  const comps = new Set(grounds.map(retComp))
  const declared = declaredReturns(m)
  const only = comps.size === 1 ? grounds[0] : null
  const returnOf = new Map(sourceNames.map((n) => [n, declared[n] !== undefined && defs.has(declared[n]) ? declared[n] : only]))
  info = { module: m, defs, comp, pass, external, grounds, returnOf, sourceNames, commonReturn: joined, valued: new Set(primaryParam(m)?.name === 'voltage' ? voltageOutputs(m) : []) }
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
  /** True when the part has several ground components and does not say which one this returns to. */
  refUnknown?: boolean
}

/** The supply `t` makes, if any. Pass-through outputs make none. */
function sourceOf(t: Terminal): Source | null {
  const id = JSON.stringify([t.part.uid, t.info.comp.get(t.name)])
  const external = t.info.external.get(t.name)
  if (external) return { term: t, id, v: external.volts, unknown: null, external }
  if (t.type !== 'power_out' || t.info.pass.has(t.name)) return null
  // The value set on the sheet (a battery's voltage, a buck's output) wins over the module's supply.
  const value = t.info.valued.has(t.name) ? partValue(t.part, t.info.module) : null
  if (value) return value.value > 0 ? { term: t, id, v: value.value, unknown: null } : { term: t, id, v: null, unknown: 'unknown' }
  const p = t.supply ? parseSupply(t.supply) : { volts: [], unknown: 'unknown' as const }
  return p.unknown || !p.volts.length
    ? { term: t, id, v: null, unknown: p.unknown ?? 'unknown' }
    : { term: t, id, v: Math.max(...p.volts), unknown: null }
}

/** How a source is named in a message: a pin on external power says so ("U1 VIN (USB)"). */
const sourceName = (s: Source) => (s.external ? `${termName(s.term)} (${s.external.via})` : termName(s.term))

/** A resolved supply: a pin on USB power or a power output that is not a pass-through. */
const isSource = (t: Terminal) => sourceOf(t) !== null
/**
 * Something on a power input's net that may feed it: a resolved supply, a passive pin (a switch,
 * a fuse, a jumper) or an untyped pin, which could pass power on from elsewhere. A pass-through
 * output (a charger's OUT+, which is its B+) and another part's power input feed nothing, and a
 * bare breadboard strip only conducts.
 */
const mayFeed = (t: Terminal) => !t.bare && (t.type === undefined || t.type === 'passive' || isSource(t))
/** A pin that drives its net from its own part: shorted when that part's ground is on the same net. */
const drives = (t: Terminal) => t.type === 'power_out' || t.info.external.has(t.name)

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
  /** Supplies (by source id) already reported as wired to their own ground. */
  const shorted = new Set<string>()

  nl.nets.forEach((keys, i) => {
    const terms = netTerms[i]
    const wires = netWires[i]
    const onNet = new Set(keys)

    // Short: a supply whose own return (its part's ground) is on the same net. Two cells in series
    // (BT1 + to BT2 -) are fine; a cell's + on a board ground that is wired back to its - is not.
    for (const t of terms) {
      if (!drives(t)) continue
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

    const drivers = terms.filter((t) => t.type === 'output')
    if (drivers.length > 1)
      add({ rule: 'outputs-fight', subject: drivers[0].part.designator, target: termName(drivers[0]),
        message: `${andList(drivers.map(termName))} ${drivers.length === 2 ? 'both' : 'all'} drive this net: ${drivers.length === 2 ? 'two' : drivers.length} outputs fight.`,
        parts: drivers.map((t) => t.part.uid), pins: drivers.map(termPin), wires, causes: drivers.map((t) => t.key) })
  })

  checkPotentials({ d, nl, netTerms, netWires, terminal, shorted, add })

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
        terms.some((t) => t.type === 'power_out' && others(t).some(isSource))
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

// ---- Potentials ----

/**
 * One ideal source between two nets: `to` sits `v` volts above `from` (a supply's output over its
 * own return). A link (no `src`) is 0 V: ground pins a module declares one return
 * (`electrical.commonReturn`, a charger's B- and OUT- behind its protection switch).
 */
interface Edge {
  from: string
  to: string
  /** Null when the supply's voltage is not known: the edge adds an unknown (see Lin). */
  v: number | null
  src?: Source
}

/**
 * A potential: a known part `c` plus unknown supply voltages, each with its sign (`u`, by source
 * id). A voltage that keeps any unknown term cannot be stated.
 */
interface Lin {
  c: number
  u: Map<string, number>
}
const lin0 = (): Lin => ({ c: 0, u: new Map() })
/** `a` plus `sign` times edge `e`. */
function step(a: Lin, e: Edge, sign: 1 | -1): Lin {
  const u = new Map(a.u)
  if (e.v === null) {
    const k = (u.get(e.src!.id) ?? 0) + sign
    if (k) u.set(e.src!.id, k)
    else u.delete(e.src!.id)
    return { c: a.c, u }
  }
  return { c: a.c + sign * e.v, u }
}
/** `a` minus `b`. */
function minus(a: Lin, b: Lin): Lin {
  const u = new Map(a.u)
  for (const [id, k] of b.u) {
    const n = (u.get(id) ?? 0) - k
    if (n) u.set(id, n)
    else u.delete(id)
  }
  return { c: a.c - b.c, u }
}

interface PotentialInput {
  d: Diagram
  nl: ReturnType<typeof netlist>
  netTerms: Terminal[][]
  netWires: string[][]
  terminal: (key: string) => Terminal | null
  shorted: Set<string>
  add: (f: { rule: RuleId; subject: string; target: string; message: string; parts: string[]; pins: Endpoint[]; wires: string[]; causes: string[] }) => void
}

/**
 * Voltages that know their reference. Every resolved supply is an edge from its return net (its
 * part's ground) to its output net; walking the edges from any net of a connected group gives each
 * net a potential. A net reached at two different potentials is a contradiction: a loop of
 * supplies all pointing the same way (+ to the next -) is a shorted stack, any other loop is
 * supplies fighting; a loop that agrees is supplies in parallel. A load gets the potential of its
 * power input over that of its own ground, so a series stack adds up.
 */
function checkPotentials({ d, nl, netTerms, netWires, terminal, shorted, add }: PotentialInput) {
  const netOfKey = (key: string) => {
    const i = nl.netOf.get(key)
    return i === undefined ? key : `#${i}`
  }
  const wiresOf = (net: string) => (net.startsWith('#') ? netWires[Number(net.slice(1))] : [])

  // Every supply, one per electrical component of a part, and the edges.
  const sources = new Map<string, Source>()
  const edges: Edge[] = []
  const diodes: Edge[] = []
  const unknownOn = new Map<string, Source[]>()
  const outOn = new Map<string, Source[]>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!m) continue
    const info = moduleInfo(m)
    // Grounds the module declares one return are joined at 0 V (a charger's B- and OUT-).
    for (const g of info.commonReturn)
      for (const n of g.slice(1)) edges.push({ from: netOfKey(nodeKey(p.uid, g[0])), to: netOfKey(nodeKey(p.uid, n)), v: 0 })
    if (!info.sourceNames.length) continue
    const own = new Map<string, Source>()
    for (const n of info.sourceNames) {
      const t = terminal(nodeKey(p.uid, n))
      const s = t && sourceOf(t)
      if (!s) continue
      const prev = own.get(s.id)
      if (!prev || (s.v !== null && (prev.v === null || s.v > prev.v))) own.set(s.id, s)
    }
    for (const s of own.values()) {
      sources.set(s.id, s)
      const out = netOfKey(s.term.key)
      const list = s.v === null ? unknownOn : outOn
      list.set(out, [...(list.get(out) ?? []), s])
      // A supply wired to its own ground is reported as a short already; it places nothing.
      if (shorted.has(s.id)) continue
      const ret = info.returnOf.get(s.term.name)
      // A USB pin behind a diode only raises its net: placed after the first walk (see below).
      if (ret && s.external?.diode) diodes.push({ from: netOfKey(nodeKey(p.uid, ret)), to: out, v: s.v, src: s })
      else if (ret) edges.push({ from: netOfKey(nodeKey(p.uid, ret)), to: out, v: s.v, src: s })
      else if (info.grounds.length) {
        // Several grounds and no declared return: its voltage over any of them is unknown.
        s.refUnknown = true
        edges.push({ from: netOfKey(nodeKey(p.uid, info.grounds[0])), to: out, v: null, src: s })
      } else edges.push({ from: `(${s.id})`, to: out, v: s.v, src: s })
    }
  }

  // Walk each group once: potentials, the tree edge that reached each net, and the loops.
  const pot = new Map<string, Lin>()
  const up = new Map<string, number>()
  const depth = new Map<string, number>()
  const groupOf = new Map<string, string>()
  const loops: number[] = []
  const walk = () => {
    for (const m of [pot, up, depth, groupOf]) m.clear()
    loops.length = 0
    const adj = new Map<string, number[]>()
    edges.forEach((e, i) => {
      for (const n of [e.from, e.to]) (adj.get(n) ?? adj.set(n, []).get(n)!).push(i)
    })
    const seenEdge = new Set<number>()
    for (const root of adj.keys()) {
      if (pot.has(root)) continue
      pot.set(root, lin0())
      depth.set(root, 0)
      groupOf.set(root, root)
      const queue = [root]
      for (let q = 0; q < queue.length; q++) {
        const n = queue[q]
        for (const i of adj.get(n)!) {
          if (seenEdge.has(i)) continue
          seenEdge.add(i)
          const e = edges[i]
          const other = e.from === n ? e.to : e.from
          if (other === n) continue
          if (pot.has(other)) {
            loops.push(i)
            continue
          }
          pot.set(other, step(pot.get(n)!, e, e.from === n ? 1 : -1))
          up.set(other, i)
          depth.set(other, depth.get(n)! + 1)
          groupOf.set(other, root)
          queue.push(other)
        }
      }
    }
  }
  walk()

  /** The tree path from net `a` to net `b`: each edge with whether it is walked from its `from` to its `to`. */
  const path = (a: string, b: string): { e: Edge; forward: boolean }[] => {
    const fromA: { e: Edge; forward: boolean }[] = []
    const fromB: { e: Edge; forward: boolean }[] = []
    let [x, y] = [a, b]
    while (x !== y) {
      if (depth.get(x)! >= depth.get(y)!) {
        const e = edges[up.get(x)!]
        const next = e.from === x ? e.to : e.from
        fromA.push({ e, forward: e.from === x })
        x = next
      } else {
        const e = edges[up.get(y)!]
        const next = e.from === y ? e.to : e.from
        fromB.push({ e, forward: e.from === next })
        y = next
      }
    }
    return [...fromA, ...fromB.reverse()]
  }

  const sorted = (list: Source[]) => [...list].sort((a, b) => natural.compare(termName(a.term), termName(b.term)))
  const reason = (x: Source) => (x.refUnknown ? 'its return is not known' : x.unknown === 'adjustable' ? 'adjustable' : 'voltage not known')
  const involve = (list: Source[]) => ({
    parts: list.map((s) => s.term.part.uid),
    pins: list.map((s) => termPin(s.term)),
    wires: [...new Set(list.flatMap((s) => wiresOf(netOfKey(s.term.key))))],
    causes: list.map((s) => s.term.key),
  })
  /** One side of a loop: a single supply by its pin and voltage, several as a series stack. */
  const side = (list: Source[]) => {
    const v = list.reduce((sum, s) => sum + s.v!, 0)
    if (list.length === 1) {
      const s = list[0]
      return { v, text: `${termName(s.term)} (${volts(v)}${s.external ? ` from ${s.external.via}` : ''})` }
    }
    return { v, text: `${andList(sorted(list).map((s) => termName(s.term)))} (${volts(v)} in series)` }
  }

  /** Edges of a loop that disagrees: a voltage whose path uses one of them cannot be stated. */
  const broken = new Set<Edge>()
  for (const i of loops) {
    const e = edges[i]
    const around = [{ e, forward: true }, ...path(e.to, e.from)]
    const cycle = around.filter((x) => x.e.src)
    if (!cycle.length) continue
    // A loop through a supply of unknown voltage says nothing definite (the tie is reported below).
    const residual = minus(minus(pot.get(e.to)!, pot.get(e.from)!), step(lin0(), e, 1))
    if (residual.u.size) continue
    const mismatch = Math.abs(residual.c) > EPS
    const ahead = cycle.filter((x) => x.forward).map((x) => x.e.src!)
    const back = cycle.filter((x) => !x.forward).map((x) => x.e.src!)
    const all = sorted([...ahead, ...back])
    if (mismatch) for (const x of around) broken.add(x.e)
    if (mismatch && (!ahead.length || !back.length)) {
      add({ rule: 'short', subject: all[0].term.part.designator, target: termName(all[0].term),
        message: `${andList(all.map((s) => termName(s.term)))} are wired in a loop, each + to the next -: short circuit.`, ...involve(all) })
    } else if (mismatch) {
      const [a, b] = [side(ahead), side(back)]
      const [hi, lo] = a.v >= b.v ? [a, b] : [b, a]
      const lead = (a.v >= b.v ? sorted(ahead) : sorted(back))[0]
      const two = ahead.length === 1 && back.length === 1
      add({ rule: 'supplies-fight', subject: lead.term.part.designator, target: termName(lead.term),
        message: `${hi.text} and ${lo.text} are wired together: the ${two ? 'two ' : ''}supplies fight.`, ...involve(all) })
    } else if (ahead.length && back.length) {
      const ext = all.find((s) => s.external)
      const plain = all.filter((s) => !s.external)
      if (ext && plain.length) {
        const connector = ext.external!.via.replace(/ through .*$/, '')
        add({ rule: 'supplies-parallel', subject: ext.term.part.designator, target: termName(ext.term),
          message: `${termName(ext.term)} also gets ${volts(ext.v!)} from ${ext.external!.via}; do not power ${ext.term.label} and ${connector} at the same time.`, ...involve(all) })
      } else
        add({ rule: 'supplies-parallel', subject: all[0].term.part.designator, target: termName(all[0].term),
          message: `${andList(all.map(sourceName))} are ${all.length === 2 ? 'two' : all.length} supplies tied together; power this net from one of them.`, ...involve(all) })
    }
  }

  // USB pins behind a diode only raise their net. Where the rest of the sheet already sets the
  // net over the board's ground, the pin is a load: fine at or above its USB voltage (up to its
  // own limit); below it, USB pushes current into what holds the net down. Elsewhere it is a
  // supply like any other.
  const placed: Edge[] = []
  const joinedTo = new Map<string, string>()
  const top = (n: string): string => {
    let r = groupOf.get(n) ?? n
    while (joinedTo.has(r)) r = joinedTo.get(r)!
    return r
  }
  for (const e of diodes) {
    const s = e.src!
    const ext = s.external!
    const pin = s.term
    const [a, b] = [top(e.from), top(e.to)]
    if (a !== b) {
      placed.push(e)
      joinedTo.set(a, b)
      continue
    }
    const g = groupOf.get(e.from)
    if (g === undefined || g !== groupOf.get(e.to)) continue // tied only through another diode pin: both only raise it
    const way = path(e.from, e.to)
    if (way.some((x) => broken.has(x.e))) continue
    const diff = minus(pot.get(e.to)!, pot.get(e.from)!)
    const under = sorted(way.filter((x) => x.e.src).map((x) => x.e.src!))
    const what = under.length === 1 ? termName(under[0].term) : `${andList(under.map((x) => termName(x.term)))} in series`
    const base = { subject: pin.part.designator, target: termName(pin), ...involve([s, ...under]) }
    if (diff.u.size) {
      const open = [...diff.u.keys()].map((id) => sources.get(id)!)
      add({ rule: 'supply-unknown', message: `${termName(pin)} voltage depends on ${andList(sorted(open).map((x) => `${termName(x.term)} (${reason(x)})`))} and cannot be checked.`, ...base })
    } else if (diff.c < ext.volts - EPS)
      add({ rule: 'supplies-fight', ...base,
        message: `${termName(pin)} (${volts(ext.volts)} from ${ext.via}) is above ${what} (${volts(diff.c)}): ${ext.via} will push current into ${what} through the ${pin.label} diode.` })
    else {
      const rails = knownRails(pin.supply)
      const max = ext.max ?? (rails ? Math.max(...rails) : undefined)
      if (max !== undefined && diff.c > max + EPS)
        add({ rule: 'supply-too-high', ...base, message: `${termName(pin)} accepts up to ${volts(max)} but gets ${volts(diff.c)} from ${what}.` })
    }
  }
  if (placed.length) {
    edges.push(...placed)
    walk()
  }

  // A supply of unknown voltage tied to another supply cannot be placed: say they are tied.
  for (const [net, unknown] of unknownOn) {
    const list = sorted([...unknown, ...(outOn.get(net) ?? [])])
    if (list.length < 2) continue
    add({ rule: 'supplies-parallel', subject: list[0].term.part.designator, target: termName(list[0].term),
      message: `${andList(list.map(sourceName))} are ${list.length === 2 ? 'two' : list.length} supplies tied together; power this net from one of them.`, ...involve(list) })
  }

  // Loads: the voltage across each power input, from its net to its own part's ground.
  /** A part No ground already flags: none of its grounds reaches another part (a bare strip does not count). */
  const groundless = (p: PartInstance) => {
    const m = moduleOf(d, p.module)!
    const gs = moduleInfo(m).grounds
    return gs.length > 0 && !gs.some((g) => {
      const k = nodeKey(p.uid, g)
      const i = nl.netOf.get(k)
      return i !== undefined && netTerms[i].some((o) => o.part !== p && !o.bare)
    })
  }
  nl.nets.forEach((_, i) => {
    const net = `#${i}`
    for (const t of netTerms[i]) {
      if (t.type !== 'power_in' || t.info.external.has(t.name)) continue
      const accepts = knownRails(t.supply)
      if (!accepts) continue
      const direct = outOn.get(net) ?? []
      const unknown = unknownOn.get(net) ?? []
      let v: number | null = null
      let from: Source[] = []
      const group = groupOf.get(net)
      const groundPin = group === undefined ? undefined : t.info.grounds.find((g) => groupOf.get(netOfKey(nodeKey(t.part.uid, g))) === group)
      const ground = groundPin === undefined ? undefined : netOfKey(nodeKey(t.part.uid, groundPin))
      const base = (list: Source[]) => ({
        subject: t.part.designator, target: termName(t), wires: netWires[i],
        parts: [t.part.uid, ...list.map((s) => s.term.part.uid)], pins: [termPin(t), ...list.map((s) => termPin(s.term))], causes: [t.key, ...list.map((s) => s.term.key)],
      })
      if (ground !== undefined) {
        if (ground === net) continue
        const way = path(ground, net)
        // Only a path through a fight is in doubt; loads elsewhere on the same ground are still checked.
        if (way.some((x) => broken.has(x.e))) continue
        const diff = minus(pot.get(net)!, pot.get(ground)!)
        from = sorted(way.filter((x) => x.e.src).map((x) => x.e.src!))
        if (diff.u.size) {
          // Some supply on the way has no known voltage: advise a setting only when one adjustable
          // supply is the only unknown, counting what sits below it; otherwise say it cannot be checked.
          const ids = [...diff.u.keys()]
          const open = ids.map((id) => sources.get(id)!)
          const adj = open.length === 1 && open[0].unknown === 'adjustable' && !open[0].refUnknown && diff.u.get(ids[0]) === 1 ? open[0] : undefined
          const rails = [...new Set(accepts)].sort((a, b) => a - b)
          const settings = rails.map((r) => r - diff.c)
          const gname = termName(terminal(nodeKey(t.part.uid, groundPin!))!)
          if (adj && settings.every((x) => x > EPS)) {
            const message = Math.abs(diff.c) <= EPS
              ? `${termName(adj.term)} is adjustable; set it to a voltage ${termName(t)} accepts (${orList(rails.map(volts))}).`
              : `${termName(adj.term)} is adjustable; set it so ${termName(t)} sees ${orList(rails.map(volts))}: ${orList(settings.map(volts))} on ${termName(adj.term)}, since the other supplies between ${termName(t)} and ${gname} ${diff.c > 0 ? 'add' : 'take away'} ${volts(Math.abs(diff.c))}.`
            add({ rule: 'supply-unknown', message, ...base([adj]) })
          } else
            add({ rule: 'supply-unknown', message: `${termName(t)} voltage depends on ${andList(sorted(open).map((x) => `${termName(x.term)} (${reason(x)})`))} and cannot be checked.`, ...base(open) })
          continue
        }
        v = diff.c
        if (v <= EPS || !from.length) continue
      } else {
        // The load's ground does not reach the return of what feeds it: no voltage can be stated.
        // No ground already says so when the ground is not wired at all.
        const feeding = sorted([...direct, ...unknown])
        if (feeding.length && !groundless(t.part)) {
          const g = t.info.grounds.length ? termName(terminal(nodeKey(t.part.uid, t.info.grounds[0]))!) : `${t.part.designator} (no ground pin)`
          add({ rule: 'supply-unknown', message: `${termName(t)} voltage cannot be checked: ${g} does not connect back to the return of ${andList(feeding.map((x) => termName(x.term)))}.`, ...base(feeding) })
        }
        continue
      }
      const max = Math.max(...accepts)
      const min = Math.min(...accepts)
      const what = from.length === 1 ? sourceName(from[0]) : `${andList(from.map((s) => termName(s.term)))} in series`
      if (v !== null && v > max + EPS) {
        add({ rule: 'supply-too-high', message: `${termName(t)} accepts up to ${volts(max)} but gets ${volts(v)} from ${what}.`, ...base(from) })
        continue
      }
      if (v !== null && !unknown.length && v < min - EPS)
        add({ rule: 'supply-too-low', message: `${termName(t)} needs at least ${volts(min)}; ${what} ${from.length === 1 ? 'gives' : 'give'} only ${volts(v)}.`, ...base(from) })
    }
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
