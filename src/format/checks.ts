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
  | 'reversed'
  | 'supply-too-high'
  | 'supply-too-low'
  | 'supply-unknown'
  | 'supplies-fight'
  | 'supplies-parallel'
  | 'outputs-fight'
  | 'no-common-ground'
  | 'no-power'
  | 'no-ground'
  | 'mount'
  | 'leg-hole-shared'
  | 'broken'

/** Rule order within one severity and one subject, and each rule's short heading. */
export const RULES: Record<RuleId, { severity: Severity; title: string }> = {
  broken: { severity: 'error', title: 'Broken connection' },
  short: { severity: 'error', title: 'Short circuit' },
  reversed: { severity: 'error', title: 'Power reversed' },
  'supplies-fight': { severity: 'error', title: 'Supplies fight' },
  'supply-too-high': { severity: 'error', title: 'Voltage too high' },
  'supply-too-low': { severity: 'warning', title: 'Voltage too low' },
  'supply-unknown': { severity: 'warning', title: 'Check the supply voltage' },
  'supplies-parallel': { severity: 'warning', title: 'Supplies tied together' },
  'outputs-fight': { severity: 'warning', title: 'Outputs fight' },
  'no-common-ground': { severity: 'warning', title: 'No common ground' },
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
/** An input is taken to work down to this share of its lowest listed rail (no real ranges yet). */
const LOW_TOLERANCE = 0.9
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
  /**
   * The ground pins that are a driving pin's own return (its returnOf ground and every ground in
   * the same component or commonReturn group); empty when the return is unknown or ambiguous.
   */
  returnGrounds: (pin: string) => string[]
  /** Pins and hole groups that may be supplies: power outputs and pins on USB power. */
  sourceNames: string[]
  /** Ground pins the module declares one return for checking (`electrical.commonReturn`). */
  commonReturn: string[][]
  /** A switch's two switched terminals (`electrical.model` "switch"): closed for voltage checks. */
  switchPins: [string, string] | null
  /**
   * The outputs whose voltage is the part's `voltage` value (partValue, the same rule the
   * Inspector shows): `electrical.voltageOutputs`, or the only power_out (a battery's +, an
   * adjustable buck's OUT+, where it replaces ADJ). Other outputs keep their supply rail.
   */
  valued: Set<string>
}

/** The switched terminals of a switch module (`electrical.terminals` a and b), when both exist. */
function switchPinsOf(m: ModuleDef, defs: Map<string, unknown>): [string, string] | null {
  const e = m.electrical as { model?: unknown; terminals?: { a?: unknown; b?: unknown } } | undefined
  if (!e || e.model !== 'switch' || !e.terminals) return null
  const { a, b } = e.terminals
  return typeof a === 'string' && typeof b === 'string' && defs.has(a) && defs.has(b) ? [a, b] : null
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
  const returnGrounds = (pin: string) => {
    const ret = returnOf.get(pin) ?? (declared[pin] !== undefined && defs.has(declared[pin]) ? declared[pin] : only)
    return ret ? grounds.filter((g) => retComp(g) === retComp(ret)) : []
  }
  info = { module: m, defs, comp, pass, external, grounds, returnOf, returnGrounds, sourceNames, commonReturn: joined, switchPins: switchPinsOf(m, defs), valued: new Set(primaryParam(m)?.name === 'voltage' ? voltageOutputs(m) : []) }
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

// ---- Wording ----

/** The wire that joins two terminals directly, if one does. */
function wireBetween(d: Diagram, a: Terminal, b: Terminal): Connection | undefined {
  const is = (ep: Endpoint, t: Terminal) => ep.part === t.part.uid && ep.pin === t.name
  return d.connections.find((c) => (is(c.from, a) && is(c.to, b)) || (is(c.from, b) && is(c.to, a)))
}
/** "Remove the wire from A to B." when one joins them directly, else the fallback. */
const removeWire = (d: Diagram, a: Terminal, b: Terminal, fallback: string) =>
  wireBetween(d, a, b) ? `Remove the wire from ${termName(a)} to ${termName(b)}.` : fallback
/**
 * The ground pin to name as a supply's return: its declared or only return, preferring the
 * ground joined to it that matches the output's name (OUT- for OUT+ on a buck whose IN- and
 * OUT- are one net).
 */
function returnPinName(t: Terminal): string | undefined {
  const ret = t.info.returnOf.get(t.name)
  if (!ret) return undefined
  const twin = t.name.replace(/\+$/, '-')
  const same = t.info.grounds.filter((g) => t.info.comp.get(g) === t.info.comp.get(ret))
  return same.includes(twin) ? twin : ret
}
/** True for a battery or cell (a voltage source module). */
const isCell = (t: Terminal) => (t.info.module.electrical as { model?: string } | undefined)?.model === 'voltage_source'
/** A supply named for advice: a battery by its designator, anything else by its pin. */
const supplyName = (t: Terminal) => (isCell(t) ? t.part.designator : termName(t))

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
  /** Supplies (by source id) already reported as wired to their own ground, and their parts. */
  const shorted = new Set<string>()
  const shortedParts = new Set<string>()

  nl.nets.forEach((keys, i) => {
    const terms = netTerms[i]
    const wires = netWires[i]
    const onNet = new Set(keys)

    // Short: a supply whose own return (its part's ground) is on the same net. Two cells in series
    // (BT1 + to BT2 -) are fine; a cell's + on a board ground that is wired back to its - is not.
    for (const t of terms) {
      if (!drives(t)) continue
      const id = JSON.stringify([t.part.uid, t.info.comp.get(t.name)])
      // Only the supply's own return counts: its declared ground, or the part's only ground
      // component. An unknown or ambiguous return cannot establish a short.
      const own = t.info.returnGrounds(t.name).find((g) => onNet.has(nodeKey(t.part.uid, g)))
      if (own === undefined || shorted.has(id)) continue
      shorted.add(id)
      shortedParts.add(t.part.uid)
      const ownTerm = terms.find((o) => o.part === t.part && o.name === own)!
      // Name the ground the supply is wired to directly, when it is.
      const grounds = terms.filter((o) => o.type === 'ground' && o.part !== t.part)
      const via = grounds.find((o) => wireBetween(d, t, o)) ?? grounds[0]
      const stakes = `Nothing limits the current, so ${t.part.designator} and the wires can overheat.`
      const message = via
        ? `${termName(t)} is wired to ${termName(via)}, which leads back to ${termName(ownTerm)}: short circuit. ${stakes} ${removeWire(d, t, via, 'Remove the wire that joins them.')}`
        : `${termName(t)} is wired straight to ground (${termName(ownTerm)}): short circuit. ${stakes} ${removeWire(d, t, ownTerm, 'Remove the wire that joins them.')}`
      const involved = via ? [t, via, ownTerm] : [t, ownTerm]
      add({ rule: 'short', subject: t.part.designator, target: termName(t), message, parts: involved.map((x) => x.part.uid), pins: involved.map(termPin), wires, causes: [t.key, ownTerm.key] })
    }

    const drivers = terms.filter((t) => t.type === 'output')
    if (drivers.length > 1)
      add({ rule: 'outputs-fight', subject: drivers[0].part.designator, target: termName(drivers[0]),
        message: `${andList(drivers.map(termName))} ${drivers.length === 2 ? 'both' : 'all'} drive this net: ${drivers.length === 2 ? 'two' : drivers.length} outputs fight. Keep one output on this net and move the ${drivers.length === 2 ? 'other' : 'others'} to an input.`,
        parts: drivers.map((t) => t.part.uid), pins: drivers.map(termPin), wires, causes: drivers.map((t) => t.key) })
  })

  const { reversed, returnGroup } = checkPotentials({ d, nl, netTerms, netWires, terminal, shorted, add })

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
    // Only the power and ground pins matter here (a breadboard's many strips are skipped).
    const terms = [...moduleInfo(m).defs.entries()]
      .filter(([, def]) => { const ty = (def.pin ?? def.group)!.type; return ty === 'power_in' || ty === 'power_out' || ty === 'ground' })
      .map(([n]) => terminal(nodeKey(p.uid, n))).filter((t): t is Terminal => t !== null)
    const ins = terms.filter((t) => t.type === 'power_in')
    // A part with a pin on USB power is its own supply.
    // A part with its power reversed is reported as such, not as unpowered.
    if (ins.length && !moduleInfo(m).external.size && !reversed.has(p.uid)) {
      const fed =
        ins.some((t) => others(t).some(mayFeed)) ||
        terms.some((t) => t.type === 'power_out' && others(t).some(isSource))
      if (!fed) {
        const wired = [...new Set(ins.filter((t) => others(t).length).map((t) => t.label))]
        const message = wired.length
          ? `${p.designator} has no power: ${andList(wired)} ${isAre(wired.length)} connected but nothing supplies ${wired.length === 1 ? 'it' : 'them'}. Connect ${wired.length === 1 ? 'it' : 'them'} to a supply (a 3V3 or 5V pin of a board, or a battery +).`
          : `${p.designator} has no power: connect ${orList([...new Set(ins.map((t) => t.label))])}.`
        add({ rule: 'no-power', subject: p.designator, target: p.designator, message, parts: [p.uid], pins: ins.map(termPin), wires: [], causes: ins.map((t) => t.key) })
      }
    }
    const grounds = terms.filter((t) => t.type === 'ground')
    // A part already reported as shorted gets no second finding about its ground.
    if (grounds.length && !shortedParts.has(p.uid) && !grounds.some((t) => others(t).some((o) => !o.bare))) {
      const wired = [...new Set(grounds.filter((t) => others(t).length).map((t) => t.label))]
      const ownOnly = [...new Set(grounds.filter((t) => {
        const i = nl.netOf.get(t.key)
        return !others(t).length && i !== undefined && netTerms[i].some((o) => o.part === t.part && o.name !== t.name && t.info.comp.get(o.name) !== t.info.comp.get(t.name))
      }).map((t) => t.label))]
      const labels = [...new Set(grounds.map((t) => t.label))]
      const what = labels.length > 3 ? `${labels[0]} or another of its ground pins` : orList(labels)
      const message = wired.length
        ? `${p.designator} has no ground: ${andList(wired)} ${isAre(wired.length)} connected but ${wired.length === 1 ? 'leads' : 'lead'} to no other part. Connect ${wired.length === 1 ? 'it' : 'them'} to the ground of the circuit.`
        : ownOnly.length
        ? `${p.designator} has no ground: ${andList(ownOnly)} ${isAre(ownOnly.length)} wired only to ${p.designator}'s own pins. Connect ${ownOnly.length === 1 ? 'it' : 'them'} to the ground of the circuit.`
        : `${p.designator} has no ground: connect ${what}.`
      add({ rule: 'no-ground', subject: p.designator, target: p.designator, message, parts: [p.uid], pins: grounds.map(termPin), wires: [], causes: grounds.map((t) => t.key) })
    }
  }

  // A signal between two parts that are each grounded, but not to each other: no reference.
  const groundedCache = new Map<string, Terminal[]>()
  const groundedPins = (p: PartInstance) => {
    let list = groundedCache.get(p.uid)
    if (!list) {
      const m = moduleOf(d, p.module)
      list = m ? moduleInfo(m).grounds.map((g) => terminal(nodeKey(p.uid, g))!).filter((t) => others(t).some((o) => !o.bare)) : []
      groundedCache.set(p.uid, list)
    }
    return list
  }
  const pairs = new Set<string>()
  nl.nets.forEach((_, i) => {
    // Signal pins: typed input, output or io, or an untyped board GPIO; at least one end typed.
    const typed = (t: Terminal) => t.type === 'input' || t.type === 'output' || t.type === 'io'
    const signals = netTerms[i].filter((t) => !t.bare && (typed(t) || t.type === undefined))
    for (const a of signals)
      for (const b of signals) {
        if (a.part.uid >= b.part.uid || (!typed(a) && !typed(b))) continue
        const key = JSON.stringify([a.part.uid, b.part.uid])
        if (pairs.has(key)) continue
        pairs.add(key)
        const [ga, gb] = [groundedPins(a.part), groundedPins(b.part)]
        if (!ga.length || !gb.length) continue
        const meet = new Set(ga.map((g) => returnGroup(g.key)))
        if (gb.some((g) => meet.has(returnGroup(g.key)))) continue
        add({ rule: 'no-common-ground', subject: a.part.designator, target: termName(a),
          message: `${termName(a)} is wired to ${termName(b)}, but ${a.part.designator} and ${b.part.designator} share no ground, so the signal has no reference. Connect ${termName(ga[0])} to ${termName(gb[0])}.`,
          parts: [a.part.uid, b.part.uid], pins: [termPin(a), termPin(b), termPin(ga[0]), termPin(gb[0])], wires: netWires[i], causes: [a.key, b.key] })
      }
  })

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
      message: `The wire ${b.name} is broken: ${andList(b.missing)} ${b.missing.length > 1 ? 'are' : 'is'} not on the sheet, so it connects nothing. Delete it, and draw it again if you still need it.`,
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
  /** A switch taken as closed: it carries voltage to loads, but a loop through it is no short (it may be open). */
  closedSwitch?: boolean
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
function checkPotentials({ d, nl, netTerms, netWires, terminal, shorted, add }: PotentialInput): { reversed: Set<string>; returnGroup: (key: string) => string } {
  const reversed = new Set<string>()
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
    // A switch is taken as closed for voltages: damage happens in the ON position.
    if (info.switchPins) {
      const [a, b] = info.switchPins
      edges.push({ from: netOfKey(nodeKey(p.uid, a)), to: netOfKey(nodeKey(p.uid, b)), v: 0, closedSwitch: true })
    }
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
  /** What to do about supplies of unknown voltage or return: give them one. */
  const fixUnknown = (open: Source[]) => {
    const ret = open.filter((x) => x.refUnknown)
    const volt = open.filter((x) => !x.refUnknown)
    const parts: string[] = []
    if (volt.length) parts.push(`Give ${andList(volt.map((x) => termName(x.term)))} a voltage (set its value, or a supply in its module) to check it.`)
    if (ret.length) parts.push(`Say in the module of ${andList([...new Set(ret.map((x) => x.term.part.designator))])} which ground ${andList(ret.map((x) => x.term.label))} returns to (electrical.returns) to check it.`)
    return parts.join(' ')
  }
  const reason = (x: Source) => (x.refUnknown ? 'its return is not known' : x.unknown === 'adjustable' ? 'adjustable' : 'voltage not known')
  const involve = (list: Source[]) => ({
    parts: list.map((s) => s.term.part.uid),
    pins: list.map((s) => termPin(s.term)),
    wires: [...new Set(list.flatMap((s) => wiresOf(netOfKey(s.term.key))))],
    causes: list.map((s) => s.term.key),
  })
  /**
   * The pin to name for a supply: when the supply is wired to the input of another part that
   * passes it on (a cell on a charger's B+), that part's output (its OUT+); else its own pin.
   */
  let wiresAt: Map<string, Set<string>> | undefined
  const shownPin = (s: Source) => {
    const k = netOfKey(s.term.key)
    if (!k.startsWith('#')) return s.term
    if (!wiresAt) {
      wiresAt = new Map()
      for (const c of d.connections)
        for (const [a, b] of [[c.from, c.to], [c.to, c.from]]) {
          const ka = nodeKey(a.part, a.pin)
          wiresAt.set(ka, (wiresAt.get(ka) ?? new Set()).add(nodeKey(b.part, b.pin)))
        }
    }
    const wiredTo = wiresAt.get(s.term.key) ?? new Set<string>()
    const through = netTerms[Number(k.slice(1))].find((o) => o.part !== s.term.part && o.type === 'power_out' && o.info.pass.has(o.name) &&
      [...o.info.defs.entries()].some(([n, def]) => (def.pin ?? def.group)!.type === 'power_in' && o.info.comp.get(n) === o.info.comp.get(o.name) && wiredTo.has(nodeKey(o.part.uid, n))))
    return through ?? s.term
  }
  /** One side of a loop: a single supply by its pin and voltage, several as a series stack. */
  const side = (list: Source[]) => {
    const v = list.reduce((sum, s) => sum + s.v!, 0)
    if (list.length === 1) {
      const s = list[0]
      // Name the pin actually on the net: a charger's OUT+ passing a cell on, with the cell behind it.
      const shown = shownPin(s)
      const from = s.external ? ` from ${s.external.via}` : shown !== s.term ? ` from ${s.term.part.designator}` : ''
      return { v, text: `${termName(shown)} (${volts(v)}${from})` }
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
    // Through a switch the loop exists only while it is closed: say nothing (it may well be open).
    if (around.some((x) => x.e.closedSwitch)) continue
    if (mismatch && (!ahead.length || !back.length)) {
      add({ rule: 'short', subject: all[0].term.part.designator, target: termName(all[0].term),
        message: `${andList(all.map((s) => termName(s.term)))} are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. Remove one of the wires that close the loop.`, ...involve(all) })
    } else if (mismatch) {
      const [a, b] = [side(ahead), side(back)]
      const [hi, lo] = a.v >= b.v ? [a, b] : [b, a]
      const lead = (a.v >= b.v ? sorted(ahead) : sorted(back))[0]
      const two = ahead.length === 1 && back.length === 1
      const fix = two ? removeWire(d, shownPin(ahead[0]), shownPin(back[0]), 'Separate them.') : 'Separate them.'
      add({ rule: 'supplies-fight', subject: lead.term.part.designator, target: termName(lead.term),
        message: `${hi.text} and ${lo.text} are wired together: the ${two ? 'two ' : ''}supplies fight, and the higher one drives current into the lower one, which can damage both. ${fix}`, ...involve(all) })
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

  /** A supply whose voltage is a setting on the part (a buck's output), not a battery's voltage. */
  const settable = (x: Source) => !x.external && x.term.info.valued.has(x.term.name) && !isCell(x.term)
  /** How to bring a supply to `target` volts: set it when it is a value on the part, else move the wire or change the supply. */
  const fixTo = (from: Source[], target: number) => {
    const one = from.length === 1 ? from[0] : undefined
    if (one && settable(one)) return `Set ${one.term.part.designator} to ${volts(target)} or move the wire to a ${volts(target)} pin.`
    if (one && (one.external || one.term.info.external.size)) return `Move the wire to a ${volts(target)} pin.`
    return `Use a ${volts(target)} supply instead.`
  }
  /** Too high: where the voltage comes from ("is set to" for a value on the part) and the fix. */
  const tooHigh = (t: Terminal, max: number, v: number, from: Source[], what: string) => {
    const one = from.length === 1 ? from[0] : undefined
    const gets = one && settable(one)
      ? `but ${termName(one.term)} is set to ${volts(v)}`
      : `but gets ${volts(v)} from ${what}`
    return `${termName(t)} accepts up to ${volts(max)} ${gets}. ${fixTo(from, max)}`
  }
  /** A diode-fed USB pin above what holds its net down: what happens and what to do. */
  const backFeed = (pin: Terminal, ext: ExternalPower, under: Source[], what: string, v: number) => {
    const low = under.length === 1 ? under[0].term : undefined
    const name = low ? supplyName(low) : what
    const harm = low && isCell(low) ? 'the cells' : under.length > 1 ? 'them' : 'it'
    const fix = low && isCell(low)
      ? `Add a diode from ${termName(low)} to ${pin.label}, or unplug ${low.part.designator} before plugging in ${ext.via}.`
      : low ? removeWire(d, pin, low, `Do not wire ${termName(low)} to ${termName(pin)}.`) : `Do not wire ${what} to ${termName(pin)}.`
    return `When ${ext.via} is plugged in, ${termName(pin)} gets ${volts(ext.volts)} from ${ext.via}, which pushes current back into ${name} (${volts(v)}) and can damage ${harm}. ${fix}`
  }

  // USB pins behind a diode only raise their net. Resolved in two steps, independent of the order
  // of parts and wires:
  // 1. Groups of the walk so far move as rigid bodies. A diode pin whose net and board ground are
  //    in different groups lifts its net's group to at least its own voltage; every such group
  //    settles at the highest lift (a fixed point over all diode pins, so one diode-fed group can
  //    lift another). The diode that sets a group's level (ties broken by pin key) conducts and
  //    joins the two groups; the others are off.
  // 2. After walking again, every diode pin that does not conduct is a load: fine at or above its
  //    USB voltage up to its own limit, and below it (possible only when the rest of the sheet
  //    holds its net over the same ground) USB pushes current into what holds the net down.
  const level = (e: Edge) => {
    const [a, b] = [pot.get(e.from), pot.get(e.to)]
    return a && b && !a.u.size && !b.u.size ? a.c + e.v! - b.c : null
  }
  const cross = [...diodes].sort((x, y) => (x.src!.term.key < y.src!.term.key ? -1 : 1))
    .filter((e) => (groupOf.get(e.from) ?? e.from) !== (groupOf.get(e.to) ?? e.to))
  const gOf = (n: string) => groupOf.get(n) ?? n
  const lifted = new Set(cross.map((e) => gOf(e.to)))
  const off = new Map<string, number>()
  const offOf = (g: string) => off.get(g) ?? (lifted.has(g) ? -Infinity : 0)
  for (let round = 0; round <= cross.length; round++) {
    let moved = false
    for (const e of cross) {
      const w = level(e) ?? 0
      const from = offOf(gOf(e.from))
      if (from === -Infinity) continue
      if (from + w > offOf(gOf(e.to)) + EPS) {
        off.set(gOf(e.to), from + w)
        moved = true
      }
    }
    if (!moved) break
  }
  const conducting = new Set<Edge>()
  for (const g of lifted) {
    const want = offOf(g)
    const setter = cross.find((e) => gOf(e.to) === g && offOf(gOf(e.from)) !== -Infinity && Math.abs(offOf(gOf(e.from)) + (level(e) ?? 0) - want) <= EPS)
      ?? cross.find((e) => gOf(e.to) === g)
    if (setter) conducting.add(setter)
  }
  if (conducting.size) {
    edges.push(...conducting)
    walk()
  }
  for (const e of diodes) {
    if (conducting.has(e)) continue
    const s = e.src!
    const ext = s.external!
    const pin = s.term
    const g = groupOf.get(e.from)
    if (g === undefined || g !== groupOf.get(e.to)) continue
    const way = path(e.from, e.to)
    if (way.some((x) => broken.has(x.e))) continue
    const diff = minus(pot.get(e.to)!, pot.get(e.from)!)
    const under = sorted(way.filter((x) => x.e.src).map((x) => x.e.src!))
    const what = under.length === 1 ? termName(under[0].term) : `${andList(under.map((x) => termName(x.term)))} in series`
    const base = { subject: pin.part.designator, target: termName(pin), ...involve([s, ...under]) }
    if (diff.u.size) {
      const open = [...diff.u.keys()].map((id) => sources.get(id)!)
      add({ rule: 'supply-unknown', message: `${termName(pin)} voltage depends on ${andList(sorted(open).map((x) => `${termName(x.term)} (${reason(x)})`))} and cannot be checked. ${fixUnknown(open)}`, ...base })
    } else if (diff.c < ext.volts - EPS)
      add({ rule: 'supplies-fight', ...base, message: backFeed(pin, ext, under, what, diff.c) })
    else {
      const rails = knownRails(pin.supply)
      const max = ext.max ?? (rails ? Math.max(...rails) : undefined)
      if (max !== undefined && diff.c > max + EPS)
        add({ rule: 'supply-too-high', ...base, message: tooHigh(pin, max, diff.c, under, what) })
    }
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
  const checkedInputs = new Set<string>()
  nl.nets.forEach((_, i) => {
    const net = `#${i}`
    for (const t of netTerms[i]) {
      if (t.type !== 'power_in' || t.info.external.has(t.name)) continue
      // Power pins joined inside the part (a strip's 5V and 5V 2) are one input: checked once.
      const inputId = JSON.stringify([t.part.uid, t.info.comp.get(t.name)])
      if (checkedInputs.has(inputId)) continue
      checkedInputs.add(inputId)
      const accepts = knownRails(t.supply)
      if (!accepts) continue
      const direct = outOn.get(net) ?? []
      const unknown = unknownOn.get(net) ?? []
      let v: number | null = null
      let from: Source[] = []
      const group = groupOf.get(net)
      // Its ground in the same group, preferring one wired to another part (a charger's B- over its IN-).
      const inGroup = group === undefined ? [] : t.info.grounds.filter((g) => groupOf.get(netOfKey(nodeKey(t.part.uid, g))) === group)
      const wiredOut = (g: string) => {
        const k = netOfKey(nodeKey(t.part.uid, g))
        return k.startsWith('#') && netTerms[Number(k.slice(1))].some((o) => o.part !== t.part && !o.bare)
      }
      const groundPin = inGroup.find(wiredOut) ?? inGroup[0]
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
            add({ rule: 'supply-unknown', message: `${termName(t)} voltage depends on ${andList(sorted(open).map((x) => `${termName(x.term)} (${reason(x)})`))} and cannot be checked. ${fixUnknown(open)}`, ...base(open) })
          continue
        }
        v = diff.c
        if (!from.length) continue
        if (v < -EPS) {
          // The input sits below its own ground: the supply is wired the wrong way round.
          const on = (k: string, prefer: (o: Terminal) => boolean) => {
            if (!k.startsWith('#')) return undefined
            const others = netTerms[Number(k.slice(1))].filter((o) => o.part !== t.part && !o.bare)
            return others.find(prefer) ?? others[0]
          }
          const g = terminal(nodeKey(t.part.uid, groundPin!))!
          const x = on(net, (o) => o.type === 'ground')
          const y = on(ground, (o) => o.type === 'power_out' || o.info.external.has(o.name))
          const cell = from.length === 1 && (from[0].term.info.module.electrical as { model?: string } | undefined)?.model === 'voltage_source' ? from[0].term.part.designator : undefined
          const message = x && y && cell
            ? `${cell} is wired in backwards: ${termName(t)} is wired to ${termName(x)} and ${termName(g)} to ${termName(y)}. This will damage ${t.part.designator}. Swap the two wires.`
            : x && y
            ? `${termName(t)} is wired to ${termName(x)} and ${termName(g)} to ${termName(y)}: the power is reversed and will damage ${t.part.designator}. Swap the two wires.`
            : `${termName(t)} sits ${volts(-v)} below ${termName(g)}: the power is reversed and will damage ${t.part.designator}. Swap its power wires.`
          reversed.add(t.part.uid)
          add({ rule: 'reversed', message, ...base(from), pins: [termPin(t), termPin(g), ...from.map((s) => termPin(s.term))], wires: [...netWires[i], ...wiresOf(ground)] })
          continue
        }
        if (v <= EPS) continue
      } else {
        // The load's ground does not reach the return of what feeds it: no voltage can be stated.
        // No ground already says so when the ground is not wired at all.
        const feeding = sorted([...direct, ...unknown])
        // Nothing to add about a load fed by a supply already reported as shorted.
        if (feeding.length && !groundless(t.part) && !feeding.some((x) => shorted.has(x.id))) {
          const g = t.info.grounds.length ? termName(terminal(nodeKey(t.part.uid, t.info.grounds[0]))!) : `${t.part.designator} (no ground pin)`
          const src = feeding[0]
          const ret = returnPinName(src.term)
          const message = feeding.length === 1 && ret
            ? `${g} is not connected to ${termName(terminal(nodeKey(src.term.part.uid, ret))!)}, the ground of the supply feeding ${termName(t)}: connect them.`
            : `${termName(t)} voltage cannot be checked: ${g} does not connect back to the return of ${andList(feeding.map((x) => termName(x.term)))}. Connect ${g} to the ground of that supply.`
          add({ rule: 'supply-unknown', message, ...base(feeding) })
        }
        continue
      }
      const max = Math.max(...accepts)
      const min = Math.min(...accepts)
      const what = from.length === 1 ? sourceName(from[0]) : `${andList(from.map((s) => termName(s.term)))} in series`
      if (v !== null && v > max + EPS) {
        add({ rule: 'supply-too-high', message: tooHigh(t, max, v, from, what), ...base(from) })
        continue
      }
      // Until parts carry real ranges, an input takes down to 90% of its lowest rail (3.0 V for a
      // 3.3 V part, 4.5 V for a 5 V one).
      const floor = LOW_TOLERANCE * min
      if (v !== null && !unknown.length && v < floor - EPS)
        add({ rule: 'supply-too-low', message: `${termName(t)} needs at least ${floor.toFixed(1)} V; ${what} ${from.length === 1 ? 'gives' : 'give'} only ${volts(v)}. ${fixTo(from, min)}`, ...base(from) })
    }
  })
  // Two ground nets meet when they are one net or joined through supplies (one potential group).
  const returnGroup = (key: string) => {
    const n = netOfKey(key)
    return groupOf.get(n) ?? n
  }
  return { reversed, returnGroup }
}

function mountMessage(p: PartInstance, board: PartInstance | undefined, issue: MountIssue): string {
  const at = board?.designator ?? issue.board
  switch (issue.reason) {
    case 'missing-board':
      return `${p.designator} is set to plug into a board that is not on the sheet (${at}), so its legs connect nothing. Drag it onto a breadboard, or wire it instead.`
    case 'not-a-board':
      return `${p.designator} is set to plug into ${at}, which is not a breadboard, so its legs connect nothing. Drag it onto a breadboard, or wire it instead.`
    case 'cannot-mount':
      return `${p.designator} cannot plug into a board (it is a board itself, has a bus pin or has no legs), so its legs connect nothing. Drag it off the board and wire it instead.`
    case 'partial':
      return `Not every leg of ${p.designator} sits in a hole of ${at}, so none of its legs connect. Move it until every leg sits in a hole.`
    case 'obscured':
      return `Some legs of ${p.designator} sit under another board drawn over ${at}, so none of its legs connect. Move it clear of that board.`
    case 'conflict':
      return `A leg of ${p.designator} needs a hole of ${at} that another part's leg already fills, so none of its legs connect. Move one of them.`
  }
}
