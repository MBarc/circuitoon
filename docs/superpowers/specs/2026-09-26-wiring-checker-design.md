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

Not in v1 (needs simulation or pin roles we do not have): LED without a resistor, floating inputs, current limits, I2C pull-ups, level mismatch on signal pins.

## Where it lives
- `src/format/checks.ts`: pure `checkDiagram(d): Finding[]`, sorted errors first, then by designator. `parseSupply(s)`. No React.
- The editor computes it memoized per diagram content, never per drag frame (reuse the drag-free memo pattern of the broken list).
- UI: the existing broken-connections list becomes a "Problems" list (same place: Inspector with nothing selected, and the toolbar badge now counts problems, red when any error). Each row: severity icon, message, Select (selects the parts and wires involved and pans them into view if the canvas supports it) and, for `broken`, Delete. Hovering a row highlights its parts/wires on the canvas. Empty state: a short "No wiring problems found" line.
- The sample sheet must produce zero findings.

## Tests
Unit tests per rule (positive and negative), parseSupply, the sample yields nothing, a big-sheet perf check (200 parts / 500 wires under 20 ms), browser check of the list and highlight. Screenshots in light and dark.
