import { describe, expect, it } from 'vitest'
import { buildSnapIndex, gridOnly, snapMove, PIN_SNAP_PX, SNAP_PX } from './snap.ts'
import type { Rect } from '../format/geometry.ts'

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

describe('snapMove: grid only', () => {
  it('rounds a move to the 10 px grid when there is nothing to snap to', () => {
    const idx = buildSnapIndex({ objects: [] })
    expect(snapMove(idx, r(0, 0, 40, 30), { x: 14, y: -16 }, 1)).toMatchObject({ dx: 10, dy: -20, guides: [], gaps: [] })
    expect(gridOnly({ x: 14, y: 26 })).toEqual({ dx: 10, dy: 30, guides: [], gaps: [], by: { x: 'grid', y: 'grid' } })
  })
})

describe('snapMove: edges and centres', () => {
  // A static part 80 wide at x 100..180 (centre 140), y 200..240, far below the moving one.
  const idx = buildSnapIndex({ objects: [r(100, 200, 80, 40)] })
  const moving = r(0, 0, 40, 30)

  it('snaps the left edge to another left edge within the threshold, overriding the grid', () => {
    // Raw 106: the grid alone says 110, but 100 lines the left edges up and is 6 px away.
    const s = snapMove(idx, moving, { x: 106, y: 0 }, 1)
    expect(s.dx).toBe(100)
    expect(s.by.x).toBe('edge')
  })
  it('leaves the grid alone just past the threshold', () => {
    const s = snapMove(idx, moving, { x: 106 + 1, y: 0 }, 1)
    expect(s.dx).toBe(110)
    expect(s.by.x).toBe('grid')
  })
  it('measures the threshold in screen px, so zooming out reaches further', () => {
    expect(SNAP_PX).toBe(6)
    // At half zoom, 6 screen px are 12 world px: from raw 88 the moving centre (20) reaches the
    // static left edge (100), 8 away; at full zoom that is out of reach and the grid decides.
    expect(snapMove(idx, moving, { x: 88, y: 0 }, 0.5)).toMatchObject({ dx: 80, by: { x: 'edge' } })
    expect(snapMove(idx, moving, { x: 88, y: 0 }, 1).dx).toBe(90)
  })
  it('aligns centres and right edges too', () => {
    // The static centre is 140; the moving centre is 20 at rest, so a move of 120 centres it.
    // Raw 124 is 4 from that centre and 16 or more from any left or right alignment.
    expect(snapMove(idx, moving, { x: 124, y: 0 }, 1)).toMatchObject({ dx: 120, by: { x: 'edge' } })
    // Right edges: 180 - 40 = 140.
    expect(snapMove(idx, moving, { x: 145, y: 0 }, 1).dx).toBe(140)
  })
  it('picks the closest candidate on each axis independently', () => {
    const three = buildSnapIndex({ objects: [r(100, 200, 80, 40), r(300, 50, 40, 30), r(400, 60, 40, 30)] })
    // y raw 54: tops at 50 (4 away) and 60 (6 away): the closer wins.
    expect(snapMove(three, moving, { x: 0, y: 54 }, 1)).toMatchObject({ dy: 50, by: { y: 'edge' } })
    expect(snapMove(three, moving, { x: 0, y: 56 }, 1)).toMatchObject({ dy: 60, by: { y: 'edge' } })
  })
  it('never snaps to an off-grid target: pins must stay on the grid', () => {
    // A note whose left edge is 105: lining up would put every pin 5 px off the grid.
    const off = buildSnapIndex({ objects: [r(105, 200, 33, 20)] })
    const s = snapMove(off, moving, { x: 104, y: 0 }, 1)
    expect(s.dx).toBe(100)
    expect(s.guides).toEqual([])
  })
  it('draws a guide for each true alignment, spanning the aligned objects', () => {
    const s = snapMove(idx, moving, { x: 104, y: 0 }, 1)
    expect(s.dx).toBe(100)
    // Left edges meet at x 100: the line runs from the moving top (0) to the static bottom (240).
    expect(s.guides).toContainEqual({ axis: 'x', at: 100, from: 0, to: 240, kind: 'edge' })
    // No guide for an axis that is not aligned.
    expect(s.guides.filter((g) => g.axis === 'y')).toEqual([])
  })
  it('draws a guide when the grid alone lands on an alignment, and none when it does not', () => {
    // Left 200, centre 220, right 240 match nothing on x; the tops (0) and 200 do not meet either.
    const s = snapMove(idx, moving, { x: 200, y: 0 }, 1)
    expect(s.guides).toEqual([])
    // Raw 140 is exactly on the grid and puts the right edges together at 180.
    const t = snapMove(idx, moving, { x: 140, y: 0 }, 1)
    expect(t.guides).toContainEqual({ axis: 'x', at: 180, from: 0, to: 240, kind: 'edge' })
  })
  it('joins every object on one guide line', () => {
    const many = buildSnapIndex({ objects: [r(100, 200, 80, 40), r(100, -300, 20, 20)] })
    const s = snapMove(many, moving, { x: 100, y: 0 }, 1)
    expect(s.guides).toContainEqual({ axis: 'x', at: 100, from: -300, to: 240, kind: 'edge' })
  })
})

describe('snapMove: pins wired to the dragged part', () => {
  it('lines a pin up with the pin it is wired to, ahead of a closer edge', () => {
    expect(PIN_SNAP_PX).toBeGreaterThanOrEqual(SNAP_PX)
    // A static top at 40 is 2 away from raw 42; the wired pin is 8 away, beyond the edge threshold
    // but inside the pin one.
    const idx = buildSnapIndex({ objects: [r(300, 40, 40, 40)], pins: [{ from: { x: 50, y: 10 }, to: { x: 200, y: 60 } }] })
    const s = snapMove(idx, r(0, 0, 40, 30), { x: 0, y: 42 }, 1)
    // Pin: 60 - 10 = 50, 8 away. Edge: top 40, 2 away. The pin wins.
    expect(s).toMatchObject({ dy: 50, by: { y: 'pin' } })
    expect(s.guides).toContainEqual({ axis: 'y', at: 60, from: 50, to: 200, kind: 'pin', ends: [{ x: 50, y: 60 }, { x: 200, y: 60 }] })
  })
  it('ignores a wired pin beyond the pin threshold', () => {
    const idx = buildSnapIndex({ objects: [], pins: [{ from: { x: 50, y: 10 }, to: { x: 200, y: 60 } }] })
    expect(snapMove(idx, r(0, 0, 40, 30), { x: 0, y: 50 - PIN_SNAP_PX - 1 }, 1).by.y).toBe('grid')
  })
  it('shows a pin guide whenever a wired pair ends up level', () => {
    const idx = buildSnapIndex({ objects: [], pins: [{ from: { x: 50, y: 10 }, to: { x: 200, y: 10 } }] })
    const s = snapMove(idx, r(0, 0, 40, 30), { x: 1, y: 1 }, 1)
    expect(s.guides.filter((g) => g.kind === 'pin')).toHaveLength(1)
  })
})

describe('snapMove: equal spacing', () => {
  // Two parts in a row with a 60 px gap between them.
  const a = r(0, 100, 40, 30)
  const b = r(100, 100, 40, 30)
  const idx = buildSnapIndex({ objects: [a, b] })

  it('snaps the gap to a neighbour to match an existing gap in the row', () => {
    // The moving part starts at x 400; to leave 60 after b (right 140) its left goes to 200.
    const moving = r(400, 100, 40, 30)
    const s = snapMove(idx, moving, { x: -196, y: 0 }, 0.5)
    expect(s).toMatchObject({ dx: -200, by: { x: 'spacing' } })
    // Markers on both equal gaps, drawn at the middle of each pair's shared height.
    expect(s.gaps).toEqual(
      expect.arrayContaining([
        { axis: 'x', from: 40, to: 100, at: 115 },
        { axis: 'x', from: 140, to: 200, at: 115 },
      ]),
    )
  })
  it('matches on the left of the row too', () => {
    const moving = r(-400, 100, 40, 30)
    // To leave 60 before a (left 0) the moving right goes to -60: its left to -100, a move of 300.
    const s = snapMove(idx, moving, { x: 296, y: 0 }, 0.5)
    expect(s).toMatchObject({ dx: 300, by: { x: 'spacing' } })
  })
  it('centres between two neighbours', () => {
    // Between b (right 140) and c (left 300) a 40 wide part sits at 190..230 with 50 either side.
    // Between b (right 140) and c (left 320), a 40 wide part centred sits at 210..250, 70 either side.
    const c = r(320, 100, 40, 30)
    const three = buildSnapIndex({ objects: [a, b, c] })
    // Raw left 208: centred (210) is 2 away, beating the 60 gap after b (200, 8 away).
    const s = snapMove(three, r(180, 400, 40, 30), { x: 28, y: -300 }, 0.5)
    expect(s).toMatchObject({ dx: 30, dy: -300, by: { x: 'spacing' } })
    expect(s.gaps).toEqual(expect.arrayContaining([{ axis: 'x', from: 140, to: 210, at: 115 }, { axis: 'x', from: 250, to: 320, at: 115 }]))
  })
  it('only counts neighbours in the same row', () => {
    const moving = r(400, 500, 40, 30)
    const s = snapMove(idx, moving, { x: -196, y: 0 }, 0.5)
    expect(s.by.x).toBe('grid')
    expect(s.gaps).toEqual([])
  })
  it('works on the vertical axis', () => {
    const col = buildSnapIndex({ objects: [r(0, 0, 40, 30), r(0, 80, 40, 30)] })
    // Gap 50; below the second (bottom 110) the moving top goes to 160.
    const s = snapMove(col, r(0, 400, 40, 30), { x: 0, y: -236 }, 0.5)
    expect(s).toMatchObject({ dy: -240, by: { y: 'spacing' } })
    expect(s.gaps).toContainEqual({ axis: 'y', from: 110, to: 160, at: 20 })
  })
})
