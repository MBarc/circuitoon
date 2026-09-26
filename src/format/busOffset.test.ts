// Bus offsets: an endpoint `offset` is a position along a bus pin, a whole number from 0 to
// bus.length - 1. Anything else (out of range, fractional, or an offset on a pin or hole group
// that is not a bus) loads with a warning and leaves the wire broken: listed, never conducting.
import { describe, expect, it } from 'vitest'
import { resolveEndpoint, routingKey, validateDiagram, type Diagram } from './diagram.ts'
import { netlist } from './netlist.ts'
import { brokenConnections } from '../editor/problems.ts'
import type { ModuleDef } from './module.ts'

const rail: ModuleDef = {
  format: 'circuitoon-module/1', id: 'rail', name: 'Rail', pins: [{ name: 'bus', side: 'top', bus: { length: 2 } }],
}
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Board', pins: [], size: { w: 4, h: 2 }, obstacle: false,
  holes: [{ name: 'c1', at: [[10, 10], [20, 10]] }],
}

function sheet(to: Diagram['connections'][number]['to']): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { rail, two, bb },
    parts: [
      { uid: 'rl', designator: 'J1', module: 'rail', x: 0, y: 0 },
      { uid: 'r', designator: 'R1', module: 'two', x: 100, y: 0 },
      { uid: 'b', designator: 'BB1', module: 'bb', x: 200, y: 0 },
    ],
    connections: [{ uid: 'w', from: { part: 'r', pin: 'L' }, to }],
  }
}

describe('bus offsets', () => {
  it('resolves a whole-number offset from 0 to bus.length - 1, and a bus end with no offset', () => {
    for (const offset of [0, 1, undefined]) {
      const d = sheet({ part: 'rl', pin: 'bus', ...(offset === undefined ? {} : { offset }) })
      expect(resolveEndpoint(d, d.connections[0].to)).not.toBeNull()
      expect(netlist(d).broken).toEqual([])
      const r = validateDiagram(JSON.parse(JSON.stringify(d)))
      expect(r.ok && r.warnings).toEqual([])
    }
  })

  it('breaks a wire whose bus offset is past the end, negative or fractional, with a load warning', () => {
    for (const offset of [99, 2, -1, 0.5]) {
      const d = sheet({ part: 'rl', pin: 'bus', offset })
      expect(resolveEndpoint(d, d.connections[0].to)).toBeNull()
      expect(netlist(d).broken).toEqual(['w'])
      expect(brokenConnections(d).map((b) => b.uid)).toEqual(['w'])
      const r = validateDiagram(JSON.parse(JSON.stringify(d)))
      if (!r.ok) throw new Error(r.errors.join('; '))
      expect(r.warnings).toEqual([`connections[0].to.offset: ${offset} is not a position on bus "bus" (a whole number from 0 to 1), so the wire is broken`])
    }
  })

  it('breaks a wire with an offset on a pin or hole group that is not a bus', () => {
    for (const to of [{ part: 'r', pin: 'R', offset: 0 }, { part: 'b', pin: 'c1', hole: 1, offset: 0 }]) {
      const d = sheet(to)
      expect(resolveEndpoint(d, to)).toBeNull()
      expect(netlist(d).broken).toEqual(['w'])
      const r = validateDiagram(JSON.parse(JSON.stringify(d)))
      if (!r.ok) throw new Error(r.errors.join('; '))
      expect(r.warnings).toEqual([`connections[0].to.offset: "${to.pin}" is not a bus, so an offset there is meaningless and the wire is broken`])
    }
  })

  it('changes the routing key with the offset, since it decides whether the end resolves', () => {
    const key = (offset: number) => routingKey(sheet({ part: 'rl', pin: 'bus', offset }).connections)
    expect(key(1)).not.toBe(key(99))
  })
})
