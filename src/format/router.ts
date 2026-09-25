// Orthogonal wire router: A* over a 10 px grid, with a penalty per bend so wires stay tidy.
// The search state is (cell, heading); reversing is not allowed. Obstacles are part bodies
// grown by a small clearance. The first and last steps leave and enter pins along their stub.
import { type Pt, type Rect, simplify } from './geometry.ts'

export interface RouteRequest {
  from: Pt
  fromDir: Pt
  to: Pt
  toDir: Pt
  obstacles: Rect[]
}
export interface RouteOptions {
  grid?: number
  clearance?: number
  bendCost?: number
  /** Search windows around the endpoints, tried in order until one finds a route. */
  margins?: number[]
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

class MinHeap {
  private pri: number[] = []
  private val: number[] = []
  get size() {
    return this.val.length
  }
  push(v: number, p: number) {
    let i = this.val.length
    this.val.push(v)
    this.pri.push(p)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.pri[parent] <= p) break
      this.val[i] = this.val[parent]
      this.pri[i] = this.pri[parent]
      i = parent
    }
    this.val[i] = v
    this.pri[i] = p
  }
  pop(): number {
    const top = this.val[0]
    const lastV = this.val.pop()!
    const lastP = this.pri.pop()!
    const n = this.val.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && this.pri[r] < this.pri[l] ? r : l
        if (this.pri[c] >= lastP) break
        this.val[i] = this.val[c]
        this.pri[i] = this.pri[c]
        i = c
      }
      this.val[i] = lastV
      this.pri[i] = lastP
    }
    return top
  }
}

export function routeOrthogonal(req: RouteRequest, opts: RouteOptions = {}): Pt[] | null {
  const g = opts.grid ?? 10
  const clearance = opts.clearance ?? 4
  const bendCost = opts.bendCost ?? 30
  const start = leave(req.from, req.fromDir, g)
  const goal = leave(req.to, req.toDir, g)
  for (const margin of opts.margins ?? [60, 240]) {
    const path = search(start, goal, req, g, clearance, bendCost, margin)
    if (path) return simplify([req.from, ...path, req.to])
  }
  return null
}

function search(start: Pt, goal: Pt, req: RouteRequest, g: number, clearance: number, bendCost: number, margin: number): Pt[] | null {
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

  const gc = goalCell % cols
  const gr = Math.floor(goalCell / cols)
  const endDir = dirIndex({ x: -req.toDir.x, y: -req.toDir.y })
  const n = cols * rows * 4
  const cost = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const heap = new MinHeap()
  const h = (cell: number) => (Math.abs((cell % cols) - gc) + Math.abs(Math.floor(cell / cols) - gr)) * g

  const s = startCell * 4 + dirIndex(req.fromDir)
  cost[s] = 0
  heap.push(s, h(startCell))
  let found = -1
  while (heap.size) {
    const state = heap.pop()
    if (closed[state]) continue
    closed[state] = 1
    const cell = state >> 2
    const d = state & 3
    if (cell === goalCell) {
      found = state
      break
    }
    const col = cell % cols
    const row = (cell - col) / cols
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue
      const nc = col + DIRS[nd].x
      const nr = row + DIRS[nd].y
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const ncell = nr * cols + nc
      if (blocked[ncell]) continue
      let c = cost[state] + g + (nd !== d ? bendCost : 0)
      if (ncell === goalCell && nd !== endDir) c += bendCost
      const ns = ncell * 4 + nd
      if (c < cost[ns]) {
        cost[ns] = c
        prev[ns] = state
        heap.push(ns, c + h(ncell))
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
