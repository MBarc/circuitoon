// The engine in a real worker_threads Worker (spec 2.3): success, failure, success on the same
// worker (a circuit failure keeps it); a busy-looping worker is terminated on its timeout and the
// next run succeeds; a run that throws is a failure; a process that forgets dispose() still exits.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createNodeEngineHost, engineDir } from './nodeEngine.ts'
import { DEBUG_HANG_TEXT } from './host.ts'

const LED = '* led\n.model LEDRED D(IS=93.2p N=3.73 RS=7.5)\nV1 vcc 0 DC 5\nR1 vcc a 150\nD1 a 0 LEDRED\n.end'

describe('the Node engine worker', () => {
  it('finds the engine in public/sim from the source tree', () => {
    expect(engineDir()?.replaceAll('\\', '/')).toMatch(/public\/sim$/)
  })
  it('solves, fails, then solves again on one worker (a circuit failure keeps it)', async () => {
    const host = createNodeEngineHost()
    try {
      const a = await host.runText(LED)
      expect(a.status === 'ok' && Math.abs(a.vectors.a - 2.000761) < 1e-5).toBe(true)
      expect((await host.runText('* bad\nR1 a\n.end')).status).toBe('failed')
      expect((await host.runText(LED)).status).toBe('ok')
      expect(host.spawned).toBe(1)
      expect(host.info).toEqual({ name: 'ngspice', version: '45.2', build: '45.2-1' })
    } finally {
      host.dispose()
    }
  }, 60_000)
  it('terminates a worker that busy-loops (debug hang), fails after its one retry, and the next run succeeds', async () => {
    const host = createNodeEngineHost({ timeoutMs: 1500 })
    try {
      const r = await host.runText(DEBUG_HANG_TEXT)
      expect(r.status).toBe('failed')
      if (r.status === 'failed') expect(r.error).toContain('did not answer')
      expect(host.spawned).toBe(2)
      expect((await host.runText(LED)).status).toBe('ok')
      expect(host.spawned).toBe(3)
    } finally {
      host.dispose()
    }
  }, 60_000)
  it('lets a process that never calls dispose() exit after its run (the worker is unref()ed)', () => {
    const url = pathToFileURL(join(import.meta.dirname, 'nodeEngine.ts')).href
    const code = `const { createNodeEngineHost } = await import(${JSON.stringify(url)}); const r = await createNodeEngineHost().runText(${JSON.stringify(LED)}); console.log(r.status)`
    // -e, not --input-type=module: the engine worker inherits execArgv, and --input-type stops it loading a file.
    const p = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 30_000 })
    expect(p.stdout.trim()).toBe('ok')
    expect(p.status).toBe(0)
  }, 60_000)
  it('reports an engine that throws inside a run as a failure, not a hang', async () => {
    const host = createNodeEngineHost()
    try {
      // An element card ngspice cannot even parse a model for: the core returns or throws; either way the host gets a failure.
      expect((await host.runText('* bad\nQ1 a b c nomodel\n.end')).status).toBe('failed')
      expect((await host.runText(LED)).status).toBe('ok')
    } finally {
      host.dispose()
    }
  }, 60_000)
})
