# Wall outlets and mains parts: design (revision 2)

Status: sections approved by Michael (2026-09-26/27). Revision 2 follows Astra's spec review (CHANGES NEEDED, 12 findings) and Michael's choice to build the full mains checker now rather than in phases. First of five V2 sub-projects (then: simulation core on ngspice WASM, instruments, V3 animations, firmware).

## Goal
Let hobbyists draw how their project meets the wall: a charger or wall adapter plugged into a real outlet, an AC-DC module on mains, a relay or SSR switching a lamp, mains wires landed on terminal blocks. Draw it truthfully, and catch the dangerous mistakes: mains reaching low-voltage wiring, shorts, crossed sources, wrong voltage, missing or interrupted earth, unprotected paths, unsuitable cables, wrong polarity, and plugs that do not fit.

Never overclaim. Circuitoon checks the drawn connections and the data we have; it cannot check current, insulation, creepage, enclosures or local codes. Section 6 makes that limit visible on screen and on every export.

Out of scope: AC simulation (V2 core), waveforms and phase (reserved for V2), current-based rules (need V2), split-feed and switched duplex outlets (named exclusions, section 4).

## 1. Electrical model

### 1.1 AC sources
- A source is declared by a module: `electrical.acSources: [{ id, live: pinOrGroup[], neutral: pinOrGroup[], earth?: pinOrGroup[] }]`. Outlets are the only built-in sources. A source's voltage is the part's `voltage` value (new unit `VAC`: nominal RMS, line to neutral), defaulting to the region's nominal (US 120, EU/UK/AU 230, JP 100) and editable, because a socket's shape does not fix its supply voltage.
- Every outlet instance is its own source with unknown phase relative to other sources. Frequency is display data (`electrical.ac.hz`).
- An AC input's accepted range (`100-240VAC` on an adapter) is a requirement, never a source amplitude.

### 1.2 Conductor identity comes from sources, not labels
- Every net gets a computed identity: the set of `{ source, conductor: L | N | PE }` it is joined to through zero-ohm paths (wires, internal joins, closed contacts, mated plug contacts, terminal blocks, Wago connectors, fuses).
- Plug prongs, cord leads and load terminals carry no conductor label. Instead a terminal may declare a requirement: `mains: "L" | "N" | "PE" | "line"`. `line` means either live or neutral (unpolarized); `L` or `N` means the device expects that conductor (the shell of a lamp holder expects N, a switched pole expects L); `PE` marks a protective-earth terminal.
- Plug reversal therefore cannot fool a rule: rules read identities, and requirements only drive polarity and earth rules.
- Energization is separate from zero-ohm identity. A two-terminal mains load (lamp, heater element) passes hazard but is not a short: its far terminal is "energized from L" if its near terminal has L identity. Hazard rules use energization; short rules use identity.

### 1.3 Isolation domains
- A module with both mains and low-voltage terminals declares `electrical.domains: [{ name, pins, kind: "mains" | "selv" }]` and `electrical.isolation: "reinforced" | "basic" | "none" | "unknown"` between them.
- AC-DC modules and wall adapters: primary mains, secondary SELV, isolation per datasheet (HLK-PM01/PM03: reinforced per Hi-Link datasheet, to be verified). SSR: control SELV, load mains, isolation per datasheet. A module with isolation `none` or `unknown` makes its secondary hazardous.
- A secondary DC output is a DC source (existing checker model) only when its primary is connected to a source whose voltage is within the input range; otherwise the output is unpowered (no DC voltage conclusions from it).
- A secondary that is intentionally bonded to PE (a pin declared `bond: "pe"`, e.g. a class I supply's output minus) is still checked as SELV.

### 1.4 Mains capability and ratings (separate things)
- A terminal is mains-capable if it is in a module's `mains` domain or has a rating: `electrical.ratings: [{ pins, volts, amps, kind: "ac" | "dc" | "ac/dc", provenance: "datasheet" | "unverified", conditions?: string }]`.
- An AC rating does not mean AC-only; `ac/dc` and conditions (Phoenix ratings depend on insulation conditions) are recorded as given by the manufacturer.
- Provenance is per exact assembly: Phoenix MSTB and MC parts cite their Phoenix datasheet; 2EDG/KF2EDG clones and generic relay modules are `unverified` (a bare relay's contact rating does not rate the whole module's insulation and terminals).
- Hole groups (sockets) take ratings like pins.

### 1.5 Contact states
- Modules with contacts declare them: `electrical.contacts: [{ id, kind: "switch" | "relay" | "ssr", poles: [{ com, no?, nc? }], states: string[] }]`. A relay pole connects COM to NC when released and COM to NO when energized, never both. Linked poles switch together; poles are electrically separate from each other and from the coil.
- The checker evaluates each state combination of the sheet's contact groups separately (all combinations when there are 8 or fewer groups; otherwise each group toggled alone from the all-default state) and reports a finding once, naming the state ("when K1 is energized").
- An SSR's OFF state is not isolation: its load side still passes leakage, so energization flows through an OFF SSR (hazard rules) but identity does not (short rules).
- Wago lever connectors: all positions one node. Terminal blocks: each position joins its header side to its plug side; adjacent positions stay separate.

### 1.6 Protection class and earth
- Mains loads declare `electrical.protection: "class-1" | "class-2"`; class 1 loads name their PE terminal. Cord plugs come in two variants: 3-lead (with PE) and 2-lead (class II only).
- Pins may declare `bond: "pe"` for an intentional bond (metal enclosure, class I supply secondary). Undeclared joins of DC ground to PE warn.

### 1.7 Protective devices
- A fuse holder has a `current` value (new param, unit `A`), empty meaning "no fuse fitted or rating unknown". UK plug-in devices and cord plugs declare an integral plug fuse (`electrical.plugFuse: { amps }`, BS 1362).
- Outlets are assumed to be on a branch-circuit breaker; the fuse rule protects the project's own wiring beyond the plug.

### 1.8 Cables on hazardous nets
- Wire suitability is checked independently of terminal ratings: on any energized net, a wire's ends must be `bare`, `stripped` or `ferrule`, and its gauge 18 AWG or thicker. Colour and gauge never prove insulation; the rule only rejects what is clearly unsuitable.

## 2. Plugging
- Plug-in devices declare their mating contacts explicitly: `electrical.plug: { family, contacts: [{ pin, at: { x, y }, mains }], orientation: "polarized" | "reversible" }`. Only these contacts are mount legs; every other pin (DC outputs, loose leads) stays an ordinary pin. This is a change to the mount code (plug points come from `plug.contacts` when present).
- Outlets declare socket instances: `sockets: [{ id, family, contacts: [{ group, role: "L" | "N" | "PE" }] }]`. Hole groups belong to exactly one socket; seating never collects contacts across sockets.
- Seating a plug requires: a family compatible with the socket's family (code-side table, verified from the standards), every mating contact on a contact of that single socket, and an orientation the plug allows (reversible plugs seat at 0 and 180 degrees relative to the socket, polarized plugs only at 0; 90 degrees never seats). The mapping from plug contacts to socket contacts, per orientation, feeds identity (section 1.2).
- Compatibility table (tested pairwise, all rotations): NEMA 5-15P fits 5-15R and 5-20R; NEMA 1-15P polarized fits 1-15R polarized, 5-15R and 5-20R; 1-15P unpolarized fits 1-15R, 5-15R and 5-20R; Japanese outlets are modeled as 1-15R unpolarized (JIS C 8303 two-pole) with an explicit polarized variant; CEE 7/7 fits CEE 7/3 and 7/5; Europlug CEE 7/16 fits CEE 7/3, 7/5 and 7/16 sockets; BS 1363 and AS/NZS 3112 fit only their own.
- Existing mount behaviour stays: obscured and partial mounts plug nothing, invalid mounts are not carried. A partial mount is never electrically safe; `plug-mismatch` says so.
- Stylized on-grid spacing keeps each family's contact pattern distinct and overlapping only where real plugs fit; real dimensions are cited in the generators.

## 3. Checker rules (src/format/checks.ts; same finding shape; messages describe diagram edits, never work on live equipment)
A net is hazardous if it has L or N identity or is energized from L. Mains nets never enter the DC potential solver; DC rules skip AC and mains pins.
1. `mains-to-low-voltage` (error): a hazardous net contains a pin that is not mains-capable, a SELV pin, or an AC rail meets a DC pin. Also a secondary of a module with isolation `none` or `unknown` wired to low-voltage parts.
2. `mains-short` (error): a net's identity holds L and N of one source, or L and PE of one source, in some contact state. The message names the path ("the path from XS1 L through S1 and F1 to XS1 N") and highlights it.
3. `sources-joined` (error): conductors of two different sources in one net (L with L: unknown phase; L with N: cross short). Neutrals of two sources joined: warning (shared neutral).
4. `mains-voltage` (error): a load's accepted AC range excludes its source's voltage; unknown source: no finding.
5. `mains-rating` (error): a rated part carries a hazardous net above its rated volts; `unverified` provenance: warning ("this module's mains rating is not verified; use a certified module").
6. `polarity` (warning): a requirement is violated: lamp shell (N requirement) on L, a single-pole switch or fuse in the N path instead of L, a polarized plug's contacts mapped wrongly by wiring.
7. `earth` (error unless noted): a class 1 load's PE terminal has no PE identity; the PE path passes through a switch, fuse or relay contact; N joined to PE beyond the outlet; DC ground joined to PE without a declared bond (warning).
8. `unprotected` (warning): some path from a source's L to a load's L-side terminal through the project's wiring (beyond the plug) has no fuse on it (checked as a cut set: removing every fuse on the path set must disconnect it), or the fuse's rating is unknown ("fuse rating unknown"). A UK fused plug counts for everything behind it. Plug-in status alone does not exempt hard-wired circuitry behind the device.
9. `mains-cable` (error): an unsuitable wire on an energized net (section 1.8): "In the diagram, the wire from XS1 L to X1 1 uses Dupont ends and 26 AWG; mains needs stripped or ferrule ends and 18 AWG or thicker."
10. `plug-mismatch` (warning): a plug-in device overlapping a socket it cannot seat in: "XP1's UK plug does not fit XS1's US socket. Use a device with a US plug." No adapter advice.
11. Unpowered secondaries (section 1.3) feed no DC source; loads on them get the existing no-power finding with the reason ("PS1 has no mains input").

## 4. Parts (category Mains; generators; every pin, contact and rating sourced to an exact manufacturer part or standard, independently verified)
- Outlets (duplex outlets have intact links; split-feed and switched outlets are named exclusions): US NEMA 5-15R duplex and 5-20R duplex; UK BS 1363 single; Schuko CEE 7/3 single; French CEE 7/5 single; AU/NZ AS/NZS 3112 single; Japan 1-15R duplex (unpolarized) and a polarized variant.
- Plug-in devices per region family: USB wall charger 5 V; barrel-jack wall adapter (DC output as a `voltage` value bound with `voltageOutputs`, input 100-240 VAC, isolation per its reference datasheet); cord plugs, 3-lead and 2-lead, for hard-wiring. Class and plug fuse declared per region.
- AC-DC modules: HLK-PM01 (5 V) and HLK-PM03 (3.3 V).
- Loads and wiring: lamp in an E26 (120 V) and E27 (230 V) holder, class 1 with PE on metal-shell variants per the chosen reference product; inline 5x20 mm fuse holder with a `current` value; KCD1 mains rocker (rating per datasheet); Wago 221-412, 221-413, 221-415.
- Terminal blocks: Phoenix Contact MSTB 2,5 (5.08 mm) and MC 1,5 (3.81 mm), 2-6 positions, exact Phoenix part numbers and ratings with conditions; 2EDG/KF2EDG clones (unverified); KF301/DG301 fixed screw terminals (unverified).
- Relays: the existing relay module gets its contact states and an `unverified` module rating (the Songle contact rating is recorded as the relay's, not the module's); Fotek SSR-25DA with 4-32 VDC control and its load rating pinned to the exact current Fotek revision, with derating and off-state leakage noted in the source and in the SSR's findings.
- Designators: outlets `XS`, plugs and cord plugs `XP`, AC-DC modules and adapters `PS`, lamps `E`, fuses `F`, switches `S`, relays and SSRs `K`, terminal blocks and Wago `X`; no prefix steals another's ids (tested).

## 5. Look
- Wires on hazardous nets default to the source's regional colours by identity, not by terminal label (US and Japan: L black, N white, PE green; EU, UK and AU: L brown, N blue, PE green-yellow as a two-colour stroke). A new wire from a mains terminal takes the colour of its identity; the user can change it.
- A thin hazard outline on energized wires and a small lightning marker near each end. Outlets and mains parts in the Sticker style with realistic faces.

## 6. Honesty in the product
- Whenever a sheet has a mains part: a persistent notice in the Problems panel and a badge in the toolbar: "Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person." The empty state becomes "No problems found in the drawn connections."
- The same notice is drawn into every export (image, print, PDF) of a sheet with mains parts, and stored in exported JSON as a sheet note.
- PRD gains the matching statement.

## 7. Tests and checks
- Per-part geometry against the cited standards (relative contact positions), module validation, `check:gen`.
- Compatibility matrix: every plug family against every socket family, all four rotations, translations, occupied sockets, overlapping outlets, breadboards nearby, and contact matches spread across two sockets (must not seat).
- Each rule both ways, plus Astra's counterexamples: reversed Schuko plug (no false short; identities correct); polarized lamp wired reversed (polarity, not short); two outlets joined L to L (sources-joined); relay COM-NO and COM-NC both wired (no impossible short; each state checked); SSR OFF still energizing its load terminal; Dupont or 26 AWG wire on mains (mains-cable); class 1 lamp without PE (earth); PE through a switch (earth); a fuse on one branch with a bypass branch (unprotected); UK fused plug protecting a cord-wired lamp (clean); HLK-PM01 with no mains input (unpowered, no DC conclusions); non-isolated module secondary to a GPIO (mains-to-low-voltage).
- Circuits: relay switching a lamp from a US outlet with a fuse and 18 AWG stripped wires (clean apart from the relay module's unverified-rating warning); HLK-PM01 feeding an ESP32 (clean); US charger over a UK outlet (does not seat, plug-mismatch).
- Browser check `check:mains-ui`: seat a plug in both orientations, try a wrong plug (red), draw a mains wire (identity colours, hazard look), the mains notice on screen and in export; light and dark screenshots, looked at.
- Independent pinout and rating review of every part; Astra reviews this spec, the plan, and the build before shipping.
