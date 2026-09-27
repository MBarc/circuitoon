// Mains data on a module (spec docs/superpowers/specs/2026-09-27-mains-outlets-design.md, sections
// 1 and 2): AC sources, how mains terminals conduct, isolation domains, ratings, contact groups,
// earth, protective devices, plug profiles and sockets. Validation lives here (validateModule calls
// it) and so does `mainsOf`, the parsed view every mains check reads. Pure.
import { GRID, type ModuleDef, isNum, isObj } from './module.ts'

export const CONDUCTORS = ['L', 'N', 'PE'] as const
export type Conductor = (typeof CONDUCTORS)[number]
export const REQUIREMENTS = ['L', 'N', 'PE', 'line'] as const
export type Requirement = (typeof REQUIREMENTS)[number]
export const REGIONS = ['us', 'jp', 'eu', 'uk', 'au'] as const
export type Region = (typeof REGIONS)[number]
export const PLUG_FAMILIES = ['nema-5-15p', 'nema-1-15p', 'nema-1-15p-polarized', 'cee7-7', 'cee7-16', 'bs1363', 'as3112'] as const
export type PlugFamily = (typeof PLUG_FAMILIES)[number]
export const SOCKET_FAMILIES = ['nema-5-15r', 'nema-5-20r', 'nema-1-15r', 'nema-1-15r-polarized', 'cee7-3', 'cee7-5', 'cee7-16', 'bs1363', 'as3112'] as const
export type SocketFamily = (typeof SOCKET_FAMILIES)[number]
export const ISOLATIONS = ['reinforced', 'double', 'basic', 'none', 'unknown'] as const
export type Isolation = (typeof ISOLATIONS)[number]
export const CONTACT_KINDS = ['switch', 'relay', 'ssr'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]
export const DOMAIN_KINDS = ['mains', 'selv', 'pelv'] as const
export type DomainKind = (typeof DOMAIN_KINDS)[number]
const RATING_KINDS = ['insulation', 'terminal', 'switching'] as const
const SERVICES = ['ac', 'dc', 'ac/dc'] as const
const PROVENANCES = ['datasheet', 'unverified'] as const

export interface AcSource { id: string; live: string[]; neutral: string[]; earth: string[] }
export interface Conducts { pins: [string, string]; kind: 'load' | 'leakage'; range: [number, number] | null }
export interface Protective { from: string; to: string; kind: 'fuse'; rating: number | null }
export interface Domain { name: string; pins: string[]; kind: DomainKind }
export interface AcInput { a: string; b: string; range: [number, number] }
export interface Rating {
  pins: string[]
  kind: (typeof RATING_KINDS)[number]
  service: (typeof SERVICES)[number]
  volts: number
  amps: number | null
  provenance: (typeof PROVENANCES)[number]
  conditions: string | null
}
export interface Pole { com: string; no: string | null; nc: string | null }
export interface ContactGroup { id: string; kind: ContactKind; poles: Pole[] }
export interface PlugContact { pin: string; at: { x: number; y: number }; mains: Conductor }
export interface PlugProfile { id: string; contacts: PlugContact[] }
export interface PlugDef { family: PlugFamily; profiles: PlugProfile[] }
export interface SocketContact { group: string; role: Conductor }
export interface SocketDef { id: string; family: SocketFamily; contacts: SocketContact[] }

export interface MainsInfo {
  /** True when the module declares any mains data at all. */
  any: boolean
  internalNodes: string[]
  acSources: AcSource[]
  region: Region | null
  hz: number | null
  conducts: Conducts[]
  protective: Protective[]
  domains: Domain[]
  domainOf: Map<string, Domain>
  isolation: Isolation | null
  isolationProvenance: 'datasheet' | 'unverified'
  safeguard: 'protective-screen' | null
  acInput: AcInput | null
  ratings: Rating[]
  contacts: ContactGroup[]
  /** Terminals named in any contact pole. */
  contactTerminals: Set<string>
  protection: 'class-1' | 'class-2' | null
  plug: PlugDef | null
  sockets: SocketDef[]
  requirement: Map<string, Requirement>
  bonds: Set<string>
  /** Every terminal the module declares for mains (spec 1.4): named in a source, conduction, fuse, mains domain, AC input, contact, plug, socket or rating, or carrying a requirement. */
  terminals: Set<string>
  /** Terminals whose conduction the module declares (spec 1.2); a mains terminal outside this set is treated conservatively. */
  declaredConduction: Set<string>
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v !== ''
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const words = (list: readonly string[]) => list.map((x) => `"${x}"`).join(', ')

/** `electrical.internalNodes`: named terminals inside the part (a plug's prongs), added to `names`. */
export function claimInternalNodes(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el) || el.internalNodes === undefined) return
  if (!Array.isArray(el.internalNodes)) return void errors.push('electrical.internalNodes: must be a list of names')
  el.internalNodes.forEach((n, i) => {
    if (!isStr(n)) errors.push(`electrical.internalNodes[${i}]: must be a name`)
    else if (names.has(n)) errors.push(`electrical.internalNodes[${i}]: duplicate name "${n}" (pins, hole groups and internal nodes share one namespace)`)
    else names.add(n)
  })
}

/** Checks every mains field of `electrical` against `names` (pins, hole groups and internal nodes). */
export function validateMains(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el)) return
  const nodes = new Set(Array.isArray(el.internalNodes) ? el.internalNodes.filter(isStr) : [])
  const term = (v: unknown, at: string) => {
    if (!isStr(v) || !names.has(v)) errors.push(`${at}: no pin, hole group or internal node named "${String(v)}"`)
  }
  const termList = (v: unknown, at: string) => {
    if (!Array.isArray(v) || v.length === 0) return void errors.push(`${at}: must be a list of 1 or more terminal names`)
    v.forEach((n, i) => term(n, `${at}[${i}]`))
  }
  const acRange = (v: unknown, at: string) => {
    if (!(Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] >= 1 && v[0] <= v[1] && v[1] <= 1000))
      errors.push(`${at}: must be [min, max] in volts AC, from 1 to 1000, min not above max`)
  }
  const each = (key: string, check: (x: Record<string, unknown>, at: string) => void) => {
    const v = el[key]
    if (v === undefined) return
    if (!Array.isArray(v)) return void errors.push(`electrical.${key}: must be a list`)
    v.forEach((x, i) => (isObj(x) ? check(x, `electrical.${key}[${i}]`) : errors.push(`electrical.${key}[${i}]: must be an object`)))
  }
  const named = (seen: Set<string>, v: unknown, at: string) => {
    if (!isStr(v)) errors.push(`${at}: required, a name`)
    else if (seen.has(v)) errors.push(`${at}: duplicate "${v}"`)
    else seen.add(v)
  }

  const sourceIds = new Set<string>()
  each('acSources', (s, at) => {
    named(sourceIds, s.id, `${at}.id`)
    termList(s.live, `${at}.live`)
    termList(s.neutral, `${at}.neutral`)
    if (s.earth !== undefined) termList(s.earth, `${at}.earth`)
  })
  if (Array.isArray(el.acSources) && el.acSources.length) {
    if (!(isObj(el.params) && isObj(el.params.acVoltage))) errors.push('electrical.acSources: needs an acVoltage param (electrical.params.acVoltage), the source voltage')
    if (el.ac === undefined) errors.push('electrical.ac: required with acSources ({ "hz", "region" })')
  }
  if (el.ac !== undefined && !(isObj(el.ac) && isNum(el.ac.hz) && el.ac.hz > 0 && oneOf(REGIONS, el.ac.region)))
    errors.push(`electrical.ac: must be { "hz": <above 0>, "region": one of ${words(REGIONS)} }`)

  each('conducts', (c, at) => {
    if (!(Array.isArray(c.pins) && c.pins.length === 2 && c.pins[0] !== c.pins[1])) errors.push(`${at}.pins: must be two different terminal names`)
    else c.pins.forEach((n, i) => term(n, `${at}.pins[${i}]`))
    if (c.kind !== 'load' && c.kind !== 'leakage') errors.push(`${at}.kind: must be "load" or "leakage"`)
    if (c.range !== undefined) acRange(c.range, `${at}.range`)
  })

  each('protective', (e, at) => {
    term(e.from, `${at}.from`)
    term(e.to, `${at}.to`)
    if (isStr(e.from) && e.from === e.to) errors.push(`${at}: from and to must differ`)
    if (e.kind !== 'fuse') errors.push(`${at}.kind: must be "fuse"`)
    if (e.rating !== undefined && !(isNum(e.rating) && e.rating > 0 && e.rating <= 100)) errors.push(`${at}.rating: must be a number of amps, above 0, up to 100`)
  })

  const domainNames = new Set<string>()
  const inDomain = new Map<string, string>()
  each('domains', (x, at) => {
    named(domainNames, x.name, `${at}.name`)
    if (!oneOf(DOMAIN_KINDS, x.kind)) errors.push(`${at}.kind: must be "mains", "selv" or "pelv"`)
    termList(x.pins, `${at}.pins`)
    if (Array.isArray(x.pins))
      for (const n of x.pins) {
        if (!isStr(n)) continue
        if (inDomain.has(n)) errors.push(`${at}.pins: "${n}" is already in domain "${inDomain.get(n)}"`)
        else inDomain.set(n, String(x.name))
      }
  })
  if (el.isolation !== undefined && !oneOf(ISOLATIONS, el.isolation)) errors.push(`electrical.isolation: must be one of ${words(ISOLATIONS)}`)
  if (el.isolationProvenance !== undefined && !oneOf(PROVENANCES, el.isolationProvenance)) errors.push('electrical.isolationProvenance: must be "datasheet" or "unverified"')
  if (el.safeguard !== undefined && el.safeguard !== 'protective-screen') errors.push('electrical.safeguard: must be "protective-screen"')

  if (el.acInput !== undefined) {
    const a = el.acInput
    if (!isObj(a)) errors.push('electrical.acInput: must be { "a", "b", "range": [min, max] }')
    else {
      term(a.a, 'electrical.acInput.a')
      term(a.b, 'electrical.acInput.b')
      if (isStr(a.a) && a.a === a.b) errors.push('electrical.acInput: a and b must differ')
      acRange(a.range, 'electrical.acInput.range')
    }
  }

  each('ratings', (r, at) => {
    termList(r.pins, `${at}.pins`)
    if (!oneOf(RATING_KINDS, r.kind)) errors.push(`${at}.kind: must be "insulation", "terminal" or "switching"`)
    if (!oneOf(SERVICES, r.service)) errors.push(`${at}.service: must be "ac", "dc" or "ac/dc"`)
    if (!(isNum(r.volts) && r.volts > 0)) errors.push(`${at}.volts: must be a number above 0`)
    if (r.amps !== undefined && !(isNum(r.amps) && r.amps > 0)) errors.push(`${at}.amps: must be a number above 0`)
    if (!oneOf(PROVENANCES, r.provenance)) errors.push(`${at}.provenance: must be "datasheet" or "unverified"`)
    if (r.conditions !== undefined && !isStr(r.conditions)) errors.push(`${at}.conditions: must be a non-empty string`)
  })

  const contactIds = new Set<string>()
  each('contacts', (c, at) => {
    named(contactIds, c.id, `${at}.id`)
    if (!oneOf(CONTACT_KINDS, c.kind)) errors.push(`${at}.kind: must be "switch", "relay" or "ssr"`)
    if (!Array.isArray(c.poles) || !c.poles.length) return void errors.push(`${at}.poles: must be a list of 1 or more { "com", "no"?, "nc"? }`)
    c.poles.forEach((pole, j) => {
      const pat = `${at}.poles[${j}]`
      if (!isObj(pole)) return void errors.push(`${pat}: must be an object`)
      term(pole.com, `${pat}.com`)
      if (pole.no !== undefined) term(pole.no, `${pat}.no`)
      if (pole.nc !== undefined) term(pole.nc, `${pat}.nc`)
      if (pole.no === undefined && pole.nc === undefined) errors.push(`${pat}: needs "no", "nc" or both`)
      else if (c.kind === 'ssr' && (pole.no === undefined || pole.nc !== undefined)) errors.push(`${pat}: an SSR pole has "no" only (its OFF state is a leakage path)`)
    })
  })

  if (el.protection !== undefined) {
    const pe = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])].some((p) => isObj(p) && p.mains === 'PE')
    if (el.protection !== 'class-1' && el.protection !== 'class-2') errors.push('electrical.protection: must be "class-1" or "class-2"')
    else if (el.protection === 'class-1' && !pe) errors.push('electrical.protection: a class 1 part needs a terminal marked "mains": "PE"')
  }

  if (el.plug !== undefined) {
    const p = el.plug
    if (!isObj(p)) errors.push('electrical.plug: must be { "family", "profiles": [...] }')
    else {
      if (!oneOf(PLUG_FAMILIES, p.family)) errors.push(`electrical.plug.family: must be one of ${words(PLUG_FAMILIES)}`)
      if (raw.obstacle === false) errors.push('electrical.plug: a plug-in device cannot be a board ("obstacle": false)')
      if (!Array.isArray(p.profiles) || !p.profiles.length) errors.push('electrical.plug.profiles: must be a list of 1 or more profiles')
      else {
        const seen = new Set<string>()
        p.profiles.forEach((pr, i) => {
          const at = `electrical.plug.profiles[${i}]`
          if (!isObj(pr)) return void errors.push(`${at}: must be an object`)
          named(seen, pr.id, `${at}.id`)
          if (!Array.isArray(pr.contacts) || !pr.contacts.length) return void errors.push(`${at}.contacts: must be a list of 1 or more contacts`)
          pr.contacts.forEach((c, j) => {
            const cat = `${at}.contacts[${j}]`
            if (!isObj(c)) return void errors.push(`${cat}: must be an object`)
            if (!isStr(c.pin) || !nodes.has(c.pin)) errors.push(`${cat}.pin: must name an internal node (electrical.internalNodes), the prong`)
            if (!(isObj(c.at) && isNum(c.at.x) && isNum(c.at.y) && c.at.x % GRID === 0 && c.at.y % GRID === 0)) errors.push(`${cat}.at: must be { "x", "y" } on the 10 px grid`)
            if (!oneOf(CONDUCTORS, c.mains)) errors.push(`${cat}.mains: must be "L", "N" or "PE"`)
          })
        })
      }
    }
  }

  if (el.sockets !== undefined) {
    const holes = (Array.isArray(raw.holes) ? raw.holes : []).filter(isObj).map((g) => g.name).filter(isStr)
    if (!(raw.obstacle === false && holes.length)) errors.push('electrical.sockets: only a board (hole groups and "obstacle": false) has sockets')
    const owner = new Map<string, string>()
    const ids = new Set<string>()
    each('sockets', (s, at) => {
      named(ids, s.id, `${at}.id`)
      if (!oneOf(SOCKET_FAMILIES, s.family)) errors.push(`${at}.family: must be one of ${words(SOCKET_FAMILIES)}`)
      if (!Array.isArray(s.contacts) || !s.contacts.length) return void errors.push(`${at}.contacts: must be a list of { "group", "role" }`)
      const roles = new Set<string>()
      s.contacts.forEach((c, j) => {
        const cat = `${at}.contacts[${j}]`
        if (!isObj(c)) return void errors.push(`${cat}: must be an object`)
        if (!isStr(c.group) || !holes.includes(c.group)) errors.push(`${cat}.group: no hole group named "${String(c.group)}"`)
        else if (owner.has(c.group)) errors.push(`${cat}.group: "${c.group}" already belongs to socket "${owner.get(c.group)}"`)
        else owner.set(c.group, String(s.id))
        if (!oneOf(CONDUCTORS, c.role)) errors.push(`${cat}.role: must be "L", "N" or "PE"`)
        else if (roles.has(c.role)) errors.push(`${cat}.role: this socket already has a ${c.role} contact`)
        else roles.add(c.role)
      })
      if (!roles.has('L') || !roles.has('N')) errors.push(`${at}.contacts: needs an L and an N contact`)
    })
    if (Array.isArray(el.sockets) && raw.obstacle === false)
      for (const h of holes) if (!owner.has(h)) errors.push(`holes: group "${h}" belongs to no socket (on an outlet every hole group is a socket contact)`)
  }
}

/** Protective separation (spec 1.3): reinforced or double isolation, or basic plus a declared protective screen. Earthing never substitutes for it. */
export function isolationAdequate(info: MainsInfo): boolean {
  return info.isolation === 'reinforced' || info.isolation === 'double' || (info.isolation === 'basic' && info.safeguard === 'protective-screen')
}

/** Pins and hole groups that no domain covers and the module does not declare for mains (Resolution 27: treated as live on a converter). */
export function uncoveredPins(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => ('name' in p && typeof p.name === 'string' ? [p.name] : [])), ...(m.holes ?? []).map((h) => h.name)]
    .filter((n) => !info.domainOf.has(n) && !info.terminals.has(n))
}

const cache = new WeakMap<ModuleDef, MainsInfo>()

/** The module's mains data, parsed once (modules are never mutated after load). Assumes a validated module. */
export function mainsOf(m: ModuleDef): MainsInfo {
  const hit = cache.get(m)
  if (hit) return hit
  const el: Record<string, unknown> = isObj(m.electrical) ? m.electrical : {}
  const list = (k: string) => (Array.isArray(el[k]) ? (el[k] as unknown[]).filter(isObj) : [])
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : [])
  const internalNodes = strs(el.internalNodes)
  const acSources = list('acSources').map((s) => ({ id: String(s.id), live: strs(s.live), neutral: strs(s.neutral), earth: strs(s.earth) }))
  const ac = isObj(el.ac) ? el.ac : null
  const conducts = list('conducts').map((c) => ({ pins: strs(c.pins) as [string, string], kind: c.kind as 'load' | 'leakage', range: Array.isArray(c.range) ? (c.range as [number, number]) : null }))
  const protective = list('protective').map((e) => ({ from: String(e.from), to: String(e.to), kind: 'fuse' as const, rating: isNum(e.rating) ? e.rating : null }))
  const domains = list('domains').map((x) => ({ name: String(x.name), pins: strs(x.pins), kind: x.kind as DomainKind }))
  const domainOf = new Map<string, Domain>()
  for (const x of domains) for (const p of x.pins) domainOf.set(p, x)
  const acInput = isObj(el.acInput) ? { a: String(el.acInput.a), b: String(el.acInput.b), range: el.acInput.range as [number, number] } : null
  const ratings = list('ratings').map((r) => ({
    pins: strs(r.pins), kind: r.kind as Rating['kind'], service: r.service as Rating['service'], volts: Number(r.volts),
    amps: isNum(r.amps) ? r.amps : null, provenance: r.provenance as Rating['provenance'], conditions: isStr(r.conditions) ? r.conditions : null,
  }))
  const contacts = list('contacts').map((c) => ({
    id: String(c.id), kind: c.kind as ContactKind,
    poles: (Array.isArray(c.poles) ? c.poles.filter(isObj) : []).map((p) => ({ com: String(p.com), no: isStr(p.no) ? p.no : null, nc: isStr(p.nc) ? p.nc : null })),
  }))
  const contactTerminals = new Set(contacts.flatMap((c) => c.poles.flatMap((p) => [p.com, p.no, p.nc].filter(isStr))))
  const plugRaw = isObj(el.plug) ? el.plug : null
  const plug = plugRaw
    ? {
        family: plugRaw.family as PlugFamily,
        profiles: (Array.isArray(plugRaw.profiles) ? plugRaw.profiles.filter(isObj) : []).map((pr) => ({
          id: String(pr.id),
          contacts: (Array.isArray(pr.contacts) ? pr.contacts.filter(isObj) : []).map((c) => ({ pin: String(c.pin), at: c.at as { x: number; y: number }, mains: c.mains as Conductor })),
        })),
      }
    : null
  const sockets = list('sockets').map((s) => ({
    id: String(s.id), family: s.family as SocketFamily,
    contacts: (Array.isArray(s.contacts) ? s.contacts.filter(isObj) : []).map((c) => ({ group: String(c.group), role: c.role as Conductor })),
  }))
  const requirement = new Map<string, Requirement>()
  const bonds = new Set<string>()
  for (const p of [...m.pins, ...(m.holes ?? [])]) {
    if (!('name' in p) || typeof p.name !== 'string') continue
    if (p.mains) requirement.set(p.name, p.mains)
    if (p.bond === 'pe') bonds.add(p.name)
  }
  const terminals = new Set<string>([
    ...acSources.flatMap((s) => [...s.live, ...s.neutral, ...s.earth]),
    ...conducts.flatMap((c) => c.pins), ...protective.flatMap((e) => [e.from, e.to]),
    ...domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins),
    ...(acInput ? [acInput.a, acInput.b] : []), ...contactTerminals,
    ...(plug ? plug.profiles.flatMap((pr) => pr.contacts.map((c) => c.pin)) : []),
    ...sockets.flatMap((s) => s.contacts.map((c) => c.group)),
    ...ratings.flatMap((r) => r.pins), ...requirement.keys(),
  ])
  // A domain other than mains is never "declared for mains": its pins are checked as SELV or PELV.
  for (const [p, x] of domainOf) if (x.kind !== 'mains') terminals.delete(p)
  const declaredConduction = new Set<string>([
    ...(m.internal ?? []).flat(), ...conducts.flatMap((c) => c.pins), ...protective.flatMap((e) => [e.from, e.to]), ...contactTerminals,
    ...(acInput ? [acInput.a, acInput.b] : []), ...acSources.flatMap((s) => [...s.live, ...s.neutral, ...s.earth]),
    ...sockets.flatMap((s) => s.contacts.map((c) => c.group)), ...(plug ? plug.profiles.flatMap((pr) => pr.contacts.map((c) => c.pin)) : []),
    // An earth terminal or a declared bond joins only the part's own metal.
    ...[...requirement].filter(([, r]) => r === 'PE').map(([p]) => p), ...bonds,
  ])
  const info: MainsInfo = {
    any: acSources.length > 0 || conducts.length > 0 || protective.length > 0 || domains.length > 0 || !!acInput || ratings.length > 0 ||
      contacts.length > 0 || el.protection !== undefined || !!plug || sockets.length > 0 || requirement.size > 0 || bonds.size > 0,
    internalNodes, acSources, region: ac && oneOf(REGIONS, ac.region) ? ac.region : null, hz: ac && isNum(ac.hz) ? ac.hz : null,
    conducts, protective, domains, domainOf,
    isolation: oneOf(ISOLATIONS, el.isolation) ? el.isolation : null,
    isolationProvenance: el.isolationProvenance === 'unverified' ? 'unverified' : 'datasheet',
    safeguard: el.safeguard === 'protective-screen' ? 'protective-screen' : null,
    acInput, ratings, contacts, contactTerminals,
    protection: el.protection === 'class-1' || el.protection === 'class-2' ? el.protection : null,
    plug, sockets, requirement, bonds, terminals, declaredConduction,
  }
  cache.set(m, info)
  return info
}
