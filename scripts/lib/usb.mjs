// USB ports for the part generators (docs/superpowers/specs/2026-10-04-usb-design.md). A port is one
// pin with `type: "usb"`; its facts (connector, gender, role, version, speed, current) come from the
// sources cited where each generator calls these helpers. Leave out what no source states: a missing
// `draw` or `source` is unknown, and the checker says so.

/** A USB port pin. `label` is the silkscreen when it differs from the name. */
export function usbPort(name, side, usb, label) {
  return { name, side, ...(label ? { label } : {}), type: 'usb', usb }
}

/**
 * One side's entries with each port at a px position along it: `len` grid units long, slots at
 * 20 .. (len - 1) * 10 px (len - 2 slots, so the side never widens the body), spacers elsewhere.
 * `at` is [[px, pin], ...]; every px must be a slot.
 */
export function portSide(side, len, at) {
  const n = len - 2
  const list = Array.from({ length: n }, () => ({ spacer: true, side }))
  for (const [px, pin] of at) {
    const i = px / 10 - 2
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`portSide: ${pin.name} at ${px} px is not a slot on a ${len}-unit side`)
    list[i] = pin
  }
  return list
}

/** The pins with the spacer at `index` (counting only `side`'s entries) replaced by `pin`. */
export function intoSpacer(pins, side, index, pin) {
  let k = -1
  return pins.map((p) => {
    if (p.side !== side) return p
    k++
    if (k !== index) return p
    if (!p.spacer) throw new Error(`intoSpacer: entry ${index} on ${side} is ${p.name}, not a spacer`)
    return pin
  })
}

/**
 * The pins with `usb.vbus` set to `pin` on the USB ports named in `names` (every port when left out):
 * the board pin each port's VBUS feeds, from the same schematic or maker docs as the board's
 * `electrical.external` entry for that pin. The checker warns when a supply is wired to that pin
 * while a host powers the port (VBUS back-feed).
 */
export function withVbus(pins, pin, names) {
  return pins.map((p) => (p.type === 'usb' && (!names || names.includes(p.name)) ? { ...p, usb: { ...p.usb, vbus: pin } } : p))
}
