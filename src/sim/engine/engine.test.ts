// Spec 2: Engine.run compiles, runs on the worker and maps vectors back to nets, pins and devices;
// a failure keeps the engine's text and names the circuit nodes it mentioned.
import { afterAll, describe, expect, it } from 'vitest'
import { buildCircuit } from '../build.ts'
import { ledHandCalc, ledModel } from '../ledModels.ts'
import { cellModule, sheet } from '../testing.ts'
import { makeEngine } from './engine.ts'
import { EngineHost, type FromWorker, type WorkerLike } from './host.ts'
import { createNodeEngineHost } from './nodeEngine.ts'

const led = sheet(
  [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
  [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
)

describe('Engine', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('maps node voltages, pin currents and delivered current back', async () => {
    const r = await engine.run(buildCircuit(led), { kind: 'op', corner: 'typical' }, 7)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.revision).toBe(7)
    const hand = ledHandCalc(5, 150, ledModel('red', 2).model)
    expect(Math.abs(r.raw.v['net:D1_A'] - hand.anode)).toBeLessThan(1e-5)
    expect(r.raw.pins.d1.A).toBeCloseTo(hand.amps, 6)
    expect(r.raw.pins.d1.K).toBeCloseTo(-hand.amps, 6)
    expect(r.raw.dev['bt1.cell']).toBeCloseTo(hand.amps, 6)
  }, 60_000)
  it('reports a failure with the circuit nodes the engine named', async () => {
    const spawn = (): WorkerLike => {
      let cb: (m: FromWorker) => void = () => {}
      queueMicrotask(() => cb({ type: 'ready', engine: { name: 'ngspice', version: '45.2', build: 'fake' } }))
      return { post: (m) => queueMicrotask(() => cb({ type: 'result', id: m.id, runs: [{ ok: false, error: 'singular matrix: check node n2', ms: 1 }], heap: 1 })), onMessage: (f) => (cb = f), onExit() {}, terminate() {} }
    }
    const r = await makeEngine(new EngineHost({ spawn })).run(buildCircuit(led), { kind: 'op', corner: 'typical' }, 3)
    expect(r).toEqual({ status: 'failed', revision: 3, error: 'singular matrix: check node n2', nodes: ['net:D1_A'] })
  })
  it('runs both corners in one worker message (2 engine runs), the same as two single runs', async () => {
    const c = buildCircuit(led)
    const before = engine.host.runs
    const both = await engine.runAll(c, [{ kind: 'op', corner: 'typical' }, { kind: 'op', corner: 'peak' }], 4)
    expect(engine.host.runs - before).toBe(2)
    const one = await engine.run(c, { kind: 'op', corner: 'peak' }, 4)
    expect(both.map((r) => r.status)).toEqual(['ok', 'ok'])
    if (both[1].status === 'ok' && one.status === 'ok') expect(both[1].raw).toEqual(one.raw)
  }, 60_000)
})
