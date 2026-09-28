# Wall outlets and mains parts: design (revision 6)

Status: sections approved by Michael (2026-09-26/27); he chose the full mains checker now. Revision 2 answered Astra's first review, revision 3 its second (10 findings and code contracts), revision 4 its third (5 findings: protective separation, complete state candidates, protective-conductor roles, rating relevance versus adequacy, conflicting converter inputs), revision 5 its fourth (parallel protective paths), revision 6 the final review (below). First of five V2 sub-projects (then: simulation core on ngspice WASM, instruments, V3 animations, firmware).

Revision 6 (2026-09-28, final review rulings; details in .superpowers/sdd/2026-09-27-mains-outlets/final-fixes-report.md):
1. Rule 9 (cables and breadboard strips) judges wiring on mains in the narrow sense (L or N identity, or energy that crossed no isolation barrier) plus protective conductors. A net live only across an inadequate barrier gets no cable finding, since rule 1 already reports it. In a unit that was not enumerated, rule 1 does not run, so rule 9 keeps the conservative hazard there.
2. The narrow set includes undeclared-conduction edges between a part's own mains terminals. It excludes a converter's uncovered pins (Resolution 27) and energy that crossed a barrier and then goes on through a load.
3. Rule 8 exempts a converter only when it is seated in its outlet and nothing is wired to its input pins. The plug-in flag alone never exempts, and wiring behind a cord plug is still judged.
4. Energized PE with PE identity (a load from L to earth, say) is left to the other rules, which already report it.
5. The new `live-prong` rule uses the broad hazard: a bare prong is dangerous whatever the path.
6. The enumeration limits apply per unit (section 1.5). Only an oversized unit is reported `mains-incomplete`, each with its own finding, whose id includes the unit's part uids.

## Goal
Let hobbyists draw how their project meets the wall: chargers and adapters plugged into real outlets, AC-DC modules on mains, a relay or SSR switching a lamp, mains wires landed on terminal blocks. Draw it truthfully and catch the dangerous mistakes: mains reaching low-voltage wiring, shorts, crossed sources, wrong voltage, earth faults, unprotected paths, unsuitable cables, wrong polarity, plugs that do not fit.

Never overclaim. Circuitoon checks the drawn connections against the data it has; it cannot check current, insulation, creepage, enclosures or local codes. Where the data is missing or a check could not finish, the finding says "unknown" or "not checked", never "fine" (section 6).

Out of scope: AC simulation, waveforms and phase (V2); current-based rules (V2); split-feed and switched duplex outlets (named exclusions).

## 1. Electrical model

### 1.1 AC sources
- A module declares sources: `electrical.acSources: [{ id, live: terminal[], neutral: terminal[], earth?: terminal[] }]` (a terminal is a pin or hole group). Outlets are the only built-in sources; each outlet instance is its own source with unknown phase relative to others.
- A source's voltage is the part's `acVoltage` value: a new param, unit `VAC`, nominal RMS line to neutral, valid 1 to 1000, default the region's nominal (US 120, EU/UK/AU 230, JP 100), editable. It is a separate param from DC `voltage`, so PARAM_RULES keeps one unit per param (`voltage` stays `V`). Frequency is display data (`electrical.ac.hz`).
- An AC input's accepted range is a requirement, never a source amplitude.

### 1.2 The conduction graph
All mains reasoning runs on one graph whose nodes are terminals and whose edges are typed:
- `zero`: wires, internal joins, terminal block positions (header side to plug side), Wago positions (all one node), mated plug contacts, closed switch and relay contacts.
- `protective`: a fuse element or integral plug fuse between two named terminals (section 1.7). Conducts like `zero` when fitted, is open when absent.
- `load`: a declared two-terminal load (lamp filament, heater): `electrical.conducts: [{ pins: [a, b], kind: "load" }]`.
- `leakage`: an OFF SSR's load side, or any declared leakage path: `electrical.conducts: [{ pins, kind: "leakage" }]`.
- `isolated`: across a declared isolation barrier (section 1.3); never conducts identity or energization when isolation is adequate.
Every module with mains terminals must declare how its mains terminals conduct; a mains terminal with no declaration is treated conservatively (energization passes to every other mains terminal of that module) and gets a `data-missing` finding (section 3, rule 12).

- Identity: each node's set of `{ source, conductor: L | N | PE }`, the closure over `zero` and fitted `protective` edges from the source terminals.
- Energization: the closure from every L-identity node over `zero`, `protective`, `load` and `leakage` edges (transitively: energization received through a load or leakage continues through whatever follows). A node is hazardous if it has L or N identity or is energized.
- Terminal requirements (no labels): `mains: "L" | "N" | "PE" | "line"` on prongs, leads and load terminals drives polarity and earth rules only.

### 1.3 Isolation domains
- `electrical.domains: [{ name, pins, kind: "mains" | "selv" | "pelv" }]` and `electrical.isolation: "reinforced" | "double" | "basic" | "none" | "unknown"` between the mains domain and each other domain, from the datasheet.
- Protective separation is required for both SELV and PELV: `reinforced` or `double` isolation, or `basic` plus a declared additional safeguard (`electrical.safeguard: "protective-screen"`, from the datasheet). Earthing never substitutes for it.
- Classification of a secondary: protective separation and no PE bond: SELV. Protective separation and an intentional PE bond (a pin with `bond: "pe"` joined to PE identity): PELV. `basic` without a declared safeguard: inadequately separated, bonded or not (rule 1). `none` or `unknown`: hazardous.
- PELV keeps all DC checks; it differs from SELV only in the earth rules.
- Power availability of a converter: it declares an input pair (`electrical.acInput: { a, b, range }`). In a given contact state the converter is **powered** only when a's identity set is exactly one conductor of one source and b's is exactly the complementary conductor (L and N) of the same source, in either order, both through `zero` and fitted `protective` edges only (not `load` or `leakage`), with no other identity on either input, and the source voltage is inside the range. Shorted inputs (both holding L and N), mixed sources or extra identities are **unknown**, never powered; **unpowered** when neither input has any identity or energization; **unknown** otherwise (one input only, L and L, cross-source, leakage only). Only a powered converter's outputs are DC sources. This gates the checker's `sourceOf` and the no-power rule's passive-feed allowance (src/format/checks.ts:281-292, 306, 514-516): an output of an unpowered or unknown converter never feeds anything. no-power says "PS1 has no mains input" only when unpowered, and "PS1's mains input is not a complete connection (…)" when unknown.

### 1.4 Ratings and capability
- `electrical.ratings: [{ pins, kind: "insulation" | "terminal" | "switching", service: "ac" | "dc" | "ac/dc", volts, amps?, provenance: "datasheet" | "unverified", conditions?: string }]`.
- Relevance first, adequacy second. A rating is relevant to a terminal on a hazardous node when its service is `ac` or `ac/dc` and its kind fits the use (insulation or terminal for passive terminals, switching for contacts that switch mains; a converter's declared input range is relevant to its input pair). Adequacy is checked separately: relevant rating volts at least the source voltage.
- Each terminal on a hazardous node falls in exactly one class:
  - adequate relevant rating: mains-capable, no finding (plus provenance and conditions below);
  - relevant rating that is inadequate (a 125 VAC terminal on 230 VAC): `mains-rating` error (rule 5), not rule 1;
  - no relevant rating, but the terminal is declared for mains (in a mains domain, has a `mains` requirement, or has a rating of another service): `rating-unknown` warning, not rule 1;
  - no mains declaration at all (an ordinary low-voltage pin): rule 1 error.
- `conditions` that the drawing cannot confirm (Phoenix ratings depend on insulation conditions) produce a `rating-conditional` warning naming the condition; `unverified` provenance produces `rating-unverified`.
- Provenance is per exact assembly: Phoenix parts cite exact Phoenix part numbers; clones and generic relay modules are `unverified` (the Songle contact rating is recorded as the relay's switching rating, not the module's insulation).

### 1.5 Contact states (exhaustive or honestly incomplete)
- `electrical.contacts: [{ id, kind: "switch" | "relay" | "ssr", poles: [{ com, no?, nc? }] }]`. A relay pole connects COM-NC released and COM-NO energized, never both; linked poles switch together; poles are separate from each other and from the coil. An SSR's OFF state is a `leakage` edge.
- Candidate groups come from a state-independent possible-connectivity graph: every contact position of every group conducting at once, plus all other edges. A group is a candidate if any of its contacts lies in a possible-connectivity component that contains a source terminal or a converter input. This set cannot miss a switch in the middle of a chain. - The limits apply per enumeration unit, never to the whole sheet. A unit is a possible-connectivity component with a source terminal or converter input, merged with the components that one multi-pole group, one class 1 part, one bonded part's secondary and bonds, or one unseated plug's prongs span (Resolution 25). Units cannot affect each other, so each unit's states are enumerated on their own, and each unit numbers its own sources.
- Within a unit, the checker enumerates every state combination of its candidates: with up to 16 candidate groups (65,536 states) and up to 10 AC sources (the 30-bit identity mask) it is exhaustive. A room of many outlets is still checked when each unit stays within the limits.
- Only an oversized unit (past either limit) is not enumerated. It does not sample: it reports its own `mains-incomplete` finding ("Mains checks did not finish: 17 switches and relays. ... Split the drawing or check the rest by hand."), which lists what was not checked, and the empty-state wording never claims the sheet is clean. No per-state rule runs in that unit; its nodes take the conservative hazard (everything a source's L or N could reach). Every other unit is checked in full.
- Findings name the state that produces them ("when S1 and S2 are both on").

### 1.6 Earth
- Loads declare `electrical.protection: "class-1" | "class-2"`; class 1 loads name their PE terminal. Cord plugs come as 3-lead and 2-lead (class II).
- `bond: "pe"` marks an intentional bond (metal enclosure, class 1 supply secondary). Undeclared joins of DC ground to PE warn.
- Protective conductors are every wire and edge on any path, in the possible-connectivity graph (all contact positions conducting), between a source's PE contact and a protective terminal (a class 1 load's PE terminal or a declared `bond: "pe"` pin), where the path passes only through wires, mated contacts, terminal blocks, Wago connectors, contacts, protective edges and PE terminals, never through an ordinary low-voltage pin of another part. Parallel and redundant paths are all included, so two thin wires in parallel or a switched branch beside a permanent one are both checked. A functional DC ground that reaches PE only through a part's DC pin (for example an ESP32 GND joined to a bonded supply minus) is not a protective conductor. The cable rule (section 1.8) and the PE-path-through-a-switch rule apply to protective conductors only.

### 1.7 Protective devices
- Fuse holders declare their protective edge (`electrical.protective: [{ from, to, kind: "fuse" }]`) and two part settings: `fuseRating` (new param, unit `A`, optional: missing means unknown) and a fitted state.
- New part-instance field `settings?: Record<string, string>` for enumerated choices, validated against `electrical.settings: { fuse: ["fitted", "absent"] }` on the module; default `fitted`. The loader drops invalid settings with a warning. (Distinct from the existing numeric `values`.)
- UK plug-in devices and cord plugs declare their integral BS 1362 fuse as a protective edge between the L prong and the device's internal L, with its rating.
- Outlets are assumed to sit on a branch-circuit breaker; rule 8 protects the project's own wiring.

### 1.8 Cables
- The cable rule applies to every wire on a hazardous node and every protective conductor (section 1.6), not to functional DC grounds joined to a bonded minus.
- Error (clearly unsuitable): ends `dupont-*`, `alligator`, `jst-*`, `grove`, `banana`, `solid-jumper`, or gauge 24 AWG or thinner.
- Warning `cable-unverified` for everything else: Circuitoon cannot know insulation or assembly ratings. The message states the supported-model assumption plainly ("Use a cable rated for mains, such as an approved cord of 0.75 mm2 or 18 AWG or thicker, with stripped or ferrule ends"), not as a universal requirement.

## 2. Plugging
- A plug-in device declares mating profiles: `electrical.plug: { profiles: [{ id, contacts: [{ pin, at: { x, y }, mains }] }] }`. Only a profile's contacts are mount legs; other pins stay ordinary pins (a change to the mount code: plug points come from the chosen profile).
- An outlet declares socket instances: `sockets: [{ id, family, contacts: [{ group, role: "L" | "N" | "PE" }] }]`; every hole group belongs to one socket; seating never collects contacts across sockets.
- A code-side compatibility table lists, per (plug family, socket family): the plug profile used, the allowed orientations (0 only, or 0 and 180), and the contact mapping per orientation. Seating requires a table entry, every contact of that profile on a contact of one socket, and an allowed orientation. The mapping feeds identity.
- Table (tested pairwise, all four rotations): NEMA 5-15P in 5-15R and 5-20R (0 only); 1-15P polarized in 1-15R polarized, 5-15R, 5-20R (0 only); 1-15P unpolarized in 1-15R, 5-15R, 5-20R (0 and 180); Japan outlets as 1-15R unpolarized (JIS C 8303) with a polarized variant; CEE 7/7 in CEE 7/3 via its earth-clip profile (0 and 180) and in CEE 7/5 via its earth-hole profile (0 only, the socket's pin polarizes it); Europlug CEE 7/16 in CEE 7/3, 7/5 and 7/16 sockets (0 and 180, no earth); BS 1363 and AS/NZS 3112 in their own only (0 only).
- Existing behaviour stays: obscured and partial mounts plug nothing, invalid mounts are not carried; a partial mount is never electrically safe (`plug-mismatch` says so).
- Stylized on-grid spacing keeps each family's contact pattern distinct and overlapping only where the table allows; real dimensions cited in the generators.

## 3. Checker rules (src/format/checks.ts; same finding shape; diagram-edit wording; path findings highlight the path)
Mains nodes never enter the DC potential solver; DC rules skip AC and mains pins.
1. `mains-to-low-voltage` (error): a hazardous node contains an ordinary low-voltage terminal (section 1.4, last class), a SELV or PELV pin, or a secondary without protective separation (section 1.3); or an AC rail meets a DC pin.
2. `mains-short` (error): in some state, a node's identity holds L and N of one source, or L and PE of one source.
3. Cross-source matrix (sources a and b differ): L-L error (unknown phase); L-N error; L-PE error; N-PE error; N-N warning (shared neutral); PE-PE allowed (shared earth).
4. `mains-voltage` (error): a load's or converter's accepted range excludes its source's voltage.
5. `mains-rating` (error): a relevant rating that is inadequate for the source voltage; `rating-unknown`, `rating-conditional`, `rating-unverified` (warnings) per section 1.4.
6. `polarity` (warning): a requirement violated: lamp shell (N) on L identity, a single-pole switch or fuse in the N path instead of L, a polarized profile mapped against its requirement by wiring.
7. `earth` (error unless noted): a class 1 load's PE terminal without PE identity; a protective conductor passing through a switch, relay, fuse or protective edge; N identity joined to PE beyond the outlet; DC ground joined to PE without a declared bond (warning).
8. `unprotected` (warning): a cut-set check per state over paths from a source's L to each load's L-side terminal through the project's wiring beyond the plug: removing every fitted protective edge must disconnect it. Absent fuse: its edge is open (and the load then gets no-power-style findings). Fitted fuse with unknown rating: `fuse-rating-unknown` warning. A UK integral plug fuse counts for everything behind it; plug-in status alone never exempts wiring behind a device.
9. `mains-cable` (error) and `cable-unverified` (warning): section 1.8, on wires of hazardous nodes and on protective conductors (section 1.6).
10. `plug-mismatch` (warning): a plug-in device overlapping a socket it cannot seat in. "XP1's UK plug does not fit XS1's US socket. Use a device with a US plug." No adapter advice.
11. Converter availability (section 1.3): outputs of unpowered or unknown converters feed nothing; messages give the reason.
12. `data-missing` (warning): a mains terminal of a module without conduction, rating or domain data; checks involving it are conservative and say so.
13. `mains-incomplete` (warning): state enumeration did not finish for an oversized unit, one finding per such unit (section 1.5).

## 4. Parts (category Mains; generators; every pin, contact, profile, rating and isolation claim sourced to an exact manufacturer part or standard, independently verified; SSR data from the exact current Fotek revision)
- Outlets (intact-link duplex only): US NEMA 5-15R and 5-20R duplex; UK BS 1363 single; Schuko CEE 7/3 single; French CEE 7/5 single; AU/NZ AS/NZS 3112 single; Japan 1-15R duplex unpolarized and a polarized variant.
- Plug-in devices per family: USB wall charger 5 V; barrel-jack adapter (`voltage` bound to its + output, `acInput` 100-240 VAC, isolation per its reference datasheet); cord plugs 3-lead and 2-lead; class and plug fuse declared per region.
- AC-DC modules: HLK-PM01 (5 V), HLK-PM03 (3.3 V), with `acInput`, domains, isolation and ratings from the Hi-Link datasheets.
- Loads and wiring: lamp holders E26 (120 V) and E27 (230 V) with conduction, requirements and class from a named reference product; inline 5x20 mm fuse holder (protective edge, `fuseRating`, fitted setting); KCD1 rocker (switching rating per datasheet); Wago 221-412, 221-413, 221-415.
- Terminal blocks: Phoenix Contact MSTB 2,5 (5.08 mm) and MC 1,5 (3.81 mm), 2-6 positions, exact part numbers, ratings and conditions; 2EDG/KF2EDG clones and KF301/DG301 as `unverified`.
- Relays: the existing relay module gets contact states and an `unverified` module rating; Fotek SSR-25DA (4-32 VDC control per the current Fotek data, load rating, derating and off-state leakage noted).
- Designators: outlets `XS`, plugs `XP`, converters and adapters `PS`, lamps `E`, fuses `F`, switches `S`, relays and SSRs `K`, terminal blocks and Wago `X`; no prefix steals another's ids (tested).

## 5. Look
- Wires on hazardous and PE nodes default to the source region's colours by identity (US and Japan: L black, N white, PE green; EU, UK and AU: L brown, N blue, PE green-yellow as a two-colour stroke). A new wire from a mains terminal takes its identity's colour; the user can change it.
- A thin hazard outline on energized wires and a small lightning marker near each end. Outlets and mains parts in the Sticker style with realistic faces.

## 6. Honesty in the product
- A sheet with any mains part shows a persistent notice in the Problems panel and a toolbar badge: "Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person."
- The empty state becomes "No problems found in the drawn connections." It is never shown when a `mains-incomplete`, `data-missing` or `unknown` result exists; those list what was not checked.
- The notice is drawn into every export (image, print, PDF) and stored in exported JSON as a sheet note. The PRD gains the matching statement.

## 7. Tests and checks
- Per-part geometry against the cited standards (relative contact positions), module validation (new fields: acSources, conducts, protective, domains, isolation, acInput, ratings, contacts, protection, plug profiles, sockets, settings), `check:gen`.
- Loader: `acVoltage` and `fuseRating` params, `settings`, bad values warned and dropped.
- Compatibility matrix: every plug family against every socket family and profile, all four rotations, translations, occupied sockets, overlapping outlets, breadboards nearby, contacts spread across two sockets (never seats), CEE 7/7 in 7/3 both orientations and in 7/5 one orientation.
- Each rule both ways and Astra's counterexamples from both reviews: reversed Schuko plug (no false short); polarized lamp reversed (polarity, not short); L-L across outlets; relay COM-NO and COM-NC both wired (each state, no impossible short); two switches in series closing a short with seven or more other groups present (found); 17 contact groups (mains-incomplete, no clean claim); OFF SSR into a lamp into a GPIO (hazard reaches the GPIO); basic-isolation secondary to a GPIO (error, bonded or not); basic plus a declared protective screen and PE bond (PELV, allowed, DC checks kept); reinforced with a PE bond (PELV); three switches in series L-S1-S2-S3-N with S2 touching neither end (found via possible connectivity); an ESP32 26 AWG Dupont ground to a PE-bonded supply minus (no mains-cable finding); two parallel 26 AWG Dupont PE wires to a class 1 lamp (mains-cable on both); a switched PE branch parallel to a permanent PE wire (earth: protective conductor through a switch); converter inputs shorted together or fed from two outlets (unknown, outputs dead); 125 VAC terminal on 230 VAC (mains-rating, not rule 1); mains-domain terminal with no rating (rating-unknown, not rule 1); two class 1 supplies with PE-bonded minus leads joined (no cross-source error); Dupont PE lead on a class 1 lamp (mains-cable); 300 VDC-only terminal on 230 VAC (rating); conditional Phoenix rating (rating-conditional); empty fuse holder vs fitted with unknown rating; fuse on one branch with a bypass (unprotected); UK fused plug protecting a cord-wired lamp (clean); converter with inputs L and L (unknown availability, no DC conclusions); HLK-PM01 unpowered.
- Circuits: relay switching a fused lamp from a US outlet with stripped 18 AWG wires (only the relay module's unverified-rating and cable-unverified warnings); HLK-PM01 feeding an ESP32 (clean apart from cable-unverified); US charger over a UK outlet (does not seat; plug-mismatch).
- Performance: exhaustive enumeration at 16 groups on a realistic sheet within an interactive budget (measured; the plan sets the number), with the checker off the drag path as today.
- Browser check `check:mains-ui`: seat plugs in allowed orientations, a wrong plug (red), identity-coloured mains wires with the hazard look, the notice on screen and in export; light and dark screenshots, looked at.
- Independent pinout, rating and isolation review of every part; Astra reviews this spec, the plan, and the build before shipping.
