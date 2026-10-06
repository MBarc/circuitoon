# Code on boards, slice 1: run loop and Raspberry Pi Python

Status: revision 5 (2026-10-06). Revision 5 moves `Buzzer` to the digital devices, as in gpiozero (pre-flight C12). Revision 4 amends 4.2's cross-group combination after the plan found a defect (plan ruling R1).
- Sections 1-3 and the dock layout were approved by Michael in chat. The rest are rulings made under his standing instruction to decide technical calls ("whatever is best for the user experience", "stop asking me so many things").
- Revision 1 was reviewed by a Claude reviewer standing in for Astra (Codex is rate-limited until 2026-10-10). Section 13 answers that review and section 14 the re-review of revision 2. Astra reviews after the reset.

This is the first of five firmware slices:

1. **Run loop and code on parts, with Raspberry Pi Python** (this spec).
2. Arduino C++ on Uno/Nano: in-browser avr-gcc WASM (our own build) + avr8js.
3. MicroPython on Pico: rp2040js + stock MicroPython.
4. I2C/SPI devices (SSD1306, MCP23017, sensors, then ST7796S) for every runtime.
5. ESP32-C3/S3 MicroPython via an esp32sim fork. Classic ESP32 and ESP32 C++ are not feasible in a browser today.

Inputs:
- the in-browser spike (vault `Projects/Circuitoon-Firmware-Spike.md`, 2026-10-06);
- the live DC simulator (`docs/superpowers/specs/2026-10-05-live-simulation-design.md`, shipped as df3328b);
- Michael's answers: everything runs from the GitHub Pages site alone (no compile server, no third-party service); languages are Arduino C++, Pi Python and MicroPython; peripherals are serial, ADC, PWM/servo and I2C/SPI; code is uploaded from a file or typed/pasted and saved on the part under its own key; the sheet stays live while code runs; the editor is a code dock under the sheet (mockup option B).

## 1. Goal

Select a Raspberry Pi 4, Pi 5 or Pi Zero 2 W on the sheet, upload or write a Python script that uses `RPi.GPIO` or `gpiozero`, press Run, and watch the circuit respond: LEDs blink and dim, buttons pressed on the sheet reach the code, servos turn, `print()` appears in a Serial panel. Agents get the same through `circuitoon run`.

**In scope:** the `code` key on parts; the code dock; Pyodide in a worker; `RPi.GPIO` and a `gpiozero` subset; digital in/out, pulls, edge callbacks, PWM (`RPi.GPIO.PWM` and gpiozero's PWM devices), servo; Serial (`print`/`input`); PWM solves; a servo model; Pi sim data; cross-origin isolation for GitHub Pages; self-hosted fonts; `circuitoon run` on a virtual clock; samples.

**Out of scope:** I2C/SPI devices and `smbus`/`spidev` (slice 4); UART/`pyserial`; camera; `pigpio`, `lgpio` and other Pi libraries; Python threads; the Pis' USB-A ports as power sources (they stay "not simulated", with a test); Arduino and Pico (slices 2-3); the part sprites showing switch positions (separate small change).

## 2. Architecture

```
editor (main thread)                          worker per running board
---------------------------------------       ----------------------------------
sampler (solve done, or every 16 ms)  <-SAB-  pin table: mode, latch, PWM descriptor,
 |                                             bit-bang counters      (seqlock)
 v                                            Python scheduler (sleep, input, waits)
store.run[uid] (quantised run pin states)     RPi.GPIO / gpiozero stand-ins
 |                                            Pyodide (pinned release)
buildCircuit(..., {held, runPins})            user script
 |
SimSession (running mode) -> ngspice worker
 |
results -> thresholds + edge counters ---SAB-> input table: level, edges, voltage,
                                               "solved through code seq N" (seqlock)
                                               wake word, interrupt buffer, input line
```

### 2.1 Boards and workers

- **One worker per running board**, each with its own Pyodide. The cap is 4 running boards if the measured heap per board is ≤ 120 MB, otherwise 2 (decided at the Pyodide checkpoint). Run past the cap says "Stop a board first: at most N run at once".
- **Live sheet:** wiring stays editable while code runs, and run-state solves continue during drags (the drag gate in `followStore` exempts them).
- **Deleting** a running board, or changing its module, stops it. **Editing its code** stops nothing: the tab shows "Code changed: Reset to apply". Undo behaves the same.
- **Simulate:** Run turns Simulate on. Turning Simulate off stops every board.
- **Starting:** Run shows status "starting" while Pyodide and the first solve load, then starts the code, or refuses if that first solve shows the board unpowered (section 4.5).

### 2.2 Shared memory

Each board has one SharedArrayBuffer with two tables. Each table is guarded by a **seqlock** (a sequence word that is odd while the writer is mid-update; readers retry until they read the same even value before and after). Integer fields use `Int32Array`/`BigInt64Array`; floats use a `Float64Array` view read inside the seqlock.

- **Code to editor**, per pin:
  - mode (unused, input, input-pullup, input-pulldown, output);
  - output latch (0/1);
  - a **declared PWM descriptor** (active, duty, freqHz), written by `RPi.GPIO.PWM` and every gpiozero PWM device (`PWMOutputDevice`, `PWMLED`, `RGBLED`, `Servo`, `AngularServo`, `Motor`; `Buzzer` is digital, as in gpiozero);
  - for plain writes: wrapping uint32 counters of rising edges, falling edges and high time in µs (read as differences);
  - a code sequence number, bumped on every mode or pull change.
- **Editor to code**, per pin:
  - logic level (0/1, already thresholded by the editor, section 4.4);
  - wrapping rising- and falling-edge counters from the solved levels;
  - solved voltage and status (value, floating, undefined), for warnings and `RPi.GPIO`-style debugging;
  - plus, per board: "solved through code sequence N", the **wake word**, Pyodide's interrupt buffer, and the `input()` line buffer.

### 2.3 The sampler

One sampler is shared by the editor and the CLI. It samples every running board when a solve completes, or every 16 ms by `setTimeout`, whichever comes later (not `requestAnimationFrame`, which stops in hidden tabs). Each sample turns each pin into a **run pin state**:

| Pin | Run pin state |
|---|---|
| unused | none (the saved `gpio.*` state applies) |
| input / pulled | that mode |
| declared PWM active | `pwm {duty}` from the descriptor (duty 0 or 1 becomes `low`/`high`) |
| plain output | over a fixed 100 ms window: if it toggles at `PWM_MIN_HZ` (50 Hz, flicker fusion) or faster, that is 10 or more edges in the window, `pwm {duty = high time / window}`; otherwise the latch level at the sample |

- A slow blink (1 Hz, 10 Hz) therefore shows on and off; only toggling too fast to see is averaged.
- Duty is quantised to 1/64 and only changes past that step, so jitter never re-solves.
- `store.run` is written only when a board's quantised states change. Frequency is not part of the solve key (a DC average does not depend on it); it is kept for the servo.
- Each servo adds a `moving` flag (from its slew model, 3.4) to the run state, so the moving draw is keyed and re-solves twice per move.
- **Run pin states are transient**, like a held button: passed to the solve as `BuildOptions.runPins`, never stored in `values`, no undo entries, the file is not marked changed. Stop removes them, so the saved `gpio.*` states apply again.

### 2.4 SimSession while code runs

Today a finished solve that is not the latest request is dropped (`session.ts:94`). With requests every sample, that would starve the display. In **running mode** (any board running):
- at most one solve is in flight; when it finishes, its result is delivered if it is newer than the one displayed, and the newest pending request starts;
- when no board runs, the existing rule applies unchanged.

A session test drives a request every tick while solves take 3 ticks and requires a delivered result at least every 4 ticks.

### 2.5 Cross-origin isolation on GitHub Pages

SharedArrayBuffer needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot set headers, so we vendor `coi-serviceworker` (MIT, pinned version):
- Configured with `coepCredentialless: () => false` (require-corp, which Chrome, Firefox and Safari 15.2+ support), `quiet: true`, and a `doReload` that never reloads a page holding an unsaved diagram. In that case Run stays disabled until the next load.
- Loaded first in `<head>` as a classic blocking script, before the theme script and the app module, so its reload happens before the app boots and the share-link hash survives.
- It reloads once on the first visit, and once after a hard reload (the page is then uncontrolled).
- `vite.config.ts` sets COOP/COEP in `server.headers` and `preview.headers`, so dev and the UI checks do not depend on the service worker.
- **Fonts are self-hosted:** Atkinson Hyperlegible and Fredoka, latin and latin-ext subsets, the weights in use, with the two above-the-fold weights preloaded; OFL licence files shipped. The Google Fonts lines are the only cross-origin loads today (`index.html:29-31`), so the page then loads nothing cross-origin.
- **Rollback:** a kill-switch service worker (one that unregisters itself and reloads) is kept ready in the repo, because a deployed service worker outlives a revert.
- If isolation is unavailable (service workers refused), the editor works as today and Run is disabled with "Running code needs a browser feature this window has turned off (service workers). Try a normal window."
- Every existing feature is re-checked under isolation: share links, file open/save, clipboard, PNG/SVG export, the GitHub issue form link, the sim worker.

### 2.6 The code worker is a sandbox

A share link carries someone else's code, so the worker must not reach the network or the site's storage:
- **CSP:** the code worker script's response carries `Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`, added by the service worker on the built site and by `server.headers`/`preview.headers` for the worker path in Vite. Pyodide still fetches its own files from the same origin; a static Pages origin leaks nothing. `'unsafe-eval'` is left out, which closes the `Function`-constructor escape; the Pyodide checkpoint confirms Pyodide loads without it (if it cannot, the checkpoint records the finding and the spec is amended).
- **No real globals for Python:** `loadPyodide` gets a curated `jsglobals` object (empty apart from what Pyodide itself needs), and the stand-ins reach the shared memory only through `registerJsModule`. `import js` never sees the worker's global scope.
- **Backstop:** before user code runs, the worker removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` and `Worker` from the global scope **and from their prototypes** (`WorkerGlobalScope.prototype` and relatives), not only from the instance.
- The first Run of code that arrived in a share link asks once in the dock: "This code came with the link. Run runs it in your browser, with no access to other sites." with Run and Cancel.

### 2.7 Pyodide

- A pinned Pyodide release (the exact version, and so the Python version, is fixed at the Pyodide checkpoint). Only the core files and the stdlib are used; no packages, no `micropip`.
- **Web:** the build copies the files from the pinned `pyodide` npm package into `dist/py/<version>/` with a `py.json` manifest (file names, sha256, bytes). Nothing is committed: GitHub Pages is deployed from `dist/`.
- **Loading:** on the first Run the editor prefetches each file with a streamed `fetch` (determinate progress) and verifies the hashes, which warms the HTTP cache. The worker then calls `loadPyodide` with `indexURL` set to the versioned directory (Pyodide fetches its fixed sibling names, now from cache) and `lockFileContents` from the manifest.
- **Old versions stay published:** `scripts/deploy.sh` carries every previously released `py/<version>/` forward from the current `gh-pages` into the new `dist/`, so older plugins pinned to an older Pyodide keep working. If one is ever missing, the CLI says "This plugin's Python runtime is no longer published; update the plugin" (tested).
- GitHub Pages serves `Cache-Control: max-age=600`, so later visits revalidate (cheap 304s) rather than refetch.
- **CLI:** the plugin does not ship Pyodide. On the first `circuitoon run`, the CLI fetches the exact files from the project's own Pages site (`https://mbarc.github.io/circuitoon/py/<version>/`), verifies them against sha256 hashes compiled into `circuitoon.mjs`, and caches them in the user's cache directory. Later runs are offline. `--py-dir <path>` uses a local copy instead (the repo's tests use `node_modules/pyodide`).
- Licences (MPL-2.0 for Pyodide, PSF for CPython, the bundled libraries' own) and a NOTICE ship next to the files. They are the official binaries, unmodified, with a link to the exact source release.
- The loader is its own chunk. The main bundle grows by at most 20 KB gzip for the dock shell.

## 3. Data

### 3.1 The `code` key on a part

```json
{ "uid": "u1", "module": "rpi-4-model-b", "code": { "language": "python-rpi", "source": "from gpiozero import LED\n...", "file": "blink.py" } }
```

- `language`: a string. `python-rpi` runs in this slice; later slices add `arduino-avr` and `micropython`. A language this build does not know is **kept** with a warning, so newer sheets survive older editors.
- `source`: text, at most 256 KB of UTF-8 bytes. `file`: optional original file name, at most 255 characters, no path separators.
- **Validation** (diagram load): wrong types or an oversized source drop the `code` with a load warning naming the part; unknown keys inside `code` are dropped with a warning.
- A language the board does not accept is **kept** and warned about ("U1 is an Arduino Uno; its code is Raspberry Pi Python and won't run").
- The diagram format stays `circuitoon-diagram/1`: the key is optional and old readers already preserve unknown part keys (`diagram.ts:1745-1758`).
- **Share links:** code counts against the existing 64K-character compressed payload; a too-large sheet gets the existing "too big for a link, save a file instead" message.
- **Undo:** uploading, editing and removing code are undoable commits. Typing coalesces through the existing sliding window (`commit(next, 'code:<uid>')`). At the 200-entry history cap, large sources can hold tens of MB; accepted.

### 3.2 Which boards accept which languages

- Modules gain an optional top-level `firmware: { languages: string[] }`. Module validation accepts only known language ids.
- In this slice `rpi-4-model-b`, `rpi-5` and `rpi-zero-2-w` get `["python-rpi"]`.
- **Read from the library**, like sim data: `withLibrarySim` becomes `withLibraryData`, which computes both `sim` and `firmware` from the built-in module with the same id and terminals and returns the stored module unchanged only when both match. Sheets saved before this slice get the Code section. Its existing callers (`build.ts`, `diagram.ts`, `editor/ops.ts`, `agent/netlist.ts`) move to the new name.
- `firmware` is read only through `languagesOf(m)`, which returns `[]` for a custom module (`custom: true`) in this slice; the part maker's module check says firmware on custom parts is not supported yet.

### 3.3 Pi sim data

The three Pis get `electrical.sim.power` and `electrical.sim.gpio`, sourced the same way as the simulator's other boards (per-value provenance, every number checked by two independent reviewers, estimates flagged):
- **Power:** 5V in (the header 5V pins and the USB-C/micro-USB input), the on-board 3V3 rail, the board's typical and peak draw, and the load's `draw.minVolts` (sourced or flagged).
- **GPIO:** domain `3V3`, pins `GPIO2`-`GPIO27`, output resistance, the internal pull-up and pull-down (documented as about 50-65 kΩ), input leakage.
- **The fixed 1.8 kΩ pull-ups on GPIO2/GPIO3** are built as always-present resistors with their own role, so `floating.ts` sees those pins as defined, and `sim-over-limit` and the resistor lists do not show them as user resistors. A build test covers this.
- **Logic thresholds:** new optional `gpio.inputLow` / `gpio.inputHigh` (Quantity volts). BCM2711 is about 0.8 V / 2.0 V at 3.3 V IO, subject to the two-source check. RP1 (Pi 5) values are partly undocumented and are flagged estimates.
- **USB-A ports** on the Pis stay "not simulated": `usbLinks` keeps its current behaviour for these boards, with a test, so adding Pi power data does not turn USB devices into "not powered".

### 3.4 Servo model

`servo-sg90` gets `electrical.sim`, each value with provenance:
- `pulseMin`, `pulseMax`: 500 µs and 2400 µs, the travel real units show. This is a flagged estimate, because it conflicts with the Tower Pro sheet's 1-2 ms for -90 to +90 degrees.
- `slew`: 0.1 s per 60 degrees at 4.8 V (datasheet).
- The PWM pin is an input load (estimate). VCC draws an idle current, and a moving current while the horn is travelling (sourced or flagged).
- Angle = linear map of pulse width (`duty / frequency`) from pulseMin..pulseMax to 0-180 degrees, clamped. The drawn horn moves toward the target at the slew rate.
- A pulse outside 400-2600 µs, or a frequency outside 40-330 Hz, holds the last angle and gives `servo-signal`.
- gpiozero's `Servo` defaults to 1-2 ms, so `Servo.min()` draws at about 47 degrees under this map. That matches many real SG90s, and About the simulator says so.

## 4. Simulation changes

### 4.1 Run pin states in the build

`BuildOptions.runPins` overrides a running board's GPIO states for the solve:

| Run pin state | Solved as |
|---|---|
| input / pull-up / pull-down | the saved states of those names |
| `high` / `low` | `high` / `low` |
| `pwm {duty}` | a PWM pin (4.2) |

`followStore` includes `runPins` in its identity array next to `held`, and the netlist part of `solveKey` is cached by diagram identity so per-sample keys stay cheap.

### 4.2 PWM solves

- **Model:** `GpioDevice.state` gains `pwm`. `Analysis` gains `pins?: Record<deviceId, 'high' | 'low'>`, and `gpioBranch` resolves a `pwm` pin to the high or low branch from the run's `pins`, exactly as for a saved `high`/`low`. `floating.ts` treats `pwm` as driven, so the classification is the same at both levels and `classifyCached` stays per analysis kind.
- **Compilation:** `compile` emits one netlist text per combination, the same way corners are separate texts today, and every text goes to the engine worker in one `runAll` message. No engine change. (A persistent circuit with `alter` per run is a later optimisation with its own engine release.)
- **Groups:** PWM pins are split into groups that interact (connected through anything other than the boards' supply and ground nets). Groups are combined by superposition around one baseline run (every exact group all low, every larger group at round(d)): each exact group adds one run per other combination, each larger group one flip run per pin, and the average is X0 + sum of w_v (X_v - X0). That is exact for one group and for groups that only share a stiff supply, and costs 1 + sum of (2^k - 1) runs (8 for one group of 3). (Revision 4: the shared-runs scheme of revision 3 weighted readings that depend on two groups, such as the shared 5V, wrongly; plan ruling R1.)
- **Weights:** a run's weight is the product over its group's pins of d_i (pin high in that run) or 1 - d_i (pin low). That is exact for pins in separate parts of the circuit, and approximate for pins in the same group, whose real overlap depends on phase. RGBLED channels start their periods together, so a common resistor sees min(d1, d2) overlap rather than d1 x d2; the result carries `pwm-approximate` naming the pins when a group's pins share a resistor.
- **More than 3 pins in one group:** superposition. A baseline run sets every pin j to round(d_j). For each pin i, one run flips i to the other level with the rest at baseline. The averaged reading is baseline + sum over i of (d_i - round(d_i)) x (run with i high - run with i low). That is k + 1 runs. The result carries `pwm-approximate`, and a test compares it with the exact result for 4 pins on separate resistors.
- **What uses the average:** readings, probe tags ("avg 1.21 V"), LED glow (a 30% LED is visibly dimmer), and the servo's pulse.
- **What does not:** findings. Typical-corner findings are the union over every combination run, deduplicated by the existing finding key, keeping the worst reading. An LED with no resistor at 50% duty still blocks. The peak corner runs two combinations, every PWM pin high and every PWM pin low (with the existing peak warnings).
- **Except stopping a board** (4.5), which uses the duty-weighted average, not the union.

### 4.3 Budgets for these solves

- Without PWM: run-state changes re-solve within the existing 50 ms end-to-end budget at 200 parts.
- With one group of 3 PWM pins (8 typical + 2 peak texts, about 15 ms each today): ≤ 200 ms end to end at 200 parts, measured in a perf test next to `solve.perf.test.ts` and confirmed at the PWM checkpoint.

### 4.4 Reading pins

- **Output pins read their own latch** (as a real Pi pad reads its driven level), so gpiozero's `toggle()`, `is_lit` and `value` behave.
- **Input levels are thresholded in the editor**, from the solved voltage, by one shared function the CLI uses too:
  - above `inputHigh` gives 1; below `inputLow` gives 0;
  - in between keeps the previous level (Pi inputs have Schmitt hysteresis); a pin that dwells there for more than 100 ms gives the warning `undefined-level` once per run ("U1 GPIO17 reads 1.4 V, between the low and high thresholds");
  - floating gives a random level per result and `floating-read` once per pin per run;
  - before any result, a pulled input reads its pull level and an unpulled input reads 0.
- **Edges are counted in the editor** from successive solved levels and written as counters, so a press and release while the code sleeps still fires `when_pressed` and `event_detected`.
- **Reads after the code's own setup:** a read after a mode or pull change waits (interruptibly, at most 200 ms) for a result solved through that code sequence, so the first read after `setup(..., PUD_UP)` is not random.
- The voltage behind a read can lag the circuit by one solve. That is fine for hobby scripts (callbacks and button polling work) and is stated in About the simulator.

### 4.5 Power

- Run waits for the first solve ("starting") and refuses if the board's 5V input is not powered: "U1 has no power: connect 5V and GND".
- A running board stops only when its own load's **duty-weighted average** supply voltage at the typical corner is below its `draw.minVolts`: Serial shows "U1 lost power". A dip in one PWM combination is reported (the union) but does not stop the board, as a real Pi rides through it on its capacitors. Peak-corner findings never stop a board.
- A sourced under-voltage note shows when the 5V input is below 4.63 V (Raspberry Pi's documented warning threshold) without stopping anything.

## 5. The Python environment

### 5.1 Stand-ins

- **`RPi.GPIO`** (our own module): `setmode` (BCM and BOARD, with the 40-pin physical-to-BCM map), `setup` (with `pull_up_down` and `initial`), `output`, `input`, `cleanup`, `setwarnings`, `PWM` (`start`, `ChangeDutyCycle`, `ChangeFrequency`, `stop`), `add_event_detect`, `remove_event_detect`, `event_detected`, `add_event_callback`, `wait_for_edge`, `gpio_function`, `RPI_INFO`. Constants as in RPi.GPIO 0.7. On a Pi 5, importing it prints a one-time warning: "RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio".
- **`gpiozero`** (our own subset, same names and signatures): `LED`, `PWMLED`, `RGBLED`, `Buzzer`, `Button`, `LineSensor`, `MotionSensor`, `DigitalInputDevice`, `DigitalOutputDevice`, `PWMOutputDevice`, `Servo`, `AngularServo`, `Motor` (two pins), and `pause`. `blink`, `pulse`, `when_pressed`, `when_released` and `when_held` run from the scheduler (5.2).
- PWM objects write the declared descriptor (2.2); nothing toggles pins to fake PWM.
- Pin names accept BCM numbers, `"GPIO17"`, `"BCM17"`, `"BOARD11"` and `"J8:11"`, as gpiozero does.
- The stand-ins reach the shared memory through a small JS module registered with `pyodide.registerJsModule` (a few functions), never through raw typed arrays in user-visible code.
- **Unsupported** names fail with an error naming the call ("`gpiozero.MCP3008` needs SPI devices, coming in a later update"). Importing `smbus`, `smbus2`, `spidev`, `serial`, `pigpio`, `lgpio` or `picamera2` raises the same kind of error.

### 5.2 The scheduler

- The scheduler is **Python**, in our runtime module. `time.sleep`, `builtins.input`, `gpiozero.pause`, `wait_for_edge`, `wait_for_press`/`wait_for_release` and waits inside our modules all loop: run due timers and callbacks, then block in JS until the next due time, a wake, or the end of the wait. JS only blocks and reports why it woke.
- **Blocking and waking:** JS blocks with `Atomics.wait` on the wake word, for at most 50 ms at a time, calling `pyodide.checkInterrupt()` after each wake. Stop and every new result `Atomics.notify` the wake word, so Stop is prompt and edge callbacks fire as soon as a result lands.
- **Yield points** (where timers and callbacks run): the waits above and every pin read.
- **Not re-entrant:** while a callback runs, yield points inside it only wait; they do not dispatch other callbacks. So `blink()` pauses while a callback sleeps. This differs from real gpiozero, whose callbacks run on threads, and About the simulator says so.
- `time.time` and `time.monotonic` follow the run's clock (real time in the editor, virtual time in the CLI, section 7).
- A script that loops without reaching a yield point keeps running, and Stop still works. After 2 s without a yield point while a timer or callback is pending, Serial shows once: "U1's code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop."
- `threading.Thread.start` raises "Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()".

### 5.3 Serial

- `print` and stderr go to the board's Serial panel (stderr in the error colour), batched per sample. The panel keeps the last 5,000 lines.
- `input()` (our replacement) shows an input box in the panel and waits until Enter. `setStdin` is also set, only so `sys.stdin.readline()` works; no callbacks run inside it.
- An uncaught exception prints the traceback with file `blink.py` (or `main.py`) line numbers. Each line reference links to that line in the editor. The board stops with status "error".

### 5.4 Stop and Reset

- Stop writes the interrupt buffer and notifies the wake word. Python raises `KeyboardInterrupt`, `except`/`finally` blocks and `cleanup` run, and the worker is terminated if it has not finished after 1 s.
- Reset is Stop then Run in a fresh worker, using the already-fetched files. No interpreter state survives between runs.

## 6. Editor

### 6.1 Code dock (mockup option B)

- A dock under the sheet, resizable by a drag handle (height kept in localStorage `circuitoon.dockHeight`), collapsible to a 28 px bar that still shows each board's status.
- **One tab per board that has code**, plus the selected board's tab if it has none yet. The tab label is the designator, the board name and the file name; a dot with a text equivalent shows the status (idle, starting, running, error, code changed).
- **Left: the editor.** CodeMirror 6 with Python highlighting, line numbers and the light and dark themes, in a lazy chunk. Toolbar: one Run/Stop button (its accessible name changes; status changes are announced politely), Reset, Upload, Download, and a language label.
- **Right: Serial.** Output, the input box when `input()` is waiting, and Clear.
- The dock is hidden on a sheet with no coded boards until a board is selected and its Code action is used.
- **Run all / Stop all** appear in the dock bar when two or more boards have code.

### 6.2 Inspector

A **Code** section for boards whose module accepts a language (3.2), after Simulation state:
- with no code: **Upload code** (file picker, `.py`) and **Write code** (opens the dock tab with an empty file and a starter comment);
- with code: file name, language, line count, Run/Stop, **Edit** (focuses the dock tab), **Download** (`<file>` or `<designator>.py`), **Remove code** (undoable).

Uploading reads the file as UTF-8. A file over 256 KB, with invalid UTF-8, or with an extension that does not fit the language (`.ino` on a Pi) is refused with the reason.

### 6.3 On the sheet

- A running board shows a small green "running" badge (red "error" when stopped by an exception), placed with the existing badge placement.
- A servo's horn is drawn at its angle in the sim overlay layer. With `prefers-reduced-motion` it jumps to the angle.
- PWM probe tags read "avg 1.21 V".
- The findings groups gain the run-time findings (`undefined-level`, `floating-read`, `servo-signal`, `pwm-approximate`), deduplicated per pin per run.

### 6.4 Accessibility

- The dock is keyboard reachable: a skip-link from the toolbar, and Ctrl+` toggles it.
- Tabs are a proper tablist; status dots have text equivalents; all controls use the existing focus style.
- CodeMirror's Tab indents; Escape then Tab leaves the editor, and the dock's help text says so.
- Serial output is an `aria-live="polite"` log, throttled to one announcement per second.

## 7. Agents

- **Netlist:** a part entry may carry `code: { language, path }`. `IntentPart` gains `code`. `layout` reads the file and embeds it; the path must be relative, inside the netlist's directory, with no `..`, and must not resolve outside it through a symlink. `circuitoon netlist` writes each board's code next to the netlist as `<designator>.<ext>` and references it. Round-trip tests cover `netlist` and `extract`.
- **`circuitoon run <sheet> [--board U1|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json] [--py-dir <path>]`**
  - Runs the code in Node (`worker_threads`, the same stand-ins and simulator) on a **virtual clock**:
    - every wait and sleep is ours, so a wait advances time straight to its end, the next due timer, or the next `--press` event, whichever is first;
    - every call to `time.time()`, `time.monotonic()` or a pin read advances time by a 10 µs quantum, so busy-waits end and polling loops reach presses;
    - the driver solves only when the quantised run pin states changed since the last solve, or a `--press` fired.
  - Runs are deterministic and faster than real time. Default 5 s of simulated time, maximum 600 s.
  - `--press` holds a button or flips a switch at a time; `--input` feeds `input()` lines in order.
  - Prints Serial output, a pin timeline (changes with timestamps; steady PWM as one line per duty change), and the findings seen during the run. `--json` gives `circuitoon-cli/run/1`.
  - A script that never yields is stopped after 5 s of real time with "U1's code never pauses" (exit 1).
  - Exit codes: 0 ran clean; 1 Python error, blocking finding, lost power, or a script that never yields; 2 usage; 3 incomplete (a board with no sim data, no code, or no power).
- **gate:** a `code-language` error for code a board does not accept, and a `code-unsupported-import` warning from a static scan for the unsupported modules in 5.1. The gate does not run code. No gate format change.
- **The `circuitoon-design` skill:** when a sheet has a Pi with code, run `circuitoon run` and read its findings before handing over.
- **Plugin:** version 0.11.0. Pyodide is fetched on first use (2.7), not shipped.

## 8. Samples and docs

- Sample sheets: **"Blink on a Raspberry Pi"** (Pi 4, LED, 330 Ω, gpiozero `LED.blink`) and **"Button lights an LED on a Pi"** (button on GPIO27 with the internal pull-up, `when_pressed`), both in the start screen's sample list.
- README: what runs, which libraries, the limits (no threads, callbacks not concurrent, no I2C/SPI yet, a one-solve read lag).
- About the simulator: a "Running code" paragraph with the same limits, plus the servo range note.

## 9. Budgets

| Item | Budget |
|---|---|
| Pyodide transfer on first Run | ≤ 8 MB as actually served by GitHub Pages (its `Content-Encoding` for `.wasm` and `.js` measured on the live site at the Pyodide checkpoint); trim the stdlib if over |
| Starting to "running" (dev machine, files cached) | ≤ 2.5 s; first visit ≤ 6 s on a 50 Mbit/s line, with progress |
| Run-state change to re-solved glow, 200 parts, no PWM | ≤ 50 ms (the existing re-solve budget) |
| Same, one group of 3 PWM pins (10 texts) | ≤ 200 ms, confirmed at the PWM checkpoint |
| Editor main bundle | ≤ +20 KB gzip |
| Code dock chunk (CodeMirror + Python mode) | ≤ 150 KB gzip |
| Memory per running board | ≤ 120 MB worker heap (sets the 2-or-4 cap) |
| `circuitoon run --for 5s` on the Pi blink sample, Pyodide cached | ≤ 4 s wall time |

Timing budgets are measured on a quiet machine, as for the simulator.

## 10. Testing

- **Unit (Vitest, Node):**
  - `code` key validation, including unknown languages and oversized sources;
  - module `firmware` validation and library carry-over;
  - the sampler: declared PWM; bit-banged 1 Hz and 10 Hz blinks stay on/off and 200 Hz becomes PWM; quantisation and hysteresis;
  - a combination that browns out at 10% duty is reported but does not stop the board;
  - superposition against the exact result for 4 pins on separate resistors;
  - SimSession running mode (2.4);
  - PWM groups, weights, superposition and the union of findings (an LED with no resistor at 50% still blocks);
  - servo pulse-to-angle and slew;
  - thresholds, hysteresis, the 100 ms dwell warning, floating reads and edge counters.
- **Python stand-ins against real Pyodide in Node:**
  - every listed `RPi.GPIO` call and `gpiozero` class, and BCM/BOARD mapping;
  - output latch reads (`toggle`, `is_lit`), and `Button` not firing at start;
  - callbacks at yield points, non-reentrancy, the never-yields warning, the thread error, unsupported-import errors;
  - Stop during `sleep(10)` raising `KeyboardInterrupt` within 100 ms;
  - `input()` blocking and resuming;
  - the worker sandbox (`fetch`, `WebSocket` and `importScripts` unavailable to user code).
- **Integration on the virtual clock:**
  - the blink sample shows GPIO17 toggling at exactly 1 Hz for 3 s, with the LED's averaged current at the expected duty;
  - `--press` fires `when_pressed`;
  - a press shorter than a solve still fires (edge counters);
  - a `while time.time() < t: pass` loop finishes, and a `while GPIO.input(BTN): pass` loop sees a `--press`;
  - a missing Pyodide version gives the "no longer published" message.
- **Sim data:** Pi values validate, provenance is present, two-reviewer checks are recorded, the GPIO2/3 pull-up build test passes, and Pi USB ports stay "not simulated".
- **Browser check (`npm run check:code-ui`, playwright-core on our own Chrome):**
  - isolation is active after one reload, and the share-link hash survives it;
  - on the built site, user code calling `js.fetch`, or reaching the worker's prototypes through `js`, cannot make a cross-origin request;
  - the blink sample's glow toggles, and Serial shows output;
  - an exception's line link jumps to the line;
  - Stop restores the saved states and leaves the file unchanged and the undo stack untouched;
  - running continues during a drag;
  - budgets measured;
  - screenshots of idle, starting, running, error, code-changed and stopped, in light and dark, at desktop and 390 px width, all viewed.
- **Regression under isolation:** the existing UI checks (sim, guides, part maker) pass with the service worker active, and the kill-switch worker unregisters cleanly in a test page.

## 11. Delivery

1. Cross-origin isolation, self-hosted fonts, kill switch. This changes every page load, so it ships first and alone.
2. `code` key, module `firmware` with library carry-over, Pi sim data (sourced, reviewed), servo data.
3. Pyodide files, loader, worker sandbox, shared memory and seqlocks, Python scheduler, stand-ins, Node runner with the virtual clock.
4. Sampler, run pin states, SimSession running mode, PWM groups and findings union, servo model, thresholds and edges.
5. Code dock, Inspector section, badges, Serial.
6. `circuitoon run`, netlist/layout code, gate checks, skill, samples, docs.

Checkpoints: a Claude reviewer (Astra after 2026-10-10) reviews this spec, the shared-memory protocol and scheduler after step 3, and the whole branch before merge. Shipping goes through `circuitoon-ship` after the ship gates (full tests and timing on a quiet machine, the browser check, and live verification of Run on the deployed site).

## 12. Risks

| Risk | Mitigation |
|---|---|
| The service worker breaks something on first load or in some browser | Ships as its own step; regression checks under isolation; Run is disabled (not the editor) when isolation fails; kill-switch worker ready |
| A reload after a deploy loses unsaved work | `doReload` never reloads a page with an unsaved diagram |
| Shared-link code misuses the browser | Worker sandbox (2.6), CSP, first-run confirmation |
| Pyodide too large or slow on first Run | Budget checkpoint on the served size; stdlib trim; progress; HTTP cache |
| Users' scripts use threads, concurrent callbacks or unsupported libraries | Clear errors naming the call and the alternative; About the simulator; the gate's static scan for agents |
| The one-solve read lag confuses tight polling loops | Output latch reads; edge counters; sequence waits after setup; documented |
| PWM combinations slow the solve | Grouping, the 3-pin exact limit, the peak fallback, the perf test |
| Pi 5 RP1 data partly undocumented | Flagged estimates; estimates never block (existing rule) |
| The CLI's first run needs the network | Stated in the README; `--py-dir` for offline use |

## 13. Answers to review 1

| # | Finding | Answer |
|---|---|---|
| F1 | SimSession starves under continuous requests | Running mode delivers any newer result (2.4), with a test |
| F2 | Frame sampling aliases PWM and servos | Declared PWM descriptors; bit-bang windows of max(100 ms, 4 periods); 1/64 hysteresis (2.2, 2.3) |
| F3 | Findings on averaged solves hide over-current | Findings are the union over combination runs; averages only for readings and glow; weights spelled out (4.2) |
| F4 | Interrupt buffer does not wake `Atomics.wait` | Wake word, 50 ms bounded waits, `checkInterrupt` (5.2, 5.4) |
| F5 | Re-entrancy and `input()` | Python scheduler, non-reentrant, our own `input`, `registerJsModule` (5.1-5.3) |
| F6 | Output latch, start-up reads, reads after setup | Latch reads, pull-level defaults, sequence waits (4.4) |
| F7 | Lost edges | Editor-side thresholds and edge counters (2.2, 4.4) |
| F8 | k > 3 approximation, "exact" overstated | Interaction groups, superposition, honest wording (4.2) |
| F9 | Compilation path and budgets | Two-branch PWM pins with `alter`, `Analysis.pins`, restated budgets (4.2, 4.3, 9) |
| F10 | Brownout, Run before the first solve, USB ports | `minVolts` at typical only, "starting", 4.63 V note, USB ports stay unsimulated (3.3, 4.5) |
| F11 | `firmware` on old sheets and custom modules | Library carry-over; ignored on custom modules (3.2) |
| F12 | The worker is not a sandbox | Globals removed, CSP, first-run confirmation for link code (2.6) |
| F13 | coi-serviceworker configuration | require-corp config, guarded reload, head placement, Vite headers, kill switch (2.5) |
| F14 | No sampling clock; counter overflow; float atomics | One sampler on solve or 16 ms timers; wrapping counters; seqlocks (2.2, 2.3) |
| F15 | CLI real time; Pyodide in git twice | Virtual clock; Pyodide copied at build for the web and fetched on first use by the CLI, nothing committed (2.7, 7). Ruled by me under Michael's standing instruction |
| F16 | followStore and SimSession integration | `runPins` beside `held`, drag exemption, quantised writes, cached netlist key, no frequency in the key (2.3, 4.1) |
| F17 | Pyodide layout, progress, caching | Versioned directory, prefetch with progress, honest caching note (2.7) |
| F18 | Budget depends on Pages compression | Measured as served (9) |
| F19 | Servo data | Pulse range and slew in data with provenance; slewed horn (3.4) |
| F20 | RPi.GPIO on Pi 5, "hardware PWM" | Pi 5 warning; wording fixed (1, 5.1) |
| F21 | `code` key details | UTF-8 bytes, unknown languages kept, edits do not stop runs, history note (2.1, 3.1) |
| F22 | Netlist `code.path` | Confined relative paths, `IntentPart.code`, round-trip tests (7) |
| F23 | Accessibility | Escape-Tab, reduced motion, one Run/Stop button (6.1, 6.3, 6.4) |
| F24 | Fonts | latin + latin-ext, preloads (2.5) |
| F25 | Pi data | Pull-up role and build test, 100 ms dwell before warning (3.3, 4.4) |
| F26 | YAGNI | Frequency hint and frame measurement for library PWM removed; the cap depends on measured memory (2.1, 2.2) |

## 14. Answers to the re-review of revision 2

| # | Finding | Answer |
|---|---|---|
| N1 | The bit-bang window turns Blink into a dim LED | Fixed 100 ms window; PWM only at 50 Hz or faster; 1/10/200 Hz tests (2.3) |
| N2 | The CSP blocks Pyodide; deleting globals is no sandbox | CSP with `'wasm-unsafe-eval'` and same-origin `connect-src`, curated `jsglobals`, prototype removal, `lockFileContents`, the prefetch only warms the cache, Vite headers, a built-site browser check (2.6, 2.7, 10) |
| N3 | `alter` does not exist; 150 ms unreachable | One text per combination, no engine change; peak at all-high and all-low; ≤ 200 ms confirmed at the checkpoint (4.2, 4.3, 9) |
| N4 | PWM highs stop boards | Stop decided from the duty-weighted average; the union is for reporting (4.2, 4.5) |
| N5 | The virtual clock hangs | 10 µs quantum per time call and pin read; solve only on state change; tests (7, 10) |
| N6 | Older plugins lose Pyodide | Deploy carries old `py/<version>/` forward; clear message if missing (2.7) |
| N7 | No `pwm` state in the model | `GpioDevice.state` `pwm`, `gpioBranch` from `pins`, driven for `floating.ts` (4.2) |
| N8 | Sandbox tests need the built site | Built-site browser check (10) |
| N9 | `withLibrarySim` details | `withLibraryData` checks both fields; `languagesOf` returns `[]` for custom modules (3.2) |
| N10 | Superposition undefined | Formula stated and tested (4.2) |
| N11 | Servo motion without a solve key | `moving` flag in the run state (2.3) |
