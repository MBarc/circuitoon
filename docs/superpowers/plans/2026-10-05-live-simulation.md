# Live DC Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on Simulate and the sheet is solved as a DC circuit in its saved switch and GPIO state by our own ngspice 45.2 WASM build, with LED glow, `sim-*` findings, saved probes, `circuitoon sim` and `gate/4`.

**Architecture:** A pure pipeline `diagram + library -> build.ts (Circuit) -> floating.ts (classification) -> spice.ts (text + name map) -> Engine (ngspice in a terminable worker) -> results.ts / findings.ts (SimResult)`, driven by one revision-checked `session.ts` that the editor and the CLI share. The engine is our own Emscripten build of ngspice as a shared library, driven through its exported C API inside a Web Worker (browser) or a `worker_threads` Worker (Node). The checker is untouched; simulation findings live in their own group and their own codes.

**Tech Stack:** ngspice 45.2 (shared library, XSPICE) built with emsdk 6.0.11 in Docker; TypeScript (erasable syntax only); React 19; Vite 8; vitest 5; Node `worker_threads`; Web Workers; playwright-core for the visual checks.

**Spec:** `docs/superpowers/specs/2026-10-05-live-simulation-design.md` (revision 4). Read it fully before any task. The engine spike report is `C:/Users/micha/Desktop/projects/Circuitoon-spice/.superpowers/spice-spike-report.md`; its throwaway code is under `C:/Users/micha/Desktop/projects/Circuitoon-spice/spike/` (`engines/ee.mjs`, `circuits.mjs`).

## Global Constraints

Copied verbatim from the spec. Every task's requirements include this section.

- "**We build our own WASM from pinned source in this slice.**" (2.2)
- "the pinned ngspice release (45.2) tarball URL and its SHA-256; our patches as `.patch` files; the exact emsdk version." (2.2)
- "We configure `--with-ngshared --enable-xspice --disable-osdi`" (2.2)
- "Exported: `ngSpice_Init`, `ngSpice_Command`, `ngGet_Vec_Info`, `ngSpice_CurPlot`, `ngSpice_AllVecs` and `ngSpice_SetBkpt`, plus `addFunction` for the callbacks (`GetVSRCData` later)." (2.2)
- "Commands run synchronously (`ngSpice_Command("op")`, never `bg_run`), so there are no threads, no SharedArrayBuffer and no COOP/COEP headers." (2.2)
- "Vectors are read through `ngGet_Vec_Info`, never by parsing stdout." (2.2)
- "There are no PDK models." (2.2)
- "The loader fetches a separate `ngspice.wasm` by URL in the browser and reads it from disk in Node." (2.2)
- "**Fallback if the shared build cannot be made to work** at the engine checkpoint: the executable build (`--disable-xspice`, as in eecircuit), and the rebuild is recorded as accepted debt in the ledger. It is decided at the checkpoint, not later." (2.2)
- "The output is committed to `public/sim/` and `plugin/dist-cli/`. `npm run engine:build` rebuilds it in Docker and runs the engine smoke tests." (2.2)
- "**The JS wrapper** is our own small adapter over the exported C API. It does not depend on eecircuit-engine at run time." (2.2)
- "**Each engine version is published as a GitHub release asset** on MBarc/circuitoon." (2.2)
- "The `.wasm` stays a separate, replaceable file." (2.2)
- "**It always runs inside a terminable worker**: a Web Worker in the browser, a `worker_threads` Worker in Node. A timeout terminates the worker; nothing synchronous runs on a thread that has to be interrupted." (2)
- "The interface is `Engine { init(); run(c, analysis, revision): Promise<RunOutcome>; dispose() }`." (2)
- "It never emits R = 0." (2, spice.ts)
- "Element names are sanitised (`R_p12`), and nets are renamed `n1..nN` so that user names never reach the SPICE parser." (2)
- "The same circuit always gives byte-identical text: devices are sorted by part uid, then by terminal." (2)
- "Every request carries the diagram **revision**. A result for an older revision, or one that arrives after Simulate was turned off, is discarded." (2)
- "There is at most one solve in flight and one pending; a newer edit replaces the pending one." (2)
- "Each solve runs the typical and peak corners (section 4.5): 2 engine runs." (2)
- "The checker (`src/format/checks.ts`) is unchanged, and **it never suppresses or is suppressed by simulation**." (2.1)
- "`circuitoon sim` reports simulation findings only. `gate` reports both (section 7)." (2.1)
- "Mains nodes never enter the solver (mains spec section 3)." (2.1)
- "**Since revision 2, nothing that exists changes.**" (3.1)
- "**Provenance is per value, never per part.**" (3.1)
- "**Recycling:** the worker is recycled after 2,000 **engine runs** (not solves), and after any failure, always between runs." (2.3)
- "**Timeouts:** 5 s per run. On a timeout the worker is terminated and recreated, and the run is retried once. A second timeout gives `status: 'failed'`." (2.3)
- "**Failures:** an `op` with no data vector is a failure, with `getError()` text kept as `raw`." (2.3)
- "Floating nodes are never reported as a voltage." (2)
- "A finding blocks `gate` only if its severity is `error`, it is at the typical corner, and its `basis` is `topology`, `user` or `datasheet`." (5.2)
- "Messages are plain words ... There is no SPICE vocabulary; `raw` keeps the engine's text for a details disclosure." (5.2)
- "**Never saved:** glow and readings. Probes and GPIO states are saved." (6.1)
- "Readings are text, not colour alone." (6.4) "Reduced motion is respected" (6.4)
- Budgets (8): "Engine download (gzip) ≤ 2.5 MB, fetched only on the first Simulate"; "Cold start in the browser ≤ 1.5 s on the dev machine, with progress shown"; "One solve (2 runs), 200 parts, Worker end to end p95 ≤ 30 ms"; "Worker heap after 2,000 runs (one recycle period) ≤ 64 MB above baseline"; "Editor main bundle at most +30 KB gzip (the engine is never in it)"; "CLI `sim` on the Spirit Typewriter sheet, cold ≤ 2 s".
- "**Visual:** Playwright with our own Chrome, never the Playwright MCP." (9)
- "**The plugin version** goes to 0.10.0." (7)

### Repo and writing rules (from the controller; they apply to every task too)

- Work only in `C:/Users/micha/Desktop/projects/Circuitoon-sim` on branch `sim` (a git worktree). Always `cd` there. Never switch branches. Never use `git stash`.
- No em dashes or en dashes anywhere: code, comments, docs, UI text, commit messages. Use hyphens.
- Erasable TypeScript only (`erasableSyntaxOnly` is on): no enums, no namespaces, no constructor parameter properties. Node runs `src/` files directly (`npm run validate`, the Node engine worker).
- Tests are vitest: `npx vitest run <file>`. `npm test` is the full suite; `npm run validate` and `npm run build` must pass at the end of every task that touches `src/` or `modules/`.
- The CLI bundle is committed, and the suite's check-gen test compares it with the source. Every task that changes `src/` or `modules/` runs `npm run build:cli` before committing and adds `plugin/dist-cli/circuitoon.mjs` to that task's `git add`.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Research subagents never put Michael's email or any personal data in a User-Agent or any request field.

## Rulings on spec ambiguities

The plan rules on these so no task has to. Each is referenced where it applies.

| # | Ambiguity | Ruling |
|---|---|---|
| R1 | Where sourced `electrical.sim` data lives, given most modules are generated (`scripts/gen-*.mjs`, `npm run check:gen`) and some are hand written | One JSON patch per module in `scripts/sim-data/<id>.json`. `scripts/lib/gen-output.mjs` `emit()` merges the patch's `sim` into any `modules/<id>.json` it writes or compares, and a new `scripts/gen-sim.mjs` applies every patch to the module on disk (covers hand-written modules). One source of truth, and `check:gen` keeps both in step. |
| R2 | Switch modules without `electrical.contacts` (push buttons, tactile switches, tilt switches) | They get one implicit group `s` with `{ com: terminals.a, no: terminals.b }`. A group is momentary when the module has `params.normallyOpen` (the push-button convention). |
| R3 | "a part's existing opaque visual state" for legacy switches | `values.state` (a string): `on`, `closed`, `pressed` mean closed; `off`, `open`, `released` mean open; anything else keeps the default with a load warning. Nothing writes it today. |
| R4 | `contact.<groupId>` on relays and SSRs | Accepted only on groups of kind `switch`. Relays and SSRs are always at rest (spec 4 table); a stored value on one is dropped with a warning. |
| R5 | Node references for an external source whose port has no ground pin (`computer-usb-port` has only `USB`) | Node references accept `<usbPin>#gnd` as well as `<usbPin>#vbus`. `#gnd` is joined to `sim.usbPorts[pin].gnd` when declared, else it is its own node. |
| R6 | Probe `ref` in netlists (spec 6.2 example) when differential probes were cut (section 14) | `ref` is parsed, validated (`net:<existing net>`) and round-tripped, but not used for readings; `circuitoon sim` prints a note for each probe that has one. |
| R7 | A USB device whose host part has no power data | Treated like a hub: its USB power path is not simulated, and the device is listed in `unsimulated` ("powered from <host> over USB, which has no power data"). The device's other power paths still solve. |
| R8 | "the existing label placement" for probe tags | `LabelPlacer` from `src/agent/labelling.ts`, with the `net-label` module and the tag text as the flag name, so tags keep off parts, captions and each other exactly as net labels do. |
| R9 | "the About dialog" (none exists in the app) | An "About the simulator" disclosure at the foot of the Probes panel lists the licences and links `sim/NOTICE.txt` and the engine's GitHub release. |
| R10 | Where the checker group's new heading shows | Only while Simulate is on: the checker group is titled "Wiring checks (any switch position, external power assumed)" and a second group "Simulation (current state)" follows. With Simulate off the panel is unchanged ("Problems"). |
| R11 | spinit and XSPICE code models in a WASM shared library (code models load with dlopen) | `ngSpice_nospinit` is exported too and called before `ngSpice_Init`; XSPICE core is built, but its code-model tools (`cmpp`, `icm`, `verilog`, `vhdl`) are left out by patch. No PDK models. |
| R12 | Where the LED's per-colour data lives | `src/sim/ledModels.ts` (code, with a source per colour). `led.json` keeps no colour data. The `current` limit is `sim.limits` if present, else the legacy `params.maxCurrent` (`representative`); the `absMaxCurrent` comes from the per-colour table. |
| R13 | Provenance of `electrical.params` values (voltage, resistance, forwardVoltage) | They count as `user`: they are the part's stated, user-editable values (a 4xAA holder is 6 V because the sheet says so). Only `sim` values carry their own provenance; `params.maxCurrent` is the spec's `representative` exception. |
| R14 | Which parameters a finding's `inputs` and `basis` cover | The parameters of the parts the finding names: the load's draw and `minVolts` for a brownout; the rail's `vout`, `dropout` and its output domain's draws for a dropout; the limit and nothing else for a limit finding. The upstream chain is not an input. |
| R15 | Gate banners | The spec's matrix wins: `GATE FAILED` replaces `GATE BLOCKED`; `GATE PASSED, with warnings` when warnings remain; the two simulation `GATE INCOMPLETE` banners are added. |
| R16 | "Playwright with our own Chrome ... over CDP" | The repo's `scripts/lib/browser-check.mjs` `launchChrome()`: playwright-core launching its own headless Chrome (over the CDP pipe). Never the Playwright MCP, never the shared debugging ports 9333 or 9335. |
| R17 | Multi-input rails | A rail has an internal input node. A `diode` input joins it through an OR diode (Schottky, `estimate`: 0.35 V at 100 mA); a `direct` input through 1 milliohm. |
| R18 | Modelling constants the spec leaves open | Smoothing k = 5 mV (volts) and 0.005 (dimensionless); `iq` folds back with a 1 V knee; a `switch` rail's `vf` diode is fitted at 100 mA; a body diode is silicon (IS 1e-12, N 1); an LED is "lit" above 0.1 mA. All are labelled modelling choices in code comments. |
| R19 | Per-pin currents | Every part pin that carries a device sits behind its own 0 V sense source, so each pin's current (positive into the pin) is read from the engine, whatever the device. |
| R20 | `ioTotalCurrent` | The sum of the current magnitudes through the part's GPIO pins that are `high` or `low`. |
| R21 | Potentiometer `values.position` | A plain number from 0 to 1 (default 0.5). No inspector control in this slice. |
| R22 | How the Node worker finds its code and the engine in the single-chunk CLI bundle | The worker re-runs its own module file (`new Worker(fileURLToPath(import.meta.url), { workerData })`): the bundle in the plugin, the `.ts` file under vitest. `ngspice.mjs` and `ngspice.wasm` sit beside the bundle (`plugin/dist-cli/`) or in `public/sim/` for source runs, and are loaded at run time. |
| R23 | The Spirit Typewriter fixture | A new netlist per spec section 1 (`src/sim/fixtures/spirit-typewriter.netlist.json`), not the plugin example (which has a DevKitC and one cell). |
| R24 | Bad simulation values in a sheet | A malformed `sim.*` override is dropped with the `VALUE_DROPPED` ending (so `gate` blocks, like any dropped value). A bad `gpio.*` or `contact.*` state is dropped with a plain load warning and the default state is used. |
| R25 | Determinate download progress when Pages serves the wasm gzip-compressed | `public/sim/engine.json` records the wasm's byte size; progress is bytes received over that size. |
| R26 | Repeated `--probe` flags | `parseArgs` gains a `lists` map for repeatable flags; `--probe` is its only member. |
| R27 | Part keys in `SimResult` | Part uids, as every CLI finding uses (a laid-out netlist's uids are its refs). |
| R28 | Executable fallback adapter | The decision step in Task 1 builds the executable mode and stops for the controller: the executable adapter's design depends on how the shared build failed, so it is added as an amendment task, not guessed here. |
| R29 | Where the circuit's notes ("shown at rest", an LED colour with no model) appear | `SimResult.notes: string[]`, additive to the spec's shape; the Probes panel lists them. |
| R30 | A load that nothing on the sheet supplies (an unplugged DevKit) | `sim-brownout` as a **warning** with basis `topology` ("not powered in the current state"), never an error: the checker's "external power assumed" view already covers an undrawn supply, so blocking would answer the checker's question, not the simulator's (spec 2.1). A load that is supplied but too low is the spec's error. |
| R31 | What "one solve, Worker end to end" measures (spec 8) | Both corners from the built Circuit to the mapped result: compile, worker round trip, solve, map back. Building the Circuit from the sheet is the per-edit cost the 200-part drag budget covers. |
| R32 | `sim-floating-input` on pins wired to nothing | Only an input pin wired to something is reported; an unconnected pin reads nothing, and listing every spare GPIO would bury the real ones. |

## File Structure

New files:

| Path | Responsibility |
|---|---|
| `engine/ngspice/versions.env` | Every pinned input: ngspice version, URL, SHA-256, emsdk image digest, eecircuit commit, build mode |
| `engine/ngspice/Dockerfile` | The pinned emsdk image plus autotools |
| `engine/ngspice/build.sh` | Download, verify, patch, configure, make, link `ngspice.mjs` + `ngspice.wasm`, scan licences |
| `engine/ngspice/make-patches.sh` | Regenerates `patches/*.patch` from the documented edits |
| `engine/ngspice/patches/0001-emscripten-build.patch` | Our edits to ngspice 45.2 (generated) |
| `engine/ngspice/RELINK.md` | Relinking instructions shipped in the release asset (licence compliance) |
| `engine/ngspice/NOTICE.template.txt` | The licence notice, filled in from the build's licence scan |
| `scripts/engine-build.mjs` | `npm run engine:build`: Docker build, copy outputs, write `engine.json` and `NOTICE.txt`, run smoke tests |
| `scripts/engine-release.mjs` | Packs and publishes the GitHub release asset |
| `public/sim/{ngspice.mjs,ngspice.wasm,engine.json,NOTICE.txt}` | The engine for the site (committed) |
| `plugin/dist-cli/{ngspice.mjs,ngspice.wasm,engine.json,NOTICE.txt}` | The engine for the CLI (committed) |
| `src/sim/engine/ngspice.ts` | The core: one ngspice instance over the C API (runs inside a worker) |
| `src/sim/engine/host.ts` | Worker lifecycle: lazy init, 5 s timeout, retry once, recycle |
| `src/sim/engine/workerLoop.ts` | The worker-side message loop shared by both workers |
| `src/sim/engine/nodeEngine.ts` | `worker_threads` host and (same file) the Node worker |
| `src/sim/engine/browserWorker.ts`, `browserEngine.ts` | The Web Worker and its host |
| `src/sim/engine/engine.ts` | `Engine`: compile, run text, map vectors back |
| `src/format/simModel.ts` | `electrical.sim` types, `simOf`, `validateSim` (like `mainsModel.ts`) |
| `src/format/simState.ts` | Saved switch positions, GPIO states and `sim.*` overrides: reading, defaults, validation |
| `src/sim/model.ts` | Engine-neutral circuit types |
| `src/sim/estimates.ts` | Defaults and category estimates, each flagged `estimate` |
| `src/sim/ledModels.ts` | LED colour table and diode fits |
| `src/sim/build.ts` | Diagram to `Circuit`: nets, taps, primitives |
| `src/sim/power.ts` | Boards and modules: domains, loads, rails, GPIO, sources, USB |
| `src/sim/floating.ts` | DC-path classification, islands and references |
| `src/sim/spice.ts` | The compiler and the vector map back |
| `src/sim/results.ts` | Readings, budget, probes, trust |
| `src/sim/findings.ts` | Every `sim-*` code, severity and basis |
| `src/sim/session.ts` | `solve()` and `SimSession` (revision queue) |
| `src/sim/probes.ts` | Probe validation, editing ops, netlist probe mapping |
| `src/sim/testing.ts` | Test helper: small sheets from built-in or inline modules |
| `src/sim/fixtures/spirit-typewriter.netlist.json` | The Spirit Typewriter fixture |
| `scripts/sim-data/*.json`, `scripts/lib/sim-data.mjs`, `scripts/gen-sim.mjs` | Sourced `electrical.sim` patches, the merge every generator applies, and the generator for hand-written modules |
| `src/cli/simCmd.ts` | `circuitoon sim` |
| `plugin/skills/circuitoon-design/references/schemas/sim.schema.json` | The `SimOutcome` schema |
| `src/editor/simulation.ts` | `useSimulation`: the browser engine, session and solve key |
| `src/editor/SimStatus.tsx` | Load progress and the failure banner under the toolbar |
| `src/editor/SimLayer.tsx` | LED glow, over-maximum rings, simulation finding badges |
| `src/editor/ProbeLayer.tsx` | Probe leads and reading tags, placed by `LabelPlacer` |
| `src/editor/ProbesPanel.tsx` | Readings, Supplies, notes, About the simulator |
| `src/editor/SimulationGroup.tsx` | The "Simulation (current state)" findings group |
| `scripts/check-sim-ui.mjs` | Browser check and screenshots, light and dark |

Modified files: `.gitignore`, `package-lock.json`, `src/cli/layoutCmd.ts`, `src/cli/netlistCmd.ts`, `src/editor/ops.ts`, `scripts/validate-modules.ts`, `plugin/skills/circuitoon-design/references/module-schema.md`, `plugin/skills/circuitoon-design/references/netlist-format.md`, `package.json`, `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `src/format/module.ts`, `src/format/diagram.ts`, `src/format/mainsRules.ts`, `src/agent/extract.ts`, `src/agent/netlist.ts`, `src/agent/layout.ts`, `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/gate.ts`, `src/agent/notChecked.ts`, `scripts/lib/gen-output.mjs`, `src/editor/store.ts`, `src/editor/Editor.tsx`, `src/editor/Toolbar.tsx`, `src/editor/Canvas.tsx`, `src/editor/Inspector.tsx`, `src/editor/editor.css`, `plugin/skills/circuitoon-design/SKILL.md`, `plugin/skills/circuitoon-design/references/cli.md`, `plugin/skills/circuitoon-design/references/schemas/gate.schema.json`, `docs/PRD.md`, `README.md`.

---

# Phase A: engine build and adapter

### Task 1: Pinned ngspice WASM build (shared library, XSPICE)

**Files:**
- Create: `engine/ngspice/versions.env`, `engine/ngspice/Dockerfile`, `engine/ngspice/build.sh`, `engine/ngspice/make-patches.sh`, `engine/ngspice/patches/0001-emscripten-build.patch` (generated), `engine/ngspice/NOTICE.template.txt`, `engine/ngspice/RELINK.md`
- Create: `scripts/engine-build.mjs`
- Create (build output, committed): `public/sim/ngspice.mjs`, `public/sim/ngspice.wasm`, `public/sim/engine.json`, `public/sim/NOTICE.txt`, and the same four files in `plugin/dist-cli/`
- Modify: `package.json` (script `engine:build`), `.gitignore` (add `engine/out/`)

**Interfaces:**
- Consumes: nothing.
- Produces: `public/sim/engine.json` and `plugin/dist-cli/engine.json`, exactly `{ "ngspice": "45.2", "build": "45.2-1", "mode": "shared" | "exe", "emsdk": "6.0.11", "wasmBytes": number, "wasmSha256": string, "release": string }`. `ngspice.mjs` default-exports an Emscripten factory `createNgspice(moduleArg) => Promise<Module>` with `_ngSpice_Init`, `_ngSpice_Command`, `_ngGet_Vec_Info`, `_ngSpice_CurPlot`, `_ngSpice_AllVecs`, `_ngSpice_SetBkpt`, `_ngSpice_nospinit`, `_malloc`, `_free` and the runtime methods `addFunction`, `UTF8ToString`, `stringToUTF8`, `lengthBytesUTF8`, `getValue`, `FS`, `HEAPF64`, `HEAPU8`.

The pins below were looked up on 2026-10-05: the ngspice tarball was downloaded from SourceForge and hashed; the emsdk digest is Docker Hub's manifest-list digest for `emscripten/emsdk:6.0.11` (the newest emsdk tag that day); the eecircuit commit is `eelab-dev/EEcircuit-engine` main as of 2026-09-07. Its `Docker/run.sh`, `Dockerfile` and `hicum2_patch.sh` were read at that commit; the edits below that come from them say so.

- [ ] **Step 1: Record the pinned versions and verify the hashes**

Create `engine/ngspice/versions.env`:

```bash
# Every input of the engine build (spec 2.2). Change one, bump BUILD, rebuild with `npm run engine:build`.
NGSPICE_VERSION=45.2
NGSPICE_URL=https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/45.2/ngspice-45.2.tar.gz/download
NGSPICE_SHA256=ba8345f4c3774714c10f33d7da850d361cec7d14b3a295d0dc9fd96f7423812d
EMSDK_VERSION=6.0.11
EMSDK_IMAGE=emscripten/emsdk:6.0.11@sha256:cdefec943f04fd4b2b2fe23b0a1a346be9fc560ef5784a83faa27dd351381372
# build.sh is adapted from eecircuit-engine's MIT-licensed Docker/run.sh at this commit.
EECIRCUIT_COMMIT=75594eec516be3087e64eeb5347a958de70f410c
# shared: --with-ngshared --enable-xspice (spec 2.2). exe: the fallback executable build.
BUILD_MODE=shared
BUILD=45.2-1
RELEASE_TAG=engine-ngspice-45.2-1
```

Verify both pins before anything else:

```bash
cd C:/Users/micha/Desktop/projects/Circuitoon-sim
curl -fsSL -o /tmp/ngspice-45.2.tar.gz "https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/45.2/ngspice-45.2.tar.gz/download"
sha256sum /tmp/ngspice-45.2.tar.gz
docker buildx imagetools inspect emscripten/emsdk:6.0.11 --format '{{json .Manifest.Digest}}'
rm /tmp/ngspice-45.2.tar.gz
```

Expected: `ba8345f4c3774714c10f33d7da850d361cec7d14b3a295d0dc9fd96f7423812d  /tmp/ngspice-45.2.tar.gz` and `"sha256:cdefec943f04fd4b2b2fe23b0a1a346be9fc560ef5784a83faa27dd351381372"`. If either differs, stop and ask the controller: a changed upstream artifact is a supply-chain question, not a typo to fix.

- [ ] **Step 2: Write the patch generator and generate the patch**

`engine/ngspice/make-patches.sh` reproduces eecircuit's edits that still apply to 45.2 (no C++ for hicum2, no `-Wno-unused-but-set-variable`, no `getrusage`; in 45.2 the check reads `AC_CHECK_FUNCS([times getrusage])`, so the target differs from eecircuit's sed) and adds ours (ruling R11: no XSPICE code-model tools). Every edit is checked first, so an upstream change cannot slip through:

```bash
#!/usr/bin/env bash
# Regenerates patches/0001-emscripten-build.patch from the pinned tarball (spec 2.2: our patches as
# .patch files). Run in the build image:
#   docker run --rm -v "$PWD/engine/ngspice:/work" <EMSDK_IMAGE> bash /work/make-patches.sh
set -euo pipefail
source /work/versions.env
cd /tmp && rm -rf a b && mkdir a
curl -fsSL -o ng.tgz "$NGSPICE_URL"
echo "$NGSPICE_SHA256  ng.tgz" | sha256sum -c -
tar xzf ng.tgz -C a --strip-components=1
cp -r a b && cd b
must() { grep -q "$1" "$2" || { echo "make-patches: '$1' not found in $2"; exit 1; }; }
# From eecircuit's hicum2_patch.sh: hicum2 is C++, which the WASM build leaves out.
must 'AC_CHECK_LIB(stdc++' configure.ac
sed -i '/AC_CHECK_LIB(stdc++/d' configure.ac
sed -i '/AC_SUBST(XTRALIBS/d' configure.ac
sed -i '/src\/spicelib\/devices\/hicum2\/Makefile/d' configure.ac
sed -i '/tests\/hicum2\/Makefile/d' configure.ac
sed -i '/spicelib\/devices\/hicum2\/libhicum2.la/d' src/Makefile.am
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?/d' src/spicelib/devices/Makefile.am
sed -i '/get_hicum_info/d' src/spicelib/devices/dev.c
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?[[:space:]]*$/d' tests/Makefile.am
# From eecircuit's run.sh: emcc's clang has no -Wno-unused-but-set-variable; emscripten has no getrusage.
must 'Wno-unused-but-set-variable' configure.ac
sed -i 's/-Wno-unused-but-set-variable/-Wno-unused-const-variable/g' configure.ac
must 'AC_CHECK_FUNCS(\[times getrusage\])' configure.ac
sed -i 's/AC_CHECK_FUNCS(\[times getrusage\])/AC_CHECK_FUNCS([times])/' configure.ac
# Ours (ruling R11): XSPICE core yes, code-model tools no (cmpp would have to run at build time,
# and code models load with dlopen).
must 'SUBDIRS = mif cm enh evt ipc idn cmpp icm verilog vhdl' src/xspice/Makefile.am
sed -i 's/^SUBDIRS = mif cm enh evt ipc idn cmpp icm verilog vhdl$/SUBDIRS = mif cm enh evt ipc idn/' src/xspice/Makefile.am
cd /tmp
diff -ruN a b > /work/patches/0001-emscripten-build.patch || [ $? -eq 1 ]
echo "make-patches: wrote patches/0001-emscripten-build.patch ($(wc -l < /work/patches/0001-emscripten-build.patch) lines)"
```

Run:

```bash
cd C:/Users/micha/Desktop/projects/Circuitoon-sim
mkdir -p engine/ngspice/patches
docker run --rm -v "$PWD/engine/ngspice:/work" emscripten/emsdk:6.0.11@sha256:cdefec943f04fd4b2b2fe23b0a1a346be9fc560ef5784a83faa27dd351381372 bash /work/make-patches.sh
grep -c "^-SUBDIRS = mif cm enh evt ipc idn cmpp icm verilog vhdl" engine/ngspice/patches/0001-emscripten-build.patch
```

Expected: `make-patches: wrote patches/0001-emscripten-build.patch (N lines)` with N above 40, then `1`.

- [ ] **Step 3: Write the Dockerfile and build.sh**

`engine/ngspice/Dockerfile`:

```dockerfile
# The engine build image (spec 2.2): the pinned emsdk image plus the autotools ngspice's autogen needs.
ARG EMSDK_IMAGE
FROM ${EMSDK_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends autoconf automake libtool bison flex patch make curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY versions.env build.sh /work/
COPY patches /work/patches
ENTRYPOINT ["bash", "/work/build.sh"]
```

`engine/ngspice/build.sh`:

```bash
#!/usr/bin/env bash
# Builds ngspice to WebAssembly (spec 2.2). Adapted from eecircuit-engine's MIT-licensed Docker/run.sh
# at EECIRCUIT_COMMIT (the emconfigure and emmake flow and the configure edits), but as a shared
# library with XSPICE, driven through its C API: no Asyncify, no interactive prompt, no PDK models.
# Writes /out/ngspice.mjs, /out/ngspice.wasm, /out/build-info.txt, /out/compiled-dirs.txt and
# /out/licence-scan.txt.
set -euo pipefail
source /work/versions.env
MODE="${BUILD_MODE_OVERRIDE:-$BUILD_MODE}"
mkdir -p /src /out && cd /src
curl -fsSL -o ngspice.tar.gz "$NGSPICE_URL"
echo "$NGSPICE_SHA256  ngspice.tar.gz" | sha256sum -c -
tar xzf ngspice.tar.gz && cd "ngspice-$NGSPICE_VERSION"
for p in /work/patches/*.patch; do patch -p1 < "$p"; done
./autogen.sh
mkdir release && cd release
COMMON="--disable-osdi --disable-debug --disable-openmp --without-x --with-readline=no"
EXPORTS=_ngSpice_Init,_ngSpice_Command,_ngGet_Vec_Info,_ngSpice_CurPlot,_ngSpice_AllVecs,_ngSpice_SetBkpt,_ngSpice_nospinit,_malloc,_free
RUNTIME=addFunction,UTF8ToString,stringToUTF8,lengthBytesUTF8,getValue,FS,HEAPF64,HEAPU8
LINK="-O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNgspice -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sSTACK_SIZE=4MB -sFORCE_FILESYSTEM=1"
if [ "$MODE" = shared ]; then
  emconfigure ../configure --with-ngshared --enable-xspice $COMMON
  emmake make -j"$(nproc)" -C src
  LIB=$(ls src/.libs/libngspice.a src/.libs/libngspice.so 2>/dev/null | head -1 || true)
  [ -n "$LIB" ] || { echo "build: no libngspice.a or .so in src/.libs"; ls -la src/.libs || true; exit 3; }
  emcc "$LIB" -o /out/ngspice.mjs $LINK -sEXPORTED_FUNCTIONS=$EXPORTS -sEXPORTED_RUNTIME_METHODS=$RUNTIME -lm
else
  # Fallback (spec 2.2, ruling R28): the executable, as in eecircuit, without XSPICE.
  emconfigure ../configure --disable-xspice $COMMON
  sed -i "s|\$(ngspice_LDADD) \$(LIBS)|\$(ngspice_LDADD) \$(LIBS) $LINK -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -o ngspice.mjs|" src/Makefile
  emmake make -j"$(nproc)" -C src
  cp src/ngspice.mjs src/ngspice.wasm /out/
fi
# Licence scan (spec 2.2): every source directory compiled in, and which mention a non-BSD licence.
find src -name '*.o' -printf '%h\n' | sed 's|^src/||' | sort -u > /out/compiled-dirs.txt
: > /out/licence-scan.txt
while read -r d; do
  hit=$(grep -l -E 'GNU (Lesser )?General Public|LGPL|GPL|Mozilla Public' "../src/$d"/*.[ch] 2>/dev/null | head -3 | tr '\n' ' ' || true)
  if [ -n "$hit" ]; then echo "$d: $hit" >> /out/licence-scan.txt; fi
done < /out/compiled-dirs.txt
{ echo "mode=$MODE"; echo "ngspice=$NGSPICE_VERSION"; echo "emsdk=$EMSDK_VERSION"; emcc --version | head -1; } > /out/build-info.txt
echo "build: done ($MODE)"; ls -la /out
```

- [ ] **Step 4: Write `scripts/engine-build.mjs`, the NOTICE template and RELINK.md**

`scripts/engine-build.mjs`:

```js
// npm run engine:build (spec 2.2): builds the ngspice WASM in Docker from engine/ngspice, copies
// ngspice.mjs and ngspice.wasm into public/sim/ (the site) and plugin/dist-cli/ (the CLI), writes
// engine.json (what the loaders read, with the wasm size for progress, ruling R25) and NOTICE.txt,
// and runs the engine smoke tests. `--mode exe` builds the fallback executable (ruling R28).
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(join(root, 'engine/ngspice/versions.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)),
)
const i = process.argv.indexOf('--mode')
const mode = i > 0 ? process.argv[i + 1] : env.BUILD_MODE
const out = join(root, 'engine/out')
mkdirSync(out, { recursive: true })
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root })
run('docker', ['build', '--build-arg', `EMSDK_IMAGE=${env.EMSDK_IMAGE}`, '-t', 'circuitoon-ngspice', 'engine/ngspice'])
run('docker', ['run', '--rm', '-e', `BUILD_MODE_OVERRIDE=${mode}`, '-v', `${out}:/out`, 'circuitoon-ngspice'])

const wasm = readFileSync(join(out, 'ngspice.wasm'))
const manifest = {
  ngspice: env.NGSPICE_VERSION,
  build: env.BUILD,
  mode,
  emsdk: env.EMSDK_VERSION,
  wasmBytes: wasm.length,
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  release: `https://github.com/MBarc/circuitoon/releases/tag/${env.RELEASE_TAG}`,
}
const scan = readFileSync(join(out, 'licence-scan.txt'), 'utf8').trim()
const notice = readFileSync(join(root, 'engine/ngspice/NOTICE.template.txt'), 'utf8')
  .replaceAll('{{VERSION}}', env.NGSPICE_VERSION)
  .replaceAll('{{BUILD}}', env.BUILD)
  .replaceAll('{{RELEASE}}', manifest.release)
  .replace('{{SCAN}}', scan || '(none found)')
for (const dir of ['public/sim', 'plugin/dist-cli']) {
  mkdirSync(join(root, dir), { recursive: true })
  for (const f of ['ngspice.mjs', 'ngspice.wasm']) copyFileSync(join(out, f), join(root, dir, f))
  writeFileSync(join(root, dir, 'engine.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(root, dir, 'NOTICE.txt'), notice)
}
const gz = gzipSync(wasm, { level: 9 }).length
console.log(`engine: ${mode} build ${env.BUILD}, wasm ${wasm.length} bytes (${(gz / 1048576).toFixed(2)} MB gzip)`)
if (gz > 2.5 * 1048576) console.error('engine: over the 2.5 MB gzip download budget (spec 8)')
process.exit(spawnSync('npx', ['vitest', 'run', 'src/sim/engine/smoke.test.ts'], { stdio: 'inherit', shell: true, cwd: root }).status ?? 1)
```

`engine/ngspice/NOTICE.template.txt` (Step 6 adds every directory the scan finds):

```text
Circuitoon's simulator runs ngspice {{VERSION}} (engine build {{BUILD}}), compiled to WebAssembly as
a separate, replaceable file (ngspice.wasm).

ngspice is distributed under the modified BSD licence (BSD-3-Clause), except for these components,
which keep their own licences:

- src/frontend/numparam: GNU Lesser General Public License, version 2 or later (LGPLv2+).
- src/maths/sparse: the Sparse 1.3 licence (permissive, MIT-style).

Directories compiled into this build that mention another licence (from the build's scan):
{{SCAN}}

The exact ngspice source tarball, our patches, the build script, the emsdk version and relinking
instructions are published with this engine build at:
{{RELEASE}}

You may replace ngspice.wasm with your own build of the same source (see RELINK.md in that
release); Circuitoon loads it by file name.
```

`engine/ngspice/RELINK.md`:

```markdown
# Rebuilding and replacing Circuitoon's ngspice engine

1. Install Docker. From the Circuitoon repository root run `npm run engine:build`, or by hand:
   `docker build --build-arg EMSDK_IMAGE=<EMSDK_IMAGE from versions.env> -t circuitoon-ngspice engine/ngspice`
   then `docker run --rm -v "$PWD/engine/out:/out" circuitoon-ngspice`.
2. The build downloads the ngspice tarball named in versions.env, checks its SHA-256, applies
   patches/*.patch, configures with --with-ngshared --enable-xspice --disable-osdi and links
   ngspice.mjs and ngspice.wasm with the exported functions listed in build.sh.
3. To use a modified ngspice, change the source (or add a patch), rebuild, and copy the new
   ngspice.mjs and ngspice.wasm over public/sim/ (the site) or plugin/dist-cli/ (the CLI). Set
   wasmBytes in engine.json to the new file's size.
```

Add `"engine:build": "node scripts/engine-build.mjs"` to `package.json` scripts and `engine/out/` to `.gitignore`.

- [ ] **Step 5: Run the build**

Run: `cd C:/Users/micha/Desktop/projects/Circuitoon-sim && node scripts/engine-build.mjs`
The smoke tests come in Task 2, so the run ends with vitest's "No test files found" and a non-zero exit; that is expected here. Expected before it: `build: done (shared)`, a listing of `/out` with `ngspice.mjs` and `ngspice.wasm`, and `engine: shared build 45.2-1, wasm N bytes (X MB gzip)`.

- [ ] **Step 6: Fallback decision (spec 2.2: decided here, not later)**

Decide with these criteria, in order, and write the outcome into the ledger:

1. The shared build succeeded (`build: done (shared)`): keep it and go to Step 7.
2. It failed: read the first compile or link error. Fix only build-level causes inside `make-patches.sh` and `build.sh` (a flag emsdk 6 renamed, a missing export, the stack size, an autotools option) and rerun Step 5. At most three attempts, each recorded in the ledger with the error and the change.
3. Still failing: run `node scripts/engine-build.mjs --mode exe`, set `BUILD_MODE=exe` in `versions.env`, record "Engine: shared-library build failed (<error summary>); executable fallback adopted as accepted debt; firmware co-simulation will need a rebuild", commit, and **stop for the controller**: per ruling R28 the executable adapter is added to this plan as an amendment before Task 2.

Record the gzip size and whether it is within the 2.5 MB budget (spec 8); over budget does not block this task, it goes to the checkpoint.

Then read `engine/out/licence-scan.txt`. Every directory it lists must be in `NOTICE.template.txt` with its licence: add a bullet for any that is missing (numparam is expected). A GPL-only hit in a compiled directory is a stop-and-ask, because Circuitoon is MIT. Rerun Step 5 if the template changed.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/micha/Desktop/projects/Circuitoon-sim
git add engine/ngspice scripts/engine-build.mjs package.json .gitignore public/sim plugin/dist-cli/ngspice.mjs plugin/dist-cli/ngspice.wasm plugin/dist-cli/engine.json plugin/dist-cli/NOTICE.txt
git commit -m "$(cat <<'MSG'
Engine: pinned ngspice 45.2 WASM build (shared library, XSPICE) and npm run engine:build

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 2: The ngspice core and the engine smoke tests

**Files:**
- Create: `src/sim/engine/ngspice.ts`
- Test: `src/sim/engine/smoke.test.ts`

**Interfaces:**
- Consumes: `public/sim/ngspice.mjs`, `public/sim/ngspice.wasm`, `public/sim/engine.json` (Task 1).
- Produces:
  - `type OpResult = { ok: true; vectors: Record<string, number> } | { ok: false; error: string }`
  - `type NgFactory = (opts: { wasmBinary: Uint8Array; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<NgModule>`
  - `interface EngineManifest { ngspice: string; build: string; mode: 'shared' | 'exe'; emsdk: string; wasmBytes: number; wasmSha256: string; release: string }`
  - `function createCore(factory: NgFactory, wasmBinary: Uint8Array): Promise<NgspiceCore>`
  - `class NgspiceCore { runs: number; dead: boolean; op(text: string): OpResult; setBreakpoint(t: number): boolean; heapBytes(): number }`
  - `function loadEngineFiles(dir: string): Promise<{ factory: NgFactory; wasm: Uint8Array; manifest: EngineManifest }>` (Node only)

- [ ] **Step 1: Write the failing smoke test**

`src/sim/engine/smoke.test.ts`:

```ts
// Engine smoke tests (spec 9; npm run engine:build runs them): the built WASM solves the spike's LED
// circuit to the hand calculation, vectors come through ngGet_Vec_Info, ngSpice_SetBkpt is
// accepted, and a failed op is a failure that leaves the instance usable.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createCore, loadEngineFiles } from './ngspice.ts'

const DIR = join(import.meta.dirname, '..', '..', '..', 'public', 'sim')
const LED = `* led
.model LEDRED D(IS=93.2p N=3.73 RS=7.5)
V1 vcc 0 DC 5
R1 vcc a 150
D1 a 0 LEDRED
.end`

describe('ngspice engine (smoke)', () => {
  it('solves LED + 150 ohm + 5 V to the spike hand calculation, read through ngGet_Vec_Info', async () => {
    const { factory, wasm, manifest } = await loadEngineFiles(DIR)
    expect(manifest.ngspice).toBe('45.2')
    const core = await createCore(factory, wasm)
    const r = core.op(LED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.vectors.a - 2.000761)).toBeLessThan(1e-5)
    expect(r.vectors.vcc).toBeCloseTo(5, 9)
    // The source's branch current flows out of its + terminal, so ngspice reports it negative.
    expect(r.vectors['v1#branch']).toBeCloseTo(-(5 - r.vectors.a) / 150, 9)
  })
  it('accepts a breakpoint (ngSpice_SetBkpt), for firmware co-simulation later', async () => {
    const { factory, wasm } = await loadEngineFiles(DIR)
    const core = await createCore(factory, wasm)
    expect(core.setBreakpoint(1e-3)).toBe(true)
  })
  it('reports a circuit with no operating point as a failure, then solves the next one', async () => {
    const { factory, wasm } = await loadEngineFiles(DIR)
    const core = await createCore(factory, wasm)
    expect(core.op(LED).ok).toBe(true)
    const bad = core.op('* bad\nV1 a 0 DC 5\nR1 a\n.end')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0)
    const again = core.op(LED)
    expect(again.ok && Math.abs(again.vectors.a - 2.000761) < 1e-5).toBe(true)
    expect(core.runs).toBe(3)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/engine/smoke.test.ts`
Expected: FAIL, the module `./ngspice.ts` cannot be found.

- [ ] **Step 3: Write the core**

`src/sim/engine/ngspice.ts`:

```ts
// The ngspice core (spec 2.2, 2.3): one ngspice instance driven through its exported C API, always
// inside a terminable worker (host.ts). A run writes the circuit to the in-memory file system,
// `source`s it, runs `op`, reads every vector of the op plot through ngGet_Vec_Info (never
// stdout), then `remcirc` and `destroy all`, so the heap does not grow per run (spike risk 2). An
// op that leaves no data vector is a failure, with the engine's stderr lines kept. Erasable TS:
// the Node worker runs this file directly.

export interface NgModule {
  _ngSpice_Init(printfcn: number, statfcn: number, ngexit: number, sdata: number, sinitdata: number, bgtrun: number, user: number): number
  _ngSpice_Command(cmd: number): number
  _ngGet_Vec_Info(name: number): number
  _ngSpice_CurPlot(): number
  _ngSpice_AllVecs(plot: number): number
  _ngSpice_SetBkpt(t: number): number
  _ngSpice_nospinit(): number
  _malloc(n: number): number
  _free(p: number): void
  addFunction(f: (...args: number[]) => number, sig: string): number
  UTF8ToString(p: number): string
  stringToUTF8(s: string, p: number, max: number): void
  lengthBytesUTF8(s: string): number
  getValue(p: number, type: 'i32' | 'double' | '*'): number
  HEAPU8: Uint8Array
  FS: { writeFile(path: string, data: string): void }
}
export type NgFactory = (opts: { wasmBinary: Uint8Array; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<NgModule>
export type OpResult = { ok: true; vectors: Record<string, number> } | { ok: false; error: string }
export interface EngineManifest { ngspice: string; build: string; mode: 'shared' | 'exe'; emsdk: string; wasmBytes: number; wasmSha256: string; release: string }

/** vector_info on wasm32 (sharedspice.h): v_name 0, v_type 4, v_flags 8, v_realdata 12, v_compdata 16, v_length 20. */
const V_REALDATA = 12
const V_LENGTH = 20
const CIRCUIT = '/circuit.cir'

export class NgspiceCore {
  private m: NgModule
  private errors: string[] = []
  /** Set when ngspice called its exit callback: the instance is not used again (host.ts recycles it). */
  dead = false
  runs = 0

  constructor(m: NgModule) {
    this.m = m
    // SendChar(char*, int, void*): every printed line, prefixed "stdout " or "stderr ".
    const sendChar = m.addFunction((p: number) => {
      const line = m.UTF8ToString(p)
      if (line.startsWith('stderr ')) this.errors.push(line.slice(7))
      return 0
    }, 'iiii')
    // ControlledExit(int, bool, bool, int, void*).
    const exit = m.addFunction(() => {
      this.dead = true
      return 0
    }, 'iiiiii')
    // Ruling R11: no spinit (it would try to dlopen XSPICE code models).
    m._ngSpice_nospinit()
    if (m._ngSpice_Init(sendChar, 0, exit, 0, 0, 0, 0) !== 0) throw new Error('ngSpice_Init failed')
  }

  private withString<T>(s: string, f: (p: number) => T): T {
    const n = this.m.lengthBytesUTF8(s) + 1
    const p = this.m._malloc(n)
    this.m.stringToUTF8(s, p, n)
    try {
      return f(p)
    } finally {
      this.m._free(p)
    }
  }

  private command(c: string): void {
    this.withString(c, (p) => this.m._ngSpice_Command(p))
  }

  private vectorNames(plot: string): string[] {
    return this.withString(plot, (p) => {
      const list = this.m._ngSpice_AllVecs(p)
      const out: string[] = []
      for (let i = 0; list; i++) {
        const s = this.m.getValue(list + 4 * i, '*')
        if (!s) break
        out.push(this.m.UTF8ToString(s))
      }
      return out
    })
  }

  private vector(name: string): number | null {
    return this.withString(name, (p) => {
      const info = this.m._ngGet_Vec_Info(p)
      if (!info) return null
      const data = this.m.getValue(info + V_REALDATA, '*')
      const length = this.m.getValue(info + V_LENGTH, 'i32')
      return data && length > 0 ? this.m.getValue(data, 'double') : null
    })
  }

  /** One DC operating point: source + op + read + remcirc (spec 2.3). */
  op(text: string): OpResult {
    this.runs++
    this.errors = []
    this.m.FS.writeFile(CIRCUIT, text)
    this.command('destroy all')
    this.command(`source ${CIRCUIT}`)
    this.command('op')
    const plot = this.m.UTF8ToString(this.m._ngSpice_CurPlot())
    const vectors: Record<string, number> = {}
    if (!this.dead && plot && plot !== 'const')
      for (const name of this.vectorNames(plot)) {
        const v = this.vector(name)
        if (v !== null) vectors[name] = v
      }
    this.command('remcirc')
    this.command('destroy all')
    if (this.dead || Object.keys(vectors).length === 0) return { ok: false, error: this.errors.join('\n') || 'the operating point produced no data' }
    return { ok: true, vectors }
  }

  setBreakpoint(t: number): boolean {
    return this.m._ngSpice_SetBkpt(t) !== 0
  }

  heapBytes(): number {
    return this.m.HEAPU8.length
  }
}

export async function createCore(factory: NgFactory, wasmBinary: Uint8Array): Promise<NgspiceCore> {
  const m = await factory({ wasmBinary, print: () => {}, printErr: () => {} })
  return new NgspiceCore(m)
}

/** Node only: the factory, wasm bytes and manifest from an engine directory (public/sim or plugin/dist-cli). */
export async function loadEngineFiles(dir: string): Promise<{ factory: NgFactory; wasm: Uint8Array; manifest: EngineManifest }> {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const manifest = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8')) as EngineManifest
  // A variable specifier: bundlers leave it alone, so the glue is loaded from disk at run time.
  const glue = pathToFileURL(join(dir, 'ngspice.mjs')).href
  const mod = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
  return { factory: mod.default, wasm: new Uint8Array(readFileSync(join(dir, 'ngspice.wasm'))), manifest }
}
```

- [ ] **Step 4: Run the smoke tests**

Run: `npx vitest run src/sim/engine/smoke.test.ts`
Expected: PASS (3 tests). If the branch vector has another spelling in this build, print `Object.keys(r.vectors)` once, use the engine's spelling in the test (ngspice lowercases names), and note it in the ledger; Task 13's compiler relies on the `<vsource>#branch` form.

- [ ] **Step 5: Run engine:build end to end**

Run: `npm run engine:build`
Expected: the Task 1 build lines, then 3 smoke tests PASS and exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/sim/engine/ngspice.ts src/sim/engine/smoke.test.ts
git commit -m "$(cat <<'MSG'
Engine: ngspice core over the C API (source, op, ngGet_Vec_Info, remcirc) with smoke tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 3: Worker lifecycle host (timeout, retry, recycle)

**Files:**
- Create: `src/sim/engine/host.ts`
- Test: `src/sim/engine/host.test.ts`

**Interfaces:**
- Consumes: nothing at run time (it drives any `WorkerLike`).
- Produces:
  - `interface EngineInfo { name: 'ngspice'; version: string; build: string }`
  - `type ToWorker = { type: 'run'; id: number; text: string }`
  - `type FromWorker = { type: 'ready'; engine: EngineInfo } | { type: 'progress'; loaded: number; total: number } | { type: 'result'; id: number; ok: true; vectors: Record<string, number>; ms: number; heap: number } | { type: 'result'; id: number; ok: false; error: string; ms: number; heap: number } | { type: 'fatal'; error: string }`
  - `interface WorkerLike { post(m: ToWorker): void; onMessage(cb: (m: FromWorker) => void): void; onExit(cb: () => void): void; terminate(): void }`
  - `type TextOutcome = { status: 'ok'; vectors: Record<string, number>; ms: number } | { status: 'failed'; error: string } | { status: 'unavailable'; reason: string }`
  - `const RUN_TIMEOUT_MS = 5000`, `const RECYCLE_RUNS = 2000`
  - `interface HostOptions { spawn: () => WorkerLike; timeoutMs?: number | (() => number); recycleRuns?: number; onProgress?: (loaded: number, total: number) => void }`
  - `class EngineHost { info: EngineInfo | null; runs: number; spawned: number; lastHeap: number; init(): Promise<EngineInfo>; runText(text: string): Promise<TextOutcome>; dispose(): void }`

- [ ] **Step 1: Write the failing tests with a fake worker**

`src/sim/engine/host.test.ts`:

```ts
// The worker lifecycle (spec 2.3) against a fake worker: success, failure, success on one host; a
// fresh worker after any failure; a timeout terminates, retries once, then fails; recycling after
// N engine runs; an engine that cannot load is "unavailable"; requests run one at a time.
import { describe, expect, it } from 'vitest'
import { EngineHost, type FromWorker, type ToWorker, type WorkerLike } from './host.ts'

/** A fake worker: "bad" fails, "hang" never answers, anything else solves to { a: 1 }. */
function fakes(opts: { fatal?: boolean } = {}) {
  const made: { terminated: boolean }[] = []
  const spawn = (): WorkerLike => {
    let listener: (m: FromWorker) => void = () => {}
    const me = { terminated: false }
    made.push(me)
    queueMicrotask(() => listener(opts.fatal ? { type: 'fatal', error: 'no wasm' } : { type: 'ready', engine: { name: 'ngspice', version: '45.2', build: 'test' } }))
    return {
      post(m: ToWorker) {
        if (m.text === 'hang') return
        queueMicrotask(() =>
          listener(m.text === 'bad' ? { type: 'result', id: m.id, ok: false, error: 'singular', ms: 1, heap: 100 } : { type: 'result', id: m.id, ok: true, vectors: { a: 1 }, ms: 1, heap: 100 }),
        )
      },
      onMessage(cb) {
        listener = cb
      },
      onExit() {},
      terminate() {
        me.terminated = true
      },
    }
  }
  return { made, spawn }
}

describe('EngineHost', () => {
  it('solves, fails, then solves again, with a fresh worker after the failure', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn })
    expect(await host.runText('ok')).toEqual({ status: 'ok', vectors: { a: 1 }, ms: 1 })
    expect(await host.runText('bad')).toEqual({ status: 'failed', error: 'singular' })
    expect(f.made[0].terminated).toBe(true)
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
    expect(host.spawned).toBe(2)
    expect(host.runs).toBe(3)
  })
  it('terminates a worker that times out, retries once on a new one, then fails', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, timeoutMs: 20 })
    const r = await host.runText('hang')
    expect(r.status).toBe('failed')
    if (r.status === 'failed') expect(r.error).toContain('did not answer')
    expect(f.made.map((w) => w.terminated)).toEqual([true, true])
    expect(await host.runText('ok')).toMatchObject({ status: 'ok' })
  })
  it('recycles the worker after recycleRuns engine runs, between runs', async () => {
    const f = fakes()
    const host = new EngineHost({ spawn: f.spawn, recycleRuns: 3 })
    for (let i = 0; i < 4; i++) expect((await host.runText('ok')).status).toBe('ok')
    expect(host.spawned).toBe(2)
    expect(f.made[0].terminated).toBe(true)
  })
  it('is unavailable when the engine cannot load, and when spawning throws', async () => {
    expect(await new EngineHost({ spawn: fakes({ fatal: true }).spawn }).runText('ok')).toEqual({ status: 'unavailable', reason: 'no wasm' })
    const host = new EngineHost({
      spawn: () => {
        throw new Error('the simulation engine is not installed')
      },
    })
    expect(await host.runText('ok')).toEqual({ status: 'unavailable', reason: 'the simulation engine is not installed' })
  })
  it('runs one request at a time, in order', async () => {
    const host = new EngineHost({ spawn: fakes().spawn })
    const all = await Promise.all([host.runText('ok'), host.runText('bad'), host.runText('ok')])
    expect(all.map((r) => r.status)).toEqual(['ok', 'failed', 'ok'])
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/engine/host.test.ts`
Expected: FAIL, `./host.ts` cannot be found.

- [ ] **Step 3: Write the host**

`src/sim/engine/host.ts`:

```ts
// The engine's worker lifecycle (spec 2.3), shared by the browser and Node: the worker is spawned
// on first use; each run has a 5 s timeout, after which the worker is terminated and recreated and
// the run retried once (a second timeout is a failure); the worker is recycled after any failure
// and after 2,000 engine runs, always between runs. Requests run one at a time.

export interface EngineInfo { name: 'ngspice'; version: string; build: string }
export type ToWorker = { type: 'run'; id: number; text: string }
export type FromWorker =
  | { type: 'ready'; engine: EngineInfo }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: number; ok: true; vectors: Record<string, number>; ms: number; heap: number }
  | { type: 'result'; id: number; ok: false; error: string; ms: number; heap: number }
  | { type: 'fatal'; error: string }
export interface WorkerLike {
  post(m: ToWorker): void
  onMessage(cb: (m: FromWorker) => void): void
  onExit(cb: () => void): void
  terminate(): void
}
export type TextOutcome = { status: 'ok'; vectors: Record<string, number>; ms: number } | { status: 'failed'; error: string } | { status: 'unavailable'; reason: string }

export const RUN_TIMEOUT_MS = 5000
export const RECYCLE_RUNS = 2000

export interface HostOptions {
  spawn: () => WorkerLike
  /** A number, or a function read before every run (the visual check's failure knob, Task 34). */
  timeoutMs?: number | (() => number)
  recycleRuns?: number
  onProgress?: (loaded: number, total: number) => void
}

type Answer = Extract<FromWorker, { type: 'result' }> | 'timeout'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class EngineHost {
  private opts: HostOptions
  private worker: WorkerLike | null = null
  private ready: Promise<EngineInfo> | null = null
  private waiting = new Map<number, (a: Answer) => void>()
  private onWorker = 0
  private seq = 0
  private queue: Promise<unknown> = Promise.resolve()
  info: EngineInfo | null = null
  /** Engine runs that returned an answer, over every worker. */
  runs = 0
  spawned = 0
  /** The WASM heap size the last run reported, in bytes. */
  lastHeap = 0

  constructor(opts: HostOptions) {
    this.opts = opts
  }

  init(): Promise<EngineInfo> {
    if (this.ready) return this.ready
    const ready = new Promise<EngineInfo>((resolve, reject) => {
      let w: WorkerLike
      try {
        w = this.opts.spawn()
      } catch (e) {
        return reject(new Error(message(e)))
      }
      this.spawned++
      this.worker = w
      w.onMessage((m) => {
        if (m.type === 'ready') resolve((this.info = m.engine))
        else if (m.type === 'fatal') reject(new Error(m.error))
        else if (m.type === 'progress') this.opts.onProgress?.(m.loaded, m.total)
        else if (m.type === 'result') {
          this.lastHeap = m.heap
          this.waiting.get(m.id)?.(m)
          this.waiting.delete(m.id)
        }
      })
      w.onExit(() => {
        if (this.worker !== w) return
        reject(new Error('the simulation engine stopped while loading'))
        for (const done of this.waiting.values()) done('timeout')
        this.waiting.clear()
      })
    })
    this.ready = ready
    // A failed load does not stick: the next request tries again.
    ready.catch(() => {
      if (this.ready === ready) this.recycle()
    })
    return ready
  }

  private timeout(): number {
    const t = this.opts.timeoutMs
    return typeof t === 'function' ? t() : (t ?? RUN_TIMEOUT_MS)
  }

  private once(text: string): Promise<Answer> {
    const id = ++this.seq
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve('timeout')
      }, this.timeout())
      this.waiting.set(id, (a) => {
        clearTimeout(timer)
        resolve(a)
      })
      this.worker!.post({ type: 'run', id, text })
    })
  }

  private recycle(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.onWorker = 0
    for (const done of this.waiting.values()) done('timeout')
    this.waiting.clear()
  }

  /** One engine run of a SPICE text, queued behind any run in progress. */
  runText(text: string): Promise<TextOutcome> {
    const next = this.queue.then(() => this.attempt(text))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async attempt(text: string): Promise<TextOutcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.init()
      } catch (e) {
        return { status: 'unavailable', reason: message(e) }
      }
      const a = await this.once(text)
      if (a === 'timeout') {
        this.recycle()
        continue
      }
      this.runs++
      this.onWorker++
      if (!a.ok) {
        this.recycle()
        return { status: 'failed', error: a.error }
      }
      if (this.onWorker >= (this.opts.recycleRuns ?? RECYCLE_RUNS)) this.recycle()
      return { status: 'ok', vectors: a.vectors, ms: a.ms }
    }
    return { status: 'failed', error: `the simulation engine did not answer within ${this.timeout() / 1000} s, twice` }
  }

  dispose(): void {
    this.recycle()
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/engine/host.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/engine/host.ts src/sim/engine/host.test.ts
git commit -m "$(cat <<'MSG'
Engine: worker lifecycle host (5 s timeout, one retry, recycle after failures and 2,000 runs)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 4: Node and browser workers

**Files:**
- Create: `src/sim/engine/workerLoop.ts`, `src/sim/engine/nodeEngine.ts`, `src/sim/engine/browserWorker.ts`, `src/sim/engine/browserEngine.ts`
- Test: `src/sim/engine/nodeEngine.test.ts`, `src/sim/engine/engine.perf.test.ts`

**Interfaces:**
- Consumes: `NgspiceCore`, `createCore`, `loadEngineFiles`, `EngineManifest`, `NgFactory` (Task 2); `EngineHost`, `HostOptions`, `FromWorker`, `ToWorker`, `EngineInfo` (Task 3).
- Produces:
  - `function serve(post: (m: FromWorker) => void, listen: (cb: (m: ToWorker) => void) => void, load: (progress: (loaded: number, total: number) => void) => Promise<{ core: NgspiceCore; info: EngineInfo }>): void`
  - `function engineDir(): string | null`
  - `function createNodeEngineHost(opts?: Omit<HostOptions, 'spawn'>): EngineHost`
  - `function createBrowserEngineHost(opts?: Omit<HostOptions, 'spawn'>): EngineHost`

- [ ] **Step 1: Write the failing Node worker tests**

`src/sim/engine/nodeEngine.test.ts`:

```ts
// The engine in a real worker_threads Worker (spec 2.3): success, failure, success with the failed
// worker replaced; a timeout terminates the worker and the run fails after its one retry.
import { describe, expect, it } from 'vitest'
import { createNodeEngineHost, engineDir } from './nodeEngine.ts'

const LED = '* led\n.model LEDRED D(IS=93.2p N=3.73 RS=7.5)\nV1 vcc 0 DC 5\nR1 vcc a 150\nD1 a 0 LEDRED\n.end'

describe('the Node engine worker', () => {
  it('finds the engine in public/sim from the source tree', () => {
    expect(engineDir()?.replaceAll('\\', '/')).toMatch(/public\/sim$/)
  })
  it('solves, fails, then solves again in workers it cleans up', async () => {
    const host = createNodeEngineHost()
    try {
      const a = await host.runText(LED)
      expect(a.status === 'ok' && Math.abs(a.vectors.a - 2.000761) < 1e-5).toBe(true)
      expect((await host.runText('* bad\nR1 a\n.end')).status).toBe('failed')
      expect((await host.runText(LED)).status).toBe('ok')
      expect(host.spawned).toBe(2)
      expect(host.info).toEqual({ name: 'ngspice', version: '45.2', build: '45.2-1' })
    } finally {
      host.dispose()
    }
  }, 60_000)
  it('terminates and replaces a worker that does not answer in time, then fails the run', async () => {
    // 1 ms is far shorter than loading and solving, so both attempts time out.
    const host = createNodeEngineHost({ timeoutMs: 1 })
    try {
      expect((await host.runText(LED)).status).toBe('failed')
      expect(host.spawned).toBe(2)
    } finally {
      host.dispose()
    }
  }, 60_000)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sim/engine/nodeEngine.test.ts`
Expected: FAIL, `./nodeEngine.ts` cannot be found.

- [ ] **Step 3: Write the worker loop and the Node engine**

`src/sim/engine/workerLoop.ts`:

```ts
// The worker side of the engine (both workers): load the core once, then answer each run in order.
// A run is synchronous inside the worker; the host (host.ts) terminates the worker on a timeout.
import type { NgspiceCore } from './ngspice.ts'
import type { EngineInfo, FromWorker, ToWorker } from './host.ts'

export function serve(
  post: (m: FromWorker) => void,
  listen: (cb: (m: ToWorker) => void) => void,
  load: (progress: (loaded: number, total: number) => void) => Promise<{ core: NgspiceCore; info: EngineInfo }>,
): void {
  const loading = load((loaded, total) => post({ type: 'progress', loaded, total }))
  loading.then(
    ({ info }) => post({ type: 'ready', engine: info }),
    (e) => post({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }),
  )
  listen((m) => {
    if (m.type !== 'run') return
    void loading.then(({ core }) => {
      const t0 = performance.now()
      const r = core.op(m.text)
      const ms = performance.now() - t0
      post(r.ok
        ? { type: 'result', id: m.id, ok: true, vectors: r.vectors, ms, heap: core.heapBytes() }
        : { type: 'result', id: m.id, ok: false, error: r.error, ms, heap: core.heapBytes() })
    })
  })
}
```

`src/sim/engine/nodeEngine.ts`:

```ts
// The engine in Node (spec 2, ruling R22): a worker_threads Worker that runs this same file. In the
// CLI bundle that file is plugin/dist-cli/circuitoon.mjs, with ngspice.mjs and ngspice.wasm beside
// it; from the source tree (vitest) it is this .ts file, and the engine is in public/sim/.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { EngineHost, type FromWorker, type HostOptions, type ToWorker } from './host.ts'
import { createCore, loadEngineFiles } from './ngspice.ts'
import { serve } from './workerLoop.ts'

const WASM = 'ngspice.wasm'

/** The directory with the engine: beside this file (the bundle), else public/sim from the source tree. */
export function engineDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const dir of [here, join(here, '..', '..', '..', 'public', 'sim')]) if (existsSync(join(dir, WASM))) return dir
  return null
}

export function createNodeEngineHost(opts: Omit<HostOptions, 'spawn'> = {}): EngineHost {
  return new EngineHost({
    ...opts,
    spawn: () => {
      const dir = engineDir()
      if (!dir) throw new Error(`the simulation engine (${WASM}) is not installed beside the circuitoon CLI`)
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { circuitoonSim: dir } })
      return {
        post: (m: ToWorker) => w.postMessage(m),
        onMessage: (cb) => void w.on('message', (m: FromWorker) => cb(m)),
        onExit: (cb) => void w.on('exit', cb),
        terminate: () => void w.terminate(),
      }
    },
  })
}

// The worker side: only when this file was started as the engine worker.
const data = workerData as { circuitoonSim?: string } | null
if (!isMainThread && data?.circuitoonSim) {
  const dir = data.circuitoonSim
  serve(
    (m) => parentPort!.postMessage(m),
    (cb) => void parentPort!.on('message', cb),
    async () => {
      const { factory, wasm, manifest } = await loadEngineFiles(dir)
      return { core: await createCore(factory, wasm), info: { name: 'ngspice', version: manifest.ngspice, build: manifest.build } }
    },
  )
}
```

- [ ] **Step 4: Write the browser worker and its host**

`src/sim/engine/browserWorker.ts`:

```ts
// The engine's Web Worker (spec 2.2): fetches engine.json, then ngspice.wasm with determinate
// progress (ruling R25: bytes over the manifest's wasmBytes), then imports the separate glue from
// public/sim at run time. Never part of the main bundle.
import { createCore, type EngineManifest, type NgFactory } from './ngspice.ts'
import type { FromWorker, ToWorker } from './host.ts'
import { serve } from './workerLoop.ts'

const scope = self as unknown as { postMessage(m: FromWorker): void; addEventListener(t: 'message', f: (e: MessageEvent<ToWorker>) => void): void }
const BASE = `${import.meta.env.BASE_URL}sim/`

async function fetchBytes(url: string, total: number, progress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`could not load ${url} (HTTP ${res.status})`)
  const chunks: Uint8Array[] = []
  let loaded = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    progress(Math.min(loaded, total), total)
  }
  const out = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

serve(
  (m) => scope.postMessage(m),
  (cb) => scope.addEventListener('message', (e) => cb(e.data)),
  async (progress) => {
    const manifest = (await (await fetch(`${BASE}engine.json`)).json()) as EngineManifest
    const wasm = await fetchBytes(`${BASE}ngspice.wasm`, manifest.wasmBytes, progress)
    const glue = `${BASE}ngspice.mjs`
    const { default: factory } = (await import(/* @vite-ignore */ glue)) as { default: NgFactory }
    return { core: await createCore(factory, wasm), info: { name: 'ngspice', version: manifest.ngspice, build: manifest.build } }
  },
)
```

`src/sim/engine/browserEngine.ts`:

```ts
// The engine in the browser: a module Web Worker (browserWorker.ts), spawned only when Simulate is
// first turned on, so the engine is never in the main bundle (spec 8).
import { EngineHost, type FromWorker, type HostOptions, type ToWorker } from './host.ts'

export function createBrowserEngineHost(opts: Omit<HostOptions, 'spawn'> = {}): EngineHost {
  return new EngineHost({
    ...opts,
    spawn: () => {
      const w = new Worker(new URL('./browserWorker.ts', import.meta.url), { type: 'module' })
      return {
        post: (m: ToWorker) => w.postMessage(m),
        onMessage: (cb) => w.addEventListener('message', (e: MessageEvent<FromWorker>) => cb(e.data)),
        onExit: (cb) => w.addEventListener('error', () => cb()),
        terminate: () => w.terminate(),
      }
    },
  })
}
```

- [ ] **Step 5: Run the Node worker tests**

Run: `npx vitest run src/sim/engine/nodeEngine.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write and run the heap budget test**

`src/sim/engine/engine.perf.test.ts`:

```ts
// Spec 8: the worker heap after 2,000 runs (one recycle period) is at most 64 MB above baseline.
import { describe, expect, it } from 'vitest'
import { createNodeEngineHost } from './nodeEngine.ts'

const LED = (r: number) => `* led\n.model LEDRED D(IS=93.2p N=3.73 RS=7.5)\nV1 vcc 0 DC 5\nR1 vcc a ${150 + r}\nD1 a 0 LEDRED\n.end`

describe('engine memory', () => {
  it('keeps the WASM heap within 64 MB of its baseline over 1,999 runs on one worker', async () => {
    const host = createNodeEngineHost()
    try {
      await host.runText(LED(0))
      const baseline = host.lastHeap
      for (let i = 1; i < 1999; i++) expect((await host.runText(LED(i % 50))).status).toBe('ok')
      expect(host.spawned).toBe(1)
      expect(host.lastHeap - baseline).toBeLessThanOrEqual(64 * 1024 * 1024)
    } finally {
      host.dispose()
    }
  }, 120_000)
})
```

Run: `npx vitest run src/sim/engine/engine.perf.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and build**

Run: `npm run build`
Expected: success. Nothing in the app imports the browser engine yet; Task 34 wires it in and checks that the worker becomes its own chunk.

- [ ] **Step 8: Commit**

```bash
git add src/sim/engine/workerLoop.ts src/sim/engine/nodeEngine.ts src/sim/engine/browserWorker.ts src/sim/engine/browserEngine.ts src/sim/engine/nodeEngine.test.ts src/sim/engine/engine.perf.test.ts
git commit -m "$(cat <<'MSG'
Engine: Node worker_threads and browser Web Worker adapters, lifecycle and heap tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 5: Engine release asset

**Files:**
- Create: `scripts/engine-release.mjs`
- Modify: `package.json` (script `engine:release`)

**Interfaces:**
- Consumes: `engine/ngspice/*`, `public/sim/engine.json` (Task 1).
- Produces: GitHub release `engine-ngspice-45.2-1` on MBarc/circuitoon with asset `circuitoon-ngspice-45.2-1-source.tar.gz` holding the exact ngspice tarball, `patches/`, `build.sh`, `make-patches.sh`, `Dockerfile`, `versions.env` (emsdk version and digest), `RELINK.md` and `engine.json` (spec 2.2). `engine.json.release` and `NOTICE.txt` already link it.

- [ ] **Step 1: Write the release script**

`scripts/engine-release.mjs`:

```js
// npm run engine:release: packs what spec 2.2 asks the release to carry (the exact ngspice tarball,
// our patches, the build files with the emsdk version, RELINK.md) and publishes it as a GitHub
// release asset with gh. Re-running for an existing tag replaces the asset (--clobber).
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(join(root, 'engine/ngspice/versions.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)),
)
const name = `circuitoon-ngspice-${env.BUILD}-source`
const parent = mkdtempSync(join(tmpdir(), 'engine-release-'))
const dir = join(parent, name)
cpSync(join(root, 'engine/ngspice'), dir, { recursive: true })
const tarball = join(dir, `ngspice-${env.NGSPICE_VERSION}.tar.gz`)
execFileSync('curl', ['-fsSL', '-o', tarball, env.NGSPICE_URL], { stdio: 'inherit' })
const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex')
if (sum !== env.NGSPICE_SHA256) throw new Error(`engine-release: tarball hash ${sum} does not match versions.env`)
copyFileSync(join(root, 'public/sim/engine.json'), join(dir, 'engine.json'))
writeFileSync(join(dir, 'README.txt'), `Circuitoon engine build ${env.BUILD}: ngspice ${env.NGSPICE_VERSION}, emsdk ${env.EMSDK_VERSION} (${env.EMSDK_IMAGE}).\nSee RELINK.md to rebuild and replace ngspice.wasm.\n`)
const tar = join(parent, `${name}.tar.gz`)
execFileSync('tar', ['czf', tar, '-C', parent, name], { stdio: 'inherit' })
const notes = `ngspice ${env.NGSPICE_VERSION} compiled to WebAssembly for Circuitoon's simulator (engine build ${env.BUILD}). The asset holds the exact ngspice source tarball, our patches, the build script and emsdk version, and relinking instructions.`
let exists = true
try {
  execFileSync('gh', ['release', 'view', env.RELEASE_TAG, '-R', 'MBarc/circuitoon'], { stdio: 'ignore' })
} catch {
  exists = false
}
if (exists) execFileSync('gh', ['release', 'upload', env.RELEASE_TAG, tar, '--clobber', '-R', 'MBarc/circuitoon'], { stdio: 'inherit' })
else execFileSync('gh', ['release', 'create', env.RELEASE_TAG, tar, '-R', 'MBarc/circuitoon', '--title', `Simulation engine ${env.BUILD}`, '--notes', notes], { stdio: 'inherit' })
console.log(`engine-release: ${env.RELEASE_TAG} has ${name}.tar.gz`)
```

Add `"engine:release": "node scripts/engine-release.mjs"` to `package.json`.

- [ ] **Step 2: Publish and verify**

Run: `npm run engine:release`, then `gh release view engine-ngspice-45.2-1 -R MBarc/circuitoon --json assets --jq '.assets[].name'`
Expected: `circuitoon-ngspice-45.2-1-source.tar.gz`. If `gh` is not authorised for MBarc/circuitoon, stop and ask Michael: NOTICE.txt links this release, so the checkpoint waits for it.

- [ ] **Step 3: Commit**

```bash
git add scripts/engine-release.mjs package.json
git commit -m "$(cat <<'MSG'
Engine: publish the source, patches and build materials as a GitHub release asset

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: Astra review of phase A

The review covers spec checkpoint 3: the Docker build and its pins, the fallback decision and its ledger entry, the release asset and NOTICE, the adapter and both workers, and the lifecycle and heap tests. Before it: `npm test`, `npm run build` and `npm run validate` pass.

---

# Phase B: model, compiler and floating classification

### Task 6: Simulation data types, circuit types and estimates

**Files:**
- Create: `src/format/simModel.ts`, `src/sim/model.ts`, `src/sim/estimates.ts`
- Test: `src/sim/estimates.test.ts`

**Interfaces:**
- Consumes: `ModuleDef`, `isObj` from `src/format/module.ts`.
- Produces (`src/format/simModel.ts`):
  - `type Provenance = 'datasheet' | 'representative' | 'estimate'`, `const PROVENANCES`
  - `type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1'`
  - `interface Quantity { value: number; unit: SimUnit; source?: string; provenance: Provenance; note?: string }`
  - `const LIMIT_KINDS`, `type LimitKind`, `interface Limit { of: { pin: string } | { domain: string } | { part: true }; kind: LimitKind; value: number; source?: string; provenance: Provenance; conditions?: string }`
  - `interface PowerDomain { name: string; pin: string; ret: string; nominal: number }`
  - `interface Draw { domain: string; typical: Quantity; peak?: Quantity & { note: string }; minVolts?: Quantity }`
  - `const RAIL_KINDS`, `type RailKind`, `interface Rail` (spec 3.2 fields), `interface SourceSpec`, `interface PowerSpec`, `interface GpioSpec`, `interface SimSpec`
  - `function simOf(m: ModuleDef | undefined): SimSpec | null`
- Produces (`src/sim/model.ts`): `Basis`, `Corner`, `Analysis`, `Param`, `DiodeModel`, `Device`, `ResolvedRail`, `PinTap`, `SimDomain`, `ResolvedLimit`, `GpioPin`, `UsbPath`, `SimPart`, `Circuit` (code below).
- Produces (`src/sim/estimates.ts`): `CONTACT_OHMS`, `ROUT_DEFAULT`, `IQ_DEFAULT`, `CABLE_OHMS`, `PLUG_OHMS`, `OR_DIODE_VF`, `RAIL_DIRECT_OHMS`, `MIN_VOLTS_FRACTION`, `NO_POWER_DATA`, `cellEstimate(nominal: number): { rInternal: Quantity; assumed: string }`, `loadEstimate(m: ModuleDef): LoadEstimate | null`, `interface LoadEstimate { typical: Quantity; peak: Quantity & { note: string }; row: string }`.

- [ ] **Step 1: Write the failing test**

`src/sim/estimates.test.ts`:

```ts
// Spec 3.1 and 3.4: the voltage-keyed battery fallback and the category load estimates, each
// flagged `estimate`, and simOf reading electrical.sim.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'
import { cellEstimate, loadEstimate } from './estimates.ts'

describe('battery fallback by nominal voltage (spec 3.1 table)', () => {
  it.each([
    [3.0, 15, 'lithium coin cell'],
    [1.5, 0.15, 'alkaline AA'],
    [4.5, 0.45, 'alkaline AA'],
    [6, 0.6, 'alkaline AA'],
    [3.7, 0.05, 'Li-ion 18650'],
    [7.4, 0.1, 'Li-ion 18650'],
    [9, 1.5, 'alkaline 9 V'],
    [12, 0.1, 'unknown'],
  ])('%s V: %s ohm (%s)', (v, ohms, assumed) => {
    const e = cellEstimate(v)
    expect(e.rInternal.value).toBeCloseTo(ohms, 9)
    expect(e.rInternal.provenance).toBe('estimate')
    expect(e.rInternal.note).toBeTruthy()
    expect(e.assumed).toBe(assumed)
  })
})

describe('category load estimates (spec 3.4 table)', () => {
  it.each([
    ['esp32-devkit-v1-30', 0.08, 0.5],
    ['esp32-s3-devkitc-1', 0.08, 0.5],
    ['esp32-c3-supermini', 0.03, 0.35],
    ['xiao-esp32c3', 0.03, 0.35],
    ['arduino-uno-r3', 0.025, 0.06],
    ['rpi-pico', 0.025, 0.06],
    ['oled-ssd1306-096-i2c', 0.015, 0.04],
    ['tft-ili9341-24-spi', 0.06, 0.12],
    ['bme280-module-4pin', 0.002, 0.01],
    ['rfm95-lora-breakout', 0.03, 0.25],
  ])('%s: typical %s A, peak %s A, both estimates', (id, typical, peak) => {
    const e = loadEstimate(load(id))
    expect(e?.typical.value).toBeCloseTo(typical, 9)
    expect(e?.peak.value).toBeCloseTo(peak, 9)
    expect(e?.typical.provenance).toBe('estimate')
    expect(e?.peak.note).toBeTruthy()
  })
  it('gives nothing for a part outside the table', () => {
    expect(loadEstimate(load('relay-module-1ch-5v'))).toBeNull()
    expect(loadEstimate(load('resistor'))).toBeNull()
  })
})

describe('simOf', () => {
  it('reads electrical.sim, and is null without it', () => {
    const m = load('resistor')
    expect(simOf(m)).toBeNull()
    expect(simOf({ ...m, electrical: { ...(m.electrical as object), sim: { limits: [] } } })).toEqual({ limits: [] })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/estimates.test.ts`
Expected: FAIL, `./estimates.ts` cannot be found.

- [ ] **Step 3: Write the three files**

`src/format/simModel.ts`:

```ts
// Simulation data on a module (spec 3): every new simulation value lives under one optional
// object, `electrical.sim`, so nothing that exists changes (`electrical.params` and
// `electrical.ratings` keep their meaning). Types and the parsed view here; validateSim is added
// with the sourced data (Task 16). Pure, erasable TS (npm run validate runs it under Node).
import { type ModuleDef, isObj } from './module.ts'

export type Provenance = 'datasheet' | 'representative' | 'estimate'
export const PROVENANCES: readonly Provenance[] = ['datasheet', 'representative', 'estimate']
export type SimUnit = 'ohm' | 'V' | 'A' | 'W' | 'F' | '1'
/** One number with its unit and where it came from: provenance is per value, never per part. */
export interface Quantity { value: number; unit: SimUnit; source?: string; provenance: Provenance; note?: string }
export const LIMIT_KINDS = ['current', 'absMaxCurrent', 'power', 'vinMax', 'vinMin', 'sourceCurrent', 'ioTotalCurrent'] as const
export type LimitKind = (typeof LIMIT_KINDS)[number]
export interface Limit {
  of: { pin: string } | { domain: string } | { part: true }
  kind: LimitKind
  value: number
  source?: string
  provenance: Provenance
  conditions?: string
}
/** A named supply domain: a pin, its explicit return and a nominal voltage (spec 3.2). */
export interface PowerDomain { name: string; pin: string; ret: string; nominal: number }
export interface Draw { domain: string; typical: Quantity; peak?: Quantity & { note: string }; minVolts?: Quantity }
export const RAIL_KINDS = ['ldo', 'buck', 'boost', 'switch'] as const
export type RailKind = (typeof RAIL_KINDS)[number]
export interface Rail {
  id: string
  /** Several inputs: diode-OR (the highest wins) unless `direct`. */
  inputs: { domain: string; via: 'direct' | 'diode' }[]
  output: string
  kind: RailKind
  vout?: Quantity
  dropout?: Quantity
  iq?: Quantity
  ioutMax?: Quantity
  efficiency?: Quantity
  vinMin?: Quantity
  vinMax?: Quantity
  rout?: Quantity
  /** Output to input path. */
  reverse: 'blocks' | 'body-diode'
  /** Buck and boost only: input to output through the inductor and diode when disabled. */
  offPath?: 'open' | 'diode'
  minLoad?: { amps: Quantity; note: string }
  ron?: Quantity
  vf?: Quantity
}
export interface SourceSpec { domain: string; voltage: 'param:voltage' | Quantity; rInternal: Quantity; imax?: Quantity }
export interface PowerSpec { domains: PowerDomain[]; draw?: Draw[]; rails?: Rail[]; source?: SourceSpec }
export interface GpioSpec { domain: string; pins: string[]; outputResistance: Quantity; pullup?: Quantity; pulldown?: Quantity; inputLeakage?: Quantity }
export interface SimSpec {
  /** Physics: diode is, n, rs; rInternal; contactResistance; dcr. */
  modelParams?: Record<string, Quantity>
  limits?: Limit[]
  power?: PowerSpec
  gpio?: GpioSpec
  /** A USB pin's ground pin (spec 4.7). */
  usbPorts?: Record<string, { gnd: string }>
}

/** The module's `electrical.sim`, or null. Trusts validateModule (validateSim, Task 16). */
export function simOf(m: ModuleDef | undefined): SimSpec | null {
  const e = m?.electrical
  return isObj(e) && isObj(e.sim) ? (e.sim as SimSpec) : null
}
```

`src/sim/model.ts`:

```ts
// The engine-neutral circuit (spec 2): what build.ts makes from a sheet and spice.ts compiles. A
// Device keeps its component identity and its full values; reducing it for an analysis happens in
// the compiler. Node ids are net names (nameNets), `<ref>_<pin>` singletons, `<uid>:<pin>` pin taps
// (each behind a 0 V sense, ruling R19) and `<device id>#<name>` internal nodes. Pure types.
import type { Limit, LimitKind, Provenance, RailKind } from '../format/simModel.ts'
import type { GpioState } from '../format/simState.ts'

export type Basis = Provenance | 'user' | 'topology'
export type Corner = 'typical' | 'peak'
/** Only `op` in this slice; a union so transient can be added later (spec 2). */
export type Analysis = { kind: 'op'; corner: Corner }
/** A resolved number with its provenance and the label findings list it under ("led.D1.limits.current"). */
export interface Param { value: number; basis: Provenance | 'user'; label: string; note?: string }
export interface DiodeModel { is: number; n: number; rs: number }

export interface ResolvedRail {
  id: string
  kind: RailKind
  output: string
  inputs: string[]
  vout?: Param
  dropout?: Param
  iq: Param
  ioutMax?: Param
  efficiency?: Param
  vinMin?: Param
  vinMax?: Param
  rout: Param
  reverse: 'blocks' | 'body-diode'
  offPath: 'open' | 'diode'
  minLoad?: { amps: Param; note: string }
}

export type Device =
  | { kind: 'resistor'; id: string; part: string; a: string; b: string; ohms: Param; role: 'resistor' | 'contact' | 'cable' | 'gpio' | 'pull' | 'leak' | 'rail-input' | 'switch-rail' }
  | { kind: 'diode'; id: string; part: string; a: string; k: string; model: DiodeModel; role: 'led' | 'rail-input' | 'switch-rail' }
  | { kind: 'cell'; id: string; part: string; p: string; n: string; int: string; volts: Param; rInternal: Param; imax?: Param; role: 'cell' | 'external'; domain?: string }
  | { kind: 'capacitor'; id: string; part: string; a: string; b: string; farads: number }
  | { kind: 'load'; id: string; part: string; p: string; n: string; domain: string; typical: Param; peak: Param; peakNote?: string; minVolts: Param }
  | { kind: 'rail'; id: string; part: string; rail: ResolvedRail; in: string; inRet: string; out: string; ret: string; ctl: string; o: string; outDomain: string }

/** A part pin that carries a device: its net and the pin node behind the sense. */
export interface PinTap { part: string; pin: string; net: string; node: string }
export interface SimDomain { part: string; name: string; pin: string; ret: string; nominal: number }
/** A limit to check results against, resolved to a part. */
export interface ResolvedLimit { part: string; of: Limit['of']; kind: LimitKind | 'fuse'; value: Param; conditions?: string }
export interface GpioPin { part: string; pin: string; state: GpioState | null; domain: string; key: string }
/** A USB link that carries power: the cable's two conductor devices and the host port's limit. */
export interface UsbPath { host: string; hostPort: string; device: string; devicePort: string; vbus: string; gnd: string; limit: Param }
export interface SimPart { uid: string; ref: string; designator: string; module: string; name: string; model: string }

export interface Circuit {
  /** Every net and singleton node name, sorted. */
  nets: string[]
  taps: PinTap[]
  devices: Device[]
  /** Simulated parts by uid. */
  parts: Record<string, SimPart>
  domains: SimDomain[]
  limits: ResolvedLimit[]
  gpio: GpioPin[]
  usb: UsbPath[]
  /** Net of every node key the sheet joins (and every tapped pin), for probes and floating inputs. */
  pinNet: Record<string, string>
  /** Node keys on mains wiring: never in the solver (readings say so). */
  mains: string[]
  unsimulated: { part: string; reason: string }[]
  notes: string[]
}
```

`src/sim/estimates.ts`:

```ts
// The defaults and category estimates the simulator uses where a part gives no number (spec 3.1,
// 3.2, 3.4, 4.7). Each is flagged `estimate` (the cable `representative`), and each row is the one
// place to replace later. The fold-back below a load's minimum voltage is a modelling choice, not
// datasheet behaviour.
import type { ModuleDef } from '../format/module.ts'
import type { Quantity, SimUnit } from '../format/simModel.ts'

const est = (value: number, unit: SimUnit, note: string): Quantity => ({ value, unit, provenance: 'estimate', note })

export const CONTACT_OHMS = est(0.02, 'ohm', 'default contact resistance of a closed switch, jumper or fuse')
export const ROUT_DEFAULT = est(0.1, 'ohm', 'default regulator output resistance')
export const IQ_DEFAULT = est(0, 'A', 'quiescent current not given; taken as 0')
export const CABLE_OHMS: Quantity = { value: 0.1, unit: 'ohm', provenance: 'representative', note: 'one conductor of a typical 1 m USB cable (spec 4.7)' }
export const PLUG_OHMS = est(0.02, 'ohm', 'a plug pushed straight into a socket: contact resistance per conductor')
export const OR_DIODE_VF = est(0.35, 'V', 'Schottky OR diode, 0.35 V at 100 mA (modelling choice)')
/** A `direct` rail input (ruling R17): 1 milliohm, never 0. */
export const RAIL_DIRECT_OHMS = 0.001
/** A load's minimum voltage when its draw gives none: 90 % of its domain's nominal (spec 3.2). */
export const MIN_VOLTS_FRACTION = 0.9
/** The unsimulated reason sim-incomplete counts (spec 3.1). */
export const NO_POWER_DATA = 'no power data'

/** The voltage-keyed fallback for a battery without its own rInternal (spec 3.1 table). */
export function cellEstimate(nominal: number): { rInternal: Quantity; assumed: string } {
  if (nominal <= 3.0) return { rInternal: est(15, 'ohm', 'assumed a lithium coin cell'), assumed: 'lithium coin cell' }
  if (nominal === 9) return { rInternal: est(1.5, 'ohm', 'assumed an alkaline 9 V battery'), assumed: 'alkaline 9 V' }
  for (let k = 1; k <= 8; k++) {
    const per = nominal / k
    const cells = `${k} cell${k > 1 ? 's' : ''} in series`
    if (per >= 3.6 && per <= 4.2) return { rInternal: est(0.05 * k, 'ohm', `assumed Li-ion 18650, ${cells}, 0.05 ohm each`), assumed: 'Li-ion 18650' }
    if (per >= 1.2 && per <= 1.6) return { rInternal: est(0.15 * k, 'ohm', `assumed alkaline AA, ${cells}, 0.15 ohm each`), assumed: 'alkaline AA' }
  }
  return { rInternal: est(0.1, 'ohm', 'unknown chemistry: 0.1 ohm assumed'), assumed: 'unknown' }
}

export interface LoadEstimate { typical: Quantity; peak: Quantity & { note: string }; row: string }
const modelOf = (m: ModuleDef) => (m.electrical as { model?: unknown } | undefined)?.model
const C3_CLASS = /esp32-?c[36]|c3-supermini/
const ROWS: { row: string; match: (m: ModuleDef) => boolean; typical: number; peak: number; note: string }[] = [
  { row: 'mcu, ESP32/ESP32-S3 class', match: (m) => modelOf(m) === 'mcu' && m.id.includes('esp32') && !C3_CLASS.test(m.id), typical: 0.08, peak: 0.5, note: 'Wi-Fi transmit bursts' },
  { row: 'mcu, ESP32-C3/C6 class', match: (m) => modelOf(m) === 'mcu' && C3_CLASS.test(m.id), typical: 0.03, peak: 0.35, note: 'radio transmit bursts' },
  { row: 'mcu, AVR/RP2040 boards', match: (m) => modelOf(m) === 'mcu', typical: 0.025, peak: 0.06, note: 'every peripheral busy' },
  { row: 'display, OLED', match: (m) => modelOf(m) === 'display' && m.id.includes('oled'), typical: 0.015, peak: 0.04, note: 'all pixels on' },
  { row: 'display, TFT with backlight', match: (m) => modelOf(m) === 'display', typical: 0.06, peak: 0.12, note: 'backlight dominates' },
  { row: 'sensor, breakout', match: (m) => modelOf(m) === 'sensor' || modelOf(m) === 'breakout', typical: 0.002, peak: 0.01, note: 'measuring' },
  { row: 'radio', match: (m) => modelOf(m) === 'radio', typical: 0.03, peak: 0.25, note: 'transmit' },
]

/** The load a powered part draws by category (spec 3.4), or null outside the table. */
export function loadEstimate(m: ModuleDef): LoadEstimate | null {
  const r = ROWS.find((x) => x.match(m))
  if (!r) return null
  return {
    row: r.row,
    typical: est(r.typical, 'A', `category estimate: ${r.row}`),
    peak: { ...est(r.peak, 'A', `category estimate: ${r.row}`), note: r.note },
  }
}
```

`src/sim/model.ts` imports `GpioState` from `src/format/simState.ts`, which Task 8 fills in. Create that file now with only the type:

```ts
// Saved simulation state on a part (filled in by Task 8).
export type GpioState = 'input' | 'input-pullup' | 'input-pulldown' | 'high' | 'low'
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run src/sim/estimates.test.ts` then `npx tsc --noEmit`
Expected: PASS (21 tests), and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/format/simModel.ts src/format/simState.ts src/sim/model.ts src/sim/estimates.ts src/sim/estimates.test.ts
git commit -m "$(cat <<'MSG'
Sim: electrical.sim types, the engine-neutral circuit types and the flagged estimates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 7: LED colour models and diode fits

**Files:**
- Create: `src/sim/ledModels.ts`
- Test: `src/sim/ledModels.test.ts`

**Interfaces:**
- Consumes: `DiodeModel` (Task 6).
- Produces:
  - `const VT: number` (thermal voltage at 27 C, as ngspice uses), `const LED_FIT_AMPS = 0.02`
  - `interface LedColour { n: number; rs: number; shape: string; absMaxCurrent?: { value: number; source: string } }`
  - `const LED_COLOURS: Record<string, LedColour>` (red, green, yellow, orange, blue, white)
  - `function fitIs(v: number, i: number, n: number, rs: number): number`
  - `function diodeVoltage(m: DiodeModel, i: number): number`
  - `function ledModel(colour: string | undefined, forwardVoltage: number): { model: DiodeModel; colour: string; known: boolean }`
  - `const BODY_DIODE: DiodeModel`, `function schottky(vf: number, at?: number): DiodeModel`
  - `function ledHandCalc(volts: number, ohms: number, m: DiodeModel): { amps: number; anode: number }` (Newton, for tests)

- [ ] **Step 1: Write the failing test**

`src/sim/ledModels.test.ts`:

```ts
// Spec 4: each colour's model gives V = forwardVoltage at 20 mA (IS refitted, N and RS held), so
// forwardVoltage stays the user's knob. One test per colour.
import { describe, expect, it } from 'vitest'
import { BODY_DIODE, LED_COLOURS, diodeVoltage, fitIs, ledHandCalc, ledModel, schottky } from './ledModels.ts'

describe('LED colour models', () => {
  for (const colour of Object.keys(LED_COLOURS))
    it(`${colour}: V = forwardVoltage at 20 mA for 1.8, 2.0 and 3.1 V`, () => {
      for (const vf of [1.8, 2.0, 3.1]) {
        const { model, known } = ledModel(colour, vf)
        expect(known).toBe(true)
        expect(diodeVoltage(model, 0.02)).toBeCloseTo(vf, 9)
      }
    })
  it('fits red at 2.0 V to the spike model (IS about 94 pA with N 3.73, RS 7.5)', () => {
    const { model } = ledModel('red', 2.0)
    expect(model.n).toBe(3.73)
    expect(model.rs).toBe(7.5)
    expect(model.is).toBeCloseTo(9.4e-11, 12)
  })
  it('uses the red curve for a colour it does not know, and says so', () => {
    const r = ledModel('ultraviolet', 3.2)
    expect(r.known).toBe(false)
    expect(r.model.n).toBe(LED_COLOURS.red.n)
    expect(diodeVoltage(r.model, 0.02)).toBeCloseTo(3.2, 9)
  })
  it('hand-calculates LED + 150 ohm + 5 V: the anode sits at forwardVoltage (2.0 V) when 3 V drops across 150 ohm', () => {
    const h = ledHandCalc(5, 150, ledModel('red', 2.0).model)
    expect(h.anode).toBeCloseTo(2.0, 6)
    expect(h.amps).toBeCloseTo(0.02, 6)
  })
  it('fits a Schottky at 0.35 V and 100 mA, and a silicon body diode', () => {
    expect(diodeVoltage(schottky(0.35), 0.1)).toBeCloseTo(0.35, 9)
    expect(diodeVoltage(BODY_DIODE, 1)).toBeGreaterThan(0.6)
    expect(fitIs(0.35, 0.1, 1.05, 0)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/ledModels.test.ts`
Expected: FAIL, `./ledModels.ts` cannot be found.

- [ ] **Step 3: Write the models**

`src/sim/ledModels.ts`:

```ts
// LED and diode models (spec 4): an LED is a diode whose IS is refitted so V = forwardVoltage at
// 20 mA, with N and RS held per colour, so forwardVoltage stays the user's knob. This table is the
// one place per-colour data lives (ruling R12). Until Task 20 sources each colour, every colour
// carries the spike's red curve shape (an estimate) and no absolute maximum. Ruling R18: the body
// diode and the Schottky fit are modelling choices.
import type { DiodeModel } from './model.ts'

/** Thermal voltage at 27 C, the temperature ngspice solves at (TNOM). */
export const VT = (1.380649e-23 * 300.15) / 1.602176634e-19
export const LED_FIT_AMPS = 0.02

export interface LedColour {
  n: number
  rs: number
  /** Where N and RS come from. */
  shape: string
  /** From one representative 5 mm datasheet for the colour (`representative`, spec 3.4). */
  absMaxCurrent?: { value: number; source: string }
}
const SPIKE = 'the spike red LED curve (IS 93.2p, N 3.73, RS 7.5): an estimate of the shape'
export const LED_COLOURS: Record<string, LedColour> = {
  red: { n: 3.73, rs: 7.5, shape: SPIKE },
  green: { n: 3.73, rs: 7.5, shape: SPIKE },
  yellow: { n: 3.73, rs: 7.5, shape: SPIKE },
  orange: { n: 3.73, rs: 7.5, shape: SPIKE },
  blue: { n: 3.73, rs: 7.5, shape: SPIKE },
  white: { n: 3.73, rs: 7.5, shape: SPIKE },
}

/** The IS that puts the diode at `v` volts when `i` amps flow. */
export function fitIs(v: number, i: number, n: number, rs: number): number {
  return i / (Math.exp((v - i * rs) / (n * VT)) - 1)
}

export function diodeVoltage(m: DiodeModel, i: number): number {
  return m.n * VT * Math.log(i / m.is + 1) + i * m.rs
}

export function ledModel(colour: string | undefined, forwardVoltage: number): { model: DiodeModel; colour: string; known: boolean } {
  const key = (colour ?? 'red').trim().toLowerCase()
  const known = Object.hasOwn(LED_COLOURS, key)
  const c = known ? LED_COLOURS[key] : LED_COLOURS.red
  return { model: { is: fitIs(forwardVoltage, LED_FIT_AMPS, c.n, c.rs), n: c.n, rs: c.rs }, colour: known ? key : 'red', known }
}

/** A regulator's body diode: silicon (modelling choice). */
export const BODY_DIODE: DiodeModel = { is: 1e-12, n: 1, rs: 0.01 }

/** A Schottky with `vf` volts at `at` amps (N 1.05, no RS): OR inputs, off paths and `vf` switch rails. */
export function schottky(vf: number, at = 0.1): DiodeModel {
  return { is: fitIs(vf, at, 1.05, 0), n: 1.05, rs: 0 }
}

/** Newton on volts = I * ohms + V_diode(I): the test reference for an LED in series with a resistor. */
export function ledHandCalc(volts: number, ohms: number, m: DiodeModel): { amps: number; anode: number } {
  let i = 0.01
  for (let k = 0; k < 100; k++) {
    const f = i * (ohms + m.rs) + m.n * VT * Math.log(i / m.is + 1) - volts
    const df = ohms + m.rs + (m.n * VT) / (i + m.is)
    i -= f / df
  }
  return { amps: i, anode: volts - i * ohms }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/ledModels.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/ledModels.ts src/sim/ledModels.test.ts
git commit -m "$(cat <<'MSG'
Sim: LED colour models refitted to forwardVoltage at 20 mA, and the diode fits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 8: Saved switch and GPIO state, overrides, and the single-state mains evaluation

**Files:**
- Modify: `src/format/simState.ts` (fill in), `src/format/diagram.ts:1465-1510` (the `values` loop), `src/agent/netlist.ts:65-75` (`valueErrors`) and its call site (`errors.push(...valueErrors(p.values, ...))`), `src/format/mainsRules.ts` (new export at the end)
- Test: `src/format/simState.test.ts`

**Interfaces:**
- Consumes: `mainsOf`, `ContactKind`, `Pole` (`mainsModel.ts`); `pinCaps`, `PinCaps`, `isObj`, `isNum` (`module.ts`); `simOf` (Task 6); `buildMainsGraph`, `prepare`, `analyseState`, `MAX_SOURCES`, `GGroup` (`mainsGraph.ts`); `inputState`, `UNPOWERED`, `ConverterStatus` (`mainsRules.ts`).
- Produces (`src/format/simState.ts`):
  - `type ContactPosition = 'open' | 'closed' | 'no' | 'nc'`, `type GpioState`, `const GPIO_STATES`, `const GPIO_CYCLE: readonly GpioState[]` (`input`, `high`, `low`)
  - `interface SwitchGroup { id: string; kind: ContactKind; poles: Pole[]; changeover: boolean; momentary: boolean }`
  - `function switchGroups(m: ModuleDef): SwitchGroup[]`
  - `function contactPosition(part: { values?: Record<string, unknown> }, m: ModuleDef, g: SwitchGroup, held?: boolean): ContactPosition`
  - `const isActive: (pos: ContactPosition) => boolean`
  - `function closedPairs(g: SwitchGroup, pos: ContactPosition): [string, string][]`
  - `function gpioState(part: { values?: Record<string, unknown> }, m: ModuleDef, pin: string): GpioState | null`
  - `function gpioProblem(caps: PinCaps | undefined, v: string): string | null`
  - `function isSimValueKey(key: string): boolean`
  - `function simValueProblem(key: string, entry: unknown, m: ModuleDef | undefined): { text: string; electrical: boolean } | null`
  - `function simOverride(part: { values?: Record<string, unknown> }, key: string): number | null`
- Produces (`src/format/mainsRules.ts`): `function convertersInState(d: Diagram, active: (part: PartInstance, groupId: string) => boolean): Map<string, ConverterStatus>`

- [ ] **Step 1: Write the failing tests**

`src/format/simState.test.ts`:

```ts
// Spec 3.3, 3.5, 4.0 and 4.6: saved switch positions and GPIO states, the loader and netlist checks,
// and the single-state mains evaluation that decides whether an AC-DC converter is powered now.
import { describe, expect, it } from 'vitest'
import type { Diagram, PartInstance } from './diagram.ts'
import { VALUE_DROPPED, validateDiagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { closedPairs, contactPosition, gpioState, isActive, simOverride, simValueProblem, switchGroups } from './simState.ts'
import { convertersInState } from './mainsRules.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'

/** A two-GPIO board: IO1 any state, IO2 input only, IO3 output only, IO4 with no pulls. */
const board: ModuleDef = {
  format: 'circuitoon-module/1', id: 'test-gpio-board', name: 'GPIO board',
  pins: [
    { name: '3V3', side: 'left', type: 'power_in' }, { name: 'GND', side: 'left', type: 'ground' },
    { name: 'IO1', side: 'right', type: 'io' }, { name: 'IO2', side: 'right', type: 'io', caps: { inputOnly: true } },
    { name: 'IO3', side: 'right', type: 'io', caps: { outputOnly: true } }, { name: 'IO4', side: 'right', type: 'io', caps: { noPullup: true } },
  ],
  electrical: {
    model: 'mcu',
    sim: {
      power: { domains: [{ name: '3V3', pin: '3V3', ret: 'GND', nominal: 3.3 }], draw: [{ domain: '3V3', typical: { value: 0.01, unit: 'A', provenance: 'estimate', note: 't' } }] },
      gpio: { domain: '3V3', pins: ['IO1', 'IO2', 'IO3', 'IO4'], outputResistance: { value: 30, unit: 'ohm', provenance: 'estimate', note: 't' } },
    },
  },
}
const part = (values: Record<string, unknown>): PartInstance => ({ uid: 'u1', designator: 'U1', module: 'x', x: 0, y: 0, values })

describe('switch groups and saved positions (spec 4.0)', () => {
  it('reads declared groups and gives contact-less switches the implicit group "s" (ruling R2)', () => {
    expect(switchGroups(load('rocker-switch-kcd1'))).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }], changeover: false, momentary: false }])
    expect(switchGroups(load('push-button'))).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }], changeover: false, momentary: true }])
    expect(switchGroups(load('tilt-switch-sw520d'))[0].momentary).toBe(false)
    expect(switchGroups(load('relay-module-1ch-5v'))[0]).toMatchObject({ id: 'k', kind: 'relay', changeover: true })
  })
  it('defaults to open (nc for a changeover), reads contact.<id>, maps legacy values.state, and keeps relays at rest', () => {
    const kcd1 = load('rocker-switch-kcd1')
    const [g] = switchGroups(kcd1)
    expect(contactPosition(part({}), kcd1, g)).toBe('open')
    expect(contactPosition(part({ 'contact.s': 'closed' }), kcd1, g)).toBe('closed')
    expect(contactPosition(part({ state: 'on' }), kcd1, g)).toBe('closed')
    expect(contactPosition(part({ state: 'sideways' }), kcd1, g)).toBe('open')
    const relay = load('relay-module-1ch-5v')
    expect(contactPosition(part({ 'contact.k': 'no' }), relay, switchGroups(relay)[0])).toBe('nc')
  })
  it('closes a momentary button only while held, never from a saved value', () => {
    const b = load('push-button')
    const [g] = switchGroups(b)
    expect(contactPosition(part({ 'contact.s': 'closed' }), b, g)).toBe('open')
    expect(contactPosition(part({}), b, g, true)).toBe('closed')
  })
  it('conducts com to no when active and com to nc at rest', () => {
    const [g] = switchGroups(load('relay-module-1ch-5v'))
    expect(closedPairs(g, 'nc')).toEqual([['COM', 'NC']])
    expect(closedPairs(g, 'no')).toEqual([['COM', 'NO']])
    expect(isActive('closed') && !isActive('open')).toBe(true)
  })
})

describe('GPIO state (spec 3.3, 4.6)', () => {
  it('defaults to input, reads gpio.<pin>, and refuses states the caps forbid', () => {
    expect(gpioState(part({}), board, 'IO1')).toBe('input')
    expect(gpioState(part({ 'gpio.IO1': 'high' }), board, 'IO1')).toBe('high')
    expect(gpioState(part({ 'gpio.IO2': 'high' }), board, 'IO2')).toBe('input')
    expect(gpioState(part({}), board, 'IO3')).toBeNull()
    expect(gpioState(part({ 'gpio.IO3': 'low' }), board, 'IO3')).toBe('low')
    expect(gpioState(part({ 'gpio.IO4': 'input-pulldown' }), board, 'IO4')).toBe('input')
    expect(gpioState(part({}), board, '3V3')).toBeNull()
  })
  it('names what is wrong with a stored state or override', () => {
    expect(simValueProblem('gpio.IO2', 'high', board)?.text).toContain('input only')
    expect(simValueProblem('gpio.IO3', 'input', board)?.text).toContain('output only')
    expect(simValueProblem('gpio.IO4', 'input-pullup', board)?.text).toContain('no internal pull-up or pull-down')
    expect(simValueProblem('gpio.GND', 'high', board)?.text).toContain('not a GPIO pin')
    expect(simValueProblem('gpio.IO1', 'sideways', board)?.text).toContain('must be one of')
    expect(simValueProblem('contact.s', 'closed', load('push-button'))?.text).toContain('momentary')
    expect(simValueProblem('contact.k', 'no', load('relay-module-1ch-5v'))?.text).toContain('at rest')
    expect(simValueProblem('contact.s', 'no', load('rocker-switch-kcd1'))?.text).toContain('"open" or "closed"')
    expect(simValueProblem('sim.draw.3V3.typical', { value: 0.05, unit: 'A' }, board)).toBeNull()
    expect(simValueProblem('sim.draw.5V.typical', { value: 0.05, unit: 'A' }, board)?.electrical).toBe(true)
    expect(simValueProblem('sim.rInternal', { value: 0.08, unit: 'ohm' }, load('battery-18650-holder'))).toBeNull()
    expect(simValueProblem('sim.rInternal', { value: -1, unit: 'ohm' }, load('battery-18650-holder'))?.electrical).toBe(true)
    expect(simValueProblem('sim.other', 1, board)?.text).toContain('unknown')
    expect(simOverride(part({ 'sim.imax': { value: 2, unit: 'A' } }), 'sim.imax')).toBe(2)
  })
})

describe('the loader and the netlist parser (ruling R24)', () => {
  const sheet = (values: Record<string, unknown>): Diagram => ({ format: 'circuitoon-diagram/1', title: 't', modules: { 'test-gpio-board': board }, parts: [{ uid: 'u1', designator: 'U1', module: 'test-gpio-board', x: 0, y: 0, values }], connections: [] })
  it('drops a bad GPIO state with a plain warning, and a bad sim override with the dropped-value ending', () => {
    const r = validateDiagram(sheet({ 'gpio.IO2': 'high', 'sim.draw.3V3.typical': { value: 'x', unit: 'A' }, 'gpio.IO1': 'low' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.parts[0].values).toEqual({ 'gpio.IO1': 'low' })
    expect(r.warnings.some((w) => w.includes('gpio.IO2') && !w.endsWith(VALUE_DROPPED))).toBe(true)
    expect(r.warnings.some((w) => w.includes('sim.draw.3V3.typical') && w.endsWith(VALUE_DROPPED))).toBe(true)
  })
  it('refuses a bad state in a netlist', () => {
    const r = parseNetlist({ format: 'circuitoon-netlist/1', title: 't', parts: [{ ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'no' } }], nets: [] }, libraryLookup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('parts[0].values.contact.s')
  })
})

describe('single-state converter availability (spec 4 table)', () => {
  // A US outlet's L through a KCD1 rocker to an HLK-PM01's AC 1, and N straight to AC 2.
  const mods = Object.fromEntries(['outlet-us-5-15r-duplex', 'rocker-switch-kcd1', 'hlk-pm01'].map((id) => [id, load(id)]))
  const d = (values: Record<string, unknown>): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules: mods,
    parts: [
      { uid: 'o1', designator: 'J1', module: 'outlet-us-5-15r-duplex', x: 0, y: 0 },
      { uid: 's1', designator: 'S1', module: 'rocker-switch-kcd1', x: 300, y: 0, values },
      { uid: 'p1', designator: 'PS1', module: 'hlk-pm01', x: 600, y: 0 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'o1', pin: 'L1' }, to: { part: 's1', pin: '1' } },
      { uid: 'w2', from: { part: 's1', pin: '2' }, to: { part: 'p1', pin: 'AC 1' } },
      { uid: 'w3', from: { part: 'o1', pin: 'N1' }, to: { part: 'p1', pin: 'AC 2' } },
    ],
  })
  const active = (sheet: Diagram) => (p: PartInstance, id: string) => {
    const m = sheet.modules[p.module]
    const g = switchGroups(m).find((x) => x.id === id)
    return !!g && isActive(contactPosition(p, m, g))
  }
  it('is powered with the rocker saved closed, and unpowered with it open', () => {
    const on = d({ 'contact.s': 'closed' })
    expect(convertersInState(on, active(on)).get('p1')?.state).toBe('powered')
    const off = d({})
    expect(convertersInState(off, active(off)).get('p1')?.state).not.toBe('powered')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/format/simState.test.ts`
Expected: FAIL, `switchGroups` (and the others) are not exported.

- [ ] **Step 3: Write `src/format/simState.ts`**

Replace the one-line stub with:

```ts
// Saved simulation state on a part (spec 3.3, 3.5, 4.0, 4.6): switch positions under
// `values["contact.<groupId>"]`, GPIO states under `values["gpio.<pin>"]`, and the additive
// overrides `sim.draw.<domain>.typical|peak`, `sim.rInternal` and `sim.imax`. Reading with
// defaults, and the checks the loader (diagram.ts) and the netlist parser use. Pure.
import { type ModuleDef, type PinCaps, isNum, isObj, pinCaps } from './module.ts'
import { type ContactKind, type Pole, mainsOf } from './mainsModel.ts'
import { simOf } from './simModel.ts'

export type ContactPosition = 'open' | 'closed' | 'no' | 'nc'
export type GpioState = 'input' | 'input-pullup' | 'input-pulldown' | 'high' | 'low'
export const GPIO_STATES: readonly GpioState[] = ['input', 'input-pullup', 'input-pulldown', 'high', 'low']
/** What a click on a GPIO pin steps through while simulating (spec 6.3); the inspector has all states. */
export const GPIO_CYCLE: readonly GpioState[] = ['input', 'high', 'low']
export interface SwitchGroup { id: string; kind: ContactKind; poles: Pole[]; changeover: boolean; momentary: boolean }

const modelOf = (m: ModuleDef) => (isObj(m.electrical) ? m.electrical.model : undefined)
const words = (list: readonly string[]) => list.map((s) => `"${s}"`).join(', ')

/** Every contact group: `electrical.contacts`, or ruling R2's implicit group "s" on a switch with terminals a and b. */
export function switchGroups(m: ModuleDef): SwitchGroup[] {
  const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
  const momentary = params.normallyOpen !== undefined
  const declared = mainsOf(m).contacts
  if (declared.length)
    return declared.map((g) => ({ id: g.id, kind: g.kind, poles: g.poles, changeover: g.poles.some((p) => p.no !== null && p.nc !== null), momentary: momentary && g.kind === 'switch' }))
  const t = isObj(m.electrical) && isObj(m.electrical.terminals) ? m.electrical.terminals : null
  if (modelOf(m) !== 'switch' || !t || typeof t.a !== 'string' || typeof t.b !== 'string') return []
  return [{ id: 's', kind: 'switch', poles: [{ com: t.a, no: t.b, nc: null }], changeover: false, momentary }]
}

const LEGACY_CLOSED = new Set(['on', 'closed', 'pressed'])
const LEGACY_OPEN = new Set(['off', 'open', 'released'])
const positions = (g: SwitchGroup): ContactPosition[] => (g.changeover ? ['no', 'nc'] : ['open', 'closed'])
/** A position that is not the rest one: com joins no. Index 1 of the mains model's groupState. */
export const isActive = (pos: ContactPosition): boolean => pos === 'closed' || pos === 'no'

/**
 * A group's position now: `values["contact.<id>"]`; else, on a one-group switch, the legacy
 * `values.state` (ruling R3); else the rest position (open, or nc for a changeover), which is the
 * mains model's groupState 0. Relays and SSRs are always at rest (ruling R4); a momentary button
 * is active only while `held` (never saved).
 */
export function contactPosition(part: { values?: Record<string, unknown> }, m: ModuleDef, g: SwitchGroup, held?: boolean): ContactPosition {
  const rest: ContactPosition = g.changeover ? 'nc' : 'open'
  const active: ContactPosition = g.changeover ? 'no' : 'closed'
  if (g.kind !== 'switch') return rest
  if (g.momentary) return held ? active : rest
  const v = part.values?.[`contact.${g.id}`]
  if (typeof v === 'string' && (positions(g) as string[]).includes(v)) return v as ContactPosition
  const legacy = part.values?.state
  if (switchGroups(m).length === 1 && typeof legacy === 'string') {
    if (LEGACY_CLOSED.has(legacy)) return active
    if (LEGACY_OPEN.has(legacy)) return rest
  }
  return rest
}

/** The terminal pairs that conduct at a position: com to no when active, com to nc at rest. */
export function closedPairs(g: SwitchGroup, pos: ContactPosition): [string, string][] {
  const act = isActive(pos)
  return g.poles.flatMap((p): [string, string][] => {
    const to = act ? p.no : p.nc
    return to ? [[p.com, to]] : []
  })
}

/** Why a GPIO state is not allowed on a pin with these caps (spec 3.3), or null. */
export function gpioProblem(caps: PinCaps | undefined, v: string): string | null {
  if (!(GPIO_STATES as readonly string[]).includes(v)) return `must be one of ${words(GPIO_STATES)}`
  if (caps?.inputOnly && (v === 'high' || v === 'low')) return 'the pin is input only, so it cannot drive high or low'
  if (caps?.outputOnly && v.startsWith('input')) return 'the pin is output only, so it cannot be an input'
  if (caps?.noPullup && (v === 'input-pullup' || v === 'input-pulldown')) return 'the pin has no internal pull-up or pull-down'
  return null
}

/** A GPIO pin's state: its admissible saved state, else "input"; null for an output-only pin with none set (open) and for a pin that is not GPIO-capable. */
export function gpioState(part: { values?: Record<string, unknown> }, m: ModuleDef, pin: string): GpioState | null {
  if (!simOf(m)?.gpio?.pins.includes(pin)) return null
  const caps = pinCaps(m, pin)
  const v = part.values?.[`gpio.${pin}`]
  if (typeof v === 'string' && gpioProblem(caps, v) === null) return v as GpioState
  return caps?.outputOnly ? null : 'input'
}

export const isSimValueKey = (key: string): boolean => key.startsWith('gpio.') || key.startsWith('contact.') || key.startsWith('sim.')

const amount = (entry: unknown, unit: 'A' | 'ohm', allowZero: boolean): string | null =>
  isObj(entry) && isNum(entry.value) && entry.unit === unit && (allowZero ? entry.value >= 0 : entry.value > 0) && entry.value <= 1e6
    ? null
    : `it must be { "value": <number ${allowZero ? '0 or more' : 'above 0'}>, "unit": "${unit}" }`

/**
 * What is wrong with one simulation value on a part, or null. `electrical` marks a `sim.*`
 * number (dropping it changes the solved circuit: the loader ends its warning with VALUE_DROPPED).
 * With no module to check against (not embedded), nothing is claimed.
 */
export function simValueProblem(key: string, entry: unknown, m: ModuleDef | undefined): { text: string; electrical: boolean } | null {
  if (!m) return null
  if (key.startsWith('gpio.')) {
    const pin = key.slice(5)
    if (!simOf(m)?.gpio?.pins.includes(pin)) return { text: `pin "${pin}" is not a GPIO pin of ${m.name}`, electrical: false }
    if (typeof entry !== 'string') return { text: `it must be one of ${words(GPIO_STATES)}`, electrical: false }
    const p = gpioProblem(pinCaps(m, pin), entry)
    return p ? { text: p, electrical: false } : null
  }
  if (key.startsWith('contact.')) {
    const g = switchGroups(m).find((x) => x.id === key.slice(8))
    if (!g) return { text: `${m.name} has no contact group "${key.slice(8)}"`, electrical: false }
    if (g.kind !== 'switch') return { text: `a ${g.kind} is always shown at rest`, electrical: false }
    if (g.momentary) return { text: 'it is a momentary button; its position is never saved', electrical: false }
    const allowed = positions(g)
    return typeof entry === 'string' && (allowed as string[]).includes(entry) ? null : { text: `it must be ${allowed.map((s) => `"${s}"`).join(' or ')}`, electrical: false }
  }
  const sim = simOf(m)
  const isCell = isObj(m.electrical) && m.electrical.model === 'voltage_source'
  if (key === 'sim.rInternal' || key === 'sim.imax') {
    if (!isCell && !sim?.power?.source) return { text: `${m.name} is not a battery or supply`, electrical: true }
    const p = amount(entry, key === 'sim.imax' ? 'A' : 'ohm', false)
    return p ? { text: p, electrical: true } : null
  }
  const draw = /^sim\.draw\.(.+)\.(typical|peak)$/.exec(key)
  if (draw) {
    if (!sim?.power?.domains.some((d) => d.name === draw[1])) return { text: `${m.name} has no supply domain "${draw[1]}"`, electrical: true }
    const p = amount(entry, 'A', true)
    return p ? { text: p, electrical: true } : null
  }
  return { text: 'unknown simulation value (sim.draw.<domain>.typical, sim.draw.<domain>.peak, sim.rInternal or sim.imax)', electrical: true }
}

/** A `sim.*` override's number (validated on load), or null. */
export function simOverride(part: { values?: Record<string, unknown> }, key: string): number | null {
  const v = part.values?.[key]
  return isObj(v) && isNum(v.value) ? v.value : null
}
```

- [ ] **Step 4: Hook the checks into the loader and the netlist parser**

In `src/format/diagram.ts`, add the import:

```ts
import { isSimValueKey, simValueProblem, switchGroups } from './simState.ts'
```

and at the top of the `for (const [key, entry] of Object.entries(p.values))` loop body (before `if (Object.hasOwn(PARAM_RULES, key))`), insert:

```ts
            // Simulation state and overrides (spec 3.5, 4.0, 4.6; ruling R24): a bad one is dropped.
            if (isSimValueKey(key)) {
              const problem = simValueProblem(key, entry, typeof p.module === 'string' ? modules.get(p.module) : undefined)
              if (problem) {
                dropped.push(key)
                warnings.push(`${at}.values.${key}: ${who} has ${key} ${JSON.stringify(entry)}, but ${problem.text}; ${problem.electrical ? VALUE_DROPPED : 'it was dropped, so the default state is used'}`)
              }
              continue
            }
            // A legacy switch state that is not a position (ruling R3) keeps the default, said once.
            if (key === 'state' && typeof p.module === 'string') {
              const sm = modules.get(p.module)
              const groups = sm ? switchGroups(sm) : []
              if (groups.length > 1 || (groups.length === 1 && !['on', 'closed', 'pressed', 'off', 'open', 'released'].includes(String(entry))))
                warnings.push(`${at}.values.state: ${who}'s state ${JSON.stringify(entry)} is not a switch position the simulator can read, so the switch is simulated open`)
            }
```

In `src/agent/netlist.ts`, import `isSimValueKey, simValueProblem` from `../format/simState.ts`, change `valueErrors` to take the module and check simulation values, and pass the module at its call site:

```ts
function valueErrors(values: Record<string, unknown>, at: string, m: ModuleDef): string[] {
  const out: string[] = []
  for (const [key, entry] of Object.entries(values)) {
    if (isSimValueKey(key)) {
      const p = simValueProblem(key, entry, m)
      if (p) out.push(`${at}.${key}: ${p.text}`)
      continue
    }
    if (!Object.hasOwn(PARAM_RULES, key)) continue
    const rule = PARAM_RULES[key]
    if (!(isObj(entry) && isNum(entry.value) && entry.unit === rule.unit && validParamValue(key, entry.value)))
      out.push(`${at}.${key}: must be { "value": <number>, "unit": "${rule.unit}" } within ${rule.range}`)
  }
  return out
}
```

```ts
        errors.push(...valueErrors(p.values, `${at}.values`, m))
```

- [ ] **Step 5: Add the single-state mains evaluation**

In `src/format/mainsRules.ts`, extend the imports (`analyseState`, `buildMainsGraph`, `prepare`, `MAX_SOURCES` from `./mainsGraph.ts`; `plugsOf` from `./breadboard.ts`; `netlist` from `./netlist.ts`; `type Diagram` from `./diagram.ts`) and append:

```ts
/**
 * Converter availability in one contact state, the saved one, by part uid (live-simulation spec,
 * section 4 table): the spec section 1 availability rules applied to the state `active` gives
 * each contact group, instead of aggregated over every state. A sheet past MAX_SOURCES is not
 * judged: every converter is unknown, as in the enumeration.
 */
export function convertersInState(d: Diagram, active: (part: PartInstance, groupId: string) => boolean): Map<string, ConverterStatus> {
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))
  if (!g) return new Map()
  const p = prepare(g)
  if (p.sources.length > MAX_SOURCES) return new Map(g.converters.map((c) => [c.part.uid, notChecked(c)]))
  for (const gi of p.groupIdx) p.groupState[gi] = active(g.groups[gi].part, g.groups[gi].def.id) ? 1 : 0
  analyseState(p)
  return new Map(g.converters.map((c, i) => [c.part.uid, p.converterIdx.includes(i) ? inputState(p, c) : UNPOWERED]))
}
```

- [ ] **Step 6: Run the tests, then the suites that cover the touched files**

Run: `npx vitest run src/format/simState.test.ts src/format/diagram.test.ts src/agent/netlist.test.ts src/format/mainsRules.test.ts`
Expected: PASS. Existing loader and netlist tests are unchanged in behaviour (no existing value uses these keys).

- [ ] **Step 7: Commit**

```bash
git add src/format/simState.ts src/format/simState.test.ts src/format/diagram.ts src/agent/netlist.ts src/format/mainsRules.ts
git commit -m "$(cat <<'MSG'
Sim: saved switch positions, GPIO states and overrides, their checks, and single-state converter availability

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 9: One net naming for extract and the simulator

**Files:**
- Modify: `src/agent/extract.ts:37-87` (split the net collection out of `extractNetlist`)
- Test: `src/agent/extract.test.ts` (add one test)

**Interfaces:**
- Consumes: `netlist`, `nodeKey` (`netlist.ts`), `nameNets` (`netNames.ts`), existing extract helpers.
- Produces:
  - `interface SheetNet { name: string; keys: string[]; pins: { ref: string; name: string; m: ModuleDef }[]; label?: string }`
  - `function sheetNets(d: Diagram): { refOf: Map<string, string>; kept: PartInstance[]; nets: SheetNet[]; netlist: Netlist }`, where `keys` are the node keys of the `netlist()` net the named net came from, `refOf` maps kept part uids to their refs, and `netlist` is the `netlist(d)` it used.

- [ ] **Step 1: Write the failing test**

Append to `src/agent/extract.test.ts` (import `sheetNets` from `./extract.ts` and the existing `ledNetlist` and `layoutNetlist` helpers the file already uses; if it does not import them, add `import { ledNetlist } from './fixtures.testing.ts'` and `import { layoutNetlist } from './layout.ts'`):

```ts
describe('sheetNets (shared with the simulator, spec 2)', () => {
  it('names each net exactly as extract does, with the netlist() node keys it came from', () => {
    const laid = layoutNetlist(ledNetlist())
    if (!laid.ok) throw new Error(laid.errors.join('; '))
    const d = laid.value.diagram
    const s = sheetNets(d)
    const extracted = extractNetlist(d) as { nets: { name: string }[] }
    expect(s.nets.map((n) => n.name).sort()).toEqual(extracted.nets.map((n) => n.name).sort())
    const gnd = s.nets.find((n) => n.name === 'GND')!
    expect(gnd.keys).toContain(JSON.stringify(['D1', 'K']))
    expect(s.netlist.nets.some((keys) => keys.every((k) => gnd.keys.includes(k)))).toBe(true)
    expect(s.refOf.get('BT1')).toBe('BT1')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/agent/extract.test.ts`
Expected: FAIL, `sheetNets` is not exported.

- [ ] **Step 3: Refactor**

In `src/agent/extract.ts`, move everything in `extractNetlist` from the `modOf` helper through `const named = nameNets(nets)` into a new exported function, keeping the code as it is and recording each net's source keys:

```ts
export interface SheetNet { name: string; keys: string[]; pins: { ref: string; name: string; m: ModuleDef }[]; label?: string }

/**
 * The nets extract writes, named by nameNets, each with the node keys of the netlist() net it came
 * from (spec 2: the simulator names its nodes from this, so net:GND means the same net in the CLI,
 * extract, KiCad and the simulator).
 */
export function sheetNets(d: Diagram): { refOf: Map<string, string>; kept: PartInstance[]; nets: SheetNet[]; netlist: Netlist } {
  // ... the existing body, unchanged, from `const modOf = ...` to the loop over n.nets ...
  // In that loop, push `keys` with each net:
  //   nets.push({ pins: [...pins, ...strips].sort(order), keys, ...(label !== undefined ? { label } : {}) })
  const named = nameNets(nets)
  return { refOf, kept, netlist: n, nets: nets.map((net, i) => ({ ...net, name: named[i]! })) }
}
```

Concretely: the local `nets` array's element type becomes `{ pins: Pin[]; keys: string[]; label?: string }`, and the push inside `for (const keys of n.nets)` adds `keys`. Import `type Netlist` from `../format/netlist.ts`. Then `extractNetlist` starts with:

```ts
export function extractNetlist(d: Diagram): Record<string, unknown> {
  const modOf = (uid: string) => {
    const p = d.parts.find((x) => x.uid === uid)
    return p ? moduleOf(d, p.module) : undefined
  }
  const { refOf, kept, nets, netlist: n } = sheetNets(d)
  const named = nets.map((x) => x.name)
```

and the rest of `extractNetlist` (colours, ends, custom modules, output) is unchanged; it already reads `nets[i].pins`, `named[i]` and `n`.

- [ ] **Step 4: Run the extract tests and the netlist command tests**

Run: `npx vitest run src/agent/extract.test.ts src/cli/netlistCmd.test.ts src/format/kicad.test.ts`
Expected: PASS, with every existing extract and KiCad golden unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/agent/extract.ts src/agent/extract.test.ts
git commit -m "$(cat <<'MSG'
Extract: sheetNets names nets once for extract and the simulator

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 10: Build a circuit from a sheet: nets, taps and primitives

**Files:**
- Create: `src/sim/build.ts`, `src/sim/testing.ts`
- Test: `src/sim/build.test.ts`

**Interfaces:**
- Consumes: `sheetNets` (Task 9); `switchGroups`, `contactPosition`, `closedPairs`, `simOverride` (Task 8); `simOf`, `Quantity` (Task 6); `ledModel`, `LED_COLOURS` (Task 7); `CONTACT_OHMS`, `cellEstimate`, `NO_POWER_DATA` (Task 6); `analyseMainsCached` (`mains.ts`); `mainsOf` (`mainsModel.ts`); `paramValue` (`values.ts`); `partSetting`, `isBoard`, `isNetLabel`, `isSpacer`, `isObj`, `isNum` (`module.ts`); `nodeKey` (`netlist.ts`); `naturalCompare` (`agent/order.ts`).
- Produces:
  - `interface BuildOptions { held?: { part: string; group: string } | null }`
  - `function buildCircuit(d: Diagram, opts?: BuildOptions): Circuit`
  - `class Builder` (used by `power.ts`, Task 11) with: `d`, `ref(uid: string): string`, `node(uid: string, pin: string): string | null`, `tap(uid: string, pin: string): string | null`, `add(dev: Device): void`, `param(q: Quantity, label: string): Param`, `user(value: number, label: string): Param`, `skip(uid: string, reason: string): void`, `unsimulated(uid: string, reason: string): void`, `note(text: string): void`, `limit(l: ResolvedLimit): void`, `domain(x: SimDomain): void`, `gpio(x: GpioPin): void`, `usbPath(x: UsbPath): void`, `partLimits(p: PartInstance, m: ModuleDef): void`, `converterPowered(uid: string): boolean`, `modulesOf(uid: string): ModuleDef | undefined`
  - `src/sim/testing.ts`: `sheet(parts: PartSpec[], wires: [string, string][]): Diagram`, `type PartSpec`, `q(value, unit, provenance?)`, `cellModule(volts: number, rInternal: number): ModuleDef`, `ldoModule(opts?)`, `buckModule(opts?)`, `boostModule(opts?)`, `boardModule(opts?)`, `hostModule()` (the last four are used from Task 11 on)

- [ ] **Step 1: Write the test helper**

`src/sim/testing.ts`:

```ts
// Small sheets for the simulator's tests: parts from the built-in library (by id) or inline modules,
// wired pin to pin with "uid.pin" ends. The inline modules carry only what the simulator reads.
import type { Connection, Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef, PinDef } from '../format/module.ts'
import type { Provenance, Quantity, Rail, SimUnit } from '../format/simModel.ts'
import { load } from '../format/builtinModules.testing.ts'

export type PartSpec = { uid: string; module: string | ModuleDef; designator?: string; values?: Record<string, unknown>; settings?: Record<string, string> }

export function sheet(parts: PartSpec[], wires: [string, string][]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  const insts: PartInstance[] = parts.map((p, i) => {
    const m = typeof p.module === 'string' ? load(p.module) : p.module
    modules[m.id] = m
    return {
      uid: p.uid, designator: p.designator ?? p.uid.toUpperCase(), module: m.id, x: (i % 6) * 400, y: Math.floor(i / 6) * 400,
      ...(p.values ? { values: p.values } : {}), ...(p.settings ? { settings: p.settings } : {}),
    }
  })
  const end = (s: string) => ({ part: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) })
  const connections: Connection[] = wires.map(([a, b], i) => ({ uid: `w${i + 1}`, from: end(a), to: end(b) }))
  return { format: 'circuitoon-diagram/1', title: 'test', modules, parts: insts, connections }
}

/** A Quantity with a source (or, for an estimate, a note). */
export const q = (value: number, unit: SimUnit, provenance: Provenance = 'datasheet'): Quantity =>
  provenance === 'estimate' ? { value, unit, provenance, note: 'test value' } : { value, unit, provenance, source: 'https://example.com/test-datasheet' }

const pins = (list: (Omit<PinDef, 'side'> & { side?: PinDef['side'] })[]): PinDef[] => list.map((p, i) => ({ side: i % 2 ? 'right' : 'left', ...p }))
const mod = (id: string, p: PinDef[], electrical: Record<string, unknown>): ModuleDef => ({ format: 'circuitoon-module/1', id, name: id, pins: p, electrical })

/** A cell with its own rInternal (stable across the library's sourced battery data). */
export function cellModule(volts: number, rInternal: number, id = 'test-cell'): ModuleDef {
  return mod(id, pins([{ name: '+', type: 'power_out' }, { name: '-', type: 'ground' }]), {
    model: 'voltage_source', terminals: { pos: '+', neg: '-' }, params: { voltage: { unit: 'V', default: volts } },
    sim: { modelParams: { rInternal: q(rInternal, 'ohm', 'representative') }, limits: [{ of: { part: true }, kind: 'sourceCurrent', value: 2, provenance: 'representative', source: 'https://example.com/cell' }] },
  })
}

type RailOpts = Partial<Rail>
const regulator = (id: string, inNominal: number, outNominal: number, rail: Rail): ModuleDef =>
  mod(id, pins([{ name: 'IN', type: 'power_in' }, { name: 'OUT', type: 'power_out' }, { name: 'GND', type: 'ground' }]), {
    model: 'regulator',
    sim: { power: { domains: [{ name: 'IN', pin: 'IN', ret: 'GND', nominal: inNominal }, { name: 'OUT', pin: 'OUT', ret: 'GND', nominal: outNominal }], rails: [rail] } },
  })

/** A 3.3 V LDO: dropout 1.1 V, 0.8 A, iq 5 mA. */
export function ldoModule(o: RailOpts = {}, id = 'test-ldo'): ModuleDef {
  return regulator(id, 5, 3.3, { id: 'ldo', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'ldo', vout: q(3.3, 'V'), dropout: q(1.1, 'V'), ioutMax: q(0.8, 'A'), iq: q(0.005, 'A'), reverse: 'blocks', ...o })
}
/** A 5 V buck: 6 to 24 V in, 90 % efficient, 2 A. */
export function buckModule(o: RailOpts = {}, id = 'test-buck'): ModuleDef {
  return regulator(id, 12, 5, { id: 'buck', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'buck', vout: q(5, 'V'), efficiency: q(0.9, '1'), vinMin: q(6, 'V'), vinMax: q(24, 'V'), ioutMax: q(2, 'A'), reverse: 'blocks', ...o })
}
/** A 5 V boost from one Li-ion cell: 2.9 to 4.3 V in, 90 %, 2 A, pass-through diode when off. */
export function boostModule(o: RailOpts = {}, id = 'test-boost'): ModuleDef {
  return regulator(id, 3.7, 5, { id: 'boost', inputs: [{ domain: 'IN', via: 'direct' }], output: 'OUT', kind: 'boost', vout: q(5, 'V'), efficiency: q(0.9, '1'), vinMin: q(2.9, 'V'), vinMax: q(4.3, 'V'), ioutMax: q(2, 'A'), reverse: 'blocks', offPath: 'diode', ...o })
}

/**
 * A DevKit-like board: VIN and USB VBUS (through a 0.3 V Schottky) feed a 3.3 V LDO; the 3V3
 * domain draws 50 mA typical (250 mA peak, "radio"); IO1 and IO2 are GPIOs (30 ohm, 45 k pulls).
 */
export function boardModule(o: { draw?: boolean; minVolts?: number } = {}, id = 'test-board'): ModuleDef {
  return mod(id, pins([
    { name: 'VIN', type: 'power_in' }, { name: 'GND', type: 'ground' }, { name: '3V3', type: 'power_out' },
    { name: 'IO1', type: 'io' }, { name: 'IO2', type: 'io' },
    { name: 'USB', type: 'usb', usb: { connector: 'micro-B', gender: 'receptacle', role: 'device' } },
  ]), {
    model: 'mcu',
    sim: {
      usbPorts: { USB: { gnd: 'GND' } },
      power: {
        domains: [{ name: 'VIN', pin: 'VIN', ret: 'GND', nominal: 5 }, { name: 'USB', pin: 'USB#vbus', ret: 'USB#gnd', nominal: 5 }, { name: '3V3', pin: '3V3', ret: 'GND', nominal: 3.3 }],
        ...(o.draw === false ? {} : { draw: [{ domain: '3V3', typical: q(0.05, 'A'), peak: { ...q(0.25, 'A'), note: 'radio' }, ...(o.minVolts ? { minVolts: q(o.minVolts, 'V') } : {}) }] }),
        rails: [
          { id: 'usb-diode', inputs: [{ domain: 'USB', via: 'direct' }], output: 'VIN', kind: 'switch', vf: q(0.3, 'V'), reverse: 'blocks' },
          { id: 'ldo', inputs: [{ domain: 'VIN', via: 'direct' }], output: '3V3', kind: 'ldo', vout: q(3.3, 'V'), dropout: q(1.1, 'V'), ioutMax: q(0.8, 'A'), iq: q(0.005, 'A'), reverse: 'blocks' },
        ],
      },
      gpio: { domain: '3V3', pins: ['IO1', 'IO2'], outputResistance: q(30, 'ohm'), pullup: q(45000, 'ohm'), pulldown: q(45000, 'ohm') },
      limits: [
        { of: { pin: 'IO1' }, kind: 'current', value: 0.02, provenance: 'datasheet', source: 'https://example.com/board' },
        { of: { pin: 'IO1' }, kind: 'absMaxCurrent', value: 0.04, provenance: 'datasheet', source: 'https://example.com/board' },
        { of: { domain: '3V3' }, kind: 'ioTotalCurrent', value: 0.1, provenance: 'datasheet', source: 'https://example.com/board' },
      ],
    },
  })
}

/** A computer's USB-A port: a 5 V supply with 50 milliohm and a 500 mA limit, ground only on the port (ruling R5). */
export function hostModule(id = 'test-host'): ModuleDef {
  return mod(id, pins([{ name: 'USB', type: 'usb', usb: { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', source: 500 } }]), {
    model: 'computer',
    sim: { power: { domains: [{ name: 'USB', pin: 'USB#vbus', ret: 'USB#gnd', nominal: 5 }], source: { domain: 'USB', voltage: q(5, 'V'), rInternal: q(0.05, 'ohm', 'estimate'), imax: q(0.5, 'A') } } },
  })
}
```

- [ ] **Step 2: Write the failing build test**

`src/sim/build.test.ts`:

```ts
// Spec 2 and 4: the circuit build. Every terminal of every simulated part; nets named as extract
// names them; singletons `<ref>_<pin>`; a 0 ohm resistor, a closed switch and a fuse are real
// contact branches; open switches and buttons add nothing; relays sit at rest; capacitors are
// emitted; mains nodes stay out; the build is deterministic.
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { cellModule, sheet } from './testing.ts'
import type { Device } from './model.ts'

const kinds = (devs: Device[]) => devs.map((d) => `${d.kind}:${d.id}`)

describe('buildCircuit: primitives', () => {
  const ledSheet = sheet(
    [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
    [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
  )
  it('names nets as extract does and taps every pin that carries a device', () => {
    const c = buildCircuit(ledSheet)
    expect(c.nets).toEqual(['BT1_+', 'D1_A', 'GND'])
    expect(c.taps.map((t) => `${t.node}@${t.net}`)).toEqual(['bt1:+@BT1_+', 'bt1:-@GND', 'd1:A@D1_A', 'd1:K@GND', 'r1:1@BT1_+', 'r1:2@D1_A'])
    expect(kinds(c.devices)).toEqual(['cell:bt1.cell', 'diode:d1.led', 'resistor:r1.r'])
    expect(c.pinNet[JSON.stringify(['d1', 'A'])]).toBe('D1_A')
  })
  it('compiles the cell with its own rInternal, the LED from forwardVoltage, and the legacy LED limit', () => {
    const c = buildCircuit(ledSheet)
    const cell = c.devices.find((d) => d.kind === 'cell')!
    expect(cell.kind === 'cell' && [cell.volts.value, cell.volts.basis, cell.rInternal.value, cell.rInternal.basis]).toEqual([5, 'user', 1e-6, 'representative'])
    const led = c.devices.find((d) => d.kind === 'diode')!
    expect(led.kind === 'diode' && led.model.is).toBeCloseTo(9.4e-11, 12)
    expect(c.limits.filter((l) => l.part === 'd1').map((l) => [l.kind, l.value.value, l.value.basis, l.value.label])).toEqual([['current', 0.02, 'representative', 'led.D1.maxCurrent']])
  })
  it('makes a 0 ohm resistor a contact branch, never R = 0', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(3, 0.1) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 0, unit: 'ohm' } } }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    const r = c.devices.find((d) => d.kind === 'resistor')!
    expect(r.kind === 'resistor' && [r.role, r.ohms.value, r.ohms.basis]).toEqual(['contact', 0.02, 'estimate'])
  })
  it('splits a potentiometer at its position, at least 1 ohm each side', () => {
    const c = buildCircuit(sheet([{ uid: 'p1', module: 'potentiometer', values: { position: 0.25 } }], []))
    expect(c.devices.map((d) => d.kind === 'resistor' && d.ohms.value)).toEqual([2500, 7500])
    const end = buildCircuit(sheet([{ uid: 'p1', module: 'potentiometer', values: { position: 0 } }], []))
    expect(end.devices.map((d) => d.kind === 'resistor' && d.ohms.value)).toEqual([1, 10000])
  })
  it('closes a switch only in its saved position, and a button only while held', () => {
    const open = buildCircuit(sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], []))
    expect(open.devices).toEqual([])
    const closed = buildCircuit(sheet([{ uid: 's1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }], []))
    expect(kinds(closed.devices)).toEqual(['resistor:s1.s.1'])
    const b = sheet([{ uid: 'b1', module: 'push-button' }], [])
    expect(buildCircuit(b).devices).toEqual([])
    expect(kinds(buildCircuit(b, { held: { part: 'b1', group: 's' } }).devices)).toEqual(['resistor:b1.s.1'])
  })
  it('shows a relay at rest (NC closed) with a note', () => {
    const c = buildCircuit(sheet([{ uid: 'k1', module: 'relay-module-1ch-5v' }], []))
    const r = c.devices.find((d) => d.kind === 'resistor')!
    expect(r.kind === 'resistor' && [r.a, r.b]).toEqual(['k1:COM', 'k1:NC'])
    expect(c.notes.join(' ')).toContain('K1: shown at rest')
  })
  it('emits a capacitor, and names a singleton pin <ref>_<pin>', () => {
    const c = buildCircuit(sheet([{ uid: 'c1', module: 'capacitor-ceramic' }], []))
    expect(c.devices[0]).toMatchObject({ kind: 'capacitor', a: 'c1:1', b: 'c1:2', farads: 1e-7 })
    expect(c.taps.map((t) => t.net)).toEqual(['C1_1', 'C1_2'])
  })
  it('lists a powered part with no power data, and keeps conductors and boards out', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: 'bme280-module-4pin' }, { uid: 'bb1', module: 'breadboard-half' }, { uid: 'j1', module: 'jst-xh-2' }], []))
    expect(c.unsimulated).toEqual([{ part: 'u1', reason: 'no power data' }])
    expect(Object.keys(c.parts)).toEqual([])
  })
  it('is deterministic whatever the part order', () => {
    const a = buildCircuit(ledSheet)
    const b = buildCircuit({ ...ledSheet, parts: [...ledSheet.parts].reverse() })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run src/sim/build.test.ts`
Expected: FAIL, `./build.ts` cannot be found.

- [ ] **Step 4: Write the builder**

`src/sim/build.ts`:

```ts
// Diagram to Circuit (spec 2, 4): every terminal of every simulated part (singleton pins
// included), nets named exactly as extract names them (sheetNets, ruling: one naming), other
// nodes `<ref>_<pin>`, mains nodes left out (spec 2.1), and each part compiled by its electrical
// model. Boards and modules with `electrical.sim.power` go through power.ts. Pure and
// deterministic: parts in uid order, devices in id order.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { type ModuleDef, isBoard, isNetLabel, isNum, isObj, isSpacer, partSetting } from '../format/module.ts'
import { nodeKey } from '../format/netlist.ts'
import { analyseMainsCached } from '../format/mains.ts'
import { convertersInState } from '../format/mainsRules.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { type Quantity, simOf } from '../format/simModel.ts'
import { closedPairs, contactPosition, isActive, simOverride, switchGroups } from '../format/simState.ts'
import { paramValue } from '../format/values.ts'
import { sheetNets } from '../agent/extract.ts'
import { naturalCompare } from '../agent/order.ts'
import { CONTACT_OHMS, NO_POWER_DATA, cellEstimate } from './estimates.ts'
import { LED_COLOURS, ledModel } from './ledModels.ts'
import type { Circuit, Device, GpioPin, Param, PinTap, ResolvedLimit, SimDomain, SimPart, UsbPath } from './model.ts'
import { powerPart, usbLinks } from './power.ts'

export interface BuildOptions { held?: { part: string; group: string } | null }

const modelOf = (m: ModuleDef): string => (isObj(m.electrical) && typeof m.electrical.model === 'string' ? m.electrical.model : '')
const terminals = (m: ModuleDef): Record<string, string> => {
  const t = isObj(m.electrical) && isObj(m.electrical.terminals) ? m.electrical.terminals : {}
  return Object.fromEntries(Object.entries(t).filter((x): x is [string, string] => typeof x[1] === 'string'))
}
/** A number param outside PARAM_RULES (forwardVoltage, maxCurrent): a stored { value } override, else the module default. */
function numParam(part: PartInstance, m: ModuleDef, name: string): number | null {
  const stored = part.values?.[name]
  if (isObj(stored) && isNum(stored.value)) return stored.value
  const p = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params[name] : undefined
  return isObj(p) && isNum(p.default) ? p.default : null
}
const hasPowerPin = (m: ModuleDef) => [...m.pins, ...(m.holes ?? [])].some((p) => !('spacer' in p && isSpacer(p)) && 'type' in p && p.type === 'power_in')

export class Builder {
  d: Diagram
  private opts: BuildOptions
  private mainsKeys: Set<string>
  private netOfKey = new Map<string, string>()
  private names = new Set<string>()
  private refOf: Map<string, string>
  private tapsByKey = new Map<string, PinTap>()
  private devices: Device[] = []
  private parts: Record<string, SimPart> = {}
  private domains: SimDomain[] = []
  private limits: ResolvedLimit[] = []
  private gpios: GpioPin[] = []
  private usb: UsbPath[] = []
  private unsim: { part: string; reason: string }[] = []
  private notes: string[] = []
  private converters: Map<string, { state: string }> | null = null

  constructor(d: Diagram, opts: BuildOptions) {
    this.d = d
    this.opts = opts
    this.mainsKeys = analyseMainsCached(d)?.mainsKeys ?? new Set()
    const sn = sheetNets(d)
    this.refOf = sn.refOf
    for (const net of sn.nets) {
      this.names.add(net.name)
      for (const k of net.keys) this.netOfKey.set(k, net.name)
    }
    // netlist() nets extract does not write (one component pin and a strip, say) get the name of
    // their first component pin; every key of a net shares the name.
    for (const keys of sn.netlist.nets) {
      const named = keys.find((k) => this.netOfKey.has(k))
      const name = named ? this.netOfKey.get(named)! : this.fresh(this.firstComponent(keys))
      for (const k of keys) this.netOfKey.set(k, name)
    }
  }

  ref(uid: string): string {
    return this.refOf.get(uid) ?? this.d.parts.find((p) => p.uid === uid)?.designator ?? uid
  }

  modulesOf(uid: string): ModuleDef | undefined {
    const p = this.d.parts.find((x) => x.uid === uid)
    return p ? moduleOf(this.d, p.module) : undefined
  }

  private firstComponent(keys: string[]): [string, string] {
    const pins = keys.map((k) => JSON.parse(k) as [string, string])
    const real = pins.filter(([uid]) => {
      const m = this.modulesOf(uid)
      return m && !isBoard(m) && !isNetLabel(m)
    })
    return (real.length ? real : pins).sort((a, b) => naturalCompare(this.ref(a[0]), this.ref(b[0])) || naturalCompare(a[1], b[1]))[0]
  }

  private fresh([uid, pin]: [string, string]): string {
    const base = `${this.ref(uid)}_${pin}`
    let name = base
    for (let k = 2; this.names.has(name); k++) name = `${base}_${k}`
    this.names.add(name)
    return name
  }

  /** The net a part pin is on (named on first use for a singleton); null on mains wiring. */
  node(uid: string, pin: string): string | null {
    const key = nodeKey(uid, pin)
    if (this.mainsKeys.has(key)) return null
    let net = this.netOfKey.get(key)
    if (!net) {
      net = this.fresh([uid, pin])
      this.netOfKey.set(key, net)
    }
    return net
  }

  /** The pin node behind the pin's 0 V sense (ruling R19), made on first use; null on mains wiring. */
  tap(uid: string, pin: string): string | null {
    const key = nodeKey(uid, pin)
    const hit = this.tapsByKey.get(key)
    if (hit) return hit.node
    const net = this.node(uid, pin)
    if (!net) return null
    const t: PinTap = { part: uid, pin, net, node: `${uid}:${pin}` }
    this.tapsByKey.set(key, t)
    return t.node
  }

  add(dev: Device): void {
    this.devices.push(dev)
  }
  param(q: Quantity, label: string): Param {
    return { value: q.value, basis: q.provenance, label, ...(q.note ? { note: q.note } : {}) }
  }
  user(value: number, label: string): Param {
    return { value, basis: 'user', label }
  }
  /** The part is not simulated at all. */
  skip(uid: string, reason: string): void {
    delete this.parts[uid]
    this.devices = this.devices.filter((x) => x.part !== uid)
    this.unsim.push({ part: uid, reason })
  }
  /** One path or pin of a simulated part is not simulated (ruling R7, an unset output-only pin). */
  unsimulated(uid: string, reason: string): void {
    this.unsim.push({ part: uid, reason })
  }
  note(text: string): void {
    this.notes.push(text)
  }
  limit(l: ResolvedLimit): void {
    this.limits.push(l)
  }
  domain(x: SimDomain): void {
    this.domains.push(x)
  }
  gpio(x: GpioPin): void {
    this.gpios.push(x)
  }
  usbPath(x: UsbPath): void {
    this.usb.push(x)
  }

  /** The module's sim.limits, as resolved limits of the part (spec 3.1). */
  partLimits(p: PartInstance, m: ModuleDef, skipKinds: string[] = []): void {
    for (const l of simOf(m)?.limits ?? []) {
      if (skipKinds.includes(l.kind)) continue
      const what = 'pin' in l.of ? l.of.pin : 'domain' in l.of ? l.of.domain : 'part'
      this.limit({
        part: p.uid, of: l.of, kind: l.kind, ...(l.conditions ? { conditions: l.conditions } : {}),
        value: { value: l.value, basis: l.provenance, label: `${m.id}.${this.ref(p.uid)}.limits.${l.kind}.${what}` },
      })
    }
  }

  /** Whether an AC-DC converter's mains input is powered in the saved contact state (spec 4 table). */
  converterPowered(uid: string): boolean {
    if (!this.converters) {
      this.converters = convertersInState(this.d, (part, groupId) => {
        const m = moduleOf(this.d, part.module)
        const g = m && switchGroups(m).find((x) => x.id === groupId)
        return !!m && !!g && isActive(contactPosition(part, m, g, this.isHeld(part.uid, groupId)))
      })
    }
    return this.converters.get(uid)?.state === 'powered'
  }

  private isHeld(uid: string, group: string): boolean {
    return this.opts.held?.part === uid && this.opts.held.group === group
  }

  private contactOhms(p: PartInstance, m: ModuleDef): Param {
    const q = simOf(m)?.modelParams?.contactResistance
    return this.param(q ?? CONTACT_OHMS, `${m.id}.${this.ref(p.uid)}.contactResistance`)
  }

  private contact(p: PartInstance, m: ModuleDef, id: string, x: string, y: string): void {
    const a = this.tap(p.uid, x)
    const b = this.tap(p.uid, y)
    if (a && b) this.add({ kind: 'resistor', id, part: p.uid, a, b, ohms: this.contactOhms(p, m), role: 'contact' })
  }

  part(p: PartInstance): void {
    const m = moduleOf(this.d, p.module)
    if (!m) return this.unsimulated(p.uid, 'its module is not embedded in the sheet')
    if (isNetLabel(m) || isBoard(m)) return
    const model = modelOf(m)
    // Connectors, breadboard strips and Wago blocks are one conductor in netlist() already (spec 4 table).
    if (model === 'connector') return
    const ref = this.ref(p.uid)
    this.parts[p.uid] = { uid: p.uid, ref, designator: p.designator, module: m.id, name: m.name, model }
    const t = terminals(m)
    const label = (path: string) => `${m.id}.${ref}.${path}`
    switch (model) {
      case 'resistor': {
        const a = this.tap(p.uid, t.a)
        const b = this.tap(p.uid, t.b)
        const ohms = paramValue(p, m, 'resistance') ?? 0
        if (a && b) this.add({ kind: 'resistor', id: `${p.uid}.r`, part: p.uid, a, b, ohms: ohms === 0 ? this.contactOhms(p, m) : this.user(ohms, label('resistance')), role: ohms === 0 ? 'contact' : 'resistor' })
        return this.partLimits(p, m)
      }
      case 'potentiometer': {
        const total = paramValue(p, m, 'resistance') ?? 10000
        const raw = p.values?.position
        const pos = isNum(raw) && raw >= 0 && raw <= 1 ? raw : 0.5
        const a = this.tap(p.uid, t.a)
        const w = this.tap(p.uid, t.wiper)
        const b = this.tap(p.uid, t.b)
        if (a && w) this.add({ kind: 'resistor', id: `${p.uid}.aw`, part: p.uid, a, b: w, ohms: this.user(Math.max(1, total * pos), label('resistance')), role: 'resistor' })
        if (w && b) this.add({ kind: 'resistor', id: `${p.uid}.wb`, part: p.uid, a: w, b, ohms: this.user(Math.max(1, total * (1 - pos)), label('resistance')), role: 'resistor' })
        return this.partLimits(p, m)
      }
      case 'led': {
        const a = this.tap(p.uid, t.anode)
        const k = this.tap(p.uid, t.cathode)
        const params = isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {}
        const colourDefault = isObj(params.color) && typeof params.color.default === 'string' ? params.color.default : 'red'
        const colour = typeof p.values?.color === 'string' ? p.values.color : colourDefault
        const fit = ledModel(colour, numParam(p, m, 'forwardVoltage') ?? 2)
        if (!fit.known) this.note(`${ref}: no LED model for the colour "${colour}"; a red LED's curve is used`)
        if (a && k) this.add({ kind: 'diode', id: `${p.uid}.led`, part: p.uid, a, k, model: fit.model, role: 'led' })
        const sim = simOf(m)?.limits ?? []
        // Spec 3.1: sim.limits wins; else the legacy params.maxCurrent, read as `representative`.
        const legacy = numParam(p, m, 'maxCurrent')
        if (!sim.some((l) => l.kind === 'current') && legacy !== null)
          this.limit({ part: p.uid, of: { part: true }, kind: 'current', value: { value: legacy, basis: 'representative', label: label('maxCurrent') } })
        const abs = LED_COLOURS[fit.colour].absMaxCurrent
        if (!sim.some((l) => l.kind === 'absMaxCurrent') && abs && fit.known)
          this.limit({ part: p.uid, of: { part: true }, kind: 'absMaxCurrent', value: { value: abs.value, basis: 'representative', label: `led-colours.${fit.colour}.absMaxCurrent` } })
        return this.partLimits(p, m)
      }
      case 'voltage_source': {
        const plus = this.tap(p.uid, t.pos)
        const minus = this.tap(p.uid, t.neg)
        const volts = paramValue(p, m, 'voltage') ?? 0
        const sim = simOf(m)
        const rOver = simOverride(p, 'sim.rInternal')
        const rInternal = rOver !== null ? this.user(rOver, label('rInternal')) : this.param(sim?.modelParams?.rInternal ?? cellEstimate(volts).rInternal, label('rInternal'))
        const iOver = simOverride(p, 'sim.imax')
        const limit = sim?.limits?.find((l) => l.kind === 'sourceCurrent')
        const imax = iOver !== null ? this.user(iOver, label('imax')) : limit ? { value: limit.value, basis: limit.provenance, label: label('limits.sourceCurrent') } : undefined
        const id = `${p.uid}.cell`
        if (plus && minus) this.add({ kind: 'cell', id, part: p.uid, p: plus, n: minus, int: `${id}#int`, volts: this.user(volts, label('voltage')), rInternal, ...(imax ? { imax } : {}), role: 'cell' })
        return this.partLimits(p, m)
      }
      case 'capacitor': {
        const a = this.tap(p.uid, t.a)
        const b = this.tap(p.uid, t.b)
        if (a && b) this.add({ kind: 'capacitor', id: `${p.uid}.c`, part: p.uid, a, b, farads: paramValue(p, m, 'capacitance') ?? 1e-7 })
        return
      }
      case 'fuse': {
        if (partSetting(p, m, 'fuse') !== 'absent') for (const [i, e] of mainsOf(m).protective.entries()) this.contact(p, m, `${p.uid}.fuse.${i + 1}`, e.from, e.to)
        const rating = paramValue(p, m, 'fuseRating')
        if (rating !== null) this.limit({ part: p.uid, of: { part: true }, kind: 'fuse', value: this.user(rating, label('fuseRating')) })
        return
      }
      case 'switch':
      case 'relay':
      case 'ssr': {
        for (const g of switchGroups(m)) {
          const pos = contactPosition(p, m, g, this.isHeld(p.uid, g.id))
          closedPairs(g, pos).forEach(([x, y], i) => this.contact(p, m, `${p.uid}.${g.id}.${i + 1}`, x, y))
          if (g.kind !== 'switch') this.note(`${ref}: shown at rest; coil switching is simulated with firmware`)
        }
        // The coil (or any electronics) is a load only when the module has sim.power (spec 4 table); powerPart adds the limits then.
        if (simOf(m)?.power) return powerPart(this, p, m)
        return this.partLimits(p, m)
      }
    }
    if (simOf(m)?.power) return powerPart(this, p, m)
    if (mainsOf(m).any) return this.skip(p.uid, 'mains wiring is not simulated')
    this.skip(p.uid, hasPowerPin(m) ? NO_POWER_DATA : 'no simulation model')
  }

  done(): Circuit {
    // Pins within a part by code point ("+" before "-"), so the order never depends on a collator.
    const taps = [...this.tapsByKey.values()].sort((a, b) => naturalCompare(a.part, b.part) || (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0))
    const devices = [...this.devices].sort((a, b) => naturalCompare(a.part, b.part) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const pinNet: Record<string, string> = {}
    for (const [k, net] of [...this.netOfKey].sort((a, b) => (a[0] < b[0] ? -1 : 1))) pinNet[k] = net
    return {
      nets: [...new Set(taps.map((t) => t.net))].sort(),
      taps,
      devices,
      parts: Object.fromEntries(Object.entries(this.parts).sort((a, b) => naturalCompare(a[0], b[0]))),
      domains: this.domains,
      limits: this.limits,
      gpio: this.gpios,
      usb: this.usb,
      pinNet,
      mains: [...this.mainsKeys].sort(),
      unsimulated: this.unsim,
      notes: [...new Set(this.notes)],
    }
  }
}

export function buildCircuit(d: Diagram, opts: BuildOptions = {}): Circuit {
  const b = new Builder(d, opts)
  for (const p of [...d.parts].sort((x, y) => naturalCompare(x.uid, y.uid))) b.part(p)
  usbLinks(b, d)
  return b.done()
}
```

`build.ts` imports `powerPart` and `usbLinks` from `power.ts`, which Task 11 writes. So that this task builds on its own, create `src/sim/power.ts` now as:

```ts
// Boards and modules with electrical.sim.power (Task 11 fills this in).
import type { Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import type { Builder } from './build.ts'

export function powerPart(b: Builder, p: PartInstance, _m: ModuleDef): void {
  b.skip(p.uid, 'power models arrive in Task 11')
}
export function usbLinks(_b: Builder, _d: Diagram): void {}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/sim/build.test.ts`
Expected: PASS (10 tests). If a net name differs from the test's expectation, run `extractNetlist` on the same sheet and compare: the build must agree with extract, so fix the build, not the test, unless extract itself disagrees.

- [ ] **Step 6: Commit**

```bash
git add src/sim/build.ts src/sim/power.ts src/sim/testing.ts src/sim/build.test.ts
git commit -m "$(cat <<'MSG'
Sim: build a circuit from a sheet (nets as extract names them, pin taps, primitives, contacts at their saved state)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 11: Boards and modules: domains, loads, rails, GPIO, sources and USB

**Files:**
- Modify: `src/sim/power.ts` (replace the stub)
- Test: `src/sim/power.test.ts`

**Interfaces:**
- Consumes: `Builder` (Task 10); `simOf`, `Rail`, `Quantity` (Task 6); `gpioState`, `simOverride` (Task 8); `loadEstimate`, `ROUT_DEFAULT`, `IQ_DEFAULT`, `CABLE_OHMS`, `PLUG_OHMS`, `OR_DIODE_VF`, `RAIL_DIRECT_OHMS`, `MIN_VOLTS_FRACTION` (Task 6); `schottky` (Task 7); `usbLink`, `usbSides`, `DEFAULT_SOURCE` (`usb.ts`); `mainsOf`; `paramValue`; `nodeKey`.
- Produces: `function powerPart(b: Builder, p: PartInstance, m: ModuleDef): void`, `function usbLinks(b: Builder, d: Diagram): void`, `function railProblem(r: Rail): string | null` (required fields per kind, spec 3.2; Task 16's validation reuses it).

- [ ] **Step 1: Write the failing test**

`src/sim/power.test.ts`:

```ts
// Spec 3.2, 3.3, 4.6, 4.7: a board's domains, its draw as a voltage-aware load, its rails with the
// spec's defaults, its GPIO states, an external source, the USB cable between a host and a device,
// and the cases that are not simulated (hub, host without data, incomplete rail).
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { boardModule, cellModule, hostModule, ldoModule, q, sheet } from './testing.ts'
import type { Device } from './model.ts'
import type { ModuleDef } from '../format/module.ts'
import { load } from '../format/builtinModules.testing.ts'

const byId = (devs: Device[], id: string) => devs.find((d) => d.id === id)

describe('power models', () => {
  it('records domains, a voltage-aware load with the 90 % minVolts default, and both rails with defaults', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule() }], []))
    expect(c.domains.map((d) => `${d.name}:${d.pin}/${d.ret}`)).toEqual(['VIN:u1:VIN/u1:GND', 'USB:u1:USB#vbus/u1:GND', '3V3:u1:3V3/u1:GND'])
    const load3 = byId(c.devices, 'u1.draw.3V3')!
    expect(load3.kind === 'load' && [load3.typical.value, load3.peak.value, load3.peakNote, load3.minVolts.value, load3.minVolts.basis]).toEqual([0.05, 0.25, 'radio', 0.9 * 3.3, 'estimate'])
    const ldo = byId(c.devices, 'u1.rail.ldo')!
    expect(ldo.kind === 'rail' && [ldo.in, ldo.out, ldo.ret, ldo.rail.rout.value, ldo.rail.rout.basis, ldo.rail.offPath]).toEqual(['u1.rail.ldo#in', 'u1:3V3', 'u1:GND', 0.1, 'estimate', 'open'])
    expect(byId(c.devices, 'u1.rail.ldo.in.VIN')).toMatchObject({ kind: 'resistor', role: 'rail-input', a: 'u1:VIN', b: 'u1.rail.ldo#in' })
    expect(byId(c.devices, 'u1.rail.usb-diode')).toMatchObject({ kind: 'diode', role: 'switch-rail', k: 'u1:VIN' })
  })
  it('takes a user override of the draw, marked user', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.12, unit: 'A' } } }], []))
    const l = byId(c.devices, 'u1.draw.3V3')!
    expect(l.kind === 'load' && [l.typical.value, l.typical.basis]).toEqual([0.12, 'user'])
  })
  it('uses the category estimate on a board with domains and no draw', () => {
    const m: ModuleDef = { ...boardModule({ draw: false }), id: 'test-esp32-board' }
    const c = buildCircuit(sheet([{ uid: 'u1', module: m }], []))
    const l = byId(c.devices, 'u1.draw.VIN')!
    expect(l.kind === 'load' && [l.typical.value, l.typical.basis]).toEqual([0.08, 'estimate'])
  })
  it('compiles GPIO states from the real IO domain node (spec 4.6)', () => {
    const c = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high', 'gpio.IO2': 'input-pulldown' } }], []))
    expect(byId(c.devices, 'u1.gpio.IO1')).toMatchObject({ kind: 'resistor', role: 'gpio', a: 'u1:3V3', b: 'u1:IO1' })
    expect(byId(c.devices, 'u1.gpio.IO2')).toMatchObject({ kind: 'resistor', role: 'pull', a: 'u1:IO2', b: 'u1:GND' })
    expect(c.gpio.map((g) => `${g.pin}:${g.state}`)).toEqual(['IO1:high', 'IO2:input-pulldown'])
    const low = buildCircuit(sheet([{ uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'low' } }], []))
    expect(byId(low.devices, 'u1.gpio.IO1')).toMatchObject({ a: 'u1:IO1', b: 'u1:GND' })
  })
  it('joins a host and a device by a cable on both conductors, with the host port limit', () => {
    const c = buildCircuit(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']]))
    expect(byId(c.devices, 'h1.source')).toMatchObject({ kind: 'cell', role: 'external', p: 'h1:USB#vbus', n: 'h1:USB#gnd' })
    expect(byId(c.devices, 'usb.w1.vbus')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'h1:USB#vbus', b: 'u1:USB#vbus' })
    expect(byId(c.devices, 'usb.w1.gnd')).toMatchObject({ kind: 'resistor', role: 'cable', a: 'h1:USB#gnd', b: 'u1:GND' })
    expect(c.usb).toEqual([expect.objectContaining({ host: 'h1', device: 'u1', limit: expect.objectContaining({ value: 0.5, basis: 'datasheet' }) })])
  })
  it('does not simulate USB power from a host with no power data, or through a hub (ruling R7)', () => {
    const c = buildCircuit(sheet([{ uid: 'j1', module: 'computer-usb-port' }, { uid: 'u1', module: boardModule() }], [['j1.USB', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered from J1 over USB, which has no power data' })
    // P1 is a downstream (host-role) port of the hub.
    const h = buildCircuit(sheet([{ uid: 'x1', module: 'usb-hub-powered-4port' }, { uid: 'u1', module: boardModule() }], [['x1.P1', 'u1.USB']]))
    expect(h.unsimulated).toContainEqual({ part: 'u1', reason: 'powered through a hub: not simulated yet' })
  })
  it('lists a part whose rail lacks a required field, naming it (spec 3.1)', () => {
    const bad = ldoModule({ dropout: undefined }, 'test-bad-ldo')
    const c = buildCircuit(sheet([{ uid: 'u1', module: bad }, { uid: 'bt1', module: cellModule(5, 0.1) }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'incomplete power data: rail ldo needs dropout' })
  })
  it('lists an output-only GPIO with no state set as not simulated (spec 3.3)', () => {
    const m = boardModule()
    const outOnly: ModuleDef = { ...m, id: 'test-out-only', pins: m.pins.map((p) => ('name' in p && p.name === 'IO2' ? { ...p, caps: { outputOnly: true as const } } : p)) }
    const c = buildCircuit(sheet([{ uid: 'u1', module: outOnly }], []))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'pin IO2: output-only pin with no state set' })
  })
  it('takes the AC-DC converter output as a source only when powered in the saved state', () => {
    const hlk = load('hlk-pm01')
    const withSource: ModuleDef = { ...hlk, electrical: { ...(hlk.electrical as object), sim: { power: { domains: [{ name: 'OUT', pin: '+Vo', ret: '-Vo', nominal: 5 }], source: { domain: 'OUT', voltage: q(5, 'V'), rInternal: q(0.1, 'ohm', 'estimate') } } } } }
    const parts = (values: Record<string, unknown>) => [{ uid: 'o1', module: 'outlet-us-5-15r-duplex' }, { uid: 's1', module: 'rocker-switch-kcd1', values }, { uid: 'p1', module: withSource }]
    const wires: [string, string][] = [['o1.L1', 's1.1'], ['s1.2', 'p1.AC 1'], ['o1.N1', 'p1.AC 2']]
    expect(byId(buildCircuit(sheet(parts({ 'contact.s': 'closed' }), wires)).devices, 'p1.source')).toMatchObject({ kind: 'cell', role: 'external' })
    const off = buildCircuit(sheet(parts({}), wires))
    expect(byId(off.devices, 'p1.source')).toBeUndefined()
    expect(off.notes.join(' ')).toContain('P1: its mains input is off')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/power.test.ts`
Expected: FAIL, the stub skips every powered part.

- [ ] **Step 3: Write the power models**

Replace `src/sim/power.ts` with:

```ts
// Boards and modules with electrical.sim.power (spec 3.2, 3.3, 4, 4.6, 4.7): each domain's pin and
// return, the board's own draw as a voltage-aware load per domain, its rails (LDO, buck, boost,
// load switch or diode) with the spec's defaults, its GPIO states hanging off the real IO domain
// node, an external source (an AC-DC converter only when powered in the saved state), and USB
// links as two cable conductors. Node references are pins or `<usbPin>#vbus` / `<usbPin>#gnd`
// (ruling R5).
import type { Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { nodeKey } from '../format/netlist.ts'
import { type Quantity, type Rail, simOf } from '../format/simModel.ts'
import { gpioState, simOverride } from '../format/simState.ts'
import { DEFAULT_SOURCE, usbLink, usbSides } from '../format/usb.ts'
import { paramValue } from '../format/values.ts'
import type { Builder } from './build.ts'
import { CABLE_OHMS, IQ_DEFAULT, MIN_VOLTS_FRACTION, OR_DIODE_VF, PLUG_OHMS, RAIL_DIRECT_OHMS, ROUT_DEFAULT, loadEstimate } from './estimates.ts'
import { schottky } from './ledModels.ts'
import type { Param, ResolvedRail } from './model.ts'

const REQUIRED: Record<Rail['kind'], (keyof Rail)[]> = {
  ldo: ['vout', 'dropout', 'ioutMax'],
  buck: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  boost: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  switch: [],
}

/** The first required field a rail lacks (spec 3.2 table), or null. */
export function railProblem(r: Rail): string | null {
  const missing = REQUIRED[r.kind].filter((k) => r[k] === undefined)
  if (r.kind === 'switch' && r.ron === undefined && r.vf === undefined) missing.push('ron')
  return missing.length ? `rail ${r.id} needs ${missing.join(', ')}` : null
}

/** The node a `sim` node reference names on part `uid`: a pin's tap, or a USB port's simulation node. */
function usbNode(b: Builder, uid: string, m: ModuleDef, port: string, side: 'vbus' | 'gnd'): string | null {
  const gnd = simOf(m)?.usbPorts?.[port]?.gnd
  if (side === 'gnd' && gnd) return b.tap(uid, gnd)
  return `${uid}:${port}#${side}`
}
function nodeRef(b: Builder, uid: string, m: ModuleDef, ref: string): string | null {
  const usb = /^(.+)#(vbus|gnd)$/.exec(ref)
  return usb ? usbNode(b, uid, m, usb[1], usb[2] as 'vbus' | 'gnd') : b.tap(uid, ref)
}

export function powerPart(b: Builder, p: PartInstance, m: ModuleDef): void {
  const sim = simOf(m)!
  const power = sim.power!
  const ref = b.ref(p.uid)
  const L = (path: string) => `${m.id}.${ref}.${path}`
  const P = (x: Quantity, path: string): Param => b.param(x, L(path))
  const bad = (power.rails ?? []).map(railProblem).find((x) => x !== null)
  if (bad) return b.skip(p.uid, `incomplete power data: ${bad}`)

  const domains = new Map<string, { pin: string; ret: string; nominal: number }>()
  for (const dom of power.domains) {
    const pin = nodeRef(b, p.uid, m, dom.pin)
    const ret = nodeRef(b, p.uid, m, dom.ret)
    if (!pin || !ret) continue
    domains.set(dom.name, { pin, ret, nominal: dom.nominal })
    b.domain({ part: p.uid, name: dom.name, pin, ret, nominal: dom.nominal })
  }

  // The board's own consumption: a voltage-aware load per domain (spec 4 table), or the category
  // estimate on the first domain when it states no draw (spec 3.4).
  const draws = power.draw ?? []
  const est = draws.length ? null : loadEstimate(m)
  const list = est ? [{ domain: power.domains[0].name, typical: est.typical, peak: est.peak }] : draws
  for (const dr of list) {
    const dn = domains.get(dr.domain)
    if (!dn) continue
    const tOver = simOverride(p, `sim.draw.${dr.domain}.typical`)
    const pOver = simOverride(p, `sim.draw.${dr.domain}.peak`)
    const typical = tOver !== null ? b.user(tOver, L(`draw.${dr.domain}.typical`)) : P(dr.typical, `draw.${dr.domain}.typical`)
    const peak = pOver !== null ? b.user(pOver, L(`draw.${dr.domain}.peak`)) : dr.peak ? P(dr.peak, `draw.${dr.domain}.peak`) : typical
    const minVolts = 'minVolts' in dr && dr.minVolts ? P(dr.minVolts, `draw.${dr.domain}.minVolts`)
      : { value: MIN_VOLTS_FRACTION * dn.nominal, basis: 'estimate' as const, label: L(`draw.${dr.domain}.minVolts`), note: '90 % of the domain nominal (spec 3.2)' }
    b.add({ kind: 'load', id: `${p.uid}.draw.${dr.domain}`, part: p.uid, p: dn.pin, n: dn.ret, domain: dr.domain, typical, peak, ...(dr.peak?.note ? { peakNote: dr.peak.note } : {}), minVolts })
  }

  for (const r of power.rails ?? []) {
    const out = domains.get(r.output)
    const ins = r.inputs.map((x) => ({ ...x, d: domains.get(x.domain) })).filter((x) => x.d)
    if (!out || !ins.length) continue
    const id = `${p.uid}.rail.${r.id}`
    // Ruling R17: one internal input node, a Schottky per diode input, 1 milliohm per direct one.
    const inNode = `${id}#in`
    for (const x of ins) {
      if (x.via === 'diode') b.add({ kind: 'diode', id: `${id}.in.${x.domain}`, part: p.uid, a: x.d!.pin, k: inNode, model: schottky(OR_DIODE_VF.value), role: 'rail-input' })
      else b.add({ kind: 'resistor', id: `${id}.in.${x.domain}`, part: p.uid, a: x.d!.pin, b: inNode, ohms: b.param({ ...OR_DIODE_VF, value: RAIL_DIRECT_OHMS, unit: 'ohm', note: 'direct rail input (ruling R17)' }, L(`rails.${r.id}.input`)), role: 'rail-input' })
    }
    if (r.kind === 'switch') {
      if (r.ron) b.add({ kind: 'resistor', id, part: p.uid, a: inNode, b: out.pin, ohms: P(r.ron, `rails.${r.id}.ron`), role: 'switch-rail' })
      else b.add({ kind: 'diode', id, part: p.uid, a: inNode, k: out.pin, model: schottky(r.vf!.value), role: 'switch-rail' })
      continue
    }
    const opt = (x: Quantity | undefined, key: string): Param | undefined => (x ? P(x, `rails.${r.id}.${key}`) : undefined)
    const rail: ResolvedRail = {
      id: r.id, kind: r.kind, output: r.output, inputs: r.inputs.map((x) => x.domain),
      vout: opt(r.vout, 'vout'), dropout: opt(r.dropout, 'dropout'), ioutMax: opt(r.ioutMax, 'ioutMax'), efficiency: opt(r.efficiency, 'efficiency'),
      vinMin: opt(r.vinMin, 'vinMin'), vinMax: opt(r.vinMax, 'vinMax'),
      iq: P(r.iq ?? IQ_DEFAULT, `rails.${r.id}.iq`), rout: P(r.rout ?? ROUT_DEFAULT, `rails.${r.id}.rout`),
      reverse: r.reverse, offPath: r.offPath ?? 'open',
      ...(r.minLoad ? { minLoad: { amps: P(r.minLoad.amps, `rails.${r.id}.minLoad`), note: r.minLoad.note } } : {}),
    }
    b.add({ kind: 'rail', id, part: p.uid, rail, in: inNode, inRet: ins[0].d!.ret, out: out.pin, ret: out.ret, ctl: `${id}#ctl`, o: `${id}#o`, outDomain: r.output })
  }

  const s = power.source
  const sd = s && domains.get(s.domain)
  if (s && sd) {
    // An AC-DC converter is a source only when its mains input is powered in the saved state.
    if (mainsOf(m).acInput && !b.converterPowered(p.uid)) b.note(`${ref}: its mains input is off in the saved switch state, so its output is off`)
    else {
      const rOver = simOverride(p, 'sim.rInternal')
      const iOver = simOverride(p, 'sim.imax')
      const volts = s.voltage === 'param:voltage' ? b.user(paramValue(p, m, 'voltage') ?? sd.nominal, L('voltage')) : P(s.voltage, 'source.voltage')
      const imax = iOver !== null ? b.user(iOver, L('imax')) : s.imax ? P(s.imax, 'source.imax') : undefined
      const id = `${p.uid}.source`
      b.add({ kind: 'cell', id, part: p.uid, p: sd.pin, n: sd.ret, int: `${id}#int`, volts, rInternal: rOver !== null ? b.user(rOver, L('rInternal')) : P(s.rInternal, 'source.rInternal'), ...(imax ? { imax } : {}), role: 'external', domain: s.domain })
    }
  }

  const g = sim.gpio
  const io = g && domains.get(g.domain)
  if (g && io)
    for (const pin of g.pins) {
      const state = gpioState(p, m, pin)
      b.gpio({ part: p.uid, pin, state, domain: g.domain, key: nodeKey(p.uid, pin) })
      if (state === null) {
        b.unsimulated(p.uid, `pin ${pin}: output-only pin with no state set`)
        continue
      }
      const R = (x: Quantity, key: string) => P(x, `gpio.${key}`)
      const id = `${p.uid}.gpio.${pin}`
      if (state === 'high' || state === 'low') {
        const node = b.tap(p.uid, pin)
        if (node) b.add({ kind: 'resistor', id, part: p.uid, a: state === 'high' ? io.pin : node, b: state === 'high' ? node : io.ret, ohms: R(g.outputResistance, 'outputResistance'), role: 'gpio' })
      } else if (state === 'input-pullup' && g.pullup) {
        const node = b.tap(p.uid, pin)
        if (node) b.add({ kind: 'resistor', id, part: p.uid, a: io.pin, b: node, ohms: R(g.pullup, 'pullup'), role: 'pull' })
      } else if (state === 'input-pulldown' && g.pulldown) {
        const node = b.tap(p.uid, pin)
        if (node) b.add({ kind: 'resistor', id, part: p.uid, a: node, b: io.ret, ohms: R(g.pulldown, 'pulldown'), role: 'pull' })
      } else if (g.inputLeakage && g.inputLeakage.value > 0) {
        // Input leakage as the resistance that leaks that current at the domain's nominal voltage.
        const node = b.tap(p.uid, pin)
        if (node) b.add({ kind: 'resistor', id, part: p.uid, a: node, b: io.ret, ohms: { ...R(g.inputLeakage, 'inputLeakage'), value: io.nominal / g.inputLeakage.value }, role: 'leak' })
      }
    }
  b.partLimits(p, m)
}

/** Each USB link that carries power: both conductors as cable resistances (spec 4.7). */
export function usbLinks(b: Builder, d: Diagram): void {
  for (const c of [...d.connections].sort((x, y) => (x.uid < y.uid ? -1 : 1))) {
    const link = usbLink(d, c)
    if (!link) continue
    const [host, dev] = usbSides(link.from, link.to) ?? [link.from, link.to]
    if (host.usb.hub === 'downstream') {
      b.unsimulated(dev.part.uid, 'powered through a hub: not simulated yet')
      continue
    }
    if (!simOf(host.module)?.power) {
      b.unsimulated(dev.part.uid, `powered from ${b.ref(host.part.uid)} over USB, which has no power data`)
      continue
    }
    const ohms = link.direct ? PLUG_OHMS : CABLE_OHMS
    const label = `${link.direct ? 'plug' : 'cable'}.${c.uid}`
    const hv = usbNode(b, host.part.uid, host.module, host.name, 'vbus')
    const dv = usbNode(b, dev.part.uid, dev.module, dev.name, 'vbus')
    const hg = usbNode(b, host.part.uid, host.module, host.name, 'gnd')
    const dg = usbNode(b, dev.part.uid, dev.module, dev.name, 'gnd')
    if (!hv || !dv || !hg || !dg) continue
    const vbus = `usb.${c.uid}.vbus`
    const gnd = `usb.${c.uid}.gnd`
    b.add({ kind: 'resistor', id: vbus, part: host.part.uid, a: hv, b: dv, ohms: b.param(ohms, `${label}.vbus`), role: 'cable' })
    b.add({ kind: 'resistor', id: gnd, part: host.part.uid, a: hg, b: dg, ohms: b.param(ohms, `${label}.gnd`), role: 'cable' })
    const declared = host.usb.source
    const limit: Param = declared !== undefined
      ? { value: declared / 1000, basis: 'datasheet', label: `${host.module.id}.${b.ref(host.part.uid)}.usb.${host.name}.source` }
      : { value: DEFAULT_SOURCE[host.usb.version ?? '2.0'] / 1000, basis: 'representative', label: `usb-default.${host.usb.version ?? '2.0'}`, note: 'the USB default for the port version' }
    b.usbPath({ host: host.part.uid, hostPort: host.name, device: dev.part.uid, devicePort: dev.name, vbus, gnd, limit })
  }
}
```

In `src/sim/build.ts`'s `Builder.part`, the cable devices are added with `part: host uid`; that is intentional (findings name the host for an over-limit port). The cable devices of a USB link have ids starting `usb.`, so `devices` sorts them under the host part.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/power.test.ts src/sim/build.test.ts`
Expected: PASS (11 tests across the two files' new and existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/power.ts src/sim/power.test.ts
git commit -m "$(cat <<'MSG'
Sim: board power models (domains, voltage-aware loads, rails, GPIO, external sources, USB cables)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 12: Floating classification, islands and references

**Files:**
- Create: `src/sim/floating.ts`
- Test: `src/sim/floating.test.ts`

**Interfaces:**
- Consumes: `Circuit`, `Device` (Task 6); `buildCircuit` (Task 10, tests).
- Produces:
  - `interface Island { reference: string; source: string; nodes: string[] }` (`source` is the reference cell's device id)
  - `interface Classification { driven: Set<string>; islands: Island[]; islandOf: Map<string, number> }`
  - `function deviceNodes(d: Device): string[]`
  - `function classify(c: Circuit): Classification`, `function classifyCached(c: Circuit): Classification`
  - `function pinState(c: Circuit, cls: Classification, key: string): 'driven' | 'floating'`

- [ ] **Step 1: Write the failing test**

`src/sim/floating.test.ts`:

```ts
// Spec 2 and 4.4: a node is driven only with a DC path to a source; capacitors and open switches do
// not conduct; a source-less island and a singleton pin are floating; each island's reference is the
// return of its source with the largest imax, else the highest voltage, ties by part uid.
import { describe, expect, it } from 'vitest'
import { nodeKey } from '../format/netlist.ts'
import { buildCircuit } from './build.ts'
import { classify, pinState } from './floating.ts'
import { cellModule, sheet } from './testing.ts'

const R = (uid: string, ohms = 100) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })

describe('floating classification', () => {
  it('keeps a capacitor-only plate floating', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1'), { uid: 'c1', module: 'capacitor-ceramic' }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1']]))
    const cls = classify(c)
    expect(pinState(c, cls, nodeKey('c1', '1'))).toBe('driven')
    expect(pinState(c, cls, nodeKey('c1', '2'))).toBe('floating')
  })
  it('floats what sits behind an open switch, and drives it once the switch is closed', () => {
    const parts = (values: Record<string, unknown>) => [{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 's1', module: 'rocker-switch-kcd1', values }, R('r1')]
    const wires: [string, string][] = [['bt1.+', 's1.1'], ['s1.2', 'r1.1']]
    const open = buildCircuit(sheet(parts({}), wires))
    expect(pinState(open, classify(open), nodeKey('r1', '1'))).toBe('floating')
    const closed = buildCircuit(sheet(parts({ 'contact.s': 'closed' }), wires))
    expect(pinState(closed, classify(closed), nodeKey('r1', '1'))).toBe('driven')
  })
  it('floats a source-less island and a singleton pin', () => {
    const c = buildCircuit(sheet([R('r1'), R('r2'), { uid: 'd1', module: 'led' }], [['r1.1', 'r2.1'], ['r1.2', 'r2.2']]))
    const cls = classify(c)
    expect(cls.islands).toEqual([])
    expect(pinState(c, cls, nodeKey('r1', '1'))).toBe('floating')
    expect(pinState(c, cls, nodeKey('d1', 'A'))).toBe('floating')
  })
  it('references each island to the return of its strongest source', () => {
    const c = buildCircuit(sheet([
      { uid: 'b1', module: cellModule(3.7, 0.05, 'cell-a') }, { uid: 'b2', module: cellModule(5, 0.05, 'cell-b') }, R('r1'), R('r2'),
      { uid: 'b3', module: cellModule(1.5, 0.1, 'cell-c'), values: { 'sim.imax': { value: 9, unit: 'A' } } }, { uid: 'b4', module: cellModule(9, 0.1, 'cell-d') }, R('r3'),
    ], [['b1.+', 'r1.1'], ['b1.-', 'r1.2'], ['b2.+', 'r2.1'], ['b2.-', 'r2.2'], ['r1.2', 'r2.2'], ['b3.+', 'r3.1'], ['b3.-', 'r3.2'], ['b4.+', 'r3.1'], ['b4.-', 'r3.2']]))
    const cls = classify(c)
    // Equal imax (2 A each): the higher voltage wins. Then b3's 9 A beats b4's 2 A.
    expect(cls.islands.map((i) => [i.source, i.reference])).toEqual([['b2.cell', 'b2:-'], ['b3.cell', 'b3:-']])
    expect(cls.islandOf.get('B1_+')).toBe(0)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/floating.test.ts`
Expected: FAIL, `./floating.ts` cannot be found.

- [ ] **Step 3: Write the classification**

`src/sim/floating.ts`:

```ts
// DC-path classification (spec 2, 4.4), before solving: every node is driven (a DC path to a
// source) or floating. Capacitors do not conduct, and an open switch has no element. Islands are
// the connected components that hold a source; each one's reference is the return of its source
// with the largest imax, else the highest open-circuit voltage, ties by part uid. A floating node
// is never reported as a voltage, whatever the solver returns for it. Pure.
import { naturalCompare } from '../agent/order.ts'
import type { Circuit, Device } from './model.ts'

export interface Island { reference: string; source: string; nodes: string[] }
export interface Classification { driven: Set<string>; islands: Island[]; islandOf: Map<string, number> }

export function deviceNodes(d: Device): string[] {
  switch (d.kind) {
    case 'resistor':
    case 'capacitor':
      return [d.a, d.b]
    case 'diode':
      return [d.a, d.k]
    case 'cell':
      return [d.p, d.int, d.n]
    case 'load':
      return [d.p, d.n]
    case 'rail':
      return [d.in, d.inRet, d.out, d.ret, d.ctl, d.o]
  }
}

export function classify(c: Circuit): Classification {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    for (let cur = x; cur !== r; ) {
      const next = parent.get(cur)!
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const nodes = new Set<string>()
  for (const t of c.taps) {
    join(t.net, t.node)
    nodes.add(t.net).add(t.node)
  }
  for (const d of c.devices) {
    const ns = deviceNodes(d)
    for (const n of ns) {
      nodes.add(n)
      if (!parent.has(n)) parent.set(n, n)
    }
    if (d.kind !== 'capacitor') for (let i = 1; i < ns.length; i++) join(ns[0], ns[i])
  }
  const cells = c.devices.filter((d): d is Extract<Device, { kind: 'cell' }> => d.kind === 'cell')
  const byRoot = new Map<string, typeof cells>()
  for (const cell of cells) {
    const r = find(cell.p)
    byRoot.set(r, [...(byRoot.get(r) ?? []), cell])
  }
  const strongest = (list: typeof cells) =>
    [...list].sort((a, b) => (b.imax?.value ?? -1) - (a.imax?.value ?? -1) || b.volts.value - a.volts.value || naturalCompare(a.part, b.part) || (a.id < b.id ? -1 : 1))[0]
  const sorted = [...nodes].sort()
  const islands: Island[] = [...byRoot.entries()]
    .map(([root, list]) => {
      const ref = strongest(list)
      return { reference: ref.n, source: ref.id, nodes: sorted.filter((n) => find(n) === root), part: ref.part }
    })
    .sort((a, b) => naturalCompare(a.part, b.part))
    .map(({ reference, source, nodes: ns }) => ({ reference, source, nodes: ns }))
  const islandOf = new Map<string, number>()
  islands.forEach((isl, i) => isl.nodes.forEach((n) => islandOf.set(n, i)))
  return { driven: new Set(islandOf.keys()), islands, islandOf }
}

const memo = new WeakMap<Circuit, Classification>()
export function classifyCached(c: Circuit): Classification {
  let hit = memo.get(c)
  if (!hit) memo.set(c, (hit = classify(c)))
  return hit
}

/** A sheet pin's node state: floating when its net is not driven or it is on no simulated net. */
export function pinState(c: Circuit, cls: Classification, key: string): 'driven' | 'floating' {
  const net = c.pinNet[key]
  return net !== undefined && cls.driven.has(net) ? 'driven' : 'floating'
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/floating.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/floating.ts src/sim/floating.test.ts
git commit -m "$(cat <<'MSG'
Sim: DC-path floating classification, islands and their references

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 13: The SPICE compiler

**Files:**
- Create: `src/sim/spice.ts`
- Test: `src/sim/spice.test.ts`

**Interfaces:**
- Consumes: `Circuit`, `Device`, `Analysis`, `DiodeModel` (Task 6); `Classification`, `deviceNodes`, `classify` (Task 12); `BODY_DIODE`, `schottky` (Task 7).
- Produces:
  - `interface RawRun { v: Record<string, number>; pins: Record<string, Record<string, number>>; dev: Record<string, number> }` (`v`: absolute node voltages to node 0; `pins`: current into each part pin; `dev`: a cell's delivered current and a rail's output current, both positive outward)
  - `interface Compiled { text: string; empty: boolean; read(vectors: Record<string, number>): RawRun; nodesIn(error: string): string[] }`
  - `function compile(c: Circuit, cls: Classification, a: Analysis): Compiled`
  - `const num: (x: number) => string`, `function foldValue(v: number, minVolts: number): number`, `function enableValue(vin: number, vinMin: number, vinMax: number): number`, `function softplus(x: number, k?: number): number` (the same smooth functions in TypeScript, for results and findings)

- [ ] **Step 1: Write the failing tests**

`src/sim/spice.test.ts`:

```ts
// Spec 2, 4, 4.4 and 9 (compiler golden tests): byte-identical text in uid then terminal order; nets
// renamed n1..nN with node 0 at the first island's reference; sanitised names; never R = 0; the
// floating rules; and the behavioural rail elements.
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { compile, enableValue, foldValue } from './spice.ts'
import { buckModule, cellModule, ldoModule, sheet } from './testing.ts'
import type { Diagram } from '../format/diagram.ts'

const op = { kind: 'op', corner: 'typical' } as const
const text = (d: Diagram) => {
  const c = buildCircuit(d)
  return compile(c, classify(c), op).text
}
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })

describe('compile', () => {
  it('compiles a battery and a resistor to exactly this text (golden)', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])
    expect(text(d)).toBe([
      '* circuitoon',
      'v_bt1_cell n4 n3 dc 3.7',
      'r_bt1_cell_int n3 0 0.05',
      'vs_1 n1 n4 dc 0',
      'vs_2 n2 0 dc 0',
      'r_r1_r n5 n6 10',
      'vs_3 n1 n5 dc 0',
      'vs_4 n2 n6 dc 0',
      '.end',
      '',
    ].join('\n'))
  })
  it('gives byte-identical text for the same circuit in any part order', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']])
    expect(text({ ...d, parts: [...d.parts].reverse() })).toBe(text(d))
  })
  it('never emits R = 0', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 0)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    expect(t).toContain('r_r1_r n5 n6 0.02')
    expect(t).not.toMatch(/^r\S* \S+ \S+ 0$/m)
  })
  it('keeps user names out of the text: nets become n1..nN and element names are sanitised', () => {
    const d = sheet([
      { uid: 'bt1', module: cellModule(5, 0.1), designator: 'my "battery" 1' }, R('r1', 100),
      { uid: 'l1', module: 'net-label', values: { net: 'my net "x"' } }, { uid: 'l2', module: 'net-label', values: { net: '0' } },
    ], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['l1.NET', 'r1.1'], ['l2.NET', 'r1.2']])
    const t = text(d)
    expect(t).not.toContain('my net')
    expect(t).not.toContain('battery')
    for (const line of t.split('\n').filter((l) => l && !l.startsWith('*') && !l.startsWith('.'))) {
      const [name, ...rest] = line.split(' ')
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
      for (const tok of rest.slice(0, 2)) expect(tok).toMatch(/^(0|n\d+)$/)
    }
  })
  it('omits elements that are wholly floating and ties floating plates and second islands to 0 through 1 G', () => {
    const d = sheet([
      { uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 100), { uid: 'c1', module: 'capacitor-ceramic' }, R('r9', 100), R('r8', 100),
      { uid: 'bt2', module: cellModule(3, 0.1, 'cell-b') }, R('r2', 100),
    ], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1'], ['r9.1', 'r8.1'], ['r9.2', 'r8.2'], ['bt2.+', 'r2.1'], ['r2.2', 'bt2.-']])
    const t = text(d)
    expect(t).toMatch(/^c_c1_c n\d+ n\d+ 1e-7$/m)
    expect(t.match(/^r_float_\d+ n\d+ 0 1000000000$/gm)).toHaveLength(1)
    expect(t.match(/^r_join_\d+ n\d+ 0 1000000000$/gm)).toHaveLength(1)
    expect(t).not.toContain('r_r9_r')
  })
  it('is empty when nothing is driven', () => {
    const c = buildCircuit(sheet([R('r1', 100)], []))
    const out = compile(c, classify(c), op)
    expect(out.empty).toBe(true)
    expect(out.read({})).toEqual({ v: {}, pins: {}, dev: {} })
  })
  it('writes an LDO as a smooth control node, one output current source, a sense and a current-controlled input', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(5, 0.01) }, { uid: 'u1', module: ldoModule({ reverse: 'body-diode' }) }, R('r1', 33)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(t).toMatch(/^b_u1_rail_ldo_ctl n\d+ n\d+ v=\(3\.3-\(max\(/m)
    expect(t).toMatch(/^b_u1_rail_ldo_out n\d+ n\d+ i=\(max\(/m)
    expect(t).toMatch(/^v_u1_rail_ldo_o n\d+ n\d+ dc 0$/m)
    expect(t).toMatch(/^f_u1_rail_ldo_in n\d+ n\d+ v_u1_rail_ldo_o 1$/m)
    expect(t).toMatch(/^b_u1_rail_ldo_iq n\d+ n\d+ i=0\.005\*/m)
    expect(t).toMatch(/^d_u1_rail_ldo_body n\d+ n\d+ m_d_u1_rail_ldo_body$/m)
    expect(t).not.toMatch(/exp\((?!-abs)/)
  })
  it('writes a buck input as the control-node power over efficiency, guarded below 0.5 V', () => {
    const t = text(sheet([{ uid: 'bt1', module: cellModule(12, 0.01) }, { uid: 'u1', module: buckModule() }, R('r1', 10)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(t).toMatch(/^b_u1_rail_buck_in n\d+ n\d+ i=v\(n\d+,n\d+\)\*i\(v_u1_rail_buck_o\)\/\(0\.9\*max\(v\(n\d+,n\d+\),0\.5\)\)$/m)
  })
  it('computes the same smooth functions in TypeScript', () => {
    expect(foldValue(3.3, 2.97)).toBeCloseTo(1, 6)
    expect(foldValue(0, 2.97)).toBeLessThan(0.002)
    expect(enableValue(5.9, 6, 24)).toBe(0)
    expect(enableValue(6, 6, 24)).toBe(1)
    expect(enableValue(5.975, 6, 24)).toBeCloseTo(0.5, 9)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/spice.test.ts`
Expected: FAIL, `./spice.ts` cannot be found.

- [ ] **Step 3: Write the compiler**

`src/sim/spice.ts`:

```ts
// The SPICE compiler (spec 2, 4): Circuit + classification + analysis to text and a map back. Pure
// and deterministic: elements in part-uid order (each part's devices by id, then its pin senses by
// pin); nets renamed n1..nN in sorted order, node 0 the first island's reference, so no user name
// reaches the parser; element names sanitised and lowercase (ngspice lowercases); R never 0.
// Elements whose nodes are all floating are omitted; a floating node that still touches one, and
// every other island's reference, get 1 G to node 0 for numerics only (spec 4.4). Reducing a part
// for DC happens here: a capacitor is emitted and ngspice opens it in `op`.
import { naturalCompare } from '../agent/order.ts'
import { type Classification, deviceNodes } from './floating.ts'
import { BODY_DIODE, schottky } from './ledModels.ts'
import type { Analysis, Circuit, Device, DiodeModel, PinTap } from './model.ts'

/** Smoothing (ruling R18): k = 5 mV on volts, 0.005 on ratios. */
const KV = 0.005
const KR = 0.005
/** The smallest resistance ever written: R is never 0 (spec 2). */
const R_MIN = 1e-6
/** The numerical join of floating nodes and second islands (spec 4.4). */
const R_TIE = 1e9
/** A boost's pass-through diode (spec 4.2), Schottky at 100 mA: a modelling choice. */
const OFF_PATH_VF = 0.35

export interface RawRun { v: Record<string, number>; pins: Record<string, Record<string, number>>; dev: Record<string, number> }
export interface Compiled { text: string; empty: boolean; read(vectors: Record<string, number>): RawRun; nodesIn(error: string): string[] }

export const num = (x: number): string => {
  if (!Number.isFinite(x)) throw new Error(`spice: not a finite number (${x})`)
  return String(Number(x.toPrecision(12)))
}
/** softplus(x) = k ln(1 + e^(x/k)), written so exp never overflows: max(x, 0) + k ln(1 + e^(-|x|/k)). */
const sp = (x: string, k = KV) => `(max(${x},0)+${num(k)}*ln(1+exp(-abs(${x})/${num(k)})))`
const smax = (a: string, b: string, k = KV) => `(${b}+${sp(`(${a})-(${b})`, k)})`
const smin = (a: string, b: string, k = KV) => `(${a}-${sp(`(${a})-(${b})`, k)})`
/** The load fold-back f(V): 1 above minVolts, falling smoothly to 0 at 0 V (spec 4 table). */
const fold = (v: string, minVolts: number) => smin('1', `${smax(v, '0')}/${num(minVolts)}`, KR)
const step = (a: number, b: number, x: string) => {
  const t = `min(max((${x}-${num(a)})/${num(b - a)},0),1)`
  return `(${t}*${t}*(3-2*${t}))`
}
/** A buck or boost's enable (spec 4.2). */
const enable = (vin: string, lo: number, hi: number) => `(${step(lo - 0.05, lo, vin)}*(1-${step(hi, hi + 0.05, vin)}))`

/** The same functions on numbers, for results and findings. */
export const softplus = (x: number, k = KV): number => Math.max(x, 0) + k * Math.log1p(Math.exp(-Math.abs(x) / k))
export const foldValue = (v: number, minVolts: number): number => 1 - softplus(1 - softplus(v) / minVolts, KR)
const stepValue = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
export const enableValue = (vin: number, lo: number, hi: number): number => stepValue(lo - 0.05, lo, vin) * (1 - stepValue(hi, hi + 0.05, vin))

type N = (node: string) => string
interface El { nodes: string[]; lines: (n: N) => string[]; read?: { tap: PinTap; name: string } | { dev: string; name: string; sign: 1 | -1 } }

export function compile(c: Circuit, cls: Classification, a: Analysis): Compiled {
  const used = new Set<string>()
  const name = (prefix: string, id: string) => {
    const base = `${prefix}_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
    let n = base
    for (let k = 2; used.has(n); k++) n = `${base}_${k}`
    used.add(n)
    return n
  }
  const diode = (id: string, an: string, kn: string, m: DiodeModel): El => {
    const d = name('d', id)
    return { nodes: [an, kn], lines: (n) => [`.model m_${d} d(is=${num(m.is)} n=${num(m.n)} rs=${num(m.rs)})`, `${d} ${n(an)} ${n(kn)} m_${d}`] }
  }
  let taps = 0
  const tapEl = (t: PinTap): El => {
    const v = `vs_${++taps}`
    return { nodes: [t.net, t.node], lines: (n) => [`${v} ${n(t.net)} ${n(t.node)} dc 0`], read: { tap: t, name: v } }
  }
  const devEls = (d: Device): El[] => {
    switch (d.kind) {
      case 'resistor': {
        const r = name('r', d.id)
        return [{ nodes: [d.a, d.b], lines: (n) => [`${r} ${n(d.a)} ${n(d.b)} ${num(Math.max(d.ohms.value, R_MIN))}`] }]
      }
      case 'capacitor': {
        const cn = name('c', d.id)
        return [{ nodes: [d.a, d.b], lines: (n) => [`${cn} ${n(d.a)} ${n(d.b)} ${num(d.farads)}`] }]
      }
      case 'diode':
        return [diode(d.id, d.a, d.k, d.model)]
      case 'cell': {
        const v = name('v', d.id)
        const r = name('r', `${d.id}.int`)
        return [{
          nodes: [d.p, d.int, d.n],
          lines: (n) => [`${v} ${n(d.p)} ${n(d.int)} dc ${num(d.volts.value)}`, `${r} ${n(d.int)} ${n(d.n)} ${num(Math.max(d.rInternal.value, R_MIN))}`],
          read: { dev: d.id, name: v, sign: -1 },
        }]
      }
      case 'load': {
        const b = name('b', d.id)
        const amps = a.corner === 'peak' ? d.peak.value : d.typical.value
        return [{ nodes: [d.p, d.n], lines: (n) => [`${b} ${n(d.p)} ${n(d.n)} i=${num(amps)}*${fold(`v(${n(d.p)},${n(d.n)})`, d.minVolts.value)}`] }]
      }
      case 'rail': {
        const r = d.rail
        const [bctl, bout, vo, fin, bin, biq] = ['ctl', 'out', 'o', 'in', 'in', 'iq'].map((s, i) => name(i === 3 ? 'f' : i === 2 ? 'v' : 'b', `${d.id}.${s}`))
        const els: El[] = [{
          nodes: [d.in, d.inRet, d.out, d.ret, d.ctl, d.o],
          read: { dev: d.id, name: vo, sign: 1 },
          lines: (n) => {
            const vin = `v(${n(d.in)},${n(d.inRet)})`
            const vctl = r.kind === 'ldo' ? smin(num(r.vout!.value), smax(`${vin}-${num(r.dropout!.value)}`, '0')) : `${enable(vin, r.vinMin!.value, r.vinMax!.value)}*${num(r.vout!.value)}`
            const out = [
              `${bctl} ${n(d.ctl)} ${n(d.ret)} v=${vctl}`,
              `${bout} ${n(d.ret)} ${n(d.o)} i=${sp(`v(${n(d.ctl)},${n(d.ret)})-v(${n(d.o)},${n(d.ret)})`)}/${num(r.rout.value)}`,
              `${vo} ${n(d.o)} ${n(d.out)} dc 0`,
              r.kind === 'ldo'
                ? `${fin} ${n(d.in)} ${n(d.inRet)} ${vo} 1`
                : `${bin} ${n(d.in)} ${n(d.inRet)} i=v(${n(d.ctl)},${n(d.ret)})*i(${vo})/(${num(r.efficiency!.value)}*max(${vin},0.5))`,
            ]
            if (r.iq.value > 0) out.push(`${biq} ${n(d.in)} ${n(d.inRet)} i=${num(r.iq.value)}*${smin('1', smax(vin, '0'), KR)}`)
            return out
          },
        }]
        if (r.reverse === 'body-diode') els.push(diode(`${d.id}.body`, d.out, d.in, BODY_DIODE))
        if (r.kind !== 'ldo' && r.offPath === 'diode') els.push(diode(`${d.id}.off`, d.in, d.out, schottky(OFF_PATH_VF)))
        return els
      }
    }
  }
  // Part order (natural), each part's devices (by id) before its senses (by pin): Array.sort is stable.
  const entries = [...c.devices.map((dev) => ({ part: dev.part, rank: 0, dev })), ...c.taps.map((tap) => ({ part: tap.part, rank: 1, tap }))]
    .sort((x, y) => naturalCompare(x.part, y.part) || x.rank - y.rank)
  const els = entries.flatMap((e) => ('dev' in e && e.dev ? devEls(e.dev) : [tapEl((e as { tap: PinTap }).tap)]))
  const live = els.filter((e) => e.nodes.some((n) => cls.driven.has(n)))
  const ground = cls.islands[0]?.reference
  if (!ground || !live.length) return { text: '', empty: true, read: () => ({ v: {}, pins: {}, dev: {} }), nodesIn: () => [] }

  const touched = [...new Set(live.flatMap((e) => e.nodes))].sort()
  const spice = new Map<string, string>([[ground, '0']])
  let k = 0
  for (const node of touched) if (!spice.has(node)) spice.set(node, `n${++k}`)
  const n: N = (node) => spice.get(node)!
  const ties: string[] = []
  let f = 0
  for (const node of touched) if (!cls.driven.has(node)) ties.push(`r_float_${++f} ${n(node)} 0 ${num(R_TIE)}`)
  let j = 0
  for (const isl of cls.islands.slice(1)) if (spice.has(isl.reference)) ties.push(`r_join_${++j} ${n(isl.reference)} 0 ${num(R_TIE)}`)
  const text = ['* circuitoon', ...live.flatMap((e) => e.lines(n)), ...ties, '.end', ''].join('\n')
  const back = new Map([...spice].map(([node, s]) => [s, node]))
  return {
    text,
    empty: false,
    read(vectors) {
      const raw: RawRun = { v: {}, pins: {}, dev: {} }
      for (const node of touched) raw.v[node] = spice.get(node) === '0' ? 0 : (vectors[spice.get(node)!] ?? Number.NaN)
      for (const e of live) {
        if (!e.read) continue
        const amps = vectors[`${e.read.name}#branch`] ?? Number.NaN
        if ('tap' in e.read) (raw.pins[e.read.tap.part] ??= {})[e.read.tap.pin] = amps
        else raw.dev[e.read.dev] = e.read.sign * amps
      }
      return raw
    },
    nodesIn(error) {
      return [...new Set([...error.matchAll(/\bn\d+\b/g)].map((m) => back.get(m[0])).filter((x): x is string => !!x))]
    },
  }
}
```

Two details the golden test pins down: the rail element names come from `name(prefix, \`${d.id}.${suffix}\`)`, so `u1.rail.ldo` gives `b_u1_rail_ldo_ctl`, `b_u1_rail_ldo_out`, `v_u1_rail_ldo_o`, `f_u1_rail_ldo_in`, `b_u1_rail_ldo_iq`; and the buck's input source is `b_u1_rail_buck_in` (the LDO uses `f_` for the same role, so the two never collide).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/spice.test.ts`
Expected: PASS (9 tests). If the golden text differs, check the node order first (`[...].sort()` is code-point order: upper-case net names before lower-case tap nodes, `.` before `:`); fix the code to match the rules in the file header, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/sim/spice.ts src/sim/spice.test.ts
git commit -m "$(cat <<'MSG'
Sim: the SPICE compiler (deterministic text, n1..nN nets, never R = 0, floating ties, smooth rails)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 14: The Engine interface

**Files:**
- Create: `src/sim/engine/engine.ts`
- Test: `src/sim/engine/engine.test.ts`

**Interfaces:**
- Consumes: `EngineHost`, `EngineInfo` (Task 3); `createNodeEngineHost` (Task 4); `compile`, `RawRun` (Task 13); `classifyCached` (Task 12); `Circuit`, `Analysis` (Task 6).
- Produces:
  - `type RunOutcome = { status: 'ok'; revision: number; raw: RawRun; ms: number } | { status: 'failed'; revision: number; error: string; nodes: string[] } | { status: 'unavailable'; reason: string }`
  - `interface Engine { host: EngineHost; init(): Promise<EngineInfo>; run(c: Circuit, a: Analysis, revision: number): Promise<RunOutcome>; dispose(): void }`
  - `function makeEngine(host: EngineHost): Engine`

- [ ] **Step 1: Write the failing test**

`src/sim/engine/engine.test.ts`:

```ts
// Spec 2: Engine.run compiles, runs on the worker and maps vectors back to nets, pins and devices;
// a failure keeps the engine's text and names the circuit nodes it mentioned.
import { afterAll, describe, expect, it } from 'vitest'
import { buildCircuit } from '../build.ts'
import { ledHandCalc, ledModel } from '../ledModels.ts'
import { cellModule, sheet } from '../testing.ts'
import { makeEngine } from './engine.ts'
import { EngineHost, type FromWorker, type WorkerLike } from './host.ts'
import { createNodeEngineHost } from './nodeEngine.ts'

const led = sheet(
  [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
  [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
)

describe('Engine', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('maps node voltages, pin currents and delivered current back', async () => {
    const r = await engine.run(buildCircuit(led), { kind: 'op', corner: 'typical' }, 7)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.revision).toBe(7)
    const hand = ledHandCalc(5, 150, ledModel('red', 2).model)
    expect(Math.abs(r.raw.v.D1_A - hand.anode)).toBeLessThan(1e-5)
    expect(r.raw.pins.d1.A).toBeCloseTo(hand.amps, 6)
    expect(r.raw.pins.d1.K).toBeCloseTo(-hand.amps, 6)
    expect(r.raw.dev['bt1.cell']).toBeCloseTo(hand.amps, 6)
  }, 60_000)
  it('reports a failure with the circuit nodes the engine named', async () => {
    const spawn = (): WorkerLike => {
      let cb: (m: FromWorker) => void = () => {}
      queueMicrotask(() => cb({ type: 'ready', engine: { name: 'ngspice', version: '45.2', build: 'fake' } }))
      return { post: (m) => queueMicrotask(() => cb({ type: 'result', id: m.id, ok: false, error: 'singular matrix: check node n2', ms: 1, heap: 1 })), onMessage: (f) => (cb = f), onExit() {}, terminate() {} }
    }
    const r = await makeEngine(new EngineHost({ spawn })).run(buildCircuit(led), { kind: 'op', corner: 'typical' }, 3)
    expect(r).toEqual({ status: 'failed', revision: 3, error: 'singular matrix: check node n2', nodes: ['D1_A'] })
  })
})
```

The LED sheet's sorted touched nodes are `BT1_+`, `D1_A`, `GND`, `bt1.cell#int`, `bt1:+`, `d1:A`, ... with node 0 at `bt1:-`, so `n2` is `D1_A`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/engine/engine.test.ts`
Expected: FAIL, `./engine.ts` cannot be found.

- [ ] **Step 3: Write the Engine**

`src/sim/engine/engine.ts`:

```ts
// Engine (spec 2): run(c, analysis, revision) compiles the circuit, runs the text on the worker
// host and maps the vectors back. A circuit with nothing driven needs no engine run.
import type { Analysis, Circuit } from '../model.ts'
import { classifyCached } from '../floating.ts'
import { type RawRun, compile } from '../spice.ts'
import type { EngineHost, EngineInfo } from './host.ts'

export type RunOutcome =
  | { status: 'ok'; revision: number; raw: RawRun; ms: number }
  | { status: 'failed'; revision: number; error: string; nodes: string[] }
  | { status: 'unavailable'; reason: string }

export interface Engine {
  host: EngineHost
  init(): Promise<EngineInfo>
  run(c: Circuit, a: Analysis, revision: number): Promise<RunOutcome>
  dispose(): void
}

export function makeEngine(host: EngineHost): Engine {
  return {
    host,
    init: () => host.init(),
    async run(c, a, revision) {
      const compiled = compile(c, classifyCached(c), a)
      if (compiled.empty) return { status: 'ok', revision, raw: compiled.read({}), ms: 0 }
      const r = await host.runText(compiled.text)
      if (r.status === 'unavailable') return r
      if (r.status === 'failed') return { status: 'failed', revision, error: r.error, nodes: compiled.nodesIn(r.error) }
      return { status: 'ok', revision, raw: compiled.read(r.vectors), ms: r.ms }
    },
    dispose: () => host.dispose(),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/engine/engine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/engine/engine.ts src/sim/engine/engine.test.ts
git commit -m "$(cat <<'MSG'
Sim: the Engine interface (compile, run on the worker, map back; failures keep their nodes)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 15: Accuracy, conservation and the converter suite

**Files:**
- Test: `src/sim/models.test.ts`

**Interfaces:**
- Consumes: `buildCircuit` (Task 10), `makeEngine` (Task 14), `createNodeEngineHost` (Task 4), test modules from `src/sim/testing.ts` (Task 10), `ledHandCalc`, `ledModel` (Task 7).
- Produces: nothing new; it proves spec 4.3 and the accuracy and conservation items of spec 9 against the real engine. Any failure here is fixed in `power.ts` or `spice.ts`.

- [ ] **Step 1: Write the suite**

`src/sim/models.test.ts`:

```ts
// Spec 4.3 and 9 against the real engine: LED accuracy, a battery's sag, and for each of the LDO,
// buck and boost: dead input, the threshold edges, an output short (the input pays for it),
// backfeed above vout, two in parallel on one output, and power conservation within 1 %; plus
// boost pass-through, battery -> LDO -> GPIO -> LED and battery -> host -> USB cable -> device
// conserving current, and a dead-rail load drawing nothing.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { ledHandCalc, ledModel } from './ledModels.ts'
import type { Corner } from './model.ts'
import type { RawRun } from './spice.ts'
import { type PartSpec, boardModule, boostModule, buckModule, cellModule, hostModule, ldoModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

async function solve(d: Diagram, corner: Corner = 'typical'): Promise<RawRun> {
  const r = await engine.run(buildCircuit(d), { kind: 'op', corner }, 1)
  if (r.status !== 'ok') throw new Error(`solve: ${JSON.stringify(r)}`)
  return r.raw
}
const I = (raw: RawRun, part: string, pin: string) => raw.pins[part]?.[pin] ?? 0
const R = (uid: string, ohms: number): PartSpec => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
const near = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(Math.abs(b), 1e-9))

/** A cell into a regulator, the regulator into a load (or a short), plus extra parts and wires. */
function rig(reg: ModuleDef, vin: number, load: number, more: { parts?: PartSpec[]; wires?: [string, string][] } = {}): Diagram {
  return sheet([{ uid: 'bt1', module: cellModule(vin, 0.01) }, { uid: 'u1', module: reg }, R('r1', load), ...(more.parts ?? [])],
    [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND'], ...(more.wires ?? [])])
}
const OUT = 'U1_OUT'
const IN = 'BT1_+'

describe('accuracy (spec 9)', () => {
  it('LED + 150 ohm + 5 V puts the anode at the hand calculation, 2.0008 V within 1 mV', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']]))
    expect(Math.abs(raw.v.D1_A - ledHandCalc(5, 150 + 1e-6, ledModel('red', 2).model).anode)).toBeLessThan(1e-5)
    expect(Math.abs(raw.v.D1_A - 2.0008)).toBeLessThan(1e-3)
  }, 60_000)
  it('a battery under load sags by its rInternal', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    expect(raw.v['BT1_+']).toBeCloseTo((3.7 * 10) / 10.05, 6)
  }, 60_000)
})

const KINDS = [
  { kind: 'LDO', mod: ldoModule, id: 'u1.rail.ldo', vin: 5, load: 33, on: [4.4, 3.3 - 0.0135], edge: [4.0, 2.9 - 0.0088], off: [] as number[] },
  { kind: 'buck', mod: buckModule, id: 'u1.rail.buck', vin: 12, load: 10, on: [6.1, 5 - 0.05], edge: [] as number[], off: [5.9, 24.1] },
  { kind: 'boost', mod: boostModule, id: 'u1.rail.boost', vin: 3.7, load: 25, on: [2.95, 5 - 0.02], edge: [] as number[], off: [] as number[] },
] as const

describe.each(KINDS)('the $kind model (spec 4.3)', ({ mod, id, vin, load, on, edge, off }) => {
  it('dead input: no output and no negative node', async () => {
    const raw = await solve(rig(mod(), 0, load))
    expect(raw.v[OUT]).toBeLessThan(0.05)
    for (const v of Object.values(raw.v)) expect(v).toBeGreaterThan(-1e-3)
  }, 60_000)
  it('input at each threshold edge', async () => {
    expect(Math.abs((await solve(rig(mod(), on[0], load))).v[OUT] - on[1])).toBeLessThan(0.03)
    if (edge.length) expect(Math.abs((await solve(rig(mod(), edge[0], load))).v[OUT] - edge[1])).toBeLessThan(0.03)
    for (const v of off) expect((await solve(rig(mod(), v, load))).v[OUT]).toBeLessThan(0.05)
  }, 60_000)
  it('output shorted: it converges and the input pays for the short, rout included', async () => {
    const raw = await solve(rig(mod(), vin, 0))
    const iout = raw.dev[id]
    expect(iout).toBeGreaterThan(5)
    const pin = raw.v[IN] * I(raw, 'u1', 'IN')
    expect(pin).toBeGreaterThanOrEqual(iout * iout * 0.1 * 0.99)
  }, 60_000)
  it('output backfed above vout: it neither sinks nor fights', async () => {
    const raw = await solve(rig(mod(), vin, load, { parts: [{ uid: 'bt2', module: cellModule(6, 0.01, 'cell-b') }, R('r2', 1)], wires: [['bt2.+', 'r2.1'], ['r2.2', 'u1.OUT'], ['bt2.-', 'u1.GND']] }))
    expect(raw.dev[id]).toBeGreaterThanOrEqual(0)
    expect(raw.dev[id]).toBeLessThan(1e-3)
  }, 60_000)
  it('two in parallel on one output share the load', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(vin, 0.01) }, { uid: 'u1', module: mod() }, { uid: 'u2', module: mod() }, R('r1', 10)],
      [['bt1.+', 'u1.IN'], ['bt1.+', 'u2.IN'], ['bt1.-', 'u1.GND'], ['bt1.-', 'u2.GND'], ['u1.OUT', 'u2.OUT'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    const [a, b] = [raw.dev[id], raw.dev[id.replace('u1', 'u2')]]
    expect(a).toBeGreaterThan(0.05)
    expect(b).toBeGreaterThan(0.05)
    near(a + b, raw.v[OUT] / 10)
  }, 60_000)
  it('conserves power: input = output + losses, within 1 %', async () => {
    const raw = await solve(rig(mod(), vin, load))
    const m = buildCircuit(rig(mod(), vin, load)).devices.find((d) => d.id === id)!
    if (m.kind !== 'rail') throw new Error('no rail')
    const iout = raw.dev[id]
    const vctl = raw.v[m.ctl] - raw.v[m.ret]
    const pin = raw.v[IN] * I(raw, 'u1', 'IN')
    const pout = raw.v[OUT] * iout
    const eff = m.rail.efficiency?.value ?? 1
    const iq = m.rail.iq.value * raw.v[IN]
    const losses = m.rail.kind === 'ldo' ? (raw.v[IN] - raw.v[OUT]) * iout + iq : vctl * iout * (1 / eff - 1) + (vctl - raw.v[OUT]) * iout + iq
    near(pin, pout + losses)
  }, 60_000)
})

describe('pass-through and whole chains (spec 4.2, 4.6, 4.7)', () => {
  it('a disabled boost passes its input through a diode drop (pass-through)', async () => {
    const v = (await solve(rig(boostModule(), 2.5, 100))).v[OUT]
    expect(v).toBeGreaterThan(1.8)
    expect(v).toBeLessThan(2.5)
  }, 60_000)
  it('a body diode carries backfeed to the input; a blocking LDO does not', async () => {
    const back = { parts: [{ uid: 'bt2', module: cellModule(5, 0.01, 'cell-b') }, R('r2', 1)], wires: [['bt2.+', 'r2.1'], ['r2.2', 'u1.OUT'], ['bt2.-', 'u1.GND']] as [string, string][] }
    expect(I(await solve(rig(ldoModule({ reverse: 'body-diode' }, 'test-ldo-body'), 3, 100, back)), 'u1', 'IN')).toBeLessThan(-0.5)
    expect(I(await solve(rig(ldoModule(), 3, 100, back)), 'u1', 'IN')).toBeGreaterThan(0)
  }, 60_000)
  it('battery -> LDO -> GPIO high -> LED: the battery covers the LED, the draw and iq', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(5, 0.01) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high' } }, R('r1', 150), { uid: 'd1', module: 'led' }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u1.GND']]))
    const delivered = -I(raw, 'bt1', '+')
    expect(I(raw, 'd1', 'A')).toBeGreaterThan(0.005)
    near(delivered, I(raw, 'd1', 'A') + 0.05 + 0.005)
  }, 60_000)
  it('battery -> host rail -> USB cable -> device: the host delivers what the device takes, through both conductors', async () => {
    const raw = await solve(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule() }], [['h1.USB', 'u1.USB']]))
    near(raw.dev['h1.source'], 0.05 + 0.005)
    const vbus = (raw.v['h1:USB#vbus'] - raw.v['u1:USB#vbus']) / 0.1
    const gnd = (raw.v['u1:GND'] - raw.v['h1:USB#gnd']) / 0.1
    near(vbus, raw.dev['h1.source'])
    near(gnd, vbus)
  }, 60_000)
  it('a load on a dead rail draws (almost) nothing', async () => {
    const raw = await solve(sheet([{ uid: 'bt1', module: cellModule(0, 0.01) }, { uid: 'u1', module: boardModule() }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    expect(Math.abs(I(raw, 'u1', 'VIN'))).toBeLessThan(0.01 * 0.05)
  }, 60_000)
})
```

The `on` expectations are the model's own numbers: the LDO at its edge sits `k ln 2` (3.5 mV) under vout plus the 10 mA x 0.1 ohm rout drop (13.5 mV total); at 4.0 V the 88 mA load drops 8.8 mV across rout below `4.0 - 1.1`; the buck's 0.5 A through 0.1 ohm drops 50 mV; the boost's 0.2 A drops 20 mV.

- [ ] **Step 2: Run the suite**

Run: `npx vitest run src/sim/models.test.ts`
Expected: PASS (25 tests). A failing test points at a model bug: fix it in `spice.ts` (element lines) or `power.ts` (devices), never by loosening a tolerance without writing down why in the ledger.

- [ ] **Step 3: Run everything in Phase B together, then the full suite**

Run: `npx vitest run src/sim src/format/simState.test.ts src/agent/extract.test.ts` then `npm test` then `npm run build`
Expected: all PASS; the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/sim/models.test.ts
git commit -m "$(cat <<'MSG'
Sim: accuracy, conservation and converter fault suite against the real engine

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: Astra review of phase B

The review covers spec checkpoint 4: `model.ts`, `build.ts`, `power.ts`, `floating.ts`, `spice.ts`, the converter, GPIO and USB models, and the accuracy and conservation tests. Before it: `npm test`, `npm run build` and `npm run validate` pass.

---

# Phase C: data and sourcing

### Task 16: Validate `electrical.sim`

**Files:**
- Modify: `src/format/simModel.ts` (add `validateSim`, move in `railProblem`), `src/format/module.ts` (call it), `src/sim/power.ts` (import `railProblem` from `simModel.ts` instead of defining it), `scripts/validate-modules.ts` (built-in rails must be complete)
- Test: `src/format/simModel.test.ts`

**Interfaces:**
- Consumes: `isObj`, `isNum`, `show` (`module.ts`); the types of Task 6.
- Produces: `function validateSim(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void`; `function railProblem(r: Rail): string | null` (now in `simModel.ts`); `const MODEL_PARAMS: Record<string, SimUnit>`.

Spec 3.1: "`electrical.sim` is validated in full. Unknown keys are errors, a unit must match its kind, and every pin and domain it names must exist." And the per-kind required fields: "A built-in module that lacks one fails `npm run validate`. A custom or embedded part that lacks one is not simulated, with the missing field named." So the loader validates shape, units, provenance and references; only `npm run validate` adds the required-field check (an embedded part with an incomplete rail still loads, and `build.ts` lists it).

- [ ] **Step 1: Write the failing test**

`src/format/simModel.test.ts`:

```ts
// Spec 3.1: electrical.sim is validated in full: unknown keys, units by kind, provenance with a
// source (or a note for an estimate), and every pin, USB node and domain it names.
import { describe, expect, it } from 'vitest'
import { validateModule, type ModuleDef } from './module.ts'
import { boardModule, hostModule, ldoModule } from '../sim/testing.ts'
import { railProblem } from './simModel.ts'

const errorsOf = (m: ModuleDef) => {
  const r = validateModule(m)
  return r.ok ? [] : r.errors
}
const withSim = (m: ModuleDef, edit: (sim: Record<string, unknown>) => void): ModuleDef => {
  const copy = structuredClone(m)
  edit((copy.electrical as { sim: Record<string, unknown> }).sim)
  return copy
}

describe('validateSim', () => {
  it('accepts well-formed boards, regulators and hosts', () => {
    for (const m of [boardModule(), ldoModule(), hostModule()]) expect(errorsOf(m)).toEqual([])
  })
  it.each([
    ['an unknown key', (s: Record<string, unknown>) => (s.colour = 'red'), 'electrical.sim.colour: unknown field'],
    ['a unit that does not match its kind', (s: Record<string, unknown>) => ((s.gpio as { outputResistance: { unit: string } }).outputResistance.unit = 'V'), 'electrical.sim.gpio.outputResistance.unit: must be "ohm"'],
    ['a provenance outside the list', (s: Record<string, unknown>) => ((s.gpio as { outputResistance: { provenance: string } }).outputResistance.provenance = 'measured'), 'electrical.sim.gpio.outputResistance.provenance: must be "datasheet", "representative" or "estimate"'],
    ['a datasheet value with no source', (s: Record<string, unknown>) => delete (s.gpio as { outputResistance: { source?: string } }).outputResistance.source, 'electrical.sim.gpio.outputResistance.source: required for a datasheet or representative value (a URL)'],
    ['a domain on a missing pin', (s: Record<string, unknown>) => ((s.power as { domains: { pin: string }[] }).domains[0].pin = 'VBAT'), 'electrical.sim.power.domains[0].pin: no pin, hole group or USB node "VBAT"'],
    ['#vbus on a pin that is not a USB port', (s: Record<string, unknown>) => ((s.power as { domains: { pin: string }[] }).domains[0].pin = 'VIN#vbus'), 'electrical.sim.power.domains[0].pin: no pin, hole group or USB node "VIN#vbus"'],
    ['a limit on an unknown domain', (s: Record<string, unknown>) => ((s.limits as { of: unknown }[])[2].of = { domain: '5V' }), 'electrical.sim.limits[2].of.domain: no domain "5V" in electrical.sim.power.domains'],
    ['a GPIO pin that does not exist', (s: Record<string, unknown>) => (s.gpio as { pins: string[] }).pins.push('IO9'), 'electrical.sim.gpio.pins[2]: no pin "IO9"'],
    ['a USB ground that is not a ground pin', (s: Record<string, unknown>) => (s.usbPorts = { USB: { gnd: 'VIN' } }), 'electrical.sim.usbPorts.USB.gnd: "VIN" is not a ground pin'],
    ['a peak with no note', (s: Record<string, unknown>) => delete ((s.power as { draw: { peak: { note?: string } }[] }).draw[0].peak.note), 'electrical.sim.power.draw[0].peak.note: required (what the peak is, for example "Wi-Fi transmit")'],
    ['an efficiency above 1', (s: Record<string, unknown>) => ((s.power as { rails: { kind: string; efficiency?: unknown }[] }).rails[1].efficiency = { value: 1.2, unit: '1', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].efficiency.value: must be above 0 and at most 1'],
  ])('rejects %s', (_what, edit, message) => {
    expect(errorsOf(withSim(boardModule(), edit))).toContain(message)
  })
  it('requires a note on an estimate', () => {
    const m = withSim(boardModule(), (s) => ((s.gpio as { pullup: unknown }).pullup = { value: 45000, unit: 'ohm', provenance: 'estimate' }))
    expect(errorsOf(m)).toContain('electrical.sim.gpio.pullup.note: required on an estimate (say what was assumed)')
  })
  it('lets an embedded part with an incomplete rail load, and railProblem names the gap', () => {
    const bad = ldoModule({ dropout: undefined }, 'test-bad-ldo')
    expect(errorsOf(bad)).toEqual([])
    const rail = (bad.electrical as { sim: { power: { rails: Parameters<typeof railProblem>[0][] } } }).sim.power.rails[0]
    expect(railProblem(rail)).toBe('rail ldo needs dropout')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/format/simModel.test.ts`
Expected: FAIL: the error lists are empty (nothing validates `sim` yet) and `railProblem` is not exported from `simModel.ts`.

- [ ] **Step 3: Write `validateSim` and move `railProblem`**

Append to `src/format/simModel.ts` (extend its import to `import { type ModuleDef, isNum, isObj, show } from './module.ts'`):

```ts
const RAIL_REQUIRED: Record<RailKind, (keyof Rail)[]> = {
  ldo: ['vout', 'dropout', 'ioutMax'],
  buck: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  boost: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  switch: [],
}
/** The required fields a rail lacks (spec 3.2 table), or null. */
export function railProblem(r: Rail): string | null {
  const missing = RAIL_REQUIRED[r.kind].filter((k) => r[k] === undefined)
  if (r.kind === 'switch' && r.ron === undefined && r.vf === undefined) missing.push('ron')
  return missing.length ? `rail ${r.id} needs ${missing.join(', ')}` : null
}

/** The physics a module may state in sim.modelParams, with their units. */
export const MODEL_PARAMS: Record<string, SimUnit> = { rInternal: 'ohm', contactResistance: 'ohm', is: 'A', n: '1', rs: 'ohm', dcr: 'ohm' }
const RAIL_UNITS: Record<string, SimUnit> = { vout: 'V', dropout: 'V', iq: 'A', ioutMax: 'A', efficiency: '1', vinMin: 'V', vinMax: 'V', rout: 'ohm', ron: 'ohm', vf: 'V' }
const LIMIT_UNITS: Record<LimitKind, string> = { current: 'A', absMaxCurrent: 'A', power: 'W', vinMax: 'V', vinMin: 'V', sourceCurrent: 'A', ioTotalCurrent: 'A' }
const URLS = /^https?:\/\/\S+( https?:\/\/\S+)*$/

/** Checks `electrical.sim` (spec 3.1): shape, units by kind, provenance, and every name it uses. */
export function validateSim(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el) || el.sim === undefined) return
  const at = 'electrical.sim'
  const s = el.sim
  if (!isObj(s)) return void errors.push(`${at}: must be an object`)
  const pins = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])].filter(isObj)
  const usb = new Set(pins.filter((p) => p.type === 'usb').map((p) => p.name))
  const grounds = new Set(pins.filter((p) => p.type === 'ground').map((p) => p.name))
  const keys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where}.${k}: unknown field`)
  }
  const nodeRef = (v: unknown, where: string) => {
    const u = typeof v === 'string' ? /^(.+)#(vbus|gnd)$/.exec(v) : null
    if (typeof v !== 'string' || !(u ? usb.has(u[1]) : names.has(v))) errors.push(`${where}: no pin, hole group or USB node "${show(v)}"`)
  }
  const sourced = (o: Record<string, unknown>, where: string) => {
    if (!(PROVENANCES as readonly unknown[]).includes(o.provenance)) return void errors.push(`${where}.provenance: must be "datasheet", "representative" or "estimate"`)
    if (o.provenance !== 'estimate' && !(typeof o.source === 'string' && URLS.test(o.source))) errors.push(`${where}.source: required for a datasheet or representative value (a URL)`)
    if (o.source !== undefined && !(typeof o.source === 'string' && URLS.test(o.source))) errors.push(`${where}.source: must be one or more URLs separated by a space`)
    if (o.provenance === 'estimate' && !(typeof o.note === 'string' && o.note.trim())) errors.push(`${where}.note: required on an estimate (say what was assumed)`)
    if (o.note !== undefined && !(typeof o.note === 'string' && o.note.trim())) errors.push(`${where}.note: must be a non-empty string`)
  }
  const quantity = (v: unknown, where: string, unit: SimUnit, opts: { positive?: boolean; max?: number; extra?: string[] } = {}) => {
    if (!isObj(v)) return void errors.push(`${where}: must be { "value", "unit", "provenance", "source" or "note" }`)
    keys(v, ['value', 'unit', 'source', 'provenance', 'note', ...(opts.extra ?? [])], where)
    if (v.unit !== unit) errors.push(`${where}.unit: must be "${unit}"`)
    const lo = opts.positive ? 'above 0' : '0 or more'
    if (!isNum(v.value) || (opts.positive ? v.value <= 0 : v.value < 0) || (opts.max !== undefined && v.value > opts.max) || v.value > 1e6)
      errors.push(`${where}.value: must be ${lo}${opts.max !== undefined ? ` and at most ${opts.max}` : ''}`)
    sourced(v, where)
  }
  keys(s, ['modelParams', 'limits', 'power', 'gpio', 'usbPorts'], at)

  if (s.modelParams !== undefined) {
    if (!isObj(s.modelParams)) errors.push(`${at}.modelParams: must be an object`)
    else
      for (const [k, v] of Object.entries(s.modelParams)) {
        if (!Object.hasOwn(MODEL_PARAMS, k)) errors.push(`${at}.modelParams.${k}: unknown model parameter (${Object.keys(MODEL_PARAMS).join(', ')})`)
        else quantity(v, `${at}.modelParams.${k}`, MODEL_PARAMS[k], { positive: true })
      }
  }

  const domainNames = new Set<string>()
  const p = s.power
  if (p !== undefined) {
    const pa = `${at}.power`
    if (!isObj(p)) errors.push(`${pa}: must be an object`)
    else {
      keys(p, ['domains', 'draw', 'rails', 'source'], pa)
      if (!Array.isArray(p.domains) || !p.domains.length) errors.push(`${pa}.domains: required, a list of { "name", "pin", "ret", "nominal" }`)
      else
        p.domains.forEach((d, i) => {
          const w = `${pa}.domains[${i}]`
          if (!isObj(d)) return void errors.push(`${w}: must be an object`)
          keys(d, ['name', 'pin', 'ret', 'nominal'], w)
          if (typeof d.name !== 'string' || !d.name) errors.push(`${w}.name: required`)
          else if (domainNames.has(d.name)) errors.push(`${w}.name: duplicate domain "${d.name}"`)
          else domainNames.add(d.name)
          nodeRef(d.pin, `${w}.pin`)
          nodeRef(d.ret, `${w}.ret`)
          if (!(isNum(d.nominal) && d.nominal > 0)) errors.push(`${w}.nominal: must be a voltage above 0`)
        })
      const domain = (v: unknown, where: string) => {
        if (typeof v !== 'string' || !domainNames.has(v)) errors.push(`${where}: no domain "${show(v)}" in ${pa}.domains`)
      }
      if (p.draw !== undefined)
        (Array.isArray(p.draw) ? p.draw : [null]).forEach((d, i) => {
          const w = `${pa}.draw[${i}]`
          if (!isObj(d)) return void errors.push(`${w}: must be { "domain", "typical", "peak"?, "minVolts"? }`)
          keys(d, ['domain', 'typical', 'peak', 'minVolts'], w)
          domain(d.domain, `${w}.domain`)
          quantity(d.typical, `${w}.typical`, 'A')
          if (d.peak !== undefined) {
            quantity(d.peak, `${w}.peak`, 'A', { extra: ['note'] })
            if (isObj(d.peak) && !(typeof d.peak.note === 'string' && d.peak.note.trim())) errors.push(`${w}.peak.note: required (what the peak is, for example "Wi-Fi transmit")`)
          }
          if (d.minVolts !== undefined) quantity(d.minVolts, `${w}.minVolts`, 'V', { positive: true })
        })
      const railIds = new Set<string>()
      if (p.rails !== undefined)
        (Array.isArray(p.rails) ? p.rails : [null]).forEach((r, i) => {
          const w = `${pa}.rails[${i}]`
          if (!isObj(r)) return void errors.push(`${w}: must be an object`)
          keys(r, ['id', 'inputs', 'output', 'kind', 'reverse', 'offPath', 'minLoad', ...Object.keys(RAIL_UNITS)], w)
          if (typeof r.id !== 'string' || !r.id || railIds.has(r.id)) errors.push(`${w}.id: required and unique`)
          else railIds.add(r.id)
          if (!(RAIL_KINDS as readonly unknown[]).includes(r.kind)) errors.push(`${w}.kind: must be "ldo", "buck", "boost" or "switch"`)
          if (!Array.isArray(r.inputs) || !r.inputs.length) errors.push(`${w}.inputs: required, a list of { "domain", "via" }`)
          else
            r.inputs.forEach((x, j) => {
              if (!isObj(x)) return void errors.push(`${w}.inputs[${j}]: must be { "domain", "via" }`)
              keys(x, ['domain', 'via'], `${w}.inputs[${j}]`)
              domain(x.domain, `${w}.inputs[${j}].domain`)
              if (x.via !== 'direct' && x.via !== 'diode') errors.push(`${w}.inputs[${j}].via: must be "direct" or "diode"`)
            })
          domain(r.output, `${w}.output`)
          if (r.reverse !== 'blocks' && r.reverse !== 'body-diode') errors.push(`${w}.reverse: required, "blocks" or "body-diode"`)
          if (r.offPath !== undefined && !((r.kind === 'buck' || r.kind === 'boost') && (r.offPath === 'open' || r.offPath === 'diode'))) errors.push(`${w}.offPath: "open" or "diode", on a buck or boost only`)
          for (const [k, unit] of Object.entries(RAIL_UNITS))
            if (r[k] !== undefined) quantity(r[k], `${w}.${k}`, unit, k === 'efficiency' ? { positive: true, max: 1 } : k === 'iq' ? {} : { positive: true })
          if ((r.ron !== undefined || r.vf !== undefined) && r.kind !== 'switch') errors.push(`${w}: ron and vf are for a "switch" rail`)
          if (r.minLoad !== undefined) {
            if (!isObj(r.minLoad) || typeof r.minLoad.note !== 'string' || !r.minLoad.note.trim()) errors.push(`${w}.minLoad: must be { "amps", "note" }`)
            else quantity(r.minLoad.amps, `${w}.minLoad.amps`, 'A', { positive: true })
          }
        })
      if (p.source !== undefined) {
        const w = `${pa}.source`
        const src = p.source
        if (!isObj(src)) errors.push(`${w}: must be { "domain", "voltage", "rInternal", "imax"? }`)
        else {
          keys(src, ['domain', 'voltage', 'rInternal', 'imax'], w)
          domain(src.domain, `${w}.domain`)
          if (src.voltage === 'param:voltage') {
            const params = isObj(el.params) ? el.params : {}
            if (params.voltage === undefined) errors.push(`${w}.voltage: "param:voltage" needs electrical.params.voltage`)
          } else quantity(src.voltage, `${w}.voltage`, 'V', { positive: true })
          quantity(src.rInternal, `${w}.rInternal`, 'ohm', { positive: true })
          if (src.imax !== undefined) quantity(src.imax, `${w}.imax`, 'A', { positive: true })
        }
      }
    }
  }

  if (s.gpio !== undefined) {
    const w = `${at}.gpio`
    const g = s.gpio
    if (!isObj(g)) errors.push(`${w}: must be an object`)
    else {
      keys(g, ['domain', 'pins', 'outputResistance', 'pullup', 'pulldown', 'inputLeakage'], w)
      if (typeof g.domain !== 'string' || !domainNames.has(g.domain)) errors.push(`${w}.domain: no domain "${show(g.domain)}" in ${at}.power.domains`)
      if (!Array.isArray(g.pins) || !g.pins.length) errors.push(`${w}.pins: required, a list of GPIO pin names`)
      else g.pins.forEach((n, i) => { if (typeof n !== 'string' || !names.has(n)) errors.push(`${w}.pins[${i}]: no pin "${show(n)}"`) })
      quantity(g.outputResistance, `${w}.outputResistance`, 'ohm', { positive: true })
      for (const k of ['pullup', 'pulldown']) if (g[k] !== undefined) quantity(g[k], `${w}.${k}`, 'ohm', { positive: true })
      if (g.inputLeakage !== undefined) quantity(g.inputLeakage, `${w}.inputLeakage`, 'A')
    }
  }

  if (s.usbPorts !== undefined) {
    const w = `${at}.usbPorts`
    if (!isObj(s.usbPorts)) errors.push(`${w}: must be an object of USB pin to { "gnd" }`)
    else
      for (const [port, v] of Object.entries(s.usbPorts)) {
        if (!usb.has(port)) errors.push(`${w}.${port}: no USB pin "${port}"`)
        if (!isObj(v) || typeof v.gnd !== 'string') errors.push(`${w}.${port}: must be { "gnd": <ground pin> }`)
        else if (!grounds.has(v.gnd)) errors.push(`${w}.${port}.gnd: "${v.gnd}" is not a ground pin`)
      }
  }

  if (s.limits !== undefined)
    (Array.isArray(s.limits) ? s.limits : [null]).forEach((l, i) => {
      const w = `${at}.limits[${i}]`
      if (!isObj(l)) return void errors.push(`${w}: must be { "of", "kind", "value", "provenance", ... }`)
      keys(l, ['of', 'kind', 'value', 'source', 'provenance', 'conditions', 'note'], w)
      const of = l.of
      if (!isObj(of) || Object.keys(of).length !== 1) errors.push(`${w}.of: must be { "pin" }, { "domain" } or { "part": true }`)
      else if ('pin' in of) { if (typeof of.pin !== 'string' || !names.has(of.pin)) errors.push(`${w}.of.pin: no pin "${show(of.pin)}"`) }
      else if ('domain' in of) { if (typeof of.domain !== 'string' || !domainNames.has(of.domain)) errors.push(`${w}.of.domain: no domain "${show(of.domain)}" in ${at}.power.domains`) }
      else if (of.part !== true) errors.push(`${w}.of: must be { "pin" }, { "domain" } or { "part": true }`)
      if (!(LIMIT_KINDS as readonly unknown[]).includes(l.kind)) errors.push(`${w}.kind: must be one of ${LIMIT_KINDS.join(', ')}`)
      if (!(isNum(l.value) && l.value > 0)) errors.push(`${w}.value: must be above 0 (in ${LIMIT_UNITS[l.kind as LimitKind] ?? 'its unit'})`)
      if (l.conditions !== undefined && !(typeof l.conditions === 'string' && l.conditions.trim())) errors.push(`${w}.conditions: must be a non-empty string`)
      sourced(l, w)
    })
}
```

`Limit` gains an optional `note?: string` (an estimate limit needs one); add it to the interface.

In `src/format/module.ts`, import `validateSim` from `./simModel.ts` and call it right after `validateMains(raw, names, errors)`:

```ts
  validateSim(raw, names, errors)
```

In `src/sim/power.ts`, delete the local `REQUIRED` table and `railProblem`, and import it: `import { type Quantity, type Rail, railProblem, simOf } from '../format/simModel.ts'` (keep `export { railProblem }` out; callers import it from `simModel.ts`).

In `scripts/validate-modules.ts`, after a module validates, add the built-in-only check (import `railProblem`, `simOf` from `../src/format/simModel.ts`):

```ts
  // Spec 3.1: a built-in module must state every field its rails need (an embedded one is listed
  // as not simulated instead, by the simulator).
  const incomplete = (simOf(r.module)?.power?.rails ?? []).map(railProblem).filter((x) => x !== null)
  if (incomplete.length) {
    console.error(`FAIL ${file}: electrical.sim: ${incomplete.join('; ')}`)
    failed++
    continue
  }
```

Place it right after the `custom` check, before `if (ids.has(r.module.id))`.

- [ ] **Step 4: Run the tests, the module validator and the built-in module tests**

Run: `npx vitest run src/format/simModel.test.ts src/format/module.test.ts src/sim/power.test.ts` then `npm run validate`
Expected: PASS, and `npm run validate` reports every module valid (none has `sim` yet).

- [ ] **Step 5: Commit**

```bash
git add src/format/simModel.ts src/format/simModel.test.ts src/format/module.ts src/sim/power.ts scripts/validate-modules.ts
git commit -m "$(cat <<'MSG'
Modules: validate electrical.sim in full (units, provenance with sources, every name it uses)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 17: The sourced-data pipeline (`scripts/sim-data`, ruling R1)

**Files:**
- Create: `scripts/lib/sim-data.mjs`, `scripts/gen-sim.mjs`, `scripts/sim-data/.gitkeep`
- Modify: `scripts/lib/gen-output.mjs` (`emit` merges the patch)
- Test: `scripts/lib/sim-data.test.ts`, `src/sim/data.test.ts`

**Interfaces:**
- Consumes: `emit`, `finish` (`gen-output.mjs`).
- Produces:
  - Patch file format, one per module, `scripts/sim-data/<module id>.json`:
    ```json
    {
      "id": "<module id>",
      "researched": "YYYY-MM-DD",
      "sim": { "...": "the module's electrical.sim, exactly as merged (spec section 3)" },
      "notes": ["modelling choices and assumptions that are not numbers (a rail's reverse behaviour, what was left out)"],
      "unaccounted": ["what draws current on the real part but has no number here, and why"],
      "review": []
    }
    ```
  - `function withSim(path: string, content: string, dir?: URL): string` (merges `sim` into `electrical`)
  - `npm run check:gen` covers `gen-sim.mjs` (it runs every `gen-*.mjs`).

- [ ] **Step 1: Write the failing tests**

`scripts/lib/sim-data.test.ts`:

```ts
// Ruling R1: a module's sourced electrical.sim comes from scripts/sim-data/<id>.json, merged into
// the module file by emit() for every generator and by gen-sim.mjs for hand-written modules.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withSim } from './sim-data.mjs'

describe('withSim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-data-'))
  writeFileSync(join(dir, 'led.json'), JSON.stringify({ id: 'led', sim: { limits: [] }, review: [] }))
  const url = pathToFileURL(`${dir}/`)
  const text = `${JSON.stringify({ id: 'led', electrical: { model: 'led', params: {} }, kicad: {} }, null, 2)}\n`
  it('puts the patch under electrical.sim of a module file, keeping every other key in place', () => {
    const out = JSON.parse(withSim('C:/x/modules/led.json', text, url))
    expect(out.electrical).toEqual({ model: 'led', params: {}, sim: { limits: [] } })
    expect(Object.keys(out)).toEqual(['id', 'electrical', 'kicad'])
  })
  it('leaves files that are not modules, and modules without a patch, untouched', () => {
    expect(withSim('C:/x/plugin/dist-cli/circuitoon.mjs', 'code', url)).toBe('code')
    expect(withSim('C:/x/modules/resistor.json', text, url)).toBe(text)
  })
})
```

`src/sim/data.test.ts` (each research task adds a `describe` block to it):

```ts
// The sourced simulation data (spec 3.4): every patch in scripts/sim-data is what its module file
// holds, and every value carries honest provenance.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'

const DIR = join(import.meta.dirname, '..', '..', 'scripts', 'sim-data')
export const patches = (): { id: string; sim: unknown; review: unknown[] }[] =>
  readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))

describe('sourced simulation data', () => {
  it('matches each module file exactly', () => {
    for (const p of patches()) expect(simOf(load(p.id)), p.id).toEqual(p.sim)
  })
  it('has been checked by two independent reviewers (spec 3.4)', () => {
    for (const p of patches()) expect(p.review.length, p.id).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run scripts/lib/sim-data.test.ts src/sim/data.test.ts`
Expected: FAIL: `./sim-data.mjs` cannot be found, and `scripts/sim-data` does not exist.

- [ ] **Step 3: Write the pipeline**

`scripts/lib/sim-data.mjs`:

```js
// Sourced electrical.sim patches (ruling R1): scripts/sim-data/<module id>.json, each
// { id, researched, sim, notes, unaccounted, review }. withSim puts a patch's `sim` into a module
// file's JSON as electrical.sim; emit() calls it for every generated module, and gen-sim.mjs for the
// hand-written ones, so a module's simulation data has one source.
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const DIR = new URL('../sim-data/', import.meta.url)

export function simPatch(id, dir = DIR) {
  const f = new URL(`${id}.json`, dir)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

export function withSim(path, content, dir = DIR) {
  if (!/[\\/]modules[\\/][^\\/]+\.json$/.test(path)) return content
  const patch = simPatch(basename(path, '.json'), dir)
  if (!patch) return content
  const m = JSON.parse(content)
  m.electrical = { ...(m.electrical ?? {}), sim: patch.sim }
  return `${JSON.stringify(m, null, 2)}\n`
}
```

In `scripts/lib/gen-output.mjs`, import `withSim` and apply it at the top of `emit`:

```js
import { withSim } from './sim-data.mjs'

/** Writes `content` to `path`, or in --check mode records whether the file on disk differs. A module gets its sourced electrical.sim first (ruling R1). */
export function emit(path, text) {
  const content = withSim(path, text)
  count++
  if (!CHECK) return void writeFileSync(path, content)
  const onDisk = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
  if (onDisk !== content) drifted.push(basename(path) + (onDisk === null ? ' (missing)' : ''))
}
```

`scripts/gen-sim.mjs`:

```js
// Applies every sourced simulation patch (scripts/sim-data/*.json, ruling R1) to its module file.
// For a hand-written module this is the only writer; a generated module gets the same patch from
// emit() in its own generator, so the two agree. Run from the repo root: node scripts/gen-sim.mjs
// (add --check to compare without writing; npm run check:gen runs it that way).
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { emit, finish, log } from './lib/gen-output.mjs'

const dir = fileURLToPath(new URL('./sim-data/', import.meta.url))
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const id = f.slice(0, -'.json'.length)
  const path = fileURLToPath(new URL(`../modules/${id}.json`, import.meta.url))
  const m = JSON.parse(readFileSync(path, 'utf8'))
  if (m.electrical) delete m.electrical.sim
  emit(path, `${JSON.stringify(m, null, 2)}\n`)
  log(`${id}.json`, 'electrical.sim from scripts/sim-data')
}
finish('gen-sim.mjs')
```

Create the empty directory with `scripts/sim-data/.gitkeep`.

- [ ] **Step 4: Run the tests and the generator checks**

Run: `npx vitest run scripts/lib/sim-data.test.ts src/sim/data.test.ts` then `npm run check:gen`
Expected: PASS, and `check:gen` reports every generator matching (`gen-sim.mjs: 0 generated files match modules/`).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sim-data.mjs scripts/lib/sim-data.test.ts scripts/gen-sim.mjs scripts/sim-data/.gitkeep scripts/lib/gen-output.mjs src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: one source for sourced electrical.sim (scripts/sim-data patches merged by every generator)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

## Sourcing protocol (Tasks 18 to 24)

Datasheet numbers are not in this plan: they are found, written and checked by the tasks below. Every research brief starts with this rule, word for word:

> **A wrong number is worse than a missing one. When you are unsure, use `estimate` with a note.**

1. **Output.** One patch per module, `scripts/sim-data/<module id>.json`, in the Task 17 format. `sim` must pass `validateSim` (Task 16) and the structure the task lists. Nothing else changes in `modules/` by hand: run `node scripts/gen-sim.mjs` (hand-written modules) and the module's own generator (generated ones; Task 17's `emit` merges the patch).
2. **Provenance per value.** Every `Quantity` and `Limit` has `provenance`:
   - `datasheet`: from the exact part's (or chip's) own datasheet. `source` is a direct URL to the document; `note` gives the table or page ("Table 5-1, p. 31") and any conditions.
   - `representative`: from a datasheet of a representative part for a generic one ("a typical 5 mm red LED"). `note` names that part.
   - `estimate`: no source found, or derived. `note` says what was assumed or the arithmetic ("4 x 0.15 ohm alkaline cells"). A value computed from datasheet numbers is an `estimate` with the arithmetic in `note`.
3. **Chip is not board.** A chip datasheet value used for a whole board says "chip, not board" in its `note`. Board extras (power LED, USB-UART bridge idle current) get a number only from the board's schematic or a measurement; otherwise they go into `unaccounted`.
4. **Limits** carry their test `conditions` ("VDD = 3.3 V, 25 C").
5. **Required fields** (spec 3.2 table) are never guessed as `datasheet`: if one cannot be sourced it is an `estimate` with a note.
6. **URLs** are opened, and the number is on the page. Never write a URL that was not opened. Prefer the maker's PDF; distributor copies (LCSC, Mouser, DigiKey) and the board maker's schematic (its site or repository) are fine.
7. **Privacy.** No request carries Michael's email or personal data: not in a User-Agent, a form, a query or a header.
8. **Non-numbers** (a rail's `reverse`, `offPath`, what was left out) go in `notes` with the reason.
9. **Two independent reviewers** (spec 3.4) check every patch before it is committed: two fresh subagents that did not do the research, each given only the patch files and this protocol (not the researcher's notes). Each opens every `source`, checks every value, unit, provenance, condition and note, and appends one record to the patch's `review` array:
   ```json
   { "date": "YYYY-MM-DD", "reviewer": "independent reviewer 1", "checked": 0, "corrected": [{ "path": "sim.power.rails[0].dropout", "was": 1.1, "now": 1.3, "why": "Table 3 gives 1.3 V at 800 mA" }], "disputed": [] }
   ```
   The researcher applies every correction. A value the reviewers disagree on becomes an `estimate` with both readings in its `note`, or goes to the controller. The patch is committed only with two review records.

### Task 18: Source batteries, resistors and the KCD1 contact

**Files:**
- Create: `scripts/sim-data/{battery-18650-cell,battery-18650-holder-2s,battery-18650-holder,battery-9v,battery-aa,battery-aaa,battery-cr1220,battery-cr2016,battery-cr2025,battery-cr2032,battery-holder-2xaa,battery-holder-3xaaa,battery-holder-4xaa,battery-holder-cr2032,battery-lr44,resistor,resistor-half-watt,rocker-switch-kcd1}.json`
- Modify (generated): the matching `modules/*.json` (KCD1 through `scripts/gen-mains-loads.mjs`, the rest through `scripts/gen-sim.mjs`)
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol, `validateSim` (Task 16), the pipeline (Task 17).
- Produces, per spec 3.1 and 3.4:
  - every `voltage_source` module: `sim.modelParams.rInternal` (ohm) and `sim.limits` with one `{ "of": { "part": true }, "kind": "sourceCurrent" }` (A), per chemistry. Loose cells (AA, AAA, 9 V, CR coin cells, LR44, 18650 cell): `representative` from a named cell's datasheet. Holders: `estimate` for a generic cell of the holder's chemistry, with the assumed cell in `note` ("the holder is not the cell"). Series holders multiply per cell, with the arithmetic in `note`.
  - `resistor`: `sim.limits` `[{ "of": { "part": true }, "kind": "power", "value": 0.25 }]`, `representative` (a named 1/4 W axial resistor's datasheet); `resistor-half-watt` the same at 0.5 W.
  - `rocker-switch-kcd1`: `sim.modelParams.contactResistance` (ohm) from the KCD1 datasheet already in the module's `source`.

- [ ] **Step 1: Research and write the patches**

Dispatch a research subagent with this brief, the Sourcing protocol above, and the list of modules and fields. Its result is the 18 patch files with `"review": []`.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-sim.mjs && node scripts/gen-mains-loads.mjs && npm run validate && npm run check:gen`
Expected: each patched module listed, every module valid, every generator matching.

- [ ] **Step 3: Two independent reviewers**

Dispatch two fresh reviewer subagents in parallel, per protocol item 9. Apply their corrections, rerun Step 2.

- [ ] **Step 4: Add the data test block**

Append to `src/sim/data.test.ts`:

```ts
const CELLS = ['battery-18650-cell', 'battery-9v', 'battery-aa', 'battery-aaa', 'battery-cr1220', 'battery-cr2016', 'battery-cr2025', 'battery-cr2032', 'battery-lr44']
const HOLDERS = ['battery-18650-holder', 'battery-18650-holder-2s', 'battery-holder-2xaa', 'battery-holder-3xaaa', 'battery-holder-4xaa', 'battery-holder-cr2032']

describe('batteries, resistors and the KCD1 (spec 3.1, 3.4)', () => {
  it('gives every built-in voltage source an rInternal and a sourceCurrent limit, by chemistry', () => {
    for (const id of [...CELLS, ...HOLDERS]) {
      const sim = simOf(load(id))
      expect(sim?.modelParams?.rInternal?.unit, id).toBe('ohm')
      expect(sim?.limits?.filter((l) => l.kind === 'sourceCurrent' && 'part' in l.of), id).toHaveLength(1)
    }
  })
  it('labels a loose cell representative and a holder an estimate (the holder is not the cell)', () => {
    for (const id of CELLS) expect(simOf(load(id))?.modelParams?.rInternal?.provenance, id).toBe('representative')
    for (const id of HOLDERS) {
      const r = simOf(load(id))?.modelParams?.rInternal
      expect(r?.provenance, id).toBe('estimate')
      expect(r?.note, id).toMatch(/cell/i)
    }
  })
  it('gives a coin cell far more internal resistance than an 18650 (spec 3.1)', () => {
    expect(simOf(load('battery-cr2032'))!.modelParams!.rInternal.value).toBeGreaterThan(50 * simOf(load('battery-18650-cell'))!.modelParams!.rInternal.value)
  })
  it('rates the resistors by package power and the KCD1 by its datasheet contact resistance', () => {
    expect(simOf(load('resistor'))?.limits).toEqual([expect.objectContaining({ of: { part: true }, kind: 'power', value: 0.25, provenance: 'representative' })])
    expect(simOf(load('resistor-half-watt'))?.limits).toEqual([expect.objectContaining({ kind: 'power', value: 0.5 })])
    expect(simOf(load('rocker-switch-kcd1'))?.modelParams?.contactResistance).toMatchObject({ unit: 'ohm', provenance: 'datasheet' })
  })
})
```

Run: `npx vitest run src/sim/data.test.ts src/sim/build.test.ts src/sim/spice.test.ts`
Expected: PASS. (The build and compiler tests use inline cells, so the new battery data does not move their goldens.)

- [ ] **Step 5: Commit**

```bash
git add scripts/sim-data modules src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced battery internal resistance and current limits, resistor power, KCD1 contact resistance

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 19: Source the LED colours

**Files:**
- Modify: `src/sim/ledModels.ts` (`LED_COLOURS`)
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol.
- Produces: for each of red, green, yellow, orange, blue and white, `absMaxCurrent: { value, source }` from one representative 5 mm datasheet per colour (spec 3.4: `representative`; the datasheet's absolute maximum continuous forward current, not its pulsed peak), and `shape` naming that datasheet. N and RS stay the spike's curve for every colour unless the datasheet's IV curve gives two readable points to refit them; a refit is then written with both points in `shape`. Ruling R12: this table is code, not module JSON, so the patch format here is the TypeScript entry, and the two-reviewer rule applies to it exactly as to a patch (their records go in the commit message body).

- [ ] **Step 1: Research and edit the table**

Dispatch a research subagent with the Sourcing protocol and this brief: "For each colour, find one public 5 mm through-hole LED datasheet of that colour; record its absolute maximum continuous forward current (A) with the URL, the page, and the part number; and whether its typical forward voltage at 20 mA matches the curve shape above." Edit `LED_COLOURS`, for example:

```ts
  red: { n: 3.73, rs: 7.5, shape: 'spike curve; limit from <part number> datasheet, p. <n>', absMaxCurrent: { value: <A>, source: '<URL>' } },
```

with the researched numbers in place of the angle brackets.

- [ ] **Step 2: Two independent reviewers**

Dispatch two fresh reviewer subagents per protocol item 9 on the six entries; apply corrections.

- [ ] **Step 3: Add the data test block and run it**

Append to `src/sim/data.test.ts` (import `LED_COLOURS` from `./ledModels.ts`):

```ts
describe('LED colours (spec 3.4, ruling R12)', () => {
  it('gives every colour a sourced absolute maximum between 10 and 200 mA', () => {
    for (const [colour, c] of Object.entries(LED_COLOURS)) {
      expect(c.absMaxCurrent?.source, colour).toMatch(/^https?:\/\//)
      expect(c.absMaxCurrent!.value, colour).toBeGreaterThan(0.01)
      expect(c.absMaxCurrent!.value, colour).toBeLessThan(0.2)
    }
  })
})
```

Run: `npx vitest run src/sim/data.test.ts src/sim/ledModels.test.ts src/sim/build.test.ts`
Expected: PASS. If the build test's LED limit list now includes the `absMaxCurrent` entry, update that one expectation to add `['absMaxCurrent', <value>, 'representative', 'led-colours.red.absMaxCurrent']` with the sourced red value.

- [ ] **Step 4: Commit**

```bash
git add src/sim/ledModels.ts src/sim/data.test.ts src/sim/build.test.ts
git commit -m "$(cat <<'MSG'
Data: representative absolute maximum current per LED colour

Reviewed by two independent reviewers; their corrections are applied.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 20: Source the ESP32 DevKits

**Files:**
- Create: `scripts/sim-data/esp32-devkit-v1-30.json`, `scripts/sim-data/esp32-devkitc-v4.json`
- Modify (generated by `scripts/gen-boards.mjs`): `modules/esp32-devkit-v1-30.json`, `modules/esp32-devkitc-v4.json`
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; the modules' pins (DevKit V1: `VIN`, `GND`, `GND 2`, `3V3`, `USB`, GPIO pins `D*`, `TX*`, `RX*`, `VP`, `VN`; DevKitC: see `modules/esp32-devkitc-v4.json`).
- Produces, per board (spec 3.4 row 1, 3.2, 3.3, 4.7):
  - `usbPorts: { "USB": { "gnd": "GND" } }`
  - `power.domains`: the 5 V input pin domain (`VIN` on the V1, `5V` on the DevKitC), `USB` (`USB#vbus` / `USB#gnd`), and `3V3`, each with its return and nominal.
  - `power.rails`: the USB-to-5 V path as a `switch` rail with `vf` (the board schematic's diode; `estimate` if the schematic gives no part), and the on-board LDO from the 5 V domain to `3V3` (`ldo`: `vout`, `dropout` at the board's load, `ioutMax`, `iq`, `reverse`) from the datasheet of the regulator the board's schematic names.
  - `power.draw` on `3V3`: `typical` and `peak` (with the peak's condition as its `note`, for example the Wi-Fi transmit mode) from the ESP32 datasheet, each labelled "chip, not board"; `minVolts` from the ESP32's minimum VDD.
  - `gpio`: domain `3V3`; `pins` every GPIO-capable pin of the board (`io` and input-only pins; not power, ground, `EN` or `USB`); `outputResistance` (an `estimate` derived from the datasheet's drive strength, arithmetic in `note`); `pullup`, `pulldown`, `inputLeakage` from the datasheet.
  - `limits`: the per-pin source/sink current as `current` on each GPIO pin, the cumulative IO output current as `ioTotalCurrent` on `3V3`, and the regulator's maximum input as `vinMax` on the 5 V domain.
  - `unaccounted`: the USB-UART bridge's idle current and the power LED unless the schematic gives them a number.

- [ ] **Step 1: Research and write the two patches**

Dispatch a research subagent with the Sourcing protocol, the field list above, and the two module files.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-boards.mjs && npm run validate && npm run check:gen`
Expected: valid; every generator matching.

- [ ] **Step 3: Two independent reviewers**

Per protocol item 9; apply corrections; rerun Step 2.

- [ ] **Step 4: Add the data test block and run it**

```ts
describe('ESP32 DevKits (spec 3.4)', () => {
  for (const [id, five] of [['esp32-devkit-v1-30', 'VIN'], ['esp32-devkitc-v4', '5V']] as const)
    it(`${id}: three domains, a USB diode and an LDO, a chip draw labelled as chip, GPIO and limits`, () => {
      const sim = simOf(load(id))!
      expect(sim.usbPorts).toEqual({ USB: { gnd: 'GND' } })
      expect(sim.power!.domains.map((d) => d.name).sort()).toEqual(['3V3', five, 'USB'].sort())
      expect(sim.power!.rails!.map((r) => r.kind).sort()).toEqual(['ldo', 'switch'])
      const draw = sim.power!.draw!.find((d) => d.domain === '3V3')!
      expect(draw.typical.note).toMatch(/chip, not board/)
      expect(draw.peak?.note).toBeTruthy()
      expect(draw.minVolts).toBeDefined()
      expect(sim.gpio!.domain).toBe('3V3')
      expect(sim.gpio!.pins.length).toBeGreaterThan(15)
      expect(sim.limits!.some((l) => l.kind === 'ioTotalCurrent')).toBe(true)
    })
})
```

Run: `npx vitest run src/sim/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sim-data modules src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced power, regulator, GPIO and limits for the ESP32 DevKit V1 and DevKitC V4

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 21: Source the displays and the MCP23017 breakout

**Files:**
- Create: `scripts/sim-data/oled-ssd1306-096-i2c.json`, `scripts/sim-data/lcd-st7796s-4in-spi-touch.json`, `scripts/sim-data/mcp23017-cjmcu-2317.json`
- Modify (generated by `scripts/gen-parts.mjs`): the three module files
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; the modules' power pins (`VCC`, `GND`; the LCD's `LED`; the breakout's `VCC`, `VCC 2`, `GND`, `GND 2` pads).
- Produces (spec 3.4 rows 2 to 4):
  - OLED: `power.domains` `VCC`; `power.draw` on `VCC` from the SSD1306 datasheet plus the module's own regulator: `typical` and `peak` stated as a range of pixel content, the conditions in each `note` (`peak` "all pixels on"); `minVolts` from the module regulator's dropout or the SSD1306 minimum, whichever the module needs.
  - LCD: domains `VCC` and `LED` (the backlight pin, to `GND`); `draw` on `VCC` (the controller) and on `LED` (the backlight: from the module's documentation if it gives one; otherwise an `estimate` naming the backlight LED count from the board).
  - MCP23017 breakout: domain `VCC`; `draw` from the MCP23017 datasheet (chip), plus the module's power LED as part of `typical` only if the breakout has one and its resistor can be read (else `unaccounted`); `limits`: per-pin `current` on the GPA/GPB pins and the chip's maximum VDD/VSS current as `ioTotalCurrent` on `VCC`.

- [ ] **Step 1: Research and write the three patches**

Dispatch a research subagent with the Sourcing protocol and the field list.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-parts.mjs && npm run validate && npm run check:gen`
Expected: valid; every generator matching.

- [ ] **Step 3: Two independent reviewers**

Per protocol item 9; apply corrections; rerun Step 2.

- [ ] **Step 4: Add the data test block and run it**

```ts
describe('displays and the MCP23017 breakout (spec 3.4)', () => {
  it('gives the OLED a pixel-dependent draw with its conditions', () => {
    const d = simOf(load('oled-ssd1306-096-i2c'))!.power!.draw!.find((x) => x.domain === 'VCC')!
    expect(d.peak!.value).toBeGreaterThan(d.typical.value)
    expect(d.peak!.note).toMatch(/pixel/i)
  })
  it('splits the LCD into its controller and its backlight', () => {
    const sim = simOf(load('lcd-st7796s-4in-spi-touch'))!
    expect(sim.power!.draw!.map((d) => d.domain).sort()).toEqual(['LED', 'VCC'])
  })
  it('gives the MCP23017 breakout a chip draw and per-pin limits', () => {
    const sim = simOf(load('mcp23017-cjmcu-2317'))!
    expect(sim.power!.draw!.length).toBeGreaterThan(0)
    expect(sim.limits!.some((l) => l.kind === 'current' && 'pin' in l.of && l.of.pin === 'GPA0')).toBe(true)
  })
})
```

Run: `npx vitest run src/sim/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sim-data modules src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced draw for the SSD1306 OLED, the ST7796S LCD and its backlight, and the MCP23017 breakout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 22: Source the IP5306 and AMS1117 modules

**Files:**
- Create: `scripts/sim-data/ip5306-usbc-module.json`, `scripts/sim-data/ams1117-33-module.json`
- Modify (generated by `scripts/gen-power.mjs`): the two module files
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; pins (IP5306 module: `B+`, `B-`, `5V+`, `5V-`, `K`, `USB-C`; AMS1117 module: `VIN`, `OUT`, `GND`).
- Produces (spec 3.4 rows 5 and 6):
  - IP5306 module: `usbPorts: { "USB-C": { "gnd": "B-" } }`; domains `BAT` (`B+`/`B-`), `OUT` (`5V+`/`5V-`), `USB` (`USB-C#vbus`/`USB-C#gnd`); a `boost` rail `BAT` to `OUT` with `vout`, `efficiency` at the module's operating point (from the datasheet's efficiency curve, the point named in `note`), `vinMin` (the low-battery shutdown), `vinMax`, `ioutMax`, `minLoad` (the light-load automatic shutdown, with its delay in `note`), `reverse`, `offPath` (whether the output follows the battery when off: from the datasheet, else `estimate` with the reason in `notes`); a `draw` on `BAT` for the chip's standby current; `limits` `vinMax` on `USB` from the input limits. Charging from USB-C is not modelled in this slice: say so in `notes`.
  - AMS1117 module: domains `VIN` and `OUT`; an `ldo` rail with `vout`, `dropout` (at the module's rated current, the condition in `note`), `ioutMax`, `iq`, `reverse` (from the datasheet's discussion of reverse current, else `blocks` with the reason in `notes`); `limits` `vinMax` on `VIN`.

- [ ] **Step 1: Research and write the two patches**

Dispatch a research subagent with the Sourcing protocol and the field list.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-power.mjs && npm run validate && npm run check:gen`
Expected: valid; every generator matching.

- [ ] **Step 3: Two independent reviewers**

Per protocol item 9; apply corrections; rerun Step 2.

- [ ] **Step 4: Add the data test block and run it**

```ts
describe('the IP5306 and AMS1117 modules (spec 3.4)', () => {
  it('models the IP5306 as a boost with its light-load shutdown', () => {
    const r = simOf(load('ip5306-usbc-module'))!.power!.rails!.find((x) => x.kind === 'boost')!
    expect(r.inputs).toEqual([{ domain: 'BAT', via: 'direct' }])
    expect(r.output).toBe('OUT')
    expect(r.minLoad?.note).toBeTruthy()
    expect(r.efficiency!.note).toBeTruthy()
  })
  it('models the AMS1117 as an LDO from VIN to OUT', () => {
    const r = simOf(load('ams1117-33-module'))!.power!.rails![0]
    expect([r.kind, r.output, r.vout?.value]).toEqual(['ldo', 'OUT', 3.3])
  })
})
```

Run: `npx vitest run src/sim/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sim-data modules src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced IP5306 boost (efficiency, shutdown, minimum load) and AMS1117 LDO models

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 23: Source the Arduino Uno, Nano and Pi Pico

**Files:**
- Create: `scripts/sim-data/arduino-uno-r3.json`, `scripts/sim-data/arduino-nano.json`, `scripts/sim-data/rpi-pico.json`
- Modify (generated by `scripts/gen-arduino.mjs`, `scripts/gen-boards.mjs`, `scripts/gen-picos.mjs`): the three module files
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; each module's power pins (`VIN`, `5V`, `3V3`, `GND*`, `USB`; the Pico's `VBUS`, `VSYS`, `3V3(OUT)`, `3V3_EN`, `GND*`, `USB`).
- Produces (spec 3.4 last row: "As for the ESP32 rows: chip datasheet labelled as chip, and the regulator from the board schematic"):
  - Uno and Nano: domains for `VIN`, `5V`, `3V3`, `USB`; the 5 V regulator from `VIN` (an `ldo`), the USB path to `5V` (a `switch` rail: the Uno's USB power switch and fuse, the Nano's Schottky, per each board's schematic), the 3.3 V supply (the Uno's 3.3 V LDO; the Nano's from its USB-UART chip, per its schematic); `draw` on `5V` from the ATmega328P datasheet (chip); `gpio` domain `5V` with every D and A pin; per-pin and package current limits.
  - Pico: domains `VBUS`, `VSYS`, `3V3`, `USB`; the `VBUS`-to-`VSYS` Schottky as a `switch` rail; the RT6150 buck-boost from `VSYS` to `3V3` as a `buck` rail whose `vinMin` sits below `vout` (it boosts below 3.3 V; say so in `notes`); `draw` on `3V3` from the RP2040 datasheet (chip); `gpio` domain `3V3` with every GP pin; limits.

- [ ] **Step 1: Research and write the three patches**

Dispatch a research subagent with the Sourcing protocol and the field list.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-arduino.mjs && node scripts/gen-boards.mjs && node scripts/gen-picos.mjs && npm run validate && npm run check:gen`
Expected: valid; every generator matching.

- [ ] **Step 3: Two independent reviewers**

Per protocol item 9; apply corrections; rerun Step 2.

- [ ] **Step 4: Add the data test block and run it**

```ts
describe('Arduino Uno, Nano and Pi Pico (spec 3.4)', () => {
  it.each([['arduino-uno-r3', '5V'], ['arduino-nano', '5V'], ['rpi-pico', '3V3']])('%s: chip draw labelled as chip, a regulator, GPIO on %s', (id, io) => {
    const sim = simOf(load(id))!
    expect(sim.power!.draw!.some((d) => /chip, not board/.test(d.typical.note ?? ''))).toBe(true)
    expect(sim.power!.rails!.some((r) => r.kind !== 'switch')).toBe(true)
    expect(sim.gpio!.domain).toBe(io)
  })
})
```

Run: `npx vitest run src/sim/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sim-data modules src/sim/data.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced power paths, regulators, GPIO and limits for the Arduino Uno, Nano and Pi Pico

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 24: Source the external supplies

**Files:**
- Create: `scripts/sim-data/{computer-usb-port,charger-usb-5v-au,charger-usb-5v-eu,charger-usb-5v-uk,charger-usb-5v-us,hlk-pm01,hlk-pm03,irm-03-3v3,irm-03-5,irm-05-5,adapter-barrel-au,adapter-barrel-eu,adapter-barrel-uk,adapter-barrel-us}.json`
- Modify (generated by `scripts/gen-usb.mjs`, `scripts/gen-mains-loads.mjs`, `scripts/gen-mains-plugs.mjs` and `scripts/gen-sim.mjs`): those module files
- Test: `src/sim/data.test.ts` (add a block)

**Interfaces:**
- Consumes: the Sourcing protocol; spec 4.7 ("only a part that *is* an external supply gets a standalone source: the computer port, a wall adapter, a power bank. Its `imax` is the limit") and the spec 4 table (an AC-DC converter's output is a DC source only when powered in the saved contact state).
- Produces: for each module, `power.domains` for its DC output and `power.source` `{ domain, voltage, rInternal, imax }`:
  - `computer-usb-port`: domain on `USB#vbus` / `USB#gnd` (ruling R5); `voltage` `representative` from the USB 2.0 specification's VBUS range (the nominal in `value`, the range in `note`); `rInternal` an `estimate`; `imax` the port's declared or default current.
  - USB chargers: domain `5V`/`GND`; `voltage`, `imax` from a representative 5 V USB charger datasheet or the product listing in the module's `source` (`representative`), `rInternal` an `estimate`.
  - HLK-PM01/PM03, IRM-03-3V3, IRM-03-5, IRM-05-5: domain on the output pins; `voltage`, `imax` (rated output current) from each maker's datasheet (`datasheet`); `rInternal` an `estimate` derived from the load regulation figure (arithmetic in `note`).
  - Barrel adapters: domain `+`/`-`; `voltage` `"param:voltage"` (the user's setting); `imax` and `rInternal` `estimate`s naming a typical adapter of that voltage.

- [ ] **Step 1: Research and write the patches**

Dispatch a research subagent with the Sourcing protocol and the field list.

- [ ] **Step 2: Regenerate and validate**

Run: `node scripts/gen-usb.mjs && node scripts/gen-mains-loads.mjs && node scripts/gen-mains-plugs.mjs && node scripts/gen-sim.mjs && npm run validate && npm run check:gen`
Expected: valid; every generator matching.

- [ ] **Step 3: Two independent reviewers**

Per protocol item 9; apply corrections; rerun Step 2.

- [ ] **Step 4: Add the data test block and run it**

```ts
describe('external supplies (spec 4.7)', () => {
  const ids = ['computer-usb-port', 'charger-usb-5v-us', 'hlk-pm01', 'irm-05-5', 'adapter-barrel-us']
  it.each(ids)('%s is a standalone source with an imax', (id) => {
    const s = simOf(load(id))!.power!.source!
    expect(s.imax?.unit).toBe('A')
    expect(s.rInternal.provenance).toBe('estimate')
  })
  it('lets a barrel adapter take the user voltage', () => {
    expect(simOf(load('adapter-barrel-us'))!.power!.source!.voltage).toBe('param:voltage')
  })
})
```

Run: `npx vitest run src/sim/data.test.ts src/sim/power.test.ts`
Expected: PASS. The power test's "no power data" host case used `computer-usb-port`, which now has power data: change that test to a host with no power data, a Pi 4's USB 2.0 port:

```ts
    const c = buildCircuit(sheet([{ uid: 'j1', module: 'rpi-4-model-b' }, { uid: 'u1', module: boardModule() }], [['j1.USB2-1', 'u1.USB']]))
    expect(c.unsimulated).toContainEqual({ part: 'u1', reason: 'powered from J1 over USB, which has no power data' })
```

- [ ] **Step 5: Run the whole Phase C set and commit**

Run: `npm test && npm run validate && npm run check:gen && npm run build`
Expected: all PASS.

```bash
git add scripts/sim-data modules src/sim/data.test.ts src/sim/power.test.ts
git commit -m "$(cat <<'MSG'
Data: sourced external supplies (computer port, USB chargers, HLK and IRM modules, barrel adapters)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: Astra review of phase C

The review covers spec checkpoint 5: `electrical.sim` validation and the sourced numbers. The two independent reviewers have already verified the numbers (each patch carries two `review` records); Astra reviews the modelling choices (`notes`, `unaccounted`, the estimates and how they are labelled). Before it: `npm test`, `npm run build`, `npm run validate` and `npm run check:gen` pass.

---

# Phase D: results, session, CLI `sim`, gate/4 and probes in netlists

### Task 25: Probes in sheets and netlists

**Files:**
- Modify: `src/format/diagram.ts` (types `ProbeAnchor`, `Probe`, field `Diagram.probes`, validation), `src/agent/netlist.ts` (`probes` in a netlist), `src/agent/layout.ts` (resolve them onto the sheet), `src/agent/extract.ts` (write them back in ref form), `src/cli/netlistCmd.ts` and `src/cli/layoutCmd.ts` (print probe warnings), `src/editor/ops.ts` (`deleteSelection` drops probes of deleted parts)
- Create: `src/sim/probes.ts`
- Test: `src/sim/probes.test.ts`

**Interfaces:**
- Consumes: `layoutNetlist`, `extractNetlist`, `sheetNets` (Task 9), `parseNetlist` and its `byName` helper, `naturalCompare`, `nodeKey`.
- Produces:
  - `src/format/diagram.ts`: `interface ProbeAnchor { part: string; pin?: string }`, `interface Probe { id: string; name?: string; at: ProbeAnchor }`, `Diagram.probes?: Probe[]`, `const PROBE_ID = /^P[1-9]\d*$/`
  - `src/agent/netlist.ts`: `interface NetlistProbe { id: string; name?: string; at: string; ref?: string }`; `Intent.probes: NetlistProbe[]`; `Intent.probeWarnings: string[]`
  - `src/sim/probes.ts`: `nextProbeId(d: Diagram): string`, `addProbe(d: Diagram, at: ProbeAnchor, name?: string): { diagram: Diagram; id: string }`, `removeProbe(d: Diagram, id: string): Diagram`, `renameProbe(d: Diagram, id: string, name: string): Diagram`, `probesForSheet(intent: Intent): Probe[]`, `probesForNetlist(probes: Probe[], refOf: Map<string, string>, nets: { name: string; keys: string[] }[], warn?: (m: string) => void): NetlistProbe[]`
  - `extractNetlist(d: Diagram, warn?: (message: string) => void)` (new optional argument)

- [ ] **Step 1: Write the failing tests**

`src/sim/probes.test.ts`:

```ts
// Spec 6.2: probes are saved in the sheet anchored to part uids and pins; in a netlist they are refs
// and net names; layout resolves net: to a pin, extract writes them back (a probe on a part extract
// removes becomes net:<name>), and a sheet -> netlist -> layout -> sheet round trip keeps them,
// a breadboard hole included. A dangling or malformed probe is dropped with a warning.
import { describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { extractNetlist } from '../agent/extract.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { deleteSelection } from '../editor/ops.ts'
import { addProbe, probesForNetlist, removeProbe, renameProbe } from './probes.ts'

const withProbes = () => ({
  ...ledNetlist(),
  probes: [
    { id: 'P1', name: 'BT1 plus', at: 'BT1.+' },
    { id: 'P2', at: 'D1' },
    { id: 'P3', at: 'net:LED_A' },
    { id: 'P4', at: 'BB1.top+' },
  ],
})
const laid = (n: unknown) => {
  const r = layoutNetlist(n)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value
}

describe('probes', () => {
  it('lays netlist probes onto the sheet: net: picks the lowest ref on the net', () => {
    expect(laid(withProbes()).diagram.probes).toEqual([
      { id: 'P1', name: 'BT1 plus', at: { part: 'BT1', pin: '+' } },
      { id: 'P2', at: { part: 'D1' } },
      { id: 'P3', at: { part: 'D1', pin: 'A' } },
      { id: 'P4', at: { part: 'BB1', pin: 'top+' } },
    ])
  })
  it('prefers the part the probe is named after on a net: probe', () => {
    const n = { ...ledNetlist(), probes: [{ id: 'P1', name: 'R1 output', at: 'net:LED_A' }] }
    expect(laid(n).diagram.probes).toEqual([{ id: 'P1', name: 'R1 output', at: { part: 'R1', pin: '2' } }])
  })
  it('round-trips sheet -> netlist -> layout -> sheet, a breadboard hole included', () => {
    const s1 = laid(withProbes()).diagram
    const n2 = extractNetlist(s1) as { probes: unknown[] }
    expect(n2.probes).toEqual([
      { id: 'P1', name: 'BT1 plus', at: 'BT1.+' },
      { id: 'P2', at: 'D1' },
      { id: 'P3', at: 'D1.A' },
      { id: 'P4', at: 'BB1.top+' },
    ])
    expect(laid(n2).diagram.probes).toEqual(s1.probes)
  })
  it('remaps a probe on a part extract leaves out to net:<name>, and drops a part probe there with a warning', () => {
    const warnings: string[] = []
    const out = probesForNetlist(
      [{ id: 'P1', at: { part: 'rail9', pin: '+' } }, { id: 'P2', at: { part: 'rail9' } }],
      new Map([['u1', 'U1']]),
      [{ name: 'VCC', keys: [JSON.stringify(['rail9', '+']), JSON.stringify(['u1', 'VIN'])] }],
      (w) => warnings.push(w),
    )
    expect(out).toEqual([{ id: 'P1', at: 'net:VCC' }])
    expect(warnings).toEqual(['probe P2 sat on a part the netlist leaves out (rail9), so it was dropped'])
  })
  it('drops a dangling or malformed probe on load, with a warning, never an error', () => {
    const s = laid(withProbes()).diagram
    const r = validateDiagram({ ...s, probes: [...(s.probes ?? []), { id: 'P5', at: { part: 'nope' } }, { id: 'P1', at: { part: 'D1' } }, { id: 'X', at: { part: 'D1' } }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.probes).toHaveLength(4)
    expect(r.warnings.filter((w) => w.startsWith('probes['))).toEqual([
      'probes[4]: no part "nope", so the probe was dropped',
      'probes[5]: its id P1 is used twice, so the probe was dropped',
      'probes[6]: its id must be P and a number (P1, P2, ...), so the probe was dropped',
    ])
  })
  it('drops a netlist probe that names nothing, with a warning in the intent', () => {
    const r = layoutNetlist({ ...ledNetlist(), probes: [{ id: 'P1', at: 'Q9.1' }, { id: 'P2', at: 'net:NOPE' }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.diagram.probes).toBeUndefined()
    expect(r.value.intent.probeWarnings).toEqual(['probes[0]: no part "Q9", so the probe was dropped', 'probes[1]: no net "NOPE", so the probe was dropped'])
  })
  it('adds, renames and removes probes, and deleting a part takes its probes with it', () => {
    const s = laid(ledNetlist()).diagram
    const a = addProbe(s, { part: 'D1', pin: 'A' })
    expect(a.id).toBe('P1')
    const b = addProbe(a.diagram, { part: 'R1' }, 'resistor')
    expect(b.id).toBe('P2')
    expect(renameProbe(b.diagram, 'P1', 'anode').probes?.[0]).toEqual({ id: 'P1', name: 'anode', at: { part: 'D1', pin: 'A' } })
    expect(removeProbe(b.diagram, 'P1').probes?.map((p) => p.id)).toEqual(['P2'])
    expect(deleteSelection(b.diagram, { parts: ['D1'], wires: [] }).probes?.map((p) => p.id)).toEqual(['P2'])
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/probes.test.ts`
Expected: FAIL, `./probes.ts` cannot be found.

- [ ] **Step 3: Sheet format and validation**

In `src/format/diagram.ts` add the types next to `Annotation`, and the field to `Diagram`:

```ts
/** Where a probe reads (live-simulation spec 6.2): a part (current per pin, and power) or one of its pins or hole groups. */
export interface ProbeAnchor { part: string; pin?: string }
export interface Probe { id: string; name?: string; at: ProbeAnchor }
/** A probe id: P and a whole number from 1. */
export const PROBE_ID = /^P[1-9]\d*$/
```

```ts
  /** Saved probes (spec 6.2): readouts anchored to part uids and pins, never wires. */
  probes?: Probe[]
```

Add a checker above `validateDiagram`:

```ts
/** What is wrong with one stored probe, or null. `pinsOf` gives a part's pin and hole names, null when its module is not embedded, undefined when there is no such part. */
function probeProblem(p: unknown, ids: Set<string>, pinsOf: (uid: string) => Set<string> | null | undefined): string | null {
  if (!isObj(p)) return 'must be { "id", "name"?, "at": { "part", "pin"? } }'
  for (const k of Object.keys(p)) if (!['id', 'name', 'at'].includes(k)) return `unknown field "${k}"`
  if (typeof p.id !== 'string' || !PROBE_ID.test(p.id)) return 'its id must be P and a number (P1, P2, ...)'
  if (ids.has(p.id)) return `its id ${p.id} is used twice`
  if (p.name !== undefined && !(typeof p.name === 'string' && p.name.trim() && p.name.length <= 40)) return 'its name must be text, at most 40 characters'
  if (!isObj(p.at) || typeof p.at.part !== 'string' || (p.at.pin !== undefined && typeof p.at.pin !== 'string')) return 'its anchor must be { "part", "pin"? }'
  const pins = pinsOf(p.at.part)
  if (pins === undefined) return `no part "${p.at.part}"`
  if (typeof p.at.pin === 'string' && pins && !pins.has(p.at.pin)) return `part "${p.at.part}" has no pin "${p.at.pin}"`
  return null
}
```

In `validateDiagram`, after the `notes` block:

```ts
  // Probes (spec 6.2): a bad or dangling one is dropped with a warning, never an error.
  let probesFix: Probe[] | undefined | null = null
  if (raw.probes !== undefined) {
    if (!Array.isArray(raw.probes)) {
      probesFix = undefined
      warnings.push('probes: must be a list, so it was dropped')
    } else {
      const kept: Probe[] = []
      const ids = new Set<string>()
      const pinsOf = (uid: string): Set<string> | null | undefined => {
        if (!partModule.has(uid)) return undefined
        const m = modules.get(partModule.get(uid)!)
        return m ? new Set([...m.pins.flatMap((x) => ('name' in x && typeof x.name === 'string' ? [x.name] : [])), ...(m.holes ?? []).map((h) => h.name)]) : null
      }
      raw.probes.forEach((p, i) => {
        const why = probeProblem(p, ids, pinsOf)
        if (why) return void warnings.push(`probes[${i}]: ${why}, so the probe was dropped`)
        kept.push(p as Probe)
        ids.add((p as Probe).id)
      })
      if (kept.length !== raw.probes.length) probesFix = kept
    }
  }
```

and where the notes fix is applied (after `if (errors.length) return ...`):

```ts
  if (probesFix !== null) {
    const { probes: _p, ...rest } = diagram
    diagram = probesFix?.length ? { ...rest, probes: probesFix } : rest
  }
```

- [ ] **Step 4: Netlist probes, layout and extract**

In `src/agent/netlist.ts`, add `NetlistProbe` and the two `Intent` fields, and parse `raw.probes` after the nets are known (before `if (errors.length) return`):

```ts
export interface NetlistProbe { id: string; name?: string; at: string; ref?: string }
```

```ts
  /** Probes (spec 6.2): "REF.PIN", "REF" or "net:NAME"; `ref` (ruling R6) is kept, not used for readings. */
  probes: NetlistProbe[]
  /** Probes that named nothing, each dropped with this warning (never an error, spec 6.2). */
  probeWarnings: string[]
```

```ts
  const probes: NetlistProbe[] = []
  const probeWarnings: string[] = []
  if (raw.probes !== undefined) {
    if (!Array.isArray(raw.probes)) probeWarnings.push('probes: must be a list, so it was dropped')
    else {
      const ids = new Set<string>()
      const netNames = new Set(nets.map((n) => n.name))
      raw.probes.forEach((p, i) => {
        const drop = (why: string) => void probeWarnings.push(`probes[${i}]: ${why}, so the probe was dropped`)
        if (!isObj(p) || typeof p.at !== 'string') return drop('must be { "id", "name"?, "at", "ref"? }')
        if (typeof p.id !== 'string' || !/^P[1-9]\d*$/.test(p.id)) return drop('its id must be P and a number (P1, P2, ...)')
        if (ids.has(p.id)) return drop(`its id ${p.id} is used twice`)
        if (p.name !== undefined && !(typeof p.name === 'string' && p.name.trim() && p.name.length <= 40)) return drop('its name must be text, at most 40 characters')
        if (p.ref !== undefined && !(typeof p.ref === 'string' && p.ref.startsWith('net:') && netNames.has(p.ref.slice(4)))) return drop(`its ref must be net:<a net of this netlist>`)
        let at = p.at
        if (at.startsWith('net:')) {
          if (!netNames.has(at.slice(4))) return drop(`no net "${at.slice(4)}"`)
        } else {
          const dot = at.indexOf('.')
          const ref = dot < 0 ? at : at.slice(0, dot)
          const hit = byRef.get(ref)
          if (!hit) return drop(`no part "${ref}"`)
          if (dot >= 0) {
            const r = byName(hit.module, ref, at.slice(dot + 1), `probes[${i}].at`)
            if (!r.ok) return drop(r.error.replace(/^probes\[\d+\]\.at: /, ''))
            at = `${ref}.${r.t.name}`
          }
        }
        ids.add(p.id)
        probes.push({ id: p.id, ...(typeof p.name === 'string' ? { name: p.name } : {}), at, ...(typeof p.ref === 'string' ? { ref: p.ref } : {}) })
      })
    }
  }
```

Return them in the intent object: add `probes, probeWarnings,` next to `copies`.

`src/sim/probes.ts`:

```ts
// Probes (spec 6.2): editing ops for the sheet, and the mapping between a sheet's probes (part uids
// and pins) and a netlist's (refs and net names). Pure.
import type { Diagram, Probe, ProbeAnchor } from '../format/diagram.ts'
import type { Intent, NetlistProbe } from '../agent/netlist.ts'
import { naturalCompare } from '../agent/order.ts'
import { nodeKey } from '../format/netlist.ts'

export function nextProbeId(d: Diagram): string {
  const n = Math.max(0, ...(d.probes ?? []).map((p) => Number(p.id.slice(1))))
  return `P${n + 1}`
}
export function addProbe(d: Diagram, at: ProbeAnchor, name?: string): { diagram: Diagram; id: string } {
  const id = nextProbeId(d)
  return { id, diagram: { ...d, probes: [...(d.probes ?? []), { id, ...(name ? { name } : {}), at }] } }
}
export function removeProbe(d: Diagram, id: string): Diagram {
  const probes = (d.probes ?? []).filter((p) => p.id !== id)
  const { probes: _p, ...rest } = d
  return probes.length ? { ...rest, probes } : rest
}
export function renameProbe(d: Diagram, id: string, name: string): Diagram {
  const clean = name.trim().slice(0, 40)
  return { ...d, probes: (d.probes ?? []).map((p) => (p.id !== id ? p : clean ? { ...p, name: clean } : { id: p.id, at: p.at })) }
}

/** Layout (spec 6.2): netlist probes on the laid-out sheet, whose uids are the refs. net: picks a pin of the part the probe's name starts with, else the lowest ref. */
export function probesForSheet(intent: Intent): Probe[] {
  return intent.probes.map((p): Probe => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    if (p.at.startsWith('net:')) {
      const net = intent.nets.find((n) => n.name === p.at.slice(4))!
      const pins = net.terminals.some((t) => !t.infra) ? net.terminals.filter((t) => !t.infra) : net.terminals
      const named = p.name?.trim().split(/\s+/)[0]
      const pick = pins.find((t) => t.ref === named) ?? [...pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
      return { ...base, at: { part: pick.ref, pin: pick.name } }
    }
    const dot = p.at.indexOf('.')
    return { ...base, at: dot < 0 ? { part: p.at } : { part: p.at.slice(0, dot), pin: p.at.slice(dot + 1) } }
  })
}

/** Extract (spec 6.2): sheet probes in ref form; a pin probe on a part the netlist leaves out becomes net:<its net>; a part probe there is dropped with a warning. */
export function probesForNetlist(probes: Probe[], refOf: Map<string, string>, nets: { name: string; keys: string[] }[], warn?: (m: string) => void): NetlistProbe[] {
  return probes.flatMap((p): NetlistProbe[] => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    const ref = refOf.get(p.at.part)
    if (ref) return [{ ...base, at: p.at.pin ? `${ref}.${p.at.pin}` : ref }]
    const key = p.at.pin !== undefined ? nodeKey(p.at.part, p.at.pin) : null
    const net = key ? nets.find((n) => n.keys.includes(key)) : undefined
    if (net) return [{ ...base, at: `net:${net.name}` }]
    warn?.(`probe ${p.id} sat on a part the netlist leaves out (${p.at.part}), so it was dropped`)
    return []
  })
}
```

In `src/agent/layout.ts`, after the verify check and before `return { ok: true, ... }`:

```ts
    const probes = probesForSheet(intent)
    const placed = probes.length ? { ...diagram, probes } : diagram
```

and return `placed` as `diagram` (import `probesForSheet` from `../sim/probes.ts`). The returned `intent` carries `probeWarnings`.

In `src/agent/extract.ts`, give `extractNetlist` a `warn?: (message: string) => void` argument and add probes to its output (import `probesForNetlist`):

```ts
  const probes = probesForNetlist(d.probes ?? [], refOf, nets, warn)
```

```ts
    ...(probes.length ? { probes } : {}),
```

(as the last field of the returned object). In `src/cli/netlistCmd.ts`, pass `(w) => io.stderr(\`warning: ${w}\n\`)` as the second argument. In `src/cli/layoutCmd.ts`, after a successful layout add the intent's probe warnings to `warnings` before printing:

```ts
  warnings = [...warnings, ...r.value.intent.probeWarnings]
  if (!json) for (const w of r.value.intent.probeWarnings) io.stderr(`warning: ${w}\n`)
```

In `src/editor/ops.ts`, `deleteSelection` drops the probes of deleted parts (a probe never dangles in memory either):

```ts
export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  const notes = new Set(sel.annotations ?? [])
  const { probes: before, ...rest } = d
  const probes = (before ?? []).filter((p) => !parts.has(p.at.part))
  return {
    ...rest,
    // A deleted board's parts stay on the sheet, unmounted.
    parts: d.parts.filter((p) => !parts.has(p.uid)).map((p) => (p.mount && parts.has(p.mount.board) ? withoutMount(p) : p)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
    // Frames and notes are only rewritten when some are selected, so the key never appears from nothing.
    ...(d.annotations && notes.size ? { annotations: d.annotations.filter((a) => !notes.has(a.uid)) } : {}),
    ...(probes.length ? { probes } : {}),
  }
}
```

- [ ] **Step 5: Run the tests and the suites that touch these files**

Run: `npx vitest run src/sim/probes.test.ts src/agent src/format/diagram.test.ts src/editor/ops.test.ts src/cli/netlistCmd.test.ts src/cli/cli.test.ts`
Expected: PASS. Existing extract goldens are unchanged (no sheet had probes).

- [ ] **Step 6: Commit**

```bash
git add src/format/diagram.ts src/agent/netlist.ts src/agent/layout.ts src/agent/extract.ts src/cli/netlistCmd.ts src/cli/layoutCmd.ts src/editor/ops.ts src/sim/probes.ts src/sim/probes.test.ts
git commit -m "$(cat <<'MSG'
Probes: saved in sheets (part and pin anchors) and netlists (refs and net:), through layout and extract

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 26: Readings, the supply budget and probe readings

**Files:**
- Create: `src/sim/results.ts`
- Test: `src/sim/results.test.ts`

**Interfaces:**
- Consumes: `Circuit`, `Param`, `Basis`, `Corner` (Task 6); `Classification` (Task 12); `RawRun`, `foldValue` (Task 13); `Probe`, `ProbeAnchor` (Task 25); `nodeKey`.
- Produces (spec 5.1):
  - `type Trust = 'ok' | 'outside-model'`
  - `type Reading = { kind: 'value'; value: number; reference: string; trust: Trust } | { kind: 'floating' } | { kind: 'undefined'; why: string }`
  - `type CurrentReading = { kind: 'value'; value: number; trust: Trust } | { kind: 'indeterminate'; why: string }`
  - `interface PartRun { pins: Record<string, CurrentReading>; power: Reading; state?: 'lit' | 'dark' }`, `interface Run { nets: Record<string, Reading>; parts: Record<string, PartRun> }`
  - `type SimCode`, `interface SimFinding { code: SimCode; severity: 'error' | 'warning' | 'note'; parts: string[]; message: string; corner?: Corner; basis: Basis; inputs: string[]; raw?: string }`
  - `interface DomainBudget { id: string; kind: 'source' | 'rail' | 'domain'; part: string; label: string; volts: { typical: Reading; peak: Reading }; amps: { typical: CurrentReading; peak: CurrentReading }; limit?: { value: number; kind: string; basis: Provenance | 'user' }; headroom?: number; basis: Basis }`
  - `interface ProbeReading { id: string; name?: string; at: ProbeAnchor; voltage?: { typical: Reading; peak: Reading }; part?: { typical: PartRun; peak: PartRun } }`
  - `interface SimResult { format: 'circuitoon-sim/1'; revision: number; corners: { typical: Run; peak: Run }; budget: DomainBudget[]; findings: SimFinding[]; unsimulated: { part: string; reason: string }[]; probes: ProbeReading[]; notes: string[]; engine: { name: 'ngspice'; version: string; build: string; runs: number; ms: number } }` (`notes` is additive to the spec's shape: the "shown at rest" and colour notes need a home; ruling R29)
  - `type SimOutcome = { status: 'ok'; result: SimResult } | { status: 'failed'; revision: number; finding: SimFinding; lastGood?: { revision: number; result: SimResult } } | { status: 'unavailable'; reason: string }`
  - `interface Outside { nets: Set<string>; parts: Set<string>; rails: Set<string> }`, `const NO_OUTSIDE: Outside`, `const LIT_AMPS = 1e-4`
  - `function basisOf(params: { basis: Provenance | 'user' }[]): Basis`
  - `function readRun(c: Circuit, cls: Classification, raw: RawRun, out?: Outside): Run`
  - `function budget(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>, out?: Outside): DomainBudget[]`
  - `function probeReadings(probes: Probe[], c: Circuit, corners: { typical: Run; peak: Run }): ProbeReading[]`

- [ ] **Step 1: Write the failing test**

`src/sim/results.test.ts`:

```ts
// Spec 5.1 and 4.4: readings mapped back to nets and parts, each voltage relative to its island's
// reference; floating nodes read "floating" (a probe on a source-less island included), mains reads
// "undefined"; per-pin currents (positive into the pin), power and LED state; the supply budget.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { classify } from './floating.ts'
import { ledHandCalc, ledModel } from './ledModels.ts'
import { basisOf, budget, probeReadings, readRun } from './results.ts'
import type { RawRun } from './spice.ts'
import { cellModule, ldoModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
async function solved(d: Diagram) {
  const c = buildCircuit(d)
  const cls = classify(c)
  const raws: Record<'typical' | 'peak', RawRun> = { typical: { v: {}, pins: {}, dev: {} }, peak: { v: {}, pins: {}, dev: {} } }
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, 1)
    if (r.status !== 'ok') throw new Error(JSON.stringify(r))
    raws[corner] = r.raw
  }
  return { c, cls, raws, run: readRun(c, cls, raws.typical) }
}

describe('readings', () => {
  const led = sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, R('r1', 150), { uid: 'd1', module: 'led' }], [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']])
  it('reads nets relative to the island reference, currents into pins, power and LED state', async () => {
    const { run } = await solved(led)
    const hand = ledHandCalc(5, 150, ledModel('red', 2).model)
    expect(run.nets.D1_A).toMatchObject({ kind: 'value', reference: 'GND', trust: 'ok' })
    expect(run.nets.D1_A.kind === 'value' && run.nets.D1_A.value).toBeCloseTo(hand.anode, 5)
    expect(run.parts.d1.pins.A).toMatchObject({ kind: 'value' })
    expect(run.parts.d1.pins.A.kind === 'value' && run.parts.d1.pins.A.value).toBeCloseTo(hand.amps, 6)
    expect(run.parts.r1.power.kind === 'value' && run.parts.r1.power.value).toBeCloseTo(hand.amps ** 2 * 150, 6)
    expect(run.parts.d1.state).toBe('lit')
    expect(run.parts.bt1.power.kind === 'value' && run.parts.bt1.power.value).toBeLessThan(0)
  }, 60_000)
  it('reads a capacitor-only plate and a source-less island as floating, probes included', async () => {
    const { c, run } = await solved(sheet(
      [{ uid: 'bt1', module: cellModule(5, 0.1) }, R('r1', 100), { uid: 'c1', module: 'capacitor-ceramic' }, R('r8', 100), R('r9', 100)],
      [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-'], ['c1.1', 'r1.1'], ['r8.1', 'r9.1'], ['r8.2', 'r9.2']],
    ))
    expect(run.nets.C1_2).toEqual({ kind: 'floating' })
    expect(run.parts.c1.pins['2']).toMatchObject({ kind: 'indeterminate' })
    const probes = probeReadings([{ id: 'P1', at: { part: 'r8', pin: '1' } }, { id: 'P2', at: { part: 'r8' } }], c, { typical: run, peak: run })
    expect(probes[0].voltage?.typical).toEqual({ kind: 'floating' })
    expect(probes[1].part?.typical.power).toMatchObject({ kind: 'undefined' })
  }, 60_000)
  it('reads mains wiring as undefined, never a number', () => {
    const d = sheet([{ uid: 'o1', module: 'outlet-us-5-15r-duplex' }, { uid: 'p1', module: 'hlk-pm01' }], [['o1.L1', 'p1.AC 1'], ['o1.N1', 'p1.AC 2']])
    const c = buildCircuit(d)
    const run = readRun(c, classify(c), { v: {}, pins: {}, dev: {} })
    const net = c.pinNet[JSON.stringify(['o1', 'L1'])]
    expect(run.nets[net]).toEqual({ kind: 'undefined', why: 'mains wiring is not simulated' })
  })
  it('budgets each source, rail and domain with its limit and headroom', async () => {
    const { c, cls, raws } = await solved(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }, R('r1', 33)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    const b = budget(c, cls, raws)
    const rail = b.find((x) => x.kind === 'rail')!
    expect(rail.volts.typical.kind === 'value' && rail.volts.typical.value).toBeCloseTo(3.29, 1)
    expect(rail.limit).toEqual({ value: 0.8, kind: 'ioutMax', basis: 'datasheet' })
    expect(rail.headroom).toBeCloseTo(0.8 - 0.1, 1)
    const src = b.find((x) => x.kind === 'source')!
    expect(src.amps.typical.kind === 'value' && src.amps.typical.value).toBeGreaterThan(0.1)
    expect(src.limit).toMatchObject({ kind: 'sourceCurrent', value: 2 })
    expect(b.filter((x) => x.kind === 'domain').map((x) => x.label)).toEqual(['U1 IN', 'U1 OUT'])
  }, 60_000)
  it('takes the weakest provenance as the basis, user and datasheet alike', () => {
    expect(basisOf([])).toBe('topology')
    expect(basisOf([{ basis: 'user' }, { basis: 'datasheet' }])).toBe('datasheet')
    expect(basisOf([{ basis: 'user' }])).toBe('user')
    expect(basisOf([{ basis: 'datasheet' }, { basis: 'representative' }])).toBe('representative')
    expect(basisOf([{ basis: 'estimate' }, { basis: 'representative' }])).toBe('estimate')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/results.test.ts`
Expected: FAIL, `./results.ts` cannot be found.

- [ ] **Step 3: Write the readings**

`src/sim/results.ts`:

```ts
// Results (spec 5.1, 4.4): raw engine output mapped back to readings on nets and parts, the supply
// budget, and probe readings. A floating node is never a voltage; each voltage names its island's
// reference and never subtracts across the numerical joins; mains reads "undefined". Currents are
// positive into a pin; a source's current is reported as delivered. Readings outside a rail's
// model are marked, not hidden (spec 4.1, 4.2). Pure.
import type { Probe, ProbeAnchor } from '../format/diagram.ts'
import type { Provenance } from '../format/simModel.ts'
import { nodeKey } from '../format/netlist.ts'
import type { Classification } from './floating.ts'
import type { Basis, Circuit, Corner, Device } from './model.ts'
import { type RawRun, foldValue } from './spice.ts'

export type Trust = 'ok' | 'outside-model'
export type Reading = { kind: 'value'; value: number; reference: string; trust: Trust } | { kind: 'floating' } | { kind: 'undefined'; why: string }
export type CurrentReading = { kind: 'value'; value: number; trust: Trust } | { kind: 'indeterminate'; why: string }
export interface PartRun { pins: Record<string, CurrentReading>; power: Reading; state?: 'lit' | 'dark' }
export interface Run { nets: Record<string, Reading>; parts: Record<string, PartRun> }
export type SimCode =
  | 'sim-short' | 'sim-source-conflict' | 'sim-over-abs-max' | 'sim-over-limit' | 'sim-brownout' | 'sim-dropout' | 'sim-converter-off'
  | 'sim-min-load' | 'sim-outside-model' | 'sim-floating-input' | 'sim-no-convergence' | 'sim-incomplete' | 'sim-estimate'
export interface SimFinding {
  code: SimCode
  severity: 'error' | 'warning' | 'note'
  parts: string[]
  message: string
  corner?: Corner
  basis: Basis
  inputs: string[]
  raw?: string
}
export interface DomainBudget {
  id: string
  kind: 'source' | 'rail' | 'domain'
  part: string
  label: string
  volts: { typical: Reading; peak: Reading }
  amps: { typical: CurrentReading; peak: CurrentReading }
  limit?: { value: number; kind: string; basis: Provenance | 'user' }
  headroom?: number
  basis: Basis
}
export interface ProbeReading { id: string; name?: string; at: ProbeAnchor; voltage?: { typical: Reading; peak: Reading }; part?: { typical: PartRun; peak: PartRun } }
export interface SimResult {
  format: 'circuitoon-sim/1'
  revision: number
  corners: { typical: Run; peak: Run }
  budget: DomainBudget[]
  findings: SimFinding[]
  unsimulated: { part: string; reason: string }[]
  probes: ProbeReading[]
  /** Notes the circuit carries (a relay shown at rest, an LED colour with no model); ruling R29. */
  notes: string[]
  engine: { name: 'ngspice'; version: string; build: string; runs: number; ms: number }
}
export type SimOutcome =
  | { status: 'ok'; result: SimResult }
  | { status: 'failed'; revision: number; finding: SimFinding; lastGood?: { revision: number; result: SimResult } }
  | { status: 'unavailable'; reason: string }

export interface Outside { nets: Set<string>; parts: Set<string>; rails: Set<string> }
export const NO_OUTSIDE: Outside = { nets: new Set(), parts: new Set(), rails: new Set() }
/** An LED is drawn lit above this current (ruling R18). */
export const LIT_AMPS = 1e-4

const RANK = { user: 0, datasheet: 0, representative: 1, estimate: 2 } as const
/** The weakest provenance among the inputs (user = datasheet > representative > estimate); topology with none (spec 5.1). */
export function basisOf(params: { basis: Provenance | 'user' }[]): Basis {
  if (!params.length) return 'topology'
  const worst = Math.max(...params.map((p) => RANK[p.basis]))
  if (worst === 2) return 'estimate'
  if (worst === 1) return 'representative'
  return params.some((p) => p.basis === 'datasheet') ? 'datasheet' : 'user'
}

const tapNet = (c: Circuit, node: string) => c.taps.find((t) => t.node === node)?.net ?? node
const trustOf = (out: Outside, net: string, part?: string): Trust => (out.nets.has(net) || (part !== undefined && out.parts.has(part)) ? 'outside-model' : 'ok')

/** A node's voltage to its island's reference, or floating (spec 4.4). */
function voltageOf(c: Circuit, cls: Classification, raw: RawRun, node: string, out: Outside, part?: string): Reading {
  const isl = cls.islandOf.get(node)
  if (isl === undefined || raw.v[node] === undefined) return { kind: 'floating' }
  const ref = cls.islands[isl].reference
  return { kind: 'value', value: raw.v[node] - (raw.v[ref] ?? 0), reference: tapNet(c, ref), trust: trustOf(out, tapNet(c, node), part) }
}
/** The voltage between two nodes of one island, or floating. */
function across(c: Circuit, cls: Classification, raw: RawRun, a: string, b: string, out: Outside, part?: string): Reading {
  const ia = cls.islandOf.get(a)
  if (ia === undefined || ia !== cls.islandOf.get(b) || raw.v[a] === undefined || raw.v[b] === undefined) return { kind: 'floating' }
  return { kind: 'value', value: raw.v[a] - raw.v[b], reference: tapNet(c, b), trust: trustOf(out, tapNet(c, a), part) }
}

export function readRun(c: Circuit, cls: Classification, raw: RawRun, out: Outside = NO_OUTSIDE): Run {
  const mains = new Set(c.mains.map((k) => c.pinNet[k]).filter((n): n is string => !!n))
  const nets: Record<string, Reading> = {}
  for (const net of [...new Set(Object.values(c.pinNet))].sort())
    nets[net] = mains.has(net) ? { kind: 'undefined', why: 'mains wiring is not simulated' } : voltageOf(c, cls, raw, net, out)
  const parts: Record<string, PartRun> = {}
  for (const uid of Object.keys(c.parts)) {
    const taps = c.taps.filter((t) => t.part === uid)
    const trust: Trust = out.parts.has(uid) ? 'outside-model' : 'ok'
    const pins: Record<string, CurrentReading> = {}
    let power = 0
    let complete = taps.length > 0
    let reference: string | null = null
    for (const t of taps) {
      const i = raw.pins[uid]?.[t.pin]
      if (i === undefined || !Number.isFinite(i)) {
        pins[t.pin] = { kind: 'indeterminate', why: 'nothing drives this pin (floating)' }
        complete = false
        continue
      }
      pins[t.pin] = { kind: 'value', value: i, trust }
      power += raw.v[t.net] * i
      const r = voltageOf(c, cls, raw, t.net, out)
      if (r.kind === 'value') reference ??= r.reference
    }
    const run: PartRun = {
      pins,
      power: complete && reference !== null ? { kind: 'value', value: power, reference, trust } : { kind: 'undefined', why: taps.length ? 'part of it floats' : 'not simulated' },
    }
    const led = c.devices.find((d): d is Extract<Device, { kind: 'diode' }> => d.kind === 'diode' && d.role === 'led' && d.part === uid)
    if (led) {
      const i = raw.pins[uid]?.[led.a.slice(uid.length + 1)]
      run.state = i !== undefined && Math.abs(i) > LIT_AMPS ? 'lit' : 'dark'
    }
    parts[uid] = run
  }
  return { nets, parts }
}

const amps = (value: number | undefined, trust: Trust): CurrentReading =>
  value === undefined || !Number.isFinite(value) ? { kind: 'indeterminate', why: 'not solved (floating)' } : { kind: 'value', value, trust }

export function budget(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>, out: Outside = NO_OUTSIDE): DomainBudget[] {
  const both = <T>(f: (raw: RawRun, corner: Corner) => T) => ({ typical: f(raws.typical, 'typical'), peak: f(raws.peak, 'peak') })
  const headroom = (limit: number | undefined, a: { typical: CurrentReading; peak: CurrentReading }) =>
    limit !== undefined && a.typical.kind === 'value' && a.peak.kind === 'value' ? { headroom: limit - Math.max(Math.abs(a.typical.value), Math.abs(a.peak.value)) } : {}
  const ref = (uid: string) => c.parts[uid]?.ref ?? uid
  const rows: DomainBudget[] = []
  for (const d of c.devices) {
    if (d.kind === 'cell') {
      const lim = d.imax
      const a = both((raw) => amps(raw.dev[d.id], out.parts.has(d.part) ? 'outside-model' : 'ok'))
      rows.push({
        id: d.id, kind: 'source', part: d.part, label: d.role === 'cell' ? ref(d.part) : `${ref(d.part)} ${d.domain ?? 'output'}`,
        volts: both((raw) => across(c, cls, raw, d.p, d.n, out, d.part)), amps: a,
        ...(lim ? { limit: { value: lim.value, kind: lim.label.endsWith('sourceCurrent') ? 'sourceCurrent' : 'imax', basis: lim.basis } } : {}),
        ...headroom(lim?.value, a), basis: basisOf([d.volts, d.rInternal, ...(lim ? [lim] : [])]),
      })
    }
    if (d.kind === 'rail') {
      const r = d.rail
      const a = both((raw) => amps(raw.dev[d.id], out.rails.has(d.id) ? 'outside-model' : 'ok'))
      rows.push({
        id: d.id, kind: 'rail', part: d.part, label: `${ref(d.part)} ${r.output} ${r.kind === 'ldo' ? 'regulator' : r.kind}`,
        volts: both((raw) => across(c, cls, raw, d.out, d.ret, out, d.part)), amps: a,
        ...(r.ioutMax ? { limit: { value: r.ioutMax.value, kind: 'ioutMax', basis: r.ioutMax.basis } } : {}),
        ...headroom(r.ioutMax?.value, a), basis: basisOf([...(r.vout ? [r.vout] : []), ...(r.ioutMax ? [r.ioutMax] : [])]),
      })
    }
  }
  for (const dom of c.domains) {
    const loads = c.devices.filter((d): d is Extract<Device, { kind: 'load' }> => d.kind === 'load' && d.part === dom.part && d.domain === dom.name)
    const volts = both((raw) => across(c, cls, raw, dom.pin, dom.ret, out, dom.part))
    const a = both((raw, corner) => {
      const v = across(c, cls, raw, dom.pin, dom.ret, out, dom.part)
      if (v.kind !== 'value') return amps(undefined, 'ok')
      return amps(loads.reduce((s, l) => s + (corner === 'peak' ? l.peak.value : l.typical.value) * foldValue(v.value, l.minVolts.value), 0), v.trust)
    })
    rows.push({ id: `${dom.part}.domain.${dom.name}`, kind: 'domain', part: dom.part, label: `${ref(dom.part)} ${dom.name}`, volts, amps: a, basis: basisOf(loads.flatMap((l) => [l.typical, l.peak])) })
  }
  return rows
}

const NOT_SIMULATED: PartRun = { pins: {}, power: { kind: 'undefined', why: 'not simulated' } }

export function probeReadings(probes: Probe[], c: Circuit, corners: { typical: Run; peak: Run }): ProbeReading[] {
  return probes.map((p) => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}), at: p.at }
    if (p.at.pin === undefined) return { ...base, part: { typical: corners.typical.parts[p.at.part] ?? NOT_SIMULATED, peak: corners.peak.parts[p.at.part] ?? NOT_SIMULATED } }
    const net = c.pinNet[nodeKey(p.at.part, p.at.pin)]
    const read = (run: Run): Reading => (net !== undefined && run.nets[net]) || { kind: 'floating' }
    return { ...base, voltage: { typical: read(corners.typical), peak: read(corners.peak) } }
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/results.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/results.ts src/sim/results.test.ts
git commit -m "$(cat <<'MSG'
Sim: readings (island references, floating, mains undefined), supply budget and probe readings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 27: Findings decided from the circuit (topological codes)

**Files:**
- Create: `src/sim/findings.ts`
- Test: `src/sim/findings.topology.test.ts`

**Interfaces:**
- Consumes: `Circuit`, `Device`, `Param`, `Corner` (Task 6); `Classification`, `pinState` (Task 12); `NO_POWER_DATA` (Task 6); `basisOf`, `SimCode`, `SimFinding` (Task 26); `formatValue` (`values.ts`); `andList` (`words.ts`).
- Produces:
  - `const SIM_TITLES: Record<SimCode, string>`
  - `interface Draft { code: SimCode; severity: 'error' | 'warning' | 'note'; parts: string[]; message: string; inputs: Param[]; corner?: Corner; key: string; raw?: string }`
  - `function topologyFindings(c: Circuit, cls: Classification): { drafts: Draft[]; shortedRails: Set<string> }`
  - `function finalize(drafts: Draft[], peakNote: string): SimFinding[]`
  - `function noConvergence(c: Circuit, error: string, nodes: string[]): SimFinding`

- [ ] **Step 1: Write the failing test**

`src/sim/findings.topology.test.ts`:

```ts
// Spec 5.2 topological codes, each both ways: sim-short through a closed switch (and quiet when it
// is open), a shorted high-resistance cell, a shorted rail output; sim-source-conflict only for a
// closed parallel loop with different voltages; sim-floating-input; sim-incomplete; sim-estimate;
// and finalize's severity rules (peak is a warning, an uncertain error is a "likely" warning).
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { type Draft, finalize, noConvergence, topologyFindings } from './findings.ts'
import { boardModule, cellModule, ldoModule, sheet } from './testing.ts'
import type { Diagram } from '../format/diagram.ts'

const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
const codes = (d: Diagram) => {
  const c = buildCircuit(d)
  return finalize(topologyFindings(c, classify(c)).drafts, '')
}

describe('topological findings', () => {
  it('finds a short through a closed switch, and none with it open', () => {
    const d = (values: Record<string, unknown>) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, { uid: 's1', module: 'rocker-switch-kcd1', values }], [['bt1.+', 's1.1'], ['s1.2', 'bt1.-']])
    const closed = codes(d({ 'contact.s': 'closed' })).filter((f) => f.code === 'sim-short')
    expect(closed).toEqual([expect.objectContaining({ severity: 'error', basis: 'topology', parts: ['bt1', 's1'] })])
    expect(closed[0].message).toBe('BT1 is shorted: its + and - are joined through S1 and wires. Nothing limits the current, so BT1 and the wires can overheat.')
    expect(codes(d({})).filter((f) => f.code === 'sim-short')).toEqual([])
  })
  it('finds a shorted high-resistance cell (a coin cell wired + to -)', () => {
    const f = codes(sheet([{ uid: 'bt1', module: cellModule(3, 15) }], [['bt1.+', 'bt1.-']])).filter((x) => x.code === 'sim-short')
    expect(f).toHaveLength(1)
  })
  it('finds a rail output shorted to its return', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u1.GND']]))
    const t = topologyFindings(c, classify(c))
    expect(t.shortedRails).toEqual(new Set(['u1.rail.ldo']))
    expect(finalize(t.drafts, '').some((f) => f.code === 'sim-short' && f.parts[0] === 'u1')).toBe(true)
  })
  it('flags two sources in parallel at different voltages, and stays quiet otherwise (spec 5.2, Astra A)', () => {
    const pair = (va: number, vb: number, wires: [string, string][]) =>
      codes(sheet([{ uid: 'b1', module: cellModule(va, 0.05, 'cell-a') }, { uid: 'b2', module: cellModule(vb, 0.05, 'cell-b') }, R('r1', 100)], [...wires, ['b1.+', 'r1.1'], ['r1.2', 'b1.-']])).filter((f) => f.code === 'sim-source-conflict')
    // Both voltages are electrical.params values, which count as user (ruling R13).
    expect(pair(3.7, 5, [['b1.+', 'b2.+'], ['b1.-', 'b2.-']])).toEqual([expect.objectContaining({ severity: 'error', basis: 'user', parts: ['b1', 'b2'] })])
    expect(pair(3.7, 5, [['b1.+', 'b2.+']])).toEqual([])
    expect(pair(3.7, 3.7, [['b1.-', 'b2.+']])).toEqual([])
    expect(pair(3.7, 3.7, [['b1.+', 'b2.+'], ['b1.-', 'b2.-']])).toEqual([])
  })
  it('flags a wired GPIO input on a floating node, and not one with a pull, a driver or no wire', () => {
    const f = (values: Record<string, unknown>, wires: [string, string][]) =>
      codes(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values }, R('r1', 1000), R('r9', 1000)], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ...wires])).filter((x) => x.code === 'sim-floating-input')
    // IO1 goes to a resistor whose far end is free: wired, but nothing drives it (ruling R32). IO2 is wired to nothing: not reported.
    expect(f({}, [['u1.IO1', 'r9.1']]).map((x) => x.message)).toEqual(['U1 IO1 is an input with nothing driving it: it floats, so it reads at random. Wire it to a signal, add a pull-up or pull-down resistor, or set its simulated state to input-pullup or input-pulldown.'])
    expect(f({ 'gpio.IO1': 'input-pullup' }, [['u1.IO1', 'r9.1']])).toEqual([])
    expect(f({ 'gpio.IO2': 'input-pullup' }, [['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']])).toEqual([])
  })
  it('notes parts with no power data, and the estimates in use', () => {
    const all = codes(sheet([{ uid: 'u1', module: 'bme280-module-4pin' }, { uid: 'u2', module: boardModule({}) }], []))
    expect(all.find((f) => f.code === 'sim-incomplete')).toMatchObject({ severity: 'note', parts: ['u1'], message: '1 powered part has no power data, so it is not simulated: U1.' })
    const est = all.find((f) => f.code === 'sim-estimate')!
    expect(est.severity).toBe('note')
    expect(est.inputs).toContain('test-board.U2.draw.3V3.minVolts: estimate')
  })
})

describe('finalize (spec 4.5, 5.2)', () => {
  const p = (basis: 'user' | 'datasheet' | 'representative' | 'estimate') => ({ value: 1, basis, label: `x.${basis}` })
  const draft = (over: Partial<Draft>): Draft => ({ code: 'sim-brownout', severity: 'error', parts: ['u1'], message: 'U1 3V3 is at 2.5 V, below the 3 V it needs: it browns out.', inputs: [p('datasheet')], key: 'k', ...over })
  it('keeps a datasheet error at typical an error (it blocks)', () => {
    expect(finalize([draft({ corner: 'typical' })], '')[0]).toMatchObject({ severity: 'error', basis: 'datasheet', corner: 'typical' })
  })
  it('makes a peak finding a warning labelled with the peak note', () => {
    const f = finalize([draft({ corner: 'peak' })], 'Wi-Fi transmit')[0]
    expect(f.severity).toBe('warning')
    expect(f.message).toMatch(/^At peak \(Wi-Fi transmit\): /)
  })
  it('makes an error on estimates a "likely" warning that lists them, and drops a peak twin of a typical finding', () => {
    const [f] = finalize([draft({ corner: 'typical', inputs: [p('estimate')] }), draft({ corner: 'peak', inputs: [p('estimate')] })], '')
    expect(f.severity).toBe('warning')
    expect(f.message).toMatch(/^Likely: /)
    expect(f.message).toContain('x.estimate')
    expect(finalize([draft({ corner: 'typical' }), draft({ corner: 'peak' })], '')).toHaveLength(1)
  })
  it('words a solver failure without SPICE vocabulary, naming the parts on the nets it reported', () => {
    const c = buildCircuit(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, R('r1', 10)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']]))
    const f = noConvergence(c, 'singular matrix: check node n1', ['BT1_+'])
    expect(f).toMatchObject({ code: 'sim-no-convergence', severity: 'error', basis: 'topology', raw: 'singular matrix: check node n1', parts: ['bt1', 'r1'] })
    expect(f.message).toBe('The simulator could not solve this circuit; this may be our model, not your circuit. The parts on the nets it could not solve: BT1 and R1.')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/findings.topology.test.ts`
Expected: FAIL, `./findings.ts` cannot be found.

- [ ] **Step 3: Write the topological findings**

`src/sim/findings.ts`:

```ts
// Simulation findings (spec 5.2). Topological codes are decided from the circuit before solving;
// value codes (added in Task 28) from each solved corner. finalize applies the severity rules: at
// peak every finding is a warning labelled with the peak's note (spec 4.5); an error whose basis is
// representative or estimate is a "likely" warning that lists the uncertain inputs (uncertainty
// decides blocking). Plain words, no SPICE vocabulary. Pure.
import { formatValue } from '../format/values.ts'
import { andList } from '../format/words.ts'
import { naturalCompare } from '../agent/order.ts'
import { NO_POWER_DATA } from './estimates.ts'
import { type Classification, pinState } from './floating.ts'
import type { Circuit, Corner, Device, Param } from './model.ts'
import { type SimCode, type SimFinding, basisOf } from './results.ts'

export const SIM_TITLES: Record<SimCode, string> = {
  'sim-short': 'Short circuit',
  'sim-source-conflict': 'Supplies fight',
  'sim-over-abs-max': 'Over its absolute maximum',
  'sim-over-limit': 'Over its rating',
  'sim-brownout': 'Not enough voltage',
  'sim-dropout': 'Regulator out of regulation',
  'sim-converter-off': 'Converter off',
  'sim-min-load': 'Below its minimum load',
  'sim-outside-model': 'Outside the model',
  'sim-floating-input': 'Floating input',
  'sim-no-convergence': 'Could not be solved',
  'sim-incomplete': 'Not simulated',
  'sim-estimate': 'Estimates used',
}

export interface Draft {
  code: SimCode
  severity: 'error' | 'warning' | 'note'
  parts: string[]
  message: string
  inputs: Param[]
  corner?: Corner
  /** Identity across corners: the same key at peak is dropped when typical has it. */
  key: string
  raw?: string
}

export const V = (x: number) => formatValue(Number(x.toPrecision(3)), 'V')
export const A = (x: number) => formatValue(Number(x.toPrecision(3)), 'A')
export const W = (x: number) => formatValue(Number(x.toPrecision(3)), 'W')
export const refOf = (c: Circuit, uid: string) => c.parts[uid]?.ref ?? uid
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Every parameter a device was built from: what sim-estimate counts. */
export function deviceParams(d: Device): Param[] {
  switch (d.kind) {
    case 'resistor':
      return [d.ohms]
    case 'cell':
      return [d.volts, d.rInternal, ...(d.imax ? [d.imax] : [])]
    case 'load':
      return [d.typical, d.peak, d.minVolts]
    case 'rail': {
      const r = d.rail
      return [r.vout, r.dropout, r.iq, r.ioutMax, r.efficiency, r.vinMin, r.vinMax, r.rout, r.minLoad?.amps].filter((p): p is Param => !!p)
    }
    default:
      return []
  }
}

/** The low paths (spec 5.2): wires, contacts, jumpers, fuses and cable conductors, as a union-find with the part each step goes through. */
function lowGraph(c: Circuit) {
  const parent = new Map<string, string>()
  const adj = new Map<string, { to: string; part: string | null }[]>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const link = (a: string, b: string, part: string | null) => {
    for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n)
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
    adj.set(a, [...(adj.get(a) ?? []), { to: b, part }])
    adj.set(b, [...(adj.get(b) ?? []), { to: a, part }])
  }
  for (const t of c.taps) link(t.net, t.node, null)
  for (const d of c.devices) if (d.kind === 'resistor' && (d.role === 'contact' || d.role === 'cable')) link(d.a, d.b, d.part)
  /** The parts a low path from a to b passes through (breadth first, so the shortest). */
  const pathParts = (a: string, b: string): string[] => {
    const seen = new Map<string, { from: string; part: string | null } | null>([[a, null]])
    const queue = [a]
    for (let q = 0; q < queue.length && !seen.has(b); q++)
      for (const e of adj.get(queue[q]) ?? []) if (!seen.has(e.to)) {
        seen.set(e.to, { from: queue[q], part: e.part })
        queue.push(e.to)
      }
    const parts: string[] = []
    for (let at = seen.get(b); at; at = seen.get(at.from)) if (at.part && !parts.includes(at.part)) parts.unshift(at.part)
    return parts
  }
  return { same: (a: string, b: string) => parent.has(a) && parent.has(b) && find(a) === find(b), pathParts }
}

interface Source { device: string; part: string; label: string; p: string; n: string; volts: Param; blocks: boolean; rail: boolean }
function sources(c: Circuit): Source[] {
  return c.devices.flatMap((d): Source[] => {
    if (d.kind === 'cell') return [{ device: d.id, part: d.part, label: refOf(c, d.part), p: d.p, n: d.n, volts: d.volts, blocks: false, rail: false }]
    if (d.kind === 'rail' && d.rail.vout) return [{ device: d.id, part: d.part, label: `${refOf(c, d.part)} ${d.rail.output}`, p: d.out, n: d.ret, volts: d.rail.vout, blocks: d.rail.reverse === 'blocks', rail: true }]
    return []
  })
}

export function topologyFindings(c: Circuit, cls: Classification): { drafts: Draft[]; shortedRails: Set<string> } {
  const drafts: Draft[] = []
  const shortedRails = new Set<string>()
  const g = lowGraph(c)
  const srcs = sources(c)
  const shorted = new Set<string>()
  for (const s of srcs) {
    if (!g.same(s.p, s.n)) continue
    shorted.add(s.device)
    const via = g.pathParts(s.p, s.n).filter((p) => p !== s.part)
    const through = andList([...via.map((p) => refOf(c, p)), 'wires'])
    if (s.rail) shortedRails.add(s.device)
    drafts.push({
      code: 'sim-short', severity: 'error', parts: [s.part, ...via], inputs: [], key: `sim-short|${s.device}`,
      message: s.rail
        ? `${s.label} output is shorted to its return through ${through}: the regulator is outside its model, so the voltages on it cannot be trusted.`
        : `${s.label} is shorted: its + and - are joined through ${through}. Nothing limits the current, so ${s.label} and the wires can overheat.`,
    })
  }
  const fighters = srcs.filter((s) => !s.blocks && !shorted.has(s.device))
  for (let i = 0; i < fighters.length; i++)
    for (let j = i + 1; j < fighters.length; j++) {
      const [a, b] = [fighters[i], fighters[j]]
      if (a.part === b.part || !g.same(a.p, b.p) || !g.same(a.n, b.n) || Math.abs(a.volts.value - b.volts.value) <= 0.1) continue
      drafts.push({
        code: 'sim-source-conflict', severity: 'error', parts: [a.part, b.part], inputs: [a.volts, b.volts], key: `sim-source-conflict|${a.device}|${b.device}`,
        message: `${a.label} (${V(a.volts.value)}) and ${b.label} (${V(b.volts.value)}) are wired in parallel, plus to plus and minus to minus: the higher one drives current into the lower one, which can damage both.`,
      })
    }
  // Ruling R32: only an input wired to something; a spare pin reads nothing.
  for (const gp of c.gpio)
    if (gp.state === 'input' && pinState(c, cls, gp.key) === 'floating' && Object.entries(c.pinNet).some(([k, n]) => k !== gp.key && n === c.pinNet[gp.key]))
      drafts.push({
        code: 'sim-floating-input', severity: 'warning', parts: [gp.part], inputs: [], key: `sim-floating-input|${gp.part}|${gp.pin}`,
        message: `${refOf(c, gp.part)} ${gp.pin} is an input with nothing driving it: it floats, so it reads at random. Wire it to a signal, add a pull-up or pull-down resistor, or set its simulated state to input-pullup or input-pulldown.`,
      })
  const missing = [...new Set(c.unsimulated.filter((u) => u.reason === NO_POWER_DATA).map((u) => u.part))].sort(naturalCompare)
  if (missing.length) {
    const designators = missing.map((uid) => refOf(c, uid))
    drafts.push({
      code: 'sim-incomplete', severity: 'note', parts: missing, inputs: [], key: 'sim-incomplete',
      message: `${plural(missing.length, 'powered part')} ${missing.length === 1 ? 'has' : 'have'} no power data, so ${missing.length === 1 ? 'it is' : 'they are'} not simulated: ${andList(designators)}.`,
    })
  }
  const estimates = new Map<string, Param>()
  for (const p of [...c.devices.flatMap(deviceParams), ...c.limits.map((l) => l.value)]) if (p.basis === 'estimate') estimates.set(p.label, p)
  if (estimates.size)
    drafts.push({
      code: 'sim-estimate', severity: 'note', parts: [...new Set(c.devices.filter((d) => deviceParams(d).some((p) => p.basis === 'estimate')).map((d) => d.part))].sort(naturalCompare),
      inputs: [...estimates.values()], key: 'sim-estimate',
      message: `${plural(estimates.size, 'value')} in this result ${estimates.size === 1 ? 'is an estimate' : 'are estimates'}: ${[...estimates.keys()].join(', ')}.`,
    })
  return { drafts, shortedRails }
}

const ORDER = { error: 0, warning: 1, note: 2 } as const

/** The severity rules of spec 4.5 and 5.2, then one finding per key (typical wins over peak). */
export function finalize(drafts: Draft[], peakNote: string): SimFinding[] {
  const out = new Map<string, SimFinding>()
  for (const d of [...drafts].sort((a, b) => Number(a.corner === 'peak') - Number(b.corner === 'peak'))) {
    if (out.has(d.key)) continue
    const basis = basisOf(d.inputs)
    let severity = d.severity
    let message = d.message
    if (d.corner === 'peak') {
      if (severity === 'error') severity = 'warning'
      message = `At peak${peakNote ? ` (${peakNote})` : ''}: ${message}`
    }
    if (severity === 'error' && (basis === 'representative' || basis === 'estimate')) {
      severity = 'warning'
      const uncertain = d.inputs.filter((p) => p.basis === 'representative' || p.basis === 'estimate').map((p) => p.label)
      message = `Likely: ${message} This is decided on ${basis} values: ${uncertain.join(', ')}.`
    }
    out.set(d.key, {
      code: d.code, severity, parts: d.parts, message, ...(d.corner ? { corner: d.corner } : {}), basis,
      inputs: d.inputs.map((p) => `${p.label}: ${p.basis}`), ...(d.raw ? { raw: d.raw } : {}),
    })
  }
  return [...out.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || naturalCompare(a.parts.join(), b.parts.join()))
}

/** A run ngspice could not solve (spec 5.2): plain words, the parts on the nets it named, its text kept as raw. */
export function noConvergence(c: Circuit, error: string, nodes: string[]): SimFinding {
  const nets = new Set(nodes)
  const parts = [...new Set(c.taps.filter((t) => nets.has(t.net) || nets.has(t.node)).map((t) => t.part))].sort(naturalCompare)
  return {
    code: 'sim-no-convergence', severity: 'error', parts, basis: 'topology', inputs: [], raw: error,
    message: `The simulator could not solve this circuit; this may be our model, not your circuit.${parts.length ? ` The parts on the nets it could not solve: ${andList(parts.map((p) => refOf(c, p)))}.` : ''}`,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/findings.topology.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/findings.ts src/sim/findings.topology.test.ts
git commit -m "$(cat <<'MSG'
Sim: topological findings (short, source conflict, floating input, incomplete, estimates) and the severity rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 28: Findings decided from each solved corner, and outside-model marking

**Files:**
- Modify: `src/sim/findings.ts` (add `runDrafts`, `propagate`, `analyseFindings`)
- Test: `src/sim/findings.run.test.ts`

**Interfaces:**
- Consumes: Task 27's `Draft`, `finalize`, `topologyFindings`, `refOf`, `V`, `A`, `W`; `enableValue` (Task 13); `RawRun`; `Outside` (Task 26); `ResolvedLimit`, `Device` (Task 6).
- Produces:
  - `function runDrafts(c: Circuit, cls: Classification, raw: RawRun, corner: Corner): { drafts: Draft[]; outside: Set<string> }`
  - `function propagate(c: Circuit, rails: Set<string>): Outside` (spec 4.2: a rail outside its model marks its output net, its input nets, and transitively every rail and source feeding them)
  - `function analyseFindings(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>): { findings: SimFinding[]; outside: Outside }`

One ruling applies here and is stated in a code comment:
- **R30 (unpowered load):** a load whose domain floats (nothing on the sheet supplies it) is a `sim-brownout` **warning** with basis `topology` ("not powered in the current state"), never an error: the checker's "external power assumed" view covers an undrawn supply, so blocking on it would answer the checker's question, not the simulator's (spec 2.1).

- [ ] **Step 1: Write the failing test**

`src/sim/findings.run.test.ts`:

```ts
// Spec 5.2 value codes, each both ways, against the real engine; spec 4.2's upstream marking; 4.5's
// corners; and the examples the spec gives: an LED on 5 V with no resistor is a "likely damage"
// warning; a GPIO sinking over its limit; brownout and dropout blocking on datasheet values but
// only warning on estimates; an AMS1117-like LDO on 3xAA in dropout at peak only.
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagram } from '../format/diagram.ts'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { classify } from './floating.ts'
import { analyseFindings } from './findings.ts'
import type { Corner } from './model.ts'
import type { RawRun } from './spice.ts'
import { boardModule, boostModule, cellModule, hostModule, ldoModule, q, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const R = (uid: string, ohms: number) => ({ uid, module: 'resistor', values: { resistance: { value: ohms, unit: 'ohm' } } })
async function analyse(d: Diagram) {
  const c = buildCircuit(d)
  const cls = classify(c)
  const raws = {} as Record<Corner, RawRun>
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, 1)
    if (r.status !== 'ok') throw new Error(JSON.stringify(r))
    raws[corner] = r.raw
  }
  return analyseFindings(c, cls, raws)
}
const of = (r: Awaited<ReturnType<typeof analyse>>, code: string) => r.findings.filter((f) => f.code === code)
const board = (values: Record<string, unknown> = {}, vin = 5, rint = 0.05, mod = boardModule()) =>
  sheet([{ uid: 'bt1', module: cellModule(vin, rint) }, { uid: 'u1', module: mod, values }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']])

describe('value findings', () => {
  it('an LED on 5 V with no resistor: over its representative absolute maximum, a "likely damage" warning only', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'd1', module: 'led' }], [['bt1.+', 'd1.A'], ['d1.K', 'bt1.-']]))
    const [f] = of(r, 'sim-over-abs-max')
    expect(f).toMatchObject({ severity: 'warning', basis: 'representative', corner: 'typical', parts: ['d1'] })
    expect(f.message).toMatch(/^Likely: D1 carries .* absolute maximum: damage is likely\./)
    expect(of(r, 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('a resistor over its power rating, and quiet at a sensible value', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.05) }, R('r1', ohms)], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])
    expect(of(await analyse(d(10)), 'sim-over-limit')).toEqual([expect.objectContaining({ severity: 'warning', parts: ['r1'], basis: 'representative' })])
    expect(of(await analyse(d(1000)), 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('a GPIO sinking over its datasheet limit, and quiet through 1 k', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'low' } }, { uid: 'bt2', module: cellModule(5, 0.05, 'cell-b') }, R('r1', ohms)],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['bt2.+', 'r1.1'], ['r1.2', 'u1.IO1'], ['bt2.-', 'u1.GND']])
    const [f] = of(await analyse(d(150)), 'sim-over-limit')
    expect(f).toMatchObject({ severity: 'warning', basis: 'datasheet', parts: ['u1'] })
    expect(f.message).toMatch(/^U1 IO1 carries 27\.\d mA, above its 20 mA rating\.$/)
    expect(of(await analyse(d(1000)), 'sim-over-limit')).toEqual([])
  }, 60_000)
  it('brownout and dropout block on datasheet values, and are "likely" warnings on estimates; quiet on 5 V', async () => {
    const sourced = await analyse(board({}, 3.3, 0.05, boardModule({ minVolts: 3.0 })))
    expect(of(sourced, 'sim-brownout')[0]).toMatchObject({ severity: 'error', basis: 'datasheet', corner: 'typical' })
    expect(of(sourced, 'sim-dropout')[0]).toMatchObject({ severity: 'error', basis: 'datasheet' })
    const estimated = await analyse(board({}, 3.3))
    const b = of(estimated, 'sim-brownout')[0]
    expect(b).toMatchObject({ severity: 'warning', basis: 'estimate' })
    expect(b.message).toMatch(/^Likely: /)
    const fine = await analyse(board())
    expect([...of(fine, 'sim-brownout'), ...of(fine, 'sim-dropout')]).toEqual([])
  }, 60_000)
  it('an LDO on 3xAA (4.5 V) in dropout at peak only: a warning labelled with the peak', async () => {
    const r = await analyse(board({}, 4.5, 0.45))
    const d = of(r, 'sim-dropout')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ corner: 'peak', severity: 'warning' })
    expect(d[0].message).toMatch(/^At peak \(radio\): /)
  }, 60_000)
  it('a boost below its input range while a board expects power is off; quiet in range', async () => {
    const d = (vin: number, rint = 0.01) => sheet([{ uid: 'bt1', module: cellModule(vin, rint) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule() }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']])
    const off = of(await analyse(d(2.5)), 'sim-converter-off')
    expect(off[0]).toMatchObject({ severity: 'error', basis: 'datasheet' })
    expect(off[0].message).toContain('is off')
    expect(of(await analyse(d(3.7)), 'sim-converter-off')).toEqual([])
  }, 60_000)
  it('an input at the edge of the enable window: outside the model, upstream marked (spec 4.2)', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(2.875, 1e-6) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule() }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']]))
    expect(of(r, 'sim-converter-off').some((f) => f.message.includes('edge of its range'))).toBe(true)
    expect(r.outside.rails.has('u1.rail.boost')).toBe(true)
    expect(r.outside.nets.has('BT1_+')).toBe(true)
    expect(r.outside.parts.has('bt1')).toBe(true)
  }, 60_000)
  it('an overloaded weak battery settles at the edge of the enable window, which is flagged (spec 4.2)', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(3.2, 1) }, { uid: 'u1', module: boostModule() }, { uid: 'u2', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.4, unit: 'A' } } }],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'u2.VIN'], ['u2.GND', 'u1.GND']]))
    expect(of(r, 'sim-converter-off').some((f) => f.message.includes('edge of its range'))).toBe(true)
  }, 60_000)
  it('a boost under its minimum load warns, and does not above it', async () => {
    const d = (ohms: number) => sheet([{ uid: 'bt1', module: cellModule(3.7, 0.01) }, { uid: 'u1', module: boostModule({ minLoad: { amps: q(0.05, 'A'), note: 'it shuts itself off after 32 s' } }) }, R('r1', ohms)],
      [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']])
    const [f] = of(await analyse(d(1000)), 'sim-min-load')
    expect(f).toMatchObject({ severity: 'warning' })
    expect(f.message).toContain('it shuts itself off after 32 s')
    expect(of(await analyse(d(50)), 'sim-min-load')).toEqual([])
  }, 60_000)
  it('an LDO past ioutMax is outside its model and over its rating, and marks upstream readings', async () => {
    const r = await analyse(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: ldoModule() }, R('r1', 3)], [['bt1.+', 'u1.IN'], ['bt1.-', 'u1.GND'], ['u1.OUT', 'r1.1'], ['r1.2', 'u1.GND']]))
    expect(of(r, 'sim-outside-model')).toHaveLength(1)
    expect(of(r, 'sim-over-limit').some((f) => f.message.includes('U1 OUT regulator supplies'))).toBe(true)
    expect([...r.outside.nets].sort()).toEqual(expect.arrayContaining(['BT1_+', 'U1_OUT']))
    expect(r.outside.parts.has('bt1')).toBe(true)
  }, 60_000)
  it('a USB host port asked for more than it gives', async () => {
    const r = await analyse(sheet([{ uid: 'h1', module: hostModule() }, { uid: 'u1', module: boardModule(), values: { 'sim.draw.3V3.typical': { value: 0.6, unit: 'A' } } }], [['h1.USB', 'u1.USB']]))
    expect(of(r, 'sim-over-limit').some((f) => f.message.includes('over USB to U1'))).toBe(true)
  }, 60_000)
  it('an unplugged board: not powered, a topology warning that never blocks (ruling R30)', async () => {
    const r = await analyse(sheet([{ uid: 'u1', module: boardModule() }], []))
    const [f] = of(r, 'sim-brownout')
    expect(f).toMatchObject({ severity: 'warning', basis: 'topology' })
    expect(f.message).toContain('is not powered in the current state')
    expect(r.findings.some((x) => x.severity === 'error')).toBe(false)
  }, 60_000)
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/findings.run.test.ts`
Expected: FAIL, `analyseFindings` is not exported.

- [ ] **Step 3: Write the run findings**

Add to `src/sim/findings.ts` (extend the imports with `type ResolvedLimit` from `./model.ts`, `type RawRun, enableValue` from `./spice.ts`, and `type Outside` from `./results.ts`):

```ts
type Load = Extract<Device, { kind: 'load' }>
type RailDev = Extract<Device, { kind: 'rail' }>

/** The value findings of one solved corner (spec 5.2), and the rails that ran outside their model. */
export function runDrafts(c: Circuit, cls: Classification, raw: RawRun, corner: Corner): { drafts: Draft[]; outside: Set<string> } {
  const drafts: Draft[] = []
  const outside = new Set<string>()
  const add = (d: Omit<Draft, 'corner'>) => void drafts.push({ ...d, corner })
  const v = (n: string) => raw.v[n]
  const driven = (n: string) => cls.driven.has(n) && v(n) !== undefined
  const pinI = (part: string, pin: string) => raw.pins[part]?.[pin]
  const taps = (part: string) => c.taps.filter((t) => t.part === part)
  const netOf = (node: string) => c.taps.find((t) => t.node === node)?.net ?? node
  const ref = (uid: string) => refOf(c, uid)
  const fmt = (x: number, unit: 'A' | 'V' | 'W') => (unit === 'A' ? A(x) : unit === 'V' ? V(x) : W(x))
  const cond = (l: ResolvedLimit) => (l.conditions ? ` (${l.conditions})` : '')

  const measure = (l: ResolvedLimit): { value: number; what: string; unit: 'A' | 'V' | 'W' } | null => {
    const r = ref(l.part)
    if ('pin' in l.of) {
      const i = pinI(l.part, l.of.pin)
      return i === undefined ? null : { value: Math.abs(i), what: `${r} ${l.of.pin} carries ${A(Math.abs(i))}`, unit: 'A' }
    }
    if ('domain' in l.of) {
      const name = l.of.domain
      const dom = c.domains.find((x) => x.part === l.part && x.name === name)
      if (!dom) return null
      if (l.kind === 'vinMax' || l.kind === 'vinMin') {
        if (!driven(dom.pin) || !driven(dom.ret)) return null
        const x = v(dom.pin) - v(dom.ret)
        return { value: x, what: `${r} ${name} is at ${V(x)}`, unit: 'V' }
      }
      if (l.kind === 'ioTotalCurrent') {
        const sum = c.gpio.filter((g) => g.part === l.part && g.domain === name && (g.state === 'high' || g.state === 'low')).reduce((s, g) => s + Math.abs(pinI(g.part, g.pin) ?? 0), 0)
        return { value: sum, what: `${r}'s GPIO pins on ${name} carry ${A(sum)} in all`, unit: 'A' }
      }
      const src = c.devices.find((x) => x.kind === 'cell' && x.part === l.part && x.domain === name)
      const x = src ? raw.dev[src.id] : undefined
      return x === undefined ? null : { value: Math.abs(x), what: `${r} delivers ${A(Math.abs(x))}`, unit: 'A' }
    }
    if (l.kind === 'power') {
      const p = Math.abs(taps(l.part).reduce((s, t) => s + (v(t.net) ?? 0) * (pinI(l.part, t.pin) ?? 0), 0))
      return { value: p, what: `${r} dissipates ${W(p)}`, unit: 'W' }
    }
    if (l.kind === 'sourceCurrent') {
      const src = c.devices.find((x) => x.kind === 'cell' && x.part === l.part)
      const x = src ? raw.dev[src.id] : undefined
      return x === undefined ? null : { value: Math.abs(x), what: `${r} delivers ${A(Math.abs(x))}`, unit: 'A' }
    }
    if (l.kind === 'vinMax' || l.kind === 'vinMin') return null
    const i = Math.max(0, ...taps(l.part).map((t) => Math.abs(pinI(l.part, t.pin) ?? 0)))
    return { value: i, what: `${r} carries ${A(i)}`, unit: 'A' }
  }

  // Limits: an absolute maximum is sim-over-abs-max; any other rating is sim-over-limit, unless the
  // same subject is over an absolute maximum (then that one says it).
  const subject = (l: ResolvedLimit) => `${l.part}|${JSON.stringify(l.of)}`
  const overAbs = new Set<string>()
  for (const l of c.limits) {
    if (l.kind !== 'absMaxCurrent' && l.kind !== 'vinMax') continue
    const m = measure(l)
    if (!m || m.value <= l.value.value) continue
    overAbs.add(subject(l))
    add({ code: 'sim-over-abs-max', severity: 'error', parts: [l.part], inputs: [l.value], key: `abs|${subject(l)}|${l.kind}`, message: `${m.what}, above its ${fmt(l.value.value, m.unit)} absolute maximum${cond(l)}: damage is likely.` })
  }
  for (const l of c.limits) {
    if (l.kind === 'absMaxCurrent' || l.kind === 'vinMax' || overAbs.has(subject(l))) continue
    const m = measure(l)
    if (!m) continue
    const under = l.kind === 'vinMin'
    if (under ? m.value >= l.value.value : m.value <= l.value.value) continue
    const advice = c.parts[l.part]?.model === 'led' ? ' Add a series resistor, or a larger one, to bring it under the rating.' : ''
    add({ code: 'sim-over-limit', severity: 'warning', parts: [l.part], inputs: [l.value], key: `limit|${subject(l)}|${l.kind}`, message: `${m.what}, ${under ? 'below' : 'above'} its ${fmt(l.value.value, m.unit)} ${under ? 'minimum' : 'rating'}${cond(l)}.${advice}` })
  }
  for (const d of c.devices)
    if (d.kind === 'cell' && d.role === 'external' && d.imax && (raw.dev[d.id] ?? 0) > d.imax.value)
      add({ code: 'sim-over-limit', severity: 'warning', parts: [d.part], inputs: [d.imax], key: `imax|${d.id}`, message: `${ref(d.part)} delivers ${A(raw.dev[d.id])}, above the ${A(d.imax.value)} it can supply.` })
  for (const u of c.usb) {
    const cable = c.devices.find((x) => x.id === u.vbus)
    if (cable?.kind !== 'resistor' || !driven(cable.a) || !driven(cable.b)) continue
    const i = (v(cable.a) - v(cable.b)) / Math.max(cable.ohms.value, 1e-6)
    if (i > u.limit.value)
      add({ code: 'sim-over-limit', severity: 'warning', parts: [u.host, u.device], inputs: [u.limit], key: `usb|${u.vbus}`, message: `${ref(u.host)} ${u.hostPort} supplies ${A(i)} over USB to ${ref(u.device)}, above the ${A(u.limit.value)} the port gives.` })
  }

  // Rails (spec 4.1, 4.2): outside the model past ioutMax; dropout; a converter off or at the edge of its enable; minimum load.
  for (const d of c.devices) {
    if (d.kind !== 'rail' || !driven(d.out)) continue
    const r = d.rail
    const iout = raw.dev[d.id] ?? 0
    const name = `${ref(d.part)} ${r.output} ${r.kind === 'ldo' ? 'regulator' : r.kind}`
    const outNet = netOf(d.out)
    const loads = c.devices.filter((x): x is Load => x.kind === 'load' && netOf(x.p) === outNet)
    const expecting = c.devices.filter((x) => (x.kind === 'load' && netOf(x.p) === outNet) || ((x.kind === 'resistor' || x.kind === 'diode') && x.role === 'rail-input' && netOf(x.a) === outNet))
    if (r.ioutMax && iout > r.ioutMax.value) {
      outside.add(d.id)
      add({ code: 'sim-outside-model', severity: 'warning', parts: [d.part], inputs: [r.ioutMax], key: `outside|${d.id}`, message: `${name} supplies ${A(iout)}, beyond the ${A(r.ioutMax.value)} its model covers: its voltages, and the readings upstream of it, cannot be trusted.` })
      add({ code: 'sim-over-limit', severity: 'warning', parts: [d.part], inputs: [r.ioutMax], key: `iout|${d.id}`, message: `${name} supplies ${A(iout)}, above its ${A(r.ioutMax.value)} rating.` })
    }
    const vin = v(d.in) - v(d.inRet)
    if (r.kind === 'ldo' && driven(d.ctl)) {
      const vctl = v(d.ctl) - v(d.ret)
      if (vctl < r.vout!.value - 0.01)
        add({ code: 'sim-dropout', severity: 'error', parts: [d.part], inputs: [r.vout!, r.dropout!, ...loads.map((l) => (corner === 'peak' ? l.peak : l.typical))], key: `dropout|${d.id}`, message: `${name} cannot hold ${V(r.vout!.value)}: its input is too low (${V(vin)}), so its output follows it down to about ${V(vctl)}.` })
    }
    let on = true
    if (r.kind === 'buck' || r.kind === 'boost') {
      const e = enableValue(vin, r.vinMin!.value, r.vinMax!.value)
      on = e >= 0.5
      if (e > 0.01 && e < 0.99) {
        outside.add(d.id)
        add({ code: 'sim-converter-off', severity: 'error', parts: [d.part], inputs: [r.vinMin!, r.vinMax!], key: `edge|${d.id}`, message: `${name}'s input (${V(vin)}) is at the edge of its range; it would cycle on and off, so its output and the readings upstream of it cannot be trusted.` })
      } else if (!on && expecting.length) {
        const users = [...new Set(expecting.map((x) => x.part))].filter((p) => p !== d.part)
        add({
          code: 'sim-converter-off', severity: 'error', parts: [d.part, ...users], inputs: [r.vinMin!, r.vinMax!], key: `off|${d.id}`,
          message: `${name} is off: its input (${V(vin)}) is ${vin < r.vinMin!.value ? `below its ${V(r.vinMin!.value)} minimum` : `above its ${V(r.vinMax!.value)} maximum`}, but ${andList(users.map(ref))} ${users.length === 1 ? 'expects' : 'expect'} power from it.`,
        })
      }
    }
    if (r.minLoad && on && iout < r.minLoad.amps.value)
      add({ code: 'sim-min-load', severity: 'warning', parts: [d.part], inputs: [r.minLoad.amps], key: `minload|${d.id}`, message: `${name} supplies ${A(iout)}, below the ${A(r.minLoad.amps.value)} it needs to stay on: ${r.minLoad.note}.` })
  }

  // Loads (spec 5.2 sim-brownout; ruling R30 for a load nothing supplies).
  for (const l of c.devices) {
    if (l.kind !== 'load') continue
    if (!driven(l.p) || !driven(l.n)) {
      if (corner === 'typical')
        add({ code: 'sim-brownout', severity: 'warning', parts: [l.part], inputs: [], key: `unpowered|${l.id}`, message: `${ref(l.part)} ${l.domain} is not powered in the current state: nothing on the sheet supplies it. Draw its supply (a battery, an adapter, or a computer USB port on its USB socket) to simulate it.` })
      continue
    }
    const x = v(l.p) - v(l.n)
    if (x < l.minVolts.value)
      add({ code: 'sim-brownout', severity: 'error', parts: [l.part], inputs: [corner === 'peak' ? l.peak : l.typical, l.minVolts], key: `brownout|${l.id}`, message: `${ref(l.part)} ${l.domain} is at ${V(x)}, below the ${V(l.minVolts.value)} it needs: it browns out.` })
  }
  return { drafts, outside }
}

/** Spec 4.2: a rail outside its model marks its output and input nets, and every rail, path and source feeding them, transitively. */
export function propagate(c: Circuit, rails: Set<string>): Outside {
  const netOf = (node: string) => c.taps.find((t) => t.node === node)?.net ?? node
  const marked = new Set(rails)
  const nets = new Set<string>()
  const railDevs = c.devices.filter((d): d is RailDev => d.kind === 'rail')
  const mark = (d: RailDev) => {
    nets.add(netOf(d.out))
    nets.add(netOf(d.in))
  }
  for (const d of railDevs) if (marked.has(d.id)) mark(d)
  for (let changed = true; changed; ) {
    changed = false
    for (const d of railDevs)
      if (!marked.has(d.id) && nets.has(netOf(d.out))) {
        marked.add(d.id)
        mark(d)
        changed = true
      }
    // Paths into a marked net: rail inputs, switch rails and cables carry the chain upstream.
    for (const d of c.devices) {
      if (!((d.kind === 'resistor' || d.kind === 'diode') && (d.role === 'rail-input' || d.role === 'switch-rail' || d.role === 'cable'))) continue
      const [a, b] = [netOf(d.a), netOf(d.kind === 'resistor' ? d.b : d.k)]
      if (nets.has(a) !== nets.has(b)) {
        nets.add(a)
        nets.add(b)
        changed = true
      }
    }
  }
  const parts = new Set<string>()
  for (const d of c.devices) {
    if (d.kind === 'rail' && marked.has(d.id)) parts.add(d.part)
    if (d.kind === 'cell' && nets.has(netOf(d.p))) parts.add(d.part)
  }
  return { nets, parts, rails: marked }
}

/** Every finding of a solve, and what is outside the model (spec 4.1, 4.2, 4.5, 5.2). */
export function analyseFindings(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>): { findings: SimFinding[]; outside: Outside } {
  const topo = topologyFindings(c, cls)
  const typical = runDrafts(c, cls, raws.typical, 'typical')
  const peak = runDrafts(c, cls, raws.peak, 'peak')
  const outside = propagate(c, new Set([...topo.shortedRails, ...typical.outside, ...peak.outside]))
  const peakNote = [...new Set(c.devices.flatMap((d) => (d.kind === 'load' && d.peakNote ? [d.peakNote] : [])))].join(', ')
  return { findings: finalize([...topo.drafts, ...typical.drafts, ...peak.drafts], peakNote), outside }
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/sim/findings.run.test.ts src/sim/findings.topology.test.ts`
Expected: PASS. A failing number here means a model or finding bug: find it with the solved values (print `raws.typical.v`), never by widening the test.

- [ ] **Step 4: Commit**

```bash
git add src/sim/findings.ts src/sim/findings.run.test.ts
git commit -m "$(cat <<'MSG'
Sim: value findings per corner (limits, brownout, dropout, converter off, minimum load, outside the model) and upstream marking

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 29: The solve and the session

**Files:**
- Create: `src/sim/session.ts`
- Test: `src/sim/session.test.ts`

**Interfaces:**
- Consumes: `buildCircuit`, `BuildOptions` (Task 10); `Engine` (Task 14); `classifyCached` (Task 12); `analyseFindings`, `noConvergence` (Tasks 27, 28); `readRun`, `budget`, `probeReadings`, `SimOutcome`, `SimResult` (Task 26); `Probe` (Task 25).
- Produces:
  - `interface SolveOptions extends BuildOptions { probes?: Probe[] }`
  - `function solve(d: Diagram, engine: Engine, revision: number, opts?: SolveOptions): Promise<{ outcome: SimOutcome; circuit: Circuit }>`
  - `class SimSession { constructor(engine: Engine, onOutcome: (o: SimOutcome, c: Circuit) => void); request(d: Diagram, revision: number, opts?: SolveOptions): void; stop(): void }`

- [ ] **Step 1: Write the failing test**

`src/sim/session.test.ts`:

```ts
// Spec 2: a solve runs the typical and peak corners (2 engine runs) and assembles a SimResult; the
// session keeps one solve in flight and one pending (a newer request replaces the pending one),
// drops results for older revisions and after stop(), and a failure carries the last good result.
import { afterAll, describe, expect, it } from 'vitest'
import { makeEngine, type Engine, type RunOutcome } from './engine/engine.ts'
import type { EngineHost } from './engine/host.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { SimSession, solve } from './session.ts'
import { cellModule, sheet } from './testing.ts'
import type { SimOutcome } from './results.ts'

const led = sheet(
  [{ uid: 'bt1', module: cellModule(5, 1e-6) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 150, unit: 'ohm' } } }, { uid: 'd1', module: 'led' }],
  [['bt1.+', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'bt1.-']],
)

/** An engine whose runs finish only when released, recording each run's revision. */
function gatedEngine() {
  const calls: number[] = []
  const gates: (() => void)[] = []
  let fail = false
  const engine: Engine = {
    host: { runs: 0, info: { name: 'ngspice', version: '45.2', build: 'fake' } } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run: (_c, _a, revision) => {
      calls.push(revision)
      return new Promise<RunOutcome>((res) => gates.push(() => res(fail ? { status: 'failed', revision, error: 'x', nodes: [] } : { status: 'ok', revision, raw: { v: {}, pins: {}, dev: {} }, ms: 1 })))
    },
    dispose() {},
  }
  const flush = async () => {
    for (let i = 0; i < 40; i++) {
      gates.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { engine, calls, flush, setFail: (f: boolean) => void (fail = f) }
}

describe('solve', () => {
  const engine = makeEngine(createNodeEngineHost())
  afterAll(() => engine.dispose())
  it('runs both corners and returns a serialisable SimResult with probes', async () => {
    const { outcome } = await solve({ ...led, probes: [{ id: 'P1', at: { part: 'd1', pin: 'A' } }] }, engine, 4)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    const r = outcome.result
    expect([r.format, r.revision, r.engine.name, r.engine.runs]).toEqual(['circuitoon-sim/1', 4, 'ngspice', 2])
    expect(r.probes[0].voltage?.typical).toMatchObject({ kind: 'value', reference: 'GND' })
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  }, 60_000)
})

describe('SimSession', () => {
  it('keeps one solve in flight and one pending, and delivers only the newest revision', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    s.request(led, 2)
    s.request(led, 3)
    await g.flush()
    expect(g.calls).toEqual([1, 1, 3, 3])
    expect(got.map((o) => (o.status === 'ok' ? o.result.revision : -1))).toEqual([3])
  })
  it('drops a result that arrives after stop()', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    s.stop()
    await g.flush()
    expect(got).toEqual([])
  })
  it('gives a failure the last good result', async () => {
    const g = gatedEngine()
    const got: SimOutcome[] = []
    const s = new SimSession(g.engine, (o) => got.push(o))
    s.request(led, 1)
    await g.flush()
    g.setFail(true)
    s.request(led, 2)
    await g.flush()
    expect(got[1]).toMatchObject({ status: 'failed', revision: 2, lastGood: { revision: 1 } })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sim/session.test.ts`
Expected: FAIL, `./session.ts` cannot be found.

- [ ] **Step 3: Write the session**

`src/sim/session.ts`:

```ts
// The solve loop the editor and the CLI share (spec 2): build the circuit, run the typical and peak
// corners (2 engine runs), and assemble the SimResult. SimSession keeps at most one solve in flight
// and one pending (a newer request replaces the pending one); a result for an older revision, or
// one that arrives after stop(), is discarded; a failure carries the last good result.
import type { Diagram, Probe } from '../format/diagram.ts'
import { type BuildOptions, buildCircuit } from './build.ts'
import type { Engine } from './engine/engine.ts'
import { classifyCached } from './floating.ts'
import { analyseFindings, noConvergence } from './findings.ts'
import type { Circuit, Corner } from './model.ts'
import { type SimOutcome, type SimResult, budget, probeReadings, readRun } from './results.ts'
import type { RawRun } from './spice.ts'

export interface SolveOptions extends BuildOptions { probes?: Probe[] }

export async function solve(d: Diagram, engine: Engine, revision: number, opts: SolveOptions = {}): Promise<{ outcome: SimOutcome; circuit: Circuit }> {
  const c = buildCircuit(d, opts)
  const cls = classifyCached(c)
  const raws = {} as Record<Corner, RawRun>
  const before = engine.host.runs
  let ms = 0
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, revision)
    if (r.status === 'unavailable') return { circuit: c, outcome: { status: 'unavailable', reason: r.reason } }
    if (r.status === 'failed') return { circuit: c, outcome: { status: 'failed', revision, finding: noConvergence(c, r.error, r.nodes) } }
    raws[corner] = r.raw
    ms += r.ms
  }
  const { findings, outside } = analyseFindings(c, cls, raws)
  const corners = { typical: readRun(c, cls, raws.typical, outside), peak: readRun(c, cls, raws.peak, outside) }
  const info = engine.host.info
  const result: SimResult = {
    format: 'circuitoon-sim/1',
    revision,
    corners,
    budget: budget(c, cls, raws, outside),
    findings,
    unsimulated: c.unsimulated,
    probes: probeReadings([...(d.probes ?? []), ...(opts.probes ?? [])], c, corners),
    notes: c.notes,
    engine: { name: 'ngspice', version: info?.version ?? '', build: info?.build ?? '', runs: engine.host.runs - before, ms },
  }
  return { circuit: c, outcome: { status: 'ok', result } }
}

export class SimSession {
  private engine: Engine
  private onOutcome: (o: SimOutcome, c: Circuit) => void
  private pending: { d: Diagram; revision: number; opts: SolveOptions } | null = null
  private running = false
  private latest = 0
  private stopped = false
  private lastGood: { revision: number; result: SimResult } | null = null

  constructor(engine: Engine, onOutcome: (o: SimOutcome, c: Circuit) => void) {
    this.engine = engine
    this.onOutcome = onOutcome
  }

  request(d: Diagram, revision: number, opts: SolveOptions = {}): void {
    if (this.stopped) return
    this.latest = revision
    this.pending = { d, revision, opts }
    if (!this.running) void this.loop()
  }

  private async loop(): Promise<void> {
    this.running = true
    while (this.pending && !this.stopped) {
      const job = this.pending
      this.pending = null
      const { outcome, circuit } = await solve(job.d, this.engine, job.revision, job.opts)
      if (this.stopped || job.revision !== this.latest) continue
      if (outcome.status === 'ok') this.lastGood = { revision: job.revision, result: outcome.result }
      this.onOutcome(outcome.status === 'failed' && this.lastGood ? { ...outcome, lastGood: this.lastGood } : outcome, circuit)
    }
    this.running = false
  }

  stop(): void {
    this.stopped = true
    this.pending = null
  }
}
```

The gated engine's `host.runs` stays 0 and the stub `raw` is empty: `solve` still assembles (every node floats), which is what the session tests need.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sim/session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/session.ts src/sim/session.test.ts
git commit -m "$(cat <<'MSG'
Sim: solve (two corners, assembled SimResult) and the revision-checked session

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 30: `circuitoon sim`

**Files:**
- Create: `src/cli/simCmd.ts`, `plugin/skills/circuitoon-design/references/schemas/sim.schema.json`
- Modify: `src/cli/args.ts` (repeatable `--probe`, ruling R26), `src/cli/main.ts` (command and usage), `plugin/skills/circuitoon-design/references/cli.md` (the command)
- Test: `src/cli/simCmd.test.ts`

**Interfaces:**
- Consumes: `solve` (Task 29), `makeEngine` (Task 14), `createNodeEngineHost` (Task 4), `layoutNetlist`, `validateDiagram`, `sheetNets` (Task 9), `nextProbeId` (Task 25).
- Produces: `function simCommand(args: Args, io: Io, opts?: { engine?: Engine }): Promise<number>`; `Args.lists?: Map<string, string[]>`; schema `sim` (`SimOutcome`).

Exit codes (spec 7): `ok` with no blocking finding 0; `ok` with blocking findings 1; bad input 2; `failed` or `unavailable` 3. A blocking finding is one whose final severity is `error` (Task 27's `finalize` leaves `error` only on typical-corner findings with basis topology, user or datasheet).

- [ ] **Step 1: Write the failing test**

`src/cli/simCmd.test.ts`:

```ts
// Spec 7: circuitoon sim prints the SimOutcome JSON on stdout and a short summary on stderr; exit 0
// clean, 1 blocking, 2 bad input, 3 failed or unavailable; --probe repeats; a netlist is laid out
// first; only simulation findings are reported.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { parseArgs } from './args.ts'

const write = (dir: string, name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value))

describe('circuitoon sim', () => {
  it('lays out a netlist, solves it and prints a schema-valid outcome; two --probe flags read two points', async () => {
    const dir = tempDir()
    write(dir, 'n.json', ledNetlist())
    const r = await cli(['sim', 'n.json', '--probe', 'D1.A', '--probe', 'net:VCC'], { cwd: dir })
    expect(r.code).toBe(0)
    const o = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('sim'), o)).toEqual([])
    expect(o.status).toBe('ok')
    expect(o.result.probes.map((p: { name: string }) => p.name)).toEqual(['D1.A', 'net:VCC'])
    expect(o.result.probes[0].voltage.typical.kind).toBe('value')
    expect(o.result.findings.every((f: { code: string }) => f.code.startsWith('sim-'))).toBe(true)
    expect(r.err).toMatch(/^Simulation: /)
  }, 60_000)
  it('exits 1 on a blocking finding (a battery shorted through a closed switch)', async () => {
    const dir = tempDir()
    write(dir, 'n.json', {
      format: 'circuitoon-netlist/1', title: 'short',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }],
      nets: [{ name: 'A', pins: ['BT1.+', 'S1.1'] }, { name: 'GND', pins: ['S1.2', 'BT1.-'] }],
    })
    const r = await cli(['sim', 'n.json'], { cwd: dir })
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).result.findings[0]).toMatchObject({ code: 'sim-short', severity: 'error' })
  }, 60_000)
  it('exits 2 on bad input: no file, not a sheet, an unknown probe', async () => {
    const dir = tempDir()
    expect((await cli(['sim'], { cwd: dir })).code).toBe(2)
    write(dir, 'x.json', { hello: 1 })
    expect((await cli(['sim', 'x.json'], { cwd: dir })).code).toBe(2)
    write(dir, 'n.json', ledNetlist())
    expect((await cli(['sim', 'n.json', '--probe', 'Q9.1'], { cwd: dir })).code).toBe(2)
  }, 60_000)
  it('collects repeated --probe flags (ruling R26)', () => {
    const r = parseArgs(['sim', 'a.json', '--probe', 'D1', '--probe', 'net:GND'])
    expect(r.ok && r.value.lists?.get('--probe')).toEqual(['D1', 'net:GND'])
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/cli/simCmd.test.ts`
Expected: FAIL: `unknown option --probe` and `unknown command "sim"`.

- [ ] **Step 3: Repeatable flags**

In `src/cli/args.ts`:

```ts
export interface Args {
  command?: string
  positionals: string[]
  flags: Map<string, string | true>
  /** Flags that may repeat, each value in order (ruling R26: --probe). */
  lists?: Map<string, string[]>
}

const LIST_FLAGS = new Set(['--probe'])
```

In `parseArgs`, before the `VALUE_FLAGS` check:

```ts
    if (LIST_FLAGS.has(name)) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) return { ok: false, error: `${raw} needs a value` }
      lists.set(name, [...(lists.get(name) ?? []), v])
      i++
      continue
    }
```

with `const lists = new Map<string, string[]>()` declared next to `flags`, and `return { ok: true, value: { command, positionals: rest, flags, lists } }`.

- [ ] **Step 4: Write the command**

`src/cli/simCmd.ts`:

```ts
// `circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...` (spec 7): solves the
// sheet as a DC circuit in its saved switch and GPIO state and prints the SimOutcome JSON on
// stdout, with a short summary on stderr. Simulation findings only (spec 2.1). Exit 0 clean, 1 a
// blocking finding, 2 bad input, 3 the solve failed or the engine is unavailable.
import { type Diagram, type Probe, validateDiagram } from '../format/diagram.ts'
import { isObj } from '../format/module.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { sheetNets } from '../agent/extract.ts'
import { naturalCompare } from '../agent/order.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { nextProbeId } from '../sim/probes.ts'
import type { SimOutcome } from '../sim/results.ts'
import { solve } from '../sim/session.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, printJson, readJson } from './io.ts'

const USAGE = 'sim: usage: circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...'
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** One --probe: "REF.PIN", "REF" or "net:NAME" on the sheet (refs as the netlist names them). */
function probeOf(spec: string, d: Diagram, id: string): Probe {
  const sn = sheetNets(d)
  const uidOf = new Map([...sn.refOf].map(([uid, ref]) => [ref, uid]))
  if (spec.startsWith('net:')) {
    const net = sn.nets.find((n) => n.name === spec.slice(4))
    if (!net) throw new CliError(`sim: --probe ${spec}: no net "${spec.slice(4)}"`, EXIT.input)
    const pin = [...net.pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
    return { id, name: spec, at: { part: uidOf.get(pin.ref)!, pin: pin.name } }
  }
  const dot = spec.indexOf('.')
  const ref = dot < 0 ? spec : spec.slice(0, dot)
  const uid = uidOf.get(ref) ?? d.parts.find((p) => p.uid === ref)?.uid
  if (!uid) throw new CliError(`sim: --probe ${spec}: no part "${ref}"`, EXIT.input)
  if (dot < 0) return { id, name: spec, at: { part: uid } }
  const pin = spec.slice(dot + 1)
  const m = d.modules[d.parts.find((p) => p.uid === uid)!.module]
  const has = m && (m.pins.some((x) => 'name' in x && x.name === pin) || (m.holes ?? []).some((h) => h.name === pin))
  if (!has) throw new CliError(`sim: --probe ${spec}: ${ref} has no pin "${pin}"`, EXIT.input)
  return { id, name: spec, at: { part: uid, pin } }
}

function summary(o: SimOutcome): string {
  if (o.status === 'unavailable') return `Simulation unavailable: ${o.reason}\n`
  if (o.status === 'failed') return `Simulation failed: ${o.finding.message}\n`
  const r = o.result
  const count = (s: string) => r.findings.filter((f) => f.severity === s).length
  const lines = [`Simulation: typical and peak solved in ${Math.round(r.engine.ms)} ms (${r.engine.runs} engine runs). ${plural(count('error'), 'blocking finding')}, ${plural(count('warning'), 'warning')}, ${plural(count('note'), 'note')}.`]
  for (const f of r.findings) lines.push(`  ${f.severity}: ${f.message}`)
  for (const p of r.probes) {
    const v = p.voltage?.typical
    if (v) lines.push(`  ${p.id} ${p.name ?? ''}: ${v.kind === 'value' ? `${v.value.toFixed(3)} V (to ${v.reference})` : v.kind}`)
  }
  return `${lines.join('\n')}\n`
}

export async function simCommand(args: Args, io: Io, opts: { engine?: Engine } = {}): Promise<number> {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError(USAGE, EXIT.input)
  if (rest.length) throw new CliError(`sim: give one sheet or netlist file, not ${args.positionals.length}`, EXIT.input)
  const raw = readJson(io, input)
  let d: Diagram
  if (isObj(raw) && raw.format === 'circuitoon-netlist/1') {
    const r = layoutNetlist(raw)
    if (!r.ok) throw new CliError(`${input}: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    d = r.value.diagram
    for (const w of r.value.intent.probeWarnings) io.stderr(`warning: ${w}\n`)
    // Ruling R6: a netlist probe's ref is kept, not used.
    for (const p of r.value.intent.probes) if (p.ref) io.stderr(`note: probe ${p.id} names ref ${p.ref}; readings are relative to its island's reference (differential probes come later)\n`)
  } else {
    const v = validateDiagram(raw)
    if (!v.ok) throw new CliError(`${input} is not a Circuitoon sheet or netlist: ${v.errors.slice(0, 5).join('; ')}`, EXIT.input)
    d = v.diagram
    for (const w of v.warnings) io.stderr(`warning: ${w}\n`)
  }
  let next = d
  const probes = (args.lists?.get('--probe') ?? []).map((s) => {
    const p = probeOf(s, d, nextProbeId(next))
    next = { ...next, probes: [...(next.probes ?? []), p] }
    return p
  })
  const engine = opts.engine ?? makeEngine(createNodeEngineHost())
  try {
    const { outcome } = await solve(d, engine, 1, { probes })
    printJson(io, outcome)
    io.stderr(summary(outcome))
    if (outcome.status !== 'ok') return EXIT.environment
    return outcome.result.findings.some((f) => f.severity === 'error') ? EXIT.blocked : EXIT.ok
  } finally {
    if (!opts.engine) engine.dispose()
  }
}
```

In `src/cli/main.ts`, import `simCommand`, add `sim: simCommand` to `COMMANDS`, and add to `USAGE` after the `gate` line:

```
  sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...
                                            solve the sheet as a DC circuit in its saved switch and GPIO state:
                                            the outcome JSON on stdout (simulation findings only), a summary on stderr
```

- [ ] **Step 5: Write the schema**

`plugin/skills/circuitoon-design/references/schemas/sim.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "circuitoon sim: a SimOutcome",
  "type": "object",
  "required": ["status"],
  "additionalProperties": false,
  "properties": {
    "status": { "enum": ["ok", "failed", "unavailable"] },
    "result": { "$ref": "#/$defs/result" },
    "revision": { "type": "integer" },
    "finding": { "$ref": "#/$defs/finding" },
    "lastGood": { "type": "object", "required": ["revision", "result"], "properties": { "revision": { "type": "integer" }, "result": { "$ref": "#/$defs/result" } } },
    "reason": { "type": "string" }
  },
  "$defs": {
    "reading": {
      "type": "object",
      "required": ["kind"],
      "additionalProperties": false,
      "properties": {
        "kind": { "enum": ["value", "floating", "undefined", "indeterminate"] },
        "value": { "type": "number" },
        "reference": { "type": "string" },
        "trust": { "enum": ["ok", "outside-model"] },
        "why": { "type": "string" }
      }
    },
    "partRun": {
      "type": "object",
      "required": ["pins", "power"],
      "additionalProperties": false,
      "properties": { "pins": { "type": "object" }, "power": { "$ref": "#/$defs/reading" }, "state": { "enum": ["lit", "dark"] } }
    },
    "run": { "type": "object", "required": ["nets", "parts"], "additionalProperties": false, "properties": { "nets": { "type": "object" }, "parts": { "type": "object" } } },
    "finding": {
      "type": "object",
      "required": ["code", "severity", "parts", "message", "basis", "inputs"],
      "additionalProperties": false,
      "properties": {
        "code": { "enum": ["sim-short", "sim-source-conflict", "sim-over-abs-max", "sim-over-limit", "sim-brownout", "sim-dropout", "sim-converter-off", "sim-min-load", "sim-outside-model", "sim-floating-input", "sim-no-convergence", "sim-incomplete", "sim-estimate"] },
        "severity": { "enum": ["error", "warning", "note"] },
        "parts": { "type": "array", "items": { "type": "string" } },
        "message": { "type": "string" },
        "corner": { "enum": ["typical", "peak"] },
        "basis": { "enum": ["datasheet", "representative", "estimate", "user", "topology"] },
        "inputs": { "type": "array", "items": { "type": "string" } },
        "raw": { "type": "string" }
      }
    },
    "budget": {
      "type": "object",
      "required": ["id", "kind", "part", "label", "volts", "amps", "basis"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "kind": { "enum": ["source", "rail", "domain"] },
        "part": { "type": "string" },
        "label": { "type": "string" },
        "volts": { "type": "object", "required": ["typical", "peak"], "properties": { "typical": { "$ref": "#/$defs/reading" }, "peak": { "$ref": "#/$defs/reading" } } },
        "amps": { "type": "object", "required": ["typical", "peak"], "properties": { "typical": { "$ref": "#/$defs/reading" }, "peak": { "$ref": "#/$defs/reading" } } },
        "limit": { "type": "object", "required": ["value", "kind", "basis"], "properties": { "value": { "type": "number" }, "kind": { "type": "string" }, "basis": { "type": "string" } } },
        "headroom": { "type": "number" },
        "basis": { "enum": ["datasheet", "representative", "estimate", "user", "topology"] }
      }
    },
    "probe": {
      "type": "object",
      "required": ["id", "at"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "at": { "type": "object", "required": ["part"], "additionalProperties": false, "properties": { "part": { "type": "string" }, "pin": { "type": "string" } } },
        "voltage": { "type": "object", "required": ["typical", "peak"], "properties": { "typical": { "$ref": "#/$defs/reading" }, "peak": { "$ref": "#/$defs/reading" } } },
        "part": { "type": "object", "required": ["typical", "peak"], "properties": { "typical": { "$ref": "#/$defs/partRun" }, "peak": { "$ref": "#/$defs/partRun" } } }
      }
    },
    "result": {
      "type": "object",
      "required": ["format", "revision", "corners", "budget", "findings", "unsimulated", "probes", "notes", "engine"],
      "additionalProperties": false,
      "properties": {
        "format": { "const": "circuitoon-sim/1" },
        "revision": { "type": "integer" },
        "corners": { "type": "object", "required": ["typical", "peak"], "additionalProperties": false, "properties": { "typical": { "$ref": "#/$defs/run" }, "peak": { "$ref": "#/$defs/run" } } },
        "budget": { "type": "array", "items": { "$ref": "#/$defs/budget" } },
        "findings": { "type": "array", "items": { "$ref": "#/$defs/finding" } },
        "unsimulated": { "type": "array", "items": { "type": "object", "required": ["part", "reason"], "additionalProperties": false, "properties": { "part": { "type": "string" }, "reason": { "type": "string" } } } },
        "probes": { "type": "array", "items": { "$ref": "#/$defs/probe" } },
        "notes": { "type": "array", "items": { "type": "string" } },
        "engine": { "type": "object", "required": ["name", "version", "build", "runs", "ms"], "additionalProperties": false, "properties": { "name": { "const": "ngspice" }, "version": { "type": "string" }, "build": { "type": "string" }, "runs": { "type": "integer" }, "ms": { "type": "number" } } }
      }
    }
  }
}
```

In `plugin/skills/circuitoon-design/references/cli.md`, add a section for the command (after `gate`):

```markdown
## sim

`circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...` solves the sheet as a DC circuit in its saved state: switch positions (`values["contact.<group>"]`) and GPIO states (`values["gpio.<pin>"]`). A netlist is laid out first. It prints the outcome (`schemas/sim.schema.json`) on stdout and a short summary on stderr, and reports simulation findings only (`sim-*`); the wiring checker's findings stay in `check` and `gate`.

- Exit 0: solved, nothing blocks. Exit 1: a blocking finding (an `error`: at the typical corner, decided on datasheet, user or topology values). Exit 2: bad input. Exit 3: the solve failed or the engine is unavailable.
- Each finding has `basis` and `inputs`: a finding decided on `representative` or `estimate` values is a warning worded "Likely", never blocking. Findings at the peak corner are warnings labelled with the peak's condition.
- `--probe` repeats. `REF.PIN` reads a pin's voltage, `REF` a part's current per pin and its power, `net:NAME` a net's voltage. Probes saved in the sheet are read too.
- Readings: a voltage names its reference (`"reference": "GND"`); `floating` means nothing on the sheet drives that node; `undefined` means it is not simulated (mains wiring).
```

- [ ] **Step 5b: Run the tests**

Run: `npx vitest run src/cli/simCmd.test.ts src/cli/cli.test.ts src/cli/args.test.ts`
Expected: PASS. (`src/cli/args.test.ts` may not exist; vitest then runs the other two.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/simCmd.ts src/cli/simCmd.test.ts src/cli/args.ts src/cli/main.ts plugin/skills/circuitoon-design/references/schemas/sim.schema.json plugin/skills/circuitoon-design/references/cli.md
git commit -m "$(cat <<'MSG'
CLI: circuitoon sim (outcome JSON, repeatable --probe, exit codes per spec 7)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 31: `gate/4`

**Files:**
- Modify: `src/cli/gate.ts`, `src/agent/notChecked.ts`, `plugin/skills/circuitoon-design/references/schemas/gate.schema.json`, `plugin/skills/circuitoon-design/references/cli.md` (gate section), `plugin/skills/circuitoon-design/SKILL.md` ("Reading the gate"), `README.md:151`
- Test: `src/cli/gate.test.ts` (update and add)

**Interfaces:**
- Consumes: `solve` (Task 29), `makeEngine`, `createNodeEngineHost`, `SimFinding`, `DomainBudget`, `Basis`.
- Produces: `GATE_FORMAT = 'circuitoon-cli/gate/4'`; `GateReport.sim: { status: 'ok' | 'failed' | 'unavailable' | 'not-run'; findings: SimFinding[]; budget: DomainBudget[]; provenanceCounts: Record<Basis, number>; reason?: string }`; `runGate(bytes, { ...opts, engine?: Engine })`.

The matrix (spec 7) decides `blocking`, `ok`, `ready`, exit and banner:

| Checker | Sim | blocking | ok | ready | Exit | Banner |
|---|---|---|---|---|---|---|
| errors | any | checker errors (+ sim blocking) | false | false | 1 | GATE FAILED |
| clean | ok, blocking | sim blocking | false | false | 1 | GATE FAILED (simulation) |
| clean | ok, warnings only | [] | true | readability rules | 0 | GATE PASSED, with warnings |
| clean | ok, clean | [] | true | readability rules | 0 | GATE PASSED |
| clean | failed | [] | false | false | 3 | GATE INCOMPLETE (simulation did not converge; this may be our model, not your circuit) |
| clean | unavailable | [] | false | false | 3 | GATE INCOMPLETE (simulation unavailable) |

Sim errors go to `blocking`, sim warnings to `warnings`, sim notes (`sim-incomplete`, `sim-estimate`) to `notes` (severity `info`), each as a `CliFinding` with `rule` = the code. The failure finding of a `failed` run goes to `warnings` (it never blocks). Ruling R15: `GATE FAILED` replaces `GATE BLOCKED`.

- [ ] **Step 1: Update the existing gate tests and add the new ones**

In `src/cli/gate.test.ts`: replace `'GATE BLOCKED'` with `'GATE FAILED'` and `'circuitoon-cli/gate/3'` with `'circuitoon-cli/gate/4'`. Then append:

```ts
describe('gate/4: simulation (spec 7)', () => {
  const failing = (status: 'failed' | 'unavailable'): Engine => ({
    host: { runs: 0, info: null } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run: async (_c, _a, revision) => (status === 'failed' ? { status, revision, error: 'singular matrix', nodes: [] } : { status, reason: 'no engine' }),
    dispose() {},
  })
  const shorted = async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify({
      format: 'circuitoon-netlist/1', title: 'short',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }],
      nets: [{ name: 'A', pins: ['BT1.+', 'S1.1'] }, { name: 'GND', pins: ['S1.2', 'BT1.-'] }],
    }))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    return dir
  }
  it('fails on a blocking simulation finding when the checker is clean of errors', async () => {
    const dir = await shorted()
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(g.sim.status).toBe('ok')
    expect(g.blocking.some((f: { rule: string }) => f.rule === 'sim-short')).toBe(true)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/GATE FAILED/)
  }, 120_000)
  it('is incomplete (exit 3) when the solve fails or the engine is unavailable, and never blocks on it', async () => {
    for (const [status, banner] of [['failed', 'simulation did not converge'], ['unavailable', 'simulation unavailable']] as const) {
      const dir = await laidOut()
      const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir), engine: failing(status) })
      expect(code).toBe(EXIT.environment)
      expect(report.ok).toBe(false)
      expect(report.ready).toBe(false)
      expect(report.blocking).toEqual([])
      expect(report.sim.status).toBe(status)
      expect(gateBanner(code, report, 'sheet.json')).toContain(banner)
    }
  }, 240_000)
  it('reports an unplugged board in its own group: the checker findings are what checkDiagram gives, and the sim adds its warning', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify({ format: 'circuitoon-netlist/1', title: 'devkit', parts: [{ ref: 'U1', module: 'esp32-devkit-v1-30' }, { ref: 'R1', module: 'resistor' }], nets: [{ name: 'IO', pins: ['U1.D4', 'R1.1'] }, { name: 'GND', pins: ['R1.2', 'U1.GND'] }] }))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const bytes = readFileSync(join(dir, 'sheet.json'))
    const { report } = await runGate(bytes, { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    const v = validateDiagram(JSON.parse(bytes.toString('utf8')))
    if (!v.ok) throw new Error('sheet')
    const checker = checkDiagram(v.diagram).map((f) => f.id).sort()
    const gated = [...report.blocking, ...report.warnings, ...report.notes].filter((f) => !f.rule.startsWith('sim-') && checker.includes(f.id)).map((f) => f.id).sort()
    expect(gated).toEqual(checker)
    expect(report.warnings.some((f) => f.rule === 'sim-brownout' && f.message.includes('is not powered'))).toBe(true)
  }, 120_000)
})
```

Add the imports this block needs at the top of the file: `import { checkDiagram } from '../format/checks.ts'`, `import type { Engine } from '../sim/engine/engine.ts'`, `import type { EngineHost } from '../sim/engine/host.ts'`, and `gateBanner` next to `runGate` from `./gate.ts` (`validateDiagram` is already imported). The test sheets run without a browser, so the PNG is missing too; the banner still names the simulation first, because the matrix ranks it above the render.

Then run every other test that reads the gate's text or lists warnings exactly:

Run: `grep -rn "GATE BLOCKED\|gate/3" src plugin README.md docs/PRD.md`
Expected after Step 3: no hits outside `docs/superpowers/` (specs and plans are history and stay as they are).

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run src/cli/gate.test.ts`
Expected: FAIL: `report.sim` is undefined, the format is still gate/3, the banner says BLOCKED.

- [ ] **Step 3: Write gate/4**

In `src/cli/gate.ts` (declare `sim` in `runGate` before `const finish = ...`, which reads it):

```ts
import { makeEngine, type Engine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import type { DomainBudget, SimFinding } from '../sim/results.ts'
import type { Basis } from '../sim/model.ts'

export const GATE_FORMAT = 'circuitoon-cli/gate/4'

export interface GateSim {
  status: 'ok' | 'failed' | 'unavailable' | 'not-run'
  findings: SimFinding[]
  budget: DomainBudget[]
  provenanceCounts: Record<Basis, number>
  reason?: string
}
```

Add `sim: GateSim` to `GateReport` (after `notes`), `engine?: Engine` to `runGate`'s options, and in `runGate`:

```ts
  let sim: GateSim = { status: 'not-run', findings: [], budget: [], provenanceCounts: { datasheet: 0, representative: 0, estimate: 0, user: 0, topology: 0 } }
```

After the readability and custom-part findings (the sheet `d` is loaded and checked), run the simulation and file its findings:

```ts
  // Simulation (spec 7): its own findings, never suppressing or suppressed by the checker (2.1).
  const engine = opts.engine ?? makeEngine(createNodeEngineHost())
  try {
    const { outcome } = await solve(d, engine, 1)
    if (outcome.status === 'ok') {
      const r = outcome.result
      const counts = { datasheet: 0, representative: 0, estimate: 0, user: 0, topology: 0 }
      for (const f of r.findings) counts[f.basis]++
      sim = { status: 'ok', findings: r.findings, budget: r.budget, provenanceCounts: counts }
      for (const f of r.findings)
        found.push({ id: `${f.code}|${f.parts.join(',')}|${f.corner ?? ''}`, rule: f.code, severity: f.severity === 'note' ? 'info' : f.severity, message: f.message, parts: f.parts, pins: [], wires: [] })
    } else if (outcome.status === 'failed') {
      sim = { ...sim, status: 'failed', findings: [outcome.finding], reason: outcome.finding.message }
      found.push({ id: 'sim-no-convergence', rule: 'sim-no-convergence', severity: 'warning', message: outcome.finding.message, parts: outcome.finding.parts, pins: [], wires: [] })
    } else sim = { ...sim, status: 'unavailable', reason: outcome.reason }
  } finally {
    if (!opts.engine) engine.dispose()
  }
```

In `finish()`, the exit code follows the matrix:

```ts
    const simIncomplete = sim.status === 'failed' || sim.status === 'unavailable'
    const code = blocking.length ? EXIT.blocked : missing.length || simIncomplete ? EXIT.environment : EXIT.ok
```

and add `sim` to the report object. Replace the banner computation in `gateCommand` with an exported function:

```ts
/** The gate's verdict line (spec 7 matrix, ruling R15). */
export function gateBanner(code: number, report: GateReport, input: string): string {
  if (code === EXIT.ok) return `${report.warnings.length ? 'GATE PASSED, with warnings' : 'GATE PASSED'}: ${input} (sha256 ${report.diagram.sha256})`
  if (code === EXIT.environment) {
    if (report.sim.status === 'failed') return `GATE INCOMPLETE (simulation did not converge; this may be our model, not your circuit): ${input}`
    if (report.sim.status === 'unavailable') return `GATE INCOMPLETE (simulation unavailable): ${input}`
    return `GATE INCOMPLETE: nothing blocks, but not every render could be made (${input})`
  }
  const simOnly = report.blocking.every((f) => f.rule.startsWith('sim-'))
  return `${simOnly ? 'GATE FAILED (simulation)' : 'GATE FAILED'}: ${plural(report.blocking.length, 'blocking finding')} (${input})`
}
```

and in `gateCommand` use `const head = gateBanner(code, report, input)`.

In `src/agent/notChecked.ts`, replace the first entry ("Current and heat ...") with:

```ts
  'Current and heat beyond the simulated DC operating point: wire gauge against current, part temperatures, and anything that changes over time (PWM, start-up, inrush, battery discharge). The simulation solves the saved switch and GPIO state only.',
```

In `gate.schema.json`: set `"format": { "const": "circuitoon-cli/gate/4" }`, add `"sim"` to `required`, add `"info"` handling is unchanged, and add the property:

```json
    "sim": {
      "type": "object",
      "required": ["status", "findings", "budget", "provenanceCounts"],
      "additionalProperties": false,
      "properties": {
        "status": { "enum": ["ok", "failed", "unavailable", "not-run"] },
        "findings": { "type": "array", "items": { "type": "object", "required": ["code", "severity", "parts", "message", "basis", "inputs"] } },
        "budget": { "type": "array", "items": { "type": "object", "required": ["id", "kind", "part", "label", "volts", "amps", "basis"] } },
        "provenanceCounts": { "type": "object", "required": ["datasheet", "representative", "estimate", "user", "topology"] },
        "reason": { "type": "string" }
      }
    },
```

- [ ] **Step 4: Update the docs that read the gate**

- `plugin/skills/circuitoon-design/references/cli.md`: the `gate.json` line says `circuitoon-cli/gate/4`, adding "version 4 added the required `sim` (status, findings, budget, provenance counts)"; the text-mode line lists `GATE PASSED`, `GATE PASSED, with warnings`, `GATE FAILED`, `GATE FAILED (simulation)` and the three `GATE INCOMPLETE` forms.
- `plugin/skills/circuitoon-design/SKILL.md` "Reading the gate": rename `GATE BLOCKED` to `GATE FAILED`; add `GATE FAILED (simulation)` ("a blocking simulation finding: read its message and its `inputs`; fix the circuit, or set the GPIO states and switch positions to what the firmware and the user will do, and gate again"), `GATE PASSED, with warnings` ("present, and report every warning; simulation warnings worded 'Likely' rest on representative or estimated values"), and the two simulation `GATE INCOMPLETE` banners ("did not converge: this may be our model, not your circuit; tell the user, present nothing as fully gated" and "simulation unavailable: the engine files are missing beside the CLI; reinstall the plugin").
- `README.md:151`: `gate.json` (format `circuitoon-cli/gate/4`).

- [ ] **Step 5: Run the gate and CLI tests**

Run: `npx vitest run src/cli`
Expected: PASS. Where an existing test lists a sheet's warnings or notes exactly, the simulator now adds its own (for example a "not powered" warning on a sheet with no supply): add them to that expectation as the run reports them, or filter `rule.startsWith('sim-')` out of that one assertion, and say which in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/cli/gate.ts src/cli/gate.test.ts src/agent/notChecked.ts plugin/skills/circuitoon-design README.md
git commit -m "$(cat <<'MSG'
Gate 4: simulation findings in their own field, the spec 7 matrix, GATE FAILED and the simulation banners

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 32: The Spirit Typewriter fixture and the solve budget

**Files:**
- Create: `src/sim/fixtures/spirit-typewriter.netlist.json`
- Modify: `src/sim/testing.ts` (add `netSheet`)
- Test: `src/sim/spirit.test.ts`, `src/sim/solve.perf.test.ts`

**Interfaces:**
- Consumes: everything in Phases B to D; the sourced data of Phase C.
- Produces: `function netSheet(netlist: { parts: { ref: string; module: string; values?: Record<string, unknown> }[]; nets: { name: string; pins: string[] }[] }): Diagram` (a sheet with every net wired pin to pin, no layout: the simulator needs only connectivity).

- [ ] **Step 1: Write the fixture (spec 1, ruling R23)**

`src/sim/fixtures/spirit-typewriter.netlist.json`:

```json
{
  "format": "circuitoon-netlist/1",
  "title": "Spirit Typewriter power and display bus",
  "parts": [
    { "ref": "BT1", "module": "battery-18650-holder" },
    { "ref": "BT2", "module": "battery-18650-holder" },
    { "ref": "BT3", "module": "battery-18650-holder" },
    { "ref": "BT4", "module": "battery-18650-holder" },
    { "ref": "U5", "module": "ip5306-usbc-module" },
    { "ref": "SW1", "module": "rocker-switch-kcd1", "values": { "contact.s": "closed" } },
    { "ref": "U1", "module": "esp32-devkit-v1-30", "values": { "gpio.D21": "input-pullup", "gpio.D22": "input-pullup" } },
    { "ref": "DS1", "module": "oled-ssd1306-096-i2c" },
    { "ref": "DS2", "module": "lcd-st7796s-4in-spi-touch" },
    { "ref": "DS3", "module": "lcd-st7796s-4in-spi-touch" },
    { "ref": "U2", "module": "mcp23017-cjmcu-2317" },
    { "ref": "U3", "module": "mcp23017-cjmcu-2317" },
    { "ref": "U4", "module": "mcp23017-cjmcu-2317" },
    { "ref": "R1", "module": "resistor", "values": { "resistance": { "value": 330, "unit": "ohm" } } },
    { "ref": "D1", "module": "led" }
  ],
  "nets": [
    { "name": "BAT", "pins": ["BT1.+", "BT2.+", "BT3.+", "BT4.+", "U5.B+"] },
    { "name": "GND", "pins": ["BT1.-", "BT2.-", "BT3.-", "BT4.-", "U5.B-", "U5.5V-", "U1.GND", "DS1.GND", "DS2.GND", "DS3.GND", "U2.GND", "U3.GND", "U4.GND", "D1.K"] },
    { "name": "VSW", "pins": ["U5.5V+", "SW1.1"] },
    { "name": "5V", "pins": ["SW1.2", "U1.VIN", "R1.1"] },
    { "name": "LED_A", "pins": ["R1.2", "D1.A"] },
    { "name": "3V3", "pins": ["U1.3V3", "DS1.VCC", "DS2.VCC", "DS2.LED", "DS3.VCC", "DS3.LED", "U2.VCC", "U3.VCC", "U4.VCC"] },
    { "name": "SDA", "pins": ["U1.D21", "DS1.SDA", "U2.SDA", "U3.SDA", "U4.SDA"] },
    { "name": "SCL", "pins": ["U1.D22", "DS1.SCL", "U2.SCL", "U3.SCL", "U4.SCL"] }
  ]
}
```

Add to `src/sim/testing.ts`:

```ts
/** A sheet from a netlist with each net wired pin to pin in order (no layout: the simulator needs only connectivity). Uids are the refs. */
export function netSheet(n: { parts: { ref: string; module: string; values?: Record<string, unknown> }[]; nets: { name: string; pins: string[] }[] }): Diagram {
  const wires = n.nets.flatMap((net) => net.pins.slice(1).map((p, i): [string, string] => [net.pins[i], p]))
  return sheet(n.parts.map((p) => ({ uid: p.ref, module: p.module, designator: p.ref, ...(p.values ? { values: p.values } : {}) })), wires)
}
```

- [ ] **Step 2: Write the fixture test**

`src/sim/spirit.test.ts`:

```ts
// Spec 1 and 9: the Spirit Typewriter. Every powered part has power data with honest provenance;
// the rail voltages match hand calculations made here from the same module data; the findings are
// the expected ones. The hand calculations use the sourced numbers read from the modules, so this
// file carries no datasheet number of its own.
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { simOf } from '../format/simModel.ts'
import { NO_POWER_DATA } from './estimates.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { deviceParams } from './findings.ts'
import { solve } from './session.ts'
import { netSheet } from './testing.ts'

const n = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'spirit-typewriter.netlist.json'), 'utf8'))
const d = netSheet(n)
const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

describe('the Spirit Typewriter (spec 1)', () => {
  it('has power data for every powered part, with honest provenance', async () => {
    const { circuit } = await solve(d, engine, 1)
    expect(circuit.unsimulated.filter((u) => u.reason === NO_POWER_DATA)).toEqual([])
    for (const dev of circuit.devices) for (const p of deviceParams(dev)) {
      expect(['datasheet', 'representative', 'estimate', 'user']).toContain(p.basis)
      if (p.basis === 'estimate') expect(p.note, p.label).toBeTruthy()
    }
  }, 60_000)
  it('puts each rail where the hand calculation from the module data says', async () => {
    const { outcome } = await solve(d, engine, 1)
    if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome))
    const nets = outcome.result.corners.typical.nets
    const volts = (net: string) => (nets[net].kind === 'value' ? (nets[net] as { value: number }).value : Number.NaN)
    // The 3V3 rail: the DevKit's LDO holds vout less its output current through rout.
    const esp = simOf(load('esp32-devkit-v1-30'))!
    const ldo = esp.power!.rails!.find((r) => r.kind === 'ldo')!
    const loads3 = [['esp32-devkit-v1-30', '3V3'], ['oled-ssd1306-096-i2c', 'VCC'], ['lcd-st7796s-4in-spi-touch', 'VCC'], ['lcd-st7796s-4in-spi-touch', 'VCC'], ['lcd-st7796s-4in-spi-touch', 'LED'], ['lcd-st7796s-4in-spi-touch', 'LED'], ['mcp23017-cjmcu-2317', 'VCC'], ['mcp23017-cjmcu-2317', 'VCC'], ['mcp23017-cjmcu-2317', 'VCC']]
      .reduce((s, [id, dom]) => s + (simOf(load(id))!.power!.draw!.find((x) => x.domain === dom)?.typical.value ?? 0), 0)
    const rout = (ldo.rout?.value ?? 0.1)
    expect(Math.abs(volts('3V3') - (ldo.vout!.value - loads3 * rout))).toBeLessThan(0.02)
    // The 5 V rail: the IP5306 boost's vout less its output current (the LDO's input plus the LED) through rout.
    const ip = simOf(load('ip5306-usbc-module'))!.power!.rails!.find((r) => r.kind === 'boost')!
    const i5 = loads3 + (ldo.iq?.value ?? 0) + (volts('5V') - 2) / 330
    expect(Math.abs(volts('VSW') - (ip.vout!.value - i5 * (ip.rout?.value ?? 0.1)))).toBeLessThan(0.02)
    // The battery bank: four cells in parallel sag by the boost's input current through a quarter of one cell's rInternal.
    const cell = simOf(load('battery-18650-holder'))!
    const r4 = cell.modelParams!.rInternal.value / 4
    let vbat = 3.7
    for (let k = 0; k < 20; k++) vbat = 3.7 - ((volts('VSW') * i5) / (ip.efficiency!.value * vbat)) * r4
    expect(Math.abs(volts('BAT') - vbat)).toBeLessThan(0.02)
  }, 60_000)
  it('lists the expected findings: nothing blocks, nothing warns, the estimates are noted', async () => {
    const { outcome } = await solve(d, engine, 1)
    if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome))
    expect(outcome.result.findings.filter((f) => f.severity !== 'note')).toEqual([])
    expect(outcome.result.findings.map((f) => f.code)).toEqual(['sim-estimate'])
  }, 60_000)
})
```

If the sourced data makes a different finding appear (for example a sourced minimum load the bank's draw sits under), do not delete it: work out by hand whether it is right, write that reasoning as a comment in the test, and list the finding in the expectation.

- [ ] **Step 3: Write the solve budget test**

`src/sim/solve.perf.test.ts`:

```ts
// Spec 8: one solve (2 engine runs) of a 200-part circuit, Worker end to end, p95 at most 30 ms.
// Ruling R31: measured from the compiled circuit to the mapped result (compile, worker round trip,
// solve, map back) for both corners; building the circuit from the sheet is the editor's per-edit
// cost, covered by the drag budget (Task 39).
import { afterAll, describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { cellModule, sheet } from './testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())

describe('solve budget', () => {
  it('solves 201 parts (a battery and 100 resistor-LED pairs) in p95 30 ms or less, both corners', async () => {
    const parts = [{ uid: 'bt1', module: cellModule(5, 0.05) }]
    const wires: [string, string][] = []
    for (let i = 0; i < 100; i++) {
      parts.push({ uid: `r${i}`, module: 'resistor', values: { resistance: { value: 150 + i, unit: 'ohm' } } } as never, { uid: `d${i}`, module: 'led' } as never)
      wires.push(['bt1.+', `r${i}.1`], [`r${i}.2`, `d${i}.A`], [`d${i}.K`, 'bt1.-'])
    }
    const c = buildCircuit(sheet(parts, wires))
    const times: number[] = []
    for (let k = 0; k < 65; k++) {
      const t0 = performance.now()
      for (const corner of ['typical', 'peak'] as const) expect((await engine.run(c, { kind: 'op', corner }, k)).status).toBe('ok')
      if (k >= 5) times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(30)
  }, 120_000)
})
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/sim/spirit.test.ts` then `npx vitest run src/sim/solve.perf.test.ts`
Expected: PASS. A missed budget is reported at the checkpoint with the measured p95, not hidden.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test && npm run validate && npm run build`
Expected: PASS.

```bash
git add src/sim/fixtures src/sim/testing.ts src/sim/spirit.test.ts src/sim/solve.perf.test.ts
git commit -m "$(cat <<'MSG'
Sim: the Spirit Typewriter fixture (hand-calculated rails, expected findings) and the 200-part solve budget

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: Astra review of phase D

The review covers spec checkpoint 6: `results.ts`, `findings.ts`, the session, `circuitoon sim`, gate/4 and probes in netlists. Before it: `npm test`, `npm run build` and `npm run validate` pass.

---

# Phase E: the editor

Every editor task follows the existing Graphite and Sticker look (load the `frontend-design` skill first, per Michael's standing rule): Fredoka headings, Atkinson Hyperlegible body, 1.5 px rules, sticker edges (`border: 1.5px solid var(--text)` with a `3px 3px 0 var(--shadow)` offset shadow), yellow as the one chrome accent, and colour tokens from `src/styles.css` only, so both themes follow. The sheet's paper stays light in both themes; marks drawn on it use fixed colours, as the existing badges do.

### Task 33: The Simulate toggle, the editor's session and its status

**Files:**
- Create: `src/editor/simulation.ts`, `src/editor/SimStatus.tsx`
- Modify: `src/editor/store.ts` (simulation state), `src/editor/Editor.tsx` (`useSimulation`, keys S and P), `src/editor/Toolbar.tsx` (Simulate and Probe toggles, `SimStatus`), `src/editor/editor.css`
- Test: `src/editor/simulation.test.ts`, `src/editor/store.test.ts` (add)

**Interfaces:**
- Consumes: `SimSession` (Task 29), `makeEngine` (Task 14), `createBrowserEngineHost` (Task 4), `SimOutcome` (Task 26), `Circuit` (Task 6), `netlist`.
- Produces:
  - `type SimView = { phase: 'loading'; loaded: number; total: number } | { phase: 'solving' } | { phase: 'done'; outcome: SimOutcome; circuit: Circuit | null }`
  - `EditorState` gains `simulate: boolean`, `simTool: 'select' | 'probe'`, `sim: SimView | null`, `held: { part: string; group: string } | null`
  - `EditorStore.setSimulate(on: boolean)`, `setSimTool(t: 'select' | 'probe')`, `setSim(v: SimView | null)`, `setHeld(h: { part: string; group: string } | null)`
  - `function solveKey(d: Diagram, held: unknown): string`, `function useSimulation(store: EditorStore): void`, `function browserEngine(): Engine`, `const SIM_TIMEOUT_KEY = 'circuitoon.simTimeoutMs'`
  - `function SimStatus({ store }: { store: EditorStore }): JSX.Element | null`

- [ ] **Step 1: Record the main bundle's size before**

Run:

```bash
npm run build && node -e "const fs=require('fs'),z=require('zlib');for(const f of fs.readdirSync('dist/assets').filter(x=>/\.js$/.test(x)))console.log(f,z.gzipSync(fs.readFileSync('dist/assets/'+f)).length)"
```

Write the `index-*.js` gzip size into the ledger as the baseline (spec 8: the editor main bundle may grow at most 30 KB gzip).

- [ ] **Step 2: Write the failing tests**

`src/editor/simulation.test.ts`:

```ts
// Spec 6.1: a solve on every connectivity or value change, never on a pure move.
import { describe, expect, it } from 'vitest'
import { solveKey } from './simulation.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const base = sheet([{ uid: 'bt1', module: cellModule(5, 0.1) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 100, unit: 'ohm' } } }], [['bt1.+', 'r1.1'], ['r1.2', 'bt1.-']])

describe('solveKey', () => {
  it('ignores a pure move', () => {
    const moved = { ...base, parts: base.parts.map((p) => (p.uid === 'r1' ? { ...p, x: p.x + 200, y: p.y + 70 } : p)) }
    expect(solveKey(moved, null)).toBe(solveKey(base, null))
  })
  it('changes with a value, a wire, a held button or a module', () => {
    const k = solveKey(base, null)
    expect(solveKey({ ...base, parts: base.parts.map((p) => (p.uid === 'r1' ? { ...p, values: { resistance: { value: 220, unit: 'ohm' } } } : p)) }, null)).not.toBe(k)
    expect(solveKey({ ...base, connections: base.connections.slice(1) }, null)).not.toBe(k)
    expect(solveKey(base, { part: 'b1', group: 's' })).not.toBe(k)
    expect(solveKey({ ...base, modules: { ...base.modules, resistor: { ...base.modules.resistor } } }, null)).not.toBe(k)
  })
})
```

Append to `src/editor/store.test.ts`:

```ts
describe('simulation state', () => {
  it('turning Simulate off clears the result, the probe tool and a held button (spec 6.1: never saved)', () => {
    const s = new EditorStore(emptyDiagram())
    s.setSimulate(true)
    s.setSimTool('probe')
    s.setHeld({ part: 'b1', group: 's' })
    s.setSim({ phase: 'solving' })
    s.setSimulate(false)
    const st = s.getState()
    expect([st.simulate, st.simTool, st.sim, st.held]).toEqual([false, 'select', null, null])
    expect(s.dirty).toBe(false)
  })
})
```

(`store.test.ts` already imports `EditorStore`; add `import { emptyDiagram } from '../format/diagram.ts'` if it does not.)

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/editor/simulation.test.ts src/editor/store.test.ts`
Expected: FAIL: `./simulation.ts` cannot be found; `setSimulate` is not a function.

- [ ] **Step 4: Add the state to the store**

In `src/editor/store.ts`:

```ts
import type { SimOutcome } from '../sim/results.ts'
import type { Circuit } from '../sim/model.ts'

/** What the simulation shows now (spec 6.1); live state, never saved and never undo history. */
export type SimView =
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'solving' }
  | { phase: 'done'; outcome: SimOutcome; circuit: Circuit | null }
```

Add to `EditorState`:

```ts
  /** Simulate is on (spec 6.1). Not saved. */
  simulate: boolean
  /** The Probe tool (spec 6.2) or ordinary editing. */
  simTool: 'select' | 'probe'
  sim: SimView | null
  /** A momentary button held down while simulating (spec 4.0, 6.3): closed only while held, never saved. */
  held: { part: string; group: string } | null
```

initialise them in the constructor (`simulate: false, simTool: 'select', sim: null, held: null`), and add the methods:

```ts
  setSimulate(on: boolean) {
    if (on === this.state.simulate) return
    this.set(on ? { simulate: true } : { simulate: false, simTool: 'select', sim: null, held: null })
  }
  setSimTool(simTool: 'select' | 'probe') {
    if (simTool !== this.state.simTool) this.set({ simTool })
  }
  setSim(sim: SimView | null) {
    this.set({ sim })
  }
  setHeld(held: { part: string; group: string } | null) {
    const h = this.state.held
    if (h === held || (h && held && h.part === held.part && h.group === held.group)) return
    this.set({ held })
  }
```

- [ ] **Step 5: Write the hook and the status**

`src/editor/simulation.ts`:

```ts
// The editor's simulation (spec 6.1): one browser engine for the page, loaded the first time
// Simulate is turned on (with determinate progress); a session per Simulate period; a solve on
// every connectivity or value change, never on a pure move (the key ignores positions), and never
// per drag frame (the drop solves); results for older revisions or after Simulate is turned off are
// dropped by the session. Glow and readings are never saved.
import { useEffect, useMemo, useRef } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { netlist } from '../format/netlist.ts'
import { createBrowserEngineHost } from '../sim/engine/browserEngine.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { RUN_TIMEOUT_MS } from '../sim/engine/host.ts'
import { SimSession } from '../sim/session.ts'
import { type EditorStore, useEditorState } from './store.ts'

/** A debug knob for the visual check (Task 38): a run timeout in ms, read before every run. Unset in normal use. */
export const SIM_TIMEOUT_KEY = 'circuitoon.simTimeoutMs'
const timeout = () => {
  try {
    const v = Number(localStorage.getItem(SIM_TIMEOUT_KEY))
    return v > 0 ? v : RUN_TIMEOUT_MS
  } catch {
    return RUN_TIMEOUT_MS
  }
}
let engine: Engine | null = null
const listeners = new Set<(loaded: number, total: number) => void>()
export function browserEngine(): Engine {
  engine ??= makeEngine(createBrowserEngineHost({ timeoutMs: timeout, onProgress: (l, t) => listeners.forEach((f) => f(l, t)) }))
  return engine
}

const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => {
  let v = ids.get(o)
  if (v === undefined) ids.set(o, (v = ++nextId))
  return v
}
/** What decides a solve: connectivity (mounts included), values, settings, module identity and a held button. Never positions. */
export function solveKey(d: Diagram, held: unknown): string {
  return JSON.stringify([
    netlist(d).nets,
    d.parts.map((p) => [p.uid, p.module, p.values ?? null, p.settings ?? null]),
    Object.entries(d.modules).map(([k, m]) => [k, idOf(m)]).sort(),
    held,
  ])
}

export function useSimulation(store: EditorStore): void {
  const { simulate, diagram, held } = useEditorState(store)
  const session = useRef<SimSession | null>(null)
  const revision = useRef(0)
  const lastKey = useRef('')
  useEffect(() => {
    if (!simulate) return
    const onProgress = (loaded: number, total: number) => {
      if (store.getState().sim?.phase !== 'done') store.setSim({ phase: 'loading', loaded, total })
    }
    listeners.add(onProgress)
    const s = new SimSession(browserEngine(), (outcome, circuit) => store.setSim({ phase: 'done', outcome, circuit }))
    session.current = s
    lastKey.current = ''
    store.setSim({ phase: 'solving' })
    return () => {
      s.stop()
      listeners.delete(onProgress)
      session.current = null
      store.setSim(null)
    }
  }, [simulate, store])
  // Never during a drag: the key would rebuild the netlist every frame; the drop solves. A held
  // button is the exception: pressing it starts a (still) part drag, and it must solve while held.
  const key = useMemo(
    () => (simulate && (!store.dragging || held) ? solveKey(diagram, held) : lastKey.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simulate, diagram.parts, diagram.connections, diagram.modules, held],
  )
  useEffect(() => {
    if (!simulate || !session.current || key === lastKey.current) return
    lastKey.current = key
    session.current.request(store.getState().diagram, ++revision.current, { held })
  }, [key, simulate, store, held])
}
```

`src/editor/SimStatus.tsx`:

```tsx
// The simulation's status under the toolbar (spec 6.1): determinate progress while the engine
// first loads, and a banner naming a failure (with the engine's text in a details disclosure) while
// the last good readings stay up, dimmed and marked stale.
import { type EditorStore, useEditorState } from './store.ts'

export function SimStatus({ store }: { store: EditorStore }) {
  const { simulate, sim } = useEditorState(store)
  if (!simulate || !sim) return null
  if (sim.phase === 'loading') {
    const pct = Math.round((100 * sim.loaded) / Math.max(1, sim.total))
    return (
      <section className="sim-status loading" role="status" aria-label="Loading the simulator">
        <strong>Loading the simulator</strong>
        <progress max={sim.total} value={sim.loaded} aria-label={`${pct} percent`} />
        <span className="sim-pct">{pct} %</span>
      </section>
    )
  }
  if (sim.phase !== 'done') return null
  const o = sim.outcome
  if (o.status === 'unavailable')
    return (
      <section className="sim-status failed" role="alert">
        <strong>The simulator could not load.</strong>
        <span>{o.reason}</span>
        <button type="button" className="tool small" onClick={() => store.setSimulate(false)}>Turn Simulate off</button>
      </section>
    )
  if (o.status === 'failed')
    return (
      <section className="sim-status failed" role="alert">
        <strong>The simulation could not be solved.</strong>
        <span>{o.finding.message}</span>
        {o.lastGood && <span className="sim-stale-note">The readings shown are stale: they are from before your last edit.</span>}
        {o.finding.raw && (
          <details>
            <summary>What the simulator said</summary>
            <pre>{o.finding.raw}</pre>
          </details>
        )}
      </section>
    )
  return null
}
```

- [ ] **Step 6: Wire it into the editor**

In `src/editor/Editor.tsx`, import `useSimulation` and call it in `Editor` after `useUnloadGuard(store)`. In `useEditorKeys`, add these branches before the `key === 'r'` branch:

```ts
      } else if (key === 's' && !mod && !e.altKey) {
        if (gesture) return
        e.preventDefault()
        store.setSimulate(!s.simulate)
      } else if (key === 'p' && !mod && !e.altKey) {
        if (gesture) return
        e.preventDefault()
        store.setSimTool(s.simTool === 'probe' ? 'select' : 'probe')
```

and make Escape leave the Probe tool first: at the start of the `e.key === 'Escape'` branch, `if (s.simTool === 'probe') return store.setSimTool('select')`.

In `src/editor/Toolbar.tsx`, read `simulate`, `simTool` and `sim` from `useEditorState(store)`, import `SimStatus`, and after the Snap toggle's separator add:

```tsx
      <button
        type="button"
        className="tool toggle sim-toggle"
        aria-pressed={simulate}
        aria-keyshortcuts="S"
        data-sim-phase={simulate ? (sim?.phase ?? 'solving') : 'off'}
        title="Solve the sheet as a DC circuit in its current switch and GPIO state, and keep it solved as you edit (S)"
        onClick={() => store.setSimulate(!simulate)}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <path className="sim-wave" d="M1.5 9.5h3.2l2-5.5 3.1 10 2.2-6.5 1.3 2h3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Simulate
      </button>
      <button
        type="button"
        className="tool toggle"
        aria-pressed={simTool === 'probe'}
        aria-keyshortcuts="P"
        title="Place probes: click a pin, a breadboard hole, the end of a wire or a part (P)"
        onClick={() => store.setSimTool(simTool === 'probe' ? 'select' : 'probe')}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3 15l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="7" y="2.8" width="5" height="9" rx="1.6" transform="rotate(45 9.5 7.3)" fill="var(--paper)" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Probe
      </button>
      <span className="sep" aria-hidden="true" />
```

and render `<SimStatus store={store} />` right after the `kicadNotice` block.

In `src/editor/editor.css`:

```css
/* Simulate: the yellow wash of a pressed toggle, plus a green wave while results are live. */
.tool.sim-toggle[aria-pressed="true"] .sim-wave { stroke: var(--green); }
.tool.sim-toggle[data-sim-phase="loading"] .sim-wave, .tool.sim-toggle[data-sim-phase="solving"] .sim-wave { stroke: var(--muted); }
/* The simulation's status: a sticker-edged note under the toolbar, like the KiCad notice. */
.sim-status {
  flex-basis: 100%;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
  background: var(--bg); color: var(--text);
  border: 1.5px solid var(--card-edge); border-left: 6px solid var(--green); border-radius: 8px;
  padding: 8px 10px 8px 12px; font-size: 14px;
}
.sim-status strong { font: 600 16px/1.2 "Fredoka", system-ui, sans-serif; }
.sim-status.failed { border-left-color: var(--error); }
.sim-status progress { flex: 1 1 160px; max-width: 320px; height: 10px; accent-color: var(--green); }
.sim-status .sim-pct { font-variant-numeric: tabular-nums; color: var(--muted); }
.sim-status details { flex-basis: 100%; }
.sim-status pre { margin: 6px 0 0; max-height: 20vh; overflow: auto; font-size: 12px; white-space: pre-wrap; }
.sim-stale-note { color: var(--muted); }
```

- [ ] **Step 7: Run the tests, then check the bundle**

Run: `npx vitest run src/editor/simulation.test.ts src/editor/store.test.ts src/editor` then the Step 1 build command again.
Expected: tests PASS; the build prints a separate worker chunk (`browserWorker-*.js`) and the `index-*.js` gzip size is within 30 KB of the baseline. If it is not, find what the main bundle pulled in (`npx vite build --sourcemap` and inspect) before going on.

- [ ] **Step 8: Commit**

```bash
git add src/editor/simulation.ts src/editor/simulation.test.ts src/editor/SimStatus.tsx src/editor/store.ts src/editor/store.test.ts src/editor/Editor.tsx src/editor/Toolbar.tsx src/editor/editor.css
git commit -m "$(cat <<'MSG'
Editor: the Simulate toggle (S), the editor's solve session, load progress and the failure banner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 34: LED glow, finding badges and the "Simulation (current state)" group

**Files:**
- Create: `src/editor/SimLayer.tsx`, `src/editor/SimulationGroup.tsx`
- Modify: `src/editor/Canvas.tsx` (render the layer; a badge press selects its parts), `src/editor/Inspector.tsx` (`ProblemList` heading prop; the second group), `src/editor/editor.css`
- Test: `src/editor/simLayer.test.ts`

**Interfaces:**
- Consumes: `SimView` (Task 33), `SimResult`, `SimOutcome` (Task 26), `SIM_TITLES` (Task 27), `SeverityMark`, `bodyRect`, `layoutModule`, `formatValue`.
- Produces:
  - `function shownResult(o: SimOutcome | undefined): { result: SimResult; stale: boolean } | null`
  - `function glowLevel(amps: number, limit: number): number` (0 to 1, log scale, full at the limit; spec 6.3)
  - `const LED_GLOW: Record<string, string>`
  - `SimLayer` (props `{ diagram: Diagram; result: SimResult; stale: boolean; circuit: Circuit | null }`), `SimulationGroup` (props `{ store: EditorStore }`)
  - `ProblemList` gains `heading?: string`; `const WIRING_HEADING = 'Wiring checks (any switch position, external power assumed)'`

- [ ] **Step 1: Write the failing test**

`src/editor/simLayer.test.ts`:

```ts
// Spec 6.3: LED brightness follows current on a log scale with full brightness at its current
// limit; the shown result is the live one, or the last good one (stale) while a solve fails.
import { describe, expect, it } from 'vitest'
import { glowLevel, shownResult } from './SimLayer.tsx'
import type { SimResult } from '../sim/results.ts'

describe('glowLevel', () => {
  it('is dark at 0.1 mA and below, full at the limit, and log-scaled between', () => {
    expect(glowLevel(1e-4, 0.02)).toBe(0)
    expect(glowLevel(0.02, 0.02)).toBe(1)
    expect(glowLevel(0.05, 0.02)).toBe(1)
    expect(glowLevel(Math.sqrt(1e-4 * 0.02), 0.02)).toBeCloseTo(0.5, 9)
  })
})

describe('shownResult', () => {
  const r = { revision: 1 } as SimResult
  it('shows the live result, the last good one marked stale after a failure, and nothing otherwise', () => {
    expect(shownResult({ status: 'ok', result: r })).toEqual({ result: r, stale: false })
    expect(shownResult({ status: 'failed', revision: 2, finding: {} as never, lastGood: { revision: 1, result: r } })).toEqual({ result: r, stale: true })
    expect(shownResult({ status: 'failed', revision: 2, finding: {} as never })).toBeNull()
    expect(shownResult({ status: 'unavailable', reason: 'x' })).toBeNull()
    expect(shownResult(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/simLayer.test.ts`
Expected: FAIL, `./SimLayer.tsx` cannot be found.

- [ ] **Step 3: Write the layer**

`src/editor/SimLayer.tsx`:

```tsx
// What simulating draws on the sheet (spec 6.3): each LED's glow from its current (log scale, full
// at its current limit, in its colour), an LED over its absolute maximum drawn dark red with a
// warning ring, and the simulation's finding badges (the checker's SeverityMark, at the top right
// of a part; the checker lights its own at the top left). Static, so reduced motion needs nothing
// more, and every glow carries its current as text. Stale readings are dimmed.
import { memo } from 'react'
import { type Diagram, moduleOf } from '../format/diagram.ts'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { formatValue } from '../format/values.ts'
import type { Circuit } from '../sim/model.ts'
import { LIT_AMPS, type SimOutcome, type SimResult } from '../sim/results.ts'
import { SeverityMark } from './SeverityMark.tsx'

export const LED_GLOW: Record<string, string> = { red: '#FF3B30', green: '#34D158', yellow: '#FFD60A', orange: '#FF9F0A', blue: '#3A8DFF', white: '#FFFFFF' }

export function glowLevel(amps: number, limit: number): number {
  if (amps <= LIT_AMPS) return 0
  return Math.min(1, Math.log10(amps / LIT_AMPS) / Math.log10(limit / LIT_AMPS))
}

export function shownResult(o: SimOutcome | undefined): { result: SimResult; stale: boolean } | null {
  if (!o) return null
  if (o.status === 'ok') return { result: o.result, stale: false }
  if (o.status === 'failed' && o.lastGood) return { result: o.lastGood.result, stale: true }
  return null
}

export const SimLayer = memo(function SimLayer({ diagram, result, stale, circuit }: { diagram: Diagram; result: SimResult; stale: boolean; circuit: Circuit | null }) {
  const run = result.corners.typical
  const leds = diagram.parts.flatMap((p) => {
    const r = run.parts[p.uid]
    const m = moduleOf(diagram, p.module)
    if (!r?.state || !m) return []
    const anode = Object.values(r.pins).find((x) => x.kind === 'value' && x.value > 0)
    const amps = anode?.kind === 'value' ? anode.value : 0
    const limit = circuit?.limits.find((l) => l.part === p.uid && l.kind === 'current')?.value.value ?? 0.02
    const colour = typeof p.values?.color === 'string' ? p.values.color.toLowerCase() : 'red'
    const over = result.findings.some((f) => f.code === 'sim-over-abs-max' && f.parts.includes(p.uid))
    return [{ p, box: bodyRect(p, layoutModule(m)), amps, level: glowLevel(amps, limit), colour: Object.hasOwn(LED_GLOW, colour) ? colour : 'red', over }]
  })
  const byPart = new Map<string, { severity: 'error' | 'warning'; messages: string[]; parts: string[] }>()
  for (const f of result.findings) {
    if (f.severity === 'note' || !f.parts.length) continue
    const at = byPart.get(f.parts[0]) ?? { severity: f.severity, messages: [], parts: f.parts }
    if (f.severity === 'error') at.severity = 'error'
    at.messages.push(f.message)
    byPart.set(f.parts[0], at)
  }
  return (
    <g className={`sim-layer${stale ? ' stale' : ''}`} data-sim-stale={stale || undefined}>
      <defs>
        {Object.entries(LED_GLOW).map(([name, c]) => (
          <radialGradient key={name} id={`sim-glow-${name}`}>
            <stop offset="0" stopColor={c} stopOpacity={0.95} />
            <stop offset="0.45" stopColor={c} stopOpacity={0.55} />
            <stop offset="1" stopColor={c} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      <g pointerEvents="none">
        {leds.map(({ p, box, amps, level, colour, over }) => {
          const cx = box.x + box.w / 2
          const cy = box.y + box.h / 2
          const r = Math.max(box.w, box.h) / 2
          return (
            <g key={p.uid} data-sim-led={p.uid} data-sim-level={level.toFixed(2)}>
              <title>{`${p.designator}: ${formatValue(Number(amps.toPrecision(3)), 'A')}${over ? ', over its absolute maximum' : ''}`}</title>
              {over ? (
                <>
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} fill="#5A1010" opacity={0.85} />
                  <rect className="sim-ring" x={box.x - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={8} />
                </>
              ) : (
                level > 0 && <circle cx={cx} cy={cy} r={r * (1.2 + 1.3 * level)} fill={`url(#sim-glow-${colour})`} opacity={0.3 + 0.7 * level} />
              )}
            </g>
          )
        })}
      </g>
      {[...byPart].map(([uid, b]) => {
        const p = diagram.parts.find((x) => x.uid === uid)
        const m = p && moduleOf(diagram, p.module)
        if (!p || !m) return null
        const box = bodyRect(p, layoutModule(m))
        return (
          <g key={uid} className="sim-badge" data-sim-badge={b.parts.join(' ')} role="button" aria-label={`Simulation: ${b.messages.join(' ')}`}>
            <title>{b.messages.join('\n')}</title>
            <SeverityMark severity={b.severity} at={{ x: box.x + box.w - 2, y: box.y - 16, size: 18 }} />
          </g>
        )
      })}
    </g>
  )
})
```

`src/editor/SimulationGroup.tsx`:

```tsx
// The "Simulation (current state)" group (spec 2.1, 6.3): the simulation's findings, in their own
// group after the checker's, each with Select; notes below; dimmed and marked while stale.
import { SIM_TITLES } from '../sim/findings.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { shownResult } from './SimLayer.tsx'
import { type EditorStore, useEditorState } from './store.ts'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function SimulationGroup({ store }: { store: EditorStore }) {
  const { sim } = useEditorState(store)
  const shown = shownResult(sim?.phase === 'done' ? sim.outcome : undefined)
  const status = !sim || sim.phase !== 'done' ? 'Solving the current state.' : !shown ? 'No result: see the message under the toolbar.' : null
  const findings = shown?.result.findings ?? []
  const problems = findings.filter((f) => f.severity !== 'note')
  const notes = findings.filter((f) => f.severity === 'note')
  const errors = problems.filter((f) => f.severity === 'error').length
  const row = (f: (typeof findings)[number], i: number) => (
    <li key={`${f.code}-${i}`} className={f.severity === 'note' ? 'info' : f.severity}>
      <SeverityMark severity={f.severity === 'note' ? 'info' : f.severity} />
      <div className="problem-text">
        <span className="problem-title">
          <span className="sr-only">{f.severity === 'error' ? 'Error: ' : f.severity === 'warning' ? 'Warning: ' : 'Note: '}</span>
          {SIM_TITLES[f.code]}
        </span>
        <span className="problem-message" id={`sim-message-${i}`}>{f.message}</span>
      </div>
      {f.parts.length > 0 && (
        <div className="problem-actions">
          <button type="button" className="tool small" aria-describedby={`sim-message-${i}`} onClick={() => { store.select({ parts: f.parts, wires: [] }); store.reveal() }}>Select</button>
        </div>
      )}
    </li>
  )
  return (
    <section className={`problems sim-group${errors ? ' has-errors' : problems.length ? ' has-warnings' : ' clean'}${shown?.stale ? ' stale' : ''}`} aria-labelledby="sim-title">
      <h3 id="sim-title" tabIndex={-1}>
        {!status && !problems.length && <SeverityMark severity="ok" />}
        Simulation (current state)
        {problems.length > 0 && <span className="problems-count">{[errors && plural(errors, 'error'), problems.length - errors && plural(problems.length - errors, 'warning')].filter(Boolean).join(', ')}</span>}
      </h3>
      {status && <p className="hint">{status}</p>}
      {shown?.stale && <p className="hint">Stale: these are from before your last edit.</p>}
      {shown && !problems.length && <p className="hint">Nothing to report in the saved switch and GPIO state.</p>}
      {problems.length > 0 && <ul>{problems.map(row)}</ul>}
      {notes.length > 0 && (
        <div className="problem-notes" role="group" aria-label="Simulation notes">
          <ul>{notes.map((f, i) => row(f, problems.length + i))}</ul>
        </div>
      )}
    </section>
  )
}
```

In `src/editor/Inspector.tsx`: export `const WIRING_HEADING = 'Wiring checks (any switch position, external power assumed)'`; give `ProblemList` an optional `heading?: string` prop and use it in each of its three `<h3 id="problems-title">` headings: `{heading ?? 'Problems'}` in the failed and problems forms, and in the clean form `{heading ?? 'No problems found in the drawn connections.'}` followed by `{heading && <p className="hint">No problems found in the drawn connections.</p>}`. In the sheet view (`count === 0`), read `simulate` from `useEditorState(store)` and render:

```tsx
        <ProblemList store={store} findings={findings} onUpdateParts={updateParts} heading={simulate ? WIRING_HEADING : undefined} />
        {simulate && <SimulationGroup store={store} />}
```

In `src/editor/Canvas.tsx`: read `simulate` and `sim` from `useEditorState(store)`; compute `const shown = simulate && sim?.phase === 'done' ? shownResult(sim.outcome) : null`; render `{shown && <SimLayer diagram={diagram} result={shown.result} stale={shown.stale} circuit={sim?.phase === 'done' ? sim.circuit : null} />}` after the wire name-tag layer and before the broken-wire stubs. In `onPointerDown`, right after the `if (e.button !== 0) return` line:

```ts
    // A simulation badge selects the parts its findings name (spec 6.3).
    const badge = target.closest('[data-sim-badge]')
    if (badge) {
      store.select({ parts: badge.getAttribute('data-sim-badge')!.split(' '), wires: [] })
      store.reveal()
      return
    }
```

In `src/editor/editor.css`:

```css
/* Simulating: an LED over its absolute maximum gets a dashed warning ring; stale readings dim. */
.sim-ring { fill: none; stroke: #E0483E; stroke-width: 2.5; stroke-dasharray: 5 3; }
.sim-layer.stale { opacity: 0.45; }
.sim-badge { cursor: pointer; }
.problems.sim-group.stale { opacity: 0.6; }
```

- [ ] **Step 4: Run the tests and the editor suite**

Run: `npx vitest run src/editor/simLayer.test.ts src/editor`
Expected: PASS. The problems tests are unchanged (the heading prop defaults to the old text).

- [ ] **Step 5: Commit**

```bash
git add src/editor/SimLayer.tsx src/editor/SimulationGroup.tsx src/editor/simLayer.test.ts src/editor/Canvas.tsx src/editor/Inspector.tsx src/editor/editor.css
git commit -m "$(cat <<'MSG'
Editor: LED glow on a log scale, over-maximum rings, simulation badges, and the Simulation (current state) group

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 35: Switches, buttons and GPIO states while simulating

**Files:**
- Modify: `src/editor/ops.ts` (three ops), `src/editor/Canvas.tsx` (clicks), `src/editor/Inspector.tsx` (a Simulation section on a part)
- Test: `src/editor/simOps.test.ts`

**Interfaces:**
- Consumes: `switchGroups`, `contactPosition`, `isActive`, `gpioState`, `gpioProblem`, `GPIO_CYCLE`, `GPIO_STATES` (Task 8); `simOf` (Task 6); `pinCaps`.
- Produces:
  - `function setSimValue(d: Diagram, uid: string, key: string, value: string | undefined): Diagram` (sets or clears one `values` key)
  - `function flipContact(d: Diagram, uid: string): Diagram | null` (the part's first latching group: open and closed, or nc and no)
  - `function momentaryGroup(d: Diagram, uid: string): string | null`
  - `function cycleGpio(d: Diagram, uid: string, pin: string): Diagram | null` (input, high, low, input, skipping states the pin's caps forbid)

- [ ] **Step 1: Write the failing test**

`src/editor/simOps.test.ts`:

```ts
// Spec 4.0, 4.6 and 6.3: clicking a switch while simulating flips and saves it; a button is
// momentary (found, never saved); clicking a GPIO pin cycles input, high, low, skipping what its
// caps forbid.
import { describe, expect, it } from 'vitest'
import { cycleGpio, flipContact, momentaryGroup, setSimValue } from './ops.ts'
import { boardModule, sheet } from '../sim/testing.ts'

describe('simulation state ops', () => {
  it('flips a latching switch between open and closed, saving contact.<group>', () => {
    const d = sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], [])
    const on = flipContact(d, 's1')!
    expect(on.parts[0].values).toEqual({ 'contact.s': 'closed' })
    expect(flipContact(on, 's1')!.parts[0].values).toEqual({ 'contact.s': 'open' })
    expect(flipContact(sheet([{ uid: 'b1', module: 'push-button' }], []), 'b1')).toBeNull()
    expect(flipContact(sheet([{ uid: 'k1', module: 'relay-module-1ch-5v' }], []), 'k1')).toBeNull()
  })
  it('finds a momentary group to hold', () => {
    expect(momentaryGroup(sheet([{ uid: 'b1', module: 'push-button' }], []), 'b1')).toBe('s')
    expect(momentaryGroup(sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], []), 's1')).toBeNull()
  })
  it('cycles a GPIO input, high, low and back, and leaves a non-GPIO pin alone', () => {
    let d = sheet([{ uid: 'u1', module: boardModule() }], [])
    const seen: unknown[] = []
    for (let i = 0; i < 3; i++) {
      d = cycleGpio(d, 'u1', 'IO1')!
      seen.push(d.parts[0].values?.['gpio.IO1'])
    }
    expect(seen).toEqual(['high', 'low', 'input'])
    expect(cycleGpio(d, 'u1', 'VIN')).toBeNull()
  })
  it('sets and clears one value', () => {
    const d = sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], [])
    expect(setSimValue(setSimValue(d, 's1', 'contact.s', 'closed'), 's1', 'contact.s', undefined).parts[0].values).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/simOps.test.ts`
Expected: FAIL: the ops are not exported.

- [ ] **Step 3: Write the ops**

Append to `src/editor/ops.ts` (import `switchGroups`, `contactPosition`, `isActive`, `gpioState`, `gpioProblem`, `GPIO_CYCLE` from `../format/simState.ts` and `pinCaps` from `../format/module.ts`):

```ts
/** Sets one `values` key of a part (a switch position, a GPIO state), or removes it with undefined. Same diagram when nothing changes. */
export function setSimValue(d: Diagram, uid: string, key: string, value: string | undefined): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part || part.values?.[key] === value) return d
  const { [key]: _old, ...rest } = part.values ?? {}
  const values = value === undefined ? rest : { ...rest, [key]: value }
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { values: _v, ...q } = p
      return Object.keys(values).length ? { ...q, values } : q
    }),
  }
}

/** Spec 6.3: a click on a latching switch while simulating flips its first switch group and saves it; null for a button, a relay or a part with no switch. */
export function flipContact(d: Diagram, uid: string): Diagram | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  const g = m ? switchGroups(m).find((x) => x.kind === 'switch' && !x.momentary) : undefined
  if (!part || !m || !g) return null
  const active = isActive(contactPosition(part, m, g))
  return setSimValue(d, uid, `contact.${g.id}`, g.changeover ? (active ? 'nc' : 'no') : active ? 'open' : 'closed')
}

/** The momentary group a press holds closed (spec 4.0: never saved), or null. */
export function momentaryGroup(d: Diagram, uid: string): string | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  return (m && switchGroups(m).find((x) => x.momentary)?.id) ?? null
}

/** Spec 6.3: a click on a GPIO pin cycles input, high, low, skipping states its caps forbid; null for a pin that is not GPIO-capable. */
export function cycleGpio(d: Diagram, uid: string, pin: string): Diagram | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || !simOf(m)?.gpio?.pins.includes(pin)) return null
  const now = gpioState(part, m, pin)
  const allowed = GPIO_CYCLE.filter((s) => gpioProblem(pinCaps(m, pin), s) === null)
  if (!allowed.length) return null
  const next = allowed[(allowed.indexOf(now ?? allowed[allowed.length - 1]) + 1) % allowed.length]
  return setSimValue(d, uid, `gpio.${pin}`, next)
}
```

(`simOf` from `../format/simModel.ts`.)

- [ ] **Step 4: Wire the clicks into the canvas**

In `src/editor/Canvas.tsx` add `const heldRef = useRef(false)` and:

1. In `onPointerDown`'s part branch, after the selection is set and before the drag starts: hold a button while simulating.

```ts
      if (store.getState().simulate && !e.shiftKey) {
        const group = momentaryGroup(store.getState().diagram, uid)
        if (group) {
          heldRef.current = true
          store.setHeld({ part: uid, group })
        }
      }
```

2. At the top of `onPointerUp` and `onPointerCancel` (before the `if (!drag ...)` guard):

```ts
    if (heldRef.current) {
      heldRef.current = false
      store.setHeld(null)
    }
```

3. Give `finishPartsDrag` a `click` flag. In `onPointerUp` call `finishPartsDrag(drag, true)`; in `onPointerCancel` `finishPartsDrag(drag, false)`. In it:

```ts
  function finishPartsDrag(d: Extract<Drag, { kind: 'parts' }>, click: boolean) {
    // A press without movement changes nothing, mounts included (settleDrop returns `now` then).
    const moved = store.getState().diagram !== d.base
    if (store.dragging) store.preview(settleDrop(d.base, store.getState().diagram, d.settling))
    store.end()
    // Spec 6.3: a click on a switch while simulating flips it and saves the new position.
    if (click && !moved && store.getState().simulate && d.uids.length === 1) {
      const next = flipContact(store.getState().diagram, d.uids[0])
      if (next) store.commit(next)
    }
  }
```

4. In `onPointerUp`'s `drag.kind === 'wire'` branch, after the `if (added) { ... }` block:

```ts
      // Spec 6.3: a click on a GPIO pin while simulating cycles its state.
      else if (to && s.simulate && sameEndpoint(s.diagram, to, drag.from)) {
        const next = cycleGpio(s.diagram, drag.from.part, drag.from.pin)
        if (next) store.commit(next)
      }
```

- [ ] **Step 5: The Inspector's Simulation section on a part**

In `src/editor/Inspector.tsx`'s part view (`if (part) { ... }`), after the settings selects, add (with imports `switchGroups`, `contactPosition`, `gpioState`, `gpioProblem`, `GPIO_STATES` from `../format/simState.ts`, `simOf` from `../format/simModel.ts`, `pinCaps` from `../format/module.ts`, `setSimValue` from `./ops.ts`):

```tsx
        {m && (switchGroups(m).some((g) => g.kind === 'switch' && !g.momentary) || simOf(m)?.gpio) && (
          <section className="sim-part" aria-labelledby="sim-part-title">
            <h3 id="sim-part-title">Simulation state</h3>
            <p className="hint">Saved with the sheet: what the simulation solves. While simulating, click the switch or a GPIO pin on the sheet to change it.</p>
            {switchGroups(m).filter((g) => g.kind === 'switch' && !g.momentary).map((g) => (
              <label key={g.id} className="field" htmlFor={`sim-contact-${g.id}`}>
                {switchGroups(m).length > 1 ? `Position (${g.id})` : 'Position'}
                <select id={`sim-contact-${g.id}`} value={contactPosition(part, m, g)} onChange={(e) => store.commit(setSimValue(diagram, part.uid, `contact.${g.id}`, e.target.value))}>
                  {(g.changeover ? [['nc', 'Rest (NC closed)'], ['no', 'Switched (NO closed)']] : [['open', 'Off (open)'], ['closed', 'On (closed)']]).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
            ))}
            {simOf(m)?.gpio && (
              <details className="sim-gpio">
                <summary>GPIO states ({simOf(m)!.gpio!.pins.filter((pin) => part.values?.[`gpio.${pin}`] !== undefined).length} set)</summary>
                <div className="sim-gpio-grid">
                  {simOf(m)!.gpio!.pins.map((pin) => (
                    <label key={pin} className="field" htmlFor={`sim-gpio-${pin}`}>
                      {pin}
                      <select id={`sim-gpio-${pin}`} value={gpioState(part, m, pin) ?? ''} onChange={(e) => store.commit(setSimValue(diagram, part.uid, `gpio.${pin}`, e.target.value || undefined))}>
                        {gpioState(part, m, pin) === null && <option value="">not set (open)</option>}
                        {GPIO_STATES.filter((s) => gpioProblem(pinCaps(m, pin), s) === null).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}
```

and in `src/editor/editor.css`:

```css
.sim-part { display: grid; gap: 8px; border-top: 1.5px solid var(--rule); padding-top: 10px; }
.sim-part h3 { margin: 0; font: 600 16px/1.2 "Fredoka", system-ui, sans-serif; }
.sim-gpio summary { cursor: pointer; font-weight: 700; font-size: 14px; }
.sim-gpio-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 8px; margin-top: 8px; }
.sim-gpio-grid select { font-size: 13px; }
```

- [ ] **Step 6: Run the tests and the editor suite**

Run: `npx vitest run src/editor/simOps.test.ts src/editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/editor/ops.ts src/editor/simOps.test.ts src/editor/Canvas.tsx src/editor/Inspector.tsx src/editor/editor.css
git commit -m "$(cat <<'MSG'
Editor: flip switches and hold buttons while simulating, cycle GPIO states, and set them in the inspector

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 36: The Probe tool and probe tags

**Files:**
- Create: `src/editor/ProbeLayer.tsx`
- Modify: `src/editor/Canvas.tsx` (placing probes; drawing the layer), `src/editor/editor.css`
- Test: `src/editor/probeLayer.test.ts`

**Interfaces:**
- Consumes: `addProbe` (Task 25), `probeReadings`, `Reading`, `PartRun`, `ProbeReading` (Task 26), `LabelPlacer` (`src/agent/labelling.ts`, ruling R8), `flagRect` (`netLabels.ts`), `resolveEndpoint`, `worldPins`, `bodyRect`, `modulesById`.
- Produces:
  - `const PROBE_COLORS: readonly string[]` (eight, in a fixed order, each at least 3:1 against both papers: `#F7F8F3` light and `#DDDFE0` dark)
  - `function readingText(r: { typical: Reading; peak: Reading } | undefined): string`, `function partText(p: { typical: PartRun; peak: PartRun } | undefined): string`
  - `function placeTags(d: Diagram, items: { id: string; text: string }[]): { id: string; from: Pt; elbow: Pt; tip: Pt; box: Rect }[]`
  - `ProbeLayer` (props `{ diagram: Diagram; readings: ProbeReading[] | null }`)

- [ ] **Step 1: Write the failing test**

`src/editor/probeLayer.test.ts`:

```ts
// Spec 6.2: probe tags show typical with peak when it differs ("4.38 V (peak 4.21 V)"), say
// "floating", "undefined" or "-" (Simulate off) as words, mark readings outside the model, and
// use eight colours with 3:1 contrast on the sheet paper in both themes. Tags keep off parts.
import { describe, expect, it } from 'vitest'
import { PROBE_COLORS, partText, placeTags, readingText } from './ProbeLayer.tsx'
import { bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { sheet } from '../sim/testing.ts'

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
const v = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, reference: 'GND', trust })

describe('probe tags', () => {
  it('reads typical, with peak when it differs, and says the states in words', () => {
    expect(readingText({ typical: v(4.38), peak: v(4.21) })).toBe('4.38 V (peak 4.21 V)')
    expect(readingText({ typical: v(3.3), peak: v(3.3) })).toBe('3.3 V')
    expect(readingText({ typical: { kind: 'floating' }, peak: { kind: 'floating' } })).toBe('floating')
    expect(readingText({ typical: { kind: 'undefined', why: 'mains' }, peak: { kind: 'undefined', why: 'mains' } })).toBe('undefined')
    expect(readingText(undefined)).toBe('-')
    expect(readingText({ typical: v(2.1, 'outside-model'), peak: v(2.1, 'outside-model') })).toBe('2.1 V (outside the model)')
  })
  it('reads a part probe as its largest pin current and its power', () => {
    const run = { pins: { A: { kind: 'value' as const, value: 0.0123, trust: 'ok' as const }, K: { kind: 'value' as const, value: -0.0123, trust: 'ok' as const } }, power: v(0.0251) }
    expect(partText({ typical: run, peak: run })).toBe('12.3 mA, 25.1 mW')
  })
  it('uses eight colours with at least 3:1 contrast on both papers', () => {
    expect(PROBE_COLORS).toHaveLength(8)
    for (const c of PROBE_COLORS) {
      expect(contrast(c, '#F7F8F3'), c).toBeGreaterThanOrEqual(3)
      expect(contrast(c, '#DDDFE0'), c).toBeGreaterThanOrEqual(3)
    }
  })
  it('places tags clear of part bodies and of each other', () => {
    const d = sheet([{ uid: 'r1', module: 'resistor' }, { uid: 'r2', module: 'resistor' }], [])
    const tags = placeTags({ ...d, probes: [{ id: 'P1', at: { part: 'r1', pin: '1' } }, { id: 'P2', at: { part: 'r1', pin: '2' } }, { id: 'P3', at: { part: 'r2' } }] }, [{ id: 'P1', text: 'P1 3.3 V' }, { id: 'P2', text: 'P2 1.2 V' }, { id: 'P3', text: 'P3 4 mA, 2 mW' }])
    expect(tags).toHaveLength(3)
    const bodies = d.parts.map((p) => bodyRect(p, layoutModule(d.modules[p.module])))
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const t of tags) for (const b of bodies) expect(hit(t.box, b)).toBe(false)
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) expect(hit(tags[i].box, tags[j].box)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/probeLayer.test.ts`
Expected: FAIL, `./ProbeLayer.tsx` cannot be found.

- [ ] **Step 3: Write the layer**

`src/editor/ProbeLayer.tsx`:

```tsx
// Probes on the sheet (spec 6.2): each probe is a coloured lead from its pin (or part) to a reading
// tag. Tags are placed by the existing label placement (ruling R8: LabelPlacer with the net-label
// module, the tag text as the flag name), so they keep off parts, captions and each other. A tag
// shows typical, with peak when it differs; "floating", "undefined" or "-" (Simulate off) in words;
// a reading outside the model says so. Colours come from a fixed order of eight, each at least 3:1
// on the sheet paper in both themes (the paper is light in both).
import { memo } from 'react'
import { type Diagram, type Probe, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { flagRect, flagText } from '../format/netLabels.ts'
import { formatValue } from '../format/values.ts'
import { LabelPlacer } from '../agent/labelling.ts'
import { modulesById } from '../library.ts'
import type { PartRun, ProbeReading, Reading } from '../sim/results.ts'

export const PROBE_COLORS = ['#C2185B', '#1565C0', '#2E7D32', '#6A1B9A', '#B34700', '#00695C', '#5D4037', '#283593'] as const
const sig = (x: number) => Number(x.toPrecision(3))

function one(r: Reading): string {
  return r.kind === 'value' ? formatValue(sig(r.value), 'V') : r.kind
}
export function readingText(r: { typical: Reading; peak: Reading } | undefined): string {
  if (!r) return '-'
  const t = one(r.typical)
  const p = one(r.peak)
  const outside = (r.typical.kind === 'value' && r.typical.trust === 'outside-model') || (r.peak.kind === 'value' && r.peak.trust === 'outside-model')
  return `${t}${p !== t ? ` (peak ${p})` : ''}${outside ? ' (outside the model)' : ''}`
}
export function partText(p: { typical: PartRun; peak: PartRun } | undefined): string {
  if (!p) return '-'
  const amps = Math.max(0, ...Object.values(p.typical.pins).map((x) => (x.kind === 'value' ? Math.abs(x.value) : 0)))
  const power = p.typical.power.kind === 'value' ? `, ${formatValue(sig(Math.abs(p.typical.power.value)), 'W')}` : ''
  return Object.keys(p.typical.pins).length ? `${formatValue(sig(amps), 'A')}${power}` : p.typical.power.kind === 'undefined' ? 'undefined' : 'floating'
}

const DIRS: Pt[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]

/** Where each probe's tag goes: LabelPlacer spots, taken one by one so later tags keep off earlier ones. */
export function placeTags(d: Diagram, items: { id: string; text: string }[]): { id: string; from: Pt; elbow: Pt; tip: Pt; box: Rect }[] {
  const label = moduleOf(d, 'net-label') ?? modulesById['net-label']
  if (!label) return []
  const placer = new LabelPlacer(d, label)
  const out: { id: string; from: Pt; elbow: Pt; tip: Pt; box: Rect }[] = []
  for (const it of items) {
    const p = (d.probes ?? []).find((x) => x.id === it.id)
    if (!p) continue
    const anchor = anchorOf(d, p)
    if (!anchor) continue
    let placed = false
    for (const dir of anchor.dir ? [anchor.dir, ...DIRS] : DIRS) {
      const spot = placer.spot(it.text, anchor.at, dir)
      if (!spot) continue
      placer.commit(spot, anchor.at)
      out.push({ id: it.id, from: anchor.at, elbow: spot.elbow, tip: spot.tip, box: flagRect(spot.part, label, true) })
      placed = true
      break
    }
    // No clear spot on a crowded sheet: the tag still shows, just above and right of its point.
    if (!placed) {
      const box = { x: anchor.at.x + 10, y: anchor.at.y - 24, w: 5.4 * flagText(it.text).length + 12, h: 10 }
      out.push({ id: it.id, from: anchor.at, elbow: { x: box.x, y: box.y + 5 }, tip: { x: box.x, y: box.y + 5 }, box })
    }
  }
  return out
}

function anchorOf(d: Diagram, p: Probe): { at: Pt; dir: Pt | null } | null {
  if (p.at.pin !== undefined) {
    const r = resolveEndpoint(d, { part: p.at.part, pin: p.at.pin })
    return r ? { at: r.end, dir: r.dir } : null
  }
  const part = d.parts.find((x) => x.uid === p.at.part)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return null
  const b = bodyRect(part, layoutModule(m))
  return { at: { x: b.x + b.w / 2, y: b.y }, dir: { x: 0, y: -1 } }
}

export const ProbeLayer = memo(function ProbeLayer({ diagram, readings }: { diagram: Diagram; readings: ProbeReading[] | null }) {
  const probes = diagram.probes ?? []
  const texts = probes.map((p) => {
    const r = readings?.find((x) => x.id === p.id)
    return { id: p.id, text: `${p.name ?? p.id} ${p.at.pin === undefined ? partText(r?.part) : readingText(r?.voltage)}` }
  })
  const tags = placeTags(diagram, texts)
  return (
    <g className="probe-layer" pointerEvents="none">
      {tags.map((t) => {
        const i = probes.findIndex((p) => p.id === t.id)
        const colour = PROBE_COLORS[i % PROBE_COLORS.length]
        const text = texts.find((x) => x.id === t.id)!.text
        return (
          <g key={t.id} data-probe={t.id}>
            <title>{text}</title>
            <polyline points={`${t.from.x},${t.from.y} ${t.elbow.x},${t.elbow.y} ${t.tip.x},${t.tip.y}`} fill="none" stroke={colour} strokeWidth={1.6} strokeDasharray="3 2" />
            <circle cx={t.from.x} cy={t.from.y} r={2.6} fill={colour} />
            <rect x={t.box.x} y={t.box.y} width={t.box.w} height={t.box.h} rx={3} fill="#FFFFFF" stroke={colour} strokeWidth={1.4} />
            <rect x={t.box.x} y={t.box.y} width={4} height={t.box.h} rx={1.5} fill={colour} />
            <text x={t.box.x + 7} y={t.box.y + t.box.h / 2 + 3} className="probe-text">{flagText(text)}</text>
          </g>
        )
      })}
    </g>
  )
})
```

A tag's box is the flag a net label of that text would take, so the tag draws `flagText(text)` (at most 24 characters, as a flag does) and keeps the full text in its `<title>`. Add to `src/editor/editor.css`:

```css
.probe-text { font: 700 7.5px "Atkinson Hyperlegible", system-ui, sans-serif; fill: #23282F; }
```

- [ ] **Step 4: Place probes and draw the layer**

In `src/editor/Canvas.tsx`, import `addProbe` from `../sim/probes.ts`, `probeReadings` from `../sim/results.ts` and `ProbeLayer`. In `onPointerDown`, right after the badge branch:

```ts
    // The Probe tool (spec 6.2): a pin or hole, the nearer end of a wire, or a part.
    if (store.getState().simTool === 'probe') {
      const d0 = store.getState().diagram
      const end = endUnder(e, NO_HOLES)
      let at: { part: string; pin?: string } | null = end ? { part: end.part, pin: end.pin } : null
      const wireEl = at ? null : target.closest('[data-wire]')
      const conn = wireEl ? d0.connections.find((c) => c.uid === wireEl.getAttribute('data-wire')) : undefined
      if (conn) {
        const p = toWorld(e)
        const dist = (ep: Endpoint) => {
          const r = resolveEndpoint(d0, ep)
          return r ? Math.hypot(r.end.x - p.x, r.end.y - p.y) : Infinity
        }
        const ep = dist(conn.from) <= dist(conn.to) ? conn.from : conn.to
        at = { part: ep.part, pin: ep.pin }
      }
      const partEl = at ? null : target.closest('[data-part]')
      if (partEl) at = { part: partEl.getAttribute('data-part')! }
      if (at) store.commit(addProbe(d0, at).diagram)
      return
    }
```

and render the probes above everything but the highlight (after the `SimLayer`):

```tsx
        {(diagram.probes?.length ?? 0) > 0 && (
          <ProbeLayer diagram={diagram} readings={shown && sim?.phase === 'done' && sim.circuit ? probeReadings(diagram.probes!, sim.circuit, shown.result.corners) : null} />
        )}
```

With Simulate off (`shown` null) every tag reads "-".

Give the canvas a crosshair while the Probe tool is on: add `simTool === 'probe' ? ' probing' : ''` to the svg's class name, and in `editor.css`: `.canvas.probing { cursor: crosshair; }`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/editor/probeLayer.test.ts src/editor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/editor/ProbeLayer.tsx src/editor/probeLayer.test.ts src/editor/Canvas.tsx src/editor/editor.css
git commit -m "$(cat <<'MSG'
Editor: the Probe tool (P) and probe tags placed clear of parts, in eight contrast-checked colours

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 37: The Probes panel (readings, Supplies, notes, About the simulator)

**Files:**
- Create: `src/editor/ProbesPanel.tsx`
- Modify: `src/editor/Editor.tsx` (the panel replaces the inspector while the Probe tool is on), `src/editor/Inspector.tsx` (export `CommitInput`), `src/editor/editor.css`
- Test: `src/editor/probesPanel.test.ts`

**Interfaces:**
- Consumes: `renameProbe`, `removeProbe` (Task 25), `probeReadings`, `DomainBudget` (Task 26), `readingText`, `partText`, `PROBE_COLORS` (Task 36), `shownResult` (Task 34), `formatValue`.
- Produces: `ProbesPanel` (props `{ store: EditorStore }`); `function supplyRow(b: DomainBudget): { name: string; volts: string; load: string; limit: string; headroom: string; basis: string }`.

- [ ] **Step 1: Write the failing test**

`src/editor/probesPanel.test.ts`:

```ts
// Spec 6.2: the Supplies table: each source, rail and domain with load against limit, typical and
// peak, headroom and provenance; a reading outside the model is shown as such, not as a number.
import { describe, expect, it } from 'vitest'
import { supplyRow } from './ProbesPanel.tsx'
import type { DomainBudget } from '../sim/results.ts'

const v = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, reference: 'GND', trust })
const a = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, trust })

describe('supplyRow', () => {
  it('formats a rail with its limit, headroom and basis', () => {
    const b: DomainBudget = { id: 'u1.rail.ldo', kind: 'rail', part: 'u1', label: 'U1 3V3 regulator', volts: { typical: v(3.29), peak: v(3.27) }, amps: { typical: a(0.12), peak: a(0.34) }, limit: { value: 0.8, kind: 'ioutMax', basis: 'datasheet' }, headroom: 0.46, basis: 'datasheet' }
    expect(supplyRow(b)).toEqual({ name: 'U1 3V3 regulator', volts: '3.29 V (peak 3.27 V)', load: '120 mA (peak 340 mA)', limit: '800 mA', headroom: '460 mA', basis: 'datasheet' })
  })
  it('says a reading outside the model is untrustworthy instead of giving a number', () => {
    const b: DomainBudget = { id: 'bt1.cell', kind: 'source', part: 'bt1', label: 'BT1', volts: { typical: v(3.1, 'outside-model'), peak: v(3.0, 'outside-model') }, amps: { typical: a(2.1, 'outside-model'), peak: a(2.4, 'outside-model') }, basis: 'estimate' }
    expect(supplyRow(b)).toMatchObject({ load: 'outside the model', limit: '-', headroom: '-', basis: 'estimate' })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/probesPanel.test.ts`
Expected: FAIL, `./ProbesPanel.tsx` cannot be found.

- [ ] **Step 3: Write the panel**

`src/editor/ProbesPanel.tsx`:

```tsx
// The Probes panel (spec 6.2): in place of the inspector while the Probe tool is on. The readings
// (rename and delete), the Supplies table (each source, rail and domain: load against limit,
// typical and peak, headroom and provenance), the parts not simulated and the estimates, and About
// the simulator (ruling R9: the licences and where the engine's source is).
import { formatValue } from '../format/values.ts'
import { removeProbe, renameProbe } from '../sim/probes.ts'
import { type CurrentReading, type DomainBudget, probeReadings } from '../sim/results.ts'
import { CommitInput } from './Inspector.tsx'
import { PROBE_COLORS, partText, readingText } from './ProbeLayer.tsx'
import { shownResult } from './SimLayer.tsx'
import { type EditorStore, useEditorState } from './store.ts'

const sig = (x: number) => Number(x.toPrecision(3))
const ampsText = (r: { typical: CurrentReading; peak: CurrentReading }) => {
  if ((r.typical.kind === 'value' && r.typical.trust === 'outside-model') || (r.peak.kind === 'value' && r.peak.trust === 'outside-model')) return 'outside the model'
  const one = (x: CurrentReading) => (x.kind === 'value' ? formatValue(sig(Math.abs(x.value)), 'A') : 'floating')
  const [t, p] = [one(r.typical), one(r.peak)]
  return t === p ? t : `${t} (peak ${p})`
}

export function supplyRow(b: DomainBudget): { name: string; volts: string; load: string; limit: string; headroom: string; basis: string } {
  const load = ampsText(b.amps)
  const outside = load === 'outside the model'
  return {
    name: b.label,
    volts: outside ? 'outside the model' : readingText(b.volts),
    load,
    limit: b.limit && !outside ? formatValue(sig(b.limit.value), 'A') : '-',
    headroom: b.headroom !== undefined && !outside ? formatValue(sig(b.headroom), 'A') : '-',
    basis: b.basis,
  }
}

export function ProbesPanel({ store }: { store: EditorStore }) {
  const { diagram, sim, simulate } = useEditorState(store)
  const shown = simulate && sim?.phase === 'done' ? shownResult(sim.outcome) : null
  const circuit = sim?.phase === 'done' ? sim.circuit : null
  const probes = diagram.probes ?? []
  const readings = shown && circuit ? probeReadings(probes, circuit, shown.result.corners) : null
  const base = `${import.meta.env.BASE_URL}sim/`
  const ref = (uid: string) => diagram.parts.find((p) => p.uid === uid)?.designator ?? uid
  return (
    <aside className="inspector probes-panel" aria-label="Probes">
      <h2 id="probes-heading" tabIndex={-1}>Probes</h2>
      <p className="hint">Click a pin, a breadboard hole, the end of a wire or a part to place a probe. {simulate ? '' : 'Turn on Simulate (S) to read them. '}P or Escape goes back to editing.</p>
      {probes.length === 0 ? (
        <p className="hint">No probes yet.</p>
      ) : (
        <ul className="probe-list">
          {probes.map((p, i) => {
            const r = readings?.find((x) => x.id === p.id)
            const where = p.at.pin !== undefined ? `${ref(p.at.part)} ${p.at.pin}` : ref(p.at.part)
            return (
              <li key={p.id} className={shown?.stale ? 'stale' : undefined}>
                <span className="probe-chip" style={{ background: PROBE_COLORS[i % PROBE_COLORS.length] }} aria-hidden="true" />
                <div className="probe-body">
                  <div className="probe-head">
                    <strong>{p.id}</strong>
                    <span className="probe-where">{where}</span>
                  </div>
                  <CommitInput id={`probe-name-${p.id}`} label="Name" value={p.name ?? ''} onCommit={(name) => store.commit(renameProbe(store.getState().diagram, p.id, name))} />
                  <p className="probe-reading">{p.at.pin === undefined ? partText(r?.part) : readingText(r?.voltage)}</p>
                  {p.at.pin === undefined && r?.part && (
                    <ul className="probe-pins">
                      {Object.entries(r.part.typical.pins).map(([pin, x]) => (
                        <li key={pin}>{pin}: {x.kind === 'value' ? `${formatValue(sig(x.value), 'A')} ${x.value >= 0 ? 'in' : 'out'}` : 'floating'}</li>
                      ))}
                    </ul>
                  )}
                  {r?.voltage?.typical.kind === 'value' && <p className="hint">Relative to {r.voltage.typical.reference}.</p>}
                </div>
                <button type="button" className="tool small danger" aria-label={`Delete probe ${p.id}`} onClick={() => store.commit(removeProbe(store.getState().diagram, p.id))}>Delete</button>
              </li>
            )
          })}
        </ul>
      )}
      {shown && (
        <section className="supplies" aria-labelledby="supplies-title">
          <h3 id="supplies-title">Supplies</h3>
          <table>
            <thead>
              <tr><th scope="col">Supply</th><th scope="col">Voltage</th><th scope="col">Load</th><th scope="col">Limit</th><th scope="col">Headroom</th><th scope="col">From</th></tr>
            </thead>
            <tbody>
              {shown.result.budget.map(supplyRow).map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th><td>{row.volts}</td><td>{row.load}</td><td>{row.limit}</td><td>{row.headroom}</td><td className={`basis ${row.basis}`}>{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {shown && (shown.result.unsimulated.length > 0 || shown.result.notes.length > 0) && (
        <section className="sim-notes" aria-labelledby="sim-notes-title">
          <h3 id="sim-notes-title">Not simulated, and notes</h3>
          <ul>
            {shown.result.unsimulated.map((u, i) => <li key={`u${i}`}>{ref(u.part)}: {u.reason}</li>)}
            {shown.result.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
          </ul>
        </section>
      )}
      <details className="about-sim">
        <summary>About the simulator</summary>
        <p>Circuitoon solves the sheet with ngspice{shown ? ` ${shown.result.engine.version} (engine build ${shown.result.engine.build})` : ''}, compiled to WebAssembly and run in your browser; nothing is uploaded. ngspice is distributed under the modified BSD licence; its numparam component is under the GNU LGPL, version 2 or later, and its sparse matrix code under the Sparse 1.3 licence.</p>
        <p><a href={`${base}NOTICE.txt`} target="_blank" rel="noopener noreferrer">Licences and notices</a> and <a href="https://github.com/MBarc/circuitoon/releases" target="_blank" rel="noopener noreferrer">the engine's source, patches and build</a>.</p>
      </details>
    </aside>
  )
}
```

In `src/editor/Inspector.tsx`, export `CommitInput` (`export function CommitInput`). In `src/editor/Editor.tsx`, read `simTool` with `useEditorState(store)` and render `{simTool === 'probe' ? <ProbesPanel store={store} /> : <Inspector ... />}` in place of the Inspector line.

`src/editor/editor.css`:

```css
/* The Probes panel: probes as small sticker cards, then the Supplies table. */
.probe-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.probe-list > li {
  display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: start;
  background: var(--bg); border: 1.5px solid var(--card-edge); border-radius: 8px; padding: 8px;
}
.probe-list > li.stale { opacity: 0.55; }
.probe-chip { width: 8px; align-self: stretch; border-radius: 4px; }
.probe-body { display: grid; gap: 4px; min-width: 0; }
.probe-head { display: flex; gap: 8px; align-items: baseline; }
.probe-head strong { font: 600 15px/1.2 "Fredoka", system-ui, sans-serif; }
.probe-where { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.probe-reading { margin: 0; font: 700 15px/1.3 "Atkinson Hyperlegible", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.probe-pins { margin: 0; padding-left: 16px; font-size: 13px; }
.supplies { border-top: 1.5px solid var(--rule); padding-top: 10px; overflow-x: auto; }
.supplies h3, .sim-notes h3 { margin: 0 0 6px; font: 600 16px/1.2 "Fredoka", system-ui, sans-serif; }
.supplies table { border-collapse: collapse; font-size: 12.5px; width: 100%; font-variant-numeric: tabular-nums; }
.supplies th, .supplies td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
.supplies thead th { color: var(--muted); font-weight: 700; }
.supplies .basis.estimate { color: var(--muted); font-style: italic; }
.sim-notes ul { margin: 0; padding-left: 18px; font-size: 13.5px; display: grid; gap: 3px; }
.about-sim summary { cursor: pointer; font-weight: 700; }
.about-sim p { font-size: 13.5px; margin: 6px 0 0; }
```

(The inspector column is 270 px wide; the table scrolls sideways inside `.supplies` rather than squeezing.)

- [ ] **Step 4: Run the tests and the editor suite**

Run: `npx vitest run src/editor/probesPanel.test.ts src/editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/ProbesPanel.tsx src/editor/probesPanel.test.ts src/editor/Editor.tsx src/editor/Inspector.tsx src/editor/editor.css
git commit -m "$(cat <<'MSG'
Editor: the Probes panel (readings, Supplies table, not-simulated notes, About the simulator)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 38: Visual validation, light and dark, and the editor budgets

**Files:**
- Create: `scripts/check-sim-ui.mjs`
- Modify: `package.json` (script `check:sim-ui`)

**Interfaces:**
- Consumes: the built site (`npm run build`), `scripts/lib/browser-check.mjs` (`startPreview`, `launchChrome`, `checker`, `flagOf`; ruling R16: playwright-core driving its own Chrome, never the Playwright MCP, never the shared debugging ports), `SIM_TIMEOUT_KEY` (Task 33).
- Produces: screenshots `sim-<case>-<scheme>.png` in `--out` (the session scratchpad; default `.superpowers/sim-ui`, which git ignores), and pass or fail lines for each check, exit 1 on a failure.

- [ ] **Step 1: Write the check script**

`scripts/check-sim-ui.mjs`:

```js
// Browser check for live simulation (docs/superpowers/specs/2026-10-05-live-simulation-design.md,
// sections 6 and 9), in the built app, light and dark:
//   1. LEDs: glow at three currents (100 ohm, 1 k, 10 k from 3 V), an LED with no resistor over its
//      absolute maximum (dark red, warning ring, badge); probes of every kind: a pin, a part, a
//      breadboard hole, a capacitor-only plate ("floating") and an outlet's live hole ("undefined").
//   2. Brownout: a DevKit on 3 V: the brownout badge, and both finding groups in the side panel.
//   3. Supplies: the Probes panel with the Supplies table.
//   4. Failure: a solve that cannot finish (the debug timeout knob): the banner, stale readings.
//   5. Budgets: Simulate's cold start (at most 1.5 s, with progress shown) and a 200-part drag with
//      Simulate on (median frame at most 17.5 ms: 60 fps).
// Screenshots go to --out as sim-<case>-<scheme>.png; review each one by eye (Step 3).
// Usage (after `npm run build`): npm run check:sim-ui -- [--out <dir>] [--port 4212]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/sim-ui'))
const port = Number(flagOf('--port', '4212'))
mkdirSync(out, { recursive: true })

const ids = ['battery-holder-2xaa', 'resistor', 'led', 'capacitor-ceramic', 'breadboard-mini', 'outlet-us-5-15r-duplex', 'esp32-devkit-v1-30', 'oled-ssd1306-096-i2c']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const ohms = (v) => ({ values: { resistance: { value: v, unit: 'ohm' } } })
const file = (name, title, parts, connections, probes) => {
  const path = join(out, `sim-${name}.circuitoon.json`)
  const used = new Set(parts.map((p) => p.module))
  writeFileSync(path, JSON.stringify({ format: 'circuitoon-diagram/1', title, modules: Object.fromEntries(Object.entries(modules).filter(([id]) => used.has(id))), parts, connections, ...(probes ? { probes } : {}) }))
  return path
}
const w = (uid, a, ap, b, bp) => ({ uid, from: { part: a, pin: ap }, to: { part: b, pin: bp }, color: 'blue', gauge: 22 })

// 1. Three LEDs from 3 V at 100 ohm, 1 k and 10 k, a fourth with no resistor; a capacitor with one
// plate free; a resistor on a mini breadboard; an outlet (mains: undefined).
const ledParts = [at('bt1', 'BT1', 'battery-holder-2xaa', 40, 200)]
const ledWires = []
;[100, 1000, 10000].forEach((r, i) => {
  ledParts.push(at(`r${i}`, `R${i + 1}`, 'resistor', 220, 60 + i * 90, ohms(r)), at(`d${i}`, `D${i + 1}`, 'led', 380, 60 + i * 90))
  ledWires.push(w(`wa${i}`, 'bt1', '+', `r${i}`, '1'), w(`wb${i}`, `r${i}`, '2', `d${i}`, 'A'), w(`wc${i}`, `d${i}`, 'K', 'bt1', '-'))
})
ledParts.push(at('d9', 'D9', 'led', 380, 360), at('c1', 'C1', 'capacitor-ceramic', 560, 80), at('bb1', 'BB1', 'breadboard-mini', 560, 200), at('o1', 'J1', 'outlet-us-5-15r-duplex', 820, 60))
ledWires.push(w('wd', 'bt1', '+', 'd9', 'A'), w('we', 'd9', 'K', 'bt1', '-'), w('wf', 'c1', '1', 'bt1', '+'))
const ledFile = file('leds', 'LEDs and probes', ledParts, ledWires, [
  { id: 'P1', name: 'BT1 +', at: { part: 'bt1', pin: '+' } },
  { id: 'P2', at: { part: 'd0' } },
  { id: 'P3', at: { part: 'bb1', pin: 'c1-top' } },
  { id: 'P4', name: 'C1 free plate', at: { part: 'c1', pin: '2' } },
  { id: 'P5', name: 'mains L', at: { part: 'o1', pin: 'L1' } },
])
// 2. A DevKit V1 fed 3 V on VIN: it browns out; the OLED shares its 3V3.
const brownFile = file('brownout', 'DevKit on 3 V', [at('bt1', 'BT1', 'battery-holder-2xaa', 40, 120), at('u1', 'U1', 'esp32-devkit-v1-30', 300, 40), at('ds1', 'DS1', 'oled-ssd1306-096-i2c', 640, 60)],
  [w('w1', 'bt1', '+', 'u1', 'VIN'), w('w2', 'bt1', '-', 'u1', 'GND'), w('w3', 'u1', '3V3', 'ds1', 'VCC'), w('w4', 'u1', 'GND 2', 'ds1', 'GND')])
// 5. 200 parts: a battery and 99 resistor-LED pairs, for the drag budget.
const bigParts = [at('bt1', 'BT1', 'battery-holder-2xaa', 0, 0)]
const bigWires = []
for (let i = 0; i < 99; i++) {
  bigParts.push(at(`r${i}`, `R${i + 1}`, 'resistor', 150 + (i % 11) * 160, 40 + Math.floor(i / 11) * 70, ohms(220 + i)), at(`d${i}`, `D${i + 1}`, 'led', 230 + (i % 11) * 160, 40 + Math.floor(i / 11) * 70))
  bigWires.push(w(`a${i}`, 'bt1', '+', `r${i}`, '1'), w(`b${i}`, `r${i}`, '2', `d${i}`, 'A'), w(`c${i}`, `d${i}`, 'K', 'bt1', '-'))
}
const bigFile = file('big', '200 parts', bigParts, bigWires)

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
    const path = join(out, `sim-${name}-${scheme}.png`)
    await page.screenshot({ path })
    console.log('saved', path)
  }
  const simulate = page.locator('button.sim-toggle')
  const phase = () => simulate.getAttribute('data-sim-phase')
  const solved = async () => page.waitForFunction(() => document.querySelector('button.sim-toggle')?.getAttribute('data-sim-phase') === 'done', null, { timeout: 15000 })
  /** Imports a sheet the way check-usb-ui does (the toolbar's hidden file input), with Simulate off, so the next Simulate solves it afresh. */
  const open = async (path) => {
    if ((await phase()) !== 'off') await simulate.click()
    await page.locator('input[type=file]').setInputFiles(path)
    await page.waitForTimeout(500)
    await page.waitForSelector('svg.canvas [data-part]')
  }
  const simOn = async () => {
    await simulate.click()
    await solved()
  }
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // 1. LEDs and probes; the cold start is measured on the first Simulate of the light pass.
  await open(ledFile)
  const t0 = Date.now()
  await simulate.click()
  let sawProgress = false
  for (let i = 0; i < 100 && (await phase()) !== 'done'; i++) {
    if ((await phase()) === 'loading' || (await page.locator('.sim-status.loading').count())) sawProgress = true
    await page.waitForTimeout(15)
  }
  await solved()
  const cold = Date.now() - t0
  if (scheme === 'light') {
    check(cold <= 1500, `cold start ${cold} ms (budget 1500 ms)`)
    check(sawProgress, 'load progress was shown')
  }
  const levels = await page.$$eval('[data-sim-led]', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-sim-led'), Number(e.getAttribute('data-sim-level'))])))
  check(levels.d0 > levels.d1 && levels.d1 > levels.d2 && levels.d2 >= 0, `glow follows current: ${JSON.stringify(levels)}`)
  check((await page.locator('[data-sim-led="d9"] .sim-ring').count()) === 1, 'the LED with no resistor has the warning ring')
  check((await page.locator('[data-sim-badge]').count()) > 0, 'simulation badges are drawn')
  const tags = await page.$$eval('[data-probe] .probe-text', (els) => els.map((e) => e.textContent))
  check(tags.length === 5, `five probe tags (${tags.length})`)
  check(tags.some((t) => /floating/.test(t)), 'a floating tag reads "floating"')
  check(tags.some((t) => /undefined/.test(t)), 'a mains tag reads "undefined"')
  check(tags.some((t) => /mA/.test(t)), 'a part probe reads current')
  await shot('leds')
  // 2. Brownout, and both groups in the side panel (nothing selected shows the sheet's lists).
  await open(brownFile)
  await simOn()
  await page.keyboard.press('Escape')
  check((await page.locator('#problems-title').textContent())?.includes('Wiring checks'), 'the checker group is titled for any switch position')
  check((await page.locator('#sim-title').textContent())?.includes('Simulation (current state)'), 'the simulation group is there')
  check((await page.locator('.sim-group li').filter({ hasText: /browns out|not enough voltage/i }).count()) > 0, 'the brownout is listed')
  await shot('brownout')
  // 3. Supplies.
  await page.keyboard.press('p')
  await page.waitForSelector('.probes-panel .supplies table')
  check((await page.locator('.supplies tbody tr').count()) >= 3, 'Supplies lists the battery, the regulator and the domains')
  await shot('supplies')
  await page.keyboard.press('p')
  // 4. Failure: every run times out from now on; an edit re-solves and fails.
  await open(ledFile)
  await simOn()
  await page.evaluate((key) => localStorage.setItem(key, '1'), 'circuitoon.simTimeoutMs')
  await page.locator('[data-part="r0"]').click()
  await page.locator('#part-value').fill('150')
  await page.locator('#part-value').press('Enter')
  await page.waitForSelector('.sim-status.failed', { timeout: 20000 })
  check((await page.locator('[data-sim-stale]').count()) === 1, 'the last good readings stay, dimmed and marked stale')
  await shot('failure')
  await page.evaluate((key) => localStorage.removeItem(key), 'circuitoon.simTimeoutMs')
  // 5. The 200-part drag with Simulate on (light pass only).
  if (scheme === 'light') {
    await open(bigFile)
    await simOn()
    const box = await page.locator('[data-part="r0"]').boundingBox()
    await page.evaluate(() => {
      window.__frames = []
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push(t - last)
        last = t
        if (window.__frames.length < 400) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y + 120, { steps: 90 })
    await page.mouse.up()
    const frames = (await page.evaluate(() => window.__frames)).slice(5).sort((a, b) => a - b)
    const median = frames[Math.floor(frames.length / 2)]
    check(median <= 17.5, `200-part drag median frame ${median.toFixed(1)} ms (60 fps is 16.7 ms)`)
  }
  check(errors.length === 0, `no page errors (${errors.join('; ')})`)
  await context.close()
}
await browser.close()
done()
```

Add `"check:sim-ui": "node scripts/check-sim-ui.mjs"` to `package.json`.

- [ ] **Step 2: Build and run**

Run: `npm run build && npm run check:sim-ui -- --out "<the session scratchpad>/sim-ui"`
Expected: every line `ok`, `all checks passed`, and eight screenshots (`leds`, `brownout`, `supplies` and `failure`, each in light and dark). A missed budget is reported at the checkpoint with its number.

- [ ] **Step 3: Review every screenshot by eye**

Open each PNG with the Read tool, light and dark. For each, write one line in the ledger: what it shows and whether it meets this list. Fix what fails and rerun Steps 2 and 3.
- Glow: three visibly different brightnesses, in the LED's colour, readable on the paper in both themes; the no-resistor LED dark red with a dashed red ring and a badge; nothing animates.
- Probe tags: each kind present (pin, part, hole, floating, undefined); no tag over a part body, a caption or another tag; leads distinguishable; text legible at 100 % zoom; colours distinct.
- Brownout: the badge on the DevKit; the side panel shows "Wiring checks (any switch position, external power assumed)" and then "Simulation (current state)" as separate groups.
- Supplies: aligned columns, numbers with units, provenance visible, no clipped text; in dark, the panel uses the dark tokens and stays readable.
- Failure: the banner names the failure in plain words with its details closed; readings dimmed and marked stale.
- Overall: matches the Graphite and Sticker look of the rest of the editor (sticker edges, Fredoka headings, yellow as the only chrome accent); no default-looking controls.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-sim-ui.mjs package.json
git commit -m "$(cat <<'MSG'
Checks: browser check for simulation (glow, probes, both groups, Supplies, failure, cold start, 200-part drag)

Screenshots reviewed by eye in light and dark.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

### Task 39: Plugin 0.10.0, the CLI bundle, and the docs

**Files:**
- Modify: `package.json`, `package-lock.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (every `0.9.1`), `README.md`, `docs/PRD.md`, `plugin/skills/circuitoon-design/SKILL.md`, `plugin/skills/circuitoon-design/references/module-schema.md`, `plugin/skills/circuitoon-design/references/netlist-format.md`
- Regenerate: `plugin/dist-cli/circuitoon.mjs`
- Test: `src/cli/bundle.test.ts` (add)

**Interfaces:**
- Consumes: everything above.
- Produces: plugin 0.10.0 (spec 7), a CLI bundle that runs `sim` from a copy of the plugin folder within 2 s cold on the Spirit Typewriter sheet (spec 8).

- [ ] **Step 1: Write the failing bundle test**

Append to `src/cli/bundle.test.ts` (import `netSheet` from `../sim/testing.ts` and `readFileSync` is already imported):

```ts
  it('runs sim on the Spirit Typewriter sheet from a copy of the plugin folder, cold, within 2 s (spec 8)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    const n = JSON.parse(readFileSync(resolve('src/sim/fixtures/spirit-typewriter.netlist.json'), 'utf8'))
    writeFileSync(join(dir, 'spirit.json'), JSON.stringify(netSheet(n)))
    const t0 = performance.now()
    const r = spawnSync(process.execPath, [join(dir, 'bin', 'circuitoon.mjs'), 'sim', 'spirit.json'], { encoding: 'utf8', cwd: dir })
    const ms = performance.now() - t0
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).status).toBe('ok')
    expect(ms).toBeLessThanOrEqual(2000)
  }, 60_000)
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/cli/bundle.test.ts`
Expected: FAIL: the committed bundle predates `sim` (`unknown command "sim"`, exit 2).

- [ ] **Step 3: Bump the version and rebuild the bundle**

Run: `grep -rn "0\.9\.1" package.json package-lock.json plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md`
Change each hit to `0.10.0` (in `package-lock.json`, the two top-level `version` fields only). Then:

Run: `npm run build:cli && npm run check:gen`
Expected: `plugin/dist-cli/circuitoon.mjs` rewritten; every generator matching.

- [ ] **Step 4: Update the docs**

- `docs/PRD.md`, section "V2 simulation and V3 animation": replace the V2 bullets with the shipped design: DC operating point in the saved switch and GPIO state, solved by our own ngspice 45.2 WASM build in a Web Worker (the earlier "modified nodal analysis in the style of Falstad" plan is superseded; say why: the spike's accuracy and co-simulation results); `electrical.sim` (provenance per value), probes saved in the sheet, LED glow, the two finding groups, `circuitoon sim` and gate/4; transient, PWM and firmware are later. Add a Changelog entry "### Live DC simulation (plugin 0.10.0)" listing the same in four or five bullets.
- `plugin/skills/circuitoon-design/SKILL.md`: in the workflow, before step 5 (Gate), add a step: "**Simulate.** Set each GPIO's state to what the firmware does (`values["gpio.<pin>"]`: `input`, `input-pullup`, `input-pulldown`, `high` or `low`) and each switch's position (`values["contact.<group>"]`), in the netlist. Run `circuitoon sim <netlist or sheet>` (add `--probe` for the points the user cares about). Fix every blocking finding (exit 1). Read every warning: a "Likely" warning rests on representative or estimated values; say so to the user. Then gate: `gate` runs the same simulation." Add `sim-*` codes to "Reading the gate" (Task 31 added the banners).
- `plugin/skills/circuitoon-design/references/module-schema.md`: a section "electrical.sim" that summarises spec 3.1 to 3.3 (the shape, provenance per value with a source URL or a note, node references including `<usbPin>#vbus` and `#gnd`, the required rail fields per kind) and points custom-part authors at estimates over guesses: "A wrong number is worse than a missing one."
- `plugin/skills/circuitoon-design/references/netlist-format.md`: the `probes` list (`{ "id": "P1", "name"?, "at": "REF.PIN" | "REF" | "net:NAME", "ref"? }`) and the simulation values on a part.

Run: `node -e "const fs=require('fs'),path=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);for(const f of ['docs/PRD.md','README.md',...walk('plugin/skills'),...walk('src/sim'),...walk('src/editor')])if(/[\u2013\u2014]/.test(fs.readFileSync(f,'utf8')))console.log(f)"`
Expected: no output (no em or en dashes anywhere).

- [ ] **Step 5: Run everything**

Run: `npm test && npm run validate && npm run check:gen && npm run build`
Expected: all PASS, the bundle test included (`src/cli/plugin.test.ts` checks that the plugin, the marketplace and `package.json` agree on 0.10.0 and that nothing shipped has an em dash).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json plugin .claude-plugin README.md docs/PRD.md src/cli/bundle.test.ts
git commit -m "$(cat <<'MSG'
Plugin 0.10.0: circuitoon sim and gate/4 in the CLI bundle; PRD and skill docs for live simulation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
MSG
)"
```

CHECKPOINT: Astra review of phase E

The review covers spec checkpoint 7: the editor with its visual validation (the reviewed screenshots and the budgets measured in Task 38). Then a whole-branch Claude review, Astra on the whole branch, and ship with the `circuitoon-ship` skill.

---

## Self-review

Checked against the spec with fresh eyes after writing.

**1. Spec coverage**

| Spec | Task |
|---|---|
| 1 Goal; Spirit Typewriter | 32 (fixture), 39 (CLI cold) |
| 2 Architecture: model, build, floating, spice, engine, results, session | 6, 10, 11, 12, 13, 14, 26, 29 |
| 2 Net names shared with extract | 9, 10 |
| 2.1 Checker unchanged, separate groups, sim-only CLI, gate both | 30, 31, 34 |
| 2.2 Own WASM build, pins, patches, shared + XSPICE, exports, sync commands, loader, fallback decision, committed outputs, `engine:build`, wrapper, licences, release asset | 1, 2, 4, 5 |
| 2.3 Lifecycle: lazy load, one instance per worker, run steps, recycling, timeouts, failures, tested sequences | 2, 3, 4 |
| 3.1 `electrical.sim`, provenance per value, legacy LED limit, validation, primitives without data, batteries and the fallback table, boards need `sim.power`, required fields | 6, 10, 16, 18 |
| 3.2 Power topology, rails per kind with defaults, domains, draw, multi-input | 6, 11, 16 |
| 3.3 GPIO pins, caps, defaults, output-only open, limits | 8, 11 |
| 3.4 Sourcing table, category estimates, two reviewers | 6, 17 to 24 |
| 3.5 Overrides marked user | 8, 10, 11 |
| 4 Parts to devices (every row, AC-DC single-state) | 8, 10, 11 |
| 4.0 Saved contact state, defaults shared with mains, legacy, buttons | 8, 35 |
| 4.1 LDO; 4.2 buck/boost; 4.3 suite | 13, 15, 28 |
| 4.4 Ground, islands, floating numerics, readings | 12, 13, 26 |
| 4.5 Corners | 13, 27, 28, 29 |
| 4.6 GPIO; 4.7 USB | 11, 15 |
| 5.1 SimResult; 5.2 codes, blocking rule, messages | 26, 27, 28 |
| 6.1 Toggle, progress, solve on change, never saved, failure banner | 33 |
| 6.2 Probes: tool, saving in sheets and netlists, layout and extract, validation, drawing, panel | 25, 36, 37 |
| 6.3 Glow, badges, switches, GPIO | 34, 35 |
| 6.4 Accessibility and performance | 34, 36, 38 |
| 7 `sim`, gate/4 matrix, `NOT_CHECKED`, skill, plugin 0.10.0 | 30, 31, 39 |
| 8 Budgets | 1 (download), 4 (heap), 32 (solve p95), 33 (bundle), 38 (cold start, drag), 39 (CLI cold) |
| 9 Testing list | 13, 12, 15, 27, 28, 2/4, 25, 32, 38 |
| 10 Checkpoints | the five CHECKPOINT lines (the plan itself is checkpoint 2) |

No spec requirement is without a task.

**2. Placeholder scan.** No "TBD", "TODO" or "implement later". The datasheet numbers are deliberately not in the plan: Tasks 18 to 24 are research tasks with a fixed output format and review protocol, as the controller asked. Task 1 Step 6 is a decision with stated criteria; per ruling R28 the executable adapter is an amendment only if the shared build fails.

**3. Type consistency.** Checked across tasks: `RawRun` (13) is what `Engine.run` (14), `readRun`/`budget` (26), `runDrafts` (28) and `solve` (29) use; `Device` kinds and fields (6) match `build.ts`/`power.ts` (10, 11), `deviceNodes` (12), `compile` (13) and `deviceParams` (27); `Param.label` formats are the ones the tests assert; `Probe`/`ProbeAnchor` (25) are what `probeReadings` (26), `solve` (29), `simCmd` (30) and the editor (36, 37) use; `SimView` (33) is what Tasks 34 to 37 read; `railProblem` moves from `power.ts` to `simModel.ts` in Task 16 and is imported from there afterwards.
