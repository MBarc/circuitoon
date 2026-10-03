<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/banner-dark.svg">
  <img src="docs/brand/banner.svg" alt="Circuitoon: circuit diagrams AI agents can design, check and hand you." width="100%">
</picture>
</p>

Circuitoon is a circuit diagram tool built for AI agents. An agent describes the circuit as a netlist; Circuitoon lays it out as a pictorial wiring sheet of real parts, checks every connection and pin, and hands back a link a person can open, drag around and edit in the browser.

**[Open the editor](https://mbarc.github.io/circuitoon/#/editor)** &nbsp;&nbsp; **[Set up the agent plugin](#for-ai-agents)** &nbsp;&nbsp; **[Read the product plan](docs/PRD.md)**

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/hero-dark.png">
  <img src="docs/brand/hero.png" alt="A Circuitoon sheet: an ESP32 DevKitC wired to a BME280 sensor over I2C, with red, black, yellow and blue Dupont wires, a Sensor group frame and a note." width="100%">
</picture>
</p>

<sub>Laid out by <code>circuitoon layout</code> from a four-net netlist (<a href="plugin/skills/circuitoon-design/references/examples/esp32-bme280.netlist.json">esp32-bme280</a>) and passed by <code>circuitoon gate</code> with nothing blocking and no readability warnings.</sub>

## For AI agents

The `circuitoon` CLI ships as a Claude Code plugin with the `circuitoon-design` skill, which teaches an agent the whole loop. Install it in Claude Code:

```text
/plugin marketplace add MBarc/circuitoon
/plugin install circuitoon@circuitoon
```

It needs Node 22 or newer, and Chrome or Edge for PNG output. Then the loop is:

1. The agent writes a netlist (`circuitoon-netlist/1`): parts by built-in id, nets by `REF.PIN`.
2. `circuitoon layout circuit.netlist.json -o sheet.json` places the parts, mounts them on breadboards and routes the wires.
3. `circuitoon gate sheet.json -o out/` runs every check, renders PNG and SVG, writes the bill of materials and the link. It exits 0 only when nothing blocks.
4. `circuitoon explain sheet.json` states every connection in plain English, net by net, with what each pin in use does.
5. The agent hands over the PNG and the link. The sheet travels inside the link, so nothing is uploaded.

### What gets verified

- **Connections:** the drawn sheet against the netlist it came from: every net, every part, every value, every mount.
- **Pinouts:** pin names come from the built-in parts, each with its pinout sources cited. An agent never invents a pin.
- **The wiring checker:** shorts, reversed polarity, supply voltage too high or too low, supplies or outputs fighting, no common ground, unpowered parts, bad breadboard seating, and mains wiring.
- **Pin rules:** input-only and output-only pins, flash and strapping pins, I2C addresses and pull-ups, from the caps each part declares.
- **Readability:** overlapping or crowded wires, covered labels, too many crossings and wires over populated boards. A sheet with any of these is not ready.

`gate` also lists what it does not check: current and heat, firmware behaviour, timing, mechanical fit, and mains beyond its connections.

The other commands are `parts`, `part`, `verify`, `check`, `render`, `link`, `bom` and `netlist`. In this repo, run `node plugin/bin/circuitoon.mjs --help`.

## And a human can open and edit every sheet

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/editor-dark.png">
  <img src="docs/brand/editor.png" alt="The Circuitoon editor: the parts library on the left, a battery, button, resistor and LED on the sheet, and the Problems panel on the right reporting a short circuit." width="100%">
</picture>
</p>

Every link opens in the editor at [mbarc.github.io/circuitoon](https://mbarc.github.io/circuitoon/), and so does any exported `.circuitoon.json`. From there it is an ordinary drawing tool:

- **Pictorial parts with real pinouts:** 143 built-in parts drawn in a flat Sticker style: boards, sensors, displays, batteries, passives, connectors and mains parts.
- **Drag and the wires follow.** Rotate, nudge, undo and redo.
- **Breadboards with real seating:** legs plug into holes and the strips conduct.
- **The wiring checker, live:** problems appear in the side panel as you wire.
- **Cable types:** Dupont M-M, M-F and F-F, solid-core jumpers, alligator leads, JST-XH and JST-PH, Qwiic, Grove, ferrules and banana leads, with wire gauge.
- **Smart guides and snapping** to edges, centres, wired pins and equal gaps, plus align and distribute.
- **Copy and paste** of parts, wires, frames and notes, across sheets and browser tabs.
- **Bill of materials:** parts, wires and connectors, exported as CSV.
- **Net labels:** named flags that join pins without a drawn wire.
- **Frames and notes** to group and explain parts of a sheet.
- **Import and export** as `.circuitoon.json`, and open the links the CLI makes.

## Quick start for developers

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests
npm run validate  # check every file in modules/
npm run deploy    # validate, test, build, publish to GitHub Pages
```

The CLI bundle `plugin/dist-cli/circuitoon.mjs` is committed. After any change under `src/` or `modules/`, run `npm run build:cli` and commit it (`npm run check:gen` fails otherwise).

## Parts

Each part is one JSON file in `modules/`, listing its pins and which side each sits on:

```json
{
  "format": "circuitoon-module/1",
  "id": "resistor",
  "name": "Resistor",
  "pins": [
    { "name": "1", "side": "left" },
    { "name": "2", "side": "right" }
  ]
}
```

Pins on a side appear in array order: left to right on `top` and `bottom`, top to bottom on `left` and `right`. The full format is in [`docs/PRD.md`](docs/PRD.md).

To add a part, follow the `circuitoon-add-part` skill in [`.claude/skills/`](.claude/skills/circuitoon-add-part/SKILL.md):

1. Source the pinout from the maker's documentation and cite every URL in `source`.
2. Encode the pins in physical order, with their types, supplies and pin capabilities.
3. Draw the art in the Sticker style, using a generator script in `scripts/` for families of parts.
4. Run `npm run validate`, `npm test`, `npm run build:cli` and `npm run check:gen`.
5. Look at the rendered part, then have someone else check the pinout against the sources before merging.

## Status and roadmap

Early development. The editor, the wiring checker and the agent toolkit (plugin 0.6.0) work today. Saving in the browser, PDF export and the art studio are planned for V1.

- **V2:** DC simulation in the browser: voltages, currents, overcurrent.
- **V3:** animation driven by the simulation: LEDs lighting, switches flipping.
- **Ideas being explored:** firmware for the boards on a sheet, and KiCad export.

## Project layout

```text
src/            the editor, the renderer, the checker and the CLI source
  format/       sheet and module formats, netlist, checker, pin rules, mains analysis
  render/       the Sticker-style drawing of parts, wires and sheets
  editor/       canvas, panels, smart guides, clipboard, bill of materials
  agent/        netlist layout and verify
  cli/          the circuitoon commands
modules/        built-in parts, one JSON file each
plugin/         the Claude Code plugin: CLI bundle and the circuitoon-design skill
scripts/        part generators, validators and browser checks
docs/           PRD.md, design specs and plans, brand assets
```

## License

To be decided. The repository has no licence file yet.
