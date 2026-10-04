// A wire drawn between two USB ports becomes the USB cable that fits them, or a plug-in link
// (USB design 2.1 and 2.2); a USB cable is never remembered as the next plain wire's cable.
import { describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { type ModuleDef, validateModule } from '../format/module.ts'
import { addWire } from './ops.ts'
import { EditorStore } from './store.ts'

const mod = (id: string, pins: unknown[]): ModuleDef => {
  const r = validateModule({ format: 'circuitoon-module/1', id, name: id, pins, electrical: { params: {} } })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.module
}
const port = (connector: string, gender: string, role: string) => [{ name: 'USB', side: 'right', type: 'usb', usb: { connector, gender, role } }, { name: 'IO', side: 'left', type: 'io' }]
const modules = { host: mod('host', port('A', 'receptacle', 'host')), dev: mod('dev', port('micro-B', 'receptacle', 'device')), dongle: mod('dongle', port('A', 'plug', 'device')) }
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
