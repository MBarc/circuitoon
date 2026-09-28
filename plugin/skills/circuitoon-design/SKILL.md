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
- **Always report the gate's warnings and its "not checked" list** in plain words.
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
2. **Pick parts.** Run `circuitoon parts --search <text>`, then `circuitoon part <id>` for each part you use. Read its pin types and notes: some pins are input-only or output-only (on the MCP23017, GPA7 and GPB7 are output-only, so each chip takes 14 inputs, not 16). Use canonical pin names (`GND`, `IO21`). A silkscreen label works only when exactly one pin has it. If a part is missing, embed it under `modules` following `references/module-schema.md`, with `source`. Never guess.
3. **Write the netlist** (`references/netlist-format.md`). One net per electrical node.
   - Put parts that plug into a breadboard `on` it.
   - A header pin or pad takes one wire. A net of three or more pins therefore needs a strip to share: add a breadboard or a `power-rail-strip`. Otherwise the layout fails with "needs a distribution point". This includes a repeat whose template net holds two pins and is bound to a third.
   - Use `repeat` for repeated sub-circuits, with one explicit binding per copy.
   - Add `groups` and `notes` where they help someone read the sheet.
4. **Lay out once, then decide whether to split.** Run `circuitoon layout netlist.json -o sheet.json` and read its report. If it shows the signs in "Large designs: split into sheets" below, split the netlist into sheets now, before any more work on the single sheet.
5. **Gate.** `circuitoon gate sheet.json -o out`. Fix every blocking finding in the netlist (or, for a hand edit, in the sheet), lay out again if the netlist changed, and gate again.
6. **Look at the renders** with the Read tool: `out/sheet.png`, and for repeats `out/focus-<copy>.png`. Also run `circuitoon render sheet.json -o block.png --focus <group or copy>` on each block you need to check. These extra focus renders are for your review only: they are not in `gate.json`, so they are never presented. If you see overlapping labels, wires into the wrong strip, or a crowded knot, fix it (see "Improving a layout") and gate again.
7. **Present** (only after the last `gate` exited 0):
   - the PNG (`out/sheet.png`, plus the focused PNGs for repeats);
   - the link, with its notice that anyone with the link can see the diagram and nothing is uploaded. If the link was too long, `gate` wrote the sheet file instead: give that file and say to open it with Import JSON;
   - the bill of quantities and, for repeats, the channel table (both are in `gate.json`). The bill counts what is on the sheet: rows with `added` above 0 include rail strips or breadboards the layout added to distribute nets, so say those are extra parts to buy;
   - every warning, explained;
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

## Improving a layout

The `layout` report prints: body overlaps and caption overlaps (both must be 0), wire crossings, total wire length, sheet size, and blocked nets (must be none). Use crossings and wire length to compare attempts. Always look at the picture as well.

**To move parts, use `layout --keep`.** Write a `circuitoon-partial/1` file that holds the netlist as `intent`, plus `x`, `y` and optional `rotation` for the parts you want to pin. Every other part is placed around them. Each spirit-typewriter sheet ships this way. Placing the breadboard in the middle and the boards around it took the main sheet from 818 crossings to about 300.

**`--keep` gotcha:** a repeat block gets its own local rail strips (`DP1`, `DP2`, ...), so each copy's shared ground or power is a short drop. Those strips exist only when **no member of the block is kept**.

- If you copy a laid-out sheet into a partial with every part kept, the copies are kept. Their blocks then lose the local strips, and shared ports fall back to star wiring: one long wire from every switch to a distant rail.
- The `DP` parts themselves are not in the intent, so their positions are ignored, with a warning.
- To keep local distribution, pin only parts that are not in a repeat (boards, breadboards, connectors), and let the copies be placed again.

## Reading the gate

- `GATE PASSED` (exit 0): present, following step 7.
- `GATE BLOCKED` (exit 1): each blocking line names its rule: `missing-connection`, `merge`, `extra-connection`, `nc`, `capacity`, `value-drift`, `mount`, `extra-part`, `module-mismatch`, `module-drift` (a built-in part's stored copy was changed: lay out again, or embed a custom part under its own id), `intent`, `load`, `blocked-route`, or a wiring checker rule (`short`, `reversed`, `supply-too-high`, ...). Fix the problem and gate again. Never present a blocked sheet.
- **Warning `wire-over-holes`** names a wire drawn across breadboard holes it is not plugged into: the router found no way around them, or a hand-drawn `route` crosses them. The circuit is still correct, but in the picture the wire looks plugged in there. Look at that wire in the render. Fix it before presenting when you can: give the parts more room (`layout --keep` with the breadboard pinned and the others placed again), move the part the wire comes from off the far side of the board, or remove a hand-drawn `route`. If it stays, tell the user which wire crosses the holes and that it is not plugged in there.
- `GATE INCOMPLETE` (exit 3): no Chrome or Edge was found for the PNGs. Tell the user. Present `out/sheet.svg` (already written by `gate`, and listed in `gate.json`) and the link, labelled as not fully gated, and say the PNG step did not run. Do not run `render` for a PNG: it needs the same browser and exits 3 too.

**SPI MISO.** `outputs-fight` on a shared SPI MISO net means several devices can drive it. A well-behaved SPI device releases MISO while its CS is high, which the checker cannot see, but many cheap TFT display modules do not release their SDO, so they corrupt reads from anything else on the bus, such as an SD card. When the design never reads a display, leave its SDO (MISO) unconnected and list it in `nc`: the warning then goes away and the bus is safe. Only when a display must be read does it share MISO; then tell the user: "The checker flags MISO because several devices drive it. That works only if each one releases MISO when its CS is high. If reads fail, the display is the usual culprit: give it its own MISO pin or a buffer." Any other `outputs-fight` is a real conflict: fix it.

## References

- `references/netlist-format.md`: every netlist field and rule, repeats, and the partial format for `--keep`.
- `references/cli.md`: commands, flags, exit codes and JSON outputs. The schemas are in `references/schemas/`.
- `references/module-schema.md`: how to write an embedded part.
- `references/examples.md` and `references/examples/`: an LED on a breadboard, an ESP32 with an I2C sensor, a battery board with a switch, eight repeated tilt sensors, and the Spirit Typewriter split into four sheets. Each one passes `gate`.
