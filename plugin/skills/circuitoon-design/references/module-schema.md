# Embedded parts (`circuitoon-module/1`)

Embed a part only when `circuitoon parts --search` has no match.

- Take every pin from the maker's documentation (a datasheet, the maker's wiki, or a vendor pinout with a legible silkscreen).
- List those URLs in `source`, separated by spaces.
- If a pin cannot be verified, do not add the part: tell the user what is missing.
- The layout and the gate report embedded parts as "custom, unverified". Say so when you present the design.

This example lays out and passes `gate`. The URLs are placeholders: yours must be real sources.

```json
"modules": {
  "relay-board-2ch": {
    "format": "circuitoon-module/1",
    "id": "relay-board-2ch",
    "name": "2-channel relay board (5 V)",
    "category": "Outputs",
    "source": "https://example.com/datasheet.pdf https://example.com/pinout",
    "pins": [
      { "name": "VCC", "side": "left", "type": "power_in", "supply": "5V" },
      { "name": "GND", "side": "left", "type": "ground" },
      { "name": "IN1", "side": "left", "type": "input" },
      { "name": "IN2", "side": "left", "type": "input" }
    ]
  }
}
```

Without `art`, the part is drawn as a plain box with its pins, which is enough for a wiring diagram.

## Fields

| Field | Rule |
| --- | --- |
| `id` | Lowercase kebab-case. It may not reuse a built-in id. |
| `pins[]` | See "Pins" below. |
| `type` | One of `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive` or `nc`. Leave it out when unsure: the checker never guesses about an untyped pin. |
| `supply` | The voltage the pin sees: `3V3`, `5V` or `3.7V`. Write several accepted rails as `3V3/5V`. |
| `capacity` | How many wire ends a pin or pad takes: 1 to 8, default 1. Use 2 for a screw terminal that takes two wires. |
| `internal` | Pins joined inside the part, for example `[["GND", "GND 2"]]`. Never use it for a switch. |
| `holes` | Interior header pads: `{ "name", "at": [[x, y]], "holeStyle": "pad" }`, on the 10 px grid inside the body. |
| `electrical.params` | Values the part carries, for example `{ "resistance": { "unit": "ohm", "default": 1000 } }`. |

## Pins

- `name` must be unique. Use the silkscreen text. A repeated name becomes `GND 2`, with `label: "GND"`.
- `side` is `top`, `bottom`, `left` or `right`.
- List pins in physical order: left to right on the top and bottom sides, top to bottom on the left and right sides.
- `{ "spacer": true, "side": ... }` holds a physical gap in a row.

The full format is in the Circuitoon repo, in `docs/PRD.md`, under "Module definition format".
