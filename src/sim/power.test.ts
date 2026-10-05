// Spec 3.2, 3.3, 4.6, 4.7: a board's domains, its draw as a voltage-aware load, its rails with the
// spec's defaults, its GPIO states, an external source, the USB cable between a host and a device,
// and the cases that are not simulated (hub, host without data, incomplete rail).
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { boardModule, boostModule, buckModule, cellModule, hostModule, ldoModule, q, sheet } from './testing.ts'
import { type Device, gpioBranch } from './model.ts'
import { IDEAL_DIODE } from './ledModels.ts'
import type { Diagram, PartInstance } from '../format/diagram.ts'
import { type ModuleDef, layoutModule } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'
import { pivot } from '../format/geometry.ts'
import { simOf } from '../format/simModel.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { SOCKET_PATTERNS } from '../format/plugging.ts'

const byId = (devs: Device[], id: string) => devs.find((d) => d.id === id)
const branch = (d: Device | undefined) => (d?.kind === 'gpio' ? gpioBranch(d) : undefined)

describe('power models', () => {
  it('records domains, a voltage-aware load with the 90 % minVolts default, and both rails with defaults', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule() }], []))
    expect(c.domains.map((d) => `${d.name}:${d.pin}/${d.ret}`)).toEqual(['VIN:u1:VIN/u1:GND', 'USB:u1:USB#vbus/u1:GND', '3V3:u1:3V3/u1:GND'])
    const load3 = byId(c.devices, 'u1.draw.3V3')!
    expect(load3.kind === 'load' && [load3.typical.value, load3.peak.value, load3.peakNote, load3.minVolts.value, load3.minVolts.basis]).toEqual([0.05, 0.25, 'radio', 0.9 * 3.3, 'estimate'])
    const ldo = byId(c.devices, 'u1.rail.ldo')!
    expect(ldo.kind === 'rail' && [ldo.in, ldo.out, ldo.ret, ldo.rail.rout.value, ldo.rail.rout.basis, ldo.rail.offPath]).toEqual(['u1.rail.ldo#in', 'u1:3V3', 'u1:GND', 0.1, 'estimate', 'open'])
    expect(byId(c.devices, 'u1.rail.ldo.in.VIN')).toMatchObject({ kind: 'resistor', role: 'rail-input', a: 'u1:VIN', b: 'u1.rail.ldo#in' })
    expect(byId(c.devices, 'u1.rail.usb-diode')).toMatchObject({ kind: 'diode', role: 'switch-rail', k: 'u1:VIN' })
  })
  it('takes a user override of the draw, marked user', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.12, unit: 'A' } } }], []))
    const l = byId(c.devices, 'u1.draw.3V3')!
    expect(l.kind === 'load' && [l.typical.value, l.typical.basis]).toEqual([0.12, 'user'])
  })
  it('puts the category estimate on the GPIO domain, else a rail output, else the first domain (fix wave, finding 5)', () => {
    // It used to land on domains[0] (VIN here), bypassing the board's LDO.
    const estimateOn = (m: ModuleDef) => buildCircuit(sheet([{ uid: 'u1', module: m }], [])).devices.filter((d) => d.kind === 'load').map((d) => d.kind === 'load' && [d.id, d.typical.value, d.typical.basis])
    const b = boardModule({ draw: false })
    expect(estimateOn({ ...b, id: 'test-esp32-board' })).toEqual([['u1.draw.3V3', 0.08, 'estimate']])
    const { gpio: _, ...noGpio } = simOfMod(b)
    expect(estimateOn(withSim(b, noGpio, 'test-esp32-nogpio'))).toEqual([['u1.draw.3V3', 0.08, 'estimate']])
    const noRails = { ...noGpio, power: { ...noGpio.power, rails: [] } }
    expect(estimateOn(withSim(b, noRails, 'test-esp32-bare'))).toEqual([['u1.draw.VIN', 0.08, 'estimate']])
  })
  // Fix wave 7a: one gpio device per pin holds its state and every value; gpioBranch gives the
  // resistor the state selects (these were separate resistor roles gpio, pull and leak).
  it('compiles GPIO states from the real IO domain node (spec 4.6)', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high', 'gpio.IO2': 'input-pulldown' } }], []))
    expect(byId(c.devices, 'u1.gpio.IO1')).toMatchObject({ kind: 'gpio', pin: 'IO1', node: 'u1:IO1', vdd: 'u1:3V3', ret: 'u1:GND', domain: '3V3', state: 'high' })
    expect(branch(byId(c.devices, 'u1.gpio.IO1'))).toMatchObject({ a: 'u1:3V3', b: 'u1:IO1', ohms: { value: 30 }, leak: false })
    expect(branch(byId(c.devices, 'u1.gpio.IO2'))).toMatchObject({ a: 'u1:IO2', b: 'u1:GND', ohms: { value: 45000 }, leak: false })
    expect(c.gpio.map((g) => `${g.pin}:${g.state}`)).toEqual(['IO1:high', 'IO2:input-pulldown'])
    const low = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'low' } }], []))
    expect(branch(byId(low.devices, 'u1.gpio.IO1'))).toMatchObject({ a: 'u1:IO1', b: 'u1:GND' })
  })
  it('keeps one gpio device per pin whatever its state, so a state change is a parameter change', () => {
    const shape = (state: string) => {
      const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule({ leak: true }), values: { 'gpio.IO1': state } }], []))
      return JSON.stringify([c.taps, c.devices.map((d) => (d.kind === 'gpio' ? { ...d, state: 'x' } : d))])
    }
    const base = shape('input')
    for (const s of ['input-pullup', 'input-pulldown', 'high', 'low']) expect(shape(s)).toBe(base)
  })
  it('joins a host and a device by a cable on both conductors, with the host port limit', () => {
    const c = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']]))
    expect(byId(c.devices, 'h1.source')).toMatchObject({ kind: 'cell', role: 'external', p: 'h1:USB#vbus', n: 'h1:USB#gnd' })
    // Fix wave finding 3: #vbus (and an unmapped #gnd) is a tapped pin, and the cable joins the port
    // nets outside both parts' senses, so each sense carries the port's current.
    expect(c.taps.filter((t) => t.pin.includes('#')).map((t) => `${t.node}@${t.net}`)).toEqual(['h1:USB#gnd@H1_USB_GND', 'h1:USB#vbus@H1_USB_VBUS', 'u1:USB#vbus@U1_USB_VBUS'])
    expect(byId(c.devices, 'usb.w1.vbus')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'net:H1_USB_VBUS', b: 'net:U1_USB_VBUS' })
    expect(byId(c.devices, 'usb.w1.gnd')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'net:H1_USB_GND', b: `net:${c.pinNet[JSON.stringify(['u1', 'GND'])]}` })
    expect(c.usb).toEqual([expect.objectContaining({ host: 'h1', device: 'u1', limit: expect.objectContaining({ value: 0.5, basis: 'datasheet' }) })])
  })
  it('lets an external source sim.imax override replace its sourceCurrent limit, as user', () => {
    const h = hostModule()
    const withLimit: ModuleDef = { ...h, electrical: { ...(h.electrical as object), sim: { ...(h.electrical as { sim: object }).sim, limits: [{ of: { part: true }, kind: 'sourceCurrent', value: 0.5, provenance: 'datasheet', source: 'https://example.com/x' }] } } }
    const c = buildCircuit(sheet([{ uid: 'h1', module: withLimit, values: { 'sim.imax': { value: 1, unit: 'A' } } }], []))
    const s = byId(c.devices, 'h1.source')!
    expect(s.kind === 'cell' && [s.imax?.value, s.imax?.basis]).toEqual([1, 'user'])
    expect(c.limits.map((l) => [l.kind, l.value.value, l.value.basis])).toEqual([['sourceCurrent', 1, 'user']])
  })
  it('takes a param:voltage source from the part value, and skips the part when it has none', () => {
    const h = hostModule()
    const e = h.electrical as { sim: { power: { source: object } } }
    const m = (dflt: number | null): ModuleDef => ({ ...h, electrical: { ...e, params: { voltage: { unit: 'V', default: dflt } }, sim: { ...e.sim, power: { ...e.sim.power, source: { ...e.sim.power.source, voltage: 'param:voltage' } } } } })
    const s = byId(buildCircuit(sheet([{ uid: 'h1', module: m(9) }], [])).devices, 'h1.source')!
    expect(s.kind === 'cell' && [s.volts.value, s.volts.basis]).toEqual([9, 'user'])
    const none = buildCircuit(sheet([{ uid: 'h1', module: m(null) }], []))
    expect([none.devices, none.domains, none.unsimulated]).toEqual([[], [], [{ part: 'h1', reason: 'no voltage value' }]])
  })
  it('does not simulate USB power from a host with no power data, or through a hub (ruling R7)', () => {
    const c = buildCircuit(sheet([{ uid: 'j1', module: 'rpi-4-model-b' }, { uid: 'u1', module: boardModule() }], [['j1.USB2-1', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered from J1 over USB, which has no power data' })
    // P1 is a downstream (host-role) port of the hub.
    const h = buildCircuit(sheet([{ uid: 'x1', module: 'usb-hub-powered-4port' }, { uid: 'u1', module: boardModule() }], [['x1.P1', 'u1.USB']]))
    expect(h.unsimulated).toContainEqual({ part: 'u1', reason: 'powered through a hub: not simulated yet' })
  })
  it('lists a part whose rail lacks a required field, naming it (spec 3.1)', () => {
    const bad = ldoModule({ dropout: undefined }, 'test-bad-ldo')
    const c = buildCircuit(sheet([{ uid: 'u1', module: bad }, { uid: 'bt1', module: cellModule(5, 0.1) }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'incomplete power data: rail ldo needs dropout' })
  })
  it('lists an output-only GPIO with no state set as not simulated (spec 3.3)', () => {
    const m = boardModule()
    const outOnly: ModuleDef = { ...m, id: 'test-out-only', pins: m.pins.map((p) => ('name' in p && p.name === 'IO2' ? { ...p, caps: { outputOnly: true as const } } : p)) }
    const c = buildCircuit(sheet([{ uid: 'u1', module: outOnly }], []))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'pin IO2: output-only pin with no state set' })
  })
  it('takes the AC-DC converter output as a source only when powered in the saved state', () => {
    const hlk = load('hlk-pm01')
    const withSource: ModuleDef = { ...hlk, electrical: { ...(hlk.electrical as object), sim: { power: { domains: [{ name: 'OUT', pin: '+Vo', ret: '-Vo', nominal: 5 }], source: { domain: 'OUT', voltage: q(5, 'V'), rInternal: q(0.1, 'ohm', 'estimate') } } } } }
    const parts = (values: Record<string, unknown>) => [{ uid: 'o1', module: 'outlet-us-5-15r-duplex' }, { uid: 's1', module: 'rocker-switch-kcd1', values }, { uid: 'p1', module: withSource }]
    const wires: [string, string][] = [['o1.L1', 's1.1'], ['s1.2', 'p1.AC 1'], ['o1.N1', 'p1.AC 2']]
    expect(byId(buildCircuit(sheet(parts({ 'contact.s': 'closed' }), wires)).devices, 'p1.source')).toMatchObject({ kind: 'cell', role: 'external' })
    const off = buildCircuit(sheet(parts({}), wires))
    expect(byId(off.devices, 'p1.source')).toBeUndefined()
    expect(off.notes.join(' ')).toContain('P1: its mains input is off')
  })
  it('says the IP5306 USB-C charge input is not simulated when a cable feeds it (Phase C checkpoint, finding 5)', () => {
    const note = 'U1: USB-C charge input is not simulated: the module runs from its battery only'
    const fed = buildCircuit(sheet([{ uid: 'h1', module: 'computer-usb-port' }, { uid: 'u1', module: 'ip5306-usbc-module' }], [['h1.USB', 'u1.USB-C']]))
    expect(fed.notes).toContain(note)
    expect(buildCircuit(sheet([{ uid: 'u1', module: 'ip5306-usbc-module' }], [])).notes).not.toContain(note)
    // A port that feeds a rail says nothing.
    expect(buildCircuit(sheet([{ uid: 'h1', module: 'computer-usb-port' }, { uid: 'u1', module: 'esp32-devkit-v1-30' }], [['h1.USB', 'u1.USB']])).notes.join(' ')).not.toContain('charge input')
  })
  it("lists what each simulated part's data leaves out (sim.unaccounted, Phase C checkpoint finding 4)", () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: 'esp32-devkit-v1-30' }, { uid: 'u2', module: 'ams1117-33-module' }, R10], []))
    expect(c.unaccounted.map((x) => x.part)).toEqual(['u1', 'u2'])
    expect(c.unaccounted[0].items).toEqual(simOf(load('esp32-devkit-v1-30'))!.unaccounted)
    expect(c.unaccounted[0].items.length).toBeGreaterThan(0)
    // A part that is not simulated lists nothing.
    const none = buildCircuit(sheet([{ uid: 'u1', module: withSim(load('ams1117-33-module'), { ...simOfMod(load('ams1117-33-module')), power: { domains: [], rails: [badRail] } }, 'test-ams-bad') }], []))
    expect(none.unaccounted).toEqual([])
  })
  it('takes a plug-in supply whose plug is not on the sheet as plugged in, with a note (Phase C checkpoint)', () => {
    for (const id of ['charger-usb-5v-us', 'adapter-barrel-eu']) {
      const out = id.startsWith('charger') ? ['5V', 'GND'] : ['+', '-']
      const c = buildCircuit(sheet([{ uid: 'ps1', module: id }, R10], [[`ps1.${out[0]}`, 'r1.1'], ['r1.2', `ps1.${out[1]}`]]))
      expect(byId(c.devices, 'ps1.source')).toMatchObject({ kind: 'cell', role: 'external' })
      expect(c.notes).toContain('PS1: assumed plugged into a live outlet (its plug is not on the sheet)')
    }
  })
  it('a charger plugged into a switched outlet follows the saved switch state', () => {
    // A split-wired duplex (the tab between the sockets broken off, so no internal L1-L2 join; the
    // library outlets keep it): the lower socket is fed from L1 through a KCD1 rocker.
    const { internal: _, ...duplex } = load('outlet-us-5-15r-duplex')
    const split: ModuleDef = { ...duplex, id: 'test-outlet-split' }
    const parts = (values: Record<string, unknown>): Diagram => {
      const d = sheet([{ uid: 'o1', module: split }, { uid: 's1', module: 'rocker-switch-kcd1', values }, R10],
        [['o1.L1', 's1.1'], ['s1.2', 'o1.L2'], ['o1.N1', 'o1.N2']])
      const o1 = d.parts[0]
      const charger = onSocket('ps1', 'charger-usb-5v-us', o1, split, 1)
      return {
        ...d, modules: { ...d.modules, 'charger-usb-5v-us': load('charger-usb-5v-us') }, parts: [...d.parts, charger],
        connections: [...d.connections, { uid: 'w9', from: { part: 'ps1', pin: '5V' }, to: { part: 'r1', pin: '1' } }, { uid: 'w10', from: { part: 'r1', pin: '2' }, to: { part: 'ps1', pin: 'GND' } }],
      }
    }
    const on = buildCircuit(parts({ 'contact.s': 'closed' }))
    expect(byId(on.devices, 'ps1.source')).toMatchObject({ kind: 'cell', role: 'external' })
    expect(on.notes.join(' ')).not.toContain('assumed plugged')
    const off = buildCircuit(parts({}))
    expect(byId(off.devices, 'ps1.source')).toBeUndefined()
    expect(off.notes).toContain('PS1: its mains input is off in the saved switch state, so its output is off')
  })
})

const R10 = { uid: 'r1', module: 'resistor', values: { resistance: { value: 10, unit: 'ohm' } } }
/** A plug-in device placed and mounted so its plug sits in the outlet's socket `index` (as in mainsCircuits.test.ts). */
function onSocket(uid: string, module: string, outlet: PartInstance, om: ModuleDef, index: number): PartInstance {
  const s = mainsOf(om).sockets[index]
  const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
  const [[lx, ly]] = holes.get(s.contacts.find((c) => c.role === 'L')!.group)!
  const [[px, py]] = SOCKET_PATTERNS[s.family].L
  const c = pivot(layoutModule(load(module)).w, layoutModule(load(module)).h)
  return { uid, designator: uid.toUpperCase(), module, x: outlet.x + lx - px - c.x, y: outlet.y + ly - py - c.y, rotation: 0, mount: { board: outlet.uid } }
}

// Fix round 1: no crash or silent 0 A without draw data, USB ends that are not simulated, unclear
// roles, notes for rails it cannot place, and the remaining GPIO, rail and USB cases.
type Sim = { power: { domains: object[]; draw?: object[]; rails?: object[]; source?: object }; gpio?: object; usbPorts?: object; limits?: object[] }
const simOfMod = (m: ModuleDef) => (m.electrical as { sim: Sim }).sim
const withSim = (m: ModuleDef, sim: Sim, id: string, model?: string): ModuleDef => ({ ...m, id, electrical: { ...(m.electrical as object), ...(model ? { model } : {}), sim } })
const withUsb = (m: ModuleDef, usb: object, id: string): ModuleDef => ({ ...m, id, pins: m.pins.map((p) => ('usb' in p && p.usb ? { ...p, usb: { ...p.usb, ...usb } } : p)) as ModuleDef['pins'] })
const badRail = { id: 'bad', inputs: [], output: '3V3', kind: 'ldo', reverse: 'blocks' }

describe('power models: fix round 1', () => {
  it('skips a part whose category estimate applies but that has no domains, without a crash', () => {
    const m = withSim(boardModule({ draw: false }), { power: { domains: [] } }, 'test-esp32-nodomains')
    const c = buildCircuit(sheet([{ uid: 'u1', module: m }], []))
    expect([c.devices, c.unsimulated]).toEqual([[], [{ part: 'u1', reason: 'no power data' }]])
  })
  it('lists a part with no draw, no estimate, no rails and no source as no power data, never a silent 0 A', () => {
    const b = boardModule({ draw: false })
    const m = withSim(b, { power: { domains: simOfMod(b).power.domains } }, 'test-thing', 'thing')
    const c = buildCircuit(sheet([{ uid: 'u1', module: m }], []))
    expect(c.unsimulated).toEqual([{ part: 'u1', reason: 'no power data' }])
    expect(c.devices.filter((d) => d.kind === 'load')).toEqual([])
  })
  it('lists the device when its USB host is not simulated, and compiles no link to a device that is not', () => {
    const h = hostModule()
    const badHost = withSim(h, { power: { ...simOfMod(h).power, rails: [badRail] } }, 'test-bad-host')
    const c = buildCircuit(sheet([{ uid: 'h1', module: badHost }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered over USB from H1, which is not simulated' })
    expect([c.usb, c.devices.filter((d) => d.id.startsWith('usb.'))]).toEqual([[], []])
    const b = boardModule()
    const badDev = withSim(b, { ...simOfMod(b), power: { ...simOfMod(b).power, rails: [badRail] } }, 'test-bad-dev')
    const d = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: badDev }], [['h1.USB', 'u1.USB']]))
    expect([d.usb, d.devices.filter((x) => x.id.startsWith('usb.')), d.taps.filter((t) => t.part === 'u1')]).toEqual([[], [], []])
    expect(d.unsimulated).toEqual([{ part: 'u1', reason: 'incomplete power data: rail bad needs vout, dropout, ioutMax' }])
  })
  it('compiles the USB link to a custom device with gpio but no power data, without a crash or a charge-input note', () => {
    const b = boardModule()
    const { power: _, ...gpioOnly } = simOfMod(b)
    const dev = withSim(b, gpioOnly as Sim, 'test-gpio-only', 'switch')
    const c = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: dev }], [['h1.USB', 'u1.USB']]))
    expect(c.usb).toHaveLength(1)
    expect(c.notes.filter((n) => n.includes('charge input'))).toEqual([])
  })
  it('compiles no link between two ports with no clear host and device', () => {
    const c = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'h2', module: hostModule() }], [['h1.USB', 'h2.USB']]))
    expect([c.usb, c.devices.filter((d) => d.id.startsWith('usb.'))]).toEqual([[], []])
  })
  it('uses the plug resistance for a plug pushed into a socket, and the USB default when the host states no source', () => {
    const host = withUsb(hostModule(), { source: undefined, version: '3.0' }, 'test-host-3')
    const dev = withUsb(boardModule(), { connector: 'A', gender: 'plug' }, 'test-plug-board')
    const c = buildCircuit(sheet([{ uid: 'h1', module: host }, { uid: 'u1', module: dev }], [['h1.USB', 'u1.USB']]))
    expect(byId(c.devices, 'usb.w1.vbus')).toMatchObject({ ohms: { value: 0.02, basis: 'estimate', label: 'plug.w1.vbus' } })
    expect(c.usb[0].limit).toMatchObject({ value: 0.9, basis: 'representative', label: 'usb-default.3.0' })
  })
  it('compiles input-pullup and input leakage (labelled as derived) GPIO states', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule({ leak: true }), values: { 'gpio.IO1': 'input-pullup' } }], []))
    expect(branch(byId(c.devices, 'u1.gpio.IO1'))).toMatchObject({ a: 'u1:3V3', b: 'u1:IO1', ohms: { value: 45000 }, leak: false })
    const leak = branch(byId(c.devices, 'u1.gpio.IO2'))!
    expect(leak).toMatchObject({ a: 'u1:IO2', b: 'u1:GND', leak: true })
    expect([leak.ohms.value, leak.ohms.note]).toEqual([3.3 / 5e-8, 'derived: domain nominal / inputLeakage'])
  })
  it('compiles a switch rail with ron as a resistor, one-way through a near-ideal diode when it blocks (Phase C checkpoint, finding 3)', () => {
    const b = boardModule()
    const sim = simOfMod(b)
    const ron = (reverse: string) => {
      const rails = (sim.power.rails as { id: string }[]).map((r) => (r.id === 'usb-diode' ? { ...r, vf: undefined, ron: q(0.05, 'ohm'), reverse } : r))
      return buildCircuit(sheet([{ uid: 'u1', module: withSim(b, { ...sim, power: { ...sim.power, rails } }, `test-ron-${reverse}`) }], []))
    }
    const blocks = ron('blocks')
    expect(byId(blocks.devices, 'u1.rail.usb-diode')).toMatchObject({ kind: 'resistor', role: 'switch-rail', a: 'u1.rail.usb-diode#in', b: 'u1.rail.usb-diode#block', ohms: { value: 0.05 } })
    expect(byId(blocks.devices, 'u1.rail.usb-diode.block')).toMatchObject({ kind: 'diode', role: 'switch-rail', a: 'u1.rail.usb-diode#block', k: 'u1:VIN', model: IDEAL_DIODE })
    const both = ron('body-diode')
    expect(byId(both.devices, 'u1.rail.usb-diode')).toMatchObject({ kind: 'resistor', a: 'u1.rail.usb-diode#in', b: 'u1:VIN' })
    expect(byId(both.devices, 'u1.rail.usb-diode.block')).toBeUndefined()
  })
  it('gives buck and boost rails the iq and rout defaults, and passes offPath and reverse through', () => {
    const rail = (m: ModuleDef, id: string) => {
      const d = byId(buildCircuit(sheet([{ uid: 'u1', module: m }], [])).devices, `u1.rail.${id}`)!
      return d.kind === 'rail' ? d.rail : null
    }
    const buck = rail(buckModule(), 'buck')!
    expect([buck.iq.value, buck.iq.basis, buck.rout.value, buck.rout.basis, buck.offPath, buck.reverse, buck.efficiency?.value]).toEqual([0, 'estimate', 0.1, 'estimate', 'open', 'blocks', 0.9])
    const boost = rail(boostModule({ reverse: 'body-diode' }), 'boost')!
    expect([boost.offPath, boost.reverse]).toEqual(['diode', 'body-diode'])
  })
  it('notes a rail input or a rail it cannot place, instead of dropping it silently', () => {
    const one = ldoModule({ inputs: [{ domain: 'IN', via: 'direct' }, { domain: 'AUX', via: 'diode' }] }, 'test-ldo-aux')
    const c = buildCircuit(sheet([{ uid: 'u1', module: one }], []))
    expect(c.notes).toContain('U1: rail ldo: input domain AUX is not simulated, so that input is left out')
    expect(byId(c.devices, 'u1.rail.ldo')).toBeDefined()
    const none = ldoModule({ inputs: [{ domain: 'AUX', via: 'direct' }] }, 'test-ldo-none')
    const d = buildCircuit(sheet([{ uid: 'u1', module: none }], []))
    expect(d.notes).toContain('U1: rail ldo has no simulated input, so the rail is left out')
    expect(byId(d.devices, 'u1.rail.ldo')).toBeUndefined()
  })
})
