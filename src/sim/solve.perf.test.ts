// Spec 8: one solve (2 engine runs) of a 200-part circuit, Worker end to end, p95 at most 30 ms.
// Ruling R31: measured from the built circuit to the mapped result (compile, worker round trip,
// solve, map back) for both corners; building the circuit from the sheet is the editor's per-edit
// cost: the second test budgets the whole re-solve (build, classify, compile, solve, findings) at
// p95 50 ms. Budgets are never relaxed: on a busy machine, rerun on a quiet one with
// `npx vitest run src/sim/solve.perf.test.ts`.
import { afterAll, describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { type PartSpec, cellModule, sheet } from './testing.ts'
import { solve } from './session.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

/** 201 parts: a 5 V battery and 100 resistor-LED pairs across it. */
const parts: PartSpec[] = [{ uid: 'bt1', module: cellModule(5, 0.05) }]
const wires: [string, string][] = []
for (let i = 0; i < 100; i++) {
  parts.push({ uid: `r${i}`, module: 'resistor', values: { resistance: { value: 150 + i, unit: 'ohm' } } }, { uid: `d${i}`, module: 'led' })
  wires.push(['bt1.+', `r${i}.1`], [`r${i}.2`, `d${i}.A`], [`d${i}.K`, 'bt1.-'])
}
const d = sheet(parts, wires)

/** p95 of 60 timed rounds after 5 warm-up rounds. */
async function p95(round: (k: number) => Promise<void>): Promise<number> {
  const times: number[] = []
  for (let k = 0; k < 65; k++) {
    const t0 = performance.now()
    await round(k)
    if (k >= 5) times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length * 0.95)]
}

describe('solve budget', () => {
  it('solves 201 parts (a battery and 100 resistor-LED pairs) in p95 30 ms or less, both corners', async () => {
    const c = buildCircuit(d)
    const ms = await p95(async (k) => {
      for (const corner of ['typical', 'peak'] as const) expect((await engine.run(c, { kind: 'op', corner }, k)).status).toBe('ok')
    })
    expect(ms).toBeLessThanOrEqual(30)
  }, 120_000)

  it('re-solves the same 201 parts end to end (build, compile, both corners, findings) in p95 50 ms or less', async () => {
    const ms = await p95(async (k) => {
      // A fresh sheet each round (one value edited), so nothing is reused from a cache.
      const edited = { ...d, parts: d.parts.map((p) => (p.uid === 'r0' ? { ...p, values: { resistance: { value: 150 + k, unit: 'ohm' } } } : p)) }
      expect((await solve(edited, engine, k)).outcome.status).toBe('ok')
    })
    expect(ms).toBeLessThanOrEqual(50)
  }, 120_000)
})
