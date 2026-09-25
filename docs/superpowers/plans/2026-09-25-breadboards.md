# Breadboards with Leg Snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five built-in breadboards whose holes are real connection points: parts dropped on a board snap their legs into holes and join those strips electrically, jumpers end in any hole, and moving or rotating a board carries its parts.

**Architecture:** The module format gains hole groups (pins inside the body, one electrical node each) and `obstacle: false`; the diagram format gains hole endpoints (`hole` index) and `mount`. Pure logic lives in `src/format/` (hole geometry, `breadboard.ts` for hole lookup, plugs and seating, `netlist.ts` for nets, a router that accepts free-direction ends) and `src/editor/ops.ts` (mount on drop, carry on move and rotate, unmount on delete). The renderer draws every hole of a module as one SVG path, and the canvas finds the hole under the pointer by arithmetic instead of one DOM element per hole.

**Tech Stack:** Vite 8, React 19, TypeScript 7 (erasable only), vitest 5, SVG, playwright-core (dev only, for the screenshot and browser checks). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-breadboards-design.md` (approved; the authority). Product spec: `docs/PRD.md`. Parts conventions: `.claude/skills/circuitoon-add-part/SKILL.md` and `references/conventions.md`.

## Global Constraints

- Work on branch `breadboards` in `C:/Users/micha/Desktop/projects/Circuitoon`. Never use `git stash` (it is shared between worktrees). Never switch branches in a worktree another agent uses. Do not touch `C:/Users/micha/Desktop/projects/Circuitoon-picos`.
- TypeScript stays erasable-only (`erasableSyntaxOnly`): no enums, no parameter properties, no namespaces.
- No em dashes anywhere (code, comments, UI copy, docs, commit messages); use commas, colons or hyphens.
- Site is served from `/circuitoon/`; use relative or hash URLs only (`#/editor`), never absolute paths.
- Art style is Sticker: flat fills, ink outline `#23282F` added by the renderer, graph-paper sheet `var(--paper)` / `var(--grid)`. Rectangles only in module art.
- Grid is 10 px at 100% zoom; hole pitch is 10 px (0.1 inch); every hole sits on a grid point; parts snap to the grid.
- Connections and mounts reference part `uid`s, never designators.
- Performance budgets (each has a test or a scripted check):
  - The 830-hole full breadboard draws its holes as at most 3 SVG `path` elements; `renderToStaticMarkup` of the board `Part` has a median at or under 30 ms in vitest (`src/render/holes.perf.test.ts`).
  - Seated detection for 20 parts on the full board (`plugsOf` once plus 20 `seatOf` calls) has a median at or under 4 ms; one board-drag frame of model work (`moveParts` of the board carrying 20 parts plus `plugsOf`) at or under 4 ms; `netlist` of that sheet with 10 jumpers at or under 5 ms (`src/format/breadboard.perf.test.ts`).
  - In Chrome on the dev machine, dragging the full board carrying 20 seated parts holds a median frame at or under 17 ms and a 95th percentile at or under 33 ms (`scripts/perf-breadboard.mjs`, Task 13).
- Every task ends with `npm test` and `npm run build` passing and the app working.
- Never use the shared Playwright MCP browser; the scripts in this plan launch their own Chrome through playwright-core.
- No deploy in this plan (shipping is the `circuitoon-ship` skill, later).

## Decisions this plan makes where the spec is open

Each is also noted in the task that implements it.

- A module with hole groups may have an empty `pins` list; without holes, `pins` still needs one entry.
- A **board** is a module with hole groups and `"obstacle": false`. Only boards accept mounts; a pad-header module (future Pi) is an obstacle and does not.
- `hole` omitted on a hole-group endpoint means hole 0. A non-integer `hole` refuses the load; an out-of-range one loads with a warning.
- Hole group names share one namespace with pin names; hole positions must be on the 10 px grid, inside the body, and never on top of another hole.
- Plug point equals the pin's edge point, which is the hole center, so the existing stub already starts at the hole: mounted parts keep their stubs (wires still attach at the stub tip) and a metal leg dot is drawn on the hole.
- Parts with a bus pin, parts with no pins and boards never mount. When legs land on more than one board, the board with the most landed legs is the candidate.
- Only the dragged parts mount or unmount on drop; parts carried by a dragged board keep their mounts; a click without movement never changes a mount.
- Rotating a board carries its mounted parts around the board's pivot (they stay seated). Rotating a part never mounts it; it only drops a mount that no longer fits.
- Deleting a board removes the wires to its holes (as for any part) and unmounts its parts.
- Hole hit-testing is arithmetic (nearest grid point within 3.5 px), not 830 DOM targets. Pressing a hole starts a wire; a board is dragged from between holes, the channel or the margins.
- Boards always draw below every other part, whatever their order in the file.
- Manual routes that end on a hole turn horizontally first at that end.
- Rails: `+` on the outer line and `-` on the inner line at both edges. A rail starts at the grid point nearest to centering it on the columns (the half board's rails start at column 1).
- The tiny board is 5 vertical strips of 5; the power rail strip's groups are named `+` and `-`. Breadboards carry no `source` URL (generic layout). Designator prefix for boards is `BB`.
- Hover highlighting works for pins as well as holes (the PRD's net highlight); net highlight is blue `#3D6FD6`, seated legs green `#2F9E6E`, partial or blocked legs red `#E0483E`.
- The ESP32 DevKit modules are 120 px between header rows, wider than a full board's a-to-j span (110 px), so they cannot seat on these boards; XIAO, C3 SuperMini, ESP32-CAM and the DIP-28 chips can after a 90 degree turn. Fixing DevKit widths is out of scope (Task 8 pins this in a test; Task 12 documents it).
- The generator writes each `[x, y]` hole position on one line so the full board's JSON stays about 2,300 lines.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/format/module.ts` (modify) | `HoleGroup` type, `holes` and `obstacle` fields, validation, `isBoard` |
| `src/format/geometry.ts` (modify) | `worldHoles` (hole centers in world px), `plugPoints` (where legs plug in) |
| `src/format/diagram.ts` (modify) | `mount` and `hole` in the types and validation, `resolveEndpoint`, free-direction manual corners, `obstacle: false` skipped as an obstacle |
| `src/format/router.ts` (modify) | Free-direction start and goal (`fromDir` / `toDir` may be `null`) |
| `src/format/breadboard.ts` (create) | Hole index per board, point keys, `holeAtPoint`, `plugsOf`, `splitBoards`, `seatOf` |
| `src/format/netlist.ts` (create) | `nodeKey`, `netlist` (wires + mounted plugs + `internal`), `netPoints` for hover |
| `src/render/Part.tsx` (modify) | Draws holes and pads from hole groups, one path per style; exports `METAL` |
| `src/render/Boards.tsx` (create) | `TakenHoles` and `LegDots` overlay layers |
| `src/render/Sheet.tsx` (modify) | Boards first, overlays |
| `src/editor/ops.ts` (modify) | `sameEndpoint` with `hole`, `withMounted`, carrying `moveParts`, `settleMounts`, carrying `rotateParts`, unmounting `deleteSelection`, `BB` prefix |
| `src/editor/Canvas.tsx` (modify) | Boards first, overlays, hole wiring and reconnect, seated highlight and settle on drop, carried drag, hover highlight |
| `src/editor/editor.css` (modify) | `.hole-target`, `.seat-ok`, `.seat-bad`, `.net-hi` |
| `src/editor/libraryGroups.ts` (modify) | `Prototyping` after `Batteries` |
| `src/Landing.tsx` (modify) | `countLabel`: "830 holes" instead of "0 pins" |
| `scripts/gen-breadboards.mjs` (create) | Generates the five board modules |
| `modules/breadboard-full.json`, `breadboard-half.json`, `breadboard-mini.json`, `breadboard-tiny.json`, `power-rail-strip.json` (create, generated) | The boards |
| `scripts/perf-breadboard.mjs` (create) | Browser check: frame times while dragging a loaded board, snapping, hover, rotate, delete |
| `docs/PRD.md`, `.claude/skills/circuitoon-add-part/SKILL.md`, `.claude/skills/circuitoon-add-part/references/conventions.md` (modify) | Format rows and conventions |
| Tests: `src/format/holes.test.ts`, `src/format/breadboard.test.ts`, `src/format/netlist.test.ts`, `src/format/breadboards.test.ts`, `src/format/breadboard.perf.test.ts`, `src/render/holes.perf.test.ts` (create); `src/format/router.test.ts`, `src/editor/ops.test.ts`, `src/editor/store.test.ts`, `src/editor/libraryGroups.test.ts`, `src/Landing.test.ts` (modify) | |

### Shared test fixture

Several test files use the same small board and two-lead part. Each file declares them itself (tests stay independent); the definitions are identical everywhere:

```ts
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
```

Handy positions with the board at (0, 0): `two` at (10, 0) plugs L into s1 hole 1 (10, 20) and R into s5 hole 1 (50, 20); `two` at (50, 10) plugs L into s5 hole 2 (50, 30) and R into s9 hole 2 (90, 30).

---

### Task 1: Format types and validation for hole groups, hole endpoints, mounts and obstacles

**Files:**
- Modify: `src/format/module.ts` (types after `Art`, `ModuleDef`, `validateModule` lines 98-135, new `isBoard`)
- Modify: `src/format/diagram.ts` (`PartInstance`, `Endpoint`, `validateDiagram`)
- Create: `src/format/holes.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface HoleGroup { name: string; label?: string; at: [number, number][]; rail?: '+' | '-'; holeStyle?: 'pad' }`
  - `ModuleDef.holes?: HoleGroup[]`, `ModuleDef.obstacle?: boolean`
  - `isBoard(m: ModuleDef | undefined): boolean` (holes and `obstacle === false`)
  - `PartInstance.mount?: { board: string }`
  - `Endpoint.hole?: number`

Decisions: a module with hole groups may have `pins: []`; hole names share the pin namespace; positions must be on the grid, inside the body and unique; `hole` omitted means 0, non-integer is an error, out of range is a warning; a mount must point at a board.

- [ ] **Step 1: Write the failing tests** in `src/format/holes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { isBoard, validateModule, type ModuleDef } from './module.ts'
import { serializeDiagram, validateDiagram, type Diagram } from './diagram.ts'

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

const errorsOf = (raw: unknown) => {
  const r = validateModule(raw)
  return r.ok ? [] : r.errors
}

describe('hole groups in modules', () => {
  it('accepts hole groups with an empty pin list, pads, rails and obstacle false', () => {
    const m = { ...bb, holes: [...bb.holes!, { name: 'VCC', at: [[60, 60]], holeStyle: 'pad' }, { name: 'r', at: [[0, 0]], rail: '+' }] }
    expect(validateModule(m).ok).toBe(true)
  })
  it('still needs a pin when there are no hole groups', () => {
    expect(errorsOf({ ...bb, holes: undefined })).toEqual(['pins: required, at least one pin'])
  })
  it('names every hole group mistake by path', () => {
    const raw = {
      ...bb, obstacle: 'no',
      holes: [
        { name: 's1', at: [[10, 10]] },
        { name: 's1', at: [[15, 10]] },
        { name: 'x', at: [] },
        { name: 'y', at: [[10, 10]], rail: 'x', holeStyle: 'round' },
        { at: [[20, 20]] },
      ],
    }
    expect(errorsOf(raw)).toEqual([
      'holes[1].name: duplicate name "s1" (pins and hole groups share one namespace)',
      'holes[1].at[0]: must sit on the 10 px grid',
      'holes[2].at: required, at least one [x, y] position',
      'holes[3].rail: must be "+" or "-"',
      'holes[3].holeStyle: must be "pad"',
      'holes[3].at[0]: another hole already sits at 10, 10',
      'holes[4].name: required',
      'obstacle: must be true or false',
    ])
  })
  it('refuses a hole group named like a pin', () => {
    expect(errorsOf({ ...two, holes: [{ name: 'L', at: [[10, 10]] }] })).toEqual([
      'holes[0].name: duplicate name "L" (pins and hole groups share one namespace)',
    ])
  })
  it('refuses a hole outside the body', () => {
    expect(errorsOf({ ...bb, holes: [{ name: 'far', at: [[200, 10]] }] })).toEqual(['holes[0].at[0]: outside the body (0 to 100, 0 to 60)'])
  })
  it('lets internal join hole groups', () => {
    expect(validateModule({ ...bb, internal: [['s1', 's9']] }).ok).toBe(true)
  })
  it('calls a module with holes and obstacle false a board, and nothing else', () => {
    expect(isBoard(bb)).toBe(true)
    expect(isBoard({ ...bb, obstacle: undefined })).toBe(false)
    expect(isBoard(two)).toBe(false)
    expect(isBoard(undefined)).toBe(false)
  })
})

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'p', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'q', designator: 'R2', module: 'two', x: 200, y: 0 },
    ],
    connections: [{ uid: 'w1', from: { part: 'b', pin: 's9', hole: 4 }, to: { part: 'q', pin: 'L' } }],
  }
}

describe('hole endpoints and mounts in diagrams', () => {
  it('loads a mounted part and a wire into a hole with no warnings, and round-trips them', () => {
    const d = sheet()
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r).toEqual({ ok: true, diagram: d, warnings: [] })
  })
  it('refuses a hole index that is not a whole number', () => {
    const d = sheet()
    d.connections[0].from.hole = 1.5
    const r = validateDiagram(d)
    expect(r.ok ? [] : r.errors).toEqual(['connections[0].from.hole: must be a whole number, 0 or more'])
  })
  it('loads a hole past the end of its group, with a warning', () => {
    const d = sheet()
    d.connections[0].from.hole = 7
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual(['connections[0].from.hole: group "s9" has 5 holes (0 to 4)'])
  })
  it('warns about a hole index on a plain pin', () => {
    const d = sheet()
    d.connections[0].to.hole = 0
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual(['connections[0].to.hole: pin "L" is not a hole group'])
  })
  it('refuses a malformed mount', () => {
    const d = sheet() as unknown as { parts: Record<string, unknown>[] }
    d.parts[1].mount = 'b'
    const r = validateDiagram(d)
    expect(r.ok ? [] : r.errors).toEqual(['parts[1].mount: must be { "board": <part uid> }'])
  })
  it('loads mounts that point nowhere useful, with warnings', () => {
    const d = sheet()
    d.parts[1].mount = { board: 'zz' }
    d.parts[2].mount = { board: 'p' }
    d.parts.push({ uid: 's', designator: 'R3', module: 'two', x: 300, y: 0, mount: { board: 's' } })
    const r = validateDiagram(d)
    expect(r.ok && r.warnings).toEqual([
      'parts[1].mount.board: no part with uid "zz"',
      'parts[2].mount.board: part "p" is not a board (a module with holes and "obstacle": false)',
      'parts[3].mount.board: a part cannot be mounted on itself',
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/format/holes.test.ts`
Expected: FAIL (`isBoard` is not exported; hole group errors are missing).

- [ ] **Step 3: Add the types and `isBoard` in `src/format/module.ts`**

After the `Art` interface, add:

```ts
/**
 * A hole group: one electrical node whose holes sit inside the body (a breadboard strip or rail,
 * or a single header pad drawn in its true position). Wires reference it by `name`, like a pin.
 */
export interface HoleGroup {
  name: string
  label?: string
  /** Hole centers in module-local px, each on a 10 px grid point inside the body. */
  at: [number, number][]
  /** Marks a power rail, drawn and named as + or -. */
  rail?: '+' | '-'
  /** "pad" draws each position as a header pad instead of a breadboard hole. */
  holeStyle?: 'pad'
}
```

In `ModuleDef`, after `internal?: string[][]`, add:

```ts
  /** Pins inside the body, as hole groups (breadboards, interior headers). */
  holes?: HoleGroup[]
  /** false lets wires route over the part (a breadboard); parts mounted on it are still obstacles. */
  obstacle?: boolean
```

After `insideLabelSides`, add:

```ts
/** A board accepts mounted parts: it has hole groups and is not a routing obstacle (breadboards, rail strips). */
export const isBoard = (m: ModuleDef | undefined): boolean => !!m && !!m.holes?.length && m.obstacle === false
```

- [ ] **Step 4: Validate holes and obstacle in `validateModule`**

Replace the pins check line

```ts
  if (!Array.isArray(raw.pins) || raw.pins.length === 0) errors.push('pins: required, at least one pin')
```

with

```ts
  // A board has only hole groups, so its pin list may be empty.
  const hasHoles = Array.isArray(raw.holes) && raw.holes.length > 0
  if (!Array.isArray(raw.pins) || (raw.pins.length === 0 && !hasHoles)) errors.push('pins: required, at least one pin')
```

Then, between the end of the `raw.pins.forEach(...)` statement and the `if (raw.internal !== undefined) {` block (hole names must be known before `internal` is checked), insert:

```ts
  const positions = new Set<string>()
  if (raw.holes !== undefined) {
    if (!Array.isArray(raw.holes)) errors.push('holes: must be a list of hole groups')
    else
      raw.holes.forEach((g, i) => {
        const at = `holes[${i}]`
        if (!isObj(g)) return void errors.push(`${at}: must be an object`)
        if (typeof g.name !== 'string' || g.name === '') errors.push(`${at}.name: required`)
        else if (names.has(g.name)) errors.push(`${at}.name: duplicate name "${g.name}" (pins and hole groups share one namespace)`)
        else names.add(g.name)
        if (g.label !== undefined && typeof g.label !== 'string') errors.push(`${at}.label: must be a string`)
        if (g.rail !== undefined && g.rail !== '+' && g.rail !== '-') errors.push(`${at}.rail: must be "+" or "-"`)
        if (g.holeStyle !== undefined && g.holeStyle !== 'pad') errors.push(`${at}.holeStyle: must be "pad"`)
        if (!Array.isArray(g.at) || g.at.length === 0) return void errors.push(`${at}.at: required, at least one [x, y] position`)
        g.at.forEach((p, j) => {
          if (!(Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) return void errors.push(`${at}.at[${j}]: must be [x, y]`)
          if (p[0] % GRID !== 0 || p[1] % GRID !== 0) errors.push(`${at}.at[${j}]: must sit on the 10 px grid`)
          const key = `${p[0]},${p[1]}`
          if (positions.has(key)) errors.push(`${at}.at[${j}]: another hole already sits at ${p[0]}, ${p[1]}`)
          positions.add(key)
        })
      })
  }
  if (raw.obstacle !== undefined && typeof raw.obstacle !== 'boolean') errors.push('obstacle: must be true or false')
```

Finally, just before the closing `return errors.length ? ...` line, add the body check. It needs an otherwise valid module, so it runs only when nothing else failed. Hole groups never grow the body; the body comes from `size`, `art` and the pins as before.

```ts
  if (!errors.length && Array.isArray(raw.holes)) {
    const lay = computeLayout(raw as unknown as ModuleDef)
    ;(raw.holes as HoleGroup[]).forEach((g, i) =>
      g.at.forEach(([x, y], j) => {
        if (x < 0 || y < 0 || x > lay.w || y > lay.h) errors.push(`holes[${i}].at[${j}]: outside the body (0 to ${lay.w}, 0 to ${lay.h})`)
      }),
    )
  }
```

(`computeLayout` is a function declaration further down the file, so it is hoisted.)

- [ ] **Step 5: Add `mount` and `hole` to the diagram types and validation in `src/format/diagram.ts`**

Change the import from `./module.ts` to include `isBoard`:

```ts
import { type ModuleDef, isBoard, layoutModule, validateModule, isObj, isNum } from './module.ts'
```

In `PartInstance`, after `values?: Record<string, unknown>`, add:

```ts
  /** The board this part is plugged into. Its pins join the hole groups their plug points sit on. */
  mount?: { board: string }
```

In `Endpoint`, after `offset?: number`, add:

```ts
  /** Which hole of a hole group the wire ends in (default 0). */
  hole?: number
```

In the `raw.parts.forEach` callback, after the rotation check, add:

```ts
      if (p.mount !== undefined && !(isObj(p.mount) && typeof p.mount.board === 'string' && p.mount.board !== ''))
        errors.push(`${at}.mount: must be { "board": <part uid> }`)
```

Right after the whole `raw.parts.forEach(...)` statement (so every part uid is known), add:

```ts
  // Mount targets are checked once every part is known, since a board may come later in the list.
  if (Array.isArray(raw.parts))
    raw.parts.forEach((p, i) => {
      if (!isObj(p) || !isObj(p.mount) || typeof p.mount.board !== 'string' || p.mount.board === '') return
      const board = p.mount.board
      const at = `parts[${i}].mount.board`
      if (board === p.uid) return void warnings.push(`${at}: a part cannot be mounted on itself`)
      const modId = partModule.get(board)
      if (modId === undefined) return void warnings.push(`${at}: no part with uid "${board}"`)
      const m = modules.get(modId)
      if (m && !isBoard(m)) warnings.push(`${at}: part "${board}" is not a board (a module with holes and "obstacle": false)`)
    })
```

Replace the whole `checkEnd` arrow function with:

```ts
  const checkEnd = (ep: unknown, at: string) => {
    if (!isObj(ep) || typeof ep.part !== 'string' || typeof ep.pin !== 'string')
      return void errors.push(`${at}: must be { "part": <uid>, "pin": <name> }`)
    if (ep.offset !== undefined && !isNum(ep.offset)) errors.push(`${at}.offset: must be a number`)
    if (ep.hole !== undefined && !(Number.isInteger(ep.hole) && (ep.hole as number) >= 0))
      errors.push(`${at}.hole: must be a whole number, 0 or more`)
    const modId = partModule.get(ep.part)
    if (modId === undefined) return void warnings.push(`${at}: no part with uid "${ep.part}"`)
    const m = modules.get(modId)
    if (!m) return
    const group = m.holes?.find((g) => g.name === ep.pin)
    if (group) {
      if (typeof ep.hole === 'number' && Number.isInteger(ep.hole) && ep.hole >= group.at.length)
        warnings.push(`${at}.hole: group "${ep.pin}" has ${group.at.length} holes (0 to ${group.at.length - 1})`)
    } else if (!m.pins.some((p) => 'name' in p && p.name === ep.pin)) warnings.push(`${at}: part "${ep.part}" has no pin "${ep.pin}"`)
    else if (ep.hole !== undefined) warnings.push(`${at}.hole: pin "${ep.pin}" is not a hole group`)
  }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/format/holes.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Run everything**

Run: `npm test && npm run validate && npm run build`
Expected: all pass (existing module files still validate; the sample sheet still loads with no warnings).

- [ ] **Step 8: Commit**

```bash
git add src/format/module.ts src/format/diagram.ts src/format/holes.test.ts
git commit -m "Format: hole groups, hole endpoints, mounts and obstacle false, with validation"
```

---

### Task 2: Geometry for hole positions, plug points and hole endpoints

**Files:**
- Modify: `src/format/geometry.ts` (after `worldPins`)
- Modify: `src/format/diagram.ts` (new `ResolvedEnd`, `resolveEndpoint`)
- Test: `src/format/holes.test.ts` (append)

**Interfaces:**
- Consumes: `HoleGroup`, `ModuleDef.holes`, `Endpoint.hole` (Task 1).
- Produces:
  - `interface WorldHoleGroup { name: string; label?: string; rail?: '+' | '-'; style: 'hole' | 'pad'; at: Pt[] }`
  - `worldHoles(part: Placement, m: ModuleDef): WorldHoleGroup[]` (hole centers in world px, in `at` order)
  - `interface PlugPoint { pin: string; at: Pt }`
  - `plugPoints(part: Placement, m: ModuleDef): PlugPoint[]` (each non-bus pin's edge point, in `worldPins` order: sides top, right, bottom, left, so a two-lead part lists R before L)
  - `interface ResolvedEnd { end: Pt; dir: Pt | null }` (null `dir`: the end may leave in any direction)
  - `resolveEndpoint(d: Diagram, ep: Endpoint): ResolvedEnd | null`

Decision: the plug point is the pin's edge point (the spec's rule), which is always a grid point; bus pins have no plug point.

- [ ] **Step 1: Write the failing tests** (append to `src/format/holes.test.ts`; add `import { plugPoints, worldHoles } from './geometry.ts'` and add `resolveEndpoint` to the `./diagram.ts` import)

```ts
describe('hole geometry', () => {
  it('places hole centers in world px, in list order', () => {
    const [s1] = worldHoles({ x: 100, y: 100 }, bb)
    expect(s1.name).toBe('s1')
    expect(s1.style).toBe('hole')
    expect(s1.at).toEqual([{ x: 110, y: 110 }, { x: 110, y: 120 }, { x: 110, y: 130 }, { x: 110, y: 140 }, { x: 110, y: 150 }])
  })
  it('turns holes with the board', () => {
    // local (10, 10) is (-40, -20) from the pivot (50, 30); a quarter turn makes it (20, -40)
    expect(worldHoles({ x: 100, y: 100, rotation: 90 }, bb)[0].at[0]).toEqual({ x: 170, y: 90 })
  })
  it('has no holes for a module without hole groups', () => {
    expect(worldHoles({ x: 0, y: 0 }, two)).toEqual([])
  })
  it('plugs each pin in at its edge point, rotated with the part', () => {
    expect(plugPoints({ x: 110, y: 100 }, two)).toEqual([{ pin: 'R', at: { x: 150, y: 120 } }, { pin: 'L', at: { x: 110, y: 120 } }])
    expect(plugPoints({ x: 0, y: 0, rotation: 90 }, two)).toEqual([{ pin: 'R', at: { x: 10, y: 30 } }, { pin: 'L', at: { x: 10, y: -10 } }])
  })
  it('gives a bus pin no plug point', () => {
    const rail: ModuleDef = {
      format: 'circuitoon-module/1', id: 'rail', name: 'Rail',
      pins: [{ name: 'bus', side: 'top', bus: { length: 5 } }, { name: 'X', side: 'bottom' }],
    }
    expect(plugPoints({ x: 0, y: 0 }, rail).map((p) => p.pin)).toEqual(['X'])
  })
})

describe('resolveEndpoint', () => {
  const d = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 100, y: 100, rotation: 90 }, { uid: 'q', designator: 'R1', module: 'two', x: 0, y: 0 }],
    connections: [],
  })
  it('resolves a hole to its rotated center with a free direction', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1', hole: 0 })).toEqual({ end: { x: 170, y: 90 }, dir: null })
  })
  it('treats a missing hole index as hole 0', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1' })).toEqual({ end: { x: 170, y: 90 }, dir: null })
  })
  it('is null for a hole past the end, a missing group or a missing part', () => {
    expect(resolveEndpoint(d(), { part: 'b', pin: 's1', hole: 5 })).toBeNull()
    expect(resolveEndpoint(d(), { part: 'b', pin: 'nope' })).toBeNull()
    expect(resolveEndpoint(d(), { part: 'zz', pin: 's1' })).toBeNull()
  })
  it('resolves a pin to its stub tip and direction', () => {
    expect(resolveEndpoint(d(), { part: 'q', pin: 'R' })).toEqual({ end: { x: 48, y: 20 }, dir: { x: 1, y: 0 } })
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/holes.test.ts`
Expected: FAIL (`worldHoles`, `plugPoints`, `resolveEndpoint` are not exported).

- [ ] **Step 3: Add `worldHoles` and `plugPoints` to `src/format/geometry.ts`** (after `worldPins`)

```ts
export interface WorldHoleGroup {
  name: string
  label?: string
  rail?: '+' | '-'
  style: 'hole' | 'pad'
  /** Hole centers in world px, in the group's `at` order. */
  at: Pt[]
}

/** Every hole group of a placed module, with its hole centers in world px. Empty for a module without holes. */
export function worldHoles(part: Placement, m: ModuleDef): WorldHoleGroup[] {
  if (!m.holes?.length) return []
  const lay = layoutModule(m)
  return m.holes.map((g) => ({
    name: g.name,
    label: g.label,
    rail: g.rail,
    style: g.holeStyle ?? 'hole',
    at: g.at.map(([x, y]) => toWorld(part, lay, { x, y })),
  }))
}

export interface PlugPoint {
  pin: string
  at: Pt
}

/**
 * Where each pin plugs into a board: its edge point on the body, always a grid point, so a leg
 * lands exactly on a hole. A bus pin has no plug point.
 */
export function plugPoints(part: Placement, m: ModuleDef): PlugPoint[] {
  return worldPins(part, m).filter((p) => !p.bus).map((p) => ({ pin: p.name, at: p.edge }))
}
```

- [ ] **Step 4: Add `resolveEndpoint` to `src/format/diagram.ts`**

Change the geometry import to:

```ts
import { type Pt, type Rect, type Rotation, type WorldPin, bodyRect, simplify, toWorld, worldPins } from './geometry.ts'
```

After the existing `endpoint` function, add:

```ts
/** A wire end in world px: where the wire attaches, and the way it must leave (null: any way, a hole). */
export interface ResolvedEnd {
  end: Pt
  dir: Pt | null
}

/**
 * Resolves a connection end. A pin resolves to its stub tip and outward direction; a hole group
 * resolves to the center of hole `ep.hole` (default 0), which a wire may leave in any direction.
 * Null when the part, pin, group or hole does not exist.
 */
export function resolveEndpoint(d: Diagram, ep: Endpoint): ResolvedEnd | null {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && moduleOf(d, part.module)
  if (!part || !mod) return null
  const group = mod.holes?.find((g) => g.name === ep.pin)
  if (group) {
    const local = group.at[ep.hole ?? 0]
    return local ? { end: toWorld(part, layoutModule(mod), { x: local[0], y: local[1] }), dir: null } : null
  }
  const pin = worldPins(part, mod).find((p) => p.name === ep.pin)
  return pin ? { end: pin.end, dir: pin.dir } : null
}
```

(`routeWire` keeps using `endpoint` until Task 4, so hole wires are not drawn yet; nothing in the UI can make one yet.)

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/format/holes.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/format/geometry.ts src/format/diagram.ts src/format/holes.test.ts
git commit -m "Geometry: world hole centers, plug points and hole endpoint resolution"
```

---

### Task 3: Hole index, plugs and the netlist

**Files:**
- Create: `src/format/breadboard.ts`, `src/format/netlist.ts`
- Create: `src/format/breadboard.test.ts`, `src/format/netlist.test.ts`

**Interfaces:**
- Consumes: `isBoard`, `worldHoles`, `plugPoints`, `PartInstance.mount` (Tasks 1-2).
- Produces (`src/format/breadboard.ts`):
  - `pointKey(x: number, y: number): number` (one number per world grid point)
  - `interface HoleIndex { groups: WorldHoleGroup[]; byPoint: Map<number, [number, number]> }` (point key to [group index, hole index])
  - `holeIndex(part: PartInstance, m: ModuleDef): HoleIndex` (cached by part object identity)
  - `interface Plug { part: string; pin: string; board: string; group: string; hole: number; at: Pt }`
  - `plugsOf(d: Diagram): Plug[]`
- Produces (`src/format/netlist.ts`):
  - `nodeKey(part: string, pin: string): string`
  - `interface Netlist { nets: string[][]; netOf: Map<string, number> }`
  - `netlist(d: Diagram, plugs?: Plug[]): Netlist`

A node is a part pin or a hole group (`nodeKey(part uid, pin or group name)`). Nets of a single node are left out; each net's nodes are sorted and nets are sorted by their first node, so the output is deterministic. Hole index lookups assume boards sit on the grid, which the editor guarantees (parts snap); a hand-edited board off the grid simply plugs nothing.

- [ ] **Step 1: Write the failing tests** in `src/format/breadboard.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { holeIndex, plugsOf, pointKey } from './breadboard.ts'
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

function sheet(): Diagram {
  return {
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      { uid: 'p2', designator: 'R2', module: 'two', x: 50, y: 10, mount: { board: 'b' } },
    ],
    connections: [],
  }
}

describe('holeIndex', () => {
  it('maps each world grid point to its group and hole', () => {
    const d = sheet()
    const idx = holeIndex(d.parts[0], bb)
    expect(idx.byPoint.size).toBe(45)
    expect(idx.byPoint.get(pointKey(50, 30))).toEqual([4, 2])
    expect(idx.groups[4].name).toBe('s5')
    expect(idx.byPoint.get(pointKey(55, 30))).toBeUndefined()
  })
  it('is cached per part object and rebuilt for a moved part', () => {
    const d = sheet()
    expect(holeIndex(d.parts[0], bb)).toBe(holeIndex(d.parts[0], bb))
    const moved = { ...d.parts[0], x: 100 }
    expect(holeIndex(moved, bb).byPoint.get(pointKey(110, 10))).toEqual([0, 0])
  })
})

describe('plugsOf', () => {
  it('plugs every leg of every mounted part into the hole under it', () => {
    expect(plugsOf(sheet())).toEqual([
      { part: 'p1', pin: 'R', board: 'b', group: 's5', hole: 1, at: { x: 50, y: 20 } },
      { part: 'p1', pin: 'L', board: 'b', group: 's1', hole: 1, at: { x: 10, y: 20 } },
      { part: 'p2', pin: 'R', board: 'b', group: 's9', hole: 2, at: { x: 90, y: 30 } },
      { part: 'p2', pin: 'L', board: 'b', group: 's5', hole: 2, at: { x: 50, y: 30 } },
    ])
  })
  it('plugs nothing for unmounted parts, missing or non-board targets, or legs off the holes', () => {
    const d = sheet()
    d.parts[1] = { ...d.parts[1], mount: undefined }
    d.parts[2] = { ...d.parts[2], mount: { board: 'zz' } }
    d.parts.push({ uid: 'p3', designator: 'R3', module: 'two', x: 200, y: 0, mount: { board: 'p1' } })
    d.parts.push({ uid: 'p4', designator: 'R4', module: 'two', x: 15, y: 0, mount: { board: 'b' } })
    expect(plugsOf(d)).toEqual([])
  })
})
```

And `src/format/netlist.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/breadboard.test.ts src/format/netlist.test.ts`
Expected: FAIL (the modules do not exist).

- [ ] **Step 3: Create `src/format/breadboard.ts`**

```ts
// Breadboards on a diagram: which world grid point is which hole, and which mounted legs plug
// into which holes. Pure; per-board hole lookups are cached by part object identity, and parts
// are replaced (never mutated) on every edit, so a moved board simply gets a fresh index.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import { type Pt, type WorldHoleGroup, plugPoints, worldHoles } from './geometry.ts'
import { type ModuleDef, isBoard } from './module.ts'

const OFF = 2 ** 25
/** One number per world grid point (x and y within +-2^25 px). */
export const pointKey = (x: number, y: number): number => (x + OFF) * 2 ** 26 + (y + OFF)

export interface HoleIndex {
  groups: WorldHoleGroup[]
  /** Point key to [group index, hole index]. */
  byPoint: Map<number, [number, number]>
}

const indexCache = new WeakMap<PartInstance, { m: ModuleDef; index: HoleIndex }>()

/** World hole positions of a part with hole groups, and a lookup from grid point to hole. */
export function holeIndex(part: PartInstance, m: ModuleDef): HoleIndex {
  const hit = indexCache.get(part)
  if (hit && hit.m === m) return hit.index
  const groups = worldHoles(part, m)
  const byPoint = new Map<number, [number, number]>()
  groups.forEach((g, gi) => g.at.forEach((p, hi) => byPoint.set(pointKey(p.x, p.y), [gi, hi])))
  const index = { groups, byPoint }
  indexCache.set(part, { m, index })
  return index
}

export interface Plug {
  part: string
  pin: string
  board: string
  group: string
  hole: number
  /** The hole center, which is also the pin's plug point. */
  at: Pt
}

/**
 * Every plugged leg on the sheet, from each part's `mount` and positions: a mounted part's pin
 * plugs into the hole its plug point sits on. A leg off every hole plugs nothing; a mount to a
 * missing part or to a part that is not a board plugs nothing.
 */
export function plugsOf(d: Diagram): Plug[] {
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const out: Plug[] = []
  for (const p of d.parts) {
    if (!p.mount) continue
    const board = byUid.get(p.mount.board)
    const bm = board && moduleOf(d, board.module)
    const m = moduleOf(d, p.module)
    if (!board || board === p || !bm || !m || !isBoard(bm)) continue
    const idx = holeIndex(board, bm)
    for (const pp of plugPoints(p, m)) {
      const hit = idx.byPoint.get(pointKey(pp.at.x, pp.at.y))
      if (hit) out.push({ part: p.uid, pin: pp.pin, board: board.uid, group: idx.groups[hit[0]].name, hole: hit[1], at: pp.at })
    }
  }
  return out
}
```

- [ ] **Step 4: Create `src/format/netlist.ts`**

```ts
// Nets: sets of pins and hole groups joined by wires, mounted legs and `internal` groups. Feeds
// hover highlighting now and the V2 simulation later. Pure.
import { type Diagram, moduleOf } from './diagram.ts'
import { type Plug, plugsOf } from './breadboard.ts'

/** One key per part pin or hole group; JSON keeps any character in a uid or name unambiguous. */
export const nodeKey = (part: string, pin: string): string => JSON.stringify([part, pin])

export interface Netlist {
  /** Each net's node keys, sorted; nets sorted by their first node. Single nodes are left out. */
  nets: string[][]
  /** Node key to its index in `nets`. */
  netOf: Map<string, number>
}

export function netlist(d: Diagram, plugs: Plug[] = plugsOf(d)): Netlist {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) root = up
    for (let cur = k; cur !== root; ) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const c of d.connections) join(nodeKey(c.from.part, c.from.pin), nodeKey(c.to.part, c.to.pin))
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    for (const group of m?.internal ?? []) for (let i = 1; i < group.length; i++) join(nodeKey(p.uid, group[0]), nodeKey(p.uid, group[i]))
  }
  for (const pl of plugs) join(nodeKey(pl.part, pl.pin), nodeKey(pl.board, pl.group))

  const byRoot = new Map<string, string[]>()
  for (const k of parent.keys()) {
    const r = find(k)
    const list = byRoot.get(r)
    if (list) list.push(k)
    else byRoot.set(r, [k])
  }
  const nets = [...byRoot.values()].filter((n) => n.length > 1).map((n) => n.sort())
  nets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const netOf = new Map<string, number>()
  nets.forEach((n, i) => n.forEach((k) => netOf.set(k, i)))
  return { nets, netOf }
}
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/format/breadboard.test.ts src/format/netlist.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/format/breadboard.ts src/format/netlist.ts src/format/breadboard.test.ts src/format/netlist.test.ts
git commit -m "Hole index, mounted plugs and a netlist merging wires, legs and internal joins"
```

---

### Task 4: Router free-direction ends, hole wires and boards that wires cross

**Files:**
- Modify: `src/format/router.ts` (`RouteRequest`, `routeOrthogonal`, `search`)
- Modify: `src/format/diagram.ts` (`partObstacles`, `manualPoints`, `routeWire`; remove `endpoint`)
- Test: `src/format/router.test.ts` (append), `src/format/holes.test.ts` (append)

**Interfaces:**
- Consumes: `resolveEndpoint`, `ResolvedEnd` (Task 2), `ModuleDef.obstacle` (Task 1).
- Produces: `RouteRequest.fromDir: Pt | null` and `RouteRequest.toDir: Pt | null`. With `null`, the search starts at the point itself (snapped to the grid) with all four headings seeded at cost 0, or accepts any arrival heading at the goal. `partObstacles` skips modules with `obstacle: false`. `routeWire` routes hole ends.

Decision: a manual route turns horizontally first where it meets a hole end.

- [ ] **Step 1: Write the failing router tests** (append to `src/format/router.test.ts`; `left`, `right`, `down`, `orthogonal` and `crosses` are already defined at the top of that file)

```ts
describe('free-direction ends (holes)', () => {
  it('leaves a free start in whichever direction reaches the goal straight', () => {
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 100, y: 0 }, toDir: left, obstacles: [] })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 0, y: -100 }, toDir: down, obstacles: [] })).toEqual([{ x: 0, y: 0 }, { x: 0, y: -100 }])
  })
  it('joins two free ends with a single bend', () => {
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 50, y: 30 }, toDir: null, obstacles: [] })!
    expect(pts).toHaveLength(3)
    expect(orthogonal(pts)).toBe(true)
    expect(pts[2]).toEqual({ x: 50, y: 30 })
  })
  it('arrives at a free goal from any side', () => {
    // The pin leaves right and may not reverse, so it comes back to the hole from the right.
    expect(routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: right, to: { x: 0, y: 30 }, toDir: null, obstacles: [] })).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ])
  })
  it('still goes around obstacles from a free start', () => {
    const block = { x: 40, y: -20, w: 20, h: 40 }
    const pts = routeOrthogonal({ from: { x: 0, y: 0 }, fromDir: null, to: { x: 100, y: 0 }, toDir: null, obstacles: [block] })!
    expect(orthogonal(pts)).toBe(true)
    expect(crosses(pts, block)).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing diagram tests** (append to `src/format/holes.test.ts`; add `computeRoutes, partObstacles` to the `./diagram.ts` import)

```ts
describe('routing with boards and holes', () => {
  it('routes wires straight over a board, which is not an obstacle', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [
        { uid: 'a', designator: 'R1', module: 'two', x: 0, y: 0 },
        { uid: 'b', designator: 'BB1', module: 'bb', x: 60, y: -10 },
        { uid: 'c', designator: 'R2', module: 'two', x: 200, y: 0 },
      ],
      connections: [{ uid: 'w', from: { part: 'a', pin: 'R' }, to: { part: 'c', pin: 'L' } }],
    }
    expect(partObstacles(d)).toHaveLength(2)
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 48, y: 20 }, { x: 192, y: 20 }], blocked: false })
  })
  it('routes a wire from a hole center', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'a', designator: 'R1', module: 'two', x: 100, y: -10 }],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'a', pin: 'L' } }],
    }
    expect(computeRoutes(d).get('w')).toEqual({ points: [{ x: 10, y: 10 }, { x: 92, y: 10 }], blocked: false })
  })
  it('turns a manual route horizontally first at a hole end', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [{ uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 }, { uid: 'a', designator: 'R1', module: 'two', x: 100, y: 50 }],
      connections: [{ uid: 'w', from: { part: 'b', pin: 's1', hole: 0 }, to: { part: 'a', pin: 'L' }, route: [[50, 40]] }],
    }
    expect(computeRoutes(d).get('w')).toEqual({
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 50, y: 70 }, { x: 92, y: 70 }],
      blocked: false,
    })
  })
})
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/format/router.test.ts src/format/holes.test.ts`
Expected: FAIL (null directions throw in `leave` and `dirIndex`; the board is an obstacle; hole wires resolve to nothing).

- [ ] **Step 4: Make the router accept free ends in `src/format/router.ts`**

In `RouteRequest`, change the two direction fields to:

```ts
  /** Outward direction at `from`; null for a hole, which a wire may leave in any direction. */
  fromDir: Pt | null
```

and

```ts
  /** Outward direction at `to`; null for a hole, which a wire may enter from any side. */
  toDir: Pt | null
```

After `leave`, add:

```ts
/** Nearest grid point to `p` (a hole center is already on the grid). */
const onGrid = (p: Pt, g: number): Pt => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g })
```

In `routeOrthogonal`, replace the `start` and `goal` lines with:

```ts
  const start = req.fromDir ? leave(req.from, req.fromDir, g) : onGrid(req.from, g)
  const goal = req.toDir ? leave(req.to, req.toDir, g) : onGrid(req.to, g)
```

In `search`, replace

```ts
  const endDir = dirIndex({ x: -req.toDir.x, y: -req.toDir.y })
  const { cost, prev, closed, heap } = buffers(cols * rows * 4)

  const s = startCell * 4 + dirIndex(req.fromDir)
  cost[s] = 0
  prev[s] = -1 // the scratch back-pointers are not cleared; every other state on a path is written before it is read
  heap.push(s, (Math.abs((startCell % cols) - gc) + Math.abs(Math.floor(startCell / cols) - gr)) * g)
```

with

```ts
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
```

Replace

```ts
    const lanes = parallel !== null && state !== s
```

with

```ts
    // Only seed states cost 0 (every other state is at least one step in).
    const lanes = parallel !== null && !(here === 0 && cell === startCell)
```

(`const here = cost[state]` is declared just above; if it is below, move it above this line.) And replace

```ts
      if (ncell === goalCell) {
        if (nd !== endDir) c += bendCost
      }
```

with

```ts
      if (ncell === goalCell) {
        if (endDir >= 0 && nd !== endDir) c += bendCost
      }
```

- [ ] **Step 5: Route hole ends and skip non-obstacles in `src/format/diagram.ts`**

Replace `partObstacles` with:

```ts
/** Part bodies wires must route around. A module with `obstacle: false` (a breadboard) is not one. */
export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    return m && m.obstacle !== false ? [bodyRect(p, layoutModule(m))] : []
  })
}
```

Delete the old `endpoint` function. Replace `manualPoints` with a version that takes resolved ends:

```ts
function manualPoints(a: ResolvedEnd, b: ResolvedEnd, route: [number, number][]): Pt[] {
  const bends = route.map(([x, y]) => ({ x, y }))
  const corner = (pin: ResolvedEnd, next: Pt | undefined): Pt[] => {
    if (!next || next.x === pin.end.x || next.y === pin.end.y) return []
    // A hole end may leave any way; it turns horizontally first, like a pin on a left or right edge.
    const horizontal = pin.dir === null || pin.dir.x !== 0
    return [horizontal ? { x: next.x, y: pin.end.y } : { x: pin.end.x, y: next.y }]
  }
  // No bends left (every one removed by hand): still one corner, never a diagonal.
  const head = corner(a, bends.length ? bends[0] : b.end)
  const tail = bends.length ? corner(b, bends[bends.length - 1]) : []
  return tidy([a.end, ...head, ...bends, ...tail, b.end])
}
```

Keep its existing doc comment. In `routeWire`, replace the two `endpoint(...)` calls with `resolveEndpoint(...)`:

```ts
  const a = resolveEndpoint(d, c.from)
  const b = resolveEndpoint(d, c.to)
```

Remove `type WorldPin` from the geometry import (it is no longer used in this file).

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run src/format/router.test.ts src/format/holes.test.ts src/format/diagram.test.ts src/format/wireEdit.test.ts`
Expected: PASS, including every existing router and diagram test (pin-to-pin routing is unchanged).

- [ ] **Step 7: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/format/router.ts src/format/diagram.ts src/format/router.test.ts src/format/holes.test.ts
git commit -m "Router: free-direction hole ends; wires route over boards; hole wires drawn"
```

---

### Task 5: Hole rendering, board layering and leg overlays

**Files:**
- Modify: `src/render/Part.tsx` (export `METAL`, add `holePathData` and hole drawing)
- Create: `src/render/Boards.tsx`
- Modify: `src/format/breadboard.ts` (add `splitBoards`)
- Modify: `src/render/Sheet.tsx`, `src/editor/Canvas.tsx` (boards first, overlays)
- Create: `src/render/holes.perf.test.ts`
- Test: `src/format/breadboard.test.ts` (append)

**Interfaces:**
- Consumes: `HoleGroup`, `isBoard` (Task 1), `plugsOf`, `Plug` (Task 3).
- Produces:
  - `holePathData(m: ModuleDef): { holes: string; pads: string; padHoles: string }` (SVG path data in module-local px, cached per module)
  - `METAL` exported from `src/render/Part.tsx`
  - `splitBoards(d: Diagram): { boards: PartInstance[]; others: PartInstance[] }` (file order kept inside each list)
  - `TakenHoles({ plugs }: { plugs: Plug[] })` and `LegDots({ plugs }: { plugs: Plug[] })` components; `LegDots` renders `<g data-legs="">` with one `circle` per plug

Decisions: holes are dark squares (`#3A3F47`, 3.4 px), pads are gold squares with a hole; taken holes darken to `#15181C`; each plugged leg gets a metal dot (r 2.2) on its hole. Boards draw below every other part.

- [ ] **Step 1: Write the failing tests**

Append to `src/format/breadboard.test.ts` (add `splitBoards` to the `./breadboard.ts` import):

```ts
describe('splitBoards', () => {
  it('puts boards first, keeping file order within each layer', () => {
    const d = sheet()
    d.parts = [d.parts[1], d.parts[0], d.parts[2]]
    const { boards, others } = splitBoards(d)
    expect(boards.map((p) => p.uid)).toEqual(['b'])
    expect(others.map((p) => p.uid)).toEqual(['p1', 'p2'])
  })
})
```

Create `src/render/holes.perf.test.ts`:

```ts
// Budget test: an 830-hole board draws its holes as one path and renders fast enough to drag.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Part, holePathData } from './Part.tsx'
import type { HoleGroup, ModuleDef } from '../format/module.ts'

/** Same hole layout as the full breadboard: 63 columns of two 5-hole strips plus four 50-hole rails. */
function fullBoard(): ModuleDef {
  const holes: HoleGroup[] = []
  for (let c = 1; c <= 63; c++) {
    holes.push({ name: `c${c}-top`, at: [60, 70, 80, 90, 100].map((y) => [20 + c * 10, y] as [number, number]) })
    holes.push({ name: `c${c}-bot`, at: [130, 140, 150, 160, 170].map((y) => [20 + c * 10, y] as [number, number]) })
  }
  const xs: number[] = []
  for (let k = 0; xs.length < 50; k++) if (k % 6 !== 5) xs.push(50 + k * 10)
  for (const [name, y] of [['top+', 20], ['top-', 30], ['bottom-', 200], ['bottom+', 210]] as const)
    holes.push({ name, at: xs.map((x) => [x, y] as [number, number]) })
  return { format: 'circuitoon-module/1', id: 'full', name: 'Full', pins: [], holes, obstacle: false, size: { w: 68, h: 23 } }
}

function median(fn: () => void, runs = 15): number {
  for (let i = 0; i < 3; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

describe('hole rendering budget', () => {
  it('draws 830 holes as a single path', () => {
    const m = fullBoard()
    const p = holePathData(m)
    expect(p.holes.match(/M/g)).toHaveLength(830)
    expect(p.pads).toBe('')
    const markup = renderToStaticMarkup(createElement(Part, { module: m }))
    const group = markup.match(/<g data-holes="">(.*?)<\/g>/)![1]
    expect(group.match(/<path/g)).toHaveLength(1)
  })
  it('renders the 830-hole board in 30 ms or less (median, uncached module)', () => {
    const base = fullBoard()
    // A fresh module object each run defeats the per-module path cache, so the path is rebuilt too.
    const ms = median(() => renderToStaticMarkup(createElement(Part, { module: { ...base } })))
    expect(ms).toBeLessThanOrEqual(30)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/breadboard.test.ts src/render/holes.perf.test.ts`
Expected: FAIL (`splitBoards` and `holePathData` do not exist).

- [ ] **Step 3: Add `splitBoards` to `src/format/breadboard.ts`**

```ts
/** Boards first, so parts on a board draw above it whatever the file order; file order is kept within each list. */
export function splitBoards(d: Diagram): { boards: PartInstance[]; others: PartInstance[] } {
  const boards: PartInstance[] = []
  const others: PartInstance[] = []
  for (const p of d.parts) (isBoard(moduleOf(d, p.module)) ? boards : others).push(p)
  return { boards, others }
}
```

- [ ] **Step 4: Draw holes in `src/render/Part.tsx`**

Change `const METAL = '#C9CED6'` to `export const METAL = '#C9CED6'`. After `PinStub`, add:

```tsx
const HOLE = '#3A3F47'
const HOLE_SIZE = 3.4
const PAD = '#E0B43C'
const PAD_SIZE = 7
const PAD_HOLE = '#8A6A1E'
const PAD_HOLE_SIZE = 3

const holePaths = new WeakMap<ModuleDef, { holes: string; pads: string; padHoles: string }>()

/**
 * Every hole of a module as one path per style (breadboard holes, header pads, pad holes), in
 * module-local px, so an 830-hole board is three SVG elements rather than 830. Cached per module.
 */
export function holePathData(m: ModuleDef): { holes: string; pads: string; padHoles: string } {
  const hit = holePaths.get(m)
  if (hit) return hit
  const square = (x: number, y: number, s: number) => `M${x - s / 2} ${y - s / 2}h${s}v${s}h${-s}z`
  let holes = ''
  let pads = ''
  let padHoles = ''
  for (const g of m.holes ?? [])
    for (const [x, y] of g.at) {
      if (g.holeStyle === 'pad') {
        pads += square(x, y, PAD_SIZE)
        padHoles += square(x, y, PAD_HOLE_SIZE)
      } else holes += square(x, y, HOLE_SIZE)
    }
  const out = { holes, pads, padHoles }
  holePaths.set(m, out)
  return out
}

/** Holes and pads, drawn above the art in body coordinates (they rotate with the part). */
function Holes({ m }: { m: ModuleDef }) {
  const p = holePathData(m)
  return (
    <g data-holes="">
      {p.holes && <path d={p.holes} fill={HOLE} />}
      {p.pads && <path d={p.pads} fill={PAD} stroke={INK} strokeWidth={0.8} />}
      {p.padHoles && <path d={p.padHoles} fill={PAD_HOLE} />}
    </g>
  )
}
```

In the `Part` component, inside the rotated `<g transform={rotation ? ...}>`, right after the art-or-plain-box block (after its closing `)}`) and before that `</g>`, add:

```tsx
        {m.holes?.length ? <Holes m={m} /> : null}
```

- [ ] **Step 5: Create `src/render/Boards.tsx`**

```tsx
// Breadboard overlays drawn from the diagram: taken holes darken slightly, and every plugged leg
// gets a metal dot on its hole center. Neither takes pointer events, so holes and parts below
// stay clickable.
import type { Plug } from '../format/breadboard.ts'
import { INK, METAL } from './Part.tsx'

const TAKEN = '#15181C'

/** Darkens every hole a mounted leg sits in; drawn above the boards and below the parts. */
export function TakenHoles({ plugs }: { plugs: Plug[] }) {
  if (!plugs.length) return null
  const d = plugs.map((p) => `M${p.at.x - 2} ${p.at.y - 2}h4v4h-4z`).join('')
  return <path d={d} fill={TAKEN} pointerEvents="none" />
}

/** One metal leg dot per plugged pin, drawn above the parts so it shows where each leg goes in. */
export function LegDots({ plugs }: { plugs: Plug[] }) {
  return (
    <g data-legs="" pointerEvents="none">
      {plugs.map((p) => (
        <circle key={`${p.part}:${p.pin}`} cx={p.at.x} cy={p.at.y} r={2.2} fill={METAL} stroke={INK} strokeWidth={1} />
      ))}
    </g>
  )
}
```

- [ ] **Step 6: Layer boards first in `src/render/Sheet.tsx`**

Add imports:

```tsx
import type { PartInstance } from '../format/diagram.ts'
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { LegDots, TakenHoles } from './Boards.tsx'
```

After `const wires = wirePaths(diagram, routes)`, add:

```tsx
  const { boards, others } = splitBoards(diagram)
  const plugs = plugsOf(diagram)
  const part = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    return m ? (
      <Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={captions[p.uid] ?? partCaption(p, m)} values={p.values} />
    ) : null
  }
```

Replace the whole `{diagram.parts.map((p) => { ... })}` block with:

```tsx
      {boards.map(part)}
      <TakenHoles plugs={plugs} />
      {others.map(part)}
      <LegDots plugs={plugs} />
```

- [ ] **Step 7: Layer boards first in `src/editor/Canvas.tsx`**

Add imports:

```tsx
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { LegDots, TakenHoles } from '../render/Boards.tsx'
```

After the `wires` `useMemo`, add:

```tsx
  // Boards draw below every other part; the leg overlays follow mounts and positions.
  const layers = useMemo(() => splitBoards(diagram), [diagram.parts, diagram.modules])
  const plugs = useMemo(() => plugsOf(diagram), [diagram.parts, diagram.modules])
```

Just before the `return (` of `Canvas`, add:

```tsx
  const renderPart = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    return m ? (
      <g key={p.uid} data-part={p.uid}>
        {selection.parts.includes(p.uid) && (() => {
          const r = bodyRect(p, layoutModule(m))
          return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={6} fill="none" stroke="var(--focus)" strokeWidth={1.5} strokeDasharray="5 4" />
        })()}
        <Part module={m} x={p.x} y={p.y} rotation={p.rotation} caption={partCaption(p, m)} values={p.values} />
      </g>
    ) : null
  }
```

Replace the first `{diagram.parts.map((p) => { ... })}` block in the JSX (the one that draws `<g key={p.uid} data-part={p.uid}>`, right after the two background `rect`s) with:

```tsx
        {layers.boards.map(renderPart)}
        <TakenHoles plugs={plugs} />
        {layers.others.map(renderPart)}
        <LegDots plugs={plugs} />
```

Leave the second `diagram.parts.map` (the `PinTargets` layer) as it is.

- [ ] **Step 8: Run to see them pass**

Run: `npx vitest run src/format/breadboard.test.ts src/render/holes.perf.test.ts`
Expected: PASS. If the timing test fails, profile `holePathData` first (string building) before touching the budget.

- [ ] **Step 9: Run everything**

Run: `npm test && npm run build`
Expected: PASS. No module has holes yet, so the app looks unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/render/Part.tsx src/render/Boards.tsx src/render/Sheet.tsx src/editor/Canvas.tsx src/format/breadboard.ts src/format/breadboard.test.ts src/render/holes.perf.test.ts
git commit -m "Render holes from hole groups as one path; boards below parts; taken holes and leg dots"
```

---

### Task 6: Wiring to holes

**Files:**
- Modify: `src/format/breadboard.ts` (add `HoleRef`, `holeAtPoint`)
- Modify: `src/editor/ops.ts` (`sameEndpoint` exported, compares `hole`)
- Modify: `src/editor/Canvas.tsx` (hole hit-testing, wire start, drop and reconnect on holes, target ring, routes key)
- Modify: `src/editor/editor.css` (`.hole-target`)
- Test: `src/format/breadboard.test.ts` (append), `src/editor/ops.test.ts` (append)

**Interfaces:**
- Consumes: `holeIndex`, `pointKey` (Task 3), `resolveEndpoint` (Task 2).
- Produces:
  - `interface HoleRef { board: string; group: string; hole: number }`
  - `holeAtPoint(part: PartInstance, m: ModuleDef, p: Pt, radius?: number): HoleRef | null` (default radius 3.5 px)
  - `sameEndpoint(a: Endpoint, b: Endpoint): boolean` (part, pin and `hole ?? 0` all equal)
  - Canvas: `holeUnder(e)` and `endUnder(e)` (pin first, then hole) inside `Canvas`

Decision: hole targets are found by arithmetic (the nearest grid point within 3.5 px of the pointer on the topmost part that has holes), not one DOM element per hole. Pressing a hole starts a wire. Two wires into different holes of the same strip are allowed; only an identical end is a duplicate.

- [ ] **Step 1: Write the failing tests**

Append to `src/format/breadboard.test.ts` (add `holeAtPoint` to the import):

```ts
describe('holeAtPoint', () => {
  it('finds the hole within 3.5 px of the pointer', () => {
    const d = sheet()
    expect(holeAtPoint(d.parts[0], bb, { x: 11, y: 12 })).toEqual({ board: 'b', group: 's1', hole: 0 })
    expect(holeAtPoint(d.parts[0], bb, { x: 52, y: 48 })).toEqual({ board: 'b', group: 's5', hole: 4 })
  })
  it('finds nothing between holes or off the board', () => {
    const d = sheet()
    expect(holeAtPoint(d.parts[0], bb, { x: 14, y: 14 })).toBeNull()
    expect(holeAtPoint(d.parts[0], bb, { x: 100, y: 10 })).toBeNull()
  })
  it('follows a rotated board', () => {
    const turned = { ...sheet().parts[0], x: 100, y: 100, rotation: 90 as const }
    expect(holeAtPoint(turned, bb, { x: 170, y: 90 })).toEqual({ board: 'b', group: 's1', hole: 0 })
  })
})
```

Append to `src/editor/ops.test.ts` (add `sameEndpoint` to the `./ops.ts` import):

```ts
describe('hole endpoints', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  function boardAndResistor() {
    const a = addPart(emptyDiagram(), bb, 0, 0)
    return addPart(a.diagram, resistor, 200, 0).diagram
  }
  it('treats a missing hole as hole 0 when comparing ends', () => {
    expect(sameEndpoint({ part: 'p1', pin: 's1' }, { part: 'p1', pin: 's1', hole: 0 })).toBe(true)
    expect(sameEndpoint({ part: 'p1', pin: 's1', hole: 1 }, { part: 'p1', pin: 's1', hole: 0 })).toBe(false)
  })
  it('allows wires into two holes of one strip, and refuses a repeat of the same hole', () => {
    const d = boardAndResistor()
    const w1 = addWire(d, { part: 'p1', pin: 's1', hole: 0 }, { part: 'p2', pin: '1' }, style)!
    const w2 = addWire(w1.diagram, { part: 'p1', pin: 's1', hole: 3 }, { part: 'p2', pin: '1' }, style)
    expect(w2).not.toBeNull()
    expect(addWire(w1.diagram, { part: 'p2', pin: '1' }, { part: 'p1', pin: 's1', hole: 0 }, style)).toBeNull()
  })
  it('reconnects a wire end onto a hole', () => {
    const d = boardAndResistor()
    const w = addWire(d, { part: 'p1', pin: 's1', hole: 0 }, { part: 'p2', pin: '1' }, style)!
    const next = reconnectWire(w.diagram, w.uid, 'from', { part: 'p1', pin: 's2', hole: 2 })!
    expect(next.connections[0].from).toEqual({ part: 'p1', pin: 's2', hole: 2 })
    expect(reconnectWire(next, w.uid, 'from', { part: 'p1', pin: 's2', hole: 2 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/breadboard.test.ts src/editor/ops.test.ts`
Expected: FAIL (`holeAtPoint`, `sameEndpoint` do not exist; hole 3 is refused as a duplicate).

- [ ] **Step 3: Add `holeAtPoint` to `src/format/breadboard.ts`**

Add `GRID` to the module import: `import { GRID, type ModuleDef, isBoard } from './module.ts'`. Then add:

```ts
export interface HoleRef {
  board: string
  group: string
  hole: number
}

/** The hole of `part` whose center is within `radius` px of `p`, or null. Holes sit on grid points. */
export function holeAtPoint(part: PartInstance, m: ModuleDef, p: Pt, radius = 3.5): HoleRef | null {
  const gx = Math.round(p.x / GRID) * GRID
  const gy = Math.round(p.y / GRID) * GRID
  if (Math.hypot(p.x - gx, p.y - gy) > radius) return null
  const idx = holeIndex(part, m)
  const hit = idx.byPoint.get(pointKey(gx, gy))
  return hit ? { board: part.uid, group: idx.groups[hit[0]].name, hole: hit[1] } : null
}
```

- [ ] **Step 4: Compare holes in `src/editor/ops.ts`**

Replace

```ts
const sameEnd = (a: Endpoint, b: Endpoint) => a.part === b.part && a.pin === b.pin
```

with

```ts
/** Same part, same pin or hole group, and the same hole (a missing hole is hole 0). */
export const sameEndpoint = (a: Endpoint, b: Endpoint): boolean => a.part === b.part && a.pin === b.pin && (a.hole ?? 0) === (b.hole ?? 0)
```

and rename every other `sameEnd(` call in the file to `sameEndpoint(`.

- [ ] **Step 5: Wire to holes in `src/editor/Canvas.tsx`**

Extend the imports:

```tsx
import { computeRoutes, labelAnchor, moduleOf, resolveEndpoint, wireColor, wirePaths, wireWidth, type PartInstance, type Routes } from '../format/diagram.ts'
import { holeAtPoint, plugsOf, splitBoards } from '../format/breadboard.ts'
```

Make the routes key include the hole index. Replace the `endpointsKey` mapping line with:

```tsx
    () => diagram.connections.map((c) => `${c.uid}:${c.from.part}.${c.from.pin}.${c.from.hole ?? ''}>${c.to.part}.${c.to.pin}.${c.to.hole ?? ''}:${JSON.stringify(c.route ?? null)}`).join('|'),
```

After the `pinUnder` function, add:

```tsx
  /** The hole under the pointer on the topmost part there, if that part has holes and a hole is within 3.5 px. */
  function holeUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    const partEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-part]')
    if (!partEl) return null
    const d = store.getState().diagram
    const part = d.parts.find((p) => p.uid === partEl.getAttribute('data-part'))
    const m = part && moduleOf(d, part.module)
    if (!part || !m || !m.holes?.length) return null
    const hit = holeAtPoint(part, m, toWorld(e))
    return hit && { part: hit.board, pin: hit.group, hole: hit.hole }
  }
  /** What a wire end would attach to under the pointer: a pin first (its target sits on top), else a hole. */
  function endUnder(e: { clientX: number; clientY: number }): Endpoint | null {
    return pinUnder(e) ?? holeUnder(e)
  }
```

In `onPointerDown`, between the `wireEl` block (it ends with `return` after `store.select(...)`) and `const partEl = ...`, add:

```tsx
    // A press on a board's hole starts a wire there; between holes, it drags the board as usual.
    const hole = e.button === 0 ? holeUnder(e) : null
    if (hole) {
      const at = resolveEndpoint(store.getState().diagram, hole)
      if (at) {
        setDrag({ pointer, kind: 'wire', from: hole, origin: at.end, cursor: toWorld(e), over: null })
        store.setGesture(true)
        return
      }
    }
```

In `onPointerMove` and `onPointerUp`, replace each of the four `pinUnder(e)` calls (wire move, reconnect move, wire drop, reconnect drop) with `endUnder(e)`. The `pinUnder` definition stays.

After the `{drag?.kind === 'reconnect' && (<line ... />)}` block, add the hole target ring:

```tsx
        {(drag?.kind === 'wire' || drag?.kind === 'reconnect') && drag.over?.hole !== undefined && (() => {
          const at = resolveEndpoint(diagram, drag.over!)
          return at ? <circle className="hole-target" cx={at.end.x} cy={at.end.y} r={4.5} /> : null
        })()}
```

- [ ] **Step 6: Style the ring in `src/editor/editor.css`** (after the `.pin-hit` rules)

```css
.hole-target { fill: rgba(61, 111, 214, 0.35); stroke: #3D6FD6; stroke-width: 1.5; pointer-events: none; }
```

- [ ] **Step 7: Run to see them pass**

Run: `npx vitest run src/format/breadboard.test.ts src/editor/ops.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/format/breadboard.ts src/format/breadboard.test.ts src/editor/ops.ts src/editor/ops.test.ts src/editor/Canvas.tsx src/editor/editor.css
git commit -m "Wire to and reconnect onto breadboard holes; hole target ring"
```

---

### Task 7: Breadboard generator and the five boards

**Files:**
- Create: `scripts/gen-breadboards.mjs`
- Create (generated): `modules/breadboard-full.json`, `modules/breadboard-half.json`, `modules/breadboard-mini.json`, `modules/breadboard-tiny.json`, `modules/power-rail-strip.json`
- Create: `src/format/breadboards.test.ts`
- Modify: `src/editor/ops.ts` (`PREFIXES`: `BB`)
- Test: `src/editor/ops.test.ts` (append)

**Interfaces:**
- Consumes: the module format with `holes` and `obstacle` (Task 1); rendering (Task 5).
- Produces: five modules in category `Prototyping`, each with `pins: []`, `obstacle: false`, `size`, `art` and hole groups:
  - Full and half: strips `c<N>-top` (label `<N> a-e`) and `c<N>-bot` (label `<N> f-j`); rails `top+`, `top-`, `bottom-`, `bottom+` (labels `+ rail (top)` and so on, `rail` set).
  - Mini: strips only. Tiny: strips `c1`..`c5` (labels `1`..`5`). Rail strip: groups `+` and `-`.
  - Full-board geometry: column N at x = 20 + 10N (N = 1..63); rows a-e at y 60..100, f-j at 130..170; rails at y 20 (+), 30 (-), 200 (-), 210 (+); rail holes from x 50 to 630 in groups of 5 with a one-hole gap; body 680 x 230.
  - `designatorPrefix` gives `BB` for ids starting `breadboard` or `power-rail`.

Decisions: rails are `+` outer and `-` inner on both edges; a rail starts at the grid point nearest to centering it (half board: column 1); tiny is 5 vertical strips of 5; no `source` URL (generic layout); art is white body `#FFFFFF`, channel `#E4E7EC`, red `#E0483E` and blue `#3D6FD6` rail stripes, gray labels `#8A929C` (row letters at both ends, column numbers at 1 and every 5th column).

- [ ] **Step 1: Write the failing tests** in `src/format/breadboards.test.ts`

```ts
// Layout test for the built-in breadboards (generated by scripts/gen-breadboards.mjs): hole counts,
// strips of 5, rails in groups of 5 with a gap, every hole on the 10 px grid, and boards that
// wires route over. A change here must match the real board layout it models.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isBoard, validateModule, type ModuleDef } from './module.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (id: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')))
  if (!r.ok) throw new Error(`${id}: ${r.errors.join('; ')}`)
  return r.module
}
const count = (m: ModuleDef) => m.holes!.reduce((n, g) => n + g.at.length, 0)

// id, name, total holes, 5-hole strips, rails, holes per rail
const boards = [
  ['breadboard-full', 'Full breadboard (830)', 830, 126, 4, 50],
  ['breadboard-half', 'Half breadboard (400)', 400, 60, 4, 25],
  ['breadboard-mini', 'Mini breadboard (170)', 170, 34, 0, 0],
  ['breadboard-tiny', 'Tiny breadboard (25)', 25, 5, 0, 0],
  ['power-rail-strip', 'Power rail strip', 50, 0, 2, 25],
] as const

describe('built-in breadboards', () => {
  for (const [id, name, holes, strips, rails, railLength] of boards)
    it(`${id}: ${holes} holes, ${strips} strips of 5, ${rails} rails of ${railLength}`, () => {
      const m = load(id)
      expect(m.name).toBe(name)
      expect(m.category).toBe('Prototyping')
      expect(isBoard(m)).toBe(true)
      expect(m.pins).toEqual([])
      expect(count(m)).toBe(holes)
      const railGroups = m.holes!.filter((g) => g.rail)
      const stripGroups = m.holes!.filter((g) => !g.rail)
      expect(stripGroups).toHaveLength(strips)
      for (const g of stripGroups) expect(g.at).toHaveLength(5)
      expect(railGroups).toHaveLength(rails)
      for (const g of railGroups) expect(g.at).toHaveLength(railLength)
      for (const g of m.holes!) for (const [x, y] of g.at) expect([x % 10, y % 10]).toEqual([0, 0])
    })

  it('full board: rails run in groups of 5 with a one-hole gap', () => {
    const m = load('breadboard-full')
    for (const name of ['top+', 'top-', 'bottom-', 'bottom+']) {
      const rail = m.holes!.find((g) => g.name === name)!
      const steps = rail.at.slice(1).map(([x], i) => x - rail.at[i][0])
      expect(steps).toEqual(Array.from({ length: 49 }, (_, i) => ((i + 1) % 5 === 0 ? 20 : 10)))
      expect(rail.at[0][0]).toBe(50)
    }
    expect(m.holes!.find((g) => g.name === 'top+')!.rail).toBe('+')
    expect(m.holes!.find((g) => g.name === 'top-')!.at[0]).toEqual([50, 30])
  })

  it('full board: column 12 is rows a-e above the channel and f-j below it', () => {
    const m = load('breadboard-full')
    expect(m.holes!.find((g) => g.name === 'c12-top')).toEqual({ name: 'c12-top', label: '12 a-e', at: [[140, 60], [140, 70], [140, 80], [140, 90], [140, 100]] })
    expect(m.holes!.find((g) => g.name === 'c12-bot')!.at).toEqual([[140, 130], [140, 140], [140, 150], [140, 160], [140, 170]])
    expect(m.size).toEqual({ w: 68, h: 23 })
  })

  it('half board rails start at column 1', () => {
    const m = load('breadboard-half')
    expect(m.holes!.find((g) => g.name === 'top+')!.at[0]).toEqual([30, 20])
    expect(m.holes!.find((g) => g.name === 'c1-top')!.at[0]).toEqual([30, 60])
  })
})
```

Append to `src/editor/ops.test.ts`:

```ts
describe('board designators', () => {
  it('uses BB for breadboards and rail strips', () => {
    const board = (id: string): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins: [] })
    expect(designatorPrefix(board('breadboard-full'))).toBe('BB')
    expect(designatorPrefix(board('power-rail-strip'))).toBe('BB')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/breadboards.test.ts src/editor/ops.test.ts`
Expected: FAIL (module files missing; prefix is `U`).

- [ ] **Step 3: Create `scripts/gen-breadboards.mjs`**

```js
// Generates the built-in breadboards: full (830 holes), half (400), mini (170), tiny (25) and a
// power rail strip. Every connected set of holes (a 5-hole terminal strip, a power rail) is one
// hole group; the art is only the body, center channel, rail stripes and labels, so the JSON stays
// small and the renderer draws the holes from the groups. Layout per the breadboards design spec
// (docs/superpowers/specs/2026-09-25-breadboards-design.md); generic boards, so no `source`.
//
// Run from the repo root: `node scripts/gen-breadboards.mjs`
// It overwrites those files in modules/ in place; src/format/breadboards.test.ts pins the layout.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../modules/', import.meta.url))

const BODY = '#FFFFFF', CHANNEL = '#E4E7EC', RED = '#E0483E', BLUE = '#3D6FD6', TEXT = '#8A929C'
const P = 10 // hole pitch, px (0.1 inch)

const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })
/** A small silkscreen label centered on (cx, cy); its plate matches the body so only the text shows. */
const text = (cx, cy, label) => r(cx - 6, cy - 4, 12, 8, BODY, { outline: false, label, labelColor: TEXT, labelSize: 6 })
const stripe = (x0, x1, y, fill) => r(x0, y, x1 - x0, 2, fill, { outline: false })
const group = (name, label, at, rail) => (rail ? { name, label, at, rail } : { name, label, at })

/** `n` rail hole x positions from `x0`: groups of 5 with a one-hole gap, as on real boards. */
function railXs(x0, n) {
  const xs = []
  for (let k = 0; xs.length < n; k++) if (k % 6 !== 5) xs.push(x0 + k * P)
  return xs
}

function write(file, m) {
  // One line per [x, y] hole position keeps an 830-hole board around 2,300 lines.
  const json = JSON.stringify(m, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]')
  writeFileSync(OUT + file, json + '\n')
  const holes = m.holes.reduce((n, g) => n + g.at.length, 0)
  console.log(file, 'holes', holes, 'body', m.art.w, 'x', m.art.h)
}

function moduleJson({ id, name, W, H, holes, shapes }) {
  return {
    format: 'circuitoon-module/1', id, version: 1, name, category: 'Prototyping',
    pins: [], holes, obstacle: false, size: { w: W / P, h: H / P }, art: { w: W, h: H, shapes },
  }
}

/**
 * A terminal board: `cols` columns of two 5-hole strips (rows a-e above the center channel, f-j
 * below) and, with `railHoles`, a pair of power rails along the top and bottom edges (+ outer,
 * - inner). Column c's holes sit at x = 20 + 10c; the body leaves 30 px either side for the row
 * letters.
 */
function terminalBoard({ cols, railHoles }) {
  const rails = railHoles > 0
  const W = cols * P + 50
  const yA = rails ? 60 : 30 // row a
  const top = [0, 1, 2, 3, 4].map((i) => yA + i * P)
  const bot = [0, 1, 2, 3, 4].map((i) => yA + 70 + i * P)
  const H = bot[4] + (rails ? 60 : 30)
  const colX = (c) => 20 + c * P
  const holes = []
  for (let c = 1; c <= cols; c++) {
    holes.push(group(`c${c}-top`, `${c} a-e`, top.map((y) => [colX(c), y])))
    holes.push(group(`c${c}-bot`, `${c} f-j`, bot.map((y) => [colX(c), y])))
  }
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 })]
  shapes.push(r(10, top[4] + 9, W - 20, 12, CHANNEL, { radius: 1, outline: false }))
  if (rails) {
    const slots = railHoles + Math.floor((railHoles - 1) / 5)
    const x0 = Math.floor(((colX(1) + colX(cols)) / 2 - ((slots - 1) * P) / 2) / P) * P
    const xs = railXs(x0, railHoles)
    const a = xs[0] - 6
    const b = xs[xs.length - 1] + 6
    holes.unshift(group('top+', '+ rail (top)', xs.map((x) => [x, 20]), '+'), group('top-', '- rail (top)', xs.map((x) => [x, 30]), '-'))
    holes.push(group('bottom-', '- rail (bottom)', xs.map((x) => [x, H - 30]), '-'), group('bottom+', '+ rail (bottom)', xs.map((x) => [x, H - 20]), '+'))
    shapes.push(stripe(a, b, 11, RED), stripe(a, b, 37, BLUE), stripe(a, b, H - 39, BLUE), stripe(a, b, H - 13, RED))
    shapes.push(text(a - 8, 20, '+'), text(a - 8, 30, '-'), text(a - 8, H - 30, '-'), text(a - 8, H - 20, '+'))
  }
  for (const y of [top[0] - 13, bot[4] + 13])
    for (let c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) shapes.push(text(colX(c), y, String(c)))
  const letters = 'abcdefghij'
  ;[...top, ...bot].forEach((y, i) => shapes.push(text(15, y, letters[i]), text(W - 15, y, letters[i])))
  return { W, H, holes, shapes }
}

write('breadboard-full.json', moduleJson({ id: 'breadboard-full', name: 'Full breadboard (830)', ...terminalBoard({ cols: 63, railHoles: 50 }) }))
write('breadboard-half.json', moduleJson({ id: 'breadboard-half', name: 'Half breadboard (400)', ...terminalBoard({ cols: 30, railHoles: 25 }) }))
write('breadboard-mini.json', moduleJson({ id: 'breadboard-mini', name: 'Mini breadboard (170)', ...terminalBoard({ cols: 17, railHoles: 0 }) }))

// Tiny (25): five vertical strips of five, numbered 1 and 5.
{
  const W = 80, H = 80
  const holes = []
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 })]
  for (let c = 1; c <= 5; c++) {
    holes.push(group(`c${c}`, String(c), [0, 1, 2, 3, 4].map((i) => [10 + c * P, 20 + i * P])))
    if (c === 1 || c === 5) shapes.push(text(10 + c * P, 10, String(c)))
  }
  write('breadboard-tiny.json', moduleJson({ id: 'breadboard-tiny', name: 'Tiny breadboard (25)', W, H, holes, shapes }))
}

// Power rail strip: + and - rails of 25 holes, red stripe above, blue below.
{
  const W = 320, H = 50
  const xs = railXs(20, 25)
  const holes = [group('+', '+ rail', xs.map((x) => [x, 20]), '+'), group('-', '- rail', xs.map((x) => [x, 30]), '-')]
  const shapes = [r(0, 0, W, H, BODY, { radius: 4 }), stripe(14, 306, 8, RED), stripe(14, 306, 40, BLUE)]
  write('power-rail-strip.json', moduleJson({ id: 'power-rail-strip', name: 'Power rail strip', W, H, holes, shapes }))
}
```

- [ ] **Step 4: Generate the boards and add the prefix**

Run: `node scripts/gen-breadboards.mjs`
Expected output (five lines):

```
breadboard-full.json holes 830 body 680 x 230
breadboard-half.json holes 400 body 350 x 230
breadboard-mini.json holes 170 body 220 x 170
breadboard-tiny.json holes 25 body 80 x 80
power-rail-strip.json holes 50 body 320 x 50
```

In `src/editor/ops.ts`, add to `PREFIXES` (before the `lcd|oled|tft` entry):

```ts
  [/^(breadboard|power-rail)/, 'BB'],
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/format/breadboards.test.ts src/editor/ops.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the generator reproduces the files byte for byte**

Run: `node scripts/gen-breadboards.mjs && git status --porcelain modules/`
Expected: only the five new files listed as untracked (`??`), nothing modified. After Step 8's commit, the same command must print nothing.

- [ ] **Step 7: Run everything and look at one board**

Run: `npm test && npm run validate && npm run build`
Expected: PASS; `npm run validate` prints `ok` for the five new files.

Run: `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs breadboard-full breadboard-tiny --out <scratchpad>/bb`
Read both images. Check: holes line up in rows and columns, the channel sits between rows e and f, rail stripes are red above + and blue below -, labels read. (The full visual pass is Task 13.)

- [ ] **Step 8: Commit**

```bash
git add scripts/gen-breadboards.mjs modules/breadboard-full.json modules/breadboard-half.json modules/breadboard-mini.json modules/breadboard-tiny.json modules/power-rail-strip.json src/format/breadboards.test.ts src/editor/ops.ts src/editor/ops.test.ts
git commit -m "Five built-in breadboards from a generator: full, half, mini, tiny and a power rail strip"
```

---

### Task 8: Seated detection, and mount or unmount on drop

**Files:**
- Modify: `src/format/breadboard.ts` (add `Seat`, `seatOf`)
- Modify: `src/editor/ops.ts` (add `settleMounts`)
- Modify: `src/editor/Canvas.tsx` (seat highlight during a part drag; settle on drop)
- Modify: `src/editor/editor.css` (`.seat-ok`, `.seat-bad`)
- Create: `src/format/breadboard.perf.test.ts`
- Test: `src/format/breadboard.test.ts` (append), `src/editor/ops.test.ts` (append)

**Interfaces:**
- Consumes: `holeIndex`, `pointKey`, `plugsOf`, `Plug` (Task 3), `plugPoints` (Task 2), `isBoard` (Task 1).
- Produces:
  - `interface Seat { status: 'seated' | 'partial'; board: string; holes: Pt[] }`
  - `seatOf(d: Diagram, uid: string, plugs: Plug[], ignore?: ReadonlySet<string>): Seat | null` (`ignore` defaults to `new Set([uid])`: legs of those parts never count as taken)
  - `settleMounts(d: Diagram, uids: string[], mode?: 'drop' | 'keep'): Diagram` (`'drop'`, the default, mounts seated parts and unmounts the rest; `'keep'` only removes mounts that no longer fit on their own board; boards are skipped; returns `d` itself when nothing changes)

Seated: every plug point lands exactly on a hole of one board and none of those holes holds another mounted part's leg. Partial: some legs land (or land on taken holes). Null: no leg lands on any board, or the part cannot mount. Decisions: parts with a bus pin, parts with no pins and boards never mount; with legs on several boards, the board with the most landed legs is the candidate; only the dragged parts settle on drop, and a press without movement settles nothing.

- [ ] **Step 1: Write the failing tests**

Append to `src/format/breadboard.test.ts` (add `seatOf` to the import):

```ts
describe('seatOf', () => {
  const loose = (x: number, y: number): Diagram => {
    const d = sheet()
    d.parts = [d.parts[0], { uid: 'u', designator: 'R9', module: 'two', x, y }]
    return d
  }
  it('is seated when every leg lands on a free hole of one board', () => {
    expect(seatOf(loose(10, 0), 'u', [])).toEqual({ status: 'seated', board: 'b', holes: [{ x: 50, y: 20 }, { x: 10, y: 20 }] })
  })
  it('is partial when only some legs land', () => {
    expect(seatOf(loose(70, 0), 'u', [])).toEqual({ status: 'partial', board: 'b', holes: [{ x: 70, y: 20 }] })
  })
  it('is null when no leg lands on a board', () => {
    expect(seatOf(loose(10, 60), 'u', [])).toBeNull()
  })
  it('is partial when a leg lands on a hole another mounted part already uses', () => {
    const d = loose(50, 0)
    d.parts.push({ uid: 'q', designator: 'R8', module: 'two', x: 10, y: 0, mount: { board: 'b' } })
    expect(seatOf(d, 'u', plugsOf(d))).toEqual({ status: 'partial', board: 'b', holes: [{ x: 90, y: 20 }, { x: 50, y: 20 }] })
    // A part moving with it does not block it.
    expect(seatOf(d, 'u', plugsOf(d), new Set(['u', 'q']))!.status).toBe('seated')
  })
  it('never seats a board or a part with a bus pin', () => {
    const d = loose(10, 0)
    expect(seatOf(d, 'b', [])).toBeNull()
    d.modules.busy = { format: 'circuitoon-module/1', id: 'busy', name: 'Busy', pins: [{ name: 'X', side: 'left' }, { name: 'bus', side: 'right', bus: { length: 2 } }] }
    d.parts[1] = { ...d.parts[1], module: 'busy' }
    expect(seatOf(d, 'u', [])).toBeNull()
  })
})
```

Append to `src/editor/ops.test.ts` (add `settleMounts` to the `./ops.ts` import and `type Diagram` from `../format/diagram.ts`):

```ts
describe('settleMounts', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  const at = (x: number, y: number, mounted = false): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
      { uid: 'u', designator: 'R1', module: 'two', x, y, ...(mounted ? { mount: { board: 'b' } } : {}) },
    ],
    connections: [],
  })
  it('mounts a part dropped seated on a board', () => {
    expect(settleMounts(at(10, 0), ['u']).parts[1].mount).toEqual({ board: 'b' })
  })
  it('unmounts a part dropped half on or off the board', () => {
    expect(settleMounts(at(70, 0, true), ['u']).parts[1]).not.toHaveProperty('mount')
    expect(settleMounts(at(300, 0, true), ['u']).parts[1]).not.toHaveProperty('mount')
  })
  it('returns the same diagram when nothing changes, and skips boards', () => {
    const d = at(10, 0, true)
    expect(settleMounts(d, ['u', 'b'])).toBe(d)
    const loose = at(300, 0)
    expect(settleMounts(loose, ['u'])).toBe(loose)
  })
  it('in keep mode never mounts, only drops a mount that no longer fits', () => {
    const d = at(10, 0)
    expect(settleMounts(d, ['u'], 'keep')).toBe(d)
    expect(settleMounts(at(70, 0, true), ['u'], 'keep').parts[1]).not.toHaveProperty('mount')
  })
})
```

Create `src/format/breadboard.perf.test.ts`:

```ts
// Budget and real-part tests on the built-in full breadboard: seated detection for 20 parts and a
// board drag frame stay well inside a 60 fps frame, and the boards fit the real parts they should.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plugsOf, seatOf } from './breadboard.ts'
import { netlist } from './netlist.ts'
import type { Diagram, PartInstance } from './diagram.ts'
import type { Rotation } from './geometry.ts'
import { validateModule, type ModuleDef } from './module.ts'
import { moveParts, settleMounts } from '../editor/ops.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (id: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')))
  if (!r.ok) throw new Error(`${id}: ${r.errors.join('; ')}`)
  return r.module
}
/** Two-lead part, body 40 x 30 (pivot 20, 10): L edge at local (0, 20), R edge at local (40, 20), stubs 8 px out. */
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
const full = load('breadboard-full')
const board: PartInstance = { uid: 'bb', designator: 'BB1', module: full.id, x: 0, y: 0 }

/** The full board with 20 two-lead parts whose legs sit in rows a-j, columns 1/5 and 8/12, and 10 rail jumpers. */
function loaded(mounted: boolean): Diagram {
  const parts: PartInstance[] = [board]
  const rows = [60, 70, 80, 90, 100, 130, 140, 150, 160, 170]
  let n = 0
  for (const row of rows)
    for (const x of [30, 100]) {
      n++
      parts.push({ uid: `r${n}`, designator: `R${n}`, module: 'two', x, y: row - 20, ...(mounted ? { mount: { board: 'bb' } } : {}) })
    }
  const connections = Array.from({ length: 10 }, (_, i) => ({
    uid: `w${i + 1}`, from: { part: 'bb', pin: 'top+', hole: i * 5 }, to: { part: 'bb', pin: `c${20 + i * 4}-top`, hole: 0 },
  }))
  return { format: 'circuitoon-diagram/1', title: 'perf', modules: { [full.id]: full, two }, parts, connections }
}

function median(fn: () => void, runs = 15): number {
  for (let i = 0; i < 3; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

describe('full breadboard with 20 parts', () => {
  const uids = Array.from({ length: 20 }, (_, i) => `r${i + 1}`)

  it('seats all 20 parts, and dropping them mounts all 40 legs', () => {
    const d = loaded(false)
    for (const u of uids) expect(seatOf(d, u, [])?.status).toBe('seated')
    expect(plugsOf(settleMounts(d, uids))).toHaveLength(40)
  })
  it('detects seats for 20 parts in 4 ms or less (median)', () => {
    const d = loaded(true)
    const ms = median(() => {
      const plugs = plugsOf(d)
      for (const u of uids) seatOf(d, u, plugs)
    })
    expect(ms).toBeLessThanOrEqual(4)
  })
  // Skipped until Task 9 makes moveParts carry mounted parts; Task 9 Step 5 removes the .skip.
  it.skip('moves the board with its 20 parts and re-plugs them in 4 ms or less per frame (median)', () => {
    const d = loaded(true)
    let dx = 0
    const ms = median(() => {
      dx += 10
      expect(plugsOf(moveParts(d, ['bb'], dx, 0))).toHaveLength(40)
    })
    expect(ms).toBeLessThanOrEqual(4)
  })
  it('builds the netlist in 5 ms or less (median)', () => {
    const d = loaded(true)
    expect(median(() => netlist(d))).toBeLessThanOrEqual(5)
  })
})

describe('real parts on the full breadboard', () => {
  /** Grid positions near the board where the part is seated at this rotation. */
  function seatedSpots(m: ModuleDef, rotation: Rotation): number {
    let n = 0
    for (let x = -100; x <= 700; x += 10)
      for (let y = -100; y <= 300; y += 10) {
        const d: Diagram = {
          format: 'circuitoon-diagram/1', title: 't', modules: { [full.id]: full, [m.id]: m }, connections: [],
          parts: [board, { uid: 'u', designator: 'U1', module: m.id, x, y, rotation }],
        }
        if (seatOf(d, 'u', [])?.status === 'seated') n++
      }
    return n
  }
  it('seats a XIAO and a DIP-28 across the channel once turned, not before', () => {
    for (const id of ['xiao-esp32c3', 'mcp23017-dip28']) {
      expect(seatedSpots(load(id), 0), id).toBe(0)
      expect(seatedSpots(load(id), 90), id).toBeGreaterThan(0)
    }
  })
  it('cannot seat the 120 px wide ESP32 DevKit V1: its rows are wider than rows a to j (110 px)', () => {
    expect(seatedSpots(load('esp32-devkit-v1-30'), 90)).toBe(0)
  })
})
```

The move-frame test is written now but skipped: `moveParts` only carries mounted parts from Task 9, which removes the `.skip`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/breadboard.test.ts src/editor/ops.test.ts src/format/breadboard.perf.test.ts`
Expected: FAIL (`seatOf`, `settleMounts` do not exist).

- [ ] **Step 3: Add `seatOf` to `src/format/breadboard.ts`**

Add `isSpacer` to the module import: `import { GRID, type ModuleDef, isBoard, isSpacer } from './module.ts'`. Then add:

```ts
export interface Seat {
  /** seated: every leg on a free hole of `board`. partial: some legs land, or land on taken holes. */
  status: 'seated' | 'partial'
  board: string
  /** Hole centers under the part's legs on that board, for the green or red highlight. */
  holes: Pt[]
}

/**
 * How part `uid` sits on the boards at its current position. `plugs` are the sheet's current
 * mounted legs (call plugsOf once per frame and pass it to every check); legs of parts in
 * `ignore` (the part itself, and anything dragged with it) never count as taken. Null when no leg
 * lands on a board, or when the part cannot mount at all: a board, a part with no pins, or a part
 * with a bus pin. With legs on several boards, the board with the most landed legs wins.
 */
export function seatOf(d: Diagram, uid: string, plugs: Plug[], ignore: ReadonlySet<string> = new Set([uid])): Seat | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || isBoard(m) || m.pins.some((p) => !isSpacer(p) && p.bus)) return null
  const legs = plugPoints(part, m)
  if (!legs.length) return null
  let best: Seat | null = null
  let bestLanded = 0
  for (const b of d.parts) {
    if (b === part) continue
    const bm = moduleOf(d, b.module)
    if (!bm || !isBoard(bm)) continue
    const idx = holeIndex(b, bm)
    const landed = legs.filter((l) => idx.byPoint.has(pointKey(l.at.x, l.at.y)))
    if (landed.length <= bestLanded) continue
    const taken = new Set<number>()
    for (const pl of plugs) if (pl.board === b.uid && !ignore.has(pl.part)) taken.add(pointKey(pl.at.x, pl.at.y))
    const free = landed.every((l) => !taken.has(pointKey(l.at.x, l.at.y)))
    bestLanded = landed.length
    best = { status: landed.length === legs.length && free ? 'seated' : 'partial', board: b.uid, holes: landed.map((l) => l.at) }
  }
  return best
}
```

- [ ] **Step 4: Add `settleMounts` to `src/editor/ops.ts`**

Add imports:

```ts
import { plugsOf, seatOf } from '../format/breadboard.ts'
import { isBoard, type ModuleDef } from '../format/module.ts'
```

(replace the existing `import type { ModuleDef } from '../format/module.ts'`). Then add:

```ts
const withoutMount = (p: PartInstance): PartInstance => {
  const { mount: _gone, ...rest } = p
  return rest
}

/**
 * Re-checks the mount of each listed part. 'drop' (a finished drag): a seated part gets, or keeps,
 * `mount.board`; anything else loses its mount. 'keep' (after a rotation): a part is never newly
 * mounted, and a mounted part keeps its mount only while it still fits its own board. The listed
 * parts never block each other's holes. Boards are skipped. Returns `d` itself when nothing changes.
 */
export function settleMounts(d: Diagram, uids: string[], mode: 'drop' | 'keep' = 'drop'): Diagram {
  const moving = new Set(uids)
  const plugs = plugsOf(d)
  let changed = false
  const parts = d.parts.map((p) => {
    if (!moving.has(p.uid) || isBoard(moduleOf(d, p.module))) return p
    if (mode === 'keep' && !p.mount) return p
    const seat = seatOf(d, p.uid, plugs, moving)
    const fits = !!seat && seat.status === 'seated' && (mode === 'drop' || seat.board === p.mount?.board)
    const board = fits ? seat!.board : undefined
    if (p.mount?.board === board) return p
    changed = true
    return board ? { ...p, mount: { board } } : withoutMount(p)
  })
  return changed ? { ...d, parts } : d
}
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/format/breadboard.test.ts src/editor/ops.test.ts src/format/breadboard.perf.test.ts`
Expected: PASS (the move-frame test is skipped until Task 9).

- [ ] **Step 6: Show seats while dragging and settle on drop in `src/editor/Canvas.tsx`**

Extend imports: add `seatOf` to the `../format/breadboard.ts` import and `settleMounts` to the `./ops.ts` import.

After the `plugs` `useMemo`, add:

```tsx
  // While parts are dragged: which holes each dragged part's legs land on (green seated, red partial).
  const seats = useMemo(() => {
    if (drag?.kind !== 'parts') return []
    const moving = new Set(drag.uids)
    return drag.uids.flatMap((uid) => seatOf(diagram, uid, plugs, moving) ?? [])
  }, [diagram, plugs, drag])
```

Before `onPointerDown`, add:

```tsx
  /** Ends a part drag as one undo step: moved parts that are seated mount, the rest unmount. */
  function finishPartsDrag(d: Extract<Drag, { kind: 'parts' }>) {
    const now = store.getState().diagram
    // A press without movement changes nothing, mounts included.
    if (store.dragging && now !== d.base) store.preview(settleMounts(now, d.uids))
    store.end()
  }
```

In `onPointerUp`, replace

```tsx
    if (drag.kind === 'parts' || drag.kind === 'segment') store.end()
```

with

```tsx
    if (drag.kind === 'parts') finishPartsDrag(drag)
    if (drag.kind === 'segment') store.end()
```

In `onPointerCancel`, replace `if (drag.kind === 'parts') store.end()` with `if (drag.kind === 'parts') finishPartsDrag(drag)`.

In the JSX, right after `<LegDots plugs={plugs} />`, add:

```tsx
        <g pointerEvents="none">
          {seats.flatMap((s, i) =>
            s.holes.map((h, j) => <circle key={`${i}-${j}`} className={s.status === 'seated' ? 'seat-ok' : 'seat-bad'} cx={h.x} cy={h.y} r={4} />),
          )}
        </g>
```

- [ ] **Step 7: Style the highlights in `src/editor/editor.css`**

```css
.seat-ok { fill: rgba(47, 158, 110, 0.3); stroke: #2F9E6E; stroke-width: 1.8; }
.seat-bad { fill: rgba(224, 72, 62, 0.25); stroke: #E0483E; stroke-width: 1.8; }
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/format/breadboard.ts src/format/breadboard.test.ts src/format/breadboard.perf.test.ts src/editor/ops.ts src/editor/ops.test.ts src/editor/Canvas.tsx src/editor/editor.css
git commit -m "Leg snapping: seated detection with green and red holes, mount on drop, budget tests"
```

---

### Task 9: Boards carry mounted parts; rotation and delete

**Files:**
- Modify: `src/editor/ops.ts` (`withMounted`, `moveParts`, `rotateParts`, `deleteSelection`)
- Modify: `src/editor/Canvas.tsx` (drag state `moving`)
- Modify: `src/format/breadboard.perf.test.ts` (un-skip the move-frame test)
- Test: `src/editor/ops.test.ts` (append), `src/editor/store.test.ts` (append)

**Interfaces:**
- Consumes: `settleMounts` (Task 8), `plugsOf`, `seatOf` (Tasks 3, 8), `pivot`, `rotateVec` (geometry).
- Produces:
  - `withMounted(d: Diagram, uids: string[]): string[]` (the given parts plus every part mounted on a board among them, in diagram order)
  - `moveParts` moves `withMounted(d, uids)`
  - `rotateParts`: a rotated board turns its mounted parts with it about the board's pivot; other rotated parts keep a mount only if they still fit (`settleMounts(..., 'keep')`)
  - `deleteSelection`: deleting a board unmounts its parts and keeps them
  - Canvas `Drag` `'parts'` variant gains `moving: string[]`

Decisions: rotating a board carries its parts (they stay seated); rotating a part never mounts it; deleting a board also removes wires to its holes, as for any part.

- [ ] **Step 1: Write the failing tests**

Append to `src/editor/ops.test.ts` (add `withMounted` to the `./ops.ts` import and `plugsOf, seatOf` from `../format/breadboard.ts`):

```ts
describe('boards carry their parts', () => {
  const bb: ModuleDef = {
    format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
    holes: Array.from({ length: 9 }, (_, i) => ({
      name: `s${i + 1}`, label: `${i + 1}`, at: [10, 20, 30, 40, 50].map((y) => [(i + 1) * 10, y] as [number, number]),
    })),
  }
  const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  /** Square part, body 40 x 40 with its pivot at the exact center (20, 20). */
  const sq: ModuleDef = { format: 'circuitoon-module/1', id: 'sq', name: 'Sq', size: { w: 4, h: 4 }, pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
  const loaded = (): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: { bb, two, sq },
    parts: [
      { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0, rotation: 0 },
      { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, rotation: 0, mount: { board: 'b' } },
      { uid: 'x', designator: 'R2', module: 'two', x: 300, y: 0, rotation: 0 },
    ],
    connections: [{ uid: 'w1', from: { part: 'b', pin: 's9', hole: 0 }, to: { part: 'x', pin: 'L' } }],
  })

  it('lists a board with the parts mounted on it', () => {
    expect(withMounted(loaded(), ['b'])).toEqual(['b', 'p1'])
    expect(withMounted(loaded(), ['p1'])).toEqual(['p1'])
  })
  it('moves mounted parts with their board, and a mounted part alone without it', () => {
    const d = moveParts(loaded(), ['b'], 30, 20)
    expect(d.parts.map((p) => [p.uid, p.x, p.y])).toEqual([['b', 30, 20], ['p1', 40, 20], ['x', 300, 0]])
    expect(plugsOf(d)).toHaveLength(2)
    const alone = moveParts(loaded(), ['p1'], 30, 0)
    expect(alone.parts.map((p) => [p.uid, p.x])).toEqual([['b', 0], ['p1', 40], ['x', 300]])
  })
  it('turns mounted parts with a rotated board, so they stay seated', () => {
    const d = rotateParts(loaded(), ['b'])
    expect(d.parts[1]).toMatchObject({ uid: 'p1', x: 50, y: 0, rotation: 90, mount: { board: 'b' } })
    expect(seatOf(d, 'p1', plugsOf(d))!.status).toBe('seated')
    expect(plugsOf(d).map((p) => p.group)).toEqual(['s5', 's1'])
  })
  it('turns a mounted part once when it is selected along with its board', () => {
    expect(rotateParts(loaded(), ['b', 'p1']).parts[1]).toMatchObject({ x: 50, y: 0, rotation: 90 })
  })
  it('unmounts a rotated part that no longer fits, and keeps one that still does', () => {
    expect(rotateParts(loaded(), ['p1']).parts[1]).not.toHaveProperty('mount')
    const d = loaded()
    d.parts[1] = { uid: 'p1', designator: 'R1', module: 'sq', x: 10, y: 10, rotation: 90, mount: { board: 'b' } }
    expect(seatOf(d, 'p1', [])!.status).toBe('seated')
    expect(rotateParts(d, ['p1']).parts[1]).toMatchObject({ rotation: 180, mount: { board: 'b' } })
  })
  it('never mounts a part by rotating it', () => {
    const d = loaded()
    d.parts[1] = { uid: 'p1', designator: 'R1', module: 'sq', x: 10, y: 10, rotation: 90 }
    expect(rotateParts(d, ['p1']).parts[1]).not.toHaveProperty('mount')
  })
  it('deletes a board but keeps its parts, unmounted, and drops wires to its holes', () => {
    const d = deleteSelection(loaded(), { parts: ['b'], wires: [] })
    expect(d.parts.map((p) => p.uid)).toEqual(['p1', 'x'])
    expect(d.parts[0]).not.toHaveProperty('mount')
    expect(d.connections).toEqual([])
  })
})
```

Append to `src/editor/store.test.ts` (add imports as needed: `moveParts` from `./ops.ts`, `type Diagram` from `../format/diagram.ts`, `type ModuleDef` from `../format/module.ts`):

```ts
describe('dragging a board with mounted parts', () => {
  it('is a single undo step', () => {
    const bb: ModuleDef = {
      format: 'circuitoon-module/1', id: 'bb', name: 'Test board', pins: [], size: { w: 10, h: 6 }, obstacle: false,
      holes: [{ name: 's1', at: [[10, 20]] }, { name: 's5', at: [[50, 20]] }],
    }
    const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
    const start: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: { bb, two },
      parts: [
        { uid: 'b', designator: 'BB1', module: 'bb', x: 0, y: 0 },
        { uid: 'p1', designator: 'R1', module: 'two', x: 10, y: 0, mount: { board: 'b' } },
      ],
      connections: [],
    }
    const store = new EditorStore(start)
    const base = store.begin()
    store.preview(moveParts(base, ['b'], 10, 0))
    store.preview(moveParts(base, ['b'], 40, 0))
    store.end()
    expect(store.getState().diagram.parts.map((p) => p.x)).toEqual([40, 50])
    store.undo()
    expect(store.getState().diagram).toBe(start)
    expect(store.canUndo).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/ops.test.ts src/editor/store.test.ts`
Expected: FAIL (`withMounted` missing; the board moves alone; rotation and delete leave mounts as they were).

- [ ] **Step 3: Implement in `src/editor/ops.ts`**

Change the two imports to:

```ts
import { isBoard, layoutModule, type ModuleDef } from '../format/module.ts'
import { pivot, rotateVec, type Rotation } from '../format/geometry.ts'
```

Add `withMounted` above `moveParts`:

```ts
/** The given parts plus every part mounted on a board among them, each once, in diagram order. */
export function withMounted(d: Diagram, uids: string[]): string[] {
  const s = new Set(uids)
  return d.parts.filter((p) => s.has(p.uid) || (p.mount !== undefined && s.has(p.mount.board))).map((p) => p.uid)
}
```

Replace `moveParts` with:

```ts
/** Moves parts; a board carries every part mounted on it, so its legs stay in the same holes. */
export function moveParts(d: Diagram, uids: string[], dx: number, dy: number): Diagram {
  if (!dx && !dy) return d
  const s = new Set(withMounted(d, uids))
  return { ...d, parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }
}
```

Replace `rotateParts` with:

```ts
const turn = (r: Rotation | undefined) => (((r ?? 0) + 90) % 360) as Rotation

/**
 * Where part `p` goes when its board turns a quarter clockwise about the board's pivot: its own
 * pivot swings around the board's, so every leg lands on the hole it was in.
 */
function swungAbout(p: PartInstance, m: ModuleDef, board: PartInstance, bm: ModuleDef): { x: number; y: number } {
  const lay = layoutModule(m)
  const c = pivot(lay.w, lay.h)
  const blay = layoutModule(bm)
  const bc = pivot(blay.w, blay.h)
  const bx = board.x + bc.x
  const by = board.y + bc.y
  const v = rotateVec({ x: p.x + c.x - bx, y: p.y + c.y - by }, 90)
  return { x: bx + v.x - c.x, y: by + v.y - c.y }
}

/**
 * Rotates each part 90 degrees clockwise about its own pivot. A rotated board turns its mounted
 * parts with it (about the board's pivot), so they stay seated. Any other rotated part keeps its
 * mount only while it still fits; rotating never mounts a part.
 */
export function rotateParts(d: Diagram, uids: string[]): Diagram {
  const s = new Set(uids)
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const carriedBy = new Map<string, PartInstance>()
  for (const p of d.parts) if (p.mount && s.has(p.mount.board) && byUid.has(p.mount.board)) carriedBy.set(p.uid, byUid.get(p.mount.board)!)
  const parts = d.parts.map((p) => {
    const board = carriedBy.get(p.uid)
    const m = moduleOf(d, p.module)
    const bm = board && moduleOf(d, board.module)
    if (board && m && bm) return { ...p, ...swungAbout(p, m, board, bm), rotation: turn(p.rotation) }
    return s.has(p.uid) ? { ...p, rotation: turn(p.rotation) } : p
  })
  return settleMounts({ ...d, parts }, uids.filter((u) => !carriedBy.has(u)), 'keep')
}
```

Replace `deleteSelection` with:

```ts
export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  return {
    ...d,
    // A deleted board's parts stay on the sheet, unmounted.
    parts: d.parts.filter((p) => !parts.has(p.uid)).map((p) => (p.mount && parts.has(p.mount.board) ? withoutMount(p) : p)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
  }
}
```

(`withoutMount` and `settleMounts` were added in Task 8; if `withoutMount` is defined below `deleteSelection`, that is fine: it is a `const` arrow used only when the function runs, after module load.)

- [ ] **Step 4: Route carried parts' wires during a board drag in `src/editor/Canvas.tsx`**

Add `withMounted` to the `./ops.ts` import. In the `Drag` type, change the `'parts'` variant to:

```tsx
  | { kind: 'parts'; start: Pt; uids: string[]; moving: string[]; base: Diagram }
```

Change

```tsx
  const draggingParts = drag?.kind === 'parts' ? drag.uids : null
```

to

```tsx
  // Parts that move this drag: the selection plus whatever is mounted on a dragged board.
  const draggingParts = drag?.kind === 'parts' ? drag.moving : null
```

In `onPointerDown`, replace

```tsx
      if (parts.includes(uid)) {
        setDrag({ pointer, kind: 'parts', start: toWorld(e), uids: parts, base: store.begin() })
```

with

```tsx
      if (parts.includes(uid)) {
        const base = store.begin()
        setDrag({ pointer, kind: 'parts', start: toWorld(e), uids: parts, moving: withMounted(base, parts), base })
```

- [ ] **Step 5: Un-skip the move-frame budget test**

In `src/format/breadboard.perf.test.ts`, delete the "Skipped until Task 9" comment and change `it.skip('moves the board with its 20 parts ...'` to `it('moves the board with its 20 parts ...'`.

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run src/editor/ops.test.ts src/editor/store.test.ts src/format/breadboard.perf.test.ts`
Expected: PASS, including the existing `moveParts`, `rotateParts` and `deleteSelection` tests.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/editor/ops.ts src/editor/ops.test.ts src/editor/store.test.ts src/editor/Canvas.tsx src/format/breadboard.perf.test.ts
git commit -m "Boards carry mounted parts when moved or rotated; deleting a board unmounts its parts"
```

---

### Task 10: Hover highlighting of connected holes and pins

**Files:**
- Modify: `src/format/netlist.ts` (add `netPoints`)
- Modify: `src/editor/Canvas.tsx` (hover state, highlight layer)
- Modify: `src/editor/editor.css` (`.net-hi`)
- Test: `src/format/netlist.test.ts` (append)

**Interfaces:**
- Consumes: `netlist`, `nodeKey` (Task 3), `sameEndpoint` (Task 6), `endUnder` (Task 6, inside Canvas).
- Produces: `netPoints(d: Diagram, ep: Endpoint, n?: Netlist): Pt[]`: every hole center of every hole group, and every pin stub tip, on the net of `ep` (just `ep`'s own points when it is on no net). Canvas draws a `.net-hi` circle on each while hovering a pin or hole with no drag in progress.

Decision: hovering a pin highlights too (the PRD's net highlight), not only holes.

- [ ] **Step 1: Write the failing tests** (append to `src/format/netlist.test.ts`; add `netPoints` to the `./netlist.ts` import)

```ts
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
    expect(pts).toHaveLength(3)
  })
  it('lights just the strip itself when nothing connects to it', () => {
    expect(netPoints(netSheet(), { part: 'b', pin: 's2' })).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/format/netlist.test.ts`
Expected: FAIL (`netPoints` is not exported).

- [ ] **Step 3: Add `netPoints` to `src/format/netlist.ts`**

Extend the imports:

```ts
import { type Diagram, type Endpoint, moduleOf } from './diagram.ts'
import { type Pt, toWorld, worldPins } from './geometry.ts'
import { layoutModule } from './module.ts'
```

Then add:

```ts
/**
 * Everything to light up while hovering `ep`: every hole of every hole group on its net and every
 * pin stub tip on it. A pin or group on no net lights only itself (a strip lights its own holes).
 */
export function netPoints(d: Diagram, ep: Endpoint, n: Netlist = netlist(d)): Pt[] {
  const key = nodeKey(ep.part, ep.pin)
  const i = n.netOf.get(key)
  const members = i === undefined ? [key] : n.nets[i]
  const out: Pt[] = []
  for (const k of members) {
    const [uid, name] = JSON.parse(k) as [string, string]
    const part = d.parts.find((p) => p.uid === uid)
    const m = part && moduleOf(d, part.module)
    if (!part || !m) continue
    const group = m.holes?.find((g) => g.name === name)
    if (group) {
      const lay = layoutModule(m)
      for (const [x, y] of group.at) out.push(toWorld(part, lay, { x, y }))
    } else {
      const pin = worldPins(part, m).find((p) => p.name === name)
      if (pin) out.push(pin.end)
    }
  }
  return out
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/format/netlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Highlight on hover in `src/editor/Canvas.tsx`**

Add imports: `import { netPoints } from '../format/netlist.ts'` and `sameEndpoint` to the `./ops.ts` import.

After the `drag` state, add:

```tsx
  // The pin or hole under the pointer while nothing is being dragged, for net highlighting.
  const [hover, setHover] = useState<Endpoint | null>(null)
```

After the `seats` `useMemo`, add:

```tsx
  const net = useMemo(() => (hover && !drag ? netPoints(diagram, hover) : []), [hover, drag, diagram])
```

At the top of `onPointerMove`, replace

```tsx
    if (!drag || e.pointerId !== drag.pointer) return
```

with

```tsx
    if (!drag) {
      const over = endUnder(e)
      setHover((h) => (h === over || (h && over && sameEndpoint(h, over)) ? h : over))
      return
    }
    if (e.pointerId !== drag.pointer) return
```

On the `<svg>` element, add `onPointerLeave={() => setHover(null)}` next to `onPointerCancel`.

After the name-tag `<g>` layer (the one that draws `WireLabel`s), add:

```tsx
        {net.length > 0 && (
          <g pointerEvents="none">
            {net.map((p, i) => <circle key={i} className="net-hi" cx={p.x} cy={p.y} r={4} />)}
          </g>
        )}
```

- [ ] **Step 6: Style it in `src/editor/editor.css`**

```css
.net-hi { fill: rgba(61, 111, 214, 0.25); stroke: #3D6FD6; stroke-width: 1.5; }
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/format/netlist.ts src/format/netlist.test.ts src/editor/Canvas.tsx src/editor/editor.css
git commit -m "Hover a hole or pin to light its whole net: strip holes, legs, wires and internal joins"
```

---

### Task 11: Prototyping category and hole counts on the landing page

**Files:**
- Modify: `src/editor/libraryGroups.ts` (`CATEGORY_ORDER`)
- Modify: `src/editor/libraryGroups.test.ts`
- Modify: `src/Landing.tsx` (`countLabel`)
- Modify: `src/Landing.test.ts`

**Interfaces:**
- Consumes: `ModuleDef.holes` (Task 1), the five boards (Task 7).
- Produces: `CATEGORY_ORDER = ['Batteries', 'Prototyping', 'Power', 'Microcontrollers', 'Displays', 'Chips', 'Passives', 'Indicators', 'Switches']`; `countLabel(m: ModuleDef): string` ("4 pins", "1 pin", "830 holes", or "2 pins, 40 holes").

- [ ] **Step 1: Write the failing tests**

In `src/editor/libraryGroups.test.ts`, replace the first test with:

```ts
  it('fixes the category order as Batteries, Prototyping, Power, Microcontrollers, Displays, Chips, Passives, Indicators, Switches', () => {
    expect(CATEGORY_ORDER).toEqual([
      'Batteries', 'Prototyping', 'Power', 'Microcontrollers', 'Displays', 'Chips', 'Passives', 'Indicators', 'Switches',
    ])
  })

  it('puts Prototyping right after Batteries', () => {
    const groups = groupLibrary([
      mod('resistor', 'Resistor', 'Passives'),
      mod('breadboard-full', 'Full breadboard (830)', 'Prototyping'),
      mod('battery-9v', '9V battery', 'Batteries'),
    ])
    expect(groups.map((g) => g.category)).toEqual(['Batteries', 'Prototyping', 'Passives'])
  })
```

In `src/Landing.test.ts`, add `countLabel` to the import and append:

```ts
describe('countLabel', () => {
  const base = { format: 'circuitoon-module/1' as const, id: 'x', name: 'X' }
  it('counts pins, skipping spacers', () => {
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }, { spacer: true, side: 'left' }] })).toBe('1 pin')
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }, { name: 'B', side: 'left' }] })).toBe('2 pins')
  })
  it('counts holes for a board', () => {
    expect(countLabel({ ...base, pins: [], holes: [{ name: 's', at: [[10, 10], [10, 20]] }] })).toBe('2 holes')
  })
  it('lists both when a module has pins and holes', () => {
    expect(countLabel({ ...base, pins: [{ name: 'A', side: 'left' }], holes: [{ name: 'p', at: [[10, 10]], holeStyle: 'pad' }] })).toBe('1 pin, 1 hole')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/libraryGroups.test.ts src/Landing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/editor/libraryGroups.ts`:

```ts
export const CATEGORY_ORDER = ['Batteries', 'Prototyping', 'Power', 'Microcontrollers', 'Displays', 'Chips', 'Passives', 'Indicators', 'Switches']
```

In `src/Landing.tsx`, add (exported, next to `sourceLinks`):

```tsx
/** "4 pins", "1 pin", "830 holes" for a board, or both when a module has pins and holes. */
export function countLabel(m: ModuleDef): string {
  const pins = m.pins.filter((p) => !isSpacer(p)).length
  const holes = (m.holes ?? []).reduce((n, g) => n + g.at.length, 0)
  const out: string[] = []
  if (pins || !holes) out.push(`${pins} ${pins === 1 ? 'pin' : 'pins'}`)
  if (holes) out.push(`${holes} ${holes === 1 ? 'hole' : 'holes'}`)
  return out.join(', ')
}
```

(import `type ModuleDef` from `./format/module.ts` if `Landing.tsx` does not already.) In the card, delete `const pinCount = ...` and change the meta line to:

```tsx
        <p className="meta">{m.category ?? 'Uncategorized'}, {countLabel(m)}</p>
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/editor/libraryGroups.test.ts src/Landing.test.ts`
Expected: PASS.

- [ ] **Step 5: Run everything and look at the panel**

Run: `npm test && npm run build`
Run: `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs --panel --out <scratchpad>/bb`
Read `parts-panel.png`: a "Prototyping" group of 5 sits right after "Batteries".

- [ ] **Step 6: Commit**

```bash
git add src/editor/libraryGroups.ts src/editor/libraryGroups.test.ts src/Landing.tsx src/Landing.test.ts
git commit -m "Prototyping category after Batteries; landing cards count holes"
```

---

### Task 12: Docs: PRD format rows, breadboard behavior, parts conventions

**Files:**
- Modify: `docs/PRD.md`
- Modify: `.claude/skills/circuitoon-add-part/SKILL.md`
- Modify: `.claude/skills/circuitoon-add-part/references/conventions.md`

**Interfaces:**
- Consumes: the behavior built in Tasks 1-11.
- Produces: documentation only.

- [ ] **Step 1: PRD, V1 canvas and interaction**

After the last **Parts (module instances)** bullet ("- Parts may overlap while dragging. A part dropped overlapping another shows an overlap warning outline."), insert:

```markdown

**Breadboards**

- A board (a module with hole groups and `"obstacle": false`) accepts parts. A part is **seated** when every pin's plug point (its edge point on the body) lands exactly on a free hole of one board. While dragging, the holes under a seated part's legs light green; when only some legs land, or a hole is already taken, they light red.
- Dropping a seated part mounts it (`mount.board`); dropping it anywhere else, or dragging it off, unmounts it. A mounted part's pins join the hole groups their legs sit in, with no wires. Taken holes darken, and each leg shows as a metal dot on its hole.
- Dragging or rotating a board carries its mounted parts in the same undo step. Rotating a mounted part keeps the mount only if it still fits; rotating never mounts a part. Deleting a board keeps its parts, unmounted.
- Press a hole to start a wire there; drag a board from between its holes. Wires route over boards (parts on them are still obstacles), and a wire ending in a hole may leave it in any direction.
- Parts with a bus pin never mount. The ESP32 DevKit modules are 120 px between header rows, wider than a full board's rows a to j (110 px), so they do not seat yet; XIAO, C3 SuperMini, ESP32-CAM and DIP-28 chips seat across the channel after a 90 degree turn.
```

Replace

```markdown
- Draw: drag from a pin to another pin, or onto a bus pin (rail or strip) at the spot where it should land. Pins highlight when a dragged wire end is within snapping range.
```

with

```markdown
- Draw: drag from a pin or a breadboard hole to another pin or hole, or onto a bus pin (rail or strip) at the spot where it should land. Pins and holes highlight when a dragged wire end is within snapping range.
```

Replace

```markdown
    - End handle: drag off a pin and drop on another pin to reconnect; dropping on empty canvas cancels.
```

with

```markdown
    - End handle: drag off a pin or hole and drop on another pin or hole to reconnect; dropping on empty canvas cancels.
```

Replace

```markdown
- Hovering a pin highlights every pin on the same net, including through bus pins and `internal` joins.
```

with

```markdown
- Hovering a pin or a breadboard hole highlights every pin and hole on the same net, through wires, mounted legs, bus pins and `internal` joins.
```

- [ ] **Step 2: PRD, module definition format**

Replace the `pins[]` row with:

```markdown
| `pins[]` | yes | Each entry is either a **pin** or a **spacer**. May be empty when the module has hole groups (a breadboard). |
```

After the `spacer` row, insert:

```markdown
| `holes[]` | no | Hole groups: pins inside the body. Each is `{ "name", "label"?, "at": [[x, y], ...], "rail"?, "holeStyle"? }`, one electrical node whose holes sit at the listed module-local px positions, each on a 10 px grid point inside the body, never two at one point. Names share one namespace with pin names; wires reference a group by `name` plus a `hole` index. A single-position group is an ordinary interior pin. Hole groups never grow the body. |
| hole group `rail` | no | `"+"` or `"-"`: the group is a power rail. |
| hole group `holeStyle` | no | `"pad"` draws each position as a header pad instead of a breadboard hole (a full-size header in its true position). |
```

Replace the `internal` row's meaning text "Groups of pin names joined permanently inside the part" with "Groups of pin or hole group names joined permanently inside the part".

After the `size` row, insert:

```markdown
| `obstacle` | no | `false` lets wires route over the part. Breadboards set it; parts mounted on them are still obstacles. A module with hole groups and `"obstacle": false` is a **board**, which parts can be mounted on. |
```

Replace the validation paragraph with:

```markdown
**Validation.** Import rejects a file, with the exact reason and path, on: missing `format`, `id` or `name`; an empty `pins` list without hole groups; duplicate pin or hole group names; unknown `side`; a spacer with a name; `internal` naming a missing pin or group; malformed `bus`, `art` or `holes`; a hole off the 10 px grid, outside the body or on top of another hole; an `obstacle` that is not true or false.
```

- [ ] **Step 3: PRD, diagram format**

Replace

```markdown
- **Endpoints.** `{ part, pin }`, plus `offset` (grid units from the bus start) when the pin is a bus. Without `offset`, a bus endpoint lands at the nearest free spot.
```

with

```markdown
- **Endpoints.** `{ part, pin }`, where `pin` names a pin or a hole group. `hole` (a whole number, default 0) picks one hole of a group: the wire ends at that hole's center and may leave it in any direction. A `hole` that is not a whole number refuses the load; one past the end of its group loads with a warning. `offset` (grid units from a bus start) is still read from older files.
- **Mounting.** A part may carry `"mount": { "board": "<board uid>" }`. Its pins connect to whichever hole groups their plug points (pin edge points) sit on, computed from positions; its `x, y` stay absolute. The mount plus positions fully determine the plugged connections. A mount naming a missing part, the part itself, or a part that is not a board loads with a warning.
```

Replace the start of the netlist bullet

```markdown
- **`connections` is the netlist.** Positions, labels and routes are presentation.
```

with

```markdown
- **`connections` and mounts are the netlist.** Wires, mounted legs (from `mount` plus positions) and `internal` groups merge into nets; labels and routes are presentation.
```

(keep the rest of that bullet as it is).

- [ ] **Step 4: PRD, built-in parts, decisions and open questions**

After the `| Power | ... |` row of the built-in parts table, insert:

```markdown
| Prototyping | Full breadboard (830), half breadboard (400), mini breadboard (170), tiny breadboard (25), power rail strip | - |
```

In the "Not built yet" sentence, delete `breadboards, `.

Replace

```markdown
- Wires join only at pins, bus pins (rails, strips) or internally joined pins, as in the reference. No wire-to-wire junctions in V1.
```

with

```markdown
- Wires join only at pins, breadboard holes, bus pins or internally joined pins, as in the reference. No wire-to-wire junctions in V1.
```

Replace

```markdown
- [x] Breadboards are modeled at rail and strip level (bus pins with offsets); hole-level is deferred.
```

with

```markdown
- [x] Breadboards are modeled at hole level (2026-09-25): each strip and rail is a hole group, parts plug in by mounting, and jumpers end in any hole. Bus pins with offsets stay readable for older files.
```

- [ ] **Step 5: Parts skill and conventions**

In `.claude/skills/circuitoon-add-part/SKILL.md`, step 5, replace

```markdown
(existing: `gen-boards.mjs` for ESP32 boards, `gen-parts.mjs` for chips and displays)
```

with

```markdown
(existing: `gen-boards.mjs` for ESP32 boards, `gen-parts.mjs` for chips and displays, `gen-breadboards.mjs` for breadboards and rail strips)
```

Replace the last pin rule

```markdown
- Pins in the interior of a body (a 2x20 header in its true position, breadboard holes) need the interior-pin format from the breadboard work; until that lands, do not fake an interior header by spreading its rows onto opposite edges. Say so and defer the part.
```

with

```markdown
- Pins in the interior of a body (a 2x20 header in its true position) are hole groups: `"holes": [{ "name": "GPIO2", "label": "GPIO2", "at": [[x, y]], "holeStyle": "pad" }]`, one single-position group per header pin, each on a 10 px grid point inside the body. Names share the pin namespace. Never fake an interior header by spreading its rows onto opposite edges.
```

In `.claude/skills/circuitoon-add-part/references/conventions.md`, replace

```markdown
Batteries, Power, Microcontrollers, Displays, Chips, Passives, Indicators, Switches, then others alphabetically. Planned: "Prototyping" (breadboards) after Batteries; "Microcontrollers" becomes "Boards" once full-size Raspberry Pis land. Empty groups are hidden.
```

with

```markdown
Batteries, Prototyping, Power, Microcontrollers, Displays, Chips, Passives, Indicators, Switches, then others alphabetically. Planned: "Microcontrollers" becomes "Boards" once full-size Raspberry Pis land. Empty groups are hidden.
```

and after the geometry checklist line "- Board width a multiple of 10 px so both header rows sit on grid points (needed for breadboard snapping).", add:

```markdown
- To seat across a breadboard's center channel after a 90 degree turn, a board's header rows must be 30 px (rows e and f) to 110 px (rows a and j) apart. The ESP32 DevKit modules (120 px) do not fit yet.
```

- [ ] **Step 6: Check for em dashes and commit**

Run: `LC_ALL=C.UTF-8 grep -nP "\x{2014}" docs/PRD.md .claude/skills/circuitoon-add-part/SKILL.md .claude/skills/circuitoon-add-part/references/conventions.md`
Expected: no output.

```bash
git add docs/PRD.md .claude/skills/circuitoon-add-part/SKILL.md .claude/skills/circuitoon-add-part/references/conventions.md
git commit -m "Docs: hole groups, hole endpoints, mount and obstacle in the PRD; breadboard conventions"
```

---

### Task 13: Final visual verification and browser pass

**Files:**
- Create: `scripts/perf-breadboard.mjs`

**Interfaces:**
- Consumes: everything above; `.claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs`.
- Produces: a repeatable browser check (frame budget, snapping, hover, rotate, delete) and reviewed screenshots.

- [ ] **Step 1: Run the full suite**

Run: `npm test && npm run validate && npm run build`
Expected: all pass.

Run: `node scripts/gen-breadboards.mjs && git status --porcelain modules/`
Expected: no output (the generator reproduces the committed boards byte for byte).

- [ ] **Step 2: Screenshot every board**

Run (use this session's scratchpad directory for `--out`):

```bash
node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs breadboard-full breadboard-half breadboard-mini breadboard-tiny power-rail-strip --out <scratchpad>/bb --panel
node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs breadboard-full breadboard-half --out <scratchpad>/bb --rotate 90
node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs breadboard-full --out <scratchpad>/bb-dark --dark
```

Expected: 9 board images plus `parts-panel.png`, and no page errors printed. Read every image and check:
- Holes form straight rows and columns at 0.1 inch; rows a-e and f-j sit either side of the channel; rails come in groups of 5 with a gap.
- Red stripe beside every + rail, blue beside every - rail; row letters at both ends; column numbers at 1 and every 5th column; labels readable and not overlapping holes.
- The rotated boards keep every hole on the grid and labels upright enough to read (labels are art, so they turn with the board; that is expected).
- The body reads as a white breadboard in the Sticker style on both themes.
- The Parts panel shows a "Prototyping" group of 5 right after "Batteries", with legible thumbnails.

Fix anything that reads poorly in `scripts/gen-breadboards.mjs`, regenerate, rerun Task 7's tests, and shoot again.

- [ ] **Step 3: Create `scripts/perf-breadboard.mjs`**

```js
// Browser check for breadboards, in the built app: loads a full 830-hole board with 20 seated
// resistors and 10 rail jumpers, then through the real UI checks hole hover, leg snapping (red
// partial, green seated, mount and unmount on drop), dragging the board with its parts while
// recording frame times, rotating it, and deleting it.
//
// Usage (repo root, after `npm run build`):
//   node scripts/perf-breadboard.mjs [--out <dir>] [--port 4191]
// Budget: median frame <= 17 ms and 95th percentile <= 33 ms while dragging the board. Exits 1
// when any check fails. Launches its own Chrome through playwright-core; never use the shared
// Playwright MCP browser.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i < 0 ? dflt : args[i + 1]
}
const out = resolve(opt('--out', join(tmpdir(), 'circuitoon-breadboard')))
const port = Number(opt('--port', '4191'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

// The sheet: the full board at (0, 0); 20 resistors seated in rows a, e and h (a resistor body is
// 60 x 40 with its legs at local (0, 20) and (60, 20)); 10 jumpers from the top + rail to row c
// of columns no resistor covers.
const board = JSON.parse(readFileSync('modules/breadboard-full.json', 'utf8'))
const resistor = JSON.parse(readFileSync('modules/resistor.json', 'utf8'))
const parts = [{ uid: 'bb', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }]
let n = 0
for (const row of [60, 100, 150])
  for (let k = 0; k < 7 && n < 20; k++) {
    n++
    parts.push({ uid: `r${n}`, designator: `R${n}`, module: resistor.id, x: 30 + k * 90, y: row - 20, rotation: 0, mount: { board: 'bb' } })
  }
const freeColumns = [8, 17, 26, 35, 44, 53, 62, 9, 18, 27]
const connections = freeColumns.map((c, i) => ({
  uid: `w${i + 1}`, from: { part: 'bb', pin: 'top+', hole: i * 5 }, to: { part: 'bb', pin: `c${c}-top`, hole: 2 }, color: 'red', gauge: 22,
}))
const file = join(out, 'breadboard-check.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Breadboard check', modules: { [board.id]: board, [resistor.id]: resistor }, parts, connections,
}))

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' })
const stopServer = () => {
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    else server.kill('SIGTERM')
  } catch {
    // already gone
  }
}
process.on('exit', stopServer)
const base = `http://localhost:${port}/circuitoon/`
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base)).ok) break
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('dialog', (d) => d.accept())

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const shot = async (name) => {
  await page.locator('.canvas-wrap').screenshot({ path: join(out, name) })
  console.log('saved', join(out, name))
}
/** Screen point of a world point, through the canvas SVG's own transform. */
const toScreen = (x, y) =>
  page.evaluate(([wx, wy]) => {
    const svg = document.querySelector('svg.canvas')
    const p = new DOMPoint(wx, wy).matrixTransform(svg.getScreenCTM())
    return { x: p.x, y: p.y }
  }, [x, y])
const count = (selector) => page.locator(selector).count()
const pause = (ms = 120) => page.waitForTimeout(ms)
/** Drags from world point `from` by world delta (dx, dy) in `steps` pointer moves, calling `during(step)` after each. */
async function drag(from, dx, dy, steps, during) {
  const a = await toScreen(from.x, from.y)
  const b = await toScreen(from.x + dx, from.y + dy)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
    await page.waitForTimeout(8)
    if (during) await during(i)
  }
  return async () => {
    await page.mouse.up()
    await pause()
  }
}

await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /New diagram/ }).click()
await page.waitForSelector('.toolbar')
const t0 = Date.now()
await page.locator('input[type=file]').setInputFiles(file)
await page.waitForSelector('[data-part="bb"]')
console.log(`loaded the 830-hole board with 20 parts in ${Date.now() - t0} ms`)
await pause(300)
await shot('loaded.png')
check((await count('[data-legs] circle')) === 40, 'all 40 legs plugged in on load')

// Hover row e of column 8: a free hole below the jumper's end (row c), so no wire covers it. The
// strip is joined to the top + rail by a jumper, like the other 9 jumper strips.
const hole = await toScreen(100, 100)
await page.mouse.move(hole.x, hole.y)
await pause()
const lit = await count('.net-hi')
check(lit === 100, `hovering a hole lights its net: rail 50 + 10 strips x 5 = 100 holes (got ${lit})`)
await shot('hover.png')
await page.mouse.move(5, 5)
await pause()

// Drag R1 (legs at (30, 60) and (90, 60)) down by 200 px: at +140 only its right leg meets the
// bottom - rail (red); at +200 it is off the board, and dropping there unmounts it.
const releaseOff = await drag({ x: 60, y: 60 }, 0, 200, 20, async (step) => {
  if (step !== 14) return
  await pause()
  check((await count('.seat-bad')) === 1, 'half on a rail: one red leg')
  await shot('partial.png')
})
await releaseOff()
check((await count('[data-legs] circle')) === 38, 'dropped off the board: R1 unmounted (38 legs)')

// Drag it back to where it was: both legs green, and dropping mounts it again.
const releaseBack = await drag({ x: 60, y: 260 }, 0, -200, 20)
await pause()
check((await count('.seat-ok')) === 2, 'back on its holes: two green legs')
await shot('seated.png')
await releaseBack()
check((await count('[data-legs] circle')) === 40, 'dropped seated: R1 mounted again (40 legs)')

// Drag the board by its center channel in a free column, recording frame times.
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = (t) => {
    window.__frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const f0 = await page.evaluate(() => window.__frames.length)
const releaseBoard = await drag({ x: 100, y: 115 }, 200, 0, 60)
const frames = await page.evaluate((i) => window.__frames.slice(i), f0)
await releaseBoard()
frames.sort((a, b) => a - b)
const med = frames[frames.length >> 1]
const p95 = frames[Math.floor(frames.length * 0.95)]
console.log(`board drag: ${frames.length} frames, median ${med.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`)
check(med <= 17 && p95 <= 33, 'board drag frame budget (median <= 17 ms, p95 <= 33 ms)')
const leg = await page.locator('[data-legs] circle').first()
check((await leg.getAttribute('cx')) === '290' && (await leg.getAttribute('cy')) === '60', 'the board carried R1 by 200 px (its first leg dot, pin 2 on the right, is at 290, 60)')
check((await count('[data-legs] circle')) === 40, 'all 40 legs still plugged after the board drag')
await shot('board-moved.png')

// Rotate the (selected) board: its parts turn with it and stay plugged.
await page.keyboard.press('r')
await pause(300)
check((await count('[data-legs] circle')) === 40, 'rotating the board keeps all 40 legs plugged')
await shot('board-rotated.png')

// Delete the board: the resistors stay, unmounted; the jumpers go with it.
await page.keyboard.press('Delete')
await pause(300)
check((await count('[data-part="bb"]')) === 0, 'board deleted')
check((await count('[data-part^="r"]')) === 20, 'its 20 resistors remain')
check((await count('[data-legs] circle')) === 0, 'no legs plugged after deleting the board')
await shot('board-deleted.png')

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await browser.close()
stopServer()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall breadboard checks passed')
```

- [ ] **Step 4: Run the browser pass**

Run: `node scripts/perf-breadboard.mjs --out <scratchpad>/bb-pass`
Expected: every line starts with `ok`, the board-drag line reports a median at or under 17 ms and a p95 at or under 33 ms, and the script ends with `all breadboard checks passed`.

If the frame budget fails, profile before changing anything: record a Chrome performance trace of the same drag (`page.tracing` or DevTools) and look first at the per-frame `computeRoutes` for the 10 jumpers, `plugsOf`, and re-rendering of unchanged parts (each `Part` is memoized; a new `values` object would defeat that). Do not raise the budget.

- [ ] **Step 5: Read every screenshot**

Read `loaded.png`, `hover.png`, `partial.png`, `seated.png`, `board-moved.png`, `board-rotated.png`, `board-deleted.png`. Check:
- Resistors sit on the board with a metal dot on each leg's hole; taken holes are darker than free ones.
- The hover lights the whole top + rail and the ten jumper strips in blue, nothing else.
- `partial.png` shows one red ring; `seated.png` shows two green rings exactly on hole centers.
- After the move and the rotation the resistors are still on the same holes, and jumpers still end on hole centers, leaving in whatever direction is shortest.
- After deleting, the resistors remain with no leg dots and no jumpers.

- [ ] **Step 6: Final checks and commit**

Run: `LC_ALL=C.UTF-8 grep -rnP "\x{2014}" src scripts modules docs/PRD.md docs/superpowers/plans/2026-09-25-breadboards.md .claude/skills/circuitoon-add-part`
Expected: no output.

Run: `npm test && npm run build`
Expected: PASS.

```bash
git add scripts/perf-breadboard.mjs
git commit -m "Browser check for breadboards: frame budget while dragging a loaded board, snapping, hover, rotate, delete"
```

---

## Self-review

### Spec coverage

| Spec requirement | Task |
| --- | --- |
| Five boards (full 830, half 400, mini 170, tiny 25, power rail strip) with the stated layouts | 7 |
| Hole pitch 10 px, holes on grid points, rails in groups of 5 with a gap, continuous full-size rails | 7 (layout tests), 1 (grid validation) |
| Category "Prototyping" after Batteries | 11 |
| Format 1: hole groups (`name`, `label`, `at`, `rail`), one node each, names unique across pins and groups | 1 (types, validation), 3 (one node each in the netlist) |
| Format 2: hole endpoints `{ part, pin, hole }`; `offset` still readable | 1 (types, validation), 2 (resolution), 4 (routing) |
| Format 3: `mount: { board }`, positions stay absolute, file is the source of truth | 1 (types, validation, round trip), 3 (`plugsOf` from mount plus positions) |
| Format 4: `obstacle: false`; mounted parts still obstacles | 1, 4 |
| Interior pins: single-position groups treated like pins; `holeStyle: "pad"` drawn as a pad | 1 (validation), 5 (pad drawing), 3 and 10 (netlist and hover treat any group alike), 12 (skill docs) |
| Plug point is the pin edge point; stub from edge to hole | 2 (`plugPoints`), 5 (leg dots; decision recorded) |
| Seated check: every plug point on a hole of one board, no hole taken; green when seated, red when partial | 8 |
| On drop: seated part mounts; dragging off clears the mount | 8 |
| Boards carry parts in one undo step | 9 (ops and store tests) |
| Deleting a board unmounts its parts but keeps them | 9 |
| Rotation re-checks the fit and removes a mount that no longer fits | 9 |
| Edge pins only; four-sided parts mount if every plug point fits; ESP32 boards need rotating | 8 (real-part tests; DevKit width limitation recorded), 12 |
| Wires end on any hole, at the hole center, leaving in any direction; router seeds four headings and accepts any arrival | 4, 6 |
| Hover a hole: its group plus everything connected through wires, mounts and `internal` | 10 |
| Pure `netlist(diagram)` merging wires, mounted plugs and `internal` groups | 3 |
| Renderer draws holes from hole groups, not art rectangles | 5 |
| Board art: white body, center channel, red and blue rail stripes, row letters and column numbers every 5 | 7 |
| Taken holes darken; leg stubs of mounted parts drawn to hole centers | 5 |
| Tests: hole-group validation; endpoint resolution with rotation; seated detection incl. partial and conflict; mount persistence and round trip; board carries parts as one undo step; netlist merging; router with free-direction ends | 1; 2; 8; 1; 9; 3; 4 |
| Out of scope respected (split rails, hole-level wire editing beyond choosing the hole, auto-placing, simulation) | none of the tasks add them |
| Plan extras: performance budgets with timing tests; PRD rows for `holes`, `hole`, `mount`, `obstacle`, `holeStyle`; shoot-parts and browser pass | 5, 8, 13; 12; 13 |

No gaps found.

### Placeholder scan

Searched the plan for "TBD", "TODO", "implement later", "fill in", "appropriate", "similar to Task", "handle edge cases" and "write tests for": none. Every code step shows the code; every run step shows the command and the expected result. The only deferred item is intentional and explicit: one timing test is written with `it.skip` in Task 8 and un-skipped in Task 9, Step 5, because it depends on Task 9's carrying `moveParts`. `<scratchpad>` in commands means the executing session's scratchpad directory.

### Type consistency

- `HoleGroup`, `ModuleDef.holes`, `ModuleDef.obstacle`, `isBoard` (Task 1) are used with the same names in Tasks 2, 3, 5, 7, 8, 9, 11.
- `PartInstance.mount: { board: string }` and `Endpoint.hole?: number` (Task 1) match their uses in `plugsOf`, `settleMounts`, `withMounted`, `rotateParts`, `deleteSelection`, `sameEndpoint`, `holeUnder` and the test fixtures.
- `WorldHoleGroup` / `worldHoles`, `PlugPoint` / `plugPoints`, `ResolvedEnd` / `resolveEndpoint` (Task 2) match Task 3 (`holeIndex` stores `WorldHoleGroup[]`), Task 4 (`manualPoints(a: ResolvedEnd, b: ResolvedEnd, ...)`), Task 6 (Canvas `resolveEndpoint(...).end`) and Task 8 (`plugPoints(...).at`).
- `pointKey`, `HoleIndex`, `holeIndex`, `Plug`, `plugsOf` (Task 3); `splitBoards` (Task 5); `HoleRef`, `holeAtPoint` (Task 6); `Seat`, `seatOf(d, uid, plugs, ignore?)` (Task 8) are all in `src/format/breadboard.ts` and called with those signatures in `ops.ts`, `Canvas.tsx`, `Sheet.tsx` and the tests.
- `nodeKey`, `Netlist`, `netlist(d, plugs?)` (Task 3) and `netPoints(d, ep, n?)` (Task 10) in `src/format/netlist.ts` match their tests and the Canvas hover.
- `RouteRequest.fromDir` / `toDir: Pt | null` (Task 4) are fed from `ResolvedEnd.dir: Pt | null`.
- `sameEndpoint` replaces the private `sameEnd` everywhere in `ops.ts` (Task 6) and is imported by Canvas in Task 10.
- `settleMounts(d, uids, mode?: 'drop' | 'keep')` (Task 8) is used with `'keep'` by `rotateParts` (Task 9) and with the default by `finishPartsDrag` (Task 8) and the perf test.
- `withMounted(d, uids)` (Task 9) is used by `moveParts` and by Canvas's `Drag` `moving` field.
- `holePathData(m)` and `METAL` (Task 5, `Part.tsx`) are used by `holes.perf.test.ts` and `Boards.tsx`; `TakenHoles` / `LegDots` take `{ plugs: Plug[] }` in both `Sheet.tsx` and `Canvas.tsx`, and `LegDots` renders the `data-legs` group that `scripts/perf-breadboard.mjs` counts.
- CSS classes `.hole-target` (Task 6), `.seat-ok` / `.seat-bad` (Task 8) and `.net-hi` (Task 10) match the class names in Canvas and in the browser script.
