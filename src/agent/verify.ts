// Electrical equivalence (agent toolkit spec section 3): a sheet against its `intent`. Inventory
// (parts, modules, effective values, seated mounts, extra parts), connectivity (missing
// connections, unintended merges, extra connections, nc) and terminal capacity on the realized
// diagram. Two component pins are connected when a path of wires, strips, internal joins or plugs
// joins them; strips, rails and `routing` wires are infrastructure and never count as extra
// endpoints themselves, and a pin whose only neighbours are infrastructure is unconnected. Pure.
import { type Diagram, type Endpoint, type PartInstance, moduleOf } from '../format/diagram.ts'
import { mountIssues, plugsOf } from '../format/breadboard.ts'
import { PARAM_RULES, isBoard, isObj, type ModuleDef, terminalCapacity, validParamValue } from '../format/module.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { endpointName } from '../format/checks.ts'
import { formatValue } from '../format/values.ts'
import { type Intent, type IntentPart, type ModuleLookup, type Terminal, parseNetlist } from './netlist.ts'
import { internalComponent } from './internal.ts'

export type VerifyRule =
  | 'intent' | 'part-missing' | 'part-duplicate' | 'module-mismatch' | 'module-missing' | 'value-drift' | 'mount' | 'extra-part'
  | 'missing-connection' | 'merge' | 'extra-connection' | 'nc' | 'capacity'
const ORDER: VerifyRule[] = ['intent', 'part-missing', 'part-duplicate', 'module-mismatch', 'module-missing', 'value-drift', 'mount', 'extra-part', 'missing-connection', 'merge', 'extra-connection', 'nc', 'capacity']

export interface VerifyFinding {
  /** The rule plus what causes it, so it stays the same while the problem does. */
  id: string
  rule: VerifyRule
  severity: 'error'
  message: string
  /** Part uids, pins and wire uids to highlight. */
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

export const NO_INTENT = 'no intent: lay out from a netlist or add intent'

type Draft = Omit<VerifyFinding, 'id' | 'severity'> & { causes: string[] }
type Add = (rule: VerifyRule, message: string, causes: string[], more?: { parts?: string[]; pins?: Endpoint[]; wires?: string[] }) => void

/**
 * How a sheet's intent finds its modules: the sheet's embedded copy first (so a later library
 * change never breaks an old sheet), then the library. Ids the intent embeds itself are left to it.
 */
export function intentLookup(d: Diagram, library: ModuleLookup): ModuleLookup {
  const own = isObj(d.intent) && isObj(d.intent.modules) ? new Set(Object.keys(d.intent.modules)) : new Set<string>()
  return (id) => (own.has(id) ? undefined : (moduleOf(d, id) ?? library(id)))
}

export function verifyDiagram(d: Diagram, library: ModuleLookup): VerifyFinding[] {
  const found: Draft[] = []
  const add: Add = (rule, message, causes, more = {}) => found.push({ rule, message, causes, parts: more.parts ?? [], pins: more.pins ?? [], wires: more.wires ?? [] })
  if (d.intent === undefined) add('intent', NO_INTENT, ['intent'])
  else {
    const r = parseNetlist(d.intent, intentLookup(d, library))
    if (!r.ok) add('intent', `intent is not a valid netlist: ${r.errors.slice(0, 5).join('; ')}${r.errors.length > 5 ? ` (and ${r.errors.length - 5} more)` : ''}`, ['intent'])
    else against(d, r.intent, add)
  }
  capacity(d, add)
  found.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0))
  const seen = new Map<string, number>()
  return found.map(({ causes, ...f }) => {
    const base = `${f.rule}|${[...new Set(causes)].sort().join(',')}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: n ? `${base}#${n}` : base, severity: 'error' as const, ...f }
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
 * compared as stored, in both directions.
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
  return out
}

function against(d: Diagram, intent: Intent, add: Add) {
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
    if (!refs.has(p.designator) && !isBoard(moduleOf(d, p.module))) add('extra-part', `${p.designator} (${p.module}) is on the sheet but not in the intent.`, [p.uid], { parts: [p.uid] })
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
    return !!m && !isBoard(m)
  }
  const compOf = (k: string) => {
    const [uid, pin] = split(k)
    const m = moduleOf(d, partBy.get(uid)!.module)!
    return `${uid}|${internalComponent(m, pin)}`
  }
  const ncKeys = new Set(intent.nc.map(keyOf).filter((k): k is string => k !== null))
  for (const keys of nl.nets) {
    const members = keys.filter(component)
    const requested = new Set(members.filter((k) => want.has(k)).map(compOf))
    for (const k of members) {
      if (want.has(k)) continue
      if (!ncKeys.has(k) && requested.has(compOf(k))) continue
      const others = members.filter((o) => compOf(o) !== compOf(k))
      if (!others.length) continue
      const more = others.length > 1 ? ` and ${others.length - 1} more` : ''
      if (ncKeys.has(k)) add('nc', `${nameOf(k)} must stay unconnected (nc) but is connected to ${nameOf(others[0])}${more}.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
      else add('extra-connection', `${nameOf(k)} is connected to ${nameOf(others[0])}${more}, but the intent does not connect it.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
    }
  }
}

/** Every pin, pad and hole holds no more wire ends and legs than it takes (spec 2.2 and 3). */
function capacity(d: Diagram, add: Add) {
  const plugs = plugsOf(d)
  const legOf = new Map(plugs.map((pl) => [nodeKey(pl.part, pl.pin), pl]))
  const broken = new Set(netlist(d, plugs).broken)
  const slots = new Map<string, { what: string; cap: number; legs: number; wires: string[]; part: string }>()
  const slot = (key: string, what: string, cap: number, part: string) => {
    let s = slots.get(key)
    if (!s) slots.set(key, (s = { what, cap, legs: 0, wires: [], part }))
    return s
  }
  const holeSlot = (board: string, group: string, hole: number) =>
    slot(JSON.stringify(['hole', board, group, hole]), endpointName(d, { part: board, pin: group, hole }), 1, board)
  for (const pl of plugs) holeSlot(pl.board, pl.group, pl.hole).legs++
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  for (const c of d.connections) {
    if (broken.has(c.uid)) continue
    for (const ep of [c.from, c.to]) {
      const part = partBy.get(ep.part)!
      const m = moduleOf(d, part.module)!
      const group = m.holes?.find((g) => g.name === ep.pin)
      if (group && isBoard(m)) holeSlot(ep.part, ep.pin, ep.hole ?? 0).wires.push(c.uid)
      else if (group) slot(JSON.stringify(['pad', ep.part, ep.pin, ep.hole ?? 0]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
      else {
        const leg = legOf.get(nodeKey(ep.part, ep.pin))
        if (leg) holeSlot(leg.board, leg.group, leg.hole).wires.push(c.uid)
        else slot(JSON.stringify(['pin', ep.part, ep.pin]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
      }
    }
  }
  for (const [key, s] of slots) {
    if (s.legs + s.wires.length <= s.cap) continue
    const ends = `${s.wires.length} wire end${s.wires.length === 1 ? '' : 's'}`
    const holds = s.legs ? `a leg and ${ends}` : ends
    add('capacity', `${s.what} holds ${holds} but takes ${s.cap === 1 ? 'one' : s.cap}.`, [key], { parts: [s.part], wires: s.wires })
  }
}
