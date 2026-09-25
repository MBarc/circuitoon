---
name: circuitoon-add-part
description: Add or change a built-in part (module) in Circuitoon's library - boards, chips, displays, sensors, batteries, passives, anything in modules/*.json - with pinouts sourced and verified, Sticker-style art, correct pin geometry, and the Parts panel kept organized. Use this whenever Michael asks to add a device, component, module, board, breakout, sensor, screen, battery or "the line-up of X" to Circuitoon, or to fix a part's pins, art or category, even if he just pastes a product link.
---

# Adding parts to Circuitoon

Circuitoon sheets are used to physically wire real circuits. A part with a wrong pin order causes a miswire on a real board, which is worse than the part not existing. Everything below serves two goals: the pins are exactly right, and the part reads instantly on a sheet.

Read `docs/PRD.md` ("Module definition format", "Art studio", "Built-in parts") before your first part in a session; it is the spec. `references/conventions.md` has the look, palette, geometry and category rules this skill relies on.

## Workflow

1. **Pin down what the part is.** For a product link, fetch the page and identify the exact module (maker, model, controller chip, variant). Amazon usually works with WebFetch; AliExpress redirects to a login page, so ask for the product title or check Michael's notes (`C:/Users/micha/Desktop/Claude/Projects/`) for an order. If variants exist (for example 4-pin OLEDs sold as GND-VCC-SCL-SDA and VCC-GND-SCL-SDA), decide which to ship; widespread variants each get their own module with the order in the name.

2. **Source the pinout.** Fetch the manufacturer's documentation: datasheets (Microchip, Espressif, Raspberry Pi), maker wikis (Seeed wiki, lcdwiki.com, Adafruit, Waveshare, SparkFun). For generic clones with no maker page, use the best vendor image plus one independent source that agrees. Record every URL in the module's `source` field (space-separated). Official pinout PDFs often have no text layer: render the page to an image (Python with PyMuPDF: `pip install pymupdf`, then `fitz.open(pdf)[0].get_pixmap(dpi=200).save(png)`) and read it. Official Fritzing parts (`.fzpz`, listed on maker pages) carry a machine-readable connector list and make a good cross-check. If you cannot verify a pin, leave the part out and say so. Never fill gaps from memory.

3. **Choose id, name and category.**
   - `id`: lowercase kebab-case, descriptive and stable (`tft-ili9341-28-spi-touch`). Designator prefixes key off the id (see `src/editor/ops.ts` PREFIXES): `battery*` gives BT, `resistor*` R, `capacitor*` C, `potentiometer*` RV, `led*` D, `*button*|*switch*` S, `lcd-|oled-|tft-` DS, everything else U. Add a prefix rule (with a test) if a new family needs one.
   - `name`: what a maker would call it, with the distinguishing detail ("ESP32 DevKit V1 (30 pin, DOIT)").
   - `category`: an existing group from `CATEGORY_ORDER` in `src/editor/libraryGroups.ts`. Michael asked that the Parts panel stay organized as it grows: if a new family does not fit, add a category there deliberately (in a sensible position, with the test updated) instead of dumping it into a loosely related one. Look at how full each group is; when one gets crowded, propose a split.

4. **Encode the pins.** See "Pin rules" below. Physical order is the whole point: lay pins out as seen from the component side in the vendor's diagram orientation.

5. **Draw the art** in the Sticker style (rectangles only; the renderer adds the ink outline). See `references/conventions.md`. For families of similar parts, extend or add a generator script in `scripts/` (existing: `gen-boards.mjs` for ESP32 boards, `gen-parts.mjs` for chips and displays, `gen-picos.mjs` for the Raspberry Pi Picos) so pin lists live in one readable table; the generator must reproduce the committed JSON byte for byte. Write its files through `emit`/`log`/`finish` from `scripts/gen-output.mjs` so it supports `--check`, and add a new generator to `npm run check:gen` in package.json.

6. **Update the lists that name parts.** If the part uses `pinLabels: "inside"`, add it to the allowed list in `src/format/module.test.ts`; add it to the Built-in parts table in `docs/PRD.md` (move it out of the "Not built yet" line if it was there).

7. **Validate and test.** `npm run validate` (every module), `npm run check:gen` (for a generator family: every generator rebuilds its files in memory and fails if one differs from modules/, so a hand edit to a generated file or a generator change without re-running it is caught; the deploy runs it too), `npm test` (includes the two-lead geometry test and board/part tests; add a test pinning the pin order for multi-pin parts, like `src/format/boards.test.ts` and `parts.test.ts` do), `npm run build`.

8. **Look at it.** `npm run build`, then
   `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs <id> [more ids] --out <scratchpad dir> [--panel] [--rotate 90] [--dark] [--fill 0.8]`
   (`--fill 0.8` for tall boards so labels come out large; `--panel` filters the Parts panel to the part's group)
   and Read every image. Check: leads meet the metal pin stubs, labels readable, nothing overlaps, it looks like the real thing, the Parts panel group reads well. Redraw anything that reads poorly and shoot again. Never use the Playwright MCP browser (shared with other agents).

9. **Independent pinout check before merge.** Have a reviewer who did not write the part fetch the sources and compare every pin row, in order, against them (for subagent workflows, dispatch this as the task review with WebFetch access). Record the verdict per part: MATCHES, MISMATCH with differences, or NOT VERIFIED.

10. **Ship** with the `circuitoon-ship` skill (merge, deploy, live check, vault note).

## Pin rules

- Pins sit on the body edges at 10 px pitch (0.1 inch), placed in array order: left to right on top/bottom, top to bottom on left/right, centered on the side at whole grid units. `{ "spacer": true, "side": ... }` holds an empty slot so pins line up with a physical gap.
- `name` must be unique; use the silkscreen text. Duplicates (several GND pins) become "GND", "GND 2", "GND 3" in physical order with `label: "GND"` so the sheet shows the silkscreen.
- `type`: `power_out` for rails the part supplies (a board's 3V3 regulator output, a battery +), `power_in` for inputs (VCC, VIN, 5V), `ground`, `input` for input-only pins (for example ESP32 GPIO34-39), `output` for output-only, `io` otherwise, `passive` for two-lead parts, `nc` for no-connect.
- `supply`: the rail name ("3V3", "5V", "9V"). A power input that accepts several rails lists them with "/" ("3V3/5V"), which keeps a later wrong-voltage check from flagging valid hookups.
- `internal`: join pins that are the same net on the part (all GNDs of a board).
- Values: a part with a user-editable value declares it in `electrical.params` named exactly `resistance`, `capacitance` or `voltage` (with `unit` and `default`); only those names show in captions and the value picker.
- Polarized two-lead parts label their pins "+" and "-".
- Header pins drawn inside the body next to each pin, like silkscreen, are opt-in with `"art": { ..., "pinLabels": "inside" }`; use it for boards, chips and display modules with dense headers.
- Analog grounds (AGND, a separate analog ground plane) stay out of the GND `internal` group unless the datasheet says the pin is tied to digital ground on the board; say which in the report.
- A few pads inside the board (debug pads, test points) with no edge position: until interior pins land, bring them out as pins on the nearest edge in their physical order and draw thin traces from the true pad spot to the edge, and say so in the report. A full 2-row header is different: defer it (next rule).
- Body size for boards with pins on several sides: height from the longest side's slot count plus corner margin; width a multiple of 10 px that fits the art and the other sides' pins; check the bottom or top pins still center where the drawn pads are.
- Two-lead parts: art height must give an even number of grid units so the single left/right pin lands on the drawn lead center (the geometry test enforces this).
- Pins in the interior of a body (a 2x20 header in its true position, breadboard holes) need the interior-pin format from the breadboard work; until that lands, do not fake an interior header by spreading its rows onto opposite edges. Say so and defer the part.

## Things that went wrong before (keep them from recurring)

- Leads drawn 5 px off the pin because the art height was an odd number of grid units.
- A vendor diagram showing the back of the board: mirror it to the component side and confirm with a front photo.
- A label changed after the screenshots were taken and never re-checked: re-shoot after every art change.
- `git stash` is shared between worktrees; never use it. Never switch branches in a worktree another agent uses.
- Captions showing an irrelevant value (an LED's forward voltage): only resistance, capacitance and voltage are captioned.
