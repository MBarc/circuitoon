// Spec 3.3, 3.5, 4.0 and 4.6: saved switch positions and GPIO states, the loader and netlist checks,
// and the single-state mains evaluation that decides whether an AC-DC converter is powered now.
import { describe, expect, it } from 'vitest'
import type { Diagram, PartInstance } from './diagram.ts'
import { VALUE_DROPPED, validateDiagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { closedPairs, contactPosition, gpioState, isActive, simOverride, simValueProblem, switchGroups } from './simState.ts'
import { convertersInState } from './mainsRules.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'

/** A two-GPIO board: IO1 any state, IO2 input only, IO3 output only, IO4 with no pulls. */
const board: ModuleDef = {
  format: 'circuitoon-module/1', id: 'test-gpio-board', name: 'GPIO board',
  pins: [
    { name: '3V3', side: 'left', type: 'power_in' }, { name: 'GND', side: 'left', type: 'ground' },
    { name: 'IO1', side: 'right', type: 'io' }, { name: 'IO2', side: 'right', type: 'io', caps: { inputOnly: true } },
    { name: 'IO3', side: 'right', type: 'io', caps: { outputOnly: true } }, { name: 'IO4', side: 'right', type: 'io', caps: { noPullup: true } },
  ],
  electrical: {
    model: 'mcu',
    sim: {
      power: { domains: [{ name: '3V3', pin: '3V3', ret: 'GND', nominal: 3.3 }], draw: [{ domain: '3V3', typical: { value: 0.01, unit: 'A', provenance: 'estimate', note: 't' } }] },
      gpio: { domain: '3V3', pins: ['IO1', 'IO2', 'IO3', 'IO4'], outputResistance: { value: 30, unit: 'ohm', provenance: 'estimate', note: 't' } },
    },
  },
}
const part = (values: Record<string, unknown>): PartInstance => ({ uid: 'u1', designator: 'U1', module: 'x', x: 0, y: 0, values })

describe('switch groups and saved positions (spec 4.0)', () => {
  it('reads declared groups and gives contact-less switches the implicit group "s" (ruling R2)', () => {
    expect(switchGroups(load('rocker-switch-kcd1'))).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }], changeover: false, momentary: false }])
    expect(switchGroups(load('push-button'))).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }], changeover: false, momentary: true }])
    expect(switchGroups(load('tilt-switch-sw520d'))[0].momentary).toBe(false)
    expect(switchGroups(load('relay-module-1ch-5v'))[0]).toMatchObject({ id: 'k', kind: 'relay', changeover: true })
  })
  it('defaults to open (nc for a changeover), reads contact.<id>, maps legacy values.state, and keeps relays at rest', () => {
    const kcd1 = load('rocker-switch-kcd1')
    const [g] = switchGroups(kcd1)
    expect(contactPosition(part({}), kcd1, g)).toBe('open')
    expect(contactPosition(part({ 'contact.s': 'closed' }), kcd1, g)).toBe('closed')
    expect(contactPosition(part({ state: 'on' }), kcd1, g)).toBe('closed')
    expect(contactPosition(part({ state: 'sideways' }), kcd1, g)).toBe('open')
    const relay = load('relay-module-1ch-5v')
    expect(contactPosition(part({ 'contact.k': 'no' }), relay, switchGroups(relay)[0])).toBe('nc')
  })
  it('closes a momentary button only while held, never from a saved value', () => {
    const b = load('push-button')
    const [g] = switchGroups(b)
    expect(contactPosition(part({ 'contact.s': 'closed' }), b, g)).toBe('open')
    expect(contactPosition(part({}), b, g, true)).toBe('closed')
  })
  it('conducts com to no when active and com to nc at rest', () => {
    const [g] = switchGroups(load('relay-module-1ch-5v'))
    expect(closedPairs(g, 'nc')).toEqual([['COM', 'NC']])
    expect(closedPairs(g, 'no')).toEqual([['COM', 'NO']])
    expect(isActive('closed') && !isActive('open')).toBe(true)
  })
})

describe('GPIO state (spec 3.3, 4.6)', () => {
  it('defaults to input, reads gpio.<pin>, and refuses states the caps forbid', () => {
    expect(gpioState(part({}), board, 'IO1')).toBe('input')
    expect(gpioState(part({ 'gpio.IO1': 'high' }), board, 'IO1')).toBe('high')
    expect(gpioState(part({ 'gpio.IO2': 'high' }), board, 'IO2')).toBe('input')
    expect(gpioState(part({}), board, 'IO3')).toBeNull()
    expect(gpioState(part({ 'gpio.IO3': 'low' }), board, 'IO3')).toBe('low')
    expect(gpioState(part({ 'gpio.IO4': 'input-pulldown' }), board, 'IO4')).toBe('input')
    expect(gpioState(part({}), board, '3V3')).toBeNull()
  })
  it('names what is wrong with a stored state or override', () => {
    expect(simValueProblem('gpio.IO2', 'high', board)?.text).toContain('input only')
    expect(simValueProblem('gpio.IO3', 'input', board)?.text).toContain('output only')
    expect(simValueProblem('gpio.IO4', 'input-pullup', board)?.text).toContain('no internal pull-up or pull-down')
    expect(simValueProblem('gpio.GND', 'high', board)?.text).toContain('not a GPIO pin')
    expect(simValueProblem('gpio.IO1', 'sideways', board)?.text).toContain('must be one of')
    expect(simValueProblem('contact.s', 'closed', load('push-button'))?.text).toContain('momentary')
    expect(simValueProblem('contact.k', 'no', load('relay-module-1ch-5v'))?.text).toContain('at rest')
    expect(simValueProblem('contact.s', 'no', load('rocker-switch-kcd1'))?.text).toContain('"open" or "closed"')
    expect(simValueProblem('sim.draw.3V3.typical', { value: 0.05, unit: 'A' }, board)).toBeNull()
    expect(simValueProblem('sim.draw.5V.typical', { value: 0.05, unit: 'A' }, board)?.electrical).toBe(true)
    expect(simValueProblem('sim.rInternal', { value: 0.08, unit: 'ohm' }, load('battery-18650-holder'))).toBeNull()
    expect(simValueProblem('sim.rInternal', { value: -1, unit: 'ohm' }, load('battery-18650-holder'))?.electrical).toBe(true)
    expect(simValueProblem('sim.other', 1, board)?.text).toContain('unknown')
    expect(simOverride(part({ 'sim.imax': { value: 2, unit: 'A' } }), 'sim.imax')).toBe(2)
  })
})

describe('the loader and the netlist parser (ruling R24)', () => {
  const sheet = (values: Record<string, unknown>): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: { 'test-gpio-board': board }, parts: [{ uid: 'u1', designator: 'U1', module: 'test-gpio-board', x: 0, y: 0, values }], connections: [] })
  it('drops a bad GPIO state with a plain warning, and a bad sim override with the dropped-value ending', () => {
    const r = validateDiagram(sheet({ 'gpio.IO2': 'high', 'sim.draw.3V3.typical': { value: 'x', unit: 'A' }, 'gpio.IO1': 'low' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.parts[0].values).toEqual({ 'gpio.IO1': 'low' })
    expect(r.warnings.some((w) => w.includes('gpio.IO2') && !w.endsWith(VALUE_DROPPED))).toBe(true)
    expect(r.warnings.some((w) => w.includes('sim.draw.3V3.typical') && w.endsWith(VALUE_DROPPED))).toBe(true)
  })
  it('refuses a bad state in a netlist', () => {
    const r = parseNetlist({ format: 'circuitoon-netlist/1', title: 't', parts: [{ ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'no' } }], nets: [] }, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('parts[0].values.contact.s')
  })
})

describe('single-state converter availability (spec 4 table)', () => {
  // A US outlet's L through a KCD1 rocker to an HLK-PM01's AC 1, and N straight to AC 2.
  const mods = Object.fromEntries(['outlet-us-5-15r-duplex', 'rocker-switch-kcd1', 'hlk-pm01'].map((id) => [id, load(id)]))
  const d = (values: Record<string, unknown>): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: mods,
    parts: [
      { uid: 'o1', designator: 'J1', module: 'outlet-us-5-15r-duplex', x: 0, y: 0 },
      { uid: 's1', designator: 'S1', module: 'rocker-switch-kcd1', x: 300, y: 0, values },
      { uid: 'p1', designator: 'PS1', module: 'hlk-pm01', x: 600, y: 0 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'o1', pin: 'L1' }, to: { part: 's1', pin: '1' } },
      { uid: 'w2', from: { part: 's1', pin: '2' }, to: { part: 'p1', pin: 'AC 1' } },
      { uid: 'w3', from: { part: 'o1', pin: 'N1' }, to: { part: 'p1', pin: 'AC 2' } },
    ],
  })
  const active = (sheet: Diagram) => (p: PartInstance, id: string) => {
    const m = sheet.modules[p.module]
    const g = switchGroups(m).find((x) => x.id === id)
    return !!g && isActive(contactPosition(p, m, g))
  }
  it('is powered with the rocker saved closed, and unpowered with it open', () => {
    const on = d({ 'contact.s': 'closed' })
    expect(convertersInState(on, active(on)).get('p1')?.state).toBe('powered')
    const off = d({})
    expect(convertersInState(off, active(off)).get('p1')?.state).not.toBe('powered')
  })
})
