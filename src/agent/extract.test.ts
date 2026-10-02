// Extracting a netlist (circuitoon-netlist/1) from a drawn sheet: parts, modules, values and mounts
// as drawn, and nets from what actually conducts (wires, breadboard strips, mounted legs, a part's
// internal joins, net labels). Laid out again, the netlist gives a sheet that is electrically the
// same circuit. Michael's own hand-drawn sheet is checked too when its private copy is present.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractNetlist } from './extract.ts'
import { layoutNetlist } from './layout.ts'
import { type Intent, parseNetlist, terminalKey } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { verifyDiagram } from './verify.ts'
import { readabilityFindings } from './readabilityWarnings.ts'
import { internalComponent } from './internal.ts'
import { type Diagram, validateDiagram } from '../format/diagram.ts'
import { ledNetlist, tiltSensors } from './fixtures.testing.ts'
import { labelPin as labelPinOf } from '../format/netLabels.ts'

const EXAMPLES = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples')
const FIXTURES = join(import.meta.dirname, '..', '..', '.superpowers', 'fixtures')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

const parse = (raw: unknown): Intent => {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.intent
}
const sheetOf = (raw: unknown, labels?: 'auto' | 'none' | 'all'): Diagram => {
  const r = layoutNetlist(raw, labels ? { labels } : {})
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}
/**
 * The nets as sets of component pins (strips left out), whatever their names: what conducts. Pins a
 * part joins inside itself count as one (a layout wires whichever of them is nearest), unless `exact`.
 */
const electrical = (i: Intent, exact = false) =>
  i.nets
    .map((n) => {
      const mod = (ref: string) => i.modules[i.parts.find((p) => p.ref === ref)!.module]
      const keys = n.terminals.filter((t) => !t.infra).map((t) => terminalKey(t.ref, exact ? t.name : internalComponent(mod(t.ref), t.name)))
      return [...new Set(keys)].sort()
    })
    .filter((n) => n.length > 1)
    .map((n) => JSON.stringify(n))
    .sort()
const partsOf = (i: Intent) => i.parts.map((p) => ({ ref: p.ref, module: p.module, on: p.on, values: p.values })).sort((a, b) => (a.ref < b.ref ? -1 : 1))
const netNamed = (i: Intent, name: string) => i.nets.find((n) => n.name === name)

describe('extractNetlist', () => {
  it('gives back the parts, mounts, values and nets a sheet was laid out from', () => {
    const want = parse(ledNetlist())
    const got = parse(extractNetlist(sheetOf(ledNetlist())))
    expect(partsOf(got)).toEqual(partsOf(want))
    expect(electrical(got)).toEqual(electrical(want))
  })
  it('round-trips every worked example electrically, through a second layout', () => {
    for (const f of ['battery-switch', 'esp32-bme280', 'led-breadboard', 'tilt-sensors-8']) {
      const raw = read(join(EXAMPLES, `${f}.netlist.json`))
      const want = parse(raw)
      const extracted = extractNetlist(sheetOf(raw))
      const got = parse(extracted)
      expect(electrical(got), f).toEqual(electrical(want))
      // Laid out again from the extracted netlist: the same circuit, verified clean.
      const again = sheetOf(extracted)
      expect(verifyDiagram(again, libraryLookup), f).toEqual([])
      expect(electrical(parse(extractNetlist(again))), f).toEqual(electrical(want))
    }
  })
  it('names nets from net labels, then ground and supply roles, then <ref>_<pin>', () => {
    const raw = {
      format: 'circuitoon-netlist/1', title: 'BME280',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
      nets: [
        { name: 'POWER', pins: ['U1.3V3', 'U2.VIN'] },
        { name: 'ZERO', pins: ['U1.GND', 'U2.GND'] },
        { name: 'DATA', pins: ['U1.IO21', 'U2.SDA'], label: true },
        { name: 'CLOCK', pins: ['U1.IO22', 'U2.SCL'] },
      ],
    }
    const got = parse(extractNetlist(sheetOf(raw)))
    expect(got.nets.map((n) => n.name).sort()).toEqual(['3V3', 'DATA', 'GND', 'U1_IO22'])
    expect(netNamed(got, 'DATA')!.terminals.map((t) => terminalKey(t.ref, t.name)).sort()).toEqual([terminalKey('U1', 'IO21'), terminalKey('U2', 'SDA')])
  })
  it('lists only the pins of a part\'s internal join that are wired, never its spare ones', () => {
    const raw = read(join(EXAMPLES, 'battery-switch.netlist.json'))
    const got = extractNetlist(sheetOf(raw)) as { nets: { pins: string[] }[] }
    const want = parse(raw)
    const listed = new Set(want.nets.flatMap((n) => n.terminals.map((t) => `${t.ref}.${t.name}`)))
    for (const n of got.nets) for (const p of n.pins) expect(listed, p).toContain(p)
  })
  it('leaves out the strips the layout added for routing, but keeps every board the intent names', () => {
    const sheet = sheetOf(tiltSensors(), 'none')
    expect(sheet.parts.some((p) => /^DP\d+$/.test(p.uid))).toBe(true)
    const got = parse(extractNetlist(sheet))
    expect(got.parts.map((p) => p.ref)).not.toContain('DP1')
    expect(got.parts.map((p) => p.ref)).toContain('BB1')
    expect(electrical(got)).toEqual(electrical(parse(tiltSensors())))
  })
  it('turns designators into valid, unique refs, and keeps a part with no connections', () => {
    const base = sheetOf(ledNetlist())
    const d: Diagram = {
      ...base,
      intent: undefined,
      parts: [
        ...base.parts.map((p) => (p.uid === 'BB1' ? { ...p, designator: 'Main board' } : p)),
        { uid: 'extra', designator: '2nd board', module: 'breadboard-mini', x: 2000, y: 0 },
        { uid: 'extra2', designator: 'Main board', module: 'breadboard-mini', x: 3000, y: 0 },
      ],
      modules: { ...base.modules, 'breadboard-mini': libraryLookup('breadboard-mini')! },
    }
    const got = parse(extractNetlist(d))
    const refs = got.parts.map((p) => p.ref)
    expect(refs).toContain('Main_board')
    expect(refs).toContain('P2nd_board')
    expect(refs).toContain('Main_board_2')
    expect(got.parts.find((p) => p.ref === 'R1')!.on).toBe('Main_board')
  })
  it('keeps a labelled net that has a single component pin, wired into a breadboard strip, with its name', () => {
    const base = sheetOf(ledNetlist())
    const label = libraryLookup('net-label')!
    const d: Diagram = {
      ...base,
      intent: undefined,
      modules: { ...base.modules, 'net-label': label, 'esp32-devkitc-v4': libraryLookup('esp32-devkitc-v4')! },
      parts: [
        ...base.parts,
        { uid: 'U2', designator: 'U2', module: 'esp32-devkitc-v4', x: 900, y: 0 },
        { uid: 'L1', designator: 'L1', module: 'net-label', x: 1100, y: 0, values: { net: 'VIN' } },
      ],
      connections: [
        ...base.connections,
        { uid: 'v1', from: { part: 'U2', pin: '5V' }, to: { part: 'BB1', pin: 'c25-top', hole: 0 } },
        { uid: 'v2', from: { part: 'L1', pin: labelPinOf(label) }, to: { part: 'BB1', pin: 'c25-top', hole: 2 } },
      ],
    }
    const got = extractNetlist(d) as { nets: { name: string; pins: string[] }[] }
    expect(got.nets.find((n) => n.name === 'VIN')?.pins).toEqual(['BB1.c25-top', 'U2.5V'])
    expect(parse(got).nets.some((n) => n.name === 'VIN')).toBe(true)
  })
  it('keeps one wire color per net and the wire ends every wire shares', () => {
    const got = extractNetlist(sheetOf(ledNetlist())) as { wires?: { color?: Record<string, string>; ends?: string } }
    expect(got.wires?.ends).toBe('dupont-male')
    expect(got.wires?.color?.GND).toBe('black')
  })
})

const hand = join(FIXTURES, 'spirit-hand.circuitoon.json')
describe.skipIf(!existsSync(hand))("Michael's hand-drawn Spirit Typewriter sheet (private fixture)", () => {
  it('extracts to the netlist written from it, electrically, and lays out again to the same circuit', () => {
    const v = validateDiagram(read(hand))
    if (!v.ok) throw new Error(v.errors.join('\n'))
    const extracted = extractNetlist(v.diagram)
    const got = parse(extracted)
    const want = parse(read(join(FIXTURES, 'spirit.netlist.json')))
    expect(partsOf(got)).toEqual(partsOf(want))
    expect(electrical(got, true)).toEqual(electrical(want, true))
    const again = sheetOf(extracted)
    expect(verifyDiagram(again, libraryLookup)).toEqual([])
    expect(electrical(parse(extractNetlist(again)))).toEqual(electrical(want))
    // Ruling W1 on his sheet: no wire over a breadboard in use or a caption, and the parts with no
    // connection parked in the "Not yet wired" frame.
    const rules = readabilityFindings(again).map((f) => f.rule)
    expect(rules).not.toContain('wire-over-board')
    expect(rules).not.toContain('label-covered')
    const frame = (again.annotations ?? []).find((a) => a.label === 'Not yet wired')
    expect(frame).toBeDefined()
    const unwired = again.parts.filter((p) => !again.connections.some((c) => c.from.part === p.uid || c.to.part === p.uid) && !p.mount && !again.parts.some((q) => q.mount?.board === p.uid))
    expect(unwired.map((p) => p.uid).sort()).toEqual(['MCP_Breadboard_1', 'MCP_Breadboard_2', 'MCP_Breadboard_3', 'U3', 'U4', 'U5'])
  })
})
