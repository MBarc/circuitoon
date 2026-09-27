# Wall outlets and mains parts: design

Status: design approved in sections by Michael (2026-09-26/27): outlets for all regions, plug-in devices that seat like breadboard parts, hard-wired mains parts, Phoenix-style terminal blocks, and mains checker rules. First of five V2 sub-projects (then: simulation core on ngspice WASM, instruments, V3 animations, firmware).

## Goal
Let hobbyists draw how their project meets the wall: a charger or wall adapter plugged into a real outlet, an AC-DC module on mains, a relay or SSR switching a lamp, mains wires landed on terminal blocks. Draw it truthfully, and catch the dangerous mistakes: mains touching low-voltage wiring, live shorted to neutral or earth, the wrong mains voltage, ratings exceeded, a plug from another region.

Out of scope: simulating AC (V2 core); wiring advice beyond the rules below. Circuitoon is not an electrical code tool; the PRD states that mains work needs a qualified person where local rules require it.

## 1. Data model

### 1.1 AC supplies
Supply strings gain an AC form: `120VAC`, `230VAC`, `100VAC`, and ranges `100-240VAC`. A pin whose supply is AC is an AC pin. `parseSupply` returns a kind (`ac` or `dc`) with its rails or range. The DC checker ignores AC pins. An AC rail on a DC-only pin, or a DC source on a mains-only pin, is always an error (rule 1 below). Outlets declare frequency in `electrical.ac: { volts, hz }` (display only for now).

### 1.2 Mains roles
New optional pin field `mains: "live" | "neutral" | "earth"` on outlet terminals and sockets, plug prongs, cord leads, AC inputs of modules, and lamp terminals. Earth is its own kind: it never merges with DC ground in the checker's reasoning; earth wired to DC ground is a warning.

### 1.3 Ratings
New optional module field `electrical.ratings?: { pins: string[]; volts: number; amps: number; ac: boolean }[]`: the contacts or terminals a rating applies to (relay NO/COM/NC 10 A 250 VAC per the Songle SRD-05VDC datasheet; KCD1 rocker 6 A 250 VAC; fuse holder rating; terminal blocks per series datasheet; SSR load side 25 A 24-380 VAC). Pins covered by an AC rating are "mains-capable"; every other pin is low-voltage for the checker.

### 1.4 Plug families
Module fields `plug?: string` (plug-in devices) and `socket?: string` (outlets), with a compatibility table in code reflecting real-world fit, verified from the standards. Examples: CEE 7/7 (Schuko-French hybrid) fits CEE 7/3 and 7/5; Europlug CEE 7/16 fits 7/3 and 7/5; NEMA 1-15 plugs fit 1-15 and 5-15 sockets; NEMA 5-15 plugs do not fit 1-15 sockets; BS 1363 and AS/NZS 3112 fit only their own. The table drives the plug-mismatch message, and the socket hole patterns are drawn so exactly the compatible plugs seat (tested pairwise).

## 2. Plugging (reuses breadboard mounts)
- An outlet is a board (`holes`, `obstacle: false`). Each socket is a set of single-position hole groups at its contacts (live, neutral, earth where present), joined through `internal` to the outlet's terminal screw pins (edge pins with `mains` roles), so wiring to the screws and plugging in both work. Duplex outlets have two sockets joined in parallel.
- A plug-in device has its prongs as legs (edge pins with plug points) at stylized on-grid spacing that keeps each family's pattern distinct and overlaps exactly where real plugs fit. Seating, carrying, highlights, undo and `mountIssues` are the breadboard system's; the mount code does not change.
- Real dimensions come from the standards (NEMA WD 6, BS 1363-1, IEC/TR 60083 for CEE 7 and Japan, AS/NZS 3112), cited in the generator; the drawn spacing is stylized on the 10 px grid, and each part's source says so.

## 3. Parts (category Mains; generators; every pin sourced and independently verified)
- Outlets: US NEMA 5-15R duplex and 5-20R duplex (T-slot); UK BS 1363 single; Schuko CEE 7/3 single; French CEE 7/5 single; AU/NZ AS/NZS 3112 single; Japan NEMA 1-15R duplex. 120 VAC 60 Hz, 230 VAC 50 Hz, 100 VAC 50/60 Hz.
- Plug-in devices per region (US, UK, EU as CEE 7/7 or Europlug as the real products use, AU, JP): USB wall charger 5 V; barrel-jack wall adapter with its DC output as a `voltage` value (5, 9, 12 V, bound with `voltageOutputs`) and a 100-240 VAC input; cord plug with live, neutral and earth leads for hard-wiring.
- AC-DC modules: HLK-PM01 (5 V) and HLK-PM03 (3.3 V): AC L/N inputs 100-240 VAC, DC outputs as sources in the existing checker model.
- Loads and wiring: lamp in an E26/E27 socket (120 V and 230 V variants); inline 5x20 mm fuse holder; mains rocker switch (KCD1 rating); Wago 221 lever connectors (2, 3, 5 way).
- Terminal blocks: Phoenix Contact MSTB 2,5 pluggable (5.08 mm, 2-6 positions) and MC 1,5 (3.81 mm, 2-6 positions), each rated per its datasheet; the common 2EDG / KF2EDG clones as MSTB-pitch parts; fixed PCB screw terminals KF301/DG301 (5.0 mm, 2 and 3 positions). Drawn assembled (header plus plug), one pin per position, screw heads on top, stylized on-grid pitch.
- Relays: the existing relay module's NO/COM/NC get their contact rating; Fotek SSR-25DA (3-32 VDC control, 24-380 VAC 25 A load).
- About 40 parts. Designators (IEC 81346 letters): outlets `XS`, plugs and cord plugs `XP`, AC-DC modules and adapters `PS`, lamps `E`, fuses `F`, switches `S`, relays and the SSR `K`, terminal blocks and Wago connectors `X`. No prefix rule may steal another's ids (tested).

## 4. Checker rules (in src/format/checks.ts; same finding shape; every message ends with an action)
A mains net is a net with a `mains` pin or an AC supply. Mains conducts through closed switches (switches count as on, as today), fuses, relay contacts and SSR load terminals along their switched paths, terminal blocks and Wago connectors.
1. `mains-to-low-voltage` (error): a live or neutral net contains a pin that is not mains-capable, or an AC rail meets a DC pin. Example: "U3 GPIO4 is wired to the live side of XS1: mains voltage will destroy U3 and can kill. Remove the wire from XS1 L to U3 GPIO4."
2. `mains-short` (error): live and neutral, or live and earth, in one net (including through closed switches, fuses, terminal blocks).
3. `mains-voltage` (error): a device whose AC input range excludes its outlet's voltage (a 120 V lamp on 230 V). Universal ranges fit all.
4. `mains-rating` (error): a rated part on a mains net above its rated volts. Current is unknown until V2, so no current rule yet.
5. `earth-to-dc` (warning): an earth net joined to a DC ground net.
6. `plug-mismatch` (warning): a plug-in device overlapping an outlet of an incompatible family: "XP1's UK plug does not fit XS1's US outlet: use a US-plug adapter."
7. `no-fuse` (warning): a hard-wired mains load (lamp, cord-wired load) with no fuse in its live path. Plug-in devices are exempt.
8. Mains nets never enter the DC potential solver; existing DC rules skip AC pins.

## 5. Look
- Wires on a mains net default to the outlet region's colours (US and Japan: live black, neutral white, earth green; EU, UK and AU: live brown, neutral blue, earth green-yellow drawn as a two-colour stroke). A wire drawn from a mains pin picks its colour automatically; the user can change it.
- A thin hazard outline on mains wires and a small lightning marker near each end. Outlets and mains parts in the Sticker style with realistic faces.

## 6. Tests and checks
- Per-part geometry tests against the cited standards (relative contact positions), module validation, `check:gen`.
- Compatibility matrix: every plug family against every socket family seats exactly as the table says.
- Each checker rule both ways, plus circuits: relay switching a lamp from a US outlet (clean); HLK-PM01 feeding an ESP32 (clean); US charger on a UK outlet (does not seat; plug-mismatch); mains live into a GPIO (error); live to neutral through a rocker (mains-short); 120 V lamp on 230 V (mains-voltage); unfused hard-wired lamp (no-fuse); earth to DC GND (warning).
- Browser check `check:mains-ui`: seat a plug, try a wrong plug (red), draw a mains wire (region colours, hazard look); light and dark screenshots, looked at.
- Independent pinout review of every part; Astra reviews this spec, the plan, and the build before shipping.
