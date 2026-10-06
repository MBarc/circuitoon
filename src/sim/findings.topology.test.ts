// Spec 5.2 topological codes, each both ways: sim-short through a closed switch (and quiet when it
// is open), a shorted high-resistance cell, a shorted rail output; sim-source-conflict only for a
// closed parallel loop with different voltages; sim-floating-input; sim-incomplete; sim-estimate;
// and finalize's severity rules (peak is a warning, an uncertain error is a "likely" warning).
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { type Draft, finalize, noConvergence, past, subjectOf, subjectsOf, topologyFindings } from './findings.ts'
import { netNode } from './model.ts'
import { boardModule, cellModule, ldoModule, q, sheet } from './testing.ts'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
const codes = (d: Diagram) => {
  const c = buildCircuit(d)
  return finalize(topologyFindings(c, classify(c)).drafts, '')
}

describe('topological findings', () => {
  it('finds a short through a closed switch, and none with it open', () => {
    const d = (values: Record<string, unknown>) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1', values }], [['bt1.+', 's1.1'], ['s1.2', 'bt1.-']])
    const closed = codes(d({ 'contact.s': 'closed' })).filter((f) => f.code === 'sim-short')
    expect(closed).toEqual([expect.objectContaining({ severity: 'error', basis: 'topology', parts: ['bt1', 's1'] })])
    expect(closed[0].message).toBe('BT1 is shorted: its + and - are joined through S1 and wires. Nothing limits the current, so BT1 and the wires can overheat.')
    expect(codes(d({})).filter((f) => f.code === 'sim-short')).toEqual([])
  })
  it('finds a shorted high-resistance cell (a coin cell wired + to -)', () => {
    const f = codes(sheet([{ uid: 'bt1', module: cellModule(3, 15) }], [['bt1.+', 'bt1.-']])).filter((x) => x.code === 'sim-short')
    expect(f).toHaveLength(1)
  })
  it('names the source itself when the short runs through its own contact', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }], []))
    c.devices.push({ kind: 'switch', id: 'bt1.s.1.no', part: 'bt1', group: 's', contact: 'no', latching: true, a: 'bt1:+', b: 'bt1:-', closed: true, ron: { value: 0.02, basis: 'estimate', label: 'x' } })
    const f = finalize(topologyFindings(c, classify(c)).drafts, '').filter((x) => x.code === 'sim-short')
    expect(f.map((x) => [x.parts, x.message])).toEqual([[['bt1'], 'BT1 is shorted: its + and - are joined through BT1 itself and wires. Nothing limits the current, so BT1 and the wires can overheat.']])
  })
  it('finds a rail output shorted to its return', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u1.GND']]))
    const t = topologyFindings(c, classify(c))
    expect(t.shortedRails).toEqual(new Set(['u1.rail.ldo']))
    expect(finalize(t.drafts, '').some((f) => f.code === 'sim-short' && f.parts[0] === 'u1')).toBe(true)
  })
  it('flags two sources in parallel at different voltages, and stays quiet otherwise (spec 5.2, Astra A)', () => {
    const pair = (va: number, vb: number, wires: [string, string][]) =>
      codes(sheet([{ uid: 'b1', module: cellModule(va, 0.05, 'cell-a') }, { uid: 'b2', module: cellModule(vb, 0.05, 'cell-b') }, R('r1', 100)], [...wires, ['b1.+', 'r1.1'], ['r1.2', 'b1.-']])).filter((f) => f.code === 'sim-source-conflict')
    // Both voltages are electrical.params values, which count as user (ruling R13).
    expect(pair(3.7, 5, [['b1.+', 'b2.+'], ['b1.-', 'b2.-']])).toEqual([expect.objectContaining({ severity: 'error', basis: 'user', parts: ['b1', 'b2'] })])
    expect(pair(3.7, 5, [['b1.+', 'b2.+']])).toEqual([])
    expect(pair(3.7, 5, [['b1.-', 'b2.+']])).toEqual([])
    expect(pair(3.7, 3.7, [['b1.+', 'b2.+'], ['b1.-', 'b2.-']])).toEqual([])
  })
  it('never flags rail outputs that block reverse current (they OR), but does flag body-diode ones', () => {
    const ored = (reverse: 'blocks' | 'body-diode') =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule({ reverse }) }, { uid: 'u2', module: ldoModule({ reverse, vout: q(3, 'V') }, 'ldo-3v0') }],
        [['bt1.+', 'u1.IN'], ['bt1.+', 'u2.IN'], ['bt1.-', 'u1.GND'], ['bt1.-', 'u2.GND'], ['u1.OUT', 'u2.OUT']])).filter((f) => f.code === 'sim-source-conflict')
    expect(ored('blocks')).toEqual([])
    expect(ored('body-diode').map((f) => f.parts)).toEqual([['u1', 'u2']])
  })
  it('pairs two outputs of one part when they are different pins wired together', () => {
    const rail = (id: string, output: string, v: number) => ({ id, inputs: [{ domain: 'IN', via: 'direct' }], output, kind: 'ldo', vout: q(v, 'V'), dropout: q(0.3, 'V'), ioutMax: q(0.5, 'A'), iq: q(0.001, 'A'), reverse: 'body-diode' })
    const dual = {
      format: 'circuitoon-module/1', id: 'dual-ldo', name: 'dual-ldo',
      pins: [{ name: 'IN', type: 'power_in', side: 'left' }, { name: 'GND', type: 'ground', side: 'left' }, { name: 'OUT5', type: 'power_out', side: 'right' }, { name: 'OUT3', type: 'power_out', side: 'right' }],
      electrical: { model: 'regulator', sim: { power: { domains: [{ name: 'IN', pin: 'IN', ret: 'GND', nominal: 9 }, { name: 'OUT5', pin: 'OUT5', ret: 'GND', nominal: 5 }, { name: 'OUT3', pin: 'OUT3', ret: 'GND', nominal: 3.3 }], rails: [rail('r5', 'OUT5', 5), rail('r3', 'OUT3', 3.3)] } } },
    } as ModuleDef
    const f = (wires: [string, string][]) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(9, 0.05) }, { uid: 'u1', module: dual }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ...wires])).filter((x) => x.code === 'sim-source-conflict')
    expect(f([['u1.OUT5', 'u1.OUT3']]).map((x) => x.parts)).toEqual([['u1', 'u1']])
    expect(f([])).toEqual([])
  })
  it('flags an input held only by its input leakage (it is not a DC path)', () => {
    const all = codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule({ leak: true }) }, R('r9', 1000)], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r9.1']]))
    expect(all.filter((f) => f.code === 'sim-floating-input').map((f) => f.parts)).toEqual([['u1']])
  })
  it('flags a wired GPIO input on a floating node, and not one with a pull, a driver or no wire', () => {
    const f = (values: Record<string, unknown>, wires: [string, string][]) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values }, R('r1', 1000), R('r9', 1000)], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])).filter((x) => x.code === 'sim-floating-input')
    // IO1 goes to a resistor whose far end is free: wired, but nothing drives it (ruling R32). IO2 is wired to nothing: not reported.
    expect(f({}, [['u1.IO1', 'r9.1']]).map((x) => x.message)).toEqual(['U1 IO1 is an input with nothing driving it: it floats, so it reads at random. Wire it to a signal, add a pull-up or pull-down resistor, or set its simulated state to input-pullup or input-pulldown.'])
    expect(f({ 'gpio.IO1': 'input-pullup' }, [['u1.IO1', 'r9.1']])).toEqual([])
    expect(f({ 'gpio.IO2': 'input-pullup' }, [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']])).toEqual([])
  })
  it('does not flag an input wired to a part that is not simulated (its state is unknown, not floating)', () => {
    const f = (wires: [string, string][]) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule() }, { uid: 'u2', module: 'bme280-module-4pin' }, R('r9', 1000)], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])).filter((x) => x.code === 'sim-floating-input')
    expect(f([['u1.IO1', 'u2.SDA']])).toEqual([])
    expect(f([['u1.IO1', 'r9.1']]).map((x) => x.parts)).toEqual([['u1']])
  })
  it('notes parts with no power data, and the estimates in use', () => {
    const all = codes(sheet([{ uid: 'u1', module: 'bme280-module-4pin' }, { uid: 'u2', module: boardModule({}) }], []))
    expect(all.find((f) => f.code === 'sim-incomplete')).toMatchObject({ severity: 'note', parts: ['u1'], message: '1 powered part has no power data, so it is not simulated: U1.' })
    const est = all.find((f) => f.code === 'sim-estimate')!
    expect(est.severity).toBe('note')
    expect(est.inputs).toContain('test-board.U2.draw.3V3.minVolts: estimate')
    // Plain words (spec 5.2): the parts by ref; the parameter paths stay in inputs.
    expect(est.message).toMatch(/^\d+ values? in this result (is an estimate|are estimates), for U2\.$/)
  })
  it('names who a parameter is about in plain words', () => {
    expect(['esp32-devkitc-v4.U1.rails.ldo.rout', 'led-colours.red.absMaxCurrent', 'usb-default.2.0', 'battery-9v.BT1.limits.sourceCurrent', 'cable.w3.vbus', 'plug.w4.gnd'].map(subjectOf)).toEqual(['U1', 'a red LED', 'a USB 2.0 port', 'BT1', 'a USB cable', 'a USB plug'])
    expect(subjectsOf(['battery-9v.BT2.x', 'battery-9v.BT10.y', 'battery-9v.BT2.z'])).toBe('BT2 and BT10')
  })
})

describe('finalize (spec 4.5, 5.2)', () => {
  // Labels as build.ts and power.ts make them.
  const LABELS = { user: 'resistor.R1.resistance', datasheet: 'esp32-devkitc-v4.U1.draw.3V3.minVolts', representative: 'led-colours.red.absMaxCurrent', estimate: 'battery-9v.BT1.limits.sourceCurrent' }
  const p = (basis: 'user' | 'datasheet' | 'representative' | 'estimate') => ({ value: 1, basis, label: LABELS[basis] })
  const draft = (over: Partial<Draft>): Draft => ({ code: 'sim-brownout', severity: 'error', parts: ['u1'], message: 'U1 3V3 is at 2.5 V, below the 3 V it needs: it browns out.', inputs: [p('datasheet')], key: 'k', ...over })
  it('keeps a datasheet error at typical an error (it blocks)', () => {
    expect(finalize([draft({ corner: 'typical' })], '')[0]).toMatchObject({ severity: 'error', basis: 'datasheet', corner: 'typical' })
  })
  it('makes a peak finding a warning labelled with the peak note', () => {
    const f = finalize([draft({ corner: 'peak' })], 'Wi-Fi transmit')[0]
    expect(f.severity).toBe('warning')
    expect(f.message).toMatch(/^At peak \(Wi-Fi transmit\): /)
  })
  it('makes an error on estimates a "likely" warning that lists them, and drops a peak twin of a typical finding', () => {
    const [f] = finalize([draft({ corner: 'typical', inputs: [p('estimate')] }), draft({ corner: 'peak', inputs: [p('estimate')] })], '')
    expect(f.severity).toBe('warning')
    expect(f.message).toMatch(/^Likely: /)
    expect(f.message).toContain('This is decided on estimated values for BT1.')
    // A USB link's conductors are named as such, never by their connection uid.
    const [usb] = finalize([draft({ corner: 'typical', inputs: [{ value: 0.1, basis: 'estimate', label: 'cable.w7.vbus' }, { value: 0.1, basis: 'estimate', label: 'plug.w8.gnd' }] })], '')
    expect(usb.message).toContain('This is decided on estimated values for a USB cable and a USB plug.')
    expect(finalize([draft({ corner: 'typical' }), draft({ corner: 'peak' })], '')).toHaveLength(1)
  })
  it('words a solver failure without SPICE vocabulary, naming the parts on the nets it reported', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    const f = noConvergence(c, 'singular matrix: check node n1', [netNode('BT1_+')])
    expect(f).toMatchObject({ code: 'sim-no-convergence', severity: 'error', basis: 'topology', raw: 'singular matrix: check node n1', parts: ['bt1', 'r1'] })
    expect(f.message).toBe('The simulator could not solve this circuit; this may be our model, not your circuit. The parts on the nets it could not solve: BT1 and R1.')
    // An internal node (the cell's behind its rInternal) names its device's part.
    const cell = c.devices.find((d) => d.kind === 'cell')!
    expect(noConvergence(c, 'x', [cell.kind === 'cell' ? cell.int : '']).parts).toEqual(['bt1'])
  })
})

describe('Phase D fixes (topology)', () => {
  it('does not call a DevKit 3V3 pin fed from 2xAA a supply fight: its regulator has no input of its own', () => {
    const all = codes(sheet([{ uid: 'bt1', module: 'battery-holder-2xaa' }, { uid: 'u1', module: 'esp32-devkitc-v4' }], [['bt1.+', 'u1.3V3'], ['bt1.-', 'u1.GND']]))
    expect(all.filter((f) => f.code === 'sim-source-conflict')).toEqual([])
  })
  it('still flags a live regulator ORed against a battery at a different voltage, unless it blocks reverse current', () => {
    const ored = (reverse: 'blocks' | 'body-diode') =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule({ reverse }) }, { uid: 'bt2', module: cellModule(3.7, 0.05, 'cell-b') }],
        [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'bt2.+'], ['bt2.-', 'u1.GND']])).filter((f) => f.code === 'sim-source-conflict')
    expect(ored('body-diode').map((f) => f.parts)).toEqual([['bt2', 'u1']])
    expect(ored('blocks')).toEqual([])
  })
  it('does not flag a floating input on a board that is not powered (its "not powered" warning covers it), and gives the pin', () => {
    const f = (values: Record<string, unknown>) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1', values }, { uid: 'u1', module: boardModule() }, R('r9', 1000)],
        [['bt1.+', 's1.1'], ['s1.2', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r9.1']])).filter((x) => x.code === 'sim-floating-input')
    expect(f({})).toEqual([])
    expect(f({ 'contact.s': 'closed' })).toEqual([expect.objectContaining({ parts: ['u1'], pins: [{ part: 'u1', pin: 'IO1' }] })])
    // Unplugged (no supply drawn at all): quiet too.
    expect(codes(sheet([{ uid: 'u1', module: boardModule() }, R('r9', 1000)], [['u1.IO1', 'r9.1']])).filter((x) => x.code === 'sim-floating-input')).toEqual([])
  })
  it("does not count a board's own internal joins as wiring: an Uno with only D13 wired has no A4/A5 warning", () => {
    const f = codes(sheet([{ uid: 'bt1', module: cellModule(9, 0.05) }, { uid: 'u1', module: 'arduino-uno-r3' }, R('r9', 1000)],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.D13', 'r9.1']])).filter((x) => x.code === 'sim-floating-input')
    expect(f.flatMap((x) => x.pins!.map((p) => p.pin))).toEqual(['D13'])
  })
  it('does not flag an input whose net reaches a connector pin that leads off the sheet; a Wago splice does not count', () => {
    const f = (connector: string) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule() }, { uid: 'j1', module: connector }],
        [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'j1.1']])).filter((x) => x.code === 'sim-floating-input')
    expect(f('jst-xh-2')).toEqual([])
    expect(f('dupont-1x2')).toEqual([])
    expect(f('wago-221-412')).toEqual([expect.objectContaining({ pins: [{ part: 'u1', pin: 'IO1' }] })])
  })
})

describe('finalize: an over-abs-max past twice a representative limit (Phase D ruling)', () => {
  const lim = (basis: 'representative' | 'estimate') => ({ value: 0.03, basis, label: basis === 'representative' ? 'led-colours.red.absMaxCurrent' : 'led.D1.limits.absMaxCurrent.part' })
  const abs = (overBy: number, basis: 'representative' | 'estimate' = 'representative'): Draft =>
    ({ code: 'sim-over-abs-max', severity: 'error', parts: ['d1'], message: 'D1 carries 90 mA, above its 30 mA absolute maximum: damage is likely.', inputs: [lim(basis)], key: 'k', corner: 'typical', overBy })
  it('stays a blocking error past 2x, saying it is decided on representative values', () => {
    const [f] = finalize([abs(3)], '')
    expect(f).toMatchObject({ severity: 'error', basis: 'representative' })
    expect(f.message).toBe('D1 carries 90 mA, above its 30 mA absolute maximum: damage is likely. This is decided on typical values for a red LED, but it is more than twice the limit.')
  })
  it('is a "likely" warning at 2x or under, on an estimate whatever the ratio, and at peak', () => {
    expect(finalize([abs(1.5)], '')[0]).toMatchObject({ severity: 'warning', message: expect.stringMatching(/^Likely: /) })
    expect(finalize([abs(2)], '')[0].severity).toBe('warning')
    expect(finalize([abs(5, 'estimate')], '')[0].severity).toBe('warning')
    expect(finalize([{ ...abs(5), corner: 'peak' }], '')[0].severity).toBe('warning')
  })
})

describe('a reading beside its limit', () => {
  it('takes one more figure when three would read the same as the limit', () => {
    expect(past(0.02004, 0.02, 'A')).toBe('20.04 mA')
    expect(past(0.0251, 0.02, 'A')).toBe('25.1 mA')
    expect(past(2.9996, 3, 'V')).toBe('2.9996 V')
    expect(past(0.5001, 0.5, 'W')).toBe('500.1 mW')
  })
})
