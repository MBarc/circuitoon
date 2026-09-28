// The mains conduction graph (spec 1.2): identity through zero and fitted protective edges only,
// energization onward through loads, leakage and inadequate isolation, contact states per group.
import { describe, expect, it } from 'vitest'
import { validateModule } from './module.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import { L_MASK, MAINS_POW, N_MASK, PE_MASK, analyseState, bareRoots, bitOf, buildMainsGraph, decodeSingle, hazardAt, possibleRoots, prepare, units, type Prepared } from './mainsGraph.ts'
import { MAINS_MODULES, at, sheet, w } from './mains.testing.ts'

const graph = (d: Diagram): Prepared => {
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))
  if (!g) throw new Error('no mains data')
  return prepare(g)
}
const node = (p: Prepared, part: string, pin: string) => p.g.nodeOf.get(nodeKey(part, pin))!
const ident = (p: Prepared, part: string, pin: string) => p.ident[p.root[node(p, part, pin)]]
/** The energizing sources at a terminal (one bit each), without the MAINS_POW bit. */
const power = (p: Prepared, part: string, pin: string) => p.power[p.root[node(p, part, pin)]] & ~MAINS_POW
/** True when the energy at a terminal came over mains wiring, crossing no isolation barrier (MAINS_POW). */
const onMains = (p: Prepared, part: string, pin: string) => (p.power[p.root[node(p, part, pin)]] & MAINS_POW) !== 0
/** Sets every contact group released or off except the listed group indices, and analyses that state. */
const state = (p: Prepared, ...on: number[]) => {
  p.groupState.fill(0)
  for (const i of on) p.groupState[i] = 1
  analyseState(p)
  return p
}

describe('mains fixtures', () => {
  it('every fixture module passes validation', () => {
    for (const m of Object.values(MAINS_MODULES)) {
      const r = validateModule(m)
      expect([m.id, r.ok ? [] : r.errors]).toEqual([m.id, []])
    }
  })
})

describe('buildMainsGraph', () => {
  it('builds nothing for a sheet without mains data', () => {
    const d = sheet([at('u1', 'U1', 't-mcu')], [])
    const plugs = plugsOf(d)
    expect(buildMainsGraph(d, plugs, netlist(d, plugs))).toBeNull()
  })
  it('gives each net its source identity through wires and terminal blocks', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term', 200), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'x1|1'), w('x1|1b', 'e1|L'), w('xs1|N', 'e1|N')])))
    expect(ident(p, 'e1', 'L')).toBe(bitOf(0, 'L'))
    expect(ident(p, 'e1', 'N')).toBe(bitOf(0, 'N'))
    expect(ident(p, 'xs1', 'PE')).toBe(bitOf(0, 'PE'))
  })
  it('passes energization, never identity, through a load', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'u1|IO')])))
    expect(ident(p, 'u1', 'IO')).toBe(0)
    expect(power(p, 'u1', 'IO')).toBe(1)
    expect(onMains(p, 'u1', 'IO')).toBe(true)
  })
  it('carries identity through a fitted fuse, not an absent one', () => {
    const parts = (fuse: string) => [at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse } })]
    expect(ident(state(graph(sheet(parts('fitted'), [w('xs1|L', 'f1|1')]))), 'f1', '2') & L_MASK).not.toBe(0)
    expect(ident(state(graph(sheet(parts('absent'), [w('xs1|L', 'f1|1')]))), 'f1', '2')).toBe(0)
  })
  it('switches a relay pole COM-NC released and COM-NO energized, never both', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200)], [w('xs1|L', 'k1|COM')]))
    state(p)
    expect([ident(p, 'k1', 'NC'), ident(p, 'k1', 'NO')]).toEqual([bitOf(0, 'L'), 0])
    state(p, 0)
    expect([ident(p, 'k1', 'NC'), ident(p, 'k1', 'NO')]).toEqual([0, bitOf(0, 'L')])
  })
  it('leaks energization through an OFF SSR and conducts identity when it is ON', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-ssr', 200)], [w('xs1|L', 'k1|1')]))
    state(p)
    expect([ident(p, 'k1', '2'), power(p, 'k1', '2')]).toEqual([0, 1])
    state(p, 0)
    expect(ident(p, 'k1', '2')).toBe(bitOf(0, 'L'))
  })
  it('energizes a secondary across basic isolation, never across reinforced or basic plus a screen', () => {
    const d = (m: string) => sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', m, 200)], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(power(state(graph(d('t-psu-basic'))), 'ps1', '+V')).toBe(1)
    // Final review 1: that side may be live, but the energy crossed a barrier: it is not mains wiring.
    expect(onMains(state(graph(d('t-psu-basic'))), 'ps1', '+V')).toBe(false)
    expect(onMains(state(graph(d('t-psu-basic'))), 'ps1', 'AC1')).toBe(true)
    expect(power(state(graph(d('t-psu'))), 'ps1', '+V')).toBe(0)
    expect(power(state(graph(d('t-psu-screen'))), 'ps1', '+V')).toBe(0)
  })
  it("treats an undeclared mains terminal conservatively: energy passes to the part's other mains terminals", () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-undeclared', 200)], [w('xs1|L', 'u1|A')])))
    expect(power(p, 'u1', 'B')).toBe(1)
  })
  it('switches linked poles together: both on NC released, both on NO energized, never one of each', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay-2p', 200)], [w('xs1|L', 'k1|COM1'), w('xs1|N', 'k1|COM2')]))
    state(p)
    expect([ident(p, 'k1', 'NC1'), ident(p, 'k1', 'NC2'), ident(p, 'k1', 'NO1'), ident(p, 'k1', 'NO2')]).toEqual([bitOf(0, 'L'), bitOf(0, 'N'), 0, 0])
    state(p, 0)
    expect([ident(p, 'k1', 'NC1'), ident(p, 'k1', 'NC2'), ident(p, 'k1', 'NO1'), ident(p, 'k1', 'NO2')]).toEqual([0, 0, bitOf(0, 'L'), bitOf(0, 'N')])
    expect(p.g.groups).toHaveLength(1)
  })
  it("treats a converter's outputs outside every domain as live when its input is energized", () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-mainsonly', 200)], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])))
    expect(power(p, 'ps1', '+V')).toBe(1)
  })
  it('takes every fuse as fitted in fitRoot, and leaves the rest of the sheet alone', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('u9', 'U9', 't-mcu', 900)],
      [w('xs1|L', 'f1|1'), w('u9|IO', 'u9|GND')])))
    expect(p.anyAbsent).toBe(true)
    expect(p.fitRoot[node(p, 'f1', '2')]).toBe(p.fitRoot[node(p, 'xs1', 'L')])
    expect(p.root[node(p, 'f1', '2')]).not.toBe(p.root[node(p, 'xs1', 'L')])
    expect(p.inRel[node(p, 'u9', 'IO')]).toBe(0)
  })
  it('marks a source unpolarized when no standard fixes its L side (Resolution 22, ruling B5)', () => {
    const french = { ...MAINS_MODULES['t-outlet-eu'], id: 't-outlet-fr', electrical: {
      ...(MAINS_MODULES['t-outlet-eu'].electrical as Record<string, unknown>),
      sockets: [{ id: 'main', family: 'cee7-5', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    } }
    expect(validateModule(french).ok).toBe(true)
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-eu', 200), at('xs3', 'XS3', 't-outlet-fr', 400)], [], { 't-outlet-fr': french }))
    expect(p.sources.map((s) => [s.part.designator, s.polarized])).toEqual([['XS1', true], ['XS2', false], ['XS3', false]])
  })
  it('keeps the three conductors of ten sources apart in the masks', () => {
    expect(L_MASK & N_MASK).toBe(0)
    expect(N_MASK & PE_MASK).toBe(0)
    expect(bitOf(9, 'PE') & PE_MASK).toBe(bitOf(9, 'PE'))
  })
})

describe('analyseState edges and reuse', () => {
  it('energizes across an isolation barrier one way only: secondary energy never reaches the primary', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-basic', 200)], [w('xs1|L', 'ps1|+V')])))
    expect([power(p, 'ps1', '+V'), power(p, 'ps1', 'AC1'), power(p, 'ps1', 'AC2')]).toEqual([1, 0, 0])
  })
  it('starts energization from N as well as L (Ruling 33), never from PE', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('e2', 'E2', 't-lamp', 200, 200), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|N', 'e1|L'), w('e1|N', 'u1|IO'), w('xs1|PE', 'e2|L')])))
    expect([ident(p, 'e1', 'L'), power(p, 'e1', 'L'), power(p, 'u1', 'IO'), power(p, 'e2', 'N')]).toEqual([bitOf(0, 'N'), 1, 1, 0])
  })
  it('blocks energy as well as identity at an absent fuse', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L')])))
    expect([ident(p, 'e1', 'L'), power(p, 'e1', 'L'), power(p, 'f1', '2'), power(p, 'e1', 'N')]).toEqual([0, 0, 0, 0])
  })
  it('joins closed contacts but no fuse in bareRoot', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200), at('s1', 'S1', 't-switch', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 's1|1')])), 0)
    expect(p.root[node(p, 's1', '2')]).toBe(p.root[node(p, 'xs1', 'L')])
    const bareRoot = bareRoots(p)
    expect(bareRoot[node(p, 's1', '2')]).toBe(bareRoot[node(p, 'f1', '2')])
    expect(bareRoot[node(p, 's1', '2')]).not.toBe(bareRoot[node(p, 'xs1', 'L')])
  })
  it('joins every contact position and every fuse, fitted or not, in possibleRoots', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200), at('f1', 'F1', 't-fuse', 400, 0, { settings: { fuse: 'absent' } }), at('u1', 'U1', 't-mcu', 600)],
      [w('xs1|L', 'k1|COM'), w('k1|NO', 'f1|1')]))
    const r = possibleRoots(p.g)
    const at_ = (part: string, pin: string) => r[node(p, part, pin)]
    expect([at_('k1', 'NC'), at_('k1', 'NO'), at_('f1', '2')]).toEqual([at_('xs1', 'L'), at_('xs1', 'L'), at_('xs1', 'L')])
    expect(at_('u1', 'IO')).not.toBe(at_('xs1', 'L'))
  })
  it('calls a node hazardous for L or N identity or energy, never for PE alone or nothing', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('u1', 'U1', 't-mcu', 400), at('s1', 'S1', 't-switch', 600)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'u1|IO'), w('xs1|PE', 's1|1')])))
    const hz = (part: string, pin: string) => hazardAt(p, node(p, part, pin))
    expect([hz('xs1', 'L'), hz('xs1', 'N'), hz('u1', 'IO'), hz('xs1', 'PE'), hz('s1', '2')]).toEqual([true, true, true, false, false])
  })
  it('decodes a single identity bit to its source and conductor', () => {
    expect([decodeSingle(bitOf(0, 'L')), decodeSingle(bitOf(4, 'N')), decodeSingle(bitOf(9, 'PE'))])
      .toEqual([{ s: 0, c: 'L' }, { s: 4, c: 'N' }, { s: 9, c: 'PE' }])
  })
  it('leaves no stale result when a relay goes energized and back to released', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200), at('e1', 'E1', 't-lamp', 400), at('e2', 'E2', 't-lamp', 400, 200)],
      [w('xs1|L', 'k1|COM'), w('k1|NO', 'e1|L'), w('k1|NC', 'e2|L'), w('xs1|N', 'e1|N'), w('xs1|N', 'e2|N')]))
    const look = () => [ident(p, 'e1', 'L'), ident(p, 'e2', 'L'), power(p, 'e1', 'L'), power(p, 'e2', 'L'), p.srcRoots.length]
    state(p)
    const released = look()
    // Released: E2 gets L. E1's L gets energy only across E1 from the neutral (no identity).
    expect(released).toEqual([0, bitOf(0, 'L'), 1, 1, 3])
    state(p, 0)
    expect(look()).toEqual([bitOf(0, 'L'), 0, 1, 1, 3])
    state(p)
    expect(look()).toEqual(released)
  })
  it("touches no scratch entry outside a view, even for a group whose other pole lies outside it", () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 300), at('k1', 'K1', 't-relay-2p', 400)],
      [w('xs1|N', 'k1|COM1'), w('xs2|N', 'k1|COM2')]))
    // Units built without K1 as a candidate: its two poles fall in different units.
    const u = units(p, []).find((x) => x.view.inRel[node(p, 'xs1', 'N')] === 1)!
    expect(u.view.inRel[node(p, 'k1', 'COM2')]).toBe(0)
    for (let i = 0; i < p.g.n; i++) p.parent[i] = p.bareParent[i] = p.root[i] = p.bareRoot[i] = i
    const before = [p.parent.slice(), p.bareParent.slice(), p.root.slice(), p.bareRoot.slice()]
    u.view.groupState.fill(1)
    analyseState(u.view)
    bareRoots(u.view)
    const outside = (a: Int32Array) => [...a].filter((_, i) => !u.view.inRel[i])
    expect([p.parent, p.bareParent, p.root, p.bareRoot].map(outside)).toEqual(before.map(outside))
    expect(ident(p, 'k1', 'NO1')).toBe(bitOf(0, 'N'))
  })
})
