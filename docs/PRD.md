# Circuitoon - Product Requirements

Sep 24, 2026 · @Michael

> Living copy: https://claude.ai/code/artifact/5333f69b-af12-49ba-975f-2721100a5d97 (this file is a snapshot for review).

## Overview

Circuitoon is Lucidchart specialized for electronics wiring diagrams: drag cartoon pictures of real modules onto a canvas, wire pin to pin, and move anything while the wires follow.

**Problem.** Hobbyist wiring diagrams today are either hand-built static drawings or tools that assume you can find a good photo or footprint for every module. The Spirit Typewriter wiring page is the reference: it reads clearly (part pictures, pins in real order, colored nets, wire hops, breadboard rails) but every coordinate was placed by hand. Moving one part means redrawing every wire.

**What Circuitoon adds.**

- A live, editable canvas with Lucid-style interaction for both parts and wires.
- Modules defined by a small JSON file: a name and pins, each pinned to the top, bottom, left or right edge in order.
- An art studio to draw your own cartoon module out of colored rectangles, because good pictures of most modules do not exist.
- A diagram file (JSON) that is the source of truth: parts plus connections. Export to JSON or PDF.

**Pitch:** "Lucidchart for wiring diagrams." Pictorial, not symbolic: parts look like the physical thing (Fritzing breadboard view, Wokwi), not IEEE schematic symbols (KiCad).

## Goals and non-goals

The target user is a maker wiring an ESP32, Arduino or Pi project from breakout modules on a breadboard, who wants a diagram they can build from and share.

**Goals**

- Recreate the Spirit Typewriter diagram in Circuitoon in under an hour, with every wire correct.
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
- Snap to a grid (default 10 px, toggleable) and alignment guides while dragging.
- Undo and redo for every edit, including wire reshapes (Ctrl+Z, Ctrl+Shift+Z).
- Box select, shift-click select, select all; copy, paste, duplicate, delete.
- Free text labels and grouping frames (for example a dashed "main breadboard" outline).

**Parts (module instances)**

- Drag from the parts library onto the canvas; each instance gets a unique id (U1, R1, X2) editable in a side panel.
- Drag to move; rotate in 90 degree steps. Pins keep their order and rotate with the part.
- Pin labels render beside each pin, readable at 100% zoom.
- Duplicating a part assigns the next free id automatically.

**Wires**

- Draw: drag from a pin to another pin. Pins highlight when a dragged wire end is within snapping range.
- Auto-routing: orthogonal (right-angle) paths that avoid passing through parts; hop arcs where wires cross, as in the reference diagram.
- Drag a segment sideways to shift it; neighboring segments stretch to follow.
- Drag the middle of a segment to add a bend; double-click a bend to remove it.
- Drag a wire end off a pin and drop it on another pin to reconnect.
- Select a wire to recolor it, label it, or delete it.
- A hand-routed wire keeps its shape: when an attached part moves, only the segments next to that part adjust.
- A wire end cannot be left dangling; dropping it on empty canvas cancels the drag.

**Electrical helpers**

- Hovering a pin highlights every pin on the same net, including through breadboard rails and other internally joined pins.
- Warning badge when two different power nets are shorted (for example 5V wired to 3V3 or GND).
- Net colors: wires can take a named color class (power, ground, I2C, SPI, signal) or a custom color.

## Module definition format

A module is one self-contained JSON file: name, pins by side and order, optional art, and optional electrical data reserved for V2. Only `name` and `pins` are required; everything else has a default.

```json
{
  "format": "circuitoon-module/1",
  "id": "mcp23017-breakout",
  "name": "MCP23017 I/O Expander",
  "category": "IO expander",
  "pins": [
    { "name": "VCC", "side": "bottom", "type": "power_in" },
    { "name": "GND", "side": "bottom", "type": "ground" },
    { "name": "SCL", "side": "bottom" },
    { "name": "SDA", "side": "bottom" },
    { "spacer": true, "side": "bottom" },
    { "name": "GPA0", "side": "top" },
    { "name": "GPA1", "side": "top" }
  ],
  "internal": [],
  "art": null,
  "electrical": null
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | no | Format version; defaults to the current one. Lets later versions migrate old files. |
| `id` | no | Stable library key; derived from `name` when absent. |
| `name` | yes | Display name. |
| `category` | no | Groups the parts library. |
| `pins[].name` | yes | Unique within the module; what connections reference. |
| `pins[].side` | yes | `top`, `bottom`, `left` or `right`. |
| `pins[].label` | no | Display text when it differs from `name`. |
| `pins[].type` | no | `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive`, `nc`. Default `io`. Drives short warnings now and simulation in V2. |
| `pins[].spacer` | no | An empty slot, so pins can line up with the physical header. |
| `pins[].bus` | no | Pin drawn as a long bar that accepts many wires anywhere along it (breadboard rails and strips). |
| `internal` | no | Groups of pins joined inside the part, for example `[["GND1", "GND2"]]`. |
| `size` | no | Body size override; by default the body grows to fit the pins. |
| `art` | no | Art studio drawing (see Art studio). Absent means a plain labeled box. |
| `electrical` | no | Reserved for V2 (values such as resistance, forward voltage, max current). |

**Order rule.** Within a side, pins appear in array order: left to right on `top` and `bottom`, top to bottom on `left` and `right`. Pins are spaced evenly on the grid.

**Validation.** Import rejects a file with a clear message on duplicate pin names, unknown sides, or `internal` naming a pin that does not exist.

## Diagram format

The diagram file is the source of truth: loading it draws the diagram, and every canvas edit updates it. It is self-contained, so a diagram opened in another browser renders even if that browser has never seen its custom modules.

```json
{
  "format": "circuitoon-diagram/1",
  "title": "Spirit Typewriter",
  "modules": {
    "esp32-devkit-38": { "name": "ESP32 DevKit (38 pin)", "pins": [] },
    "breadboard-full": { "name": "Breadboard", "pins": [] }
  },
  "parts": [
    { "id": "U1", "module": "esp32-devkit-38", "x": 700, "y": 730, "rotation": 0 },
    { "id": "BB", "module": "breadboard-full", "x": 0, "y": 430 },
    { "id": "X1", "module": "mcp23017-breakout", "x": 110, "y": 210 },
    { "id": "R1", "module": "resistor", "x": 400, "y": 600, "values": { "resistance": "220" } }
  ],
  "connections": [
    { "id": "W1", "from": ["U1", "GND"], "to": ["BB", "GND rail"], "color": "ground" },
    { "id": "W2", "from": ["X1", "SDA"], "to": ["BB", "SDA strip"], "color": "i2c",
      "route": [[240, 360], [240, 518]] }
  ],
  "annotations": [
    { "type": "frame", "x": 6, "y": 432, "w": 1540, "h": 272, "label": "Main breadboard" }
  ]
}
```

- **`parts[].id`** is separate from the module type, so three MCP23017s can each be wired individually.
- **`connections`** reference `[part id, pin name]` pairs. This is the netlist; positions and colors are presentation.
- **`route`** is stored only for hand-shaped wires. Auto-routed wires store no path and are recomputed on load, so a hand-written file stays short and diff-friendly.
- **`modules`** embeds a copy of every module the diagram uses. Built-in modules may be referenced by id without a copy.
- A connection naming a missing part or pin loads with that wire flagged red and listed in a problems panel, never silently dropped.
- The file saves as `<title>.circuitoon.json`.

## Art studio

The art studio is a small rectangle-drawing editor that outputs a complete module JSON: you draw the part, place its pins, and save it to your library.

**Drawing**

- Click and drag to draw a rectangle; drag to move, handles to resize.
- Per rectangle: fill color, border color and width, corner radius, optional text label (for chip markings like "ESP32").
- Color picker plus a preset palette tuned for parts: PCB green, PCB blue, black IC, silver metal, gold header, white connector, LED colors.
- Layer order (bring forward, send back), duplicate, delete, undo and redo, snap to grid.
- Start from a template: blank board, breakout board with header row, DIP chip, two-lead component.

**Pins**

- A pin panel lists pins per side; add, rename, reorder by drag, insert spacers, set pin type.
- Pins preview live on the drawing edges, so you can line them up with the drawn header.
- Or paste existing module JSON to start from its pins and draw only the art.

**Output**

- Art is stored in the module's `art` field as a list of shapes in module-local units, so it scales cleanly on the canvas and in PDF.
- Save to library, download the `.json`, or copy it to the clipboard.
- Editing a module updates every instance in open diagrams; a diagram keeps its embedded copy until you accept the update.

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

V1 ships a starter library drawn in the same cartoon style, all defined in the same module format as user parts.

| Group | Parts | Editable values |
| --- | --- | --- |
| Passives | Resistor, capacitor (ceramic, electrolytic), potentiometer, inductor | Resistance, capacitance, inductance |
| Indicators | LED (5 colors), RGB LED, buzzer or piezo | Color, forward voltage |
| Switches | Push button, slide switch, rocker switch, toggle switch | Default state |
| Semiconductors | Diode, NPN and PNP transistor, N-channel MOSFET | Part number |
| Power | Battery (AA, 9V, 18650 holder), USB power, DC barrel jack, 3.3V and 5V regulators | Voltage |
| Boards | ESP32 DevKit 38 pin, Arduino Uno, Arduino Nano, Raspberry Pi Pico | - |
| Prototyping | Full and half breadboard (rails and strips as bus pins), pin header | Rows |

Part values (220 ohm, 10 uF) show as a label on the part and are stored in `parts[].values` so V2 can simulate them.

## Import, export and saving

Files are the unit of sharing; the browser keeps your working copy so a refresh never loses work.

| Action | Format | Notes |
| --- | --- | --- |
| Export diagram | `.circuitoon.json` | Full diagram with embedded modules. |
| Export diagram | PDF | Vector output, sharp at any zoom. Page size (Letter, A4, A3, fit to diagram) and orientation chosen at export. Optional parts list and connection table pages. |
| Export diagram | SVG, PNG | Nice to have in V1; cheap once PDF exists. |
| Import diagram | `.circuitoon.json` | File picker or drag-and-drop onto the canvas. |
| Import module | module `.json` | Adds to the parts library; one file or many at once. |
| Export module | module `.json` | From the library or the art studio. |

**Persistence**

- Autosave the open diagram to browser storage (IndexedDB) on every change.
- A home screen lists diagrams saved in this browser, with open, rename, duplicate, delete.
- The module library lives in browser storage and can be exported whole as one file and re-imported, for backup or moving browsers.
- Clear warning that browser storage is per device: export to keep a copy.

## Hosting and technical approach

Circuitoon is a static single-page app served from GitHub Pages, with no backend: all editing, routing, export and (later) simulation run in the browser.

- **Stack:** TypeScript, React for the app chrome (panels, library, dialogs), Vite for the build.
- **Rendering:** SVG for the canvas. Parts, wires and art are vector, which gives crisp zoom, per-element hit testing, and a direct path to vector PDF. Target 200 parts and 500 wires with smooth dragging.
- **Routing:** orthogonal connector routing with obstacle avoidance. Evaluate `libavoid-js` (the WebAssembly build of the router used by Inkscape and similar editors) against a custom grid A* router; pick one in the first spike.
- **PDF:** client-side, SVG to PDF (`jsPDF` plus `svg2pdf.js` or equivalent).
- **State:** one document model in memory; the diagram JSON is a direct serialization of it. Undo and redo as a command history.
- **Deploy:** GitHub Actions builds on push to `main` and publishes to Pages.
- **Browsers:** current Chrome, Edge, Firefox, Safari on desktop. Touch and phone editing are out of scope for V1; viewing a diagram on a phone should work.

**Repo and Pages.** GitHub Pages on a private repo requires a paid GitHub plan, and the published site is public regardless. Decide before the first deploy: public repo, paid plan with a private repo, or a private repo deployed elsewhere (for example Cloudflare Pages).

## V2 simulation and V3 animation

V2 computes real voltages and currents in the browser; V3 draws that state on the parts. Both are outlined here so V1's data model does not need to change.

**V2: electrical simulation**

- DC operating point plus simple transient analysis (RC charge and discharge), solved with modified nodal analysis in the browser, in the style of the Falstad circuit simulator. An ngspice WebAssembly build is the fallback if accuracy demands it.
- Models: resistor, capacitor, inductor, diode and LED, BJT, MOSFET, switches, voltage sources, regulators.
- Microcontroller and module pins are modeled at the pin level (a GPIO is a source you set high or low, a sensor pin is a load). No firmware emulation.
- Run and stop control; hover a pin or wire to read its voltage and current.
- Warnings: overcurrent on a part, short circuit, floating input, LED without a current-limiting resistor.

**V3: animation**

- LED: glows with brightness tied to current; turns dark gray and shows smoke when over its max current, staying burnt until reset.
- Switches and buttons: click to flip or press during simulation, with the lever or cap visibly moving.
- Later candidates: buzzer vibrating, motor spinning, current flow dots along wires.
- Art studio gains states: each shape can change color, visibility or position based on a part state (lit, burnt, on, off).

## Success criteria, risks and open questions

V1 is done when the Spirit Typewriter diagram can be rebuilt in Circuitoon, dragged around freely, and exported to a PDF that is as readable as the hand-made original.

**Success criteria (V1)**

- Spirit Typewriter rebuilt in under 1 hour, every connection matching the reference.
- Dragging a part with 20 attached wires stays smooth (60 fps) on a diagram of 200 parts.
- Export then import produces an identical diagram (same parts, positions, connections, hand routes).
- A new module with 20 pins drawn in the art studio in under 10 minutes.
- PDF on A3 is legible without zooming: every pin label and part id readable.

**Decisions made**

- Pictorial wiring diagrams, not symbolic schematics.
- Wires join only at pins, bus pins (rails, strips) or internally joined pins, as in the reference. No wire-to-wire junctions in V1.
- Client-only static app; files are how diagrams and modules are shared.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Auto-routing looks messy or slow on dense diagrams | Core experience fails | Routing spike first; hand-shaped routes always win; route only affected wires during drag |
| SVG slows down with hundreds of parts and wires | Laggy dragging | Measure early with a 200-part test diagram; fall back to canvas rendering for wires if needed |
| Breadboard modeling is awkward with bus pins | Breadboard diagrams are the main use case | Prototype the breadboard module in the first milestone |
| Art studio grows into a full vector editor | V1 slips | Rectangles and text only in V1; circles and lines only if cheap |
| Browser storage is cleared | Lost work | Autosave plus prominent export; export reminder on unsaved changes |

**Open questions**

- [ ] Repo visibility and Pages hosting: public repo, paid plan, or another host?
- [ ] Name availability: `circuitoon.com` and related handles not yet checked.
- [ ] Should built-in boards (ESP32, Uno) match physical pin order exactly, or group pins by function?
- [ ] Does V1 need hole-level breadboards (wire to row 12, column C), or are bus-level rails and strips enough?
