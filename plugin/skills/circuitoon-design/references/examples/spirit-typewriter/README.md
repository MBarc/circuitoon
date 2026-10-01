# Spirit Typewriter, split into four sheets

The Spirit Typewriter reads 42 balls. Each ball holds two SW-520D tilt switches, and both switches share one MCP23017 input. It also has an ESP32 DevKitC V4, two 4.0" ST7796S SPI displays, a 0.96" SSD1306 OLED, a microSD card, and an 18650 battery with an IP5306 charger and a rocker switch.

Drawn as one sheet, this is 109 parts, 253 wires and about 1,700 wire crossings, and nobody can follow it. So it is split along real connectors into four sheets. Each sheet is its own netlist, its own gate and its own link.

Each sheet is laid out with `layout --keep` from its partial, with wires (the default). Two kinds of net ask for net labels with `"label": true`, because drawn as wires they make the sheets unreadable: the 42 ball channels (each joins two switches and one expander pad: 550 to 590 crossings as wires) and, on `1-main`, the four buses to the three bank connectors (GND, 3V3, SDA and SCL: 360 to 620 crossings as wires). This is the case where to offer the user labels, not to switch them on unasked. The "before" columns are the same sheets with plugin 0.4.0 (its default `--labels auto`). Each version's own `check` counted its readability warnings.

| Sheet | Holds | Crossings before | **Crossings now** | Readability warnings before | **now** | Sheet before | Sheet now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `1-main` | Power, ESP32, displays, OLED, SD card, and J1 to J3 (one JST-XH 4-pin per bank) | 45 | **96** | 12 | **16** | 836 x 1046 | 1580 x 901 |
| `2-bank-a` | J1, MCP23017 U2 at 0x20, balls 1 to 14 | 20 | **184** | 14 | **20** | 990 x 1111 | 1490 x 1211 |
| `3-bank-b` | J1, MCP23017 U3 at 0x21, balls 15 to 28 | 19 | **184** | 15 | **20** | 990 x 1111 | 1470 x 1211 |
| `4-bank-c` | J1, MCP23017 U4 at 0x22, balls 29 to 42 | 18 | **184** | 16 | **20** | 990 x 1111 | 1470 x 1211 |

Every sheet has body overlaps 0, caption overlaps 0 and blocked nets none, and passes `gate` (with `ready: false`: the readability warnings below remain).

`1-main` is pinned for wires: power on the left, the ESP32 in the middle, BB1 turned beside it as the hub for the SPI bus and the display control lines (its rows follow the displays' header order, so both displays take a flat ribbon), and the displays, OLED, SD card and bank connectors on the right.

These readability warnings remain:
- `1-main`: 3 `crossings-high`, 11 `wires-crowded` and 2 `wires-overlap`: the SD card's and DS2's control wires cross the display ribbons and run beside each other into the hub, and two of them could find no line of their own beside a display header (each is named in the gate).
- Bank sheets: 2 or 3 `crossings-high`, 14 `wires-crowded` and 3 `wires-overlap`: the expander's channel pads sit in a 2 x 10 header inside the board, so each stub runs across the board's art to the label column beside the next pad's stub, and a few of those stubs share a line for a step. Labels can only be placed at the board's edge, so these stay.

To lay out and gate a sheet:

```bash
circuitoon layout --keep 2-bank-a.partial.json -o bank-a.json && circuitoon gate bank-a.json -o out-bank-a
```

Each `*.partial.json` is its `*.netlist.json` (as `intent`) plus pinned positions for the parts outside the repeat. The balls are not pinned. The balls' shared ground is wired: each row of balls has its own ground strip (`DP1` to `DP4`) under it, joined to the next by one jumper. The expander is pinned with J1 below it, so the 14 channel labels have room to its left, where its 2 x 10 header faces.

The bank sheets' channels are net labels (their netlists ask for them). Each ball carries its channel label (`ballA_3.CH`) below its first switch; the expander's channel pads carry the matching labels in one column beside its header, in pad order (GPA0, GPB0, GPA1, ...). No breadboard sits between them. Without the labels each channel would need a breadboard strip to join its three pins (a header pin takes only one wire), and those 42 wires to one board cross the sheet hundreds of times.

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

- **`1-main`: yes.** The SPI bus and the display control lines run as a ribbon from the ESP32 through BB1 to both displays in their header order; GND, 3V3, SDA and SCL are labels at each pin. The wires that cross the ribbons (DS1's CS, the SD card's lines) are the ones to trace by color.
- **Bank sheets: yes.** Each ball carries its channel label under its first switch, and the expander has one ordered column of channel labels beside its header, so a builder reads which pad each ball uses straight off the sheet. Each row of balls drops its grounds into its own strip under it. The channel table (`gate.json`, or the `layout` output) lists the same allocation.
