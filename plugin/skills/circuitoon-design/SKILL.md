---
name: circuitoon-design
description: Design, verify and present an electronics wiring diagram with Circuitoon from a plain request - pick real parts, write a netlist, lay it out, prove it implements the requested circuit, render it and hand over a link that opens it in the Circuitoon editor. Use whenever someone asks for a wiring diagram, schematic, breadboard layout, hookup picture or pinout-level plan of a circuit (ESP32, Arduino, Pico, sensors, displays, batteries, switches, LEDs, I/O expanders), or wants one checked or presented, even if they do not say Circuitoon.
---

# Designing a circuit with Circuitoon

People wire real circuits from these pictures, so a wrong connection can cost them a board. Show nothing the tools have not verified, and say plainly what was not verified.

## Find the CLI

Everything goes through the `circuitoon` CLI that ships with this plugin. It needs Node 22 or newer. PNG output also needs Chrome or Edge.

When this skill loads, Claude Code shows its base directory. The CLI is two levels up from it:

```bash
node "<base directory of this skill>/../../bin/circuitoon.mjs" --help
```

- If no base directory was shown, search `~/.claude/plugins/cache/` for `**/circuitoon/**/bin/circuitoon.mjs` and use the newest match.
- Inside the Circuitoon repo itself, the CLI is `node plugin/bin/circuitoon.mjs`.
- Run `--help` once first. It prints the commands and proves the path is right.

Below, `circuitoon` stands for that whole command. Work in a scratch folder of the user's project, never inside the plugin folder.

## Rules that are never bent

- **Nothing reaches the user before `gate` passes.** After any change to the netlist or the sheet, run `gate` again. Present only files whose SHA-256 matches that run's `gate.json`: hash each file (for example `sha256sum out/sheet.png`, or `Get-FileHash` on Windows) and compare it with its entry in `artifacts[].sha256`; the sheet itself must match `diagram.sha256`.
- **The one exception is `GATE INCOMPLETE`** (exit 3: nothing blocks, but no browser could draw the PNGs). Then only `out/sheet.svg` and the link go to the user, labelled as not fully gated because the PNG step did not run. Nothing else.
- **Never invent a pin or a pinout.** Use the pin names that `circuitoon part <id>` prints. A part that is not built in may be embedded only from its maker's documentation, with those URLs in `source`, and it is reported as custom and unverified. If a pin cannot be sourced, say so and stop.
- **Ask about what you cannot verify.** Wiring choices the parts do not decide are the user's call: how many switches a sensor holds, whether they share one input, which channel or GPIO each one uses, an I2C address, the power source. For an ESP32, ask which module the board carries (WROOM or WROVER) before you use IO16 or IO17: a WROVER uses them for its PSRAM. Ask before you design. If you must assume to show an example, write the assumption in a netlist `note` and list it back to the user as an assumption to confirm.
- **Always report the gate's warnings, its notes and its "not checked" list** in plain words. Notes are not problems; say so.
- **Clear the readability warnings before presenting** (`wires-crowded`, `wire-hugs-part`, `label-covered`, `crossings-high`; see "Reading the gate"), or explain each one that remains and why it cannot go.
- **Look before you present:** read the full PNG and zoomed tiles of it (`render --tiles`) with the Read tool. A sheet that verifies but cannot be followed is not done.
- **Research never sends personal data.** No names, emails, addresses, order numbers or tokens in URLs, search queries or request bodies.

## Exit codes

Every command uses the same codes. Trust them:

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | ok | Carry on. |
| 1 | Findings that block: a verify or checker error, a netlist that cannot be laid out, a blocked gate | Fix the design and run it again. |
| 2 | Invalid input: a missing file, bad JSON, an invalid netlist or sheet, a bad option | Fix the file or the command line. |
| 3 | Environment problem, such as no Chrome or Edge | Tell the user what is missing. |

With `--json`, a failure prints `{ "ok": false, "exit": N, "error": { "code", "message" } }`. **`error.code: "internal"` (exit 3) is a bug in the tool, not a problem with the design.** Do not rework the circuit because of it. Report the message to the user as a Circuitoon bug, and include the command that caused it.

## Workflow

1. **Clarify the goal.** Ask for anything missing: the power source (USB, battery, adapter), the boards, the parts already on hand, and whether they want a full build or an illustrative example. Ask the questions from "Ask about what you cannot verify" above.
2. **Pick parts.** Run `circuitoon parts --search <text>`, then `circuitoon part <id>` for each part you use. Read its pin types, its pin limits in brackets and the pin notes: some pins are input-only (ESP32 GPIO34-39, Nano A6/A7), output-only (on the MCP23017, GPA7 and GPB7, so each chip takes 14 inputs, not 16), wired to the board's flash (ESP32 GPIO6-11: never use them) or strapping pins that must sit at one level at reset (ESP32 GPIO0, GPIO2, GPIO12). Give buttons, sensors and chip-select or reset lines pins with no limits. For I2C, `part` gives each device's address and whether its board has pull-ups. Use canonical pin names (`GND`, `IO21`). A silkscreen label works only when exactly one pin has it. If a part is missing, embed it under `modules` following `references/module-schema.md`, with `source`. Never guess.
3. **Write the netlist** (`references/netlist-format.md`). One net per electrical node.
   - Put parts that plug into a breadboard `on` it.
   - A header pin or pad takes one wire. With net labels (the default, see "Net labels" below) a net of three or more header pins needs nothing more: each pin gets a label. Without labels such a net needs a strip to share: add a breadboard or a `power-rail-strip`, or the layout fails with "needs a distribution point". Pins a part joins inside itself (an ESP32's `GND 2` and `GND 3` beside `GND`) each take a wire too, so a part with a free one can carry a net of three; see `references/netlist-format.md`. This includes a repeat whose template net holds two pins and is bound to a third.
   - Use `repeat` for repeated sub-circuits, with one explicit binding per copy.
   - Add `groups` and `notes` where they help someone read the sheet.
   - **Wire colors follow the convention:** GND is black, positive supply rails (3V3, 5V, VIN, battery +, regulator outputs) are red, and signals use any other color. The layout colors wires this way by itself; leave `wires.color` out unless the user asks for a color, and never give a signal red or black or a rail another color. Mains wiring keeps its regional identity colors and is exempt.
4. **Lay out once, then decide whether to split.** The report ends with the label mode, the nets drawn with labels, and the readability warnings count. Run `circuitoon layout netlist.json -o sheet.json` and read its report. If it shows the signs in "Large designs: split into sheets" below, split the netlist into sheets now, before any more work on the single sheet.
5. **Gate.** `circuitoon gate sheet.json -o out`. Fix every blocking finding in the netlist (or, for a hand edit, in the sheet), lay out again if the netlist changed, and gate again.
6. **Read the design back with `explain`.** Run `circuitoon explain sheet.json` and read every line against what the user asked for: each net joins the pins it should (`SDA: ESP32 DevKit V1 (U2) D21 -> 0.96" OLED 128x64 SSD1306 (DS1) SDA`), no part sits under "Not connected" that should be wired, every pin's limits fit its job (a button on a pin with "no internal pull-up" needs a resistor, nothing drives through an "input only" pin, a strapping pin carries nothing that pulls it the wrong way at reset), and each I2C device has its own address. Fix the netlist and gate again when anything does not match. A note that the sheet's copy of a part is older than the library means: lay it out again.
7. **Look at the renders** with the Read tool: `out/sheet.png` whole, then zoomed tiles of it: `circuitoon render sheet.json -o review.png --tiles 600` writes `review-tile-<row>-<col>.png`, each about 600 sheet px square; read every tile. For repeats also read `out/focus-<copy>.png`, and run `circuitoon render sheet.json -o block.png --focus <group or copy>` (with `--tiles` for a large block) on each block you need to check. These extra focus renders are for your review only: they are not in `gate.json`, so they are never presented. If you see overlapping labels, wires into the wrong strip, or a crowded knot, fix it (see "Improving a layout") and gate again.
8. **Present** (only after the last `gate` exited 0):
   - the PNG (`out/sheet.png`, plus the focused PNGs for repeats), together with the plain-English connection list from `explain` (its "Connections, by net" lines), so the user can check each wire against the picture;
   - the link, with its notice that anyone with the link can see the diagram and nothing is uploaded. If the link was too long, `gate` wrote the sheet file instead: give that file and say to open it with Import JSON;
   - the bill of materials (`out/bom.csv`, hashed in `gate.json`; its rows are also `bom` in `gate.json`) and, for repeats, the channel table. The bill counts what is on the sheet: parts, wires by cable, gauge and color, and connectors. Rows marked `added by layout` are rail strips, breadboards or jumpers the layout added to distribute nets, so say those are extra parts to buy;
   - every warning, explained; a readability warning you could not clear says what it is and why it stays;
   - the "not checked" list;
   - every assumption the user still has to confirm.

## Large designs: split into sheets

A pictorial sheet stops being followable long before the tools fail. Signs that a design needs splitting:

- more than about 30 parts, or more than about 60 wires;
- the layout report shows hundreds of wire crossings;
- in the PNG, you cannot trace a wire from end to end.

Split along real connectors:

- **One sheet per block.** For example: power, MCU and displays on one sheet, and one sheet per I/O expander bank.
- **Each sheet is its own netlist and its own gate.**
- **Cross sheets through a real part:** a `jst-xh-4` or `dupont-1x4` on each side, never a made-up "off-sheet" part. Give both ends the same pin order, and write it in a note on each sheet (for example "J1 comes from J2 on sheet 1: 1 GND, 2 3V3, 3 SDA, 4 SCL").
- **Review each block with `render --focus <group or copy>`.** Then present the sheets in order, each with its own link.

`references/examples/spirit-typewriter/` is a worked split: 42 two-switch balls on three MCP23017 banks, as four sheets.

## Net labels

A net label is a named flag at a pin: every label with the same name is one connection, exactly as if wired (names are case-sensitive). Labels make long and many-ended nets readable: no wire crosses the sheet.

- **Dense groups fan out:** a part with 4 or more labelled pins or pads on one side (a header, a display connector, an expander's pads) gets its labels as one ordered row beside it, in pin order, so the stubs never cross.
- **`layout --labels auto` (the default)** labels ground and supply nets with three or more endpoints or with endpoints far apart, and signal nets between different groups or repeat copies, or spread far apart. Each endpoint gets a short `routing` stub out to its label, placed clear of parts, captions and other labels. The pins of one repeat copy share one label. An endpoint with no room for a label is wired to the nearest label of its net; the report lists those nets.
- **`--labels all`** labels every net that can be; **`--labels none`** draws wires only.
- **`"label": true`** on a net asks for labels in auto mode too.
- **Mains is never labelled**: a net with a mains terminal is always wired (and `"label": true` on it is an error).
- Labels are not parts: verify counts a label join as a connection, and the bill of materials leaves labels out.

## Improving a layout

The `layout` report prints: body overlaps and caption overlaps (both must be 0), wire crossings, total wire length, sheet size, blocked nets (must be none), readability warnings, and the label mode with the labelled nets. Use crossings, readability warnings and wire length to compare attempts. Labels usually help most: a net that crosses the sheet is better as labels (`"label": true`, or `--labels all`). Always look at the picture as well.

**To move parts, use `layout --keep`.** Write a `circuitoon-partial/1` file that holds the netlist as `intent`, plus `x`, `y` and optional `rotation` for the parts you want to pin. Every other part is placed around them. Each spirit-typewriter sheet ships this way. Placing the breadboard in the middle and the boards around it took the main sheet from 678 crossings to 297.

**`--keep` gotcha (wires only, `--labels none`):** with labels, a repeat block's shared ground or power is a label at each copy's pins. Without them, the block gets its own local rail strips (`DP1`, `DP2`, ...), so each copy's shared net is a short drop. Those strips exist only when **no member of the block is kept**.

- If you copy a laid-out sheet into a partial with every part kept, the copies are kept. Their blocks then lose the local strips, and shared ports fall back to star wiring: one long wire from every switch to a distant rail.
- The `DP` parts themselves are not in the intent, so their positions are ignored, with a warning.
- To keep local distribution, pin only parts that are not in a repeat (boards, breadboards, connectors), and let the copies be placed again.

## Reading the gate

- `GATE PASSED` (exit 0): present, following step 8.
- `GATE BLOCKED` (exit 1): each blocking line names its rule: `missing-connection`, `merge`, `extra-connection`, `nc`, `capacity`, `value-drift`, `mount`, `extra-part`, `module-mismatch`, `module-drift` (the sheet's copy of a built-in part no longer matches the current library in its pins, holes, internal joins or electrical data; the message lists what differs: lay the sheet out again with the current library; when the part's body or pins moved, as the DIP-28s did when they were redrawn to scale, the message says so: remove that part's x, y and rotation from the partial before `layout --keep`, or lay out from the netlist, since keeping the old position pins it where the old drawing sat), `intent`, `load`, `blocked-route`, or a wiring checker rule (`short`, `reversed`, `supply-too-high`, ...). Fix the problem and gate again. Never present a blocked sheet.
- **Warning `module-drift`** means the sheet's copy of a built-in part differs from the library only in art, name, source or other description; its pins and electrical data match. The circuit is fine. Lay the sheet out again to pick up the current part before presenting when you can.
- **Warning `wire-over-holes`** names a wire drawn across breadboard holes that are in use (a wire end, a leg, or a hole under a part's body) that it is not plugged into: the router found no way around them, or a hand-drawn `route` crosses them. Crossing empty holes is fine and never warns: a jumper lies flat over them. The circuit is still correct, but in the picture the wire looks plugged in there. Look at that wire in the render. Fix it before presenting when you can: give the parts more room (`layout --keep` with the breadboard pinned and the others placed again), move the part the wire comes from off the far side of the board, or remove a hand-drawn `route`. If it stays, tell the user which wire crosses the holes and that it is not plugged in there.
- **Pin rules.** Errors `pin-flash` (something on a flash pin), `pin-input-only` (an input-only pin is the only thing driving an input or LED), `pin-output-only` (an output-only pin such as MCP23017 GPA7 reads a switch or sensor) and `i2c-address-clash` (two devices at one address on a bus) block: move the wire to the free GPIO the message suggests, or change an address. Warnings `pin-strapping` (a strapping pin pulled the wrong way at reset), `pin-no-pullup` (a switch on a pin with no internal pull-up and no resistor), `i2c-pullups` (no pull-ups on the bus) and `i2c-address-floating` (an address pin left open) are real faults to fix before presenting. The note `i2c-pullups-unknown` means no source says whether a module on the bus has pull-ups: tell the user to check the board (or add 4.7 kOhm pull-ups to SDA and SCL).
- **Readability warnings** never block, but clear them before presenting, or explain each one that remains:
  - `wires-crowded`: two wires of different nets run side by side within one grid step (10 px) for more than about 40 px. Give the parts more room (`layout --keep` with fewer parts pinned), or draw one of the nets with labels.
  - `wire-hugs-part`: a wire runs within 5 px of a part it does not connect to, so it reads as touching it. Move the part, or label the net.
  - `label-covered`: a wire or a part covers a caption or a net label. Move the part or label the net.
  - `crossings-high`: a wire crosses more than 8 others. Label its net, or place its parts nearer each other.
- **Warnings `wire-color-ground`, `wire-color-supply` and `wire-color-signal`** name the wires on one net that break the color convention (a ground wire that is not black, a supply wire that is not red, a signal wire that is red or black). They never block. Fix them by dropping or correcting the net's `wires.color` and laying out again; the default layout never raises them.
- `GATE INCOMPLETE` (exit 3): no Chrome or Edge was found for the PNGs. Tell the user. Present `out/sheet.svg` (already written by `gate`, and listed in `gate.json`) and the link, labelled as not fully gated, and say the PNG step did not run. Do not run `render` for a PNG: it needs the same browser and exits 3 too.

**SPI MISO.** `outputs-fight` on a shared SPI MISO net means several devices can drive it. A well-behaved SPI device releases MISO while its CS is high, which the checker cannot see, but many cheap TFT display modules do not release their SDO, so they corrupt reads from anything else on the bus, such as an SD card. When the design never reads a display, leave its SDO (MISO) unconnected and list it in `nc`: the warning then goes away and the bus is safe. Only when a display must be read does it share MISO; then tell the user: "The checker flags MISO because several devices drive it. That works only if each one releases MISO when its CS is high. If reads fail, the display is the usual culprit: give it its own MISO pin or a buffer." Any other `outputs-fight` is a real conflict: fix it.

## References

- `references/netlist-format.md`: every netlist field and rule, repeats, and the partial format for `--keep`.
- `references/cli.md`: commands, flags, exit codes and JSON outputs. The schemas are in `references/schemas/`.
- `references/module-schema.md`: how to write an embedded part.
- `references/examples.md` and `references/examples/`: an LED on a breadboard, an ESP32 with an I2C sensor, a battery board with a switch, eight repeated tilt sensors, and the Spirit Typewriter split into four sheets. Each one passes `gate`.
