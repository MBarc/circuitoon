# Agent toolkit, first slice: design (revision 2)

Status: direction approved by Michael (2026-09-27): a CLI plus skills packaged as a Claude Code plugin in the public repo, pulled forward so another Claude Code session (first user: the Spirit Typewriter session) can design, test and present a schematic. Built in parallel with the mains work. Revision 2 answers Astra's spec review (10 findings). MCP server, simulation and module authoring commands come later.

## Goal
An agent goes from a request to a schematic that provably implements the requested circuit, passes the checker, renders readably, and opens in Circuitoon, without guessing coordinates. Nothing is presented that the tools have not verified, and what is not verified is stated.

## 1. Netlist-first input (`circuitoon-netlist/1`)
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
Input contract (all violations are errors with a precise message; nothing is guessed):
- Endpoints: object form `{ "ref", "pin" }` or `{ "ref", "group", "hole" }` is canonical; the string form `"REF.PIN"` is shorthand, splitting at the first dot. Refs must match `[A-Za-z][A-Za-z0-9_]*`. A pin is matched by exact pin name first; a silkscreen label is accepted only when exactly one pin has it (ESP32 `GND`/`GND 2`/`GND 3` share the label `GND`: the label is rejected as ambiguous and the error lists the names). Hole indexes are zero-based; an omitted index means "any free hole of that group", chosen by the layout.
- Duplicate refs, duplicate net names, and an endpoint listed in two nets are errors. A part belongs to at most one group.
- `module` is a library id or an id defined under `modules` (embedded, validated like a library module); an embedded id equal to a library id is an error.
- `values` as in diagrams; `on` requests mounting on a breadboard ref (section 2.2).
- `groups: [{ name, parts }]`, `notes: [{ text, near }]` (`near` is a group name or a ref), `repeat` (section 1.1).
- The netlist is stored inside the output diagram as `intent` (section 3), so every later check can re-verify the circuit against it.

### 1.1 Repeated sub-circuits
`repeat: { name, count, template: { parts, nets }, map }` declares `count` copies of a template (e.g. 42 balls). `map` binds each copy's external connections by index (e.g. copy i's switch A to `U{2 + floor(i/16)}.GPA{i%16}` expressed as an explicit list, not a formula language: the agent writes the list; the tool checks it is complete and duplicate-free). Copies get refs `S1..S84` from a template ref pattern. The output diagram always contains every copy (the full logical circuit, verified and checked); layout tiles copies compactly, and the render offers a focused view of one copy (section 4). The CLI prints the channel allocation table and the bill of quantities.

## 2. Layout
### 2.1 Placement
- Deterministic on the 10 px grid with fixed tie-breaking (ref natural order): boards and MCUs first near the centre; other parts near what they connect to by net weight; groups and repeat copies as blocks, tiled.
- Clearance: part bodies and their captions (the label area drawn around parts) never overlap each other; mounted parts may overlap their board (and only it).
- Routing by the existing router after placement; bounded retries (up to 3 placements with increased spacing) when routes are blocked; if still blocked, layout fails with the list of blocked nets (it does not emit a diagram with blocked wires silently).
- `layout --keep sheet.json`: re-places only parts without coordinates in the given diagram (intent is kept).

### 2.2 Mounting and breadboard wiring
- A part with `on` is placed by searching candidate positions on its board: every grid position and rotations 0 and 90 degrees, in a fixed order (row-major from the board's top-left). A candidate is accepted when `seatOf` reports it seated, it conflicts with no other mounted part, and it does not short its own pins through a strip (two different nets on one strip is a merge, section 3); DIP parts straddle the centre channel. First accepted candidate wins. If none: layout fails naming the part and the reason.
- A net that reaches a mounted leg is wired to a free hole of that leg's strip (never into the leg's own hole, never two wire ends into one hole). If the strip has no free hole, the net is wired to another strip joined by a jumper, or layout fails with "strip full".
- Chains of wires never put more than one wire end on a terminal that cannot take it: on breadboards one end per hole; on module pins at most two wire ends (drawn as a chain through the pin); if a net needs more ends at one place, the layout routes through a breadboard strip or rail.

### 2.3 Readability acceptance (tested, reported)
Every layout reports: body overlaps (must be 0), caption overlaps (must be 0), wire crossings, total wire length, sheet size, and blocked nets (must be 0). The 2 s budget for 120 parts includes routing.

## 3. Verification (electrical equivalence)
- `circuitoon verify sheet.json` compares the realized connectivity (the netlist of the diagram: wires, breadboard strips, internal joins, plugs) with `intent`:
  - missing connection: two endpoints of one requested net are not connected: error;
  - unintended merge: endpoints of two different requested nets are connected: error;
  - extra connection to an endpoint not in any net: error unless the endpoint is a pin the intent lists as `nc` or the module joins it internally (reported as info).
- `verify` runs automatically inside `check` and `gate` when `intent` is present; editing the diagram by hand keeps `intent`, so a later check catches drift.

## 4. CLI (`circuitoon`)
### 4.1 Distribution
- Built by `npm run build:cli` into `dist-cli/circuitoon.mjs`: one bundled ES module (Node 22 or newer) containing the format, checker, layout, renderer (Sheet rendered with react-dom/server to SVG) and a generated module catalog (replacing `import.meta.glob`, which only works under Vite). Entry `bin/circuitoon.mjs` runs it; the plugin exposes it so the skill can call it from any project with `node <plugin>/bin/circuitoon.mjs ...` (the skill tells the agent how to find the path).
- SVG output is standalone: inline styles for the light theme (and dark with `--dark`), fonts embedded or a stated system-font fallback, tight content bounds.
- PNG output uses an installed Chrome or Edge through playwright-core (auto-detected); if none is found, the command fails with install guidance and suggests `--svg`.

### 4.2 Commands (plain text by default; `--json` prints one JSON document on stdout; diagnostics on stderr; exit codes: 0 ok, 1 findings that block (section 5), 2 invalid input, 3 environment problem such as no browser)
- `parts [--search text]`: modules with category, pins (name, label, type, supply), hole groups (name, type, supply), sources.
- `part <id>`: one module in full.
- `layout netlist.json -o sheet.json`: section 2; prints the readability report.
- `verify sheet.json`, `check sheet.json`: findings with stable ids, rule, severity, message, parts, pins, wires; plus the list of what the checker does not cover (section 5).
- `render sheet.json -o sheet.png [--svg f] [--dark] [--scale n] [--focus group-or-copy]`.
- `link sheet.json`: section 6.
- `gate sheet.json -o out/`: runs load, verify, check, render (full and one focused copy if repeats exist) and link, writes the artifacts plus `gate.json` with a SHA-256 of the diagram and each artifact, and exits 0 only when nothing blocks.
- JSON schemas for every `--json` output are documented in the skill's reference and tested.

## 5. The hard gate
Blocking (gate exits 1): loader errors; a missing module or dropped value override; any `verify` error; any checker error; any blocked route; any unseated requested mount; an oversized link without the file fallback written. Non-blocking warnings are listed in the gate summary and must be reported to the user. The summary always states what is not checked: current and heat, I2C and SPI addresses and conflicts, firmware behaviour, timing, mechanical fit, mains beyond connection checks, and the parts' own correctness beyond their cited sources.

## 6. Links (URL fragment)
- `#/editor?d=v1.<base64url(deflate-raw(json))>`. Limits: encoded payload up to 64 KB (the CLI refuses larger and writes the file instead); decompression aborts past 5 MB (the file import limit) and past 2,000 parts or 10,000 connections; malformed input shows the usual load error and never crashes the editor.
- After loading, the payload is removed with `history.replaceState` to `#/editor`, without remounting the editor (the App's route key must not change) and without losing the open document; reloading then shows the autosaved or empty editor as today.
- The link text states that anyone with the link can see the diagram (it is in the URL); nothing is uploaded.

## 7. Annotations (site and renderer)
- Group frames (a labelled rounded rectangle around the group's parts, computed from their bounds) and text notes are rendered in the Sheet (so in PNG/SVG exports) and on the editor canvas (read-only in this slice: selectable, movable, deletable, text editable in the Inspector). Validation: bounded text length, finite coordinates.

## 8. Skill `circuitoon-design` (plugin)
1. Clarify the goal: power source, boards, parts on hand, and whether a full design or an example is wanted. For the Spirit Typewriter, confirm whether each ball's two switches share one channel or need two.
2. Pick parts with `parts` / `part`; use canonical pin names. Missing part: write an embedded module in the netlist under `modules` following the published module schema (reference included), with its `source` URLs, marked as a custom unverified part in the summary; never invent pins without a source.
3. Write the netlist (use `repeat` for repeated sub-circuits).
4. Run `gate`. On any change to the netlist or diagram, run `gate` again; present only artifacts whose hashes match the last passing `gate.json`.
5. Look at the rendered images; readability problems are fixed and re-gated.
6. Present: the link, the full PNG, a focused PNG for repeats, the parts list and quantities, the channel allocation table (for repeats), the warnings, and the "not checked" list.
- References shipped with the skill: netlist format, JSON output schemas, the module schema for embedded parts, and worked examples: LED on a breadboard, ESP32 with an I2C sensor, battery board with a switch, and a repeated-sensor example (8 copies).

## 9. Packaging
- `.claude-plugin/plugin.json` and a marketplace entry in the repo; the plugin contains the `circuitoon-design` skill and the CLI bundle (committed `dist-cli` or built on install: decided in the plan by what the plugin system supports). `circuitoon-add-part` and `circuitoon-ship` stay repo-internal.

## 10. Tests
- Netlist parsing: every contract rule in section 1 (labels, ambiguity, holes, duplicates, embedded collisions, repeat maps complete and duplicate-free).
- Layout: determinism; zero body and caption overlaps on fixtures of 5, 30, 120 parts and the full typewriter-like topology (ESP32, 3 MCP23017 on breadboards, 84 tilt switches as 42 repeat copies, 2 SPI LCDs, OLED, microSD, power chain); mounts seat without strip merges; no double wire ends in holes; 2 s budget including routing; visual inspection of rendered fixtures.
- Verify: missing connection, merge through a strip, merge through an internal join, extra connection, drift after a hand edit.
- CLI: outputs, JSON schemas, exit codes, gate hashes, browser-missing path.
- Link: round trip, oversized refusal, malformed and oversized payloads, document survives fragment cleanup, reload behaviour (browser check).
- Annotations: rendered in SVG/PNG and on the canvas.
- End to end: every worked example passes `gate` and opens from its link.

## Out of scope for this slice
MCP server, simulation, module authoring commands, npm publishing, I2C/SPI address rules (listed as not checked).
