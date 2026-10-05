// Diagram to Circuit (spec 2, 4): every terminal of every simulated part (singleton pins
// included), nets named exactly as extract names them (sheetNets, ruling: one naming), other
// nodes `<ref>_<pin>`, mains nodes left out (spec 2.1), and each part compiled by its electrical
// model. Boards and modules with `electrical.sim.power` go through power.ts. Pure and
// deterministic: parts in uid order, devices in id order.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { type ModuleDef, isBoard, isNetLabel, isNum, isObj, isSpacer, partSetting } from '../format/module.ts'
import { nodeKey } from '../format/netlist.ts'
import { analyseMainsCached } from '../format/mains.ts'
import { convertersInState } from '../format/mainsRules.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { type Quantity, simOf } from '../format/simModel.ts'
import { closedPairs, contactPosition, isActive, simOverride, switchGroups } from '../format/simState.ts'
import { paramValue } from '../format/values.ts'
import { sheetNets } from '../agent/extract.ts'
import { naturalCompare } from '../agent/order.ts'
import { CONTACT_OHMS, NO_POWER_DATA, cellEstimate } from './estimates.ts'
import { LED_COLOURS, ledModel } from './ledModels.ts'
import type { Circuit, Device, GpioPin, Param, PinTap, ResolvedLimit, SimDomain, SimPart, UsbPath } from './model.ts'
import { powerPart, usbLinks } from './power.ts'

export interface BuildOptions { held?: { part: string; group: string } | null }

const modelOf = (m: ModuleDef): string => (isObj(m.electrical) && typeof m.electrical.model === 'string' ? m.electrical.model : '')
const terminals = (m: ModuleDef): Record<string, string> => {
  const t = isObj(m.electrical) && isObj(m.electrical.terminals) ? m.electrical.terminals : {}
  return Object.fromEntries(Object.entries(t).filter((x): x is [string, string] => typeof x[1] === 'string'))
}
/** A number param outside PARAM_RULES (forwardVoltage, maxCurrent): a stored { value } override, else the module default. */
function numParam(part: PartInstance, m: ModuleDef, name: string): number | null {
  const stored = part.values?.[name]
  if (isObj(stored) && isNum(stored.value)) return stored.value
  const p = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params[name] : undefined
  return isObj(p) && isNum(p.default) ? p.default : null
}
const hasPowerPin = (m: ModuleDef) => [...m.pins, ...(m.holes ?? [])].some((p) => !('spacer' in p && isSpacer(p)) && 'type' in p && p.type === 'power_in')

export class Builder {
  d: Diagram
  private opts: BuildOptions
  private mainsKeys: Set<string>
  private netOfKey = new Map<string, string>()
  private names = new Set<string>()
  private refOf: Map<string, string>
  private tapsByKey = new Map<string, PinTap>()
  private devices: Device[] = []
  private parts: Record<string, SimPart> = {}
  private domains: SimDomain[] = []
  private limits: ResolvedLimit[] = []
  private gpios: GpioPin[] = []
  private usb: UsbPath[] = []
  private unsim: { part: string; reason: string }[] = []
  private notes: string[] = []
  private open: { part: string; group: string; a: string; b: string }[] = []
  private converters: Map<string, { state: string }> | null = null

  constructor(d: Diagram, opts: BuildOptions) {
    this.d = d
    this.opts = opts
    this.mainsKeys = analyseMainsCached(d)?.mainsKeys ?? new Set()
    const sn = sheetNets(d)
    this.refOf = sn.refOf
    for (const net of sn.nets) {
      this.names.add(net.name)
      for (const k of net.keys) this.netOfKey.set(k, net.name)
    }
    // netlist() nets extract does not write (one component pin and a strip, say) get the name of
    // their first component pin; every key of a net shares the name.
    for (const keys of sn.netlist.nets) {
      const named = keys.find((k) => this.netOfKey.has(k))
      const name = named ? this.netOfKey.get(named)! : this.fresh(this.firstComponent(keys))
      for (const k of keys) this.netOfKey.set(k, name)
    }
  }

  ref(uid: string): string {
    return this.refOf.get(uid) ?? this.d.parts.find((p) => p.uid === uid)?.designator ?? uid
  }

  modulesOf(uid: string): ModuleDef | undefined {
    const p = this.d.parts.find((x) => x.uid === uid)
    return p ? moduleOf(this.d, p.module) : undefined
  }

  private firstComponent(keys: string[]): [string, string] {
    const pins = keys.map((k) => JSON.parse(k) as [string, string])
    const real = pins.filter(([uid]) => {
      const m = this.modulesOf(uid)
      return m && !isBoard(m) && !isNetLabel(m)
    })
    return (real.length ? real : pins).sort((a, b) => naturalCompare(this.ref(a[0]), this.ref(b[0])) || naturalCompare(a[1], b[1]))[0]
  }

  private fresh([uid, pin]: [string, string]): string {
    const base = `${this.ref(uid)}_${pin}`
    let name = base
    for (let k = 2; this.names.has(name); k++) name = `${base}_${k}`
    this.names.add(name)
    return name
  }

  /** The net a part pin is on (named on first use for a singleton); null on mains wiring. */
  node(uid: string, pin: string): string | null {
    const key = nodeKey(uid, pin)
    if (this.mainsKeys.has(key)) return null
    let net = this.netOfKey.get(key)
    if (!net) {
      net = this.fresh([uid, pin])
      this.netOfKey.set(key, net)
    }
    return net
  }

  /** The pin node behind the pin's 0 V sense (ruling R19), made on first use; null on mains wiring. */
  tap(uid: string, pin: string): string | null {
    const key = nodeKey(uid, pin)
    const hit = this.tapsByKey.get(key)
    if (hit) return hit.node
    const net = this.node(uid, pin)
    if (!net) return null
    const t: PinTap = { part: uid, pin, net, node: `${uid}:${pin}` }
    this.tapsByKey.set(key, t)
    return t.node
  }

  add(dev: Device): void {
    this.devices.push(dev)
  }
  param(q: Quantity, label: string): Param {
    return { value: q.value, basis: q.provenance, label, ...(q.note ? { note: q.note } : {}) }
  }
  user(value: number, label: string): Param {
    return { value, basis: 'user', label }
  }
  /** The part is not simulated at all. */
  skip(uid: string, reason: string): void {
    delete this.parts[uid]
    this.devices = this.devices.filter((x) => x.part !== uid)
    this.unsim.push({ part: uid, reason })
  }
  /** One path or pin of a simulated part is not simulated (ruling R7, an unset output-only pin). */
  unsimulated(uid: string, reason: string): void {
    this.unsim.push({ part: uid, reason })
  }
  note(text: string): void {
    this.notes.push(text)
  }
  limit(l: ResolvedLimit): void {
    this.limits.push(l)
  }
  domain(x: SimDomain): void {
    this.domains.push(x)
  }
  gpio(x: GpioPin): void {
    this.gpios.push(x)
  }
  usbPath(x: UsbPath): void {
    this.usb.push(x)
  }

  /** The module's sim.limits, as resolved limits of the part (spec 3.1). */
  partLimits(p: PartInstance, m: ModuleDef, skipKinds: string[] = []): void {
    for (const l of simOf(m)?.limits ?? []) {
      if (skipKinds.includes(l.kind)) continue
      const what = 'pin' in l.of ? l.of.pin : 'domain' in l.of ? l.of.domain : 'part'
      this.limit({
        part: p.uid, of: l.of, kind: l.kind, ...(l.conditions ? { conditions: l.conditions } : {}),
        value: { value: l.value, basis: l.provenance, label: `${m.id}.${this.ref(p.uid)}.limits.${l.kind}.${what}` },
      })
    }
  }

  /** Whether an AC-DC converter's mains input is powered in the saved contact state (spec 4 table). */
  converterPowered(uid: string): boolean {
    if (!this.converters) {
      this.converters = convertersInState(this.d, (part, groupId) => {
        const m = moduleOf(this.d, part.module)
        const g = m && switchGroups(m).find((x) => x.id === groupId)
        return !!m && !!g && isActive(contactPosition(part, m, g, this.isHeld(part.uid, groupId)))
      })
    }
    return this.converters.get(uid)?.state === 'powered'
  }

  private isHeld(uid: string, group: string): boolean {
    return this.opts.held?.part === uid && this.opts.held.group === group
  }

  private contactOhms(p: PartInstance, m: ModuleDef): Param {
    const q = simOf(m)?.modelParams?.contactResistance
    return this.param(q ?? CONTACT_OHMS, `${m.id}.${this.ref(p.uid)}.contactResistance`)
  }

  private contact(p: PartInstance, m: ModuleDef, id: string, x: string, y: string): void {
    const a = this.tap(p.uid, x)
    const b = this.tap(p.uid, y)
    if (a && b) this.add({ kind: 'resistor', id, part: p.uid, a, b, ohms: this.contactOhms(p, m), role: 'contact' })
  }

  part(p: PartInstance): void {
    const m = moduleOf(this.d, p.module)
    if (!m) return this.unsimulated(p.uid, 'its module is not embedded in the sheet')
    if (isNetLabel(m) || isBoard(m)) return
    const model = modelOf(m)
    // Connectors, breadboard strips and Wago blocks are one conductor in netlist() already (spec 4 table).
    if (model === 'connector') return
    const ref = this.ref(p.uid)
    this.parts[p.uid] = { uid: p.uid, ref, designator: p.designator, module: m.id, name: m.name, model }
    const t = terminals(m)
    const label = (path: string) => `${m.id}.${ref}.${path}`
    switch (model) {
      case 'resistor': {
        const a = this.tap(p.uid, t.a)
        const b = this.tap(p.uid, t.b)
        const ohms = paramValue(p, m, 'resistance') ?? 0
        if (a && b) this.add({ kind: 'resistor', id: `${p.uid}.r`, part: p.uid, a, b, ohms: ohms === 0 ? this.contactOhms(p, m) : this.user(ohms, label('resistance')), role: ohms === 0 ? 'contact' : 'resistor' })
        return this.partLimits(p, m)
      }
      case 'potentiometer': {
        const total = paramValue(p, m, 'resistance') ?? 10000
        const raw = p.values?.position
        const pos = isNum(raw) && raw >= 0 && raw <= 1 ? raw : 0.5
        const a = this.tap(p.uid, t.a)
        const w = this.tap(p.uid, t.wiper)
        const b = this.tap(p.uid, t.b)
        if (a && w) this.add({ kind: 'resistor', id: `${p.uid}.aw`, part: p.uid, a, b: w, ohms: this.user(Math.max(1, total * pos), label('resistance')), role: 'resistor' })
        if (w && b) this.add({ kind: 'resistor', id: `${p.uid}.wb`, part: p.uid, a: w, b, ohms: this.user(Math.max(1, total * (1 - pos)), label('resistance')), role: 'resistor' })
        return this.partLimits(p, m)
      }
      case 'led': {
        const a = this.tap(p.uid, t.anode)
        const k = this.tap(p.uid, t.cathode)
        const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
        const colourDefault = isObj(params.color) && typeof params.color.default === 'string' ? params.color.default : 'red'
        const colour = typeof p.values?.color === 'string' ? p.values.color : colourDefault
        // fitIs gives a nonsense IS near 0 V and nothing validates the range (ruling, Task 10):
        // outside 1.0 to 5.0 V, the module's default is used. LED_COLOURS has no per-colour voltage.
        const inBand = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 1 && v <= 5
        const fallback = numParam({ ...p, values: undefined }, m, 'forwardVoltage')
        const vfDefault = inBand(fallback) ? fallback : 2
        const vf = numParam(p, m, 'forwardVoltage') ?? vfDefault
        if (!inBand(vf)) this.note(`${ref}: forwardVoltage ${vf} V is outside 1.0 to 5.0 V; the default ${vfDefault} V is used`)
        const fit = ledModel(colour, inBand(vf) ? vf : vfDefault)
        if (!fit.known) this.note(`${ref}: no LED model for the colour "${colour}"; a red LED's curve is used`)
        if (a && k) this.add({ kind: 'diode', id: `${p.uid}.led`, part: p.uid, a, k, model: fit.model, role: 'led' })
        const sim = simOf(m)?.limits ?? []
        // Spec 3.1: sim.limits wins; else the legacy params.maxCurrent, read as `representative`.
        const legacy = numParam(p, m, 'maxCurrent')
        if (!sim.some((l) => l.kind === 'current') && legacy !== null)
          this.limit({ part: p.uid, of: { part: true }, kind: 'current', value: { value: legacy, basis: 'representative', label: label('maxCurrent') } })
        const abs = LED_COLOURS[fit.colour].absMaxCurrent
        if (!sim.some((l) => l.kind === 'absMaxCurrent') && abs && fit.known)
          this.limit({ part: p.uid, of: { part: true }, kind: 'absMaxCurrent', value: { value: abs.value, basis: 'representative', label: `led-colours.${fit.colour}.absMaxCurrent` } })
        return this.partLimits(p, m)
      }
      case 'voltage_source': {
        const plus = this.tap(p.uid, t.pos)
        const minus = this.tap(p.uid, t.neg)
        const volts = paramValue(p, m, 'voltage') ?? 0
        const sim = simOf(m)
        const rOver = simOverride(p, 'sim.rInternal')
        const rInternal = rOver !== null ? this.user(rOver, label('rInternal')) : this.param(sim?.modelParams?.rInternal ?? cellEstimate(volts).rInternal, label('rInternal'))
        const iOver = simOverride(p, 'sim.imax')
        const limit = sim?.limits?.find((l) => l.kind === 'sourceCurrent')
        const imax = iOver !== null ? this.user(iOver, label('imax')) : limit ? { value: limit.value, basis: limit.provenance, label: label('limits.sourceCurrent') } : undefined
        const id = `${p.uid}.cell`
        if (plus && minus) this.add({ kind: 'cell', id, part: p.uid, p: plus, n: minus, int: `${id}#int`, volts: this.user(volts, label('voltage')), rInternal, ...(imax ? { imax } : {}), role: 'cell' })
        return this.partLimits(p, m)
      }
      case 'capacitor': {
        const a = this.tap(p.uid, t.a)
        const b = this.tap(p.uid, t.b)
        if (a && b) this.add({ kind: 'capacitor', id: `${p.uid}.c`, part: p.uid, a, b, farads: paramValue(p, m, 'capacitance') ?? 1e-7 })
        return
      }
      case 'fuse': {
        if (partSetting(p, m, 'fuse') !== 'absent') for (const [i, e] of mainsOf(m).protective.entries()) this.contact(p, m, `${p.uid}.fuse.${i + 1}`, e.from, e.to)
        const rating = paramValue(p, m, 'fuseRating')
        if (rating !== null) this.limit({ part: p.uid, of: { part: true }, kind: 'fuse', value: this.user(rating, label('fuseRating')) })
        return
      }
      case 'switch':
      case 'relay':
      case 'ssr': {
        for (const g of switchGroups(m)) {
          const pos = contactPosition(p, m, g, this.isHeld(p.uid, g.id))
          closedPairs(g, pos).forEach(([x, y], i) => this.contact(p, m, `${p.uid}.${g.id}.${i + 1}`, x, y))
          // A latching switch at rest: remember what it would join (ruling R30 names it).
          if (g.kind === 'switch' && !g.momentary && !isActive(pos))
            for (const [x, y] of closedPairs(g, g.changeover ? 'no' : 'closed')) {
              const a = this.node(p.uid, x)
              const b = this.node(p.uid, y)
              if (a && b) this.open.push({ part: p.uid, group: g.id, a, b })
            }
          if (g.kind !== 'switch') this.note(`${ref}: shown at rest; coil switching is simulated with firmware`)
        }
        // The coil (or any electronics) is a load only when the module has sim.power (spec 4 table); powerPart adds the limits then.
        if (simOf(m)?.power) return powerPart(this, p, m)
        return this.partLimits(p, m)
      }
    }
    if (simOf(m)?.power) return powerPart(this, p, m)
    if (mainsOf(m).any) return this.skip(p.uid, 'mains wiring is not simulated')
    this.skip(p.uid, hasPowerPin(m) ? NO_POWER_DATA : 'no simulation model')
  }

  done(): Circuit {
    // Pins within a part by code point ("+" before "-"), so the order never depends on a collator.
    const taps = [...this.tapsByKey.values()].sort((a, b) => naturalCompare(a.part, b.part) || (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0))
    const devices = [...this.devices].sort((a, b) => naturalCompare(a.part, b.part) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const pinNet: Record<string, string> = {}
    for (const [k, net] of [...this.netOfKey].sort((a, b) => (a[0] < b[0] ? -1 : 1))) pinNet[k] = net
    return {
      nets: [...new Set(taps.map((t) => t.net))].sort(),
      taps,
      devices,
      parts: Object.fromEntries(Object.entries(this.parts).sort((a, b) => naturalCompare(a[0], b[0]))),
      domains: this.domains,
      limits: this.limits,
      gpio: this.gpios,
      usb: this.usb,
      pinNet,
      mains: [...this.mainsKeys].sort(),
      openContacts: this.open,
      unsimulated: this.unsim,
      notes: [...new Set(this.notes)],
    }
  }
}

export function buildCircuit(d: Diagram, opts: BuildOptions = {}): Circuit {
  const b = new Builder(d, opts)
  for (const p of [...d.parts].sort((x, y) => naturalCompare(x.uid, y.uid))) b.part(p)
  usbLinks(b, d)
  return b.done()
}
