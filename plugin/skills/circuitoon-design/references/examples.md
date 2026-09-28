# Worked examples

Each file in `examples/` is a netlist of built-in parts that lays out and passes `gate`:

```bash
circuitoon layout examples/<file> -o sheet.json && circuitoon gate sheet.json -o out
```

| File | Shows | Crossings |
| --- | --- | --- |
| `led-breadboard.netlist.json` | Parts mounted `on` a breadboard: their legs share strips, and the battery wires into free holes. Also a value, wire colors and cable ends. | 1 |
| `esp32-bme280.netlist.json` | Two-pin nets wired pin to pin, so no breadboard is needed. Also a group and a note. | 5 |
| `battery-switch.netlist.json` | A power chain through a switch. The IP5306's B- and 5V- are joined inside the part and wired as one node, so ground chains with no distribution point. | 3 |
| `tilt-sensors-8.netlist.json` | A `repeat` with explicit bindings (8 copies) and a shared ground. Each block of copies gets local rail strips (`DP1` to `DP3`), joined to the netlist's rail strip BB1. `render --focus tilt_1` frames one copy. | 44 |
| `spirit-typewriter/` | A large design split into four sheets along real connectors. Each sheet is laid out from a partial with `layout --keep`. See its `README.md`. | 302, 565, 545, 543 |

## Warnings

- `led-breadboard`: none.
- `esp32-bme280`: none.
- `battery-switch`: none.
- `tilt-sensors-8`: none.
- `spirit-typewriter/1-main`: one `outputs-fight` warning on MISO, because DS1, DS2 and SD1 all drive it. This is expected for a shared SPI bus, where each device releases MISO while its CS pin is high. Present it to the user as normal for SPI (see "Reading the gate" in `SKILL.md`).
- The spirit-typewriter bank sheets: none.

Every gate also prints the same "not checked" list: current and heat, bus addresses, floating configuration inputs, firmware, timing, mechanical fit, mains, and the correctness of each part beyond its sources. Pass that list on every time.
