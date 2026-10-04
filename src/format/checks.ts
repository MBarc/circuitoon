// The wiring checker: mistakes a hobbyist would make on the real bench, found from the
// connectivity the netlist already computes (wires, breadboard strips, plugged legs, internal
// joins), each pin's `type` and `supply`, the voltage set on a part (a battery, a buck) and the
// pins a board powers from its USB connector (`electrical.external`). It never claims more than
// that data supports: a pin with no `type` is unknown and never triggers a rule. Pure, no React. Spec:
// docs/superpowers/specs/2026-09-26-wiring-checker-design.md.
import { type Connection, type Diagram, type Endpoint, type PartInstance, colorFamily, moduleOf, resolveEndpoint } from './diagram.ts'
import { type CoveredHole, type MountIssue, type Plug, coveredHoles, holeKey, holeUses, mountIssues, plugMismatches, plugsOf } from './breadboard.ts'
import { PLUG_FOR, PLUG_NAMES, SOCKET_NAMES } from './plugging.ts'
import { mainsOf } from './mainsModel.ts'
import { type ExternalPower, type HoleGroup, type ModuleDef, type PinDef, type PinType, commonReturn, declaredReturns, externalPower, holeGroupOf, isNetLabel, isSpacer, voltageOutputs } from './module.ts'
import { labelGroups, labelName, labelsOf } from './netLabels.ts'
import { type Netlist, conductors, netlist, nodeKey } from './netlist.ts'
import { partValue, primaryParam } from './values.ts'
import { andList, natural, orList } from './words.ts'
import { type MainsAnalysis, analyseMainsCached } from './mains.ts'
import { type PinRuleId, hasPinData, lazyPinModel, pinFindings } from './pinRules.ts'
import { unknownFeedWords } from './mainsRules.ts'
import { type UsbRuleId, usbFedParts, usbFindings, usbLink } from './usb.ts'

/** `info` is a note, not a problem: it never blocks and never counts as one. */
export type Severity = 'error' | 'warning' | 'info'
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
  | 'covered-hole'
  | 'hole-shared'
  | 'mains-short'
  | 'mains-cross-source'
  | 'mains-to-low-voltage'
  | 'earth'
  | 'mains-voltage'
  | 'mains-rating'
  | 'mains-cable'
  | 'live-prong'
  | 'plug-mismatch'
  | 'polarity'
  | 'unprotected'
  | 'fuse-rating-unknown'
  | 'mains-shared-neutral'
  | 'earth-bond'
  | 'rating-unknown'
  | 'rating-conditional'
  | 'rating-unverified'
  | 'cable-unverified'
  | 'data-missing'
  | 'mains-incomplete'
  | 'battery-bank'
  | 'wire-color-ground'
  | 'wire-color-supply'
  | 'wire-color-signal'
  | 'label-unnamed'
  | 'label-mains'
  | 'label-alone'
  /** Never from checkDiagram: the editor's Problems list adds it for a stored part older than the library (moduleDrift.ts). */
  | 'module-drift'
  | PinRuleId
  | UsbRuleId

/** Rule order within one severity and one subject, and each rule's short heading. */
export const RULES: Record<RuleId, { severity: Severity; title: string }> = {
  broken: { severity: 'error', title: 'Broken connection' },
  'label-unnamed': { severity: 'error', title: 'Label has no name' },
  'label-mains': { severity: 'error', title: 'Label on mains wiring' },
  'covered-hole': { severity: 'error', title: 'Hole under a part' },
  'hole-shared': { severity: 'error', title: 'Two wires in one hole' },
  'leg-hole-shared': { severity: 'error', title: 'Two in one hole' },
  short: { severity: 'error', title: 'Short circuit' },
  'mains-short': { severity: 'error', title: 'Mains short circuit' },
  'mains-cross-source': { severity: 'error', title: 'Two outlets joined' },
  'mains-to-low-voltage': { severity: 'error', title: 'Mains on low-voltage wiring' },
  earth: { severity: 'error', title: 'Earth fault' },
  'mains-voltage': { severity: 'error', title: 'Wrong mains voltage' },
  'mains-rating': { severity: 'error', title: 'Not rated for this voltage' },
  'mains-cable': { severity: 'error', title: 'Unsuitable mains cable' },
  'live-prong': { severity: 'error', title: 'Live plug prongs' },
  reversed: { severity: 'error', title: 'Power reversed' },
  'supplies-fight': { severity: 'error', title: 'Supplies fight' },
  'supply-too-high': { severity: 'error', title: 'Voltage too high' },
  'pin-flash': { severity: 'error', title: 'Wired to a flash pin' },
  'pin-input-only': { severity: 'error', title: 'Input-only pin drives' },
  'pin-output-only': { severity: 'error', title: 'Output-only pin read' },
  'i2c-address-clash': { severity: 'error', title: 'I2C address clash' },
  'usb-to-pin': { severity: 'error', title: 'USB wired to pins' },
  'usb-fit': { severity: 'error', title: 'USB plug does not fit' },
  'usb-role': { severity: 'error', title: 'USB roles clash' },
  'supply-too-low': { severity: 'warning', title: 'Voltage too low' },
  'pin-strapping': { severity: 'warning', title: 'Strapping pin pulled' },
  'pin-no-pullup': { severity: 'warning', title: 'Input has no pull-up' },
  'i2c-pullups': { severity: 'warning', title: 'No I2C pull-ups' },
  'i2c-address-floating': { severity: 'warning', title: 'I2C address undefined' },
  'supply-unknown': { severity: 'warning', title: 'Check the supply voltage' },
  'supplies-parallel': { severity: 'warning', title: 'Supplies tied together' },
  'outputs-fight': { severity: 'warning', title: 'Outputs fight' },
  'no-common-ground': { severity: 'warning', title: 'No common ground' },
  'no-power': { severity: 'warning', title: 'No power' },
  'no-ground': { severity: 'warning', title: 'No ground' },
  mount: { severity: 'warning', title: 'Not plugged in' },
  'plug-mismatch': { severity: 'warning', title: 'Plug does not fit' },
  polarity: { severity: 'warning', title: 'Mains polarity' },
  unprotected: { severity: 'warning', title: 'No fuse' },
  'fuse-rating-unknown': { severity: 'warning', title: 'Fuse rating unknown' },
  'mains-shared-neutral': { severity: 'warning', title: 'Shared neutral' },
  'earth-bond': { severity: 'warning', title: 'Ground joined to earth' },
  'rating-unknown': { severity: 'warning', title: 'Mains rating unknown' },
  'rating-conditional': { severity: 'warning', title: 'Rating has conditions' },
  'rating-unverified': { severity: 'warning', title: 'Rating not verified' },
  'cable-unverified': { severity: 'warning', title: 'Check the mains cable' },
  'data-missing': { severity: 'warning', title: 'Mains data missing' },
  'mains-incomplete': { severity: 'warning', title: 'Mains checks did not finish' },
  'wire-color-ground': { severity: 'warning', title: 'Ground wire not black' },
  'wire-color-supply': { severity: 'warning', title: 'Supply wire not red' },
  'wire-color-signal': { severity: 'warning', title: 'Signal wire in a power color' },
  'label-alone': { severity: 'warning', title: 'Label connects nothing' },
  'usb-power': { severity: 'warning', title: 'USB port overloaded' },
  'usb-hub-bus-power': { severity: 'warning', title: 'Bus-powered hub overloaded' },
  // Its severity is the drift's own (an error when the part must be placed again); listed by the editor only.
  'module-drift': { severity: 'warning', title: 'Part data out of date' },
  'battery-bank': { severity: 'info', title: 'Parallel battery bank' },
  'i2c-pullups-unknown': { severity: 'info', title: 'Check the I2C pull-ups' },
  'usb-power-unknown': { severity: 'info', title: 'USB current not known' },
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

// ---- Naming ----

/** A wire end as the user reads it: the part's designator (its uid when missing), the pin label or name, and the hole or bus offset. */
export function endpointName(d: Diagram, ep: Endpoint): string {
  const part = d.parts.find((p) => p.uid === ep.part)
  const m = part && moduleOf(d, part.module)
  // A net label is named by its name: "label SDA".
  if (part && isNetLabel(m)) {
    const name = labelName(part)
    return name ? `label ${name}` : `${part.designator} (unnamed label)`
  }
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

/** A wire end or another part's leg in a hole a mounted part's body covers. */
export interface CoveredUse {
  cover: CoveredHole
  /** The hole as the user reads it ("BB1 c3-top hole 0"). */
  where: string
  /** The wire whose end is there, or the leg that sits there. */
  wire?: string
  leg?: Plug
}

/**
 * Every wire end and leg in a hole under a mounted part's body (`coveredHoles`), wires in file
 * order then legs; wires in `skip` (broken ones) are left out. A wire to a plugged pin ends in that
 * leg's hole by design, so only an end that names a board hole counts, like leg-hole-shared.
 */
export function coveredUses(d: Diagram, skip: ReadonlySet<string> = new Set()): CoveredUse[] {
  const covered = coveredHoles(d)
  if (!covered.length) return []
  const at = new Map(covered.map((c) => [holeKey(c.board, c.group, c.hole), c]))
  const boards = new Set(covered.map((c) => c.board))
  const out: CoveredUse[] = []
  const where = (c: CoveredHole) => endpointName(d, { part: c.board, pin: c.group, hole: c.hole })
  for (const w of d.connections) {
    if (skip.has(w.uid)) continue
    for (const ep of [w.from, w.to]) {
      const c = boards.has(ep.part) ? at.get(holeKey(ep.part, ep.pin, ep.hole ?? 0)) : undefined
      if (c) out.push({ cover: c, where: where(c), wire: w.uid })
    }
  }
  for (const pl of plugsOf(d)) {
    const c = at.get(holeKey(pl.board, pl.group, pl.hole))
    if (c && c.by !== pl.part) out.push({ cover: c, where: where(c), leg: pl })
  }
  return out
}

/** The sentence for a covered use, shared by the checker and verify. */
export function coveredMessage(d: Diagram, u: CoveredUse): string {
  const name = (uid: string) => d.parts.find((p) => p.uid === uid)?.designator ?? uid
  const by = name(u.cover.by)
  if (!u.leg) return `A wire ends in ${u.where}, under ${by}'s body: a part lying over a hole leaves no room for a wire end. Move the wire to a free hole of the strip.`
  const part = d.parts.find((p) => p.uid === u.leg!.part)
  const m = part && moduleOf(d, part.module)
  const pin = m?.pins.find((p): p is PinDef => !isSpacer(p) && p.name === u.leg!.pin)
  return `Leg ${pin?.label ?? u.leg.pin} of ${name(u.leg.part)} sits in ${u.where}, under ${by}'s body: a part lying over a hole leaves no room for a leg. Move ${name(u.leg.part)} or ${by}.`
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
  /** An output of a converter that is not powered (spec 1.3): it feeds nothing and makes no supply; when unknown, what it would feed is reported as not checked. */
  dead?: 'unpowered' | 'unknown'
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
  if (t.dead) return null
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
/**
 * A pin that drives its net from its own part: shorted when that part's ground is on the same net.
 * An output of a converter that may be powered (unknown) still drives: its short to its own ground
 * is a wiring mistake whatever the input. Only an unpowered converter's outputs drive nothing.
 */
const drives = (t: Terminal) => (t.type === 'power_out' && t.dead !== 'unpowered') || t.info.external.has(t.name)

// ---- Wording ----

/** The wire that joins two terminals directly, if one does. */
function wireBetween(d: Diagram, a: Terminal, b: Terminal): Connection | undefined {
  const is = (ep: Endpoint, t: Terminal) => ep.part === t.part.uid && ep.pin === t.name
  return d.connections.find((c) => (is(c.from, a) && is(c.to, b)) || (is(c.from, b) && is(c.to, a)))
}
/** "Remove the wire from A to B." (in the order the wire was drawn) when one joins them directly, else the fallback. */
const removeWire = (d: Diagram, a: Terminal, b: Terminal, fallback: string) => {
  const c = wireBetween(d, a, b)
  if (!c) return fallback
  const [x, y] = c.from.part === a.part.uid && c.from.pin === a.name ? [a, b] : [b, a]
  return `Remove the wire from ${termName(x)} to ${termName(y)}.`
}
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
/**
 * Designators in natural order as words: "BT1-BT4" when three or more share a prefix and run
 * without a gap, else a list ("BT1 and BT2", "BT1, BT3 and BT4").
 */
export function cellRange(names: string[]): string {
  const parsed = names.map((n) => /^(.*?)(\d+)$/.exec(n))
  const run = names.length > 2 && parsed.every((m, i) => m && m[1] === parsed[0]![1] && Number(m[2]) === Number(parsed[0]![2]) + i)
  return run ? `${names[0]}-${names[names.length - 1]}` : andList(names)
}
/** A supply named for advice: a battery by its designator, anything else by its pin. */
const supplyName = (t: Terminal) => (isCell(t) ? t.part.designator : termName(t))

/**
 * A supply the given power inputs all accept, from their rails: "a 3.3 V supply, such as a
 * board's 3V3 pin", "a 7 V to 12 V supply, such as a 9 V battery"; "a compatible supply" when a
 * rail is unknown or they share none.
 */
function supplyFor(ins: Terminal[]): string {
  const common = commonRails(ins)
  if (!common?.length) return 'a compatible supply'
  const r = common
  const [min, max] = [r[0], r[r.length - 1]]
  const what = r.length <= 2 ? `a ${orList(r.map(volts))} supply` : `a ${volts(min)} to ${volts(max)} supply`
  const pins = [[3.3, '3V3'], [5, '5V']].filter(([v]) => r.some((x) => Math.abs(x - (v as number)) <= EPS)).map(([, n]) => n as string)
  const cell = [9, 6, 4.5, 3.7, 7.4, 3].find((v) => v >= min - EPS && v <= max + EPS)
  const example = pins.length ? `a board's ${orList(pins)} pin` : cell !== undefined ? `a ${volts(cell)} battery` : ''
  return example ? `${what}, such as ${example}` : what
}

/** The rails every one of the inputs accepts, sorted; null when any input's rails are unknown. */
function commonRails(ins: Terminal[]): number[] | null {
  let common: number[] | null = null
  for (const t of ins) {
    const rails = knownRails(t.supply)
    if (!rails) return null
    common = common === null ? [...new Set(rails)] : common.filter((v) => rails.some((r) => Math.abs(r - v) <= EPS))
  }
  return (common ?? []).sort((a, b) => a - b)
}

/** What an input accepts, in words: "needs 3.3 V", "accepts 3.3 V or 5 V", "accepts 7 V to 12 V". */
function acceptsText(rails: number[]): string {
  const r = [...new Set(rails)].sort((a, b) => a - b)
  return r.length === 1 ? `needs ${volts(r[0])}` : r.length === 2 ? `accepts ${orList(r.map(volts))}` : `accepts ${volts(r[0])} to ${volts(r[r.length - 1])}`
}

/**
 * The advice for unfed power inputs (`it`: "it" or "them"), given every load on their nets. A rail
 * shared by loads that accept different rails gets a voltage all of them accept, named with what
 * each needs, or, when they share none, the advice to split it: advice that suits one load must
 * never power another one on the same rail at a voltage it cannot take.
 */
function railAdvice(loads: Terminal[], it: string): string {
  const plain = `Connect ${it} to ${supplyFor(loads)}.`
  const rails = loads.map((t) => knownRails(t.supply))
  if (new Set(loads.map((t) => t.part)).size < 2 || rails.some((r) => !r)) return plain
  const texts = rails.map((r) => acceptsText(r!))
  if (new Set(texts).size < 2) return plain
  const what = andList(loads.map((t, i) => `${termName(t)} ${texts[i]}`))
  return commonRails(loads)!.length
    ? `${what}: connect ${it} to ${supplyFor(loads)}.`
    : `${what}: these parts need different supply voltages; split the rail and power each part from a supply it accepts.`
}

// ---- Terminals by node key ----

/** Builds a node key's terminal (null for a missing part, module or pin), with its converter's dead state from `mains`. */
function terminalsOf(d: Diagram, partByUid: Map<string, PartInstance>, mains: MainsAnalysis | null): (key: string) => Terminal | null {
  return (key) => {
    const [uid, name] = JSON.parse(key) as [string, string]
    const part = partByUid.get(uid)
    const m = part && moduleOf(d, part.module)
    // A net label is no terminal: it only joins, so it never feeds, loads or grounds anything.
    if (!part || !m || isNetLabel(m)) return null
    const info = moduleInfo(m)
    const def = info.defs.get(name)
    if (!def) return null
    const src = def.pin ?? def.group!
    return { key, part, info, name, label: src.label ?? name, type: src.type, supply: src.supply, bare: !def.pin && !src.type, dead: mains?.deadOutputs.get(key) }
  }
}

// ---- Net roles (wire colours) ----

/**
 * What a low-voltage net carries, for its wire colour: `ground` (black), a positive `supply` rail
 * (red) or a `signal` (any other colour).
 */
export type NetRole = 'ground' | 'supply' | 'signal'

/**
 * A pin on a positive supply rail: a pin on USB power, a power output at a positive voltage (the
 * part's value, else its supply; an adjustable output counts, a pass-through such as a charger's
 * OUT+ too), or a power input whose every rail is known and positive. A rail that does not parse
 * ("-5V") is never guessed into a supply.
 */
function positiveRail(t: Terminal): boolean {
  if (t.bare) return false
  const external = t.info.external.get(t.name)
  if (external) return external.volts > 0
  if (t.type === 'power_out') {
    const value = t.info.valued.has(t.name) ? partValue(t.part, t.info.module) : null
    if (value) return value.value > 0
    if (!t.supply) return false
    const p = parseSupply(t.supply)
    return p.unknown === null ? p.volts.length > 0 && p.volts.every((v) => v > 0) : p.unknown === 'adjustable'
  }
  if (t.type === 'power_in') {
    const rails = knownRails(t.supply)
    return !!rails?.length && rails.every((v) => v > 0)
  }
  return false
}

/**
 * The role of the net made of `keys` (with their terminals), or null when no colour is judged: a net
 * on mains wiring or with a mains identity (it keeps its regional colours), a net with a power pin
 * whose voltage is not known to be positive (a rail that does not parse, such as -5V, or no supply
 * listed: it is never guessed into supply or signal), or a net that holds both a ground and a
 * positive supply (a short, or the link between two cells in series).
 */
function roleOf(keys: string[], terms: Terminal[], mains: MainsAnalysis | null): NetRole | null {
  if (mains && keys.some((k) => mains.hazardKeys.has(k) || mains.conductorOf(k))) return null
  if (terms.some((t) => !t.bare && (t.type === 'power_out' || t.type === 'power_in') && !positiveRail(t))) return null
  const ground = terms.some((t) => t.type === 'ground')
  const supply = terms.some(positiveRail)
  return ground && supply ? null : ground ? 'ground' : supply ? 'supply' : 'signal'
}

export interface NetRoles {
  netlist: Netlist
  /** Per net of `netlist`, its role; null where no colour is judged (see roleOf). */
  roles: (NetRole | null)[]
  /** The role of a node key: its net's, or its own terminal's when it is on no net. */
  roleOfKey: (key: string) => NetRole | null
}

const rolesCache = new WeakMap<Diagram['connections'], { parts: Diagram['parts']; modules: Diagram['modules']; result: NetRoles }>()

/** Every net's colour role, from the checker's own supply and ground knowledge. Cached per sheet state, like the mains analysis. */
export function netRoles(d: Diagram): NetRoles {
  const hit = rolesCache.get(d.connections)
  if (hit && hit.parts === d.parts && hit.modules === d.modules) return hit.result
  const mains = analyseMainsCached(d)
  const nl = netlist(d, plugsOf(d))
  const terminal = terminalsOf(d, new Map(d.parts.map((p) => [p.uid, p])), mains)
  return rememberRoles(d, nl, nl.nets.map((keys) => roleOf(keys, termsOf(terminal, keys), mains)), terminal, mains)
}

const termsOf = (terminal: (key: string) => Terminal | null, keys: string[]) => keys.map(terminal).filter((t): t is Terminal => t !== null)

/** Caches the roles for `d` (the checker stores the ones it worked out, so the renderer reuses them). */
function rememberRoles(d: Diagram, nl: Netlist, roles: (NetRole | null)[], terminal: (key: string) => Terminal | null, mains: MainsAnalysis | null): NetRoles {
  const roleOfKey = (key: string) => {
    const i = nl.netOf.get(key)
    return i === undefined ? roleOf([key], termsOf(terminal, [key]), mains) : roles[i]
  }
  const result = { netlist: nl, roles, roleOfKey }
  rolesCache.set(d.connections, { parts: d.parts, modules: d.modules, result })
  return result
}

/** The colour role of the net a wire end is on (a pin on no net: its own), or null where no colour is judged. */
export function endpointRole(d: Diagram, ep: Endpoint): NetRole | null {
  return netRoles(d).roleOfKey(nodeKey(ep.part, ep.pin))
}

/** The colour each role's wires are: ground black, supply red; a signal has no one colour. */
export const ROLE_COLORS: Record<NetRole, string | null> = { ground: 'black', supply: 'red', signal: null }

// ---- The checker ----

type Draft = Omit<Finding, 'id' | 'severity'> & { causes: string[] }

/** Every wiring problem on the sheet, errors first, then by subject (a designator, in natural order), then by rule. */
export function checkDiagram(d: Diagram): Finding[] {
  const partByUid = new Map(d.parts.map((p) => [p.uid, p]))
  const plugs = plugsOf(d)
  const nl = netlist(d, plugs)
  // Mains first (spec 3), from the analysis the renderer shares: mains wiring never enters the DC
  // rules, and a converter that is not powered supplies nothing. A secondary that is possibly live
  // only across an inadequate isolation barrier keeps its DC checks (rule 1 reports it).
  const mains = analyseMainsCached(d)
  const hazardous = (key: string) => !!mains?.mainsKeys.has(key)
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

  const terminal = terminalsOf(d, partByUid, mains)

  const usbAny = d.parts.some((p) => moduleOf(d, p.module)?.pins.some((q) => !isSpacer(q) && q.type === 'usb'))
  // Wires per net, and which parts have a wire that conducts or a plugged leg.
  const netWires: string[][] = nl.nets.map(() => [])
  const connected = new Set<string>(plugs.map((pl) => pl.part))
  for (const c of d.connections) {
    if (brokenSet.has(c.uid)) continue
    // A USB link brings power and ground through the cable: it does not make a part wired.
    if (!(usbAny && usbLink(d, c))) {
      connected.add(c.from.part)
      connected.add(c.to.part)
    }
    const i = nl.netOf.get(nodeKey(c.from.part, c.from.pin))
    if (i !== undefined) netWires[i].push(c.uid)
  }

  // A net with a USB port is judged by the USB rules alone (usb.ts), like a mains net by the mains rules.
  const isUsb = (t: Terminal | null) => t?.type === 'usb'
  const netTerms = nl.nets.map((keys) => {
    if (keys.some(hazardous)) return []
    const terms = keys.map(terminal)
    return terms.some(isUsb) ? [] : terms.filter((t): t is Terminal => t !== null)
  })
  // A USB cable or plug-in joins the two boards' grounds (never VBUS to a 5V pin: that may sit behind
  // a diode or a switch). Each board's first ground pin stands for its ground; a link on a net with
  // other pins (usb-to-pin) joins nothing.
  const usbGrounds: [string, string][] = []
  const usbGrounded = new Set<string>()
  if (usbAny)
    for (const c of d.connections) {
      const l = brokenSet.has(c.uid) ? null : usbLink(d, c)
      const i = l ? nl.netOf.get(l.from.key) : undefined
      if (!l || i === undefined || nl.nets[i].some((k) => terminal(k)?.type !== 'usb')) continue
      const [ga, gb] = [l.from, l.to].map((p) => moduleInfo(p.module).grounds[0])
      if (!ga || !gb || l.from.part === l.to.part) continue
      usbGrounds.push([nodeKey(l.from.part.uid, ga), nodeKey(l.to.part.uid, gb)])
      usbGrounded.add(l.from.part.uid).add(l.to.part.uid)
    }
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

  const { reversed, returnGroup } = checkPotentials({ d, nl, netTerms, netWires, terminal, plugs, shorted, add, skip: hazardous, usbGrounds })

  // Per part: power and ground reach it from another part.
  const usbFed = usbAny ? usbFedParts(d) : new Set<string>()
  const others = (t: Terminal) => {
    const i = nl.netOf.get(t.key)
    return i === undefined ? [] : netTerms[i].filter((o) => o.part !== t.part)
  }
  const isAre = (n: number) => (n === 1 ? 'is' : 'are')
  /** Every load on the nets of the given power inputs (theirs included), one per input component, by name. */
  const sharedLoads = (pins: Terminal[]) => {
    const seen = new Map<string, Terminal>()
    for (const t of pins) {
      const i = nl.netOf.get(t.key)
      for (const o of i === undefined ? [t] : netTerms[i]) {
        if (o.type !== 'power_in' || o.info.external.has(o.name)) continue
        const id = JSON.stringify([o.part.uid, o.info.comp.get(o.name)])
        const cur = seen.get(id)
        if (!cur || natural.compare(termName(o), termName(cur)) < 0) seen.set(id, o)
      }
    }
    return [...seen.values()].sort((a, b) => natural.compare(termName(a), termName(b)))
  }
  for (const p of d.parts) {
    if (!connected.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    // Only the power and ground pins matter here (a breadboard's many strips are skipped).
    const terms = [...moduleInfo(m).defs.entries()]
      .filter(([, def]) => { const ty = (def.pin ?? def.group)!.type; return ty === 'power_in' || ty === 'power_out' || ty === 'ground' })
      .map(([n]) => terminal(nodeKey(p.uid, n))).filter((t): t is Terminal => t !== null && !hazardous(t.key))
    const ins = terms.filter((t) => t.type === 'power_in')
    // A part with a pin on USB power is its own supply.
    // A part with its power reversed is reported as such, not as unpowered.
    // A part on a USB link takes its power through the port (a dongle, a charger's USB input).
    if (ins.length && !moduleInfo(m).external.size && !reversed.has(p.uid) && !usbFed.has(p.uid)) {
      const fed =
        ins.some((t) => others(t).some(mayFeed)) ||
        terms.some((t) => t.type === 'power_out' && others(t).some(isSource))
      if (!fed) {
        // Fed only through a converter whose mains input is not a complete connection: neither fed nor unfed.
        const vias = [...new Map(ins.flatMap((t) => others(t)).filter((o) => o.dead === 'unknown').map((o) => [o.key, o])).values()]
          .sort((a, b) => natural.compare(termName(a), termName(b)))
        if (vias.length) {
          const convs = [...new Set(vias.map((o) => o.part))]
          const words = unknownFeedWords(convs.map((c) => ({ designator: c.designator, status: mains!.converters.get(c.uid)! })))
          add({ rule: 'supply-unknown', subject: p.designator, target: p.designator,
            message: `${p.designator}'s power is not checked: it comes only from ${andList(vias.map(termName))}, and ${words.state}. ${words.fix}`,
            parts: [p.uid, ...convs.map((c) => c.uid)], pins: ins.map(termPin), wires: [], causes: ins.map((t) => t.key) })
        }
        else {
          const wiredPins = ins.filter((t) => others(t).length)
          const wired = [...new Set(wiredPins.map((t) => t.label))]
          const it = wired.length === 1 ? 'it' : 'them'
          const message = wired.length
            ? `${p.designator} has no power: ${andList(wired)} ${isAre(wired.length)} connected but nothing supplies ${it}. ${railAdvice(sharedLoads(wiredPins), it)}`
            : `${p.designator} has no power: connect ${orList([...new Set(ins.map((t) => t.label))])}.`
          add({ rule: 'no-power', subject: p.designator, target: p.designator, message, parts: [p.uid], pins: ins.map(termPin), wires: [], causes: ins.map((t) => t.key) })
        }
      }
    }
    const grounds = terms.filter((t) => t.type === 'ground')
    // A part already reported as shorted gets no second finding about its ground.
    if (grounds.length && !shortedParts.has(p.uid) && !usbGrounded.has(p.uid) && !grounds.some((t) => others(t).some((o) => !o.bare))) {
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
      // A ground pin is grounded when it leads to another part, or stands for the board's ground on a USB link.
      list = m ? moduleInfo(m).grounds.map((g) => terminal(nodeKey(p.uid, g))!).filter((t, i) => others(t).some((o) => !o.bare) || (i === 0 && usbGrounded.has(p.uid))) : []
      groundedCache.set(p.uid, list)
    }
    return list
  }
  // Per pair of parts, the first signal pair by name across all nets (never by uid or net order).
  const typed = (t: Terminal) => t.type === 'input' || t.type === 'output' || t.type === 'io'
  const groundGroups = new Map<string, Set<string>>()
  const groupsOf = (p: PartInstance) => {
    let g = groundGroups.get(p.uid)
    if (!g) groundGroups.set(p.uid, (g = new Set(groundedPins(p).map((x) => returnGroup(x.key)))))
    return g
  }
  const best = new Map<string, { a: Terminal; b: Terminal; an: string; bn: string; net: number }>()
  nl.nets.forEach((_, i) => {
    // Signal pins: typed input, output or io, or an untyped board GPIO; at least one end typed.
    // One pin per part: its first typed signal by name, else its first untyped one.
    const rep = new Map<PartInstance, { t: Terminal; n: string }>()
    for (const t of netTerms[i]) {
      if (t.bare || !(typed(t) || t.type === undefined)) continue
      const n = termName(t)
      const cur = rep.get(t.part)
      if (!cur || (typed(t) && !typed(cur.t)) || (typed(t) === typed(cur.t) && natural.compare(n, cur.n) < 0)) rep.set(t.part, { t, n })
    }
    if (rep.size < 2) return
    const list = [...rep.values()].filter((x) => groupsOf(x.t.part).size).sort((x, y) => natural.compare(x.n, y.n))
    for (let ai = 0; ai < list.length; ai++)
      for (let bi = ai + 1; bi < list.length; bi++) {
        const [a, b] = [list[ai], list[bi]]
        if (!typed(a.t) && !typed(b.t)) continue
        const ga = groupsOf(a.t.part)
        if ([...groupsOf(b.t.part)].some((g) => ga.has(g))) continue
        const key = [a.t.part.uid, b.t.part.uid].sort().join('\u0000')
        const prev = best.get(key)
        if (!prev || natural.compare(a.n + ' ' + b.n, prev.an + ' ' + prev.bn) < 0) best.set(key, { a: a.t, b: b.t, an: a.n, bn: b.n, net: i })
      }
  })
  for (const { a, b, net } of best.values()) {
    const [ga, gb] = [groundedPins(a.part), groundedPins(b.part)]
    add({ rule: 'no-common-ground', subject: a.part.designator, target: termName(a),
      message: `${termName(a)} is wired to ${termName(b)}, but ${a.part.designator} and ${b.part.designator} share no ground, so the signal has no reference. Connect ${termName(ga[0])} to ${termName(gb[0])}.`,
      parts: [a.part.uid, b.part.uid], pins: [termPin(a), termPin(b), termPin(ga[0]), termPin(gb[0])], wires: netWires[net], causes: [a.key, b.key] })
  }

  // Rule 10 (spec 2, Ruling 40): a plug-in device over an outlet it is not plugged into. It
  // replaces every generic mount finding of that part (one finding per plug and outlet).
  const mismatched = new Set<string>()
  for (const mm of plugMismatches(d)) {
    const p = partByUid.get(mm.part)!
    const b = partByUid.get(mm.board)!
    mismatched.add(mm.part)
    const message = mm.kind === 'family'
      ? `${p.designator}'s ${PLUG_NAMES[mm.plug]} does not fit ${b.designator}'s ${orList([...new Set(mm.sockets.map((f) => SOCKET_NAMES[f]))])}. Use a device with ${orList([...new Set(mm.sockets.map((f) => PLUG_FOR[f]))])}.`
      : mm.kind === 'unplugged'
        ? `${p.designator} is over ${b.designator} but not plugged in. Drag it into the socket.`
        : `${p.designator} does not sit in ${b.designator}: its contacts do not all meet one socket the way the plug fits, so none of them connect. Turn or move it until it seats; a plug that is only partly in is never electrically safe.`
    add({ rule: 'plug-mismatch', subject: p.designator, target: p.designator, message, parts: [p.uid, b.uid], pins: [], wires: [], select: { parts: [p.uid], wires: [] }, causes: [p.uid, b.uid] })
  }

  for (const issue of mountIssues(d)) {
    if (mismatched.has(issue.part)) continue
    const p = partByUid.get(issue.part)
    if (!p) continue
    const board = partByUid.get(issue.board)
    add({ rule: 'mount', subject: p.designator, target: p.designator, message: mountMessage(p, board, issue),
      parts: board ? [p.uid, board.uid] : [p.uid], pins: [], wires: [], select: { parts: [p.uid], wires: [] }, causes: [p.uid] })
  }

  // A wire end in the very hole a plugged leg fills: an error, nothing fits beside a leg. A wire to the plugged pin itself also ends
  // in that hole on the sheet, by design (it shows the strip the jumper goes into), so only an end
  // that names the hole is flagged.
  const legIn = new Map(plugs.map((pl) => [JSON.stringify([pl.board, pl.group, pl.hole]), pl]))
  for (const c of d.connections) {
    if (brokenSet.has(c.uid)) continue
    for (const ep of [c.from, c.to]) {
      const board = partByUid.get(ep.part)
      const m = board && moduleOf(d, board.module)
      // A mains outlet's socket contacts are exempt, as in hole-shared: a supply wired to a contact
      // meets the seated plug's prong there by design.
      if (!board || !m || !holeGroupOf(m, ep.pin) || mainsOf(m).sockets.length) continue
      const hole = JSON.stringify([ep.part, ep.pin, ep.hole ?? 0])
      const pl = legIn.get(hole)
      const leg = pl && partByUid.get(pl.part)
      if (!pl || !leg) continue
      const legTerm = terminal(nodeKey(pl.part, pl.pin))
      const where = endpointName(d, { ...ep, hole: ep.hole ?? 0 })
      add({ rule: 'leg-hole-shared', subject: board.designator, target: where,
        message: `A wire ends in ${where}, where leg ${legTerm?.label ?? pl.pin} of ${leg.designator} sits: physically, one hole takes one leg or one wire end, not both. Move the wire to a free hole of the same strip.`,
        parts: [board.uid, leg.uid], pins: [{ part: pl.part, pin: pl.pin }], wires: [c.uid], select: { parts: [], wires: [c.uid] }, causes: [c.uid, hole] })
    }
  }

  // A wire end or a leg in a hole a mounted part's body lies over: nothing fits there.
  for (const u of coveredUses(d, brokenSet)) {
    const board = partByUid.get(u.cover.board)!
    const key = holeKey(u.cover.board, u.cover.group, u.cover.hole)
    const message = coveredMessage(d, u)
    if (u.wire) add({ rule: 'covered-hole', subject: board.designator, target: u.where, message, parts: [board.uid, u.cover.by], pins: [], wires: [u.wire], select: { parts: [], wires: [u.wire] }, causes: [u.wire, key] })
    else add({ rule: 'covered-hole', subject: board.designator, target: u.where, message, parts: [u.leg!.part, u.cover.by, board.uid], pins: [{ part: u.leg!.part, pin: u.leg!.pin }], wires: [], select: { parts: [u.leg!.part], wires: [] }, causes: [nodeKey(u.leg!.part, u.leg!.pin), key] })
  }

  // More wire ends in one breadboard hole than it takes (verify's capacity, from the same
  // holeUses): one hole takes one wire end. A leg and a wire end is leg-hole-shared, and a wire to
  // a plugged pin ends in that leg's hole by design, so only ends that name the hole count here.
  // The cause is verify's capacity key, so a combined report can drop verify's copy (alsoChecked).
  for (const u of holeUses(d, brokenSet, plugs).values()) {
    const ends = u.ends.filter((e) => !e.viaPin)
    if (!u.breadboard || ends.length <= u.cap) continue
    const board = partByUid.get(u.board)!
    const where = endpointName(d, { part: u.board, pin: u.group, hole: u.hole })
    const wires = [...new Set(ends.map((e) => e.wire))]
    const names = wires.map((w) => wireName(d, d.connections.find((c) => c.uid === w)!)).sort(natural.compare)
    const far = ends.map((e) => d.connections.find((c) => c.uid === e.wire)![e.end === 'from' ? 'to' : 'from'].part)
    const takes = u.cap === 1 ? 'one wire end' : `${u.cap} wire ends`
    add({ rule: 'hole-shared', subject: board.designator, target: where,
      message: `${ends.length} wire ends share ${where}: ${andList(names)}. Physically, one hole takes ${takes}. Move ${ends.length - u.cap === 1 ? 'one of them' : `all but ${u.cap === 1 ? 'one' : u.cap}`} to a free hole of the same strip.`,
      parts: [board.uid, ...far.filter((x) => partByUid.has(x))], pins: [], wires, select: { parts: [], wires }, causes: [JSON.stringify(['hole', u.board, u.group, u.hole])] })
  }

  for (const b of brokenConnections(d)) {
    const c = d.connections.find((w) => w.uid === b.uid)!
    const parts = [c.from.part, c.to.part].filter((u) => partByUid.has(u))
    add({ rule: 'broken', subject: b.name, target: b.name,
      message: `The wire ${b.name} is broken: ${andList(b.missing)} ${b.missing.length > 1 ? 'are' : 'is'} not on the sheet, so it connects nothing. Delete it, and draw it again if you still need it.`,
      parts, pins: [], wires: [b.uid], select: { parts: [], wires: [b.uid] }, causes: [b.uid] })
  }

  for (const f of mains?.findings ?? []) add(f)

  if (usbAny) for (const f of usbFindings(d, nl, netWires)) add(f)

  // Pin capabilities (input only, output only, flash, strapping, no pull-up) and I2C buses
  // (pull-ups, addresses), from the caps and I2C data the modules declare. Mains nets never enter.
  // A sheet with no capped pin and no I2C device skips the pass altogether.
  const pinFound = !d.parts.some((p) => { const m = moduleOf(d, p.module); return !!m && hasPinData(m) }) ? [] : pinFindings(lazyPinModel(
    d.parts.flatMap((p) => { const m = moduleOf(d, p.module); return m ? [{ id: p.uid, designator: p.designator, module: m, settings: p.settings }] : [] }),
    // The checker's own terminals per net (mains nets already left out), not the node keys parsed again.
    nl.nets.length, (i) => netTerms[i].map((t): [string, string] => [t.part.uid, t.name]), (part, pin) => nl.netOf.get(nodeKey(part, pin))))
  for (const f of pinFound)
    add({ rule: f.rule, subject: f.subject, target: f.target, message: f.message, parts: f.parts.filter((u) => partByUid.has(u)), pins: f.pins, wires: [...new Set(f.nets.flatMap((i) => netWires[i] ?? []))], causes: f.causes })

  // Net labels: a label needs a name, a name needs a second label to join, and a label never stands
  // in for mains wiring (it would hide a live conductor behind a flag and skip every cable check).
  const groups = labelGroups(d)
  for (const l of labelsOf(d)) {
    if (l.name) continue
    add({ rule: 'label-unnamed', subject: l.part.designator, target: `${l.part.designator} (unnamed label)`,
      message: `${l.part.designator} is a net label with no name, so it connects to nothing. Give it a name in the Inspector, or delete it.`,
      parts: [l.part.uid], pins: [], wires: [], select: { parts: [l.part.uid], wires: [] }, causes: [l.part.uid] })
  }
  for (const [name, list] of groups) {
    const keys = list.map((l) => nodeKey(l.part.uid, l.pin))
    const uids = list.map((l) => l.part.uid)
    if (mains && keys.some((k) => mains.hazardKeys.has(k) || mains.mainsKeys.has(k) || mains.conductorOf(k))) {
      const i = nl.netOf.get(keys[0])
      const n = list.length
      add({ rule: 'label-mains', subject: `label ${name}`, target: `label ${name}`,
        message: `${n === 1 ? 'Label' : `${n} labels`} ${name} ${n === 1 ? 'is' : 'are'} on mains wiring. A label hides the conductor it stands for, and mains must be drawn as real cable so it can be checked: use wires instead.`,
        parts: uids, pins: [], wires: i === undefined ? [] : netWires[i], select: { parts: uids, wires: [] }, causes: keys })
      continue
    }
    if (list.length > 1) continue
    const twin = [...groups.keys()].find((other) => other !== name && other.toLowerCase() === name.toLowerCase())
    const hint = twin ? ` Label names are case-sensitive; set its name to ${twin} if it should join that net.` : ` Add another label named ${name} where this net continues, or delete this one.`
    add({ rule: 'label-alone', subject: `label ${name}`, target: `label ${name}`,
      message: `Label ${name} connects to nothing else: it is the only label named ${name}.${hint}`,
      parts: uids, pins: [], wires: [], select: { parts: uids, wires: [] }, causes: keys })
  }

  // Wire colours (low voltage): ground black, positive supplies red, signals neither. Only a colour
  // chosen on purpose (colorSet: picked in the Inspector, or given by the netlist or layout) is
  // judged. Before the flag every wire drawn in the editor stored black, so an old sheet's wires
  // raise nothing; a wire with no colour is drawn in its role's colour (wireLooks). One finding per net.
  const byUid = new Map(d.connections.map((c) => [c.uid, c]))
  const roles = rememberRoles(d, nl, nl.nets.map((keys, i) => roleOf(keys, netTerms[i], mains)), terminal, mains).roles
  nl.nets.forEach((keys, i) => {
    const role = roles[i]
    if (!role) return
    const bad = netWires[i].map((uid) => byUid.get(uid)!).filter((c) => {
      if (c.color === undefined || !c.colorSet) return false
      const fam = colorFamily(c.color)
      return role === 'ground' ? fam !== 'black' : role === 'supply' ? fam !== 'red' : fam !== 'other'
    })
    if (!bad.length) return
    // The net is named by a pin that gives it its role (a ground pin, a supply pin), else its first pin.
    const named = [...netTerms[i]].filter((t) => !t.bare).sort((a, b) => natural.compare(termName(a), termName(b)))
    const at = (role === 'ground' ? named.find((t) => t.type === 'ground') : role === 'supply' ? named.find(positiveRail) : undefined) ?? named[0]
    const names = bad.map((c) => wireName(d, c)).sort(natural.compare)
    const list = names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : andList(names)
    const n = bad.length
    const wires = bad.map((c) => c.uid)
    const where = at ? ` at ${termName(at)}` : ''
    const them = n === 1 ? 'it' : 'them'
    let message: string
    if (role === 'ground') message = `${n === 1 ? 'A wire' : `${n} wires`} on the ground net${where} ${isAre(n)} not black: ${list}. Ground wires are black by convention: set ${them} to black.`
    else if (role === 'supply') message = `${n === 1 ? 'A wire' : `${n} wires`} on the supply net${where} ${isAre(n)} not red: ${list}. Positive supply wires are red by convention: set ${them} to red.`
    else {
      const fams = new Set(bad.map((c) => colorFamily(c.color!)))
      const what = fams.size > 1 ? 'red or black' : [...fams][0]
      message = `${n === 1 ? 'A signal wire' : `${n} signal wires`}${where} ${isAre(n)} ${what}: ${list}. Red and black mean power and ground by convention: give ${them} another color, such as blue, yellow or green.`
    }
    const parts = bad.flatMap((c) => [c.from.part, c.to.part]).filter((u) => partByUid.has(u))
    add({ rule: `wire-color-${role}`, subject: at?.part.designator ?? names[0], target: at ? termName(at) : names[0], message, parts, pins: [], wires, select: { parts: [], wires }, causes: [keys[0]] })
  })

  const rank = (s: Severity) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)
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
  /** The terminals (node keys) the edge joins at its `from` and `to` nets, when they are pins. */
  fromKey?: string
  toKey?: string
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
  plugs: ReturnType<typeof plugsOf>
  shorted: Set<string>
  /** Node keys on hazardous mains nets: no source edge, switch or common return with an end there enters the solver (spec 3). */
  skip: (key: string) => boolean
  /** Ground pins a USB link joins, one pair per link: 0 V apart. */
  usbGrounds: [string, string][]
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
function checkPotentials({ d, nl, netTerms, netWires, terminal, plugs, shorted, skip, add, usbGrounds }: PotentialInput): { reversed: Set<string>; returnGroup: (key: string) => string } {
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
  for (const [a, b] of usbGrounds) edges.push({ from: netOfKey(a), to: netOfKey(b), v: 0, fromKey: a, toKey: b })
  const outOn = new Map<string, Source[]>()
  /** Cells by bank (Ruling V1): same module and voltage, every + on one net and every - on another. */
  const bankCells = new Map<string, Source[]>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!m) continue
    const info = moduleInfo(m)
    // A switch is taken as closed for voltages: damage happens in the ON position. A switch or a
    // declared common return with a pin on a hazardous net places nothing.
    if (info.switchPins && !info.switchPins.some((n) => skip(nodeKey(p.uid, n)))) {
      const [a, b] = info.switchPins.map((n) => nodeKey(p.uid, n))
      edges.push({ from: netOfKey(a), to: netOfKey(b), v: 0, closedSwitch: true, fromKey: a, toKey: b })
    }
    // Grounds the module declares one return are joined at 0 V (a charger's B- and OUT-).
    for (const g of info.commonReturn)
      for (const n of g.slice(1)) {
        const [a, b] = [nodeKey(p.uid, g[0]), nodeKey(p.uid, n)]
        if (skip(a) || skip(b)) continue
        edges.push({ from: netOfKey(a), to: netOfKey(b), v: 0, fromKey: a, toKey: b })
      }
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
      // Mains never enters the potential solver (spec 3): not through the output, not through the
      // declared return, the only ground (an inferred return) or a diode's return.
      const ret = info.returnOf.get(s.term.name)
      const returnKeys = ret ? [nodeKey(p.uid, ret)] : info.grounds.map((g) => nodeKey(p.uid, g))
      if (skip(s.term.key) || returnKeys.some(skip)) continue
      sources.set(s.id, s)
      const out = netOfKey(s.term.key)
      const list = s.v === null ? unknownOn : outOn
      list.set(out, [...(list.get(out) ?? []), s])
      // A supply wired to its own ground is reported as a short already; it places nothing.
      if (shorted.has(s.id)) continue
      const retKey = ret ? nodeKey(p.uid, ret) : ''
      // A cell of a parallel bank: same module, same voltage, + and - each on a net of their own.
      if (ret && s.v !== null && !s.external && isCell(s.term)) {
        const k = JSON.stringify([out, netOfKey(retKey), p.module, s.v])
        bankCells.set(k, [...(bankCells.get(k) ?? []), s])
      }
      // A USB pin behind a diode only raises its net: placed after the first walk (see below).
      if (ret && s.external?.diode) diodes.push({ from: netOfKey(retKey), to: out, v: s.v, src: s, fromKey: retKey, toKey: s.term.key })
      else if (ret) edges.push({ from: netOfKey(retKey), to: out, v: s.v, src: s, fromKey: retKey, toKey: s.term.key })
      else if (info.grounds.length) {
        // Several grounds and no declared return: its voltage over any of them is unknown.
        s.refUnknown = true
        const g = nodeKey(p.uid, info.grounds[0])
        edges.push({ from: netOfKey(g), to: out, v: null, src: s, fromKey: g, toKey: s.term.key })
      } else edges.push({ from: `(${s.id})`, to: out, v: s.v, src: s, toKey: s.term.key })
    }
  }

  // Parallel battery banks (Ruling V1). Matching cells side by side are one supply at their voltage,
  // not two supplies tied together: they get one note with the practical advice instead of a
  // warning. A bank that is also tied to anything else (another supply, a fight) is "tied": its
  // cells are named in one warning with everything they are tied to, as before. The bank enters the
  // solver as one edge, its first cell by name: the others are exactly parallel to it, so they add
  // no voltage, and what a finding names never depends on which cell the walk happened to reach.
  const bankOf = new Map<string, string>()
  const spare = new Set<string>()
  for (const [k, list] of bankCells) {
    if (list.length < 2) continue
    list.sort((a, b) => natural.compare(termName(a.term), termName(b.term)))
    for (const s of list) bankOf.set(s.id, k)
    for (const s of list.slice(1)) spare.add(s.id)
  }
  for (let i = edges.length - 1; i >= 0; i--) if (edges[i].src && spare.has(edges[i].src!.id)) edges.splice(i, 1)
  /** A source with the other cells of its bank: the bank, when it is one; else just the source. */
  const mates = (s: Source): Source[] => {
    const k = bankOf.get(s.id)
    return k === undefined ? [s] : bankCells.get(k)!
  }
  /** A supply's name in a message, a bank as its cells in parallel. */
  const fromName = (s: Source) => (mates(s).length > 1 ? `${andList(mates(s).map((x) => termName(x.term)))} in parallel` : sourceName(s))
  /** Banks that meet another supply: no note. */
  const tiedBanks = new Set<string>()
  const tie = (list: Source[]) => {
    for (const s of list) {
      const k = bankOf.get(s.id)
      if (k !== undefined) tiedBanks.add(k)
    }
  }
  /** Parallel loops that join a bank to supplies outside it: reported together per bank at the end. */
  const bankTies: Source[][] = []

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
  const fixUnknown = (list: Source[]) => {
    const open = sorted(list)
    const ret = open.filter((x) => x.refUnknown)
    const volt = open.filter((x) => !x.refUnknown)
    const parts: string[] = []
    if (volt.length) parts.push(`Give ${andList(volt.map((x) => termName(x.term)))} a voltage (set its value, or a supply in its module) to check it.`)
    if (ret.length) parts.push(`Say in the module of ${andList([...new Set(ret.map((x) => x.term.part.designator))])} which ground ${andList(ret.map((x) => x.term.label))} returns to (electrical.returns) to check it.`)
    return parts.join(' ')
  }
  const reason = (x: Source) => (x.refUnknown ? 'its return is not known' : x.unknown === 'adjustable' ? 'adjustable' : 'voltage not known')
  // A bank's one edge stands for every cell in it: each is involved.
  const involve = (given: Source[]) => {
    const list = [...new Map(given.flatMap(mates).map((s) => [s.id, s])).values()]
    return {
      parts: list.map((s) => s.term.part.uid),
      pins: list.map((s) => termPin(s.term)),
      wires: [...new Set(list.flatMap((s) => wiresOf(netOfKey(s.term.key))))],
      causes: list.map((s) => s.term.key),
    }
  }
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
      const bank = mates(s)
      const from = s.external ? ` from ${s.external.via}` : shown !== s.term ? ` from ${andList(bank.map((x) => x.term.part.designator))}` : ''
      if (bank.length > 1 && shown === s.term) return { v, text: `${andList(bank.map((x) => termName(x.term)))} (${volts(v)} in parallel)` }
      return { v, text: `${termName(shown)} (${volts(v)}${from})` }
    }
    return { v, text: `${andList(sorted(list).map((s) => termName(s.term)))} (${volts(v)} in series)` }
  }

  /**
   * The bridges among the conducting wires, found once in O(V + E) (Tarjan): the graph's nodes are
   * the node keys and its edges every join the netlist is built from. Each bridge wire maps to its
   * net and the DFS entry-order range [lo, hi) of the subtree it alone connects; `order` is each
   * key's entry index. Parallel joins are separate edges, so a doubled wire is never a bridge.
   */
  const findBridges = () => {
    const { joins } = conductors(d, plugs)
    const ids = new Map<string, number>()
    const id = (k: string) => { let i = ids.get(k); if (i === undefined) ids.set(k, (i = ids.size)); return i }
    const ends = joins.map((j) => [id(j.a), id(j.b)])
    const adj: number[][] = Array.from({ length: ids.size }, () => [])
    ends.forEach(([a, b], e) => { adj[a].push(e); adj[b].push(e) })
    const tin = new Array<number>(ids.size).fill(-1)
    const low = new Array<number>(ids.size).fill(0)
    const hi = new Array<number>(ids.size).fill(0)
    const via = new Array<number>(ids.size).fill(-1)
    let time = 0
    for (let root = 0; root < ids.size; root++) {
      if (tin[root] >= 0) continue
      tin[root] = low[root] = time++
      const stack: [number, number][] = [[root, 0]]
      while (stack.length) {
        const top = stack[stack.length - 1]
        const [v, next] = top
        if (next < adj[v].length) {
          top[1]++
          const e = adj[v][next]
          if (e === via[v]) continue
          const w = ends[e][0] === v ? ends[e][1] : ends[e][0]
          if (tin[w] >= 0) low[v] = Math.min(low[v], tin[w])
          else {
            via[w] = e
            tin[w] = low[w] = time++
            stack.push([w, 0])
          }
        } else {
          stack.pop()
          hi[v] = time
          if (stack.length) { const u = stack[stack.length - 1][0]; low[u] = Math.min(low[u], low[v]) }
        }
      }
    }
    const order = new Map<string, number>()
    for (const [k, i] of ids) order.set(k, tin[i])
    const cutAt = new Map<string, { net: string; lo: number; hi: number }>()
    for (let v = 0; v < ids.size; v++) {
      const e = via[v]
      const wire = e >= 0 ? joins[e].wire : undefined
      if (wire !== undefined && low[v] > tin[ends[e][0] === v ? ends[e][1] : ends[e][0]]) cutAt.set(wire, { net: netOfKey(joins[e].a), lo: tin[v], hi: hi[v] })
    }
    return { order, cutAt }
  }
  let bridges: ReturnType<typeof findBridges> | undefined

  /** Edges of a loop that disagrees: a voltage whose path uses one of them cannot be stated. */
  const broken = new Set<Edge>()
  /**
   * The wires that carry a loop: on each net the loop passes through, the wires whose removal
   * parts the terminals where the loop enters and leaves it. A wire that only touches a loop net
   * (a signal wire, a spare jumper in parallel) breaks nothing and is not offered. Broken wires
   * conduct nothing and are never in a net's wires.
   */
  const loopWires = (loop: Edge[]) => {
    const keysOn = new Map<string, string[]>()
    for (const e of loop)
      for (const k of [e.fromKey, e.toKey]) {
        if (k === undefined) continue
        const net = netOfKey(k)
        if (net.startsWith('#')) keysOn.set(net, [...(keysOn.get(net) ?? []), k])
      }
    const { order, cutAt } = (bridges ??= findBridges())
    const cuts: Connection[] = []
    const candidates = [...new Set([...keysOn.keys()].flatMap(wiresOf))]
    for (const uid of candidates) {
      // Removing a wire can only part its own net, and only when it is a bridge: then exactly the
      // keys in the subtree below it are cut off from the rest.
      const cut = cutAt.get(uid)
      const keys = cut && keysOn.get(cut.net)
      if (keys) {
        const below = keys.filter((k) => { const i = order.get(k)!; return i >= cut.lo && i < cut.hi }).length
        if (below > 0 && below < keys.length) cuts.push(d.connections.find((c) => c.uid === uid)!)
      }
      if (cuts.length > 3) break
    }
    const end = (ep: Endpoint) => { const t = terminal(nodeKey(ep.part, ep.pin)); return t ? termName(t) : endpointName(d, ep) }
    const names = cuts.map((c) => `${end(c.from)} to ${end(c.to)}`).sort(natural.compare)
    return names.length && names.length <= 3 ? `Remove one of these wires: ${orList(names).replace(/ or /, ', or ')}.` : 'Remove one of the wires that close the loop.'
  }
  const loopShort = (all: Source[], loop: Edge[]) =>
    add({ rule: 'short', subject: all[0].term.part.designator, target: termName(all[0].term),
      message: `${andList(all.map((s) => termName(s.term)))} are wired in a loop, each + to the next -: short circuit. Nothing limits the current, so they can overheat. ${loopWires(loop)}`, ...involve(all) })
  /** Loops of supplies: shorted stacks, fights, parallels. `only` limits it to loops through those edges. */
  const analyseLoops = (only?: Set<Edge>) => {
  for (const i of loops) {
    const e = edges[i]
    const around = [{ e, forward: true }, ...path(e.to, e.from)]
    if (only && !around.some((x) => only.has(x.e))) continue
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
    if (mismatch) tie(all)
    if (mismatch && (!ahead.length || !back.length)) {
      loopShort(all, around.map((x) => x.e))
    } else if (mismatch) {
      const [a, b] = [side(ahead), side(back)]
      const [hi, lo] = a.v >= b.v ? [a, b] : [b, a]
      const lead = (a.v >= b.v ? sorted(ahead) : sorted(back))[0]
      const two = ahead.length === 1 && back.length === 1 && !all.some((s) => bankOf.has(s.id))
      const fix = two ? removeWire(d, shownPin(ahead[0]), shownPin(back[0]), 'Separate them.') : 'Separate them.'
      add({ rule: 'supplies-fight', subject: lead.term.part.designator, target: termName(lead.term),
        message: `${hi.text} and ${lo.text} are wired together: the ${two ? 'two ' : ''}supplies fight, and the higher one drives current into the lower one, which can damage both. ${fix}`, ...involve(all) })
    } else if (ahead.length && back.length) {
      // A bank is one edge, so a loop through it always meets another supply.
      if (all.some((s) => bankOf.has(s.id))) {
        tie(all)
        bankTies.push(all)
        continue
      }
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
  }
  analyseLoops()

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
    // A bank is named by all its cells.
    const cells = low && isCell(low) ? andList(mates(under[0]).map((s) => s.term.part.designator)) : undefined
    const name = low ? (cells ?? supplyName(low)) : what
    const harm = low && isCell(low) ? 'the cells' : under.length > 1 ? 'them' : 'it'
    const fix = low && isCell(low)
      ? `Add a diode from ${termName(low)} to ${pin.label}, or unplug ${cells} before plugging in ${ext.via}.`
      : low ? removeWire(d, pin, low, `Do not wire ${termName(low)} to ${termName(pin)}.`) : `Do not wire ${what} to ${termName(pin)}.`
    return `When ${ext.via} is plugged in, ${termName(pin)} gets ${volts(ext.volts)} from ${ext.via}, which pushes current back into ${name} (${volts(v)}) and can damage ${harm}. ${fix}`
  }

  // USB pins behind a diode only raise their net. Resolved in two steps, independent of the order
  // of parts and wires:
  // 1. Groups of the walk so far move as rigid bodies. A diode pin whose net and board ground are
  //    in different groups lifts its net's group to at least its own voltage; every such group
  //    settles at the highest lift (a fixed point over all diode pins, so one diode-fed group can
  //    lift another). The diode that sets a group's level (ties broken by designator) conducts and
  //    joins the two groups; the others are off.
  // 2. After walking again, every diode pin that does not conduct is a load: fine at or above its
  //    USB voltage up to its own limit, and below it (possible only when the rest of the sheet
  //    holds its net over the same ground) USB pushes current into what holds the net down.
  // A net no supply edge reaches (a USB pin wired only to other USB pins and loads) is a group of
  // its own at local potential 0, so a diode's level is its real voltage over its ground's offset.
  const level = (e: Edge) => {
    const [a, b] = [pot.get(e.from) ?? lin0(), pot.get(e.to) ?? lin0()]
    return !a.u.size && !b.u.size ? a.c + e.v! - b.c : null
  }
  // Designator order breaks ties between diodes at one level, so what a message names does not
  // hang on uids; the pin key only settles duplicate designators.
  const cross = [...diodes].sort((x, y) => natural.compare(termName(x.src!.term), termName(y.src!.term)) || (x.src!.term.key < y.src!.term.key ? -1 : 1))
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
    // Loops closed by the conducting diodes (crossed power leads between boards) are checked
    // like any other.
    analyseLoops(conducting)
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
    if (diff.u.size || diff.c < ext.volts - EPS) tie(under)
    if (diff.u.size) {
      const open = [...diff.u.keys()].map((id) => sources.get(id)!)
      add({ rule: 'supply-unknown', message: `${termName(pin)} voltage depends on ${andList(sorted(open).map((x) => `${termName(x.term)} (${reason(x)})`))} and cannot be checked. ${fixUnknown(open)}`, ...base })
    } else if (diff.c < -EPS)
      // The supplies on the way point the same way round as USB: a shorted loop.
      loopShort(sorted([s, ...under]), [e, ...way.map((x) => x.e)])
    else if (diff.c < ext.volts - EPS)
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
    tie(list)
    add({ rule: 'supplies-parallel', subject: list[0].term.part.designator, target: termName(list[0].term),
      message: `${andList(list.map(sourceName))} are ${list.length === 2 ? 'two' : list.length} supplies tied together; power this net from one of them.`, ...involve(list) })
  }

  // Banks tied to other supplies: one warning per group of banks tied together, naming every cell
  // and every supply the loops reach, whichever loops the walk happened to find.
  const groups: { banks: Set<string>; list: Map<string, Source> }[] = []
  for (const all of bankTies) {
    const banks = new Set(all.map((s) => bankOf.get(s.id)).filter((k): k is string => k !== undefined))
    const list = new Map(all.map((s) => [s.id, s]))
    for (const g of groups.filter((x) => [...x.banks].some((k) => banks.has(k)))) {
      for (const k of g.banks) banks.add(k)
      for (const [id, s] of g.list) list.set(id, s)
      groups.splice(groups.indexOf(g), 1)
    }
    for (const k of banks) for (const s of bankCells.get(k)!) list.set(s.id, s)
    groups.push({ banks, list })
  }
  for (const g of groups) {
    const list = sorted([...g.list.values()])
    add({ rule: 'supplies-parallel', subject: list[0].term.part.designator, target: termName(list[0].term),
      message: `${andList(list.map(sourceName))} are ${list.length === 2 ? 'two' : list.length} supplies tied together; power this net from one of them.`, ...involve(list) })
  }
  // A bank tied to nothing else: one note, the cells named as a range when they run in order.
  for (const [k, cells] of bankCells) {
    if (cells.length < 2 || tiedBanks.has(k)) continue
    const list = sorted(cells)
    const name = cellRange(list.map((s) => s.term.part.designator))
    const grounds = list.map((s) => terminal(nodeKey(s.term.part.uid, s.term.info.returnOf.get(s.term.name)!))!)
    add({ rule: 'battery-bank', subject: list[0].term.part.designator, target: name,
      message: `${name} form a parallel battery bank (${list.length}P, ${volts(list[0].v!)}). Charge every cell to the same voltage, within about 0.1 V, before connecting them, and use matching cells.`,
      parts: list.map((s) => s.term.part.uid),
      pins: [...list.map((s) => termPin(s.term)), ...grounds.map(termPin)],
      wires: [...new Set([...wiresOf(netOfKey(list[0].term.key)), ...wiresOf(netOfKey(grounds[0].key))])],
      causes: list.map((s) => s.term.key) })
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
      // A load whose own grounds are all on mains is not placed (rule 1 reports that part).
      if (t.info.grounds.length && t.info.grounds.every((g) => skip(nodeKey(t.part.uid, g)))) continue
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
      const base = (given: Source[]) => {
        // A bank's one edge stands for every cell in it.
        const list = [...new Map(given.flatMap(mates).map((s) => [s.id, s])).values()]
        return {
          subject: t.part.designator, target: termName(t), wires: netWires[i],
          parts: [t.part.uid, ...list.map((s) => s.term.part.uid)], pins: [termPin(t), ...list.map((s) => termPin(s.term))], causes: [t.key, ...list.map((s) => s.term.key)],
        }
      }
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
          const cells = from.length === 1 && isCell(from[0].term) ? mates(from[0]).map((s) => s.term.part.designator) : []
          const message = x && y && cells.length
            ? `${andList(cells)} ${cells.length > 1 ? 'are' : 'is'} wired in backwards: ${termName(t)} is wired to ${termName(x)} and ${termName(g)} to ${termName(y)}. This will damage ${t.part.designator}. Swap the two wires.`
            : x && y
            ? `${termName(t)} is wired to ${termName(x)} and ${termName(g)} to ${termName(y)}: the power is reversed and will damage ${t.part.designator}. Swap the two wires.`
            : `${termName(t)} sits ${volts(-v)} below ${termName(g)}: the power is reversed and will damage ${t.part.designator}. Swap its power wires.`
          reversed.add(t.part.uid)
          add({ rule: 'reversed', message, ...base(from), pins: [termPin(t), termPin(g), ...from.flatMap(mates).map((s) => termPin(s.term))], wires: [...netWires[i], ...wiresOf(ground)] })
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
      const what = from.length === 1 ? fromName(from[0]) : `${andList(from.map((s) => termName(s.term)))} in series`
      if (v !== null && v > max + EPS) {
        add({ rule: 'supply-too-high', message: tooHigh(t, max, v, from, what), ...base(from) })
        continue
      }
      // Until parts carry real ranges, an input takes down to 90% of its lowest rail (3.0 V for a
      // 3.3 V part, 4.5 V for a 5 V one).
      const floor = LOW_TOLERANCE * min
      if (v !== null && !unknown.length && v < floor - EPS)
        add({ rule: 'supply-too-low', message: `${termName(t)} needs at least ${floor.toFixed(1)} V; ${what} ${from.length === 1 && mates(from[0]).length === 1 ? 'gives' : 'give'} only ${volts(v)}. ${fixTo(from, min)}`, ...base(from) })
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
    case 'no-fit':
      return `${p.designator} does not fit ${at}: an outlet takes only a matching plug, and a plug fits only a matching outlet, so it connects nothing. Drag it off, or use a part that fits.`
    case 'obscured':
      return `Some legs of ${p.designator} sit under another board drawn over ${at}, so none of its legs connect. Move it clear of that board.`
    case 'conflict':
      return `A leg of ${p.designator} needs a hole of ${at} that another part's leg already fills, so none of its legs connect. Move one of them.`
  }
}
