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
| `parts [--search text]` | Lists built-in parts: category, pins (name, label, type, supply, capacity), hole groups, source. An untyped pin reports type `null`. | `schemas/parts.schema.json` |
| `part <id>` | One module in full. | `schemas/part.schema.json` |
| `layout <netlist.json> -o <sheet.json>` | Places, mounts, wires and routes. Prints the readability report, the bill of quantities and the channel table. | `schemas/layout.schema.json` |
| `layout --keep <partial.json> -o <sheet.json>` | The same, keeping the positions the partial gives (see `netlist-format.md`). | `schemas/layout.schema.json` |
| `verify <sheet.json>` | Checks the sheet against its intent: parts, modules, values, mounts, missing connections, merges, extra connections, nc, terminal capacity, and a wire end or leg in a hole under a part's body (covered-hole). | `schemas/findings.schema.json` |
| `check <sheet.json>` | The wiring checker (shorts, reversed power, wrong voltage, no ground, outputs that fight, ...), plus verify when the sheet has an intent. | `schemas/findings.schema.json` |
| `render <sheet.json> -o <png> [--svg <svg>] [--dark] [--scale n] [--focus <copy or group>]` | A PNG (through Chrome or Edge) and a standalone SVG. `--focus` frames one repeat copy (`ball_3`) or group (`Power`), with the wires that touch it. | `schemas/render.schema.json` |
| `link <sheet.json> [-o <dir>]` | A link that opens the sheet in the editor. Past 64 KB of payload, the sheet file is written instead. | `schemas/link.schema.json` |
| `bom <sheet.json> [-o <bom.csv>]` | The bill of materials (see below). Prints one line per row; `-o` writes it as CSV. Never blocks: exit 0, or 2 when the sheet does not load. | `schemas/bom.schema.json` |
| `gate <sheet.json> -o <dir>` | Everything above (see below). Exits 0 only when nothing blocks. | `schemas/gate.schema.json` |

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
- `gate.json` (format `circuitoon-cli/gate/2`; version 2 added the required `bom` field and the `bom` artifact), with the SHA-256 of the sheet and of every artifact, the blocking findings, the warnings, the notes, the "not checked" list, the link, the bill of materials (`bom`, the rows `bom.csv` is written from), the bill of quantities (the bill's parts summed per module; `added` is how many of each part the layout added as routing infrastructure) and the channel table.

## Bill of materials

`bom` and `gate` build the same bill, and the editor's Bill of materials panel shows it too:

- **Parts**, grouped by module and value, with designator ranges: `4 x 18650 holder (1 cell), BT1-BT4`, `2 x Resistor (1/4 W), 100 kΩ, R2, R3`. Each row has the module's category and its source links. Breadboards and rail strips are parts too; a part the sheet's intent does not name was added by the layout and is marked `added by layout`. An embedded part is marked `custom, unverified`.
- **Wires**, counted by cable (its two ends, either way round), gauge and the color they are drawn in: `12 x Dupont M-M jumper, 22 AWG, red`. Wires the layout added (`routing: true`) are marked.
- **Connectors**, counted per end kind (Dupont male, JST-XH plug, ferrule, ...). Bare, stripped and solid-core ends are not connectors.

The CSV has the columns `Type` (Part, Wire or Connector), `Qty`, `Description`, `Value`, `Designators`, `Category`, `Source` and `Notes`. Every field is quoted (RFC 4180, CRLF line ends), units are plain ASCII (`4.7 kohm`), and a value that starts with `=`, `+`, `-` or `@` gets a leading `'` so no spreadsheet runs it as a formula.

Text mode starts with `GATE PASSED`, `GATE BLOCKED` or `GATE INCOMPLETE`.

## Findings

Every finding has:

- a stable `id` (the rule plus what caused it);
- `rule`;
- `severity`: `error` (blocks), `warning` or `info` (a note, such as a parallel battery bank: never blocks, not a problem);
- `message`;
- the `parts`, `pins` and `wires` it is about.

## Fonts

SVG text uses Atkinson Hyperlegible when it is installed, and the system sans-serif otherwise.
