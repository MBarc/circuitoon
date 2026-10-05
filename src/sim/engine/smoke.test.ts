// Engine smoke tests (spec 9; npm run engine:build runs them): the built WASM solves the spike's LED
// circuit to the hand calculation, vectors come through ngGet_Vec_Info, ngSpice_SetBkpt is
// accepted, and a failed op is a failure that leaves the instance usable.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createCore, loadEngineFiles } from './ngspice.ts'

const DIR = join(import.meta.dirname, '..', '..', '..', 'public', 'sim')
const LED = `* led
.model LEDRED D(IS=93.2p N=3.73 RS=7.5)
V1 vcc 0 DC 5
R1 vcc a 150
D1 a 0 LEDRED
.end`

describe('ngspice engine (smoke)', () => {
  it('solves LED + 150 ohm + 5 V to the spike hand calculation, read through ngGet_Vec_Info', async () => {
    const { factory, wasm, manifest } = await loadEngineFiles(DIR)
    expect(manifest.ngspice).toBe('45.2')
    const core = await createCore(factory, wasm)
    const r = core.op(LED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.vectors.a - 2.000761)).toBeLessThan(1e-5)
    expect(r.vectors.vcc).toBeCloseTo(5, 9)
    // The source's branch current flows out of its + terminal, so ngspice reports it negative.
    expect(r.vectors['v1#branch']).toBeCloseTo(-(5 - r.vectors.a) / 150, 9)
  })
  it('reaches ngSpice_SetBkpt, for firmware co-simulation later', async () => {
    const { factory, wasm } = await loadEngineFiles(DIR)
    const core = await createCore(factory, wasm)
    // ngspice 45.2 only accepts a breakpoint while a circuit is loaded ("Error: no circuit
    // loaded.", false), and op() removes its circuit, so here the export answers false.
    expect(core.setBreakpoint(1e-3)).toBe(false)
  })
  it('reports a circuit with no operating point as a failure, then solves the next one', async () => {
    const { factory, wasm } = await loadEngineFiles(DIR)
    const core = await createCore(factory, wasm)
    expect(core.op(LED).ok).toBe(true)
    // Two sources forcing one node to different voltages: a singular matrix, no operating point.
    // (A malformed line such as 'R1 a' is only a warning in ngspice 45.2: it is dropped and the rest solves.)
    const bad = core.op('* bad\nV1 a 0 DC 5\nV2 a 0 DC 3\n.end')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0)
    const again = core.op(LED)
    expect(again.ok && Math.abs(again.vectors.a - 2.000761) < 1e-5).toBe(true)
    expect(core.runs).toBe(3)
  })
})
