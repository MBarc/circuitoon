# Wall outlets and mains parts: design (revision 3)

Status: sections approved by Michael (2026-09-26/27); he chose the full mains checker now. Revision 2 answered Astra's first review; revision 3 answers its second (10 findings) and pins the code contracts it flagged. First of five V2 sub-projects (then: simulation core on ngspice WASM, instruments, V3 animations, firmware).

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
- Classification of a secondary: `reinforced` or `double`: SELV. `basic`: acceptable only as PELV, meaning the secondary is bonded to PE (a pin with `bond: "pe"` joined to PE identity) and the module is class 1; otherwise the secondary is inadequately separated (rule 1). `none` or `unknown`: the secondary is hazardous.
- PELV (intentionally earthed extra-low voltage) keeps all DC checks; it differs from SELV only in the earth rules.
- Power availability of a converter: it declares an input pair (`electrical.acInput: { a, b, range }`). In a given contact state the converter is **powered** when a and b have zero-ohm identity (through `zero` and fitted `protective` edges only, not `load` or `leakage`) to L and N of the same source, in either order, and the source voltage is inside the range; **unpowered** when neither input has any identity or energization; **unknown** otherwise (one input only, L and L, cross-source, leakage only). Only a powered converter's outputs are DC sources. This gates the checker's `sourceOf` and the no-power rule's passive-feed allowance (src/format/checks.ts:281-292, 306, 514-516): an output of an unpowered or unknown converter never feeds anything. no-power says "PS1 has no mains input" only when unpowered, and "PS1's mains input is not a complete connection (…)" when unknown.

### 1.4 Ratings and capability
- `electrical.ratings: [{ pins, kind: "insulation" | "terminal" | "switching", service: "ac" | "dc" | "ac/dc", volts, amps?, provenance: "datasheet" | "unverified", conditions?: string }]`.
- A terminal is mains-capable for a given hazardous node only if it has an applicable rating: service `ac` or `ac/dc`, volts at least the source voltage, kind appropriate to its use (insulation or terminal for passive terminals; switching for contacts that switch mains). A converter's declared input range counts as the applicable rating for its input pair.
- `conditions` that the drawing cannot confirm (Phoenix ratings depend on insulation conditions) produce a `rating-conditional` warning naming the condition; they do not silently pass.
- `unverified` provenance: warning. Missing applicable rating on a terminal in a hazardous node: `rating-unknown` warning (a mains-domain terminal without a rating included).
- Provenance is per exact assembly: Phoenix parts cite exact Phoenix part numbers; clones and generic relay modules are `unverified` (the Songle contact rating is recorded as the relay's switching rating, not the module's insulation).

### 1.5 Contact states (exhaustive or honestly incomplete)
- `electrical.contacts: [{ id, kind: "switch" | "relay" | "ssr", poles: [{ com, no?, nc? }] }]`. A relay pole connects COM-NC released and COM-NO energized, never both; linked poles switch together; poles are separate from each other and from the coil. An SSR's OFF state is a `leakage` edge.
- The checker enumerates every state combination of the contact groups that touch a hazardous node or a converter input. Up to 16 such groups (65,536 states) it is exhaustive. Beyond that it does not sample: it reports a `mains-incomplete` finding ("Mains checks did not finish: 17 switches and relays. Split the drawing or check the rest by hand.") and the empty-state wording never claims the sheet is clean.
- Findings name the state that produces them ("when S1 and S2 are both on").

### 1.6 Earth
- Loads declare `electrical.protection: "class-1" | "class-2"`; class 1 loads name their PE terminal. Cord plugs come as 3-lead and 2-lead (class II).
- `bond: "pe"` marks an intentional bond (metal enclosure, class 1 supply secondary). Undeclared joins of DC ground to PE warn.

### 1.7 Protective devices
- Fuse holders declare their protective edge (`electrical.protective: [{ from, to, kind: "fuse" }]`) and two part settings: `fuseRating` (new param, unit `A`, optional: missing means unknown) and a fitted state.
- New part-instance field `settings?: Record<string, string>` for enumerated choices, validated against `electrical.settings: { fuse: ["fitted", "absent"] }` on the module; default `fitted`. The loader drops invalid settings with a warning. (Distinct from the existing numeric `values`.)
- UK plug-in devices and cord plugs declare their integral BS 1362 fuse as a protective edge between the L prong and the device's internal L, with its rating.
- Outlets are assumed to sit on a branch-circuit breaker; rule 8 protects the project's own wiring.

### 1.8 Cables
- The cable rule applies to every wire on a hazardous node and every wire on a PE-identity node.
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
1. `mains-to-low-voltage` (error): a hazardous node contains a terminal that is not mains-capable for it (section 1.4), a SELV or PELV pin, or a basic-isolation secondary without PELV conditions; or an AC rail meets a DC pin.
2. `mains-short` (error): in some state, a node's identity holds L and N of one source, or L and PE of one source.
3. Cross-source matrix (sources a and b differ): L-L error (unknown phase); L-N error; L-PE error; N-PE error; N-N warning (shared neutral); PE-PE allowed (shared earth).
4. `mains-voltage` (error): a load's or converter's accepted range excludes its source's voltage.
5. `mains-rating` (error): an applicable rating below the source voltage; `rating-conditional`, `rating-unverified`, `rating-unknown` (warnings) per section 1.4.
6. `polarity` (warning): a requirement violated: lamp shell (N) on L identity, a single-pole switch or fuse in the N path instead of L, a polarized profile mapped against its requirement by wiring.
7. `earth` (error unless noted): a class 1 load's PE terminal without PE identity; a PE path through a switch, relay, fuse or protective edge; N identity joined to PE beyond the outlet; DC ground joined to PE without a declared bond (warning); a basic-isolation secondary used as PELV without its bond (rule 1).
8. `unprotected` (warning): a cut-set check per state over paths from a source's L to each load's L-side terminal through the project's wiring beyond the plug: removing every fitted protective edge must disconnect it. Absent fuse: its edge is open (and the load then gets no-power-style findings). Fitted fuse with unknown rating: `fuse-rating-unknown` warning. A UK integral plug fuse counts for everything behind it; plug-in status alone never exempts wiring behind a device.
9. `mains-cable` (error) and `cable-unverified` (warning): section 1.8, on hazardous and PE nodes.
10. `plug-mismatch` (warning): a plug-in device overlapping a socket it cannot seat in. "XP1's UK plug does not fit XS1's US socket. Use a device with a US plug." No adapter advice.
11. Converter availability (section 1.3): outputs of unpowered or unknown converters feed nothing; messages give the reason.
12. `data-missing` (warning): a mains terminal of a module without conduction, rating or domain data; checks involving it are conservative and say so.
13. `mains-incomplete` (warning): state enumeration did not finish (section 1.5).

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
- Each rule both ways and Astra's counterexamples from both reviews: reversed Schuko plug (no false short); polarized lamp reversed (polarity, not short); L-L across outlets; relay COM-NO and COM-NC both wired (each state, no impossible short); two switches in series closing a short with seven or more other groups present (found); 17 contact groups (mains-incomplete, no clean claim); OFF SSR into a lamp into a GPIO (hazard reaches the GPIO); basic-isolation secondary to a GPIO without PELV (error) and with PE bond on a class 1 module (allowed, DC checks kept); two class 1 supplies with PE-bonded minus leads joined (no cross-source error); Dupont PE lead on a class 1 lamp (mains-cable); 300 VDC-only terminal on 230 VAC (rating); conditional Phoenix rating (rating-conditional); empty fuse holder vs fitted with unknown rating; fuse on one branch with a bypass (unprotected); UK fused plug protecting a cord-wired lamp (clean); converter with inputs L and L (unknown availability, no DC conclusions); HLK-PM01 unpowered.
- Circuits: relay switching a fused lamp from a US outlet with stripped 18 AWG wires (only the relay module's unverified-rating and cable-unverified warnings); HLK-PM01 feeding an ESP32 (clean apart from cable-unverified); US charger over a UK outlet (does not seat; plug-mismatch).
- Performance: exhaustive enumeration at 16 groups on a realistic sheet within an interactive budget (measured; the plan sets the number), with the checker off the drag path as today.
- Browser check `check:mains-ui`: seat plugs in allowed orientations, a wrong plug (red), identity-coloured mains wires with the hazard look, the notice on screen and in export; light and dark screenshots, looked at.
- Independent pinout, rating and isolation review of every part; Astra reviews this spec, the plan, and the build before shipping.
