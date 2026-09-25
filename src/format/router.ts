// Orthogonal wire router: A* over a 10 px grid, with a penalty per bend so wires stay tidy.
// The search state is (cell, heading); reversing is not allowed. Obstacles are part bodies
// grown by a small clearance. The first and last steps leave and enter pins along their stub.
import { type Pt, type Rect, simplify } from './geometry.ts'

export interface RouteRequest {
  from: Pt
  /** Outward direction at `from`; null for a hole, which a wire may leave in any direction. */
  fromDir: Pt | null
  to: Pt
  /** Outward direction at `to`; null for a hole, which a wire may enter from any side. */
  toDir: Pt | null
  obstacles: Rect[]
  /** Grid nodes already used by earlier wires, so this route can take its own lane next to them. */
  occupied?: Occupancy
}
export interface RouteOptions {
  grid?: number
  clearance?: number
  bendCost?: number
  /** Search windows around the endpoints, tried in order until one finds a route. */
  margins?: number[]
  /** Extra cost for a step onto a grid node another wire already runs along on the same axis. */
  parallelCost?: number
}

/** Default gap kept between a routed wire and a part body, in px. */
export const CLEARANCE = 4

const H_BIT = 1
const V_BIT = 2

/**
 * Nodes farther than this many grid cells from the origin on either axis (about 335 million px at
 * the 10 px grid) are not recorded. Keeps `packCell` inside the safe-integer range.
 */
const CELL_LIMIT = 2 ** 25
/** Packs grid cell (cx, cy), each within +-CELL_LIMIT, into one integer below 2^52. */
const packCell = (cx: number, cy: number) => (cx + CELL_LIMIT) * 2 ** 26 + (cy + CELL_LIMIT)
/** Largest dense occupancy grid, in cells (bytes); a wire drawn beyond it goes to the sparse map. */
const DENSE_MAX = 1 << 22

/**
 * Grid nodes used by earlier wires, bit 1 = a horizontal run passes through, bit 2 = a vertical run
 * does. Only nodes on the routing grid (multiples of `grid`) are kept, since those are the only ones
 * the search ever visits. Stored as one byte per cell in a dense grid that grows to cover the wires
 * added so far (a sheet of routed wires stays compact), so a search copies its window out row by
 * row instead of looking up nodes one at a time. Nodes that would grow the dense grid past
 * DENSE_MAX cells (a hand-drawn wire far off the sheet) are kept in a sparse map instead.
 */
export class Occupancy {
  readonly grid: number
  /** Dense grid origin and size, in grid cells. */
  cx0 = 0
  cy0 = 0
  cols = 0
  rows = 0
  cells = new Uint8Array(0)
  /** Nodes outside the dense grid, keyed by `packCell`. */
  far = new Map<number, number>()
  /** Number of occupied nodes. */
  size = 0

  constructor(grid = 10) {
    this.grid = grid
  }

  /** Bits at world point (x, y); 0 for a point off the grid or never used. */
  at(x: number, y: number): number {
    const g = this.grid
    if (x % g !== 0 || y % g !== 0) return 0
    const cx = x / g - this.cx0
    const cy = y / g - this.cy0
    if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) return this.cells[cy * this.cols + cx]
    return this.far.size ? (this.far.get(packCell(x / g, y / g)) ?? 0) : 0
  }

  /** Grows the dense grid to cover cells cxLo..cxHi x cyLo..cyHi if that stays within DENSE_MAX; false if it cannot. */
  reserve(cxLo: number, cyLo: number, cxHi: number, cyHi: number): boolean {
    if (this.cols && cxLo >= this.cx0 && cyLo >= this.cy0 && cxHi < this.cx0 + this.cols && cyHi < this.cy0 + this.rows) return true
    // Grow with slack (half the current size, at least 32 cells a side), so a sheet's worth of
    // wires added one at a time reallocates only a handful of times.
    const padX = Math.max(32, this.cols >> 1)
    const padY = Math.max(32, this.rows >> 1)
    const lx = Math.min(cxLo, this.cols ? this.cx0 : cxLo) - padX
    const ly = Math.min(cyLo, this.rows ? this.cy0 : cyLo) - padY
    const hx = Math.max(cxHi, this.cols ? this.cx0 + this.cols - 1 : cxHi) + padX
    const hy = Math.max(cyHi, this.rows ? this.cy0 + this.rows - 1 : cyHi) + padY
    const cols = hx - lx + 1
    const rows = hy - ly + 1
    if (cols * rows > DENSE_MAX) return false
    const cells = new Uint8Array(cols * rows)
    for (let r = 0; r < this.rows; r++) {
      const from = r * this.cols
      cells.set(this.cells.subarray(from, from + this.cols), (r + this.cy0 - ly) * cols + (this.cx0 - lx))
    }
    this.cx0 = lx
    this.cy0 = ly
    this.cols = cols
    this.rows = rows
    this.cells = cells
    return true
  }

  /** Marks grid cell (cx, cy) with `bit`. */
  mark(cx: number, cy: number, bit: number) {
    const dx = cx - this.cx0
    const dy = cy - this.cy0
    if (dx >= 0 && dy >= 0 && dx < this.cols && dy < this.rows) {
      const i = dy * this.cols + dx
      if (!this.cells[i]) this.size++
      this.cells[i] |= bit
      return
    }
    if (Math.abs(cx) >= CELL_LIMIT || Math.abs(cy) >= CELL_LIMIT) return
    const k = packCell(cx, cy)
    const old = this.far.get(k) ?? 0
    if (!old) this.size++
    this.far.set(k, old | bit)
  }

  /**
   * Copies the bits for the search window whose top-left node is (x0, y0) and which spans
   * cols x rows nodes `g` px apart into `out` (row-major, cols wide).
   */
  copyWindow(x0: number, y0: number, cols: number, rows: number, g: number, out: Uint8Array) {
    if (g !== this.grid) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = this.at(x0 + c * g, y0 + r * g)
      return
    }
    const wx = x0 / g - this.cx0 // window column 0, in dense-grid columns
    const wy = y0 / g - this.cy0
    const c0 = Math.max(0, -wx)
    const c1 = Math.min(cols, this.cols - wx) // exclusive
    const r0 = Math.max(0, -wy)
    const r1 = Math.min(rows, this.rows - wy)
    if (c0 < c1)
      for (let r = r0; r < r1; r++) {
        const from = (r + wy) * this.cols + wx
        out.set(this.cells.subarray(from + c0, from + c1), r * cols + c0)
      }
    if (!this.far.size) return
    const cxLo = x0 / g
    const cyLo = y0 / g
    for (const [k, bits] of this.far) {
      const cy = (k % 2 ** 26) - CELL_LIMIT
      const cx = Math.floor(k / 2 ** 26) - CELL_LIMIT
      const c = cx - cxLo
      const r = cy - cyLo
      if (c >= 0 && r >= 0 && c < cols && r < rows) out[r * cols + c] |= bits
    }
  }
}

/** Adds one polyline's axis-aligned segments to `occ`. Linear in the polyline's total length. */
export function addToOccupancy(occ: Occupancy, polyline: Pt[]) {
  const g = occ.grid
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]
    const b = polyline[i]
    // A run off the grid line (a pin tip between grid lines) holds no node the search visits.
    if (a.y === b.y) {
      if (a.y % g !== 0) continue
      const lo = Math.ceil(Math.min(a.x, b.x) / g)
      const hi = Math.floor(Math.max(a.x, b.x) / g)
      const cy = a.y / g
      if (lo > hi) continue
      occ.reserve(lo, cy, hi, cy)
      for (let cx = lo; cx <= hi; cx++) occ.mark(cx, cy, H_BIT)
    } else if (a.x === b.x) {
      if (a.x % g !== 0) continue
      const lo = Math.ceil(Math.min(a.y, b.y) / g)
      const hi = Math.floor(Math.max(a.y, b.y) / g)
      const cx = a.x / g
      if (lo > hi) continue
      occ.reserve(cx, lo, cx, hi)
      for (let cy = lo; cy <= hi; cy++) occ.mark(cx, cy, V_BIT)
    }
    // A diagonal segment cannot come from the router or a manual route; skip it rather than guess an axis.
  }
}

/** Occupancy built from several wires' polylines, so a later wire can avoid running alongside them. */
export function occupancyOf(polylines: Pt[][], grid = 10): Occupancy {
  const occ = new Occupancy(grid)
  for (const p of polylines) addToOccupancy(occ, p)
  return occ
}

/** Largest search window, in grid cells, before a margin is skipped (keeps memory and time bounded). */
const MAX_CELLS = 250_000

const DIRS: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
const dirIndex = (d: Pt) => DIRS.findIndex((v) => v.x === d.x && v.y === d.y)

/** First grid point reached by stepping out of `p` along `d`. */
function leave(p: Pt, d: Pt, g: number): Pt {
  const snap = (v: number, s: number) =>
    s > 0 ? Math.ceil((v + 1) / g) * g : s < 0 ? Math.floor((v - 1) / g) * g : Math.round(v / g) * g
  return { x: snap(p.x, d.x), y: snap(p.y, d.y) }
}

/** Nearest grid point to `p` (a hole center is already on the grid). */
const onGrid = (p: Pt, g: number): Pt => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g })

/**
 * Binary min-heap of (state, priority) pairs in typed arrays that grow as needed. One instance is
 * reused by every search (routing is synchronous), so a sheet's worth of searches does not
 * reallocate it.
 */
class MinHeap {
  private pri = new Float64Array(1024)
  private val = new Int32Array(1024)
  size = 0
  clear() {
    this.size = 0
  }
  push(v: number, p: number) {
    if (this.size === this.val.length) {
      const pri = new Float64Array(this.size * 2)
      const val = new Int32Array(this.size * 2)
      pri.set(this.pri)
      val.set(this.val)
      this.pri = pri
      this.val = val
    }
    const pr = this.pri
    const vl = this.val
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (pr[parent] <= p) break
      vl[i] = vl[parent]
      pr[i] = pr[parent]
      i = parent
    }
    vl[i] = v
    pr[i] = p
  }
  pop(): number {
    const pr = this.pri
    const vl = this.val
    const top = vl[0]
    const n = --this.size
    const lastV = vl[n]
    const lastP = pr[n]
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && pr[r] < pr[l] ? r : l
        if (pr[c] >= lastP) break
        vl[i] = vl[c]
        pr[i] = pr[c]
        i = c
      }
      vl[i] = lastV
      pr[i] = lastP
    }
    return top
  }
}

/**
 * Search scratch shared by every call (routing is synchronous): the per-state cost, back-pointer
 * and closed arrays only grow, so a full re-route allocates them a few times rather than once per
 * wire. Each search clears just the part it uses.
 */
const scratch = { cost: new Float64Array(0), prev: new Int32Array(0), closed: new Uint8Array(0), heap: new MinHeap() }
function buffers(n: number) {
  if (scratch.cost.length < n) {
    const size = Math.max(n, scratch.cost.length * 2)
    scratch.cost = new Float64Array(size)
    scratch.prev = new Int32Array(size)
    scratch.closed = new Uint8Array(size)
  }
  const cost = scratch.cost.subarray(0, n).fill(Infinity)
  const closed = scratch.closed.subarray(0, n).fill(0)
  scratch.heap.clear()
  return { cost, prev: scratch.prev, closed, heap: scratch.heap }
}

/** Column and row step for each heading in DIRS order (right, down, left, up). */
const STEP_X = [1, 0, -1, 0]
const STEP_Y = [0, 1, 0, -1]

export function routeOrthogonal(req: RouteRequest, opts: RouteOptions = {}): Pt[] | null {
  const g = opts.grid ?? 10
  const clearance = opts.clearance ?? CLEARANCE
  const bendCost = opts.bendCost ?? 30
  const parallelCost = opts.parallelCost ?? 40
  const start = req.fromDir ? leave(req.from, req.fromDir, g) : onGrid(req.from, g)
  const goal = req.toDir ? leave(req.to, req.toDir, g) : onGrid(req.to, g)
  for (const margin of opts.margins ?? [60, 240]) {
    const path = search(start, goal, req, g, clearance, bendCost, parallelCost, margin)
    if (path) {
      // A tip off the grid (a part loaded between grid lines) meets the first and last grid node
      // with a corner, turned so the wire still leaves and enters along the stub.
      const first = path[0]
      const last = path[path.length - 1]
      const head = skew(req.from, first) ? [req.fromDir?.x === 0 ? { x: req.from.x, y: first.y } : { x: first.x, y: req.from.y }] : []
      const tail = skew(last, req.to) ? [req.toDir?.x === 0 ? { x: req.to.x, y: last.y } : { x: last.x, y: req.to.y }] : []
      return simplify([req.from, ...head, ...path, ...tail, req.to])
    }
  }
  return null
}

/** True when a and b differ on both axes, so a straight line between them would be a diagonal. */
const skew = (a: Pt, b: Pt) => a.x !== b.x && a.y !== b.y

/** True when `p` lies inside `r` grown by `clearance` on every side (the cells the router blocks). */
export const inGrown = (p: Pt, r: Rect, clearance = CLEARANCE) =>
  p.x >= r.x - clearance && p.x <= r.x + r.w + clearance && p.y >= r.y - clearance && p.y <= r.y + r.h + clearance

function search(
  start: Pt,
  goal: Pt,
  req: RouteRequest,
  g: number,
  clearance: number,
  bendCost: number,
  parallelCost: number,
  margin: number,
): Pt[] | null {
  const x0 = Math.floor((Math.min(start.x, goal.x) - margin) / g) * g
  const y0 = Math.floor((Math.min(start.y, goal.y) - margin) / g) * g
  const x1 = Math.ceil((Math.max(start.x, goal.x) + margin) / g) * g
  const y1 = Math.ceil((Math.max(start.y, goal.y) + margin) / g) * g
  const cols = (x1 - x0) / g + 1
  const rows = (y1 - y0) / g + 1
  if (cols * rows > MAX_CELLS) return null

  const blocked = new Uint8Array(cols * rows)
  for (const r of req.obstacles) {
    const ax = r.x - clearance, ay = r.y - clearance
    const bx = r.x + r.w + clearance, by = r.y + r.h + clearance
    if (bx < x0 || ax > x1 || by < y0 || ay > y1) continue
    const c0 = Math.max(0, Math.ceil((ax - x0) / g)), c1 = Math.min(cols - 1, Math.floor((bx - x0) / g))
    const r0 = Math.max(0, Math.ceil((ay - y0) / g)), r1 = Math.min(rows - 1, Math.floor((by - y0) / g))
    for (let row = r0; row <= r1; row++) blocked.fill(1, row * cols + c0, row * cols + c1 + 1)
  }

  const cellOf = (p: Pt) => ((p.y - y0) / g) * cols + (p.x - x0) / g
  const startCell = cellOf(start)
  const goalCell = cellOf(goal)
  if (blocked[startCell] || blocked[goalCell]) return null
  // Checked after the obstacle map, so a shared cell inside a part body is still refused.
  if (startCell === goalCell) return [start]

  // Copy the occupancy for this window once, row by row, so the inner loop reads one byte per edge.
  let parallel: Uint8Array | null = null
  if (req.occupied?.size) {
    parallel = new Uint8Array(cols * rows)
    req.occupied.copyWindow(x0, y0, cols, rows, g, parallel)
  }

  const gc = goalCell % cols
  const gr = Math.floor(goalCell / cols)
  // -1: a free goal (a hole) accepts any arrival heading.
  const endDir = req.toDir ? dirIndex({ x: -req.toDir.x, y: -req.toDir.y }) : -1
  const { cost, prev, closed, heap } = buffers(cols * rows * 4)

  // A pin starts along its stub; a free start (a hole) is seeded with all four headings.
  const seeds = req.fromDir ? [dirIndex(req.fromDir)] : [0, 1, 2, 3]
  const h0 = (Math.abs((startCell % cols) - gc) + Math.abs(Math.floor(startCell / cols) - gr)) * g
  for (const sd of seeds) {
    const s = startCell * 4 + sd
    cost[s] = 0
    prev[s] = -1 // the scratch back-pointers are not cleared; every other state on a path is written before it is read
    heap.push(s, h0)
  }
  let found = -1
  while (heap.size) {
    const state = heap.pop()
    if (closed[state]) continue
    closed[state] = 1
    const cell = state >> 2
    if (cell === goalCell) {
      found = state
      break
    }
    const d = state & 3
    const back = (d + 2) & 3
    const col = cell % cols
    const row = (cell - col) / cols
    const here = cost[state]
    // Neither the first step out of the start nor the last step into the goal is penalized,
    // so two pins 10 px apart can still be wired even when that shared cell is another wire's lane.
    // Only seed states cost 0 (every other state is at least one step in).
    const lanes = parallel !== null && !(here === 0 && cell === startCell)
    for (let nd = 0; nd < 4; nd++) {
      if (nd === back) continue
      const nc = col + STEP_X[nd]
      const nr = row + STEP_Y[nd]
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const ncell = nr * cols + nc
      if (blocked[ncell]) continue
      let c = here + g + (nd !== d ? bendCost : 0)
      if (ncell === goalCell) {
        if (endDir >= 0 && nd !== endDir) c += bendCost
      } else if (lanes && parallel![ncell] & (nd & 1 ? V_BIT : H_BIT)) c += parallelCost
      const ns = ncell * 4 + nd
      if (c < cost[ns]) {
        cost[ns] = c
        prev[ns] = state
        heap.push(ns, c + (Math.abs(nc - gc) + Math.abs(nr - gr)) * g)
      }
    }
  }
  if (found < 0) return null

  const cells: Pt[] = []
  for (let st = found; st >= 0; st = prev[st]) {
    const cell = st >> 2
    cells.push({ x: x0 + (cell % cols) * g, y: y0 + Math.floor(cell / cols) * g })
  }
  return cells.reverse()
}
