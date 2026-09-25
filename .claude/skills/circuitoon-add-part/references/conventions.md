# Circuitoon part conventions

## Sticker style
Flat fills inside a dark ink outline (#23282F), on graph paper. Rectangles only (`type: "rect"` with x, y, w, h, fill, optional radius, outline, label, labelColor, labelSize, band). The renderer outlines every shape; set `"outline": false` for fine detail (header pads, bands, highlights, text plates). Rounded corners via `radius` stand in for circles (radius = half the size makes a circle or a pill). Keep parts recognizable at 100% zoom and uncluttered: suggest the real object, do not trace it.

Art coordinates are px at 100% zoom, 10 px per grid unit, origin at the body's top left. The body grows to the larger of `size`, the art box, and the pins' needs; art is centered in the body.

## Palette in use
| Use | Color |
| --- | --- |
| Ink outline, dark text | #23282F |
| Black PCB, chip bodies | #2B2F36, #1B1F24 |
| Blue PCB (displays, OLEDs) | #1E4F8A |
| XIAO / dark blue PCB | #1E3A5F |
| Green PCB | #2F9E6E |
| Screen glass | #1B1F24 with a slightly lighter inner rect |
| Metal (pin stubs, cans, caps) | #C9CED6, #D5DAE1 |
| Lead wire | #B8BEC7 |
| Gold header pads | #E0B43C (holes #8A6A1E) |
| Resistor body | #F1D9A7 (bands colored from value) |
| Battery copper / 9V orange | #D98C2B |
| 18650 wrap | #3D6FD6 |
| Red / black leads | #E0483E / #2B2F36 |
| Yellow accents | #F4B400 |

## Geometry checklist
- Pins at whole grid units; for a side with n slots on a body L units long the first pin is at `ceil((L - (n - 1)) / 2)` units.
- Two-lead parts: even-unit art height (for example 40 or 60 px) so the pin y equals the lead center.
- Lead stubs drawn from the body to the art edge on the pin row; the renderer adds an 8 px metal stub beyond the edge.
- Board width a multiple of 10 px so both header rows sit on grid points (needed for breadboard snapping).
- Leave one grid unit of margin at body corners (the layout adds it if the art does not).

## Supply names
A pin's `supply` names the voltages the pin actually sees, never a symbolic rail name ("VBAT", "VSYS", "VOUT"):
- A single Li-ion / LiPo cell is "3.7V" (battery-18650-*, and the battery-side pins of chargers: TP4056 and IP5306 `B+`, TP4056 `OUT+`). Two cells in series are "7.4V".
- A power input lists every rail its datasheet range covers, joined with "/": Arduino Nano VIN (7-12 V) "7V/7.4V/9V/12V", LM2596 IN+ (4.5-40 V) "5V/7.4V/9V/12V/24V", Pico VSYS (1.8-5.5 V) "5V/3.7V/3V3".
- "ADJ" means user-set: an adjustable output (LM2596 OUT+) whose voltage is the part's editable value. A future wrong-voltage checker treats "ADJ" as compatible with any rail but notes the hookup so the user confirms the setting.
- Pass-through parts (USB panel-mount cables) neither supply nor ground anything: every conductor, VBUS and GND included, is `passive` with no supply.

## Categories (src/editor/libraryGroups.ts CATEGORY_ORDER)
Batteries, Power, Microcontrollers, Sensors, Communication, Displays, Motors and actuators, Chips, Semiconductors, Passives, Indicators, Switches, Connectors, then others alphabetically. Planned: "Prototyping" (breadboards) after Batteries; "Microcontrollers" becomes "Boards" once full-size Raspberry Pis land. Empty groups are hidden.

## Sources that have worked
- Espressif esp-dev-kits user guides (DevKitC, S3-DevKitC-1) with J1/J2/J3 tables and pin-layout images.
- Seeed wiki front pinout images (XIAO).
- lcdwiki.com module pages (MSP/Hosyond TFTs, MC0xx OLEDs) with tables, schematics and top/back photos.
- Microchip datasheets (MCP23017 DS20001952, MCP23018 DS20002103).
- Raspberry Pi datasheets on datasheets.raspberrypi.com (Pico family pinout diagrams).
- For clones: randomnerdtutorials, lastminuteengineers, espboards.dev as independent cross-checks.
