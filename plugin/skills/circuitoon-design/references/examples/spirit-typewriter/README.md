# Spirit Typewriter, split into four sheets

The Spirit Typewriter reads 42 balls. Each ball holds two SW-520D tilt switches, and both switches share one MCP23017 input. It also has an ESP32 DevKitC V4, two 4.0" ST7796S SPI displays, a 0.96" SSD1306 OLED, a microSD card, and an 18650 battery with an IP5306 charger and a rocker switch.

Drawn as one sheet, this is 109 parts, 253 wires and about 1,700 wire crossings, and nobody can follow it. So it is split along real connectors into four sheets. Each sheet is its own netlist, its own gate and its own link.

| Sheet | Holds | Crossings (plain `layout`) | Crossings (`layout --keep`, shipped) | Wire length (keep) |
| --- | --- | --- | --- | --- |
| `1-main` | Power, ESP32, displays, OLED, SD card, and J1 to J3 (one JST-XH 4-pin per bank) | 744 | **319** | 20,376 px |
| `2-bank-a` | J1, MCP23017 U2 at 0x20, balls 1 to 14 | 525 | **586** | 42,670 px |
| `3-bank-b` | J1, MCP23017 U3 at 0x21, balls 15 to 28 | 518 | **526** | 42,930 px |
| `4-bank-c` | J1, MCP23017 U4 at 0x22, balls 29 to 42 | 521 | **518** | 42,910 px |

Every sheet has body overlaps 0, caption overlaps 0 and blocked nets none, and passes `gate`.

To lay out and gate a sheet:

```bash
circuitoon layout --keep 2-bank-a.partial.json -o bank-a.json && circuitoon gate bank-a.json -o out-bank-a
```

Each `*.partial.json` is its `*.netlist.json` (as `intent`) plus pinned positions for the parts outside the repeat. The balls are not pinned, so each bank keeps its local ground strips `DP1` to `DP4`.

## The connectors

- On sheet 1, J1, J2 and J3 each carry 1 GND, 2 3V3, 3 SDA and 4 SCL.
- Each bank sheet has a matching J1 with the same pin order: sheet 2 takes J1, sheet 3 takes J2, and sheet 4 takes J3.
- The connector is the catalog's `jst-xh-4`, a real board header, not a made-up off-sheet symbol.

## Why the banks use the CJMCU-2317 breakout

The user's expanders are CJMCU-2317 boards (`mcp23017-cjmcu-2317`), and they lay out and pass the gate, so the bank sheets use them.

The board has pads only, so it cannot sit on a breadboard. Each ball's channel net has three pins: two switch legs and one pad. The layout needs a strip to join them, so each bank has a half breadboard (BB2), where the layout claims one column strip per channel, with a wire from each pad to its strip. A `power-rail-strip` (BB1) carries 3V3 and GND from J1 to the chip and its address pins.

For comparison, the DIP-28 `mcp23017-dip28`, mounted on BB2, saves the 14 pad-to-strip wires. On bank A it gave 481 to 507 crossings, against 535 to 565 for the CJMCU in the same trial positions. That is not enough of a difference to draw a chip the user does not have.

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

- **`1-main`: yes, with care.** The power chain, the connectors and each display header are clear. The wires between the ESP32, BB1 and the display headers form a dense band. Each wire can be traced by its color, but open the link and click a wire to be sure.
- **Bank sheets: only in part.** The ball side is clear: each ball's two switches drop to a local ground strip, and its two channel wires run as one color to BB2. The expander end is a knot: 14 channel pairs arrive at BB2, and 14 wires go from the strips to the CJMCU pads, over the board's art. A builder should read the channel table (`gate.json`, or the `layout` output) for which pad each ball uses, and use the focused PNG (`focus-ballA_1.png`) or the editor link to follow one ball.
