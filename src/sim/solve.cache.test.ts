// Perf ruling (firmware slice 1): solve() patches a run-state change onto the circuit it built for an
// unchanged sheet, and reuses the classification of the same GPIO states. The guard: over random
// run-state changes (high, low, PWM duties, input pulls, servos moving, no running code), the cached
// path's circuit, compiled texts and findings are byte-identical to a fresh full build.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import type { RunPinState, RunPins } from '../format/simState.ts'
import { load } from '../format/builtinModules.testing.ts'
import { piBlinkSample, piButtonSample } from '../samples/piSamples.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { analyseRuns, topologyFindings } from './findings.ts'
import { classify, classifyCached } from './floating.ts'
import type { Analysis, Circuit } from './model.ts'
import { pwmPlan } from './pwm.ts'
import { solve, solveCacheHolds } from './session.ts'
import { compile } from './spice.ts'
import { pwmPerfSheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

/** The blink sample with an SG90 on the 5 V supply and GPIO18. */
const servoSheet: Diagram = {
  ...piBlinkSample,
  modules: { ...piBlinkSample.modules, 'servo-sg90': load('servo-sg90') },
  parts: [...piBlinkSample.parts, { uid: 'm1', designator: 'M1', module: 'servo-sg90', x: 700, y: 300 }],
  connections: [
    ...piBlinkSample.connections,
    { uid: 'w20', from: { part: 'p6', pin: '5V+' }, to: { part: 'm1', pin: 'VCC' } },
    { uid: 'w21', from: { part: 'p6', pin: '5V-' }, to: { part: 'm1', pin: 'GND' } },
    { uid: 'w22', from: { part: 'p2', pin: 'GPIO18' }, to: { part: 'm1', pin: 'PWM' } },
  ],
}
const SHEETS: [string, Diagram, string, string[]][] = [
  ['the 200-part perf sheet', pwmPerfSheet(), 'u1', []],
  ['the Pi blink sample', piBlinkSample, 'p2', []],
  ['the Pi button sample', piButtonSample, 'p2', []],
  ['a Pi with a servo', servoSheet, 'p2', ['m1']],
]

/** Deterministic random numbers (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const analysesOf = (c: Circuit): Analysis[] => {
  const plan = pwmPlan(c)
  return [
    ...(plan ? plan.runs.map((pins) => ({ kind: 'op' as const, corner: 'typical' as const, pins })) : [{ kind: 'op' as const, corner: 'typical' as const }]),
    ...(plan ? plan.peak.map((pins) => ({ kind: 'op' as const, corner: 'peak' as const, pins })) : [{ kind: 'op' as const, corner: 'peak' as const }]),
  ]
}

/** What solve() would find on a fresh full build: the same steps, nothing cached. */
async function freshFindings(c: Circuit): Promise<unknown> {
  const cls = classify(c)
  const topo = topologyFindings(c, cls)
  const analyses = analysesOf(c)
  const runs = await engine.runAll(c, analyses, 0)
  const raws = runs.map((r) => (r.status === 'ok' ? r.raw : null))
  if (raws.some((r) => r === null)) return runs
  const typical = analyses.filter((a) => a.corner === 'typical').length
  return analyseRuns(c, cls, { typical: raws.slice(0, typical) as never, peak: raws.slice(typical) as never }, topo, pwmPlan(c)).findings
}

describe('run-state changes reuse the built circuit (perf ruling)', () => {
  for (const [name, sheet, board, servos] of SHEETS)
    it(`gives the same circuit, texts and findings as a full build on ${name}`, async () => {
      const random = rng(name.length * 7919)
      let d = sheet
      // The board's wired pins and two spare ones (PWM on every pin would make each solve dozens of texts).
      const all = buildCircuit(d).gpio.filter((g) => g.part === board).map((g) => g.pin)
      const wired = all.filter((pin) => d.connections.some((c) => [c.from, c.to].some((e) => e.part === board && e.pin === pin)))
      const pins = [...wired, ...all.filter((pin) => !wired.includes(pin)).slice(0, 2)]
      const states = (): RunPinState => {
        const x = Math.floor(random() * 6)
        return x === 5 ? { pwm: Math.round(random() * 63 + 1) / 64 } : (['high', 'low', 'input', 'input-pullup', 'input-pulldown'] as const)[x]
      }
      let run: Record<string, RunPinState> = {}
      let moving: string[] = []
      for (let k = 0; k < 30; k++) {
        // A new object every change, as the editor makes; now and then the code stops (no run pins).
        run = { ...run }
        for (let n = Math.floor(random() * 3) + 1; n > 0; n--) run[pins[Math.floor(random() * pins.length)]] = states()
        if (random() < 0.3) moving = servos.filter(() => random() < 0.5)
        const stopped = random() < 0.15
        // Mid-sequence, a value edit (a new parts array, as the store makes) and a button held for three steps.
        if (k === 10) d = { ...d, parts: d.parts.map((p) => (p.module === 'resistor' && p === d.parts.find((x) => x.module === 'resistor') ? { ...p, values: { resistance: { value: 470, unit: 'ohm' } } } : p)) }
        const button = d.parts.find((p) => p.module === 'push-button')
        const held = button && k >= 15 && k < 18 ? { held: { part: button.uid, group: 's' } } : {}
        const opts = stopped ? held : { ...held, runPins: { [board]: run } as RunPins, moving }
        const { circuit, outcome } = await solve(d, engine, k, opts)
        const fresh = buildCircuit(d, opts)
        expect(JSON.stringify(circuit), `step ${k}`).toBe(JSON.stringify(fresh))
        const texts = (c: Circuit, cls: ReturnType<typeof classify>) => analysesOf(c).map((a) => compile(c, cls, a).text)
        expect(texts(circuit, classifyCached(circuit)), `step ${k}`).toEqual(texts(fresh, classify(fresh)))
        expect(JSON.stringify(outcome.status === 'ok' ? outcome.result.findings : outcome), `step ${k}`).toBe(JSON.stringify(await freshFindings(fresh)))
      }
    }, 120_000)
  it('keeps only the last sheet solved', async () => {
    const [a, b] = [piBlinkSample, piButtonSample]
    await solve(a, engine, 1)
    expect(solveCacheHolds(a.parts)).toBe(true)
    await solve(b, engine, 2)
    expect([solveCacheHolds(a.parts), solveCacheHolds(b.parts)]).toEqual([false, true])
  })
})
