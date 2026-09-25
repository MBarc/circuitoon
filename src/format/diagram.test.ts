import { describe, expect, it } from 'vitest'
import { wireColor, wireWidth, wirePaths, type Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'

describe('wire color and gauge', () => {
  it('takes named colors and hex, falls back to black', () => {
    expect(wireColor('red')).toBe('#E0483E')
    expect(wireColor('#12ab9F')).toBe('#12ab9F')
    expect(wireColor('#123')).toBe(wireColor('black'))
  })
  it('draws lower gauge numbers thicker', () => {
    expect(wireWidth(16)).toBeGreaterThan(wireWidth(22))
    expect(wireWidth(22)).toBe(3)
    expect(wireWidth(30)).toBeGreaterThanOrEqual(1.5)
  })
})

describe('wirePaths', () => {
  const two: ModuleDef = {
    format: 'circuitoon-module/1', id: 'two', name: 'Two',
    pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
  }
  const d = (connections: Diagram['connections']): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { two },
    parts: [
      { uid: 'a', designator: 'A', module: 'two', x: 0, y: 0 },
      { uid: 'b', designator: 'B', module: 'two', x: 100, y: 0 },
    ],
    connections,
  })

  it('draws a straight wire between facing pins', () => {
    const [w] = wirePaths(d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }]))
    expect(w.d).toBe('M48 20 L92 20')
  })
  it('puts a hop on the later wire where two wires cross', () => {
    const vert: ModuleDef = {
      format: 'circuitoon-module/1', id: 'vert', name: 'Vert',
      pins: [{ name: 'T', side: 'top' }, { name: 'B', side: 'bottom' }],
    }
    const diagram = d([
      { uid: 'w1', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } },
      { uid: 'w2', from: { part: 'c', pin: 'T' }, to: { part: 'e', pin: 'B' } },
    ])
    diagram.modules.vert = vert
    diagram.parts.push({ uid: 'c', designator: 'C', module: 'vert', x: 50, y: 60 }, { uid: 'e', designator: 'E', module: 'vert', x: 50, y: -60 })
    const [w1, w2] = wirePaths(diagram)
    expect(w1.d).toBe('M48 20 L92 20')
    expect(w2.d).toBe('M70 52 L70 25 A5 5 0 0 0 70 15 L70 -22')
  })
  it('skips a connection whose pin does not exist', () => {
    expect(wirePaths(d([{ uid: 'w', from: { part: 'a', pin: 'nope' }, to: { part: 'b', pin: 'L' } }]))).toEqual([])
  })
})
