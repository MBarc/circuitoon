import { describe, expect, it } from 'vitest'
import { brokenConnections, endpointName } from './problems.ts'
import { netlist } from '../format/netlist.ts'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Board', pins: [], size: { w: 4, h: 2 }, obstacle: false,
  holes: [{ name: 'c1', label: '1', at: [[10, 10], [20, 10]] }],
}
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left', label: 'Anode' }, { name: 'R', side: 'right' }],
}

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'r', designator: 'R1', module: 'two', x: 100, y: 0 },
      { uid: 'q', designator: 'Q1', module: 'gone', x: 200, y: 0 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'b', pin: 'c1', hole: 1 }, to: { part: 'r', pin: 'L' } },
      { uid: 'w2', from: { part: 'b', pin: 'c1', hole: 9 }, to: { part: 'r', pin: 'R' }, label: 'VCC' },
      { uid: 'w3', from: { part: 'zz', pin: '1' }, to: { part: 'r', pin: 'nope' } },
      { uid: 'w4', from: { part: 'q', pin: 'E' }, to: { part: 'b', pin: 'c1' } },
    ],
  }
}

describe('endpointName', () => {
  it('names a part by its designator and a pin by its label, a hole with its index', () => {
    const d = sheet()
    expect(endpointName(d, { part: 'r', pin: 'L' })).toBe('R1 Anode')
    expect(endpointName(d, { part: 'r', pin: 'R' })).toBe('R1 R')
    expect(endpointName(d, { part: 'b', pin: 'c1', hole: 9 })).toBe('BB1 c1 hole 9')
    expect(endpointName(d, { part: 'r', pin: 'bus', offset: 3 })).toBe('R1 bus[3]')
  })
  it('names a missing part by its uid', () => {
    expect(endpointName(sheet(), { part: 'zz', pin: '1' })).toBe('zz 1')
  })
})

describe('brokenConnections', () => {
  it('lists exactly the netlist broken connections, in file order, with the ends that do not resolve', () => {
    const d = sheet()
    const list = brokenConnections(d)
    expect(list.map((b) => b.uid)).toEqual(netlist(d).broken)
    expect(list).toEqual([
      { uid: 'w2', name: 'VCC', missing: ['BB1 c1 hole 9'] },
      { uid: 'w3', name: 'zz 1 to R1 nope', missing: ['zz 1', 'R1 nope'] },
      { uid: 'w4', name: 'Q1 E to BB1 c1', missing: ['Q1 E'] },
    ])
  })
  it('is empty when every connection resolves', () => {
    const d = sheet()
    d.connections = d.connections.slice(0, 1)
    expect(brokenConnections(d)).toEqual([])
  })
})
