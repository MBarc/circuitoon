# Drawing a custom part (the art guide)

A part someone can recognise from the product photo is a part they wire correctly. This guide is how to draw it in Circuitoon's Sticker style, in a part spec's `art`.

## The style

Flat colours inside a dark ink outline, on graph paper. Only rectangles: `{ "type": "rect", "x", "y", "w", "h", "fill" }`, with optional `radius`, `outline`, `label`, `labelColor` and `labelSize`. Suggest the real object; do not trace it. At 100% zoom a hobbyist should name the board at a glance: its colour, its shape, where its connectors are.

- **Ink outline.** The renderer outlines every shape with #23282F. Set `"outline": false` for fine detail: pads, holes, text plates, highlights, small parts.
- **Circles and pills.** `radius` rounds the corners: half the width of a square makes a circle, half the height of a rect makes a pill.
- **Order.** Shapes are drawn in order, first at the back. The largest shape is the body: put it first.
- **Labels.** `label` is centred on its shape, bold, 8 px unless `labelSize` says otherwise. Use 5 to 6 px for chip markings and small silkscreen, 7 to 8 px for a board name. Text wider than its shape is not clipped: keep it short.

## Coordinates and where the pins land

- Units are px at 100% zoom. One grid unit is 10 px, the 0.1 inch header pitch. Origin is the body's top left.
- The body is `body.w` x `body.h` grid units (or `art.w` x `art.h` px). Every shape must stay inside it, except that a connector may stick out by up to 20 px (a jack, a USB plug). Do not let a shape stick out on a side that has pins: the art is drawn over the pin stubs.
- The part maker places the pins from `pins`, as always: the left and right sides top to bottom, top and bottom left to right, one slot per entry, `null` for a gap. A side `L` units long with `n` slots puts its first slot at `ceil((L - (n - 1)) / 2)` units, then one every 10 px. Example: 5 pins on the left of an 8-unit-tall body sit at y = 20, 30, 40, 50, 60; on the right, `["+", null, "-"]` on the same body sits at y = 30 and 50.
- Pins sit on the body edge (x = 0 on the left, x = body width on the right, y = 0 on top, y = body height at the bottom). Draw each pin's pad or terminal on its row, within 12 px of that edge.
- The body must have room for the pins: at least the number of slots on a side plus 2 units, and at least 4 x 3 units. `module new` says when it is too small.
- `pinLabels`: `"inside"` writes each pin's name inside the body beside its pin, like silkscreen (boards with a header: keep the outer 12 px of those sides for pads, and keep other detail clear of the labels); `"tips"` writes names past the pin stubs (bare chips); left out, names sit beside the stub, outside the body (parts with wire leads or terminals).
- A header hole drawn in #8A6A1E (3 x 3 px or smaller) must sit on a pin's row near its edge, or `module check` says the art does not match the pins. Use another colour for mounting holes.

## Palette

| Use | Colour |
| --- | --- |
| Ink outline, dark text | #23282F |
| Green PCB (SparkFun red is #C0392B) | #2F9E6E |
| Blue PCB (Adafruit, many breakouts) | #1E4F8A |
| Dark blue PCB (Seeed XIAO) | #1E3A5F |
| Purple PCB (OSH Park) | #7B3FA0 |
| Black PCB, matte plastic | #2B2F36 |
| Chip body, darkest plastic | #1E2126, #1B1F24 |
| Metal (shells, cans, stubs) | #C9CED6, lighter #D5DAE1, shadow #8A9099 |
| Gold pads | #E0B43C, holes #8A6A1E |
| Bare mounting hole ring, its hole | #D5DAE1, #6B727C |
| White silkscreen and plates | #F7F8F3 (#F4F6F8) |
| SMD resistors and caps | #C8A27A |
| Screw terminal blue, green | #2F7FD0, #2E9E5B |
| JST and connector white | #EEF0EC, inner #D6DAD2 |
| LED red, green, blue | #E0483E, #3FBF5F, #4FA3F7 |
| Electrolytic sleeve, its stripe | #2F4F8F, #8FA6D6 |
| Speaker cone, paper | #3A3F47, #6B727C |

Read the board colour off the photo and pick the nearest row; a board's own colour (#RRGGBB) is fine when none fits.

## Recipes

Each block is a list of shapes, checked with `module render` on the body its heading gives. "On a board" means the shapes go on top of a body rect drawn first (the first shape of the header recipe). Move a recipe by adding to every `x` and `y`.

### Pin header strip with gold pads (5 pins on the left, 80 px tall body)

One rounded gold strip along the edge, one hole per pin on the pin's row. Spread pins of a real board's header the way its silkscreen shows (gaps are `null`).

```json
[
  { "type": "rect", "x": 0, "y": 0, "w": 60, "h": 80, "fill": "#1E4F8A", "radius": 6 },
  { "type": "rect", "x": 2, "y": 15, "w": 8, "h": 50, "fill": "#E0B43C", "radius": 2, "outline": false },
  { "type": "rect", "x": 4.5, "y": 18.5, "w": 3, "h": 3, "fill": "#8A6A1E", "radius": 1.5, "outline": false },
  { "type": "rect", "x": 4.5, "y": 28.5, "w": 3, "h": 3, "fill": "#8A6A1E", "radius": 1.5, "outline": false },
  { "type": "rect", "x": 4.5, "y": 38.5, "w": 3, "h": 3, "fill": "#8A6A1E", "radius": 1.5, "outline": false },
  { "type": "rect", "x": 4.5, "y": 48.5, "w": 3, "h": 3, "fill": "#8A6A1E", "radius": 1.5, "outline": false },
  { "type": "rect", "x": 4.5, "y": 58.5, "w": 3, "h": 3, "fill": "#8A6A1E", "radius": 1.5, "outline": false }
]
```

Round pads, one per pin (Adafruit style): per pin `{ "x": 2, "y": <pin y - 4>, "w": 8, "h": 8, "fill": "#E0B43C", "radius": 4, "outline": false }` and the hole as above.

### Screw terminal block, 2 positions (right edge of a 60 x 80 board, pins at y = 30 and 50)

```json
[
  { "type": "rect", "x": 34, "y": 18, "w": 26, "h": 44, "fill": "#2F7FD0", "radius": 3 },
  { "type": "rect", "x": 38, "y": 24, "w": 12, "h": 12, "fill": "#C9CED6", "radius": 6 },
  { "type": "rect", "x": 43, "y": 26, "w": 2, "h": 8, "fill": "#2B2F36", "outline": false },
  { "type": "rect", "x": 38, "y": 44, "w": 12, "h": 12, "fill": "#C9CED6", "radius": 6 },
  { "type": "rect", "x": 43, "y": 46, "w": 2, "h": 8, "fill": "#2B2F36", "outline": false },
  { "type": "rect", "x": 52, "y": 26, "w": 8, "h": 8, "fill": "#1B1F24", "radius": 1, "outline": false },
  { "type": "rect", "x": 52, "y": 46, "w": 8, "h": 8, "fill": "#1B1F24", "radius": 1, "outline": false }
]
```

The round screw heads with their slot sit over each pin's row; the dark squares at the edge are the wire openings. Use #2E9E5B for a green block.

### 3.5 mm audio jack, opening on the left edge (on a 60 x 40 board)

```json
[
  { "type": "rect", "x": -6, "y": 12, "w": 12, "h": 16, "fill": "#2B2F36", "radius": 3 },
  { "type": "rect", "x": 4, "y": 6, "w": 34, "h": 28, "fill": "#2B2F36", "radius": 3 },
  { "type": "rect", "x": -4, "y": 16, "w": 8, "h": 8, "fill": "#1B1F24", "radius": 4, "outline": false },
  { "type": "rect", "x": -2, "y": 18, "w": 4, "h": 4, "fill": "#8A9099", "radius": 2, "outline": false }
]
```

A black block with a round barrel standing out of the edge. Its pins (tip, ring, sleeve) are usually on the opposite side or the bottom: put the jack on a side without pins.

### USB-A plug on the left edge (a dongle; 60 x 60 body)

```json
[
  { "type": "rect", "x": -14, "y": 8, "w": 30, "h": 44, "fill": "#C9CED6", "radius": 1 },
  { "type": "rect", "x": -11, "y": 12, "w": 24, "h": 36, "fill": "#F4F6F8", "radius": 1, "outline": false },
  { "type": "rect", "x": 12, "y": 4, "w": 48, "h": 52, "fill": "#2B2F36", "radius": 6 }
]
```

### USB-C receptacle on the top edge (on a 60 x 60 board)

```json
[
  { "type": "rect", "x": 18, "y": -4, "w": 24, "h": 16, "fill": "#C9CED6", "radius": 4 },
  { "type": "rect", "x": 22, "y": -1, "w": 16, "h": 6, "fill": "#2B2F36", "radius": 3, "outline": false }
]
```

### Micro USB receptacle on the left edge (on a 60 x 60 board)

```json
[
  { "type": "rect", "x": -4, "y": 21, "w": 18, "h": 18, "fill": "#C9CED6", "radius": 2 },
  { "type": "rect", "x": -2, "y": 26, "w": 5, "h": 8, "fill": "#2B2F36", "radius": 1.5, "outline": false }
]
```

When the board's USB port is a real connection in the design, give it a pin of its own on that edge instead (a `usb` pin is drawn by the renderer as the connector), and leave this out.

### Round speaker, seen from the front (80 x 80 body)

```json
[
  { "type": "rect", "x": 2, "y": 2, "w": 76, "h": 76, "fill": "#C9CED6", "radius": 38 },
  { "type": "rect", "x": 8, "y": 8, "w": 64, "h": 64, "fill": "#2B2F36", "radius": 32 },
  { "type": "rect", "x": 14, "y": 14, "w": 52, "h": 52, "fill": "#3A3F47", "radius": 26, "outline": false },
  { "type": "rect", "x": 28, "y": 28, "w": 24, "h": 24, "fill": "#2B2F36", "radius": 12 },
  { "type": "rect", "x": 34, "y": 34, "w": 6, "h": 6, "fill": "#6B727C", "radius": 3, "outline": false }
]
```

Concentric circles: metal frame, surround, cone, dust cap, a highlight. Its two leads go on one side, with `pinLabels` left out so the names sit outside.

### Electrolytic capacitor on a board, seen from above (30 x 30 area)

```json
[
  { "type": "rect", "x": 2, "y": 2, "w": 26, "h": 26, "fill": "#1B1F24", "radius": 3 },
  { "type": "rect", "x": 4, "y": 4, "w": 22, "h": 22, "fill": "#C9CED6", "radius": 11 },
  { "type": "rect", "x": 4, "y": 4, "w": 22, "h": 7, "fill": "#2B2F36", "radius": 3, "outline": false }
]
```

An SMD can on its black base, with the dark polarity band. A through-hole cap seen from the side is the library's `capacitor-electrolytic` (blue sleeve #2F4F8F, light stripe #8FA6D6 on the minus side).

### IC chip with its marking (40 x 30 area)

```json
[
  { "type": "rect", "x": 7, "y": 3, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 14, "y": 3, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 21, "y": 3, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 28, "y": 3, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 7, "y": 24, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 14, "y": 24, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 21, "y": 24, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 28, "y": 24, "w": 3, "h": 3, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 4, "y": 6, "w": 30, "h": 18, "fill": "#1E2126", "radius": 1, "label": "PAM8302", "labelColor": "#C9CED6", "labelSize": 5 }
]
```

Legs first, then the body over them. A QFN or a module without legs is the body alone.

### Mounting holes (a corner hole, 10 x 10 area)

```json
[
  { "type": "rect", "x": 1, "y": 1, "w": 8, "h": 8, "fill": "#D5DAE1", "radius": 4, "outline": false },
  { "type": "rect", "x": 3.5, "y": 3.5, "w": 3, "h": 3, "fill": "#6B727C", "radius": 1.5, "outline": false }
]
```

A gold ring is the same with #E0B43C and a #23282F hole. Large holes (M3 on a Pi): 14 px ring, 7 px hole.

### Silkscreen text (a name plate)

```json
[
  { "type": "rect", "x": 10, "y": 6, "w": 50, "h": 10, "fill": "#1E4F8A", "outline": false, "label": "2.5W Amp", "labelColor": "#F7F8F3", "labelSize": 6 }
]
```

Fill the plate with the board colour for printed text, or #F7F8F3 with #23282F text for a white label. Short words only: the name and what the silkscreen says.

### JST connector, 2 pins on the bottom edge (50 x 50 body)

```json
[
  { "type": "rect", "x": 6, "y": 8, "w": 38, "h": 30, "fill": "#EEF0EC", "radius": 2 },
  { "type": "rect", "x": 10, "y": 14, "w": 30, "h": 20, "fill": "#D6DAD2", "radius": 1 },
  { "type": "rect", "x": 17.5, "y": 17, "w": 5, "h": 13, "fill": "#B9BEB5", "radius": 1, "outline": false },
  { "type": "rect", "x": 27.5, "y": 17, "w": 5, "h": 13, "fill": "#B9BEB5", "radius": 1, "outline": false },
  { "type": "rect", "x": 18.5, "y": 38, "w": 3, "h": 12, "fill": "#C9CED6", "outline": false },
  { "type": "rect", "x": 28.5, "y": 38, "w": 3, "h": 12, "fill": "#C9CED6", "outline": false }
]
```

With the pins at x = 20 and 30 (two bottom pins on a 5-unit-wide body). A JST-PH is the same, smaller; a battery lead adds red and black wires.

### LED on a board (SMD), and a 5 mm LED (40 x 40 body)

```json
[
  { "type": "rect", "x": 2, "y": 4, "w": 8, "h": 5, "fill": "#E0483E", "radius": 1, "outline": false },
  { "type": "rect", "x": 0, "y": 18.5, "w": 14, "h": 3, "fill": "#B8BEC7", "radius": 1.5 },
  { "type": "rect", "x": 26, "y": 18.5, "w": 14, "h": 3, "fill": "#B8BEC7", "radius": 1.5 },
  { "type": "rect", "x": 11, "y": 4, "w": 18, "h": 24, "fill": "#E0483E", "radius": 9 },
  { "type": "rect", "x": 9, "y": 25, "w": 22, "h": 6, "fill": "#C93C3C", "radius": 1.5 },
  { "type": "rect", "x": 14, "y": 8, "w": 4, "h": 9, "fill": "#FFC9C9", "radius": 2, "outline": false }
]
```

The first shape is a power LED on a board; the rest is a 5 mm LED with its leads (on the pin rows), body, rim and highlight.

## Workflow

1. **Find the photo.** The maker's product page for the exact board (Adafruit, SparkFun, Pololu, Waveshare, Seeed ...). Download the main image, a top-down one if there is one, and open it with the Read tool. A maker's dimension drawing or fab print gives the true size.
2. **Note what you see.** Board colour; outline and its proportions (width : height); every connector, its type and the edge it is on; the header, its side and its pin order as printed; mounting holes; the main chip and its marking; anything big (a trim pot, a USB port, a terminal block).
3. **Pick the body.** In grid units, with the photo's aspect ratio, big enough for the pins (slots plus 2 on each side with pins). Turn the photo so its header is on the side you give those pins; keep the order the silkscreen shows.
4. **Draw.** Body first, then connectors and the header, then the chip, small parts, holes and silkscreen. Copy the idioms above or from a built-in part: `circuitoon part <id> --json` prints its `art`, and `circuitoon module render <id> -o look.png` draws it.
5. **Render and compare.** `circuitoon module new --spec spec.json -o part.json`, then `circuitoon module render part.json -o part.png`. Open the render and the photo side by side.
6. **Fix and repeat** until a hobbyist would recognise the board: same colour, same proportions, connectors on the same edges, pins in the same order.

The art of a `module new` result (the generic box) can be copied into the spec whole as a start: its `w` and `h` then set the body.
