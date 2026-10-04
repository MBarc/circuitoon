# USB ports, cables and hubs: design

Status: approved by Michael (2026-10-04). Plugin 0.9.0.

## Goal
Draw how boards meet USB the way a hobbyist plugs them together: an ESP32 on a Pi's USB port, an RTL-SDR plugged straight into a Pi, a hub between a computer and four devices. Catch the mistakes that cost an afternoon: two hosts cabled together, a cable whose plug does not fit, USB wired to GPIO with jumper wires, a hub tree that asks more current than the port gives. Never claim more than the data says: an unknown current is reported as unknown, never guessed.

Out of scope: USB data rates as a rule (speed is recorded, not checked), USB-C Power Delivery negotiation, CC and SuperSpeed lines in the KiCad export, OTG adapters (micro-B plug to A receptacle), cables with a receptacle end.

## 1. Data model

### 1.1 A USB port is one pin
A USB socket or plug is one pin with `type: "usb"` and a `usb` object, never separate VBUS/D+/D-/GND wires:

```json
{ "name": "USB", "side": "bottom", "type": "usb",
  "usb": { "connector": "micro-B", "gender": "receptacle", "role": "device", "version": "2.0", "speed": "full" } }
```

- `connector`: `A`, `B`, `mini-B`, `micro-B` or `C`.
- `gender`: `receptacle` (a socket on the board) or `plug` (a dongle's plug, the plug end of a panel-mount extension).
- `role`: `host`, `device`, `dual` (OTG or DRP: the port can be either) or `passthrough` (an extension: the bus goes on to the port named by `through`).
- `version` (`1.1`, `2.0`, `3.0`) and `speed` (`low`, `full`, `high`, `super`): optional, recorded only when a source states them.
- `source`: mA a host, dual or hub downstream port supplies, when a source states it. Left out on a `host` port it is the USB default for its version (USB 2.0: 500 mA, USB 3.0: 900 mA, from the two specifications); a `dual` port has no default.
- `draw`: mA a device takes, when a source states it. Left out means unknown, never zero.
- `power: "only"`: a charge-only input with no data lines (the TP4056 and IP5306 USB-C inputs, the Pi Zero's PWR IN).
- `hub`: `upstream` or `downstream` on a hub's ports (an upstream port has role `device`, a downstream one `host`).
- `through`: on a `passthrough` port, the name of the other end.

Module level, in `electrical`:
- `usbBudget: [{ ports: [...], mA, setting?: [name, choice], note? }]`: a current shared by several ports (Pi 4: 1.2 A over its four ports; Pi 5: 1.6 A with a 5 A supply, 600 mA otherwise, chosen by the part setting `supply`).
- `usbHub: { power: "bus" | "self" | { pin } }`: how a hub's downstream ports are powered; `{ pin }` is self-powered when that pin (a DC input) is wired, bus-powered otherwise.

module.ts validates every field and that `usb` appears only on `usb` pins (and is required there). Hole groups take no `usb`.

### 1.2 Place
A port sits on the body edge where the real connector is, like any pin, placed with spacers. A port is drawn as a Sticker-style socket or plug glyph in place of the pin stub.

### 1.3 Library updates (Ruling U1)
Adding USB ports to an existing part is additive drift: the stored copy gets "update parts", not a block, when every stored pin keeps its name, data and place, the body keeps its size, and every new pin is a `usb` pin (in a former spacer slot or appended). Any other pin change still blocks. The RTL-SDR's four contact pins become one port: that blocks, and old sheets still load with their stored copy.

## 2. Connections

### 2.1 Cables
A connection between two USB ports is a USB cable. Its `ends` are plug kinds: `usb-a`, `usb-b`, `usb-mini-b`, `usb-micro-b`, `usb-c`. Presets: A to micro-B, A to mini-B, A to B, A to C, C to C, C to micro-B. A new wire drawn between two receptacles gets the cable whose plugs fit them (A port and micro-B port: an A to micro-B cable) and a black jacket. The BOM lists it as a USB cable, not as hookup wire, and its plugs are not counted as loose connectors.

### 2.2 Plugged in directly (Ruling U2)
A plug port (the RTL-SDR, a panel extension's plug end) connects to a matching receptacle with no cable: the connection has no `ends`, and the sheet draws it as a short dashed grey link marked as plugged in. It is not a wire in the BOM. Seating like the mains plugs was rejected: a USB stick has no fixed board position to seat on, and the link keeps every existing wire tool working.

### 2.3 Never jumper wires
A USB port on the same net as any non-USB pin (a GPIO, a 5V pin, a breadboard strip) is an error.

## 3. Rules
All in `src/format/usb.ts`, run by checkDiagram; nets holding a USB port leave the DC and pin rules.

| Rule | Severity | Fires when |
|---|---|---|
| `usb-to-pin` | error | a USB port shares a net with a non-USB pin |
| `usb-fit` | error | a cable plug does not fit its port; two receptacles with no cable; a plug-to-plug link; a direct plug into a different connector; a port with more than one link; a cable end that is not a USB plug |
| `usb-role` | error | host to host, device to device (passthrough ports followed to the real end); a hub upstream port facing anything but a host or another hub's downstream port gets its own wording |
| `usb-power` | warning | the known draw on a host port, a shared budget or a bus-powered hub's upstream exceeds what it supplies |
| `usb-hub-bus-power` | warning | a bus-powered hub downstream port (100 mA, USB 2.0 specification) feeds a device that draws more |
| `usb-power-unknown` | info | a host port's tree has devices whose draw is unknown, and the known part does not already exceed the supply |

Demand of a port = its device's `draw`; through a bus-powered hub, the hub's own `draw` plus every downstream demand; a self-powered hub's upstream draws its own `draw`. A part with a linked device or power port counts as powered for `no-power`.

## 4. KiCad, BOM, explain
- Every linked USB port becomes its own connector component (`U1_USB`) on a KiCad standard footprint: A receptacle `USB_A_Molex_67643_Horizontal`, USB 3 A `USB3_A_Molex_48393-001`, A plug `USB3_A_Plug_Wuerth_692112030100_Horizontal`, B `USB_B_OST_USB-B1HSxx_Horizontal`, mini-B `USB_Mini-B_Lumberg_2486_01_Horizontal`, micro-B `USB_Micro-B_Molex-105017-0001`, C `USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal`, C plug `USB_C_Plug_Molex_105444`. A link becomes four nets, VBUS, D-, D+ and GND, on the pads the USB pinout gives (C: every VBUS and GND pad, both D+ and D- pads on a receptacle). Mini-B and micro-B plugs have no library footprint: left out with a warning.
- BOM: USB cables by kind; direct plug-ins are not bought.
- explain: a USB port reads as its connector, gender, role, version and current.

## 5. Pin notes on any part
`caps.note` is allowed on any module (informational). The repo test now pins which parts carry the other caps; notes may appear anywhere.
