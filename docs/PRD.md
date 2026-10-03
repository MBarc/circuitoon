# Circuitoon - Product Requirements

Sep 24, 2026 · @Michael

> Living copy: https://claude.ai/code/artifact/5333f69b-af12-49ba-975f-2721100a5d97. This file is a snapshot of it, updated after the Astra review (2026-09-24).

## Overview

Circuitoon is Lucidchart specialized for electronics wiring diagrams: drag cartoon pictures of real modules onto a canvas, wire pin to pin, and move anything while the wires follow.

**Problem.** Hobbyist wiring diagrams today are either hand-built static drawings or tools that assume you can find a good photo or footprint for every module. The hand-built Spirit Typewriter wiring sheet shows the kind of output Circuitoon should make for any project: it reads clearly (part pictures, pins in real order, colored nets, wire hops, breadboard rails) but every coordinate was placed by hand. Moving one part means redrawing every wire.

**What Circuitoon adds.**

- A live, editable canvas with Lucid-style interaction for both parts and wires.
- Modules defined by a small JSON file: a name and pins, each pinned to the top, bottom, left or right edge in order.
- An art studio to draw your own cartoon module out of colored rectangles, because good pictures of most modules do not exist.
- A diagram file (JSON) that is the source of truth: parts plus connections. Export to JSON or PDF.

**Pitch:** "Lucidchart for wiring diagrams." Pictorial, not symbolic: parts look like the physical thing (Fritzing breadboard view, Wokwi), not IEEE schematic symbols (KiCad).

## Goals and non-goals

The target user is a maker wiring an ESP32, Arduino or Pi project from breakout modules on a breadboard, who wants a diagram they can build from and share.

**Goals**

- Produce a wiring sheet as clear as the hand-built Spirit Typewriter one, for any project, without placing a single coordinate by hand.
- Any module can be added in minutes: write JSON, or draw it in the art studio.
- Dragging a part never leaves a wire disconnected or crossing through a part.
- Diagrams round-trip: export JSON, reload, get the identical diagram.
- Runs entirely in the browser from a static host.

**Non-goals (V1)**

- Symbolic schematics, PCB layout, Gerber export.
- Real-time multi-user collaboration or accounts.
- A shared online module library (modules are files you keep and share).
- Photo import as module art.
- Electrical simulation (V2) and animation (V3).

## Roadmap

Each release is usable on its own; V2 and V3 build on data V1 already stores.

| Release | Scope | Depends on |
| --- | --- | --- |
| V1 | Canvas editor, module JSON, built-in parts, art studio, JSON and PDF export, GitHub Pages hosting | - |
| V2 | DC electrical simulation: voltages, currents, overcurrent detection | Pin types and part values captured in V1 JSON |
| V3 | Animations driven by simulation state: LED on, off, burnt out; switches flipping | V2 simulation state, art studio layers |

- **Agent toolkit (first slice).** A `circuitoon` CLI and a `circuitoon-design` skill, shipped as a Claude Code plugin from this repo (`plugin/`): a netlist (`circuitoon-netlist/1`) is laid out on the grid (parts mounted on breadboards, strips and rails distributing nets), verified for electrical equivalence against the netlist it stores as `intent`, checked, rendered to PNG and SVG, and linked (`#/editor?d=`). `gate` runs all of it and passes only when nothing blocks. Spec: `docs/superpowers/specs/2026-09-27-agent-toolkit-slice-design.md`.

## V1 canvas and interaction

Parts and wires are both first-class objects you click, drag, select and delete, exactly as shapes and connectors behave in Lucidchart.

**Canvas**

- Infinite canvas with pan (space-drag, middle-drag, trackpad) and zoom (wheel, pinch, fit-to-content).
- Snap to a 10 px grid (toggleable). Alignment guides are deferred past V1.
- Undo and redo for every completed edit, including wire reshapes (Ctrl+Z, Ctrl+Shift+Z). A drag is one undo step, not one per mouse move.
- Box select, shift-click select, select all; copy, paste, duplicate, delete.
- Free text labels and rectangular frames (for example a dashed "main breadboard" outline). Frames are drawings only; they do not group or move their contents in V1.

**Parts (module instances)**

- Drag from the parts library onto the canvas. Each instance has an immutable internal `uid` and an editable designator (U1, R1, X2) shown on the canvas.
- Renaming a designator is always allowed; connections reference `uid`, so nothing breaks.
- Drag to move; rotate 90 degrees clockwise per press (R) around the grid point at or up-left of the body center. Pins keep their order and rotate with the part; pin labels and designators stay upright for readability.
- Deleting a part deletes its attached wires, as one undo step.
- Paste and duplicate create new `uid`s and next-free designators; wires are copied only when both ends are inside the copied selection.
- Parts may overlap while dragging. A part dropped overlapping another shows an overlap warning outline.

**Breadboards**

- A board (a module with hole groups and `"obstacle": false`) accepts parts. A part is **seated** when every pin's plug point (its edge point on the body) lands exactly on a free hole of one board. Where boards overlap, the board with the most landed legs takes the part; on a tie, the board drawn on top (the later one in the file) takes it, so the holes that show the leg dots are the holes the legs join. A board never takes a part when a board drawn above it covers any of the part's plug points with its body: that leg would look as if it sat in the upper board. The part lights red and does not mount, and a file storing such a mount loads with a warning and plugs nothing. Rotating a mounted part checks only its own board, so an overlapping board never takes it over. While dragging, the holes under a seated part's legs light green; when only some legs land, or a hole is already taken, they light red. Dragging several parts at once settles them in diagram order, so two legs never land in the same hole; the drag highlight uses the same check the drop does.
- Dropping a seated part mounts it (`mount.board`); dropping it anywhere else, or dragging it off, unmounts it. A mounted part's pins join the hole groups their legs sit in, with no wires. Taken holes darken, and each leg shows as a metal dot on its hole. A wire attached to a plugged leg's pin ends in that leg's own hole (not at the stub tip, which sits over the neighbouring hole) and may leave it in any direction, so the picture shows the strip the jumper really goes into; hovering that pin lights the leg's hole with its strip. An unplugged pin keeps its stub tip. A wire may end in the exact hole a leg occupies; nothing stops it, but the wiring checker warns about it.
- Dragging or rotating a board carries its validly mounted parts in the same undo step, so their legs stay in the same holes. A hand-shaped wire between two parts a moved board carries moves with it, bends and all, only when both its ends move; any other wire keeps its stored bends and only its end segments stretch to the new pin. Rotating a board carries its parts around the board's pivot but never rotates a wire's stored bends, so a wire between two parts the rotation carries keeps its bends while its end segments stretch to the turned pins. Rotating a mounted part keeps the mount only if it still fits; rotating never mounts a part.
- Press a hole to start a wire there, even where another wire crosses it (only the selected wire's handles, and Alt+click on the selected wire, come before a hole); press a wire between holes to select it; drag a board from between its holes. Holes and pads of any module with hole groups (a board, or an interior header that is a routing obstacle) take wires the same way; only boards accept mounted parts. Picking works in the board's own coordinates, so a board placed off the 10 px world grid still has clickable holes. Wires route over boards (parts on them are still obstacles), and a wire ending in a hole may leave it in any direction. A wire ending at a hole covered by a part's body routes normally: that body is ignored for that one wire's route (a real jumper slides out from under a part the same way), though every other wire still routes around it.
- Parts with a bus pin never mount. The ESP32 DevKit modules are 120 px between header rows, wider than a full board's rows a to j (110 px), so they do not seat yet; XIAO, C3 SuperMini and ESP32-CAM seat across the channel after a 90 degree turn. The DIP-28 chips are drawn at true breadboard scale (pin rows 0.3 inch apart, notch at the left) and seat as drawn, pins in rows e and f, the body over the channel only.

**Wires**

- Draw: drag from a pin or a breadboard hole to another pin or hole, or onto a bus pin (rail or strip) at the spot where it should land. Pins and holes highlight when a dragged wire end is within snapping range.
- Auto-routing: orthogonal paths that avoid part bodies; hop arcs where wires cross, drawn on the wire that is later in the file. Overlapping collinear segments are nudged apart by 4 px.
- Editing gestures on a selected wire:
    - Segment handle (small bar at each segment's midpoint): drag perpendicular to shift the segment; neighbors stretch to stay orthogonal.
    - Alt+click on a segment: split it into two with a new bend, keeping it orthogonal.
    - Double-click a bend: remove it and re-straighten the adjacent segments.
    - End handle: drag off a pin or hole and drop on another pin or hole to reconnect; dropping on empty canvas cancels.
- Select a wire to set its color and gauge, give it a label, or delete it. Every wire has both a color and a gauge; new wires use the last color and gauge picked.
- Cable ends: a wire can be a real cable, so the builder knows which lead to reach for. The Inspector's Cable select offers presets (Wire, Dupont M-M, M-F, F-F, Solid-core jumper, Alligator leads, Alligator to Dupont M, Stripped hookup wire, Ferrules, JST-XH lead, JST-PH lead, Qwiic / STEMMA QT end (per wire), Grove end (per wire), Banana leads) that set both ends; "Ends: from / to" sets each end on its own (naming the pin or hole it is on), shows Custom when the pair matches no preset (either way round), and Swap ends turns the cable round. Each change is one undo step, and with several wires selected one Cable select sets them all. New wires get the last cable picked, remembered per browser (swapping does not change it). Each end draws its connector just before the endpoint, along the drawn end segment, in Sticker style: a black Dupont housing (with its pin, or its socket mouth), a bent bare leg, silver alligator jaws in a boot of the wire's color, a tinned tip, a ferrule with a collar of the wire's color, a white JST-XH, beige JST-PH, black JST-SH (Qwiic) or white Grove plug, a banana plug with a sleeve of the wire's color. Connectors draw in one layer above every wire. The wire stops inside its connector, and a crossing anywhere under a connector's housing (or within a hop's width of it) gets no hop arc, whichever wire is drawn first. A wire's click target, selection and problem glows still run the whole wire out to its endpoints. A wire with a connector on a pin leaves that pin straight along its axis for at least the connector's length (rounded up to the grid) before its first bend, arriving the same way, so the connector always lies on one straight run, even from a pin off the grid; a hand-shaped wire gets the same lead-out, and lane nudging never shortens one. A lead-out whose run from the pin would cross a part body is refused and dropped one end at a time, down to a plain route. Two pins facing each other on one line with nothing between them are joined by one straight run the two connectors share, split by their lengths (a bare end takes none); any other route between them keeps both lead-outs. A hole end may leave any way and gets no lead-out; there, and when a lead-out had to be dropped, a connector on a short end segment is squashed along the wire down to 60% and then overhangs the corner. Qwiic / STEMMA QT and Grove presets draw that connector on each wire's own ends: a real multi-conductor harness (several conductors in one plug, mapped to its positions) is a future entity, and each connection still joins exactly two endpoints.
- Once any gesture edits a wire, it is **manual** and stores its bends. Auto wires store nothing.

**Routing precedence**

1. Connections are never broken by moving anything.
2. When a part moves, auto wires attached to it re-route, and so do auto wires the moved part now obstructs.
3. Manual wires keep their bends; only the first and last segments stretch to reach a moved pin.
4. A manual wire that ends up crossing a part body is not re-routed; it is highlighted with a "route blocked" badge and an action to reset it to auto.
5. If no clear route exists for an auto wire (for example parts overlap), it draws as a dashed orthogonal L leaving its first pin along its stub, never a diagonal, with the same badge.
6. During a drag, only wires in (2) and (3) re-route, so dense diagrams stay fast; everything settles on drop.

**Electrical helpers**

- Hovering a pin or a breadboard hole highlights every pin and hole on the same net, through wires, mounted legs, bus pins, `internal` joins and net labels.
- Net labels: the built-in `net-label` part (module flag `netLabel: true`, one pin) is a pointed Sticker flag with a net name inside, stored in `parts[].values.net`. Every label with the same name (trimmed, case-sensitive: SDA and sda are two nets, as in KiCad and in a netlist's net names) is one electrical node in `netlist()`, so the checker, the mains analysis, verify, the bill of materials and the wire colour roles all see it as wired. The flag takes its net's low-voltage role colour (ground black with a small ground mark, a positive supply red, a signal blue); an unnamed label is white and dashed. The name is set in the Inspector (one undo step); hovering or selecting a label lights every label of its name, and the Inspector lists them. A label never plugs into a board. The checker gives an error for a label with no name (`label-unnamed`), a warning for a name used by one label only (`label-alone`, which suggests a label that differs only in case), and an error for any label on mains wiring or an energized net (`label-mains`): a label would hide a live conductor behind a flag and skip every cable check, so mains is always drawn as wires; such a label still conducts in the analysis (it never hides the hazard) and is drawn in the hazard orange with a bolt. In a netlist, `"label": true` on a net asks for labels (refused on a net with a mains terminal); verify treats labels as infrastructure, like `routing` wires.
- Wiring checker: finds mistakes a hobbyist would make on the bench from the nets and each pin's `type` and `supply` (see below).

**Wiring checker**

It never claims more than the data supports: a pin with no `type` is unknown and never triggers a rule, and no voltage is stated, nor a setting advised, when any part of its path is unknown or ambiguous; the finding says what is unknown instead. A `supply` is a "/" list of rails (`3V3` is 3.3 V, `5V`, `3.7V`); one `ADJ` rail makes the supply adjustable, and any other rail that does not parse to a finite voltage makes it unknown (negative rails such as `-5V` are unknown until differential sources exist).

The supplies are the `power_out` pins and the pins a board powers from its USB connector (`electrical.external`; the board is always assumed on USB):
- A part with a `voltage` value supplies that value, the one the Inspector shows, on the outputs `electrical.voltageOutputs` names, or on its only `power_out` (a battery's +, the LM2596's OUT+, where it replaces ADJ). Other outputs keep their rail.
- Supplies count once per electrical component of a part (the closure of its `internal` joins over pins and hole groups): joined outputs are one supply, separate outputs stay separate. A `power_out` whose component holds a `power_in` (a charger's OUT+ is its B+) passes a supply on and is not a source.
- Voltages know their reference. Each supply raises its output net above its return: the ground `electrical.returns` names for it, else the part's only ground component. With several ground components and no declared return, its return is unknown and so is every voltage through it ("depends on U2 B (its return is not known)"). Ground pins listed together in `electrical.commonReturn` are one return (a TP4056's B- and OUT- across its protection switch); nothing else joins grounds. Walking these steps from any net of a connected group gives every net a potential, so a series stack adds up (two 2 x AA holders in series give 6 V).
- A supply of unknown or adjustable voltage stays in the walk as an unknown step: any voltage that depends on it is unknown. A load whose voltage depends on unknowns gets "U1 VCC voltage depends on U2 OUT+ (adjustable) and cannot be checked", except when one adjustable supply is the only unknown: then the setting is advised, counting what the other supplies on the way add ("0.3 V on U2 OUT+, since the other supplies ... add 3 V").
- A loop of supplies that disagrees is a contradiction: a shorted stack when every supply in it points the same way (BT1 + to BT2 -, BT2 + to BT1 -), otherwise supplies fighting. A loop that agrees is supplies in parallel. A supply wired to its own return (its declared ground, or the part's only ground component) is a short; with an unknown or ambiguous return no short is claimed. A contradiction blocks only the voltages whose path runs through the loop; other loads on the same ground are still checked. Two supplies tied only at their + are left alone: no loop, no current.
- A switch (a module whose `electrical.model` is "switch": rocker, push button, tactile, tilt) is taken as closed between its switched terminals for voltages, since damage happens in the ON position. A loop through a switch is never reported as a short or a fight, because the switch may be open.
- Power pins joined inside a part (a strip's 5V and 5V 2) are checked once.
- A load sees its power input's potential over its own ground's. Below its ground the power is reversed (an error naming the two wires to swap, or the battery wired in backwards); that part is then not also called unpowered. When its ground does not reach the return of what feeds it, no voltage is stated: No ground covers an unwired ground, and otherwise "U2 VCC voltage cannot be checked: U2 GND does not connect back to the return of BT1 +".
- A USB pin wired straight to the connector (Pico VBUS, ESP32-C3 SuperMini 5V, XIAO 5V) is a rigid supply: a drawn supply at the same voltage is a warning not to power both ("U1 VBUS also gets 5 V from USB; do not power VBUS and USB at the same time"), at another voltage the two fight. A USB pin behind a diode (`diode: true`, from the board's schematic) only raises its net, resolved before any load is checked and independent of part order (each diode lifts its net to at least its real voltage over its own ground, the highest lift wins, uid order only breaks exact ties, the others are off; loops closed by conducting diodes, such as crossed power leads between two boards, are shorts or fights like any other): a supply at or above its voltage is fine up to the pin's own limit (`max`, else its accepted rails; Pico VSYS takes 5.5 V), and a lower one is an error, since USB pushes current into it through the diode.

Each finding has a severity, one plain sentence naming designators and pin labels, the parts, pins and wires involved, what Select selects, and an id made of the rule and the sorted terminals that cause it, so it stays the same whatever order wires are drawn in and whatever else joins the net.

| Rule | Severity | Fires when |
|---|---|---|
| Power reversed | error | the known voltage across a `power_in` (to its own ground) is negative: the supply is wired the wrong way round |
| Short circuit | error | a supply shares a net with its own part's ground (directly, or through another part's ground wired back to it), or supplies form a loop each + to the next - |
| Voltage too high | error | the voltage across a `power_in` (to its part's ground) exceeds its highest rail |
| Voltage too low | warning | that voltage, fully known, is below 90% of the input's lowest rail (3.0 V for a 3.3 V part, 4.5 V for a 5 V one; a stand-in until parts carry real ranges) and no supply of unknown voltage is on its net |
| Check the supply voltage | warning | the voltage across an input depends on an unknown (an adjustable or unknown supply, an undeclared return) or its ground misses the return; a lone adjustable supply gets a setting that counts the rest of the path |
| Supplies fight / tied together | error / warning | supplies in a loop disagree / agree (or one of unknown voltage is tied to another); a direct USB pin beside a drawn supply at its own voltage warns not to power both; a diode-fed USB pin above what holds its net is an error |
| Outputs fight | warning | two `output` pins share a net |
| No common ground | warning | a signal pin (typed input, output or io; the built-in boards type their GPIOs io; an untyped pin counts when the other end is typed) joins two parts that each have a ground wired, but whose grounds never meet (not one net, nor joined through supplies) |
| No power | warning | a wired or plugged part has `power_in` pins and none can be fed: fed means another part's supply (a `power_out` or a USB pin), passive pin (a switch, a fuse) or untyped pin is on the net, or the part's own `power_out` shares a net with another supply. Another part's power input feeds nothing. A board with a USB pin is its own supply; one without (the ESP32-CAM) is checked like any part. The message says when a pin is connected but nothing supplies it, and names a supply the input accepts ("a 3.3 V supply, such as a board's 3V3 pin"), or "a compatible supply" when its rails are unknown |
| No ground | warning | a wired or plugged part has `ground` pins and none shares a net with another part's pin (a bare breadboard strip does not count); not raised for a supply already reported as shorted, and it says when the ground is wired only to the part's own pins |
| Not plugged in | warning | a mount plugs nothing (see Breadboards) |
| Two in one hole | error | a wire end names the exact hole a plugged leg fills (a wire to the plugged pin itself is fine); Select selects the wire |
| Broken connection | error | a wire end names a missing part, pin, group or hole |
| Wired to a flash pin (`pin-flash`) | error | anything of another part is on a pin whose `caps.flash` is set (ESP32 GPIO6-11 on the DevKitC header) |
| Input-only pin drives (`pin-input-only`) | error | a `caps.inputOnly` pin is the only possible driver of another part's `input` pin or of an LED (directly or behind a series resistor): nothing else on the net is an output, an io pin of another part, a supply, a ground or a switch |
| Output-only pin read (`pin-output-only`) | error | a `caps.outputOnly` pin (MCP23017 GPA7/GPB7) shares a net with a switch or another part's `output` (a sensor output), so it is used as an input |
| I2C address clash (`i2c-address-clash`) | error | two devices on one I2C bus resolve to the same address |
| Strapping pin pulled (`pin-strapping`) | warning | a pin with `caps.strapping` "high" or "low" is wired straight to the wrong rail, has a resistor to it (a pull-up or pull-down), or a switch to it that pulls it there while closed at reset; the message says what the boot needs (`caps.note`). "either" pins never warn |
| Input has no pull-up (`pin-no-pullup`) | warning | a `caps.noPullup` input reads a switch to one rail with no resistor to the other, and nothing else drives the net |
| No I2C pull-ups (`i2c-pullups`) | warning | an I2C bus has no resistor from SDA (or SCL) to a supply and every device on it declares `pullups: false` |
| I2C address undefined (`i2c-address-floating`) | warning | an address pin with no board default (`floating`) is connected to nothing, so the device's address is undefined |
| Check the I2C pull-ups (`i2c-pullups-unknown`) | info | as `i2c-pullups`, but some device on the bus does not say whether it has pull-ups: "check whether a module provides pull-ups" |

**Pin capabilities.** The rules above read only what modules declare: a pin's `caps` (from the chip maker's datasheet, cross-checked) and a module's `electrical.i2c`. A pin with no caps and a module with no I2C data never trigger them. An I2C bus is the pair of nets a declared device's SDA and SCL pins sit on, once its SDA joins another part; pin names alone never make a bus (SPI displays label their lines SCL and SDA). A device's address is its `fixed` value, its `base` plus the `add` of each address pin tied high (a pin on a supply net, or a resistor to one; low on ground or a resistor to it; the board's `floating` level when the pin is connected to nothing; unknown when a signal drives it), or its part setting. A pin rule message names the pins, quotes the pin's note and says what to do, suggesting a free GPIO of the same part with no limits ("such as D32"). `circuitoon explain` lists every pin's caps in words.

Every message ends with what to do: a fight or short names the wire to remove when one joins the two pins directly, a voltage that is too high or too low ends with the fix ("Set U1 to 3.3 V or move the wire to a 3.3 V pin" when it is a setting on the part, else move the wire or use another supply), a diode back-feed says to add a diode or unplug the battery before plugging in USB, and a load whose ground misses its supply's return names the ground to connect ("U2 GND is not connected to U1 OUT-, the ground of the supply feeding U2 VIN: connect them"). Loads fed by a supply already reported as shorted get no further finding.

The side panel (with nothing selected) lists the findings, errors first, then by designator. Each row has Select, which selects what the finding is about (the parts and wires involved; just the wire for a hole or broken problem; the part, not its board, for a mount problem) and pans it into view, and, for a broken connection, Delete. Each Select is named by its pin or wire and rule and described by the row's message. Hovering or focusing a row lights its parts, pins and wires on the sheet; the light follows its finding and goes out when the finding does, and on undo, redo and load. The toolbar badge counts the problems, is red when any is an error, and its name gives the counts by severity. The check runs once per edit, never per drag frame. Not in V1 (these need simulation or pin roles the modules do not have): an LED without a resistor, floating inputs on pins with internal pulls, current limits, logic level mismatch, I2C buses that continue on another sheet; shorts through a switch or other passive part (switch state is not modeled, so a battery shorted through a button is not caught); structured voltage ranges (nominal, operating, absolute maximum) instead of rail lists; whether a board is actually on USB (every USB pin is assumed on); dismissing a finding; output drive types (push-pull, open-drain, tri-state); negative and differential rails.
- Wire color: a named color (red, black, blue, green, yellow, orange, white, purple, gray, brown, pink) or any hex value such as #2458C6. Low-voltage wires follow a convention the checker warns on (`wire-color-ground`, `wire-color-supply`, `wire-color-signal`): ground black, positive supply rails red, signals any other color; mains wiring keeps its regional identity colors. A wire's optional `colorSet: true` says its color was chosen on purpose (picked in the Inspector, or given by the netlist or the layout); only such a color is judged, so older sheets, whose editor-drawn wires all stored black, stay silent. The loader accepts `colorSet` only as `true`, and the file keeps it as written. New wires start blue; a wire drawn from a ground net starts black and one from a positive supply red, and recoloring a wire black or red never makes that the new-wire default. Wire gauge: AWG 16 to 30, default 22 (standard breadboard jumper). Drawn thickness scales with gauge, so thick power runs look thick.

## Mains wiring

A sheet with any mains part (a part whose module declares any mains data: an outlet, a plug-in device, a mains-rated relay, SSR, switch or terminal block alone included) always carries this notice, verbatim:

> Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.

- It shows in the Problems panel, under the heading, whatever the findings (a clean sheet, a list, or a checker that failed), and as a toolbar badge ("Mains: drawn connections only", the notice as its name and tooltip). Neither can be dismissed.
- It is drawn into every export: the rendered sheet reserves a footer band below the drawing (never over it, at least 320 px wide, the text wrapped to fit) for image and PDF output, and a printed page carries it at the foot. Any export added later must render it too.
- Exported JSON stores it as a sheet note (`notes`, see Diagram format); the note is added on export when the sheet has a mains part and removed when it has none.
- The checker only reports on the drawn connections, against the data the modules declare. The empty state reads "No problems found in the drawn connections." and is never shown beside a check that did not finish: a sheet with more switch and relay groups (16) or outlets (10) than the checker enumerates gets "Mains checks did not finish" instead, and missing data or unknown results are findings that say what was not checked.
- Not checked: current and wire heating, insulation and creepage, enclosures, local codes, AC waveforms and phase; an AC rail from a low-voltage (non-mains) AC source meeting a DC pin (no built-in part has one); whether a GPIO can drive an SSR's control input (no module states its I/O voltage yet).

## Module definition format

A module is one self-contained JSON file: name, pins by side and order, optional art, and optional electrical data. Module files live in the repo's `modules/` folder (built-ins) or in the user's browser library (custom).

```json
{
  "format": "circuitoon-module/1",
  "id": "mcp23017-breakout",
  "version": 1,
  "name": "MCP23017 I/O Expander",
  "category": "IO expander",
  "pins": [
    { "name": "VCC", "side": "bottom", "type": "power_in", "supply": "3V3" },
    { "name": "GND", "side": "bottom", "type": "ground" },
    { "name": "SCL", "side": "bottom" },
    { "name": "SDA", "side": "bottom" },
    { "spacer": true, "side": "bottom" },
    { "name": "GPA0", "side": "top" },
    { "name": "GPA1", "side": "top" }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Format version. A file without it is rejected with a message, never guessed. Older versions are migrated on load; a newer version than the app knows is refused with "update Circuitoon". |
| `id` | yes | Stable library key, lowercase kebab-case. Importing an `id` that already exists asks: replace, keep both (suffix `-2`), or cancel. |
| `version` | no | Integer, default 1. Bumped when pins change, so diagrams can detect an outdated embedded copy. |
| `name` | yes | Display name. |
| `category` | no | Groups the parts library. |
| `source` | no | Where the pinout came from: a URL, or several URLs joined by a space. Built-in boards cite the vendor's pinout page. |
| `pins[]` | yes | Each entry is either a **pin** or a **spacer**. May be empty when the module has hole groups (a breadboard). |
| pin `name` | yes | Unique within the module; what connections reference. Renaming a pin in the art studio rewrites references in `internal`. |
| pin `side` | yes | `top`, `bottom`, `left` or `right`. |
| pin `label` | no | Display text when it differs from `name`. |
| pin `type` | no | `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive`, `nc`. Default `io`. |
| pin `supply` | no | Named voltage for power pins, for example `5V`, `3V3`, `VBAT`. Drives the power conflict warning. A power input that accepts several rails lists them separated by '/', for example '3V3/5V'. |
| pin `bus` | no | `{ "length": 40 }`: the pin is a bar `length` grid units long along its side that accepts many wires, each at its own offset (breadboard rails and strips). |
| pin or pad `caps` | no | What the pin can and cannot do, from the chip maker's datasheet, every field optional and claiming nothing when absent: `inputOnly: true` (no output driver: ESP32 GPIO34-39, Nano A6/A7), `outputOnly: true` (must not be read: MCP23017 GPA7/GPB7), `flash: true` (wired to the board's SPI flash or PSRAM: ESP32 GPIO6-11), `noPullup: true` (no internal pull-up or pull-down), `strapping: "high"`, `"low"` or `"either"` (a strapping pin and the level its boot needs at reset; "either": both levels boot, it changes a detail) and `note` (one plain sentence on what the pin does at boot or why it is limited, quoted by the rules and by explain). Only pins the board actually breaks out are marked; cite the datasheet and the second source in the module's generator or evidence notes. Drives the pin rules (see Wiring checker). |
| `electrical.i2c` | no | An I2C device: `{ "sda", "scl", "address"?, "pullups"? }`. `sda` and `scl` name its bus pins. `address` (7-bit) is `{ "fixed": 60 }`, `{ "base": 32, "pins": [{ "pin": "A0", "add": 1, "floating"?: 0 or 1 }, ...] }` (address pins: each adds `add` when high; `floating` is the level the board pulls a pin to when nothing is connected, left out when nothing says so, and then a free pin makes the address undefined) or `{ "setting": "address" }` (set on the board by a resistor or jumper: an `electrical.settings` entry whose choices are addresses such as `"0x3C"`, first the default, so a moved resistor is recorded in the Inspector). `pullups`: `true` when the board has SDA/SCL pull-ups, `false` when it has none, left out when not known (set only when sourced). |
| pin or pad `capacity` | no | How many wire ends the pin or header pad takes, a whole number from 1 to 8, default 1 (a Dupont socket or solder joint takes one; a screw terminal may take two). Breadboard holes always take one wire end or one leg. The agent toolkit's layout and verification enforce it. |
| spacer | - | `{ "spacer": true, "side": "..." }`: an empty pin slot; takes no name. |
| `holes[]` | no | Hole groups: pins inside the body. Each is `{ "name", "label"?, "at": [[x, y], ...], "rail"?, "holeStyle"?, "type"?, "supply"?, "capacity"? }`, one electrical node whose holes sit at the listed module-local px positions, each on a 10 px grid point inside the body, never two at one point. `type` and `supply` mean what they mean on a pin (an interior header pad such as a 3V3 pin sets them); breadboard strips and rails set neither, since + and - are markings, not voltages. Names share one namespace with pin names; wires reference a group by `name` plus a `hole` index. A single-position group is an ordinary interior pin. Hole groups never grow the body. |
| hole group `rail` | no | `"+"` or `"-"`: the group is a power rail. |
| hole group `holeStyle` | no | `"pad"` draws each position as a header pad instead of a breadboard hole (a full-size header in its true position). |
| `internal` | no | Groups of pin or hole group names joined permanently inside the part, for example `[["GND1", "GND2"]]`. Never used for switchable connections. |
| `size` | no | `{ "w", "h" }` in grid units. |
| `obstacle` | no | `false` lets wires route over the part. Breadboards set it; parts mounted on them are still obstacles. A module with hole groups and `"obstacle": false` is a **board**, which parts can be mounted on. |
| `art` | no | Art studio drawing (see Art studio). Absent means a plain labeled box. |
| `footprint` | no | What a part drawn from the side covers seen from above when it stands on a breadboard: `"legs"` (nothing beyond its own leg holes: headers, a tilt switch, pots, a 5 mm LED, a breakout plugged in by one header row) or `{ "x", "y", "w", "h" }` in module px (the DHT22's case from its datasheet). Left out, the drawn art (less its leads) is what covers holes. |
| `art.pinLabels` | no | `"inside"` draws pin names inside the body next to each pin, like board silkscreen; `"tips"` draws each name past its pin stub's tip, along the pin (a DIP chip at its true 0.3 inch width has no room inside); default draws them beside the pin stub. |
| `art.shapes[].band` | no | Resistor color band slot 1 to 4; the renderer colors it from the part's resistance. |
| `electrical` | no | Extensible block for V2, for example `{ "model": "resistor", "terminals": { "a": "1", "b": "2" }, "params": { "resistance": { "unit": "ohm", "default": 1000 } } }`. V1 stores and round-trips it untouched. |
| `electrical.external` | no | Pins that carry a voltage when the part is powered through a connector the sheet does not draw: `[{ "pin": "5V", "volts": 5, "via": "USB" }]` means "while the board is on USB, its 5V pin carries 5 V". `pin` names a pin or hole group of the module, `volts` is a number above 0, `via` says what powers it, `diode: true` marks a diode between the connector and the pin (from the schematic; the pin only raises its net) and `max` the most the pin takes when something else drives it higher (Pico VSYS: 5.5). Set on dev boards with USB, from their schematic or maker docs; the wiring checker treats the pin as a supply at that voltage, returning to the board's ground. |
| `electrical.returns` | no | The ground pin each `power_out` or external pin returns to, for example `{ "OUT": "G2" }` on a module with two isolated outputs. Needed when the module has more than one ground component (commonReturn groups count as one); without it such a module's supplies have an unknown return. |
| `electrical.commonReturn` | no | Groups of ground pins the wiring checker treats as one return, for example `[["B-", "OUT-"]]` on the TP4056 (its protection switch sits between them and conducts in normal use). An approximation for checking only; the pins stay separate nets on the sheet. |
| `electrical.voltageOutputs` | no | For a module with a `voltage` param: the `power_out` pins whose voltage is the part's value, for example `["ADJ"]`. Required when the module has more than one `power_out`; a module with one (a battery, the LM2596) may leave it out and the value sets that one. |
| `electrical.acSources` | no | AC sources the part provides: `[{ "id", "live": [...], "neutral": [...], "earth"?: [...] }]`, each list naming terminals (pins or hole groups). Outlets are the only built-in sources; each placed outlet is its own source, of unknown phase to the others. Requires an `acVoltage` param and `ac`. |
| `electrical.ac` | with `acSources` | `{ "hz", "region" }`: frequency (display only) and region (`us`, `jp`, `eu`, `uk`, `au`), which sets the identity colours and which socket families the outlet may carry. |
| `electrical.conducts` | no | Two-terminal paths through the part: `[{ "pins": [a, b], "kind": "load" or "leakage", "range"?: [min, max] }]`. A load (a lamp filament) passes energization; `range` is the AC voltage it accepts. Leakage is a path that conducts a little when off (an off SSR). |
| `electrical.protective` | no | Protective devices: `[{ "from", "to", "kind": "fuse", "rating"? }]`, a fuse element between two terminals (an integral BS 1362 plug fuse carries its `rating`). Conducts when fitted, open when absent. |
| `electrical.settings` | no | Enumerated part settings: `{ "fuse": ["fitted", "absent"] }`, the first the default. A part stores its choice in `settings`; invalid choices load with a warning and are dropped. |
| `electrical.domains` | no | Isolation domains: `[{ "name", "pins", "kind": "mains", "selv" or "pelv" }]`, the mains side and each low-voltage output of a converter. |
| `electrical.isolation` | no | Isolation between the mains domain and the others, from the datasheet: `reinforced`, `double`, `basic`, `none` or `unknown`. Reinforced or double is protective separation; `basic` needs a declared `safeguard`; `none` and `unknown` make the outputs hazardous when the mains side is live. |
| `electrical.isolationProvenance` | with a stated isolation | `datasheet` (verified against the exact part's datasheet) or `unverified`. Required when `isolation` is `reinforced`, `double` or `basic`. |
| `electrical.safeguard` | no | `protective-screen`: an additional safeguard from the datasheet that, with `basic` isolation, gives protective separation. Earthing never substitutes for it. |
| `electrical.acInput` | no | A converter's mains input pair and accepted range: `{ "a", "b", "range": [min, max] }` in VAC. The converter is powered only when a and b carry the L and N of one source, through wires, contacts and fitted fuses, with the source's voltage inside the range; its outputs are supplies only then. |
| `electrical.ratings` | no | `[{ "pins", "kind": "insulation", "terminal" or "switching", "service": "ac", "dc" or "ac/dc", "volts", "amps"?, "provenance": "datasheet" or "unverified", "conditions"? }]`. A relevant AC rating below the source voltage is an error; conditions the drawing cannot confirm and unverified provenance are warnings. |
| `electrical.contacts` | no | Switchable contacts: `[{ "id", "kind": "switch", "relay" or "ssr", "poles": [{ "com", "no"?, "nc"? }] }]`. A pole joins COM to NC released and COM to NO operated, never both; poles of one group switch together. The checker tries every state of every group that can reach a source (up to 16 groups). |
| `electrical.protection` | no | `class-1` (the part's PE terminal must be earthed) or `class-2` (double insulated, no earth). |
| `electrical.polarityHazard` | no | One sentence saying what wiring the part the wrong way round does (the E26 holder: its screw shell is then live); the polarity rule adds it when N is on L. |
| `electrical.plug` | no | A plug-in device's or cord plug's mating profiles: `{ "family", "profiles": [{ "id", "contacts": [{ "pin", "at": { "x", "y" }, "mains": "L", "N", "PE" or "mechanical" }] }] }`. Only a profile's contacts are mount legs; a `mechanical` contact (the insulated earth pin of a class II UK plug) seats but carries nothing. Which plug fits which socket, and in which orientations, is a table in the code. |
| `electrical.sockets` | no | An outlet's sockets: `[{ "id", "family", "contacts": [{ "group", "role": "L", "N" or "PE" }] }]`. Every hole group belongs to one socket; a plug seats in one socket only. |
| `electrical.internalNodes` | no | Named terminals inside the part that are not drawn as pins (a plug's prongs), sharing one namespace with pins and hole groups. |
| pin `mains` | no | A terminal requirement: `L`, `N`, `PE` or `line` (either L or N). Drives the polarity and earth rules only; a pin with one is declared for mains. |
| pin `bond` | no | `"pe"`: an intentional bond to protective earth (a metal enclosure, a class 1 supply's output minus). A DC ground joined to PE without one is a warning. |
| param `acVoltage` | with `acSources` | The source voltage, unit `VAC`, nominal RMS line to neutral, 1 to 1000; defaults to the region's nominal (US 120, EU, UK and AU 230, JP 100) and is editable per outlet. Separate from the DC `voltage` param. |
| param `fuseRating` | no | A fuse holder's rating, unit `A`, above 0 up to 100; optional (missing means unknown, which is a warning). |
| `states` | no | Reserved for V3 (for example `lit`, `burnt`, `on`); art shapes may bind to them later. |

**Geometry.**

- The grid unit is 10 px at 100% zoom. Pin pitch is 1 grid unit (matching 0.1 inch headers); spacers take one pitch.
- Body size is the largest of: explicit `size`, `art.w/h`, and the size needed to fit the pins on each side plus one unit of margin at each corner. Pins are centered along their side.
- Order rule: within a side, pins appear in array order, left to right on `top` and `bottom`, top to bottom on `left` and `right`.
- A part's `x, y` is the top-left of its unrotated body; rotation is about the grid point at or up-left of the body center, so pins stay on the 10 px grid.

**Validation.** Import rejects a file, with the exact reason and path, on: missing `format`, `id` or `name`; an empty `pins` list without hole groups; duplicate pin or hole group names; unknown `side`; a spacer with a name; `internal` naming a missing pin or group; malformed `bus`, `art` or `holes`; a hole off the 10 px grid, outside the body or on top of another hole; an `obstacle` that is not true or false.

## Diagram format

The diagram file is the source of truth: loading it draws the diagram, and every canvas edit updates it. It is fully self-contained: every module it uses, built-in or custom, is embedded, so it renders the same in any browser and any later app version.

A complete, valid example (a battery lighting an LED through a resistor on a breadboard):

```json
{
  "format": "circuitoon-diagram/1",
  "title": "LED blink",
  "modules": {
    "battery-9v": { "format": "circuitoon-module/1", "id": "battery-9v", "version": 1, "name": "9V battery",
      "pins": [ { "name": "+", "side": "top", "type": "power_out", "supply": "9V" },
                { "name": "-", "side": "top", "type": "ground" } ] },
    "resistor": { "format": "circuitoon-module/1", "id": "resistor", "version": 1, "name": "Resistor",
      "pins": [ { "name": "1", "side": "left", "type": "passive" },
                { "name": "2", "side": "right", "type": "passive" } ] },
    "led": { "format": "circuitoon-module/1", "id": "led", "version": 1, "name": "LED",
      "pins": [ { "name": "A", "label": "+", "side": "left", "type": "passive" },
                { "name": "K", "label": "-", "side": "right", "type": "passive" } ] },
    "rail-pair": { "format": "circuitoon-module/1", "id": "rail-pair", "version": 1, "name": "Power rails",
      "pins": [ { "name": "+ rail", "side": "top", "bus": { "length": 40 } },
                { "name": "- rail", "side": "bottom", "bus": { "length": 40 } } ] }
  },
  "parts": [
    { "uid": "p1", "designator": "BT1", "module": "battery-9v", "x": 0,   "y": 200, "rotation": 0 },
    { "uid": "p2", "designator": "R1",  "module": "resistor",   "x": 160, "y": 60,  "rotation": 0,
      "values": { "resistance": { "value": 470, "unit": "ohm" } } },
    { "uid": "p3", "designator": "D1",  "module": "led",        "x": 300, "y": 60,  "rotation": 0,
      "values": { "color": "red" } },
    { "uid": "p4", "designator": "BB",  "module": "rail-pair",  "x": 100, "y": 140, "rotation": 0 }
  ],
  "connections": [
    { "uid": "w1", "from": { "part": "p1", "pin": "+" }, "to": { "part": "p4", "pin": "+ rail", "offset": 2 }, "color": "red", "gauge": 22 },
    { "uid": "w2", "from": { "part": "p1", "pin": "-" }, "to": { "part": "p4", "pin": "- rail", "offset": 2 }, "color": "black", "gauge": 22 },
    { "uid": "w3", "from": { "part": "p4", "pin": "+ rail", "offset": 8 }, "to": { "part": "p2", "pin": "1" }, "color": "red", "gauge": 22 },
    { "uid": "w4", "from": { "part": "p2", "pin": "2" }, "to": { "part": "p3", "pin": "A" }, "color": "#F4B400", "gauge": 24, "label": "LED+" },
    { "uid": "w5", "from": { "part": "p3", "pin": "K" }, "to": { "part": "p4", "pin": "- rail", "offset": 30 }, "color": "black", "gauge": 22,
      "route": [[340, 120], [420, 120], [420, 180]] }
  ],
  "annotations": [
    { "uid": "a1", "type": "frame", "x": 90, "y": 130, "w": 420, "h": 80, "label": "Breadboard" },
    { "uid": "a2", "type": "text", "x": 0, "y": 0, "text": "9V to red LED" }
  ]
}
```

- **Identity.** Every part, connection and annotation has an immutable `uid`, unique in the file. `designator` is the editable name shown on the canvas. Connections reference `uid`s, never designators.
- **Endpoints.** `{ part, pin }`, where `pin` names a pin or a hole group. `hole` (a whole number, default 0) picks one hole of a group: the wire ends at that hole's center and may leave it in any direction. A `hole` that is not a whole number refuses the load; one past the end of its group loads with a warning. `offset` (grid units from a bus start) is still read from older files: it must be a whole number from 0 to the bus length minus 1 on a bus pin; any other offset (past the end, fractional, or on a pin or hole group that is not a bus) loads with a warning and leaves the wire broken.
- **Mounting.** A part may carry `"mount": { "board": "<board uid>" }`. Its pins connect to whichever hole groups their plug points (pin edge points) sit on, computed from positions; its `x, y` stay absolute. The mount plus positions fully determine the plugged connections. A mount only plugs when every leg of the part lands exactly on a free hole of that board (nothing else has claimed it): a mount naming a missing part, the part itself, a part that is not a board, a part that cannot mount (a bus pin or no pins), a partial fit, or a hole conflict with an earlier valid mount keeps its data, plugs nothing, and loads with a warning.
- **`connections` and mounts are the netlist.** Wires, mounted legs (from `mount` plus positions) and `internal` groups merge into nets; labels and routes are presentation. Each connection also carries `color` (a named color or `#RRGGBB`, default black) and `gauge` (AWG integer 16 to 30, default 22); V2 can use gauge for wire current warnings.
- **`ends`** (optional) says what each end of a connection physically is: `{ "from": <kind>, "to": <kind> }`, each kind one of `bare` (the default), `dupont-male`, `dupont-female`, `solid-jumper`, `alligator`, `stripped`, `ferrule`, `jst-xh`, `jst-ph`, `jst-sh` (Qwiic / STEMMA QT), `grove`, `banana`. Bare ends are never written, and a plain wire has no `ends` key, so older files are unchanged. Presentation only: ends never change the netlist. An unknown kind, a key other than `from` or `to`, or an `ends` that is not an object loads with a warning and is dropped (that end draws as bare wire). Presets are an editor convenience and are not stored.
- **`route`** exists only on manual wires: the bend points between the two pin ends, in diagram coordinates, each segment horizontal or vertical. Auto wires omit it.
- **`routing`** (optional, `true`) marks a wire the agent toolkit's layout added to realize a connection (a wire into a strip hole, a jumper between strips, a rail wire). Verification treats such wires, like strips and rails, as infrastructure.
- **`intent`** (optional) is the `circuitoon-netlist/1` document the sheet was laid out from. It is kept through every edit and export, so `circuitoon verify` can re-check the sheet against it later.
- **Annotations.** A `frame` has `x`, `y`, `w`, `h` (w and h above 0) and an optional `label` of at most 80 characters; a `text` note has `x`, `y` and a `text` of at most 500 characters. Coordinates are finite numbers within +-100000. Anything else refuses the load with the path.
- **Modules are embedded** at export, built-ins included. If the library has a newer `version` of an embedded module, the diagram shows an "update available" badge; updating is always the user's choice, and pins that disappear flag their wires.
- **Round-trip guarantee.** Export then import yields identical document data (same uids, positions, values, routes, embedded modules). Auto wire paths are recomputed and may differ after a router upgrade; making a wire manual pins its shape.
- **Broken references.** A connection whose endpoint no longer resolves (a missing part, pin or hole group, an out-of-range hole index, or a bus offset past the end) still loads and stays in the file: it never conducts, and its one resolvable end draws a short (20 px) dashed red stub, above wire labels, that the user can select and delete like any other wire. It is never silently dropped. The toolbar shows a badge counting broken connections, and with nothing selected the side panel lists each one (its label, or its two ends, and which end is not found) with Select and Delete, so a connection with neither end on the sheet, which draws nothing, can still be found and removed. A broken wire has no reshape or reconnect handles (repair handles on the stub are a later addition).
- **`notes`** (optional) is a list of strings stored with the sheet. Export writes the mains notice (see Mains wiring) as a note on a sheet with any mains part and removes it from one without. A `notes` that is not a list, or an entry that is not a string, loads with a warning and is dropped.
- **`settings`** (optional, per part) holds enumerated choices the module declares in `electrical.settings`, such as `{ "fuse": "absent" }`; an invalid choice loads with a warning and is dropped.
- **Validation.** Duplicate `uid`s, unknown `format`, or malformed JSON refuse the load with the exact reason.
- The file saves as `<title>.circuitoon.json`.

## Art studio

The art studio is a small rectangle-drawing editor that outputs a complete module JSON: you draw the part, place its pins, and save it to your library.

**Art style: Sticker** (chosen 2026-09-24). Flat fills inside a dark ink outline, on graph-paper sheets. The renderer applies the outline, so module art only lists shapes and fills; a shape can opt out with `"outline": false` (resistor bands, fine details). Art coordinates are in pixels at 100% zoom (10 px per grid unit).

**Drawing**

- Click and drag to draw a rectangle; drag to move, handles to resize.
- Per rectangle: fill color, border color and width, corner radius, optional text label (for chip markings like "ESP32").
- Color picker plus a preset palette tuned for parts: PCB green, PCB blue, black IC, silver metal, gold header, white connector, LED colors.
- Layer order (bring forward, send back), duplicate, delete, undo and redo, snap to grid.
- Start from a blank board, or from an existing module. More templates are deferred past V1.

**Pins**

- A pin panel lists pins per side; add, rename, reorder by drag, insert spacers, set pin type.
- Pins preview live on the drawing edges, so you can line them up with the drawn header.
- Or paste existing module JSON to start from its pins and draw only the art.

**Output**

- Art is stored in the module's `art` field as a list of shapes in module-local units, so it scales cleanly on the canvas and in PDF.
- Save to library, download the `.json`, or copy it to the clipboard.
- Saving a changed module bumps its version. Diagrams that use it show an "update available" badge and keep their embedded copy until you accept.

```json
"art": {
  "w": 120, "h": 80,
  "shapes": [
    { "type": "rect", "x": 0, "y": 0, "w": 120, "h": 80, "fill": "#1E6B3A", "radius": 4 },
    { "type": "rect", "x": 40, "y": 25, "w": 40, "h": 30, "fill": "#1B1B1B", "label": "MCP23017" }
  ]
}
```

V3 extends each shape with an optional state binding (for example "fill yellow when lit"), so art made in V1 stays valid.

## Built-in parts

V1 ships a starter library drawn in the same cartoon style, all defined in the same module format as user parts, stored in `modules/`.

| Group | Parts | Editable values |
| --- | --- | --- |
| Batteries | 9V battery, AA, AAA, 18650 cell, 18650 holder (1 cell), 18650 holder (2S), 2 x AA, 3 x AAA and 4 x AA holders, CR1220, CR2016, CR2025 and CR2032 coin cells, CR2032 holder, LR44 button cell | Voltage |
| Prototyping | Full breadboard (830), half breadboard (400), mini breadboard (170), tiny breadboard (25), power rail strip | - |
| Power | AMS1117 3.3 V regulator module (3-pin), IP5306 USB-C charge/boost module, LM2596 buck converter (adjustable), TP4056 USB-C Li-ion charger with protection | Voltage (LM2596 output) |
| Microcontrollers | ESP32 DevKitC V4, ESP32 DevKit V1 (30 pin, DOIT), ESP32-S3-DevKitC-1, ESP32-C3 SuperMini, Seeed XIAO ESP32-C3, Seeed XIAO ESP32-S3, ESP32-CAM (AI Thinker), ESP32 DevKitC V4 on 38-pin screw terminal board, Raspberry Pi Pico, Pico H, Pico W, Pico 2, Pico 2 W, Arduino Nano, Wemos / LOLIN D1 mini | - |
| Sensors | BME280 module (4-pin I2C, 6-pin GY-BME280), DHT22 (3-pin module, bare 4-pin), HC-SR04 ultrasonic distance sensor, HC-SR501 PIR motion sensor, SW-520D tilt switch, SW-460D vibration switch | - |
| Communication | microSD card module (3.3 V, 5 V with level shifter), Adafruit RFM95W LoRa breakout, BSS138 4-channel logic level shifter | - |
| Displays | 0.91" and 0.96" SSD1306 OLEDs, 1.3" SH1106 OLEDs (both 4-pin orders), 1.54" ST7789, 1.8" ST7735, 2.4" and 2.8" ILI9341 and 4.0" ST7796S SPI TFTs | - |
| Motors and actuators | 1-channel 5 V relay module (Songle SRD-05VDC-SL-C contacts: NO, COM, NC switch mains with their 10 A 125 VAC, 7 A 240 VAC and 7 A 28 VDC ratings unverified for the clone board; coil-to-contact isolation unknown, so its IN, DC- and DC+ count as mains when the contacts carry it), SG90 micro servo, L298N dual H-bridge motor driver (5V jumper fitted) | - |
| Chips | MCP23017 and MCP23018 I/O expanders (DIP-28); MCP23017 CJMCU-2317 breakout (2x10 + 1x10 header as pads in their true positions) | - |
| Passives | Resistor (1/4 W, 1/2 W), capacitor (ceramic, electrolytic, film, tantalum), potentiometer, WH148 panel potentiometer 10 k | Resistance, capacitance |
| Indicators | LED, WS2812B LED strip segment, WS2812D 5 mm addressable RGB LED, 12 mm passive buzzer | Color (LED) |
| Switches | Push button, 6 mm and 12 mm 4-pin tactile switches, KCD1 rocker switch (also a mains switch: 6 A 250 V AC, 10 A 125 V AC) | - |
| Connectors | JST-XH 2/3/4-pin, Dupont housing 1x2/1x3/1x4, USB panel-mount extension (micro-USB, USB-C) | - |
| Wiring | Net label (not physical: never in the bill of materials; see Net labels) | Net name |
| Mains | Wall outlets: US NEMA 5-15R and 5-20R duplex, UK BS 1363, Schuko CEE 7/3, French CEE 7/5, AU/NZ AS/NZS 3112, Japan 1-15R duplex (unpolarized, polarized). Plug-in devices (Mean Well NGE12 with US, EU, UK and AU plugs): USB wall chargers 5 V, barrel-jack wall adapters 12 V. Cord plugs: US NEMA 5-15P and 1-15P polarized, Japan 1-15P, CEE 7/7, Europlug CEE 7/16, UK BS 1363 fused (3-lead, 2-lead), AU/NZ AS/NZS 3112 (3-lead, 2-lead). AC-DC modules: Hi-Link HLK-PM01 (5 V) and HLK-PM03 (3.3 V), isolation unknown; Mean Well IRM-03-5, IRM-03-3.3 and IRM-05-5, Class II. Lamp holders E26 (120 V lamp) and E27 (230 V lamp, earthed). In-line 5 x 20 mm fuse holder (Littelfuse 150274). Wago 221-412, 221-413 and 221-415 lever connectors. Terminal blocks: Phoenix Contact MSTB 2,5 (5.08 mm) and MC 1,5 (3.81 mm) pluggable, plug with header, 2 to 6 positions (MC 1,5 is rated 160 V under overvoltage category III, so on 230 V it is always conditional); KF2EDG 5.08 mm and KF301 5.0 mm clones, 2 and 3 positions, ratings unverified. Fotek SSR-25DA solid state relay: load 1 and 2 (24-380 VAC, 25 A on a heatsink with thermal grease; the rating's conditions), control 3 (+) and 4 (-) at 4-32 V DC (in its name; not checked yet, since no module states its GPIO voltage); off, it still leaks up to 5 mA; input-to-output isolation unknown | Mains voltage (outlets); Voltage (barrel adapters); Fuse rating (fuse holder) |

Not built yet: RGB LED (common anode/cathode), slide switch, toggle switch, diode, NPN and PNP transistor, N-channel MOSFET, USB power breakout, DC barrel jack, fixed 5V regulator, Arduino Uno, full-size Raspberry Pi boards, pin header.

Part values (220 ohm, 10 uF) show as a label on the part and are stored with their units in `parts[].values` so V2 can simulate them. The properties panel offers a resistance or capacitance value through a standard-value picker (E12 for resistors, E6 for capacitors) with free entry for anything else; a resistor's color bands update to match whatever value is chosen.

## Import, export and saving

Files are the unit of sharing; the browser keeps a working copy so a refresh does not lose work.

| Action | Format | Notes |
| --- | --- | --- |
| Export diagram | `.circuitoon.json` | Full diagram with every module embedded; a sheet with any mains part carries the mains notice in `notes`. |
| Export diagram | PDF | Vector output. Page size (Letter, A4, A3) and orientation chosen at export; 10 mm margins. The diagram scales to fit one page, and the export dialog warns when pin labels would print smaller than 6 pt, suggesting a larger page. A mains sheet prints the mains notice in its footer. |
| Import diagram | `.circuitoon.json` | File picker or drag-and-drop onto the canvas. |
| Import module | module `.json` | Adds to the parts library; one file or many at once. |
| Export module | module `.json` | From the library or the art studio. |
| Export library | `.circuitoon-library.json` | `{ "format": "circuitoon-library/1", "modules": [ ... ] }`, for backup or moving browsers. |

Deferred past V1: SVG and PNG export, multi-page tiling, parts-list and connection-table pages.

**Links.** `#/editor?d=v1.<payload>` opens a diagram carried in the URL fragment: the payload is the diagram JSON, compressed with raw deflate and written in base64url. A payload may be up to 64 KB; opening stops past 5 MB of JSON, 2,000 parts or 10,000 connections, and a damaged or oversized payload shows the usual load error. After loading, the address bar goes back to `#/editor` without reloading the editor. The fragment is never sent to a server, so nothing is uploaded, but anyone with the link can see the diagram. `circuitoon link` makes these links; it applies the same limits, and for a sheet over any of them it makes no link and writes the sheet as a `.circuitoon.json` file to import instead.

**Persistence**

- Each completed edit (a drop, a rename, a delete; not every mouse move) is written to IndexedDB as one transaction, debounced to at most once per 500 ms.
- A status indicator shows **Saved in this browser**, **Saving**, or **Not saved** (with the error). A separate dot shows when there are changes not yet exported to a file.
- Opening the same diagram in a second tab makes that tab read-only, with a "take over editing" button.
- A home screen lists diagrams saved in this browser, with open, rename, duplicate, delete.
- The app requests persistent storage (`navigator.storage.persist()`) and states plainly that browser storage is per device and can be cleared: export to keep a copy.

## Hosting and technical approach

Circuitoon is a static single-page app served from GitHub Pages, with no backend: all editing, routing, export and (later) simulation run in the browser.

- **Stack:** TypeScript, React for the app chrome (panels, library, dialogs), Vite for the build.
- **Rendering:** SVG for the canvas: crisp zoom, per-element hit testing, and a direct path to vector PDF. If wires ever move to a canvas layer for speed, hit testing and PDF export keep their own vector path.
- **Routing:** orthogonal connector routing with obstacle avoidance; `libavoid-js` (WebAssembly) versus a custom grid A* router, decided by a spike.
- **Routing spike exit criteria:** on a 200-part, 500-wire test diagram built around breadboard bus pins, the chosen router must (1) keep dragging at 60 fps on a mid-range laptop in Chrome, (2) honor manual routes and every rule in Routing precedence, (3) re-route wires the moved part obstructs, (4) place hop arcs correctly, and (5) load its WASM, if any, from the deployed Pages subpath.
- **PDF:** `jsPDF` plus `svg2pdf.js`. It supports a subset of SVG, so the canvas uses only that subset (paths, rects, text, no filters). A bundled font covers symbols such as ohm and micro. Rotated labels, hop arcs and symbols are tested in the first PDF milestone.
- **State:** one document model in memory; the diagram JSON is a direct serialization of it. Undo and redo as a command history.
- **Deploy:** `npm run deploy` validates, tests, builds and force-pushes `dist/` to the `gh-pages` branch, which Pages serves. (GitHub Actions is disabled on the account, so there is no CI workflow.) The site is served from the `/circuitoon/` subpath, so Vite's `base`, asset URLs and any WASM load paths must respect it.
- **Browsers:** current Chrome, Edge, Firefox, Safari on desktop. Touch and phone editing are out of scope for V1; viewing a diagram on a phone should work.

**Repo and Pages.** On a personal account, GitHub Pages needs a public repo or a paid plan for a private one, and a personal-account Pages site is publicly reachable either way.

## V2 simulation and V3 animation

V2 computes real voltages and currents in the browser; V3 draws that state on the parts. V1 reserves the fields they need (`electrical`, `states`, pin `supply`, valued `parts[].values`); if V2 needs more, the `format` version bumps and old files migrate automatically on load.

**V2: electrical simulation**

- DC operating point plus simple transient analysis (RC charge and discharge), solved with modified nodal analysis in the browser, in the style of the Falstad circuit simulator. An ngspice WebAssembly build is the fallback if accuracy demands it.
- Each module's `electrical.model` names a built-in model (resistor, capacitor, inductor, diode, LED, BJT, MOSFET, switch, voltage source, regulator) and maps its terminals to pins. A part with no model is treated as open at every pin and flagged "not simulated".
- Switches are models with switchable connectivity, never `internal` joins, which are permanent.
- Microcontroller and module pins are modeled at the pin level (a GPIO is a source you set high or low, a sensor pin is a load). No firmware emulation.
- Run and stop control. Hover a net to read its voltage; hover a part to read the current through each of its terminals. Current is not shown per drawn wire, because parallel ideal wires on one net have no single well-defined current.
- Warnings: overcurrent on a part, short circuit, floating input, LED without a current-limiting resistor.

**V3: animation**

- LED: glows with brightness tied to current; turns dark gray and shows smoke when over its max current.
- Switches and buttons: click to flip or press during simulation, with the lever or cap visibly moving.
- Later candidates: buzzer vibrating, motor spinning, current flow dots along wires.
- Art studio gains state bindings: each shape can change color, visibility or position based on a part state.
- A switch's starting position is saved in the diagram (`parts[].values`). Runtime states such as lit or burnt are never saved; they reset when the simulation stops.

## Success criteria, risks and open questions

V1 is done when someone can build a wiring sheet for a real breadboard project from scratch, rearrange it freely, and print a PDF as readable as the hand-made Spirit Typewriter sheet.

**Success criteria (V1)**, each a repeatable check:

- **Benchmark rebuild:** the Spirit Typewriter reference SVG and its expected connection list are committed under `test/fixtures/`. A rebuilt diagram's netlist, compared by script, matches that list exactly.
- **Round-trip:** an automated test exports then imports every fixture diagram and compares document data field by field.
- **Performance:** on the 200-part, 500-wire fixture, dragging a part with 20 wires attached holds 60 fps in Chrome on a mid-range laptop (the dev machine is the reference).
- **Module authoring:** a 20-pin module drawn in the art studio in under 10 minutes by a first-time user.
- **Print:** the benchmark exported to A3 prints every pin label and designator at 6 pt or larger.
- **Format:** every file in `modules/` passes validation in CI.

**Decisions made**

- Pictorial wiring diagrams, not symbolic schematics.
- Wires join only at pins, breadboard holes, bus pins or internally joined pins, as in the reference. No wire-to-wire junctions in V1.
- Client-only static app; files are how diagrams and modules are shared.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Auto-routing looks messy or slow on dense diagrams | Core experience fails | Routing spike with exit criteria first; manual routes always win; route only affected wires during drag |
| SVG slows down with hundreds of parts and wires | Laggy dragging | Measure early on the 200-part fixture; canvas layer for wires as fallback |
| Bus pins feel awkward for real breadboards | Breadboard sheets are the main use case | Build the breadboard module and the benchmark rebuild in the first milestone |
| Art studio grows into a full vector editor | V1 slips | Rectangles and text only in V1 |
| Browser storage is cleared | Lost work | Persistent storage request, save status, unexported-changes dot |
| PDF renders differently from the canvas | Unreadable prints | Restrict canvas to the svg2pdf subset; test symbols and rotation early |

**Open questions**

- [ ] Name availability: `circuitoon.com` and related handles not yet checked.
- [ ] T-junctions: should V1 allow a wire to end on another wire?
- [x] Built-in boards follow physical pin order, because the sheet is something you build from.
- [x] Breadboards are modeled at hole level (2026-09-25): each strip and rail is a hole group, parts plug in by mounting, and jumpers end in any hole. Bus pins with offsets stay readable for older files.
- [x] Hosting: GitHub Pages from the public repo `MBarc/circuitoon` (https://mbarc.github.io/circuitoon/).

## Changelog

### Pin rules and explain (plugin 0.6.0)

- **Pins know what they can do.** Built-in boards and chips carry `caps` from their datasheets: ESP32 input-only, flash and strapping pins (DevKit V1, DevKitC V4 and its terminal board, ESP32-CAM), ESP32-S3 and ESP32-C3 strapping pins (DevKitC-1, C3 SuperMini, both XIAOs), the Nano's analog-only A6/A7 and the MCP23017's output-only GPA7/GPB7. I2C devices carry `electrical.i2c` (bus pins, address, pull-ups where sourced); the 0.96" and 1.3" OLEDs and the 4-pin BME280 gain an `address` part setting for their address resistor or jumper.
- **New checker rules** (see Wiring checker): `pin-flash`, `pin-input-only`, `pin-output-only`, `i2c-address-clash` (errors), `pin-strapping`, `pin-no-pullup`, `i2c-pullups`, `i2c-address-floating` (warnings) and the note `i2c-pullups-unknown`. A sheet that put a ball switch on GPA7 or GPB7 now has an error to fix.
- **Existing sheets**: a sheet's stored copy of a changed built-in part now differs from the library, so `verify` and `gate` (and `check` on a sheet with an intent) report `module-drift` until the sheet is laid out again (or the part placed again); until then the old copy, without caps, is what the rules read. `explain` says so.
- **`circuitoon explain <sheet|netlist>`** reads a design back in plain English: connections by net, what each pin in use does, unconnected parts and the pin-rule findings (schema `explain.schema.json`). `part` and `parts --json` show each pin's caps.

### Net labels and readable layouts (plugin 0.4.0)

What changes for existing sheets when they are opened, checked or laid out again:

- **Captions of bottom-pin parts move above the body.** A part whose pins all leave its bottom edge (a BME280 breakout, a Dupont housing) now has its caption above the body, clear of the wires and labels leaving those pins. Sheets are not edited: the caption is drawn there on load. A `layout --keep` whose kept positions now make a caption overlap another part still lays out; the overlap is listed as a `label-covered` readability warning and in the report's caption overlaps.
- **Automatic wires re-route.** The router now charges extra for a wire running beside another one a grid step away, so parallel wires keep two grid steps apart where there is room. Every wire without a stored route is routed again when the sheet loads, so it may take a different path than before. Hand-shaped wires (those with a stored `route`) keep their bends.
- **Wires cross captions before DIP pin names.** When a wire has no route clear of all text, it may now cross a caption before it crosses the pin names printed past a DIP chip's pins: a hidden caption hides a designator, but a hidden pin name can cause a miswire.
- **Net labels** (`net-label`), the readability warnings in `check` and `gate`, `layout --labels`, `render --tiles`, and the bill's `for labelled nets (length not drawn)` wires are new; see "Net labels" above and the agent toolkit's skill.
