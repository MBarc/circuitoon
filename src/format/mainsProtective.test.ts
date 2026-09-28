// Protective conductors (spec 1.6): every wire and part edge on any path between a source's earth and
// a protective terminal, parallel and redundant paths included, never through a low-voltage pin.
import { describe, expect, it } from 'vitest'
import { plugsOf } from './breadboard.ts'
import { netlist } from './netlist.ts'
import type { Connection, Diagram } from './diagram.ts'
import { buildMainsGraph } from './mainsGraph.ts'
import { protectivePaths } from './mainsProtective.ts'
import { at, dupont, sheet, w } from './mains.testing.ts'

const paths = (d: Diagram) => {
  const plugs = plugsOf(d)
  return protectivePaths(buildMainsGraph(d, plugs, netlist(d, plugs))!)
}
const uids = (cs: Connection[]) => cs.map((c) => c.uid).sort()

describe('protectivePaths', () => {
  it('two parallel PE wires to a class 1 lamp are both protective', () => {
    const pe = [dupont('xs1|PE', 'e1|PE'), dupont('e1|PE', 'xs1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200)], [w('xs1|L', 'e1|L'), ...pe])
    expect([...paths(d).wires].sort()).toEqual(uids(pe))
  })
  it('a switched branch beside a permanent PE wire is on a path, with its whole loop', () => {
    const loop = [w('xs1|PE', 'e1|PE'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('e1', 'E1', 't-lamp-c1', 400)], loop)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(loop))
    expect(p.through.map((t) => [t.part.designator, t.kind, [...t.wires].sort()])).toEqual([['S1', 'switch', uids(loop)]])
  })
  it('a switch in series on the earth: the finding keeps the whole path, both wires', () => {
    const path = [w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('e1', 'E1', 't-lamp-c1', 400)], path)
    expect(paths(d).through.map((t) => [t.part.designator, [...t.wires].sort()])).toEqual([['S1', uids(path)]])
  })
  it('a relay and a fuse on the earth are both named, each with its path', () => {
    const path = [w('xs1|PE', 'k1|COM'), w('k1|NO', 'f1|1'), w('f1|2', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200), at('f1', 'F1', 't-fuse', 300), at('e1', 'E1', 't-lamp-c1', 400)], path)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(path))
    expect(p.through.map((t) => [t.part.designator, t.kind, [...t.wires].sort()]).sort()).toEqual([['F1', 'fuse', uids(path)], ['K1', 'relay', uids(path)]])
  })
  it('a DC ground wire hanging off a bonded supply minus is not protective, the supply earth is', () => {
    const gnd = dupont('ps1|-V', 'u1|GND')
    const earth = w('xs1|PE', 'ps1|PE')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200), at('u1', 'U1', 't-mcu', 400)], [earth, gnd])
    const p = paths(d)
    expect(p.wires.has(gnd.uid)).toBe(false)
    expect([...p.wires]).toEqual([earth.uid])
  })
  it('a path through a low-voltage pin is not a protective path', () => {
    const via = [w('xs1|PE', 'u1|GND'), w('u1|GND', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-mcu', 200), at('e1', 'E1', 't-lamp-c1', 400)], via)
    expect([...paths(d).wires]).toEqual([])
  })
  it('a daisy chain through terminal blocks and one lamp to the next is protective end to end', () => {
    const chain = [w('xs1|PE', 'x1|1'), w('x1|1b', 'e1|PE'), w('e1|PE', 'e2|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term', 100), at('e1', 'E1', 't-lamp-c1', 200), at('e2', 'E2', 't-lamp-c1', 400)], chain)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(chain))
    expect(p.through).toEqual([])
  })
  it('an earth spur that leads to no protective terminal is not on a path', () => {
    const pe = w('xs1|PE', 'e1|PE')
    const spur = w('xs1|PE', 'x1|2')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term', 100), at('e1', 'E1', 't-lamp-c1', 200)], [pe, spur])
    expect([...paths(d).wires]).toEqual([pe.uid])
  })
  it('no protective terminal means no protective conductors', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200)], [w('xs1|PE', 'e1|L')])
    const p = paths(d)
    expect([...p.wires]).toEqual([])
    expect(p.through).toEqual([])
  })
  it('is cached per graph', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200)], [w('xs1|PE', 'e1|PE')])
    const plugs = plugsOf(d)
    const g = buildMainsGraph(d, plugs, netlist(d, plugs))!
    expect(protectivePaths(g)).toBe(protectivePaths(g))
  })
  it('matches every simple path by brute force on random earth wiring (parallel wires, loops, spurs)', () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const pins = ['xs1|PE', 'e1|PE', 'e2|PE', 'x1|1', 'x1|1b', 'x1|2', 'x1|2b', 'x2|1', 'x2|1b', 's1|1', 's1|2']
    const inner: [string, string][] = [['x1|1', 'x1|1b'], ['x1|2', 'x1|2b'], ['x2|1', 'x2|1b'], ['s1|1', 's1|2']]
    const parts = [at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200), at('e2', 'E2', 't-lamp-c1', 400),
      at('x1', 'X1', 't-term', 100, 200), at('x2', 'X2', 't-term', 300, 200), at('s1', 'S1', 't-switch', 500, 200)]
    for (let round = 0; round < 200; round++) {
      const wires: Connection[] = []
      for (let k = 2 + rand(9); k > 0; k--) {
        const a = pins[rand(pins.length)]
        const b = pins[rand(pins.length)]
        if (a !== b) wires.push(w(a, b))
      }
      // Brute force: every simple path from the outlet's earth to a lamp's earth, over wires and internal joins.
      const edges = [...wires.map((c) => [`${c.from.part}|${c.from.pin}`, `${c.to.part}|${c.to.pin}`, c.uid]), ...inner.map(([a, b]) => [a, b, ''])]
      const want = new Set<string>()
      const walk = (v: string, seen: Set<string>, used: string[]) => {
        if (v === 'e1|PE' || v === 'e2|PE') for (const u of used) if (u) want.add(u)
        for (const [a, b, uid] of edges) {
          const u = a === v ? b : b === v ? a : null
          if (u === null || seen.has(u)) continue
          seen.add(u)
          walk(u, seen, [...used, uid])
          seen.delete(u)
        }
      }
      walk('xs1|PE', new Set(['xs1|PE']), [])
      expect([...paths(sheet(parts, wires)).wires].sort()).toEqual([...want].sort())
    }
  })
})
