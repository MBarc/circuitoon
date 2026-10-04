---
name: circuitoon-custom-part
description: Make a custom Circuitoon part (module) for a device the built-in library does not have - a sensor, breakout, board, display or chip - from its maker's datasheet, with the pinout confirmed by a second source, then use it in a netlist. Use whenever a Circuitoon design needs a part that `circuitoon parts --search` does not find, or someone asks to add, draw or define their own part for Circuitoon.
---

# Making a custom part

Someone will wire a real board from this part. A wrong pin is worse than a missing part: a missing part stops the design, a wrong pin burns a board. So every pin comes from the maker's documentation, and anything you are not sure of goes to the user as a question.

The CLI is the one the `circuitoon-design` skill finds (`circuitoon` below stands for that command). Work in a scratch folder of the user's project.

## Before you start

Run `circuitoon parts --search <text>` with the chip name and the board name. If the library has the part, use it and stop here: built-in parts are sourced and independently checked, custom parts are not.

## The steps

1. **Identify the exact part.** Maker, model, board revision and variant. Clones of one breakout often order their header differently (a 4-pin OLED is sold as GND VCC SCL SDA and as VCC GND SCL SDA). If you cannot tell which one the user has, ask, or ask for a photo of the silkscreen.

2. **Source the pinout from the maker.** Fetch the maker's datasheet or pinout page: the chip vendor for a bare chip, the board maker (Adafruit, SparkFun, Seeed, Waveshare, a vendor's wiki) for a breakout. Never put the user's email address or other personal data in a search or a request.

3. **Confirm it with a second, independent source.** Another vendor's pinout, a clear photo of the silkscreen, the board's schematic or an official Fritzing part. Compare every pin, in order. When the two disagree, follow the maker, say so, and ask the user to check their board.

4. **Never invent a pin.** A pin you could not source does not go in. If that leaves the part unusable, stop and tell the user what is missing. Never fill a gap from memory, from a similar part, or from what a pin is "usually" called.

5. **Write the spec** (`circuitoon-part-spec/1`, schema in `../circuitoon-design/references/schemas/part-spec.schema.json`):

   ```json
   {
     "format": "circuitoon-part-spec/1",
     "name": "INA219 current sensor breakout (CJMCU-219)",
     "category": "Sensors",
     "source": ["https://www.ti.com/lit/ds/symlink/ina219.pdf", "https://second-source.example/pinout"],
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
   - **Physical order.** List the pins as seen from the component side, in the maker's drawing orientation: left and right pins top to bottom, top and bottom pins left to right. Put `null` where a header has a gap.
   - **Names** are the silkscreen text. A repeated name (three GND pins) is numbered for you: `GND`, `GND 2`, `GND 3`, each labelled `GND`. If the datasheet says they are joined on the board, list them in `internal`.
   - **Types** are `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive` or `nc`. Leave a type out when the datasheet does not make it clear. The checker uses exactly what you give, so a wrong type is a wrong finding.
   - **Supply** is the rails a power pin takes or gives, from the datasheet's range: `"3V3"`, `"5V"`, `"3V3/5V"`.
   - **caps** only where the chip's datasheet says a pin cannot do something (`inputOnly`, `outputOnly`, `strapping`, ...), as in `../circuitoon-design/references/module-schema.md`.
   - `"style": "chip"` draws a bare IC (names past the pin tips) instead of a breakout board. `body` sets the size in grid units and the colour; leave the size out and it fits the pins.

6. **Build and lint it.**

   ```bash
   circuitoon module new --spec spec.json -o part.json
   circuitoon module check part.json
   ```

   `module new` also reads the spec on standard input. It writes nothing when the lint finds an error. Fix every error. Read every warning: a power pin with no type or supply means the checker cannot catch a wrong voltage on it, so fix it from the datasheet or tell the user why you could not.

7. **Render it and look at it.**

   ```bash
   circuitoon module render part.json -o part.png
   ```

   Open the PNG and compare it with the maker's drawing or a photo: the pins in the same order on the same sides, every label readable, nothing overlapping. Fix the spec and render again until it matches.

8. **Ask the user to confirm anything uncertain** before you use the part: a variant you could not pin down, sources that disagreed, a pin type you left out. Show them the render and the pin list.

9. **Use it.** Put the module from `part.json` under the netlist's `modules`, keyed by its id, and refer to that id in `parts`:

   ```json
   "modules": { "custom-ina219-current-sensor-breakout-cjmcu-219": { ...the contents of part.json... } },
   "parts": [{ "ref": "U2", "module": "custom-ina219-current-sensor-breakout-cjmcu-219" }]
   ```

   Then follow `circuitoon-design` as usual: `layout`, `gate`, `explain`. `layout` and `gate` list the part as custom and unverified, and `explain` names it in its notes. Pass that on to the user when you present the design.

## Offering it to the library

A part that turned out well can be offered to the built-in library through the issue form at https://github.com/MBarc/circuitoon/issues/new?template=part-submission.yml (it needs a GitHub account). Paste `part.json` and the source links. The project rebuilds and independently checks every submitted part before it ships, and submissions are shared under the project's MIT licence.
