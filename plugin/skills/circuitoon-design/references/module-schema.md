# Embedded parts (`circuitoon-module/1`)

Embed a part only when `circuitoon parts --search` has no match.

The easy way is `circuitoon module new --spec spec.json -o part.json`: it draws the part, marks it custom and lints it (see the `circuitoon-custom-part` skill). This page is the format underneath, for parts you write by hand.

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
| `type` | One of `power_in`, `power_out`, `ground`, `input`, `output`, `io`, `passive`, `nc` or `usb`. Leave it out when unsure: the checker never guesses about an untyped pin. A `usb` pin is a whole USB socket or plug and needs `usb`: `{ "connector": "A" | "B" | "mini-B" | "micro-B" | "C", "gender": "receptacle" | "plug", "role": "host" | "device" | "dual" | "passthrough", "version"?, "speed"?, "source"? (mA a host supplies), "draw"? (mA a device takes), "power"?: "only", "hub"?, "through"? }`, every optional field only when the maker's documentation states it. The part maker and `module new` do not make USB ports. |
| `supply` | The voltage the pin sees: `3V3`, `5V` or `3.7V`. Write several accepted rails as `3V3/5V`. |
| `capacity` | How many wire ends a pin or pad takes: 1 to 8, default 1. Use 2 for a screw terminal that takes two wires. |
| `internal` | Pins joined inside the part, for example `[["GND", "GND 2"]]`. Never use it for a switch. |
| `holes` | Interior header pads: `{ "name", "at": [[x, y]], "holeStyle": "pad" }`, on the 10 px grid inside the body. |
| `caps` | On a pin or pad, what it cannot do, from the chip's datasheet only: `inputOnly`, `outputOnly`, `flash`, `noPullup` (each `true`), `strapping` (`"high"`, `"low"` or `"either"`: the level the boot needs at reset), `downloadOnly` (`true` when that level only matters for flashing over serial) and `note` (one sentence on why). Leave it out when the datasheet does not say. The pin rules fire only on what is set. |
| `electrical.i2c` | For an I2C device: `{ "sda": "SDA", "scl": "SCL", "address": { "base": 32, "pins": [{ "pin": "A0", "add": 1 }] }, "pullups": false }`. `address` may instead be `{ "fixed": 118 }`. Set `pullups` only when the maker says whether the board has SDA/SCL pull-ups; leave it out otherwise. |
| `electrical.params` | Values the part carries, for example `{ "resistance": { "unit": "ohm", "default": 1000 } }`. |
| `kicad` | Optional: the part's KiCad footprint for `circuitoon kicad`. `{ "footprint": "Connector_PinSocket_2.54mm:PinSocket_1x04_P2.54mm_Vertical", "pins": { "VCC": "1", "GND": "2", "IN1": "3", "IN2": "4" } }`: a footprint from KiCad's standard libraries and each pin's pad number, read from the footprint file. A board with several header rows uses `"headers": [{ "name", "footprint", "pins" }, ...]` instead, one socket strip per row. Leave it out when unsure: the part then exports on a generic pin header, with a warning. |

## Pins

- `name` must be unique. Use the silkscreen text. A repeated name becomes `GND 2`, with `label: "GND"`.
- `side` is `top`, `bottom`, `left` or `right`.
- List pins in physical order: left to right on the top and bottom sides, top to bottom on the left and right sides.
- `{ "spacer": true, "side": ... }` holds a physical gap in a row.

The full format is in the Circuitoon repo, in `docs/PRD.md`, under "Module definition format".
