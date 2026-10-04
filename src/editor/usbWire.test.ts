// A wire drawn between two USB ports becomes the USB cable that fits them, or a plug-in link
// (USB design 2.1 and 2.2); a USB cable is never remembered as the next plain wire's cable.
import { describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { type ModuleDef, validateModule } from '../format/module.ts'
import { addWire, reconnectWire } from './ops.ts'
import { EditorStore } from './store.ts'

const mod = (id: string, pins: unknown[]): ModuleDef => {
  const r = validateModule({ format: 'circuitoon-module/1', id, name: id, pins, electrical: { params: {} } })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.module
}
const port = (connector: string, gender: string, role: string) => [{ name: 'USB', side: 'right', type: 'usb', usb: { connector, gender, role } }, { name: 'IO', side: 'left', type: 'io' }]
const modules = { host: mod('host', port('A', 'receptacle', 'host')), dev: mod('dev', port('micro-B', 'receptacle', 'device')), devc: mod('devc', port('C', 'receptacle', 'device')), dongle: mod('dongle', port('A', 'plug', 'device')) }
const sheet = (a: string, b: string): Diagram => ({
  format: 'circuitoon-diagram/1', title: 't', modules,
  parts: [{ uid: 'a', designator: 'U1', module: a, x: 0, y: 0 }, { uid: 'b', designator: 'U2', module: b, x: 300, y: 0 }], connections: [],
})
const style = { color: 'blue', gauge: 22, ends: { from: 'dupont-male' as const, to: 'dupont-male' as const } }

describe('drawing a wire between USB ports', () => {
  it('two sockets: the cable whose plugs fit, in black, whatever the new-wire style', () => {
    const w = addWire(sheet('host', 'dev'), { part: 'a', pin: 'USB' }, { part: 'b', pin: 'USB' }, style)!
    expect(w.diagram.connections[0]).toMatchObject({ color: 'black', ends: { from: 'usb-a', to: 'usb-micro-b' } })
  })
  it('a plug into a socket: no cable', () => {
    const w = addWire(sheet('host', 'dongle'), { part: 'a', pin: 'USB' }, { part: 'b', pin: 'USB' }, style)!
    expect(w.diagram.connections[0].ends).toBeUndefined()
  })
  it('a USB port to a GPIO keeps the new-wire style (the checker flags it)', () => {
    const w = addWire(sheet('host', 'dev'), { part: 'a', pin: 'USB' }, { part: 'b', pin: 'IO' }, style)!
    expect(w.diagram.connections[0]).toMatchObject({ color: 'blue', ends: style.ends })
  })
  it('a USB cable is never remembered as the new-wire cable', () => {
    const store = new EditorStore(sheet('host', 'dev'))
    store.setWireStyle({ color: 'blue', gauge: 22, ends: { from: 'jst-xh', to: 'jst-xh' } })
    store.setWireStyle({ color: 'blue', gauge: 22, ends: { from: 'usb-a', to: 'usb-c' } })
    expect(store.getState().wireStyle.ends).toEqual({ from: 'jst-xh', to: 'jst-xh' })
  })
})

describe('moving a wire end onto or off a USB port', () => {
  const three = (): Diagram => ({ ...sheet('host', 'dev'), parts: [...sheet('host', 'dev').parts, { uid: 'c', designator: 'U3', module: 'devc', x: 600, y: 0 }] })
  const cabled = () => addWire(three(), { part: 'a', pin: 'USB' }, { part: 'b', pin: 'USB' }, style)!
  it('port to another port: the cable that fits the new pair', () => {
    const d = reconnectWire(cabled().diagram, 'w1', 'to', { part: 'c', pin: 'USB' }, style)!
    expect(d.connections[0].ends).toEqual({ from: 'usb-a', to: 'usb-c' })
  })
  it('off a port onto a pin: the new-wire jumper; back onto ports: the USB cable', () => {
    const off = reconnectWire(cabled().diagram, 'w1', 'to', { part: 'b', pin: 'IO' }, style)!
    expect(off.connections[0].ends).toEqual(style.ends)
    const plain = reconnectWire(cabled().diagram, 'w1', 'to', { part: 'b', pin: 'IO' })!
    expect(plain.connections[0].ends).toBeUndefined()
    const on = reconnectWire(off, 'w1', 'to', { part: 'b', pin: 'USB' }, style)!
    expect(on.connections[0].ends).toEqual({ from: 'usb-a', to: 'usb-micro-b' })
  })
  it('a plain wire between pins keeps its ends', () => {
    const w = addWire(three(), { part: 'a', pin: 'IO' }, { part: 'b', pin: 'IO' }, { color: 'red', gauge: 22, ends: { from: 'banana', to: 'banana' } })!
    expect(reconnectWire(w.diagram, 'w1', 'to', { part: 'c', pin: 'IO' }, style)!.connections[0].ends).toEqual({ from: 'banana', to: 'banana' })
  })
  it('undo brings back the wire and its cable, redo the move', () => {
    const store = new EditorStore(three())
    store.commit(cabled().diagram)
    const before = store.getState().diagram
    store.commit(reconnectWire(before, 'w1', 'to', { part: 'b', pin: 'IO' }, style)!)
    store.undo()
    expect(store.getState().diagram.connections).toEqual(before.connections)
    store.redo()
    expect(store.getState().diagram.connections[0]).toMatchObject({ to: { part: 'b', pin: 'IO' }, ends: style.ends })
    // Undo of drawing the USB wire removes it.
    store.undo()
    store.undo()
    expect(store.getState().diagram.connections).toEqual([])
  })
})
