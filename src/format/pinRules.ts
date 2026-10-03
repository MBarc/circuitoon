// Pin-capability rules (PRD "Pin capabilities"): what each MCU pin can actually do, from the caps a
// module declares on its pins (input only, output only, flash, strapping, no pull-up) and the I2C
// data it declares (`electrical.i2c`: bus pins, address, onboard pull-ups). They run on a plain
// model of nets, so the checker (a sheet's real connectivity) and `circuitoon explain` (a netlist's
// nets) share every rule and every message. Nothing is guessed: a pin with no caps, a module with no
// I2C data, an address pin driven by a signal, all stay quiet. Pure, no React.
import { type I2cSpec, type ModuleDef, type PinCaps, type PinDef, type PinType, addressText, externalPower, holeGroupOf, i2cOf, isBoard, isNetLabel, isSpacer, parseAddress, partSetting } from './module.ts'
import { andList, natural, orList } from './words.ts'

/** A part as the pin rules see it: `id` is a sheet uid or a netlist ref. */
export interface PinPart {
  id: string
  designator: string
  module: ModuleDef
  settings?: Record<string, string>
}

/** One pin or typed pad on a net. */
export interface PinEnd {
  part: PinPart
  pin: string
  /** The silkscreen label, else the name. */
  label: string
  type?: PinType
  supply?: string
  caps?: PinCaps
  /** The pin carries the board's USB power (`electrical.external`). */
  external: boolean
}

export interface PinModel {
  parts: PinPart[]
  /** How many nets there are; indexes are the caller's net numbers. */
  count: number
  /** A net's pins and typed pads (bare breadboard strips and net labels left out), built on first use. */
  net: (i: number) => PinEnd[]
  /** The net a part's pin is on, or undefined when it is on none. */
  netOf: (part: string, pin: string) => number | undefined
}

export type PinRuleId = 'pin-flash' | 'pin-input-only' | 'pin-output-only' | 'i2c-address-clash' | 'pin-strapping' | 'pin-no-pullup' | 'i2c-pullups' | 'i2c-address-floating' | 'i2c-pullups-unknown'

export interface PinDraft {
  rule: PinRuleId
  subject: string
  target: string
  message: string
  /** Part ids (uids or refs) involved. */
  parts: string[]
  pins: { part: string; pin: string }[]
  /** The nets the finding is about (their wires are highlighted). */
  nets: number[]
  /** Stable causes for the finding's id. */
  causes: string[]
}

const key = (part: string, pin: string) => JSON.stringify([part, pin])
export const endName = (e: PinEnd): string => `${e.part.designator} ${e.label}`
const endPin = (e: PinEnd) => ({ part: e.part.id, pin: e.pin })
/** Names as a list, the first three and a count of the rest when there are more than four. */
const fewNames = (names: string[]) => (names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : andList(names))
const model = (e: PinEnd): string | undefined => (e.part.module.electrical as { model?: string } | undefined)?.model

// ---- Building the model ----


type EndData = Omit<PinEnd, 'part'>
/** Per module, each pin's and typed pad's end data by name (null for a bare board strip); cached. */
const endCache = new WeakMap<ModuleDef, Map<string, EndData | null>>()
function endData(m: ModuleDef): Map<string, EndData | null> {
  let map = endCache.get(m)
  if (map) return map
  map = new Map()
  const external = new Set(externalPower(m).map((x) => x.pin))
  const board = isBoard(m)
  for (const def of [...m.pins.filter((p): p is PinDef => !isSpacer(p)), ...(m.holes ?? [])])
    if (!map.has(def.name)) map.set(def.name, board && !def.type ? null : { pin: def.name, label: def.label ?? def.name, type: def.type, supply: def.supply, caps: def.caps, external: external.has(def.name) })
  endCache.set(m, map)
  return map
}

/** The end for a part's pin, or null for a missing pin, a bare board strip or a net label. */
export function pinEnd(part: PinPart, pin: string): PinEnd | null {
  if (isNetLabel(part.module)) return null
  const data = endData(part.module).get(pin)
  return data ? { part, ...data } : null
}

/**
 * A model over `count` nets whose members `keysOf(i)` lists as [part id, pin name] pairs, with the
 * caller's own pin-to-net lookup. Nets are built only when a rule looks at them, so a sheet with no
 * pin data costs almost nothing.
 */
export function lazyPinModel(parts: PinPart[], count: number, keysOf: (i: number) => [string, string][], netOf: PinModel['netOf']): PinModel {
  const byId = new Map(parts.map((p) => [p.id, p]))
  const built = new Map<number, PinEnd[]>()
  const net = (i: number) => {
    let ends = built.get(i)
    if (!ends) {
      ends = keysOf(i).flatMap(([id, pin]) => {
        const part = byId.get(id)
        const e = part && pinEnd(part, pin)
        return e ? [e] : []
      })
      built.set(i, ends)
    }
    return ends
  }
  return { parts, count, net, netOf }
}

/** A model from nets given as [part id, pin name] pairs (a netlist's nets). */
export function buildPinModel(parts: PinPart[], nets: [string, string][][]): PinModel {
  const index = new Map<string, number>()
  nets.forEach((list, i) => { for (const [id, pin] of list) index.set(key(id, pin), i) })
  return lazyPinModel(parts, nets.length, (i) => nets[i], (part, pin) => index.get(key(part, pin)))
}

/** The pins and pads of a module that carry caps, cached per module. */
const cappedCache = new WeakMap<ModuleDef, string[]>()
function cappedPins(m: ModuleDef): string[] {
  let list = cappedCache.get(m)
  if (!list) cappedCache.set(m, (list = [...m.pins.filter((p): p is PinDef => !isSpacer(p)), ...(m.holes ?? [])].filter((p) => p.caps).map((p) => p.name)))
  return list
}

// ---- Net facts ----

export type Role = 'ground' | 'supply' | 'signal' | 'mixed'
/** A pin that holds its net at a supply voltage: a power output or a board's USB pin. A power input alone holds nothing up. */
const isSupplyEnd = (e: PinEnd) => e.type === 'power_out' || e.external
/** What a net is tied to: ground, a supply rail, both (a short or a cell link), or neither. */
export function roleOf(net: PinEnd[]): Role {
  const g = net.some((e) => e.type === 'ground')
  const s = net.some(isSupplyEnd)
  return g && s ? 'mixed' : g ? 'ground' : s ? 'supply' : 'signal'
}

/** A part's pins grouped by the electrical component they share inside it (`internal`). */
function componentOf(m: ModuleDef, pin: string): string {
  for (const g of m.internal ?? []) if (g.includes(pin)) return g[0]
  return pin
}
/** The pins of a two-sided part (resistor, switch, LED) on the other side from `pin`. */
function otherSide(e: PinEnd): string[] {
  const m = e.part.module
  const names = [...m.pins.filter((p): p is PinDef => !isSpacer(p)).map((p) => p.name), ...(m.holes ?? []).map((g) => g.name)]
  const mine = componentOf(m, e.pin)
  return names.filter((n) => componentOf(m, n) !== mine)
}
/** The roles of the nets on the far side of a two-sided part. */
function farRoles(pm: PinModel, e: PinEnd): Role[] {
  return otherSide(e).map((n) => {
    const i = pm.netOf(e.part.id, n)
    return i === undefined ? 'signal' : roleOf(pm.net(i))
  })
}
const isResistor = (e: PinEnd) => model(e) === 'resistor'
const isSwitch = (e: PinEnd) => model(e) === 'switch'
const isLed = (e: PinEnd) => model(e) === 'led'
/** The far side's rail: ground or supply when every far net is that one rail. */
function farRail(pm: PinModel, e: PinEnd): 'ground' | 'supply' | null {
  const roles = farRoles(pm, e)
  return roles.length && roles.every((r) => r === 'ground') ? 'ground' : roles.length && roles.every((r) => r === 'supply') ? 'supply' : null
}

/** A free GPIO of the same part with no limits, to suggest instead: " such as D13", or "". */
const suggestCache = new WeakMap<PinModel, Map<PinPart, string>>()
function suggest(pm: PinModel, part: PinPart): string {
  let cache = suggestCache.get(pm)
  if (!cache) suggestCache.set(pm, (cache = new Map()))
  let text = cache.get(part)
  if (text === undefined) cache.set(part, (text = freePin(pm, part)))
  return text
}
function freePin(pm: PinModel, part: PinPart): string {
  const m = part.module
  const i2c = i2cOf(m)
  const busPins = new Set(i2c ? [i2c.sda, i2c.scl, ...(i2c.address && 'pins' in i2c.address ? i2c.address.pins.map((p) => p.pin) : [])] : [])
  const all = [...m.pins.filter((p): p is PinDef => !isSpacer(p)), ...(m.holes ?? [])]
  const free = all.find((p) => {
    // A GPIO with no limits at all: typed io, or left untyped (the MCP23017's GPA0-GPA6 carry no type).
    if ((p.type !== 'io' && p.type !== undefined) || busPins.has(p.name) || p.caps) return false
    const i = pm.netOf(part.id, p.name)
    return i === undefined || !pm.net(i).some((o) => o.part !== part)
  })
  return free ? `, such as ${free.label ?? free.name}` : ''
}

// ---- Words for a pin ----

/** What a pin's caps say, in words: "input only, no internal pull-up or pull-down". Empty when it has none. */
export function capsText(c: PinCaps | undefined): string[] {
  if (!c) return []
  const out: string[] = []
  if (c.flash) out.push('flash pin: never connect anything')
  if (c.inputOnly) out.push('input only')
  if (c.outputOnly) out.push('output only')
  if (c.noPullup) out.push('no internal pull-up or pull-down')
  if (c.strapping === 'either') out.push('strapping pin (read at reset; either level boots)')
  else if (c.strapping && c.downloadOnly) out.push(`strapping pin: ${c.strapping} at reset only for flashing over serial`)
  else if (c.strapping) out.push(`strapping pin: must be ${c.strapping} at reset`)
  return out
}

const TYPE_WORDS: Record<PinType, string> = {
  power_in: 'power in', power_out: 'power out', ground: 'ground', input: 'input', output: 'output', io: 'input/output', passive: 'passive', nc: 'not connected inside',
}
/** One line on what a pin does: its type and supply, its caps, its I2C role, its note. */
export function pinDoes(e: PinEnd): string {
  const i2c = i2cOf(e.part.module)
  // The caps say "input only" or "output only" themselves: do not say "input" first.
  const said = (e.type === 'input' && e.caps?.inputOnly) || (e.type === 'output' && e.caps?.outputOnly)
  const parts = said ? [] : [e.type ? `${TYPE_WORDS[e.type]}${e.supply ? ` ${e.supply}` : ''}` : 'type not known']
  if (i2c?.sda === e.pin) parts.push('I2C data (SDA)')
  if (i2c?.scl === e.pin) parts.push('I2C clock (SCL)')
  const a = i2c?.address
  if (a && 'pins' in a && a.pins.some((p) => p.pin === e.pin)) parts.push('I2C address pin')
  parts.push(...capsText(e.caps))
  const text = parts.join(', ')
  return e.caps?.note ? `${text}. ${e.caps.note}` : text
}

// ---- I2C ----

export interface I2cDevice {
  part: PinPart
  spec: I2cSpec
  sda: number
  scl: number
}
export interface I2cBus {
  sda: number
  scl: number
  devices: I2cDevice[]
}

/** Every I2C bus: a pair of SDA and SCL nets that a declared I2C device sits on. In part order. */
export function i2cBuses(pm: PinModel): I2cBus[] {
  const buses = new Map<string, I2cBus>()
  for (const part of pm.parts) {
    const spec = i2cOf(part.module)
    if (!spec) continue
    const sda = pm.netOf(part.id, spec.sda)
    const scl = pm.netOf(part.id, spec.scl)
    if (sda === undefined || scl === undefined || sda === scl) continue
    // Only a wired bus: a device whose SDA joins no other part is on no bus yet.
    if (!pm.net(sda).some((e) => e.part !== part)) continue
    const k = `${sda}|${scl}`
    const bus = buses.get(k) ?? { sda, scl, devices: [] }
    bus.devices.push({ part, spec, sda, scl })
    buses.set(k, bus)
  }
  return [...buses.values()]
}

/** A device's address: the number, or why it is not known. `floating` lists address pins left unconnected with no board default. */
export interface AddressResult {
  address: number | null
  floating: string[]
  /** How the address was set, in words ("A2 A1 A0 = 0 0 1"), or why it is not known. */
  how: string
}

/** The level an address pin sits at: 0 or 1, null when floating with no default, 'driven' when a signal sets it. */
function pinLevel(pm: PinModel, part: PinPart, pin: string, floating?: 0 | 1): 0 | 1 | null | 'driven' {
  const i = pm.netOf(part.id, pin)
  const net = i === undefined ? [] : pm.net(i).filter((e) => !(e.part === part && e.pin === pin))
  const role = roleOf(net)
  if (role === 'ground') return 0
  if (role === 'supply') return 1
  if (role === 'mixed') return 'driven'
  // A net that powers a part (the chip's own VCC, say) is a supply rail while anything runs: high.
  if (net.some((e) => e.type === 'power_in')) return 1
  const pulls = net.filter(isResistor).map((e) => farRail(pm, e))
  if (pulls.includes('ground') && !pulls.includes('supply')) return 0
  if (pulls.includes('supply') && !pulls.includes('ground')) return 1
  // Only something that can drive a level sets it: an output or an io pin (a GPIO). Other inputs
  // (another chip's address pins), passive parts with no rail behind them and bare strips leave it floating.
  // A connector carries the net on from somewhere this sheet does not show: its level is not known here.
  if (net.some((e) => e.type === 'output' || e.type === 'io' || model(e) === 'connector')) return 'driven'
  return floating ?? null
}

export function i2cAddress(pm: PinModel, part: PinPart): AddressResult | null {
  const spec = i2cOf(part.module)
  const a = spec?.address
  if (!a) return null
  if ('fixed' in a) return { address: a.fixed, floating: [], how: 'fixed' }
  if ('setting' in a) {
    const choice = partSetting(part, part.module, a.setting)
    const n = choice === null ? null : parseAddress(choice)
    return { address: n, floating: [], how: `set on the board (${a.setting} ${choice ?? 'not set'})` }
  }
  let address = a.base
  const floating: string[] = []
  const levels: string[] = []
  let driven = false
  for (const p of a.pins) {
    const level = pinLevel(pm, part, p.pin, p.floating)
    const label = pinEnd(part, p.pin)?.label ?? p.pin
    if (level === null) floating.push(label)
    else if (level === 'driven') driven = true
    else if (level === 1) address += p.add
    levels.push(`${label}=${level === null ? 'floating' : level === 'driven' ? 'set by a signal' : level}`)
  }
  const how = levels.join(', ')
  return floating.length || driven ? { address: null, floating, how } : { address, floating, how }
}

// ---- The rules ----

/** A net sorted into the kinds of end the rules ask about, once per net (a big net is not rescanned per pin). */
interface NetSummary {
  role: Role
  ends: Map<string, PinEnd>
  parts: Set<PinPart>
  outputs: PinEnd[]
  supplies: PinEnd[]
  grounds: PinEnd[]
  ios: PinEnd[]
  inputs: PinEnd[]
  switches: PinEnd[]
  resistors: PinEnd[]
  leds: PinEnd[]
}
function summarize(net: PinEnd[]): NetSummary {
  const s: NetSummary = { role: roleOf(net), ends: new Map(), parts: new Set(), outputs: [], supplies: [], grounds: [], ios: [], inputs: [], switches: [], resistors: [], leds: [] }
  for (const e of net) {
    s.ends.set(key(e.part.id, e.pin), e)
    s.parts.add(e.part)
    if (e.type === 'output') s.outputs.push(e)
    if (isSupplyEnd(e)) s.supplies.push(e)
    if (e.type === 'ground') s.grounds.push(e)
    if (e.type === 'io') s.ios.push(e)
    if (e.type === 'input') s.inputs.push(e)
    if (isSwitch(e)) s.switches.push(e)
    else if (isResistor(e)) s.resistors.push(e)
    else if (isLed(e)) s.leds.push(e)
  }
  return s
}

/** Every pin-rule finding on the model. */
export function pinFindings(pm: PinModel): PinDraft[] {
  const out: PinDraft[] = []
  const summaries = new Map<number, NetSummary>()
  const summary = (i: number) => {
    let s = summaries.get(i)
    if (!s) summaries.set(i, (s = summarize(pm.net(i))))
    return s
  }
  for (const part of pm.parts) {
    for (const name of cappedPins(part.module)) {
      const i = pm.netOf(part.id, name)
      if (i === undefined) continue
      const s = summary(i)
      const p = s.ends.get(key(part.id, name))
      const c = p?.caps
      if (!p || !c) continue
      const note = c.note ? ` (${c.note.replace(/\.$/, '')})` : ''
      const cause = key(p.part.id, p.pin)
      const base = { subject: p.part.designator, target: endName(p), nets: [i] }
      const notMine = (e: PinEnd) => e.part !== p.part

      if (c.flash && (s.parts.size > 1 || !s.parts.has(p.part))) {
        const elsewhere = pm.net(i).filter(notMine)
        const n = elsewhere.length
        out.push({ ...base, rule: 'pin-flash',
          message: `${endName(p)} is a flash pin${note}, so nothing may be wired to it, but ${fewNames(elsewhere.map(endName))} ${n === 1 ? 'is' : 'are'}. The board will not run like this. Move ${n === 1 ? 'it' : 'them'} to a free GPIO${suggest(pm, p.part)}.`,
          parts: [p.part.id, ...elsewhere.map((e) => e.part.id)], pins: [endPin(p), ...elsewhere.map(endPin)], causes: [cause] })
        continue
      }

      if (c.inputOnly) {
        // Something else that drives the net: then this pin only reads it.
        const other = (e: PinEnd) => e !== p
        const driver = s.outputs.some(other) || s.supplies.some(other) || s.grounds.some(other) || s.ios.some(notMine) || s.switches.length > 0
        if (!driver) {
          const sinks = s.inputs.filter(notMine)
          // An LED on the pin, or behind a series resistor.
          const leds = [...s.leds]
          for (const r of s.resistors)
            for (const n of otherSide(r)) {
              const j = pm.netOf(r.part.id, n)
              if (j !== undefined) leds.push(...summary(j).leds)
            }
          const loads = [...sinks.map(endName), ...[...new Set(leds.map((e) => e.part))].map((x) => `${x.designator} (an LED)`)]
          if (loads.length) {
            out.push({ ...base, rule: 'pin-input-only',
              message: `${endName(p)} is input only${note}: it cannot drive ${fewNames(loads)}, and nothing else on the net does. Move the wire to a GPIO that can output${suggest(pm, p.part)}.`,
              parts: [p.part.id, ...sinks.map((e) => e.part.id), ...leds.map((e) => e.part.id)], pins: [endPin(p), ...sinks.map(endPin)], causes: [cause] })
            continue
          }
        }
        if (c.noPullup && s.switches.length && !s.outputs.some((e) => e !== p) && !s.ios.some(notMine)) {
          const sw0 = s.switches[0]
          const rail = farRail(pm, sw0)
          // Held only by a resistor to the other rail: a pull-up for a switch to ground, a pull-down for one to the supply.
          const pulled = s.resistors.some((r) => { const far = farRail(pm, r); return far !== null && far !== rail })
          if (!pulled && rail) {
            const [to, hold, fix] = rail === 'ground'
              ? ['ground', 'high', `a pull-up resistor (10 kOhm) from ${p.label} to the logic supply`]
              : ['the supply', 'low', `a pull-down resistor (10 kOhm) from ${p.label} to GND`]
            const sw = sw0.part.designator
            out.push({ ...base, rule: 'pin-no-pullup',
              message: `${endName(p)} has no internal pull-up or pull-down, and ${sw} switches it to ${to} with no resistor to hold it ${hold} while ${sw} is open: the input floats and reads noise. Add ${fix}, or read ${sw} on a GPIO with an internal pull-up${suggest(pm, p.part)}.`,
              parts: [p.part.id, sw0.part.id], pins: [endPin(p), endPin(sw0)], causes: [cause, key(sw0.part.id, sw0.pin)] })
          }
        }
      }

      if (c.outputOnly) {
        // A switch is a read only when it pulls the pin to a rail; GPA7 -> switch -> GPA0 (a key matrix) drives through it.
        const read = [...s.switches.filter((w) => farRail(pm, w) !== null), ...s.outputs.filter(notMine)]
        if (read.length) {
          const what = fewNames([...new Set(read.map((e) => (isSwitch(e) ? `${e.part.designator} (a switch)` : endName(e))))])
          out.push({ ...base, rule: 'pin-output-only',
            message: `${endName(p)} is output only${note}, but it is wired to ${what} as an input. Use another pin to read ${read.length === 1 ? 'it' : 'them'}${suggest(pm, p.part)}.`,
            parts: [p.part.id, ...read.map((e) => e.part.id)], pins: [endPin(p), ...read.map(endPin)], causes: [cause] })
        }
      }

      if (c.strapping === 'high' || c.strapping === 'low') {
        const bad = c.strapping === 'high' ? 'ground' : 'supply'
        const railName = bad === 'ground' ? 'GND' : 'the supply'
        const culprits: { e: PinEnd; text: string }[] = []
        const direct = s.role === 'mixed' ? undefined : (bad === 'ground' ? s.grounds : s.supplies).find((e) => e !== p)
        if (direct) culprits.push({ e: direct, text: `it is wired straight to ${endName(direct)}` })
        for (const r of s.resistors)
          if (farRail(pm, r) === bad) culprits.push({ e: r, text: `${r.part.designator} pulls it ${bad === 'ground' ? 'down to GND' : 'up to the supply'}` })
        for (const w of s.switches)
          if (farRail(pm, w) === bad) culprits.push({ e: w, text: `${w.part.designator} pulls it to ${railName} whenever it is closed at reset` })
        if (culprits.length) {
          const message = c.downloadOnly
            ? `${endName(p)} is a strapping pin that only matters when flashing over serial${note || `: it must be ${c.strapping} at reset for an upload, and a normal boot is unaffected`}, but ${andList(culprits.map((x) => x.text))}, so uploads can fail. Move that circuit to a GPIO that is not a strapping pin${suggest(pm, p.part)}, or make sure it is ${c.strapping} while you upload.`
            : `${endName(p)} is a strapping pin that must be ${c.strapping} at reset${note}, but ${andList(culprits.map((x) => x.text))}. Move that circuit to a GPIO that is not a strapping pin${suggest(pm, p.part)}, or make sure it is ${c.strapping} while the board starts.`
          out.push({ ...base, rule: 'pin-strapping', message,
            parts: [p.part.id, ...culprits.map((x) => x.e.part.id)], pins: [endPin(p), ...culprits.map((x) => endPin(x.e))], causes: [cause] })
        }
      }
    }
  }

  for (const bus of i2cBuses(pm)) out.push(...busFindings(pm, bus))
  return out
}

/** The pin to name a bus line by: the controller's pin (an MCU), else the first device's. */
function lineName(pm: PinModel, net: number, fallback: PinEnd | null): string {
  const ends = [...pm.net(net)].sort((a, b) => natural.compare(endName(a), endName(b)))
  const mcu = ends.find((e) => model(e) === 'mcu')
  return endName(mcu ?? fallback ?? ends[0])
}

function busFindings(pm: PinModel, bus: I2cBus): PinDraft[] {
  const out: PinDraft[] = []
  const devs = [...bus.devices].sort((a, b) => natural.compare(a.part.designator, b.part.designator))
  const first = devs[0]
  const sdaName = lineName(pm, bus.sda, pinEnd(first.part, first.spec.sda))
  const sclName = lineName(pm, bus.scl, pinEnd(first.part, first.spec.scl))
  const at = `${sdaName} (SDA) and ${sclName} (SCL)`
  const parts = devs.map((x) => x.part.id)
  const pins = devs.flatMap((x) => [{ part: x.part.id, pin: x.spec.sda }, { part: x.part.id, pin: x.spec.scl }])
  const causes = [`i2c:${sdaName}|${sclName}`]

  // Pull-ups: a resistor from the line to a supply, or a device with pull-ups on board.
  const onboard = devs.some((x) => x.spec.pullups === true)
  const wired = (net: number) => pm.net(net).some((e) => isResistor(e) && farRail(pm, e) === 'supply')
  const missing = onboard ? [] : [[bus.sda, 'SDA'], [bus.scl, 'SCL']].filter(([n]) => !wired(n as number)).map(([, l]) => l as string)
  if (missing.length) {
    const unknown = devs.filter((x) => x.spec.pullups === undefined)
    const lines = missing.length === 2 ? 'SDA and SCL' : missing[0]
    const fix = `add a 4.7 kOhm resistor from ${missing.length === 2 ? 'SDA and another from SCL' : missing[0]} to the logic supply`
    const names = andList(devs.map((x) => x.part.designator))
    if (unknown.length)
      out.push({ rule: 'i2c-pullups-unknown', subject: first.part.designator, target: at, parts, pins, nets: [bus.sda, bus.scl], causes,
        message: `The I2C bus at ${at}, with ${names} on it, has no pull-up resistor wired on ${lines}, and it is not known whether ${andList(unknown.map((x) => x.part.designator))} ${unknown.length === 1 ? 'has' : 'have'} pull-ups on board: check whether a module provides pull-ups; if none does, ${fix}.` })
    else
      out.push({ rule: 'i2c-pullups', subject: first.part.designator, target: at, parts, pins, nets: [bus.sda, bus.scl], causes,
        message: `The I2C bus at ${at}, with ${names} on it, has no pull-up on ${lines}: ${names} ${devs.length === 1 ? 'has' : 'have'} none on board and none is wired, so the bus cannot work. I2C needs one pull-up on SDA and one on SCL: ${fix}.` })
  }

  // Addresses.
  const byAddress = new Map<number, I2cDevice[]>()
  for (const x of devs) {
    const r = i2cAddress(pm, x.part)
    if (!r) continue
    if (r.floating.length) {
      const n = r.floating.length
      out.push({ rule: 'i2c-address-floating', subject: x.part.designator, target: `${x.part.designator} ${r.floating[0]}`,
        message: `${x.part.designator} ${andList(r.floating)} ${n === 1 ? 'is' : 'are'} not connected, so ${x.part.designator}'s I2C address is undefined: each address pin must be tied to GND or the supply. Connect ${n === 1 ? 'it' : 'them'} to GND or to the supply to choose its address.`,
        parts: [x.part.id], pins: r.floating.map((l) => ({ part: x.part.id, pin: pinNameOf(x.part, l) })), nets: [], causes: [`i2c-address:${x.part.id}`] })
      continue
    }
    if (r.address === null) continue
    byAddress.set(r.address, [...(byAddress.get(r.address) ?? []), x])
  }
  for (const [address, list] of byAddress) {
    if (list.length < 2) continue
    const hint = (x: I2cDevice) => {
      const a = x.spec.address!
      return 'pins' in a ? `wire ${x.part.designator}'s address pins (${a.pins.map((p) => pinEnd(x.part, p.pin)?.label ?? p.pin).join(', ')}) differently`
        : 'setting' in a ? `move ${x.part.designator}'s address resistor on the board and set its ${a.setting} in the Inspector`
        : `move ${x.part.designator} to another I2C bus (its address is fixed)`
    }
    out.push({ rule: 'i2c-address-clash', subject: list[0].part.designator, target: at,
      message: `${andList(list.map((x) => x.part.designator))} are ${list.length === 2 ? 'both' : 'all'} at I2C address ${addressText(address)} on the bus at ${at}: they answer together and the bus fails. Give each its own address: ${orList(list.slice(1).map(hint))}.`,
      parts: list.map((x) => x.part.id), pins: list.flatMap((x) => [{ part: x.part.id, pin: x.spec.sda }]), nets: [bus.sda, bus.scl], causes: [`i2c-address:${addressText(address)}`, ...list.map((x) => x.part.id)] })
  }
  return out
}

/** A pin's name from its label (address pins are named by label in messages). */
function pinNameOf(part: PinPart, label: string): string {
  const m = part.module
  return m.pins.find((p): p is PinDef => !isSpacer(p) && (p.label ?? p.name) === label)?.name ?? (m.holes ?? []).find((g) => (g.label ?? g.name) === label)?.name ?? label
}
