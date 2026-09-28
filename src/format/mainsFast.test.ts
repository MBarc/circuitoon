// The Task 11 optimisations change how the enumeration runs, never what it finds: on random sheets
// of every synthetic mains part (outlets, converters, lamps, switches, relays, SSRs, fuses fitted and
// empty, terminal blocks, low-voltage boards), the fast path must give exactly what the plain path
// gives. Every fixture sheet of the other mains tests gets the same check (mains.testing.ts).
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { isSpacer } from './module.ts'
import { analyseMains } from './mains.ts'
import { MAINS_MODULES, at, dupont, expectSameAsPlain, w } from './mains.testing.ts'

const OUTLETS = ['t-outlet', 't-outlet-2', 't-outlet-eu']
const PARTS = [
  't-psu', 't-psu-basic', 't-psu-screen', 't-psu-basic-bonded', 't-psu-pelv', 't-psu-mislabeled', 't-psu-mainsonly',
  't-lamp', 't-lamp-c1', 't-lamp-230', 't-switch', 't-switch-co', 't-relay', 't-relay-unknown', 't-relay-2p', 't-relay-board-2',
  't-ssr', 't-ssr-basic', 't-fuse', 't-fuse', 't-term', 't-term-125', 't-term-dc', 't-term-cond', 't-term-bare', 't-term-unverified',
  't-mcu', 't-mcu33', 't-bat9', 't-undeclared',
]
const groupsOf = (module: string) => ((MAINS_MODULES[module].electrical as { contacts?: unknown[] } | undefined)?.contacts ?? []).length
const terminals = (module: string) => [...MAINS_MODULES[module].pins.flatMap((p) => (isSpacer(p) ? [] : [p.name])), ...(MAINS_MODULES[module].holes ?? []).map((h) => h.name)]

/** A random sheet: one to three outlets, up to `maxGroups` contact groups, and random mains and Dupont wires between any terminals. */
function randomSheet(rnd: (n: number) => number, maxGroups: number): Diagram {
  const parts: PartInstance[] = []
  const outlets = 1 + rnd(3)
  for (let o = 0; o < outlets; o++) parts.push(at(`xs${o}`, `XS${o + 1}`, OUTLETS[rnd(OUTLETS.length)], o * 200, 0))
  let groups = 0
  const count = 3 + rnd(10)
  for (let k = 0; k < count; k++) {
    const module = PARTS[rnd(PARTS.length)]
    if (groups + groupsOf(module) > maxGroups) continue
    groups += groupsOf(module)
    const extra: Partial<PartInstance> = module === 't-fuse'
      ? { ...(rnd(3) === 0 ? { settings: { fuse: 'absent' } } : {}), ...(rnd(2) ? { values: { fuseRating: { value: 1 + rnd(10), unit: 'A' } } } : {}) }
      : {}
    parts.push(at(`p${k}`, `P${k + 1}`, module, k * 100, 300, extra))
  }
  const ends = parts.flatMap((p) => terminals(p.module).map((t) => `${p.uid}|${t}`))
  const connections: Connection[] = []
  // Half the loads and converters sit properly across one outlet, so supplies (and voltage mismatches) occur, not only faults.
  const across: Record<string, [string, string]> = { 't-lamp': ['L', 'N'], 't-lamp-c1': ['L', 'N'], 't-lamp-230': ['L', 'N'], 't-psu': ['AC1', 'AC2'], 't-psu-basic': ['AC1', 'AC2'], 't-psu-mainsonly': ['AC1', 'AC2'] }
  for (const p of parts) {
    const pins = across[p.module]
    if (!pins || rnd(2)) continue
    const o = rnd(outlets)
    connections.push(w(`xs${o}|L`, `${p.uid}|${pins[0]}`), w(`${p.uid}|${pins[1]}`, `xs${o}|N`))
  }
  const wires = 3 + rnd(3 * parts.length)
  for (let k = 0; k < wires; k++) {
    const [a, b] = [ends[rnd(ends.length)], ends[rnd(ends.length)]]
    if (a !== b) connections.push(rnd(4) === 0 ? dupont(a, b) : w(a, b))
  }
  return { format: 'circuitoon-diagram/1', title: 't', modules: MAINS_MODULES, parts, connections }
}

describe('the fast enumeration against the plain path', () => {
  it('gives identical findings, converters, hazards and identity on 400 random sheets', { timeout: 120_000 }, () => {
    let seed = 11
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
    const rules = new Set<string>()
    for (let i = 0; i < 400; i++) {
      // Mostly small units; one sheet in ten up to 12 groups (4,096 states), so long witnesses and deep units are covered too.
      const d = randomSheet(rnd, i % 10 === 0 ? 12 : 6)
      expectSameAsPlain(d)
      for (const f of analyseMains(d)?.findings ?? []) rules.add(f.rule)
    }
    // The sheets reach most mains rules, so the comparison is not vacuous.
    expect([...rules].sort()).toEqual(expect.arrayContaining(['earth', 'mains-cross-source', 'mains-short', 'mains-to-low-voltage', 'mains-voltage', 'no-power', 'polarity', 'unprotected']))
  })
})
