// Spec 2: a solve runs the typical and peak corners (2 engine runs) and assembles a SimResult; the
// session keeps one solve in flight and one pending (a newer request replaces the pending one),
// drops results for older revisions and after stop(), and a failure carries the last good result.
import { afterAll, describe, expect, it, vi } from 'vitest'
import { makeEngine, type Engine, type RunOutcome } from './engine/engine.ts'
import type { EngineHost } from './engine/host.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { SimSession, solve } from './session.ts'
import { cellModule, sheet } from './testing.ts'
import type { SimOutcome } from './results.ts'

const led = sheet(
  [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
  [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
)

/** An engine whose runs finish only when released, recording each run's revision. */
function gatedEngine() {
  const calls: number[] = []
  const gates: (() => void)[] = []
  let fail = false
  let throws = false
  const engine: Engine = {
    host: { runs: 0, info: { name: 'ngspice', version: '45.2', build: 'fake' } } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run: (_c, _a, revision) => {
      calls.push(revision)
      if (throws) return new Promise<RunOutcome>((_res, rej) => gates.push(() => rej(new Error('worker crashed'))))
      return new Promise<RunOutcome>((res) => gates.push(() => res(fail ? { status: 'failed', revision, error: 'x', nodes: [] } : { status: 'ok', revision, raw: { v: {}, pins: {}, dev: {} }, ms: 1 })))
    },
    dispose() {},
  }
  const flush = async () => {
    for (let i = 0; i < 40; i++) {
      gates.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { engine, calls, flush, setFail: (f: boolean) => void (fail = f), setThrow: (t: boolean) => void (throws = t) }
}

describe('solve', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('runs both corners and returns a serialisable SimResult with probes', async () => {
    const { outcome } = await solve({ ...led, probes: [{ id: 'P1', at: { part: 'd1', pin: 'A' } }] }, engine, 4)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    const r = outcome.result
    expect([r.format, r.revision, r.engine.name, r.engine.runs]).toEqual(['circuitoon-sim/1', 4, 'ngspice', 2])
    expect(r.probes[0].voltage?.typical).toMatchObject({ kind: 'value', reference: 'GND' })
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  }, 60_000)
})

describe('SimSession', () => {
  it('keeps one solve in flight and one pending, and delivers only the newest revision', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    s.request(led, 2)
    s.request(led, 3)
    await g.flush()
    expect(g.calls).toEqual([1, 1, 3, 3])
    expect(got.map((o) => (o.status === 'ok' ? o.result.revision : -1))).toEqual([3])
  })
  it('drops a result that arrives after stop()', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    s.stop()
    await g.flush()
    expect(got).toEqual([])
  })
  it('gives a failure the last good result', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    await g.flush()
    g.setFail(true)
    s.request(led, 2)
    await g.flush()
    expect(got[1]).toMatchObject({ status: 'failed', revision: 2, lastGood: { revision: 1 } })
  })
  it('ignores a request after stop()', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.stop()
    s.request(led, 1)
    await g.flush()
    expect([g.calls, got]).toEqual([[], []])
  })
  it('turns a throwing engine into a failed outcome with the last good result', async () => {
    const g = gatedEngine()
    const got: [SimOutcome, unknown][] = []
    const s = new SimSession(g.engine, (o, c) => got.push([o, c]))
    s.request(led, 1)
    await g.flush()
    g.setThrow(true)
    s.request(led, 2)
    await g.flush()
    expect(got[1][0]).toMatchObject({ status: 'failed', revision: 2, finding: { code: 'sim-no-convergence', raw: 'Error: worker crashed' }, lastGood: { revision: 1 } })
    expect(got[1][1]).toBeUndefined()
  })
  it('a throw on a malformed diagram still fails cleanly', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request({ ...led, parts: null } as never, 1)
    await g.flush()
    expect(got).toMatchObject([{ status: 'failed', revision: 1 }])
  })
  it('solves a request that arrived while the solve was throwing', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    g.setThrow(true)
    s.request(led, 1)
    await new Promise((r) => setTimeout(r, 0))
    s.request(led, 2)
    g.setThrow(false)
    await g.flush()
    expect(g.calls).toEqual([1, 2, 2])
    expect(got.map((o) => (o.status === 'ok' ? o.result.revision : o.status))).toEqual([2])
  })
  it('an onOutcome that throws once does not stop later requests (it is logged)', async () => {
    const g = gatedEngine()
    const got: number[] = []
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const s = new SimSession(g.engine, (o) => {
        got.push(o.status === 'ok' ? o.result.revision : -1)
        if (got.length === 1) throw new Error('editor bug')
      })
      s.request(led, 1)
      await g.flush()
      s.request(led, 2)
      await g.flush()
      expect(got).toEqual([1, 2])
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      logged.mockRestore()
    }
  })
})

describe('solve when the engine fails or is unavailable', () => {
  const shorted = sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }], [['bt1.+', 's1.1'], ['s1.2', 'bt1.-']])
  const engine = (status: 'failed' | 'unavailable'): Engine => ({
    host: { runs: 0, info: null } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run: async (_c, _a, revision) => (status === 'failed' ? { status, revision, error: 'singular matrix', nodes: [] } : { status, reason: 'no engine' }),
    dispose() {},
  })
  it('still carries the topological findings: a real short is named with no engine', async () => {
    for (const status of ['failed', 'unavailable'] as const) {
      const { outcome } = await solve(shorted, engine(status), 1)
      expect(outcome.status).toBe(status)
      if (outcome.status === 'ok') return
      expect(outcome.findings.filter((f) => f.code === 'sim-short')).toEqual([expect.objectContaining({ severity: 'error', basis: 'topology', parts: ['bt1', 's1'] })])
    }
  })
})
