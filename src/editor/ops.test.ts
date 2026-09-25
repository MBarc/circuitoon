import { describe, expect, it } from 'vitest'
import { addPart, addWire, deleteSelection, designatorPrefix, moveParts, nextDesignator, reconnectWire, rotateParts, updatePart, updatePartValue, updateWire } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { parseValue } from '../format/values.ts'

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
  it('reconnects a wire end to another pin, keeping color, gauge, label and route', () => {
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
      route: [[50, 20]],
    })
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
