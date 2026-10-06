# Live DC simulation: design

Status: revision 5 (2026-10-05).
- Revision 1 was approved section by section by Michael.
- Astra reviewed revisions 1 and 2: section 12 answers the first review, section 13 the re-review.
- Codex hit its usage limit during Astra's review of revision 3, so a Claude reviewer reviewed it instead; section 14 answers that review.
- Astra re-reviews after its reset (Oct 10).
- Revision 5 folds in the amendments an independent review of the implementation plan required; section 15 lists them.

This is the second V2 sub-project, after mains outlets. Instruments, V3 animation and firmware come later.

Inputs:
- the engine spike on branch `spike-spice` (`.superpowers/spice-spike-report.md`, 2026-10-04);
- Astra's simulation decision of 2026-10-04: a shared circuit model with ngspice-WASM as the first backend;
- Michael's answers:
  - scope is **real boards**;
  - current draw comes from **datasheet values with flagged category estimates as fallback**, overridable per part;
  - GPIO state is **set per pin and saved**;
  - results are shown with **probes**.

## 1. Goal

Turn on Simulate and the sheet is solved as a DC circuit in its **current state**: switch positions and GPIO states as saved. You see:
- LEDs glowing;
- rails sagging or browning out;
- regulators in dropout;
- shorts and over-limit parts, flagged on the part.

You place multimeter-style probes on pins and parts, and they keep their readings. Agents get the same numbers from `circuitoon sim` and from `gate`.

It must work on Michael's Spirit Typewriter sheet:
- an IP5306 boost module fed by four 18650 holders in parallel, through a KCD1 rocker switch;
- an ESP32 DevKit V1 (30-pin), an SSD1306 OLED, two ST7796S 4" SPI touch LCDs and three CJMCU-2317 (MCP23017) expanders;
- one LED with resistors.

**Out of scope:**
- transient analysis and waveforms;
- **PWM** (cut on Astra's advice: a high/low pair is not a sound average and can hide sinking overloads; it returns with transient);
- animation beyond LED glow;
- firmware;
- AC and mains in the solver;
- current per drawn wire.

## 2. Architecture

```
diagram + library ─► src/sim/build.ts ─Circuit─► src/sim/spice.ts ─text+map─► Engine (Worker) ─raw─► src/sim/results.ts ─SimResult─► UI / CLI / gate
                         ▲    ▲
          module sim data    src/sim/floating.ts (DC-path classification, before solving)
```

- **`src/sim/model.ts`:** the engine-neutral types.
  - A `Device` keeps its **component identity and its full values**, including capacitance, inductance and contact resistance, whatever the analysis.
  - Reducing a part for DC (capacitor open, inductor as its DC resistance) happens in the compiler, per analysis. Only `op` exists in this slice, and `Analysis` stays a union so transient can be added later.
- **`src/sim/build.ts`:** builds a `Circuit` from the diagram and the modules. It is pure and deterministic, and it holds every modelling decision (section 4).
  - It starts from **every terminal of every simulated part**, including singleton pins that `netlist()` omits.
  - Net names: the nets `netlist()` produces are named exactly as `extract` names them (`sheetNets()`, which uses the shared `nameNets()` in `src/format/netNames.ts`). Singleton pins that `netlist()` omits are named separately as `<ref>_<pin>`, and never go through `nameNets()`. Labels, `GND` and supply-rail names (`5V`, `3V3`) are the same in the CLI, `extract`, KiCad and the simulator (the Claude reviewer's finding 2). Fallback names (`<ref>_<pin>`) may differ in KiCad: it names nets over its own components (an ESP32's header strips `U1A`/`U1B`, refs in KiCad's form) and sanitises every name (`kicadNetName`).
- **`src/sim/floating.ts`:** before solving, a graph pass classifies every node as `driven` (it has a DC path to a source) or `floating`.
  - Capacitors and open switches do not conduct for this pass. Nor do input-leakage resistors, loads, or a rail's return path (revision 5): **driven** means reachable from a source's + terminal or a rail output through the other conducting elements. A board behind an open switch is unpowered even when its ground is shared, and an input held only by its leakage floats.
  - Floating nodes are never reported as a voltage. Their probes and readings say "floating", whatever number the solver returns for them.
- **`src/sim/spice.ts`:** the compiler. It is pure, and returns the SPICE text plus a name map back to device and part ids.
  - It never emits R = 0.
  - Element names are sanitised (`R_p12`), and nets are renamed `n1..nN` so that user names never reach the SPICE parser.
  - The same circuit always gives byte-identical text: devices are sorted by part uid, then by terminal.
- **`src/sim/engine/`** holds the adapters.
  - `ngspice.ts` is the shared core: it runs `op`, reads vectors, handles `remcirc` and detects failures.
  - **It always runs inside a terminable worker**: a Web Worker in the browser, a `worker_threads` Worker in Node. A timeout terminates the worker; nothing synchronous runs on a thread that has to be interrupted.
  - The interface is `Engine { init(); run(c, analysis, revision): Promise<RunOutcome>; dispose() }`.
- **`src/sim/results.ts`:** maps the raw output to a `SimResult`, mapped back to parts (section 5).
- **`src/sim/session.ts`:** the solve loop shared by the editor and the CLI.
  - Every request carries the diagram **revision**. A result for an older revision, or one that arrives after Simulate was turned off, is discarded.
  - There is at most one solve in flight and one pending; a newer edit replaces the pending one.
  - Each solve runs the typical and peak corners (section 4.5): 2 engine runs.

### 2.1 Relation to the existing checker

The checker (`src/format/checks.ts`) is unchanged, and **it never suppresses or is suppressed by simulation**. The two answer different questions:

| | Checker | Simulation |
|---|---|---|
| Question | Is this wiring safe in **any** switch position and with declared external power? | What happens **now**, in the saved switch and GPIO state, with actual hosts plugged in? |
| Findings | its existing codes | `sim-*` codes only |
| Editor | the "Wiring checks (any switch position, external power assumed)" group | the "Simulation (current state)" group |

- Both can report the same short. Each reports it under its own code, in its own group.
- `circuitoon sim` reports simulation findings only. `gate` reports both (section 7).
- Mains nodes never enter the solver (mains spec section 3).

### 2.2 Engine build and licence

**We build our own WASM from pinned source in this slice.** We do not extract the binary from the npm package, because then we could not name the exact corresponding source (Astra finding 14). The firmware co-simulation build needs our own build later anyway.

- **`engine/ngspice/`** holds the build:
  - a Dockerfile, plus `build.sh`, adapted from eecircuit-engine's MIT-licensed `Docker/run.sh` at a pinned commit;
  - the pinned ngspice release (45.2) tarball URL and its SHA-256;
  - our patches as `.patch` files;
  - the exact emsdk version.
- **Build mode: ngspice as a shared library, with XSPICE, now.** We configure `--with-ngshared --enable-xspice --disable-osdi`, so the engine isn't rebuilt when firmware co-simulation arrives (the Claude reviewer's finding 7; Michael does not want to repeat work).
  - Exported: `ngSpice_Init`, `ngSpice_Command`, `ngGet_Vec_Info`, `ngSpice_CurPlot`, `ngSpice_AllVecs` and `ngSpice_SetBkpt`, plus `addFunction` for the callbacks (`GetVSRCData` later).
  - Commands run synchronously (`ngSpice_Command("op")`, never `bg_run`), so there are no threads, no SharedArrayBuffer and no COOP/COEP headers.
  - Vectors are read through `ngGet_Vec_Info`, never by parsing stdout.
  - There are no PDK models.
  - The loader fetches a separate `ngspice.wasm` by URL in the browser and reads it from disk in Node.
- **Fallback ladder** (revision 5), decided at the engine checkpoint, not later. Rung 1 is the shared library with XSPICE (above). Rung 2, tried automatically when rung 1 cannot be made to build: the shared library without XSPICE (`--with-ngshared --disable-xspice`); the exports, the adapter and everything after them stay the same, and XSPICE is recorded as debt in the ledger. Rung 3, only if rung 2 fails too: the executable build (`--disable-xspice`, as in eecircuit); this rung means stop and redesign the adapter.
- The output is committed to `public/sim/` and `plugin/dist-cli/`. `npm run engine:build` rebuilds it in Docker and runs the engine smoke tests. Byte-identical rebuilds are not required (emsdk builds are rarely reproducible); the release asset records the inputs instead.
- **The JS wrapper** is our own small adapter over the exported C API. It does not depend on eecircuit-engine at run time.
- **Licence compliance:**
  - `public/sim/NOTICE.txt` and the About dialog list ngspice's licences as found in the built configuration. The build script prints the compiled-in source directories; every non-BSD component found there is listed with its licence, and `numparam` (LGPLv2+) is expected.
  - **Each engine version is published as a GitHub release asset** on MBarc/circuitoon. The asset contains the exact ngspice source tarball, our patches, the build script and emsdk version, and relinking instructions. NOTICE links to that release, so the source sits beside the binary from the same place.
  - The `.wasm` stays a separate, replaceable file.

### 2.3 Engine lifecycle

- **Loading:** the engine loads the first time Simulate is turned on (or on the first `sim` in the CLI).
- **Instances:** one ngspice instance per worker.
- **Each run:** `source` + `op` + read + `remcirc`.
- **Recycling:** the worker is recycled after 2,000 **engine runs** (not solves), and when the engine is dead (ngspice called its exit, a WASM trap, a timeout, the worker exited), always between runs. An ordinary circuit failure (`ok: false`) keeps the worker (section 15).
- **Timeouts:** 5 s per run. On a timeout the worker is terminated and recreated, and the run is retried once. A second timeout gives `status: 'failed'`.
- **Failures:** an `op` with no data vector is a failure, with `getError()` text kept as `raw`.
- **Tested sequences:** success, then failure, then success on the same worker, plus worker cleanup after a dead engine.

## 3. Module data

### 3.1 Where the new data lives: `electrical.sim`

Revision 1 split `electrical.params` and added `electrical.ratings`. That collides with the existing `electrical.ratings` array (the mains insulation, terminal and switching ratings, e.g. on the KCD1) and with direct `params` readers such as the mains model's `acVoltage`. **Since revision 2, nothing that exists changes.**

- **`electrical.params` keeps its meaning:** the values a user edits per part (resistance, `voltage`, `color`, `forwardVoltage`, `acVoltage`). There is no migration, and no drift.
- **`electrical.ratings` keeps its meaning:** the mains ratings array.
- **Everything new goes under one optional object, `electrical.sim`:**

```ts
interface SimSpec {
  modelParams?: Record<string, Quantity>   // physics: diode IS/N/RS, rInternal, contact resistance, DCR
  limits?: Limit[]                         // what results are compared against (5.2)
  power?: PowerSpec                        // 3.2
  gpio?: GpioSpec                          // 3.3
  usbPorts?: Record<string, { gnd: string }>   // 4.7: a USB pin's ground pin
}

**Node references** in `sim` may name a module pin or a USB port's simulation node, written `<usbPin>#vbus`. Validation accepts both and rejects anything else.
interface Quantity { value: number; unit: Unit; source?: string; provenance: Provenance; note?: string }
type Provenance = 'datasheet' | 'representative' | 'estimate'
interface Limit {
  of: { pin: string } | { domain: string } | { part: true }
  kind: 'current' | 'absMaxCurrent' | 'power' | 'vinMax' | 'vinMin' | 'sourceCurrent' | 'ioTotalCurrent'
  value: number; source?: string; provenance: Provenance; conditions?: string
}
```

- **Provenance is per value, never per part.**
  - `representative` means a value from a representative datasheet for a generic part, for example "a typical 5 mm red LED". The source names which datasheet.
  - A user override (section 3.5) marks only the overridden value `user`.
- **Module parameters** (revision 5): `electrical.params` values, module defaults included, count as `user`: they are the designer's stated values (a 4xAA holder is 6 V because the sheet says so). Only `sim` data carries `datasheet`, `representative` or `estimate`.
- **Legacy values:** the LED's existing `params.maxCurrent` (default 20 mA) is still read as a `current` limit with provenance `representative`, so old embedded modules keep working. If both are present, `sim.limits` wins.
- **Validation:** `electrical.sim` is validated in full. Unknown keys are errors, a unit must match its kind, and every pin and domain it names must exist.
- **Primitives need no `sim` data (Astra re-review B).** The built-in primitive models compile from the existing `electrical.model`, `terminals` and `params` plus defaults, with or without `electrical.sim`, legacy embedded copies included. They are:
  - `resistor`, `potentiometer`, `led`, `voltage_source` (batteries, cells, holders), `capacitor`, `switch`, `fuse`.
- **Batteries:** all 15 built-in `voltage_source` modules gain `sim.modelParams.rInternal` and `sim.limits` `sourceCurrent`, per chemistry. A CR2032 (about 15 Ω) is not an 18650 (about 0.05 Ω). Values are labelled `representative` or `estimate` with the cell assumed. A legacy embedded copy without them uses a voltage-keyed fallback in `src/sim/estimates.ts`, flagged `estimate`:

  | Nominal V | Assumed | rInternal |
  |---|---|---|
  | 2.4 to under 3.0 (coin) | lithium coin | 15 Ω |
  | 1.2 to 1.6 per cell (exactly 3.0 is 2 x AA, 0.3 Ω) | alkaline AA | 0.15 Ω per cell |
  | 3.6 to 4.2 per cell | Li-ion 18650 | 0.05 Ω per cell |
  | 9 | alkaline 9 V | 1.5 Ω |
  | other | unknown | 0.1 Ω, with a note |

  `sim` only adds or overrides values (contact resistance, LED limits, cell `rInternal`).
- **Boards and modules** (every other model) need `sim.power` to be simulated. Without it, they are listed in `unsimulated` ("no power data"); this is never a crash.
- **Required fields and defaults (Astra re-review C):** validation enforces the required fields per kind (section 3.2). A built-in module that lacks one fails `npm run validate`. A custom or embedded part that lacks one is not simulated, with the missing field named.

### 3.2 Power topology: `sim.power`

```ts
interface PowerSpec {
  domains: { name: string; pin: string; ret: string; nominal: number }[]   // named supply domains, explicit return
  draw?: { domain: string; typical: Quantity; peak?: Quantity & { note: string }; minVolts?: Quantity }[]
  rails?: Rail[]
  source?: { domain: string; voltage: 'param:voltage' | Quantity; rInternal: Quantity; imax?: Quantity }
}
interface Rail {
  id: string
  inputs: { domain: string; via: 'direct' | 'diode' }[]   // several inputs: diode-OR (the highest wins) unless 'direct'
  output: string                                            // a domain
  kind: 'ldo' | 'buck' | 'boost' | 'switch'
  vout?: Quantity; dropout?: Quantity; iq?: Quantity; ioutMax?: Quantity; efficiency?: Quantity
  vinMin?: Quantity; vinMax?: Quantity; rout?: Quantity
  reverse: 'blocks' | 'body-diode'                          // output to input path
  offPath?: 'open' | 'diode'                                // buck/boost only: input to output through the inductor and diode when disabled (a boost's pass-through)
  minLoad?: { amps: Quantity; note: string }
  ron?: Quantity; vf?: Quantity                             // for kind 'switch' (load switch or diode path)
}
```

- **Required per rail kind:**

  | Kind | Required | Default when absent (provenance `estimate`) |
  |---|---|---|
  | `ldo` | `vout`, `dropout`, `ioutMax` | `iq` 0 with a note; `rout` 0.1 Ω |
  | `buck`, `boost` | `vout`, `efficiency`, `vinMin`, `vinMax`, `ioutMax` | `rout` 0.1 Ω; `offPath` `open` |
  | `switch` | `ron` or `vf` | none |

  A `draw` without `minVolts` uses 90 % of its domain's `nominal`, labelled `estimate`. Both the fold-back and `sim-brownout` use that value.
- **Domains name a supply explicitly:** a pin, its return and a nominal voltage. Examples on a DevKit are `VIN` (5V pin to GND) and `3V3` (3V3 pin to GND). The existing pin `supply` strings stay what they are: accepted voltage alternatives for the checker, not rail references.
- **`draw`** is a load on a domain: the board's own consumption, not what its GPIOs source (those are solved).
- **Multi-input rails** declare how inputs combine. For example, a DevKit's VIN and USB VBUS both feed the LDO through diodes.

### 3.3 GPIO: `sim.gpio`

```ts
interface GpioSpec {
  domain: string                                  // the IO supply domain, e.g. '3V3'
  pins: string[]                                  // explicit list of GPIO-capable pins
  outputResistance: Quantity; pullup?: Quantity; pulldown?: Quantity; inputLeakage?: Quantity
}
```

- Only listed pins accept a sim state.
- The existing `caps` constrain the states:
  - `inputOnly` rejects high and low;
  - `outputOnly` rejects the input states;
  - `noPullup` (which means no internal pull-up **or** pull-down in this repo) rejects both `input-pullup` and `input-pulldown`.
- **Default state:** a GPIO-capable pin defaults to `input`. An `outputOnly` pin has no admissible default: until a state is set it is open and listed in `unsimulated` ("output-only pin with no state set").
- Pin current limits are `Limit`s on `{ pin }`. The package total is an `ioTotalCurrent` limit on the IO domain.

### 3.4 Sourcing (honest provenance)

**Sourced in this slice**, each number with a link and checked by two independent reviewers:

| Part | What is sourced, and how it is labelled |
|---|---|
| `esp32-devkit-v1-30`, `esp32-devkitc-v4` | Module current from the ESP32 datasheet (chip/module, **labelled "chip, not board"**). The on-board LDO (AMS1117 or the board's actual regulator, identified from the board schematic) and its dropout come from that regulator's datasheet. GPIO drive from the ESP32 datasheet. Board-level extras such as the power LED and USB-UART idle current are added only where a board schematic or measurement supports them; otherwise they are listed as unaccounted. |
| `oled-ssd1306-096-i2c` | SSD1306 datasheet plus the module's own regulator. The pixel-dependent draw is stated as a range, with the conditions. |
| `lcd-st7796s-4in-spi-touch` | Backlight current from the module documentation if it gives one; otherwise `estimate`, with the backlight LED count from the board noted. |
| `mcp23017-cjmcu-2317` | MCP23017 datasheet (chip), with the module's power LED if it has one. |
| `ip5306-usbc-module` | IP5306 datasheet: boost output, efficiency curve at the module's operating point, light-load shutdown, input limits. |
| `ams1117-33-module` | AMS1117 datasheet. |
| `led` | One representative 5 mm datasheet per colour (`representative`). |
| `resistor` | Power limit from its value's package (default 0.25 W, `representative`). |
| `rocker-switch-kcd1` | Contact resistance from the KCD1 datasheet. |
| Battery holders | **The holder is not the cell.** `rInternal` and `imax` are `estimate` values for a generic cell of the holder's chemistry (18650 Li-ion, alkaline AA), with the assumption stated. Users can enter their cell's values on the part (3.5). |
| Arduino Uno and Nano, Pi Pico | As for the ESP32 rows: chip datasheet labelled as chip, and the regulator from the board schematic. |

**Every other powered module** uses `src/sim/estimates.ts` by category, flagged `estimate`. Each row is one place to replace later.

| Category | Typical | Peak | Note |
|---|---|---|---|
| `mcu`, ESP32/ESP32-S3 class | 80 mA | 500 mA | Wi-Fi transmit bursts |
| `mcu`, ESP32-C3/C6 class | 30 mA | 350 mA | |
| `mcu`, AVR/RP2040 boards | 25 mA | 60 mA | |
| `display`, OLED | 15 mA | 40 mA | all pixels on |
| `display`, TFT with backlight | 60 mA | 120 mA | backlight dominates |
| `sensor`, `breakout` | 2 mA | 10 mA | |
| `radio` | 30 mA | 250 mA | |
| anything else powered | not simulated as a load | | listed in `unsimulated` with reason "no power data" |

Estimates apply only to the **load** a part draws. A part with no `sim.power.domains` cannot get an estimate (the estimate needs a domain to attach to). Those parts are listed as unsimulated, and the Spirit list above gets real domains.

The model's **numerical behaviour** below a load's minimum voltage (the fold-back in section 4) is a modelling choice and is labelled as such. It is never presented as datasheet behaviour.

### 3.5 Per-part overrides on the sheet

`parts[].values` may carry, additively:
- `sim.draw.<domain>.typical` and `sim.draw.<domain>.peak` (A);
- `sim.rInternal` and `sim.imax`, for a battery's actual cell;
- `gpio.<pin>` (section 4.6).

Each override marks only its own value `user`.

## 4. How parts become devices

| Part | Compiled as (analysis `op`) |
|---|---|
| Resistor | `R` from `values.resistance`. 0 ohm uses the jumper row. |
| LED | `D` with a per-colour model (IS, N, RS) fitted so V = `forwardVoltage` at 20 mA. `forwardVoltage` stays the user knob (IS is refitted, N and RS held). The table is in `src/sim/ledModels.ts`, with a test per colour. |
| Battery, cell, holder | `V` in series with `rInternal`. Parallel holders solve as such. |
| Potentiometer | Two `R`s, a to wiper and wiper to b, split by `values.position` (0 to 1, default 0.5). Each side has at least 1 Ω. |
| Switch, button, rocker, jumper, 0 Ω resistor, fuse | **A real branch, never a merge** (Astra finding 3). Closed: `R` = contact resistance (`modelParams.contactResistance`; default 20 mΩ, `estimate`). Open: no element. The current through it is measured, so fuse and switch limits can be checked. |
| Capacitor | Emitted as `C` with its value. ngspice treats it as open in `op`, and its plates read "floating" unless driven otherwise (section 2). |
| Relay, SSR | Contacts are in their **rest position** (de-energised: NC closed, NO open), with a note "shown at rest; coil switching is simulated with firmware". The coil is a load only when the module has `sim.power`. |
| Breadboard strips, rails, net labels, connectors, Wago | One node: these are one conductor in `netlist()` already. Their resistance is out of scope. |
| Board load (`draw`) | A **voltage-aware load** per domain: `B` current source from the domain pin to its `ret`, `I = typical * f(V)`, where `f` is 1 above `minVolts` and falls to 0 at 0 V, smoothed as in 4.1. The node can never be pushed negative. This is labelled a model in the results. |
| `ldo` rail | Defined in 4.1. |
| `buck` and `boost` rail | Defined in 4.2. |
| `switch` rail | `R` = `ron`, or a diode with `vf`, from the input domain pin to the output domain pin. |
| GPIO pin | Section 4.6. Current always flows from or to the board's real IO domain node. |
| USB VBUS | Section 4.7. |
| AC-DC converter output | A DC source only when the converter is powered **in the saved contact state** (Astra re-review 11). This uses a new single-state evaluation exported from `src/format/mainsRules.ts`, which applies the mains spec section 1 availability rules to one contact state instead of aggregating over all of them. Otherwise its output is an open circuit. |
| Anything else | Not simulated: its pins are open, and it is listed in `unsimulated` with a reason. |

### 4.0 Saved contact state (the Claude reviewer's finding 1)

Switch positions get a defined home. `parts[].values["contact.<groupId>"]` holds a group's position, where `<groupId>` is an `electrical.contacts` id. It is additive, and validated against the group's kind:
- `switch` (a pole is `com` and `no`): `"open"` or `"closed"`;
- changeover (`com`, `no` and `nc`): `"no"` or `"nc"`.
- **Default:** `"open"`, or `"nc"` for changeover groups. That is the same position the mains model's `groupState` index 0 uses, so both read one value.
- **Legacy sheets:** a part's existing opaque visual state (the module's `states`, e.g. `"on"`) maps to `closed` for single-group switches. Anything ambiguous stays at the default, with a warning.
- Clicking a switch while simulating writes this value. The mains single-state evaluation (section 4 table) reads the same value.
- Buttons are momentary: the value is never written, and they are closed only while held.

### 4.1 LDO model

- **Output, one smooth element (the Claude reviewer's finding 3):** an internal node `ctl` carries `Vctl = smin(vout, smax(V(in) - dropout, 0))`. The output is a single `B` current source into the output node, `I = softplus(Vctl - V(out)) / rout`, with `softplus(x) = k * ln(1 + exp(x / k))` and `k` = 5 mV. `smin` and `smax` are the same softplus-smoothed functions.
  - With `reverse: 'blocks'`, this replaces "a voltage source + `rout` + an ideal diode". It cannot sink current, and it has no stiff diode for Newton to fight.
  - `rout` defaults to 0.1 Ω (`estimate`).
  - The load fold-back `f(V)` uses the same smoothing.
- **Body diode:** with `reverse: 'body-diode'`, a diode from output to input is added.
- **Input current:** the output current (sensed by a 0 V source) plus `iq`, through a current-controlled source. Power is conserved, and the input pays for the output.
- **Input current with overload:** the LDO's input current is the output current regardless of `rout`, so `rout` dissipation is drawn from the input automatically. No separate loss term is needed.
- **Overload:**
  - The model is valid up to `ioutMax`. Beyond it, readings upstream are marked as in 4.2.
  - Above it, the output current is not limited by the model; the result flags `sim-outside-model` on the rail and `sim-over-limit` against `ioutMax`.
  - The **rail's voltages downstream are marked untrustworthy** in readings ("outside the regulator's rated range"), not shown as fact.
- **Output short:** the topological short rule (5.2) fires. Voltages on the shorted rail are marked untrustworthy.
- **Dead input:** `Vctl` = 0 and the input current is `iq` scaled by `f(V(in))`, so there is no division and no negative node.

### 4.2 Buck and boost model

- **Enable:** `e = smoothstep(vinMin - 50 mV, vinMin, V(in)) * (1 - smoothstep(vinMax, vinMax + 50 mV, V(in)))`.
- **Output:** the same smooth current source as 4.1, with `Vctl = e * vout`. When `e = 0` it supplies nothing and sinks nothing, so an externally powered output is not shorted.
- **Unstable in-between (the Claude reviewer's finding 4):** a constant-power input on a sagging source can settle with the enable half on, a state real undervoltage lockout never holds. If `0.01 < e < 0.99` in a solved corner:
  - the rail and everything upstream are marked `outside-model`;
  - `sim-converter-off` fires with "input at the edge of its range; it would cycle on and off";
  - a test covers an overloaded weak battery.
- **Input current:** `I = P_int / (efficiency * max(V(in), 0.5))`.
  - `P_int = V(ctl) * I(out)` is the power at the internal control node, **before** `rout`. So `rout`'s dissipation in a short or overload is paid for at the input (Astra re-review 1).
  - The `max(..., 0.5)` guard means there is never a division by zero, and `e = 0` makes `P_int` 0.
- **Off paths:**
  - `reverse: 'body-diode'` adds a diode from output to input.
  - `offPath: 'diode'` adds a diode from input to output: a boost converter's inductor and diode pass-through while disabled, so the output sits about one diode drop below the input instead of at 0.
- **Overload and short** are handled as in 4.1. In addition, when a rail is outside its model, **every reading upstream of it is marked `outside-model` too**: its input domain's voltages and currents, and the sources and rails feeding that domain, transitively. The budget for that chain is shown as untrustworthy, not as a number.

### 4.3 Tests the models must pass

For each of the LDO, buck and boost models:
- dead input;
- input at each threshold edge;
- output shorted;
- output externally backfed above `vout`;
- two supplies in parallel on one output;
- power conservation, that is, input power equals output power plus losses within 1 %.

### 4.4 Ground and islands (Astra finding 10)

- **Islands:** connected components of the DC-path graph, from section 2's classification.
- **Islands with a source:** the reference is the return of the source with the largest `imax`. Without any `imax`, it is the source with the highest open-circuit voltage; ties are broken by part uid.
- **Floating nodes in the emitted circuit (Astra re-review 10):**
  - An element whose terminals are **all** on floating nodes is omitted.
  - A floating node that still touches an emitted element, such as a capacitor plate or an open input, gets 1 GΩ to node `0` so ngspice has a DC path.
  - That number is never shown: section 2's classification decides that the reading is "floating". The solver needs a single node `0`, so the other islands are joined to it through 1 GΩ **for numerics only**.
- **Islands without a source:** "floating". No voltages are reported.
- **Readings:**
  - Every voltage reading names its island's reference ("relative to battery −").
  - Readings never subtract across the numerical joins.

### 4.5 Typical and peak corners

- Each solve runs twice: every load at `typical`, then at `peak`.
- **Findings at peak are warnings** and are labelled with the peak's note ("at peak: Wi-Fi transmit").
- **Findings at typical** have their normal severity.
- **This applies to every code consistently** (Astra finding 9), `sim-converter-off` included.

### 4.6 GPIO sim state (Astra finding 2)

`parts[].values["gpio.<pin>"]` is one of `"input"` (the default), `"input-pullup"`, `"input-pulldown"`, `"high"` or `"low"`. Validation is in section 3.3.

| State | Compiled as |
|---|---|
| `high` | `R` = `outputResistance` from the **board's IO domain node** (its real 3V3 net) to the pin. The current is drawn from that rail, so it loads the regulator and the battery. |
| `low` | `R` = `outputResistance` from the pin to the domain's return node. Sunk current flows into ground; the pin's current limit checks the magnitude. |
| `input` | `inputLeakage` to the return, or nothing. A pin whose node is "floating" (section 2) gives `sim-floating-input`. |
| `input-pullup` / `input-pulldown` | `pullup` to the IO domain node, or `pulldown` to the return. |

- An ESP32 browning out drops its GPIO high level automatically, because the pin hangs off the real rail.
- A power-conservation test runs battery → regulator → GPIO → LED and checks that the battery current covers the LED.

### 4.7 USB power (Astra finding 2)

- **Simulation nodes for a port (Astra re-review 2):** each `type: "usb"` pin has two simulation-only nodes, `<pin>#vbus` and `<pin>#gnd`. These are internal: they are not module pins, and the checker's `usb.vbus` alias (which names a board pin such as VIN) is not used by the simulator.
  - `<pin>#gnd` is joined to the board's ground pin, declared by `sim.usbPorts: { [usbPin]: { gnd: string } }`.
  - `<pin>#vbus` is a node that `sim.power` refers to like a pin. A domain or rail input may name `"USB#vbus"`.
- **Cable:** each USB link joins `#vbus` to `#vbus` and `#gnd` to `#gnd`, each through the cable's conductor resistance (`representative`, 0.1 Ω per conductor for a 1 m cable). The return current flows through the cable, too. A plug pushed straight into a socket (no cable) uses the contact resistance, 20 mΩ per conductor.
- **Device-side diodes:** a DevKit's USB-to-VIN Schottky is a `switch` rail with `vf` from the domain on `USB#vbus` to the `VIN` domain. So VIN and USB VBUS are separate nodes, as on the real board.
- **A host port gets its power from its board's rail:**
  - The port's `#vbus` node is the output domain of a rail, for example a Pi's 5 V rail through its USB power switch, which is a `switch` rail with `ron`.
  - Load on the device side therefore loads the host's rail and, upstream, its supply.
  - **Hubs are not simulated in this slice.** Devices behind a hub are listed in `unsimulated` ("powered through a hub: not simulated yet") rather than shown as dead.
- **External sources:** only a part that *is* an external supply gets a standalone source: the computer port, a wall adapter, a power bank. Its `imax` is the limit.

## 5. Results and findings

### 5.1 `SimResult`

```ts
type SimOutcome =
  | { status: 'ok'; result: SimResult }
  | { status: 'failed'; revision: number; finding: SimFinding; findings: SimFinding[]; lastGood?: { revision: number; result: SimResult } }
  | { status: 'unavailable'; reason: string; findings: SimFinding[] }   // engine could not load
  // findings: the topological ones, decided before the engine runs (revision 5, Phase D)

interface SimResult {
  format: 'circuitoon-sim/1'
  revision: number                                          // the diagram revision this was solved for
  corners: { typical: Run; peak: Run }
  budget: DomainBudget[]                                    // per source, rail and domain: volts, amps (typical/peak), limit, headroom
  findings: SimFinding[]
  unsimulated: { part: string; reason: string }[]
  probes: ProbeReading[]
  engine: { name: 'ngspice'; version: string; build: string; runs: number; ms: number }
}
interface Run {
  nets: Record<NetName, Reading>                            // NetName from nameNets()
  parts: Record<PartRef, { pins: Record<PinName, CurrentReading>; power: Reading; state?: 'lit' | 'dark' }>
}
type Reading = { kind: 'value'; value: number; reference: NetName; trust: 'ok' | 'outside-model' } | { kind: 'floating' } | { kind: 'undefined'; why: string }
type CurrentReading = { kind: 'value'; value: number; trust: 'ok' | 'outside-model' } | { kind: 'indeterminate'; why: string }
interface SimFinding {
  code: SimCode; severity: 'error' | 'warning' | 'note'; parts: PartRef[]; message: string
  corner?: 'typical' | 'peak'; basis: Provenance | 'user' | 'topology'; inputs: string[]; raw?: string
  pins?: { part: PartRef; pin: PinName }[]                  // pin-level findings: floating input, a pin over its limit
}
```

- **Current sign:** positive means into the pin. Limits compare **magnitudes**.
- **Source current** is reported as delivered current (`-I` into its positive pin) under the label "delivering".
- `inputs` lists the parameters the finding was decided on, each with its provenance (for example `led.d1.limits.current: representative`, `esp32.u1.draw.3V3: estimate`).
- `basis` is the weakest provenance among them, ordered `user` = `datasheet` > `representative` > `estimate`. `topology` is used for rules that use no parameters.

### 5.2 Finding codes

| Code | When | Severity (at typical) |
|---|---|---|
| `sim-short` | **Topological, not by a current threshold.** In the current state, a *low path* (contacts, jumpers, fuses, cable conductors and wire joins only) connects a source's or rail output's terminal to **its own return**. The parts on that path are listed. A shorted high-resistance cell is found too. | error, basis `topology` |
| `sim-source-conflict` | Two sources or rail outputs form a **closed loop through low paths on both sides**: plus to plus **and** minus to minus (parallel), with open-circuit voltages differing by more than 0.1 V. Joining only the positives, or wiring sources in series, never fires it (Astra re-review A). Rail outputs with `reverse: 'blocks'` are excluded, because they OR rather than fight. So is a rail output whose input nothing but the rail itself powers (a DevKit's 3V3 pin fed from 2xAA backfeeds its own dead regulator). | error; basis = the weaker provenance of the two voltages |
| `sim-over-abs-max` | Over an `absMaxCurrent`, a `vinMax`, or a pin's absolute maximum. "Exceeds the absolute maximum rating; damage is likely." For an LED it names the series resistor to add ("about 150 ohm at 5 V"), sized from the driving node's unloaded voltage (a source's open-circuit voltage or a rail's `vout`), not the sagged reading. The engine does not decide burnout: the LED shows dark-red with a warning ring, never "burnt". | error (still an error on a `representative` limit exceeded more than 2x) |
| `sim-over-limit` | Over a `current`, `power`, `sourceCurrent`, `ioTotalCurrent`, `ioutMax` or `imax` limit, or a USB host's sourced current, but under any absolute maximum. "Above its 20 mA rating." Not on a source in a `sim-short` (the short says it). | warning |
| `sim-brownout` | A load's domain voltage below its `minVolts` (error). A load that nothing on the sheet powers in the current state is a **warning** with basis `topology`, worded "not powered in the current state", naming the open switch when one separates it from a source ("SW1 is open"); revision 5. | error; warning when not powered |
| `sim-dropout` | An LDO whose control voltage `Vctl` is below `vout` - 10 mV (out of regulation; this excludes the `rout` drop). | error |
| `sim-converter-off` | A buck or boost with `e < 0.5` while loads on its output domain expect power. | error |
| `sim-min-load` | A rail with `minLoad` loaded below it, e.g. the IP5306 auto shutdown. Not while the rail is unpowered, or while an open switch cuts its output from a load it would power. | warning |
| `sim-outside-model` | A rail beyond `ioutMax`, so its voltages can't be trusted. | warning |
| `sim-floating-input` | A GPIO in `input` state on a floating node (classified before solving; the solver's 0 V is never used as evidence), on a board whose IO domain is powered (an unpowered board's "not powered" warning covers it), and whose net reaches no connector pin that leads off the sheet (another sheet drives it). | warning |
| `sim-no-convergence` | ngspice failed after its own fallbacks. The message names the parts on the nets ngspice reported. | error |
| `sim-incomplete` | Powered parts with no power data, listed. | note |
| `sim-estimate` | N values in the result are estimates, listed. | note |

**Uncertainty decides blocking (Astra finding 8):**
- A finding blocks `gate` only if its severity is `error`, it is at the typical corner, and its `basis` is `topology`, `user` or `datasheet`, or it is a `sim-over-abs-max` whose reading is more than twice a `representative` limit (revision 5, Phase D).
- With `basis` `representative` or `estimate`, the same condition is reported as a **warning**, worded "likely", with the uncertain inputs listed. An estimate never blocks.
- There are no counterfactual runs; the rule is decided from `inputs` alone.

Some examples:
- An LED on 5 V with no resistor exceeds the representative absolute maximum by far (more than 2x), so it blocks; the message names the resistor to add. At 1.5x it is a warning ("likely damage"). The checker's static rules still apply.
- An ESP32 browning out under estimated draw is a warning.
- The same brownout with sourced draw blocks.

Messages are plain words, for example "LED1 carries 47 mA, above the 20 mA typical rating for a 5 mm red LED. Add a resistor (about 68 ohm at 3.3 V)." There is no SPICE vocabulary; `raw` keeps the engine's text for a details disclosure.

## 6. Editor

### 6.1 Simulate toggle

- **The control:** a toolbar button, Simulate (shortcut `S`).
- **Turning it on:** loads the engine, with determinate progress on first download, and solves on every connectivity or value change. Solves are coalesced through the session's revision-checked queue. A pure move never re-solves.
- **Turning it off:** clears live state and drops in-flight results.
- **Never saved:** glow and readings. Probes and GPIO states are saved.
- **While a solve fails:** the last good readings stay, dimmed and marked "stale (from before your last edit)". The banner names the failure.

### 6.2 Probes (chosen option C)

- **Placing:** the Probe tool (`P`) clicks a pin, a breadboard hole, the end of a wire or a part.
  - A click on a wire anchors to the nearer of its two end pins.
  - A part probe reads current per pin, plus power.
- **Saving in the sheet:** a new optional top-level field, additive to `circuitoon-diagram/1`. Anchors are part uids and pin names, never wires, so wire edits can't strand a probe.
  ```json
  "probes": [ { "id": "P1", "name": "battery +", "at": { "part": "u3", "pin": "+" } },
              { "id": "P2", "at": { "part": "d1" } },
              { "id": "P3", "at": { "part": "bb1", "pin": "a12" } } ]
  ```
- **Saving in an agent netlist (Astra finding 15):** probes use refs and net names, for example `{ "id": "P1", "at": "BT1.+" }`, `{ "id": "P2", "at": "D1" }` and `{ "id": "P3", "at": "net:VBAT", "ref": "net:GND" }`.
  - `layout` resolves `net:` to a pin on that net, preferring the part named by the probe's `name`, then the lowest ref.
  - `extract` writes probes back in ref form. A probe anchored to a part that extraction removes, such as a routing breadboard added by layout, is **remapped to `net:<name>`** of the net it sat on (Astra re-review 15). A part probe on a removed part is dropped with a warning.
  - A round-trip test runs sheet → netlist → layout → sheet, including a probe on a breadboard hole.
- **Validation:** ids are unique (`P` plus an integer), and anchors must exist. A dangling probe gives a warning and is dropped, never an error.
- **Drawing:**
  - Each probe is a coloured lead from its point to a reading tag, with colours from a fixed eight-colour order with 3:1 contrast in both themes.
  - Tags avoid parts and each other using the existing label placement.
  - A tag shows typical, with peak if it differs: "4.38 V (peak 4.21 V)". It shows "floating", "undefined" or "-" (Simulate off) as words, and readings outside the model are marked.
- **The Probes panel** (right side; it replaces the inspector tab while the Probe tool is active) holds:
  - the reading list, with rename and delete;
  - **Supplies**: each source, rail and domain as a table row: load against limit, typical and peak, headroom, and provenance;
  - the incomplete and estimate notes, with their parts.

### 6.3 On the sheet while simulating

- **LED glow:** brightness follows current, on a log scale with full brightness at its current limit; the colour comes from `values.color`. Over an absolute maximum, a dark-red LED with a warning ring and badge (6.2's wording).
- **Finding badges** reuse the checker's badge component, grouped as in 2.1. Clicking a badge selects the parts.
- **Switches:** clicking one while simulating flips it and saves the new position. A button is momentary (held while the mouse is down) and is not saved.
- **GPIO pins:** clicking a pin cycles input, high, low. The inspector has all states.

### 6.4 Accessibility and performance

- Readings are text, not colour alone.
- Reduced motion is respected; there is no flicker anyway.
- The 200-part fixture with Simulate on keeps drag at 60 fps.

## 7. Agents: CLI, gate, plugin

**`circuitoon sim <sheet|netlist> [--probe <ref[.pin]|net:NAME>]...`** prints the `SimOutcome` JSON, with a short human summary on stderr.

| Outcome | Exit |
|---|---|
| `ok`, no blocking finding (5.2) | 0 |
| `ok`, with blocking findings | 1 |
| bad input | 2 |
| `failed` or `unavailable`, with blocking topological findings (a real short) | 1, as `gate` (revision 5, Phase D) |
| `failed` or `unavailable`, nothing blocking | 3 |

Given a netlist, or a sheet that carries its intent, `corners.*.nets` is keyed by the netlist's own net names; nets the netlist does not name keep the sheet's names. `sim` checks connectivity only: a netlist the layout cannot draw (a net that needs a distribution point) is simulated from its connections, never refused (revision 5, Phase D).

**`gate`** becomes `circuitoon-cli/gate/4`. The full matrix (Astra finding 12):

| Checker | Sim outcome | `blocking` | `ok` | `ready` | Exit | Banner |
|---|---|---|---|---|---|---|
| errors | any | checker errors (+ sim blocking) | false | false | 1 | GATE FAILED |
| clean | `ok`, blocking findings | sim blocking findings | false | false | 1 | GATE FAILED (simulation) |
| clean | `ok`, warnings only | [] | true | per existing readability rules | 0 | GATE PASSED, with warnings |
| clean | `ok`, clean | [] | true | per existing rules | 0 | GATE PASSED |
| clean | `failed` (no convergence) | [] | false | false | 3 | GATE INCOMPLETE (simulation did not converge; this may be our model, not your circuit) |
| clean | `unavailable` (engine) | [] | false | false | 3 | GATE INCOMPLETE (simulation unavailable) |

- **New fields:**
  - `sim: { status, findings, budget, provenanceCounts }`;
  - `warnings`, which holds sim warnings; the existing info-only `notes` keeps only notes, including `sim-incomplete` and `sim-estimate`.
- **Compatibility:** gate/4 is a new format. Every reader in the repo is updated: the skill docs, the `NOT_CHECKED` list in `src/agent/notChecked.ts` (simulation is now checked), and the tests. Nothing claims gate/3 readers keep working unchanged.
- **Other commands:**
- **The `circuitoon-design` skill:** set GPIO states for what the firmware does, run `sim`, fix every blocking finding, and read the warnings, then hand the sheet over.
- **The plugin version** goes to 0.10.0.

## 8. Performance and size budgets

| Item | Budget |
|---|---|
| Engine download (gzip) | ≤ 2.5 MB, fetched only on the first Simulate |
| Cold start in the browser | ≤ 1.5 s on the dev machine, with progress shown |
| One solve (2 runs), 200 parts, Worker end to end | p95 ≤ 30 ms |
| Worker heap after 2,000 runs (one recycle period) | ≤ 64 MB above baseline |
| Editor main bundle | at most +30 KB gzip (the engine is never in it) |
| CLI `sim` on the Spirit Typewriter sheet, cold | ≤ 2 s |

## 9. Testing

- **Compiler golden tests:** each device kind, ground and island selection, and name sanitisation (nets named `0`, `gnd`, or with spaces and quotes).
- **Floating classification:**
  - a capacitor-only node;
  - an open switch;
  - a source-less island;
  - a singleton pin;
  - a probe on a source-less island reads "floating".
- **Accuracy and conservation:**
  - LED + 150 Ω + 5 V gives V(anode) = 2.0008 V ± 1 mV;
  - a battery under load sags by `rInternal`;
  - the converter suite in section 4.3, including input-side power during an output short, upstream outside-model marking and boost pass-through;
  - battery → LDO → GPIO high → LED conserves current;
  - battery → host rail → USB cable → device load conserves current;
  - a dead-rail load draws 0.
- **Findings:** one test per code, both ways (fires and stays quiet). These include:
  - a topological short through a closed switch, and a shorted high-resistance cell;
  - source conflict: positives joined only (quiet), two cells in series (quiet), 3.7 V and 5 V in parallel (fires), two equal cells in parallel (quiet);
  - an open switch removing that short;
  - a GPIO sinking over its limit;
  - the IP5306 under its minimum load;
  - an ESP32 on 3xAA through an AMS1117: dropout at peak is a warning, at typical it depends on basis;
  - an unplugged DevKit (no host) next to the checker's "external power assumed" view: both findings appear, each in its own group;
  - estimate-basis findings never block.
- **Engine:**
  - success, then failure, then success;
  - a timeout terminates the worker;
  - the heap stays in budget over 2,000 runs;
  - `engine:build` rebuilds the engine and its smoke tests pass (LED accuracy, `ngGet_Vec_Info` reads, `ngSpice_SetBkpt` accepted).
- **Probes:** sheet ↔ netlist round trip; dangling anchors dropped with a warning.
- **Spirit Typewriter fixture** (`src/sim/fixtures/`):
  - every powered part has power data with honest provenance, whether datasheet, representative or estimate;
  - rail voltages match hand calculations recorded in the test;
  - the expected findings are listed.
- **Visual:** Playwright with our own Chrome, never the Playwright MCP. Screenshots in light and dark of each probe kind, "floating" and "undefined" tags, glow at three currents, an over-absolute-maximum LED, a brownout badge, both finding groups, the Supplies section, the failure banner and stale readings. Each is reviewed by eye.
- **Perf:** the 200-part drag with Simulate on, and the solve p95 in a Worker.

## 10. Delivery and Astra checkpoints

Michael asked for Astra to be consulted along the way. Each checkpoint gets an Astra review before work continues, and the findings are acted on or answered with reasons.

1. **This spec:** Michael reviews revision 4. Astra re-reviews it after its reset (Oct 10). Planning starts once Michael approves; Astra's findings are folded in when they arrive.
2. **The implementation plan.**
3. **Engine:** the Docker build, the release asset and NOTICE, the adapter and workers, and the lifecycle tests.
4. **Model:** `model.ts`, `build.ts`, `floating.ts`, `spice.ts`, the converter, GPIO and USB models, and the accuracy and conservation tests.
5. **Data:** `electrical.sim` validation and the sourced numbers for section 3.4. Two independent reviewers verify the numbers, then Astra reviews the modelling choices.
6. **Results:** `results.ts`, the session, `circuitoon sim`, gate/4 and probes in netlists.
7. **Editor:** with visual validation. Then a whole-branch Claude review, Astra, and ship.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Datasheet numbers wrong or mislabelled | Two reviewers, a link per number, per-value provenance, and uncertain values never block |
| Behavioural models fail to converge or mislead outside range | Smoothed enables, guarded divisions, blocking diodes, the section 4.3 suite, and `outside-model` trust marking |
| Our own WASM build drifts or breaks | Pinned source, emsdk and patches; `engine:build` with smoke tests; release asset per version |
| Simulated state is mistaken for the checker's any-state verdict | Separate groups with their assumptions stated (2.1) |
| Probes clutter big sheets | Opt-in, with the existing collision-avoiding placement |

## 12. Answers to Astra's review of revision 1

| # | Finding | Revision 2 |
|---|---|---|
| 1 | Converter models undefined under faults | 4.1, 4.2 and 4.3: guarded input coupling, open off-state, blocking diode or body diode, `rout`, outside-model marking, and the fault test suite |
| 2 | GPIO and USB create unaccounted power | 4.6 (resistance to the real rail and return), 4.7 (VBUS as a conductor fed from the host rail; standalone sources only for external supplies), conservation tests |
| 3 | Merges destroy branch currents | Contacts, jumpers and fuses are real `R` branches; inductors are their DCR; capacitors are emitted; the compiler reduces per analysis |
| 4 | PWM false confidence | PWM cut from this slice |
| 5 | `ratings` collision and `params` readers | Nothing existing changes; new data is under `electrical.sim`; `params.maxCurrent` is read as a legacy limit |
| 6 | Power topology data missing | Named domains with returns and nominals, rail inputs with an OR rule, explicit GPIO pin lists and IO domain, overrides per domain, caps validation |
| 7 | Sourcing overstated | Chip and board labelled; the holder is not the cell; `representative` provenance; the model's fold-back is labelled a model; the fixture allows honest estimates |
| 8 | Estimate rule incomplete | Per-value provenance; `inputs` and `basis` per finding; blocking only on `topology`, `user` or `datasheet`; no counterfactual runs |
| 9 | Rating rules miss and overclaim | Topological shorts; source `imax` and absolute maximums included; magnitudes and sign defined; "damage likely" instead of "burnt"; consistent corner severity |
| 10 | Numerical ground as measured voltage | Floating classification before solving; singleton terminals; reference per reading; "undefined" across islands |
| 11 | Checker and simulation assumptions differ | Two labelled groups; no suppression either way; sim-only CLI output; unplugged-DevKit test |
| 12 | Gate semantics | Full status and exit matrix; `warnings` field; consumers updated; no compatibility claim |
| 13 | Lifecycle stops at the browser | Node runs in a terminable `worker_threads` Worker; `SimOutcome` variants; revision ids; recycling by engine runs; failure sequence tests |
| 14 | Licensing without corresponding source | Our own pinned Docker build; a release asset with exact source, patches and build materials; licences listed from the built configuration |
| 15 | Probe identity in netlists | Pin-anchored sheet probes; ref and `net:` syntax in netlists; layout and extract mapping; `nameNets()`; round-trip test |

## 13. Answers to Astra's re-review of revision 2

| Item | Revision 3 |
|---|---|
| 1. Converter fault power | The input power is taken at the control node before `rout` (4.2), so short and overload losses reach the input. Outside-model marking propagates upstream. `offPath` covers boost pass-through, and `body-diode` applies to all kinds. |
| 2. USB topology | Simulation-only `#vbus`/`#gnd` nodes per port; `sim.usbPorts` for the ground pin; both cable conductors are modelled; the DevKit's Schottky is a `switch` rail between separate nodes (4.7). |
| 6. `noPullup`, output-only default | `noPullup` rejects both pulls; output-only pins have no default and stay open until set (3.3). |
| 9 and A. Short rule | `sim-short` covers only a source to its own return. The new `sim-source-conflict` needs a closed parallel loop, and its basis is the voltages' provenance (5.2). Tests cover positives-only, series and parallel. |
| 10. Floating numerics | Fully floating elements are omitted; touching floating nodes get 1 GΩ to `0` with the reading hidden; an `imax` fallback is defined (4.4). |
| 11. Mains in the current state | A single-state availability evaluation in `mainsRules.ts` (section 4 table). |
| 15. Probes on removed boards | Remapped to `net:` on extract; part probes dropped with a warning; a round-trip test (6.2). |
| B. Legacy primitives | Primitive models compile without `sim` data; only boards and modules need `sim.power` (3.1). |
| C. Defaults | A per-kind required-field table; `minVolts` defaults to 90 % of nominal (`estimate`); incomplete models are rejected before compiling (3.1, 3.2). |

## 14. Answers to the Claude review of revision 3

| # | Finding | Revision 4 |
|---|---|---|
| 1 | No saved switch state | `values["contact.<groupId>"]`, defaults shared with the mains model, a legacy mapping, relays shown at rest (4.0) |
| 2 | Net-name collision | The `netlist()` nets are named exactly as `extract` names them; singletons get their own namespace (2) |
| 3 | Stiff diode, non-smooth min/max | One softplus current source per output; `smin`, `smax` and the fold-back are smoothed (4.1) |
| 4 | Equilibrium halfway through the enable | `0.01 < e < 0.99` marks outside-model and fires `sim-converter-off`, with a test (4.2) |
| 5 | Non-convergence failing a good circuit | `failed` gives GATE INCOMPLETE, exit 3 (7) |
| 6 | Battery `rInternal` | Per-module values on all 15 built-in batteries; a voltage-keyed legacy fallback (3.1) |
| 7 | Build mode forces a rebuild for firmware | Shared library with XSPICE now, with an executable-mode fallback decided at the engine checkpoint (2.2) |
| 8 | ORed rails as conflicts | `blocks` rails are excluded (5.2) |
| 9 | `usbPorts` and `#vbus` validation, direct plugs | Added to `SimSpec`; node-reference syntax; 20 mΩ contact for direct plugs (3.1, 4.7) |
| 10 | Dropout misfires | Uses `Vctl` (5.2) |
| 11 | Stale text | Fixed |
| 12 | Potentiometer and inductor | Potentiometer added; inductor dropped (no module uses it) |
| cuts | Over-engineering | Cut: hash-identical rebuilds, heap-based recycling, hub modelling, differential probes, `render --sim` and `explain` data, and Supplies bars (now a table). Host-rail modelling is kept, because conservation needs it (Astra finding 2). |

## 15. Revision 5 amendments

From an independent review of the implementation plan (`docs/superpowers/plans/2026-10-05-live-simulation.md`, rulings R13, R28 and R30):

| Section | Amendment |
|---|---|
| 2 (floating.ts) | "Driven" means reachable from a source's + terminal or a rail output through conducting elements other than input-leakage resistors, loads and a rail's return path. So a board behind an open switch with its ground shared is unpowered, not a 0 V reading, and an input held only by leakage floats. |
| 2.2 | The fallback is a ladder: rung 1 shared library with XSPICE; rung 2, tried automatically, shared library without XSPICE (same adapter, XSPICE recorded as debt); rung 3 the executable build, which means stop and redesign. |
| 3.1 | Module `electrical.params` values, defaults included, count as `user` (the designer's stated value); only `sim` data carries datasheet, representative or estimate provenance. |
| 5.2 | A load that nothing on the sheet powers in the current state gives `sim-brownout` as a warning (basis `topology`, "not powered in the current state"), the same whether the board is unplugged or behind an open switch with ground shared; the message names the open switch when one is the cause. The `circuitoon-design` skill tells agents to set switches to their operating position before `sim` or `gate`. |
| 2.3 | Phase A checkpoint ruling: the worker is recycled only when the engine is dead (ngspice's exit callback, a thrown trap, a timeout, the worker exiting) and after 2,000 engine runs, not after an ordinary circuit failure (`ok: false`), which leaves the instance usable. |
| 3.1 | Task 6 ruling: the coin-cell fallback applies only from 2.4 V to under 3.0 V. A legacy 3.0 V pack is 2 x alkaline AA (0.3 ohm), since an underestimate never blocks and a 15 ohm guess fakes brownouts; built-in coin cells carry their own rInternal. |
| 2 (net names) | Phase B checkpoint: labels, `GND` and supply-rail names are shared by the simulator, `extract` and KiCad; fallback `<ref>_<pin>` names may differ in KiCad (its own components and refs, sanitised names). A test pins the shared names. |
| 2.2 | The engine has XSPICE without code models: the `icm` and `cmpp` code-model tools are not built (ruling R11), so `A` devices are unavailable. This is recorded debt; adding code models later is a patch plus a rebuild, with no adapter change. |
| 5.2 | Phase D checkpoint ruling: `sim-over-abs-max` stays a blocking error when the reading exceeds the limit by more than 2x and the limit's basis is `representative` (part variation does not cover 2x); an estimate never blocks. An LED straight across 2xAA (about 4x its absolute maximum) fails the gate. |
| 5.2 | Phase D checkpoint rulings: `sim-source-conflict` leaves out a rail output whose input nothing but the rail itself powers; `sim-floating-input` is skipped on an unpowered board; `sim-min-load` is suppressed while an open switch cuts the rail's output; no `sim-over-limit` on a source that is in a `sim-short`. |
| 5.1, 7 | Phase D checkpoint ruling: failed and unavailable outcomes carry the topological findings (decided before the engine runs), and `gate` blocks on their errors by the usual rule, so a real short with no engine still says GATE FAILED. `SimFinding` gains optional `pins` for pin-level findings (format stays `circuitoon-sim/1`). |
| 3 (module drift) | Controller ruling: `electrical.sim` is library data, not drift, like `kicad`. A sheet's copy of a built-in part is never out of date for sim data alone, and the simulator reads a built-in part's sim from the library (when its pins match); a custom part's embedded sim is used as is. |
| 7 | Phase D checkpoint ruling: `circuitoon sim` exits 1 when a failed or unavailable outcome carries blocking topological findings, as `gate` blocks on them; 3 only when nothing blocks. |
| 7 | Phase D checkpoint ruling: given a netlist (or a sheet with its intent), `sim` keys net readings by the netlist's own net names (an alias over the sheet's names; nets the netlist does not name keep theirs, made unique), and a USB port's own conductor reads as `U1_USB_VBUS`, never an internal `#` name. The editor keeps the sheet's names. |
| 7 | Phase D checkpoint ruling: `sim` validates connectivity only. Layout-readability rules (a net that needs a distribution point) never block a DC solve: a netlist the layout cannot draw is simulated from a sheet with each net wired pin to pin. |
| 5.2 | Phase D checkpoint ruling: `sim-floating-input` is skipped when the input's net reaches a pin of a `connector` part that leads off the sheet (a header, a JST-XH plug, a USB panel socket: the Spirit's J1 to J3 inter-sheet connectors). A pin joined to another inside its part (`internal`, a Wago lever splice) only joins wires on the sheet and does not count. |
| 5.2 | Phase D checkpoint ruling: an LED's resistor advice uses the driving node's unloaded voltage (a source's open-circuit voltage or a rail's `vout`), not the reading the overload sags: an LED straight on 2xAA reads "at 3 V". |
| 2.3 | Phase D performance: a solve sends both corners to the worker in one message (a batch); the 5 s timeout, the retry and recycling apply per message, the worker stops a batch at its first failure, and every run answered counts toward the 2,000-run recycle (still 2 engine runs per solve). |
| 6.2 | Task 36 fix ruling: a probe anchor may carry an optional `hole` (a whole number within its hole group), so a probe placed on a breadboard hole is drawn on that hole; a bad hole drops the probe with a warning. A netlist keeps the group only (`BB1.top+`), and layout puts the probe on a hole of it. |
