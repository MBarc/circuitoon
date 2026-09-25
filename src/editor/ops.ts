// Immutable diagram edits. Every function returns a new Diagram and never mutates its input,
// so the store can keep old versions for undo.
import { type Connection, type Diagram, type Endpoint, type PartInstance, moduleOf } from '../format/diagram.ts'
import { isBoard, type ModuleDef } from '../format/module.ts'
import { type Plug, type Seat, plugsOf, seatOf, seatOn } from '../format/breadboard.ts'
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
  // Endpoint and mount target uids count too: a wire or mount to a missing part must not latch onto a new part.
  const used = new Set([
    ...d.parts.flatMap((p) => (p.mount ? [p.uid, p.mount.board] : [p.uid])),
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
  [/^(breadboard|power-rail)/, 'BB'],
  [/^(lcd|oled|tft)-/, 'DS'],
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

const withoutMount = (p: PartInstance): PartInstance => {
  const { mount: _gone, ...rest } = p
  return rest
}

export interface Settling {
  /** Per settling part, in `d.parts` order: where it would mount on drop (seated) or why not. */
  seats: Map<string, Seat | null>
  /** Legs plugged with the settling parts loose: what stays put, for the leg dots while dragging. */
  plugs: Plug[]
}

/**
 * The one seat check behind both the drag highlight and the drop. The listed parts that are not
 * boards (in 'keep' mode only the mounted ones) start loose, so only the other parts hold holes;
 * then they settle in `d.parts` order, and each part that seats takes its holes from the parts
 * after it. 'drop' checks every board (`seatOf`); 'keep' checks only the part's own board
 * (`seatOn`), so an overlapping board can never take a part away from the one it fits.
 */
export function settleSeats(d: Diagram, uids: string[], mode: 'drop' | 'keep' = 'drop'): Settling {
  const listed = new Set(uids)
  const settle = d.parts.filter((p) => listed.has(p.uid) && !isBoard(moduleOf(d, p.module)) && (mode === 'drop' || p.mount))
  const settling = new Set(settle.map((p) => p.uid))
  const work: Diagram = settle.some((p) => p.mount)
    ? { ...d, parts: d.parts.map((p) => (settling.has(p.uid) && p.mount ? withoutMount(p) : p)) }
    : d
  const plugs = plugsOf(work)
  const taken = [...plugs]
  const seats = new Map<string, Seat | null>()
  for (const p of settle) {
    const seat = mode === 'keep' ? seatOn(work, p.uid, p.mount!.board, taken) : seatOf(work, p.uid, taken)
    seats.set(p.uid, seat)
    if (seat?.status !== 'seated') continue
    // Its legs, from a sheet of just this part mounted on that board (the hole lookup is cached per board).
    const board = work.parts.find((q) => q.uid === seat.board)!
    const me = work.parts.find((q) => q.uid === p.uid)!
    taken.push(...plugsOf({ ...work, parts: [board, { ...me, mount: { board: seat.board } }] }))
  }
  return { seats, plugs }
}

/**
 * Re-checks the mount of each listed part (see `settleSeats`). 'drop' (a finished drag): a seated
 * part gets, or keeps, `mount.board`; anything else loses its mount. 'keep' (after a rotation): a
 * part is never newly mounted, and keeps its mount only while it is still seated on its own board.
 * Boards are skipped. Returns `d` itself when nothing changes; unchanged parts keep their identity.
 */
export function settleMounts(d: Diagram, uids: string[], mode: 'drop' | 'keep' = 'drop'): Diagram {
  const { seats } = settleSeats(d, uids, mode)
  let changed = false
  const parts = d.parts.map((p) => {
    if (!seats.has(p.uid)) return p
    const seat = seats.get(p.uid)
    const board = seat?.status === 'seated' ? seat.board : undefined
    if (p.mount?.board === board) return p
    changed = true
    return board ? { ...p, mount: { board } } : withoutMount(p)
  })
  return changed ? { ...d, parts } : d
}

/**
 * The diagram a finished part drag leaves: `now` with the moved parts settled. A press without
 * movement (`now` is still the drag's `base`) changes nothing, mounts included.
 */
export function settleDrop(base: Diagram, now: Diagram, uids: string[]): Diagram {
  return now === base ? now : settleMounts(now, uids)
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

/** Same part, same pin or hole group, and the same hole (a missing hole is hole 0). */
export const sameEndpoint = (a: Endpoint, b: Endpoint): boolean => a.part === b.part && a.pin === b.pin && (a.hole ?? 0) === (b.hole ?? 0)

export function addWire(d: Diagram, from: Endpoint, to: Endpoint, style: WireStyle): { diagram: Diagram; uid: string } | null {
  if (sameEndpoint(from, to)) return null
  if (d.connections.some((c) => (sameEndpoint(c.from, from) && sameEndpoint(c.to, to)) || (sameEndpoint(c.from, to) && sameEndpoint(c.to, from)))) return null
  const uid = nextUid(d, 'w')
  const wire: Connection = { uid, from, to, color: style.color, gauge: style.gauge }
  return { uid, diagram: { ...d, connections: [...d.connections, wire] } }
}

/**
 * Moves one end of an existing wire onto a different pin, keeping its color, gauge and label. A
 * hand-shaped wire becomes automatic again, since its bends were made for the old pin. Refused (returns null) for a missing wire, a self-loop, dropping back onto the pin the
 * end is already on, or a duplicate of another wire's endpoints in either direction.
 */
export function reconnectWire(d: Diagram, uid: string, end: 'from' | 'to', target: Endpoint): Diagram | null {
  const wire = d.connections.find((c) => c.uid === uid)
  if (!wire) return null
  const current = wire[end]
  const other = wire[end === 'from' ? 'to' : 'from']
  if (sameEndpoint(target, other)) return null
  if (sameEndpoint(target, current)) return null
  const from = end === 'from' ? target : wire.from
  const to = end === 'to' ? target : wire.to
  const dup = d.connections.some(
    (c) => c.uid !== uid && ((sameEndpoint(c.from, from) && sameEndpoint(c.to, to)) || (sameEndpoint(c.from, to) && sameEndpoint(c.to, from))),
  )
  if (dup) return null
  return {
    ...d,
    connections: d.connections.map((c) => {
      if (c.uid !== uid) return c
      const { route: _dropped, ...rest } = c
      return { ...rest, [end]: target }
    }),
  }
}

export function updatePart(d: Diagram, uid: string, patch: { designator?: string }): Diagram {
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }
}

export function updateWire(d: Diagram, uid: string, patch: { color?: string; gauge?: number; label?: string }): Diagram {
  return { ...d, connections: d.connections.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) }
}

const sameRoute = (a: [number, number][] | undefined, b: [number, number][]) =>
  !!a && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1])

/**
 * Makes a wire manual with the given bends (the points between its two pin stub tips). An empty
 * list is still manual: a wire with no bends. Returns the same diagram when nothing changes.
 */
export function setWireRoute(d: Diagram, uid: string, route: [number, number][]): Diagram {
  const wire = d.connections.find((c) => c.uid === uid)
  if (!wire || sameRoute(wire.route, route)) return d
  const copy = route.map(([x, y]) => [x, y] as [number, number])
  return { ...d, connections: d.connections.map((c) => (c === wire ? { ...c, route: copy } : c)) }
}

/** Hands a wire back to the router. Returns the same diagram when it is already automatic or missing. */
export function clearWireRoute(d: Diagram, uid: string): Diagram {
  const wire = d.connections.find((c) => c.uid === uid)
  if (!wire || wire.route === undefined) return d
  return {
    ...d,
    connections: d.connections.map((c) => {
      if (c !== wire) return c
      const { route: _dropped, ...rest } = c
      return rest
    }),
  }
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
