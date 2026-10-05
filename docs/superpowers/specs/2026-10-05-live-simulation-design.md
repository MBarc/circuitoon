# Live DC simulation: design

Status: revision 1, sections approved by Michael on 2026-10-05. Not yet reviewed by Astra. This is the second V2 sub-project, after mains outlets; instruments, V3 animation and firmware come later.

Inputs:
- the engine spike on branch `spike-spice` (`.superpowers/spice-spike-report.md`, 2026-10-04);
- Astra's simulation decision of 2026-10-04: a shared circuit model with ngspice-WASM as the first backend;
- Michael's answers:
  - scope is **real boards**, not textbook parts only;
  - current draw comes from **datasheet values with category estimates as fallback**, overridable per part;
  - GPIO state is **set per pin and saved**;
  - results are shown with **probes**.

## 1. Goal

Turn on Simulate and the sheet is solved as a DC circuit. You see:
- LEDs glowing (or burnt);
- rails sagging or browning out;
- regulators in dropout;
- shorts and over-rated parts, flagged on the part.

You place multimeter-style probes on the wires and parts you care about, and they keep their readings. Agents get the same numbers from `circuitoon sim` and from `gate`.

It must work on Michael's Spirit Typewriter sheet:
- an IP5306 boost module fed by four 18650 holders in parallel, through a KCD1 rocker switch;
- an ESP32 DevKit V1 (30-pin), an SSD1306 OLED, two ST7796S 4" SPI touch LCDs and three CJMCU-2317 (MCP23017) expanders;
- one LED with resistors.

That sheet must solve, with sourced or explicitly estimated draw for every powered part.

**Out of scope:** transient analysis and waveforms; animation beyond LED glow and burnt LEDs; firmware; AC and mains in the solver; current per drawn wire (as PRD V2 already says).

## 2. Architecture

```
diagram + library ──netlist()──► src/sim/build.ts ──Circuit──► src/sim/spice.ts ──text──► Engine ──raw──► src/sim/results.ts ──SimResult──► UI / CLI / gate
                                     ▲                                                         │
                                 module electrical data                              ngspice WASM (Worker in the browser, in-process in Node)
```

- **`src/sim/model.ts`:** the engine-neutral types: `Circuit`, `Device`, `SimResult`, `SimFinding`, `Engine`. These are the spike report's types, with the changes below. This layer has no knowledge of SPICE.
- **`src/sim/build.ts`:** builds a `Circuit` from the netlist and the modules. It is pure and deterministic, and it is where every modelling decision lives (section 4). Merges and unsimulated parts are recorded here.
- **`src/sim/spice.ts`:** compiles a `Circuit` to SPICE text.
  - It is a pure function that also returns a name map from SPICE elements back to device and part ids.
  - It never emits R = 0; zero-ohm elements are node merges done in `build.ts`.
  - Element names are sanitised (`R_p12`, `D_p3_led`), and nets are renamed `n1..nN` so that user net names never reach the SPICE parser.
- **`src/sim/engine/`** holds the adapters:
  - `ngspice.ts` is the shared core: it runs `op`, reads vectors, handles `remcirc`, the timeout and failure detection.
  - `worker.ts` is the browser Worker.
  - `node.ts` runs in-process for the CLI.
  - The interface is `Engine { init(); run(c: Circuit, a: {kind: 'op'}): Promise<RawResult>; dispose() }`. Only `op` exists in this slice; `Analysis` stays a union so transient can be added later.
- **`src/sim/results.ts`:** maps the raw output to a `SimResult`, mapped back to parts (section 5).
- **`src/sim/session.ts`:** the solve loop shared by the editor and the CLI.
  - It holds the latest-wins request queue: at most one solve in flight and one pending, and newer edits replace the pending one.
  - It runs the PWM high and low pair (section 4.6) and the typical and peak pair (section 4.4).
  - It combines their results.
- **The existing checker (`src/format/checks.ts`) is unchanged and runs independently.**
  - Simulation adds numeric findings beside it and never suppresses a checker finding.
  - Where both describe the same fault (for example a short), the editor shows both, under their own codes.
  - Mains nodes never enter the solver, matching the mains spec section 3.

### 2.1 Vendored engine

- `scripts/vendor-ngspice.mjs` builds `public/sim/ngspice.wasm` and `src/sim/engine/ngspice-glue.js` from **eecircuit-engine 1.8.0, pinned exactly**:
  - it extracts the embedded WASM once, not twice;
  - it drops the PDK model cards;
  - it patches the loader to `fetch` the `.wasm` by URL in the browser and read it from disk in Node.
- The target is about 2 MB gzip. The result is committed, so the build doesn't depend on npm at deploy time. The script is re-runnable and checks the package's SHA-512 integrity.
- The adapter uses the wrapper's private `commandList` for `remcirc`. A **contract test** pins that behaviour (section 9), so a version bump that breaks it fails loudly.
- **Licence:**
  - `public/sim/NOTICE.txt` carries the ngspice BSD-3 text, the LGPLv2+ text for `numparam` and links to the ngspice source and to the vendoring script;
  - the About dialog and the README link to it;
  - the `.wasm` stays a separate, replaceable file.
- The plugin ships the same `.wasm`, about 6 MB raw, at `plugin/dist-cli/ngspice.wasm`, so the CLI works offline.

### 2.2 Engine lifecycle (browser)

- **Loading:** the Worker and the `.wasm` load only when Simulate is first turned on. The editor never waits on them.
- **Instances:** there is one ngspice instance per Worker, since a second instance hangs the first.
- **`remcirc`:** each run is `source` + `op` + read + `remcirc`.
- **Recycling:** the Worker is terminated and recreated after 2,000 solves, or once the WASM heap passes 128 MB, whichever comes first. It is recreated between solves, never during one.
- **Timeout:** 5 s per solve. A timed-out Worker is terminated and recreated once; a second timeout shows the engine-failure banner (section 6.5).
- **Failure detection:** `runSim()` resolves even when it fails. An `op` with no data vector is a failure, and its `getError()` text is kept as `raw` for the debug details.

## 3. Module data

### 3.1 Split of `electrical.params`

`electrical` gains three optional maps, each `Record<string, ParamSpec>` with `ParamSpec = { unit, default?, min?, max?, source?, provenance? }`:

| Group | Who uses it | Examples |
|---|---|---|
| `values` | the user edits them per part on the sheet (`parts[].values`) | resistance, capacitance, battery voltage, LED colour, `forwardVoltage` |
| `modelParams` | the solver; rarely edited | diode IS/N/RS, battery `rInternal`, regulator `dropout`/`iq`, GPIO `outputResistance` |
| `ratings` | the result mapper compares against them; never sent to the solver | `maxCurrent`, `absMaxCurrent`, `maxPower`, `vinMax`, `ioutMax` |

**Migration:**
- The validator accepts both the old `params` and the new maps for one format generation.
- `scripts/migrate-electrical.mjs` moves every built-in module to the new maps and is run once in this slice.
- The editor and the checker read through one accessor, `paramsOf(module)`, which merges old and new.
- A user's custom part with old `params` keeps working.
- There is no drift: the migration is a shape change with identical values, and `moduleDrift` treats `params` and the merged maps as equal.

### 3.2 Power data per module: `electrical.power`

```ts
interface PowerSpec {
  // Current this part draws from each of its supply pins (a load), at the pin's nominal voltage.
  draw?: { pin: string; typical: number; peak?: number; minVolts?: number; note?: string;
           source?: string; provenance: 'datasheet' | 'estimate' }[]
  // On-board regulators and converters: input pin(s) to output pin.
  rails?: { from: string[]; to: string; kind: 'ldo' | 'buck' | 'boost' | 'switch';
            vout: number; dropout?: number; iq?: number; ioutMax?: number; efficiency?: number;
            vinMin?: number; vinMax?: number; reverse?: 'blocks' | 'conducts';
            minLoad?: { amps: number; note: string };
            source?: string; provenance: 'datasheet' | 'estimate' }[]
  // A source part: battery, cell, adapter output. Batteries already have `voltage`.
  source?: { pin: string; ret: string; rInternal?: number; imax?: number; source?: string; provenance: 'datasheet' | 'estimate' }
}
```

- **`draw`** is the board's own consumption, MCU and peripherals, not what its GPIOs source; GPIO current is solved (section 4.6). Without `minVolts`, a load counts as browned out below 90 % of its pin's nominal supply.
- **`rails`** describes how power moves inside a board. Examples:
  - the DevKit's `5V` (VIN) feeds an LDO that makes `3V3`;
  - the IP5306's `BAT` boosts to `5V OUT`, with `minLoad` for its light-load auto shutdown (about 45 mA for 32 s per the datasheet; this is to be sourced).

  A `switch` rail is a load switch or an on-board diode, and models a pass element.
- **`source`** adds internal resistance, so a battery sags under load; that is what makes brown-out real.

### 3.3 GPIO electrical data

These are module-level `modelParams` on MCU modules, with the same values for every GPIO unless a pin overrides them with its own `caps`:
- `outputResistance` (ohms; datasheet drive strength converted to a resistance, or an estimate);
- `pullupResistance` and `pulldownResistance`;
- `inputLeakage`.

Ratings are `pinMaxCurrent` and `pinAbsMaxCurrent`, plus a package total `ioMaxCurrent` where the datasheet gives one.

### 3.4 Sourcing

**Sourced and independently verified in this slice** (two reviewers, a datasheet link on every number; the rule "a wrong number is worse than a missing one" applies as it does to pins):
- the battery holders (18650, AA family) and coin cells, for `rInternal` and `imax`;
- `ip5306-usbc-module`;
- `esp32-devkit-v1-30` and `esp32-devkitc-v4`;
- `oled-ssd1306-096-i2c`, `lcd-st7796s-4in-spi-touch` and `mcp23017-cjmcu-2317`;
- `ams1117-33-module`, `led`, `resistor` and `rocker-switch-kcd1`;
- the Arduino Uno and Nano, and the Pi Pico.

**Every other powered module** falls back to this estimate table. It applies only when the module has no `power.draw`, and every use is flagged `estimate` in results:

| Category (`electrical.model`) | Typical | Peak | Note |
|---|---|---|---|
| `mcu`, ESP32/ESP32-S3 class | 80 mA | 500 mA | Wi-Fi transmit bursts |
| `mcu`, ESP32-C3/C6 class | 30 mA | 350 mA | |
| `mcu`, AVR/RP2040 boards | 25 mA | 60 mA | |
| `display`, OLED | 15 mA | 40 mA | all pixels on |
| `display`, TFT with backlight | 60 mA | 120 mA | backlight dominates |
| `sensor`, `breakout` | 2 mA | 10 mA | |
| `radio` | 30 mA | 250 mA | |
| `converter`, `regulator` | own `iq` 5 mA | | |
| anything else powered | not simulated as a load | | listed in `unsimulated` with reason "no power data" |

The class within `mcu` is chosen by module id prefix. That choice lives in one table in `src/sim/estimates.ts`, so a sourced number replaces an estimate in one place.

### 3.5 Per-part overrides on the sheet

`parts[].values` may carry `drawTypical` and `drawPeak` (unit A) to override the library draw on one part. It is an additive key, with the same validation as other values. Results then mark the part's provenance as `user`.

## 4. How parts become devices

| Part | Compiled as |
|---|---|
| Resistor | `R` from `values.resistance`. 0 ohm becomes a node merge. |
| LED | `D` with a per-colour `.model` (IS, N, RS) fitted so V = `forwardVoltage` at 20 mA. `forwardVoltage` stays the user knob: changing it refits IS with N and RS held. The fit table is in `src/sim/ledModels.ts`, with a test per colour. |
| Battery, cell, holder | `V` in series with `rInternal`. Holders in parallel are solved as such (no special case). |
| Switch, button, rocker, jumper | Closed: node merge. Open: no element. Position comes from `parts[].values` as today. |
| Fuse | Node merge (intact). Over its rating: a finding, no state change in this slice. |
| Capacitor | Open at DC (no element; ngspice's gmin keeps lone nodes solvable). |
| Inductor | Node merge at DC. |
| Board or module with `power.draw` | A **voltage-aware load** per supply pin: `B` current source `I = typical * min(1, max(V, 0) / (0.9 * Vnom))` to the board's ground pin, so a dead rail draws nothing instead of driving the node negative. |
| `power.rails` `ldo` | Behavioural: output `B` source `V = min(vout, max(V(in) - dropout, 0))` behind an ideal diode so it cannot sink (`reverse: 'blocks'`). Input current = output current + `iq`, through a current-controlled source. |
| `power.rails` `buck` and `boost` | Output `V = vout` when `vinMin <= V(in) <= vinMax`, else 0 (smoothed over 50 mV so Newton converges). Input current = `V(out) * I(out) / (efficiency * V(in))` via a `B` current source. |
| `power.rails` `switch` | Diode or small resistance from `from` to `to`, per its data. |
| GPIO pin | By its sim state (4.6). |
| USB link with a powering host | A 5 V source at the device port's `vbus` pin (through a Schottky when the board declares `diode`), with the host's sourced current as a rating. |
| AC-DC converter output | A DC source at its rated output **only when the mains checker says the converter is powered** (mains spec section 1); otherwise no element. |
| Breadboards, net labels, connectors, Wago | Node merges (already one net in `netlist()`). |
| Anything else | Not simulated: its pins are open, and it is listed in `unsimulated` with a reason. |

### 4.1 Ground

ngspice node `0` is chosen deterministically:
1. the net of the return pin of the source with the most current capacity; then
2. ties are broken by part uid.

A circuit with several separate islands gets one ground per island, each joined to `0` through 1 GΩ so the matrix stays solvable. Voltages are reported relative to each island's own reference, and the probe UI says so ("relative to battery −").

### 4.2 Parts with no data are open, never guessed

This is the rule that keeps the solver honest. A part with no model and no power data never adds current. The budget then shows "incomplete: N parts have no power data", and `gate` notes it.

### 4.3 Determinism

The same sheet always compiles to byte-identical SPICE text: devices are sorted by part uid, then by terminal. Results are rounded for display only, never in `SimResult`.

### 4.4 Typical and peak

Each solve runs twice: once with every load at `typical`, once at `peak`. Rails, batteries and LEDs report both. Brown-out and dropout at peak are **warnings**, labelled with the peak's note ("at peak: Wi-Fi transmit"). At typical they are **errors**.

### 4.5 Combined solves

- With no PWM pins, a solve is 2 runs (typical and peak).
- With PWM pins it is 4 runs (typical and peak, each with PWM all high and all low).

Every run is about 3 ms, so a 4-run solve still fits in one frame.

### 4.6 GPIO sim state

A pin's state lives in `parts[].values` as `gpio.<pin>`: `"input"` (default), `"input-pullup"`, `"input-pulldown"`, `"high"`, `"low"` or `"pwm:<duty 0..100>"`. This is additive, and the validator rejects any other string.

| State | Compiled as |
|---|---|
| `high` | A source equal to the board's IO rail voltage (the pin's `supply`, e.g. 3V3), in series with `outputResistance` |
| `low` | The board's ground through `outputResistance` |
| `input` | `inputLeakage`, or nothing |
| `input-pullup` / `input-pulldown` | `pullupResistance` / `pulldownResistance` to the rail or ground |
| `pwm:<duty>` | Solved high and low. Reported average current = duty × high + (1 − duty) × low. Ratings are checked against the high-run current (the peak). LED glow uses the average. |

- Only pins with `caps` marking them as GPIO accept these states. Input-only pins (ESP32 34 to 39) reject `high`, `low` and `pwm` in validation, reusing the pin rules.
- The IO rail comes from the pin's `supply`. On a board with `rails`, that rail's simulated voltage is used, so an ESP32 brownout also drops its GPIO high level.

## 5. Results and findings

### 5.1 `SimResult`

```ts
interface SimResult {
  format: 'circuitoon-sim/1'
  ok: boolean                                     // false only when the engine failed
  corner: { typical: Run; peak: Run }             // Run = { nets: Record<NetName, number>, parts: Record<PartUid, PartReading> }
  budget: RailBudget[]                            // per source and per rail: volts, amps typical/peak, limit, headroom
  findings: SimFinding[]
  unsimulated: { part: string; reason: string }[]
  provenance: Record<PartUid, 'datasheet' | 'estimate' | 'user' | 'none'>
  probes: ProbeReading[]                          // section 6.2
  engine: { name: 'ngspice'; version: string; ms: number }
}
interface PartReading { current: Record<PinName, number>; power: number; state?: 'lit' | 'dark' | 'burnt' }
interface SimFinding { code: SimCode; severity: 'error' | 'warning' | 'note'; parts: string[]; message: string; corner?: 'typical' | 'peak'; raw?: string }
```

- **Nets** use the names `netlist()` gives them, which are the same names the CLI already prints.
- **Current sign:** current is positive into the pin.

### 5.2 Finding codes

| Code | When | Severity |
|---|---|---|
| `sim-short` | A source or rail current above max(20 A, 10 × its `imax`). Or a node merge that joins two sources whose open-circuit voltages differ by more than 0.1 V (left to the checker when it already reports it). | error |
| `sim-burnt` | An LED or resistor over its `absMaxCurrent` or `maxPower`. Defaults when unrated: LED 1.5 × `maxCurrent` (marked `estimate`), resistor 0.25 W × 2. The LED's state becomes `burnt`. | error |
| `sim-over-rating` | Over `maxCurrent`, `maxPower`, `ioutMax`, `pinMaxCurrent`, `ioMaxCurrent` or a USB host's sourced current, but under burnt. | warning |
| `sim-brownout` | A load's pin under its `minVolts` (or 90 % of nominal). | error at typical, warning at peak |
| `sim-dropout` | An LDO with `V(in) - V(out)` under `dropout` + 20 mV, i.e. out of regulation. | error at typical, warning at peak |
| `sim-converter-off` | A buck or boost input outside `vinMin`..`vinMax`. | error |
| `sim-min-load` | A rail with `minLoad` loaded below it, e.g. the IP5306 shutting off. | warning |
| `sim-floating-input` | A GPIO in `input` state whose net has no DC path to any source or ground (the engine's "singular" diagnosis or a gmin-only node). | warning |
| `sim-no-convergence` | ngspice failed after its own fallbacks. The message names the parts on the nets ngspice reported, and `raw` holds its text. | error |
| `sim-incomplete` | One or more powered parts have no power data. | note |
| `sim-estimate` | The budget uses estimated draw for N parts. | note |

**Estimates never block.** A `sim-brownout`, `sim-dropout`, `sim-over-rating` or `sim-converter-off` whose rail carries any `estimate` draw is reported at most as a **warning**, with "based on estimated draw for: ...". Re-solving with every estimated load at 0 decides it: if the finding still fires, it keeps its normal severity, since sourced data alone causes it.

**Messages** are plain words, e.g. "LED1 carries 47 mA, above its 20 mA rating. It would burn out. Add a resistor (about 68 ohm at 3.3 V)." There is no SPICE vocabulary; `raw` keeps the engine's text for a details disclosure.

## 6. Editor

### 6.1 Simulate toggle

- **The control:** a toolbar button, Simulate (shortcut `S`).
- **Turning it on:** loads the engine, with a determinate progress indicator for the first download. It then solves on every diagram change, coalesced to one solve per animation frame through the session's latest-wins queue.
- **Turning it off:** clears all live state.
- **Never saved:** glow, burnt and readings. Probes and GPIO states are saved.
- **Editing stays available while simulating.** Dragging a part re-solves only when connectivity or values change, never on a pure move.

### 6.2 Probes (chosen option C)

- **Placing:** the Probe tool (`P`) clicks a wire, a pin or a part.
  - On a wire or pin it is a voltage probe, reading against the island's ground.
  - Shift-clicking a second point makes a differential probe (V between the two).
  - On a part it is a current probe: the current into each pin, plus power.
- **Saving:** probes are stored in a new optional top-level field. It is additive to `circuitoon-diagram/1`, since unknown top-level fields already load:
  ```json
  "probes": [ { "id": "P1", "name": "battery +", "at": { "part": "u3", "pin": "+" } },
              { "id": "P2", "at": { "part": "d1" } },
              { "id": "P3", "at": { "wire": "w12" }, "ref": { "part": "u3", "pin": "-" } } ]
  ```
  Validation:
  - ids are unique, `P` plus an integer;
  - `at` and `ref` name an existing part, pin or wire;
  - a dangling probe gives a warning and is dropped, never an error.
- **Drawing:**
  - Each probe is a coloured lead from its point to a reading tag, with colours from a fixed eight-colour order.
  - Tags avoid parts and each other using the existing label placement.
  - With Simulate off, the tag shows the probe name and "-".
- **The Probes panel** (right side; it replaces the inspector tab while the Probe tool is active) holds:
  - the list of readings, with typical and peak shown as "4.38 V (peak 4.21 V)";
  - rename and delete for each probe;
  - the **Supplies** section: each source and rail with load against limit as a bar, typical and peak, and headroom;
  - the incomplete and estimate notes, with the list of parts.
- **Agents** add probes in the netlist JSON. `layout` keeps them, and `render` draws them with readings when given `--sim`.

### 6.3 Always on the sheet while simulating

- **LED glow:** brightness follows current, on a log scale with full brightness at `maxCurrent`; the colour comes from `values.color`.
- **Burnt LED:** turns dark grey with the existing error badge.
- **Finding badges** on parts reuse the checker's badge component, with sim codes in the same list. Clicking one selects the parts.
- **Clicking a switch or button while simulating** flips it. A button is momentary: held while the mouse is down. The switch's saved position changes only for switches, not buttons.
- **Clicking a GPIO pin while simulating** cycles input, high, low. The full state list, including PWM, is in the inspector.

### 6.4 Accessibility and performance

- Readings are text, not colour alone.
- Probe colours meet 3:1 contrast against both themes.
- Reduced motion turns off the glow flicker. There is no flicker by default anyway.
- The 200-part fixture with Simulate on keeps drag at 60 fps; a perf test enforces it.

### 6.5 Failure

- If the engine fails to load, a banner says "Simulation could not start (reason). Retry". The editor is unaffected.
- A `sim-no-convergence` result keeps the last good readings, shown dimmed and marked "stale".

## 7. Agents: CLI, gate, plugin

- **`circuitoon sim <sheet|netlist> [--probe <net|part[:pin]>]... [--corner typical|peak]`** prints `SimResult` as JSON, with a short human summary on stderr. Exit codes follow the existing convention:
  - 0: no errors;
  - 1: any error finding;
  - 2: bad input;
  - 3: the engine failed.
- **`gate`** becomes `circuitoon-cli/gate/4`:
  - it adds a `sim` block (findings, budget and provenance counts);
  - `sim-short`, `sim-burnt`, `sim-brownout` and `sim-dropout` at typical, and `sim-converter-off` and `sim-no-convergence`, make it **not ready**;
  - peak warnings, `sim-over-rating` and the notes go into `notes`;
  - gate/3 readers keep working, because the new block is additive and only the format string changes.
- **`explain`** gains the module's power data and provenance.
- **`render --sim`** draws glow, burnt LEDs, probes and readings.
- **The `circuitoon-design` skill** adds a step: set GPIO states for what the firmware does, run `sim`, fix every error, then hand over. Its reference documents `gpio.<pin>`, `probes` and the draw overrides.
- **The plugin version** goes to 0.10.0 (a new command and data fields).

## 8. Performance and size budgets

| Item | Budget |
|---|---|
| Engine download (gzip) | ≤ 2.5 MB, fetched only on the first Simulate |
| Cold start in the browser | ≤ 1.5 s on the dev machine, with progress shown |
| Combined solve (2 to 4 runs), 200 parts, Worker end to end | p95 ≤ 30 ms |
| Worker heap after 1,000 solves | ≤ 64 MB above baseline |
| Editor main bundle | at most +30 KB gzip (the engine is never in it) |
| CLI `sim` on the Spirit Typewriter sheet, cold | ≤ 2 s |

## 9. Testing

- **Compiler golden tests:** each device kind, merges, ground selection, islands and name sanitisation (a net named `0`, `gnd`, or with spaces and quotes).
- **Accuracy:**
  - LED + 150 Ω + 5 V gives V(anode) = 2.0008 V ± 1 mV;
  - a battery with `rInternal` under load matches Ohm's law;
  - an LDO in and out of dropout;
  - a boost converter's input current matches the efficiency;
  - a voltage-aware load on a dead rail draws 0.
- **Findings:** one test per code, both ways (fires and stays quiet), including:
  - an LED on a GPIO with no resistor (`sim-burnt` or over-rating, depending on `outputResistance`);
  - a 0 Ω jumper across a battery (`sim-short`);
  - the IP5306 under its minimum load;
  - the ESP32 on 3xAA through an AMS1117 (dropout at peak);
  - a floating GPIO input;
  - two islands.
- **Engine contract test:** loads the vendored engine, runs `remcirc`, and fails if eecircuit's private `commandList` behaviour changes.
- **Memory:** 1,000 solves in a Worker, with the heap within budget.
- **Spirit Typewriter fixture:** the sheet in `src/sim/fixtures/` solves; every powered part has `datasheet` provenance; rail voltages match hand calculations recorded in the test.
- **Determinism:** the same sheet compiles to the same text twice, and after a save and reload.
- **Visual:** Playwright with our own Chrome, never the Playwright MCP. Screenshots in light and dark of probes (voltage, differential, current), glow at three currents, a burnt LED, a brown-out badge, the Supplies section, the failure banner and stale readings. Each is reviewed by eye.
- **Perf:** the 200-part drag with Simulate on, and the solve p95 in a Worker.

## 10. Delivery and review checkpoints

Michael asked for Astra to be consulted along the way. Each checkpoint below gets an Astra review before work continues, and the findings are acted on or answered with reasons.

1. **This spec:** Astra review, then Michael review.
2. **The implementation plan:** Astra review.
3. **Engine and model:** the vendored engine, `model.ts`, `build.ts`, `spice.ts`, the Node adapter, and the accuracy and contract tests. Astra reviews.
4. **Data:** the electrical split and migration, `power` and GPIO data, and the sourced numbers for section 3.4's list. These get independent verification (two reviewers), then an Astra review of the modelling choices.
5. **Results:** `results.ts`, the session, `circuitoon sim` and gate/4. Astra reviews.
6. **Editor:** the toggle, probes, panel, glow, badges and interactions, with visual validation. Then a whole-branch Claude review, an Astra review, and ship.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Datasheet draw numbers are wrong or mislabelled | Two independent reviewers, a link per number, and `estimate` shown wherever it isn't sourced |
| Behavioural regulator and converter models do not converge | Smoothed transitions, ngspice's gmin and source stepping, and a golden test per model; non-convergence names the parts |
| eecircuit-engine's private API changes | The version is pinned exactly; the engine is vendored and committed; a contract test; replace with our own `--with-ngshared` build later (needed for firmware anyway) |
| Load models hide real failures (a constant draw hides a reset loop) | Brown-out is an error at typical; the peak corner shows the Wi-Fi burst case; per-part overrides let a user model a known mode |
| Users read estimates as facts | Provenance on every reading; `sim-estimate` note; estimates never make `gate` not ready on their own |
| Probes clutter big sheets | Probes are opt-in, and tags use the existing collision-avoiding placement |
