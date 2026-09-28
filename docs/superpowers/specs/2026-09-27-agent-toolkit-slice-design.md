# Agent toolkit, first slice: design

Status: direction approved by Michael (2026-09-27): a CLI plus skills packaged as a Claude Code plugin in the public repo; this first slice is pulled forward so another Claude Code session (first user: the Spirit Typewriter session) can design, test and present a schematic. Built in parallel with the mains work, in separate files. MCP server and simulation come later.

## Goal
Let an agent go from a request to a checked, rendered schematic that opens in Circuitoon, without guessing coordinates and without presenting anything the checker rejects.

## 1. Netlist-first input (`circuitoon-netlist/1`)
An agent writes what connects to what; Circuitoon places it.
```json
{
  "format": "circuitoon-netlist/1",
  "title": "Spirit Typewriter",
  "parts": [
    { "ref": "U1", "module": "esp32-devkitc-v4" },
    { "ref": "R1", "module": "resistor", "values": { "resistance": { "value": 4700, "unit": "ohm" } } },
    { "ref": "BB1", "module": "breadboard-half" },
    { "ref": "U2", "module": "mcp23017-dip28", "on": "BB1" }
  ],
  "nets": [
    { "name": "SDA", "pins": ["U1.IO21", "U2.SDA", "R1.1"] },
    { "name": "3V3", "pins": ["U1.3V3", "R1.2", "U2.VDD"] }
  ],
  "wires": { "color": { "3V3": "red", "GND": "black" }, "ends": "dupont-female" },
  "groups": [{ "name": "Ball 1", "parts": ["S1", "S2"] }],
  "notes": [{ "text": "x42: every ball is wired like Ball 1", "near": "Ball 1" }]
}
```
- `ref` becomes the designator; `module` is a library id (or an embedded module under `modules`, as in diagrams).
- A pin reference is `REF.PIN` using the pin name or its silkscreen label; a hole reference is `REF.GROUP[:INDEX]`.
- A net becomes wires: a chain in a readable order (nearest-neighbour from the first pin), never a star of long wires.
- `on` asks for the part to be mounted on a breadboard (placed so its legs seat; if impossible, placed beside it and reported).
- `groups` keep parts together in the layout and get a labelled frame annotation; `notes` become text annotations.
- Unknown modules, pins or refs are errors with a precise message; nothing is guessed.

## 2. Layout
- Deterministic (same input, same output) placement on the 10 px grid:
  - parts with many connections (boards, MCUs) placed first near the centre; connected parts placed near what they connect to, by net weight;
  - groups placed as blocks; repeated identical groups tiled in a row or grid;
  - breadboard mounts via the existing seating code (seatOf / settleMounts);
  - no two part bodies overlap; a clearance margin for wires and captions.
- Wires are routed by the existing router after placement.
- Output is a normal `circuitoon-diagram/1` file; the agent can still edit it by hand, and `layout --keep` re-places only parts without positions.
- Quality bar (tested): no overlaps; every net present; wire count as stated; blocked wires listed in the result.

## 3. CLI (`circuitoon`)
Run with `npx circuitoon` from the repo, or `node bin/circuitoon.mjs`. Built from the same TypeScript sources as the site (one build step, bundled), so its checker and renderer are the site's.
- `circuitoon parts [--search text] [--json]`: modules with category, pins (name, label, type, supply), sources.
- `circuitoon part <id> [--json]`: one module in full.
- `circuitoon layout netlist.json -o sheet.json`: netlist to placed diagram (section 2); prints a summary (parts, wires, blocked routes, unseated mounts).
- `circuitoon check sheet.json [--json]`: loader warnings plus every checker finding (rule, severity, message, parts, wires); exit code 1 when any error exists, 0 otherwise. Accepts a netlist too (lays it out first).
- `circuitoon render sheet.json -o sheet.png [--svg sheet.svg] [--dark] [--scale 2]`: the sheet as the site draws it (headless Chrome through playwright-core, the repo's existing approach; SVG without a browser).
- `circuitoon link sheet.json`: a URL of the live site that opens this diagram (the diagram compressed into the URL fragment, never sent to a server). If it exceeds a safe length (about 60 KB), say so and fall back to "import this file".
- Output is plain text for people and `--json` for agents; errors go to stderr with a non-zero exit.

## 4. Site change
- The editor opens a diagram from the URL fragment (`#/editor?d=<deflate+base64url>`): validated like an import, with the usual warnings panel; the fragment is cleared from the address bar after loading so reloading does not overwrite later edits. Nothing is uploaded.

## 5. Skill `circuitoon-design` (in the repo's plugin folder, used by other sessions)
Workflow, in order, with a hard gate:
1. Clarify the goal and constraints (power source, boards, parts on hand).
2. Pick parts with `circuitoon parts`; use real pin names from `circuitoon part`. If a part is missing, say so and use the add-part workflow; never invent a module.
3. Write the netlist; for repeated sub-circuits, draw one representative group plus a note (for example "x42"), not dozens of copies, unless the user asks for the full sheet.
4. `circuitoon layout`, then `circuitoon check`. Fix every error; explain any warning you keep.
5. `circuitoon render` and look at the image; fix overlaps, unreadable routing, missing wires.
6. Present only with zero errors: the link, the PNG, the parts list, and a short "what I checked / what is not checked" note (mains and simulation limits stated plainly).
- The skill ships with a short reference: the netlist format, pin-reference rules, and three worked examples (LED + resistor on a breadboard, an ESP32 with an I2C sensor, a battery-powered board with a switch).

## 6. Packaging
- `.claude-plugin/` manifest in the repo so the plugin installs the skill(s); the CLI is part of the repo (no npm publish in this slice).
- The existing `circuitoon-add-part` and `circuitoon-ship` skills stay repo-internal for now.

## 7. Tests
- Netlist parsing: valid, unknown module/pin/ref, hole references, labels vs names.
- Layout: deterministic output; no overlaps on fixtures of 5, 30 and 120 parts (incl. 84 tilt switches in 42 groups); groups stay together; breadboard mounts seat; performance under 2 s for 120 parts.
- CLI: each command's output and exit codes (check exits 1 on errors); `link` round-trips through the site's loader; `render` produces a PNG whose size matches the sheet.
- Site: opening a fragment link loads the diagram and clears the fragment (browser check).
- End to end: the three worked examples go netlist -> layout -> check (no errors) -> render -> link.

## Out of scope for this slice
MCP server, simulation, module authoring commands (`circuitoon module new/check/render`), publishing to npm, block instancing (repeated sub-sheets as real entities).
