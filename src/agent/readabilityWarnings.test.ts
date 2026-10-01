// Readability warnings (never blocking): wires crowded side by side, a wire hugging a part it does not
// connect to, a wire or part over a label or caption, and a wire with too many crossings. Each names
// the wires or parts and says what to change.
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { CROSSINGS_MAX, readabilityFindings } from './readabilityWarnings.ts'

const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
const box: ModuleDef = { format: 'circuitoon-module/1', id: 'box', name: 'Box', pins: [{ name: 'A', side: 'left' }], size: { w: 10, h: 4 } }
const part = (uid: string, module: string, x: number, y: number): PartInstance => ({ uid, designator: uid.toUpperCase(), module, x, y })
const wire = (uid: string, a: string, b: string, route?: [number, number][]): Connection => {
  const end = (s: string) => ({ part: s.split('.')[0], pin: s.split('.')[1] })
  return { uid, from: end(a), to: end(b), ...(route ? { route } : {}) }
}
const sheet = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: { two, box }, parts, connections })
const rules = (d: Diagram) => readabilityFindings(d).map((f) => f.rule)

describe('readability warnings', () => {
  it('finds nothing on two well spaced wires', () => {
    // r1 R at (48, 20) to r2 L at (192, 20); r3 R to r4 L 60 px below.
    const d = sheet([part('r1', 'two', 0, 0), part('r2', 'two', 200, 0), part('r3', 'two', 0, 60), part('r4', 'two', 200, 60)], [wire('w1', 'r1.R', 'r2.L'), wire('w2', 'r3.R', 'r4.L')])
    expect(readabilityFindings(d)).toEqual([])
  })
  it('warns about two wires of different nets side by side within a grid step over a long run', () => {
    const d = sheet([part('r1', 'two', 0, 0), part('r2', 'two', 200, 0), part('r3', 'two', 0, 10), part('r4', 'two', 200, 10)], [wire('w1', 'r1.R', 'r2.L', [[60, 20], [180, 20]]), wire('w2', 'r3.R', 'r4.L', [[60, 30], [180, 30]])])
    const f = readabilityFindings(d).filter((x) => x.rule === 'wires-crowded')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warning')
    expect(f[0].wires).toEqual(['w1', 'w2'])
    expect(f[0].message).toMatch(/^The wires R1 R to R2 L and R3 R to R4 L run side by side, 10 px apart, for \d+ px\. Move one of them at least 20 px away/)
  })
  it('warns about a wire that hugs a part it does not connect to', () => {
    // U1's body spans y 0..40 at x 80..180; the wire runs at y 44, 4 px under it.
    const d = sheet([part('r1', 'two', 0, 34), part('r2', 'two', 260, 34), part('u1', 'box', 80, 0)], [wire('w1', 'r1.R', 'r2.L', [[60, 44], [230, 44]])])
    const f = readabilityFindings(d).filter((x) => x.rule === 'wire-hugs-part')
    expect(f).toHaveLength(1)
    expect(f[0].parts).toEqual(['u1'])
    expect(f[0].message).toMatch(/runs within 5 px of U1's body/)
  })
  it('warns about a wire over a caption', () => {
    // R3's caption sits under its body, about y 35 to 45, x 7 to 33.
    const d = sheet([part('r1', 'two', -100, 30), part('r2', 'two', 200, 30), part('r3', 'two', 0, 0)], [wire('w1', 'r1.R', 'r2.L', [[-40, 40], [180, 40]])])
    const f = readabilityFindings(d).filter((x) => x.rule === 'label-covered')
    expect(f.map((x) => x.parts)).toEqual([['r3']])
    expect(f[0].message).toMatch(/covers R3's caption/)
  })
  it(`warns about a wire with more than ${CROSSINGS_MAX} crossings`, () => {
    const parts = [part('a', 'two', -60, 100), part('b', 'two', 400, 100)]
    const wires = [wire('long', 'a.R', 'b.L')]
    for (let i = 0; i <= CROSSINGS_MAX; i++) {
      parts.push(part(`t${i}`, 'two', 40 + i * 30, 0), part(`u${i}`, 'two', 40 + i * 30, 200))
      wires.push(wire(`x${i}`, `t${i}.R`, `u${i}.R`, [[96 + i * 30, 10], [96 + i * 30, 210]]))
    }
    const f = readabilityFindings(sheet(parts, wires)).filter((x) => x.rule === 'crossings-high')
    expect(f.map((x) => x.wires)).toEqual([['long']])
    expect(f[0].message).toMatch(new RegExp(`crosses ${CROSSINGS_MAX + 1} other wires`))
  })
  it('never blocks', () => {
    const d = sheet([part('r1', 'two', 0, 0), part('r2', 'two', 200, 0), part('r3', 'two', 0, 10), part('r4', 'two', 200, 10)], [wire('w1', 'r1.R', 'r2.L', [[60, 20], [180, 20]]), wire('w2', 'r3.R', 'r4.L', [[60, 30], [180, 30]])])
    expect(readabilityFindings(d).every((f) => f.severity === 'warning')).toBe(true)
    expect(rules(d)).toContain('wires-crowded')
  })
})

describe('stubs out to net labels', () => {
  const label: ModuleDef = { format: 'circuitoon-module/1', id: 'net-label', name: 'Net label', netLabel: true, pins: [{ name: 'NET', side: 'left' }], size: { w: 5, h: 2 } }
  it('a row of them at pin pitch is not crowded', () => {
    const lab = (uid: string, net: string, y: number): PartInstance => ({ uid, designator: uid, module: 'net-label', x: 208, y, values: { net } })
    const row: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { two, box, 'net-label': label },
      // Short stubs: each label's pin tip 20 px out from its pin.
      parts: [part('r1', 'two', 0, 0), part('r3', 'two', 0, 10), { ...lab('a', 'A', 10), x: 76 }, { ...lab('b', 'B', 20), x: 76 }],
      connections: [wire('w1', 'r1.R', 'a.NET'), wire('w2', 'r3.R', 'b.NET')],
    }
    expect(readabilityFindings(row).filter((f) => f.rule === 'wires-crowded')).toEqual([])
    // The same two wires to parts, not labels, are crowded.
    const parts: Diagram = { ...row, parts: [part('r1', 'two', 0, 0), part('r3', 'two', 0, 10), part('r2', 'two', 200, 0), part('r4', 'two', 200, 10)], connections: [wire('w1', 'r1.R', 'r2.L', [[60, 20], [180, 20]]), wire('w2', 'r3.R', 'r4.L', [[60, 30], [180, 30]])] }
    expect(readabilityFindings(parts).filter((f) => f.rule === 'wires-crowded')).toHaveLength(1)
  })
})

describe('readability gaps (review)', () => {
  const label: ModuleDef = { format: 'circuitoon-module/1', id: 'net-label', name: 'Net label', netLabel: true, pins: [{ name: 'NET', side: 'left' }], size: { w: 5, h: 2 } }
  const lab = (uid: string, net: string, x: number, y: number): PartInstance => ({ uid, designator: uid, module: 'net-label', x, y, values: { net } })
  const withLabels = (parts: PartInstance[], connections: Connection[]): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: { two, box, 'net-label': label }, parts, connections })
  it('long wires to labels side by side are crowded; only short stubs are exempt', () => {
    // Two 140 px wires to labels a grid step apart: not stubs.
    const d = withLabels([part('r1', 'two', 0, 0), part('r3', 'two', 0, 10), lab('a', 'A', 228, 10), lab('b', 'B', 228, 20)],
      [wire('w1', 'r1.R', 'a.NET', [[60, 20], [200, 20]]), wire('w2', 'r3.R', 'b.NET', [[60, 30], [200, 30]])])
    expect(readabilityFindings(d).filter((f) => f.rule === 'wires-crowded')).toHaveLength(1)
  })
  it('a wire running over a part body it does not connect to is reported', () => {
    // U1's body spans x 80..180, y 0..40; the hand route runs through it at y 20.
    const d = sheet([part('r1', 'two', 0, 0), part('r2', 'two', 260, 0), part('u1', 'box', 80, 0)], [wire('w1', 'r1.R', 'r2.L', [[60, 20], [230, 20]])])
    const f = readabilityFindings(d).filter((x) => x.rule === 'wire-hugs-part')
    expect(f.map((x) => x.parts)).toEqual([['u1']])
    expect(f[0].message).toMatch(/runs over U1's body/)
  })
  it('a wire over a DIP\'s pin names is label-covered; one to that DIP\'s own pin is not', async () => {
    const { load } = await import('../format/builtinModules.testing.ts')
    const dip = load('mcp23017-dip28')
    const { tipLabelBoxes } = await import('../render/captionBox.ts')
    const u = { uid: 'u9', designator: 'U9', module: 'mcp23017-dip28', x: 0, y: 0 }
    const box0 = tipLabelBoxes(u, dip)[0]
    const y = box0.y + box0.h / 2
    const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { two, 'mcp23017-dip28': dip }, parts: [part('r1', 'two', -200, y - 20), part('r2', 'two', 400, y - 20), u],
      connections: [wire('w1', 'r1.R', 'r2.L', [[-140, y], [380, y]])] }
    const f = readabilityFindings(d).filter((x) => x.rule === 'label-covered' && x.parts[0] === 'u9')
    expect(f.some((x) => /U9's pin names/.test(x.message))).toBe(true)
  })
  it('crossings with the wire\'s own net are not counted', () => {
    const parts = [part('a', 'two', -60, 100), part('b', 'two', 400, 100)]
    const wires = [wire('long', 'a.R', 'b.L')]
    for (let i = 0; i <= CROSSINGS_MAX; i++) {
      parts.push(part(`t${i}`, 'two', 40 + i * 30, 0))
      // Each crossing wire is on the long wire's net: it ends on b.L too.
      wires.push(wire(`x${i}`, `t${i}.R`, 'b.L', [[96 + i * 30, 10], [96 + i * 30, 210], [370, 210], [370, 120]]))
    }
    expect(readabilityFindings(sheet(parts, wires)).filter((f) => f.rule === 'crossings-high' && f.wires[0] === 'long')).toEqual([])
  })
})
