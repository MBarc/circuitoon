# Wiring checker: design

Status: approved direction (Michael, 2026-09-26: "Yup start this"). First step toward V2 simulation; needs no simulation.

## Goal
Point out wiring mistakes a hobbyist would make on the real bench, using only the connectivity Circuitoon already computes (netlist: wires, breadboard strips, plugged legs, internal joins) and each pin's `type` and `supply`. Never claim more than the data supports: pins without a `type` are unknown and never trigger a rule.

## Voltages
A supply string is a "/" list of rails. Each rail parses to volts: `3V3` = 3.3, `1V8` = 1.8, `5V` = 5, `3.7V` = 3.7, `7.4V` = 7.4. `ADJ` means user-set: unknown voltage. An unparseable rail is unknown. A net's source voltage is the voltage of the power_out pins on it (a power_out has one rail; if it lists several, use the highest as worst case).

## Rules (v1)
Each finding has a stable rule id, a severity (error: likely to damage parts or never work; warning: suspicious), a one-sentence message in plain words naming designators and pin names, and the parts, pins and wires involved (for highlighting).

1. `short` (error): a net holds a power_out pin and a ground pin. Message: "BT1 + is wired straight to ground (U1 GND): short circuit."
2. `supply-too-high` (error): a power_in pin sits on a net whose source voltage exceeds the highest rail the pin accepts. "U1 3V3 accepts up to 3.3 V but gets 5 V from U2 5V+."
3. `supply-too-low` (warning): source voltage below the lowest accepted rail. "U1 VIN needs at least 7 V; BT1 gives 3.7 V."
4. `supply-unknown` (warning, only when the source is ADJ and the input lists voltages): "U2 OUT+ is adjustable; set it to a voltage U1 VCC accepts (3.3 V or 5 V)."
5. `supplies-fight` (error): two power_out pins with different known voltages on one net. Same voltage: warning `supplies-parallel` ("two supplies tied together").
6. `outputs-fight` (warning): two `output` pins on one net (two drivers).
7. `no-power` (warning): a part with at least one wire or plug, having power_in pins, none of which is on a net with a power_out. "U1 has no power: connect VCC or 5V."
8. `no-ground` (warning): same condition for ground pins: the part has ground pins and none is on a net with any other part's pin.
9. `mount` (warning): every entry of mountIssues (partial, conflict, obscured, cannot-mount...), in plain words.
10. `leg-hole-shared` (warning): a wire end in the exact hole a plugged leg occupies ("physically, one hole takes one leg").
11. `broken` (error): each connection in netlist(d).broken (already listed today; the checker absorbs that list).

Not in v1 (needs simulation or pin roles we do not have): LED without a resistor, floating inputs, current limits, I2C pull-ups, level mismatch on signal pins, shorts through switches or other passives (switch state is not modeled). Reversed polarity is checked since round 4. Also deferred after review (2026-09-26): structured voltage ranges (nominal / operating / absolute max) instead of "/" rail lists; per-board external-power on/off state (every `electrical.external` pin is assumed powered); a dismissal UI (ids are canonical already, so it can key on them); output drive types (push-pull / open-drain / tri-state) for `outputs-fight`; negative and differential rails (a negative rail parses as unknown).

## Review changes (2026-09-26, Astra and Claude reviews)
- A source's voltage is the part's value when the module has a `voltage` param (batteries, the LM2596, whose value replaces ADJ).
- `electrical.external` pins (a board's USB 5 V) are sources in every rule; they give way to a supply drawn on the sheet on the same net. The `model: "mcu"` no-power exemption is gone.
- No power: fed only by a supply, a passive or an untyped pin; another part's power input does not feed.
- Sources are deduplicated per internal component (closure over pins and hole groups), which also decides pass-throughs.
- Short: a source on the same net as its own part's ground.
- parseSupply keeps the unknown reason (adjustable / unknown); finite rails only.
- Ids: rule plus sorted causal terminal keys.

## Second review changes (2026-09-26, Astra re-review)
- Reference-aware voltages: each supply is an edge from its return net to its output net; one BFS per group assigns potentials. A disagreeing loop is a shorted stack (every supply the same way round) or a fight; an agreeing loop is supplies in parallel. Loads see potential(input) minus potential(own ground), so series stacks add up; with the ground outside the group the supply on the input net counts. A pass-through part's grounds are joined at 0 V.
- No USB suppression: USB pins are always sources; a drawn supply beside one at the same voltage warns not to power both, at another voltage they fight.
- Pico VSYS is a USB pin too (through the VBUS diode), 5 V worst case, not joined to VBUS.
- `electrical.voltageOutputs` binds a voltage param to named outputs (required with more than one power_out).
- esp32-terminal-board-38 is the DevKitC V4 on the terminal board, drawn seated.
- No power reuses the resolved sources: pass-through outputs feed nothing.

## Third review changes (2026-09-26, Astra re-review 2)
Principle: never state a definite voltage or give setting advice when any part of the path is unknown or ambiguous; say what is unknown instead.
- Unknown and adjustable supplies are unknown steps in the walk; potentials carry the unknowns they depend on. Too high / too low only on a fully known difference; setting advice only with one adjustable unknown, counting series offsets; otherwise "cannot be checked".
- `electrical.external` entries take `diode: true` (per schematic) and `max`. A diode-fed pin only raises its net: fine at or above its voltage up to its limit; a lower supply there is an error (USB pushes current through the diode). Direct pins keep the round-2 behavior.
- A contradiction blocks only loads whose path runs through its loop.
- `electrical.commonReturn` declares grounds that are one return (TP4056 B-/OUT-); the pass-through ground join is gone.
- `electrical.returns` names each supply's ground; else the only ground component; else unknown. The largest-ground guess is gone. Picos return to GND.
- A load whose ground misses the return of its supply gets no voltage finding (No ground, or "cannot be checked").

## Fourth review changes (2026-09-26, hobbyist review of 58 sheets)
- `reversed` (error): a load's input below its own ground; names the wires to swap or the battery in backwards; no no-power for that part.
- Switches (`electrical.model` "switch") are closed for voltages; a loop through one is never a short or a fight.
- Too low only below 90% of the lowest rail until real ranges exist.
- Data: DevKit V1 VIN 5V/7V/9V/12V (NCP1117 20 V / AMS1117 15 V LDO); L298N kept at 12 V with its jumper fitted (module guide: the jumper must come off above 12 V).
- Joined power pins are checked once.
- `no-common-ground` (warning): a signal between two separately grounded parts.
- No follow-up noise after a short; "wired only to its own pins" wording for No ground.
- Fights name the pin on the net ("U1 OUT+ (3.7 V from BT1)").
- Messages carry actions: stakes, the wire to remove, how to fix a voltage, which ground to connect.

## Where it lives
- `src/format/checks.ts`: pure `checkDiagram(d): Finding[]`, sorted errors first, then by designator. `parseSupply(s)`. No React.
- The editor computes it memoized per diagram content, never per drag frame (reuse the drag-free memo pattern of the broken list).
- UI: the existing broken-connections list becomes a "Problems" list (same place: Inspector with nothing selected, and the toolbar badge now counts problems, red when any error). Each row: severity icon, message, Select (selects the parts and wires involved and pans them into view if the canvas supports it) and, for `broken`, Delete. Hovering a row highlights its parts/wires on the canvas. Empty state: a short "No wiring problems found" line.
- The sample sheet must produce zero findings.

## Tests
Unit tests per rule (positive and negative), parseSupply, the sample yields nothing, a big-sheet perf check (200 parts / 500 wires under 20 ms), browser check of the list and highlight. Screenshots in light and dark.
