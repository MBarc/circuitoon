// Simulation data on a module (spec 3): every new simulation value lives under one optional
// object, `electrical.sim`, so nothing that exists changes (`electrical.params` and
// `electrical.ratings` keep their meaning). Types, the parsed view and validateSim (spec 3.1).
// Pure, erasable TS (npm run validate runs it under Node).
import { type ModuleDef, isCustom, isNum, isObj, show, terminalsKey } from './module.ts'

export type Provenance = 'datasheet' | 'representative' | 'estimate'
export const PROVENANCES: readonly Provenance[] = ['datasheet', 'representative', 'estimate']
export type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1'
/** One number with its unit and where it came from: provenance is per value, never per part. */
export interface Quantity { value: number; unit: SimUnit; source?: string; provenance: Provenance; note?: string }
export const LIMIT_KINDS = ['current', 'absMaxCurrent', 'power', 'vinMax', 'vinMin', 'sourceCurrent', 'ioTotalCurrent'] as const
export type LimitKind = (typeof LIMIT_KINDS)[number]
export interface Limit {
  of: { pin: string } | { domain: string } | { part: true }
  kind: LimitKind
  value: number
  source?: string
  provenance: Provenance
  conditions?: string
  /** Required on an estimate: what was assumed. */
  note?: string
}
/** A named supply domain: a pin, its explicit return and a nominal voltage (spec 3.2). */
export interface PowerDomain { name: string; pin: string; ret: string; nominal: number }
export interface Draw { domain: string; typical: Quantity; peak?: Quantity & { note: string }; minVolts?: Quantity }
export const RAIL_KINDS = ['ldo', 'buck', 'boost', 'switch'] as const
export type RailKind = (typeof RAIL_KINDS)[number]
export interface Rail {
  id: string
  /** Several inputs: diode-OR (the highest wins) unless `direct`. */
  inputs: { domain: string; via: 'direct' | 'diode' }[]
  output: string
  kind: RailKind
  vout?: Quantity
  dropout?: Quantity
  iq?: Quantity
  ioutMax?: Quantity
  efficiency?: Quantity
  vinMin?: Quantity
  vinMax?: Quantity
  rout?: Quantity
  /** Output to input path. */
  reverse: 'blocks' | 'body-diode'
  /** Buck and boost only: input to output through the inductor and diode when disabled. */
  offPath?: 'open' | 'diode'
  minLoad?: { amps: Quantity; note: string }
  ron?: Quantity
  vf?: Quantity
}
export interface SourceSpec { domain: string; voltage: 'param:voltage' | Quantity; rInternal: Quantity; imax?: Quantity }
export interface PowerSpec { domains: PowerDomain[]; draw?: Draw[]; rails?: Rail[]; source?: SourceSpec }
export interface GpioSpec { domain: string; pins: string[]; outputResistance: Quantity; pullup?: Quantity; pulldown?: Quantity; inputLeakage?: Quantity }
export interface SimSpec {
  /** Physics: diode is, n, rs; rInternal; contactResistance; dcr. */
  modelParams?: Record<string, Quantity>
  limits?: Limit[]
  power?: PowerSpec
  gpio?: GpioSpec
  /** A USB pin's ground pin (spec 4.7). */
  usbPorts?: Record<string, { gnd: string }>
}

/** The module's `electrical.sim`, or null. Trusts validateModule (validateSim). */
export function simOf(m: ModuleDef | undefined): SimSpec | null {
  const e = m?.electrical
  return isObj(e) && isObj(e.sim) ? (e.sim as SimSpec) : null
}

/**
 * The module a stored copy is simulated and validated as. `electrical.sim` is library data, like
 * the KiCad mapping (format/kicad.ts mappingOf): a built-in part whose stored copy has the
 * library's pins takes the library's sim, so a sheet saved before the library had it still
 * simulates and keeps its saved sim values. A custom part, or a copy whose pins changed, keeps its own.
 */
export function withLibrarySim(stored: ModuleDef, library: ((id: string) => ModuleDef | undefined) | undefined): ModuleDef {
  if (!library || isCustom(stored)) return stored
  const lib = library(stored.id)
  if (!lib || lib === stored || terminalsKey(stored) !== terminalsKey(lib)) return stored
  const sim = isObj(lib.electrical) ? lib.electrical.sim : undefined
  const e: Record<string, unknown> = isObj(stored.electrical) ? { ...stored.electrical } : {}
  if (e.sim === sim) return stored
  if (sim === undefined) delete e.sim
  else e.sim = sim
  return { ...stored, electrical: e }
}

const RAIL_REQUIRED: Record<RailKind, (keyof Rail)[]> = {
  ldo: ['vout', 'dropout', 'ioutMax'],
  buck: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  boost: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  switch: [],
}
/** The required fields a rail lacks (spec 3.2 table) in words, or null. */
export function railProblem(r: Rail): string | null {
  const missing: string[] = RAIL_REQUIRED[r.kind].filter((k) => r[k] === undefined)
  if (r.kind === 'switch' && r.ron === undefined && r.vf === undefined) missing.push('ron or vf')
  return missing.length ? `rail ${r.id} needs ${missing.join(', ')}` : null
}

/** The physics a module may state in sim.modelParams, with their units. */
export const MODEL_PARAMS: Record<string, SimUnit> = { rInternal: 'ohm', contactResistance: 'ohm', is: 'A', n: '1', rs: 'ohm', dcr: 'ohm' }
const RAIL_UNITS: Record<string, SimUnit> = { vout: 'V', dropout: 'V', iq: 'A', ioutMax: 'A', efficiency: '1', vinMin: 'V', vinMax: 'V', rout: 'ohm', ron: 'ohm', vf: 'V' }
const LIMIT_UNITS: Record<LimitKind, string> = { current: 'A', absMaxCurrent: 'A', power: 'W', vinMax: 'V', vinMin: 'V', sourceCurrent: 'A', ioTotalCurrent: 'A' }
const URLS = /^https?:\/\/\S+( https?:\/\/\S+)*$/
/** The compiler floors a rail's rout here (0 fails the solve), so a smaller stated value is an error. */
const ROUT_MIN = 1e-3

/** Checks `electrical.sim` (spec 3.1): shape, units by kind, provenance, and every name it uses. */
export function validateSim(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el) || el.sim === undefined) return
  const at = 'electrical.sim'
  const s = el.sim
  if (!isObj(s)) return void errors.push(`${at}: must be an object`)
  const pins = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])].filter(isObj)
  const usb = new Set(pins.filter((p) => p.type === 'usb').map((p) => p.name))
  const grounds = new Set(pins.filter((p) => p.type === 'ground').map((p) => p.name))
  /** USB port to the first `#vbus` / `#gnd` reference sim.power makes to it. */
  const usbRefs = new Map<string, string>()
  const keys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where}.${k}: unknown field`)
  }
  const nodeRef = (v: unknown, where: string) => {
    const u = typeof v === 'string' ? /^(.+)#(vbus|gnd)$/.exec(v) : null
    if (typeof v !== 'string' || !(u ? usb.has(u[1]) : names.has(v))) errors.push(`${where}: no pin, hole group or USB node "${show(v)}"`)
    else if (u && !usbRefs.has(u[1])) usbRefs.set(u[1], v)
  }
  const sourced = (o: Record<string, unknown>, where: string) => {
    if (!(PROVENANCES as readonly unknown[]).includes(o.provenance)) return void errors.push(`${where}.provenance: must be "datasheet", "representative" or "estimate"`)
    if (o.provenance !== 'estimate' && !(typeof o.source === 'string' && URLS.test(o.source))) errors.push(`${where}.source: required for a datasheet or representative value (a URL)`)
    if (o.source !== undefined && !(typeof o.source === 'string' && URLS.test(o.source))) errors.push(`${where}.source: must be one or more URLs separated by a space`)
    if (o.provenance === 'estimate' && !(typeof o.note === 'string' && o.note.trim())) errors.push(`${where}.note: required on an estimate (say what was assumed)`)
    if (o.note !== undefined && !(typeof o.note === 'string' && o.note.trim())) errors.push(`${where}.note: must be a non-empty string`)
  }
  const quantity = (v: unknown, where: string, unit: SimUnit, opts: { positive?: boolean; max?: number; extra?: string[] } = {}) => {
    if (!isObj(v)) return void errors.push(`${where}: must be { "value", "unit", "provenance", "source" or "note" }`)
    keys(v, ['value', 'unit', 'source', 'provenance', 'note', ...(opts.extra ?? [])], where)
    if (v.unit !== unit) errors.push(`${where}.unit: must be "${unit}"`)
    const lo = opts.positive ? 'above 0' : '0 or more'
    if (!isNum(v.value) || (opts.positive ? v.value <= 0 : v.value < 0) || (opts.max !== undefined && v.value > opts.max) || v.value > 1e6)
      errors.push(`${where}.value: must be ${lo}${opts.max !== undefined ? ` and at most ${opts.max}` : ''}`)
    sourced(v, where)
  }
  /** A quantity's value when it is a finite number. */
  const val = (v: unknown) => (isObj(v) && isNum(v.value) ? v.value : undefined)
  keys(s, ['modelParams', 'limits', 'power', 'gpio', 'usbPorts'], at)

  if (s.modelParams !== undefined) {
    if (!isObj(s.modelParams)) errors.push(`${at}.modelParams: must be an object`)
    else
      for (const [k, v] of Object.entries(s.modelParams)) {
        if (!Object.hasOwn(MODEL_PARAMS, k)) errors.push(`${at}.modelParams.${k}: unknown model parameter (${Object.keys(MODEL_PARAMS).join(', ')})`)
        else quantity(v, `${at}.modelParams.${k}`, MODEL_PARAMS[k], { positive: true })
      }
  }

  const domainNames = new Set<string>()
  const p = s.power
  if (p !== undefined) {
    const pa = `${at}.power`
    if (!isObj(p)) errors.push(`${pa}: must be an object`)
    else {
      keys(p, ['domains', 'draw', 'rails', 'source'], pa)
      if (!Array.isArray(p.domains) || !p.domains.length) errors.push(`${pa}.domains: required, a list of { "name", "pin", "ret", "nominal" }`)
      else
        p.domains.forEach((d, i) => {
          const w = `${pa}.domains[${i}]`
          if (!isObj(d)) return void errors.push(`${w}: must be an object`)
          keys(d, ['name', 'pin', 'ret', 'nominal'], w)
          if (typeof d.name !== 'string' || !d.name) errors.push(`${w}.name: required`)
          else if (domainNames.has(d.name)) errors.push(`${w}.name: duplicate domain "${d.name}"`)
          else domainNames.add(d.name)
          nodeRef(d.pin, `${w}.pin`)
          nodeRef(d.ret, `${w}.ret`)
          if (!(isNum(d.nominal) && d.nominal > 0)) errors.push(`${w}.nominal: must be a voltage above 0`)
        })
      const domain = (v: unknown, where: string) => {
        if (typeof v !== 'string' || !domainNames.has(v)) errors.push(`${where}: no domain "${show(v)}" in ${pa}.domains`)
      }
      if (p.draw !== undefined)
        (Array.isArray(p.draw) ? p.draw : [null]).forEach((d, i) => {
          const w = `${pa}.draw[${i}]`
          if (!isObj(d)) return void errors.push(`${w}: must be { "domain", "typical", "peak"?, "minVolts"? }`)
          keys(d, ['domain', 'typical', 'peak', 'minVolts'], w)
          domain(d.domain, `${w}.domain`)
          quantity(d.typical, `${w}.typical`, 'A')
          if (d.peak !== undefined) {
            quantity(d.peak, `${w}.peak`, 'A', { extra: ['note'] })
            if (isObj(d.peak) && !(typeof d.peak.note === 'string' && d.peak.note.trim())) errors.push(`${w}.peak.note: required (what the peak is, for example "Wi-Fi transmit")`)
          }
          if (d.minVolts !== undefined) quantity(d.minVolts, `${w}.minVolts`, 'V', { positive: true })
        })
      const railIds = new Set<string>()
      if (p.rails !== undefined)
        (Array.isArray(p.rails) ? p.rails : [null]).forEach((r, i) => {
          const w = `${pa}.rails[${i}]`
          if (!isObj(r)) return void errors.push(`${w}: must be an object`)
          keys(r, ['id', 'inputs', 'output', 'kind', 'reverse', 'offPath', 'minLoad', ...Object.keys(RAIL_UNITS)], w)
          if (typeof r.id !== 'string' || !r.id || railIds.has(r.id)) errors.push(`${w}.id: required and unique`)
          else railIds.add(r.id)
          if (!(RAIL_KINDS as readonly unknown[]).includes(r.kind)) errors.push(`${w}.kind: must be "ldo", "buck", "boost" or "switch"`)
          if (!Array.isArray(r.inputs) || !r.inputs.length) errors.push(`${w}.inputs: required, a list of { "domain", "via" }`)
          else
            r.inputs.forEach((x, j) => {
              if (!isObj(x)) return void errors.push(`${w}.inputs[${j}]: must be { "domain", "via" }`)
              keys(x, ['domain', 'via'], `${w}.inputs[${j}]`)
              domain(x.domain, `${w}.inputs[${j}].domain`)
              if (x.via !== 'direct' && x.via !== 'diode') errors.push(`${w}.inputs[${j}].via: must be "direct" or "diode"`)
            })
          domain(r.output, `${w}.output`)
          if (r.reverse !== 'blocks' && r.reverse !== 'body-diode') errors.push(`${w}.reverse: required, "blocks" or "body-diode"`)
          if (r.offPath !== undefined && !((r.kind === 'buck' || r.kind === 'boost') && (r.offPath === 'open' || r.offPath === 'diode'))) errors.push(`${w}.offPath: "open" or "diode", on a buck or boost only`)
          for (const [k, unit] of Object.entries(RAIL_UNITS))
            if (r[k] !== undefined) quantity(r[k], `${w}.${k}`, unit, k === 'efficiency' ? { positive: true, max: 1 } : k === 'iq' ? {} : { positive: true })
          const rout = val(r.rout)
          if (rout !== undefined && rout > 0 && rout < ROUT_MIN) errors.push(`${w}.rout.value: must be at least ${ROUT_MIN} (${ROUT_MIN * 1000} milliohm)`)
          const vout = val(r.vout)
          const dropout = val(r.dropout)
          if (r.kind === 'ldo' && vout !== undefined && dropout !== undefined && dropout >= vout) errors.push(`${w}.dropout: must be below vout (${vout} V)`)
          if ((r.ron !== undefined || r.vf !== undefined) && r.kind !== 'switch') errors.push(`${w}: ron and vf are for a "switch" rail`)
          if (r.minLoad !== undefined) {
            if (!isObj(r.minLoad) || typeof r.minLoad.note !== 'string' || !r.minLoad.note.trim()) errors.push(`${w}.minLoad: must be { "amps", "note" }`)
            else quantity(r.minLoad.amps, `${w}.minLoad.amps`, 'A', { positive: true })
          }
        })
      if (p.source !== undefined) {
        const w = `${pa}.source`
        const src = p.source
        if (!isObj(src)) errors.push(`${w}: must be { "domain", "voltage", "rInternal", "imax"? }`)
        else {
          keys(src, ['domain', 'voltage', 'rInternal', 'imax'], w)
          domain(src.domain, `${w}.domain`)
          if (src.voltage === 'param:voltage') {
            const params = isObj(el.params) ? el.params : {}
            if (params.voltage === undefined) errors.push(`${w}.voltage: "param:voltage" needs electrical.params.voltage`)
          } else quantity(src.voltage, `${w}.voltage`, 'V', { positive: true })
          quantity(src.rInternal, `${w}.rInternal`, 'ohm', { positive: true })
          if (src.imax !== undefined) quantity(src.imax, `${w}.imax`, 'A', { positive: true })
        }
      }
    }
  }

  if (s.gpio !== undefined) {
    const w = `${at}.gpio`
    const g = s.gpio
    if (!isObj(g)) errors.push(`${w}: must be an object`)
    else {
      keys(g, ['domain', 'pins', 'outputResistance', 'pullup', 'pulldown', 'inputLeakage'], w)
      if (typeof g.domain !== 'string' || !domainNames.has(g.domain)) errors.push(`${w}.domain: no domain "${show(g.domain)}" in ${at}.power.domains`)
      if (!Array.isArray(g.pins) || !g.pins.length) errors.push(`${w}.pins: required, a list of GPIO pin names`)
      else g.pins.forEach((n, i) => { if (typeof n !== 'string' || !names.has(n)) errors.push(`${w}.pins[${i}]: no pin "${show(n)}"`) })
      quantity(g.outputResistance, `${w}.outputResistance`, 'ohm', { positive: true })
      for (const k of ['pullup', 'pulldown']) if (g[k] !== undefined) quantity(g[k], `${w}.${k}`, 'ohm', { positive: true })
      if (g.inputLeakage !== undefined) quantity(g.inputLeakage, `${w}.inputLeakage`, 'A')
    }
  }

  if (s.usbPorts !== undefined) {
    const w = `${at}.usbPorts`
    if (!isObj(s.usbPorts)) errors.push(`${w}: must be an object of USB pin to { "gnd" }`)
    else
      for (const [port, v] of Object.entries(s.usbPorts)) {
        if (!usb.has(port)) errors.push(`${w}.${port}: no USB pin "${port}"`)
        if (!isObj(v) || typeof v.gnd !== 'string') errors.push(`${w}.${port}: must be { "gnd": <ground pin> }`)
        else if (!grounds.has(v.gnd)) errors.push(`${w}.${port}.gnd: "${v.gnd}" is not a ground pin`)
      }
  }
  // Spec 4.7: a port whose nodes sim.power uses joins its #gnd to the board's ground, or the
  // board's load has no return through the cable. A part with no ground pin (a computer's port,
  // ground only on the port) keeps its #gnd as a node of its own.
  if (grounds.size)
    for (const [port, ref] of usbRefs)
      if (!(isObj(s.usbPorts) && Object.hasOwn(s.usbPorts, port)))
        errors.push(`${at}.usbPorts.${port}: required, ${at}.power uses "${ref}" (name the ground pin, so the return flows through the cable)`)

  if (s.limits !== undefined)
    (Array.isArray(s.limits) ? s.limits : [null]).forEach((l, i) => {
      const w = `${at}.limits[${i}]`
      if (!isObj(l)) return void errors.push(`${w}: must be { "of", "kind", "value", "provenance", ... }`)
      keys(l, ['of', 'kind', 'value', 'source', 'provenance', 'conditions', 'note'], w)
      const of = l.of
      if (!isObj(of) || Object.keys(of).length !== 1) errors.push(`${w}.of: must be { "pin" }, { "domain" } or { "part": true }`)
      else if ('pin' in of) { if (typeof of.pin !== 'string' || !names.has(of.pin)) errors.push(`${w}.of.pin: no pin "${show(of.pin)}"`) }
      else if ('domain' in of) { if (typeof of.domain !== 'string' || !domainNames.has(of.domain)) errors.push(`${w}.of.domain: no domain "${show(of.domain)}" in ${at}.power.domains`) }
      else if (of.part !== true) errors.push(`${w}.of: must be { "pin" }, { "domain" } or { "part": true }`)
      const kindOk = (LIMIT_KINDS as readonly unknown[]).includes(l.kind)
      if (!kindOk) errors.push(`${w}.kind: must be one of ${LIMIT_KINDS.join(', ')}`)
      if (!(isNum(l.value) && l.value > 0)) errors.push(`${w}.value: must be above 0 (in ${kindOk ? LIMIT_UNITS[l.kind as LimitKind] : 'its unit'})`)
      if (l.conditions !== undefined && !(typeof l.conditions === 'string' && l.conditions.trim())) errors.push(`${w}.conditions: must be a non-empty string`)
      sourced(l, w)
    })
}
