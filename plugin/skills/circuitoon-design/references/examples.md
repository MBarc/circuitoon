# Worked examples

Each file in `examples/` is a netlist of built-in parts that lays out and passes `gate`:

```bash
circuitoon layout examples/<file> -o sheet.json && circuitoon gate sheet.json -o out
```

Every example is laid out with the default `--labels auto`. "Before" is the same netlist laid out before net labels and the roomier spacing. Today's `check` counted the readability warnings in both columns.

| File | Shows | Crossings before | Crossings now | Readability warnings before / now | Sheet now |
| --- | --- | --- | --- | --- | --- |
| `led-breadboard.netlist.json` | Parts mounted `on` a breadboard: their legs share strips, and the battery wires into free holes. Also a value, wire colors and cable ends. | 1 | 1 | 2 / 2 | 440 x 387 |
| `esp32-bme280.netlist.json` | Two-pin nets wired pin to pin, so no breadboard is needed. SDA and SCL run between groups, so they are drawn as net labels. Also a group and a note. | 5 | 1 | 1 / 0 | 310 x 341 |
| `battery-switch.netlist.json` | A power chain through a switch. The IP5306's B- and 5V- are joined inside the part and wired as one node. GND has three endpoints, so it is drawn with labels. | 3 | 2 | 0 / 0 | 490 x 447 |
| `tilt-sensors-8.netlist.json` | A `repeat` with explicit bindings (8 copies) and a shared ground. Each block of copies gets local rail strips (`DP1` to `DP3`), joined to the netlist's rail strip BB1. Each copy's signal is a label at the copy and one at its ESP32 pin. `render --focus tilt_1` frames one copy. | 44 | 9 | 11 / 0 | 1150 x 831 |
| `spirit-typewriter/` | A large design split into four sheets along real connectors. Each sheet is laid out from a partial with `layout --keep`. See its `README.md`. | 297, 490, 519, 524 | 43, 96, 98, 97 | 79, 156, 156, 154 / 10, 9, 13, 14 | see README |

## Warnings

- `led-breadboard`: two readability warnings, both `wire-hugs-part`. The battery wires pass within 5 px of the resistor's and the LED's bodies on their way into the strips. The circuit is correct.
- `esp32-bme280`: none.
- `battery-switch`: none.
- `tilt-sensors-8`: none.
- `spirit-typewriter/1-main`: none. The displays are never read, so their `SDO(MISO)` pins are in `nc` and only the SD card drives MISO (see "SPI MISO" in `SKILL.md`).
- The spirit-typewriter sheets: readability warnings only (listed in its README), and no electrical warnings.

Every gate also prints the same "not checked" list: current and heat, bus addresses, floating configuration inputs, firmware, timing, mechanical fit, mains, and the correctness of each part beyond its sources. Pass that list on every time.
