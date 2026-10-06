# Code on boards, slice 1: run loop and Raspberry Pi Python

Status: revision 1 (2026-10-06). Sections 1-3 approved by Michael in chat; the rest are rulings made under his standing instruction to decide technical calls ("whatever is best for the user experience", "stop asking me so many things"). Astra reviews after the Codex reset (2026-10-10); a Claude reviewer stands in until then.

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

**In scope:** the `code` key on parts; the code dock; Pyodide in a worker; `RPi.GPIO` and a `gpiozero` subset; digital in/out, pulls, edge callbacks, software and hardware PWM, servo; Serial (`print`/`input`); time-averaged PWM solves; a servo model; Pi sim data; cross-origin isolation for GitHub Pages; self-hosted fonts; `circuitoon run`; samples.

**Out of scope:** I2C/SPI devices and `smbus`/`spidev` (slice 4); UART/`pyserial`; camera; `pigpio`, `lgpio` and other Pi libraries; Python threads; Arduino and Pico (slices 2-3); the part sprites showing switch positions (separate small change).

## 2. Architecture

```
editor (main thread)                        worker per running board
-------------------------------------       ---------------------------------
store.run[uid] {status, pinsOut}  <--SAB--  RPi.GPIO / gpiozero stand-ins
 |  read each animation frame                 Pyodide (CPython 3.12 WASM)
 v                                            user script
solveKey includes run pin states            Atomics.wait for sleep and input()
 |                                     --SAB-> pin voltages + interrupt flag
SimSession.request -> ngspice worker
 |
results -> pin voltages written to SAB
```

- **One worker per running board**, each with its own Pyodide. At most 4 boards run at once; a fifth Run says "Stop a board first: at most 4 run at once".
- **Shared memory (SharedArrayBuffer) per board:**
  - *code to editor*, per pin: mode (unused/input/input-pullup/input-pulldown/output), level, high-time accumulator (ns), edge count, PWM frequency hint; plus a sequence number.
  - *editor to code*, per pin: solved voltage (float), a status (value/floating/undefined), the result's revision; plus the interrupt flag (Pyodide's interrupt buffer) and the `input()` line buffer.
- **Each animation frame** the editor reads every running board's table. A pin whose level changed during the frame becomes a PWM pin for that frame, with duty = high time / frame time and frequency from the edge count or the PWM object. Otherwise it is a steady level. These become the board's *run pin states* (section 4).
- **Run pin states are transient**, like a held button: never saved, no undo entries, the file is not marked changed. Stop restores the saved `gpio.*` states.
- **Live sheet:** wiring stays editable while code runs. Deleting a running board, or changing its code or module, stops that board first.
- **Simulate:** Run turns Simulate on. Turning Simulate off stops every board.

### 2.1 Cross-origin isolation on GitHub Pages

SharedArrayBuffer needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot set headers, so we vendor `coi-serviceworker` (MIT, pinned):
- On the first visit the service worker installs and the page reloads once. Later visits are isolated from the first byte.
- **Fonts are self-hosted** (Atkinson Hyperlegible, Fredoka; both OFL, licence files shipped), so the page loads nothing cross-origin. This also removes the only third-party request.
- If isolation is unavailable (service workers blocked, private modes that refuse them), the editor works as today and Run is disabled with "Running code needs a browser feature this window has turned off (service workers). Try a normal window."
- Every existing feature is re-checked under isolation: share links, file open/save, clipboard, PNG/SVG export, the GitHub issue form link, the sim worker.

### 2.2 Pyodide

- Pinned Pyodide release, self-hosted under `public/py/` with a manifest (`py.json`: version, per-file sha256 and bytes), hash-versioned URLs and determinate progress, mirroring `public/sim/`.
- Only the core and the stdlib are fetched; no package downloads at run time. `micropip` is not shipped.
- Licences (MPL-2.0 for Pyodide, PSF for CPython, and the bundled libraries' own) and a NOTICE ship next to it. We ship the official binaries unmodified and link the exact source release.
- Loading is lazy (first Run) and the loader is its own chunk; the main bundle grows by at most 20 KB gzip for the dock shell.

## 3. Data

### 3.1 The `code` key on a part

```json
{ "uid": "u1", "module": "rpi-4-model-b", "code": { "language": "python-rpi", "source": "from gpiozero import LED\n...", "file": "blink.py" } }
```

- `language`: `python-rpi` in this slice. Later slices add `arduino-avr` and `micropython`.
- `source`: UTF-8 text, at most 256 KB. `file`: optional original file name, at most 255 characters, no path separators.
- **Validation** (diagram load): a malformed `code` (wrong types, too large) is dropped with a load warning naming the part. Unknown keys inside `code` are dropped with a warning.
- A language the module does not accept is **kept** and warned about ("U1 is an Arduino Uno; its code is Raspberry Pi Python and won't run").
- The diagram format stays `circuitoon-diagram/1`: the key is optional and old readers already preserve unknown part keys.
- **Share links:** code counts against the existing 64K-character compressed payload. A too-large sheet gives the existing "too big for a link, save a file instead" message.
- **Undo:** uploading, editing (coalesced per editing pause of 1 s) and removing code are undoable commits.

### 3.2 Which boards accept which languages

Modules gain an optional top-level `firmware: { languages: string[] }`. In this slice `rpi-4-model-b`, `rpi-5` and `rpi-zero-2-w` get `["python-rpi"]`. Module validation accepts only known language ids.

### 3.3 Pi sim data

The three Pis get `electrical.sim.power` and `electrical.sim.gpio`, sourced the same way as the simulator's other boards (per-value provenance, every number checked by two independent reviewers, estimates flagged):
- power topology: 5V in (header 5V pins and the USB-C/micro-USB input), the on-board 3V3 rail, the board's typical and peak draw;
- `gpio`: domain `3V3`, pins `GPIO2`-`GPIO27`, output resistance, the internal pull-up and pull-down (BCM2711/BCM2712/RP3A0), input leakage;
- the fixed 1.8 kΩ pull-ups on GPIO2/GPIO3 (I2C) as always-present resistors;
- logic thresholds (new optional `gpio.inputLow` / `gpio.inputHigh`, Quantity volts) used by pin reads.

Where a number has no primary source (Pi 5's RP1 drive strength is configurable and only partly documented), the value is a flagged estimate and the existing `estimate` note shows it.

### 3.4 Servo model

`servo-sg90` gets `electrical.sim`: the PWM pin is an input load (estimate), VCC draws idle and moving current (sourced or flagged estimates). Angle = linear map of pulse width 500-2400 µs to 0-180°, clamped; pulses outside 400-2600 µs or a frequency outside 40-330 Hz hold the last angle and give a warning `servo-signal`. The pulse width comes from the PWM pin state (`duty / frequency`).

## 4. Simulation changes

### 4.1 Run pin states

A running board's pins override its saved `gpio.*` states for the solve:

| Code says | Solved as |
|---|---|
| unused | the saved state (default `input`) |
| input / pull-up / pull-down | the same as the saved states of those names |
| output, steady level | `high` / `low` |
| output, toggling in this frame | `pwm {duty, freqHz}` |

`solveKey` includes the run pin states, quantised (duty to 1/256, frequency to 1 Hz) so jitter does not cause re-solves.

### 4.2 Time-averaged PWM solves

- With k PWM pins on the sheet, the solve runs every high/low combination of those pins (2^k runs at the typical corner) and averages each reading weighted by the product of duties. This is exact for the average current through LEDs and resistors when the pins' phases are independent.
- Up to k = 3 exactly. Above 3, the 3 pins with duty nearest 50% are combined exactly and the rest use their majority level; the result carries a note `pwm-approximate` naming the pins.
- The peak corner is solved once, with every PWM pin high (the worst case for current limits).
- Readings for a pin's own net under PWM report the average voltage, and the probe tag says "avg".
- LED glow uses the averaged current, so a 30% PWM LED is visibly dimmer.

### 4.3 Reading pins

When the code reads a pin, the stand-in uses the latest solved voltage for that pin:
- above `inputHigh` gives 1; below `inputLow` gives 0;
- in between, it keeps the pin's previous value and raises a warning `undefined-level` ("U1 GPIO17 reads 1.4 V, between the low and high thresholds");
- floating gives a random bit per read and a warning `floating-read` once per pin per run;
- no result yet (first frame, solve pending) gives the last known value, or 0 before any.

The voltage a read uses can lag the code's own writes by one solve. That is acceptable at the speeds hobby scripts run (edge callbacks and button polling work); it is stated in About the simulator.

### 4.4 Power

- A board with no power (its 5V node not powered by the solve) refuses Run: "U1 has no power: connect 5V and GND".
- A running board whose 5V input falls below its brownout voltage stops: Serial shows "U1 lost power (5V input 4.1 V)".

## 5. The Python environment

### 5.1 Stand-ins

- **`RPi.GPIO`** (our own module): `setmode` (BCM and BOARD, with the 40-pin physical-to-BCM map), `setup` (with `pull_up_down` and `initial`), `output`, `input`, `cleanup`, `setwarnings`, `PWM` (`start`, `ChangeDutyCycle`, `ChangeFrequency`, `stop`), `add_event_detect`, `remove_event_detect`, `event_detected`, `add_event_callback`, `wait_for_edge`, `gpio_function`, `RPI_INFO`. Constants as in RPi.GPIO 0.7.
- **`gpiozero`** (our own subset, same names and signatures): `LED`, `PWMLED`, `RGBLED`, `Buzzer`, `Button`, `LineSensor`, `MotionSensor`, `DigitalInputDevice`, `DigitalOutputDevice`, `PWMOutputDevice`, `Servo`, `AngularServo`, `Motor` (two pins), and `pause`. Background behaviour (`blink`, `pulse`, `when_pressed`, `when_released`, `when_held`) runs from a cooperative scheduler, below.
- Pin names accept BCM numbers, `"GPIO17"`, `"BCM17"`, `"BOARD11"` and `"J8:11"`, as gpiozero does.
- **Unsupported** names fail with a clear error naming the call ("`gpiozero.MCP3008` needs SPI devices, coming in a later update"). Importing `smbus`, `spidev`, `serial`, `pigpio`, `lgpio` or `picamera2` raises the same kind of error.

### 5.2 Time and the cooperative scheduler

- `time.sleep` blocks for real time with `Atomics.wait`, and wakes early to run due callbacks and timers. `time.time` and `time.monotonic` are real clocks.
- **Yield points:** `time.sleep`, `gpiozero.pause`, `Event.wait` inside our modules, `wait_for_edge`, `wait_for_press`/`wait_for_release`, `input()`, and every pin read. At each yield point the scheduler runs due timers (`blink`, `pulse`, software PWM bookkeeping) and edge callbacks.
- A script that loops without ever reaching a yield point keeps running (and Stop still works), but background behaviour cannot run. After 2 s without a yield point while a background behaviour is pending, Serial shows a one-time warning: "U1's code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop."
- `threading.Thread.start` raises "Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()".

### 5.3 Serial

- `print` and stderr go to the board's Serial panel (stderr in the error colour). Output is batched per frame; the panel keeps the last 5,000 lines.
- `input()` shows an input box in the panel and blocks the code until Enter.
- An uncaught exception prints the traceback with file `blink.py` (or `main.py`) line numbers. Each line reference is a link that jumps to that line in the editor. The board stops with status "error".

### 5.4 Stop and Reset

- Stop sets the interrupt flag (`KeyboardInterrupt` in Python, which also wakes `Atomics.wait`), runs `cleanup`, and terminates the worker if it has not finished after 1 s.
- Reset is Stop then Run, reusing the cached Pyodide files (the worker restarts; the interpreter is not reused, so no state leaks between runs).

## 6. Editor

### 6.1 Code dock (mockup option B)

- A dock under the sheet, resizable by a drag handle (height kept in localStorage `circuitoon.dockHeight`), collapsible to a 28 px bar that still shows each board's status.
- **One tab per board that has code** (plus the selected board's tab, if it has none yet). The tab label is the designator, the board name and the file name; a dot shows status (idle, loading, running, error).
- **Left: the editor.** CodeMirror 6 with Python highlighting, line numbers, the light and dark themes, and a lazy chunk (not in the main bundle). Toolbar: Run/Stop, Reset, Upload, Download, and a language label.
- **Right: Serial.** Output, the input box when `input()` is waiting, and Clear.
- The dock is hidden on a sheet with no coded boards until a board is selected and its Code action is used.
- **Run all / Stop all** appear in the dock bar when two or more boards have code.

### 6.2 Inspector

A **Code** section for boards whose module declares `firmware`, after Simulation state:
- with no code: **Upload code** (file picker, `.py`), **Write code** (opens the dock tab with an empty file and a starter comment);
- with code: file name, language, line count, Run/Stop, **Edit** (focuses the dock tab), **Download** (`<file>` or `<designator>.py`), **Remove code** (undoable).
- On a board without `firmware`: no section. Slices 2-5 add their boards.

Uploading reads the file as UTF-8 text; a file over 256 KB or with invalid UTF-8 is refused with the reason. A file whose extension does not fit the language (`.ino` on a Pi) is refused with a hint.

### 6.3 On the sheet

- A running board shows a small green "running" badge (red "error" when stopped by an exception), placed with the existing badge placement.
- A servo's horn is drawn at its angle in the sim overlay layer.
- PWM probe tags read "avg 1.21 V".
- The findings groups gain the run-time findings (`undefined-level`, `floating-read`, `servo-signal`, `pwm-approximate`), deduplicated per pin per run.

### 6.4 Accessibility

The dock is keyboard reachable (a skip-link from the toolbar, Ctrl+` toggles it), tabs are a proper tablist, the Serial output is an `aria-live="polite"` log throttled to one announcement per second, status dots have text equivalents, and all controls meet the existing focus style.

## 7. Agents

- **Netlist:** a part entry may carry `code: { language, path }`; `layout` reads the file (relative to the netlist) and embeds it. `circuitoon netlist` writes the code out next to the netlist as `<designator>.<ext>` and references it.
- **`circuitoon run <sheet> [--board U1|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json]`**
  - Runs the code in Node (`worker_threads`, the same Pyodide files shipped in the plugin, the same stand-ins) against the same simulator, in real time, for the given duration (default 5 s, maximum 60 s).
  - `--press` holds a button or flips a switch at a time; `--input` feeds `input()` lines in order.
  - Prints Serial output, a pin timeline (changes with timestamps, steady PWM as one line per change), and the findings seen during the run. `--json` gives `circuitoon-cli/run/1`.
  - Exit codes: 0 ran clean; 1 Python error, blocking finding, or lost power; 2 usage; 3 incomplete (a board with no sim data, no code, or no power).
- **gate:** a `code-language` error for code a board does not accept, and a `code-unsupported-import` warning from a static scan for the unsupported modules in 5.1. The gate does not run code. No gate format change.
- **The `circuitoon-design` skill:** when a sheet has a Pi with code, run `circuitoon run` and read its findings before handing over.
- **Plugin:** the Pyodide files ship in the plugin's `dist-cli` (offline, deterministic). Plugin version 0.11.0.

## 8. Samples and docs

- Sample sheets: **"Blink on a Raspberry Pi"** (Pi 4, LED, 330 Ω, gpiozero `LED.blink`) and **"Button lights an LED on a Pi"** (button on GPIO27 with the internal pull-up, `when_pressed`), both in the start screen's sample list.
- README: what runs, which libraries, the limits (no threads, no I2C/SPI yet, timing lag of one solve).
- About the simulator: a "Running code" paragraph with the same limits.

## 9. Budgets

| Item | Budget |
|---|---|
| Pyodide transfer on first Run (compressed) | ≤ 8 MB, measured at the Pyodide checkpoint; trim the stdlib if over |
| Cold start to "running" (dev machine, files cached) | ≤ 2.5 s; first visit ≤ 6 s on a 50 Mbit/s line, with progress |
| Pin change in code to the re-solved glow | ≤ 2 frames at 200 parts with no PWM; ≤ 100 ms with 3 PWM pins (8 runs) |
| Editor main bundle | ≤ +20 KB gzip |
| Code dock chunk (CodeMirror + Python mode) | ≤ 150 KB gzip |
| Memory per running board | ≤ 120 MB worker heap |
| `circuitoon run --for 1s` on the Pi blink sample, cold | ≤ 4 s total |

Timing budgets are measured on a quiet machine (as for the simulator).

## 10. Testing

- **Unit (Vitest, Node):** `code` key validation; module `firmware` validation; run pin states to solve states; PWM combination weights (k = 0-4, the approximation note); servo pulse-to-angle; pin read thresholds, hysteresis and floating.
- **Python stand-ins against real Pyodide in Node:** every listed `RPi.GPIO` call and `gpiozero` class, BCM/BOARD mapping, edge callbacks at yield points, the never-yields warning, the thread error, unsupported-import errors, KeyboardInterrupt on Stop, `input()` blocking and resuming.
- **Integration:** the blink sample in Node shows GPIO17 toggling at 1 Hz ± 5% for 3 s, and the LED's averaged current at the expected duty; a button press via `--press` fires `when_pressed`.
- **Sim data:** Pi values validate, provenance present, two-reviewer checks recorded.
- **Browser check (`npm run check:code-ui`, playwright-core on our own Chrome):** isolation active after one reload; the blink sample's LED glow toggles; Serial shows output; an exception's line link jumps to the line; Stop restores saved states and leaves the file unchanged and the undo stack untouched; budgets measured; screenshots of idle, loading, running, error and stopped in light and dark at desktop and 390 px width, all viewed.
- **Regression under isolation:** the existing UI checks (sim, guides, part maker) pass with the service worker active.

## 11. Delivery

1. Cross-origin isolation + self-hosted fonts (ships first and alone if needed: it changes every page load).
2. `code` key, module `firmware`, Pi sim data (sourced, reviewed).
3. Pyodide engine files, loader, worker, shared-memory protocol, stand-ins, Node runner.
4. Run pin states, PWM solves, servo model, pin reads.
5. Code dock, Inspector section, badges, Serial.
6. `circuitoon run`, netlist/layout code, gate checks, skill, samples, docs.

Checkpoints: a Claude reviewer (Astra after 2026-10-10) reviews the spec, the shared-memory protocol after step 3, and the whole branch before merge. Ship through `circuitoon-ship` after the ship gates (full tests + timing on a quiet machine, browser check, live verification of Run on the deployed site).

## 12. Risks

| Risk | Mitigation |
|---|---|
| The service worker breaks something on first load or in some browser | Ships as its own step, regression checks under isolation, Run disabled (not the editor) when isolation fails |
| Pyodide too large or slow on first Run | Budget checkpoint; stdlib trim; progress shown; files cached by hash |
| Users' scripts use threads or unsupported libraries | Clear errors naming the call and the alternative; the gate's static scan for agents |
| One-solve read lag confuses tight polling loops | Documented; callbacks fire at yield points; reads never return stale values older than the last finished solve |
| PWM combinations slow the solve | k ≤ 3 exact, approximate note above that; budgets |
| Pi 5 RP1 drive data partly undocumented | Flagged estimates, never a blocking finding from an estimate (existing rule) |
