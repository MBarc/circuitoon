import { describe, expect, it } from 'vitest'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'

/** A 100 x 60 test board (pivot 50, 30): nine vertical strips s1..s9 at x = 10..90, five holes each at y = 10..50. */
const bb: ModuleDef = {
  format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
  holes: Array.from({ length: 9 }, (_, i) => ({
    name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
  })),
}
/** Two-lead part, body 40 x 30 (pivot 20, 10): L edge at local (0, 20), R edge at local (40, 20), stubs 8 px out. */
const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}
/** Two pins joined inside the part. */
const dual: ModuleDef = {
  format: 'circuitoon-module/1', id: 'dual', name: 'Dual',
  pins: [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }],
  internal: [['A', 'B']],
}

function netSheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two, dual },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'p2', designator: 'R2', module: 'two', x: 50, y: 10, mount: { board: 'b' } },
      { uid: 'p3', designator: 'R3', module: 'two', x: 200, y: 0 },
      { uid: 'p4', designator: 'U1', module: 'dual', x: 300, y: 0 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'b', pin: 's9', hole: 0 }, to: { part: 'p3', pin: 'L' } },
      { uid: 'w2', from: { part: 'p3', pin: 'R' }, to: { part: 'p4', pin: 'A' } },
    ],
  }
}

const k = nodeKey

describe('netlist', () => {
  it('merges wires, mounted legs and internal joins into nets', () => {
    const n = netlist(netSheet())
    const net = (part: string, pin: string) => n.nets[n.netOf.get(k(part, pin))!]
    expect(net('b', 's1')).toEqual([k('b', 's1'), k('p1', 'L')].sort())
    expect(net('b', 's5')).toEqual([k('b', 's5'), k('p1', 'R'), k('p2', 'L')].sort())
    expect(net('p3', 'L')).toEqual([k('b', 's9'), k('p2', 'R'), k('p3', 'L')].sort())
    expect(net('p4', 'B')).toEqual([k('p3', 'R'), k('p4', 'A'), k('p4', 'B')].sort())
    expect(n.nets).toHaveLength(4)
  })
  it('leaves out single nodes, so a free strip has no net', () => {
    expect(netlist(netSheet()).netOf.has(k('b', 's2'))).toBe(false)
  })
  it('drops a leg from its strip when its part is unmounted', () => {
    const d = netSheet()
    d.parts[1] = { ...d.parts[1], mount: undefined }
    const n = netlist(d)
    expect(n.netOf.has(k('b', 's1'))).toBe(false)
    expect(n.nets[n.netOf.get(k('b', 's5'))!]).toEqual([k('b', 's5'), k('p2', 'L')].sort())
  })
  it('keeps pin and part names apart even with separators in them', () => {
    expect(k('a b', 'c')).not.toBe(k('a', 'b c'))
  })
})
