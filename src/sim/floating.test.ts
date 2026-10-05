// Spec 2 (revision 5) and 4.4: a node is driven only when a source's + terminal or a rail output
// reaches it through conducting elements; capacitors, open switches, input-leakage resistors, loads
// and a rail's return path do not count; a source-less island and a singleton pin are floating; each
// island's reference is the return of its source with the largest imax, else the highest voltage,
// ties by part uid.
import { describe, expect, it } from 'vitest'
import { nodeKey } from '../format/netlist.ts'
import { buildCircuit } from './build.ts'
import { classify, openSwitchFor, pinState } from './floating.ts'
import { netNode } from './model.ts'
import { type PartSpec, boardModule, cellModule, ldoModule, sheet } from './testing.ts'

const R = (uid: string, ohms = 100) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })

describe('floating classification', () => {
  it('does not count a GPIO input-leakage resistor as a path: a wired input that nothing drives floats', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 'u1', module: boardModule({ leak: true }) }, R('r9')], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r9.1']]))
    expect(c.devices.some((d) => d.kind === 'resistor' && d.role === 'leak')).toBe(true)
    expect(pinState(c, classify(c), nodeKey('u1', 'IO1'))).toBe('floating')
  })
  it('leaves a board behind an open switch unpowered though its ground is shared, and names the switch', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 's1', module: 'rocker-switch-kcd1' }, { uid: 'u1', module: boardModule() }],
      [['bt1.+', 's1.1'], ['s1.2', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    const cls = classify(c)
    expect(pinState(c, cls, nodeKey('u1', 'GND'))).toBe('defined')
    expect(pinState(c, cls, nodeKey('u1', 'VIN'))).toBe('floating')
    expect(pinState(c, cls, nodeKey('u1', '3V3'))).toBe('floating')
    expect(openSwitchFor(c, 'u1:3V3')).toBe('s1')
    expect(openSwitchFor(c, 'u1:GND')).toBeNull()
  })
  it('keeps a capacitor-only plate floating', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1'), { uid: 'c1', module: 'capacitor-ceramic' }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1']]))
    const cls = classify(c)
    expect(pinState(c, cls, nodeKey('c1', '1'))).toBe('driven')
    expect(pinState(c, cls, nodeKey('c1', '2'))).toBe('floating')
  })
  it('floats what sits behind an open switch, and drives it once the switch is closed', () => {
    const parts = (values: Record<string, unknown>) => [{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 's1', module: 'rocker-switch-kcd1', values }, R('r1')]
    const wires: [string, string][] = [['bt1.+', 's1.1'], ['s1.2', 'r1.1']]
    const open = buildCircuit(sheet(parts({}), wires))
    expect(pinState(open, classify(open), nodeKey('r1', '1'))).toBe('floating')
    const closed = buildCircuit(sheet(parts({ 'contact.s': 'closed' }), wires))
    expect(pinState(closed, classify(closed), nodeKey('r1', '1'))).toBe('driven')
  })
  it('floats a source-less island and a singleton pin', () => {
    const c = buildCircuit(sheet([R('r1'), R('r2'), { uid: 'd1', module: 'led' }], [['r1.1', 'r2.1'], ['r1.2', 'r2.2']]))
    const cls = classify(c)
    expect(cls.islands).toEqual([])
    expect(pinState(c, cls, nodeKey('r1', '1'))).toBe('floating')
    expect(pinState(c, cls, nodeKey('d1', 'A'))).toBe('floating')
  })
  it('references each island to the return of its strongest source', () => {
    const c = buildCircuit(sheet([
      { uid: 'b1', module: cellModule(3.7, 0.05, 'cell-a') }, { uid: 'b2', module: cellModule(5, 0.05, 'cell-b') }, R('r1'), R('r2'),
      { uid: 'b3', module: cellModule(1.5, 0.1, 'cell-c'), values: { 'sim.imax': { value: 9, unit: 'A' } } }, { uid: 'b4', module: cellModule(9, 0.1, 'cell-d') }, R('r3'),
    ], [['b1.+', 'r1.1'], ['b1.-', 'r1.2'], ['b2.+', 'r2.1'], ['b2.-', 'r2.2'], ['r1.2', 'r2.2'], ['b3.+', 'r3.1'], ['b3.-', 'r3.2'], ['b4.+', 'r3.1'], ['b4.-', 'r3.2']]))
    const cls = classify(c)
    // Equal imax (2 A each): the higher voltage wins. Then b3's 9 A beats b4's 2 A.
    expect(cls.islands.map((i) => [i.source, i.reference])).toEqual([['b2.cell', 'b2:-'], ['b3.cell', 'b3:-']])
    expect(cls.islandOf.get(netNode(c.pinNet[nodeKey('b1', '+')]))).toBe(0)
    expect(cls.islandOf.get('b4:+')).toBe(1)
  })

  describe('drive is directed: a return never drives the supply side', () => {
    const behindSwitch = (io1: string, extra: PartSpec[], wires: [string, string][]) =>
      buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 's1', module: 'rocker-switch-kcd1' }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': io1 } }, ...extra],
        [['bt1.+', 's1.1'], ['s1.2', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires]))
    it.each(['high', 'low'])('leaves a board blinking an LED (IO1 %s) behind an open switch unpowered, sharing its ground', (io1) => {
      const c = behindSwitch(io1, [{ uid: 'd1', module: 'led' }], [['u1.IO1', 'd1.A'], ['d1.K', 'u1.GND']])
      const cls = classify(c)
      expect(cls.driven.has('u1:3V3')).toBe(false)
      expect(cls.driven.has('u1:VIN')).toBe(false)
      expect(pinState(c, cls, nodeKey('u1', '3V3'))).not.toBe('driven')
      expect(openSwitchFor(c, 'u1:3V3')).toBe('s1')
    })
    it('leaves IO1 high with only 10 k to ground behind an open switch unpowered', () => {
      const c = behindSwitch('high', [R('r1', 10000)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']])
      const cls = classify(c)
      expect(cls.driven.has('u1:3V3')).toBe(false)
      expect(cls.driven.has('u1:IO1')).toBe(false)
      expect(openSwitchFor(c, 'u1:3V3')).toBe('s1')
    })
    const powered = (extra: PartSpec[], wires: [string, string][]) =>
      buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 'u1', module: boardModule({ leak: true }) }, ...extra], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires]))
    it.each([['A', 'K'], ['K', 'A']])('floats an input whose only connection is an LED to ground (LED %s on the input)', (onInput, onGnd) => {
      const c = powered([{ uid: 'd1', module: 'led' }], [['u1.IO1', `d1.${onInput}`], [`d1.${onGnd}`, 'u1.GND']])
      const cls = classify(c)
      expect(pinState(c, cls, nodeKey('u1', '3V3'))).toBe('driven')
      expect(pinState(c, cls, nodeKey('u1', 'IO1'))).toBe('floating')
    })
    it('holds an input with a 10 k pull-down to ground at a defined 0 V', () => {
      const c = powered([R('r1', 10000)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']])
      expect(pinState(c, classify(c), nodeKey('u1', 'IO1'))).toBe('defined')
    })
    it('does not drive the USB 5 V pin from a battery on VIN through the OR diode', () => {
      const c = powered([], [])
      const cls = classify(c)
      expect(cls.driven.has('u1:VIN')).toBe(true)
      expect(cls.driven.has('u1:USB#vbus')).toBe(false)
    })
    it.each([['blocks', false], ['body-diode', true]] as const)('a backfed %s rail output drives its input: %s', (reverse, drives) => {
      const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(3.3, 0.1) }, { uid: 'u2', module: ldoModule({ reverse }) }], [['bt1.+', 'u2.OUT'], ['bt1.-', 'u2.GND']]))
      const cls = classify(c)
      expect(pinState(c, cls, nodeKey('u2', 'OUT'))).toBe('driven')
      expect(pinState(c, cls, nodeKey('u2', 'IN'))).toBe(drives ? 'driven' : 'floating')
    })
  })
})
