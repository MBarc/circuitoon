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
- **On `GATE INCOMPLETE: nothing blocks, but not every render could be made`** (exit 3: no browser could draw the PNGs), only `out/sheet.svg` and the link go to the user, labelled as not fully gated because the PNG step did not run. Nothing else.
- **On `GATE INCOMPLETE (simulation did not converge; ...)` or `GATE INCOMPLETE (simulation unavailable)`** (exit 3: the wiring checks found nothing that blocks, but the DC simulation failed or could not run), the circuit's voltages and currents were not checked. Never call the sheet gated or safe to power: tell the user which case it is, and present the gate's files only labelled as not fully gated, with that reason. Nothing else.
- **Never invent a pin or a pinout.** Use the pin names that `circuitoon part <id>` prints. A part that is not built in may be embedded only from its maker's documentation, with those URLs in `source`, and it is reported as custom and unverified. If a pin cannot be sourced, say so and stop.
- **Ask about what you cannot verify.** Wiring choices the parts do not decide are the user's call: how many switches a sensor holds, whether they share one input, which channel or GPIO each one uses, an I2C address, the power source. For an ESP32, ask which module the board carries (WROOM or WROVER) before you use IO16 or IO17: a WROVER uses them for its PSRAM. Ask before you design. If you must assume to show an example, write the assumption in a netlist `note` and list it back to the user as an assumption to confirm.
- **Always report the gate's warnings, its notes and its "not checked" list** in plain words. Notes are not problems; say so.
- **Clear the readability warnings before presenting** (`wires-overlap`, `wires-crowded`, `wire-hugs-part`, `label-covered`, `crossings-high`, `wire-over-board`, `wire-over-holes`; see "Reading the gate"). While any remains, `gate` says `NOT READY: N readability warnings` on its first line and `gate.json` has `ready: false`, though it still exits 0.
- **Never present a sheet with `ready: false` without listing each readability warning to the user**, one by one, each with the reason you could not fix it. Try to fix them first (see "Improving a layout").
- **Look before you present:** read the full PNG and zoomed tiles of it (`render --tiles`) with the Read tool. A sheet that verifies but cannot be followed is not done.
- **Research never sends personal data.** No names, emails, addresses, order numbers or tokens in URLs, search queries or request bodies.

## Exit codes

Every command uses the same codes. Trust them:

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | ok | Carry on. |
| 1 | Findings that block: a verify or checker error, a netlist that cannot be laid out, a blocked gate | Fix the design and run it again. |
| 2 | Invalid input: a missing file, bad JSON, an invalid netlist or sheet, a bad option | Fix the file or the command line. |
| 3 | Environment problem, such as no Chrome or Edge, or a simulation that failed or could not run while nothing else blocks | Tell the user what is missing or what did not run. |

With `--json`, a failure prints `{ "ok": false, "exit": N, "error": { "code", "message" } }`. **`error.code: "internal"` (exit 3) is a bug in the tool, not a problem with the design.** Do not rework the circuit because of it. Report the message to the user as a Circuitoon bug, and include the command that caused it.

## Workflow

1. **Clarify the goal.** Ask for anything missing: the power source (USB, battery, adapter), the boards, the parts already on hand, and whether they want a full build or an illustrative example. Ask the questions from "Ask about what you cannot verify" above.
2. **Pick parts.** Run `circuitoon parts --search <text>`, then `circuitoon part <id>` for each part you use. Read its pin types, its pin limits in brackets and the pin notes: some pins are input-only (ESP32 GPIO34-39, Nano A6/A7), output-only (on the MCP23017, GPA7 and GPB7, so each chip takes 14 inputs, not 16), wired to the board's flash (ESP32 GPIO6-11: never use them) or strapping pins that must sit at one level at reset (ESP32 GPIO0, GPIO2, GPIO12). Give buttons, sensors and chip-select or reset lines pins with no limits. For I2C, `part` gives each device's address and whether its board has pull-ups. Use canonical pin names (`GND`, `IO21`). A silkscreen label works only when exactly one pin has it. If a part is missing, make it with the `circuitoon-custom-part` skill (`circuitoon module new`, sourced from the maker's datasheet and a second source) and embed it under `modules`; `references/module-schema.md` has the format. Never guess.
3. **Write the netlist** (`references/netlist-format.md`). One net per electrical node.
   - Put parts that plug into a breadboard `on` it.
   - A header pin or pad takes one wire. Sheets are drawn with wires (see "Wires and net labels" below), so a net of three or more header pins needs a strip to share: a breadboard or a `power-rail-strip` in the netlist (the layout claims a free strip on one), or the layout fails with "needs a distribution point". A breadboard in the netlist with nothing on it and no net of its own becomes the hub for such nets, placed beside the microcontroller. Pins a part joins inside itself (an ESP32's `GND 2` and `GND 3` beside `GND`) each take a wire too, so a part with a free one can carry a net of three; see `references/netlist-format.md`. This includes a repeat whose template net holds two pins and is bound to a third.
   - Use `repeat` for repeated sub-circuits, with one explicit binding per copy.
   - Add `groups` and `notes` where they help someone read the sheet.
   - **Wire colors follow the convention:** GND is black, positive supply rails (3V3, 5V, VIN, battery +, regulator outputs) are red, and signals use any other color. The layout colors wires this way by itself; leave `wires.color` out unless the user asks for a color, and never give a signal red or black or a rail another color. Mains wiring keeps its regional identity colors and is exempt.
4. **Lay out once, then decide whether to split.** The report ends with the readability warnings count, the label mode and any nets drawn with labels. Run `circuitoon layout netlist.json -o sheet.json` and read its report. If it shows the signs in "Large designs: split into sheets" below, split the netlist into sheets now, before any more work on the single sheet.
5. **Simulate.** Set each GPIO's state to what the firmware does (`values["gpio.<pin>"]`: `input`, `input-pullup`, `input-pulldown`, `high` or `low`), and set every power or mode switch to its operating position (`values["contact.<group>"]`, for example `"closed"` for the main power rocker), in the netlist, before running `sim` or `gate`: the simulation solves the saved state, so a switch left open reports the board behind it as not powered ("SW1 is open"). Run `circuitoon sim <netlist or sheet>` (add `--probe` for the points the user cares about). Fix every blocking finding (exit 1). Read every warning: a "Likely" warning rests on representative or estimated values; say so to the user. Then gate: `gate` runs the same simulation. See "Simulation" below for the values and probes.
6. **Gate.** `circuitoon gate sheet.json -o out`. Fix every blocking finding in the netlist (or, for a hand edit, in the sheet), lay out again if the netlist changed, and gate again.
7. **Read the design back with `explain`.** Run `circuitoon explain sheet.json` and read every line against what the user asked for: each net joins the pins it should (`SDA: ESP32 DevKit V1 (U2) D21 -> 0.96" OLED 128x64 SSD1306 (DS1) SDA`), no part sits under "Not connected" that should be wired, every pin's limits fit its job (a button on a pin with "no internal pull-up" needs a resistor, nothing drives through an "input only" pin, a strapping pin carries nothing that pulls it the wrong way at reset), and each I2C device has its own address. Fix the netlist and gate again when anything does not match. A note that the sheet's copy of a part is older than the library means: lay it out again.
8. **Look at the renders** with the Read tool: `out/sheet.png` whole, then zoomed tiles of it: `circuitoon render sheet.json -o review.png --tiles 600` writes `review-tile-<row>-<col>.png`, each about 600 sheet px square; read every tile. For repeats also read `out/focus-<copy>.png`, and run `circuitoon render sheet.json -o block.png --focus <group or copy>` (with `--tiles` for a large block) on each block you need to check. These extra focus renders are for your review only: they are not in `gate.json`, so they are never presented. If you see overlapping labels, wires into the wrong strip, or a crowded knot, fix it (see "Improving a layout") and gate again.
9. **Present** (only after the last `gate` exited 0):
   - the PNG (`out/sheet.png`, plus the focused PNGs for repeats), together with the plain-English connection list from `explain` (its "Connections, by net" lines), so the user can check each wire against the picture;
   - the link, with its notice that anyone with the link can see the diagram and nothing is uploaded. If the link was too long, `gate` wrote the sheet file instead: give that file and say to open it with Import JSON;
   - the bill of materials (`out/bom.csv`, hashed in `gate.json`; its rows are also `bom` in `gate.json`) and, for repeats, the channel table. The bill counts what is on the sheet: parts, wires by cable, gauge and color, and connectors. Rows marked `added by layout` are rail strips, breadboards or jumpers the layout added to distribute nets, so say those are extra parts to buy;
   - every warning, explained; when `gate.json` says `ready: false`, every readability warning listed one by one, each with what it is and why you could not clear it;
   - the "not checked" list;
   - every assumption the user still has to confirm.

## Simulation

`sim` and `gate` solve the sheet as a DC circuit in its saved state: every load at its typical draw, then at its peak (Wi-Fi transmit, all pixels on). Nothing about firmware, PWM or timing is simulated.

- **GPIO states**, on the board's part: `"values": { "gpio.IO5": "high" }`. A pin the board lists as GPIO takes `input` (the default), `input-pullup`, `input-pulldown`, `high` or `low`. Only the pulls the chip has are allowed: the ESP32 boards and the Pi Pico have both, the Arduino Uno and Nano and the MCP23017 have pull-ups only. An input-only pin (ESP32 GPIO34-39) cannot be `high` or `low`; an output-only pin (MCP23017 GPA7, GPB7) cannot be an input and stays open until you set it. Set chip selects, resets and other lines the firmware drives as `high` or `low`, or `sim` reports them as floating inputs.
- **Switch positions**, on the switch's part: `"values": { "contact.<group>": "closed" }`, where `<group>` is the id of one of the part's contact groups (`circuitoon part <id>` lists them; a plain switch or the KCD1 rocker has `s`). A switch group takes `"open"` (the default) or `"closed"`, a changeover group `"no"` or `"nc"` (the default). Buttons are momentary: never set them. Relays are always at rest.
- **Draw and cell overrides**, when the user knows better than the part's data: `"sim.draw.<domain>.typical"` and `"sim.draw.<domain>.peak"` (amps, on one of the part's supply domains, for example `"sim.draw.3V3.typical": { "value": 0.12, "unit": "A" }`), and on a battery or supply `"sim.rInternal"` (ohm) and `"sim.imax"` (A). Each override counts as the user's value.
- **Probes**: a netlist's `probes` list (`references/netlist-format.md`) or `sim --probe`: `REF.PIN` reads a voltage, `REF` a part's current per pin and its power, `net:NAME` a net. On a sheet, a probe is `{ "id": "P1", "at": { "part": "<uid>", "pin": "<pin>" } }`, with an optional `hole` (a whole number) on a breadboard hole group to pin it to one hole.
- **Findings** are `sim-*` codes (see "Reading the gate"). Each has a `basis`: one decided on `representative` or `estimate` values is a warning worded "Likely", never blocking, except a reading more than twice a representative absolute maximum (an LED with no resistor), which blocks.
- **`gate`** writes `gate.json` as `circuitoon-cli/gate/4`: `sim` holds the simulation's status, findings, budget and provenance counts; sim warnings go to `warnings`, and the notes `sim-incomplete` and `sim-estimate` to `notes`.

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

## Wires and net labels

**Draw wires. Use net labels only when the user asks for them.** Wires are the default (`layout` with no `--labels` is `--labels none`), and people follow a wire more easily than a pair of flags.

What the layout does for wires:

- **Signal flow:** with a microcontroller on the sheet, it sits in the middle, power parts (batteries, regulators, a breadboard that mostly carries supply nets) go on its left, and peripherals to its right and below. A lone part such as a sensor is turned a quarter so its pins face what they connect to; screens, supply modules and boards keep their way up.
- **No two wires on top of each other:** no wire runs along another wire's line (a shared run longer than about 2 px), anywhere; crossing at right angles is fine. When a wire truly cannot avoid it, it is laid along the other wire anyway and `wires-overlap` reports it (the sheet is then never ready).
- **Populated breadboards are walls:** no wire crosses a breadboard that has a part mounted on it, not even over its empty holes. A breadboard with only wire ends in it (a hub) is no wall: wires may cross its empty holes, never its used ones. A wire that ends on one enters by one straight run from the board's edge: along its own strip from the strip's outer end (from the edge on the strip's own side, never across the centre channel), or across the strip, whichever passes over the fewest holes; it never runs along a row of other strips' holes when another way exists. A strip whose way in is taken by another wire's end gets a free strip beside it, joined by a short jumper, so no wire passes over another's end. This rule never blocks a wire: when no route keeps off a board, the wire crosses it and `check` and `gate` warn `wire-over-board`.
- **Hubs:** a net of three or more header pins with nothing to share shares a spare breadboard of the netlist. It is turned so its strips are rows, in the pin order of the part most of those nets reach, with an empty row between nets. Every wire takes the outer hole of a half-row on its own side of the board (the side its far end lies on), so each wire visibly ends at its own hole and none passes over another's end; a net served from both sides, or by more wires than one half-row takes, gets more rows, joined across the centre channel and from row to row by short jumpers. A supply net's pins that sit nearer the hub than its own strips are fed there by one trunk wire from the power board. A pin far from its net's strips gets a strip of its own near it, joined by one trunk jumper.
- **Ribbons:** wires between the same two parts run as parallel lanes two grid steps apart.
- **Not yet wired:** a part with no connection at all (on no net, nothing mounted on it, not mounted itself) is parked in a grid inside a "Not yet wired" frame below the wired parts.

Net labels, when the user asks:

- A net label is a named flag at a pin: every label with the same name is one connection, exactly as if wired (names are case-sensitive).
- **`"label": true`** on a net draws that net with labels, in every mode. This is how to honour a user who asks for labels on some nets.
- **`--labels auto`** also labels ground and supply nets with three or more endpoints or far apart, and signal nets between different groups or repeat copies or spread far apart; **`--labels all`** labels every net that can be. Use them only when the user asks for labels in general.
- When wires alone stay unreadable after the steps in "Improving a layout" (hundreds of crossings), say so and offer labels on the worst nets; do not switch on your own.
- **Dense groups fan out:** a part with 4 or more labelled pins or pads on one side gets its labels as one ordered row beside it, in pin order. An endpoint with no room for a label is wired to the nearest label of its net; the report lists those nets.
- **Mains and USB are never labelled**: a net with a mains terminal or a USB port is always wired (and `"label": true` on it is an error).
- Labels are not parts: verify counts a label join as a connection, and the bill of materials leaves labels out.

## Re-laying out a user's drawn sheet

To lay out a sheet the user drew (or one they edited), **run `circuitoon netlist <their sheet.json> -o netlist.json` first, and lay out that file. Never copy the circuit into a netlist by hand.** The command reads what actually conducts on the sheet: wires, breadboard strips, mounted legs, a part's internal joins and net labels. It keeps the parts, their modules, values, settings and mounts (`on`), and the strips and rails the sheet wires each net through (so it lays out again with wires), names nets from the sheet's labels, then GND, a supply rail such as 5V or 3V3, then `<ref>_<pin>`, and turns designators into valid refs (`ESP32 Breadboard` becomes `ESP32_Breadboard`). Rename nets and add `groups` and `notes` after, if they help; then `layout` and `gate` as usual.

## Taking a design to KiCad

When the user wants a PCB, run `circuitoon kicad <sheet.json or netlist.json> -o <name>.net`. It writes a KiCad netlist: every part with a footprint from KiCad's standard libraries and its pads on the right nets (see "KiCad netlist" in `references/cli.md`). Tell the user to open KiCad's PCB Editor and use File > Import > Netlist; the schematic editor cannot import it. Relay every warning and note: a part on a generic header needs its real footprint chosen in KiCad, a placeholder footprint (a mains terminal block) is a stand-in, and a dev board arrives as one socket strip per header row, to place at the board's real row spacing. Never claim the board is ready to manufacture: the export gives footprints and connections, and the layout, the footprint checks and the design rules are done in KiCad.

## Improving a layout

The `layout` report prints: body overlaps and caption overlaps (both must be 0), wire crossings, total wire length, sheet size, blocked nets (must be none), readability warnings, and the label mode with the labelled nets. Use crossings, readability warnings and wire length to compare attempts. Look at the picture as well. To improve a wired sheet: give a crowded area more room (`layout --keep` with fewer parts pinned), move a peripheral nearer the pins it uses, or pin the parts in signal-flow order (power left, microcontroller middle, peripherals right). Labels are the user's call (see "Wires and net labels").

**To move parts, use `layout --keep`.** Write a `circuitoon-partial/1` file that holds the netlist as `intent`, plus `x`, `y` and optional `rotation` for the parts you want to pin. Every other part is placed around them. Each spirit-typewriter sheet ships this way. Placing the breadboard in the middle and the boards around it took the main sheet from 678 crossings to 297.

**`--keep` gotcha (wires, the default):** a repeat block's shared ground or power gets the block's own local rail strips (`DP1`, `DP2`, ...), so each copy's shared net is a short drop. Those strips exist only when **no member of the block is kept**.

- If you copy a laid-out sheet into a partial with every part kept, the copies are kept. Their blocks then lose the local strips, and shared ports fall back to star wiring: one long wire from every switch to a distant rail.
- The `DP` parts themselves are not in the intent, so their positions are ignored, with a warning.
- To keep local distribution, pin only parts that are not in a repeat (boards, breadboards, connectors), and let the copies be placed again.

## Reading the gate

- `NOT READY: N readability warnings` (the first line, before the verdict; `ready: false` in `gate.json`): the gate may still pass, but list each of those warnings to the user with why it stays, or fix them and gate again.
- `GATE PASSED` (exit 0): present, following step 9.
- `GATE PASSED, with warnings` (exit 0): present, and report every warning; simulation warnings worded 'Likely' rest on representative or estimated values.
- `GATE FAILED (simulation)` (exit 1): a blocking simulation finding: read its message and its `inputs`; fix the circuit, or set the GPIO states and switch positions to what the firmware and the user will do, and gate again.
- `GATE FAILED` (exit 1): each blocking line names its rule: `missing-connection`, `merge`, `extra-connection`, `nc`, `capacity`, `value-drift`, `mount`, `extra-part`, `module-mismatch`, `module-drift` (the sheet's copy of a built-in part no longer matches the current library in its pin names, sides, types or order, holes, internal joins, geometry, or electrical data it states differently; the message lists what differs: lay the sheet out again with the current library; when the part's body or pins moved, as the DIP-28s did when they were redrawn to scale, the message says so: remove that part's x, y and rotation from the partial before `layout --keep`, or lay out from the netlist, since keeping the old position pins it where the old drawing sat), `intent`, `load`, `blocked-route`, or a wiring checker rule (`short`, `reversed`, `supply-too-high`, ...). Fix the problem and gate again. Never present a blocked sheet.
- **Warning `module-drift`** means the library only has newer or descriptive data for a part the sheet stores (pin caps, I2C data, settings, ratings, a footprint, art, name, source); its pins and connections match. The circuit is fine. Run `circuitoon update <sheet.json>` to take the current copies (blocking drift is left alone and listed), then check again; the pin rules only see the new data after that.
- **Warning `wire-over-holes`** names a wire drawn across breadboard holes that are in use (a wire end, a leg, or a hole under a part's body) that it is not plugged into: the router found no way around them, or a hand-drawn `route` crosses them. Crossing the empty holes of a breadboard with nothing on it is fine and never warns: a jumper lies flat over them (a board in use is kept clear altogether, see `wire-over-board`). The circuit is still correct, but in the picture the wire looks plugged in there. Look at that wire in the render. Fix it before presenting when you can: give the parts more room (`layout --keep` with the breadboard pinned and the others placed again), move the part the wire comes from off the far side of the board, or remove a hand-drawn `route`. If it stays, tell the user which wire crosses the holes and that it is not plugged in there.
- **Pin rules.** Errors `pin-flash` (something on a flash pin), `pin-input-only` (an input-only pin is the only thing driving an input or LED), `pin-output-only` (an output-only pin such as MCP23017 GPA7 reads a switch or sensor) and `i2c-address-clash` (two devices at one address on a bus) block: move the wire to the free GPIO the message suggests, or change an address. Warnings `pin-strapping` (a strapping pin pulled the wrong way at reset), `pin-no-pullup` (a switch on a pin with no internal pull-up and no resistor), `i2c-pullups` (no pull-ups on the bus) and `i2c-address-floating` (an address pin left open) are real faults to fix before presenting. The note `i2c-pullups-unknown` means no source says whether a module on the bus has pull-ups: tell the user to check the board (or add 4.7 kOhm pull-ups to SDA and SCL).
- **USB.** A USB socket or plug is one pin of type `usb` (`USB`, `USB2-1`, `PWR IN`): a net of two USB ports is a USB cable (the layout picks the cable whose plugs fit) or, when one is a plug (the RTL-SDR, a panel extension's PLUG), the plug pushed straight in. Never put a USB port on a net with GPIO, 5V or GND pins, and give each port one net. Errors `usb-to-pin` (a port on a net with pins), `usb-fit` (plugs that do not fit, two plugs, a crowded port) and `usb-role` (two hosts or two devices) block: fix the net. Warnings `usb-power` (a host port, a Pi's shared budget or a hub over its current) and `usb-hub-bus-power` (a bus-powered hub port feeding more than 100 mA) are real: move the device to a powered hub (wire the hub's DC input) or give it its own supply. Warning `usb-backfeed` (a supply on a board's VBUS or 5V pin while its USB is cabled to a host) is real: power the board from one of them. The note `usb-power-unknown` means a device's draw is not sourced: say so to the user, never guess a figure. A USB cable joins the two boards' grounds, so UART jumpers beside it need no ground wire. KiCad leaves USB links out as off-board.
- **Readability warnings** never block, but clear them before presenting, or explain each one that remains:
  - `wires-overlap`: two wires lie on top of each other along a run (no route kept them apart), so neither can be traced. Give the parts more room (`layout --keep` with fewer parts pinned) or move one of the parts so the two wires leave in different directions. A sheet with this warning must not be presented without naming the two wires.
  - `wires-crowded`: two wires of different nets run side by side within one grid step (10 px) for more than about 40 px (wires running into neighbouring pins of one header, or holes of one board, at its pitch are not counted). Give the parts more room (`layout --keep` with fewer parts pinned).
  - `wire-hugs-part`: a wire runs within 5 px of a part it does not connect to, so it reads as touching it. Move the part.
  - `label-covered`: a wire or a part covers a caption or a net label. Move the part.
  - `crossings-high`: a wire crosses more than 8 others. Place its parts nearer each other, or ask the user whether that net may be drawn with labels.
  - `wire-over-board`: no route kept the wire off a breadboard in use, so it crosses the board (where it may read as plugged in). Give the board room on that side, or move the parts the wire joins.
- **Warnings `wire-color-ground`, `wire-color-supply` and `wire-color-signal`** name the wires on one net that break the color convention (a ground wire that is not black, a supply wire that is not red, a signal wire that is red or black). They never block. Fix them by dropping or correcting the net's `wires.color` and laying out again; the default layout never raises them.
- `GATE INCOMPLETE: nothing blocks, but not every render could be made` (exit 3): no Chrome or Edge was found for the PNGs. Tell the user. Present `out/sheet.svg` (already written by `gate`, and listed in `gate.json`) and the link, labelled as not fully gated, and say the PNG step did not run. Do not run `render` for a PNG: it needs the same browser and exits 3 too.
- `GATE INCOMPLETE (simulation did not converge; this may be our model, not your circuit)` (exit 3): this may be our model, not your circuit; tell the user, present nothing as fully gated. A blocking topological finding (a real short) still says `GATE FAILED (simulation)`.
- `GATE INCOMPLETE (simulation unavailable)` (exit 3): the engine files are missing beside the CLI; reinstall the plugin.
- **Simulation codes.** Errors, which block when decided on datasheet, user or topology values at the typical corner: `sim-short` (a source or rail output joined to its own return through switches, fuses or wires), `sim-source-conflict` (two supplies of different voltage in parallel), `sim-over-abs-max` (over an absolute maximum; for an LED it names the resistor to add), `sim-brownout` (a load below its minimum voltage), `sim-dropout` (a regulator out of regulation), `sim-converter-off` (a buck or boost outside its input range while loads expect power) and `sim-no-convergence`. Warnings: `sim-over-limit` (above a rating, under its absolute maximum), `sim-brownout` worded "not powered in the current state: SW1 is open" (set the switch it names to its operating position), `sim-min-load` (a converter that shuts itself off at light load, such as the IP5306), `sim-outside-model` (a regulator past its rated current: its readings are not trusted) and `sim-floating-input` (an input with nothing driving it: set the GPIO state or add a pull resistor). Notes `sim-brownout` worded "nothing on the sheet supplies it" (no supply drawn; draw one to simulate the part running), `sim-incomplete` (powered parts with no power data, not simulated) and `sim-estimate` (how many values are estimates) are not problems; tell the user which parts they name. Any error decided on representative or estimate values arrives as a "Likely" warning instead.

**SPI MISO.** `outputs-fight` on a shared SPI MISO net means several devices can drive it. A well-behaved SPI device releases MISO while its CS is high, which the checker cannot see, but many cheap TFT display modules do not release their SDO, so they corrupt reads from anything else on the bus, such as an SD card. When the design never reads a display, leave its SDO (MISO) unconnected and list it in `nc`: the warning then goes away and the bus is safe. Only when a display must be read does it share MISO; then tell the user: "The checker flags MISO because several devices drive it. That works only if each one releases MISO when its CS is high. If reads fail, the display is the usual culprit: give it its own MISO pin or a buffer." Any other `outputs-fight` is a real conflict: fix it.

## References

- `references/netlist-format.md`: every netlist field and rule, repeats, and the partial format for `--keep`.
- `references/cli.md`: commands, flags, exit codes and JSON outputs. The schemas are in `references/schemas/`.
- `references/module-schema.md`: how to write an embedded part.
- `references/examples.md` and `references/examples/`: an LED on a breadboard, an ESP32 with an I2C sensor, a battery board with a switch, eight repeated tilt sensors, and the Spirit Typewriter split into four sheets. Each one passes `gate`.
