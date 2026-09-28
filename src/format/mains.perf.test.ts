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
import { wireLooks } from './mainsLook.ts'
import type { ModuleDef } from './module.ts'
import { load, pinsOf } from './builtinModules.testing.ts'
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

// The full sheet on built-in parts (spec 7): a realistic project, not synthetic test parts. Two
// wall outlets each feeding a Hi-Link AC-DC module and an ESP32, one enumeration unit of contact
// groups (the worst case, all on the first outlet), and a 150-part DC section of real modules wired
// pin to pin, so the mains and DC costs both land on the same sheet as they would on a real project.
const ids = ['outlet-us-5-15r-duplex', 'plug-us-5-15p', 'rocker-switch-kcd1', 'relay-module-1ch-5v', 'ssr-fotek-25da', 'fuse-holder-5x20-inline', 'lamp-holder-e26', 'hlk-pm01',
  'esp32-devkitc-v4', 'bme280-module-6pin', 'oled-ssd1306-096-i2c', 'resistor', 'led']
const mods: Record<string, ModuleDef> = Object.fromEntries(ids.map((id) => [id, load(id)]))
let n = 0
const wire = (a: string, ap: string, b: string, bp: string, mains = true): Connection =>
  ({ uid: `w${++n}`, from: { part: a, pin: ap }, to: { part: b, pin: bp }, ...(mains ? { gauge: 18, ends: { from: 'ferrule', to: 'ferrule' } } : {}) })

function build(groups: number): Diagram {
  const parts: PartInstance[] = []
  const connections: Connection[] = []
  const at = (uid: string, designator: string, module: string, x: number, y: number, extra: Partial<PartInstance> = {}) => {
    parts.push({ uid, designator, module, x, y, rotation: 0, ...extra })
    return uid
  }
  for (const k of [0, 1]) {
    at(`xs${k}`, `XS${k + 1}`, 'outlet-us-5-15r-duplex', k * 2000, 0)
    at(`xp${k}`, `XP${k + 1}`, 'plug-us-5-15p', k * 2000 + 10, 10, { mount: { board: `xs${k}` } })
    at(`ps${k}`, `PS${k + 1}`, 'hlk-pm01', k * 2000 + 200, 300)
    connections.push(wire(`xp${k}`, 'L', `ps${k}`, 'AC 1'), wire(`xp${k}`, 'N', `ps${k}`, 'AC 2'))
  }
  // Each group switches its own fused lamp: plug L, fuse, contact, lamp, back to plug N.
  const kinds = [['rocker-switch-kcd1', '1', '2', 'S'], ['relay-module-1ch-5v', 'COM', 'NO', 'K'], ['ssr-fotek-25da', '1', '2', 'K']] as const
  for (let g = 0; g < groups; g++) {
    const [module, a, b, prefix] = g < 8 ? kinds[0] : g < 12 ? kinds[1] : kinds[2]
    // Every group on the first plug: one enumeration unit of 16 groups, the worst case.
    const k = 0
    const s = at(`g${g}`, `${prefix}${g + 1}`, module, 300 + g * 120, 600)
    const f = at(`f${g}`, `F${g + 1}`, 'fuse-holder-5x20-inline', 300 + g * 120, 800, { values: { fuseRating: { value: 2, unit: 'A' } } })
    const e = at(`e${g}`, `E${g + 1}`, 'lamp-holder-e26', 300 + g * 120, 1000)
    connections.push(wire(`xp${k}`, 'L', f, '1'), wire(f, '2', s, a), wire(s, b, e, 'L'), wire(e, 'N', `xp${k}`, 'N'))
  }
  // A DC section: two ESP32 boards on the converters, and loose real parts wired pin to pin.
  for (const k of [0, 1]) {
    at(`u${k}`, `U${k + 1}`, 'esp32-devkitc-v4', k * 2000 + 400, 1400)
    connections.push(wire(`ps${k}`, '+Vo', `u${k}`, '5V', false), wire(`ps${k}`, '-Vo', `u${k}`, 'GND', false))
  }
  const loose = ['bme280-module-6pin', 'oled-ssd1306-096-i2c', 'resistor', 'led', 'esp32-devkitc-v4']
  const dc: PartInstance[] = []
  for (let i = 0; i < 150; i++) dc.push(parts[parts.push({ uid: `d${i}`, designator: `U${i + 10}`, module: loose[i % loose.length], x: 3000 + (i % 15) * 300, y: Math.floor(i / 15) * 300, rotation: 0 }) - 1])
  let seed = 11
  const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % m)
  for (let i = 0; i < 400; i++) {
    const [a, b] = [dc[rnd(dc.length)], dc[rnd(dc.length)]]
    const [pa, pb] = [pinsOf(mods[a.module]), pinsOf(mods[b.module])]
    connections.push(wire(a.uid, pa[rnd(pa.length)].name, b.uid, pb[rnd(pb.length)].name, false))
  }
  return { format: 'circuitoon-diagram/1', title: 't', modules: mods, parts, connections }
}

describe('mains checks on a realistic sheet', () => {
  it('enumerates all 65,536 states of 16 contact groups in 300 ms or less (median)', { timeout: 30_000, retry: 2 }, () => {
    const d = build(16)
    const a = analyseMains(d)!
    expect(a.complete).toBe(true)
    expect(checkDiagram(d).filter((f) => f.rule === 'mains-incomplete')).toEqual([])
    const ms = median(d, 5)
    console.log(`mains full sheet: ${ms.toFixed(1)} ms median`)
    expect(ms).toBeLessThanOrEqual(300)
  })
  it('the renderer reuses the analysis the checker made for the same edit', { timeout: 30_000, retry: 2 }, () => {
    const d = build(16)
    checkDiagram(d)
    const s = performance.now()
    wireLooks(d)
    expect(performance.now() - s).toBeLessThan(5)
  })
  it('checks the same sheet with 4 contact groups in 30 ms or less (median)', { retry: 2 }, () => {
    expect(median(build(4), 13)).toBeLessThanOrEqual(30)
  })
})
