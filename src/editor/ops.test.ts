import { describe, expect, it } from 'vitest'
import { addPart, addWire, nextUid, clearWireRoute, deleteSelection, sameEndpoint, setWireRoute, designatorPrefix, moveParts, nextDesignator, reconnectWire, rotateParts, settleDrop, settleMounts, settleSeats, updatePart, updatePartValue, updateWire, withMounted, settlingOf } from './ops.ts'
import { emptyDiagram, type Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { parseValue } from '../format/values.ts'
import { mountIssues, plugsOf, seatOf } from '../format/breadboard.ts'

const resistor: ModuleDef = {
  format: 'circuitoon-module/1', id: 'resistor', name: 'Resistor',
  pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
  electrical: { params: { resistance: { unit: 'ohm', default: 1000 } } },
}
const capacitor: ModuleDef = {
  format: 'circuitoon-module/1', id: 'capacitor-ceramic', name: 'Ceramic capacitor',
  pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
  electrical: { params: { capacitance: { unit: 'F', default: 1e-7 } } },
}
const style = { color: 'red', gauge: 22 }

function twoResistors() {
  const a = addPart(emptyDiagram(), resistor, 0, 0)
  const b = addPart(a.diagram, resistor, 100, 0)
  return b.diagram
}

function threeResistors() {
  const c = addPart(twoResistors(), resistor, 200, 0)
  return c.diagram
}

describe('ops', () => {
  it('adds parts with fresh uids and designators, embedding the module once', () => {
    const d = twoResistors()
    expect(d.parts.map((p) => [p.uid, p.designator])).toEqual([['p1', 'R1'], ['p2', 'R2']])
    expect(Object.keys(d.modules)).toEqual(['resistor'])
    expect(nextDesignator(d, resistor)).toBe('R3')
  })
  it('gives the potentiometer its own RV prefix, not the resistor prefix', () => {
    const potentiometer: ModuleDef = {
      format: 'circuitoon-module/1', id: 'potentiometer', name: 'Potentiometer',
      pins: [{ name: '1', side: 'bottom' }, { name: 'W', side: 'bottom' }, { name: '3', side: 'bottom' }],
      electrical: { params: { resistance: { unit: 'ohm', default: 10000 } } },
    }
    expect(designatorPrefix(potentiometer)).toBe('RV')
    expect(designatorPrefix(resistor)).toBe('R')
  })
  it('gives ESP32 and XIAO boards the U prefix', () => {
    for (const id of ['esp32-devkitc-v4', 'esp32-devkit-v1-30', 'esp32-s3-devkitc-1', 'esp32-c3-supermini', 'esp32-cam', 'xiao-esp32c3', 'xiao-esp32s3']) {
      const board: ModuleDef = { format: 'circuitoon-module/1', id, name: id, pins: [{ name: 'GND', side: 'left' }] }
      expect(designatorPrefix(board)).toBe('U')
    }
  })
  it('gives coin cell and other battery ids the BT prefix', () => {
    for (const id of ['battery-cr2032', 'battery-cr2025', 'battery-cr2016', 'battery-cr1220', 'battery-lr44', 'battery-aa', 'battery-aaa', 'battery-holder-2xaa']) {
      const battery: ModuleDef = { format: 'circuitoon-module/1', id, name: id, pins: [{ name: '-', side: 'left' }, { name: '+', side: 'right' }] }
      expect(designatorPrefix(battery)).toBe('BT')
    }
  })
  it('gives display ids (lcd, oled, tft) the DS prefix and keeps chips on U', () => {
    const mk = (id: string): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins: [{ name: 'GND', side: 'left' }] })
    for (const id of ['lcd-st7796s-4in-spi-touch', 'oled-ssd1306-096-i2c', 'oled-ssd1306-091-i2c', 'oled-sh1106-13-i2c', 'tft-st7735-18-spi', 'tft-ili9341-24-spi', 'tft-ili9341-28-spi-touch', 'tft-st7789-154-spi'])
      expect(designatorPrefix(mk(id))).toBe('DS')
    for (const id of ['mcp23017-dip28', 'mcp23018-dip28']) expect(designatorPrefix(mk(id))).toBe('U')
    // "led" stays an LED (D); the display rule needs the full word and a hyphen.
    expect(designatorPrefix(mk('led'))).toBe('D')
    expect(designatorPrefix(mk('tftp-server'))).toBe('U')
  })
  it('moves and rotates only the given parts', () => {
    const d = rotateParts(moveParts(twoResistors(), ['p2'], 20, -10), ['p2'])
    expect(d.parts[0]).toMatchObject({ x: 0, y: 0, rotation: 0 })
    expect(d.parts[1]).toMatchObject({ x: 120, y: -10, rotation: 90 })
    expect(rotateParts(rotateParts(rotateParts(d, ['p2']), ['p2']), ['p2']).parts[1].rotation).toBe(0)
  })
  it('adds a wire, refusing self-loops and duplicates in either direction', () => {
    const d = twoResistors()
    const w = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    expect(w.uid).toBe('w1')
    expect(w.diagram.connections[0]).toEqual({ uid: 'w1', from: { part: 'p1', pin: '2' }, to: { part: 'p2', pin: '1' }, color: 'red', gauge: 22 })
    expect(addWire(w.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: '2' }, style)).toBeNull()
    expect(addWire(d, { part: 'p1', pin: '1' }, { part: 'p1', pin: '1' }, style)).toBeNull()
  })
  it('deleting a part deletes its wires', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = deleteSelection(w.diagram, { parts: ['p2'], wires: [] })
    expect(d.parts.map((p) => p.uid)).toEqual(['p1'])
    expect(d.connections).toEqual([])
  })
  it('updates designators and wire properties', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = updateWire(updatePart(w.diagram, 'p1', { designator: 'RLIM' }), 'w1', { color: '#123456', gauge: 18, label: 'LED+' })
    expect(d.parts[0].designator).toBe('RLIM')
    expect(d.connections[0]).toMatchObject({ color: '#123456', gauge: 18, label: 'LED+' })
  })
  it('reconnects a wire end to another pin, keeping color, gauge and label, and makes a hand-shaped wire automatic', () => {
    const d0 = threeResistors()
    const w = addWire(d0, { part: 'p1', pin: '2', offset: 0.5 }, { part: 'p2', pin: '1' }, style)!
    const withRoute = updateWire(w.diagram, 'w1', { label: 'A' })
    const d = { ...withRoute, connections: withRoute.connections.map((c) => (c.uid === 'w1' ? { ...c, route: [[50, 20]] as [number, number][] } : c)) }
    const frozen = JSON.parse(JSON.stringify(d))
    const r = reconnectWire(d, 'w1', 'to', { part: 'p3', pin: '1' })!
    expect(r).not.toBeNull()
    expect(r.connections[0]).toEqual({
      uid: 'w1',
      from: { part: 'p1', pin: '2', offset: 0.5 },
      to: { part: 'p3', pin: '1' },
      color: 'red',
      gauge: 22,
      label: 'A',
    })
    // The bends were made for the old pin, so the wire goes back to the router.
    expect('route' in r.connections[0]).toBe(false)
    // input diagram is untouched
    expect(d).toEqual(frozen)
  })
  it('reconnects the "from" end too, dropping a stale offset unless the target carries one', () => {
    const d = threeResistors()
    const w = addWire(d, { part: 'p1', pin: '2', offset: 0.5 }, { part: 'p2', pin: '1' }, style)!
    const r = reconnectWire(w.diagram, 'w1', 'from', { part: 'p3', pin: '1', offset: 0.2 })!
    expect(r.connections[0].from).toEqual({ part: 'p3', pin: '1', offset: 0.2 })
    expect(r.connections[0].to).toEqual({ part: 'p2', pin: '1' })
  })
  it('refuses to reconnect a wire that does not exist', () => {
    const d = threeResistors()
    expect(reconnectWire(d, 'nope', 'to', { part: 'p3', pin: '1' })).toBeNull()
  })
  it('refuses a reconnect that would create a self-loop', () => {
    const d = threeResistors()
    const w = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    expect(reconnectWire(w.diagram, 'w1', 'to', { part: 'p1', pin: '2' })).toBeNull()
  })
  it('refuses a reconnect back onto the pin the end is already on', () => {
    const d = threeResistors()
    const w = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    expect(reconnectWire(w.diagram, 'w1', 'to', { part: 'p2', pin: '1' })).toBeNull()
  })
  it('refuses a reconnect that would duplicate another wire, in either direction', () => {
    const d = threeResistors()
    const w1 = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const w2 = addWire(w1.diagram, { part: 'p1', pin: '2' }, { part: 'p3', pin: '1' }, style)!
    // w1: p1.2 -> p2.1, w2: p1.2 -> p3.1. Moving w1's "to" end onto p3.1 duplicates w2.
    expect(reconnectWire(w2.diagram, 'w1', 'to', { part: 'p3', pin: '1' })).toBeNull()
    // and the reverse direction is caught too
    const w3 = addWire(w1.diagram, { part: 'p3', pin: '1' }, { part: 'p1', pin: '2' }, style)!
    expect(reconnectWire(w3.diagram, 'w1', 'to', { part: 'p3', pin: '1' })).toBeNull()
  })
  it('never reuses a uid that a broken wire still references', () => {
    const d = { ...emptyDiagram(), connections: [{ uid: 'w1', from: { part: 'p1', pin: '1' }, to: { part: 'p9', pin: '2' } }] }
    const r = addPart(d, resistor, 0, 0)
    expect(r.uid).toBe('p2')
    expect(r.diagram.parts.some((p) => p.uid === 'p1')).toBe(false)
    expect(r.diagram.connections[0].from.part).toBe('p1')
  })
  it('sets a part value, overriding the module default', () => {
    const d = addPart(emptyDiagram(), resistor, 0, 0).diagram
    const next = updatePartValue(d, 'p1', 'resistance', 4700, 'ohm')
    expect(next.parts[0].values).toEqual({ resistance: { value: 4700, unit: 'ohm' } })
    expect(d.parts[0].values).toBeUndefined() // input diagram untouched
  })
  it('is a no-op when the new value matches the resolved current one, even the module default', () => {
    const d = addPart(emptyDiagram(), resistor, 0, 0).diagram
    expect(updatePartValue(d, 'p1', 'resistance', 1000, 'ohm')).toBe(d)
    const withOverride = updatePartValue(d, 'p1', 'resistance', 4700, 'ohm')
    expect(updatePartValue(withOverride, 'p1', 'resistance', 4700, 'ohm')).toBe(withOverride)
  })
  it('ignores a missing part or module', () => {
    const d = emptyDiagram()
    expect(updatePartValue(d, 'nope', 'resistance', 4700, 'ohm')).toBe(d)
  })
  it('is a no-op for a capacitor default parsed back from its own formatted text', () => {
    // Regression: "100 nF" used to parse to 1.0000000000000001e-7, one float epsilon away from
    // the module's exact 1e-7 default, which broke the no-op comparison in updatePartValue.
    const d = addPart(emptyDiagram(), capacitor, 0, 0).diagram
    const parsed = parseValue('100 nF', 'F')!
    expect(parsed).toBe(1e-7)
    expect(updatePartValue(d, 'p1', 'capacitance', parsed, 'F')).toBe(d)
  })
})

describe('wire routes', () => {
  const wired = () => addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!.diagram
  it('sets a hand-shaped route without touching the input or other wires', () => {
    const d = wired()
    const before = structuredClone(d)
    const next = setWireRoute(d, 'w1', [[60, 20], [60, 60]])
    expect(next.connections[0].route).toEqual([[60, 20], [60, 60]])
    expect(next.connections[0]).toMatchObject({ color: 'red', gauge: 22 })
    expect(d).toEqual(before)
  })
  it('returns the same diagram when the route is unchanged or the wire is missing', () => {
    const d = setWireRoute(wired(), 'w1', [[60, 20], [60, 60]])
    expect(setWireRoute(d, 'w1', [[60, 20], [60, 60]])).toBe(d)
    expect(setWireRoute(d, 'nope', [[1, 2]])).toBe(d)
  })
  it('keeps an empty route as a manual wire with no bends', () => {
    expect(setWireRoute(wired(), 'w1', []).connections[0].route).toEqual([])
  })
  it('clears a route back to automatic, removing the key', () => {
    const d = setWireRoute(wired(), 'w1', [[60, 20]])
    const next = clearWireRoute(d, 'w1')
    expect('route' in next.connections[0]).toBe(false)
    expect(d.connections[0].route).toEqual([[60, 20]])
    expect(clearWireRoute(next, 'w1')).toBe(next)
    expect(clearWireRoute(next, 'nope')).toBe(next)
  })
})

describe('nextUid', () => {
  it('skips the uid a dangling mount points at, so a new part cannot become its board', () => {
    const d = emptyDiagram()
    d.modules.resistor = resistor
    d.parts = [{ uid: 'p3', designator: 'R1', module: 'resistor', x: 0, y: 0, mount: { board: 'p1' } }]
    expect(nextUid(d, 'p')).toBe('p2')
    expect(addPart(d, resistor, 100, 0).uid).toBe('p2')
  })
})

describe('hole endpoints', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  function boardAndResistor() {
    const a = addPart(emptyDiagram(), bb, 0, 0)
    return addPart(a.diagram, resistor, 200, 0).diagram
  }
  it('treats a missing hole as hole 0 when comparing ends', () => {
    const d = boardAndResistor()
    expect(sameEndpoint(d, { part: 'p1', pin: 's1' }, { part: 'p1', pin: 's1', hole: 0 })).toBe(true)
    expect(sameEndpoint(d, { part: 'p1', pin: 's1', hole: 1 }, { part: 'p1', pin: 's1', hole: 0 })).toBe(false)
  })
  it('ignores a stray hole on a pin end: only a hole group has holes', () => {
    const d = boardAndResistor()
    expect(sameEndpoint(d, { part: 'p2', pin: '1', hole: 3 }, { part: 'p2', pin: '1' })).toBe(true)
    expect(sameEndpoint(d, { part: 'p2', pin: '1', hole: 3 }, { part: 'p2', pin: '1', hole: 1 })).toBe(true)
    expect(sameEndpoint(d, { part: 'p2', pin: '1', hole: 3 }, { part: 'p2', pin: '2' })).toBe(false)
    const w = addWire(d, { part: 'p1', pin: 's1', hole: 0 }, { part: 'p2', pin: '1', hole: 2 }, style)!
    expect(addWire(w.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: 's1' }, style)).toBeNull()
  })
  it('allows wires into two holes of one strip, and refuses a repeat of the same hole', () => {
    const d = boardAndResistor()
    const w1 = addWire(d, { part: 'p1', pin: 's1', hole: 0 }, { part: 'p2', pin: '1' }, style)!
    const w2 = addWire(w1.diagram, { part: 'p1', pin: 's1', hole: 3 }, { part: 'p2', pin: '1' }, style)
    expect(w2).not.toBeNull()
    expect(addWire(w1.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: 's1', hole: 0 }, style)).toBeNull()
  })
  it('reconnects a wire end onto a hole', () => {
    const d = boardAndResistor()
    const w = addWire(d, { part: 'p1', pin: 's1', hole: 0 }, { part: 'p2', pin: '1' }, style)!
    const next = reconnectWire(w.diagram, w.uid, 'from', { part: 'p1', pin: 's2', hole: 2 })!
    expect(next.connections[0].from).toEqual({ part: 'p1', pin: 's2', hole: 2 })
    expect(reconnectWire(next, w.uid, 'from', { part: 'p1', pin: 's2', hole: 2 })).toBeNull()
  })
})

describe('board designators', () => {
  it('uses BB for breadboards and rail strips', () => {
    const board = (id: string): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins: [] })
    expect(designatorPrefix(board('breadboard-full'))).toBe('BB')
    expect(designatorPrefix(board('power-rail-strip'))).toBe('BB')
  })
})

describe('settleMounts', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  const at = (x: number, y: number, mounted = false): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'u', designator: 'R1', module: 'two', x, y, ...(mounted ? { mount: { board: 'b' } } : {}) },
    ],
    connections: [],
  })
  it('mounts a part dropped seated on a board', () => {
    expect(settleMounts(at(10, 0), ['u']).parts[1].mount).toEqual({ board: 'b' })
  })
  it('unmounts a part dropped half on or off the board', () => {
    expect(settleMounts(at(70, 0, true), ['u']).parts[1]).not.toHaveProperty('mount')
    expect(settleMounts(at(300, 0, true), ['u']).parts[1]).not.toHaveProperty('mount')
  })
  it('returns the same diagram when nothing changes, and skips boards', () => {
    const d = at(10, 0, true)
    expect(settleMounts(d, ['u', 'b'])).toBe(d)
    const loose = at(300, 0)
    expect(settleMounts(loose, ['u'])).toBe(loose)
  })
  it('in keep mode never mounts, only drops a mount that no longer fits', () => {
    const d = at(10, 0)
    expect(settleMounts(d, ['u'], 'keep')).toBe(d)
    expect(settleMounts(at(70, 0, true), ['u'], 'keep').parts[1]).not.toHaveProperty('mount')
  })
  it("in keep mode checks the part's own board, so an overlapping board never unmounts it", () => {
    // Board c overlaps b 40 px to the right (holes at x = 50..130) and comes later (drawn on top), so seatOf would pick c.
    const d = at(50, 0)
    d.parts = [d.parts[0], { uid: 'c', designator: 'BB2', module: 'bb', x: 40, y: 0 }, { ...d.parts[1], mount: { board: 'b' } }]
    expect(seatOf(d, 'u', [])!.board).toBe('c')
    expect(settleMounts(d, ['u'], 'keep')).toBe(d)
    // Off its own board but still on c: keep mode drops the mount rather than moving it.
    d.parts[2] = { ...d.parts[2], x: 90 }
    expect(settleMounts(d, ['u'], 'keep').parts[2]).not.toHaveProperty('mount')
  })
  it('lets the first of two dragged parts with legs on the same hole mount, not the second', () => {
    // u legs at x = 10 and 50; v legs at x = 50 and 90, same row.
    const d = at(10, 0)
    d.parts.push({ uid: 'v', designator: 'R2', module: 'two', x: 50, y: 0 })
    const next = settleMounts(d, ['v', 'u'])
    expect(next.parts[1].mount).toEqual({ board: 'b' })
    expect(next.parts[2]).not.toHaveProperty('mount')
    // The same in d.parts order with both starting mounted: v loses its (invalid) mount.
    const both = { ...d, parts: d.parts.map((p) => (p.uid === 'b' ? p : { ...p, mount: { board: 'b' } })) }
    const settled = settleMounts(both, ['u', 'v'])
    expect(settled.parts[1].mount).toEqual({ board: 'b' })
    expect(settled.parts[2]).not.toHaveProperty('mount')
  })
  it('never seats a dragged part onto a hole a part that stays put holds', () => {
    const d = at(10, 0, true)
    d.parts.push({ uid: 'v', designator: 'R2', module: 'two', x: 50, y: 0 })
    expect(settleMounts(d, ['v'])).toBe(d)
  })
  it('keeps unchanged parts as the same objects', () => {
    const d = at(10, 0)
    d.parts.push({ uid: 'v', designator: 'R2', module: 'two', x: 300, y: 0 })
    const next = settleMounts(d, ['u', 'v'])
    expect(next.parts[0]).toBe(d.parts[0])
    expect(next.parts[2]).toBe(d.parts[2])
  })
  it("while dragging a part over a later part's holes, sees them taken, as the drop does", () => {
    // u (index 1) still carries its old mount mid-drag and now sits on v's holes (x = 50 and 90).
    const d = at(50, 0, true)
    d.parts.push({ uid: 'v', designator: 'R2', module: 'two', x: 50, y: 0, mount: { board: 'b' } })
    // A plain seatOf on this frame's plugs is fooled: u's stale mount pushes v out of the plugs.
    expect(seatOf(d, 'u', plugsOf(d), new Set(['u']))!.status).toBe('seated')
    const { seats, plugs } = settleSeats(d, ['u'])
    expect(seats.get('u')!.status).toBe('partial')
    expect(plugs.map((pl) => pl.part)).toEqual(['v', 'v'])
    const dropped = settleMounts(d, ['u'])
    expect(dropped.parts[1]).not.toHaveProperty('mount')
    expect(dropped.parts[2].mount).toEqual({ board: 'b' })
  })
  it('shows the second of two overlapping dragged parts as not seated, as the drop does', () => {
    const d = at(10, 0, true)
    d.parts.push({ uid: 'v', designator: 'R2', module: 'two', x: 50, y: 0, mount: { board: 'b' } })
    const { seats, plugs } = settleSeats(d, ['v', 'u'])
    expect([...seats.keys()]).toEqual(['u', 'v'])
    expect(seats.get('u')!.status).toBe('seated')
    expect(seats.get('v')!.status).toBe('partial')
    expect(plugs).toEqual([])
    const dropped = settleMounts(d, ['u', 'v'])
    expect(dropped.parts[1].mount).toEqual({ board: 'b' })
    expect(dropped.parts[2]).not.toHaveProperty('mount')
  })
  it('a press without movement settles nothing, even a seated loose part', () => {
    const base = at(10, 0)
    expect(settleDrop(base, base, ['u'])).toBe(base)
    expect(settleDrop(base, { ...base }, ['u']).parts[1].mount).toEqual({ board: 'b' })
  })
  it('mounts a part added from the library straight onto a board (placeModule)', () => {
    const board = addPart(emptyDiagram(), bb, 0, 0)
    const placed = addPart(board.diagram, two, 10, 0)
    expect(settleMounts(placed.diagram, [placed.uid]).parts[1].mount).toEqual({ board: board.uid })
    const away = addPart(board.diagram, two, 300, 0)
    expect(settleMounts(away.diagram, [away.uid])).toBe(away.diagram)
  })
})

describe('boards carry their parts', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  /** Square part, body 40 x 40 with its pivot at the exact center (20, 20). */
  const sq: ModuleDef = { format: 'circuitoon-module/1', id: 'sq', name: 'Sq', size: { w: 4, h: 4 }, pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  const loaded = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two, sq },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0, rotation: 0 },
      { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, rotation: 0, mount: { board: 'b' } },
      { uid: 'x', designator: 'R2', module: 'two', x: 300, y: 0, rotation: 0 },
    ],
    connections: [{ uid: 'w1', from: { part: 'b', pin: 's9', hole: 0 }, to: { part: 'x', pin: 'L' } }],
  })

  it('lists a board with the parts mounted on it', () => {
    expect(withMounted(loaded(), ['b'])).toEqual(['b', 'p1'])
    expect(withMounted(loaded(), ['p1'])).toEqual(['p1'])
  })
  it('moves mounted parts with their board, and a mounted part alone without it', () => {
    const d = moveParts(loaded(), ['b'], 30, 20)
    expect(d.parts.map((p) => [p.uid, p.x, p.y])).toEqual([['b', 30, 20], ['p1', 40, 20], ['x', 300, 0]])
    expect(plugsOf(d)).toHaveLength(2)
    const alone = moveParts(loaded(), ['p1'], 30, 0)
    expect(alone.parts.map((p) => [p.uid, p.x])).toEqual([['b', 0], ['p1', 40], ['x', 300]])
  })
  it('keeps a carried part exactly seated: every leg on the same hole, moved by the same amount', () => {
    const before = plugsOf(loaded())
    const d = moveParts(loaded(), ['b'], 130, -70)
    expect(plugsOf(d)).toEqual(before.map((p) => ({ ...p, at: { x: p.at.x + 130, y: p.at.y - 70 } })))
    expect(seatOf(d, 'p1', plugsOf(d))!.status).toBe('seated')
  })
  it('moves a hand-shaped wire whose both ends move, and leaves one with an end that stays', () => {
    const d = loaded()
    d.connections = [
      { uid: 'w1', from: { part: 'b', pin: 's9', hole: 0 }, to: { part: 'p1', pin: 'L' }, route: [[90, -20], [0, -20]] },
      { uid: 'w2', from: { part: 'p1', pin: 'R' }, to: { part: 'x', pin: 'L' }, route: [[100, 20], [100, 60]] },
      { uid: 'w3', from: { part: 'b', pin: 's1', hole: 4 }, to: { part: 'b', pin: 's2', hole: 4 } },
    ]
    const moved = moveParts(d, ['b'], 30, 20).connections
    expect(moved[0].route).toEqual([[120, 0], [30, 0]])
    expect(moved[1]).toBe(d.connections[1])
    expect(moved[2]).toBe(d.connections[2])
    // Plain parts too: both ends on moved parts carry the bends.
    expect(moveParts(d, ['p1', 'x'], 10, 0).connections[1].route).toEqual([[110, 20], [110, 60]])
    // No hand-shaped wire moves: the wires list is the same object.
    const plain = loaded()
    expect(moveParts(plain, ['b'], 10, 0).connections).toBe(plain.connections)
  })
  it('turns mounted parts with a rotated board, so they stay seated', () => {
    const d = rotateParts(loaded(), ['b'])
    expect(d.parts[1]).toMatchObject({ uid: 'p1', x: 50, y: 0, rotation: 90, mount: { board: 'b' } })
    expect(seatOf(d, 'p1', plugsOf(d))!.status).toBe('seated')
    expect(plugsOf(d).map((p) => p.group)).toEqual(['s5', 's1'])
  })
  it('turns a mounted part once when it is selected along with its board', () => {
    expect(rotateParts(loaded(), ['b', 'p1']).parts[1]).toMatchObject({ x: 50, y: 0, rotation: 90 })
  })
  it('unmounts a rotated part that no longer fits, and keeps one that still does', () => {
    expect(rotateParts(loaded(), ['p1']).parts[1]).not.toHaveProperty('mount')
    const d = loaded()
    d.parts[1] = { uid: 'p1', designator: 'R1', module: 'sq', x: 10, y: 10, rotation: 90, mount: { board: 'b' } }
    expect(seatOf(d, 'p1', [])!.status).toBe('seated')
    expect(rotateParts(d, ['p1']).parts[1]).toMatchObject({ rotation: 180, mount: { board: 'b' } })
  })
  it('never mounts a part by rotating it', () => {
    const d = loaded()
    d.parts[1] = { uid: 'p1', designator: 'R1', module: 'sq', x: 10, y: 10, rotation: 90 }
    expect(rotateParts(d, ['p1']).parts[1]).not.toHaveProperty('mount')
  })
  it('carries only valid mounts: never a board, and never a part mounted on itself', () => {
    const d = loaded()
    d.parts.push(
      { uid: 'b2', designator: 'BB2', module: 'bb', x: 0, y: 200, mount: { board: 'b' } },
      { uid: 'self', designator: 'R3', module: 'two', x: 500, y: 0, mount: { board: 'self' } },
      { uid: 'onPart', designator: 'R4', module: 'two', x: 600, y: 0, mount: { board: 'x' } },
    )
    expect(withMounted(d, ['b'])).toEqual(['b', 'p1'])
    expect(withMounted(d, ['self', 'x'])).toEqual(['x', 'self'])
    const r = rotateParts(d, ['b'])
    expect(r.parts.find((p) => p.uid === 'b2')).toBe(d.parts.find((p) => p.uid === 'b2'))
  })
  it('leaves a part whose mount plugs nothing (partial) where it is when its board moves', () => {
    const d = loaded()
    d.parts[1] = { ...d.parts[1], x: 15 }
    expect(mountIssues(d)).toEqual([{ part: 'p1', board: 'b', reason: 'partial' }])
    expect(withMounted(d, ['b'])).toEqual(['b'])
    const moved = moveParts(d, ['b'], 30, 20)
    expect(moved.parts[1]).toBe(d.parts[1])
    expect(moved.parts[1]).toMatchObject({ x: 15, y: 0, mount: { board: 'b' } })
    expect(mountIssues(moved)).toEqual([{ part: 'p1', board: 'b', reason: 'partial' }])
    expect(rotateParts(d, ['b']).parts[1]).toBe(d.parts[1])
  })
  it('settles only the dragged parts a dragged board is not carrying', () => {
    const d = loaded()
    d.parts.push({ uid: 'b2', designator: 'BB2', module: 'bb', x: 0, y: 200, mount: { board: 'b' } })
    expect(settlingOf(d, ['b', 'p1', 'x', 'b2'])).toEqual(['b', 'p1', 'x', 'b2'].filter((u) => u !== 'p1'))
    expect(settlingOf(d, ['p1'])).toEqual(['p1'])
  })
  it('keeps a part selected with its board on that board when dragged over another board', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [
        { uid: 'B1', designator: 'BB2', module: 'bb', x: 300, y: 0 },
        { uid: 'B0', designator: 'BB1', module: 'bb', x: 0, y: 0 },
        { uid: 'P', designator: 'R1', module: 'two', x: 310, y: 0, mount: { board: 'B1' } },
        { uid: 'Q', designator: 'R2', module: 'two', x: 330, y: 10, mount: { board: 'B1' } },
      ],
      connections: [],
    }
    const now = moveParts(d, ['B1', 'P'], -300, 0)
    // The repro: settling the whole selection moves P to B0, the board it now also sits on (and
    // drawn above B1, so it wins the tie).
    expect(settleDrop(d, now, ['B1', 'P']).parts[2].mount).toEqual({ board: 'B0' })
    const done = settleDrop(d, now, settlingOf(d, ['B1', 'P']))
    expect(done.parts.map((p) => [p.uid, p.mount?.board])).toEqual([['B1', undefined], ['B0', undefined], ['P', 'B1'], ['Q', 'B1']])
    expect(settleSeats(now, settlingOf(d, ['B1', 'P'])).seats.size).toBe(0)
  })
  it('deletes a board but keeps a wire to the own pin of a part it carried', () => {
    const d = loaded()
    d.connections.push({ uid: 'w2', from: { part: 'p1', pin: 'R' }, to: { part: 'x', pin: 'R' } })
    expect(deleteSelection(d, { parts: ['b'], wires: [] }).connections.map((c) => c.uid)).toEqual(['w2'])
  })
  it('deletes a board but keeps its parts, unmounted, and drops wires to its holes', () => {
    const d = deleteSelection(loaded(), { parts: ['b'], wires: [] })
    expect(d.parts.map((p) => p.uid)).toEqual(['p1', 'x'])
    expect(d.parts[0]).not.toHaveProperty('mount')
    expect(d.connections).toEqual([])
  })
})
