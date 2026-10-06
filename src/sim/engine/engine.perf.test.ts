// Spec 8: the worker heap after 2,000 runs (one recycle period) is at most 64 MB above baseline.
import { describe, expect, it } from 'vitest'
import { createNodeEngineHost } from './nodeEngine.ts'

const LED = (r: number) => `* led\n.model LEDRED D(IS=93.2p N=3.73 RS=7.5)\nV1 vcc 0 DC 5\nR1 vcc a ${150 + r}\nD1 a 0 LEDRED\n.end`

describe('engine memory', () => {
  it('keeps the WASM heap within 64 MB of its baseline over 1,999 runs on one worker', async () => {
    const host = createNodeEngineHost()
    try {
      await host.runText(LED(0))
      const baseline = host.lastHeap
      for (let i = 1; i < 1999; i++) expect((await host.runText(LED(i % 50))).status).toBe('ok')
      expect(host.spawned).toBe(1)
      expect(host.lastHeap - baseline).toBeLessThanOrEqual(64 * 1024 * 1024)
    } finally {
      host.dispose()
    }
  }, 120_000)
})
