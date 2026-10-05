// Saved simulation state on a part (spec 3.3, 3.5, 4.0, 4.6): switch positions under
// `values["contact.<groupId>"]`, GPIO states under `values["gpio.<pin>"]`, and the additive
// overrides `sim.draw.<domain>.typical|peak`, `sim.rInternal` and `sim.imax`. Reading with
// defaults, and the checks the loader (diagram.ts) and the netlist parser use. Pure.
import { type ModuleDef, type PinCaps, isNum, isObj, pinCaps } from './module.ts'
import { type ContactKind, type Pole, mainsOf } from './mainsModel.ts'
import { simOf } from './simModel.ts'

export type ContactPosition = 'open' | 'closed' | 'no' | 'nc'
export type GpioState = 'input' | 'input-pullup' | 'input-pulldown' | 'high' | 'low'
export const GPIO_STATES: readonly GpioState[] = ['input', 'input-pullup', 'input-pulldown', 'high', 'low']
/** What a click on a GPIO pin steps through while simulating (spec 6.3); the inspector has all states. */
export const GPIO_CYCLE: readonly GpioState[] = ['input', 'high', 'low']
export interface SwitchGroup { id: string; kind: ContactKind; poles: Pole[]; changeover: boolean; momentary: boolean }

const modelOf = (m: ModuleDef) => (isObj(m.electrical) ? m.electrical.model : undefined)
const words = (list: readonly string[]) => list.map((s) => `"${s}"`).join(', ')

/** Every contact group: `electrical.contacts`, or ruling R2's implicit group "s" on a switch with terminals a and b. */
export function switchGroups(m: ModuleDef): SwitchGroup[] {
  const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
  const momentary = params.normallyOpen !== undefined
  const declared = mainsOf(m).contacts
  if (declared.length)
    return declared.map((g) => ({ id: g.id, kind: g.kind, poles: g.poles, changeover: g.poles.some((p) => p.no !== null && p.nc !== null), momentary: momentary && g.kind === 'switch' }))
  const t = isObj(m.electrical) && isObj(m.electrical.terminals) ? m.electrical.terminals : null
  if (modelOf(m) !== 'switch' || !t || typeof t.a !== 'string' || typeof t.b !== 'string') return []
  return [{ id: 's', kind: 'switch', poles: [{ com: t.a, no: t.b, nc: null }], changeover: false, momentary }]
}

const LEGACY_CLOSED = new Set(['on', 'closed', 'pressed'])
const LEGACY_OPEN = new Set(['off', 'open', 'released'])
const positions = (g: SwitchGroup): ContactPosition[] => (g.changeover ? ['no', 'nc'] : ['open', 'closed'])
/** A position that is not the rest one: com joins no. Index 1 of the mains model's groupState. */
export const isActive = (pos: ContactPosition): boolean => pos === 'closed' || pos === 'no'

/**
 * A group's position now: `values["contact.<id>"]`; else, on a one-group switch, the legacy
 * `values.state` (ruling R3); else the rest position (open, or nc for a changeover), which is the
 * mains model's groupState 0. Relays and SSRs are always at rest (ruling R4); a momentary button
 * is active only while `held` (never saved).
 */
export function contactPosition(part: { values?: Record<string, unknown> }, m: ModuleDef, g: SwitchGroup, held?: boolean): ContactPosition {
  const rest: ContactPosition = g.changeover ? 'nc' : 'open'
  const active: ContactPosition = g.changeover ? 'no' : 'closed'
  if (g.kind !== 'switch') return rest
  if (g.momentary) return held ? active : rest
  const v = part.values?.[`contact.${g.id}`]
  if (typeof v === 'string' && (positions(g) as string[]).includes(v)) return v as ContactPosition
  const legacy = part.values?.state
  if (switchGroups(m).length === 1 && typeof legacy === 'string') {
    if (LEGACY_CLOSED.has(legacy)) return active
    if (LEGACY_OPEN.has(legacy)) return rest
  }
  return rest
}

/** The terminal pairs that conduct at a position: com to no when active, com to nc at rest. */
export function closedPairs(g: SwitchGroup, pos: ContactPosition): [string, string][] {
  const act = isActive(pos)
  return g.poles.flatMap((p): [string, string][] => {
    const to = act ? p.no : p.nc
    return to ? [[p.com, to]] : []
  })
}

/** Why a GPIO state is not allowed on a pin with these caps (spec 3.3), or null. */
export function gpioProblem(caps: PinCaps | undefined, v: string): string | null {
  if (!(GPIO_STATES as readonly string[]).includes(v)) return `must be one of ${words(GPIO_STATES)}`
  if (caps?.inputOnly && (v === 'high' || v === 'low')) return 'the pin is input only, so it cannot drive high or low'
  if (caps?.outputOnly && v.startsWith('input')) return 'the pin is output only, so it cannot be an input'
  if (caps?.noPullup && (v === 'input-pullup' || v === 'input-pulldown')) return 'the pin has no internal pull-up or pull-down'
  return null
}

/** A GPIO pin's state: its admissible saved state, else "input"; null for an output-only pin with none set (open) and for a pin that is not GPIO-capable. */
export function gpioState(part: { values?: Record<string, unknown> }, m: ModuleDef, pin: string): GpioState | null {
  if (!simOf(m)?.gpio?.pins.includes(pin)) return null
  const caps = pinCaps(m, pin)
  const v = part.values?.[`gpio.${pin}`]
  if (typeof v === 'string' && gpioProblem(caps, v) === null) return v as GpioState
  return caps?.outputOnly ? null : 'input'
}

export const isSimValueKey = (key: string): boolean => key.startsWith('gpio.') || key.startsWith('contact.') || key.startsWith('sim.')

const amount = (entry: unknown, unit: 'A' | 'ohm', allowZero: boolean): string | null =>
  isObj(entry) && isNum(entry.value) && entry.unit === unit && (allowZero ? entry.value >= 0 : entry.value > 0) && entry.value <= 1e6
    ? null
    : `it must be { "value": <number ${allowZero ? '0 or more' : 'above 0'}>, "unit": "${unit}" }`

/**
 * What is wrong with one simulation value on a part, or null. `electrical` marks a `sim.*`
 * number (dropping it changes the solved circuit: the loader ends its warning with VALUE_DROPPED).
 * With no module to check against (not embedded), nothing is claimed.
 */
export function simValueProblem(key: string, entry: unknown, m: ModuleDef | undefined): { text: string; electrical: boolean } | null {
  if (!m) return null
  if (key.startsWith('gpio.')) {
    const pin = key.slice(5)
    if (!simOf(m)?.gpio?.pins.includes(pin)) return { text: `pin "${pin}" is not a GPIO pin of ${m.name}`, electrical: false }
    if (typeof entry !== 'string') return { text: `it must be one of ${words(GPIO_STATES)}`, electrical: false }
    const p = gpioProblem(pinCaps(m, pin), entry)
    return p ? { text: p, electrical: false } : null
  }
  if (key.startsWith('contact.')) {
    const g = switchGroups(m).find((x) => x.id === key.slice(8))
    if (!g) return { text: `${m.name} has no contact group "${key.slice(8)}"`, electrical: false }
    if (g.kind !== 'switch') return { text: `a ${g.kind} is always shown at rest`, electrical: false }
    if (g.momentary) return { text: 'it is a momentary button; its position is never saved', electrical: false }
    const allowed = positions(g)
    return typeof entry === 'string' && (allowed as string[]).includes(entry) ? null : { text: `it must be ${allowed.map((s) => `"${s}"`).join(' or ')}`, electrical: false }
  }
  const sim = simOf(m)
  const isCell = isObj(m.electrical) && m.electrical.model === 'voltage_source'
  if (key === 'sim.rInternal' || key === 'sim.imax') {
    if (!isCell && !sim?.power?.source) return { text: `${m.name} is not a battery or supply`, electrical: true }
    const p = amount(entry, key === 'sim.imax' ? 'A' : 'ohm', false)
    return p ? { text: p, electrical: true } : null
  }
  const draw = /^sim\.draw\.(.+)\.(typical|peak)$/.exec(key)
  if (draw) {
    if (!sim?.power?.domains.some((d) => d.name === draw[1])) return { text: `${m.name} has no supply domain "${draw[1]}"`, electrical: true }
    const p = amount(entry, 'A', true)
    return p ? { text: p, electrical: true } : null
  }
  return { text: 'unknown simulation value (sim.draw.<domain>.typical, sim.draw.<domain>.peak, sim.rInternal or sim.imax)', electrical: true }
}

/** A `sim.*` override's number (validated on load), or null. */
export function simOverride(part: { values?: Record<string, unknown> }, key: string): number | null {
  const v = part.values?.[key]
  return isObj(v) && isNum(v.value) ? v.value : null
}
