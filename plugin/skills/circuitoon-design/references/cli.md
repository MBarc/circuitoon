# circuitoon CLI

Run it as `node <plugin>/bin/circuitoon.mjs <command>` (Node 22 or newer). `SKILL.md` says how to find `<plugin>` from any project.

- Output is plain text by default.
- `--json` prints exactly one JSON document on stdout.
- Diagnostics go to stderr.

## Exit codes

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | Findings that block: verify or checker errors, a netlist that cannot be laid out, a blocked gate. |
| 2 | Invalid input: a missing file, bad JSON, an invalid netlist or sheet, a bad option. |
| 3 | Environment problem: no Chrome or Edge for PNG (install one, set `CIRCUITOON_BROWSER` to its path, or use `--svg`). Also used for an internal error of the tool. |

Under `--json`, every failure that has no command result prints one error document (`schemas/error.schema.json`):

```json
{ "format": "circuitoon-cli/error/1", "ok": false, "exit": 2, "error": { "code": "input", "message": "..." } }
```

`error.code` is one of:

- `usage`: a bad command line;
- `input`: exit 2;
- `blocked`: exit 1;
- `environment`: exit 3;
- `internal`: exit 3, and a bug in the CLI. It says nothing about the design: report it, do not redesign.

## Commands

| Command | Does | `--json` schema |
| --- | --- | --- |
| `parts [--search text]` | Lists built-in parts: category, pins (name, label, type, supply, capacity, caps), hole groups, source. An untyped pin reports type `null`. | `schemas/parts.schema.json` |
| `part <id>` | One module in full, with each pin's limits in words (`[input only; no internal pull-up or pull-down]`), the pin notes, and the I2C device data (bus pins, address, pull-ups). | `schemas/part.schema.json` |
| `layout <netlist.json> -o <sheet.json> [--labels none\|auto\|all]` | Places, mounts, wires and routes. `--labels` picks which nets get net labels: by default `none`, wires only, except nets marked `"label": true` (see SKILL.md "Wires and net labels"). Prints the readability report (with the readability warnings count, the label mode, the labelled nets and any net with an endpoint that had no room for its label), the bill of quantities and the channel table. | `schemas/layout.schema.json` |
| `layout --keep <partial.json> -o <sheet.json>` | The same, keeping the positions the partial gives (see `netlist-format.md`). | `schemas/layout.schema.json` |
| `verify <sheet.json>` | Checks the sheet against its intent: parts, modules, values, mounts, missing connections, merges, extra connections, nc, terminal capacity, and a wire end or leg in a hole under a part's body (covered-hole). | `schemas/findings.schema.json` |
| `check <sheet.json>` | The wiring checker (shorts, reversed power, wrong voltage, no ground, outputs that fight, ...), plus verify when the sheet has an intent, `module-drift` on any sheet (blocking or warning, as in verify), plus the readability warnings (`wires-overlap`, `wires-crowded`, `wire-hugs-part`, `label-covered`, `crossings-high`, `wire-over-board`; never blocking, also in `gate`). | `schemas/findings.schema.json` |
| `update <sheet.json> [-o <out.json>]` | Brings the sheet's stored built-in parts up to date where the library only adds or describes data (pin caps, I2C data, settings, ratings, a footprint, art, name): each such copy is replaced by the library's, and one line per part says what changed. A copy whose pins, holes, internal joins or geometry changed is left alone and listed (blocking `module-drift`: place that part again). Writes the sheet back, or to `-o`. Exit 0, or 1 when blocking drift remains. | `schemas/update.schema.json` |
| `explain <sheet.json\|netlist.json>` | The design in plain English, to read back against the request: every connection grouped by net (`SDA: ESP32 DevKit V1 (U2) D21 -> 0.96" OLED 128x64 SSD1306 (DS1) SDA`), then per part what each pin in use does (type, I2C role, and its datasheet limits: `U2 D34: input only, no internal pull-up or pull-down`), each I2C device's address, the parts nothing connects to, and the pin-rule findings (`pin-*`, `i2c-*`). A sheet is read from its real connectivity, a netlist (or a partial's intent) from its nets. `notes` names each custom part (user-made, unverified) and says when a sheet's copy of a part is older than the library. Never blocks: exit 0 (`ok` is false when a finding is an error), or 2 for a file that is not a sheet, netlist or partial. | `schemas/explain.schema.json` |
| `render <sheet.json> -o <png> [--svg <svg>] [--dark] [--scale n] [--focus <copy or group>] [--tiles <px>]` | A PNG (through Chrome or Edge) and a standalone SVG. `--focus` frames one repeat copy (`ball_3`) or group (`Power`), with the wires that touch it. `--tiles <px>` (200 to 4000) also writes the sheet, or the focused part, cut into overlapping tiles about `<px>` sheet px square, as `<png name>-tile-<row>-<col>.png`, for reading a large sheet up close. | `schemas/render.schema.json` |
| `link <sheet.json> [-o <dir>]` | A link that opens the sheet in the editor. Past 64 KB of payload, the sheet file is written instead. | `schemas/link.schema.json` |
| `netlist <sheet.json> [-o <netlist.json>]` | The `circuitoon-netlist/1` of any drawn sheet, from what conducts on it: parts, modules, values, mounts (`on`), and nets through wires, breadboard strips, mounted legs, internal joins and net labels. Nets are named from labels, then GND, a supply rail (5V, 3V3), then `<ref>_<pin>`. Prints the netlist, or writes it with `-o`. Run it before laying out a user's drawn sheet; never copy one by hand. | `schemas/netlist.schema.json` |
| `bom <sheet.json> [-o <bom.csv>]` | The bill of materials (see below). Prints one line per row; `-o` writes it as CSV. Never blocks: exit 0, or 2 when the sheet does not load. | `schemas/bom.schema.json` |
| `gate <sheet.json> -o <dir>` | Everything above (see below). Exits 0 only when nothing blocks. | `schemas/gate.schema.json` |
| `module new [--spec <spec.json>] [-o <part.json>]` | A custom part from a part spec (`circuitoon-part-spec/1`, `schemas/part-spec.schema.json`), or the spec on standard input when `--spec` is left out or `-`. The part gets Sticker art (a header strip and pin names inside the body, or `"style": "chip"`), `"custom": true` and an id starting with `custom-`, then the lint below. Prints the module, or writes it with `-o`. A part with lint errors is never written: exit 1. A spec that is not valid: exit 2. See the `circuitoon-custom-part` skill. | `schemas/module-new.schema.json` |
| `module check <part.json>` | Lints any module: validation errors, duplicate pin names, art that does not match the pins, impossible pin capabilities (errors), and power pins with no type or supply, supplies the checker cannot read, no types at all, no source, not marked custom (warnings). Exit 1 on errors; warnings never fail it. | `schemas/module-check.schema.json` |
| `module render <part.json> -o <png> [--svg <svg>] [--dark] [--scale n]` | Draws the part alone (scale 3 by default), so you can look at it before using it. | `schemas/render.schema.json` |

The readability report lists:

- body overlaps and caption overlaps (both must be 0);
- wire crossings;
- total wire length;
- sheet size;
- blocked nets (must be none).

`gate` writes these files to the out directory:

- `sheet.svg` and `sheet.png`;
- `focus-<copy>.png` for the first copy of a repeat;
- `link.txt`, or the sheet file when the link would be too long;
- `bom.csv`, the bill of materials (the same file `bom -o` writes);
- `gate.json` (format `circuitoon-cli/gate/3`; version 2 added the required `bom` field and the `bom` artifact, version 3 the required `ready`: true only when the gate passed and no readability warning remains), with the SHA-256 of the sheet and of every artifact, the blocking findings, the warnings, the notes (each custom part on the sheet is one, rule `custom-part`), the "not checked" list, the link, the bill of materials (`bom`, the rows `bom.csv` is written from), the bill of quantities (the bill's parts summed per module; `added` is how many of each part the layout added as routing infrastructure) and the channel table.

## Bill of materials

`bom` and `gate` build the same bill, and the editor's Bill of materials panel shows it too:

- **Parts**, grouped by module and value, with designator ranges: `4 x 18650 holder (1 cell), BT1-BT4`, `2 x Resistor (1/4 W), 100 kΩ, R2, R3`. Each row has the module's category and its source links. Breadboards and rail strips are parts too; a part the sheet's intent does not name was added by the layout and is marked `added by layout`. An embedded part is marked `custom, unverified`.
- **Wires**, counted by cable (its two ends, either way round), gauge and the color they are drawn in: `12 x Dupont M-M jumper, 22 AWG, red`. Wires the layout added (`routing: true`) are marked.
- **Connectors**, counted per end kind (Dupont male, JST-XH plug, ferrule, ...). Bare, stripped and solid-core ends are not connectors.

The CSV has the columns `Type` (Part, Wire or Connector), `Qty`, `Description`, `Value`, `Designators`, `Category`, `Source` and `Notes`. Every field is quoted (RFC 4180, CRLF line ends), units are plain ASCII (`4.7 kohm`), and a value that starts with `=`, `+`, `-` or `@` gets a leading `'` so no spreadsheet runs it as a formula.

Text mode starts with `GATE PASSED`, `GATE BLOCKED` or `GATE INCOMPLETE`. When readability warnings remain, a line `NOT READY: N readability warnings` comes first (the exit code is unchanged: they never block). A sheet that is not ready is presented only with each of those warnings listed to the user, with why it stays.

## Findings

Every finding has:

- a stable `id` (the rule plus what caused it);
- `rule`;
- `severity`: `error` (blocks), `warning` or `info` (a note, such as a parallel battery bank: never blocks, not a problem);
- `message`;
- the `parts`, `pins` and `wires` it is about.

## Fonts

SVG text uses Atkinson Hyperlegible when it is installed, and the system sans-serif otherwise.
