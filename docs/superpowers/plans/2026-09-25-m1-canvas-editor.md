# M1 Canvas Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working browser editor at `#/editor` that opens on a start screen (new diagram, open a file, or try the sample), where you drag parts from the library onto a graph-paper canvas, wire pin to pin, move and rotate parts while wires re-route around bodies, edit wire color and gauge, undo and redo, and import or export the diagram JSON.

**Architecture:** Pure, tested logic lives in `src/format/` (geometry, router, diagram validation) and `src/editor/ops.ts` (immutable diagram edits). `src/editor/store.ts` holds the editor state with undo history and exposes it to React through `useSyncExternalStore`. React components in `src/editor/` render SVG and translate pointer events into ops. The router is a grid A* search with a bend penalty; wires attached to a dragged part re-route live, everything else re-routes on drop.

**Tech Stack:** Vite 8, React 19, TypeScript 7, vitest 5, SVG. No new runtime dependencies.

**Spec:** `docs/PRD.md` (sections "V1 canvas and interaction", "Diagram format", "Module definition format"). The living copy is https://claude.ai/code/artifact/5333f69b-af12-49ba-975f-2721100a5d97.

## Global Constraints

- Grid unit is 10 px at 100% zoom; parts snap to it; pin pitch is 10 px; pin stubs stick out 8 px (`LEAD`).
- Art style is Sticker: flat fills, ink outline `#23282F`, graph-paper sheet `var(--paper)` / `var(--grid)`.
- Site is served from `/circuitoon/`; use relative or hash URLs only (`#/editor`), never absolute `/editor`.
- No em dashes in any UI copy, code comments or docs; use commas, colons or hyphens.
- Wire color is a named color (`red, black, blue, green, yellow, orange, white, purple, gray, brown, pink`) or `#RRGGBB`; gauge is AWG integer 16 to 30, default 22.
- Connections reference part `uid`s, never designators. `uid`s are unique across parts, connections and annotations.
- TypeScript must stay erasable-only (`erasableSyntaxOnly`): no enums, no parameter properties, no namespaces.
- Every task ends with `npm test` and `npm run build` passing.
- Deploy only in the final task, with `npm run deploy`.

## Out of scope for M1 (later plans)

Autosave and the home screen (IndexedDB), manual wire editing gestures and stored bends from the canvas, hop-aware net highlighting and power conflict warnings, broken-reference red stubs and problems panel, art studio, PDF export, copy/paste, box select, text labels and frames.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/format/geometry.ts` (create) | Points, rects, rotation about the grid pivot, world pin positions, body rect, polyline simplify |
| `src/format/router.ts` (create) | Grid A* orthogonal router with bend penalty and obstacle avoidance |
| `src/format/module.ts` (modify) | Export `isObj`/`isNum`; memoize `layoutModule` |
| `src/format/diagram.ts` (modify) | Types incl. annotations, `computeRoutes`, `wirePaths` using the router, `validateDiagram`, `serializeDiagram`, `emptyDiagram`, `isValidColor` |
| `src/render/Part.tsx` (modify) | Rotation support; caption below the rotated body |
| `src/render/Sheet.tsx` (modify) | Uses the new `wirePaths` result; dashed style for blocked wires |
| `src/editor/ops.ts` (create) | Immutable edits: add/move/rotate/delete parts, add/update wires, uid and designator allocation |
| `src/editor/store.ts` (create) | `EditorStore` (state, selection, wire style, undo/redo, drag transactions) and `useEditorState` |
| `src/editor/Editor.tsx` (create) | Editor page layout and keyboard shortcuts |
| `src/editor/Canvas.tsx` (create) | SVG canvas: pan/zoom, part drag, wire drawing, selection, drop from library |
| `src/editor/LibraryPanel.tsx` (create) | Draggable, clickable list of built-in parts |
| `src/editor/Inspector.tsx` (create) | Properties of the selection: designator, rotation, wire color/gauge/label |
| `src/editor/files.ts` (create) | Read and validate a picked or dropped diagram file; download helper; export file name |
| `src/editor/StartScreen.tsx` (create) | Start screen: new diagram, open a file (picker or drop), try the sample |
| `src/editor/EditorApp.tsx` (create) | Holds the open document; shows the start screen until one is chosen |
| `src/editor/Toolbar.tsx` (create) | Title, undo/redo, rotate, delete, new, import, export |
| `src/editor/editor.css` (create) | Editor layout and control styles |
| `src/Landing.tsx` (create, moved from `App.tsx`) | Current landing page plus "Open the editor" link |
| `src/App.tsx` (modify) | Hash router between landing and editor |
| Tests: `src/format/geometry.test.ts`, `src/format/router.test.ts`, `src/format/diagram.test.ts` (modify), `src/format/diagramIO.test.ts`, `src/editor/ops.test.ts`, `src/editor/store.test.ts`, `src/editor/files.test.ts` | |

---

### Task 1: Rotation-aware geometry and rendering

**Files:**
- Create: `src/format/geometry.ts`, `src/format/geometry.test.ts`
- Modify: `src/format/module.ts` (export helpers, memoize layout), `src/render/Part.tsx`

**Interfaces:**
- Produces:
  - `type Pt = { x: number; y: number }`, `type Rect = { x: number; y: number; w: number; h: number }`, `type Rotation = 0 | 90 | 180 | 270`
  - `pivot(w: number, h: number): Pt` - rotation center, the grid point at or up-left of the body center
  - `rotateVec(v: Pt, rot: Rotation): Pt` - clockwise on screen
  - `toWorld(part: Placement, lay: { w: number; h: number }, local: Pt): Pt` where `type Placement = { x: number; y: number; rotation?: Rotation }`
  - `bodyRect(part: Placement, lay: { w: number; h: number }): Rect`
  - `interface WorldPin { name: string; label?: string; type: PinType; end: Pt; edge: Pt; dir: Pt; bus?: { length: number } }`
  - `worldPins(part: Placement, m: ModuleDef): WorldPin[]`
  - `simplify(pts: Pt[]): Pt[]` - drops repeated and collinear middle points
  - `module.ts` now exports `isObj(v): v is Record<string, unknown>` and `isNum(v): v is number`
  - `Part` component gains prop `rotation?: Rotation`

Rotation note for the PRD: rotating about the exact body center would move pins off the 10 px grid for odd-unit bodies, so rotation is about `pivot()`, the grid point at or up-left of the center. Pins stay on grid. Task 10 updates the PRD sentence.

- [ ] **Step 1: Write the failing tests** in `src/format/geometry.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { bodyRect, pivot, rotateVec, simplify, toWorld, worldPins } from './geometry.ts'
import type { ModuleDef } from './module.ts'

const two: ModuleDef = {
  format: 'circuitoon-module/1', id: 'two', name: 'Two',
  pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }],
}

describe('rotation', () => {
  it('pivots on the grid point at or up-left of the body center', () => {
    expect(pivot(60, 40)).toEqual({ x: 30, y: 20 })
    expect(pivot(50, 30)).toEqual({ x: 20, y: 10 })
  })
  it('rotates clockwise on screen', () => {
    expect(rotateVec({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: 10 })
    expect(rotateVec({ x: 10, y: 0 }, 180)).toEqual({ x: -10, y: 0 })
    expect(rotateVec({ x: 10, y: 0 }, 270)).toEqual({ x: 0, y: -10 })
  })
  it('maps local points to world points through the pivot', () => {
    // body 40 x 30, pivot (20, 10); local (40, 20) is 20 right, 10 down of the pivot
    expect(toWorld({ x: 100, y: 100 }, { w: 40, h: 30 }, { x: 40, y: 20 })).toEqual({ x: 140, y: 120 })
    expect(toWorld({ x: 100, y: 100, rotation: 90 }, { w: 40, h: 30 }, { x: 40, y: 20 })).toEqual({ x: 110, y: 130 })
  })
  it('swaps the body rect on quarter turns', () => {
    expect(bodyRect({ x: 0, y: 0 }, { w: 40, h: 30 })).toEqual({ x: 0, y: 0, w: 40, h: 30 })
    // pivot (20, 10): x spans -20..20 and y spans -10..20 around it; a quarter turn maps that to x -20..10, y -20..20
    expect(bodyRect({ x: 0, y: 0, rotation: 90 }, { w: 40, h: 30 })).toEqual({ x: 0, y: -10, w: 30, h: 40 })
  })
  it('keeps pins on the grid and turns their direction', () => {
    const [l, r] = worldPins({ x: 100, y: 100, rotation: 90 }, two)
    // L edge is local (0, 20): 20 left and 10 below the pivot (20, 10); turned, 10 left and 20 above
    expect(l.edge).toEqual({ x: 110, y: 90 })
    expect(l.dir).toEqual({ x: 0, y: -1 })
    expect(l.end).toEqual({ x: 110, y: 82 })
    expect(r.dir).toEqual({ x: 0, y: 1 })
    for (const p of [l, r]) expect([p.edge.x % 10, p.edge.y % 10]).toEqual([0, 0])
  })
})

describe('simplify', () => {
  it('drops repeated and collinear points', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/format/geometry.test.ts`
Expected: FAIL, "Failed to resolve import ./geometry.ts"

- [ ] **Step 3: Implement `src/format/geometry.ts`**

```ts
// Shared 2D geometry: rotation about the grid pivot, world pin positions, polyline cleanup.
import { GRID, type ModuleDef, type PinType, layoutModule } from './module.ts'

export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Rotation = 0 | 90 | 180 | 270
export type Placement = { x: number; y: number; rotation?: Rotation }

// Adding 0 turns -0 into 0, so results compare cleanly.
const z = (n: number) => n + 0

/** Rotation center: the grid point at or up-left of the body center, so pins stay on grid. */
export function pivot(w: number, h: number): Pt {
  return { x: Math.floor(w / 2 / GRID) * GRID, y: Math.floor(h / 2 / GRID) * GRID }
}

/** Rotates a vector clockwise on screen (y points down). */
export function rotateVec(v: Pt, rot: Rotation): Pt {
  switch (rot) {
    case 90: return { x: z(-v.y), y: z(v.x) }
    case 180: return { x: z(-v.x), y: z(-v.y) }
    case 270: return { x: z(v.y), y: z(-v.x) }
    default: return { x: z(v.x), y: z(v.y) }
  }
}

export function toWorld(part: Placement, lay: { w: number; h: number }, local: Pt): Pt {
  const c = pivot(lay.w, lay.h)
  const r = rotateVec({ x: local.x - c.x, y: local.y - c.y }, part.rotation ?? 0)
  return { x: part.x + c.x + r.x, y: part.y + c.y + r.y }
}

export function bodyRect(part: Placement, lay: { w: number; h: number }): Rect {
  const a = toWorld(part, lay, { x: 0, y: 0 })
  const b = toWorld(part, lay, { x: lay.w, y: lay.h })
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export interface WorldPin {
  name: string
  label?: string
  type: PinType
  edge: Pt
  end: Pt
  dir: Pt
  bus?: { length: number }
}

export function worldPins(part: Placement, m: ModuleDef): WorldPin[] {
  const lay = layoutModule(m)
  const rot = part.rotation ?? 0
  return lay.pins.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    edge: toWorld(part, lay, p.edge),
    end: toWorld(part, lay, p.end),
    dir: rotateVec(p.dir, rot),
    bus: p.bus,
  }))
}

/** Removes repeated points and the middle point of any three collinear axis-aligned points. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && q.x === p.x && q.y === p.y) continue
    const r = out[out.length - 2]
    if (q && r && ((r.x === q.x && q.x === p.x) || (r.y === q.y && q.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}
```

- [ ] **Step 4: Export helpers and memoize layout in `src/format/module.ts`**

Change the two helper declarations to exported:

```ts
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
```

Rename the existing `export function layoutModule(m: ModuleDef): ModuleLayout {` to `function computeLayout(m: ModuleDef): ModuleLayout {` (keep its body and doc comment unchanged), and add below it:

```ts
// Modules are never mutated after load, so layouts can be cached by object identity.
const layoutCache = new WeakMap<ModuleDef, ModuleLayout>()

export function layoutModule(m: ModuleDef): ModuleLayout {
  let lay = layoutCache.get(m)
  if (!lay) layoutCache.set(m, (lay = computeLayout(m)))
  return lay
}
```

- [ ] **Step 5: Add rotation to `src/render/Part.tsx`**

Add imports at the top:

```ts
import { bodyRect, pivot, worldPins, type Rotation } from '../format/geometry.ts'
```

Replace the `Part` function signature and its outer structure so the body rotates and the caption sits under the rotated body. The full new function:

```tsx
export function Part({ module: m, x = 0, y = 0, rotation = 0, caption }: {
  module: ModuleDef
  x?: number
  y?: number
  rotation?: Rotation
  caption?: string
}) {
  const lay = layoutModule(m)
  const art = m.art
  const ax = art ? (lay.w - art.w) / 2 : 0
  const ay = art ? (lay.h - art.h) / 2 : 0
  const c = pivot(lay.w, lay.h)
  // Caption goes under the rotated body, below any pin stubs that now point down.
  const box = bodyRect({ x: 0, y: 0, rotation }, lay)
  const stubsDown = worldPins({ x: 0, y: 0, rotation }, m).some((p) => p.dir.y > 0)
  const captionY = box.y + box.h + (stubsDown ? LEAD : 0) + 15
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform={rotation ? `rotate(${rotation} ${c.x} ${c.y})` : undefined}>
        {lay.pins.map((p) => <PinStub key={p.name} p={p} />)}
        {art ? (
          <g transform={`translate(${ax} ${ay})`}>
            {art.shapes.map((s, i) => (
              <g key={i}>
                <rect
                  x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius ?? 0}
                  fill={s.fill}
                  stroke={s.outline === false ? 'none' : INK}
                  strokeWidth={OUTLINE}
                />
                {s.label && (
                  <text
                    x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize={s.labelSize ?? 8} fontWeight={700} fill={s.labelColor ?? INK}
                  >
                    {s.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        ) : (
          <>
            <rect width={lay.w} height={lay.h} rx={4} fill="#DDE7E1" stroke={INK} strokeWidth={OUTLINE} />
            <text x={lay.w / 2} y={lay.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill={INK}>
              {m.name}
            </text>
          </>
        )}
        {lay.pins.filter((p) => showLabel(m, p)).map((p) => <PinLabel key={p.name} p={p} w={lay.w} h={lay.h} outside={!!art} />)}
      </g>
      {caption && (
        <text x={box.x + box.w / 2} y={captionY} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={INK}>
          {caption}
        </text>
      )}
    </g>
  )
}
```

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests PASS (existing 13 plus 6 new), build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/format/geometry.ts src/format/geometry.test.ts src/format/module.ts src/render/Part.tsx
git commit -m "Add rotation-aware geometry; parts render rotated with upright captions"
```

---

### Task 2: Grid A* orthogonal router

**Files:**
- Create: `src/format/router.ts`, `src/format/router.test.ts`

**Interfaces:**
- Consumes: `Pt`, `Rect`, `simplify` from `geometry.ts`
- Produces:
  - `interface RouteRequest { from: Pt; fromDir: Pt; to: Pt; toDir: Pt; obstacles: Rect[] }`
  - `interface RouteOptions { grid?: number; clearance?: number; bendCost?: number; margins?: number[] }`
  - `routeOrthogonal(req: RouteRequest, opts?: RouteOptions): Pt[] | null` - full polyline from `from` to `to`, orthogonal, simplified; `null` when no route exists inside the largest margin

- [ ] **Step 1: Write the failing tests** in `src/format/router.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { routeOrthogonal } from './router.ts'
import type { Pt, Rect } from './geometry.ts'

const right = { x: 1, y: 0 }
const left = { x: -1, y: 0 }
const up = { x: 0, y: -1 }

function orthogonal(pts: Pt[]) {
  return pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)
}
function crosses(pts: Pt[], r: Rect) {
  // Samples every segment each pixel and checks for points strictly inside the rect.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true
    }
  }
  return false
}

describe('routeOrthogonal', () => {
  it('draws a straight wire between facing pins', () => {
    expect(routeOrthogonal({ from: { x: 48, y: 20 }, fromDir: right, to: { x: 92, y: 20 }, toDir: left, obstacles: [] }))
      .toEqual([{ x: 48, y: 20 }, { x: 92, y: 20 }])
  })
  it('goes around an obstacle, orthogonally, without entering it', () => {
    const wall: Rect = { x: 60, y: -40, w: 20, h: 100 }
    const pts = routeOrthogonal({ from: { x: 48, y: 20 }, fromDir: right, to: { x: 132, y: 20 }, toDir: left, obstacles: [wall] })!
    expect(pts).not.toBeNull()
    expect(orthogonal(pts)).toBe(true)
    expect(crosses(pts, wall)).toBe(false)
    expect(pts[0]).toEqual({ x: 48, y: 20 })
    expect(pts[pts.length - 1]).toEqual({ x: 132, y: 20 })
  })
  it('prefers fewer bends over a slightly shorter path', () => {
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 100, y: 58 }, toDir: up, obstacles: [] })!
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 58 }])
  })
  it('returns null when the target is walled in', () => {
    const box: Rect[] = [
      { x: 180, y: -60, w: 120, h: 20 }, { x: 180, y: 80, w: 120, h: 20 },
      { x: 180, y: -60, w: 20, h: 160 }, { x: 280, y: -60, w: 20, h: 160 },
    ]
    expect(routeOrthogonal({ from: { x: 0, y: 20 }, fromDir: right, to: { x: 232, y: 20 }, toDir: right, obstacles: box }, { margins: [60] })).toBeNull()
  })
  it('routes 20 wires across a 200-part sheet quickly', () => {
    const parts: Rect[] = []
    for (let r = 0; r < 10; r++) for (let c = 0; c < 20; c++) parts.push({ x: c * 100, y: r * 100, w: 60, h: 40 })
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) {
      const pts = routeOrthogonal({
        from: { x: 68, y: 20 + (i % 10) * 100 }, fromDir: right,
        to: { x: 1492 - (i % 5) * 100, y: 920 - (i % 10) * 100 }, toDir: left, obstacles: parts,
      })
      expect(pts).not.toBeNull()
    }
    expect(performance.now() - t0).toBeLessThan(400)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/format/router.test.ts`
Expected: FAIL, "Failed to resolve import ./router.ts"

- [ ] **Step 3: Implement `src/format/router.ts`**

```ts
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
  if (start.x === goal.x && start.y === goal.y) return [start]
  const x0 = Math.floor((Math.min(start.x, goal.x) - margin) / g) * g
  const y0 = Math.floor((Math.min(start.y, goal.y) - margin) / g) * g
  const x1 = Math.ceil((Math.max(start.x, goal.x) + margin) / g) * g
  const y1 = Math.ceil((Math.max(start.y, goal.y) + margin) / g) * g
  const cols = (x1 - x0) / g + 1
  const rows = (y1 - y0) / g + 1

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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/format/router.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/router.ts src/format/router.test.ts
git commit -m "Add grid A* orthogonal wire router with bend penalty"
```

---

### Task 3: Route wires through the router

**Files:**
- Modify: `src/format/diagram.ts`, `src/format/diagram.test.ts`, `src/render/Sheet.tsx`

**Interfaces:**
- Consumes: `worldPins`, `bodyRect`, `Pt`, `Rect`, `Rotation`, `simplify` (Task 1); `routeOrthogonal` (Task 2)
- Produces:
  - `PartInstance.rotation?: Rotation` (type now from `geometry.ts`)
  - `interface Annotation { uid: string; type: 'frame' | 'text'; x: number; y: number; w?: number; h?: number; label?: string; text?: string }` and `Diagram.annotations?: Annotation[]`
  - `interface WireRoute { points: Pt[]; blocked: boolean }` and `type Routes = Map<string, WireRoute | null>` (`null` = broken reference)
  - `partObstacles(d: Diagram): Rect[]`
  - `routeWire(d: Diagram, c: Connection, obstacles: Rect[]): WireRoute | null`
  - `computeRoutes(d: Diagram, opts?: { only?: Set<string>; prev?: Routes }): Routes`
  - `wirePaths(d: Diagram, routes?: Routes): { conn: Connection; d: string; ends: Pt[]; blocked: boolean }[]`
  - Removed: `wirePoints` (replaced by `routeWire`)

- [ ] **Step 1: Add the failing tests** to `src/format/diagram.test.ts`

Change the import line to:

```ts
import { computeRoutes, wireColor, wireWidth, wirePaths, type Diagram } from './diagram.ts'
```

Append inside `describe('wirePaths', ...)`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/format/diagram.test.ts`
Expected: FAIL, "computeRoutes is not exported" (or not a function).

- [ ] **Step 3: Rewrite the geometry half of `src/format/diagram.ts`**

Replace the imports and everything from `type Pt = { x: number; y: number }` down to the end of the file (keep `DIAGRAM_FORMAT`, the interfaces, `NAMED_COLORS`, `wireColor`, `wireWidth`). New imports at the top:

```ts
import { type ModuleDef, layoutModule } from './module.ts'
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from './geometry.ts'
import { routeOrthogonal } from './router.ts'
```

Change `PartInstance.rotation` to `rotation?: Rotation`, add the annotation type and field:

```ts
export interface Annotation {
  uid: string
  type: 'frame' | 'text'
  x: number
  y: number
  w?: number
  h?: number
  label?: string
  text?: string
}
```

and in `Diagram` add `annotations?: Annotation[]`.

Then the routing code:

```ts
export interface WireRoute {
  points: Pt[]
  /** True when no clear route exists and the wire is drawn as a straight fallback. */
  blocked: boolean
}
/** Route per connection uid; null means an endpoint names a missing part or pin. */
export type Routes = Map<string, WireRoute | null>

export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = d.modules[p.module]
    return m ? [bodyRect(p, layoutModule(m))] : []
  })
}

function endpoint(d: Diagram, ep: Endpoint) {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && d.modules[part.module]
  return (part && mod && worldPins(part, mod).find((p) => p.name === ep.pin)) || null
}

export function routeWire(d: Diagram, c: Connection, obstacles: Rect[]): WireRoute | null {
  const a = endpoint(d, c.from)
  const b = endpoint(d, c.to)
  if (!a || !b) return null
  if (c.route) return { points: [a.end, ...c.route.map(([x, y]) => ({ x, y })), b.end], blocked: false }
  const points = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles })
  return points ? { points, blocked: false } : { points: [a.end, b.end], blocked: true }
}

/**
 * Routes every connection. With `only`, connections outside the set keep their route from
 * `prev` (used while dragging so only the moving part's wires are re-routed each frame).
 */
export function computeRoutes(d: Diagram, opts: { only?: Set<string>; prev?: Routes } = {}): Routes {
  const obstacles = partObstacles(d)
  const out: Routes = new Map()
  for (const c of d.connections) {
    if (opts.only && !opts.only.has(c.uid) && opts.prev?.has(c.uid)) out.set(c.uid, opts.prev.get(c.uid)!)
    else out.set(c.uid, routeWire(d, c, obstacles))
  }
  return out
}

const HOP = 5

/**
 * SVG path data for each routed wire. Where a wire crosses a wire earlier in the file, the
 * later one gets a small hop arc, as in hand-drawn wiring sheets.
 */
export function wirePaths(d: Diagram, routes: Routes = computeRoutes(d)) {
  const drawn: Pt[][] = []
  const out: { conn: Connection; d: string; ends: Pt[]; blocked: boolean }[] = []
  for (const conn of d.connections) {
    const route = routes.get(conn.uid)
    if (!route) continue
    const pts = route.points
    let path = `M${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i - 1]
      const e = pts[i]
      const horiz = s.y === e.y
      const vert = s.x === e.x
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const hits: number[] = []
      if (horiz !== vert)
        for (const other of drawn)
          for (let j = 1; j < other.length; j++) {
            const os = other[j - 1]
            const oe = other[j]
            if (horiz && os.x === oe.x) {
              const within = os.x - Math.min(s.x, e.x) > HOP && Math.max(s.x, e.x) - os.x > HOP
              if (within && s.y > Math.min(os.y, oe.y) && s.y < Math.max(os.y, oe.y)) hits.push(os.x)
            } else if (vert && os.y === oe.y) {
              const within = os.y - Math.min(s.y, e.y) > HOP && Math.max(s.y, e.y) - os.y > HOP
              if (within && s.x > Math.min(os.x, oe.x) && s.x < Math.max(os.x, oe.x)) hits.push(os.y)
            }
          }
      hits.sort((p, q) => (p - q) * dir)
      for (const hit of hits) {
        const sweep = dir > 0 ? 1 : 0
        if (horiz) path += ` L${hit - HOP * dir} ${s.y} A${HOP} ${HOP} 0 0 ${sweep} ${hit + HOP * dir} ${s.y}`
        else path += ` L${s.x} ${hit - HOP * dir} A${HOP} ${HOP} 0 0 ${sweep} ${s.x} ${hit + HOP * dir}`
      }
      path += ` L${e.x} ${e.y}`
    }
    drawn.push(pts)
    out.push({ conn, d: path, ends: [pts[0], pts[pts.length - 1]], blocked: route.blocked })
  }
  return out
}
```

- [ ] **Step 4: Update `src/render/Sheet.tsx`** so blocked wires draw dashed and parts get rotation

In the parts map pass rotation: `<Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={captions[p.uid] ?? p.designator} />`. In the wires map, destructure `blocked` and add `strokeDasharray={blocked ? '6 5' : undefined}` to the colored path:

```tsx
        {wires.map(({ conn, d, blocked }) => {
          const w = wireWidth(conn.gauge)
          return (
            <g key={conn.uid}>
              <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={blocked ? '6 5' : undefined} />
              <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={blocked ? '6 5' : undefined} />
            </g>
          )
        })}
```

- [ ] **Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: all PASS; the existing straight-wire and hop tests still pass unchanged (the router returns the same straight lines for them).

- [ ] **Step 6: Commit**

```bash
git add src/format/diagram.ts src/format/diagram.test.ts src/render/Sheet.tsx
git commit -m "Route wires with the A* router; support rotated parts and partial re-routing"
```

---

### Task 4: Diagram validation and serialization

**Files:**
- Modify: `src/format/diagram.ts`
- Create: `src/format/diagramIO.test.ts`

**Interfaces:**
- Consumes: `validateModule`, `isObj`, `isNum` from `module.ts`
- Produces:
  - `isValidColor(c: string): boolean`
  - `type DiagramResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; errors: string[] }`
  - `validateDiagram(raw: unknown): DiagramResult` - errors refuse the load; missing parts or pins are warnings (the file still loads)
  - `serializeDiagram(d: Diagram): string` - pretty JSON with trailing newline
  - `emptyDiagram(title?: string): Diagram`

- [ ] **Step 1: Write the failing tests** in `src/format/diagramIO.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { emptyDiagram, isValidColor, serializeDiagram, validateDiagram, type Diagram } from './diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'

describe('validateDiagram', () => {
  it('accepts the sample sheet with no warnings', () => {
    const r = validateDiagram(JSON.parse(serializeDiagram(buttonLed)))
    expect(r).toEqual({ ok: true, diagram: buttonLed, warnings: [] })
  })
  it('round-trips document data exactly', () => {
    const r = validateDiagram(JSON.parse(serializeDiagram(buttonLed)))
    expect(r.ok && serializeDiagram(r.diagram)).toBe(serializeDiagram(buttonLed))
  })
  it('refuses unknown formats and duplicate uids, naming the path', () => {
    const bad = { ...structuredClone(buttonLed), format: 'circuitoon-diagram/9' } as unknown as Diagram
    bad.connections[1].uid = 'p1'
    const r = validateDiagram(bad)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'format: unsupported "circuitoon-diagram/9" (expected "circuitoon-diagram/1")',
        'connections[1].uid: duplicate "p1"',
      ])
  })
  it('loads connections to missing pins, with a warning', () => {
    const d = structuredClone(buttonLed)
    d.connections[0].to.pin = 'nope'
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(['connections[0].to: part "p2" has no pin "nope"'])
  })
  it('checks wire color and gauge', () => {
    const d = structuredClone(buttonLed) as unknown as { connections: Record<string, unknown>[] }
    d.connections[0].color = 'chartreuse'
    d.connections[1].gauge = 40
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.slice(-2)).toEqual([
        'connections[0].color: must be a named color or #RRGGBB',
        'connections[1].gauge: must be a whole number from 16 to 30',
      ])
  })
})

describe('helpers', () => {
  it('knows valid colors', () => {
    expect(isValidColor('Red')).toBe(true)
    expect(isValidColor('#a1B2c3')).toBe(true)
    expect(isValidColor('#abc')).toBe(false)
  })
  it('makes an empty sheet that validates', () => {
    expect(validateDiagram(emptyDiagram()).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/format/diagramIO.test.ts`
Expected: FAIL, "validateDiagram is not exported".

- [ ] **Step 3: Implement** by appending to `src/format/diagram.ts` (and add `validateModule, isObj, isNum` to the `./module.ts` import)

```ts
export function isValidColor(c: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(c) || c.toLowerCase() in NAMED_COLORS
}

export type DiagramResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; errors: string[] }

/**
 * Checks a parsed diagram file. Structural problems refuse the load (errors); a connection
 * that names a missing part or pin still loads (warning), so no wire is silently dropped.
 */
export function validateDiagram(raw: unknown): DiagramResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['diagram must be a JSON object'] }

  if (raw.format === undefined) errors.push(`format: missing (expected "${DIAGRAM_FORMAT}")`)
  else if (raw.format !== DIAGRAM_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${DIAGRAM_FORMAT}")`)
  if (typeof raw.title !== 'string') errors.push('title: required')

  const modules: Record<string, ModuleDef> = {}
  if (!isObj(raw.modules)) errors.push('modules: required, an object of embedded modules')
  else
    for (const [key, m] of Object.entries(raw.modules)) {
      const r = validateModule(m)
      if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`))
      else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`)
      else modules[key] = r.module
    }

  const uids = new Set<string>()
  const claim = (uid: unknown, at: string) => {
    if (typeof uid !== 'string' || uid === '') errors.push(`${at}.uid: required`)
    else if (uids.has(uid)) errors.push(`${at}.uid: duplicate "${uid}"`)
    else uids.add(uid)
  }

  const partModule = new Map<string, string>()
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  else
    raw.parts.forEach((p, i) => {
      const at = `parts[${i}]`
      if (!isObj(p)) return void errors.push(`${at}: must be an object`)
      claim(p.uid, at)
      if (typeof p.designator !== 'string') errors.push(`${at}.designator: required`)
      if (typeof p.module !== 'string') errors.push(`${at}.module: required`)
      else {
        if (typeof p.uid === 'string') partModule.set(p.uid, p.module)
        if (!(p.module in modules)) warnings.push(`${at}: module "${p.module}" is not embedded in this file`)
      }
      if (!isNum(p.x) || !isNum(p.y)) errors.push(`${at}: x and y must be numbers`)
      if (p.rotation !== undefined && ![0, 90, 180, 270].includes(p.rotation as number))
        errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
    })

  const checkEnd = (ep: unknown, at: string) => {
    if (!isObj(ep) || typeof ep.part !== 'string' || typeof ep.pin !== 'string')
      return void errors.push(`${at}: must be { "part": <uid>, "pin": <name> }`)
    if (ep.offset !== undefined && !isNum(ep.offset)) errors.push(`${at}.offset: must be a number`)
    const modId = partModule.get(ep.part)
    if (modId === undefined) return void warnings.push(`${at}: no part with uid "${ep.part}"`)
    const m = modules[modId]
    if (m && !m.pins.some((p) => 'name' in p && p.name === ep.pin)) warnings.push(`${at}: part "${ep.part}" has no pin "${ep.pin}"`)
  }

  if (!Array.isArray(raw.connections)) errors.push('connections: required list')
  else
    raw.connections.forEach((c, i) => {
      const at = `connections[${i}]`
      if (!isObj(c)) return void errors.push(`${at}: must be an object`)
      claim(c.uid, at)
      checkEnd(c.from, `${at}.from`)
      checkEnd(c.to, `${at}.to`)
      if (c.color !== undefined && !(typeof c.color === 'string' && isValidColor(c.color)))
        errors.push(`${at}.color: must be a named color or #RRGGBB`)
      if (c.gauge !== undefined && !(Number.isInteger(c.gauge) && (c.gauge as number) >= 16 && (c.gauge as number) <= 30))
        errors.push(`${at}.gauge: must be a whole number from 16 to 30`)
      if (c.route !== undefined && !(Array.isArray(c.route) && c.route.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))))
        errors.push(`${at}.route: must be a list of [x, y] points`)
    })

  if (raw.annotations !== undefined) {
    if (!Array.isArray(raw.annotations)) errors.push('annotations: must be a list')
    else raw.annotations.forEach((a, i) => (isObj(a) ? claim(a.uid, `annotations[${i}]`) : errors.push(`annotations[${i}]: must be an object`)))
  }

  return errors.length ? { ok: false, errors } : { ok: true, diagram: raw as unknown as Diagram, warnings }
}

export function serializeDiagram(d: Diagram): string {
  return JSON.stringify(d, null, 2) + '\n'
}

export function emptyDiagram(title = 'Untitled sheet'): Diagram {
  return { format: DIAGRAM_FORMAT, title, modules: {}, parts: [], connections: [] }
}
```

Note: the "refuses unknown formats" test mutates `connections[1].uid` to `'p1'`, which is already a part uid, so the duplicate is detected across collections. The order of the two error messages matches the check order above.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/diagram.ts src/format/diagramIO.test.ts
git commit -m "Add diagram validation, serialization and empty sheet"
```

---

### Task 5: Editor operations and store

**Files:**
- Create: `src/editor/ops.ts`, `src/editor/ops.test.ts`, `src/editor/store.ts`, `src/editor/store.test.ts`

**Interfaces:**
- Consumes: `Diagram`, `Connection`, `Endpoint`, `PartInstance` (diagram.ts), `ModuleDef` (module.ts), `Rotation` (geometry.ts)
- Produces (`ops.ts`):
  - `interface Selection { parts: string[]; wires: string[] }`, `const EMPTY_SELECTION: Selection`
  - `interface WireStyle { color: string; gauge: number }`
  - `nextUid(d: Diagram, prefix: 'p' | 'w' | 'a'): string`
  - `designatorPrefix(m: ModuleDef): string`, `nextDesignator(d: Diagram, m: ModuleDef): string`
  - `addPart(d: Diagram, m: ModuleDef, x: number, y: number): { diagram: Diagram; uid: string }`
  - `moveParts(d: Diagram, uids: string[], dx: number, dy: number): Diagram`
  - `rotateParts(d: Diagram, uids: string[]): Diagram`
  - `deleteSelection(d: Diagram, sel: Selection): Diagram`
  - `addWire(d: Diagram, from: Endpoint, to: Endpoint, style: WireStyle): { diagram: Diagram; uid: string } | null`
  - `updatePart(d: Diagram, uid: string, patch: { designator?: string }): Diagram`
  - `updateWire(d: Diagram, uid: string, patch: { color?: string; gauge?: number; label?: string }): Diagram`
- Produces (`store.ts`):
  - `interface EditorState { diagram: Diagram; selection: Selection; wireStyle: WireStyle }`
  - `class EditorStore` with `getState()`, `subscribe(fn)`, `commit(next)`, `begin(): Diagram`, `preview(next)`, `end()`, `undo()`, `redo()`, `canUndo`, `canRedo`, `select(sel)`, `setWireStyle(style)`, `load(d)`
  - `useEditorState(store: EditorStore): EditorState`

- [ ] **Step 1: Write the failing tests** in `src/editor/ops.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { addPart, addWire, deleteSelection, moveParts, nextDesignator, rotateParts, updatePart, updateWire } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const resistor: ModuleDef = {
  format: 'circuitoon-module/1', id: 'resistor', name: 'Resistor',
  pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
}
const style = { color: 'red', gauge: 22 }

function twoResistors() {
  const a = addPart(emptyDiagram(), resistor, 0, 0)
  const b = addPart(a.diagram, resistor, 100, 0)
  return b.diagram
}

describe('ops', () => {
  it('adds parts with fresh uids and designators, embedding the module once', () => {
    const d = twoResistors()
    expect(d.parts.map((p) => [p.uid, p.designator])).toEqual([['p1', 'R1'], ['p2', 'R2']])
    expect(Object.keys(d.modules)).toEqual(['resistor'])
    expect(nextDesignator(d, resistor)).toBe('R3')
  })
  it('moves and rotates only the given parts', () => {
    const d = rotateParts(moveParts(twoResistors(), ['p2'], 20, -10), ['p2'])
    expect(d.parts[0]).toMatchObject({ x: 0, y: 0, rotation: 0 })
    expect(d.parts[1]).toMatchObject({ x: 120, y: -10, rotation: 90 })
    expect(rotateParts(rotateParts(rotateParts(d, ['p2']), ['p2']), ['p2']).parts[1].rotation).toBe(0)
  })
  it('adds a wire, refusing self-loops and duplicates in either direction', () => {
    const d = twoResistors()
    const w = addWire(d, { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    expect(w.uid).toBe('w1')
    expect(w.diagram.connections[0]).toEqual({ uid: 'w1', from: { part: 'p1', pin: '2' }, to: { part: 'p2', pin: '1' }, color: 'red', gauge: 22 })
    expect(addWire(w.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: '2' }, style)).toBeNull()
    expect(addWire(d, { part: 'p1', pin: '1' }, { part: 'p1', pin: '1' }, style)).toBeNull()
  })
  it('deleting a part deletes its wires', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = deleteSelection(w.diagram, { parts: ['p2'], wires: [] })
    expect(d.parts.map((p) => p.uid)).toEqual(['p1'])
    expect(d.connections).toEqual([])
  })
  it('updates designators and wire properties', () => {
    const w = addWire(twoResistors(), { part: 'p1', pin: '2' }, { part: 'p2', pin: '1' }, style)!
    const d = updateWire(updatePart(w.diagram, 'p1', { designator: 'RLIM' }), 'w1', { color: '#123456', gauge: 18, label: 'LED+' })
    expect(d.parts[0].designator).toBe('RLIM')
    expect(d.connections[0]).toMatchObject({ color: '#123456', gauge: 18, label: 'LED+' })
  })
})
```

And `src/editor/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { addPart, moveParts } from './ops.ts'
import { emptyDiagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const m: ModuleDef = { format: 'circuitoon-module/1', id: 'x', name: 'X', pins: [{ name: 'A', side: 'left' }] }

describe('EditorStore', () => {
  it('undoes and redoes commits', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    expect(s.getState().diagram.parts).toHaveLength(1)
    s.undo()
    expect(s.getState().diagram.parts).toHaveLength(0)
    expect(s.canRedo).toBe(true)
    s.redo()
    expect(s.getState().diagram.parts).toHaveLength(1)
  })
  it('records a whole drag as one undo step', () => {
    const s = new EditorStore(addPart(emptyDiagram(), m, 0, 0).diagram)
    const base = s.begin()
    for (let i = 1; i <= 5; i++) s.preview(moveParts(base, ['p1'], i * 10, 0))
    s.end()
    expect(s.getState().diagram.parts[0].x).toBe(50)
    s.undo()
    expect(s.getState().diagram.parts[0].x).toBe(0)
    expect(s.canUndo).toBe(false)
  })
  it('a drag that goes nowhere adds no history', () => {
    const s = new EditorStore(emptyDiagram())
    s.begin()
    s.end()
    expect(s.canUndo).toBe(false)
  })
  it('drops selected uids that no longer exist', () => {
    const s = new EditorStore(emptyDiagram())
    s.commit(addPart(s.getState().diagram, m, 0, 0).diagram)
    s.select({ parts: ['p1'], wires: [] })
    s.undo()
    expect(s.getState().selection).toEqual({ parts: [], wires: [] })
  })
  it('notifies subscribers', () => {
    const s = new EditorStore(emptyDiagram())
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.select({ parts: [], wires: [] })
    off()
    s.select({ parts: [], wires: [] })
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor`
Expected: FAIL, "Failed to resolve import ./ops.ts".

- [ ] **Step 3: Implement `src/editor/ops.ts`**

```ts
// Immutable diagram edits. Every function returns a new Diagram and never mutates its input,
// so the store can keep old versions for undo.
import type { Connection, Diagram, Endpoint, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import type { Rotation } from '../format/geometry.ts'

export interface Selection {
  parts: string[]
  wires: string[]
}
export const EMPTY_SELECTION: Selection = { parts: [], wires: [] }

export interface WireStyle {
  color: string
  gauge: number
}

export function nextUid(d: Diagram, prefix: 'p' | 'w' | 'a'): string {
  const used = new Set([...d.parts.map((p) => p.uid), ...d.connections.map((c) => c.uid), ...(d.annotations ?? []).map((a) => a.uid)])
  let n = 1
  while (used.has(prefix + n)) n++
  return prefix + n
}

const PREFIXES: [RegExp, string][] = [
  [/^resistor/, 'R'],
  [/^capacitor/, 'C'],
  [/^led/, 'D'],
  [/button|switch/, 'S'],
  [/^battery/, 'BT'],
]

export function designatorPrefix(m: ModuleDef): string {
  return PREFIXES.find(([re]) => re.test(m.id))?.[1] ?? 'U'
}

export function nextDesignator(d: Diagram, m: ModuleDef): string {
  const prefix = designatorPrefix(m)
  const used = new Set(d.parts.map((p) => p.designator))
  let n = 1
  while (used.has(prefix + n)) n++
  return prefix + n
}

export function addPart(d: Diagram, m: ModuleDef, x: number, y: number): { diagram: Diagram; uid: string } {
  const uid = nextUid(d, 'p')
  const part: PartInstance = { uid, designator: nextDesignator(d, m), module: m.id, x, y, rotation: 0 }
  const modules = d.modules[m.id] ? d.modules : { ...d.modules, [m.id]: m }
  return { uid, diagram: { ...d, modules, parts: [...d.parts, part] } }
}

export function moveParts(d: Diagram, uids: string[], dx: number, dy: number): Diagram {
  if (!dx && !dy) return d
  const s = new Set(uids)
  return { ...d, parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }
}

export function rotateParts(d: Diagram, uids: string[]): Diagram {
  const s = new Set(uids)
  return {
    ...d,
    parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, rotation: (((p.rotation ?? 0) + 90) % 360) as Rotation } : p)),
  }
}

export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  return {
    ...d,
    parts: d.parts.filter((p) => !parts.has(p.uid)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
  }
}

const sameEnd = (a: Endpoint, b: Endpoint) => a.part === b.part && a.pin === b.pin

export function addWire(d: Diagram, from: Endpoint, to: Endpoint, style: WireStyle): { diagram: Diagram; uid: string } | null {
  if (sameEnd(from, to)) return null
  if (d.connections.some((c) => (sameEnd(c.from, from) && sameEnd(c.to, to)) || (sameEnd(c.from, to) && sameEnd(c.to, from)))) return null
  const uid = nextUid(d, 'w')
  const wire: Connection = { uid, from, to, color: style.color, gauge: style.gauge }
  return { uid, diagram: { ...d, connections: [...d.connections, wire] } }
}

export function updatePart(d: Diagram, uid: string, patch: { designator?: string }): Diagram {
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }
}

export function updateWire(d: Diagram, uid: string, patch: { color?: string; gauge?: number; label?: string }): Diagram {
  return { ...d, connections: d.connections.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) }
}
```

- [ ] **Step 4: Implement `src/editor/store.ts`**

```ts
// Editor state with undo history. Commits push the previous diagram onto the undo stack.
// A drag uses begin/preview/end so the whole gesture is a single undo step.
import { useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { EMPTY_SELECTION, type Selection, type WireStyle } from './ops.ts'

export interface EditorState {
  diagram: Diagram
  selection: Selection
  /** Color and gauge for the next wire drawn; follows the last values picked. */
  wireStyle: WireStyle
}

const HISTORY_LIMIT = 200

export class EditorStore {
  private state: EditorState
  private past: Diagram[] = []
  private future: Diagram[] = []
  private txBase: Diagram | null = null
  private listeners = new Set<() => void>()

  constructor(diagram: Diagram) {
    this.state = { diagram, selection: EMPTY_SELECTION, wireStyle: { color: 'black', gauge: 22 } }
  }

  getState = (): EditorState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private prune(d: Diagram, sel: Selection): Selection {
    const parts = new Set(d.parts.map((p) => p.uid))
    const wires = new Set(d.connections.map((c) => c.uid))
    return { parts: sel.parts.filter((u) => parts.has(u)), wires: sel.wires.filter((u) => wires.has(u)) }
  }

  private pushPast(d: Diagram) {
    this.past.push(d)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  commit(next: Diagram) {
    if (next === this.state.diagram) return
    this.pushPast(this.state.diagram)
    this.set({ diagram: next, selection: this.prune(next, this.state.selection) })
  }

  /** Starts a gesture; returns the diagram to derive previews from. */
  begin(): Diagram {
    this.txBase = this.state.diagram
    return this.txBase
  }

  preview(next: Diagram) {
    this.set({ diagram: next })
  }

  end() {
    const base = this.txBase
    this.txBase = null
    if (base && base !== this.state.diagram) {
      this.pushPast(base)
      this.set({})
    }
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.state.diagram)
    this.set({ diagram: prev, selection: this.prune(prev, this.state.selection) })
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state.diagram)
    this.set({ diagram: next, selection: this.prune(next, this.state.selection) })
  }

  select(selection: Selection) {
    this.set({ selection })
  }

  setWireStyle(wireStyle: WireStyle) {
    this.set({ wireStyle })
  }

  /** Replaces the whole document (import, new sheet) and clears history. */
  load(diagram: Diagram) {
    this.past = []
    this.future = []
    this.txBase = null
    this.set({ diagram, selection: EMPTY_SELECTION })
  }
}

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/editor/ops.ts src/editor/ops.test.ts src/editor/store.ts src/editor/store.test.ts
git commit -m "Add editor operations and undoable store"
```

---

### Task 6: Editor page shell, hash routing, pan and zoom

**Files:**
- Create: `src/Landing.tsx` (content moved from `src/App.tsx`), `src/editor/Editor.tsx`, `src/editor/Canvas.tsx`, `src/editor/editor.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `EditorStore`, `useEditorState` (Task 5); `computeRoutes`, `wirePaths`, `wireColor`, `wireWidth` (Task 3); `Part`, `INK` (render)
- Produces: `Editor` component (default page at `#/editor`); `Canvas({ store }: { store: EditorStore })`; `type View = { x: number; y: number; scale: number }`

- [ ] **Step 1: Move the landing page.** Rename `src/App.tsx` to `src/Landing.tsx` (`git mv src/App.tsx src/Landing.tsx`), rename the exported function `App` to `Landing`, and add an editor link in two places:

In the topbar, replace `<a className="gh" href={REPO}>Source on GitHub</a>` with:

```tsx
        <nav className="top-links">
          <a className="gh" href="#/editor">Open the editor</a>
          <a className="gh" href={REPO}>Source on GitHub</a>
        </nav>
```

Replace the status paragraph with:

```tsx
            <p className="status">
              Early build. The editor works for placing parts and drawing wires; saving in the browser, the art studio
              and PDF export come next.
            </p>
            <p><a className="cta" href="#/editor">Open the editor</a></p>
```

Add to `src/styles.css`:

```css
.top-links { display: flex; gap: 20px; flex-wrap: wrap; }
.cta {
  display: inline-block; font-weight: 700; text-decoration: none;
  background: var(--yellow); color: var(--ink);
  border: 2.5px solid var(--ink); border-radius: 10px; box-shadow: 3px 4px 0 var(--shadow);
  padding: 10px 18px;
}
.cta:active { transform: translate(2px, 2px); box-shadow: 1px 2px 0 var(--shadow); }
```

- [ ] **Step 2: Write the router in `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Landing } from './Landing.tsx'
import { Editor } from './editor/Editor.tsx'

// Hash routes keep deep links working on GitHub Pages, which has no server-side routing.
function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function App() {
  const hash = useHash()
  return hash.startsWith('#/editor') ? <Editor /> : <Landing />
}
```

- [ ] **Step 3: Write `src/editor/editor.css`**

```css
.editor {
  position: fixed; inset: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 270px;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: "bar bar bar" "lib canvas inspector";
  background: var(--bg);
  color: var(--text);
}
.toolbar {
  grid-area: bar;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; border-bottom: 1px solid var(--rule); background: var(--panel);
}
.toolbar .wordmark { font-size: 24px; margin-right: 8px; }
.toolbar .title { font: 600 18px/1.2 "Fredoka", system-ui, sans-serif; margin-right: auto; }
.toolbar .sep { width: 1px; align-self: stretch; background: var(--rule); margin: 0 4px; }
.toolbar .message { flex-basis: 100%; margin: 0; font-size: 14px; }
.toolbar .message.error { color: #C53A31; }
.tool {
  font: 700 14px/1 "Atkinson Hyperlegible", system-ui, sans-serif;
  color: var(--text); background: transparent;
  border: 1.5px solid var(--rule); border-radius: 8px; padding: 7px 10px; cursor: pointer;
}
.tool:hover:not(:disabled) { border-color: var(--text); }
.tool:disabled { opacity: 0.45; cursor: default; }

.library { grid-area: lib; overflow-y: auto; border-right: 1px solid var(--rule); background: var(--panel); padding: 12px; display: grid; gap: 10px; align-content: start; }
.library h2, .inspector h2 { font: 600 17px/1.2 "Fredoka", system-ui, sans-serif; margin: 0; }
.lib-item {
  display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: center;
  border: 1px solid var(--rule); border-radius: 8px; background: var(--paper); color: #23282F;
  padding: 6px; cursor: grab; text-align: left; font: 700 14px/1.2 "Atkinson Hyperlegible", system-ui, sans-serif;
}
.lib-item:hover { border-color: #23282F; }
.lib-item svg { width: 64px; height: 44px; }
.hint { color: var(--muted); font-size: 13.5px; margin: 0; }

.canvas-wrap { grid-area: canvas; position: relative; overflow: hidden; }
.canvas { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; font-family: "Atkinson Hyperlegible", system-ui, sans-serif; }
.canvas.panning { cursor: grabbing; }
.canvas [data-part] { cursor: move; }
.pin-hit { fill: transparent; cursor: crosshair; }
.pin-hit:hover, .pin-hit.target { fill: rgba(61, 111, 214, 0.35); stroke: #3D6FD6; stroke-width: 1.5; }
.wire-hit { stroke: transparent; cursor: pointer; }
.zoom-readout { position: absolute; right: 10px; bottom: 8px; font-size: 13px; color: #56615B; background: var(--paper); border: 1px solid #D6DCD2; border-radius: 6px; padding: 2px 6px; }

.inspector { grid-area: inspector; overflow-y: auto; border-left: 1px solid var(--rule); background: var(--panel); padding: 12px; display: grid; gap: 12px; align-content: start; }
.field { display: grid; gap: 4px; font-size: 14px; font-weight: 700; }
.field input, .field select {
  font: 400 15px/1.2 "Atkinson Hyperlegible", system-ui, sans-serif; color: var(--text);
  background: var(--bg); border: 1.5px solid var(--rule); border-radius: 6px; padding: 6px 8px;
}
.swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.swatch { aspect-ratio: 1; border-radius: 6px; border: 2px solid #23282F; cursor: pointer; padding: 0; }
.swatch[aria-pressed="true"] { outline: 3px solid var(--focus); outline-offset: 1px; }

@media (max-width: 900px) {
  .editor { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; grid-template-areas: "bar" "canvas" "inspector" "lib"; }
  .library, .inspector { max-height: 30vh; border: 0; border-top: 1px solid var(--rule); }
}
```

- [ ] **Step 4: Write `src/editor/Canvas.tsx` (render, pan and zoom only; interactions come in Tasks 7 and 8)**

```tsx
// The editing surface: an SVG sheet you can pan (drag the background) and zoom (wheel).
import { useEffect, useMemo, useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { computeRoutes, wireColor, wirePaths, wireWidth, type Routes } from '../format/diagram.ts'
import type { Pt } from '../format/geometry.ts'
import { Part, INK } from '../render/Part.tsx'

export type View = { x: number; y: number; scale: number }
const MIN_SCALE = 0.25
const MAX_SCALE = 4

type Drag = { kind: 'pan'; client: Pt; view: View }

export function Canvas({ store }: { store: EditorStore }) {
  const { diagram } = useEditorState(store)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: -20, y: -40, scale: 1.5 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const settled = useRef<Routes>(new Map())

  useEffect(() => {
    const el = svgRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    // Wheel must be non-passive so the page does not scroll while zooming.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0015)))
        const wx = v.x + (e.clientX - r.left) / v.scale
        const wy = v.y + (e.clientY - r.top) / v.scale
        return { scale, x: wx - (e.clientX - r.left) / scale, y: wy - (e.clientY - r.top) / scale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const routes = useMemo(() => {
    const all = computeRoutes(diagram)
    settled.current = all
    return all
  }, [diagram])
  const wires = wirePaths(diagram, routes)

  const vw = size.w / view.scale
  const vh = size.h / view.scale

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
  }
  function onPointerUp() {
    setDrag(null)
  }

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={drag?.kind === 'pan' ? 'canvas panning' : 'canvas'}
        viewBox={`${view.x} ${view.y} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Wiring sheet editor"
      >
        <defs>
          <pattern id="editor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth={0.6 / Math.max(1, view.scale / 1.5)} />
          </pattern>
        </defs>
        <rect x={view.x} y={view.y} width={vw} height={vh} fill="var(--paper)" />
        <rect x={view.x} y={view.y} width={vw} height={vh} fill="url(#editor-grid)" />
        {diagram.parts.map((p) => {
          const m = diagram.modules[p.module]
          return m ? (
            <g key={p.uid} data-part={p.uid}>
              <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={p.designator} />
            </g>
          ) : null
        })}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {wires.map(({ conn, d, blocked }) => {
            const w = wireWidth(conn.gauge)
            const dash = blocked ? '6 5' : undefined
            return (
              <g key={conn.uid} data-wire={conn.uid}>
                <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={dash} />
                <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={dash} />
              </g>
            )
          })}
        </g>
        {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
      </svg>
      <div className="zoom-readout" aria-live="polite">{Math.round((view.scale / 1.5) * 100)}%</div>
    </div>
  )
}
```

Zoom readout: 1.5x scale is shown as 100% because the canvas starts at a comfortable 1.5x of the 10 px grid.

- [ ] **Step 5: Write `src/editor/Editor.tsx`**

```tsx
import { useMemo } from 'react'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { buttonLed } from '../samples/buttonLed.ts'
import './editor.css'

export function Editor() {
  // Opens on the sample sheet so the first view shows what the editor does.
  const store = useMemo(() => new EditorStore(structuredClone(buttonLed)), [])
  return (
    <div className="editor">
      <header className="toolbar">
        <a className="wordmark" href="#/">Circuitoon</a>
      </header>
      <aside className="library" aria-label="Parts library" />
      <Canvas store={store} />
      <aside className="inspector" aria-label="Properties" />
    </div>
  )
}
```

(The empty `aside`s are filled by Tasks 7 and 9; they keep the grid layout stable meanwhile.)

- [ ] **Step 6: Build and check in the browser**

Run: `npm test && npm run build && npx vite preview --port 4178 --strictPort` (background), then open `http://localhost:4178/circuitoon/#/editor`.
Expected: sample sheet renders on graph paper; background drag pans; wheel zooms around the cursor; the landing page at `#/` shows "Open the editor" links that navigate to the editor.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Add editor page with hash routing, pan and zoom canvas"
```

---

### Task 7: Library panel and part interactions

**Files:**
- Create: `src/editor/LibraryPanel.tsx`
- Modify: `src/editor/Canvas.tsx`, `src/editor/Editor.tsx`

**Interfaces:**
- Consumes: `addPart`, `moveParts`, `rotateParts`, `deleteSelection`, `EMPTY_SELECTION` (ops); `library`, `modulesById` (library.ts); `bodyRect` (geometry); `layoutModule` (module)
- Produces: `LibraryPanel({ store, onAdd }: { store: EditorStore; onAdd: (id: string) => void })`; `MODULE_MIME = 'application/x-circuitoon-module'`; Canvas exposes `centerOfView` via the `onReady` callback prop `onReady?: (api: { addAtCenter: (moduleId: string) => void }) => void`

- [ ] **Step 1: Write `src/editor/LibraryPanel.tsx`**

```tsx
// Built-in parts. Drag one onto the sheet, or click it to drop it in the middle of the view.
import { library } from '../library.ts'
import { Part, partBounds } from '../render/Part.tsx'

export const MODULE_MIME = 'application/x-circuitoon-module'

export function LibraryPanel({ onAdd }: { onAdd: (moduleId: string) => void }) {
  return (
    <aside className="library" aria-label="Parts library">
      <h2>Parts</h2>
      <p className="hint">Drag onto the sheet, or click to add.</p>
      {library.flatMap((e) => {
        if (!e.ok) return []
        const m = e.module
        const b = partBounds(m)
        return [
          <button
            key={m.id}
            type="button"
            className="lib-item"
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData(MODULE_MIME, m.id)
              ev.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAdd(m.id)}
          >
            <svg viewBox={`${b.x - 4} ${b.y - 4} ${b.w + 8} ${b.h + 8}`} aria-hidden="true">
              <Part module={m} />
            </svg>
            {m.name}
          </button>,
        ]
      })}
    </aside>
  )
}
```

- [ ] **Step 2: Add part selection, dragging, dropping and add-at-center to `src/editor/Canvas.tsx`**

Add imports:

```ts
import { addPart, EMPTY_SELECTION, moveParts } from './ops.ts'
import { modulesById } from '../library.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { MODULE_MIME } from './LibraryPanel.tsx'
import type { Diagram } from '../format/diagram.ts'
```

Change the component signature and state:

```tsx
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

type Drag =
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; base: Diagram }

export function Canvas({ store, onReady }: { store: EditorStore; onReady?: (api: { addAtCenter: (moduleId: string) => void }) => void }) {
  const { diagram, selection } = useEditorState(store)
```

Add, after the resize/wheel effect:

```tsx
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: view.x + (e.clientX - r.left) / view.scale, y: view.y + (e.clientY - r.top) / view.scale }
  }

  function placeModule(moduleId: string, at: Pt) {
    const m = modulesById[moduleId]
    if (!m) return
    const lay = layoutModule(m)
    const { diagram: next, uid } = addPart(store.getState().diagram, m, snap(at.x - lay.w / 2), snap(at.y - lay.h / 2))
    store.commit(next)
    store.select({ parts: [uid], wires: [] })
  }

  useEffect(() => {
    onReady?.({ addAtCenter: (id) => placeModule(id, { x: view.x + size.w / view.scale / 2, y: view.y + size.h / view.scale / 2 }) })
  })
```

Replace the routes memo so only wires attached to moving parts re-route during a part drag:

```tsx
  const draggingParts = drag?.kind === 'parts' ? drag.uids : null
  const routes = useMemo(() => {
    if (draggingParts) {
      const moving = new Set(draggingParts)
      const only = new Set(diagram.connections.filter((c) => moving.has(c.from.part) || moving.has(c.to.part)).map((c) => c.uid))
      return computeRoutes(diagram, { only, prev: settled.current })
    }
    const all = computeRoutes(diagram)
    settled.current = all
    return all
  }, [diagram, draggingParts])
```

Replace the three pointer handlers:

```tsx
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as Element
    e.currentTarget.setPointerCapture(e.pointerId)
    const partEl = e.button === 0 ? target.closest('[data-part]') : null
    if (partEl) {
      const uid = partEl.getAttribute('data-part')!
      const sel = store.getState().selection
      let parts = sel.parts
      if (e.shiftKey) parts = parts.includes(uid) ? parts.filter((u) => u !== uid) : [...parts, uid]
      else if (!parts.includes(uid)) parts = [uid]
      store.select({ parts, wires: e.shiftKey ? sel.wires : [] })
      if (parts.includes(uid)) setDrag({ kind: 'parts', start: toWorld(e), uids: parts, base: store.begin() })
      return
    }
    if (!e.shiftKey) store.select(EMPTY_SELECTION)
    setDrag({ kind: 'pan', client: { x: e.clientX, y: e.clientY }, view })
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'pan')
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client.x) / view.scale, y: drag.view.y - (e.clientY - drag.client.y) / view.scale })
    else if (drag?.kind === 'parts') {
      const p = toWorld(e)
      store.preview(moveParts(drag.base, drag.uids, snap(p.x - drag.start.x), snap(p.y - drag.start.y)))
    }
  }
  function onPointerUp() {
    if (drag?.kind === 'parts') store.end()
    setDrag(null)
  }
```

Wrap the svg in drop handling (on the `canvas-wrap` div):

```tsx
    <div
      className="canvas-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MODULE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(MODULE_MIME)
        if (id) {
          e.preventDefault()
          placeModule(id, toWorld(e))
        }
      }}
    >
```

Render a dashed selection box before each selected part's `<Part>` inside its `<g data-part>`:

```tsx
            <g key={p.uid} data-part={p.uid}>
              {selection.parts.includes(p.uid) && (() => {
                const r = bodyRect(p, layoutModule(m))
                return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={6} fill="none" stroke="var(--focus)" strokeWidth={1.5} strokeDasharray="5 4" />
              })()}
              <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={p.designator} />
            </g>
```

- [ ] **Step 3: Wire the library and keyboard shortcuts into `src/editor/Editor.tsx`**

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { buttonLed } from '../samples/buttonLed.ts'
import './editor.css'

function useEditorKeys(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const s = store.getState()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        store.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.parts.length || s.selection.wires.length) {
          e.preventDefault()
          store.commit(deleteSelection(s.diagram, s.selection))
        }
      } else if (key === 'r' && !mod) {
        if (s.selection.parts.length) store.commit(rotateParts(s.diagram, s.selection.parts))
      } else if (e.key === 'Escape') store.select(EMPTY_SELECTION)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}

export function Editor() {
  // Opens on the sample sheet so the first view shows what the editor does.
  const store = useMemo(() => new EditorStore(structuredClone(buttonLed)), [])
  const canvasApi = useRef<{ addAtCenter: (moduleId: string) => void } | null>(null)
  useEditorKeys(store)
  return (
    <div className="editor">
      <header className="toolbar">
        <a className="wordmark" href="#/">Circuitoon</a>
      </header>
      <LibraryPanel onAdd={(id) => canvasApi.current?.addAtCenter(id)} />
      <Canvas store={store} onReady={(api) => (canvasApi.current = api)} />
      <aside className="inspector" aria-label="Properties" />
    </div>
  )
}
```

- [ ] **Step 4: Build and check in the browser**

Run: `npm test && npm run build`, restart `npx vite preview --port 4178 --strictPort`, open `#/editor`.
Expected: dragging a library item onto the sheet adds a part with the next designator (for example R2) and selects it; clicking a library item adds one at the view center; dragging a part moves it in 10 px steps and its wires re-route live; R rotates; Delete removes the part and its wires; Ctrl+Z restores; a whole drag undoes in one step.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Add parts library panel; select, drag, rotate and delete parts"
```

---

### Task 8: Drawing and selecting wires

**Files:**
- Modify: `src/editor/Canvas.tsx`

**Interfaces:**
- Consumes: `addWire`, `WireStyle` (ops); `worldPins` (geometry); `store.getState().wireStyle`
- Produces: pin hit targets `circle.pin-hit[data-pin][data-pin-part]`; wire hit paths `path.wire-hit` inside `g[data-wire]`

- [ ] **Step 1: Extend the drag union and imports**

```ts
import { addPart, addWire, EMPTY_SELECTION, moveParts } from './ops.ts'
import { bodyRect, worldPins } from '../format/geometry.ts'
import type { Diagram, Endpoint } from '../format/diagram.ts'
```

```ts
type Drag =
  | { kind: 'pan'; client: Pt; view: View }
  | { kind: 'parts'; start: Pt; uids: string[]; base: Diagram }
  | { kind: 'wire'; from: Endpoint; origin: Pt; cursor: Pt; over: Endpoint | null }
```

- [ ] **Step 2: Handle pins and wires first in `onPointerDown`** (insert at the top, after `setPointerCapture`)

```tsx
    const pinEl = e.button === 0 ? target.closest('[data-pin]') : null
    if (pinEl) {
      const from = { part: pinEl.getAttribute('data-pin-part')!, pin: pinEl.getAttribute('data-pin')! }
      const origin = { x: Number(pinEl.getAttribute('cx')), y: Number(pinEl.getAttribute('cy')) }
      setDrag({ kind: 'wire', from, origin, cursor: toWorld(e), over: null })
      return
    }
    const wireEl = e.button === 0 ? target.closest('[data-wire]') : null
    if (wireEl) {
      const uid = wireEl.getAttribute('data-wire')!
      const sel = store.getState().selection
      if (e.shiftKey) store.select({ parts: sel.parts, wires: sel.wires.includes(uid) ? sel.wires.filter((u) => u !== uid) : [...sel.wires, uid] })
      else store.select({ parts: [], wires: [uid] })
      return
    }
```

- [ ] **Step 3: Track the pin under the cursor and finish the wire**

Add a helper inside the component:

```tsx
  // With pointer capture the event target is always the svg, so look up what is under the cursor.
  function pinUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]')
    return el ? { part: el.getAttribute('data-pin-part')!, pin: el.getAttribute('data-pin')! } : null
  }
```

In `onPointerMove` add:

```tsx
    else if (drag?.kind === 'wire') setDrag({ ...drag, cursor: toWorld(e), over: pinUnder(e) })
```

Replace `onPointerUp` with:

```tsx
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (drag?.kind === 'parts') store.end()
    if (drag?.kind === 'wire') {
      const to = pinUnder(e)
      const s = store.getState()
      const added = to && addWire(s.diagram, drag.from, to, s.wireStyle)
      if (added) {
        store.commit(added.diagram)
        store.select({ parts: [], wires: [added.uid] })
      }
    }
    setDrag(null)
  }
```

and change `onPointerCancel={onPointerUp}` to `onPointerCancel={() => { if (drag?.kind === 'parts') store.end(); setDrag(null) }}`.

Add an Escape handler that cancels a wire in progress:

```tsx
  useEffect(() => {
    if (drag?.kind !== 'wire') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrag(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag?.kind])
```

- [ ] **Step 4: Render wire selection, hit areas, the rubber-band wire and pin targets**

Replace the wires group with:

```tsx
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {wires.map(({ conn, d, blocked }) => {
            const w = wireWidth(conn.gauge)
            const dash = blocked ? '6 5' : undefined
            const selected = selection.wires.includes(conn.uid)
            return (
              <g key={conn.uid} data-wire={conn.uid}>
                {selected && <path d={d} stroke="var(--focus)" strokeOpacity={0.35} strokeWidth={w + 10} />}
                <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={dash} />
                <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} strokeDasharray={dash} />
                <path d={d} className="wire-hit" strokeWidth={Math.max(12, w + 8)} />
              </g>
            )
          })}
        </g>
```

After the end dots, add the rubber band and the pin targets (last, so they sit on top of wires):

```tsx
        {drag?.kind === 'wire' && (
          <line
            x1={drag.origin.x} y1={drag.origin.y} x2={drag.cursor.x} y2={drag.cursor.y}
            stroke={wireColor(store.getState().wireStyle.color)} strokeWidth={2.5} strokeDasharray="6 4" strokeLinecap="round"
          />
        )}
        {diagram.parts.flatMap((p) => {
          const m = diagram.modules[p.module]
          if (!m) return []
          return worldPins(p, m).map((wp) => {
            const over = drag?.kind === 'wire' && drag.over?.part === p.uid && drag.over.pin === wp.name
            return (
              <circle
                key={`${p.uid}:${wp.name}`}
                className={over ? 'pin-hit target' : 'pin-hit'}
                data-pin={wp.name}
                data-pin-part={p.uid}
                cx={wp.end.x}
                cy={wp.end.y}
                r={6}
              >
                <title>{`${p.designator} ${wp.label ?? wp.name}`}</title>
              </circle>
            )
          })
        })}
```

- [ ] **Step 5: Build and check in the browser**

Run: `npm test && npm run build`, restart preview, open `#/editor`.
Expected: hovering a pin tip shows a blue ring and a tooltip ("R1 1"); dragging from one pin shows a dashed line; releasing on another pin creates a routed wire in the current style and selects it; releasing elsewhere or pressing Escape cancels; clicking a wire selects it with a blue glow; Delete removes it; Ctrl+Z brings it back.

- [ ] **Step 6: Commit**

```bash
git add src/editor/Canvas.tsx
git commit -m "Draw wires pin to pin; select and delete wires"
```

---

### Task 9: Inspector panel

**Files:**
- Create: `src/editor/Inspector.tsx`
- Modify: `src/editor/Editor.tsx`

**Interfaces:**
- Consumes: `updatePart`, `updateWire`, `rotateParts`, `deleteSelection` (ops); `NAMED_COLORS`, `isValidColor` (diagram.ts)
- Produces: `Inspector({ store }: { store: EditorStore })`

- [ ] **Step 1: Write `src/editor/Inspector.tsx`**

```tsx
// Properties of whatever is selected. Text fields commit on Enter or when they lose focus,
// so typing a name is one undo step, not one per keystroke.
import { type EditorStore, useEditorState } from './store.ts'
import { deleteSelection, rotateParts, updatePart, updateWire } from './ops.ts'
import { NAMED_COLORS, isValidColor, wireColor } from '../format/diagram.ts'

const GAUGES = Array.from({ length: 15 }, (_, i) => 16 + i)

function CommitInput({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        key={value}
        defaultValue={value}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

export function Inspector({ store }: { store: EditorStore }) {
  const { diagram, selection, wireStyle } = useEditorState(store)
  const count = selection.parts.length + selection.wires.length
  const remove = (
    <button type="button" className="tool" onClick={() => store.commit(deleteSelection(diagram, selection))}>
      Delete
    </button>
  )

  if (count === 0)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>Sheet</h2>
        <CommitInput id="sheet-title" label="Title" value={diagram.title} onCommit={(title) => store.commit({ ...diagram, title: title.trim() || 'Untitled sheet' })} />
        <p className="hint">Drag from a pin tip to another pin to add a wire. Drag the paper to pan, scroll to zoom. R rotates, Delete removes, Ctrl+Z undoes.</p>
      </aside>
    )

  if (count > 1)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>{count} items selected</h2>
        {selection.parts.length > 0 && (
          <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate parts</button>
        )}
        {remove}
      </aside>
    )

  const part = diagram.parts.find((p) => p.uid === selection.parts[0])
  if (part) {
    const m = diagram.modules[part.module]
    return (
      <aside className="inspector" aria-label="Properties">
        <h2>{m?.name ?? part.module}</h2>
        <CommitInput
          id="part-designator"
          label="Name on sheet"
          value={part.designator}
          onCommit={(v) => v.trim() && store.commit(updatePart(diagram, part.uid, { designator: v.trim() }))}
        />
        <p className="hint">Rotation: {part.rotation ?? 0} degrees</p>
        <button type="button" className="tool" onClick={() => store.commit(rotateParts(diagram, [part.uid]))}>Rotate 90 degrees</button>
        {remove}
      </aside>
    )
  }

  const wire = diagram.connections.find((c) => c.uid === selection.wires[0])
  if (!wire) return <aside className="inspector" aria-label="Properties" />
  const color = wire.color ?? 'black'
  const gauge = wire.gauge ?? 22
  const setWire = (patch: { color?: string; gauge?: number; label?: string }) => {
    store.commit(updateWire(diagram, wire.uid, patch))
    store.setWireStyle({ color: patch.color ?? color, gauge: patch.gauge ?? gauge })
  }
  return (
    <aside className="inspector" aria-label="Properties">
      <h2>Wire</h2>
      <div className="field" role="group" aria-label="Color">
        Color
        <div className="swatches">
          {Object.keys(NAMED_COLORS).map((name) => (
            <button
              key={name}
              type="button"
              className="swatch"
              title={name}
              aria-label={name}
              aria-pressed={color.toLowerCase() === name}
              style={{ background: NAMED_COLORS[name] }}
              onClick={() => setWire({ color: name })}
            />
          ))}
        </div>
      </div>
      <label className="field" htmlFor="wire-hex">
        Custom color
        <input
          id="wire-hex"
          key={color}
          defaultValue={color.startsWith('#') ? color : wireColor(color)}
          placeholder="#2458C6"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== color && isValidColor(v)) setWire({ color: v })
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="field" htmlFor="wire-gauge">
        Gauge (AWG)
        <select id="wire-gauge" value={gauge} onChange={(e) => setWire({ gauge: Number(e.target.value) })}>
          {GAUGES.map((g) => (
            <option key={g} value={g}>{g}{g === 22 ? ' (breadboard jumper)' : ''}</option>
          ))}
        </select>
      </label>
      <CommitInput id="wire-label" label="Label" value={wire.label ?? ''} onCommit={(v) => setWire({ label: v.trim() || undefined })} />
      <p className="hint">New wires use {wireStyle.color}, {wireStyle.gauge} AWG.</p>
      {remove}
    </aside>
  )
}
```

- [ ] **Step 2: Use it in `src/editor/Editor.tsx`**

Import `import { Inspector } from './Inspector.tsx'` and replace `<aside className="inspector" aria-label="Properties" />` with `<Inspector store={store} />`.

- [ ] **Step 3: Build and check in the browser**

Run: `npm test && npm run build`, restart preview, open `#/editor`.
Expected: nothing selected shows the sheet title and tips; selecting a part shows its name field and rotate/delete; selecting a wire shows 11 color swatches, a hex field, a gauge list 16 to 30 and a label; picking a swatch recolors the wire, picking 16 AWG makes it visibly thicker, and the next wire drawn uses the last picked color and gauge; each change is one undo step.

- [ ] **Step 4: Commit**

```bash
git add src/editor/Inspector.tsx src/editor/Editor.tsx
git commit -m "Add inspector for parts and wires: name, rotation, color, gauge, label"
```

---

### Task 10: Start screen: new diagram, open a file, or try the sample

**Files:**
- Create: `src/editor/files.ts`, `src/editor/files.test.ts`, `src/editor/StartScreen.tsx`, `src/editor/EditorApp.tsx`
- Modify: `src/editor/Editor.tsx` (takes the document as a prop), `src/App.tsx` (routes to `EditorApp`), `src/editor/editor.css`

**Interfaces:**
- Consumes: `validateDiagram`, `emptyDiagram`, `Diagram` (diagram.ts); `buttonLed`, `captions` (samples); `Sheet` (render)
- Produces:
  - `type OpenResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }`
  - `readDiagramFile(file: File): Promise<OpenResult>`
  - `downloadText(filename: string, text: string): void`
  - `exportFileName(title: string): string`
  - `StartScreen({ onOpen }: { onOpen: (d: Diagram, notice?: string) => void })`
  - `EditorApp()`, rendered at `#/editor`
  - `Editor({ initial, notice, onClose }: { initial: Diagram; notice?: string; onClose: () => void })`

There is no browser saving until M2, so a refresh returns to the start screen, and the screen says so. M2 adds a "Recent diagrams" list to this same screen.

- [ ] **Step 1: Write the failing tests** in `src/editor/files.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { exportFileName, readDiagramFile } from './files.ts'
import { serializeDiagram } from '../format/diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'

const file = (name: string, text: string) => new File([text], name, { type: 'application/json' })

describe('readDiagramFile', () => {
  it('opens a valid diagram', async () => {
    const r = await readDiagramFile(file('led.circuitoon.json', serializeDiagram(buttonLed)))
    expect(r).toEqual({ ok: true, diagram: buttonLed, warnings: [] })
  })
  it('explains a file that is not JSON', async () => {
    expect(await readDiagramFile(file('notes.json', 'hello'))).toEqual({ ok: false, message: 'notes.json is not valid JSON, so nothing was opened.' })
  })
  it('explains a JSON file that is not a diagram', async () => {
    const r = await readDiagramFile(file('module.json', '{}'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/^module\.json is not a Circuitoon diagram: format: missing/)
  })
})

describe('exportFileName', () => {
  it('makes a safe file name from the title', () => {
    expect(exportFileName('LED: blink/test')).toBe('LED- blink-test.circuitoon.json')
    expect(exportFileName('  ')).toBe('Untitled sheet.circuitoon.json')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/files.test.ts`
Expected: FAIL, "Failed to resolve import ./files.ts".

- [ ] **Step 3: Implement `src/editor/files.ts`**

```ts
// Opening and saving diagram files. Shared by the start screen and the editor toolbar.
import { type Diagram, validateDiagram } from '../format/diagram.ts'

export type OpenResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }

export async function readDiagramFile(file: File): Promise<OpenResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, message: `${file.name} is not valid JSON, so nothing was opened.` }
  }
  const r = validateDiagram(raw)
  if (!r.ok) return { ok: false, message: `${file.name} is not a Circuitoon diagram: ${r.errors.slice(0, 3).join('; ')}` }
  return { ok: true, diagram: r.diagram, warnings: r.warnings }
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export function exportFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return `${base || 'Untitled sheet'}.circuitoon.json`
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/editor/files.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Write `src/editor/StartScreen.tsx`**

```tsx
// First screen of the editor: start a new diagram, open one from a file, or try the sample.
import { useRef, useState } from 'react'
import { type Diagram, emptyDiagram } from '../format/diagram.ts'
import { buttonLed, captions } from '../samples/buttonLed.ts'
import { Sheet } from '../render/Sheet.tsx'
import { readDiagramFile } from './files.ts'

export function StartScreen({ onOpen }: { onOpen: (d: Diagram, notice?: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function open(file: File) {
    const r = await readDiagramFile(file)
    if (!r.ok) return setError(r.message)
    onOpen(r.diagram, r.warnings.length ? `Opened with warnings: ${r.warnings.slice(0, 3).join('; ')}` : undefined)
  }

  return (
    <div className="start">
      <header className="start-bar">
        <a className="wordmark" href="#/">Circuitoon</a>
      </header>
      <main className="start-main">
        <h1>Start a wiring sheet</h1>
        <div className="start-options">
          <button type="button" className="start-card" onClick={() => onOpen(emptyDiagram())}>
            <span className="start-icon" aria-hidden="true">+</span>
            <strong>New diagram</strong>
            <span>A blank sheet. Drag parts on from the library.</span>
          </button>
          <div
            className={dragOver ? 'start-card drop over' : 'start-card drop'}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) void open(f)
            }}
          >
            <span className="start-icon" aria-hidden="true">{'↑'}</span>
            <strong>Open a diagram</strong>
            <span>Drop a <code>.circuitoon.json</code> file here, or</span>
            <button type="button" className="tool" onClick={() => fileRef.current?.click()}>Choose file</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void open(f)
                e.target.value = ''
              }}
            />
          </div>
          <button type="button" className="start-card sample" onClick={() => onOpen(structuredClone(buttonLed))}>
            <Sheet diagram={buttonLed} captions={captions} box={{ x: 20, y: -6, w: 480, h: 212 }} label="Sample sheet preview" />
            <strong>Try the sample</strong>
            <span>A battery, button, resistor and LED, ready to rearrange.</span>
          </button>
        </div>
        {error && <p className="start-error" role="alert">{error}</p>}
        <p className="hint">Diagrams are not saved in the browser yet. Use Export JSON in the editor to keep your work.</p>
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Write `src/editor/EditorApp.tsx` and make `Editor` take the document**

```tsx
import { useState } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { StartScreen } from './StartScreen.tsx'
import { Editor } from './Editor.tsx'

export function EditorApp() {
  const [doc, setDoc] = useState<{ diagram: Diagram; notice?: string; key: number } | null>(null)
  if (!doc) return <StartScreen onOpen={(diagram, notice) => setDoc({ diagram, notice, key: Date.now() })} />
  return <Editor key={doc.key} initial={doc.diagram} notice={doc.notice} onClose={() => setDoc(null)} />
}
```

In `src/editor/Editor.tsx`: remove the `buttonLed` import, add `import type { Diagram } from '../format/diagram.ts'`, and change the signature and store creation to:

```tsx
export function Editor({ initial, notice, onClose }: { initial: Diagram; notice?: string; onClose: () => void }) {
  const store = useMemo(() => new EditorStore(initial), [initial])
```

Until Task 11 adds the toolbar, make the header:

```tsx
      <header className="toolbar">
        <button type="button" className="wordmark" onClick={onClose} title="Back to the start screen">Circuitoon</button>
        {notice && <p className="message">{notice}</p>}
      </header>
```

In `src/App.tsx`, import `EditorApp` from `./editor/EditorApp.tsx` instead of `Editor`, and render `<EditorApp />` for `#/editor`.

- [ ] **Step 7: Style the start screen** (append to `src/editor/editor.css`)

```css
.start { min-height: 100%; background: var(--bg); color: var(--text); }
.start-bar { max-width: 1120px; margin-inline: auto; padding: 20px; }
.start-main { max-width: 1120px; margin-inline: auto; padding: 8px 20px 48px; display: grid; gap: 20px; }
.start-main h1 { font: 600 clamp(28px, 4vw, 40px)/1.1 "Fredoka", system-ui, sans-serif; margin: 0; }
.start-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 18px; align-items: stretch; }
.start-card {
  display: grid; gap: 8px; align-content: start; justify-items: start; text-align: left;
  font: 400 15px/1.45 "Atkinson Hyperlegible", system-ui, sans-serif; color: var(--text);
  background: var(--panel); border: 2.5px solid var(--ink); border-radius: 12px; box-shadow: 4px 5px 0 var(--shadow);
  padding: 18px; cursor: pointer;
}
.start-card strong { font: 600 21px/1.2 "Fredoka", system-ui, sans-serif; }
.start-card:active { transform: translate(2px, 2px); box-shadow: 2px 3px 0 var(--shadow); }
.start-card.drop { cursor: default; border-style: dashed; }
.start-card.drop.over { background: var(--paper); }
.start-card.sample .sheet { border: 1.5px solid #D6DCD2; border-radius: 8px; }
.start-icon {
  display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px;
  background: var(--yellow); color: #23282F; border: 2px solid var(--ink); font: 600 26px/1 "Fredoka", system-ui, sans-serif;
}
.start-error { margin: 0; color: #C53A31; font-weight: 700; }
button.wordmark { background: none; border: 0; padding: 0; cursor: pointer; }
```

- [ ] **Step 8: Build and check in the browser**

Run: `npm test && npm run build`, restart preview, open `#/editor`.
Expected: three cards; "New diagram" opens an empty sheet; "Try the sample" opens the sample; choosing or dropping a diagram file (export one from the sample first) opens it; a non-diagram file shows the red explanation and stays on the start screen; the wordmark in the editor returns to the start screen.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "Add editor start screen: new diagram, open a file, or try the sample"
```

---

### Task 11: Toolbar, import and export, docs, deploy

**Files:**
- Create: `src/editor/Toolbar.tsx`
- Modify: `src/editor/Editor.tsx`, `docs/PRD.md`, `README.md`

**Interfaces:**
- Consumes: `serializeDiagram`, `emptyDiagram` (diagram.ts); `readDiagramFile`, `downloadText`, `exportFileName` (files.ts, Task 10); `rotateParts`, `deleteSelection` (ops)
- Produces: `Toolbar({ store, notice, onClose }: { store: EditorStore; notice?: string; onClose: () => void })`

- [ ] **Step 1: Write `src/editor/Toolbar.tsx`**

```tsx
import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import { deleteSelection, rotateParts } from './ops.ts'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { downloadText, exportFileName, readDiagramFile } from './files.ts'

export function Toolbar({ store, notice, onClose }: { store: EditorStore; notice?: string; onClose: () => void }) {
  const { diagram, selection } = useEditorState(store)
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(notice ? { kind: 'info', text: notice } : null)
  const hasSel = selection.parts.length + selection.wires.length > 0

  async function importFile(file: File) {
    const r = await readDiagramFile(file)
    if (!r.ok) return setMessage({ kind: 'error', text: r.message })
    store.load(r.diagram)
    setMessage(r.warnings.length ? { kind: 'info', text: `Opened with warnings: ${r.warnings.slice(0, 3).join('; ')}` } : null)
  }

  return (
    <header className="toolbar">
      <button type="button" className="wordmark" onClick={onClose} title="Back to the start screen">Circuitoon</button>
      <span className="title">{diagram.title}</span>
      <button type="button" className="tool" disabled={!store.canUndo} onClick={() => store.undo()}>Undo</button>
      <button type="button" className="tool" disabled={!store.canRedo} onClick={() => store.redo()}>Redo</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" disabled={!selection.parts.length} onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate</button>
      <button type="button" className="tool" disabled={!hasSel} onClick={() => store.commit(deleteSelection(diagram, selection))}>Delete</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" onClick={() => { store.load(emptyDiagram()); setMessage(null) }}>New sheet</button>
      <button type="button" className="tool" onClick={() => fileRef.current?.click()}>Import JSON</button>
      <button type="button" className="tool" onClick={() => downloadText(exportFileName(diagram.title), serializeDiagram(diagram))}>Export JSON</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importFile(f)
          e.target.value = ''
        }}
      />
      {message && <p className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </header>
  )
}
```

Note: "New sheet" discards the current sheet without asking, and the wordmark returns to the start screen. That is acceptable for M1 because there is no persistence yet; M2 adds autosave and the home screen.

- [ ] **Step 2: Use it in `src/editor/Editor.tsx`**

Import `import { Toolbar } from './Toolbar.tsx'` and replace the `<header className="toolbar">...</header>` block (including the temporary notice paragraph from Task 10) with `<Toolbar store={store} notice={notice} onClose={onClose} />`.

- [ ] **Step 3: Update docs**

In `docs/PRD.md`, geometry bullet: replace "A part's `x, y` is the top-left of its unrotated body; rotation is about the body center." with "A part's `x, y` is the top-left of its unrotated body; rotation is about the grid point at or up-left of the body center, so pins stay on the 10 px grid." Make the same edit in the living doc.

In `README.md`, replace the "Early development" line with: "Early development. Live at https://mbarc.github.io/circuitoon/; the editor is at https://mbarc.github.io/circuitoon/#/editor (place parts, draw wires, import and export JSON)."

- [ ] **Step 4: Full verification**

Run: `npm run validate && npm test && npm run build`
Expected: all modules ok, all tests PASS, build succeeds.

Then drive the built app in headless Chrome (own browser via `playwright-core`, never the shared Playwright MCP) at 1280 x 800 and 400 x 800, light and dark, and review screenshots of: landing page, editor start screen (including a failed open), editor at rest, a selected part, a selected wire with inspector, a wire mid-draw, and the import error message (import a file containing `{}`). Fix anything visibly broken before deploying.

- [ ] **Step 5: Commit, push, deploy, confirm live**

```bash
git add -A
git commit -m "Add editor toolbar with undo, rotate, delete, new, import and export"
git push
npm run deploy
```

Then confirm `https://mbarc.github.io/circuitoon/#/editor` loads the editor with no console errors.
