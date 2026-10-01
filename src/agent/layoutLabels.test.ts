// The layout draws nets with net labels: every net that asks (`"label": true`), and in auto mode
// long or crowded ones; never mains. Each labelled endpoint gets a short `routing` stub out to its
// label, which lands clear of every part, caption and other label; the sheet still verifies clean.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from './layout.ts'
import { verifyDiagram } from './verify.ts'
import { libraryLookup } from './catalog.ts'
import { overlaps } from './readability.ts'
import { labelsOf } from '../format/netLabels.ts'
import { checkDiagram } from '../format/checks.ts'
import type { Diagram } from '../format/diagram.ts'
import { ledNetlist } from './fixtures.testing.ts'

const i2c = (label?: boolean) => ({
  format: 'circuitoon-netlist/1',
  title: 'BME280',
  parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
  nets: [
    { name: '3V3', pins: ['U1.3V3', 'U2.VIN'] },
    { name: 'GND', pins: ['U1.GND', 'U2.GND'] },
    { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'], ...(label === undefined ? {} : { label }) },
    { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
  ],
})
const ok = (raw: unknown, labels?: 'auto' | 'none' | 'all') => {
  const r = layoutNetlist(raw, labels ? { labels } : {})
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value
}
const names = (d: Diagram) => labelsOf(d).map((l) => l.name).sort()
const clean = (d: Diagram) => {
  expect(verifyDiagram(d, libraryLookup)).toEqual([])
  expect(checkDiagram(d).filter((f) => f.severity === 'error')).toEqual([])
  expect(overlaps(d)).toEqual({ body: [], caption: [] })
}

describe('layout with net labels', () => {
  it('labels a net that asks, with a routing stub from each endpoint to its label', () => {
    const v = ok(i2c(true))
    expect(names(v.diagram)).toEqual(['SDA', 'SDA'])
    const ids = new Set(labelsOf(v.diagram).map((l) => l.part.uid))
    const stubs = v.diagram.connections.filter((c) => ids.has(c.to.part))
    expect(stubs).toHaveLength(2)
    expect(stubs.every((c) => c.routing)).toBe(true)
    expect(v.report.labels).toEqual({ mode: 'auto', nets: ['SDA'], unplaced: [] })
    clean(v.diagram)
  })
  it('draws no labels with --labels none, even on a net that asks', () => {
    const v = ok(i2c(true), 'none')
    expect(names(v.diagram)).toEqual([])
    expect(v.report.labels).toEqual({ mode: 'none', nets: [], unplaced: [] })
    clean(v.diagram)
  })
  it('labels every net with --labels all', () => {
    const v = ok(i2c(), 'all')
    expect([...new Set(names(v.diagram))]).toEqual(['3V3', 'GND', 'SCL', 'SDA'])
    clean(v.diagram)
  })
  it('in auto mode leaves a short two-pin signal net wired', () => {
    const v = ok(i2c())
    expect(names(v.diagram)).not.toContain('SCL')
    clean(v.diagram)
  })
  it('in auto mode labels a ground net with three or more endpoints', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Grounds',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND'] }],
    }
    const v = ok(raw)
    expect(names(v.diagram)).toEqual(['GND', 'GND', 'GND'])
    clean(v.diagram)
  })
  it('labels a breadboard net with a stub into a free hole of its strip', () => {
    const v = ok(ledNetlist(), 'all')
    const ids = new Set(labelsOf(v.diagram).map((l) => l.part.uid))
    const intoStrip = v.diagram.connections.filter((c) => ids.has(c.to.part) && c.from.part === 'BB1')
    expect(intoStrip.length).toBeGreaterThan(0)
    expect(intoStrip.every((c) => c.from.hole !== undefined)).toBe(true)
    clean(v.diagram)
  })
  it('never labels a mains net, even with --labels all', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Lamps',
      parts: [{ ref: 'E1', module: 'lamp-holder-e26' }, { ref: 'E2', module: 'lamp-holder-e26' }],
      nets: [{ name: 'LIVE', pins: ['E1.L', 'E2.L'] }, { name: 'NEUT', pins: ['E1.N', 'E2.N'] }],
    }
    const v = ok(raw, 'all')
    expect(names(v.diagram)).toEqual([])
  })
})

describe('a repeat block\'s shared ground', () => {
  it('is a label at each copy with labels on, and needs no local rail strips', async () => {
    const { tiltSensors } = await import('./fixtures.testing.ts')
    const v = ok(tiltSensors())
    expect(v.diagram.parts.filter((p) => /^DP\d+$/.test(p.uid))).toEqual([])
    const gnd = labelsOf(v.diagram).filter((l) => l.name === 'GND')
    expect(gnd.length).toBeGreaterThanOrEqual(8)
    clean(v.diagram)
  })
  it('falls back to the local rail strips with --labels none', async () => {
    const { tiltSensors } = await import('./fixtures.testing.ts')
    const v = ok(tiltSensors(), 'none')
    expect(v.diagram.parts.some((p) => /^DP\d+$/.test(p.uid))).toBe(true)
    expect(labelsOf(v.diagram)).toEqual([])
  })
})
