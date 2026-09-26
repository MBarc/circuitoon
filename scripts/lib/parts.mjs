// Building blocks shared by the part generators (gen-power, gen-sensors, gen-outputs,
// gen-typewriter): the rect shorthand, pin slot positions, one side's pin list, the module JSON
// skeleton and the file writer. Files go out through lib/gen-output.mjs, so every generator that
// uses `write` supports `--check`; call `finish(...)` from that module as the generator's last line.
import { fileURLToPath } from 'node:url'
import { emit, log } from './gen-output.mjs'

const OUT = fileURLToPath(new URL('../../modules/', import.meta.url))

/** A Sticker-style rect shape. */
export const r = (x, y, w, h, fill, extra = {}) => ({ type: 'rect', x, y, w, h, fill, ...extra })

/** Pin positions (px) along a side `len` units long with `n` slots, per computeLayout. */
export function slots(len, n) {
  const s0 = Math.ceil((len - (n - 1)) / 2)
  return Array.from({ length: n }, (_, i) => (s0 + i) * 10)
}

/**
 * Pins for one side from a slot list: 'NAME' or 'NAME|label' is a pin, null is a spacer (a
 * physical gap). `types` maps a pin to { type, supply }, looked up by its label first, then by its
 * name. Returns the pins, the px position of each pin by name (`pos`) and the px positions of the
 * pins in order, spacers left out (`at`).
 */
export function side(sideName, list, types, len) {
  const all = slots(len, list.length)
  const pos = {}
  const pins = list.map((s, i) => {
    if (s === null) return { spacer: true, side: sideName }
    const [name, label] = s.split('|')
    const p = { name, side: sideName }
    if (label) p.label = label
    const t = (label !== undefined ? types[label] : undefined) ?? types[name] ?? {}
    if (t.type) p.type = t.type
    if (t.supply) p.supply = t.supply
    pos[name] = all[i]
    return p
  })
  return { pins, pos, at: list.flatMap((s, i) => (s === null ? [] : [all[i]])) }
}

/**
 * A module definition. `inside` draws pin names inside the body beside each pin, like silkscreen
 * (header and pad modules); `states` lists a switch's positions.
 */
export function moduleJson({ id, name, category, source, pins, internal, wu, hu, electrical, states, inside = false, shapes }) {
  const m = { format: 'circuitoon-module/1', id, version: 1, name, category, source, pins }
  if (internal) m.internal = internal
  m.size = { w: wu, h: hu }
  m.electrical = electrical
  if (states) m.states = states
  m.art = inside ? { w: wu * 10, h: hu * 10, pinLabels: 'inside', shapes } : { w: wu * 10, h: hu * 10, shapes }
  return m
}

/** Writes (or, with --check, compares) modules/<file> and logs its pin count and body size. */
export function write(file, m) {
  emit(OUT + file, JSON.stringify(m, null, 2) + '\n')
  const n = m.pins.filter((p) => !p.spacer).length
  log(file, 'pins', n, 'body', m.art.w, 'x', m.art.h)
}
