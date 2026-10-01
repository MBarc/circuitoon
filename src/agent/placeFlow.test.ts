// Placement for wires (Ruling W1): parts with no connection at all are parked in a tidy "Not yet
// wired" area at the sheet's edge, a spare breadboard the wiring needs as a hub is placed among the
// parts it serves (and the only spare board the wiring may use), and parts follow the signal flow:
// power on the left, the microcontroller in the middle, peripherals right and below.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from './layout.ts'
import { verifyDiagram } from './verify.ts'
import { libraryLookup } from './catalog.ts'
import { type Diagram, moduleOf } from '../format/diagram.ts'
import { bodyRect, type Rect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { tightFootprint } from './footprint.ts'

const ok = (raw: unknown) => {
  const r = layoutNetlist(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}
const body = (d: Diagram, uid: string): Rect => {
  const p = d.parts.find((x) => x.uid === uid)!
  return bodyRect(p, layoutModule(moduleOf(d, p.module)!))
}
const tight = (d: Diagram, uid: string): Rect => {
  const p = d.parts.find((x) => x.uid === uid)!
  return tightFootprint(p, moduleOf(d, p.module)!)
}
const inside = (r: Rect, f: Rect) => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const cx = (r: Rect) => r.x + r.w / 2
const wired = (d: Diagram, uid: string) => d.connections.some((c) => c.from.part === uid || c.to.part === uid)

/** An ESP32 driving two SPI displays (SCK and MOSI each reach three header pins), plus parts not yet wired. */
const spi = () => ({
  format: 'circuitoon-netlist/1',
  title: 'Two displays',
  parts: [
    { ref: 'U2', module: 'esp32-devkit-v1-30' },
    { ref: 'DA', module: 'lcd-st7796s-4in-spi-touch' },
    { ref: 'DB', module: 'lcd-st7796s-4in-spi-touch' },
    { ref: 'HUB', module: 'breadboard-mini' },
    { ref: 'SPARE', module: 'breadboard-mini' },
    { ref: 'X1', module: 'mcp23017-cjmcu-2317' },
    { ref: 'X2', module: 'mcp23017-cjmcu-2317' },
  ],
  nets: [
    { name: 'SCK', pins: ['U2.D18', 'DA.SCK', 'DB.SCK'] },
    { name: 'MOSI', pins: ['U2.D23', 'DA.SDI(MOSI)', 'DB.SDI(MOSI)'] },
    { name: 'CS_A', pins: ['U2.D5', 'DA.CS'] },
    { name: 'CS_B', pins: ['U2.D26', 'DB.CS'] },
  ],
})

describe('parts not yet wired', () => {
  it('are parked in one frame labelled "Not yet wired", clear of the wired parts', () => {
    const d = ok(spi())
    const frames = (d.annotations ?? []).filter((a) => a.type === 'frame' && a.label === 'Not yet wired')
    expect(frames).toHaveLength(1)
    const f = annotationRect(frames[0])
    for (const uid of ['SPARE', 'X1', 'X2']) {
      expect(inside(tight(d, uid), f), uid).toBe(true)
      expect(wired(d, uid), uid).toBe(false)
    }
    for (const uid of ['U2', 'DA', 'DB', 'HUB']) expect(meets(tight(d, uid), f), uid).toBe(false)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('sit at the edge of the sheet: below everything that is wired', () => {
    const d = ok(spi())
    const f = annotationRect((d.annotations ?? []).find((a) => a.label === 'Not yet wired')!)
    const bottom = Math.max(...['U2', 'DA', 'DB', 'HUB'].map((u) => tight(d, u).y + tight(d, u).h))
    expect(f.y).toBeGreaterThanOrEqual(bottom)
  })
  it('get no frame when every part is wired', () => {
    const raw = spi()
    raw.parts = raw.parts.filter((p) => !['SPARE', 'X1', 'X2'].includes(p.ref))
    expect((ok(raw).annotations ?? []).some((a) => a.label === 'Not yet wired')).toBe(false)
  })
})

describe('a spare breadboard used as a hub', () => {
  it('carries the nets that need a distribution point; the other spare board stays parked and unwired', () => {
    const d = ok(spi())
    expect(wired(d, 'HUB')).toBe(true)
    expect(wired(d, 'SPARE')).toBe(false)
  })
  it('sits beside the microcontroller, not out in the parking area', () => {
    const d = ok(spi())
    const u2 = body(d, 'U2')
    const hub = body(d, 'HUB')
    const gap = Math.max(hub.x - (u2.x + u2.w), u2.x - (hub.x + hub.w), hub.y - (u2.y + u2.h), u2.y - (hub.y + hub.h))
    expect(gap).toBeLessThan(200)
  })
})

describe('signal flow', () => {
  const flow = () => ({
    format: 'circuitoon-netlist/1',
    title: 'Flow',
    parts: [
      { ref: 'U1', module: 'ip5306-usbc-module' },
      { ref: 'BT1', module: 'battery-18650-holder' },
      { ref: 'U2', module: 'esp32-devkit-v1-30' },
      { ref: 'DS1', module: 'oled-ssd1306-096-i2c' },
    ],
    nets: [
      { name: 'BAT', pins: ['BT1.+', 'U1.B+'] },
      { name: 'GND', pins: ['BT1.-', 'U1.B-', 'U2.GND', 'DS1.GND'] },
      { name: '5V', pins: ['U1.5V+', 'U2.VIN'] },
      { name: '3V3', pins: ['U2.3V3', 'DS1.VCC'] },
      { name: 'SDA', pins: ['U2.D21', 'DS1.SDA'] },
      { name: 'SCL', pins: ['U2.D22', 'DS1.SCL'] },
    ],
  })
  it('puts power on the left of the microcontroller and peripherals to its right', () => {
    const d = ok(flow())
    const u2 = body(d, 'U2')
    for (const uid of ['U1', 'BT1']) expect(body(d, uid).x + body(d, uid).w, uid).toBeLessThanOrEqual(u2.x)
    expect(cx(body(d, 'DS1'))).toBeGreaterThan(cx(u2))
  })
})

describe('what the wires never do on these sheets', () => {
  it('cover a caption, or cross a breadboard in use', async () => {
    const { readabilityFindings } = await import('./readabilityWarnings.ts')
    const { ledNetlist } = await import('./fixtures.testing.ts')
    for (const raw of [spi(), ledNetlist()]) {
      const d = ok(raw)
      const rules = readabilityFindings(d).map((f) => f.rule)
      expect(rules).not.toContain('label-covered')
      expect(rules).not.toContain('wire-over-board')
    }
  })
})
