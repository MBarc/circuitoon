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
  /**
   * Points the route must not pass through (used holes of board strips the wire does not end in), each
   * blocking the grid node within `clearance` of it. Unlike an obstacle, one never refuses the
   * route's own start or goal node (a pin tip right beside a board), nor the first node along
   * either end's stub.
   */
  avoid?: Pt[]
  /**
   * More points to keep off, like `avoid`, read from shared indexes (built once per re-route) so
   * only the points inside the search window are visited; a point whose owner is in `skip` is
   * one this wire may cross (a hole of its own strip, its own part's caption). A node several
   * entries cover counts as the earliest one's. `refused.hit` is set when the search turned away
   * from a node because of that entry, so a caller retrying without it knows whether the retry
   * could turn out any different.
   */
  avoidIn?: { index: PointIndex; skip?: ReadonlySet<string>; refused?: { hit: boolean } }[]
  /** Grid nodes already used by earlier wires, so this route can take its own lane next to them. */
  occupied?: Occupancy
  /**
   * Grid nodes used by earlier wires of this wire's bundle (wires between the same two parts, Ruling
   * W1): a step that runs alongside one of them exactly two grid steps away costs less, so a bus is
   * drawn as a ribbon of parallel lanes.
   */
  bundle?: Occupancy
  /** Set when the route found lies along an earlier wire or a reserved lead-out run (it could not avoid it). */
  overlapped?: { hit: boolean }
  /**
   * Ends this wire shares with earlier wires (two into one terminal): near one of them it may lie
   * along an earlier wire, since wires into one terminal meet on its stub anyway.
   */
  shared?: Pt[]
  /** Every pin's lead-out run on the sheet: no other wire lies along one (strict, like `occupied`). */
  stubs?: Occupancy
  /**
   * Straight run, in px, a pin end must leave along `fromDir` (or arrive along `toDir`) before its
   * first bend, so a connector drawn there sits on one straight segment (see cables.ts). Ignored
   * for a hole end. Even from a tip off the grid, the jog onto the grid comes after this run.
   */
  fromLead?: number
  toLead?: number
}
export interface RouteOptions {
  grid?: number
  clearance?: number
  bendCost?: number
  /** Search windows around the endpoints, tried in order until one finds a route. */
  margins?: number[]
  /** Extra cost for a step onto a grid node another wire already runs along on the same axis. */
  parallelCost?: number
  /**
   * Extra cost for a step that runs alongside another wire one grid step away on the same axis, so
   * parallel wires keep two grid steps apart where there is room (a cost, never a block).
   */
  adjacentCost?: number
  /** Cost taken off a step that runs two grid steps beside a wire of its own bundle (see `bundle`). */
  bundleBonus?: number
}

/**
 * Points tagged with an owner key (a strip's holes, a part's caption), bucketed by row and sorted
 * by x within a row, so a query visits only the rows and the x range it asks for. Owners are kept
 * as small integers, so skipping a wire's own owners compares numbers, not strings. Points may be
 * added until the first query.
 */
export class PointIndex {
  // Every point added, in insertion order; the rows are rebuilt from them after an add.
  private px: number[] = []
  private py: number[] = []
  private po: number[] = []
  private ys: number[] = []
  private rows: { xs: number[]; owners: number[] }[] = []
  private ids = new Map<string, number>()
  private dirty = false
  private lastSkip: ReadonlySet<string> | undefined = undefined
  private lastIds: number[] = []

  add(x: number, y: number, owner: string): void {
    let id = this.ids.get(owner)
    if (id === undefined) {
      id = this.ids.size
      this.ids.set(owner, id)
    }
    this.px.push(x)
    this.py.push(y)
    this.po.push(id)
    this.dirty = true
  }

  /** The owner ids in `skip` that have points here (a wire asks with the same set many times). */
  private skipIds(skip: ReadonlySet<string> | undefined): number[] {
    if (skip === this.lastSkip) return this.lastIds
    const out: number[] = []
    if (skip) for (const k of skip) {
      const id = this.ids.get(k)
      if (id !== undefined) out.push(id)
    }
    this.lastSkip = skip
    this.lastIds = out
    return out
  }

  private build() {
    const { px, py, po } = this
    // Bucket by row, then sort each row by x (points usually arrive in order already).
    const byRow = new Map<number, number[]>()
    for (let i = 0; i < px.length; i++) {
      const list = byRow.get(py[i])
      if (list) list.push(i)
      else byRow.set(py[i], [i])
    }
    this.ys = [...byRow.keys()].sort((a, b) => a - b)
    this.rows = this.ys.map((y) => {
      const list = byRow.get(y)!
      if (list.some((i, k) => k > 0 && px[list[k - 1]] > px[i])) list.sort((a, b) => px[a] - px[b])
      return { xs: list.map((i) => px[i]), owners: list.map((i) => po[i]) }
    })
    this.dirty = false
  }

  /**
   * Calls `fn` with each point inside [x0, x1] x [y0, y1] whose owner is not in `skip`, until `fn`
   * returns true; returns whether it did.
   */
  some(x0: number, y0: number, x1: number, y1: number, skip: ReadonlySet<string> | undefined, fn: (x: number, y: number) => boolean): boolean {
    if (this.dirty) this.build()
    const ys = this.ys
    if (!ys.length) return false
    const sk = this.skipIds(skip)
    const [s0, s1, s2, s3] = [sk[0] ?? -1, sk[1] ?? -1, sk[2] ?? -1, sk[3] ?? -1]
    const more = sk.length > 4 ? new Set(sk.slice(4)) : null
    let lo = 0
    let hi = ys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ys[mid] < y0) lo = mid + 1
      else hi = mid
    }
    for (let r = lo; r < ys.length && ys[r] <= y1; r++) {
      const { xs, owners } = this.rows[r]
      let a = 0
      let b = xs.length
      while (a < b) {
        const mid = (a + b) >> 1
        if (xs[mid] < x0) a = mid + 1
        else b = mid
      }
      const y = ys[r]
      for (let i = a; i < xs.length && xs[i] <= x1; i++) {
        const o = owners[i]
        if (o === s0 || o === s1 || o === s2 || o === s3 || (more !== null && more.has(o))) continue
        if (fn(xs[i], y)) return true
      }
    }
    return false
  }
}

/** Marks in the search's node map: 1 is a part body; SOFT and above are avoided points. */
const SOFT = 2

/** Default gap kept between a routed wire and a part body, in px. */
export const CLEARANCE = 4

const H_BIT = 1
const V_BIT = 2
/** Default extra cost for a step along a grid line another wire already runs on (see RouteOptions.parallelCost). */
export const PARALLEL_COST = 40
/** Default extra cost for running beside another wire one grid step away (see RouteOptions.adjacentCost). */
export const ADJACENT_COST = 20
/** Extra cost of a step along an earlier wire (strict routing): a detour up to about this long is preferred. */
const OVERLAP_COST = 800
/** Grid cells around an end shared with earlier wires where this wire may lie along them (see RouteRequest.shared). */
const SHARED_REACH = 3
/** Default cost taken off a step two grid steps beside a wire of the same bundle (see RouteOptions.bundleBonus). */
export const BUNDLE_BONUS = 4

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
 * Runs longer than this many cells are kept as one interval instead of being marked cell by cell,
 * so adding a wire costs at most this much per segment however long the segment is.
 */
const LONG_RUN = 4096

/** A long run on one grid line: `at` is the row (horizontal, H_BIT) or column (vertical, V_BIT), `lo..hi` the cells it covers. */
interface Run {
  bit: number
  at: number
  lo: number
  hi: number
}

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
  /** Runs longer than LONG_RUN cells, kept whole rather than marked cell by cell. */
  runs: Run[] = []
  /** Number of occupied nodes, counting each long run as one; zero only when nothing is occupied. */
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
    let bits = 0
    if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) bits = this.cells[cy * this.cols + cx]
    else if (this.far.size) bits = this.far.get(packCell(x / g, y / g)) ?? 0
    for (const r of this.runs) {
      const [at, along] = r.bit === H_BIT ? [y / g, x / g] : [x / g, y / g]
      if (at === r.at && along >= r.lo && along <= r.hi) bits |= r.bit
    }
    return bits
  }

  /** Records a run longer than LONG_RUN cells as one interval. */
  addRun(bit: number, at: number, lo: number, hi: number) {
    this.runs.push({ bit, at, lo, hi })
    this.size++
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
    const cxLo = x0 / g
    const cyLo = y0 / g
    for (const [k, bits] of this.far) {
      const cy = (k % 2 ** 26) - CELL_LIMIT
      const cx = Math.floor(k / 2 ** 26) - CELL_LIMIT
      const c = cx - cxLo
      const r = cy - cyLo
      if (c >= 0 && r >= 0 && c < cols && r < rows) out[r * cols + c] |= bits
    }
    // Last: the dense copy above overwrites its rows, so long runs are ORed in after it.
    this.copyRuns(cxLo, cyLo, cols, rows, out)
  }

  /** ORs the long runs into a window whose top-left node is grid cell (cxLo, cyLo); each run costs at most one window row or column. */
  private copyRuns(cxLo: number, cyLo: number, cols: number, rows: number, out: Uint8Array) {
    for (const run of this.runs) {
      if (run.bit === H_BIT) {
        const r = run.at - cyLo
        if (r < 0 || r >= rows) continue
        const c0 = Math.max(0, run.lo - cxLo)
        const c1 = Math.min(cols - 1, run.hi - cxLo)
        for (let c = c0; c <= c1; c++) out[r * cols + c] |= H_BIT
      } else {
        const c = run.at - cxLo
        if (c < 0 || c >= cols) continue
        const r0 = Math.max(0, run.lo - cyLo)
        const r1 = Math.min(rows - 1, run.hi - cyLo)
        for (let r = r0; r <= r1; r++) out[r * cols + c] |= V_BIT
      }
    }
  }
}

/**
 * Adds one polyline's axis-aligned segments to `occ`. The work per segment is bounded (at most
 * LONG_RUN cells are marked; a longer run is kept as one interval), and coordinates are clamped to
 * the recordable range first, so a wire of any length or position (even a malformed one far off the
 * sheet, or at a size where stepping one cell no longer changes a float) finishes quickly.
 */
export function addToOccupancy(occ: Occupancy, polyline: Pt[]) {
  const g = occ.grid
  const clampCell = (v: number) => Math.min(CELL_LIMIT - 1, Math.max(1 - CELL_LIMIT, v))
  const add = (bit: number, at: number, a: number, b: number) => {
    // A run off the grid line (a pin tip between grid lines) holds no node the search visits.
    if (at % g !== 0 || !Number.isFinite(a) || !Number.isFinite(b)) return
    const line = at / g
    if (Math.abs(line) >= CELL_LIMIT) return
    const lo = clampCell(Math.ceil(Math.min(a, b) / g))
    const hi = clampCell(Math.floor(Math.max(a, b) / g))
    if (lo > hi) return
    if (hi - lo > LONG_RUN) return occ.addRun(bit, line, lo, hi)
    if (bit === H_BIT) occ.reserve(lo, line, hi, line)
    else occ.reserve(line, lo, line, hi)
    for (let c = lo; c <= hi; c++) {
      if (bit === H_BIT) occ.mark(c, line, H_BIT)
      else occ.mark(line, c, V_BIT)
    }
  }
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]
    const b = polyline[i]
    if (a.y === b.y) add(H_BIT, a.y, a.x, b.x)
    else if (a.x === b.x) add(V_BIT, a.x, a.y, b.y)
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
/** Search windows around the endpoints, in px, tried in order (the default `margins`). */
const MARGINS = [60, 240]
/** The widest default search window reaches this far, in px, past the box around both ends. */
export const SEARCH_MARGIN = Math.max(...MARGINS)
/** About how far apart, in px, a wire's ends may be for the router to search between them. */
export const ROUTE_REACH = Math.floor(Math.sqrt(MAX_CELLS)) * 10

/** Whether the smallest search window between `a` and `b` fits the router's grid, so a route can exist at all. */
export function withinReach(a: Pt, b: Pt, g = 10): boolean {
  const m = MARGINS[0]
  const cols = (Math.ceil((Math.max(a.x, b.x) + m) / g) - Math.floor((Math.min(a.x, b.x) - m) / g)) + 1
  const rows = (Math.ceil((Math.max(a.y, b.y) + m) / g) - Math.floor((Math.min(a.y, b.y) - m) / g)) + 1
  return cols * rows <= MAX_CELLS
}

const DIRS: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
const dirIndex = (d: Pt) => DIRS.findIndex((v) => v.x === d.x && v.y === d.y)

/** First grid point reached by stepping out of `p` along `d`. */
function leave(p: Pt, d: Pt, g: number): Pt {
  const snap = (v: number, s: number) =>
    s > 0 ? Math.ceil((v + 1) / g) * g : s < 0 ? Math.floor((v - 1) / g) * g : Math.round(v / g) * g
  return { x: snap(p.x, d.x), y: snap(p.y, d.y) }
}

/** Nearest grid point to `p` (a hole center is already on the grid); where a free end's search starts. */
export const onGrid = (p: Pt, g: number): Pt => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g })

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

/** Per-search window layers (lanes, lead-out runs, near shared ends, ribbon), reused and cleared, never reallocated per search. */
const layers: Uint8Array[] = []
function layer(i: number, n: number): Uint8Array {
  if (!layers[i] || layers[i].length < n) layers[i] = new Uint8Array(Math.max(n, (layers[i]?.length ?? 0) * 2))
  return layers[i].subarray(0, n).fill(0)
}

/** Column and row step for each heading in DIRS order (right, down, left, up). */
const STEP_X = [1, 0, -1, 0]
const STEP_Y = [0, 1, 0, -1]

export function routeOrthogonal(req: RouteRequest, opts: RouteOptions = {}): Pt[] | null {
  const g = opts.grid ?? 10
  const clearance = opts.clearance ?? CLEARANCE
  const bendCost = opts.bendCost ?? 30
  const parallelCost = opts.parallelCost ?? PARALLEL_COST
  const adjacentCost = opts.adjacentCost ?? ADJACENT_COST
  const bundleBonus = opts.bundleBonus ?? BUNDLE_BONUS
  // A lead-out moves the first grid node the search may bend at out along the pin's axis.
  const ahead = (p: Pt, d: Pt, lead = 0): Pt => ({ x: p.x + d.x * lead, y: p.y + d.y * lead })
  const start = req.fromDir ? leave(ahead(req.from, req.fromDir, req.fromLead), req.fromDir, g) : onGrid(req.from, g)
  const goal = req.toDir ? leave(ahead(req.to, req.toDir, req.toLead), req.toDir, g) : onGrid(req.to, g)
  // Ruling W1: a route never runs along a grid edge an earlier wire runs along (two wires on top of
  // each other cannot be traced); only when no route avoids that is one allowed, at a cost.
  const strict = !!req.occupied?.size || !!req.stubs?.size
  for (const margin of opts.margins ?? MARGINS) {
    const hit = { hit: false }
    const found = search(start, goal, req, g, clearance, bendCost, parallelCost, adjacentCost, bundleBonus, margin, strict, hit)
    // A route along an earlier wire is taken from the first window that finds any route (its cost
    // already prefers any detour inside it); a wider window would cost far more to search.
    const path = found
    if (path) {
      if (req.overlapped) req.overlapped.hit = hit.hit
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
  adjacentCost: number,
  bundleBonus: number,
  margin: number,
  strict = false,
  overlapped: { hit: boolean } = { hit: false },
): Pt[] | null {
  /** A step along an earlier wire costs as much as a long detour: taken only when none is near. */
  const overlapCost = OVERLAP_COST
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
  if (req.avoid?.length || req.avoidIn?.length) {
    // The start, the goal and each stub's first node past them are never refused: a pin whose
    // stub points into a strip must still be able to leave along it.
    const inWindow = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    const exempt = new Set([startCell, goalCell])
    for (const [p, d] of [[start, req.fromDir], [goal, req.toDir]] as [Pt, Pt | null][]) {
      const n = d && { x: p.x + d.x * g, y: p.y + d.y * g }
      if (n && inWindow(n)) exempt.add(cellOf(n))
    }
    // Soft nodes are marked SOFT (from `avoid`) or SOFT + 1 + i (from avoidIn[i]), never over a
    // body (1) or an earlier mark.
    const [e0, e1, e2, e3] = [...exempt, -1, -1, -1]
    let mark = SOFT
    const consider = (px: number, py: number) => {
      const nx = Math.round(px / g) * g
      const ny = Math.round(py / g) * g
      if (Math.abs(nx - px) > clearance || Math.abs(ny - py) > clearance || nx < x0 || nx > x1 || ny < y0 || ny > y1) return false
      const cell = ((ny - y0) / g) * cols + (nx - x0) / g
      if (!blocked[cell] && cell !== e0 && cell !== e1 && cell !== e2 && cell !== e3) blocked[cell] = mark
      return false
    }
    for (const p of req.avoid ?? []) consider(p.x, p.y)
    // A point snaps to a node at most half a grid step away, so one a grid step outside the window
    // can never land in it.
    for (const [i, { index, skip }] of (req.avoidIn ?? []).entries()) {
      mark = Math.min(255, SOFT + 1 + i)
      index.some(x0 - g, y0 - g, x1 + g, y1 + g, skip, consider)
    }
  }
  const sinks = (req.avoidIn ?? []).map((e) => e.refused)
  if (blocked[startCell] || blocked[goalCell]) return null
  // Checked after the obstacle map, so a shared cell inside a part body is still refused.
  if (startCell === goalCell) return [start]

  // Copy the occupancy for this window once, row by row, so the inner loop reads one byte per edge.
  let parallel: Uint8Array | null = null
  if (req.occupied?.size) {
    parallel = layer(0, cols * rows)
    req.occupied.copyWindow(x0, y0, cols, rows, g, parallel)
  }
  // The lanes refused outright (strict): everywhere but near an end shared with earlier wires.
  const solid = parallel
  let stubs: Uint8Array | null = null
  if (strict && req.stubs?.size) {
    stubs = layer(1, cols * rows)
    req.stubs.copyWindow(x0, y0, cols, rows, g, stubs)
  }
  let near: Uint8Array | null = null
  if (strict && req.shared?.length) {
    near = layer(2, cols * rows)
    for (const p of req.shared) {
      const pc = Math.round((p.x - x0) / g)
      const pr = Math.round((p.y - y0) / g)
      for (let r = Math.max(0, pr - SHARED_REACH); r <= Math.min(rows - 1, pr + SHARED_REACH); r++)
        for (let c = Math.max(0, pc - SHARED_REACH); c <= Math.min(cols - 1, pc + SHARED_REACH); c++) near[r * cols + c] = 1
    }
  }
  let ribbon: Uint8Array | null = null
  if (req.bundle?.size && bundleBonus) {
    ribbon = layer(3, cols * rows)
    req.bundle.copyWindow(x0, y0, cols, rows, g, ribbon)
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
      const bl = blocked[ncell]
      if (bl) {
        if (bl > SOFT) {
          const sink = sinks[bl - SOFT - 1]
          if (sink) sink.hit = true
        }
        continue
      }
      // Strict: a step with both ends on an earlier wire's line, or on a pin's lead-out run, in the
      // step's own direction (the two would lie on top of each other) is taken only when nothing else
      // reaches the goal, but near a shared end: it costs more than any detour the window holds.
      let c = here + g + (nd !== d ? bendCost : 0)
      if (strict) {
        const sb = nd & 1 ? V_BIT : H_BIT
        if (((solid && solid[ncell] & solid[cell] & sb) || (stubs && stubs[ncell] & stubs[cell] & sb)) && !(near && near[ncell])) c += overlapCost
      }
      if (ncell === goalCell) {
        // Behind a lead-out the wire must arrive along it, or it would double back over it.
        if (endDir >= 0 && nd !== endDir && req.toLead) continue
        if (endDir >= 0 && nd !== endDir) c += bendCost
      } else if (lanes) {
        const lane = parallel!
        const bit = nd & 1 ? V_BIT : H_BIT
        if (lane[ncell] & bit) {
          // Both ends of this step on an earlier wire's line: the two would lie on top of each other.
          c += parallelCost
        }
        // Beside a lane: a vertical run in the column left or right, a horizontal one on the row above or below.
        else if (adjacentCost && (nd & 1
          ? (nc > 0 && lane[ncell - 1] & V_BIT) || (nc + 1 < cols && lane[ncell + 1] & V_BIT)
          : (nr > 0 && lane[ncell - cols] & H_BIT) || (nr + 1 < rows && lane[ncell + cols] & H_BIT))) c += adjacentCost
        // Two steps beside a wire of its own bundle, on the same axis: the next lane of a ribbon.
        else if (ribbon !== null && (nd & 1
          ? (nc > 1 && ribbon[ncell - 2] & V_BIT) || (nc + 2 < cols && ribbon[ncell + 2] & V_BIT)
          : (nr > 1 && ribbon[ncell - 2 * cols] & H_BIT) || (nr + 2 < rows && ribbon[ncell + 2 * cols] & H_BIT))) c -= bundleBonus
      }
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
  const path = cells.reverse()
  if (strict) {
    // Whether the path took such a step after all.
    const at = (p: Pt) => ((p.y - y0) / g) * cols + (p.x - x0) / g
    for (let k = 1; k < path.length && !overlapped.hit; k++) {
      const [u, v] = [at(path[k - 1]), at(path[k])]
      const sb = path[k - 1].y === path[k].y ? H_BIT : V_BIT
      if (((solid && solid[u] & solid[v] & sb) || (stubs && stubs[u] & stubs[v] & sb)) && !(near && near[v])) overlapped.hit = true
    }
  }
  return path
}
