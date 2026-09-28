// Protective conductors (spec 1.6): every wire and part edge on any path between a source's earth and
// a protective terminal, parallel and redundant paths included, never through a low-voltage pin, an L
// or N terminal, or a declared bond (Ruling 36); through breadboard strips (Ruling 35).
import { describe, expect, it } from 'vitest'
import { plugsOf } from './breadboard.ts'
import { netlist } from './netlist.ts'
import type { Connection, Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { buildMainsGraph } from './mainsGraph.ts'
import { protectivePaths } from './mainsProtective.ts'
import { at, dupont, sheet, w } from './mains.testing.ts'
import { load } from './builtinModules.testing.ts'

const bb = load('breadboard-half')
const ac = (pins: string[]) => ({ pins, kind: 'terminal', service: 'ac', volts: 450, provenance: 'datasheet' })
/** A three-way Wago-style connector: every position is one conductor. */
const wago = { format: 'circuitoon-module/1', id: 't-wago', name: 'Test lever connector', pins: ['o1', 'o2', 'o3'].map((name) => ({ name, side: 'left' })), internal: [['o1', 'o2', 'o3']], electrical: { ratings: [ac(['o1', 'o2', 'o3'])] } } as ModuleDef
/** An internal group whose first member is an ordinary pin: A and B are still joined. */
const mixed = { format: 'circuitoon-module/1', id: 't-mixed', name: 'Test mixed group', pins: [{ name: 'X', side: 'left', type: 'passive' }, { name: 'A', side: 'left' }, { name: 'B', side: 'right' }], internal: [['X', 'A', 'B']], electrical: { ratings: [ac(['A', 'B'])] } } as ModuleDef
/** A switched fuse holder: a switch and a fuse in one part. */
const swFuse = { format: 'circuitoon-module/1', id: 't-swfuse', name: 'Test switched fuse', pins: ['1', '2', '3'].map((name) => ({ name, side: 'left', type: 'passive' })),
  electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }], protective: [{ from: '2', to: '3', kind: 'fuse' }], ratings: [ac(['1', '2', '3'])] } } as ModuleDef
const EXTRA: Record<string, ModuleDef> = { [bb.id]: bb, 't-wago': wago, 't-mixed': mixed, 't-swfuse': swFuse }
const sheetX = (parts: Parameters<typeof sheet>[0], cs: Connection[]) => sheet(parts, cs, EXTRA)

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
    expect(p.through.map((t) => [t.part.designator, t.kinds, [...t.wires].sort()])).toEqual([['S1', ['switch'], uids(loop)]])
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
    expect(p.through.map((t) => [t.part.designator, t.kinds, [...t.wires].sort()]).sort()).toEqual([['F1', ['fuse'], uids(path)], ['K1', ['relay'], uids(path)]])
  })
  it('a part with a switch and a fuse on the earth names both kinds', () => {
    const path = [w('xs1|PE', 'q1|1'), w('q1|3', 'e1|PE')]
    const d = sheetX([at('xs1', 'XS1', 't-outlet'), at('q1', 'Q1', 't-swfuse', 200), at('e1', 'E1', 't-lamp-c1', 400)], path)
    expect(paths(d).through.map((t) => [t.part.designator, t.kinds, [...t.wires].sort()])).toEqual([['Q1', ['fuse', 'switch'], uids(path)]])
  })
  it('a DC ground wire hanging off a bonded supply minus is not protective, the supply earth is', () => {
    const gnd = dupont('ps1|-V', 'u1|GND')
    const earth = w('xs1|PE', 'ps1|PE')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200), at('u1', 'U1', 't-mcu', 400)], [earth, gnd])
    const p = paths(d)
    expect(p.wires.has(gnd.uid)).toBe(false)
    expect([...p.wires]).toEqual([earth.uid])
  })
  it('a DC wire between two earthed supplies\' bonded minuses is functional, not protective (Ruling 36)', () => {
    const minus = dupont('ps1|-V', 'ps2|-V')
    const earths = [w('xs1|PE', 'ps1|PE'), w('xs1|PE', 'ps2|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200), at('ps2', 'PS2', 't-psu-pelv', 400)], [...earths, minus])
    expect([...paths(d).wires].sort()).toEqual(uids(earths))
  })
  it('an earth wire landing on a bonded minus is protective, but nothing continues past the bond', () => {
    const bond = w('xs1|PE', 'ps1|-V')
    const onward = dupont('ps1|-V', 'e1|PE')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200), at('e1', 'E1', 't-lamp-c1', 400)], [bond, onward])
    expect([...paths(d).wires]).toEqual([bond.uid])
  })
  it('a path through a low-voltage pin is not a protective path', () => {
    const via = [w('xs1|PE', 'u1|GND'), w('u1|GND', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-mcu', 200), at('e1', 'E1', 't-lamp-c1', 400)], via)
    expect([...paths(d).wires]).toEqual([])
  })
  it('a path through an L or N terminal, a converter input or a socket L hole is not a protective path (Ruling 36)', () => {
    const parts = [at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 600), at('e3', 'E3', 't-lamp', 200), at('ps1', 'PS1', 't-psu', 300), at('e1', 'E1', 't-lamp-c1', 400)]
    for (const via of [['e3|L'], ['e3|N'], ['ps1|AC1'], ['xs2|L']]) {
      const cs = [w('xs1|PE', via[0]), w(via[0], 'e1|PE')]
      expect([...paths(sheet(parts, cs)).wires]).toEqual([])
    }
  })
  it('a daisy chain through a terminal block, a lever connector and one lamp\'s earth terminal to the next is protective end to end', () => {
    const chain = [w('xs1|PE', 'x1|1'), w('x1|1b', 'wg|o1'), w('wg|o3', 'e1|PE'), w('e1|PE', 'e2|PE')]
    const d = sheetX([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term', 100), at('wg', 'X2', 't-wago', 150), at('e1', 'E1', 't-lamp-c1', 200), at('e2', 'E2', 't-lamp-c1', 400)], chain)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(chain))
    expect(p.through).toEqual([])
    expect(p.strips).toEqual([])
  })
  it('an earth through a breadboard strip is protective and the strip is listed (Ruling 35)', () => {
    const run = [dupont('xs1|PE', 'bb|c3-top'), dupont('bb|c3-top', 'e1|PE')]
    const d = sheetX([at('xs1', 'XS1', 't-outlet'), at('bb', 'BB1', bb.id, 0, 400), at('e1', 'E1', 't-lamp-c1', 400)], run)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(run))
    expect(p.strips).toEqual([{ part: 'bb', group: 'c3-top' }])
  })
  it('an internal group joins its mains members even when its first member is an ordinary pin', () => {
    const run = [w('xs1|PE', 'mx|A'), w('mx|B', 'e1|PE')]
    const d = sheetX([at('xs1', 'XS1', 't-outlet'), at('mx', 'X3', 't-mixed', 200), at('e1', 'E1', 't-lamp-c1', 400)], run)
    expect([...paths(d).wires].sort()).toEqual(uids(run))
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
  it('matches every simple path by brute force on random wiring (contacts, fuses, bonds, live and ordinary pins, a second outlet, a lever connector, a breadboard)', () => {
    // mulberry32: exact 32-bit arithmetic, so every bit is well mixed.
    let seed = 7
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) % n
    }
    const parts = [at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 600), at('e1', 'E1', 't-lamp-c1', 200), at('e2', 'E2', 't-lamp-c1', 400),
      at('x1', 'X1', 't-term', 100, 200), at('s1', 'S1', 't-switch', 500, 200), at('k1', 'K1', 't-relay', 700, 200), at('f1', 'F1', 't-fuse', 900, 200),
      at('q1', 'Q1', 't-ssr', 1100, 200), at('ps1', 'PS1', 't-psu-pelv', 1300, 200), at('ps2', 'PS2', 't-psu-pelv', 1400, 200), at('u1', 'U1', 't-mcu', 1500, 200),
      at('e3', 'E3', 't-lamp', 1700, 200), at('wg', 'X2', 't-wago', 1900, 200), at('mx', 'X3', 't-mixed', 2100, 200), at('bb', 'BB1', bb.id, 0, 800)]
    // The oracle's own table: where a path may pass (Rulings 35 and 36, spec 1.6), where it may end, and each part's inner edges.
    const pass = new Set(['xs1|PE', 'xs2|PE', 'e1|PE', 'e2|PE', 'x1|1', 'x1|1b', 'x1|2', 'x1|2b', 's1|1', 's1|2', 'k1|COM', 'k1|NO', 'k1|NC', 'f1|1', 'f1|2',
      'q1|1', 'q1|2', 'ps1|PE', 'ps2|PE', 'wg|o1', 'wg|o2', 'wg|o3', 'mx|A', 'mx|B', 'bb|c1-top', 'bb|c2-top', 'bb|top-'])
    const ends = new Set(['e1|PE', 'e2|PE', 'ps1|PE', 'ps2|PE', 'ps1|-V', 'ps2|-V'])
    const blocked = ['xs1|L', 'xs2|N', 'e1|L', 'e3|L', 'k1|-', 'q1|4', 'ps1|+V', 'ps1|AC1', 'u1|GND', 'u1|IO', 'mx|X']
    const pins = [...pass, ...ends, ...blocked].filter((x, i, a) => a.indexOf(x) === i)
    const earthy = [...pass, ...ends].filter((x, i, a) => a.indexOf(x) === i)
    const inner: [string, string, string][] = [['x1|1', 'x1|1b', ''], ['x1|2', 'x1|2b', ''], ['s1|1', 's1|2', 's1'], ['k1|COM', 'k1|NO', 'k1'], ['k1|COM', 'k1|NC', 'k1'],
      ['f1|1', 'f1|2', 'f1'], ['q1|1', 'q1|2', 'q1'], ['ps1|-V', 'ps1|PE', ''], ['ps2|-V', 'ps2|PE', ''], ['wg|o1', 'wg|o2', ''], ['wg|o1', 'wg|o3', ''], ['wg|o2', 'wg|o3', ''],
      ['mx|X', 'mx|A', ''], ['mx|X', 'mx|B', ''], ['mx|A', 'mx|B', '']]
    let partial = 0
    for (let round = 0; round < 300; round++) {
      const wires: Connection[] = []
      // Mostly earth-side pins, so most rounds have paths, some through blocked pins.
      const pick = () => (rand(4) ? earthy[rand(earthy.length)] : pins[rand(pins.length)])
      for (let k = 4 + rand(12); k > 0; k--) {
        const a = pick()
        const b = pick()
        if (a !== b) wires.push(w(a, b))
      }
      const edges = [...wires.map((c) => [`${c.from.part}|${c.from.pin}`, `${c.to.part}|${c.to.pin}`, `w:${c.uid}`]), ...inner.map(([a, b, p]) => [a, b, p && `p:${p}`])]
      const want = new Set<string>()
      const walk = (v: string, seen: Set<string>, used: string[]) => {
        if (used.length && ends.has(v)) for (const u of used) if (u) want.add(u)
        if (used.length && !pass.has(v)) return
        for (const [a, b, id] of edges) {
          const u = a === v ? b : b === v ? a : null
          if (u === null || seen.has(u) || (!pass.has(u) && !ends.has(u))) continue
          seen.add(u)
          walk(u, seen, [...used, id])
          seen.delete(u)
        }
      }
      for (const s of ['xs1|PE', 'xs2|PE']) walk(s, new Set([s]), [])
      const p = paths(sheetX(parts, wires))
      const got = [...[...p.wires].map((x) => `w:${x}`), ...p.through.map((t) => `p:${t.part.uid}`)].sort()
      expect(got).toEqual([...want].sort())
      const strips = [...want].filter((x) => x.startsWith('w:')).flatMap((x) => {
        const c = wires.find((c) => `w:${c.uid}` === x)!
        return [c.from, c.to].filter((e) => e.part === 'bb').map((e) => e.pin)
      })
      expect(p.strips.map((s) => s.group).sort()).toEqual([...new Set(strips)].sort())
      if (want.size && [...want].some((x) => x.startsWith('w:')) && [...want].filter((x) => x.startsWith('w:')).length < wires.length) partial++
    }
    expect(partial).toBeGreaterThan(100)
  })
})
