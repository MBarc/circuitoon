# Live DC simulation: design

Status: revision 2 (2026-10-05).
- Revision 1 was approved section by section by Michael.
- Astra's review of revision 1 asked for a revision with 15 findings. Revision 2 answers all of them; section 12 maps each finding to its fix.

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
  - Net names come from the shared `nameNets()` (`src/format/netNames.ts`), the same names the CLI and the KiCad export use.
- **`src/sim/floating.ts`:** before solving, a graph pass classifies every node as `driven` (it has a DC path to a source) or `floating`.
  - Capacitors and open switches do not conduct for this pass.
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
- **Build mode:**
  - the ngspice executable with `--disable-xspice --disable-osdi`, as in eecircuit;
  - no PDK models;
  - the loader fetches a separate `ngspice.wasm` by URL in the browser and reads it from disk in Node.
- The output is committed to `public/sim/` and `plugin/dist-cli/`. A CI-free check, `npm run engine:verify`, rebuilds in Docker and compares hashes. It is run before each engine change, not on every deploy.
- **The JS wrapper** is our own small adapter (about 300 lines), modelled on eecircuit-engine's MIT `Simulation` class with attribution. There is no dependency on its private fields, and the old contract test is no longer needed.
- **Licence compliance:**
  - `public/sim/NOTICE.txt` and the About dialog list ngspice's licences as found in the built configuration. The build script prints the compiled-in source directories; every non-BSD component found there is listed with its licence, and `numparam` (LGPLv2+) is expected.
  - **Each engine version is published as a GitHub release asset** on MBarc/circuitoon. The asset contains the exact ngspice source tarball, our patches, the build script and emsdk version, and relinking instructions. NOTICE links to that release, so the source sits beside the binary from the same place.
  - The `.wasm` stays a separate, replaceable file.

### 2.3 Engine lifecycle

- **Loading:** the engine loads the first time Simulate is turned on (or on the first `sim` in the CLI).
- **Instances:** one ngspice instance per worker.
- **Each run:** `source` + `op` + read + `remcirc`.
- **Recycling:** the worker is recycled after 2,000 **engine runs** (not solves), or once the WASM heap passes 128 MB, always between runs.
- **Timeouts:** 5 s per run. On a timeout the worker is terminated and recreated, and the run is retried once. A second timeout gives `status: 'failed'`.
- **Failures:** an `op` with no data vector is a failure, with `getError()` text kept as `raw`.
- **Tested sequences:** success, then failure, then success on the same session, plus worker cleanup after a failure.

## 3. Module data

### 3.1 Where the new data lives: `electrical.sim`

Revision 1 split `electrical.params` and added `electrical.ratings`. That collides with the existing `electrical.ratings` array (the mains insulation, terminal and switching ratings, e.g. on the KCD1) and with direct `params` readers such as the mains model's `acVoltage`. **Revision 2 changes nothing that exists.**

- **`electrical.params` keeps its meaning:** the values a user edits per part (resistance, `voltage`, `color`, `forwardVoltage`, `acVoltage`). There is no migration, and no drift.
- **`electrical.ratings` keeps its meaning:** the mains ratings array.
- **Everything new goes under one optional object, `electrical.sim`:**

```ts
interface SimSpec {
  modelParams?: Record<string, Quantity>   // physics: diode IS/N/RS, rInternal, contact resistance, DCR
  limits?: Limit[]                         // what results are compared against (5.2)
  power?: PowerSpec                        // 3.2
  gpio?: GpioSpec                          // 3.3
}
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
- **Legacy values:** the LED's existing `params.maxCurrent` (default 20 mA) is still read as a `current` limit with provenance `representative`, so old embedded modules keep working. If both are present, `sim.limits` wins.
- **Validation:** `electrical.sim` is validated in full. Unknown keys are errors, a unit must match its kind, and every pin and domain it names must exist. Unknown or absent `sim` data means the part is not simulated; it is never a crash.

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
  reverse: 'blocks' | 'body-diode'
  minLoad?: { amps: Quantity; note: string }
  ron?: Quantity; vf?: Quantity                             // for kind 'switch' (load switch or diode path)
}
```

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
- The existing `caps` constrain the states: `inputOnly` rejects high and low, `outputOnly` rejects the input states, and `noPullup` rejects `input-pullup`.
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
| Switch, button, rocker, jumper, 0 Ω resistor, fuse | **A real branch, never a merge** (Astra finding 3). Closed: `R` = contact resistance (`modelParams.contactResistance`; default 20 mΩ, `estimate`). Open: no element. The current through it is measured, so fuse and switch limits can be checked. |
| Inductor | `R` = its DCR (`modelParams.dcr`; default 0.1 Ω, `estimate`). |
| Capacitor | Emitted as `C` with its value. ngspice treats it as open in `op`, and its plates read "floating" unless driven otherwise (section 2). |
| Breadboard strips, rails, net labels, connectors, Wago | One node: these are one conductor in `netlist()` already. Their resistance is out of scope. |
| Board load (`draw`) | A **voltage-aware load** per domain: `B` current source from the domain pin to its `ret`, `I = typical * f(V)`, where `f` is 1 above `minVolts` and falls linearly to 0 at 0 V. The node can never be pushed negative. This is labelled a model in the results. |
| `ldo` rail | Defined in 4.1. |
| `buck` and `boost` rail | Defined in 4.2. |
| `switch` rail | `R` = `ron`, or a diode with `vf`, from the input domain pin to the output domain pin. |
| GPIO pin | Section 4.6. Current always flows from or to the board's real IO domain node. |
| USB VBUS | Section 4.7. |
| AC-DC converter output | A DC source **only when the mains checker says the converter is powered** (mains spec section 1). Otherwise its output is an open circuit. |
| Anything else | Not simulated: its pins are open, and it is listed in `unsimulated` with a reason. |

### 4.1 LDO model

- **Output:** a voltage `B` source, `Vctl = min(vout, max(V(in) - dropout, 0))`, behind `rout` (default 0.1 Ω, `estimate`). It feeds the output through an ideal diode model (`N = 0.01`) when `reverse: 'blocks'`, so an externally powered output never sinks into the regulator.
- **Body diode:** with `reverse: 'body-diode'`, a diode from output to input is added.
- **Input current:** the output current (sensed by a 0 V source) plus `iq`, through a current-controlled source. Power is conserved, and the input pays for the output.
- **Overload:**
  - The model is valid up to `ioutMax`.
  - Above it, the output current is not limited by the model; the result flags `sim-outside-model` on the rail and `sim-over-limit` against `ioutMax`.
  - The **rail's voltages downstream are marked untrustworthy** in readings ("outside the regulator's rated range"), not shown as fact.
- **Output short:** the topological short rule (5.2) fires. Voltages on the shorted rail are marked untrustworthy.
- **Dead input:** `Vctl` = 0 and the input current is `iq` scaled by `f(V(in))`, so there is no division and no negative node.

### 4.2 Buck and boost model

- **Enable:** `e = smoothstep(vinMin - 50 mV, vinMin, V(in)) * (1 - smoothstep(vinMax, vinMax + 50 mV, V(in)))`.
- **Output:** `B` source `V = e * vout` behind `rout` and the ideal blocking diode. When `e = 0` the output is open (the diode blocks), never a 0 V short. So an externally powered output is not shorted.
- **Input current:** `I = P_out / (efficiency * max(V(in), 0.5))`, with `P_out = V(out) * I(out)` from the sense source. The `max(..., 0.5)` guard means there is never a division by zero, and `e = 0` makes `P_out` 0.
- **Overload and short** are handled as in 4.1.

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
- **Islands with a source:** the reference is the return of the source with the largest `imax` (ties broken by part uid). The solver needs a single node `0`, so the other islands are joined to it through 1 GΩ **for numerics only**.
- **Islands without a source:** "floating". No voltages are reported.
- **Readings:**
  - Every voltage reading names its island's reference ("relative to battery −").
  - A differential probe across two islands reads **"undefined (no connection between these points)"**.
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

- **VBUS is a conductor:** each USB link joins the two ports' `usb.vbus` pins through the cable's resistance (`representative`, 0.1 Ω for a 1 m cable).
- **A host port gets its power from its board's rail:**
  - The port's `vbus` pin is part of a declared domain. On a Pi, the 5 V rail through its USB power switch is a `switch` rail.
  - Load on the device side therefore loads the host's rail and, upstream, its supply.
  - Hubs pass VBUS through their `switch` rails to their downstream ports.
- **External sources:** only a part that *is* an external supply gets a standalone source: the computer port, a wall adapter, a power bank. Its `imax` is the limit.
- **Device-side diodes:** a board's diode between USB VBUS and its 5V pin is a `rails` input with `via: 'diode'`.

## 5. Results and findings

### 5.1 `SimResult`

```ts
type SimOutcome =
  | { status: 'ok'; result: SimResult }
  | { status: 'failed'; revision: number; finding: SimFinding; lastGood?: { revision: number; result: SimResult } }
  | { status: 'unavailable'; reason: string }              // engine could not load

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
}
```

- **Current sign:** positive means into the pin. Limits compare **magnitudes**.
- **Source current** is reported as delivered current (`-I` into its positive pin) under the label "delivering".
- `inputs` lists the parameters the finding was decided on, each with its provenance (for example `led.d1.limits.current: representative`, `esp32.u1.draw.3V3: estimate`).
- `basis` is the weakest provenance among them, ordered `user` = `datasheet` > `representative` > `estimate`. `topology` is used for rules that use no parameters.

### 5.2 Finding codes

| Code | When | Severity (at typical) |
|---|---|---|
| `sim-short` | **Topological, not by a current threshold** (Astra finding 9): in the current state, a path made only of contacts, jumpers, fuses, cable VBUS and wire joins connects a source's or rail output's terminal to its own return, or connects two sources' outputs whose open-circuit voltages differ by more than 0.1 V. The parts on that path are listed. A shorted high-resistance cell is found too. | error, basis `topology` |
| `sim-over-abs-max` | Over an `absMaxCurrent`, a `vinMax`, or a pin's absolute maximum. "Exceeds the absolute maximum rating; damage is likely." The engine does not decide burnout: the LED shows dark-red with a warning ring, never "burnt". | error |
| `sim-over-limit` | Over a `current`, `power`, `sourceCurrent`, `ioTotalCurrent`, `ioutMax` or `imax` limit, or a USB host's sourced current, but under any absolute maximum. "Above its 20 mA rating." | warning |
| `sim-brownout` | A load's domain voltage below its `minVolts`. | error |
| `sim-dropout` | An LDO with `V(in) - V(out)` below `dropout` + 20 mV (out of regulation). | error |
| `sim-converter-off` | A buck or boost with `e < 0.5` while loads on its output domain expect power. | error |
| `sim-min-load` | A rail with `minLoad` loaded below it, e.g. the IP5306 auto shutdown. | warning |
| `sim-outside-model` | A rail beyond `ioutMax`, so its voltages can't be trusted. | warning |
| `sim-floating-input` | A GPIO in `input` state on a floating node (classified before solving; the solver's 0 V is never used as evidence). | warning |
| `sim-no-convergence` | ngspice failed after its own fallbacks. The message names the parts on the nets ngspice reported. | error |
| `sim-incomplete` | Powered parts with no power data, listed. | note |
| `sim-estimate` | N values in the result are estimates, listed. | note |

**Uncertainty decides blocking (Astra finding 8):**
- A finding blocks `gate` only if its severity is `error`, it is at the typical corner, and its `basis` is `topology`, `user` or `datasheet`.
- With `basis` `representative` or `estimate`, the same condition is reported as a **warning**, worded "likely", with the uncertain inputs listed.
- There are no counterfactual runs; the rule is decided from `inputs` alone.

Some examples:
- An LED on 5 V with no resistor exceeds the representative absolute maximum by far. That is a warning ("likely damage"), and the checker's static rules still apply.
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
  - Shift-clicking a second point makes a differential voltage probe.
  - A part probe reads current per pin, plus power.
- **Saving in the sheet:** a new optional top-level field, additive to `circuitoon-diagram/1`. Anchors are part uids and pin names, never wires, so wire edits can't strand a probe.
  ```json
  "probes": [ { "id": "P1", "name": "battery +", "at": { "part": "u3", "pin": "+" } },
              { "id": "P2", "at": { "part": "d1" } },
              { "id": "P3", "at": { "part": "bb1", "pin": "a12" }, "ref": { "part": "u3", "pin": "-" } } ]
  ```
- **Saving in an agent netlist (Astra finding 15):** probes use refs and net names, for example `{ "id": "P1", "at": "BT1.+" }`, `{ "id": "P2", "at": "D1" }` and `{ "id": "P3", "at": "net:VBAT", "ref": "net:GND" }`.
  - `layout` resolves `net:` to a pin on that net, preferring the part named by the probe's `name`, then the lowest ref.
  - `extract` writes probes back in ref form.
  - A round-trip test runs sheet → netlist → layout → sheet.
- **Validation:** ids are unique (`P` plus an integer), and anchors must exist. A dangling probe gives a warning and is dropped, never an error.
- **Drawing:**
  - Each probe is a coloured lead from its point to a reading tag, with colours from a fixed eight-colour order with 3:1 contrast in both themes.
  - Tags avoid parts and each other using the existing label placement.
  - A tag shows typical, with peak if it differs: "4.38 V (peak 4.21 V)". It shows "floating", "undefined" or "-" (Simulate off) as words, and readings outside the model are marked.
- **The Probes panel** (right side; it replaces the inspector tab while the Probe tool is active) holds:
  - the reading list, with rename and delete;
  - **Supplies**: each source, rail and domain with load against limit as a bar, typical and peak, headroom, and provenance;
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
| `failed` or `unavailable` | 3 |

**`gate`** becomes `circuitoon-cli/gate/4`. The full matrix (Astra finding 12):

| Checker | Sim outcome | `blocking` | `ok` | `ready` | Exit | Banner |
|---|---|---|---|---|---|---|
| errors | any | checker errors (+ sim blocking) | false | false | 1 | GATE FAILED |
| clean | `ok`, blocking findings | sim blocking findings | false | false | 1 | GATE FAILED (simulation) |
| clean | `ok`, warnings only | [] | true | per existing readability rules | 0 | GATE PASSED, with warnings |
| clean | `ok`, clean | [] | true | per existing rules | 0 | GATE PASSED |
| clean | `failed` (no convergence) | [the failure] | false | false | 1 | GATE FAILED (simulation did not converge) |
| clean | `unavailable` (engine) | [] | false | false | 3 | GATE INCOMPLETE (simulation unavailable) |

- **New fields:**
  - `sim: { status, findings, budget, provenanceCounts }`;
  - `warnings`, which holds sim warnings; the existing info-only `notes` keeps only notes, including `sim-incomplete` and `sim-estimate`.
- **Compatibility:** gate/4 is a new format. Every reader in the repo is updated: the skill docs, the `NOT_CHECKED` list in `src/agent/notChecked.ts` (simulation is now checked), and the tests. Nothing claims gate/3 readers keep working unchanged.
- **Other commands:**
  - `explain` gains a part's sim data with provenance;
  - `render --sim` draws glow, probes and readings.
- **The `circuitoon-design` skill:** set GPIO states for what the firmware does, run `sim`, fix every blocking finding, and read the warnings, then hand the sheet over.
- **The plugin version** goes to 0.10.0.

## 8. Performance and size budgets

| Item | Budget |
|---|---|
| Engine download (gzip) | ≤ 2.5 MB, fetched only on the first Simulate |
| Cold start in the browser | ≤ 1.5 s on the dev machine, with progress shown |
| One solve (2 runs), 200 parts, Worker end to end | p95 ≤ 30 ms |
| Worker heap after 2,000 runs | ≤ 64 MB above baseline |
| Editor main bundle | at most +30 KB gzip (the engine is never in it) |
| CLI `sim` on the Spirit Typewriter sheet, cold | ≤ 2 s |

## 9. Testing

- **Compiler golden tests:** each device kind, ground and island selection, and name sanitisation (nets named `0`, `gnd`, or with spaces and quotes).
- **Floating classification:**
  - a capacitor-only node;
  - an open switch;
  - a source-less island;
  - a singleton pin;
  - a cross-island differential probe reads "undefined".
- **Accuracy and conservation:**
  - LED + 150 Ω + 5 V gives V(anode) = 2.0008 V ± 1 mV;
  - a battery under load sags by `rInternal`;
  - the converter suite in section 4.3;
  - battery → LDO → GPIO high → LED conserves current;
  - battery → host rail → USB cable → device load conserves current;
  - a dead-rail load draws 0.
- **Findings:** one test per code, both ways (fires and stays quiet). These include:
  - a topological short through a closed switch, and a shorted high-resistance cell;
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
  - `engine:verify` reproduces the committed `.wasm` hash.
- **Probes:** sheet ↔ netlist round trip; dangling anchors dropped with a warning.
- **Spirit Typewriter fixture** (`src/sim/fixtures/`):
  - every powered part has power data with honest provenance, whether datasheet, representative or estimate;
  - rail voltages match hand calculations recorded in the test;
  - the expected findings are listed.
- **Visual:** Playwright with our own Chrome, never the Playwright MCP. Screenshots in light and dark of each probe kind, "floating" and "undefined" tags, glow at three currents, an over-absolute-maximum LED, a brownout badge, both finding groups, the Supplies section, the failure banner and stale readings. Each is reviewed by eye.
- **Perf:** the 200-part drag with Simulate on, and the solve p95 in a Worker.

## 10. Delivery and Astra checkpoints

Michael asked for Astra to be consulted along the way. Each checkpoint gets an Astra review before work continues, and the findings are acted on or answered with reasons.

1. **This spec:** revision 2 goes to Astra for re-review, then to Michael.
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
| Our own WASM build drifts or breaks | Pinned source, emsdk and patches; `engine:verify`; release asset per version |
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
