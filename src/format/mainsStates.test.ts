// Which contact groups can matter (spec 1.5: a group touching a possible-connectivity component with
// a source or a converter input), the units the states are enumerated in, and the minimal, complete
// witness of a finding (Resolution 24) in words.
import { describe, expect, it } from 'vitest'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import { buildMainsGraph, candidateGroups, masksByPopcount, minimalWitness, prepare, statePhrase, units, type MainsGraph } from './mainsGraph.ts'
import { at, sheet, w } from './mains.testing.ts'

const graph = (d: Diagram): MainsGraph => {
  const plugs = plugsOf(d)
  return buildMainsGraph(d, plugs, netlist(d, plugs))!
}
const names = (g: MainsGraph, idx: number[]) => idx.map((i) => g.groups[i].part.designator)
/** A holds-bitset over k groups from a predicate on the mask. */
const holds = (k: number, pred: (m: number) => boolean) => {
  const b = new Uint32Array(Math.max(1, (1 << k) >>> 5))
  for (let m = 0; m < 1 << k; m++) if (pred(m)) b[m >>> 5] |= 1 << (m & 31)
  return b
}

describe('candidateGroups', () => {
  it('finds S2 in L-S1-S2-S3-N although S2 touches neither end', () => {
    const g = graph(sheet(
      [at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('s3', 'S3', 't-switch', 600)],
      [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'xs1|N')],
    ))
    expect(names(g, candidateGroups(g))).toEqual(['S1', 'S2', 'S3'])
  })
  it('leaves out a switch that no source or converter input can ever reach', () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('u1', 'U1', 't-mcu', 600)],
      [w('xs1|L', 's1|1'), w('u1|IO', 's2|1')]))
    expect(names(g, candidateGroups(g))).toEqual(['S1'])
  })
})

describe('units', () => {
  it('enumerates independent components on their own, and keeps a linked-pole relay in one unit', () => {
    const g = graph(sheet([
      at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 300), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 200, 300),
      at('k1', 'K1', 't-relay-2p', 400),
    ], [w('xs1|L', 's1|1'), w('xs2|L', 's2|1'), w('xs1|N', 'k1|COM1'), w('xs2|N', 'k1|COM2')]))
    const p = prepare(g)
    const us = units(p, candidateGroups(g, p.possible))
    expect(us.map((u) => names(g, u.cands).join(' ')).filter(Boolean).sort()).toEqual(['K1', 'S1', 'S2'])
    // K1's poles sit on XS1 N and on XS2 N: its unit spans both components, so the poles stay linked.
    const k1 = us.find((u) => names(g, u.cands).includes('K1'))!
    const has = (part: string, pin: string) => k1.view.inRel[g.nodeOf.get(nodeKey(part, pin))!] === 1
    expect([has('xs1', 'N'), has('xs2', 'N'), has('xs1', 'L')]).toEqual([true, true, false])
  })
  it("merges a class 1 part's switched earth with its L and N, so the earth is judged in the same states", () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('e1', 'E1', 't-lamp-c1', 400)],
      [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]))
    const p = prepare(g)
    const us = units(p, candidateGroups(g, p.possible))
    const s1 = us.find((u) => names(g, u.cands).includes('S1'))!
    const has = (part: string, pin: string) => s1.view.inRel[g.nodeOf.get(nodeKey(part, pin))!] === 1
    expect([has('e1', 'PE'), has('e1', 'L'), has('xs1', 'N')]).toEqual([true, true, true])
  })
  it("merges a bonded converter's secondary with its bond's earth", () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200)], [w('xs1|L', 'ps1|+V'), w('xs1|PE', 'ps1|PE')]))
    const p = prepare(g)
    const us = units(p, candidateGroups(g, p.possible))
    const withV = us.find((u) => u.view.inRel[g.nodeOf.get(nodeKey('ps1', '+V'))!] === 1)!
    expect([withV.view.inRel[g.nodeOf.get(nodeKey('ps1', '-V'))!], withV.view.inRel[g.nodeOf.get(nodeKey('xs1', 'PE'))!]]).toEqual([1, 1])
  })
  it('without a link, two outlets are two units', () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 300), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 200, 300)],
      [w('xs1|L', 's1|1'), w('xs2|L', 's2|1')]))
    const p = prepare(g)
    expect(units(p, candidateGroups(g, p.possible)).map((u) => names(g, u.cands).join(' ')).filter(Boolean).sort()).toEqual(['S1', 'S2'])
  })
})

describe('masksByPopcount', () => {
  it('orders states by how many groups are on, then by value', () => {
    expect([...masksByPopcount(3)]).toEqual([0, 1, 2, 4, 3, 5, 6, 7])
    expect(masksByPopcount(16).length).toBe(65536)
    expect(masksByPopcount(3)).toBe(masksByPopcount(3))
  })
})

describe('minimalWitness', () => {
  it('keeps both switches of a series short and drops a third that does not matter', () => {
    expect(minimalWitness(holds(3, (m) => (m & 3) === 3), 3, 0b011)).toEqual([0, 1])
  })
  it('keeps an OFF condition that is needed (S1 on and K1 released)', () => {
    expect(minimalWitness(holds(2, (m) => m === 0b01), 2, 0b01)).toEqual([0, 1])
  })
  it('keeps nothing for a finding that holds in every state', () => {
    expect(minimalWitness(holds(3, () => true), 3, 0)).toEqual([])
  })
})

describe('statePhrase', () => {
  const g = graph(sheet(
    [at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('s3', 'S3', 't-switch', 600), at('k1', 'K1', 't-relay', 800)],
    [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'k1|COM')],
  ))
  const cands = candidateGroups(g)
  it('says both for two groups on, lists three, and names OFF and released conditions', () => {
    expect(statePhrase(g, cands, [0], 0b0001)).toBe('when S1 is on')
    expect(statePhrase(g, cands, [0, 1], 0b0011)).toBe('when S1 and S2 are both on')
    expect(statePhrase(g, cands, [0, 1, 2], 0b0111)).toBe('when S1, S2 and S3 are on')
    expect(statePhrase(g, cands, [0, 3], 0b0001)).toBe('when S1 is on and K1 is released')
    expect(statePhrase(g, cands, [0, 3], 0b1001)).toBe('when S1 is on and K1 is energized')
    expect(statePhrase(g, cands, [0, 1], 0)).toBe('when S1 and S2 are off')
  })
  it('says nothing when no condition is needed', () => {
    expect(statePhrase(g, cands, [], 0b0101)).toBe('')
  })
})
