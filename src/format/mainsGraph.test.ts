// The mains conduction graph (spec 1.2): identity through zero and fitted protective edges only,
// energization onward through loads, leakage and inadequate isolation, contact states per group.
import { describe, expect, it } from 'vitest'
import { validateModule } from './module.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import { L_MASK, N_MASK, PE_MASK, analyseState, bitOf, buildMainsGraph, prepare, type Prepared } from './mainsGraph.ts'
import { MAINS_MODULES, at, sheet, w } from './mains.testing.ts'

const graph = (d: Diagram): Prepared => {
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))
  if (!g) throw new Error('no mains data')
  return prepare(g)
}
const node = (p: Prepared, part: string, pin: string) => p.g.nodeOf.get(nodeKey(part, pin))!
const ident = (p: Prepared, part: string, pin: string) => p.ident[p.root[node(p, part, pin)]]
const power = (p: Prepared, part: string, pin: string) => p.power[p.root[node(p, part, pin)]]
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
