# Embedded parts (`circuitoon-module/1`)

Embed a part only when `circuitoon parts --search` has no match.

The easy way is `circuitoon module new --spec spec.json -o part.json`: it draws the part, marks it custom and lints it (see the `circuitoon-custom-part` skill). A spec's `art` (the same rect shapes as `art.shapes` below, on a body of `body.w` x `body.h` grid units) draws the part like the real board; the skill's `references/art.md` is the guide. This page is the format underneath, for parts you write by hand.

- Take every pin from the maker's documentation (a datasheet, the maker's wiki, or a vendor pinout with a legible silkscreen).
- List those URLs in `source`, separated by spaces.
- Optionally give `description` (one plain sentence, at most 300 characters) and `uses` (1 to 8 typical uses, at most 60 characters each). The editor's Parts panel searches them.
- On a custom part (`"custom": true`), give `photo`: the http(s) URL of the maker's product photo of this exact part that its `art` was drawn from (at most 500 characters), or `"none"` only when no photo of it exists anywhere. The gate blocks (`custom-part-look`) on a custom part with no `photo` or drawn as the generic box, and warns (`custom-part-no-photo`) on `"none"`. Built-in parts never carry it.
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

Without `art`, the part is drawn as a plain box with its pins. That wires correctly, but nobody recognises the board: make custom parts with `module new` and draw their `art` from a photo of the real part (the `circuitoon-custom-part` skill and its `references/art.md`).

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
| `electrical.sim` | Optional: the part's simulation data (see "electrical.sim" below). Without it, a board or module is listed as not simulated ("no power data"); resistors, LEDs, batteries, capacitors, switches, potentiometers and fuses simulate from their model and values alone. |
| `kicad` | Optional: the part's KiCad footprint for `circuitoon kicad`. `{ "footprint": "Connector_PinSocket_2.54mm:PinSocket_1x04_P2.54mm_Vertical", "pins": { "VCC": "1", "GND": "2", "IN1": "3", "IN2": "4" } }`: a footprint from KiCad's standard libraries and each pin's pad number, read from the footprint file. A board with several header rows uses `"headers": [{ "name", "footprint", "pins" }, ...]` instead, one socket strip per row. Leave it out when unsure: the part then exports on a generic pin header, with a warning. |

## electrical.sim

Everything the simulator needs beyond the pins lives in one optional object, `electrical.sim`. It is validated in full: an unknown key, a unit that does not match its kind, or a pin or domain that does not exist is an error. Its fields:

- `modelParams`: physics, by name and unit: `rInternal` (ohm), `contactResistance` (ohm), `is` (A), `n` (1), `rs` (ohm), `dcr` (ohm).
- `power`: the supply topology.
  - `domains` (required): `{ "name", "pin", "ret", "nominal" }`, a named supply: the pin, its explicit return and its nominal voltage, for example `{ "name": "3V3", "pin": "3V3", "ret": "GND", "nominal": 3.3 }`.
  - `draw`: `{ "domain", "typical", "peak"?, "minVolts"? }`, the part's own consumption on a domain (not what its GPIOs source; those are solved). `peak` needs a `note` saying what the peak is and where the number comes from, and may carry a `label`, a short name of up to 32 characters ("Wi-Fi transmit") that findings at peak show; without one they say "At peak" alone. Without `minVolts`, 90 % of the domain's nominal is used, as an estimate.
  - `rails`: `{ "id", "inputs": [{ "domain", "via": "direct" | "diode" }], "output", "kind", "reverse": "blocks" | "body-diode", ... }`. Required per kind: `ldo` needs `vout`, `dropout` and `ioutMax`; `buck` and `boost` need `vout`, `efficiency`, `vinMin`, `vinMax` and `ioutMax`; `switch` (a load switch or a diode path) needs `ron` or `vf`. Optional: `iq`, `rout` (at least 1 milliohm; 0.1 ohm when absent), `offPath` (`"open"` or `"diode"`, buck and boost only), `minLoad` (`{ "amps", "note" }`, a converter that shuts off at light load).
  - `source`: `{ "domain", "voltage": "param:voltage" | <quantity>, "rInternal", "imax"? }`, for a part that is itself a supply.
- `gpio`: `{ "domain", "pins", "outputResistance", "pullup"?, "pulldown"?, "inputLeakage"? }`. Only the listed pins take a GPIO state, and only the pulls given here are allowed on a sheet.
- `limits`: `{ "of": { "pin" } | { "domain" } | { "part": true }, "kind", "value", "provenance", "source"?, "conditions"?, "note"? }`, with `kind` one of `current`, `absMaxCurrent` (A), `power` (W), `vinMax`, `vinMin` (V), `sourceCurrent`, `ioTotalCurrent` (A).
- `usbPorts`: `{ "<usb pin>": { "gnd": "<ground pin>" } }`, required for a port that `power` refers to, so the return current flows through the cable.
- `unaccounted`: a list of what the data leaves out, in plain words (a power LED with no sourced current).

**Every number is a quantity with its own provenance**: `{ "value", "unit", "provenance", "source"?, "note"? }`. Provenance is per value, never per part:

- `datasheet`: from the part's own datasheet. `source` (one or more URLs, space separated) is required; say in `note` which table or page.
- `representative`: from a representative datasheet for a generic part ("a typical 5 mm red LED"). `source` is required, and names that datasheet.
- `estimate`: no source; `note` is required and says what was assumed.

Findings decided on `representative` or `estimate` values are "Likely" warnings and do not block, so an honest estimate costs little. **A wrong number is worse than a missing one**: never present a guess as `datasheet`. When you have no number, leave the field out or mark an estimate with its assumption.

**Node references**: a domain's `pin` and `ret` name a pin or hole group of the part, or a USB port's simulation node, `<usb pin>#vbus` (its 5 V conductor) or `<usb pin>#gnd` (its ground conductor). A DevKit's USB-to-VIN diode is a `switch` rail from a domain on `USB#vbus` to the `VIN` domain.

## Pins

- `name` must be unique. Use the silkscreen text. A repeated name becomes `GND 2`, with `label: "GND"`.
- `side` is `top`, `bottom`, `left` or `right`.
- List pins in physical order: left to right on the top and bottom sides, top to bottom on the left and right sides.
- `{ "spacer": true, "side": ... }` holds a physical gap in a row.

The full format is in the Circuitoon repo, in `docs/PRD.md`, under "Module definition format".
