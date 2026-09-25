# Breadboards with leg snapping: design

Date: 2026-09-25. Status: approved by Michael (leg snapping from the start).

## Goal
Breadboards in several sizes. Parts dropped onto a board snap their legs into the holes and become electrically connected to those hole strips, with no wires. Jumper wires can end in any hole. Moving the board carries its parts.

## Boards
| id | name | layout |
| --- | --- | --- |
| breadboard-full | Full breadboard (830) | 63 columns, rows a-e and f-j (126 strips of 5), 4 power rails of 50 holes |
| breadboard-half | Half breadboard (400) | 30 columns (60 strips of 5), 4 power rails of 25 holes |
| breadboard-mini | Mini breadboard (170) | 17 columns (34 strips of 5), no rails |
| breadboard-tiny | Tiny breadboard (25) | 5 strips of 5 |
| power-rail-strip | Power rail strip | 2 rails (+ and -) of 25 holes |

- Hole pitch 10 px (0.1 inch), holes on grid points. Rails in groups of 5 with a gap, as on real boards. Full-size rails are continuous (a split-rail variant can come later).
- Category "Prototyping", placed after Batteries in the Parts panel.

## Format changes
1. **Hole groups (module):** a module may declare `holes: [{ "name": "c12-top", "label": "12 a-e", "at": [[x, y], ...], "rail": "+" | "-" (optional) }]`. Each group is one electrical node, and `at` lists the positions of its holes in module-local px. Groups are pins in every other sense: wires reference them by `name`, and validation checks names are unique across pins and groups.
2. **Hole endpoints (diagram):** a wire end can be `{ "part": "<board uid>", "pin": "<group name>", "hole": <index into at> }`. This replaces the deferred bus `offset` idea; `offset` stays readable for old files.
3. **Mounting (diagram):** a part instance can carry `"mount": { "board": "<board uid>" }`. A mounted part's pins are connected to whichever hole groups their plug points sit on, computed from geometry. Its `x, y` stay absolute. The file stays the source of truth: the mount relation plus positions fully determine the plugged connections.
4. **Routing obstacles:** a module can set `"obstacle": false`. Breadboards do, because jumpers lie on top of the board; parts mounted on it are still obstacles.

### Interior pins beyond breadboards
Hole groups are the general "pin inside the body" mechanism. A group with a single position is an ordinary interior pin: that is how the full-size Raspberry Pi 40-pin header (2 x 20, pin 1 marked) will be drawn in its true position right after this work. Validation, wiring, hover and netlist treat single-position groups like any other pin; they are drawn as a header pad (not a breadboard hole) when the module sets `"holeStyle": "pad"` on the group.

## Leg snapping rules
- **Plug point:** each pin's plug point is its pin edge point (on the part's body edge, always a grid point). The pin stub is drawn from the edge to the hole, like a leg going into the board.
- **Seated check:** while dragging a part over a board, the part is **seated** when every pin's plug point lands exactly on a hole of that one board (after grid snapping), and no hole is already taken by another mounted part's leg.
  - The holes under the legs highlight green.
  - If only some legs land, they highlight red, and dropping places the part unmounted.
- **On drop:** a seated part gets `mount.board`. Dragging it off the board clears the mount.
- **Boards carry parts:** dragging a board moves every part mounted on it in the same undo step. Deleting a board unmounts its parts but keeps them.
- **Rotation:** rotating a mounted part re-checks the fit. If it no longer fits, the mount is removed.
- **Edge pins only:** parts with pins on all four sides can mount if every plug point fits. ESP32 boards need rotating so their two pin rows span the center channel, as in real life. Their row spacing is a multiple of 10 px, so both rows can land on holes.

## Wires and routing
- A wire can end on any hole. Its end point is the hole center, and it can leave in any direction: the router seeds all four headings at the start and accepts any arrival direction at a hole goal.
- Hover a hole: every hole in its group highlights, plus pins and holes connected through wires, mounts and `internal` groups.
- A new pure `netlist(diagram)` merges wires, mounted plugs and `internal` groups into nets. It feeds hover highlighting now and V2 simulation later.

## Rendering
- The renderer draws holes from the hole groups, not from art rectangles. That keeps an 830-hole board's JSON small and fast to render.
- Board art: white body, center channel, red and blue rail stripes, row letters and column numbers every 5.
- Taken holes darken slightly. Leg stubs of mounted parts are drawn to hole centers.

## Tests
- Hole-group validation.
- Endpoint resolution to hole centers, with rotation.
- Seated detection, including partial and conflicting cases.
- Mount persistence and round trip.
- Moving a board carries its parts, as one undo step.
- Netlist merging.
- Router behaves correctly with free-direction endpoints.

## Out of scope
- Split-rail variants.
- Hole-level wire editing beyond choosing the hole.
- Auto-placing parts.
- Simulation.
