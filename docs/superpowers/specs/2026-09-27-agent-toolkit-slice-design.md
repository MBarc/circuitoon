# Agent toolkit, first slice: design (revision 5)

Status: direction approved by Michael (2026-09-27): a CLI plus skills packaged as a Claude Code plugin in the public repo, pulled forward so another Claude Code session (first user: the Spirit Typewriter session) can design, test and present a schematic. Built in parallel with the mains work. Revision 2 answers Astra's spec review (10 findings); revision 3 its re-review (terminal capacity, nc, inventory drift, intent required, routing infrastructure, repeat bindings); revision 4 defines what counts as a connection for verification and checks capacity on the realized diagram; revision 5 records what implementation settled (rulings T1, T6, T7, T10, T11, T12 and a parts correction): PNG through a direct headless browser, mount search by best net-affinity score, the router avoiding other strips' holes and captions site-wide, the Spirit Typewriter drawn as split sheets, the gate document format `circuitoon-cli/gate/1`, and 14 inputs per MCP23017. MCP server, simulation and module authoring commands come later.

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
- Endpoints: object form `{ "ref", "pin" }` or `{ "ref", "group", "hole" }` is canonical; the string form `"REF.PIN"` is shorthand, splitting at the first dot. Refs must match `[A-Za-z][A-Za-z0-9_]*`. A pin is matched by exact pin name first (`GND` on the ESP32 is the pin named `GND`); only when no pin has that exact name is a silkscreen label tried, and it is accepted only when exactly one pin has it (a label shared by several pins is rejected and the error lists their names). Hole indexes are zero-based; an omitted index means "any free hole of that group", chosen by the layout.
- Duplicate refs, duplicate net names, and an endpoint listed in two nets are errors. A part belongs to at most one group.
- `module` is a library id or an id defined under `modules` (embedded, validated like a library module); an embedded id equal to a library id is an error.
- `values` as in diagrams; `on` requests mounting on a breadboard ref (section 2.2).
- `nc: [endpoints]` lists pins that must stay unconnected; any connection to one is a verification error.
- `groups: [{ name, parts }]`, `notes: [{ text, near }]` (`near` is a group name or a ref), `repeat` (section 1.1).
- The netlist is stored inside the output diagram as `intent` (section 3), so every later check can re-verify the circuit against it.

### 1.1 Repeated sub-circuits
`repeat: { name, count, template: { parts, nets, ports }, bindings, shared }` declares `count` copies of a template (e.g. 42 balls). The template names its external `ports` (e.g. `A`, `B`, `GND`). `bindings` is an explicit list, one entry per copy, mapping each non-shared port to an outside endpoint (e.g. copy 1: `{ "A": "U2.GPA0", "B": "U2.GPB0" }`); the tool checks every copy binds every non-shared port exactly once and that no outside endpoint is bound by two copies. `shared` names ports joined to one outside net in every copy (e.g. `{ "GND": "GND" }`), which is where reuse is intended. Template refs expand as `<ref>_<copy>` by default, or by an explicit `refs` pattern; an expanded ref colliding with another ref is an error. The output diagram always contains every copy (the full logical circuit, verified and checked); layout tiles copies compactly, and the render offers a focused view of one copy (section 4). The CLI prints the channel allocation table and the bill of quantities.

## 2. Layout
### 2.1 Placement
- Deterministic on the 10 px grid with fixed tie-breaking (ref natural order): boards and MCUs first near the centre; other parts near what they connect to by net weight; groups and repeat copies as blocks, tiled.
- Clearance: part bodies and their captions (the label area drawn around parts) never overlap each other; mounted parts may overlap their board (and only it).
- Routing by the existing router after placement; bounded retries (up to 3 placements with increased spacing) when routes are blocked; if still blocked, layout fails with the list of blocked nets (it does not emit a diagram with blocked wires silently).
- `layout --keep partial.json`: accepts a layout-only partial diagram (the diagram format with `x`/`y` optional on parts and connections without routes) plus its intent; re-places only parts without coordinates. The partial format is validated by its own relaxed loader and is never accepted by the site.

### 2.2 Mounting and breadboard wiring
- A part with `on` is placed by searching candidate positions on its board: every grid position and rotations 0 and 90 degrees, in a fixed order (row-major from the board's top-left). A candidate is accepted when `seatOf` reports it seated, it conflicts with no other mounted part, and it does not short its own pins through a strip (two different nets on one strip is a merge, section 3); DIP parts straddle the centre channel. Revision 5 (ruling T7): among the accepted candidates, the one with the best net-affinity score wins (legs landing near the parts and strips their nets already reach), ties broken by the fixed order; taking the first accepted candidate produced long, misleading jumpers. If none: layout fails naming the part and the reason.
- A net that reaches a mounted leg is wired to a free hole of that leg's strip (never into the leg's own hole, never two wire ends into one hole). If the strip has no free hole, the net is wired to another strip joined by a jumper, or layout fails with "strip full".
- Terminal capacity: a breadboard hole takes one wire end; a header pin or pad takes one wire end (a Dupont socket or a solder joint), unless its module declares `capacity` (for example a screw terminal that takes two). A net that would need more ends at a terminal is routed through a breadboard strip or rail already in the netlist; if none is available, layout fails with "needs a distribution point" and names the net, so the agent adds a breadboard, rail strip or terminal block to the netlist. Layout never draws two wires into one header pin.
- Everything layout adds to realize connections (wires into strip holes, jumpers between strips, rail wires) is marked `routing: true` on the connection, so verification can tell routing infrastructure from intended component connections.
- Revision 5 (rulings T6, T10): the shared router (layout, editor and export alike) avoids the holes of strips a wire does not belong to, and part captions and frame labels, through avoid points; when no route exists with them, it falls back to the unavoided route rather than blocking. A wire drawn over an unrelated strip reads as a connection to it wherever the sheet is seen, so this is site-wide, not layout-only. Shared repeat ports are distributed locally (a rail strip per repeat block, joined to the net by one trunk wire), and each block is reserved space beside its target part.

### 2.3 Readability acceptance (tested, reported)
Every layout reports: body overlaps (must be 0), caption overlaps (must be 0), wire crossings, total wire length, sheet size, and blocked nets (must be 0). The 2 s budget for 120 parts includes routing.

## 3. Verification (electrical equivalence)
- `circuitoon verify sheet.json` compares the diagram with `intent`:
  - inventory: every intended part exists with the intended module and effective values (after loading, so a dropped override is caught), requested mounts are seated, and no component part exists that the intent does not list (breadboards, rail strips and jumpers named in the intent or added as routing infrastructure are allowed);
  - missing connection: two endpoints of one requested net are not connected: error;
  - unintended merge: endpoints of two different requested nets are connected: error;
  - extra connection: a component pin that is in no requested net and not joined internally by its own module is connected to anything: error; breadboard holes, strips and `routing: true` wires are infrastructure and never count as extra endpoints themselves, but the component pins they reach are checked like any other;
  - `nc`: any connection to a pin listed in `nc` is an error.
  - What counts as a connection: two component pins are connected when a path of wires, strips, internal joins or plugs joins them. A pin whose only neighbours are infrastructure (breadboard holes and strips, rails, `routing: true` wires) with no other component pin on that path is unconnected: a seated leg alone in an empty strip is not an extra connection and does not violate `nc`.
  - Terminal capacity on the realized diagram: every header pin, pad and breadboard hole holds no more wire ends and legs than its capacity (section 2.2; a hole holds one leg or one wire end). A hand edit that adds a second wire to a capacity-one pin, or a wire into an occupied hole, is a verify error, so `gate` blocks it.
- `check` runs `verify` when `intent` is present. `gate` requires a valid `intent` (a diagram without one fails the gate with "no intent: lay out from a netlist or add intent"); plain `check` still works on any diagram. Editing the diagram by hand keeps `intent`, so a later check catches drift.

## 4. CLI (`circuitoon`)
### 4.1 Distribution
- Built by `npm run build:cli` into `dist-cli/circuitoon.mjs`: one bundled ES module (Node 22 or newer) containing the format, checker, layout, renderer (Sheet rendered with react-dom/server to SVG) and a generated module catalog (replacing `import.meta.glob`, which only works under Vite). Entry `bin/circuitoon.mjs` runs it; the plugin exposes it so the skill can call it from any project with `node <plugin>/bin/circuitoon.mjs ...` (the skill tells the agent how to find the path).
- SVG output is standalone: inline styles for the light theme (and dark with `--dark`), fonts embedded or a stated system-font fallback, tight content bounds.
- PNG output uses an installed Chrome or Edge (auto-detected); if none is found, the command fails with install guidance and suggests `--svg`. Revision 5 (ruling T1, approved as a deviation by Astra's review): the CLI drives the browser directly in headless mode to screenshot the standalone SVG, not through playwright-core, because an installed plugin has no `node_modules`; playwright-core stays a dev dependency for the repo's browser checks. PNG output is tested beyond its dimensions: it is neither blank nor clipped.
- Revision 5: the bundle is committed at `plugin/dist-cli/circuitoon.mjs` with the entry `plugin/bin/circuitoon.mjs` (section 9); `npm run check:gen` fails when it is stale.

### 4.2 Commands (plain text by default; `--json` prints one JSON document on stdout; diagnostics on stderr; exit codes: 0 ok, 1 findings that block (section 5), 2 invalid input, 3 environment problem such as no browser)
- `parts [--search text]`: modules with category, pins (name, label, type, supply), hole groups (name, type, supply), sources.
- `part <id>`: one module in full.
- `layout netlist.json -o sheet.json`: section 2; prints the readability report.
- `verify sheet.json`, `check sheet.json`: findings with stable ids, rule, severity, message, parts, pins, wires; plus the list of what the checker does not cover (section 5).
- `render sheet.json -o sheet.png [--svg f] [--dark] [--scale n] [--focus group-or-copy]`.
- `link sheet.json`: section 6.
- `gate sheet.json -o out/`: runs load, verify, check, render (full and one focused copy if repeats exist) and link, writes the artifacts plus `gate.json` with a SHA-256 of the diagram and each artifact, and exits 0 only when nothing blocks. Revision 5 (ruling T12): the gate document carries `"format": "circuitoon-cli/gate/1"`, like the other `--json` documents.
- JSON schemas for every `--json` output are documented in the skill's reference and tested.

## 5. The hard gate
Blocking (gate exits 1): missing or invalid intent; loader errors; a missing module or dropped value override; any `verify` error (connectivity, inventory, values, mounts, nc); any checker error; any blocked route; any unseated requested mount; an oversized link without the file fallback written. Non-blocking warnings are listed in the gate summary and must be reported to the user. The summary always states what is not checked: current and heat, I2C and SPI addresses and conflicts, required configuration inputs left floating (for example an MCP23017 RESET or address pins; unless listed in the intent they are only as checked as the checker's no-power rules), firmware behaviour, timing, mechanical fit, mains beyond connection checks, and the parts' own correctness beyond their cited sources.

## 6. Links (URL fragment)
- `#/editor?d=v1.<base64url(deflate-raw(json))>`. Limits: encoded payload up to 64 KB (the CLI refuses larger and writes the file instead); decompression aborts past 5 MB (the file import limit) and past 2,000 parts or 10,000 connections; malformed input shows the usual load error and never crashes the editor.
- After loading, the payload is removed with `history.replaceState` to `#/editor`, without remounting the editor (the App's route key must not change) and without losing the open document; reloading then shows the autosaved or empty editor as today.
- The link text states that anyone with the link can see the diagram (it is in the URL); nothing is uploaded.

## 7. Annotations (site and renderer)
- Group frames (a labelled rounded rectangle around the group's parts, computed from their bounds) and text notes are rendered in the Sheet (so in PNG/SVG exports) and on the editor canvas, where they can be selected, moved, deleted, and their text edited in the Inspector (no drawing tool for new ones in this slice). Validation: bounded text length, finite coordinates.

## 8. Skill `circuitoon-design` (plugin)
1. Clarify the goal: power source, boards, parts on hand, and whether a full design or an example is wanted. For the Spirit Typewriter, confirm whether each ball's two switches share one channel or need two. Correction (revision 5): GPA7 and GPB7 are output-only on the MCP23017, so each chip has 14 inputs, not 16; 42 balls sharing one channel each fill exactly three chips, and 84 separate channels need six.
2. Pick parts with `parts` / `part`; use canonical pin names. Missing part: write an embedded module in the netlist under `modules` following the published module schema (reference included), with its `source` URLs, marked as a custom unverified part in the summary; never invent pins without a source.
3. Write the netlist (use `repeat` for repeated sub-circuits).
4. Run `gate`. On any change to the netlist or diagram, run `gate` again; present only artifacts whose hashes match the last passing `gate.json`.
5. Look at the rendered images; readability problems are fixed and re-gated.
6. Present: the link, the full PNG, a focused PNG for repeats, the parts list and quantities, the channel allocation table (for repeats), the warnings, and the "not checked" list.
- References shipped with the skill: netlist format, JSON output schemas, the module schema for embedded parts, and worked examples: LED on a breadboard, ESP32 with an I2C sensor, battery board with a switch, and a repeated-sensor example (8 copies).
- Revision 5 (rulings T10, T11): large designs are split into several sheets, each its own netlist and diagram, each gated, with `render --focus` per block for review; the skill states the readability numbers the layout report gives and when to split. The Spirit Typewriter worked example is drawn as split sheets: power, ESP32 and displays with an I2C and power connector header, then one sheet per expander bank (its MCP23017, its 14 balls and a matching connector header from the catalog). One 84-switch pictorial sheet cannot be made readable; the single-sheet typewriter fixture stays as a layout stress test only.

## 9. Packaging
- `.claude-plugin/plugin.json` and a marketplace entry in the repo; the plugin contains the `circuitoon-design` skill and the CLI bundle (committed `dist-cli` or built on install: decided in the plan by what the plugin system supports). `circuitoon-add-part` and `circuitoon-ship` stay repo-internal.
- Revision 5: the marketplace is `.claude-plugin/marketplace.json` at the repo root (marketplace `circuitoon`, one plugin `circuitoon` with source `./plugin`); the plugin's manifest is `plugin/.claude-plugin/plugin.json`, and the bundle is committed (`plugin/dist-cli`). Install: `/plugin marketplace add MBarc/circuitoon`, then `/plugin install circuitoon@circuitoon`.

## 10. Tests
- Netlist parsing: every contract rule in section 1 (labels, ambiguity, holes, duplicates, embedded collisions, repeat maps complete and duplicate-free).
- Layout: determinism; zero body and caption overlaps on fixtures of 5, 30, 120 parts and the full typewriter-like topology (ESP32, 3 MCP23017 on breadboards, 84 tilt switches as 42 repeat copies, 2 SPI LCDs, OLED, microSD, power chain); mounts seat without strip merges; no double wire ends in holes; 2 s budget including routing; visual inspection of rendered fixtures.
- Verify: an unused seated leg alone in its strip (not extra, not an nc violation); a hand edit adding a second wire to a header pin (blocked); a wire into an occupied hole (blocked); missing connection, merge through a strip, merge through an internal join, extra component connection, routing infrastructure allowed, nc violated, value drift (220 to 2200 ohm), module swapped, unseated mount, extra part, missing intent fails the gate, drift after a hand edit.
- Layout capacity: a net with more ends than a header pin takes fails with "needs a distribution point" unless a breadboard or terminal is in the netlist; never two wires into one header pin.
- Repeat bindings: reused channel across copies rejected; shared GND accepted; ref expansion and collision.
- CLI: outputs, JSON schemas, exit codes, gate hashes, browser-missing path.
- Link: round trip, oversized refusal, malformed and oversized payloads, document survives fragment cleanup, reload behaviour (browser check).
- Annotations: rendered in SVG/PNG and on the canvas.
- End to end: every worked example passes `gate` and opens from its link.

## Out of scope for this slice
MCP server, simulation, module authoring commands, npm publishing, I2C/SPI address rules (listed as not checked).
