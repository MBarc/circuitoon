// The layout draws nets with net labels: every net that asks (`"label": true`, in every mode, the
// default `none` included), and in auto mode long or crowded ones; never mains. Each labelled endpoint gets a short `routing` stub out to its
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
    // Wires are the default (Ruling W1): --labels none, which still labels a net that asks.
    expect(v.report.labels).toEqual({ mode: 'none', nets: ['SDA'], unplaced: [] })
    clean(v.diagram)
  })
  it('draws only wires by default (--labels none) when no net asks for labels', () => {
    for (const v of [ok(i2c()), ok(i2c(), 'none')]) {
      expect(names(v.diagram)).toEqual([])
      expect(v.report.labels).toEqual({ mode: 'none', nets: [], unplaced: [] })
      clean(v.diagram)
    }
  })
  it('with --labels none never labels a long or many-ended net on its own', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Grounds',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }, { ref: 'BB1', module: 'power-rail-strip' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND', 'BB1.-'] }],
    }
    expect(names(ok(raw).diagram)).toEqual([])
    expect(names(ok(raw, 'auto').diagram)).toContain('GND')
  })
  it('labels every net with --labels all', () => {
    const v = ok(i2c(), 'all')
    expect([...new Set(names(v.diagram))]).toEqual(['3V3', 'GND', 'SCL', 'SDA'])
    clean(v.diagram)
  })
  it('in auto mode leaves a short two-pin signal net wired', () => {
    const v = ok(i2c(), 'auto')
    expect(names(v.diagram)).not.toContain('SCL')
    clean(v.diagram)
  })
  it('in auto mode labels a ground net with three or more endpoints', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Grounds',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND'] }],
    }
    const v = ok(raw, 'auto')
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
    const v = ok(tiltSensors(), 'auto')
    expect(v.diagram.parts.filter((p) => /^DP\d+$/.test(p.uid))).toEqual([])
    const gnd = labelsOf(v.diagram).filter((l) => l.name === 'GND')
    expect(gnd.length).toBeGreaterThanOrEqual(8)
    clean(v.diagram)
  })
  it('falls back to the local rail strips with --labels none, the default', async () => {
    const { tiltSensors } = await import('./fixtures.testing.ts')
    const v = ok(tiltSensors())
    expect(v.diagram.parts.some((p) => /^DP\d+$/.test(p.uid))).toBe(true)
    expect(labelsOf(v.diagram)).toEqual([])
  })
})

describe('a dense group of labelled pins fans out as one ordered row', () => {
  const tipOf = (d: Diagram, uid: string) => {
    const c = d.connections.find((x) => x.to.part === uid)!
    return c
  }
  it('labels on a header sit in a row beside it, all the same distance out, in pin order', () => {
    const v = ok(i2c(), 'all')
    const d = v.diagram
    // U2 (BME280) has its four pins in a row on one side: VIN, GND, SCL, SDA (along the bottom as
    // drawn; the layout may turn it to face the ESP32).
    const mine = labelsOf(d).filter((l) => tipOf(d, l.part.uid).from.part === 'U2')
    expect(mine).toHaveLength(4)
    const across = new Set(mine.map((l) => l.part.y)).size === 1
    expect(across || new Set(mine.map((l) => l.part.x)).size === 1).toBe(true)
    const order = [...mine].sort((a, b) => (across ? a.part.x - b.part.x : a.part.y - b.part.y)).map((l) => tipOf(d, l.part.uid).from.pin)
    expect([order, [...order].reverse()]).toContainEqual(['VIN', 'GND', 'SCL', 'SDA'])
  })
  it('labels for pads inside a body (a 2 x 10 header) leave by the edge they sit near, in pad order', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Pads',
      parts: [{ ref: 'U1', module: 'mcp23017-cjmcu-2317' }, ...Array.from({ length: 6 }, (_, i) => ({ ref: `R${i + 1}`, module: 'resistor' }))],
      nets: ['GPA0', 'GPB0', 'GPA1', 'GPB1', 'GPA2', 'GPB2'].map((pad, i) => ({ name: `CH${i + 1}`, pins: [`U1.${pad}`, `R${i + 1}.1`], label: true })),
    }
    const d = ok(raw).diagram
    const at = labelsOf(d).filter((l) => tipOf(d, l.part.uid).from.part === 'U1')
    expect(at).toHaveLength(6)
    const u1 = d.parts.find((p) => p.uid === 'U1')!
    expect(at.every((l) => l.part.x < u1.x)).toBe(true)
    expect(new Set(at.map((l) => l.part.x)).size).toBe(1)
    expect([...at].sort((a, b) => a.part.y - b.part.y).map((l) => l.name)).toEqual(['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6'])
    clean(d)
  })
})

describe('kept positions and captions', () => {
  it('a caption overlap that kept positions cause is a readability warning, never a failed layout', async () => {
    const { readabilityFindings } = await import('./readabilityWarnings.ts')
    const raw = {
      format: 'circuitoon-netlist/1', title: 'Kept',
      parts: [{ ref: 'R1', module: 'resistor', values: { resistance: { value: 4700, unit: 'ohm' } } }, { ref: 'R2', module: 'resistor', values: { resistance: { value: 4700, unit: 'ohm' } } }],
      nets: [],
    }
    const keep = new Map([['R1', { x: 0, y: 0, rotation: 0 as const }], ['R2', { x: 0, y: 50, rotation: 0 as const }]])
    const r = layoutNetlist(raw, { keep })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.value.report.captionOverlaps).toBeGreaterThan(0)
    const f = readabilityFindings(r.value.diagram).filter((x) => x.rule === 'label-covered')
    expect(f.some((x) => /R2's body covers R1's caption/.test(x.message))).toBe(true)
  })
})
