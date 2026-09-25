import { describe, expect, it } from 'vitest'
import { computeRoutes, labelAnchor, wireColor, wireWidth, wirePaths, type Diagram } from './diagram.ts'
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

describe('labelAnchor', () => {
  it('anchors a straight wire at its midpoint', () => {
    expect(labelAnchor([{ x: 0, y: 20 }, { x: 100, y: 20 }])).toEqual({ x: 50, y: 20, horizontal: true })
  })
  it('picks the longer leg of an L-shaped wire', () => {
    // horizontal leg length 80, vertical leg length 30: the horizontal leg wins.
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }])).toEqual({ x: 40, y: 0, horizontal: true })
    // now the vertical leg (50) is longer than the horizontal leg (20).
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 50 }])).toEqual({ x: 20, y: 25, horizontal: false })
  })
  it('breaks a tie between equal-length segments by taking the first', () => {
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 }])).toEqual({ x: 20, y: 0, horizontal: true })
  })
  it('is null for a degenerate route', () => {
    expect(labelAnchor([])).toBeNull()
    expect(labelAnchor([{ x: 0, y: 0 }])).toBeNull()
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
  it('routes around a part that sits between two pins', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    diagram.parts[1] = { ...diagram.parts[1], x: 200 }
    diagram.parts.push({ uid: 'c', designator: 'C', module: 'two', x: 100, y: 0 })
    const r = computeRoutes(diagram).get('w')!
    expect(r.blocked).toBe(false)
    expect(r.points.length).toBeGreaterThan(2)
    // No horizontal segment may pass through c's body (x 100..140, y 0..30).
    const throughC = r.points.some((p, i) => {
      const q = r.points[i - 1]
      return i > 0 && p.y === q.y && p.y > 0 && p.y < 30 && Math.min(p.x, q.x) < 140 && Math.max(p.x, q.x) > 100
    })
    expect(throughC).toBe(false)
  })
  it('follows a rotated part', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    diagram.parts[1] = { ...diagram.parts[1], rotation: 90 }
    const r = computeRoutes(diagram).get('w')!
    // b is at (100, 0), body 40 x 30, pivot (20, 10); its L stub tip, local (-8, 20), turns to world (110, -18)
    expect(r.points[r.points.length - 1]).toEqual({ x: 110, y: -18 })
  })
  it('reuses previous routes for wires not listed in only', () => {
    const diagram = d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' } }])
    const prev = computeRoutes(diagram)
    const moved = { ...diagram, parts: diagram.parts.map((p) => (p.uid === 'b' ? { ...p, y: 50 } : p)) }
    expect(computeRoutes(moved, { only: new Set(), prev }).get('w')).toBe(prev.get('w'))
  })

  describe('occupancy across the sheet', () => {
    // Modeled on the battery-to-adjacent-pins bug report: a two-pin power part whose pins are
    // far apart (like a 9V battery's + and -) wired to a two-pin part whose pins are right next
    // to each other (like adjacent header pins), with both source pins facing away from the
    // target. Both wires' shortest paths run up, across the top and down the same lane.
    const src2: ModuleDef = {
      format: 'circuitoon-module/1', id: 'src2', name: 'Src2',
      pins: [
        { name: 'P1', side: 'top' },
        { spacer: true, side: 'top' },
        { spacer: true, side: 'top' },
        { spacer: true, side: 'top' },
        { name: 'P2', side: 'top' },
      ],
    }
    const tgt2: ModuleDef = {
      format: 'circuitoon-module/1', id: 'tgt2', name: 'Tgt2',
      pins: [{ name: 'T1', side: 'left' }, { name: 'T2', side: 'left' }],
    }
    const diagram: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { src2, tgt2 },
      parts: [
        { uid: 'bat', designator: 'BAT', module: 'src2', x: 0, y: 0 },
        { uid: 'dev', designator: 'DEV', module: 'tgt2', x: 200, y: 120 },
      ],
      connections: [
        { uid: 'w1', from: { part: 'bat', pin: 'P1' }, to: { part: 'dev', pin: 'T1' } },
        { uid: 'w2', from: { part: 'bat', pin: 'P2' }, to: { part: 'dev', pin: 'T2' } },
      ],
    }

    function interiorSegments(pts: { x: number; y: number }[]) {
      const segs: { axis: 'h' | 'v'; at: number; lo: number; hi: number }[] = []
      for (let i = 2; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.y === b.y) segs.push({ axis: 'h', at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
        else if (a.x === b.x) segs.push({ axis: 'v', at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
      }
      return segs
    }

    it('keeps the two routes off each other\'s interior horizontal and vertical runs', () => {
      const routes = computeRoutes(diagram)
      const w1 = routes.get('w1')!
      const w2 = routes.get('w2')!
      expect(w1.blocked).toBe(false)
      expect(w2.blocked).toBe(false)
      const s1 = interiorSegments(w1.points)
      const s2 = interiorSegments(w2.points)
      const overlap = s1.some((a) => s2.some((b) => a.axis === b.axis && a.at === b.at && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0))
      expect(overlap).toBe(false)
    })
  })

  describe('render-time separation of remaining overlaps', () => {
    // Two hand-routed wires whose middle run sits on the same grid line (60..100 and 70..110 at
    // y=60 both cross y=60): the router itself never sees these (they are manual), so wirePaths'
    // own fallback has to nudge the later one clear. Their vertical legs sit at different x, so
    // only that one interior segment needs to move; the terminal (pin-attached) segments should
    // not move at all.
    const diagram: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { two },
      parts: [
        { uid: 'a1', designator: 'A1', module: 'two', x: 0, y: 0 },
        { uid: 'b1', designator: 'B1', module: 'two', x: 150, y: 0 },
        { uid: 'a2', designator: 'A2', module: 'two', x: 20, y: 0 },
        { uid: 'b2', designator: 'B2', module: 'two', x: 160, y: 0 },
      ],
      connections: [
        { uid: 'w1', from: { part: 'a1', pin: 'R' }, to: { part: 'b1', pin: 'L' }, route: [[60, 20], [60, 60], [100, 60], [100, 20]] },
        { uid: 'w2', from: { part: 'a2', pin: 'R' }, to: { part: 'b2', pin: 'L' }, route: [[70, 20], [70, 60], [110, 60], [110, 20]] },
      ],
    }

    it('nudges the later wire\'s shared interior run 4 px clear, leaving its terminal segments untouched', () => {
      const wires = wirePaths(diagram)
      const w1 = wires.find((w) => w.conn.uid === 'w1')!
      const w2 = wires.find((w) => w.conn.uid === 'w2')!
      expect(w1.points).toEqual([{ x: 48, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 20 }, { x: 142, y: 20 }])
      expect(w2.points).toEqual([{ x: 68, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 64 }, { x: 110, y: 64 }, { x: 110, y: 20 }, { x: 152, y: 20 }])
      // Terminal segments (the ones that attach to a2's and b2's pins) are pixel-for-pixel unchanged.
      expect([w2.points[0], w2.points[1]]).toEqual([{ x: 68, y: 20 }, { x: 70, y: 20 }])
      expect([w2.points[4], w2.points[5]]).toEqual([{ x: 110, y: 20 }, { x: 152, y: 20 }])
    })
  })

  describe('hand-routed wires', () => {
    const bends: [number, number][] = [[60, 20], [60, 60], [80, 60], [80, 20]]
    const manual = () => d([{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'b', pin: 'L' }, route: bends }])
    const edit = (diagram: Diagram, uid: string, patch: Partial<Diagram['parts'][number]>): Diagram =>
      ({ ...diagram, parts: diagram.parts.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) })
    const check = (diagram: Diagram) => {
      const pts = computeRoutes(diagram).get('w')!.points
      pts.forEach((p, i) => i > 0 && expect(p.x === pts[i - 1].x || p.y === pts[i - 1].y).toBe(true))
      // The interior bends are untouched; the end bends may slide along their stretched segment.
      expect(pts).toEqual(expect.arrayContaining([{ x: 60, y: 60 }, { x: 80, y: 60 }]))
      return pts
    }

    it('keeps its bends and stays orthogonal as it is drawn', () => {
      expect(check(manual())).toEqual([{ x: 48, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 20 }, { x: 92, y: 20 }])
    })
    it('stretches only the end segments when an end part moves by (0, 10)', () => {
      expect(check(edit(manual(), 'b', { y: 10 }))).toEqual([
        { x: 48, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 30 }, { x: 92, y: 30 },
      ])
      expect(check(edit(manual(), 'a', { y: 10 }))).toEqual([
        { x: 48, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 20 }, { x: 92, y: 20 },
      ])
    })
    it('stretches only the end segments when an end part moves by (10, 0)', () => {
      expect(check(edit(manual(), 'b', { x: 110 })).at(-1)).toEqual({ x: 102, y: 20 })
      expect(check(edit(manual(), 'a', { x: 10 }))[0]).toEqual({ x: 58, y: 20 })
    })
    it('stays orthogonal after the end part is rotated 90 degrees', () => {
      const pts = check(edit(edit(manual(), 'b', { y: 10 }), 'b', { rotation: 90 }))
      expect(pts.at(-1)).toEqual({ x: 110, y: -8 })
      expect(check(edit(manual(), 'a', { rotation: 90 }))[0]).toEqual({ x: 10, y: 38 })
    })
  })

  it('draws 200 parts and 500 wires within the frame budget', () => {
    const parts = Array.from({ length: 200 }, (_, i) => ({ uid: `p${i}`, designator: `U${i}`, module: 'two', x: (i % 20) * 100, y: Math.floor(i / 20) * 80 }))
    const connections = Array.from({ length: 500 }, (_, i) => {
      const from = i % 200
      const to = (from + 1 + ((i * 37) % 199)) % 200
      return { uid: `w${i}`, from: { part: `p${from}`, pin: 'R' }, to: { part: `p${to}`, pin: 'L' } }
    })
    const diagram: Diagram = { format: 'circuitoon-diagram/1', title: 'big', modules: { two }, parts, connections }
    const routes = computeRoutes(diagram)
    wirePaths(diagram, routes) // warm-up
    // Best of three, so one GC pause or a busy CI machine does not fail the run.
    let ms = Infinity
    let out = wirePaths(diagram, routes)
    for (let k = 0; k < 3; k++) {
      const t = performance.now()
      out = wirePaths(diagram, routes)
      ms = Math.min(ms, performance.now() - t)
    }
    console.log(`wirePaths 200 parts / 500 wires: ${ms.toFixed(2)} ms, ${out.reduce((n, w) => n + (w.d.match(/A/g)?.length ?? 0), 0)} hops`)
    expect(out).toHaveLength(500)
    expect(ms).toBeLessThan(30)
  }, 60_000)
})
