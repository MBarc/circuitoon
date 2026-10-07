// Firmware spec 8: two Raspberry Pi samples in the start screen. Each loads cleanly, its code runs on
// the virtual clock, and it does what its title says.
import { afterAll, describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { drive } from '../run/driver.ts'
import { nodePy } from '../run/testing.ts'
import { PY_FILES } from '../run/pyFiles.ts'
import { PI_SAMPLES, piBlinkSample, piButtonSample } from './piSamples.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

describe('Raspberry Pi samples (spec 8)', () => {
  it('load with no warnings', () => {
    for (const s of PI_SAMPLES) {
      const r = validateDiagram(JSON.parse(JSON.stringify(s.diagram)), { library: libraryLookup })
      expect(r.ok && r.warnings, s.diagram.title).toEqual([])
    }
    expect(PI_SAMPLES.map((s) => s.diagram.title)).toEqual(['Blink on a Raspberry Pi', 'Button lights an LED on a Pi'])
  })
  it('blink blinks GPIO17', async () => {
    const r = await drive({ diagram: piBlinkSample, boards: ['p2'], forMs: 2500, inputs: [], presses: [], engine, py: nodePy(), library: libraryLookup, files: PY_FILES })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => e.state)).toEqual(['high', 'low', 'high'])
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([])
  }, 120_000)
  it('the button lights the LED through when_pressed', async () => {
    const r = await drive({ diagram: piButtonSample, boards: ['p2'], forMs: 3000, inputs: [], presses: [{ uid: 'p5', atMs: 1000, forMs: 500 }], engine, py: nodePy(), library: libraryLookup, files: PY_FILES })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => [Math.round(e.t / 100) / 10, e.state])).toEqual([[0, 'low'], [1, 'high'], [1.5, 'low']])
  }, 120_000)
})
