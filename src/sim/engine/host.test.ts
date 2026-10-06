// The worker lifecycle (spec 2.3) against a fake worker: success, failure, success on one worker
// (an ordinary circuit failure keeps it); a fresh worker after a dead engine or an idle exit;
// dispose during a load answers at once; a timeout terminates, retries once, then fails; recycling after
// N engine runs; an engine that cannot load, or does not load in time, is "unavailable"; requests
// run one at a time; a batch is one message, with the timeout, retry and recycling per message.
import { describe, expect, it } from 'vitest'
import { EngineHost, type FromWorker, type RunAnswer, type ToWorker, type WorkerLike } from './host.ts'

/**
 * A fake worker: "bad" fails, "hang" never answers, "trap" answers as the worker loop does when
 * core.op() throws (a WASM abort), "crash" makes the worker exit mid-run, anything else solves to { a: 1 }.
 */
function fakes(opts: { fatal?: boolean; silent?: boolean } = {}) {
  const made: { terminated: boolean; exit: () => void }[] = []
  const posted: string[][] = []
  const spawn = (): WorkerLike => {
    let listener: (m: FromWorker) => void = () => {}
    let exited: () => void = () => {}
    const me = { terminated: false, exit: () => exited() }
    made.push(me)
    if (!opts.silent) queueMicrotask(() => listener(opts.fatal ? { type: 'fatal', error: 'no wasm' } : { type: 'ready', engine: { name: 'ngspice', version: '45.2', build: 'test' } }))
    return {
      post(m: ToWorker) {
        posted.push(m.texts)
        // As the worker loop does: the texts in order, stopping at the first failure.
        const runs: RunAnswer[] = []
        for (const text of m.texts) {
          if (text === 'hang') return
          if (text === 'crash') return void queueMicrotask(() => exited())
          runs.push(text === 'trap' ? { ok: false, error: 'the simulation engine stopped: Aborted()', dead: true, ms: 1 } : text === 'bad' ? { ok: false, error: 'singular', ms: 1 } : { ok: true, vectors: { a: 1 }, ms: 1 })
          if (!runs[runs.length - 1].ok) break
        }
        queueMicrotask(() => listener({ type: 'result', id: m.id, runs, heap: 100 }))
      },
      onMessage(cb) {
        listener = cb
      },
      onExit(cb) {
        exited = cb
      },
      terminate() {
        me.terminated = true
      },
    }
  }
  return { made, spawn, posted }
}

describe('EngineHost', () => {
  it('solves, fails, then solves again on the same worker: a circuit failure does not recycle it', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn })
    expect(await host.runText('ok')).toEqual({ status: 'ok', vectors: { a: 1 }, ms: 1 })
    expect(await host.runText('bad')).toEqual({ status: 'failed', error: 'singular' })
    expect(f.made[0].terminated).toBe(false)
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
    expect(host.spawned).toBe(1)
    expect(host.runs).toBe(3)
  })
  it('replaces a worker that exits while idle on the next request', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn })
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
    f.made[0].exit()
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
    expect(host.spawned).toBe(2)
  })
  it('rejects a waiting load at once when disposed during it', async () => {
    const f = fakes({ silent: true })
    const host = new EngineHost({ spawn: f.spawn, loadTimeoutMs: 60_000 })
    const run = host.runText('ok')
    await new Promise((r) => setTimeout(r, 0))
    host.dispose()
    expect(await run).toEqual({ status: 'unavailable', reason: 'the simulation engine was stopped while loading' })
    expect(f.made[0].terminated).toBe(true)
    expect(host.spawned).toBe(1)
  }, 2000)
  it('terminates a worker that times out, retries once on a new one, then fails', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, timeoutMs: 20 })
    const r = await host.runText('hang')
    expect(r.status).toBe('failed')
    if (r.status === 'failed') expect(r.error).toContain('did not answer')
    expect(f.made.map((w) => w.terminated)).toEqual([true, true])
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
  })
  it('recycles the worker after recycleRuns engine runs, between runs', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, recycleRuns: 3 })
    for (let i = 0; i < 4; i++) expect((await host.runText('ok')).status).toBe('ok')
    expect(host.spawned).toBe(2)
    expect(f.made[0].terminated).toBe(true)
  })
  it('is unavailable when the engine cannot load, and when spawning throws', async () => {
    expect(await new EngineHost({ spawn: fakes({ fatal: true }).spawn }).runText('ok')).toEqual({ status: 'unavailable', reason: 'no wasm' })
    const host = new EngineHost({
      spawn: () => {
        throw new Error('the simulation engine is not installed')
      },
    })
    expect(await host.runText('ok')).toEqual({ status: 'unavailable', reason: 'the simulation engine is not installed' })
  })
  it('is unavailable, not stuck, when the engine never finishes loading (so sim and gate always exit)', async () => {
    const f = fakes({ silent: true })
    const r = await new EngineHost({ spawn: f.spawn, loadTimeoutMs: 20 }).runText('ok')
    expect(r.status).toBe('unavailable')
    if (r.status === 'unavailable') expect(r.reason).toContain('did not load')
    expect(f.made[0].terminated).toBe(true)
  })
  it('reports a WASM trap as a failure and recycles the worker, and never hangs on a worker that exits mid-run', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, timeoutMs: 1000 })
    expect(await host.runText('trap')).toEqual({ status: 'failed', error: 'the simulation engine stopped: Aborted()' })
    expect(f.made[0].terminated).toBe(true)
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
    const t0 = Date.now()
    expect((await host.runText('crash')).status).toBe('failed')
    expect(Date.now() - t0).toBeLessThan(500)
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
  })
  it('sends a batch as one message, counts each run, and stops at the first failure', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn })
    expect(await host.runTexts(['ok', 'ok'])).toEqual([{ status: 'ok', vectors: { a: 1 }, ms: 1 }, { status: 'ok', vectors: { a: 1 }, ms: 1 }])
    expect(f.posted).toEqual([['ok', 'ok']])
    expect(host.runs).toBe(2)
    expect(await host.runTexts(['bad', 'ok'])).toEqual([{ status: 'failed', error: 'singular' }])
    expect(host.runs).toBe(3)
    expect(f.made[0].terminated).toBe(false)
  })
  it('times a batch out as one message: terminated, retried whole once, then failed', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, timeoutMs: 20 })
    expect(await host.runTexts(['ok', 'hang'])).toEqual([{ status: 'failed', error: 'the simulation engine did not answer within 0.02 s, twice' }])
    expect(f.posted).toEqual([['ok', 'hang'], ['ok', 'hang']])
    expect(f.made.map((w) => w.terminated)).toEqual([true, true])
    expect(host.runs).toBe(0)
  })
  it('recycles after a batch that reaches recycleRuns, and after a dead engine in a batch, never inside one', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, recycleRuns: 3 })
    expect((await host.runTexts(['ok', 'ok'])).map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(f.made[0].terminated).toBe(false)
    expect((await host.runTexts(['ok', 'ok'])).map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(f.made[0].terminated).toBe(true)
    expect((await host.runTexts(['ok', 'trap', 'ok'])).map((r) => r.status)).toEqual(['ok', 'failed'])
    expect(f.made[1].terminated).toBe(true)
    expect(host.spawned).toBe(2)
  })
  it('runs one request at a time, in order', async () => {
    const host = new EngineHost({ spawn: fakes().spawn })
    const all = await Promise.all([host.runText('ok'), host.runText('bad'), host.runText('ok')])
    expect(all.map((r) => r.status)).toEqual(['ok', 'failed', 'ok'])
  })
})
