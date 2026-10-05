// Electrical equivalence (agent toolkit spec section 3): a sheet against its `intent`. Inventory
// (parts, modules, effective values, seated mounts, extra parts), connectivity (missing
// connections, unintended merges, extra connections, nc) and terminal capacity on the realized
// diagram. Two component pins are connected when a path of wires, strips, internal joins or plugs
// joins them (net labels of one name too); strips, rails, net labels and `routing` wires are infrastructure and never count as extra
// endpoints themselves, and a pin whose only neighbours are infrastructure is unconnected. Pure.
import { type Diagram, type Endpoint, type PartInstance, moduleOf } from '../format/diagram.ts'
import { holeUses, mountIssues, plugsOf } from '../format/breadboard.ts'
import { PARAM_RULES, holeGroupOf, isBoard, isNetLabel, isObj, layoutModule, type ModuleDef, moduleSettings, partSetting, terminalCapacity, validParamValue } from '../format/module.ts'
import { andList } from '../format/words.ts'
import { UPDATE_ADVICE, moduleDrift } from '../format/moduleDrift.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { coveredMessage, coveredUses, endpointName } from '../format/checks.ts'
import { formatValue } from '../format/values.ts'
import { type Intent, type IntentPart, type ModuleLookup, type Terminal, intentLookup, parseNetlist } from './netlist.ts'
import { internalComponent } from './internal.ts'

export type VerifyRule =
  | 'intent' | 'module-drift' | 'part-missing' | 'part-duplicate' | 'module-mismatch' | 'module-missing' | 'value-drift' | 'mount' | 'extra-part'
  | 'missing-connection' | 'merge' | 'extra-connection' | 'nc' | 'capacity' | 'covered-hole'
const ORDER: VerifyRule[] = ['intent', 'module-drift', 'part-missing', 'part-duplicate', 'module-mismatch', 'module-missing', 'value-drift', 'mount', 'extra-part', 'missing-connection', 'merge', 'extra-connection', 'nc', 'capacity', 'covered-hole']

export interface VerifyFinding {
  /** The rule plus what causes it, so it stays the same while the problem does. */
  id: string
  rule: VerifyRule
  /** Every finding blocks, except a stored built-in part whose copy the library only adds data to or describes differently (Ruling D1). */
  severity: 'error' | 'warning'
  message: string
  /** Part uids, pins and wire uids to highlight. */
  parts: string[]
  pins: Endpoint[]
  wires: string[]
  /**
   * Set on a blocking module-drift whose body or pin positions moved (the part must be placed
   * again): what its stored copy covers is the old drawing's, so that finding replaces covered-hole
   * for the part. Never set on warning-only or electrical-only drift. Not part of any CLI output.
   */
  redraw?: true
}

export const NO_INTENT = 'no intent: lay out from a netlist or add intent'

type Draft = Omit<VerifyFinding, 'id'> & { causes: string[] }
type Add = (rule: VerifyRule, message: string, causes: string[], more?: { parts?: string[]; pins?: Endpoint[]; wires?: string[]; severity?: VerifyFinding['severity']; redraw?: true }) => void

/**
 * Every module a sheet stores under a library id, in `modules` or in `intent.modules`, is compared
 * with the library by content (Ruling T14: the library is edited without version bumps, so the
 * version says nothing). The stored copy is what the editor draws and what verify reads, so a
 * stored BME280 with SDA and SCL swapped would otherwise verify against itself. Ruling D1 decides
 * by what changed (moduleDrift.ts): pins, holes, internal joins or geometry block; data the library
 * only adds or describes (pin caps, I2C data, a footprint, art) warns, with how to update.
 */
function driftFindings(d: Diagram, library: ModuleLookup, add: Add) {
  const own = isObj(d.intent) && isObj(d.intent.modules) ? d.intent.modules : {}
  const copies: [string, string, unknown][] = [
    ...Object.entries(d.modules).map(([id, m]): [string, string, unknown] => [id, "The sheet's copy", m]),
    ...Object.entries(own).map(([id, m]): [string, string, unknown] => [id, "The intent's embedded copy", m]),
  ]
  for (const [id, whose, raw] of copies) {
    const lib = library(id)
    if (!lib || !isObj(raw)) continue
    const drift = moduleDrift(raw as unknown as ModuleDef, lib)
    if (!drift) continue
    const parts = d.parts.filter((p) => p.module === id).map((p) => p.uid)
    const intentCopy = whose.startsWith('The intent')
    const causes = intentCopy ? [`intent:${id}`] : [id]
    const what = drift.what.join(', ')
    if (drift.kind === 'block' && drift.moved && parts.length) {
      // Ruling C2: its legs land elsewhere now, so a kept position (layout --keep) would pin it where
      // the old drawing sat; the part itself must be placed again.
      const names = andList(d.parts.filter((p) => p.module === id).map((p) => p.designator))
      const one = parts.length === 1
      add('module-drift', `${whose} of ${id} no longer matches the current library: ${what} differ. Its body and pins are drawn differently now, so ${names} must be placed again: remove ${one ? `${names}'s` : 'their'} x, y and rotation from the partial before layout --keep (kept as ${one ? 'it is, it stays' : 'they are, they stay'} where the old drawing sat), or lay the sheet out again from the netlist.`, causes, { parts, redraw: true })
    } else if (drift.kind === 'block')
      add('module-drift', `${whose} of ${id} no longer matches the current library: ${what} differ. Lay the sheet out again with the current library.`, causes, { parts })
    else
      add('module-drift', `${whose} of ${id} differs from the current library only in ${what}; its pins and connections match. ${intentCopy ? 'Lay the sheet out again to pick up the current part.' : `${UPDATE_ADVICE[0].toUpperCase()}${UPDATE_ADVICE.slice(1)}.`}`, causes, { parts, severity: 'warning' })
  }
}

/**
 * Infrastructure that the intent need not list: a real library board (strips, rails) or a net label
 * (a named flag that only joins, like a `routing` wire).
 */
function libraryBoard(d: Diagram, library: ModuleLookup, id: string): boolean {
  return moduleOf(d, id) !== undefined && (isBoard(library(id)) || isNetLabel(moduleOf(d, id)))
}


export function verifyDiagram(d: Diagram, library: ModuleLookup): VerifyFinding[] {
  const found: Draft[] = []
  const add: Add = (rule, message, causes, more = {}) => found.push({ rule, message, causes, severity: more.severity ?? 'error', parts: more.parts ?? [], pins: more.pins ?? [], wires: more.wires ?? [], ...(more.redraw ? { redraw: true as const } : {}) })
  driftFindings(d, library, add)
  if (d.intent === undefined) add('intent', NO_INTENT, ['intent'])
  else {
    const r = parseNetlist(d.intent, intentLookup(d, library))
    if (!r.ok) add('intent', `intent is not a valid netlist: ${r.errors.slice(0, 5).join('; ')}${r.errors.length > 5 ? ` (and ${r.errors.length - 5} more)` : ''}`, ['intent'])
    else against(d, r.intent, library, add)
  }
  capacity(d, add)
  covered(d, add, driftedParts(found))
  found.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0))
  const seen = new Map<string, number>()
  return found.map(({ causes, ...f }) => {
    const base = `${f.rule}|${[...new Set(causes)].sort().join(',')}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: n ? `${base}#${n}` : base, ...f }
  })
}

/** The value a part has for a param after loading: its override when valid, else the module default. */
function effective(values: Record<string, unknown> | undefined, m: ModuleDef, key: string): number | undefined {
  const rule = PARAM_RULES[key]
  const stored = values?.[key]
  const v = isObj(stored) ? stored.value : undefined
  if (isObj(stored) && stored.unit === rule.unit && validParamValue(key, v)) return v
  const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
  const param = params[key]
  const dflt = isObj(param) ? param.default : undefined
  return validParamValue(key, dflt) ? dflt : undefined
}

/** The params either module declares, in PARAM_RULES order. */
function paramKeys(...ms: ModuleDef[]): string[] {
  return Object.keys(PARAM_RULES).filter((key) =>
    ms.some((m) => isObj(m.electrical) && isObj(m.electrical.params) && Object.hasOwn(m.electrical.params, key)),
  )
}

/**
 * Every value that differs between the intent and the sheet (amendment A2). Value params compare
 * effective values on both sides (override when valid, else the module default), so an override
 * the intent lacks and a dropped override are both caught. Other part state (an LED color) is
 * compared as stored, in both directions, and settings as chosen (else the module's default).
 */
function valueDrifts(ip: IntentPart, want: ModuleDef, part: PartInstance, have: ModuleDef): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  const keys = new Set([...paramKeys(want, have), ...Object.keys(ip.values ?? {}), ...Object.keys(part.values ?? {})])
  for (const key of keys) {
    if (Object.hasOwn(PARAM_RULES, key)) {
      const unit = PARAM_RULES[key].unit
      const w = effective(ip.values, want, key)
      const h = effective(part.values, have, key)
      if (w === h) continue
      const show = (v: number | undefined) => (v === undefined ? 'not set' : formatValue(v, unit))
      out.push({ key, text: `${key} is ${show(h)} on the sheet but ${show(w)} in the intent.` })
      continue
    }
    const w = JSON.stringify(ip.values?.[key] ?? null)
    const h = JSON.stringify(part.values?.[key] ?? null)
    if (w !== h) out.push({ key, text: `${key} is ${h} on the sheet but ${w} in the intent.` })
  }
  // Enumerated settings (an OLED's I2C address, a fuse holder's fuse) compare as chosen, the module's default when unset.
  for (const key of new Set([...Object.keys(moduleSettings(want)), ...Object.keys(moduleSettings(have))])) {
    const w = partSetting(ip, want, key)
    const h = partSetting(part, have, key)
    if (w !== h) out.push({ key: `setting:${key}`, text: `setting ${key} is ${JSON.stringify(h)} on the sheet but ${JSON.stringify(w)} in the intent.` })
  }
  return out
}

function against(d: Diagram, intent: Intent, library: ModuleLookup, add: Add) {
  const byDesignator = new Map<string, PartInstance[]>()
  for (const p of d.parts) byDesignator.set(p.designator, [...(byDesignator.get(p.designator) ?? []), p])
  const uidOf = new Map<string, string>()
  for (const ip of intent.parts) {
    const list = byDesignator.get(ip.ref) ?? []
    if (!list.length) {
      add('part-missing', `${ip.ref} (${ip.module}) is in the intent but not on the sheet.`, [ip.ref])
      continue
    }
    if (list.length > 1) {
      add('part-duplicate', `${list.length} parts on the sheet are named ${ip.ref}; the intent has one.`, [ip.ref], { parts: list.map((p) => p.uid) })
      continue
    }
    const part = list[0]
    uidOf.set(ip.ref, part.uid)
    if (part.module !== ip.module) {
      add('module-mismatch', `${ip.ref} is a ${part.module} on the sheet but a ${ip.module} in the intent.`, [ip.ref], { parts: [part.uid] })
      continue
    }
    const m = moduleOf(d, part.module)
    if (!m) {
      add('module-missing', `${ip.ref}'s module "${part.module}" is not embedded in the sheet.`, [ip.ref], { parts: [part.uid] })
      continue
    }
    for (const { key, text } of valueDrifts(ip, intent.modules[ip.module] ?? m, part, m))
      add('value-drift', `${ip.ref} ${text}`, [ip.ref, key], { parts: [part.uid] })
  }
  const issues = new Map(mountIssues(d).map((i) => [i.part, i]))
  for (const ip of intent.parts) {
    if (ip.on === undefined) continue
    const uid = uidOf.get(ip.ref)
    const board = uidOf.get(ip.on)
    if (!uid || !board) continue
    const part = d.parts.find((p) => p.uid === uid)!
    if (part.mount?.board !== board) add('mount', `${ip.ref} should plug into ${ip.on} but is not mounted on it.`, [ip.ref], { parts: [uid, board] })
    else if (issues.has(uid)) add('mount', `${ip.ref} is set to plug into ${ip.on} but is not seated (${issues.get(uid)!.reason}), so its legs connect nothing.`, [ip.ref], { parts: [uid, board] })
  }
  const refs = new Set(intent.parts.map((p) => p.ref))
  for (const p of d.parts)
    if (!refs.has(p.designator) && !libraryBoard(d, library, p.module)) add('extra-part', `${p.designator} (${p.module}) is on the sheet but not in the intent.`, [p.uid], { parts: [p.uid] })
  connectivity(d, intent, uidOf, add)
}

function connectivity(d: Diagram, intent: Intent, uidOf: Map<string, string>, add: Add) {
  const nl = netlist(d)
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  const keyOf = (t: Terminal) => {
    const uid = uidOf.get(t.ref)
    return uid === undefined ? null : nodeKey(uid, t.name)
  }
  const split = (k: string) => JSON.parse(k) as [string, string]
  const pinOf = (k: string): Endpoint => ({ part: split(k)[0], pin: split(k)[1] })
  const nameOf = (k: string) => endpointName(d, pinOf(k))
  const realized = (k: string) => {
    const i = nl.netOf.get(k)
    return i === undefined ? `alone ${k}` : `net ${i}`
  }
  const want = new Map<string, number>()
  intent.nets.forEach((n, i) => n.terminals.forEach((t) => {
    const k = keyOf(t)
    if (k) want.set(k, i)
  }))

  // Missing: every endpoint of one requested net on one realized net.
  intent.nets.forEach((n) => {
    const parts = new Map<string, string[]>()
    for (const t of n.terminals) {
      const k = keyOf(t)
      if (!k) continue
      const r = realized(k)
      parts.set(r, [...(parts.get(r) ?? []), k])
    }
    if (parts.size < 2) return
    const heads = [...parts.values()].map((ks) => ks[0])
    add('missing-connection', `Net ${n.name} is not connected: ${heads.map(nameOf).join(', ')} are on ${parts.size} separate pieces.`, [n.name], { parts: heads.map((k) => split(k)[0]), pins: heads.map(pinOf) })
  })

  // Merge: endpoints of two requested nets on one realized net.
  for (const keys of nl.nets) {
    const hit = new Map<number, string>()
    for (const k of keys) {
      const i = want.get(k)
      if (i !== undefined && !hit.has(i)) hit.set(i, k)
    }
    if (hit.size < 2) continue
    const names = [...hit.keys()].map((i) => intent.nets[i].name)
    add('merge', `Nets ${names.join(' and ')} are joined on the sheet (${[...hit.values()].map(nameOf).join(', ')}); they must stay separate.`, [...names].sort(), { parts: [...hit.values()].map((k) => split(k)[0]), pins: [...hit.values()].map(pinOf) })
  }

  // Extra and nc: a component pin outside every requested net that reaches another component pin.
  const component = (k: string) => {
    const p = partBy.get(split(k)[0])
    const m = p && moduleOf(d, p.module)
    return !!m && !isBoard(m) && !isNetLabel(m)
  }
  const compOf = (k: string) => {
    const [uid, pin] = split(k)
    const m = moduleOf(d, partBy.get(uid)!.module)!
    return `${uid}|${internalComponent(m, pin)}`
  }
  const ncKeys = new Set(intent.nc.map(keyOf).filter((k): k is string => k !== null))
  // A part named like an intent ref that resolved to no single part (a duplicate) is already an
  // inventory finding; its pins are not also reported as extra connections.
  const refs = new Set(intent.parts.map((p) => p.ref))
  const unresolved = (k: string) => {
    const p = partBy.get(split(k)[0])!
    return refs.has(p.designator) && !uidOf.has(p.designator)
  }
  for (const keys of nl.nets) {
    const members = keys.filter(component)
    const requested = new Set(members.filter((k) => want.has(k)).map(compOf))
    for (const k of members) {
      if (want.has(k) || unresolved(k)) continue
      if (!ncKeys.has(k) && requested.has(compOf(k))) continue
      const others = members.filter((o) => compOf(o) !== compOf(k))
      if (!others.length) continue
      const more = others.length > 1 ? ` and ${others.length - 1} more` : ''
      if (ncKeys.has(k)) add('nc', `${nameOf(k)} must stay unconnected (nc) but is connected to ${nameOf(others[0])}${more}.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
      else add('extra-connection', `${nameOf(k)} is connected to ${nameOf(others[0])}${more}, but the intent does not connect it.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
    }
  }
}

/**
 * Every pin, pad and hole holds no more wire ends and legs than it takes (spec 2.2 and 3). Board
 * holes come from `holeUses`, which the checker's hole-shared and the editor share.
 */
function capacity(d: Diagram, add: Add) {
  const plugs = plugsOf(d)
  const plugged = new Set(plugs.map((pl) => nodeKey(pl.part, pl.pin)))
  const broken = new Set(netlist(d, plugs).broken)
  const slots = new Map<string, { what: string; cap: number; legs: number; wires: string[]; part: string }>()
  for (const u of holeUses(d, broken, plugs).values())
    slots.set(JSON.stringify(['hole', u.board, u.group, u.hole]), { what: endpointName(d, { part: u.board, pin: u.group, hole: u.hole }), cap: u.cap, legs: u.legs.length, wires: u.ends.map((e) => e.wire), part: u.board })
  const slot = (key: string, what: string, cap: number, part: string) => {
    let s = slots.get(key)
    if (!s) slots.set(key, (s = { what, cap, legs: 0, wires: [], part }))
    return s
  }
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  for (const c of d.connections) {
    if (broken.has(c.uid)) continue
    for (const ep of [c.from, c.to]) {
      const part = partBy.get(ep.part)!
      const m = moduleOf(d, part.module)!
      const group = holeGroupOf(m, ep.pin)
      // Board holes and wires to plugged legs are counted by holeUses; a net label is no terminal, it takes any number.
      if ((group && isBoard(m)) || (!group && plugged.has(nodeKey(ep.part, ep.pin))) || isNetLabel(m)) continue
      if (group) slot(JSON.stringify(['pad', ep.part, ep.pin, ep.hole ?? 0]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
      else slot(JSON.stringify(['pin', ep.part, ep.pin]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
    }
  }
  for (const [key, s] of slots) {
    if (s.legs + s.wires.length <= s.cap) continue
    const ends = `${s.wires.length} wire end${s.wires.length === 1 ? '' : 's'}`
    const holds = s.legs ? `a leg and ${ends}` : ends
    add('capacity', `${s.what} holds ${holds} but takes ${s.cap === 1 ? 'one' : s.cap}.`, [key], { parts: [s.part], wires: s.wires })
  }
}

/**
 * No wire end or leg in a hole a mounted part's body covers (see coveredHoles): the checker's
 * covered-hole, here too so verify alone (and the layout's own check) blocks it.
 */
function covered(d: Diagram, add: Add, stale: ReadonlySet<string>) {
  for (const u of coveredUses(d, new Set(netlist(d).broken))) {
    if (isStale(u, stale)) continue
    const key = JSON.stringify(['hole', u.cover.board, u.cover.group, u.cover.hole])
    if (u.wire) add('covered-hole', coveredMessage(d, u), [key, u.wire], { parts: [u.cover.board, u.cover.by], wires: [u.wire] })
    else add('covered-hole', coveredMessage(d, u), [key, u.leg!.part], { parts: [u.leg!.part, u.cover.by, u.cover.board], pins: [{ part: u.leg!.part, pin: u.leg!.pin }] })
  }
}

/**
 * The parts whose embedded module drifted from the library so far that they must be placed again
 * (a blocking module-drift whose body or pin positions moved): whatever their stored copy covers,
 * and whatever their legs land in, is the old drawing's, and that blocking finding replaces it.
 * Warning-only (cosmetic) drift and electrical drift with an unchanged body replace nothing: the
 * holes their bodies cover are covered as drawn, so covered-hole still reports them.
 */
export function driftedParts(findings: { rule: string; severity: string; parts: string[]; redraw?: true }[]): Set<string> {
  return new Set(findings.filter((f) => f.rule === 'module-drift' && f.severity === 'error' && f.redraw).flatMap((f) => f.parts))
}

/** A covered-hole use that comes from a stale embedded copy: its covering part, or its leg's part, drifted. */
const isStale = (u: { cover: { by: string }; leg?: { part: string } }, stale: ReadonlySet<string>) =>
  stale.has(u.cover.by) || (!!u.leg && stale.has(u.leg.part))
