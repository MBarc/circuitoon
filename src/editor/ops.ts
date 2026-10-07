// Immutable diagram edits. Every function returns a new Diagram and never mutates its input,
// so the store can keep old versions for undo.
import { portOf, usbEndsFor } from '../format/usb.ts'
import { ANNOTATION_LABEL_MAX, ANNOTATION_TEXT_MAX, COORD_LIMIT, type Connection, type Diagram, type Endpoint, type PartInstance, colorFamily, moduleOf } from '../format/diagram.ts'
import { isBoard, isNetLabel, layoutModule, moduleSettings, partSetting, pinCaps, type ModuleDef } from '../format/module.ts'
import { FLAG_MAX_CHARS, LABEL_VALUE, labelName } from '../format/netLabels.ts'
import { type Plug, type Seat, mountIssues, plugsOf, seatOf, seatOn } from '../format/breadboard.ts'
import { bodyRect, pivot, rotateVec, type Rect, type Rotation } from '../format/geometry.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { editableParams, paramValue } from '../format/values.ts'
import { normalizeEnds, type WireEnds } from '../format/cables.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { GPIO_CYCLE, GPIO_STATES, type GpioState, contactPosition, gpioProblem, gpioState, isActive, switchGroups } from '../format/simState.ts'
import { simOf, withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { PartCode } from '../format/code.ts'

export interface Selection {
  parts: string[]
  wires: string[]
  /** Selected frames and notes, by uid; absent means none. */
  annotations?: string[]
}
export const EMPTY_SELECTION: Selection = { parts: [], wires: [] }

export interface WireStyle {
  color: string
  gauge: number
  /** Cable ends for the next wire drawn; none means a plain wire. */
  ends?: WireEnds
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
  // Mains families (spec section 4). Each is anchored to its own id prefix, and they come before the
  // older rules so a mains part is never caught by the unanchored "switch" rule; switches keep S and
  // relays keep K.
  [/^outlet-/, 'XS'],
  [/^plug-/, 'XP'],
  [/^(charger-|adapter-|hlk-|irm-)/, 'PS'],
  [/^lamp-holder-/, 'E'],
  [/^fuse-holder-/, 'F'],
  [/^ssr-/, 'K'],
  [/^(terminal-block-|wago-)/, 'X'],
  [/^potentiometer/, 'RV'],
  [/^resistor/, 'R'],
  [/^capacitor/, 'C'],
  [/^led/, 'D'],
  [/^ws2812/, 'D'],
  [/button|switch/, 'S'],
  [/^battery/, 'BT'],
  [/^(breadboard|power-rail)/, 'BB'],
  [/^(lcd|oled|tft)-/, 'DS'],
  [/^(piezo|buzzer)/, 'BZ'],
  [/^relay/, 'K'],
  [/^servo/, 'M'],
  [/^(jst-|dupont-|usb-panel-)/, 'J'],
  [/^mic-/, 'MK'],
  [/^net-label$/, 'NL'],
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

/**
 * The board part `p` is validly mounted on, looked up in `byUid`: a board, not `p` itself, and a
 * mount with no `mountIssues` entry (every leg on a free hole). A board mounted on a board (a
 * hand-edited file) is never carried; neither is a mount that plugs nothing, which stays where it is.
 */
function carrierOf(d: Diagram, p: PartInstance, byUid: Map<string, PartInstance>, invalid: Set<string>): PartInstance | undefined {
  if (!p.mount || p.mount.board === p.uid || invalid.has(p.uid) || isBoard(moduleOf(d, p.module))) return undefined
  const board = byUid.get(p.mount.board)
  return board && isBoard(moduleOf(d, board.module)) ? board : undefined
}

/** Parts that a board among `uids` validly carries, mapped to that board. */
function carriedBy(d: Diagram, uids: string[]): Map<string, PartInstance> {
  const s = new Set(uids)
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const invalid = new Set(mountIssues(d).map((i) => i.part))
  const carried = new Map<string, PartInstance>()
  for (const p of d.parts) {
    const board = p.mount && s.has(p.mount.board) ? carrierOf(d, p, byUid, invalid) : undefined
    if (board) carried.set(p.uid, board)
  }
  return carried
}

/** The given parts plus every part validly mounted on a board among them, each once, in diagram order. */
export function withMounted(d: Diagram, uids: string[]): string[] {
  const s = new Set(uids)
  const carried = carriedBy(d, uids)
  return d.parts.filter((p) => s.has(p.uid) || carried.has(p.uid)).map((p) => p.uid)
}

/**
 * The dragged or rotated parts whose mounts get re-checked: `uids` without the parts a board
 * among them carries (those stay on their board). Used by the drag highlight and the drop.
 */
export function settlingOf(d: Diagram, uids: string[]): string[] {
  const carried = carriedBy(d, uids)
  return uids.filter((u) => !carried.has(u))
}

/**
 * The part of a move (dx, dy) that keeps every point within the file's +-COORD_LIMIT, so what moves
 * stays one rigid block and a saved file loads back unchanged (past the limit a part would be
 * clamped and a route dropped on load, and a frame or note would refuse the load). A point already
 * beyond the limit never forces a move the other way.
 */
export function withinLimit(points: [number, number][], dx: number, dy: number): [number, number] {
  if (!points.length) return [dx, dy]
  const axis = (v: number, at: number) => {
    // A loop, not Math.min(...), so a very large selection cannot overflow the call stack.
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      min = Math.min(min, p[at])
      max = Math.max(max, p[at])
    }
    const lo = Math.min(0, -COORD_LIMIT - min)
    const hi = Math.max(0, COORD_LIMIT - max)
    return Math.min(hi, Math.max(lo, v)) || 0
  }
  return [axis(dx, 0), axis(dy, 1)]
}

/**
 * Moves parts; a board carries every part mounted on it, so its legs stay in the same holes. A
 * hand-shaped wire whose two ends both move (on moved parts, or on holes of a moved board) moves
 * with them, bends and all; any other wire keeps its bends and only its end segments stretch.
 */
export function moveParts(d: Diagram, uids: string[], wantDx: number, wantDy: number): Diagram {
  if (!wantDx && !wantDy) return d
  const s = new Set(withMounted(d, uids))
  const carried = (c: Connection) => c.route !== undefined && s.has(c.from.part) && s.has(c.to.part)
  const points = [
    ...d.parts.filter((p) => s.has(p.uid)).map((p): [number, number] => [p.x, p.y]),
    ...d.connections.filter(carried).flatMap((c) => c.route!),
  ]
  const [dx, dy] = withinLimit(points, wantDx, wantDy)
  if (!dx && !dy) return d
  return {
    ...d,
    parts: d.parts.map((p) => (s.has(p.uid) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    connections: d.connections.some(carried)
      ? d.connections.map((c) => (carried(c) ? { ...c, route: c.route!.map(([x, y]) => [x + dx, y + dy] as [number, number]) } : c))
      : d.connections,
  }
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

const turn = (r: Rotation | undefined) => (((r ?? 0) + 90) % 360) as Rotation

/**
 * Where part `p` goes when its board turns a quarter clockwise about the board's pivot: its own
 * pivot swings around the board's, so every leg lands on the hole it was in.
 */
function swungAbout(p: PartInstance, m: ModuleDef, board: PartInstance, bm: ModuleDef): { x: number; y: number } {
  const lay = layoutModule(m)
  const c = pivot(lay.w, lay.h)
  const blay = layoutModule(bm)
  const bc = pivot(blay.w, blay.h)
  const bx = board.x + bc.x
  const by = board.y + bc.y
  const v = rotateVec({ x: p.x + c.x - bx, y: p.y + c.y - by }, 90)
  return { x: bx + v.x - c.x, y: by + v.y - c.y }
}

/**
 * Rotates each part 90 degrees clockwise about its own pivot. A rotated board turns its mounted
 * parts with it (about the board's pivot), so they stay seated. A rotated plug-in device settles as
 * if dropped (Ruling 41): turned into a socket it fits it plugs in, turned out of it it comes out,
 * all in the one edit. Any other rotated part keeps its mount only while it still fits; rotating
 * never mounts it.
 */
export function rotateParts(d: Diagram, uids: string[]): Diagram {
  const s = new Set(uids)
  const carried = carriedBy(d, uids)
  const parts = d.parts.map((p) => {
    const board = carried.get(p.uid)
    const m = moduleOf(d, p.module)
    const bm = board && moduleOf(d, board.module)
    if (board && m && bm) return { ...p, ...swungAbout(p, m, board, bm), rotation: turn(p.rotation) }
    return s.has(p.uid) ? { ...p, rotation: turn(p.rotation) } : p
  })
  const own = uids.filter((u) => !carried.has(u))
  const isPlug = (u: string) => {
    const m = moduleOf(d, d.parts.find((p) => p.uid === u)?.module ?? '')
    return !!m && !!mainsOf(m).plug
  }
  const kept = settleMounts({ ...d, parts }, own.filter((u) => !isPlug(u)), 'keep')
  return settleMounts(kept, own.filter(isPlug), 'drop')
}

const within = (r: Rect, box: Rect) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h

/**
 * What a selection rectangle (world px) picks, added to `base`: every part whose body and every
 * frame or note whose whole drawn box lies inside, then every wire whose two ends are both on a
 * selected part. Each uid appears once, the base's first; the `annotations` key only when non-empty.
 */
export function marqueeSelection(d: Diagram, box: Rect, base: Selection = EMPTY_SELECTION): Selection {
  const parts = new Set(base.parts)
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (m && within(bodyRect(p, layoutModule(m)), box)) parts.add(p.uid)
  }
  const notes = new Set(base.annotations ?? [])
  for (const a of d.annotations ?? []) if (within(annotationRect(a), box)) notes.add(a.uid)
  const wires = new Set(base.wires)
  for (const c of d.connections) if (parts.has(c.from.part) && parts.has(c.to.part)) wires.add(c.uid)
  const sel: Selection = { parts: [...parts], wires: [...wires] }
  return notes.size ? { ...sel, annotations: [...notes] } : sel
}

export function deleteSelection(d: Diagram, sel: Selection): Diagram {
  const parts = new Set(sel.parts)
  const wires = new Set(sel.wires)
  const notes = new Set(sel.annotations ?? [])
  const { probes: before, ...rest } = d
  const probes = (before ?? []).filter((p) => !parts.has(p.at.part))
  return {
    ...rest,
    // A deleted board's parts stay on the sheet, unmounted.
    parts: d.parts.filter((p) => !parts.has(p.uid)).map((p) => (p.mount && parts.has(p.mount.board) ? withoutMount(p) : p)),
    connections: d.connections.filter((c) => !wires.has(c.uid) && !parts.has(c.from.part) && !parts.has(c.to.part)),
    // Frames and notes are only rewritten when some are selected, so the key never appears from nothing.
    ...(d.annotations && notes.size ? { annotations: d.annotations.filter((a) => !notes.has(a.uid)) } : {}),
    ...(probes.length ? { probes } : {}),
  }
}

/** Whether `ep` names a hole group (its `hole` counts) rather than a pin (a stray `hole` means nothing). */
function isHoleEnd(d: Diagram, ep: Endpoint): boolean {
  const part = d.parts.find((p) => p.uid === ep.part)
  const m = part && moduleOf(d, part.module)
  return !!m?.holes?.some((g) => g.name === ep.pin)
}

/**
 * Same part, same pin or hole group, and for a hole group the same hole (a missing hole is hole
 * 0). A pin end ignores `hole`: only a hole group has holes.
 */
export const sameEndpoint = (d: Diagram, a: Endpoint, b: Endpoint): boolean =>
  a.part === b.part && a.pin === b.pin && ((a.hole ?? 0) === (b.hole ?? 0) || !isHoleEnd(d, a))

export function addWire(d: Diagram, from: Endpoint, to: Endpoint, style: WireStyle): { diagram: Diagram; uid: string } | null {
  if (sameEndpoint(d, from, to)) return null
  if (d.connections.some((c) => (sameEndpoint(d, c.from, from) && sameEndpoint(d, c.to, to)) || (sameEndpoint(d, c.from, to) && sameEndpoint(d, c.to, from)))) return null
  const uid = nextUid(d, 'w')
  // Two USB ports get a USB cable whose plugs fit them, in a black jacket, or (a plug into a socket)
  // no cable at all: USB design 2.1 and 2.2. Any other wire takes the new-wire style.
  const [a, b] = [portOf(d, from), portOf(d, to)]
  if (a && b) {
    const usbEnds = usbEndsFor(a.usb, b.usb)
    const cable: Connection = { uid, from, to, color: 'black', gauge: style.gauge, ...(usbEnds ? { ends: usbEnds } : {}) }
    return { uid, diagram: { ...d, connections: [...d.connections, cable] } }
  }
  const ends = normalizeEnds(style.ends)
  const wire: Connection = { uid, from, to, color: style.color, gauge: style.gauge, ...(ends ? { ends } : {}) }
  return { uid, diagram: { ...d, connections: [...d.connections, wire] } }
}

/**
 * Moves one end of an existing wire onto a different pin, keeping its color, gauge and label. A
 * hand-shaped wire becomes automatic again, since its bends were made for the old pin. An end moved
 * onto or off a USB port gets new cable ends: the USB cable (or plug-in) for two ports, else the
 * new-wire `style`'s ends (a plain wire without one). Refused (returns null) for a missing wire, a self-loop, dropping back onto the pin the
 * end is already on, or a duplicate of another wire's endpoints in either direction.
 */
export function reconnectWire(d: Diagram, uid: string, end: 'from' | 'to', target: Endpoint, style?: WireStyle): Diagram | null {
  const wire = d.connections.find((c) => c.uid === uid)
  if (!wire) return null
  const current = wire[end]
  const other = wire[end === 'from' ? 'to' : 'from']
  if (sameEndpoint(d, target, other)) return null
  if (sameEndpoint(d, target, current)) return null
  const from = end === 'from' ? target : wire.from
  const to = end === 'to' ? target : wire.to
  const dup = d.connections.some(
    (c) => c.uid !== uid && ((sameEndpoint(d, c.from, from) && sameEndpoint(d, c.to, to)) || (sameEndpoint(d, c.from, to) && sameEndpoint(d, c.to, from))),
  )
  if (dup) return null
  const [a, b] = [portOf(d, from), portOf(d, to)]
  const recable = portOf(d, current) !== null || portOf(d, target) !== null
  const ends = !recable ? wire.ends : a && b ? usbEndsFor(a.usb, b.usb) : normalizeEnds(style?.ends)
  return {
    ...d,
    connections: d.connections.map((c) => {
      if (c.uid !== uid) return c
      const { route: _dropped, ends: _ends, ...rest } = c
      return { ...rest, [end]: target, ...(ends ? { ends } : {}) }
    }),
  }
}

export function updatePart(d: Diagram, uid: string, patch: { designator?: string }): Diagram {
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }
}

/** Longest net label name the editor stores. */
export const LABEL_NAME_MAX = FLAG_MAX_CHARS * 2

/**
 * Names net label `uid` (trimmed, at most LABEL_NAME_MAX characters); a blank name removes the stored
 * one. Every label of the new name joins its net at once (the netlist reads names). Same diagram for
 * the same name, a missing part or a part that is not a label.
 */
export function renameLabel(d: Diagram, uid: string, name: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part || !isNetLabel(moduleOf(d, part.module))) return d
  const next = name.trim().slice(0, LABEL_NAME_MAX)
  if (next === labelName(part) && (next !== '' || part.values?.[LABEL_VALUE] === undefined)) return d
  const { [LABEL_VALUE]: _old, ...rest } = part.values ?? {}
  const values = next ? { ...rest, [LABEL_VALUE]: next } : rest
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { values: _v, ...q } = p
      return Object.keys(values).length ? { ...q, values } : q
    }),
  }
}

/** Edits a wire. A colour set here was chosen on purpose, so it is marked `colorSet` (the colour rules judge it). */
export function updateWire(d: Diagram, uid: string, patch: { color?: string; gauge?: number; label?: string }): Diagram {
  const set = patch.color !== undefined ? { colorSet: true as const } : {}
  return { ...d, connections: d.connections.map((c) => (c.uid === uid ? { ...c, ...patch, ...set } : c)) }
}

/**
 * The new-wire style after a wire's colour or gauge was edited: the gauge carries over, and the
 * colour too unless it reads as black or red. Fixing a ground wire to black or a supply wire to red
 * must not make every next signal wire black or red (those take their colour by role anyway).
 */
export function carryWireStyle(style: WireStyle, patch: { color?: string; gauge?: number }): WireStyle {
  const color = patch.color !== undefined && colorFamily(patch.color) === 'other' ? patch.color : style.color
  return { ...style, color, gauge: patch.gauge ?? style.gauge }
}

/**
 * Moves frames and notes; returns `d` itself for a zero move. A frame moves alone, not its parts.
 * The move stops at the file's coordinate limit, where a frame or note would refuse the load.
 */
export function moveAnnotations(d: Diagram, uids: string[], wantDx: number, wantDy: number): Diagram {
  if ((!wantDx && !wantDy) || !d.annotations) return d
  const s = new Set(uids)
  const [dx, dy] = withinLimit(d.annotations.filter((a) => s.has(a.uid)).map((a): [number, number] => [a.x, a.y]), wantDx, wantDy)
  if (!dx && !dy) return d
  return { ...d, annotations: d.annotations.map((a) => (s.has(a.uid) ? { ...a, x: a.x + dx, y: a.y + dy } : a)) }
}

/** Sets a frame's label or a note's text, clipped to the file limits; returns `d` itself when nothing changes. */
export function updateAnnotation(d: Diagram, uid: string, patch: { label?: string; text?: string }): Diagram {
  const a = d.annotations?.find((x) => x.uid === uid)
  if (!a) return d
  const next = { ...a }
  if (patch.label !== undefined) {
    const label = patch.label.slice(0, ANNOTATION_LABEL_MAX)
    if (label) next.label = label
    else delete next.label
  }
  if (patch.text !== undefined) next.text = patch.text.slice(0, ANNOTATION_TEXT_MAX)
  if (next.label === a.label && next.text === a.text && ('label' in next) === ('label' in a)) return d
  return { ...d, annotations: d.annotations!.map((x) => (x === a ? next : x)) }
}

/**
 * Sets the cable ends of every wire in `uids` (bare ends are not stored; all bare removes the
 * key). Returns the same diagram when no wire changes, so a no-op makes no undo step.
 */
export function setWireEnds(d: Diagram, uids: string[], ends: WireEnds | undefined): Diagram {
  const want = normalizeEnds(ends)
  const set = new Set(uids)
  let changed = false
  const connections = d.connections.map((c) => {
    if (!set.has(c.uid)) return c
    const have = normalizeEnds(c.ends)
    if (have?.from === want?.from && have?.to === want?.to && ('ends' in c) === !!want) return c
    changed = true
    const { ends: _old, ...rest } = c
    return want ? { ...rest, ends: want } : rest
  })
  return changed ? { ...d, connections } : d
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
  if (paramValue(part, m, param) === value && editableParams(m).some((p) => p.name === param && p.unit === unit)) return d
  const values = { ...part.values, [param]: { value, unit } }
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, values } : p)) }
}

/** Removes a part's stored value for `param`, back to the module default (unknown for an optional param). Same diagram when none is stored. */
export function clearPartValue(d: Diagram, uid: string, param: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part?.values || !Object.hasOwn(part.values, param)) return d
  const { [param]: _gone, ...rest } = part.values
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { values: _old, ...q } = p
      return Object.keys(rest).length ? { ...q, values: rest } : q
    }),
  }
}

/** Sets one of a part's enumerated settings. Same diagram when the choice is not offered or is already in effect. */
export function updatePartSetting(d: Diagram, uid: string, name: string, choice: string): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return d
  const offered = moduleSettings(m)
  if (!Object.hasOwn(offered, name) || !offered[name].includes(choice) || partSetting(part, m, name) === choice) return d
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, settings: { ...p.settings, [name]: choice } } : p)) }
}

/** A sheet module as the simulation reads it: a built-in part takes the library's sim (withLibraryData), so an old sheet's copy still has its GPIOs. */
export function simModule(d: Diagram, id: string): ModuleDef | undefined {
  const m = moduleOf(d, id)
  return m && withLibraryData(m, libraryLookup)
}

/** The GPIO states a pin can take: its caps and the module's sim.gpio (a pull it does not state) forbid the rest. */
export function gpioChoices(m: ModuleDef, pin: string): GpioState[] {
  return GPIO_STATES.filter((s) => gpioProblem(pinCaps(m, pin), s, simOf(m)?.gpio) === null)
}

/** Sets one `values` key of a part (a switch position, a GPIO state), or removes it with undefined. Same diagram when nothing changes. */
export function setSimValue(d: Diagram, uid: string, key: string, value: string | undefined): Diagram {
  if (value === undefined) return clearPartValue(d, uid, key)
  const part = d.parts.find((p) => p.uid === uid)
  if (!part || part.values?.[key] === value) return d
  return { ...d, parts: d.parts.map((p) => (p.uid === uid ? { ...p, values: { ...p.values, [key]: value } } : p)) }
}

/** Spec 6.3: a click on a latching switch while simulating flips its first switch group and saves it; null for a button, a relay or a part with no switch. */
export function flipContact(d: Diagram, uid: string): Diagram | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  const g = m ? switchGroups(m).find((x) => x.kind === 'switch' && !x.momentary) : undefined
  if (!part || !m || !g) return null
  const active = isActive(contactPosition(part, m, g))
  return setSimValue(d, uid, `contact.${g.id}`, g.changeover ? (active ? 'nc' : 'no') : active ? 'open' : 'closed')
}

/** The momentary group a press holds closed (spec 4.0: never saved), or null. */
export function momentaryGroup(d: Diagram, uid: string): string | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  return (m && switchGroups(m).find((x) => x.momentary)?.id) ?? null
}

/**
 * Spec 6.3: a click on a GPIO pin cycles input, high, low, skipping states the pin cannot take (an
 * output-only pin with none set starts at high). Null for a pin that is not GPIO-capable or has nothing to cycle to.
 */
export function cycleGpio(d: Diagram, uid: string, pin: string): Diagram | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && simModule(d, part.module)
  if (!part || !m || !simOf(m)?.gpio?.pins.includes(pin)) return null
  const now = gpioState(part, m, pin)
  const allowed = gpioChoices(m, pin).filter((s) => GPIO_CYCLE.includes(s))
  const next = allowed[(allowed.indexOf(now ?? allowed[allowed.length - 1]) + 1) % allowed.length]
  return next && next !== now ? setSimValue(d, uid, `gpio.${pin}`, next) : null
}

/** Sets a board's code (firmware spec 3.1), or removes it with undefined. Same diagram when nothing changes. */
export function setPartCode(d: Diagram, uid: string, code: PartCode | undefined): Diagram {
  const part = d.parts.find((p) => p.uid === uid)
  if (!part) return d
  if (code === undefined ? part.code === undefined : part.code !== undefined && part.code.language === code.language && part.code.source === code.source && part.code.file === code.file) return d
  return {
    ...d,
    parts: d.parts.map((p) => {
      if (p.uid !== uid) return p
      const { code: _old, ...rest } = p
      return code === undefined ? rest : { ...rest, code }
    }),
  }
}
