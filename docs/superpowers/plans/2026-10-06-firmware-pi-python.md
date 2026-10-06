# Code on Boards, Slice 1 (Run Loop and Raspberry Pi Python) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select a Raspberry Pi 4, Pi 5 or Pi Zero 2 W on the sheet, upload or write a Python script that uses `RPi.GPIO` or `gpiozero`, press Run, and watch the live DC simulation respond (LEDs blink and dim, buttons reach the code, servos turn, `print()` shows in Serial), with the same available to agents through `circuitoon run`.

**Architecture:** One Pyodide per running board in a sandboxed worker. Each board shares one SharedArrayBuffer with the page: a code-to-editor pin table (modes, latches, declared PWM, bit-bang counters) and an editor-to-code input table (thresholded levels, edge counters, voltages), each behind a seqlock. A sampler shared by the editor and the CLI turns pin tables into transient run pin states (`BuildOptions.runPins`), the existing `SimSession` solves them (in a new running mode, PWM pins as duty-weighted combinations of high and low runs), and the results are thresholded back into the input tables. Python's own scheduler (our `_circuitoon` module) owns every wait; JS only blocks on a wake word. The editor runs on real time; `circuitoon run` drives the same workers on a virtual clock.

**Tech Stack:** Pyodide (exact release pinned at the Pyodide checkpoint, Task 11; `314.0.7` is the candidate); TypeScript (erasable syntax only); React 19; Vite 8; vitest 5; CodeMirror 6 (`@codemirror/*`, lazy chunk); `coi-serviceworker` 0.1.7 (MIT, vendored with one marked patch); Fontsource packages for the self-hosted fonts (OFL); Node `worker_threads`; Web Workers; `Atomics`; playwright-core for the browser checks.

**Spec:** `docs/superpowers/specs/2026-10-06-firmware-pi-python-design.md` (revision 5). Read it fully before any task. It builds on the live simulation (`docs/superpowers/specs/2026-10-05-live-simulation-design.md`, shipped as df3328b); its plan (`docs/superpowers/plans/2026-10-05-live-simulation.md`) shows the sourcing protocol and the test conventions this plan reuses.

## Global Constraints

Copied verbatim from the spec. Every task's requirements include this section.

- "**One worker per running board**, each with its own Pyodide. The cap is 4 running boards if the measured heap per board is ≤ 120 MB, otherwise 2 (decided at the Pyodide checkpoint). Run past the cap says "Stop a board first: at most N run at once"." (2.1)
- "**Live sheet:** wiring stays editable while code runs, and run-state solves continue during drags (the drag gate in `followStore` exempts them)." (2.1)
- "**Deleting** a running board, or changing its module, stops it. **Editing its code** stops nothing: the tab shows "Code changed: Reset to apply". Undo behaves the same." (2.1)
- "**Simulate:** Run turns Simulate on. Turning Simulate off stops every board." (2.1)
- "**Starting:** Run shows status "starting" while Pyodide and the first solve load, then starts the code, or refuses if that first solve shows the board unpowered (section 4.5)." (2.1)
- "Each table is guarded by a **seqlock** (a sequence word that is odd while the writer is mid-update; readers retry until they read the same even value before and after). Integer fields use `Int32Array`/`BigInt64Array`; floats use a `Float64Array` view read inside the seqlock." (2.2)
- "a **declared PWM descriptor** (active, duty, freqHz), written by `RPi.GPIO.PWM` and every gpiozero PWM device" (2.2); "for plain writes: wrapping uint32 counters of rising edges, falling edges and high time in µs (read as differences); a code sequence number, bumped on every mode or pull change." (2.2)
- "One sampler is shared by the editor and the CLI. It samples every running board when a solve completes, or every 16 ms by `setTimeout`, whichever comes later (not `requestAnimationFrame`, which stops in hidden tabs)." (2.3)
- "plain output: over a fixed 100 ms window: if it toggles at `PWM_MIN_HZ` (50 Hz, flicker fusion) or faster, that is 10 or more edges in the window, `pwm {duty = high time / window}`; otherwise the latch level at the sample" (2.3)
- "Duty is quantised to 1/64 and only changes past that step, so jitter never re-solves." "`store.run` is written only when a board's quantised states change. Frequency is not part of the solve key" (2.3)
- "Each servo adds a `moving` flag (from its slew model, 3.4) to the run state, so the moving draw is keyed and re-solves twice per move." (2.3)
- "**Run pin states are transient**, like a held button: passed to the solve as `BuildOptions.runPins`, never stored in `values`, no undo entries, the file is not marked changed. Stop removes them, so the saved `gpio.*` states apply again." (2.3)
- "In **running mode** (any board running): at most one solve is in flight; when it finishes, its result is delivered if it is newer than the one displayed, and the newest pending request starts; when no board runs, the existing rule applies unchanged." (2.4)
- "A session test drives a request every tick while solves take 3 ticks and requires a delivered result at least every 4 ticks." (2.4)
- "Configured with `coepCredentialless: () => false` (require-corp, which Chrome, Firefox and Safari 15.2+ support), `quiet: true`, and a `doReload` that never reloads a page holding an unsaved diagram. In that case Run stays disabled until the next load." (2.5)
- "Loaded first in `<head>` as a classic blocking script, before the theme script and the app module, so its reload happens before the app boots and the share-link hash survives." (2.5)
- "`vite.config.ts` sets COOP/COEP in `server.headers` and `preview.headers`, so dev and the UI checks do not depend on the service worker." (2.5)
- "**Fonts are self-hosted:** Atkinson Hyperlegible and Fredoka, latin and latin-ext subsets, the weights in use, with the two above-the-fold weights preloaded; OFL licence files shipped." "the page then loads nothing cross-origin." (2.5)
- "**Rollback:** a kill-switch service worker (one that unregisters itself and reloads) is kept ready in the repo, because a deployed service worker outlives a revert." (2.5)
- "If isolation is unavailable (service workers refused), the editor works as today and Run is disabled with "Running code needs a browser feature this window has turned off (service workers). Try a normal window."" (2.5)
- "Every existing feature is re-checked under isolation: share links, file open/save, clipboard, PNG/SVG export, the GitHub issue form link, the sim worker." (2.5)
- "**CSP:** the code worker script's response carries `Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`" "`'unsafe-eval'` is left out ... the Pyodide checkpoint confirms Pyodide loads without it (if it cannot, the checkpoint records the finding and the spec is amended)." (2.6)
- "`loadPyodide` gets a curated `jsglobals` object (empty apart from what Pyodide itself needs), and the stand-ins reach the shared memory only through `registerJsModule`. `import js` never sees the worker's global scope." (2.6)
- "before user code runs, the worker removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` and `Worker` from the global scope **and from their prototypes**" (2.6)
- "The first Run of code that arrived in a share link asks once in the dock: "This code came with the link. Run runs it in your browser, with no access to other sites." with Run and Cancel." (2.6)
- "Only the core files and the stdlib are used; no packages, no `micropip`." (2.7) "the build copies the files from the pinned `pyodide` npm package into `dist/py/<version>/` with a `py.json` manifest (file names, sha256, bytes). Nothing is committed" (2.7)
- "`scripts/deploy.sh` carries every previously released `py/<version>/` forward from the current `gh-pages` into the new `dist/`" "If one is ever missing, the CLI says "This plugin's Python runtime is no longer published; update the plugin" (tested)." (2.7)
- "**CLI:** the plugin does not ship Pyodide. On the first `circuitoon run`, the CLI fetches the exact files from the project's own Pages site (`https://mbarc.github.io/circuitoon/py/<version>/`), verifies them against sha256 hashes compiled into `circuitoon.mjs`, and caches them in the user's cache directory. Later runs are offline. `--py-dir <path>` uses a local copy instead (the repo's tests use `node_modules/pyodide`)." (2.7)
- "Licences (MPL-2.0 for Pyodide, PSF for CPython, the bundled libraries' own) and a NOTICE ship next to the files. They are the official binaries, unmodified, with a link to the exact source release." (2.7)
- "The loader is its own chunk. The main bundle grows by at most 20 KB gzip for the dock shell." (2.7)
- "`source`: text, at most 256 KB of UTF-8 bytes. `file`: optional original file name, at most 255 characters, no path separators." "wrong types or an oversized source drop the `code` with a load warning naming the part; unknown keys inside `code` are dropped with a warning." "A language this build does not know is **kept** with a warning" "A language the board does not accept is **kept** and warned about ("U1 is an Arduino Uno; its code is Raspberry Pi Python and won't run")." (3.1)
- "The diagram format stays `circuitoon-diagram/1`" "code counts against the existing 64K-character compressed payload" "Typing coalesces through the existing sliding window (`commit(next, 'code:<uid>')`)." (3.1)
- "`withLibrarySim` becomes `withLibraryData`, which computes both `sim` and `firmware` from the built-in module with the same id and terminals and returns the stored module unchanged only when both match." "`firmware` is read only through `languagesOf(m)`, which returns `[]` for a custom module (`custom: true`) in this slice; the part maker's module check says firmware on custom parts is not supported yet." (3.2)
- "The three Pis get `electrical.sim.power` and `electrical.sim.gpio`, sourced the same way as the simulator's other boards (per-value provenance, every number checked by two independent reviewers, estimates flagged)" "**The fixed 1.8 kΩ pull-ups on GPIO2/GPIO3** are built as always-present resistors with their own role" "**USB-A ports** on the Pis stay "not simulated"" (3.3)
- Servo (3.4): "`pulseMin`, `pulseMax`: 500 µs and 2400 µs ... a flagged estimate"; "`slew`: 0.1 s per 60 degrees at 4.8 V (datasheet)"; "A pulse outside 400-2600 µs, or a frequency outside 40-330 Hz, holds the last angle and gives `servo-signal`."
- PWM solves (4.2): "`compile` emits one netlist text per combination ... every text goes to the engine worker in one `runAll` message. No engine change." "findings ... Typical-corner findings are the union over every combination run, deduplicated by the existing finding key, keeping the worst reading. An LED with no resistor at 50% duty still blocks. The peak corner runs two combinations, every PWM pin high and every PWM pin low" "Except stopping a board (4.5), which uses the duty-weighted average, not the union." (amended by ruling R1 below)
- Reading pins (4.4): "Output pins read their own latch" "above `inputHigh` gives 1; below `inputLow` gives 0; in between keeps the previous level ... more than 100 ms gives the warning `undefined-level` once per run" "floating gives a random level per result and `floating-read` once per pin per run" "before any result, a pulled input reads its pull level and an unpulled input reads 0" "a read after a mode or pull change waits (interruptibly, at most 200 ms) for a result solved through that code sequence" (4.4)
- Power (4.5): "U1 has no power: connect 5V and GND"; "Serial shows "U1 lost power""; "A sourced under-voltage note shows when the 5V input is below 4.63 V".
- Python environment (5.1 to 5.4): the listed `RPi.GPIO` calls and gpiozero classes; "On a Pi 5, importing it prints a one-time warning: "RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio""; "PWM objects write the declared descriptor (2.2); nothing toggles pins to fake PWM."; "Unsupported names fail with an error naming the call ("`gpiozero.MCP3008` needs SPI devices, coming in a later update")"; "JS blocks with `Atomics.wait` on the wake word, for at most 50 ms at a time, calling `pyodide.checkInterrupt()` after each wake"; "**Not re-entrant**"; "After 2 s without a yield point while a timer or callback is pending, Serial shows once: "U1's code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop.""; "`threading.Thread.start` raises "Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()""; "The panel keeps the last 5,000 lines."; "the worker is terminated if it has not finished after 1 s"; "Reset is Stop then Run in a fresh worker, using the already-fetched files."
- Editor (6): "height kept in localStorage `circuitoon.dockHeight`), collapsible to a 28 px bar"; "The tab label is the designator, the board name and the file name; a dot with a text equivalent shows the status (idle, starting, running, error, code changed)"; "one Run/Stop button (its accessible name changes; status changes are announced politely), Reset, Upload, Download, and a language label"; Inspector "**Upload code** (file picker, `.py`) and **Write code**" "**Download** (`<file>` or `<designator>.py`), **Remove code** (undoable)"; "A file over 256 KB, with invalid UTF-8, or with an extension that does not fit the language (`.ino` on a Pi) is refused with the reason."; "PWM probe tags read "avg 1.21 V""; "With `prefers-reduced-motion` it jumps to the angle."; "a skip-link from the toolbar, and Ctrl+` toggles it"; "Escape then Tab leaves the editor, and the dock's help text says so"; "Serial output is an `aria-live="polite"` log, throttled to one announcement per second." (6)
- Agents (7): "`circuitoon run <sheet> [--board U1|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json] [--py-dir <path>]`"; "every call to `time.time()`, `time.monotonic()` or a pin read advances time by a 10 µs quantum"; "Default 5 s of simulated time, maximum 600 s."; "`--json` gives `circuitoon-cli/run/1`"; "A script that never yields is stopped after 5 s of real time with "U1's code never pauses" (exit 1)."; "Exit codes: 0 ran clean; 1 Python error, blocking finding, lost power, or a script that never yields; 2 usage; 3 incomplete (a board with no sim data, no code, or no power)."; "gate: a `code-language` error ... and a `code-unsupported-import` warning ... No gate format change."; "**Plugin:** version 0.11.0."
- Budgets (9): "Pyodide transfer on first Run ≤ 8 MB as actually served by GitHub Pages"; "Starting to "running" (dev machine, files cached) ≤ 2.5 s; first visit ≤ 6 s on a 50 Mbit/s line, with progress"; "Run-state change to re-solved glow, 200 parts, no PWM ≤ 50 ms"; "Same, one group of 3 PWM pins (10 texts) ≤ 200 ms, confirmed at the PWM checkpoint"; "Editor main bundle ≤ +20 KB gzip"; "Code dock chunk (CodeMirror + Python mode) ≤ 150 KB gzip"; "Memory per running board ≤ 120 MB worker heap (sets the 2-or-4 cap)"; "`circuitoon run --for 5s` on the Pi blink sample, Pyodide cached ≤ 4 s wall time". "Timing budgets are measured on a quiet machine, as for the simulator."
- Checkpoints (11): "a Claude reviewer (Astra after 2026-10-10) reviews this spec, the shared-memory protocol and scheduler after step 3, and the whole branch before merge. Shipping goes through `circuitoon-ship` after the ship gates (full tests and timing on a quiet machine, the browser check, and live verification of Run on the deployed site)."

### Repo and writing rules (from the controller; they apply to every task too)

- Work only in `C:/Users/micha/Desktop/projects/Circuitoon-firmware` on branch `firmware` (a git worktree). Always `cd` there. Never switch branches. Never use bare `git stash` (the stash stack is shared with other worktrees); set work aside with a WIP commit.
- No em dashes or en dashes anywhere: code, comments, Python, CSS, docs, UI text, commit messages. Use hyphens.
- UI copy is plain sentence-case English with no jargon ("Run", "Stop", "Code changed: Reset to apply", never "Execute" or "Interpreter").
- Every UI state is visually validated: screenshots taken with playwright-core driving our own Chrome (`scripts/lib/browser-check.mjs` `launchChrome()`), never the Playwright MCP, never the shared debugging ports 9333 or 9335; each screenshot is opened and looked at, in light and dark, before the task is done.
- Pi and servo simulation numbers are sourced with per-value provenance and checked by two independent reviewers (the Sourcing protocol below). A wrong number is worse than a missing one.
- Never name or compare Circuitoon with other diagramming products (the repo is public; Michael's standing rule names the one to avoid), anywhere: code, docs, UI text, commits.
- Timing tests and budgets are measured on a quiet machine; a miss on a busy machine is re-measured, never relaxed.
- Erasable TypeScript only (`erasableSyntaxOnly` is on): no enums, no namespaces, no constructor parameter properties. Node runs some `src/` files directly (the Node workers re-run their own `.ts` file under vitest), so worker-side files import nothing Vite-specific (`import.meta.glob`, `?raw`, `import.meta.env`).
- Tests are vitest: `npx vitest run <file>`. `npm test` is the full suite; `npm run validate`, `npm run check:gen` and `npm run build` must pass at the end of every task that touches `src/`, `modules/` or `scripts/`.
- The CLI bundle is committed and the suite compares it with the source. Every task that changes `src/` or `modules/` runs `npm run build:cli` before committing and adds `plugin/dist-cli/circuitoon.mjs` to that task's `git add`.
- Research subagents never put Michael's email or any personal data in a User-Agent or any request field.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Checkpoints: a Claude reviewer stands in for Astra until 2026-10-10 (Codex is rate-limited); Astra reviews afterwards. The controller records every checkpoint outcome and ruling in its ledger (`.superpowers/sdd/2026-10-06-firmware-pi-python/progress.md`, git-ignored).

## Rulings on spec ambiguities

The plan rules on these so no task has to. Each is referenced where it applies.

| # | Ambiguity or defect | Ruling |
|---|---|---|
| R1 | Spec 4.2 lets groups that do not interact "share runs: run r sets each group to its r-th combination". A reading that depends on two groups (the shared 5V supply, a board's own supply voltage, which decides lost power in 4.5) is then averaged with the wrong weights, because run r is not the product of the groups' combinations. | Cross-group superposition around one baseline. The baseline run sets every exact group (k ≤ 3) to all low and every superposition group (k > 3) to `round(d)`. Each exact group adds a run per other combination c (weight `w(c)` = product of `d_i` or `1 - d_i`); each superposition group adds one flip run per pin (weight `|d_i - round(d_i)|`). The average is `X0 + Σ_v w_v (X_v - X0)`. It is exact for a single group and for groups that only share a stiff supply, and costs `1 + Σ (2^k - 1)` runs: 8 typical runs for one group of 3, the budgeted case, unchanged. |
| R2 | "Module validation accepts only known language ids" would make an older editor refuse a newer sheet whose embedded Uno module says `arduino-avr`. | The known ids are every slice's planned language: `python-rpi`, `arduino-avr`, `micropython`. Only `python-rpi` runs in this build (`RUNNABLE`). |
| R3 | The data shape for the GPIO2/GPIO3 fixed pull-ups and the logic thresholds | `sim.gpio.fixedPullups: [{ pin, ohms: Quantity }]` (pull-ups to the GPIO domain), `sim.gpio.inputLow` and `sim.gpio.inputHigh` (Quantity, V). The resistors are `role: 'internal'`, a new role for always-present resistors inside a part. |
| R4 | The data shape for the servo model (spec 3.4) | `sim.servo: { signal: <pin>, pulseMin, pulseMax (s), slew (s per 60 degrees), moving (A), signalLoad (ohm) }`, a new `SimUnit` `'s'`, plus an ordinary `sim.power` (domain `VCC`, draw typical = idle). The signal load is a resistor from the signal pin to the servo's ground, `role: 'internal'`; `BuildOptions.moving` swaps the typical draw for `moving`. |
| R5 | Run-time finding names | Verbatim from the spec: `undefined-level`, `floating-read`, `servo-signal` are `RunFinding` codes (the run layer's, never `sim-` codes); `pwm-approximate` is a `SimCode` (a note from the solve). Neither kind ever blocks `gate`. |
| R6 | `pwm-approximate` "when a group's pins share a resistor" | Every group of two or more PWM pins carries it (their pins are in one group because something joins them), and every superposition group. A superset, never a miss. |
| R7 | Which probe tags read "avg" | Every reading of a solve with at least one PWM pin is a duty-weighted average, so every tag says "avg" then. |
| R8 | The 4.63 V under-voltage threshold's provenance | `PI_UNDER_VOLTAGE` in `src/run/power.ts` with its source URL in the comment; the Pi research task (Task 8) verifies it with the two reviewers like any value. |
| R9 | "the board's 5V input" | The Pi data names its 5 V domain `5V`; `boardPower` reads that domain. A board refused at the start for a supply below its `minVolts` gets the same message as an unpowered one ("U1 has no power: connect 5V and GND"). |
| R10 | Exceptions inside a callback or timer | Printed (traceback filtered to the user's file) and the script goes on, as gpiozero's callback threads do. Only an uncaught exception in the main script stops the board with status "error". |
| R11 | Traceback frames from our stand-ins | Dropped: a printed traceback lists only frames from the user's file (`blink.py` or `main.py`), so every line reference is a line the user can jump to. |
| R12 | `input()` prompt | The prompt goes to the input box's label, not into stdout (Pyodide's batched stdout would hold it until the next newline); on Enter the panel appends `<prompt><line>` to Serial, like a terminal echo. |
| R13 | "the start screen's sample list" (the start screen has one sample card) | A "Raspberry Pi samples" row of two smaller cards under the three start cards. |
| R14 | "placed with the existing badge placement" | The run badge is a pill at the body's top-right corner: the checker's mark owns the top left and simulation findings the top centre. |
| R15 | The Pyodide budget is "measured on the live site at the Pyodide checkpoint", before anything of this slice ships | The checkpoint measures GitHub Pages' `Content-Encoding` rule on the live site with the files it already serves (`sim/ngspice.wasm`, `sim/ngspice.mjs`, `sim/engine.json`), then computes the transfer from that rule (gzip -6 where Pages compresses, raw where it does not). The ship gate (final checkpoint) re-measures the real `py/<version>/` files on the deployed site. |
| R16 | Several boards on one virtual clock (spec 7 describes one board's waits) | Discrete events: every worker reports `block(now, until)`; when all are blocked the driver sets the clock to the earliest `until`, press or end, samples, solves if needed, writes inputs and then grants every worker its clock: it writes `F.clockMs` and `F.horizonMs`, then bumps `H.grant` and wakes (`grant()` in memory.ts). A worker moves on only when `H.grant` changes (or Stop is set), never on another wake such as an input write or a line, so nothing the driver writes before the grant is read early; a worker that is not due blocks again. A pin read past the driver's horizon (the next press, the next 16 ms sample or the end) syncs too, so polling loops reach presses, and so does a read while a setup is not yet solved (`codeSeq > solvedThrough`), so it gets its solve at the same instant; time calls only step 10 us. (Amended by the CP3 fix.) |
| R17 | Overlapping `--press` events | `BuildOptions.held` is one button, as in the editor (one pointer): two presses that overlap in time are a usage error (exit 2). A latching switch's press flips it at its time (the duration is ignored). |
| R18 | `circuitoon netlist` without `-o` has no "next to the netlist" | The code is inlined as `{ "language", "source", "file" }`, a form `parseNetlist` accepts beside `{ "language", "path" }`. |
| R19 | The code worker's CSP needs a header GitHub Pages cannot set, from a vendored worker the spec calls pinned | `coi-serviceworker` 0.1.7 is vendored verbatim plus one patch marked `Circuitoon patch`: the fetch handler adds the CSP to the code worker's script (`/assets/codeWorker-*.js`). In dev and preview a small Vite plugin adds the same header to the worker's URL. |
| R20 | Where the fonts come from | `@fontsource/atkinson-hyperlegible` and `@fontsource/fredoka` (OFL, pinned exact): their latin and latin-ext `woff2` files for Atkinson 400 and 700 and Fredoka 500 and 600 (the weights `index.html` loads today) are copied into `public/fonts/` and committed with `OFL.txt`. |
| R21 | Floating reads must be random, but CLI runs must be deterministic | The random level comes from a small PRNG (mulberry32) seeded from the board's uid, so a run repeats exactly. |
| R22 | How Python files reach a worker that Node runs straight from its `.ts` file | The host imports them (`src/run/pyFiles.ts`, `import.meta.glob` with `?raw`, bundled by Vite in the site and the CLI) and posts them in the start message; the worker writes them into Pyodide's file system. |
| R23 | The servo's signal is a PWM descriptor's duty and frequency | The run layer reads the driving pin's declared descriptor (or, for a bit-banged pin, its window estimate: frequency = edges / 2 / window) on the servo's signal net; the solve is not needed for the angle. |
| R24 | A servo's starting angle (the spec gives the slew, not where a servo starts) | It starts at its first commanded angle and slews only from there on: no motion from an unknown position. |
| R25 | "when a solve completes, or every 16 ms by setTimeout, whichever comes later" (spec 2.3) | At most one sample per solve: the editor samples when a solve lands if 16 ms have passed since the last sample, else 16 ms after the last sample; while a solve it asked for is in flight it waits for it. The CLI samples at every driver step. |
| R26 | Whether `circuitoon run` takes a netlist | Sheets only, as the spec's synopsis says; a netlist is laid out first (`layout` embeds its code, Task 38). |
| R27 | A page that is not isolated although service workers exist (the reload was held back over an unsaved diagram, spec 2.5) | Run is disabled with "Reload the page to run code (save your work first)."; the spec's own message is for windows without service workers. |
| R28 | The never-pauses signal for code that has not reached a single yield point (`LED(17).blink()` then `while True: pass`) | Registering a timer, callback or poller marks it pending at once (`circuitoon_hw.pending`), and the last yield counts from the run's start, so that case is caught. |

Pre-flight rulings C1-C28 (2026-10-06) are applied in the task text.

## File Structure

New files:

| Path | Responsibility |
|---|---|
| `public/coi-serviceworker.js`, `public/coi-serviceworker.LICENSE.txt` | The cross-origin isolation service worker (vendored 0.1.7, one patch) and its MIT licence |
| `scripts/rollback/coi-serviceworker.js` | The kill switch: copy it over `public/coi-serviceworker.js` and deploy to roll isolation back |
| `public/fonts/*.woff2`, `public/fonts/OFL.txt` | Self-hosted fonts (ruling R20) |
| `scripts/check-isolation-ui.mjs` | Browser check: isolation through the service worker on a header-less server, the hash, unsaved pages, the kill switch, fonts |
| `src/isolation.ts` | The unsaved flag the service worker's reload guard reads |
| `src/isolation.test.ts`, `src/fonts.test.ts` | The head order, the vendored worker's headers and reload guard, Vite headers, no cross-origin loads |
| `src/format/code.ts` | The `code` key on a part, languages, `languagesOf`, file checks |
| `scripts/gen-py.mjs`, `scripts/copy-py.mjs`, `scripts/carry-py.mjs`, `py/NOTICE.txt`, `py/LICENSE-*.txt` | The pinned Pyodide manifest (generated, checked by `check:gen`), the copy into `dist/py/<version>/` at build, carrying old versions forward at deploy, licences |
| `src/run/pyManifest.json` | Generated: Pyodide version, Python version, each file's sha256 and bytes |
| `src/run/limits.ts` | The Pyodide checkpoint's results: the board cap, measured heap and the jsglobals Pyodide needs |
| `src/run/boards.ts` | Which modules run code, their kind (`pi4`, `pi5`, `zero2w`) and BCM pin names |
| `src/run/memory.ts` | The shared memory layout, seqlocks, pin and input tables |
| `src/run/protocol.ts` | Messages between a code worker and its host |
| `src/run/bridge.ts` | `circuitoon_hw`, the JS module Python calls, and the real, virtual and test clocks |
| `src/run/py/_circuitoon.py` | The Python scheduler, time, `input`, threads, unsupported imports, tracebacks, `main` |
| `src/run/py/RPi/__init__.py`, `src/run/py/RPi/GPIO.py` | The `RPi.GPIO` stand-in |
| `src/run/py/gpiozero/__init__.py` | The `gpiozero` subset |
| `src/run/pyFiles.ts` | The Python files as text (host side, ruling R22) |
| `src/run/unsupported.ts` | The unsupported module and name list the gate scans for (kept equal to the Python one) |
| `src/run/worker/serve.ts`, `src/run/worker/sandbox.ts` | The code worker's loop (both workers) and the global-scope backstop |
| `src/run/browser/codeWorker.ts`, `src/run/browser/prefetch.ts` | The browser worker entry and the streamed, hash-checked prefetch |
| `src/run/node/codeWorker.ts`, `src/run/node/pyCache.ts` | The Node worker (host and worker in one file, as `nodeEngine.ts`) and the CLI's Pyodide download cache |
| `src/run/host.ts` | `BoardRun`: one board's worker, memory, Stop and the 1 s terminate |
| `src/run/levels.ts` | Thresholds, hysteresis, the dwell warning, floating reads, edge counters |
| `src/run/sampler.ts` | Pin table to run pin states: declared PWM, the bit-bang window, quantisation |
| `src/run/servo.ts` | Pulse to angle, slew, the signal check |
| `src/run/power.ts` | Starting, lost power and the under-voltage note |
| `src/run/core.ts` | `RunCore`: the sampler, levels, servos and power for every running board, shared by the editor and the CLI |
| `src/run/driver.ts` | `drive()`: the virtual-clock driver behind `circuitoon run` |
| `src/sim/pwm.ts` | PWM groups, the run plan and the weights (ruling R1) |
| `src/editor/runEngine.ts` | The editor's run controller (lazy chunk): workers, prefetch, RunCore, store |
| `src/editor/running.ts` | The main-bundle side: what Run needs, and actions that load the controller |
| `src/editor/CodeDock.tsx`, `src/editor/SerialPanel.tsx`, `src/editor/CodeEditor.tsx`, `src/editor/codeDock.css` | The dock shell, Serial, the CodeMirror editor (lazy) and their styles |
| `src/editor/codeFile.ts` | Uploads (refused with the reason), download names, the starter comment, Serial's traceback links and announcements |
| `src/cli/codeFiles.ts`, `src/cli/codeFindings.ts` | Code files beside a netlist (embed, write out); the gate's code checks |
| `scripts/py-checkpoint.mjs` | The Pyodide checkpoint's measurements |
| `src/run/testing.ts`, `src/run/pyHarness.testing.ts`, `src/run/sheets.testing.ts`, `src/run/memoryWriter.testing.ts` | Test helpers: Node workers on node_modules/pyodide, the in-process harness, Pi test sheets, the seqlock writer |
| `src/samples/piSamples.ts` | The two Raspberry Pi sample sheets |
| `src/cli/runCmd.ts` | `circuitoon run` |
| `plugin/skills/circuitoon-design/references/schemas/run.schema.json` | The `circuitoon-cli/run/1` schema |
| `scripts/check-code-ui.mjs` | Browser check and screenshots of every code state, budgets, the built-site sandbox |

Modified files: `index.html`, `vite.config.ts`, `src/styles.css`, `package.json`, `package-lock.json`, `scripts/deploy.sh`, `.gitignore`, `src/format/diagram.ts`, `src/format/module.ts`, `src/format/simModel.ts`, `src/format/simState.ts`, `src/format/partMaker.ts`, `scripts/gen-usb.mjs`, `scripts/gen-outputs.mjs` (the servo), `scripts/lib/parts.mjs` (`firmware` in `moduleJson`), `scripts/lib/browser-check.mjs`, `scripts/check-isolation-ui.mjs`, `scripts/sim-data/*.json` (new patches), `modules/rpi-4-model-b.json`, `modules/rpi-5.json`, `modules/rpi-zero-2-w.json`, `modules/servo-sg90.json`, `src/sim/model.ts`, `src/sim/build.ts`, `src/sim/power.ts`, `src/sim/floating.ts`, `src/sim/spice.ts`, `src/sim/findings.ts`, `src/sim/results.ts`, `src/sim/session.ts`, `src/sim/display.ts`, `src/editor/store.ts`, `src/editor/ops.ts`, `src/editor/simulation.ts`, `src/editor/simEngine.ts`, `src/editor/Editor.tsx`, `src/editor/EditorApp.tsx`, `src/editor/Inspector.tsx`, `src/editor/Canvas.tsx`, `src/editor/SimLayer.tsx`, `src/editor/ProbeLayer.tsx`, `src/editor/SimulationGroup.tsx`, `src/editor/ProbesPanel.tsx`, `src/editor/Toolbar.tsx`, `src/editor/StartScreen.tsx`, `src/editor/editor.css`, `src/agent/netlist.ts`, `src/agent/place.ts`, `src/agent/extract.ts`, `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/layoutCmd.ts`, `src/cli/netlistCmd.ts`, `src/cli/gate.ts`, `plugin/skills/circuitoon-design/SKILL.md`, `plugin/skills/circuitoon-design/references/cli.md`, `plugin/skills/circuitoon-design/references/netlist-format.md`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `docs/PRD.md`.

### Interface registry

Every exported name later tasks rely on, with the task that makes it. A task's own Interfaces block repeats what it consumes and produces.

| Name | Signature | Task |
|---|---|---|
| `PartCode` | `{ language: string; source: string; file?: string }` (on `PartInstance.code`) | 4 |
| `checkCode` | `(raw: unknown, who: string) => { code: PartCode \| null; warnings: string[] }` | 4 |
| `KNOWN_LANGUAGES`, `RUNNABLE`, `LANGUAGE_NAMES`, `LANGUAGE_EXT`, `SOURCE_MAX_BYTES`, `utf8Bytes`, `fileProblem` | see Task 4 | 4 |
| `languagesOf` | `(m: ModuleDef \| undefined) => string[]` | 5 |
| `withLibraryData` | `(stored: ModuleDef, library?: (id: string) => ModuleDef \| undefined) => ModuleDef` | 5 |
| `GpioSpec.inputLow`, `.inputHigh`, `.fixedPullups` | `Quantity`, `Quantity`, `{ pin: string; ohms: Quantity }[]` | 6 |
| resistor role `'internal'` | `Device` resistor `role` gains `'internal'` | 6 |
| `ServoSpec`, `SimSpec.servo`, `SimUnit` `'s'` | `{ signal: string; pulseMin: Quantity; pulseMax: Quantity; slew: Quantity; moving: Quantity; signalLoad: Quantity }` | 7 |
| `BuildOptions.moving` | `string[]` (servo uids) | 7 |
| `PY` (pyManifest.json) | `{ version: string; python: string; files: { name: string; sha256: string; bytes: number }[] }` | 10 |
| `MAX_RUNNING`, `PY_JSGLOBALS` | `number`, `string[]` | 11 |
| `BoardKind`, `BOARD_KINDS`, `boardKindOf`, `gpioPin`, `bcmOf` | `'pi4' \| 'pi5' \| 'zero2w'`; `(m) => BoardKind \| null`; `(bcm: number) => string`; `(pin: string) => number \| null` | 12 |
| `boardMemory`, `MODE`, `IN_STATUS`, `H`, `F`, `NPINS`, `writeLocked`, `readLocked`, `readOut`, `writeIn`, `readIn`, `wake`, `interrupt`, `PinOut`, `PinIn`, `BoardMemory` | see Task 12 | 12 |
| `makeHw`, `RunClock`, `realClock`, `testClock`, `HwOptions` | see Task 13 | 13 |
| `virtualClock` | `(m: BoardMemory, post: (m: FromCode) => void, checkInterrupt: () => void) => RunClock` | 18 |
| `PY_FILES` | `Record<string, string>` (path under `src/run/py/` to text) | 13 |
| `ToCode`, `FromCode`, `RunStatus` | see Task 17 | 17 |
| `serveCode`, `sandbox`, `BoardRun`, `CodeWorkerLike`, `spawnNodeCodeWorker` | see Task 17 | 17 |
| `ensurePy`, `NO_LONGER_PUBLISHED` | `(o: { pyDir?: string; cacheDir?: string; fetch?: typeof fetch; base?: string }) => Promise<{ dir: string; indexURL: string; lock: string }>` | 19 |
| `RunPinState`, `RunPins` | `GpioState \| { pwm: number }`; `Record<string, Record<string, RunPinState>>` (in `simState.ts`) | 20 |
| `LevelTracker`, `thresholdsOf`, `Thresholds`, `PinLevel` | see Task 20 | 20 |
| `BoardSampler`, `quantize`, `PWM_MIN_HZ`, `WINDOW_MS`, `DUTY_STEP`, `SampledPin` | see Task 21 | 21 |
| `BuildOptions.runPins`, `Analysis.pins`, `gpioBranch(d, pins?)`, `GpioDevice.state` `'pwm'` and `.duty` | see Task 22 | 22 |
| `pwmPlan`, `PwmPlan`, `mixRaws` | see Task 23 | 23 |
| `analyseRuns`, `SimResult.pwm`, `SimCode` `'pwm-approximate'` | see Task 24 | 24 |
| `SimSession.setRunning`, `onOutcome(o, c?, opts?)`, `SolveOptions.runSeq` | see Task 25 | 25 |
| `servoTarget`, `slewToward`, `servoLimitsOf`, `ServoLimits` | see Task 27 | 27 |
| `boardPower`, `PI_UNDER_VOLTAGE` | see Task 28 | 28 |
| `RunCore`, `RunFinding`, `RunCode`, `ServoView` | see Task 29 | 29 |
| `drive`, `DriveOptions`, `DriveResult`, `Press` | see Task 30 | 30 |
| `RunView`, `BoardRunView`, `SerialLine`, `DockState`, `EMPTY_RUN`, store methods | see Task 31 | 31 |
| `RunController`, `controllerFor`, `runAction`, `runBlocker`, `codeBoards`, `disposeRuns`, `prefetchPy` | see Task 32 | 32 |
| `readCodeFile`, `downloadName`, `starterCode`, `lineRef`, `announcement`, `SerialPanel` | see Task 33 | 33 |
| `CodeEditor`, `CodeDock`, `dockTabs`, `tabStatus` | see Task 34 | 34 |
| `CodeSection` (Inspector) | see Task 35 | 35 |
| `runBadges`, `hornPath`, `RUN_TITLES`, `readingText(r, avg)` | see Task 36 | 36 |
| `startStatic`, the `--sw` flag | see Task 37 | 37 |
| `IntentPart.code`, `embedCode`, `writeCode` | see Task 38 | 38 |
| `runCommand`, `parseDuration`, `parsePress`, `RUN_FORMAT` | see Task 39 | 39 |
| `UNSUPPORTED_MODULES`, `UNSUPPORTED_GPIOZERO`, `unsupportedImports`, `codeFindings` | see Task 40 | 40 |
| `PI_SAMPLES`, `piBlinkSample`, `piButtonSample` | see Task 41 | 41 |

---
# Phase A: cross-origin isolation, self-hosted fonts, kill switch (spec 11 step 1)

This phase changes every page load, so it ships first and alone (checkpoint after Task 3).

### Task 1: Self-hosted fonts

**Files:**
- Create: `public/fonts/` (eight `woff2` files and `OFL.txt`), `src/fonts.test.ts`
- Modify: `index.html` (drop the Google Fonts lines 29-31, add two preloads), `src/styles.css` (the `@font-face` rules), `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the faces "Atkinson Hyperlegible" 400 and 700 and "Fredoka" 500 and 600, latin and latin-ext, served from `/circuitoon/fonts/`; `index.html` with no cross-origin load (Task 2's COEP would block one).

- [ ] **Step 1: Install the pinned font packages**

Run: `npm i -D -E @fontsource/atkinson-hyperlegible@5.3.0 @fontsource/fredoka@5.3.0`
Expected: both in `devDependencies` with exact versions (no caret).

- [ ] **Step 2: Write the failing test**

`src/fonts.test.ts`:

```ts
// Firmware spec 2.5: the fonts are self-hosted (latin and latin-ext, the weights in use, the two
// above-the-fold weights preloaded, OFL shipped), so the page loads nothing cross-origin, which
// COEP require-corp would block. Each @font-face's unicode-range is the Fontsource package's own.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/styles.css', 'utf8')
const FACES = [
  ['atkinson-hyperlegible', 'Atkinson Hyperlegible', 400], ['atkinson-hyperlegible', 'Atkinson Hyperlegible', 700],
  ['fredoka', 'Fredoka', 500], ['fredoka', 'Fredoka', 600],
] as const

describe('self-hosted fonts (spec 2.5)', () => {
  it('loads nothing cross-origin from index.html', () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    // og: and twitter: meta URLs are not loads; every href and src is same-origin.
    const loads = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    expect(loads.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([])
  })
  it('has a woff2 face per family, weight and subset, each with the package unicode-range', () => {
    for (const [pkg, family, weight] of FACES)
      for (const subset of ['latin', 'latin-ext']) {
        const file = `${pkg}-${subset}-${weight}-normal.woff2`
        expect(existsSync(`public/fonts/${file}`), file).toBe(true)
        const rule = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]).find((r) => r.includes(file))
        expect(rule, file).toBeDefined()
        expect(rule).toContain(`font-family: "${family}"`)
        expect(rule).toContain(`font-weight: ${weight}`)
        expect(rule).toContain('font-display: swap')
        const pkgCss = readFileSync(`node_modules/@fontsource/${pkg}/${subset}-${weight}.css`, 'utf8')
        const want = /unicode-range:\s*([^;]+);/.exec(pkgCss)![1].trim()
        expect(/unicode-range:\s*([^;]+);/.exec(rule!)![1].trim(), file).toBe(want)
      }
  })
  it('preloads the two above-the-fold faces and ships the OFL', () => {
    for (const f of ['atkinson-hyperlegible-latin-400-normal.woff2', 'fredoka-latin-600-normal.woff2'])
      expect(html).toContain(`<link rel="preload" href="/circuitoon/fonts/${f}" as="font" type="font/woff2" crossorigin />`)
    expect(readFileSync('public/fonts/OFL.txt', 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i)
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/fonts.test.ts`
Expected: FAIL: `index.html` still links `fonts.googleapis.com`, and `public/fonts/` does not exist.

- [ ] **Step 4: Copy the fonts and the licence**

Run:

```bash
mkdir -p public/fonts
for w in 400 700; do for s in latin latin-ext; do cp node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-$s-$w-normal.woff2 public/fonts/; done; done
for w in 500 600; do for s in latin latin-ext; do cp node_modules/@fontsource/fredoka/files/fredoka-$s-$w-normal.woff2 public/fonts/; done; done
{ echo "Atkinson Hyperlegible (Braille Institute of America) and Fredoka (Milena Brandao, Hafontia), from @fontsource 5.3.0. Both under the SIL Open Font License 1.1:"; echo; cat node_modules/@fontsource/fredoka/LICENSE; } > public/fonts/OFL.txt
diff <(tail -n +3 public/fonts/OFL.txt | grep -v Copyright) <(grep -v Copyright node_modules/@fontsource/atkinson-hyperlegible/LICENSE) && echo "same licence text"
ls public/fonts
```

Expected: eight `.woff2` files, `OFL.txt`, and "same licence text" (both packages carry OFL 1.1; if the diff shows more than the copyright lines, append the Atkinson licence to `OFL.txt` as its own section instead).

- [ ] **Step 5: Replace the Google Fonts lines and add the faces**

In `index.html`, delete the three lines (the two `preconnect` links and the `fonts.googleapis.com` stylesheet) and put in their place:

```html
    <!-- Self-hosted fonts (firmware spec 2.5): nothing cross-origin, so COEP require-corp loads the page. -->
    <link rel="preload" href="/circuitoon/fonts/atkinson-hyperlegible-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/circuitoon/fonts/fredoka-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
```

At the top of `src/styles.css`, before any rule, add one `@font-face` per family, weight and subset. Copy each `unicode-range` from the package's `<subset>-<weight>.css` (the test compares them); the two Atkinson 400 rules read:

```css
/* Self-hosted fonts (firmware spec 2.5, plan ruling R20): @fontsource 5.3.0 files in public/fonts,
   OFL in public/fonts/OFL.txt. Public files are referenced from the root: Vite adds the base. */
@font-face {
  font-family: "Atkinson Hyperlegible"; font-style: normal; font-weight: 400; font-display: swap;
  src: url(/fonts/atkinson-hyperlegible-latin-ext-400-normal.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: "Atkinson Hyperlegible"; font-style: normal; font-weight: 400; font-display: swap;
  src: url(/fonts/atkinson-hyperlegible-latin-400-normal.woff2) format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

and the same pair for Atkinson 700, Fredoka 500 and Fredoka 600 (file names `fredoka-latin-500-normal.woff2` and so on, `font-family: "Fredoka"`). The test checks the file name inside each rule, so the `src` URL must name the file exactly.

Note: `/fonts/...` in CSS becomes `/circuitoon/fonts/...` in the build (Vite prefixes public URLs with `base`); `index.html` already writes the base itself (as for the favicons), so the preloads say `/circuitoon/fonts/`.

- [ ] **Step 6: Run the tests and the build**

Run: `npx vitest run src/fonts.test.ts && npm run build && grep -o "/circuitoon/fonts/[a-z0-9-]*\.woff2" dist/assets/*.css | sort -u`
Expected: PASS (3 tests); the build's CSS names all eight files under `/circuitoon/fonts/`.

- [ ] **Step 7: Look at it**

Run `npm run check:theme-ui -- --out .superpowers/fonts-ui` (it screenshots the landing page and the editor in light and dark). Open each screenshot: headings are Fredoka, body text Atkinson Hyperlegible, exactly as before (compare with a screenshot of the live site). Fix any face that fell back to a system font.

- [ ] **Step 8: Commit**

```bash
git add public/fonts index.html src/styles.css src/fonts.test.ts package.json package-lock.json
git commit -m "$(cat <<'MSG'
Fonts: self-host Atkinson Hyperlegible and Fredoka (latin, latin-ext), preload the two above the fold

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 2: Cross-origin isolation (coi-serviceworker, Vite headers, the code worker's CSP)

**Files:**
- Create: `public/coi-serviceworker.js`, `public/coi-serviceworker.LICENSE.txt`, `src/isolation.ts`, `src/isolation.test.ts`
- Modify: `index.html` (the head order), `vite.config.ts`, `src/editor/Editor.tsx` (the unsaved flag)

**Interfaces:**
- Consumes: Task 1 (no cross-origin load left).
- Produces:
  - `const CODE_WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"` and `function codeWorkerCsp(): Plugin` (exported from `vite.config.ts`)
  - `const UNSAVED_FLAG = '__circuitoonUnsaved'`, `function markUnsaved(on: boolean): void` (`src/isolation.ts`)
  - the code worker's script path rule, shared by the service worker and the Vite plugin: a path matching `/codeWorker[^/]*\.(js|ts)/` (Task 17 names the worker file `codeWorker.ts`, built as `assets/codeWorker-<hash>.js`)

- [ ] **Step 1: Vendor coi-serviceworker 0.1.7**

Run:

```bash
mkdir -p .superpowers/coi && cd .superpowers/coi && npm pack coi-serviceworker@0.1.7 && tar xzf coi-serviceworker-0.1.7.tgz && cd ../..
cp .superpowers/coi/package/coi-serviceworker.js public/coi-serviceworker.js
cp .superpowers/coi/package/LICENSE public/coi-serviceworker.LICENSE.txt
head -1 public/coi-serviceworker.js
```

Expected: `/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */`.

- [ ] **Step 2: Write the failing tests**

`src/isolation.test.ts`:

```ts
// Firmware spec 2.5 and 2.6: cross-origin isolation on GitHub Pages through coi-serviceworker 0.1.7
// (require-corp, quiet, a reload that never drops an unsaved diagram), loaded first in <head>; the
// code worker's script gets the CSP (ruling R19); Vite sets the same headers for dev and preview.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import config, { CODE_WORKER_CSP, codeWorkerCsp } from '../vite.config.ts'

const html = readFileSync('index.html', 'utf8')
const sw = readFileSync('public/coi-serviceworker.js', 'utf8')

/** The service worker half of the file, run in a fake worker scope; returns the response headers for a URL. */
async function swHeaders(url: string): Promise<Headers> {
  const listeners: Record<string, (e: unknown) => void> = {}
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => void (listeners[t] = f) }
  vm.runInNewContext(sw, { self, fetch: async () => new Response('x', { status: 200 }), Headers, Response, Request, URL, console })
  let answer: Promise<Response> | undefined
  listeners.fetch({ request: { url, cache: 'default', mode: 'same-origin' }, respondWith: (p: Promise<Response>) => void (answer = p) })
  return (await answer!).headers
}

/** The page half with the inline config from index.html; resolves to whether the page reloaded. */
async function pageReloads(unsaved: boolean): Promise<boolean> {
  const config = /<script>(window\.coi[\s\S]*?)<\/script>/.exec(html)![1]
  let reloaded = false
  const registration = { active: {}, addEventListener() {} }
  const window: Record<string, unknown> = {
    crossOriginIsolated: false, isSecureContext: true, __circuitoonUnsaved: unsaved,
    location: { reload: () => void (reloaded = true) }, document: { currentScript: { src: '/circuitoon/coi-serviceworker.js' } },
  }
  const navigator = { serviceWorker: { controller: null, register: async () => registration } }
  const ctx = vm.createContext({ window, navigator, console })
  vm.runInContext(config, ctx)
  vm.runInContext(sw, ctx)
  await new Promise((r) => setTimeout(r, 0))
  return reloaded
}

describe('cross-origin isolation (spec 2.5)', () => {
  it('loads the config and the service worker first in <head>, before the theme script and the app', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m.index!)
    const coi = html.indexOf('<script src="/circuitoon/coi-serviceworker.js"></script>')
    expect(coi).toBeGreaterThan(0)
    expect(html.indexOf('<script>window.coi')).toBe(scripts[0])
    expect(coi).toBe(scripts[1])
    expect(html.indexOf("localStorage.getItem('circuitoon.theme')")).toBeGreaterThan(coi)
  })
  it('configures require-corp, quiet, and a reload guarded by the unsaved flag', () => {
    expect(html).toMatch(/coepCredentialless:\s*\(\)\s*=>\s*false/)
    expect(html).toMatch(/quiet:\s*true/)
  })
  it('reloads to take control, but never over an unsaved diagram', async () => {
    expect(await pageReloads(false)).toBe(true)
    expect(await pageReloads(true)).toBe(false)
  })
  it('serves require-corp and same-origin, and the CSP on the code worker script only', async () => {
    const page = await swHeaders('https://mbarc.github.io/circuitoon/index.html')
    expect(page.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
    expect(page.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(page.get('Content-Security-Policy')).toBeNull()
    const worker = await swHeaders('https://mbarc.github.io/circuitoon/assets/codeWorker-Ab12Cd.js')
    expect(worker.get('Content-Security-Policy')).toBe(CODE_WORKER_CSP)
    expect(CODE_WORKER_CSP).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'")
  })
  it('sets COOP and COEP in Vite dev and preview, and the CSP on the worker path', () => {
    for (const s of [config.server, config.preview]) expect(s?.headers).toMatchObject({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' })
    const use: ((req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => void)[] = []
    const plugin = codeWorkerCsp() as { configureServer: (s: unknown) => void }
    plugin.configureServer({ middlewares: { use: (f: (typeof use)[number]) => use.push(f) } })
    const headers = (url: string) => {
      const set: Record<string, string> = {}
      use[0]({ url }, { setHeader: (k, v) => void (set[k] = v) }, () => {})
      return set
    }
    expect(headers('/circuitoon/src/run/browser/codeWorker.ts?worker_file&type=module')['Content-Security-Policy']).toBe(CODE_WORKER_CSP)
    expect(headers('/circuitoon/assets/codeWorker-Ab12Cd.js')['Content-Security-Policy']).toBe(CODE_WORKER_CSP)
    expect(headers('/circuitoon/index.html')['Content-Security-Policy']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/isolation.test.ts`
Expected: FAIL: `vite.config.ts` has no `CODE_WORKER_CSP` export and `index.html` has no `window.coi`.

- [ ] **Step 4: Patch the service worker (ruling R19)**

In `public/coi-serviceworker.js`, in the `fetch` handler, right after the line `newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");`, insert:

```js
                    // Circuitoon patch (firmware spec 2.6, plan ruling R19): the code worker runs other
                    // people's code, so its script may load only our own scripts and files. Keep this in
                    // step with CODE_WORKER_CSP in vite.config.ts (src/isolation.test.ts checks both).
                    if (/\/codeWorker[^/]*\.(js|ts)$/.test(new URL(r.url).pathname)) {
                        newHeaders.set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
                    }
```

Nothing else in the file changes (`git diff --stat` after this step shows only these lines against the vendored copy).

- [ ] **Step 5: Load it first in `<head>`**

In `index.html`, directly after `<meta name="viewport" ...>` and before the description meta and the theme script, insert:

```html
    <!-- Cross-origin isolation for SharedArrayBuffer (firmware spec 2.5): the config, then the
         service worker, first in <head> so its one reload happens before the app boots and a
         share link's hash survives. doReload never reloads over an unsaved diagram (src/isolation.ts);
         Run then stays disabled until the next load. -->
    <script>window.coi = { coepCredentialless: () => false, quiet: true, doReload: () => { if (!window.__circuitoonUnsaved) window.location.reload() } }</script>
    <script src="/circuitoon/coi-serviceworker.js"></script>
```

- [ ] **Step 6: Vite headers and the worker CSP**

Replace `vite.config.ts` with:

```ts
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/** The code worker's policy (firmware spec 2.6). public/coi-serviceworker.js sets the same on the built site. */
export const CODE_WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
/** Cross-origin isolation for dev and preview (spec 2.5), so neither depends on the service worker. */
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

/** Adds CODE_WORKER_CSP to the code worker's script in dev (`codeWorker.ts?worker_file`) and preview (`assets/codeWorker-<hash>.js`). */
export function codeWorkerCsp(): Plugin {
  const add = (req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    if (/\/codeWorker[^/?]*\.(js|ts)(\?|$)/.test(req.url ?? '')) res.setHeader('Content-Security-Policy', CODE_WORKER_CSP)
    next()
  }
  return {
    name: 'circuitoon-code-worker-csp',
    configureServer: (server) => void server.middlewares.use(add),
    configurePreviewServer: (server) => void server.middlewares.use(add),
  }
}

// Served from https://mbarc.github.io/circuitoon/, so every asset URL needs the subpath.
export default defineConfig({
  base: '/circuitoon/',
  plugins: [react(), codeWorkerCsp()],
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  // Correctness tests should not fail because the machine is busy (deploys run the whole suite,
  // often next to other heavy work). Speed is checked separately by the *.perf.test.ts budgets.
  test: { testTimeout: 30_000 },
})
```

- [ ] **Step 7: The unsaved flag**

`src/isolation.ts`:

```ts
// Cross-origin isolation (firmware spec 2.5). The service worker's config in index.html reads
// window.__circuitoonUnsaved before it reloads (after a deploy updates the worker), so an unsaved
// diagram is never lost; the editor keeps the flag current.
export const UNSAVED_FLAG = '__circuitoonUnsaved'

export function markUnsaved(on: boolean): void {
  ;(window as unknown as Record<string, unknown>)[UNSAVED_FLAG] = on
}
```

In `src/editor/Editor.tsx`, import `markUnsaved` from `'../isolation.ts'` and extend the existing `onDirty` effect:

```tsx
  useEffect(() => {
    onDirty?.(dirty)
    markUnsaved(dirty)
  }, [dirty, onDirty])
  // Closing the sheet leaves nothing unsaved behind.
  useEffect(() => () => markUnsaved(false), [])
```

- [ ] **Step 8: Run the tests and the build**

Run: `npx vitest run src/isolation.test.ts src/fonts.test.ts && npm run build && ls dist/coi-serviceworker.js`
Expected: PASS (5 + 3 tests); the build copies the worker to `dist/coi-serviceworker.js`.

- [ ] **Step 9: Commit**

```bash
git add public/coi-serviceworker.js public/coi-serviceworker.LICENSE.txt index.html vite.config.ts src/isolation.ts src/isolation.test.ts src/editor/Editor.tsx
git commit -m "$(cat <<'MSG'
Isolation: coi-serviceworker 0.1.7 (require-corp, guarded reload, code worker CSP), Vite COOP/COEP headers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 3: Kill switch and the isolation browser check

**Files:**
- Create: `scripts/rollback/coi-serviceworker.js`, `scripts/check-isolation-ui.mjs`
- Modify: `package.json` (`check:isolation-ui`)

**Interfaces:**
- Consumes: Tasks 1 and 2; `launchChrome`, `checker`, `flagOf` from `scripts/lib/browser-check.mjs`.
- Produces: `npm run check:isolation-ui` (header-less static server, so the service worker is what isolates); the kill switch.

- [ ] **Step 1: Write the kill switch**

`scripts/rollback/coi-serviceworker.js`:

```js
// Kill switch for the cross-origin isolation service worker (firmware spec 2.5). A deployed service
// worker outlives a revert, so rolling isolation back means deploying THIS file in its place:
//   cp scripts/rollback/coi-serviceworker.js public/coi-serviceworker.js && npm run deploy
// In a page (index.html still loads it as a script) it does nothing. As the service worker, the
// browser installs it as an update; it unregisters itself and reloads every page it controlled, which
// then load uncontrolled, as before isolation. Keep it next to the vendored worker's history.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.registration
        .unregister()
        .then(() => self.clients.matchAll({ type: 'window' }))
        .then((clients) => Promise.all(clients.map((c) => c.navigate(c.url)))),
    )
  })
}
```

- [ ] **Step 2: Write the browser check (it fails until the build has the worker)**

`scripts/check-isolation-ui.mjs`:

```js
// Browser check for cross-origin isolation (firmware spec 2.5 and 10), on a static server that sends
// NO isolation headers, so the service worker is what isolates the page, as on GitHub Pages:
//   1. A first visit reloads once and is then crossOriginIsolated; a share link's hash survives it.
//   2. The page loads nothing cross-origin; the self-hosted fonts are used.
//   3. A page holding an unsaved diagram is never reloaded when the worker updates.
//   4. The kill switch (scripts/rollback/coi-serviceworker.js) unregisters cleanly and reloads.
// Usage (after `npm run build`): npm run check:isolation-ui -- [--out <dir>] [--port 4213]
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { checker, flagOf, launchChrome } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/isolation-ui'))
const port = Number(flagOf('--port', '4213'))
mkdirSync(out, { recursive: true })
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' }
// The service worker file can be swapped for the kill switch mid-check.
let swFile = 'dist/coi-serviceworker.js'
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!path.startsWith('/circuitoon/')) return void res.writeHead(404).end()
  const rel = path.slice('/circuitoon/'.length) || 'index.html'
  const file = rel === 'coi-serviceworker.js' ? swFile : join('dist', rel)
  if (!existsSync(file)) return void res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
  res.end(readFileSync(file))
}).listen(port)
const base = `http://localhost:${port}/circuitoon/`

const { check, done } = checker()
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  const page = await context.newPage()
  const foreign = []
  page.on('request', (r) => !r.url().startsWith(`http://localhost:${port}/`) && !r.url().startsWith('data:') && foreign.push(r.url()))
  let navigations = 0
  page.on('framenavigated', (f) => f === page.mainFrame() && navigations++)

  // 1. First visit with a hash: one reload, then isolated, hash kept.
  await page.goto(`${base}#/editor?check=hash-survives`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 15000 })
  check(navigations === 2, `${scheme}: the first visit reloaded exactly once (${navigations} navigations)`)
  check(new URL(page.url()).hash === '#/editor?check=hash-survives', `${scheme}: the hash survived the reload (${page.url()})`)
  check(await page.evaluate(() => typeof SharedArrayBuffer === 'function'), `${scheme}: SharedArrayBuffer is available`)

  // 2. Nothing cross-origin; the fonts are ours and in use.
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
  check(faces.some((f) => f.includes('Atkinson')) && faces.some((f) => f.includes('Fredoka')), `${scheme}: self-hosted faces loaded: ${faces.join(', ')}`)
  check(foreign.length === 0, `${scheme}: nothing cross-origin was requested (${foreign.join(', ') || 'none'})`)
  await page.screenshot({ path: join(out, `isolation-landing-${scheme}.png`) })

  // 3. An unsaved diagram is never reloaded by a worker update.
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await page.evaluate(() => (window.__circuitoonUnsaved = true))
  const before = navigations
  swFile = 'dist/coi-serviceworker.js.changed'
  const { writeFileSync } = await import('node:fs')
  writeFileSync(swFile, `${readFileSync('dist/coi-serviceworker.js', 'utf8')}\n// changed for the check\n`)
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  await page.waitForTimeout(1500)
  check(navigations === before, `${scheme}: no reload over an unsaved diagram after a worker update`)
  await page.screenshot({ path: join(out, `isolation-unsaved-${scheme}.png`) })

  // 4. The kill switch unregisters and reloads into an uncontrolled page. As a page script it does
  // nothing, so the reloaded page registers nothing again (no reload loop).
  swFile = 'scripts/rollback/coi-serviceworker.js'
  await page.evaluate(() => (window.__circuitoonUnsaved = false))
  const reloaded = page.waitForEvent('framenavigated', { timeout: 15000 })
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  await reloaded
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  check(await page.evaluate(() => !navigator.serviceWorker.controller), `${scheme}: the page is no longer controlled`)
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
  check(regs === 0, `${scheme}: the kill switch left no registration (${regs})`)
  check(await page.evaluate(() => window.crossOriginIsolated === false), `${scheme}: the page is no longer isolated`)
  swFile = 'dist/coi-serviceworker.js'
  await context.close()
}
await browser.close()
server.close()
const { rmSync } = await import('node:fs')
rmSync('dist/coi-serviceworker.js.changed', { force: true })
done()
```

Add to `package.json` scripts: `"check:isolation-ui": "node scripts/check-isolation-ui.mjs",`.

- [ ] **Step 3: Run it**

Run: `npm run build && npm run check:isolation-ui`
Expected: every line `ok`, ending `all checks passed`. Open the four screenshots in `.superpowers/isolation-ui/`: the landing page and the new sheet look exactly as on the live site, in Fredoka and Atkinson Hyperlegible, light and dark. A failure in case 3 means the config's `doReload` is not the one that ran (check the head order); in case 4, that the kill switch did not activate (check `skipWaiting`).

- [ ] **Step 4: Re-check every existing feature under isolation (spec 2.5)**

Vite preview now sends COOP and COEP (Task 2), so the existing checks run isolated. Run each and read its output:

Run: `npm run check:link-ui && npm run check:export-ui && npm run check:select-ui && npm run check:partmaker-ui && npm run check:sim-ui && npm run check:update-ui && npm run check:examples`
Expected: all pass. Together they cover share links (`link-ui`), file save and PNG/SVG export (`export-ui`), the clipboard (`select-ui`, `partmaker-ui`), the GitHub issue form link (`partmaker-ui`), file open (`update-ui`, `examples`) and the sim worker (`sim-ui`). Open the screenshots each writes and compare with its earlier run. A check that fails only under isolation is a blocker for this phase: fix the cause (a cross-origin fetch, a popup that needs `noopener`), never the check.

- [ ] **Step 5: Commit**

```bash
git add scripts/rollback/coi-serviceworker.js scripts/check-isolation-ui.mjs package.json
git commit -m "$(cat <<'MSG'
Isolation: kill-switch service worker and the isolation browser check (header-less server)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: step 1 ships alone (spec 11)

1. A Claude reviewer (Astra after 2026-10-10, through the `consult-astra` skill) reviews Tasks 1 to 3: the vendored worker against the 0.1.7 tarball (only the marked patch differs), the head order, the reload guard, the kill switch, and every screenshot.
2. Ship with the `circuitoon-ship` skill from this point of the branch (only these three tasks' commits): full tests, the build, `check:isolation-ui`, deploy, then live verification on https://mbarc.github.io/circuitoon/ in a fresh browser profile: one reload on the first visit, `crossOriginIsolated === true`, a share link opens its diagram, Simulate solves, no request leaves the origin (DevTools network panel filtered to third-party).
3. Record the outcome in the ledger. If the live site misbehaves in any browser, roll back with the kill switch (its header comment says how) before anything else.

---

# Phase B: the `code` key, board languages, Pi and servo data (spec 11 step 2)

### Task 4: The `code` key on a part

**Files:**
- Create: `src/format/code.ts`, `src/format/code.test.ts`
- Modify: `src/format/diagram.ts` (`PartInstance.code`, the load check)

**Interfaces:**
- Consumes: `validateDiagram`, `serializeDiagram`, `diagramLink` (existing).
- Produces (`src/format/code.ts`):
  - `interface PartCode { language: string; source: string; file?: string }`; `PartInstance.code?: PartCode`
  - `const KNOWN_LANGUAGES = ['python-rpi', 'arduino-avr', 'micropython'] as const` (ruling R2), `const RUNNABLE: readonly string[] = ['python-rpi']`
  - `const LANGUAGE_NAMES: Record<string, string>`, `const LANGUAGE_EXT: Record<string, string[]>`, `function languageName(id: string): string`
  - `const SOURCE_MAX_BYTES = 262144`, `const FILE_NAME_MAX = 255`, `function utf8Bytes(s: string): number`, `function fileProblem(name: unknown): string | null`
  - `function checkCode(raw: unknown, who: string): { code: PartCode | null; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

`src/format/code.test.ts`:

```ts
// Firmware spec 3.1: `code: { language, source, file? }` on a part. Wrong types or an oversized
// source drop the code with a warning naming the part; unknown keys inside code are dropped; a
// language this build does not know is kept with a warning; the format stays circuitoon-diagram/1;
// code counts against a link's 64K-character payload.
import { describe, expect, it } from 'vitest'
import { DIAGRAM_FORMAT, type Diagram, serializeDiagram, validateDiagram } from './diagram.ts'
import { diagramLink } from './link.ts'
import { SOURCE_MAX_BYTES, checkCode, fileProblem, utf8Bytes } from './code.ts'

const sheet = (code: unknown): Diagram => ({
  format: DIAGRAM_FORMAT, title: 't', modules: {}, connections: [],
  parts: [{ uid: 'u1', designator: 'U1', module: 'rpi-4-model-b', x: 0, y: 0, code } as Diagram['parts'][number]],
})
const load = (code: unknown) => {
  const r = validateDiagram(JSON.parse(JSON.stringify(sheet(code))))
  if (!r.ok) throw new Error(r.errors.join('; '))
  return { code: r.diagram.parts[0].code, warnings: r.warnings.filter((w) => w.includes('.code')) }
}

describe('checkCode', () => {
  it('keeps valid code as it is', () => {
    const c = { language: 'python-rpi', source: 'print(1)\n', file: 'blink.py' }
    expect(checkCode(c, 'U1')).toEqual({ code: c, warnings: [] })
    expect(checkCode(c, 'U1').code).toBe(c)
  })
  it('drops code with wrong types or an oversized source, naming the part', () => {
    for (const bad of [null, 'x', { language: 3, source: '' }, { language: 'python-rpi' }, { language: 'python-rpi', source: 7 }]) {
      const r = checkCode(bad, 'U1')
      expect(r.code).toBeNull()
      expect(r.warnings[0]).toMatch(/^U1's code was dropped: /)
    }
    // 256 KB counts UTF-8 bytes: a 3-byte character pushes a just-short string over.
    const big = `${'a'.repeat(SOURCE_MAX_BYTES - 2)}€`
    expect(utf8Bytes(big)).toBe(SOURCE_MAX_BYTES + 1)
    expect(checkCode({ language: 'python-rpi', source: big }, 'U1')).toEqual({ code: null, warnings: ["U1's code was dropped: its source is over 256 KB"] })
  })
  it('drops unknown keys inside code with a warning, and a bad file name only', () => {
    expect(checkCode({ language: 'python-rpi', source: 's', run: true }, 'U1')).toEqual({
      code: { language: 'python-rpi', source: 's' }, warnings: ["U1's code had keys this version does not know (run), which were dropped"],
    })
    expect(checkCode({ language: 'python-rpi', source: 's', file: 'a/b.py' }, 'U1')).toEqual({
      code: { language: 'python-rpi', source: 's' }, warnings: ["U1's code file name was dropped: it has a path separator"],
    })
    expect(fileProblem('x'.repeat(256))).toBe('it is over 255 characters')
    expect(fileProblem('main.py')).toBeNull()
  })
  it('keeps a language this build does not know, with a warning', () => {
    const r = checkCode({ language: 'lua', source: 's' }, 'U1')
    expect(r.code).toEqual({ language: 'lua', source: 's' })
    expect(r.warnings).toEqual(['U1\'s code is in "lua", which this version of Circuitoon does not know; it is kept but will not run'])
  })
})

describe('code in a sheet (spec 3.1)', () => {
  it('loads, saves and stays circuitoon-diagram/1', () => {
    const c = { language: 'python-rpi', source: 'from gpiozero import LED\n', file: 'blink.py' }
    const { code, warnings } = load(c)
    expect(code).toEqual(c)
    expect(warnings).toEqual([])
    const again = JSON.parse(serializeDiagram(sheet(c)))
    expect(again.format).toBe('circuitoon-diagram/1')
    expect(again.parts[0].code).toEqual(c)
  })
  it('drops bad code on load with a warning at the part', () => {
    const { code, warnings } = load({ language: 'python-rpi', source: 5 })
    expect(code).toBeUndefined()
    expect(warnings).toEqual(["parts[0].code: U1's code was dropped: its source must be text"])
  })
  it('counts code against the link payload (64K characters)', async () => {
    // Incompressible text: about 1.3 base64 characters per byte after deflate.
    let x = 1
    const noise = Array.from({ length: 120_000 }, () => String.fromCharCode(33 + ((x = (x * 1103515245 + 12345) % 2147483648) % 90))).join('')
    const r = await diagramLink(sheet({ language: 'python-rpi', source: noise }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.limit.limit).toBe('chars')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/format/code.test.ts`
Expected: FAIL, `./code.ts` cannot be found.

- [ ] **Step 3: Write `src/format/code.ts`**

```ts
// Code on a part (firmware spec 3.1): `code: { language, source, file? }`, an optional part key
// (the diagram format stays circuitoon-diagram/1; older readers keep unknown part keys). Wrong types
// or an oversized source drop the code; unknown keys inside it are dropped; a language this build
// does not know is kept with a warning, so newer sheets survive older editors. Pure; imports only
// types from module.ts (Task 5), which imports KNOWN_LANGUAGES from here.

/** Every language a slice plans (ruling R2): modules may name any of them; RUNNABLE is what this build runs. */
export const KNOWN_LANGUAGES = ['python-rpi', 'arduino-avr', 'micropython'] as const
export const RUNNABLE: readonly string[] = ['python-rpi']
export const LANGUAGE_NAMES: Record<string, string> = { 'python-rpi': 'Raspberry Pi Python', 'arduino-avr': 'Arduino C++', micropython: 'MicroPython' }
/** The file extensions an upload of each language may have (spec 6.2: `.ino` on a Pi is refused). */
export const LANGUAGE_EXT: Record<string, string[]> = { 'python-rpi': ['.py'], 'arduino-avr': ['.ino', '.cpp'], micropython: ['.py'] }
export const SOURCE_MAX_BYTES = 256 * 1024
export const FILE_NAME_MAX = 255

export interface PartCode { language: string; source: string; file?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length
export const languageName = (id: string): string => LANGUAGE_NAMES[id] ?? `"${id}"`

/** Why a code file name cannot be kept (spec 3.1: at most 255 characters, no path separators), or null. */
export function fileProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return 'it must be text'
  if (name.length > FILE_NAME_MAX) return `it is over ${FILE_NAME_MAX} characters`
  if (/[\\/]/.test(name)) return 'it has a path separator'
  return null
}

/** A part's `code` as loaded: the value to keep (the same object when nothing changed), or null to drop it, and the warnings in words. */
export function checkCode(raw: unknown, who: string): { code: PartCode | null; warnings: string[] } {
  const drop = (why: string) => ({ code: null, warnings: [`${who}'s code was dropped: ${why}`] })
  if (!isObj(raw)) return drop('it must be { "language", "source", "file" }')
  if (typeof raw.language !== 'string' || raw.language === '') return drop('its language must be text')
  if (typeof raw.source !== 'string') return drop('its source must be text')
  if (utf8Bytes(raw.source) > SOURCE_MAX_BYTES) return drop('its source is over 256 KB')
  const warnings: string[] = []
  const extra = Object.keys(raw).filter((k) => k !== 'language' && k !== 'source' && k !== 'file')
  if (extra.length) warnings.push(`${who}'s code had keys this version does not know (${extra.join(', ')}), which were dropped`)
  const badFile = raw.file === undefined ? null : fileProblem(raw.file)
  if (badFile) warnings.push(`${who}'s code file name was dropped: ${badFile}`)
  if (!(KNOWN_LANGUAGES as readonly string[]).includes(raw.language))
    warnings.push(`${who}'s code is in "${raw.language}", which this version of Circuitoon does not know; it is kept but will not run`)
  if (!extra.length && !badFile) return { code: raw as unknown as PartCode, warnings }
  return { code: { language: raw.language, source: raw.source, ...(raw.file !== undefined && !badFile ? { file: raw.file as string } : {}) }, warnings }
}

```

- [ ] **Step 4: Check it on load**

In `src/format/diagram.ts`:
- import `{ type PartCode, checkCode }` from `'./code.ts'`;
- add to `PartInstance`, after `mount`: 
  ```ts
    /** Code on a board (firmware spec 3.1), saved with the sheet. */
    code?: PartCode
  ```
- in `validateDiagram`'s `raw.parts.forEach`, after the `settings` block, add:
  ```ts
      // Code on a board (firmware spec 3.1): bad code is dropped with a warning naming the part.
      if (p.code !== undefined) {
        const who = typeof p.designator === 'string' && p.designator !== '' ? p.designator : `part ${i}`
        const r = checkCode(p.code, who)
        for (const w of r.warnings) warnings.push(`${at}.code: ${w}`)
        if (r.code !== p.code) fix(i, { code: r.code ?? undefined })
      }
  ```

A fixed part with `code: undefined` serialises without the key (`JSON.stringify` drops it).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/format/code.test.ts src/format/diagram.test.ts src/format/link.test.ts`
Expected: PASS.

- [ ] **Step 6: Build the CLI and commit**

Run: `npm run build:cli && npm run validate`

```bash
git add src/format/code.ts src/format/code.test.ts src/format/diagram.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Format: the code key on a part (language, source, file), checked on load

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 5: Board languages (`firmware`), `withLibraryData` and `languagesOf`

**Files:**
- Create: `src/format/firmware.test.ts`
- Modify: `src/format/module.ts` (`ModuleDef.firmware`, validation), `src/format/code.ts` (`languagesOf`), `src/format/simModel.ts` (`withLibrarySim` becomes `withLibraryData`), `src/sim/build.ts`, `src/format/diagram.ts`, `src/editor/ops.ts`, `src/agent/netlist.ts` (callers), `src/format/partMaker.ts` (lint), `scripts/lib/parts.mjs` (`firmware` in `moduleJson`), `scripts/gen-usb.mjs` (the three Pis), `modules/rpi-4-model-b.json`, `modules/rpi-5.json`, `modules/rpi-zero-2-w.json` (generated)

**Interfaces:**
- Consumes: `KNOWN_LANGUAGES`, `languageName`, `checkCode` (Task 4).
- Produces:
  - `ModuleDef.firmware?: { languages: string[] }`
  - `function withLibraryData(stored: ModuleDef, library: ((id: string) => ModuleDef | undefined) | undefined): ModuleDef` (in `simModel.ts`, replacing `withLibrarySim` everywhere)
  - `function languagesOf(m: ModuleDef | undefined): string[]` (final form)
  - `function languageMismatch(who: string, m: ModuleDef, language: string): string | null` (`code.ts`; the sentence below without a full stop, or null when the language is unknown or the board takes it; the loader and the gate both use it)
  - the load warning "U1 is a Raspberry Pi 4 Model B; its code is Arduino C++ and won't run"
  - lint warning code `firmware-custom`

- [ ] **Step 1: Write the failing test**

`src/format/firmware.test.ts`:

```ts
// Firmware spec 3.2: modules declare `firmware: { languages }` (known ids only, ruling R2); the
// library's firmware and sim reach a stored copy with the same id and terminals (withLibraryData);
// a custom part accepts no language in this slice; code a board does not accept is kept and warned about.
import { describe, expect, it } from 'vitest'
import { load } from './builtinModules.testing.ts'
import { DIAGRAM_FORMAT, validateDiagram } from './diagram.ts'
import { type ModuleDef, validateModule } from './module.ts'
import { withLibraryData } from './simModel.ts'
import { languagesOf } from './code.ts'
import { lintModule } from './partMaker.ts'
import { libraryLookup } from '../agent/catalog.ts'

const pi = () => load('rpi-4-model-b')

describe('module firmware (spec 3.2)', () => {
  it('gives the three Pis python-rpi and nothing else a language', () => {
    for (const id of ['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w']) expect(languagesOf(load(id)), id).toEqual(['python-rpi'])
    expect(languagesOf(load('arduino-uno-r3'))).toEqual([])
    expect(languagesOf(load('rpi-pico'))).toEqual([])
  })
  it('accepts only known language ids', () => {
    const bad = (firmware: unknown) => validateModule({ ...pi(), firmware })
    expect(bad({ languages: ['arduino-avr'] }).ok).toBe(true)
    expect(bad({ languages: ['cobol'] })).toEqual({ ok: false, errors: ['firmware.languages[0]: unknown language "cobol" (python-rpi, arduino-avr, micropython)'] })
    expect(bad({ languages: [] })).toEqual({ ok: false, errors: ['firmware: must be { "languages": [<language id>, ...] }'] })
    expect(bad({ langs: ['python-rpi'] }).ok).toBe(false)
  })
  it('carries the library firmware and sim to an old stored copy, and returns a matching copy unchanged', () => {
    const lib = pi()
    const old = JSON.parse(JSON.stringify(lib)) as ModuleDef
    delete old.firmware
    const data = withLibraryData(old, () => lib)
    expect(languagesOf(data)).toEqual(['python-rpi'])
    expect(withLibraryData(lib, () => lib)).toBe(lib)
    const moved = { ...old, pins: old.pins.slice(1) }
    expect(withLibraryData(moved, () => lib)).toBe(moved)
  })
  it('gives a custom part no language, and the part check says so', () => {
    const custom = { ...pi(), id: 'custom-my-pi', custom: true as const }
    expect(languagesOf(custom)).toEqual([])
    expect(withLibraryData(custom, libraryLookup)).toBe(custom)
    expect(lintModule(custom).warnings).toContainEqual({ code: 'firmware-custom', message: 'Code on custom parts is not supported yet, so this part\'s "firmware" is ignored.' })
  })
  it('keeps code a board does not accept, with a warning that names the board and the language', () => {
    const uno = load('arduino-uno-r3')
    const r = validateDiagram({
      format: DIAGRAM_FORMAT, title: 't', modules: { [uno.id]: uno }, connections: [],
      parts: [{ uid: 'u1', designator: 'U1', module: uno.id, x: 0, y: 0, code: { language: 'python-rpi', source: 'print(1)' } }],
    }, { library: libraryLookup })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.diagram.parts[0].code?.language).toBe('python-rpi')
    expect(r.warnings).toContain("parts[0].code: U1 is an Arduino Uno R3; its code is Raspberry Pi Python and won't run")
  })
})
```

The Uno's module name must be the one in `modules/arduino-uno-r3.json`; read it first (`node -p "require('./modules/arduino-uno-r3.json').name"`) and use it in the expected text.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/format/firmware.test.ts`
Expected: FAIL: `withLibraryData` is not exported and the Pis have no `firmware`.

- [ ] **Step 3: `firmware` on modules**

In `src/format/module.ts`:
- `import { KNOWN_LANGUAGES } from './code.ts'`;
- add to `ModuleDef`, after `custom`:
  ```ts
    /** The languages code on this part may be in (firmware spec 3.2); read only through languagesOf. */
    firmware?: { languages: string[] }
  ```
- in `validateModule`, after the `custom` check:
  ```ts
    if (raw.firmware !== undefined) {
      const f = raw.firmware
      if (!isObj(f) || Object.keys(f).some((k) => k !== 'languages') || !Array.isArray(f.languages) || !f.languages.length) errors.push('firmware: must be { "languages": [<language id>, ...] }')
      else
        f.languages.forEach((l, i) => {
          if (!(KNOWN_LANGUAGES as readonly unknown[]).includes(l)) errors.push(`firmware.languages[${i}]: unknown language "${show(l)}" (${KNOWN_LANGUAGES.join(', ')})`)
        })
    }
  ```

In `src/format/code.ts`, add `import type { ModuleDef } from './module.ts'` at the top and append:

```ts
/** The languages a module's code may be in (firmware spec 3.2): none on a custom part in this slice. */
export function languagesOf(m: ModuleDef | undefined): string[] {
  return m && m.custom !== true ? (m.firmware?.languages ?? []) : []
}

/** "U1 is an Arduino Uno R3; its code is Raspberry Pi Python and won't run" for a known language the board does not take (kept, spec 3.1); else null. `m` is the module with its library data. */
export function languageMismatch(who: string, m: ModuleDef, language: string): string | null {
  if (!(KNOWN_LANGUAGES as readonly string[]).includes(language) || languagesOf(m).includes(language)) return null
  return `${who} is ${/^[aeiou]/i.test(m.name) ? 'an' : 'a'} ${m.name}; its code is ${languageName(language)} and won't run`
}
```

- [ ] **Step 4: `withLibraryData`**

In `src/format/simModel.ts`, replace `withLibrarySim` with:

```ts
/**
 * The module a stored copy is simulated, validated and run as (firmware spec 3.2). `electrical.sim`
 * and `firmware` are library data, like the KiCad mapping (format/kicad.ts mappingOf): a built-in
 * part whose stored copy has the library's terminals takes both from the library, so a sheet saved
 * before the library had them still simulates and runs code. The stored copy comes back unchanged
 * only when both already match; a custom part, or a copy whose pins changed, keeps its own.
 */
export function withLibraryData(stored: ModuleDef, library: ((id: string) => ModuleDef | undefined) | undefined): ModuleDef {
  if (!library || isCustom(stored)) return stored
  const lib = library(stored.id)
  if (!lib || lib === stored || terminalsKey(stored) !== terminalsKey(lib)) return stored
  const sim = isObj(lib.electrical) ? lib.electrical.sim : undefined
  const storedSim = isObj(stored.electrical) ? stored.electrical.sim : undefined
  if (storedSim === sim && stored.firmware === lib.firmware) return stored
  const e: Record<string, unknown> = isObj(stored.electrical) ? { ...stored.electrical } : {}
  if (sim === undefined) delete e.sim
  else e.sim = sim
  const { firmware: _old, ...rest } = stored
  return { ...rest, electrical: e, ...(lib.firmware ? { firmware: lib.firmware } : {}) }
}
```

Then rename every caller: `grep -rln withLibrarySim src scripts` lists `src/sim/build.ts`, `src/format/diagram.ts`, `src/editor/ops.ts`, `src/agent/netlist.ts`, `src/sim/power.ts` (a comment) and `src/editor/simOps.test.ts` (a comment). Replace the name in each (imports, calls and comments). In `src/format/diagram.ts` the local `simModule` becomes `dataModule`.

- [ ] **Step 5: The board warning on load**

In `src/format/diagram.ts`, import `languageMismatch` from `'./code.ts'` and extend the Task 4 block after `if (r.code !== p.code) ...`:

```ts
        // A known language this board does not take is kept (spec 3.1) and said once.
        const lm = typeof p.module === 'string' ? modules.get(p.module) : undefined
        const mismatch = r.code && lm ? languageMismatch(who, withLibraryData(lm, opts.library), r.code.language) : null
        if (mismatch) warnings.push(`${at}.code: ${mismatch}`)
```

- [ ] **Step 6: The part check**

In `src/format/partMaker.ts` `lintModule`, before `lintArt(...)`:

```ts
  if (m.firmware) warnings.push({ code: 'firmware-custom', message: 'Code on custom parts is not supported yet, so this part\'s "firmware" is ignored.' })
```

- [ ] **Step 7: Give the Pis their language**

In `scripts/lib/parts.mjs` `moduleJson`, add `firmware` to the destructured parameters and, right after `m.electrical = electrical`, `if (firmware) m.firmware = firmware`. In `scripts/gen-usb.mjs`, add `firmware: { languages: ['python-rpi'] },` to the three `moduleJson({...})` calls for `rpi-4-model-b`, `rpi-5` and `rpi-zero-2-w`.

Run: `node scripts/gen-usb.mjs && npm run validate && npm run check:gen`
Expected: the three Pi module files rewritten with `"firmware": { "languages": ["python-rpi"] }` after `electrical`; every module valid; every generator matching.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/format src/sim src/editor/simOps.test.ts src/agent/netlist.test.ts`
Expected: PASS.

- [ ] **Step 9: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add src/format src/sim/build.ts src/sim/power.ts src/editor/ops.ts src/editor/simOps.test.ts src/agent/netlist.ts scripts/lib/parts.mjs scripts/gen-usb.mjs modules/rpi-4-model-b.json modules/rpi-5.json modules/rpi-zero-2-w.json plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Format: board languages (firmware), withLibraryData carries sim and firmware, the Pis take python-rpi

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 6: GPIO thresholds, fixed pull-ups, the `internal` role and unsimulated USB-A ports

**Files:**
- Create: `src/sim/piShape.test.ts`
- Modify: `src/format/simModel.ts` (`GpioSpec`, `validateSim`), `src/sim/model.ts` (resistor role), `src/sim/power.ts` (fixed pull-ups, the USB host rule)

**Interfaces:**
- Consumes: `boardModule`, `hostModule`, `cellModule`, `sheet`, `q` (`src/sim/testing.ts`); `buildCircuit`, `classify`, `topologyFindings`.
- Produces:
  - `GpioSpec.inputLow?: Quantity`, `GpioSpec.inputHigh?: Quantity`, `GpioSpec.fixedPullups?: { pin: string; ohms: Quantity }[]` (ruling R3)
  - resistor `role` gains `'internal'`: always-present resistors inside a part (never a user resistor)
  - a fixed pull-up compiles to `{ kind: 'resistor', id: '<uid>.pullup.<pin>', a: <IO domain pin>, b: <pin tap>, role: 'internal' }`
  - a USB host port whose `<port>#vbus` is in no `sim.power` domain powers nothing: the device is listed unsimulated, "powered from <ref> <port>, whose USB power is not simulated"

- [ ] **Step 1: Write the failing test**

`src/sim/piShape.test.ts`:

```ts
// Firmware spec 3.3 (shape only; Task 8 sources the Pi numbers): logic thresholds on sim.gpio,
// fixed pull-ups built as always-present `internal` resistors (so the pin is defined, and the
// resistor lists and limits never treat them as user resistors), and a host's USB port with no power
// domain powers nothing, so a Pi's USB-A ports stay "not simulated" once the Pi has power data.
import { describe, expect, it } from 'vitest'
import { validateModule, type ModuleDef } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { topologyFindings } from './findings.ts'
import { boardModule, cellModule, q, sheet } from './testing.ts'

/** The test board with thresholds and a fixed pull-up on IO1, plus a USB-A host port with no power domain. */
function piLike(o: { pullups?: unknown; low?: number; high?: number } = {}): ModuleDef {
  const b = boardModule({}, 'test-pi')
  const e = b.electrical as { sim: { gpio: Record<string, unknown> } }
  e.sim.gpio.inputLow = q(o.low ?? 0.8, 'V', 'estimate')
  e.sim.gpio.inputHigh = q(o.high ?? 2.0, 'V', 'estimate')
  e.sim.gpio.fixedPullups = o.pullups ?? [{ pin: 'IO1', ohms: q(1800, 'ohm') }]
  return { ...b, pins: [...b.pins, { name: 'USB-A', side: 'right', type: 'usb', usb: { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', source: 500 } }] }
}

describe('Pi-shaped GPIO data (spec 3.3)', () => {
  it('validates thresholds and fixed pull-ups, and refuses bad ones', () => {
    expect(validateModule(piLike()).ok).toBe(true)
    const errs = (m: ModuleDef) => { const r = validateModule(m); return r.ok ? [] : r.errors }
    expect(errs(piLike({ low: 2.5, high: 2.0 }))).toContain('electrical.sim.gpio.inputLow: must be below inputHigh')
    expect(errs(piLike({ pullups: [{ pin: 'VIN', ohms: q(1800, 'ohm') }] }))).toContain('electrical.sim.gpio.fixedPullups[0].pin: "VIN" is not one of the GPIO pins')
    expect(errs(piLike({ pullups: [{ pin: 'IO1' }] }))[0]).toMatch(/^electrical\.sim\.gpio\.fixedPullups\[0\]\.ohms/)
  })
  it('builds a fixed pull-up as an internal resistor that defines an unwired input', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: piLike() }, { uid: 'x1', module: 'resistor', values: { resistance: { value: 1000, unit: 'ohm' } } }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'x1.1'], ['u1.IO2', 'x1.2']])
    const c = buildCircuit(d)
    const pull = c.devices.find((x) => x.id === 'u1.pullup.IO1')
    expect(pull).toMatchObject({ kind: 'resistor', role: 'internal', ohms: { value: 1800 } })
    expect(c.devices.filter((x) => x.kind === 'resistor' && x.role === 'resistor').map((x) => x.id)).toEqual(['x1.r'])
    const cls = classify(c)
    expect(cls.driven.has('u1:IO1')).toBe(true)
    const floating = topologyFindings(c, cls).drafts.filter((f) => f.code === 'sim-floating-input').map((f) => f.pins)
    expect(floating).not.toContainEqual([{ part: 'u1', pin: 'IO1' }])
  })
  it('compiles no cable from a host port with no power domain, and says the device is not simulated that way', () => {
    const dev = boardModule({}, 'test-dev')
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: piLike() }, { uid: 'u2', module: dev }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.USB-A', 'u2.USB']])
    const c = buildCircuit(d)
    expect(c.devices.some((x) => x.kind === 'resistor' && x.role === 'cable')).toBe(false)
    expect(c.usb).toEqual([])
    expect(c.unsimulated).toContainEqual({ part: 'u2', reason: 'powered from U1 USB-A, whose USB power is not simulated' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/piShape.test.ts`
Expected: FAIL: `inputLow` is an unknown field of `sim.gpio`.

- [ ] **Step 3: The data shape and its validation**

In `src/format/simModel.ts`, extend `GpioSpec`:

```ts
export interface GpioSpec {
  domain: string; pins: string[]; outputResistance: Quantity; pullup?: Quantity; pulldown?: Quantity; inputLeakage?: Quantity
  /** Logic thresholds (firmware spec 3.3): below inputLow reads 0, above inputHigh reads 1. */
  inputLow?: Quantity
  inputHigh?: Quantity
  /** Always-present pull-ups to the GPIO domain on the board itself (the Pi's 1.8 kohm on GPIO2 and GPIO3), ruling R3. */
  fixedPullups?: { pin: string; ohms: Quantity }[]
}
```

In `validateSim`'s `s.gpio` block, change the allowed keys to `['domain', 'pins', 'outputResistance', 'pullup', 'pulldown', 'inputLeakage', 'inputLow', 'inputHigh', 'fixedPullups']` and add after the `inputLeakage` line:

```ts
      for (const k of ['inputLow', 'inputHigh']) if (g[k] !== undefined) quantity(g[k], `${w}.${k}`, 'V', { positive: true })
      const lo = val(g.inputLow)
      const hi = val(g.inputHigh)
      if (lo !== undefined && hi !== undefined && lo >= hi) errors.push(`${w}.inputLow: must be below inputHigh`)
      if (g.fixedPullups !== undefined) {
        const gpioPins = Array.isArray(g.pins) ? g.pins : []
        ;(Array.isArray(g.fixedPullups) ? g.fixedPullups : [null]).forEach((fp, i) => {
          const at2 = `${w}.fixedPullups[${i}]`
          if (!isObj(fp)) return void errors.push(`${at2}: must be { "pin", "ohms" }`)
          keys(fp, ['pin', 'ohms'], at2)
          if (typeof fp.pin !== 'string' || !gpioPins.includes(fp.pin)) errors.push(`${at2}.pin: "${show(fp.pin)}" is not one of the GPIO pins`)
          quantity(fp.ohms, `${at2}.ohms`, 'ohm', { positive: true })
        })
      }
```

- [ ] **Step 4: The `internal` role and the build**

In `src/sim/model.ts`, the resistor variant's `role` becomes `'resistor' | 'contact' | 'cable' | 'rail-input' | 'switch-rail' | 'internal'`, with the comment line above `Device`: `` `internal`: an always-present resistor inside a part (a board's fixed pull-up, a servo's signal load), never a user resistor. ``

In `src/sim/power.ts` `powerPart`, inside `if (g && io)` after the `for (const pin of g.pins)` loop, add:

```ts
  // Fixed pull-ups on the board (firmware spec 3.3, ruling R3): always there, whatever the code does.
  if (g && io)
    for (const fp of g.fixedPullups ?? []) {
      const node = b.tap(p.uid, fp.pin)
      if (node) b.add({ kind: 'resistor', id: `${p.uid}.pullup.${fp.pin}`, part: p.uid, a: io.pin, b: node, ohms: P(fp.ohms, `gpio.fixedPullups.${fp.pin}`), role: 'internal' })
    }
```

(The existing loop is a single statement under `if (g && io)`; add this as a second `if (g && io)` block after it.)

In `usbLinks`, right after the `if (!simOf(hm)?.power) { ... continue }` block, add:

```ts
    // A host port that no power domain feeds (a Pi's USB-A ports, firmware spec 3.3): it powers
    // nothing here, exactly as before the host had power data.
    if (!simOf(hm)!.power!.domains.some((x) => x.pin === `${host.name}#vbus`)) {
      b.unsimulated(dev.part.uid, `powered from ${b.ref(host.part.uid)} ${host.name}, whose USB power is not simulated`)
      continue
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/sim src/format`
Expected: PASS (the existing USB tests still pass: `test-host` and `computer-usb-port` feed `USB#vbus` from a domain).

- [ ] **Step 6: Build the CLI and commit**

Run: `npm run build:cli && npm run validate`

```bash
git add src/format/simModel.ts src/sim/model.ts src/sim/power.ts src/sim/piShape.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Sim: GPIO thresholds and fixed pull-ups (internal resistors); a host port with no power domain powers nothing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 7: The servo's simulation shape and build

**Files:**
- Create: `src/sim/servoShape.test.ts`
- Modify: `src/format/simModel.ts` (`SimUnit` `'s'`, `ServoSpec`, `SimSpec.servo`, `validateSim`), `src/sim/build.ts` (`BuildOptions.moving`, the `servo` model), `src/sim/power.ts` (the moving draw), `src/sim/testing.ts` (`servoModule`)

**Interfaces:**
- Consumes: `powerPart`, `Builder` (existing); `q`, `sheet`, `cellModule` (`testing.ts`).
- Produces:
  - `type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1' | 's'`
  - `interface ServoSpec { signal: string; pulseMin: Quantity; pulseMax: Quantity; slew: Quantity; moving: Quantity; signalLoad: Quantity }`; `SimSpec.servo?: ServoSpec` (ruling R4)
  - `BuildOptions.moving?: string[]`; `Builder.isMoving(uid: string): boolean`
  - `function servoModule(id?: string): ModuleDef` in `src/sim/testing.ts` (inline SG90-like: VCC 5 V, idle 10 mA, moving 200 mA, 20 kohm signal load, 500 to 2400 us, 0.1 s per 60 degrees)

- [ ] **Step 1: Write the failing test**

`src/sim/servoShape.test.ts`:

```ts
// Firmware spec 3.4 (shape only; Task 9 sources the SG90's numbers): a servo is a load on VCC that
// draws its idle current, or its moving current while the horn travels (BuildOptions.moving), and its
// signal pin is an input load (an internal resistor to its ground).
import { describe, expect, it } from 'vitest'
import { validateModule } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { cellModule, servoModule, sheet } from './testing.ts'

const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'm1', module: servoModule() }], [['bt1.+', 'm1.VCC'], ['bt1.-', 'm1.GND']])

describe('servo shape (spec 3.4)', () => {
  it('validates, and refuses a pulse range the wrong way round or a bad signal pin', () => {
    expect(validateModule(servoModule()).ok).toBe(true)
    const m = servoModule()
    const sim = (m.electrical as { sim: { servo: Record<string, unknown> } }).sim.servo
    const errs = (patch: Record<string, unknown>) => { const r = validateModule({ ...m, electrical: { ...(m.electrical as object), sim: { ...(m.electrical as { sim: object }).sim, servo: { ...sim, ...patch } } } }); return r.ok ? [] : r.errors }
    expect(errs({ pulseMin: sim.pulseMax })).toContain('electrical.sim.servo.pulseMin: must be below pulseMax')
    expect(errs({ signal: 'NOPE' })).toContain('electrical.sim.servo.signal: no pin "NOPE"')
    expect(errs({ slew: { ...(sim.slew as object), unit: 'V' } })).toContain('electrical.sim.servo.slew.unit: must be "s"')
  })
  it('draws idle current at rest and moving current while moving', () => {
    const at = (moving: string[]) => buildCircuit(d, { moving }).devices.find((x) => x.kind === 'load')
    expect(at([])).toMatchObject({ typical: { value: 0.01 } })
    expect(at(['m1'])).toMatchObject({ typical: { value: 0.2, label: 'servo-sg90-test.M1.servo.moving' } })
  })
  it('loads the signal pin with an internal resistor to the servo ground', () => {
    const r = buildCircuit(d).devices.find((x) => x.id === 'm1.signal')
    expect(r).toMatchObject({ kind: 'resistor', role: 'internal', a: 'm1:PWM', b: 'm1:GND', ohms: { value: 20000 } })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/servoShape.test.ts`
Expected: FAIL, `servoModule` is not exported.

- [ ] **Step 3: The shape**

In `src/format/simModel.ts`:
- `export type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1' | 's'`
- add before `SimSpec`:
  ```ts
  /**
   * A hobby servo (firmware spec 3.4, ruling R4): the signal pin, the pulse widths that map to 0 and
   * 180 degrees, the slew time per 60 degrees, the current while the horn travels (its idle current
   * is the ordinary sim.power draw) and the signal pin's input load.
   */
  export interface ServoSpec { signal: string; pulseMin: Quantity; pulseMax: Quantity; slew: Quantity; moving: Quantity; signalLoad: Quantity }
  ```
- `SimSpec` gains `servo?: ServoSpec`;
- in `validateSim`, add `'servo'` to the allowed `sim` keys and, before the `usbPorts` block:
  ```ts
  if (s.servo !== undefined) {
    const w = `${at}.servo`
    const v = s.servo
    if (!isObj(v)) errors.push(`${w}: must be an object`)
    else {
      keys(v, ['signal', 'pulseMin', 'pulseMax', 'slew', 'moving', 'signalLoad'], w)
      if (typeof v.signal !== 'string' || !names.has(v.signal)) errors.push(`${w}.signal: no pin "${show(v.signal)}"`)
      for (const [k, unit] of [['pulseMin', 's'], ['pulseMax', 's'], ['slew', 's'], ['moving', 'A'], ['signalLoad', 'ohm']] as const) quantity(v[k], `${w}.${k}`, unit, { positive: true })
      const lo = val(v.pulseMin)
      const hi = val(v.pulseMax)
      if (lo !== undefined && hi !== undefined && lo >= hi) errors.push(`${w}.pulseMin: must be below pulseMax`)
    }
  }
  ```

- [ ] **Step 4: The build**

In `src/sim/build.ts`:
- `BuildOptions` gains:
  ```ts
    /** Servos whose horn is travelling (firmware spec 2.3): they draw their moving current. Transient, never saved. */
    moving?: string[]
  ```
- `Builder` gains `isMoving(uid: string): boolean { return this.opts.moving?.includes(uid) ?? false }`;
- in `compile`'s `switch (model)`, add before the closing brace:
  ```ts
      case 'servo': {
        // Firmware spec 3.4: a load on its supply (idle, or moving while the horn travels) and an input load on its signal pin.
        const sim = simOf(m)
        if (!sim?.power) return this.skip(p.uid, NO_POWER_DATA)
        powerPart(this, p, m)
        const s = sim.servo
        const ret = sim.power.domains[0]?.ret
        const a = s && this.simulated(p.uid) ? this.tap(p.uid, s.signal) : null
        const g = a && ret ? this.tap(p.uid, ret) : null
        if (s && a && g) this.add({ kind: 'resistor', id: `${p.uid}.signal`, part: p.uid, a, b: g, ohms: this.param(s.signalLoad, label('servo.signalLoad')), role: 'internal' })
        return
      }
  ```

In `src/sim/power.ts` `powerPart`, in the draw loop, replace the `typical` line with:

```ts
    // A servo whose horn is travelling draws its moving current (firmware spec 3.4); else the stated draw.
    const moving = sim.servo && b.isMoving(p.uid) ? P(sim.servo.moving, 'servo.moving') : null
    const typical = moving ?? (tOver !== null ? b.user(tOver, L(`draw.${dr.domain}.typical`)) : P(dr.typical, `draw.${dr.domain}.typical`))
```

- [ ] **Step 5: The test servo**

Append to `src/sim/testing.ts`:

```ts
/** An SG90-like servo for tests: VCC 5 V draws 10 mA idle and 200 mA moving; PWM is a 20 kohm load; 500 to 2400 us, 0.1 s per 60 degrees. */
export function servoModule(id = 'servo-sg90-test'): ModuleDef {
  return mod(id, pins([{ name: 'GND', type: 'ground' }, { name: 'VCC', type: 'power_in' }, { name: 'PWM', type: 'input' }]), {
    model: 'servo',
    sim: {
      power: { domains: [{ name: 'VCC', pin: 'VCC', ret: 'GND', nominal: 5 }], draw: [{ domain: 'VCC', typical: q(0.01, 'A', 'estimate') }] },
      servo: { signal: 'PWM', pulseMin: q(0.0005, 's', 'estimate'), pulseMax: q(0.0024, 's', 'estimate'), slew: q(0.1, 's'), moving: q(0.2, 'A', 'estimate'), signalLoad: q(20000, 'ohm', 'estimate') },
    },
  })
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/sim src/format`
Expected: PASS.

- [ ] **Step 7: Build the CLI and commit**

Run: `npm run build:cli && npm run validate`

```bash
git add src/format/simModel.ts src/sim/build.ts src/sim/power.ts src/sim/testing.ts src/sim/servoShape.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Sim: the servo shape (pulse range, slew, moving draw, signal load) and its build

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

## Sourcing protocol (Tasks 8 and 9)

Datasheet numbers are not in this plan: they are found, written and checked by the tasks below, exactly as the live simulation's Tasks 18 to 24 did (its plan, section "Sourcing protocol"). Every research brief starts with this rule, word for word:

> **A wrong number is worse than a missing one. When you are unsure, use `estimate` with a note.**

1. **Output.** One patch per module, `scripts/sim-data/<module id>.json`, in the existing format `{ id, researched, sim, notes, unaccounted, review }` (see `scripts/sim-data/rpi-pico.json`). `sim` must pass `validateSim` and the structure the task lists. Nothing in `modules/` changes by hand: run the module's generator (`node scripts/gen-usb.mjs` for the Pis, `node scripts/gen-outputs.mjs` for the servo), whose `emit()` merges the patch.
2. **Provenance per value.** `datasheet` (the exact part's or chip's own document; `source` is a direct URL, `note` the table or page and conditions), `representative` (a named representative part's datasheet), `estimate` (no source, or derived; `note` says what was assumed or the arithmetic).
3. **Chip is not board.** A chip value used for a whole board says "chip, not board" in its `note`. Board extras get a number only from the board's schematic or a measurement; otherwise they go into `unaccounted`.
4. **Limits** carry their test `conditions`.
5. **Required fields** are never guessed as `datasheet`: if one cannot be sourced it is an `estimate` with a note.
6. **URLs** are opened and the number is on the page. Never write a URL that was not opened. Prefer the maker's PDF (Raspberry Pi's datasheets at `datasheets.raspberrypi.com` and `pip.raspberrypi.com`, the RP1 peripherals document, the BCM2711 ARM peripherals document, the Tower Pro or a distributor's SG90 sheet).
7. **Privacy.** No request carries Michael's email or personal data: not in a User-Agent, a form, a query or a header.
8. **Non-numbers** (a rail's `reverse`, what was left out, why a value is an estimate) go in `notes` with the reason.
9. **Who does what.** The **controller** dispatches every research and review subagent, never the implementer: researcher, then reviewer A, then reviewer B. Each writes into `.superpowers/sim-data-staging/<task>/`. The implementer only applies the verified patches from staging and runs the tests.
10. **Two independent reviewers** (firmware spec 3.3) check every patch before it is committed: two fresh subagents that did not do the research, each given only the staged patch files and this protocol (B does not see A's notes). Each opens every `source`, checks every value, unit, provenance, condition and note, and appends one record to the patch's `review` array (`{ "date", "reviewer", "checked", "corrected": [{ "path", "was", "now", "why" }], "disputed": [] }`). The controller applies A's corrections before B sees the patches, then B's. A disputed value becomes an `estimate` with both readings in its `note`, or the controller decides it. A patch leaves staging only with two review records.

### Task 8: Source the three Raspberry Pis

**Files:**
- Create: `scripts/sim-data/rpi-4-model-b.json`, `scripts/sim-data/rpi-5.json`, `scripts/sim-data/rpi-zero-2-w.json`
- Modify (generated): `modules/rpi-4-model-b.json`, `modules/rpi-5.json`, `modules/rpi-zero-2-w.json`
- Modify: `src/run/power.ts` is created in Task 28; this task only verifies the 4.63 V value (ruling R8) and records its URL in the `notes` of `scripts/sim-data/rpi-4-model-b.json` (Task 28 reads it from there)
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; Tasks 6 and 7 (the shape); `validateSim`.
- Produces, per Pi (spec 3.3, rulings R3 and R9):
  - `sim.usbPorts`: the power input port to its ground pin (`{ "USB-C": { "gnd": "GND" } }` on the Pi 4 and Pi 5, `{ "PWR IN": { "gnd": "GND" } }` on the Zero 2 W);
  - `sim.power.domains`: exactly `5V` (pin `5V`, ret `GND`, nominal 5), the input port's domain (`USB`, pin `<port>#vbus`, ret `<port>#gnd`, nominal 5) and `3V3` (pin `3V3`, ret `GND`, nominal 3.3);
  - `sim.power.rails`: input port to `5V` (whatever the board has between them: the Pi 4's and Pi 5's USB-C path and the Zero's micro-USB path, from the board schematics or the product briefs, as a `switch` rail with `ron` or `vf`), and `5V` to `3V3` (the board's 3.3 V regulator: its kind, `vout`, and that kind's required fields, `ioutMax` from the documented 3.3 V header budget where the board states one);
  - `sim.power.draw`: one draw on `5V` with `typical` and `peak` (with `note` and a short `label`) for the whole board at idle and under load, from Raspberry Pi's own power figures (board, not chip), and `minVolts` (sourced, or an estimate with the reasoning: a board browns out below its under-voltage threshold region);
  - `sim.gpio`: domain `3V3`, `pins` `GPIO2` to `GPIO27` (26 pins; GPIO0 and GPIO1 are the HAT ID EEPROM pins and stay out), `outputResistance` (from the drive-strength and VOH/VOL figures, an estimate with the arithmetic, as the Pico's), `pullup` and `pulldown` (about 50 to 65 kohm per spec 3.3, sourced: BCM2711 for the Pi 4, RP1 for the Pi 5, the BCM2710A1/BCM2837 family for the Zero 2 W), `inputLeakage` if documented, `inputLow` and `inputHigh` (BCM2711: about 0.8 V and 2.0 V at 3.3 V IO, two sources; RP1 partly undocumented, so flagged estimates), and `fixedPullups` `[{ "pin": "GPIO2", "ohms": 1800 }, { "pin": "GPIO3", "ohms": 1800 }]` (from the board schematics);
  - `sim.limits`: a per-pin `current` limit and an `ioTotalCurrent` on `3V3` where Raspberry Pi documents them (with conditions), else none and a `notes` entry saying so;
  - `unaccounted`: what the board draw leaves out (USB devices on the USB-A ports, HATs, the camera and display connectors);
  - the 4.63 V under-voltage warning threshold (ruling R8): the source URL and the exact wording, in `notes` of the Pi 4 patch ("not a sim field: used by src/run/power.ts PI_UNDER_VOLTAGE").

- [ ] **Step 1 (controller): Research**

The controller dispatches a research subagent with the Sourcing protocol, the field list above and the three module files. It writes the patches, with `"review": []`, to `.superpowers/sim-data-staging/task-8/`.

- [ ] **Step 2 (controller): Reviewer A, then reviewer B**

As in protocol item 10. Each patch ends with two `review` records; the 4.63 V note is checked like a value.

- [ ] **Step 3 (implementer): Apply the verified patches, regenerate and validate**

Run: `cp .superpowers/sim-data-staging/task-8/*.json scripts/sim-data/ && node scripts/gen-usb.mjs && npm run validate && npm run check:gen`
Expected: the three Pi modules rewritten with `electrical.sim`; every module valid; every generator matching. A validation error goes back to the controller with the message; the implementer never edits a number.

- [ ] **Step 4: Add the data test block**

Append to `src/sim/data.test.ts` (add the imports `buildCircuit` from `./build.ts`, `sheet` and `boardModule` from `./testing.ts` if absent):

```ts
describe('the Raspberry Pis (firmware spec 3.3)', () => {
  const PIS = ['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w']
  it.each(PIS)('%s: 5V, the input port and 3V3, GPIO2 to GPIO27 on 3V3 with thresholds and pulls', (id) => {
    const sim = simOf(load(id))!
    expect(sim.power!.domains.map((d) => d.name).sort()).toEqual(['3V3', '5V', 'USB'])
    expect(sim.power!.draw!.map((d) => d.domain)).toEqual(['5V'])
    expect(sim.power!.draw![0].minVolts).toBeDefined()
    expect(sim.gpio!.domain).toBe('3V3')
    expect(sim.gpio!.pins).toEqual(Array.from({ length: 26 }, (_, i) => `GPIO${i + 2}`))
    expect(sim.gpio!.inputLow!.value).toBeLessThan(sim.gpio!.inputHigh!.value)
    expect(sim.gpio!.pullup!.value).toBeGreaterThan(40_000)
    expect(sim.gpio!.fixedPullups!.map((f) => [f.pin, f.ohms.value])).toEqual([['GPIO2', 1800], ['GPIO3', 1800]])
  })
  it('flags the Pi 5 RP1 thresholds as estimates (partly undocumented)', () => {
    const g = simOf(load('rpi-5'))!.gpio!
    expect([g.inputLow!.provenance, g.inputHigh!.provenance]).toEqual(['estimate', 'estimate'])
  })
  it('builds GPIO2 and GPIO3 pull-ups as internal resistors, not user resistors', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: 'rpi-4-model-b' }], []))
    expect(c.devices.filter((d) => d.kind === 'resistor' && d.id.startsWith('u1.pullup.')).map((d) => [d.id, d.kind === 'resistor' && d.role])).toEqual([['u1.pullup.GPIO2', 'internal'], ['u1.pullup.GPIO3', 'internal']])
  })
  it('keeps the USB-A ports "not simulated": a USB device on one is listed, with no cable compiled', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'u2', module: boardModule({}, 'test-dev') }], [['u1.USB2-1', 'u2.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u2', reason: 'powered from U1 USB2-1, whose USB power is not simulated' })
    expect(c.usb).toEqual([])
  })
})
```

The existing test in `src/sim/power.test.ts` "does not simulate USB power from a host with no power data" used the Pi 4 as its host with no power data; the Pi now has some. Give it an inline host with none (same reason text as before):

```ts
    const bare = { ...hostModule('test-host-nodata'), electrical: { model: 'computer' } }
    const c = buildCircuit(sheet([{ uid: 'j1', module: bare }, { uid: 'u1', module: boardModule() }], [['j1.USB', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered from J1 over USB, which has no power data' })
```

Run: `npx vitest run src/sim`
Expected: PASS. (`spirit.test.ts` and the build goldens use no Pi, so they do not move.)

- [ ] **Step 5: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add scripts/sim-data modules src/sim/data.test.ts src/sim/power.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Data: sourced power and GPIO data for the Raspberry Pi 4, Pi 5 and Zero 2 W (two reviewers)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 9: Source the SG90 servo

**Files:**
- Create: `scripts/sim-data/servo-sg90.json`
- Modify (generated): `modules/servo-sg90.json`
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; Task 7 (the shape).
- Produces (spec 3.4, ruling R4):
  - `sim.power`: domain `VCC` (pin `VCC`, ret `GND`, nominal 5), one draw on it: `typical` = the idle current (sourced or flagged), optional `peak` = the stall current with `note` and `label` "stalled";
  - `sim.servo`: `signal: "PWM"`, `pulseMin` 0.0005 s and `pulseMax` 0.0024 s as **flagged estimates** whose `note` says they are the travel real units show and that the Tower Pro sheet gives 1 to 2 ms for -90 to +90 degrees (spec 3.4), `slew` 0.1 s per 60 degrees at 4.8 V (`datasheet`, with the condition in `note`), `moving` (the running current, sourced or flagged), `signalLoad` (an estimate with the reasoning: the signal input's resistance).

- [ ] **Step 1 (controller): Research** into `.superpowers/sim-data-staging/task-9/`.

- [ ] **Step 2 (controller): Reviewer A, then reviewer B** (protocol item 10).

- [ ] **Step 3 (implementer): Apply and regenerate**

Run: `cp .superpowers/sim-data-staging/task-9/servo-sg90.json scripts/sim-data/ && node scripts/gen-outputs.mjs && npm run validate && npm run check:gen`
Expected: `modules/servo-sg90.json` gains `electrical.sim`; all valid and matching.

- [ ] **Step 4: Add the data test block**

Append to `src/sim/data.test.ts`:

```ts
describe('the SG90 servo (firmware spec 3.4)', () => {
  it('maps 500 to 2400 us as a flagged estimate and slews 0.1 s per 60 degrees from the datasheet', () => {
    const s = simOf(load('servo-sg90'))!.servo!
    expect([s.pulseMin.value, s.pulseMax.value]).toEqual([0.0005, 0.0024])
    expect([s.pulseMin.provenance, s.pulseMax.provenance]).toEqual(['estimate', 'estimate'])
    expect(s.pulseMin.note).toMatch(/1 to 2 ms/)
    expect(s).toMatchObject({ signal: 'PWM', slew: { value: 0.1, unit: 's', provenance: 'datasheet' } })
    expect(simOf(load('servo-sg90'))!.power!.domains).toEqual([{ name: 'VCC', pin: 'VCC', ret: 'GND', nominal: 5 }])
  })
})
```

Run: `npx vitest run src/sim/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add scripts/sim-data/servo-sg90.json modules/servo-sg90.json src/sim/data.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Data: sourced SG90 servo model (pulse range flagged, slew, idle and moving current; two reviewers)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# Phase C: Pyodide, the worker, shared memory and the Python stand-ins (spec 11 step 3)

### Task 10: Pyodide files: the pinned package, the manifest, the build copy and the deploy carry-forward

**Files:**
- Create: `scripts/gen-py.mjs`, `scripts/copy-py.mjs`, `scripts/carry-py.mjs`, `src/run/pyManifest.json` (generated), `py/NOTICE.txt`, `py/LICENSE-MPL-2.0.txt`, `py/LICENSE-PSF.txt`, `scripts/py.test.ts`
- Modify: `package.json` (`pyodide` pinned, `build`), `package-lock.json`, `scripts/deploy.sh`

**Interfaces:**
- Consumes: `emit`, `finish`, `log` (`scripts/lib/gen-output.mjs`).
- Produces:
  - `src/run/pyManifest.json`: `{ "version": string, "python": string, "source": string, "files": [{ "name": string, "sha256": string, "bytes": number }] }` for `pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` (checked by `npm run check:gen`)
  - `dist/py/<version>/` after `npm run build`: those files, `py.json` (the manifest), `NOTICE.txt` and the licences
  - `node scripts/carry-py.mjs --remote <url> [--dist <dir>]`: every `py/<version>/` on `gh-pages` not in `dist/` is copied in

- [ ] **Step 1: Pin Pyodide**

Run: `npm i -D -E pyodide@314.0.7 && node -p "require('pyodide/package.json').version"`
Expected: `314.0.7`. (Task 11 confirms this release; if it fails the checkpoint, the checkpoint names the release to pin instead and this task's steps are rerun with it.)

- [ ] **Step 2: Write the failing test**

`scripts/py.test.ts`:

```ts
// Firmware spec 2.7: the build copies the pinned Pyodide's core files into dist/py/<version>/ with
// py.json (names, sha256, bytes), the licences and a NOTICE; nothing is committed but the manifest;
// the deploy carries every older py/<version>/ forward from gh-pages.
import { describe, expect, it } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import PY from '../src/run/pyManifest.json' with { type: 'json' }

const node = (script: string, args: string[]) => spawnSync(process.execPath, [resolve(script), ...args], { encoding: 'utf8' })
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('Pyodide files (spec 2.7)', () => {
  it('pins the package version and lists the five core files with their hashes', () => {
    expect(PY.version).toBe(JSON.parse(readFileSync('node_modules/pyodide/package.json', 'utf8')).version)
    expect(PY.files.map((f) => f.name)).toEqual(['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
    for (const f of PY.files) expect(sha(`node_modules/pyodide/${f.name}`), f.name).toBe(f.sha256)
    expect(PY.python).toMatch(/^3\.\d+\.\d+$/)
  })
  it('copies them with py.json, the licences and the NOTICE into dist/py/<version>/', () => {
    const dist = mkdtempSync(join(tmpdir(), 'py-dist-'))
    const r = node('scripts/copy-py.mjs', ['--dist', dist])
    expect(r.status, r.stderr).toBe(0)
    const dir = join(dist, 'py', PY.version)
    for (const f of PY.files) expect(sha(join(dir, f.name))).toBe(f.sha256)
    expect(JSON.parse(readFileSync(join(dir, 'py.json'), 'utf8'))).toEqual(PY)
    for (const f of ['NOTICE.txt', 'LICENSE-MPL-2.0.txt', 'LICENSE-PSF.txt']) expect(existsSync(join(dir, f)), f).toBe(true)
    expect(readFileSync(join(dir, 'NOTICE.txt'), 'utf8')).toContain(`https://github.com/pyodide/pyodide/releases/tag/${PY.version}`)
  })
  it('carries older versions forward from gh-pages, never over the current one', () => {
    const repo = mkdtempSync(join(tmpdir(), 'py-pages-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo })
    git('init', '-q', '-b', 'gh-pages')
    mkdirSync(join(repo, 'py', '0.1.0'), { recursive: true })
    mkdirSync(join(repo, 'py', PY.version), { recursive: true })
    writeFileSync(join(repo, 'py', '0.1.0', 'pyodide.mjs'), 'old')
    writeFileSync(join(repo, 'py', PY.version, 'pyodide.mjs'), 'stale')
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'pages')
    const dist = mkdtempSync(join(tmpdir(), 'py-dist-'))
    mkdirSync(join(dist, 'py', PY.version), { recursive: true })
    writeFileSync(join(dist, 'py', PY.version, 'pyodide.mjs'), 'current')
    const r = node('scripts/carry-py.mjs', ['--remote', repo, '--dist', dist])
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(join(dist, 'py', '0.1.0', 'pyodide.mjs'), 'utf8')).toBe('old')
    expect(readFileSync(join(dist, 'py', PY.version, 'pyodide.mjs'), 'utf8')).toBe('current')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run scripts/py.test.ts`
Expected: FAIL: `src/run/pyManifest.json` does not exist.

- [ ] **Step 4: The manifest generator**

`scripts/gen-py.mjs`:

```js
// The pinned Pyodide's manifest (firmware spec 2.7): src/run/pyManifest.json names the core files the
// site serves and the CLI downloads, each with its sha256 and size, from node_modules/pyodide. The CLI
// compiles the hashes in; the build copies the files (copy-py.mjs). `npm run check:gen` runs this
// with --check, so a version bump without regenerating fails.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { emit, finish, log } from './lib/gen-output.mjs'

/** Only the core and the stdlib (spec 2.7): no packages, no micropip. */
export const PY_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const dir = fileURLToPath(new URL('../node_modules/pyodide/', import.meta.url))
const version = JSON.parse(readFileSync(`${dir}package.json`, 'utf8')).version
const python = JSON.parse(readFileSync(`${dir}pyodide-lock.json`, 'utf8')).info.python
const files = PY_FILES.map((name) => {
  const bytes = readFileSync(dir + name)
  return { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
})
const out = fileURLToPath(new URL('../src/run/pyManifest.json', import.meta.url))
emit(out, `${JSON.stringify({ version, python, source: `https://github.com/pyodide/pyodide/releases/tag/${version}`, files }, null, 2)}\n`)
log('src/run/pyManifest.json', version, `Python ${python}`)
finish('gen-py.mjs')
```

Run: `node scripts/gen-py.mjs && cat src/run/pyManifest.json`
Expected: the manifest with five files; `python` is the CPython version the lock file states.

- [ ] **Step 5: The licences and the NOTICE**

Download, open and read each text (protocol item 6 applies: only URLs actually opened):
- `py/LICENSE-MPL-2.0.txt`: Pyodide's `LICENSE` file at the release tag, `https://raw.githubusercontent.com/pyodide/pyodide/<version>/LICENSE`;
- `py/LICENSE-PSF.txt`: CPython's `LICENSE` at the tag of the Python version in the manifest, `https://raw.githubusercontent.com/python/cpython/v<python>/LICENSE`;
- `py/NOTICE.txt`, written by hand:

```text
Python in Circuitoon runs on Pyodide, unmodified official release files:

  Pyodide <version> (Python <python>)
  Source: https://github.com/pyodide/pyodide/releases/tag/<version>
  Files: pyodide.mjs, pyodide.asm.mjs, pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json

Pyodide is under the Mozilla Public License 2.0 (LICENSE-MPL-2.0.txt).
CPython and its standard library are under the Python Software Foundation License (LICENSE-PSF.txt),
which also lists the licences of the libraries CPython bundles.
Pyodide's build of CPython links further libraries; their notices are in the source release above.
```

with `<version>` and `<python>` filled in from the manifest (`copy-py.mjs` checks the version string is present).

- [ ] **Step 6: The build copy and the deploy carry-forward**

`scripts/copy-py.mjs`:

```js
// Copies the pinned Pyodide into the built site (firmware spec 2.7): dist/py/<version>/ gets the core
// files (checked against src/run/pyManifest.json), py.json and the licences. `npm run build` runs it
// after vite build. Usage: node scripts/copy-py.mjs [--dist dist]
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const at = process.argv.indexOf('--dist')
const dist = at < 0 ? 'dist' : process.argv[at + 1]
const PY = JSON.parse(readFileSync('src/run/pyManifest.json', 'utf8'))
const dir = join(dist, 'py', PY.version)
mkdirSync(dir, { recursive: true })
for (const f of PY.files) {
  const bytes = readFileSync(join('node_modules', 'pyodide', f.name))
  if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) {
    console.error(`copy-py: node_modules/pyodide/${f.name} is not the file in src/run/pyManifest.json; run node scripts/gen-py.mjs after changing the Pyodide version`)
    process.exit(1)
  }
  writeFileSync(join(dir, f.name), bytes)
}
writeFileSync(join(dir, 'py.json'), `${JSON.stringify(PY, null, 2)}\n`)
const notice = readFileSync('py/NOTICE.txt', 'utf8')
if (!notice.includes(PY.source)) {
  console.error(`copy-py: py/NOTICE.txt does not name ${PY.source}; update it for the new version`)
  process.exit(1)
}
for (const f of ['NOTICE.txt', 'LICENSE-MPL-2.0.txt', 'LICENSE-PSF.txt']) copyFileSync(join('py', f), join(dir, f))
console.log(`copy-py: ${dir} (${PY.files.length} files, Python ${PY.python})`)
```

`scripts/carry-py.mjs`:

```js
// Carries every previously released py/<version>/ from the gh-pages branch into dist/ (firmware spec
// 2.7), so a plugin pinned to an older Pyodide keeps working after a deploy (deploy.sh force-pushes
// dist/). The version this build copied is never overwritten. Usage:
//   node scripts/carry-py.mjs --remote <git url or path> [--dist dist]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1]
}
const remote = arg('--remote')
const dist = arg('--dist', 'dist')
if (!remote) {
  console.error('carry-py: --remote <git url or path> is required')
  process.exit(2)
}
const tmp = mkdtempSync(join(tmpdir(), 'carry-py-'))
try {
  try {
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'gh-pages', remote, tmp], { stdio: 'pipe' })
  } catch {
    console.log('carry-py: no gh-pages branch yet; nothing to carry')
    process.exit(0)
  }
  const old = existsSync(join(tmp, 'py')) ? readdirSync(join(tmp, 'py')) : []
  const carried = old.filter((v) => !existsSync(join(dist, 'py', v)))
  for (const v of carried) cpSync(join(tmp, 'py', v), join(dist, 'py', v), { recursive: true })
  console.log(`carry-py: carried ${carried.length ? carried.join(', ') : 'nothing'} forward`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
```

In `package.json`, `"build": "tsc --noEmit && vite build && node scripts/copy-py.mjs"`. In `scripts/deploy.sh`, after `npm run build` and before `touch dist/.nojekyll`:

```bash
# Older plugins pin older Pyodide releases (firmware spec 2.7): keep every published py/<version>/.
node scripts/carry-py.mjs --remote "$(git remote get-url origin)"
```

- [ ] **Step 7: Run the tests, the generator check and the build**

Run: `npx vitest run scripts/py.test.ts && npm run check:gen && npm run build && ls dist/py/*/`
Expected: PASS (3 tests); `check-gen` lists `gen-py.mjs: 1 generated files match`; the build ends with the copy-py line; `dist/py/314.0.7/` holds the five files, `py.json`, the NOTICE and two licences.

- [ ] **Step 8: Commit**

```bash
git add scripts/gen-py.mjs scripts/copy-py.mjs scripts/carry-py.mjs scripts/py.test.ts scripts/deploy.sh src/run/pyManifest.json py package.json package-lock.json
git commit -m "$(cat <<'MSG'
Pyodide: pinned package, generated manifest, dist/py/<version> at build, older versions carried forward at deploy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 11: The Pyodide checkpoint (version, served size, no 'unsafe-eval', memory cap)

**Files:**
- Create: `scripts/py-checkpoint.mjs`, `src/run/limits.ts`, `src/run/limits.test.ts`

**Interfaces:**
- Consumes: Task 10 (`dist/py/<version>/`), `CODE_WORKER_CSP` (Task 2), `launchChrome` (browser-check lib).
- Produces (`src/run/limits.ts`):
  - `const MAX_RUNNING: 2 | 4` (spec 2.1: 4 if the measured heap per board is at most 120 MB, else 2)
  - `const BOARD_HEAP_MB: number` (measured)
  - `const PY_JSGLOBALS: readonly string[]` (the globals Pyodide itself needs in `jsglobals`; empty unless the checkpoint finds otherwise)
  - the ledger entry: Pyodide version, Python version, served transfer, cold start, heap, CSP result

**Pass criteria** (all must hold; each is printed by the script):
1. **No 'unsafe-eval':** in a module worker whose script carries exactly `CODE_WORKER_CSP`, `loadPyodide` with `jsglobals` from `PY_JSGLOBALS` resolves, `runPython("import sys; sys.version")` returns the manifest's Python version, `new Function('return 1')` throws (the policy is in force), and no `securitypolicyviolation` event fired.
2. **Served size ≤ 8 MB** (ruling R15): the live site's `Content-Encoding` for `sim/ngspice.wasm` (`.wasm`), `sim/ngspice.mjs` (`.mjs`) and `sim/engine.json` (`.json`) is read with `Accept-Encoding: gzip`; each Pyodide file's transfer is its gzip -6 size when Pages compresses that type, else its raw size (`python_stdlib.zip` is raw); the sum is at most 8,388,608 bytes.
3. **Memory:** the worker's wasm heap (`pyodide._module.HEAP8.buffer.byteLength`) after importing `heapq`, `linecache`, `traceback`, `threading`, `json`, `inspect` and running a 100,000-step loop, in MB, gives `MAX_RUNNING` (≤ 120: 4, else 2).
4. **Version:** the Pyodide and Python versions printed match `src/run/pyManifest.json`.

**If a criterion fails:**
- 1 fails with a violation naming `'unsafe-eval'` (or `eval`): stop. Do not add `'unsafe-eval'`. Record the violation text and the stack in the ledger; the controller amends the spec (spec 2.6 says so) before any later task. If `loadPyodide` fails for a missing global instead (a `ReferenceError` naming it), add that name to `PY_JSGLOBALS`, rerun, and record why it is needed.
- 1 fails because `lockFileContents` is not an option of this release (the error names it): use `lockFileURL: <indexURL>pyodide-lock.json` in the worker loaders instead (Task 17), and in this script, record it, rerun.
- 2 fails: stop and record each file's transfer; the controller rules on a stdlib trim (which modules, and how `python_stdlib.zip` is rebuilt reproducibly) as an amendment task before Task 12.
- 3 is over 120 MB: `MAX_RUNNING` is 2 (that is the spec's rule, not a failure).
- 4 differs: the wrong package is installed; fix the pin.

- [ ] **Step 1: Write the checkpoint script**

`scripts/py-checkpoint.mjs`:

```js
// The Pyodide checkpoint (firmware spec 2.6, 2.7, 9; plan Task 11). Serves the built site with COOP,
// COEP and, on the checkpoint worker, the code worker's CSP; loads the pinned Pyodide in that worker
// with the curated jsglobals; measures load time and heap; reads GitHub Pages' compression rule from
// the live site and computes the served transfer. Prints PASS or FAIL per criterion.
// Usage (after `npm run build`): node scripts/py-checkpoint.mjs [--port 4214]
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'
import { flagOf, launchChrome } from './lib/browser-check.mjs'

const PY = JSON.parse(readFileSync('src/run/pyManifest.json', 'utf8'))
const CSP = /CODE_WORKER_CSP = "([^"]+)"/.exec(readFileSync('vite.config.ts', 'utf8'))[1] // the one definition (Task 2)
const globals = JSON.parse(/PY_JSGLOBALS[^=]*=\s*(\[[^\]]*\])/.exec(existsSync('src/run/limits.ts') ? readFileSync('src/run/limits.ts', 'utf8') : 'PY_JSGLOBALS = []')[1].replace(/'/g, '"'))
const port = Number(flagOf('--port', '4214'))
const WORKER = `
const violations = []
self.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective + ' ' + e.blockedURI))
self.onmessage = async () => {
  const t0 = performance.now()
  try {
    const { loadPyodide } = await import('/circuitoon/py/${PY.version}/pyodide.mjs')
    const lock = await (await fetch('/circuitoon/py/${PY.version}/pyodide-lock.json')).text()
    const jsglobals = Object.fromEntries(${JSON.stringify(globals)}.map((n) => [n, self[n]]))
    const py = await loadPyodide({ indexURL: '/circuitoon/py/${PY.version}/', lockFileContents: lock, jsglobals })
    const loadMs = performance.now() - t0
    const version = py.runPython('import sys; sys.version.split()[0]')
    py.runPython('import heapq, linecache, traceback, threading, json, inspect\\nx = 0\\nfor i in range(100000): x += i')
    let evalBlocked = false
    try { new Function('return 1') } catch { evalBlocked = true }
    postMessage({ ok: true, loadMs, version, heapMB: py._module.HEAP8.buffer.byteLength / 1048576, evalBlocked, violations })
  } catch (e) {
    postMessage({ ok: false, error: String(e && e.stack || e), violations })
  }
}`
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const head = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (path === '/circuitoon/checkpoint.html') return void res.writeHead(200, { ...head, 'Content-Type': 'text/html' }).end('<!doctype html><title>checkpoint</title>')
  if (path === '/circuitoon/codeWorker-checkpoint.js') return void res.writeHead(200, { ...head, 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP }).end(WORKER)
  const file = join('dist', path.replace(/^\/circuitoon\//, ''))
  if (!existsSync(file)) return void res.writeHead(404).end()
  res.writeHead(200, { ...head, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
}).listen(port)

let failed = 0
const verdict = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failed++
}
const browser = await launchChrome()
const page = await (await browser.newContext()).newPage()
await page.goto(`http://localhost:${port}/circuitoon/checkpoint.html`)
const r = await page.evaluate(() => new Promise((res) => {
  const w = new Worker('/circuitoon/codeWorker-checkpoint.js', { type: 'module' })
  w.onmessage = (e) => res(e.data)
  w.onerror = (e) => res({ ok: false, error: e.message, violations: [] })
  w.postMessage('go')
}))
await browser.close()
server.close()
console.log(JSON.stringify(r, null, 2))
verdict(r.ok && r.evalBlocked && !r.violations.length, `1. Pyodide ${PY.version} loads under the CSP without 'unsafe-eval' (eval blocked: ${r.evalBlocked}; violations: ${r.violations?.join('; ') || 'none'})`)
verdict(r.ok && r.version === PY.python, `4. Python ${r.version} is the manifest's ${PY.python}`)

// 2. Served size, from the live site's compression rule (ruling R15).
const enc = {}
for (const [ext, f] of [['.wasm', 'sim/ngspice.wasm'], ['.mjs', 'sim/ngspice.mjs'], ['.json', 'sim/engine.json']]) {
  const res = await fetch(`https://mbarc.github.io/circuitoon/${f}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } })
  enc[ext] = res.headers.get('content-encoding') ?? 'identity'
}
let total = 0
for (const f of PY.files) {
  const bytes = readFileSync(join('node_modules/pyodide', f.name))
  const gz = enc[extname(f.name)] === 'gzip'
  const sent = gz ? gzipSync(bytes, { level: 6 }).length : bytes.length
  total += sent
  console.log(`  ${f.name}: ${(sent / 1048576).toFixed(2)} MB ${gz ? 'gzip' : 'raw'}`)
}
verdict(total <= 8 * 1048576, `2. first-Run transfer ${(total / 1048576).toFixed(2)} MB (budget 8 MB; Pages encodings ${JSON.stringify(enc)})`)
const cap = r.heapMB <= 120 ? 4 : 2
console.log(`3. heap ${r.heapMB?.toFixed(1)} MB per board: MAX_RUNNING = ${cap}; cold load ${r.loadMs?.toFixed(0)} ms`)
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Run it and judge each criterion**

Run: `npm run build && node scripts/py-checkpoint.mjs`
Expected: `PASS` on 1, 2 and 4, and the heap line. Apply "If a criterion fails" above to any `FAIL`. Copy the whole output into the ledger.

- [ ] **Step 3: Write the results down, with a test that keeps them consistent**

`src/run/limits.ts` (fill the three values from the run; the comment records the date and the measurements):

```ts
// The Pyodide checkpoint's results (firmware spec 2.1, 2.6, 9; plan Task 11), measured on
// <date> with Pyodide <version> (Python <python>): cold load <ms> ms, wasm heap <MB> MB per board
// after the standard imports and a 100,000-step loop, first-Run transfer <MB> MB as Pages serves it.
// Loaded under the code worker CSP without 'unsafe-eval'.
/** At most this many boards run at once (spec 2.1): 4 when a board's heap is at most 120 MB, else 2. */
export const MAX_RUNNING: 2 | 4 = 4
/** The measured wasm heap per running board, in MB. */
export const BOARD_HEAP_MB = 0
/** The globals Pyodide itself needs in `jsglobals` (spec 2.6: nothing else); found at the checkpoint. */
export const PY_JSGLOBALS: readonly string[] = []
```

`src/run/limits.test.ts`:

```ts
// The checkpoint's results agree with the spec's rule and with the pinned manifest.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import PY from './pyManifest.json' with { type: 'json' }
import { BOARD_HEAP_MB, MAX_RUNNING, PY_JSGLOBALS } from './limits.ts'

describe('Pyodide checkpoint results (spec 2.1, 2.6)', () => {
  it('caps running boards by the measured heap', () => {
    expect(BOARD_HEAP_MB).toBeGreaterThan(0)
    expect(MAX_RUNNING).toBe(BOARD_HEAP_MB <= 120 ? 4 : 2)
  })
  it('passes only named globals and records the measured version', () => {
    for (const n of PY_JSGLOBALS) expect(n).toMatch(/^[A-Za-z]+$/)
    expect(readFileSync('src/run/limits.ts', 'utf8')).toContain(`Pyodide ${PY.version} (Python ${PY.python})`)
  })
})
```

Run: `npx vitest run src/run/limits.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/py-checkpoint.mjs src/run/limits.ts src/run/limits.test.ts
git commit -m "$(cat <<'MSG'
Pyodide checkpoint: loads under the code worker CSP without unsafe-eval; served size, heap and the board cap recorded

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: the controller reads the checkpoint output in the ledger before Task 12. A stop under "If a criterion fails" is settled (spec amendment or trim task) first.

### Task 12: Shared memory, seqlocks and board kinds

**Files:**
- Create: `src/run/memory.ts`, `src/run/boards.ts`, `src/run/memory.test.ts`, `src/run/memoryWriter.testing.ts`

**Interfaces:**
- Consumes: `ModuleDef` (type).
- Produces (`src/run/boards.ts`): `type BoardKind = 'pi4' | 'pi5' | 'zero2w'`; `const BOARD_KINDS: Record<string, BoardKind>`; `function boardKindOf(m: ModuleDef | undefined): BoardKind | null`; `function gpioPin(bcm: number): string` (`GPIO17`); `function bcmOf(pin: string): number | null`.
- Produces (`src/run/memory.ts`):
  - `NPINS = 28`; `MODE = { unused: 0, input: 1, pullup: 2, pulldown: 3, output: 4 }`, `type ModeCode`; `IN_STATUS = { none: 0, value: 1, floating: 2, undefined: 3 }`, `type InStatus = keyof typeof IN_STATUS`; `INPUT = { idle: 0, waiting: 1, ready: 2 }`
  - `H` header Int32 slots `{ wake, interrupt, outSeq, inSeq, solvedThrough, codeSeq, inputState, inputLen, pending }`; `F` header Float64 slots `{ clockMs, horizonMs, lastYieldMs, startMs }`
  - `interface BoardMemory { sab: SharedArrayBuffer; i32: Int32Array; f64: Float64Array; line: Uint8Array }`; `function boardMemory(sab?: SharedArrayBuffer): BoardMemory`
  - `interface PinOut { mode: ModeCode; latch: 0 | 1; pwmActive: boolean; duty: number; freq: number; rising: number; falling: number; highUs: number; changedUs: number }` (counters as uint32)
  - `interface PinIn { level: 0 | 1; rising: number; falling: number; status: InStatus; volts: number }`
  - `function writeLocked(m: BoardMemory, seq: number, fn: () => void): void`; `function readLocked<T>(m: BoardMemory, seq: number, fn: () => T): T`
  - `function readOut(m, bcm): PinOut`, `function setOut(m, bcm, p: Partial<PinOut>): void` (inside the out seqlock); `function readIn(m, bcm): PinIn`, `function setIn(m, bcm, p: PinIn): void` (inside the in seqlock)
  - `function readAllOut(m: BoardMemory): { rows: PinOut[]; codeSeq: number }` (one locked read: the code sequence is bumped inside setup's locked write, so it always numbers these rows; changed by the CP3 fix); `function writeIn(m: BoardMemory, rows: (PinIn | null)[], solvedThrough: number): void` (locked, then wakes)
  - `function wake(m): void`; `function interrupt(m): void`; `function writeLine(m, text: string): void`; `function takeLine(m): string`

- [ ] **Step 1: Write the failing test**

`src/run/memoryWriter.testing.ts` (a worker the test starts; Node runs it straight from the `.ts` file):

```ts
// Test worker: writes pin 5's rising, falling, highUs and duty to the same counter k under the out
// seqlock as fast as it can, until the main thread sets the wake word to -1.
import { workerData } from 'node:worker_threads'
import { H, boardMemory, setOut, writeLocked } from './memory.ts'

const m = boardMemory(workerData.sab as SharedArrayBuffer)
for (let k = 1; Atomics.load(m.i32, H.wake) !== -1; k++) writeLocked(m, H.outSeq, () => setOut(m, 5, { rising: k, falling: k, highUs: k, duty: k }))
```

`src/run/memory.test.ts`:

```ts
// Firmware spec 2.2: one SharedArrayBuffer per board with two seqlocked tables. Fields never overlap;
// counters wrap as uint32; a reader never sees a half-written row while the writer races it.
import { describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { F, H, IN_STATUS, INPUT, MODE, NPINS, boardMemory, readAllOut, readIn, readLocked, readOut, setOut, takeLine, writeIn, writeLine, writeLocked } from './memory.ts'
import { bcmOf, boardKindOf, gpioPin } from './boards.ts'
import { load } from '../format/builtinModules.testing.ts'

describe('board memory (spec 2.2)', () => {
  it('keeps every field of every pin apart from the header and each other', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => {
      for (let b = 0; b < NPINS; b++) setOut(m, b, { mode: MODE.output, latch: (b % 2) as 0 | 1, pwmActive: b % 3 === 0, duty: b / 100, freq: 50 + b, rising: 1000 + b, falling: 2000 + b, highUs: 3000 + b, changedUs: 4000 + b })
    })
    writeIn(m, Array.from({ length: NPINS }, (_, b) => ({ level: (b % 2) as 0 | 1, rising: 10 + b, falling: 20 + b, status: 'value' as const, volts: b / 10 })), 7)
    m.f64[F.clockMs] = 1.5
    m.f64[F.startMs] = 99
    for (let b = 0; b < NPINS; b++) {
      expect(readOut(m, b)).toEqual({ mode: MODE.output, latch: b % 2, pwmActive: b % 3 === 0, duty: b / 100, freq: 50 + b, rising: 1000 + b, falling: 2000 + b, highUs: 3000 + b, changedUs: 4000 + b })
      expect(readIn(m, b)).toEqual({ level: b % 2, rising: 10 + b, falling: 20 + b, status: 'value', volts: b / 10 })
    }
    expect([Atomics.load(m.i32, H.solvedThrough), m.f64[F.clockMs], m.f64[F.startMs], Atomics.load(m.i32, H.outSeq) % 2, Atomics.load(m.i32, H.inSeq) % 2]).toEqual([7, 1.5, 99, 0, 0])
    expect(readAllOut(m)).toHaveLength(NPINS)
  })
  it('wraps counters as uint32, so differences stay right across the wrap', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => setOut(m, 3, { rising: 0xffffffff }))
    const before = readOut(m, 3).rising
    writeLocked(m, H.outSeq, () => setOut(m, 3, { rising: before + 2 }))
    expect(before).toBe(0xffffffff)
    expect((readOut(m, 3).rising - before) >>> 0).toBe(2)
  })
  it('wakes waiters on writeIn and passes the input line', () => {
    const m = boardMemory()
    const w0 = Atomics.load(m.i32, H.wake)
    writeIn(m, [], 1)
    expect(Atomics.load(m.i32, H.wake)).toBe(w0 + 1)
    writeLine(m, 'héllo')
    expect(Atomics.load(m.i32, H.inputState)).toBe(INPUT.ready)
    expect(takeLine(m)).toBe('héllo')
    expect(Atomics.load(m.i32, H.inputState)).toBe(INPUT.idle)
    expect(readIn(m, 0).status).toBe('none')
    expect(IN_STATUS.none).toBe(0)
  })
  it('never lets a reader see a torn row while a worker writes (seqlock)', async () => {
    const m = boardMemory()
    const w = new Worker(new URL('./memoryWriter.testing.ts', import.meta.url), { workerData: { sab: m.sab } })
    await new Promise((r) => setTimeout(r, 50))
    let torn = 0
    let seen = 0
    for (let i = 0; i < 200_000; i++) {
      const o = readLocked(m, H.outSeq, () => readOut(m, 5))
      if (o.rising !== o.falling || o.rising !== o.highUs || o.duty !== o.rising) torn++
      seen = o.rising
    }
    Atomics.store(m.i32, H.wake, -1)
    await w.terminate()
    expect(seen).toBeGreaterThan(0)
    expect(torn).toBe(0)
  })
})

describe('board kinds', () => {
  it('names the three Pis and their header pins', () => {
    expect(['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w', 'rpi-pico'].map((id) => boardKindOf(load(id)))).toEqual(['pi4', 'pi5', 'zero2w', null])
    expect([gpioPin(17), bcmOf('GPIO17'), bcmOf('GND'), bcmOf('GPIO2/SDA')]).toEqual(['GPIO17', 17, null, null])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/memory.test.ts`
Expected: FAIL, `./memory.ts` cannot be found.

- [ ] **Step 3: Write `src/run/boards.ts`**

```ts
// Which modules run code (firmware spec 3.2, this slice: the Raspberry Pis) and how their pins are
// named: header GPIO pins are holes called GPIO<bcm>.
import type { ModuleDef } from '../format/module.ts'

export type BoardKind = 'pi4' | 'pi5' | 'zero2w'
export const BOARD_KINDS: Record<string, BoardKind> = { 'rpi-4-model-b': 'pi4', 'rpi-5': 'pi5', 'rpi-zero-2-w': 'zero2w' }
export const boardKindOf = (m: ModuleDef | undefined): BoardKind | null => (m && Object.hasOwn(BOARD_KINDS, m.id) ? BOARD_KINDS[m.id] : null)
export const gpioPin = (bcm: number): string => `GPIO${bcm}`
export function bcmOf(pin: string): number | null {
  const m = /^GPIO(\d+)$/.exec(pin)
  return m ? Number(m[1]) : null
}
```

- [ ] **Step 4: Write `src/run/memory.ts`**

```ts
// One running board's shared memory (firmware spec 2.2): a SharedArrayBuffer the code worker and the
// editor (or the CLI's driver) both map. Two tables, each written by one side only and guarded by a
// seqlock (odd while the writer is mid-update; readers retry until they read the same even value
// before and after): the pin table (mode, latch, declared PWM, bit-bang counters; the worker writes
// it) and the input table (levels, edge counters, voltages; the editor writes it). The header holds
// the wake word every wait blocks on, Pyodide's interrupt buffer, the code and solved sequence
// numbers, the input() line state and the clock doubles. Counters are wrapping uint32: read them as
// differences, `(now - then) >>> 0`. Worker side too: nothing Vite-specific.
//
// Byte layout: header ints 0..35, header doubles 64..95, pin table ints 128..1023 (8 per pin), pin
// doubles 1024..1471 (duty, freq per pin), input ints 2048..2495 (4 per pin), input doubles
// 2560..2783 (volts per pin), the input line 4096..8191.
export const NPINS = 28
export const MODE = { unused: 0, input: 1, pullup: 2, pulldown: 3, output: 4 } as const
export type ModeCode = (typeof MODE)[keyof typeof MODE]
export const IN_STATUS = { none: 0, value: 1, floating: 2, undefined: 3 } as const
export type InStatus = keyof typeof IN_STATUS
export const INPUT = { idle: 0, waiting: 1, ready: 2 } as const
/** Header Int32 slots. `interrupt` is Pyodide's interrupt buffer (2 = SIGINT). */
export const H = { wake: 0, interrupt: 1, outSeq: 2, inSeq: 3, solvedThrough: 4, codeSeq: 5, inputState: 6, inputLen: 7, pending: 8 } as const
/** Header Float64 slots: the virtual clock and the driver's horizon (ms of run time), the last yield (epoch ms, real time) and the run's start (epoch ms). */
export const F = { clockMs: 8, horizonMs: 9, lastYieldMs: 10, startMs: 11 } as const
const OUT_I = 32
const OUT_W = 8
const OUT_F = 128
const IN_I = 512
const IN_W = 4
const IN_F = 320
export const LINE_AT = 4096
export const LINE_MAX = 4096
export const SAB_BYTES = 8192
const STATUS_OF = Object.keys(IN_STATUS) as InStatus[]

export interface BoardMemory { sab: SharedArrayBuffer; i32: Int32Array; f64: Float64Array; line: Uint8Array }
export interface PinOut { mode: ModeCode; latch: 0 | 1; pwmActive: boolean; duty: number; freq: number; rising: number; falling: number; highUs: number; changedUs: number }
export interface PinIn { level: 0 | 1; rising: number; falling: number; status: InStatus; volts: number }

export function boardMemory(sab: SharedArrayBuffer = new SharedArrayBuffer(SAB_BYTES)): BoardMemory {
  return { sab, i32: new Int32Array(sab), f64: new Float64Array(sab), line: new Uint8Array(sab, LINE_AT, LINE_MAX) }
}

/** The writer's half of a seqlock: odd while `fn` runs, even after. One writer per table. */
export function writeLocked(m: BoardMemory, seq: number, fn: () => void): void {
  Atomics.add(m.i32, seq, 1)
  try {
    fn()
  } finally {
    Atomics.add(m.i32, seq, 1)
  }
}

/** The reader's half: retries until the sequence is the same even value before and after `fn`. */
export function readLocked<T>(m: BoardMemory, seq: number, fn: () => T): T {
  for (;;) {
    const a = Atomics.load(m.i32, seq)
    if (a & 1) continue
    const v = fn()
    if (Atomics.load(m.i32, seq) === a) return v
  }
}

export function readOut(m: BoardMemory, bcm: number): PinOut {
  const i = OUT_I + bcm * OUT_W
  const f = OUT_F + bcm * 2
  const v = m.i32
  return { mode: v[i] as ModeCode, latch: v[i + 1] ? 1 : 0, pwmActive: v[i + 2] !== 0, duty: m.f64[f], freq: m.f64[f + 1], rising: v[i + 3] >>> 0, falling: v[i + 4] >>> 0, highUs: v[i + 5] >>> 0, changedUs: v[i + 6] >>> 0 }
}

export function setOut(m: BoardMemory, bcm: number, p: Partial<PinOut>): void {
  const i = OUT_I + bcm * OUT_W
  const f = OUT_F + bcm * 2
  const v = m.i32
  if (p.mode !== undefined) v[i] = p.mode
  if (p.latch !== undefined) v[i + 1] = p.latch
  if (p.pwmActive !== undefined) v[i + 2] = p.pwmActive ? 1 : 0
  if (p.rising !== undefined) v[i + 3] = p.rising | 0
  if (p.falling !== undefined) v[i + 4] = p.falling | 0
  if (p.highUs !== undefined) v[i + 5] = p.highUs | 0
  if (p.changedUs !== undefined) v[i + 6] = p.changedUs | 0
  if (p.duty !== undefined) m.f64[f] = p.duty
  if (p.freq !== undefined) m.f64[f + 1] = p.freq
}

export function readIn(m: BoardMemory, bcm: number): PinIn {
  const i = IN_I + bcm * IN_W
  const v = m.i32
  return { level: v[i] ? 1 : 0, rising: v[i + 1] >>> 0, falling: v[i + 2] >>> 0, status: STATUS_OF[v[i + 3]] ?? 'none', volts: m.f64[IN_F + bcm] }
}

export function setIn(m: BoardMemory, bcm: number, p: PinIn): void {
  const i = IN_I + bcm * IN_W
  const v = m.i32
  v[i] = p.level
  v[i + 1] = p.rising | 0
  v[i + 2] = p.falling | 0
  v[i + 3] = IN_STATUS[p.status]
  m.f64[IN_F + bcm] = p.volts
}

/** Every pin's row, read under the seqlock. */
export function readAllOut(m: BoardMemory): PinOut[] {
  return readLocked(m, H.outSeq, () => Array.from({ length: NPINS }, (_, b) => readOut(m, b)))
}

/** The editor's write (spec 4.4): the rows it has, "solved through code sequence N", then a wake. */
export function writeIn(m: BoardMemory, rows: (PinIn | null)[], solvedThrough: number): void {
  writeLocked(m, H.inSeq, () => rows.forEach((r, bcm) => r && setIn(m, bcm, r)))
  Atomics.store(m.i32, H.solvedThrough, solvedThrough)
  wake(m)
}

/** Wakes every wait (spec 5.2): a new result, a line of input, Stop. */
export function wake(m: BoardMemory): void {
  Atomics.add(m.i32, H.wake, 1)
  Atomics.notify(m.i32, H.wake)
}

/** Stop (spec 5.4): KeyboardInterrupt at the next check, and a wake so a wait checks now. */
export function interrupt(m: BoardMemory): void {
  Atomics.store(m.i32, H.interrupt, 2)
  wake(m)
}

/** A line for input() (spec 5.3), cut to the buffer. */
export function writeLine(m: BoardMemory, text: string): void {
  const bytes = new TextEncoder().encode(text).slice(0, LINE_MAX)
  m.line.set(bytes)
  Atomics.store(m.i32, H.inputLen, bytes.length)
  Atomics.store(m.i32, H.inputState, INPUT.ready)
  wake(m)
}

export function takeLine(m: BoardMemory): string {
  const text = new TextDecoder().decode(m.line.slice(0, Atomics.load(m.i32, H.inputLen)))
  Atomics.store(m.i32, H.inputState, INPUT.idle)
  return text
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run/memory.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/run/memory.ts src/run/boards.ts src/run/memory.test.ts src/run/memoryWriter.testing.ts
git commit -m "$(cat <<'MSG'
Run: board shared memory (seqlocked pin and input tables, wake word, input line) and board kinds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 13: The bridge (`circuitoon_hw`) and the Python scheduler

**Files:**
- Create: `src/run/bridge.ts`, `src/run/protocol.ts`, `src/run/pyFiles.ts`, `src/run/py/_circuitoon.py`, `src/run/worker/serve.ts` (the shared helpers only; the loop comes in Task 17), `src/run/pyHarness.testing.ts`, `src/run/runtime.test.ts`

**Interfaces:**
- Consumes: Task 12 (memory, `BoardKind`).
- Produces:
  - `src/run/protocol.ts`: `type RunStatus = 'starting' | 'running' | 'done' | 'stopped' | 'error'`; `interface StartMessage { type: 'start'; sab: SharedArrayBuffer; files: Record<string, string>; source: string; file: string; board: BoardKind; mode: 'real' | 'virtual'; py: { indexURL: string; lock: string } }`; `type ToCode = StartMessage`; `type FromCode = { type: 'ready' } | { type: 'out'; stream: 'out' | 'err'; text: string } | { type: 'prompt'; text: string } | { type: 'block'; nowMs: number; untilMs: number } | { type: 'exit'; status: 'done' | 'stopped' | 'error' } | { type: 'fatal'; error: string }`
  - `src/run/bridge.ts`: `interface RunClock { now(): number; readonly epochMs: number; block(untilMs: number): void; poll(): void }`; `function realClock(m: BoardMemory, checkInterrupt: () => void): RunClock`; `function testClock(o: { onStep: (tMs: number) => void; limitMs: number; stop: () => void }): RunClock & { t: number }`; `function makeHw(m: BoardMemory, clock: RunClock, o: { board: BoardKind; onPrompt: (text: string) => void; flush: () => void }): Record<string, (...a: never[]) => unknown>` with `setup`, `output`, `read`, `pwm`, `rising`, `falling`, `volts`, `monotonic`, `epoch`, `block`, `yielded`, `pending`, `input_begin`, `input_ready`, `input_take`, `board`
  - `src/run/pyFiles.ts`: `const PY_FILES: Record<string, string>` (keys `_circuitoon.py`, `RPi/__init__.py`, `RPi/GPIO.py`, `gpiozero/__init__.py`)
  - `src/run/worker/serve.ts`: `interface PyodideLike`; `const PY_ROOT = '/lib/circuitoon'`; `function installFiles(py: PyodideLike, files: Record<string, string>): void`; `function runMain(py: PyodideLike, source: string, file: string): 'done' | 'stopped' | 'error'`; `function resetModules(py: PyodideLike): void`
  - `src/run/pyHarness.testing.ts`: `runScript(source: string, o?: { inputs?: ScriptInput[]; untilMs?: number; board?: BoardKind; file?: string }): Promise<RunResult>` with `type ScriptInput = { atMs: number; bcm: number; level: 0 | 1 } | { atMs: number; line: string }`, `interface RunResult { status: string; out: string; err: string; trace: Trace[]; prompts: string[]; yields: { t: number; pending: boolean }[]; t: number }`, `interface Trace { t: number; bcm: number; mode?: number; latch?: 0 | 1; pwm?: { active: boolean; duty: number; freq: number } }`
  - Python module `_circuitoon`: `UNSUPPORTED`, `THREADS`, `BOARD_TO_BCM` (the 40-pin BOARD to BCM map, Tasks 14 and 15 import it), `Timer`, `reset()`, `now()`, `call_later(delay, fn, period=None)`, `queue(fn)`, `add_poller(fn)`, `remove_poller(fn)`, `dispatch()`, `yield_point()`, `wait(seconds=None, until=None)`, `format_error(e)`, `install()`, `shutdown()`, `main(source, filename)`

- [ ] **Step 1: Write the failing test**

`src/run/runtime.test.ts`:

```ts
// Firmware spec 5.2 and 5.3 against real Pyodide (node_modules/pyodide), on a test clock: every wait
// is ours (sleep advances run time), timers and callbacks run at yield points and never inside a
// callback, exceptions in callbacks are printed and the script goes on (ruling R10), tracebacks list
// only the user's frames (R11), input() waits for a line (R12), threads and unsupported modules fail
// with the spec's words, Stop is a KeyboardInterrupt that runs finally blocks.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

describe('the Python run-time (spec 5.2, 5.3)', () => {
  it('sleeps on the run clock and reads time from it', async () => {
    const r = await runScript('import time\nt0 = time.monotonic()\ntime.sleep(1.5)\nprint(round(time.monotonic() - t0, 2))\nprint(int(time.time()))\n')
    expect(r.status).toBe('done')
    expect(r.out).toBe('1.5\n1767225601\n')
  })
  it('runs timers at yield points, and never one callback inside another', async () => {
    const r = await runScript([
      'import time, _circuitoon as rt',
      "def a():\n    print('a start', round(rt.now(), 1))\n    time.sleep(1)\n    print('a end', round(rt.now(), 1))",
      "rt.call_later(0.1, a)\nrt.call_later(0.2, lambda: print('b', round(rt.now(), 1)))",
      'time.sleep(3)',
    ].join('\n'))
    expect(r.out).toBe('a start 0.1\na end 1.1\nb 1.1\n')
  })
  it('prints an exception in a callback and goes on (ruling R10)', async () => {
    const r = await runScript("import time, _circuitoon as rt\ndef bad():\n    raise ValueError('oops')\nrt.call_later(0.1, bad)\ntime.sleep(0.5)\nprint('still here')\n", { file: 'blink.py' })
    expect(r.status).toBe('done')
    expect(r.err).toContain('File "blink.py", line 3, in bad')
    expect(r.err).toContain('ValueError: oops')
    expect(r.out).toBe('still here\n')
  })
  it('lists only the user\'s frames in a traceback, and ends with status error (R11)', async () => {
    const r = await runScript("import time\ndef f():\n    time.sleep(0.1)\n    raise RuntimeError('boom')\n\nf()\n", { file: 'blink.py' })
    expect(r.status).toBe('error')
    expect(r.err).toContain('File "blink.py", line 6, in <module>')
    expect(r.err).toContain('File "blink.py", line 4, in f')
    expect(r.err).not.toContain('_circuitoon')
  })
  it('refuses threads and unsupported modules in the spec\'s words', async () => {
    const t = await runScript('import threading\nthreading.Thread(target=print).start()\n')
    expect(t.err).toContain("RuntimeError: Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()")
    const s = await runScript('import smbus\n')
    expect(s.err).toContain('ImportError: smbus needs I2C devices, coming in a later update')
    expect(s.status).toBe('error')
  })
  it('waits in input() for a line, with the prompt in the box (R12)', async () => {
    const r = await runScript("name = input('Name? ')\nprint('Hi', name)\n", { inputs: [{ atMs: 500, line: 'Ada' }] })
    expect(r.prompts).toEqual(['Name? '])
    expect(r.out).toBe('Hi Ada\n')
    expect(r.t).toBeGreaterThanOrEqual(500)
  })
  it('stops with KeyboardInterrupt, running finally blocks (spec 5.4)', async () => {
    const r = await runScript("import time\ntry:\n    time.sleep(10)\nfinally:\n    print('cleaned up')\n", { untilMs: 1000 })
    expect(r.status).toBe('stopped')
    expect(r.out).toBe('cleaned up\n')
  })
  it('reports a pending timer at yield points, for the never-pauses warning', async () => {
    const r = await runScript("import time, _circuitoon as rt\nrt.call_later(5, print)\ntime.sleep(0.1)\n")
    expect(r.yields.some((y) => y.pending)).toBe(true)
  })
  it('ends cleanly on sys.exit(0) and puts every pin back to unused', async () => {
    const r = await runScript('import sys\nsys.exit(0)\n')
    expect(r.status).toBe('done')
    expect(r.trace.filter((x) => x.mode === 0)).toHaveLength(28)
  })
  it('waits in signal.pause() as gpiozero examples do, until Stop', async () => {
    const r = await runScript("from signal import pause\nimport _circuitoon as rt\nrt.call_later(0.2, lambda: print('tick'))\npause()\n", { untilMs: 500 })
    expect([r.status, r.out]).toEqual(['stopped', 'tick\n'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/runtime.test.ts`
Expected: FAIL, `./pyHarness.testing.ts` cannot be found.

- [ ] **Step 3: The protocol**

`src/run/protocol.ts`:

```ts
// Messages between a code worker and its host (firmware spec 2.1, 5.3, 5.4, 7). The pin and input
// tables travel in shared memory, never in messages.
import type { BoardKind } from './boards.ts'

export type RunStatus = 'starting' | 'running' | 'done' | 'stopped' | 'error'
export interface StartMessage {
  type: 'start'
  sab: SharedArrayBuffer
  /** Our Python modules by path under the runtime root (ruling R22). */
  files: Record<string, string>
  source: string
  /** The script's file name in tracebacks (`blink.py`, or `main.py`). */
  file: string
  board: BoardKind
  /** Real time in the editor; virtual time under `circuitoon run` (spec 7). */
  mode: 'real' | 'virtual'
  py: { indexURL: string; lock: string }
}
export type ToCode = StartMessage
export type FromCode =
  /** Pyodide is loaded and the script starts now. */
  | { type: 'ready' }
  /** Serial output, batched (spec 5.3); `text` may hold several lines. */
  | { type: 'out'; stream: 'out' | 'err'; text: string }
  /** input() is waiting; the prompt labels the input box (ruling R12). */
  | { type: 'prompt'; text: string }
  /** Virtual time only (ruling R16): the board is at `nowMs` and waits until `untilMs` (Infinity: until woken). */
  | { type: 'block'; nowMs: number; untilMs: number }
  | { type: 'exit'; status: 'done' | 'stopped' | 'error' }
  /** Pyodide could not load. */
  | { type: 'fatal'; error: string }
```

- [ ] **Step 4: The bridge**

`src/run/bridge.ts`:

```ts
// circuitoon_hw (firmware spec 5.1, 5.2): the small JS module the Python stand-ins call, registered
// with pyodide.registerJsModule, and the clocks it runs on. It reads and writes the board's shared
// memory and blocks; the scheduler and the stand-ins are Python (src/run/py). Worker side: nothing
// Vite-specific (Node runs this file directly in its worker).
import type { BoardKind } from './boards.ts'
import { type BoardMemory, F, H, INPUT, MODE, type ModeCode, NPINS, readIn, readLocked, readOut, setOut, takeLine, writeLocked } from './memory.ts'

/** Run time for one board. */
export interface RunClock {
  /** Run time in ms since the start. In virtual time every call is a 10 us step (spec 7). */
  now(): number
  /** Epoch ms of run time 0 (time.time()). */
  readonly epochMs: number
  /** Blocks until run time `untilMs` (Infinity: until woken), a wake, or (real time) 50 ms; then checks for Stop. */
  block(untilMs: number): void
  /** Every pin read: in virtual time, syncs with the driver once past its horizon (ruling R16). */
  poll(): void
}

const nowAbs = () => performance.timeOrigin + performance.now()

/** The editor's clock (spec 5.2): Atomics.wait on the wake word for at most 50 ms at a time, then checkInterrupt. */
export function realClock(m: BoardMemory, checkInterrupt: () => void): RunClock {
  const start = m.f64[F.startMs]
  return {
    epochMs: start,
    now: () => nowAbs() - start,
    block(untilMs) {
      const seen = Atomics.load(m.i32, H.wake)
      const left = untilMs - (nowAbs() - start)
      if (left > 0) Atomics.wait(m.i32, H.wake, seen, Math.min(50, left))
      checkInterrupt()
    },
    poll() {},
  }
}

/**
 * A clock for in-process tests (pyHarness.testing.ts): no other thread exists, so block() jumps
 * straight to its time; `onStep` runs on every step (scheduled inputs, instant solves); past
 * `limitMs` it calls `stop` (a KeyboardInterrupt), so a script that waits forever ends.
 */
export function testClock(o: { onStep: (tMs: number) => void; limitMs: number; stop: () => void }): RunClock & { t: number } {
  const c = {
    t: 0,
    epochMs: Date.UTC(2026, 0, 1),
    now() {
      c.t += 0.01
      o.onStep(c.t)
      return c.t
    },
    block(untilMs: number) {
      c.t = Math.max(c.t, Math.min(untilMs, c.t + 50))
      o.onStep(c.t)
      if (c.t >= o.limitMs) o.stop()
    },
    poll() {},
  }
  return c
}

/** The JS functions Python's stand-ins call (spec 5.1). Pins are BCM numbers 0..27. */
export function makeHw(m: BoardMemory, clock: RunClock, o: { board: BoardKind; onPrompt: (text: string) => void; flush: () => void }) {
  const pin = (bcm: number) => {
    if (!(Number.isInteger(bcm) && bcm >= 0 && bcm < NPINS)) throw new RangeError(`there is no GPIO${bcm}`)
  }
  const nowUs = () => Math.round(clock.now() * 1000) >>> 0
  return {
    /** A mode or pull change (spec 2.2): bumps the code sequence; leaving output drops the latch and the PWM descriptor. */
    setup(bcm: number, mode: number) {
      pin(bcm)
      writeLocked(m, H.outSeq, () => setOut(m, bcm, { mode: mode as ModeCode, ...(mode !== MODE.output ? { latch: 0, pwmActive: false } : {}) }))
      Atomics.add(m.i32, H.codeSeq, 1)
    },
    /** A plain write: the latch, and the bit-bang counters (edges, high time) the sampler reads. */
    output(bcm: number, value: number) {
      pin(bcm)
      const v = value ? 1 : 0
      const t = nowUs()
      writeLocked(m, H.outSeq, () => {
        const was = readOut(m, bcm)
        if (was.latch === v) return
        setOut(m, bcm, v ? { latch: 1, changedUs: t, rising: was.rising + 1 } : { latch: 0, changedUs: t, falling: was.falling + 1, highUs: was.highUs + ((t - was.changedUs) >>> 0) })
      })
    },
    /**
     * A pin read (spec 4.4): an output reads its own latch; an input waits (at most 200 ms of run
     * time) for a result solved through the latest mode change, then reads the editor's level, or its
     * pull level before any result.
     */
    read(bcm: number): number {
      pin(bcm)
      clock.poll()
      const own = readLocked(m, H.outSeq, () => readOut(m, bcm))
      if (own.mode === MODE.output) return own.latch
      const want = Atomics.load(m.i32, H.codeSeq)
      const t0 = clock.now()
      while (Atomics.load(m.i32, H.solvedThrough) < want && clock.now() - t0 < 200) clock.block(t0 + 200)
      const r = readLocked(m, H.inSeq, () => readIn(m, bcm))
      if (r.status !== 'none') return r.level
      return own.mode === MODE.pullup ? 1 : 0
    },
    /** The declared PWM descriptor (spec 2.2): nothing toggles the pin. */
    pwm(bcm: number, active: boolean, duty: number, freq: number) {
      pin(bcm)
      writeLocked(m, H.outSeq, () => setOut(m, bcm, { pwmActive: !!active, duty: Math.min(1, Math.max(0, duty)), freq }))
    },
    rising: (bcm: number) => readLocked(m, H.inSeq, () => readIn(m, bcm).rising),
    falling: (bcm: number) => readLocked(m, H.inSeq, () => readIn(m, bcm).falling),
    volts(bcm: number): number | null {
      const r = readLocked(m, H.inSeq, () => readIn(m, bcm))
      return r.status === 'value' ? r.volts : null
    },
    monotonic: () => clock.now() / 1000,
    epoch: () => (clock.epochMs + clock.now()) / 1000,
    /** Python's scheduler: wait until run time `untilS` seconds (negative: until woken). */
    block(untilS: number) {
      clock.block(untilS < 0 ? Infinity : untilS * 1000)
    },
    /** A yield point: real time of the last one (the never-pauses check), whether timers or callbacks wait, and an output flush. */
    yielded(pending: boolean) {
      m.f64[F.lastYieldMs] = nowAbs()
      Atomics.store(m.i32, H.pending, pending ? 1 : 0)
      o.flush()
    },
    /** A timer, callback or poller now waits (the never-pauses check reads it with the last yield). */
    pending(on: boolean) {
      Atomics.store(m.i32, H.pending, on ? 1 : 0)
    },
    input_begin(prompt: string) {
      Atomics.store(m.i32, H.inputState, INPUT.waiting)
      o.onPrompt(String(prompt))
    },
    input_ready: () => Atomics.load(m.i32, H.inputState) === INPUT.ready,
    input_take: () => takeLine(m),
    board: () => o.board,
  }
}
```

- [ ] **Step 5: The Python run-time**

`src/run/py/_circuitoon.py`:

```python
"""Circuitoon's run-time for scripts on a simulated Raspberry Pi (firmware spec 5.2).

One scheduler for every wait (time.sleep, input, gpiozero's pause and wait_for_*, RPi.GPIO's
wait_for_edge and the waits inside our modules): due timers and queued callbacks run at yield points
(the waits and every pin read), never inside a callback, so it is not re-entrant. Time comes from the
run's clock. JS only blocks (circuitoon_hw.block) and reports what woke it.
"""
import builtins
import heapq
import linecache
import sys
import threading
import time
import traceback

import circuitoon_hw as hw

# Modules that need devices or libraries the simulator does not have (spec 5.1). The gate scans
# scripts for the same names: src/run/unsupported.ts reads this dict (one entry per line).
UNSUPPORTED = {
    'smbus': 'smbus needs I2C devices, coming in a later update',
    'smbus2': 'smbus2 needs I2C devices, coming in a later update',
    'spidev': 'spidev needs SPI devices, coming in a later update',
    'serial': 'serial (pyserial) needs a serial port, coming in a later update',
    'pigpio': 'pigpio is not simulated; use gpiozero or RPi.GPIO',
    'lgpio': 'lgpio is not simulated; use gpiozero or RPi.GPIO',
    'picamera2': 'picamera2 needs a camera, which is not simulated',
}
THREADS = "Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()"
NPINS = 28
# The 40-pin header: BOARD pin number to BCM GPIO number (RPi.GPIO and gpiozero both read it).
BOARD_TO_BCM = {3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24, 19: 10,
                21: 9, 22: 25, 23: 11, 24: 8, 26: 7, 27: 0, 28: 1, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19,
                36: 16, 37: 26, 38: 20, 40: 21}

_timers = []
_queue = []
_pollers = []
_seq = 0
_in_callback = False
_file = 'main.py'


class Timer:
    """A scheduled call; cancel() stops it; `period` repeats it."""
    __slots__ = ('due', 'seq', 'fn', 'period', 'alive')

    def __init__(self, due, fn, period):
        global _seq
        _seq += 1
        self.due, self.seq, self.fn, self.period, self.alive = due, _seq, fn, period, True

    def __lt__(self, other):
        return (self.due, self.seq) < (other.due, other.seq)

    def cancel(self):
        self.alive = False


def reset():
    """Forgets every timer, queued callback and poller."""
    global _in_callback
    _timers.clear()
    _queue.clear()
    _pollers.clear()
    _in_callback = False


def now():
    """Seconds of run time."""
    return hw.monotonic()


def call_later(delay, fn, period=None):
    timer = Timer(now() + max(0.0, delay), fn, period)
    heapq.heappush(_timers, timer)
    hw.pending(True)
    return timer


def queue(fn):
    """Runs fn at the next yield point, outside any callback."""
    _queue.append(fn)
    hw.pending(True)


def add_poller(fn):
    if fn not in _pollers:
        _pollers.append(fn)
    hw.pending(True)


def remove_poller(fn):
    if fn in _pollers:
        _pollers.remove(fn)


def format_error(e):
    """A traceback listing only the user's own frames (plan ruling R11)."""
    te = traceback.TracebackException.from_exception(e)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == _file])
    return ''.join(te.format())


def _run(fn):
    global _in_callback
    _in_callback = True
    try:
        fn()
    except Exception as e:  # plan ruling R10: printed, and the script goes on
        sys.stderr.write(format_error(e))
    finally:
        _in_callback = False


def dispatch():
    """Polls for edges, then runs queued callbacks and the timers due now. Inside a callback it does nothing."""
    if _in_callback:
        return
    for poll in list(_pollers):
        poll()
    while _queue:
        _run(_queue.pop(0))
    t = now()
    due = []
    while _timers and (not _timers[0].alive or _timers[0].due <= t):
        timer = heapq.heappop(_timers)
        if timer.alive:
            due.append(timer)
    for timer in due:
        if timer.period is not None:
            # Behind schedule: the next run is now, never a burst of catch-up runs.
            timer.due = max(timer.due + timer.period, t)
            heapq.heappush(_timers, timer)
        if timer.alive:
            _run(timer.fn)
        while _queue:
            _run(_queue.pop(0))


def _pending():
    return bool(_queue or _pollers or any(timer.alive for timer in _timers))


def yield_point():
    """A yield point (every pin read and every wait): timers and callbacks may run here."""
    dispatch()
    hw.yielded(_pending())


def wait(seconds=None, until=None):
    """The one blocking primitive (spec 5.2): runs timers and callbacks until until() is true
    (returns True) or `seconds` have passed (returns False). None waits forever. Inside a callback it
    only waits."""
    end = None if seconds is None else now() + max(0.0, seconds)
    while True:
        yield_point()
        if until is not None and until():
            return True
        t = now()
        if end is not None and t >= end:
            return False
        nxt = end
        if not _in_callback:
            while _timers and not _timers[0].alive:
                heapq.heappop(_timers)
            if _timers and (nxt is None or _timers[0].due < nxt):
                nxt = _timers[0].due
        hw.block(-1.0 if nxt is None else nxt)


def _sleep(seconds):
    if seconds < 0:
        raise ValueError('sleep length must be non-negative')
    wait(seconds)


def _input(prompt=''):
    """input() (spec 5.3, plan ruling R12): the prompt labels the input box; callbacks run while it waits."""
    hw.input_begin(str(prompt))
    wait(until=hw.input_ready)
    return hw.input_take()


def _no_threads(*args, **kwargs):
    raise RuntimeError(THREADS)


class _Unsupported:
    """Refuses modules the simulator does not have, in plain words (spec 5.1)."""

    def find_spec(self, name, path=None, target=None):
        root = name.split('.')[0]
        if root in UNSUPPORTED:
            raise ImportError(UNSUPPORTED[root], name=name)
        return None


def install():
    """Points time, input, signal.pause and threads at the scheduler, and refuses unsupported modules."""
    import _thread
    import signal
    # gpiozero's own examples end with `from signal import pause; pause()`.
    signal.pause = lambda: wait()
    time.sleep = _sleep
    time.time = hw.epoch
    time.monotonic = hw.monotonic
    time.perf_counter = hw.monotonic
    time.time_ns = lambda: int(hw.epoch() * 1e9)
    time.monotonic_ns = lambda: int(hw.monotonic() * 1e9)
    time.perf_counter_ns = time.monotonic_ns
    builtins.input = _input
    threading.Thread.start = _no_threads
    _thread.start_new_thread = _no_threads
    sys.meta_path[:] = [f for f in sys.meta_path if type(f).__name__ != '_Unsupported']
    sys.meta_path.insert(0, _Unsupported())


def shutdown():
    """The end of a run: no timers left, every pin back to unused, so the saved states apply again."""
    reset()
    for bcm in range(NPINS):
        hw.setup(bcm, 0)


def main(source, filename):
    """Runs the user's script. Returns 'done', 'stopped' (Stop: KeyboardInterrupt) or 'error'."""
    global _file
    _file = filename
    reset()
    install()
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    g = {'__name__': '__main__', '__file__': filename, '__builtins__': builtins}
    status = 'done'
    try:
        exec(compile(source, filename, 'exec'), g)
    except KeyboardInterrupt:
        status = 'stopped'
    except SystemExit as e:
        if e.code not in (None, 0):
            status = 'error'
            if not isinstance(e.code, int):
                sys.stderr.write(f'{e.code}\n')
    except BaseException as e:
        sys.stderr.write(format_error(e))
        status = 'error'
    finally:
        shutdown()
    return status
```

Create empty stand-in packages so the file list is complete (Tasks 14 to 16 fill them): `src/run/py/RPi/__init__.py` holding the line `"""RPi: Circuitoon's stand-in package (see GPIO.py)."""`, `src/run/py/RPi/GPIO.py` and `src/run/py/gpiozero/__init__.py` each holding a one-line docstring `"""Filled in by plan Tasks 14 to 16."""`.

- [ ] **Step 6: The Python files, the shared worker helpers and the harness**

`src/run/pyFiles.ts`:

```ts
// The Python stand-ins as text (plan ruling R22): the host imports them (Vite bundles them into the
// site's run chunk and the CLI) and posts them to the worker, which writes them into Pyodide.
const raw = import.meta.glob('./py/**/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const PY_FILES: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.slice('./py/'.length), v]))
```

`src/run/worker/serve.ts` (this task: the helpers; Task 17 adds `serveCode` below them):

```ts
// The code worker's Python side, shared by both workers and the in-process test harness: our files
// into Pyodide's file system, a fresh interpreter state per run, and running the script through
// _circuitoon.main. Worker side: nothing Vite-specific.

/** What we use of Pyodide's API. */
export interface PyodideLike {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void }
  runPython(code: string, o?: { globals?: unknown }): unknown
  registerJsModule(name: string, module: object): void
  setStdout(o: { batched: (line: string) => void }): void
  setStderr(o: { batched: (line: string) => void }): void
  setStdin(o: { stdin: () => string | null }): void
  setInterruptBuffer(buffer: Int32Array): void
  checkInterrupt(): void
  toPy(o: unknown): unknown
}

export const PY_ROOT = '/lib/circuitoon'

export function installFiles(py: PyodideLike, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = `${PY_ROOT}/${path}`
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    py.FS.writeFile(full, text)
  }
  py.runPython(`import sys\nif '${PY_ROOT}' not in sys.path: sys.path.insert(0, '${PY_ROOT}')`)
}

/** Forgets our modules and the user's, so the next run starts fresh (the harness; a worker runs once). */
export function resetModules(py: PyodideLike): void {
  py.runPython(
    "import sys\nfor k in [k for k in sys.modules if k.split('.')[0] in ('_circuitoon', 'circuitoon_hw', 'RPi', 'gpiozero')]: del sys.modules[k]",
  )
}

export function runMain(py: PyodideLike, source: string, file: string): 'done' | 'stopped' | 'error' {
  const g = py.toPy({ SRC: source, FILE: file })
  return py.runPython('import _circuitoon\n_circuitoon.main(SRC, FILE)', { globals: g }) as 'done' | 'stopped' | 'error'
}
```

`src/run/pyHarness.testing.ts`:

```ts
// Runs a script on the real Python stand-ins in-process (Pyodide from node_modules), on a test clock,
// with inputs scheduled by run time: what the stand-in tests use (firmware spec 10). One Pyodide per
// test file; each run gets a fresh board memory and fresh modules. Solves are instant: every step
// marks the board solved through its latest code sequence.
import { loadPyodide } from 'pyodide'
import type { BoardKind } from './boards.ts'
import { makeHw, testClock } from './bridge.ts'
import { H, INPUT, MODE, type PinIn, boardMemory, readOut, writeIn, writeLine } from './memory.ts'
import { PY_FILES } from './pyFiles.ts'
import { type PyodideLike, installFiles, resetModules, runMain } from './worker/serve.ts'

export type ScriptInput = { atMs: number; bcm: number; level: 0 | 1 } | { atMs: number; line: string }
export interface Trace { t: number; bcm: number; mode?: number; latch?: 0 | 1; pwm?: { active: boolean; duty: number; freq: number } }
export interface RunResult { status: string; out: string; err: string; trace: Trace[]; prompts: string[]; yields: { t: number; pending: boolean }[]; t: number }

let pyodide: Promise<PyodideLike> | null = null
const interruptBuffer = new Int32Array(new SharedArrayBuffer(4))
function py(): Promise<PyodideLike> {
  pyodide ??= (loadPyodide() as unknown as Promise<PyodideLike>).then((p) => {
    installFiles(p, PY_FILES)
    p.setInterruptBuffer(interruptBuffer)
    return p
  })
  return pyodide
}

export async function runScript(source: string, o: { inputs?: ScriptInput[]; untilMs?: number; board?: BoardKind; file?: string } = {}): Promise<RunResult> {
  const p = await py()
  resetModules(p)
  const m = boardMemory()
  const res: RunResult = { status: '', out: '', err: '', trace: [], prompts: [], yields: [], t: 0 }
  const events = [...(o.inputs ?? [])].sort((a, b) => a.atMs - b.atMs)
  const levels = new Map<number, PinIn>()
  const onStep = (t: number) => {
    // Instant solves: whatever the code set up has been solved.
    Atomics.store(m.i32, H.solvedThrough, Atomics.load(m.i32, H.codeSeq))
    while (events.length && events[0].atMs <= t) {
      const e = events[0]
      if ('line' in e) {
        if (Atomics.load(m.i32, H.inputState) !== INPUT.waiting) break
        events.shift()
        writeLine(m, e.line)
        continue
      }
      events.shift()
      // Like LevelTracker's first result: a pulled-up pin starts high and the first scripted level is an edge only if it differs.
      const was = levels.get(e.bcm) ?? { level: readOut(m, e.bcm).mode === MODE.pullup ? 1 : 0, rising: 0, falling: 0, status: 'value', volts: 0 }
      const row: PinIn = { level: e.level, status: 'value', volts: e.level ? 3.3 : 0, rising: was.rising + (e.level && !was.level ? 1 : 0), falling: was.falling + (!e.level && was.level ? 1 : 0) }
      levels.set(e.bcm, row)
      writeIn(m, Array.from({ length: e.bcm + 1 }, (_, b) => (b === e.bcm ? row : null)), Atomics.load(m.i32, H.codeSeq))
    }
  }
  interruptBuffer[0] = 0
  const clock = testClock({ onStep, limitMs: o.untilMs ?? 60_000, stop: () => { interruptBuffer[0] = 2; p.checkInterrupt() } })
  const hw = makeHw(m, clock, { board: o.board ?? 'pi4', onPrompt: (text) => res.prompts.push(text), flush: () => {} })
  // Record what the code does to its pins, at the run time it does it.
  const traced = {
    ...hw,
    setup(bcm: number, mode: number) { hw.setup(bcm, mode); res.trace.push({ t: clock.t, bcm, mode }) },
    output(bcm: number, v: number) {
      const before = readOut(m, bcm).latch
      hw.output(bcm, v)
      if (readOut(m, bcm).latch !== before) res.trace.push({ t: clock.t, bcm, latch: readOut(m, bcm).latch })
    },
    pwm(bcm: number, active: boolean, duty: number, freq: number) { hw.pwm(bcm, active, duty, freq); res.trace.push({ t: clock.t, bcm, pwm: { active, duty: readOut(m, bcm).duty, freq } }) },
    yielded(pending: boolean) { hw.yielded(pending); res.yields.push({ t: clock.t, pending }) },
  }
  p.registerJsModule('circuitoon_hw', traced)
  p.setStdout({ batched: (s) => void (res.out += `${s}\n`) })
  p.setStderr({ batched: (s) => void (res.err += `${s}\n`) })
  res.status = runMain(p, source, o.file ?? 'main.py')
  res.t = clock.t
  return res
}
```

`loadPyodide()` with no options finds its own files in `node_modules/pyodide` in Node.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/run/runtime.test.ts`
Expected: PASS (10 tests). The first test proves the clock (2026-01-01 is 1767225600 s since the epoch; the script prints it 1.5 s later). If `loadPyodide()` cannot find its files under vitest, pass `{ indexURL: resolve('node_modules/pyodide') + sep }`.

- [ ] **Step 8: Commit**

```bash
git add src/run/bridge.ts src/run/protocol.ts src/run/pyFiles.ts src/run/py src/run/worker/serve.ts src/run/pyHarness.testing.ts src/run/runtime.test.ts
git commit -m "$(cat <<'MSG'
Run: circuitoon_hw bridge and the Python scheduler (waits, timers, callbacks, input, threads, unsupported modules)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 14: The `RPi.GPIO` stand-in

**Files:**
- Modify: `src/run/py/RPi/GPIO.py` (replace the placeholder docstring)
- Create: `src/run/rpiGpio.test.ts`

**Interfaces:**
- Consumes: `_circuitoon` (`yield_point`, `wait`, `queue`, `add_poller`, `remove_poller`, `now`), `circuitoon_hw` (Task 13); `runScript` (harness).
- Produces: the Python module `RPi.GPIO` with spec 5.1's calls: `setmode`, `getmode`, `setwarnings`, `setup` (`pull_up_down`, `initial`), `output`, `input`, `cleanup`, `gpio_function`, `PWM` (`start`, `ChangeDutyCycle`, `ChangeFrequency`, `stop`), `add_event_detect`, `remove_event_detect`, `event_detected`, `add_event_callback`, `wait_for_edge`, `RPI_INFO`, the RPi.GPIO 0.7 constants, and the Pi 5 import warning.

- [ ] **Step 1: Write the failing test**

`src/run/rpiGpio.test.ts`:

```ts
// Firmware spec 5.1: RPi.GPIO's calls on the simulated board, against real Pyodide. BCM and BOARD
// numbering (the 40-pin map), pulls, outputs that read their latch, edge detection from the editor's
// edge counters (callbacks at yield points), wait_for_edge, PWM as a declared descriptor, the
// messages RPi.GPIO 0.7 gives, and the Pi 5 warning.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nimport RPi.GPIO as GPIO\n'

describe('RPi.GPIO (spec 5.1)', () => {
  it('drives an output in BCM numbering and reads its own latch', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.output(17, GPIO.HIGH)\nprint(GPIO.input(17))\ntime.sleep(1)\nGPIO.output(17, 0)\nprint(GPIO.input(17))\n`)
    expect(r.out).toBe('1\n0\n')
    expect(r.trace.filter((x) => x.bcm === 17 && x.latch !== undefined).map((x) => [Math.round(x.t / 100) / 10, x.latch])).toEqual([[0, 1], [1, 0]])
  })
  it('maps BOARD pin numbers to BCM through the 40-pin header', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BOARD)\nGPIO.setup([11, 13, 40], GPIO.OUT, initial=GPIO.HIGH)\n`)
    expect(r.trace.filter((x) => x.latch === 1).map((x) => x.bcm)).toEqual([17, 27, 21])
  })
  it('reads a pulled input at its pull before any result, and the editor\'s level after', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nGPIO.setup(22, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)\nprint(GPIO.input(27), GPIO.input(22))\ntime.sleep(1)\nprint(GPIO.input(27))\n`, { inputs: [{ atMs: 500, bcm: 27, level: 0 }] })
    expect(r.out).toBe('1 0\n0\n')
  })
  it('gives RPi.GPIO 0.7\'s errors', async () => {
    const err = async (body: string) => (await runScript(head + body)).err.trim().split('\n').pop()
    expect(await err('GPIO.setup(17, GPIO.OUT)')).toBe('RuntimeError: Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.output(17, 1)')).toBe('RuntimeError: The GPIO channel has not been set up as an OUTPUT')
    expect(await err('GPIO.setmode(GPIO.BOARD)\nGPIO.setup(2, GPIO.OUT)')).toBe('ValueError: The channel sent is invalid on a Raspberry Pi')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setmode(GPIO.BOARD)')).toBe('ValueError: A different mode has already been set!')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setup(0, GPIO.OUT)')).toBe('ValueError: GPIO0 is reserved for the HAT ID EEPROM and is not simulated')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT, pull_up_down=GPIO.PUD_UP)')).toBe('ValueError: pull_up_down parameter is not valid for outputs')
  })
  it('warns when a channel is set up twice, pointing at the user\'s line', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.setup(17, GPIO.OUT)\n`, { file: 'blink.py' })
    expect(r.err).toContain('blink.py:5: RuntimeWarning: This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.')
    expect((await runScript(`${head}GPIO.setwarnings(False)\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.setup(17, GPIO.OUT)\n`)).err).toBe('')
  })
  it('calls an edge callback at a yield point with the channel in the script\'s numbering', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BOARD)\nGPIO.setup(13, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nGPIO.add_event_detect(13, GPIO.FALLING, callback=lambda ch: print('pressed', ch, round(time.monotonic(), 1)))\ntime.sleep(2)\n`, { inputs: [{ atMs: 500, bcm: 27, level: 0 }, { atMs: 700, bcm: 27, level: 1 }] })
    expect(r.out).toBe('pressed 13 0.5\n')
  })
  it('remembers event_detected once, and honours bouncetime', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN)\nGPIO.add_event_detect(27, GPIO.RISING, bouncetime=200)\nGPIO.add_event_callback(27, lambda ch: print('edge', round(time.monotonic(), 1)))\ntime.sleep(1)\nprint(GPIO.event_detected(27), GPIO.event_detected(27))\n`, {
      inputs: [{ atMs: 100, bcm: 27, level: 1 }, { atMs: 150, bcm: 27, level: 0 }, { atMs: 200, bcm: 27, level: 1 }, { atMs: 600, bcm: 27, level: 0 }, { atMs: 680, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('edge 0.1\nedge 0.7\nTrue False\n')
  })
  it('waits for an edge, or times out with None', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nprint(GPIO.wait_for_edge(27, GPIO.FALLING, timeout=2000), round(time.monotonic(), 1))\nprint(GPIO.wait_for_edge(27, GPIO.FALLING, timeout=300))\n`, { inputs: [{ atMs: 400, bcm: 27, level: 0 }] })
    expect(r.out).toBe('27 0.4\nNone\n')
  })
  it('declares PWM (duty and frequency) without toggling the pin', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(18, GPIO.OUT)\np = GPIO.PWM(18, 50)\np.start(7.5)\np.ChangeDutyCycle(10)\np.ChangeFrequency(100)\np.stop()\n`)
    expect(r.trace.filter((x) => x.pwm).map((x) => x.pwm)).toEqual([
      { active: true, duty: 0.075, freq: 50 }, { active: true, duty: 0.1, freq: 50 }, { active: true, duty: 0.1, freq: 100 }, { active: false, duty: 0.1, freq: 100 },
    ])
    expect(r.trace.some((x) => x.bcm === 18 && x.latch !== undefined)).toBe(false)
    expect((await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(18, GPIO.OUT)\nGPIO.PWM(18, 50).start(120)\n`)).err).toContain('ValueError: dutycycle must have a value from 0.0 to 100.0')
  })
  it('cleans up to unused, and reports the board and its warning', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nprint(GPIO.gpio_function(17) == GPIO.OUT)\nGPIO.cleanup()\nprint(GPIO.getmode(), GPIO.RPI_INFO['PROCESSOR'])\n`)
    expect(r.out).toBe('True\nNone BCM2711\n')
    expect(r.trace.filter((x) => x.bcm === 17 && x.mode !== undefined).map((x) => x.mode).slice(0, 2)).toEqual([4, 0])
    const five = await runScript('import RPi.GPIO as GPIO\n', { board: 'pi5' })
    expect(five.err).toBe('RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio\n')
    expect((await runScript('import RPi.GPIO as GPIO\n')).err).toBe('')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/rpiGpio.test.ts`
Expected: FAIL: `module 'RPi.GPIO' has no attribute 'setmode'`.

- [ ] **Step 3: Write `src/run/py/RPi/GPIO.py`**

```python
"""RPi.GPIO for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

The RPi.GPIO 0.7 calls on the board's simulated pins: outputs read their own latch, inputs read the
level the simulation solved, edges come from the editor's edge counters and their callbacks run at
yield points (Circuitoon's scheduler, not a thread). PWM declares its duty and frequency; nothing
toggles the pin to fake it.
"""
import sys
import warnings

import _circuitoon as _rt
import circuitoon_hw as _hw

VERSION = '0.7.1'
RPI_REVISION = 3
BOARD = 10
BCM = 11
OUT = 0
IN = 1
LOW = 0
HIGH = 1
PUD_OFF = 20
PUD_DOWN = 21
PUD_UP = 22
RISING = 31
FALLING = 32
BOTH = 33
UNKNOWN = -1
SERIAL = 40
SPI = 41
I2C = 42
HARD_PWM = 43

_INFO = {
    'pi4': {'TYPE': 'Pi 4 Model B', 'PROCESSOR': 'BCM2711'},
    'pi5': {'TYPE': 'Pi 5', 'PROCESSOR': 'BCM2712'},
    'zero2w': {'TYPE': 'Zero 2 W', 'PROCESSOR': 'BCM2710A1'},
}
_board = _hw.board()
# Revision, maker and RAM depend on the unit, which the simulator does not know.
RPI_INFO = dict(P1_REVISION=3, REVISION='unknown', MANUFACTURER='unknown', RAM='unknown', **_INFO[_board])
if _board == 'pi5':
    sys.stderr.write('RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio\n')

from _circuitoon import BOARD_TO_BCM as _BOARD_TO_BCM
_PULL_MODE = {PUD_OFF: 1, PUD_UP: 2, PUD_DOWN: 3}
_mode = None
_warn = True
_dir = {}
_pwm = {}
_detect = {}


def _bcm(channel):
    if _mode is None:
        raise RuntimeError('Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
    if not isinstance(channel, int) or isinstance(channel, bool):
        raise ValueError('Channel must be an integer or list/tuple of integers')
    if _mode == BOARD:
        if channel not in _BOARD_TO_BCM:
            raise ValueError('The channel sent is invalid on a Raspberry Pi')
        bcm = _BOARD_TO_BCM[channel]
    else:
        bcm = channel
    if bcm in (0, 1):
        raise ValueError(f'GPIO{bcm} is reserved for the HAT ID EEPROM and is not simulated')
    if not 2 <= bcm <= 27:
        raise ValueError('The channel sent is invalid on a Raspberry Pi')
    return bcm


def _channels(channel):
    return list(channel) if isinstance(channel, (list, tuple)) else [channel]


def setmode(mode):
    global _mode
    if mode not in (BOARD, BCM):
        raise ValueError('An invalid mode was passed to setmode()')
    if _mode is not None and mode != _mode:
        raise ValueError('A different mode has already been set!')
    _mode = mode


def getmode():
    return _mode


def setwarnings(flag):
    global _warn
    _warn = bool(flag)


def setup(channel, direction, pull_up_down=PUD_OFF, initial=-1):
    if direction not in (IN, OUT):
        raise ValueError('An invalid direction was passed to setup()')
    if pull_up_down not in _PULL_MODE:
        raise ValueError('Invalid value for pull_up_down - should be either PUD_OFF, PUD_UP or PUD_DOWN')
    if direction == OUT and pull_up_down != PUD_OFF:
        raise ValueError('pull_up_down parameter is not valid for outputs')
    if direction == IN and initial != -1:
        raise ValueError('initial parameter is not valid for inputs')
    for ch in _channels(channel):
        bcm = _bcm(ch)
        if _warn and bcm in _dir:
            warnings.warn('This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.', RuntimeWarning, stacklevel=2)
        if direction == OUT:
            _hw.setup(bcm, 4)
            if initial != -1:
                _hw.output(bcm, 1 if initial else 0)
        else:
            _hw.setup(bcm, _PULL_MODE[pull_up_down])
        _dir[bcm] = direction


def output(channel, value):
    chans = _channels(channel)
    values = list(value) if isinstance(value, (list, tuple)) else [value] * len(chans)
    if len(values) != len(chans):
        raise RuntimeError('Number of channels != number of values')
    for ch, v in zip(chans, values):
        bcm = _bcm(ch)
        if _dir.get(bcm) != OUT:
            raise RuntimeError('The GPIO channel has not been set up as an OUTPUT')
        _hw.output(bcm, 1 if v else 0)


def input(channel):
    bcm = _bcm(channel)
    if bcm not in _dir:
        raise RuntimeError('You must setup() the GPIO channel first')
    _rt.yield_point()
    return _hw.read(bcm)


def cleanup(channel=None):
    global _mode
    chans = list(_dir) if channel is None else [_bcm(c) for c in _channels(channel)]
    for bcm in chans:
        if bcm in _detect:
            _detect.pop(bcm).close()
        if bcm in _pwm:
            _pwm[bcm].stop()
        _hw.setup(bcm, 0)
        _dir.pop(bcm, None)
    if channel is None:
        _mode = None


def gpio_function(channel):
    return _dir.get(_bcm(channel), IN)


def _counts(bcm):
    return _hw.rising(bcm) & 0xFFFFFFFF, _hw.falling(bcm) & 0xFFFFFFFF


class _Detect:
    """Edge detection on an input (spec 4.4): the editor's edge counters, polled at yield points."""

    def __init__(self, bcm, channel, edge, bouncetime):
        self.bcm, self.channel, self.edge = bcm, channel, edge
        self.bounce = (bouncetime or 0) / 1000.0
        self.callbacks = []
        self.flag = False
        self.seen = _counts(bcm)
        self.last = None

    def edges(self):
        r, f = _counts(self.bcm)
        n = 0
        if self.edge in (RISING, BOTH):
            n += (r - self.seen[0]) & 0xFFFFFFFF
        if self.edge in (FALLING, BOTH):
            n += (f - self.seen[1]) & 0xFFFFFFFF
        self.seen = (r, f)
        return n

    def poll(self):
        n = self.edges()
        if not n:
            return
        t = _rt.now()
        if self.bounce and self.last is not None and t - self.last < self.bounce:
            return
        self.last = t
        self.flag = True
        for _ in range(n):
            for cb in list(self.callbacks):
                _rt.queue(lambda cb=cb: cb(self.channel))

    def close(self):
        _rt.remove_poller(self.poll)


def add_event_detect(channel, edge, callback=None, bouncetime=None):
    bcm = _bcm(channel)
    if _dir.get(bcm) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if edge not in (RISING, FALLING, BOTH):
        raise ValueError('The edge must be set to RISING, FALLING or BOTH')
    if bcm in _detect:
        raise RuntimeError('Conflicting edge detection already enabled for this GPIO channel')
    d = _detect[bcm] = _Detect(bcm, channel, edge, bouncetime)
    if callback is not None:
        d.callbacks.append(callback)
    _rt.add_poller(d.poll)


def add_event_callback(channel, callback):
    bcm = _bcm(channel)
    if bcm not in _detect:
        raise RuntimeError('Add event detection using add_event_detect first before adding a callback')
    _detect[bcm].callbacks.append(callback)


def remove_event_detect(channel):
    bcm = _bcm(channel)
    if bcm in _detect:
        _detect.pop(bcm).close()


def event_detected(channel):
    d = _detect.get(_bcm(channel))
    if d is None:
        return False
    _rt.yield_point()
    hit, d.flag = d.flag, False
    return hit


def wait_for_edge(channel, edge, bouncetime=None, timeout=None):
    bcm = _bcm(channel)
    if _dir.get(bcm) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if bcm in _detect:
        raise RuntimeError('Conflicting edge detection events already exist for this GPIO channel')
    if edge not in (RISING, FALLING, BOTH):
        raise ValueError('The edge must be set to RISING, FALLING or BOTH')
    d = _Detect(bcm, channel, edge, bouncetime)
    got = _rt.wait(None if timeout is None else timeout / 1000.0, until=lambda: d.edges() > 0)
    return channel if got else None


class PWM:
    """Software PWM as RPi.GPIO 0.7 offers it; here it declares duty and frequency (spec 2.2)."""

    def __init__(self, channel, frequency):
        bcm = _bcm(channel)
        if _dir.get(bcm) != OUT:
            raise RuntimeError('You must setup() the GPIO channel as an output first')
        if bcm in _pwm:
            raise RuntimeError('A PWM object already exists for this GPIO channel')
        if frequency <= 0.0:
            raise ValueError('frequency must be greater than 0.0')
        self._bcm, self._freq, self._dc, self._running = bcm, float(frequency), 0.0, False
        _pwm[bcm] = self

    def _write(self):
        _hw.pwm(self._bcm, self._running, self._dc / 100.0, self._freq)

    @staticmethod
    def _check(dutycycle):
        if not 0.0 <= dutycycle <= 100.0:
            raise ValueError('dutycycle must have a value from 0.0 to 100.0')

    def start(self, dutycycle):
        self._check(dutycycle)
        self._dc, self._running = float(dutycycle), True
        self._write()

    def ChangeDutyCycle(self, dutycycle):
        self._check(dutycycle)
        self._dc = float(dutycycle)
        self._write()

    def ChangeFrequency(self, frequency):
        if frequency <= 0.0:
            raise ValueError('frequency must be greater than 0.0')
        self._freq = float(frequency)
        self._write()

    def stop(self):
        self._running = False
        self._write()
        _pwm.pop(self._bcm, None)
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/rpiGpio.test.ts src/run/runtime.test.ts`
Expected: PASS. If the setup-twice warning text differs only in how Python's `warnings` prints it (the line number), check `stacklevel=2` points at the user's call.

- [ ] **Step 5: Commit**

```bash
git add src/run/py/RPi/GPIO.py src/run/rpiGpio.test.ts
git commit -m "$(cat <<'MSG'
Run: the RPi.GPIO stand-in (BCM and BOARD, pulls, edge detection, wait_for_edge, declared PWM, Pi 5 warning)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 15: The `gpiozero` stand-in: pins, digital outputs and inputs

**Files:**
- Modify: `src/run/py/gpiozero/__init__.py` (replace the placeholder docstring)
- Create: `src/run/gpiozero.test.ts`

**Interfaces:**
- Consumes: Task 13's `_circuitoon` and `circuitoon_hw`; `runScript`.
- Produces (Python `gpiozero`): `GPIOZeroError`, `DeviceClosed`, `GPIOPinInUse`, `PinInvalidPin`, `PinInvalidState`, `OutputDeviceBadValue`; `Device`, `OutputDevice`, `DigitalOutputDevice`, `LED`, `Buzzer` (a digital device, as in gpiozero and spec revision 5: it never declares PWM), `InputDevice`, `DigitalInputDevice`, `Button`, `LineSensor`, `MotionSensor`, `pause`; the private helpers `_bcm_of(spec)`, `_Sequence`, `_fade_steps` (Task 16 uses them); `UNSUPPORTED_NAMES` (read by Task 40's gate scan); module `__getattr__` for names not simulated.

- [ ] **Step 1: Check the gpiozero aliases this task copies**

Open gpiozero 2.0.1's `gpiozero/input_devices.py` (https://github.com/gpiozero/gpiozero/blob/v2.0.1/gpiozero/input_devices.py) and confirm, for `LineSensor`: `line_detected` is `not is_active`, `when_line` is `when_deactivated`, `when_no_line` is `when_activated`, `wait_for_line` is `wait_for_inactive`, `wait_for_no_line` is `wait_for_active`; for `MotionSensor`: `motion_detected` is `is_active`, `when_motion` is `when_activated`, `when_no_motion` is `when_deactivated`; for `Button`: `pull_up=True` default, `hold_time=1`, `hold_repeat=False`; for `DigitalInputDevice`: `pull_up=False` default. If any differs, follow gpiozero and change the test to match it; record the difference in the ledger.

- [ ] **Step 2: Write the failing test**

`src/run/gpiozero.test.ts`:

```ts
// Firmware spec 5.1 and 4.4: gpiozero's digital devices on the simulated board, against real Pyodide.
// Pin names as gpiozero takes them, outputs that read their own latch (toggle, is_lit, value),
// blink from timers, Button that does not fire at start, press, release and hold callbacks at yield
// points, waits, and the errors for pins in use and names not simulated.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nfrom gpiozero import *\n'
const latches = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => r.trace.filter((x) => x.bcm === bcm && x.latch !== undefined).map((x) => [Math.round(x.t / 100) / 10, x.latch])

describe('gpiozero digital devices (spec 5.1)', () => {
  it('drives an LED and reads its own latch', async () => {
    const r = await runScript(`${head}led = LED(17)\nled.on()\nprint(led.is_lit)\nled.toggle()\nprint(led.is_lit, led.value)\n`)
    expect(r.out).toBe('True\nFalse 0\n')
    expect(latches(r, 17)).toEqual([[0, 1], [0, 0]])
  })
  it('blinks from timers: 1 s on, 1 s off', async () => {
    const r = await runScript(`${head}LED(17).blink(n=2, background=False)\n`)
    expect(latches(r, 17)).toEqual([[0, 1], [1, 0], [2, 1], [3, 0]])
  })
  it('takes every pin name gpiozero does, and refuses bad ones and pins in use', async () => {
    const r = await runScript(`${head}for spec in ['GPIO5', 'BCM6', 'BOARD13', 'J8:15', '16', 20]:\n    print(LED(spec).pin)\n`)
    expect(r.out).toBe('GPIO5\nGPIO6\nGPIO27\nGPIO22\nGPIO16\nGPIO20\n')
    const last = async (body: string) => (await runScript(head + body)).err.trim().split('\n').pop()
    expect(await last('LED(17)\nLED(17)')).toMatch(/^gpiozero\.GPIOPinInUse: pin GPIO17 is already in use by <gpiozero\.LED object on pin GPIO17/)
    expect(await last("LED('GPIO99')")).toBe("gpiozero.PinInvalidPin: 'GPIO99' is not a valid pin on a Raspberry Pi header")
    expect(await last('LED(1)')).toBe('gpiozero.PinInvalidPin: GPIO1 is reserved for the HAT ID EEPROM and is not simulated')
  })
  it('inverts an active-low output', async () => {
    const r = await runScript(`${head}d = DigitalOutputDevice(18, active_high=False)\nd.on()\nprint(d.value, d.is_active)\n`)
    expect(latches(r, 18)).toEqual([[0, 1], [0, 0]])
    expect(r.out).toBe('1 True\n')
  })
  it('does not fire a Button at start', async () => {
    const r = await runScript(`${head}b = Button(27)\nb.when_pressed = lambda: print('pressed')\nprint(b.is_pressed)\npause()\n`, { untilMs: 1000 })
    expect(r.out).toBe('False\n')
    expect(r.status).toBe('stopped')
  })
  it('calls when_pressed and when_released at yield points, and passes the device to a one-argument callback', async () => {
    const r = await runScript(`${head}b = Button(27)\nb.when_pressed = lambda d: print('pressed', d.pin, round(time.monotonic(), 1))\nb.when_released = lambda: print('released', round(time.monotonic(), 1))\ntime.sleep(2)\n`, {
      inputs: [{ atMs: 500, bcm: 27, level: 0 }, { atMs: 800, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('pressed GPIO27 0.5\nreleased 0.8\n')
  })
  it('calls when_held after hold_time while still pressed, once without hold_repeat', async () => {
    const r = await runScript(`${head}b = Button(27, hold_time=1)\nb.when_held = lambda: print('held', round(time.monotonic(), 1))\ntime.sleep(3)\n`, {
      inputs: [{ atMs: 200, bcm: 27, level: 0 }, { atMs: 2500, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('held 1.2\n')
  })
  it('waits for a press, or times out', async () => {
    const r = await runScript(`${head}b = Button(27)\nprint(b.wait_for_press(timeout=2), round(time.monotonic(), 1))\nprint(b.wait_for_release(timeout=0.3))\n`, { inputs: [{ atMs: 300, bcm: 27, level: 0 }] })
    expect(r.out).toBe('True 0.3\nFalse\n')
  })
  it('keeps blink() paused while a callback sleeps (not re-entrant, spec 5.2)', async () => {
    const r = await runScript(`${head}led = LED(17)\nled.blink(on_time=0.5, off_time=0.5)\nb = Button(27)\nb.when_pressed = lambda: time.sleep(2)\ntime.sleep(4)\n`, { inputs: [{ atMs: 1100, bcm: 27, level: 0 }] })
    const during = latches(r, 17).filter(([t]) => t > 1.1 && t < 3.1)
    expect(during).toEqual([])
  })
  it('reads line and motion sensors as gpiozero names them', async () => {
    const r = await runScript(`${head}s = LineSensor(4)\nm = MotionSensor(5)\nm.when_motion = lambda: print('motion', round(time.monotonic(), 1))\nprint(s.line_detected, m.motion_detected)\ntime.sleep(1)\n`, { inputs: [{ atMs: 400, bcm: 5, level: 1 }] })
    expect(r.out).toBe('True False\nmotion 0.4\n')
  })
  it('names what is not simulated', async () => {
    const last = async (body: string) => (await runScript(body)).err.trim().split('\n').pop()
    expect(await last('from gpiozero import MCP3008')).toBe('NotImplementedError: gpiozero.MCP3008 needs SPI devices, coming in a later update')
    expect(await last('import gpiozero\ngpiozero.Robot')).toBe('NotImplementedError: gpiozero.Robot is not in the simulator yet')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/run/gpiozero.test.ts`
Expected: FAIL: `cannot import name 'LED' from 'gpiozero'`.

- [ ] **Step 4: Write `src/run/py/gpiozero/__init__.py`**

```python
"""gpiozero for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

A subset with gpiozero's names and signatures. Callbacks, blink and pulse run from Circuitoon's
scheduler (_circuitoon) at yield points: they are not threads, so a callback that sleeps holds
everything else until it returns (About the simulator says so). Input devices are not smoothed.
"""
import inspect

import _circuitoon as _rt
import circuitoon_hw as _hw

# `from gpiozero import *` takes exactly these (Task 16 adds the PWM devices).
__all__ = ['GPIOZeroError', 'DeviceClosed', 'GPIOPinInUse', 'PinInvalidPin', 'PinInvalidState', 'OutputDeviceBadValue',
           'Device', 'OutputDevice', 'DigitalOutputDevice', 'LED', 'Buzzer', 'InputDevice', 'DigitalInputDevice', 'Button',
           'LineSensor', 'MotionSensor', 'pause']

# Names gpiozero has that need devices not simulated yet (spec 5.1); one entry per line, read by
# src/run/unsupported.ts for the gate's static scan.
UNSUPPORTED_NAMES = {
    'MCP3001': 'needs SPI devices, coming in a later update',
    'MCP3002': 'needs SPI devices, coming in a later update',
    'MCP3004': 'needs SPI devices, coming in a later update',
    'MCP3008': 'needs SPI devices, coming in a later update',
    'MCP3201': 'needs SPI devices, coming in a later update',
    'MCP3202': 'needs SPI devices, coming in a later update',
    'MCP3204': 'needs SPI devices, coming in a later update',
    'MCP3208': 'needs SPI devices, coming in a later update',
    'MCP3301': 'needs SPI devices, coming in a later update',
    'MCP3302': 'needs SPI devices, coming in a later update',
    'MCP3304': 'needs SPI devices, coming in a later update',
}
_M32 = 0xFFFFFFFF
_FPS = 25
from _circuitoon import BOARD_TO_BCM as _BOARD_TO_BCM
_used = {}


def __getattr__(name):
    if name in UNSUPPORTED_NAMES:
        raise NotImplementedError(f'gpiozero.{name} {UNSUPPORTED_NAMES[name]}')
    if name.startswith('__'):
        raise AttributeError(name)
    raise NotImplementedError(f'gpiozero.{name} is not in the simulator yet')


class GPIOZeroError(Exception):
    pass


class DeviceClosed(GPIOZeroError):
    pass


class GPIOPinInUse(GPIOZeroError):
    pass


class PinInvalidPin(GPIOZeroError, ValueError):
    pass


class PinInvalidState(GPIOZeroError, ValueError):
    pass


class OutputDeviceBadValue(GPIOZeroError, ValueError):
    pass


def _bcm_of(spec):
    """A pin as gpiozero names it: 17, '17', 'GPIO17', 'BCM17', 'BOARD11' or 'J8:11'."""
    bcm = -1
    if isinstance(spec, int) and not isinstance(spec, bool):
        bcm = spec
    elif isinstance(spec, str):
        s = spec.strip().upper()
        for prefix, board in (('GPIO', False), ('BCM', False), ('BOARD', True), ('J8:', True), ('', False)):
            if s.startswith(prefix) and s[len(prefix):].isdigit():
                n = int(s[len(prefix):])
                bcm = _BOARD_TO_BCM.get(n, -1) if board else n
                break
    if bcm in (0, 1):
        raise PinInvalidPin(f'GPIO{bcm} is reserved for the HAT ID EEPROM and is not simulated')
    if not 2 <= bcm <= 27:
        raise PinInvalidPin(f'{spec!r} is not a valid pin on a Raspberry Pi header')
    return bcm


def _call(fn, device):
    """Calls a gpiozero callback: with the device when it takes one argument, else with none."""
    try:
        params = [p for p in inspect.signature(fn).parameters.values() if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    except (TypeError, ValueError):
        params = []
    if params:
        fn(device)
    else:
        fn()


class _Pin:
    def __init__(self, bcm):
        self.number = bcm

    def __repr__(self):
        return f'GPIO{self.number}'

    __str__ = __repr__


class Device:
    """A device on one or more pins; close() frees them (back to unused)."""

    def __init__(self, *pins, pin_factory=None):
        bcms = [_bcm_of(p) for p in pins]
        for b in bcms:
            if b in _used:
                raise GPIOPinInUse(f'pin GPIO{b} is already in use by {_used[b]!r}')
        self._pins = bcms
        self._closed = False
        for b in bcms:
            _used[b] = self

    def _release(self):
        """Stops what the device runs on its own (timers, pollers)."""

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._release()
        for b in self._pins:
            _used.pop(b, None)
            _hw.setup(b, 0)

    @property
    def closed(self):
        return self._closed

    def _check(self):
        if self._closed:
            raise DeviceClosed(f'{type(self).__name__} is closed or uninitialized')

    @property
    def pin(self):
        return _Pin(self._pins[0]) if self._pins else None

    @property
    def is_active(self):
        return bool(self.value)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __repr__(self):
        where = f' on pin GPIO{self._pins[0]}' if len(self._pins) == 1 else ''
        return f'<gpiozero.{type(self).__name__} object{where}{", closed" if self._closed else ""}>'


class _Sequence:
    """Steps a device through (value, seconds) pairs, n times or forever, from timers (blink, pulse)."""

    def __init__(self, device, steps, n, after):
        self.device, self.steps, self.left, self.after = device, steps, n, after
        self.i = 0
        self.done = False
        self.timer = None
        if not any(secs > 0 for _, secs in steps):
            self._finish()
        else:
            self._step()

    def _finish(self):
        self.done = True
        self.device._write(self.after)

    def _step(self):
        while not self.done:
            if self.i == len(self.steps):
                self.i = 0
                if self.left is not None:
                    self.left -= 1
                    if self.left <= 0:
                        return self._finish()
            value, secs = self.steps[self.i]
            self.i += 1
            self.device._write(value)
            if secs > 0:
                self.timer = _rt.call_later(secs, self._step)
                return

    def cancel(self):
        self.done = True
        if self.timer is not None:
            self.timer.cancel()


def _mix(a, b, t):
    if isinstance(a, tuple):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def _fade_steps(on_time, off_time, fade_in, fade_out, lo, hi):
    """gpiozero's blink sequence: fade in at 25 steps a second, on, fade out, off."""
    steps = []
    if fade_in > 0:
        k = int(_FPS * fade_in)
        steps += [(_mix(lo, hi, i / k), 1 / _FPS) for i in range(k)]
    steps.append((hi, on_time))
    if fade_out > 0:
        k = int(_FPS * fade_out)
        steps += [(_mix(hi, lo, i / k), 1 / _FPS) for i in range(k)]
    steps.append((lo, off_time))
    return steps


class OutputDevice(Device):
    def __init__(self, pin=None, *, active_high=True, initial_value=False, pin_factory=None):
        super().__init__(pin)
        self._bcm = self._pins[0]
        self.active_high = active_high
        self._seq = None
        _hw.setup(self._bcm, 4)
        if initial_value is not None:
            self._write(1 if initial_value else 0)

    def _write(self, value):
        self._check()
        _hw.output(self._bcm, 1 if bool(value) == self.active_high else 0)

    def _stop_seq(self):
        if self._seq is not None:
            self._seq.cancel()
            self._seq = None

    def _release(self):
        self._stop_seq()

    def _run_seq(self, steps, n, background, after):
        self._stop_seq()
        seq = self._seq = _Sequence(self, steps, n, after)
        if not background:
            _rt.wait(until=lambda: seq.done)

    def on(self):
        self._stop_seq()
        self._write(1)

    def off(self):
        self._stop_seq()
        self._write(0)

    def toggle(self):
        self._stop_seq()
        self._write(0 if self.value else 1)

    @property
    def value(self):
        self._check()
        _rt.yield_point()
        return 1 if _hw.read(self._bcm) == (1 if self.active_high else 0) else 0

    @value.setter
    def value(self, v):
        self._stop_seq()
        self._write(v)


class DigitalOutputDevice(OutputDevice):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._run_seq([(1, on_time), (0, off_time)], n, background, 0)


class LED(DigitalOutputDevice):
    is_lit = Device.is_active


class Buzzer(DigitalOutputDevice):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self.blink(on_time, off_time, n, background)


class InputDevice(Device):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, pin_factory=None):
        super().__init__(pin)
        self._bcm = self._pins[0]
        if pull_up is None:
            if active_state is None:
                raise PinInvalidState(f'Pin GPIO{self._bcm} is defined as floating, but "active_state" is not defined')
            self._active_high, mode = bool(active_state), 1
        else:
            if active_state is not None:
                raise PinInvalidState(f'Pin GPIO{self._bcm} is not floating, but "active_state" is not None')
            self._active_high, mode = not pull_up, (2 if pull_up else 3)
        self.pull_up = pull_up
        _hw.setup(self._bcm, mode)

    @property
    def value(self):
        self._check()
        _rt.yield_point()
        return 1 if _hw.read(self._bcm) == (1 if self._active_high else 0) else 0


class DigitalInputDevice(InputDevice):
    """Activation and deactivation from the editor's edge counters (spec 4.4), so a press that
    happens while the code sleeps still fires."""

    def __init__(self, pin=None, *, pull_up=False, active_state=None, bounce_time=None, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state)
        self._bounce = bounce_time or 0
        self._seen = (_hw.rising(self._bcm) & _M32, _hw.falling(self._bcm) & _M32)
        self._last = None
        self._active_since = None
        self._hold = None
        self.when_activated = None
        self.when_deactivated = None
        _rt.add_poller(self._poll)

    def _release(self):
        _rt.remove_poller(self._poll)
        if self._hold is not None:
            self._hold.cancel()

    def _poll(self):
        r, f = _hw.rising(self._bcm) & _M32, _hw.falling(self._bcm) & _M32
        ups, downs = (r - self._seen[0]) & _M32, (f - self._seen[1]) & _M32
        self._seen = (r, f)
        if not ups and not downs:
            return
        t = _rt.now()
        if self._bounce and self._last is not None and t - self._last < self._bounce:
            return
        self._last = t
        acts, deacts = (ups, downs) if self._active_high else (downs, ups)
        level_now = _hw.read(self._bcm) == (1 if self._active_high else 0)
        # Alternate the events so the last one matches the level now.
        events = []
        for _ in range(acts + deacts):
            events.append(not events[-1] if events else None)
        if events:
            events[-1] = level_now
            for i in range(len(events) - 2, -1, -1):
                events[i] = not events[i + 1]
        for active in events:
            _rt.queue(lambda active=active: self._edge(active))

    def _edge(self, active):
        if active:
            self._active_since = _rt.now()
            self._activated()
            if self.when_activated:
                _call(self.when_activated, self)
        else:
            self._active_since = None
            self._deactivated()
            if self.when_deactivated:
                _call(self.when_deactivated, self)

    def _activated(self):
        pass

    def _deactivated(self):
        pass

    @property
    def active_time(self):
        return None if self._active_since is None else _rt.now() - self._active_since

    def wait_for_active(self, timeout=None):
        return _rt.wait(timeout, until=lambda: self.is_active)

    def wait_for_inactive(self, timeout=None):
        return _rt.wait(timeout, until=lambda: not self.is_active)


class Button(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, bounce_time=bounce_time)
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat
        self.when_held = None
        self._held = False

    def _activated(self):
        self._held = False
        self._hold = _rt.call_later(self.hold_time, self._held_now, self.hold_time if self.hold_repeat else None)

    def _deactivated(self):
        self._held = False
        if self._hold is not None:
            self._hold.cancel()
            self._hold = None

    def _held_now(self):
        if not self.is_active:
            return
        self._held = True
        if self.when_held:
            _call(self.when_held, self)

    @property
    def is_held(self):
        return self._held

    @property
    def held_time(self):
        return self.active_time if self._held else None

    is_pressed = Device.is_active
    when_pressed = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    when_released = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    wait_for_press = DigitalInputDevice.wait_for_active
    wait_for_release = DigitalInputDevice.wait_for_inactive


class LineSensor(DigitalInputDevice):
    """As gpiozero 2.0: the line is detected while the input is inactive."""

    @property
    def line_detected(self):
        return not self.is_active

    when_line = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    when_no_line = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    wait_for_line = DigitalInputDevice.wait_for_inactive
    wait_for_no_line = DigitalInputDevice.wait_for_active


class MotionSensor(DigitalInputDevice):
    @property
    def motion_detected(self):
        return self.is_active

    when_motion = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    when_no_motion = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    wait_for_motion = DigitalInputDevice.wait_for_active
    wait_for_no_motion = DigitalInputDevice.wait_for_inactive


def pause():
    """Waits forever, running callbacks (spec 5.2)."""
    _rt.wait()
```

`DigitalInputDevice.__init__` sets `self.when_activated = None` as plain attributes; `Button.when_pressed` is a property over them, so `b.when_pressed = fn` stores into `when_activated`. (Task 16 appends the PWM classes below `MotionSensor`, before `pause`.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run/gpiozero.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/run/py/gpiozero/__init__.py src/run/gpiozero.test.ts
git commit -m "$(cat <<'MSG'
Run: the gpiozero stand-in (pin names, LED, Buzzer, digital devices, Button with hold, line and motion sensors, pause)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 16: The `gpiozero` stand-in: PWM devices, servos and motors

**Files:**
- Modify: `src/run/py/gpiozero/__init__.py` (append the PWM classes before `pause`)
- Create: `src/run/gpiozeroPwm.test.ts`

**Interfaces:**
- Consumes: Task 15's `Device`, `OutputDevice`, `DigitalOutputDevice`, `LED`, `_Sequence`, `_fade_steps`, `_rt`, `_hw`, `OutputDeviceBadValue`.
- Produces (Python `gpiozero`): `PWMOutputDevice`, `PWMLED`, `RGBLED`, `Servo`, `AngularServo`, `Motor` (two pins). Every one writes the declared PWM descriptor (spec 2.2); `Buzzer` stays the digital device of Task 15 (spec revision 5).

- [ ] **Step 1: Write the failing test**

`src/run/gpiozeroPwm.test.ts`:

```ts
// Firmware spec 5.1 and 2.2: gpiozero's PWM devices declare duty and frequency; nothing toggles the
// pin. Values map as gpiozero maps them: PWMLED duty, RGBLED per channel, Servo pulse widths (1 to
// 2 ms in a 20 ms frame by default), AngularServo angles, Motor forward and backward.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nfrom gpiozero import *\n'
const pwms = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => r.trace.filter((x) => x.bcm === bcm && x.pwm).map((x) => x.pwm!)
const last = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => pwms(r, bcm).at(-1)

describe('gpiozero PWM devices (spec 5.1, 2.2)', () => {
  it('declares a PWMLED\'s duty at 100 Hz, and never writes its latch', async () => {
    const r = await runScript(`${head}led = PWMLED(18)\nled.value = 0.5\nprint(led.value, led.is_lit)\n`)
    expect(last(r, 18)).toEqual({ active: true, duty: 0.5, freq: 100 })
    expect(r.out).toBe('0.5 True\n')
    expect(r.trace.some((x) => x.bcm === 18 && x.latch !== undefined)).toBe(false)
  })
  it('pulses: 25 rising steps over the fade-in second, then falling', async () => {
    const r = await runScript(`${head}PWMLED(18).pulse(n=1, background=False)\n`)
    const d = pwms(r, 18).map((p) => p.duty)
    const peak = d.indexOf(1)
    expect(peak).toBeGreaterThanOrEqual(25)
    expect(d.slice(1, peak).every((x, i) => x >= d[i])).toBe(true)
    expect(d.at(-1)).toBe(0)
    expect(r.t).toBeGreaterThanOrEqual(2000)
  })
  it('sets an RGBLED per channel, and blinks between colours', async () => {
    const r = await runScript(`${head}c = RGBLED(17, 27, 22)\nc.color = (1, 0.5, 0)\nprint(c.value)\nc.blink(on_time=0.5, off_time=0.5, on_color=(0, 0, 1), n=1, background=False)\nprint(c.value)\n`)
    expect([last(r, 17), last(r, 27), last(r, 22)].map((p) => p!.duty)).toEqual([0, 0, 0])
    expect(r.out).toBe('(1.0, 0.5, 0.0)\n(0.0, 0.0, 0.0)\n')
    expect(pwms(r, 22).some((p) => p.duty === 1)).toBe(true)
  })
  it('maps Servo values to pulse widths in a 20 ms frame, and detaches', async () => {
    const r = await runScript(`${head}s = Servo(18)\ns.min()\ns.max()\ns.detach()\n`)
    const p = pwms(r, 18)
    expect(p.map((x) => [x.active, Number(x.duty.toFixed(4)), x.freq])).toEqual([[true, 0.075, 50], [true, 0.05, 50], [true, 0.1, 50], [false, 0, 50]])
  })
  it('maps AngularServo angles across its range', async () => {
    const r = await runScript(`${head}s = AngularServo(18, min_angle=-90, max_angle=90)\ns.angle = 45\nprint(s.angle, s.value)\n`)
    expect(Number(last(r, 18)!.duty.toFixed(5))).toBe(0.0875)
    expect(r.out).toBe('45.0 0.5\n')
  })
  it('drives a Motor forward, backward and stopped on its two pins', async () => {
    const r = await runScript(`${head}m = Motor(17, 27)\nm.forward(0.6)\nprint(m.value)\nm.backward()\nprint(m.value)\nm.stop()\nprint(m.value)\n`)
    expect(r.out).toBe('0.6\n-1.0\n0.0\n')
    expect([last(r, 17)!.duty, last(r, 27)!.duty]).toEqual([0, 0])
    expect((await runScript(`${head}Motor(17, 27, enable=22)\n`)).err).toContain("NotImplementedError: Motor's enable pin is not simulated yet; wire it high and leave enable out")
  })
  it('refuses values out of range', async () => {
    expect((await runScript(`${head}PWMLED(18).value = 1.5\n`)).err).toContain('gpiozero.OutputDeviceBadValue: PWM value must be between 0 and 1')
    expect((await runScript(`${head}Servo(18).value = 2\n`)).err).toContain('gpiozero.OutputDeviceBadValue: Servo value must be between -1 and 1, or None')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/gpiozeroPwm.test.ts`
Expected: FAIL: `gpiozero.PWMLED is not in the simulator yet`.

- [ ] **Step 3: Append the PWM devices**

In `src/run/py/gpiozero/__init__.py`, add `'PWMOutputDevice', 'PWMLED', 'RGBLED', 'Servo', 'AngularServo', 'Motor'` to `__all__`, and insert before `def pause():`:

```python
class PWMOutputDevice(OutputDevice):
    """Declares duty and frequency (spec 2.2); value is the duty, 0 to 1."""

    def __init__(self, pin=None, *, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        self._duty = 0.0
        self._freq = float(frequency)
        super().__init__(pin, active_high=active_high, initial_value=None)
        self._write(initial_value)

    def _write(self, value):
        self._check()
        v = float(value)
        if not 0 <= v <= 1:
            raise OutputDeviceBadValue('PWM value must be between 0 and 1')
        self._duty = v
        _hw.pwm(self._bcm, True, v if self.active_high else 1 - v, self._freq)

    @property
    def value(self):
        self._check()
        return self._duty

    @value.setter
    def value(self, v):
        self._stop_seq()
        self._write(v)

    def toggle(self):
        self._stop_seq()
        self._write(1 - self._duty)

    @property
    def frequency(self):
        return self._freq

    @frequency.setter
    def frequency(self, f):
        self._freq = float(f)
        self._write(self._duty)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        self._run_seq(_fade_steps(on_time, off_time, fade_in_time, fade_out_time, 0, 1), n, background, 0)

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, n, background)


class PWMLED(PWMOutputDevice):
    is_lit = Device.is_active


class RGBLED(Device):
    def __init__(self, red=None, green=None, blue=None, *, active_high=True, initial_value=(0, 0, 0), pwm=True, pin_factory=None):
        cls = PWMLED if pwm else LED
        self._leds = []
        try:
            for p in (red, green, blue):
                self._leds.append(cls(p, active_high=active_high))
        except BaseException:
            for led in self._leds:
                led.close()
            raise
        super().__init__()
        self._pwm = pwm
        self._seq = None
        self._write(initial_value)

    def _write(self, color):
        self._check()
        if len(color) != 3:
            raise OutputDeviceBadValue('RGBLED color must be a 3-tuple')
        for led, v in zip(self._leds, color):
            if not self._pwm and v not in (0, 1):
                raise OutputDeviceBadValue('RGBLED with pwm=False takes only 0 or 1 per channel')
            led._write(v)

    def _stop_seq(self):
        if self._seq is not None:
            self._seq.cancel()
            self._seq = None

    def _release(self):
        self._stop_seq()
        for led in self._leds:
            led.close()

    @property
    def value(self):
        self._check()
        return tuple(float(led._duty) if self._pwm else float(led.value) for led in self._leds)

    @value.setter
    def value(self, color):
        self._stop_seq()
        self._write(color)

    color = value

    red = property(lambda self: self.value[0], lambda self, v: setattr(self, 'value', (v,) + self.value[1:]))
    green = property(lambda self: self.value[1], lambda self, v: setattr(self, 'value', self.value[:1] + (v,) + self.value[2:]))
    blue = property(lambda self: self.value[2], lambda self, v: setattr(self, 'value', self.value[:2] + (v,)))

    @property
    def is_active(self):
        return self.value != (0, 0, 0)

    is_lit = is_active

    def on(self):
        self.value = (1, 1, 1)

    def off(self):
        self.value = (0, 0, 0)

    def toggle(self):
        self.value = tuple(1 - v for v in self.value)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self._stop_seq()
        seq = self._seq = _Sequence(self, _fade_steps(on_time, off_time, fade_in_time, fade_out_time, tuple(off_color), tuple(on_color)), n, tuple(off_color))
        if not background:
            _rt.wait(until=lambda: seq.done)

    def pulse(self, fade_in_time=1, fade_out_time=1, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, on_color, off_color, n, background)


class Servo(Device):
    """value -1 to 1 maps to min_pulse_width to max_pulse_width in a frame (spec 5.1); None detaches."""

    def __init__(self, pin=None, *, initial_value=0.0, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        if min_pulse_width >= max_pulse_width:
            raise ValueError('min_pulse_width must be less than max_pulse_width')
        if max_pulse_width >= frame_width:
            raise ValueError('max_pulse_width must be less than frame_width')
        super().__init__(pin)
        self._bcm = self._pins[0]
        self._min_pw, self._max_pw, self._frame = min_pulse_width, max_pulse_width, frame_width
        self._value = None
        _hw.setup(self._bcm, 4)
        self.value = initial_value

    @property
    def frame_width(self):
        return self._frame

    @property
    def min_pulse_width(self):
        return self._min_pw

    @property
    def max_pulse_width(self):
        return self._max_pw

    @property
    def pulse_width(self):
        return None if self._value is None else self._min_pw + (self._value + 1) / 2 * (self._max_pw - self._min_pw)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._check()
        if v is None:
            self._value = None
            _hw.pwm(self._bcm, False, 0, 1 / self._frame)
            return
        v = float(v)
        if not -1 <= v <= 1:
            raise OutputDeviceBadValue('Servo value must be between -1 and 1, or None')
        self._value = v
        _hw.pwm(self._bcm, True, self.pulse_width / self._frame, 1 / self._frame)

    @property
    def is_active(self):
        return self._value is not None

    def min(self):
        self.value = -1

    def mid(self):
        self.value = 0

    def max(self):
        self.value = 1

    def detach(self):
        self.value = None


class AngularServo(Servo):
    def __init__(self, pin=None, *, initial_angle=0.0, min_angle=-90, max_angle=90, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        self._min_angle, self._max_angle = min_angle, max_angle
        super().__init__(pin, initial_value=None if initial_angle is None else self._to_value(initial_angle), min_pulse_width=min_pulse_width, max_pulse_width=max_pulse_width, frame_width=frame_width)

    def _to_value(self, angle):
        return (angle - self._min_angle) / (self._max_angle - self._min_angle) * 2 - 1

    @property
    def min_angle(self):
        return self._min_angle

    @property
    def max_angle(self):
        return self._max_angle

    @property
    def angle(self):
        v = self.value
        return None if v is None else self._min_angle + (v + 1) / 2 * (self._max_angle - self._min_angle)

    @angle.setter
    def angle(self, a):
        self.value = None if a is None else self._to_value(a)


class Motor(Device):
    """A motor on two pins (spec 5.1): forward on one, backward on the other."""

    def __init__(self, forward=None, backward=None, *, enable=None, pwm=True, pin_factory=None):
        if enable is not None:
            raise NotImplementedError("Motor's enable pin is not simulated yet; wire it high and leave enable out")
        cls = PWMOutputDevice if pwm else DigitalOutputDevice
        self._fwd = cls(forward)
        try:
            self._bwd = cls(backward)
        except BaseException:
            self._fwd.close()
            raise
        super().__init__()
        self._pwm = pwm

    def _set(self, dev, speed):
        if not 0 <= speed <= 1:
            raise ValueError('speed must be between 0 and 1')
        if self._pwm:
            dev.value = speed
        elif speed in (0, 1):
            dev.value = speed
        else:
            raise ValueError('a Motor with pwm=False runs only at speed 0 or 1')

    def forward(self, speed=1):
        self._set(self._bwd, 0)
        self._set(self._fwd, speed)

    def backward(self, speed=1):
        self._set(self._fwd, 0)
        self._set(self._bwd, speed)

    def stop(self):
        self._set(self._fwd, 0)
        self._set(self._bwd, 0)

    def reverse(self):
        self.value = -self.value

    @property
    def value(self):
        return float(self._fwd.value) - float(self._bwd.value)

    @value.setter
    def value(self, v):
        if v > 0:
            self.forward(v)
        elif v < 0:
            self.backward(-v)
        else:
            self.stop()

    @property
    def is_active(self):
        return self.value != 0

    def _release(self):
        self._fwd.close()
        self._bwd.close()
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/gpiozeroPwm.test.ts src/run/gpiozero.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run/py/gpiozero/__init__.py src/run/gpiozeroPwm.test.ts
git commit -m "$(cat <<'MSG'
Run: gpiozero PWM devices (PWMLED with blink and pulse, RGBLED, Servo, AngularServo, two-pin Motor) as declared PWM

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 17: The code worker: sandbox, Pyodide, Stop and the host (`BoardRun`)

**Files:**
- Create: `src/run/worker/sandbox.ts`, `src/run/host.ts`, `src/run/node/codeWorker.ts`, `src/run/browser/codeWorker.ts`, `src/run/worker.test.ts`, `src/run/testing.ts`
- Modify: `src/run/worker/serve.ts` (add `serveCode`)

**Interfaces:**
- Consumes: Tasks 12 and 13 (`boardMemory`, `interrupt`, `writeLine`, `writeIn`, `makeHw`, `realClock`, `installFiles`, `runMain`, `PyodideLike`, `FromCode`, `ToCode`, `RunStatus`); `PY_JSGLOBALS` (Task 11); `PY_FILES`.
- Produces:
  - `src/run/worker/sandbox.ts`: `const SANDBOXED: readonly string[]`; `function sandbox(scope: object): string[]` (the names it removed)
  - `src/run/worker/serve.ts`: `type LoadPy = (indexURL: string, lock: string) => Promise<PyodideLike>`; `function serveCode(post: (m: FromCode) => void, listen: (cb: (m: ToCode) => void) => void, loadPy: LoadPy): void`
  - `src/run/host.ts`: `interface CodeWorkerLike { post(m: ToCode): void; onMessage(cb: (m: FromCode) => void): void; onError(cb: (why: string) => void): void; terminate(): void }`; `interface BoardRunOptions { board: BoardKind; source: string; file: string; mode: 'real' | 'virtual'; py: { indexURL: string; lock: string }; files: Record<string, string>; spawn: () => CodeWorkerLike; on: (m: FromCode) => void; stopGraceMs?: number }`; `class BoardRun { readonly memory: BoardMemory; status: RunStatus; constructor(o: BoardRunOptions); start(): void; stop(): Promise<'stopped' | 'terminated' | 'ended'>; readonly done: Promise<void> }`; `const VIRTUAL_EPOCH_MS = Date.UTC(2026, 0, 1)`
  - `src/run/node/codeWorker.ts`: `function spawnNodeCodeWorker(): CodeWorkerLike`
  - `src/run/browser/codeWorker.ts`: the browser worker entry (built as `assets/codeWorker-<hash>.js`)
  - `src/run/testing.ts`: `function nodePy(): { indexURL: string; lock: string }` (node_modules/pyodide) and `function runNode(source: string, o?: { file?: string; board?: BoardKind; mode?: 'real' | 'virtual'; on?: (m: FromCode, run: BoardRun) => void }): { run: BoardRun; messages: FromCode[]; exited: Promise<string> }`

- [ ] **Step 1: Write the failing test**

`src/run/worker.test.ts`:

```ts
// Firmware spec 2.6, 5.3, 5.4 in a real Node worker with real Pyodide: Serial output batched,
// tracebacks with the file name, input() resumed by a line, Stop as KeyboardInterrupt within 100 ms
// even mid-sleep(10), a worker that ignores Stop terminated after 1 s, a read after setup waiting for
// a solve (at most 200 ms), and the sandbox: no fetch, WebSocket or importScripts for user code.
import { describe, expect, it } from 'vitest'
import { H, INPUT, readOut, writeIn, writeLine } from './memory.ts'
import { sandbox } from './worker/sandbox.ts'
import { runNode } from './testing.ts'

const out = (ms: { type: string; text?: string; stream?: string }[], stream = 'out') => ms.filter((m) => m.type === 'out' && m.stream === stream).map((m) => m.text).join('')

describe('sandbox (spec 2.6)', () => {
  it('removes the network, storage and workers from the scope and its prototypes', () => {
    const proto = { fetch() {}, indexedDB: {}, other: 1 }
    const scope = Object.assign(Object.create(proto), { WebSocket: class {}, importScripts() {} })
    expect(sandbox(scope).sort()).toEqual(['WebSocket', 'fetch', 'importScripts', 'indexedDB'])
    expect([scope.fetch, scope.WebSocket, scope.importScripts, scope.indexedDB, scope.other]).toEqual([undefined, undefined, undefined, undefined, 1])
  })
})

describe('the code worker (spec 5.3, 5.4)', () => {
  it('runs a script and batches its Serial output', async () => {
    const r = runNode("for i in range(100):\n    print('line', i)\n")
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe(Array.from({ length: 100 }, (_, i) => `line ${i}\n`).join(''))
    expect(r.messages.filter((m) => m.type === 'out').length).toBeLessThan(100)
    expect(r.messages[0]).toEqual({ type: 'ready' })
  }, 60_000)
  it('prints a traceback with the script file name and ends with error', async () => {
    const r = runNode("x = 1\nraise ValueError('bad')\n", { file: 'blink.py' })
    expect(await r.exited).toBe('error')
    expect(out(r.messages, 'err')).toContain('File "blink.py", line 2, in <module>')
  }, 60_000)
  it('resumes input() with a line from the host', async () => {
    const r = runNode("print('Hi', input('Name? '))\n", { on: (m, run) => m.type === 'prompt' && writeLine(run.memory, 'Ada') })
    expect(await r.exited).toBe('done')
    expect(r.messages).toContainEqual({ type: 'prompt', text: 'Name? ' })
    expect(out(r.messages)).toBe('Hi Ada\n')
  }, 60_000)
  it('stops a sleep(10) with KeyboardInterrupt within 100 ms, running finally', async () => {
    let started = 0
    const r = runNode("import time\ntry:\n    print('sleeping')\n    time.sleep(10)\nfinally:\n    print('cleaned up')\n", {
      on: (m, run) => {
        if (m.type === 'out' && m.text?.includes('sleeping')) setTimeout(() => { started = performance.now(); void run.stop() }, 200)
      },
    })
    expect(await r.exited).toBe('stopped')
    expect(performance.now() - started).toBeLessThan(100)
    expect(out(r.messages)).toBe('sleeping\ncleaned up\n')
  }, 60_000)
  it('terminates a worker that ignores Stop after 1 s', async () => {
    let result: Promise<string> | null = null
    const t0 = { at: 0 }
    const r = runNode("import time\nprint('go')\nwhile True:\n    try:\n        time.sleep(1)\n    except KeyboardInterrupt:\n        pass\n", {
      on: (m, run) => {
        if (m.type === 'out' && !result) {
          t0.at = performance.now()
          result = run.stop()
        }
      },
    })
    await r.exited
    expect(await result).toBe('terminated')
    expect(performance.now() - t0.at).toBeGreaterThanOrEqual(990)
  }, 60_000)
  it('waits up to 200 ms for a solve after setup, then reads the pull level', async () => {
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nt = time.monotonic()\nv = GPIO.input(27)\nprint(v, round(time.monotonic() - t, 1))\n')
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('1 0.2\n')
  }, 60_000)
  it('reads the level as soon as a solve through the latest setup lands', async () => {
    const r = runNode('import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nprint(GPIO.input(27))\n', {
      on: (m, run) => {
        if (m.type !== 'ready') return
        setTimeout(() => writeIn(run.memory, Array.from({ length: 28 }, (_, b) => (b === 27 ? { level: 0, rising: 0, falling: 1, status: 'value', volts: 0 } : null)), 1_000), 50)
      },
    })
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('0\n')
  }, 60_000)
  it('gives user code no network: js has no fetch, and the worker scope has none either', async () => {
    const r = runNode("import js\nprint(hasattr(js, 'fetch'))\nfrom pyodide.code import run_js\nprint(run_js('typeof fetch'), run_js('typeof WebSocket'), run_js('typeof importScripts'))\n")
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('False\nundefined undefined undefined\n')
  }, 60_000)
  it('leaves every pin unused at the end', async () => {
    const r = runNode('import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.output(17, 1)\n')
    await r.exited
    expect(readOut(r.run.memory, 17).mode).toBe(0)
    expect(Atomics.load(r.run.memory.i32, H.inputState)).toBe(INPUT.idle)
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/worker.test.ts`
Expected: FAIL, `./worker/sandbox.ts` cannot be found.

- [ ] **Step 3: The sandbox**

`src/run/worker/sandbox.ts`:

```ts
// The code worker's backstop (firmware spec 2.6). Before user code runs, the network, storage and
// worker constructors leave the worker's global scope and every prototype on its chain
// (WorkerGlobalScope.prototype and its relatives), so even code that reached the real global (it
// should not: jsglobals is curated) would find nothing to call.
export const SANDBOXED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker'] as const

export function sandbox(scope: object): string[] {
  const removed: string[] = []
  for (let o: object | null = scope; o; o = Object.getPrototypeOf(o))
    for (const name of SANDBOXED) {
      if (!Object.getOwnPropertyDescriptor(o, name)) continue
      if (Reflect.deleteProperty(o, name)) removed.push(name)
      else {
        // Not configurable: shadow it on the scope itself instead.
        Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false })
        removed.push(name)
      }
    }
  return removed
}
```

- [ ] **Step 4: The worker loop**

Append to `src/run/worker/serve.ts` (and add its imports at the top: `import { makeHw, realClock } from '../bridge.ts'`, `import { H, INPUT, boardMemory, takeLine } from '../memory.ts'`, `import type { FromCode, ToCode } from '../protocol.ts'`, `import { sandbox } from './sandbox.ts'`):

```ts
export type LoadPy = (indexURL: string, lock: string) => Promise<PyodideLike>
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Serial output (spec 5.3): lines collected and posted at most every 16 ms, and at every yield point. */
function outBuffer(post: (m: FromCode) => void) {
  let buf: { stream: 'out' | 'err'; text: string } | null = null
  let last = 0
  const flush = () => {
    if (buf) post({ type: 'out', ...buf })
    buf = null
    last = performance.now()
  }
  return {
    flush,
    push(stream: 'out' | 'err', line: string) {
      if (buf && buf.stream !== stream) flush()
      buf = { stream, text: (buf?.text ?? '') + line + '\n' }
      if (performance.now() - last >= 16) flush()
    },
  }
}

/**
 * The code worker (firmware spec 2.6, 5.2 to 5.4), shared by the browser and Node workers: on
 * 'start', load Pyodide (the caller's loader), remove the network and storage from the scope, write
 * our Python files, register circuitoon_hw, run the script, and say how it ended. One run per worker:
 * Reset starts a fresh one (spec 5.4).
 */
export function serveCode(post: (m: FromCode) => void, listen: (cb: (m: ToCode) => void) => void, loadPy: LoadPy): void {
  listen((m) => {
    if (m.type !== 'start') return
    void (async () => {
      let py: PyodideLike
      try {
        py = await loadPy(m.py.indexURL, m.py.lock)
      } catch (e) {
        return post({ type: 'fatal', error: why(e) })
      }
      sandbox(globalThis)
      const mem = boardMemory(m.sab)
      const check = () => py.checkInterrupt()
      // Task 18 adds the virtual clock for mode 'virtual'.
      const clock = realClock(mem, check)
      const out = outBuffer(post)
      const hw = makeHw(mem, clock, { board: m.board, onPrompt: (text) => post({ type: 'prompt', text }), flush: out.flush })
      py.setStdout({ batched: (s) => out.push('out', s) })
      py.setStderr({ batched: (s) => out.push('err', s) })
      // sys.stdin.readline() (spec 5.3): waits for a line, running no callbacks.
      py.setStdin({
        stdin: () => {
          Atomics.store(mem.i32, H.inputState, INPUT.waiting)
          post({ type: 'prompt', text: '' })
          while (Atomics.load(mem.i32, H.inputState) !== INPUT.ready) clock.block(Infinity)
          return `${takeLine(mem)}\n`
        },
      })
      py.setInterruptBuffer(new Int32Array(m.sab, H.interrupt * 4, 1))
      installFiles(py, m.files)
      py.registerJsModule('circuitoon_hw', hw)
      post({ type: 'ready' })
      let status: 'done' | 'stopped' | 'error'
      try {
        status = runMain(py, m.source, m.file)
      } catch (e) {
        out.push('err', why(e))
        status = 'error'
      }
      out.flush()
      post({ type: 'exit', status })
    })()
  })
}
```

- [ ] **Step 5: The host**

`src/run/host.ts`:

```ts
// One running board (firmware spec 2.1, 5.4): its shared memory, its worker, Stop and Reset. Stop
// writes the interrupt buffer and wakes the code (KeyboardInterrupt: except and finally blocks run);
// the worker is terminated if it has not finished after 1 s. Reset is a new BoardRun (a fresh worker,
// the already-fetched files). Host side, shared by the editor and the CLI.
import type { BoardKind } from './boards.ts'
import { type BoardMemory, F, boardMemory, interrupt } from './memory.ts'
import type { FromCode, RunStatus, ToCode } from './protocol.ts'

/** time.time() at run time 0 under the virtual clock: fixed, so runs repeat exactly. */
export const VIRTUAL_EPOCH_MS = Date.UTC(2026, 0, 1)

export interface CodeWorkerLike {
  post(m: ToCode): void
  onMessage(cb: (m: FromCode) => void): void
  onError(cb: (why: string) => void): void
  terminate(): void
}
export interface BoardRunOptions {
  board: BoardKind
  source: string
  file: string
  mode: 'real' | 'virtual'
  py: { indexURL: string; lock: string }
  files: Record<string, string>
  spawn: () => CodeWorkerLike
  on: (m: FromCode) => void
  /** How long Stop waits before terminating the worker (spec 5.4: 1 s). */
  stopGraceMs?: number
}

export class BoardRun {
  readonly memory: BoardMemory
  status: RunStatus = 'starting'
  readonly done: Promise<void>
  private o: BoardRunOptions
  private worker: CodeWorkerLike | null = null
  private ended!: () => void

  constructor(o: BoardRunOptions) {
    this.o = o
    this.memory = boardMemory()
    this.done = new Promise((r) => (this.ended = r))
  }

  start(): void {
    this.memory.f64[F.startMs] = this.o.mode === 'virtual' ? VIRTUAL_EPOCH_MS : performance.timeOrigin + performance.now()
    // The never-pauses check counts from the start until the first yield.
    this.memory.f64[F.lastYieldMs] = performance.timeOrigin + performance.now()
    const w = (this.worker = this.o.spawn())
    w.onMessage((m) => {
      if (m.type === 'ready') this.status = 'running'
      if (m.type === 'exit') this.finish(m.status)
      if (m.type === 'fatal') this.finish('error')
      this.o.on(m)
    })
    w.onError((why) => {
      if (this.status !== 'starting' && this.status !== 'running') return
      this.o.on({ type: 'fatal', error: why })
      this.finish('error')
    })
    w.post({ type: 'start', sab: this.memory.sab, files: this.o.files, source: this.o.source, file: this.o.file, board: this.o.board, mode: this.o.mode, py: this.o.py })
  }

  private finish(status: RunStatus): void {
    if (this.status === 'starting' || this.status === 'running') this.status = status
    this.ended()
  }

  /** Stop (spec 5.4): KeyboardInterrupt now; terminated if not finished after 1 s. */
  async stop(): Promise<'stopped' | 'terminated' | 'ended'> {
    const w = this.worker
    if (!w) return 'ended'
    if (this.status !== 'starting' && this.status !== 'running') {
      w.terminate()
      return 'ended'
    }
    interrupt(this.memory)
    const how = await Promise.race([this.done.then(() => 'stopped' as const), new Promise<'terminated'>((r) => setTimeout(() => r('terminated'), this.o.stopGraceMs ?? 1000))])
    w.terminate()
    if (how === 'terminated') this.finish('stopped')
    return how
  }
}
```

- [ ] **Step 6: The two workers**

`src/run/node/codeWorker.ts`:

```ts
// The code worker in Node (circuitoon run, the tests): a worker_threads Worker that runs this same
// file, as nodeEngine.ts does (plan ruling R22 of the live simulation): the CLI bundle in the plugin,
// this .ts file under vitest. Pyodide loads from the directory the host names (ensurePy's cache or
// --py-dir).
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { CodeWorkerLike } from '../host.ts'
import { PY_JSGLOBALS } from '../limits.ts'
import type { FromCode, ToCode } from '../protocol.ts'
import { type PyodideLike, serveCode } from '../worker/serve.ts'

export function spawnNodeCodeWorker(): CodeWorkerLike {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { circuitoonCode: true } })
  return {
    post: (m: ToCode) => w.postMessage(m),
    onMessage: (cb) => void w.on('message', (m: FromCode) => cb(m)),
    onError: (cb) => {
      w.on('error', (e) => cb(e instanceof Error ? e.message : String(e)))
      w.on('exit', (code) => code !== 0 && cb(`the code worker exited (${code})`))
    },
    terminate: () => void w.terminate(),
  }
}

const data = workerData as { circuitoonCode?: boolean } | null
if (!isMainThread && data?.circuitoonCode) {
  serveCode(
    (m) => parentPort!.postMessage(m),
    (cb) => void parentPort!.on('message', cb),
    async (indexURL, lock) => {
      const mod = (await import(pathToFileURL(join(indexURL, 'pyodide.mjs')).href)) as { loadPyodide: (o: object) => Promise<PyodideLike> }
      const g = globalThis as unknown as Record<string, unknown>
      return mod.loadPyodide({ indexURL, lockFileContents: lock, jsglobals: Object.fromEntries(PY_JSGLOBALS.map((n) => [n, g[n]])) })
    },
  )
}
```

`src/run/browser/codeWorker.ts`:

```ts
// The code worker in the browser (firmware spec 2.6): a module worker whose script response carries
// the CSP (vite.config.ts in dev and preview, the service worker on the built site: its name must
// keep matching /codeWorker[^/]*\.(js|ts)/), so it loads only our own scripts and files. Pyodide
// comes from the versioned directory the page prefetched (prefetch.ts).
import { PY_JSGLOBALS } from '../limits.ts'
import type { FromCode, ToCode } from '../protocol.ts'
import { type PyodideLike, serveCode } from '../worker/serve.ts'

const scope = self as unknown as Record<string, unknown> & { postMessage(m: FromCode): void; addEventListener(t: 'message', f: (e: MessageEvent<ToCode>) => void): void }

serveCode(
  (m) => scope.postMessage(m),
  (cb) => scope.addEventListener('message', (e) => cb(e.data)),
  async (indexURL, lock) => {
    const { loadPyodide } = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide: (o: object) => Promise<PyodideLike> }
    return loadPyodide({ indexURL, lockFileContents: lock, jsglobals: Object.fromEntries(PY_JSGLOBALS.map((n) => [n, scope[n]])) })
  },
)
```

- [ ] **Step 7: The test helper**

`src/run/testing.ts`:

```ts
// Test helpers for code runs in a real Node worker on node_modules/pyodide.
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { BoardKind } from './boards.ts'
import { BoardRun } from './host.ts'
import { spawnNodeCodeWorker } from './node/codeWorker.ts'
import type { FromCode } from './protocol.ts'
import { PY_FILES } from './pyFiles.ts'

export function nodePy(): { indexURL: string; lock: string } {
  const dir = resolve('node_modules/pyodide') + sep
  return { indexURL: dir, lock: readFileSync(`${dir}pyodide-lock.json`, 'utf8') }
}

/** Starts `source` on a fresh board; `exited` resolves to how it ended. */
export function runNode(source: string, o: { file?: string; board?: BoardKind; mode?: 'real' | 'virtual'; on?: (m: FromCode, run: BoardRun) => void } = {}) {
  const messages: FromCode[] = []
  let ended!: (s: string) => void
  const exited = new Promise<string>((r) => (ended = r))
  const run: BoardRun = new BoardRun({
    board: o.board ?? 'pi4', source, file: o.file ?? 'main.py', mode: o.mode ?? 'real', py: nodePy(), files: PY_FILES, spawn: spawnNodeCodeWorker,
    on: (m) => {
      messages.push(m)
      o.on?.(m, run)
      if (m.type === 'exit') ended(m.status)
      if (m.type === 'fatal') ended(`fatal: ${m.error}`)
    },
  })
  run.start()
  void run.done.then(() => ended(run.status))
  return { run, messages, exited }
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/run/worker.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 9: Commit**

```bash
git add src/run/worker/sandbox.ts src/run/worker/serve.ts src/run/host.ts src/run/node/codeWorker.ts src/run/browser/codeWorker.ts src/run/worker.test.ts src/run/testing.ts
git commit -m "$(cat <<'MSG'
Run: the code worker (sandbox, Pyodide, Stop) and the host that owns it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```


### Task 18: The virtual clock in the worker

**Files:**
- Modify: `src/run/bridge.ts` (add `virtualClock`, `QUANTUM_MS`), `src/run/worker/serve.ts` (mode `virtual`)
- Create: `src/run/virtual.test.ts`

**Interfaces:**
- Consumes: Task 17 (`BoardRun`, `runNode`, `FromCode` `block`), memory `F.clockMs`, `F.horizonMs`.
- Produces:
  - `const QUANTUM_MS = 0.01`; `function virtualClock(m: BoardMemory, post: (msg: FromCode) => void, checkInterrupt: () => void): RunClock`
  - the protocol (ruling R16) a driver follows: the worker posts `{ type: 'block', nowMs, untilMs }` and waits on the wake word; the driver sets `F.clockMs` (the time the board may advance to) and `F.horizonMs` (the next time a pin read must sync), then wakes it. Every `now()` advances the board's own time by 10 us; a pin read past the horizon syncs.

- [ ] **Step 1: Write the failing test**

`src/run/virtual.test.ts`:

```ts
// Firmware spec 7 and ruling R16, the worker's half: on the virtual clock a wait reports where the
// board is and until when, and moves on only when the driver says; time and pin reads step 10 us, so
// a busy-wait ends; a polling loop syncs at the driver's horizon and sees an input written there; a
// read after setup gets its solve at the same instant. The driver here is a minimal test driver
// (Task 30 has the real one).
import { describe, expect, it } from 'vitest'
import { F, H, type PinIn, wake, writeIn } from './memory.ts'
import type { BoardRun } from './host.ts'
import type { FromCode } from './protocol.ts'
import { runNode } from './testing.ts'

/**
 * A one-board test driver: grants each block up to its until, the next event or the end; applies the
 * events due by then; solves instantly; sets the horizon to the next 16 ms step or event.
 */
function driver(endMs: number, events: { atMs: number; run: (run: BoardRun) => void }[] = []) {
  return (m: FromCode, run: BoardRun) => {
    if (m.type !== 'block') return
    const t = Math.max(m.nowMs, Math.min(m.untilMs, endMs, events[0]?.atMs ?? Infinity))
    while (events.length && events[0].atMs <= t) events.shift()!.run(run)
    // Solves are instant here: whatever the code set up is solved.
    Atomics.store(run.memory.i32, H.solvedThrough, Atomics.load(run.memory.i32, H.codeSeq))
    run.memory.f64[F.clockMs] = t
    run.memory.f64[F.horizonMs] = Math.min(t + 16, events[0]?.atMs ?? Infinity, endMs)
    if (t >= endMs) void run.stop()
    else wake(run.memory)
  }
}
const printed = (r: { messages: FromCode[] }) => r.messages.flatMap((m) => (m.type === 'out' ? [m.text] : [])).join('')

describe('the virtual clock (spec 7, ruling R16)', () => {
  it('jumps a sleep straight to its end, far faster than real time', async () => {
    const t0 = performance.now()
    const r = runNode('import time\ntime.sleep(30)\nprint(round(time.monotonic(), 2))\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(printed(r)).toBe('30.0\n')
    expect(performance.now() - t0).toBeLessThan(15_000)
  }, 60_000)
  it('ends a busy-wait on time.time(), each call a 10 us step', async () => {
    const r = runNode('import time\nend = time.time() + 0.05\nn = 0\nwhile time.time() < end:\n    n += 1\nprint(n > 1000)\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(printed(r)).toBe('True\n')
  }, 60_000)
  it('syncs a polling loop at the horizon, so it sees an input written there', async () => {
    const low: PinIn = { level: 0, rising: 0, falling: 1, status: 'value', volts: 0 }
    const press = { atMs: 1500, run: (run: BoardRun) => writeIn(run.memory, Array.from({ length: 28 }, (_, b) => (b === 27 ? low : null)), Atomics.load(run.memory.i32, H.codeSeq)) }
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile GPIO.input(27):\n    pass\nprint(round(time.monotonic(), 2))\n', { mode: 'virtual', on: driver(10_000, [press]) })
    expect(await r.exited).toBe('done')
    expect(Number(printed(r))).toBeGreaterThanOrEqual(1.5)
    expect(Number(printed(r))).toBeLessThan(1.52)
  }, 60_000)
  it('gives a read after setup its solve at the same instant (no 200 ms wait)', async () => {
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nt = time.monotonic()\nGPIO.input(27)\nprint(round(time.monotonic() - t, 3))\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(r.messages.some((m) => m.type === 'out' && m.text === '0.0\n')).toBe(true)
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/virtual.test.ts`
Expected: FAIL: the worker ignores `mode: 'virtual'` and sleeps in real time (the first test runs 30 s and times out).

- [ ] **Step 3: The virtual clock**

Append to `src/run/bridge.ts` (import `FromCode` as a type from `./protocol.ts`):

```ts
/** Every time call and pin read on the virtual clock advances the board by this much (spec 7). */
export const QUANTUM_MS = 0.01

/**
 * The CLI's clock (spec 7, ruling R16): the board keeps its own time, stepping 10 us per call; a wait
 * posts where it is and until when, and waits for the driver, which sets F.clockMs (where the board
 * may move to) and F.horizonMs (when a pin read must sync next) before waking it.
 */
export function virtualClock(m: BoardMemory, post: (msg: FromCode) => void, checkInterrupt: () => void): RunClock {
  let t = 0
  const sync = (untilMs: number) => {
    const seen = Atomics.load(m.i32, H.wake)
    post({ type: 'block', nowMs: t, untilMs })
    Atomics.wait(m.i32, H.wake, seen)
    t = Math.max(t, m.f64[F.clockMs])
    checkInterrupt()
  }
  return {
    epochMs: m.f64[F.startMs],
    now() {
      t += QUANTUM_MS
      return t
    },
    block: (untilMs) => sync(untilMs),
    poll() {
      if (t >= m.f64[F.horizonMs]) sync(t)
    },
  }
}
```

In `serveCode`, replace the clock line with:

```ts
      const clock = m.mode === 'virtual' ? virtualClock(mem, post, check) : realClock(mem, check)
```

(and import `virtualClock`). The real clock's `block` returns at its `until` or after 50 ms; the virtual one only when the driver wakes it, so Stop and every driver step `wake()` the board.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/virtual.test.ts src/run/worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run/bridge.ts src/run/worker/serve.ts src/run/virtual.test.ts
git commit -m "$(cat <<'MSG'
Run: the virtual clock (10 us steps, blocks granted by a driver, horizon syncs for polling loops)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 19: The CLI's Python runtime (download, verify, cache)

**Files:**
- Create: `src/run/node/pyCache.ts`, `src/run/pyCache.test.ts`

**Interfaces:**
- Consumes: `src/run/pyManifest.json` (Task 10).
- Produces: `const PAGES_PY = 'https://mbarc.github.io/circuitoon/py/'`; `const NO_LONGER_PUBLISHED = "This plugin's Python runtime is no longer published; update the plugin"`; `function cacheRoot(env?: NodeJS.ProcessEnv): string`; `function ensurePy(o?: { pyDir?: string; cacheDir?: string; fetch?: typeof fetch; base?: string }): Promise<{ dir: string; indexURL: string; lock: string }>` (throws `Error` with a plain message on any failure; the CLI maps it to exit 3).

- [ ] **Step 1: Write the failing test**

`src/run/pyCache.test.ts`:

```ts
// Firmware spec 2.7: the CLI fetches the exact Pyodide files from the project's Pages site once,
// checks each against the sha256 compiled in, and runs offline afterwards; --py-dir is checked the
// same way; a version that is no longer published says so in the spec's words.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PY from './pyManifest.json' with { type: 'json' }
import { NO_LONGER_PUBLISHED, PAGES_PY, ensurePy } from './node/pyCache.ts'

/** A fake Pages site serving node_modules/pyodide; `calls` lists every URL asked for. */
function site(o: { missing?: boolean; tamper?: string } = {}) {
  const calls: string[] = []
  const fetch = (async (url: string) => {
    calls.push(url)
    if (o.missing) return new Response('not found', { status: 404 })
    const name = url.split('/').pop()!
    const bytes = new Uint8Array(readFileSync(join('node_modules/pyodide', name)))
    if (o.tamper === name) bytes[0] ^= 1
    return new Response(bytes, { status: 200 })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('the CLI Python runtime (spec 2.7)', () => {
  it('downloads each file once from the Pages site, then runs offline', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'py-cache-'))
    const s = site()
    const a = await ensurePy({ cacheDir, fetch: s.fetch })
    expect(s.calls).toEqual(PY.files.map((f) => `${PAGES_PY}${PY.version}/${f.name}`))
    expect(a.dir).toBe(join(cacheDir, 'py', PY.version))
    expect(JSON.parse(a.lock).info.python).toBe(PY.python)
    const offline = site({ missing: true })
    await ensurePy({ cacheDir, fetch: offline.fetch })
    expect(offline.calls).toEqual([])
  })
  it('says the runtime is no longer published on a 404', async () => {
    await expect(ensurePy({ cacheDir: mkdtempSync(join(tmpdir(), 'py-cache-')), fetch: site({ missing: true }).fetch })).rejects.toThrow(NO_LONGER_PUBLISHED)
    expect(NO_LONGER_PUBLISHED).toBe("This plugin's Python runtime is no longer published; update the plugin")
  })
  it('refuses a file whose hash differs, and keeps nothing of it', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'py-cache-'))
    await expect(ensurePy({ cacheDir, fetch: site({ tamper: 'pyodide.asm.wasm' }).fetch })).rejects.toThrow(/pyodide\.asm\.wasm does not match this plugin's Pyodide/)
  })
  it('checks --py-dir the same way', async () => {
    expect((await ensurePy({ pyDir: 'node_modules/pyodide' })).dir).toBe('node_modules/pyodide')
    const bad = mkdtempSync(join(tmpdir(), 'py-dir-'))
    writeFileSync(join(bad, 'pyodide.mjs'), 'x')
    await expect(ensurePy({ pyDir: bad })).rejects.toThrow(`is not Pyodide ${PY.version}`)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/pyCache.test.ts`
Expected: FAIL, `./node/pyCache.ts` cannot be found.

- [ ] **Step 3: Write `src/run/node/pyCache.ts`**

```ts
// The CLI's Python runtime (firmware spec 2.7): the plugin does not ship Pyodide. The first
// `circuitoon run` downloads this build's exact files from the project's own Pages site, checks each
// against the sha256 compiled in (pyManifest.json), and keeps them in the user's cache directory;
// later runs are offline. --py-dir uses a local copy, checked the same way. Requests carry nothing
// about the user (Node's default User-Agent).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import PY from '../pyManifest.json' with { type: 'json' }

export const PAGES_PY = 'https://mbarc.github.io/circuitoon/py/'
export const NO_LONGER_PUBLISHED = "This plugin's Python runtime is no longer published; update the plugin"

/** The user's cache directory for Circuitoon (CIRCUITOON_CACHE overrides). */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CIRCUITOON_CACHE) return env.CIRCUITOON_CACHE
  if (process.platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'circuitoon', 'cache')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'circuitoon')
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'circuitoon')
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const good = (dir: string, f: { name: string; sha256: string }) => existsSync(join(dir, f.name)) && sha(readFileSync(join(dir, f.name))) === f.sha256
const ready = (dir: string) => ({ dir, indexURL: dir.endsWith(sep) || dir.endsWith('/') ? dir : `${dir}${sep}`, lock: readFileSync(join(dir, 'pyodide-lock.json'), 'utf8') })

export async function ensurePy(o: { pyDir?: string; cacheDir?: string; fetch?: typeof fetch; base?: string } = {}): Promise<{ dir: string; indexURL: string; lock: string }> {
  if (o.pyDir) {
    const bad = PY.files.filter((f) => !good(o.pyDir!, f)).map((f) => f.name)
    if (bad.length) throw new Error(`--py-dir ${o.pyDir} is not Pyodide ${PY.version}: ${bad.join(', ')} missing or different`)
    return ready(o.pyDir)
  }
  const dir = join(o.cacheDir ?? cacheRoot(), 'py', PY.version)
  mkdirSync(dir, { recursive: true })
  const get = o.fetch ?? fetch
  for (const f of PY.files) {
    if (good(dir, f)) continue
    const url = `${o.base ?? PAGES_PY}${PY.version}/${f.name}`
    let res: Response
    try {
      res = await get(url)
    } catch (e) {
      throw new Error(`could not download ${url} (${e instanceof Error ? e.message : String(e)}); the first run needs the network, or pass --py-dir`)
    }
    if (res.status === 404) throw new Error(NO_LONGER_PUBLISHED)
    if (!res.ok) throw new Error(`could not download ${url} (HTTP ${res.status}); the first run needs the network, or pass --py-dir`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (sha(bytes) !== f.sha256) throw new Error(`${f.name} does not match this plugin's Pyodide ${PY.version} (its sha256 differs); try again later`)
    writeFileSync(join(dir, `${f.name}.part`), bytes)
    renameSync(join(dir, `${f.name}.part`), join(dir, f.name))
  }
  return ready(dir)
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/pyCache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run/node/pyCache.ts src/run/pyCache.test.ts
git commit -m "$(cat <<'MSG'
Run: the CLI's Python runtime: download from Pages once, sha256-checked, cached; --py-dir; no-longer-published message

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: shared-memory protocol and scheduler review (spec 11, after step 3)

A Claude reviewer (Astra after 2026-10-10, through `consult-astra` on a disposable clone) reviews Tasks 12 to 19 as one unit: the memory layout and both seqlocks (single writer per table, the uint32 counters, `writeIn` then wake), the wake-word protocol (no lost wake beyond one 50 ms slice in real time; none in virtual time, where `seen` is read before the block is posted), Stop (interrupt, wake, `checkInterrupt` after every wait, the 1 s terminate), the scheduler's non-reentrancy, the never-pauses signal (`F.lastYieldMs`, `H.pending`), the 200 ms read wait and its virtual-time behaviour, the sandbox (curated `jsglobals`, prototype removal), and the virtual clock's driver contract. Findings are fixed as numbered fix tasks before Phase D; the outcome goes in the ledger.

---

# Phase D: the sampler, run pin states, PWM solves, servos and power (spec 11 step 4)

### Task 20: Reading pins: thresholds, hysteresis, dwell, floating reads and edges

**Files:**
- Create: `src/run/levels.ts`, `src/run/levels.test.ts`
- Modify: `src/format/simState.ts` (`RunPinState`, `RunPins`)

**Interfaces:**
- Consumes: `simOf` (`GpioSpec.inputLow`, `.inputHigh`, Task 6); `Reading` (`src/sim/results.ts`); `PinIn` (Task 12).
- Produces:
  - in `src/format/simState.ts`: `type RunPinState = GpioState | { pwm: number }`; `type RunPins = Record<string, Record<string, RunPinState>>` (part uid, then pin name)
  - `interface Thresholds { low: number; high: number }`; `function thresholdsOf(m: ModuleDef | undefined): Thresholds`
  - `const DWELL_MS = 100`; `function mulberry32(seed: number): () => number`; `function seedOf(text: string): number`
  - `class LevelTracker { constructor(seed: string); update(pin: string, r: Reading | undefined, th: Thresholds, nowMs: number): { row: PinIn; finding: 'undefined-level' | 'floating-read' | null }; check(nowMs: number): string[]; get(pin: string): PinIn | undefined; reset(): void }`

- [ ] **Step 1: Write the failing test**

`src/run/levels.test.ts`:

```ts
// Firmware spec 4.4: input levels thresholded in one shared function. Above inputHigh reads 1, below
// inputLow 0, in between keeps the last level (Schmitt hysteresis) and warns once past 100 ms; a
// floating input reads a random level per result (seeded, ruling R21) and warns once; edges are
// counted from successive levels; the first result sets the level without an edge.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import type { Reading } from '../sim/results.ts'
import { LevelTracker, mulberry32, thresholdsOf } from './levels.ts'

const v = (value: number): Reading => ({ kind: 'value', value, reference: 'GND', trust: 'ok' })
const th = { low: 0.8, high: 2.0 }

describe('reading pins (spec 4.4)', () => {
  it('takes the thresholds from the board data, else 30 and 70 percent of the GPIO domain', () => {
    const pi = thresholdsOf(load('rpi-4-model-b'))
    expect(pi.low).toBeLessThan(pi.high)
    expect(thresholdsOf(undefined)).toEqual({ low: 0.3 * 3.3, high: 0.7 * 3.3 })
  })
  it('applies hysteresis and counts edges, the first result without one', () => {
    const t = new LevelTracker('u1')
    const seq = [0.1, 1.4, 2.5, 1.4, 0.5, 3.0].map((x, i) => t.update('GPIO17', v(x), th, i * 20).row)
    expect(seq.map((r) => r.level)).toEqual([0, 0, 1, 1, 0, 1])
    expect(seq.at(-1)).toMatchObject({ rising: 2, falling: 1, status: 'value', volts: 3.0 })
  })
  it('warns once when a level dwells between the thresholds for more than 100 ms', () => {
    const t = new LevelTracker('u1')
    expect(t.update('GPIO17', v(1.4), th, 0).finding).toBeNull()
    expect(t.update('GPIO17', v(1.4), th, 90).finding).toBeNull()
    expect(t.check(150)).toEqual(['GPIO17'])
    expect(t.update('GPIO17', v(1.4), th, 300).finding).toBeNull()
    expect(t.check(400)).toEqual([])
  })
  it('reads a floating input at random per result, the same way every run, and warns once', () => {
    const a = new LevelTracker('u1')
    const b = new LevelTracker('u1')
    const levels = (t: LevelTracker) => Array.from({ length: 20 }, (_, i) => t.update('GPIO4', { kind: 'floating' }, th, i).row.level)
    const first = levels(a)
    expect(first).toEqual(levels(b))
    expect(new Set(first)).toEqual(new Set([0, 1]))
    const c = new LevelTracker('u1')
    expect(c.update('GPIO4', { kind: 'floating' }, th, 0).finding).toBe('floating-read')
    expect(c.update('GPIO4', { kind: 'floating' }, th, 1).finding).toBeNull()
    expect(c.update('GPIO4', { kind: 'floating' }, th, 1).row.status).toBe('floating')
  })
  it('keeps the level on an undefined reading', () => {
    const t = new LevelTracker('u1')
    t.update('GPIO5', v(3), th, 0)
    expect(t.update('GPIO5', { kind: 'undefined', why: 'not simulated (mains)' }, th, 1).row).toMatchObject({ level: 1, status: 'undefined' })
  })
  it('has a deterministic PRNG', () => {
    const r = mulberry32(42)
    expect([r(), r()]).toEqual([mulberry32(42)(), (() => { const s = mulberry32(42); s(); return s() })()])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/levels.test.ts`
Expected: FAIL, `./levels.ts` cannot be found.

- [ ] **Step 3: The run pin state types**

Append to `src/format/simState.ts`:

```ts
/**
 * A running board's GPIO state for one solve (firmware spec 2.3, 4.1): a saved state's name, or PWM
 * with its duty. Transient, like a held button: passed as BuildOptions.runPins, never saved.
 */
export type RunPinState = GpioState | { pwm: number }
/** Run pin states by part uid, then pin name. */
export type RunPins = Record<string, Record<string, RunPinState>>
```

- [ ] **Step 4: Write `src/run/levels.ts`**

```ts
// Reading pins (firmware spec 4.4), the one function the editor and the CLI share: an input pin's
// solved voltage becomes a level with hysteresis (Pi inputs have Schmitt triggers), edges are counted
// from successive levels (so a press and release while the code sleeps still fire), a level between
// the thresholds for more than 100 ms warns once (`undefined-level`), and a floating input reads a
// random level per result (seeded from the board, ruling R21) and warns once (`floating-read`).
import type { ModuleDef } from '../format/module.ts'
import { simOf } from '../format/simModel.ts'
import type { Reading } from '../sim/results.ts'
import type { PinIn } from './memory.ts'

export interface Thresholds { low: number; high: number }
export const DWELL_MS = 100

/** inputLow and inputHigh from the board's data; without them, 30 and 70 percent of its GPIO domain (a generic CMOS estimate). */
export function thresholdsOf(m: ModuleDef | undefined): Thresholds {
  const sim = simOf(m)
  const g = sim?.gpio
  const nominal = sim?.power?.domains.find((d) => d.name === g?.domain)?.nominal ?? 3.3
  return { low: g?.inputLow?.value ?? 0.3 * nominal, high: g?.inputHigh?.value ?? 0.7 * nominal }
}

/** A small, seeded PRNG (mulberry32): the same run reads the same floating levels. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export class LevelTracker {
  private rows = new Map<string, PinIn>()
  private since = new Map<string, number>()
  private warned = new Set<string>()
  private rand: () => number
  private seed: string

  constructor(seed: string) {
    this.seed = seed
    this.rand = mulberry32(seedOf(seed))
  }

  /** One solved reading of one input pin at run time `nowMs`. */
  update(pin: string, r: Reading | undefined, th: Thresholds, nowMs: number): { row: PinIn; finding: 'undefined-level' | 'floating-read' | null } {
    const prev = this.rows.get(pin)
    let level: 0 | 1 = prev?.level ?? 0
    let status: PinIn['status'] = 'value'
    let volts = Number.NaN
    let finding: 'undefined-level' | 'floating-read' | null = null
    if (!r || r.kind === 'floating') {
      status = 'floating'
      level = this.rand() < 0.5 ? 0 : 1
      this.since.delete(pin)
      if (!this.warned.has(`f|${pin}`)) {
        this.warned.add(`f|${pin}`)
        finding = 'floating-read'
      }
    } else if (r.kind === 'undefined') {
      status = 'undefined'
      this.since.delete(pin)
    } else {
      volts = r.value
      if (volts >= th.high) level = 1
      else if (volts <= th.low) level = 0
      if (volts > th.low && volts < th.high) {
        if (!this.since.has(pin)) this.since.set(pin, nowMs)
      } else this.since.delete(pin)
    }
    // The first result sets the level; edges count from then on.
    const row: PinIn = {
      level, status, volts,
      rising: (prev?.rising ?? 0) + (prev && level === 1 && prev.level === 0 ? 1 : 0),
      falling: (prev?.falling ?? 0) + (prev && level === 0 && prev.level === 1 ? 1 : 0),
    }
    this.rows.set(pin, row)
    return { row, finding }
  }

  /** Pins that have now dwelt between the thresholds for more than 100 ms: each named once per run. */
  check(nowMs: number): string[] {
    const out: string[] = []
    for (const [pin, t] of this.since)
      if (nowMs - t > DWELL_MS && !this.warned.has(`u|${pin}`)) {
        this.warned.add(`u|${pin}`)
        out.push(pin)
      }
    return out
  }

  /** A pin's last row (its voltage names the undefined-level warning). */
  get(pin: string): PinIn | undefined {
    return this.rows.get(pin)
  }

  /** A new run: levels, edges and warnings start over, and the PRNG restarts. */
  reset(): void {
    this.rows.clear()
    this.since.clear()
    this.warned.clear()
    this.rand = mulberry32(seedOf(this.seed))
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run/levels.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/format/simState.ts src/run/levels.ts src/run/levels.test.ts
git commit -m "$(cat <<'MSG'
Run: reading pins (thresholds with hysteresis, the 100 ms dwell warning, seeded floating reads, edge counters)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 21: The sampler

**Files:**
- Create: `src/run/sampler.ts`, `src/run/sampler.test.ts`

**Interfaces:**
- Consumes: `readAllOut` (returns `{ rows, codeSeq }` from one locked read), `MODE`, `BoardMemory` (Task 12); `gpioPin` (Task 12); `RunPinState` (Task 20); `makeHw` (Task 13, for the test).
- Produces:
  - `const PWM_MIN_HZ = 50`, `const WINDOW_MS = 100`, `const DUTY_STEP = 1 / 64`
  - `function quantize(prev: number | null, duty: number): number`
  - `interface SampledPin { state: RunPinState; duty: number | null; freqHz: number | null }`
  - `class BoardSampler { sample(m: BoardMemory, nowMs: number): { pins: Record<string, RunPinState>; detail: Record<string, SampledPin>; seq: number }; reset(): void }`

- [ ] **Step 1: Write the failing test**

`src/run/sampler.test.ts`:

```ts
// Firmware spec 2.3: a pin table becomes run pin states. Declared PWM is used as declared (duty 0 or
// 1 as low or high); a plain output toggling at 50 Hz or faster (10 edges in the fixed 100 ms window)
// is PWM with duty = high time / window, anything slower shows its latch, so 1 Hz and 10 Hz blinks
// stay on and off and 200 Hz is averaged; duty is quantised to 1/64 and moves only past a step.
import { describe, expect, it } from 'vitest'
import { makeHw, type RunClock } from './bridge.ts'
import { H, MODE, boardMemory, setOut, writeLocked } from './memory.ts'
import { BoardSampler, DUTY_STEP, quantize } from './sampler.ts'

/**
 * Drives GPIO17 as a square wave through the real write path in 50 us steps (whole steps per period,
 * so the duty is exact); samples every 16 ms; returns each sample's state. With samples every 16 ms
 * the window's base is 112 ms back.
 */
function squareWave(hz: number, duty: number, ms: number) {
  const m = boardMemory()
  const clock: RunClock & { t: number } = { t: 0, epochMs: 0, now: () => clock.t, block() {}, poll() {} }
  const hw = makeHw(m, clock, { board: 'pi4', onPrompt() {}, flush() {} })
  hw.setup(17, MODE.output)
  const s = new BoardSampler()
  const states: unknown[] = []
  const period = Math.round(1000 / hz / 0.05)
  const high = Math.round(period * duty)
  for (let step = 0; step * 0.05 <= ms; step++) {
    clock.t = step * 0.05
    hw.output(17, step % period < high ? 1 : 0)
    if (step % 320 === 0) states.push(s.sample(m, clock.t).pins.GPIO17)
  }
  return states
}

describe('the sampler (spec 2.3)', () => {
  it('shows a 1 Hz blink as on and off, never averaged', () => {
    const st = squareWave(1, 0.5, 2000)
    expect(new Set(st.map((x) => JSON.stringify(x)))).toEqual(new Set(['"high"', '"low"']))
  })
  it('shows a 10 Hz blink as on and off too (2 edges per window, under 10)', () => {
    expect(squareWave(10, 0.5, 1000).every((x) => x === 'high' || x === 'low')).toBe(true)
  })
  it('averages 200 Hz into PWM once a full window has passed, within a duty step', () => {
    const st = squareWave(200, 0.5, 1000).slice(8) as { pwm: number }[]
    expect(st.every((x) => typeof x === 'object' && Math.abs(x.pwm - 0.5) <= DUTY_STEP)).toBe(true)
  })
  it('measures duty exactly when the window holds whole periods (250 Hz: 28 in 112 ms)', () => {
    const st = squareWave(250, 0.25, 1000)
    expect(st.slice(8)).toEqual(st.slice(8).map(() => ({ pwm: 0.25 })))
  })
  it('uses a declared PWM descriptor as declared, and duty 0 or 1 as low or high', () => {
    const m = boardMemory()
    const s = new BoardSampler()
    const set = (duty: number) => writeLocked(m, H.outSeq, () => setOut(m, 18, { mode: MODE.output, pwmActive: true, duty, freq: 50 }))
    set(0.3)
    expect(s.sample(m, 0).pins.GPIO18).toEqual({ pwm: Math.round(0.3 / DUTY_STEP) * DUTY_STEP })
    expect(s.sample(m, 16).detail.GPIO18).toMatchObject({ freqHz: 50 })
    set(0)
    expect(s.sample(m, 32).pins.GPIO18).toBe('low')
    set(1)
    expect(s.sample(m, 48).pins.GPIO18).toBe('high')
  })
  it('quantises duty to 1/64 and moves only past a step', () => {
    expect(quantize(null, 0.505)).toBe(0.5)
    expect(quantize(0.5, 0.51)).toBe(0.5)
    expect(quantize(0.5, 0.52)).toBe(33 / 64)
  })
  it('names input modes, leaves unused pins out, and reports the code sequence', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => {
      setOut(m, 27, { mode: MODE.pullup })
      setOut(m, 22, { mode: MODE.pulldown })
      setOut(m, 4, { mode: MODE.input })
    })
    Atomics.store(m.i32, H.codeSeq, 7)
    const r = new BoardSampler().sample(m, 0)
    expect(r.pins).toEqual({ GPIO4: 'input', GPIO22: 'input-pulldown', GPIO27: 'input-pullup' })
    expect(r.seq).toBe(7)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/sampler.test.ts`
Expected: FAIL, `./sampler.ts` cannot be found.

- [ ] **Step 3: Write `src/run/sampler.ts`**

```ts
// The sampler (firmware spec 2.3), shared by the editor and the CLI: one board's pin table becomes
// run pin states. Declared PWM (RPi.GPIO.PWM, gpiozero's PWM devices) is used as declared; a plain
// output that toggles at PWM_MIN_HZ (flicker fusion) or faster over a fixed 100 ms window becomes PWM
// with duty = high time / window; slower toggling shows the latch at the sample, so a visible blink
// stays a blink. Duty is quantised to 1/64 and only moves past a step, so jitter never re-solves.
import type { RunPinState } from '../format/simState.ts'
import { gpioPin } from './boards.ts'
import { type BoardMemory, MODE, NPINS, readAllOut } from './memory.ts'

export const PWM_MIN_HZ = 50
export const WINDOW_MS = 100
export const DUTY_STEP = 1 / 64
const INPUT_STATE: Record<number, RunPinState> = { [MODE.input]: 'input', [MODE.pullup]: 'input-pullup', [MODE.pulldown]: 'input-pulldown' }

export function quantize(prev: number | null, duty: number): number {
  const q = Math.round(duty / DUTY_STEP) * DUTY_STEP
  return prev === null || Math.abs(duty - prev) >= DUTY_STEP ? q : prev
}

/** One pin as sampled: its state, and the duty and frequency behind it (the servo model reads them, ruling R23). */
export interface SampledPin { state: RunPinState; duty: number | null; freqHz: number | null }
interface Point { tMs: number; rising: number; falling: number; highUs: number }

const asState = (d: number): RunPinState => (d <= 0 ? 'low' : d >= 1 ? 'high' : { pwm: d })

export class BoardSampler {
  private history = new Map<number, Point[]>()
  private duty = new Map<number, number>()

  /** The board's pins at run time `nowMs` (its own clock). Unused pins are left out: their saved states apply. */
  sample(m: BoardMemory, nowMs: number): { pins: Record<string, RunPinState>; detail: Record<string, SampledPin>; seq: number } {
    // One snapshot: the code sequence numbers exactly these modes (never read it separately).
    const { rows, codeSeq: seq } = readAllOut(m)
    const nowUs = Math.round(nowMs * 1000) >>> 0
    const pins: Record<string, RunPinState> = {}
    const detail: Record<string, SampledPin> = {}
    for (let bcm = 0; bcm < NPINS; bcm++) {
      const r = rows[bcm]
      const name = gpioPin(bcm)
      if (r.mode !== MODE.output) {
        this.history.delete(bcm)
        this.duty.delete(bcm)
        if (r.mode !== MODE.unused) detail[name] = { state: (pins[name] = INPUT_STATE[r.mode]), duty: null, freqHz: null }
        continue
      }
      if (r.pwmActive) {
        this.history.delete(bcm)
        const d = quantize(this.duty.get(bcm) ?? null, r.duty)
        this.duty.set(bcm, d)
        detail[name] = { state: (pins[name] = asState(d)), duty: r.duty, freqHz: r.freq }
        continue
      }
      // A plain output: the bit-bang window (high time counts the current high stretch too).
      const high = (r.highUs + (r.latch ? (nowUs - r.changedUs) >>> 0 : 0)) >>> 0
      const hist = this.history.get(bcm) ?? []
      hist.push({ tMs: nowMs, rising: r.rising, falling: r.falling, highUs: high })
      // Keep the window and the newest point at least a window old (the base).
      while (hist.length > 2 && hist[1].tMs <= nowMs - WINDOW_MS) hist.shift()
      this.history.set(bcm, hist)
      const base = hist[0].tMs <= nowMs - WINDOW_MS ? hist[0] : null
      const latch: RunPinState = r.latch ? 'high' : 'low'
      if (!base) {
        detail[name] = { state: (pins[name] = latch), duty: null, freqHz: null }
        continue
      }
      const span = nowMs - base.tMs
      const edges = ((r.rising - base.rising) >>> 0) + ((r.falling - base.falling) >>> 0)
      if (edges < ((PWM_MIN_HZ * 2 * span) / 1000) - 1e-9) {
        this.duty.delete(bcm)
        detail[name] = { state: (pins[name] = latch), duty: null, freqHz: null }
        continue
      }
      const raw = ((high - base.highUs) >>> 0) / 1000 / span
      const d = quantize(this.duty.get(bcm) ?? null, raw)
      this.duty.set(bcm, d)
      detail[name] = { state: (pins[name] = asState(d)), duty: raw, freqHz: edges / 2 / (span / 1000) }
    }
    return { pins, detail, seq }
  }

  /** A new run. */
  reset(): void {
    this.history.clear()
    this.duty.clear()
  }
}
```

The tests sample every 16 ms (320 steps of 0.05 ms), so a sample a window old exists from the eighth sample on; `slice(8)` checks those.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/sampler.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run/sampler.ts src/run/sampler.test.ts
git commit -m "$(cat <<'MSG'
Run: the sampler (declared PWM, the 100 ms bit-bang window at 50 Hz, 1/64 duty with hysteresis)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 22: Run pin states in the build (`BuildOptions.runPins`, `pwm` pins, `Analysis.pins`)

**Files:**
- Create: `src/sim/runPins.test.ts`
- Modify: `src/sim/model.ts` (`GpioDevice.state` `'pwm'` and `duty`, `GpioPin.state`, `Analysis.pins`, `gpioBranch`), `src/sim/build.ts` (`BuildOptions.runPins`, `Builder.runPin`), `src/sim/power.ts` (the GPIO loop), `src/sim/floating.ts` (`resistive`), `src/sim/spice.ts` (`gpioBranch(d, a.pins)`), `src/sim/findings.ts` (`ioTotalCurrent` counts PWM pins)

**Interfaces:**
- Consumes: `RunPinState`, `RunPins` (Task 20); `boardModule`, `cellModule`, `sheet` (`testing.ts`).
- Produces:
  - `BuildOptions.runPins?: RunPins`; `Builder.runPin(uid: string, pin: string): RunPinState | undefined`
  - `GpioDevice.state: GpioState | 'pwm'`, `GpioDevice.duty?: number`; `GpioPin.state: GpioState | 'pwm' | null`
  - `type Analysis = { kind: 'op'; corner: Corner; pins?: Record<string, 'high' | 'low'> }` (device id to level)
  - `function gpioBranch(d: GpioDevice, pins?: Analysis['pins']): { a: string; b: string; ohms: Param; leak: boolean } | null` (a `pwm` pin takes the level `pins` gives, high when absent)
  - for classification a `pwm` pin conducts both ways (to its domain and its return), so it is driven exactly as at either level (spec 4.2)

- [ ] **Step 1: Write the failing test**

`src/sim/runPins.test.ts`:

```ts
// Firmware spec 4.1 and 4.2: a running board's run pin states override its saved GPIO states for the
// solve, transiently (the sheet is untouched); a PWM pin is a GPIO device in state `pwm` that each
// analysis compiles at the level `Analysis.pins` gives; classification treats it as driven at both
// levels, so classifyCached stays per analysis kind.
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { compile } from './spice.ts'
import { boardModule, cellModule, sheet } from './testing.ts'

const d = sheet(
  [{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high' } }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 1000, unit: 'ohm' } } }],
  [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']],
)
const gpio = (c: ReturnType<typeof buildCircuit>, pin: string) => c.devices.find((x) => x.kind === 'gpio' && x.pin === pin)

describe('run pin states in the build (spec 4.1, 4.2)', () => {
  it('overrides the saved state for the solve and leaves the sheet as it was', () => {
    const before = JSON.stringify(d)
    expect(gpio(buildCircuit(d, { runPins: { u1: { IO1: 'low' } } }), 'IO1')).toMatchObject({ state: 'low' })
    expect(gpio(buildCircuit(d), 'IO1')).toMatchObject({ state: 'high' })
    expect(JSON.stringify(d)).toBe(before)
  })
  it('builds a PWM pin with its duty, driven like a high or low pin', () => {
    const c = buildCircuit(d, { runPins: { u1: { IO1: { pwm: 0.3 } } } })
    expect(gpio(c, 'IO1')).toMatchObject({ state: 'pwm', duty: 0.3 })
    expect(c.gpio.find((g) => g.pin === 'IO1')?.state).toBe('pwm')
    expect(classify(c).driven.has('u1:IO1')).toBe(true)
  })
  it('compiles a PWM pin at the level each analysis gives, high when none', () => {
    const c = buildCircuit(d, { runPins: { u1: { IO1: { pwm: 0.3 } } } })
    const cls = classify(c)
    const text = (pins?: Record<string, 'high' | 'low'>) => compile(c, cls, { kind: 'op', corner: 'typical', ...(pins ? { pins } : {}) }).text
    const line = (t: string) => t.split('\n').find((l) => l.startsWith('r_u1_gpio_io1'))!
    const high = buildCircuit(d, { runPins: { u1: { IO1: 'high' } } })
    const low = buildCircuit(d, { runPins: { u1: { IO1: 'low' } } })
    expect(line(text())).toBe(line(compile(high, classify(high), { kind: 'op', corner: 'typical' }).text))
    expect(line(text({ 'u1.gpio.IO1': 'low' }))).toBe(line(compile(low, classify(low), { kind: 'op', corner: 'typical' }).text))
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/runPins.test.ts`
Expected: FAIL: the first test still builds `high` (`runPins` is ignored).

- [ ] **Step 3: The model**

In `src/sim/model.ts`:
- `import type { GpioState } from '../format/simState.ts'` stays;
- `export type Analysis = { kind: 'op'; corner: Corner; pins?: Record<string, 'high' | 'low'> }` with the doc line: `` `pins`: the level of each PWM GPIO device (by id) in this run (firmware spec 4.2); a PWM pin not named is high. ``
- in `GpioDevice`, `state: GpioState | 'pwm'` and add `duty?: number` (the comment: `` `pwm`: a running board's PWM pin (firmware spec 4.2); `duty` its quantised duty ``);
- `GpioPin.state: GpioState | 'pwm' | null`;
- replace `gpioBranch`:

```ts
export function gpioBranch(d: GpioDevice, pins?: Analysis['pins']): { a: string; b: string; ohms: Param; leak: boolean } | null {
  const p = d.params
  // A PWM pin (firmware spec 4.2) is high or low in each run, as the analysis says.
  const state = d.state === 'pwm' ? (pins?.[d.id] ?? 'high') : d.state
  if (state === 'high') return { a: d.vdd, b: d.node, ohms: p.outputResistance, leak: false }
  if (state === 'low') return { a: d.node, b: d.ret, ohms: p.outputResistance, leak: false }
  if (state === 'input-pullup' && p.pullup) return { a: d.vdd, b: d.node, ohms: p.pullup, leak: false }
  if (state === 'input-pulldown' && p.pulldown) return { a: d.node, b: d.ret, ohms: p.pulldown, leak: false }
  return p.leakage ? { a: d.node, b: d.ret, ohms: p.leakage, leak: true } : null
}
```

In `src/sim/floating.ts` `resistive`, before the `gpioBranch` line:

```ts
  // A PWM pin is high in some runs and low in others: it conducts both ways for classification, so
  // the classification is the same at both levels (firmware spec 4.2).
  if (d.kind === 'gpio' && d.state === 'pwm') return [[d.vdd, d.node], [d.node, d.ret]]
```

In `src/sim/spice.ts` `devEls`, the gpio case uses `gpioBranch(d, a.pins)`.

In `src/sim/findings.ts` `measure`, the `ioTotalCurrent` filter becomes `(g.state === 'high' || g.state === 'low' || g.state === 'pwm')`.

- [ ] **Step 4: The build**

In `src/sim/build.ts`:
- import `type RunPins, type RunPinState` from `'../format/simState.ts'`;
- `BuildOptions` gains:
  ```ts
    /** A running board's GPIO states (firmware spec 2.3, 4.1): transient, like `held`; never saved. */
    runPins?: RunPins
  ```
- `Builder` gains `runPin(uid: string, pin: string): RunPinState | undefined { return this.opts.runPins?.[uid]?.[pin] }`.

In `src/sim/power.ts` `powerPart`, at the top of the `for (const pin of g.pins)` loop, replace `const state = gpioState(p, m, pin)` with:

```ts
      // A running board's state wins over the saved one (spec 4.1); a PWM pin keeps its duty.
      const run = b.runPin(p.uid, pin)
      const state = run === undefined ? gpioState(p, m, pin) : typeof run === 'string' ? run : 'pwm'
      const duty = run !== undefined && typeof run !== 'string' ? run.pwm : undefined
```

and in the `b.add({ kind: 'gpio', ... })` object add `...(duty !== undefined ? { duty } : {})` after `state`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/sim && npx tsc --noEmit`
Expected: PASS (every existing simulator test too: no sheet passes `runPins`), and the types check: anything that switches over a GPIO state (the editor included) handles `pwm`.

- [ ] **Step 6: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add src/sim/model.ts src/sim/build.ts src/sim/power.ts src/sim/floating.ts src/sim/spice.ts src/sim/findings.ts src/sim/runPins.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Sim: run pin states override saved GPIO states for a solve; PWM pins compile per run from Analysis.pins

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 23: PWM groups, the run plan and the weights (ruling R1)

**Files:**
- Create: `src/sim/pwm.ts`, `src/sim/pwm.test.ts`

**Interfaces:**
- Consumes: Task 22 (`pwm` devices, `Analysis.pins`); `dcEdges` (`floating.ts`); `RawRun` (`spice.ts`); `makeEngine`, `createNodeEngineHost` (the test).
- Produces:
  - `interface PwmPin { id: string; part: string; pin: string; duty: number }`
  - `const EXACT_MAX = 3`
  - `function pwmGroups(c: Circuit): PwmPin[][]`
  - `interface PwmPlan { pins: PwmPin[]; groups: PwmPin[][]; runs: Record<string, 'high' | 'low'>[]; weights: number[]; approximate: PwmPin[][]; peak: [Record<string, 'high' | 'low'>, Record<string, 'high' | 'low'>] }` (run 0 is the baseline; `peak` is all high, then all low)
  - `function pwmPlan(c: Circuit): PwmPlan | null` (null with no PWM pin)
  - `function mixRaws(raws: RawRun[], weights: number[]): RawRun` (a value missing or not finite in any run is NaN)

- [ ] **Step 1: Write the failing test**

`src/sim/pwm.test.ts`:

```ts
// Firmware spec 4.2 and ruling R1: PWM pins split into groups that interact through anything but the
// supply and ground nets; one baseline run, plus each exact group's other combinations (weights: the
// product of d or 1 - d) and one flip per pin of a superposition group (weight |d - round(d)|); the
// average is X0 + sum of w (X - X0). Exact for separate groups; superposition is exact for a linear
// circuit, checked against all 16 combinations of 4 pins summed through separate resistors.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { mixRaws, pwmGroups, pwmPlan } from './pwm.ts'
import { type PartSpec, boardModule, cellModule, sheet } from './testing.ts'

/** A board with IO1..IOn; `wiring` adds parts and wires on its pins. */
function boardWith(n: number, parts: PartSpec[], wires: [string, string][]) {
  const b = boardModule({}, 'test-pwm-board')
  const pins = Array.from({ length: n }, (_, i) => `IO${i + 1}`)
  const e = b.electrical as { sim: { gpio: { pins: string[] } } }
  e.sim.gpio.pins = pins
  b.pins = [...b.pins.filter((p) => !('name' in p) || !/^IO\d+$/.test(p.name)), ...pins.map((name, i) => ({ name, side: (i % 2 ? 'right' : 'left') as 'left' | 'right', type: 'io' as const }))]
  ;(e.sim as { limits?: unknown[] }).limits = []
  return sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: b }, ...parts], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])
}
const ohm = (uid: string, v: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: v, unit: 'ohm' } } })
const pwm = (duties: number[]): RunPins => ({ u1: Object.fromEntries(duties.map((d, i) => [`IO${i + 1}`, { pwm: d }])) })

describe('PWM groups and plans (spec 4.2, ruling R1)', () => {
  it('keeps pins that only share ground in separate groups, and joins pins that share a resistor', () => {
    const sep = boardWith(3, [ohm('r1', 330), ohm('r2', 330), ohm('r3', 330)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND'], ['u1.IO2', 'r2.1'], ['r2.2', 'u1.GND'], ['u1.IO3', 'r3.1'], ['r3.2', 'u1.GND']])
    expect(pwmGroups(buildCircuit(sep, { runPins: pwm([0.5, 0.5, 0.5]) })).map((g) => g.length)).toEqual([1, 1, 1])
    const shared = boardWith(3, [ohm('r1', 100), ohm('r2', 100), ohm('r3', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['r3.2', 'rc.1'], ['rc.2', 'u1.GND']])
    expect(pwmGroups(buildCircuit(shared, { runPins: pwm([0.5, 0.5, 0.5]) })).map((g) => g.length)).toEqual([3])
  })
  it('plans one baseline plus a run per other combination, with weights summing to 1', () => {
    const d = boardWith(2, [ohm('r1', 330), ohm('r2', 330)], [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND'], ['u1.IO2', 'r2.1'], ['r2.2', 'u1.GND']])
    const p = pwmPlan(buildCircuit(d, { runPins: pwm([0.5, 0.1]) }))!
    expect(p.runs).toEqual([{ 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'low' }, { 'u1.gpio.IO1': 'high', 'u1.gpio.IO2': 'low' }, { 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'high' }])
    expect(p.weights.map((w) => Number(w.toFixed(6)))).toEqual([0.4, 0.5, 0.1])
    expect(p.approximate).toEqual([])
    expect(p.peak).toEqual([{ 'u1.gpio.IO1': 'high', 'u1.gpio.IO2': 'high' }, { 'u1.gpio.IO1': 'low', 'u1.gpio.IO2': 'low' }])
    expect(pwmPlan(buildCircuit(d))).toBeNull()
  })
  it('enumerates a group of 3 exactly (8 typical runs), and marks it approximate (ruling R6)', () => {
    const d = boardWith(3, [ohm('r1', 100), ohm('r2', 100), ohm('r3', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['r3.2', 'rc.1'], ['rc.2', 'u1.GND']])
    const p = pwmPlan(buildCircuit(d, { runPins: pwm([0.2, 0.5, 0.7]) }))!
    expect(p.runs).toHaveLength(8)
    expect(p.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12)
    expect(p.approximate.map((g) => g.length)).toEqual([3])
  })
  it('mixes raw runs by weight, and a missing value is NaN', () => {
    const m = mixRaws([{ v: { a: 1, b: 2 }, pins: { u: { p: 1 } }, dev: { x: 4 } }, { v: { a: 3 }, pins: { u: { p: 3 } }, dev: { x: 8 } }], [0.25, 0.75])
    expect(m.v.a).toBe(2.5)
    expect(m.v.b).toBeNaN()
    expect([m.pins.u.p, m.dev.x]).toEqual([2.5, 7])
  })
})

describe('superposition against the exact result (spec 4.2)', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('matches all 16 combinations for 4 pins summed through separate resistors', async () => {
    const d = boardWith(4, [ohm('r1', 1000), ohm('r2', 2000), ohm('r3', 4000), ohm('r4', 8000), ohm('rs', 1000)],
      [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['u1.IO3', 'r3.1'], ['u1.IO4', 'r4.1'], ['r1.2', 'rs.1'], ['r2.2', 'rs.1'], ['r3.2', 'rs.1'], ['r4.2', 'rs.1'], ['rs.2', 'u1.GND']])
    const duties = [0.2, 0.45, 0.6, 0.9]
    const c = buildCircuit(d, { runPins: pwm(duties) })
    const p = pwmPlan(c)!
    expect(p.runs).toHaveLength(5)
    const runs = await engine.runAll(c, p.runs.map((pins) => ({ kind: 'op', corner: 'typical', pins })), 1)
    const avg = mixRaws(runs.map((r) => (r.status === 'ok' ? r.raw : { v: {}, pins: {}, dev: {} })), p.weights)
    const ids = duties.map((_, i) => `u1.gpio.IO${i + 1}`)
    let exact = 0
    for (let k = 0; k < 16; k++) {
      const pins = Object.fromEntries(ids.map((id, i) => [id, (k >> i) & 1 ? 'high' : 'low'])) as Record<string, 'high' | 'low'>
      const w = duties.reduce((acc, dd, i) => acc * ((k >> i) & 1 ? dd : 1 - dd), 1)
      const [r] = await engine.runAll(c, [{ kind: 'op', corner: 'typical', pins }], 2)
      if (r.status !== 'ok') throw new Error('solve failed')
      exact += w * r.raw.v['net:R1_2']
    }
    expect(avg.v['net:R1_2']).toBeCloseTo(exact, 4)
    expect(p.approximate.map((g) => g.length)).toEqual([4])
  }, 120_000)
})
```

The summing node's net name comes from `sheetNets` (`R1_2` for the net the four resistors share, named after its first component pin). If the build names it differently, read `c.taps.find((t) => t.part === 'rs' && t.pin === '1')!.net` and use `netNode` of it in both places instead of the literal.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/pwm.test.ts`
Expected: FAIL, `./pwm.ts` cannot be found.

- [ ] **Step 3: Write `src/sim/pwm.ts`**

```ts
// PWM solves (firmware spec 4.2, plan ruling R1). PWM pins split into groups that interact (joined
// through anything other than the supply and ground nets: domain pins and returns, cell terminals).
// One baseline run sets every exact group (k <= 3 pins) all low and every larger group's pins to
// round(duty); each exact group adds a run per other combination c (weight: the product of d or
// 1 - d), each larger group one run per pin with that pin flipped (weight |d - round(d)|:
// superposition). Any reading's average is X0 + sum over runs v of w_v (X_v - X0), so the weights are
// those, with run 0 taking 1 - their sum. Exact for one group, and for groups that only share a stiff
// supply; superposition is exact for a linear group. Pure.
import { dcEdges } from './floating.ts'
import { type Circuit, type GpioDevice, netNode } from './model.ts'
import type { RawRun } from './spice.ts'

export interface PwmPin { id: string; part: string; pin: string; duty: number }
export interface PwmPlan {
  pins: PwmPin[]
  groups: PwmPin[][]
  /** Run 0 is the baseline. Each run sets every PWM pin (by device id) high or low. */
  runs: Record<string, 'high' | 'low'>[]
  /** Any reading's average is the sum of weights[r] times its value in run r. */
  weights: number[]
  /** Groups whose average assumes their pins' cycles overlap at random (ruling R6). */
  approximate: PwmPin[][]
  /** The peak corner (spec 4.2): every PWM pin high, then every PWM pin low. */
  peak: [Record<string, 'high' | 'low'>, Record<string, 'high' | 'low'>]
}
export const EXACT_MAX = 3

const pwmPins = (c: Circuit): PwmPin[] =>
  c.devices.filter((d): d is GpioDevice => d.kind === 'gpio' && d.state === 'pwm').map((d) => ({ id: d.id, part: d.part, pin: d.pin, duty: d.duty ?? 0.5 }))

export function pwmGroups(c: Circuit): PwmPin[][] {
  const pins = pwmPins(c)
  if (!pins.length) return []
  // Cut: the supply and ground nets, and the supply pins themselves.
  const tapNet = new Map(c.taps.map((t) => [t.node, netNode(t.net)]))
  const cut = new Set<string>()
  const supply = (node: string) => {
    cut.add(node)
    const net = tapNet.get(node)
    if (net) cut.add(net)
  }
  for (const dom of c.domains) supply(dom.pin), supply(dom.ret)
  for (const d of c.devices) if (d.kind === 'cell') supply(d.p), supply(d.n)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const join = (a: string, b: string) => {
    if (cut.has(a) || cut.has(b)) return
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const t of c.taps) join(t.node, netNode(t.net))
  for (const d of c.devices) if (d.kind !== 'gpio' && d.kind !== 'load' && d.kind !== 'rail' && d.kind !== 'cell') for (const [a, b] of dcEdges(d)) join(a, b)
  const byRoot = new Map<string, PwmPin[]>()
  for (const p of pins) {
    const dev = c.devices.find((d) => d.id === p.id) as GpioDevice
    const root = find(dev.node)
    byRoot.set(root, [...(byRoot.get(root) ?? []), p])
  }
  return [...byRoot.values()]
}

export function pwmPlan(c: Circuit): PwmPlan | null {
  const pins = pwmPins(c)
  if (!pins.length) return null
  const groups = pwmGroups(c)
  const base: Record<string, 'high' | 'low'> = {}
  for (const g of groups) for (const p of g) base[p.id] = g.length > EXACT_MAX && p.duty >= 0.5 ? 'high' : 'low'
  const runs = [base]
  const weights = [1]
  for (const g of groups) {
    if (g.length <= EXACT_MAX) {
      for (let k = 1; k < 1 << g.length; k++) {
        const run = { ...base }
        let w = 1
        g.forEach((p, i) => {
          const hi = (k >> i) & 1
          run[p.id] = hi ? 'high' : 'low'
          w *= hi ? p.duty : 1 - p.duty
        })
        runs.push(run)
        weights.push(w)
      }
    } else
      for (const p of g) {
        runs.push({ ...base, [p.id]: base[p.id] === 'high' ? 'low' : 'high' })
        weights.push(Math.abs(p.duty - (base[p.id] === 'high' ? 1 : 0)))
      }
  }
  weights[0] = 1 - weights.slice(1).reduce((s, w) => s + w, 0)
  const all = (level: 'high' | 'low') => Object.fromEntries(pins.map((p) => [p.id, level])) as Record<string, 'high' | 'low'>
  return { pins, groups, runs, weights, approximate: groups.filter((g) => g.length > 1), peak: [all('high'), all('low')] }
}

/** The weighted sum of raw runs (the duty-weighted average). A value missing or not finite in any run is NaN. */
export function mixRaws(raws: RawRun[], weights: number[]): RawRun {
  const mix = (get: (r: RawRun) => number | undefined) => {
    let s = 0
    for (const [i, r] of raws.entries()) {
      const x = get(r)
      if (x === undefined || !Number.isFinite(x)) return Number.NaN
      s += weights[i] * x
    }
    return s
  }
  const keys = (pick: (r: RawRun) => Record<string, unknown>) => [...new Set(raws.flatMap((r) => Object.keys(pick(r))))]
  const out: RawRun = { v: {}, pins: {}, dev: {} }
  for (const k of keys((r) => r.v)) out.v[k] = mix((r) => r.v[k])
  for (const k of keys((r) => r.dev)) out.dev[k] = mix((r) => r.dev[k])
  for (const part of keys((r) => r.pins)) {
    out.pins[part] = {}
    for (const pin of [...new Set(raws.flatMap((r) => Object.keys(r.pins[part] ?? {})))]) out.pins[part][pin] = mix((r) => r.pins[part]?.[pin])
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/pwm.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/pwm.ts src/sim/pwm.test.ts
git commit -m "$(cat <<'MSG'
Sim: PWM groups and run plans (exact groups up to 3 pins, superposition beyond, one baseline across groups)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 24: Solving with PWM: averaged readings, the union of findings, `pwm-approximate`

**Files:**
- Create: `src/sim/solvePwm.test.ts`
- Modify: `src/sim/session.ts` (`solve`), `src/sim/findings.ts` (`Draft.worse`, `analyseRuns`), `src/sim/results.ts` (`SimCode` `'pwm-approximate'`, `SimResult.pwm`), `src/sim/display.ts` (`SIM_TITLES`)

**Interfaces:**
- Consumes: Task 23 (`pwmPlan`, `mixRaws`, `PwmPlan`); `runDrafts`, `topologyFindings`, `finalize`, `propagate` (existing).
- Produces:
  - `Draft.worse?: number` (how far past its limit a reading is; larger is worse)
  - `function analyseRuns(c: Circuit, cls: Classification, runs: Record<Corner, RawRun[]>, topo?: ReturnType<typeof topologyFindings>, plan?: PwmPlan | null): { findings: SimFinding[]; outside: Outside }`; `analyseFindings(c, cls, raws, topo)` keeps its signature and calls it
  - `SimCode` gains `'pwm-approximate'` (a note); `SIM_TITLES['pwm-approximate'] = 'PWM average is approximate'`
  - `SimResult.pwm?: { pins: { part: string; pin: string; duty: number }[]; runs: number; approximate: boolean }` (present when the solve had a PWM pin)
  - readings, glow and budget come from the duty-weighted average of the typical runs; the peak readings are the all-high run

- [ ] **Step 1: Write the failing test**

`src/sim/solvePwm.test.ts`:

```ts
// Firmware spec 4.2: with PWM pins a solve sends one text per run in one runAll; readings and LED glow
// are the duty-weighted average; findings are the union over every run, deduplicated by key, keeping
// the worst reading, so an LED with no resistor at 50 % still blocks; the peak corner is every PWM pin
// high and every PWM pin low; pins that share part of the circuit add pwm-approximate.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { solve } from './session.ts'
import { type PartSpec, boardModule, cellModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const ohm = (uid: string, v: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: v, unit: 'ohm' } } })
const board = (extra: PartSpec[], wires: [string, string][]) =>
  sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule() }, ...extra], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])
const ledOn = (d: ReturnType<typeof board>, runPins: RunPins) => solve(d, engine, 1, { runPins })

describe('solving with PWM (spec 4.2)', () => {
  const lit = board([ohm('r1', 150), { uid: 'd1', module: 'led' }], [['u1.IO1', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND']])
  it('averages the LED current by duty, in one runAll of 2 typical and 2 peak runs', async () => {
    const full = await ledOn(lit, { u1: { IO1: 'high' } })
    const half = await ledOn(lit, { u1: { IO1: { pwm: 0.5 } } })
    if (full.outcome.status !== 'ok' || half.outcome.status !== 'ok') throw new Error('solve failed')
    const a = (o: typeof full.outcome) => (o.status === 'ok' ? o.result.corners.typical.parts.d1.pins.A : null)
    const iFull = a(full.outcome)!.kind === 'value' ? (a(full.outcome) as { value: number }).value : NaN
    const iHalf = a(half.outcome)!.kind === 'value' ? (a(half.outcome) as { value: number }).value : NaN
    expect(iHalf / iFull).toBeCloseTo(0.5, 2)
    expect(half.outcome.result.engine.runs).toBe(4)
    expect(half.outcome.result.pwm).toEqual({ pins: [{ part: 'u1', pin: 'IO1', duty: 0.5 }], runs: 4, approximate: false })
    expect(half.outcome.result.corners.peak.parts.d1.pins.A).toEqual(full.outcome.result.corners.peak.parts.d1.pins.A)
  }, 60_000)
  it('still blocks an LED with no resistor at 50 % duty (the union keeps the high run)', async () => {
    const bare = board([{ uid: 'd1', module: 'led' }], [['u1.IO1', 'd1.A'], ['d1.K', 'u1.GND']])
    const { outcome } = await ledOn(bare, { u1: { IO1: { pwm: 0.5 } } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    expect(outcome.result.findings.some((f) => f.severity === 'error' && f.code === 'sim-over-abs-max')).toBe(true)
  }, 60_000)
  it('notes pwm-approximate when two PWM pins share a resistor', async () => {
    const shared = board([ohm('r1', 100), ohm('r2', 100), ohm('rc', 220)], [['u1.IO1', 'r1.1'], ['u1.IO2', 'r2.1'], ['r1.2', 'rc.1'], ['r2.2', 'rc.1'], ['rc.2', 'u1.GND']])
    const { outcome } = await ledOn(shared, { u1: { IO1: { pwm: 0.5 }, IO2: { pwm: 0.25 } } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    const note = outcome.result.findings.find((f) => f.code === 'pwm-approximate')
    expect(note).toMatchObject({ severity: 'note', parts: ['u1'], pins: [{ part: 'u1', pin: 'IO1' }, { part: 'u1', pin: 'IO2' }] })
    expect(note!.message).toBe('U1 IO1 and IO2 share part of the circuit, so their averaged readings assume their PWM cycles overlap at random; the real overlap depends on timing and may differ.')
    expect(outcome.result.pwm?.approximate).toBe(true)
  }, 60_000)
  it('is unchanged without PWM: 2 engine runs, no pwm field', async () => {
    const { outcome } = await ledOn(lit, { u1: { IO1: 'high' } })
    if (outcome.status !== 'ok') throw new Error('solve failed')
    expect([outcome.result.engine.runs, outcome.result.pwm]).toEqual([2, undefined])
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/solvePwm.test.ts`
Expected: FAIL: `engine.runs` is 2 for the PWM solve (every PWM pin compiles high).

- [ ] **Step 3: Findings: worst first, the union, the note**

In `src/sim/results.ts`: add `| 'pwm-approximate'` to `SimCode`; add to `SimResult`, after `notes`:

```ts
  /** PWM pins in this solve (firmware spec 4.2): every reading is then their duty-weighted average. */
  pwm?: { pins: { part: string; pin: string; duty: number }[]; runs: number; approximate: boolean }
```

In `src/sim/display.ts` `SIM_TITLES`, add `'pwm-approximate': 'PWM average is approximate',`.

In `src/sim/findings.ts`:
- `Draft` gains `/** How far past its limit (larger is worse), so the union over PWM runs keeps the worst reading (firmware spec 4.2). */ worse?: number`;
- in `runDrafts`, set `worse` on every limit-type draft except the abs-max one (it already carries the same value as `overBy`, which the sort below reads): in the limit loop `worse: under ? l.value.value / m.value : m.value / l.value.value`; on the `imax` draft `worse: raw.dev[d.id] / d.imax.value`; on the USB draft `worse: i / u.limit.value`; on the two `iout` drafts `worse: iout / r.ioutMax.value`; on the dropout draft `worse: r.vout!.value / Math.max(vctl, 1e-9)`; on the brownout error draft `worse: l.minVolts.value / Math.max(x, 1e-9)`;
- import `type PwmPlan` from `'./pwm.ts'`;
- replace `analyseFindings` with:

```ts
/** pwm-approximate (firmware spec 4.2, ruling R6): one note per group of two or more PWM pins. */
function approximateDrafts(c: Circuit, plan: PwmPlan | null): Draft[] {
  return (plan?.approximate ?? []).map((g) => {
    const parts = [...new Set(g.map((p) => p.part))]
    const who = parts.map((part) => `${refOf(c, part)} ${andList(g.filter((p) => p.part === part).map((p) => p.pin))}`)
    return {
      code: 'pwm-approximate', severity: 'note', parts, pins: g.map((p) => ({ part: p.part, pin: p.pin })), inputs: [], key: `pwm-approximate|${g.map((p) => p.id).join('|')}`,
      message: `${andList(who)} share part of the circuit, so their averaged readings assume their PWM cycles overlap at random; the real overlap depends on timing and may differ.`,
    }
  })
}

/**
 * Every finding of a solve made of several runs (firmware spec 4.2): the union over each corner's
 * runs, one finding per key keeping the worst reading, plus pwm-approximate; and what is outside the
 * model in any run.
 */
export function analyseRuns(c: Circuit, cls: Classification, runs: Record<Corner, RawRun[]>, topo = topologyFindings(c, cls), plan: PwmPlan | null = null): { findings: SimFinding[]; outside: Outside } {
  const typical = runs.typical.map((raw) => runDrafts(c, cls, raw, 'typical'))
  const peak = runs.peak.map((raw) => runDrafts(c, cls, raw, 'peak'))
  const outside = propagate(c, new Set([...topo.shortedRails, ...[...typical, ...peak].flatMap((r) => [...r.outside])]))
  const peakLabel = [...new Set(c.devices.flatMap((d) => (d.kind === 'load' && d.peakLabel ? [d.peakLabel] : [])))].join(', ')
  const shorted = new Set(topo.drafts.filter((d) => d.code === 'sim-short').map((d) => d.parts[0]))
  // Worst first within each corner: finalize keeps the first draft per key (its corner sort is stable).
  const value = [...typical, ...peak]
    .flatMap((r) => r.drafts)
    .filter((d) => !(d.code === 'sim-over-limit' && shorted.has(d.parts[0]) && !d.pins))
    .sort((a, b) => (b.worse ?? b.overBy ?? 0) - (a.worse ?? a.overBy ?? 0))
  return { findings: finalize([...topo.drafts, ...approximateDrafts(c, plan), ...value], peakLabel), outside }
}

/** Every finding of a single-run solve (spec 4.1, 4.2, 4.5, 5.2), and what is outside the model. */
export function analyseFindings(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>, topo = topologyFindings(c, cls)): { findings: SimFinding[]; outside: Outside } {
  return analyseRuns(c, cls, { typical: [raws.typical], peak: [raws.peak] }, topo)
}
```

- [ ] **Step 4: `solve` runs the plan**

In `src/sim/session.ts`, import `{ analyseRuns }` instead of `analyseFindings`, `{ mixRaws, pwmPlan }` from `'./pwm.ts'` and `type Analysis` from `'./model.ts'`, and replace `solve`'s body from `const raws = ...` through the `result` object with:

```ts
  // PWM pins (spec 4.2): the plan's typical runs and the two peak runs, every text in one runAll.
  const plan = pwmPlan(c)
  const typical: Analysis[] = plan ? plan.runs.map((pins) => ({ kind: 'op', corner: 'typical', pins })) : [{ kind: 'op', corner: 'typical' }]
  const peak: Analysis[] = plan ? plan.peak.map((pins) => ({ kind: 'op', corner: 'peak', pins })) : [{ kind: 'op', corner: 'peak' }]
  const analyses = [...typical, ...peak]
  const before = engine.host.runs
  let ms = 0
  const runs = await engine.runAll(c, analyses, revision)
  const got: RawRun[] = []
  for (const [i, a] of analyses.entries()) {
    const r = runs[i]
    if (!r) throw new Error(`the engine gave no answer for the ${a.corner} corner`)
    if (r.status === 'unavailable') return { circuit: c, outcome: { status: 'unavailable', reason: r.reason, findings: finalize(topo.drafts, '') } }
    if (r.status === 'failed') return { circuit: c, outcome: { status: 'failed', revision, finding: noConvergence(c, r.error, r.nodes), findings: finalize(topo.drafts, '') } }
    got.push(r.raw)
    ms += r.ms
  }
  const typRaws = got.slice(0, typical.length)
  const peakRaws = got.slice(typical.length)
  // Readings, glow and budget use the duty-weighted average; the peak corner reads the all-high run.
  const raws: Record<Corner, RawRun> = { typical: plan ? mixRaws(typRaws, plan.weights) : typRaws[0], peak: peakRaws[0] }
  const { findings, outside } = analyseRuns(c, cls, { typical: typRaws, peak: peakRaws }, topo, plan)
  const read = { typical: readRun(c, cls, raws.typical, outside), peak: readRun(c, cls, raws.peak, outside) }
  const info = engine.host.info
  const result: SimResult = {
    format: 'circuitoon-sim/1',
    revision,
    corners: read,
    budget: budget(c, cls, raws, outside),
    findings,
    unsimulated: c.unsimulated,
    probes: probeReadings([...(d.probes ?? []), ...(opts.probes ?? [])], c, read),
    unaccounted: c.unaccounted,
    notes: c.notes,
    engine: { name: 'ngspice', version: info?.version ?? '', build: info?.build ?? '', runs: engine.host.runs - before, ms },
    ...(plan ? { pwm: { pins: plan.pins.map((p) => ({ part: p.part, pin: p.pin, duty: p.duty })), runs: analyses.length, approximate: plan.approximate.length > 0 } } : {}),
  }
```

(the old `corners` constant and its loop go). `classifyCached(c, { kind: 'op' })` is unchanged: one classification serves every run (Task 22).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/sim src/cli/simCmd.test.ts src/cli/gate.test.ts`
Expected: PASS: the new tests, and every existing solve (no PWM: the same two runs and the same findings).

- [ ] **Step 6: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add src/sim/session.ts src/sim/findings.ts src/sim/results.ts src/sim/display.ts src/sim/solvePwm.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Sim: solve PWM pins (averaged readings, findings as the union keeping the worst, peak all high and all low, pwm-approximate)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 25: `SimSession` running mode

**Files:**
- Modify: `src/sim/session.ts` (`SolveOptions.runSeq`, `setRunning`, `onOutcome`'s third argument), `src/sim/session.test.ts` (add)

**Interfaces:**
- Consumes: `SimSession`, `solve` (Task 24).
- Produces:
  - `SolveOptions` gains `runSeq?: Record<string, number>` (the code sequence each board's run pin states were sampled at; `solve` ignores it, the session hands it back)
  - `SimSession` constructor's callback is `(o: SimOutcome, c?: Circuit, opts?: SolveOptions) => void`
  - `SimSession.setRunning(on: boolean): void`: in running mode a finished solve is delivered when newer than the last one delivered (spec 2.4)

- [ ] **Step 1: Write the failing test**

Append to `src/sim/session.test.ts`:

```ts
/** An engine whose every runAll takes 3 ticks of a manual clock. */
function slowEngine() {
  let tick = 0
  const waiting: { due: number; done: () => void }[] = []
  const run: Engine['run'] = (_c, _a, revision) => new Promise<RunOutcome>((res) => waiting.push({ due: tick + 3, done: () => res({ status: 'ok', revision, raw: { v: {}, pins: {}, dev: {} }, ms: 1 }) }))
  const engine: Engine = {
    host: { runs: 0, info: { name: 'ngspice', version: '45.2', build: 'fake' } } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run,
    runAll: async (c, analyses, revision) => {
      const out = await run(c, analyses[0], revision)
      return analyses.map(() => out)
    },
    dispose() {},
  }
  const advance = async () => {
    tick++
    for (const w of waiting.filter((x) => x.due <= tick)) {
      waiting.splice(waiting.indexOf(w), 1)
      w.done()
    }
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return { engine, advance, now: () => tick }
}

describe('SimSession running mode (firmware spec 2.4)', () => {
  it('delivers a result at least every 4 ticks while a request comes every tick and solves take 3', async () => {
    const s0 = slowEngine()
    const delivered: number[] = []
    const s = new SimSession(s0.engine, () => delivered.push(s0.now()))
    s.setRunning(true)
    for (let rev = 1; rev <= 40; rev++) {
      s.request(led, rev)
      await s0.advance()
    }
    expect(delivered.length).toBeGreaterThan(5)
    const gaps = delivered.slice(1).map((t, i) => t - delivered[i])
    expect(Math.max(...gaps, delivered[0])).toBeLessThanOrEqual(4)
  })
  it('keeps the old rule when nothing runs: continuous requests deliver nothing until they stop', async () => {
    const s0 = slowEngine()
    const delivered: number[] = []
    const s = new SimSession(s0.engine, () => delivered.push(s0.now()))
    for (let rev = 1; rev <= 20; rev++) {
      s.request(led, rev)
      await s0.advance()
    }
    expect(delivered).toEqual([])
    for (let i = 0; i < 8; i++) await s0.advance()
    expect(delivered).toHaveLength(1)
  })
  it('hands the request options back with the outcome', async () => {
    const g = gatedEngine()
    const got: unknown[] = []
    const s = new SimSession(g.engine, (_o, _c, opts) => got.push(opts?.runSeq))
    s.request(led, 1, { runSeq: { u1: 7 } })
    await g.flush()
    expect(got).toEqual([{ u1: 7 }])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/session.test.ts`
Expected: FAIL: `s.setRunning is not a function`.

- [ ] **Step 3: Running mode**

In `src/sim/session.ts`:
- `SolveOptions` becomes:
  ```ts
  /** BuildOptions (held group, library, run pin states) plus probes beyond the diagram's saved ones (the CLI's), and the code sequences the run pin states were sampled at (handed back with the outcome). */
  export interface SolveOptions extends BuildOptions { probes?: Probe[]; runSeq?: Record<string, number> }
  ```
- the `onOutcome` field and constructor parameter type become `(o: SimOutcome, c?: Circuit, opts?: SolveOptions) => void`;
- add fields `private runMode = false` and `private delivered = 0`, and:
  ```ts
  /**
   * Running mode (firmware spec 2.4), while any board runs: a finished solve is delivered when it is
   * newer than the last one delivered, so a request every sample never starves the display. Off, the
   * existing rule holds: only the latest request is delivered.
   */
  setRunning(on: boolean): void {
    this.runMode = on
  }
  ```
- in `loop`, replace `if (this.stopped || job.revision !== this.latest) continue` with:
  ```ts
      if (this.stopped) continue
      if (this.runMode ? job.revision <= this.delivered : job.revision !== this.latest) continue
      this.delivered = job.revision
  ```
- and pass `job.opts` as the third argument of `this.onOutcome(...)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/session.test.ts`
Expected: PASS (the three new tests and the existing ones).

- [ ] **Step 5: Build the CLI and commit**

Run: `npm run build:cli`

```bash
git add src/sim/session.ts src/sim/session.test.ts plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Sim: SimSession running mode (deliver any newer result) and request options handed back with the outcome

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 26: The PWM checkpoint: the solve budgets with run pin states

**Files:**
- Create: `src/sim/solve.pwm.perf.test.ts`

**Interfaces:**
- Consumes: `solve` (Task 24), the Pi 4 data (Task 8), `sheet`, `cellModule`.
- Produces: the two budgets of spec 4.3 and 9, measured: a run-state change with no PWM re-solved within p95 50 ms, and with one group of 3 PWM pins (8 typical + 2 peak texts) within p95 200 ms, both at 200 parts.

**Pass criteria and what to do if they fail:** both budgets hold on a quiet machine (`npx vitest run src/sim/solve.pwm.perf.test.ts` alone, nothing else heavy running). A miss on a busy machine is rerun quietly, never relaxed. A miss on a quiet machine stops the phase: record both p95s and a per-step profile (build, plan, compile of the 10 texts, the worker round trip, mixing, findings) in the ledger; the controller rules between the spec's named remedy (a persistent circuit with `alter` per run, a later engine release, spec 4.2) and reducing the exact limit, as an amendment task. Nothing after Task 29 relies on the budget being met.

- [ ] **Step 1: Write the perf test**

`src/sim/solve.pwm.perf.test.ts`:

```ts
// Firmware spec 4.3 and 9 (the PWM checkpoint): a run-state change re-solved end to end at 200 parts,
// p95 at most 50 ms with no PWM, and at most 200 ms with one group of 3 PWM pins (an RGB LED on a
// shared resistor: 8 typical and 2 peak texts). Measured like solve.perf.test.ts; budgets are never
// relaxed: on a busy machine, rerun on a quiet one.
import { afterAll, describe, expect, it } from 'vitest'
import type { RunPins } from '../format/simState.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { solve } from './session.ts'
import { type PartSpec, cellModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

/** 200 parts: a 5 V supply, a Pi 4, an RGB LED (three LEDs on one 220 ohm resistor on GPIO17, 27, 22), and 97 resistor-LED pairs on the supply. */
const parts: PartSpec[] = [{ uid: 'bt1', module: cellModule(5, 0.02) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'rc', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } } }]
const wires: [string, string][] = [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['rc.2', 'u1.GND 2']]
for (const [i, pin] of ['GPIO17', 'GPIO27', 'GPIO22'].entries()) {
  parts.push({ uid: `c${i}`, module: 'led' })
  wires.push([`u1.${pin}`, `c${i}.A`], [`c${i}.K`, 'rc.1'])
}
for (let i = 0; i < 97; i++) {
  parts.push({ uid: `r${i}`, module: 'resistor', values: { resistance: { value: 150 + i, unit: 'ohm' } } }, { uid: `d${i}`, module: 'led' })
  wires.push(['bt1.+', `r${i}.1`], [`r${i}.2`, `d${i}.A`], [`d${i}.K`, 'bt1.-'])
}
const d = sheet(parts, wires)

async function p95(round: (k: number) => Promise<void>): Promise<number> {
  const times: number[] = []
  for (let k = 0; k < 45; k++) {
    const t0 = performance.now()
    await round(k)
    if (k >= 5) times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length * 0.95)]
}

describe('run-state solve budgets (spec 4.3, the PWM checkpoint)', () => {
  it('has 200 parts', () => expect(d.parts).toHaveLength(200))
  it('re-solves a run-state change with no PWM in p95 50 ms or less', async () => {
    const ms = await p95(async (k) => {
      const runPins: RunPins = { u1: { GPIO17: k % 2 ? 'high' : 'low', GPIO27: 'low', GPIO22: 'low' } }
      const { outcome } = await solve(d, engine, k, { runPins })
      expect(outcome.status).toBe('ok')
    })
    console.log(`no PWM: p95 ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThanOrEqual(50)
  }, 300_000)
  it('re-solves one group of 3 PWM pins (10 texts) in p95 200 ms or less', async () => {
    const ms = await p95(async (k) => {
      const runPins: RunPins = { u1: { GPIO17: { pwm: (k % 60 + 1) / 64 }, GPIO27: { pwm: 0.5 }, GPIO22: { pwm: 0.25 } } }
      const { outcome } = await solve(d, engine, k, { runPins })
      expect(outcome.status === 'ok' && outcome.result.engine.runs).toBe(10)
    })
    console.log(`3 PWM pins: p95 ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThanOrEqual(200)
  }, 300_000)
})
```

The `GND 2` pin and the `5V` pin are the Pi 4's header pads (`modules/rpi-4-model-b.json` holes); Task 8's data puts the board's draw on `5V`.

- [ ] **Step 2: Run it on a quiet machine**

Run: `npx vitest run src/sim/solve.pwm.perf.test.ts`
Expected: PASS, printing both p95s. Write both numbers into the ledger as the PWM checkpoint's result; apply the rule above on a miss.

- [ ] **Step 3: Commit**

```bash
git add src/sim/solve.pwm.perf.test.ts
git commit -m "$(cat <<'MSG'
Sim: PWM checkpoint budgets (run-state re-solve at 200 parts: 50 ms without PWM, 200 ms with 3 PWM pins)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: the PWM checkpoint (spec 4.3). The controller reads the two p95s in the ledger; a quiet-machine miss is settled before Task 29.

### Task 27: The servo model (pulse to angle, slew, signal check)

**Files:**
- Create: `src/run/servo.ts`, `src/run/servo.test.ts`

**Interfaces:**
- Consumes: `simOf` and `ServoSpec` (Task 7); the SG90 data (Task 9).
- Produces:
  - `interface ServoLimits { pulseMin: number; pulseMax: number; slewSecPer60: number }`; `function servoLimitsOf(m: ModuleDef | undefined): ServoLimits | null`
  - `const SIGNAL_PULSE_S: [number, number] = [0.0004, 0.0026]`, `const SIGNAL_HZ: [number, number] = [40, 330]`
  - `function servoTarget(duty: number, freqHz: number, s: ServoLimits): { angle: number } | { why: string }`
  - `function slewToward(angle: number, target: number, dtMs: number, s: ServoLimits): number`

- [ ] **Step 1: Write the failing test**

`src/run/servo.test.ts`:

```ts
// Firmware spec 3.4: angle is a linear map of pulse width (duty / frequency) from pulseMin..pulseMax
// to 0..180 degrees, clamped; the horn moves toward it at the slew rate; a pulse outside 0.4 to 2.6 ms
// or a frequency outside 40 to 330 Hz holds the last angle. gpiozero's Servo.min() (1 ms) draws at
// about 47 degrees on an SG90.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import { servoLimitsOf, servoTarget, slewToward } from './servo.ts'

const sg90 = servoLimitsOf(load('servo-sg90'))!
const at = (pulseMs: number, hz = 50) => servoTarget((pulseMs / 1000) * hz, hz, sg90)

describe('the servo model (spec 3.4)', () => {
  it('reads the SG90 data', () => expect(sg90).toEqual({ pulseMin: 0.0005, pulseMax: 0.0024, slewSecPer60: 0.1 }))
  it('maps pulse width to angle, clamped', () => {
    expect(at(0.5)).toEqual({ angle: 0 })
    expect(at(2.4)).toEqual({ angle: 180 })
    expect((at(1) as { angle: number }).angle).toBeCloseTo(47.37, 2)
    expect(at(2.5)).toEqual({ angle: 180 })
  })
  it('holds for a pulse or frequency a servo does not follow, and says why', () => {
    expect(at(0.3)).toEqual({ why: 'a 0.3 ms pulse at 50 Hz' })
    expect(at(1.5, 20)).toEqual({ why: 'a 1.5 ms pulse at 20 Hz' })
  })
  it('slews at 0.1 s per 60 degrees', () => {
    expect(slewToward(0, 90, 50, sg90)).toBeCloseTo(30, 9)
    expect(slewToward(85, 90, 50, sg90)).toBe(90)
    expect(slewToward(90, 0, 100, sg90)).toBeCloseTo(30, 9)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/servo.test.ts`
Expected: FAIL, `./servo.ts` cannot be found.

- [ ] **Step 3: Write `src/run/servo.ts`**

```ts
// The servo model (firmware spec 3.4): the angle is a linear map of the pulse width (duty / frequency)
// from the module's pulseMin..pulseMax onto 0..180 degrees, clamped; the horn moves toward it at the
// slew rate; a signal a servo does not follow (a pulse outside 0.4 to 2.6 ms, or a frequency outside
// 40 to 330 Hz) holds the last angle and is reported. Pure.
import type { ModuleDef } from '../format/module.ts'
import { simOf } from '../format/simModel.ts'

export interface ServoLimits { pulseMin: number; pulseMax: number; slewSecPer60: number }
export const SIGNAL_PULSE_S: [number, number] = [0.0004, 0.0026]
export const SIGNAL_HZ: [number, number] = [40, 330]

export function servoLimitsOf(m: ModuleDef | undefined): ServoLimits | null {
  const s = simOf(m)?.servo
  return s ? { pulseMin: s.pulseMin.value, pulseMax: s.pulseMax.value, slewSecPer60: s.slew.value } : null
}

const round = (x: number, digits: number) => Number(x.toFixed(digits))

export function servoTarget(duty: number, freqHz: number, s: ServoLimits): { angle: number } | { why: string } {
  const pulse = duty / freqHz
  if (freqHz < SIGNAL_HZ[0] || freqHz > SIGNAL_HZ[1] || pulse < SIGNAL_PULSE_S[0] || pulse > SIGNAL_PULSE_S[1])
    return { why: `a ${round(pulse * 1000, 2)} ms pulse at ${round(freqHz, 1)} Hz` }
  const a = ((pulse - s.pulseMin) / (s.pulseMax - s.pulseMin)) * 180
  return { angle: Math.min(180, Math.max(0, a)) }
}

export function slewToward(angle: number, target: number, dtMs: number, s: ServoLimits): number {
  const step = ((60 / s.slewSecPer60) * Math.max(0, dtMs)) / 1000
  return Math.abs(target - angle) <= step ? target : angle + Math.sign(target - angle) * step
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/servo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run/servo.ts src/run/servo.test.ts
git commit -m "$(cat <<'MSG'
Run: the servo model (pulse width to angle, slew, signals a servo does not follow)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 28: Power while running (refuse, lost power, under-voltage)

**Files:**
- Create: `src/run/power.ts`, `src/run/power.test.ts`

**Interfaces:**
- Consumes: `solve` (Task 24), `Circuit`, `SimResult`; `boardModule`, `cellModule`, `sheet` (`src/sim/testing.ts`).
- Produces:
  - `const PI_UNDER_VOLTAGE = 4.63` (V; its source URL in the comment, copied from the `PI_UNDER_VOLTAGE` entry of the Pi 4 patch `notes` that Task 8 wrote, ruling R8)
  - `interface BoardPower { powered: boolean; inputVolts: number | null; lowest: { domain: string; volts: number | null; minVolts: number } | null }`
  - `function boardPower(c: Circuit, r: SimResult, uid: string): BoardPower` (from the typical corner's duty-weighted average, spec 4.5)
  - `function underVoltage(p: BoardPower): boolean`
  - `const NO_POWER = (ref: string) => \`${ref} has no power: connect 5V and GND\``; `const LOST_POWER = (ref: string) => \`${ref} lost power\``; `function underVoltageNote(ref: string, volts: number): string`

- [ ] **Step 1: Write the failing test**

`src/run/power.test.ts`:

```ts
// Firmware spec 4.5: a board is powered when every one of its loads solves (typical corner, the
// duty-weighted average) at or above its minVolts. A PWM combination that browns out is reported
// (the union) but, averaged at 10 % duty, does not stop the board. The 5V input below 4.63 V gives a
// note. The words are the spec's.
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import { boardModule, cellModule, sheet } from '../sim/testing.ts'
import { LOST_POWER, NO_POWER, PI_UNDER_VOLTAGE, boardPower, underVoltage, underVoltageNote } from './power.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const on = async (d: ReturnType<typeof sheet>, runPins = {}) => {
  const r = await solve(d, engine, 1, { runPins })
  if (r.outcome.status !== 'ok') throw new Error('solve failed')
  return { c: r.circuit, result: r.outcome.result }
}

describe('power while running (spec 4.5)', () => {
  it('is powered from 5 V, and unpowered with nothing on its supply', async () => {
    const good = await on(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule({ minVolts: 2.9 }) }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    expect(boardPower(good.c, good.result, 'u1')).toMatchObject({ powered: true })
    const none = await on(sheet([{ uid: 'u1', module: boardModule({ minVolts: 2.9 }) }], []))
    expect(boardPower(none.c, none.result, 'u1')).toMatchObject({ powered: false, lowest: { domain: '3V3', volts: null, minVolts: 2.9 } })
  }, 60_000)
  it('reports a brownout in the high run but stays powered on the 10 % average', async () => {
    // A weak supply (12 ohm) and IO1 driving 10 ohm: the high run pulls the 3V3 rail under 2.9 V.
    const d = sheet(
      [{ uid: 'bt1', module: cellModule(5, 12) }, { uid: 'u1', module: boardModule({ minVolts: 2.9 }) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 10, unit: 'ohm' } } }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']],
    )
    const { c, result } = await on(d, { u1: { IO1: { pwm: 0.1 } } })
    expect(result.findings.some((f) => f.code === 'sim-brownout' && f.severity === 'error' && f.parts.includes('u1'))).toBe(true)
    expect(boardPower(c, result, 'u1').powered).toBe(true)
  }, 60_000)
  it('notes a 5V input under 4.63 V, in plain words', () => {
    expect(PI_UNDER_VOLTAGE).toBe(4.63)
    expect(underVoltage({ powered: true, inputVolts: 4.5, lowest: null })).toBe(true)
    expect(underVoltage({ powered: true, inputVolts: 5.0, lowest: null })).toBe(false)
    expect(underVoltageNote('U1', 4.5)).toBe("U1's 5V input is at 4.5 V, below the 4.63 V where a real Raspberry Pi warns of under-voltage.")
    expect([NO_POWER('U1'), LOST_POWER('U1')]).toEqual(['U1 has no power: connect 5V and GND', 'U1 lost power'])
  }, 60_000)
  it('cites the source URL that Task 8 recorded in the Pi 4 patch notes', () => {
    const note = (JSON.parse(readFileSync('scripts/sim-data/rpi-4-model-b.json', 'utf8')).notes as string[]).find((n) => n.includes('PI_UNDER_VOLTAGE'))
    const url = note?.match(/https:\/\/\S+/)?.[0].replace(/[.,;)]+$/, '')
    expect(url).toBeDefined()
    expect(readFileSync('src/run/power.ts', 'utf8')).toContain(`Source: ${url}`)
  })
})
```

The 12 ohm supply is chosen so that the all-high run browns the 3V3 rail out and the 10 % average does not (with the test board's 1.1 V LDO dropout and 50 mA draw, about 2.5 V high and 3.2 V average). If the solved numbers land elsewhere, change only the supply resistance until both assertions describe the case; the assertions are the requirement.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/power.test.ts`
Expected: FAIL, `./power.ts` cannot be found.

- [ ] **Step 3: Write `src/run/power.ts`**

```ts
// Power while code runs (firmware spec 4.5). Run waits for the first solve and refuses a board that is
// not powered ("U1 has no power: connect 5V and GND"); a running board stops only when one of its
// loads, at the typical corner's duty-weighted average, is under its minVolts ("U1 lost power"): a dip
// in one PWM combination is reported by the solve's findings but does not stop it, as a real Pi rides
// through on its capacitors. The 5V input under Raspberry Pi's documented 4.63 V warning threshold
// gives a note and stops nothing. Pure.
import type { Circuit } from '../sim/model.ts'
import type { SimResult } from '../sim/results.ts'

/** Raspberry Pi's under-voltage warning threshold, volts (ruling R8). Source: <the URL in the PI_UNDER_VOLTAGE note of scripts/sim-data/rpi-4-model-b.json>. */
export const PI_UNDER_VOLTAGE = 4.63

export interface BoardPower {
  powered: boolean
  /** The board's 5V domain (ruling R9), or null when it has none or it floats. */
  inputVolts: number | null
  /** The load furthest under (or nearest) its minVolts, for messages; null with no load. */
  lowest: { domain: string; volts: number | null; minVolts: number } | null
}

export const NO_POWER = (ref: string): string => `${ref} has no power: connect 5V and GND`
export const LOST_POWER = (ref: string): string => `${ref} lost power`
export const underVoltageNote = (ref: string, volts: number): string =>
  `${ref}'s 5V input is at ${Number(volts.toFixed(2))} V, below the ${PI_UNDER_VOLTAGE} V where a real Raspberry Pi warns of under-voltage.`

export function boardPower(c: Circuit, r: SimResult, uid: string): BoardPower {
  const rows = r.budget.filter((b) => b.kind === 'domain' && b.part === uid)
  const volts = (domain: string) => {
    const v = rows.find((b) => b.id === `${uid}.domain.${domain}`)?.volts.typical
    return v?.kind === 'value' ? v.value : null
  }
  const loads = c.devices.filter((d): d is Extract<Circuit['devices'][number], { kind: 'load' }> => d.kind === 'load' && d.part === uid)
  let lowest: BoardPower['lowest'] = null
  let powered = loads.length > 0
  for (const l of loads) {
    const v = volts(l.domain)
    const ok = v !== null && v >= l.minVolts.value
    if (!ok) powered = false
    const margin = v === null ? -Infinity : v - l.minVolts.value
    const was = lowest ? (lowest.volts === null ? -Infinity : lowest.volts - lowest.minVolts) : Infinity
    if (margin < was) lowest = { domain: l.domain, volts: v, minVolts: l.minVolts.value }
  }
  return { powered, inputVolts: volts('5V'), lowest }
}

export const underVoltage = (p: BoardPower): boolean => p.inputVolts !== null && p.inputVolts < PI_UNDER_VOLTAGE
```

Replace the comment's `<the URL in the PI_UNDER_VOLTAGE note of scripts/sim-data/rpi-4-model-b.json>` with the URL in that note (Task 8 verified it with the two reviewers); the last test fails until the comment holds exactly that URL after `Source: `.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/power.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run/power.ts src/run/power.test.ts
git commit -m "$(cat <<'MSG'
Run: power while running (refuse unpowered, lost power on the duty-weighted average, the 4.63 V note)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 29: `RunCore`: sampling, thresholds into the boards, servos and run-time findings

**Files:**
- Create: `src/run/core.ts`, `src/run/core.test.ts`

**Interfaces:**
- Consumes: Tasks 20, 21, 27, 28 (`LevelTracker`, `thresholdsOf`, `BoardSampler`, `servoTarget`, `slewToward`, `servoLimitsOf`, `boardPower`); `readAllOut`, `writeIn`, `MODE`, `NPINS` (Task 12); `withLibraryData` (Task 5); `SimOutcome`, `Circuit`.
- Produces:
  - `type RunCode = 'undefined-level' | 'floating-read' | 'servo-signal'`; `interface RunFinding { code: RunCode; severity: 'warning'; parts: string[]; pins: { part: string; pin: string }[]; message: string; key: string }`
  - `interface ServoView { angle: number; target: number; moving: boolean }`
  - `interface CoreBoard { uid: string; ref: string; memory: BoardMemory; module: ModuleDef }`
  - `class RunCore { add(b: CoreBoard): void; remove(uid: string): void; get boards(): CoreBoard[]; sample(at: (b: CoreBoard) => number): { pins: RunPins; seq: Record<string, number>; changed: boolean; findings: RunFinding[] }; apply(o: SimOutcome, c: Circuit | null, seq: Record<string, number>, at: (b: CoreBoard) => number): { findings: RunFinding[]; power: Record<string, BoardPower> }; servos(d: Diagram, c: Circuit | null, nowMs: number, library?: ModuleLookup): { views: Record<string, ServoView>; moving: string[]; findings: RunFinding[] } }`
  - `const NEVER_PAUSES: (ref: string) => string` (spec 5.2's message)
  - a servo's first commanded angle is where it starts (ruling R24): it slews only from there on

- [ ] **Step 1: Write the failing test**

`src/run/core.test.ts`:

```ts
// Firmware spec 2.3, 3.4, 4.4: RunCore samples every running board into run pin states (changed only
// when a quantised state or a code sequence changes), writes each solve's thresholded levels and
// edges into the boards' input tables "solved through" the sampled sequence, raises the run-time
// findings once, and turns a PWM signal on a servo's net into an angle that slews.
import { afterAll, describe, expect, it } from 'vitest'
import { makeHw, type RunClock } from './bridge.ts'
import { type CoreBoard, RunCore } from './core.ts'
import { H, MODE, boardMemory, readIn } from './memory.ts'
import { load } from '../format/builtinModules.testing.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const pi = load('rpi-4-model-b')

function board() {
  const memory = boardMemory()
  const clock: RunClock & { t: number } = { t: 0, epochMs: 0, now: () => clock.t, block() {}, poll() {} }
  const hw = makeHw(memory, clock, { board: 'pi4', onPrompt() {}, flush() {} })
  const b: CoreBoard = { uid: 'u1', ref: 'U1', memory, module: pi }
  return { b, hw, clock }
}
const at = () => 0

describe('RunCore (spec 2.3, 4.4)', () => {
  it('samples run pin states, changed only when a state or the code sequence moves', () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(17, MODE.output)
    hw.output(17, 1)
    const first = core.sample(at)
    expect(first.pins).toEqual({ u1: { GPIO17: 'high' } })
    expect(first.changed).toBe(true)
    expect(core.sample(at).changed).toBe(false)
    hw.setup(27, MODE.pullup)
    expect(core.sample(at)).toMatchObject({ changed: true, pins: { u1: { GPIO17: 'high', GPIO27: 'input-pullup' } } })
  })
  it('writes a solve back as levels and edges, solved through the sampled sequence', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(27, MODE.pullup)
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 's1', module: 'push-button' }], [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['u1.GPIO27', 's1.1'], ['s1.2', 'u1.GND 2']])
    const s = core.sample(at)
    const up = await solve(d, engine, 1, { runPins: s.pins })
    core.apply(up.outcome, up.circuit, s.seq, at)
    expect(readIn(b.memory, 27)).toMatchObject({ level: 1, status: 'value', rising: 0, falling: 0 })
    expect(Atomics.load(b.memory.i32, H.solvedThrough)).toBe(s.seq.u1)
    const down = await solve(d, engine, 2, { runPins: s.pins, held: { part: 's1', group: 's' } })
    const r = core.apply(down.outcome, down.circuit, s.seq, at)
    expect(readIn(b.memory, 27)).toMatchObject({ level: 0, falling: 1 })
    expect(r.power.u1.powered).toBe(true)
  }, 60_000)
  it('raises floating-read once for an unpulled input that nothing drives', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(4, MODE.input)
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }], [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND']])
    const s = core.sample(at)
    const r1 = await solve(d, engine, 1, { runPins: s.pins })
    expect(core.apply(r1.outcome, r1.circuit, s.seq, at).findings.map((f) => [f.code, f.message])).toEqual([
      ['floating-read', 'U1 GPIO4 is read by the code but nothing drives it: it floats, so each read is random. Turn on a pull-up or pull-down in the code, or wire it to a signal.'],
    ])
    expect(core.apply(r1.outcome, r1.circuit, s.seq, at).findings).toEqual([])
  }, 60_000)
  it('turns a servo PWM signal into an angle that slews, and reports a signal it does not follow', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(18, MODE.output)
    hw.pwm(18, true, 0.0005 * 50, 50)
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'm1', module: 'servo-sg90' }],
      [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['u1.GPIO18', 'm1.PWM'], ['bt1.+', 'm1.VCC'], ['bt1.-', 'm1.GND']])
    core.sample(at)
    const { circuit } = await solve(d, engine, 1, {})
    expect(core.servos(d, circuit, 0).views.m1).toEqual({ angle: 0, target: 0, moving: false })
    hw.pwm(18, true, 0.0024 * 50, 50)
    core.sample(at)
    const mid = core.servos(d, circuit, 100)
    expect(mid.views.m1.target).toBe(180)
    expect(mid.views.m1.angle).toBeCloseTo(60, 6)
    expect(mid.moving).toEqual(['m1'])
    expect(core.servos(d, circuit, 400).views.m1).toEqual({ angle: 180, target: 180, moving: false })
    hw.pwm(18, true, 0.003 * 50, 50)
    core.sample(at)
    const bad = core.servos(d, circuit, 500)
    expect(bad.views.m1.angle).toBe(180)
    expect(bad.findings.map((f) => f.message)).toEqual(["M1's signal is a 3 ms pulse at 50 Hz, which a servo does not follow (0.4 to 2.6 ms pulses at 40 to 330 Hz): it holds its last angle."])
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/run/core.test.ts`
Expected: FAIL, `./core.ts` cannot be found.

- [ ] **Step 3: Write `src/run/core.ts`**

```ts
// RunCore (firmware spec 2.3, 3.4, 4.4, 4.5): what sits between running boards and the simulation,
// shared by the editor (real time) and the CLI's driver (virtual time). It samples every board into
// run pin states, writes each solve back into every board's input table (thresholded levels, edge
// counters, voltages, "solved through" the sequence the request was sampled at), keeps the servos'
// angles, and raises the run-time findings, each once per run. `at(board)` is that board's run time.
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { nodeKey } from '../format/netlist.ts'
import { simOf, withLibraryData } from '../format/simModel.ts'
import type { RunPins } from '../format/simState.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimOutcome } from '../sim/results.ts'
import { gpioPin } from './boards.ts'
import { LevelTracker, type Thresholds, thresholdsOf } from './levels.ts'
import { type BoardMemory, MODE, NPINS, type PinIn, readAllOut, writeIn } from './memory.ts'
import { type BoardPower, boardPower } from './power.ts'
import { BoardSampler, type SampledPin } from './sampler.ts'
import { servoLimitsOf, servoTarget, slewToward } from './servo.ts'

export type RunCode = 'undefined-level' | 'floating-read' | 'servo-signal'
export interface RunFinding { code: RunCode; severity: 'warning'; parts: string[]; pins: { part: string; pin: string }[]; message: string; key: string }
export interface ServoView { angle: number; target: number; moving: boolean }
export interface CoreBoard { uid: string; ref: string; memory: BoardMemory; module: ModuleDef }
/** Spec 5.2's words, shown once when a board has not yielded for 2 s (editor) or 5 s (CLI) while something waits. */
export const NEVER_PAUSES = (ref: string): string => `${ref}'s code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop.`

interface Entry { b: CoreBoard; sampler: BoardSampler; levels: LevelTracker; th: Thresholds; detail: Record<string, SampledPin> }
interface Servo { angle: number; target: number; t: number; warned: boolean }

export class RunCore {
  private entries = new Map<string, Entry>()
  private last = ''
  private servoState = new Map<string, Servo>()

  add(b: CoreBoard): void {
    this.entries.set(b.uid, { b, sampler: new BoardSampler(), levels: new LevelTracker(b.uid), th: thresholdsOf(b.module), detail: {} })
    this.last = ''
  }

  remove(uid: string): void {
    this.entries.delete(uid)
    this.last = ''
  }

  get boards(): CoreBoard[] {
    return [...this.entries.values()].map((e) => e.b)
  }

  /** Samples every board (spec 2.3). `changed` when a quantised state or a code sequence moved since the last sample. */
  sample(at: (b: CoreBoard) => number): { pins: RunPins; seq: Record<string, number>; changed: boolean; findings: RunFinding[] } {
    const pins: RunPins = {}
    const seq: Record<string, number> = {}
    const findings: RunFinding[] = []
    for (const e of this.entries.values()) {
      const now = at(e.b)
      const s = e.sampler.sample(e.b.memory, now)
      pins[e.b.uid] = s.pins
      seq[e.b.uid] = s.seq
      e.detail = s.detail
      for (const pin of e.levels.check(now)) {
        const v = e.levels.get(pin)?.volts
        findings.push({
          code: 'undefined-level', severity: 'warning', parts: [e.b.uid], pins: [{ part: e.b.uid, pin }], key: `undefined-level|${e.b.uid}|${pin}`,
          message: `${e.b.ref} ${pin} reads ${v !== undefined && Number.isFinite(v) ? Number(v.toFixed(2)) : '?'} V, between the low and high thresholds.`,
        })
      }
    }
    const key = JSON.stringify([pins, seq])
    const changed = key !== this.last
    this.last = key
    return { pins, seq, changed, findings }
  }

  /** A solve back into the boards (spec 4.4): input pins' levels and edges, solved through `seq`; and each board's power (spec 4.5). */
  apply(o: SimOutcome, c: Circuit | null, seq: Record<string, number>, at: (b: CoreBoard) => number): { findings: RunFinding[]; power: Record<string, BoardPower> } {
    const findings: RunFinding[] = []
    const power: Record<string, BoardPower> = {}
    if (o.status !== 'ok' || !c) return { findings, power }
    const nets = o.result.corners.typical.nets
    for (const e of this.entries.values()) {
      const now = at(e.b)
      const rows: (PinIn | null)[] = Array.from({ length: NPINS }, () => null)
      readAllOut(e.b.memory).rows.forEach((r, bcm) => {
        if (r.mode === MODE.unused || r.mode === MODE.output) return
        const pin = gpioPin(bcm)
        const net = c.pinNet[nodeKey(e.b.uid, pin)]
        const u = e.levels.update(pin, net === undefined ? undefined : nets[net], e.th, now)
        rows[bcm] = u.row
        if (u.finding === 'floating-read')
          findings.push({
            code: 'floating-read', severity: 'warning', parts: [e.b.uid], pins: [{ part: e.b.uid, pin }], key: `floating-read|${e.b.uid}|${pin}`,
            message: `${e.b.ref} ${pin} is read by the code but nothing drives it: it floats, so each read is random. Turn on a pull-up or pull-down in the code, or wire it to a signal.`,
          })
      })
      writeIn(e.b.memory, rows, seq[e.b.uid] ?? 0)
      power[e.b.uid] = boardPower(c, o.result, e.b.uid)
    }
    return { findings, power }
  }

  /** The output on a net that a servo could follow: its declared or bit-banged duty and frequency (ruling R23). */
  private driverOn(c: Circuit, net: string): SampledPin | null {
    for (const e of this.entries.values())
      for (const [pin, s] of Object.entries(e.detail))
        if (s.duty !== null && s.freqHz && c.pinNet[nodeKey(e.b.uid, pin)] === net) return s
    return null
  }

  /** Every servo's angle at `nowMs` (spec 3.4): toward the target its signal commands, at its slew rate. */
  servos(d: Diagram, c: Circuit | null, nowMs: number, library?: ModuleLookup): { views: Record<string, ServoView>; moving: string[]; findings: RunFinding[] } {
    const views: Record<string, ServoView> = {}
    const moving: string[] = []
    const findings: RunFinding[] = []
    if (!c) return { views, moving, findings }
    for (const p of d.parts) {
      const stored = d.modules[p.module]
      const m = stored && withLibraryData(stored, library)
      const lim = servoLimitsOf(m)
      if (!lim) continue
      const net = c.pinNet[nodeKey(p.uid, simOf(m)!.servo!.signal)]
      const drive = net === undefined ? null : this.driverOn(c, net)
      const st = this.servoState.get(p.uid)
      let target = st?.target ?? null
      let warned = st?.warned ?? false
      if (drive) {
        const t = servoTarget(drive.duty!, drive.freqHz!, lim)
        if ('angle' in t) target = t.angle
        else if (!warned) {
          warned = true
          findings.push({
            code: 'servo-signal', severity: 'warning', parts: [p.uid], pins: [], key: `servo-signal|${p.uid}`,
            message: `${p.designator}'s signal is ${t.why}, which a servo does not follow (0.4 to 2.6 ms pulses at 40 to 330 Hz): it holds its last angle.`,
          })
        }
      }
      if (target === null) continue
      // Ruling R24: a servo starts where it is first commanded; it slews from there on.
      const angle = st ? slewToward(st.angle, target, nowMs - st.t, lim) : target
      this.servoState.set(p.uid, { angle, target, t: nowMs, warned })
      const view = { angle, target, moving: Math.abs(angle - target) > 1e-6 }
      views[p.uid] = view
      if (view.moving) moving.push(p.uid)
    }
    return { views, moving, findings }
  }
}
```

The servo test's first command (0.5 ms) starts the servo at 0 degrees; 2.4 ms then moves it 60 degrees in 100 ms (0.1 s per 60 degrees) and arrives by 400 ms; the 3 ms pulse holds 180.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/run/core.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run/core.ts src/run/core.test.ts
git commit -m "$(cat <<'MSG'
Run: RunCore (sampling every board, thresholds and edges back, servo angles, run-time findings once per run)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 30: The virtual-clock driver (`drive`)

**Files:**
- Create: `src/run/driver.ts`, `src/run/driver.test.ts`, `src/run/sheets.testing.ts`

**Interfaces:**
- Consumes: Tasks 17, 18 (`BoardRun` in virtual mode, `spawnNodeCodeWorker`), 29 (`RunCore`), 28 (`boardPower`, `NO_POWER`, `LOST_POWER`, `underVoltage`, `underVoltageNote`), 24 (`solve`); `switchGroups`, `contactPosition`, `isActive` (`simState.ts`); `languagesOf`, `RUNNABLE` (`code.ts`); `boardKindOf`; `PY_FILES`.
- Produces:
  - (uses `NEVER_PAUSES` from Task 29)
  - `interface Press { uid: string; atMs: number; forMs: number }`
  - `interface DriveOptions { diagram: Diagram; boards: string[]; forMs: number; inputs: string[]; presses: Press[]; engine: Engine; py: { indexURL: string; lock: string }; spawn?: () => CodeWorkerLike; realLimitMs?: number; library?: ModuleLookup }`
  - `interface SerialEntry { t: number; stream: 'out' | 'err' | 'note'; text: string }`; `interface DriveBoard { uid: string; ref: string; status: RunStatus | 'not-started'; serial: SerialEntry[] }`
  - `interface DriveResult { boards: DriveBoard[]; timeline: { t: number; uid: string; pin: string; state: string }[]; findings: (SimFinding | RunFinding)[]; simulatedMs: number; solves: { t: number; outcome: SimOutcome }[]; neverPauses: string[]; lostPower: string[]; incomplete: { uid: string; why: string }[] }`
  - `function drive(o: DriveOptions): Promise<DriveResult>`; `function stateText(s: RunPinState): string` (`high`, `low`, `input-pullup`, `pwm 50%`)
  - `src/run/sheets.testing.ts`: `piBlink()`, `piButton(code: string)`, `piSwitched()` (Pi 4 test sheets, each a `Diagram` with code on `u1`)

- [ ] **Step 1: The test sheets**

`src/run/sheets.testing.ts`:

```ts
// Pi 4 sheets for the run tests: a 5 V supply on the header, an LED on GPIO17 through 330 ohm, a
// push button from GPIO27 to ground; code on U1 (uid u1).
import type { Diagram } from '../format/diagram.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const withCode = (d: Diagram, source: string, file = 'main.py'): Diagram => ({ ...d, parts: d.parts.map((p) => (p.uid === 'u1' ? { ...p, code: { language: 'python-rpi', source, file } } : p)) })

export const BLINK = 'from gpiozero import LED\nfrom signal import pause\n\nled = LED(17)\nled.blink()\npause()\n'

function pi(extra: Parameters<typeof sheet>[0] = [], wires: [string, string][] = []): Diagram {
  return sheet(
    [{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 330, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }, { uid: 's1', module: 'push-button' }, ...extra],
    [['bt1.-', 'u1.GND'], ['u1.GPIO17', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND 2'], ['u1.GPIO27', 's1.1'], ['s1.2', 'u1.GND 3'], ...wires],
  )
}

export const piBlink = (source = BLINK): Diagram => withCode(pi([], [['bt1.+', 'u1.5V']]), source, 'blink.py')
export const piButton = (source: string): Diagram => withCode(pi([], [['bt1.+', 'u1.5V']]), source)
/** The supply reaches the Pi through a closed rocker switch (SW1, uid sw1), so a press can cut it. */
export const piSwitched = (source: string): Diagram =>
  withCode(pi([{ uid: 'sw1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }], [['bt1.+', 'sw1.1'], ['sw1.2', 'u1.5V']]), source)
```

- [ ] **Step 2: Write the failing test**

`src/run/driver.test.ts`:

```ts
// Firmware spec 7 and 10 (integration on the virtual clock): blink toggles GPIO17 at exactly 1 Hz for
// 3 s and the LED's averaged current is half its on current; --press fires when_pressed, even a press
// shorter than a solve; a busy-wait on time.time() ends and a polling loop sees a press; a script that
// never yields is stopped after the real-time limit; cutting the supply stops the board ("lost power");
// an unpowered board does not start. Every run is deterministic.
import { afterAll, describe, expect, it } from 'vitest'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { type DriveOptions, drive } from './driver.ts'
import { nodePy } from './testing.ts'
import { piBlink, piButton, piSwitched } from './sheets.testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const run = (o: Partial<DriveOptions> & Pick<DriveOptions, 'diagram'>) => drive({ boards: ['u1'], forMs: 5000, inputs: [], presses: [], engine, py: nodePy(), ...o })
const serial = (r: Awaited<ReturnType<typeof run>>) => r.boards[0].serial.map((s) => s.text).join('')

describe('circuitoon run on the virtual clock (spec 7, 10)', () => {
  it('toggles GPIO17 at exactly 1 Hz for 3 s, with the LED averaging half its on current', async () => {
    const r = await run({ diagram: piBlink(), forMs: 3500 })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => [Math.round(e.t), e.state])).toEqual([[0, 'high'], [1000, 'low'], [2000, 'high'], [3000, 'low']])
    // The LED's current over 0..3 s, piecewise from each solve.
    const led = (o: (typeof r.solves)[number]['outcome']) => (o.status === 'ok' && o.result.corners.typical.parts.d1.pins.A.kind === 'value' ? (o.result.corners.typical.parts.d1.pins.A as { value: number }).value : 0)
    const steps = r.solves.filter((s) => s.t <= 3000)
    let charge = 0
    steps.forEach((s, i) => (charge += led(s.outcome) * ((steps[i + 1]?.t ?? 3000) - s.t)))
    const on = Math.max(...steps.map((s) => led(s.outcome)))
    expect(charge / 3000 / on).toBeCloseTo(2 / 3, 2)
    expect(r.boards[0].status).toBe('stopped')
    expect(r.simulatedMs).toBe(3500)
  }, 120_000)
  it('repeats exactly', async () => {
    const a = await run({ diagram: piBlink(), forMs: 2500 })
    const b = await run({ diagram: piBlink(), forMs: 2500 })
    expect(b.timeline).toEqual(a.timeline)
  }, 120_000)
  it('fires when_pressed on --press, even for a press shorter than a solve', async () => {
    const code = "from gpiozero import Button\nfrom signal import pause\nimport time\nb = Button(27)\nb.when_pressed = lambda: print('pressed', round(time.monotonic(), 2))\npause()\n"
    expect(serial(await run({ diagram: piButton(code), forMs: 3000, presses: [{ uid: 's1', atMs: 1500, forMs: 200 }] }))).toBe('pressed 1.5\n')
    expect(serial(await run({ diagram: piButton(code), forMs: 3000, presses: [{ uid: 's1', atMs: 1500, forMs: 1 }] }))).toBe('pressed 1.5\n')
  }, 120_000)
  it('ends a busy-wait on time.time(), and lets a polling loop see a press', async () => {
    const busy = await run({ diagram: piButton("import time\nend = time.time() + 1\nwhile time.time() < end:\n    pass\nprint('done', round(time.monotonic(), 1))\n") })
    expect([serial(busy), busy.boards[0].status]).toEqual(['done 1.0\n', 'done'])
    const poll = await run({ diagram: piButton("import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile GPIO.input(27):\n    pass\nprint('seen', round(time.monotonic(), 2))\n"), presses: [{ uid: 's1', atMs: 1500, forMs: 200 }] })
    expect(serial(poll)).toBe('seen 1.5\n')
  }, 120_000)
  it('stops a script that never yields after the real-time limit', async () => {
    const r = await run({ diagram: piButton('while True:\n    pass\n'), realLimitMs: 2000 })
    expect(r.neverPauses).toEqual(['u1'])
    expect(r.boards[0].status).toBe('error')
    expect(serial(r)).toContain("U1's code never pauses")
  }, 120_000)
  it('stops a board that loses power, and does not start one with none', async () => {
    const cut = await run({ diagram: piSwitched(BLINK_FOREVER), forMs: 3000, presses: [{ uid: 'sw1', atMs: 1000, forMs: 0 }] })
    expect(cut.lostPower).toEqual(['u1'])
    expect(cut.boards[0].serial.some((s) => s.stream === 'note' && s.text === 'U1 lost power\n')).toBe(true)
    const open = { ...piSwitched(BLINK_FOREVER) }
    open.parts = open.parts.map((p) => (p.uid === 'sw1' ? { ...p, values: { 'contact.s': 'open' } } : p))
    const none = await run({ diagram: open })
    expect(none.incomplete).toEqual([{ uid: 'u1', why: 'U1 has no power: connect 5V and GND' }])
    expect(none.boards[0].status).toBe('not-started')
  }, 120_000)
})

const BLINK_FOREVER = 'from gpiozero import LED\nfrom signal import pause\nLED(17).blink()\npause()\n'
```

The averaged LED current: `blink()` is on 1 s, off 1 s; over 0 to 3 s it is on for 0 to 1 and 2 to 3, so two thirds (the test integrates the solved LED current, so the solves' timing is what is checked).

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/run/driver.test.ts`
Expected: FAIL, `./driver.ts` cannot be found.

- [ ] **Step 4: Write `src/run/driver.ts`**

```ts
// circuitoon run's driver (firmware spec 7, ruling R16): the boards' code in Node workers on a virtual
// clock. Every wait reports where its board is and until when; when every board waits, the driver
// moves the clock to the earliest of those, the next press or release and the end; samples; solves
// when a run pin state, a code sequence, a press or a servo's motion changed; writes the inputs back;
// and grants every board its clock (H.grant: other wakes never move a board). Pin reads and time calls step 10 us and sync at the horizon (the next 16 ms,
// press or end), so busy-waits end and polling loops reach presses. Deterministic: the same sheet and
// options give the same run. A board that sends nothing for `realLimitMs` of real time never pauses.
import type { Diagram } from '../format/diagram.ts'
import { RUNNABLE, languagesOf } from '../format/code.ts'
import type { ModuleDef } from '../format/module.ts'
import { simOf, withLibraryData } from '../format/simModel.ts'
import { type RunPinState, type RunPins, contactPosition, isActive, switchGroups } from '../format/simState.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import type { Engine } from '../sim/engine/engine.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimFinding, SimOutcome } from '../sim/results.ts'
import { solve } from '../sim/session.ts'
import { boardKindOf } from './boards.ts'
import { type CoreBoard, NEVER_PAUSES, RunCore, type RunFinding } from './core.ts'
import { BoardRun, type CodeWorkerLike } from './host.ts'
import { H, INPUT, grant, writeLine } from './memory.ts'
import { spawnNodeCodeWorker } from './node/codeWorker.ts'
import { LOST_POWER, NO_POWER, boardPower, underVoltage, underVoltageNote } from './power.ts'
import type { RunStatus } from './protocol.ts'
import { PY_FILES } from './pyFiles.ts'

export interface Press { uid: string; atMs: number; forMs: number }
export interface DriveOptions {
  diagram: Diagram
  boards: string[]
  forMs: number
  inputs: string[]
  presses: Press[]
  engine: Engine
  py: { indexURL: string; lock: string }
  spawn?: () => CodeWorkerLike
  /** Real time a board may run without yielding (spec 7: 5 s). */
  realLimitMs?: number
  library?: ModuleLookup
}
export interface SerialEntry { t: number; stream: 'out' | 'err' | 'note'; text: string }
export interface DriveBoard { uid: string; ref: string; status: RunStatus | 'not-started'; serial: SerialEntry[] }
export interface DriveResult {
  boards: DriveBoard[]
  timeline: { t: number; uid: string; pin: string; state: string }[]
  findings: (SimFinding | RunFinding)[]
  simulatedMs: number
  /** Every solve, in order (tests integrate readings over time; the CLI does not print them). */
  solves: { t: number; outcome: SimOutcome }[]
  neverPauses: string[]
  lostPower: string[]
  incomplete: { uid: string; why: string }[]
}

export const stateText = (s: RunPinState): string => (typeof s === 'string' ? s : `pwm ${Number((s.pwm * 100).toFixed(1))}%`)

interface Live { b: DriveBoard; run: BoardRun; module: ModuleDef; blocked: { nowMs: number; untilMs: number } | null; t: number; heard: number; ended: boolean; noted: boolean }

/** A latching switch flipped (ruling R17: a press on a latching switch flips it at its time). */
function flipped(d: Diagram, uid: string): Diagram {
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const m = d.modules[p.module]
      const g = switchGroups(m).find((x) => x.kind === 'switch' && !x.momentary)
      if (!g) return p
      const on = isActive(contactPosition(p, m, g))
      return { ...p, values: { ...p.values, [`contact.${g.id}`]: g.changeover ? (on ? 'nc' : 'no') : on ? 'open' : 'closed' } }
    }),
  }
}

export async function drive(o: DriveOptions): Promise<DriveResult> {
  const library = o.library ?? libraryLookup
  const realLimit = o.realLimitMs ?? 5000
  const res: DriveResult = { boards: [], timeline: [], findings: [], simulatedMs: 0, solves: [], neverPauses: [], lostPower: [], incomplete: [] }
  let sheet = o.diagram
  let held: { part: string; group: string } | null = null
  // Presses become events: a button is held from its time for its length; a latching switch flips.
  const events: { atMs: number; apply: () => void }[] = []
  for (const p of o.presses) {
    const part = sheet.parts.find((x) => x.uid === p.uid)!
    const group = switchGroups(sheet.modules[part.module]).find((g) => g.momentary)
    if (group) events.push({ atMs: p.atMs, apply: () => (held = { part: p.uid, group: group.id }) }, { atMs: p.atMs + p.forMs, apply: () => (held = null) })
    else events.push({ atMs: p.atMs, apply: () => (sheet = flipped(sheet, p.uid)) })
  }
  events.sort((a, b) => a.atMs - b.atMs)

  const seen = new Set<string>()
  const addFindings = (list: (SimFinding | RunFinding)[]) => {
    for (const f of list) {
      const key = `${f.code}|${f.message}`
      if (!seen.has(key)) (seen.add(key), res.findings.push(f))
    }
  }
  let revision = 0
  let last = null as { outcome: SimOutcome; circuit: Circuit } | null
  let pins: RunPins = {}
  let seq: Record<string, number> = {}
  let moving: string[] = []
  const solveAt = async (t: number) => {
    last = await solve(sheet, o.engine, ++revision, { library, held, runPins: pins, moving, runSeq: seq })
    res.solves.push({ t, outcome: last.outcome })
    addFindings(last.outcome.status === 'ok' ? last.outcome.result.findings : last.outcome.status === 'failed' ? [last.outcome.finding, ...last.outcome.findings] : last.outcome.findings)
    return last
  }

  // A message from a board re-runs the settle check (set while settling).
  let notify = () => {}
  // Which boards can start (spec 7 exit 3): code, a language they run, sim data, and power.
  const first = await solveAt(0)
  const live: Live[] = []
  const core = new RunCore()
  for (const uid of o.boards) {
    const part = sheet.parts.find((p) => p.uid === uid)
    const b: DriveBoard = { uid, ref: part?.designator ?? uid, status: 'not-started', serial: [] }
    res.boards.push(b)
    const stored = part && sheet.modules[part.module]
    const m = stored && withLibraryData(stored, library)
    const kind = boardKindOf(m)
    const why = !part || !m || !kind ? `${b.ref} is not a board that runs code`
      : !part.code ? `${b.ref} has no code`
      : !RUNNABLE.includes(part.code.language) || !languagesOf(m).includes(part.code.language) ? `${b.ref} cannot run its code (${part.code.language})`
      : !simOf(m)?.power ? `${b.ref} has no simulation data`
      : first.outcome.status !== 'ok' || !boardPower(first.circuit, first.outcome.result, uid).powered ? NO_POWER(b.ref)
      : null
    if (why) {
      res.incomplete.push({ uid, why })
      continue
    }
    const entry: Live = { b, module: m!, blocked: null, t: 0, heard: performance.now(), ended: false, noted: false, run: null as unknown as BoardRun }
    entry.run = new BoardRun({
      board: kind!, source: part!.code!.source, file: part!.code!.file ?? 'main.py', mode: 'virtual', py: o.py, files: PY_FILES, spawn: o.spawn ?? spawnNodeCodeWorker,
      on: (msg) => {
        if (msg.type === 'block') (entry.blocked = { nowMs: msg.nowMs, untilMs: msg.untilMs }), (entry.t = msg.nowMs), (entry.heard = performance.now())
        else if (msg.type === 'ready') entry.heard = performance.now()
        else if (msg.type === 'out') b.serial.push({ t: entry.t, stream: msg.stream, text: msg.text })
        else if (msg.type === 'exit' || msg.type === 'fatal') {
          if (msg.type === 'fatal') b.serial.push({ t: entry.t, stream: 'err', text: `${msg.error}\n` })
          entry.ended = true
        }
        notify()
      },
    })
    live.push(entry)
    core.add({ uid, ref: b.ref, memory: entry.run.memory, module: m! })
    entry.run.start()
  }

  /** Resolves when every live board waits or has ended; stops a board that never pauses. */
  const settle = () => new Promise<void>((resolve) => {
    const check = () => {
      const now = performance.now()
      for (const e of live)
        if (!e.ended && !e.blocked && e.run.status !== 'starting' && now - e.heard > realLimit) {
          e.ended = true
          e.b.serial.push({ t: e.t, stream: 'note', text: `${NEVER_PAUSES(e.b.ref)}\n` })
          res.neverPauses.push(e.b.uid)
          void e.run.stop()
        }
      if (live.every((e) => e.ended || e.blocked)) {
        clearInterval(timer)
        notify = () => {}
        resolve()
      }
    }
    const timer = setInterval(check, 100)
    notify = check
    check()
  })

  let T = 0
  const at = (b: CoreBoard) => Math.max(T, live.find((e) => e.b.uid === b.uid)?.t ?? 0)
  // A solve is due: the first step, and after a press or release.
  let pending = true
  let idle = 0
  const shown = new Map<string, string>()
  for (;;) {
    await settle()
    for (const e of live) if (e.ended && core.boards.some((b) => b.uid === e.b.uid)) core.remove(e.b.uid)
    const running = live.filter((e) => !e.ended)
    if (!running.length) break
    // Boards step 10 us per call, so the present is at least where the slowest of them is.
    T = Math.max(T, Math.min(...running.map((e) => e.blocked!.nowMs)))
    // The present: sample where the boards are, and solve when anything changed.
    const s = core.sample(at)
    addFindings(s.findings)
    pins = s.pins
    seq = s.seq
    for (const [uid, byPin] of Object.entries(pins))
      for (const [pin, st] of Object.entries(byPin)) {
        const text = stateText(st)
        if (shown.get(`${uid}|${pin}`) !== text) {
          res.timeline.push({ t: T, uid, pin, state: text })
          shown.set(`${uid}|${pin}`, text)
        }
      }
    const sv = core.servos(sheet, last?.circuit ?? null, T, library)
    addFindings(sv.findings)
    const moved = JSON.stringify(sv.moving) !== JSON.stringify(moving)
    moving = sv.moving
    let woke = false
    if (s.changed || pending || moved) {
      pending = false
      woke = true
      const r = await solveAt(T)
      const a = core.apply(r.outcome, r.circuit, seq, at)
      addFindings(a.findings)
      for (const e of running) {
        const p = a.power[e.b.uid]
        if (!p || e.ended) continue
        if (!p.powered) {
          e.b.serial.push({ t: T, stream: 'note', text: `${LOST_POWER(e.b.ref)}\n` })
          res.lostPower.push(e.b.uid)
          e.ended = true
          await e.run.stop()
        } else if (underVoltage(p) && !e.noted) {
          e.noted = true
          e.b.serial.push({ t: T, stream: 'note', text: `${underVoltageNote(e.b.ref, p.inputVolts!)}\n` })
        }
      }
    }
    for (const e of running)
      if (!e.ended && Atomics.load(e.run.memory.i32, H.inputState) === INPUT.waiting && o.inputs.length) {
        writeLine(e.run.memory, o.inputs.shift()!)
        woke = true
      }
    if (T >= o.forMs) {
      await Promise.all(running.filter((e) => !e.ended).map((e) => e.run.stop()))
      break
    }
    if (!woke) {
      // Nothing new now: move the clock to the next thing that happens.
      T = Math.max(T, Math.min(...running.filter((e) => !e.ended).map((e) => e.blocked!.untilMs), events[0]?.atMs ?? Infinity, o.forMs))
      while (events.length && events[0].atMs <= T) {
        events.shift()!.apply()
        pending = true
      }
      // A press or the end is solved at its time before any board moves on.
      if (pending || T >= o.forMs) continue
    }
    if (++idle > 100_000) throw new Error(`the run made no progress at ${T} ms`)
    if (!woke) idle = 0
    const horizon = Math.min(T + 16, events[0]?.atMs ?? Infinity, o.forMs)
    for (const e of running) {
      if (e.ended) continue
      e.blocked = null
      // Its clock jumps to at least T, so what it prints next is stamped from there.
      e.t = Math.max(e.t, T)
      e.heard = performance.now()
      // The grant last: the inputs and lines written above only woke it; this lets it move (ruling R16).
      grant(e.run.memory, T, horizon)
    }
  }
  await Promise.all(live.map((e) => e.run.done))
  for (const e of live) e.b.status = res.neverPauses.includes(e.b.uid) ? 'error' : e.run.status
  res.simulatedMs = T
  return res
}
```

Notes for the implementer:
- `notify` is reassigned inside `settle`; the board's `on` callback calls whatever `notify` is current, so a message wakes the check immediately.
- Each step first samples and solves the present (where the boards wait), and wakes them at the same time when a solve or a line of input may have satisfied a wait; only a step with nothing new advances the clock. A press is applied at its time and solved before any board moves on.
- A board that ends during the run (its script returned) is removed from `RunCore`, so its pins stop being sampled and the saved states apply again.
- `T` only moves forward; a board whose own time is ahead (it stepped 10 us per call) is sampled at its own time (`at`), never behind its last write.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run/driver.test.ts`
Expected: PASS (6 tests). These run real Pyodide workers and real solves; each finishes in seconds on a quiet machine.

- [ ] **Step 6: Commit**

```bash
git add src/run/driver.ts src/run/driver.test.ts src/run/sheets.testing.ts
git commit -m "$(cat <<'MSG'
Run: the virtual-clock driver (deterministic runs, presses, inputs, lost power, the never-pauses limit)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# Phase E: the editor (spec 11 step 5)

UI tasks follow the repo's way of testing the editor: logic in plain modules gets vitest tests; every component and visual state gets a case in a browser check (playwright-core on our own Chrome, never the Playwright MCP) that asserts the DOM and takes screenshots in light and dark, and each screenshot is opened and looked at before the task is done. The frontend-design skill applies to every new surface: the dock, Serial and the Inspector section use the editor's Sticker look (1.5 px ink edges, 2 px offset shadows, Fredoka headings, Atkinson body, the yellow accent), never a templated default.

### Task 31: The store's run state, code ops, and the simulation following run pin states

**Files:**
- Create: `src/editor/run.test.ts`
- Modify: `src/editor/store.ts` (run, dock, link-code state), `src/editor/ops.ts` (`setPartCode`), `src/editor/simulation.ts` (`solveKey`, `followStore`, `useSimulation`), `src/editor/simEngine.ts` (`startSession`)

**Interfaces:**
- Consumes: `RunPins` (Task 20), `RunFinding`, `ServoView` (Task 29, types only), `RunStatus` (Task 17, type only), `PartCode` (Task 4), `SimSession.setRunning` and the third `onOutcome` argument (Task 25).
- Produces (`src/editor/store.ts`):
  - `interface SerialLine { text: string; stream: 'out' | 'err' | 'note' | 'echo' }`; `const SERIAL_MAX = 5000`
  - `interface BoardRunView { status: RunStatus | 'idle'; source: string; file: string; serial: SerialLine[]; prompt: string | null; progress: { loaded: number; total: number } | null; message: string | null }`
  - `interface RunView { boards: Record<string, BoardRunView>; pins: RunPins; seq: Record<string, number>; moving: string[]; servos: Record<string, ServoView>; findings: RunFinding[] }`; `const EMPTY_RUN: RunView`
  - `interface DockState { open: boolean; tab: string | null; height: number }`; `const DOCK_HEIGHT_KEY = 'circuitoon.dockHeight'`
  - `EditorState` gains `run: RunView`, `dock: DockState`, `linkCode: boolean`; `SimView`'s `done` phase gains `runSeq?: Record<string, number>`
  - `new EditorStore(diagram, opts?: { linkCode?: boolean })`; methods `setRun(patch: Partial<RunView>)`, `setBoardRun(uid: string, patch: Partial<BoardRunView> | null)`, `appendSerial(uid: string, lines: SerialLine[])`, `setDock(patch: Partial<DockState>)`, `confirmLinkCode()`, getter `activeRuns: string[]` (status starting or running)
- Produces (`src/editor/ops.ts`): `function setPartCode(d: Diagram, uid: string, code: PartCode | undefined): Diagram`
- Produces (`src/editor/simulation.ts`): `function solveKey(d: Diagram, held: unknown, run?: { pins: RunPins; moving: string[]; seq: Record<string, number> }): string`; `followStore(store, request: (d: Diagram, held: EditorState['held'], run: { pins: RunPins; moving: string[]; seq: Record<string, number> }) => void)`

- [ ] **Step 0: Record the main bundle's size before the editor changes**

Run: `npm run build && node -e "const fs=require('fs'),z=require('zlib');for(const f of fs.readdirSync('dist/assets').filter(x=>/^index-.*\.js$/.test(x)))console.log(f,z.gzipSync(fs.readFileSync('dist/assets/'+f)).length)"`
Write the `index-*.js` gzip size into the ledger as the baseline (spec 9: the main bundle may grow at most 20 KB gzip for the dock shell; Task 37 checks it).

- [ ] **Step 1: Write the failing test**

`src/editor/run.test.ts`:

```ts
// Firmware spec 2.3, 3.1, 4.1, 5.3: run state lives in the store but never in the sheet: no undo
// entry, the file not marked changed. Code edits are undoable commits and typing coalesces. Serial
// keeps the last 5,000 lines. The solve key follows run pin states, and run-state solves continue
// during a drag; the netlist part of the key is cached by diagram identity.
import { describe, expect, it } from 'vitest'
import { EditorStore, SERIAL_MAX } from './store.ts'
import { setPartCode } from './ops.ts'
import { followStore, solveKey } from './simulation.ts'
import { piBlink } from '../run/sheets.testing.ts'

const code = { language: 'python-rpi', source: 'print(1)\n', file: 'main.py' }

describe('run state in the editor store', () => {
  it('keeps run state out of the sheet: no undo entry, not marked changed', () => {
    const s = new EditorStore(piBlink())
    s.setRun({ pins: { u1: { GPIO17: 'high' } }, seq: { u1: 3 } })
    s.setBoardRun('u1', { status: 'running', source: 'x', file: 'blink.py', serial: [], prompt: null, progress: null, message: null })
    expect([s.canUndo, s.dirty]).toEqual([false, false])
    expect(s.getState().run.pins).toEqual({ u1: { GPIO17: 'high' } })
    expect(s.activeRuns).toEqual(['u1'])
    s.setBoardRun('u1', null)
    expect(s.getState().run.boards).toEqual({})
  })
  it('keeps the last 5,000 Serial lines', () => {
    const s = new EditorStore(piBlink())
    s.setBoardRun('u1', { status: 'running', source: '', file: 'main.py', serial: [], prompt: null, progress: null, message: null })
    for (let i = 0; i < 6; i++) s.appendSerial('u1', Array.from({ length: 1000 }, (_, k) => ({ text: `${i * 1000 + k}`, stream: 'out' as const })))
    const serial = s.getState().run.boards.u1.serial
    expect(serial).toHaveLength(SERIAL_MAX)
    expect(serial[0].text).toBe('1000')
  })
  it('makes code edits undoable, typing coalescing into one step', () => {
    const s = new EditorStore(piBlink())
    const d0 = s.getState().diagram
    s.commit(setPartCode(d0, 'u1', { ...code, source: 'a' }), 'code:u1')
    s.commit(setPartCode(s.getState().diagram, 'u1', { ...code, source: 'ab' }), 'code:u1')
    expect(s.getState().diagram.parts.find((p) => p.uid === 'u1')?.code?.source).toBe('ab')
    s.undo()
    expect(s.getState().diagram).toBe(d0)
    expect(setPartCode(d0, 'u1', d0.parts.find((p) => p.uid === 'u1')!.code)).toBe(d0)
    const removed = setPartCode(d0, 'u1', undefined)
    expect('code' in removed.parts.find((p) => p.uid === 'u1')!).toBe(false)
  })
  it('remembers a link with code until the first Run is confirmed', () => {
    const s = new EditorStore(piBlink(), { linkCode: true })
    expect(s.getState().linkCode).toBe(true)
    s.confirmLinkCode()
    expect(s.getState().linkCode).toBe(false)
  })
})

describe('the simulation follows run pin states (spec 2.3, 4.1)', () => {
  it('changes the solve key with run pin states and servo motion only', () => {
    const d = piBlink()
    expect(solveKey(d, null, { pins: { u1: { GPIO17: 'high' } }, moving: [], seq: {} })).not.toBe(solveKey(d, null, { pins: { u1: { GPIO17: 'low' } }, moving: [], seq: {} }))
    expect(solveKey(d, null, { pins: {}, moving: ['m1'], seq: {} })).not.toBe(solveKey(d, null, { pins: {}, moving: [], seq: {} }))
    // A re-setup alone (a new code sequence) re-solves: spec 4.4's read after setup waits for a result solved through that sequence.
    expect(solveKey(d, null, { pins: {}, moving: [], seq: { u1: 2 } })).not.toBe(solveKey(d, null, { pins: {}, moving: [], seq: { u1: 1 } }))
    expect(solveKey(d, null)).toBe(solveKey(d, null, { pins: {}, moving: [], seq: {} }))
  })
  it('requests a solve for a run-state change even mid-drag, and not for a plain drag frame', () => {
    const s = new EditorStore(piBlink())
    s.setSimulate(true)
    const calls: unknown[] = []
    const stop = followStore(s, (_d, _h, run) => calls.push(run.pins))
    expect(calls).toHaveLength(1)
    const base = s.begin()
    s.preview({ ...base, parts: base.parts.map((p) => (p.uid === 'd1' ? { ...p, x: p.x + 10 } : p)) })
    expect(calls).toHaveLength(1)
    s.setRun({ pins: { u1: { GPIO17: 'high' } } })
    expect(calls).toEqual([{}, { u1: { GPIO17: 'high' } }])
    s.end()
    stop()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/editor/run.test.ts`
Expected: FAIL: `SERIAL_MAX` is not exported from `./store.ts`.

- [ ] **Step 3: The store**

In `src/editor/store.ts`:
- imports: `import type { RunPins } from '../format/simState.ts'`, `import type { RunFinding, ServoView } from '../run/core.ts'`, `import type { RunStatus } from '../run/protocol.ts'`;
- `SimView`'s done variant becomes `{ phase: 'done'; outcome: SimOutcome; circuit: Circuit | null; runSeq?: Record<string, number> }` (the code sequences the solve's run pin states were sampled at);
- add, after `SimView`:

```ts
/** One Serial line (firmware spec 5.3): output, an error, a note from the simulator, or the echo of a typed line. */
export interface SerialLine { text: string; stream: 'out' | 'err' | 'note' | 'echo' }
/** Serial keeps this many lines (spec 5.3). */
export const SERIAL_MAX = 5000
/** One board's run in the editor (spec 2.1, 6.1). `source` is what it started with, so the dock can say "Code changed". */
export interface BoardRunView {
  status: RunStatus | 'idle'
  source: string
  file: string
  serial: SerialLine[]
  /** input() is waiting, with this prompt. */
  prompt: string | null
  /** The first Run's download. */
  progress: { loaded: number; total: number } | null
  /** Why Run did not start, or why the board stopped ("U1 has no power: connect 5V and GND"). */
  message: string | null
}
/** Live run state (spec 2.3): transient like `held`; never saved, never undo history. */
export interface RunView {
  boards: Record<string, BoardRunView>
  pins: RunPins
  seq: Record<string, number>
  moving: string[]
  servos: Record<string, ServoView>
  findings: RunFinding[]
}
export const EMPTY_RUN: RunView = { boards: {}, pins: {}, seq: {}, moving: [], servos: {}, findings: [] }
/** The code dock (spec 6.1): open or collapsed, the tab shown, and its height (remembered per browser). */
export interface DockState { open: boolean; tab: string | null; height: number }
export const DOCK_HEIGHT_KEY = 'circuitoon.dockHeight'
const DOCK_HEIGHT = 260
function loadDockHeight(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(DOCK_HEIGHT_KEY))
    return v >= 120 ? v : DOCK_HEIGHT
  } catch {
    return DOCK_HEIGHT
  }
}
```

- `EditorState` gains:
  ```ts
    /** Code running on boards (firmware spec 2.3). Not saved. */
    run: RunView
    dock: DockState
    /** The sheet came from a link with code on it, and its first Run has not been confirmed (spec 2.6). */
    linkCode: boolean
  ```
- the constructor becomes `constructor(diagram: Diagram, opts: { linkCode?: boolean } = {})` and its state gains `run: EMPTY_RUN, dock: { open: true, tab: null, height: loadDockHeight() }, linkCode: !!opts.linkCode`;
- `load(diagram)` also resets `run: EMPTY_RUN, linkCode: false` (the controller stops every board when the sheet is replaced: Task 32);
- methods:

```ts
  setRun(patch: Partial<RunView>) {
    this.set({ run: { ...this.state.run, ...patch } })
  }
  /** Sets (or with null, forgets) one board's run view. */
  setBoardRun(uid: string, patch: Partial<BoardRunView> | null) {
    const boards = { ...this.state.run.boards }
    if (patch === null) delete boards[uid]
    else boards[uid] = { status: 'idle', source: '', file: 'main.py', serial: [], prompt: null, progress: null, message: null, ...boards[uid], ...patch }
    this.setRun({ boards })
  }
  /** Adds Serial lines, keeping the last SERIAL_MAX (spec 5.3). */
  appendSerial(uid: string, lines: SerialLine[]) {
    const b = this.state.run.boards[uid]
    if (!b || !lines.length) return
    const serial = [...b.serial, ...lines]
    this.setBoardRun(uid, { serial: serial.length > SERIAL_MAX ? serial.slice(serial.length - SERIAL_MAX) : serial })
  }
  setDock(patch: Partial<DockState>) {
    const dock = { ...this.state.dock, ...patch }
    if (patch.height !== undefined)
      try {
        globalThis.localStorage?.setItem(DOCK_HEIGHT_KEY, String(Math.round(dock.height)))
      } catch {
        // storage refused: the height is kept for this page only
      }
    this.set({ dock })
  }
  confirmLinkCode() {
    if (this.state.linkCode) this.set({ linkCode: false })
  }
  /** Boards starting or running. */
  get activeRuns(): string[] {
    return Object.entries(this.state.run.boards).filter(([, b]) => b.status === 'starting' || b.status === 'running').map(([uid]) => uid)
  }
```

- [ ] **Step 4: The code op**

Append to `src/editor/ops.ts` (import `type PartCode` from `'../format/code.ts'`):

```ts
/** Sets a board's code (firmware spec 3.1), or removes it with undefined. Same diagram when nothing changes. */
export function setPartCode(d: Diagram, uid: string, code: PartCode | undefined): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part) return d
  if (code === undefined ? part.code === undefined : part.code !== undefined && part.code.language === code.language && part.code.source === code.source && part.code.file === code.file) return d
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { code: _old, ...rest } = p
      return code === undefined ? rest : { ...rest, code }
    }),
  }
}
```

- [ ] **Step 5: The simulation follows run state**

In `src/editor/simulation.ts` (import `type RunPins` from `'../format/simState.ts'`):

```ts
const netKeys = new WeakMap<object, { parts: unknown; key: string }>()
/** The connectivity part of the key, cached by the diagram's connections and parts (firmware spec 4.1: per-sample keys stay cheap). */
function netsKey(d: Diagram): string {
  const hit = netKeys.get(d.connections)
  if (hit && hit.parts === d.parts) return hit.key
  const key = JSON.stringify(netlist(d).nets)
  netKeys.set(d.connections, { parts: d.parts, key })
  return key
}
const NO_RUN = { pins: {}, moving: [] as string[], seq: {} }

/** What decides a solve: connectivity (mounts included), values, settings, module identity, probes, a held button, run pin states, moving servos and each board's code sequence. Never positions, never frequencies. */
export function solveKey(d: Diagram, held: unknown, run: { pins: RunPins; moving: string[]; seq: Record<string, number> } = NO_RUN): string {
  return JSON.stringify([
    netsKey(d),
    d.parts.map((p) => [p.uid, p.module, p.values ?? null, p.settings ?? null]),
    Object.entries(d.modules).map(([k, m]) => [k, idOf(m)]).sort(),
    d.probes ?? null,
    held,
    run.pins,
    run.moving,
    run.seq,
  ])
}
```

and replace `followStore` with:

```ts
/**
 * Calls `request` now and after every store change that changes the solve key, except on drag frames
 * (the drop solves), unless a button is pressed or released (a still part drag) or a running board's
 * pins changed (firmware spec 2.1: run-state solves continue during drags). Returns the unsubscribe.
 */
export function followStore(store: EditorStore, request: (d: Diagram, held: EditorState['held'], run: { pins: RunPins; moving: string[]; seq: Record<string, number> }) => void): () => void {
  let key = ''
  let seen: unknown[] | null = null
  const check = () => {
    const { diagram: d, held, simulate, run } = store.getState()
    if (!simulate) return
    const now = [d.parts, d.connections, d.modules, d.probes, held, run.pins, run.moving, run.seq]
    const runMoved = !seen || now[5] !== seen[5] || now[6] !== seen[6] || now[7] !== seen[7]
    // A press and its release both solve, even mid-drag (the release may come before the drop).
    if (store.dragging && !held && !seen?.[4] && !runMoved) return
    if (seen && now.every((x, i) => x === seen![i])) return
    seen = now
    const next = solveKey(d, held, run)
    if (next === key) return
    key = next
    request(d, held, { pins: run.pins, moving: run.moving, seq: run.seq })
  }
  const unsubscribe = store.subscribe(check)
  check()
  return unsubscribe
}
```

In `useSimulation`, inside the `.then(({ startSession }) => {...})`:

```ts
        const session = startSession(
          (outcome, circuit, runSeq) => store.setSim({ phase: 'done', outcome, circuit: circuit ?? null, runSeq }),
          (loaded, total) => store.getState().sim?.phase !== 'done' && store.setSim({ phase: 'loading', loaded, total }),
        )
        let revision = 0
        // Running mode (spec 2.4) while any board starts or runs.
        const running = () => session.setRunning(store.activeRuns.length > 0)
        const unRunning = store.subscribe(running)
        running()
        const unsubscribe = followStore(store, (d, held, run) => session.request(d, ++revision, held, run))
        stop = () => {
          session.stop()
          unsubscribe()
          unRunning()
        }
```

In `src/editor/simEngine.ts` `startSession`:

```ts
/** A session on the page's engine, with the engine's load progress while it lasts; stop() ends both. */
export function startSession(onOutcome: (o: SimOutcome, c: Circuit | undefined, runSeq: Record<string, number> | undefined) => void, onProgress: (loaded: number, total: number) => void) {
  listeners.add(onProgress)
  const session = new SimSession(browserEngine(), (o, c, opts) => onOutcome(o, c, opts?.runSeq))
  return {
    request: (d: Diagram, revision: number, held: { part: string; group: string } | null, run?: { pins: RunPins; moving: string[]; seq: Record<string, number> }) =>
      session.request(d, revision, { held, library: libraryLookup, ...(run ? { runPins: run.pins, moving: run.moving, runSeq: run.seq } : {}) }),
    setRunning: (on: boolean) => session.setRunning(on),
    stop: () => {
      session.stop()
      listeners.delete(onProgress)
    },
  }
}
```

(import `type RunPins` from `'../format/simState.ts'`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/editor`
Expected: PASS (the new tests and every existing editor test).

- [ ] **Step 7: Commit**

```bash
git add src/editor/store.ts src/editor/ops.ts src/editor/simulation.ts src/editor/simEngine.ts src/editor/run.test.ts
git commit -m "$(cat <<'MSG'
Editor: run state in the store (transient), setPartCode, the simulation following run pin states and servo motion

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 32: The editor's run controller, the Pyodide prefetch and what Run needs

**Files:**
- Create: `src/run/browser/prefetch.ts`, `src/editor/runEngine.ts`, `src/editor/running.ts`, `src/editor/runEngine.test.ts`
- Modify: `src/editor/EditorApp.tsx` and `src/editor/Editor.tsx` (pass `linkCode`; dispose the controller with the editor)

**Interfaces:**
- Consumes: Tasks 17 (`BoardRun`, `CodeWorkerLike`, `spawnNodeCodeWorker` in the test), 28 (`boardPower`, `NO_POWER`, `LOST_POWER`, `underVoltage`, `underVoltageNote`), 29 (`RunCore`, `NEVER_PAUSES`), 31 (store); `MAX_RUNNING` (Task 11); `PY_FILES`; `writeLine`, `F`, `H` (Task 12); `followStore`, `SimSession` (the test wires a Node simulation).
- Produces:
  - `src/run/browser/prefetch.ts`: `function pyBase(): string`; `function prefetchPy(onProgress: (loaded: number, total: number) => void, fetchFn?: typeof fetch, base?: string): Promise<{ indexURL: string; lock: string }>` (once per page; hash-checked)
  - `src/editor/running.ts` (main bundle): `const ISOLATION_OFF`, `const RELOAD_FIRST`, `function capText(n: number): string`, `function runBlocker(s: EditorState, uid: string, env?: { isolated: boolean; serviceWorkers: boolean }): string | null`, `function codeBoards(s: EditorState): string[]` (boards with code, in sheet order), `function runAction(store: EditorStore, action: 'run' | 'stop' | 'reset' | 'line' | 'runAll' | 'stopAll', uid?: string, line?: string): void`, `function disposeRuns(store: EditorStore): void`
  - `src/editor/runEngine.ts` (lazy chunk): `class RunController { constructor(store: EditorStore, deps?: { spawn?: () => CodeWorkerLike; prefetch?: typeof prefetchPy; isolated?: () => boolean }); run(uid: string): Promise<void>; stop(uid: string): Promise<void>; reset(uid: string): Promise<void>; sendLine(uid: string, line: string): void; runAll(): Promise<void>; stopAll(): Promise<void>; dispose(): void }`; `function controllerFor(store: EditorStore, deps?: ...): RunController`; `const browserSpawn: () => CodeWorkerLike`

- [ ] **Step 1: Write the failing test**

`src/editor/runEngine.test.ts`:

```ts
// Firmware spec 2.1, 2.3, 4.5, 5.2 to 5.4 in the editor's controller, with the Node code worker and
// the Node engine standing in for the browser's: Run starts (starting, then running) after the first
// solve and refuses an unpowered board; the sampler drives run pin states the session solves; Stop
// restores the saved states and leaves the sheet and its history alone; deleting the board stops it;
// editing its code does not; turning Simulate off stops everything; input() takes a line; losing
// power stops the board; a script that never pauses while blink() waits is told so.
import { afterAll, describe, expect, it } from 'vitest'
import { libraryLookup } from '../agent/catalog.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { SimSession } from '../sim/session.ts'
import { spawnNodeCodeWorker } from '../run/node/codeWorker.ts'
import { nodePy } from '../run/testing.ts'
import { piBlink, piButton, piSwitched } from '../run/sheets.testing.ts'
import { EditorStore } from './store.ts'
import { deleteSelection, setPartCode, setSimValue } from './ops.ts'
import { followStore } from './simulation.ts'
import { RunController } from './runEngine.ts'
import { runBlocker, RELOAD_FIRST, ISOLATION_OFF, capText } from './running.ts'
import { MAX_RUNNING } from '../run/limits.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (ok: () => boolean, ms = 15000) => {
  for (const t0 = Date.now(); !ok(); await sleep(20)) if (Date.now() - t0 > ms) throw new Error('timed out')
}

/** An editor store simulated by the Node engine, as useSimulation does in the browser. */
function editor(d: ReturnType<typeof piBlink>) {
  const store = new EditorStore(d)
  const session = new SimSession(engine, (o, c, opts) => store.setSim({ phase: 'done', outcome: o, circuit: c ?? null, runSeq: opts?.runSeq }))
  let rev = 0
  const unRun = store.subscribe(() => session.setRunning(store.activeRuns.length > 0))
  const unFollow = followStore(store, (dd, held, run) => session.request(dd, ++rev, { held, library: libraryLookup, runPins: run.pins, moving: run.moving, runSeq: run.seq }))
  const c = new RunController(store, { spawn: spawnNodeCodeWorker, prefetch: async () => nodePy(), isolated: () => true })
  const close = () => (c.dispose(), session.stop(), unRun(), unFollow())
  return { store, c, close }
}

describe('the editor run controller (spec 2.1, 2.3, 4.5)', () => {
  it('starts after the first solve, blinks the LED through run pin states, and stops cleanly', async () => {
    const { store, c, close } = editor(piBlink())
    const states: string[] = []
    store.subscribe(() => {
      const s = store.getState().run.pins.u1?.GPIO17
      if (typeof s === 'string' && states.at(-1) !== s) states.push(s)
    })
    const started = c.run('u1')
    expect(store.getState().run.boards.u1.status).toBe('starting')
    expect(store.getState().simulate).toBe(true)
    await started
    await until(() => store.getState().run.boards.u1.status === 'running')
    await until(() => states.includes('low') && states.includes('high'), 4000)
    const d0 = store.getState().diagram
    await c.stop('u1')
    expect(store.getState().run.boards.u1.status).toBe('stopped')
    expect(store.getState().run.pins.u1).toBeUndefined()
    expect([store.getState().diagram, store.canUndo, store.dirty]).toEqual([d0, false, false])
    close()
  }, 60_000)
  it('refuses an unpowered board with the spec\'s words', async () => {
    const d = piSwitched('print(1)\n')
    const { store, c, close } = editor({ ...d, parts: d.parts.map((p) => (p.uid === 'sw1' ? { ...p, values: { 'contact.s': 'open' } } : p)) })
    await c.run('u1')
    expect(store.getState().run.boards.u1).toMatchObject({ status: 'idle', message: 'U1 has no power: connect 5V and GND' })
    close()
  }, 60_000)
  it('stops when the board is deleted, but not when its code is edited (Code changed)', async () => {
    const { store, c, close } = editor(piBlink())
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    const d = store.getState().diagram
    store.commit(setPartCode(d, 'u1', { language: 'python-rpi', source: 'print(2)\n', file: 'blink.py' }), 'code:u1')
    await sleep(200)
    expect(store.getState().run.boards.u1.status).toBe('running')
    expect(store.getState().run.boards.u1.source).not.toBe(store.getState().diagram.parts.find((p) => p.uid === 'u1')!.code!.source)
    store.commit(deleteSelection(store.getState().diagram, { parts: ['u1'], wires: [] }))
    await until(() => store.getState().run.boards.u1?.status !== 'running')
    close()
  }, 60_000)
  it('stops every board when Simulate is turned off', async () => {
    const { store, c, close } = editor(piBlink())
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.setSimulate(false)
    await until(() => store.getState().run.boards.u1.status === 'stopped')
    close()
  }, 60_000)
  it('passes a typed line to input() and echoes it', async () => {
    const { store, c, close } = editor(piButton("print('Hi', input('Name? '))\n"))
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.prompt === 'Name? ')
    c.sendLine('u1', 'Ada')
    await until(() => store.getState().run.boards.u1.status === 'done')
    expect(store.getState().run.boards.u1.serial.map((l) => [l.stream, l.text])).toEqual([['echo', 'Name? Ada'], ['out', 'Hi Ada']])
    close()
  }, 60_000)
  it('stops a board that loses power, saying so', async () => {
    const { store, c, close } = editor(piSwitched('from gpiozero import LED\nfrom signal import pause\nLED(17).blink()\npause()\n'))
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.commit(setSimValue(store.getState().diagram, 'sw1', 'contact.s', 'open'))
    await until(() => store.getState().run.boards.u1.status === 'stopped')
    expect(store.getState().run.boards.u1.serial).toContainEqual({ stream: 'note', text: 'U1 lost power' })
    close()
  }, 60_000)
  it('says once that the code never pauses while blink() waits', async () => {
    const { store, c, close } = editor(piButton('from gpiozero import LED\nLED(17).blink()\nwhile True:\n    pass\n'))
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.serial.some((l) => l.text.includes('never pauses')), 6000)
    expect(store.getState().run.boards.u1.serial.filter((l) => l.text.includes('never pauses'))).toEqual([
      { stream: 'note', text: "U1's code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop." },
    ])
    await c.stop('u1')
    close()
  }, 60_000)
})

describe('what Run needs (spec 2.1, 2.5)', () => {
  it('needs isolation, code, a language the board runs, and room under the cap', () => {
    const s = new EditorStore(piBlink()).getState()
    expect(runBlocker(s, 'u1', { isolated: false, serviceWorkers: false })).toBe(ISOLATION_OFF)
    expect(runBlocker(s, 'u1', { isolated: false, serviceWorkers: true })).toBe(RELOAD_FIRST)
    expect(runBlocker(s, 'u1', { isolated: true, serviceWorkers: true })).toBeNull()
    expect(runBlocker(s, 'd1', { isolated: true, serviceWorkers: true })).toBe('Add code to a board first.')
    const busy = { ...s, run: { ...s.run, boards: Object.fromEntries(Array.from({ length: MAX_RUNNING }, (_, i) => [`x${i}`, { status: 'running' as const, source: '', file: '', serial: [], prompt: null, progress: null, message: null }])) } }
    expect(runBlocker(busy, 'u1', { isolated: true, serviceWorkers: true })).toBe(capText(MAX_RUNNING))
    expect(capText(2)).toBe('Stop a board first: at most 2 run at once')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/editor/runEngine.test.ts`
Expected: FAIL, `./runEngine.ts` cannot be found.

- [ ] **Step 3: The prefetch**

`src/run/browser/prefetch.ts`:

```ts
// The first Run's download (firmware spec 2.7): each pinned Pyodide file fetched with a streamed fetch
// (determinate progress over the manifest's bytes), checked against its sha256, which also warms the
// HTTP cache the worker's loadPyodide then reads from. Once per page; a failure lets the next Run retry.
import PY from '../pyManifest.json'

export const pyBase = (): string => new URL(`${import.meta.env.BASE_URL}py/${PY.version}/`, location.href).href

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
let once: Promise<{ indexURL: string; lock: string }> | null = null

export function prefetchPy(onProgress: (loaded: number, total: number) => void, fetchFn: typeof fetch = fetch, base: string = pyBase()): Promise<{ indexURL: string; lock: string }> {
  once ??= (async () => {
    const total = PY.files.reduce((s, f) => s + f.bytes, 0)
    let loaded = 0
    let lock = ''
    for (const f of PY.files) {
      const res = await fetchFn(base + f.name)
      if (!res.ok || !res.body) throw new Error(`could not load ${f.name} (HTTP ${res.status})`)
      const chunks: Uint8Array[] = []
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress(Math.min(loaded, total), total)
      }
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) (bytes.set(c, at), (at += c.length))
      if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== f.sha256) throw new Error(`${f.name} is not the file this version expects; reload the page`)
      if (f.name === 'pyodide-lock.json') lock = new TextDecoder().decode(bytes)
    }
    return { indexURL: base, lock }
  })()
  once.catch(() => (once = null))
  return once
}
```

- [ ] **Step 4: What Run needs (main bundle)**

`src/editor/running.ts`:

```ts
// What Run needs (firmware spec 2.1, 2.5), and the actions that load the run controller on first use,
// so Pyodide's loader, the workers and RunCore stay out of the main bundle (spec 2.7).
import { RUNNABLE, languageName, languagesOf } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { MAX_RUNNING } from '../run/limits.ts'
import type { EditorState, EditorStore } from './store.ts'

export const ISOLATION_OFF = 'Running code needs a browser feature this window has turned off (service workers). Try a normal window.'
export const RELOAD_FIRST = 'Reload the page to run code (save your work first).'
export const capText = (n: number): string => `Stop a board first: at most ${n} run at once`

const browserEnv = () => ({ isolated: globalThis.crossOriginIsolated === true, serviceWorkers: typeof navigator !== 'undefined' && 'serviceWorker' in navigator })

/** Boards on the sheet that have code, in sheet order. */
export const codeBoards = (s: EditorState): string[] => s.diagram.parts.filter((p) => p.code).map((p) => p.uid)

/** Why Run cannot start on `uid` now, in plain words, or null. */
export function runBlocker(s: EditorState, uid: string, env = browserEnv()): string | null {
  if (!env.isolated) return env.serviceWorkers ? RELOAD_FIRST : ISOLATION_OFF
  const part = s.diagram.parts.find((p) => p.uid === uid)
  if (!part?.code) return 'Add code to a board first.'
  const stored = s.diagram.modules[part.module]
  const m = stored && withLibraryData(stored, libraryLookup)
  if (!RUNNABLE.includes(part.code.language) || !languagesOf(m).includes(part.code.language)) return `${part.designator} cannot run ${languageName(part.code.language)}.`
  const others = Object.entries(s.run.boards).filter(([u, b]) => u !== uid && (b.status === 'starting' || b.status === 'running')).length
  return others >= MAX_RUNNING ? capText(MAX_RUNNING) : null
}

type Action = 'run' | 'stop' | 'reset' | 'line' | 'runAll' | 'stopAll'
/** Loads the controller (once) and does `action`. */
export function runAction(store: EditorStore, action: Action, uid = '', line = ''): void {
  void import('./runEngine.ts').then(({ controllerFor }) => {
    const c = controllerFor(store)
    if (action === 'run') void c.run(uid)
    else if (action === 'stop') void c.stop(uid)
    else if (action === 'reset') void c.reset(uid)
    else if (action === 'line') c.sendLine(uid, line)
    else if (action === 'runAll') void c.runAll()
    else void c.stopAll()
  })
}

/** Stops every board when the editor closes (only if the controller was ever loaded). */
export function disposeRuns(store: EditorStore): void {
  if (store.activeRuns.length || Object.keys(store.getState().run.boards).length) void import('./runEngine.ts').then(({ controllerFor }) => controllerFor(store).dispose())
}
```

- [ ] **Step 5: The controller**

`src/editor/runEngine.ts`:

```ts
// The editor's run controller (firmware spec 2.1, 2.3, 4.5, 5.2 to 5.4), loaded with import() on the
// first Run. One per editor store. Run turns Simulate on, shows "starting" while Python downloads and
// the first solve lands, refuses an unpowered board, then starts the code in its own worker. The
// sampler runs every 16 ms by setTimeout, or after a solve completes if one is in flight, whichever
// comes later; results are written back to every board; Serial is batched per sample. Stop removes
// the board's run pin states, so the saved states apply again; deleting the board, changing its
// module or turning Simulate off stops it; editing its code does not.
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { boardKindOf } from '../run/boards.ts'
import { prefetchPy } from '../run/browser/prefetch.ts'
import { type CoreBoard, NEVER_PAUSES, RunCore, type RunFinding } from '../run/core.ts'
import { BoardRun, type CodeWorkerLike } from '../run/host.ts'
import { F, H, writeLine } from '../run/memory.ts'
import { LOST_POWER, NO_POWER, boardPower, underVoltage, underVoltageNote } from '../run/power.ts'
import type { FromCode } from '../run/protocol.ts'
import { PY_FILES } from '../run/pyFiles.ts'
import { runBlocker } from './running.ts'
import type { EditorStore, SerialLine, SimView } from './store.ts'

export const browserSpawn = (): CodeWorkerLike => {
  const w = new Worker(new URL('../run/browser/codeWorker.ts', import.meta.url), { type: 'module' })
  return {
    post: (m) => w.postMessage(m),
    onMessage: (cb) => w.addEventListener('message', (e: MessageEvent<FromCode>) => cb(e.data)),
    onError: (cb) => w.addEventListener('error', (e) => cb(e.message || 'the code worker failed')),
    terminate: () => w.terminate(),
  }
}
interface Deps { spawn?: () => CodeWorkerLike; prefetch?: typeof prefetchPy; isolated?: () => boolean }
const nowAbs = () => performance.timeOrigin + performance.now()
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const SAMPLE_MS = 16
const NEVER_PAUSES_MS = 2000

export class RunController {
  private store: EditorStore
  private deps: Deps
  private runs = new Map<string, { run: BoardRun; module: string; ref: string; noted: Set<string> }>()
  private core = new RunCore()
  private batch = new Map<string, SerialLine[]>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSample = 0
  private inFlight = false
  private seenSim: SimView | null = null
  private seenParts: unknown = null
  private unsubscribe: () => void

  constructor(store: EditorStore, deps: Deps = {}) {
    this.store = store
    this.deps = deps
    this.unsubscribe = store.subscribe(() => this.follow())
  }

  private ref(uid: string): string {
    return this.store.getState().diagram.parts.find((p) => p.uid === uid)?.designator ?? uid
  }

  /** The next finished solve (or the current one, when Simulate already has a result and none is pending). */
  private nextSolve(): Promise<Extract<SimView, { phase: 'done' }> | null> {
    const s = this.store.getState().sim
    if (s?.phase === 'done' && !this.inFlight) return Promise.resolve(s)
    return new Promise((resolve) => {
      const off = this.store.subscribe(() => {
        const st = this.store.getState()
        if (!st.simulate) return off(), resolve(null)
        if (st.sim?.phase === 'done') off(), resolve(st.sim)
      })
    })
  }

  async run(uid: string): Promise<void> {
    const s = this.store.getState()
    const env = this.deps.isolated ? { isolated: this.deps.isolated(), serviceWorkers: true } : undefined
    const blocked = runBlocker(s, uid, env)
    const part = s.diagram.parts.find((p) => p.uid === uid)
    if (blocked || !part?.code || this.runs.has(uid)) {
      if (blocked) this.store.setBoardRun(uid, { status: 'idle', message: blocked })
      return
    }
    const code = part.code
    const m = withLibraryData(s.diagram.modules[part.module], libraryLookup)
    this.store.setSimulate(true)
    this.store.setBoardRun(uid, { status: 'starting', source: code.source, file: code.file ?? 'main.py', serial: [], prompt: null, progress: null, message: null })
    this.store.setDock({ open: true, tab: uid })
    let py: { indexURL: string; lock: string }
    try {
      py = await (this.deps.prefetch ?? prefetchPy)((loaded, total) => this.store.setBoardRun(uid, { progress: { loaded, total } }))
    } catch (e) {
      this.store.setBoardRun(uid, { status: 'error', progress: null, message: `Python could not load: ${why(e)}` })
      return
    }
    // The first solve (spec 2.1, 4.5): refuse a board it shows unpowered.
    const first = await this.nextSolve()
    if (this.store.getState().run.boards[uid]?.status !== 'starting') return
    // Simulate was turned off while starting: that is a Stop.
    if (!first) return void this.store.setBoardRun(uid, { status: 'stopped', progress: null })
    const ok = first?.outcome.status === 'ok' && first.circuit && boardPower(first.circuit, first.outcome.result, uid).powered
    if (!ok) {
      this.store.setBoardRun(uid, { status: 'idle', progress: null, message: NO_POWER(part.designator) })
      return
    }
    this.store.setBoardRun(uid, { progress: null })
    const run = new BoardRun({
      board: boardKindOf(m)!, source: code.source, file: code.file ?? 'main.py', mode: 'real', py, files: PY_FILES,
      spawn: this.deps.spawn ?? browserSpawn,
      on: (msg) => this.onMessage(uid, msg),
    })
    this.runs.set(uid, { run, module: part.module, ref: part.designator, noted: new Set() })
    this.core.add({ uid, ref: part.designator, memory: run.memory, module: m })
    run.start()
    this.schedule()
  }

  private onMessage(uid: string, msg: FromCode): void {
    if (msg.type === 'ready') this.store.setBoardRun(uid, { status: 'running' })
    else if (msg.type === 'out') this.serial(uid, msg.text, msg.stream)
    else if (msg.type === 'prompt') this.store.setBoardRun(uid, { prompt: msg.text })
    else if (msg.type === 'exit') this.finish(uid, msg.status)
    else if (msg.type === 'fatal') {
      this.serial(uid, `${msg.error}\n`, 'err')
      this.finish(uid, 'error')
    }
  }

  private serial(uid: string, text: string, stream: SerialLine['stream']): void {
    const lines = text.replace(/\n$/, '').split('\n').map((t) => ({ text: t, stream }))
    this.batch.set(uid, [...(this.batch.get(uid) ?? []), ...lines])
  }

  private flush(): void {
    for (const [uid, lines] of this.batch) this.store.appendSerial(uid, lines)
    this.batch.clear()
  }

  /** A board ended (spec 5.4): its run pin states go, so the saved states apply again. */
  private finish(uid: string, status: 'done' | 'stopped' | 'error'): void {
    if (!this.runs.has(uid)) return
    this.runs.delete(uid)
    this.core.remove(uid)
    this.flush()
    const { [uid]: _gone, ...pins } = this.store.getState().run.pins
    const { [uid]: _s, ...seq } = this.store.getState().run.seq
    this.store.setRun({ pins, seq })
    this.store.setBoardRun(uid, { status, prompt: null })
  }

  private stopping = new Set<string>()
  async stop(uid: string): Promise<void> {
    const r = this.runs.get(uid)
    if (!r) {
      if (this.store.getState().run.boards[uid]?.status === 'starting') this.store.setBoardRun(uid, { status: 'stopped', progress: null })
      return
    }
    // Store changes arrive while a board stops; one Stop per board at a time.
    if (this.stopping.has(uid)) return
    this.stopping.add(uid)
    try {
      const how = await r.run.stop()
      if (how !== 'stopped') this.finish(uid, 'stopped')
    } finally {
      this.stopping.delete(uid)
    }
  }

  /** Reset (spec 5.4): Stop, then Run in a fresh worker with the files already fetched. */
  async reset(uid: string): Promise<void> {
    await this.stop(uid)
    await this.run(uid)
  }

  sendLine(uid: string, line: string): void {
    const r = this.runs.get(uid)
    const prompt = this.store.getState().run.boards[uid]?.prompt
    if (!r || prompt === null || prompt === undefined) return
    this.store.appendSerial(uid, [{ text: `${prompt}${line}`, stream: 'echo' }])
    this.store.setBoardRun(uid, { prompt: null })
    writeLine(r.run.memory, line)
  }

  async runAll(): Promise<void> {
    for (const p of this.store.getState().diagram.parts) if (p.code && !this.runs.has(p.uid)) await this.run(p.uid)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((uid) => this.stop(uid)))
  }

  private at = (b: CoreBoard) => nowAbs() - b.memory.f64[F.startMs]

  private schedule(): void {
    if (this.timer || !this.runs.size) return
    const wait = Math.max(0, SAMPLE_MS - (performance.now() - this.lastSample))
    this.timer = setTimeout(() => {
      this.timer = null
      this.sample()
    }, wait)
  }

  /** One sample (spec 2.3), unless a solve is in flight: then the solve's arrival samples. */
  private sample(): void {
    if (!this.runs.size) return
    if (this.inFlight) return
    this.lastSample = performance.now()
    const st = this.store.getState()
    const s = this.core.sample(this.at)
    const sv = this.core.servos(st.diagram, st.sim?.phase === 'done' ? st.sim.circuit : null, performance.now(), libraryLookup)
    this.addFindings([...s.findings, ...sv.findings])
    // Never pauses (spec 5.2): 2 s with no yield while a timer or callback waits.
    for (const [uid, r] of this.runs) {
      const m = r.run.memory
      if (Atomics.load(m.i32, H.pending) && nowAbs() - m.f64[F.lastYieldMs] > NEVER_PAUSES_MS && !r.noted.has('pauses')) {
        r.noted.add('pauses')
        this.serial(uid, NEVER_PAUSES(r.ref), 'note')
      }
    }
    this.flush()
    const moved = JSON.stringify(sv.moving) !== JSON.stringify(st.run.moving)
    if (s.changed || moved) {
      this.inFlight = true
      this.store.setRun({ pins: s.pins, seq: s.seq, moving: sv.moving, servos: sv.views })
    } else if (JSON.stringify(sv.views) !== JSON.stringify(st.run.servos)) this.store.setRun({ servos: sv.views })
    this.schedule()
  }

  private addFindings(list: RunFinding[]): void {
    if (!list.length) return
    const have = new Set(this.store.getState().run.findings.map((f) => f.key))
    const add = list.filter((f) => !have.has(f.key))
    if (add.length) this.store.setRun({ findings: [...this.store.getState().run.findings, ...add] })
  }

  /** Store changes: a new solve, a deleted or changed board, Simulate turned off. */
  private follow(): void {
    const st = this.store.getState()
    if (!st.simulate && this.runs.size) return void this.stopAll()
    if (st.diagram.parts !== this.seenParts) {
      this.seenParts = st.diagram.parts
      for (const [uid, r] of this.runs) {
        const p = st.diagram.parts.find((x) => x.uid === uid)
        if (!p || p.module !== r.module) void this.stop(uid)
      }
    }
    // store.load (Open, New) resets `run` to EMPTY_RUN: a running board with no view left means the sheet was replaced, even if the new sheet has a part with the same uid.
    for (const uid of this.runs.keys()) if (!st.run.boards[uid]) void this.stop(uid)
    if (st.sim !== this.seenSim && st.sim?.phase === 'done') {
      this.seenSim = st.sim
      this.inFlight = false
      const a = this.core.apply(st.sim.outcome, st.sim.circuit, st.sim.runSeq ?? {}, this.at)
      this.addFindings(a.findings)
      for (const [uid, r] of this.runs) {
        const p = a.power[uid]
        if (!p) continue
        if (!p.powered) {
          this.serial(uid, LOST_POWER(r.ref), 'note')
          this.flush()
          void this.stop(uid)
        } else if (underVoltage(p) && !r.noted.has('volts')) {
          r.noted.add('volts')
          this.serial(uid, underVoltageNote(r.ref, p.inputVolts!), 'note')
        }
      }
      if (performance.now() - this.lastSample >= SAMPLE_MS) this.sample()
      else this.schedule()
    }
  }

  dispose(): void {
    void this.stopAll()
    this.unsubscribe()
    if (this.timer) clearTimeout(this.timer)
  }
}

const controllers = new WeakMap<EditorStore, RunController>()
export function controllerFor(store: EditorStore, deps?: Deps): RunController {
  let c = controllers.get(store)
  if (!c) controllers.set(store, (c = new RunController(store, deps)))
  return c
}
```

Notes for the implementer:
- A solve the controller did not ask for (a wire edit) still clears `inFlight` when it lands: any newer result is fine to sample after (spec 2.4 running mode delivers newer results).
- `nextSolve` resolves with the current result when Simulate already shows one; otherwise it waits for the first `done`, which is the first solve of this Run.
- `stop` before the worker exists (still downloading) marks the board stopped; `run` then sees the status is no longer "starting" and does not start it.

- [ ] **Step 6: Wire it to the editor**

In `src/editor/EditorApp.tsx`, a document opened from a link records whether it has code: `setDoc({ diagram: r.diagram, warnings: r.warnings, key: Date.now(), linkCode: r.diagram.parts.some((p) => p.code) })` (add `linkCode?: boolean` to `Doc`), and pass `linkCode={doc.linkCode}` to `<Editor>`. In `src/editor/Editor.tsx`, `Editor` takes `linkCode?: boolean`, creates the store with `new EditorStore(initial, { linkCode })`, and adds `useEffect(() => () => disposeRuns(store), [store])` (import `disposeRuns` from `./running.ts`).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/editor/runEngine.test.ts src/editor/run.test.ts`
Expected: PASS. These start real Pyodide workers; on a busy machine the 4 s blink wait may need a quiet rerun.

- [ ] **Step 8: Build and check the bundle split**

Run: `npm run build && node -e "const fs=require('fs'),z=require('zlib');for(const f of fs.readdirSync('dist/assets').filter(x=>/\.js$/.test(x)))console.log(f,z.gzipSync(fs.readFileSync('dist/assets/'+f)).length)"`
Expected: separate chunks `runEngine-*.js` and `codeWorker-*.js`; `index-*.js` grows by only `running.ts` and the store changes (under 3 KB gzip; Task 37 checks the 20 KB budget with the dock). Record the `index-*.js` size in the ledger as this step's figure.

- [ ] **Step 9: Commit**

```bash
git add src/run/browser/prefetch.ts src/editor/runEngine.ts src/editor/running.ts src/editor/runEngine.test.ts src/editor/EditorApp.tsx src/editor/Editor.tsx
git commit -m "$(cat <<'MSG'
Editor: the run controller (start after the first solve, sampler, write-back, Stop, Reset, input, lost power, never pauses) and the Pyodide prefetch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 33: Serial and the code-file helpers

**Files:**
- Create: `src/editor/codeFile.ts`, `src/editor/SerialPanel.tsx`, `src/editor/codeFile.test.ts`

**Interfaces:**
- Consumes: `LANGUAGE_EXT`, `SOURCE_MAX_BYTES`, `languageName`, `fileProblem`, `PartCode` (Task 4); the store (Task 31); `runAction` (Task 32).
- Produces (`src/editor/codeFile.ts`):
  - `function readCodeFile(name: string, bytes: Uint8Array, language: string): { ok: true; code: PartCode } | { ok: false; why: string }`
  - `function downloadName(code: PartCode, designator: string): string`
  - `function starterCode(designator: string, board: string): string`
  - `function lineRef(text: string, file: string): { before: string; ref: string; line: number; after: string } | null`
  - `function announcement(lines: SerialLine[], from: number): string`
- Produces (`src/editor/SerialPanel.tsx`): `function SerialPanel({ store, uid, onGoto }: { store: EditorStore; uid: string; onGoto: (line: number) => void }): JSX.Element` (rendered by the dock, Task 34)

- [ ] **Step 1: Write the failing test**

`src/editor/codeFile.test.ts`:

```ts
// Firmware spec 5.3, 6.1, 6.2, 6.4: uploads are refused with the reason (over 256 KB, not UTF-8, an
// extension that does not fit the language); downloads are named <file> or <designator>.py; Write
// code starts from a short starter comment; traceback lines link to the script's own lines; Serial
// announces new lines (throttled by the panel).
import { describe, expect, it } from 'vitest'
import { SOURCE_MAX_BYTES } from '../format/code.ts'
import { announcement, downloadName, lineRef, readCodeFile, starterCode } from './codeFile.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('code files (spec 6.2)', () => {
  it('reads a .py file as UTF-8 and keeps its name', () => {
    expect(readCodeFile('blink.py', enc('print("hé")\n'), 'python-rpi')).toEqual({ ok: true, code: { language: 'python-rpi', source: 'print("hé")\n', file: 'blink.py' } })
  })
  it('refuses with the reason', () => {
    expect(readCodeFile('blink.ino', enc('void setup(){}'), 'python-rpi')).toEqual({ ok: false, why: 'blink.ino is not Raspberry Pi Python code: it needs a .py file' })
    expect(readCodeFile('big.py', new Uint8Array(SOURCE_MAX_BYTES + 1), 'python-rpi')).toEqual({ ok: false, why: 'big.py is over 256 KB' })
    expect(readCodeFile('bad.py', new Uint8Array([0xff, 0xfe, 0x41]), 'python-rpi')).toEqual({ ok: false, why: 'bad.py is not UTF-8 text' })
  })
  it('names downloads after the file, else the designator', () => {
    expect(downloadName({ language: 'python-rpi', source: '', file: 'blink.py' }, 'U1')).toBe('blink.py')
    expect(downloadName({ language: 'python-rpi', source: '' }, 'U1')).toBe('U1.py')
  })
  it('starts Write code from a comment that says what works', () => {
    const s = starterCode('U1', 'Raspberry Pi 4 Model B')
    expect(s.split('\n').every((l) => l === '' || l.startsWith('#'))).toBe(true)
    expect(s).toContain('from gpiozero import LED')
  })
})

describe('Serial (spec 5.3, 6.4)', () => {
  it('finds the script line a traceback names, and only the script\'s', () => {
    expect(lineRef('  File "blink.py", line 12, in <module>', 'blink.py')).toEqual({ before: '  ', ref: 'File "blink.py", line 12', line: 12, after: ', in <module>' })
    expect(lineRef('  File "/lib/x.py", line 3', 'blink.py')).toBeNull()
  })
  it('announces the lines since the last announcement, at most the last three', () => {
    const lines = ['a', 'b', 'c', 'd'].map((text) => ({ text, stream: 'out' as const }))
    expect(announcement(lines, 0)).toBe('b. c. d')
    expect(announcement(lines, 3)).toBe('d')
    expect(announcement(lines, 4)).toBe('')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/editor/codeFile.test.ts`
Expected: FAIL, `./codeFile.ts` cannot be found.

- [ ] **Step 3: Write `src/editor/codeFile.ts`**

```ts
// Code files in the editor (firmware spec 5.3, 6.1, 6.2): reading an upload (refused with the reason:
// over 256 KB, not UTF-8, an extension that does not fit the language), naming a download, the
// starter comment for Write code, and the Serial helpers (traceback line links, announcements).
import { LANGUAGE_EXT, type PartCode, SOURCE_MAX_BYTES, fileProblem, languageName } from '../format/code.ts'
import type { SerialLine } from './store.ts'

export function readCodeFile(name: string, bytes: Uint8Array, language: string): { ok: true; code: PartCode } | { ok: false; why: string } {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  const allowed = LANGUAGE_EXT[language] ?? []
  if (!allowed.includes(ext)) return { ok: false, why: `${name} is not ${languageName(language)} code: it needs a ${allowed.join(' or ')} file` }
  if (bytes.length > SOURCE_MAX_BYTES) return { ok: false, why: `${name} is over 256 KB` }
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, why: `${name} is not UTF-8 text` }
  }
  return { ok: true, code: { language, source, ...(fileProblem(name) ? {} : { file: name }) } }
}

export const downloadName = (code: PartCode, designator: string): string => code.file ?? `${designator}${(LANGUAGE_EXT[code.language] ?? ['.txt'])[0]}`

export const starterCode = (designator: string, board: string): string =>
  [
    `# Code for ${designator} (${board}). Press Run in the code dock to start it.`,
    '# gpiozero and RPi.GPIO work here. For example, to blink an LED on GPIO17:',
    '#',
    '#   from gpiozero import LED',
    '#   from signal import pause',
    '#',
    '#   led = LED(17)',
    '#   led.blink()',
    '#   pause()',
    '',
  ].join('\n')

/** A traceback reference to the script's own file (`File "blink.py", line 12`), split for a link. */
export function lineRef(text: string, file: string): { before: string; ref: string; line: number; after: string } | null {
  const m = /File "([^"]+)", line (\d+)/.exec(text)
  if (!m || m[1] !== file) return null
  return { before: text.slice(0, m.index), ref: m[0], line: Number(m[2]), after: text.slice(m.index + m[0].length) }
}

/** What a screen reader hears for the lines since `from`: the last three at most. */
export const announcement = (lines: SerialLine[], from: number): string => lines.slice(Math.max(from, lines.length - 3)).map((l) => l.text).join('. ')
```

- [ ] **Step 4: Write `src/editor/SerialPanel.tsx`**

```tsx
// Serial (firmware spec 5.3, 6.1, 6.4): one board's output, newest at the bottom (it follows the end
// unless scrolled up), errors in the error colour, the simulator's notes set apart, typed lines
// echoed; the input box while input() waits; Clear. The log itself is not live; a visually hidden
// polite region announces new lines at most once a second. A traceback's `File "blink.py", line 12`
// is a button that moves the editor to that line.
import { useEffect, useRef, useState } from 'react'
import { announcement, lineRef } from './codeFile.ts'
import { runAction } from './running.ts'
import { type EditorStore, useEditorState } from './store.ts'

export function SerialPanel({ store, uid, onGoto }: { store: EditorStore; uid: string; onGoto: (line: number) => void }) {
  const { run } = useEditorState(store)
  const b = run.boards[uid]
  const lines = b?.serial ?? []
  const file = b?.file ?? 'main.py'
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [said, setSaid] = useState({ text: '', count: 0 })
  const [entry, setEntry] = useState('')
  useEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])
  // At most one announcement a second (spec 6.4).
  useEffect(() => {
    if (lines.length === said.count) return
    const t = setTimeout(() => setSaid({ text: announcement(lines, said.count), count: lines.length }), 1000)
    return () => clearTimeout(t)
  }, [lines, said.count])
  return (
    <section className="serial" aria-labelledby={`serial-${uid}`}>
      <div className="serial-head">
        <h3 id={`serial-${uid}`}>Serial</h3>
        <button type="button" className="tool small" disabled={!lines.length} onClick={() => store.setBoardRun(uid, { serial: [] })}>Clear</button>
      </div>
      <div
        ref={log}
        className="serial-log"
        role="log"
        aria-live="off"
        tabIndex={0}
        aria-label="Serial output"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
        }}
      >
        {!lines.length && <p className="serial-empty">Output from print() shows here.</p>}
        {lines.map((l, i) => {
          const ref = l.stream === 'err' ? lineRef(l.text, file) : null
          return (
            <div key={i} className={`serial-line ${l.stream}`}>
              {ref ? (
                <>
                  {ref.before}
                  <button type="button" className="serial-ref" onClick={() => onGoto(ref.line)}>{ref.ref}</button>
                  {ref.after}
                </>
              ) : (
                l.text
              )}
            </div>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite">{said.text}</p>
      {b?.prompt !== null && b?.prompt !== undefined && (
        <form
          className="serial-input"
          onSubmit={(e) => {
            e.preventDefault()
            runAction(store, 'line', uid, entry)
            setEntry('')
          }}
        >
          <label htmlFor={`serial-in-${uid}`}>{b.prompt.trim() || 'The code is waiting for input'}</label>
          <input id={`serial-in-${uid}`} autoFocus autoComplete="off" value={entry} onChange={(e) => setEntry(e.target.value)} />
          <button type="submit" className="tool small">Send</button>
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/editor/codeFile.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), and the types check (the panel is drawn and screenshotted in Task 34).

- [ ] **Step 6: Commit**

```bash
git add src/editor/codeFile.ts src/editor/codeFile.test.ts src/editor/SerialPanel.tsx
git commit -m "$(cat <<'MSG'
Editor: Serial panel (throttled announcements, traceback line links, input box) and the code-file helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 34: The code dock and the code editor

**Files:**
- Create: `src/editor/CodeEditor.tsx`, `src/editor/CodeDock.tsx`, `src/editor/codeDock.css`, `scripts/check-code-ui.mjs`
- Modify: `src/editor/Editor.tsx` (the dock, Ctrl+`), `src/editor/Toolbar.tsx` (the skip link), `src/editor/editor.css` (the grid), `package.json` (`@codemirror/*`, `@lezer/highlight`, `check:code-ui`), `package-lock.json`

**Interfaces:**
- Consumes: Tasks 31 to 33 (store, `runAction`, `runBlocker`, `codeBoards`, `SerialPanel`, `readCodeFile`, `downloadName`, `starterCode`); `setPartCode`; `languagesOf`, `LANGUAGE_NAMES`, `LANGUAGE_EXT`; `downloadText` (`files.ts`).
- Produces:
  - `export default function CodeEditor(props: { value: string; onChange: (v: string) => void; label: string; goto: { line: number; at: number } | null }): JSX.Element` (lazy chunk)
  - `function CodeDock({ store }: { store: EditorStore }): JSX.Element | null`; the dock root has `id="code-dock"` and `data-dock-open`, each tab `data-dock-tab="<uid>"` and `data-status="idle|starting|running|error|changed|stopped|done"`, the Run/Stop button `data-run="<uid>"`
  - `function dockTabs(s: EditorState): string[]`; `function tabStatus(b: BoardRunView | undefined, code: PartCode | undefined): { key: 'idle' | 'starting' | 'running' | 'error' | 'changed' | 'stopped' | 'done'; text: string }` (exported from `CodeDock.tsx`)
  - `npm run check:code-ui` with the dock cases, screenshots `code-<case>-<scheme>.png`

- [ ] **Step 1: Install CodeMirror, pinned**

Run: `npm i -E @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-python @lezer/highlight`
Expected: six exact versions in `dependencies` (they ship in the site).

- [ ] **Step 2: Write the failing browser check**

`scripts/check-code-ui.mjs`:

```js
// Browser check for code on boards (firmware spec 6 and 10), in the built app, light and dark:
//   1. idle: a Pi 4 sheet with blink code opens with the dock: one tab, "Not running".
//   2. starting: Run with the Python download slowed: "Starting", with progress.
//   3. running: GPIO17's LED glow toggles; the tab says "Running".
//   4. changed: typing in the editor while it runs says "Code changed: Reset to apply"; the sheet's
//      undo stack gains the edit; the run goes on.
//   5. error: an exception stops the board ("Error"); its traceback line link moves the cursor there.
//   6. stopped: Stop restores the saved states, the file stays unchanged and undo is untouched.
//   7. collapsed: the 28 px bar still shows each board's status; Ctrl+` toggles it; Escape then Tab
//      leaves the editor.
//   8. link: code that came in a link asks once before running.
// Screenshots go to --out as code-<case>-<scheme>.png; open and look at each one.
// Usage (after `npm run build`): npm run check:code-ui -- [--out <dir>] [--port 4215]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/code-ui'))
const port = Number(flagOf('--port', '4215'))
mkdirSync(out, { recursive: true })
const ids = ['battery-holder-4xaa', 'rpi-4-model-b', 'resistor', 'led', 'push-button', 'servo-sg90']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const w = (uid, a, ap, b, bp) => ({ uid, from: { part: a, pin: ap }, to: { part: b, pin: bp }, color: 'blue', gauge: 22 })
const BLINK = 'from gpiozero import LED\nfrom signal import pause\n\nled = LED(17)\nled.blink()\npause()\n'
const BOOM = "import time\n\ntime.sleep(0.5)\nraise RuntimeError('boom')\n"
export function piSheet(name, source, extra = { parts: [], wires: [] }) {
  const parts = [
    at('bt1', 'BT1', 'battery-holder-4xaa', 40, 260, { values: { voltage: { value: 5, unit: 'V' } } }),
    at('u1', 'U1', 'rpi-4-model-b', 260, 60, { code: { language: 'python-rpi', source, file: `${name}.py` } }),
    at('r1', 'R1', 'resistor', 620, 120, { values: { resistance: { value: 330, unit: 'ohm' } } }),
    at('d1', 'D1', 'led', 760, 120, { values: { color: 'red' } }),
    ...extra.parts,
  ]
  const connections = [w('w1', 'bt1', '+', 'u1', '5V'), w('w2', 'bt1', '-', 'u1', 'GND'), w('w3', 'u1', 'GPIO17', 'r1', '1'), w('w4', 'r1', '2', 'd1', 'A'), w('w5', 'd1', 'K', 'u1', 'GND 2'), ...extra.wires]
  const used = new Set(parts.map((p) => p.module))
  const path = join(out, `code-${name}.circuitoon.json`)
  writeFileSync(path, JSON.stringify({ format: 'circuitoon-diagram/1', title: name, modules: Object.fromEntries(Object.entries(modules).filter(([id]) => used.has(id))), parts, connections }))
  return path
}
const blinkFile = piSheet('blink', BLINK)
const boomFile = piSheet('boom', BOOM)

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const shot = async (name) => {
    await page.mouse.move(5, 995)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, `code-${name}-${scheme}.png`) })
  }
  const tab = page.locator('[data-dock-tab="u1"]')
  const status = () => tab.getAttribute('data-status')
  const waitStatus = (s, timeout = 20000) => page.waitForFunction((want) => document.querySelector('[data-dock-tab="u1"]')?.getAttribute('data-status') === want, s, { timeout })
  const open = async (path) => {
    await page.locator('.toolbar input[type=file]').setInputFiles(path)
    await page.waitForSelector('svg.canvas [data-part]')
  }
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  check(await page.evaluate(() => crossOriginIsolated), `${scheme}: the preview is cross-origin isolated`)
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // 1. idle
  await open(blinkFile)
  await page.waitForSelector('#code-dock')
  check((await tab.textContent())?.includes('U1') && (await tab.textContent())?.includes('blink.py'), `${scheme}: the tab names U1 and blink.py`)
  check((await status()) === 'idle', `${scheme}: idle at first`)
  await shot('idle')

  // 2. starting (the Python download is held for 1.5 s)
  await page.route('**/py/**/pyodide.asm.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.locator('[data-run="u1"]').click()
  await waitStatus('starting')
  check((await page.locator('.code-dock progress').count()) === 1, `${scheme}: starting shows the download progress`)
  await shot('starting')
  await page.unroute('**/py/**/pyodide.asm.wasm')

  // 3. running: the glow toggles
  await waitStatus('running', 30000)
  const levels = new Set()
  for (let i = 0; i < 30 && levels.size < 2; i++) {
    levels.add(await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => null))
    await page.waitForTimeout(150)
  }
  check(levels.size >= 2, `${scheme}: the LED glow toggles while blink runs (${[...levels].join(', ')})`)
  check((await page.locator('[data-run="u1"]').getAttribute('aria-label')) === "Stop U1's code", `${scheme}: the button's name follows the state`)
  await shot('running')

  // 4. changed
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('# edited\n')
  await waitStatus('changed')
  check((await page.locator('.code-dock').textContent())?.includes('Code changed: Reset to apply'), `${scheme}: "Code changed: Reset to apply"`)
  await shot('changed')

  // 6. stopped (before 5, on this sheet)
  const undoBefore = await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  check((await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => '0')) === '0.00' || !(await page.locator('[data-sim-led="d1"]').count()), `${scheme}: Stop restores the saved states (LED dark)`)
  check(undoBefore === false, `${scheme}: the code edit is on the undo stack`)
  await shot('stopped')

  // 7. collapsed, Ctrl+`, Escape then Tab
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => !document.activeElement?.closest('.cm-editor')), `${scheme}: Escape then Tab leaves the editor`)
  await page.locator('.code-dock-collapse').click()
  check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) <= 29, `${scheme}: collapsed to a 28 px bar`)
  check((await page.locator('#code-dock [data-dock-tab="u1"]').getAttribute('data-status')) === 'stopped', `${scheme}: the bar still shows the status`)
  await shot('collapsed')
  await page.keyboard.press('Control+`')
  check((await page.locator('#code-dock').getAttribute('data-dock-open')) === 'true', `${scheme}: Ctrl+\` opens the dock again`)

  // 5. error, with the traceback link
  await open(boomFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('error', 30000)
  const ref = page.locator('.serial-ref').first()
  check((await ref.textContent()) === 'File "boom.py", line 4', `${scheme}: the traceback names the script line`)
  await ref.click()
  check((await page.locator('.cm-activeLine').textContent())?.includes("raise RuntimeError('boom')"), `${scheme}: the link moves the cursor to line 4`)
  await shot('error')

  // 8. link: code that came in a link asks once before running (spec 2.6)
  const link = JSON.parse(execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', 'link', blinkFile, '--json'], { encoding: 'utf8' }))
  check(link.url !== null, `${scheme}: the CLI made a link for blink.py`)
  await page.goto(link.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('#code-dock')
  await page.locator('[data-run="u1"]').click()
  const confirm = page.locator('.code-confirm')
  check((await confirm.textContent())?.includes('This code came with the link. Run runs it in your browser, with no access to other sites.'), `${scheme}: the first Run of linked code asks`)
  check((await status()) === 'idle', `${scheme}: nothing runs before the answer`)
  await shot('link')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  check((await confirm.count()) === 0 && (await status()) === 'idle', `${scheme}: Cancel closes the question and runs nothing`)
  await page.locator('[data-run="u1"]').click()
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  await waitStatus('running', 30000)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  check((await confirm.count()) === 0, `${scheme}: it asks once, not on the next Run`)

  check(!errors.length, `${scheme}: no page errors (${errors.join(' | ')})`)
  await context.close()
}
await browser.close()
done()
```

Add `"check:code-ui": "node scripts/check-code-ui.mjs",` to `package.json`.

Run: `npm run build && npm run check:code-ui`
Expected: FAIL at case 1 (no `#code-dock`).

- [ ] **Step 3: The code editor**

`src/editor/CodeEditor.tsx`:

```tsx
// The code editor (firmware spec 6.1, 6.4): CodeMirror 6 with Python highlighting, line numbers and
// both themes (token colours are CSS, codeDock.css), in a lazy chunk (spec 9: at most 150 KB gzip).
// Tab indents; Escape then Tab leaves the editor, as the dock's help text says. Changes from outside
// (undo on the sheet, an upload) replace the text; `goto` moves the cursor to a line.
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'

/** After Escape, the next Tab is the browser's (it moves focus); handled here without preventDefault. */
function escapeThenTab() {
  let escaped = false
  return EditorView.domEventHandlers({
    keydown(e) {
      if (e.key === 'Escape') {
        escaped = true
        return false
      }
      const leave = e.key === 'Tab' && escaped
      escaped = false
      return leave
    },
  })
}

export default function CodeEditor({ value, onChange, label, goto }: { value: string; onChange: (v: string) => void; label: string; goto: { line: number; at: number } | null }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(),
          syntaxHighlighting(classHighlighter), python(), escapeThenTab(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => u.docChanged && change.current(u.state.doc.toString())),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // The view is made once; label and value updates arrive through the effects below.
  }, [])
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])
  useEffect(() => {
    const v = view.current
    if (!v || !goto) return
    const line = v.state.doc.line(Math.min(Math.max(1, goto.line), v.state.doc.lines))
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    v.focus()
  }, [goto])
  return <div ref={host} className="code-editor" />
}
```

Now that CodeMirror is installed, check whether it already does Escape then Tab: `grep -n "tabFocus\|TabFocus" node_modules/@codemirror/view/dist/index.js node_modules/@codemirror/commands/dist/index.js`. If a built-in focus mode lets Escape then Tab leave the editor (`indentWithTab` and the default keymap honour it), delete `escapeThenTab` (the function, its comment and its entry in `extensions`) and keep the dock's help text; case 7 of the browser check is then the proof. If it is not built in, keep `escapeThenTab` as written.

- [ ] **Step 4: The dock**

`src/editor/CodeDock.tsx`:

```tsx
// The code dock (firmware spec 6.1, 6.4; mockup option B): under the sheet, resizable (its height is
// remembered), collapsible to a 28 px bar that still shows each board's status. One tab per board
// with code, plus the selected board's while its code is being written. Left: the code editor (a lazy
// chunk); right: Serial. One Run/Stop button whose name follows the state (changes are announced
// politely), Reset, Upload, Download and the language. Run all and Stop all with two or more coded
// boards. Code that came in a link asks once before it runs (spec 2.6).
import { Suspense, lazy, useRef, useState } from 'react'
import { LANGUAGE_EXT, LANGUAGE_NAMES, type PartCode, languagesOf } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { downloadName, readCodeFile } from './codeFile.ts'
import { downloadText } from './files.ts'
import { setPartCode } from './ops.ts'
import { codeBoards, runAction, runBlocker } from './running.ts'
import { SerialPanel } from './SerialPanel.tsx'
import { type BoardRunView, type EditorState, type EditorStore, useEditorState } from './store.ts'
import './codeDock.css'

const CodeEditor = lazy(() => import('./CodeEditor.tsx'))
const STATUS_TEXT = { idle: 'Not running', starting: 'Starting', running: 'Running', error: 'Error', changed: 'Code changed', stopped: 'Stopped', done: 'Finished' } as const
type StatusKey = keyof typeof STATUS_TEXT

export function tabStatus(b: BoardRunView | undefined, code: PartCode | undefined): { key: StatusKey; text: string } {
  const live = b?.status === 'starting' || b?.status === 'running'
  const key: StatusKey = live && code && b!.source !== code.source ? 'changed' : ((b?.status ?? 'idle') as StatusKey)
  return { key, text: STATUS_TEXT[key] }
}

/** The tabs (spec 6.1): every board with code, plus the dock's own tab when it is a board being written. */
export function dockTabs(s: EditorState): string[] {
  const tabs = codeBoards(s)
  const t = s.dock.tab
  if (t && !tabs.includes(t) && s.diagram.parts.some((p) => p.uid === t)) tabs.push(t)
  return tabs
}

export function CodeDock({ store }: { store: EditorStore }) {
  const s = useEditorState(store)
  const tabs = dockTabs(s)
  const [goto, setGoto] = useState<{ line: number; at: number } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [asking, setAsking] = useState<'run' | 'runAll' | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const drag = useRef<{ y: number; h: number } | null>(null)
  if (!tabs.length) return null
  const uid = tabs.includes(s.dock.tab ?? '') ? s.dock.tab! : tabs[0]
  const part = s.diagram.parts.find((p) => p.uid === uid)!
  const stored = s.diagram.modules[part.module]
  const m = stored && withLibraryData(stored, libraryLookup)
  const language = part.code?.language ?? languagesOf(m)[0] ?? 'python-rpi'
  const b = s.run.boards[uid]
  const st = tabStatus(b, part.code)
  const live = b?.status === 'starting' || b?.status === 'running'
  const blocker = live ? null : runBlocker(s, uid)
  const many = codeBoards(s).length >= 2
  const run = () => {
    if (live) return runAction(store, 'stop', uid)
    if (s.linkCode) return setAsking('run')
    runAction(store, 'run', uid)
  }
  const height = s.dock.open ? s.dock.height : 28
  return (
    <section id="code-dock" className="code-dock" data-dock-open={s.dock.open} style={{ height }} aria-label="Code">
      <div
        className="code-dock-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the code dock"
        aria-valuenow={Math.round(height)}
        aria-valuemin={120}
        aria-valuemax={Math.round(window.innerHeight * 0.7)}
        tabIndex={s.dock.open ? 0 : -1}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h: s.dock.height }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => drag.current && store.setDock({ height: Math.min(window.innerHeight * 0.7, Math.max(120, drag.current.h + drag.current.y - e.clientY)) })}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowUp' ? 20 : e.key === 'ArrowDown' ? -20 : 0
          if (step) (e.preventDefault(), store.setDock({ height: Math.min(window.innerHeight * 0.7, Math.max(120, s.dock.height + step)) }))
        }}
      />
      <div className="code-dock-bar">
        <div
          role="tablist"
          aria-label="Boards with code"
          className="code-dock-tabs"
          onKeyDown={(e) => {
            // A proper tablist (spec 6.4): arrows, Home and End select and focus the neighbour; only the selected tab is in the Tab order.
            const i = tabs.indexOf(uid)
            const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
            if (to < 0) return
            e.preventDefault()
            store.setDock({ tab: tabs[to], open: true })
            e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[to]?.focus()
          }}
        >
          {tabs.map((t) => {
            const p = s.diagram.parts.find((x) => x.uid === t)!
            const ts = tabStatus(s.run.boards[t], p.code)
            const name = s.diagram.modules[p.module]?.name ?? p.module
            return (
              <button key={t} type="button" role="tab" aria-selected={t === uid} tabIndex={t === uid ? 0 : -1} data-dock-tab={t} data-status={ts.key} className="code-dock-tab" onClick={() => store.setDock({ tab: t, open: true })}>
                <span className={`code-dot ${ts.key}`} aria-hidden="true" />
                <span className="code-tab-name">{p.designator}</span>
                <span className="code-tab-board">{name}</span>
                <span className="code-tab-file">{p.code?.file ?? 'main.py'}</span>
                <span className="sr-only">, {ts.text}</span>
              </button>
            )
          })}
        </div>
        {many && s.dock.open && (
          <div className="code-dock-all">
            <button type="button" className="tool small" onClick={() => (s.linkCode ? setAsking('runAll') : runAction(store, 'runAll'))}>Run all</button>
            <button type="button" className="tool small" onClick={() => runAction(store, 'stopAll')}>Stop all</button>
          </div>
        )}
        <button type="button" className="tool small code-dock-collapse" aria-expanded={s.dock.open} aria-controls="code-dock-body" onClick={() => store.setDock({ open: !s.dock.open })}>
          {s.dock.open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {s.dock.open && (
        <div id="code-dock-body" className="code-dock-body" role="tabpanel" aria-label={`${part.designator} code`}>
          <div className="code-pane">
            <div className="code-toolbar">
              <button type="button" className={`tool run-button ${live ? 'stop' : ''}`} data-run={uid} aria-label={live ? `Stop ${part.designator}'s code` : `Run ${part.designator}'s code`} disabled={!live && !!blocker} title={blocker ?? undefined} onClick={run}>
                {live ? 'Stop' : 'Run'}
              </button>
              <button type="button" className="tool small" disabled={!live && b?.status !== 'error' && b?.status !== 'stopped' && b?.status !== 'done'} onClick={() => runAction(store, 'reset', uid)}>Reset</button>
              <button type="button" className="tool small" onClick={() => upload.current?.click()}>Upload</button>
              <input
                ref={upload}
                type="file"
                hidden
                accept={(LANGUAGE_EXT[language] ?? []).join(',')}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const r = readCodeFile(f.name, new Uint8Array(await f.arrayBuffer()), language)
                  setRefused(r.ok ? null : r.why)
                  if (r.ok) store.commit(setPartCode(store.getState().diagram, uid, r.code))
                }}
              />
              <button type="button" className="tool small" disabled={!part.code} onClick={() => part.code && downloadText(downloadName(part.code, part.designator), part.code.source, 'text/x-python')}>Download</button>
              <span className="code-language">{LANGUAGE_NAMES[language] ?? language}</span>
              <span className={`code-status ${st.key}`} role="status" aria-live="polite">
                {st.key === 'changed' ? 'Code changed: Reset to apply' : st.text}
                {b?.progress && (
                  <>
                    {' '}
                    <progress max={b.progress.total} value={b.progress.loaded} aria-label="Python download" /> {Math.round((100 * b.progress.loaded) / Math.max(1, b.progress.total))} %
                  </>
                )}
              </span>
            </div>
            {asking && (
              <div className="code-confirm" role="alertdialog" aria-label="Run code from a link">
                <p>This code came with the link. Run runs it in your browser, with no access to other sites.</p>
                <button type="button" className="tool small" onClick={() => (setAsking(null), store.confirmLinkCode(), runAction(store, asking, uid))}>Run</button>
                <button type="button" className="tool small" onClick={() => setAsking(null)}>Cancel</button>
              </div>
            )}
            {(refused || b?.message || blocker) && <p className="code-message" role="alert">{refused ?? b?.message ?? blocker}</p>}
            <Suspense fallback={<p className="hint">Loading the editor.</p>}>
              <CodeEditor
                key={uid}
                value={part.code?.source ?? ''}
                label={`${part.designator} code`}
                goto={goto}
                onChange={(v) => {
                  const d = store.getState().diagram
                  const now = d.parts.find((p) => p.uid === uid)?.code
                  store.commit(setPartCode(d, uid, { language, source: v, ...(now?.file ? { file: now.file } : {}) }), `code:${uid}`)
                }}
              />
            </Suspense>
            <p className="hint code-help">Tab indents. Press Escape, then Tab, to leave the editor.</p>
          </div>
          <SerialPanel store={store} uid={uid} onGoto={(line) => setGoto({ line, at: Date.now() })} />
        </div>
      )}
    </section>
  )
}
```

`src/editor/codeDock.css`:

```css
/* The code dock (firmware spec 6.1): under the sheet, in the editor's Sticker look. Token colours for
   the code are CSS so both themes follow the app's (classHighlighter's tok-* classes). */
.code-dock { grid-area: dock; display: grid; grid-template-rows: 6px auto minmax(0, 1fr); background: var(--panel); border-top: 1.5px solid var(--card-edge); min-height: 28px; }
.code-dock[data-dock-open="false"] { grid-template-rows: 0 28px; overflow: hidden; }
.code-dock-handle { cursor: ns-resize; background: var(--rule); }
.code-dock-handle:focus-visible { outline: 3px solid var(--focus); outline-offset: -1px; }
.code-dock-bar { display: flex; align-items: center; gap: 8px; padding: 0 8px; min-height: 28px; }
.code-dock-tabs { display: flex; gap: 4px; overflow-x: auto; flex: 1 1 auto; }
.code-dock-tab { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1.5px solid var(--rule); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--bg); color: var(--text); font: 700 13px/1.2 "Atkinson Hyperlegible", system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
.code-dock-tab[aria-selected="true"] { background: var(--panel); border-color: var(--card-edge); box-shadow: 2px 0 0 var(--shadow); }
.code-dock-tab:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
.code-tab-board, .code-tab-file { font-weight: 400; color: var(--muted); }
.code-dot { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--card-edge); background: var(--bg); flex: none; }
.code-dot.starting { background: var(--yellow); }
.code-dot.running { background: var(--green); }
.code-dot.error { background: var(--error); }
.code-dot.changed { background: var(--yellow); box-shadow: inset 0 0 0 2px var(--green); }
.code-dock-all { display: flex; gap: 6px; }
.code-dock-body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(220px, 2fr); gap: 10px; padding: 8px 10px 10px; min-height: 0; }
.code-pane { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; gap: 6px; min-height: 0; }
.code-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.run-button { min-width: 72px; background: var(--yellow); color: #23282F; border-color: var(--card-edge); box-shadow: 2px 2px 0 var(--shadow); }
.run-button.stop { background: var(--panel); color: var(--text); }
.code-language { font-size: 13px; color: var(--muted); padding: 2px 8px; border: 1.5px dashed var(--rule); border-radius: 999px; }
.code-status { font-size: 13.5px; font-weight: 700; margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.code-status.changed { color: var(--text); background: color-mix(in srgb, var(--yellow) 35%, transparent); padding: 2px 8px; border-radius: 6px; }
.code-status.error { color: var(--error); }
.code-message { margin: 0; font-size: 13.5px; color: var(--error); }
.code-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--card-edge); border-left: 6px solid var(--yellow); border-radius: 8px; background: var(--bg); }
.code-confirm p { margin: 0; flex: 1 1 260px; font-size: 14px; }
.code-editor { min-height: 0; overflow: hidden; border: 1.5px solid var(--card-edge); border-radius: 8px; background: var(--paper); color: #23282F; }
.code-editor .cm-editor { height: 100%; font: 14px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; }
.code-editor .cm-editor.cm-focused { outline: 3px solid var(--focus); outline-offset: 1px; }
.code-editor .cm-gutters { background: color-mix(in srgb, var(--paper) 80%, var(--rule)); color: #56615B; border-right: 1px solid var(--rule); }
.code-editor .cm-activeLine { background: color-mix(in srgb, var(--yellow) 14%, transparent); }
.code-editor .tok-keyword { color: #8A3FB8; font-weight: 700; }
.code-editor .tok-string, .code-editor .tok-string2 { color: #2E7D32; }
.code-editor .tok-number, .code-editor .tok-bool { color: #B3541E; }
.code-editor .tok-comment { color: #6B746E; font-style: italic; }
.code-editor .tok-variableName.tok-definition, .code-editor .tok-function { color: #1F5FB8; }
.code-editor .tok-typeName, .code-editor .tok-className { color: #9A6700; }
.code-help { font-size: 12.5px; }
.serial { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 6px; min-height: 0; }
.serial-head { display: flex; align-items: center; justify-content: space-between; }
.serial-head h3 { margin: 0; font: 600 16px/1.2 "Fredoka", system-ui, sans-serif; }
.serial-log { overflow-y: auto; overscroll-behavior: contain; border: 1.5px solid var(--card-edge); border-radius: 8px; background: #1F2328; color: #E8EAED; padding: 6px 8px; font: 13px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; }
.serial-log:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
.serial-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.serial-line.err { color: #FF8F87; }
.serial-line.note { color: #FFD866; }
.serial-line.echo { color: #9FD3FF; }
.serial-empty { margin: 0; color: #A3A9B0; font-family: "Atkinson Hyperlegible", system-ui, sans-serif; }
.serial-ref { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
.serial-ref:focus-visible { outline: 2px solid #9FD3FF; outline-offset: 1px; }
.serial-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 6px; align-items: center; }
.serial-input label { grid-column: 1 / -1; font-size: 13px; font-weight: 700; }
.serial-input input { font: 14px/1.2 ui-monospace, Consolas, monospace; color: var(--text); background: var(--bg); border: 1.5px solid var(--card-edge); border-radius: 6px; padding: 5px 8px; }
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 12px; top: 8px; z-index: 50; background: var(--panel); color: var(--text); border: 1.5px solid var(--card-edge); border-radius: 8px; padding: 6px 10px; box-shadow: 2px 2px 0 var(--shadow); }
@media (max-width: 900px) {
  .code-dock-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(180px, 1fr) minmax(120px, auto); overflow-y: auto; }
  .code-tab-board { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .code-dock * { transition: none !important; }
}
```

- [ ] **Step 5: Put the dock in the editor**

In `src/editor/editor.css`, the `.editor` grid becomes:

```css
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas: "bar bar bar" "lib canvas inspector" "lib dock inspector";
```

and in the `@media (max-width: 900px)` block: `grid-template-rows: auto minmax(0, 1fr) auto auto auto; grid-template-areas: "bar" "canvas" "dock" "inspector" "lib";`.

In `src/editor/Editor.tsx`: import `{ CodeDock }` from `./CodeDock.tsx` and render `<CodeDock store={store} />` right after `<Canvas ... />`. In `useEditorKeys`, at the very top of `onKey` (before the text-field check, so it works from inside the editor too):

```ts
      // Ctrl+` toggles the code dock (firmware spec 6.4), from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        const open = !store.getState().dock.open
        store.setDock({ open })
        if (open) requestAnimationFrame(() => document.querySelector<HTMLElement>('#code-dock [role="tab"][aria-selected="true"]')?.focus())
        return
      }
```

In `src/editor/Toolbar.tsx`, as the toolbar's first child: `{dockTabs(state).length > 0 && <a className="skip-link" href="#code-dock">Skip to code</a>}` (import `dockTabs` from `./CodeDock.tsx`). `Toolbar` has no `state` today: change line 108 from `const { diagram, selection, snapObjects, simulate, simTool, sim } = useEditorState(store)` to `const state = useEditorState(store)` followed by `const { diagram, selection, snapObjects, simulate, simTool, sim } = state`.

- [ ] **Step 6: Run the check and look at every screenshot**

Run: `npm run build && npm run check:code-ui`
Expected: every line `ok`, `all checks passed`. Open all twelve screenshots in `.superpowers/code-ui/` (idle, starting, running, changed, stopped, collapsed, error; light and dark): the dock sits under the sheet, tabs read "U1 Raspberry Pi 4 Model B blink.py" with a status dot, Run is the one yellow button, Serial is legible in both themes, nothing overlaps or clips. Fix and rerun until each looks right.

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run src/editor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/editor/CodeEditor.tsx src/editor/CodeDock.tsx src/editor/codeDock.css src/editor/Editor.tsx src/editor/Toolbar.tsx src/editor/editor.css scripts/check-code-ui.mjs package.json package-lock.json
git commit -m "$(cat <<'MSG'
Editor: the code dock (tabs with status, Run/Stop, Reset, Upload, Download, Serial, resize, collapse, Ctrl+backtick) with CodeMirror in a lazy chunk

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 35: The Inspector's Code section

**Files:**
- Modify: `src/editor/Inspector.tsx` (a `CodeSection` after `SimPartState`), `src/editor/codeDock.css` (its styles), `scripts/check-code-ui.mjs` (two cases)

**Interfaces:**
- Consumes: `languagesOf`, `LANGUAGE_NAMES`, `LANGUAGE_EXT` (Tasks 4, 5); `readCodeFile`, `downloadName`, `starterCode` (Task 33); `setPartCode` (Task 31); `runAction`, `runBlocker` (Task 32); `tabStatus` (Task 34).
- Produces: `function CodeSection({ store, diagram, part, m }: { store: EditorStore; diagram: Diagram; part: PartInstance; m: ModuleDef }): JSX.Element | null`, shown for boards whose module takes a language (spec 6.2): with no code, **Upload code** and **Write code**; with code, the file name, language and line count, Run/Stop, **Edit**, **Download** and **Remove code** (undoable).

- [ ] **Step 1: Add the failing check cases**

In `scripts/check-code-ui.mjs`, before `check(!errors.length, ...)`, add:

```js
  // 9. The Inspector's Code section: Write code opens the dock with the starter; Remove code is undoable.
  const plain = piSheet('plain', '')
  const raw = JSON.parse(readFileSync(plain, 'utf8'))
  raw.parts = raw.parts.map((p) => (p.uid === 'u1' ? { ...p, code: undefined } : p))
  writeFileSync(plain, JSON.stringify(raw))
  await open(plain)
  check((await page.locator('#code-dock').count()) === 0, `${scheme}: no dock on a sheet with no code`)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  await page.waitForSelector('.code-section')
  await shot('inspector-empty')
  await page.getByRole('button', { name: 'Write code' }).click()
  await page.waitForSelector('#code-dock .cm-content')
  check((await page.locator('.cm-content').textContent())?.includes('# Code for U1'), `${scheme}: Write code starts from the starter comment`)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  check((await page.locator('.code-section').textContent())?.match(/main\.py.*Raspberry Pi Python.*\d+ lines/s) !== null, `${scheme}: the section shows the file, language and line count`)
  await shot('inspector-code')
  await page.getByRole('button', { name: 'Remove code' }).click()
  check((await page.locator('#code-dock').count()) === 0 || (await page.locator('[data-dock-tab="u1"]').count()) === 0 || (await page.locator('.code-section button', { hasText: 'Write code' }).count()) === 1, `${scheme}: Remove code removes it`)
  await page.keyboard.press('Control+z')
  check((await page.locator('.code-section').textContent())?.includes('main.py'), `${scheme}: Remove code is undone by Undo`)
  // 10. An upload with the wrong extension is refused with the reason.
  const ino = join(out, 'blink.ino')
  writeFileSync(ino, 'void setup() {}\n')
  await page.locator('.code-section input[type=file]').setInputFiles(ino)
  check((await page.locator('.code-section [role=alert]').textContent()) === 'blink.ino is not Raspberry Pi Python code: it needs a .py file', `${scheme}: a .ino upload is refused with the reason`)
  await shot('inspector-refused')
```

Run: `npm run build && npm run check:code-ui`
Expected: FAIL at case 9 (no `.code-section`).

- [ ] **Step 2: The section**

In `src/editor/Inspector.tsx`, render `{m && <CodeSection store={store} diagram={diagram} part={part} m={m} />}` right after `<SimPartState ... />`, and add (imports: `languagesOf`, `LANGUAGE_EXT`, `LANGUAGE_NAMES` from `'../format/code.ts'`, `withLibraryData` from `'../format/simModel.ts'`, `libraryLookup` from `'../agent/catalog.ts'`, `readCodeFile`, `downloadName`, `starterCode` from `'./codeFile.ts'`, `setPartCode` from `'./ops.ts'`, `runAction`, `runBlocker` from `'./running.ts'`, `tabStatus` from `'./CodeDock.tsx'`, `downloadText` from `'./files.ts'`):

```tsx
/**
 * Firmware spec 6.2: a board whose module takes a language gets a Code section after Simulation
 * state. With no code: Upload code (a .py file) and Write code (the dock with a starter comment).
 * With code: its file, language and line count, Run/Stop, Edit, Download and Remove code (undoable).
 */
function CodeSection({ store, diagram, part, m }: { store: EditorStore; diagram: Diagram; part: Diagram['parts'][number]; m: ModuleDef }) {
  const state = useEditorState(store)
  const [refused, setRefused] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const langs = languagesOf(withLibraryData(m, libraryLookup))
  if (!langs.length) return null
  const language = part.code?.language ?? langs[0]
  const code = part.code
  const b = state.run.boards[part.uid]
  const live = b?.status === 'starting' || b?.status === 'running'
  const st = tabStatus(b, code)
  const blocker = live || !code ? null : runBlocker(state, part.uid)
  const openDock = () => store.setDock({ open: true, tab: part.uid })
  return (
    <section className="code-section" aria-labelledby="code-section-title">
      <h3 id="code-section-title">Code</h3>
      <input
        ref={file}
        type="file"
        hidden
        accept={(LANGUAGE_EXT[language] ?? []).join(',')}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const r = readCodeFile(f.name, new Uint8Array(await f.arrayBuffer()), language)
          setRefused(r.ok ? null : r.why)
          if (r.ok) {
            store.commit(setPartCode(diagram, part.uid, r.code))
            openDock()
          }
        }}
      />
      {!code ? (
        <>
          <p className="hint">Upload a {LANGUAGE_NAMES[language] ?? language} script, or write one here, and press Run to watch the circuit respond.</p>
          <div className="code-section-actions">
            <button type="button" className="tool" onClick={() => file.current?.click()}>Upload code</button>
            <button type="button" className="tool" onClick={() => (store.commit(setPartCode(diagram, part.uid, { language, source: starterCode(part.designator, m.name), file: 'main.py' })), openDock())}>Write code</button>
          </div>
        </>
      ) : (
        <>
          <dl className="code-facts">
            <dt>File</dt><dd>{code.file ?? 'main.py'}</dd>
            <dt>Language</dt><dd>{LANGUAGE_NAMES[code.language] ?? code.language}</dd>
            <dt>Length</dt><dd>{code.source.split('\n').length} lines</dd>
            <dt>Status</dt><dd>{st.key === 'changed' ? 'Code changed: Reset to apply' : st.text}</dd>
          </dl>
          <div className="code-section-actions">
            <button type="button" className="tool" disabled={!live && !!blocker} title={blocker ?? undefined} aria-label={live ? `Stop ${part.designator}'s code` : `Run ${part.designator}'s code`} onClick={() => (openDock(), runAction(store, live ? 'stop' : 'run', part.uid))}>{live ? 'Stop' : 'Run'}</button>
            <button type="button" className="tool" onClick={() => (openDock(), requestAnimationFrame(() => document.querySelector<HTMLElement>('#code-dock .cm-content')?.focus()))}>Edit</button>
            <button type="button" className="tool" onClick={() => downloadText(downloadName(code, part.designator), code.source, 'text/x-python')}>Download</button>
            <button type="button" className="tool" onClick={() => store.commit(setPartCode(diagram, part.uid, undefined))}>Remove code</button>
          </div>
          {blocker && <p className="hint">{blocker}</p>}
        </>
      )}
      {refused && <p className="code-message" role="alert">{refused}</p>}
    </section>
  )
}
```

(`useRef` and `useState` are already imported in Inspector.tsx.) Append to `src/editor/codeDock.css`:

```css
.code-section { display: grid; gap: 8px; }
.code-section h3 { margin: 0; font: 600 16px/1.2 "Fredoka", system-ui, sans-serif; }
.code-section-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.code-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; margin: 0; font-size: 14px; }
.code-facts dt { color: var(--muted); }
.code-facts dd { margin: 0; overflow-wrap: anywhere; }
```

`codeDock.css` is imported by `CodeDock.tsx`, which the editor always loads, so the Inspector's rules are present too.

- [ ] **Step 3: Run the check and look at the screenshots**

Run: `npm run build && npm run check:code-ui`
Expected: `all checks passed`. Open `code-inspector-empty-*`, `code-inspector-code-*` and `code-inspector-refused-*`: the section sits after Simulation state, buttons wrap cleanly in the 270 px Inspector, the refusal reads as an error in both themes.

- [ ] **Step 4: Commit**

```bash
git add src/editor/Inspector.tsx src/editor/codeDock.css scripts/check-code-ui.mjs
git commit -m "$(cat <<'MSG'
Editor: the Inspector's Code section (Upload, Write, Run/Stop, Edit, Download, Remove code)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 36: On the sheet: run badges, the servo horn, "avg" probe tags, run-time findings, About the simulator

**Files:**
- Modify: `src/editor/SimLayer.tsx` (run badges, servo horns), `src/editor/Canvas.tsx` (passes `run`), `src/editor/ProbeLayer.tsx` (`avg`), `src/editor/SimulationGroup.tsx` (run-time findings), `src/sim/display.ts` (`RUN_TITLES`), `src/editor/ProbesPanel.tsx` (About the simulator: Running code), `src/editor/editor.css`, `scripts/check-code-ui.mjs` (one case), `src/editor/simLayer.test.ts` (create)

**Interfaces:**
- Consumes: `RunView` (Task 31); `SimResult.pwm` (Task 24); `RunFinding` (Task 29); `bodyRect`, `layoutModule` (existing).
- Produces:
  - `const RUN_TITLES: Record<RunCode, string>` in `src/sim/display.ts`
  - `function runBadges(d: Diagram, run: RunView): { uid: string; kind: 'running' | 'error'; x: number; y: number }[]` and `function hornPath(cx: number, cy: number, r: number, angle: number): string` (exported from `SimLayer.tsx`)
  - `SimLayer` takes `run: RunView`; each badge `data-run-badge="<uid>"`, each horn `data-servo-horn="<uid>"` with `data-angle`
  - probe tags read `avg 1.21 V` when the shown result has `pwm` (ruling R7)

- [ ] **Step 1: Write the failing test**

`src/editor/simLayer.test.ts`:

```ts
// Firmware spec 6.3: a running board gets a green "running" badge, one stopped by an exception a red
// "error" one, at its body's top-right corner (ruling R14); a servo's horn is drawn at its angle; probe
// tags read "avg" when PWM is in the result (ruling R7); run-time findings have titles.
import { describe, expect, it } from 'vitest'
import { EMPTY_RUN } from './store.ts'
import { hornPath, runBadges } from './SimLayer.tsx'
import { readingText } from './ProbeLayer.tsx'
import { RUN_TITLES } from '../sim/display.ts'
import { piBlink } from '../run/sheets.testing.ts'

describe('run marks on the sheet (spec 6.3)', () => {
  it('badges running and error boards at the body\'s top right, and nothing else', () => {
    const d = piBlink()
    const board = (status: 'running' | 'error' | 'done') => ({ status, source: '', file: '', serial: [], prompt: null, progress: null, message: null })
    expect(runBadges(d, EMPTY_RUN)).toEqual([])
    const [b] = runBadges(d, { ...EMPTY_RUN, boards: { u1: board('running') } })
    expect(b).toMatchObject({ uid: 'u1', kind: 'running' })
    expect(runBadges(d, { ...EMPTY_RUN, boards: { u1: board('error') } })[0].kind).toBe('error')
    expect(runBadges(d, { ...EMPTY_RUN, boards: { u1: board('done') } })).toEqual([])
  })
  it('draws a horn pointing along its angle (0 left, 90 up, 180 right)', () => {
    expect(hornPath(0, 0, 10, 90)).toMatch(/^M-?0(\.0+)? -?0(\.0+)? L-?0(\.\d+)? -10/)
    expect(hornPath(0, 0, 10, 0)).toMatch(/L-10 0/)
  })
  it('reads PWM results as averages, and titles the run-time findings', () => {
    const v = { typical: { kind: 'value' as const, value: 1.21, reference: 'GND', trust: 'ok' as const }, peak: { kind: 'value' as const, value: 3.3, reference: 'GND', trust: 'ok' as const } }
    expect(readingText(v, true)).toBe('avg 1.21 V (peak 3.3 V)')
    expect(readingText(v, false)).toBe('1.21 V (peak 3.3 V)')
    expect(RUN_TITLES).toEqual({ 'undefined-level': 'Between logic levels', 'floating-read': 'Reads a floating pin', 'servo-signal': 'Servo signal out of range' })
  })
})
```

`readingText` keeps its existing format (`1.21 V (peak 3.3 V)`) and only gains the `avg ` prefix.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/editor/simLayer.test.ts`
Expected: FAIL: `runBadges` is not exported.

- [ ] **Step 3: Titles, tags and findings**

In `src/sim/display.ts` (import `type RunCode` from `'../run/core.ts'`): `export const RUN_TITLES: Record<RunCode, string> = { 'undefined-level': 'Between logic levels', 'floating-read': 'Reads a floating pin', 'servo-signal': 'Servo signal out of range' }`.

In `src/editor/ProbeLayer.tsx`, `readingText(r, avg = false)` prefixes `avg ` when `avg` is true (the `!r` case stays `-`); `TAG_RESERVE` becomes `'avg -00.00 V (peak -00.00 V)'`, so a tag never moves when PWM starts or stops; `ProbeLayer` takes `avg: boolean` and passes it to `readingText`; in `Canvas.tsx` pass `avg={!!simShown?.result.pwm}`. The wider reserve moves every probe tag slightly: rerun `npm run check:sim-ui` and look at its screenshots (Step 7).

In `src/editor/SimulationGroup.tsx`, read `run` from `useEditorState(store)` and append the run-time findings after the simulation's problems: each `RunFinding` renders like a warning row with `RUN_TITLES[f.code]`, its message, and the same hover and focus light (`store.setHighlight({ severity: 'warning', parts: f.parts, pins: f.pins, wires: [] })`); `data-run-finding={f.code}` on the row. They count in the group's warning count.

- [ ] **Step 4: Badges and horns**

In `src/editor/SimLayer.tsx` (import `type RunView` from `'./store.ts'`):

```tsx
/** Ruling R14: a pill at the body's top-right corner (the checker's mark owns the top left, simulation findings the top centre). */
export function runBadges(d: Diagram, run: RunView): { uid: string; kind: 'running' | 'error'; x: number; y: number }[] {
  return Object.entries(run.boards).flatMap(([uid, b]) => {
    const kind = b.status === 'running' || b.status === 'starting' ? 'running' : b.status === 'error' ? 'error' : null
    const p = d.parts.find((x) => x.uid === uid)
    const m = p && moduleOf(d, p.module)
    if (!kind || !p || !m) return []
    const box = bodyRect(p, layoutModule(m))
    return [{ uid, kind, x: box.x + box.w - 62, y: box.y - 10 }]
  })
}

/** A servo horn from the pivot at `angle` degrees: 0 points left, 90 up, 180 right. */
export function hornPath(cx: number, cy: number, r: number, angle: number): string {
  const a = Math.PI - (angle * Math.PI) / 180
  const f = (x: number) => Number(x.toFixed(2))
  return `M${f(cx)} ${f(cy)} L${f(cx + r * Math.cos(a))} ${f(cy - r * Math.sin(a))}`
}
```

`SimLayer` gains a `run: RunView` prop; inside its returned `<g>`, after the badges:

```tsx
      {runBadges(diagram, run).map((b) => (
        <g key={`run-${b.uid}`} className={`run-badge ${b.kind}`} data-run-badge={b.uid} pointerEvents="none">
          <rect x={b.x} y={b.y} width={60} height={18} rx={9} />
          <text x={b.x + 30} y={b.y + 9} textAnchor="middle" dominantBaseline="central">{b.kind === 'running' ? 'running' : 'error'}</text>
        </g>
      ))}
      {Object.entries(run.servos).map(([uid, s]) => {
        const p = diagram.parts.find((x) => x.uid === uid)
        const m = p && moduleOf(diagram, p.module)
        if (!p || !m) return null
        const box = bodyRect(p, layoutModule(m))
        const cx = box.x + box.w / 2
        const cy = box.y + box.h / 2
        const r = Math.min(box.w, box.h) * 0.42
        return (
          <g key={`horn-${uid}`} className="servo-horn" data-servo-horn={uid} data-angle={s.angle.toFixed(1)} pointerEvents="none">
            <title>{`${p.designator} at ${Math.round(s.angle)} degrees`}</title>
            <path d={hornPath(cx, cy, r, reducedMotion() ? s.target : s.angle)} />
            <circle cx={cx} cy={cy} r={4} />
          </g>
        )
      })}
```

with `const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches` above the component (spec 6.3: with reduced motion the horn jumps to its angle). In `Canvas.tsx`, read `run` from `useEditorState(store)`, pass it to `SimLayer`, and draw the `SimLayer` while `simOutcome || Object.keys(run.boards).length`.

Append to `src/editor/editor.css`:

```css
.run-badge rect { stroke: var(--card-edge); stroke-width: 1.5; }
.run-badge.running rect { fill: var(--green); }
.run-badge.error rect { fill: var(--error); }
.run-badge text { font: 700 11px/1 "Atkinson Hyperlegible", system-ui, sans-serif; fill: #FFFFFF; }
.servo-horn path { stroke: #F7F8F3; stroke-width: 7; stroke-linecap: round; filter: drop-shadow(1px 1px 0 #23282F); }
.servo-horn circle { fill: #23282F; }
```

- [ ] **Step 5: About the simulator: Running code**

In `src/editor/ProbesPanel.tsx`, inside the "About the simulator" `<details>`, after the engine paragraph, add:

```tsx
        <h3>Running code</h3>
        <p>
          A Raspberry Pi's Python runs in your browser on Pyodide, with RPi.GPIO and most of gpiozero. Pins, PWM, servos and print() reach the simulation;
          I2C and SPI devices, serial ports and threads are not simulated yet. Callbacks do not run at the same time as each other: a callback that sleeps holds
          blink() and the others until it returns. A read can lag the circuit by one solve. gpiozero's Servo defaults to 1 to 2 ms pulses, so Servo.min() turns an
          SG90 to about 47 degrees, as on many real ones.
        </p>
```

- [ ] **Step 6: The check case**

In `scripts/check-code-ui.mjs`, in case 3 (running), after the glow check, add:

```js
  check((await page.locator('[data-run-badge="u1"].running').count()) === 1, `${scheme}: the running board has a green "running" badge`)
```

and in case 5 (error), after the traceback check: `check((await page.locator('[data-run-badge="u1"].error').count()) === 1, \`${scheme}: an error badge\`)`. Add a servo case after case 5:

```js
  // 11. A servo turns: AngularServo sweeps; the horn's angle follows; the run finding list stays empty.
  const servoFile = piSheet('servo', 'from gpiozero import AngularServo\nimport time\ns = AngularServo(18, min_angle=0, max_angle=180, min_pulse_width=0.0005, max_pulse_width=0.0024)\nwhile True:\n    s.angle = 0\n    time.sleep(1)\n    s.angle = 180\n    time.sleep(1)\n', {
    parts: [at('m1', 'M1', 'servo-sg90', 640, 300)],
    wires: [w('w6', 'u1', 'GPIO18', 'm1', 'PWM'), w('w7', 'bt1', '+', 'm1', 'VCC'), w('w8', 'bt1', '-', 'm1', 'GND')],
  })
  await open(servoFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  const angles = new Set()
  for (let i = 0; i < 40 && angles.size < 3; i++) {
    angles.add(await page.getAttribute('[data-servo-horn="m1"]', 'data-angle').catch(() => null))
    await page.waitForTimeout(100)
  }
  check(angles.size >= 3, `${scheme}: the servo horn moves (${[...angles].join(', ')})`)
  await shot('servo')
  await page.locator('[data-run="u1"]').click()
```

- [ ] **Step 7: Run everything and look**

Run: `npx vitest run src/editor && npm run build && npm run check:code-ui && npm run check:sim-ui`
Expected: PASS; `check:sim-ui` unchanged (no run state there). Open `code-running-*`, `code-error-*` and `code-servo-*`: the pill sits clear of the checker mark and any finding badge, the horn reads in both themes.

- [ ] **Step 8: Commit**

```bash
git add src/editor/SimLayer.tsx src/editor/Canvas.tsx src/editor/ProbeLayer.tsx src/editor/SimulationGroup.tsx src/editor/ProbesPanel.tsx src/editor/editor.css src/sim/display.ts src/editor/simLayer.test.ts scripts/check-code-ui.mjs
git commit -m "$(cat <<'MSG'
Editor: running and error badges, the servo horn (reduced motion jumps), avg probe tags, run-time findings, About: Running code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 37: The full browser check: every state at both widths, budgets, the sandbox on the built site, regression under the service worker

**Files:**
- Modify: `scripts/check-code-ui.mjs` (the 390 px pass, budgets, sandbox, memory), `scripts/lib/browser-check.mjs` (`startStatic` and `--sw`)

**Interfaces:**
- Consumes: everything in Phase E; the budgets of spec 9; the baseline bundle size in the ledger (Task 31 Step 0).
- Produces: `npm run check:code-ui` covering spec 10's browser check in full; `startStatic(port): Promise<{ base: string; close(): void }>` and the `--sw` flag in `scripts/lib/browser-check.mjs` (any check run with `--sw` uses the header-less server, so the service worker isolates the page).

- [ ] **Step 1: `--sw` for every check**

In `scripts/lib/browser-check.mjs`, move the static server of `scripts/check-isolation-ui.mjs` into an exported `startStatic(port)` (same file types, `/circuitoon/` root, `Cache-Control: no-cache`, no isolation headers) and make `startPreview(port)` return `startStatic(port)` when the command line has `--sw`. `check-isolation-ui.mjs` imports `startStatic` instead of its own copy (its kill-switch swap stays: give `startStatic` an optional `override(path): string | null` that maps a request path to another file).

- [ ] **Step 2: Extend the check**

In `scripts/check-code-ui.mjs`:
- loop `for (const width of [1600, 390])` around the scheme loop (viewport height 1000 and 844), naming screenshots `code-<case>-<scheme>-<width>.png`; at 390 px the dock stacks the editor over Serial (the 900 px media query) and the tabs hide the board name;
- after the light 1600 pass, the budgets (each printed and checked; a miss on a busy machine is rerun quietly, never relaxed):

```js
  if (scheme === 'light' && width === 1600) {
    // Starting to running with the files cached (spec 9: 2.5 s): Reset reuses the fetched files.
    await open(blinkFile)
    await page.locator('[data-run="u1"]').click()
    await waitStatus('running', 30000)
    await page.locator('[data-run="u1"]').click()
    await waitStatus('stopped')
    const t0 = Date.now()
    await page.locator('[data-run="u1"]').click()
    await waitStatus('running', 30000)
    const warm = Date.now() - t0
    check(warm <= 2500, `starting to running, files cached: ${warm} ms (budget 2500 ms)`)
    // Memory per running board (spec 9: 120 MB): the code worker's share.
    const mem = await page.evaluate(async () => {
      const r = await performance.measureUserAgentSpecificMemory()
      return r.breakdown.filter((b) => b.attribution.some((a) => a.scope === 'DedicatedWorkerGlobalScope')).reduce((s, b) => s + b.bytes, 0)
    })
    check(mem / 1048576 <= 120, `code worker memory ${(mem / 1048576).toFixed(1)} MB (budget 120 MB)`)
    await page.locator('[data-run="u1"]').click()
    // Run-state change to re-solved glow (spec 9): the code prints time.time() at each toggle; the
    // glow's change is timed in the page; p95 of the delay at most 50 ms with no PWM.
    const toggles = piSheet('toggles', 'import time\nfrom gpiozero import LED\nled = LED(17)\nfor i in range(24):\n    led.toggle()\n    print(repr(time.time()))\n    time.sleep(0.4)\n')
    await open(toggles)
    await page.evaluate(() => {
      window.__glow = []
      new MutationObserver(() => window.__glow.push(Date.now())).observe(document.querySelector('svg.canvas'), { subtree: true, attributes: true, attributeFilter: ['data-sim-level'] })
    })
    await page.locator('[data-run="u1"]').click()
    await waitStatus('done', 60000)
    const printed = (await page.$$eval('.serial-line.out', (els) => els.map((e) => Number(e.textContent) * 1000)))
    const glow = await page.evaluate(() => window.__glow)
    const delays = printed.map((t) => (glow.find((g) => g >= t) ?? Infinity) - t).sort((a, b) => a - b)
    const p95 = delays[Math.floor(delays.length * 0.95)]
    check(p95 <= 50, `run-state change to glow, no PWM: p95 ${p95} ms (budget 50 ms)`)
    // First visit on a 50 Mbit/s line with nothing cached (spec 9: 6 s, with progress).
    const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const fp = await fresh.newPage()
    const cdp = await fresh.newCDPSession(fp)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 50e6 / 8, uploadThroughput: 10e6 / 8 })
    await fp.goto(base + '#/editor', { waitUntil: 'networkidle' })
    await fp.getByRole('button', { name: /New diagram/ }).click()
    await fp.locator('.toolbar input[type=file]').setInputFiles(blinkFile)
    await fp.waitForSelector('[data-run="u1"]')
    const t1 = Date.now()
    await fp.locator('[data-run="u1"]').click()
    await fp.waitForFunction(() => document.querySelector('[data-dock-tab="u1"]')?.getAttribute('data-status') === 'running', null, { timeout: 60000 })
    const cold = Date.now() - t1
    check(cold <= 6000, `first visit, 50 Mbit/s, starting to running: ${cold} ms (budget 6000 ms)`)
    await fresh.close()
  }
```

- the sandbox on the built site (spec 10), once per scheme at 1600 px:

```js
  // The worker sandbox (spec 2.6, 10): user code cannot reach the network through js, run_js or the
  // worker's prototypes; the CSP blocks eval, so the Function constructor escape fails too.
  const probe = piSheet('sandbox', [
    'import js',
    "print('fetch in js:', hasattr(js, 'fetch'))",
    'from pyodide.code import run_js',
    "for src in ['fetch(\"https://example.com/\")', 'self.constructor.constructor(\"return fetch\")()', 'Object.getPrototypeOf(self).fetch']:",
    '    try:',
    '        run_js(src)',
    "        print('ran', src)",
    '    except Exception as e:',
    "        print('blocked:', type(e).__name__)",
  ].join('\n') + '\n')
  const foreign = []
  page.on('request', (r) => !r.url().startsWith(base.slice(0, base.indexOf('/circuitoon/'))) && foreign.push(r.url()))
  await open(probe)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('done', 30000)
  const said = await page.$$eval('.serial-line', (els) => els.map((e) => e.textContent))
  check(said[0] === 'fetch in js: False' && said.slice(1).every((l) => l.startsWith('blocked:')), `${scheme}: user code reaches no network (${said.join(' | ')})`)
  check(!foreign.some((u) => u.includes('example.com')), `${scheme}: no request left the origin`)
```

- [ ] **Step 3: Bundle budgets**

Run: `npm run build && node -e "const fs=require('fs'),z=require('zlib');for(const f of fs.readdirSync('dist/assets').filter(x=>/\.js$/.test(x)))console.log(f,z.gzipSync(fs.readFileSync('dist/assets/'+f)).length)"`
Expected: `index-*.js` at most 20,480 bytes gzip over the Task 31 baseline (spec 9); the CodeMirror chunk (`CodeEditor-*.js`, plus any chunk only it imports) at most 150 KB gzip. Write both figures in the ledger. Over budget: find what pulled weight into the main bundle (`npx vite build --sourcemap` and inspect `index-*.js.map`) before going on; never raise the budget.

- [ ] **Step 4: Run every check, and the regression under the service worker**

Run: `npm run build && npm run check:code-ui && npm run check:isolation-ui && npm run check:sim-ui -- --sw && npm run check:guides-ui -- --sw && npm run check:partmaker-ui -- --sw`
Expected: all pass (spec 10: "the existing UI checks (sim, guides, part maker) pass with the service worker active"). Then open every screenshot from `check:code-ui`: idle, starting, running, changed, error, stopped, collapsed, servo, the Inspector's three, in light and dark, at 1600 and 390 px. At 390 px nothing may clip or overlap: the dock's toolbar wraps, the tabs scroll sideways, Serial sits under the editor. Fix and rerun until each is right; list the files you looked at in the ledger.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-code-ui.mjs scripts/lib/browser-check.mjs scripts/check-isolation-ui.mjs
git commit -m "$(cat <<'MSG'
Checks: code UI at 1600 and 390 px in both themes, budgets, the sandbox on the built site, regression under the service worker

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# Phase F: agents, samples and docs (spec 11 step 6)

### Task 38: Code in netlists: `code` on a part, layout embeds it, `netlist` writes it out

**Files:**
- Create: `src/cli/codeFiles.ts`, `src/cli/netlistCode.test.ts`
- Modify: `src/agent/netlist.ts` (`IntentPart.code`, parsing), `src/agent/place.ts` (copy it to the part), `src/agent/extract.ts` (extract it), `src/cli/layoutCmd.ts` (embed files), `src/cli/netlistCmd.ts` (write files), `plugin/skills/circuitoon-design/references/schemas/netlist.schema.json` (the part's `code`), `plugin/skills/circuitoon-design/references/netlist-format.md`

**Interfaces:**
- Consumes: `checkCode`, `KNOWN_LANGUAGES`, `LANGUAGE_EXT`, `SOURCE_MAX_BYTES` (Task 4); `cli`, `tempDir` (`cliHarness.testing.ts`).
- Produces:
  - `IntentPart.code?: { language: string; path: string } | PartCode` (a netlist names a file; a laid-out or inline netlist carries the source, ruling R18)
  - `src/cli/codeFiles.ts`: `function embedCode(raw: unknown, dir: string, file: string): unknown` (every `code.path` read and replaced by `{ language, source, file }`; throws `CliError` exit 2 on a bad path or file) and `function writeCode(netlist: { parts: Record<string, unknown>[] }, outFile: string, io: Io): void` (each inline code written as `<ref><ext>` beside `outFile` and replaced by `{ language, path }`)
  - path rules (spec 7): relative, inside the netlist's directory, no `..`, and not outside it through a symlink

- [ ] **Step 1: Write the failing test**

`src/cli/netlistCode.test.ts`:

```ts
// Firmware spec 7: a netlist part may carry `code: { language, path }`; layout reads the file and
// embeds it (the path relative, inside the netlist's folder, no "..", not out through a symlink);
// `netlist -o` writes each board's code next to it as <designator>.<ext> and references it; without
// -o the code is inline (ruling R18). Round trips through netlist, layout and extract keep the code.
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'

const BLINK = 'from gpiozero import LED\nLED(17).blink()\n'
const net = (code: unknown) => ({
  format: 'circuitoon-netlist/1', title: 'Pi blink',
  parts: [{ ref: 'U1', module: 'rpi-4-model-b', code }, { ref: 'R1', module: 'resistor', values: { resistance: { value: 330, unit: 'ohm' } } }, { ref: 'D1', module: 'led' }],
  nets: [{ name: 'LED_A', pins: ['U1.GPIO17', 'R1.1'] }, { name: 'LED_K', pins: ['R1.2', 'D1.A'] }, { name: 'GND', pins: ['D1.K', 'U1.GND'] }],
})

describe('code in netlists (spec 7)', () => {
  it('parses code with a path or inline source, and refuses a bad one', () => {
    expect(parseNetlist(net({ language: 'python-rpi', path: 'blink.py' }), libraryLookup)).toMatchObject({ ok: true, intent: { parts: [{ ref: 'U1', code: { language: 'python-rpi', path: 'blink.py' } }] } })
    expect(parseNetlist(net({ language: 'python-rpi', source: BLINK, file: 'blink.py' }), libraryLookup).ok).toBe(true)
    const errs = (code: unknown) => { const r = parseNetlist(net(code), libraryLookup); return r.ok ? [] : r.errors }
    expect(errs({ language: 'python-rpi', path: '../x.py' })).toContain('parts[0].code.path: must be a relative path inside the netlist\'s folder, with no ".."')
    expect(errs({ language: 'python-rpi', path: '/etc/x.py' })[0]).toMatch(/^parts\[0\]\.code\.path: must be a relative path/)
    expect(errs({ language: 'cobol', path: 'x.py' })).toContain('parts[0].code.language: unknown language "cobol" (python-rpi, arduino-avr, micropython)')
    expect(errs('x')).toContain('parts[0].code: must be { "language", "path" } or { "language", "source", "file" }')
  })
  it('layout embeds the file, and netlist -o writes it back out as U1.py', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'blink.py'), BLINK)
    writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', path: 'src/blink.py' })))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    expect(sheet.parts.find((p: { uid: string }) => p.uid === 'U1').code).toEqual({ language: 'python-rpi', source: BLINK, file: 'blink.py' })
    expect((await cli(['netlist', 'sheet.json', '-o', 'out/again.json'], { cwd: dir })).code).toBe(0)
    const again = JSON.parse(readFileSync(join(dir, 'out', 'again.json'), 'utf8'))
    expect(again.parts.find((p: { ref: string }) => p.ref === 'U1').code).toEqual({ language: 'python-rpi', path: 'U1.py' })
    expect(readFileSync(join(dir, 'out', 'U1.py'), 'utf8')).toBe(BLINK)
    expect((await cli(['layout', 'out/again.json', '-o', 'sheet2.json'], { cwd: dir })).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'sheet2.json'), 'utf8')).parts.find((p: { uid: string }) => p.uid === 'U1').code.source).toBe(BLINK)
  })
  it('netlist without -o inlines the code (ruling R18)', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', source: BLINK, file: 'blink.py' })))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const r = await cli(['netlist', 'sheet.json'], { cwd: dir })
    expect(JSON.parse(r.out).parts.find((p: { ref: string }) => p.ref === 'U1').code).toEqual({ language: 'python-rpi', source: BLINK, file: 'blink.py' })
  })
  it('refuses a path out of the folder through a symlink, and a missing file, with exit 2', async () => {
    const outside = tempDir()
    writeFileSync(join(outside, 'secret.py'), 'print(1)\n')
    const dir = tempDir()
    let linked = true
    try {
      symlinkSync(join(outside, 'secret.py'), join(dir, 'link.py'))
    } catch {
      linked = false // Windows without the symlink privilege: the rule is still checked by the missing-file case
    }
    if (linked) {
      writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', path: 'link.py' })))
      const r = await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })
      expect([r.code, r.err]).toEqual([2, "n.json: U1's code link.py leads outside the netlist's folder\n"])
    }
    writeFileSync(join(dir, 'm.json'), JSON.stringify(net({ language: 'python-rpi', path: 'nope.py' })))
    const m = await cli(['layout', 'm.json', '-o', 'sheet.json'], { cwd: dir })
    expect([m.code, m.err]).toEqual([2, "m.json: U1's code nope.py cannot be read\n"])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/cli/netlistCode.test.ts`
Expected: FAIL: the parsed intent has no `code`.

- [ ] **Step 3: Parse it**

In `src/agent/netlist.ts` (import `type PartCode, KNOWN_LANGUAGES, checkCode` from `'../format/code.ts'`):
- `IntentPart` gains `/** Code on a board (firmware spec 7): a file next to the netlist, or the source itself (ruling R18). */ code?: { language: string; path: string } | PartCode`;
- in `parseNetlist`, after the `settings` block:

```ts
    if (p.code !== undefined) {
      const c = p.code
      const lang = isObj(c) ? c.language : undefined
      if (!isObj(c) || (typeof c.path !== 'string' && typeof c.source !== 'string')) errors.push(`${at}.code: must be { "language", "path" } or { "language", "source", "file" }`)
      else if (typeof lang !== 'string' || !(KNOWN_LANGUAGES as readonly string[]).includes(lang)) errors.push(`${at}.code.language: unknown language "${String(lang)}" (${KNOWN_LANGUAGES.join(', ')})`)
      else if (typeof c.path === 'string') {
        if (!c.path || /^([\\/]|[A-Za-z]:)/.test(c.path) || c.path.split(/[\\/]/).includes('..')) errors.push(`${at}.code.path: must be a relative path inside the netlist's folder, with no ".."`)
        else part.code = { language: lang, path: c.path }
      } else {
        const r = checkCode(c, ref)
        if (!r.code) errors.push(...r.warnings.map((w) => `${at}.code: ${w}`))
        else part.code = r.code
      }
    }
```

In `src/agent/place.ts` `placeParts`, the instance gains `...(p.code && 'source' in p.code ? { code: p.code } : {})`. In `src/agent/extract.ts`, each extracted part gains `...(p.code ? { code: p.code } : {})`.

- [ ] **Step 4: The CLI side**

`src/cli/codeFiles.ts`:

```ts
// Code files beside a netlist (firmware spec 7). layout reads each part's `code.path` (relative,
// inside the netlist's folder, no "..", and not out of it through a symlink) and embeds the source;
// `netlist -o` writes each board's code next to the netlist as <designator><ext> and points at it.
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { LANGUAGE_EXT, SOURCE_MAX_BYTES } from '../format/code.ts'
import { isObj } from '../format/module.ts'
import { CliError, EXIT, type Io, writeFile } from './io.ts'

/** The netlist with every `code.path` replaced by the file's source. `file` names the netlist in messages. */
export function embedCode(raw: unknown, dir: string, file: string): unknown {
  if (!isObj(raw) || !Array.isArray(raw.parts)) return raw
  const root = realpathSync(dir)
  return {
    ...raw,
    parts: raw.parts.map((p) => {
      if (!isObj(p) || !isObj(p.code) || typeof p.code.path !== 'string') return p
      const path = p.code.path
      const who = `${file}: ${String(p.ref)}'s code ${path}`
      let real: string
      try {
        real = realpathSync(resolve(dir, path))
      } catch {
        throw new CliError(`${who} cannot be read`, EXIT.input)
      }
      const rel = relative(root, real)
      if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(root, rel) !== real) throw new CliError(`${who} leads outside the netlist's folder`, EXIT.input)
      const bytes = readFileSync(real)
      if (bytes.length > SOURCE_MAX_BYTES) throw new CliError(`${who} is over 256 KB`, EXIT.input)
      let source: string
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new CliError(`${who} is not UTF-8 text`, EXIT.input)
      }
      return { ...p, code: { language: p.code.language, source, file: basename(path) } }
    }),
  }
}

/** Writes each part's inline code beside the netlist as <ref><ext> and references it by path. */
export function writeCode(netlist: { parts: Record<string, unknown>[] }, outFile: string, io: Io): void {
  for (const p of netlist.parts) {
    const c = p.code
    if (!isObj(c) || typeof c.source !== 'string' || typeof c.language !== 'string') continue
    const name = `${String(p.ref)}${(LANGUAGE_EXT[c.language] ?? ['.txt'])[0]}`
    writeFile(io, join(dirname(outFile), name), c.source)
    p.code = { language: c.language, path: name }
  }
}
```

In `src/cli/layoutCmd.ts`, right after `raw = readJson(io, input!)` (the netlist branch): `raw = embedCode(raw, dirname(pathIn(io, input!)), input!)` (import `dirname` from `node:path`, `pathIn` from `./io.ts`, `embedCode` from `./codeFiles.ts`). In `src/cli/netlistCmd.ts`, after `const out = flag(args, '--out') ?? null` and before `const text = JSON.stringify(netlist, null, 2)` is built (it must serialize the netlist after `writeCode` has replaced each inline code with its path): `if (out) writeCode(netlist as { parts: Record<string, unknown>[] }, out, io)`.

In `netlist.schema.json`, give the netlist part's properties a `code` entry: `{ "type": "object", "required": ["language"], "properties": { "language": { "type": "string" }, "path": { "type": "string" }, "source": { "type": "string" }, "file": { "type": "string" } }, "additionalProperties": false }`. In `netlist-format.md`, document the `code` key on a part: `{ "language": "python-rpi", "path": "blink.py" }`, the path rules, and that `circuitoon netlist -o` writes `<ref>.py` beside the netlist.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/cli/netlistCode.test.ts src/cli/netlistCmd.test.ts src/agent && npm run build:cli`
Expected: PASS (the existing netlist and layout tests too: parts without code are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/agent/netlist.ts src/agent/place.ts src/agent/extract.ts src/cli/codeFiles.ts src/cli/layoutCmd.ts src/cli/netlistCmd.ts src/cli/netlistCode.test.ts plugin/skills/circuitoon-design/references plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Agents: code on netlist parts (path confined to the netlist folder), embedded by layout, written out by netlist -o

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 39: `circuitoon run`

**Files:**
- Create: `src/cli/runCmd.ts`, `src/cli/runCmd.test.ts`, `plugin/skills/circuitoon-design/references/schemas/run.schema.json`
- Modify: `src/cli/args.ts` (`--input`, `--press` repeat; `--board`, `--for`, `--py-dir`), `src/cli/main.ts` (command, usage), `plugin/skills/circuitoon-design/references/cli.md`

**Interfaces:**
- Consumes: `drive`, `Press`, `stateText` (Task 30); `ensurePy`, `cacheRoot`, `NO_LONGER_PUBLISHED` (Task 19); `loadSheet`, `CliError`, `EXIT`, `printJson` (`io.ts`); `switchGroups` (`simState.ts`); `makeEngine`, `createNodeEngineHost`.
- Produces:
  - `const RUN_FORMAT = 'circuitoon-cli/run/1'`; `const RUN_MAX_MS = 600_000`; `function parseDuration(s: string): number | null` (`5s`, `500ms`, `2.5s`, `3`); `function parsePress(spec: string): { ref: string; atMs: number; forMs: number } | null` (`S1@1.5s`, `S1@1.5s:0.2s`, default 0.2 s)
  - `function runCommand(args: Args, io: Io, opts?: { engine?: Engine; fetch?: typeof fetch; realLimitMs?: number }): Promise<number>`
  - exit codes (spec 7, ruling R17): 0 ran clean; 1 a Python error, a blocking finding, lost power, or code that never pauses; 2 usage (bad flags, `--for` over 600 s, a press on a part that is not a switch or button, overlapping button presses, an unknown board); 3 incomplete (a board with no sim data, no code or no power) or the Python runtime missing

- [ ] **Step 1: Write the failing test**

`src/cli/runCmd.test.ts`:

```ts
// Firmware spec 7: `circuitoon run` runs a sheet's board code on the virtual clock and prints Serial,
// a pin timeline and the findings; --json gives circuitoon-cli/run/1; --press and --input drive it;
// the exit codes are the spec's.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serializeDiagram } from '../format/diagram.ts'
import { piBlink, piButton } from '../run/sheets.testing.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { CliError } from './io.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { NO_LONGER_PUBLISHED } from '../run/node/pyCache.ts'
import { parseDuration, parsePress, runCommand } from './runCmd.ts'
import { parseArgs } from './args.ts'

const PY = resolve('node_modules/pyodide')
const sheet = (d: ReturnType<typeof piBlink>) => {
  const dir = tempDir()
  writeFileSync(join(dir, 's.json'), serializeDiagram(d))
  return dir
}
const run = (dir: string, ...flags: string[]) => cli(['run', 's.json', '--py-dir', PY, ...flags], { cwd: dir })

describe('circuitoon run (spec 7)', () => {
  it('parses durations and presses', () => {
    expect([parseDuration('5s'), parseDuration('500ms'), parseDuration('2.5s'), parseDuration('3'), parseDuration('x')]).toEqual([5000, 500, 2500, 3000, null])
    expect(parsePress('S1@1.5s')).toEqual({ ref: 'S1', atMs: 1500, forMs: 200 })
    expect(parsePress('S1@1.5s:0.05s')).toEqual({ ref: 'S1', atMs: 1500, forMs: 50 })
    expect(parsePress('S1')).toBeNull()
  })
  it('runs blink for 3.5 s: Serial, a 1 Hz timeline, exit 0, and JSON to the schema', async () => {
    const dir = sheet(piBlink())
    const r = await run(dir, '--for', '3.5s')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/0\.000 s {2}U1 GPIO17 high\n\s+1\.000 s {2}U1 GPIO17 low\n\s+2\.000 s {2}U1 GPIO17 high\n\s+3\.000 s {2}U1 GPIO17 low/)
    const j = await run(dir, '--for', '2s', '--json')
    const doc = JSON.parse(j.out)
    expect(schemaErrors(loadSchema('run'), doc)).toEqual([])
    expect(doc).toMatchObject({ format: 'circuitoon-cli/run/1', ok: true, exit: 0, simulatedSeconds: 2, boards: [{ ref: 'U1', status: 'stopped' }] })
  }, 120_000)
  it('presses a button and feeds input()', async () => {
    const pressed = await run(sheet(piButton("from gpiozero import Button\nfrom signal import pause\nb = Button(27)\nb.when_pressed = lambda: print('pressed')\npause()\n")), '--for', '3s', '--press', 'S1@1.5s')
    expect(pressed.out).toContain('[1.500 s] pressed')
    const typed = await run(sheet(piButton("print('Hi', input('Name? '))\n")), '--input', 'Ada')
    expect([typed.code, typed.out.includes('Hi Ada')]).toEqual([0, true])
  }, 120_000)
  it('exits 1 on a Python error, 3 with no code or no power, 2 on bad usage', async () => {
    expect((await run(sheet(piButton("raise ValueError('x')\n")))).code).toBe(1)
    const none = piBlink()
    none.parts = none.parts.map((p) => (p.uid === 'u1' ? { ...p, code: undefined } : p))
    const n = await run(sheet(none))
    expect([n.code, n.err]).toEqual([3, expect.stringContaining('U1 has no code')])
    const dir = sheet(piBlink())
    expect((await run(dir, '--for', '601s')).code).toBe(2)
    expect((await run(dir, '--press', 'D1@1s')).err).toContain('run: --press D1@1s: D1 is not a switch or button')
    expect((await run(dir, '--press', 'S1@1s:1s', '--press', 'S1@1.5s')).code).toBe(2)
    expect((await run(dir, '--board', 'U9')).err).toContain('run: --board U9: no board U9 with code on the sheet')
  }, 120_000)
  it('says the Python runtime is no longer published when Pages has no copy (exit 3)', async () => {
    const dir = sheet(piBlink())
    let err = ''
    const parsed = parseArgs(['run', 's.json'])
    if (!parsed.ok) throw new Error(parsed.error)
    // runCommand throws a CliError; main.ts turns it into the message and exit code asserted here.
    const code = await runCommand(parsed.value, { stdout() {}, stderr: (s) => void (err += s), cwd: dir, env: { CIRCUITOON_CACHE: tempDir() } }, { fetch: (async () => new Response('', { status: 404 })) as typeof fetch }).catch((e: CliError) => ((err += `${e.message}
`), e.code))
    expect([code, err]).toEqual([3, `${NO_LONGER_PUBLISHED}\n`])
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/cli/runCmd.test.ts`
Expected: FAIL, `./runCmd.ts` cannot be found.

- [ ] **Step 3: Flags and the command table**

In `src/cli/args.ts`: `LIST_FLAGS` becomes `new Set(['--probe', '--input', '--press'])`; add `'--board', '--for', '--py-dir'` to `VALUE_FLAGS`. In `src/cli/main.ts`: import `runCommand`, add `run: runCommand` to `COMMANDS`, and to `USAGE` after `sim`:

```
  run <sheet.json> [--board <ref>|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json] [--py-dir <dir>]
                                            run the boards' code (Raspberry Pi Python) on a virtual clock with the live simulation:
                                            Serial, a pin timeline and the findings; Python downloads once from the Circuitoon site
```

- [ ] **Step 4: Write `src/cli/runCmd.ts`**

```ts
// `circuitoon run <sheet> [--board U1|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]...
// [--json] [--py-dir <path>]` (firmware spec 7): runs the boards' code in Node workers on a virtual
// clock with the live simulation (src/run/driver.ts), then prints each board's Serial, the pin
// timeline (steady PWM as one line per duty change) and the findings seen. Deterministic and faster
// than real time. Exit 0 clean; 1 a Python error, a blocking finding, lost power or code that never
// pauses; 2 usage; 3 a board that could not start (no code, no sim data, no power) or no Python runtime.
import { switchGroups } from '../format/simState.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { type Press, drive } from '../run/driver.ts'
import { boardKindOf } from '../run/boards.ts'
import { cacheRoot, ensurePy } from '../run/node/pyCache.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, pathIn, printJson } from './io.ts'

export const RUN_FORMAT = 'circuitoon-cli/run/1'
export const RUN_MAX_MS = 600_000
const USAGE = 'run: usage: circuitoon run <sheet.json> [--board <ref>|all] [--for 5s] [--input "line"]... [--press S1@1.5s[:0.2s]]... [--json] [--py-dir <dir>]'

export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(s.trim())
  return m ? Math.round(Number(m[1]) * (m[2] === 'ms' ? 1 : 1000)) : null
}

export function parsePress(spec: string): { ref: string; atMs: number; forMs: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9_]*)@([^:]+)(?::(.+))?$/.exec(spec)
  const at = m ? parseDuration(m[2]) : null
  const len = m?.[3] === undefined ? 200 : parseDuration(m[3])
  return m && at !== null && len !== null ? { ref: m[1], atMs: at, forMs: len } : null
}

const secs = (ms: number) => `${(ms / 1000).toFixed(3)} s`

export async function runCommand(args: Args, io: Io, opts: { engine?: Engine; fetch?: typeof fetch; realLimitMs?: number } = {}): Promise<number> {
  const [input, ...rest] = args.positionals
  if (!input || rest.length) throw new CliError(USAGE, EXIT.input)
  const json = args.flags.has('--json')
  const { diagram: d, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const byRef = new Map(d.parts.map((p) => [p.designator, p]))
  const coded = d.parts.filter((p) => p.code)
  const board = flag(args, '--board') ?? 'all'
  let boards: string[]
  if (board === 'all') boards = coded.map((p) => p.uid)
  else {
    const p = byRef.get(board)
    if (!p?.code) throw new CliError(`run: --board ${board}: no board ${board} with code on the sheet`, EXIT.input)
    boards = [p.uid]
  }
  if (!boards.length) {
    const names = d.parts.filter((p) => boardKindOf(d.modules[p.module])).map((p) => p.designator)
    if (json) printJson(io, { format: RUN_FORMAT, ok: false, exit: EXIT.environment, simulatedSeconds: 0, boards: [], timeline: [], findings: [], incomplete: names.map((ref) => ({ ref, why: `${ref} has no code` })), neverPauses: [], lostPower: [] })
    io.stderr(`${names.length ? names.map((n) => `${n} has no code`).join('\n') : 'The sheet has no board with code'}\n`)
    return EXIT.environment
  }
  const forArg = flag(args, '--for')
  const forMs = forArg === undefined ? 5000 : parseDuration(forArg)
  if (forMs === null || forMs <= 0 || forMs > RUN_MAX_MS) throw new CliError(`run: --for ${forArg}: give a time from 1ms to 600s, such as 5s`, EXIT.input)
  // Presses (ruling R17): buttons are held for their length, switches flip; button presses may not overlap.
  const presses: Press[] = []
  for (const spec of args.lists?.get('--press') ?? []) {
    const p = parsePress(spec)
    if (!p) throw new CliError(`run: --press ${spec}: write it as REF@TIME[:LENGTH], such as S1@1.5s:0.2s`, EXIT.input)
    const part = byRef.get(p.ref)
    const groups = part ? switchGroups(d.modules[part.module]) : []
    if (!part || !groups.some((g) => g.kind === 'switch')) throw new CliError(`run: --press ${spec}: ${p.ref} is not a switch or button`, EXIT.input)
    presses.push({ uid: part.uid, atMs: p.atMs, forMs: groups.some((g) => g.momentary) ? p.forMs : 0 })
  }
  const held = presses.filter((p) => p.forMs > 0).sort((a, b) => a.atMs - b.atMs)
  for (let i = 1; i < held.length; i++)
    if (held[i].atMs < held[i - 1].atMs + held[i - 1].forMs) throw new CliError('run: two --press button presses overlap; one button is held at a time', EXIT.input)
  let py: { indexURL: string; lock: string }
  try {
    const pyDir = flag(args, '--py-dir')
    py = await ensurePy({ ...(pyDir ? { pyDir: pathIn(io, pyDir) } : { cacheDir: cacheRoot(io.env) }), ...(opts.fetch ? { fetch: opts.fetch } : {}) })
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e), EXIT.environment)
  }
  const engine = opts.engine ?? makeEngine(createNodeEngineHost())
  try {
    const r = await drive({ diagram: d, boards, forMs, inputs: [...(args.lists?.get('--input') ?? [])], presses, engine, py, library: libraryLookup, ...(opts.realLimitMs ? { realLimitMs: opts.realLimitMs } : {}) })
    const refOf = (uid: string) => d.parts.find((p) => p.uid === uid)?.designator ?? uid
    const blocking = r.findings.some((f) => f.severity === 'error')
    const failed = r.boards.some((b) => b.status === 'error') || r.lostPower.length > 0 || r.neverPauses.length > 0 || blocking
    const code = failed ? EXIT.blocked : r.incomplete.length ? EXIT.environment : EXIT.ok
    if (json) {
      printJson(io, {
        format: RUN_FORMAT, ok: code === EXIT.ok, exit: code, simulatedSeconds: r.simulatedMs / 1000,
        boards: r.boards.map((b) => ({ ref: b.ref, status: b.status, serial: b.serial.map((s) => ({ t: s.t / 1000, stream: s.stream, text: s.text })) })),
        timeline: r.timeline.map((e) => ({ t: e.t / 1000, ref: refOf(e.uid), pin: e.pin, state: e.state })),
        findings: r.findings,
        incomplete: r.incomplete.map((x) => ({ ref: refOf(x.uid), why: x.why })),
        neverPauses: r.neverPauses.map(refOf), lostPower: r.lostPower.map(refOf),
      })
      return code
    }
    const lines: string[] = []
    for (const b of r.boards) {
      lines.push(`${b.ref}: ${b.status === 'not-started' ? 'did not start' : b.status} (${secs(r.simulatedMs)} simulated)`)
      for (const s of b.serial) for (const t of s.text.replace(/\n$/, '').split('\n')) lines.push(`  [${secs(s.t)}] ${s.stream === 'err' ? 'error: ' : s.stream === 'note' ? 'note: ' : ''}${t}`)
    }
    for (const x of r.incomplete) lines.push(`${x.why}`)
    if (r.timeline.length) lines.push('Pins:', ...r.timeline.map((e) => `  ${secs(e.t).padStart(9)}  ${refOf(e.uid)} ${e.pin} ${e.state}`))
    if (r.findings.length) lines.push('Findings:', ...r.findings.map((f) => `  ${f.severity}: ${f.message}`))
    io.stdout(`${lines.join('\n')}\n`)
    return code
  } finally {
    if (!opts.engine) engine.dispose()
  }
}
```

The "did not start" boards stay in `boards` (status `not-started`) and their reason is in `incomplete`.

- [ ] **Step 5: The schema and the docs**

`plugin/skills/circuitoon-design/references/schemas/run.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon-cli/run/1",
  "type": "object",
  "required": ["format", "ok", "exit", "simulatedSeconds", "boards", "timeline", "findings", "incomplete", "neverPauses", "lostPower"],
  "additionalProperties": false,
  "properties": {
    "format": { "const": "circuitoon-cli/run/1" },
    "ok": { "type": "boolean" },
    "exit": { "enum": [0, 1, 2, 3] },
    "simulatedSeconds": { "type": "number", "minimum": 0 },
    "boards": {
      "type": "array",
      "items": {
        "type": "object", "required": ["ref", "status", "serial"], "additionalProperties": false,
        "properties": {
          "ref": { "type": "string" },
          "status": { "enum": ["not-started", "starting", "running", "done", "stopped", "error"] },
          "serial": { "type": "array", "items": { "type": "object", "required": ["t", "stream", "text"], "additionalProperties": false, "properties": { "t": { "type": "number" }, "stream": { "enum": ["out", "err", "note"] }, "text": { "type": "string" } } } }
        }
      }
    },
    "timeline": { "type": "array", "items": { "type": "object", "required": ["t", "ref", "pin", "state"], "additionalProperties": false, "properties": { "t": { "type": "number" }, "ref": { "type": "string" }, "pin": { "type": "string" }, "state": { "type": "string" } } } },
    "findings": { "type": "array", "items": { "type": "object", "required": ["code", "severity", "message", "parts"], "properties": { "code": { "type": "string" }, "severity": { "enum": ["error", "warning", "note"] }, "message": { "type": "string" }, "parts": { "type": "array", "items": { "type": "string" } } } } },
    "incomplete": { "type": "array", "items": { "type": "object", "required": ["ref", "why"], "additionalProperties": false, "properties": { "ref": { "type": "string" }, "why": { "type": "string" } } } },
    "neverPauses": { "type": "array", "items": { "type": "string" } },
    "lostPower": { "type": "array", "items": { "type": "string" } }
  }
}
```

In `plugin/skills/circuitoon-design/references/cli.md`, add a `run` section: the synopsis, what each flag does, the virtual clock (waits jump, time and pin reads step 10 us, deterministic), the output (Serial, pins, findings), `--json` (`circuitoon-cli/run/1`), the exit codes, and that the first run downloads Python from the Circuitoon site once (or `--py-dir`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/cli/runCmd.test.ts src/cli/cli.test.ts && npm run build:cli`
Expected: PASS (`cli.test.ts` checks the usage text lists every command).

- [ ] **Step 7: Commit**

```bash
git add src/cli/runCmd.ts src/cli/runCmd.test.ts src/cli/args.ts src/cli/main.ts plugin/skills/circuitoon-design/references plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
CLI: circuitoon run (virtual clock, presses, input, Serial, pin timeline, findings, circuitoon-cli/run/1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 40: `gate`: `code-language` and `code-unsupported-import`

**Files:**
- Create: `src/run/unsupported.ts`, `src/cli/codeFindings.ts`, `src/run/unsupported.test.ts`
- Modify: `src/cli/gate.ts`, `src/cli/gate.test.ts` (add), `plugin/skills/circuitoon-design/SKILL.md` ("Reading the gate")

**Interfaces:**
- Consumes: `PY_FILES` (the Python lists), `languageMismatch` (Task 5), `withLibraryData`; `CliFinding` (`verifyCmd.ts`).
- Produces:
  - `src/run/unsupported.ts`: `const UNSUPPORTED_MODULES: Record<string, string>`, `const UNSUPPORTED_GPIOZERO: Record<string, string>` (read from `_circuitoon.py`'s `UNSUPPORTED` and gpiozero's `UNSUPPORTED_NAMES`), `function unsupportedImports(source: string): { name: string; why: string }[]`
  - `src/cli/codeFindings.ts`: `function codeFindings(d: Diagram, library: ModuleLookup): CliFinding[]` (rule `code-language`, an error; rule `code-unsupported-import`, a warning). The gate does not run code; `gate/4`'s format is unchanged.

- [ ] **Step 1: Write the failing tests**

`src/run/unsupported.test.ts`:

```ts
// Firmware spec 5.1 and 7: the gate's static scan finds the same unsupported modules and gpiozero
// names the run-time refuses, read from the Python stand-ins themselves.
import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_GPIOZERO, UNSUPPORTED_MODULES, unsupportedImports } from './unsupported.ts'

describe('unsupported imports (spec 5.1)', () => {
  it('reads the lists from the Python files', () => {
    expect(Object.keys(UNSUPPORTED_MODULES).sort()).toEqual(['lgpio', 'picamera2', 'pigpio', 'serial', 'smbus', 'smbus2', 'spidev'])
    expect(UNSUPPORTED_GPIOZERO.MCP3008).toBe('needs SPI devices, coming in a later update')
  })
  it('finds them in import, from-import and attribute forms, once each', () => {
    const src = 'import smbus2 as bus, time\nfrom spidev import SpiDev\nfrom gpiozero import LED, MCP3008\nimport gpiozero\nx = gpiozero.MCP3202(0)\n# import pigpio (a comment)\n'
    expect(unsupportedImports(src)).toEqual([
      { name: 'smbus2', why: 'smbus2 needs I2C devices, coming in a later update' },
      { name: 'spidev', why: 'spidev needs SPI devices, coming in a later update' },
      { name: 'gpiozero.MCP3008', why: 'gpiozero.MCP3008 needs SPI devices, coming in a later update' },
      { name: 'gpiozero.MCP3202', why: 'gpiozero.MCP3202 needs SPI devices, coming in a later update' },
    ])
    expect(unsupportedImports('from gpiozero import LED\nimport time\n')).toEqual([])
  })
})
```

Append to `src/cli/gate.test.ts` (it already has `tempDir`, `quietIo`, `runGate` and the `beforeEach` that stubs the engine to null, so no solve runs; add the imports `serializeDiagram` from `'../format/diagram.ts'`, `piBlink` from `'../run/sheets.testing.ts'` and `load` from `'../format/builtinModules.testing.ts'`):

```ts
describe('gate: code on boards (firmware spec 7)', () => {
  it('blocks code a board does not accept and warns about unsupported imports, without running the code', async () => {
    const d = piBlink()
    d.parts = d.parts.map((p) => (p.uid === 'u1' ? { ...p, code: { language: 'python-rpi', source: 'import smbus\nfrom gpiozero import LED\n', file: 'main.py' } } : p))
    d.parts.push({ uid: 'u2', designator: 'U2', module: 'arduino-uno-r3', x: 900, y: 0, code: { language: 'python-rpi', source: 'print(1)\n' } })
    d.modules['arduino-uno-r3'] = load('arduino-uno-r3')
    const dir = tempDir()
    const { report } = await runGate(new TextEncoder().encode(serializeDiagram(d)), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(report.blocking.find((f) => f.rule === 'code-language')?.message).toBe("U2 is an Arduino Uno R3; its code is Raspberry Pi Python and won't run.")
    expect(report.warnings.find((f) => f.rule === 'code-unsupported-import')?.message).toBe("U1's code: smbus needs I2C devices, coming in a later update.")
    expect([...report.blocking, ...report.warnings].filter((f) => f.message.includes("won't run"))).toHaveLength(1)
    expect(report.format).toBe('circuitoon-cli/gate/4')
  })
})
```

The Uno's module name in the message is whatever `modules/arduino-uno-r3.json` says (Task 5 read it); use that name in the expected text.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/run/unsupported.test.ts src/cli/gate.test.ts`
Expected: FAIL: `./unsupported.ts` cannot be found.

- [ ] **Step 3: Write `src/run/unsupported.ts`**

```ts
// The modules and gpiozero names the simulator does not have (firmware spec 5.1), read from the Python
// stand-ins themselves (one entry per line in _circuitoon.py's UNSUPPORTED and gpiozero's
// UNSUPPORTED_NAMES), so the gate's static scan and the run-time errors never disagree.
import { PY_FILES } from './pyFiles.ts'

function dict(text: string, name: string): Record<string, string> {
  const body = new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]))
}

export const UNSUPPORTED_MODULES = dict(PY_FILES['_circuitoon.py'], 'UNSUPPORTED')
export const UNSUPPORTED_GPIOZERO = dict(PY_FILES['gpiozero/__init__.py'], 'UNSUPPORTED_NAMES')

/** What a script uses that the simulator does not have, in the order found, each once. Comments are skipped. */
export function unsupportedImports(source: string): { name: string; why: string }[] {
  const found = new Map<string, string>()
  const gz = (name: string) => name in UNSUPPORTED_GPIOZERO && found.set(`gpiozero.${name}`, `gpiozero.${name} ${UNSUPPORTED_GPIOZERO[name]}`)
  const code = source.replace(/#[^\n]*/g, '')
  for (const m of code.matchAll(/^[ \t]*(?:import[ \t]+([\w., \t]+)|from[ \t]+([\w.]+)[ \t]+import[ \t]+(?:\(([\w., \t\n]+)\)|([\w., \t]+)))/gm)) {
    const mods = m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) : [m[2]]
    for (const mod of mods) {
      const root = mod.split('.')[0]
      if (root in UNSUPPORTED_MODULES) found.set(root, UNSUPPORTED_MODULES[root])
    }
    if (m[2] === 'gpiozero') for (const n of (m[3] ?? m[4]).split(',')) gz(n.trim().split(/\s+as\s+/)[0])
  }
  for (const m of code.matchAll(/\bgpiozero\.(\w+)/g)) gz(m[1])
  return [...found].map(([name, why]) => ({ name, why }))
}
```

- [ ] **Step 4: The findings and the gate**

`src/cli/codeFindings.ts`:

```ts
// The gate's code checks (firmware spec 7): code a board does not accept is an error (`code-language`);
// a module or gpiozero name the simulator does not have is a warning (`code-unsupported-import`), from
// a static scan. The gate never runs code.
import type { Diagram } from '../format/diagram.ts'
import { languageMismatch } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import type { ModuleLookup } from '../agent/netlist.ts'
import { unsupportedImports } from '../run/unsupported.ts'
import type { CliFinding } from './verifyCmd.ts'

export function codeFindings(d: Diagram, library: ModuleLookup): CliFinding[] {
  const out: CliFinding[] = []
  for (const p of d.parts) {
    if (!p.code) continue
    const stored = d.modules[p.module]
    const m = stored && withLibraryData(stored, library)
    const lang = p.code.language
    const mismatch = m ? languageMismatch(p.designator, m, lang) : null
    if (mismatch) out.push({ id: `code-language|${p.uid}`, rule: 'code-language', severity: 'error', parts: [p.uid], pins: [], wires: [], message: `${mismatch}.` })
    if (lang === 'python-rpi')
      for (const u of unsupportedImports(p.code.source))
        out.push({ id: `code-unsupported-import|${p.uid}|${u.name}`, rule: 'code-unsupported-import', severity: 'warning', parts: [p.uid], pins: [], wires: [], message: `${p.designator}'s code: ${u.why}.` })
  }
  return out
}
```

In `src/cli/gate.ts`, after `found.push(...checked.map(cliFinding))`, add `found.push(...codeFindings(d, libraryLookup))` (import it). The loader's warning for the same mismatch ("... and won't run", Task 5) would report it a second time, so line 204 skips it: `v.warnings.forEach((w, i) => w.endsWith("won't run") || note('load', String(i), w.includes(VALUE_DROPPED) || w.includes(MISSING_MODULE) ? 'error' : 'warning', w))`. In `plugin/skills/circuitoon-design/SKILL.md`, "Reading the gate" gains: `code-language` (error: the board cannot run that language; move the code to a board that can, or remove it) and `code-unsupported-import` (warning: the script uses a module the simulator does not have yet; `circuitoon run` will stop at that import).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run/unsupported.test.ts src/cli/gate.test.ts && npm run build:cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/run/unsupported.ts src/run/unsupported.test.ts src/cli/codeFindings.ts src/cli/gate.ts src/cli/gate.test.ts plugin/skills/circuitoon-design/SKILL.md plugin/dist-cli/circuitoon.mjs
git commit -m "$(cat <<'MSG'
Gate: code-language (error) and code-unsupported-import (warning, a static scan from the Python stand-ins' own lists)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 41: The Raspberry Pi samples, the README and the PRD

**Files:**
- Create: `src/samples/piSamples.ts`, `src/samples/piSamples.test.ts`
- Modify: `src/editor/StartScreen.tsx` (the samples row, ruling R13), `src/styles.css` (its cards), `README.md`, `docs/PRD.md`

**Interfaces:**
- Consumes: `modulesById` (`src/library.ts`), `Sheet`; `drive` (Task 30) for the test.
- Produces: `const piBlinkSample: Diagram` ("Blink on a Raspberry Pi") and `const piButtonSample: Diagram` ("Button lights an LED on a Pi"), each with a `box` for its preview: `PI_SAMPLES: { diagram: Diagram; box: { x: number; y: number; w: number; h: number }; blurb: string }[]`

- [ ] **Step 1: Write the failing test**

`src/samples/piSamples.test.ts`:

```ts
// Firmware spec 8: two Raspberry Pi samples in the start screen. Each loads cleanly, its code runs on
// the virtual clock, and it does what its title says.
import { afterAll, describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { drive } from '../run/driver.ts'
import { nodePy } from '../run/testing.ts'
import { PI_SAMPLES, piBlinkSample, piButtonSample } from './piSamples.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

describe('Raspberry Pi samples (spec 8)', () => {
  it('load with no warnings', () => {
    for (const s of PI_SAMPLES) {
      const r = validateDiagram(JSON.parse(JSON.stringify(s.diagram)), { library: libraryLookup })
      expect(r.ok && r.warnings, s.diagram.title).toEqual([])
    }
    expect(PI_SAMPLES.map((s) => s.diagram.title)).toEqual(['Blink on a Raspberry Pi', 'Button lights an LED on a Pi'])
  })
  it('blink blinks GPIO17', async () => {
    const r = await drive({ diagram: piBlinkSample, boards: ['p2'], forMs: 2500, inputs: [], presses: [], engine, py: nodePy() })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => e.state)).toEqual(['high', 'low', 'high'])
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([])
  }, 120_000)
  it('the button lights the LED through when_pressed', async () => {
    const r = await drive({ diagram: piButtonSample, boards: ['p2'], forMs: 3000, inputs: [], presses: [{ uid: 'p5', atMs: 1000, forMs: 500 }], engine, py: nodePy() })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => [Math.round(e.t / 100) / 10, e.state])).toEqual([[0, 'low'], [1, 'high'], [1.5, 'low']])
  }, 120_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/samples/piSamples.test.ts`
Expected: FAIL, `./piSamples.ts` cannot be found.

- [ ] **Step 3: Write `src/samples/piSamples.ts`**

```ts
// The Raspberry Pi samples (firmware spec 8) for the start screen: a USB wall charger feeds the Pi 4's
// header 5V; an LED on GPIO17 through 330 ohm; the second adds a push button on GPIO27 to ground,
// read with the internal pull-up. Each carries its code, so Run works at once.
import { type Diagram, DIAGRAM_FORMAT } from '../format/diagram.ts'
import { modulesById } from '../library.ts'

const embed = (ids: string[]) => Object.fromEntries(ids.filter((id) => modulesById[id]).map((id) => [id, modulesById[id]]))
const w = (uid: string, a: string, ap: string, b: string, bp: string, color: string) => ({ uid, from: { part: a, pin: ap }, to: { part: b, pin: bp }, color, colorSet: true as const, gauge: 22 })

const BLINK = `from gpiozero import LED
from signal import pause

led = LED(17)
led.blink()
pause()
`
const BUTTON = `from gpiozero import LED, Button
from signal import pause

led = LED(17)
button = Button(27)

button.when_pressed = led.on
button.when_released = led.off
pause()
`
const base = (title: string, source: string, file: string, extra: Diagram['parts'], wires: Diagram['connections']): Diagram => ({
  format: DIAGRAM_FORMAT,
  title,
  modules: embed(['charger-usb-5v-us', 'rpi-4-model-b', 'resistor', 'led', 'push-button']),
  parts: [
    { uid: 'p1', designator: 'PS1', module: 'charger-usb-5v-us', x: 20, y: 140 },
    { uid: 'p2', designator: 'U1', module: 'rpi-4-model-b', x: 120, y: 20, code: { language: 'python-rpi', source, file } },
    { uid: 'p3', designator: 'R1', module: 'resistor', x: 520, y: 40, values: { resistance: { value: 330, unit: 'ohm' } } },
    { uid: 'p4', designator: 'D1', module: 'led', x: 620, y: 40, values: { color: 'red' } },
    ...extra,
  ],
  connections: [
    w('w1', 'p1', '5V', 'p2', '5V', 'red'), w('w2', 'p1', 'GND', 'p2', 'GND', 'black'),
    w('w3', 'p2', 'GPIO17', 'p3', '1', 'yellow'), w('w4', 'p3', '2', 'p4', 'A', '#F48C06'), w('w5', 'p4', 'K', 'p2', 'GND 2', 'black'),
    ...wires,
  ],
})

export const piBlinkSample = base('Blink on a Raspberry Pi', BLINK, 'blink.py', [], [])
export const piButtonSample = base('Button lights an LED on a Pi', BUTTON, 'button.py', [{ uid: 'p5', designator: 'S1', module: 'push-button', x: 540, y: 160 }], [w('w6', 'p2', 'GPIO27', 'p5', '1', 'blue'), w('w7', 'p5', '2', 'p2', 'GND 3', 'black')])

export const PI_SAMPLES = [
  { diagram: piBlinkSample, box: { x: 0, y: 0, w: 700, h: 260 }, blurb: 'A Pi 4 blinks an LED with gpiozero. Press Run.' },
  { diagram: piButtonSample, box: { x: 0, y: 0, w: 700, h: 260 }, blurb: 'A button on GPIO27 lights the LED while it is held.' },
]
```

Check the charger's pin names first (`node -p "require('./modules/charger-usb-5v-us.json').pins.map(p=>p.name)"`: `5V` and `GND`), and the boxes against the drawn sheets in Step 5's screenshots.

- [ ] **Step 4: The start screen row**

In `src/editor/StartScreen.tsx`, import `PI_SAMPLES` and, after the `start-options` div, add:

```tsx
        <section className="start-samples" aria-labelledby="pi-samples">
          <h2 id="pi-samples">Raspberry Pi samples</h2>
          <div className="start-samples-row">
            {PI_SAMPLES.map((s) => (
              <button key={s.diagram.title} type="button" className="start-card sample small" onClick={() => onOpen(structuredClone(s.diagram))}>
                <Sheet diagram={s.diagram} box={s.box} label={`${s.diagram.title} preview`} decorative />
                <strong>{s.diagram.title}</strong>
                <span>{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>
```

and in `src/styles.css`, next to the `.start-card` rules: `.start-samples { display: grid; gap: 10px; } .start-samples h2 { font-size: 22px; } .start-samples-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; } .start-card.small strong { font-size: 17px; }`.

- [ ] **Step 5: Look at it**

Run: `npm run build && npm run check:theme-ui -- --out .superpowers/samples-ui` and open the start-screen screenshots (light and dark), then open each sample, press Run, and take a screenshot of each running in both themes with `npm run check:code-ui` (add two cases at the end of its scheme loop: click the sample card from the start screen, Run, wait for "Running", `shot('sample-blink')` and `shot('sample-button')`). Look at every screenshot: the cards line up under the three start cards, the previews show the whole sheet, the samples run.

- [ ] **Step 6: The README and the PRD**

`README.md`: a "Code on boards" part under "The editor": select a Raspberry Pi 4, Pi 5 or Zero 2 W, upload or write a Python script using RPi.GPIO or gpiozero, press Run; what runs (digital in and out, pulls, edge callbacks, PWM, servos, print and input); the limits in plain words (no threads, callbacks do not run at the same time, no I2C or SPI devices yet, a read can lag the circuit by one solve, RPi.GPIO does not work on a real Pi 5); Python downloads once (about the measured size); agents use `circuitoon run`. Under "For AI agents > Commands", the `run` line. `docs/PRD.md`: a Changelog entry "### Code on boards, slice 1 (plugin 0.11.0)" with four or five bullets (the code key, Pyodide in a sandboxed worker, PWM solves, the dock, `circuitoon run`), and the roadmap's later slices (Arduino on Uno and Nano, MicroPython on Pico, I2C and SPI devices, ESP32-C3 and S3).

Run: `node -e "const fs=require('fs');for(const f of ['README.md','docs/PRD.md'])if(/[\u2013\u2014]/.test(fs.readFileSync(f,'utf8')))console.log(f)"`
Expected: no output.

- [ ] **Step 7: Run the tests and commit**

Run: `npx vitest run src/samples`
Expected: PASS.

```bash
git add src/samples/piSamples.ts src/samples/piSamples.test.ts src/editor/StartScreen.tsx src/styles.css scripts/check-code-ui.mjs README.md docs/PRD.md
git commit -m "$(cat <<'MSG'
Samples: Blink on a Raspberry Pi, Button lights an LED on a Pi; README and PRD for code on boards

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 42: Plugin 0.11.0, the skill, the CLI bundle and its budget

**Files:**
- Modify: `package.json`, `package-lock.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (every `0.10.0`), `plugin/skills/circuitoon-design/SKILL.md`, `src/cli/bundle.test.ts` (add)
- Regenerate: `plugin/dist-cli/circuitoon.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: plugin 0.11.0 (spec 7); a CLI bundle that runs `circuitoon run --for 5s` on the Pi blink sample from a copy of the plugin folder within 4 s of wall time with Python already cached (spec 9); the skill step.

- [ ] **Step 1: Write the failing bundle test**

Append to `src/cli/bundle.test.ts` (it already copies `plugin/bin` and `plugin/dist-cli` into a temp folder for `sim`; reuse that setup; import `serializeDiagram` and `piBlinkSample`):

```ts
  it('runs blink for 5 s from a copy of the plugin folder within 4 s, Python cached (spec 9)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    writeFileSync(join(dir, 'blink.json'), serializeDiagram(piBlinkSample))
    const args = [join(dir, 'bin', 'circuitoon.mjs'), 'run', 'blink.json', '--for', '5s', '--py-dir', resolve('node_modules/pyodide'), '--json']
    spawnSync(process.execPath, args, { encoding: 'utf8', cwd: dir }) // warm the OS file cache once
    const t0 = performance.now()
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: dir })
    const ms = performance.now() - t0
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ format: 'circuitoon-cli/run/1', simulatedSeconds: 5 })
    expect(ms).toBeLessThanOrEqual(4000)
  }, 120_000)
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/cli/bundle.test.ts`
Expected: FAIL: the committed bundle predates `run` (`unknown command "run"`, exit 2), unless an earlier task's `build:cli` already rebuilt it; then it fails only on the version check below.

- [ ] **Step 3: Version, skill, bundle**

Run: `grep -rn "0\.10\.0" package.json package-lock.json plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md`
Change each hit to `0.11.0` (in `package-lock.json`, the two top-level `version` fields only).

In `plugin/skills/circuitoon-design/SKILL.md`, in the workflow after the Simulate step, add: "**Run the code.** When the sheet has a Raspberry Pi with code (`code` on its part, or `{ "language": "python-rpi", "path": "main.py" }` in the netlist), run `circuitoon run <sheet> --for 5s` (add `--press S1@1s` for the buttons the code reads, `--input` for its `input()` lines) and read its Serial, pin timeline and findings before handing the sheet over. Exit 1 means the code failed, a blocking finding, lost power, or a loop that never pauses: fix it first. The first run downloads Python from the Circuitoon site once." Also list the limits (no threads, no I2C or SPI devices yet, RPi.GPIO not on a real Pi 5).

Run: `npm run build:cli && npm run check:gen`
Expected: the bundle rewritten; every generator matching.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run validate && npm run check:gen && npm run build`
Expected: all PASS (`src/cli/plugin.test.ts` checks plugin, marketplace and package agree on 0.11.0 and nothing shipped has an em dash).

Run: `node -e "const fs=require('fs'),path=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);for(const f of ['README.md','docs/PRD.md','index.html',...walk('plugin/skills'),...walk('src/run'),...walk('src/editor'),...walk('src/format'),...walk('src/cli'),...walk('scripts').filter((x)=>!x.includes('sim-data'))])if(/[\u2013\u2014]/.test(fs.readFileSync(f,'utf8')))console.log(f)"`
Expected: no output (no em or en dashes anywhere, the Python stand-ins included).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json plugin .claude-plugin src/cli/bundle.test.ts
git commit -m "$(cat <<'MSG'
Plugin 0.11.0: circuitoon run in the CLI bundle (5 s blink within 4 s), the design skill runs board code before handing over

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: whole branch, then ship (spec 11)

1. A whole-branch Claude review (Astra after 2026-10-10, `consult-astra`), against the spec and this plan's rulings; every finding fixed as a numbered fix task.
2. Ship gates, on a quiet machine: `npm test` (the timing files included), `npm run validate`, `npm run check:gen`, `npm run build`, `npm run check:code-ui`, `npm run check:isolation-ui`, `npm run check:sim-ui -- --sw`; every screenshot looked at.
3. Ship with the `circuitoon-ship` skill. Live verification on https://mbarc.github.io/circuitoon/ in a fresh browser profile: the page is cross-origin isolated after one reload; both Raspberry Pi samples Run and respond (the LED blinks; the button lights it); the first Run's transfer, read from the network panel with the cache disabled, is at most 8 MB (ruling R15's re-measure, now on the real `py/<version>/` files; record it); `py/<version>/py.json` is served; `circuitoon run` from the published plugin downloads Python from the live site once and runs the blink sample.
4. Record the outcome, the measured budgets and the version in the ledger and the vault.

---

## Self-review

Checked against the spec with fresh eyes after writing.

**1. Spec coverage**

| Spec | Task |
|---|---|
| 1 Goal; the in and out of scope lists (no I2C/SPI, no pyserial, no threads, Pi USB-A ports not simulated) | 6 (USB-A), 13 (threads, unsupported modules), 30, 39 (agents), 41 |
| 2.1 One worker per board, the 2-or-4 cap, Run past the cap, live sheet, delete or module change stops, code edit does not, Run turns Simulate on, Simulate off stops all, "starting" then refuse unpowered | 11 (cap), 17, 31 (drag exemption), 32, 34 |
| 2.2 One SharedArrayBuffer, two seqlocked tables, every field listed (mode, latch, PWM descriptor, wrapping counters, code sequence; level, edges, voltage and status, solved-through, wake word, interrupt buffer, input line) | 12, 13 |
| 2.3 One shared sampler, solve or 16 ms (ruling R25), the run pin state table, the 100 ms window at 50 Hz, 1/64 quantisation, `store.run` only on change, no frequency in the key, servo `moving`, run pin states transient | 21, 29, 31, 32 |
| 2.4 SimSession running mode and its 3-tick test | 25, 31 |
| 2.5 coi-serviceworker 0.1.7 (require-corp, quiet, guarded reload, head placement, reload once, hash survives), Vite headers, self-hosted fonts, kill switch, Run disabled without service workers, re-check every feature under isolation | 1, 2, 3, 37 (`--sw` regression) |
| 2.6 CSP without `'unsafe-eval'`, curated `jsglobals`, `registerJsModule` only, the prototype backstop, the first-Run link confirmation | 2 (CSP header), 11 (checked), 17 (sandbox, jsglobals), 34 (confirmation), 37 (built-site sandbox check) |
| 2.7 Pinned Pyodide, core and stdlib only, `dist/py/<version>/` with `py.json`, streamed hash-checked prefetch, `lockFileContents`, older versions carried forward, the "no longer published" message, the CLI download and cache, `--py-dir`, licences and NOTICE, the loader its own chunk, main bundle +20 KB | 10, 11, 19, 32, 37, 39 |
| 3.1 The `code` key: types, 256 KB of UTF-8, file name rules, drop and keep rules, unknown keys, board language warning, format unchanged, links, undoable with coalescing | 4, 5, 31 |
| 3.2 `firmware` languages, known ids (ruling R2), `withLibraryData` and its callers, `languagesOf` empty for custom parts, the part check's message | 5 |
| 3.3 Pi power and GPIO data with provenance and two reviewers; fixed GPIO2/3 pull-ups as their own role (build test); thresholds; RP1 estimates flagged; USB-A ports stay unsimulated (test) | 6, 8 |
| 3.4 Servo data (pulse range flagged, slew from the datasheet, input load, idle and moving current), the angle map, out-of-range signals, the 47 degree note | 7, 9, 27, 36 (About) |
| 4.1 `BuildOptions.runPins`, the state table, `followStore` identity with `runPins`, the cached netlist key | 22, 31 |
| 4.2 `pwm` state, `Analysis.pins`, `gpioBranch` from `pins`, classification driven at both levels, one text per run in one `runAll`, groups, weights (ruling R1, a defect fixed), superposition and its test against exact, what uses the average and what the union, worst reading kept, LED at 50 % still blocks, peak all-high and all-low, stopping on the average | 22, 23, 24, 28 |
| 4.3 Budgets for run-state solves (50 ms, 200 ms) | 26 (PWM checkpoint), 37 (in the browser) |
| 4.4 Outputs read their latch; thresholds, hysteresis, the 100 ms dwell warning, floating random reads and their warning, editor-side edge counters, reads after setup wait for their solve (200 ms), the one-solve lag | 13 (`read`), 17 (200 ms test), 18 (virtual), 20, 29 |
| 4.5 Refuse unpowered at the start, lost power on the duty-weighted average, the 4.63 V note | 28, 29, 30, 32 |
| 5.1 Every `RPi.GPIO` call and constant, BOARD map, the Pi 5 warning; the gpiozero subset with its callbacks; declared PWM; pin name forms; the JS module; unsupported names and modules in plain words | 13, 14, 15, 16 |
| 5.2 The Python scheduler, 50 ms waits with `checkInterrupt`, yield points, non-reentrancy, the run clock, never-pauses after 2 s (ruling R28), threads refused | 13, 17, 18, 32 |
| 5.3 Serial batched per sample, stderr in the error colour, 5,000 lines, our `input()` and `setStdin`, tracebacks with file and line links, status "error" | 13, 17, 31, 33, 34 |
| 5.4 Stop (KeyboardInterrupt, finally runs, terminate after 1 s), Reset in a fresh worker | 17, 32 |
| 6.1 The dock: resize (remembered), 28 px bar, tabs with status dots and text, CodeMirror lazy, the toolbar, Serial on the right, hidden until Code is used, Run all and Stop all | 33, 34 |
| 6.2 The Inspector's Code section and the upload refusals | 33 (`readCodeFile`), 35 |
| 6.3 Running and error badges, the servo horn with reduced motion, "avg" probe tags, run-time findings in the groups | 36 |
| 6.4 Skip link, Ctrl+`, tablist and text equivalents, Escape then Tab, the throttled live region | 33, 34 |
| 7 Netlist `code` (confined paths, round trips), `circuitoon run` (virtual clock, quantum, horizon, presses, inputs, output, `--json`, never-yields after 5 s, exit codes), the gate's two checks, the skill, plugin 0.11.0 | 30, 38, 39, 40, 42 |
| 8 Samples in the start screen, README, About the simulator | 36, 41 |
| 9 Budgets | 11 (transfer, heap, cap), 26 (solves), 37 (cold and warm start, glow latency, bundles, memory), 42 (CLI 4 s) |
| 10 Testing list | unit: 4, 5, 12, 20, 21, 23, 24, 25, 27, 28; Python against real Pyodide: 13 to 18; integration on the virtual clock: 30, 39, 41; sim data: 8, 9; browser: 3, 34 to 37 |
| 11 Delivery order and checkpoints | Phases A to F follow steps 1 to 6; checkpoints after Task 3 (ship step 1 alone), Task 11 (Pyodide), Task 19 (protocol and scheduler review), Task 26 (PWM), Task 42 (whole branch, ship) |

No spec requirement is without a task.

**2. Placeholder scan.** No "TBD", "TODO" or "implement later". Three values are deliberately produced by earlier tasks rather than written here, each with its producer named: the Pi and servo numbers (Tasks 8 and 9, researched and checked by two reviewers under the Sourcing protocol), the Pyodide checkpoint's measurements in `src/run/limits.ts` (Task 11, with pass criteria and what to do on each failure), and the 4.63 V source URL in `src/run/power.ts` (verified in Task 8). Two steps tell the implementer to confirm a fact before coding against it, with the expected answer given: gpiozero 2.0.1's input-device aliases (Task 15 Step 1) and the Uno's module name in two expected messages (Tasks 5 and 40).

**3. Type consistency.** Checked across tasks: `RunPinState` and `RunPins` (Task 20) are what `BuildOptions.runPins` (22), `BoardSampler` (21), `RunCore` (29), the driver (30) and the store (31) use; `PinIn` and `PinOut` (12) match `makeHw` (13), `LevelTracker` (20) and `writeIn` callers (29); `FromCode` (13) carries `block` (18), `prompt` (13) and `out` as `BoardRun` (17), the driver (30) and the controller (32) read them; `circuitoon_hw` has `pending` (13) for ruling R28, used by `_circuitoon` and checked by the controller through `H.pending` (32); `SolveOptions.runSeq` (25) flows through `startSession` (31) into `SimView.runSeq` and `RunCore.apply` (29, 32); `SimResult.pwm` (24) drives the "avg" tags (36); `NEVER_PAUSES` lives in `core.ts` (29) so the browser chunk never imports the Node driver; `PartCode` (4) is what `checkCode`, `setPartCode` (31), `readCodeFile` (33), `IntentPart.code` (38) and the samples (41) use; `tabStatus` (34) is shared by the dock and the Inspector (35).
