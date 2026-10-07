---
name: circuitoon-custom-part
description: Make a custom Circuitoon part (module) for a device the built-in library does not have - a sensor, breakout, board, display or chip - from its maker's datasheet, with the pinout confirmed by a second source and drawn to look like the real board from its product photo, then use it in a netlist. Use whenever a Circuitoon design needs a part that `circuitoon parts --search` does not find, or someone asks to add, draw or define their own part for Circuitoon.
---

# Making a custom part

Someone will wire a real board from this part. A wrong pin is worse than a missing part: a missing part stops the design, a wrong pin burns a board. So every pin comes from the maker's documentation, and anything you are not sure of goes to the user as a question.

They will also hold the real board next to the picture. A part drawn as a generic green box makes them guess which side is which; a part drawn like the product photo (its colour, its shape, its connectors and header where they really are) they recognise at a glance. So every custom part is drawn from a photo of the real board.

The CLI is the one the `circuitoon-design` skill finds (`circuitoon` below stands for that command). Work in a scratch folder of the user's project.

## Before you start

Run `circuitoon parts --search <text>` with the chip name and the board name. If the library has the part, use it and stop here: built-in parts are sourced and independently checked, custom parts are not.

## The steps

1. **Identify the exact part.** Maker, model, board revision and variant. Clones of one breakout often order their header differently (a 4-pin OLED is sold as GND VCC SCL SDA and as VCC GND SCL SDA). If you cannot tell which one the user has, ask, or ask for a photo of the silkscreen.

2. **Source the pinout from the maker.** Fetch the maker's datasheet or pinout page: the chip vendor for a bare chip, the board maker (Adafruit, SparkFun, Seeed, Waveshare, a vendor's wiki) for a breakout. Never put the user's email address or other personal data in a search or a request.

3. **Confirm it with a second, independent source.** Another vendor's pinout, a clear photo of the silkscreen, the board's schematic or an official Fritzing part. Compare every pin, in order. When the two disagree, follow the maker, say so, and ask the user to check their board.

4. **Never invent a pin.** A pin you could not source does not go in. If that leaves the part unusable, stop and tell the user what is missing. Never fill a gap from memory, from a similar part, or from what a pin is "usually" called.

5. **Look at the real board.** Find a product photo of the exact board on its maker's page (Adafruit, SparkFun, Pololu, Waveshare, Seeed, ...): a top-down shot of the component side is best. Download the image to the scratch folder and open it with the Read tool: WebFetch describes a page but does not show you its images, nor their URLs. List the image URLs in the page's HTML, then download one:

   ```bash
   curl -sL <product page URL> | grep -oE 'https://[^"]+\.(jpg|jpeg|png)' | sort -u
   curl -sL -o photo.jpg <image URL>
   ```

   Some shops refuse plain curl requests. Then try the maker's image CDN link directly (shown on the page or in its search results), or the next source (a distributor's listing of the same board). Never set a User-Agent or any other request field that carries the user's name, email or other personal data. A dimension drawing or fab print from the maker gives the true outline. Note:
   - the board colour, and its outline and proportions (width : height, from the dimensions when given);
   - every connector: its type (pin header, screw terminal, JST, USB-C, micro USB, 3.5 mm jack, ...) and the edge it sits on;
   - where the pin header is, and its pin order as the silkscreen prints it, pin by pin from one end to the other;
   - mounting holes, the main chip and its marking, anything large (a trim pot, a can, a speaker cone).

   **The photo is the check on the pin order.** List the pins in the order they physically sit on the board's header or pads, side by side as printed on the silkscreen, read from the photo and the maker's board drawing. Pinout pages and datasheets often group pins by function (power, then I2C, then the rest), which is NOT the physical order. The PAM8302 amp's pins listed by function are VIN, GND, A+, A-, SD; its header reads A+, A-, SD, Vin, Gnd. When the photo and the pinout page disagree on the order, the photo wins.

   Record the photo's URL in the spec's `photo`. Only when no photo of the part exists anywhere (a generic part with no maker) write `"photo": "none"`, draw from the maker's dimension drawing or description, and tell the user the drawing was not checked against a photo. The gate blocks on a custom part with no `photo`.

6. **Write the spec** (`circuitoon-part-spec/1`, schema in `../circuitoon-design/references/schemas/part-spec.schema.json`):

   ```json
   {
     "format": "circuitoon-part-spec/1",
     "name": "INA219 current sensor breakout (CJMCU-219)",
     "category": "Sensors",
     "source": ["https://www.ti.com/lit/ds/symlink/ina219.pdf", "https://second-source.example/pinout"],
     "description": "Measures current and bus voltage over I2C with a 0.1 ohm shunt.",
     "uses": ["battery monitor", "solar panel logger"],
     "photo": "https://example.com/product-photo-of-this-exact-board.jpg",
     "pins": {
       "left": [
         { "name": "VCC", "type": "power_in", "supply": "3V3/5V" },
         { "name": "GND", "type": "ground" },
         { "name": "SCL", "type": "input" },
         { "name": "SDA", "type": "io" }
       ],
       "right": [{ "name": "VIN+", "type": "passive" }, { "name": "VIN-", "type": "passive" }]
     }
   }
   ```

   The URLs above show the shape only. Yours must be the real pages you read.

   - **Cite every URL** you used in `source`: the maker's datasheet first, then the second source.
   - **Physical order.** List the pins in the order they physically sit on the header or pads, as the photo and the silkscreen show them (step 5), never in the order a pinout table groups them by function. Seen from the component side: left and right pins top to bottom, top and bottom pins left to right. Put `null` where a header has a gap.
   - **photo**: the URL of the product photo you drew from (step 5), or `"none"` when no photo exists anywhere.
   - **Names** are the silkscreen text. A repeated name (three GND pins) is numbered for you: `GND`, `GND 2`, `GND 3`, each labelled `GND`. If the datasheet says they are joined on the board, list them in `internal`.
   - **Types** are `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive` or `nc`. Leave a type out when the datasheet does not make it clear. The checker uses exactly what you give, so a wrong type is a wrong finding.
   - **Supply** is the rails a power pin takes or gives, from the datasheet's range: `"3V3"`, `"5V"`, `"3V3/5V"`.
   - **caps** only where the chip's datasheet says a pin cannot do something (`inputOnly`, `outputOnly`, `strapping`, ...), as in `../circuitoon-design/references/module-schema.md`.
   - **description and uses**: always fill them: one plain sentence on what the part is (300 characters at most) and 1 to 8 typical uses (60 characters each). The editor's Parts panel searches them and shows the description as the tooltip.
   - **art**: draw the board as the photo shows it, following `references/art.md` (the coordinates, the palette and recipes for headers, screw terminals, jacks, USB ports, speakers, chips, holes and silkscreen). Give `body.w` and `body.h` (grid units of 10 px, one per 0.1 inch) with the real board's aspect ratio, big enough for the pins, and put each pin on the side and in the order it physically is. The pins are placed by the part maker over your drawing; draw their pads under them. To see how the library draws something, `circuitoon part <id> --json` prints a built-in part's `art` and `circuitoon module render <id> -o look.png` draws it.
   - Without `art`, `"style": "chip"` draws a bare IC (names past the pin tips) instead of a breakout board, and `body` sets the size and colour of that generic drawing. `module new` and `module check` warn `custom-part-look` for such a part, and the gate blocks on it: fine as a first pass, never as the finished part.

7. **Build and lint it.**

   ```bash
   circuitoon module new --spec spec.json -o part.json
   circuitoon module check part.json
   ```

   `module new` also reads the spec on standard input. It writes nothing when the lint finds an error. Fix every error. Read every warning: a power pin with no type or supply means the checker cannot catch a wrong voltage on it, so fix it from the datasheet or tell the user why you could not. `custom-part-look` (drawn as the generic box, or no `photo`) blocks the gate later: fix it now. `custom-part-no-photo` (`"photo": "none"`) is listed by the gate as a warning to pass on. A part made with `"style": "chip"` and no `art` counts as drawn (a bare chip looks like that), but it still needs `photo`.

   Known limits, so do not lean on them: the gate only spots art that is exactly the generated box, so art with one shape added passes; and `"photo": "none"` only warns, even on a part that has a maker. Neither makes the drawing right.

8. **Render it and compare it with the photo.**

   ```bash
   circuitoon module render part.json -o part.png
   ```

   Open the render and the photo, one after the other, and compare: the same colour, the same proportions, the connectors on the same edges, the pins in the same order on the same sides as the header in the photo (read it pin by pin), every label readable, nothing overlapping. Fix the spec's `art` (or pins) and render again until a hobbyist holding the board would recognise it.

9. **Ask the user to confirm anything uncertain** before you use the part: a variant you could not pin down, sources that disagreed, a pin type you left out. Show them the render and the pin list, and say which photo you drew it from (its URL), or that you found none.

10. **Use it.** Put the module from `part.json` under the netlist's `modules`, keyed by its id, and refer to that id in `parts`:

   ```json
   "modules": { "custom-ina219-current-sensor-breakout-cjmcu-219": { ...the contents of part.json... } },
   "parts": [{ "ref": "U2", "module": "custom-ina219-current-sensor-breakout-cjmcu-219" }]
   ```

   Then follow `circuitoon-design` as usual: `layout`, `gate`, `explain`. `layout` and `gate` list the part as custom and unverified, and `explain` names it in its notes. The gate blocks (`custom-part-look`) on a custom part drawn as the generic box or with no `photo`. Pass that on to the user when you present the design.

## Offering it to the library

A part that turned out well can be offered to the built-in library through the issue form at https://github.com/MBarc/circuitoon/issues/new?template=part-submission.yml (it needs a GitHub account). Paste `part.json` and the source links. The project rebuilds and independently checks every submitted part before it ships, and submissions are shared under the project's MIT licence.
