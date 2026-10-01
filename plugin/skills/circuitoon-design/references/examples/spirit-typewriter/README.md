# Spirit Typewriter, split into four sheets

The Spirit Typewriter reads 42 balls. Each ball holds two SW-520D tilt switches, and both switches share one MCP23017 input. It also has an ESP32 DevKitC V4, two 4.0" ST7796S SPI displays, a 0.96" SSD1306 OLED, a microSD card, and an 18650 battery with an IP5306 charger and a rocker switch.

Drawn as one sheet, this is 109 parts, 253 wires and about 1,700 wire crossings, and nobody can follow it. So it is split along real connectors into four sheets. Each sheet is its own netlist, its own gate and its own link.

Each sheet is laid out with `layout --keep` from its partial, with net labels (`--labels auto`, the default). The "before" columns are the same sheets as shipped before net labels (wires only, the old part spacing). Today's `check` counted the readability warnings in both columns.

| Sheet | Holds | Crossings before | **Crossings now** | Readability warnings before | **now** | Sheet before | Sheet now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `1-main` | Power, ESP32, displays, OLED, SD card, and J1 to J3 (one JST-XH 4-pin per bank) | 297 | **43** | 79 | **10** | 800 x 1020 | 836 x 1046 |
| `2-bank-a` | J1, MCP23017 U2 at 0x20, balls 1 to 14 | 490 | **96** | 156 | **9** | 1490 x 967 | 1250 x 1101 |
| `3-bank-b` | J1, MCP23017 U3 at 0x21, balls 15 to 28 | 519 | **98** | 156 | **13** | 1490 x 967 | 1250 x 1101 |
| `4-bank-c` | J1, MCP23017 U4 at 0x22, balls 29 to 42 | 524 | **97** | 154 | **14** | 1490 x 967 | 1250 x 1101 |

Every sheet has body overlaps 0, caption overlaps 0 and blocked nets none, and passes `gate`.

These readability warnings remain:
- `1-main`:
  - 5 `wires-crowded`: the wires that still fan out from the ESP32 header past BB1.
  - 5 `label-covered`: wires running beside the display headers cross the labels there.
- Bank sheets:
  - 8 to 13 `wires-crowded`: the ground drops of neighbouring balls into their local strips, and wires inside the expander's footprint.
  - 1 `crossings-high`: the trunk wire that joins the local ground strips.

To lay out and gate a sheet:

```bash
circuitoon layout --keep 2-bank-a.partial.json -o bank-a.json && circuitoon gate bank-a.json -o out-bank-a
```

Each `*.partial.json` is its `*.netlist.json` (as `intent`) plus pinned positions for the parts outside the repeat. The balls are not pinned, so each bank keeps its local ground strips `DP1` to `DP4`.

The bank sheets rely on net labels. Each ball's channel is two labels: one at the ball, with both switches wired to it, and one at the expander pad. No breadboard sits between them. With `--labels none` these sheets fail to lay out ("needs a distribution point"), because a header pin takes only one wire.

## The connectors

- On sheet 1, J1, J2 and J3 each carry 1 GND, 2 3V3, 3 SDA and 4 SCL.
- Each bank sheet has a matching J1 with the same pin order: sheet 2 takes J1, sheet 3 takes J2, and sheet 4 takes J3.
- The connector is the catalog's `jst-xh-4`, a real board header, not a made-up off-sheet symbol.

## Why the banks use the CJMCU-2317 breakout

The user's expanders are CJMCU-2317 boards (`mcp23017-cjmcu-2317`), and they lay out and pass the gate, so the bank sheets use them.

The board has pads only, so it cannot sit on a breadboard. Each ball's channel net has three pins: two switch legs and one pad. Net labels carry the channel, so nothing has to join those pins on the sheet. Before net labels, each bank had a half breadboard (BB2) with one column strip per channel; BB2 is now gone. A `power-rail-strip` (BB1) carries 3V3 and GND from J1 to the chip and its address pins.

For comparison, the DIP-28 `mcp23017-dip28`, mounted on BB2, saved the 14 pad-to-strip wires. On bank A it gave 481 to 507 crossings, against 535 to 565 for the CJMCU in the same trial positions. That is not enough of a difference to draw a chip the user does not have. Those figures are from before the DIP-28 was redrawn at its true 0.3 inch width (it now seats in rows e and f and leaves every strip 4 free holes).

## Pin choices on these sheets

These choices are made on the sheets, and the user should confirm them:

- **Balls per channel.** Both of a ball's switches share one channel. If each switch needs its own input, that is 84 inputs, which needs six expanders instead of three.
- **Inputs per chip.** GPA7 and GPB7 are output-only on the MCP23017 (its datasheet and the catalog say so), so each chip takes 14 balls on GPA0 to GPA6 and GPB0 to GPB6. Three chips give exactly 42.
- **Addresses.** 0x20, 0x21 and 0x22 (A0 or A1 tied to 3V3). RESET is tied to 3V3 on every bank.
- **ESP32 pins.** I2C on IO21 (SDA) and IO22 (SCL). SPI on IO18 (SCK), IO23 (MOSI) and IO19 (MISO, the SD card only). Displays: CS on IO5 and IO26, DC on IO4, RESET on IO27. SD card: CS on IO13. IO16 and IO17 are left free, because a WROVER module uses them for PSRAM; these pins work on a WROOM and a WROVER alike.
- **Display MISO is not wired.** The displays are only written to, and many of these modules do not release SDO (MISO), which would break SD card reads. DS1 and DS2 `SDO(MISO)` are in `nc`.
- **I2C pull-ups.** None are drawn. The sheets assume a module on the bus already carries SDA and SCL pull-ups (check the OLED and the CJMCU-2317 boards); if none does, add one 4.7 kohm resistor from SDA and one from SCL to 3V3, once for the whole bus. Confirm this with the user.
- **Inputs are active low.** Enable the MCP23017 pull-ups in firmware; a closed switch reads low.
- **Touch is not wired.** The displays' touch pins and their SD slots are unconnected.

## Warnings

- None on any sheet. (Before the display SDO pins were left unconnected, `1-main` warned `outputs-fight` on MISO.)

## Can a person follow these sheets?

- **`1-main`: yes.** GND, 3V3, I2C and most of SPI are drawn as labels at each pin, so the flag beside a pin names its net. A few nets still run as wires past BB1, where a display header had no room for every label. Trace those few by color.
- **Bank sheets: yes, ball by ball.** Each ball carries one label that names its channel (`ballA_3.CH`), and the expander carries the matching label at its pad, so a builder can read off the sheet which pad each ball uses. The expander end is still busy: the 14 pad labels sit above and beside the CJMCU, and their stubs cross the board's art to reach the pads. Check a pad against the channel table (`gate.json`, or the `layout` output).
