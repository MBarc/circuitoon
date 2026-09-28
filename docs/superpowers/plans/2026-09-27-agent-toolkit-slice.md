# Agent Toolkit, First Slice, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Another Claude Code session can go from a request to a Circuitoon schematic that provably implements the requested circuit (netlist in, laid-out sheet out, verified against its intent, checked, rendered to PNG and SVG, opened by link), through a `circuitoon` CLI and a `circuitoon-design` skill shipped as a Claude Code plugin from the public repo.

**Architecture:** Pure toolkit logic lives in `src/agent/` (netlist parsing with repeat expansion, placement with breadboard mounting, net realization, readability metrics, electrical-equivalence verification) on top of the existing `src/format/` model, checker and router. The CLI (`src/cli/`) is bundled by Vite into one committed ES module, `plugin/dist-cli/circuitoon.mjs`, which resolves the `import.meta.glob` module catalog at build time and renders the existing `Sheet` with `react-dom/server`; `scripts/gen-cli.mjs` writes it through `lib/gen-output.mjs`, so `npm run check:gen` proves the committed bundle is byte-identical to a fresh build. The site gains link loading (`#/editor?d=v1.`), group frames and text notes on the canvas, and an App route key that survives the fragment cleanup.

**Tech Stack:** Vite 8 (SSR build for the CLI), React 19 (`react-dom/server` for SVG), TypeScript 7 with `erasableSyntaxOnly`, vitest 5, web `CompressionStream` / `DecompressionStream` (browser and Node 22+), headless Chrome or Edge for PNG, playwright-core (dev only, browser checks), Claude Code plugin manifests. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-agent-toolkit-slice-design.md` (revision 4, the authority). Product spec: `docs/PRD.md`. Part conventions: `.claude/skills/circuitoon-add-part/SKILL.md`.

## Global Constraints

- Work only in the worktree `C:/Users/micha/Desktop/projects/Circuitoon-toolkit` on branch `agent-toolkit`; always `cd` there. Never touch `C:/Users/micha/Desktop/projects/Circuitoon-mains` (another agent works there) or switch branches in any worktree. Never use bare `git stash`.
- The worktree has no `node_modules`: run `npm ci` once before Task 1 (Task 1 Step 0).
- TypeScript stays erasable-only (`erasableSyntaxOnly`): no enums, no parameter properties, no namespaces, no decorators.
- No em dashes or en dashes anywhere: code, comments, UI copy, docs, skill text, commit messages. Use commas, colons, parentheses or hyphens.
- Match the codebase style: a comment header on every new file saying what it is for, plain-words error messages that name the path or part, pure functions in `src/format/` and `src/agent/`, `.testing.ts` for test helpers, two-space indent, no semicolons.
- Generators are byte-reproducible: every file a script generates goes through `scripts/lib/gen-output.mjs` (`emit`/`log`/`finish`) so `npm run check:gen` verifies it. From Task 9 on this includes the CLI bundle `plugin/dist-cli/circuitoon.mjs`: after any change under `src/` or `modules/`, run `npm run build:cli` before the gate and commit the regenerated bundle.
- Never use the Playwright MCP browser (shared with other agents). Browser checks launch the locally installed Chrome through playwright-core (`channel: 'chrome'`) with their own profile; the CLI's PNG path spawns Chrome or Edge headless with a throwaway `--user-data-dir`.
- Research for parts (the skill's step 2) never sends personal data in requests: no names, emails, addresses, order numbers or tokens in URLs, queries or bodies.
- Spec values, copied verbatim:
  - Netlist format `circuitoon-netlist/1`; refs match `[A-Za-z][A-Za-z0-9_]*`; string endpoints split at the first dot; exact pin name before a silkscreen label, a label only when exactly one pin has it; hole indexes zero-based, an omitted index means any free hole.
  - Layout: 10 px grid; up to 3 placements with increased spacing; mounted parts try rotations 0 and 90 degrees, row-major from the board's top-left, first accepted wins; a breadboard hole takes one wire end or one leg; a header pin or pad takes one wire end unless its module declares `capacity`; routing additions carry `routing: true`.
  - Readability report: body overlaps (must be 0), caption overlaps (must be 0), wire crossings, total wire length, sheet size, blocked nets (must be 0). "The 2 s budget for 120 parts includes routing."
  - CLI: "Node 22 or newer"; exit codes "0 ok, 1 findings that block (section 5), 2 invalid input, 3 environment problem such as no browser"; `--json` prints one JSON document on stdout, diagnostics on stderr.
  - Links: `#/editor?d=v1.<base64url(deflate-raw(json))>`; "encoded payload up to 64 KB"; "decompression aborts past 5 MB (the file import limit) and past 2,000 parts or 10,000 connections"; after loading, `history.replaceState` to `#/editor` without remounting the editor.
  - Gate: exits 0 only when nothing blocks; `gate.json` holds a SHA-256 of the diagram and of each artifact.
- Every task ends with its gate passing, run from the worktree root:
  ```bash
  cd C:/Users/micha/Desktop/projects/Circuitoon-toolkit
  npx tsc --noEmit
  npm run validate && npm run check:gen && npm test && npm run build
  ```
  (from Task 9 on, `npm run build:cli` runs first).
- Commit messages end with the attribution line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Do not push and do not deploy (shipping is the `circuitoon-ship` skill, later).

## Decisions this plan makes where the spec is open

Each is repeated in the task that implements it.

1. **PNG without playwright-core at runtime.** The spec says PNG goes "through playwright-core". A plugin install is a copy of the plugin folder with no `node_modules` and no install hook, and playwright-core (14 MB) does not bundle reliably. The CLI therefore auto-detects Chrome or Edge exactly as specified and drives it directly (`--headless=new --screenshot`), with the specified failure (exit 3, install guidance, `--svg` suggested). playwright-core stays a devDependency for the repo's browser checks. This needs Michael's nod at review.
2. **CLI build:** `vite.cli.config.ts` is an SSR build of `src/cli/main.ts` with `ssr.noExternal: true` (React, `react-dom/server` and every module JSON bundled; Node built-ins external), `process.env.NODE_ENV` defined as production, unminified, one chunk. The "generated module catalog" is Vite resolving `import.meta.glob('../modules/*.json')` at build time, so the CLI and the site read one catalog and nothing can drift.
3. **Committed bundle:** the plugin system has no build step, so `plugin/dist-cli/circuitoon.mjs` is committed. `scripts/gen-cli.mjs` builds it in memory and writes it through `emit`, so `check:gen` (and the deploy) fail when source and bundle disagree. `.gitattributes` pins it to LF. Consequence: every later module addition (including the mains branch) must run `npm run build:cli`; Task 18 adds that to the add-part and ship skills.
4. **Plugin root is `plugin/`**, not the repo root, so installing copies only the plugin (manifest, skill, bin, bundle). The marketplace file sits at the repo root (`.claude-plugin/marketplace.json`, `"source": "./plugin"`).
5. **Locating the CLI from another project:** Claude Code prints a skill's base directory when it loads; the skill runs `node "<base directory>/../../bin/circuitoon.mjs"`, with a documented fallback search of `~/.claude/plugins/cache/**/circuitoon/**/bin/circuitoon.mjs`.
6. **Reload behaviour:** there is no autosave today (the PRD's IndexedDB persistence is not built), so reloading `#/editor` shows the start screen, "as today".
7. **App route key:** `App` keys its `ErrorBoundary` on the route (the hash before `?`), not the whole hash, so `#/editor?d=...` becoming `#/editor` (or any later same-route hashchange) never remounts the editor.
8. **Frames keep the PRD format** (`x, y, w, h, label`). Layout computes each frame from its group's bounds; in the editor a frame moves on its own (its parts do not follow).
9. **Repeat:** `repeat` is one object as in the spec. Template nets named like a port are that port's net (they may hold one pin); other template nets need two. Template parts cannot use `on`. Copy ids are `<name>_<k>`, expanded nets `<name>_<k>.<net>`, the default ref pattern `{ref}_{copy}` and a custom `refs` pattern must contain `{ref}` and `{copy}`. Colors in `wires.color` are keyed by expanded net name.
10. **`wires.ends`** is one cable end kind used at both ends of every wire the layout draws.
11. **Distribution (spec 2.2):** pins joined inside one part (`internal`) count as one node whose capacity is the sum of its pins'. Two nodes get one direct wire; more nodes chain through nodes that take two wire ends; otherwise every node is wired (star) to the net's strips: strips named in the net, strips its mounted legs sit in, or a free strip the layout claims. Ground nets claim a `-` rail first, power nets a `+` rail, signal nets column strips only. Each strip keeps one hole in reserve until the net's last pin, so a full strip can still be extended to a claimed strip by a jumper; "strip full" otherwise.
12. **Explicit hole index** in a net endpoint is the preferred hole for that strip's first wire.
13. **`--keep partial.json`:** the partial format is `circuitoon-partial/1` (the site refuses it by its format). Only `intent`, and `designator`, `x`, `y`, `rotation` of parts, are read; its connections are regenerated. A board unit is kept when its board has coordinates (its mounted parts keep theirs while still seated), a repeat block or group when all its parts do, a single part when it does. Nothing is shifted to the sheet origin when anything is kept.
14. **Capacity field:** `capacity` (a whole number 1 to 8) on pins and on header pads (`holeStyle: "pad"`); breadboard holes always take one. No built-in module declares it in this slice (the terminal board's real capacity is unsourced).
15. **Exit codes in detail:** an invalid netlist is exit 2; a netlist that cannot be laid out (no seat, needs a distribution point, strip full, blocked routes) is exit 1. `gate` on a sheet that fails to load is exit 1 (spec 5), on a missing or unreadable file exit 2; blocking findings win over a missing browser (exit 1 before 3).
16. **Focused render:** `--focus <copy id or group name>` renders the full sheet (so routes are identical) with a view box around that copy's or group's parts and the wires touching them.
17. **Verify resolves intent modules** from the sheet's embedded copy first, then the library (so a later library fix does not break an old sheet); ids the intent embeds itself are left to the intent.
18. **Mount conflicts (spec 2.2):** a candidate conflicts when a strip it lands on already holds a leg of a different net or of no net, when two of its own legs on different nets (or no net) share a strip, or when its body and caption overlap another part mounted on that board.
19. **Annotation limits:** label at most 80 characters, text at most 500, coordinates finite within +-100000, frame `w` and `h` above 0; anything else refuses the load (like other structural errors).
20. **Typewriter fixture:** "ESP32 DevKitC on the terminal board or DevKitC" is the DevKitC V4 on its own (the terminal board has no legs to mount); the three MCP23017 are the DIP-28 on three half breadboards (the CJMCU-2317 is pads only and cannot mount); each ball's two switches share one channel (42 channels on 42 inputs: GPA7 and GPB7 are output-only on the MCP23017, so each chip has 14 inputs, not 16), which the skill asks the user to confirm.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/format/diagram.ts` (modify) | `Connection.routing`, `Diagram.intent`, annotation validation and limits |
| `src/format/module.ts` (modify) | `capacity` on pins and pads, `terminalCapacity` |
| `src/format/link.ts` (create) | Link payload encode, decode with limits, open, `payloadFromHash` |
| `src/route.ts` (create) | `routeOf(hash)` |
| `src/agent/order.ts` (create) | `naturalCompare` |
| `src/agent/repeat.ts` (create) | Repeat expansion, binding checks, copy records |
| `src/agent/netlist.ts` (create) | `circuitoon-netlist/1` parser, every contract rule, `Intent` |
| `src/agent/catalog.ts` (create) | `libraryLookup` over the built-in catalog |
| `src/agent/tables.ts` (create) | Bill of quantities, channel allocation table |
| `src/agent/internal.ts` (create) | A pin's internal-join component |
| `src/agent/verify.ts` (create) | Electrical equivalence and capacity findings, `intentLookup` |
| `src/agent/footprint.ts` (create) | Footprints, rect helpers, `RectIndex` |
| `src/agent/mount.ts` (create) | Mount search on a board |
| `src/agent/place.ts` (create) | Placement, frames, notes, keep |
| `src/agent/realize.ts` (create) | Nets to wires: strips, claims, capacity, `routing` |
| `src/agent/readability.ts` (create) | Readability report |
| `src/agent/layout.ts` (create) | `layoutNetlist`: parse, place, realize, route, retry |
| `src/agent/partial.ts` (create) | `circuitoon-partial/1` loader |
| `src/agent/notChecked.ts` (create) | The "not checked" list |
| `src/agent/fixtures.testing.ts` (create) | Netlist fixtures (LED, 5, 30, 120 parts, typewriter-like) |
| `src/render/captionBox.ts` (create) | Caption anchor and box shared by renderer and layout |
| `src/render/annotationGeometry.ts` (create) | Frame tab, note box, note wrapping |
| `src/render/theme.ts` (create) | Sheet themes (site, light, dark) |
| `src/render/Annotations.tsx` (create) | `FrameMark`, `NoteMark` |
| `src/render/exportSvg.tsx` (create) | Standalone SVG, content and focus bounds |
| `src/render/Sheet.tsx`, `Part.tsx` (modify) | Theme, annotations, caption anchor |
| `src/cli/*.ts` (create) | CLI: args, io, commands, png, gate |
| `src/editor/*` (modify) | Link loading, annotation select/move/edit/delete |
| `vite.cli.config.ts`, `scripts/gen-cli.mjs` (create) | CLI bundle build |
| `scripts/lib/browser-check.mjs`, `scripts/check-link-ui.mjs`, `scripts/check-annotations-ui.mjs`, `scripts/check-examples.mjs` (create) | Browser checks |
| `plugin/` (create) | Plugin manifest, `bin/circuitoon.mjs`, `dist-cli/circuitoon.mjs`, `skills/circuitoon-design/` |
| `.claude-plugin/marketplace.json`, `.gitattributes` (create) | Marketplace entry, LF for the bundle |

## Coverage

Implementation and independent tests are listed separately; a test task is never the task that wrote the code unless the column says so.

| Spec section | Implemented in | Independent tests in |
| --- | --- | --- |
| 1 Netlist input contract (endpoints, labels, holes, duplicates, embedded modules, values, `on`, `nc`, groups, notes, intent stored) | Task 3 (parser), Task 7 (intent stored in the sheet) | Task 3 `netlist.test.ts`; Task 4 verify re-parses stored intent; Task 17 worked examples |
| 1.1 Repeat (bindings, shared, refs, collisions, channel table, quantities) | Task 2 (expansion), Task 3 (through parser, tables) | Task 2 `repeat.test.ts`; Task 3 parser repeat cases; Task 11 typewriter (42 copies) |
| 2.1 Placement (deterministic, anchors, net weight, blocks, clearance, retries, `--keep`) | Task 6 (placement), Task 7 (retries), Task 8 (partial) | Task 6 `place.test.ts`; Task 7 determinism; Task 8 `partial.test.ts`; Task 11 fixtures 5/30/120/typewriter |
| 2.2 Mounting, hole allocation, capacity, distribution, routing flags | Task 6 (mount search), Task 7 (realization) | Task 6 mount tests; Task 7 `layout.test.ts`; Task 4 capacity rules on hand-built sheets; Task 11 fixtures |
| 2.3 Readability report and 2 s budget | Task 7 (`readability.ts`) | Task 11 fixtures and `layout.perf.test.ts`; Task 11 visual inspection |
| 3 Verify (inventory, values, mounts, missing, merge, extra, nc, what counts as a connection, capacity on the realized diagram) | Task 4 | Task 4 `verify.test.ts` (every case in spec 10); Task 7 layout outputs verify clean; Task 16 gate |
| 4.1 Distribution (bundle, Node 22, bin, SVG standalone, PNG, browser detection) | Task 9 (bundle, bin), Task 5 (SVG), Task 10 (PNG) | Task 9 `bundle.test.ts`; Task 5 `exportSvg.test.ts`; Task 10 `render.test.ts`; Task 18 `plugin.test.ts` |
| 4.2 Commands, exit codes, JSON schemas | Tasks 9, 10, 12, 13, 16 | `cli.test.ts` per task with schema validation; Task 17 examples end to end |
| 5 Gate (blocking list, warnings, not-checked list, hashes) | Task 16 | Task 16 `gate.test.ts`; Task 17 examples |
| 6 Links (format, limits, cleanup without remount, notice) | Task 13 (codec, command), Task 14 (editor) | Task 13 `link.test.ts`; Task 14 `route.test.ts` and `scripts/check-link-ui.mjs`; Task 17 `scripts/check-examples.mjs` |
| 7 Annotations (Sheet, exports, canvas select/move/delete, Inspector, validation) | Task 1 (validation), Task 5 (Sheet), Task 15 (canvas) | Task 1 `agentFields.test.ts`; Task 5 `exportSvg.test.ts`; Task 15 `annotations.test.ts` and `scripts/check-annotations-ui.mjs` |
| 8 Skill `circuitoon-design` with references and worked examples | Task 17 | Task 17 `examples.test.ts` (each example passes gate), `scripts/check-examples.mjs` (each opens from its link) |
| 9 Plugin packaging | Task 18 (manifests), Task 9 (bin and bundle) | Task 18 `plugin.test.ts` |
| 10 Tests | Every task | This table |

---

### Task 1: Diagram and module fields the toolkit needs

Adds what every later task relies on: `routing` on connections, `intent` on diagrams (kept through load, edit and save), annotation validation with bounded text and finite coordinates, and terminal `capacity` on pins and header pads.

**Files:**
- Modify: `src/format/diagram.ts:34-62` (types), `src/format/diagram.ts:845-902` (connection and annotation validation)
- Modify: `src/format/module.ts:13-67` (types), `src/format/module.ts:168-211` (validation), end of file (`terminalCapacity`)
- Modify: `docs/PRD.md` (Module table row, Diagram format bullets)
- Test: `src/format/agentFields.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Connection.routing?: boolean`, `Diagram.intent?: unknown` (in `src/format/diagram.ts`)
  - `export const ANNOTATION_LABEL_MAX = 80`, `export const ANNOTATION_TEXT_MAX = 500` (diagram.ts)
  - `PinDef.capacity?: number`, `HoleGroup.capacity?: number`, `export const CAPACITY_MAX = 8`, `export function terminalCapacity(m: ModuleDef, name: string): number` (module.ts)

- [ ] **Step 0: Install dependencies once**

```bash
cd C:/Users/micha/Desktop/projects/Circuitoon-toolkit
npm ci
```
Expected: installs without errors; `npm test` passes on the untouched branch.

- [ ] **Step 1: Write the failing test**

Create `src/format/agentFields.test.ts`:

```ts
// The diagram and module fields the agent toolkit adds: `intent` and `routing` survive a load and a
// save, annotations are validated (types, finite coordinates, bounded text), and pins and header
// pads may declare how many wire ends they take.
import { describe, expect, it } from 'vitest'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, serializeDiagram, validateDiagram } from './diagram.ts'
import { terminalCapacity, validateModule } from './module.ts'
import { buttonLed } from '../samples/buttonLed.ts'

type Raw = Record<string, unknown> & { connections: Record<string, unknown>[] }
const base = () => structuredClone(buttonLed) as unknown as Raw

describe('diagram fields for the agent toolkit', () => {
  it('keeps intent and routing flags through a load and a save', () => {
    const d = base()
    d.intent = { format: 'circuitoon-netlist/1', title: 't', parts: [], nets: [] }
    d.connections[0].routing = true
    const r = validateDiagram(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const again = JSON.parse(serializeDiagram(r.diagram))
    expect(again.intent).toEqual(d.intent)
    expect(again.connections[0].routing).toBe(true)
  })
  it('refuses a routing flag that is not a boolean and an intent that is not an object', () => {
    const d = base()
    d.intent = 'netlist'
    d.connections[0].routing = 'yes'
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'connections[0].routing: must be true or false',
        'intent: must be an object (a circuitoon-netlist/1 document)',
      ])
  })
  it('accepts frames and text notes with finite coordinates and bounded text', () => {
    const d = base()
    d.annotations = [
      { uid: 'a1', type: 'frame', x: 0, y: 0, w: 200, h: 100, label: 'Power' },
      { uid: 'a2', type: 'text', x: 10, y: 120, text: 'Tilt switches go in the balls.' },
    ]
    expect(validateDiagram(d).ok).toBe(true)
  })
  it('refuses unknown types, bad coordinates, empty frames, overlong text and a note without text', () => {
    const d = base()
    d.annotations = [
      { uid: 'a1', type: 'arrow', x: 0, y: 0 },
      { uid: 'a2', type: 'frame', x: Infinity, y: 0, w: 0, h: 10 },
      { uid: 'a3', type: 'text', x: 0, y: 1e9, text: 'x'.repeat(ANNOTATION_TEXT_MAX + 1) },
      { uid: 'a4', type: 'frame', x: 0, y: 0, w: 10, h: 10, label: 'y'.repeat(ANNOTATION_LABEL_MAX + 1) },
      { uid: 'a5', type: 'text', x: 0, y: 0 },
    ]
    const r = validateDiagram(d)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'annotations[0].type: must be "frame" or "text"',
        'annotations[1]: x and y must be numbers within +-100000',
        'annotations[1].w: must be a number above 0, at most 200000',
        'annotations[2]: x and y must be numbers within +-100000',
        `annotations[2].text: at most ${ANNOTATION_TEXT_MAX} characters`,
        `annotations[3].label: at most ${ANNOTATION_LABEL_MAX} characters`,
        'annotations[4].text: required on a text note',
      ])
  })
})

describe('terminal capacity', () => {
  const mod = (extra: Record<string, unknown> = {}) => ({ format: 'circuitoon-module/1', id: 'blk', name: 'Block', pins: [{ name: 'A', side: 'left' }], ...extra })
  it('defaults every pin and pad to one wire end', () => {
    const r = validateModule(mod({ holes: [{ name: 'P', at: [[10, 10]], holeStyle: 'pad' }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(terminalCapacity(r.module, 'A')).toBe(1)
    expect(terminalCapacity(r.module, 'P')).toBe(1)
  })
  it('takes a declared capacity on a pin and on a header pad', () => {
    const r = validateModule(mod({ pins: [{ name: 'A', side: 'left', capacity: 2 }], holes: [{ name: 'P', at: [[10, 10]], holeStyle: 'pad', capacity: 3 }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(terminalCapacity(r.module, 'A')).toBe(2)
    expect(terminalCapacity(r.module, 'P')).toBe(3)
  })
  it('refuses a capacity outside 1 to 8, and one on a breadboard hole group', () => {
    const r = validateModule(mod({ pins: [{ name: 'A', side: 'left', capacity: 0 }], holes: [{ name: 'S', at: [[10, 10]], capacity: 2 }] }))
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors).toEqual([
        'pins[0].capacity: must be a whole number from 1 to 8',
        'holes[0].capacity: only pins and header pads (holeStyle "pad") take a capacity',
      ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/format/agentFields.test.ts`
Expected: FAIL: `ANNOTATION_LABEL_MAX` and `terminalCapacity` are not exported.

- [ ] **Step 3: Add the diagram fields**

In `src/format/diagram.ts`, extend `Connection` (after `ends?: WireEnds`):

```ts
  /**
   * True on a wire the layout added to realize a connection (a wire into a strip hole, a jumper
   * between strips, a rail wire): routing infrastructure, which verification never counts as an
   * intended component connection.
   */
  routing?: boolean
```

Extend `Diagram` (after `annotations?: Annotation[]`):

```ts
  /**
   * The netlist (circuitoon-netlist/1) the sheet was laid out from. Kept through every edit, so a
   * later check re-verifies the circuit against it. Loaded as opaque data; `verify` parses it.
   */
  intent?: unknown
```

Below `ROUTE_POINT_LIMIT` add:

```ts
/** Longest frame label and note text, in characters. */
export const ANNOTATION_LABEL_MAX = 80
export const ANNOTATION_TEXT_MAX = 500
```

In `validateDiagram`, inside the connections loop, after the `c.label` check add:

```ts
      if (c.routing !== undefined && typeof c.routing !== 'boolean') errors.push(`${at}.routing: must be true or false`)
```

Replace the whole `if (raw.annotations !== undefined) { ... }` block with:

```ts
  if (raw.annotations !== undefined) {
    if (!Array.isArray(raw.annotations)) errors.push('annotations: must be a list')
    else
      raw.annotations.forEach((a, i) => {
        const at = `annotations[${i}]`
        if (!isObj(a)) return void errors.push(`${at}: must be an object`)
        claim(a.uid, at)
        if (a.type !== 'frame' && a.type !== 'text') errors.push(`${at}.type: must be "frame" or "text"`)
        const coord = (v: unknown) => isNum(v) && Math.abs(v) <= COORD_LIMIT
        if (!coord(a.x) || !coord(a.y)) errors.push(`${at}: x and y must be numbers within +-${COORD_LIMIT}`)
        if (a.type === 'frame')
          for (const k of ['w', 'h'])
            if (!(isNum(a[k]) && (a[k] as number) > 0 && (a[k] as number) <= 2 * COORD_LIMIT))
              errors.push(`${at}.${k}: must be a number above 0, at most ${2 * COORD_LIMIT}`)
        for (const [k, max] of [['label', ANNOTATION_LABEL_MAX], ['text', ANNOTATION_TEXT_MAX]] as const) {
          if (a[k] === undefined) continue
          if (typeof a[k] !== 'string') errors.push(`${at}.${k}: must be a string`)
          else if ((a[k] as string).length > max) errors.push(`${at}.${k}: at most ${max} characters`)
        }
        if (a.type === 'text' && a.text === undefined) errors.push(`${at}.text: required on a text note`)
      })
  }

  if (raw.intent !== undefined && !isObj(raw.intent)) errors.push('intent: must be an object (a circuitoon-netlist/1 document)')
```

(The existing `refuses non-string wire labels and annotation text` test in `diagramIO.test.ts` keeps passing: its note has `type: 'text'`, finite coordinates and a `text` key.)

- [ ] **Step 4: Add terminal capacity to modules**

In `src/format/module.ts`, add to `PinDef` and to `HoleGroup`:

```ts
  /** How many wire ends the pin or pad takes (a Dupont socket or a solder joint takes one; a screw terminal may take two). Default 1. */
  capacity?: number
```

Below `LEAD` add:

```ts
/** Most wire ends a pin or pad may declare it takes. */
export const CAPACITY_MAX = 8
```

In the pins loop of `validateModule`, after `checkSupply(p, at)`:

```ts
      if (p.capacity !== undefined && !(Number.isInteger(p.capacity) && (p.capacity as number) >= 1 && (p.capacity as number) <= CAPACITY_MAX))
        errors.push(`${at}.capacity: must be a whole number from 1 to ${CAPACITY_MAX}`)
```

In the holes loop, after `checkSupply(g, at)`:

```ts
        if (g.capacity !== undefined) {
          if (g.holeStyle !== 'pad') errors.push(`${at}.capacity: only pins and header pads (holeStyle "pad") take a capacity`)
          else if (!(Number.isInteger(g.capacity) && (g.capacity as number) >= 1 && (g.capacity as number) <= CAPACITY_MAX))
            errors.push(`${at}.capacity: must be a whole number from 1 to ${CAPACITY_MAX}`)
        }
```

At the end of the file:

```ts
/**
 * How many wire ends a pin or header pad takes: its `capacity`, default 1. A breadboard hole always
 * takes one (a hole holds one leg or one wire end), whatever its group says.
 */
export function terminalCapacity(m: ModuleDef, name: string): number {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  if (pin) return pin.capacity ?? 1
  const g = m.holes?.find((h) => h.name === name)
  return g?.holeStyle === 'pad' ? (g.capacity ?? 1) : 1
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/format/agentFields.test.ts src/format/diagramIO.test.ts src/format/module.test.ts`
Expected: PASS.

- [ ] **Step 6: Document the fields in the PRD**

In `docs/PRD.md`, Module definition table, add after the pin `bus` row:

```markdown
| pin or pad `capacity` | no | How many wire ends the pin or header pad takes, a whole number from 1 to 8, default 1 (a Dupont socket or solder joint takes one; a screw terminal may take two). Breadboard holes always take one wire end or one leg. The agent toolkit's layout and verification enforce it. |
```

In the Diagram format bullets, after the **`route`** bullet, add:

```markdown
- **`routing`** (optional, `true`) marks a wire the agent toolkit's layout added to realize a connection (a wire into a strip hole, a jumper between strips, a rail wire). Verification treats such wires, like strips and rails, as infrastructure.
- **`intent`** (optional) is the `circuitoon-netlist/1` document the sheet was laid out from. It is kept through every edit and export, so `circuitoon verify` can re-check the sheet against it later.
- **Annotations.** A `frame` has `x`, `y`, `w`, `h` (w and h above 0) and an optional `label` of at most 80 characters; a `text` note has `x`, `y` and a `text` of at most 500 characters. Coordinates are finite numbers within +-100000. Anything else refuses the load with the path.
```

- [ ] **Step 7: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/format/diagram.ts src/format/module.ts src/format/agentFields.test.ts docs/PRD.md
git commit -m "Toolkit fields: routing flag, intent, annotation validation, terminal capacity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Repeated sub-circuits (expansion and bindings)

Expands `repeat` into plain parts and nets, checks every copy binds every non-shared port exactly once and that no outside endpoint is bound twice, joins shared ports to their outside net, and renames refs.

**Files:**
- Create: `src/agent/repeat.ts`
- Test: `src/agent/repeat.test.ts`

**Interfaces:**
- Consumes: `isObj` from `src/format/module.ts`.
- Produces (`src/agent/repeat.ts`):
  - `interface RawPin { ep: unknown; at: string }`, `interface RawPart { p: unknown; at: string }`, `interface RawNet { name: unknown; pins: RawPin[]; at: string }`
  - `interface RepeatCopy { id: string; repeat: string; index: number; refs: string[]; bindings: Record<string, string> }`
  - `interface RepeatExpansion { parts: RawPart[]; nets: RawNet[]; shared: Map<string, RawPin[]>; copies: RepeatCopy[]; errors: string[] }`
  - `const REPEAT_MAX = 500`
  - `function endpointText(ep: unknown): string | null`
  - `function expandRepeat(raw: unknown, topRefs: Set<string>, topNets: string[]): RepeatExpansion`

- [ ] **Step 1: Write the failing test**

Create `src/agent/repeat.test.ts`:

```ts
// Repeat expansion: refs, bindings, shared ports and every binding rule of spec 1.1.
import { describe, expect, it } from 'vitest'
import { endpointText, expandRepeat } from './repeat.ts'

const ball = (bindings: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'ball',
  count: bindings.length,
  template: {
    parts: [{ ref: 'SA', module: 'tilt-switch-sw520d' }, { ref: 'SB', module: 'tilt-switch-sw520d' }],
    nets: [{ name: 'CH', pins: ['SA.1', 'SB.1'] }, { name: 'GND', pins: ['SA.2', 'SB.2'] }],
    ports: ['CH', 'GND'],
  },
  bindings,
  shared: { GND: 'GND' },
  ...extra,
})

describe('expandRepeat', () => {
  it('expands every copy as <ref>_<copy>, binds its channel and joins the shared GND to the outside net', () => {
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }, { CH: { ref: 'U2', pin: 'GPA1' } }]), new Set(['U2']), ['GND'])
    expect(r.errors).toEqual([])
    expect(r.parts.map((p) => (p.p as { ref: string }).ref)).toEqual(['SA_1', 'SB_1', 'SA_2', 'SB_2'])
    expect(r.nets.map((n) => [n.name, n.pins.map((p) => p.ep)])).toEqual([
      ['ball_1.CH', ['SA_1.1', 'SB_1.1', 'U2.GPA0']],
      ['ball_2.CH', ['SA_2.1', 'SB_2.1', { ref: 'U2', pin: 'GPA1' }]],
    ])
    expect(r.shared.get('GND')!.map((p) => p.ep)).toEqual(['SA_1.2', 'SB_1.2', 'SA_2.2', 'SB_2.2'])
    expect(r.copies).toEqual([
      { id: 'ball_1', repeat: 'ball', index: 1, refs: ['SA_1', 'SB_1'], bindings: { CH: 'U2.GPA0' } },
      { id: 'ball_2', repeat: 'ball', index: 2, refs: ['SA_2', 'SB_2'], bindings: { CH: 'U2.GPA1' } },
    ])
  })
  it('rejects a channel bound by two copies', () => {
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }, { CH: 'U2.GPA0' }]), new Set(['U2']), ['GND'])
    expect(r.errors).toEqual(['repeat.bindings[1].CH: U2.GPA0 is already bound by copy 1 port CH'])
  })
  it('rejects a copy that leaves a port unbound, or binds a shared or unknown port', () => {
    const r = expandRepeat(ball([{}, { CH: 'U2.GPA1', GND: 'U1.GND', X: 'U1.IO4' }]), new Set(['U1', 'U2']), ['GND'])
    expect(r.errors).toEqual([
      'repeat.bindings[0]: port CH is not bound',
      'repeat.bindings[1].GND: not a port that takes a binding (CH)',
      'repeat.bindings[1].X: not a port that takes a binding (CH)',
    ])
  })
  it('rejects an expanded ref that collides with another part, and honours a refs pattern', () => {
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }]), new Set(['U2', 'SA_1']), ['GND']).errors).toEqual([
      'repeat.template.parts[0].ref: copy 1 ref "SA_1" collides with another part',
    ])
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }], { refs: 'B{copy}{ref}' }), new Set(['U2']), ['GND'])
    expect(r.copies[0].refs).toEqual(['B1SA', 'B1SB'])
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }], { refs: 'B{ref}' }), new Set(), ['GND']).errors).toEqual([
      'repeat.refs: must contain {ref} and {copy}, for example "{ref}_{copy}"',
    ])
  })
  it('rejects a binding list of the wrong length, a shared port to an unknown net and a mounted template part', () => {
    expect(expandRepeat({ ...ball([{ CH: 'U2.GPA0' }]), count: 2 }, new Set(), ['GND']).errors).toEqual([
      'repeat.bindings: must list 2 entries, one per copy',
    ])
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }]), new Set(), []).errors).toEqual(['repeat.shared.GND: no outside net "GND"'])
    const mounted = ball([{ CH: 'U2.GPA0' }])
    mounted.template.parts[0] = { ...mounted.template.parts[0], on: 'BB1' } as { ref: string; module: string }
    expect(expandRepeat(mounted, new Set(), ['GND']).errors).toEqual(['repeat.template.parts[0].on: a repeated part cannot be mounted'])
  })
  it('names endpoints the way the channel table shows them', () => {
    expect(endpointText('U2.GPA0')).toBe('U2.GPA0')
    expect(endpointText({ ref: 'U2', pin: 'GPA0' })).toBe('U2.GPA0')
    expect(endpointText({ ref: 'BB1', group: 'c5-top', hole: 2 })).toBe('BB1.c5-top hole 2')
    expect(endpointText(5)).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/repeat.test.ts`
Expected: FAIL: cannot resolve `./repeat.ts`.

- [ ] **Step 3: Implement**

Create `src/agent/repeat.ts`:

```ts
// Repeated sub-circuits (agent toolkit spec 1.1): `count` copies of a template, each copy's
// non-shared ports bound to its own outside endpoint and its shared ports joined to one outside
// net. Expands to plain parts and nets for the netlist parser, so every netlist rule also holds for
// every copy; this file checks only what is particular to repeats (bindings, refs). Pure.
import { isObj } from '../format/module.ts'

export interface RawPin {
  ep: unknown
  /** Where the endpoint came from, for error messages. */
  at: string
}
export interface RawPart {
  p: unknown
  at: string
}
export interface RawNet {
  name: unknown
  pins: RawPin[]
  at: string
}
export interface RepeatCopy {
  /** `<repeat name>_<copy>`: what `render --focus` and the channel table call the copy. */
  id: string
  repeat: string
  index: number
  refs: string[]
  /** Port to the outside endpoint it is bound to, as text ("U2.GPA0"). */
  bindings: Record<string, string>
}
export interface RepeatExpansion {
  parts: RawPart[]
  /** One net per copy per template net that is not a shared port. */
  nets: RawNet[]
  /** Outside net name to the copy pins joined to it through shared ports. */
  shared: Map<string, RawPin[]>
  copies: RepeatCopy[]
  errors: string[]
}

export const REPEAT_MAX = 500
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

/** An endpoint as text, for binding reuse checks and the channel table: "U2.GPA0", "BB1.c5-top hole 2". */
export function endpointText(ep: unknown): string | null {
  if (typeof ep === 'string') return ep
  if (!isObj(ep) || typeof ep.ref !== 'string') return null
  if (typeof ep.pin === 'string') return `${ep.ref}.${ep.pin}`
  if (typeof ep.group === 'string') return `${ep.ref}.${ep.group}${ep.hole !== undefined ? ` hole ${String(ep.hole)}` : ''}`
  return null
}

/** A template endpoint with its ref renamed for one copy ("SA.1" in copy 3 is "SA_3.1"). */
function renameEndpoint(ep: unknown, rename: (ref: string) => string): unknown {
  if (typeof ep === 'string') {
    const dot = ep.indexOf('.')
    return dot < 1 ? ep : `${rename(ep.slice(0, dot))}${ep.slice(dot)}`
  }
  if (isObj(ep) && typeof ep.ref === 'string') return { ...ep, ref: rename(ep.ref) }
  return ep
}

export function expandRepeat(raw: unknown, topRefs: Set<string>, topNets: string[]): RepeatExpansion {
  const out: RepeatExpansion = { parts: [], nets: [], shared: new Map(), copies: [], errors: [] }
  const fail = (e: string) => {
    out.errors.push(e)
    return out
  }
  if (!isObj(raw)) return fail('repeat: must be { "name", "count", "template", "bindings", "shared" }')
  const { name, count, template, bindings } = raw
  if (typeof name !== 'string' || !NAME.test(name)) return fail('repeat.name: required, a letter then letters, digits or _')
  if (!(Number.isInteger(count) && (count as number) >= 1 && (count as number) <= REPEAT_MAX))
    return fail(`repeat.count: must be a whole number from 1 to ${REPEAT_MAX}`)
  const n = count as number
  if (!isObj(template) || !Array.isArray(template.parts) || !Array.isArray(template.nets) || !Array.isArray(template.ports))
    return fail('repeat.template: must be { "parts", "nets", "ports" }')
  const shared = raw.shared ?? {}
  if (!isObj(shared)) return fail('repeat.shared: must map a port to an outside net name')
  const tParts = template.parts
  const tNets = template.nets
  const tRefs = tParts.flatMap((p) => (isObj(p) && typeof p.ref === 'string' ? [p.ref] : []))
  const netNames = tNets.flatMap((x) => (isObj(x) && typeof x.name === 'string' ? [x.name] : []))
  const ports = template.ports.filter((p): p is string => typeof p === 'string')
  template.ports.forEach((p, i) => {
    if (typeof p !== 'string' || !netNames.includes(p)) out.errors.push(`repeat.template.ports[${i}]: must name a template net`)
  })
  for (const [port, net] of Object.entries(shared)) {
    if (!ports.includes(port)) out.errors.push(`repeat.shared.${port}: not a template port`)
    else if (typeof net !== 'string' || !topNets.includes(net)) out.errors.push(`repeat.shared.${port}: no outside net "${String(net)}"`)
  }
  const bound = ports.filter((p) => !Object.hasOwn(shared, p))
  if (!Array.isArray(bindings) || bindings.length !== n) return fail(`repeat.bindings: must list ${n} entries, one per copy`)
  const pattern = raw.refs ?? '{ref}_{copy}'
  if (typeof pattern !== 'string' || !pattern.includes('{ref}') || !pattern.includes('{copy}'))
    return fail('repeat.refs: must contain {ref} and {copy}, for example "{ref}_{copy}"')

  const seenRefs = new Set(topRefs)
  const boundBy = new Map<string, string>()
  for (let k = 1; k <= n; k++) {
    const rename = (ref: string) => pattern.replaceAll('{ref}', ref).replaceAll('{copy}', String(k))
    const refs: string[] = []
    tParts.forEach((p, i) => {
      const at = `repeat.template.parts[${i}]`
      if (!isObj(p) || typeof p.ref !== 'string') {
        if (k === 1) out.errors.push(`${at}.ref: required`)
        return
      }
      if (p.on !== undefined) {
        if (k === 1) out.errors.push(`${at}.on: a repeated part cannot be mounted`)
        return
      }
      const ref = rename(p.ref)
      if (seenRefs.has(ref)) return void out.errors.push(`${at}.ref: copy ${k} ref "${ref}" collides with another part`)
      seenRefs.add(ref)
      refs.push(ref)
      out.parts.push({ p: { ...p, ref }, at: `${at} (copy ${k})` })
    })

    const entry = bindings[k - 1]
    const at = `repeat.bindings[${k - 1}]`
    const chosen: Record<string, string> = {}
    if (!isObj(entry)) out.errors.push(`${at}: must map every port except shared ones (${bound.join(', ')}) to an outside pin`)
    else {
      for (const port of bound) {
        if (!Object.hasOwn(entry, port)) {
          out.errors.push(`${at}: port ${port} is not bound`)
          continue
        }
        const text = endpointText(entry[port])
        if (text === null) {
          out.errors.push(`${at}.${port}: must be "REF.PIN" or { "ref", "pin" }`)
          continue
        }
        const prior = boundBy.get(text)
        if (prior) {
          out.errors.push(`${at}.${port}: ${text} is already bound by ${prior}`)
          continue
        }
        boundBy.set(text, `copy ${k} port ${port}`)
        chosen[port] = text
      }
      for (const key of Object.keys(entry)) if (!bound.includes(key)) out.errors.push(`${at}.${key}: not a port that takes a binding (${bound.join(', ')})`)
    }

    tNets.forEach((net, i) => {
      const nat = `repeat.template.nets[${i}]`
      if (!isObj(net) || typeof net.name !== 'string' || !Array.isArray(net.pins)) {
        if (k === 1) out.errors.push(`${nat}: must be { "name", "pins": [...] }`)
        return
      }
      const pins: RawPin[] = net.pins.map((ep, j) => ({ ep: renameEndpoint(ep, (r) => (tRefs.includes(r) ? rename(r) : r)), at: `${nat}.pins[${j}] (copy ${k})` }))
      const port = ports.includes(net.name) ? net.name : null
      if (port !== null && Object.hasOwn(shared, port)) {
        const target = shared[port] as string
        out.shared.set(target, [...(out.shared.get(target) ?? []), ...pins])
        return
      }
      if (port !== null && isObj(entry) && Object.hasOwn(entry, port)) pins.push({ ep: entry[port], at: `${at}.${port}` })
      out.nets.push({ name: `${name}_${k}.${net.name}`, pins, at: `${nat} (copy ${k})` })
    })
    out.copies.push({ id: `${name}_${k}`, repeat: name, index: k, refs, bindings: chosen })
  }
  return out
}
```

Note on the error order the test pins: for one copy the missing-port errors come first, then the unknown keys (`bindings[0]` has only a missing port; `bindings[1]` only unknown keys).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/agent/repeat.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/repeat.ts src/agent/repeat.test.ts
git commit -m "Agent toolkit: repeated sub-circuits with explicit bindings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Netlist parser (`circuitoon-netlist/1`)

Parses and checks an agent's netlist against every contract rule of spec section 1 (repeats included through Task 2), resolving each endpoint to a canonical pin or hole group. Adds the library lookup, natural ordering, and the bill of quantities and channel allocation table the CLI prints.

**Files:**
- Create: `src/agent/order.ts`, `src/agent/catalog.ts`, `src/agent/netlist.ts`, `src/agent/tables.ts`
- Test: `src/agent/netlist.test.ts`, `src/agent/tables.test.ts`

**Interfaces:**
- Consumes: `expandRepeat`, `RawNet`, `RawPart`, `RepeatCopy` (Task 2); `validateModule`, `isBoard`, `isObj`, `isNum`, `isSpacer`, `PARAM_RULES`, `validParamValue`, `ModuleDef`, `PinDef` (module.ts); `isValidColor`, `ANNOTATION_LABEL_MAX`, `ANNOTATION_TEXT_MAX` (diagram.ts); `isEndKind`, `EndKind` (cables.ts); `modulesById` (library.ts).
- Produces:
  - `src/agent/order.ts`: `naturalCompare(a: string, b: string): number`
  - `src/agent/netlist.ts`: `NETLIST_FORMAT`, `REF_PATTERN`, `type ModuleLookup = (id: string) => ModuleDef | undefined`, `interface Terminal { ref: string; name: string; infra: boolean; hole?: number }`, `interface IntentPart { ref; module; values?; on? }`, `interface IntentNet { name: string; terminals: Terminal[]; color?: string }`, `interface Intent { title; parts; nets; nc: Terminal[]; groups: { name: string; refs: string[] }[]; notes: { text: string; near: string }[]; copies: RepeatCopy[]; modules: Record<string, ModuleDef>; custom: string[]; ends?: EndKind }`, `type IntentResult`, `terminalKey(ref, name): string`, `terminalName(t: Terminal): string`, `parseNetlist(raw: unknown, library: ModuleLookup): IntentResult`
  - `src/agent/catalog.ts`: `libraryLookup: ModuleLookup`
  - `src/agent/tables.ts`: `interface QuantityRow { module: string; name: string; count: number; custom: boolean }`, `interface ChannelRow { copy: string; port: string; endpoint: string }`, `quantities(intent): QuantityRow[]`, `channelTable(intent): ChannelRow[]`, `quantitiesText(rows): string`, `channelsText(rows): string`

- [ ] **Step 1: Write the failing parser tests**

Create `src/agent/netlist.test.ts`:

```ts
// The netlist input contract (spec 1): endpoints, labels, holes, duplicates, embedded modules,
// values, mounts, nc, groups, notes and repeats, each rule with its exact error.
import { describe, expect, it } from 'vitest'
import { parseNetlist, type Intent } from './netlist.ts'
import { libraryLookup } from './catalog.ts'

const led = () => ({
  format: 'circuitoon-netlist/1',
  title: 'LED on a breadboard',
  parts: [
    { ref: 'BB1', module: 'breadboard-half' },
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
    { ref: 'D1', module: 'led', on: 'BB1' },
  ] as Record<string, unknown>[],
  nets: [
    { name: 'VCC', pins: [{ ref: 'BT1', pin: '+' }, { ref: 'R1', pin: '1' }] },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'] },
  ] as { name: string; pins: unknown[] }[],
  wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
})
const parse = (raw: unknown) => parseNetlist(raw, libraryLookup)
const ok = (raw: unknown): Intent => {
  const r = parse(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.intent
}
const errors = (raw: unknown) => {
  const r = parse(raw)
  return r.ok ? [] : r.errors
}

describe('parseNetlist', () => {
  it('parses the spec example: object and string endpoints, colors, ends and the modules used', () => {
    const i = ok(led())
    expect(i.nets.map((n) => [n.name, n.terminals, n.color])).toEqual([
      ['VCC', [{ ref: 'BT1', name: '+', infra: false }, { ref: 'R1', name: '1', infra: false }], 'red'],
      ['LED_A', [{ ref: 'R1', name: '2', infra: false }, { ref: 'D1', name: 'A', infra: false }], undefined],
      ['GND', [{ ref: 'D1', name: 'K', infra: false }, { ref: 'BT1', name: '-', infra: false }], 'black'],
    ])
    expect(i.ends).toBe('dupont-male')
    expect(Object.keys(i.modules)).toEqual(['battery-holder-2xaa', 'breadboard-half', 'led', 'resistor'])
    expect(i.parts.find((p) => p.ref === 'R1')).toEqual({ ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' })
  })
  it('matches an exact pin name before a label, and a label only when one pin has it', () => {
    const n = led()
    n.parts.push({ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'DS1', module: 'lcd-st7796s-4in-spi-touch' })
    n.nets.push({ name: 'MOSI', pins: ['U1.IO23', 'DS1.MOSI'] }, { name: 'G', pins: ['U1.GND', 'DS1.GND'] })
    const i = ok(n)
    expect(i.nets.find((x) => x.name === 'MOSI')!.terminals[1]).toEqual({ ref: 'DS1', name: 'SDI', infra: false })
    expect(i.nets.find((x) => x.name === 'G')!.terminals[0]).toEqual({ ref: 'U1', name: 'GND', infra: false })
  })
  it('rejects a label shared by several pins, naming them', () => {
    const n = led()
    n.parts.push({ ref: 'U9', module: 'twin' })
    ;(n as Record<string, unknown>).modules = {
      twin: { format: 'circuitoon-module/1', id: 'twin', name: 'Twin', pins: [{ name: 'G1', label: 'GND', side: 'left' }, { name: 'G2', label: 'GND', side: 'left' }] },
    }
    n.nets.push({ name: 'X', pins: ['U9.GND', 'BT1.-'] })
    expect(errors(n)).toContain('nets[3].pins[0]: "GND" is the label of 2 pins on U9 (G1, G2); name one of them')
  })
  it('resolves hole groups: an index, an omitted index, the string form, and an index out of range', () => {
    const n = led()
    n.nets.push({ name: 'S', pins: [{ ref: 'BB1', group: 'c20-top', hole: 2 }, 'BB1.c21-top'] })
    expect(ok(n).nets[3].terminals).toEqual([
      { ref: 'BB1', name: 'c20-top', infra: true, hole: 2 },
      { ref: 'BB1', name: 'c21-top', infra: true },
    ])
    n.nets[3].pins[0] = { ref: 'BB1', group: 'c20-top', hole: 5 }
    expect(errors(n)).toEqual(['nets[3].pins[0].hole: BB1 c20-top has holes 0 to 4', 'nets[3].pins: a net joins at least 2 pins'])
  })
  it('rejects duplicate refs, duplicate net names and an endpoint in two nets', () => {
    const n = led()
    n.parts.push({ ref: 'R1', module: 'resistor' })
    n.nets.push({ name: 'GND', pins: ['R1.1', 'D1.A'] })
    expect(errors(n)).toEqual([
      'parts[4].ref: duplicate "R1"',
      'nets[3].name: duplicate net "GND"',
    ])
    const m = led()
    m.nets.push({ name: 'X', pins: ['R1.1', 'D1.K'] })
    expect(errors(m)).toEqual([
      'nets[3].pins[0]: R1 1 is already in net "VCC"',
      'nets[3].pins[1]: D1 K is already in net "GND"',
      'nets[3].pins: a net joins at least 2 pins',
    ])
  })
  it('rejects an embedded module that reuses a built-in id, a bad ref and an unknown module', () => {
    const n = led() as Record<string, unknown> & ReturnType<typeof led>
    n.modules = { resistor: { format: 'circuitoon-module/1', id: 'resistor', name: 'Mine', pins: [{ name: 'A', side: 'left' }] } }
    n.parts.push({ ref: '1R', module: 'resistor' }, { ref: 'X1', module: 'no-such-part' })
    expect(errors(n)).toEqual([
      'modules.resistor: "resistor" is a built-in part; give the embedded module its own id',
      'parts[4].ref: required, a letter then letters, digits or _ (for example "R1")',
      'parts[5].module: no built-in or embedded module "no-such-part"',
    ])
  })
  it('rejects a bad value, a mount on a part that is not a board, and nc on a pin that is in a net', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.parts[2] = { ...n.parts[2], values: { resistance: { value: 220, unit: 'F' } }, on: 'BT1' }
    n.nc = ['D1.K', 'BB1.c30-top']
    expect(errors(n)).toEqual([
      'parts[2].values.resistance: must be { "value": <number>, "unit": "ohm" } within 0, or from 1e-15 to 1e12',
      'parts[2].on: BT1 (battery-holder-2xaa) is not a breadboard or rail strip',
      'nc[0]: D1 K is in net "GND", so it cannot be not connected',
      'nc[1]: BB1 c30-top is a breadboard hole group, not a pin',
    ])
  })
  it('rejects a part in two groups, a note near nothing and a string endpoint without a dot', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.groups = [{ name: 'Power', parts: ['BT1'] }, { name: 'Again', parts: ['BT1'] }]
    n.notes = [{ text: 'Hello', near: 'Nowhere' }]
    n.nets.push({ name: 'Z', pins: ['R1', 'D1.A'] })
    expect(errors(n)).toEqual([
      'nets[3].pins[0]: "R1" must be "REF.PIN"',
      'nets[3].pins[1]: D1 A is already in net "LED_A"',
      'nets[3].pins: a net joins at least 2 pins',
      'groups[1].parts[0]: BT1 is already in group "Power"',
      'notes[0].near: must name a part ref or a group',
    ])
  })
  it('expands a repeat: shared GND joins the outside net, a reused channel is rejected, refs collide', () => {
    const n = led() as ReturnType<typeof led> & Record<string, unknown>
    n.parts.push({ ref: 'U1', module: 'esp32-devkitc-v4' })
    n.nets[2].pins.push('U1.GND')
    const repeat = (bindings: unknown[]) => ({
      name: 'sw', count: bindings.length,
      template: { parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }], nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }], ports: ['SIG', 'GND'] },
      bindings, shared: { GND: 'GND' },
    })
    n.repeat = repeat([{ SIG: 'U1.IO4' }, { SIG: 'U1.IO5' }])
    const i = ok(n)
    expect(i.nets.find((x) => x.name === 'GND')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['D1.K', 'BT1.-', 'U1.GND', 'S_1.2', 'S_2.2'])
    expect(i.nets.find((x) => x.name === 'sw_2.SIG')!.terminals.map((t) => `${t.ref}.${t.name}`)).toEqual(['S_2.1', 'U1.IO5'])
    expect(i.copies.map((c) => c.id)).toEqual(['sw_1', 'sw_2'])
    n.repeat = repeat([{ SIG: 'U1.IO4' }, { SIG: 'U1.IO4' }])
    expect(errors(n)).toContain('repeat.bindings[1].SIG: U1.IO4 is already bound by copy 1 port SIG')
    n.repeat = repeat([{ SIG: 'D1.A' }, { SIG: 'U1.IO5' }])
    expect(errors(n)).toContain('repeat.bindings[0].SIG: D1 A is already in net "LED_A"')
  })
})
```

Create `src/agent/tables.test.ts`:

```ts
// The bill of quantities and the channel allocation table the CLI prints for a netlist.
import { describe, expect, it } from 'vitest'
import { parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { channelTable, channelsText, quantities, quantitiesText } from './tables.ts'

const raw = {
  format: 'circuitoon-netlist/1', title: 'Two switches',
  parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }],
  nets: [{ name: 'GND', pins: ['U1.GND', 'U1.GND 2'] }],
  repeat: {
    name: 'sw', count: 2,
    template: { parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }], nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }], ports: ['SIG', 'GND'] },
    bindings: [{ SIG: 'U1.IO4' }, { SIG: 'U1.IO5' }], shared: { GND: 'GND' },
  },
}

describe('tables', () => {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  it('counts parts per module', () => {
    expect(quantities(r.intent).map((q) => [q.module, q.count, q.custom])).toEqual([
      ['esp32-devkitc-v4', 1, false],
      ['tilt-switch-sw520d', 2, false],
    ])
    expect(quantitiesText(quantities(r.intent))).toContain('2 x ')
  })
  it('lists each copy port and the endpoint it is bound to', () => {
    expect(channelTable(r.intent)).toEqual([
      { copy: 'sw_1', port: 'SIG', endpoint: 'U1.IO4' },
      { copy: 'sw_2', port: 'SIG', endpoint: 'U1.IO5' },
    ])
    expect(channelsText(channelTable(r.intent)).split('\n')[0]).toMatch(/^copy\s+port\s+bound to$/)
  })
})
```

(The ESP32 DevKitC's name sorts before the tilt switch's; if a future rename changes that, sort the expectation by name, not the code.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent/netlist.test.ts src/agent/tables.test.ts`
Expected: FAIL: cannot resolve `./netlist.ts`.

- [ ] **Step 3: Implement ordering and the catalog lookup**

Create `src/agent/order.ts`:

```ts
// The one tie-break every toolkit step uses: natural order ("R2" before "R10"), then plain code
// point order so two different strings never compare equal.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}
```

Create `src/agent/catalog.ts`:

```ts
// The built-in parts as a lookup, for the netlist parser, layout and verification. The catalog is
// src/library.ts (import.meta.glob over modules/), which Vite resolves at build time for the site
// and for the CLI bundle alike.
import { modulesById } from '../library.ts'
import type { ModuleLookup } from './netlist.ts'

export const libraryLookup: ModuleLookup = (id) => (Object.hasOwn(modulesById, id) ? modulesById[id] : undefined)
```

- [ ] **Step 4: Implement the parser**

Create `src/agent/netlist.ts`:

```ts
// Netlist-first input (circuitoon-netlist/1, agent toolkit spec section 1): what an agent writes to
// describe a circuit, checked against every contract rule. Nothing is guessed: each violation is an
// error naming its path. Repeated sub-circuits are expanded first (repeat.ts), so every rule here
// also holds for every copy. Pure.
import { type ModuleDef, type PinDef, PARAM_RULES, isBoard, isObj, isNum, isSpacer, validParamValue, validateModule } from '../format/module.ts'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, isValidColor } from '../format/diagram.ts'
import { type EndKind, isEndKind } from '../format/cables.ts'
import { type RawNet, type RawPart, type RepeatCopy, expandRepeat } from './repeat.ts'

export const NETLIST_FORMAT = 'circuitoon-netlist/1'
/** A part reference: a letter, then letters, digits or underscores. */
export const REF_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export type ModuleLookup = (id: string) => ModuleDef | undefined

/** One resolved net endpoint. */
export interface Terminal {
  ref: string
  /** The canonical pin or hole group name (a label is resolved to it). */
  name: string
  /** A hole group of a board (a breadboard strip or rail): infrastructure, not a component pin. */
  infra: boolean
  /** A requested hole of a board hole group; absent means any free hole. */
  hole?: number
}
export interface IntentPart {
  ref: string
  module: string
  values?: Record<string, unknown>
  /** The board ref this part plugs into. */
  on?: string
}
export interface IntentNet {
  name: string
  terminals: Terminal[]
  color?: string
}
export interface Intent {
  title: string
  parts: IntentPart[]
  nets: IntentNet[]
  nc: Terminal[]
  groups: { name: string; refs: string[] }[]
  notes: { text: string; near: string }[]
  copies: RepeatCopy[]
  /** Every module the parts use, by id, sorted by id. */
  modules: Record<string, ModuleDef>
  /** Used ids defined under `modules` in the netlist: custom, unverified parts. */
  custom: string[]
  ends?: EndKind
}
export type IntentResult = { ok: true; intent: Intent } | { ok: false; errors: string[] }

/** One key per pin or hole group of a part (a hole index never makes a second key). */
export const terminalKey = (ref: string, name: string): string => JSON.stringify([ref, name])

/** "U1 GND", or "BB1 c5-top hole 2". */
export const terminalName = (t: Terminal): string => `${t.ref} ${t.name}${t.hole !== undefined ? ` hole ${t.hole}` : ''}`

/** A part that can plug into a board: not a board, with legs, none of them a bus. */
const mountable = (m: ModuleDef) => !isBoard(m) && m.pins.some((p) => !isSpacer(p)) && !m.pins.some((p) => !isSpacer(p) && p.bus)

function valueErrors(values: Record<string, unknown>, at: string): string[] {
  const out: string[] = []
  for (const [key, entry] of Object.entries(values)) {
    if (!Object.hasOwn(PARAM_RULES, key)) continue
    const rule = PARAM_RULES[key]
    if (!(isObj(entry) && isNum(entry.value) && entry.unit === rule.unit && validParamValue(key, entry.value)))
      out.push(`${at}.${key}: must be { "value": <number>, "unit": "${rule.unit}" } within ${rule.range}`)
  }
  return out
}

type PinResult = { ok: true; t: Terminal } | { ok: false; error: string }

/** A pin by exact name (pins and hole groups share one namespace), else by a label exactly one of them has. */
function byName(m: ModuleDef, ref: string, pin: string, at: string): PinResult {
  const pins = m.pins.filter((p): p is PinDef => !isSpacer(p))
  const groups = m.holes ?? []
  if (pins.some((p) => p.name === pin)) return { ok: true, t: { ref, name: pin, infra: false } }
  if (groups.some((g) => g.name === pin)) return { ok: true, t: { ref, name: pin, infra: isBoard(m) } }
  const labelled = [...pins.filter((p) => p.label === pin).map((p) => p.name), ...groups.filter((g) => g.label === pin).map((g) => g.name)]
  if (labelled.length === 1) return { ok: true, t: { ref, name: labelled[0], infra: isBoard(m) && groups.some((g) => g.name === labelled[0]) } }
  if (labelled.length > 1) return { ok: false, error: `${at}: "${pin}" is the label of ${labelled.length} pins on ${ref} (${labelled.join(', ')}); name one of them` }
  return { ok: false, error: `${at}: ${ref} (${m.id}) has no pin or label "${pin}"` }
}

export function parseNetlist(raw: unknown, library: ModuleLookup): IntentResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['netlist must be a JSON object'] }
  if (raw.format === undefined) errors.push(`format: missing (expected "${NETLIST_FORMAT}")`)
  else if (raw.format !== NETLIST_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${NETLIST_FORMAT}")`)
  if (typeof raw.title !== 'string' || raw.title.trim() === '') errors.push('title: required')

  // Embedded modules: validated like library modules, under ids of their own.
  const embedded = new Map<string, ModuleDef>()
  if (raw.modules !== undefined) {
    if (!isObj(raw.modules)) errors.push('modules: must be an object of module definitions by id')
    else
      for (const [key, m] of Object.entries(raw.modules)) {
        const r = validateModule(m)
        if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`))
        else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`)
        else if (library(key)) errors.push(`modules.${key}: "${key}" is a built-in part; give the embedded module its own id`)
        else embedded.set(key, r.module)
      }
  }
  const lookup = (id: string) => embedded.get(id) ?? library(id)
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  if (!Array.isArray(raw.nets)) errors.push('nets: required list')
  if (!Array.isArray(raw.parts) || !Array.isArray(raw.nets)) return { ok: false, errors }
  const topParts = raw.parts
  const topNets = raw.nets

  // Repeats add parts, nets, and pins to the outside nets their shared ports join.
  const topRefs = new Set(topParts.flatMap((p) => (isObj(p) && typeof p.ref === 'string' ? [p.ref] : [])))
  const topNetNames = topNets.flatMap((n) => (isObj(n) && typeof n.name === 'string' ? [n.name] : []))
  const rep = raw.repeat === undefined ? null : expandRepeat(raw.repeat, topRefs, topNetNames)
  const rawParts: RawPart[] = [...topParts.map((p, i) => ({ p, at: `parts[${i}]` })), ...(rep?.parts ?? [])]

  const parts: IntentPart[] = []
  const byRef = new Map<string, { part: IntentPart; module: ModuleDef; at: string }>()
  const used = new Map<string, ModuleDef>()
  for (const { p, at } of rawParts) {
    if (!isObj(p)) {
      errors.push(`${at}: must be an object`)
      continue
    }
    const ref = p.ref
    if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) {
      errors.push(`${at}.ref: required, a letter then letters, digits or _ (for example "R1")`)
      continue
    }
    if (byRef.has(ref)) {
      errors.push(`${at}.ref: duplicate "${ref}"`)
      continue
    }
    if (typeof p.module !== 'string') {
      errors.push(`${at}.module: required`)
      continue
    }
    const m = lookup(p.module)
    if (!m) {
      errors.push(`${at}.module: no built-in or embedded module "${p.module}"`)
      continue
    }
    const part: IntentPart = { ref, module: p.module }
    if (p.values !== undefined) {
      if (!isObj(p.values)) errors.push(`${at}.values: must be an object`)
      else {
        errors.push(...valueErrors(p.values, `${at}.values`))
        part.values = p.values
      }
    }
    if (p.on !== undefined) {
      if (typeof p.on !== 'string') errors.push(`${at}.on: must be the ref of a breadboard or rail strip`)
      else part.on = p.on
    }
    parts.push(part)
    byRef.set(ref, { part, module: m, at })
    used.set(p.module, m)
  }
  for (const { part, module, at } of byRef.values()) {
    if (part.on === undefined) continue
    const board = byRef.get(part.on)
    if (!board) errors.push(`${at}.on: no part "${part.on}"`)
    else if (!isBoard(board.module)) errors.push(`${at}.on: ${part.on} (${board.module.id}) is not a breadboard or rail strip`)
    else if (!mountable(module)) errors.push(`${at}.on: ${part.ref} (${module.id}) cannot plug into a board (it is a board, has a bus pin or has no legs)`)
  }

  const resolve = (ep: unknown, at: string): Terminal | null => {
    let ref: unknown
    let pin: unknown
    let group: unknown
    let hole: unknown
    if (typeof ep === 'string') {
      const dot = ep.indexOf('.')
      if (dot < 1) {
        errors.push(`${at}: "${ep}" must be "REF.PIN"`)
        return null
      }
      ref = ep.slice(0, dot)
      pin = ep.slice(dot + 1)
    } else if (isObj(ep)) ({ ref, pin, group, hole } = ep)
    else {
      errors.push(`${at}: must be "REF.PIN", { "ref", "pin" } or { "ref", "group", "hole" }`)
      return null
    }
    const hit = typeof ref === 'string' ? byRef.get(ref) : undefined
    if (!hit) {
      errors.push(`${at}: no part "${String(ref)}"`)
      return null
    }
    const r = ref as string
    const m = hit.module
    if (group !== undefined) {
      const g = typeof group === 'string' ? m.holes?.find((h) => h.name === group) : undefined
      if (!g) {
        errors.push(`${at}: ${r} (${m.id}) has no hole group "${String(group)}"`)
        return null
      }
      if (hole !== undefined && !(Number.isInteger(hole) && (hole as number) >= 0 && (hole as number) < g.at.length)) {
        errors.push(`${at}.hole: ${r} ${g.name} has holes 0 to ${g.at.length - 1}`)
        return null
      }
      return { ref: r, name: g.name, infra: isBoard(m), ...(hole !== undefined ? { hole: hole as number } : {}) }
    }
    if (typeof pin !== 'string' || pin === '') {
      errors.push(`${at}: pin required`)
      return null
    }
    const res = byName(m, r, pin, at)
    if (!res.ok) {
      errors.push(res.error)
      return null
    }
    return res.t
  }

  // Nets: the top-level ones (with the copy pins their shared ports bring), then the copies' own.
  const rawNets: RawNet[] = []
  topNets.forEach((n, i) => {
    const at = `nets[${i}]`
    if (!isObj(n) || !Array.isArray(n.pins)) return void errors.push(`${at}: must be { "name", "pins": [...] }`)
    const extra = typeof n.name === 'string' ? (rep?.shared.get(n.name) ?? []) : []
    rawNets.push({ name: n.name, at, pins: [...n.pins.map((ep, j) => ({ ep, at: `${at}.pins[${j}]` })), ...extra] })
  })
  rawNets.push(...(rep?.nets ?? []))
  const nets: IntentNet[] = []
  const inNet = new Map<string, string>()
  for (const { name, pins, at } of rawNets) {
    if (typeof name !== 'string' || name === '') {
      errors.push(`${at}.name: required`)
      continue
    }
    if (nets.some((x) => x.name === name)) {
      errors.push(`${at}.name: duplicate net "${name}"`)
      continue
    }
    const terminals: Terminal[] = []
    for (const { ep, at: pat } of pins) {
      const t = resolve(ep, pat)
      if (!t) continue
      const key = terminalKey(t.ref, t.name)
      const other = inNet.get(key)
      if (other !== undefined) {
        errors.push(`${pat}: ${terminalName({ ...t, hole: undefined })} is already in net "${other}"`)
        continue
      }
      inNet.set(key, name)
      terminals.push(t)
    }
    if (terminals.length < 2) errors.push(`${at}.pins: a net joins at least 2 pins`)
    nets.push({ name, terminals })
  }
  if (rep) errors.push(...rep.errors)

  const nc: Terminal[] = []
  if (raw.nc !== undefined) {
    if (!Array.isArray(raw.nc)) errors.push('nc: must be a list of pins')
    else
      raw.nc.forEach((ep, i) => {
        const t = resolve(ep, `nc[${i}]`)
        if (!t) return
        if (t.infra) return void errors.push(`nc[${i}]: ${terminalName(t)} is a breadboard hole group, not a pin`)
        const net = inNet.get(terminalKey(t.ref, t.name))
        if (net !== undefined) return void errors.push(`nc[${i}]: ${terminalName(t)} is in net "${net}", so it cannot be not connected`)
        nc.push(t)
      })
  }

  const groups: { name: string; refs: string[] }[] = []
  const groupOf = new Map<string, string>()
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) errors.push('groups: must be a list of { "name", "parts" }')
    else
      raw.groups.forEach((g, i) => {
        const at = `groups[${i}]`
        if (!isObj(g) || typeof g.name !== 'string' || g.name === '' || !Array.isArray(g.parts)) return void errors.push(`${at}: must be { "name", "parts": [refs] }`)
        const gname = g.name
        if (gname.length > ANNOTATION_LABEL_MAX) return void errors.push(`${at}.name: at most ${ANNOTATION_LABEL_MAX} characters`)
        if (groups.some((x) => x.name === gname)) return void errors.push(`${at}.name: duplicate group "${gname}"`)
        const refs: string[] = []
        g.parts.forEach((r, j) => {
          if (typeof r !== 'string' || !byRef.has(r)) return void errors.push(`${at}.parts[${j}]: no part "${String(r)}"`)
          const other = groupOf.get(r)
          if (other !== undefined) return void errors.push(`${at}.parts[${j}]: ${r} is already in group "${other}"`)
          groupOf.set(r, gname)
          refs.push(r)
        })
        groups.push({ name: gname, refs })
      })
  }

  const notes: { text: string; near: string }[] = []
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) errors.push('notes: must be a list of { "text", "near" }')
    else
      raw.notes.forEach((n, i) => {
        const at = `notes[${i}]`
        if (!isObj(n) || typeof n.text !== 'string' || n.text.trim() === '') return void errors.push(`${at}.text: required`)
        if (n.text.length > ANNOTATION_TEXT_MAX) return void errors.push(`${at}.text: at most ${ANNOTATION_TEXT_MAX} characters`)
        const near = n.near
        if (typeof near !== 'string' || !(byRef.has(near) || groups.some((g) => g.name === near))) return void errors.push(`${at}.near: must name a part ref or a group`)
        notes.push({ text: n.text, near })
      })
  }

  let ends: EndKind | undefined
  if (raw.wires !== undefined) {
    if (!isObj(raw.wires)) errors.push('wires: must be { "color": { NET: color }, "ends": kind }')
    else {
      const { color, ends: kind } = raw.wires
      if (color !== undefined) {
        if (!isObj(color)) errors.push('wires.color: must map net names to colors')
        else
          for (const [net, c] of Object.entries(color)) {
            const target = nets.find((x) => x.name === net)
            if (!target) errors.push(`wires.color.${net}: no net "${net}"`)
            else if (typeof c !== 'string' || !isValidColor(c)) errors.push(`wires.color.${net}: must be a named color or #RRGGBB`)
            else target.color = c
          }
      }
      if (kind !== undefined) {
        if (!isEndKind(kind)) errors.push(`wires.ends: unknown cable end ${JSON.stringify(kind)}`)
        else ends = kind
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  const ids = [...used.keys()].sort()
  return {
    ok: true,
    intent: {
      title: raw.title as string,
      parts,
      nets,
      nc,
      groups,
      notes,
      copies: rep?.copies ?? [],
      modules: Object.fromEntries(ids.map((id) => [id, used.get(id)!])),
      custom: ids.filter((id) => embedded.has(id)),
      ...(ends ? { ends } : {}),
    },
  }
}
```

Note the `terminalName({ ...t, hole: undefined })` in the duplicate message: the key ignores holes, so the message names the group without one.

- [ ] **Step 5: Implement the tables**

Create `src/agent/tables.ts`:

```ts
// What the CLI prints alongside a layout: the bill of quantities (parts per module) and, for
// repeats, the channel allocation table (each copy port and the outside pin it is bound to).
import type { Intent } from './netlist.ts'
import { naturalCompare } from './order.ts'

export interface QuantityRow {
  module: string
  name: string
  count: number
  /** Embedded in the netlist: a custom part nobody has verified. */
  custom: boolean
}
export interface ChannelRow {
  copy: string
  port: string
  endpoint: string
}

export function quantities(intent: Intent): QuantityRow[] {
  const count = new Map<string, number>()
  for (const p of intent.parts) count.set(p.module, (count.get(p.module) ?? 0) + 1)
  return [...count]
    .map(([module, n]) => ({ module, name: intent.modules[module].name, count: n, custom: intent.custom.includes(module) }))
    .sort((a, b) => naturalCompare(a.name, b.name))
}

export function channelTable(intent: Intent): ChannelRow[] {
  return intent.copies.flatMap((c) => Object.entries(c.bindings).map(([port, endpoint]) => ({ copy: c.id, port, endpoint })))
}

export function quantitiesText(rows: QuantityRow[]): string {
  return rows.map((r) => `  ${r.count} x ${r.name} [${r.module}]${r.custom ? ' (custom, unverified)' : ''}`).join('\n')
}

export function channelsText(rows: ChannelRow[]): string {
  const w1 = Math.max(4, ...rows.map((r) => r.copy.length))
  const w2 = Math.max(4, ...rows.map((r) => r.port.length))
  return [`${'copy'.padEnd(w1)}  ${'port'.padEnd(w2)}  bound to`, ...rows.map((r) => `${r.copy.padEnd(w1)}  ${r.port.padEnd(w2)}  ${r.endpoint}`)].join('\n')
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/agent/netlist.test.ts src/agent/tables.test.ts src/agent/repeat.test.ts`
Expected: PASS. If an expected error list differs only in order, fix the code to emit in the order the test states (spec rules are checked parts, mounts, nets, repeat, nc, groups, notes, wires).

- [ ] **Step 7: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/agent/order.ts src/agent/catalog.ts src/agent/netlist.ts src/agent/tables.ts src/agent/netlist.test.ts src/agent/tables.test.ts
git commit -m "Agent toolkit: circuitoon-netlist/1 parser with every contract rule

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verification against the intent (electrical equivalence and capacity)

Compares a sheet with its stored `intent`: inventory (parts, modules, effective values, seated mounts, extra parts), connectivity (missing connections, unintended merges, extra component connections, `nc`) using spec 3's definition of a connection, and terminal capacity on the realized diagram.

**Files:**
- Create: `src/agent/internal.ts`, `src/agent/verify.ts`
- Test: `src/agent/verify.test.ts`

**Interfaces:**
- Consumes: `parseNetlist`, `Intent`, `ModuleLookup`, `terminalName` (Task 3); `terminalCapacity` (Task 1); `netlist`, `nodeKey` (netlist.ts); `plugsOf`, `mountIssues` (breadboard.ts); `endpointName` (checks.ts); `formatValue` (values.ts); `libraryLookup` (Task 3).
- Produces:
  - `src/agent/internal.ts`: `internalComponent(m: ModuleDef, name: string): string`
  - `src/agent/verify.ts`: `type VerifyRule = 'intent' | 'part-missing' | 'part-duplicate' | 'module-mismatch' | 'module-missing' | 'value-drift' | 'mount' | 'extra-part' | 'missing-connection' | 'merge' | 'extra-connection' | 'nc' | 'capacity'`, `interface VerifyFinding { id: string; rule: VerifyRule; severity: 'error'; message: string; parts: string[]; pins: Endpoint[]; wires: string[] }`, `NO_INTENT` (the exact spec message), `intentLookup(d: Diagram, library: ModuleLookup): ModuleLookup`, `verifyDiagram(d: Diagram, library: ModuleLookup): VerifyFinding[]`

- [ ] **Step 1: Write the failing test**

Create `src/agent/verify.test.ts`:

```ts
// Verification (spec 3 and the verify list of spec 10), on a hand-realized LED circuit: R1 legs in
// columns 1 and 7, D1 in 8 and 12, an unused tilt switch S1 in 15 and 16, BT1 off the board.
import { describe, expect, it } from 'vitest'
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import { load } from '../format/builtinModules.testing.ts'
import { libraryLookup } from './catalog.ts'
import { NO_INTENT, verifyDiagram } from './verify.ts'

const ids = ['breadboard-half', 'battery-holder-2xaa', 'battery-holder-4xaa', 'resistor', 'led', 'tilt-switch-sw520d', 'esp32-devkitc-v4']
const modules = Object.fromEntries(ids.map((id) => [id, load(id)]))

const intent = () => ({
  format: 'circuitoon-netlist/1',
  title: 'LED on a breadboard',
  parts: [
    { ref: 'BB1', module: 'breadboard-half' },
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
    { ref: 'D1', module: 'led', on: 'BB1' },
    { ref: 'S1', module: 'tilt-switch-sw520d', on: 'BB1' },
  ],
  nets: [
    { name: 'VCC', pins: ['BT1.+', 'R1.1'] },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'] },
  ],
} as Record<string, unknown>)

const hole = (pin: string, h: number) => ({ part: 'BB1', pin, hole: h })

function sheet(): Diagram {
  const parts: PartInstance[] = [
    { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 },
    { uid: 'BT1', designator: 'BT1', module: 'battery-holder-2xaa', x: 0, y: 300 },
    { uid: 'R1', designator: 'R1', module: 'resistor', x: 30, y: 40, values: { resistance: { value: 220, unit: 'ohm' } }, mount: { board: 'BB1' } },
    { uid: 'D1', designator: 'D1', module: 'led', x: 100, y: 40, mount: { board: 'BB1' } },
    { uid: 'S1', designator: 'S1', module: 'tilt-switch-sw520d', x: 150, y: 0, mount: { board: 'BB1' } },
  ]
  const connections: Connection[] = [
    { uid: 'w1', from: { part: 'BT1', pin: '+' }, to: hole('c1-top', 1), color: 'red', routing: true },
    { uid: 'w2', from: hole('c7-top', 1), to: hole('c8-top', 1), color: 'blue', routing: true },
    { uid: 'w3', from: hole('c12-top', 1), to: { part: 'BT1', pin: '-' }, color: 'black', routing: true },
  ]
  return { format: 'circuitoon-diagram/1', title: 'LED on a breadboard', modules, parts, connections, intent: intent() }
}
const rules = (d: Diagram) => verifyDiagram(d, libraryLookup).map((f) => f.rule)
const wire = (uid: string, from: Connection['from'], to: Connection['to']): Connection => ({ uid, from, to, routing: true })

describe('verifyDiagram', () => {
  it('passes the realized circuit: routing wires, strips, and an unused seated leg alone in its strip', () => {
    expect(verifyDiagram(sheet(), libraryLookup)).toEqual([])
  })
  it('blocks a hand edit that adds a second wire to a header pin', () => {
    const d = sheet()
    d.connections.push(wire('w4', { part: 'BT1', pin: '+' }, hole('c1-top', 2)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['capacity'])
    expect(f[0].message).toBe('BT1 + holds 2 wire ends but takes one.')
    expect(f[0].wires).toEqual(['w1', 'w4'])
  })
  it('blocks a wire into a hole a leg already fills', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c1-top', 0), hole('c1-top', 3)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['capacity'])
    expect(f[0].message).toBe('BB1 c1-top hole 0 holds a leg and 1 wire end but takes one.')
  })
  it('finds a missing connection', () => {
    const d = sheet()
    d.connections = d.connections.filter((c) => c.uid !== 'w2')
    expect(rules(d)).toEqual(['missing-connection'])
  })
  it('finds a merge through a strip', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c7-top', 2), hole('c12-top', 2)))
    expect(rules(d)).toEqual(['merge'])
  })
  it('finds a merge through a part\'s internal join', () => {
    const d: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules,
      parts: [
        { uid: 'U1', designator: 'U1', module: 'esp32-devkitc-v4', x: 0, y: 0 },
        { uid: 'R1', designator: 'R1', module: 'resistor', x: 300, y: 0 },
        { uid: 'R2', designator: 'R2', module: 'resistor', x: 300, y: 100 },
      ],
      connections: [
        { uid: 'w1', from: { part: 'U1', pin: 'GND' }, to: { part: 'R1', pin: '1' } },
        { uid: 'w2', from: { part: 'U1', pin: 'GND 2' }, to: { part: 'R2', pin: '1' } },
      ],
      intent: {
        format: 'circuitoon-netlist/1', title: 't',
        parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'R1', module: 'resistor' }, { ref: 'R2', module: 'resistor' }],
        nets: [{ name: 'A', pins: ['U1.GND', 'R1.1'] }, { name: 'B', pins: ['U1.GND 2', 'R2.1'] }],
      },
    }
    expect(rules(d)).toEqual(['merge'])
  })
  it('finds an extra component connection, but allows the routing infrastructure it goes through', () => {
    const d = sheet()
    d.connections.push(wire('w4', hole('c15-top', 1), hole('c1-top', 2)))
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['extra-connection'])
    expect(f[0].message).toMatch(/^S1 1 is connected to /)
  })
  it('finds a connection to a pin listed as nc', () => {
    const d = sheet()
    ;(d.intent as Record<string, unknown>).nc = ['S1.2']
    d.connections.push(wire('w4', hole('c16-top', 1), hole('c12-top', 2)))
    expect(rules(d)).toEqual(['nc'])
  })
  it('finds value drift after loading (220 to 2200 ohm)', () => {
    const d = sheet()
    d.parts[2] = { ...d.parts[2], values: { resistance: { value: 2200, unit: 'ohm' } } }
    const f = verifyDiagram(d, libraryLookup)
    expect(f.map((x) => x.rule)).toEqual(['value-drift'])
    expect(f[0].message).toContain('R1 resistance is 2.2 k')
  })
  it('finds a swapped module, an unseated mount and an extra part', () => {
    const swapped = sheet()
    swapped.parts[1] = { ...swapped.parts[1], module: 'battery-holder-4xaa' }
    expect(rules(swapped)).toEqual(['module-mismatch'])
    const loose = sheet()
    loose.parts[3] = { ...loose.parts[3], x: 105 }
    expect(rules(loose)).toContain('mount')
    const extra = sheet()
    extra.parts.push({ uid: 'R9', designator: 'R9', module: 'resistor', x: 400, y: 300 })
    expect(rules(extra)).toEqual(['extra-part'])
  })
  it('reports a missing intent with the gate\'s message', () => {
    const d = sheet()
    delete d.intent
    expect(verifyDiagram(d, libraryLookup).map((f) => f.message)).toEqual([NO_INTENT])
  })
  it('catches drift after a hand edit that moves a jumper onto the ground strip', () => {
    const d = sheet()
    d.connections[1] = { ...d.connections[1], to: hole('c12-top', 3) }
    expect(rules(d)).toEqual(expect.arrayContaining(['merge', 'missing-connection']))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/verify.test.ts`
Expected: FAIL: cannot resolve `./verify.ts`.

- [ ] **Step 3: Implement the internal-join helper**

Create `src/agent/internal.ts`:

```ts
// Which pins a module joins inside itself (`internal`, transitively): verification uses it to tell a
// pin that is part of a requested net through its own part from an extra connection, and layout
// uses it to wire internally joined pins as one node.
import type { ModuleDef } from '../format/module.ts'

const cache = new WeakMap<ModuleDef, Map<string, string>>()

function components(m: ModuleDef): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const g of m.internal ?? [])
    for (let i = 1; i < g.length; i++) {
      const a = find(g[0])
      const b = find(g[i])
      if (a !== b) parent.set(b, a)
    }
  const out = new Map<string, string>()
  for (const g of m.internal ?? []) for (const n of g) out.set(n, find(n))
  return out
}

/** The pin's electrical component inside its part, named by one member; a pin joined to nothing is its own. */
export function internalComponent(m: ModuleDef, name: string): string {
  let map = cache.get(m)
  if (!map) cache.set(m, (map = components(m)))
  return map.get(name) ?? name
}
```

- [ ] **Step 4: Implement verification**

Create `src/agent/verify.ts`:

```ts
// Electrical equivalence (agent toolkit spec section 3): a sheet against its `intent`. Inventory
// (parts, modules, effective values, seated mounts, extra parts), connectivity (missing
// connections, unintended merges, extra connections, nc) and terminal capacity on the realized
// diagram. Two component pins are connected when a path of wires, strips, internal joins or plugs
// joins them; strips, rails and `routing` wires are infrastructure and never count as extra
// endpoints themselves, and a pin whose only neighbours are infrastructure is unconnected. Pure.
import { type Diagram, type Endpoint, type PartInstance, moduleOf } from '../format/diagram.ts'
import { mountIssues, plugsOf } from '../format/breadboard.ts'
import { PARAM_RULES, isBoard, isObj, type ModuleDef, terminalCapacity, validParamValue } from '../format/module.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { endpointName } from '../format/checks.ts'
import { formatValue } from '../format/values.ts'
import { type Intent, type ModuleLookup, type Terminal, parseNetlist } from './netlist.ts'
import { internalComponent } from './internal.ts'

export type VerifyRule =
  | 'intent' | 'part-missing' | 'part-duplicate' | 'module-mismatch' | 'module-missing' | 'value-drift' | 'mount' | 'extra-part'
  | 'missing-connection' | 'merge' | 'extra-connection' | 'nc' | 'capacity'
const ORDER: VerifyRule[] = ['intent', 'part-missing', 'part-duplicate', 'module-mismatch', 'module-missing', 'value-drift', 'mount', 'extra-part', 'missing-connection', 'merge', 'extra-connection', 'nc', 'capacity']

export interface VerifyFinding {
  /** The rule plus what causes it, so it stays the same while the problem does. */
  id: string
  rule: VerifyRule
  severity: 'error'
  message: string
  /** Part uids, pins and wire uids to highlight. */
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

export const NO_INTENT = 'no intent: lay out from a netlist or add intent'

type Draft = Omit<VerifyFinding, 'id' | 'severity'> & { causes: string[] }
type Add = (rule: VerifyRule, message: string, causes: string[], more?: { parts?: string[]; pins?: Endpoint[]; wires?: string[] }) => void

/**
 * How a sheet's intent finds its modules: the sheet's embedded copy first (so a later library
 * change never breaks an old sheet), then the library. Ids the intent embeds itself are left to it.
 */
export function intentLookup(d: Diagram, library: ModuleLookup): ModuleLookup {
  const own = isObj(d.intent) && isObj(d.intent.modules) ? new Set(Object.keys(d.intent.modules)) : new Set<string>()
  return (id) => (own.has(id) ? undefined : (moduleOf(d, id) ?? library(id)))
}

export function verifyDiagram(d: Diagram, library: ModuleLookup): VerifyFinding[] {
  const found: Draft[] = []
  const add: Add = (rule, message, causes, more = {}) => found.push({ rule, message, causes, parts: more.parts ?? [], pins: more.pins ?? [], wires: more.wires ?? [] })
  if (d.intent === undefined) add('intent', NO_INTENT, ['intent'])
  else {
    const r = parseNetlist(d.intent, intentLookup(d, library))
    if (!r.ok) add('intent', `intent is not a valid netlist: ${r.errors.slice(0, 5).join('; ')}${r.errors.length > 5 ? ` (and ${r.errors.length - 5} more)` : ''}`, ['intent'])
    else against(d, r.intent, add)
  }
  capacity(d, add)
  found.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0))
  const seen = new Map<string, number>()
  return found.map(({ causes, ...f }) => {
    const base = `${f.rule}|${[...new Set(causes)].sort().join(',')}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: n ? `${base}#${n}` : base, severity: 'error' as const, ...f }
  })
}

/** The value a part has for a param after loading: its override when valid, else the module default. */
function effective(values: Record<string, unknown> | undefined, m: ModuleDef, key: string): number | undefined {
  const rule = PARAM_RULES[key]
  const stored = values?.[key]
  const v = isObj(stored) ? stored.value : undefined
  if (isObj(stored) && stored.unit === rule.unit && validParamValue(key, v)) return v
  const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
  const param = params[key]
  const dflt = isObj(param) ? param.default : undefined
  return validParamValue(key, dflt) ? dflt : undefined
}

function valueDrift(values: Record<string, unknown> | undefined, m: ModuleDef, key: string, want: unknown): string | null {
  if (Object.hasOwn(PARAM_RULES, key)) {
    const unit = PARAM_RULES[key].unit
    const w = (want as { value: number }).value
    const have = effective(values, m, key)
    if (have === w) return null
    return `${key} is ${have === undefined ? 'not set' : formatValue(have, unit)} on the sheet but ${formatValue(w, unit)} in the intent.`
  }
  const have = values?.[key]
  return JSON.stringify(have) === JSON.stringify(want) ? null : `${key} is ${JSON.stringify(have ?? null)} on the sheet but ${JSON.stringify(want)} in the intent.`
}

function against(d: Diagram, intent: Intent, add: Add) {
  const byDesignator = new Map<string, PartInstance[]>()
  for (const p of d.parts) byDesignator.set(p.designator, [...(byDesignator.get(p.designator) ?? []), p])
  const uidOf = new Map<string, string>()
  for (const ip of intent.parts) {
    const list = byDesignator.get(ip.ref) ?? []
    if (!list.length) {
      add('part-missing', `${ip.ref} (${ip.module}) is in the intent but not on the sheet.`, [ip.ref])
      continue
    }
    if (list.length > 1) {
      add('part-duplicate', `${list.length} parts on the sheet are named ${ip.ref}; the intent has one.`, [ip.ref], { parts: list.map((p) => p.uid) })
      continue
    }
    const part = list[0]
    uidOf.set(ip.ref, part.uid)
    if (part.module !== ip.module) {
      add('module-mismatch', `${ip.ref} is a ${part.module} on the sheet but a ${ip.module} in the intent.`, [ip.ref], { parts: [part.uid] })
      continue
    }
    const m = moduleOf(d, part.module)
    if (!m) {
      add('module-missing', `${ip.ref}'s module "${part.module}" is not embedded in the sheet.`, [ip.ref], { parts: [part.uid] })
      continue
    }
    for (const [key, want] of Object.entries(ip.values ?? {})) {
      const drift = valueDrift(part.values, m, key, want)
      if (drift) add('value-drift', `${ip.ref} ${drift}`, [ip.ref, key], { parts: [part.uid] })
    }
  }
  const issues = new Map(mountIssues(d).map((i) => [i.part, i]))
  for (const ip of intent.parts) {
    if (ip.on === undefined) continue
    const uid = uidOf.get(ip.ref)
    const board = uidOf.get(ip.on)
    if (!uid || !board) continue
    const part = d.parts.find((p) => p.uid === uid)!
    if (part.mount?.board !== board) add('mount', `${ip.ref} should plug into ${ip.on} but is not mounted on it.`, [ip.ref], { parts: [uid, board] })
    else if (issues.has(uid)) add('mount', `${ip.ref} is set to plug into ${ip.on} but is not seated (${issues.get(uid)!.reason}), so its legs connect nothing.`, [ip.ref], { parts: [uid, board] })
  }
  const refs = new Set(intent.parts.map((p) => p.ref))
  for (const p of d.parts)
    if (!refs.has(p.designator) && !isBoard(moduleOf(d, p.module))) add('extra-part', `${p.designator} (${p.module}) is on the sheet but not in the intent.`, [p.uid], { parts: [p.uid] })
  connectivity(d, intent, uidOf, add)
}

function connectivity(d: Diagram, intent: Intent, uidOf: Map<string, string>, add: Add) {
  const nl = netlist(d)
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  const keyOf = (t: Terminal) => {
    const uid = uidOf.get(t.ref)
    return uid === undefined ? null : nodeKey(uid, t.name)
  }
  const split = (k: string) => JSON.parse(k) as [string, string]
  const pinOf = (k: string): Endpoint => ({ part: split(k)[0], pin: split(k)[1] })
  const nameOf = (k: string) => endpointName(d, pinOf(k))
  const realized = (k: string) => {
    const i = nl.netOf.get(k)
    return i === undefined ? `alone ${k}` : `net ${i}`
  }
  const want = new Map<string, number>()
  intent.nets.forEach((n, i) => n.terminals.forEach((t) => {
    const k = keyOf(t)
    if (k) want.set(k, i)
  }))

  // Missing: every endpoint of one requested net on one realized net.
  intent.nets.forEach((n) => {
    const parts = new Map<string, string[]>()
    for (const t of n.terminals) {
      const k = keyOf(t)
      if (!k) continue
      const r = realized(k)
      parts.set(r, [...(parts.get(r) ?? []), k])
    }
    if (parts.size < 2) return
    const heads = [...parts.values()].map((ks) => ks[0])
    add('missing-connection', `Net ${n.name} is not connected: ${heads.map(nameOf).join(', ')} are on ${parts.size} separate pieces.`, [n.name], { parts: heads.map((k) => split(k)[0]), pins: heads.map(pinOf) })
  })

  // Merge: endpoints of two requested nets on one realized net.
  for (const keys of nl.nets) {
    const hit = new Map<number, string>()
    for (const k of keys) {
      const i = want.get(k)
      if (i !== undefined && !hit.has(i)) hit.set(i, k)
    }
    if (hit.size < 2) continue
    const names = [...hit.keys()].map((i) => intent.nets[i].name)
    add('merge', `Nets ${names.join(' and ')} are joined on the sheet (${[...hit.values()].map(nameOf).join(', ')}); they must stay separate.`, [...names].sort(), { parts: [...hit.values()].map((k) => split(k)[0]), pins: [...hit.values()].map(pinOf) })
  }

  // Extra and nc: a component pin outside every requested net that reaches another component pin.
  const component = (k: string) => {
    const p = partBy.get(split(k)[0])
    const m = p && moduleOf(d, p.module)
    return !!m && !isBoard(m)
  }
  const compOf = (k: string) => {
    const [uid, pin] = split(k)
    const m = moduleOf(d, partBy.get(uid)!.module)!
    return `${uid}|${internalComponent(m, pin)}`
  }
  const ncKeys = new Set(intent.nc.map(keyOf).filter((k): k is string => k !== null))
  for (const keys of nl.nets) {
    const members = keys.filter(component)
    const requested = new Set(members.filter((k) => want.has(k)).map(compOf))
    for (const k of members) {
      if (want.has(k)) continue
      if (!ncKeys.has(k) && requested.has(compOf(k))) continue
      const others = members.filter((o) => compOf(o) !== compOf(k))
      if (!others.length) continue
      const more = others.length > 1 ? ` and ${others.length - 1} more` : ''
      if (ncKeys.has(k)) add('nc', `${nameOf(k)} must stay unconnected (nc) but is connected to ${nameOf(others[0])}${more}.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
      else add('extra-connection', `${nameOf(k)} is connected to ${nameOf(others[0])}${more}, but the intent does not connect it.`, [k], { parts: [split(k)[0]], pins: [pinOf(k)] })
    }
  }
}

/** Every pin, pad and hole holds no more wire ends and legs than it takes (spec 2.2 and 3). */
function capacity(d: Diagram, add: Add) {
  const plugs = plugsOf(d)
  const legOf = new Map(plugs.map((pl) => [nodeKey(pl.part, pl.pin), pl]))
  const broken = new Set(netlist(d, plugs).broken)
  const slots = new Map<string, { what: string; cap: number; legs: number; wires: string[]; part: string }>()
  const slot = (key: string, what: string, cap: number, part: string) => {
    let s = slots.get(key)
    if (!s) slots.set(key, (s = { what, cap, legs: 0, wires: [], part }))
    return s
  }
  const holeSlot = (board: string, group: string, hole: number) =>
    slot(JSON.stringify(['hole', board, group, hole]), endpointName(d, { part: board, pin: group, hole }), 1, board)
  for (const pl of plugs) holeSlot(pl.board, pl.group, pl.hole).legs++
  for (const c of d.connections) {
    if (broken.has(c.uid)) continue
    for (const ep of [c.from, c.to]) {
      const part = d.parts.find((p) => p.uid === ep.part)!
      const m = moduleOf(d, part.module)!
      const group = m.holes?.find((g) => g.name === ep.pin)
      if (group && isBoard(m)) holeSlot(ep.part, ep.pin, ep.hole ?? 0).wires.push(c.uid)
      else if (group) slot(JSON.stringify(['pad', ep.part, ep.pin, ep.hole ?? 0]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
      else {
        const leg = legOf.get(nodeKey(ep.part, ep.pin))
        if (leg) holeSlot(leg.board, leg.group, leg.hole).wires.push(c.uid)
        else slot(JSON.stringify(['pin', ep.part, ep.pin]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid)
      }
    }
  }
  for (const [key, s] of slots) {
    if (s.legs + s.wires.length <= s.cap) continue
    const ends = `${s.wires.length} wire end${s.wires.length === 1 ? '' : 's'}`
    const holds = s.legs ? `a leg and ${ends}` : ends
    add('capacity', `${s.what} holds ${holds} but takes ${s.cap === 1 ? 'one' : s.cap}.`, [key], { parts: [s.part], wires: s.wires })
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/agent/verify.test.ts`
Expected: PASS. The unseated-mount case also reports the missing connections it causes; the test only asserts `mount` is among them. If `endpointName` renders a pin label differently from the expected messages (for example a pin with a `label`), fix the expected message only when the label is what the sheet shows.

- [ ] **Step 6: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/agent/internal.ts src/agent/verify.ts src/agent/verify.test.ts
git commit -m "Agent toolkit: verify a sheet against its intent, with terminal capacity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Annotations in the Sheet, themes and a standalone SVG export

Draws group frames and text notes in `Sheet` (so in every export), gives `Sheet` a theme so a standalone SVG has inline colors (light or dark), shares the caption geometry between the renderer and the layout, and adds `renderSheetSvg` with tight content bounds and a focus box.

**Files:**
- Create: `src/render/theme.ts`, `src/render/captionBox.ts`, `src/render/annotationGeometry.ts`, `src/render/Annotations.tsx`, `src/render/exportSvg.tsx`
- Modify: `src/render/Part.tsx:186-252` (caption anchor, `ink` prop), `src/render/Sheet.tsx` (whole file)
- Test: `src/render/exportSvg.test.ts`

**Interfaces:**
- Consumes: `Annotation`, `Diagram`, `computeRoutes`, `Routes` (diagram.ts); `ANNOTATION_TEXT_MAX` (Task 1).
- Produces:
  - `src/render/theme.ts`: `interface SheetTheme { paper: string; grid: string; ink: string; note: string }`, `SITE_THEME`, `LIGHT_THEME`, `DARK_THEME`
  - `src/render/captionBox.ts`: `CAPTION_SIZE`, `captionAnchor(m: ModuleDef, rotation?: Rotation): Pt`, `captionBox(part: CaptionPart, m: ModuleDef, text?: string): Rect` where `CaptionPart = { x: number; y: number; rotation?: Rotation; designator: string; values?: Record<string, unknown> }`
  - `src/render/annotationGeometry.ts`: `NOTE_SIZE`, `NOTE_LINE`, `NOTE_PAD`, `NOTE_WRAP = 48`, `noteLines(text): string[]`, `frameTab(a: Annotation): Rect`, `annotationRect(a: Annotation): Rect`, `wrapNote(text: string, width?: number): string`
  - `src/render/Annotations.tsx`: `FrameMark({ a, theme?, selected?, interactive? })`, `NoteMark({ a, theme?, selected?, interactive? })`
  - `src/render/exportSvg.tsx`: `EXPORT_FONT`, `contentBounds(d: Diagram, routes?: Routes): Rect`, `focusBounds(d: Diagram, uids: string[], routes?: Routes): Rect`, `renderSheetSvg(d: Diagram, opts?: { dark?: boolean; box?: Rect }): { svg: string; width: number; height: number }`
  - `Sheet` gains `theme?: SheetTheme`; `Part` gains `ink?: string` (caption color).

- [ ] **Step 1: Write the failing test**

Create `src/render/exportSvg.test.ts`:

```ts
// Frames and notes in the Sheet, the standalone SVG (inline colors, stated font, tight bounds), the
// focus box, and the caption geometry the layout relies on.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Diagram } from '../format/diagram.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'
import { buttonLed } from '../samples/buttonLed.ts'
import { contentBounds, focusBounds, renderSheetSvg } from './exportSvg.tsx'
import { captionAnchor, captionBox } from './captionBox.ts'
import { annotationRect, wrapNote } from './annotationGeometry.ts'
import { Part } from './Part.tsx'

const withNotes = (): Diagram => ({
  ...structuredClone(buttonLed),
  annotations: [
    { uid: 'a1', type: 'frame', x: 20, y: 0, w: 480, h: 200, label: 'Loop' },
    { uid: 'a2', type: 'text', x: 30, y: 220, text: 'Press S1 to light D1.' },
  ],
})
const inside = (r: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h

describe('standalone SVG', () => {
  it('draws frames and notes with inline colors, a stated font and its own size', () => {
    const { svg, width, height } = renderSheetSvg(withNotes())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="')).toBe(true)
    expect(svg).toContain(`width="${width}" height="${height}"`)
    expect(svg).toContain('font-family="')
    expect(svg).not.toContain('var(--')
    expect(svg).toContain('data-annotation="a1"')
    expect(svg).toContain('>Loop<')
    expect(svg).toContain('Press S1 to light D1.')
    expect(svg).toContain('#F7F8F3')
    expect(renderSheetSvg(withNotes(), { dark: true }).svg).toContain('#1B211E')
  })
  it('fits the content tightly: every part, wire and note inside, nothing far outside', () => {
    const d = withNotes()
    const box = contentBounds(d)
    for (const p of d.parts) expect(inside(bodyRect(p, layoutModule(d.modules[p.module])), box)).toBe(true)
    for (const a of d.annotations!) expect(inside(annotationRect(a), box)).toBe(true)
    expect(box.w).toBeLessThan(620)
    expect(box.h).toBeLessThan(330)
  })
  it('focuses on chosen parts and the wires touching them', () => {
    const d = structuredClone(buttonLed)
    const all = contentBounds(d)
    const focus = focusBounds(d, ['p4'])
    expect(focus.w * focus.h).toBeLessThan(all.w * all.h)
    expect(inside(bodyRect(d.parts[3], layoutModule(d.modules.led)), focus)).toBe(true)
  })
})

describe('shared geometry', () => {
  it('puts the caption box where Part draws the caption', () => {
    const m = load('resistor')
    const a = captionAnchor(m, 0)
    const html = renderToStaticMarkup(createElement('svg', null, createElement(Part, { module: m, caption: 'R1  220 Ω' })))
    expect(html).toContain(`y="${a.y}"`)
    const box = captionBox({ x: 100, y: 50, designator: 'R1', values: { resistance: { value: 220, unit: 'ohm' } } }, m)
    expect(box.y).toBe(50 + a.y - 8)
    expect(box.x + box.w / 2).toBeCloseTo(100 + a.x, 6)
  })
  it('includes a frame\'s label tab in its bounds, and wraps note text at 48 characters', () => {
    const r = annotationRect({ uid: 'a', type: 'frame', x: 0, y: 20, w: 100, h: 50, label: 'Power' })
    expect(r.y).toBe(12)
    expect(wrapNote('word '.repeat(20).trim()).split('\n').every((l) => l.length <= 48)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/render/exportSvg.test.ts`
Expected: FAIL: cannot resolve `./exportSvg.tsx`.

- [ ] **Step 3: Add the theme and caption geometry**

Create `src/render/theme.ts`:

```ts
// Sheet colors. On the site the paper and grid come from CSS variables (styles.css); a standalone
// export (the CLI's SVG and PNG) needs them inline, light or dark.
export interface SheetTheme {
  paper: string
  grid: string
  /** Captions, frames and note text. Wire casings and part outlines keep the Sticker ink. */
  ink: string
  /** Fill of a note box and a frame's label tab. */
  note: string
}

/** The Sticker ink (Part.tsx INK), repeated here so this file has no JSX dependency. */
const INK = '#23282F'

export const SITE_THEME: SheetTheme = { paper: 'var(--paper)', grid: 'var(--grid)', ink: INK, note: '#FFFFFF' }
export const LIGHT_THEME: SheetTheme = { paper: '#F7F8F3', grid: '#E1E6DB', ink: INK, note: '#FFFFFF' }
export const DARK_THEME: SheetTheme = { paper: '#1B211E', grid: '#2B342F', ink: '#E4EAE5', note: '#26302B' }
```

Create `src/render/captionBox.ts`:

```ts
// Where a part's caption (designator and value) is drawn: 8.5 px bold text centered under the
// rotated body, below any pin stubs pointing down. Shared by Part.tsx and the layout's overlap
// checks, so both always agree.
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from '../format/geometry.ts'
import { LEAD, layoutModule, type ModuleDef } from '../format/module.ts'
import { partCaption } from '../format/values.ts'

export const CAPTION_SIZE = 8.5
/** Average advance of one bold 8.5 px character, rounded up so a box never undershoots the text. */
const CAPTION_CHAR = 5.4

export type CaptionPart = { x: number; y: number; rotation?: Rotation; designator: string; values?: Record<string, unknown> }

/** The caption anchor in part-local px (text-anchor middle, on the baseline). */
export function captionAnchor(m: ModuleDef, rotation: Rotation = 0): Pt {
  const box = bodyRect({ x: 0, y: 0, rotation }, layoutModule(m))
  const stubsDown = worldPins({ x: 0, y: 0, rotation }, m).some((p) => p.dir.y > 0)
  return { x: box.x + box.w / 2, y: box.y + box.h + (stubsDown ? LEAD : 0) + 15 }
}

/** The caption's box in world px (8 px above the baseline, 2 below). */
export function captionBox(part: CaptionPart, m: ModuleDef, text = partCaption(part, m)): Rect {
  const a = captionAnchor(m, part.rotation ?? 0)
  const w = text.length * CAPTION_CHAR
  return { x: part.x + a.x - w / 2, y: part.y + a.y - 8, w, h: 10 }
}
```

- [ ] **Step 4: Use the caption anchor and a caption color in `Part`**

In `src/render/Part.tsx` add `import { CAPTION_SIZE, captionAnchor } from './captionBox.ts'`. Add the prop to the destructuring and its type:

```tsx
export const Part = memo(function Part({ module: m, x = 0, y = 0, rotation = 0, caption, values, ink = INK }: {
  // ...existing props...
  /** Caption color (the theme's ink); the Sticker ink by default. */
  ink?: string
}) {
```

Replace

```tsx
  const stubsDown = pins.some((p) => p.dir.y > 0)
  const headers = headerSides(m)
  const captionY = box.y + box.h + (stubsDown ? LEAD : 0) + 15
```

with

```tsx
  const headers = headerSides(m)
  const cap = captionAnchor(m, rotation)
```

and the caption `<text>` opening tag with

```tsx
        <text x={cap.x} y={cap.y} textAnchor="middle" fontSize={CAPTION_SIZE} fontWeight={700} fill={ink}>
```

- [ ] **Step 5: Add annotation geometry and marks**

Create `src/render/annotationGeometry.ts`:

```ts
// Sizes of group frames and text notes, shared by the renderer, the editor's hit targets and the
// layout (which must keep notes clear of parts). Pure.
import type { Annotation } from '../format/diagram.ts'
import type { Rect } from '../format/geometry.ts'

export const NOTE_SIZE = 10
export const NOTE_LINE = 13
export const NOTE_PAD = 6
/** Characters per line when the layout wraps a note. */
export const NOTE_WRAP = 48
const NOTE_CHAR = 5.9
const TAB_CHAR = 5.6

export const noteLines = (text: string): string[] => text.split('\n')

/** A frame's label tab, straddling its top edge 10 px from the left. */
export function frameTab(a: Annotation): Rect {
  return { x: a.x + 10, y: a.y - 8, w: (a.label ?? '').length * TAB_CHAR + 12, h: 16 }
}

/** Everything an annotation draws, in world px: a frame with its tab, or a note's box. */
export function annotationRect(a: Annotation): Rect {
  if (a.type === 'frame') {
    const w = a.w ?? 0
    const h = a.h ?? 0
    if (!a.label) return { x: a.x, y: a.y, w, h }
    const t = frameTab(a)
    return { x: a.x, y: t.y, w: Math.max(a.x + w, t.x + t.w) - a.x, h: a.y + h - t.y }
  }
  const lines = noteLines(a.text ?? '')
  return { x: a.x, y: a.y, w: Math.ceil(Math.max(1, ...lines.map((l) => l.length)) * NOTE_CHAR + 2 * NOTE_PAD), h: lines.length * NOTE_LINE + 2 * NOTE_PAD }
}

/** Word-wraps each paragraph to `width` characters (a longer single word keeps its own line). */
export function wrapNote(text: string, width = NOTE_WRAP): string {
  return text
    .split('\n')
    .map((para) => {
      const lines: string[] = []
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > width) {
          lines.push(line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      if (line) lines.push(line)
      return lines.join('\n')
    })
    .join('\n')
}
```

Create `src/render/Annotations.tsx`:

```tsx
// Group frames and text notes: drawn in the Sheet (so in SVG and PNG exports) and on the editor
// canvas, where `interactive` adds the hit targets and `selected` the selection outline.
import type { Annotation } from '../format/diagram.ts'
import { NOTE_LINE, NOTE_PAD, NOTE_SIZE, annotationRect, frameTab, noteLines } from './annotationGeometry.ts'
import { SITE_THEME, type SheetTheme } from './theme.ts'

type MarkProps = { a: Annotation; theme?: SheetTheme; selected?: boolean; interactive?: boolean }

export function FrameMark({ a, theme = SITE_THEME, selected = false, interactive = false }: MarkProps) {
  const w = a.w ?? 0
  const h = a.h ?? 0
  const tab = frameTab(a)
  return (
    <g data-annotation={a.uid}>
      <rect x={a.x} y={a.y} width={w} height={h} rx={10} fill="none" stroke={theme.ink} strokeWidth={1.4} strokeDasharray="7 5" pointerEvents="none" />
      {interactive && <rect className="annotation-hit" x={a.x} y={a.y} width={w} height={h} rx={10} strokeWidth={10} />}
      {a.label && (
        <g className={interactive ? 'annotation-grab' : undefined}>
          <rect x={tab.x} y={tab.y} width={tab.w} height={tab.h} rx={5} fill={theme.note} stroke={theme.ink} strokeWidth={1.2} />
          <text x={tab.x + 6} y={tab.y + tab.h / 2} dominantBaseline="central" fontSize={9} fontWeight={700} fill={theme.ink}>
            {a.label}
          </text>
        </g>
      )}
      {selected && <rect className="annotation-selected" x={a.x - 5} y={tab.y - 5} width={w + 10} height={a.y + h - tab.y + 10} rx={12} />}
    </g>
  )
}

export function NoteMark({ a, theme = SITE_THEME, selected = false, interactive = false }: MarkProps) {
  const r = annotationRect(a)
  return (
    <g data-annotation={a.uid} className={interactive ? 'annotation-grab' : undefined}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill={theme.note} stroke={theme.ink} strokeWidth={1.2} />
      <text x={r.x + NOTE_PAD} y={r.y + NOTE_PAD + 9} fontSize={NOTE_SIZE} fill={theme.ink}>
        {noteLines(a.text ?? '').map((line, i) => (
          <tspan key={i} x={r.x + NOTE_PAD} dy={i ? NOTE_LINE : 0}>
            {line}
          </tspan>
        ))}
      </text>
      {selected && <rect className="annotation-selected" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={8} />}
    </g>
  )
}
```

- [ ] **Step 6: Theme and annotations in `Sheet`**

Replace `src/render/Sheet.tsx` with:

```tsx
// A diagram drawn on graph paper: group frames, boards, then parts, then wires on top with hop arcs
// and pin dots, wire name tags, and text notes last. The theme sets the paper, grid and caption
// colors: CSS variables on the site, inline colors in a standalone export (exportSvg.tsx).
import { computeRoutes, labelAnchor, type Diagram, moduleOf, wireColor, wirePaths, wireWidth, type PartInstance } from '../format/diagram.ts'
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { partCaption } from '../format/values.ts'
import { Part, INK } from './Part.tsx'
import { LegDots, TakenHoles } from './Boards.tsx'
import { WireLabel } from './WireLabel.tsx'
import { CableLayer } from './CableEnd.tsx'
import { FrameMark, NoteMark } from './Annotations.tsx'
import { SITE_THEME, type SheetTheme } from './theme.ts'

export function Sheet({ diagram, captions = {}, box, label, decorative = false, theme = SITE_THEME }: {
  diagram: Diagram
  captions?: Record<string, string>
  /** Visible area in diagram coordinates. */
  box: { x: number; y: number; w: number; h: number }
  label: string
  /** Hide from assistive tech, for a preview inside a control that is already labelled. */
  decorative?: boolean
  /** Paper, grid and caption colors (CSS variables on the site). */
  theme?: SheetTheme
}) {
  const routes = computeRoutes(diagram)
  const wires = wirePaths(diagram, routes)
  const { boards, others } = splitBoards(diagram)
  const plugs = plugsOf(diagram)
  const notes = diagram.annotations ?? []
  const part = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    return m ? (
      <Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={captions[p.uid] ?? partCaption(p, m)} values={p.values} ink={theme.ink} />
    ) : null
  }
  return (
    <svg className="sheet" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke={theme.grid} strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={theme.paper} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid)" />
      {notes.filter((a) => a.type === 'frame').map((a) => <FrameMark key={a.uid} a={a} theme={theme} />)}
      {boards.map(part)}
      <TakenHoles plugs={plugs} />
      {others.map(part)}
      <LegDots plugs={plugs} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {wires.map(({ conn, d, blocked }) => {
          const w = wireWidth(conn.gauge)
          const color = wireColor(conn.color)
          return (
            <g key={conn.uid} data-wire={conn.uid}>
              <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={blocked ? '6 5' : undefined} />
              <path d={d} stroke={color} strokeWidth={w} strokeDasharray={blocked ? '6 5' : undefined} />
            </g>
          )
        })}
      </g>
      <CableLayer wires={wires} />
      {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
      {/* Name tags in their own layer after every wire, so a labeled wire crossing under a later
          one still shows its tag on top. Each tag keeps data-wire, matching the editor's canvas. */}
      <g>
        {wires.map(({ conn }) => {
          const anchor = conn.label ? labelAnchor(routes.get(conn.uid)?.points ?? []) : null
          return anchor ? (
            <g key={conn.uid} data-wire={conn.uid}>
              <WireLabel x={anchor.x} y={anchor.y} text={conn.label!} />
            </g>
          ) : null
        })}
      </g>
      {notes.filter((a) => a.type === 'text').map((a) => <NoteMark key={a.uid} a={a} theme={theme} />)}
    </svg>
  )
}
```

- [ ] **Step 7: Add the standalone export**

Create `src/render/exportSvg.tsx`:

```tsx
// A standalone SVG of a sheet for the CLI (agent toolkit spec 4.1): the Sheet rendered with
// react-dom/server, inline light or dark colors (no CSS variables), a stated font fallback (the
// site's Atkinson Hyperlegible when installed, else the system sans-serif) and tight content
// bounds, or a focus box around chosen parts. Pure: no DOM needed.
import { renderToStaticMarkup } from 'react-dom/server'
import { computeRoutes, type Diagram, moduleOf, type Routes } from '../format/diagram.ts'
import { type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { captionBox } from './captionBox.ts'
import { annotationRect } from './annotationGeometry.ts'
import { Sheet } from './Sheet.tsx'
import { DARK_THEME, LIGHT_THEME } from './theme.ts'

export const EXPORT_FONT = `'Atkinson Hyperlegible', 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif`
/** Room around each body for pin stubs and the labels beside them. */
const PIN_ROOM = 18

function boundsOf(rects: Rect[], pad: number): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 200, h: 100 }
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + 2 * pad), h: Math.ceil(y1 - y0 + 2 * pad) }
}

function partRects(d: Diagram, only?: Set<string>): Rect[] {
  const out: Rect[] = []
  for (const p of d.parts) {
    if (only && !only.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    const b = bodyRect(p, layoutModule(m))
    out.push({ x: b.x - PIN_ROOM, y: b.y - PIN_ROOM, w: b.w + 2 * PIN_ROOM, h: b.h + 2 * PIN_ROOM }, captionBox(p, m))
  }
  return out
}

const pointRects = (routes: Routes, uids?: Set<string>): Rect[] =>
  [...routes].flatMap(([uid, r]) => (r && (!uids || uids.has(uid)) ? r.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })) : []))

/** Everything drawn: parts with their stubs and captions, wires, frames and notes; 20 px of paper around. */
export function contentBounds(d: Diagram, routes: Routes = computeRoutes(d)): Rect {
  return boundsOf([...partRects(d), ...pointRects(routes), ...(d.annotations ?? []).map(annotationRect)], 20)
}

/** The given parts and every wire touching them; 30 px of paper around. */
export function focusBounds(d: Diagram, uids: string[], routes: Routes = computeRoutes(d)): Rect {
  const parts = new Set(uids)
  const wires = new Set(d.connections.filter((c) => parts.has(c.from.part) || parts.has(c.to.part)).map((c) => c.uid))
  return boundsOf([...partRects(d, parts), ...pointRects(routes, wires)], 30)
}

export function renderSheetSvg(d: Diagram, opts: { dark?: boolean; box?: Rect } = {}): { svg: string; width: number; height: number } {
  const box = opts.box ?? contentBounds(d)
  const markup = renderToStaticMarkup(<Sheet diagram={d} box={box} label={d.title} theme={opts.dark ? DARK_THEME : LIGHT_THEME} />)
  const width = Math.ceil(box.w)
  const height = Math.ceil(box.h)
  const svg = markup.replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${EXPORT_FONT}" `)
  return { svg: `${svg}\n`, width, height }
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/render src/samples src/Landing.test.ts`
Expected: PASS (the Landing and sample previews still render through `Sheet` with the site theme).

- [ ] **Step 9: Look at it**

```bash
npm run build && npx vite preview --port 4196 --strictPort
```
Open `http://localhost:4196/circuitoon/` in your own Chrome (not the Playwright MCP) and check the landing sample sheet looks exactly as before (captions in place, grid and paper colors unchanged), in light and dark mode. Stop the preview.

- [ ] **Step 10: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 11: Commit**

```bash
git add src/render
git commit -m "Sheet: group frames and notes, themes, standalone SVG export

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Placement with breadboard mounting

Gives every part a grid position, deterministically: boards (carrying the parts mounted on them, found by the spec 2.2 mount search) and microcontrollers first near the centre, then every other unit near what it connects to by net weight; repeat copies are tiled as one block and groups laid out as rows. Draws a frame per group and per copy, places notes below their target, and honours kept positions (used by `--keep` in Task 8).

**Files:**
- Create: `src/agent/footprint.ts`, `src/agent/mount.ts`, `src/agent/place.ts`, `src/agent/fixtures.testing.ts`
- Test: `src/agent/place.test.ts`

**Interfaces:**
- Consumes: `Intent`, `terminalKey`, `parseNetlist` (Task 3); `captionBox` (Task 5); `annotationRect`, `wrapNote` (Task 5); `seatOn`, `plugsOf`, `holeIndex`, `holeAt`, `mountIssues` (breadboard.ts); `plugPoints`, `bodyRect` (geometry.ts).
- Produces:
  - `src/agent/footprint.ts`: `PIN_ROOM`, `union`, `grow`, `shift`, `intersects(a: Rect, b: Rect): boolean`, `tightFootprint(p: PartInstance, m: ModuleDef): Rect`, `footprint(p, m): Rect`, `class RectIndex { add(r: Rect): void; hits(r: Rect): boolean }`
  - `src/agent/mount.ts`: `type NetOfPin = (part: string, pin: string) => number | undefined`, `mountPart(d: Diagram, uid: string, board: string, netOf: NetOfPin): { ok: true; part: PartInstance } | { ok: false; error: string }`
  - `src/agent/place.ts`: `interface Keep { x: number; y: number; rotation: Rotation }`, `type KeepMap = Map<string, Keep>`, `interface PlaceOptions { spacing: number; keep?: KeepMap }`, `type PlaceResult = { ok: true; parts: PartInstance[]; annotations: Annotation[] } | { ok: false; errors: string[] }`, `placeParts(intent: Intent, opts: PlaceOptions): PlaceResult`
  - `src/agent/fixtures.testing.ts`: `ledNetlist()`, `tiltSensors()` (plain netlist objects)

- [ ] **Step 1: Write the fixtures and the failing test**

Create `src/agent/fixtures.testing.ts`:

```ts
// Netlists the layout tests and the visual checks share. Plain data (no imports), so a script can
// load this file with Node's type stripping.

/** The spec's example (section 1): a battery lights an LED through a 220 ohm resistor on a breadboard. */
export function ledNetlist() {
  return {
    format: 'circuitoon-netlist/1',
    title: 'LED on a breadboard',
    parts: [
      { ref: 'BB1', module: 'breadboard-half' },
      { ref: 'BT1', module: 'battery-holder-2xaa' },
      { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
      { ref: 'D1', module: 'led', on: 'BB1' },
    ],
    nets: [
      { name: 'VCC', pins: [{ ref: 'BT1', pin: '+' }, { ref: 'R1', pin: '1' }] },
      { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'BT1.-'] },
    ],
    wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
  }
}

/** Eight tilt switches (a repeat) on ESP32 inputs, their grounds on a rail strip. */
export function tiltSensors() {
  const inputs = ['IO13', 'IO14', 'IO25', 'IO26', 'IO27', 'IO32', 'IO33', 'IO4']
  return {
    format: 'circuitoon-netlist/1',
    title: 'Eight tilt sensors',
    parts: [
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      { ref: 'BB1', module: 'power-rail-strip' },
    ],
    nets: [{ name: 'GND', pins: ['U1.GND', 'BB1.-'] }],
    repeat: {
      name: 'tilt',
      count: inputs.length,
      template: {
        parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }],
        nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }],
        ports: ['SIG', 'GND'],
      },
      bindings: inputs.map((io) => ({ SIG: `U1.${io}` })),
      shared: { GND: 'GND' },
    },
    wires: { color: { GND: 'black' }, ends: 'dupont-female' },
  }
}
```

Create `src/agent/place.test.ts`:

```ts
// Placement (spec 2.1 and 2.2): grid, determinism, mounts that seat without strip merges, no body or
// caption overlaps, frames, notes, tiled copies and kept positions.
import { describe, expect, it } from 'vitest'
import { DIAGRAM_FORMAT, type Diagram, type PartInstance } from '../format/diagram.ts'
import { mountIssues, plugsOf } from '../format/breadboard.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { libraryLookup } from './catalog.ts'
import { parseNetlist, terminalKey, type Intent } from './netlist.ts'
import { placeParts, type KeepMap } from './place.ts'
import { intersects, tightFootprint } from './footprint.ts'
import { ledNetlist, tiltSensors } from './fixtures.testing.ts'

const intentOf = (raw: unknown): Intent => {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.intent
}
const place = (raw: unknown, keep?: KeepMap) => {
  const intent = intentOf(raw)
  const r = placeParts(intent, { spacing: 20, keep })
  if (!r.ok) throw new Error(r.errors.join('\n'))
  const d: Diagram = { format: DIAGRAM_FORMAT, title: intent.title, modules: intent.modules, parts: r.parts, connections: [] }
  return { intent, annotations: r.annotations, d }
}
const noOverlaps = (d: Diagram) => {
  const fp = (p: PartInstance) => tightFootprint(p, d.modules[p.module])
  for (const a of d.parts)
    for (const b of d.parts) {
      if (a === b || a.mount?.board === b.uid || b.mount?.board === a.uid) continue
      expect(intersects(fp(a), fp(b)), `${a.uid} overlaps ${b.uid}`).toBe(false)
    }
}

describe('placeParts', () => {
  it('places the LED example on the 10 px grid, the same way every time', () => {
    const a = place(ledNetlist())
    const b = place(ledNetlist())
    expect(a.d.parts).toEqual(b.d.parts)
    for (const p of a.d.parts) {
      expect(p.x % 10).toBe(0)
      expect(p.y % 10).toBe(0)
    }
  })
  it('seats R1 and D1 on BB1, and no strip holds legs of two nets', () => {
    const { intent, d } = place(ledNetlist())
    expect(mountIssues(d)).toEqual([])
    expect(d.parts.filter((p) => p.mount?.board === 'BB1').map((p) => p.uid).sort()).toEqual(['D1', 'R1'])
    const netOf = new Map<string, string>()
    intent.nets.forEach((n) => n.terminals.forEach((t) => netOf.set(terminalKey(t.ref, t.name), n.name)))
    const strips = new Map<string, Set<string>>()
    for (const pl of plugsOf(d)) {
      const k = `${pl.board} ${pl.group}`
      strips.set(k, (strips.get(k) ?? new Set<string>()).add(netOf.get(terminalKey(pl.part, pl.pin)) ?? `none ${pl.part}.${pl.pin}`))
    }
    for (const [strip, nets] of strips) expect(nets.size, strip).toBe(1)
  })
  it('keeps bodies and captions apart: mounted parts overlap only their own board', () => {
    noOverlaps(place(ledNetlist()).d)
    noOverlaps(place(tiltSensors()).d)
  })
  it('seats a DIP-28 across the centre channel (turned 90 degrees)', () => {
    const { d } = place({
      format: 'circuitoon-netlist/1', title: 'Expander',
      parts: [{ ref: 'BB1', module: 'breadboard-half' }, { ref: 'U1', module: 'mcp23017-dip28', on: 'BB1' }],
      nets: [{ name: 'GND', pins: ['U1.VSS', 'BB1.top-'] }, { name: '3V3', pins: ['U1.VDD', 'BB1.top+'] }],
    })
    expect(d.parts.find((p) => p.uid === 'U1')!.rotation).toBe(90)
    expect(mountIssues(d)).toEqual([])
  })
  it('fails naming the part and the reason when no position on its board fits', () => {
    const r = placeParts(
      intentOf({
        format: 'circuitoon-netlist/1', title: 'Too wide',
        parts: [{ ref: 'BB1', module: 'breadboard-full' }, { ref: 'U1', module: 'esp32-devkit-v1-30', on: 'BB1' }],
        nets: [{ name: 'G', pins: ['U1.GND', 'BB1.top-'] }],
      }),
      { spacing: 20 },
    )
    expect(r).toEqual({ ok: false, errors: ['BB1 has no place for U1 (esp32-devkit-v1-30): no position puts every leg on a free hole.'] })
  })
  it('frames a group and puts its note below it, clear of every part', () => {
    const { d, annotations } = place({ ...ledNetlist(), groups: [{ name: 'Power', parts: ['BT1'] }], notes: [{ text: 'Two AA cells give 3 V.', near: 'Power' }] })
    const frame = annotations.find((a) => a.type === 'frame')!
    expect(frame.label).toBe('Power')
    const bt = d.parts.find((p) => p.uid === 'BT1')!
    const body = bodyRect(bt, layoutModule(d.modules[bt.module]))
    expect(body.x >= frame.x && body.y >= frame.y && body.x + body.w <= frame.x + frame.w! && body.y + body.h <= frame.y + frame.h!).toBe(true)
    const note = annotations.find((a) => a.type === 'text')!
    expect(note.y).toBeGreaterThan(frame.y)
    for (const p of d.parts) expect(intersects(annotationRect(note), tightFootprint(p, d.modules[p.module])), p.uid).toBe(false)
  })
  it('tiles repeat copies as one block with a labelled frame per copy', () => {
    const { annotations } = place(tiltSensors())
    expect(annotations.filter((a) => a.type === 'frame').map((a) => a.label)).toEqual(['tilt 1', 'tilt 2', 'tilt 3', 'tilt 4', 'tilt 5', 'tilt 6', 'tilt 7', 'tilt 8'])
  })
  it('keeps a kept part exactly where it was and places the rest around it', () => {
    const { d } = place(ledNetlist(), new Map([['BT1', { x: 600, y: 300, rotation: 0 as const }]]))
    expect(d.parts.find((p) => p.uid === 'BT1')).toMatchObject({ x: 600, y: 300, rotation: 0 })
    expect(mountIssues(d)).toEqual([])
    noOverlaps(d)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/place.test.ts`
Expected: FAIL: cannot resolve `./place.ts`.

- [ ] **Step 3: Implement footprints**

Create `src/agent/footprint.ts`:

```ts
// Rectangles the layout keeps apart: a part's body and caption (tight: what must never overlap
// another part's, spec 2.1), the same with room for pin stubs and labels (what free placement spaces
// out), and a bucketed index to test a candidate spot against everything placed so far. Pure.
import type { PartInstance } from '../format/diagram.ts'
import { type Rect, bodyRect } from '../format/geometry.ts'
import { LEAD, layoutModule, type ModuleDef } from '../format/module.ts'
import { captionBox } from '../render/captionBox.ts'

/** Room kept around a free part's body for its pin stubs and the labels beside them. */
export const PIN_ROOM = LEAD + 10

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
export const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })
export const shift = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy })
/** True when two rectangles share area; touching edges do not count. */
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Body plus caption. */
export function tightFootprint(p: PartInstance, m: ModuleDef): Rect {
  return union(bodyRect(p, layoutModule(m)), captionBox(p, m))
}

/** Body grown by PIN_ROOM, plus caption. */
export function footprint(p: PartInstance, m: ModuleDef): Rect {
  return union(grow(bodyRect(p, layoutModule(m)), PIN_ROOM), captionBox(p, m))
}

const CELL = 200

/** Placed rectangles bucketed on a 200 px grid, so a spot test looks only at its neighbours. */
export class RectIndex {
  private cells = new Map<string, Rect[]>()
  private keys(r: Rect): string[] {
    const out: string[] = []
    for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++)
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) out.push(`${cx},${cy}`)
    return out
  }
  add(r: Rect) {
    for (const k of this.keys(r)) {
      const list = this.cells.get(k)
      if (list) list.push(r)
      else this.cells.set(k, [r])
    }
  }
  hits(r: Rect): boolean {
    for (const k of this.keys(r)) for (const o of this.cells.get(k) ?? []) if (intersects(o, r)) return true
    return false
  }
}
```

- [ ] **Step 4: Implement the mount search**

Create `src/agent/mount.ts`:

```ts
// Mounting a part on its board during layout (agent toolkit spec 2.2): every grid position and
// rotations 0 and 90 degrees, in a fixed order (rotation, then row-major from the board's top-left).
// A candidate is accepted when `seatOn` reports it seated, it joins no two different nets (or a net
// and a leg on no net) in one strip, and its body and caption clear every other part mounted on
// that board. The first accepted candidate wins. Pure.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { holeAt, holeIndex, plugsOf, seatOn } from '../format/breadboard.ts'
import { type Rotation, bodyRect, plugPoints } from '../format/geometry.ts'
import { LEAD, layoutModule } from '../format/module.ts'
import { intersects, tightFootprint } from './footprint.ts'

/** The index of the net a pin is in, or undefined when it is in no net. */
export type NetOfPin = (part: string, pin: string) => number | undefined

/**
 * Places part `uid` (already in `d.parts`) on `board`. `d` holds the board and the parts mounted on
 * it so far. Returns the part mounted, or an error naming the part and why no position fits.
 */
export function mountPart(d: Diagram, uid: string, board: string, netOf: NetOfPin): { ok: true; part: PartInstance } | { ok: false; error: string } {
  const me = d.parts.find((p) => p.uid === uid)!
  const m = moduleOf(d, me.module)!
  const b = d.parts.find((p) => p.uid === board)!
  const bm = moduleOf(d, b.module)!
  const others = d.parts.filter((p) => p !== me)
  const plugs = plugsOf({ ...d, parts: others })
  // The net each strip of this board already carries (null: a leg on no net keeps it to itself).
  const stripNet = new Map<string, number | null>()
  for (const pl of plugs) if (pl.board === board) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null)
  const neighbours = others.filter((p) => p.mount?.board === board).map((p) => tightFootprint(p, moduleOf(d, p.module)!))
  const idx = holeIndex(b, bm)
  const area = bodyRect(b, layoutModule(bm))
  const lay = layoutModule(m)
  const reach = Math.max(lay.w, lay.h) + LEAD
  let reason = 'no position puts every leg on a free hole'
  for (const rotation of [0, 90] as Rotation[])
    for (let y = area.y - reach; y <= area.y + area.h; y += 10)
      for (let x = area.x - reach; x <= area.x + area.w; x += 10) {
        const cand: PartInstance = { ...me, x, y, rotation, mount: { board } }
        if (seatOn({ ...d, parts: [...others, cand] }, uid, board, plugs)?.status !== 'seated') continue
        const mine = new Map<string, number | null>()
        let clash = false
        for (const pp of plugPoints(cand, m)) {
          const hit = holeAt(idx, pp.at)!
          const group = idx.groups[hit[0]].name
          const net = netOf(uid, pp.pin) ?? null
          for (const prior of [stripNet.get(group), mine.get(group)])
            if (prior !== undefined && (prior === null || net === null || prior !== net)) clash = true
          if (clash) break
          mine.set(group, net)
        }
        if (clash) {
          reason = 'every position where its legs fit would join two different nets in one strip'
          continue
        }
        const fp = tightFootprint(cand, m)
        if (neighbours.some((r) => intersects(r, fp))) {
          reason = 'every position where its legs fit overlaps another part on the board'
          continue
        }
        return { ok: true, part: cand }
      }
  return { ok: false, error: `${b.designator} has no place for ${me.designator} (${m.id}): ${reason}.` }
}
```

- [ ] **Step 5: Implement placement**

Create `src/agent/place.ts`:

```ts
// Placement (agent toolkit spec 2.1): every part gets a position on the 10 px grid,
// deterministically. Boards (with the parts mounted on them, mount.ts) and microcontrollers go
// first, near the centre; every other unit goes near what it connects to, heaviest net weight
// first; repeat copies are tiled as one block and groups laid out in rows. Bodies and captions
// never overlap (mounted parts overlap only their own board). Ties always break by ref in natural
// order. Kept positions (`--keep`) stay where they are. Pure.
import { DIAGRAM_FORMAT, type Annotation, type Diagram, type PartInstance } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import type { Pt, Rect, Rotation } from '../format/geometry.ts'
import { isBoard } from '../format/module.ts'
import { annotationRect, wrapNote } from '../render/annotationGeometry.ts'
import { type Intent, terminalKey } from './netlist.ts'
import { type NetOfPin, mountPart } from './mount.ts'
import { RectIndex, footprint, grow, shift, tightFootprint, union } from './footprint.ts'
import { naturalCompare } from './order.ts'

export interface Keep {
  x: number
  y: number
  rotation: Rotation
}
export type KeepMap = Map<string, Keep>
export interface PlaceOptions {
  /** Least gap, in px, between the footprints of two placed units (grows on each retry). */
  spacing: number
  keep?: KeepMap
}
export type PlaceResult = { ok: true; parts: PartInstance[]; annotations: Annotation[] } | { ok: false; errors: string[] }

/** Step of the ring search, in px. */
const STEP = 20
/** Widest a group's row of parts grows before it wraps, in px. */
const GROUP_ROW = 640
/** Space between a frame and the parts inside it. */
const FRAME_PAD = 12
/** Where the content's top-left lands once placed (no kept parts). */
const MARGIN = 40

const snap = (v: number) => Math.round(v / 10) * 10
const floor10 = (v: number) => Math.floor(v / 10) * 10
const ceil10 = (v: number) => Math.ceil(v / 10) * 10

interface Unit {
  key: string
  refs: string[]
  anchor: boolean
  fixed: boolean
}

/** Ring r around (0, 0), in a fixed order: top edge left to right, right edge down, bottom edge right to left, left edge up. */
function ring(r: number): Pt[] {
  if (r === 0) return [{ x: 0, y: 0 }]
  const out: Pt[] = []
  for (let x = -r; x <= r; x++) out.push({ x, y: -r })
  for (let y = -r + 1; y <= r; y++) out.push({ x: r, y })
  for (let x = r - 1; x >= -r; x--) out.push({ x, y: r })
  for (let y = r - 1; y > -r; y--) out.push({ x: -r, y })
  return out
}

/** The first offset near `want` (both multiples of 10) where `box` grown by `gap` clears everything in `taken`. */
function findSpot(box: Rect, want: Pt, taken: RectIndex, gap: number): Pt {
  for (let r = 0; ; r++)
    for (const o of ring(r)) {
      const at = { x: want.x + o.x * STEP, y: want.y + o.y * STEP }
      if (!taken.hits(grow(shift(box, at.x, at.y), gap))) return at
    }
}

export function placeParts(intent: Intent, opts: PlaceOptions): PlaceResult {
  const keep = opts.keep ?? new Map<string, Keep>()
  const mods = intent.modules
  const inst = new Map<string, PartInstance>()
  for (const p of intent.parts) inst.set(p.ref, { uid: p.ref, designator: p.ref, module: p.module, x: 0, y: 0, rotation: 0, ...(p.values ? { values: p.values } : {}) })
  const modOf = (ref: string) => mods[inst.get(ref)!.module]
  const fp = (ref: string) => footprint(inst.get(ref)!, modOf(ref))
  const tight = (ref: string) => tightFootprint(inst.get(ref)!, modOf(ref))
  const move = (refs: string[], dx: number, dy: number) => {
    for (const r of refs) {
      const p = inst.get(r)!
      inst.set(r, { ...p, x: p.x + dx, y: p.y + dy })
    }
  }
  const pinNet = new Map<string, number>()
  const netsOf = new Map<string, Set<number>>()
  intent.nets.forEach((n, i) =>
    n.terminals.forEach((t) => {
      pinNet.set(terminalKey(t.ref, t.name), i)
      netsOf.set(t.ref, (netsOf.get(t.ref) ?? new Set<number>()).add(i))
    }),
  )
  const netOfPin: NetOfPin = (part, pin) => pinNet.get(terminalKey(part, pin))
  const refs = intent.parts.map((p) => p.ref).sort(naturalCompare)
  const units: Unit[] = []
  const grouped = new Set<string>()

  // Each board with the parts mounted on it. A kept board stays put; a mounted part keeps its kept
  // spot only while it is still seated there, else it is searched for again.
  for (const ref of refs) {
    if (!isBoard(modOf(ref))) continue
    const k = keep.get(ref)
    if (k) inst.set(ref, { ...inst.get(ref)!, ...k })
    let local: Diagram = { format: DIAGRAM_FORMAT, title: '', modules: mods, parts: [inst.get(ref)!], connections: [] }
    const mounted = intent.parts.filter((q) => q.on === ref).map((q) => q.ref).sort(naturalCompare)
    for (const m of mounted) {
      const km = keep.get(m)
      if (k && km) {
        const trial: PartInstance = { ...inst.get(m)!, ...km, mount: { board: ref } }
        const tried: Diagram = { ...local, parts: [...local.parts, trial] }
        if (!mountIssues(tried).some((i) => i.part === m)) {
          inst.set(m, trial)
          local = tried
          continue
        }
      }
      const r = mountPart({ ...local, parts: [...local.parts, inst.get(m)!] }, m, ref, netOfPin)
      if (!r.ok) return { ok: false, errors: [r.error] }
      inst.set(m, r.part)
      local = { ...local, parts: [...local.parts, r.part] }
    }
    units.push({ key: ref, refs: [ref, ...mounted], anchor: true, fixed: !!k })
    for (const r of [ref, ...mounted]) grouped.add(r)
  }

  /** Lays refs out left to right from (0, 0), wrapping past `width`; returns their footprint box. */
  const row = (list: string[], width: number): Rect => {
    let x = 0
    let y = 0
    let rowH = 0
    let box: Rect | null = null
    for (const ref of list) {
      const f0 = fp(ref)
      const p = inst.get(ref)!
      if (x > 0 && x + f0.w > width) {
        x = 0
        y += rowH + 10
        rowH = 0
      }
      inst.set(ref, { ...p, x: snap(x + p.x - f0.x), y: snap(y + p.y - f0.y) })
      const f = fp(ref)
      box = box ? union(box, f) : f
      x = f.x + f.w + 10
      rowH = Math.max(rowH, f.h)
    }
    return box ?? { x: 0, y: 0, w: 0, h: 0 }
  }

  // Repeat copies: one row each, tiled in a near-square grid of equal cells.
  if (intent.copies.length) {
    const cells = intent.copies.map((c) => ({ refs: c.refs, box: row(c.refs, Infinity) }))
    const pad = opts.spacing + 2 * FRAME_PAD
    const cw = Math.max(...cells.map((c) => c.box.w)) + pad
    const ch = Math.max(...cells.map((c) => c.box.h)) + pad + 10
    const cols = Math.ceil(Math.sqrt(cells.length))
    cells.forEach((c, i) => move(c.refs, snap((i % cols) * cw - c.box.x), snap(Math.floor(i / cols) * ch - c.box.y)))
    const all = cells.flatMap((c) => c.refs)
    units.push({ key: intent.copies[0].repeat, refs: all, anchor: false, fixed: all.every((r) => keep.has(r)) })
    for (const r of all) grouped.add(r)
  }
  for (const g of intent.groups) {
    const free = g.refs.filter((r) => !grouped.has(r))
    if (!free.length) continue
    row(free, GROUP_ROW)
    units.push({ key: `group ${g.name}`, refs: free, anchor: free.some((r) => modOf(r).category === 'Microcontrollers'), fixed: free.every((r) => keep.has(r)) })
    for (const r of free) grouped.add(r)
  }
  for (const ref of refs) {
    if (grouped.has(ref)) continue
    row([ref], Infinity)
    units.push({ key: ref, refs: [ref], anchor: modOf(ref).category === 'Microcontrollers', fixed: keep.has(ref) })
  }
  for (const u of units)
    if (u.fixed)
      for (const r of u.refs) {
        const k = keep.get(r)
        if (k && !inst.get(r)!.mount) inst.set(r, { ...inst.get(r)!, ...k })
      }

  // Fixed units first, then anchors near the centre, then the rest by net weight.
  const taken = new RectIndex()
  const placedNets = new Map<number, Pt[]>()
  const boxOf = (u: Unit) => u.refs.map(fp).reduce(union)
  const netsOfUnit = (u: Unit) => new Set(u.refs.flatMap((r) => [...(netsOf.get(r) ?? [])]))
  const put = (u: Unit) => {
    const b = boxOf(u)
    taken.add(b)
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    for (const n of netsOfUnit(u)) placedNets.set(n, [...(placedNets.get(n) ?? []), c])
  }
  const settle = (u: Unit, target: Pt) => {
    const b = boxOf(u)
    const at = findSpot(b, { x: snap(target.x - b.x - b.w / 2), y: snap(target.y - b.y - b.h / 2) }, taken, opts.spacing)
    move(u.refs, at.x, at.y)
    put(u)
  }
  for (const u of units) if (u.fixed) put(u)
  for (const u of units.filter((x) => !x.fixed && x.anchor).sort((a, b) => naturalCompare(a.key, b.key))) settle(u, { x: 0, y: 0 })
  let rest = units.filter((x) => !x.fixed && !x.anchor)
  while (rest.length) {
    let best = rest[0]
    let bestWeight = -1
    for (const u of rest) {
      const w = [...netsOfUnit(u)].filter((n) => placedNets.has(n)).length
      if (w > bestWeight || (w === bestWeight && naturalCompare(u.key, best.key) < 0)) {
        best = u
        bestWeight = w
      }
    }
    const pts = [...netsOfUnit(best)].flatMap((n) => placedNets.get(n) ?? [])
    settle(best, pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : { x: 0, y: 0 })
    rest = rest.filter((u) => u !== best)
  }

  // Frames around each group and each copy, then notes below their target.
  const annotations: Annotation[] = []
  const frames = new Map<string, Annotation>()
  const frameOf = (list: string[], label: string) => {
    const r = grow(list.map(tight).reduce(union), FRAME_PAD)
    const x = floor10(r.x)
    const y = floor10(r.y)
    const a: Annotation = { uid: `a${annotations.length + 1}`, type: 'frame', x, y, w: ceil10(r.x + r.w) - x, h: ceil10(r.y + r.h) - y, label }
    annotations.push(a)
    return a
  }
  for (const g of intent.groups) if (g.refs.length) frames.set(g.name, frameOf(g.refs, g.name))
  for (const c of intent.copies) frameOf(c.refs, `${c.repeat} ${c.index}`)
  const clear = new RectIndex()
  for (const r of refs) clear.add(tight(r))
  for (const a of annotations) clear.add(annotationRect(a))
  for (const n of intent.notes) {
    const frame = frames.get(n.near)
    const target = frame ? annotationRect(frame) : tight(n.near)
    const probe: Annotation = { uid: `a${annotations.length + 1}`, type: 'text', x: 0, y: 0, text: wrapNote(n.text) }
    const at = findSpot(annotationRect(probe), { x: snap(target.x), y: snap(target.y + target.h + 10) }, clear, 6)
    const note = { ...probe, x: at.x, y: at.y }
    annotations.push(note)
    clear.add(annotationRect(note))
  }

  // Content to the sheet origin, unless something was kept where it was.
  let out = annotations
  const rects = [...refs.map(fp), ...annotations.map(annotationRect)]
  if (!keep.size && rects.length) {
    const all = rects.reduce(union)
    const dx = ceil10(MARGIN - all.x)
    const dy = ceil10(MARGIN - all.y)
    move(refs, dx, dy)
    out = annotations.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }))
  }
  return { ok: true, parts: intent.parts.map((p) => inst.get(p.ref)!), annotations: out }
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/agent/place.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/agent/footprint.ts src/agent/mount.ts src/agent/place.ts src/agent/fixtures.testing.ts src/agent/place.test.ts
git commit -m "Agent toolkit: deterministic placement with breadboard mounting, frames and notes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Net realization, readability report and `layoutNetlist`

Turns the intent's nets into wires on the placed sheet (spec 2.2: legs share strips, one wire end per pin or hole, distribution through strips and rails, capacity, `routing: true`), routes with the existing router, retries with more spacing when a route is blocked, and reports readability (spec 2.3). The output sheet embeds its modules and stores the netlist as `intent`.

**Files:**
- Create: `src/agent/realize.ts`, `src/agent/readability.ts`, `src/agent/layout.ts`
- Test: `src/agent/layout.test.ts`

**Interfaces:**
- Consumes: `Intent`, `Terminal`, `terminalKey`, `terminalName`, `parseNetlist`, `ModuleLookup` (Task 3); `libraryLookup` (Task 3); `internalComponent` (Task 4); `placeParts`, `KeepMap` (Task 6); `tightFootprint`, `intersects`, `union` (Task 6); `captionBox` (Task 5); `terminalCapacity` (Task 1); `computeRoutes`, `resolveEndpoint`, `Routes` (diagram.ts); `plugsOf` (breadboard.ts); `worldHoles` (geometry.ts); `normalizeEnds` (cables.ts); `verifyDiagram` (Task 4, test only).
- Produces:
  - `src/agent/realize.ts`: `interface Realization { connections: Connection[]; netOfWire: Map<string, string> }`, `realize(intent: Intent, d: Diagram): { ok: true; value: Realization } | { ok: false; errors: string[] }`
  - `src/agent/readability.ts`: `interface ReadabilityReport { bodyOverlaps: number; captionOverlaps: number; wireCrossings: number; wireLength: number; sheet: { w: number; h: number }; blockedNets: string[] }`, `readability(d: Diagram, routes: Routes, netOfWire?: Map<string, string>): ReadabilityReport`, `reportText(r: ReadabilityReport): string`
  - `src/agent/layout.ts`: `SPACINGS = [20, 40, 60]`, `interface LayoutOutput { diagram: Diagram; report: ReadabilityReport; intent: Intent; attempts: number; netOfWire: Map<string, string> }`, `type LayoutResult = { ok: true; value: LayoutOutput } | { ok: false; stage: 'input' | 'layout'; errors: string[] }`, `layoutNetlist(raw: unknown, opts?: { library?: ModuleLookup; keep?: KeepMap }): LayoutResult`

- [ ] **Step 1: Write the failing test**

Create `src/agent/layout.test.ts`:

```ts
// layoutNetlist end to end (spec 2): a sheet the site loads, that verifies clean against its intent,
// deterministic, with routing flags, one end per hole, distribution points, capacity chains and
// internally joined pins wired as one.
import { describe, expect, it } from 'vitest'
import { type Diagram, serializeDiagram, validateDiagram } from '../format/diagram.ts'
import { mountIssues, plugsOf } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { verifyDiagram } from './verify.ts'
import { ledNetlist, tiltSensors } from './fixtures.testing.ts'

const laid = (raw: unknown): Diagram => {
  const r = layoutNetlist(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value.diagram
}
const esp = (extra: Record<string, unknown>[] = []) => ({
  format: 'circuitoon-netlist/1',
  title: 'Three sensors',
  parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }, { ref: 'U4', module: 'bme280-module-4pin' }, ...extra],
  nets: [
    { name: '3V3', pins: ['U1.3V3', 'U2.VIN', 'U3.VIN', 'U4.VIN'] },
    { name: 'GND', pins: ['U1.GND', 'U2.GND', 'U3.GND', 'U4.GND'] },
    { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
    { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
  ],
})

describe('layoutNetlist', () => {
  it('lays out the spec LED example into a sheet the site loads and that verifies clean', () => {
    const r = layoutNetlist(ledNetlist())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const d = r.value.diagram
    expect(validateDiagram(JSON.parse(serializeDiagram(d))).ok).toBe(true)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    expect(mountIssues(d)).toEqual([])
    expect(d.intent).toEqual(ledNetlist())
    expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
    expect(d.connections.every((c) => c.color && c.ends?.from === 'dupont-male')).toBe(true)
  })
  it('is deterministic', () => {
    expect(serializeDiagram(laid(ledNetlist()))).toBe(serializeDiagram(laid(ledNetlist())))
    expect(serializeDiagram(laid(tiltSensors()))).toBe(serializeDiagram(laid(tiltSensors())))
  })
  it('marks what it adds for strips as routing, and wires two pins straight when nothing else is needed', () => {
    const led = laid(ledNetlist())
    for (const c of led.connections) {
      const toHole = [c.from, c.to].some((e) => e.hole !== undefined)
      expect(c.routing === true, c.uid).toBe(toHole)
    }
    const pair = laid({ ...esp(), nets: esp().nets.slice(2) })
    expect(pair.connections.map((c) => c.routing)).toEqual([undefined, undefined])
  })
  it('never puts two wire ends in one hole, nor a wire in a hole a leg fills', () => {
    for (const d of [laid(ledNetlist()), laid(tiltSensors())]) {
      const ends = d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.hole !== undefined).map((e) => `${e.part} ${e.pin} ${e.hole}`)
      expect(new Set(ends).size).toBe(ends.length)
      const legs = new Set(plugsOf(d).map((p) => `${p.board} ${p.group} ${p.hole}`))
      expect(ends.filter((e) => legs.has(e))).toEqual([])
    }
  })
  it('asks for a distribution point when a net has more ends than its pins take, and uses a rail when there is one', () => {
    const r = layoutNetlist(esp())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.stage).toBe('layout')
      expect(r.errors.some((e) => e.startsWith('needs a distribution point: net 3V3 joins 4 pins'))).toBe(true)
    }
    const d = laid(esp([{ ref: 'RAIL1', module: 'power-rail-strip' }]))
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
    expect(d.connections.filter((c) => [c.from, c.to].some((e) => e.part === 'RAIL1' && e.pin === '+')).length).toBe(4)
  })
  it('chains through a terminal that takes two wire ends', () => {
    const d = laid({
      format: 'circuitoon-netlist/1',
      title: 'Terminal',
      modules: { 'terminal-2': { format: 'circuitoon-module/1', id: 'terminal-2', name: 'Two-wire terminal', pins: [{ name: 'T', side: 'left', type: 'passive', capacity: 2 }] } },
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'X1', module: 'terminal-2' }],
      nets: [{ name: 'GND', pins: ['U1.GND', 'X1.T', 'U2.GND'] }],
    })
    expect(d.connections).toHaveLength(2)
    expect(d.connections.every((c) => [c.from, c.to].some((e) => e.part === 'X1'))).toBe(true)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('wires pins a part joins inside itself as one node (a charger\'s B- and 5V-)', () => {
    const d = laid({
      format: 'circuitoon-netlist/1',
      title: 'Battery board with a switch',
      parts: [{ ref: 'BT1', module: 'battery-18650-holder' }, { ref: 'U1', module: 'ip5306-usbc-module' }, { ref: 'S1', module: 'rocker-switch-kcd1' }, { ref: 'U2', module: 'esp32-devkitc-v4' }],
      nets: [
        { name: 'BAT', pins: ['BT1.+', 'U1.B+'] },
        { name: 'GND', pins: ['BT1.-', 'U1.B-', 'U1.5V-', 'U2.GND'] },
        { name: 'VSW', pins: ['U1.5V+', 'S1.1'] },
        { name: '5V', pins: ['S1.2', 'U2.5V'] },
      ],
    })
    expect(d.connections.filter((c) => c.color === 'black')).toHaveLength(2)
    expect(verifyDiagram(d, libraryLookup)).toEqual([])
  })
  it('refuses an invalid netlist at the input stage', () => {
    const r = layoutNetlist({ format: 'circuitoon-netlist/1', title: 'x', parts: [], nets: [{ name: 'A', pins: ['Q.1', 'Q.2'] }] })
    expect(r).toMatchObject({ ok: false, stage: 'input' })
  })
  it('stores the intent, so a later hand edit (moving the VCC wire onto the ground strip) is caught', () => {
    const r = layoutNetlist(ledNetlist())
    if (!r.ok) throw new Error(r.errors.join('
'))
    const d = r.value.diagram
    const wireOf = (net: string) => d.connections.find((c) => r.value.netOfWire.get(c.uid) === net && [c.from, c.to].some((e) => e.part === 'BT1'))!
    const vcc = wireOf('VCC')
    const gnd = wireOf('GND')
    const gndHole = [gnd.from, gnd.to].find((e) => e.hole !== undefined)!
    const inStrip = [...d.connections.flatMap((c) => [c.from, c.to]), ...plugsOf(d).map((p) => ({ part: p.board, pin: p.group, hole: p.hole }))]
      .filter((e) => e.part === gndHole.part && e.pin === gndHole.pin)
      .map((e) => e.hole)
    const hole = [0, 1, 2, 3, 4].find((h) => !inStrip.includes(h))!
    vcc[vcc.from.part === 'BT1' ? 'to' : 'from'] = { part: gndHole.part, pin: gndHole.pin, hole }
    expect(verifyDiagram(d, libraryLookup).map((f) => f.rule)).toContain('merge')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/layout.test.ts`
Expected: FAIL: cannot resolve `./layout.ts`.

- [ ] **Step 3: Implement realization**

Create `src/agent/realize.ts`:

```ts
// Turning intent nets into wires on a placed sheet (agent toolkit spec 2.2). Pins a part joins
// inside itself are one node, taking as many wire ends as their capacities add up to. Two nodes get
// one direct wire; more nodes chain through nodes that take two ends; otherwise every node is wired
// to the net's strips: strips named in the net, strips its mounted legs sit in, or a free strip the
// layout claims (ground nets a - rail first, power nets a + rail, signal nets column strips only),
// joined to each other by jumpers. Each strip keeps one hole in reserve until the net's last node,
// so a full strip can be extended to a claimed strip by a jumper; "strip full" otherwise. Never two
// wire ends in one hole, never a wire into a leg's hole, and everything added for a strip is
// `routing: true`. Pure.
import { type Connection, type Diagram, type Endpoint, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { plugsOf } from '../format/breadboard.ts'
import { type Pt, worldHoles } from '../format/geometry.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { normalizeEnds } from '../format/cables.ts'
import { type Intent, type IntentNet, type Terminal, terminalKey, terminalName } from './netlist.ts'
import { internalComponent } from './internal.ts'
import { naturalCompare } from './order.ts'

export interface Realization {
  connections: Connection[]
  /** Wire uid to the name of the net it realizes. */
  netOfWire: Map<string, string>
}

type NetKind = 'ground' | 'power' | 'signal'
const SIGNAL_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple', 'white', 'brown', 'pink', 'gray']

interface Strip {
  key: string
  board: string
  name: string
  rail?: '+' | '-'
  holes: Pt[]
}
interface Node {
  members: Terminal[]
  /** Wire ends each member still takes. */
  left: Map<string, number>
}

const groupKey = (board: string, group: string) => JSON.stringify([board, group])
const holeKey = (board: string, group: string, hole: number) => JSON.stringify([board, group, hole])
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

function typeOf(m: ModuleDef, name: string): string | undefined {
  const pin = m.pins.find((p): p is PinDef => !isSpacer(p) && p.name === name)
  return pin ? pin.type : m.holes?.find((g) => g.name === name)?.type
}

export function realize(intent: Intent, d: Diagram): { ok: true; value: Realization } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const plugs = plugsOf(d)
  const partBy = new Map(d.parts.map((p) => [p.uid, p]))
  const modOf = (ref: string) => moduleOf(d, partBy.get(ref)!.module)!
  const used = new Set(plugs.map((pl) => holeKey(pl.board, pl.group, pl.hole)))
  const legBy = new Map(plugs.map((pl) => [terminalKey(pl.part, pl.pin), pl]))
  const netOfTerminal = new Map<string, number>()
  intent.nets.forEach((n, i) => n.terminals.forEach((t) => netOfTerminal.set(terminalKey(t.ref, t.name), i)))

  // Every strip and rail on the sheet, boards in natural ref order.
  const strips = new Map<string, Strip>()
  for (const p of [...d.parts].sort((a, b) => naturalCompare(a.uid, b.uid))) {
    const m = moduleOf(d, p.module)
    if (!m || !isBoard(m)) continue
    for (const g of worldHoles(p, m)) strips.set(groupKey(p.uid, g.name), { key: groupKey(p.uid, g.name), board: p.uid, name: g.name, rail: g.rail, holes: g.at })
  }
  const owner = new Map<string, number>()
  const reserved = new Set<string>()
  for (const pl of plugs) {
    const ni = netOfTerminal.get(terminalKey(pl.part, pl.pin))
    if (ni === undefined) reserved.add(groupKey(pl.board, pl.group))
    else owner.set(groupKey(pl.board, pl.group), ni)
  }
  const preferred = new Map<string, number>()
  intent.nets.forEach((n, i) => {
    for (const t of n.terminals) {
      if (!t.infra) continue
      const g = groupKey(t.ref, t.name)
      const was = owner.get(g)
      if (reserved.has(g)) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg on no net sits in that strip`)
      else if (was !== undefined && was !== i) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg of net ${intent.nets[was].name} sits in that strip`)
      else owner.set(g, i)
      if (t.hole !== undefined) preferred.set(g, t.hole)
    }
  })
  if (errors.length) return { ok: false, errors }

  const free = (s: Strip) => s.holes.flatMap((_, i) => (used.has(holeKey(s.board, s.name, i)) ? [] : [i]))
  const nearestHole = (s: Strip, at: Pt): number | null => {
    const pref = preferred.get(s.key)
    if (pref !== undefined && !used.has(holeKey(s.board, s.name, pref))) return pref
    let best: number | null = null
    for (const i of free(s)) if (best === null || dist(s.holes[i], at) < dist(s.holes[best], at)) best = i
    return best
  }
  const stripName = (s: Strip) => `${s.board} ${s.name}`
  const pinEnd = (t: Terminal): Endpoint => (modOf(t.ref).holes?.some((g) => g.name === t.name) ? { part: t.ref, pin: t.name, hole: t.hole ?? 0 } : { part: t.ref, pin: t.name })
  const pointOf = (ep: Endpoint): Pt => resolveEndpoint(d, ep)!.end
  const kindOf = (n: IntentNet): NetKind => {
    const types = n.terminals.filter((t) => !t.infra).map((t) => typeOf(modOf(t.ref), t.name))
    return types.includes('ground') ? 'ground' : types.some((t) => t === 'power_in' || t === 'power_out') ? 'power' : 'signal'
  }

  const connections: Connection[] = []
  const netOfWire = new Map<string, string>()
  const ends = intent.ends ? normalizeEnds({ from: intent.ends, to: intent.ends }) : undefined
  let signal = 0
  const colors = intent.nets.map((n) => {
    const kind = kindOf(n)
    return n.color ?? (kind === 'ground' ? 'black' : kind === 'power' ? 'red' : SIGNAL_COLORS[signal++ % SIGNAL_COLORS.length])
  })
  const wire = (ni: number, from: Endpoint, to: Endpoint, routing: boolean) => {
    const uid = `w${connections.length + 1}`
    connections.push({ uid, from, to, color: colors[ni], gauge: 22, ...(ends ? { ends } : {}), ...(routing ? { routing: true } : {}) })
    netOfWire.set(uid, intent.nets[ni].name)
  }
  const holeEnd = (s: Strip, i: number): Endpoint => {
    used.add(holeKey(s.board, s.name, i))
    return { part: s.board, pin: s.name, hole: i }
  }
  /** The member of `node` with an end left, nearest `toward`; takes that end. */
  const take = (node: Node, toward: Pt): Endpoint => {
    let best: Terminal | null = null
    for (const t of node.members) {
      if (!node.left.get(t.name)) continue
      if (!best || dist(pointOf(pinEnd(t)), toward) < dist(pointOf(pinEnd(best)), toward)) best = t
    }
    node.left.set(best!.name, node.left.get(best!.name)! - 1)
    return pinEnd(best!)
  }
  const capOf = (n: Node) => [...n.left.values()].reduce((a, b) => a + b, 0)
  const claim = (ni: number, at: Pt, kind: NetKind, board?: string): Strip | null => {
    const rank = (s: Strip) => (kind === 'ground' ? (s.rail === '-' ? 0 : s.rail ? -1 : 1) : kind === 'power' ? (s.rail === '+' ? 0 : s.rail ? -1 : 1) : s.rail ? -1 : 0)
    let best: Strip | null = null
    let bestRank = 0
    let bestDist = 0
    for (const s of strips.values()) {
      const r = rank(s)
      if (r < 0 || owner.has(s.key) || reserved.has(s.key) || (board !== undefined && s.board !== board) || free(s).length !== s.holes.length) continue
      const dd = dist(s.holes[0], at)
      if (!best || r < bestRank || (r === bestRank && dd < bestDist)) {
        best = s
        bestRank = r
        bestDist = dd
      }
    }
    if (best) owner.set(best.key, ni)
    return best
  }
  const jumper = (ni: number, a: Strip, b: Strip): boolean => {
    let pick: [number, number, number] | null = null
    for (const i of free(a)) for (const j of free(b)) {
      const dd = dist(a.holes[i], b.holes[j])
      if (!pick || dd < pick[2]) pick = [i, j, dd]
    }
    if (!pick) return false
    wire(ni, holeEnd(a, pick[0]), holeEnd(b, pick[1]), true)
    return true
  }
  const nearestDp = (dps: Strip[], at: Pt, room: number): Strip | null => {
    let best: Strip | null = null
    let bestDist = 0
    for (const s of dps) {
      const f = free(s)
      if (f.length < room) continue
      const dd = Math.min(...f.map((i) => dist(s.holes[i], at)))
      if (!best || dd < bestDist) {
        best = s
        bestDist = dd
      }
    }
    return best
  }

  for (const [ni, net] of intent.nets.entries()) {
    const kind = kindOf(net)
    const dps: Strip[] = []
    const addDp = (s: Strip | undefined) => {
      if (s && !dps.includes(s)) dps.push(s)
    }
    for (const t of net.terminals) if (t.infra) addDp(strips.get(groupKey(t.ref, t.name)))
    const legStrips = net.terminals.flatMap((t) => {
      const pl = legBy.get(terminalKey(t.ref, t.name))
      return pl ? [groupKey(pl.board, pl.group)] : []
    })
    for (const k of [...new Set(legStrips)].sort(naturalCompare)) addDp(strips.get(k))
    // Loose pins (not plugged, not strips), one node per part-internal component, in natural order.
    const byComp = new Map<string, Terminal[]>()
    for (const t of net.terminals) {
      if (t.infra || legBy.has(terminalKey(t.ref, t.name))) continue
      const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`
      byComp.set(c, [...(byComp.get(c) ?? []), t])
    }
    const nodes: Node[] = [...byComp.keys()].sort(naturalCompare).map((c) => {
      const members = byComp.get(c)!
      return { members, left: new Map(members.map((t) => [t.name, terminalCapacity(modOf(t.ref), t.name)])) }
    })
    const first = (n: Node) => pointOf(pinEnd(n.members[0]))

    if (!dps.length) {
      if (nodes.length < 2) continue
      const wide = nodes.filter((n) => capOf(n) >= 2)
      if (nodes.length === 2 || wide.length >= nodes.length - 2) {
        const inner = nodes.length === 2 ? [] : wide.slice(0, nodes.length - 2)
        const outer = nodes.filter((n) => !inner.includes(n))
        const chain = [outer[0], ...inner, outer[1]]
        for (let k = 1; k < chain.length; k++) {
          const a = take(chain[k - 1], first(chain[k]))
          wire(ni, a, take(chain[k], pointOf(a)), false)
        }
        continue
      }
      const pts = nodes.map(first)
      const center = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
      const s = claim(ni, center, kind)
      if (!s) {
        errors.push(`needs a distribution point: net ${net.name} joins ${nodes.length} pins (${nodes.map((n) => terminalName(n.members[0])).join(', ')}), but a header pin takes one wire. Add a breadboard, a rail strip or a terminal block to the netlist.`)
        continue
      }
      dps.push(s)
    }

    // Join the strips: the nearest pair of free holes first (Prim).
    const joined = [dps[0]]
    const rest = dps.slice(1)
    let full = false
    while (rest.length && !full) {
      let pick: [Strip, Strip, number] | null = null
      for (const a of joined)
        for (const b of rest) {
          const fa = free(a)
          const fb = free(b)
          if (!fa.length || !fb.length) continue
          const dd = Math.min(...fa.flatMap((i) => fb.map((j) => dist(a.holes[i], b.holes[j]))))
          if (!pick || dd < pick[2]) pick = [a, b, dd]
        }
      if (!pick || !jumper(ni, pick[0], pick[1])) full = true
      else {
        joined.push(pick[1])
        rest.splice(rest.indexOf(pick[1]), 1)
      }
    }
    if (full) {
      errors.push(`strip full: net ${net.name} cannot join ${rest.map(stripName).join(', ')}: no free hole left`)
      continue
    }

    // One wire from every node to the nearest strip with room, extending a full strip by a jumper.
    for (const [k, node] of nodes.entries()) {
      const at = first(node)
      const room = k === nodes.length - 1 ? 1 : 2
      let target = nearestDp(dps, at, room)
      while (!target) {
        const from = nearestDp(dps, at, 1)
        const ext = from && (claim(ni, from.holes[0], kind, from.board) ?? claim(ni, at, kind))
        if (!from || !ext || !jumper(ni, from, ext)) break
        dps.push(ext)
        target = nearestDp(dps, at, room)
      }
      if (!target) {
        errors.push(`strip full: net ${net.name} has no free hole left on ${dps.map(stripName).join(', ')}`)
        break
      }
      const e = take(node, at)
      wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))!), true)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { connections, netOfWire } }
}
```

- [ ] **Step 4: Implement the readability report**

Create `src/agent/readability.ts`:

```ts
// The readability report every layout prints (agent toolkit spec 2.3): body overlaps and caption
// overlaps (both must be 0; a mounted part may overlap only its own board), wire crossings, total
// wire length, sheet size and blocked nets (must be none). Pure.
import { type Diagram, type PartInstance, type Routes, moduleOf } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { captionBox } from '../render/captionBox.ts'
import { intersects, union } from './footprint.ts'
import { naturalCompare } from './order.ts'

export interface ReadabilityReport {
  bodyOverlaps: number
  captionOverlaps: number
  wireCrossings: number
  /** Sum of every routed wire's length, in px. */
  wireLength: number
  sheet: { w: number; h: number }
  blockedNets: string[]
}

export function readability(d: Diagram, routes: Routes, netOfWire: Map<string, string> = new Map()): ReadabilityReport {
  const parts = d.parts.filter((p) => moduleOf(d, p.module))
  const body = (p: PartInstance) => bodyRect(p, layoutModule(moduleOf(d, p.module)!))
  const caption = (p: PartInstance) => captionBox(p, moduleOf(d, p.module)!)
  const own = (a: PartInstance, b: PartInstance) => a.mount?.board === b.uid || b.mount?.board === a.uid
  let bodyOverlaps = 0
  let captionOverlaps = 0
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const [a, b] = [parts[i], parts[j]]
      if (!own(a, b) && intersects(body(a), body(b))) bodyOverlaps++
      if (intersects(caption(a), caption(b))) captionOverlaps++
    }
  for (const a of parts) for (const b of parts) if (a !== b && !own(a, b) && intersects(caption(a), body(b))) captionOverlaps++

  const segs: { wire: number; h: boolean; at: number; lo: number; hi: number }[] = []
  let wireLength = 0
  const points: Pt[] = []
  ;[...routes.values()].forEach((r, wire) => {
    if (!r) return
    points.push(...r.points)
    for (let k = 1; k < r.points.length; k++) {
      const [a, b] = [r.points[k - 1], r.points[k]]
      wireLength += Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (a.y === b.y && a.x !== b.x) segs.push({ wire, h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
      else if (a.x === b.x && a.y !== b.y) segs.push({ wire, h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
    }
  })
  let wireCrossings = 0
  const hs = segs.filter((s) => s.h)
  const vs = segs.filter((s) => !s.h)
  for (const h of hs) for (const v of vs) if (h.wire !== v.wire && v.at > h.lo && v.at < h.hi && h.at > v.lo && h.at < v.hi) wireCrossings++

  const rects: Rect[] = [...parts.flatMap((p) => [body(p), caption(p)]), ...points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))]
  const all = rects.length ? rects.reduce(union) : { x: 0, y: 0, w: 0, h: 0 }
  const blockedNets = [...new Set(d.connections.filter((c) => routes.get(c.uid)?.blocked).map((c) => netOfWire.get(c.uid) ?? c.label ?? c.uid))].sort(naturalCompare)
  return { bodyOverlaps, captionOverlaps, wireCrossings, wireLength: Math.round(wireLength), sheet: { w: Math.ceil(all.w), h: Math.ceil(all.h) }, blockedNets }
}

export function reportText(r: ReadabilityReport): string {
  return `Readability: body overlaps ${r.bodyOverlaps}, caption overlaps ${r.captionOverlaps}, wire crossings ${r.wireCrossings}, wire length ${r.wireLength} px, sheet ${r.sheet.w} x ${r.sheet.h} px, blocked nets ${r.blockedNets.length ? r.blockedNets.join(', ') : 'none'}.`
}
```

- [ ] **Step 5: Implement `layoutNetlist`**

Create `src/agent/layout.ts`:

```ts
// Layout (agent toolkit spec 2): netlist in, sheet out. Parse and check the netlist, place the parts
// (mounting included), realize the nets as wires, route them with the existing router, and when a
// route is blocked try again with more spacing, up to 3 placements; after that fail with the
// blocked nets rather than emit a sheet with blocked wires. The sheet embeds its modules and stores
// the netlist as `intent`, so every later check re-verifies against it. Pure.
import { DIAGRAM_FORMAT, type Diagram, computeRoutes } from '../format/diagram.ts'
import { type Intent, type ModuleLookup, parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { type KeepMap, placeParts } from './place.ts'
import { realize } from './realize.ts'
import { type ReadabilityReport, readability } from './readability.ts'
import { naturalCompare } from './order.ts'

export const SPACINGS = [20, 40, 60]

export interface LayoutOutput {
  diagram: Diagram
  report: ReadabilityReport
  intent: Intent
  /** Which placement succeeded, 1 to SPACINGS.length. */
  attempts: number
  netOfWire: Map<string, string>
}
export type LayoutResult = { ok: true; value: LayoutOutput } | { ok: false; stage: 'input' | 'layout'; errors: string[] }

export function layoutNetlist(raw: unknown, opts: { library?: ModuleLookup; keep?: KeepMap } = {}): LayoutResult {
  const parsed = parseNetlist(raw, opts.library ?? libraryLookup)
  if (!parsed.ok) return { ok: false, stage: 'input', errors: parsed.errors }
  const intent = parsed.intent
  let blocked: string[] = []
  for (const [i, spacing] of SPACINGS.entries()) {
    const placed = placeParts(intent, { spacing, keep: opts.keep })
    if (!placed.ok) return { ok: false, stage: 'layout', errors: placed.errors }
    const base: Diagram = {
      format: DIAGRAM_FORMAT,
      title: intent.title,
      modules: intent.modules,
      parts: placed.parts,
      connections: [],
      ...(placed.annotations.length ? { annotations: placed.annotations } : {}),
      intent: structuredClone(raw),
    }
    const real = realize(intent, base)
    if (!real.ok) return { ok: false, stage: 'layout', errors: real.errors }
    const diagram: Diagram = { ...base, connections: real.value.connections }
    const routes = computeRoutes(diagram)
    blocked = [...new Set(diagram.connections.filter((c) => routes.get(c.uid)?.blocked).map((c) => real.value.netOfWire.get(c.uid)!))].sort(naturalCompare)
    if (!blocked.length)
      return { ok: true, value: { diagram, report: readability(diagram, routes, real.value.netOfWire), intent, attempts: i + 1, netOfWire: real.value.netOfWire } }
  }
  return { ok: false, stage: 'layout', errors: [`routes blocked after ${SPACINGS.length} placements with more spacing each time: ${blocked.join(', ')}`] }
}
```

Key order in the output sheet follows the diagram format: `format, title, modules, parts, connections, annotations, intent` (intent last so the file reads top-down).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/agent`
Expected: PASS. If `captionOverlaps` is not 0 for the LED example because a mounted part's caption crosses another part's body on the board, fix the mount search (Task 6 `neighbours` must hold every mounted part's tight footprint), never the metric.

- [ ] **Step 7: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/agent/realize.ts src/agent/readability.ts src/agent/layout.ts src/agent/layout.test.ts
git commit -m "Agent toolkit: realize nets as wires, readability report, layoutNetlist with retries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Partial re-layout (`circuitoon-partial/1`)

The relaxed loader for `layout --keep partial.json` (spec 2.1): a layout-only partial diagram whose parts may lack coordinates, plus its intent. Parts with coordinates keep them; the rest are placed around them. The site never accepts it (its format differs).

**Files:**
- Create: `src/agent/partial.ts`
- Test: `src/agent/partial.test.ts`

**Interfaces:**
- Consumes: `KeepMap`, `Keep` (Task 6); `layoutNetlist` (Task 7); `validateDiagram` (diagram.ts).
- Produces (`src/agent/partial.ts`): `PARTIAL_FORMAT = 'circuitoon-partial/1'`, `type PartialResult = { ok: true; intent: unknown; keep: KeepMap } | { ok: false; errors: string[] }`, `loadPartial(raw: unknown): PartialResult`

- [ ] **Step 1: Write the failing test**

Create `src/agent/partial.test.ts`:

```ts
// The partial format (spec 2.1 --keep): only intent and part positions are read; kept parts stay put,
// the rest are placed around them; the site refuses the file.
import { describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { loadPartial } from './partial.ts'
import { verifyDiagram } from './verify.ts'
import { ledNetlist } from './fixtures.testing.ts'

const partial = (parts: unknown[]) => ({ format: 'circuitoon-partial/1', title: 'LED', intent: ledNetlist(), parts, connections: [{ uid: 'ignored' }] })

describe('loadPartial', () => {
  it('reads the intent and the parts that have coordinates', () => {
    const r = loadPartial(partial([{ designator: 'BT1', x: 600, y: 300 }, { designator: 'R1' }, { designator: 'BB1', x: 40, y: 40, rotation: 90 }]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.intent).toEqual(ledNetlist())
    expect([...r.keep]).toEqual([
      ['BT1', { x: 600, y: 300, rotation: 0 }],
      ['BB1', { x: 40, y: 40, rotation: 90 }],
    ])
  })
  it('refuses a missing intent, half a position, off-grid positions and a bad rotation', () => {
    const r = loadPartial({ format: 'circuitoon-partial/1', parts: [{ designator: 'A', x: 5 }, { designator: 'B', x: 15, y: 20 }, { designator: 'C', x: 0, y: 0, rotation: 45 }] })
    expect(r).toEqual({
      ok: false,
      errors: [
        'intent: required, the netlist the sheet was laid out from',
        'parts[0]: give both x and y, or neither',
        'parts[1]: x and y must be on the 10 px grid',
        'parts[2].rotation: must be 0, 90, 180 or 270',
      ],
    })
  })
  it('is never a sheet the site opens', () => {
    expect(validateDiagram(partial([{ designator: 'BT1', x: 600, y: 300 }])).ok).toBe(false)
  })
  it('re-lays out around the kept parts: kept positions stay, the rest seat and verify clean', () => {
    const p = loadPartial(partial([{ designator: 'BT1', x: 600, y: 300 }]))
    if (!p.ok) throw new Error(p.errors.join('\n'))
    const r = layoutNetlist(p.intent, { keep: p.keep })
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.diagram.parts.find((x) => x.uid === 'BT1')).toMatchObject({ x: 600, y: 300 })
    expect(mountIssues(r.value.diagram)).toEqual([])
    expect(verifyDiagram(r.value.diagram, libraryLookup)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agent/partial.test.ts`
Expected: FAIL: cannot resolve `./partial.ts`.

- [ ] **Step 3: Implement**

Create `src/agent/partial.ts`:

```ts
// The partial diagram `layout --keep` reads (agent toolkit spec 2.1): the diagram format with part
// coordinates optional, plus its intent. Only `intent` and each part's `designator`, `x`, `y` and
// `rotation` are read; connections are regenerated from the intent. Its own format string
// (circuitoon-partial/1) means the site never opens one. Pure.
import { isNum, isObj } from '../format/module.ts'
import type { Rotation } from '../format/geometry.ts'
import type { KeepMap } from './place.ts'

export const PARTIAL_FORMAT = 'circuitoon-partial/1'
export type PartialResult = { ok: true; intent: unknown; keep: KeepMap } | { ok: false; errors: string[] }

export function loadPartial(raw: unknown): PartialResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['partial must be a JSON object'] }
  if (raw.format !== PARTIAL_FORMAT) errors.push(`format: must be "${PARTIAL_FORMAT}" (copy the sheet, change its format, and delete x and y on the parts to place again)`)
  if (!isObj(raw.intent)) errors.push('intent: required, the netlist the sheet was laid out from')
  const keep: KeepMap = new Map()
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  else
    raw.parts.forEach((p, i) => {
      const at = `parts[${i}]`
      if (!isObj(p) || typeof p.designator !== 'string') return void errors.push(`${at}.designator: required`)
      if (p.x === undefined && p.y === undefined) return
      if (!isNum(p.x) || !isNum(p.y)) return void errors.push(`${at}: give both x and y, or neither`)
      if (p.x % 10 !== 0 || p.y % 10 !== 0) return void errors.push(`${at}: x and y must be on the 10 px grid`)
      const rotation = p.rotation ?? 0
      if (![0, 90, 180, 270].includes(rotation as number)) return void errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
      keep.set(p.designator, { x: p.x, y: p.y, rotation: rotation as Rotation })
    })
  return errors.length ? { ok: false, errors } : { ok: true, intent: raw.intent, keep }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/agent/partial.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate**

```bash
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/partial.ts src/agent/partial.test.ts
git commit -m "Agent toolkit: circuitoon-partial/1 loader for layout --keep

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The CLI bundle, `bin/circuitoon.mjs`, and `parts`, `part`, `layout`

Builds the CLI into one committed ES module that runs with plain Node 22+ from a copy of the plugin folder, wires it into `check:gen`, and ships the first commands with their JSON schemas.

**Files:**
- Create: `vite.cli.config.ts`, `scripts/gen-cli.mjs`, `.gitattributes`, `plugin/bin/circuitoon.mjs`, `plugin/dist-cli/circuitoon.mjs` (generated)
- Create: `src/cli/io.ts`, `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/parts.ts`, `src/cli/layoutCmd.ts`, `src/cli/cliHarness.testing.ts`, `src/cli/jsonSchema.testing.ts`
- Create: `plugin/skills/circuitoon-design/references/schemas/parts.schema.json`, `part.schema.json`, `layout.schema.json`
- Modify: `package.json` (scripts), `tsconfig.json` (include), `scripts/check-gen.test.ts` (timeout)
- Test: `src/cli/cli.test.ts`, `src/cli/bundle.test.ts`

**Interfaces:**
- Consumes: `layoutNetlist` (Task 7), `loadPartial` (Task 8), `KeepMap` (Task 6), `reportText` (Task 7), `quantities`, `channelTable`, `quantitiesText`, `channelsText` (Task 3), `naturalCompare` (Task 3), `library` (src/library.ts), `terminalCapacity` (Task 1), `serializeDiagram`, `validateDiagram` (diagram.ts), `emit`, `log`, `finish`, `CHECK` (scripts/lib/gen-output.mjs), `ledNetlist` (Task 6, tests).
- Produces:
  - `src/cli/io.ts`: `EXIT = { ok: 0, blocked: 1, input: 2, environment: 3 }`, `interface Io { stdout(text: string): void; stderr(text: string): void; cwd: string; env: Record<string, string | undefined> }`, `class CliError extends Error { code: number }`, `pathIn(io, path): string`, `readJson(io, path): unknown`, `writeFile(io, path, content: string | Uint8Array): void`, `printJson(io, value): void`, `flag(args, name): string | undefined`, `loadSheet(io, path): { diagram: Diagram; warnings: string[] }`
  - `src/cli/args.ts`: `interface Args { command?: string; positionals: string[]; flags: Map<string, string | true> }`, `parseArgs(argv: string[]): { ok: true; value: Args } | { ok: false; error: string }`
  - `src/cli/main.ts`: `USAGE`, `type Command = (args: Args, io: Io) => number | Promise<number>`, `COMMANDS: Record<string, Command>`, `main(argv: string[], io: Io): Promise<number>`, `run(argv: string[]): Promise<number>`
  - `src/cli/parts.ts`: `partSummary(m: ModuleDef)`, `partsCommand`, `partCommand`
  - `src/cli/layoutCmd.ts`: `layoutCommand`
  - `src/cli/cliHarness.testing.ts`: `tempDir(): string`, `cli(argv, opts?): Promise<{ code: number; out: string; err: string }>`
  - `src/cli/jsonSchema.testing.ts`: `type Schema`, `loadSchema(name: string): Schema`, `schemaErrors(schema: Schema, value: unknown): string[]`
  - `npm run build:cli`; `plugin/bin/circuitoon.mjs`

- [ ] **Step 1: Write the test helpers and the failing tests**

Create `src/cli/cliHarness.testing.ts`:

```ts
// Runs the CLI in-process with captured output, in a throwaway working directory. Test helper.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './main.ts'

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'circuitoon-cli-'))

export async function cli(argv: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  let out = ''
  let err = ''
  const code = await main(argv, { stdout: (s) => void (out += s), stderr: (s) => void (err += s), cwd: opts.cwd ?? process.cwd(), env: opts.env ?? process.env })
  return { code, out, err }
}
```

Create `src/cli/jsonSchema.testing.ts`:

```ts
// A small JSON Schema checker for the CLI's --json outputs: the subset the schemas in
// plugin/skills/circuitoon-design/references/schemas use (type, const, enum, required, properties,
// additionalProperties false, items). Test helper.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Schema = {
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean
  items?: Schema
}

export const SCHEMA_DIR = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'schemas')
export const loadSchema = (name: string): Schema => JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'))

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

export function schemaErrors(s: Schema, v: unknown, at = '$'): string[] {
  if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const)) return [`${at}: must be ${JSON.stringify(s.const)}`]
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) return [`${at}: must be one of ${JSON.stringify(s.enum)}`]
  if (s.type) {
    const want = Array.isArray(s.type) ? s.type : [s.type]
    const t = typeOf(v)
    if (!want.includes(t) && !(t === 'integer' && want.includes('number'))) return [`${at}: must be ${want.join(' or ')}, got ${t}`]
  }
  const out: string[] = []
  if (typeOf(v) === 'object') {
    const o = v as Record<string, unknown>
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${at}.${k}: required`)
    for (const [k, val] of Object.entries(o)) {
      const sub = s.properties?.[k]
      if (sub) out.push(...schemaErrors(sub, val, `${at}.${k}`))
      else if (s.additionalProperties === false) out.push(`${at}.${k}: not allowed`)
    }
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => out.push(...schemaErrors(s.items!, x, `${at}[${i}]`)))
  return out
}
```

Create `src/cli/cli.test.ts`:

```ts
// The CLI in-process: outputs, JSON schemas and exit codes for parts, part and layout.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateDiagram } from '../format/diagram.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const withFile = (name: string, value: unknown) => {
  const dir = tempDir()
  writeFileSync(join(dir, name), JSON.stringify(value))
  return dir
}

describe('circuitoon parts and part', () => {
  it('lists every built-in part as JSON matching its schema', async () => {
    const r = await cli(['parts', '--json'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('parts'), out)).toEqual([])
    expect(out.parts.map((p: { id: string }) => p.id)).toContain('esp32-devkitc-v4')
  })
  it('filters with --search and prints plain text by default', async () => {
    const r = await cli(['parts', '--search', 'tilt'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('tilt-switch-sw520d')
    expect(r.out).not.toContain('esp32-devkitc-v4')
  })
  it('shows one part in full, and exits 2 on an unknown id', async () => {
    const r = await cli(['part', 'mcp23017-dip28', '--json'])
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('part'), JSON.parse(r.out))).toEqual([])
    expect((await cli(['part', 'mcp23017-dip28'])).out).toContain('GPA0')
    const bad = await cli(['part', 'no-such-part'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('no built-in part "no-such-part"')
  })
})

describe('circuitoon layout', () => {
  it('writes a sheet the site opens and prints the report as JSON', async () => {
    const dir = withFile('led.netlist.json', ledNetlist())
    const r = await cli(['layout', 'led.netlist.json', '-o', 'led.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('layout'), out)).toEqual([])
    expect(out.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
    expect(validateDiagram(JSON.parse(readFileSync(join(dir, 'led.json'), 'utf8'))).ok).toBe(true)
    const text = await cli(['layout', 'led.netlist.json', '-o', 'led2.json'], { cwd: dir })
    expect(text.out).toContain('Readability: body overlaps 0, caption overlaps 0')
    expect(text.out).toContain('Bill of quantities:')
  })
  it('exits 2 on an invalid netlist and 1 on one that cannot be laid out, with JSON that matches the schema', async () => {
    const dir = withFile('bad.json', { format: 'circuitoon-netlist/1', parts: [], nets: [] })
    const bad = await cli(['layout', 'bad.json', '-o', 'out.json'], { cwd: dir })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('title: required')
    const crowded = {
      format: 'circuitoon-netlist/1', title: 'Crowded',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }],
      nets: [{ name: '3V3', pins: ['U1.3V3', 'U2.VIN', 'U3.VIN'] }],
    }
    writeFileSync(join(dir, 'crowded.json'), JSON.stringify(crowded))
    const r = await cli(['layout', 'crowded.json', '-o', 'out.json', '--json'], { cwd: dir })
    expect(r.code).toBe(1)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('layout'), out)).toEqual([])
    expect(out.errors[0]).toMatch(/^needs a distribution point: net 3V3/)
  })
  it('re-lays out from a partial with --keep', async () => {
    const dir = withFile('p.json', { format: 'circuitoon-partial/1', intent: ledNetlist(), parts: [{ designator: 'BT1', x: 600, y: 300 }] })
    const r = await cli(['layout', '--keep', 'p.json', '-o', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    expect(sheet.parts.find((p: { uid: string }) => p.uid === 'BT1')).toMatchObject({ x: 600, y: 300 })
  })
  it('prints usage and exits 2 on an unknown command or option', async () => {
    expect((await cli(['frobnicate'])).code).toBe(2)
    expect((await cli(['parts', '--nope'])).err).toContain('unknown option --nope')
    const help = await cli([])
    expect(help.code).toBe(0)
    expect(help.out).toContain('circuitoon <command>')
  })
})
```

Create `src/cli/bundle.test.ts`:

```ts
// The committed bundle (plugin/dist-cli/circuitoon.mjs) runs with plain Node from a copy of the
// plugin folder, with no node_modules anywhere near it, and imports nothing but Node built-ins.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('CLI bundle', () => {
  it('runs parts --json from a copy of the plugin folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    const r = spawnSync(process.execPath, [join(dir, 'bin', 'circuitoon.mjs'), 'parts', '--search', 'resistor', '--json'], { encoding: 'utf8', cwd: dir })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).parts.map((p: { id: string }) => p.id)).toContain('resistor')
  }, 60_000)
  it('imports only Node built-ins', () => {
    const code = readFileSync(resolve('plugin/dist-cli/circuitoon.mjs'), 'utf8')
    const specs = [...code.matchAll(/\bfrom\s*["']([^"']+)["']/g), ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
    expect(specs.filter((s) => !s.startsWith('node:') && !builtinModules.includes(s))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli`
Expected: FAIL: cannot resolve `./main.ts`.

- [ ] **Step 3: Write the JSON schemas**

Create `plugin/skills/circuitoon-design/references/schemas/parts.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon parts --json",
  "type": "object",
  "required": ["format", "parts"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/parts/1" },
    "parts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "category", "source", "board", "pins", "holes"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "category": { "type": ["string", "null"] },
          "source": { "type": ["string", "null"] },
          "board": { "type": "boolean" },
          "pins": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "label", "type", "supply", "capacity"],
              "additionalProperties": false,
              "properties": {
                "name": { "type": "string" },
                "label": { "type": ["string", "null"] },
                "type": { "enum": ["power_in", "power_out", "ground", "input", "output", "io", "passive", "nc"] },
                "supply": { "type": ["string", "null"] },
                "capacity": { "type": "integer" }
              }
            }
          },
          "holes": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "label", "type", "supply", "holes", "rail", "capacity"],
              "additionalProperties": false,
              "properties": {
                "name": { "type": "string" },
                "label": { "type": ["string", "null"] },
                "type": { "type": ["string", "null"] },
                "supply": { "type": ["string", "null"] },
                "holes": { "type": "integer" },
                "rail": { "enum": ["+", "-", null] },
                "capacity": { "type": "integer" }
              }
            }
          }
        }
      }
    }
  }
}
```

Create `plugin/skills/circuitoon-design/references/schemas/part.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon part <id> --json",
  "type": "object",
  "required": ["format", "module"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/part/1" },
    "module": {
      "type": "object",
      "required": ["format", "id", "name", "pins"],
      "properties": {
        "format": { "const": "circuitoon-module/1" },
        "id": { "type": "string" },
        "name": { "type": "string" },
        "pins": { "type": "array" },
        "holes": { "type": "array" },
        "internal": { "type": "array" }
      }
    }
  }
}
```

Create `plugin/skills/circuitoon-design/references/schemas/layout.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon layout --json",
  "type": "object",
  "required": ["format", "ok", "output", "attempts", "report", "quantities", "channels", "errors"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/layout/1" },
    "ok": { "type": "boolean" },
    "output": { "type": ["string", "null"] },
    "attempts": { "type": "integer" },
    "report": {
      "type": ["object", "null"],
      "required": ["bodyOverlaps", "captionOverlaps", "wireCrossings", "wireLength", "sheet", "blockedNets"],
      "additionalProperties": false,
      "properties": {
        "bodyOverlaps": { "type": "integer" },
        "captionOverlaps": { "type": "integer" },
        "wireCrossings": { "type": "integer" },
        "wireLength": { "type": "integer" },
        "sheet": { "type": "object", "required": ["w", "h"], "additionalProperties": false, "properties": { "w": { "type": "integer" }, "h": { "type": "integer" } } },
        "blockedNets": { "type": "array", "items": { "type": "string" } }
      }
    },
    "quantities": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["module", "name", "count", "custom"],
        "additionalProperties": false,
        "properties": { "module": { "type": "string" }, "name": { "type": "string" }, "count": { "type": "integer" }, "custom": { "type": "boolean" } }
      }
    },
    "channels": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["copy", "port", "endpoint"],
        "additionalProperties": false,
        "properties": { "copy": { "type": "string" }, "port": { "type": "string" }, "endpoint": { "type": "string" } }
      }
    },
    "errors": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 4: Implement the CLI core**

Create `src/cli/args.ts`:

```ts
// Command-line parsing for the circuitoon CLI: a command, positionals and a fixed set of flags.
// Unknown flags are errors, never guessed.
export interface Args {
  command?: string
  positionals: string[]
  flags: Map<string, string | true>
}

const VALUE_FLAGS = new Set(['--out', '--svg', '--scale', '--focus', '--search', '--keep'])
const BOOL_FLAGS = new Set(['--json', '--dark', '--help'])
const ALIASES: Record<string, string> = { '-o': '--out', '-h': '--help' }

export function parseArgs(argv: string[]): { ok: true; value: Args } | { ok: false; error: string } {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const name = Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : raw
    if (!name.startsWith('-')) {
      positionals.push(raw)
      continue
    }
    if (BOOL_FLAGS.has(name)) {
      flags.set(name, true)
      continue
    }
    if (!VALUE_FLAGS.has(name)) return { ok: false, error: `unknown option ${raw}` }
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) return { ok: false, error: `${raw} needs a value` }
    flags.set(name, v)
    i++
  }
  const [command, ...rest] = positionals
  return { ok: true, value: { command, positionals: rest, flags } }
}
```

Create `src/cli/io.ts`:

```ts
// What every CLI command shares: where output goes (so tests capture it), exit codes, files relative
// to the working directory, and loading a sheet the way the site does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { type Diagram, validateDiagram } from '../format/diagram.ts'
import type { Args } from './args.ts'

/** Spec 4.2: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (no browser). */
export const EXIT = { ok: 0, blocked: 1, input: 2, environment: 3 } as const

export interface Io {
  stdout(text: string): void
  stderr(text: string): void
  cwd: string
  env: Record<string, string | undefined>
}

export class CliError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

export const pathIn = (io: Io, path: string): string => resolve(io.cwd, path)

export function readJson(io: Io, path: string): unknown {
  let text: string
  try {
    text = readFileSync(pathIn(io, path), 'utf8')
  } catch {
    throw new CliError(`${path}: cannot read the file`, EXIT.input)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new CliError(`${path}: not valid JSON (${(e as Error).message})`, EXIT.input)
  }
}

export function writeFile(io: Io, path: string, content: string | Uint8Array): void {
  const full = pathIn(io, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export const printJson = (io: Io, value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`)

export function flag(args: Args, name: string): string | undefined {
  const v = args.flags.get(name)
  return typeof v === 'string' ? v : undefined
}

/** A sheet loaded like the site loads it; one that does not load is invalid input (exit 2). */
export function loadSheet(io: Io, path: string): { diagram: Diagram; warnings: string[] } {
  const r = validateDiagram(readJson(io, path))
  if (!r.ok) throw new CliError(`${path} is not a Circuitoon sheet: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
  return { diagram: r.diagram, warnings: r.warnings }
}
```

Create `src/cli/parts.ts`:

```ts
// `circuitoon parts [--search text]` and `circuitoon part <id>` (agent toolkit spec 4.2): the
// built-in catalog, with canonical pin names, labels, types, supplies, capacities, hole groups and
// sources, for picking parts and writing a netlist.
import { library } from '../library.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { naturalCompare } from '../agent/order.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, printJson } from './io.ts'

export function partSummary(m: ModuleDef) {
  return {
    id: m.id,
    name: m.name,
    category: m.category ?? null,
    source: m.source ?? null,
    board: isBoard(m),
    pins: m.pins
      .filter((p): p is PinDef => !isSpacer(p))
      .map((p) => ({ name: p.name, label: p.label ?? null, type: p.type ?? 'io', supply: p.supply ?? null, capacity: terminalCapacity(m, p.name) })),
    holes: (m.holes ?? []).map((g) => ({ name: g.name, label: g.label ?? null, type: g.type ?? null, supply: g.supply ?? null, holes: g.at.length, rail: g.rail ?? null, capacity: terminalCapacity(m, g.name) })),
  }
}

const modules = (): ModuleDef[] => library.flatMap((e) => (e.ok ? [e.module] : [])).sort((a, b) => naturalCompare(a.id, b.id))

type Pin = ReturnType<typeof partSummary>['pins'][number]
const pinText = (p: Pin) =>
  [p.name, p.label && p.label !== p.name ? `(${p.label})` : '', p.type, p.supply ?? '', p.capacity > 1 ? `takes ${p.capacity}` : ''].filter(Boolean).join(' ')

export function partsCommand(args: Args, io: Io): number {
  const q = (flag(args, '--search') ?? '').toLowerCase()
  const list = modules().filter((m) => !q || [m.id, m.name, m.category ?? ''].some((s) => s.toLowerCase().includes(q)))
  if (args.flags.has('--json')) {
    printJson(io, { format: 'circuitoon-cli/parts/1', parts: list.map(partSummary) })
    return EXIT.ok
  }
  const blocks = list.map((m) => {
    const s = partSummary(m)
    return [
      `${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ''}`,
      s.pins.length ? `  pins: ${s.pins.map(pinText).join(', ')}` : '',
      s.holes.length ? `  hole groups: ${s.holes.map((g) => `${g.name}${g.rail ? ` (rail ${g.rail})` : ''} x${g.holes}`).join(', ')}` : '',
    ].filter(Boolean).join('\n')
  })
  io.stdout(`${blocks.join('\n')}\n`)
  return EXIT.ok
}

export function partCommand(args: Args, io: Io): number {
  const [id] = args.positionals
  if (!id) throw new CliError('part: give a module id, for example: circuitoon part resistor', EXIT.input)
  const m = modules().find((x) => x.id === id)
  if (!m) throw new CliError(`no built-in part "${id}" (search with: circuitoon parts --search <text>)`, EXIT.input)
  if (args.flags.has('--json')) {
    printJson(io, { format: 'circuitoon-cli/part/1', module: m })
    return EXIT.ok
  }
  const s = partSummary(m)
  const lines = [`${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ''}`]
  if (s.source) lines.push(`source: ${s.source}`)
  lines.push('pins (side, name, label, type, supply):')
  for (const p of m.pins) if (!isSpacer(p)) lines.push(`  ${p.side.padEnd(6)} ${pinText(s.pins.find((x) => x.name === p.name)!)}`)
  for (const g of s.holes) lines.push(`  hole group ${g.name}${g.label ? ` (${g.label})` : ''}: ${g.holes} hole${g.holes === 1 ? '' : 's'}${g.type ? `, ${g.type}` : ''}${g.supply ? ` ${g.supply}` : ''}${g.rail ? `, rail ${g.rail}` : ''}`)
  for (const group of m.internal ?? []) lines.push(`joined inside the part: ${group.join(' = ')}`)
  io.stdout(`${lines.join('\n')}\n`)
  return EXIT.ok
}
```

Create `src/cli/layoutCmd.ts`:

```ts
// `circuitoon layout <netlist.json> -o <sheet.json>` and `layout --keep <partial.json> -o <sheet.json>`
// (agent toolkit spec 2 and 4.2). Prints the readability report, the bill of quantities and, for
// repeats, the channel allocation table. An invalid netlist exits 2; one that cannot be laid out
// (no seat, needs a distribution point, strip full, blocked routes) exits 1.
import { serializeDiagram } from '../format/diagram.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { loadPartial } from '../agent/partial.ts'
import type { KeepMap } from '../agent/place.ts'
import { reportText } from '../agent/readability.ts'
import { channelTable, channelsText, quantities, quantitiesText } from '../agent/tables.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, printJson, readJson, writeFile } from './io.ts'

export function layoutCommand(args: Args, io: Io): number {
  const json = args.flags.has('--json')
  const out = flag(args, '--out')
  const keepPath = flag(args, '--keep')
  const [input] = args.positionals
  if (!out) throw new CliError('layout: -o <sheet.json> is required', EXIT.input)
  if (!input === !keepPath) throw new CliError('layout: give a netlist file, or --keep <partial.json>, but not both', EXIT.input)
  let raw: unknown
  let keep: KeepMap | undefined
  if (keepPath) {
    const p = loadPartial(readJson(io, keepPath))
    if (!p.ok) throw new CliError(`${keepPath}: ${p.errors.join('; ')}`, EXIT.input)
    raw = p.intent
    keep = p.keep
  } else raw = readJson(io, input!)
  const r = layoutNetlist(raw, { keep })
  if (!r.ok) {
    if (json) printJson(io, { format: 'circuitoon-cli/layout/1', ok: false, output: null, attempts: 0, report: null, quantities: [], channels: [], errors: r.errors })
    else io.stderr(`${r.stage === 'input' ? 'The netlist is not valid' : 'The netlist cannot be laid out'}:\n${r.errors.map((e) => `  - ${e}`).join('\n')}\n`)
    return r.stage === 'input' ? EXIT.input : EXIT.blocked
  }
  const { diagram, report, intent, attempts } = r.value
  writeFile(io, out, serializeDiagram(diagram))
  const q = quantities(intent)
  const ch = channelTable(intent)
  if (json) {
    printJson(io, { format: 'circuitoon-cli/layout/1', ok: true, output: out, attempts, report, quantities: q, channels: ch, errors: [] })
    return EXIT.ok
  }
  io.stdout(
    [
      `Laid out "${diagram.title}" into ${out}: ${diagram.parts.length} parts, ${diagram.connections.length} wires (placement ${attempts} of 3).`,
      reportText(report),
      'Bill of quantities:',
      quantitiesText(q),
      ...(ch.length ? ['Channel allocation:', channelsText(ch)] : []),
      ...(intent.custom.length ? [`Custom parts (unverified): ${intent.custom.join(', ')}`] : []),
    ].join('\n') + '\n',
  )
  return EXIT.ok
}
```

Create `src/cli/main.ts`:

```ts
// The circuitoon CLI (agent toolkit spec section 4): one entry for every command. Plain text by
// default; --json prints one JSON document on stdout; diagnostics go to stderr. Exit codes: 0 ok,
// 1 findings that block, 2 invalid input, 3 environment problem (such as no browser).
import { type Args, parseArgs } from './args.ts'
import { CliError, EXIT, type Io } from './io.ts'
import { partCommand, partsCommand } from './parts.ts'
import { layoutCommand } from './layoutCmd.ts'

export const USAGE = `circuitoon <command> [options]

  parts [--search text] [--json]            built-in parts: pins, labels, types, supplies, hole groups
  part <id> [--json]                        one part in full
  layout <netlist.json> -o <sheet.json>     lay out a netlist; or layout --keep <partial.json> -o <sheet.json>
  verify <sheet.json> [--json]              the sheet against its intent
  check <sheet.json> [--json]               the wiring checker, plus verify when the sheet has an intent
  render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus <copy or group>]
  link <sheet.json> [-o <dir>] [--json]     a link that opens the sheet in Circuitoon
  gate <sheet.json> -o <dir> [--json]       every check, the renders and the link; exits 0 only when nothing blocks

Exit codes: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (such as no browser).
`

export type Command = (args: Args, io: Io) => number | Promise<number>
export const COMMANDS: Record<string, Command> = { parts: partsCommand, part: partCommand, layout: layoutCommand }

export async function main(argv: string[], io: Io): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n\n${USAGE}`)
    return EXIT.input
  }
  const args = parsed.value
  if (args.command === undefined || args.command === 'help' || args.flags.has('--help')) {
    io.stdout(USAGE)
    return EXIT.ok
  }
  const command = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined
  if (!command) {
    io.stderr(`unknown command "${args.command}"\n\n${USAGE}`)
    return EXIT.input
  }
  try {
    return await command(args, io)
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr(`${err.message}\n`)
      return err.code
    }
    throw err
  }
}

/** Runs the CLI on this process; plugin/bin/circuitoon.mjs calls it. */
export function run(argv: string[]): Promise<number> {
  return main(argv, {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    cwd: process.cwd(),
    env: process.env,
  })
}
```

- [ ] **Step 5: Run the in-process tests**

Run: `npx vitest run src/cli/cli.test.ts`
Expected: PASS (the bundle test still fails: nothing is built yet).

- [ ] **Step 6: Add the bundle build**

Create `vite.cli.config.ts`:

```ts
// The circuitoon CLI bundle (agent toolkit spec 4.1): an SSR build of src/cli/main.ts into one ES
// module for Node 22+. Everything is bundled (React, react-dom/server, and modules/*.json through
// the same import.meta.glob catalog the site uses, resolved at build time); only Node built-ins stay
// external. Unminified, so the committed file diffs readably. scripts/gen-cli.mjs runs it.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'plugin/dist-cli',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'circuitoon.mjs', inlineDynamicImports: true } },
  },
})
```

Create `scripts/gen-cli.mjs`:

```js
// Builds the agent toolkit CLI into one ES module, plugin/dist-cli/circuitoon.mjs, with Vite
// (vite.cli.config.ts). The bundle is committed so the Claude Code plugin works with no install
// step. With --check (npm run check:gen) it is built in memory and compared with the committed file
// instead, so a source or module change without `npm run build:cli` fails the check.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { CHECK, emit, finish, log } from './lib/gen-output.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  root,
  configFile: fileURLToPath(new URL('../vite.cli.config.ts', import.meta.url)),
  logLevel: 'error',
  build: { write: false },
})
const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).filter((o) => o.type === 'chunk')
if (chunks.length !== 1 || chunks[0].fileName !== 'circuitoon.mjs') {
  console.error(`gen-cli.mjs: expected one chunk named circuitoon.mjs, got ${chunks.map((c) => c.fileName).join(', ')}`)
  process.exit(1)
}
const out = fileURLToPath(new URL('../plugin/dist-cli/circuitoon.mjs', import.meta.url))
if (!CHECK) mkdirSync(dirname(out), { recursive: true })
emit(out, chunks[0].code)
log('plugin/dist-cli/circuitoon.mjs', Math.round(chunks[0].code.length / 1024), 'KB')
finish('gen-cli.mjs')
```

Create `plugin/bin/circuitoon.mjs`:

```js
#!/usr/bin/env node
// The circuitoon CLI (agent toolkit spec 4.1). Checks for Node 22 or newer, then runs the bundled
// CLI in ../dist-cli/circuitoon.mjs (built from src/cli by `npm run build:cli` in the Circuitoon repo).
const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  process.stderr.write(`circuitoon needs Node 22 or newer; this is Node ${process.versions.node}.\n`)
  process.exit(3)
}
const { run } = await import('../dist-cli/circuitoon.mjs')
process.exitCode = await run(process.argv.slice(2))
```

Create `.gitattributes`:

```
# The CLI bundle is generated and compared byte for byte by `npm run check:gen`: LF everywhere.
plugin/dist-cli/*.mjs text eol=lf
```

In `package.json` scripts add `"build:cli": "node scripts/gen-cli.mjs",` after `"check:gen"`. In `tsconfig.json` change `"include"` to `["src", "scripts", "vite.config.ts", "vite.cli.config.ts"]`. In `scripts/check-gen.test.ts`, raise the first test's timeout from `30_000` to `120_000` (it now also builds the CLI bundle).

- [ ] **Step 7: Build the bundle and run every test**

```bash
npm run build:cli
node plugin/bin/circuitoon.mjs parts --search resistor
npx vitest run src/cli scripts/check-gen.test.ts
```
Expected: the build writes about 1.5 MB; the command lists the resistors; tests PASS. If Node reports `require is not defined` from the bundle, add `banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"` to `rolldownOptions.output` and rebuild. If Vite 8 rejects `rolldownOptions`, use `rollupOptions` with the same object.

- [ ] **Step 8: Prove reproducibility**

```bash
npm run check:gen
```
Expected: `gen-cli.mjs: 1 generated files match modules/` among the generator lines, and the final line `check-gen: all N generators match modules/` (N counts gen-cli.mjs). Run `npm run build:cli && git status --short plugin/dist-cli`: no change.

- [ ] **Step 9: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add vite.cli.config.ts scripts/gen-cli.mjs scripts/check-gen.test.ts .gitattributes package.json tsconfig.json src/cli plugin
git commit -m "circuitoon CLI: committed Vite bundle, bin, parts, part and layout with JSON schemas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `render`: standalone SVG, PNG through an installed Chrome or Edge, focus

Adds `circuitoon render` (spec 4.1 and 4.2). The SVG comes from Task 5; the PNG is that SVG screenshotted by an auto-detected Chrome or Edge in headless mode with a throwaway profile (Decision 1). No browser is exit 3 with install guidance and `--svg` suggested.

**Files:**
- Create: `src/cli/png.ts`, `src/cli/render.ts`, `plugin/skills/circuitoon-design/references/schemas/render.schema.json`
- Modify: `src/cli/main.ts` (register `render`)
- Test: `src/cli/render.test.ts`

**Interfaces:**
- Consumes: `renderSheetSvg`, `focusBounds` (Task 5); `parseNetlist` (Task 3); `intentLookup` (Task 4); `libraryLookup` (Task 3); `loadSheet`, `writeFile`, `pathIn`, `flag`, `printJson`, `CliError`, `EXIT`, `Io` (Task 9); `cli`, `tempDir`, `loadSchema`, `schemaErrors` (Task 9); `tiltSensors`, `ledNetlist` (Task 6).
- Produces:
  - `src/cli/png.ts`: `PNG_MAX_SIDE = 8000`, `NO_BROWSER` (message), `browserCandidates(env, platform?): string[]`, `findBrowser(env): string | null`, `writePng(svg: { svg: string; width: number; height: number }, scale: number, out: string, env): { ok: true; width: number; height: number } | { ok: false; message: string }`
  - `src/cli/render.ts`: `focusParts(d: Diagram, name: string): string[] | null`, `renderCommand`

- [ ] **Step 1: Write the failing test**

Create `src/cli/render.test.ts`:

```ts
// circuitoon render: standalone SVG, PNG at scale through an installed browser, the missing-browser
// path (exit 3, guidance, --svg offered) and --focus on a repeat copy.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { ledNetlist, tiltSensors } from '../agent/fixtures.testing.ts'

const browser = findBrowser(process.env)
const sheetFrom = async (netlist: unknown) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const svgSize = (svg: string) => {
  const m = /^<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg)!
  return { w: Number(m[1]), h: Number(m[2]) }
}

describe('circuitoon render', () => {
  it('writes a standalone SVG and reports it as JSON matching the schema', async () => {
    const dir = await sheetFrom(ledNetlist())
    const r = await cli(['render', 'sheet.json', '--svg', 'sheet.svg', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('render'), JSON.parse(r.out))).toEqual([])
    const svg = readFileSync(join(dir, 'sheet.svg'), 'utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).not.toContain('var(--')
  })
  it('exits 3 with install guidance and --svg offered when no browser is found', async () => {
    const dir = await sheetFrom(ledNetlist())
    const r = await cli(['render', 'sheet.json', '-o', 'sheet.png'], { cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') } })
    expect(r.code).toBe(3)
    expect(r.err).toContain('No Chrome or Edge found')
    expect(r.err).toContain('--svg')
    expect(existsSync(join(dir, 'sheet.png'))).toBe(false)
  })
  it.skipIf(!browser)('writes a PNG at the requested scale', async () => {
    const dir = await sheetFrom(ledNetlist())
    const r = await cli(['render', 'sheet.json', '-o', 'sheet.png', '--svg', 'sheet.svg', '--scale', '2', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const png = readFileSync(join(dir, 'sheet.png'))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const { w, h } = svgSize(readFileSync(join(dir, 'sheet.svg'), 'utf8'))
    expect({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }).toEqual({ w: w * 2, h: h * 2 })
    expect(JSON.parse(r.out).outputs.find((o: { kind: string }) => o.kind === 'png')).toMatchObject({ width: w * 2, height: h * 2 })
  }, 120_000)
  it('frames one repeat copy with --focus, and exits 2 on a name the intent does not have', async () => {
    const dir = await sheetFrom(tiltSensors())
    expect((await cli(['render', 'sheet.json', '--svg', 'full.svg'], { cwd: dir })).code).toBe(0)
    expect((await cli(['render', 'sheet.json', '--svg', 'focus.svg', '--focus', 'tilt_3'], { cwd: dir })).code).toBe(0)
    const full = svgSize(readFileSync(join(dir, 'full.svg'), 'utf8'))
    const focus = svgSize(readFileSync(join(dir, 'focus.svg'), 'utf8'))
    expect(focus.w * focus.h).toBeLessThan(full.w * full.h)
    const bad = await cli(['render', 'sheet.json', '--svg', 'x.svg', '--focus', 'nothing'], { cwd: dir })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('no repeat copy or group named "nothing"')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/render.test.ts`
Expected: FAIL: cannot resolve `./png.ts`.

- [ ] **Step 3: Write the schema**

Create `plugin/skills/circuitoon-design/references/schemas/render.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon render --json",
  "type": "object",
  "required": ["format", "outputs"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/render/1" },
    "outputs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "path", "width", "height"],
        "additionalProperties": false,
        "properties": {
          "kind": { "enum": ["svg", "png"] },
          "path": { "type": "string" },
          "width": { "type": "integer" },
          "height": { "type": "integer" }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Implement PNG output**

Create `src/cli/png.ts`:

```ts
// PNG output for the CLI (agent toolkit spec 4.1): the standalone SVG screenshotted by an installed
// Chrome or Edge in headless mode, with a throwaway profile so it never touches a running browser.
// The spec's playwright-core route is replaced by driving the browser directly: a plugin install has
// no node_modules, and this needs none. No browser found is an environment problem (exit 3) with
// install guidance and --svg offered.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Longest PNG side, in px; a larger sheet is rendered at a smaller scale. */
export const PNG_MAX_SIDE = 8000
export const NO_BROWSER =
  'No Chrome or Edge found for PNG output. Install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge, or set CIRCUITOON_BROWSER to the browser executable; or use --svg <file> for SVG output, which needs no browser.'

type Env = Record<string, string | undefined>

/** Where Chrome and Edge install on this platform, most likely first. */
export function browserCandidates(env: Env, platform: string = process.platform): string[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r)
    return roots.flatMap((r) => [join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
  }
  if (platform === 'darwin')
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
}

/** CIRCUITOON_BROWSER when set (null when that file is missing), else the first installed candidate. */
export function findBrowser(env: Env): string | null {
  const own = env.CIRCUITOON_BROWSER
  if (own !== undefined) return own && existsSync(own) ? own : null
  return browserCandidates(env).find((p) => existsSync(p)) ?? null
}

export function writePng(svg: { svg: string; width: number; height: number }, scale: number, out: string, env: Env): { ok: true; width: number; height: number } | { ok: false; message: string } {
  const browser = findBrowser(env)
  if (!browser) return { ok: false, message: NO_BROWSER }
  const s = Math.min(scale, PNG_MAX_SIDE / Math.max(svg.width, svg.height))
  const dir = mkdtempSync(join(tmpdir(), 'circuitoon-png-'))
  try {
    const page = join(dir, 'sheet.html')
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#ffffff}svg{display:block}</style></head><body>${svg.svg}</body></html>`)
    mkdirSync(dirname(out), { recursive: true })
    rmSync(out, { force: true })
    const r = spawnSync(
      browser,
      [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        `--user-data-dir=${join(dir, 'profile')}`, `--force-device-scale-factor=${s}`, `--window-size=${svg.width},${svg.height}`,
        `--screenshot=${out}`, pathToFileURL(page).href,
      ],
      { timeout: 120_000, stdio: 'ignore' },
    )
    if (!existsSync(out) || statSync(out).size === 0)
      return { ok: false, message: `${browser} did not write ${out} (${r.error?.message ?? `exit ${r.status}`}). Try again, or use --svg <file>.` }
    return { ok: true, width: Math.round(svg.width * s), height: Math.round(svg.height * s) }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
```

- [ ] **Step 5: Implement the command and register it**

Create `src/cli/render.ts`:

```ts
// `circuitoon render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus name]`
// (agent toolkit spec 4.1 and 4.2). --focus frames one repeat copy (`<repeat>_<k>`) or group of the
// sheet's intent, on the full sheet so every route is the same as in the full render.
import type { Diagram } from '../format/diagram.ts'
import type { Rect } from '../format/geometry.ts'
import { focusBounds, renderSheetSvg } from '../render/exportSvg.tsx'
import { parseNetlist } from '../agent/netlist.ts'
import { intentLookup } from '../agent/verify.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, pathIn, printJson, writeFile } from './io.ts'
import { writePng } from './png.ts'

/** The part uids of a repeat copy or a group named in the sheet's intent; null when there is none. */
export function focusParts(d: Diagram, name: string): string[] | null {
  if (d.intent === undefined) return null
  const r = parseNetlist(d.intent, intentLookup(d, libraryLookup))
  if (!r.ok) return null
  const refs = r.intent.copies.find((c) => c.id === name)?.refs ?? r.intent.groups.find((g) => g.name === name)?.refs
  const uids = refs ? d.parts.filter((p) => refs.includes(p.designator)).map((p) => p.uid) : []
  return uids.length ? uids : null
}

export function renderCommand(args: Args, io: Io): number {
  const [input] = args.positionals
  const png = flag(args, '--out')
  const svgPath = flag(args, '--svg')
  if (!input) throw new CliError('render: give a sheet file', EXIT.input)
  if (!png && !svgPath) throw new CliError('render: give -o <sheet.png>, --svg <sheet.svg>, or both', EXIT.input)
  const scale = Number(flag(args, '--scale') ?? '2')
  if (!(scale > 0 && scale <= 8)) throw new CliError('render: --scale must be a number above 0, at most 8', EXIT.input)
  const { diagram } = loadSheet(io, input)
  const focus = flag(args, '--focus')
  let box: Rect | undefined
  if (focus !== undefined) {
    const uids = focusParts(diagram, focus)
    if (!uids) throw new CliError(`render: the sheet's intent has no repeat copy or group named "${focus}"`, EXIT.input)
    box = focusBounds(diagram, uids)
  }
  const drawn = renderSheetSvg(diagram, { dark: args.flags.has('--dark'), box })
  const outputs: { kind: 'svg' | 'png'; path: string; width: number; height: number }[] = []
  if (svgPath) {
    writeFile(io, svgPath, drawn.svg)
    outputs.push({ kind: 'svg', path: svgPath, width: drawn.width, height: drawn.height })
  }
  if (png) {
    const shot = writePng(drawn, scale, pathIn(io, png), io.env)
    if (!shot.ok) throw new CliError(shot.message, EXIT.environment)
    outputs.push({ kind: 'png', path: png, width: shot.width, height: shot.height })
  }
  if (args.flags.has('--json')) printJson(io, { format: 'circuitoon-cli/render/1', outputs })
  else io.stdout(`${outputs.map((o) => `Wrote ${o.path} (${o.width} x ${o.height} px)`).join('\n')}\n`)
  return EXIT.ok
}
```

In `src/cli/main.ts` add `import { renderCommand } from './render.ts'` and change the registry line to:

```ts
export const COMMANDS: Record<string, Command> = { parts: partsCommand, part: partCommand, layout: layoutCommand, render: renderCommand }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/cli/render.test.ts`
Expected: PASS (the PNG case runs because Chrome is installed on this machine; it is skipped only where no browser exists). If the PNG is one pixel off the expected size, Chrome rounded the window: report the PNG's real size from its IHDR in `writePng` instead of computing it, and keep the test comparing header to report.

- [ ] **Step 7: Look at it**

```bash
npm run build:cli
SCRATCH="$TEMP/circuitoon-render" && mkdir -p "$SCRATCH"
node -e "import('./src/agent/fixtures.testing.ts').then((f) => { const fs = require('node:fs'); fs.writeFileSync(process.argv[1] + '/led.netlist.json', JSON.stringify(f.ledNetlist())); fs.writeFileSync(process.argv[1] + '/tilt.netlist.json', JSON.stringify(f.tiltSensors())) })" "$SCRATCH"
node plugin/bin/circuitoon.mjs layout "$SCRATCH/led.netlist.json" -o "$SCRATCH/led.json"
node plugin/bin/circuitoon.mjs render "$SCRATCH/led.json" -o "$SCRATCH/led.png"
node plugin/bin/circuitoon.mjs render "$SCRATCH/led.json" -o "$SCRATCH/led-dark.png" --dark
node plugin/bin/circuitoon.mjs layout "$SCRATCH/tilt.netlist.json" -o "$SCRATCH/tilt.json"
node plugin/bin/circuitoon.mjs render "$SCRATCH/tilt.json" -o "$SCRATCH/tilt.png"
node plugin/bin/circuitoon.mjs render "$SCRATCH/tilt.json" -o "$SCRATCH/tilt-3.png" --focus tilt_3
```
Read every PNG (use the scratchpad directory, not the repo). Check: R1 and D1 sit in the breadboard with legs in holes, jumpers end in free holes of the right columns, no wire runs into a leg's hole, captions readable and clear of bodies, wires colored by net (VCC red, GND black), the dark render keeps captions legible, the tilt copies sit in labelled frames, the focus crop shows one copy and the wires leaving it. Fix anything that reads poorly (in placement or rendering) and re-render.

- [ ] **Step 8: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/cli plugin
git commit -m "circuitoon render: standalone SVG, PNG through an installed Chrome or Edge, focus

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Layout fixtures (5, 30, 120 parts, typewriter-like), the 2 s budget, visual inspection

Independent tests of Tasks 6 and 7 on the fixture sizes spec 10 names, the full typewriter-like topology, and the performance budget; then a visual review of every fixture rendered through the CLI.

**Files:**
- Modify: `src/agent/fixtures.testing.ts` (append `fiveParts`, `ledRails`, `typewriter`)
- Test: `src/agent/layout.fixtures.test.ts`, `src/agent/layout.perf.test.ts`

**Interfaces:**
- Consumes: `layoutNetlist` (Task 7), `verifyDiagram` (Task 4), `channelTable` (Task 3), `libraryLookup` (Task 3), `mountIssues` (breadboard.ts), `serializeDiagram` (diagram.ts), `ledNetlist` (Task 6).
- Produces: `fiveParts()`, `ledRails(pairs: number, rails: number)`, `typewriter()` in `src/agent/fixtures.testing.ts` (used again in Task 17's visual checks).

- [ ] **Step 1: Add the fixtures**

Append to `src/agent/fixtures.testing.ts`:

```ts
/** Five parts: the LED example with a push button between the battery and the resistor, all on the board. */
export function fiveParts() {
  const n = ledNetlist()
  return {
    ...n,
    title: 'Button, resistor and LED on a breadboard',
    parts: [...n.parts, { ref: 'S1', module: 'push-button', on: 'BB1' }],
    nets: [
      { name: 'VCC', pins: ['BT1.+', 'S1.1'] },
      { name: 'SW', pins: ['S1.2', 'R1.1'] },
      { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'BT1.-'] },
    ],
  }
}

/**
 * A battery on `rails` rail strips feeding `pairs` resistor and LED pairs (a repeat with only shared
 * ports), plus an ESP32 with a BME280 on I2C: 4 + rails + 2 * pairs parts.
 */
export function ledRails(pairs: number, rails: number) {
  const railRefs = Array.from({ length: rails }, (_, i) => `RAIL${i + 1}`)
  return {
    format: 'circuitoon-netlist/1',
    title: `${pairs} LEDs on ${rails} rail strip${rails === 1 ? '' : 's'}`,
    parts: [
      { ref: 'BT1', module: 'battery-holder-2xaa' },
      ...railRefs.map((ref) => ({ ref, module: 'power-rail-strip' })),
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      { ref: 'U2', module: 'bme280-module-4pin' },
    ],
    nets: [
      { name: 'VCC', pins: ['BT1.+', ...railRefs.map((r) => `${r}.+`)] },
      { name: 'GND', pins: ['BT1.-', ...railRefs.map((r) => `${r}.-`)] },
      { name: '3V3', pins: ['U1.3V3', 'U2.VIN'] },
      { name: 'GND_MCU', pins: ['U1.GND', 'U2.GND'] },
      { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
      { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
    ],
    repeat: {
      name: 'led',
      count: pairs,
      template: {
        parts: [{ ref: 'R', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } } }, { ref: 'D', module: 'led' }],
        nets: [{ name: 'VCC', pins: ['R.1'] }, { name: 'MID', pins: ['R.2', 'D.A'] }, { name: 'GND', pins: ['D.K'] }],
        ports: ['VCC', 'GND'],
      },
      bindings: Array.from({ length: pairs }, () => ({})),
      shared: { VCC: 'VCC', GND: 'GND' },
    },
    wires: { ends: 'dupont-male' },
  }
}

/**
 * The Spirit-Typewriter-like topology (spec 10): an ESP32 DevKitC, three MCP23017 (DIP-28) on half
 * breadboards, 42 balls of two tilt switches each sharing one expander channel (a repeat with
 * explicit bindings), two ST7796S SPI LCDs, an SSD1306 OLED, a microSD module, an 18650 and IP5306
 * power chain and a KCD1 rocker switch. 98 parts.
 */
export function typewriter() {
  const boards = ['BB1', 'BB2', 'BB3']
  const bank = (u: string, b: string) => Array.from({ length: 8 }, (_, i) => `${u}.GP${b}${i}`)
  const channels = [...bank('U2', 'A'), ...bank('U2', 'B'), ...bank('U3', 'A'), ...bank('U3', 'B'), ...bank('U4', 'A'), 'U4.GPB0', 'U4.GPB1']
  return {
    format: 'circuitoon-netlist/1',
    title: 'Spirit Typewriter (layout fixture)',
    parts: [
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      ...boards.map((ref) => ({ ref, module: 'breadboard-half' })),
      ...boards.map((b, i) => ({ ref: `U${i + 2}`, module: 'mcp23017-dip28', on: b })),
      { ref: 'DS1', module: 'lcd-st7796s-4in-spi-touch' },
      { ref: 'DS2', module: 'lcd-st7796s-4in-spi-touch' },
      { ref: 'DS3', module: 'oled-ssd1306-096-i2c' },
      { ref: 'SD1', module: 'microsd-spi-3v3' },
      { ref: 'BT1', module: 'battery-18650-holder' },
      { ref: 'U5', module: 'ip5306-usbc-module' },
      { ref: 'SW1', module: 'rocker-switch-kcd1' },
    ],
    nets: [
      { name: '3V3', pins: ['U1.3V3', 'U2.VDD', 'U3.VDD', 'U4.VDD', 'U2.RESET', 'U3.RESET', 'U4.RESET', 'U3.A0', 'U4.A1', 'DS1.VCC', 'DS1.LED', 'DS2.VCC', 'DS2.LED', 'DS3.VCC', 'SD1.3V3', ...boards.flatMap((b) => [`${b}.top+`, `${b}.bottom+`])] },
      { name: 'GND', pins: ['U1.GND', 'U2.VSS', 'U3.VSS', 'U4.VSS', 'U2.A0', 'U2.A1', 'U2.A2', 'U3.A1', 'U3.A2', 'U4.A0', 'U4.A2', 'DS1.GND', 'DS2.GND', 'DS3.GND', 'SD1.GND', 'BT1.-', 'U5.B-', 'U5.5V-', ...boards.flatMap((b) => [`${b}.top-`, `${b}.bottom-`])] },
      { name: 'SCL', pins: ['U1.IO22', 'U2.SCL', 'U3.SCL', 'U4.SCL', 'DS3.SCL'] },
      { name: 'SDA', pins: ['U1.IO21', 'U2.SDA', 'U3.SDA', 'U4.SDA', 'DS3.SDA'] },
      { name: 'SCK', pins: ['U1.IO18', 'DS1.SCK', 'DS2.SCK', 'SD1.CLK'] },
      { name: 'MOSI', pins: ['U1.IO23', 'DS1.SDI', 'DS2.SDI', 'SD1.MOSI'] },
      { name: 'MISO', pins: ['U1.IO19', 'DS1.SDO', 'DS2.SDO', 'SD1.MISO'] },
      { name: 'LCD_DC', pins: ['U1.IO4', 'DS1.DC/RS', 'DS2.DC/RS'] },
      { name: 'LCD_RST', pins: ['U1.IO16', 'DS1.RESET', 'DS2.RESET'] },
      { name: 'LCD1_CS', pins: ['U1.IO5', 'DS1.CS'] },
      { name: 'LCD2_CS', pins: ['U1.IO17', 'DS2.CS'] },
      { name: 'SD_CS', pins: ['U1.IO13', 'SD1.CS'] },
      { name: 'BAT', pins: ['BT1.+', 'U5.B+'] },
      { name: 'VSW', pins: ['U5.5V+', 'SW1.1'] },
      { name: '5V', pins: ['SW1.2', 'U1.5V'] },
    ],
    repeat: {
      name: 'ball',
      count: channels.length,
      template: {
        parts: [{ ref: 'SA', module: 'tilt-switch-sw520d' }, { ref: 'SB', module: 'tilt-switch-sw520d' }],
        nets: [{ name: 'CH', pins: ['SA.1', 'SB.1'] }, { name: 'GND', pins: ['SA.2', 'SB.2'] }],
        ports: ['CH', 'GND'],
      },
      bindings: channels.map((ch) => ({ CH: ch })),
      shared: { GND: 'GND' },
    },
    groups: [
      { name: 'Power', parts: ['BT1', 'U5', 'SW1'] },
      { name: 'Displays', parts: ['DS1', 'DS2', 'DS3', 'SD1'] },
    ],
    notes: [{ text: 'Each ball holds two tilt switches wired in parallel on one expander channel.', near: 'U2' }],
    wires: { ends: 'dupont-male' },
  }
}
```

- [ ] **Step 2: Write the tests**

Create `src/agent/layout.fixtures.test.ts`:

```ts
// Layout on the fixture sizes of spec 10 (5, 30, 120 parts and the typewriter-like topology): every
// part placed, zero body and caption overlaps, nothing blocked, mounts seated, and a clean verify.
import { describe, expect, it } from 'vitest'
import { serializeDiagram } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import { libraryLookup } from './catalog.ts'
import { layoutNetlist } from './layout.ts'
import { verifyDiagram } from './verify.ts'
import { channelTable } from './tables.ts'
import { fiveParts, ledRails, typewriter } from './fixtures.testing.ts'

const cases: [string, () => unknown, number][] = [
  ['5 parts', fiveParts, 5],
  ['30 parts', () => ledRails(13, 1), 30],
  ['120 parts', () => ledRails(57, 3), 120],
  ['typewriter-like', typewriter, 98],
]

describe('layout fixtures', () => {
  for (const [name, make, count] of cases)
    it(`${name}: all placed, no overlaps, nothing blocked, mounts seated, verifies clean`, () => {
      const r = layoutNetlist(make())
      if (!r.ok) throw new Error(r.errors.join('\n'))
      const d = r.value.diagram
      expect(d.parts).toHaveLength(count)
      expect(r.value.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
      expect(mountIssues(d)).toEqual([])
      expect(verifyDiagram(d, libraryLookup)).toEqual([])
    }, 60_000)

  it('typewriter-like: 42 copies, 84 switches, one channel per ball, DIPs across the channel, deterministic', () => {
    const a = layoutNetlist(typewriter())
    const b = layoutNetlist(typewriter())
    if (!a.ok || !b.ok) throw new Error('layout failed')
    expect(a.value.intent.copies).toHaveLength(42)
    expect(a.value.diagram.parts.filter((p) => p.module === 'tilt-switch-sw520d')).toHaveLength(84)
    expect(new Set(channelTable(a.value.intent).map((c) => c.endpoint)).size).toBe(42)
    expect(a.value.diagram.parts.filter((p) => p.module === 'mcp23017-dip28').every((p) => p.rotation === 90 && p.mount)).toBe(true)
    expect(serializeDiagram(a.value.diagram)).toBe(serializeDiagram(b.value.diagram))
  }, 60_000)
})
```

Create `src/agent/layout.perf.test.ts`:

```ts
// The layout budget (spec 2.3): 120 parts in under 2 s, routing included, measured after one warm-up
// run (JIT and per-module caches), on the 120-part fixture and on the 98-part typewriter-like one.
import { describe, expect, it } from 'vitest'
import { layoutNetlist } from './layout.ts'
import { ledRails, typewriter } from './fixtures.testing.ts'

const cases: [string, () => unknown][] = [
  ['120 parts', () => ledRails(57, 3)],
  ['typewriter-like (98 parts)', typewriter],
]

describe('layout performance', () => {
  for (const [name, make] of cases)
    it(`${name}: under 2 s including routing`, () => {
      layoutNetlist(make())
      const t0 = performance.now()
      const r = layoutNetlist(make())
      const ms = performance.now() - t0
      expect(r.ok).toBe(true)
      expect(ms).toBeLessThan(2000)
    }, 60_000)
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/agent/layout.fixtures.test.ts src/agent/layout.perf.test.ts`
Expected: PASS. These are the first runs at this size, so failures here are real findings about Tasks 6 and 7:
- An overlap or seat failure: fix placement or the mount search, never the test.
- `strip full` or `needs a distribution point` on the typewriter: the netlist lists six rails per net, so check the claim and reserve logic in `realize.ts`.
- Over 2 s: profile with `node --cpu-prof node_modules/vitest/vitest.mjs run src/agent/layout.perf.test.ts` and optimise the hot path (usually the ring search or `seatOn` calls in the mount search). The budget is the spec's: do not relax it without asking Michael.

- [ ] **Step 4: Look at every fixture**

```bash
npm run build:cli
SCRATCH="$TEMP/circuitoon-fixtures" && mkdir -p "$SCRATCH"
node -e "import('./src/agent/fixtures.testing.ts').then((f) => { const fs = require('node:fs'); const d = process.argv[1]; fs.writeFileSync(d + '/five.json', JSON.stringify(f.fiveParts())); fs.writeFileSync(d + '/thirty.json', JSON.stringify(f.ledRails(13, 1))); fs.writeFileSync(d + '/onetwenty.json', JSON.stringify(f.ledRails(57, 3))); fs.writeFileSync(d + '/typewriter.json', JSON.stringify(f.typewriter())) })" "$SCRATCH"
for n in five thirty onetwenty typewriter; do
  node plugin/bin/circuitoon.mjs layout "$SCRATCH/$n.json" -o "$SCRATCH/$n.sheet.json"
  node plugin/bin/circuitoon.mjs render "$SCRATCH/$n.sheet.json" -o "$SCRATCH/$n.png"
done
node plugin/bin/circuitoon.mjs render "$SCRATCH/typewriter.sheet.json" -o "$SCRATCH/typewriter-ball_1.png" --focus ball_1
node plugin/bin/circuitoon.mjs render "$SCRATCH/typewriter.sheet.json" -o "$SCRATCH/typewriter-power.png" --focus Power
```
Read every PNG. Check each against this list and write down what fails:
- Nothing overlaps: bodies, captions, frames and the note.
- Every DIP straddles its breadboard's centre channel; legs sit in holes (metal dots); no wire ends in a leg's hole.
- Wires into strips end in free holes of the right column (compare with the net names in the layout output).
- Rails: ground wires go to `-` rails, 3V3 to `+` rails; jumpers join rails across boards.
- Each ball copy has its frame and label; the focus crop of `ball_1` shows both switches and where their wires go.
- Captions and pin labels are readable at 100% zoom of the PNG.
Fix what reads poorly (spacing, frame padding, strip choice) in `place.ts` or `realize.ts`, re-run Steps 3 and 4, and repeat until the list passes. Record the final readability numbers of each fixture in the commit message.

- [ ] **Step 5: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/agent plugin/dist-cli
git commit -m "Layout fixtures: 5, 30, 120 parts and the typewriter-like topology, 2 s budget

One line per fixture with the Readability line the CLI printed for it in Step 4.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `verify` and `check` commands, the "not checked" list

Adds `circuitoon verify` and `circuitoon check` (spec 3 and 4.2): findings with stable ids, rule, severity, message, parts, pins and wires, plus the list of what the checker does not cover (spec 5). `check` runs `verify` when the sheet has an intent and still works on any diagram without one.

**Files:**
- Create: `src/agent/notChecked.ts`, `src/cli/verifyCmd.ts`, `plugin/skills/circuitoon-design/references/schemas/findings.schema.json`
- Modify: `src/cli/main.ts` (register `verify`, `check`)
- Test: `src/cli/verifyCmd.test.ts`

**Interfaces:**
- Consumes: `verifyDiagram`, `NO_INTENT` (Task 4); `checkDiagram`, `Finding` (checks.ts); `libraryLookup` (Task 3); `loadSheet`, `printJson`, `CliError`, `EXIT`, `Io` (Task 9); test helpers (Task 9); `ledNetlist` (Task 6).
- Produces:
  - `src/agent/notChecked.ts`: `NOT_CHECKED: string[]`
  - `src/cli/verifyCmd.ts`: `interface CliFinding { id: string; rule: string; severity: 'error' | 'warning'; message: string; parts: string[]; pins: Endpoint[]; wires: string[] }`, `cliFinding(f: CliFinding): CliFinding`, `findingsText(findings: CliFinding[]): string`, `notCheckedText(): string`, `verifyCommand`, `checkCommand`

- [ ] **Step 1: Write the failing test**

Create `src/cli/verifyCmd.test.ts`:

```ts
// circuitoon verify and check: exit codes, stable finding ids, JSON schema, the not-checked list,
// and check working on a sheet without an intent.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const edit = (dir: string, change: (sheet: Record<string, unknown> & { connections: Record<string, unknown>[] }) => void) => {
  const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
  change(sheet)
  writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
}

describe('circuitoon verify and check', () => {
  it('passes a laid-out sheet, with JSON matching the schema and the not-checked list', async () => {
    const dir = await laidOut()
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(0)
    const out = JSON.parse(v.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/verify/1', ok: true, findings: [] })
    expect(out.notChecked.join(' ')).toContain('I2C and SPI addresses')
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    expect(schemaErrors(loadSchema('findings'), JSON.parse(c.out))).toEqual([])
    expect((await cli(['verify', 'sheet.json'], { cwd: dir })).out).toContain('Not checked:')
  })
  it('blocks a second wire on a header pin (exit 1) with a stable id', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const w = s.connections.find((c) => (c.from as { part: string }).part === 'BT1')!
      s.connections.push({ ...w, uid: 'hand' })
    })
    const a = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    const b = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(a.code).toBe(1)
    const ids = JSON.parse(a.out).findings.map((f: { id: string }) => f.id)
    expect(ids.some((id: string) => id.startsWith('capacity|'))).toBe(true)
    expect(JSON.parse(b.out).findings.map((f: { id: string }) => f.id)).toEqual(ids)
  })
  it('verify needs an intent; check still works without one', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(1)
    expect(JSON.parse(v.out).findings.map((f: { message: string }) => f.message)).toEqual([NO_INTENT])
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(JSON.parse(c.out).findings.some((f: { message: string }) => f.message === NO_INTENT)).toBe(false)
  })
  it('exits 2 on a file that is not a sheet', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'x.json'), '{"format":"nope"}')
    expect((await cli(['verify', 'x.json'], { cwd: dir })).code).toBe(2)
    expect((await cli(['check', 'missing.json'], { cwd: dir })).code).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/verifyCmd.test.ts`
Expected: FAIL: `unknown command "verify"` (exit 2 where 0 is expected).

- [ ] **Step 3: Implement**

Create `src/agent/notChecked.ts`:

```ts
// What the toolkit does not check (agent toolkit spec 5). Every verify, check and gate output ends
// with this list, and the skill tells the agent to report it to the user.
export const NOT_CHECKED: string[] = [
  'Current and heat: wire gauge against current, regulator and battery limits, and part temperatures.',
  'I2C and SPI addresses and bus conflicts.',
  'Required configuration inputs left floating (for example an MCP23017 RESET or its address pins): unless the intent lists them, they are only as checked as the checker\'s no-power rules.',
  'Firmware behaviour: pin modes, pull-ups, boot strapping pins.',
  'Timing and signal integrity.',
  'Mechanical fit: enclosures, connector sizes and cable lengths.',
  'Mains wiring beyond its connections.',
  'Each part\'s own correctness beyond its cited sources; custom parts embedded in the netlist are unverified.',
]
```

Create `src/cli/verifyCmd.ts`:

```ts
// `circuitoon verify <sheet.json>` and `circuitoon check <sheet.json>` (agent toolkit spec 3 and
// 4.2): findings with stable ids, rule, severity, message, parts, pins and wires, then what is not
// checked. verify compares the sheet with its intent; check runs the wiring checker and, when the
// sheet has an intent, verify too. Exit 1 when an error blocks.
import type { Endpoint } from '../format/diagram.ts'
import { checkDiagram } from '../format/checks.ts'
import { verifyDiagram } from '../agent/verify.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, loadSheet, printJson } from './io.ts'

export interface CliFinding {
  id: string
  rule: string
  severity: 'error' | 'warning'
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

/** Only the fields every finding output carries, whatever produced it. */
export const cliFinding = (f: CliFinding): CliFinding => ({ id: f.id, rule: f.rule, severity: f.severity, message: f.message, parts: f.parts, pins: f.pins, wires: f.wires })

export const findingsText = (findings: CliFinding[]): string => findings.map((f) => `${f.severity.toUpperCase()} ${f.rule}: ${f.message}`).join('\n')
export const notCheckedText = (): string => ['Not checked:', ...NOT_CHECKED.map((n) => `  - ${n}`)].join('\n')

function report(io: Io, args: Args, format: string, findings: CliFinding[]): number {
  const ok = !findings.some((f) => f.severity === 'error')
  if (args.flags.has('--json')) printJson(io, { format, ok, findings, notChecked: NOT_CHECKED })
  else io.stdout(`${findings.length ? findingsText(findings) : 'No findings.'}\n${notCheckedText()}\n`)
  return ok ? EXIT.ok : EXIT.blocked
}

export function verifyCommand(args: Args, io: Io): number {
  const [input] = args.positionals
  if (!input) throw new CliError('verify: give a sheet file', EXIT.input)
  const { diagram } = loadSheet(io, input)
  return report(io, args, 'circuitoon-cli/verify/1', verifyDiagram(diagram, libraryLookup).map(cliFinding))
}

export function checkCommand(args: Args, io: Io): number {
  const [input] = args.positionals
  if (!input) throw new CliError('check: give a sheet file', EXIT.input)
  const { diagram } = loadSheet(io, input)
  const verified = diagram.intent !== undefined ? verifyDiagram(diagram, libraryLookup) : []
  return report(io, args, 'circuitoon-cli/check/1', [...verified, ...checkDiagram(diagram)].map(cliFinding))
}
```

Create `plugin/skills/circuitoon-design/references/schemas/findings.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon verify --json and circuitoon check --json",
  "type": "object",
  "required": ["format", "ok", "findings", "notChecked"],
  "additionalProperties": false,
  "properties": {
    "format": { "enum": ["circuitoon-cli/verify/1", "circuitoon-cli/check/1"] },
    "ok": { "type": "boolean" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "rule", "severity", "message", "parts", "pins", "wires"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "rule": { "type": "string" },
          "severity": { "enum": ["error", "warning"] },
          "message": { "type": "string" },
          "parts": { "type": "array", "items": { "type": "string" } },
          "pins": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["part", "pin"],
              "additionalProperties": false,
              "properties": { "part": { "type": "string" }, "pin": { "type": "string" }, "hole": { "type": "integer" }, "offset": { "type": "integer" } }
            }
          },
          "wires": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "notChecked": { "type": "array", "items": { "type": "string" } }
  }
}
```

In `src/cli/main.ts` add `import { checkCommand, verifyCommand } from './verifyCmd.ts'` and extend the registry:

```ts
export const COMMANDS: Record<string, Command> = { parts: partsCommand, part: partCommand, layout: layoutCommand, render: renderCommand, verify: verifyCommand, check: checkCommand }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli`
Expected: PASS.

- [ ] **Step 5: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/notChecked.ts src/cli plugin
git commit -m "circuitoon verify and check: stable findings, JSON schema, the not-checked list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Link codec and `circuitoon link`

The link format of spec 6, shared by the site and the CLI: `#/editor?d=v1.<base64url(deflate-raw(json))>`, encoded payload up to 64 KB (the CLI refuses larger and writes the file instead), decompression aborting past 5 MB, 2,000 parts or 10,000 connections, and malformed input reported like a failed file load.

**Files:**
- Create: `src/format/link.ts`, `src/cli/linkCmd.ts`, `plugin/skills/circuitoon-design/references/schemas/link.schema.json`
- Modify: `src/cli/main.ts` (register `link`)
- Test: `src/format/link.test.ts`, `src/cli/linkCmd.test.ts`

**Interfaces:**
- Consumes: `serializeDiagram`, `validateDiagram`, `Diagram` (diagram.ts); `isObj` (module.ts); `exportFileName` (src/editor/files.ts); CLI io and test helpers (Task 9).
- Produces:
  - `src/format/link.ts`: `SITE_URL = 'https://mbarc.github.io/circuitoon/'`, `LINK_VERSION = 'v1.'`, `LINK_MAX_CHARS = 65536`, `LINK_MAX_JSON_BYTES = 5 * 1024 * 1024`, `LINK_MAX_PARTS = 2000`, `LINK_MAX_CONNECTIONS = 10000`, `LINK_NOTICE`, `encodePayload(json: string): Promise<string>`, `decodePayload(payload: string): Promise<{ ok: true; json: string } | { ok: false; message: string }>`, `openLinkPayload(payload: string): Promise<{ ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }>`, `diagramLink(d: Diagram, base?: string, max?: number): Promise<{ ok: true; url: string; chars: number } | { ok: false; chars: number }>`, `payloadFromHash(hash: string): string | null`
  - `src/cli/linkCmd.ts`: `linkFor(d: Diagram, dir: string, io: Io): Promise<{ url: string | null; file: string | null; chars: number }>`, `linkCommand`

- [ ] **Step 1: Write the failing tests**

Create `src/format/link.test.ts`:

```ts
// Diagram links (spec 6): round trip, the 64 KB refusal, damaged payloads, the 5 MB, 2,000-part and
// 10,000-connection limits, and where the payload is read from.
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { LINK_MAX_CHARS, LINK_NOTICE, diagramLink, encodePayload, openLinkPayload, payloadFromHash } from './link.ts'
import { serializeDiagram } from './diagram.ts'
import { buttonLed } from '../samples/buttonLed.ts'

const raw = (bytes: Buffer) => `v1.${deflateRawSync(bytes).toString('base64url')}`
const sheet = (parts: number, connections: number) =>
  JSON.stringify({
    format: 'circuitoon-diagram/1', title: 't', modules: {},
    parts: Array.from({ length: parts }, (_, i) => ({ uid: `p${i}`, designator: `R${i}`, module: 'resistor', x: 0, y: 0 })),
    connections: Array.from({ length: connections }, (_, i) => ({ uid: `w${i}`, from: { part: 'p0', pin: '1' }, to: { part: 'p0', pin: '2' } })),
  })

describe('diagram links', () => {
  it('round-trips a diagram through the URL fragment', async () => {
    const r = await diagramLink(buttonLed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url.startsWith('https://mbarc.github.io/circuitoon/#/editor?d=v1.')).toBe(true)
    const opened = await openLinkPayload(payloadFromHash(new URL(r.url).hash)!)
    expect(opened).toEqual({ ok: true, diagram: JSON.parse(serializeDiagram(buttonLed)), warnings: [] })
  })
  it('refuses to make a link over the limit, which is 64 KB of payload', async () => {
    expect(LINK_MAX_CHARS).toBe(65536)
    const r = await diagramLink(buttonLed, 'https://example.test/', 10)
    expect(r.ok).toBe(false)
    expect(r.chars).toBeGreaterThan(10)
  })
  it('reports damaged payloads as a load error, never a throw', async () => {
    for (const p of ['v1.@@@', 'v2.abc', 'v1.', raw(Buffer.from('not deflate at all')).replace('v1.', 'v1.AAAA'), raw(Buffer.from('{"format": 1'))]) {
      const r = await openLinkPayload(p)
      expect(r.ok, p).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/damaged|not a Circuitoon diagram/)
    }
  })
  it('aborts decompression past 5 MB', async () => {
    const big = raw(Buffer.alloc(6 * 1024 * 1024, 32))
    expect(big.length).toBeLessThan(LINK_MAX_CHARS)
    expect(await openLinkPayload(big)).toEqual({ ok: false, message: 'This link holds a diagram larger than 5 MB, so it was not opened.' })
  })
  it('refuses more than 2,000 parts or 10,000 connections', async () => {
    const parts = await openLinkPayload(await encodePayload(sheet(2001, 0)))
    expect(parts.ok).toBe(false)
    if (!parts.ok) expect(parts.message).toContain('2,001 parts')
    const wires = await openLinkPayload(await encodePayload(sheet(1, 10001)))
    expect(wires.ok).toBe(false)
    if (!wires.ok) expect(wires.message).toContain('10,001 connections')
  })
  it('reads a payload only from the editor route', () => {
    expect(payloadFromHash('#/editor?d=v1.abc')).toBe('v1.abc')
    expect(payloadFromHash('#/editor')).toBe(null)
    expect(payloadFromHash('#/?d=v1.abc')).toBe(null)
  })
  it('says who can see a link and that nothing is uploaded', () => {
    expect(LINK_NOTICE).toBe('Anyone with this link can see the diagram: it is stored in the link itself. Nothing is uploaded.')
  })
})
```

Create `src/cli/linkCmd.test.ts`:

```ts
// circuitoon link: a URL plus the notice; over the limit, no link and the sheet written as a file.
import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateDiagram } from '../format/diagram.ts'
import { LINK_NOTICE } from '../format/link.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}

describe('circuitoon link', () => {
  it('prints a link and the notice', async () => {
    const dir = await laidOut()
    const r = await cli(['link', 'sheet.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('link'), out)).toEqual([])
    expect(out.url.startsWith('https://mbarc.github.io/circuitoon/#/editor?d=v1.')).toBe(true)
    expect(out.notice).toBe(LINK_NOTICE)
    expect((await cli(['link', 'sheet.json'], { cwd: dir })).out).toContain(LINK_NOTICE)
  })
  it('refuses an oversized link and writes the sheet as a file to import instead', async () => {
    const dir = await laidOut()
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    sheet.annotations = Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}`, type: 'text', x: 0, y: i * 40, text: randomBytes(360).toString('base64') }))
    writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
    const r = await cli(['link', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('link'), out)).toEqual([])
    expect(out).toMatchObject({ ok: false, url: null })
    expect(out.chars).toBeGreaterThan(65536)
    expect(existsSync(join(dir, out.file))).toBe(true)
    expect(validateDiagram(JSON.parse(readFileSync(join(dir, out.file), 'utf8'))).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/link.test.ts src/cli/linkCmd.test.ts`
Expected: FAIL: cannot resolve `./link.ts`.

- [ ] **Step 3: Implement the codec**

Create `src/format/link.ts`:

```ts
// Diagram links (agent toolkit spec 6): `#/editor?d=v1.<base64url(deflate-raw(json))>`. The diagram
// travels in the URL fragment, which browsers never send to a server, so nothing is uploaded; anyone
// with the link can see the diagram. Encoding and decoding use the web CompressionStream API, which
// the browser and Node 22+ both have, so the site and the CLI share this file.
import { type Diagram, serializeDiagram, validateDiagram } from './diagram.ts'
import { isObj } from './module.ts'

export const SITE_URL = 'https://mbarc.github.io/circuitoon/'
export const LINK_VERSION = 'v1.'
/** Longest payload a link may carry, in characters (64 KB). */
export const LINK_MAX_CHARS = 64 * 1024
/** Decompression stops here: the file import limit (5 MB). */
export const LINK_MAX_JSON_BYTES = 5 * 1024 * 1024
export const LINK_MAX_PARTS = 2000
export const LINK_MAX_CONNECTIONS = 10_000
export const LINK_NOTICE = 'Anyone with this link can see the diagram: it is stored in the link itself. Nothing is uploaded.'

const DAMAGED = 'This link is damaged (it could not be decoded), so nothing was opened.'
const TOO_BIG = 'This link holds a diagram larger than 5 MB, so it was not opened.'

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export async function encodePayload(json: string): Promise<string> {
  const packed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return LINK_VERSION + toBase64Url(new Uint8Array(packed))
}

/** The JSON text a payload holds; stops reading, and refuses, past LINK_MAX_JSON_BYTES. */
export async function decodePayload(payload: string): Promise<{ ok: true; json: string } | { ok: false; message: string }> {
  if (!payload.startsWith(LINK_VERSION)) return { ok: false, message: DAMAGED }
  const bytes = fromBase64Url(payload.slice(LINK_VERSION.length))
  if (!bytes) return { ok: false, message: DAMAGED }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > LINK_MAX_JSON_BYTES) {
        await reader.cancel()
        return { ok: false, message: TOO_BIG }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, message: DAMAGED }
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.length
  }
  try {
    return { ok: true, json: new TextDecoder('utf-8', { fatal: true }).decode(all) }
  } catch {
    return { ok: false, message: DAMAGED }
  }
}

/** A payload as the editor opens it: decoded, within the limits, and loaded like a file. Never rejects. */
export async function openLinkPayload(payload: string): Promise<{ ok: true; diagram: Diagram; warnings: string[] } | { ok: false; message: string }> {
  const r = await decodePayload(payload)
  if (!r.ok) return r
  let raw: unknown
  try {
    raw = JSON.parse(r.json)
  } catch {
    return { ok: false, message: DAMAGED }
  }
  const count = (key: string) => (isObj(raw) && Array.isArray(raw[key]) ? (raw[key] as unknown[]).length : 0)
  const parts = count('parts')
  const connections = count('connections')
  if (parts > LINK_MAX_PARTS)
    return { ok: false, message: `This link's diagram has ${parts.toLocaleString('en')} parts, more than the ${LINK_MAX_PARTS.toLocaleString('en')} a link may carry, so it was not opened.` }
  if (connections > LINK_MAX_CONNECTIONS)
    return { ok: false, message: `This link's diagram has ${connections.toLocaleString('en')} connections, more than the ${LINK_MAX_CONNECTIONS.toLocaleString('en')} a link may carry, so it was not opened.` }
  try {
    const v = validateDiagram(raw)
    if (!v.ok) return { ok: false, message: `This link is not a Circuitoon diagram: ${v.errors.slice(0, 3).join('; ')}` }
    return { ok: true, diagram: v.diagram, warnings: v.warnings }
  } catch (err) {
    return { ok: false, message: `This link could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** A link that opens `d` in the editor, or the payload size when it is over `max`. */
export async function diagramLink(d: Diagram, base = SITE_URL, max = LINK_MAX_CHARS): Promise<{ ok: true; url: string; chars: number } | { ok: false; chars: number }> {
  const payload = await encodePayload(serializeDiagram(d))
  return payload.length > max ? { ok: false, chars: payload.length } : { ok: true, url: `${base}#/editor?d=${payload}`, chars: payload.length }
}

/** The payload of an editor link hash (`#/editor?d=...`), or null for any other hash. */
export function payloadFromHash(hash: string): string | null {
  if (!hash.startsWith('#/editor?')) return null
  return new URLSearchParams(hash.slice('#/editor?'.length)).get('d')
}
```

If TypeScript 7 rejects `new Blob([bytes])` for a `Uint8Array<ArrayBufferLike>`, keep the `Uint8Array<ArrayBuffer>` return type of `fromBase64Url` as written (it is what `Uint8Array.from` returns).

- [ ] **Step 4: Implement the command**

Create `plugin/skills/circuitoon-design/references/schemas/link.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon link --json",
  "type": "object",
  "required": ["format", "ok", "url", "chars", "file", "notice"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/link/1" },
    "ok": { "type": "boolean" },
    "url": { "type": ["string", "null"] },
    "chars": { "type": "integer" },
    "file": { "type": ["string", "null"] },
    "notice": { "type": "string" }
  }
}
```

Create `src/cli/linkCmd.ts`:

```ts
// `circuitoon link <sheet.json> [-o <dir>]` (agent toolkit spec 6): a URL that opens the sheet in
// Circuitoon. Over 64 KB of payload no link is made; the sheet is written as <title>.circuitoon.json
// in the output directory (default: next to the sheet) for the user to open with Import JSON.
import { dirname, join } from 'node:path'
import { type Diagram, serializeDiagram } from '../format/diagram.ts'
import { LINK_MAX_CHARS, LINK_NOTICE, diagramLink } from '../format/link.ts'
import { exportFileName } from '../editor/files.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, printJson, writeFile } from './io.ts'

/** The link for `d`, or the file written instead when it is too long. */
export async function linkFor(d: Diagram, dir: string, io: Io): Promise<{ url: string | null; file: string | null; chars: number }> {
  const r = await diagramLink(d)
  if (r.ok) return { url: r.url, file: null, chars: r.chars }
  const file = join(dir, exportFileName(d.title))
  writeFile(io, file, serializeDiagram(d))
  return { url: null, file, chars: r.chars }
}

export async function linkCommand(args: Args, io: Io): Promise<number> {
  const [input] = args.positionals
  if (!input) throw new CliError('link: give a sheet file', EXIT.input)
  const { diagram } = loadSheet(io, input)
  const r = await linkFor(diagram, flag(args, '--out') ?? dirname(input), io)
  if (args.flags.has('--json')) printJson(io, { format: 'circuitoon-cli/link/1', ok: r.url !== null, url: r.url, chars: r.chars, file: r.file, notice: LINK_NOTICE })
  else if (r.url) io.stdout(`${r.url}\n${LINK_NOTICE}\n`)
  else io.stdout(`The link would be ${r.chars} characters, over the ${LINK_MAX_CHARS} limit, so no link was made. Wrote ${r.file}: open it in Circuitoon with Import JSON.\n`)
  return EXIT.ok
}
```

In `src/cli/main.ts` add `import { linkCommand } from './linkCmd.ts'` and extend the registry with `link: linkCommand`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/format/link.test.ts src/cli`
Expected: PASS.

- [ ] **Step 6: Document the link in the PRD**

In `docs/PRD.md`, section "Import, export and saving", add after the table:

```markdown
**Links.** `#/editor?d=v1.<payload>` opens a diagram carried in the URL fragment: the payload is the diagram JSON, compressed with raw deflate and written in base64url. A payload may be up to 64 KB; opening stops past 5 MB of JSON, 2,000 parts or 10,000 connections, and a damaged or oversized payload shows the usual load error. After loading, the address bar goes back to `#/editor` without reloading the editor. The fragment is never sent to a server, so nothing is uploaded, but anyone with the link can see the diagram. `circuitoon link` makes these links.
```

- [ ] **Step 7: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/format/link.ts src/format/link.test.ts src/cli plugin docs/PRD.md
git commit -m "Diagram links: v1 payload codec with limits, and circuitoon link with the file fallback

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: The editor opens links without remounting

`#/editor?d=...` opens its diagram; the payload then leaves the address bar with `history.replaceState` to `#/editor`. `App` keys its `ErrorBoundary` on the route (the hash before `?`), so neither the cleanup nor any later same-route hashchange remounts the editor or loses the open document. Damaged or oversized payloads show the usual load error on the start screen. Reload shows the start screen, as today (there is no autosave yet).

**Files:**
- Create: `src/route.ts`, `scripts/lib/browser-check.mjs`, `scripts/check-link-ui.mjs`
- Modify: `src/App.tsx`, `src/editor/EditorApp.tsx`, `src/editor/Editor.tsx`, `src/editor/StartScreen.tsx`, `package.json` (script `check:link-ui`)
- Test: `src/route.test.ts`, browser check `scripts/check-link-ui.mjs`

**Interfaces:**
- Consumes: `openLinkPayload`, `payloadFromHash`, `encodePayload` (Task 13).
- Produces:
  - `src/route.ts`: `routeOf(hash: string): string`
  - `Editor` prop `onDirty?: (dirty: boolean) => void`; `StartScreen` props `notice?: string | null`, `busy?: boolean`
  - `scripts/lib/browser-check.mjs`: `flagOf(name, fallback): string`, `startPreview(port): Promise<{ base: string }>`, `launchChrome(): Promise<Browser>`, `checker(): { check(ok: boolean, what: string): void; done(): void }`
  - `npm run check:link-ui`

- [ ] **Step 1: Write the failing unit test**

Create `src/route.test.ts`:

```ts
// The App's route key: a link payload in the hash is the same route as the plain editor.
import { describe, expect, it } from 'vitest'
import { routeOf } from './route.ts'

describe('routeOf', () => {
  it('drops the query, so #/editor?d=... and #/editor are one route', () => {
    expect(routeOf('#/editor?d=v1.abc')).toBe('#/editor')
    expect(routeOf('#/editor')).toBe('#/editor')
    expect(routeOf('#/')).toBe('#/')
    expect(routeOf('')).toBe('')
  })
})
```

Run: `npx vitest run src/route.test.ts`
Expected: FAIL: cannot resolve `./route.ts`.

- [ ] **Step 2: Key the App on the route**

Create `src/route.ts`:

```ts
// The route of a location hash: everything before its query. "#/editor?d=..." is "#/editor", so a
// link payload and its cleanup never count as a navigation (App keys the page on this).
export function routeOf(hash: string): string {
  const q = hash.indexOf('?')
  return q < 0 ? hash : hash.slice(0, q)
}
```

In `src/App.tsx` add `import { routeOf } from './route.ts'` and replace the `App` body with:

```tsx
export function App() {
  const hash = useHash()
  const route = routeOf(hash)
  // Keyed on the route (not the whole hash) so following a link out of the error screen starts
  // fresh, while a link payload leaving the address bar (#/editor?d=... to #/editor) keeps the open
  // editor mounted with its document.
  return <ErrorBoundary key={route}>{route.startsWith('#/editor') ? <EditorApp /> : <Landing />}</ErrorBoundary>
}
```

Run: `npx vitest run src/route.test.ts`
Expected: PASS.

- [ ] **Step 3: Open links in the editor**

In `src/editor/Editor.tsx`, add the prop and report the dirty state (after `useUnloadGuard(store)`):

```tsx
export function Editor({ initial, warnings, onClose, onDirty }: { initial: Diagram; warnings?: string[]; onClose: () => void; onDirty?: (dirty: boolean) => void }) {
  const store = useMemo(() => new EditorStore(initial), [initial])
  const canvasApi = useRef<{ addAtCenter: (moduleId: string) => void } | null>(null)
  useEditorKeys(store)
  useUnloadGuard(store)
  const dirty = useSyncExternalStore(store.subscribe, () => store.dirty)
  useEffect(() => onDirty?.(dirty), [dirty, onDirty])
```

In `src/editor/StartScreen.tsx`, change the signature and the error line:

```tsx
export function StartScreen({ onOpen, notice = null, busy = false }: { onOpen: (d: Diagram, warnings?: string[]) => void; notice?: string | null; busy?: boolean }) {
```

and replace `{error && <p className="start-error" role="alert">{error}</p>}` with:

```tsx
        {busy && <p className="hint" role="status">Opening the linked diagram...</p>}
        {(error ?? notice) && <p className="start-error" role="alert">{error ?? notice}</p>}
```

Replace `src/editor/EditorApp.tsx` with:

```tsx
// The editor route: the start screen or an open sheet. A link (#/editor?d=...) opens its diagram;
// the payload then leaves the address bar with history.replaceState, which fires no hashchange, and
// App keys on the route, so nothing remounts and the open document stays.
import { useEffect, useRef, useState } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { openLinkPayload, payloadFromHash } from '../format/link.ts'
import { StartScreen } from './StartScreen.tsx'
import { Editor } from './Editor.tsx'

type Doc = { diagram: Diagram; warnings?: string[]; key: number }

/** Back to `#/editor`, keeping the path and query, without a navigation. */
function clearPayload() {
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/editor`)
}

export function EditorApp() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const docRef = useRef<Doc | null>(null)
  docRef.current = doc
  const dirty = useRef(false)

  useEffect(() => {
    let seq = 0
    const check = () => {
      const payload = payloadFromHash(location.hash)
      if (payload === null) return
      const mine = ++seq
      setOpening(true)
      void openLinkPayload(payload).then((r) => {
        if (mine !== seq) return
        setOpening(false)
        clearPayload()
        if (!r.ok) {
          if (docRef.current) window.alert(r.message)
          else setLinkError(r.message)
          return
        }
        const open = docRef.current
        if (open && dirty.current && !window.confirm(`Discard unsaved changes to ${open.diagram.title} and open the linked diagram?`)) return
        dirty.current = false
        setLinkError(null)
        setDoc({ diagram: r.diagram, warnings: r.warnings, key: Date.now() })
      })
    }
    check()
    window.addEventListener('hashchange', check)
    return () => {
      seq++
      window.removeEventListener('hashchange', check)
    }
  }, [])

  if (!doc)
    return (
      <StartScreen
        notice={linkError}
        busy={opening}
        onOpen={(diagram, warnings) => {
          setLinkError(null)
          setDoc({ diagram, warnings, key: Date.now() })
        }}
      />
    )
  return <Editor key={doc.key} initial={doc.diagram} warnings={doc.warnings} onClose={() => setDoc(null)} onDirty={(v) => (dirty.current = v)} />
}
```

(`onDirty` is a new arrow each render; the effect in `Editor` then re-runs with the same value, which is harmless. `window.alert` is used only when a document is already open, where the start screen's error line is not visible.)

- [ ] **Step 4: Add the shared browser-check helpers**

Create `scripts/lib/browser-check.mjs`:

```js
// Shared by the browser checks (check-link-ui, check-annotations-ui, check-examples): serve the built
// site with `vite preview`, launch the locally installed Chrome through playwright-core (never the
// shared Playwright MCP browser), read flags, and count failures.
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)

/** The value after `name` on the command line, or `fallback`. */
export function flagOf(name, fallback) {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}

/** Starts `vite preview` on `port` (stopped when the process exits) and waits until it answers. */
export async function startPreview(port) {
  if (!existsSync('dist/index.html')) {
    console.error('No build found. Run `npm run build` first.')
    process.exit(2)
  }
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' })
  process.on('exit', () => {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
      else server.kill('SIGTERM')
    } catch {
      // already gone
    }
  })
  const base = `http://localhost:${port}/circuitoon/`
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { base }
}

export const launchChrome = () => chromium.launch({ channel: 'chrome', headless: true })

/** `check(ok, what)` prints each result; `done()` exits 1 when any failed. */
export function checker() {
  const failures = []
  return {
    check(ok, what) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
      if (!ok) failures.push(what)
    },
    done() {
      if (failures.length) {
        console.error(`${failures.length} check(s) failed`)
        process.exit(1)
      }
      console.log('all checks passed')
    },
  }
}
```

- [ ] **Step 5: Write the browser check**

Create `scripts/check-link-ui.mjs`:

```js
// Browser check for diagram links (agent toolkit spec 6): a link opens its diagram; the payload
// leaves the address bar; an edit made after loading survives a same-route hashchange with the
// editor still mounted (the App keys on the route); reload shows the start screen; damaged,
// oversized and too-many-parts payloads show the usual load error and never crash the page. Saves
// light and dark screenshots of the opened link.
//
// Usage (after `npm run build`): npm run check:link-ui -- [--out <dir>] [--port 4193]
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { encodePayload } from '../src/format/link.ts'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-link-ui')))
const port = Number(flagOf('--port', '4193'))
mkdirSync(out, { recursive: true })
const mod = (id) => JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))
const diagram = {
  format: 'circuitoon-diagram/1',
  title: 'Linked LED',
  modules: { 'battery-9v': mod('battery-9v'), resistor: mod('resistor'), led: mod('led') },
  parts: [
    { uid: 'p1', designator: 'BT1', module: 'battery-9v', x: 40, y: 90 },
    { uid: 'p2', designator: 'R1', module: 'resistor', x: 200, y: 30 },
    { uid: 'p3', designator: 'D1', module: 'led', x: 340, y: 30 },
  ],
  connections: [
    { uid: 'w1', from: { part: 'p1', pin: '+' }, to: { part: 'p2', pin: '1' }, color: 'red' },
    { uid: 'w2', from: { part: 'p2', pin: '2' }, to: { part: 'p3', pin: 'A' }, color: 'yellow' },
    { uid: 'w3', from: { part: 'p3', pin: 'K' }, to: { part: 'p1', pin: '-' }, color: 'black' },
  ],
}
const payload = await encodePayload(JSON.stringify(diagram))
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor?d=${payload}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.editor')
  check((await page.locator('.toolbar .title').textContent()) === 'Linked LED', `${scheme}: the link opens its diagram`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${scheme}: the payload left the address bar`)
  check((await page.locator('[data-part]').count()) === 3, `${scheme}: all three parts are on the canvas`)
  await page.screenshot({ path: join(out, `link-${scheme}.png`) })
  await page.evaluate(() => {
    window.__editor = document.querySelector('.editor')
  })
  await page.locator('[data-part="p2"]').click()
  await page.keyboard.press('r')
  await page.evaluate(() => {
    history.pushState(null, '', '#/editor')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  check(await page.evaluate(() => document.querySelector('.editor') === window.__editor), `${scheme}: a same-route hashchange keeps the editor mounted`)
  check((await page.locator('.inspector').textContent()).includes('Rotation: 90 degrees'), `${scheme}: the edit made after loading survives`)
  await page.reload({ waitUntil: 'networkidle' })
  check((await page.locator('.start').count()) === 1, `${scheme}: reload shows the start screen (no autosave yet)`)
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await page.close()
}

const many = { ...diagram, parts: Array.from({ length: 2001 }, (_, i) => ({ uid: `q${i}`, designator: `R${i}`, module: 'resistor', x: 0, y: 0 })) }
const bad = [
  ['damaged', 'v1.@@@', /damaged/],
  ['over 5 MB', `v1.${deflateRawSync(Buffer.alloc(6 * 1024 * 1024, 32)).toString('base64url')}`, /larger than 5 MB/],
  ['over 2,000 parts', await encodePayload(JSON.stringify(many)), /2,001 parts/],
]
for (const [name, p, message] of bad) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}#/editor?d=${p}`, { waitUntil: 'networkidle' })
  const alert = page.locator('.start-error')
  await alert.waitFor()
  check(message.test(await alert.textContent()), `${name}: the usual load error is shown`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${name}: the payload left the address bar`)
  check(errors.length === 0, `${name}: the page did not crash`)
  await page.screenshot({ path: join(out, `link-${name.replace(/\W+/g, '-')}.png`) })
  await page.close()
}
await browser.close()
done()
```

In `package.json` scripts add `"check:link-ui": "node scripts/check-link-ui.mjs",`.

- [ ] **Step 6: Run the browser check and look at it**

```bash
npm run build
npm run check:link-ui -- --out "$TEMP/circuitoon-link-ui"
```
Expected: every line `ok`, then `all checks passed`. Read `link-light.png`, `link-dark.png` and the three error screenshots: the linked sheet shows on the canvas with its title in the toolbar; each error sits on the start screen in the error style, nothing broken. To see the check fail as it should without the route key, temporarily change `key={route}` back to `key={hash}` in `App.tsx`, rebuild and rerun: the "keeps the editor mounted" check must FAIL. Restore `key={route}`.

- [ ] **Step 7: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/route.ts src/route.test.ts src/App.tsx src/editor/EditorApp.tsx src/editor/Editor.tsx src/editor/StartScreen.tsx scripts/lib/browser-check.mjs scripts/check-link-ui.mjs package.json
git commit -m "Editor: open #/editor?d= links, clear the payload without remounting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Frames and notes on the editor canvas

Spec 7 on the canvas: group frames and text notes are drawn (with the shared `FrameMark`/`NoteMark`), and can be selected, moved (one undo step, snapped to the grid), deleted, and their text edited in the Inspector. No tool for drawing new ones in this slice.

**Files:**
- Modify: `src/editor/ops.ts` (Selection, `deleteSelection`, new `moveAnnotations`, `updateAnnotation`), `src/editor/store.ts` (`prune`), `src/editor/Canvas.tsx`, `src/editor/Inspector.tsx`, `src/editor/Editor.tsx` (Delete key), `src/editor/Toolbar.tsx` (`hasSel`), `src/editor/editor.css`, `package.json` (script `check:annotations-ui`)
- Create: `scripts/check-annotations-ui.mjs`
- Test: `src/editor/annotations.test.ts`, browser check `scripts/check-annotations-ui.mjs`

**Interfaces:**
- Consumes: `FrameMark`, `NoteMark` (Task 5); `ANNOTATION_LABEL_MAX`, `ANNOTATION_TEXT_MAX` (Task 1); `checker`, `flagOf`, `launchChrome`, `startPreview` (Task 14).
- Produces (`src/editor/ops.ts`): `Selection.annotations?: string[]`, `moveAnnotations(d: Diagram, uids: string[], dx: number, dy: number): Diagram`, `updateAnnotation(d: Diagram, uid: string, patch: { label?: string; text?: string }): Diagram`; `npm run check:annotations-ui`.

- [ ] **Step 1: Write the failing test**

Create `src/editor/annotations.test.ts`:

```ts
// Frames and notes in the editor model: move (one undo step), edit (clipped to the file limits, no-ops
// skipped), delete, and the selection pruned with them.
import { describe, expect, it } from 'vitest'
import { EditorStore } from './store.ts'
import { deleteSelection, moveAnnotations, updateAnnotation } from './ops.ts'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, emptyDiagram, type Diagram } from '../format/diagram.ts'

const sheet = (): Diagram => ({
  ...emptyDiagram(),
  annotations: [
    { uid: 'a1', type: 'frame', x: 0, y: 0, w: 100, h: 60, label: 'Power' },
    { uid: 'a2', type: 'text', x: 10, y: 80, text: 'Note' },
  ],
})

describe('annotation edits', () => {
  it('moves a note as one undo step', () => {
    const s = new EditorStore(sheet())
    const base = s.begin()
    s.preview(moveAnnotations(base, ['a2'], 20, 10))
    s.end()
    expect(s.getState().diagram.annotations![1]).toMatchObject({ x: 30, y: 90 })
    s.undo()
    expect(s.getState().diagram.annotations![1]).toMatchObject({ x: 10, y: 80 })
  })
  it('returns the same diagram for a zero move or an unchanged edit', () => {
    const d = sheet()
    expect(moveAnnotations(d, ['a1'], 0, 0)).toBe(d)
    expect(updateAnnotation(d, 'a1', { label: 'Power' })).toBe(d)
    expect(updateAnnotation(d, 'nope', { label: 'x' })).toBe(d)
  })
  it('clips labels and text to the file limits, and drops an empty label', () => {
    const d = sheet()
    expect(updateAnnotation(d, 'a1', { label: 'x'.repeat(100) }).annotations![0].label).toHaveLength(ANNOTATION_LABEL_MAX)
    expect(updateAnnotation(d, 'a2', { text: 'y'.repeat(600) }).annotations![1].text).toHaveLength(ANNOTATION_TEXT_MAX)
    expect('label' in updateAnnotation(d, 'a1', { label: '' }).annotations![0]).toBe(false)
  })
  it('deletes selected annotations and prunes them from the selection', () => {
    const d = sheet()
    expect(deleteSelection(d, { parts: [], wires: [], annotations: ['a1'] }).annotations!.map((a) => a.uid)).toEqual(['a2'])
    expect(deleteSelection(emptyDiagram(), { parts: [], wires: [] })).not.toHaveProperty('annotations')
    const s = new EditorStore(d)
    s.select({ parts: [], wires: [], annotations: ['a1', 'a2'] })
    s.commit(deleteSelection(d, { parts: [], wires: [], annotations: ['a1'] }))
    expect(s.getState().selection).toEqual({ parts: [], wires: [], annotations: ['a2'] })
  })
})
```

Run: `npx vitest run src/editor/annotations.test.ts`
Expected: FAIL: `moveAnnotations` is not exported.

- [ ] **Step 2: The model**

In `src/editor/ops.ts`, import `ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX` from `../format/diagram.ts` and replace `Selection`:

```ts
export interface Selection {
  parts: string[]
  wires: string[]
  /** Selected frames and notes, by uid; absent means none. */
  annotations?: string[]
}
```

Replace `deleteSelection`:

```ts
export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  const notes = new Set(sel.annotations ?? [])
  return {
    ...d,
    // A deleted board's parts stay on the sheet, unmounted.
    parts: d.parts.filter((p) => !parts.has(p.uid)).map((p) => (p.mount && parts.has(p.mount.board) ? withoutMount(p) : p)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
    ...(d.annotations && notes.size ? { annotations: d.annotations.filter((a) => !notes.has(a.uid)) } : {}),
  }
}
```

Add after `updateWire`:

```ts
/** Moves frames and notes; returns `d` itself for a zero move. A frame moves alone, not its parts. */
export function moveAnnotations(d: Diagram, uids: string[], dx: number, dy: number): Diagram {
  if ((!dx && !dy) || !d.annotations) return d
  const s = new Set(uids)
  return { ...d, annotations: d.annotations.map((a) => (s.has(a.uid) ? { ...a, x: a.x + dx, y: a.y + dy } : a)) }
}

/** Sets a frame's label or a note's text, clipped to the file limits; returns `d` itself when nothing changes. */
export function updateAnnotation(d: Diagram, uid: string, patch: { label?: string; text?: string }): Diagram {
  const a = d.annotations?.find((x) => x.uid === uid)
  if (!a) return d
  const next = { ...a }
  if (patch.label !== undefined) {
    const label = patch.label.slice(0, ANNOTATION_LABEL_MAX)
    if (label) next.label = label
    else delete next.label
  }
  if (patch.text !== undefined) next.text = patch.text.slice(0, ANNOTATION_TEXT_MAX)
  if (next.label === a.label && next.text === a.text && ('label' in next) === ('label' in a)) return d
  return { ...d, annotations: d.annotations!.map((x) => (x === a ? next : x)) }
}
```

In `src/editor/store.ts` replace `prune`:

```ts
  private prune(d: Diagram, sel: Selection): Selection {
    const parts = new Set(d.parts.map((p) => p.uid))
    const wires = new Set(d.connections.map((c) => c.uid))
    const notes = new Set((d.annotations ?? []).map((a) => a.uid))
    const kept = { parts: sel.parts.filter((u) => parts.has(u)), wires: sel.wires.filter((u) => wires.has(u)) }
    const annotations = sel.annotations?.filter((u) => notes.has(u)) ?? []
    return annotations.length ? { ...kept, annotations } : kept
  }
```

Run: `npx vitest run src/editor`
Expected: PASS (existing store and ops tests keep `{ parts, wires }` selections, which stay without an `annotations` key).

- [ ] **Step 3: Draw, select and drag them on the canvas**

In `src/editor/Canvas.tsx`:

Add imports `import { FrameMark, NoteMark } from '../render/Annotations.tsx'` and add `moveAnnotations` to the `./ops.ts` import list.

Extend the `Drag` union with:

```ts
  | { kind: 'annotations'; start: Pt; uids: string[]; base: Diagram }
```

Right after `<rect x={view.x} y={view.y} width={vw} height={vh} fill="url(#editor-grid)" />` add the frames (below the boards, as in the Sheet):

```tsx
        {(diagram.annotations ?? []).filter((a) => a.type === 'frame').map((a) => (
          <FrameMark key={a.uid} a={a} interactive selected={!!selection.annotations?.includes(a.uid)} />
        ))}
```

After the name-tag `<g>...</g>` layer and before the broken-connection stubs comment, add the notes:

```tsx
        {(diagram.annotations ?? []).filter((a) => a.type === 'text').map((a) => (
          <NoteMark key={a.uid} a={a} interactive selected={!!selection.annotations?.includes(a.uid)} />
        ))}
```

In `onPointerDown`, immediately before `const partEl = e.button === 0 ? target.closest('[data-part]') : null`, add:

```tsx
    const noteEl = e.button === 0 ? target.closest('[data-annotation]') : null
    if (noteEl) {
      const uid = noteEl.getAttribute('data-annotation')!
      const sel = store.getState().selection
      let notes = sel.annotations ?? []
      if (e.shiftKey) notes = notes.includes(uid) ? notes.filter((u) => u !== uid) : [...notes, uid]
      else if (!notes.includes(uid)) notes = [uid]
      store.select({ parts: e.shiftKey ? sel.parts : [], wires: e.shiftKey ? sel.wires : [], annotations: notes })
      if (notes.includes(uid)) {
        setDrag({ pointer, kind: 'annotations', start: toWorld(e), uids: notes, base: store.begin() })
        store.setGesture(true)
      }
      return
    }
```

In `onPointerMove`, before the `else if (drag.kind === 'segment')` branch, add:

```tsx
    else if (drag.kind === 'annotations') {
      if (!store.dragging) return
      const p = toWorld(e)
      store.preview(moveAnnotations(drag.base, drag.uids, snap(p.x - drag.start.x), snap(p.y - drag.start.y)))
    }
```

In `onPointerUp` after `if (drag.kind === 'segment') store.end()` add `if (drag.kind === 'annotations') store.end()`; in `onPointerCancel` after its `segment` line add `if (drag.kind === 'annotations') store.end()`. In the Escape effect, extend the condition to include `drag?.kind !== 'annotations'`:

```tsx
    if (drag?.kind !== 'wire' && drag?.kind !== 'parts' && drag?.kind !== 'reconnect' && drag?.kind !== 'segment' && drag?.kind !== 'annotations') return
```

(Escape mid-drag already restores the start through the editor's `store.cancel()`.)

Append to `src/editor/editor.css`:

```css
/* Frames and notes on the canvas: a frame is grabbed by its border or label tab, a note anywhere. */
.annotation-hit { fill: none; stroke: transparent; pointer-events: stroke; cursor: move; }
.annotation-grab { cursor: move; }
.annotation-selected { fill: none; stroke: var(--focus); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
```

and extend the `.field input, .field select` selector to `.field input, .field select, .field textarea` (plus `resize: vertical;` in a new `.field textarea { resize: vertical; min-height: 80px; }` rule).

- [ ] **Step 4: Inspector, Delete key and toolbar**

In `src/editor/Inspector.tsx` import `updateAnnotation` from `./ops.ts` and `ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX` from `../format/diagram.ts`. Add below `CommitInput`:

```tsx
/** A note's text: commits on blur (one undo step), trimmed; an empty note is not saved. */
function NoteInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <label className="field" htmlFor="note-text">
      Text
      <textarea
        id="note-text"
        defaultValue={value}
        maxLength={ANNOTATION_TEXT_MAX}
        rows={5}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v && v !== value) onCommit(v)
          else e.target.value = value
        }}
      />
    </label>
  )
}
```

In `Inspector`, replace the `count` line with:

```tsx
  const notes = selection.annotations ?? []
  const count = selection.parts.length + selection.wires.length + notes.length
```

and insert before `const part = diagram.parts.find(...)`:

```tsx
  const note = count === 1 && notes.length === 1 ? diagram.annotations?.find((a) => a.uid === notes[0]) : undefined
  if (note)
    return (
      <aside className="inspector" aria-label="Properties">
        <h2 id="selection-title" tabIndex={-1}>{note.type === 'frame' ? 'Group frame' : 'Note'}</h2>
        {note.type === 'frame' ? (
          <label className="field" htmlFor="frame-label">
            Label
            <input
              id="frame-label"
              key={note.label ?? ''}
              defaultValue={note.label ?? ''}
              maxLength={ANNOTATION_LABEL_MAX}
              onBlur={(e) => {
                if (e.target.value.trim() !== (note.label ?? '')) store.commit(updateAnnotation(diagram, note.uid, { label: e.target.value.trim() }))
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
        ) : (
          <NoteInput key={`${note.uid}:${note.text ?? ''}`} value={note.text ?? ''} onCommit={(v) => store.commit(updateAnnotation(diagram, note.uid, { text: v }))} />
        )}
        <p className="hint">Drag it on the sheet to move it. Delete removes it.</p>
        {remove}
      </aside>
    )
```

In `src/editor/Editor.tsx`, in the Delete/Backspace branch, change the condition to:

```tsx
        if (s.selection.parts.length || s.selection.wires.length || s.selection.annotations?.length) {
```

In `src/editor/Toolbar.tsx` change `hasSel` to:

```tsx
  const hasSel = selection.parts.length + selection.wires.length + (selection.annotations?.length ?? 0) > 0
```

- [ ] **Step 5: Write the browser check**

Create `scripts/check-annotations-ui.mjs`:

```js
// Browser check for frames and notes on the editor canvas (agent toolkit spec 7): a note is selected
// and dragged on the grid, its text edited in the Inspector, a frame's label edited, a note deleted
// and brought back with undo, and the exported file carries every change. Light and dark screenshots
// of a selected frame and note are saved for review.
//
// Usage (after `npm run build`): npm run check:annotations-ui -- [--out <dir>] [--port 4194]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-annotations-ui')))
const port = Number(flagOf('--port', '4194'))
mkdirSync(out, { recursive: true })
const resistor = JSON.parse(readFileSync('modules/resistor.json', 'utf8'))
const file = join(out, 'annotated.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Annotated', modules: { resistor },
  parts: [{ uid: 'p1', designator: 'R1', module: 'resistor', x: 60, y: 60 }],
  connections: [],
  annotations: [
    { uid: 'a1', type: 'frame', x: 40, y: 40, w: 120, h: 90, label: 'Group' },
    { uid: 'a2', type: 'text', x: 40, y: 170, text: 'A note' },
  ],
}))
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('.editor')
  const noteX = async () => Number(await page.locator('[data-annotation="a2"] rect').first().getAttribute('x'))
  const x0 = await noteX()
  const box = (await page.locator('[data-annotation="a2"] text').boundingBox())
  await page.mouse.move(box.x + 5, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 65, box.y + box.height / 2 + 30, { steps: 6 })
  await page.mouse.up()
  check((await noteX()) === x0 + 40, `${scheme}: dragging a note moves it 40 px on the grid`)
  check((await page.locator('#selection-title').textContent()) === 'Note', `${scheme}: the Inspector shows the note`)
  await page.locator('#note-text').fill('Edited note')
  await page.locator('#note-text').press('Tab')
  check((await page.locator('[data-annotation="a2"]').textContent()).includes('Edited note'), `${scheme}: editing the text updates the canvas`)
  await page.locator('[data-annotation="a1"] text').click()
  check((await page.locator('#selection-title').textContent()) === 'Group frame', `${scheme}: clicking a frame's tab selects the frame`)
  await page.locator('#frame-label').fill('Power')
  await page.locator('#frame-label').press('Enter')
  check((await page.locator('[data-annotation="a1"]').textContent()).includes('Power'), `${scheme}: editing the label updates the canvas`)
  await page.screenshot({ path: join(out, `annotations-${scheme}.png`) })
  await page.locator('[data-annotation="a2"] text').click()
  await page.keyboard.press('Delete')
  check((await page.locator('[data-annotation="a2"]').count()) === 0, `${scheme}: Delete removes the note`)
  await page.keyboard.press('Control+z')
  check((await page.locator('[data-annotation="a2"]').count()) === 1, `${scheme}: undo brings it back`)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const a1 = saved.annotations.find((a) => a.uid === 'a1')
  const a2 = saved.annotations.find((a) => a.uid === 'a2')
  check(a1.label === 'Power' && a2.text === 'Edited note' && a2.x === 80, `${scheme}: the exported file carries the moved and edited annotations`)
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await page.close()
}
await browser.close()
done()
```

In `package.json` scripts add `"check:annotations-ui": "node scripts/check-annotations-ui.mjs",`.

- [ ] **Step 6: Run the browser check and look at it**

```bash
npm run build
npm run check:annotations-ui -- --out "$TEMP/circuitoon-annotations-ui"
```
Expected: every line `ok`, then `all checks passed`. Read `annotations-light.png` and `annotations-dark.png`: the frame is a dashed rounded rectangle with its label tab, the selected frame shows the blue dashed outline, the note box is readable, and the Inspector shows the Label field. Also re-run `npm run check:warnings-ui`, `npm run check:problems-ui` and `npm run check:cables-ui` (the canvas changed): all pass.

- [ ] **Step 7: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/editor scripts/check-annotations-ui.mjs package.json
git commit -m "Editor: select, move, delete and edit group frames and notes on the canvas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: The hard gate (`circuitoon gate`)

`gate <sheet.json> -o <dir>` (spec 4.2 and 5): load, verify, check, render (full, and one focused copy when repeats exist) and link; writes the artifacts plus `gate.json` with a SHA-256 of the diagram and of each artifact; exits 0 only when nothing blocks. Warnings are listed and must be reported; the "not checked" list is always stated.

**Files:**
- Create: `src/cli/gate.ts`, `plugin/skills/circuitoon-design/references/schemas/gate.schema.json`
- Modify: `src/cli/main.ts` (register `gate`)
- Test: `src/cli/gate.test.ts`

**Interfaces:**
- Consumes: `validateDiagram`, `VALUE_DROPPED`, `computeRoutes`, `Diagram` (diagram.ts); `verifyDiagram`, `intentLookup` (Task 4); `checkDiagram` (checks.ts); `renderSheetSvg`, `focusBounds` (Task 5); `writePng` (Task 10); `linkFor` (Task 13); `LINK_MAX_CHARS` (Task 13); `NOT_CHECKED` (Task 12); `cliFinding`, `findingsText`, `notCheckedText`, `CliFinding` (Task 12); `parseNetlist` (Task 3); `quantities`, `channelTable` (Task 3); `libraryLookup` (Task 3); `endpointName` (checks.ts).
- Produces (`src/cli/gate.ts`): `interface GateArtifact { kind: 'svg' | 'png' | 'focus-png' | 'link' | 'file'; path: string; sha256: string; bytes: number }`, `interface GateReport` (the `gate.json` shape), `runGate(bytes: Uint8Array, opts: { sheetPath: string; outDir: string; io: Io }): Promise<{ code: number; report: GateReport }>`, `gateCommand`

- [ ] **Step 1: Write the failing test**

Create `src/cli/gate.test.ts`:

```ts
// circuitoon gate (spec 5): passes a laid-out sheet with hashes that match every file; blocks a missing
// intent, a dropped value override and a hand edit; blocking findings win over a missing browser; a
// missing browser alone is exit 3; an oversized link falls back to the file without blocking.
import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { VALUE_DROPPED } from '../format/diagram.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { ledNetlist, tiltSensors } from '../agent/fixtures.testing.ts'

const browser = findBrowser(process.env)
const noBrowser = (dir: string) => ({ CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') })
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const laidOut = async (netlist: unknown = ledNetlist()) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const edit = (dir: string, change: (s: Record<string, unknown> & { parts: Record<string, unknown>[]; connections: Record<string, unknown>[] }) => void) => {
  const s = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
  change(s)
  writeFileSync(join(dir, 'sheet.json'), JSON.stringify(s))
}
const gateJson = (dir: string) => JSON.parse(readFileSync(join(dir, 'out', 'gate.json'), 'utf8'))

describe('circuitoon gate', () => {
  it.skipIf(!browser)('passes a laid-out sheet, and every hash in gate.json matches its file', async () => {
    const dir = await laidOut(tiltSensors())
    const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(JSON.parse(r.out)).toEqual(g)
    expect(g.ok).toBe(true)
    expect(g.diagram.sha256).toBe(sha(join(dir, 'sheet.json')))
    expect(g.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual(['focus-png', 'link', 'png', 'svg'])
    for (const a of g.artifacts) expect(sha(join(dir, 'out', a.path)), a.path).toBe(a.sha256)
    expect(g.notChecked.length).toBeGreaterThan(0)
  }, 120_000)
  it('blocks a sheet with no intent (exit 1), even without a browser', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    expect(gateJson(dir).blocking.map((f: { message: string }) => f.message)).toContain(NO_INTENT)
  })
  it('blocks a dropped value override and a second wire on a header pin', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const r1 = s.parts.find((p) => p.uid === 'R1')!
      r1.values = { resistance: { value: 220, unit: 'F' } }
      const w = s.connections.find((c) => (c.from as { part: string }).part === 'BT1')!
      s.connections.push({ ...w, uid: 'hand' })
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const blocking = gateJson(dir).blocking as { rule: string; message: string }[]
    expect(blocking.some((f) => f.rule === 'load' && f.message.includes(VALUE_DROPPED))).toBe(true)
    expect(blocking.some((f) => f.rule === 'capacity')).toBe(true)
    expect(blocking.some((f) => f.rule === 'value-drift')).toBe(true)
  })
  it('is an environment problem (exit 3) when only the browser is missing', async () => {
    const dir = await laidOut()
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(3)
    expect(r.err + r.out).toContain('No Chrome or Edge found')
    expect(gateJson(dir).ok).toBe(false)
  })
  it.skipIf(!browser)('writes the file instead of an oversized link, as a warning, not a block', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      s.annotations = Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}`, type: 'text', x: 2000, y: i * 40, text: randomBytes(360).toString('base64') }))
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir })
    expect(r.code).toBe(0)
    const g = gateJson(dir)
    expect(g.link.url).toBe(null)
    expect(existsSync(join(dir, 'out', g.link.file))).toBe(true)
    expect(g.warnings.some((f: { rule: string }) => f.rule === 'link')).toBe(true)
  }, 120_000)
  it('exits 2 when the sheet file is missing, and needs -o', async () => {
    const dir = tempDir()
    expect((await cli(['gate', 'missing.json', '-o', 'out'], { cwd: dir })).code).toBe(2)
    expect((await cli(['gate', 'missing.json'], { cwd: dir })).code).toBe(2)
  })
})
```

Run: `npx vitest run src/cli/gate.test.ts`
Expected: FAIL: `unknown command "gate"`.

- [ ] **Step 2: Write the schema**

Create `plugin/skills/circuitoon-design/references/schemas/gate.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon gate --json and gate.json",
  "type": "object",
  "required": ["format", "ok", "diagram", "artifacts", "blocking", "warnings", "notChecked", "link", "quantities", "channels"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-gate/1" },
    "ok": { "type": "boolean" },
    "diagram": { "type": "object", "required": ["path", "sha256"], "additionalProperties": false, "properties": { "path": { "type": "string" }, "sha256": { "type": "string" } } },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "path", "sha256", "bytes"],
        "additionalProperties": false,
        "properties": {
          "kind": { "enum": ["svg", "png", "focus-png", "link", "file"] },
          "path": { "type": "string" },
          "sha256": { "type": "string" },
          "bytes": { "type": "integer" }
        }
      }
    },
    "blocking": { "type": "array", "items": { "type": "object", "required": ["id", "rule", "severity", "message", "parts", "pins", "wires"] } },
    "warnings": { "type": "array", "items": { "type": "object", "required": ["id", "rule", "severity", "message", "parts", "pins", "wires"] } },
    "notChecked": { "type": "array", "items": { "type": "string" } },
    "link": {
      "type": "object",
      "required": ["url", "file", "chars"],
      "additionalProperties": false,
      "properties": { "url": { "type": ["string", "null"] }, "file": { "type": ["string", "null"] }, "chars": { "type": "integer" } }
    },
    "quantities": { "type": "array" },
    "channels": { "type": "array" }
  }
}
```

- [ ] **Step 3: Implement the gate**

Create `src/cli/gate.ts`:

```ts
// `circuitoon gate <sheet.json> -o <dir>` (agent toolkit spec 4.2 and 5): the one command an agent
// runs before presenting anything. Load, verify, check, render (full, plus one focused copy when the
// intent has repeats) and link; write the artifacts and gate.json with a SHA-256 of the diagram and
// of each artifact. Blocking: loader errors, a missing module or dropped value override, any verify
// error (missing or invalid intent included), any checker error, any blocked route, an oversized
// link whose file fallback could not be written. Exit 0 only when nothing blocks; blocking findings
// win over a missing browser (exit 1 before 3).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { type Diagram, VALUE_DROPPED, computeRoutes, validateDiagram } from '../format/diagram.ts'
import { checkDiagram, endpointName } from '../format/checks.ts'
import { focusBounds, renderSheetSvg } from '../render/exportSvg.tsx'
import { verifyDiagram, intentLookup } from '../agent/verify.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import { type ChannelRow, type QuantityRow, channelTable, quantities } from '../agent/tables.ts'
import { LINK_MAX_CHARS, LINK_NOTICE } from '../format/link.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, pathIn, printJson, writeFile } from './io.ts'
import { type CliFinding, cliFinding, findingsText, notCheckedText } from './verifyCmd.ts'
import { writePng } from './png.ts'
import { linkFor } from './linkCmd.ts'

export interface GateArtifact {
  kind: 'svg' | 'png' | 'focus-png' | 'link' | 'file'
  /** Relative to the output directory. */
  path: string
  sha256: string
  bytes: number
}
export interface GateReport {
  format: 'circuitoon-gate/1'
  ok: boolean
  diagram: { path: string; sha256: string }
  artifacts: GateArtifact[]
  blocking: CliFinding[]
  warnings: CliFinding[]
  notChecked: string[]
  link: { url: string | null; file: string | null; chars: number }
  quantities: QuantityRow[]
  channels: ChannelRow[]
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const MISSING_MODULE = 'is not embedded in this file'

export async function runGate(bytes: Uint8Array, opts: { sheetPath: string; outDir: string; io: Io }): Promise<{ code: number; report: GateReport }> {
  const { io, outDir } = opts
  const blocking: CliFinding[] = []
  const warnings: CliFinding[] = []
  const note = (list: CliFinding[], rule: string, message: string, wires: string[] = []) =>
    list.push({ id: `${rule}|${list.filter((f) => f.rule === rule).length}`, rule, severity: list === blocking ? 'error' : 'warning', message, parts: [], pins: [], wires })
  const artifacts: GateArtifact[] = []
  const report = (code: number, link: GateReport['link'] = { url: null, file: null, chars: 0 }, d?: Diagram) => {
    const parsed = d?.intent !== undefined ? parseNetlist(d.intent, intentLookup(d, libraryLookup)) : null
    const r: GateReport = {
      format: 'circuitoon-gate/1',
      ok: code === EXIT.ok,
      diagram: { path: opts.sheetPath, sha256: sha256(bytes) },
      artifacts,
      blocking,
      warnings,
      notChecked: NOT_CHECKED,
      link,
      quantities: parsed?.ok ? quantities(parsed.intent) : [],
      channels: parsed?.ok ? channelTable(parsed.intent) : [],
    }
    return { code, report: r }
  }
  const artifact = (kind: GateArtifact['kind'], path: string) => {
    const content = readFileSync(join(outDir, path))
    artifacts.push({ kind, path, sha256: sha256(content), bytes: content.length })
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    note(blocking, 'load', `${opts.sheetPath} is not valid JSON (${(e as Error).message})`)
    return report(EXIT.blocked)
  }
  const v = validateDiagram(raw)
  if (!v.ok) {
    for (const e of v.errors) note(blocking, 'load', e)
    return report(EXIT.blocked)
  }
  const d = v.diagram
  for (const w of v.warnings) note(w.includes(VALUE_DROPPED) || w.includes(MISSING_MODULE) ? blocking : warnings, 'load', w)
  for (const f of verifyDiagram(d, libraryLookup)) blocking.push(cliFinding(f))
  for (const f of checkDiagram(d)) (f.severity === 'error' ? blocking : warnings).push(cliFinding(f))
  const routes = computeRoutes(d)
  for (const c of d.connections)
    if (routes.get(c.uid)?.blocked) note(blocking, 'blocked-route', `The wire ${c.label ?? `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`} has no clear route: it passes through a part.`, [c.uid])

  // Renders: the full sheet, and the first repeat copy when there is one.
  const full = renderSheetSvg(d)
  writeFile(io, join(outDir, 'sheet.svg'), full.svg)
  artifact('svg', 'sheet.svg')
  const shot = writePng(full, 2, join(outDir, 'sheet.png'), io.env)
  let environment = false
  if (!shot.ok) {
    environment = true
    note(warnings, 'environment', shot.message)
  } else artifact('png', 'sheet.png')
  const parsed = d.intent !== undefined ? parseNetlist(d.intent, intentLookup(d, libraryLookup)) : null
  const copy = parsed?.ok ? parsed.intent.copies[0] : undefined
  if (copy && !environment) {
    const uids = d.parts.filter((p) => copy.refs.includes(p.designator)).map((p) => p.uid)
    const focused = renderSheetSvg(d, { box: focusBounds(d, uids, routes) })
    const name = `focus-${copy.id}.png`
    const fshot = writePng(focused, 2, join(outDir, name), io.env)
    if (fshot.ok) artifact('focus-png', name)
  }

  // The link, or the file when the link would be too long.
  let link: GateReport['link'] = { url: null, file: null, chars: 0 }
  try {
    const l = await linkFor(d, outDir, io)
    const file = l.file ? relative(outDir, l.file) : null
    link = { url: l.url, file, chars: l.chars }
    if (l.url) {
      writeFile(io, join(outDir, 'link.txt'), `${l.url}\n`)
      artifact('link', 'link.txt')
    } else {
      artifact('file', file!)
      note(warnings, 'link', `The link would be ${l.chars} characters, over the ${LINK_MAX_CHARS} limit, so ${file} was written instead: open it in Circuitoon with Import JSON.`)
    }
  } catch (err) {
    note(blocking, 'link', `No link could be made and the file fallback could not be written: ${err instanceof Error ? err.message : String(err)}`)
  }
  return report(blocking.length ? EXIT.blocked : environment ? EXIT.environment : EXIT.ok, link, d)
}

export async function gateCommand(args: Args, io: Io): Promise<number> {
  const [input] = args.positionals
  const out = flag(args, '--out')
  if (!input || !out) throw new CliError('gate: usage: circuitoon gate <sheet.json> -o <dir>', EXIT.input)
  let bytes: Uint8Array
  try {
    bytes = readFileSync(pathIn(io, input))
  } catch {
    throw new CliError(`${input}: cannot read the file`, EXIT.input)
  }
  const { code, report } = await runGate(bytes, { sheetPath: input, outDir: pathIn(io, out), io })
  writeFile(io, join(out, 'gate.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (args.flags.has('--json')) printJson(io, report)
  else {
    const lines = [code === EXIT.ok ? `GATE PASSED: ${input} (sha256 ${report.diagram.sha256})` : code === EXIT.environment ? `GATE INCOMPLETE: no browser for the PNG renders (${input})` : `GATE BLOCKED: ${report.blocking.length} blocking finding${report.blocking.length === 1 ? '' : 's'} (${input})`]
    if (report.blocking.length) lines.push('Blocking:', findingsText(report.blocking))
    if (report.warnings.length) lines.push('Warnings (report these to the user):', findingsText(report.warnings))
    lines.push(`Artifacts in ${out}:`, ...report.artifacts.map((a) => `  ${a.path}  sha256 ${a.sha256}`))
    if (report.link.url) lines.push(`Link: ${report.link.url}`, LINK_NOTICE)
    lines.push(notCheckedText())
    io.stdout(`${lines.join('\n')}\n`)
    if (code === EXIT.environment) io.stderr(`${report.warnings.find((w) => w.rule === 'environment')?.message}\n`)
  }
  return code
}
```

In `src/cli/main.ts` add `import { gateCommand } from './gate.ts'` and extend the registry with `gate: gateCommand`.

Note the missing-browser path records the environment message as a warning in `gate.json` (so `ok` is false and the JSON says why) and prints it on stderr; `ok` is true only for exit 0.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli`
Expected: PASS (the two browser cases run on this machine).

- [ ] **Step 5: Gate the fixtures and look at the gate output**

```bash
npm run build:cli
SCRATCH="$TEMP/circuitoon-gate" && mkdir -p "$SCRATCH"
node -e "import('./src/agent/fixtures.testing.ts').then((f) => require('node:fs').writeFileSync(process.argv[1] + '/typewriter.json', JSON.stringify(f.typewriter())))" "$SCRATCH"
node plugin/bin/circuitoon.mjs layout "$SCRATCH/typewriter.json" -o "$SCRATCH/typewriter.sheet.json"
node plugin/bin/circuitoon.mjs gate "$SCRATCH/typewriter.sheet.json" -o "$SCRATCH/out"
```
Read the text output, `out/gate.json`, `out/sheet.png` and `out/focus-ball_1.png`. The typewriter fixture is a layout fixture, not a worked example: checker warnings (for example outputs sharing MISO) are expected and are listed, not hidden. If the gate reports a blocking checker error, decide whether the fixture netlist is wrong (fix the fixture) or the checker is (report it; do not change checker rules in this slice).

- [ ] **Step 6: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/cli plugin
git commit -m "circuitoon gate: every check, renders, link and gate.json hashes; exit 0 only when nothing blocks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: The `circuitoon-design` skill, its references and the worked examples

The skill of spec 8, shipped inside the plugin: how to find the CLI from any project, the six-step workflow with the hard gate, and references (netlist format, CLI and JSON outputs, the module schema for embedded parts, four worked examples). Every worked example is a real design of built-in modules that passes `gate` and opens from its link.

**Files:**
- Create: `plugin/skills/circuitoon-design/SKILL.md`
- Create: `plugin/skills/circuitoon-design/references/netlist-format.md`, `cli.md`, `module-schema.md`, `examples.md`
- Create: `plugin/skills/circuitoon-design/references/examples/led-breadboard.netlist.json`, `esp32-bme280.netlist.json`, `battery-switch.netlist.json`, `tilt-sensors-8.netlist.json`
- Create: `scripts/check-examples.mjs`; modify `package.json` (script `check:examples`)
- Test: `src/cli/examples.test.ts`, browser check `scripts/check-examples.mjs`

**Interfaces:**
- Consumes: every CLI command (Tasks 9 to 16); `findBrowser` (Task 10); test helpers (Task 9); `checker`, `flagOf`, `launchChrome`, `startPreview` (Task 14); `SITE_URL` (Task 13).
- Produces: the skill folder and `npm run check:examples`.

- [ ] **Step 1: Write the worked examples**

Create `plugin/skills/circuitoon-design/references/examples/led-breadboard.netlist.json`:

```json
{
  "format": "circuitoon-netlist/1",
  "title": "LED on a breadboard",
  "parts": [
    { "ref": "BB1", "module": "breadboard-half" },
    { "ref": "BT1", "module": "battery-holder-2xaa" },
    { "ref": "R1", "module": "resistor", "values": { "resistance": { "value": 220, "unit": "ohm" } }, "on": "BB1" },
    { "ref": "D1", "module": "led", "on": "BB1" }
  ],
  "nets": [
    { "name": "VCC", "pins": [{ "ref": "BT1", "pin": "+" }, { "ref": "R1", "pin": "1" }] },
    { "name": "LED_A", "pins": ["R1.2", "D1.A"] },
    { "name": "GND", "pins": ["D1.K", "BT1.-"] }
  ],
  "wires": { "color": { "VCC": "red", "GND": "black" }, "ends": "dupont-male" }
}
```

Create `plugin/skills/circuitoon-design/references/examples/esp32-bme280.netlist.json`:

```json
{
  "format": "circuitoon-netlist/1",
  "title": "ESP32 with a BME280 on I2C",
  "parts": [
    { "ref": "U1", "module": "esp32-devkitc-v4" },
    { "ref": "U2", "module": "bme280-module-4pin" }
  ],
  "nets": [
    { "name": "3V3", "pins": ["U1.3V3", "U2.VIN"] },
    { "name": "GND", "pins": ["U1.GND", "U2.GND"] },
    { "name": "SCL", "pins": ["U1.IO22", "U2.SCL"] },
    { "name": "SDA", "pins": ["U1.IO21", "U2.SDA"] }
  ],
  "groups": [{ "name": "Sensor", "parts": ["U2"] }],
  "notes": [{ "text": "The ESP32 runs from USB; its 3V3 pin powers the sensor. I2C on IO22 (SCL) and IO21 (SDA).", "near": "Sensor" }],
  "wires": { "color": { "3V3": "red", "GND": "black", "SCL": "yellow", "SDA": "blue" }, "ends": "dupont-female" }
}
```

Create `plugin/skills/circuitoon-design/references/examples/battery-switch.netlist.json`:

```json
{
  "format": "circuitoon-netlist/1",
  "title": "Battery board with a power switch",
  "parts": [
    { "ref": "BT1", "module": "battery-18650-holder" },
    { "ref": "U1", "module": "ip5306-usbc-module" },
    { "ref": "S1", "module": "rocker-switch-kcd1" },
    { "ref": "U2", "module": "esp32-devkitc-v4" }
  ],
  "nets": [
    { "name": "BAT", "pins": ["BT1.+", "U1.B+"] },
    { "name": "GND", "pins": ["BT1.-", "U1.B-", "U1.5V-", "U2.GND"] },
    { "name": "VSW", "pins": ["U1.5V+", "S1.1"] },
    { "name": "5V", "pins": ["S1.2", "U2.5V"] }
  ],
  "groups": [{ "name": "Power", "parts": ["BT1", "U1", "S1"] }],
  "notes": [{ "text": "U1 B- and 5V- are joined inside the IP5306 board, so ground runs battery, charger, ESP32 in a chain.", "near": "Power" }]
}
```

Create `plugin/skills/circuitoon-design/references/examples/tilt-sensors-8.netlist.json`:

```json
{
  "format": "circuitoon-netlist/1",
  "title": "Eight tilt sensors",
  "parts": [
    { "ref": "U1", "module": "esp32-devkitc-v4" },
    { "ref": "BB1", "module": "power-rail-strip" }
  ],
  "nets": [{ "name": "GND", "pins": ["U1.GND", "BB1.-"] }],
  "repeat": {
    "name": "tilt",
    "count": 8,
    "template": {
      "parts": [{ "ref": "S", "module": "tilt-switch-sw520d" }],
      "nets": [{ "name": "SIG", "pins": ["S.1"] }, { "name": "GND", "pins": ["S.2"] }],
      "ports": ["SIG", "GND"]
    },
    "bindings": [
      { "SIG": "U1.IO13" }, { "SIG": "U1.IO14" }, { "SIG": "U1.IO25" }, { "SIG": "U1.IO26" },
      { "SIG": "U1.IO27" }, { "SIG": "U1.IO32" }, { "SIG": "U1.IO33" }, { "SIG": "U1.IO4" }
    ],
    "shared": { "GND": "GND" }
  },
  "notes": [{ "text": "Enable the ESP32's internal pull-ups on the eight inputs; a closed switch reads low.", "near": "U1" }],
  "wires": { "color": { "GND": "black" }, "ends": "dupont-female" }
}
```

- [ ] **Step 2: Write the failing end-to-end test**

Create `src/cli/examples.test.ts`:

```ts
// Every worked example shipped with the circuitoon-design skill (spec 8 and 10) lays out, has nothing
// blocking, passes the gate where a browser exists, and yields a link.
import { describe, expect, it } from 'vitest'
import { copyFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { libraryLookup } from '../agent/catalog.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { findBrowser } from './png.ts'

const DIR = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples')
const files = readdirSync(DIR).filter((f) => f.endsWith('.netlist.json')).sort()
const browser = findBrowser(process.env)
const laidOut = async (f: string) => {
  const dir = tempDir()
  copyFileSync(join(DIR, f), join(dir, f))
  const r = await cli(['layout', f, '-o', 'sheet.json'], { cwd: dir })
  expect(r.code, r.err).toBe(0)
  return dir
}

describe('worked examples', () => {
  it('ships the four the spec names, built from built-in modules only', () => {
    expect(files).toEqual(['battery-switch.netlist.json', 'esp32-bme280.netlist.json', 'led-breadboard.netlist.json', 'tilt-sensors-8.netlist.json'])
    for (const f of files) {
      const n = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
      expect(n.modules, f).toBeUndefined()
      for (const p of n.parts) expect(libraryLookup(p.module), `${f} ${p.module}`).toBeDefined()
    }
    expect(JSON.parse(readFileSync(join(DIR, 'tilt-sensors-8.netlist.json'), 'utf8')).repeat.count).toBe(8)
  })
  for (const f of files) {
    it(`${f}: nothing blocks`, async () => {
      const dir = await laidOut(f)
      const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'none.exe') } })
      const g = JSON.parse(r.out)
      expect(g.blocking, JSON.stringify(g.blocking, null, 2)).toEqual([])
      expect(r.code).toBe(3)
    }, 60_000)
    it.skipIf(!browser)(`${f}: passes the gate with renders and a link`, async () => {
      const dir = await laidOut(f)
      const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
      expect(r.code, r.out).toBe(0)
      expect(JSON.parse(r.out).link.url).toMatch(/^https:\/\/mbarc\.github\.io\/circuitoon\/#\/editor\?d=v1\./)
    }, 120_000)
  }
})
```

Run: `npx vitest run src/cli/examples.test.ts`
Expected: the examples exist already (Step 1), so this is the first real run: PASS, or a blocking finding that names the problem. A blocking checker error on an example means the design is wrong for the real bench: change the example (for example the pins it uses), never the checker, and keep it a design a hobbyist could build. Warnings are fine; Step 4 records them in `examples.md`.

- [ ] **Step 3: Write the skill**

Create `plugin/skills/circuitoon-design/SKILL.md`:

````markdown
---
name: circuitoon-design
description: Design, verify and present an electronics wiring diagram with Circuitoon from a plain request - pick real parts, write a netlist, lay it out, prove it implements the requested circuit, render it and hand over a link that opens it in the Circuitoon editor. Use whenever someone asks for a wiring diagram, schematic, breadboard layout, hookup picture or pinout-level plan of a circuit (ESP32, Arduino, Pico, sensors, displays, batteries, switches, LEDs, expanders), or wants one checked or presented, even if they do not say Circuitoon.
---

# Designing a circuit with Circuitoon

People physically wire circuits from these pictures, so a wrong connection costs them a board. Nothing is presented that the tools have not verified, and what is not verified is said out loud.

## The CLI

Everything goes through the `circuitoon` CLI that ships with this plugin (Node 22 or newer; PNG output also needs Chrome or Edge installed). When this skill loads, Claude Code shows its base directory; the CLI is two levels up:

```bash
node "<base directory of this skill>/../../bin/circuitoon.mjs" <command> ...
```

If the base directory is not shown, find the file with a glob for `**/circuitoon/**/bin/circuitoon.mjs` under `~/.claude/plugins/cache/`. Inside the Circuitoon repo itself it is `node plugin/bin/circuitoon.mjs`. Below, `circuitoon` means that command. Work in a scratch folder of the user's project, never inside the plugin folder.

Commands: `parts`, `part <id>`, `layout`, `verify`, `check`, `render`, `link`, `gate`. Add `--json` for one JSON document on stdout. Exit codes: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (no browser). Details: `references/cli.md`.

## Rules that are never bent

- Present only artifacts from the **last passing `gate`**: after any change to the netlist or the sheet, run `gate` again, and present only files whose SHA-256 matches that run's `gate.json`.
- Never invent a pin. Use the pin names `circuitoon part <id>` prints. A part that is not built in may be embedded in the netlist only from its maker's documentation, with the source URLs in `source`, and it is reported as a custom, unverified part.
- Always report the gate's warnings and its "not checked" list to the user, in plain words.
- Research never sends personal data: no names, emails, addresses, order numbers or tokens in URLs, search queries or request bodies.

## Workflow

1. **Clarify the goal.** Ask for what is missing: the power source (USB, battery, adapter), the boards, the parts already on hand, and whether they want a full build or an illustrative example. For the Spirit Typewriter (tilt switches in balls on MCP23017 expanders), confirm whether each ball's two switches share one expander channel or need two: 42 balls sharing fit three expanders (14 inputs each, since GPA7 and GPB7 are output-only); 84 separate channels need six.
2. **Pick parts.** `circuitoon parts --search <text>` then `circuitoon part <id>` for each one you use. Use canonical pin names (`GND`, `IO21`); a silkscreen label works only when exactly one pin has it. Missing part: embed it under `modules` following `references/module-schema.md`, with `source`; never guess.
3. **Write the netlist** (`references/netlist-format.md`). One net per electrical node. Put parts that plug into a breadboard `on` it. A net with more than two pins needs a strip or rail to share (a header pin takes one wire): list a breadboard or rail strip in the netlist, or the layout fails with "needs a distribution point". Use `repeat` for repeated sub-circuits, with one explicit binding per copy. Add `groups` and `notes` where they help a person read the sheet.
4. **Lay out and gate.** `circuitoon layout netlist.json -o sheet.json`, then `circuitoon gate sheet.json -o out`. Fix every blocking finding in the netlist (or, for a hand edit, in the sheet) and gate again. To keep some positions and re-place the rest, see "Partial re-layout" in `references/netlist-format.md`.
5. **Look at the renders.** Read `out/sheet.png` and, for repeats, `out/focus-<copy>.png`. Overlapping labels, wires into the wrong strip, a crowded area: fix (spacing through `--keep`, groups, a second breadboard) and gate again.
6. **Present:** the link (with its notice that anyone with the link can see the diagram and nothing is uploaded), `out/sheet.png`, the focused PNG for repeats, the bill of quantities and, for repeats, the channel allocation table (both in `gate.json`), every warning, and the "not checked" list. When the link was too long, give the file `gate` wrote instead and say to open it with Import JSON.

## Reading the gate

- `GATE PASSED`: exit 0. Present, following step 6.
- `GATE BLOCKED`: exit 1. Each blocking line names its rule: `missing-connection`, `merge`, `extra-connection`, `nc`, `capacity`, `value-drift`, `mount`, `extra-part`, `module-mismatch`, `intent`, `load`, `blocked-route`, or a wiring checker rule (`short`, `reversed`, `supply-too-high`, ...). Fix and gate again. Never present a blocked sheet.
- `GATE INCOMPLETE`: exit 3, no Chrome or Edge for the PNGs. Tell the user; offer `circuitoon render sheet.json --svg sheet.svg` and the link, and say the PNG step did not run.

## References

- `references/netlist-format.md`: every netlist field and rule, repeats, the partial format for `--keep`.
- `references/cli.md`: commands, flags, exit codes and the JSON outputs; schemas in `references/schemas/`.
- `references/module-schema.md`: writing an embedded part.
- `references/examples.md` and `references/examples/`: LED on a breadboard, ESP32 with an I2C sensor, battery board with a switch, eight repeated tilt sensors. Each passes `gate`.
````

Create `plugin/skills/circuitoon-design/references/netlist-format.md`:

````markdown
# Netlist format (`circuitoon-netlist/1`)

A netlist says what connects to what; the layout decides where things go. It is stored in the sheet as `intent`, so every later check re-verifies the sheet against it.

```json
{
  "format": "circuitoon-netlist/1",
  "title": "LED on a breadboard",
  "parts": [
    { "ref": "BB1", "module": "breadboard-half" },
    { "ref": "BT1", "module": "battery-holder-2xaa" },
    { "ref": "R1", "module": "resistor", "values": { "resistance": { "value": 220, "unit": "ohm" } }, "on": "BB1" },
    { "ref": "D1", "module": "led", "on": "BB1" }
  ],
  "nets": [
    { "name": "VCC", "pins": [{ "ref": "BT1", "pin": "+" }, { "ref": "R1", "pin": "1" }] },
    { "name": "LED_A", "pins": ["R1.2", "D1.A"] },
    { "name": "GND", "pins": ["D1.K", "BT1.-"] }
  ],
  "wires": { "color": { "VCC": "red", "GND": "black" }, "ends": "dupont-male" }
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `format`, `title` | Required. |
| `parts[]` | `ref` (a letter, then letters, digits or `_`; unique), `module` (a built-in id from `circuitoon parts`, or one under `modules`), optional `values` (`resistance` in ohm, `capacitance` in F, `voltage` in V: `{ "value": 220, "unit": "ohm" }`), optional `on` (the ref of a breadboard or rail strip the part plugs into). |
| `nets[]` | `name` (unique) and `pins` (at least two endpoints). An endpoint is in one net only. |
| `nc[]` | Pins that must stay unconnected; any connection to one fails verification. |
| `groups[]` | `{ "name", "parts": [refs] }`: drawn as a labelled frame; a part is in one group at most. |
| `notes[]` | `{ "text", "near" }` (up to 500 characters; `near` is a group name or a ref): drawn below it. |
| `wires` | `color`: net name to a color name (`red`, `black`, `blue`, `green`, `yellow`, `orange`, `white`, `purple`, `gray`, `brown`, `pink`) or `#RRGGBB`; `ends`: one cable end for every wire (`dupont-male`, `dupont-female`, `solid-jumper`, `alligator`, `stripped`, `ferrule`, `jst-xh`, `jst-ph`, `jst-sh`, `grove`, `banana`). Default colors: ground black, power red, signals cycle. |
| `modules` | Embedded parts by id (see `module-schema.md`); an id may not reuse a built-in id. |
| `repeat` | Repeated sub-circuits (below). |

## Endpoints

- `{ "ref": "U1", "pin": "GND" }`, or the shorthand `"U1.GND"` (split at the first dot, so `"U5.5V+"` is pin `5V+`).
- A breadboard hole group: `{ "ref": "BB1", "group": "c5-top", "hole": 2 }`; hole indexes start at 0; leave `hole` out for any free hole. `"BB1.top-"` names a whole rail.
- The exact pin name wins; a silkscreen label is used only when no pin has that name and exactly one pin has the label (a shared label is an error that lists the pins).

## How the layout wires a net

- Pins of parts `on` a breadboard sit in its strips; a strip's other holes are where wires join.
- A header pin or pad takes one wire end (unless its module declares `capacity`); a breadboard hole takes one wire end or one leg. So a net of three or more pins needs somewhere to share: a strip its mounted legs sit in, a strip or rail you list in the net (`"BB1.top-"`), or a free strip or rail of a breadboard or rail strip in the netlist, which the layout claims (ground nets take a `-` rail, power nets a `+` rail, signals a column strip). With none of these the layout stops with "needs a distribution point: net X".
- Pins a part joins inside itself (an ESP32's GND pins, the IP5306's B- and 5V-) count as one node that takes as many wires as its pins together.
- Everything the layout adds for strips (wires into holes, jumpers) is marked `routing: true`.

## Repeated sub-circuits

```json
"repeat": {
  "name": "ball", "count": 42,
  "template": {
    "parts": [{ "ref": "SA", "module": "tilt-switch-sw520d" }, { "ref": "SB", "module": "tilt-switch-sw520d" }],
    "nets": [{ "name": "CH", "pins": ["SA.1", "SB.1"] }, { "name": "GND", "pins": ["SA.2", "SB.2"] }],
    "ports": ["CH", "GND"]
  },
  "bindings": [{ "CH": "U2.GPA0" }, { "CH": "U2.GPA1" }],
  "shared": { "GND": "GND" }
}
```

- A template net named like a port is that port's net. `shared` joins a port of every copy to one outside net (here the top-level `GND`). Every other port needs one binding per copy, and no outside pin may be bound twice.
- Refs become `SA_1`, `SB_1`, ... (or set `"refs": "B{copy}{ref}"`); a clash with another ref is an error. Copy ids are `ball_1`, `ball_2`, ...: `render --focus ball_1` frames one copy. Template parts cannot use `on`.
- The layout prints the channel allocation table (copy, port, bound pin) and the bill of quantities.

## Partial re-layout (`--keep`)

Copy a laid-out sheet, change `format` to `circuitoon-partial/1`, delete `x` and `y` from the parts to place again, and run `circuitoon layout --keep partial.json -o sheet.json`. Only `intent` and each part's `designator`, `x`, `y`, `rotation` are read; wires are regenerated. A kept board keeps its mounted parts while they still seat. The site never opens a partial file.
````

Create `plugin/skills/circuitoon-design/references/cli.md`:

````markdown
# circuitoon CLI

Run as `node <plugin>/bin/circuitoon.mjs <command>` (Node 22 or newer). Plain text by default; `--json` prints one JSON document on stdout; diagnostics go to stderr.

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | findings that block (verify or checker errors, a netlist that cannot be laid out, a blocked gate) |
| 2 | invalid input (a missing file, bad JSON, an invalid netlist or sheet, a bad option) |
| 3 | environment problem: no Chrome or Edge for PNG (install one, set `CIRCUITOON_BROWSER`, or use `--svg`) |

| Command | Does | `--json` schema |
| --- | --- | --- |
| `parts [--search text]` | Built-in parts: category, pins (name, label, type, supply, capacity), hole groups, source | `schemas/parts.schema.json` |
| `part <id>` | One module in full | `schemas/part.schema.json` |
| `layout <netlist.json> -o <sheet.json>` or `layout --keep <partial.json> -o <sheet.json>` | Places, mounts, wires and routes; prints the readability report (body overlaps, caption overlaps, wire crossings, wire length, sheet size, blocked nets), bill of quantities and channel table | `schemas/layout.schema.json` |
| `verify <sheet.json>` | The sheet against its intent: parts, modules, values, mounts, missing connections, merges, extra connections, nc, terminal capacity | `schemas/findings.schema.json` |
| `check <sheet.json>` | The wiring checker (shorts, reversed power, wrong voltage, no ground, ...) plus verify when there is an intent | `schemas/findings.schema.json` |
| `render <sheet.json> -o <png> [--svg <svg>] [--dark] [--scale n] [--focus <copy or group>]` | PNG (through Chrome or Edge) and standalone SVG; `--focus` frames one repeat copy or group | `schemas/render.schema.json` |
| `link <sheet.json> [-o <dir>]` | A link that opens the sheet in the editor; over 64 KB the sheet file is written instead | `schemas/link.schema.json` |
| `gate <sheet.json> -o <dir>` | Everything above; writes `sheet.svg`, `sheet.png`, `focus-<copy>.png`, `link.txt` (or the sheet file) and `gate.json` with SHA-256 hashes; exits 0 only when nothing blocks | `schemas/gate.schema.json` |

Every finding has a stable `id` (the rule plus what causes it), `rule`, `severity`, `message`, and the `parts`, `pins` and `wires` it is about. SVG text uses Atkinson Hyperlegible when installed, else the system sans-serif.
````

Create `plugin/skills/circuitoon-design/references/module-schema.md`:

````markdown
# Embedded parts (`circuitoon-module/1`)

Only when `circuitoon parts` has no match. Take every pin from the maker's documentation (datasheet, maker wiki, vendor pinout) and list those URLs in `source`, space-separated. If a pin cannot be verified, do not add the part: say so. Embedded parts are reported as custom and unverified.

```json
"modules": {
  "relay-board-2ch": {
    "format": "circuitoon-module/1",
    "id": "relay-board-2ch",
    "name": "2-channel relay board (5 V)",
    "category": "Outputs",
    "source": "https://example.com/datasheet.pdf https://example.com/pinout",
    "pins": [
      { "name": "VCC", "side": "left", "type": "power_in", "supply": "5V" },
      { "name": "GND", "side": "left", "type": "ground" },
      { "name": "IN1", "side": "left", "type": "input" },
      { "name": "IN2", "side": "left", "type": "input" }
    ]
  }
}
```

| Field | Rule |
| --- | --- |
| `id` | Lowercase kebab-case, not a built-in id. |
| `pins[]` | `name` (unique; as on the silkscreen; repeats become `GND 2` with `label: "GND"`), `side` (`top`, `bottom`, `left`, `right`), in physical order (left to right on top and bottom, top to bottom on left and right); `{ "spacer": true, "side": ... }` holds a physical gap. |
| `type` | `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive`, `nc`. Leave it out when unsure: an untyped pin is never guessed about. |
| `supply` | The voltage the pin sees: `3V3`, `5V`, `3.7V`; several accepted rails as `3V3/5V`. |
| `capacity` | Wire ends a pin or pad takes (1 to 8, default 1): 2 for a screw terminal that takes two wires. |
| `internal` | Pins joined inside the part: `[["GND", "GND 2"]]`. |
| `holes` | Interior header pads: `{ "name", "at": [[x, y]], "holeStyle": "pad" }` on the 10 px grid. |
| `electrical.params` | Values the part carries: `{ "resistance": { "unit": "ohm", "default": 1000 } }`. |

The full format is in the Circuitoon repo, `docs/PRD.md`, "Module definition format".
````

Create `plugin/skills/circuitoon-design/references/examples.md`:

````markdown
# Worked examples

Each file in `examples/` is a netlist of built-in parts that lays out and passes `gate`:

```bash
circuitoon layout examples/<file> -o sheet.json && circuitoon gate sheet.json -o out
```

| File | Shows |
| --- | --- |
| `led-breadboard.netlist.json` | Parts mounted `on` a breadboard: legs share strips, the battery wires into free holes; values; colors and cable ends. |
| `esp32-bme280.netlist.json` | Two-pin nets wired pin to pin (no breadboard needed); a group and a note. |
| `battery-switch.netlist.json` | A power chain through a switch; pins joined inside a part (the IP5306's B- and 5V-) wired as one node, so ground chains without a distribution point. |
| `tilt-sensors-8.netlist.json` | `repeat` with explicit bindings (8 copies) and a shared ground on a rail strip; `render --focus tilt_1`. |
````

- [ ] **Step 4: Record the examples' real warnings**

```bash
npm run build:cli
SCRATCH="$TEMP/circuitoon-examples" && mkdir -p "$SCRATCH"
for f in plugin/skills/circuitoon-design/references/examples/*.netlist.json; do
  n=$(basename "$f" .netlist.json)
  node plugin/bin/circuitoon.mjs layout "$f" -o "$SCRATCH/$n.json"
  node plugin/bin/circuitoon.mjs gate "$SCRATCH/$n.json" -o "$SCRATCH/$n"
done
```
Every gate prints `GATE PASSED`. Append a `## Warnings` section to `references/examples.md` listing, for each example, each warning line its gate printed and one sentence on why it is expected, or "none". Read each `sheet.png` and `focus-tilt_1.png`: the examples are what users copy, so they must read cleanly (fix placement issues at their source, then gate again).

- [ ] **Step 5: Write the "opens from its link" browser check**

Create `scripts/check-examples.mjs`:

```js
// End to end for the skill's worked examples (agent toolkit spec 10): each netlist is laid out and
// linked by the built CLI, and the link opens in the editor with its title and every part, the
// payload gone from the address bar. Saves a screenshot per example.
//
// Usage (after `npm run build` and `npm run build:cli`): npm run check:examples -- [--out <dir>] [--port 4195]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-examples')))
const port = Number(flagOf('--port', '4195'))
mkdirSync(out, { recursive: true })
const dir = 'plugin/skills/circuitoon-design/references/examples'
const cliRun = (...args) => execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', ...args], { encoding: 'utf8' })
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const file of readdirSync(dir).filter((f) => f.endsWith('.netlist.json')).sort()) {
  const name = file.replace('.netlist.json', '')
  const sheetPath = join(out, `${name}.json`)
  cliRun('layout', join(dir, file), '-o', sheetPath)
  const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'))
  const link = JSON.parse(cliRun('link', sheetPath, '--json'))
  check(link.url !== null, `${name}: the CLI made a link`)
  if (!link.url) continue
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(link.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('.editor')
  check((await page.locator('.toolbar .title').textContent()) === sheet.title, `${name}: opens with its title`)
  check((await page.locator('[data-part]').count()) === sheet.parts.length, `${name}: every part is on the canvas`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${name}: the payload left the address bar`)
  check(errors.length === 0, `${name}: no page errors ${errors.join('; ')}`)
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
done()
```

In `package.json` scripts add `"check:examples": "node scripts/check-examples.mjs",`.

Run:

```bash
npm run build && npm run build:cli
npm run check:examples -- --out "$TEMP/circuitoon-examples-ui"
```
Expected: every line `ok`, `all checks passed`. Read the four screenshots.

- [ ] **Step 6: Try the skill as a fresh agent would**

In a scratch folder outside the repo, follow `SKILL.md` literally for "an ESP32 DevKitC reading a BME280 over I2C, powered from USB": find the CLI through the skill's base directory rule (use the repo's `plugin/` folder as the base), write the netlist from `circuitoon part` output, lay out, gate, read the PNG. Note every place the instructions were unclear or wrong and fix the skill text.

- [ ] **Step 7: Gate**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add plugin/skills src/cli/examples.test.ts scripts/check-examples.mjs package.json
git commit -m "circuitoon-design skill: workflow with the hard gate, references, four gate-passing worked examples

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Plugin packaging, docs, and the branch hand-off

Makes the repo a Claude Code marketplace with one plugin (`plugin/`: manifest, the `circuitoon-design` skill, `bin` and the committed bundle), keeps `circuitoon-add-part` and `circuitoon-ship` repo-internal, teaches those two skills about `npm run build:cli`, documents the toolkit, and runs every check once more before review.

**Files:**
- Create: `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`
- Modify: `README.md`, `docs/PRD.md`, `.claude/skills/circuitoon-add-part/SKILL.md` (step 7), `.claude/skills/circuitoon-ship/SKILL.md` (step 2)
- Test: `src/cli/plugin.test.ts`

**Interfaces:**
- Consumes: everything under `plugin/` from Tasks 9 to 17.
- Produces: the marketplace entry `circuitoon` with plugin `circuitoon` (source `./plugin`).

- [ ] **Step 1: Write the failing test**

Create `src/cli/plugin.test.ts`:

```ts
// The Claude Code plugin packaging (spec 9): the repo marketplace lists one plugin whose folder holds
// its manifest, the circuitoon-design skill, the bin and the bundle; the repo-internal skills stay
// out; nothing shipped contains an em or en dash.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

describe('plugin packaging', () => {
  it('lists the plugin in the repo marketplace, sourced from plugin/', () => {
    const m = json('.claude-plugin/marketplace.json')
    expect(m.name).toBe('circuitoon')
    expect(m.owner.name).toBe('MBarc')
    expect(m.plugins).toHaveLength(1)
    expect(m.plugins[0]).toMatchObject({ name: 'circuitoon', source: './plugin' })
  })
  it('ships the manifest, the design skill, the bin and the bundle, and nothing repo-internal', () => {
    const p = json('plugin/.claude-plugin/plugin.json')
    expect(p.name).toBe('circuitoon')
    expect(p.version).toBe(json('package.json').version)
    expect(json('.claude-plugin/marketplace.json').plugins[0].version).toBe(p.version)
    expect(readdirSync('plugin/skills')).toEqual(['circuitoon-design'])
    expect(readFileSync('plugin/skills/circuitoon-design/SKILL.md', 'utf8')).toMatch(/^---\r?\nname: circuitoon-design\r?\ndescription: .+\r?\n---\r?\n/)
    for (const f of ['plugin/bin/circuitoon.mjs', 'plugin/dist-cli/circuitoon.mjs']) expect(existsSync(f), f).toBe(true)
  })
  it('has no em or en dashes in anything it ships (the third-party bundle aside)', () => {
    for (const f of [...walk('plugin').filter((f) => !f.includes('dist-cli')), '.claude-plugin/marketplace.json']) {
      const text = readFileSync(f, 'utf8')
      expect(/[\u2013\u2014]/.test(text), f).toBe(false)
    }
  })
})
```

Run: `npx vitest run src/cli/plugin.test.ts`
Expected: FAIL: `.claude-plugin/marketplace.json` does not exist.

- [ ] **Step 2: Add the manifests**

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "circuitoon",
  "owner": { "name": "MBarc" },
  "plugins": [
    {
      "name": "circuitoon",
      "source": "./plugin",
      "version": "0.1.0",
      "description": "Design, verify and render Circuitoon wiring diagrams from a netlist: the circuitoon CLI and the circuitoon-design skill."
    }
  ]
}
```

Create `plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "circuitoon",
  "version": "0.1.0",
  "description": "Design, verify and render Circuitoon wiring diagrams from a netlist: the circuitoon CLI (layout, verify, check, render, link, gate) and the circuitoon-design skill.",
  "author": { "name": "MBarc" },
  "homepage": "https://mbarc.github.io/circuitoon/",
  "repository": "https://github.com/MBarc/circuitoon"
}
```

Run: `npx vitest run src/cli/plugin.test.ts`
Expected: PASS. If the installed Claude Code has a `claude plugin validate` command, also run `claude plugin validate .` and `claude plugin validate plugin` from the worktree and fix anything they report.

- [ ] **Step 3: Docs and the two repo-internal skills**

In `README.md`, after the command block, add:

````markdown
## Agent toolkit (Claude Code plugin)

The `circuitoon` CLI lets an AI agent go from a netlist to a verified, rendered sheet and a link that opens it here: `layout`, `verify`, `check`, `render`, `link` and `gate`. It ships as a Claude Code plugin with the `circuitoon-design` skill:

```text
/plugin marketplace add MBarc/circuitoon
/plugin install circuitoon@circuitoon
```

Needs Node 22 or newer (and Chrome or Edge for PNG output). In this repo: `node plugin/bin/circuitoon.mjs --help`. The bundle `plugin/dist-cli/circuitoon.mjs` is committed; after any change under `src/` or `modules/`, run `npm run build:cli` and commit it (`npm run check:gen` fails otherwise).
````

In `docs/PRD.md`, section "Roadmap", add a bullet:

```markdown
- **Agent toolkit (first slice).** A `circuitoon` CLI and a `circuitoon-design` skill, shipped as a Claude Code plugin from this repo (`plugin/`): a netlist (`circuitoon-netlist/1`) is laid out on the grid (parts mounted on breadboards, strips and rails distributing nets), verified for electrical equivalence against the netlist it stores as `intent`, checked, rendered to PNG and SVG, and linked (`#/editor?d=`). `gate` runs all of it and passes only when nothing blocks. Spec: `docs/superpowers/specs/2026-09-27-agent-toolkit-slice-design.md`.
```

In `.claude/skills/circuitoon-add-part/SKILL.md`, step 7 ("Validate and test"), after the `npm run build` item add: "then `npm run build:cli`: the agent toolkit's CLI bundle embeds every module, so commit the regenerated `plugin/dist-cli/circuitoon.mjs` with the part (`npm run check:gen` fails otherwise)."

In `.claude/skills/circuitoon-ship/SKILL.md`, step 2, before the verify line add: "Run `npm run build:cli` first: when the merge brought module or source changes from another branch, the committed CLI bundle must be regenerated and committed on `main` before pushing (`npm run check:gen` fails otherwise)."

- [ ] **Step 4: Every check, once more**

```bash
npm run build:cli
npx tsc --noEmit
npm run validate && npm run check:gen && npm test && npm run build
npm run check:link-ui -- --out "$TEMP/circuitoon-final/link"
npm run check:annotations-ui -- --out "$TEMP/circuitoon-final/annotations"
npm run check:examples -- --out "$TEMP/circuitoon-final/examples"
npm run check:warnings-ui -- --out "$TEMP/circuitoon-final/warnings"
npm run check:problems-ui -- --out "$TEMP/circuitoon-final/problems"
npm run check:cables-ui -- --out "$TEMP/circuitoon-final/cables"
node -e "const fs=require('fs'),p=require('path');const bad=[];const look=(f)=>{if(fs.statSync(f).isDirectory())return fs.readdirSync(f).forEach((n)=>n!=='dist-cli'&&look(p.join(f,n)));if(/[\u2013\u2014]/.test(fs.readFileSync(f,'utf8')))bad.push(f)};['src','scripts','plugin','docs','README.md','.claude','.claude-plugin'].forEach(look);console.log(bad.length?'dashes in: '+bad.join(', '):'no dashes')"
```
Expected: everything passes and the last line prints `no dashes`. Read the screenshots of the three new checks once more.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin plugin/.claude-plugin src/cli/plugin.test.ts README.md docs/PRD.md .claude/skills
git commit -m "Package the agent toolkit as a Claude Code plugin; document it; build:cli in the part and ship skills

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off for review (do not merge)**

Michael asked that every Circuitoon branch gets an Astra review (code plus technical decisions) before merge: run the `consult-astra` skill on the `agent-toolkit` branch, asking it to weigh in particular on Decision 1 (PNG without playwright-core at runtime), Decision 3 (committed bundle), Decision 11 (distribution) and the verify connection rule. Implement what you agree with, report the rest. Then report to Michael: the plugin install commands to try in a fresh Claude Code session (`/plugin marketplace add C:/Users/micha/Desktop/projects/Circuitoon-toolkit`, `/plugin install circuitoon@circuitoon`), the gate output of the four worked examples, and the decisions above that need his nod. Shipping is the `circuitoon-ship` skill, after his go-ahead.

---

## Self-review

**Spec coverage.** Every spec section maps to a task in the Coverage table near the top; independent tests are named per section. Checked item by item against spec 10:
- Netlist parsing (labels, ambiguity, holes, duplicates, embedded collisions, repeat maps complete and duplicate-free): Tasks 2 and 3.
- Layout determinism, zero overlaps on 5, 30, 120 and the typewriter-like fixture, mounts without strip merges, no double wire ends, 2 s budget with routing, visual inspection: Tasks 6, 7 and 11.
- Verify: unused seated leg alone in its strip, second wire on a header pin, wire into an occupied hole, missing connection, merge through a strip, merge through an internal join, extra component connection, routing infrastructure allowed, nc, value drift 220 to 2200 ohm, module swapped, unseated mount, extra part, missing intent (and the gate failing on it, Task 16), drift after a hand edit: Task 4 (and Task 7 for drift on a laid-out sheet).
- Layout capacity ("needs a distribution point" unless a breadboard or terminal is present; never two wires into one header pin): Task 7 (rail and two-wire terminal cases), Task 4 capacity rule.
- Repeat bindings (reused channel rejected, shared GND accepted, ref expansion and collision): Tasks 2 and 3.
- CLI outputs, JSON schemas, exit codes, gate hashes, browser-missing path: Tasks 9, 10, 12, 13, 16.
- Link round trip, oversized refusal, malformed and oversized payloads, document survives the fragment cleanup, reload behaviour: Tasks 13 and 14.
- Annotations in SVG/PNG and on the canvas: Tasks 5 and 15.
- End to end, every worked example passes gate and opens from its link: Task 17.
- Gaps found and handled as decisions: PNG route (Decision 1), reload with no autosave (Decision 6), frame format (Decision 8), capacity of the terminal board unsourced (Decision 14), typewriter part choices (Decision 20).

**Placeholder scan.** No "TBD", "TODO", "similar to Task N" or undefined references. Two steps depend on output only a run can produce and say exactly what to record: the fixture readability lines (Task 11 commit message) and the examples' warnings (Task 17 Step 4).

**Type consistency.** Names used across tasks were checked against their defining task: `Terminal`, `Intent`, `terminalKey`, `terminalName`, `parseNetlist`, `ModuleLookup` (Task 3); `RepeatCopy`, `expandRepeat` (Task 2); `verifyDiagram`, `intentLookup`, `NO_INTENT`, `VerifyFinding` (Task 4); `captionBox`, `captionAnchor`, `annotationRect`, `wrapNote`, `renderSheetSvg`, `focusBounds`, `FrameMark`, `NoteMark` (Task 5); `placeParts`, `KeepMap`, `mountPart`, `tightFootprint`, `footprint`, `intersects`, `union` (Task 6); `realize`, `readability`, `reportText`, `layoutNetlist`, `LayoutResult.stage` (Task 7); `loadPartial` (Task 8); `EXIT`, `Io`, `CliError`, `loadSheet`, `COMMANDS`, `cli`, `tempDir`, `schemaErrors`, `loadSchema` (Task 9); `findBrowser`, `writePng`, `focusParts` (Task 10); `cliFinding`, `NOT_CHECKED` (Task 12); `diagramLink`, `openLinkPayload`, `payloadFromHash`, `encodePayload`, `linkFor` (Task 13); `routeOf`, `checker`, `startPreview`, `launchChrome`, `flagOf` (Task 14); `moveAnnotations`, `updateAnnotation` (Task 15); `runGate` (Task 16).

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-09-27-agent-toolkit-slice.md`. Two execution options:

1. **Subagent-Driven (recommended):** a fresh subagent per task, review between tasks (superpowers:subagent-driven-development).
2. **Inline Execution:** execute tasks in one session with checkpoints (superpowers:executing-plans).
