# Netlist format (`circuitoon-netlist/1`)

A netlist says what connects to what. The layout decides where everything goes. The netlist is stored in the sheet as `intent`, and every later check verifies the sheet against it.

```json
{
  "format": "circuitoon-netlist/1",
  "title": "LED on a breadboard",
  "parts": [
    { "ref": "BB1", "module": "breadboard-half" },
    { "ref": "BT1", "module": "battery-holder-2xaa" },
    { "ref": "R1", "module": "resistor", "values": { "resistance": { "value": 220, "unit": "ohm" } }, "on": "BB1" },
    { "ref": "D1", "module": "led", "on": "BB1" }
  ],
  "nets": [
    { "name": "VCC", "pins": [{ "ref": "BT1", "pin": "+" }, { "ref": "R1", "pin": "1" }] },
    { "name": "LED_A", "pins": ["R1.2", "D1.A"] },
    { "name": "GND", "pins": ["D1.K", "BT1.-"] }
  ],
  "wires": { "color": { "VCC": "red", "GND": "black" }, "ends": "dupont-male" }
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `format`, `title` | Required. |
| `parts[]` | Each part has a `ref` and a `module`, plus two optional fields: `values` and `on`. |
| `nets[]` | Each net has a `name` (unique) and `pins`, a list of at least two endpoints. An endpoint belongs to one net only. Optional `"label": true` asks for the net to be drawn with net labels instead of wires (see below). |
| `nc[]` | Pins that must stay unconnected. Any connection to one of them fails verification. |
| `groups[]` | `{ "name", "parts": [refs] }`, drawn as a labelled frame. A part is in one group at most. `render --focus <name>` frames it. |
| `notes[]` | `{ "text", "near" }`: up to 500 characters, drawn near a group name or a ref. Use notes for assumptions the user must confirm. |
| `wires` | Two optional settings for every wire: `color` and `ends`. See below. |
| `modules` | Embedded parts, keyed by id (see `module-schema.md`). An id may not reuse a built-in id. |
| `repeat` | Repeated sub-circuits (see below). |

The part fields:

- Never list `net-label` as a part: it is not one. Ask for labels on a net with `"label": true`.

- `ref`: a letter, then letters, digits or `_`. It must be unique.
- `module`: a built-in id from `circuitoon parts`, or an id under `modules`.
- `values` (optional): `resistance` in ohm, `capacitance` in F, or `voltage` in V, written as `{ "value": 220, "unit": "ohm" }`.
- `on` (optional): the ref of a breadboard or rail strip the part plugs into.

Net labels (`"label": true` on a net):

- A net label is a named flag at a pin. Every label with the same name is one connection, exactly as if wired, so a long or many-ended net (GND, 5V, SDA, SCL) stays readable. Names match after trimming spaces and are case-sensitive: `SDA` and `sda` are two nets.
- `label` is `true` or `false`; anything else is an error. A net that joins a mains terminal (an outlet contact, a lamp holder, a relay's contacts) never takes a label: mains is always drawn as wires, so the cable checks can see it.
- Verify counts a connection made through labels like one made by wires; labels are infrastructure, like `routing` wires, never extra parts. The bill of materials leaves them out.
- The layout draws a labelled net as one label per endpoint (the pins of one repeat copy share one), each joined by a short `routing` stub; an endpoint with no room for its label is wired to the nearest label of the net. `layout --labels auto` (default) also labels long or many-ended nets on its own; `--labels none` turns labels off, even where a net asks.

The `wires` settings:

- `color` maps a net name to a color. Use one of `red`, `black`, `blue`, `green`, `yellow`, `orange`, `white`, `purple`, `gray`, `brown` or `pink`, or `#RRGGBB`. Nets inside a repeat are named `<copy>.<net>`, for example `tilt_3.SIG`.
- `ends` is one cable end for every wire: `bare`, `dupont-male`, `dupont-female`, `solid-jumper`, `alligator`, `stripped`, `ferrule`, `jst-xh`, `jst-ph`, `jst-sh`, `grove` or `banana`.
- By default the layout follows the wire color convention: ground nets are black, positive supply rails (3V3, 5V, VIN, a battery's +, a regulator's output) are red, and each signal net gets a color from a palette without red or black. Signal nets that share a part get different colors while the palette lasts.
- A `color` you give wins, so keep it to the convention: black for ground, red for a positive supply, never red or black for a signal. The checker warns (`wire-color-ground`, `wire-color-supply`, `wire-color-signal`) on any wire that breaks it. Mains wiring is exempt: it keeps its regional identity colors.

## Endpoints

- A pin is `{ "ref": "U1", "pin": "GND" }`, or the shorthand `"U1.GND"`. The shorthand splits at the first dot, so `"U5.5V+"` is pin `5V+`, and `"J1.1"` is pin `1`.
- A breadboard hole group is `{ "ref": "BB1", "group": "c5-top", "hole": 2 }`. Hole indexes start at 0. Leave `hole` out to use any free hole.
- `"BB1.top-"` names a whole rail.
- The exact pin name always wins. A silkscreen label is used only when no pin has that name and exactly one pin has the label. A label that several pins share is an error, and the error lists those pins.
- Pads-only boards (for example `mcp23017-cjmcu-2317`) list their pads as hole groups named like pins. Address them the same way (`"U2.GPA0"`). They cannot mount `on` a breadboard, so wire them.

## How the layout wires a net

- The legs of parts `on` a breadboard sit in its strips. The other holes of a strip are where wires join.
- A header pin or pad takes one wire end, unless its module declares `capacity`. A breadboard hole takes one wire end or one leg.
- A hole under a mounted part's drawn body (between a resistor's legs, under an LED's dome, under a chip) takes nothing. The layout never wires into one, and never seats a part so that its body covers another part's leg. A strip left with no free hole says so: "strip full: ... (the other holes there lie under U2's body)". The DIP-28 chips are drawn at true scale: seated across the channel in rows e and f, they cover only the channel.
- So a net of three or more pins needs somewhere to share. That can be:
  - a strip that its mounted legs already sit in;
  - a strip or rail that you name in the net (`"BB1.top-"`);
  - a free strip or rail of a breadboard or rail strip in the netlist, which the layout claims for it (ground takes a `-` rail, power takes a `+` rail, a signal takes a column strip).

  With none of these, the layout stops with "needs a distribution point: net X".
- Pins that a part joins inside itself count as one node. That node takes as many wires as its pins together. Examples: the ESP32's GND pins (`GND`, `GND 2`, `GND 3`), and the IP5306's B- and 5V-.
  - Listing more of them in the net (`"U1.GND", "U1.GND 2"`) gives the node more wire ends, so a net of three can chain through the part with no strip: one wire into `U1.GND`, the next out of `U1.GND 2`.
  - When a net has no strip and none can be claimed, the layout also counts the joined pins you did not list, as long as they are on no other net, not in `nc` and not plugged into a board. So `U1.GND` with two sensor grounds lays out with one wire on `U1.GND 2`. Verify treats those pins as part of the net.
  - When even that is not enough, the error names the joined pins it counted, for example "even counting the free pins joined to them inside the part (U1 GND 2 and U1 GND 3)". Then add a breadboard, a rail strip or a terminal block.
- Everything the layout adds for strips (wires into holes, jumpers, local rail strips) is marked `routing: true`.

## Repeated sub-circuits

```json
"repeat": {
  "name": "ball", "count": 14,
  "refs": "A{copy}{ref}",
  "template": {
    "parts": [{ "ref": "SA", "module": "tilt-switch-sw520d" }, { "ref": "SB", "module": "tilt-switch-sw520d" }],
    "nets": [{ "name": "CH", "pins": ["SA.1", "SB.1"] }, { "name": "GND", "pins": ["SA.2", "SB.2"] }],
    "ports": ["CH", "GND"]
  },
  "bindings": [{ "CH": "U2.GPA0" }, { "CH": "U2.GPA1" }],
  "shared": { "GND": "GND" }
}
```

- **Ports.** A template net named like a port is that port's net.
- **Shared ports.** `shared` joins one port of every copy to one outside net. Here that is the top-level `GND`, which must exist.
- **Bound ports.** Every other port needs one binding per copy, and no outside pin may be bound twice.
- **Refs and copy ids.** Refs default to `SA_1`, `SB_1`, and so on. A pattern such as `"refs": "A{copy}{ref}"` must contain both `{copy}` and `{ref}`, and a clash with another ref is an error. Copy ids are `<name>_<k>` (`ball_1`, `ball_2`, ...); `render --focus ball_1` frames one copy.
- **No mounting.** Template parts cannot use `on`. A bound net with three pins (two switch legs and an expander pin) therefore needs a breadboard in the netlist, where the layout claims one strip per channel.
- **Local strips.** Each block of copies bound to one part gets its own rail strips (`DP1`, `DP2`, ...) for shared ground or power, joined to the net by one trunk wire.
- **Tables.** The layout prints the channel table (copy, port, bound pin) and the bill of quantities.

## Partial re-layout (`--keep`)

A partial pins some positions and lets the layout place the rest:

```json
{
  "format": "circuitoon-partial/1",
  "title": "Spirit Typewriter 2 of 4: expander bank A, balls 1 to 14",
  "parts": [
    { "designator": "BB2", "x": 0, "y": 0 },
    { "designator": "U2", "x": 400, "y": 60, "rotation": 0 }
  ],
  "intent": { "format": "circuitoon-netlist/1", "...": "the whole netlist" }
}
```

Run `circuitoon layout --keep partial.json -o sheet.json`.

- **What is read.** Only `intent`, and each listed part's `designator`, `x`, `y` and `rotation`. Wires are always regenerated.
- **Positions.** Coordinates are on the 10 px grid. Rotation is 0, 90, 180 or 270. A kept part is never moved: an impossible position fails with a finding that names the parts (for example "caption overlap: DS3 caption and SD1 body"), so move one and try again.
- **Mounted parts.** A kept board keeps its mounted parts while they still seat.
- **Designators not in the intent** are ignored with a warning. The local `DP` strips are such designators.
- **Keeping a repeat copy.** Keeping any member of a repeat copy takes that copy out of its block's local strips, so its shared ports use star wiring. To keep local distribution, pin only parts outside the repeat.
- **Starting from a laid-out sheet.** You can copy it, change `format` to `circuitoon-partial/1`, and delete `x` and `y` from the parts to place again. Remember the point above: this keeps the copies too.
- **Where it opens.** The site never opens a partial file.
