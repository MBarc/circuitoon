// Immutable diagram edits. Every function returns a new Diagram and never mutates its input,
// so the store can keep old versions for undo.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import type { Rotation } from '../format/geometry.ts'
import { partValue } from '../format/values.ts'

export interface Selection {
  parts: string[]
  wires: string[]
}
export const EMPTY_SELECTION: Selection = { parts: [], wires: [] }

export interface WireStyle {
  color: string
  gauge: number
}

export function nextUid(d: Diagram, prefix: 'p' | 'w' | 'a'): string {
  // Endpoint part uids count too: a wire to a missing part must not latch onto a new part.
  const used = new Set([
    ...d.parts.map((p) => p.uid),
    ...d.connections.flatMap((c) => [c.uid, c.from.part, c.to.part]),
    ...(d.annotations ?? []).map((a) => a.uid),
  ])
  let n = 1
  while (used.has(prefix + n)) n++
  return prefix + n
}

const PREFIXES: [RegExp, string][] = [
  [/^potentiometer/, 'RV'],
  [/^resistor/, 'R'],
  [/^capacitor/, 'C'],
  [/^led/, 'D'],
  [/button|switch/, 'S'],
  [/^battery/, 'BT'],
]

export function designatorPrefix(m: ModuleDef): string {
  return PREFIXES.find(([re]) => re.test(m.id))?.[1] ?? 'U'
}

export function nextDesignator(d: Diagram, m: ModuleDef): string {
  const prefix = designatorPrefix(m)
  const used = new Set(d.parts.map((p) => p.designator))
  let n = 1
  while (used.has(prefix + n)) n++
  return prefix + n
}

export function addPart(d: Diagram, m: ModuleDef, x: number, y: number): { diagram: Diagram; uid: string } {
  const uid = nextUid(d, 'p')
  const part: PartInstance = { uid, designator: nextDesignator(d, m), module: m.id, x, y, rotation: 0 }
  const modules = moduleOf(d, m.id) ? d.modules : { ...d.modules, [m.id]: m }
  return { uid, diagram: { ...d, modules, parts: [...d.parts, part] } }
}

export function moveParts(d: Diagram, uids: string[], dx: number, dy: number): Diagram {
  if (!dx && !dy) return d
  const s = new Set(uids)
  return { ...d, parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }
}

export function rotateParts(d: Diagram, uids: string[]): Diagram {
  const s = new Set(uids)
  return {
    ...d,
    parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, rotation: (((p.rotation ?? 0) + 90) % 360) as Rotation } : p)),
  }
}

export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  return {
    ...d,
    parts: d.parts.filter((p) => !parts.has(p.uid)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
  }
}

const sameEnd = (a: Endpoint, b: Endpoint) => a.part === b.part && a.pin === b.pin

export function addWire(d: Diagram, from: Endpoint, to: Endpoint, style: WireStyle): { diagram: Diagram; uid: string } | null {
  if (sameEnd(from, to)) return null
  if (d.connections.some((c) => (sameEnd(c.from, from) && sameEnd(c.to, to)) || (sameEnd(c.from, to) && sameEnd(c.to, from)))) return null
  const uid = nextUid(d, 'w')
  const wire: Connection = { uid, from, to, color: style.color, gauge: style.gauge }
  return { uid, diagram: { ...d, connections: [...d.connections, wire] } }
}

/**
 * Moves one end of an existing wire onto a different pin, keeping its color, gauge, label and
 * route. Refused (returns null) for a missing wire, a self-loop, dropping back onto the pin the
 * end is already on, or a duplicate of another wire's endpoints in either direction.
 */
export function reconnectWire(d: Diagram, uid: string, end: 'from' | 'to', target: Endpoint): Diagram | null {
  const wire = d.connections.find((c) => c.uid === uid)
  if (!wire) return null
  const current = wire[end]
  const other = wire[end === 'from' ? 'to' : 'from']
  if (sameEnd(target, other)) return null
  if (sameEnd(target, current)) return null
  const from = end === 'from' ? target : wire.from
  const to = end === 'to' ? target : wire.to
  const dup = d.connections.some(
    (c) => c.uid !== uid && ((sameEnd(c.from, from) && sameEnd(c.to, to)) || (sameEnd(c.from, to) && sameEnd(c.to, from))),
  )
  if (dup) return null
  return { ...d, connections: d.connections.map((c) => (c.uid === uid ? { ...c, [end]: target } : c)) }
}

export function updatePart(d: Diagram, uid: string, patch: { designator?: string }): Diagram {
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }
}

export function updateWire(d: Diagram, uid: string, patch: { color?: string; gauge?: number; label?: string }): Diagram {
  return { ...d, connections: d.connections.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) }
}

/**
 * Sets a part's value for one electrical param, for example resistance. Returns the same
 * diagram object, unchanged, when the part or its module is missing, or when the new value
 * matches what the part already resolves to (its stored override, or the module default).
 */
export function updatePartValue(d: Diagram, uid: string, param: string, value: number, unit: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return d
  const current = partValue(part, m)
  if (current && current.name === param && current.value === value && current.unit === unit) return d
  const values = { ...part.values, [param]: { value, unit } }
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, values } : p)) }
}
