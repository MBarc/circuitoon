import { describe, expect, it } from 'vitest'
import { type Finding, checkDiagram, parseSupply } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef, PinDef } from './module.ts'
import { buttonLed } from '../samples/buttonLed.ts'

const mod = (id: string, pins: PinDef[], extra: Partial<ModuleDef> = {}): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins, ...extra })

const bat5 = mod('bat5', [{ name: '+', side: 'top', type: 'power_out', supply: '5V' }, { name: '-', side: 'top', type: 'ground' }])
const bat37 = mod('bat37', [{ name: '+', side: 'top', type: 'power_out', supply: '3.7V' }, { name: '-', side: 'top', type: 'ground' }])
const bat9 = mod('bat9', [{ name: '+', side: 'top', type: 'power_out', supply: '9V' }, { name: '-', side: 'top', type: 'ground' }])
const buck = mod('buck', [{ name: 'OUT+', side: 'right', type: 'power_out', supply: 'ADJ' }, { name: 'OUT-', side: 'right', type: 'ground' }])
/** A 3.3 V chip: power, ground, an input and an output. */
const chip33 = mod('chip33', [
  { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'D', side: 'right', type: 'input' },
  { name: 'Q', side: 'right', type: 'output' },
])
const chipAny = mod('chipAny', [
  { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3/5V' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'Q', side: 'right', type: 'output' },
])
const vin = mod('vin', [{ name: 'VCC', label: 'VIN', side: 'left', type: 'power_in', supply: '7V/12V' }, { name: 'GND', side: 'left', type: 'ground' }])
const sw = mod('sw', [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }])
const old = mod('old', [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }])
/** A dev board: USB powered, so no-power never claims it is unpowered. */
const mcu = mod('mcu', [
  { name: '5V', side: 'left', type: 'power_in', supply: '5V' },
  { name: '3V3', side: 'left', type: 'power_out', supply: '3V3' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'IO', side: 'right', type: 'io' },
], { electrical: { model: 'mcu' } })
/** A charger whose OUT+ is joined inside to B+: a pass-through, not a supply of its own. */
const charger = mod('charger', [
  { name: 'B+', side: 'left', type: 'power_in', supply: '3.7V' },
  { name: 'OUT+', side: 'right', type: 'power_out', supply: '3.7V' },
  { name: 'GND', side: 'right', type: 'ground' },
], { internal: [['B+', 'OUT+']] })
/** Two 3V3 outputs joined inside, like the ESP32-S3 board. */
const twin = mod('twin', [
  { name: '3V3', side: 'left', type: 'power_out', supply: '3V3' },
  { name: '3V3 2', side: 'right', type: 'power_out', supply: '3V3', label: '3V3' },
  { name: 'GND', side: 'left', type: 'ground' },
], { internal: [['3V3', '3V3 2']] })
const labelled = mod('labelled', [
  { name: 'P', side: 'left', type: 'power_in', supply: '3V3', label: 'VDD' },
  { name: 'G', side: 'left', type: 'ground', label: 'VSS' },
])
/** A 100 x 60 board: nine vertical strips s1..s9 at x = 10..90, five holes each at y = 10..50. */
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({
    name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
  })),
}
/** Two-lead part, body 40 x 30: its legs plug into holes 40 px apart. */
const two = mod('two', [{ name: 'L', side: 'left', type: 'passive' }, { name: 'R', side: 'right', type: 'passive' }])

const MODULES = { bat5, bat37, bat9, buck, chip33, chipAny, vin, sw, old, mcu, charger, twin, labelled, bb, two }

let seq = 0
const part = (designator: string, module: keyof typeof MODULES, extra: Partial<PartInstance> = {}): PartInstance => ({
  uid: designator.toLowerCase(), designator, module, x: seq++ * 200, y: 300, ...extra,
})
const wire = (uid: string, a: string, b: string): Connection => {
  const end = (s: string) => {
    const [p, ...pin] = s.split('.')
    return { part: p, pin: pin.join('.') }
  }
  return { uid, from: end(a), to: end(b) }
}
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: MODULES, parts, connections })

const rules = (d: Diagram) => checkDiagram(d).map((f) => f.rule)
const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)

/** A powered, grounded 3.3 V chip on a 3.7 V cell through nothing: the base the rule tests change. */
const powered = (src: keyof typeof MODULES, chip: keyof typeof MODULES) =>
  sheet([part('BT1', src), part('U1', chip)], [wire('w1', 'bt1.+', 'u1.VCC'), wire('w2', 'bt1.-', 'u1.GND')])

describe('parseSupply', () => {
  it('reads each rail as volts', () => {
    expect(parseSupply('3V3')).toEqual([3.3])
    expect(parseSupply('1V8/3V3')).toEqual([1.8, 3.3])
    expect(parseSupply('5V')).toEqual([5])
    expect(parseSupply('3.7V')).toEqual([3.7])
    expect(parseSupply('7.4V/12V')).toEqual([7.4, 12])
  })
  it('reads ADJ and anything unparseable as unknown', () => {
    expect(parseSupply('ADJ')).toEqual([null])
    expect(parseSupply('5V/ADJ')).toEqual([5, null])
    expect(parseSupply('VBAT')).toEqual([null])
    expect(parseSupply('V')).toEqual([null])
    expect(parseSupply('3V3V')).toEqual([null])
  })
})

describe('checkDiagram', () => {
  it('finds nothing on the sample sheet', () => {
    expect(checkDiagram(buttonLed)).toEqual([])
  })
  it('finds nothing on an empty sheet or a well wired one', () => {
    expect(checkDiagram(sheet([], []))).toEqual([])
    expect(checkDiagram(powered('bat5', 'chipAny'))).toEqual([])
  })

  describe('short', () => {
    it('flags a supply wired straight to ground, naming both pins', () => {
      const d = sheet([part('BT1', 'bat5'), part('U1', 'chip33')], [wire('w1', 'bt1.+', 'u1.GND')])
      const [f] = only(d, 'short')
      expect(f.severity).toBe('error')
      expect(f.message).toBe('BT1 + is wired straight to ground (U1 GND): short circuit.')
      expect(f.parts).toEqual(['bt1', 'u1'])
      expect(f.pins).toEqual([{ part: 'bt1', pin: '+' }, { part: 'u1', pin: 'GND' }])
      expect(f.wires).toEqual(['w1'])
    })
    it('flags a battery wired across itself', () => {
      const d = sheet([part('BT1', 'bat5')], [wire('w1', 'bt1.+', 'bt1.-')])
      expect(only(d, 'short')[0].message).toBe('BT1 + is wired straight to ground (BT1 -): short circuit.')
    })
    it('passes a supply wired to a power input and a ground wired to ground', () => {
      expect(rules(powered('bat5', 'chipAny'))).not.toContain('short')
    })
    it('ignores pins with no type', () => {
      // X1's pin is called GND but has no type: it is unknown, so nothing is claimed about it.
      const d = sheet([part('BT1', 'bat5'), part('X1', 'old')], [wire('w1', 'bt1.+', 'x1.A')])
      d.modules = { ...d.modules, old: mod('old', [{ name: 'A', side: 'left', label: 'GND' }]) }
      expect(rules(d)).not.toContain('short')
    })
  })

  describe('supply-too-high', () => {
    it('flags a power input fed more than its highest rail', () => {
      const [f] = only(powered('bat5', 'chip33'), 'supply-too-high')
      expect(f.severity).toBe('error')
      expect(f.message).toBe('U1 VCC accepts up to 3.3 V but gets 5 V from BT1 +.')
      expect(f.pins).toEqual([{ part: 'u1', pin: 'VCC' }, { part: 'bt1', pin: '+' }])
      expect(f.wires).toEqual(['w1'])
    })
    it('passes a voltage the input lists', () => {
      expect(rules(powered('bat5', 'chipAny'))).not.toContain('supply-too-high')
    })
    it('uses the pin label the board prints', () => {
      const d = sheet([part('BT1', 'bat5'), part('U1', 'labelled')], [wire('w1', 'bt1.+', 'u1.P'), wire('w2', 'bt1.-', 'u1.G')])
      expect(only(d, 'supply-too-high')[0].message).toBe('U1 VDD accepts up to 3.3 V but gets 5 V from BT1 +.')
    })
    it('reaches the input through a breadboard strip and a switch-free wire chain', () => {
      const d = sheet(
        [part('BB1', 'bb', { x: 0, y: 0 }), part('BT1', 'bat5'), part('U1', 'chip33')],
        [wire('w1', 'bt1.+', 'bb1.s1'), { uid: 'w2', from: { part: 'bb1', pin: 's1', hole: 4 }, to: { part: 'u1', pin: 'VCC' } }],
      )
      expect(only(d, 'supply-too-high')[0].wires).toEqual(['w1', 'w2'])
    })
  })

  describe('supply-too-low', () => {
    it('flags a power input fed less than its lowest rail', () => {
      const [f] = only(powered('bat37', 'vin'), 'supply-too-low')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('U1 VIN needs at least 7 V; BT1 + gives only 3.7 V.')
    })
    it('passes a voltage inside the range', () => {
      expect(rules(powered('bat9', 'vin'))).not.toContain('supply-too-low')
      expect(rules(powered('bat9', 'vin'))).not.toContain('supply-too-high')
    })
  })

  describe('supply-unknown', () => {
    it('asks for an adjustable supply to be set to a voltage the input accepts', () => {
      const d = sheet([part('U2', 'buck'), part('U1', 'chipAny')], [wire('w1', 'u2.OUT+', 'u1.VCC'), wire('w2', 'u2.OUT-', 'u1.GND')])
      const [f] = only(d, 'supply-unknown')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('U2 OUT+ is adjustable; set it to a voltage U1 VCC accepts (3.3 V or 5 V).')
    })
    it('stays quiet when the input lists no voltages', () => {
      const noSupply = mod('nosup', [{ name: 'VCC', side: 'left', type: 'power_in' }, { name: 'GND', side: 'left', type: 'ground' }])
      const d = sheet([part('U2', 'buck'), part('U1', 'chip33')], [wire('w1', 'u2.OUT+', 'u1.VCC')])
      d.modules = { ...d.modules, chip33: { ...noSupply, id: 'chip33' } }
      expect(rules(d)).not.toContain('supply-unknown')
    })
  })

  describe('supplies-fight and supplies-parallel', () => {
    it('flags two supplies of different voltages on one net', () => {
      const d = sheet([part('BT1', 'bat5'), part('BT2', 'bat37')], [wire('w1', 'bt1.+', 'bt2.+'), wire('w2', 'bt1.-', 'bt2.-')])
      const [f] = only(d, 'supplies-fight')
      expect(f.severity).toBe('error')
      expect(f.message).toBe('BT1 + (5 V) and BT2 + (3.7 V) are wired together: the two supplies fight.')
      expect(rules(d)).not.toContain('supplies-parallel')
    })
    it('warns about two supplies of the same voltage tied together', () => {
      const d = sheet([part('BT1', 'bat5'), part('BT2', 'bat5')], [wire('w1', 'bt1.+', 'bt2.+')])
      const [f] = only(d, 'supplies-parallel')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('BT1 + and BT2 + are two supplies tied together; power this net from one of them.')
      expect(rules(d)).not.toContain('supplies-fight')
    })
    it('does not count two joined outputs of one board twice, nor a pass-through', () => {
      const d = sheet([part('U1', 'twin'), part('BT1', 'bat37'), part('U2', 'charger')], [
        wire('w1', 'u1.3V3', 'u1.3V3 2'),
        wire('w2', 'bt1.+', 'u2.B+'),
        wire('w3', 'bt1.-', 'u2.GND'),
        wire('w4', 'u1.GND', 'u2.GND'),
      ])
      expect(checkDiagram(d)).toEqual([])
    })
  })

  describe('outputs-fight', () => {
    it('flags two outputs driving one net', () => {
      const d = powered('bat5', 'chipAny')
      d.parts.push(part('U2', 'chipAny'))
      d.connections.push(wire('w3', 'bt1.+', 'u2.VCC'), wire('w4', 'bt1.-', 'u2.GND'), wire('w5', 'u1.Q', 'u2.Q'))
      const [f] = only(d, 'outputs-fight')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('U1 Q and U2 Q both drive this net: two outputs fight.')
      expect(f.wires).toEqual(['w5'])
    })
    it('passes an output driving an input', () => {
      const d = sheet([part('U1', 'chip33'), part('U2', 'chip33')], [wire('w1', 'u1.Q', 'u2.D')])
      expect(rules(d)).not.toContain('outputs-fight')
    })
  })

  describe('no-power', () => {
    it('flags a wired part none of whose power inputs is fed', () => {
      const d = sheet([part('U1', 'chip33'), part('U2', 'chip33')], [wire('w1', 'u1.Q', 'u2.D'), wire('w2', 'u1.GND', 'u2.GND')])
      const found = only(d, 'no-power')
      expect(found.map((f) => f.message)).toEqual(['U1 has no power: connect VCC.', 'U2 has no power: connect VCC.'])
      expect(found[0].severity).toBe('warning')
      expect(found[0].pins).toEqual([{ part: 'u1', pin: 'VCC' }])
    })
    it('names every power input', () => {
      const two = mod('twoIn', [{ name: 'VCC', side: 'left', type: 'power_in', supply: '5V' }, { name: '5V', side: 'left', type: 'power_in', supply: '5V' }, { name: 'D', side: 'right', type: 'input' }])
      const d = sheet([part('U1', 'chip33'), part('U2', 'chip33')], [wire('w1', 'u1.D', 'u2.D')])
      d.modules = { ...d.modules, chip33: { ...two, id: 'chip33' } }
      expect(only(d, 'no-power')[0].message).toBe('U1 has no power: connect VCC or 5V.')
    })
    it('leaves alone a part with no wires, a powered part, and one fed through a switch or an unknown pin', () => {
      expect(rules(sheet([part('U1', 'chip33')], []))).toEqual([])
      expect(rules(powered('bat5', 'chipAny'))).not.toContain('no-power')
      const viaSwitch = sheet([part('BT1', 'bat5'), part('S1', 'sw'), part('U1', 'chipAny')], [
        wire('w1', 'bt1.+', 's1.1'), wire('w2', 's1.2', 'u1.VCC'), wire('w3', 'bt1.-', 'u1.GND'),
      ])
      expect(checkDiagram(viaSwitch)).toEqual([])
      const viaOld = sheet([part('X1', 'old'), part('U1', 'chipAny')], [wire('w1', 'x1.A', 'u1.VCC'), wire('w2', 'x1.B', 'u1.GND')])
      expect(checkDiagram(viaOld)).toEqual([])
    })
    it('counts a sensor fed from a dev board power pin, and never flags the USB powered board itself', () => {
      const d = sheet([part('U1', 'mcu'), part('U2', 'chipAny')], [wire('w1', 'u1.5V', 'u2.VCC'), wire('w2', 'u1.GND', 'u2.GND')])
      expect(checkDiagram(d)).toEqual([])
    })
  })

  describe('no-ground', () => {
    it('flags a wired part whose ground pins reach no other part', () => {
      const d = sheet([part('BT1', 'bat5'), part('U1', 'chipAny')], [wire('w1', 'bt1.+', 'u1.VCC')])
      const found = only(d, 'no-ground')
      expect(found.map((f) => f.message)).toEqual(['BT1 has no ground: connect -.', 'U1 has no ground: connect GND.'])
      expect(found[0].severity).toBe('warning')
    })
    it('does not count a bare breadboard strip as ground', () => {
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('BT1', 'bat5'), part('U1', 'chipAny')], [
        wire('w1', 'bt1.+', 'u1.VCC'), wire('w2', 'u1.GND', 'bb1.s1'), wire('w3', 'bt1.-', 'bb1.s2'),
      ])
      expect(only(d, 'no-ground').map((f) => f.parts[0])).toEqual(['bt1', 'u1'])
    })
    it('passes a ground wired to another part', () => {
      expect(rules(powered('bat5', 'chipAny'))).not.toContain('no-ground')
    })
  })

  describe('mount', () => {
    it('explains a mount that plugs nothing', () => {
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('R1', 'two', { x: 13, y: 0, mount: { board: 'bb1' } })], [])
      const [f] = only(d, 'mount')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('Not every leg of R1 sits in a hole of BB1, so none of its legs connect. Move it until every leg sits in a hole.')
      expect(f.parts).toEqual(['r1', 'bb1'])
    })
    it('explains a missing board and a part that is not a board', () => {
      const d = sheet([part('R1', 'two', { mount: { board: 'zz' } }), part('R2', 'two', { mount: { board: 'r1' } })], [])
      expect(only(d, 'mount').map((f) => f.message)).toEqual([
        'R1 is set to plug into a board that is not on the sheet (zz), so its legs connect nothing.',
        'R2 is set to plug into R1, which is not a breadboard, so its legs connect nothing.',
      ])
    })
    it('passes a seated part', () => {
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('R1', 'two', { x: 10, y: 0, mount: { board: 'bb1' } })], [])
      expect(rules(d)).toEqual([])
    })
  })

  describe('leg-hole-shared', () => {
    it('flags a wire ending in the hole a leg fills', () => {
      // R1's L leg sits in strip s1, hole 1 (local 10, 20).
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('R1', 'two', { x: 10, y: 0, mount: { board: 'bb1' } }), part('R2', 'two')], [
        { uid: 'w1', from: { part: 'bb1', pin: 's1', hole: 1 }, to: { part: 'r2', pin: 'L' } },
      ])
      const [f] = only(d, 'leg-hole-shared')
      expect(f.severity).toBe('warning')
      expect(f.message).toBe('A wire ends in BB1 s1 hole 1, where the R1 L leg already sits: physically, one hole takes one leg. Move the wire to another hole of the strip.')
      expect(f.parts).toEqual(['bb1', 'r1'])
      expect(f.wires).toEqual(['w1'])
    })
    it('passes a wire in a free hole of the same strip, and a wire to the plugged pin itself', () => {
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('R1', 'two', { x: 10, y: 0, mount: { board: 'bb1' } }), part('R2', 'two')], [
        { uid: 'w1', from: { part: 'bb1', pin: 's1', hole: 3 }, to: { part: 'r2', pin: 'L' } },
        wire('w2', 'r1.R', 'r2.R'),
      ])
      expect(rules(d)).not.toContain('leg-hole-shared')
    })
    it('counts a hole group end with no hole as hole 0', () => {
      const d = sheet([part('BB1', 'bb', { x: 0, y: 0 }), part('R1', 'two', { x: 10, y: -10, mount: { board: 'bb1' } }), part('R2', 'two')], [
        wire('w1', 'bb1.s1', 'r2.L'),
      ])
      expect(rules(d)).toContain('leg-hole-shared')
    })
  })

  describe('broken', () => {
    it('lists each broken connection as an error, with the ends that do not resolve', () => {
      const d = sheet([part('R1', 'two')], [wire('w1', 'r1.L', 'r1.nope'), { ...wire('w2', 'zz.1', 'yy.2'), label: 'VCC' }])
      const found = only(d, 'broken')
      expect(found.map((f) => [f.severity, f.wires, f.message])).toEqual([
        ['error', ['w1'], 'The wire R1 L to R1 nope is broken: R1 nope is not on the sheet, so it connects nothing.'],
        ['error', ['w2'], 'The wire VCC is broken: zz 1 and yy 2 are not on the sheet, so it connects nothing.'],
      ])
      expect(found[1].subject).toBe('VCC')
    })
  })

  it('sorts errors first, then by designator in natural order', () => {
    const d = sheet([part('U10', 'chip33'), part('U2', 'chip33'), part('BT1', 'bat5')], [
      wire('w1', 'u10.Q', 'u2.D'),
      wire('w2', 'bt1.+', 'bt1.-'),
    ])
    expect(checkDiagram(d).map((f) => `${f.severity} ${f.rule} ${f.subject}`)).toEqual([
      'error short BT1',
      'warning no-ground BT1',
      'warning no-power U2',
      'warning no-ground U2',
      'warning no-power U10',
      'warning no-ground U10',
    ])
  })
  it('gives every finding a unique id', () => {
    const d = sheet([part('U1', 'chip33'), part('U2', 'chip33'), part('BT1', 'bat5')], [wire('w1', 'u1.Q', 'u2.Q'), wire('w2', 'bt1.+', 'bt1.-')])
    const ids = checkDiagram(d).map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
