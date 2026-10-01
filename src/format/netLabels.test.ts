// Net labels: every label with the same name (trimmed, case-sensitive) is one electrical node, in
// the netlist and so in everything built on it (checker, roles, mains analysis, verify, BOM).
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { validateDiagram } from './diagram.ts'
import { type ModuleDef, layoutModule, validateModule } from './module.ts'
import { netlist, nodeKey } from './netlist.ts'
import { checkDiagram, endpointName, netRoles } from './checks.ts'
import { billOfMaterials } from './bom.ts'
import { labelLook } from './mainsLook.ts'
import { labelName, labelMates } from './netLabels.ts'
import { load } from './builtinModules.testing.ts'
import { analyseMains } from './mains.ts'
import { mountIssues } from './breadboard.ts'
import { MAINS_MODULES, at as mainsAt, w as mainsWire } from './mains.testing.ts'

const label = load('net-label')
const mod = (id: string, pins: ModuleDef['pins'], extra: Partial<ModuleDef> = {}): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins, ...extra })
const mcu = mod('mcu', [
  { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3/5V' },
  { name: 'GND', side: 'left', type: 'ground' },
  { name: 'SDA', side: 'right', type: 'io' },
  { name: 'SCL', side: 'right', type: 'io' },
])
const cell = mod('cell', [{ name: '+', side: 'top', type: 'power_out', supply: '5V' }, { name: '-', side: 'top', type: 'ground' }])
const MODULES: Record<string, ModuleDef> = { 'net-label': label, mcu, cell }

let seq = 0
const part = (uid: string, module: string, extra: Partial<PartInstance> = {}): PartInstance => ({ uid, designator: uid.toUpperCase(), module, x: seq++ * 100, y: 0, ...extra })
const named = (uid: string, net: string, extra: Partial<PartInstance> = {}) => part(uid, 'net-label', { values: { net }, ...extra })
const wire = (uid: string, a: string, b: string): Connection => {
  const end = (s: string) => ({ part: s.split('.')[0], pin: s.split('.').slice(1).join('.') })
  return { uid, from: end(a), to: end(b) }
}
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: MODULES, parts, connections })
const k = nodeKey

/** U1 SDA to a label SDA, and U2 SDA to another label SDA: no wire between the two boards. */
const twoBoards = (a = 'SDA', b = 'SDA') => sheet(
  [part('u1', 'mcu'), part('u2', 'mcu'), named('n1', a), named('n2', b)],
  [wire('w1', 'u1.SDA', 'n1.NET'), wire('w2', 'u2.SDA', 'n2.NET')],
)

describe('the net-label part', () => {
  it('is a valid built-in module with one pin, flagged as a net label, in the Wiring group', () => {
    expect(validateModule(label).ok).toBe(true)
    expect(label.netLabel).toBe(true)
    expect(label.category).toBe('Wiring')
    expect(label.pins).toHaveLength(1)
  })
  it('puts its pin at the middle of its left edge (the tag point), on a body two grid units tall', () => {
    const lay = layoutModule(label)
    expect(lay.h).toBe(20)
    expect(lay.pins[0].edge).toEqual({ x: 0, y: 10 })
  })
  it('refuses a net-label module with more than one pin or with holes', () => {
    const bad = validateModule({ ...label, pins: [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.join()).toMatch(/netLabel/)
    const notTrue = validateModule({ ...label, netLabel: 'yes' })
    expect(notTrue.ok).toBe(false)
  })
})

describe('labelName', () => {
  it('trims the stored name; a missing or non-string name is empty', () => {
    expect(labelName(named('n1', '  SDA '))).toBe('SDA')
    expect(labelName(part('n1', 'net-label'))).toBe('')
    expect(labelName(part('n1', 'net-label', { values: { net: 5 } }))).toBe('')
  })
})

describe('label joins in the netlist', () => {
  it('joins every label with the same name into one node', () => {
    const n = netlist(twoBoards())
    const i = n.netOf.get(k('u1', 'SDA'))!
    expect(n.nets[i]).toEqual([k('n1', 'NET'), k('n2', 'NET'), k('u1', 'SDA'), k('u2', 'SDA')].sort())
  })
  it('matches after trimming whitespace', () => {
    const n = netlist(twoBoards(' SDA', 'SDA  '))
    expect(n.netOf.get(k('u1', 'SDA'))).toBe(n.netOf.get(k('u2', 'SDA')))
  })
  it('is case-sensitive: sda and SDA are two nets', () => {
    const n = netlist(twoBoards('sda', 'SDA'))
    expect(n.netOf.get(k('u1', 'SDA'))).not.toBe(n.netOf.get(k('u2', 'SDA')))
  })
  it('joins nothing through labels with an empty name', () => {
    const n = netlist(twoBoards('  ', ''))
    expect(n.netOf.get(k('u1', 'SDA'))).not.toBe(n.netOf.get(k('u2', 'SDA')))
  })
  it('joins three labels and leaves a differently named one apart', () => {
    const d = sheet([named('a', 'X'), named('b', 'X'), named('c', 'X'), named('e', 'Y')], [])
    const n = netlist(d)
    expect(n.nets).toEqual([[k('a', 'NET'), k('b', 'NET'), k('c', 'NET')]])
  })
  it('lists the other labels of a name (labelMates), in designator order', () => {
    const d = sheet([named('c', 'X'), named('a', 'X'), named('b', 'X'), named('e', 'Y')], [])
    expect(labelMates(d, 'a').map((p) => p.uid)).toEqual(['b', 'c'])
    expect(labelMates(d, 'e')).toEqual([])
  })
})

describe('checker', () => {
  const rules = (d: Diagram) => checkDiagram(d).map((f) => f.rule)
  it('sees a connection made only through labels (no no-common-ground across labelled grounds)', () => {
    // Two boards powered by one cell: VCC and GND through labels only, SDA by labels.
    const d = sheet(
      [part('bt', 'cell'), part('u1', 'mcu'), part('u2', 'mcu'), named('g1', 'GND'), named('g2', 'GND'), named('g3', 'GND'), named('v1', '5V'), named('v2', '5V'), named('v3', '5V'), named('s1', 'SDA'), named('s2', 'SDA')],
      [
        wire('a', 'bt.-', 'g1.NET'), wire('b', 'u1.GND', 'g2.NET'), wire('c', 'u2.GND', 'g3.NET'),
        wire('d', 'bt.+', 'v1.NET'), wire('e', 'u1.VCC', 'v2.NET'), wire('f', 'u2.VCC', 'v3.NET'),
        wire('g', 'u1.SDA', 's1.NET'), wire('h', 'u2.SDA', 's2.NET'),
      ],
    )
    expect(checkDiagram(d)).toEqual([])
  })
  it('reports no power when the supply label is misspelt', () => {
    const d = sheet([part('bt', 'cell'), part('u1', 'mcu'), named('v1', '5V'), named('v2', '5v')],
      [wire('a', 'bt.+', 'v1.NET'), wire('b', 'u1.VCC', 'v2.NET'), wire('c', 'bt.-', 'u1.GND')])
    expect(rules(d)).toContain('no-power')
  })
  it('warns about a label whose name appears only once', () => {
    const d = sheet([part('u1', 'mcu'), named('n1', 'SDA')], [wire('w1', 'u1.SDA', 'n1.NET')])
    const f = checkDiagram(d).filter((x) => x.rule === 'label-alone')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warning')
    expect(f[0].message).toMatch(/^Label SDA connects to nothing else/)
    expect(f[0].parts).toEqual(['n1'])
  })
  it('suggests the label that differs only in case', () => {
    const f = checkDiagram(twoBoards('sda', 'SDA')).filter((x) => x.rule === 'label-alone')
    expect(f).toHaveLength(2)
    expect(f.find((x) => x.parts[0] === 'n1')!.message).toMatch(/names are case-sensitive; set its name to SDA if it should join that net\./)
  })
  it('gives an error for a label with an empty name', () => {
    const d = sheet([part('u1', 'mcu'), named('n1', '   ')], [wire('w1', 'u1.SDA', 'n1.NET')])
    const f = checkDiagram(d).filter((x) => x.rule === 'label-unnamed')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    expect(rules(d)).not.toContain('label-alone')
  })
  it('names a label end by its name, not its pin', () => {
    const d = twoBoards()
    expect(endpointName(d, { part: 'n1', pin: 'NET' })).toBe('label SDA')
    expect(endpointName(sheet([named('n9', '')], []), { part: 'n9', pin: 'NET' })).toBe('N9 (unnamed label)')
  })
})

describe('role colour', () => {
  it('takes the net role: ground, supply or signal', () => {
    const d = sheet(
      [part('bt', 'cell'), part('u1', 'mcu'), named('g', 'GND'), named('g2', 'GND'), named('v', '5V'), named('v2', '5V'), named('s', 'SDA'), named('s2', 'SDA'), named('x', '')],
      [wire('a', 'bt.-', 'g.NET'), wire('b', 'u1.GND', 'g2.NET'), wire('c', 'bt.+', 'v.NET'), wire('d', 'u1.VCC', 'v2.NET'), wire('e', 'u1.SDA', 's.NET')],
    )
    expect(labelLook(d, 'g')).toBe('ground')
    expect(labelLook(d, 'g2')).toBe('ground')
    expect(labelLook(d, 'v')).toBe('supply')
    expect(labelLook(d, 's')).toBe('signal')
    // A label on a net of its own (nothing judged) is a signal; an unnamed one says so.
    expect(labelLook(d, 's2')).toBe('signal')
    expect(labelLook(d, 'x')).toBe('unnamed')
    expect(netRoles(d).roleOfKey(k('g', 'NET'))).toBe('ground')
  })
})

describe('mains: a label never hides that a net is mains', () => {
  // A US outlet's L and N reach a lamp through labels LIVE and NEUT.
  const mainsSheet = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { ...MAINS_MODULES, 'net-label': label },
    parts: [mainsAt('o', 'XS1', 't-outlet'), mainsAt('l', 'E1', 't-lamp', 200, 0), named('m1', 'LIVE'), named('m2', 'LIVE'), named('m3', 'NEUT'), named('m4', 'NEUT')],
    connections: [mainsWire('o|L', 'm1|NET'), mainsWire('m2|NET', 'l|L'), mainsWire('o|N', 'm3|NET'), mainsWire('m4|NET', 'l|N')],
  })
  it('still carries mains through the labels in the mains analysis', () => {
    const a = analyseMains(mainsSheet())!
    expect(a.mainsKeys.has(k('l', 'L'))).toBe(true)
    expect(a.conductorOf(k('l', 'L'))?.conductor).toBe('L')
  })
  it('refuses labels on mains wiring with an error, one per name', () => {
    const f = checkDiagram(mainsSheet()).filter((x) => x.rule === 'label-mains')
    expect(f.map((x) => x.severity)).toEqual(['error', 'error'])
    expect(f.map((x) => x.target).sort()).toEqual(['label LIVE', 'label NEUT'])
    expect(f[0].message).toMatch(/mains/)
  })
  it('draws such a label with the mains hazard look', () => {
    expect(labelLook(mainsSheet(), 'm1')).toBe('mains')
  })
  it('names a label end by its name in the mains cable findings', () => {
    const cable = checkDiagram(mainsSheet()).filter((x) => x.rule === 'cable-unverified').map((x) => x.message)
    expect(cable.some((m) => m.startsWith('The wire XS1 L to label LIVE carries mains'))).toBe(true)
  })
  it('never reports the label itself as a low-voltage part on mains', () => {
    const f = checkDiagram(mainsSheet()).filter((x) => x.rule === 'mains-to-low-voltage')
    expect(f).toEqual([])
  })
})

describe('bill of materials', () => {
  it('leaves labels out of the parts list', () => {
    const bom = billOfMaterials(twoBoards())
    expect(bom.parts.map((p) => p.module)).toEqual(['mcu'])
    // The two wires drawn to the labels are not bought; the one real wire the labels stand for is (rule V3).
    expect(bom.wires.map((w) => [w.count, w.labelled])).toEqual([[1, true]])
  })
})

describe('mounting', () => {
  it('never plugs a label into a breadboard: it is not physical', () => {
    const bb = load('breadboard-mini')
    const d: Diagram = { ...sheet([part('bb', 'breadboard-mini', { x: 0, y: 0 }), named('n1', 'SDA', { x: 30, y: 20, mount: { board: 'bb' } })], []), modules: { ...MODULES, 'breadboard-mini': bb } }
    expect(mountIssues(d).map((i) => i.reason)).toEqual(['cannot-mount'])
  })
})

describe('loading', () => {
  it('drops a label name that is not a string, with a warning', () => {
    const d = { ...twoBoards(), parts: [named('n1', 'SDA'), part('n2', 'net-label', { values: { net: 7 } })], connections: [] }
    const r = validateDiagram(JSON.parse(JSON.stringify(d)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.join()).toMatch(/values\.net: N2's label name must be text/)
    expect(r.diagram.parts[1].values).toEqual({})
  })
})

describe('labels on neighbouring header pins', () => {
  it('count as their drawn flags: no overlap, and a flag-sized obstacle', async () => {
    const { overlaps } = await import('../agent/readability.ts')
    const { partObstacles } = await import('./diagram.ts')
    const d = sheet([named('a', 'SDA', { x: 0, y: 0 }), named('b', 'SCL', { x: 0, y: 10 })], [])
    expect(overlaps(d)).toEqual({ body: [], caption: [] })
    const [r] = partObstacles(d)
    expect(r.h).toBeLessThan(10)
  })
})
