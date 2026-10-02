// Ruling W1 follow-up: two wires never lie on top of each other along a shared run (a collinear
// overlap longer than about 2 px), anywhere on the sheet; crossing at right angles is fine. The
// readability check reports any that remain as `wires-overlap` (always NOT READY), and the layout
// draws a hub breadboard so that every wire of a net ends at its own outer hole, with no wire over
// another's end.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Diagram, computeRoutes, validateDiagram, wirePaths } from '../format/diagram.ts'
import { type Pt } from '../format/geometry.ts'
import type { ModuleDef } from '../format/module.ts'
import { readabilityFindings } from './readabilityWarnings.ts'
import { layoutNetlist } from './layout.ts'
import { libraryLookup } from './catalog.ts'
import { verifyDiagram } from './verify.ts'

const load = (path: string): Diagram => {
  const v = validateDiagram(JSON.parse(readFileSync(path, 'utf8')))
  if (!v.ok) throw new Error(v.errors.join('\n'))
  return v.diagram
}
/** Every pair of wires drawn on top of each other along a run longer than 2 px. */
function overlapping(d: Diagram): string[] {
  const segs: { w: string; h: boolean; at: number; lo: number; hi: number }[] = []
  for (const w of wirePaths(d, computeRoutes(d))) {
    const p = w.points
    for (let i = 1; i < p.length; i++) {
      const [a, b]: Pt[] = [p[i - 1], p[i]]
      if (a.y === b.y && a.x !== b.x) segs.push({ w: w.conn.uid, h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
      else if (a.x === b.x && a.y !== b.y) segs.push({ w: w.conn.uid, h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
    }
  }
  const out = new Set<string>()
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i], segs[j]]
      if (s.w === t.w || s.h !== t.h || Math.abs(s.at - t.at) > 0.5) continue
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 2) out.add([s.w, t.w].sort().join(','))
    }
  return [...out]
}

const spi = () => ({
  format: 'circuitoon-netlist/1',
  title: 'Two displays',
  parts: [
    { ref: 'U2', module: 'esp32-devkit-v1-30' },
    { ref: 'DA', module: 'lcd-st7796s-4in-spi-touch' },
    { ref: 'DB', module: 'lcd-st7796s-4in-spi-touch' },
    { ref: 'HUB', module: 'breadboard-mini' },
  ],
  nets: [
    { name: 'SCK', pins: ['U2.D18', 'DA.SCK', 'DB.SCK'] },
    { name: 'MOSI', pins: ['U2.D23', 'DA.SDI(MOSI)', 'DB.SDI(MOSI)'] },
    { name: 'DC', pins: ['U2.D4', 'DA.DC/RS', 'DB.DC/RS'] },
    { name: 'BL', pins: ['U2.D14', 'DA.LED', 'DB.LED'] },
    { name: 'CS_A', pins: ['U2.D5', 'DA.CS'] },
    { name: 'CS_B', pins: ['U2.D26', 'DB.CS'] },
  ],
})

describe('wires-overlap', () => {
  it('fires on the hub layout of plugin 0.5.0, where display wires ran along a row over each other', () => {
    const d = load(join(import.meta.dirname, '..', 'format', 'fixtures', 'hub-overlap.circuitoon.json'))
    const found = readabilityFindings(d).filter((f) => f.rule === 'wires-overlap')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].wires).toHaveLength(2)
    expect(found[0].message).toMatch(/on top of each other/)
  })
  it('exempts only the stretch near a terminal two wires share, not the whole pair', () => {
    const term: ModuleDef = { format: 'circuitoon-module/1', id: 'term', name: 'Term', pins: [{ name: 'T', side: 'right', capacity: 2 }] }
    const one: ModuleDef = { format: 'circuitoon-module/1', id: 'one', name: 'One', pins: [{ name: 'L', side: 'left' }] }
    const sheet = (shared: number): Diagram => ({
      format: 'circuitoon-diagram/1', title: 't', modules: { term, one },
      parts: [
        { uid: 'T1', designator: 'T1', module: 'term', x: 0, y: 0 },
        { uid: 'A', designator: 'A', module: 'one', x: 400, y: -100 },
        { uid: 'B', designator: 'B', module: 'one', x: 400, y: 100 },
      ],
      // Both leave T1's pin along y = 10 for `shared` px, then part.
      connections: [
        { uid: 'w1', from: { part: 'T1', pin: 'T' }, to: { part: 'A', pin: 'L' }, route: [[20 + shared, 10], [20 + shared, -90]] },
        { uid: 'w2', from: { part: 'T1', pin: 'T' }, to: { part: 'B', pin: 'L' }, route: [[20 + shared, 10], [20 + shared, 110]] },
      ],
    })
    const rules = (dd: Diagram) => readabilityFindings(dd).filter((f) => f.rule === 'wires-overlap')
    expect(rules(sheet(20))).toEqual([])
    const far = rules(sheet(150))
    expect(far).toHaveLength(1)
    expect(far[0].wires).toEqual(['w1', 'w2'])
  })
  it('never fires for wires that only cross', () => {
    const r = layoutNetlist({
      format: 'circuitoon-netlist/1', title: 'Cross',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
      nets: [{ name: 'SDA', pins: ['U1.IO21', 'U2.SCL'] }, { name: 'SCL', pins: ['U1.IO22', 'U2.SDA'] }],
    })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(readabilityFindings(r.value.diagram).filter((f) => f.rule === 'wires-overlap')).toEqual([])
  })
})

describe('a hub breadboard', () => {
  const laid = () => {
    const r = layoutNetlist(spi())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    return r.value.diagram
  }
  it('draws no two wires on top of each other', () => {
    const d = laid()
    expect(overlapping(d)).toEqual([])
    expect(readabilityFindings(d).map((f) => f.rule)).not.toContain('wires-overlap')
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('gives every wire from off the board its own outer hole of a half-strip, each half-strip taking one', () => {
    const d = laid()
    const offBoard = d.connections.filter((c) => (c.from.part === 'HUB') !== (c.to.part === 'HUB'))
    const ends = offBoard.map((c) => (c.from.part === 'HUB' ? c.from : c.to))
    const strips = ends.map((e) => e.pin)
    expect(new Set(strips).size).toBe(strips.length)
    // The outer hole of a half-strip is its first (a or j side of the board's edge): never one behind another wire's end.
    const hub = d.parts.find((p) => p.uid === 'HUB')!
    const groups = d.modules[hub.module].holes!
    for (const e of ends) {
      const g = groups.find((x) => x.name === e.pin)!
      const outer = e.pin.endsWith('-top') ? 0 : g.at.length - 1
      expect([0, g.at.length - 1], `${e.pin} hole ${e.hole}`).toContain(e.hole)
      expect(e.hole, e.pin).toBe(outer)
    }
  })
  it('never puts two wire ends in one hole, and keeps the inner holes of each half-row for the jumpers, with supply nets fed by a trunk too', () => {
    const raw = spi()
    raw.parts.push({ ref: 'PWR', module: 'breadboard-half' }, { ref: 'BT1', module: 'battery-18650-holder' })
    raw.nets.push(
      { name: 'GND', pins: ['U2.GND', 'DA.GND', 'DB.GND', 'BT1.-', 'PWR.top-'] },
      { name: 'VBAT', pins: ['BT1.+', 'U2.VIN', 'DA.VCC', 'DB.VCC', 'PWR.top+'] },
    )
    const r = layoutNetlist(raw)
    if (!r.ok) throw new Error(r.errors.join('; '))
    const d = r.value.diagram
    const ends = d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.part === 'HUB').map((e) => `${e.pin} ${e.hole}`)
    expect(new Set(ends).size).toBe(ends.length)
    // A wire from off the hub ends in one of the two outer holes of its half-row (away from the
    // channel: holes 0 and 1 of a -top half, 3 and 4 of a -bot half), never one the jumpers keep.
    for (const c of d.connections) {
      if ((c.from.part === 'HUB') === (c.to.part === 'HUB')) continue
      const e = c.from.part === 'HUB' ? c.from : c.to
      expect(e.pin.endsWith('-top') ? [0, 1] : [3, 4], `${c.uid} ${e.pin} ${e.hole}`).toContain(e.hole)
    }
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    expect(overlapping(d)).toEqual([])
  })
})
