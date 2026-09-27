# Wall Outlets and Mains Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every worker reads Global Constraints, Resolutions and the Shared Contract below before its own task**; a task's code assumes them.

**Goal:** Let hobbyists draw how their project meets the wall (outlets, plug-in devices, AC-DC modules, relays and SSRs switching lamps, terminal blocks) and catch the dangerous mistakes with a mains checker that reasons on typed conduction, identity, energization, isolation, contact states, earth, protection, cables and plug fit, and never overclaims.

**Architecture:** New pure modules in `src/format`: `mainsModel.ts` (module fields, validation, the cached `mainsOf` view), `mainsGraph.ts` (typed conduction graph over the netlist's nets, per-state identity and energization, possible connectivity, candidate contact groups, per-component enumeration and minimal state witnesses), `mainsProtective.ts` (protective-conductor discovery), `mainsRules.ts` (the rule families, a per-state accumulator and static post-pass), `mains.ts` (the `analyseMains` orchestrator, the one cache shared by the checker and the renderer, and the honesty notice), `plugging.ts` (plug and socket families, stylized contact patterns, the compatibility table) and `mainsEvidence.ts` (the researched source evidence every mains part is generated and tested from). `checks.ts` reads the cached analysis before the DC solver, gates converter outputs by availability and keeps hazardous nets out of every DC rule; `breadboard.ts` seats plug-in devices on outlets through the table. Parts come from four new generators plus updates to two existing parts. The editor gains identity colours, a hazard look, a persistent notice and a browser check.

**Tech Stack:** TypeScript 7 (erasableSyntaxOnly), React 19, Vite 8, vitest 5, playwright-core 1.63 with the locally installed Chrome, Node 24.

**Spec:** `docs/superpowers/specs/2026-09-27-mains-outlets-design.md` (revision 5, approved by Michael; Astra verdict READY TO PLAN). The spec is the authority; this plan argues from it. Executors read both. Plan revision 2 answers Astra's plan review (`.superpowers/sdd/2026-09-27-mains-outlets/astra-plan-review.md`, 12 findings and three ordering changes, all accepted by the controller).

## Global Constraints

- Work only in the worktree `C:/Users/micha/Desktop/projects/Circuitoon-mains`, branch `mains`. Commit after every task. Never use `git stash` (shared between worktrees); never switch branches.
- TypeScript `erasableSyntaxOnly`: no `enum`, no `namespace`, no constructor parameter properties. Import local files with their `.ts` / `.tsx` extension, as the codebase does.
- No em dashes anywhere: code, comments, UI text, messages, docs, commit messages. Use a hyphen, a colon or a new sentence.
- Match the surrounding style: 2-space indent, no semicolons, single quotes, long lines are fine, JSDoc comments that say why. Messages are plain words in the diagram-edit voice the checker already uses ("Remove the wire from A to B."), naming designators and pin labels. A message never states harm as certain that the model cannot know (current, damage): it says "may".
- Generators are byte-reproducible. Every new `scripts/gen-*.mjs` writes through `write` in `scripts/lib/parts.mjs` (which uses `scripts/lib/gen-output.mjs`) and ends with `finish('<file>')`, so `npm run check:gen` runs it with `--check`.
- Never use the Playwright MCP browser (it is shared with other agents). Browser checks launch their own Chrome through `playwright-core` (`chromium.launch({ channel: 'chrome', headless: true })`) against `vite preview` on their own port, like `scripts/check-problems-ui.mjs`.
- **Every task's gate** is `npx tsc --noEmit && npm test`, both green, before its commit. A task that touches `modules/` or a generator also runs `npm run validate` and `npm run check:gen`. A task that touches UI also runs `npm run build`. The final task runs everything: `npm run validate && npm run check:gen && npx tsc --noEmit && npm test && npm run build && npm run check:problems-ui && npm run check:warnings-ui && npm run check:cables-ui && npm run check:mains-ui && node scripts/perf-breadboard.mjs`.
- Parts follow the `circuitoon-add-part` skill (`.claude/skills/circuitoon-add-part/SKILL.md` and `references/conventions.md`): category `Mains`, Sticker style (rects only, the renderer outlines), a generator per family, the PRD Built-in parts table updated, and screenshots from `.claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs` looked at in light and dark. **A wrong pin is worse than a missing part.** Every pin, contact, profile, rating and isolation value comes from `src/format/mainsEvidence.ts`, which Task 0 fills from the exact manufacturer datasheets and cited standards, never from memory or from this plan.
- **Isolation is never inferred.** A module's `isolation` is `reinforced`, `double` or `basic` only when its source states that insulation class for the barrier between mains and the output (or states protective separation, which Resolution 9 maps to `reinforced` only if the source says reinforced or double). A dielectric test voltage, a class II symbol, an SELV or ES1 label or a safety listing alone is not a class: the module then records `isolation: "unknown"`, and the checker treats that side as live and says so.
- Every parts batch (Tasks 16 to 20) ends with an independent pinout, rating and isolation review done by the controller, not the implementer (skill step 9). A **MISMATCH or NOT VERIFIED** verdict blocks the next batch until fixed or brought to Michael; nothing marked NOT VERIFIED is generated as if verified.
- Never overclaim: where data is missing or a check did not finish, a finding says "unknown" or "not checked", never "fine" (spec section 6).
- Performance budgets: `checkDiagram` on the existing 200-part / 500-wire sheets without mains stays at 20 ms median or less (the two tests in `src/format/checks.perf.test.ts` unchanged), and on such a sheet the mains analysis returns before computing plugs, a netlist or a graph; a first checkpoint (Task 11) measures one outlet with 16 fused switched lamps before any part is generated, 300 ms median or less, and redesigns the enumeration if it misses; the final sheet with 16 candidate groups and a 150-part DC section (Task 24) meets 300 ms median, 30 ms with 4 groups; `wirePaths` is not changed at all (the look is joined to its output by wire uid), so its tests and `scripts/perf-breadboard.mjs` frame budgets (median 17 ms, p95 33 ms) hold. The checker and the renderer share one cached analysis per edit (`analyseMainsCached`); nothing enumerates twice for one edit, and nothing enumerates during a drag.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` after a blank line.

## Resolutions of spec ambiguities (binding for every task)

These are decisions the spec leaves open; tasks implement them exactly. Numbers 1 to 21 were ruled on by Astra and accepted with the adjustments folded in below; 22 to 28 answer the review's findings.

1. **Prongs are internal nodes.** A plug contact names an `electrical.internalNodes` entry (a named terminal inside the part, with no pin stub and no wire end), such as `"L prong"`. Cord plug leads are ordinary pins joined to the prongs by `internal` (or, for a UK plug's L, by the integral fuse's protective edge). This keeps plugged prongs out of `resolveEndpoint` and lets UK devices declare "the L prong to the device's internal L" as the spec asks.
2. **Plug contact roles.** A plug contact's `mains` is its role in the profile (`"L"`, `"N"` or `"PE"`); an unpolarized plug's blade drawn on the L side is `"L"` by convention and its lead pins carry the requirement `"line"`. The table maps contact roles to socket roles per orientation.
3. **Orientation** is `(plug rotation - outlet rotation + 360) % 360` (tested with rotated outlets).
4. **"1-15R" in the unpolarized 1-15P row** covers both the unpolarized and the polarized 1-15R (a narrow blade enters either slot).
5. **Europlug sockets (CEE 7/16)** are a table family with no built-in outlet; tests use a synthetic one.
6. **Only plug-in devices seat on outlets, and plug-in devices seat only on outlets.** Any other part landing on an outlet's holes, or a plug landing on breadboard holes, is a mount that never seats (`no-fit`).
7. **Stylized patterns** (Task 12) are identical for plug contacts and socket holes at orientation 0. Within one geometry group (NEMA, CEE, BS, AS) the table alone decides polarization, since the grid cannot draw blade width; across groups no pattern lands fully on a socket it has no table entry for, at any rotation. Built-in parts are tested for their contact subsets and against translations too.
8. **Energize edges** model energy crossing into a part without identity: across an inadequate isolation barrier they are directed (mains domain to secondary), for an undeclared mains terminal they are undirected between it and every other mains terminal of the part. Energization otherwise follows the spec's closure literally.
9. **Protective separation** is adequate for `reinforced`, `double`, or `basic` plus `safeguard: "protective-screen"`. The effective class of a secondary is computed from that separation and a declared PE bond (spec 1.3), never taken from a domain's `selv` / `pelv` label: the label only names the domain.
10. **Sources are limited to 10 per sheet** for exhaustive analysis (identity is one 30-bit mask). The limit counts AC sources (`acSources` entries), not parts: more than 10 gives `mains-incomplete` ("Mains checks did not finish: 11 AC sources. Split the drawing or check the rest by hand."), the same honest path as more than 16 contact groups.
11. **Converter availability across states:** powered in at least one enumerated state counts as powered (as the DC checker already takes a switch as closed); unpowered only when unpowered in every state; unknown otherwise, with the reason from its first unknown state in enumeration order (fewest groups on first). When enumeration did not finish, nothing is claimed unpowered unless no source terminal (L, N or PE) shares a possible-connectivity component with either input, which is a proof, not an enumeration result; every other converter is unknown ("the mains checks did not finish").
12. **DC rules skip hazardous nets, not every mains-declared pin.** A net that is hazardous in some state (or might be, when enumeration did not finish) is left out of every DC rule, and no DC source edge whose output, return, inferred return or diode return is on such a net enters the potential solver. A relay's contacts switching a DC motor stay in the DC checker as before.
13. **Rule 8 loads** are the `electrical.conducts` entries of kind `load`. A converter's input is not a load for rule 8 (it is checked by rules 4 and 11), which is what the spec's "HLK-PM01 feeding an ESP32 (clean apart from cable-unverified)" requires. Wiring from a converter onward to declared loads stays checked.
14. **A load's accepted range** is `conducts[].range` (volts AC), from the reference product. A load without one that gets L and N of a source in some state gets a `data-missing` warning saying its voltage compatibility was not checked; it is never silently skipped.
15. **"300 VDC-only terminal on 230 VAC (rating)"** is `rating-unknown` (it has a rating of another service, so it is declared for mains but has no relevant rating), not `mains-rating` and not rule 1.
16. **`fuseRating`** is valid above 0 up to 100 A; a module may leave its default out (unknown). An integral fuse's `protective[].rating`, when given, wins over the param.
17. **Settings default** is the first listed choice (`["fitted", "absent"]` defaults to fitted).
18. **Outlet region** is `electrical.ac.region` (`us`, `jp`, `eu`, `uk`, `au`); it sets identity colours (us and jp: L black, N white, PE green; eu, uk and au: L brown, N blue, PE green-yellow).
19. **Wire colour by identity:** a node has an identity colour only when, across every enumerated state in which it has any identity, that identity is the same single conductor (a node that is PE in one state and L in another has none). A new wire from or to such a terminal starts in that colour; a stored wire with no `color` renders in it; a stored colour always wins. Green-yellow is a new named colour drawn as a two-colour stroke.
20. **Exports:** the app has no image or PDF export yet (JSON only, plus the browser's print). The notice is drawn inside `render/Sheet.tsx` (the SVG any future image or PDF export renders) in a footer band the sheet reserves below the drawing, wrapped to the sheet width with measured lines; shown on the printed editor page by a print stylesheet; and written into exported JSON as a top-level `notes` entry. The PRD records that every future export must carry it.
21. **Source evidence wins over expected clean results.** Isolation comes only from an explicit source statement (see Global Constraints); no test voltage is mapped to a class. Task 0 records what each source says. If the Songle relay's or the Hi-Link modules' sources do not state an adequate class, the spec's relay circuit and HLK circuit cannot be clean as written: Task 0 reports it as a blocking item, and the controller asks Michael before Task 20 changes any expected result.
22. **Polarity on unpolarized outlets is reported as uncertain, never skipped.** For a source whose L side no standard fixes (`nema-1-15r`, `cee7-3`, `cee7-16`), a polarity requirement (a lamp shell, a single-pole switch or fuse) that depends on which slot is L gets a `polarity` warning worded with "may" and the reason ("XS1 is an unpolarized outlet, so which slot is L is not known"); a definite violation from a polarized source keeps the definite wording.
23. **The notice appears for any mains part** (spec 6: "a sheet with any mains part"): any part whose module declares mains data, a mains-rated relay, SSR or terminal block alone included.
24. **State witnesses are minimal and complete.** A finding records every state it holds in (one bit per state). Its phrase lists exactly the contact conditions (on and off, energized and released) that are needed: a condition is dropped only when the finding holds in every state that agrees with the remaining conditions. A finding that holds in every state has no phrase.
25. **Enumeration is per possible-connectivity component.** Components cannot affect each other, so each component's candidate groups are enumerated on their own (the sum of their state counts, not the product). The spec's limit still counts every candidate group on the sheet: more than 16 in total gives `mains-incomplete`.
26. **An unverified isolation class** (a clone board carrying its relay's stated class, `isolationProvenance: "unverified"`) counts as that class for hazard propagation, and always adds a `rating-unverified` warning while that part is on mains.
27. **A converter's pins outside every domain** (and every non-mains pin of a converter whose `isolation` is missing or not adequate) are treated as live when its input is energized, and `data-missing` names them.
28. **An empty fuse holder is named as the cause of a dead load only when proven:** the load gets L and N of one source in some state with every absent fuse taken as fitted, and in no state as drawn. Nothing about absent fuses is claimed when the enumeration did not finish.

## Shared Contract (every worker reads this)

- **Entry points.** `analyseMainsCached(d: Diagram): MainsAnalysis | null` (in `src/format/mains.ts`) is the only way the checker, the canvas and the sheet read mains results; it caches one result per `d.parts`, `d.connections`, `d.modules` triple and returns `null` after a single scan of the parts when no part has mains data (no plugs, no netlist, no graph). `analyseMains(d)` is the uncached worker it calls.
- **Terminals** are named by `nodeKey(part, name)` from `netlist.ts` (pins, hole groups and internal nodes alike). Graph nodes are nets; `MainsGraph.nodeOf` maps a key to its node.
- **Identity** is a 30-bit mask, `bitOf(sourceIndex, 'L' | 'N' | 'PE')`; energization is a 10-bit source mask. `L_MASK`, `N_MASK`, `PE_MASK`, `LN_MASK` select conductors across all sources. A node is hazardous when `(ident & LN_MASK) || power`.
- **Findings** from mains rules are `MainsDraft` (the checker's `Finding` without `id` and `severity`, plus `causes`); `causes` are stable keys (terminal keys, wire uids, or `#`-prefixed pseudo keys) so a finding's id survives redrawing. `wires` lists every wire on the finding's path (Task 6 and 9 define the paths); `select` defaults to the parts and wires.
- **Rule registration.** Per-state rules append to `STATE_RULES` and report with `report(acc, key, mask, first)`; static rules append to `STATIC_RULES` and return drafts. Rule keys start with the rule id.
- **Test fixtures** live in `src/format/mains.testing.ts` (synthetic modules `t-*`, helpers `at`, `w` (18 AWG ferrule wire), `dupont`, `sheet`); tests of real parts use `load` from `builtinModules.testing.ts` and values from `src/format/mainsEvidence.ts`. Wire uids from `w` are unique per test file run; tests that assert paths keep the returned connections and compare uids.
- **Evidence** is `src/format/mainsEvidence.ts` (Task 0): per part id, the sources, the transcribed values, a quoted source line per value and a verdict. Generators import from it; parts tests compare generated modules against it and against the values a standard fixes.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/format/mainsEvidence.ts` | create (Task 0) | researched source evidence per mains part: URLs, values, quoted lines, verdicts |
| `docs/superpowers/evidence/2026-09-27-mains-parts.md` | create (Task 0) | the human-readable research log and the list of NOT VERIFIED items with their blocking disposition |
| `src/format/module.ts` | modify | `acVoltage` and `fuseRating` params (optional default), `settings`, pin `mains` and `bond`, `internalNodes`, calls `validateMains` |
| `src/format/values.ts` | modify | `VAC` and `A` units, `editableParams`, `paramValue` |
| `src/format/diagram.ts` | modify | `PartInstance.settings`, `Diagram.notes`, loader drops bad settings and notes, `no-fit` mount warning, green-yellow colour |
| `src/format/mainsModel.ts` | create | mains field types, `validateMains`, `claimInternalNodes`, `mainsOf`, `isolationAdequate`, `uncoveredPins` |
| `src/format/words.ts` | create | `natural`, `andList`, `orList` shared by `checks.ts` and the mains files |
| `src/format/mainsGraph.ts` | create | graph, `prepare`, `analyseState`, components, candidates, witnesses, phrases, bit masks |
| `src/format/mainsProtective.ts` | create | protective-conductor discovery (biconnected blocks, block-cut tree) |
| `src/format/mainsRules.ts` | create | accumulator, `report`, per-state rules, static rules |
| `src/format/mains.ts` | create | `analyseMains`, `analyseMainsCached`, `hasMains`, `withSheetNotes`, `MAINS_NOTICE` |
| `src/format/plugging.ts` | create | plug and socket families, patterns, compatibility table, names, `orientationOf`, `entriesFor` |
| `src/format/breadboard.ts` | modify | plug-in devices seat through the table, `no-fit`, `plugMismatches` |
| `src/format/checks.ts` | modify | new rule ids, mains findings, converter gating, hazardous nets and source edges skipped, mount findings for outlets folded into `plug-mismatch` |
| `src/format/mainsLook.ts` | create | identity colours, `identityColor`, `wireLooks`, `newWireColor` |
| `src/format/mains.testing.ts` | create | synthetic mains fixture modules and sheet helpers for tests |
| `src/format/*.test.ts` | create / modify | tests per task (named in each task) |
| `src/render/Mains.tsx` | create | hazard outline, lightning markers, striped PE stroke, SVG notice and its line measure |
| `src/render/Sheet.tsx` | modify | identity colours, hazard look, notice footer |
| `src/editor/Canvas.tsx` | modify | identity colours, hazard look, new-wire identity colour, red outline for a plug that does not fit |
| `src/editor/Inspector.tsx` | modify | every editable param (unknown allowed), setting selects, green-yellow swatch, notice, new empty state |
| `src/editor/Toolbar.tsx` | modify | mains badge, print notice, export with notes |
| `src/editor/ops.ts` | modify | `PREFIXES`, `updatePartSetting`, `clearPartValue`, `updatePartValue` by name |
| `src/editor/libraryGroups.ts` | modify | `Mains` category |
| `src/editor/editor.css` | modify | badge, notice, print notice |
| `scripts/lib/mains.mjs` | create | shared generator helpers: sockets, plug profiles, prong nodes, ratings |
| `scripts/gen-mains-outlets.mjs` | create | 8 outlets |
| `scripts/gen-mains-plugs.mjs` | create | USB chargers, barrel adapters, cord plugs |
| `scripts/gen-mains-loads.mjs` | create | HLK-PM01, HLK-PM03, lamp holders, fuse holder, Wago |
| `scripts/gen-mains-terminals.mjs` | create | Phoenix MSTB and MC terminal blocks, clones |
| `scripts/gen-outputs.mjs` | modify | relay module contacts, domains, ratings; Fotek SSR-25DA |
| `modules/*.json` | generated | new and updated parts (KCD1 edited by hand) |
| `scripts/check-mains-ui.mjs` | create | browser check `npm run check:mains-ui` |
| `package.json` | modify | `check:mains-ui` script |
| `docs/PRD.md` | modify | module fields, Mains parts, the honesty statement, exports carry the notice |
| `.claude/skills/circuitoon-add-part/SKILL.md`, `references/conventions.md` | modify | mains fields, new prefixes, the Mains category, the evidence file, the new generators |

## Task order

0 evidence (no code); 1 to 2 format; 3 to 5 graph, enumeration and the analysis; 6 to 10 rules (8 is protective-path discovery on its own); 11 first performance checkpoint; 12 to 14 plugging (data, mount integration, UI); 15 designators and helpers; 16 to 20 parts batches; 21 look; 22 honesty; 23 browser check; 24 final budgets and verification.

---

### Task 0: Source evidence for every mains part (research only, before any code)

**Files:**
- Create: `docs/superpowers/evidence/2026-09-27-mains-parts.md`
- Create: `src/format/mainsEvidence.ts`
- Test: `src/format/mainsEvidence.test.ts`

**Interfaces:**
- Consumes: the spec's part list (section 4), the standards it names.
- Produces: `src/format/mainsEvidence.ts` exporting the types and the table below; every later parts task and parts test reads it.

```ts
// Source evidence for the built-in mains parts (spec section 4): what each exact datasheet or
// standard says, transcribed with the line it came from, and whether it was verified. Generators
// build the parts from it; tests compare the parts against it. A value a source does not state is
// absent here, never guessed.
export type Verdict = 'VERIFIED' | 'NOT VERIFIED'
export interface Fact<T> { value: T; quote: string; url: string }
export interface RatingFact { volts: number; amps?: number; service: 'ac' | 'dc' | 'ac/dc'; conditions?: string; quote: string; url: string }
export interface PartEvidence {
  /** The exact part (maker and part number) or standard the part is built from. */
  subject: string
  /** Every URL used, standard or datasheet first; becomes the module's `source`. */
  sources: string[]
  verdict: Verdict
  /** For NOT VERIFIED: what is missing and what the part does meanwhile ("not generated", or "generated with isolation unknown"). */
  blocking?: string
  /** Pin or terminal names in physical order per side, as the source shows them. */
  pins?: Fact<Record<string, string[]>>
  /** Which contact is L, N, PE, seen from the front (outlets, plugs). */
  lSide?: Fact<string>
  ratings?: RatingFact[]
  /** The insulation class the source states for the mains-to-output barrier; absent when it states none. */
  isolation?: Fact<'reinforced' | 'double' | 'basic'>
  acInput?: Fact<[number, number]>
  output?: Fact<{ volts: number }>
  protection?: Fact<'class-1' | 'class-2'>
  loadRange?: Fact<[number, number]>
  /** Anything else a generator needs (fuse rating, control range, leakage, revision, part numbers). */
  extra?: Record<string, Fact<unknown>>
}
export const EVIDENCE: Record<string, PartEvidence> = {
  // one entry per module id of Tasks 16 to 20, filled in Step 2
}
```

- [ ] **Step 1: Research, part by part (implementer, with WebFetch and PDF reading)**

For every module id the spec lists (outlets, plug-in devices per family, HLK-PM01 and PM03, E26 and E27 lamp holders, the 5x20 fuse holder, KCD1, Wago 221-412/413/415, Phoenix MSTB 2,5 and MC 1,5 at 2 to 6 positions with plug and header item numbers, the KF2EDG and KF301 clones, the relay module and its Songle relay, the Fotek SSR-25DA in its current revision with date), open the exact source and record, in the evidence log, each value with a quoted line and its URL:
- outlets and plugs: the standard's contact layout and which contact is L (NEMA WD 6, JIS C 8303, CEE 7 sheets, DIN 49440 / 49441, NF C 61-314, BS 1363, AS/NZS 3112, IEC TR 60083), real contact spacing, and the rating;
- chargers and adapters: the exact maker part numbers per region (first choice CUI Devices SWI series; record what was chosen and why), input range, output voltage, plug type, integral UK fuse rating, and the insulation class only if the datasheet states it;
- Hi-Link, Songle, Fotek: pin order, ranges, contact and load ratings with conditions, leakage, and the stated insulation class between mains and the low-voltage side, quoted; if the source gives only a test voltage, write exactly that and record no class;
- lamp holders (Leviton 9880 for E26; a maker's E27 holder stating rating and earth terminal), the lamps whose rated voltage sets `loadRange`, the fuse holder (Schurter FPG4), KCD1, Wago (IEC values with overvoltage category and pollution degree as conditions), Phoenix (every nominal voltage with its conditions, current, and both item numbers per size), clones (the vendor listing's voltage and current).

Also check each family's L side against Task 12's pattern table and write any difference.

- [ ] **Step 2: Fill `src/format/mainsEvidence.ts` and the verdicts**

One entry per module id with the fields above, values exactly as the source states them. `verdict: 'VERIFIED'` only when every value the part needs has a quote; otherwise `'NOT VERIFIED'` with `blocking` saying what is missing and the proposed disposition: "not generated until resolved", "generated with isolation unknown (the checker treats its output as live)", or "dropped from this release". The spec's clean-circuit expectations (Resolution 21) are listed there too when the evidence contradicts them.

- [ ] **Step 3: Write the evidence test**

```ts
// The evidence table is complete and honest: every mains part the spec lists has an entry, every
// entry cites sources, and every value carries the line it was read from.
import { describe, expect, it } from 'vitest'
import { EVIDENCE } from './mainsEvidence.ts'

const IDS = [
  'outlet-us-5-15r-duplex', 'outlet-us-5-20r-duplex', 'outlet-uk-bs1363', 'outlet-schuko-cee7-3', 'outlet-fr-cee7-5', 'outlet-au-as3112', 'outlet-jp-1-15r-duplex', 'outlet-jp-1-15r-duplex-polarized',
  'charger-usb-5v-us', 'charger-usb-5v-eu', 'charger-usb-5v-uk', 'charger-usb-5v-au', 'adapter-barrel-us', 'adapter-barrel-eu', 'adapter-barrel-uk', 'adapter-barrel-au',
  'plug-us-5-15p', 'plug-us-1-15p', 'plug-jp-1-15p', 'plug-eu-cee7-7', 'plug-eu-cee7-16', 'plug-uk-bs1363-3lead', 'plug-uk-bs1363-2lead', 'plug-au-as3112-3lead', 'plug-au-as3112-2lead',
  'hlk-pm01', 'hlk-pm03', 'lamp-holder-e26', 'lamp-holder-e27', 'fuse-holder-5x20-inline', 'rocker-switch-kcd1', 'wago-221-412', 'wago-221-413', 'wago-221-415',
  ...[2, 3, 4, 5, 6].flatMap((n) => [`terminal-block-mstb-508-${n}`, `terminal-block-mc-381-${n}`]),
  'terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3',
  'relay-module-1ch-5v', 'ssr-fotek-25da',
]

describe('mains evidence', () => {
  it('has an entry for every mains part in the spec', () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([...IDS].sort())
  })
  for (const id of IDS)
    it(`${id}: sources cited, every value quoted, a verdict with a disposition when not verified`, () => {
      const e = EVIDENCE[id]
      expect(e.sources.length).toBeGreaterThan(0)
      for (const u of e.sources) expect(u).toMatch(/^https?:\/\//)
      const facts = [e.pins, e.lSide, e.isolation, e.acInput, e.output, e.protection, e.loadRange, ...(e.ratings ?? []), ...Object.values(e.extra ?? {})].filter(Boolean)
      for (const f of facts) expect([f!.quote.length > 0, /^https?:\/\//.test(f!.url)]).toEqual([true, true])
      if (e.verdict === 'NOT VERIFIED') expect(e.blocking).toBeTruthy()
    })
})
```

- [ ] **Step 4: Run it and commit**

Run: `npx tsc --noEmit && npx vitest run src/format/mainsEvidence.test.ts`
Expected: PASS.

```bash
git add src/format/mainsEvidence.ts src/format/mainsEvidence.test.ts docs/superpowers/evidence/2026-09-27-mains-parts.md
git commit -m "Mains: source evidence for every mains part" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Controller review and blocking items (controller, not the implementer)**

The controller has an independent reviewer re-open every source and check each quoted value, then brings every NOT VERIFIED item and every contradiction with the spec's expected results (Resolution 21) to Michael with the proposed disposition. Parts tasks start only after Michael has decided on each blocking item; his decisions are written into the evidence log and `blocking` fields.

---

### Task 1: acVoltage and fuseRating params, part settings

**Files:**
- Modify: `src/format/module.ts:127-136` (PARAM_RULES, validParamValue), `:259-274` (params check), add `moduleSettings`, `partSetting`, settings validation
- Modify: `src/format/values.ts:10` (UNIT_SYMBOLS), `:60-67` (matchesUnit), add `editableParams`, `paramValue`
- Modify: `src/format/diagram.ts:16-26` (PartInstance), `:767-801` (parts loop)
- Modify: `src/editor/ops.ts:354-362` (updatePartValue), add `updatePartSetting`, `clearPartValue`
- Modify: `src/editor/Inspector.tsx:141-187` (VALUE_LABELS, ValueInput), `:370-398` (part panel)
- Test: `src/format/module.test.ts`, `src/format/values.test.ts`, `src/format/diagram.test.ts`, `src/editor/ops.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `PARAM_RULES.acVoltage` (`unit: 'VAC'`, 1 to 1000) and `PARAM_RULES.fuseRating` (`unit: 'A'`, above 0 up to 100, `optional: true`); the rule type gains `optional?: boolean`.
  - `moduleSettings(m: ModuleDef): Record<string, string[]>` and `partSetting(part: { settings?: Record<string, string> }, m: ModuleDef, name: string): string | null` in `module.ts`.
  - `editableParams(m: ModuleDef): { name: string; unit: string; default: number | null }[]` and `paramValue(part: { values?: Record<string, unknown> }, m: ModuleDef, name: string): number | null` in `values.ts`.
  - `PartInstance.settings?: Record<string, string>`.
  - `updatePartSetting(d: Diagram, uid: string, name: string, choice: string): Diagram` and `clearPartValue(d: Diagram, uid: string, param: string): Diagram` in `ops.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/format/module.test.ts`:

```ts
describe('mains value params', () => {
  const pins = [{ name: 'A', side: 'left' }]
  it('accepts an acVoltage from 1 to 1000 VAC and rejects anything else', () => {
    expect(validateModule({ ...base, pins, electrical: { params: { acVoltage: { unit: 'VAC', default: 230 } } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { params: { acVoltage: { unit: 'V', default: 2000 } } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.params.acVoltage.unit: must be "VAC"', 'electrical.params.acVoltage.default: must be from 1 to 1000'])
  })
  it('lets a fuseRating leave its default out (unknown), but not give a bad one', () => {
    expect(validateModule({ ...base, pins, electrical: { params: { fuseRating: { unit: 'A' } } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { params: { fuseRating: { unit: 'A', default: 0 } } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.params.fuseRating.default: must be above 0, up to 100, or left out'])
  })
  it('checks electrical.settings: a list of 2 or more different choices', () => {
    expect(validateModule({ ...base, pins, electrical: { settings: { fuse: ['fitted', 'absent'] } } }).ok).toBe(true)
    const r = validateModule({ ...base, pins, electrical: { settings: { fuse: ['fitted'] } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['electrical.settings.fuse: must be a list of 2 or more different choices, the first the default'])
  })
  it('reads a part setting: its stored choice when valid, else the first choice', () => {
    const m = { ...base, pins, electrical: { settings: { fuse: ['fitted', 'absent'] } } } as ModuleDef
    expect(partSetting({}, m, 'fuse')).toBe('fitted')
    expect(partSetting({ settings: { fuse: 'absent' } }, m, 'fuse')).toBe('absent')
    expect(partSetting({ settings: { fuse: 'blown' } }, m, 'fuse')).toBe('fitted')
    expect(partSetting({}, m, 'colour')).toBeNull()
  })
})
```

(Add `partSetting` to the import from `./module.ts` at the top of the file.)

Add to `src/format/values.test.ts`:

```ts
describe('mains units', () => {
  it('formats and parses volts AC and amps', () => {
    expect(formatValue(230, 'VAC')).toBe('230 VAC')
    expect(parseValue('230', 'VAC')).toBe(230)
    expect(parseValue('230V', 'VAC')).toBe(230)
    expect(parseValue('120 VAC', 'VAC')).toBe(120)
    expect(parseValue('2000', 'VAC')).toBeNull()
    expect(formatValue(2, 'A')).toBe('2 A')
    expect(parseValue('500m', 'A')).toBe(0.5)
    expect(parseValue('0', 'A')).toBeNull()
  })
  it('lists every editable param with its default, null for an optional one left out', () => {
    const fuse = { format: 'circuitoon-module/1', id: 'f', name: 'F', pins: [{ name: '1', side: 'left' }], electrical: { params: { fuseRating: { unit: 'A' } } } } as ModuleDef
    expect(editableParams(fuse)).toEqual([{ name: 'fuseRating', unit: 'A', default: null }])
    expect(primaryParam(fuse)).toBeNull()
    expect(paramValue({}, fuse, 'fuseRating')).toBeNull()
    expect(paramValue({ values: { fuseRating: { value: 2, unit: 'A' } } }, fuse, 'fuseRating')).toBe(2)
    expect(paramValue({ values: { fuseRating: { value: 2, unit: 'V' } } }, fuse, 'fuseRating')).toBeNull()
  })
})
```

(Import `editableParams`, `paramValue`, `primaryParam` and the `ModuleDef` type if not already imported.)

Add to `src/format/diagram.test.ts`:

```ts
describe('part settings and mains values on load', () => {
  const fuse = { format: 'circuitoon-module/1', id: 'fuse', name: 'Fuse holder', pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
    electrical: { params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] } } }
  const file = (part: Record<string, unknown>) => ({ format: 'circuitoon-diagram/1', title: 't', modules: { fuse }, parts: [{ uid: 'p1', designator: 'F1', module: 'fuse', x: 0, y: 0, ...part }], connections: [] })
  it('keeps a valid setting', () => {
    const r = validateDiagram(file({ settings: { fuse: 'absent' } }))
    expect(r.ok && r.diagram.parts[0].settings).toEqual({ fuse: 'absent' })
    expect(r.ok && r.warnings).toEqual([])
  })
  it('drops an unknown choice or setting with a warning, so the default is used', () => {
    const r = validateDiagram(file({ settings: { fuse: 'blown', colour: 'red' } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.parts[0].settings).toBeUndefined()
    expect(r.warnings).toEqual([
      'parts[0].settings.fuse: F1 has fuse "blown", but it must be "fitted" or "absent"; it was dropped and the default "fitted" is used',
      'parts[0].settings.colour: F1 has no setting "colour", so it was dropped',
    ])
  })
  it('drops settings that are not an object', () => {
    const r = validateDiagram(file({ settings: 'fitted' }))
    expect(r.ok && r.diagram.parts[0].settings).toBeUndefined()
    expect(r.ok && r.warnings).toEqual(['parts[0].settings: must be an object of setting name to choice, so it was dropped and the defaults are used'])
  })
  it('drops a fuseRating in the wrong unit, as for any value', () => {
    const r = validateDiagram(file({ values: { fuseRating: { value: 2, unit: 'V' } } }))
    expect(r.ok && r.warnings[0]).toBe(`parts[0].values.fuseRating: F1 has fuseRating 2 V, but fuseRating must be in A; ${VALUE_DROPPED}`)
  })
  it('drops an acVoltage out of range and keeps one in range', () => {
    const outlet = { format: 'circuitoon-module/1', id: 'socket', name: 'Socket', pins: [{ name: 'A', side: 'left' }], electrical: { params: { acVoltage: { unit: 'VAC', default: 120 } } } }
    const sheet = (value: number) => ({ format: 'circuitoon-diagram/1', title: 't', modules: { socket: outlet }, connections: [],
      parts: [{ uid: 'p1', designator: 'XS1', module: 'socket', x: 0, y: 0, values: { acVoltage: { value, unit: 'VAC' } } }] })
    const bad = validateDiagram(sheet(2000))
    expect(bad.ok && bad.warnings).toEqual([`parts[0].values.acVoltage: XS1 has acVoltage 2000 VAC, but acVoltage must be from 1 to 1000; ${VALUE_DROPPED}`])
    expect(bad.ok && bad.diagram.parts[0].values).toEqual({})
    const good = validateDiagram(sheet(230))
    expect(good.ok && good.warnings).toEqual([])
  })
})
```

(Import `VALUE_DROPPED` from `./diagram.ts` if the file does not already.)

Add to `src/editor/ops.test.ts`:

```ts
describe('part settings and optional values', () => {
  const fuse: ModuleDef = {
    format: 'circuitoon-module/1', id: 'fuse-holder-test', name: 'Fuse holder', pins: [{ name: '1', side: 'left' }, { name: '2', side: 'right' }],
    electrical: { params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] } },
  }
  it('sets a setting to one of its choices, one diagram per real change', () => {
    const d = addPart(emptyDiagram(), fuse, 0, 0).diagram
    const next = updatePartSetting(d, 'p1', 'fuse', 'absent')
    expect(next.parts[0].settings).toEqual({ fuse: 'absent' })
    expect(updatePartSetting(next, 'p1', 'fuse', 'absent')).toBe(next)
    expect(updatePartSetting(d, 'p1', 'fuse', 'fitted')).toBe(d)
    expect(updatePartSetting(d, 'p1', 'fuse', 'blown')).toBe(d)
  })
  it('sets and clears an optional value', () => {
    const d = addPart(emptyDiagram(), fuse, 0, 0).diagram
    const set = updatePartValue(d, 'p1', 'fuseRating', 2, 'A')
    expect(set.parts[0].values).toEqual({ fuseRating: { value: 2, unit: 'A' } })
    const cleared = clearPartValue(set, 'p1', 'fuseRating')
    expect(cleared.parts[0].values).toBeUndefined()
    expect(clearPartValue(cleared, 'p1', 'fuseRating')).toBe(cleared)
  })
})
```

(Add `updatePartSetting` and `clearPartValue` to the import from `./ops.ts`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/module.test.ts src/format/values.test.ts src/format/diagram.test.ts src/editor/ops.test.ts`
Expected: FAIL (`partSetting`, `editableParams`, `paramValue`, `updatePartSetting`, `clearPartValue` are not exported; the acVoltage module is rejected).

- [ ] **Step 3: Implement**

In `src/format/module.ts` replace `PARAM_RULES` (lines 127-131):

```ts
export const PARAM_RULES: Record<string, { unit: string; valid: (v: number) => boolean; range: string; optional?: boolean }> = {
  resistance: { unit: 'ohm', valid: (v) => v >= 0, range: '0, or from 1e-15 to 1e12' },
  capacitance: { unit: 'F', valid: (v) => v > 0, range: 'from 1e-15 to 1e12' },
  voltage: { unit: 'V', valid: () => true, range: '0, or a magnitude from 1e-15 to 1e12' },
  // The nominal RMS line-to-neutral voltage of an AC source (an outlet). A separate param from the
  // DC `voltage`, so every param keeps one unit.
  acVoltage: { unit: 'VAC', valid: (v) => v >= 1 && v <= 1000, range: 'from 1 to 1000' },
  // A fuse's rating. Optional: a fuse holder leaves the default out, so the rating is unknown until
  // the user sets it (a missing rating is never guessed).
  fuseRating: { unit: 'A', valid: (v) => v > 0 && v <= 100, range: 'above 0, up to 100', optional: true },
}
```

In the params loop of `validateModule` (line 272) replace the default check:

```ts
        if (!(rule.optional && p.default === undefined) && !validParamValue(name, p.default))
          errors.push(`${at}.default: must be ${rule.range}${rule.optional ? ', or left out' : ''}`)
```

After the params block, add the settings check:

```ts
  // Enumerated part choices (a fuse holder's fitted or absent fuse); the first choice is the default.
  if (isObj(raw.electrical) && raw.electrical.settings !== undefined) {
    const s = raw.electrical.settings
    if (!isObj(s)) errors.push('electrical.settings: must be an object of setting name to a list of choices')
    else
      for (const [k, v] of Object.entries(s))
        if (!Array.isArray(v) || v.length < 2 || v.some((c) => typeof c !== 'string' || c === '') || new Set(v).size !== v.length)
          errors.push(`electrical.settings.${k}: must be a list of 2 or more different choices, the first the default`)
  }
```

At the end of `module.ts` add:

```ts
/** A module's enumerated part settings (`electrical.settings`): each name with its choices, the first the default. */
export function moduleSettings(m: ModuleDef): Record<string, string[]> {
  const e = m.electrical
  if (!isObj(e) || !isObj(e.settings)) return {}
  return Object.fromEntries(
    Object.entries(e.settings).filter((x): x is [string, string[]] => Array.isArray(x[1]) && x[1].length > 1 && x[1].every((c) => typeof c === 'string')),
  )
}

/** A part's choice for one setting: its stored choice when the module offers it, else the module's first choice; null when the module has no such setting. */
export function partSetting(part: { settings?: Record<string, string> }, m: ModuleDef, name: string): string | null {
  const choices = moduleSettings(m)[name]
  if (!choices) return null
  const stored = part.settings?.[name]
  return stored !== undefined && choices.includes(stored) ? stored : choices[0]
}
```

In `src/format/values.ts` change `UNIT_SYMBOLS` (line 10) to `{ ohm: OHM, F: 'F', V: 'V', VAC: 'VAC', A: 'A' }` and add a case to `matchesUnit` before the final return:

```ts
  if (unit === 'VAC') return low === 'v' || low === 'vac'
```

Add after `partValue`:

```ts
/**
 * Every editable param the module declares in its own unit, in PARAM_RULES order, with its default:
 * null for an optional param left without one (a fuse holder's rating, unknown until set).
 */
export function editableParams(m: ModuleDef): { name: string; unit: string; default: number | null }[] {
  const e = m.electrical
  if (!isObj(e) || !isObj(e.params)) return []
  const out: { name: string; unit: string; default: number | null }[] = []
  for (const name of PRIMARY_PARAM_NAMES) {
    const p = e.params[name]
    if (!isObj(p) || p.unit !== PARAM_RULES[name].unit) continue
    if (validParamValue(name, p.default)) out.push({ name, unit: p.unit, default: p.default })
    else if (PARAM_RULES[name].optional && p.default === undefined) out.push({ name, unit: p.unit, default: null })
  }
  return out
}

/** A part's value for one named param: its valid stored override, else the module default; null when neither exists. */
export function paramValue(part: { values?: Record<string, unknown> }, m: ModuleDef, name: string): number | null {
  const p = editableParams(m).find((x) => x.name === name)
  if (!p) return null
  const stored = part.values?.[name]
  if (isObj(stored) && stored.unit === p.unit && validParamValue(name, stored.value)) return stored.value
  return p.default
}
```

In `src/format/diagram.ts` add to `PartInstance`:

```ts
  /** Enumerated choices from the module's `electrical.settings` (a fuse holder's "fitted" or "absent"). */
  settings?: Record<string, string>
```

Import `moduleSettings` from `./module.ts`, and inside the parts loop of `validateDiagram`, after the `values` block, add:

```ts
      if (p.settings !== undefined) {
        const who = typeof p.designator === 'string' && p.designator !== '' ? p.designator : `part ${i}`
        const m = typeof p.module === 'string' ? modules.get(p.module) : undefined
        if (!isObj(p.settings)) {
          fix(i, { settings: undefined })
          warnings.push(`${at}.settings: must be an object of setting name to choice, so it was dropped and the defaults are used`)
        } else {
          const offered = m ? moduleSettings(m) : null
          const kept: Record<string, string> = {}
          let changed = false
          for (const [key, value] of Object.entries(p.settings)) {
            const choices = offered && Object.hasOwn(offered, key) ? offered[key] : null
            if (offered && !choices) {
              changed = true
              warnings.push(`${at}.settings.${key}: ${who} has no setting "${key}", so it was dropped`)
            } else if (typeof value !== 'string' || (choices && !choices.includes(value))) {
              changed = true
              const allowed = choices ? choices.map((c) => `"${c}"`).join(' or ') : 'a string'
              warnings.push(`${at}.settings.${key}: ${who} has ${key} ${JSON.stringify(value)}, but it must be ${allowed}; it was dropped${choices ? ` and the default "${choices[0]}" is used` : ''}`)
            } else kept[key] = value
          }
          if (changed) fix(i, { settings: Object.keys(kept).length ? kept : undefined })
        }
      }
```

In `src/editor/ops.ts` import `moduleSettings`, `partSetting` from `../format/module.ts` and `editableParams`, `paramValue` from `../format/values.ts`; replace `updatePartValue` and add the two new edits:

```ts
export function updatePartValue(d: Diagram, uid: string, param: string, value: number, unit: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return d
  if (paramValue(part, m, param) === value && editableParams(m).some((p) => p.name === param && p.unit === unit)) return d
  const values = { ...part.values, [param]: { value, unit } }
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, values } : p)) }
}

/** Removes a part's stored value for `param`, back to the module default (unknown for an optional param). Same diagram when none is stored. */
export function clearPartValue(d: Diagram, uid: string, param: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part?.values || !Object.hasOwn(part.values, param)) return d
  const { [param]: _gone, ...rest } = part.values
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { values: _old, ...q } = p
      return Object.keys(rest).length ? { ...q, values: rest } : q
    }),
  }
}

/** Sets one of a part's enumerated settings. Same diagram when the choice is not offered or is already in effect. */
export function updatePartSetting(d: Diagram, uid: string, name: string, choice: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || !moduleSettings(m)[name]?.includes(choice) || partSetting(part, m, name) === choice) return d
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, settings: { ...p.settings, [name]: choice } } : p)) }
}
```

In `src/editor/Inspector.tsx`: extend `VALUE_LABELS` with `acVoltage: 'Mains voltage', fuseRating: 'Fuse rating'`; let `ValueInput` take `value: number | null` and an `id` prop, show an empty field with `placeholder="Unknown"` for null, and commit an emptied field through a new `onClear` prop:

```tsx
function ValueInput({ id, label, unit, value, onCommit, onClear }: { id: string; label: string; unit: string; value: number | null; onCommit: (v: number) => void; onClear?: () => void }) {
  const [invalid, setInvalid] = useState(false)
  const shown = value === null ? '' : formatValue(value, unit)
  const list = VALUE_LISTS[unit] ?? []
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        defaultValue={shown}
        placeholder={value === null ? 'Unknown' : undefined}
        list={list.length ? `${id}-options` : undefined}
        aria-invalid={invalid || undefined}
        onBlur={(e) => {
          if (e.target.value === shown) return
          if (e.target.value.trim() === '' && onClear) {
            setInvalid(false)
            onClear()
            return
          }
          const parsed = parseValue(e.target.value, unit)
          if (parsed === null) {
            setInvalid(true)
            e.target.value = shown
            return
          }
          setInvalid(false)
          onCommit(parsed)
          e.target.value = shown
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {list.length > 0 && (
        <datalist id={`${id}-options`}>
          {list.map((v) => (
            <option key={v} value={formatValue(v, unit)} />
          ))}
        </datalist>
      )}
      {invalid && <p className="hint" role="status">{unit === 'A' ? 'Use a rating like 2, 500m or 13 (amps), or leave it empty if unknown' : unit === 'VAC' ? 'Use a voltage like 120 or 230' : 'Use a value like 4.7k, 220 or 100n'}</p>}
    </label>
  )
}
```

In the part panel replace the single `pp && resolved && <ValueInput ...>` with one field per editable param and one select per setting (import `editableParams`, `paramValue` from values, `moduleSettings`, `partSetting` from module, and `updatePartSetting`, `clearPartValue` from ops; `partValue`/`primaryParam` imports can go if unused):

```tsx
        {m && editableParams(m).map((pp, i) => {
          const v = paramValue(part, m, pp.name)
          return (
            <ValueInput
              key={`${part.uid}:${pp.name}:${v}`}
              id={i === 0 ? 'part-value' : `part-value-${pp.name}`}
              label={VALUE_LABELS[pp.name] ?? pp.name}
              unit={pp.unit}
              value={v}
              onCommit={(x) => store.commit(updatePartValue(diagram, part.uid, pp.name, x, pp.unit))}
              onClear={pp.default === null ? () => store.commit(clearPartValue(diagram, part.uid, pp.name)) : undefined}
            />
          )
        })}
        {m && Object.entries(moduleSettings(m)).map(([name, choices]) => (
          <label key={name} className="field" htmlFor={`part-setting-${name}`}>
            {SETTING_LABELS[name] ?? name}
            <select id={`part-setting-${name}`} value={partSetting(part, m, name) ?? choices[0]} onChange={(e) => store.commit(updatePartSetting(diagram, part.uid, name, e.target.value))}>
              {choices.map((c) => <option key={c} value={c}>{CHOICE_LABELS[c] ?? c}</option>)}
            </select>
          </label>
        ))}
```

with, next to `VALUE_LABELS`:

```ts
const SETTING_LABELS: Record<string, string> = { fuse: 'Fuse' }
const CHOICE_LABELS: Record<string, string> = { fitted: 'Fitted', absent: 'Absent (empty holder)' }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/module.test.ts src/format/values.test.ts src/format/diagram.test.ts src/editor/ops.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`, and `npm run build`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/module.ts src/format/values.ts src/format/diagram.ts src/editor/ops.ts src/editor/Inspector.tsx src/format/module.test.ts src/format/values.test.ts src/format/diagram.test.ts src/editor/ops.test.ts
git commit -m "Mains: acVoltage and fuseRating params, part settings" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mains module fields and their validation

**Files:**
- Create: `src/format/mainsModel.ts`
- Modify: `src/format/module.ts` (PinDef, HoleGroup, pin and hole checks, internal nodes, call `validateMains`, plug contacts inside the body)
- Test: `src/format/mainsModel.test.ts`

**Interfaces:**
- Consumes: `isObj`, `isNum`, `GRID`, `ModuleDef`, `PinDef`, `HoleGroup`, `isSpacer` from `module.ts`; `moduleSettings` (Task 1).
- Produces (all in `src/format/mainsModel.ts`):
  - Constants and types: `CONDUCTORS` / `Conductor` (`'L' | 'N' | 'PE'`), `REQUIREMENTS` / `Requirement` (`'L' | 'N' | 'PE' | 'line'`), `REGIONS` / `Region` (`'us' | 'jp' | 'eu' | 'uk' | 'au'`), `PLUG_FAMILIES` / `PlugFamily`, `SOCKET_FAMILIES` / `SocketFamily`, `ISOLATIONS` / `Isolation`, `CONTACT_KINDS` / `ContactKind`, `DOMAIN_KINDS` / `DomainKind`.
  - Interfaces: `AcSource`, `Conducts`, `Protective`, `Domain`, `AcInput`, `Rating`, `Pole`, `ContactGroup`, `PlugContact`, `PlugProfile`, `PlugDef`, `SocketContact`, `SocketDef`, `MainsInfo` (fields below).
  - `claimInternalNodes(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void`
  - `validateMains(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void`
  - `mainsOf(m: ModuleDef): MainsInfo` (cached per module object)
  - `isolationAdequate(info: MainsInfo): boolean`
  - `uncoveredPins(m: ModuleDef, info: MainsInfo): string[]` (a converter's pins and hole groups in no domain and not declared for mains: Resolution 27)
  - `PinDef.mains?: Requirement`, `PinDef.bond?: 'pe'`, the same on `HoleGroup`.

`MainsInfo`:

```ts
export interface MainsInfo {
  /** True when the module declares any mains data at all. */
  any: boolean
  internalNodes: string[]
  acSources: AcSource[]
  region: Region | null
  hz: number | null
  conducts: Conducts[]
  protective: Protective[]
  domains: Domain[]
  domainOf: Map<string, Domain>
  isolation: Isolation | null
  isolationProvenance: 'datasheet' | 'unverified'
  safeguard: 'protective-screen' | null
  acInput: AcInput | null
  ratings: Rating[]
  contacts: ContactGroup[]
  /** Terminals named in any contact pole. */
  contactTerminals: Set<string>
  protection: 'class-1' | 'class-2' | null
  plug: PlugDef | null
  sockets: SocketDef[]
  requirement: Map<string, Requirement>
  bonds: Set<string>
  /** Every terminal the module declares for mains (spec 1.4): named in a source, conduction, fuse, mains domain, AC input, contact, plug, socket or rating, or carrying a requirement. */
  terminals: Set<string>
  /** Terminals whose conduction the module declares (spec 1.2); a mains terminal outside this set is treated conservatively. */
  declaredConduction: Set<string>
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsModel.test.ts`:

```ts
// The mains fields of the module format (spec sections 1 and 2): every field validated with the
// exact path of each problem, and `mainsOf` reading a valid module.
import { describe, expect, it } from 'vitest'
import { validateModule } from './module.ts'
import { isolationAdequate, mainsOf, uncoveredPins } from './mainsModel.ts'

const base = { format: 'circuitoon-module/1', id: 'thing', name: 'Thing' }
const errs = (raw: unknown) => {
  const r = validateModule(raw)
  return r.ok ? [] : r.errors
}
const two = [{ name: 'A', side: 'left' }, { name: 'B', side: 'right' }]

describe('mains fields: validation', () => {
  it('accepts an outlet: a board with sockets, a source, a voltage and a region', () => {
    expect(errs({
      ...base, pins: [], size: { w: 6, h: 6 }, obstacle: false,
      holes: [{ name: 'N', at: [[20, 20]] }, { name: 'L', at: [[40, 20]] }, { name: 'PE', at: [[30, 40]] }],
      electrical: {
        params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
        acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
        sockets: [{ id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
      },
    })).toEqual([])
  })
  it('names each problem in acSources, ac and sockets', () => {
    expect(errs({
      ...base, pins: two,
      electrical: {
        acSources: [{ id: 's', live: ['X'], neutral: [] }],
        ac: { hz: 0, region: 'mars' },
        sockets: [{ id: 'a', family: 'nema-9', contacts: [{ group: 'A', role: 'L' }] }],
      },
    })).toEqual([
      'electrical.acSources[0].live[0]: no pin, hole group or internal node named "X"',
      'electrical.acSources[0].neutral: must be a list of 1 or more terminal names',
      'electrical.acSources: needs an acVoltage param (electrical.params.acVoltage), the source voltage',
      'electrical.ac: must be { "hz": <above 0>, "region": one of "us", "jp", "eu", "uk", "au" }',
      'electrical.sockets: only a board (hole groups and "obstacle": false) has sockets',
      'electrical.sockets[0].family: must be one of "nema-5-15r", "nema-5-20r", "nema-1-15r", "nema-1-15r-polarized", "cee7-3", "cee7-5", "cee7-16", "bs1363", "as3112"',
      'electrical.sockets[0].contacts[0].group: no hole group named "A"',
      'electrical.sockets[0].contacts: needs an L and an N contact',
    ])
  })
  it('names each problem in conducts, protective, domains, isolation, acInput and ratings', () => {
    expect(errs({
      ...base, pins: two,
      electrical: {
        conducts: [{ pins: ['A', 'A'], kind: 'wire' }],
        protective: [{ from: 'A', to: 'C', kind: 'breaker', rating: 0 }],
        domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['A'], kind: 'lv' }],
        isolation: 'good', safeguard: 'glue',
        acInput: { a: 'A', b: 'A', range: [240, 100] },
        ratings: [{ pins: ['A'], kind: 'contact', service: 'rf', volts: -1, provenance: 'guess' }],
      },
    })).toEqual([
      'electrical.conducts[0].pins: must be two different terminal names',
      'electrical.conducts[0].kind: must be "load" or "leakage"',
      'electrical.protective[0].to: no pin, hole group or internal node named "C"',
      'electrical.protective[0].kind: must be "fuse"',
      'electrical.protective[0].rating: must be a number of amps, above 0, up to 100',
      'electrical.domains[1].kind: must be "mains", "selv" or "pelv"',
      'electrical.domains[1].pins: "A" is already in domain "m"',
      'electrical.isolation: must be one of "reinforced", "double", "basic", "none", "unknown"',
      'electrical.safeguard: must be "protective-screen"',
      'electrical.acInput: a and b must differ',
      'electrical.acInput.range: must be [min, max] in volts AC, from 1 to 1000, min not above max',
      'electrical.ratings[0].kind: must be "insulation", "terminal" or "switching"',
      'electrical.ratings[0].service: must be "ac", "dc" or "ac/dc"',
      'electrical.ratings[0].volts: must be a number above 0',
      'electrical.ratings[0].provenance: must be "datasheet" or "unverified"',
    ])
  })
  it('names each problem in contacts, protection, plug, pin requirements and internal nodes', () => {
    expect(errs({
      ...base, pins: [{ name: 'A', side: 'left', mains: 'hot', bond: 'earth' }, { name: 'B', side: 'right' }],
      electrical: {
        internalNodes: ['B', 'L prong'],
        contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: 'A', nc: 'B' }] }, { id: 'k', kind: 'valve', poles: [] }],
        protection: 'class-1',
        plug: { family: 'nema-5-15p', profiles: [{ id: 'main', contacts: [{ pin: 'A', at: { x: 5, y: 0 }, mains: 'line' }] }] },
      },
    })).toEqual([
      'pins[0].mains: must be one of "L", "N", "PE", "line"',
      'pins[0].bond: must be "pe"',
      'electrical.internalNodes[0]: duplicate name "B" (pins, hole groups and internal nodes share one namespace)',
      'electrical.contacts[0].poles[0]: an SSR pole has "no" only (its OFF state is a leakage path)',
      'electrical.contacts[1].id: duplicate "k"',
      'electrical.contacts[1].kind: must be "switch", "relay" or "ssr"',
      'electrical.contacts[1].poles: must be a list of 1 or more { "com", "no"?, "nc"? }',
      'electrical.protection: a class 1 part needs a terminal marked "mains": "PE"',
      'electrical.plug.profiles[0].contacts[0].pin: must name an internal node (electrical.internalNodes), the prong',
      'electrical.plug.profiles[0].contacts[0].at: must be { "x", "y" } on the 10 px grid',
      'electrical.plug.profiles[0].contacts[0].mains: must be "L", "N" or "PE"',
    ])
  })
  it('keeps plug contacts inside the body', () => {
    expect(errs({
      ...base, pins: two, size: { w: 4, h: 4 },
      electrical: { internalNodes: ['L prong'], plug: { family: 'nema-1-15p', profiles: [{ id: 'main', contacts: [{ pin: 'L prong', at: { x: 90, y: 10 }, mains: 'L' }] }] } },
    })).toEqual(['electrical.plug.profiles[0].contacts[0].at: outside the body (0 to 40, 0 to 40)'])
  })
})

describe('mainsOf', () => {
  it('reads a converter: its input, domains, isolation and which terminals are declared', () => {
    const m = validateModule({
      ...base, pins: [{ name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' }, { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' }],
      electrical: {
        acInput: { a: 'AC1', b: 'AC2', range: [100, 240] },
        domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }, { name: 'out', pins: ['+V', '-V'], kind: 'selv' }],
        isolation: 'reinforced', protection: 'class-2',
      },
    })
    if (!m.ok) throw new Error(m.errors.join('; '))
    const info = mainsOf(m.module)
    expect(info.any).toBe(true)
    expect(info.acInput).toEqual({ a: 'AC1', b: 'AC2', range: [100, 240] })
    expect([...info.terminals].sort()).toEqual(['AC1', 'AC2'])
    expect([...info.declaredConduction].sort()).toEqual(['AC1', 'AC2'])
    expect(info.domainOf.get('+V')?.kind).toBe('selv')
    expect(isolationAdequate(info)).toBe(true)
    expect(mainsOf(m.module)).toBe(info)
  })
  it('counts basic isolation as protective separation only with a protective screen', () => {
    const info = (isolation: string, safeguard?: string) => {
      const r = validateModule({ ...base, pins: two, electrical: { domains: [{ name: 'm', pins: ['A'], kind: 'mains' }, { name: 'o', pins: ['B'], kind: 'selv' }], isolation, ...(safeguard ? { safeguard } : {}) } })
      if (!r.ok) throw new Error(r.errors.join('; '))
      return isolationAdequate(mainsOf(r.module))
    }
    expect(info('double')).toBe(true)
    expect(info('basic')).toBe(false)
    expect(info('basic', 'protective-screen')).toBe(true)
    expect(info('unknown')).toBe(false)
  })
  it('names the pins a converter leaves outside every domain', () => {
    const r = validateModule({
      ...base, pins: [{ name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' }, { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' }],
      electrical: { acInput: { a: 'AC1', b: 'AC2', range: [100, 240] }, domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }], isolation: 'reinforced' },
    })
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(uncoveredPins(r.module, mainsOf(r.module))).toEqual(['+V', '-V'])
  })
  it('says a module with no mains data has none', () => {
    const r = validateModule({ ...base, pins: two })
    if (!r.ok) throw new Error('invalid')
    expect(mainsOf(r.module).any).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsModel.test.ts`
Expected: FAIL (`./mainsModel.ts` does not exist).

- [ ] **Step 3: Implement `src/format/mainsModel.ts`**

```ts
// Mains data on a module (spec docs/superpowers/specs/2026-09-27-mains-outlets-design.md, sections
// 1 and 2): AC sources, how mains terminals conduct, isolation domains, ratings, contact groups,
// earth, protective devices, plug profiles and sockets. Validation lives here (validateModule calls
// it) and so does `mainsOf`, the parsed view every mains check reads. Pure.
import { GRID, type ModuleDef, isNum, isObj } from './module.ts'

export const CONDUCTORS = ['L', 'N', 'PE'] as const
export type Conductor = (typeof CONDUCTORS)[number]
export const REQUIREMENTS = ['L', 'N', 'PE', 'line'] as const
export type Requirement = (typeof REQUIREMENTS)[number]
export const REGIONS = ['us', 'jp', 'eu', 'uk', 'au'] as const
export type Region = (typeof REGIONS)[number]
export const PLUG_FAMILIES = ['nema-5-15p', 'nema-1-15p', 'nema-1-15p-polarized', 'cee7-7', 'cee7-16', 'bs1363', 'as3112'] as const
export type PlugFamily = (typeof PLUG_FAMILIES)[number]
export const SOCKET_FAMILIES = ['nema-5-15r', 'nema-5-20r', 'nema-1-15r', 'nema-1-15r-polarized', 'cee7-3', 'cee7-5', 'cee7-16', 'bs1363', 'as3112'] as const
export type SocketFamily = (typeof SOCKET_FAMILIES)[number]
export const ISOLATIONS = ['reinforced', 'double', 'basic', 'none', 'unknown'] as const
export type Isolation = (typeof ISOLATIONS)[number]
export const CONTACT_KINDS = ['switch', 'relay', 'ssr'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]
export const DOMAIN_KINDS = ['mains', 'selv', 'pelv'] as const
export type DomainKind = (typeof DOMAIN_KINDS)[number]
const RATING_KINDS = ['insulation', 'terminal', 'switching'] as const
const SERVICES = ['ac', 'dc', 'ac/dc'] as const
const PROVENANCES = ['datasheet', 'unverified'] as const

export interface AcSource { id: string; live: string[]; neutral: string[]; earth: string[] }
export interface Conducts { pins: [string, string]; kind: 'load' | 'leakage'; range: [number, number] | null }
export interface Protective { from: string; to: string; kind: 'fuse'; rating: number | null }
export interface Domain { name: string; pins: string[]; kind: DomainKind }
export interface AcInput { a: string; b: string; range: [number, number] }
export interface Rating {
  pins: string[]
  kind: (typeof RATING_KINDS)[number]
  service: (typeof SERVICES)[number]
  volts: number
  amps: number | null
  provenance: (typeof PROVENANCES)[number]
  conditions: string | null
}
export interface Pole { com: string; no: string | null; nc: string | null }
export interface ContactGroup { id: string; kind: ContactKind; poles: Pole[] }
export interface PlugContact { pin: string; at: { x: number; y: number }; mains: Conductor }
export interface PlugProfile { id: string; contacts: PlugContact[] }
export interface PlugDef { family: PlugFamily; profiles: PlugProfile[] }
export interface SocketContact { group: string; role: Conductor }
export interface SocketDef { id: string; family: SocketFamily; contacts: SocketContact[] }

// (MainsInfo exactly as in this task's Interfaces block.)

const isStr = (v: unknown): v is string => typeof v === 'string' && v !== ''
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const words = (list: readonly string[]) => list.map((x) => `"${x}"`).join(', ')

/** `electrical.internalNodes`: named terminals inside the part (a plug's prongs), added to `names`. */
export function claimInternalNodes(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el) || el.internalNodes === undefined) return
  if (!Array.isArray(el.internalNodes)) return void errors.push('electrical.internalNodes: must be a list of names')
  el.internalNodes.forEach((n, i) => {
    if (!isStr(n)) errors.push(`electrical.internalNodes[${i}]: must be a name`)
    else if (names.has(n)) errors.push(`electrical.internalNodes[${i}]: duplicate name "${n}" (pins, hole groups and internal nodes share one namespace)`)
    else names.add(n)
  })
}

/** Checks every mains field of `electrical` against `names` (pins, hole groups and internal nodes). */
export function validateMains(raw: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  const el = raw.electrical
  if (!isObj(el)) return
  const nodes = new Set(Array.isArray(el.internalNodes) ? el.internalNodes.filter(isStr) : [])
  const term = (v: unknown, at: string) => {
    if (!isStr(v) || !names.has(v)) errors.push(`${at}: no pin, hole group or internal node named "${String(v)}"`)
  }
  const termList = (v: unknown, at: string) => {
    if (!Array.isArray(v) || v.length === 0) return void errors.push(`${at}: must be a list of 1 or more terminal names`)
    v.forEach((n, i) => term(n, `${at}[${i}]`))
  }
  const acRange = (v: unknown, at: string) => {
    if (!(Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] >= 1 && v[0] <= v[1] && v[1] <= 1000))
      errors.push(`${at}: must be [min, max] in volts AC, from 1 to 1000, min not above max`)
  }
  const each = (key: string, check: (x: Record<string, unknown>, at: string) => void) => {
    const v = el[key]
    if (v === undefined) return
    if (!Array.isArray(v)) return void errors.push(`electrical.${key}: must be a list`)
    v.forEach((x, i) => (isObj(x) ? check(x, `electrical.${key}[${i}]`) : errors.push(`electrical.${key}[${i}]: must be an object`)))
  }
  const named = (seen: Set<string>, v: unknown, at: string) => {
    if (!isStr(v)) errors.push(`${at}: required, a name`)
    else if (seen.has(v)) errors.push(`${at}: duplicate "${v}"`)
    else seen.add(v)
  }

  const sourceIds = new Set<string>()
  each('acSources', (s, at) => {
    named(sourceIds, s.id, `${at}.id`)
    termList(s.live, `${at}.live`)
    termList(s.neutral, `${at}.neutral`)
    if (s.earth !== undefined) termList(s.earth, `${at}.earth`)
  })
  if (Array.isArray(el.acSources) && el.acSources.length) {
    if (!(isObj(el.params) && isObj(el.params.acVoltage))) errors.push('electrical.acSources: needs an acVoltage param (electrical.params.acVoltage), the source voltage')
    if (el.ac === undefined) errors.push('electrical.ac: required with acSources ({ "hz", "region" })')
  }
  if (el.ac !== undefined && !(isObj(el.ac) && isNum(el.ac.hz) && el.ac.hz > 0 && oneOf(REGIONS, el.ac.region)))
    errors.push(`electrical.ac: must be { "hz": <above 0>, "region": one of ${words(REGIONS)} }`)

  each('conducts', (c, at) => {
    if (!(Array.isArray(c.pins) && c.pins.length === 2 && c.pins[0] !== c.pins[1])) errors.push(`${at}.pins: must be two different terminal names`)
    else c.pins.forEach((n, i) => term(n, `${at}.pins[${i}]`))
    if (c.kind !== 'load' && c.kind !== 'leakage') errors.push(`${at}.kind: must be "load" or "leakage"`)
    if (c.range !== undefined) acRange(c.range, `${at}.range`)
  })

  each('protective', (e, at) => {
    term(e.from, `${at}.from`)
    term(e.to, `${at}.to`)
    if (isStr(e.from) && e.from === e.to) errors.push(`${at}: from and to must differ`)
    if (e.kind !== 'fuse') errors.push(`${at}.kind: must be "fuse"`)
    if (e.rating !== undefined && !(isNum(e.rating) && e.rating > 0 && e.rating <= 100)) errors.push(`${at}.rating: must be a number of amps, above 0, up to 100`)
  })

  const domainNames = new Set<string>()
  const inDomain = new Map<string, string>()
  each('domains', (x, at) => {
    named(domainNames, x.name, `${at}.name`)
    if (!oneOf(DOMAIN_KINDS, x.kind)) errors.push(`${at}.kind: must be "mains", "selv" or "pelv"`)
    termList(x.pins, `${at}.pins`)
    if (Array.isArray(x.pins))
      for (const n of x.pins) {
        if (!isStr(n)) continue
        if (inDomain.has(n)) errors.push(`${at}.pins: "${n}" is already in domain "${inDomain.get(n)}"`)
        else inDomain.set(n, String(x.name))
      }
  })
  if (el.isolation !== undefined && !oneOf(ISOLATIONS, el.isolation)) errors.push(`electrical.isolation: must be one of ${words(ISOLATIONS)}`)
  if (el.isolationProvenance !== undefined && !oneOf(PROVENANCES, el.isolationProvenance)) errors.push('electrical.isolationProvenance: must be "datasheet" or "unverified"')
  if (el.safeguard !== undefined && el.safeguard !== 'protective-screen') errors.push('electrical.safeguard: must be "protective-screen"')

  if (el.acInput !== undefined) {
    const a = el.acInput
    if (!isObj(a)) errors.push('electrical.acInput: must be { "a", "b", "range": [min, max] }')
    else {
      term(a.a, 'electrical.acInput.a')
      term(a.b, 'electrical.acInput.b')
      if (isStr(a.a) && a.a === a.b) errors.push('electrical.acInput: a and b must differ')
      acRange(a.range, 'electrical.acInput.range')
    }
  }

  each('ratings', (r, at) => {
    termList(r.pins, `${at}.pins`)
    if (!oneOf(RATING_KINDS, r.kind)) errors.push(`${at}.kind: must be "insulation", "terminal" or "switching"`)
    if (!oneOf(SERVICES, r.service)) errors.push(`${at}.service: must be "ac", "dc" or "ac/dc"`)
    if (!(isNum(r.volts) && r.volts > 0)) errors.push(`${at}.volts: must be a number above 0`)
    if (r.amps !== undefined && !(isNum(r.amps) && r.amps > 0)) errors.push(`${at}.amps: must be a number above 0`)
    if (!oneOf(PROVENANCES, r.provenance)) errors.push(`${at}.provenance: must be "datasheet" or "unverified"`)
    if (r.conditions !== undefined && !isStr(r.conditions)) errors.push(`${at}.conditions: must be a non-empty string`)
  })

  const contactIds = new Set<string>()
  each('contacts', (c, at) => {
    named(contactIds, c.id, `${at}.id`)
    if (!oneOf(CONTACT_KINDS, c.kind)) errors.push(`${at}.kind: must be "switch", "relay" or "ssr"`)
    if (!Array.isArray(c.poles) || !c.poles.length) return void errors.push(`${at}.poles: must be a list of 1 or more { "com", "no"?, "nc"? }`)
    c.poles.forEach((pole, j) => {
      const pat = `${at}.poles[${j}]`
      if (!isObj(pole)) return void errors.push(`${pat}: must be an object`)
      term(pole.com, `${pat}.com`)
      if (pole.no !== undefined) term(pole.no, `${pat}.no`)
      if (pole.nc !== undefined) term(pole.nc, `${pat}.nc`)
      if (pole.no === undefined && pole.nc === undefined) errors.push(`${pat}: needs "no", "nc" or both`)
      else if (c.kind === 'ssr' && (pole.no === undefined || pole.nc !== undefined)) errors.push(`${pat}: an SSR pole has "no" only (its OFF state is a leakage path)`)
    })
  })

  if (el.protection !== undefined) {
    const pe = [...(Array.isArray(raw.pins) ? raw.pins : []), ...(Array.isArray(raw.holes) ? raw.holes : [])].some((p) => isObj(p) && p.mains === 'PE')
    if (el.protection !== 'class-1' && el.protection !== 'class-2') errors.push('electrical.protection: must be "class-1" or "class-2"')
    else if (el.protection === 'class-1' && !pe) errors.push('electrical.protection: a class 1 part needs a terminal marked "mains": "PE"')
  }

  if (el.plug !== undefined) {
    const p = el.plug
    if (!isObj(p)) errors.push('electrical.plug: must be { "family", "profiles": [...] }')
    else {
      if (!oneOf(PLUG_FAMILIES, p.family)) errors.push(`electrical.plug.family: must be one of ${words(PLUG_FAMILIES)}`)
      if (raw.obstacle === false) errors.push('electrical.plug: a plug-in device cannot be a board ("obstacle": false)')
      if (!Array.isArray(p.profiles) || !p.profiles.length) errors.push('electrical.plug.profiles: must be a list of 1 or more profiles')
      else {
        const seen = new Set<string>()
        p.profiles.forEach((pr, i) => {
          const at = `electrical.plug.profiles[${i}]`
          if (!isObj(pr)) return void errors.push(`${at}: must be an object`)
          named(seen, pr.id, `${at}.id`)
          if (!Array.isArray(pr.contacts) || !pr.contacts.length) return void errors.push(`${at}.contacts: must be a list of 1 or more contacts`)
          pr.contacts.forEach((c, j) => {
            const cat = `${at}.contacts[${j}]`
            if (!isObj(c)) return void errors.push(`${cat}: must be an object`)
            if (!isStr(c.pin) || !nodes.has(c.pin)) errors.push(`${cat}.pin: must name an internal node (electrical.internalNodes), the prong`)
            if (!(isObj(c.at) && isNum(c.at.x) && isNum(c.at.y) && c.at.x % GRID === 0 && c.at.y % GRID === 0)) errors.push(`${cat}.at: must be { "x", "y" } on the 10 px grid`)
            if (!oneOf(CONDUCTORS, c.mains)) errors.push(`${cat}.mains: must be "L", "N" or "PE"`)
          })
        })
      }
    }
  }

  if (el.sockets !== undefined) {
    const holes = (Array.isArray(raw.holes) ? raw.holes : []).filter(isObj).map((g) => g.name).filter(isStr)
    if (!(raw.obstacle === false && holes.length)) errors.push('electrical.sockets: only a board (hole groups and "obstacle": false) has sockets')
    const owner = new Map<string, string>()
    const ids = new Set<string>()
    each('sockets', (s, at) => {
      named(ids, s.id, `${at}.id`)
      if (!oneOf(SOCKET_FAMILIES, s.family)) errors.push(`${at}.family: must be one of ${words(SOCKET_FAMILIES)}`)
      if (!Array.isArray(s.contacts) || !s.contacts.length) return void errors.push(`${at}.contacts: must be a list of { "group", "role" }`)
      const roles = new Set<string>()
      s.contacts.forEach((c, j) => {
        const cat = `${at}.contacts[${j}]`
        if (!isObj(c)) return void errors.push(`${cat}: must be an object`)
        if (!isStr(c.group) || !holes.includes(c.group)) errors.push(`${cat}.group: no hole group named "${String(c.group)}"`)
        else if (owner.has(c.group)) errors.push(`${cat}.group: "${c.group}" already belongs to socket "${owner.get(c.group)}"`)
        else owner.set(c.group, String(s.id))
        if (!oneOf(CONDUCTORS, c.role)) errors.push(`${cat}.role: must be "L", "N" or "PE"`)
        else if (roles.has(c.role)) errors.push(`${cat}.role: this socket already has a ${c.role} contact`)
        else roles.add(c.role)
      })
      if (!roles.has('L') || !roles.has('N')) errors.push(`${at}.contacts: needs an L and an N contact`)
    })
    if (Array.isArray(el.sockets) && raw.obstacle === false)
      for (const h of holes) if (!owner.has(h)) errors.push(`holes: group "${h}" belongs to no socket (on an outlet every hole group is a socket contact)`)
  }
}

/** Protective separation (spec 1.3): reinforced or double isolation, or basic plus a declared protective screen. Earthing never substitutes for it. */
export function isolationAdequate(info: MainsInfo): boolean {
  return info.isolation === 'reinforced' || info.isolation === 'double' || (info.isolation === 'basic' && info.safeguard === 'protective-screen')
}

/** Pins and hole groups that no domain covers and the module does not declare for mains (Resolution 27: treated as live on a converter). */
export function uncoveredPins(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => ('name' in p && typeof p.name === 'string' ? [p.name] : [])), ...(m.holes ?? []).map((h) => h.name)]
    .filter((n) => !info.domainOf.has(n) && !info.terminals.has(n))
}

const cache = new WeakMap<ModuleDef, MainsInfo>()

/** The module's mains data, parsed once (modules are never mutated after load). Assumes a validated module. */
export function mainsOf(m: ModuleDef): MainsInfo {
  const hit = cache.get(m)
  if (hit) return hit
  const el: Record<string, unknown> = isObj(m.electrical) ? m.electrical : {}
  const list = (k: string) => (Array.isArray(el[k]) ? (el[k] as unknown[]).filter(isObj) : [])
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : [])
  const internalNodes = strs(el.internalNodes)
  const acSources = list('acSources').map((s) => ({ id: String(s.id), live: strs(s.live), neutral: strs(s.neutral), earth: strs(s.earth) }))
  const ac = isObj(el.ac) ? el.ac : null
  const conducts = list('conducts').map((c) => ({ pins: strs(c.pins) as [string, string], kind: c.kind as 'load' | 'leakage', range: Array.isArray(c.range) ? (c.range as [number, number]) : null }))
  const protective = list('protective').map((e) => ({ from: String(e.from), to: String(e.to), kind: 'fuse' as const, rating: isNum(e.rating) ? e.rating : null }))
  const domains = list('domains').map((x) => ({ name: String(x.name), pins: strs(x.pins), kind: x.kind as DomainKind }))
  const domainOf = new Map<string, Domain>()
  for (const x of domains) for (const p of x.pins) domainOf.set(p, x)
  const acInput = isObj(el.acInput) ? { a: String(el.acInput.a), b: String(el.acInput.b), range: el.acInput.range as [number, number] } : null
  const ratings = list('ratings').map((r) => ({
    pins: strs(r.pins), kind: r.kind as Rating['kind'], service: r.service as Rating['service'], volts: Number(r.volts),
    amps: isNum(r.amps) ? r.amps : null, provenance: r.provenance as Rating['provenance'], conditions: isStr(r.conditions) ? r.conditions : null,
  }))
  const contacts = list('contacts').map((c) => ({
    id: String(c.id), kind: c.kind as ContactKind,
    poles: (Array.isArray(c.poles) ? c.poles.filter(isObj) : []).map((p) => ({ com: String(p.com), no: isStr(p.no) ? p.no : null, nc: isStr(p.nc) ? p.nc : null })),
  }))
  const contactTerminals = new Set(contacts.flatMap((c) => c.poles.flatMap((p) => [p.com, p.no, p.nc].filter(isStr))))
  const plugRaw = isObj(el.plug) ? el.plug : null
  const plug = plugRaw
    ? {
        family: plugRaw.family as PlugFamily,
        profiles: (Array.isArray(plugRaw.profiles) ? plugRaw.profiles.filter(isObj) : []).map((pr) => ({
          id: String(pr.id),
          contacts: (Array.isArray(pr.contacts) ? pr.contacts.filter(isObj) : []).map((c) => ({ pin: String(c.pin), at: c.at as { x: number; y: number }, mains: c.mains as Conductor })),
        })),
      }
    : null
  const sockets = list('sockets').map((s) => ({
    id: String(s.id), family: s.family as SocketFamily,
    contacts: (Array.isArray(s.contacts) ? s.contacts.filter(isObj) : []).map((c) => ({ group: String(c.group), role: c.role as Conductor })),
  }))
  const requirement = new Map<string, Requirement>()
  const bonds = new Set<string>()
  for (const p of [...m.pins, ...(m.holes ?? [])]) {
    if (!('name' in p) || typeof p.name !== 'string') continue
    if (p.mains) requirement.set(p.name, p.mains)
    if (p.bond === 'pe') bonds.add(p.name)
  }
  const terminals = new Set<string>([
    ...acSources.flatMap((s) => [...s.live, ...s.neutral, ...s.earth]),
    ...conducts.flatMap((c) => c.pins), ...protective.flatMap((e) => [e.from, e.to]),
    ...domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins),
    ...(acInput ? [acInput.a, acInput.b] : []), ...contactTerminals,
    ...(plug ? plug.profiles.flatMap((pr) => pr.contacts.map((c) => c.pin)) : []),
    ...sockets.flatMap((s) => s.contacts.map((c) => c.group)),
    ...ratings.flatMap((r) => r.pins), ...requirement.keys(),
  ])
  // A domain other than mains is never "declared for mains": its pins are checked as SELV or PELV.
  for (const [p, x] of domainOf) if (x.kind !== 'mains') terminals.delete(p)
  const declaredConduction = new Set<string>([
    ...(m.internal ?? []).flat(), ...conducts.flatMap((c) => c.pins), ...protective.flatMap((e) => [e.from, e.to]), ...contactTerminals,
    ...(acInput ? [acInput.a, acInput.b] : []), ...acSources.flatMap((s) => [...s.live, ...s.neutral, ...s.earth]),
    ...sockets.flatMap((s) => s.contacts.map((c) => c.group)), ...(plug ? plug.profiles.flatMap((pr) => pr.contacts.map((c) => c.pin)) : []),
    // An earth terminal or a declared bond joins only the part's own metal.
    ...[...requirement].filter(([, r]) => r === 'PE').map(([p]) => p), ...bonds,
  ])
  const info: MainsInfo = {
    any: acSources.length > 0 || conducts.length > 0 || protective.length > 0 || domains.length > 0 || !!acInput || ratings.length > 0 ||
      contacts.length > 0 || el.protection !== undefined || !!plug || sockets.length > 0 || requirement.size > 0 || bonds.size > 0,
    internalNodes, acSources, region: ac && oneOf(REGIONS, ac.region) ? ac.region : null, hz: ac && isNum(ac.hz) ? ac.hz : null,
    conducts, protective, domains, domainOf,
    isolation: oneOf(ISOLATIONS, el.isolation) ? el.isolation : null,
    isolationProvenance: el.isolationProvenance === 'unverified' ? 'unverified' : 'datasheet',
    safeguard: el.safeguard === 'protective-screen' ? 'protective-screen' : null,
    acInput, ratings, contacts, contactTerminals,
    protection: el.protection === 'class-1' || el.protection === 'class-2' ? el.protection : null,
    plug, sockets, requirement, bonds, terminals, declaredConduction,
  }
  cache.set(m, info)
  return info
}
```

In `src/format/module.ts`:
- `import { REQUIREMENTS, type Requirement, claimInternalNodes, validateMains } from './mainsModel.ts'` (the circular import is safe: both sides only use each other inside functions).
- Add `mains?: Requirement` and `bond?: 'pe'` to `PinDef` and `HoleGroup`, with JSDoc "Terminal requirement (spec 1.2): drives polarity and earth rules only" and "An intentional bond to PE (a metal enclosure, a class 1 supply secondary)".
- Next to `checkType`, add and call for every pin and hole group:

```ts
  const checkMains = (t: Record<string, unknown>, at: string) => {
    if (t.mains !== undefined && !(REQUIREMENTS as readonly unknown[]).includes(t.mains)) errors.push(`${at}.mains: must be one of "L", "N", "PE", "line"`)
    if (t.bond !== undefined && t.bond !== 'pe') errors.push(`${at}.bond: must be "pe"`)
  }
```

- Right before the `internal` check call `claimInternalNodes(raw, names, errors)`, and right before `return` call `validateMains(raw, names, errors)`.
- Right after the `validateMains(raw, names, errors)` call (so only a plug whose fields are already valid is measured), add the plug contact body check:

```ts
  if (!errors.length && isObj(raw.electrical) && isObj(raw.electrical.plug) && Array.isArray(raw.electrical.plug.profiles)) {
    const lay = computeLayout(raw as unknown as ModuleDef)
    raw.electrical.plug.profiles.forEach((pr, i) =>
      (pr as { contacts: { at: { x: number; y: number } }[] }).contacts.forEach((c, j) => {
        if (c.at.x < 0 || c.at.y < 0 || c.at.x > lay.w || c.at.y > lay.h)
          errors.push(`electrical.plug.profiles[${i}].contacts[${j}].at: outside the body (0 to ${lay.w}, 0 to ${lay.h})`)
      }),
    )
  }
```

Note the ordering the tests expect: pin-level `mains`/`bond` errors come with the pins; `internalNodes` errors before `internal`; every other mains error after the existing checks, in the order `validateMains` runs them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsModel.test.ts src/format/module.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`, and `npm run validate`: PASS (no built-in module changes yet).

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsModel.ts src/format/mainsModel.test.ts src/format/module.ts
git commit -m "Mains: module fields for sources, conduction, domains, ratings, contacts, plugs and sockets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: The conduction graph: nets, typed edges, identity and energization

**Files:**
- Create: `src/format/words.ts`
- Modify: `src/format/checks.ts:114-121` and `:395-396` (move `orList`, `andList`, `natural` to `words.ts` and import them)
- Create: `src/format/mains.testing.ts`
- Create: `src/format/mainsGraph.ts`
- Test: `src/format/mainsGraph.test.ts`

**Interfaces:**
- Consumes: `mainsOf`, `isolationAdequate`, `Conductor`, `ContactGroup`, `MainsInfo`, `Region` (Task 2); `paramValue`, `partSetting` (Task 1); `Netlist`, `nodeKey` (`netlist.ts`); `Plug` (`breadboard.ts`).
- Produces (in `src/format/words.ts`): `natural: Intl.Collator`, `andList(items: string[]): string`, `orList(items: string[]): string`.
- Produces (in `src/format/mainsGraph.ts`):
  - `MAX_SOURCES = 10`, `bitOf(s: number, c: Conductor): number`, `L_MASK`, `N_MASK`, `PE_MASK`, `LN_MASK`, `decodeSingle(x: number): { s: number; c: Conductor }`.
  - `interface GTerm { key: string; part: PartInstance; module: ModuleDef; info: MainsInfo; name: string; label: string; type?: PinType }`, `termAt(g: MainsGraph, key: string): GTerm | null`, `termName(t: GTerm): string`.
  - `interface GSource { index: number; id: string; part: PartInstance; volts: number; region: Region | null; polarized: boolean; live: number[]; neutral: number[]; earth: number[]; keys: Record<Conductor, string[]> }` (`polarized` is false for an outlet whose L side no standard fixes: `nema-1-15r`, `cee7-3`, `cee7-16`; the polarity rule ignores such sources).
  - `interface GEdge { kind: 'protective' | 'load' | 'leakage' | 'energize'; a: number; b: number; part: PartInstance; names: [string, string]; directed: boolean; fitted: boolean; rating: number | null; why: 'isolation' | 'undeclared' | null }`.
  - `interface GGroup { part: PartInstance; def: ContactGroup; nodes: number[]; closed: [number, number][][]; leak: [number, number][][] }` (index 0 is released or off, 1 is energized or on).
  - `interface GConverter { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number]; outputs: string[]; plugIn: boolean }`.
  - `interface GLoad { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number] | null }`.
  - `interface MainsGraph { d: Diagram; n: number; members: string[][]; nodeOf: Map<string, number>; wires: string[][]; broken: Set<string>; sources: GSource[]; edges: GEdge[]; groups: GGroup[]; converters: GConverter[]; loads: GLoad[]; mainsParts: PartInstance[]; connected: Set<string>; termCache: Map<string, GTerm | null> }` (`broken`: uids of connections the netlist left out).
  - `buildMainsGraph(d: Diagram, plugs: Plug[], nl: Netlist): MainsGraph | null` (null when no part on the sheet has mains data).
  - `possibleRoots(g: MainsGraph): Int32Array` (component root per node with every edge and every contact position conducting).
  - `interface Prepared { g: MainsGraph; possible: Int32Array; relevant: Int32Array; inRel: Uint8Array; sources: GSource[]; groupIdx: number[]; loadIdx: number[]; converterIdx: number[]; protective: GEdge[]; energy: GEdge[]; base: Int32Array; bareBase: Int32Array; fitBase: Int32Array; anyAbsent: boolean; parent: Int32Array; bareParent: Int32Array; fitParent: Int32Array; root: Int32Array; bareRoot: Int32Array; fitRoot: Int32Array; ident: Uint32Array; power: Uint16Array; groupState: Int8Array; srcRoots: number[] }`. `relevant`, `inRel` and the index lists say what this analysis covers: `prepare` covers every relevant node; Task 4's views narrow them to one enumeration unit (Resolution 25), and every rule loops over these lists, never over `g.*` directly.
  - `prepare(g: MainsGraph): Prepared`, `analyseState(p: Prepared): void` (reads `p.groupState`; resets and fills only `p.relevant`: `root`, `bareRoot` (fuses removed), `fitRoot` (every fuse taken as fitted, only when a fuse is absent), `ident` and `power` at roots, and `srcRoots`).
  - `identAt(p: Prepared, node: number): number`, `powerAt(p: Prepared, node: number): number`, `hazardAt(p: Prepared, node: number): boolean`.
- Produces (in `src/format/mains.testing.ts`): fixture modules `t-outlet`, `t-outlet-2`, `t-outlet-eu`, `t-psu`, `t-psu-basic`, `t-psu-basic-bonded`, `t-psu-screen`, `t-psu-pelv`, `t-lamp`, `t-lamp-c1`, `t-switch`, `t-relay`, `t-ssr`, `t-fuse`, `t-term`, `t-term-125`, `t-term-dc`, `t-term-cond`, `t-term-bare`, `t-term-unverified`, `t-mcu`, `t-mcu33`, `t-undeclared`, `t-relay-2p` (two linked poles), `t-bat9` (a 9 V battery), `t-psu-mainsonly` (a converter that declares only its mains domain); `MAINS_MODULES`; helpers `at`, `w`, `dupont`, `sheet`.

- [ ] **Step 1: Move the word helpers out of `checks.ts`**

Create `src/format/words.ts`:

```ts
// Plain-words helpers shared by the wiring checker and the mains checks.

/** Natural order, so U2 sorts before U10. */
export const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** "A", "A or B", "A, B or C". */
export function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** "A", "A and B", "A, B and C". */
export function andList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
```

In `src/format/checks.ts` delete the local `orList`, `andList` and `natural` and add `import { andList, natural, orList } from './words.ts'`. Run `npm test`: PASS (a pure move).

- [ ] **Step 2: Write the fixtures**

Create `src/format/mains.testing.ts`:

```ts
// Synthetic mains modules for the checker tests: small, on the 10 px grid, each declaring only what
// its tests need. Not real parts (those come from scripts/gen-mains-*.mjs). Every one passes
// validateModule (checked in mainsGraph.test.ts). Contact patterns follow src/format/plugging.ts.
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'

const mod = (m: Omit<ModuleDef, 'format'>): ModuleDef => ({ format: 'circuitoon-module/1', ...m })
const ac = (pins: string[], volts: number, extra: Record<string, unknown> = {}) => ({ pins, kind: 'terminal', service: 'ac', volts, provenance: 'datasheet', ...extra })

/** A US outlet: a board whose NEMA 5-15R socket holes (centred on its pivot) are the source's L, N and PE. */
const usOutlet = (id: string, name: string) => mod({
  id, name, pins: [], size: { w: 6, h: 6 }, obstacle: false,
  holes: [{ name: 'N', at: [[20, 30]] }, { name: 'L', at: [[40, 30]] }, { name: 'PE', at: [[30, 50]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'nema-5-15r', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: [ac(['L', 'N', 'PE'], 125, { amps: 15 })],
  },
})
export const outlet = usOutlet('t-outlet', 'Test outlet (US)')
export const outlet2 = usOutlet('t-outlet-2', 'Second test outlet (US)')
/** A Schuko (CEE 7/3) outlet at 230 V: L and N pins, earth clips above and below. */
export const outletEU = mod({
  id: 't-outlet-eu', name: 'Test outlet (Schuko)', pins: [], size: { w: 8, h: 8 }, obstacle: false,
  holes: [{ name: 'L', at: [[20, 40]] }, { name: 'N', at: [[60, 40]] }, { name: 'PE', at: [[40, 10], [40, 70]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: 'eu' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'cee7-3', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: [ac(['L', 'N', 'PE'], 250, { amps: 16 })],
  },
})

const psuPins = [
  { name: 'AC1', side: 'left', mains: 'line' }, { name: 'AC2', side: 'left', mains: 'line' },
  { name: '+V', side: 'right', type: 'power_out', supply: '5V' }, { name: '-V', side: 'right', type: 'ground' },
] as ModuleDef['pins']
const psuInput = { acInput: { a: 'AC1', b: 'AC2', range: [100, 240] } }
const domains = (out: 'selv' | 'pelv') => [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }, { name: 'out', pins: ['+V', '-V'], kind: out }]
/** A class 1 supply: an earth pin, and its -V bonded to it. */
const earthedPins = [...psuPins.slice(0, 3), { name: '-V', side: 'right', type: 'ground', bond: 'pe' }, { name: 'PE', side: 'left', mains: 'PE' }] as ModuleDef['pins']
export const psu = mod({ id: 't-psu', name: 'Test AC-DC 5 V (reinforced)', pins: psuPins, electrical: { ...psuInput, domains: domains('selv'), isolation: 'reinforced', protection: 'class-2' } })
export const psuBasic = mod({ id: 't-psu-basic', name: 'Test AC-DC 5 V (basic)', pins: psuPins, electrical: { ...psuInput, domains: domains('selv'), isolation: 'basic', protection: 'class-2' } })
export const psuScreen = mod({ id: 't-psu-screen', name: 'Test AC-DC 5 V (basic plus screen, PELV)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'basic', safeguard: 'protective-screen', protection: 'class-1' } })
export const psuBasicBonded = mod({ id: 't-psu-basic-bonded', name: 'Test AC-DC 5 V (basic, earthed)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'basic', protection: 'class-1' } })
export const psuPelv = mod({ id: 't-psu-pelv', name: 'Test AC-DC 5 V (reinforced, PELV)', pins: earthedPins, internal: [['-V', 'PE']],
  electrical: { ...psuInput, domains: domains('pelv'), isolation: 'reinforced', protection: 'class-1' } })

const lampPins = [{ name: 'L', side: 'left', mains: 'L' }, { name: 'N', side: 'right', mains: 'N' }] as ModuleDef['pins']
/** A 120 V lamp holder: centre contact L, screw shell N. */
export const lamp = mod({ id: 't-lamp', name: 'Test lamp 120 V', pins: lampPins,
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [110, 130] }], protection: 'class-2', ratings: [ac(['L', 'N'], 250)] } })
export const lampC1 = mod({ id: 't-lamp-c1', name: 'Test class 1 lamp 120 V', pins: [...lampPins, { name: 'PE', side: 'bottom', mains: 'PE' }],
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [110, 130] }], protection: 'class-1', ratings: [ac(['L', 'N', 'PE'], 250)] } })

export const sw = mod({ id: 't-switch', name: 'Test switch', pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }],
  electrical: { contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }], ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: 250, amps: 6, provenance: 'datasheet' }] } })
export const relay = mod({ id: 't-relay', name: 'Test relay', pins: [
  { name: 'COM', side: 'left', type: 'passive' }, { name: 'NO', side: 'left', type: 'passive' }, { name: 'NC', side: 'left', type: 'passive' },
  { name: '+', side: 'right', type: 'power_in', supply: '5V' }, { name: '-', side: 'right', type: 'ground' },
], electrical: {
  contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }],
  domains: [{ name: 'contacts', pins: ['COM', 'NO', 'NC'], kind: 'mains' }, { name: 'coil', pins: ['+', '-'], kind: 'selv' }], isolation: 'reinforced',
  ratings: [{ pins: ['COM', 'NO', 'NC'], kind: 'switching', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' }],
} })
export const ssr = mod({ id: 't-ssr', name: 'Test SSR', pins: [
  { name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'left', type: 'passive' },
  { name: '3', side: 'right', type: 'input' }, { name: '4', side: 'right', type: 'ground' },
], electrical: {
  contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2' }] }],
  domains: [{ name: 'load', pins: ['1', '2'], kind: 'mains' }, { name: 'control', pins: ['3', '4'], kind: 'selv' }], isolation: 'reinforced',
  ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: 380, amps: 25, provenance: 'datasheet' }],
} })
export const fuse = mod({ id: 't-fuse', name: 'Test fuse holder', pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }],
  electrical: { protective: [{ from: '1', to: '2', kind: 'fuse' }], params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] }, ratings: [ac(['1', '2'], 250)] } })

const termPins = [{ name: '1', side: 'left' }, { name: '2', side: 'left' }, { name: '1b', side: 'right' }, { name: '2b', side: 'right' }] as ModuleDef['pins']
const term = (id: string, name: string, electrical: Record<string, unknown>) => mod({ id, name, pins: termPins, internal: [['1', '1b'], ['2', '2b']], electrical })
const all = ['1', '2', '1b', '2b']
export const block = term('t-term', 'Test terminal block 300 V', { ratings: [ac(all, 300)] })
export const block125 = term('t-term-125', 'Test terminal block 125 V', { ratings: [ac(all, 125)] })
export const blockDc = term('t-term-dc', 'Test terminal block 300 V DC', { ratings: [{ ...ac(all, 300), service: 'dc' }] })
export const blockCond = term('t-term-cond', 'Test terminal block with conditions', { ratings: [ac(all, 300, { conditions: 'for overvoltage category III and pollution degree 2' })] })
export const blockBare = term('t-term-bare', 'Test terminal block, no rating', { domains: [{ name: 'm', pins: all, kind: 'mains' }] })
export const blockUnverified = term('t-term-unverified', 'Test terminal block clone', { ratings: [ac(all, 300, { provenance: 'unverified' })] })

/** A low-voltage board: an I/O pin, a ground and a 5 V input. No mains data at all. */
export const mcu = mod({ id: 't-mcu', name: 'Test board', pins: [
  { name: 'IO', side: 'right', type: 'io' }, { name: 'GND', side: 'left', type: 'ground' }, { name: 'VCC', side: 'left', type: 'power_in', supply: '5V' },
] })
/** The same board with a 3.3 V only input. */
export const mcu33 = mod({ id: 't-mcu33', name: 'Test 3.3 V board', pins: [
  { name: 'IO', side: 'right', type: 'io' }, { name: 'GND', side: 'left', type: 'ground' }, { name: 'VCC', side: 'left', type: 'power_in', supply: '3V3' },
] })
/** A 9 V battery: a DC source that is not a mains part. */
export const bat9 = mod({ id: 't-bat9', name: 'Test 9 V battery', pins: [{ name: '+', side: 'top', type: 'power_out', supply: '9V' }, { name: '-', side: 'top', type: 'ground' }] })
/** A double-pole relay: both poles switch together (spec 1.5, linked poles). */
export const relay2p = mod({ id: 't-relay-2p', name: 'Test double-pole relay', pins: [
  ...['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'].map((name) => ({ name, side: 'left', type: 'passive' })),
  { name: '+', side: 'right', type: 'power_in', supply: '5V' }, { name: '-', side: 'right', type: 'ground' },
] as ModuleDef['pins'], electrical: {
  contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM1', no: 'NO1', nc: 'NC1' }, { com: 'COM2', no: 'NO2', nc: 'NC2' }] }],
  domains: [{ name: 'contacts', pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'mains' }, { name: 'coil', pins: ['+', '-'], kind: 'selv' }], isolation: 'reinforced',
  ratings: [{ pins: ['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2'], kind: 'switching', service: 'ac', volts: 250, amps: 10, provenance: 'datasheet' }],
} })
/** A converter that declares only its mains domain: its outputs are in no domain (Resolution 27). */
export const psuMainsOnly = mod({ id: 't-psu-mainsonly', name: 'Test AC-DC 5 V (outputs in no domain)', pins: psuPins,
  electrical: { ...psuInput, domains: [{ name: 'mains', pins: ['AC1', 'AC2'], kind: 'mains' }], isolation: 'reinforced', protection: 'class-2' } })
/** A part with mains terminals and no conduction data. */
export const undeclared = mod({ id: 't-undeclared', name: 'Test part without mains data', pins: [{ name: 'A', side: 'left', mains: 'L' }, { name: 'B', side: 'right', mains: 'N' }] })

export const MAINS_MODULES: Record<string, ModuleDef> = Object.fromEntries(
  [outlet, outlet2, outletEU, psu, psuBasic, psuBasicBonded, psuScreen, psuPelv, lamp, lampC1, sw, relay, ssr, fuse, block, block125, blockDc, blockCond, blockBare, blockUnverified, mcu, mcu33, undeclared, bat9, relay2p, psuMainsOnly]
    .map((m) => [m.id, m]),
)

export const at = (uid: string, designator: string, module: string, x = 0, y = 0, extra: Partial<PartInstance> = {}): PartInstance =>
  ({ uid, designator, module, x, y, rotation: 0, ...extra })

let seq = 0
/** A wire "uid|pin" to "uid|pin", mains-suitable by default (18 AWG, ferrules), so only cable-unverified ever applies to it. */
export const w = (a: string, b: string, extra: Partial<Connection> = {}): Connection => {
  const end = (s: string) => {
    const [part, pin] = s.split('|')
    return { part, pin }
  }
  return { uid: `w${++seq}`, from: end(a), to: end(b), gauge: 18, ends: { from: 'ferrule', to: 'ferrule' }, ...extra }
}
/** A 26 AWG Dupont jumper, clearly unsuitable for mains. */
export const dupont = (a: string, b: string): Connection => w(a, b, { gauge: 26, ends: { from: 'dupont-female', to: 'dupont-female' } })
export const sheet = (parts: PartInstance[], connections: Connection[], modules: Record<string, ModuleDef> = {}): Diagram =>
  ({ format: 'circuitoon-diagram/1', title: 't', modules: { ...MAINS_MODULES, ...modules }, parts, connections })
```

- [ ] **Step 3: Write the failing graph tests**

Create `src/format/mainsGraph.test.ts`:

```ts
// The mains conduction graph (spec 1.2): identity through zero and fitted protective edges only,
// energization onward through loads, leakage and inadequate isolation, contact states per group.
import { describe, expect, it } from 'vitest'
import { validateModule } from './module.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import { L_MASK, N_MASK, PE_MASK, analyseState, bitOf, buildMainsGraph, prepare, type Prepared } from './mainsGraph.ts'
import { MAINS_MODULES, at, sheet, w } from './mains.testing.ts'

const graph = (d: Diagram): Prepared => {
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))
  if (!g) throw new Error('no mains data')
  return prepare(g)
}
const node = (p: Prepared, part: string, pin: string) => p.g.nodeOf.get(nodeKey(part, pin))!
const ident = (p: Prepared, part: string, pin: string) => p.ident[p.root[node(p, part, pin)]]
const power = (p: Prepared, part: string, pin: string) => p.power[p.root[node(p, part, pin)]]
/** Sets every contact group released or off except the listed group indices, and analyses that state. */
const state = (p: Prepared, ...on: number[]) => {
  p.groupState.fill(0)
  for (const i of on) p.groupState[i] = 1
  analyseState(p)
  return p
}

describe('mains fixtures', () => {
  it('every fixture module passes validation', () => {
    for (const m of Object.values(MAINS_MODULES)) {
      const r = validateModule(m)
      expect([m.id, r.ok ? [] : r.errors]).toEqual([m.id, []])
    }
  })
})

describe('buildMainsGraph', () => {
  it('builds nothing for a sheet without mains data', () => {
    const d = sheet([at('u1', 'U1', 't-mcu')], [])
    const plugs = plugsOf(d)
    expect(buildMainsGraph(d, plugs, netlist(d, plugs))).toBeNull()
  })
  it('gives each net its source identity through wires and terminal blocks', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('x1', 'X1', 't-term', 200), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'x1|1'), w('x1|1b', 'e1|L'), w('xs1|N', 'e1|N')])))
    expect(ident(p, 'e1', 'L')).toBe(bitOf(0, 'L'))
    expect(ident(p, 'e1', 'N')).toBe(bitOf(0, 'N'))
    expect(ident(p, 'xs1', 'PE')).toBe(bitOf(0, 'PE'))
  })
  it('passes energization, never identity, through a load', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'u1|IO')])))
    expect(ident(p, 'u1', 'IO')).toBe(0)
    expect(power(p, 'u1', 'IO')).toBe(1)
  })
  it('carries identity through a fitted fuse, not an absent one', () => {
    const parts = (fuse: string) => [at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse } })]
    expect(ident(state(graph(sheet(parts('fitted'), [w('xs1|L', 'f1|1')]))), 'f1', '2') & L_MASK).not.toBe(0)
    expect(ident(state(graph(sheet(parts('absent'), [w('xs1|L', 'f1|1')]))), 'f1', '2')).toBe(0)
  })
  it('switches a relay pole COM-NC released and COM-NO energized, never both', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200)], [w('xs1|L', 'k1|COM')]))
    state(p)
    expect([ident(p, 'k1', 'NC'), ident(p, 'k1', 'NO')]).toEqual([bitOf(0, 'L'), 0])
    state(p, 0)
    expect([ident(p, 'k1', 'NC'), ident(p, 'k1', 'NO')]).toEqual([0, bitOf(0, 'L')])
  })
  it('leaks energization through an OFF SSR and conducts identity when it is ON', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-ssr', 200)], [w('xs1|L', 'k1|1')]))
    state(p)
    expect([ident(p, 'k1', '2'), power(p, 'k1', '2')]).toEqual([0, 1])
    state(p, 0)
    expect(ident(p, 'k1', '2')).toBe(bitOf(0, 'L'))
  })
  it('energizes a secondary across basic isolation, never across reinforced or basic plus a screen', () => {
    const d = (m: string) => sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', m, 200)], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(power(state(graph(d('t-psu-basic'))), 'ps1', '+V')).toBe(1)
    expect(power(state(graph(d('t-psu'))), 'ps1', '+V')).toBe(0)
    expect(power(state(graph(d('t-psu-screen'))), 'ps1', '+V')).toBe(0)
  })
  it("treats an undeclared mains terminal conservatively: energy passes to the part's other mains terminals", () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-undeclared', 200)], [w('xs1|L', 'u1|A')])))
    expect(power(p, 'u1', 'B')).toBe(1)
  })
  it('switches linked poles together: both on NC released, both on NO energized, never one of each', () => {
    const p = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay-2p', 200)], [w('xs1|L', 'k1|COM1'), w('xs1|N', 'k1|COM2')]))
    state(p)
    expect([ident(p, 'k1', 'NC1'), ident(p, 'k1', 'NC2'), ident(p, 'k1', 'NO1'), ident(p, 'k1', 'NO2')]).toEqual([bitOf(0, 'L'), bitOf(0, 'N'), 0, 0])
    state(p, 0)
    expect([ident(p, 'k1', 'NC1'), ident(p, 'k1', 'NC2'), ident(p, 'k1', 'NO1'), ident(p, 'k1', 'NO2')]).toEqual([0, 0, bitOf(0, 'L'), bitOf(0, 'N')])
    expect(p.g.groups).toHaveLength(1)
  })
  it("treats a converter's outputs outside every domain as live when its input is energized", () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-mainsonly', 200)], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])))
    expect(power(p, 'ps1', '+V')).toBe(1)
  })
  it('takes every fuse as fitted in fitRoot, and leaves the rest of the sheet alone', () => {
    const p = state(graph(sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings: { fuse: 'absent' } }), at('u9', 'U9', 't-mcu', 900)],
      [w('xs1|L', 'f1|1'), w('u9|IO', 'u9|GND')])))
    expect(p.anyAbsent).toBe(true)
    expect(p.fitRoot[node(p, 'f1', '2')]).toBe(p.fitRoot[node(p, 'xs1', 'L')])
    expect(p.root[node(p, 'f1', '2')]).not.toBe(p.root[node(p, 'xs1', 'L')])
    expect(p.inRel[node(p, 'u9', 'IO')]).toBe(0)
  })
  it('keeps the three conductors of ten sources apart in the masks', () => {
    expect(L_MASK & N_MASK).toBe(0)
    expect(N_MASK & PE_MASK).toBe(0)
    expect(bitOf(9, 'PE') & PE_MASK).toBe(bitOf(9, 'PE'))
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsGraph.test.ts`
Expected: FAIL (`./mainsGraph.ts` does not exist).

- [ ] **Step 5: Implement `src/format/mainsGraph.ts`**

```ts
// The mains conduction graph (spec 1.2). Nodes are the sheet's nets: wires, internal joins and
// plugged contacts already join those at zero ohms. Typed edges join nets through a part: fitted
// fuses (protective; an absent fuse is open), loads, leakage paths, energy that crosses an
// inadequate isolation barrier or an undeclared mains terminal (energize), and the contacts of
// switches, relays and SSRs, whose edges depend on the state. Identity (which source conductor a
// node is) closes over nets, fitted fuses and closed contacts; energization closes onward over
// loads, leakage and energize edges. Pure; one state at a time, in reused typed arrays.
import { type Diagram, type PartInstance, moduleOf } from './diagram.ts'
import type { Plug } from './breadboard.ts'
import { type Netlist, nodeKey } from './netlist.ts'
import { type ModuleDef, type PinType, isSpacer, partSetting } from './module.ts'
import { paramValue } from './values.ts'
import { type Conductor, type ContactGroup, type MainsInfo, type Region, type SocketFamily, isolationAdequate, mainsOf, uncoveredPins } from './mainsModel.ts'

/** Identity is one 30-bit mask: three bits (L, N, PE) per source. More sources than this: see mains-incomplete. */
export const MAX_SOURCES = 10
const CI: Record<Conductor, number> = { L: 0, N: 1, PE: 2 }
const COND: Conductor[] = ['L', 'N', 'PE']
export const bitOf = (s: number, c: Conductor): number => 1 << (s * 3 + CI[c])
const every = (c: number) => {
  let m = 0
  for (let s = 0; s < MAX_SOURCES; s++) m |= 1 << (s * 3 + c)
  return m
}
export const L_MASK = every(0)
export const N_MASK = every(1)
export const PE_MASK = every(2)
export const LN_MASK = L_MASK | N_MASK
/** The source and conductor of a mask with exactly one bit set. */
export function decodeSingle(x: number): { s: number; c: Conductor } {
  const b = 31 - Math.clz32(x)
  return { s: Math.floor(b / 3), c: COND[b % 3] }
}

export interface GTerm { key: string; part: PartInstance; module: ModuleDef; info: MainsInfo; name: string; label: string; type?: PinType }
export interface GSource {
  index: number
  id: string
  part: PartInstance
  volts: number
  region: Region | null
  /** False when no standard fixes which slot is L (an unpolarized Japanese outlet, Schuko, Europlug): polarity downstream is unknowable. */
  polarized: boolean
  live: number[]
  neutral: number[]
  earth: number[]
  keys: Record<Conductor, string[]>
}
const UNPOLARIZED_SOCKETS: SocketFamily[] = ['nema-1-15r', 'cee7-3', 'cee7-16']
export interface GEdge {
  kind: 'protective' | 'load' | 'leakage' | 'energize'
  a: number
  b: number
  part: PartInstance
  names: [string, string]
  /** Energy flows a to b only (across an isolation barrier). */
  directed: boolean
  /** A protective edge whose fuse is fitted (every other edge: true). */
  fitted: boolean
  /** A protective edge's rating in amps; null when unknown. */
  rating: number | null
  why: 'isolation' | 'undeclared' | null
}
export interface GGroup { part: PartInstance; def: ContactGroup; nodes: number[]; closed: [number, number][][]; leak: [number, number][][] }
export interface GConverter { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number]; outputs: string[]; plugIn: boolean }
export interface GLoad { part: PartInstance; a: number; b: number; names: [string, string]; range: [number, number] | null }
export interface MainsGraph {
  d: Diagram
  n: number
  members: string[][]
  nodeOf: Map<string, number>
  wires: string[][]
  /** Connections the netlist left out (an end does not resolve): they conduct nothing. */
  broken: Set<string>
  sources: GSource[]
  edges: GEdge[]
  groups: GGroup[]
  converters: GConverter[]
  loads: GLoad[]
  mainsParts: PartInstance[]
  /** Parts with a wire or a plugged contact. */
  connected: Set<string>
  termCache: Map<string, GTerm | null>
}

/** Every named terminal of a module: pins (not spacers), hole groups and internal nodes. */
function terminalNames(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => (isSpacer(p) ? [] : [p.name])), ...(m.holes ?? []).map((g) => g.name), ...info.internalNodes]
}

/** A converter's DC outputs: its power_out pins outside the mains domain. */
function outputsOf(m: ModuleDef, info: MainsInfo): string[] {
  return [...m.pins.flatMap((p) => (isSpacer(p) ? [] : [p])), ...(m.holes ?? [])]
    .filter((p) => p.type === 'power_out' && info.domainOf.get(p.name)?.kind !== 'mains').map((p) => p.name)
}

export function buildMainsGraph(d: Diagram, plugs: Plug[], nl: Netlist): MainsGraph | null {
  const mainsParts = d.parts.filter((p) => {
    const m = moduleOf(d, p.module)
    return !!m && mainsOf(m).any
  })
  if (!mainsParts.length) return null
  const members: string[][] = nl.nets.slice()
  const nodeOf = new Map<string, number>()
  members.forEach((keys, i) => keys.forEach((k) => nodeOf.set(k, i)))
  const node = (part: string, name: string): number => {
    const k = nodeKey(part, name)
    let i = nodeOf.get(k)
    if (i === undefined) {
      i = members.length
      members.push([k])
      nodeOf.set(k, i)
    }
    return i
  }
  const sources: GSource[] = []
  const edges: GEdge[] = []
  const groups: GGroup[] = []
  const converters: GConverter[] = []
  const loads: GLoad[] = []
  const edge = (e: Partial<GEdge> & Pick<GEdge, 'kind' | 'a' | 'b' | 'part' | 'names'>) =>
    edges.push({ directed: false, fitted: true, rating: null, why: null, ...e })
  for (const p of mainsParts) {
    const m = moduleOf(d, p.module)!
    const info = mainsOf(m)
    for (const t of terminalNames(m, info)) node(p.uid, t)
    for (const src of info.acSources) {
      const volts = paramValue(p, m, 'acVoltage')
      if (volts === null) continue
      sources.push({
        index: sources.length, id: `${p.uid}:${src.id}`, part: p, volts, region: info.region,
        polarized: !info.sockets.some((x) => UNPOLARIZED_SOCKETS.includes(x.family)),
        live: src.live.map((n) => node(p.uid, n)), neutral: src.neutral.map((n) => node(p.uid, n)), earth: src.earth.map((n) => node(p.uid, n)),
        keys: { L: src.live.map((n) => nodeKey(p.uid, n)), N: src.neutral.map((n) => nodeKey(p.uid, n)), PE: src.earth.map((n) => nodeKey(p.uid, n)) },
      })
    }
    for (const e of info.protective)
      edge({ kind: 'protective', a: node(p.uid, e.from), b: node(p.uid, e.to), part: p, names: [e.from, e.to],
        fitted: partSetting(p, m, 'fuse') !== 'absent', rating: e.rating ?? paramValue(p, m, 'fuseRating') })
    for (const c of info.conducts) {
      const [a, b] = [node(p.uid, c.pins[0]), node(p.uid, c.pins[1])]
      edge({ kind: c.kind, a, b, part: p, names: c.pins })
      if (c.kind === 'load') loads.push({ part: p, a, b, names: c.pins, range: c.range })
    }
    if (info.acInput) {
      const { a, b, range } = info.acInput
      const [na, nb] = [node(p.uid, a), node(p.uid, b)]
      // A converter's input draws current between its terminals, like a load.
      edge({ kind: 'load', a: na, b: nb, part: p, names: [a, b] })
      converters.push({ part: p, a: na, b: nb, names: [a, b], range, outputs: outputsOf(m, info), plugIn: !!info.plug })
    }
    // Energy crosses an isolation barrier that is not protective separation (spec 1.3), and reaches
    // every pin of a converter that no domain covers (Resolution 27: the data is missing, so that pin
    // is taken as live; rule 12 names it).
    const primary = info.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins)
    const declared = info.domains.filter((x) => x.kind !== 'mains').flatMap((x) => x.pins)
    const exposed = [...(isolationAdequate(info) ? [] : declared), ...(info.acInput ? uncoveredPins(m, info) : [])]
    const from = primary.length ? primary : info.acInput ? [info.acInput.a, info.acInput.b] : []
    for (const a of from) for (const b of exposed) edge({ kind: 'energize', a: node(p.uid, a), b: node(p.uid, b), part: p, names: [a, b], directed: true, why: 'isolation' })
    // A mains terminal whose conduction the module does not declare: energy passes both ways
    // between it and every other mains terminal of the part (spec 1.2, conservative).
    for (const t of info.terminals) {
      if (info.declaredConduction.has(t)) continue
      for (const o of info.terminals) if (o !== t) edge({ kind: 'energize', a: node(p.uid, t), b: node(p.uid, o), part: p, names: [t, o], why: 'undeclared' })
    }
    for (const def of info.contacts) {
      const closed: [number, number][][] = [[], []]
      const leak: [number, number][][] = [[], []]
      const nodes: number[] = []
      for (const pole of def.poles) {
        const com = node(p.uid, pole.com)
        const no = pole.no !== null ? node(p.uid, pole.no) : null
        const nc = pole.nc !== null ? node(p.uid, pole.nc) : null
        nodes.push(com, ...(no !== null ? [no] : []), ...(nc !== null ? [nc] : []))
        if (def.kind === 'ssr') {
          if (no !== null) {
            leak[0].push([com, no])
            closed[1].push([com, no])
          }
        } else {
          if (nc !== null) closed[0].push([com, nc])
          if (no !== null) closed[1].push([com, no])
        }
      }
      groups.push({ part: p, def, nodes, closed, leak })
    }
  }
  const broken = new Set(nl.broken)
  const wires: string[][] = members.map(() => [])
  const connected = new Set<string>(plugs.map((pl) => pl.part))
  for (const c of d.connections) {
    if (broken.has(c.uid)) continue
    connected.add(c.from.part)
    connected.add(c.to.part)
    const i = nodeOf.get(nodeKey(c.from.part, c.from.pin))
    if (i !== undefined) wires[i].push(c.uid)
  }
  return { d, n: members.length, members, nodeOf, wires, broken, sources, edges, groups, converters, loads, mainsParts, connected, termCache: new Map() }
}

/** The terminal a node key names, with its module's mains data; null for a missing part or name. Cached per graph. */
export function termAt(g: MainsGraph, key: string): GTerm | null {
  if (g.termCache.has(key)) return g.termCache.get(key)!
  const [uid, name] = JSON.parse(key) as [string, string]
  const part = g.d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(g.d, part.module)
  let t: GTerm | null = null
  if (part && m) {
    const info = mainsOf(m)
    const pin = m.pins.find((p) => !isSpacer(p) && p.name === name)
    const def = pin && !isSpacer(pin) ? pin : m.holes?.find((h) => h.name === name)
    if (def || info.internalNodes.includes(name)) t = { key, part, module: m, info, name, label: def?.label ?? name, type: def?.type }
  }
  g.termCache.set(key, t)
  return t
}

export const termName = (t: GTerm): string => `${t.part.designator} ${t.label}`

function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]
    x = parent[x]
  }
  return x
}
function union(parent: Int32Array, a: number, b: number) {
  const ra = find(parent, a)
  const rb = find(parent, b)
  if (ra !== rb) parent[ra] = rb
}
const identity = (n: number) => Int32Array.from({ length: n }, (_, i) => i)

/** Component root per node when every edge and every contact position conducts at once (spec 1.5). */
export function possibleRoots(g: MainsGraph): Int32Array {
  const parent = identity(g.n)
  for (const e of g.edges) union(parent, e.a, e.b)
  for (const grp of g.groups) for (const list of [...grp.closed, ...grp.leak]) for (const [a, b] of list) union(parent, a, b)
  for (let i = 0; i < g.n; i++) parent[i] = find(parent, i)
  return parent
}

export interface Prepared {
  g: MainsGraph
  /** Possible-connectivity root per node. */
  possible: Int32Array
  /** The nodes this analysis covers: every node in a possible-connectivity component with a source terminal or a converter input (a view narrows it to one enumeration unit). Only these can carry identity or energy. */
  relevant: Int32Array
  /** 1 for a node in `relevant`. */
  inRel: Uint8Array
  /** The sources, contact groups, loads, converters, fuses and energy edges with terminals in `relevant`. A view's sources keep their global `index` but list only their nodes inside the view. */
  sources: GSource[]
  groupIdx: number[]
  loadIdx: number[]
  converterIdx: number[]
  protective: GEdge[]
  /** Load, leakage and energize edges inside `relevant`. */
  energy: GEdge[]
  /** Union-find bases: nets plus fitted fuses (identity), nets alone (the unprotected rule), nets plus every fuse (an empty holder taken as fitted, Resolution 28). */
  base: Int32Array
  bareBase: Int32Array
  fitBase: Int32Array
  /** True when some fuse holder is empty (only then is `fitRoot` computed). */
  anyAbsent: boolean
  // Scratch, reused by every state and shared by views; only `relevant` entries are ever read or written.
  parent: Int32Array
  bareParent: Int32Array
  fitParent: Int32Array
  root: Int32Array
  bareRoot: Int32Array
  fitRoot: Int32Array
  /** Identity mask at each root. */
  ident: Uint32Array
  /** Energizing sources (one bit per source) at each root. */
  power: Uint16Array
  /** Per contact group: 0 released or off, 1 energized or on. */
  groupState: Int8Array
  /** The distinct roots holding identity in this state. */
  srcRoots: number[]
}

export function prepare(g: MainsGraph): Prepared {
  const possible = possibleRoots(g)
  const live = new Set<number>()
  for (const s of g.sources) for (const x of [...s.live, ...s.neutral, ...s.earth]) live.add(possible[x])
  for (const c of g.converters) live.add(possible[c.a]).add(possible[c.b])
  const relevant = Int32Array.from([...Array(g.n).keys()].filter((i) => live.has(possible[i])))
  const inRel = new Uint8Array(g.n)
  for (const i of relevant) inRel[i] = 1
  const base = identity(g.n)
  const bareBase = identity(g.n)
  const fitBase = identity(g.n)
  let anyAbsent = false
  for (const e of g.edges) {
    if (e.kind !== 'protective') continue
    union(fitBase, e.a, e.b)
    if (e.fitted) union(base, e.a, e.b)
    else anyAbsent = true
  }
  return {
    g, possible, relevant, inRel,
    sources: g.sources,
    groupIdx: g.groups.flatMap((grp, i) => (grp.nodes.some((x) => inRel[x]) ? [i] : [])),
    loadIdx: g.loads.flatMap((l, i) => (inRel[l.a] ? [i] : [])),
    converterIdx: g.converters.flatMap((c, i) => (inRel[c.a] ? [i] : [])),
    protective: g.edges.filter((e) => e.kind === 'protective' && inRel[e.a]),
    energy: g.edges.filter((e) => e.kind !== 'protective' && inRel[e.a] && inRel[e.b]),
    base, bareBase, fitBase, anyAbsent,
    parent: new Int32Array(g.n), bareParent: new Int32Array(g.n), fitParent: new Int32Array(g.n),
    root: identity(g.n), bareRoot: identity(g.n), fitRoot: identity(g.n),
    ident: new Uint32Array(g.n), power: new Uint16Array(g.n), groupState: new Int8Array(g.groups.length), srcRoots: [],
  }
}

/** Moves energy one step along a-b (a to b only when directed). True when anything changed. */
function flow(p: Prepared, a: number, b: number, directed: boolean): boolean {
  const ra = p.root[a]
  const rb = p.root[b]
  if (ra === rb) return false
  let moved = false
  const f = p.power[ra] & ~p.power[rb]
  if (f) {
    p.power[rb] |= f
    moved = true
  }
  if (!directed) {
    const back = p.power[rb] & ~p.power[ra]
    if (back) {
      p.power[ra] |= back
      moved = true
    }
  }
  return moved
}

/**
 * Identity and energization for the state in `p.groupState`, over `p.relevant` only: resetting and
 * walking just these nodes keeps a state's cost independent of the rest of the sheet. Results live in
 * `p` until the next call.
 */
export function analyseState(p: Prepared): void {
  const { g } = p
  for (const i of p.relevant) {
    p.parent[i] = p.base[i]
    p.bareParent[i] = p.bareBase[i]
    if (p.anyAbsent) p.fitParent[i] = p.fitBase[i]
  }
  for (const gi of p.groupIdx)
    for (const [a, b] of g.groups[gi].closed[p.groupState[gi]]) {
      union(p.parent, a, b)
      union(p.bareParent, a, b)
      if (p.anyAbsent) union(p.fitParent, a, b)
    }
  for (const i of p.relevant) {
    p.root[i] = find(p.parent, i)
    p.bareRoot[i] = find(p.bareParent, i)
    if (p.anyAbsent) p.fitRoot[i] = find(p.fitParent, i)
    p.ident[i] = 0
    p.power[i] = 0
  }
  p.srcRoots.length = 0
  for (const s of p.sources) {
    const put = (nodes: number[], c: Conductor) => {
      for (const x of nodes) {
        const r = p.root[x]
        if (!p.ident[r]) p.srcRoots.push(r)
        p.ident[r] |= bitOf(s.index, c)
      }
    }
    put(s.live, 'L')
    put(s.neutral, 'N')
    put(s.earth, 'PE')
    for (const x of s.live) p.power[p.root[x]] |= 1 << s.index
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const e of p.energy) if (flow(p, e.a, e.b, e.directed)) changed = true
    for (const gi of p.groupIdx) for (const [a, b] of g.groups[gi].leak[p.groupState[gi]]) if (flow(p, a, b, false)) changed = true
  }
}

export const identAt = (p: Prepared, node: number): number => p.ident[p.root[node]]
export const powerAt = (p: Prepared, node: number): number => p.power[p.root[node]]
/** A node is hazardous when it holds L or N identity or is energized (spec 1.2). */
export const hazardAt = (p: Prepared, node: number): boolean => (identAt(p, node) & LN_MASK) !== 0 || powerAt(p, node) !== 0
```

Note: `p.ident` and `p.power` are only meaningful at roots of the nodes a `Prepared` covers. A rule reads them only for nodes in its own `p.relevant` (or checks `p.inRel` first): a node another view covers may hold that view's last state. A node in no relevant component is never written, stays its own root with 0 in both, and is handled by static rules (Task 9's orphan earth check).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsGraph.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/format/words.ts src/format/checks.ts src/format/mains.testing.ts src/format/mainsGraph.ts src/format/mainsGraph.test.ts
git commit -m "Mains: conduction graph with identity and energization per state" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Candidates, enumeration units, minimal state witnesses and their wording

**Files:**
- Modify: `src/format/mainsGraph.ts` (append)
- Test: `src/format/mainsStates.test.ts`

**Interfaces:**
- Consumes: `MainsGraph`, `Prepared`, `possibleRoots` (Task 3); `andList`, `natural` (`words.ts`).
- Produces (in `mainsGraph.ts`):
  - `MAX_GROUPS = 16`
  - `candidateGroups(g: MainsGraph, possible?: Int32Array): number[]` (group indices, in sheet order)
  - `masksByPopcount(k: number): Uint32Array` (every k-bit mask, fewest set bits first, then by value; cached per k)
  - `setState(p: Prepared, cands: number[], mask: number): void`
  - `viewOf(p: Prepared, nodes: number[]): Prepared` (the same scratch arrays, narrowed lists)
  - `interface Unit { view: Prepared; cands: number[] }`, `units(p: Prepared, cands: number[]): Unit[]` (Resolution 25: one per possible-connectivity component with a source or converter input, components joined by a multi-pole group merged)
  - `minimalWitness(holds: Uint32Array, k: number, mask: number): number[]` (candidate positions whose condition is needed, Resolution 24)
  - `groupName(g: MainsGraph, gi: number): string`
  - `statePhrase(g: MainsGraph, cands: number[], kept: number[], mask: number): string` (for example `"when S1 is on and K1 is released"`; `''` when `kept` is empty)

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsStates.test.ts`:

```ts
// Which contact groups can matter (spec 1.5: a group touching a possible-connectivity component with
// a source or a converter input), the units the states are enumerated in, and the minimal, complete
// witness of a finding (Resolution 24) in words.
import { describe, expect, it } from 'vitest'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import type { Diagram } from './diagram.ts'
import { buildMainsGraph, candidateGroups, masksByPopcount, minimalWitness, prepare, statePhrase, units, type MainsGraph } from './mainsGraph.ts'
import { at, sheet, w } from './mains.testing.ts'

const graph = (d: Diagram): MainsGraph => {
  const plugs = plugsOf(d)
  return buildMainsGraph(d, plugs, netlist(d, plugs))!
}
const names = (g: MainsGraph, idx: number[]) => idx.map((i) => g.groups[i].part.designator)
/** A holds-bitset over k groups from a predicate on the mask. */
const holds = (k: number, pred: (m: number) => boolean) => {
  const b = new Uint32Array(Math.max(1, (1 << k) >>> 5))
  for (let m = 0; m < 1 << k; m++) if (pred(m)) b[m >>> 5] |= 1 << (m & 31)
  return b
}

describe('candidateGroups', () => {
  it('finds S2 in L-S1-S2-S3-N although S2 touches neither end', () => {
    const g = graph(sheet(
      [at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('s3', 'S3', 't-switch', 600)],
      [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'xs1|N')],
    ))
    expect(names(g, candidateGroups(g))).toEqual(['S1', 'S2', 'S3'])
  })
  it('leaves out a switch that no source or converter input can ever reach', () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('u1', 'U1', 't-mcu', 600)],
      [w('xs1|L', 's1|1'), w('u1|IO', 's2|1')]))
    expect(names(g, candidateGroups(g))).toEqual(['S1'])
  })
})

describe('units', () => {
  it('enumerates independent components on their own, and keeps a linked-pole relay in one unit', () => {
    const g = graph(sheet([
      at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 300), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 200, 300),
      at('k1', 'K1', 't-relay-2p', 400),
    ], [w('xs1|L', 's1|1'), w('xs2|L', 's2|1'), w('xs1|N', 'k1|COM1'), w('xs2|N', 'k1|COM2')]))
    const p = prepare(g)
    const us = units(p, candidateGroups(g, p.possible))
    expect(us.map((u) => names(g, u.cands).join(' ')).filter(Boolean).sort()).toEqual(['K1', 'S1', 'S2'])
    // K1's poles sit on XS1 N and on XS2 N: its unit spans both components, so the poles stay linked.
    const k1 = us.find((u) => names(g, u.cands).includes('K1'))!
    const has = (part: string, pin: string) => k1.view.inRel[g.nodeOf.get(nodeKey(part, pin))!] === 1
    expect([has('xs1', 'N'), has('xs2', 'N'), has('xs1', 'L')]).toEqual([true, true, false])
  })
  it('without a link, two outlets are two units', () => {
    const g = graph(sheet([at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 300), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 200, 300)],
      [w('xs1|L', 's1|1'), w('xs2|L', 's2|1')]))
    const p = prepare(g)
    expect(units(p, candidateGroups(g, p.possible)).map((u) => names(g, u.cands).join(' ')).filter(Boolean).sort()).toEqual(['S1', 'S2'])
  })
})

describe('masksByPopcount', () => {
  it('orders states by how many groups are on, then by value', () => {
    expect([...masksByPopcount(3)]).toEqual([0, 1, 2, 4, 3, 5, 6, 7])
    expect(masksByPopcount(16).length).toBe(65536)
    expect(masksByPopcount(3)).toBe(masksByPopcount(3))
  })
})

describe('minimalWitness', () => {
  it('keeps both switches of a series short and drops a third that does not matter', () => {
    expect(minimalWitness(holds(3, (m) => (m & 3) === 3), 3, 0b011)).toEqual([0, 1])
  })
  it('keeps an OFF condition that is needed (S1 on and K1 released)', () => {
    expect(minimalWitness(holds(2, (m) => m === 0b01), 2, 0b01)).toEqual([0, 1])
  })
  it('keeps nothing for a finding that holds in every state', () => {
    expect(minimalWitness(holds(3, () => true), 3, 0)).toEqual([])
  })
})

describe('statePhrase', () => {
  const g = graph(sheet(
    [at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('s2', 'S2', 't-switch', 400), at('s3', 'S3', 't-switch', 600), at('k1', 'K1', 't-relay', 800)],
    [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'k1|COM')],
  ))
  const cands = candidateGroups(g)
  it('says both for two groups on, lists three, and names OFF and released conditions', () => {
    expect(statePhrase(g, cands, [0], 0b0001)).toBe('when S1 is on')
    expect(statePhrase(g, cands, [0, 1], 0b0011)).toBe('when S1 and S2 are both on')
    expect(statePhrase(g, cands, [0, 1, 2], 0b0111)).toBe('when S1, S2 and S3 are on')
    expect(statePhrase(g, cands, [0, 3], 0b0001)).toBe('when S1 is on and K1 is released')
    expect(statePhrase(g, cands, [0, 3], 0b1001)).toBe('when S1 is on and K1 is energized')
    expect(statePhrase(g, cands, [0, 1], 0)).toBe('when S1 and S2 are off')
  })
  it('says nothing when no condition is needed', () => {
    expect(statePhrase(g, cands, [], 0b0101)).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsStates.test.ts`
Expected: FAIL (`candidateGroups`, `units`, `minimalWitness`, `statePhrase` not exported).

- [ ] **Step 3: Implement (append to `src/format/mainsGraph.ts`; add `import { andList, natural } from './words.ts'` at the top)**

```ts
/** Up to this many candidate groups on the sheet the checker enumerates every state; beyond, it reports mains-incomplete (spec 1.5). */
export const MAX_GROUPS = 16

/**
 * The contact groups whose state can matter: any of their contacts lies in a possible-connectivity
 * component that holds a source terminal or a converter input. Every contact position conducts in
 * that graph, so a switch in the middle of a chain is never missed.
 */
export function candidateGroups(g: MainsGraph, possible: Int32Array = possibleRoots(g)): number[] {
  const live = new Set<number>()
  for (const s of g.sources) for (const x of [...s.live, ...s.neutral, ...s.earth]) live.add(possible[x])
  for (const c of g.converters) live.add(possible[c.a]).add(possible[c.b])
  return g.groups.flatMap((grp, i) => (grp.nodes.some((x) => live.has(possible[x])) ? [i] : []))
}

const orderCache = new Map<number, Uint32Array>()
/** Every k-bit mask, fewest groups on first, then by value (a converter's first unknown state names the fewest groups). */
export function masksByPopcount(k: number): Uint32Array {
  const hit = orderCache.get(k)
  if (hit) return hit
  const pop = (x: number) => {
    let c = 0
    for (; x; x &= x - 1) c++
    return c
  }
  const out = Uint32Array.from(Array.from({ length: 1 << k }, (_, i) => i).sort((a, b) => pop(a) - pop(b) || a - b))
  orderCache.set(k, out)
  return out
}

/** Puts the candidates in the state `mask` (bit k is cands[k]); every other group in the view is released or off. */
export function setState(p: Prepared, cands: number[], mask: number): void {
  for (const gi of p.groupIdx) p.groupState[gi] = 0
  for (let k = 0; k < cands.length; k++) if ((mask >>> k) & 1) p.groupState[cands[k]] = 1
}

/** `p` narrowed to `nodes`: the same scratch arrays, the lists cut to what has a terminal among them. */
export function viewOf(p: Prepared, nodes: number[]): Prepared {
  const g = p.g
  const inRel = new Uint8Array(g.n)
  for (const i of nodes) inRel[i] = 1
  const within = (xs: number[]) => xs.filter((x) => inRel[x])
  return {
    ...p, relevant: Int32Array.from(nodes), inRel, srcRoots: [],
    sources: p.sources.map((s) => ({ ...s, live: within(s.live), neutral: within(s.neutral), earth: within(s.earth) })).filter((s) => s.live.length + s.neutral.length + s.earth.length > 0),
    groupIdx: p.groupIdx.filter((gi) => g.groups[gi].nodes.some((x) => inRel[x])),
    loadIdx: p.loadIdx.filter((i) => inRel[g.loads[i].a]),
    converterIdx: p.converterIdx.filter((i) => inRel[g.converters[i].a]),
    protective: p.protective.filter((e) => inRel[e.a]),
    energy: p.energy.filter((e) => inRel[e.a]),
  }
}

export interface Unit { view: Prepared; cands: number[] }

/**
 * The enumeration units (Resolution 25): the relevant nodes grouped by possible-connectivity
 * component, merging components that one multi-pole group spans (its poles switch together).
 * Components cannot affect each other, so each unit's states are enumerated on their own.
 */
export function units(p: Prepared, cands: number[]): Unit[] {
  const g = p.g
  const up = new Map<number, number>()
  const top = (x: number): number => {
    while (up.has(x)) x = up.get(x)!
    return x
  }
  for (const gi of cands) {
    const roots = [...new Set(g.groups[gi].nodes.map((x) => p.possible[x]))]
    for (const r of roots.slice(1)) {
      const [a, b] = [top(roots[0]), top(r)]
      if (a !== b) up.set(a, b)
    }
  }
  const byUnit = new Map<number, number[]>()
  for (const i of p.relevant) {
    const u = top(p.possible[i])
    const list = byUnit.get(u)
    if (list) list.push(i)
    else byUnit.set(u, [i])
  }
  return [...byUnit.values()].map((nodes) => {
    const view = viewOf(p, nodes)
    return { view, cands: cands.filter((gi) => view.groupIdx.includes(gi)) }
  })
}

/**
 * The candidate positions (0 to k-1) whose condition in state `mask` a finding needs (Resolution 24).
 * `holds` has bit m set for every state m the finding holds in. A condition is dropped only when the
 * finding holds in every state that agrees with the conditions still kept, so the phrase is both
 * minimal and complete.
 */
export function minimalWitness(holds: Uint32Array, k: number, mask: number): number[] {
  const has = (m: number) => ((holds[m >>> 5] >>> (m & 31)) & 1) === 1
  const allHold = (free: number) => {
    const fixed = mask & ~free
    for (let sub = free; ; sub = (sub - 1) & free) {
      if (!has(fixed | sub)) return false
      if (sub === 0) return true
    }
  }
  const kept: number[] = []
  let free = 0
  for (let j = 0; j < k; j++) {
    if (allHold(free | (1 << j))) free |= 1 << j
    else kept.push(j)
  }
  return kept
}

const WORDS: Record<ContactGroup['kind'], [string, string]> = { switch: ['off', 'on'], relay: ['released', 'energized'], ssr: ['off', 'on'] }

/** A contact group by its part's designator, with the group id when the part has several. */
export function groupName(g: MainsGraph, gi: number): string {
  const grp = g.groups[gi]
  const several = g.groups.filter((x) => x.part === grp.part).length > 1
  return several ? `${grp.part.designator} (${grp.def.id})` : grp.part.designator
}

/** The kept conditions of state `mask` in words: "when S1 is on and K1 is released", "when S1 and S2 are both on"; '' when none is kept. */
export function statePhrase(g: MainsGraph, cands: number[], kept: number[], mask: number): string {
  if (!kept.length) return ''
  const byWord = new Map<string, string[]>()
  for (const j of kept) {
    const gi = cands[j]
    const word = WORDS[g.groups[gi].def.kind][(mask >>> j) & 1]
    byWord.set(word, [...(byWord.get(word) ?? []), groupName(g, gi)])
  }
  const parts = [...byWord].map(([word, list]) => {
    list.sort(natural.compare)
    if (list.length === 1) return `${list[0]} is ${word}`
    return list.length === 2 && (word === 'on' || word === 'energized') ? `${list[0]} and ${list[1]} are both ${word}` : `${andList(list)} are ${word}`
  })
  return `when ${parts.join(' and ')}`
}
```

Cost note: `minimalWitness` runs once per finding after enumeration; each drop test walks at most the subcube of the conditions already dropped, so it is at most k times 2^k bit reads (about a million at k = 16), and only for findings that exist.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsStates.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsGraph.ts src/format/mainsStates.test.ts
git commit -m "Mains: candidates, enumeration units, minimal state witnesses" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The mains analysis, converter availability and the DC checker gate

**Files:**
- Create: `src/format/mainsRules.ts`
- Create: `src/format/mains.ts`
- Modify: `src/format/checks.ts` (RuleId and RULES, Terminal `dead`, `sourceOf`, `drives`, the not-checked finding for loads fed only by an unknown converter, hazardous nets skipped in every DC rule, both ends of every source edge gated in the potential solver, mains findings added)
- Test: `src/format/mains.test.ts`

**Interfaces:**
- Consumes: everything Tasks 3 and 4 produce; `plugsOf` (`breadboard.ts`); `netlist`, `nodeKey` (`netlist.ts`); `moduleOf`; `mainsOf`.
- Produces:
  - In `checks.ts`: `RuleId` gains `'mains-short' | 'mains-cross-source' | 'mains-to-low-voltage' | 'earth' | 'mains-voltage' | 'mains-rating' | 'mains-cable' | 'plug-mismatch' | 'polarity' | 'unprotected' | 'fuse-rating-unknown' | 'mains-shared-neutral' | 'earth-bond' | 'rating-unknown' | 'rating-conditional' | 'rating-unverified' | 'cable-unverified' | 'data-missing' | 'mains-incomplete'`, each in `RULES` with the severity and title below.
  - In `mainsRules.ts`:
    - `interface MainsDraft { rule: RuleId; subject: string; target: string; message: string; parts: string[]; pins: Endpoint[]; wires: string[]; causes: string[]; select?: { parts: string[]; wires: string[] } }`
    - `type Availability = 'powered' | 'unpowered' | 'unknown'`, `interface ConverterStatus { state: Availability; why: string | null }`
    - `interface Acc { p: Prepared; cands: number[]; total: number; seen: Map<string, Sighting>; hazardAny: Uint8Array; volts: Float64Array; identUnion: Uint32Array; converters: (ConverterStatus | null)[]; loadComplete: Uint8Array; loadFit: Uint8Array; incomplete: 'groups' | 'sources' | null; finished: MainsDraft[] }`
    - `newAcc(p: Prepared, cands: number[], incomplete: 'groups' | 'sources' | null): Acc` (`total` is `2 ** cands.length`, or 0 when incomplete)
    - `report(acc: Acc, key: string, mask: number, first: () => (when: string) => MainsDraft): void` (sets the finding's bit for `mask`)
    - `visitState(acc: Acc, mask: number): void`, `finishStates(acc: Acc): MainsDraft[]`, `absorb(into: Acc, unit: Acc): void`, `conservative(acc: Acc): void`, `staticDrafts(acc: Acc): MainsDraft[]`, `inputState(p: Prepared, c: GConverter): ConverterStatus`
    - `STATE_RULES: ((acc: Acc, mask: number) => void)[]` and `STATIC_RULES: ((acc: Acc) => MainsDraft[])[]` (later tasks append)
    - helpers `volt(v: number): string`, `endpointOf(t: GTerm): Endpoint`, `pinOfKey(key: string): Endpoint`, `sourcesIn(p: Prepared, x: number, e: number): number[]`, `sourcesText(g: MainsGraph, list: number[]): string`, `wiresOfRoot(p: Prepared, r: number): string[]`
  - In `mains.ts`:
    - `interface MainsAnalysis { graph: MainsGraph; complete: boolean; converters: Map<string, ConverterStatus>; hazardKeys: Set<string>; deadOutputs: Map<string, 'unpowered' | 'unknown'>; conductorOf(key: string): { conductor: Conductor; region: Region | null } | null; findings: MainsDraft[] }`
    - `hasMainsData(d: Pick<Diagram, 'parts' | 'modules'>): boolean` (a part whose module has any mains data)
    - `analyseMains(d: Diagram): MainsAnalysis | null` (returns `null` right after `hasMainsData`, before plugs, netlist or graph)
    - `analyseMainsCached(d: Diagram): MainsAnalysis | null` (one result per parts, connections and modules triple; the checker and the renderer both use it)

`RULES` additions (errors go after `short`, warnings after `leg-hole-shared`, in this order; the existing rules keep their relative order):

| Rule | Severity | Title |
| --- | --- | --- |
| `mains-short` | error | Mains short circuit |
| `mains-cross-source` | error | Two outlets joined |
| `mains-to-low-voltage` | error | Mains on low-voltage wiring |
| `earth` | error | Earth fault |
| `mains-voltage` | error | Wrong mains voltage |
| `mains-rating` | error | Not rated for this voltage |
| `mains-cable` | error | Unsuitable mains cable |
| `plug-mismatch` | warning | Plug does not fit |
| `polarity` | warning | Mains polarity |
| `unprotected` | warning | No fuse |
| `fuse-rating-unknown` | warning | Fuse rating unknown |
| `mains-shared-neutral` | warning | Shared neutral |
| `earth-bond` | warning | Ground joined to earth |
| `rating-unknown` | warning | Mains rating unknown |
| `rating-conditional` | warning | Rating has conditions |
| `rating-unverified` | warning | Rating not verified |
| `cable-unverified` | warning | Check the mains cable |
| `data-missing` | warning | Mains data missing |
| `mains-incomplete` | warning | Mains checks did not finish |

- [ ] **Step 1: Write the failing tests**

Create `src/format/mains.test.ts`:

```ts
// The mains analysis as the wiring checker sees it: converter availability (spec 1.3, rule 11)
// gating which outputs are DC sources and what the passive-feed allowance counts, loads behind an
// unknown converter reported as not checked, hazardous nets and source edges kept out of the DC rules,
// honest results when enumeration did not finish, and nothing built for a sheet without mains data.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Connection, Diagram } from './diagram.ts'
import { nodeKey } from './netlist.ts'
import { analyseMains, analyseMainsCached } from './mains.ts'
import { at, sheet, w } from './mains.testing.ts'

const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)
const msgs = (d: Diagram, rule: string) => only(d, rule).map((f) => f.message)
/** An outlet pair, a 5 V converter on its AC1/AC2 and a board on its output. */
const psuOn = (a: string, b: string, extra: Connection[] = []) => sheet(
  [at('xs1', 'XS1', 't-outlet'), at('xs2', 'XS2', 't-outlet-2', 0, 200), at('ps1', 'PS1', 't-psu', 200), at('u1', 'U1', 't-mcu', 400)],
  [...(a ? [w(a, 'ps1|AC1')] : []), ...(b ? [w(b, 'ps1|AC2')] : []), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND'), ...extra],
)

describe('analyseMains', () => {
  it('returns null for a sheet without mains data, and the cache hands the same result to every reader', () => {
    expect(analyseMains(sheet([at('u1', 'U1', 't-mcu')], []))).toBeNull()
    const d = psuOn('xs1|L', 'xs1|N')
    expect(analyseMainsCached(d)).toBe(analyseMainsCached(d))
  })
})

describe('converter availability gates the DC checker', () => {
  it('a converter fed L and N of one outlet is powered and supplies its load', () => {
    const d = psuOn('xs1|L', 'xs1|N')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'powered', why: null })
    expect(only(d, 'no-power')).toEqual([])
  })
  it('converter with inputs L and L (unknown availability, no DC conclusions)', () => {
    const d = psuOn('xs1|L', 'xs1|L')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'unknown', why: 'its two inputs are joined to each other' })
    expect(msgs(d, 'no-power')).toEqual([
      "PS1's mains input is not a complete connection (its two inputs are joined to each other), so its outputs are not counted as a supply. Wire AC1 and AC2 to L and N of one outlet.",
    ])
    // The board behind it is neither fed nor unfed: its power is reported as not checked, and nothing else is claimed.
    expect(checkDiagram(d).filter((f) => f.parts.includes('u1')).map((f) => `${f.rule}: ${f.message}`)).toEqual([
      "supply-unknown: U1's power is not checked: it comes only from PS1 +V, and PS1's mains input is not a complete connection.",
    ])
  })
  it('converter inputs shorted together or fed from two outlets (unknown, outputs dead)', () => {
    const shorted = analyseMains(psuOn('xs1|L', '', [w('ps1|AC1', 'ps1|AC2')]))!
    expect(shorted.converters.get('ps1')?.state).toBe('unknown')
    expect(shorted.deadOutputs.get(nodeKey('ps1', '+V'))).toBe('unknown')
    const two = analyseMains(psuOn('xs1|L', 'xs2|N'))!
    expect(two.converters.get('ps1')).toEqual({ state: 'unknown', why: 'its inputs come from two different outlets' })
    expect(two.deadOutputs.get(nodeKey('ps1', '+V'))).toBe('unknown')
  })
  it('names the one input that is connected', () => {
    expect(analyseMains(psuOn('xs1|L', ''))!.converters.get('ps1')).toEqual({ state: 'unknown', why: 'only AC1 is connected to an outlet' })
  })
  it('a converter with no mains input is unpowered, and its load has no power', () => {
    const d = psuOn('', '')
    expect(analyseMains(d)!.converters.get('ps1')).toEqual({ state: 'unpowered', why: null })
    expect(msgs(d, 'no-power')).toEqual([
      'PS1 has no mains input, so its outputs supply nothing. Wire AC1 and AC2 to L and N of one outlet.',
      "U1 has no power: VCC is connected but nothing supplies it. Connect it to a 5 V supply, such as a board's 5V pin.",
    ])
  })
})

describe('when the enumeration did not finish, nothing is claimed unpowered without proof', () => {
  const ks = Array.from({ length: 17 }, (_, i) => i + 1)
  const d = sheet([
    at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100, 300)),
    at('ps1', 'PS1', 't-psu', 200, 600), at('ps2', 'PS2', 't-psu', 600, 600), at('u1', 'U1', 't-mcu', 900, 600),
  ], [...ks.map((k) => w('xs1|L', `s${k}|1`)), w('s1|2', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps2|+V', 'u1|VCC'), w('ps2|-V', 'u1|GND')])
  it('a converter a source could reach is unknown; one no source can reach is unpowered (a proof)', () => {
    const a = analyseMains(d)!
    expect(a.complete).toBe(false)
    expect(a.converters.get('ps1')).toEqual({ state: 'unknown', why: 'the mains checks did not finish' })
    expect(a.converters.get('ps2')).toEqual({ state: 'unpowered', why: null })
  })
})

describe('hazardous nets and source edges stay out of the DC rules', () => {
  it('a relay contact that never meets mains keeps its DC role (it may feed a load)', () => {
    const d = sheet([at('k1', 'K1', 't-relay'), at('u1', 'U1', 't-mcu', 200)], [w('k1|NO', 'u1|VCC')])
    expect(only(d, 'no-power')).toEqual([])
  })
  it('an I/O pin wired to mains gets no DC finding about that net', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-mcu', 200), at('u2', 'U2', 't-mcu', 400)],
      [w('xs1|L', 'u1|IO'), w('u1|IO', 'u2|IO')])
    expect(checkDiagram(d).filter((f) => ['outputs-fight', 'no-common-ground'].includes(f.rule))).toEqual([])
  })
  it('a battery whose return is on mains adds nothing to the potential solver', () => {
    // Without the gate this would be "U1 VCC accepts up to 5 V but gets 9 V from BT1 +".
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('bt1', 'BT1', 't-bat9', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('bt1|+', 'u1|VCC'), w('bt1|-', 'xs1|N'), w('u1|GND', 'xs1|N')])
    expect(checkDiagram(d).filter((f) => ['supply-too-high', 'supply-unknown', 'reversed', 'supplies-fight'].includes(f.rule))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mains.test.ts`
Expected: FAIL (`./mains.ts` does not exist).

- [ ] **Step 3: Implement `src/format/mainsRules.ts` (accumulator, availability, rule 11)**

```ts
// The mains rules (spec section 3). Per-state rules run for every enumerated contact state of one
// enumeration unit and report findings by a stable key; each finding keeps one bit per state it holds
// in, so its wording names exactly the conditions it needs (Resolution 24). Static rules run once
// afterwards on what the states established (which nodes were ever hazardous, at what voltage). Pure.
import type { Endpoint } from './diagram.ts'
import type { RuleId } from './checks.ts'
import { nodeKey } from './netlist.ts'
import { type GConverter, type GTerm, type MainsGraph, type Prepared, LN_MASK, bitOf, decodeSingle, minimalWitness, statePhrase } from './mainsGraph.ts'
import { andList } from './words.ts'

export interface MainsDraft {
  rule: RuleId
  subject: string
  target: string
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
  causes: string[]
  select?: { parts: string[]; wires: string[] }
}
export type Availability = 'powered' | 'unpowered' | 'unknown'
export interface ConverterStatus { state: Availability; why: string | null }
interface Sighting { first: number; holds: Uint32Array; build: (when: string) => MainsDraft }
export interface Acc {
  p: Prepared
  cands: number[]
  total: number
  seen: Map<string, Sighting>
  /** Per node: hazardous in at least one state. */
  hazardAny: Uint8Array
  /** Per node: the highest voltage of a source that made it hazardous. */
  volts: Float64Array
  /** Per node: every identity bit it had in any state (Resolution 19 reads it). */
  identUnion: Uint32Array
  /** Per converter (global index): availability over the states seen. */
  converters: (ConverterStatus | null)[]
  /** Per load (global index): L and N of one source across it in some state as drawn; and with every empty fuse holder taken as fitted. */
  loadComplete: Uint8Array
  loadFit: Uint8Array
  incomplete: 'groups' | 'sources' | null
  /** Drafts of the units already enumerated (see absorb). */
  finished: MainsDraft[]
}

export function newAcc(p: Prepared, cands: number[], incomplete: 'groups' | 'sources' | null): Acc {
  const g = p.g
  return {
    p, cands, total: incomplete ? 0 : 2 ** cands.length, seen: new Map(),
    hazardAny: new Uint8Array(g.n), volts: new Float64Array(g.n), identUnion: new Uint32Array(g.n),
    converters: g.converters.map(() => null), loadComplete: new Uint8Array(g.loads.length), loadFit: new Uint8Array(g.loads.length),
    incomplete, finished: [],
  }
}

/** Records that a finding holds in state `mask`. `first` runs only the first time (while that state is still in `p`) and returns the builder. */
export function report(acc: Acc, key: string, mask: number, first: () => (when: string) => MainsDraft): void {
  let s = acc.seen.get(key)
  if (!s) acc.seen.set(key, (s = { first: mask, holds: new Uint32Array(Math.max(1, Math.ceil(acc.total / 32))), build: first() }))
  s.holds[mask >>> 5] |= 1 << (mask & 31)
}

export const volt = (v: number) => `${Number(v.toFixed(1))} V`
export const endpointOf = (t: GTerm): Endpoint => ({ part: t.part.uid, pin: t.name })
export const pinOfKey = (key: string): Endpoint => {
  const [part, pin] = JSON.parse(key) as [string, string]
  return { part, pin }
}
/** The sources (by global index) holding L or N in identity `x`, or energizing with `e`. */
export function sourcesIn(p: Prepared, x: number, e: number): number[] {
  return [...new Set(p.sources.map((s) => s.index))].filter((i) => x & (bitOf(i, 'L') | bitOf(i, 'N')) || (e >> i) & 1)
}
/** "XS1 (120 V)", "XS1 (120 V) and XS2 (230 V)". */
export const sourcesText = (g: MainsGraph, list: number[]) => andList(list.map((s) => `${g.sources[s].part.designator} (${volt(g.sources[s].volts)})`))
/** The wires on every node whose root is `r` in the current state. */
export function wiresOfRoot(p: Prepared, r: number): string[] {
  const out: string[] = []
  for (const i of p.relevant) if (p.root[i] === r) out.push(...p.g.wires[i])
  return out
}

function track(acc: Acc) {
  const { p } = acc
  const g = p.g
  for (const i of p.relevant) {
    const r = p.root[i]
    const x = p.ident[r]
    const e = p.power[r]
    acc.identUnion[i] |= x
    if (!(x & LN_MASK) && !e) continue
    acc.hazardAny[i] = 1
    for (const s of sourcesIn(p, x, e)) if (g.sources[s].volts > acc.volts[i]) acc.volts[i] = g.sources[s].volts
  }
}

/** A converter's input in the current state (spec 1.3). */
export function inputState(p: Prepared, c: GConverter): ConverterStatus {
  const [ra, rb] = [p.root[c.a], p.root[c.b]]
  const [ia, ib] = [p.ident[ra], p.ident[rb]]
  if (!ia && !ib) return !p.power[ra] && !p.power[rb] ? { state: 'unpowered', why: null } : { state: 'unknown', why: 'it gets mains only through a load or a leakage path' }
  if (ra === rb) return { state: 'unknown', why: 'its two inputs are joined to each other' }
  if (!ia || !ib) return { state: 'unknown', why: `only ${c.names[ia ? 0 : 1]} is connected to an outlet` }
  const single = (x: number) => (x & (x - 1)) === 0
  const sourceCount = (x: number) => p.g.sources.filter((s) => x & (bitOf(s.index, 'L') | bitOf(s.index, 'N') | bitOf(s.index, 'PE'))).length
  if (!single(ia) || !single(ib)) return { state: 'unknown', why: sourceCount(ia | ib) > 1 ? 'its inputs come from two different outlets' : 'an input is on more than one conductor' }
  const [a, b] = [decodeSingle(ia), decodeSingle(ib)]
  if (a.s !== b.s) return { state: 'unknown', why: 'its inputs come from two different outlets' }
  if (a.c === b.c) return { state: 'unknown', why: `both inputs are on ${a.c}` }
  if (a.c === 'PE' || b.c === 'PE') return { state: 'unknown', why: 'an input is on earth' }
  const v = p.g.sources[a.s].volts
  if (v < c.range[0] || v > c.range[1]) return { state: 'unknown', why: `it takes ${volt(c.range[0])} to ${volt(c.range[1])} AC but gets ${volt(v)}` }
  return { state: 'powered', why: null }
}

/** Powered in any state wins; unknown wins over unpowered (keeping the first unknown reason); unpowered only when so in every state. */
function combine(cur: ConverterStatus | null, st: ConverterStatus): ConverterStatus {
  if (!cur) return st
  if (cur.state === 'powered') return cur
  if (st.state === 'powered') return st
  return cur.state === 'unpowered' && st.state === 'unknown' ? st : cur
}

function availabilityRule(acc: Acc) {
  for (const i of acc.p.converterIdx) acc.converters[i] = combine(acc.converters[i], inputState(acc.p, acc.p.g.converters[i]))
}

export const STATE_RULES: ((acc: Acc, mask: number) => void)[] = [availabilityRule]

export function visitState(acc: Acc, mask: number): void {
  track(acc)
  for (const rule of STATE_RULES) rule(acc, mask)
}

/** The drafts of one unit's findings, each worded with its minimal witness. */
export function finishStates(acc: Acc): MainsDraft[] {
  return [...acc.seen.values()].map((s) => {
    const kept = minimalWitness(s.holds, acc.cands.length, s.first)
    const when = statePhrase(acc.p.g, acc.cands, kept, s.first)
    return s.build(when ? ` ${when}` : '')
  })
}

/** Folds one enumerated unit into the sheet's accumulator. */
export function absorb(into: Acc, unit: Acc): void {
  for (const i of unit.p.relevant) {
    into.hazardAny[i] |= unit.hazardAny[i]
    into.volts[i] = Math.max(into.volts[i], unit.volts[i])
    into.identUnion[i] |= unit.identUnion[i]
  }
  unit.converters.forEach((c, i) => {
    if (c) into.converters[i] = combine(into.converters[i], c)
  })
  unit.loadComplete.forEach((v, i) => (into.loadComplete[i] |= v))
  unit.loadFit.forEach((v, i) => (into.loadFit[i] |= v))
  into.finished.push(...finishStates(unit))
}

/**
 * When the states were not enumerated (too many groups or sources): every node a source's L or N
 * could reach is taken as hazardous at the highest such voltage. A converter is unknown when any
 * source terminal (L, N or PE) shares a possible-connectivity component with an input; unpowered only
 * when none does, which is a proof, not an enumeration result (Resolution 11).
 */
export function conservative(acc: Acc): void {
  const { p } = acc
  const g = p.g
  const reach = new Map<number, number>()
  const any = new Set<number>()
  for (const s of g.sources) {
    for (const x of [...s.live, ...s.neutral]) reach.set(p.possible[x], Math.max(reach.get(p.possible[x]) ?? 0, s.volts))
    for (const x of [...s.live, ...s.neutral, ...s.earth]) any.add(p.possible[x])
  }
  for (const i of p.relevant) {
    const v = reach.get(p.possible[i])
    if (v === undefined) continue
    acc.hazardAny[i] = 1
    acc.volts[i] = v
  }
  g.converters.forEach((c, i) => {
    acc.converters[i] = any.has(p.possible[c.a]) || any.has(p.possible[c.b]) ? { state: 'unknown', why: 'the mains checks did not finish' } : { state: 'unpowered', why: null }
  })
}

/** Rule 11 (spec 1.3): a converter that is not powered, when it is wired or plugged at all. */
function converterPower(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.converters.flatMap((c, i): MainsDraft[] => {
    const st = acc.converters[i] ?? { state: 'unpowered', why: null }
    if (st.state === 'powered' || !g.connected.has(c.part.uid)) return []
    const d = c.part.designator
    const fix = c.plugIn ? 'Plug it fully into one outlet.' : `Wire ${c.names[0]} and ${c.names[1]} to L and N of one outlet.`
    const message = st.state === 'unpowered'
      ? `${d} has no mains input, so its outputs supply nothing. ${fix}`
      : `${d}'s mains input is not a complete connection (${st.why}), so its outputs are not counted as a supply. ${fix}`
    const keys = c.names.map((n) => nodeKey(c.part.uid, n))
    return [{ rule: 'no-power', subject: d, target: d, message, parts: [c.part.uid], pins: keys.map(pinOfKey), wires: [], causes: keys }]
  })
}

export const STATIC_RULES: ((acc: Acc) => MainsDraft[])[] = [converterPower]

export function staticDrafts(acc: Acc): MainsDraft[] {
  return STATIC_RULES.flatMap((rule) => rule(acc))
}
```

For a plug-in converter (a charger), `c.names` are its prong internal nodes, so its no-power `pins` highlight nothing on screen; the part itself is highlighted.

- [ ] **Step 4: Implement `src/format/mains.ts`**

```ts
// The mains analysis (spec docs/superpowers/specs/2026-09-27-mains-outlets-design.md): builds the
// conduction graph, enumerates every state of each unit's candidate contact groups (up to 16 groups
// and 10 sources on the sheet; beyond that it says so and stays conservative), runs the rules and
// hands the wiring checker and the renderer one shared result: findings, converter availability,
// dead outputs, the hazardous nets the DC rules must skip, and identity for colours. A sheet without
// mains data costs one scan of its parts.
import { type Diagram, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import { type Conductor, type Region, mainsOf } from './mainsModel.ts'
import { MAX_GROUPS, MAX_SOURCES, type MainsGraph, analyseState, buildMainsGraph, candidateGroups, decodeSingle, masksByPopcount, prepare, setState, units } from './mainsGraph.ts'
import { type ConverterStatus, type MainsDraft, absorb, conservative, newAcc, staticDrafts, visitState } from './mainsRules.ts'

export interface MainsAnalysis {
  graph: MainsGraph
  /** False when the states were not all enumerated (mains-incomplete). */
  complete: boolean
  /** Converter availability by part uid. */
  converters: Map<string, ConverterStatus>
  /** Every node key on a net that is hazardous in some state (every possibly hazardous one when incomplete). */
  hazardKeys: Set<string>
  /** Output pin keys of converters that are not powered. */
  deadOutputs: Map<string, 'unpowered' | 'unknown'>
  /** Resolution 19: the one conductor a node key carries in every state that gives it any identity, with its source's region; null otherwise. */
  conductorOf: (key: string) => { conductor: Conductor; region: Region | null } | null
  findings: MainsDraft[]
}

/** True when some part's module declares mains data. */
export function hasMainsData(d: Pick<Diagram, 'parts' | 'modules'>): boolean {
  return d.parts.some((p) => {
    const m = moduleOf(d, p.module)
    return !!m && mainsOf(m).any
  })
}

export function analyseMains(d: Diagram): MainsAnalysis | null {
  if (!hasMainsData(d)) return null
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))!
  const p = prepare(g)
  const cands = candidateGroups(g, p.possible)
  const incomplete = g.sources.length > MAX_SOURCES ? 'sources' : cands.length > MAX_GROUPS ? 'groups' : null
  const acc = newAcc(p, cands, incomplete)
  if (incomplete) conservative(acc)
  else
    for (const unit of units(p, cands)) {
      const sub = newAcc(unit.view, unit.cands, null)
      for (const mask of masksByPopcount(unit.cands.length)) {
        setState(unit.view, unit.cands, mask)
        analyseState(unit.view)
        visitState(sub, mask)
      }
      absorb(acc, sub)
    }
  const findings = [...acc.finished, ...staticDrafts(acc)]
  const converters = new Map(g.converters.map((c, i): [string, ConverterStatus] => [c.part.uid, acc.converters[i] ?? { state: 'unpowered', why: null }]))
  const deadOutputs = new Map<string, 'unpowered' | 'unknown'>()
  for (const c of g.converters) {
    const st = converters.get(c.part.uid)!
    if (st.state !== 'powered') for (const o of c.outputs) deadOutputs.set(nodeKey(c.part.uid, o), st.state)
  }
  const hazardKeys = new Set<string>()
  acc.hazardAny.forEach((h, i) => {
    if (h) for (const k of g.members[i]) hazardKeys.add(k)
  })
  const conductorOf = (key: string) => {
    const i = g.nodeOf.get(key)
    const x = i === undefined || incomplete ? 0 : acc.identUnion[i]
    if (!x || (x & (x - 1)) !== 0) return null
    const { s, c } = decodeSingle(x)
    return { conductor: c, region: g.sources[s].region }
  }
  return { graph: g, complete: !incomplete, converters, hazardKeys, deadOutputs, conductorOf, findings }
}

const cache = new WeakMap<Diagram['connections'], { parts: Diagram['parts']; modules: Diagram['modules']; result: MainsAnalysis | null }>()

/** `analyseMains` once per parts, connections and modules: the checker, the canvas and the sheet share it, so one edit enumerates once. */
export function analyseMainsCached(d: Diagram): MainsAnalysis | null {
  const hit = cache.get(d.connections)
  if (hit && hit.parts === d.parts && hit.modules === d.modules) return hit.result
  const result = analyseMains(d)
  cache.set(d.connections, { parts: d.parts, modules: d.modules, result })
  return result
}
```

- [ ] **Step 5: Gate the DC checker in `src/format/checks.ts`**

1. Extend `RuleId` and `RULES` per the table above.
2. Add to `interface Terminal`:

```ts
  /** An output of a converter that is not powered (spec 1.3): it feeds nothing and makes no supply; when unknown, what it would feed is reported as not checked. */
  dead?: 'unpowered' | 'unknown'
```

3. `sourceOf`: make its first line `if (t.dead) return null`. `mayFeed` is unchanged (a dead output is not a source, so it never counts as a feed). `drives`: `const drives = (t: Terminal) => (t.type === 'power_out' && !t.dead) || t.info.external.has(t.name)`.
4. In `checkDiagram`, right after `const nl = netlist(d, plugs)`:

```ts
  // Mains first (spec 3), from the analysis the renderer shares: what is hazardous never enters the
  // DC rules, and a converter that is not powered supplies nothing.
  const mains = analyseMainsCached(d)
  const hazardous = (key: string) => !!mains?.hazardKeys.has(key)
```

5. In `terminal()` add `dead: mains?.deadOutputs.get(key)` to the returned object.
6. Replace the `netTerms` line with:

```ts
  const netTerms = nl.nets.map((keys) => (keys.some(hazardous) ? [] : keys.map(terminal).filter((t): t is Terminal => t !== null)))
```

7. In the per-part power and ground loop change the `terms` filter to `.filter((t): t is Terminal => t !== null && !hazardous(t.key))`, and replace the no-power branch so a part fed only through an unknown converter is reported as not checked instead of unpowered:

```ts
      if (!fed) {
        const via = ins.flatMap((t) => others(t)).find((o) => o.dead === 'unknown')
        if (via)
          add({ rule: 'supply-unknown', subject: p.designator, target: p.designator,
            message: `${p.designator}'s power is not checked: it comes only from ${termName(via)}, and ${via.part.designator}'s mains input is not a complete connection.`,
            parts: [p.uid, via.part.uid], pins: ins.map(termPin), wires: [], causes: ins.map((t) => t.key) })
        else {
          // ...the existing no-power message and add(...) unchanged
        }
      }
```

8. Gate every source edge at both ends. Add `skip: (key: string) => boolean` to `PotentialInput`, pass `skip: hazardous`, and in `checkPotentials`'s per-part loop:

```ts
    // A switch or a declared common return with a pin on a hazardous net places nothing.
    if (info.switchPins && !info.switchPins.some((n) => skip(nodeKey(p.uid, n)))) { /* existing closedSwitch edge */ }
    for (const g of info.commonReturn)
      for (const n of g.slice(1)) {
        const [a, b] = [nodeKey(p.uid, g[0]), nodeKey(p.uid, n)]
        if (skip(a) || skip(b)) continue
        edges.push({ from: netOfKey(a), to: netOfKey(b), v: 0, fromKey: a, toKey: b })
      }
```

and, inside the sources loop, before `sources.set(s.id, s)`:

```ts
      // Mains never enters the potential solver (spec 3): not through the output, not through the
      // declared return, the only ground (an inferred return) or a diode's return.
      const ret = info.returnOf.get(s.term.name)
      const returnKeys = ret ? [nodeKey(p.uid, ret)] : info.grounds.map((g) => nodeKey(p.uid, g))
      if (skip(s.term.key) || returnKeys.some(skip)) continue
```

(the later `const ret = ...` line reuses this `ret`). In the load loop (`nl.nets.forEach` over power inputs), skip an input whose own grounds are all on hazardous nets: `if (t.info.grounds.length && t.info.grounds.every((g) => skip(nodeKey(t.part.uid, g)))) continue`; rule 1 reports that part.

9. Before `const rank = ...` add `for (const f of mains?.findings ?? []) add(f)`.
10. `import { analyseMainsCached } from './mains.ts'`. (The cycle `checks.ts` to `mains.ts` to `mainsRules.ts` back to `checks.ts` is a type-only import on the way back, so it is erased.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/format/mains.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS, including `src/format/checks.perf.test.ts` (no mains data there: the analysis returns after one scan of the parts).

- [ ] **Step 7: Commit**

```bash
git add src/format/mainsRules.ts src/format/mains.ts src/format/checks.ts src/format/mains.test.ts
git commit -m "Mains: analysis per enumeration unit, converter availability, the DC checker gate" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rules 1 to 3: mains on low-voltage wiring, shorts, crossed sources

**Files:**
- Modify: `src/format/mainsRules.ts` (append; register in `STATE_RULES`)
- Test: `src/format/mainsRules.test.ts` (create)

**Interfaces:**
- Consumes: `Acc`, `report`, `sourcesIn`, `sourcesText`, `wiresOfRoot`, `endpointOf`, `pinOfKey` (Task 5); `termAt`, `termName`, `bitOf`, `LN_MASK`, `GSource`, `GTerm` (Task 3); `isolationAdequate` (Task 2).
- Produces (in `mainsRules.ts`): `type LvClass = 'ordinary' | 'selv' | 'pelv' | 'secondary'`, `lvClass(t: GTerm): LvClass | null` (null for a terminal declared for mains), `energyPathWires(p: Prepared, r: number): string[]` (the wires on the way energy reaches root `r` in the current state: spec 3, path findings highlight the path), `lowVoltageRule`, `identityRules` (both appended to `STATE_RULES`).

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsRules.test.ts` (later tasks add `describe` blocks to it):

```ts
// The mains rules (spec section 3), each both ways, and the counterexamples of Astra's reviews.
import { describe, expect, it } from 'vitest'
import { checkDiagram, type Finding } from './checks.ts'
import type { Diagram } from './diagram.ts'
import { MAINS_MODULES, at, dupont, sheet, w } from './mains.testing.ts'

const only = (d: Diagram, rule: string): Finding[] => checkDiagram(d).filter((f) => f.rule === rule)
const msgs = (d: Diagram, rule: string) => only(d, rule).map((f) => f.message)
const rules = (d: Diagram) => new Set(checkDiagram(d).map((f) => f.rule))
/** Outlet XS1 plus the given parts, placed apart. */
const on = (parts: [string, string, string][], wires: ReturnType<typeof w>[], outlets = [['xs1', 'XS1', 't-outlet']]) =>
  sheet([...outlets, ...parts].map(([uid, des, m], i) => at(uid, des, m, i * 200)), wires)

describe('rule 1: mains on low-voltage wiring', () => {
  it('OFF SSR into a lamp into a GPIO (hazard reaches the GPIO), highlighting the whole energizing path', () => {
    const path = [w('xs1|L', 'k1|1'), w('k1|2', 'e1|L'), w('e1|N', 'u1|IO')]
    const d = on([['k1', 'K1', 't-ssr'], ['e1', 'E1', 't-lamp'], ['u1', 'U1', 't-mcu']], path)
    const found = only(d, 'mains-to-low-voltage')
    expect(found.map((f) => f.message)).toEqual([
      'U1 IO gets mains from XS1 (120 V). U1 is a low-voltage part: it may be destroyed, and anything touching it may become live. Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.',
    ])
    // Through the SSR's leakage and the lamp, back to the outlet's L: every wire on the way.
    expect([...found[0].wires].sort()).toEqual(path.map((c) => c.uid).sort())
  })
  it('basic-isolation secondary to a GPIO (error, bonded or not)', () => {
    for (const psu of ['t-psu-basic', 't-psu-basic-bonded']) {
      const d = on([['ps1', 'PS1', psu], ['u1', 'U1', 't-mcu']],
        [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|IO'), ...(psu.endsWith('bonded') ? [w('xs1|PE', 'ps1|PE')] : [])])
      const found = only(d, 'mains-to-low-voltage')
      expect(found.map((f) => f.target)).toContain('PS1 +V')
      expect(found.find((f) => f.target === 'PS1 +V')!.message).toBe(
        "PS1's low-voltage side is separated from mains only by basic insulation, so PS1 +V and U1 IO may be live: that side counts as mains. Do not wire it to anything a person can touch; use a converter with reinforced or double isolation.",
      )
    }
  })
  it('basic plus a declared protective screen and PE bond (PELV, allowed, DC checks kept)', () => {
    const d = on([['ps1', 'PS1', 't-psu-screen'], ['u1', 'U1', 't-mcu33']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND')])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
    // A 5 V output into a 3.3 V input: the DC checker still says so on a PELV output.
    expect(msgs(d, 'supply-too-high')).toEqual(['U1 VCC accepts up to 3.3 V but gets 5 V from PS1 +V. Use a 3.3 V supply instead.'])
  })
  it('reinforced with a PE bond (PELV)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|+V', 'u1|VCC'), w('ps1|-V', 'u1|GND')])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
    expect(rules(d).has('earth-bond')).toBe(false)
  })
})

describe('rule 2: mains shorts', () => {
  it('L to N of one outlet', () => {
    expect(msgs(on([], [w('xs1|L', 'xs1|N')]), 'mains-short')).toEqual([
      'XS1 L and N are joined: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
  it('L to PE of one outlet', () => {
    expect(msgs(on([], [w('xs1|L', 'xs1|PE')]), 'mains-short')).toEqual([
      'XS1 L is joined to earth: a short circuit to earth, which puts mains on everything earthed until the breaker trips. Remove the wire that joins them.',
    ])
  })
  it('names an OFF condition the short needs: L-S1-K1.COM, K1.NC to N, when S1 is on and K1 is released', () => {
    const wires = [w('xs1|L', 's1|1'), w('s1|2', 'k1|COM'), w('k1|NC', 'xs1|N')]
    const d = on([['s1', 'S1', 't-switch'], ['k1', 'K1', 't-relay']], wires)
    const found = only(d, 'mains-short')
    expect(found.map((f) => f.message)).toEqual([
      'XS1 L and N are joined when S1 is on and K1 is released: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
    expect([...found[0].wires].sort()).toEqual(wires.map((c) => c.uid).sort())
  })
  it('relay COM-NO and COM-NC both wired (each state, no impossible short)', () => {
    // L on NO, N on NC: a short would need COM on NO and NC at once, which a relay never does.
    const d = on([['k1', 'K1', 't-relay'], ['e1', 'E1', 't-lamp']],
      [w('xs1|L', 'k1|NO'), w('k1|NC', 'xs1|N'), w('k1|COM', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(rules(d).has('mains-short')).toBe(false)
  })
  it('two switches in series closing a short with seven or more other groups present (found)', () => {
    const others = Array.from({ length: 7 }, (_, i) => i + 3)
    const d = on([
      ['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'],
      ...others.flatMap((k): [string, string, string][] => [[`s${k}`, `S${k}`, 't-switch'], [`e${k}`, `E${k}`, 't-lamp']]),
    ], [
      w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 'xs1|N'),
      ...others.flatMap((k) => [w('xs1|L', `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, 'xs1|N')]),
    ])
    expect(msgs(d, 'mains-short')).toEqual([
      'XS1 L and N are joined when S1 and S2 are both on: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
  it('three switches in series L-S1-S2-S3-N with S2 touching neither end (found via possible connectivity)', () => {
    const d = on([['s1', 'S1', 't-switch'], ['s2', 'S2', 't-switch'], ['s3', 'S3', 't-switch']],
      [w('xs1|L', 's1|1'), w('s1|2', 's2|1'), w('s2|2', 's3|1'), w('s3|2', 'xs1|N')])
    expect(msgs(d, 'mains-short')).toEqual([
      'XS1 L and N are joined when S1, S2 and S3 are on: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.',
    ])
  })
})

describe('rule 3: two sources joined', () => {
  const two = [['xs1', 'XS1', 't-outlet'], ['xs2', 'XS2', 't-outlet-2']]
  it('L-L across outlets', () => {
    expect(msgs(on([], [w('xs1|L', 'xs2|L')], two), 'mains-cross-source')).toEqual([
      'XS1 L and XS2 L are joined. The two outlets may be on different phases, so up to twice the mains voltage can appear across the wiring, or one phase is shorted to the other. Power this part of the circuit from one outlet.',
    ])
  })
  it('L-N, L-PE and N-PE across outlets are errors', () => {
    expect(msgs(on([], [w('xs1|L', 'xs2|N')], two), 'mains-cross-source')).toEqual([
      'XS1 L is joined to XS2 N: current from one outlet returns through the other, which can overload a shared neutral or get past a breaker. Power this part of the circuit from one outlet.',
    ])
    expect(msgs(on([], [w('xs1|L', 'xs2|PE')], two), 'mains-cross-source')).toEqual([
      "XS1 L is joined to XS2's earth: a short circuit to earth from another outlet. Remove the wire that joins them.",
    ])
    expect(msgs(on([], [w('xs1|N', 'xs2|PE')], two), 'mains-cross-source')).toEqual([
      "XS1 N is joined to XS2's earth: neutral current flows on the earth wire. Keep each outlet's neutral apart from earth.",
    ])
  })
  it('N-N is a warning (shared neutral), PE-PE is allowed', () => {
    expect(msgs(on([], [w('xs1|N', 'xs2|N')], two), 'mains-shared-neutral')).toEqual([
      "XS1 N and XS2 N are joined: the two outlets share a neutral here. When a breaker switches one outlet off, its neutral can still carry current from the other. Keep each outlet's neutral separate.",
    ])
    const earth = on([], [w('xs1|PE', 'xs2|PE')], two)
    expect(rules(earth).has('mains-cross-source')).toBe(false)
    expect(rules(earth).has('mains-shared-neutral')).toBe(false)
  })
  it('two class 1 supplies with PE-bonded minus leads joined (no cross-source error)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['ps2', 'PS2', 't-psu-pelv']], [
      w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'),
      w('xs2|L', 'ps2|AC1'), w('xs2|N', 'ps2|AC2'), w('xs2|PE', 'ps2|PE'),
      w('ps1|-V', 'ps2|-V'),
    ], two)
    expect(rules(d).has('mains-cross-source')).toBe(false)
    expect(rules(d).has('mains-shared-neutral')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: FAIL (no `mains-to-low-voltage`, `mains-short` or cross-source findings yet).

- [ ] **Step 3: Implement (append to `src/format/mainsRules.ts`)**

Add to the imports: `type GSource`, `termAt`, `termName` from `./mainsGraph.ts`; `type Conductor`, `isolationAdequate` from `./mainsModel.ts`; `natural` from `./words.ts`.

```ts
// ---- Rule 1: mains reaching low-voltage wiring (spec 1.3, 1.4) ----

export type LvClass = 'ordinary' | 'selv' | 'pelv' | 'secondary'

/**
 * How a terminal counts when mains reaches it: a pin of a part with no mains data (a GPIO, a
 * breadboard strip) or an undeclared pin of a mains part is ordinary; a pin in a SELV or PELV domain
 * is that, or a secondary without protective separation when the isolation is not adequate; null
 * for a terminal the module declares for mains (the rating rules take it).
 */
export function lvClass(t: GTerm): LvClass | null {
  if (!t.info.any) return 'ordinary'
  const dom = t.info.domainOf.get(t.name)
  if (dom && dom.kind !== 'mains') return isolationAdequate(t.info) ? dom.kind : 'secondary'
  return t.info.terminals.has(t.name) ? null : 'ordinary'
}

interface Watch { node: number; terms: GTerm[]; cls: LvClass }
const watchCache = new WeakMap<Prepared, Watch[]>()
/** The relevant nodes holding a low-voltage terminal, with those terminals (sorted) and the worst class among them. */
function watchList(p: Prepared): Watch[] {
  let list = watchCache.get(p)
  if (list) return list
  list = []
  for (const i of p.relevant) {
    const classed = p.g.members[i].flatMap((k) => {
      const t = termAt(p.g, k)
      const c = t && lvClass(t)
      return t && c ? [{ t, c }] : []
    })
    if (!classed.length) continue
    const cls = (['secondary', 'selv', 'pelv', 'ordinary'] as const).find((c) => classed.some((x) => x.c === c))!
    list.push({ node: i, terms: classed.map((x) => x.t).sort((a, b) => natural.compare(termName(a), termName(b))), cls })
  }
  watchCache.set(p, list)
  return list
}

/**
 * The wires on the way energy reaches root `r` in the current state: every component on a shortest
 * chain of load, leakage and energize edges from a source's L to `r`, and `r`'s own (spec 3: a path
 * finding highlights the path, not only where it ends).
 */
export function energyPathWires(p: Prepared, r: number): string[] {
  const g = p.g
  const prev = new Map<number, number>()
  const queue: number[] = []
  for (const s of p.sources)
    for (const x of s.live) {
      const q = p.root[x]
      if (!prev.has(q)) {
        prev.set(q, -1)
        queue.push(q)
      }
    }
  const links: [number, number, boolean][] = [
    ...p.energy.map((e): [number, number, boolean] => [e.a, e.b, e.directed]),
    ...p.groupIdx.flatMap((gi) => g.groups[gi].leak[p.groupState[gi]].map(([a, b]): [number, number, boolean] => [a, b, false])),
  ]
  for (let q = 0; q < queue.length && !prev.has(r); q++) {
    const x = queue[q]
    for (const [a, b, directed] of links) {
      const [ra, rb] = [p.root[a], p.root[b]]
      const next = ra === x ? rb : !directed && rb === x ? ra : -1
      if (next >= 0 && !prev.has(next)) {
        prev.set(next, x)
        queue.push(next)
      }
    }
  }
  const on = new Set<number>([r])
  for (let x = prev.has(r) ? r : -1; x !== -1; x = prev.get(x)!) on.add(x)
  const out: string[] = []
  for (const i of p.relevant) if (on.has(p.root[i])) out.push(...g.wires[i])
  return out
}

function lowVoltageDraft(w: Watch, from: string, wires: string[], when: string): MainsDraft {
  const names = andList(w.terms.map(termName))
  const one = w.terms.length === 1
  const lead = w.terms[0]
  let message: string
  if (w.cls === 'secondary') {
    const conv = w.terms.find((t) => lvClass(t) === 'secondary')!
    const iso = conv.info.isolation === 'basic' ? 'basic insulation' : conv.info.isolation === 'none' ? 'no insulation at all' : 'insulation of unknown quality'
    message = `${conv.part.designator}'s low-voltage side is separated from mains only by ${iso}, so ${names} may be live${when}: that side counts as mains. Do not wire it to anything a person can touch; use a converter with reinforced or double isolation.`
  } else if (w.cls === 'selv' || w.cls === 'pelv') {
    message = `${names} ${one ? 'is' : 'are'} on a low-voltage side that must never meet mains, but ${one ? 'gets' : 'get'} mains from ${from}${when}. Remove the wire that joins ${one ? 'it' : 'them'} to mains.`
  } else {
    const parts = [...new Set(w.terms.map((t) => t.part.designator))]
    const it = parts.length === 1 ? 'it' : 'they'
    message = `${names} ${one ? 'gets' : 'get'} mains from ${from}${when}. ${andList(parts)} ${parts.length === 1 ? 'is a low-voltage part' : 'are low-voltage parts'}: ${it} may be destroyed, and anything touching ${parts.length === 1 ? 'it' : 'them'} may become live. Remove the wire that brings mains there, and switch mains only through a relay or SSR rated for it.`
  }
  return { rule: 'mains-to-low-voltage', subject: lead.part.designator, target: termName(lead), message, parts: w.terms.map((t) => t.part.uid), pins: w.terms.map(endpointOf), wires, causes: w.terms.map((t) => t.key) }
}

function lowVoltageRule(acc: Acc, mask: number) {
  const { p } = acc
  for (const w of watchList(p)) {
    const r = p.root[w.node]
    const x = p.ident[r] & LN_MASK
    const e = p.power[r]
    if (!x && !e) continue
    report(acc, `mains-to-low-voltage|${w.terms.map((t) => t.key).join(',')}`, mask, () => {
      const from = sourcesText(p.g, sourcesIn(p, x, e))
      const wires = energyPathWires(p, r)
      return (when) => lowVoltageDraft(w, from, wires, when)
    })
  }
}

// ---- Rules 2 and 3: identities that must never meet (spec 3) ----

const CONDS: Conductor[] = ['L', 'N', 'PE']

function shortDraft(p: Prepared, r: number, s: GSource, other: 'N' | 'PE') {
  const wires = wiresOfRoot(p, r)
  const d = s.part.designator
  const keys = [...s.keys.L, ...s.keys[other]]
  return (when: string): MainsDraft => ({
    rule: 'mains-short', subject: d, target: `${d} L`,
    message: other === 'N'
      ? `${d} L and N are joined${when}: a short circuit across the outlet. The breaker should trip; until it does, the wiring may overheat. Remove the wire that joins them.`
      : `${d} L is joined to earth${when}: a short circuit to earth, which puts mains on everything earthed until the breaker trips. Remove the wire that joins them.`,
    parts: [s.part.uid], pins: keys.map(pinOfKey), wires, causes: keys,
  })
}

function crossDraft(p: Prepared, r: number, s: GSource, a: Conductor, t: GSource, b: Conductor) {
  // Name the side carrying L first, then N.
  const rank = (c: Conductor) => CONDS.indexOf(c)
  const [x, cx, y, cy] = rank(a) <= rank(b) ? [s, a, t, b] : [t, b, s, a]
  const wires = wiresOfRoot(p, r)
  const [X, Y] = [x.part.designator, y.part.designator]
  const keys = [...x.keys[cx], ...y.keys[cy]]
  const text = (when: string) =>
    cx === 'L' && cy === 'L' ? `${X} L and ${Y} L are joined${when}. The two outlets may be on different phases, so up to twice the mains voltage can appear across the wiring, or one phase is shorted to the other. Power this part of the circuit from one outlet.`
    : cx === 'L' && cy === 'N' ? `${X} L is joined to ${Y} N${when}: current from one outlet returns through the other, which can overload a shared neutral or get past a breaker. Power this part of the circuit from one outlet.`
    : cx === 'L' ? `${X} L is joined to ${Y}'s earth${when}: a short circuit to earth from another outlet. Remove the wire that joins them.`
    : cx === 'N' && cy === 'N' ? `${X} N and ${Y} N are joined${when}: the two outlets share a neutral here. When a breaker switches one outlet off, its neutral can still carry current from the other. Keep each outlet's neutral separate.`
    : `${X} N is joined to ${Y}'s earth${when}: neutral current flows on the earth wire. Keep each outlet's neutral apart from earth.`
  return (when: string): MainsDraft => ({
    rule: cx === 'N' && cy === 'N' ? 'mains-shared-neutral' : 'mains-cross-source', subject: X, target: `${X} ${cx}`, message: text(when),
    parts: [x.part.uid, y.part.uid], pins: keys.map(pinOfKey), wires, causes: keys,
  })
}

function identityRules(acc: Acc, mask: number) {
  const { p } = acc
  for (const r of p.srcRoots) {
    const x = p.ident[r]
    for (const s of p.sources) {
      const has = (c: Conductor) => (x & bitOf(s.index, c)) !== 0
      if (has('L') && has('N')) report(acc, `mains-short|${s.id}|N`, mask, () => shortDraft(p, r, s, 'N'))
      if (has('L') && has('PE')) report(acc, `mains-short|${s.id}|PE`, mask, () => shortDraft(p, r, s, 'PE'))
      for (const t of p.sources) {
        if (t.index <= s.index) continue
        for (const a of CONDS)
          for (const b of CONDS) {
            if (!(x & bitOf(s.index, a)) || !(x & bitOf(t.index, b)) || (a === 'PE' && b === 'PE')) continue
            const pair = [`${s.id}:${a}`, `${t.id}:${b}`].sort().join('+')
            report(acc, `${a === 'N' && b === 'N' ? 'mains-shared-neutral' : 'mains-cross-source'}|${pair}`, mask, () => crossDraft(p, r, s, a, t, b))
          }
      }
    }
  }
}

STATE_RULES.push(lowVoltageRule, identityRules)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsRules.ts src/format/mainsRules.test.ts
git commit -m "Mains: rules 1 to 3 (low-voltage wiring, shorts, crossed sources)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rules 4, 5 and 12: voltage, ratings, missing data

**Files:**
- Modify: `src/format/mainsRules.ts` (append; register)
- Test: `src/format/mainsRules.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 and Task 6 helpers; `identAt` (Task 3); `mainsOf`.
- Produces: `across(p: Prepared, a: number, b: number): number | null` (the source whose L and N sit across a and b), `acrossFit(p: Prepared, a: number, b: number): boolean` (the same with every empty fuse holder taken as fitted, Resolution 28), `voltageRule` (state), `ratingRules` and `dataMissing` (static). `voltageRule` fills `acc.loadComplete` and `acc.loadFit` (Task 10 reads them), and reports a load with no range as not checked (Resolution 14).

- [ ] **Step 1: Write the failing tests (append to `src/format/mainsRules.test.ts`)**

```ts
describe('rule 4: wrong mains voltage', () => {
  it('a 120 V lamp on a 230 V outlet', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], [['xs1', 'XS1', 't-outlet-eu']])
    expect(msgs(d, 'mains-voltage')).toEqual(['E1 is made for 110 V to 130 V AC, but XS1 gives 230 V. Use one made for 230 V, or power it from an outlet it is made for.'])
  })
  it('a converter whose range excludes the outlet voltage (set on the outlet)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet', 0, 0, { values: { acVoltage: { value: 277, unit: 'VAC' } } }), at('ps1', 'PS1', 't-psu', 200)],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2')])
    expect(msgs(d, 'mains-voltage')).toEqual(['PS1 takes 100 V to 240 V AC, but XS1 gives 277 V. Use a converter made for 277 V.'])
  })
  it('a load without a voltage range says its voltage compatibility was not checked', () => {
    const noRange = { ...MAINS_MODULES['t-lamp'], id: 't-lamp-norange', electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load' }], protection: 'class-2', ratings: [{ pins: ['L', 'N'], kind: 'terminal', service: 'ac', volts: 250, provenance: 'datasheet' }] } }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-norange', 200)], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], { 't-lamp-norange': noRange })
    expect(msgs(d, 'data-missing')).toEqual([
      "E1's module gives no voltage range, so whether XS1's 120 V suits it is not checked. Add its rated voltage (electrical.conducts range) from the datasheet.",
    ])
  })
  it('stays quiet inside the range', () => {
    expect(rules(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])).has('mains-voltage')).toBe(false)
  })
})

describe('rule 5: ratings, relevance before adequacy', () => {
  const eu = [['xs1', 'XS1', 't-outlet-eu']]
  it('125 VAC terminal on 230 VAC (mains-rating, not rule 1)', () => {
    const d = on([['x1', 'X1', 't-term-125']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'mains-rating')).toEqual(['X1 1 and X1 1b are rated 125 V AC, but get 230 V. Use a part rated for at least 230 V AC.'])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('mains-domain terminal with no rating (rating-unknown, not rule 1)', () => {
    const d = on([['x1', 'X1', 't-term-bare']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'rating-unknown')).toEqual([
      "X1 1 and X1 1b are on mains (230 V), but X1's module gives no AC rating for them, so Circuitoon cannot tell whether they are safe there. Check the datasheet for an AC rating of at least 230 V.",
    ])
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('300 VDC-only terminal on 230 VAC (rating)', () => {
    const d = on([['x1', 'X1', 't-term-dc']], [w('xs1|L', 'x1|1')], eu)
    expect(rules(d).has('rating-unknown')).toBe(true)
    expect(rules(d).has('mains-rating')).toBe(false)
    expect(rules(d).has('mains-to-low-voltage')).toBe(false)
  })
  it('conditional Phoenix rating (rating-conditional)', () => {
    const d = on([['x1', 'X1', 't-term-cond']], [w('xs1|L', 'x1|1')], eu)
    expect(msgs(d, 'rating-conditional')).toEqual([
      "X1's 300 V AC rating holds only for overvoltage category III and pollution degree 2. Circuitoon cannot see that on the drawing: check it on the real build.",
    ])
  })
  it('an unverified rating warns, an adequate datasheet rating is silent', () => {
    expect(msgs(on([['x1', 'X1', 't-term-unverified']], [w('xs1|L', 'x1|1')], eu), 'rating-unverified')).toEqual([
      "X1's 300 V AC rating is not verified for this exact part (Test terminal block clone). Check the maker's data for the part you use.",
    ])
    const ok = on([['x1', 'X1', 't-term']], [w('xs1|L', 'x1|1')], eu)
    for (const r of ['mains-rating', 'rating-unknown', 'rating-conditional', 'rating-unverified']) expect(rules(ok).has(r)).toBe(false)
  })
  it("an outlet's own terminals are checked against the voltage set on it", () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet', 0, 0, { values: { acVoltage: { value: 230, unit: 'VAC' } } })], [])
    // PE is not hazardous (spec 1.2), so only L and N are judged.
    expect(msgs(d, 'mains-rating')).toEqual(['XS1 L and XS1 N are rated 125 V AC, but get 230 V. Use a part rated for at least 230 V AC.'])
  })
})

describe('rule 12: missing mains data', () => {
  it("a converter's outputs outside every domain are taken as live, and named", () => {
    const d = on([['ps1', 'PS1', 't-psu-mainsonly'], ['u1', 'U1', 't-mcu']], [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('ps1|+V', 'u1|IO')])
    expect(msgs(d, 'data-missing')).toEqual([
      "PS1's module leaves +V and -V outside every domain (electrical.domains), so the checks treat them as live. Add its domains and isolation from the datasheet.",
    ])
    expect(rules(d).has('mains-to-low-voltage')).toBe(true)
  })
  it('a mains terminal with no conduction data is checked conservatively and says so', () => {
    const d = on([['u1', 'U1', 't-undeclared']], [w('xs1|L', 'u1|A')])
    expect(msgs(d, 'data-missing')).toEqual([
      "U1's module does not say how A and B conduct, so the mains checks assume the worst for them: mains on any of them reaches the others. Add conduction data to its module (electrical.internal, conducts, contacts or protective).",
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: FAIL (no `mains-voltage`, `mains-rating`, `rating-*` or `data-missing` findings yet).

- [ ] **Step 3: Implement (append to `src/format/mainsRules.ts`; import `identAt`, `type GLoad` from `./mainsGraph.ts`, `type Rating` from `./mainsModel.ts`, `moduleOf` from `./diagram.ts`)**

```ts
// ---- Rule 4: a load's or converter's range excludes its source's voltage ----

/** The source whose L and N sit across nodes a and b (either way round) in this state, or null. */
export function across(p: Prepared, a: number, b: number): number | null {
  const [x, y] = [identAt(p, a), identAt(p, b)]
  for (const s of p.sources) {
    const L = bitOf(s.index, 'L')
    const N = bitOf(s.index, 'N')
    if ((x & L && y & N) || (x & N && y & L)) return s.index
  }
  return null
}

/** Resolution 28: with every empty fuse holder taken as fitted, L and N of one source reach a and b. */
export function acrossFit(p: Prepared, a: number, b: number): boolean {
  if (!p.anyAbsent) return false
  const [ra, rb] = [p.fitRoot[a], p.fitRoot[b]]
  const on = (xs: number[], r: number) => xs.some((x) => p.fitRoot[x] === r)
  return p.sources.some((s) => (on(s.live, ra) && on(s.neutral, rb)) || (on(s.live, rb) && on(s.neutral, ra)))
}

const rangeText = (r: [number, number]) => (r[0] === r[1] ? volt(r[0]) : `${volt(r[0])} to ${volt(r[1])}`)

function voltageRule(acc: Acc, mask: number) {
  const { p } = acc
  const g = p.g
  const check = (part: GLoad['part'], a: number, b: number, range: [number, number] | null, kind: 'load' | 'converter', i: number) => {
    if (kind === 'load' && acrossFit(p, a, b)) acc.loadFit[i] = 1
    const s = across(p, a, b)
    if (s === null) return
    if (kind === 'load') acc.loadComplete[i] = 1
    const v = g.sources[s].volts
    const src = g.sources[s]
    if (!range) {
      // Resolution 14: never skipped in silence.
      report(acc, `data-missing|range|${part.uid}`, mask, () => (when) => ({
        rule: 'data-missing', subject: part.designator, target: part.designator,
        message: `${part.designator}'s module gives no voltage range, so whether ${src.part.designator}'s ${volt(v)} suits it is not checked${when}. Add its rated voltage (electrical.conducts range) from the datasheet.`,
        parts: [part.uid], pins: [], wires: [], causes: [nodeKey(part.uid, '#range')],
      }))
      return
    }
    if (v >= range[0] && v <= range[1]) return
    report(acc, `mains-voltage|${part.uid}|${src.id}`, mask, () => (when) => ({
      rule: 'mains-voltage', subject: part.designator, target: part.designator,
      message: kind === 'load'
        ? `${part.designator} is made for ${rangeText(range)} AC, but ${src.part.designator} gives ${volt(v)}${when}. Use one made for ${volt(v)}, or power it from an outlet it is made for.`
        : `${part.designator} takes ${rangeText(range)} AC, but ${src.part.designator} gives ${volt(v)}${when}. Use a converter made for ${volt(v)}.`,
      parts: [part.uid, src.part.uid], pins: [], wires: [], causes: [nodeKey(part.uid, '*'), ...src.keys.L],
    }))
  }
  for (const i of p.loadIdx) check(g.loads[i].part, g.loads[i].a, g.loads[i].b, g.loads[i].range, 'load', i)
  for (const i of p.converterIdx) check(g.converters[i].part, g.converters[i].a, g.converters[i].b, g.converters[i].range, 'converter', i)
}

// ---- Rule 5: ratings (spec 1.4) ----

/** Groups terminals of one part under one finding, so a six-way terminal block gives one line, not six. */
function grouped(): { add: (key: string, t: GTerm, v: number, extra?: Rating) => void; entries: () => { key: string; terms: GTerm[]; v: number; rating?: Rating }[] } {
  const map = new Map<string, { terms: GTerm[]; v: number; rating?: Rating }>()
  return {
    add: (key, t, v, rating) => {
      const e = map.get(key)
      if (e) {
        if (!e.terms.includes(t)) e.terms.push(t)
        e.v = Math.max(e.v, v)
      } else map.set(key, { terms: [t], v, rating })
    },
    entries: () => [...map].map(([key, e]) => ({ key, ...e, terms: e.terms.sort((a, b) => natural.compare(termName(a), termName(b))) })),
  }
}

function ratingRules(acc: Acc): MainsDraft[] {
  const { p } = acc
  const g = p.g
  const [bad, unknown, cond, unverified] = [grouped(), grouped(), grouped(), grouped()]
  for (const i of p.relevant) {
    if (!acc.hazardAny[i]) continue
    const v = acc.volts[i]
    for (const key of g.members[i]) {
      const t = termAt(g, key)
      if (!t || !t.info.any || lvClass(t) !== null) continue
      // A converter's AC input is judged by its range (rule 4), not a rating.
      if (t.info.acInput && (t.name === t.info.acInput.a || t.name === t.info.acInput.b)) continue
      const switching = t.info.contactTerminals.has(t.name)
      const relevant = t.info.ratings.filter((r) => r.pins.includes(t.name) && r.service !== 'dc' && (switching ? r.kind === 'switching' : r.kind !== 'switching'))
      if (!relevant.length) {
        unknown.add(t.part.uid, t, v)
        continue
      }
      const adequate = relevant.filter((r) => r.volts >= v).sort((a, b) => a.volts - b.volts)
      if (!adequate.length) {
        const best = relevant.reduce((a, b) => (b.volts > a.volts ? b : a))
        bad.add(`${t.part.uid}|${best.volts}`, t, v, best)
        continue
      }
      // The lowest adequate rating whose terms are met on paper, else the lowest adequate one.
      const plain = adequate.find((r) => !r.conditions && r.provenance === 'datasheet')
      if (plain) continue
      const r = adequate[0]
      if (r.conditions) cond.add(`${t.part.uid}|${t.info.ratings.indexOf(r)}`, t, v, r)
      if (r.provenance === 'unverified') unverified.add(`${t.part.uid}|${t.info.ratings.indexOf(r)}`, t, v, r)
    }
  }
  const draft = (rule: MainsDraft['rule'], e: { terms: GTerm[] }, message: string): MainsDraft => ({
    rule, subject: e.terms[0].part.designator, target: termName(e.terms[0]), message,
    parts: [e.terms[0].part.uid], pins: e.terms.map(endpointOf), wires: [], causes: e.terms.map((t) => t.key),
  })
  const names = (e: { terms: GTerm[] }) => andList(e.terms.map(termName))
  const are = (e: { terms: GTerm[] }) => (e.terms.length === 1 ? 'is' : 'are')
  return [
    ...bad.entries().map((e) => draft('mains-rating', e, `${names(e)} ${are(e)} rated ${volt(e.rating!.volts)} AC, but ${e.terms.length === 1 ? 'gets' : 'get'} ${volt(e.v)}. Use a part rated for at least ${volt(e.v)} AC.`)),
    ...unknown.entries().map((e) => {
      const them = e.terms.length === 1 ? 'it' : 'them'
      return draft('rating-unknown', e, `${names(e)} ${are(e)} on mains (${volt(e.v)}), but ${e.terms[0].part.designator}'s module gives no AC rating for ${them}, so Circuitoon cannot tell whether ${e.terms.length === 1 ? 'it is' : 'they are'} safe there. Check the datasheet for an AC rating of at least ${volt(e.v)}.`)
    }),
    ...cond.entries().map((e) => draft('rating-conditional', e, `${e.terms[0].part.designator}'s ${volt(e.rating!.volts)} AC rating holds only ${e.rating!.conditions}. Circuitoon cannot see that on the drawing: check it on the real build.`)),
    ...unverified.entries().map((e) => draft('rating-unverified', e, `${e.terms[0].part.designator}'s ${volt(e.rating!.volts)} AC rating is not verified for this exact part (${e.terms[0].module.name}). Check the maker's data for the part you use.`)),
    ...isolationUnverified(acc),
  ]
}

/** A module whose isolation class comes from a similar part, not this exact one (a relay clone board), once it is on mains. */
function isolationUnverified(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    if (info.isolationProvenance !== 'unverified' || !info.domains.length) return []
    const onMains = info.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins).some((n) => {
      const i = g.nodeOf.get(nodeKey(part.uid, n))
      return i !== undefined && acc.hazardAny[i] === 1
    })
    if (!onMains) return []
    return [{ rule: 'rating-unverified', subject: part.designator, target: part.designator,
      message: `${part.designator}'s isolation between mains and its low-voltage side is not verified for this exact part (${m.name}). Check the maker's data for the part you use.`,
      parts: [part.uid], pins: [], wires: [], causes: [nodeKey(part.uid, '#isolation')] }]
  })
}

// ---- Rule 12: missing data (spec 1.2, 3) ----

function dataMissing(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    const hot = (n: string) => {
      const i = g.nodeOf.get(nodeKey(part.uid, n))
      return i !== undefined && acc.hazardAny[i] === 1
    }
    const out: MainsDraft[] = []
    const undeclared = [...info.terminals].filter((t) => !info.declaredConduction.has(t)).sort(natural.compare)
    if (undeclared.length && undeclared.some(hot))
      out.push({ rule: 'data-missing', subject: part.designator, target: part.designator,
        message: `${part.designator}'s module does not say how ${andList(undeclared)} ${undeclared.length === 1 ? 'conducts' : 'conduct'}, so the mains checks assume the worst for ${undeclared.length === 1 ? 'it' : 'them'}: mains on any of them reaches the others. Add conduction data to its module (electrical.internal, conducts, contacts or protective).`,
        parts: [part.uid], pins: undeclared.map((n) => ({ part: part.uid, pin: n })), wires: [], causes: undeclared.map((n) => nodeKey(part.uid, n)) })
    // Resolution 27: a converter's pins outside every domain, or no isolation statement at all.
    const uncovered = info.acInput ? uncoveredPins(m, info) : []
    if (info.acInput && (uncovered.length || info.isolation === null) && (hot(info.acInput.a) || hot(info.acInput.b)))
      out.push({ rule: 'data-missing', subject: part.designator, target: part.designator,
        message: uncovered.length
          ? `${part.designator}'s module leaves ${andList(uncovered)} outside every domain (electrical.domains), so the checks treat ${uncovered.length === 1 ? 'it' : 'them'} as live. Add its domains and isolation from the datasheet.`
          : `${part.designator}'s module does not state the isolation between mains and its low-voltage side (electrical.isolation), so the checks treat that side as live. Add it from the datasheet, or "unknown" when the datasheet does not state it.`,
        parts: [part.uid], pins: uncovered.map((n) => ({ part: part.uid, pin: n })), wires: [], causes: [nodeKey(part.uid, '#domains')] })
    return out
  })
}

STATE_RULES.push(voltageRule)
STATIC_RULES.push(ratingRules, dataMissing)
```

Also add `import { mainsOf, uncoveredPins } from './mainsModel.ts'`. Note: the `causes` of rule 4 and the isolation findings use a pseudo key (`'*'`, `'#isolation'`, `'#domains'`) so the finding id stays stable; it is never shown.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsRules.ts src/format/mainsRules.test.ts
git commit -m "Mains: rules 4, 5 and 12 (voltage, ratings, missing data)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Protective-conductor discovery

**Files:**
- Create: `src/format/mainsProtective.ts`
- Test: `src/format/mainsProtective.test.ts`

**Interfaces:**
- Consumes: `MainsGraph`, `termAt` (Task 3); `lvClass` (Task 6); `mainsOf`; `plugsOf`; `moduleOf`; `nodeKey`.
- Produces (in `mainsProtective.ts`):
  - `interface Through { part: PartInstance; kind: 'switch' | 'relay' | 'ssr' | 'fuse'; wires: string[] }` (a switch, relay, SSR or fuse on a protective path, with the protective wires of its block: the path it sits on)
  - `interface ProtectivePaths { wires: Set<string>; through: Through[] }`
  - `protectivePaths(g: MainsGraph): ProtectivePaths` (cached per graph)

Protective conductors (spec 1.6) are found on a terminal-level graph that is independent of contact states: vertices are terminal keys declared for mains, PE terminals of class 1 parts, and declared bonds; edges are wires between two such terminals, mated plug contacts, `internal` joins of mains parts, every contact position and every protective edge. An ordinary low-voltage pin is never a vertex, so a functional DC ground that reaches PE only through a part's DC pin is never on a path. An edge lies on some simple path between a source's earth terminal S and a protective terminal T exactly when its biconnected block lies on the block-cut tree path between S and T: that is how every parallel and redundant path is included.

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsProtective.test.ts`:

```ts
// Protective conductors (spec 1.6): every wire and part edge on any path between a source's earth and
// a protective terminal, parallel and redundant paths included, never through a low-voltage pin.
import { describe, expect, it } from 'vitest'
import { plugsOf } from './breadboard.ts'
import { netlist } from './netlist.ts'
import type { Connection, Diagram } from './diagram.ts'
import { buildMainsGraph } from './mainsGraph.ts'
import { protectivePaths } from './mainsProtective.ts'
import { at, dupont, sheet, w } from './mains.testing.ts'

const paths = (d: Diagram) => {
  const plugs = plugsOf(d)
  return protectivePaths(buildMainsGraph(d, plugs, netlist(d, plugs))!)
}
const uids = (cs: Connection[]) => cs.map((c) => c.uid).sort()

describe('protectivePaths', () => {
  it('two parallel PE wires to a class 1 lamp are both protective', () => {
    const pe = [dupont('xs1|PE', 'e1|PE'), dupont('e1|PE', 'xs1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200)], [w('xs1|L', 'e1|L'), ...pe])
    expect([...paths(d).wires].sort()).toEqual(uids(pe))
  })
  it('a switched branch beside a permanent PE wire is on a path, with its whole loop', () => {
    const loop = [w('xs1|PE', 'e1|PE'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('s1', 'S1', 't-switch', 200), at('e1', 'E1', 't-lamp-c1', 400)], loop)
    const p = paths(d)
    expect([...p.wires].sort()).toEqual(uids(loop))
    expect(p.through.map((t) => [t.part.designator, t.kind, [...t.wires].sort()])).toEqual([['S1', 'switch', uids(loop)]])
  })
  it('a DC ground wire hanging off a bonded supply minus is not protective', () => {
    const gnd = dupont('ps1|-V', 'u1|GND')
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('ps1', 'PS1', 't-psu-pelv', 200), at('u1', 'U1', 't-mcu', 400)],
      [w('xs1|PE', 'ps1|PE'), gnd])
    expect(paths(d).wires.has(gnd.uid)).toBe(false)
  })
  it('a path through a low-voltage pin is not a protective path', () => {
    const via = [w('xs1|PE', 'u1|GND'), w('u1|GND', 'e1|PE')]
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('u1', 'U1', 't-mcu', 200), at('e1', 'E1', 't-lamp-c1', 400)], via)
    expect([...paths(d).wires]).toEqual([])
  })
})
```

(`via` joins at the net level too: `U1 GND` is one node with both wires, but that node is an ordinary pin, so neither wire is a protective edge.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsProtective.test.ts`
Expected: FAIL (`./mainsProtective.ts` does not exist).

- [ ] **Step 3: Implement `src/format/mainsProtective.ts`**

```ts
// Protective conductors (spec 1.6): every wire and part edge on any simple path between a source's
// earth terminal and a protective terminal (a class 1 part's PE terminal or a declared bond), found on
// a terminal-level graph with every contact position conducting. A low-voltage pin is never a vertex,
// so a functional DC ground reaching PE through a part's DC pin is never on a path. Parallel and
// redundant paths are all included: an edge is on some path exactly when its biconnected block is on
// the block-cut tree path between the two ends. Pure; cached per graph.
import { type PartInstance, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { nodeKey } from './netlist.ts'
import { mainsOf } from './mainsModel.ts'
import { type MainsGraph, termAt } from './mainsGraph.ts'
import { lvClass } from './mainsRules.ts'

export interface Through { part: PartInstance; kind: 'switch' | 'relay' | 'ssr' | 'fuse'; wires: string[] }
export interface ProtectivePaths { wires: Set<string>; through: Through[] }
interface PEdge { a: number; b: number; wire?: string; through?: { part: PartInstance; kind: Through['kind'] } }

/** Biconnected blocks (Tarjan, iterative, parallel edges kept apart): block id per edge and cut vertices. */
function blocks(n: number, edges: PEdge[]): { blockOf: Int32Array; cut: Uint8Array; count: number } {
  const adj: number[][] = Array.from({ length: n }, () => [])
  edges.forEach((e, i) => {
    adj[e.a].push(i)
    adj[e.b].push(i)
  })
  const tin = new Int32Array(n).fill(-1)
  const low = new Int32Array(n)
  const blockOf = new Int32Array(edges.length).fill(-1)
  const cut = new Uint8Array(n)
  const estack: number[] = []
  let time = 0
  let count = 0
  for (let root = 0; root < n; root++) {
    if (tin[root] >= 0) continue
    tin[root] = low[root] = time++
    let children = 0
    const stack: [number, number, number][] = [[root, -1, 0]]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [v, via] = top
      if (top[2] < adj[v].length) {
        const ei = adj[v][top[2]++]
        if (ei === via) continue
        const e = edges[ei]
        const u = e.a === v ? e.b : e.a
        if (tin[u] < 0) {
          estack.push(ei)
          tin[u] = low[u] = time++
          stack.push([u, ei, 0])
          if (v === root) children++
        } else if (tin[u] < tin[v]) {
          estack.push(ei)
          low[v] = Math.min(low[v], tin[u])
        }
      } else {
        stack.pop()
        if (!stack.length) continue
        const parent = stack[stack.length - 1][0]
        low[parent] = Math.min(low[parent], low[v])
        if (low[v] >= tin[parent]) {
          if (parent !== root) cut[parent] = 1
          let ei: number
          do {
            ei = estack.pop()!
            blockOf[ei] = count
          } while (ei !== via)
          count++
        }
      }
    }
    if (children > 1) cut[root] = 1
  }
  return { blockOf, cut, count }
}

const cache = new WeakMap<MainsGraph, ProtectivePaths>()

export function protectivePaths(g: MainsGraph): ProtectivePaths {
  const hit = cache.get(g)
  if (hit) return hit
  const ids = new Map<string, number>()
  const vertex = (key: string): number | null => {
    const t = termAt(g, key)
    if (!t || !(lvClass(t) === null || t.info.bonds.has(t.name))) return null
    let i = ids.get(key)
    if (i === undefined) ids.set(key, (i = ids.size))
    return i
  }
  const edges: PEdge[] = []
  const join = (ka: string, kb: string, extra: Omit<PEdge, 'a' | 'b'> = {}) => {
    const [a, b] = [vertex(ka), vertex(kb)]
    if (a !== null && b !== null && a !== b) edges.push({ a, b, ...extra })
  }
  for (const c of g.d.connections) if (!g.broken.has(c.uid)) join(nodeKey(c.from.part, c.from.pin), nodeKey(c.to.part, c.to.pin), { wire: c.uid })
  for (const pl of plugsOf(g.d)) join(nodeKey(pl.part, pl.pin), nodeKey(pl.board, pl.group))
  const T = new Set<number>()
  for (const part of g.mainsParts) {
    const m = moduleOf(g.d, part.module)!
    const info = mainsOf(m)
    for (const grp of m.internal ?? []) for (let i = 1; i < grp.length; i++) join(nodeKey(part.uid, grp[0]), nodeKey(part.uid, grp[i]))
    for (const c of info.contacts)
      for (const pole of c.poles) for (const other of [pole.no, pole.nc]) if (other) join(nodeKey(part.uid, pole.com), nodeKey(part.uid, other), { through: { part, kind: c.kind } })
    for (const e of info.protective) join(nodeKey(part.uid, e.from), nodeKey(part.uid, e.to), { through: { part, kind: 'fuse' } })
    const targets = [...info.bonds, ...(info.protection === 'class-1' ? [...info.requirement].filter(([, r]) => r === 'PE').map(([n]) => n) : [])]
    for (const n of targets) {
      const i = vertex(nodeKey(part.uid, n))
      if (i !== null) T.add(i)
    }
  }
  const S = new Set(g.sources.flatMap((s) => s.keys.PE).map((k) => ids.get(k)).filter((i): i is number => i !== undefined))
  const out: ProtectivePaths = { wires: new Set(), through: [] }
  if (S.size && T.size && edges.length) {
    const { blockOf, cut, count } = blocks(ids.size, edges)
    // Block-cut tree: blocks are 0..count-1, cut vertex v is count + v.
    const adj = new Map<number, Set<number>>()
    const link = (x: number, y: number) => {
      ;(adj.get(x) ?? adj.set(x, new Set()).get(x)!).add(y)
      ;(adj.get(y) ?? adj.set(y, new Set()).get(y)!).add(x)
    }
    const anyBlock = new Int32Array(ids.size).fill(-1)
    edges.forEach((e, i) => {
      for (const v of [e.a, e.b]) {
        anyBlock[v] = blockOf[i]
        if (cut[v]) link(blockOf[i], count + v)
      }
    })
    const treeNode = (v: number) => (cut[v] ? count + v : anyBlock[v])
    const marked = new Set<number>()
    for (const s of S) {
      const from = treeNode(s)
      if (from < 0) continue
      const prev = new Map<number, number>([[from, -1]])
      const queue = [from]
      for (let q = 0; q < queue.length; q++)
        for (const y of adj.get(queue[q]) ?? [])
          if (!prev.has(y)) {
            prev.set(y, queue[q])
            queue.push(y)
          }
      for (const t of T) {
        let x = treeNode(t)
        if (x < 0 || !prev.has(x)) continue
        for (; x !== -1; x = prev.get(x)!) if (x < count) marked.add(x)
      }
    }
    const blockWires = new Map<number, string[]>()
    edges.forEach((e, i) => {
      if (!marked.has(blockOf[i]) || !e.wire) return
      out.wires.add(e.wire)
      blockWires.set(blockOf[i], [...(blockWires.get(blockOf[i]) ?? []), e.wire])
    })
    edges.forEach((e, i) => {
      if (!marked.has(blockOf[i]) || !e.through || out.through.some((x) => x.part === e.through!.part)) return
      out.through.push({ ...e.through, wires: blockWires.get(blockOf[i]) ?? [] })
    })
  }
  cache.set(g, out)
  return out
}
```

(`mainsProtective.ts` imports `lvClass` from `mainsRules.ts`; `mainsRules.ts` imports `protectivePaths` in Tasks 9 and 10. Both uses are inside functions, so the module cycle is safe.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsProtective.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsProtective.ts src/format/mainsProtective.test.ts
git commit -m "Mains: protective-conductor discovery with parallel and redundant paths" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Rules 6 and 7: polarity (definite and uncertain) and earth

**Files:**
- Modify: `src/format/mainsRules.ts` (append; register)
- Test: `src/format/mainsRules.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 3 to 8 (`protectivePaths` from `mainsProtective.ts`).
- Produces: state rules `polarityRule`, `earthRules`; static rules `orphanEarth` (a class 1 PE terminal no source can reach, while its part is on mains: the per-state rule cannot see it, since that node is in no enumeration unit) and `earthPathRule`.

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('rule 6: polarity', () => {
  it('polarized lamp reversed (polarity, not short)', () => {
    const d = on([['e1', 'E1', 't-lamp']], [w('xs1|N', 'e1|L'), w('xs1|L', 'e1|N')])
    expect(msgs(d, 'polarity')).toEqual([
      'E1 is wired the wrong way round: E1 L is on N and E1 N is on L. If E1 is a lamp, its screw shell is live, so touching the bulb while changing it may shock. Swap the L and N wires to E1.',
    ])
    expect(rules(d).has('mains-short')).toBe(false)
  })
  it('a single-pole switch in the neutral', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('e1|N', 's1|1'), w('s1|2', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(['S1 switches the neutral when S1 is on: with S1 off, what it feeds stays live. Move S1 into the L wire.'])
  })
  it('a fuse in the neutral', () => {
    const d = on([['f1', 'F1', 't-fuse'], ['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('e1|N', 'f1|1'), w('f1|2', 'xs1|N')])
    expect(msgs(d, 'polarity')).toEqual(['F1 is in the neutral: when it blows, what it feeds stays live. Move F1 into the L wire.'])
  })
  it('on an unpolarized outlet the uncertainty is reported, never skipped (Resolution 22)', () => {
    const d = on([['e1', 'E1', 't-lamp-230']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')], [['xs1', 'XS1', 't-outlet-eu']])
    expect(msgs(d, 'polarity')).toEqual([
      "E1's polarity is not known: XS1 is an unpolarized outlet, so which of its slots is L is not known, and E1 L and E1 N may be on the wrong conductor. Use a polarized plug and outlet for a part whose L and N matter.",
    ])
  })
})

describe('rule 7: earth', () => {
  it("a class 1 lamp's PE terminal without earth (its PE node is connected to nothing)", () => {
    const d = on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')])
    expect(msgs(d, 'earth')).toEqual(["E1 PE is not connected to earth: a fault inside E1 may leave its metal live. Wire E1 PE to the outlet's earth."])
    expect(rules(on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 'e1|PE')])).has('earth')).toBe(false)
  })
  it('earthed only through a switch: no earth while it is off, and earth through a switch', () => {
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp-c1']],
      [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')])
    expect(msgs(d, 'earth').sort()).toEqual([
      'E1 PE is not connected to earth when S1 is off: a fault inside E1 may leave its metal live. Wire E1 PE to the outlet\'s earth.',
      'The earth path runs through S1 (a switch). Earth must never pass through a switch, relay or fuse, because opening it can leave a part unearthed. Wire earth straight.',
    ])
  })
  it('a switched PE branch parallel to a permanent PE wire (earth: protective conductor through a switch), highlighting its loop', () => {
    const loop = [w('xs1|PE', 'e1|PE'), w('xs1|PE', 's1|1'), w('s1|2', 'e1|PE')]
    const d = on([['s1', 'S1', 't-switch'], ['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), ...loop])
    const found = only(d, 'earth')
    expect(found.map((f) => f.message)).toEqual([
      'The earth path runs through S1 (a switch). Earth must never pass through a switch, relay or fuse, because opening it can leave a part unearthed. Wire earth straight.',
    ])
    expect([...found[0].wires].sort()).toEqual(loop.map((c) => c.uid).sort())
  })
  it('N joined to PE beyond the outlet', () => {
    expect(msgs(on([], [w('xs1|N', 'xs1|PE')]), 'earth')).toEqual([
      'XS1 N is joined to earth: neutral and earth are joined only at the main panel, and a join here puts current on the earth wire. Remove the wire that joins them.',
    ])
  })
  it('a DC ground joined to earth without a declared bond warns; through a declared bond it does not', () => {
    expect(msgs(on([['u1', 'U1', 't-mcu']], [w('xs1|PE', 'u1|GND')]), 'earth-bond')).toEqual([
      'U1 GND is joined to earth, but nothing on this net declares a bond to earth. A low-voltage ground on earth is right only when the supply is meant to be earthed (a class 1 supply with an earthed output); otherwise remove the join.',
    ])
    const bonded = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), w('ps1|-V', 'u1|GND'), w('ps1|+V', 'u1|VCC')])
    expect(rules(bonded).has('earth-bond')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: FAIL (no `polarity`, `earth` or `earth-bond` findings yet).

- [ ] **Step 3: Implement (append; import `PE_MASK`, `L_MASK`, `N_MASK`, `powerAt`, `groupName` from `./mainsGraph.ts`, `type PartInstance` from `./diagram.ts`, `protectivePaths` from `./mainsProtective.ts`)**

```ts
// ---- Rule 6: polarity (spec 3; Resolution 22) ----

/** L and N bits of this view's sources whose L side a standard fixes, and of those it does not. */
const lnBits = (p: Prepared, polarized: boolean) =>
  p.sources.reduce((m, s) => (s.polarized === polarized ? m | bitOf(s.index, 'L') | bitOf(s.index, 'N') : m), 0)
/** The designators of the unpolarized sources behind identity `x`. */
const unpolarizedNames = (p: Prepared, x: number) =>
  andList([...new Set(p.sources.filter((s) => !s.polarized && x & (bitOf(s.index, 'L') | bitOf(s.index, 'N'))).map((s) => s.part.designator))])

interface Req { node: number; t: GTerm; req: 'L' | 'N' | 'PE' | 'line' }
const reqCache = new WeakMap<Prepared, Req[]>()
/** Terminals with a requirement, on the nodes this view covers. */
function reqList(p: Prepared): Req[] {
  let list = reqCache.get(p)
  if (list) return list
  list = []
  for (const i of p.relevant)
    for (const k of p.g.members[i]) {
      const t = termAt(p.g, k)
      const req = t?.info.requirement.get(t.name)
      if (t && req) list.push({ node: i, t, req })
    }
  reqCache.set(p, list)
  return list
}

function polarityRule(acc: Acc, mask: number) {
  const { p } = acc
  const g = p.g
  const pol = lnBits(p, true)
  const unpol = lnBits(p, false)
  const wrong = new Map<string, { part: PartInstance; lOnN: GTerm[]; nOnL: GTerm[] }>()
  const maybe = new Map<string, { part: PartInstance; terms: GTerm[]; x: number }>()
  for (const q of reqList(p)) {
    if (q.req !== 'L' && q.req !== 'N') continue
    const all = identAt(p, q.node)
    const x = all & pol
    const onL = (x & L_MASK) !== 0 && !(x & N_MASK)
    const onN = (x & N_MASK) !== 0 && !(x & L_MASK)
    if ((q.req === 'N' && onL) || (q.req === 'L' && onN)) {
      const e = wrong.get(q.t.part.uid) ?? { part: q.t.part, lOnN: [], nOnL: [] }
      ;(q.req === 'L' ? e.lOnN : e.nOnL).push(q.t)
      wrong.set(q.t.part.uid, e)
    } else if (all & unpol && !(x & LN_MASK)) {
      const e = maybe.get(q.t.part.uid) ?? { part: q.t.part, terms: [], x: 0 }
      e.terms.push(q.t)
      e.x |= all & unpol
      maybe.set(q.t.part.uid, e)
    }
  }
  for (const e of wrong.values()) {
    const d = e.part.designator
    const terms = [...e.lOnN, ...e.nOnL]
    report(acc, `polarity|${terms.map((t) => t.key).sort().join(',')}`, mask, () => (when) => ({
      rule: 'polarity', subject: d, target: termName(terms[0]),
      message: e.lOnN.length && e.nOnL.length
        ? `${d} is wired the wrong way round${when}: ${andList(e.lOnN.map(termName))} ${e.lOnN.length === 1 ? 'is' : 'are'} on N and ${andList(e.nOnL.map(termName))} ${e.nOnL.length === 1 ? 'is' : 'are'} on L. If ${d} is a lamp, its screw shell is live, so touching the bulb while changing it may shock. Swap the L and N wires to ${d}.`
        : e.nOnL.length
        ? `${andList(e.nOnL.map(termName))} should be on N but ${e.nOnL.length === 1 ? 'is' : 'are'} on L${when}. Swap the L and N wires to ${d}.`
        : `${andList(e.lOnN.map(termName))} should be on L but ${e.lOnN.length === 1 ? 'is' : 'are'} on N${when}. Swap the L and N wires to ${d}.`,
      parts: [e.part.uid], pins: terms.map(endpointOf), wires: [], causes: terms.map((t) => t.key),
    }))
  }
  for (const e of maybe.values()) {
    const d = e.part.designator
    const outlets = unpolarizedNames(p, e.x)
    report(acc, `polarity|maybe|${e.terms.map((t) => t.key).sort().join(',')}`, mask, () => (when) => ({
      rule: 'polarity', subject: d, target: termName(e.terms[0]),
      message: `${d}'s polarity is not known${when}: ${outlets} ${outlets.includes(' and ') ? 'are unpolarized outlets' : 'is an unpolarized outlet'}, so which of its slots is L is not known, and ${andList(e.terms.map(termName))} may be on the wrong conductor. Use a polarized plug and outlet for a part whose L and N matter.`,
      parts: [e.part.uid], pins: e.terms.map(endpointOf), wires: [], causes: e.terms.map((t) => t.key),
    }))
  }
  // A single-pole switch or a fuse that carries a neutral (definite from a polarized source, uncertain from an unpolarized one).
  const carrier = (x: number, bits: number) => (x & bits & N_MASK) !== 0 && !(x & bits & L_MASK)
  for (const gi of p.groupIdx) {
    const grp = g.groups[gi]
    if (grp.def.poles.length !== 1) continue
    for (const [a] of grp.closed[p.groupState[gi]]) {
      const x = identAt(p, a)
      const name = groupName(g, gi)
      if (carrier(x, pol))
        report(acc, `polarity|${grp.part.uid}|${grp.def.id}|neutral`, mask, () => (when) => ({
          rule: 'polarity', subject: grp.part.designator, target: grp.part.designator,
          message: `${name} switches the neutral${when}: with ${name} off, what it feeds stays live. Move ${name} into the L wire.`,
          parts: [grp.part.uid], pins: [], wires: [], causes: [nodeKey(grp.part.uid, grp.def.id)],
        }))
      else if (!(x & pol & LN_MASK) && x & unpol)
        report(acc, `polarity|maybe|${grp.part.uid}|${grp.def.id}`, mask, () => (when) => ({
          rule: 'polarity', subject: grp.part.designator, target: grp.part.designator,
          message: `${name} may switch the neutral${when}: ${unpolarizedNames(p, x)} is an unpolarized outlet, so which of its slots is L is not known. Use a polarized plug and outlet, or a double-pole switch.`,
          parts: [grp.part.uid], pins: [], wires: [], causes: [nodeKey(grp.part.uid, `${grp.def.id}#maybe`)],
        }))
    }
  }
  for (const e of p.protective) {
    if (!e.fitted) continue
    const x = identAt(p, e.a)
    const d = e.part.designator
    if (carrier(x, pol))
      report(acc, `polarity|${e.part.uid}|${e.names.join('-')}|neutral`, mask, () => (when) => ({
        rule: 'polarity', subject: d, target: d, message: `${d} is in the neutral${when}: when it blows, what it feeds stays live. Move ${d} into the L wire.`,
        parts: [e.part.uid], pins: e.names.map((n) => ({ part: e.part.uid, pin: n })), wires: [], causes: e.names.map((n) => nodeKey(e.part.uid, n)),
      }))
    else if (!(x & pol & LN_MASK) && x & unpol)
      report(acc, `polarity|maybe|${e.part.uid}|${e.names.join('-')}`, mask, () => (when) => ({
        rule: 'polarity', subject: d, target: d,
        message: `${d} may be in the neutral${when}: ${unpolarizedNames(p, x)} is an unpolarized outlet, so which of its slots is L is not known. Use a polarized plug and outlet, or fuse the part's own supply.`,
        parts: [e.part.uid], pins: [], wires: [], causes: e.names.map((n) => nodeKey(e.part.uid, `${n}#maybe`)),
      }))
  }
}

// ---- Rule 7: earth (spec 1.6, 3) ----

interface Grounds { grounds: { node: number; t: GTerm }[]; bondNodes: number[] }
const groundCache = new WeakMap<Prepared, Grounds>()
/** Low-voltage ground terminals (not declared bonds), and the nodes holding a declared bond, in this view. */
function groundsOf(p: Prepared): Grounds {
  let hit = groundCache.get(p)
  if (hit) return hit
  hit = { grounds: [], bondNodes: [] }
  for (const i of p.relevant)
    for (const k of p.g.members[i]) {
      const t = termAt(p.g, k)
      if (!t) continue
      if (t.info.bonds.has(t.name)) hit.bondNodes.push(i)
      else if (t.type === 'ground' && lvClass(t) !== null) hit.grounds.push({ node: i, t })
    }
  groundCache.set(p, hit)
  return hit
}

const earthAdvice = (t: GTerm) => `a fault inside ${t.part.designator} may leave its metal live. Wire ${termName(t)} to the outlet's earth.`

function earthRules(acc: Acc, mask: number) {
  const { p } = acc
  const g = p.g
  // N joined to PE of the same source, beyond the outlet.
  for (const r of p.srcRoots) {
    const x = p.ident[r]
    for (const s of p.sources) {
      if (!(x & bitOf(s.index, 'N')) || !(x & bitOf(s.index, 'PE'))) continue
      const d = s.part.designator
      const keys = [...s.keys.N, ...s.keys.PE]
      report(acc, `earth|${s.id}|N-PE`, mask, () => {
        const wires = wiresOfRoot(p, r)
        return (when) => ({ rule: 'earth', subject: d, target: `${d} N`,
          message: `${d} N is joined to earth${when}: neutral and earth are joined only at the main panel, and a join here puts current on the earth wire. Remove the wire that joins them.`,
          parts: [s.part.uid], pins: keys.map(pinOfKey), wires, causes: keys })
      })
    }
  }
  // A class 1 part's earth terminal without PE while the part is on mains; a line terminal on earth only.
  for (const q of reqList(p)) {
    const x = identAt(p, q.node)
    if (q.req === 'PE' && q.t.info.protection === 'class-1' && !(x & PE_MASK)) {
      const live = [...q.t.info.terminals].some((n) => {
        const i = g.nodeOf.get(nodeKey(q.t.part.uid, n))
        return i !== undefined && p.inRel[i] === 1 && ((identAt(p, i) & LN_MASK) !== 0 || powerAt(p, i) !== 0)
      })
      if (!live) continue
      report(acc, `earth|${q.t.key}|no-pe`, mask, () => (when) => ({ rule: 'earth', subject: q.t.part.designator, target: termName(q.t),
        message: `${termName(q.t)} is not connected to earth${when}: ${earthAdvice(q.t)}`,
        parts: [q.t.part.uid], pins: [endpointOf(q.t)], wires: [], causes: [q.t.key] }))
    }
    if (q.req === 'line' && x & PE_MASK && !(x & LN_MASK))
      report(acc, `earth|${q.t.key}|line-on-pe`, mask, () => (when) => ({ rule: 'earth', subject: q.t.part.designator, target: termName(q.t),
        message: `${termName(q.t)} carries mains inside ${q.t.part.designator} but is joined to earth${when}. Wire it to L or N, never to earth.`,
        parts: [q.t.part.uid], pins: [endpointOf(q.t)], wires: [], causes: [q.t.key] }))
  }
  // A low-voltage ground on earth where nothing declares a bond: a warning (earth-bond).
  const { grounds, bondNodes } = groundsOf(p)
  if (!grounds.length) return
  const bonded = new Set(bondNodes.map((i) => p.root[i]))
  for (const q of grounds) {
    const r = p.root[q.node]
    if (!(p.ident[r] & PE_MASK) || bonded.has(r)) continue
    report(acc, `earth-bond|${q.t.key}`, mask, () => (when) => ({ rule: 'earth-bond', subject: q.t.part.designator, target: termName(q.t),
      message: `${termName(q.t)} is joined to earth${when}, but nothing on this net declares a bond to earth. A low-voltage ground on earth is right only when the supply is meant to be earthed (a class 1 supply with an earthed output); otherwise remove the join.`,
      parts: [q.t.part.uid], pins: [endpointOf(q.t)], wires: [], causes: [q.t.key] }))
  }
}

/**
 * A class 1 PE terminal on a node no source can reach (outside every enumeration unit), while its part
 * is on mains in some state: never earthed, so the finding holds in every state (Astra review, finding 1).
 */
function orphanEarth(acc: Acc): MainsDraft[] {
  const { p } = acc
  const g = p.g
  return g.mainsParts.flatMap((part): MainsDraft[] => {
    const info = mainsOf(moduleOf(g.d, part.module)!)
    if (info.protection !== 'class-1') return []
    const live = [...info.terminals].some((n) => {
      const i = g.nodeOf.get(nodeKey(part.uid, n))
      return i !== undefined && acc.hazardAny[i] === 1
    })
    if (!live) return []
    return [...info.requirement].flatMap(([n, r]): MainsDraft[] => {
      const key = nodeKey(part.uid, n)
      const i = g.nodeOf.get(key)
      const t = termAt(g, key)
      if (r !== 'PE' || i === undefined || p.inRel[i] || !t) return []
      return [{ rule: 'earth', subject: part.designator, target: termName(t), message: `${termName(t)} is not connected to earth: ${earthAdvice(t)}`,
        parts: [part.uid], pins: [endpointOf(t)], wires: [], causes: [key] }]
    })
  })
}

/** A protective conductor through a switch, relay, SSR or fuse (spec 3 rule 7), with the protective path it sits on highlighted. */
function earthPathRule(acc: Acc): MainsDraft[] {
  return protectivePaths(acc.p.g).through.map(({ part, kind, wires }) => ({
    rule: 'earth', subject: part.designator, target: part.designator,
    message: `The earth path runs through ${part.designator} (a ${kind === 'ssr' ? 'solid state relay' : kind}). Earth must never pass through a switch, relay or fuse, because opening it can leave a part unearthed. Wire earth straight.`,
    parts: [part.uid], pins: [], wires, causes: [nodeKey(part.uid, '#earth-path')],
  }))
}

STATE_RULES.push(polarityRule, earthRules)
STATIC_RULES.push(orphanEarth, earthPathRule)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsRules.ts src/format/mainsRules.test.ts
git commit -m "Mains: rules 6 and 7 (polarity with reported uncertainty, earth)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Rules 8, 9 and 13: protection, cables, incomplete checks

**Files:**
- Modify: `src/format/mainsRules.ts` (append; register)
- Test: `src/format/mainsRules.test.ts` (append)

**Interfaces:**
- Consumes: `protectivePaths` (Task 8), `acc.loadComplete` and `acc.loadFit` (Task 7), `END_NAMES`, `endKind`, `type EndKind` (`cables.ts`), `andList`.
- Produces: state rule `unprotectedRule`; static rules `fuseRules`, `cableRules`, `incompleteRule`; `const UNSUITABLE_ENDS: ReadonlySet<EndKind>`.

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('rule 8: protection', () => {
  const fused = (settings: Record<string, string>, values?: Record<string, unknown>) =>
    sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { settings, ...(values ? { values } : {}) }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N')])
  it('an unfused lamp warns; a fused one with a rating does not', () => {
    expect(msgs(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N')]), 'unprotected')).toEqual([
      "Nothing fuses the L wire from XS1 to E1: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.",
    ])
    const ok = fused({ fuse: 'fitted' }, { fuseRating: { value: 2, unit: 'A' } })
    expect(rules(ok).has('unprotected')).toBe(false)
    expect(rules(ok).has('fuse-rating-unknown')).toBe(false)
  })
  it('fuse on one branch with a bypass (unprotected)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('f1', 'F1', 't-fuse', 200, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }), at('e1', 'E1', 't-lamp', 400)],
      [w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('xs1|L', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(rules(d).has('unprotected')).toBe(true)
  })
  it('empty fuse holder vs fitted with unknown rating', () => {
    const empty = fused({ fuse: 'absent' })
    expect(msgs(empty, 'no-power')).toEqual(['E1 has no mains power: F1 has no fuse fitted.'])
    expect(rules(empty).has('unprotected')).toBe(false)
    expect(msgs(fused({ fuse: 'fitted' }), 'fuse-rating-unknown')).toEqual([
      'F1 has a fuse fitted but no rating, so the drawing does not say which fuse to fit. Set its rating in amps.',
    ])
  })
  it('never blames an empty fuse holder that is not the cause (Resolution 28)', () => {
    // E1 is powered directly; F1 is empty but sits on another branch that shares E1's neutral.
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp', 200), at('f1', 'F1', 't-fuse', 400, 0, { settings: { fuse: 'absent' } }), at('e2', 'E2', 't-lamp', 600)],
      [w('xs1|L', 'e1|L'), w('e1|N', 'xs1|N'), w('xs1|L', 'f1|1'), w('f1|2', 'e2|L'), w('e2|N', 'xs1|N')])
    expect(msgs(d, 'no-power')).toEqual(['E2 has no mains power: F1 has no fuse fitted.'])
  })
  it('claims nothing about empty fuse holders when the checks did not finish', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = sheet([at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100, 300)),
      at('f1', 'F1', 't-fuse', 200, 600, { settings: { fuse: 'absent' } }), at('e1', 'E1', 't-lamp', 600, 600)],
    [...ks.map((k) => w('xs1|L', `s${k}|1`)), w('xs1|L', 'f1|1'), w('f1|2', 'e1|L'), w('e1|N', 'xs1|N')])
    expect(only(d, 'no-power')).toEqual([])
  })
})

describe('rule 9: cables', () => {
  const lamp = (extra: ReturnType<typeof w>[]) => on([['e1', 'E1', 't-lamp-c1']], [w('xs1|L', 'e1|L'), w('xs1|N', 'e1|N'), ...extra])
  it('a live Dupont jumper is unsuitable; a thin wire too; an 18 AWG ferrule wire is only unverified', () => {
    const d = on([['e1', 'E1', 't-lamp']], [dupont('xs1|L', 'e1|L'), w('xs1|N', 'e1|N', { gauge: 24, ends: { from: 'stripped', to: 'stripped' } })])
    expect(msgs(d, 'mains-cable').sort()).toEqual([
      'The wire XS1 L to E1 L carries mains, but it has Dupont female ends and is 26 AWG. Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.',
      'The wire XS1 N to E1 N carries mains, but it is 24 AWG. Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.',
    ])
    expect(msgs(on([['e1', 'E1', 't-lamp']], [w('xs1|L', 'e1|L')]), 'cable-unverified')).toEqual([
      'The wire XS1 L to E1 L carries mains. Circuitoon cannot check its insulation or rating: use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.',
    ])
  })
  it('Dupont PE lead on a class 1 lamp (mains-cable)', () => {
    expect(msgs(lamp([dupont('xs1|PE', 'e1|PE')]), 'mains-cable')).toEqual([
      'The wire XS1 PE to E1 PE is part of the earth path, but it has Dupont female ends and is 26 AWG. Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.',
    ])
  })
  it('two parallel 26 AWG Dupont PE wires to a class 1 lamp (mains-cable on both)', () => {
    const d = lamp([dupont('xs1|PE', 'e1|PE'), dupont('e1|PE', 'xs1|PE')])
    expect(only(d, 'mains-cable').length).toBe(2)
  })
  it('an ESP32 26 AWG Dupont ground to a PE-bonded supply minus (no mains-cable finding)', () => {
    const d = on([['ps1', 'PS1', 't-psu-pelv'], ['u1', 'U1', 't-mcu']],
      [w('xs1|L', 'ps1|AC1'), w('xs1|N', 'ps1|AC2'), w('xs1|PE', 'ps1|PE'), dupont('ps1|-V', 'u1|GND'), dupont('ps1|+V', 'u1|VCC')])
    expect(only(d, 'mains-cable')).toEqual([])
  })
})

describe('rule 13: checks that did not finish', () => {
  it('17 contact groups (mains-incomplete, no clean claim)', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = on(ks.map((k): [string, string, string] => [`s${k}`, `S${k}`, 't-switch']), ks.map((k) => w('xs1|L', `s${k}|1`)))
    const found = checkDiagram(d)
    expect(found.filter((f) => f.rule === 'mains-incomplete').map((f) => f.message)).toEqual([
      'Mains checks did not finish: 17 switches and relays. Split the drawing or check the rest by hand.',
    ])
    expect(found.length).toBeGreaterThan(0)
  })
  it('more than 10 AC sources', () => {
    const outlets = Array.from({ length: 11 }, (_, i) => [`xs${i + 1}`, `XS${i + 1}`, 't-outlet'])
    expect(msgs(on([], [], outlets), 'mains-incomplete')).toEqual(['Mains checks did not finish: 11 AC sources. Split the drawing or check the rest by hand.'])
  })
})
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (append; import `END_NAMES`, `endKind`, `type EndKind` from `./cables.ts`)**

```ts
// ---- Rule 8: the project's own wiring is fused (spec 1.7, 3) ----

/** A load's L-side terminal still reaches its source's L with every fitted fuse removed. */
function unprotectedRule(acc: Acc, mask: number) {
  const { p } = acc
  const g = p.g
  for (const li of p.loadIdx)
    for (const end of [g.loads[li].a, g.loads[li].b]) {
      const ld = g.loads[li]
      const x = identAt(p, end) & L_MASK
      if (!x) continue
      for (const s of p.sources) {
        if (!(x & bitOf(s.index, 'L'))) continue
        const br = p.bareRoot[end]
        if (!s.live.some((n) => p.bareRoot[n] === br)) continue
        report(acc, `unprotected|${ld.part.uid}|${s.id}`, mask, () => {
          const wires: string[] = []
          for (const i of p.relevant) if (p.bareRoot[i] === br) wires.push(...g.wires[i])
          return (when) => ({ rule: 'unprotected', subject: ld.part.designator, target: ld.part.designator,
            message: `Nothing fuses the L wire from ${s.part.designator} to ${ld.part.designator}${when}: a fault in the wiring beyond the plug has only the building's breaker to stop it. Add a fuse (a fuse holder) in the L wire.`,
            parts: [ld.part.uid, s.part.uid], pins: [], wires, causes: [nodeKey(ld.part.uid, ld.names[0]), ...s.keys.L] })
        })
      }
    }
}

/** A fitted fuse with no rating; a load that never gets mains because a fuse holder is empty. */
function fuseRules(acc: Acc): MainsDraft[] {
  const { p } = acc
  const g = p.g
  const out: MainsDraft[] = []
  for (const e of g.edges) {
    if (e.kind !== 'protective' || !e.fitted || e.rating !== null || !(acc.hazardAny[e.a] || acc.hazardAny[e.b])) continue
    out.push({ rule: 'fuse-rating-unknown', subject: e.part.designator, target: e.part.designator,
      message: `${e.part.designator} has a fuse fitted but no rating, so the drawing does not say which fuse to fit. Set its rating in amps.`,
      parts: [e.part.uid], pins: [], wires: [], causes: e.names.map((n) => nodeKey(e.part.uid, n)) })
  }
  // Resolution 28: only when proven (complete with every empty holder fitted, never as drawn), and never when the checks did not finish.
  if (acc.incomplete) return out
  const absent = g.edges.filter((e) => e.kind === 'protective' && !e.fitted)
  g.loads.forEach((ld, i) => {
    if (acc.loadComplete[i] || !acc.loadFit[i]) return
    const holders = [...new Set(absent.filter((e) => p.possible[e.a] === p.possible[ld.a]).map((e) => e.part))]
    if (!holders.length) return
    const names = andList(holders.map((h) => h.designator))
    out.push({ rule: 'no-power', subject: ld.part.designator, target: ld.part.designator,
      message: `${ld.part.designator} has no mains power: ${names} ${holders.length === 1 ? 'has' : 'have'} no fuse fitted.`,
      parts: [ld.part.uid, ...holders.map((h) => h.uid)], pins: [], wires: [], causes: [nodeKey(ld.part.uid, ld.names[0]), ...holders.map((h) => nodeKey(h.uid, '#absent'))] })
  })
  return out
}

// ---- Rule 9: cables on mains and on the earth path (spec 1.8) ----

export const UNSUITABLE_ENDS: ReadonlySet<EndKind> = new Set<EndKind>(['dupont-male', 'dupont-female', 'alligator', 'jst-xh', 'jst-ph', 'jst-sh', 'grove', 'banana', 'solid-jumper'])
const CABLE_ADVICE = 'Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends.'

function cableRules(acc: Acc): MainsDraft[] {
  const g = acc.p.g
  const pe = protectivePaths(g)
  const end = (part: string, pin: string) => {
    const t = termAt(g, nodeKey(part, pin))
    return t ? termName(t) : `${part} ${pin}`
  }
  return g.d.connections.flatMap((c): MainsDraft[] => {
    if (g.broken.has(c.uid)) return []
    const i = g.nodeOf.get(nodeKey(c.from.part, c.from.pin))
    const live = i !== undefined && acc.hazardAny[i] === 1
    if (!live && !pe.wires.has(c.uid)) return []
    const name = c.label || `${end(c.from.part, c.from.pin)} to ${end(c.to.part, c.to.pin)}`
    const what = live ? 'carries mains' : 'is part of the earth path'
    const ends = [...new Set([endKind(c.ends, 'from'), endKind(c.ends, 'to')].filter((k) => UNSUITABLE_ENDS.has(k)))]
    const gauge = c.gauge ?? 22
    const reasons = [...(ends.length ? [`has ${andList(ends.map((k) => END_NAMES[k]))} ends`] : []), ...(gauge >= 24 ? [`is ${gauge} AWG`] : [])]
    const base = { subject: name, target: name, parts: [c.from.part, c.to.part], pins: [], wires: [c.uid], select: { parts: [], wires: [c.uid] }, causes: [c.uid] }
    return reasons.length
      ? [{ rule: 'mains-cable', message: `The wire ${name} ${what}, but it ${reasons.join(' and ')}. ${CABLE_ADVICE}`, ...base }]
      : [{ rule: 'cable-unverified', message: `The wire ${name} ${what}. Circuitoon cannot check its insulation or rating: ${CABLE_ADVICE.charAt(0).toLowerCase()}${CABLE_ADVICE.slice(1)}`, ...base }]
  })
}

// ---- Rule 13: the checks did not finish (spec 1.5) ----

function incompleteRule(acc: Acc): MainsDraft[] {
  if (!acc.incomplete) return []
  const g = acc.p.g
  const what = acc.incomplete === 'groups' ? `${acc.cands.length} switches and relays` : `${g.sources.length} AC sources`
  const parts = acc.incomplete === 'groups' ? acc.cands.map((i) => g.groups[i].part) : g.sources.map((s) => s.part)
  return [{ rule: 'mains-incomplete', subject: parts[0].designator, target: parts[0].designator,
    message: `Mains checks did not finish: ${what}. Split the drawing or check the rest by hand.`,
    parts: [...new Set(parts.map((x) => x.uid))], pins: [], wires: [], causes: ['#mains-incomplete'] }]
}

STATE_RULES.push(unprotectedRule)
STATIC_RULES.push(fuseRules, cableRules, incompleteRule)
```

Note on `END_NAMES`: "Dupont female" is its current label (`src/format/cables.ts:56-69`); the test messages above use it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsRules.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mainsRules.ts src/format/mainsRules.test.ts
git commit -m "Mains: rules 8, 9 and 13 (protection, cables, incomplete checks)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: First performance checkpoint (before any part is generated)

**Files:**
- Create: `src/format/mains.perf.test.ts`
- Modify (only if the budget is missed): `src/format/mainsGraph.ts`, `src/format/mains.ts` (depth-first enumeration with union-find snapshots, Step 3)

**Interfaces:**
- Consumes: `analyseMains`, `checkDiagram`, the synthetic fixtures.
- Produces: the measured checkpoint below as a test; if Step 3 is needed, `beginState(p: Prepared, cands: number[]): void`, `addGroup(p: Prepared, gi: number, on: 0 | 1): void`, `endState(p: Prepared): void` in `mainsGraph.ts` (together equal to `setState` plus `analyseState`) and the depth-first loop in `mains.ts`.

The checkpoint sheet is Astra's exploratory case: one outlet and 16 fused, switched lamps (L, fuse, switch, lamp, N), so all 16 switches are candidates in one unit (65,536 states). Budget: `checkDiagram` 300 ms median or less. It must also stay exhaustive (no `mains-incomplete`).

- [ ] **Step 1: Write the checkpoint test**

Create `src/format/mains.perf.test.ts`:

```ts
// Mains checks at the size a real project reaches (spec 7). Task 11 is the first checkpoint, on
// synthetic parts: one outlet and 16 fused, switched lamps in one enumeration unit. Task 24 adds the
// full sheet on built-in parts. Every state is enumerated; the checker stays off the drag path, so
// the budget is per edit.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import { analyseMains } from './mains.ts'
import { at, sheet, w } from './mains.testing.ts'

/** Median of `runs` timed checks, each on a fresh parts array as after an edit (so no cache carries over). */
export function median(d: Diagram, runs: number): number {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const next = { ...d, parts: [...d.parts], connections: [...d.connections] }
    const s = performance.now()
    checkDiagram(next)
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[Math.floor(runs / 2)]
}

function switchedLamps(n: number): Diagram {
  const parts: PartInstance[] = [at('xs1', 'XS1', 't-outlet')]
  const connections: Connection[] = []
  for (let k = 1; k <= n; k++) {
    parts.push(at(`f${k}`, `F${k}`, 't-fuse', k * 120, 200, { values: { fuseRating: { value: 2, unit: 'A' } } }), at(`s${k}`, `S${k}`, 't-switch', k * 120, 400), at(`e${k}`, `E${k}`, 't-lamp', k * 120, 600))
    connections.push(w('xs1|L', `f${k}|1`), w(`f${k}|2`, `s${k}|1`), w(`s${k}|2`, `e${k}|L`), w(`e${k}|N`, 'xs1|N'))
  }
  return sheet(parts, connections)
}

describe('mains checkpoint: one outlet, 16 fused switched lamps', () => {
  it('enumerates all 65,536 states in 300 ms or less (median)', { timeout: 30_000 }, () => {
    const d = switchedLamps(16)
    expect(analyseMains(d)!.complete).toBe(true)
    expect(checkDiagram(d).filter((f) => f.rule === 'mains-incomplete')).toEqual([])
    const ms = median(d, 5)
    console.log(`mains checkpoint: ${ms.toFixed(1)} ms median`)
    expect(ms).toBeLessThanOrEqual(300)
  })
})
```

- [ ] **Step 2: Run it and record the number**

Run: `npx vitest run src/format/mains.perf.test.ts`
Expected: PASS, with the median printed. Write the measured median in the commit message. If it passes, skip Step 3.

- [ ] **Step 3: Only if the budget is missed: depth-first enumeration with union-find snapshots**

Profile first (`node --cpu-prof` on a small script that builds `switchedLamps(16)` and calls `analyseMains` five times) and fix what the profile shows (a rule allocating per state, a list rebuilt per state instead of cached per view). If the per-state union-find is still the cost, replace the popcount loop by a depth-first walk: level k unions group k's closed contacts onto a copy of level k-1's parent arrays, so a state costs one group's unions plus the per-state pass. The findings keep their witness bitsets, so the order no longer matters for wording (a converter's first unknown reason then comes from the first state in depth-first order; say so in Resolution 11's comment).

Split `analyseState` in `mainsGraph.ts` into three steps and rebuild `analyseState` from them, so every existing test still holds:

```ts
/** Resets the view to its bases and applies every group that is not a candidate (released or off). */
export function beginState(p: Prepared, cands: number[]): void {
  for (const i of p.relevant) {
    p.parent[i] = p.base[i]
    p.bareParent[i] = p.bareBase[i]
    if (p.anyAbsent) p.fitParent[i] = p.fitBase[i]
  }
  const isCand = new Set(cands)
  for (const gi of p.groupIdx) if (!isCand.has(gi)) addGroup(p, gi, 0)
}

/** Applies one group's contacts in position `on`. */
export function addGroup(p: Prepared, gi: number, on: 0 | 1): void {
  p.groupState[gi] = on
  for (const [a, b] of p.g.groups[gi].closed[on]) {
    union(p.parent, a, b)
    union(p.bareParent, a, b)
    if (p.anyAbsent) union(p.fitParent, a, b)
  }
}

/** Roots, identity and energization for the groups applied so far (the second half of analyseState). */
export function endState(p: Prepared): void {
  const { g } = p
  for (const i of p.relevant) {
    p.root[i] = find(p.parent, i)
    p.bareRoot[i] = find(p.bareParent, i)
    if (p.anyAbsent) p.fitRoot[i] = find(p.fitParent, i)
    p.ident[i] = 0
    p.power[i] = 0
  }
  p.srcRoots.length = 0
  for (const s of p.sources) {
    const put = (nodes: number[], c: Conductor) => {
      for (const x of nodes) {
        const r = p.root[x]
        if (!p.ident[r]) p.srcRoots.push(r)
        p.ident[r] |= bitOf(s.index, c)
      }
    }
    put(s.live, 'L')
    put(s.neutral, 'N')
    put(s.earth, 'PE')
    for (const x of s.live) p.power[p.root[x]] |= 1 << s.index
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const e of p.energy) if (flow(p, e.a, e.b, e.directed)) changed = true
    for (const gi of p.groupIdx) for (const [a, b] of g.groups[gi].leak[p.groupState[gi]]) if (flow(p, a, b, false)) changed = true
  }
}

/** Unchanged behaviour, now in three steps. */
export function analyseState(p: Prepared): void {
  // Every group counts as a candidate here, so beginState applies none and each is added once, in its set position.
  beginState(p, p.groupIdx)
  for (const gi of p.groupIdx) addGroup(p, gi, p.groupState[gi] as 0 | 1)
  endState(p)
}
```

and in `mains.ts` replace the per-unit popcount loop with:

```ts
      const saved: Int32Array[][] = []
      const snapshot = () => [p.parent, p.bareParent, p.fitParent].map((a) => Int32Array.from(unit.view.relevant, (i) => a[i]))
      const restore = (s: Int32Array[]) => [p.parent, p.bareParent, p.fitParent].forEach((a, k) => unit.view.relevant.forEach((i, j) => (a[i] = s[k][j])))
      beginState(unit.view, unit.cands)
      const walk = (k: number, mask: number) => {
        if (k === unit.cands.length) {
          endState(unit.view)
          visitState(sub, mask)
          return
        }
        saved[k] = snapshot()
        for (const on of [0, 1] as const) {
          restore(saved[k])
          addGroup(unit.view, unit.cands[k], on)
          walk(k + 1, on ? mask | (1 << k) : mask)
        }
      }
      walk(0, 0)
```

(`p` here is `unit.view`, whose scratch arrays are shared.) Re-measure. If it still misses, stop and report the profile to the controller rather than skipping states: the spec forbids sampling.

- [ ] **Step 4: Gate and commit**

Run the gate `npx tsc --noEmit && npm test`: PASS.

```bash
git add src/format/mains.perf.test.ts src/format/mainsGraph.ts src/format/mains.ts
git commit -m "Mains: first performance checkpoint, 16 switched lamps measured at <median> ms" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Put the measured number in place of `<median>` in the message.)

---

### Task 12: Plugging data: families, patterns and the compatibility table

**Files:**
- Create: `src/format/plugging.ts`
- Create: `src/format/plugSpec.testing.ts` (the spec's table transcribed by hand, for tests only)
- Test: `src/format/plugging.test.ts`

**Interfaces:**
- Consumes: `PLUG_FAMILIES`, `SOCKET_FAMILIES`, `CONDUCTORS` (Task 2); `Rotation` (`geometry.ts`).
- Produces:
  - In `plugging.ts`: `type Pattern = Record<Conductor, [number, number][]>`, `SOCKET_PATTERNS: Record<SocketFamily, Pattern>`, `PLUG_PROFILES: Record<PlugFamily, { id: string; contacts: Pattern }[]>`, `interface TableEntry { plug: PlugFamily; socket: SocketFamily; profile: string; map: Partial<Record<Rotation, Record<Conductor, Conductor>>> }`, `COMPAT: TableEntry[]`, `entriesFor(plug: PlugFamily, socket: SocketFamily): TableEntry[]`, `orientationOf(part: { rotation?: Rotation }, board: { rotation?: Rotation }): Rotation`, `PLUG_NAMES`, `SOCKET_NAMES`, `PLUG_FOR`.
  - In `plugSpec.testing.ts`: `SPEC_COMPAT`, `specTurns(plug, socket): Rotation[]`, `specMapping(turn, role): Conductor` (Task 13's seating tests use them too).

The stylized patterns (offsets in px from the socket's or plug's centre, y down, seen from the front of the outlet; a plug at orientation 0 has the same offsets, so its contacts sit on the holes):

| Family | L | N | PE |
| --- | --- | --- | --- |
| NEMA (5-15, 5-20, 1-15, both polarities) | (10, 0) | (-10, 0) | (0, 20) (5-15 and 5-20 only) |
| CEE 7/3 socket, CEE 7/7 earth-clip profile | (-20, 0) | (20, 0) | (0, -30) and (0, 30) |
| CEE 7/5 socket, CEE 7/7 earth-hole profile | (-20, 0) | (20, 0) | (0, -30) |
| CEE 7/16 (Europlug) | (-20, 0) | (20, 0) | none |
| BS 1363 | (20, 10) | (-20, 10) | (0, -20) |
| AS/NZS 3112 | (10, -10) | (-10, -10) | (0, 20) |

The L side of each family is a convention to verify in Task 12 against the cited standard (NEMA WD 6 for US: facing the outlet with the earth hole down, the wider neutral slot is on the left; BS 1363: earth up, L bottom right; AS/NZS 3112 and NF C 61-314: confirm). If a standard puts L on the other side, swap L and N in this table, in `SOCKET_PATTERNS` and `PLUG_PROFILES` together (the positions stay), and the tests follow.

- [ ] **Step 1: Transcribe the spec's table for the tests**

Create `src/format/plugSpec.testing.ts`:

```ts
// Spec section 2's compatibility table, transcribed by hand for the tests: which plug family (and
// profile) seats in which socket family, at which turns. Kept apart from src/format/plugging.ts on
// purpose: a row missing from the implementation must fail a test, not change its expectation.
import type { Rotation } from './geometry.ts'
import type { Conductor, PlugFamily, SocketFamily } from './mainsModel.ts'

export const SPEC_COMPAT: { plug: PlugFamily; socket: SocketFamily; profile: string; turns: Rotation[] }[] = [
  // NEMA 5-15P in 5-15R and 5-20R (0 only).
  { plug: 'nema-5-15p', socket: 'nema-5-15r', profile: 'main', turns: [0] },
  { plug: 'nema-5-15p', socket: 'nema-5-20r', profile: 'main', turns: [0] },
  // 1-15P polarized in 1-15R polarized, 5-15R, 5-20R (0 only).
  { plug: 'nema-1-15p-polarized', socket: 'nema-1-15r-polarized', profile: 'main', turns: [0] },
  { plug: 'nema-1-15p-polarized', socket: 'nema-5-15r', profile: 'main', turns: [0] },
  { plug: 'nema-1-15p-polarized', socket: 'nema-5-20r', profile: 'main', turns: [0] },
  // 1-15P unpolarized in 1-15R (both variants, Resolution 4), 5-15R, 5-20R (0 and 180).
  { plug: 'nema-1-15p', socket: 'nema-1-15r', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-1-15r-polarized', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-5-15r', profile: 'main', turns: [0, 180] },
  { plug: 'nema-1-15p', socket: 'nema-5-20r', profile: 'main', turns: [0, 180] },
  // CEE 7/7 in CEE 7/3 via its earth clips (0 and 180), in CEE 7/5 via its earth hole (0 only).
  { plug: 'cee7-7', socket: 'cee7-3', profile: 'earth-clip', turns: [0, 180] },
  { plug: 'cee7-7', socket: 'cee7-5', profile: 'earth-hole', turns: [0] },
  // Europlug in CEE 7/3, 7/5 and 7/16 (0 and 180, no earth).
  { plug: 'cee7-16', socket: 'cee7-3', profile: 'main', turns: [0, 180] },
  { plug: 'cee7-16', socket: 'cee7-5', profile: 'main', turns: [0, 180] },
  { plug: 'cee7-16', socket: 'cee7-16', profile: 'main', turns: [0, 180] },
  // BS 1363 and AS/NZS 3112 in their own only (0 only).
  { plug: 'bs1363', socket: 'bs1363', profile: 'main', turns: [0] },
  { plug: 'as3112', socket: 'as3112', profile: 'main', turns: [0] },
]

/** The allowed turns for a pair, from the spec (none when the spec lists no row). */
export const specTurns = (plug: PlugFamily, socket: SocketFamily): Rotation[] => SPEC_COMPAT.find((r) => r.plug === plug && r.socket === socket)?.turns ?? []

/** Which socket contact a plug contact of `role` meets at `turn`: turned half way round, L and N swap; earth stays earth. */
export const specMapping = (turn: Rotation, role: Conductor): Conductor => (turn === 180 && role !== 'PE' ? (role === 'L' ? 'N' : 'L') : role)
```

- [ ] **Step 2: Write the failing tests**

Create `src/format/plugging.test.ts`:

```ts
// The plugging data (spec section 2): the table agrees with the spec row by row (turns, profile and
// contact mapping), and patterns of different families never fully overlap.
import { describe, expect, it } from 'vitest'
import type { Rotation } from './geometry.ts'
import { CONDUCTORS, PLUG_FAMILIES, SOCKET_FAMILIES } from './mainsModel.ts'
import { PLUG_PROFILES, SOCKET_PATTERNS, entriesFor, orientationOf } from './plugging.ts'
import { SPEC_COMPAT, specMapping, specTurns } from './plugSpec.testing.ts'

const ROTATIONS: Rotation[] = [0, 90, 180, 270]

describe('the compatibility table', () => {
  it('agrees with the spec for every plug and socket family: turns, profile and mapping', () => {
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES) {
        const entries = entriesFor(plug, socket)
        const turns = entries.flatMap((e) => Object.keys(e.map).map(Number)).sort((a, b) => a - b)
        expect([plug, socket, turns]).toEqual([plug, socket, specTurns(plug, socket)])
        const row = SPEC_COMPAT.find((r) => r.plug === plug && r.socket === socket)
        for (const e of entries) {
          expect([plug, socket, e.profile]).toEqual([plug, socket, row!.profile])
          for (const [turn, map] of Object.entries(e.map))
            for (const role of CONDUCTORS) expect([plug, socket, turn, role, map![role]]).toEqual([plug, socket, turn, role, specMapping(Number(turn) as Rotation, role)])
        }
      }
  })
  it('every profile the table names exists for its plug family', () => {
    for (const e of SPEC_COMPAT) expect(PLUG_PROFILES[e.plug].map((p) => p.id)).toContain(e.profile)
  })
  it('measures a turn relative to the outlet', () => {
    expect(orientationOf({ rotation: 90 }, { rotation: 90 })).toBe(0)
    expect(orientationOf({ rotation: 0 }, { rotation: 90 })).toBe(270)
    expect(orientationOf({}, { rotation: 180 })).toBe(180)
  })
  it('patterns of different families never land fully on a socket they have no table entry for, at any rotation', () => {
    const group = (f: string) => (f.startsWith('nema') ? 'nema' : f.startsWith('cee') ? 'cee' : f)
    const turn = ([x, y]: [number, number], r: Rotation): string => (r === 90 ? `${-y},${x}` : r === 180 ? `${-x},${-y}` : r === 270 ? `${y},${-x}` : `${x},${y}`)
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES) {
        // Within one geometry group the table alone decides (the grid cannot draw blade width; Resolution 7).
        if (group(plug) === group(socket)) continue
        const holes = new Set(CONDUCTORS.flatMap((c) => SOCKET_PATTERNS[socket][c].map(([x, y]) => `${x},${y}`)))
        for (const pr of PLUG_PROFILES[plug])
          for (const r of ROTATIONS) {
            const pts = CONDUCTORS.flatMap((c) => pr.contacts[c].map((p) => turn(p, r)))
            expect([plug, pr.id, socket, r, pts.every((p) => holes.has(p))]).toEqual([plug, pr.id, socket, r, false])
          }
      }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/format/plugging.test.ts`
Expected: FAIL (`./plugging.ts` does not exist).

- [ ] **Step 4: Implement `src/format/plugging.ts`**

```ts
// Plugs and sockets (spec section 2): the stylized contact pattern of each family on the 10 px grid,
// and the compatibility table that says which plug profile seats in which socket, in which
// orientations and with which contact mapping. Real dimensions are cited in the part generators
// (scripts/gen-mains-*.mjs); these patterns only keep each family's layout distinct. Pure data.
import type { Rotation } from './geometry.ts'
import type { Conductor, PlugFamily, SocketFamily } from './mainsModel.ts'

/** Contact offsets in px from the socket's (or plug's) centre, y down, seen from the front of the outlet. */
export type Pattern = Record<Conductor, [number, number][]>

const NEMA3: Pattern = { L: [[10, 0]], N: [[-10, 0]], PE: [[0, 20]] }
const NEMA2: Pattern = { L: [[10, 0]], N: [[-10, 0]], PE: [] }
const CEE_CLIPS: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [[0, -30], [0, 30]] }
const CEE_PIN: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [[0, -30]] }
const CEE2: Pattern = { L: [[-20, 0]], N: [[20, 0]], PE: [] }
const BS: Pattern = { L: [[20, 10]], N: [[-20, 10]], PE: [[0, -20]] }
const AS: Pattern = { L: [[10, -10]], N: [[-10, -10]], PE: [[0, 20]] }

export const SOCKET_PATTERNS: Record<SocketFamily, Pattern> = {
  'nema-5-15r': NEMA3, 'nema-5-20r': NEMA3, 'nema-1-15r': NEMA2, 'nema-1-15r-polarized': NEMA2,
  'cee7-3': CEE_CLIPS, 'cee7-5': CEE_PIN, 'cee7-16': CEE2, bs1363: BS, as3112: AS,
}

export const PLUG_PROFILES: Record<PlugFamily, { id: string; contacts: Pattern }[]> = {
  'nema-5-15p': [{ id: 'main', contacts: NEMA3 }],
  'nema-1-15p': [{ id: 'main', contacts: NEMA2 }],
  'nema-1-15p-polarized': [{ id: 'main', contacts: NEMA2 }],
  'cee7-7': [{ id: 'earth-clip', contacts: CEE_CLIPS }, { id: 'earth-hole', contacts: CEE_PIN }],
  'cee7-16': [{ id: 'main', contacts: CEE2 }],
  bs1363: [{ id: 'main', contacts: BS }],
  as3112: [{ id: 'main', contacts: AS }],
}

type Mapping = Record<Conductor, Conductor>
const SAME: Mapping = { L: 'L', N: 'N', PE: 'PE' }
const SWAP: Mapping = { L: 'N', N: 'L', PE: 'PE' }

export interface TableEntry {
  plug: PlugFamily
  socket: SocketFamily
  /** The plug profile that seats here. */
  profile: string
  /** Per allowed orientation, which socket contact each plug contact meets. */
  map: Partial<Record<Rotation, Mapping>>
}
const entry = (plug: PlugFamily, socket: SocketFamily, profile: string, turns: boolean): TableEntry =>
  ({ plug, socket, profile, map: turns ? { 0: SAME, 180: SWAP } : { 0: SAME } })

/** Spec section 2, tested pairwise at all four rotations (plugging.test.ts). */
export const COMPAT: TableEntry[] = [
  entry('nema-5-15p', 'nema-5-15r', 'main', false),
  entry('nema-5-15p', 'nema-5-20r', 'main', false),
  entry('nema-1-15p-polarized', 'nema-1-15r-polarized', 'main', false),
  entry('nema-1-15p-polarized', 'nema-5-15r', 'main', false),
  entry('nema-1-15p-polarized', 'nema-5-20r', 'main', false),
  // A narrow-blade plug enters either slot of any of these, polarized or not.
  entry('nema-1-15p', 'nema-1-15r', 'main', true),
  entry('nema-1-15p', 'nema-1-15r-polarized', 'main', true),
  entry('nema-1-15p', 'nema-5-15r', 'main', true),
  entry('nema-1-15p', 'nema-5-20r', 'main', true),
  entry('cee7-7', 'cee7-3', 'earth-clip', true),
  // The CEE 7/5 socket's earth pin enters the plug's earth hole only one way up.
  entry('cee7-7', 'cee7-5', 'earth-hole', false),
  entry('cee7-16', 'cee7-3', 'main', true),
  entry('cee7-16', 'cee7-5', 'main', true),
  entry('cee7-16', 'cee7-16', 'main', true),
  entry('bs1363', 'bs1363', 'main', false),
  entry('as3112', 'as3112', 'main', false),
]

export const entriesFor = (plug: PlugFamily, socket: SocketFamily): TableEntry[] => COMPAT.filter((e) => e.plug === plug && e.socket === socket)

/** A plug's turn relative to the outlet it sits on. */
export const orientationOf = (part: { rotation?: Rotation }, board: { rotation?: Rotation }): Rotation =>
  ((((part.rotation ?? 0) - (board.rotation ?? 0)) % 360) + 360) % 360 as Rotation

export const PLUG_NAMES: Record<PlugFamily, string> = {
  'nema-5-15p': 'US plug', 'nema-1-15p': 'US/Japanese plug', 'nema-1-15p-polarized': 'US plug',
  'cee7-7': 'Schuko plug', 'cee7-16': 'Europlug', bs1363: 'UK plug', as3112: 'Australian plug',
}
export const SOCKET_NAMES: Record<SocketFamily, string> = {
  'nema-5-15r': 'US socket', 'nema-5-20r': 'US socket', 'nema-1-15r': 'Japanese socket', 'nema-1-15r-polarized': 'Japanese socket',
  'cee7-3': 'Schuko socket', 'cee7-5': 'French socket', 'cee7-16': 'Europlug socket', bs1363: 'UK socket', as3112: 'Australian socket',
}
/** What to use instead, per socket family ("Use a device with a US plug"). */
export const PLUG_FOR: Record<SocketFamily, string> = {
  'nema-5-15r': 'a US plug', 'nema-5-20r': 'a US plug', 'nema-1-15r': 'a Japanese plug', 'nema-1-15r-polarized': 'a Japanese plug',
  'cee7-3': 'a Schuko plug or a Europlug', 'cee7-5': 'a French or Schuko (CEE 7/7) plug', 'cee7-16': 'a Europlug', bs1363: 'a UK plug', as3112: 'an Australian plug',
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/format/plugging.test.ts`
Expected: PASS. Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/format/plugging.ts src/format/plugSpec.testing.ts src/format/plugging.test.ts
git commit -m "Mains: plug and socket families, patterns and the compatibility table" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Seating plug-in devices: mount integration and plug-mismatch

**Files:**
- Modify: `src/format/breadboard.ts` (`Seat.outline`, `MountIssue` `no-fit`, `mountable`, `Fit`, `fitOn`, `seatFrom`, `seatOf`, `seatOn`, `mounts`; add `plugMismatches`)
- Modify: `src/format/diagram.ts:921-932` (loader warning for `no-fit`)
- Modify: `src/format/checks.ts` (`plug-mismatch` findings, mount findings folded into it, `mountMessage` `no-fit`)
- Modify: `src/format/mains.testing.ts` (plug and outlet fixtures)
- Test: `src/format/plugSeating.test.ts`

**Interfaces:**
- Consumes: `entriesFor`, `orientationOf`, `PLUG_NAMES`, `SOCKET_NAMES`, `PLUG_FOR`, `SOCKET_PATTERNS`, `PLUG_PROFILES` (Task 12); `SPEC_COMPAT`, `specTurns`, `specMapping` (Task 12, tests only); `PlugDef`, `mainsOf` (Task 2); `analyseMains` (Task 5); `holeIndex`, `holeAt`, `obscuredOn` (existing, `breadboard.ts`); `toWorld`, `bodyRect`, `Rotation`, `Rect` (`geometry.ts`).
- Produces:
  - In `breadboard.ts`: `Seat.outline?: Rect`, `MountIssue['reason']` gains `'no-fit'`, `interface PlugMismatch { part: string; board: string; kind: 'family' | 'fit'; plug: PlugFamily; socket: SocketFamily }`, `plugMismatches(d: Diagram): PlugMismatch[]`.
  - Fixtures in `mains.testing.ts`: `t-outlet-uk`, `t-outlet-fr`, `t-outlet-split`, `t-plug-us`, `t-plug-uk`, `t-plug-schuko`, `t-lamp-230`.

- [ ] **Step 1: Add the fixtures (append to `src/format/mains.testing.ts`, and add them to `MAINS_MODULES`)**

```ts
const plugLeads = (reqs: Record<'L' | 'N' | 'PE', string>) =>
  (['L', 'N', 'PE'] as const).map((c) => ({ name: c, side: 'bottom', mains: reqs[c] })) as ModuleDef['pins']
const all250 = (extra: string[] = []) => [ac(['L', 'N', 'PE', ...extra], 250)]
/** A UK (BS 1363) outlet at 230 V. */
export const outletUK = mod({
  id: 't-outlet-uk', name: 'Test outlet (UK)', pins: [], size: { w: 6, h: 6 }, obstacle: false,
  holes: [{ name: 'PE', at: [[30, 10]] }, { name: 'N', at: [[10, 40]] }, { name: 'L', at: [[50, 40]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: 'uk' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'bs1363', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: all250(),
  },
})
/** A French (CEE 7/5) outlet: its earth pin polarizes the plug. */
export const outletFR = mod({
  id: 't-outlet-fr', name: 'Test outlet (French)', pins: [], size: { w: 8, h: 8 }, obstacle: false,
  holes: [{ name: 'L', at: [[20, 40]] }, { name: 'N', at: [[60, 40]] }, { name: 'PE', at: [[40, 10]] }],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: 'eu' },
    acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
    sockets: [{ id: 'main', family: 'cee7-5', contacts: [{ group: 'L', role: 'L' }, { group: 'N', role: 'N' }, { group: 'PE', role: 'PE' }] }],
    ratings: all250(),
  },
})
/** Two NEMA sockets laid out so a plug at (0, 0) meets socket a's N and L and socket b's earth. */
export const outletSplit = mod({
  id: 't-outlet-split', name: 'Test outlet (contacts of two sockets in reach)', pins: [], size: { w: 6, h: 10 }, obstacle: false,
  holes: [{ name: 'Na', at: [[20, 30]] }, { name: 'La', at: [[40, 30]] }, { name: 'PEa', at: [[30, 90]] }, { name: 'PEb', at: [[30, 50]] }, { name: 'Nb', at: [[10, 70]] }, { name: 'Lb', at: [[50, 70]] }],
  internal: [['La', 'Lb'], ['Na', 'Nb'], ['PEa', 'PEb']],
  electrical: {
    params: { acVoltage: { unit: 'VAC', default: 120 } }, ac: { hz: 60, region: 'us' },
    acSources: [{ id: 'supply', live: ['La'], neutral: ['Na'], earth: ['PEa'] }],
    sockets: [
      { id: 'a', family: 'nema-5-15r', contacts: [{ group: 'La', role: 'L' }, { group: 'Na', role: 'N' }, { group: 'PEa', role: 'PE' }] },
      { id: 'b', family: 'nema-5-15r', contacts: [{ group: 'Lb', role: 'L' }, { group: 'Nb', role: 'N' }, { group: 'PEb', role: 'PE' }] },
    ],
  },
})
/** A US 3-lead cord plug (NEMA 5-15P); prongs centred on the pivot (30, 30). */
export const plugUS = mod({
  id: 't-plug-us', name: 'Test cord plug (US)', size: { w: 6, h: 6 }, pins: plugLeads({ L: 'L', N: 'N', PE: 'PE' }),
  internal: [['L prong', 'L'], ['N prong', 'N'], ['PE prong', 'PE']],
  electrical: {
    internalNodes: ['L prong', 'N prong', 'PE prong'],
    plug: { family: 'nema-5-15p', profiles: [{ id: 'main', contacts: [
      { pin: 'N prong', at: { x: 20, y: 30 }, mains: 'N' }, { pin: 'L prong', at: { x: 40, y: 30 }, mains: 'L' }, { pin: 'PE prong', at: { x: 30, y: 50 }, mains: 'PE' },
    ] }] },
    ratings: [ac(['L', 'N', 'PE', 'L prong', 'N prong', 'PE prong'], 125, { amps: 15 })],
  },
})
/** A UK 3-lead cord plug with its BS 1362 fuse between the L prong and the L lead. */
export const plugUK = mod({
  id: 't-plug-uk', name: 'Test cord plug (UK, fused)', size: { w: 6, h: 6 }, pins: plugLeads({ L: 'L', N: 'N', PE: 'PE' }),
  internal: [['N prong', 'N'], ['PE prong', 'PE']],
  electrical: {
    internalNodes: ['L prong', 'N prong', 'PE prong'],
    protective: [{ from: 'L prong', to: 'L', kind: 'fuse' }], params: { fuseRating: { unit: 'A', default: 13 } },
    plug: { family: 'bs1363', profiles: [{ id: 'main', contacts: [
      { pin: 'PE prong', at: { x: 30, y: 10 }, mains: 'PE' }, { pin: 'N prong', at: { x: 10, y: 40 }, mains: 'N' }, { pin: 'L prong', at: { x: 50, y: 40 }, mains: 'L' },
    ] }] },
    ratings: all250(['L prong', 'N prong', 'PE prong']),
  },
})
/** A Schuko (CEE 7/7) cord plug: earth clips for a CEE 7/3 socket, an earth hole for a CEE 7/5 one. Unpolarized leads. */
export const plugSchuko = mod({
  id: 't-plug-schuko', name: 'Test cord plug (Schuko)', size: { w: 8, h: 8 }, pins: plugLeads({ L: 'line', N: 'line', PE: 'PE' }),
  internal: [['L prong', 'L'], ['N prong', 'N'], ['PE prong', 'PE']],
  electrical: {
    internalNodes: ['L prong', 'N prong', 'PE prong'],
    plug: { family: 'cee7-7', profiles: [
      { id: 'earth-clip', contacts: [
        { pin: 'L prong', at: { x: 20, y: 40 }, mains: 'L' }, { pin: 'N prong', at: { x: 60, y: 40 }, mains: 'N' },
        { pin: 'PE prong', at: { x: 40, y: 10 }, mains: 'PE' }, { pin: 'PE prong', at: { x: 40, y: 70 }, mains: 'PE' },
      ] },
      { id: 'earth-hole', contacts: [
        { pin: 'L prong', at: { x: 20, y: 40 }, mains: 'L' }, { pin: 'N prong', at: { x: 60, y: 40 }, mains: 'N' }, { pin: 'PE prong', at: { x: 40, y: 10 }, mains: 'PE' },
      ] },
    ] },
    ratings: all250(['L prong', 'N prong', 'PE prong']),
  },
})
/** A 230 V lamp holder, class 2. */
export const lamp230 = mod({ id: 't-lamp-230', name: 'Test lamp 230 V', pins: lampPins,
  electrical: { conducts: [{ pins: ['L', 'N'], kind: 'load', range: [220, 240] }], protection: 'class-2', ratings: [ac(['L', 'N'], 250)] } })
```

(`plugLeads`, `all250` and these modules go after `ac`, `lampPins` in the file; add `outletUK, outletFR, outletSplit, plugUS, plugUK, plugSchuko, lamp230` to the `MAINS_MODULES` list.)

- [ ] **Step 2: Write the failing tests**

Create `src/format/plugSeating.test.ts`:

```ts
// Seating plug-in devices (spec section 2) through the real mount code: every plug family against
// every socket family at all four turns, checked against the spec's own table (not the
// implementation's), the contact each plug contact meets, turned outlets, translations, occupied
// sockets, overlapping outlets, a breadboard nearby, contacts spread across two sockets, and the plug
// counterexamples with rule 10.
import { describe, expect, it } from 'vitest'
import { type Diagram, type PartInstance } from './diagram.ts'
import { mountIssues, plugsOf, seatOf } from './breadboard.ts'
import { checkDiagram } from './checks.ts'
import { analyseMains } from './mains.ts'
import { nodeKey } from './netlist.ts'
import { type ModuleDef, validateModule } from './module.ts'
import type { Rotation } from './geometry.ts'
import { CONDUCTORS, PLUG_FAMILIES, SOCKET_FAMILIES, type Conductor, type PlugFamily, type SocketFamily } from './mainsModel.ts'
import { PLUG_PROFILES, SOCKET_PATTERNS } from './plugging.ts'
import { SPEC_COMPAT, specMapping, specTurns } from './plugSpec.testing.ts'
import { load } from './builtinModules.testing.ts'
import { at, sheet, w } from './mains.testing.ts'

const C = 50
/** An outlet of one socket family, its socket centred on the pivot of a 100 x 100 body. */
function socketModule(family: SocketFamily): ModuleDef {
  const pat = SOCKET_PATTERNS[family]
  const roles = CONDUCTORS.filter((c) => pat[c].length)
  return {
    format: 'circuitoon-module/1', id: `s-${family}`, name: family, pins: [], size: { w: 10, h: 10 }, obstacle: false,
    holes: roles.map((c) => ({ name: c, at: pat[c].map(([x, y]) => [C + x, C + y] as [number, number]) })),
    electrical: {
      params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: 'eu' },
      acSources: [{ id: 's', live: ['L'], neutral: ['N'], ...(pat.PE.length ? { earth: ['PE'] } : {}) }],
      sockets: [{ id: 'main', family, contacts: roles.map((c) => ({ group: c, role: c })) }],
    },
  }
}
/** A plug-in device of one plug family, every profile centred on the pivot of a 100 x 100 body. */
function plugModule(family: PlugFamily): ModuleDef {
  const profiles = PLUG_PROFILES[family]
  const roles = CONDUCTORS.filter((c) => profiles.some((pr) => pr.contacts[c].length))
  return {
    format: 'circuitoon-module/1', id: `p-${family}`, name: family, size: { w: 10, h: 10 },
    pins: roles.map((c) => ({ name: c, side: 'bottom' as const })),
    internal: roles.map((c) => [`${c} prong`, c]),
    electrical: {
      internalNodes: roles.map((c) => `${c} prong`),
      plug: { family, profiles: profiles.map((pr) => ({ id: pr.id, contacts: CONDUCTORS.flatMap((c) => pr.contacts[c].map(([x, y]) => ({ pin: `${c} prong`, at: { x: C + x, y: C + y }, mains: c }))) })) },
    },
  }
}
const pair = (plug: PlugFamily, socket: SocketFamily, place: Partial<PartInstance> = {}): Diagram => {
  const [sm, pm] = [socketModule(socket), plugModule(plug)]
  return { format: 'circuitoon-diagram/1', title: 't', modules: { [sm.id]: sm, [pm.id]: pm }, connections: [],
    parts: [{ uid: 'xs', designator: 'XS1', module: sm.id, x: 0, y: 0 }, { uid: 'xp', designator: 'XP1', module: pm.id, x: 0, y: 0, ...place }] }
}
const seated = (d: Diagram, uid = 'xp') => seatOf(d, uid, [])?.status === 'seated'
const ROTATIONS: Rotation[] = [0, 90, 180, 270]

describe('the compatibility matrix through the mount code', () => {
  it('the synthetic modules are valid', () => {
    for (const f of SOCKET_FAMILIES) expect(validateModule(socketModule(f)).ok).toBe(true)
    for (const f of PLUG_FAMILIES) expect(validateModule(plugModule(f)).ok).toBe(true)
  })
  it('every plug family against every socket family, all four turns: seats exactly where the spec allows', () => {
    for (const plug of PLUG_FAMILIES)
      for (const socket of SOCKET_FAMILIES)
        for (const rotation of ROTATIONS)
          expect([plug, socket, rotation, seated(pair(plug, socket, { rotation }))]).toEqual([plug, socket, rotation, specTurns(plug, socket).includes(rotation)])
  })
  it('each seated contact meets the socket contact the spec maps it to (the mapping that feeds identity)', () => {
    for (const { plug, socket, turns } of SPEC_COMPAT)
      for (const rotation of turns) {
        const d = pair(plug, socket, { rotation, mount: { board: 'xs' } })
        expect(mountIssues(d)).toEqual([])
        for (const pl of plugsOf(d)) {
          const role = pl.pin.split(' ')[0] as Conductor
          expect([plug, socket, rotation, pl.pin, pl.group]).toEqual([plug, socket, rotation, pl.pin, specMapping(rotation, role)])
        }
      }
  })
  it('turned outlets: a plug seats when turned with the outlet, and not when left square to the page', () => {
    for (const r of [90, 180, 270] as Rotation[]) {
      const d = pair('nema-5-15p', 'nema-5-15r', { rotation: r })
      const turned: Diagram = { ...d, parts: [{ ...d.parts[0], rotation: r }, d.parts[1]] }
      expect(seated(turned)).toBe(true)
      const square: Diagram = { ...d, parts: [{ ...d.parts[0], rotation: r }, { ...d.parts[1], rotation: 0 }] }
      expect(seated(square)).toBe(false)
    }
  })
  it('CEE 7/7 in 7/3 both orientations and in 7/5 one orientation', () => {
    expect(ROTATIONS.filter((r) => seated(pair('cee7-7', 'cee7-3', { rotation: r })))).toEqual([0, 180])
    expect(ROTATIONS.filter((r) => seated(pair('cee7-7', 'cee7-5', { rotation: r })))).toEqual([0])
  })
  it('a plug moved one grid step off the socket does not seat', () => {
    for (const [dx, dy] of [[10, 0], [0, 10], [-10, 0], [0, -10]]) expect(seated(pair('nema-5-15p', 'nema-5-15r', { x: dx, y: dy }))).toBe(false)
  })
  it('a second plug on an occupied socket does not seat', () => {
    const d = pair('nema-1-15p', 'nema-5-15r', { mount: { board: 'xs' } })
    const second: PartInstance = { uid: 'xp2', designator: 'XP2', module: 'p-nema-1-15p', x: 0, y: 0 }
    expect(seatOf({ ...d, parts: [...d.parts, second] }, 'xp2', plugsOf(d))?.status).toBe('partial')
  })
})

describe('seating among other boards', () => {
  it('overlapping outlets: the plug seats in the one drawn on top', () => {
    const d = pair('nema-5-15p', 'nema-5-15r')
    const upper: PartInstance = { uid: 'xs2', designator: 'XS2', module: 's-nema-5-15r', x: 0, y: 0 }
    expect(seatOf({ ...d, parts: [d.parts[0], upper, d.parts[1]] }, 'xp', [])).toMatchObject({ status: 'seated', board: 'xs2' })
  })
  it('a plug over a breadboard never seats in it', () => {
    const bb = load('breadboard-half')
    const pm = plugModule('nema-5-15p')
    for (let x = 0; x < 100; x += 10)
      for (let y = 0; y < 100; y += 10) {
        const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { [bb.id]: bb, [pm.id]: pm }, connections: [],
          parts: [{ uid: 'bb', designator: 'BB1', module: bb.id, x: 0, y: 0 }, { uid: 'xp', designator: 'XP1', module: pm.id, x, y, mount: { board: 'bb' } }] }
        expect(seated(d)).toBe(false)
        expect(mountIssues(d)).toHaveLength(1)
      }
  })
  it('contacts spread across two sockets (never seats)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-split'), at('xp1', 'XP1', 't-plug-us')], [])
    expect(seated(d, 'xp1')).toBe(false)
  })
  it('a part that is not a plug does not seat in an outlet', () => {
    // Two legs 20 px apart on the bottom edge: at (0, 0) they land on the outlet's N and L holes.
    const two: ModuleDef = { format: 'circuitoon-module/1', id: 't-two-leg', name: 'Two legs', size: { w: 4, h: 3 }, pins: [{ name: 'a', side: 'bottom' }, { spacer: true, side: 'bottom' }, { name: 'b', side: 'bottom' }] }
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('r1', 'R1', 't-two-leg', 0, 0, { mount: { board: 'xs1' } })], [], { 't-two-leg': two })
    expect(seatOf(d, 'r1', [])?.status).toBe('partial')
    expect(mountIssues(d).map((i) => i.reason)).toEqual(['no-fit'])
  })
})

describe('plug counterexamples and rule 10', () => {
  it('reversed Schuko plug (no false short)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('xp1', 'XP1', 't-plug-schuko', 0, 0, { rotation: 180, mount: { board: 'xs1' } }), at('e1', 'E1', 't-lamp-230', 300)],
      [w('xp1|L', 'e1|L'), w('xp1|N', 'e1|N')])
    expect(mountIssues(d)).toEqual([])
    expect(checkDiagram(d).map((f) => f.rule)).not.toContain('mains-short')
    expect(analyseMains(d)!.conductorOf(nodeKey('xp1', 'L'))?.conductor).toBe('N')
  })
  it('UK fused plug protecting a cord-wired lamp (clean)', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet-uk'), at('xp1', 'XP1', 't-plug-uk', 0, 0, { mount: { board: 'xs1' } }), at('e1', 'E1', 't-lamp-230', 300)],
      [w('xp1|L', 'e1|L'), w('xp1|N', 'e1|N')])
    expect(checkDiagram(d).filter((f) => f.rule !== 'cable-unverified').map((f) => `${f.rule}: ${f.message}`)).toEqual([])
  })
  it('a plug over an outlet of another family: plug-mismatch, in the spec\'s words', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-uk')], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "XP1's UK plug does not fit XS1's US socket. Use a device with a US plug.",
    ])
  })
  it('a matching plug that is only partly in says it is never safe', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-us', 10, 0)], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      'XP1 does not sit in XS1: its contacts do not all meet one socket the way the plug fits, so none of them connect. Turn or move it until it seats; a plug that is only partly in is never electrically safe.',
    ])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/format/plugSeating.test.ts`
Expected: FAIL (plug-in devices do not seat through the table yet).

- [ ] **Step 4: Seat plug-in devices through the table in `src/format/breadboard.ts`**

Add imports: `type Rect`, `toWorld` from `./geometry.ts`; `type PlugDef`, `type PlugFamily`, `type SocketFamily`, `mainsOf` from `./mainsModel.ts`; `entriesFor`, `orientationOf` from `./plugging.ts`.

Add to `Seat`:

```ts
  /** A plug-in device over an outlet it does not seat in: its body, drawn red while dragging. */
  outline?: Rect
```

Add `'no-fit'` to `MountIssue['reason']` with the comment "no-fit: an outlet takes only a matching plug, and a plug fits only a matching outlet".

Replace `mountable`, `Fit`, `fitOn`, `seatFrom`, the ranking in `seatOf`, `seatOn` and the fit handling in `mounts` with:

```ts
interface Me { part: PartInstance; m: ModuleDef; pts: PlugPoint[]; plug: PlugDef | null }

/**
 * A part that may mount, with its plug points: its pin edge points, or for a plug-in device every
 * contact of every profile (seating then picks the profile the socket takes). Null for a missing
 * part or module, a board, and a part with a bus pin or no pins.
 */
function mountable(d: Diagram, uid: string): Me | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || isBoard(m) || m.pins.some((p) => !isSpacer(p) && p.bus)) return null
  const plug = mainsOf(m).plug
  if (!plug) {
    const pts = plugPoints(part, m)
    return pts.length ? { part, m, pts, plug: null } : null
  }
  const lay = layoutModule(m)
  const seen = new Set<string>()
  const pts: PlugPoint[] = []
  for (const pr of plug.profiles)
    for (const c of pr.contacts) {
      const at = toWorld(part, lay, c.at)
      const k = `${c.pin}@${at.x},${at.y}`
      if (!seen.has(k)) {
        seen.add(k)
        pts.push({ pin: c.pin, at })
      }
    }
  return pts.length ? { part, m, pts, plug } : null
}

interface Fit {
  board: PartInstance
  groups: WorldHoleGroup[]
  /** The plug points this fit uses: every leg, or the contacts of the profile an outlet's socket took. */
  pts: PlugPoint[]
  hits: ([number, number] | null)[]
  landed: number
  obscured: boolean
  /** False when this board never takes this part (an outlet for anything but a matching plug, any other board for a plug). */
  seatable: boolean
  /** A plug-in device's body where it overlaps an outlet, for the red outline. */
  outline: Rect | null
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** How a part lands on one board; null when that part is not a board. A plug seats only through the compatibility table (spec 2). */
function fitOn(d: Diagram, board: PartInstance, me: Me): Fit | null {
  const bm = moduleOf(d, board.module)
  if (!bm || !isBoard(bm)) return null
  const idx = holeIndex(board, bm)
  const sockets = mainsOf(bm).sockets
  const body = me.plug && sockets.length ? bodyRect(me.part, layoutModule(me.m)) : null
  const outline = body && intersects(body, bodyRect(board, layoutModule(bm))) ? body : null
  const plain = (seatable: boolean): Fit => {
    const hits = me.pts.map((pp) => holeAt(idx, pp.at))
    const landed = hits.filter(Boolean).length
    return { board, groups: idx.groups, pts: me.pts, hits, landed, obscured: landed > 0 && obscuredOn(d, board, me.pts), seatable, outline }
  }
  if (!me.plug || !sockets.length) return plain(!me.plug && !sockets.length)
  const lay = layoutModule(me.m)
  const orientation = orientationOf(me.part, board)
  let best: Fit | null = null
  for (const socket of sockets) {
    // Roles of this socket's contacts only: seating never collects contacts across sockets.
    const roles = new Map(socket.contacts.map((c) => [c.group, c.role]))
    for (const e of entriesFor(me.plug.family, socket.family)) {
      const profile = me.plug.profiles.find((p) => p.id === e.profile)
      if (!profile) continue
      const pts = profile.contacts.map((c) => ({ pin: c.pin, at: toWorld(me.part, lay, c.at) }))
      const hits = pts.map((pp) => holeAt(idx, pp.at))
      const landed = hits.filter(Boolean).length
      const map = e.map[orientation]
      const seatable = !!map && hits.every((h, i) => !!h && roles.get(idx.groups[h[0]].name) === map[profile.contacts[i].mains])
      const fit: Fit = { board, groups: idx.groups, pts, hits, landed, obscured: landed > 0 && obscuredOn(d, board, pts), seatable, outline }
      if (!best || (fit.seatable && !best.seatable) || (fit.seatable === best.seatable && fit.landed > best.landed)) best = fit
    }
  }
  return best ?? plain(false)
}

/** An obscured board never seats: its fit shows as partial (red), so a drop does not mount. */
function seatFrom(fit: Fit, taken: ReadonlySet<string>): Seat | null {
  if (!fit.landed && !fit.outline) return null
  const seated = fit.seatable && !fit.obscured && fit.hits.every((h) => h && !taken.has(holeKey(fit.board.uid, fit.groups[h[0]].name, h[1])))
  return {
    status: seated ? 'seated' : 'partial', board: fit.board.uid, holes: fit.pts.filter((_, i) => fit.hits[i]).map((pp) => pp.at),
    ...(fit.outline && !seated ? { outline: fit.outline } : {}),
  }
}
```

In `seatOf`: `const fit = b === me.part ? null : fitOn(d, b, me)`, skip when `!fit || (!fit.landed && !fit.outline)`, and rank with

```ts
    if (!best || (best.obscured && !fit.obscured) || (best.obscured === fit.obscured && ((fit.seatable && !best.seatable) || (fit.seatable === best.seatable && fit.landed >= best.landed)))) best = fit
```

then `return best && seatFrom(best, takenBy(plugs, ignore))`. In `seatOn`: `const fit = me && b && b !== me.part ? fitOn(d, b, me) : null` and `return fit && seatFrom(fit, takenBy(plugs, ignore))`. In `mounts`:

```ts
    const fit = fitOn(d, board, me)!
    if (fit.landed < fit.pts.length) issue('partial')
    else if (!fit.seatable) issue('no-fit')
    else if (fit.obscured) issue('obscured')
    else if (seatFrom(fit, taken)!.status !== 'seated') issue('conflict')
    else
      fit.pts.forEach((pp, i) => {
        const [gi, hi] = fit.hits[i]!
        const group = fit.groups[gi].name
        taken.add(holeKey(board.uid, group, hi))
        plugs.push({ part: p.uid, pin: pp.pin, board: board.uid, group, hole: hi, at: pp.at })
      })
```

For every existing part (no plug, board without sockets) `seatable` is true and `outline` null, so breadboard behaviour is unchanged (the existing breadboard tests prove it).

Add at the end of `breadboard.ts`:

```ts
export interface PlugMismatch { part: string; board: string; kind: 'family' | 'fit'; plug: PlugFamily; socket: SocketFamily }

/**
 * Plug-in devices over an outlet they are not validly plugged into (spec rule 10): `family` when no
 * socket of that outlet takes this plug at all, `fit` when one would but the plug does not sit in it
 * (moved off, turned the wrong way, or its contacts spread across two sockets).
 */
export function plugMismatches(d: Diagram): PlugMismatch[] {
  const plugged = new Set(plugsOf(d).map((pl) => pl.part))
  const out: PlugMismatch[] = []
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    const plug = m ? mainsOf(m).plug : null
    if (!m || !plug || plugged.has(p.uid)) continue
    const body = bodyRect(p, layoutModule(m))
    for (const b of d.parts) {
      const bm = b === p ? undefined : moduleOf(d, b.module)
      const sockets = bm ? mainsOf(bm).sockets : []
      if (!bm || !sockets.length || !intersects(body, bodyRect(b, layoutModule(bm)))) continue
      const fits = sockets.some((s) => entriesFor(plug.family, s.family).length > 0)
      out.push({ part: p.uid, board: b.uid, kind: fits ? 'fit' : 'family', plug: plug.family, socket: sockets[0].family })
    }
  }
  return out
}
```

- [ ] **Step 5: Report it in the loader and the checker**

In `src/format/diagram.ts` `validateDiagram`, after the `conflict` branch of the mount warnings:

```ts
    else if (reason === 'no-fit')
      warnings.push(`${at}: "${part}" does not fit board "${board}" (an outlet takes only a matching plug, and a plug fits only a matching outlet), so it plugs into nothing`)
```

In `src/format/checks.ts` (import `plugMismatches` from `./breadboard.ts` and `PLUG_FOR`, `PLUG_NAMES`, `SOCKET_NAMES` from `./plugging.ts`), before the mount loop:

```ts
  // Rule 10 (spec 2): a plug-in device over an outlet it is not plugged into. It replaces the
  // generic mount finding for that part and outlet.
  const mismatched = new Set<string>()
  for (const mm of plugMismatches(d)) {
    const p = partByUid.get(mm.part)!
    const b = partByUid.get(mm.board)!
    mismatched.add(JSON.stringify([mm.part, mm.board]))
    const message = mm.kind === 'family'
      ? `${p.designator}'s ${PLUG_NAMES[mm.plug]} does not fit ${b.designator}'s ${SOCKET_NAMES[mm.socket]}. Use a device with ${PLUG_FOR[mm.socket]}.`
      : `${p.designator} does not sit in ${b.designator}: its contacts do not all meet one socket the way the plug fits, so none of them connect. Turn or move it until it seats; a plug that is only partly in is never electrically safe.`
    add({ rule: 'plug-mismatch', subject: p.designator, target: p.designator, message, parts: [p.uid, b.uid], pins: [], wires: [], select: { parts: [p.uid], wires: [] }, causes: [p.uid, b.uid] })
  }
```

and at the top of the mount loop body: `if (mismatched.has(JSON.stringify([issue.part, issue.board]))) continue`. Add a `no-fit` case to `mountMessage`:

```ts
    case 'no-fit':
      return `${p.designator} does not fit ${at}: an outlet takes only a matching plug, and a plug fits only a matching outlet, so it connects nothing. Drag it off, or use a part that fits.`
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/format/plugSeating.test.ts src/format/breadboard.test.ts src/format/breadboard.perf.test.ts src/editor/ops.test.ts`
Expected: PASS (the existing breadboard tests prove seating on breadboards is unchanged). Then the gate `npx tsc --noEmit && npm test`: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/format/breadboard.ts src/format/diagram.ts src/format/checks.ts src/format/mains.testing.ts src/format/plugSeating.test.ts
git commit -m "Mains: seat plug-in devices through the table, no-fit, plug-mismatch" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Plugging on the canvas: the red outline of a plug that does not fit

**Files:**
- Modify: `src/editor/Canvas.tsx:550-554`
- Test: `src/editor/ops.test.ts`

**Interfaces:**
- Consumes: `Seat.outline` (Task 13), `settleSeats` (existing, `ops.ts`), the fixtures of Task 13.
- Produces: while a plug-in device is dragged over an outlet it does not seat in, its body is outlined in the `seat-bad` style (spec 7's "a wrong plug (red)"); a seated plug shows its green contact marks as any part does.

- [ ] **Step 1: Write the failing test**

Add to `src/editor/ops.test.ts`:

```ts
describe('plug-in devices while dragging', () => {
  it('a wrong plug over an outlet gets an outline; a matching one seats', () => {
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('xp1', 'XP1', 't-plug-uk'), at('xp2', 'XP2', 't-plug-us', 0, 300)], [])
    const wrong = settleSeats(d, ['xp1']).seats.get('xp1')
    expect(wrong?.status).toBe('partial')
    expect(wrong?.outline).toEqual({ x: 0, y: 0, w: 60, h: 60 })
    const right = settleSeats({ ...d, parts: [d.parts[0], d.parts[1], { ...d.parts[2], y: 0 }] }, ['xp2']).seats.get('xp2')
    expect(right?.status).toBe('seated')
    expect(right?.outline).toBeUndefined()
  })
})
```

(Import `sheet` and `at` from `../format/mains.testing.ts`; `settleSeats` is already imported.) XP1's UK contacts land on no US hole, so they take none, and XP2 seats beside it.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/editor/ops.test.ts`
Expected: PASS, because `Seat.outline` comes from Task 13's mount code (this test pins the data the canvas draws; the drawing itself is checked by `check:mains-ui`). If it fails, fix Task 13's `seatFrom`, not the test.

- [ ] **Step 3: Draw the outline**

In `src/editor/Canvas.tsx`, inside the `<g pointerEvents="none">` that draws seat circles, also draw each seat's outline:

```tsx
          {seats.flatMap((s, i) => (s.outline ? [<rect key={`outline-${i}`} className="seat-bad" x={s.outline.x} y={s.outline.y} width={s.outline.w} height={s.outline.h} rx={6} />] : []))}
```

- [ ] **Step 4: Gate, build and commit**

Run the gate `npx tsc --noEmit && npm test`, then `npm run build`: PASS. Drag a UK plug over a US outlet in `npm run dev` and look: the red outline sits on the plug's body.

```bash
git add src/editor/Canvas.tsx src/editor/ops.test.ts
git commit -m "Mains: red outline for a plug over an outlet it does not fit" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Designators, the Mains category, generator helpers and the part skill

**Files:**
- Modify: `src/editor/ops.ts:35-49` (PREFIXES)
- Modify: `src/editor/libraryGroups.ts:9-12` (CATEGORY_ORDER)
- Modify: `scripts/lib/parts.mjs:82-90` (`moduleJson` takes `holes` and `obstacle`)
- Create: `scripts/lib/mains.mjs`
- Modify: `.claude/skills/circuitoon-add-part/SKILL.md`, `.claude/skills/circuitoon-add-part/references/conventions.md`
- Test: `src/editor/ops.test.ts`, `src/editor/libraryGroups.test.ts`

**Interfaces:**
- Consumes: `SOCKET_PATTERNS`, `PLUG_PROFILES` (Task 12); `EVIDENCE` (Task 0).
- Produces:
  - Prefix rules for the ids the parts tasks use: `outlet-*` XS, `plug-*` XP, `charger-*`, `adapter-*`, `hlk-*` PS, `lamp-holder-*` E, `fuse-holder-*` F, `ssr-*` K, `terminal-block-*` and `wago-*` X (switches keep S, relays keep K).
  - `CATEGORY_ORDER` ends with `'Mains'`.
  - `moduleJson({ ..., holes?, obstacle? })` writes `holes` then `obstacle` right after `size` when given (existing generators pass neither, so their output is unchanged).
  - In `scripts/lib/mains.mjs`: `socket(family, id, cx, cy, suffix)` returns `{ holes, socket }`; `plugProfiles(family, px, py, roles?)` returns profile objects; `prongs(roles?)` returns internal node names; `rating(pins, kind, service, volts, extra?)`.

- [ ] **Step 1: Write the failing tests**

Add to `src/editor/ops.test.ts` (inside the designator `describe`, reusing its `mk` helper):

```ts
  it('gives each mains family its prefix without taking any other family\'s ids', () => {
    const want: Record<string, string> = {
      'outlet-us-5-15r-duplex': 'XS', 'outlet-uk-bs1363': 'XS', 'plug-us-5-15p': 'XP', 'plug-uk-bs1363-2lead': 'XP',
      'charger-usb-5v-us': 'PS', 'adapter-barrel-eu': 'PS', 'hlk-pm01': 'PS', 'hlk-pm03': 'PS',
      'lamp-holder-e26': 'E', 'lamp-holder-e27': 'E', 'fuse-holder-5x20-inline': 'F',
      'rocker-switch-kcd1': 'S', 'relay-module-1ch-5v': 'K', 'ssr-fotek-25da': 'K',
      'terminal-block-mstb-508-2': 'X', 'terminal-block-kf301-500-3': 'X', 'wago-221-415': 'X',
      // Unchanged neighbours that a careless rule could catch.
      'esp32-terminal-board-38': 'U', 'usb-panel-mount-usbc': 'J', 'push-button': 'S', 'power-rail-strip': 'BB', 'led': 'D', 'lcd-st7796s-4in-spi-touch': 'DS',
    }
    for (const [id, prefix] of Object.entries(want)) expect([id, designatorPrefix(mk(id))]).toEqual([id, prefix])
  })
  it('numbers each prefix on its own, so XS, XP and X never share or skip numbers', () => {
    let d = emptyDiagram()
    const names: string[] = []
    for (const id of ['wago-221-412', 'outlet-us-5-15r-duplex', 'plug-us-5-15p', 'wago-221-413', 'outlet-uk-bs1363']) {
      const next = addPart(d, mk(id), 0, 0)
      d = next.diagram
      names.push(d.parts.find((p) => p.uid === next.uid)!.designator)
    }
    expect(names).toEqual(['X1', 'XS1', 'XP1', 'X2', 'XS2'])
  })
```

(`mk(id)` in that `describe` builds a minimal module with the given id; if the helper is named differently, use it.)

In `src/editor/libraryGroups.test.ts` add:

```ts
  it('puts Mains last among the named categories', () => {
    expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe('Mains')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/editor/ops.test.ts src/editor/libraryGroups.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/editor/ops.ts` put the mains rules first; each is anchored to its own id prefix, so none catches an existing id:

```ts
const PREFIXES: [RegExp, string][] = [
  // Mains families (spec 4). Anchored, and listed before the older rules so "switch" and "relay"
  // keep their S and K.
  [/^outlet-/, 'XS'],
  [/^plug-/, 'XP'],
  [/^(charger-|adapter-|hlk-)/, 'PS'],
  [/^lamp-holder-/, 'E'],
  [/^fuse-holder-/, 'F'],
  [/^ssr-/, 'K'],
  [/^(terminal-block-|wago-)/, 'X'],
  [/^potentiometer/, 'RV'],
  // ...the existing rules, unchanged
]
```

In `src/editor/libraryGroups.ts` append `'Mains'` to `CATEGORY_ORDER`.

In `scripts/lib/parts.mjs` let `moduleJson` accept `holes` and `obstacle`:

```js
export function moduleJson({ id, name, category, source, pins, internal, wu, hu, electrical, states, inside = false, shapes, holes, obstacle }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category, source, pins }
  if (internal) m.internal = internal
  m.size = { w: wu, h: hu }
  if (holes) m.holes = holes
  if (obstacle !== undefined) m.obstacle = obstacle
  m.electrical = electrical
  if (states) m.states = states
  m.art = inside ? { w: wu * 10, h: hu * 10, pinLabels: 'inside', shapes } : { w: wu * 10, h: hu * 10, shapes }
  return m
}
```

Create `scripts/lib/mains.mjs`:

```js
// Shared helpers for the mains part generators (gen-mains-*.mjs): sockets and plug profiles built
// from the stylized patterns in src/format/plugging.ts (the same numbers the checker seats with; Node
// strips the types when importing it), prong internal nodes, and rating entries.
import { PLUG_PROFILES, SOCKET_PATTERNS } from '../../src/format/plugging.ts'

const ROLES = ['L', 'N', 'PE']

/** Hole groups and the socket entry for one socket of `family` centred at (cx, cy); group names get `suffix` ("L1"). */
export function socket(family, id, cx, cy, suffix = '') {
  const pat = SOCKET_PATTERNS[family]
  const roles = ROLES.filter((c) => pat[c].length)
  return {
    holes: roles.map((c) => ({ name: `${c}${suffix}`, label: c, at: pat[c].map(([x, y]) => [cx + x, cy + y]) })),
    socket: { id, family, contacts: roles.map((c) => ({ group: `${c}${suffix}`, role: c })) },
  }
}

/** The plug profiles of `family` with contacts centred on the pivot (px, py); `roles` leaves out a prong the device lacks (a two-pin plug). */
export function plugProfiles(family, px, py, roles = ROLES) {
  return PLUG_PROFILES[family].map((pr) => ({
    id: pr.id,
    contacts: roles.flatMap((c) => pr.contacts[c].map(([x, y]) => ({ pin: `${c} prong`, at: { x: px + x, y: py + y }, mains: c }))),
  }))
}

/** The prong internal nodes of a plug with these roles. */
export const prongs = (roles = ROLES) => roles.map((c) => `${c} prong`)

/** One rating entry (spec 1.4). Its source goes in the module's `source` and a comment beside the value. */
export const rating = (pins, kind, service, volts, extra = {}) => ({ pins, kind, service, volts, ...extra })
```

Update the skill:
- `SKILL.md` step 3: add the new prefixes to the list, in order, and "Mains" to the category note.
- `SKILL.md` step 5: add `gen-mains-outlets.mjs` (outlets), `gen-mains-plugs.mjs` (chargers, barrel adapters, cord plugs), `gen-mains-loads.mjs` (AC-DC modules, lamp holders, fuse holder, Wago), `gen-mains-terminals.mjs` (terminal blocks), and that `gen-outputs.mjs` also holds the Fotek SSR; mains generators use `scripts/lib/mains.mjs`.
- `references/conventions.md`: add a "Mains parts" section: category `Mains`; every mains claim (pin, contact, profile, rating, isolation) cites the exact manufacturer part or standard in `source` and in a comment beside the value; plug prongs are `electrical.internalNodes` named `"L prong"`, `"N prong"`, `"PE prong"`, placed with `plugProfiles` from the family pattern; outlets are boards (`obstacle: false`) whose every hole group is a socket contact, built with `socket`; ratings carry `provenance` (`datasheet` only for the exact part; clones and generic boards are `unverified`) and `conditions` when the datasheet ties a rating to overvoltage category, pollution degree or mounting; `isolation` is the class the source states (reinforced, double, basic) and nothing else: never inferred from a test voltage, a class 2 symbol, an SELV or ES1 label or a listing; when the source states no class it is `"unknown"`; every value comes from `src/format/mainsEvidence.ts`, which is researched first (as in Task 0) and reviewed before any part is generated; a value the source does not give is left out, which the checker reports as unknown. Add "Mains" to the Categories line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/editor/ops.test.ts src/editor/libraryGroups.test.ts` then the gate `npx tsc --noEmit && npm test`, and `npm run check:gen` (the `moduleJson` change must not alter any existing generated file).
Expected: PASS, and `check-gen: all 8 generators match modules/`.

- [ ] **Step 5: Commit**

```bash
git add src/editor/ops.ts src/editor/libraryGroups.ts src/editor/ops.test.ts src/editor/libraryGroups.test.ts scripts/lib/parts.mjs scripts/lib/mains.mjs .claude/skills/circuitoon-add-part
git commit -m "Mains: designators, Mains category, generator helpers, part skill" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 16: Parts batch 1: wall outlets

**Files:**
- Create: `scripts/gen-mains-outlets.mjs`
- Create (generated): `modules/outlet-us-5-15r-duplex.json`, `modules/outlet-us-5-20r-duplex.json`, `modules/outlet-uk-bs1363.json`, `modules/outlet-schuko-cee7-3.json`, `modules/outlet-fr-cee7-5.json`, `modules/outlet-au-as3112.json`, `modules/outlet-jp-1-15r-duplex.json`, `modules/outlet-jp-1-15r-duplex-polarized.json`
- Create: `src/format/mainsParts.test.ts`
- Modify: `docs/PRD.md` (Built-in parts table: a Mains row)

**Interfaces:**
- Consumes: `socket`, `rating` (`scripts/lib/mains.mjs`, Task 15); `moduleJson`, `r`, `write` (`scripts/lib/parts.mjs`); `SOCKET_PATTERNS` (Task 12).
- Produces: the eight outlet modules above (ids exactly as listed; designator XS). Each is a board (`obstacle: false`) with `electrical.model: 'outlet'`, `params.acVoltage`, `ac: { hz, region }`, one `acSources` entry `supply`, one socket per face, a `terminal` rating on every socket group. Duplex hole groups are `L1 N1 PE1` (upper) and `L2 N2 PE2` (lower), joined by `internal` (intact link); single outlets use `L N PE`. Socket centres: duplex at (40, 40) and (40, 100) in an 80 x 140 body; single at (40, 40) in an 80 x 80 body.

Sources (the pattern positions are stylized; these give the real layout, the L side and the rating):

| Part | Standard (contact layout, rating) | Reference product (face, for the art) |
| --- | --- | --- |
| US 5-15R duplex | NEMA WD 6 (5-15R, 15 A 125 V); IEC TR 60083 (US entry) | Leviton 5320 duplex receptacle datasheet |
| US 5-20R duplex | NEMA WD 6 (5-20R, 20 A 125 V, T-slot neutral) | Leviton 5352 duplex receptacle datasheet |
| UK single | BS 1363-2 (13 A 250 V); IEC TR 60083 (GB entry) | MK Electric (Honeywell) unswitched 13 A single socket, catalogue page |
| Schuko single | CEE 7 standard sheet VII, DIN 49440 (16 A 250 V); IEC TR 60083 (DE entry) | Gira or Busch-Jaeger SCHUKO socket insert datasheet |
| French single | CEE 7 standard sheet V, NF C 61-314 (16 A 250 V); IEC TR 60083 (FR entry) | Legrand 2P+E socket datasheet |
| AU/NZ single | AS/NZS 3112 (10 A 250 V); IEC TR 60083 (AU entry) | Clipsal single socket datasheet |
| Japan 1-15R duplex, unpolarized and polarized | JIS C 8303 (15 A 125 V; the polarized face has the longer neutral slot); IEC TR 60083 (JP entry) | Panasonic WN series duplex receptacle datasheet |

- [ ] **Step 1: Take every value from the evidence (no new lookups)**

At the top of `scripts/gen-mains-outlets.mjs`:

```js
import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))
```

Before generating a part, check its evidence: `verdict: 'VERIFIED'`, or a NOT VERIFIED item Michael has decided on (the evidence log records his decision: generate with a value left unknown, or do not generate). A part he has not cleared is not generated in this task, and its test cases are removed from this batch with a note in the commit message. No value here is looked up again or filled from this plan. The rating and default voltage in the generator are the values the standards fix; the test below also compares them with the evidence, so a disagreement fails. Each family's `lSide` in the evidence must match Task 12's pattern table (Task 0 flagged any difference and Michael decided before this task). Put each family's real contact spacing, from `EVIDENCE[id].extra`, in the comment above its generator block.

- [ ] **Step 2: Write the failing test**

Create `src/format/mainsParts.test.ts`:

```ts
// Regression test for the built-in mains parts (scripts/gen-mains-*.mjs and the relay and SSR in
// scripts/gen-outputs.mjs): contacts on the family patterns of src/format/plugging.ts, ratings,
// regions, isolation and sources. Every value was checked against the sources in each module's
// `source`; a wrong pin or rating is worse than a missing part, so any change here must be
// re-checked there.
import { describe, expect, it } from 'vitest'
import { layoutModule } from './module.ts'
import { pivot } from './geometry.ts'
import { CONDUCTORS, type Conductor, type SocketFamily, mainsOf } from './mainsModel.ts'
import { SOCKET_PATTERNS } from './plugging.ts'
import { load } from './builtinModules.testing.ts'
import { EVIDENCE } from './mainsEvidence.ts'

const twoSources = /^https?:\/\/\S+( https?:\/\/\S+)+$/

/** Each socket's holes by role, relative to the socket's centre (found from its L hole and the pattern). */
function socketOffsets(id: string): { family: SocketFamily; offsets: Record<Conductor, [number, number][]> }[] {
  const m = load(id)
  const holes = new Map((m.holes ?? []).map((h) => [h.name, h.at]))
  return mainsOf(m).sockets.map((s) => {
    const at = (c: Conductor) => s.contacts.filter((x) => x.role === c).flatMap((x) => holes.get(x.group) ?? [])
    const [[lx, ly]] = at('L')
    const [[px, py]] = SOCKET_PATTERNS[s.family].L
    const [cx, cy] = [lx - px, ly - py]
    return { family: s.family, offsets: Object.fromEntries(CONDUCTORS.map((c) => [c, at(c).map(([x, y]) => [x - cx, y - cy])])) as Record<Conductor, [number, number][]> }
  })
}

describe('built-in outlets', () => {
  const want: Record<string, { family: SocketFamily; sockets: number; volts: number; hz: number; region: string; rated: number; amps: number }> = {
    'outlet-us-5-15r-duplex': { family: 'nema-5-15r', sockets: 2, volts: 120, hz: 60, region: 'us', rated: 125, amps: 15 },
    'outlet-us-5-20r-duplex': { family: 'nema-5-20r', sockets: 2, volts: 120, hz: 60, region: 'us', rated: 125, amps: 20 },
    'outlet-uk-bs1363': { family: 'bs1363', sockets: 1, volts: 230, hz: 50, region: 'uk', rated: 250, amps: 13 },
    'outlet-schuko-cee7-3': { family: 'cee7-3', sockets: 1, volts: 230, hz: 50, region: 'eu', rated: 250, amps: 16 },
    'outlet-fr-cee7-5': { family: 'cee7-5', sockets: 1, volts: 230, hz: 50, region: 'eu', rated: 250, amps: 16 },
    'outlet-au-as3112': { family: 'as3112', sockets: 1, volts: 230, hz: 50, region: 'au', rated: 250, amps: 10 },
    'outlet-jp-1-15r-duplex': { family: 'nema-1-15r', sockets: 2, volts: 100, hz: 50, region: 'jp', rated: 125, amps: 15 },
    'outlet-jp-1-15r-duplex-polarized': { family: 'nema-1-15r-polarized', sockets: 2, volts: 100, hz: 50, region: 'jp', rated: 125, amps: 15 },
  }
  for (const [id, x] of Object.entries(want))
    it(`${id}: a board, its sockets on the family pattern, voltage, region and rating`, () => {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.category).toBe('Mains')
      expect(m.obstacle).toBe(false)
      expect(m.source).toMatch(twoSources)
      const sockets = socketOffsets(id)
      expect(sockets.map((s) => s.family)).toEqual(Array(x.sockets).fill(x.family))
      for (const s of sockets) expect(s.offsets).toEqual(SOCKET_PATTERNS[x.family])
      expect((m.electrical as { params: { acVoltage: { default: number } } }).params.acVoltage.default).toBe(x.volts)
      expect([info.hz, info.region]).toEqual([x.hz, x.region])
      expect(info.acSources).toHaveLength(1)
      expect(info.ratings).toEqual([expect.objectContaining({ kind: 'terminal', service: 'ac', volts: x.rated, amps: x.amps, provenance: 'datasheet' })])
      // The standard's figures and the evidence must agree; the source is the evidence's.
      expect([EVIDENCE[id].ratings?.[0].volts, EVIDENCE[id].ratings?.[0].amps]).toEqual([x.rated, x.amps])
      expect(m.source).toBe(EVIDENCE[id].sources.join(' '))
      expect(info.ratings[0].pins.sort()).toEqual((m.holes ?? []).map((h) => h.name).sort())
      if (x.sockets === 2) expect(m.internal).toEqual([['L1', 'L2'], ['N1', 'N2'], ...(SOCKET_PATTERNS[x.family].PE.length ? [['PE1', 'PE2']] : [])])
      expect(pivot(layoutModule(m).w, layoutModule(m).h)).toEqual(x.sockets === 2 ? { x: 40, y: 70 } : { x: 40, y: 40 })
    })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/format/mainsParts.test.ts`
Expected: FAIL (`modules/outlet-us-5-15r-duplex.json` not found).

- [ ] **Step 4: Write `scripts/gen-mains-outlets.mjs`**

```js
// Generates the built-in wall outlets (category Mains): US NEMA 5-15R and 5-20R duplex receptacles,
// a UK BS 1363 socket, a Schuko (CEE 7/3) and a French (CEE 7/5) socket, an AU/NZ AS/NZS 3112
// socket and Japanese 1-15R duplex receptacles (unpolarized, and polarized with the longer neutral
// slot). Each is a board whose hole groups are its socket contacts, placed on the stylized family
// pattern of src/format/plugging.ts through lib/mains.mjs; the real layout, L side and rating come
// from the standards and reference products cited per part (SRC). Intact-link duplexes only: both
// faces share L, N and PE (spec 4).
//
// Run from the repo root: `node scripts/gen-mains-outlets.mjs` (add `--check` to compare with modules/
// without writing). src/format/mainsParts.test.ts pins the contacts and ratings.
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, write } from './lib/parts.mjs'
import { rating, socket } from './lib/mains.mjs'

import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))

const PLATE = '#F2EEE3', FACE = '#FBF9F3', SLOT = '#2B2F36', METAL = '#C9CED6', SCREW = '#B8BEC7'
const WHITE = '#F5F5F2', ROUND = '#E6E2DA'

/** A NEMA face centred at (cx, cy): neutral slot on the left (taller when polarized), line slot on the right, earth hole below. */
function nemaFace(cx, cy, { earth, polarized, tee = false }) {
  const n = polarized ? 18 : 14
  return [
    r(cx - 22, cy - 16, 44, earth ? 44 : 32, FACE, { radius: 14 }),
    r(cx - 12, cy - n / 2, 4, n, SLOT, { radius: 1, outline: false }),
    ...(tee ? [r(cx - 16, cy - 2, 8, 4, SLOT, { radius: 1, outline: false })] : []),
    r(cx + 8, cy - 7, 4, 14, SLOT, { radius: 1, outline: false }),
    ...(earth ? [r(cx - 4, cy + 16, 8, 8, SLOT, { radius: 4, outline: false })] : []),
  ]
}

/** A duplex receptacle: two faces on one plate, both sockets on one supply (intact link). */
function duplex({ id, name, family, amps, volts, hz, region, earth, polarized, tee = false }) {
  const a = socket(family, 'upper', 40, 40, '1')
  const b = socket(family, 'lower', 40, 100, '2')
  const holes = [...a.holes, ...b.holes]
  const internal = [['L1', 'L2'], ['N1', 'N2'], ...(earth ? [['PE1', 'PE2']] : [])]
  const shapes = [
    r(0, 0, 80, 140, PLATE, { radius: 8 }),
    ...nemaFace(40, 40, { earth, polarized, tee }),
    ...nemaFace(40, 100, { earth, polarized, tee }),
    r(36, 72, 8, 8, SCREW, { radius: 4 }),
  ]
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source: SRC[id], pins: [], internal, wu: 8, hu: 14, holes, obstacle: false, shapes,
    electrical: {
      model: 'outlet', params: { acVoltage: { unit: 'VAC', default: volts } }, ac: { hz, region },
      acSources: [{ id: 'supply', live: ['L1'], neutral: ['N1'], ...(earth ? { earth: ['PE1'] } : {}) }],
      sockets: [a.socket, b.socket],
      ratings: [rating(holes.map((h) => h.name), 'terminal', 'ac', 125, { amps, provenance: 'datasheet' })],
    },
  }))
}

/** A single socket on an 80 x 80 plate, centred at (40, 40). */
function single({ id, name, family, amps, face }) {
  const s = socket(family, 'main', 40, 40)
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source: SRC[id], pins: [], wu: 8, hu: 8, holes: s.holes, obstacle: false, shapes: face,
    electrical: {
      model: 'outlet', params: { acVoltage: { unit: 'VAC', default: 230 } }, ac: { hz: 50, region: family === 'bs1363' ? 'uk' : family === 'as3112' ? 'au' : 'eu' },
      acSources: [{ id: 'supply', live: ['L'], neutral: ['N'], earth: ['PE'] }],
      sockets: [s.socket],
      ratings: [rating(s.holes.map((h) => h.name), 'terminal', 'ac', 250, { amps, provenance: 'datasheet' })],
    },
  }))
}

// ---------------------------------------------------------------------------------------------
// US: NEMA 5-15R and 5-20R, 15 A and 20 A at 125 V (NEMA WD 6). Seen from the front with the earth
// hole down: neutral (taller) slot left, line slot right. The 5-20R neutral is T-shaped.
duplex({ id: 'outlet-us-5-15r-duplex', name: 'US outlet NEMA 5-15R duplex (15 A, 120 V)', family: 'nema-5-15r', amps: 15, volts: 120, hz: 60, region: 'us', earth: true, polarized: true })
duplex({ id: 'outlet-us-5-20r-duplex', name: 'US outlet NEMA 5-20R duplex (20 A, 120 V)', family: 'nema-5-20r', amps: 20, volts: 120, hz: 60, region: 'us', earth: true, polarized: true, tee: true })

// Japan: 1-15R, 15 A 125 V (JIS C 8303), 100 V. Unpolarized: equal slots; polarized: the longer neutral slot.
duplex({ id: 'outlet-jp-1-15r-duplex', name: 'Japan outlet 1-15R duplex (15 A, 100 V, 50 Hz)', family: 'nema-1-15r', amps: 15, volts: 100, hz: 50, region: 'jp', earth: false, polarized: false })
duplex({ id: 'outlet-jp-1-15r-duplex-polarized', name: 'Japan outlet 1-15R duplex, polarized (15 A, 100 V, 50 Hz)', family: 'nema-1-15r-polarized', amps: 15, volts: 100, hz: 50, region: 'jp', earth: false, polarized: true })

// UK: BS 1363, 13 A 250 V. Earth slot up, N bottom left, L bottom right.
single({ id: 'outlet-uk-bs1363', name: 'UK outlet BS 1363 single (13 A, 230 V)', family: 'bs1363', amps: 13, face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }), r(6, 4, 68, 64, FACE, { radius: 4 }),
  r(37, 12, 6, 16, SLOT, { radius: 1, outline: false }),
  r(12, 47, 16, 6, SLOT, { radius: 1, outline: false }), r(52, 47, 16, 6, SLOT, { radius: 1, outline: false }),
] })

// Schuko (CEE 7/3, DIN 49440), 16 A 250 V: a round recess, two pin holes, earth clips top and bottom.
single({ id: 'outlet-schuko-cee7-3', name: 'Schuko outlet CEE 7/3 (16 A, 230 V)', family: 'cee7-3', amps: 16, face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }), r(4, 4, 72, 72, ROUND, { radius: 36 }),
  r(15, 35, 10, 10, SLOT, { radius: 5, outline: false }), r(55, 35, 10, 10, SLOT, { radius: 5, outline: false }),
  r(32, 6, 16, 6, METAL, { radius: 2 }), r(32, 68, 16, 6, METAL, { radius: 2 }),
] })

// French (CEE 7/5, NF C 61-314), 16 A 250 V: a round recess, two pin holes, the earth pin at the top.
single({ id: 'outlet-fr-cee7-5', name: 'French outlet CEE 7/5 (16 A, 230 V)', family: 'cee7-5', amps: 16, face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }), r(4, 4, 72, 72, ROUND, { radius: 36 }),
  r(15, 35, 10, 10, SLOT, { radius: 5, outline: false }), r(55, 35, 10, 10, SLOT, { radius: 5, outline: false }),
  r(36, 5, 8, 12, METAL, { radius: 4 }),
] })

// AU/NZ (AS/NZS 3112), 10 A 250 V: two angled flat pins above a vertical earth pin.
single({ id: 'outlet-au-as3112', name: 'AU/NZ outlet AS/NZS 3112 single (10 A, 230 V)', family: 'as3112', amps: 10, face: [
  r(0, 0, 80, 80, WHITE, { radius: 6 }), r(6, 6, 68, 68, FACE, { radius: 6 }),
  r(26, 24, 8, 12, SLOT, { radius: 1, outline: false }), r(46, 24, 8, 12, SLOT, { radius: 1, outline: false }),
  r(37, 52, 6, 16, SLOT, { radius: 1, outline: false }),
] })

finish('gen-mains-outlets.mjs')
```

The slot rects sit under the hole squares the renderer draws, so each contact reads as a slot with its connection point.

- [ ] **Step 5: Generate, validate, test**

Run: `node scripts/gen-mains-outlets.mjs && npm run validate && npm run check:gen && npx vitest run src/format/mainsParts.test.ts && npm test`
Expected: 8 files written; validate `ok` for each; `check-gen: all 9 generators match modules/`; PASS.

- [ ] **Step 6: Look at them**

Run: `npm run build` then `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs outlet-us-5-15r-duplex outlet-us-5-20r-duplex outlet-uk-bs1363 outlet-schuko-cee7-3 outlet-fr-cee7-5 outlet-au-as3112 outlet-jp-1-15r-duplex outlet-jp-1-15r-duplex-polarized --panel` and again with `--dark` (images land in the system temp folder under `circuitoon-shots`; pass `--out <dir>` to choose another), and Read every image. Check: the faces read as the real outlets, each contact's hole sits in its slot, labels readable, the Mains group in the Parts panel reads well. Redraw and re-shoot anything that does not.

- [ ] **Step 7: PRD and commit**

Add a `Mains` row to the Built-in parts table in `docs/PRD.md` ("US NEMA 5-15R and 5-20R duplex, UK BS 1363, Schuko CEE 7/3, French CEE 7/5, AU/NZ AS/NZS 3112, Japan 1-15R duplex (unpolarized, polarized)" | "Mains voltage"); later batches extend it.

```bash
git add scripts/gen-mains-outlets.mjs modules/outlet-*.json src/format/mainsParts.test.ts docs/PRD.md
git commit -m "Mains parts: wall outlets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Independent review (controller, not the implementer)**

The controller dispatches a reviewer who did not write the parts, with WebFetch access, to compare every outlet against its `source`: L, N and PE sides, rating (volts, amps), voltage and frequency default, region, the internal links of the duplexes. Verdict per part: MATCHES, MISMATCH (with differences) or NOT VERIFIED. A MISMATCH or NOT VERIFIED verdict blocks the next batch until it is fixed, or brought to Michael and decided.

---

### Task 17: Parts batch 2: plug-in devices (USB chargers, barrel adapters, cord plugs)

**Files:**
- Create: `scripts/gen-mains-plugs.mjs`
- Create (generated): `modules/charger-usb-5v-{us,eu,uk,au}.json`, `modules/adapter-barrel-{us,eu,uk,au}.json`, `modules/plug-us-5-15p.json`, `modules/plug-us-1-15p.json`, `modules/plug-jp-1-15p.json`, `modules/plug-eu-cee7-7.json`, `modules/plug-eu-cee7-16.json`, `modules/plug-uk-bs1363-3lead.json`, `modules/plug-uk-bs1363-2lead.json`, `modules/plug-au-as3112-3lead.json`, `modules/plug-au-as3112-2lead.json`
- Modify: `src/format/mainsParts.test.ts` (append), `docs/PRD.md` (Mains row)

**Interfaces:**
- Consumes: `plugProfiles`, `prongs`, `rating` (Task 15); the outlets of Task 16 (for the seating test); `PLUG_PROFILES` (Task 12); `specTurns` (`plugSpec.testing.ts`, Task 12).
- Produces (all category `Mains`):
  - Chargers `charger-usb-5v-{region}` and adapters `adapter-barrel-{region}` (designator PS): prongs are internal nodes; `acInput` on the prongs (UK: on `L fused`, after the integral BS 1362 fuse, `protective: [{ from: 'L prong', to: 'L fused', kind: 'fuse', rating }]`); domains `mains` (prongs and `L fused`) and `output` (`selv`); `isolation` per datasheet; `protection: 'class-2'`. Charger outputs `5V` (power_out, supply `5V`) and `GND`; adapter outputs `+` (power_out, value `voltage`) and `-`.
  - Cord plugs `plug-*` (designator XP): lead pins `L`, `N` and `PE` (2-lead plugs: `L`, `N`, plus `PE` only where the plug has an earth pin: the UK 2-lead plug keeps its earth prong, with nothing joined to it) on the bottom edge; requirements `L`/`N` on polarized families, `line` on unpolarized ones, `PE` on earth; prong-to-lead `internal` joins (UK L through its fuse: `fuseRating` param default 13); a `terminal` rating per the standard.
  - Families and bodies: US and JP 60 x 60 (pivot 30, 30); CEE 80 x 80 (pivot 40, 40); UK and AU 60 x 60.

| Part | Family | Roles | Source |
| --- | --- | --- | --- |
| charger-usb-5v-us | nema-1-15p | L, N | reference: a USB wall adapter whose maker's datasheet states input range, plug type, class II and IEC/UL 62368-1 (first choice: CUI Devices SWI series with USB output; else Mean Well) |
| charger-usb-5v-eu | cee7-16 | L, N | same maker, Europlug version |
| charger-usb-5v-uk | bs1363 | L, N, PE | same maker, UK version (integral BS 1362 fuse rating from its datasheet) |
| charger-usb-5v-au | as3112 | L, N | same maker, AU version |
| adapter-barrel-{us,eu,uk,au} | as above | as above | CUI Devices SWI series wall adapter with a 2.1 x 5.5 mm barrel (the plug letter in the part number sets the region); output voltage, input range, isolation from its datasheet |
| plug-us-5-15p | nema-5-15p | L, N, PE | NEMA WD 6 (15 A 125 V); reference Leviton 515PV plug datasheet |
| plug-us-1-15p | nema-1-15p-polarized | L, N | NEMA WD 6 (15 A 125 V); reference Leviton polarized 2-wire plug datasheet |
| plug-jp-1-15p | nema-1-15p | L, N | JIS C 8303 (15 A 125 V) |
| plug-eu-cee7-7 | cee7-7 | L, N, PE | CEE 7 sheet VII (16 A 250 V), both profiles |
| plug-eu-cee7-16 | cee7-16 | L, N | CEE 7 sheet XVI, EN 50075 (2.5 A 250 V) |
| plug-uk-bs1363-3lead / -2lead | bs1363 | L, N, PE | BS 1363-1 (13 A 250 V, BS 1362 fuse) |
| plug-au-as3112-3lead / -2lead | as3112 | L, N, PE / L, N | AS/NZS 3112 (10 A 250 V) |

- [ ] **Step 1: Take every value from the evidence (no new lookups)**

At the top of `scripts/gen-mains-plugs.mjs`:

```js
import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))
/** What the converters need, straight from the evidence. Isolation is "unknown" unless the source states the class (Global Constraints). */
const DATA = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, {
  range: e.acInput?.value, isolation: e.isolation?.value ?? 'unknown', fuse: e.extra?.fuse?.value, volts: e.output?.value.volts,
}]))
```

Before generating a part, check its evidence: `verdict: 'VERIFIED'`, or a NOT VERIFIED item Michael has decided on (the evidence log records his decision: generate with a value left unknown, or do not generate). A part he has not cleared is not generated in this task, and its test cases are removed from this batch with a note in the commit message. No value here is looked up again or filled from this plan. A charger or adapter without an input range in the evidence is not generated (the checker could not judge its input). The cord plugs' ratings are the standards' figures; the test compares them with the evidence.

- [ ] **Step 2: Write the failing test (append to `src/format/mainsParts.test.ts`)**

Add imports: `import { PLUG_PROFILES } from './plugging.ts'`, `import { specTurns } from './plugSpec.testing.ts'`, `import { seatOf } from './breadboard.ts'`, `import type { Diagram } from './diagram.ts'`, `import type { Rotation } from './geometry.ts'`, `import { PLUG_FAMILIES } from './mainsModel.ts'`.

```ts
describe('built-in plug-in devices', () => {
  const devices: Record<string, { family: (typeof PLUG_FAMILIES)[number]; roles: Conductor[]; converter: boolean }> = {
    'charger-usb-5v-us': { family: 'nema-1-15p', roles: ['L', 'N'], converter: true },
    'charger-usb-5v-eu': { family: 'cee7-16', roles: ['L', 'N'], converter: true },
    'charger-usb-5v-uk': { family: 'bs1363', roles: ['L', 'N', 'PE'], converter: true },
    'charger-usb-5v-au': { family: 'as3112', roles: ['L', 'N'], converter: true },
    'adapter-barrel-us': { family: 'nema-1-15p', roles: ['L', 'N'], converter: true },
    'adapter-barrel-eu': { family: 'cee7-16', roles: ['L', 'N'], converter: true },
    'adapter-barrel-uk': { family: 'bs1363', roles: ['L', 'N', 'PE'], converter: true },
    'adapter-barrel-au': { family: 'as3112', roles: ['L', 'N'], converter: true },
    'plug-us-5-15p': { family: 'nema-5-15p', roles: ['L', 'N', 'PE'], converter: false },
    'plug-us-1-15p': { family: 'nema-1-15p-polarized', roles: ['L', 'N'], converter: false },
    'plug-jp-1-15p': { family: 'nema-1-15p', roles: ['L', 'N'], converter: false },
    'plug-eu-cee7-7': { family: 'cee7-7', roles: ['L', 'N', 'PE'], converter: false },
    'plug-eu-cee7-16': { family: 'cee7-16', roles: ['L', 'N'], converter: false },
    'plug-uk-bs1363-3lead': { family: 'bs1363', roles: ['L', 'N', 'PE'], converter: false },
    'plug-uk-bs1363-2lead': { family: 'bs1363', roles: ['L', 'N', 'PE'], converter: false },
    'plug-au-as3112-3lead': { family: 'as3112', roles: ['L', 'N', 'PE'], converter: false },
    'plug-au-as3112-2lead': { family: 'as3112', roles: ['L', 'N'], converter: false },
  }
  const OUTLETS = ['outlet-us-5-15r-duplex', 'outlet-us-5-20r-duplex', 'outlet-uk-bs1363', 'outlet-schuko-cee7-3', 'outlet-fr-cee7-5', 'outlet-au-as3112', 'outlet-jp-1-15r-duplex', 'outlet-jp-1-15r-duplex-polarized']
  for (const [id, x] of Object.entries(devices)) {
    it(`${id}: its prongs sit on the family pattern around its pivot`, () => {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.category).toBe('Mains')
      expect(m.source).toMatch(twoSources)
      expect(info.plug?.family).toBe(x.family)
      const c = pivot(layoutModule(m).w, layoutModule(m).h)
      expect(info.plug!.profiles.map((pr) => pr.id)).toEqual(PLUG_PROFILES[x.family].map((pr) => pr.id))
      info.plug!.profiles.forEach((pr, i) => {
        const want = x.roles.flatMap((role) => PLUG_PROFILES[x.family][i].contacts[role].map(([dx, dy]) => ({ pin: `${role} prong`, at: { x: c.x + dx, y: c.y + dy }, mains: role })))
        expect(pr.contacts).toEqual(want)
      })
      if (x.converter) {
        expect(info.acInput?.range).toEqual(EVIDENCE[id].acInput!.value)
        expect(info.isolation).toBe(EVIDENCE[id].isolation?.value ?? 'unknown')
        expect(info.protection).toBe('class-2')
        expect(info.domains.map((d) => d.kind).sort()).toEqual(['mains', 'selv'])
      }
      if (x.family === 'bs1363') expect(info.protective).toHaveLength(1)
    })
    it(`${id}: seats in every built-in outlet the table allows, at exactly the allowed turns`, () => {
      for (const o of OUTLETS) {
        const om = load(o)
        const dm = load(id)
        const sockets = mainsOf(om).sockets
        // Centre the device's pivot on the outlet's first socket.
        const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
        const [[lx, ly]] = holes.get(sockets[0].contacts.find((c) => c.role === 'L')!.group)!
        const [[px, py]] = SOCKET_PATTERNS[sockets[0].family].L
        const dc = pivot(layoutModule(dm).w, layoutModule(dm).h)
        for (const rotation of [0, 90, 180, 270] as Rotation[]) {
          const d: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: { [om.id]: om, [dm.id]: dm }, connections: [], parts: [
            { uid: 'xs', designator: 'XS1', module: om.id, x: 0, y: 0 },
            { uid: 'xp', designator: 'XP1', module: dm.id, x: lx - px - dc.x, y: ly - py - dc.y, rotation },
          ] }
          const want = specTurns(x.family, sockets[0].family).includes(rotation)
          expect([id, o, rotation, seatOf(d, 'xp', [])?.status === 'seated']).toEqual([id, o, rotation, want])
        }
      }
    })
  }
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/format/mainsParts.test.ts`
Expected: FAIL (the plug-in modules do not exist).

- [ ] **Step 4: Write `scripts/gen-mains-plugs.mjs`**

```js
// Generates the built-in plug-in devices (category Mains): USB wall chargers (5 V) and barrel-jack
// wall adapters for US/Japan, Europe, UK and AU/NZ, and cord plugs, 3-lead and 2-lead, per family.
// Prongs are internal nodes (spec 2) placed on the family pattern of src/format/plugging.ts around
// the body's pivot, so a device dropped on a matching outlet seats; leads are ordinary pins on the
// bottom edge. Ratings, input ranges and isolation come from src/format/mainsEvidence.ts (Task 0);
// a value a source does not state is left out, and isolation not stated is "unknown".
//
// Run from the repo root: `node scripts/gen-mains-plugs.mjs` (add `--check` to compare with modules/).
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { plugProfiles, prongs, rating } from './lib/mains.mjs'

// SRC and DATA: built from the evidence, as in Step 1.

const BODY = '#F5F5F2', DARK = '#2B2F36', USB = '#C9CED6', USB_TONGUE = '#1E4F8A', BARREL = '#2B2F36', LEAD = '#B8BEC7'
const FAMILY = {
  us: { family: 'nema-1-15p', roles: ['L', 'N'], wu: 6, hu: 6, region: 'US/Japan (NEMA 1-15P)' },
  eu: { family: 'cee7-16', roles: ['L', 'N'], wu: 8, hu: 8, region: 'Europe (Europlug)' },
  uk: { family: 'bs1363', roles: ['L', 'N', 'PE'], wu: 6, hu: 6, region: 'UK (BS 1363, fused)' },
  au: { family: 'as3112', roles: ['L', 'N'], wu: 6, hu: 6, region: 'AU/NZ (AS/NZS 3112)' },
}

/** Electrical data shared by chargers and adapters: AC input on the prongs (after the fuse on a UK device). */
function converter(region, outputs, d) {
  const f = FAMILY[region]
  const nodes = [...prongs(f.roles), ...(region === 'uk' ? ['L fused'] : [])]
  const input = region === 'uk' ? 'L fused' : 'L prong'
  return {
    model: 'converter', internalNodes: nodes,
    ...(region === 'uk' ? { protective: [{ from: 'L prong', to: 'L fused', kind: 'fuse', ...(d.fuse ? { rating: d.fuse } : {}) }] } : {}),
    acInput: { a: input, b: 'N prong', range: d.range },
    domains: [{ name: 'mains', pins: nodes.filter((n) => n !== 'PE prong'), kind: 'mains' }, { name: 'output', pins: outputs, kind: 'selv' }],
    isolation: d.isolation, protection: 'class-2',
    plug: { family: f.family, profiles: plugProfiles(f.family, f.wu * 5, f.hu * 5, f.roles) },
  }
}

for (const region of ['us', 'eu', 'uk', 'au']) {
  const f = FAMILY[region]
  const W = f.wu * 10, H = f.hu * 10
  // USB wall charger: a USB-A port on the front face; its VBUS and GND are the 5V and GND pins.
  {
    const id = `charger-usb-5v-${region}`
    const bottom = side('bottom', ['5V', 'GND'], { '5V': { type: 'power_out', supply: '5V' }, GND: { type: 'ground' } }, f.wu)
    write(`${id}.json`, moduleJson({
      id, name: `USB wall charger 5 V, ${f.region}`, category: 'Mains', source: SRC[id], pins: bottom.pins, wu: f.wu, hu: f.hu,
      electrical: converter(region, ['5V', 'GND'], DATA[id]),
      shapes: [r(0, 0, W, H, BODY, { radius: 10 }), r(W / 2 - 14, H - 22, 28, 12, USB, { radius: 2 }), r(W / 2 - 10, H - 19, 20, 4, USB_TONGUE, { outline: false })],
    }))
  }
  // Barrel-jack wall adapter: its output voltage is the part's value, on the + output.
  {
    const id = `adapter-barrel-${region}`
    const bottom = side('bottom', ['+', '-'], { '+': { type: 'power_out' }, '-': { type: 'ground' } }, f.wu)
    const el = converter(region, ['+', '-'], DATA[id])
    write(`${id}.json`, moduleJson({
      id, name: `Wall adapter, barrel jack, ${f.region}`, category: 'Mains', source: SRC[id], pins: bottom.pins, wu: f.wu, hu: f.hu,
      electrical: { ...el, params: { voltage: { unit: 'V', default: DATA[id].volts } } },
      shapes: [r(0, 0, W, H, DARK, { radius: 10 }), r(W / 2 - 3, H - 16, 6, 16, LEAD, { outline: false }), r(W / 2 - 6, H - 8, 12, 8, BARREL, { radius: 2 })],
    }))
  }
}

/** A cord plug: prongs on the pattern, leads L, N (and PE) on the bottom edge, joined inside (the UK L through its fuse). */
function cordPlug({ id, name, family, roles, leads, wu, hu, polarized, fused, volts, amps }) {
  const W = wu * 10, H = hu * 10
  const req = (c) => (c === 'PE' ? 'PE' : polarized ? c : 'line')
  const bottom = side('bottom', leads, Object.fromEntries(leads.map((c) => [c, {}])), wu)
  const pins = bottom.pins.map((p) => ({ ...p, mains: req(p.name) }))
  const internal = leads.filter((c) => !(fused && c === 'L')).map((c) => [`${c} prong`, c])
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source: SRC[id], pins, internal, wu, hu,
    electrical: {
      model: 'cord-plug', internalNodes: prongs(roles),
      ...(fused ? { protective: [{ from: 'L prong', to: 'L', kind: 'fuse' }], params: { fuseRating: { unit: 'A', default: 13 } } } : {}),
      plug: { family, profiles: plugProfiles(family, wu * 5, hu * 5, roles) },
      ratings: [rating([...leads, ...prongs(roles)], 'terminal', 'ac', volts, { amps, provenance: 'datasheet' })],
    },
    shapes: [r(0, 0, W, H, DARK, { radius: 8 }), r(W / 2 - 8, H - 12, 16, 12, DARK, { radius: 3 }), ...leads.map((_, i) => r(bottom.at[i] - 1.5, H - 4, 3, 4, LEAD, { outline: false }))],
  }))
}

// NEMA WD 6: 5-15P 15 A 125 V (blades 12.7 mm apart, earth pin below); 1-15P 15 A 125 V (polarized: wide neutral blade).
cordPlug({ id: 'plug-us-5-15p', name: 'Cord plug US NEMA 5-15P, 3-lead', family: 'nema-5-15p', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 6, hu: 6, polarized: true, volts: 125, amps: 15 })
cordPlug({ id: 'plug-us-1-15p', name: 'Cord plug US NEMA 1-15P polarized, 2-lead', family: 'nema-1-15p-polarized', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: true, volts: 125, amps: 15 })
// JIS C 8303: 1-15P 15 A 125 V, equal blades (unpolarized).
cordPlug({ id: 'plug-jp-1-15p', name: 'Cord plug Japan 1-15P, 2-lead', family: 'nema-1-15p', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: false, volts: 125, amps: 15 })
// CEE 7/7 (16 A 250 V): earth clips for CEE 7/3, earth hole for CEE 7/5; unpolarized. Europlug CEE 7/16 (2.5 A 250 V).
cordPlug({ id: 'plug-eu-cee7-7', name: 'Cord plug Schuko/French CEE 7/7, 3-lead', family: 'cee7-7', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 8, hu: 8, polarized: false, volts: 250, amps: 16 })
cordPlug({ id: 'plug-eu-cee7-16', name: 'Cord plug Europlug CEE 7/16, 2-lead', family: 'cee7-16', roles: ['L', 'N'], leads: ['L', 'N'], wu: 8, hu: 8, polarized: false, volts: 250, amps: 2.5 })
// BS 1363-1 (13 A 250 V) with a BS 1362 fuse in L; the 2-lead plug keeps its earth pin, joined to nothing.
cordPlug({ id: 'plug-uk-bs1363-3lead', name: 'Cord plug UK BS 1363, fused, 3-lead', family: 'bs1363', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 6, hu: 6, polarized: true, fused: true, volts: 250, amps: 13 })
cordPlug({ id: 'plug-uk-bs1363-2lead', name: 'Cord plug UK BS 1363, fused, 2-lead', family: 'bs1363', roles: ['L', 'N', 'PE'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: true, fused: true, volts: 250, amps: 13 })
// AS/NZS 3112 (10 A 250 V).
cordPlug({ id: 'plug-au-as3112-3lead', name: 'Cord plug AU/NZ AS/NZS 3112, 3-lead', family: 'as3112', roles: ['L', 'N', 'PE'], leads: ['L', 'N', 'PE'], wu: 6, hu: 6, polarized: true, volts: 250, amps: 10 })
cordPlug({ id: 'plug-au-as3112-2lead', name: 'Cord plug AU/NZ AS/NZS 3112, 2-lead', family: 'as3112', roles: ['L', 'N'], leads: ['L', 'N'], wu: 6, hu: 6, polarized: true, volts: 250, amps: 10 })

finish('gen-mains-plugs.mjs')
```

Notes: `wu * 5` is the pivot in px for the even sizes used here (60 gives 30, 80 gives 40). The 2-lead UK plug's `PE prong` is a plug contact joined to nothing (declared by the plug, spec 2).

- [ ] **Step 5: Generate, validate, test**

Run: `node scripts/gen-mains-plugs.mjs && npm run validate && npm run check:gen && npx vitest run src/format/mainsParts.test.ts && npm test`
Expected: 17 files written; PASS.

- [ ] **Step 6: Look at them**

Shoot every new id (light and dark, with `--panel`), and also shoot each outlet with a matching device dropped on it (import a small sheet into the editor the way `shoot-parts.mjs` does, or extend it with a `--sheet <file>` option) to see the device sit over the socket with its leg dots on the contacts. Read every image; fix and re-shoot.

- [ ] **Step 7: PRD and commit**

Extend the PRD Mains row with the chargers, adapters (value: Voltage) and cord plugs.

```bash
git add scripts/gen-mains-plugs.mjs modules/charger-usb-5v-*.json modules/adapter-barrel-*.json modules/plug-*.json src/format/mainsParts.test.ts docs/PRD.md
git commit -m "Mains parts: USB chargers, barrel adapters and cord plugs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Independent review (controller, not the implementer)**

Reviewer checks every device against its `source`: family and L side, prong roles, lead requirements (polarized or `line`), UK fuse placement and rating, input range, isolation class and the datasheet line that states it (no class from a test voltage or a symbol), output voltage, the exact part numbers. Verdict per part. A MISMATCH or NOT VERIFIED verdict blocks the next batch until it is fixed, or brought to Michael and decided.

---

### Task 18: Parts batch 3: AC-DC modules, lamp holders, fuse holder, KCD1, Wago

**Files:**
- Create: `scripts/gen-mains-loads.mjs`
- Create (generated): `modules/hlk-pm01.json`, `modules/hlk-pm03.json`, `modules/lamp-holder-e26.json`, `modules/lamp-holder-e27.json`, `modules/fuse-holder-5x20-inline.json`, `modules/wago-221-412.json`, `modules/wago-221-413.json`, `modules/wago-221-415.json`
- Modify: `modules/rocker-switch-kcd1.json` (hand-written today: add `contacts` and `ratings` to `electrical`, keep everything else byte for byte)
- Modify: `src/format/mainsParts.test.ts` (append), `docs/PRD.md`

**Interfaces:**
- Consumes: `rating` (Task 15).
- Produces:
  - `hlk-pm01`, `hlk-pm03` (PS): AC pins `AC 1`, `AC 2` (label `AC`, requirement `line`), outputs `+Vo` (power_out, supply `5V` or `3V3`) and `-Vo` (ground), in the datasheet's physical order; `acInput`, domains, `isolation` (the class the evidence quotes, else `"unknown"`).
  - `lamp-holder-e26`, `lamp-holder-e27` (E): `L` (centre contact, requirement `L`) and `N` (screw shell, requirement `N`), plus `PE` (requirement `PE`) only when the reference product has an earth terminal; `conducts: [{ pins: ['L', 'N'], kind: 'load', range }]`; `protection` as the reference product states it; a `terminal` rating.
  - `fuse-holder-5x20-inline` (F): pins `1`, `2`; `protective: [{ from: '1', to: '2', kind: 'fuse' }]`; `params.fuseRating: { unit: 'A' }` with no default; `settings: { fuse: ['fitted', 'absent'] }`; a `terminal` rating.
  - `rocker-switch-kcd1` (S): `contacts: [{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2' }] }]` and a `switching` rating; its existing `model: 'switch'` and `terminals` stay for the DC checker.
  - `wago-221-41{2,3,5}` (X): openings `1` to `n` on the left edge, all joined by one `internal` group; a `terminal` rating with its `conditions`.

| Part | Source to use | Values to record (field) |
| --- | --- | --- |
| HLK-PM01, HLK-PM03 | Hi-Link HLK-PM01 and HLK-PM03 datasheets (hlktech.net product pages) | pin order and names (`pins`), input range (`acInput.range`), output voltage (`supply`), input-output isolation (`isolation`) |
| E26 lamp holder | Leviton 9880 keyless porcelain lampholder datasheet, and the datasheet of a 120 V E26 lamp for the range | holder rating (`ratings[0].volts`, `amps` or watts in a comment), earth terminal yes or no, lamp rated voltage (`conducts[0].range`) |
| E27 lamp holder | a maker's E27 lampholder datasheet stating its rating and earth terminal (first choice Relco or Kaiser; record which), and a 230 V E27 lamp datasheet | same fields |
| Fuse holder | Schurter FPG4 in-line fuse holder for 5 x 20 mm fuses datasheet | voltage and current rating (`ratings[0]`) |
| KCD1 rocker | the KCD1-101 datasheet already cited in the module's `source` | AC switching rating (`ratings[0].volts`, `amps`), and any second rating (for example 10 A 125 V beside 6 A 250 V) as a second entry |
| Wago 221-412, 221-413, 221-415 | Wago 221 series datasheets (wago.com, per item number) | IEC rated voltage and current, with the overvoltage category and pollution degree as `conditions`; UL values in a comment |

Isolation is only what a source states (Global Constraints; Resolution 21): the Hi-Link modules get `EVIDENCE[id].isolation?.value ?? 'unknown'`, and no test voltage is turned into a class. If that leaves a module `unknown`, the spec's circuit "HLK-PM01 feeding an ESP32 (clean apart from cable-unverified)" cannot hold as written; Task 0 raised it, and Task 20 follows Michael's decision.

- [ ] **Step 1: Take every value from the evidence (no new lookups)**

At the top of `scripts/gen-mains-loads.mjs`:

```js
import { EVIDENCE } from '../src/format/mainsEvidence.ts'
/** Each module's `source`: every URL Task 0 used, standard first. */
const SRC = Object.fromEntries(Object.entries(EVIDENCE).map(([id, e]) => [id, e.sources.join(' ')]))
const hlk = (id) => {
  const e = EVIDENCE[id]
  return { left: e.pins.value.left, right: e.pins.value.right, range: e.acInput.value, isolation: e.isolation?.value ?? 'unknown' }
}
const lamp = (id) => {
  const e = EVIDENCE[id]
  return { earth: !!e.extra?.earth?.value, protection: e.protection?.value, range: e.loadRange.value, lampVolts: e.extra.lampVolts.value, volts: e.ratings[0].volts, amps: e.ratings[0].amps }
}
const rated = (id) => {
  const r = EVIDENCE[id].ratings[0]
  return { volts: r.volts, amps: r.amps, conditions: r.conditions }
}
const DATA = {
  'hlk-pm01': hlk('hlk-pm01'), 'hlk-pm03': hlk('hlk-pm03'),
  'lamp-holder-e26': lamp('lamp-holder-e26'), 'lamp-holder-e27': lamp('lamp-holder-e27'),
  'fuse-holder-5x20-inline': rated('fuse-holder-5x20-inline'),
  'wago-221-412': rated('wago-221-412'), 'wago-221-413': rated('wago-221-413'), 'wago-221-415': rated('wago-221-415'),
}
```

Before generating a part, check its evidence: `verdict: 'VERIFIED'`, or a NOT VERIFIED item Michael has decided on (the evidence log records his decision: generate with a value left unknown, or do not generate). A part he has not cleared is not generated in this task, and its test cases are removed from this batch with a note in the commit message. No value here is looked up again or filled from this plan. For the KCD1, edit `modules/rocker-switch-kcd1.json` by hand: add `contacts` and the `switching` ratings from `EVIDENCE['rocker-switch-kcd1'].ratings` at the end of `electrical`, and set its `source` to the evidence's sources.

- [ ] **Step 2: Write the failing test (append to `src/format/mainsParts.test.ts`)**

```ts
describe('built-in AC-DC modules, lamp holders, fuse holder, switch and lever connectors', () => {
  it('HLK-PM01 and HLK-PM03 are converters with an AC input, a SELV output and an isolation class', () => {
    for (const [id, out] of [['hlk-pm01', '5V'], ['hlk-pm03', '3V3']]) {
      const m = load(id)
      const info = mainsOf(m)
      expect(m.source).toMatch(twoSources)
      expect(info.acInput?.a).toBe('AC 1')
      expect(info.acInput?.b).toBe('AC 2')
      expect(info.domains.find((d) => d.kind === 'selv')?.pins.sort()).toEqual(['+Vo', '-Vo'])
      expect(info.isolation).toBe(EVIDENCE[id].isolation?.value ?? 'unknown')
      expect(info.acInput?.range).toEqual(EVIDENCE[id].acInput!.value)
      expect(m.pins.find((p) => 'name' in p && p.name === '+Vo')).toMatchObject({ type: 'power_out', supply: out })
    }
  })
  it('the lamp holders are loads with the shell on N and a voltage range', () => {
    for (const id of ['lamp-holder-e26', 'lamp-holder-e27']) {
      const info = mainsOf(load(id))
      expect(info.conducts).toEqual([expect.objectContaining({ pins: ['L', 'N'], kind: 'load' })])
      expect(info.conducts[0].range).not.toBeNull()
      expect(info.requirement.get('L')).toBe('L')
      expect(info.requirement.get('N')).toBe('N')
      expect(info.ratings.length).toBeGreaterThan(0)
    }
    expect(mainsOf(load('lamp-holder-e26')).conducts[0].range![1]).toBeLessThan(200)
    expect(mainsOf(load('lamp-holder-e27')).conducts[0].range![0]).toBeGreaterThan(200)
  })
  it('the fuse holder is a protective edge with an unknown rating and a fitted setting', () => {
    const m = load('fuse-holder-5x20-inline')
    expect(mainsOf(m).protective).toEqual([{ from: '1', to: '2', kind: 'fuse', rating: null }])
    expect(m.electrical).toMatchObject({ params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] } })
  })
  it('the KCD1 rocker keeps its DC switch model and gains a contact group and a switching rating', () => {
    const m = load('rocker-switch-kcd1')
    expect(m.electrical).toMatchObject({ model: 'switch', terminals: { a: '1', b: '2' } })
    expect(mainsOf(m).contacts).toEqual([{ id: 's', kind: 'switch', poles: [{ com: '1', no: '2', nc: null }] }])
    expect(mainsOf(m).ratings[0]).toMatchObject({ kind: 'switching', service: 'ac', provenance: 'datasheet' })
  })
  it('each Wago lever connector is one node with a conditional terminal rating', () => {
    for (const [id, n] of [['wago-221-412', 2], ['wago-221-413', 3], ['wago-221-415', 5]] as const) {
      const m = load(id)
      expect(m.internal).toEqual([Array.from({ length: n }, (_, i) => String(i + 1))])
      expect(mainsOf(m).ratings[0]).toMatchObject({ kind: 'terminal', service: 'ac', provenance: 'datasheet' })
      expect(mainsOf(m).ratings[0].conditions).toBeTruthy()
    }
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/format/mainsParts.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `scripts/gen-mains-loads.mjs`**

```js
// Generates the built-in mains loads and wiring parts (category Mains): the Hi-Link HLK-PM01 (5 V)
// and HLK-PM03 (3.3 V) AC-DC modules, E26 (120 V) and E27 (230 V) lamp holders, an in-line 5 x 20 mm
// fuse holder and the Wago 221-412, 221-413 and 221-415 lever connectors. Every pin order, range,
// rating and isolation class comes from src/format/mainsEvidence.ts (Task 0), where each value
// carries the datasheet line it comes from; isolation not stated there is "unknown".
//
// Run from the repo root: `node scripts/gen-mains-loads.mjs` (add `--check` to compare with modules/).
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { rating } from './lib/mains.mjs'

// SRC and DATA: built from the evidence, as in Step 1.

const HLK_BLACK = '#1B1F24', LABEL = '#F5F5F2', PORCELAIN = '#F1ECE2', BRASS = '#D9A93B', CLEAR = '#DDE7EE', WAGO = '#F2F2EF', ORANGE = '#F48C06'

// Hi-Link AC-DC modules: AC pins on one end, DC pins on the other, in DATA[id].left / DATA[id].right (datasheet order).
for (const [id, volts, supply] of [['hlk-pm01', '5 V', '5V'], ['hlk-pm03', '3.3 V', '3V3']]) {
  const d = DATA[id]
  const types = { 'AC 1': {}, 'AC 2': {}, '+Vo': { type: 'power_out', supply }, '-Vo': { type: 'ground' } }
  const left = side('left', d.left, types, 5)
  const right = side('right', d.right, types, 5)
  const pins = [...left.pins, ...right.pins].map((p) => (p.name.startsWith('AC') ? { ...p, label: 'AC', mains: 'line' } : p))
  write(`${id}.json`, moduleJson({
    id, name: `Hi-Link ${id.toUpperCase()} AC-DC module (${volts})`, category: 'Mains', source: SRC[id], pins, wu: 8, hu: 5, inside: true,
    electrical: {
      model: 'converter', acInput: { a: 'AC 1', b: 'AC 2', range: d.range },
      domains: [{ name: 'mains', pins: ['AC 1', 'AC 2'], kind: 'mains' }, { name: 'output', pins: ['+Vo', '-Vo'], kind: 'selv' }],
      isolation: d.isolation,
    },
    shapes: [r(0, 0, 80, 50, HLK_BLACK, { radius: 3 }), r(14, 14, 52, 22, HLK_BLACK, { outline: false, label: id.toUpperCase(), labelColor: LABEL, labelSize: 7 })],
  }))
}

// Lamp holders: centre contact is L, the screw shell is N (the shell must never be on L); PE only when the reference has an earth terminal.
for (const [id, base, d] of [['lamp-holder-e26', 'E26', DATA['lamp-holder-e26']], ['lamp-holder-e27', 'E27', DATA['lamp-holder-e27']]]) {
  const leads = ['L', 'N', ...(d.earth ? ['PE'] : [])]
  const left = side('left', ['L'], {}, 6)
  const right = side('right', ['N'], {}, 6)
  const bottom = d.earth ? side('bottom', ['PE'], {}, 6).pins : []
  const pins = [...left.pins, ...right.pins, ...bottom].map((p) => ({ ...p, mains: p.name }))
  write(`${id}.json`, moduleJson({
    id, name: `Lamp holder ${base} (${d.lampVolts} V lamp)`, category: 'Mains', source: SRC[id], pins, wu: 6, hu: 6,
    electrical: {
      model: 'lamp', conducts: [{ pins: ['L', 'N'], kind: 'load', range: d.range }],
      ...(d.protection ? { protection: d.protection } : {}),
      ratings: [rating(leads, 'terminal', 'ac', d.volts, { ...(d.amps ? { amps: d.amps } : {}), provenance: 'datasheet' })],
    },
    shapes: [r(6, 10, 48, 40, PORCELAIN, { radius: 8 }), r(18, 4, 24, 20, BRASS, { radius: 6 }), r(26, 24, 8, 8, BRASS, { radius: 4 })],
  }))
}

// In-line 5 x 20 mm fuse holder: the fuse is a protective edge between its two leads; the rating is set on the sheet.
{
  const id = 'fuse-holder-5x20-inline'
  const d = DATA[id]
  write(`${id}.json`, moduleJson({
    id, name: 'Fuse holder, in-line, 5 x 20 mm', category: 'Mains', source: SRC[id],
    pins: [{ name: '1', side: 'left', type: 'passive' }, { name: '2', side: 'right', type: 'passive' }], wu: 8, hu: 4,
    electrical: {
      model: 'fuse', protective: [{ from: '1', to: '2', kind: 'fuse' }], params: { fuseRating: { unit: 'A' } }, settings: { fuse: ['fitted', 'absent'] },
      ratings: [rating(['1', '2'], 'terminal', 'ac', d.volts, { amps: d.amps, provenance: 'datasheet' })],
    },
    shapes: [r(8, 10, 64, 20, HLK_BLACK, { radius: 10 }), r(24, 13, 32, 14, CLEAR, { radius: 3 })],
  }))
}

// Wago 221 lever connectors: every opening is one node.
for (const [id, n] of [['wago-221-412', 2], ['wago-221-413', 3], ['wago-221-415', 5]]) {
  const d = DATA[id]
  const names = Array.from({ length: n }, (_, i) => String(i + 1))
  const left = side('left', names, {}, n + 2)
  write(`${id}.json`, moduleJson({
    id, name: `Wago ${id.slice(5)} lever connector (${n} conductors)`, category: 'Mains', source: SRC[id], pins: left.pins, internal: [names], wu: 4, hu: n + 2,
    electrical: { model: 'connector', ratings: [rating(names, 'terminal', 'ac', d.volts, { amps: d.amps, provenance: 'datasheet', conditions: d.conditions })] },
    shapes: [r(0, 0, 40, (n + 2) * 10, CLEAR, { radius: 3 }), ...left.at.map((y) => r(22, y - 4, 14, 8, ORANGE, { radius: 2 }))],
  }))
}

finish('gen-mains-loads.mjs')
```

`DATA` fields per id: Hi-Link `{ left, right, range, isolation }`; lamp holders `{ earth, protection?, range, lampVolts, volts, amps? }`; fuse holder `{ volts, amps }`; Wago `{ volts, amps, conditions }`. Adjust `wu`, `hu` and the art to the real proportions once the datasheet is open; keep lamp holder and fuse holder art heights an even number of grid units (the two-lead geometry test enforces it).

- [ ] **Step 5: Generate, validate, test**

Run: `node scripts/gen-mains-loads.mjs && npm run validate && npm run check:gen && npx vitest run src/format/mainsParts.test.ts src/format/parts.test.ts && npm test`
Expected: PASS (including the existing two-lead geometry test and the KCD1's existing tests).

- [ ] **Step 6: Look at them**

Run: `npm run build` then `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs hlk-pm01 hlk-pm03 lamp-holder-e26 lamp-holder-e27 fuse-holder-5x20-inline rocker-switch-kcd1 wago-221-412 wago-221-413 wago-221-415 --panel` and again with `--dark` (images land in the system temp folder under `circuitoon-shots`; pass `--out <dir>` to choose another), and Read every image. Check: pins meet their stubs, labels readable (AC on the Hi-Link modules), the lamp holders read as porcelain holders with a brass shell, the Wago openings line up with their pins, the Mains group in the Parts panel reads well. Redraw and re-shoot anything that does not.

- [ ] **Step 7: PRD and commit**

Extend the PRD Mains row (values: Fuse rating on the fuse holder), move KCD1's note to "also a mains switch".

```bash
git add scripts/gen-mains-loads.mjs modules/hlk-pm0*.json modules/lamp-holder-*.json modules/fuse-holder-5x20-inline.json modules/wago-221-*.json modules/rocker-switch-kcd1.json src/format/mainsParts.test.ts docs/PRD.md
git commit -m "Mains parts: HLK AC-DC modules, lamp holders, fuse holder, KCD1 ratings, Wago" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Independent review (controller, not the implementer)**

Reviewer checks pin order and names of both Hi-Link modules, their input ranges and the isolation class against the datasheet line that states it (none inferred), both lamp holders (shell on N, earth terminal, class, range), the fuse holder rating, the KCD1 switching rating, and each Wago rating with its conditions. Verdict per part. A MISMATCH or NOT VERIFIED verdict blocks the next batch until it is fixed, or brought to Michael and decided.

---

### Task 19: Parts batch 4: terminal blocks

**Files:**
- Create: `scripts/gen-mains-terminals.mjs`
- Create (generated): `modules/terminal-block-mstb-508-{2..6}.json`, `modules/terminal-block-mc-381-{2..6}.json`, `modules/terminal-block-kf2edg-508-{2,3}.json`, `modules/terminal-block-kf301-500-{2,3}.json`
- Modify: `src/format/mainsParts.test.ts` (append), `docs/PRD.md`

**Interfaces:**
- Consumes: `rating` (Task 15).
- Produces (category Mains, designator X): a pluggable terminal block per position count, each position `n` a screw (wire) terminal on the left and its PCB header pin `n pcb` (label `n`) on the right, joined by `internal` (the header side to plug side zero edge, spec 1.2). Phoenix parts carry `datasheet` ratings, each with the `conditions` Phoenix ties it to; the clones carry `unverified` ratings.

Expected Phoenix item numbers (verify every one on phoenixcontact.com; the datasheet wins; record plug and header numbers in the module name and `source`):

| Positions | MSTB 2,5/ n-ST-5,08 (plug) | MSTBA 2,5/ n-G-5,08 (header) | MC 1,5/ n-ST-3,81 (plug) | MC 1,5/ n-G-3,81 (header) |
| --- | --- | --- | --- | --- |
| 2 | 1757019 | 1757242 | 1803578 | 1803277 |
| 3 | 1757022 | 1757255 | 1803581 | 1803280 |
| 4 | 1757035 | 1757268 | 1803594 | 1803293 |
| 5 | 1757048 | 1757271 | 1803604 | 1803303 |
| 6 | 1757051 | 1757284 | 1803617 | 1803316 |

- [ ] **Step 1: Take every value from the evidence (no new lookups)**

At the top of `scripts/gen-mains-terminals.mjs`:

```js
import { EVIDENCE } from '../src/format/mainsEvidence.ts'
const PHOENIX = { mstb: {}, mc: {} }
for (const [series, pitch] of [['mstb', '508'], ['mc', '381']])
  for (let n = 2; n <= 6; n++) {
    const e = EVIDENCE[`terminal-block-${series}-${pitch}-${n}`]
    PHOENIX[series][n] = { plug: e.extra.plug.value, header: e.extra.header.value, url: e.sources.join(' '), ratings: e.ratings.map((r) => ({ volts: r.volts, amps: r.amps, conditions: r.conditions })) }
  }
const CLONE = Object.fromEntries(['terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3'].map((id) => {
  const e = EVIDENCE[id]
  return [id, { url: e.sources.join(' '), volts: e.ratings[0].volts, amps: e.ratings[0].amps }]
}))
```

Before generating a part, check its evidence: `verdict: 'VERIFIED'`, or a NOT VERIFIED item Michael has decided on (the evidence log records his decision: generate with a value left unknown, or do not generate). A part he has not cleared is not generated in this task, and its test cases are removed from this batch with a note in the commit message. No value here is looked up again or filled from this plan.

- [ ] **Step 2: Write the failing test (append)**

```ts
describe('built-in terminal blocks', () => {
  // The Phoenix item numbers Task 0 confirmed (plug, header), pinned here so a slip in the evidence or
  // the generator fails; if Task 0 corrected a number, this table carries the corrected one.
  const ITEMS: Record<string, Record<number, [string, string]>> = {
    mstb: { 2: ['1757019', '1757242'], 3: ['1757022', '1757255'], 4: ['1757035', '1757268'], 5: ['1757048', '1757271'], 6: ['1757051', '1757284'] },
    mc: { 2: ['1803578', '1803277'], 3: ['1803581', '1803280'], 4: ['1803594', '1803293'], 5: ['1803604', '1803303'], 6: ['1803617', '1803316'] },
  }
  for (const [series, pitch] of [['mstb', '508'], ['mc', '381']])
    for (let n = 2; n <= 6; n++)
      it(`terminal-block-${series}-${pitch}-${n}: its item numbers, n positions joined to their header pins, every Phoenix rating with its conditions`, () => {
        const id = `terminal-block-${series}-${pitch}-${n}`
        const m = load(id)
        const [plug, header] = ITEMS[series][n]
        expect(m.name).toContain(`plug ${plug}, header ${header}`)
        expect([EVIDENCE[id].extra?.plug?.value, EVIDENCE[id].extra?.header?.value]).toEqual([plug, header])
        const pos = Array.from({ length: n }, (_, i) => String(i + 1))
        expect(m.internal).toEqual(pos.map((p) => [p, `${p} pcb`]))
        const ratings = mainsOf(m).ratings
        expect(ratings.map((r) => [r.volts, r.amps, r.conditions])).toEqual(EVIDENCE[id].ratings!.map((r) => [r.volts, r.amps ?? null, r.conditions ?? null]))
        expect(ratings.length).toBeGreaterThan(0)
        for (const r of ratings) expect(r).toMatchObject({ kind: 'terminal', service: 'ac', provenance: 'datasheet' })
        expect(ratings.every((r) => r.conditions)).toBe(true)
      })
  for (const id of ['terminal-block-kf2edg-508-2', 'terminal-block-kf2edg-508-3', 'terminal-block-kf301-500-2', 'terminal-block-kf301-500-3'])
    it(`${id}: a clone with a rating, and that rating unverified`, () => {
      const ratings = mainsOf(load(id)).ratings
      expect(ratings.length).toBeGreaterThan(0)
      expect(ratings.every((r) => r.provenance === 'unverified')).toBe(true)
      expect(ratings[0].volts).toBe(EVIDENCE[id].ratings![0].volts)
    })
})
```

- [ ] **Step 3: Run it to verify it fails** (`npx vitest run src/format/mainsParts.test.ts`: FAIL).

- [ ] **Step 4: Write `scripts/gen-mains-terminals.mjs`**

```js
// Generates the built-in terminal blocks (category Mains): Phoenix Contact MSTB 2,5 (5.08 mm) and
// MC 1,5 (3.81 mm) pluggable blocks, 2 to 6 positions, each drawn as the plug with its header; and
// the common KF2EDG (5.08 mm) and KF301 (5.0 mm) clones, whose ratings are unverified. Every Phoenix
// item number and rating comes from src/format/mainsEvidence.ts (Task 0), each rating with the conditions
// Phoenix states for it.
//
// Run from the repo root: `node scripts/gen-mains-terminals.mjs` (add `--check` to compare with modules/).
import { finish } from './lib/gen-output.mjs'
import { moduleJson, r, side, write } from './lib/parts.mjs'
import { rating } from './lib/mains.mjs'

// PHOENIX and CLONE: built from the evidence, as in Step 1.

const GREEN = '#2F9E6E', GREEN_DARK = '#1F7A55', BLUE = '#2F7FD0', METAL = '#C9CED6', SLOT = '#2B2F36'

function block({ id, name, source, n, ratings, color }) {
  const pos = Array.from({ length: n }, (_, i) => String(i + 1))
  const hu = n * 2 + 1
  const left = side('left', pos.flatMap((p, i) => (i ? [null, p] : [p])), {}, hu)
  const right = side('right', pos.flatMap((p, i) => (i ? [null, `${p} pcb|${p}`] : [`${p} pcb|${p}`])), {}, hu)
  write(`${id}.json`, moduleJson({
    id, name, category: 'Mains', source, pins: [...left.pins, ...right.pins], internal: pos.map((p) => [p, `${p} pcb`]), wu: 6, hu, inside: true,
    electrical: { model: 'terminal-block', ratings: ratings.map((x) => rating([...pos, ...pos.map((p) => `${p} pcb`)], 'terminal', 'ac', x.volts, { ...(x.amps ? { amps: x.amps } : {}), provenance: x.provenance, ...(x.conditions ? { conditions: x.conditions } : {}) })) },
    shapes: [
      r(0, 0, 36, hu * 10, color, { radius: 3 }), r(36, 0, 24, hu * 10, GREEN_DARK, { radius: 3 }),
      ...left.at.flatMap((y) => [r(10, y - 6, 12, 12, METAL, { radius: 6 }), r(15, y - 4, 2, 8, SLOT, { outline: false })]),
    ],
  }))
}

for (const [series, pitch, label] of [['mstb', '508', 'MSTB 2,5 (5.08 mm)'], ['mc', '381', 'MC 1,5 (3.81 mm)']])
  for (let n = 2; n <= 6; n++) {
    const p = PHOENIX[series][n]
    block({
      id: `terminal-block-${series}-${pitch}-${n}`, name: `Terminal block Phoenix Contact ${label}, ${n} positions (plug ${p.plug}, header ${p.header})`,
      source: p.url, n, color: GREEN, ratings: p.ratings.map((x) => ({ ...x, provenance: 'datasheet' })),
    })
  }

for (const [id, name, n] of [
  ['terminal-block-kf2edg-508-2', 'Terminal block KF2EDG 5.08 mm clone, 2 positions', 2], ['terminal-block-kf2edg-508-3', 'Terminal block KF2EDG 5.08 mm clone, 3 positions', 3],
  ['terminal-block-kf301-500-2', 'Terminal block KF301 5.0 mm clone, 2 positions', 2], ['terminal-block-kf301-500-3', 'Terminal block KF301 5.0 mm clone, 3 positions', 3],
])
  block({ id, name, source: CLONE[id].url, n, color: BLUE, ratings: [{ volts: CLONE[id].volts, amps: CLONE[id].amps, provenance: 'unverified' }] })

finish('gen-mains-terminals.mjs')
```

(A KF301 is a fixed PCB terminal, not pluggable; its `n pcb` pins are its PCB legs, which is the same zero join.)

- [ ] **Step 5: Generate, validate, test** (`node scripts/gen-mains-terminals.mjs && npm run validate && npm run check:gen && npx tsc --noEmit && npm test`: PASS).

- [ ] **Step 6: Look at them**

Run: `npm run build` then `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs terminal-block-mstb-508-2 terminal-block-mstb-508-6 terminal-block-mc-381-2 terminal-block-mc-381-6 terminal-block-kf2edg-508-2 terminal-block-kf301-500-3 --fill 0.8 --panel` and again with `--dark` (images land in the system temp folder under `circuitoon-shots`; pass `--out <dir>` to choose another), and Read every image. Check: each screw lines up with its pin on both sides, the labels inside the body are readable, the Parts panel group stays tidy with 14 blocks (propose a sub-grouping if it does not). Redraw and re-shoot anything that does not.

Add the terminal blocks to the `pinLabels: "inside"` allowed list in `src/format/module.test.ts` if that test lists them.

- [ ] **Step 7: PRD and commit**

```bash
git add scripts/gen-mains-terminals.mjs modules/terminal-block-*.json src/format/mainsParts.test.ts src/format/module.test.ts docs/PRD.md
git commit -m "Mains parts: Phoenix and clone terminal blocks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Independent review (controller, not the implementer)**

Reviewer checks every Phoenix item number (plug and header) against phoenixcontact.com, each rating and its conditions, and the clones' `unverified` provenance. Verdict per part. A MISMATCH or NOT VERIFIED verdict blocks the next batch until it is fixed, or brought to Michael and decided.

---

### Task 20: Parts batch 5: relay module contacts, the Fotek SSR, and the spec's circuits

**Files:**
- Modify: `scripts/gen-outputs.mjs:56-95` (relay module electrical), append the Fotek SSR
- Modify (generated): `modules/relay-module-1ch-5v.json`; create `modules/ssr-fotek-25da.json`
- Modify: `src/format/outputs.test.ts` (the SSR's pin order), `src/format/mainsParts.test.ts` (append)
- Create: `src/format/mainsCircuits.test.ts`
- Modify: `docs/PRD.md`

**Interfaces:**
- Consumes: every part of Tasks 16 to 19; `checkDiagram`.
- Produces:
  - `relay-module-1ch-5v`: pins unchanged; `electrical` gains `contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }]`, `domains: [{ name: 'contacts', pins: ['NO', 'COM', 'NC'], kind: 'mains' }, { name: 'control', pins: ['IN', 'DC-', 'DC+'], kind: 'selv' }]`, `isolation` from the Songle SRD datasheet with `isolationProvenance: 'unverified'`, and the Songle contact ratings as `switching` ratings with `provenance: 'unverified'` (spec 1.4: the relay's switching rating, not the module's insulation).
  - `ssr-fotek-25da` (K, category Mains): load terminals `1`, `2` (the contact pole, an OFF state that leaks), control terminals `3` (+, `input`) and `4` (-, `ground`) in the physical order on the case; `contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2' }] }]`; domains; isolation; a `switching` rating whose `conditions` state the heatsink and derating; the control range and off-state leakage in the name and a comment.

| Part | Source | Values to record (field) |
| --- | --- | --- |
| Relay module | Songle SRD-05VDC-SL-C datasheet (songlerelay.com), plus the module listings already in `source` | contact ratings AC and DC (`ratings`, `unverified`), coil-to-contact insulation class only if the datasheet states it (`isolation`, else `"unknown"`; a dielectric test voltage goes in a comment, never into the class) |
| Fotek SSR-25DA | the current Fotek SSR series datasheet (fotek.com.tw); record its revision and date | control input range (name: "4-32 VDC" per the spec if the current revision says so), load voltage range and current (`ratings`), derating and heatsink note (`conditions`), off-state leakage (comment), the stated insulation class between input and output (`isolation`, else `"unknown"`; the dielectric strength goes in a comment), terminal numbering on the case (`pins`) |

- [ ] **Step 1: Take every value from the evidence (no new lookups)**

In `scripts/gen-outputs.mjs`, near the top:

```js
import { EVIDENCE } from '../src/format/mainsEvidence.ts'
const relayEv = EVIDENCE['relay-module-1ch-5v']
const ssrEv = EVIDENCE['ssr-fotek-25da']
/** The Songle relay's contact ratings and its stated coil-to-contact class; "unknown" when the datasheet states none. */
const SONGLE = { isolation: relayEv.isolation?.value ?? 'unknown', ratings: relayEv.ratings.map((r) => ({ service: r.service, volts: r.volts, amps: r.amps })) }
const FOTEK = {
  url: ssrEv.sources.join(' '), top: ssrEv.pins.value.top, bottom: ssrEv.pins.value.bottom,
  control: ssrEv.extra.control.value, load: ssrEv.extra.load.value, leakage: ssrEv.extra.leakage.value,
  amps: ssrEv.ratings[0].amps, maxVolts: ssrEv.ratings[0].volts, conditions: ssrEv.ratings[0].conditions, isolation: ssrEv.isolation?.value ?? 'unknown',
}
```

Before generating a part, check its evidence: `verdict: 'VERIFIED'`, or a NOT VERIFIED item Michael has decided on (the evidence log records his decision: generate with a value left unknown, or do not generate). A part he has not cleared is not generated in this task, and its test cases are removed from this batch with a note in the commit message. No value here is looked up again or filled from this plan. The relay module keeps `isolationProvenance: 'unverified'` (Resolution 26: a clone board carrying its relay's stated class).

- [ ] **Step 2: Write the failing tests**

Append to `src/format/mainsParts.test.ts`:

```ts
describe('relay module and SSR', () => {
  it('the relay module switches COM between NC and NO, its rating and isolation unverified', () => {
    const info = mainsOf(load('relay-module-1ch-5v'))
    expect(info.contacts).toEqual([{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }])
    expect(info.domains.map((d) => [d.kind, [...d.pins].sort()])).toEqual([['mains', ['COM', 'NC', 'NO']], ['selv', ['DC+', 'DC-', 'IN']]])
    expect(info.isolationProvenance).toBe('unverified')
    expect(info.ratings.every((r) => r.kind === 'switching' && r.provenance === 'unverified')).toBe(true)
  })
  it('the Fotek SSR-25DA leaks when off and carries its derating as a condition', () => {
    const m = load('ssr-fotek-25da')
    const info = mainsOf(m)
    expect(m.category).toBe('Mains')
    expect(m.source).toMatch(twoSources)
    expect(info.contacts).toEqual([{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2', nc: null }] }])
    expect(info.ratings[0]).toMatchObject({ kind: 'switching', service: 'ac', provenance: 'datasheet' })
    expect(info.ratings[0].conditions).toMatch(/heatsink|derat/i)
  })
})
```

Create `src/format/mainsCircuits.test.ts`:

```ts
// The spec's circuits (section 7) on the built-in parts: what a correct mains hookup must not be
// nagged about beyond what Circuitoon cannot know, and the plug that does not fit.
import { describe, expect, it } from 'vitest'
import { checkDiagram } from './checks.ts'
import type { Connection, Diagram, PartInstance } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { layoutModule } from './module.ts'
import { pivot } from './geometry.ts'
import { mainsOf } from './mainsModel.ts'
import { SOCKET_PATTERNS } from './plugging.ts'
import { load } from './builtinModules.testing.ts'

let n = 0
const stripped = (a: string, b: string): Connection => {
  const end = (s: string) => { const [part, pin] = s.split('|'); return { part, pin } }
  return { uid: `w${++n}`, from: end(a), to: end(b), gauge: 18, ends: { from: 'stripped', to: 'stripped' } }
}
const dc = (a: string, b: string): Connection => ({ ...stripped(a, b), gauge: 22, ends: undefined })
function sheet(parts: PartInstance[], connections: Connection[]): Diagram {
  const modules: Record<string, ModuleDef> = {}
  for (const p of parts) modules[p.module] = load(p.module)
  return { format: 'circuitoon-diagram/1', title: 't', modules, parts, connections }
}
const at = (uid: string, designator: string, module: string, x = 0, y = 0, extra: Partial<PartInstance> = {}): PartInstance =>
  ({ uid, designator, module, x, y, rotation: 0, ...extra })
/** A plug-in device placed so its pivot sits on the centre of the outlet's first socket. */
function onOutlet(uid: string, designator: string, module: string, outlet: PartInstance, mount = true): PartInstance {
  const om = load(outlet.module)
  const s = mainsOf(om).sockets[0]
  const holes = new Map((om.holes ?? []).map((h) => [h.name, h.at]))
  const [[lx, ly]] = holes.get(s.contacts.find((c) => c.role === 'L')!.group)!
  const [[px, py]] = SOCKET_PATTERNS[s.family].L
  const c = pivot(layoutModule(load(module)).w, layoutModule(load(module)).h)
  return at(uid, designator, module, outlet.x + lx - px - c.x, outlet.y + ly - py - c.y, mount ? { mount: { board: outlet.uid } } : {})
}
const rules = (d: Diagram) => [...new Set(checkDiagram(d).map((f) => f.rule))].sort()

describe('the spec circuits on built-in parts', () => {
  it('relay switching a fused lamp from a US outlet with stripped 18 AWG wires (only the relay module\'s unverified-rating and cable-unverified warnings)', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const e26 = load('lamp-holder-e26')
    const earthed = mainsOf(e26).requirement.get('PE') === 'PE'
    const d = sheet([
      xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs),
      at('f1', 'F1', 'fuse-holder-5x20-inline', 300, 0, { values: { fuseRating: { value: 2, unit: 'A' } } }),
      at('k1', 'K1', 'relay-module-1ch-5v', 500), at('e1', 'E1', 'lamp-holder-e26', 800), at('u1', 'U1', 'esp32-devkit-v1-30', 500, 300),
    ], [
      stripped('xp1|L', 'f1|1'), stripped('f1|2', 'k1|COM'), stripped('k1|NO', 'e1|L'), stripped('e1|N', 'xp1|N'),
      ...(earthed ? [stripped('xp1|PE', 'e1|PE')] : []),
      dc('k1|DC+', 'u1|VIN'), dc('k1|DC-', 'u1|GND'), dc('k1|IN', 'u1|D23'),
    ])
    expect(rules(d)).toEqual(['cable-unverified', 'rating-unverified'])
    expect(checkDiagram(d).filter((f) => f.rule === 'rating-unverified').every((f) => f.subject === 'K1')).toBe(true)
  })
  it('HLK-PM01 feeding an ESP32 (clean apart from cable-unverified)', () => {
    const xs = at('xs1', 'XS1', 'outlet-us-5-15r-duplex')
    const d = sheet([xs, onOutlet('xp1', 'XP1', 'plug-us-5-15p', xs), at('ps1', 'PS1', 'hlk-pm01', 300), at('u1', 'U1', 'esp32-cam', 600)], [
      stripped('xp1|L', 'ps1|AC 1'), stripped('xp1|N', 'ps1|AC 2'), dc('ps1|+Vo', 'u1|5V'), dc('ps1|-Vo', 'u1|GND'),
    ])
    expect(rules(d)).toEqual(['cable-unverified'])
  })
  it('HLK-PM01 unpowered', () => {
    const d = sheet([at('ps1', 'PS1', 'hlk-pm01'), at('u1', 'U1', 'esp32-cam', 300)], [dc('ps1|+Vo', 'u1|5V'), dc('ps1|-Vo', 'u1|GND')])
    const found = checkDiagram(d).filter((f) => f.rule === 'no-power').map((f) => f.message)
    expect(found[0]).toBe('PS1 has no mains input, so its outputs supply nothing. Wire AC 1 and AC 2 to L and N of one outlet.')
    expect(found.some((m) => m.startsWith('U1 has no power'))).toBe(true)
  })
  it('US charger over a UK outlet (does not seat; plug-mismatch)', () => {
    const xs = at('xs1', 'XS1', 'outlet-uk-bs1363')
    const d = sheet([xs, at('ps1', 'PS1', 'charger-usb-5v-us', 10, 10)], [])
    expect(checkDiagram(d).filter((f) => f.rule === 'plug-mismatch').map((f) => f.message)).toEqual([
      "PS1's US/Japanese plug does not fit XS1's UK socket. Use a device with a UK plug.",
    ])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/format/mainsParts.test.ts src/format/mainsCircuits.test.ts`
Expected: FAIL (no SSR module, relay module without contacts).

- [ ] **Step 4: Implement in `scripts/gen-outputs.mjs`**

In the relay block replace `electrical: { model: 'relay', params: {} }` with:

```js
    electrical: {
      model: 'relay', params: {},
      // The contacts are the Songle relay's; the board around them is a clone with no rating of its own (spec 1.4).
      contacts: [{ id: 'k', kind: 'relay', poles: [{ com: 'COM', no: 'NO', nc: 'NC' }] }],
      domains: [{ name: 'contacts', pins: ['NO', 'COM', 'NC'], kind: 'mains' }, { name: 'control', pins: ['IN', 'DC-', 'DC+'], kind: 'selv' }],
      isolation: SONGLE.isolation, isolationProvenance: 'unverified',
      ratings: SONGLE.ratings.map((x) => ({ pins: ['NO', 'COM', 'NC'], kind: 'switching', service: x.service, volts: x.volts, amps: x.amps, provenance: 'unverified' })),
    },
```

and append the SSR block (before `finish`):

```js
// ---------------------------------------------------------------------------------------------
// Fotek SSR-25DA solid state relay (FOTEK, current revision). Load terminals 1 and 2 switch AC; the
// control input is 3 (+) and 4 (-). Off, the output still leaks a little current (FOTEK.leakage), so
// its OFF state is a leakage path, never an open contact (spec 1.5). Terminal positions follow the
// case face in the datasheet drawing.
{
  const wu = 9, hu = 12, W = wu * 10, H = hu * 10
  const types = { 1: { type: 'passive' }, 2: { type: 'passive' }, 3: { type: 'input' }, 4: { type: 'ground' } }
  const top = side('top', FOTEK.top, types, wu)
  const bottom = side('bottom', FOTEK.bottom, types, wu)
  write('ssr-fotek-25da.json', moduleJson({
    inside: true, id: 'ssr-fotek-25da', category: 'Mains',
    name: `Fotek SSR-25DA solid state relay (${FOTEK.control} in, ${FOTEK.load} ${FOTEK.amps} A out)`, source: FOTEK.url,
    pins: [...top.pins, ...bottom.pins], wu, hu,
    electrical: {
      model: 'ssr', contacts: [{ id: 'k', kind: 'ssr', poles: [{ com: '1', no: '2' }] }],
      domains: [{ name: 'load', pins: ['1', '2'], kind: 'mains' }, { name: 'control', pins: ['3', '4'], kind: 'selv' }],
      isolation: FOTEK.isolation,
      ratings: [{ pins: ['1', '2'], kind: 'switching', service: 'ac', volts: FOTEK.maxVolts, amps: FOTEK.amps, provenance: 'datasheet', conditions: FOTEK.conditions }],
    },
    shapes: [
      r(0, 0, W, H, '#2B2F36', { radius: 4 }), r(8, 30, W - 16, 60, '#F4F6F8', { radius: 2, label: 'SSR-25DA', labelColor: '#2B2F36', labelSize: 8 }),
      r(W / 2 - 4, 92, 8, 5, LED_RED, { radius: 2, outline: false }),
    ],
  }))
}
```

`FOTEK` fields: `url` (two or more URLs), `top`, `bottom` (terminal order on the case), `control`, `load`, `amps`, `maxVolts`, `isolation`, `conditions`, `leakage`. Add the SSR's pin order to `src/format/outputs.test.ts`'s `parts` table (`category: 'Mains'`, `inside: true`, `internal: []`, its `sides`).

- [ ] **Step 5: Generate, validate, test**

Run: `node scripts/gen-outputs.mjs && npm run validate && npm run check:gen && npx tsc --noEmit && npm test`
Expected: PASS, including `checks.circuits.test.ts` (the relay module on a DC-only sheet: no mains findings) and the new circuits. The relay and HLK circuit expectations below are the spec's; they hold only if the evidence states adequate classes (Resolution 21). If Michael decided otherwise at Task 0, this task uses the expected results he approved, recorded in the evidence log; never change an expected result on your own.

- [ ] **Step 6: Look at them**

Run: `npm run build` then `node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs ssr-fotek-25da relay-module-1ch-5v --panel` and again with `--dark` (images land in the system temp folder under `circuitoon-shots`; pass `--out <dir>` to choose another), and Read every image. Check: the SSR's terminal numbers match the case drawing in the datasheet, the relay module looks exactly as before. Redraw and re-shoot anything that does not.

- [ ] **Step 7: PRD and commit**

```bash
git add scripts/gen-outputs.mjs modules/relay-module-1ch-5v.json modules/ssr-fotek-25da.json src/format/outputs.test.ts src/format/mainsParts.test.ts src/format/mainsCircuits.test.ts docs/PRD.md
git commit -m "Mains parts: relay module contacts, Fotek SSR-25DA, the spec circuits" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Independent review (controller, not the implementer)**

Reviewer checks the Songle contact ratings and isolation line, the relay module's unchanged pins, the Fotek revision, terminal numbering, control range, load rating, derating condition, leakage and isolation. Verdict per part. A MISMATCH or NOT VERIFIED verdict blocks the next batch until it is fixed, or brought to Michael and decided.

---
### Task 21: The look: identity colours, hazard outline, lightning markers, new-wire colour

**Files:**
- Modify: `src/format/diagram.ts:64-84` and `:694-696` (green-yellow two-colour wire, `wireStripe`, `isValidColor`)
- Create: `src/format/mainsLook.ts`
- Create: `src/render/Mains.tsx`
- Modify: `src/render/Sheet.tsx`, `src/editor/Canvas.tsx` (wires layer; new wire colour at `onPointerUp`), `src/editor/Inspector.tsx:434-450` (swatches), `src/editor/editor.css`
- Test: `src/format/mainsLook.test.ts`

**Interfaces:**
- Consumes: `analyseMainsCached` (`MainsAnalysis.conductorOf`, `hazardKeys`) (Task 5): the same cached analysis the checker reads, so drawing an edit never enumerates again; `Region`, `Conductor` (Task 2).
- Produces:
  - In `diagram.ts`: `STRIPED_COLORS: Record<string, [string, string]>` (`'green-yellow': ['#2F9E6E', '#F4B400']`), `wireStripe(c: string | undefined): string | null`; `wireColor` and `isValidColor` accept `green-yellow`.
  - In `mainsLook.ts`: `IDENTITY_COLORS: Record<'us' | 'iec', Record<Conductor, string>>`, `schemeOf(region: Region | null): 'us' | 'iec'`, `identityColor(d: Diagram, ep: Endpoint): string | null`, `interface WireLook { color: string | null; hazard: boolean }`, `wireLooks(d: Diagram): Map<string, WireLook>`, `newWireColor(d: Diagram, from: Endpoint, to: Endpoint, fallback: string): string`.
  - In `render/Mains.tsx`: `HAZARD = '#F48C06'`, `HazardOutline({ d, width })`, `Stripe({ d, width, color })`, `along(points: Pt[], dist: number): Pt | null`, `Bolts({ points })`.
  - The canvas colour path of every wire gets `className="wire-color"` (the browser check reads it).

`wirePaths` is not touched: the look is joined to its output by wire uid, so the routing and hop code and their budgets are unchanged. While a part or segment drag is open the canvas keeps the looks from before the gesture (the mains analysis runs once per edit, like the checker).

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsLook.test.ts`:

```ts
// The mains look (spec 5): wires on mains and earth nodes default to their region's colours by
// identity, energized wires are marked, and a new wire from a mains terminal takes its colour.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidColor, serializeDiagram, validateDiagram, wireColor, wireStripe } from './diagram.ts'
import { identityColor, newWireColor, wireLooks } from './mainsLook.ts'
import { Sheet } from '../render/Sheet.tsx'
import { at, sheet, w } from './mains.testing.ts'

const us = sheet([at('xs1', 'XS1', 't-outlet'), at('e1', 'E1', 't-lamp-c1', 200), at('u1', 'U1', 't-mcu', 400)],
  [w('xs1|L', 'e1|L', { color: undefined }), w('xs1|N', 'e1|N', { color: undefined }), w('xs1|PE', 'e1|PE', { color: undefined })])
const eu = sheet([at('xs1', 'XS1', 't-outlet-eu'), at('e1', 'E1', 't-lamp-230', 200), at('x1', 'X1', 't-term', 400)],
  [w('xs1|L', 'e1|L', { color: undefined }), w('xs1|N', 'e1|N', { color: undefined }), w('xs1|PE', 'x1|1', { color: undefined })])

describe('identity colours', () => {
  it('US and Japan: L black, N white, PE green', () => {
    expect(['L', 'N', 'PE'].map((pin) => identityColor(us, { part: 'xs1', pin }))).toEqual(['black', 'white', 'green'])
  })
  it('Europe, UK and AU: L brown, N blue, PE green-yellow', () => {
    expect(['L', 'N', 'PE'].map((pin) => identityColor(eu, { part: 'xs1', pin }))).toEqual(['brown', 'blue', 'green-yellow'])
  })
  it('a node whose identity depends on the state has no colour (Resolution 19): never shown as PE when it can be L', () => {
    // K1 COM is L while released (through NC) and PE while energized (through NO), never both.
    const d = sheet([at('xs1', 'XS1', 't-outlet'), at('k1', 'K1', 't-relay', 200)], [w('xs1|L', 'k1|NC'), w('xs1|PE', 'k1|NO')])
    expect(identityColor(d, { part: 'k1', pin: 'COM' })).toBeNull()
    expect(identityColor(d, { part: 'k1', pin: 'NC' })).toBe('black')
  })
  it('a pin off mains has no identity colour, and a sheet without mains has none at all', () => {
    expect(identityColor(us, { part: 'u1', pin: 'IO' })).toBeNull()
    expect(identityColor(sheet([at('u1', 'U1', 't-mcu')], []), { part: 'u1', pin: 'IO' })).toBeNull()
  })
})

describe('wire looks', () => {
  it('marks energized wires as hazards, colours earth wires without the hazard, leaves other wires alone', () => {
    const looks = wireLooks(eu)
    const [l, n, pe] = eu.connections.map((c) => looks.get(c.uid))
    expect(l).toEqual({ color: 'brown', hazard: true })
    expect(n).toEqual({ color: 'blue', hazard: true })
    expect(pe).toEqual({ color: 'green-yellow', hazard: false })
  })
  it('a new wire from a mains terminal takes its identity colour; from a low-voltage pin it keeps the style colour', () => {
    expect(newWireColor(eu, { part: 'xs1', pin: 'L' }, { part: 'e1', pin: 'L' }, 'red')).toBe('brown')
    expect(newWireColor(us, { part: 'u1', pin: 'IO' }, { part: 'u1', pin: 'GND' }, 'red')).toBe('red')
  })
  it('green-yellow is a valid colour that round-trips, drawn green with a yellow stripe', () => {
    expect(isValidColor('green-yellow')).toBe(true)
    expect(wireColor('green-yellow')).toBe('#2F9E6E')
    expect(wireStripe('green-yellow')).toBe('#F4B400')
    expect(wireStripe('red')).toBeNull()
    const d = { ...eu, connections: eu.connections.map((c) => ({ ...c, color: 'green-yellow' })) }
    const r = validateDiagram(JSON.parse(serializeDiagram(d)))
    expect(r.ok && r.diagram.connections.every((c) => c.color === 'green-yellow')).toBe(true)
  })
  it('the sheet draws identity colours, the hazard outline and the lightning markers', () => {
    const html = renderToStaticMarkup(createElement(Sheet, { diagram: eu, box: { x: -20, y: -20, w: 700, h: 300 }, label: 'eu' }))
    expect(html).toContain('stroke="#8B5A2B"')
    expect(html).toContain('class="wire-hazard"')
    expect(html).toContain('data-bolt')
    expect(html).toContain('stroke="#F4B400"')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/format/mainsLook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/format/diagram.ts`:

```ts
/** Two-colour insulation (the IEC earth wire): a base colour with the second one striped over it. */
export const STRIPED_COLORS: Record<string, [string, string]> = { 'green-yellow': ['#2F9E6E', '#F4B400'] }

/** Named color, two-colour name (its base) or #RRGGBB; anything else falls back to black. */
export function wireColor(c: string | undefined): string {
  if (!c) return NAMED_COLORS.black
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  const key = c.toLowerCase()
  if (Object.hasOwn(STRIPED_COLORS, key)) return STRIPED_COLORS[key][0]
  return Object.hasOwn(NAMED_COLORS, key) ? NAMED_COLORS[key] : NAMED_COLORS.black
}

/** The stripe colour of a two-colour wire, or null. */
export function wireStripe(c: string | undefined): string | null {
  const key = c?.toLowerCase()
  return key && Object.hasOwn(STRIPED_COLORS, key) ? STRIPED_COLORS[key][1] : null
}

export function isValidColor(c: string): boolean {
  const key = c.toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(c) || Object.hasOwn(NAMED_COLORS, key) || Object.hasOwn(STRIPED_COLORS, key)
}
```

Create `src/format/mainsLook.ts`:

```ts
// How mains wiring looks (spec 5): a wire on a mains or earth node defaults to its source region's
// colour for its identity, an energized wire is marked as a hazard, and a new wire drawn from a mains
// terminal starts in its identity's colour (the user can change it). Reads the cached analysis. Pure.
import type { Diagram, Endpoint } from './diagram.ts'
import { nodeKey } from './netlist.ts'
import { analyseMainsCached } from './mains.ts'
import type { Conductor, Region } from './mainsModel.ts'

export const IDENTITY_COLORS: Record<'us' | 'iec', Record<Conductor, string>> = {
  us: { L: 'black', N: 'white', PE: 'green' },
  iec: { L: 'brown', N: 'blue', PE: 'green-yellow' },
}

/** US and Japan wire L black, N white, PE green; Europe, the UK and AU/NZ use the IEC colours. */
export const schemeOf = (region: Region | null): 'us' | 'iec' => (region === 'us' || region === 'jp' ? 'us' : 'iec')

/** The colour of the one conductor at a terminal, or null (off mains, or several conductors). */
export function identityColor(d: Diagram, ep: Endpoint): string | null {
  const c = analyseMainsCached(d)?.conductorOf(nodeKey(ep.part, ep.pin))
  return c ? IDENTITY_COLORS[schemeOf(c.region)][c.conductor] : null
}

export interface WireLook {
  /** The identity colour, used when the wire stores none. */
  color: string | null
  /** The wire is on a node that is hazardous in some state. */
  hazard: boolean
}

/** Per wire uid, its mains look; wires off mains are left out. */
export function wireLooks(d: Diagram): Map<string, WireLook> {
  const out = new Map<string, WireLook>()
  const a = analyseMainsCached(d)
  if (!a) return out
  for (const c of d.connections) {
    const k = nodeKey(c.from.part, c.from.pin)
    const id = a.conductorOf(k) ?? a.conductorOf(nodeKey(c.to.part, c.to.pin))
    const hazard = a.hazardKeys.has(k)
    if (id || hazard) out.set(c.uid, { color: id ? IDENTITY_COLORS[schemeOf(id.region)][id.conductor] : null, hazard })
  }
  return out
}

/** The colour a new wire between two ends starts with: an end's identity colour, else `fallback` (the new-wire style). */
export function newWireColor(d: Diagram, from: Endpoint, to: Endpoint, fallback: string): string {
  return identityColor(d, from) ?? identityColor(d, to) ?? fallback
}
```

Create `src/render/Mains.tsx`:

```tsx
// The mains look on a sheet (spec 5): a thin hazard outline under an energized wire, a small lightning
// marker near each of its ends, and the second colour of a two-colour wire.
import type { Pt } from '../format/geometry.ts'
import { INK } from './Part.tsx'

export const HAZARD = '#F48C06'

/** Drawn under the wire's ink outline, so it shows as a thin orange rim. */
export function HazardOutline({ d, width }: { d: string; width: number }) {
  return <path className="wire-hazard" d={d} stroke={HAZARD} strokeWidth={width + 5.2} />
}

/** The stripe of a two-colour wire (green-yellow earth), over its base colour. */
export function Stripe({ d, width, color }: { d: string; width: number; color: string }) {
  return <path d={d} stroke={color} strokeWidth={width} strokeDasharray="7 7" />
}

/** The point `dist` px along a polyline from its first point, or null when it is shorter. */
export function along(points: Pt[], dist: number): Pt | null {
  let left = dist
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (len >= left) {
      const t = len ? left / len : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= len
  }
  return null
}

/** A small lightning marker 16 px in from each end of an energized wire. */
export function Bolts({ points }: { points: Pt[] }) {
  const at = [along(points, 16), along([...points].reverse(), 16)].filter((p): p is Pt => p !== null)
  return (
    <g data-bolt="" pointerEvents="none">
      {at.map((p, i) => (
        <path key={i} d={`M${p.x + 1} ${p.y - 7}l-4 7h3l-1 6 5-8h-3l2-5z`} fill={HAZARD} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      ))}
    </g>
  )
}
```

In `src/render/Sheet.tsx` (import `wireLooks`, `wireStripe`, `HazardOutline`, `Stripe`, `Bolts`): compute `const looks = wireLooks(diagram)` and draw each wire as:

```tsx
          const look = looks.get(conn.uid)
          const name = conn.color ?? look?.color ?? undefined
          const color = wireColor(name)
          const stripe = wireStripe(name)
          return (
            <g key={conn.uid} data-wire={conn.uid}>
              {look?.hazard && <HazardOutline d={d} width={w} />}
              <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={blocked ? '6 5' : undefined} />
              <path className="wire-color" d={d} stroke={color} strokeWidth={w} strokeDasharray={blocked ? '6 5' : undefined} />
              {stripe && <Stripe d={d} width={w} color={stripe} />}
            </g>
          )
```

and after `<CableLayer .../>`: `{wires.map(({ conn, points }) => (looks.get(conn.uid)?.hazard ? <Bolts key={`bolt-${conn.uid}`} points={points} /> : null))}`.

In `src/editor/Canvas.tsx` do the same inside the wires layer (keep the selection path first and the hit path last), with the looks computed once per edit and held during a gesture:

```tsx
  // The mains look (identity colours, hazard marks): once per edit, held while a part or segment drag
  // is open, like the checker (the analysis needs every position).
  const busy = drag?.kind === 'parts' || drag?.kind === 'segment'
  const looksRef = useRef<Map<string, WireLook>>(new Map())
  const looks = useMemo(() => (busy ? looksRef.current : (looksRef.current = wireLooks(diagram))), [diagram.parts, diagram.connections, diagram.modules, busy])
```

and in `onPointerUp`'s wire branch replace `addWire(s.diagram, drag.from, to, s.wireStyle)` with:

```ts
addWire(s.diagram, drag.from, to, { ...s.wireStyle, color: newWireColor(s.diagram, drag.from, to, s.wireStyle.color) })
```

In `src/editor/Inspector.tsx` loop the swatches over `[...Object.keys(NAMED_COLORS), ...Object.keys(STRIPED_COLORS)]`, with `style={{ background: Object.hasOwn(STRIPED_COLORS, name) ? `repeating-linear-gradient(135deg, ${STRIPED_COLORS[name][0]} 0 6px, ${STRIPED_COLORS[name][1]} 6px 12px)` : NAMED_COLORS[name] }}`, and show a stored-less wire's colour as its identity colour: `const color = wire.color ?? wireLooks(diagram).get(wire.uid)?.color ?? 'black'`.

In `src/editor/editor.css` nothing is needed for the paths (the SVG attributes carry the look); add `.swatch[aria-label="green-yellow"] { background-size: auto; }` only if the gradient renders tiled wrongly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsLook.test.ts src/format/diagram.test.ts` then the gate `npx tsc --noEmit && npm test`, and `npm run build`.
Expected: PASS.

- [ ] **Step 5: Look at it**

`npm run build`, open a sheet with a US and a Schuko outlet, cord plugs, a lamp and an earth wire through `shoot-parts.mjs` (or the Task 23 fixture) in light and dark; Read the images: identity colours right, the orange rim thin and clear of the ink, bolts small and not covering connectors, the green-yellow stripe readable.

- [ ] **Step 6: Commit**

```bash
git add src/format/diagram.ts src/format/mainsLook.ts src/render/Mains.tsx src/render/Sheet.tsx src/editor/Canvas.tsx src/editor/Inspector.tsx src/editor/editor.css src/format/mainsLook.test.ts
git commit -m "Mains: identity colours, hazard outline, lightning markers, new-wire colour" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Honesty in the product: notice, badge, empty state, exports, PRD

**Files:**
- Modify: `src/format/mains.ts` (append `MAINS_NOTICE`, `hasMains`, `withSheetNotes`)
- Modify: `src/format/diagram.ts` (`Diagram.notes`, `validateDiagram` keeps valid notes and drops bad ones with a warning)
- Modify: `src/render/Mains.tsx` (append `MainsNotice`), `src/render/Sheet.tsx`
- Modify: `src/editor/Inspector.tsx:219-322` (`ProblemList`: notice, new empty state), `src/editor/Toolbar.tsx` (badge, print notice, export with notes), `src/editor/editor.css`
- Modify: `src/editor/problems.failure.test.ts:35`, `scripts/check-problems-ui.mjs:115`, `scripts/perf-breadboard.mjs:626` (the empty-state text)
- Modify: `docs/PRD.md`
- Test: `src/format/mainsNotice.test.ts`

**Interfaces:**
- Consumes: `mainsOf` (Task 2); `ProblemList`, `Sheet`.
- Produces:
  - `MAINS_NOTICE = 'Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.'` (spec 6, verbatim).
  - `hasMains(d: Pick<Diagram, 'parts' | 'modules'>): boolean`: any mains part on the sheet (Resolution 23: a part whose module declares any mains data, a mains-rated relay, SSR or terminal block alone included). It is `hasMainsData` from Task 5.
  - `withSheetNotes(d: Diagram): Diagram`: the notice in `notes` when `hasMains`, out of it otherwise; the same object when nothing changes.
  - `Diagram.notes?: string[]`.
  - `MAINS_NOTICE_FONT = 9`, `noticeLines(text: string, width: number, fontSize?: number): string[]` (greedy word wrap with a conservative bold-glyph width of 0.62 em, so no line overruns `width`), `noticeHeight(lines: number): number`, and `MainsNotice({ box, text })` in `render/Mains.tsx`; `Sheet` reserves a footer band of `noticeHeight` below the drawing and grows its viewBox by it.
  - Empty state heading: `No problems found in the drawn connections.`

- [ ] **Step 1: Write the failing tests**

Create `src/format/mainsNotice.test.ts`:

```ts
// Honesty in the product (spec 6): a mains sheet always carries the notice, in the Problems panel,
// in the drawing and in exported JSON; the empty state speaks only of the drawn connections.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { serializeDiagram, validateDiagram } from './diagram.ts'
import { MAINS_NOTICE, hasMains, withSheetNotes } from './mains.ts'
import { checkDiagram } from './checks.ts'
import { Sheet } from '../render/Sheet.tsx'
import { EditorStore } from '../editor/store.ts'
import { ProblemList } from '../editor/Inspector.tsx'
import { at, sheet, w } from './mains.testing.ts'
import { MAINS_NOTICE_FONT, noticeHeight, noticeLines } from '../render/Mains.tsx'

const mainsSheet = sheet([at('xs1', 'XS1', 't-outlet')], [])
const relayOnly = sheet([at('k1', 'K1', 't-relay')], [])
const noMains = sheet([at('u1', 'U1', 't-mcu')], [])
const list = (d: ReturnType<typeof sheet>) => {
  const s = new EditorStore(d)
  return renderToStaticMarkup(createElement(ProblemList, { store: s, findings: checkDiagram(d) }))
}

describe('the mains notice', () => {
  it('says exactly what the spec says', () => {
    expect(MAINS_NOTICE).toBe('Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.')
  })
  it('appears for any mains part, a mains-rated relay alone included (Resolution 23)', () => {
    expect(hasMains(mainsSheet)).toBe(true)
    expect(hasMains(relayOnly)).toBe(true)
    expect(hasMains(noMains)).toBe(false)
  })
  it('the Problems panel shows it with the new empty state, and not on a sheet without mains', () => {
    const html = list(mainsSheet)
    expect(html).toContain(MAINS_NOTICE)
    expect(html).toContain('No problems found in the drawn connections.')
    expect(list(relayOnly)).toContain(MAINS_NOTICE)
    const plain = list(noMains)
    expect(plain).not.toContain(MAINS_NOTICE)
    expect(plain).toContain('No problems found in the drawn connections.')
  })
  it('is never beside a clean claim when a check did not finish', () => {
    const ks = Array.from({ length: 17 }, (_, i) => i + 1)
    const d = sheet([at('xs1', 'XS1', 't-outlet'), ...ks.map((k) => at(`s${k}`, `S${k}`, 't-switch', k * 100))], ks.map((k) => w('xs1|L', `s${k}|1`)))
    const html = list(d)
    expect(html).toContain('Mains checks did not finish: 17 switches and relays.')
    expect(html).not.toContain('No problems found')
  })
  it('is drawn into the sheet, whole, in a footer the sheet reserves below the drawing (what image, print and PDF exports render)', () => {
    for (const w of [160, 400, 1200]) {
      const html = renderToStaticMarkup(createElement(Sheet, { diagram: mainsSheet, box: { x: 0, y: 0, w, h: 200 }, label: 'm' }))
      const lines = noticeLines(MAINS_NOTICE, w - 32)
      // Every word, in order, across the drawn lines.
      expect(lines.join(' ')).toBe(MAINS_NOTICE)
      for (const l of lines) expect(html).toContain(`>${l}</text>`)
      // No line wider than the band, by the conservative measure.
      for (const l of lines) expect(l.length * 0.62 * MAINS_NOTICE_FONT).toBeLessThanOrEqual(w - 32)
      // The viewBox grows by the footer, so the notice never covers the drawing.
      expect(html).toContain(`viewBox="0 0 ${w} ${200 + noticeHeight(lines.length)}"`)
    }
    const plain = renderToStaticMarkup(createElement(Sheet, { diagram: noMains, box: { x: 0, y: 0, w: 400, h: 200 }, label: 'r' }))
    expect(plain).not.toContain('Mains wiring')
    expect(plain).toContain('viewBox="0 0 400 200"')
  })
  it('is stored in exported JSON as a sheet note, once, and removed when the sheet has no mains part', () => {
    const out = withSheetNotes(mainsSheet)
    expect(out.notes).toEqual([MAINS_NOTICE])
    expect(withSheetNotes(out)).toBe(out)
    expect(withSheetNotes({ ...noMains, notes: [MAINS_NOTICE, 'mine'] }).notes).toEqual(['mine'])
    const r = validateDiagram(JSON.parse(serializeDiagram(out)))
    expect(r.ok && r.diagram.notes).toEqual([MAINS_NOTICE])
  })
  it('drops notes that are not strings, with a warning', () => {
    const r = validateDiagram({ ...JSON.parse(serializeDiagram(mainsSheet)), notes: [MAINS_NOTICE, 7] })
    expect(r.ok && r.diagram.notes).toEqual([MAINS_NOTICE])
    expect(r.ok && r.warnings).toContain('notes[1]: must be a string, so it was dropped')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/format/mainsNotice.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/format/mains.ts`:

```ts
/** Spec section 6, verbatim. */
export const MAINS_NOTICE = 'Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.'

/** Spec 6: "a sheet with any mains part" (Resolution 23): any part whose module declares mains data. */
export const hasMains = hasMainsData

/** The sheet as exported: the notice in `notes` when it has a mains part, out of it otherwise. Same object when nothing changes. */
export function withSheetNotes(d: Diagram): Diagram {
  const notes = d.notes ?? []
  const has = notes.includes(MAINS_NOTICE)
  if (hasMains(d) === has) return d
  const next = has ? notes.filter((n) => n !== MAINS_NOTICE) : [...notes, MAINS_NOTICE]
  const { notes: _old, ...rest } = d
  return next.length ? { ...rest, notes: next } : rest
}
```

In `src/format/diagram.ts` add to `Diagram`:

```ts
  /** Notes stored with the sheet, such as the mains notice on every exported mains sheet (spec 6). */
  notes?: string[]
```

and in `validateDiagram`, after the annotations block, collect a fix for bad notes:

```ts
  let notesFix: string[] | undefined | null = null
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) {
      notesFix = undefined
      warnings.push('notes: must be a list of strings, so it was dropped')
    } else if (raw.notes.some((n) => typeof n !== 'string')) {
      raw.notes.forEach((n, i) => typeof n !== 'string' && warnings.push(`notes[${i}]: must be a string, so it was dropped`))
      notesFix = raw.notes.filter((n): n is string => typeof n === 'string')
    }
  }
```

and apply it where the fixed diagram is built (`if (notesFix !== null) diagram = notesFix ? { ...diagram, notes: notesFix } : (({ notes: _n, ...rest }) => rest)(diagram)`), keeping the input unmutated like the other fixes.

Append to `src/render/Mains.tsx`:

```tsx
export const MAINS_NOTICE_FONT = 9
const LINE = 12
/** Conservative width of one bold glyph, in em: a line measured with it never overruns its band. */
const GLYPH = 0.62

/** Greedy word wrap of `text` into lines no wider than `width` px at `fontSize` (one word longer than that stays on its own line). */
export function noticeLines(text: string, width: number, fontSize = MAINS_NOTICE_FONT): string[] {
  const max = Math.max(1, Math.floor(width / (GLYPH * fontSize)))
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= max || !cur) cur = next
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** The footer band a notice of `lines` lines needs, in px. */
export const noticeHeight = (lines: number) => lines * LINE + 20

/** The mains notice in the footer band the sheet reserves below `box` (spec 6: every export shows it, whole). */
export function MainsNotice({ box, text }: { box: { x: number; y: number; w: number; h: number }; text: string }) {
  const lines = noticeLines(text, box.w - 32)
  const top = box.y + box.h
  return (
    <g data-mains-notice="" pointerEvents="none">
      <rect x={box.x + 8} y={top + 4} width={box.w - 16} height={noticeHeight(lines.length) - 8} rx={4} fill="#FFF4E5" stroke={HAZARD} strokeWidth={1.2} />
      {lines.map((l, i) => (
        <text key={i} x={box.x + 16} y={top + 18 + i * LINE} fontSize={MAINS_NOTICE_FONT} fontWeight={700} fill={INK}>{l}</text>
      ))}
    </g>
  )
}
```

In `src/render/Sheet.tsx`: reserve the footer and draw the notice in it:

```tsx
  const mains = hasMains(diagram)
  const footer = mains ? noticeHeight(noticeLines(MAINS_NOTICE, box.w - 32).length) : 0
  // ...the <svg> gets viewBox={`${box.x} ${box.y} ${box.w} ${box.h + footer}`}, the paper and grid rects keep height box.h,
  // and the last child is:
  {mains && <MainsNotice box={box} text={MAINS_NOTICE} />}
```

In `src/editor/Inspector.tsx` `ProblemList`:
- compute `const notice = hasMains(store.getState().diagram) ? <p className="mains-notice" role="note">{MAINS_NOTICE}</p> : null`;
- render `{notice}` right after the `<h3>` in each of the three branches (checker failed, empty, list);
- change the empty heading text to `No problems found in the drawn connections.`

In `src/editor/Toolbar.tsx`:
- after the problems badge: `{hasMains(diagram) && <span className="mains-badge" role="note" title={MAINS_NOTICE} aria-label={MAINS_NOTICE}>Mains: drawn connections only</span>}`;
- at the end of the header: `{hasMains(diagram) && <p className="print-notice">{MAINS_NOTICE}</p>}`;
- Export JSON writes `serializeDiagram(withSheetNotes(diagram))`.

In `src/editor/editor.css`:

```css
/* Mains notice (spec 6): orange like the hazard outline, never dismissible. */
.mains-badge { display: inline-flex; align-items: center; padding: 3px 9px; border: 1.5px solid #F48C06; border-radius: 6px; background: #FFF4E5; color: var(--ink); font: 700 12.5px/1.2 "Atkinson Hyperlegible", system-ui, sans-serif; }
.mains-notice { margin: 0; padding: 8px 10px; border-left: 4px solid #F48C06; border-radius: 4px; background: #FFF4E5; color: #3A2A10; font-size: 13.5px; line-height: 1.35; }
@media (prefers-color-scheme: dark) { .mains-badge, .mains-notice { background: #3A2A10; color: #FFE8C7; } }
.print-notice { display: none; }
@media print { .print-notice { display: block; position: fixed; left: 10mm; right: 10mm; bottom: 10mm; margin: 0; padding: 4mm; border: 1.5px solid #F48C06; background: #FFF4E5; color: #000; font-size: 11pt; } }
```

Update the three places that assert the old empty text (`problems.failure.test.ts` line 35, `scripts/check-problems-ui.mjs` line 115, `scripts/perf-breadboard.mjs` line 626) to `No problems found in the drawn connections.`

In `docs/PRD.md`: add a "Mains wiring" section stating the notice verbatim, that every mains sheet shows it in the Problems panel and the toolbar, that it is drawn into every export (image, print, PDF; any export added later must render it) and stored in exported JSON as a `notes` entry, and that the checker only reports on drawn connections; add `notes` to the Diagram format list; add the mains module fields (`electrical.acSources`, `ac`, `conducts`, `protective`, `settings`, `domains`, `isolation`, `isolationProvenance`, `safeguard`, `acInput`, `ratings`, `contacts`, `protection`, `plug`, `sockets`, `internalNodes`, pin `mains` and `bond`, params `acVoltage` and `fuseRating`) to the Module definition format table, one row each, with what the spec says they mean.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/format/mainsNotice.test.ts src/editor/problems.failure.test.ts` then the gate `npx tsc --noEmit && npm test`, and `npm run build`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/mains.ts src/format/diagram.ts src/render/Mains.tsx src/render/Sheet.tsx src/editor/Inspector.tsx src/editor/Toolbar.tsx src/editor/editor.css src/editor/problems.failure.test.ts scripts/check-problems-ui.mjs scripts/perf-breadboard.mjs docs/PRD.md src/format/mainsNotice.test.ts
git commit -m "Mains: persistent notice, badge, honest empty state, notice in exports, PRD" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Browser check `check:mains-ui`

**Files:**
- Create: `scripts/check-mains-ui.mjs`
- Modify: `package.json` (`"check:mains-ui": "node scripts/check-mains-ui.mjs"`)

**Interfaces:**
- Consumes: the built app (`npm run build`), the parts of Tasks 16 to 20, `.wire-color`, `.wire-hazard`, `[data-bolt]`, `.seat-ok`, `.seat-bad`, `.mains-badge`, `.mains-notice`, `.print-notice`, `[data-legs] circle`.
- Produces: `npm run check:mains-ui`, exit 1 on any failed check or page error; light and dark screenshots of each state in `--out`.

- [ ] **Step 1: Write the script**

```js
// Browser check for mains wiring, in the built app. Loads a sheet with a US duplex outlet (a cord
// plug seated, a fused lamp wired with no stored colours), a Schuko outlet with a Schuko plug seated
// the other way up, and a UK charger over the US outlet's lower socket; then through the real UI
// checks the notice in the Problems panel and the toolbar badge, identity colours and the hazard look
// on the wires, a plug dragged onto a matching socket (green, seated, one undo step), turned a
// quarter (unseated, plug-mismatch), a wrong plug (red outline, plug-mismatch), a new wire from a
// lead that carries L on the Schuko outlet taking brown, the notice in exported JSON and in print, and the empty state of a
// clean mains sheet. Light and dark screenshots of each state, to be looked at.
//
// Usage (repo root, after `npm run build`): npm run check:mains-ui -- [--out <dir>] [--port 4212]
// Launches its own Chrome through playwright-core; never the shared Playwright MCP browser.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i < 0 ? dflt : args[i + 1]
}
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-mains-ui')))
const port = Number(flag('--port', '4212'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const NOTICE = 'Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.'
const ids = ['outlet-us-5-15r-duplex', 'outlet-schuko-cee7-3', 'plug-us-5-15p', 'plug-eu-cee7-7', 'charger-usb-5v-uk', 'fuse-holder-5x20-inline', 'lamp-holder-e26', 'lamp-holder-e27']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
// Outlet XS1 at (0, 0): upper socket centred at (40, 40), lower at (40, 100). The 60 x 60 US plug has
// its pivot at (30, 30), so it sits at (10, 10) on the upper socket; the UK charger (60 x 60) at (10, 70) covers the lower one.
// Schuko XS2 at (600, 0) is 80 x 80 with its socket at (40, 40); the 80 x 80 Schuko plug sits at (600, 0).
const file = join(out, 'mains.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Mains check', modules,
  parts: [
    at('xs1', 'XS1', 'outlet-us-5-15r-duplex', 0, 0), at('xp1', 'XP1', 'plug-us-5-15p', 10, 10, { mount: { board: 'xs1' } }),
    at('ps1', 'PS1', 'charger-usb-5v-uk', 10, 70),
    at('f1', 'F1', 'fuse-holder-5x20-inline', 200, 200, { values: { fuseRating: { value: 2, unit: 'A' } } }), at('e1', 'E1', 'lamp-holder-e26', 400, 180),
    at('xs2', 'XS2', 'outlet-schuko-cee7-3', 600, 0), at('xp2', 'XP2', 'plug-eu-cee7-7', 600, 0, { rotation: 180, mount: { board: 'xs2' } }),
    at('e2', 'E2', 'lamp-holder-e27', 800, 180),
    at('xp3', 'XP3', 'plug-us-5-15p', 200, 400),
  ],
  connections: [
    { uid: 'w1', from: { part: 'xp1', pin: 'L' }, to: { part: 'f1', pin: '1' }, gauge: 18, ends: { from: 'ferrule', to: 'ferrule' } },
    { uid: 'w2', from: { part: 'f1', pin: '2' }, to: { part: 'e1', pin: 'L' }, gauge: 18 },
    { uid: 'w3', from: { part: 'e1', pin: 'N' }, to: { part: 'xp1', pin: 'N' }, gauge: 18 },
    { uid: 'w4', from: { part: 'xp2', pin: 'L' }, to: { part: 'e2', pin: 'L' }, gauge: 18 },
    { uid: 'w5', from: { part: 'xp2', pin: 'N' }, to: { part: 'e2', pin: 'N' }, gauge: 18 },
  ],
}))
const cleanFile = join(out, 'mains-clean.circuitoon.json')
writeFileSync(cleanFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Mains clean', modules,
  parts: [at('xs1', 'XS1', 'outlet-us-5-15r-duplex', 0, 0), at('xp1', 'XP1', 'plug-us-5-15p', 10, 10, { mount: { board: 'xs1' } })],
  connections: [],
}))

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' })
const stopServer = () => {
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    else server.kill('SIGTERM')
  } catch {
    // already gone
  }
}
process.on('exit', stopServer)
const base = `http://localhost:${port}/circuitoon/`
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base)).ok) break
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500))
}

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 200) => page.waitForTimeout(ms)
  const shot = async (name, locator = page) => {
    await locator.screenshot({ path: join(out, `${name}-${scheme}.png`) })
    console.log('saved', join(out, `${name}-${scheme}.png`))
  }
  /** Screen position of a world point on the canvas. */
  const screen = (x, y) => page.evaluate(([x, y]) => {
    const svg = document.querySelector('svg.canvas')
    const p = svg.createSVGPoint()
    p.x = x
    p.y = y
    const s = p.matrixTransform(svg.getScreenCTM())
    return { x: s.x, y: s.y }
  }, [x, y])
  const stroke = (uid) => page.locator(`[data-wire="${uid}"] .wire-color`).first().getAttribute('stroke')
  const messages = () => page.locator('.problem-message').allTextContents()

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('[data-part="xp3"]')
  await pause(400)

  // The notice: Problems panel and toolbar badge.
  check((await page.locator('.mains-notice').textContent()) === NOTICE, `${scheme}: the Problems panel shows the mains notice`)
  // The panel's notice is shown in full, never collapsed.
  check((await page.locator('.mains-notice').isVisible()), `${scheme}: the notice is visible, not collapsed`)
  check((await page.locator('.mains-badge').count()) === 1, `${scheme}: the toolbar shows the mains badge`)
  await shot('mains-panel', page.locator('.inspector'))

  // Identity colours and the hazard look.
  check((await stroke('w1')) === '#2B2F36', `${scheme}: the US L wire is black (${await stroke('w1')})`)
  check((await stroke('w3')) === '#FFFFFF', `${scheme}: the US N wire is white (${await stroke('w3')})`)
  const w4 = await stroke('w4')
  check(w4 === '#3D6FD6', `${scheme}: the reversed Schuko plug's L lead is blue, it carries N (${w4})`)
  check((await page.locator('[data-wire="w1"] .wire-hazard').count()) === 1, `${scheme}: an energized wire has the hazard outline`)
  check((await page.locator('[data-bolt] path').count()) >= 2, `${scheme}: energized wires have lightning markers`)
  await shot('mains-sheet')

  // A wrong plug: red outline while dragging it, plug-mismatch in the list.
  const mm = await messages()
  check(mm.includes("PS1's UK plug does not fit XS1's US socket. Use a device with a US plug."), `${scheme}: the UK charger over the US outlet is a plug mismatch`)
  const ps = await screen(40, 100)
  await page.mouse.move(ps.x, ps.y)
  await page.mouse.down()
  const nudge = await screen(40, 105)
  await page.mouse.move(nudge.x, nudge.y, { steps: 3 })
  await pause()
  check((await page.locator('rect.seat-bad').count()) === 1, `${scheme}: dragging the wrong plug over the outlet shows a red outline`)
  await shot('mains-wrong-plug')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await pause()

  // A matching plug dragged onto the lower socket: green while dragging, seated on drop, one undo step.
  // Move PS1 away first so the lower socket is free.
  await page.locator('[data-part="ps1"]').click()
  await page.keyboard.press('Delete')
  await pause()
  const legsBefore = await page.locator('[data-legs] circle').count()
  const from = await screen(230, 430)
  const to = await screen(40, 100)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await pause()
  check((await page.locator('circle.seat-ok').count()) === 3, `${scheme}: a US plug over the free US socket shows three green contacts`)
  await shot('mains-seat')
  await page.mouse.up()
  await pause(300)
  check((await page.locator('[data-legs] circle').count()) === legsBefore + 3, `${scheme}: the dropped plug is seated (three more contact dots)`)
  // A quarter turn is not an orientation any US plug fits: it unseats and says why.
  await page.keyboard.press('r')
  await pause(300)
  check((await page.locator('[data-legs] circle').count()) === legsBefore, `${scheme}: a quarter turn unseats the plug`)
  check((await messages()).some((m) => m.startsWith('XP3 does not sit in XS1')), `${scheme}: the turned plug is a plug mismatch`)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await pause(300)

  // A new wire from the reversed Schuko plug's N lead, which carries L, takes brown.
  const lead = await page.locator('[data-pin-part="xp2"][data-pin="N"]').boundingBox()
  const lamp = await page.locator('[data-pin-part="e2"][data-pin="L"]').boundingBox()
  await page.mouse.move(lead.x + lead.width / 2, lead.y + lead.height / 2)
  await page.mouse.down()
  await page.mouse.move(lamp.x + lamp.width / 2, lamp.y + lamp.height / 2, { steps: 10 })
  await page.mouse.up()
  await pause(300)
  const last = await page.evaluate(() => [...document.querySelectorAll('[data-wire] .wire-color')].at(-1)?.getAttribute('stroke'))
  check(last === '#8B5A2B', `${scheme}: a new wire from a lead that carries L on a Schuko outlet is brown (${last})`)

  // Export JSON carries the notice.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  check(Array.isArray(saved.notes) && saved.notes.includes(NOTICE), `${scheme}: exported JSON stores the notice as a sheet note`)

  // Print shows the notice.
  await page.emulateMedia({ media: 'print' })
  check(await page.locator('.print-notice').isVisible(), `${scheme}: the notice is on the printed page`)
  await page.screenshot({ path: join(out, `mains-print-${scheme}.png`) })
  await page.emulateMedia({ media: 'screen' })

  // A clean mains sheet: the empty state speaks only of drawn connections, the notice stays.
  await page.locator('input[type=file]').setInputFiles(cleanFile)
  await page.waitForSelector('text=Mains clean')
  await pause(300)
  check((await page.locator('#problems-title').textContent())?.includes('No problems found in the drawn connections.'), `${scheme}: the empty state says no problems found in the drawn connections`)
  check((await page.locator('.mains-notice').count()) === 1, `${scheme}: the notice stays on a clean mains sheet`)
  await shot('mains-clean', page.locator('.inspector'))

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await page.close()
}
await browser.close()
console.log(`screenshots in ${out}`)
if (failures.length) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all mains checks passed')
process.exit(0)
```

Placement notes the implementer confirms against the generated modules before running: the US plug's pivot and body (60 x 60, pivot 30, 30), the duplex socket centres (40, 40) and (40, 100), the Schuko socket centre (40, 40) and its L hole at (20, 40) from the outlet's origin. If a module's size differs, adjust the part positions in the two fixture files, not the checks.

- [ ] **Step 2: Add the npm script and run it**

Add `"check:mains-ui": "node scripts/check-mains-ui.mjs"` to `package.json` scripts. Run `npm run build && npm run check:mains-ui` (screenshots go to the system temp folder under `circuitoon-mains-ui`; pass `-- --out <dir>` to choose another).
Expected: every line `ok`, exit 0. Read every screenshot, light and dark: the notice legible, colours right, the hazard look thin and clear, the green and red seat marks visible, the print page with the notice.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-mains-ui.mjs package.json
git commit -m "Mains: browser check check:mains-ui" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Final performance budgets and verification

**Files:**
- Modify: `src/format/mains.perf.test.ts` (created in Task 11; append the full sheet on built-in parts)
- Modify: `src/format/checks.perf.test.ts` (the no-mains sheets never start a mains analysis)

**Interfaces:**
- Consumes: everything; `median` (Task 11, same file); `hasMainsData`, `analyseMains` (Task 5); `wireLooks` (Task 21).
- Produces: the measured budgets below, as tests.

Budgets (median of the timed runs, a fresh parts array each run as in `checks.perf.test.ts`):
- The two existing 200-part sheets without mains: 20 ms or less (unchanged tests); `hasMainsData` is false on them, so the analysis returns before plugs, netlist or graph.
- A realistic mains sheet with 16 candidate contact groups in one enumeration unit (65,536 states, exhaustive), two converters and a 150-part DC section: 300 ms or less for `checkDiagram`, and the renderer's `wireLooks` right after it reuses the same analysis (under 5 ms).
- The same sheet with 4 candidate groups: 30 ms or less.

- [ ] **Step 1: Write the tests**

In `src/format/checks.perf.test.ts`, in the first budget test, after `const d = sheet(parts, connections)`, add `expect(hasMainsData(d)).toBe(false)` and `expect(analyseMains(d)).toBeNull()` (import both from `./mains.ts`).

Append to `src/format/mains.perf.test.ts` (add `import type { ModuleDef } from './module.ts'`, `import { load, pinsOf } from './builtinModules.testing.ts'` and `import { wireLooks } from './mainsLook.ts'` to its imports):

```ts
const ids = ['outlet-us-5-15r-duplex', 'plug-us-5-15p', 'rocker-switch-kcd1', 'relay-module-1ch-5v', 'ssr-fotek-25da', 'fuse-holder-5x20-inline', 'lamp-holder-e26', 'hlk-pm01',
  'esp32-devkitc-v4', 'bme280-module-6pin', 'oled-ssd1306-096-i2c', 'resistor', 'led']
const mods: Record<string, ModuleDef> = Object.fromEntries(ids.map((id) => [id, load(id)]))
let n = 0
const wire = (a: string, ap: string, b: string, bp: string, mains = true): Connection =>
  ({ uid: `w${++n}`, from: { part: a, pin: ap }, to: { part: b, pin: bp }, ...(mains ? { gauge: 18, ends: { from: 'ferrule', to: 'ferrule' } } : {}) })

function build(groups: number): Diagram {
  const parts: PartInstance[] = []
  const connections: Connection[] = []
  const at = (uid: string, designator: string, module: string, x: number, y: number, extra: Partial<PartInstance> = {}) => {
    parts.push({ uid, designator, module, x, y, rotation: 0, ...extra })
    return uid
  }
  for (const k of [0, 1]) {
    at(`xs${k}`, `XS${k + 1}`, 'outlet-us-5-15r-duplex', k * 2000, 0)
    at(`xp${k}`, `XP${k + 1}`, 'plug-us-5-15p', k * 2000 + 10, 10, { mount: { board: `xs${k}` } })
    at(`ps${k}`, `PS${k + 1}`, 'hlk-pm01', k * 2000 + 200, 300)
    connections.push(wire(`xp${k}`, 'L', `ps${k}`, 'AC 1'), wire(`xp${k}`, 'N', `ps${k}`, 'AC 2'))
  }
  // Each group switches its own fused lamp: plug L, fuse, contact, lamp, back to plug N.
  const kinds = [['rocker-switch-kcd1', '1', '2', 'S'], ['relay-module-1ch-5v', 'COM', 'NO', 'K'], ['ssr-fotek-25da', '1', '2', 'K']] as const
  for (let g = 0; g < groups; g++) {
    const [module, a, b, prefix] = g < 8 ? kinds[0] : g < 12 ? kinds[1] : kinds[2]
    // Every group on the first plug: one enumeration unit of 16 groups, the worst case.
    const k = 0
    const s = at(`g${g}`, `${prefix}${g + 1}`, module, 300 + g * 120, 600)
    const f = at(`f${g}`, `F${g + 1}`, 'fuse-holder-5x20-inline', 300 + g * 120, 800, { values: { fuseRating: { value: 2, unit: 'A' } } })
    const e = at(`e${g}`, `E${g + 1}`, 'lamp-holder-e26', 300 + g * 120, 1000)
    connections.push(wire(`xp${k}`, 'L', f, '1'), wire(f, '2', s, a), wire(s, b, e, 'L'), wire(e, 'N', `xp${k}`, 'N'))
  }
  // A DC section: two ESP32 boards on the converters, and loose real parts wired pin to pin.
  for (const k of [0, 1]) {
    at(`u${k}`, `U${k + 1}`, 'esp32-devkitc-v4', k * 2000 + 400, 1400)
    connections.push(wire(`ps${k}`, '+Vo', `u${k}`, '5V', false), wire(`ps${k}`, '-Vo', `u${k}`, 'GND', false))
  }
  const loose = ['bme280-module-6pin', 'oled-ssd1306-096-i2c', 'resistor', 'led', 'esp32-devkitc-v4']
  const dc: PartInstance[] = []
  for (let i = 0; i < 150; i++) dc.push(parts[parts.push({ uid: `d${i}`, designator: `U${i + 10}`, module: loose[i % loose.length], x: 3000 + (i % 15) * 300, y: Math.floor(i / 15) * 300, rotation: 0 }) - 1])
  let seed = 11
  const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % m)
  for (let i = 0; i < 400; i++) {
    const [a, b] = [dc[rnd(dc.length)], dc[rnd(dc.length)]]
    const [pa, pb] = [pinsOf(mods[a.module]), pinsOf(mods[b.module])]
    connections.push(wire(a.uid, pa[rnd(pa.length)].name, b.uid, pb[rnd(pb.length)].name, false))
  }
  return { format: 'circuitoon-diagram/1', title: 't', modules: mods, parts, connections }
}

describe('mains checks on a realistic sheet', () => {
  it('enumerates all 65,536 states of 16 contact groups in 300 ms or less (median)', { timeout: 30_000 }, () => {
    const d = build(16)
    const a = analyseMains(d)!
    expect(a.complete).toBe(true)
    expect(checkDiagram(d).filter((f) => f.rule === 'mains-incomplete')).toEqual([])
    const ms = median(d, 5)
    console.log(`mains full sheet: ${ms.toFixed(1)} ms median`)
    expect(ms).toBeLessThanOrEqual(300)
  })
  it('the renderer reuses the analysis the checker made for the same edit', { timeout: 30_000 }, () => {
    const d = build(16)
    checkDiagram(d)
    const s = performance.now()
    wireLooks(d)
    expect(performance.now() - s).toBeLessThan(5)
  })
  it('checks the same sheet with 4 contact groups in 30 ms or less (median)', () => {
    expect(median(build(4), 13)).toBeLessThanOrEqual(30)
  })
})
```

(Confirm the ESP32 DevKitC V4 pin names `5V` and `GND` and the relay, SSR and Hi-Link pin names against their modules before running.)

- [ ] **Step 2: Run them**

Run: `npx vitest run src/format/mains.perf.test.ts src/format/checks.perf.test.ts`
Expected: PASS. If the 16-group budget fails here but Task 11's passed, the cost is in what the built-in parts add (more terminals per node, the DC section): profile (`node --cpu-prof`), then apply Task 11 Step 3 if it is not in yet, and cache any per-view list a rule rebuilds per state. Never skip a state; if it still misses, stop and report the profile to the controller. The budget stays at 300 ms.

- [ ] **Step 3: Final verification (all must pass)**

```bash
npm run validate && npm run check:gen && npx tsc --noEmit && npm test && npm run build && npm run check:problems-ui && npm run check:warnings-ui && npm run check:cables-ui && npm run check:mains-ui && node scripts/perf-breadboard.mjs
```

Expected: every command exits 0; `perf-breadboard.mjs` reports its frame budgets (median 17 ms or less, p95 33 ms or less) met, which shows the mains look did not touch the drag path. Search the branch for the em dash character (U+2014): `git grep -nP '\x{2014}' -- src scripts docs modules .claude` must print nothing.

- [ ] **Step 4: Commit**

```bash
git add src/format/mains.perf.test.ts src/format/checks.perf.test.ts
git commit -m "Mains: performance budgets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Review before shipping (controller)**

The controller runs the `consult-astra` skill on the whole `mains` branch (spec 7: Astra reviews the build before shipping), weighs each finding, fixes what it agrees with and reports the rest to Michael; confirms every parts batch has a MATCHES verdict (or a decision from Michael) for every part from its independent review; records what was learned in Michael's vault (`Projects/` Circuitoon note: the mains model, the new generators, the budgets) per his CLAUDE.md. Shipping itself is the `circuitoon-ship` skill, after Michael says so.

---

## Spec coverage

"Implemented in" names the task whose code does it. "Independent test" names the test that establishes the requirement from outside that code: a spec example, a counterexample, a table transcribed from the spec, a standard's figure or source evidence, not a value the implementation itself computes. Where no unit test can, it says what does (the browser check, the controller's review).

| Spec requirement | Implemented in | Independent test |
| --- | --- | --- |
| 1.1 `acSources`; each outlet its own source; unknown relative phase | 2, 3 | `mainsModel.test.ts` accepts an outlet; `mainsRules.test.ts` "L-L across outlets" |
| 1.1 `acVoltage` (VAC, 1 to 1000, separate from `voltage`), region default, `ac.hz` | 1, 2, 16 | `module.test.ts` "accepts an acVoltage from 1 to 1000"; `diagram.test.ts` "drops an acVoltage out of range"; `mainsParts.test.ts` outlet voltages vs the standards |
| 1.1 An AC input's range is a requirement, not an amplitude | 3, 5 | `mains.test.ts` converter tests (a converter never sources AC) |
| 1.2 Typed edges: zero, protective, load, leakage, isolated | 3 | `mainsGraph.test.ts` (identity through a terminal block, energy not identity through a load, fitted and absent fuse, SSR leakage, isolation) |
| 1.2 Undeclared mains terminal: conservative, `data-missing` | 3, 7 | `mainsGraph.test.ts` "treats an undeclared mains terminal conservatively"; `mainsRules.test.ts` "a mains terminal with no conduction data" |
| 1.2 Identity and energization closures; hazardous node | 3 | `mainsGraph.test.ts` |
| 1.2 Requirements L, N, PE, line | 2, 9 | `mainsRules.test.ts` rule 6 and 7 tests |
| 1.3 Domains, isolation, protective separation; earthing never substitutes | 2, 3, 6 | `mainsModel.test.ts` "counts basic isolation as protective separation only with a protective screen"; `mainsRules.test.ts` "basic-isolation secondary to a GPIO (error, bonded or not)" |
| 1.3 SELV and PELV classification by separation and bond; PELV keeps DC checks | 6, 9 | `mainsRules.test.ts` "basic plus a declared protective screen and PE bond (PELV, allowed, DC checks kept)", "reinforced with a PE bond (PELV)" |
| 1.3 Converter availability (powered, unpowered, unknown), gating sources and the passive-feed allowance | 5 | `mains.test.ts` all availability tests, including "converter with inputs L and L (unknown availability, no DC conclusions)" |
| 1.3 A converter's pins outside every domain (Resolution 27) | 3, 7 | `mainsGraph.test.ts` "treats a converter's outputs outside every domain as live"; `mainsRules.test.ts` "a converter's outputs outside every domain are taken as live, and named" |
| 1.4 Ratings: relevance, then adequacy; four classes; conditions; provenance | 7 | `mainsRules.test.ts` rule 5 tests (125 VAC on 230 VAC, no rating, 300 VDC-only, conditional, unverified, the outlet's own rating) |
| 1.4 Provenance per exact assembly; clones and generic modules unverified | 0, 19, 20 | `mainsParts.test.ts` clone and relay module tests against the evidence; controller review |
| 1.5 Contact states: relay COM-NC released, COM-NO energized, never both; linked poles; SSR OFF leakage | 3 | `mainsGraph.test.ts` relay, linked-pole (`t-relay-2p`) and SSR tests |
| 1.5 Candidates from possible connectivity | 4 | `mainsStates.test.ts` "finds S2 in L-S1-S2-S3-N"; `mainsRules.test.ts` three-switch short |
| 1.5 Exhaustive up to 16 candidates; `mains-incomplete` beyond, no sampling, no clean claim | 4, 5, 10 | `mainsRules.test.ts` "17 contact groups"; `mainsNotice.test.ts` "is never beside a clean claim when a check did not finish" |
| 1.5 Findings name their state, with every needed condition | 4, 5 | `mainsStates.test.ts` `minimalWitness` and `statePhrase` tests; `mainsRules.test.ts` "when S1 is on and K1 is released", "when S1 and S2 are both on" |
| 1.6 Protection classes; class 1 PE terminal; cord plugs 3-lead and 2-lead | 2, 9, 17 | `mainsRules.test.ts` class 1 lamp tests; `mainsParts.test.ts` cord plugs |
| 1.6 Declared PE bond; undeclared DC ground on PE warns | 2, 9 | `mainsRules.test.ts` "a DC ground joined to earth without a declared bond warns" |
| 1.6 Protective conductors: parallel and redundant paths, never through a low-voltage pin | 8 | `mainsProtective.test.ts` (all four) |
| 1.7 Fuse holders: protective edge, optional `fuseRating`, fitted setting; `settings` validated, bad ones dropped | 1, 2, 3, 10, 18 | `module.test.ts`, `diagram.test.ts` settings tests; `mainsRules.test.ts` "empty fuse holder vs fitted with unknown rating", "never blames an empty fuse holder that is not the cause" |
| 1.7 UK integral BS 1362 fuse | 13, 17 | `plugSeating.test.ts` "UK fused plug protecting a cord-wired lamp (clean)"; `mainsParts.test.ts` UK devices |
| 1.7 Outlets on a branch breaker; rule 8 for the project's wiring | 10 | `mainsRules.test.ts` rule 8 tests |
| 1.8 Cable rule on hazardous and protective wires; unsuitable ends, 24 AWG or thinner; unverified wording | 10 | `mainsRules.test.ts` rule 9 tests |
| 2 Plug profiles; only profile contacts are mount legs | 2, 13 | `plugSeating.test.ts` matrix and mapping tests |
| 2 Sockets; never across sockets | 2, 13 | `plugSeating.test.ts` "contacts spread across two sockets (never seats)" |
| 2 Compatibility table: profiles, turns, mapping | 12, 13 | `plugging.test.ts` "agrees with the spec for every plug and socket family" and `plugSeating.test.ts` matrix, both against `plugSpec.testing.ts` (the spec transcribed by hand) |
| 2 Turned outlets; translations; occupied sockets; overlapping outlets; breadboards nearby | 13 | `plugSeating.test.ts` (one test each) |
| 2 Obscured and partial plug nothing; a partial mount never safe | 13 | `plugSeating.test.ts` "a matching plug that is only partly in says it is never safe" |
| 2 Stylized spacing distinct across families; real dimensions cited | 12, 16, 17 | `plugging.test.ts` pattern overlap test; evidence (Task 0) |
| 3 Mains never enters the DC solver; DC rules skip mains pins; both ends of every source edge gated | 5 | `mains.test.ts` "a battery whose return is on mains adds nothing to the potential solver", "an I/O pin wired to mains gets no DC finding" |
| 3 Rule 1 | 6 | `mainsRules.test.ts` rule 1 tests, with the energizing path asserted |
| 3 Rule 2 | 6 | `mainsRules.test.ts` rule 2 tests |
| 3 Rule 3 matrix (L-L, L-N, L-PE, N-PE errors; N-N warning; PE-PE allowed) | 6 | `mainsRules.test.ts` rule 3 tests |
| 3 Rule 4, and "not checked" for a load without a range | 7 | `mainsRules.test.ts` rule 4 tests |
| 3 Rule 5 | 7 | `mainsRules.test.ts` rule 5 tests |
| 3 Rule 6, uncertainty on unpolarized outlets reported (Resolution 22) | 9 | `mainsRules.test.ts` rule 6 tests including "on an unpolarized outlet the uncertainty is reported" |
| 3 Rule 7 | 8, 9 | `mainsRules.test.ts` rule 7 tests, with the protective path asserted |
| 3 Rule 8 | 7, 10 | `mainsRules.test.ts` rule 8 tests |
| 3 Rule 9 | 10 | `mainsRules.test.ts` rule 9 tests |
| 3 Rule 10, the spec's wording, no adapter advice | 13 | `plugSeating.test.ts` "a plug over an outlet of another family: plug-mismatch, in the spec's words"; `mainsCircuits.test.ts` "US charger over a UK outlet" |
| 3 Rule 11 | 5 | `mains.test.ts` |
| 3 Rule 12 | 7 | `mainsRules.test.ts` rule 12 tests |
| 3 Rule 13, sources counted accurately | 10 | `mainsRules.test.ts` "17 contact groups", "more than 10 AC sources"; `mains.test.ts` "nothing is claimed unpowered without proof" |
| 3 Same finding shape; path findings highlight the path | 5 to 10 | `mainsRules.test.ts` path assertions (OFF SSR chain, S1-K1 short, switched PE loop) |
| 4 Every part's pins, contacts, profiles, ratings and isolation sourced and verified | 0, 16 to 20 | `mainsEvidence.test.ts` (every value quoted); `mainsParts.test.ts` against evidence and standards; controller review (Step 8 of each batch) |
| 4 Outlets | 16 | `mainsParts.test.ts` built-in outlets |
| 4 Plug-in devices per family | 17 | `mainsParts.test.ts` built-in plug-in devices (seating against `plugSpec.testing.ts`) |
| 4 AC-DC modules, lamp holders, fuse holder, KCD1, Wago | 18 | `mainsParts.test.ts` |
| 4 Terminal blocks, exact Phoenix part numbers, clones unverified | 19 | `mainsParts.test.ts` Phoenix item numbers pinned; clones non-empty and unverified |
| 4 Relay module contact states and unverified rating; Fotek SSR | 20 | `mainsParts.test.ts` relay module and SSR |
| 4 Designators, no prefix steals another's ids | 15 | `ops.test.ts` "gives each mains family its prefix", "numbers each prefix on its own" |
| 5 Identity colours by region; green-yellow stroke; new wire takes its identity colour; the user can change it | 21 | `mainsLook.test.ts`; `check:mains-ui` |
| 5 Hazard outline and lightning markers | 21 | `mainsLook.test.ts` sheet render; `check:mains-ui` |
| 5 Sticker-style realistic faces | 16 to 20 | screenshots looked at (Step 6 of each batch); controller review |
| 6 Notice in the Problems panel and toolbar badge, verbatim, for any mains part | 22 | `mainsNotice.test.ts`; `check:mains-ui` |
| 6 Empty state, never beside an incomplete or unknown result | 22 | `mainsNotice.test.ts` |
| 6 Notice whole in every export and in exported JSON; PRD | 22 | `mainsNotice.test.ts` (footer measured, JSON notes); `check:mains-ui` (print, export) |
| 7 Loader cases | 1 | `diagram.test.ts` |
| 7 The spec's circuits | 20 | `mainsCircuits.test.ts` (expectations as Michael decides at Task 0 where the evidence disagrees) |
| 7 Performance at 16 groups within a set budget; checker off the drag path; one analysis per edit | 5, 11, 24 | `mains.perf.test.ts` checkpoint and full sheet; `mains.test.ts` cache identity; `perf-breadboard.mjs` |
| 7 Browser check `check:mains-ui` | 23 | the script itself, light and dark screenshots looked at |
| 7 Independent review of every part; Astra reviews the build | 0, 16 to 20, 24 | controller reviews; `consult-astra` in Task 24 Step 5 |

## Spec gaps and ambiguities resolved in this plan

All binding decisions are the numbered Resolutions at the top (1 to 28). Revision 2 added 22 to 28 from Astra's plan review: polarity uncertainty on unpolarized outlets is reported (22); the notice appears for any mains part (23); state witnesses are minimal and complete (24); enumeration runs per possible-connectivity component with the spec's 16-group limit counted across the sheet (25); an unverified isolation class counts with a warning (26); a converter's pins outside every domain are live and named (27); an empty fuse holder is blamed only when proven (28). Resolutions 10, 11, 14, 19, 20 and 21 were adjusted as Astra ruled.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-27-mains-outlets.md`. Two execution options:

1. Subagent-Driven (recommended): a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: superpowers:subagent-driven-development.
2. Inline Execution: tasks in one session with checkpoints. Required sub-skill: superpowers:executing-plans.
