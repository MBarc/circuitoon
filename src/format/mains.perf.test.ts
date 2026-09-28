// Mains checks at the size a real project reaches (spec 7). Task 11 is the first checkpoint, on
// synthetic parts: one outlet and 16 fused, switched lamps in one enumeration unit, plus the worst
// cases around it (every state changing the findings, ten outlets). Task 24 adds the full sheet on
// built-in parts. Every state is enumerated; the checker stays off the drag path, so the budget is per
// edit. Every sheet made here also goes through the differential check against the plain path
// (mains.testing.ts), so the fast enumeration is timed on exactly the sheets it is proven on.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { analyseMains } from './mains.ts'
import { at, dupont, sheet, w } from './mains.testing.ts'

/** Sorted timings of `runs` checks, each on a fresh parts array as after an edit (so no cache carries over), after one warm-up. */
export function timings(d: Diagram, runs: number): number[] {
  checkDiagram({ ...d, parts: [...d.parts] })
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const next = { ...d, parts: [...d.parts], connections: [...d.connections] }
    const s = performance.now()
    checkDiagram(next)
    t.push(performance.now() - s)
  }
  return t.sort((a, b) => a - b)
}

/** Median of `runs` timed checks. */
export function median(d: Diagram, runs: number): number {
  const t = timings(d, runs)
  return t[Math.floor(runs / 2)]
}

/**
 * Checks `d` within `budget` ms. The full suite runs files in parallel, so the assertion takes the
 * best of the samples (a slow sample is CPU contention, not a regression) and the test retries; the
 * median and p95 are logged, and the Task 11 report records them from an isolated run.
 */
function withinBudget(name: string, d: Diagram, budget: number, runs = 7): void {
  const a = analyseMains(d)!
  expect(a.complete).toBe(true)
  expect(checkDiagram(d).filter((f) => f.rule === 'mains-incomplete')).toEqual([])
  const t = timings(d, runs)
  const p95 = t[Math.min(runs - 1, Math.ceil(runs * 0.95) - 1)]
  console.log(`mains ${name}: best ${t[0].toFixed(1)} ms, median ${t[Math.floor(runs / 2)].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${a.findings.length} findings)`)
  expect(t[0]).toBeLessThanOrEqual(budget)
}

/** One outlet and `n` fused, switched lamps (L, fuse, switch, lamp, N); `empty` leaves the first holder without its fuse. */
function switchedLamps(n: number, empty = false): Diagram {
  const parts: PartInstance[] = [at('xs1', 'XS1', 't-outlet')]
  const connections: Connection[] = []
  for (let k = 1; k <= n; k++) {
    const holder = { values: { fuseRating: { value: 2, unit: 'A' } }, ...(empty && k === 1 ? { settings: { fuse: 'absent' } } : {}) }
    parts.push(at(`f${k}`, `F${k}`, 't-fuse', k * 120, 200, holder), at(`s${k}`, `S${k}`, 't-switch', k * 120, 400), at(`e${k}`, `E${k}`, 't-lamp', k * 120, 600))
    connections.push(w('xs1|L', `f${k}|1`), w(`f${k}|2`, `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, 'xs1|N'))
  }
  return sheet(parts, connections)
}

/**
 * 16 groups where every state has its own findings: each group adds or removes one in every state
 * (L onto a board's I/O, a class 1 lamp switched in N, a relay putting L on earth, an SSR feeding an
 * unfused lamp), so no two of the 65,536 states report the same set.
 */
function everyStateDiffers(): Diagram {
  const parts: PartInstance[] = [at('xs1', 'XS1', 't-outlet')]
  const connections: Connection[] = []
  for (let k = 1; k <= 16; k++) {
    const x = k * 120
    if (k % 4 === 0) {
      parts.push(at(`s${k}`, `S${k}`, 't-switch', x, 400), at(`u${k}`, `U${k}`, 't-mcu', x, 600))
      connections.push(w('xs1|L', `s${k}|1`), dupont(`s${k}|2`, `u${k}|IO`))
    } else if (k % 4 === 1) {
      parts.push(at(`s${k}`, `S${k}`, 't-switch', x, 400), at(`e${k}`, `E${k}`, 't-lamp-c1', x, 600))
      connections.push(w('xs1|L', `e${k}|L`), w(`e${k}|N`, `s${k}|1`), w(`s${k}|2`, 'xs1|N'), w(`e${k}|PE`, 'xs1|PE'))
    } else if (k % 4 === 2) {
      parts.push(at(`s${k}`, `K${k}`, 't-relay', x, 400))
      connections.push(w('xs1|L', `s${k}|COM`), w(`s${k}|NO`, 'xs1|PE'))
    } else {
      parts.push(at(`s${k}`, `K${k}`, 't-ssr', x, 400), at(`e${k}`, `E${k}`, 't-lamp', x, 600))
      connections.push(w('xs1|L', `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, 'xs1|N'))
    }
  }
  return sheet(parts, connections)
}

/** A chain: S1 to S16 in series from L, a board's I/O and a lamp at every link, so findings need long witnesses ("when S1, S2 and S3 are on"). */
function ladder(): Diagram {
  const parts: PartInstance[] = [at('xs1', 'XS1', 't-outlet')]
  const connections: Connection[] = []
  for (let k = 1; k <= 16; k++) {
    parts.push(at(`s${k}`, `S${k}`, 't-switch', k * 120, 400), at(`u${k}`, `U${k}`, 't-mcu', k * 120, 600), at(`e${k}`, `E${k}`, 't-lamp', k * 120, 800))
    connections.push(w(k === 1 ? 'xs1|L' : `s${k - 1}|2`, `s${k}|1`), dupont(`s${k}|2`, `u${k}|IO`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, k % 2 ? 'xs1|N' : 'xs1|PE'))
  }
  return sheet(parts, connections)
}

/** Ten outlets (the most the checker enumerates) with their earths joined, and 16 fused switched class 1 lamps over them: one unit of ten sources. */
function tenOutlets(): Diagram {
  const parts: PartInstance[] = []
  const connections: Connection[] = []
  for (let o = 1; o <= 10; o++) {
    parts.push(at(`xs${o}`, `XS${o}`, o % 2 ? 't-outlet' : 't-outlet-2', o * 200, 0))
    if (o > 1) connections.push(w(`xs${o - 1}|PE`, `xs${o}|PE`))
  }
  for (let k = 1; k <= 16; k++) {
    const o = ((k - 1) % 10) + 1
    parts.push(at(`f${k}`, `F${k}`, 't-fuse', k * 120, 200, { values: { fuseRating: { value: 2, unit: 'A' } } }), at(`s${k}`, `S${k}`, 't-switch', k * 120, 400), at(`e${k}`, `E${k}`, 't-lamp-c1', k * 120, 600))
    connections.push(w(`xs${o}|L`, `f${k}|1`), w(`f${k}|2`, `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, `xs${o}|N`), w(`e${k}|PE`, `xs${o}|PE`))
  }
  return sheet(parts, connections)
}

/** Ten outlets joined to each other by 16 switches (L, N and earth crossed in turn): crossed sources, shared neutrals and shorts in most states. */
function tenCrossed(): Diagram {
  const parts: PartInstance[] = []
  const connections: Connection[] = []
  for (let o = 1; o <= 10; o++) parts.push(at(`xs${o}`, `XS${o}`, 't-outlet', o * 200, 0))
  for (let k = 1; k <= 16; k++) {
    const [a, b] = [((k - 1) % 10) + 1, (k % 10) + 1]
    parts.push(at(`s${k}`, `S${k}`, 't-switch', k * 120, 400))
    connections.push(w(`xs${a}|${['L', 'N', 'PE'][k % 3]}`, `s${k}|1`), w(`s${k}|2`, `xs${b}|${['N', 'PE', 'L'][k % 3]}`))
  }
  return sheet(parts, connections)
}

const RETRY = { timeout: 60_000, retry: 2 }

describe('mains checkpoint: one outlet, 16 fused switched lamps', () => {
  it('enumerates all 65,536 states in 300 ms or less', RETRY, () => {
    withinBudget('checkpoint, 16 fused switched lamps', switchedLamps(16), 300)
  })
  it('stays within 300 ms with an empty fuse holder (the fitted-fuse pass runs too)', RETRY, () => {
    withinBudget('16 lamps, one holder empty', switchedLamps(16, true), 300)
  })
})

describe('mains worst cases at 16 groups', () => {
  it('every state changes the findings: 300 ms or less', RETRY, () => {
    const d = everyStateDiffers()
    // Each group brings its own finding in one of its positions, so no two states agree.
    expect(analyseMains(d)!.findings.length).toBeGreaterThanOrEqual(16)
    withinBudget('every state changes the findings', d, 300, 5)
  })
  it('findings that need long witnesses: 300 ms or less', RETRY, () => {
    withinBudget('16 switches in series', ladder(), 300, 5)
  })
  it('ten outlets with 16 fused switched lamps: 300 ms or less', RETRY, () => {
    const d = tenOutlets()
    expect(analyseMains(d)!.graph.sources).toHaveLength(10)
    withinBudget('ten outlets, 16 lamps', d, 300, 5)
  })
  it('ten outlets crossed by 16 switches: 300 ms or less', RETRY, () => {
    withinBudget('ten outlets crossed', tenCrossed(), 300, 5)
  })
})
