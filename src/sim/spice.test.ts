// Spec 2, 4, 4.4 and 9 (compiler golden tests): byte-identical text in uid then terminal order; nets
// renamed n1..nN with node 0 at the first island's reference; sanitised names; never R = 0; the
// floating rules; and the behavioural rail elements.
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { compile, enableValue, foldValue } from './spice.ts'
import { buckModule, cellModule, ldoModule, sheet } from './testing.ts'
import type { Diagram } from '../format/diagram.ts'

const op = { kind: 'op', corner: 'typical' } as const
const text = (d: Diagram) => {
  const c = buildCircuit(d)
  return compile(c, classify(c), op).text
}
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })

describe('compile', () => {
  it('compiles a battery and a resistor to exactly this text (golden)', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])
    expect(text(d)).toBe([
      '* circuitoon',
      'v_bt1_cell n4 n3 dc 3.7',
      'r_bt1_cell_int n3 0 0.05',
      'vs_1 n1 n4 dc 0',
      'vs_2 n2 0 dc 0',
      'r_r1_r n5 n6 10',
      'vs_3 n1 n5 dc 0',
      'vs_4 n2 n6 dc 0',
      '.end',
      '',
    ].join('\n'))
  })
  it('gives byte-identical text for the same circuit in any part order', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']])
    expect(text({ ...d, parts: [...d.parts].reverse() })).toBe(text(d))
  })
  it('never emits R = 0', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 0)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    expect(t).toContain('r_r1_r n5 n6 0.02')
    expect(t).not.toMatch(/^r\S* \S+ \S+ 0$/m)
  })
  it('keeps user names out of the text: nets become n1..nN and element names are sanitised', () => {
    const d = sheet([
      { uid: 'bt1', module: cellModule(5, 0.1), designator: 'my "battery" 1' }, R('r1', 100),
      { uid: 'l1', module: 'net-label', values: { net: 'my net "x"' } }, { uid: 'l2', module: 'net-label', values: { net: '0' } },
    ], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['l1.NET', 'r1.1'], ['l2.NET', 'r1.2']])
    const t = text(d)
    expect(t).not.toContain('my net')
    expect(t).not.toContain('battery')
    for (const line of t.split('\n').filter((l) => l && !l.startsWith('*') && !l.startsWith('.'))) {
      const [name, ...rest] = line.split(' ')
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
      for (const tok of rest.slice(0, 2)) expect(tok).toMatch(/^(0|n\d+)$/)
    }
  })
  it('omits elements that are wholly floating and ties floating plates and second islands to 0 through 1 G', () => {
    const d = sheet([
      { uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 100), { uid: 'c1', module: 'capacitor-ceramic' }, R('r9', 100), R('r8', 100),
      { uid: 'bt2', module: cellModule(3, 0.1, 'cell-b') }, R('r2', 100),
    ], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1'], ['r9.1', 'r8.1'], ['r9.2', 'r8.2'], ['bt2.+', 'r2.1'], ['r2.2', 'bt2.-']])
    const t = text(d)
    expect(t).toMatch(/^c_c1_c n\d+ n\d+ 1e-7$/m)
    expect(t.match(/^r_float_\d+ n\d+ 0 1000000000$/gm)).toHaveLength(1)
    expect(t.match(/^r_join_\d+ n\d+ 0 1000000000$/gm)).toHaveLength(1)
    expect(t).not.toContain('r_r9_r')
  })
  it('is empty when nothing is driven', () => {
    const c = buildCircuit(sheet([R('r1', 100)], []))
    const out = compile(c, classify(c), op)
    expect(out.empty).toBe(true)
    expect(out.read({})).toEqual({ v: {}, pins: {}, dev: {} })
  })
  it('writes an LDO as a smooth control node, one output current source, a sense and a current-controlled input', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(5, 0.01) }, { uid: 'u1', module: ldoModule({ reverse: 'body-diode' }) }, R('r1', 33)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(t).toMatch(/^b_u1_rail_ldo_ctl n\d+ n\d+ v=\(3\.3-\(max\(/m)
    expect(t).toMatch(/^b_u1_rail_ldo_out n\d+ n\d+ i=\(max\(/m)
    expect(t).toMatch(/^v_u1_rail_ldo_o n\d+ n\d+ dc 0$/m)
    expect(t).toMatch(/^f_u1_rail_ldo_in n\d+ n\d+ v_u1_rail_ldo_o 1$/m)
    expect(t).toMatch(/^b_u1_rail_ldo_iq n\d+ n\d+ i=0\.005\*/m)
    expect(t).toMatch(/^d_u1_rail_ldo_body n\d+ n\d+ m_d_u1_rail_ldo_body$/m)
    expect(t).not.toMatch(/exp\((?!-abs)/)
  })
  it('writes a buck input as the control-node power over efficiency, guarded below 0.5 V', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(12, 0.01) }, { uid: 'u1', module: buckModule() }, R('r1', 10)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(t).toMatch(/^b_u1_rail_buck_in n\d+ n\d+ i=v\(n\d+,n\d+\)\*i\(v_u1_rail_buck_o\)\/\(0\.9\*max\(v\(n\d+,n\d+\),0\.5\)\)$/m)
  })
  it('computes the same smooth functions in TypeScript', () => {
    expect(foldValue(3.3, 2.97)).toBeCloseTo(1, 6)
    expect(foldValue(0, 2.97)).toBeLessThan(0.002)
    expect(enableValue(5.9, 6, 24)).toBe(0)
    expect(enableValue(6, 6, 24)).toBe(1)
    expect(enableValue(5.975, 6, 24)).toBeCloseTo(0.5, 9)
  })
})
