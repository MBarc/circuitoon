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
- Dropping a seated part mounts it (`mount.board`); dropping it anywhere else, or dragging it off, unmounts it. A mounted part's pins join the hole groups their legs sit in, with no wires. Taken holes darken, and each leg shows as a metal dot on its hole. A wire attached to a plugged leg's pin ends in that leg's own hole (not at the stub tip, which sits over the neighbouring hole) and may leave it in any direction, so the picture shows the strip the jumper really goes into; hovering that pin lights the leg's hole with its strip. An unplugged pin keeps its stub tip. A wire may end in the exact hole a leg occupies; nothing stops it in V1 (a wiring checker to warn about it is a later addition).
- Dragging or rotating a board carries its validly mounted parts in the same undo step, so their legs stay in the same holes. A hand-shaped wire between two parts a moved board carries moves with it, bends and all, only when both its ends move; any other wire keeps its stored bends and only its end segments stretch to the new pin. Rotating a board carries its parts around the board's pivot but never rotates a wire's stored bends, so a wire between two parts the rotation carries keeps its bends while its end segments stretch to the turned pins. Rotating a mounted part keeps the mount only if it still fits; rotating never mounts a part.
- Press a hole to start a wire there, even where another wire crosses it (only the selected wire's handles, and Alt+click on the selected wire, come before a hole); press a wire between holes to select it; drag a board from between its holes. Holes and pads of any module with hole groups (a board, or an interior header that is a routing obstacle) take wires the same way; only boards accept mounted parts. Picking works in the board's own coordinates, so a board placed off the 10 px world grid still has clickable holes. Wires route over boards (parts on them are still obstacles), and a wire ending in a hole may leave it in any direction. A wire ending at a hole covered by a part's body routes normally: that body is ignored for that one wire's route (a real jumper slides out from under a part the same way), though every other wire still routes around it.
- Parts with a bus pin never mount. The ESP32 DevKit modules are 120 px between header rows, wider than a full board's rows a to j (110 px), so they do not seat yet; XIAO, C3 SuperMini, ESP32-CAM and DIP-28 chips seat across the channel after a 90 degree turn.

**Wires**

- Draw: drag from a pin or a breadboard hole to another pin or hole, or onto a bus pin (rail or strip) at the spot where it should land. Pins and holes highlight when a dragged wire end is within snapping range.
- Auto-routing: orthogonal paths that avoid part bodies; hop arcs where wires cross, drawn on the wire that is later in the file. Overlapping collinear segments are nudged apart by 4 px.
- Editing gestures on a selected wire:
    - Segment handle (small bar at each segment's midpoint): drag perpendicular to shift the segment; neighbors stretch to stay orthogonal.
    - Alt+click on a segment: split it into two with a new bend, keeping it orthogonal.
    - Double-click a bend: remove it and re-straighten the adjacent segments.
    - End handle: drag off a pin or hole and drop on another pin or hole to reconnect; dropping on empty canvas cancels.
- Select a wire to set its color and gauge, give it a label, or delete it. Every wire has both a color and a gauge; new wires use the last color and gauge picked.
- Once any gesture edits a wire, it is **manual** and stores its bends. Auto wires store nothing.

**Routing precedence**

1. Connections are never broken by moving anything.
2. When a part moves, auto wires attached to it re-route, and so do auto wires the moved part now obstructs.
3. Manual wires keep their bends; only the first and last segments stretch to reach a moved pin.
4. A manual wire that ends up crossing a part body is not re-routed; it is highlighted with a "route blocked" badge and an action to reset it to auto.
5. If no clear route exists for an auto wire (for example parts overlap), it draws as a dashed orthogonal L leaving its first pin along its stub, never a diagonal, with the same badge.
6. During a drag, only wires in (2) and (3) re-route, so dense diagrams stay fast; everything settles on drop.

**Electrical helpers**

- Hovering a pin or a breadboard hole highlights every pin and hole on the same net, through wires, mounted legs, bus pins and `internal` joins.
- Power conflict warning: when one net contains pins with different declared `supply` voltages (5V and 3V3, or a supply and ground). Pins with no declared supply never trigger it.
- Wire color: a named color (red, black, blue, green, yellow, orange, white, purple, gray, brown, pink) or any hex value such as #2458C6. Wire gauge: AWG 16 to 30, default 22 (standard breadboard jumper). Drawn thickness scales with gauge, so thick power runs look thick.

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
| spacer | - | `{ "spacer": true, "side": "..." }`: an empty pin slot; takes no name. |
| `holes[]` | no | Hole groups: pins inside the body. Each is `{ "name", "label"?, "at": [[x, y], ...], "rail"?, "holeStyle"?, "type"?, "supply"? }`, one electrical node whose holes sit at the listed module-local px positions, each on a 10 px grid point inside the body, never two at one point. `type` and `supply` mean what they mean on a pin (an interior header pad such as a 3V3 pin sets them); breadboard strips and rails set neither, since + and - are markings, not voltages. Names share one namespace with pin names; wires reference a group by `name` plus a `hole` index. A single-position group is an ordinary interior pin. Hole groups never grow the body. |
| hole group `rail` | no | `"+"` or `"-"`: the group is a power rail. |
| hole group `holeStyle` | no | `"pad"` draws each position as a header pad instead of a breadboard hole (a full-size header in its true position). |
| `internal` | no | Groups of pin or hole group names joined permanently inside the part, for example `[["GND1", "GND2"]]`. Never used for switchable connections. |
| `size` | no | `{ "w", "h" }` in grid units. |
| `obstacle` | no | `false` lets wires route over the part. Breadboards set it; parts mounted on them are still obstacles. A module with hole groups and `"obstacle": false` is a **board**, which parts can be mounted on. |
| `art` | no | Art studio drawing (see Art studio). Absent means a plain labeled box. |
| `art.pinLabels` | no | `"inside"` draws pin names inside the body next to each pin, like board silkscreen; default draws them beside the pin stub. |
| `art.shapes[].band` | no | Resistor color band slot 1 to 4; the renderer colors it from the part's resistance. |
| `electrical` | no | Extensible block for V2, for example `{ "model": "resistor", "terminals": { "a": "1", "b": "2" }, "params": { "resistance": { "unit": "ohm", "default": 1000 } } }`. V1 stores and round-trips it untouched. |
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
- **`route`** exists only on manual wires: the bend points between the two pin ends, in diagram coordinates, each segment horizontal or vertical. Auto wires omit it.
- **Modules are embedded** at export, built-ins included. If the library has a newer `version` of an embedded module, the diagram shows an "update available" badge; updating is always the user's choice, and pins that disappear flag their wires.
- **Round-trip guarantee.** Export then import yields identical document data (same uids, positions, values, routes, embedded modules). Auto wire paths are recomputed and may differ after a router upgrade; making a wire manual pins its shape.
- **Broken references.** A connection whose endpoint no longer resolves (a missing part, pin or hole group, an out-of-range hole index, or a bus offset past the end) still loads and stays in the file: it never conducts, and its one resolvable end draws a short (20 px) dashed red stub, above wire labels, that the user can select and delete like any other wire. It is never silently dropped. The toolbar shows a badge counting broken connections, and with nothing selected the side panel lists each one (its label, or its two ends, and which end is not found) with Select and Delete, so a connection with neither end on the sheet, which draws nothing, can still be found and removed. A broken wire has no reshape or reconnect handles (repair handles on the stub are a later addition).
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
| Microcontrollers | ESP32 DevKitC V4, ESP32 DevKit V1 (30 pin, DOIT), ESP32-S3-DevKitC-1, ESP32-C3 SuperMini, Seeed XIAO ESP32-C3, Seeed XIAO ESP32-S3, ESP32-CAM (AI Thinker), ESP32 38-pin screw terminal adapter, Raspberry Pi Pico, Pico H, Pico W, Pico 2, Pico 2 W, Arduino Nano, Wemos / LOLIN D1 mini | - |
| Sensors | BME280 module (4-pin I2C, 6-pin GY-BME280), DHT22 (3-pin module, bare 4-pin), HC-SR04 ultrasonic distance sensor, HC-SR501 PIR motion sensor, SW-520D tilt switch, SW-460D vibration switch | - |
| Communication | microSD card module (3.3 V, 5 V with level shifter), Adafruit RFM95W LoRa breakout, BSS138 4-channel logic level shifter | - |
| Displays | 0.91" and 0.96" SSD1306 OLEDs, 1.3" SH1106 OLEDs (both 4-pin orders), 1.54" ST7789, 1.8" ST7735, 2.4" and 2.8" ILI9341 and 4.0" ST7796S SPI TFTs | - |
| Motors and actuators | 1-channel 5 V relay module, SG90 micro servo, L298N dual H-bridge motor driver (5V jumper fitted) | - |
| Chips | MCP23017 and MCP23018 I/O expanders (DIP-28) | - |
| Passives | Resistor (1/4 W, 1/2 W), capacitor (ceramic, electrolytic, film, tantalum), potentiometer, WH148 panel potentiometer 10 k | Resistance, capacitance |
| Indicators | LED, WS2812B LED strip segment, WS2812D 5 mm addressable RGB LED, 12 mm passive buzzer | Color (LED) |
| Switches | Push button, 6 mm and 12 mm 4-pin tactile switches, KCD1 rocker switch | - |
| Connectors | JST-XH 2/3/4-pin, Dupont housing 1x2/1x3/1x4, USB panel-mount extension (micro-USB, USB-C) | - |

Not built yet: RGB LED (common anode/cathode), slide switch, toggle switch, diode, NPN and PNP transistor, N-channel MOSFET, USB power breakout, DC barrel jack, fixed 5V regulator, Arduino Uno, full-size Raspberry Pi boards, pin header.

Part values (220 ohm, 10 uF) show as a label on the part and are stored with their units in `parts[].values` so V2 can simulate them. The properties panel offers a resistance or capacitance value through a standard-value picker (E12 for resistors, E6 for capacitors) with free entry for anything else; a resistor's color bands update to match whatever value is chosen.

## Import, export and saving

Files are the unit of sharing; the browser keeps a working copy so a refresh does not lose work.

| Action | Format | Notes |
| --- | --- | --- |
| Export diagram | `.circuitoon.json` | Full diagram with every module embedded. |
| Export diagram | PDF | Vector output. Page size (Letter, A4, A3) and orientation chosen at export; 10 mm margins. The diagram scales to fit one page, and the export dialog warns when pin labels would print smaller than 6 pt, suggesting a larger page. |
| Import diagram | `.circuitoon.json` | File picker or drag-and-drop onto the canvas. |
| Import module | module `.json` | Adds to the parts library; one file or many at once. |
| Export module | module `.json` | From the library or the art studio. |
| Export library | `.circuitoon-library.json` | `{ "format": "circuitoon-library/1", "modules": [ ... ] }`, for backup or moving browsers. |

Deferred past V1: SVG and PNG export, multi-page tiling, parts-list and connection-table pages.

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
