import { describe, expect, it } from 'vitest'
import { netlist, netPoints, nodeKey } from './netlist.ts'
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
  it('lists no broken wires when every end resolves', () => {
    expect(netlist(netSheet()).broken).toEqual([])
  })
  it('does not conduct through a wire into a hole that does not exist', () => {
    const d = netSheet()
    d.connections[0] = { ...d.connections[0], from: { part: 'b', pin: 's9', hole: 99 } }
    const n = netlist(d)
    expect(n.nets[n.netOf.get(k('b', 's9'))!]).toEqual([k('b', 's9'), k('p2', 'R')].sort())
    expect(n.netOf.has(k('p3', 'L'))).toBe(false)
    expect(n.broken).toEqual(['w1'])
  })
  it('does not bridge two circuits through wires to the same missing pin', () => {
    const d = netSheet()
    d.parts.push({ uid: 'p5', designator: 'R5', module: 'two', x: 400, y: 0 }, { uid: 'p6', designator: 'R6', module: 'two', x: 500, y: 0 })
    d.connections.push(
      { uid: 'w4', from: { part: 'p6', pin: 'L' }, to: { part: 'p5', pin: 'nope' } },
      { uid: 'w3', from: { part: 'p5', pin: 'L' }, to: { part: 'p5', pin: 'nope' } },
      { uid: 'w5', from: { part: 'p5', pin: 'R' }, to: { part: 'gone', pin: 'L' } },
    )
    const n = netlist(d)
    expect(n.netOf.has(k('p5', 'L'))).toBe(false)
    expect(n.netOf.has(k('p6', 'L'))).toBe(false)
    expect(n.netOf.has(k('p5', 'nope'))).toBe(false)
    expect(n.broken).toEqual(['w3', 'w4', 'w5'])
  })
  it('still conducts through a valid wire whose route runs through a part', () => {
    const d = netSheet()
    d.connections[1] = { ...d.connections[1], route: [[240, 20], [320, 20], [320, 40]] }
    const n = netlist(d)
    expect(n.netOf.get(k('p3', 'R'))).toBe(n.netOf.get(k('p4', 'A')))
    expect(n.broken).toEqual([])
  })
})

describe('netPoints', () => {
  const sorted = (pts: { x: number; y: number }[]) => [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  it('lights every hole of the strip plus the pins plugged into it', () => {
    const pts = netPoints(netSheet(), { part: 'b', pin: 's5', hole: 3 })
    expect(sorted(pts)).toEqual(sorted([
      { x: 50, y: 10 }, { x: 50, y: 20 }, { x: 50, y: 30 }, { x: 50, y: 40 }, { x: 50, y: 50 },
      { x: 58, y: 20 }, // p1 R stub tip
      { x: 42, y: 30 }, // p2 L stub tip
    ]))
  })
  it('follows wires and internal joins from a pin', () => {
    const pts = netPoints(netSheet(), { part: 'p4', pin: 'B' })
    expect(sorted(pts)).toEqual(sorted([
      { x: 248, y: 20 }, // p3 R stub tip
      { x: 292, y: 20 }, // p4 A stub tip
      { x: 348, y: 20 }, // p4 B stub tip
    ]))
  })
  it('lights just the strip itself when nothing connects to it', () => {
    expect(netPoints(netSheet(), { part: 'b', pin: 's2' })).toHaveLength(5)
  })
})
