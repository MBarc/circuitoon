# Worked examples

Each file in `examples/` is a netlist of built-in parts that lays out and passes `gate`:

```bash
circuitoon layout examples/<file> -o sheet.json && circuitoon gate sheet.json -o out
```

Every example is laid out with the default: wires (`--labels none`), labels only on nets that ask with `"label": true`. "Before" is the same netlist laid out with plugin 0.4.0 and its default `--labels auto`. Each version's own `check` counted its readability warnings.

| File | Shows | Crossings before | Crossings now | Readability warnings before / now | Sheet now |
| --- | --- | --- | --- | --- | --- |
| `led-breadboard.netlist.json` | Parts mounted `on` a breadboard: their legs share strips, and the battery wires into free holes, each wire entering the board straight from its edge. Also a value, wire colors and cable ends. | 1 | 0 | 2 / 2 | 440 x 387 |
| `esp32-bme280.netlist.json` | Two-pin nets wired pin to pin, so no breadboard is needed. The sensor is turned so its header faces the ESP32. Also a group and a note. | 1 | 2 | 0 / 0 | 370 x 270 |
| `battery-switch.netlist.json` | A power chain through a switch. The IP5306's B- and 5V- are joined inside the part and wired as one node, so GND's three endpoints chain with no breadboard. | 2 | 3 | 0 / 0 | 640 x 247 |
| `tilt-sensors-8.netlist.json` | A `repeat` with explicit bindings (8 copies) and a shared ground: each block of copies gets local rail strips (`DP1` to `DP3`) for its ground, and each switch's signal is a wire to its ESP32 pin. `render --focus tilt_1` frames one copy. | 11 | 40 | 2 / 5 | 720 x 917 |
| `spirit-typewriter/` | A large design split into four sheets along real connectors. Each sheet is laid out from a partial with `layout --keep`. Its 42 channel nets and the four buses to the bank connectors ask for labels. See its `README.md`. | 45, 20, 19, 18 | 98, 97, 97, 97 | 12, 14, 15, 16 / 14, 15, 15, 15 | see README |

## Warnings

- `led-breadboard`: two readability warnings, both `wire-hugs-part`: the battery's + wire enters R1's strip straight from the board's top edge, past R1's lead, and the ground jumper leaves D1's strip past D1's body. The circuit is correct.
- `esp32-bme280`: none.
- `battery-switch`: none.
- `tilt-sensors-8`: five readability warnings: two `crossings-high` and three `wires-crowded`, where the signal wires of switches 1, 2, 6 and 7 cross the block's ground drops and run beside each other on their way to the ESP32's header. No electrical warnings.
- `spirit-typewriter/1-main`: none. The displays are never read, so their `SDO(MISO)` pins are in `nc` and only the SD card drives MISO (see "SPI MISO" in `SKILL.md`).
- `spirit-typewriter/1-main` ships with SW1 open on purpose, so `sim` (and the simulation group of `gate`) reports one folded "not powered in the current state because SW1 is open" warning; set SW1 to closed to simulate the sheet running.
- The spirit-typewriter sheets: readability warnings only (listed in its README), and no electrical warnings.

Every gate also prints the same "not checked" list: current and heat, bus addresses, floating configuration inputs, firmware, timing, mechanical fit, mains, and the correctness of each part beyond its sources. Pass that list on every time.
