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
- To seat across a breadboard's center channel after a 90 degree turn, a board's header rows must be 30 px (rows e and f) to 110 px (rows a and j) apart. The ESP32 DevKit modules (120 px) do not fit yet.
- A part drawn from the side (it stands upright on a breadboard: headers, tilt switches, pots, 5 mm LEDs, a DHT22, a breakout plugged in by one header row) declares its top view in `footprint`: `"legs"` when it covers nothing beyond its leg holes, or a rect in module px from the datasheet's dimensions (the DHT22: 15.1 mm wide centred on its pins, reaching 5 mm in front of them). Without it, the drawn face would cover the holes above its pins, the rails included. Mains plug-in devices keep their drawn body: a charger really covers the socket beside it.
- A chip that plugs into a breadboard is drawn at its real size: the body covers every hole it is drawn over (only its leads do not), so a DIP drawn wider than its package leaves no free holes in its pins' strips. DIPs are drawn lying down (pins on top and bottom, notch at the left, pin 1 bottom left), 30 px tall for a 300 mil package, so they seat in rows e and f without turning (the layout needs at least 40 px across between left and right pins, too wide for 0.3 inch).
- Leave one grid unit of margin at body corners (the layout adds it if the art does not).
- Hole group order and hole array order are persistent identities: wires store a group's `name` and a hole's index into `at`. Never reorder or rename `holes` (or the positions inside one group's `at`) on a module already in use, or existing wires silently point at a different hole or group.

## Supply names
A pin's `supply` names the voltages the pin actually sees, never a symbolic rail name ("VBAT", "VSYS", "VOUT"):
- A single Li-ion / LiPo cell is "3.7V" (battery-18650-*, and the battery-side pins of chargers: TP4056 and IP5306 `B+`, TP4056 `OUT+`). Two cells in series are "7.4V".
- A power input lists every rail its datasheet range covers, joined with "/": Arduino Nano VIN (7-12 V) "7V/7.4V/9V/12V", LM2596 IN+ (4.5-40 V) "5V/7.4V/9V/12V/24V", Pico VSYS (1.8-5.5 V) "5V/3.7V/3V3".
- "ADJ" means user-set: an adjustable output (LM2596 OUT+) whose voltage is the part's editable value. A future wrong-voltage checker treats "ADJ" as compatible with any rail but notes the hookup so the user confirms the setting.
- Pass-through parts (USB panel-mount cables) neither supply nor ground anything: every conductor, VBUS and GND included, is `passive` with no supply.
- A board with a USB (or barrel) connector declares the pin that carries the connector's voltage in `electrical.external` (add `"diode": true` only when the schematic shows a diode between the connector and the pin, and `"max"` when the pin's own limit is above its rails, like Pico VSYS at 5.5 V): `[{ "pin": "5V", "volts": 5, "via": "USB" }]` (a DevKit's 5V or VIN, a Pico's VBUS, a Nano's 5V; never a VIN that only feeds a regulator). Take it from the board's schematic or maker docs and cite them in `source`; leave it out when no source says which pin it is. The wiring checker treats that pin as a supply while the board sits on USB, so a board without it (the ESP32-CAM) must be powered from the sheet.
- A part with more than one ground component (an analog ground, isolated outputs) and any supply declares `electrical.returns` (output pin to ground pin); otherwise the checker treats those supplies' returns as unknown. Grounds that are one return across a switch the checker does not model (a charger's B- and OUT-) go in `electrical.commonReturn`.
- A part whose output is its editable `voltage` value (a battery, an adjustable buck) supplies that value: the checker reads the value set on the sheet, not the pin's `supply` string. With one `power_out` the value sets it; with more, list the ones it sets in `electrical.voltageOutputs` (validation requires it).

## Categories (src/editor/libraryGroups.ts CATEGORY_ORDER)
Batteries, Prototyping, Power, Microcontrollers, Sensors, Communication, Displays, Motors and actuators, Chips, Semiconductors, Passives, Indicators, Switches, Connectors, Wiring (the net label), Mains, then others alphabetically. Planned: "Microcontrollers" becomes "Boards" once full-size Raspberry Pis land. Empty groups are hidden.

## Mains parts
Anything that touches the wall. The spec is `docs/superpowers/specs/2026-09-27-mains-outlets-design.md`; the field types and their validation are `src/format/mainsModel.ts`; the fields are documented in `docs/PRD.md`. The checker reasons only from what a part declares, so a wrong mains field is a false "safe", which is worse than a missing part.

**Evidence first.** `src/format/mainsEvidence.ts` is the source of truth for every mains value. Research the exact part (maker and part number) or the standard into it before writing a generator, as Task 0 of the mains plan did: sources (datasheet or standard first), each value with the source line it came from (`quote`, `url`), and a verdict (`VERIFIED`, or `NOT VERIFIED` with `blocking`). Have it reviewed before any part is generated. Paywalled plug and socket standards are replaced by at least two independent agreeing secondary sources (quotes start "Secondary sources:"). Generators import the values from it (`verified(id)` and `rated(id)` in `scripts/lib/mains.mjs` throw unless the part's verdict is VERIFIED, so an uncleared part is never generated; `cleared(id, ruling)` also accepts a NOT VERIFIED part whose evidence records Michael's ruling on it, as the Hi-Link modules under B2); parts tests compare the modules against it. A value the source does not give is left out, and the checker reports it as unknown; never fill it from memory, a similar part or a plausible default. Research requests (searches, URLs, forms, headers) never carry Michael's email address or any other personal data.

**Isolation is never inferred.** `electrical.isolation` is the class the source states for the barrier between mains and the output (`reinforced`, `double`, `basic`) and nothing else. A dielectric or isolation test voltage, a class II symbol alone, an SELV or ES1 label, a MOPP icon or a safety listing is not a class: record it in the evidence's `extra` and set `isolation: "unknown"`. The one exception (Michael's ruling B3): a manufacturer's explicit written "Class II" statement is recorded as `double`, because IEC 61140 defines class II equipment as protected by double or reinforced insulation; keep the quote. `isolationProvenance` is `datasheet` when the exact part's source states the class and `unverified` when a clone or generic board carries its component's stated class (the checker then adds a `rating-unverified` warning).

**Citing.** Every mains claim (pin, contact, profile, rating, isolation) cites the exact manufacturer part or standard in the module's `source` and in a comment beside the value in the generator.

**Layout and names.**
- Category `Mains`. Designators: `outlet-` XS, `plug-` XP, `charger-`/`adapter-`/`hlk-`/`irm-` PS, `lamp-holder-` E, `fuse-holder-` F, `ssr-` K, `terminal-block-`/`wago-` X.
- Outlets are boards (`obstacle: false`, passed to `moduleJson`) whose every hole group is a socket contact, built with `socket(family, id, cx, cy, suffix)` from `scripts/lib/mains.mjs` (a duplex gets `suffix` "1" and "2"). They declare `electrical.acSources` (`[{ id, live: [...], neutral: [...], earth: [...] }]`, each terminal carrying exactly one conductor), `electrical.ac` (`{ hz, region }`, region one of `us`, `jp`, `eu`, `uk`, `au`; it fixes which socket families are allowed and the identity colours), `electrical.params.acVoltage` (unit `VAC`, default the region's nominal) and `electrical.sockets` (`[{ id, family, contacts: [{ group, role }] }]`).
- Plug prongs are `electrical.internalNodes` named `"L prong"`, `"N prong"`, `"PE prong"` (no pin stub, no wire end), listed with `prongs(roles)` and placed with `plugProfiles(family, px, py, roles, mechanical)` from the family pattern in `src/format/plugging.ts`, centred on the part's pivot. A family with several profiles (CEE 7/7: earth clip and earth hole) gets all of them. Cord plug leads are ordinary pins joined to the prongs by `internal`, or for a UK plug's L by the integral fuse's protective edge.
- `electrical.plug` is `{ family, profiles: [{ id, contacts: [{ pin, at: { x, y }, mains }] }] }`; each profile has exactly one L and one N contact and at most one PE (an earth touching at two clips counts once). An unpolarized plug's blade drawn on the L side is `"L"` by convention and its leads carry `mains: "line"`.
- **Mechanical contacts** (Ruling 39): a pin that must enter a socket contact to seat but carries no conductor, such as the insulated earth pin of a class II BS 1363 plug, is a plug contact with `mains: "mechanical"` naming its own internal node: `plugProfiles(family, px, py, ['L', 'N'], { PE: 'E pin' })`, with `'E pin'` added to `internalNodes`. It is mechanical in every profile, and no join, source, conduction, domain, rating or contact may name it. A class 2 part may have a mechanical earth pin but never a conducting PE prong.

**Fields** (declare what the source gives, leave out what it does not):
- Pin (and hole group) `mains`: the terminal requirement `"L"`, `"N"`, `"PE"` or `"line"` (L or N, never PE). It drives the polarity and earth rules only. Pin `bond: "pe"`: an intentional bond to PE (a metal enclosure, a class 1 supply's secondary).
- `conducts`: `[{ pins: [a, b], kind: "load" | "leakage", range?: [min, max] }]`, how two mains terminals conduct: a load (a lamp) with its accepted volts AC from the reference product, or leakage (an SSR's off state). A load with no range is reported as not checked.
- `protective`: `[{ from, to, kind: "fuse", rating? }]`, a fuse between two terminals; `rating` (amps) wins over the `fuseRating` param (unit `A`, above 0 up to 100; its default may be left out, which is unknown). A fuse holder that may be empty declares `electrical.settings: { "fuse": ["fitted", "absent"] }` (the first choice is the default).
- `domains`: `[{ name, pins, kind: "mains" | "selv" | "pelv" }]`, the isolation domains of a converter or relay. A `selv` or `pelv` domain needs `isolation`. The label names the domain only; the effective class is computed (PELV only when a declared bond is on earth).
- `isolation`: `reinforced`, `double`, `basic`, `none` or `unknown` (see above); `isolationProvenance`: `datasheet` or `unverified`, required with a stated class; `safeguard: "protective-screen"` only when the source states one (basic plus a protective screen counts as protective separation).
- `acInput`: `{ a, b, range: [min, max] }`, a converter's AC input and its accepted volts AC.
- `ratings`: `[{ pins, kind: "insulation" | "terminal" | "switching", service: "ac" | "dc" | "ac/dc", volts, amps?, provenance, conditions? }]`, built with `rating(pins, kind, service, volts, extra)`. `provenance` is `datasheet` only for the exact part; clones and generic boards are `unverified`. `conditions` holds the datasheet's words when it ties the rating to an overvoltage category, pollution degree or mounting (the checker then warns `rating-conditional`). A source that does not say AC or DC (IEC 60664 rated voltages) is `ac/dc`.
- `contacts`: `[{ id, kind: "switch" | "relay" | "ssr", poles: [{ com, no?, nc? }] }]`, contact groups the checker enumerates; an SSR pole has `no` only (its off state is a `leakage` conduction).
- `protection`: `class-1` (needs a PE terminal or a PE plug contact) or `class-2`.
- `polarityHazard`: one sentence saying what wiring the part the wrong way round does, added to the polarity finding when N lands on its L side ("Its screw shell is then live, so touching it while changing the bulb may shock."). Declare it only when the source ties a hazard to polarity (Ruling 38: the E26 holder declares it, its shell must be on N; the E27 holder does not, ruling B7).

## KiCad mapping (`kicad`)

Every new part gets a `kicad` field, or a deliberate reason not to (PRD "KiCad mapping"; the KiCad netlist export reads it).

- **Where it lives**: a generated part's mapping goes in `scripts/lib/kicad.mjs` (the generators apply it through `moduleText`); a part left unmapped goes in its `UNMAPPED` list with the reason. A hand-written part carries `kicad` as the last key of its JSON.
- **Footprints come from KiCad's standard libraries only** (gitlab.com/kicad/libraries/kicad-footprints). Open the footprint's `.kicad_mod` file and read its pad numbers and positions; never guess them. Add the footprint and its pads to `src/format/kicadFootprints.testing.ts`; `kicadMap.test.ts` fails on a footprint or pad not listed there.
- **Pad numbers**: a chip's pad is its package pin number (KiCad's own symbol, in kicad-symbols, is a good cross-check: the Nano, the Pico and the MCP23017/18 match it). A header's pad 1 is the first pin in the module's order, numbered along the row.
- **Breakouts and dev boards**: a `Connector_PinSocket_2.54mm:PinSocket_1xNN_P2.54mm_Vertical` per header row, as `headers` (each with a `name` like `"left header, pin 1 EN"`). Even two adjacent rows get a 1xNN each, never one 2xNN: which row is pad 1 depends on which way up the board plugs in. Use a single footprint only when KiCad has the board's own (`Module:Arduino_Nano`, `Module:RaspberryPi_Pico_Common_THT`). A module with solder pads gets pin headers to wire it to, with a note.
- **Wired-on parts** (wire-lead battery holders, panel switches and pots, LED strip ends) get a JST-XH lead connector; loose cells a KiCad battery holder (pad 1 is +).
- **Mains**: a part with its own PCB footprint (Hi-Link, Mean Well, a Phoenix header) uses it. A part that is wired to the board instead (outlets, plugs, lamp and fuse holders, an SSR, relay contacts) gets a screw terminal with `"placeholder": true` and a note that starts "Placeholder:" and says what to rate it for.
- **Joined pins** (a tactile switch's leg pairs, a terminal block's wire and board sides, a duplex outlet's two L contacts) share one pad; the validator allows that only for pins `internal` joins.
- **When unsure, leave it unmapped.** A wrong pad is a wrong trace on a real board; an unmapped part still exports, on a generic header with a warning.

## Sources that have worked
- Espressif esp-dev-kits user guides (DevKitC, S3-DevKitC-1) with J1/J2/J3 tables and pin-layout images.
- Seeed wiki front pinout images (XIAO).
- lcdwiki.com module pages (MSP/Hosyond TFTs, MC0xx OLEDs) with tables, schematics and top/back photos.
- Microchip datasheets (MCP23017 DS20001952, MCP23018 DS20002103).
- Raspberry Pi datasheets on datasheets.raspberrypi.com (Pico family pinout diagrams).
- Arduino: `docs.arduino.cc/resources/{datasheets,pinouts,schematics}/<SKU>-{datasheet,full-pinout,schematics}.pdf` (the hardware page lists which exist; older boards have no datasheet). Full pinouts have a text layer but read best rendered; newer datasheets have numbered header tables, sometimes with typos (Due, Uno R3 JDIGITAL), so cross-check with the pinout and KiCad's `MCU_Module` symbols. Tutorials and cheat sheets are plain Markdown in github.com/arduino/docs-content (docs.arduino.cc pages are JS-rendered and fetch empty).
- For clones: randomnerdtutorials, lastminuteengineers, espboards.dev as independent cross-checks.
- Phoenix Contact: phoenixcontact.com answers HTTP 403 to scripted and headless requests. Digi-Key serves Phoenix's own sheets at `https://media.digikey.com/pdf/Data%20Sheets/Phoenix%20Contact%20PDFs/<item>.pdf`, but they can be older revisions (2010 or 2016) whose ratings differ from the current page: record the sheet date with every value.
