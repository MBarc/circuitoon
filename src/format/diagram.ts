// Diagram format (circuitoon-diagram/1): types plus the wire geometry the renderer needs.

import { GRID, type ModuleDef, PARAM_RULES, isBoard, isNetLabel, layoutModule, moduleSettings, validateModule, validParamValue, isObj, isNum } from './module.ts'
import { type Pt, type Rect, type Rotation, type WorldPin, bodyRect, simplify, toWorld, worldHoles, worldPins } from './geometry.ts'
import { type RouteRequest, CLEARANCE, SEARCH_MARGIN, addToOccupancy, inGrown, Occupancy, occupancyOf, onGrid, PointIndex, routeOrthogonal } from './router.ts'
import { manualRouteBlocked, tidy } from './wireEdit.ts'
import { coveredHoles, holeIndex, mountIssues, plugOfPin, plugsOf } from './breadboard.ts'
import { type CableEndDraw, END_SIZE, endKind, endPlacement, isEndKind, normalizeEnds, type WireEnds } from './cables.ts'
import { placedCaptionBox, tipLabelBoxes } from '../render/captionBox.ts'
import { seatedLabels } from './seatedLabels.ts'
import { LABEL_VALUE, flagRect } from './netLabels.ts'
import { annotationRect, frameTab } from '../render/annotationGeometry.ts'
import { type BoardStrip, exitDirt, holeExits } from './boardEntry.ts'

/** How every load warning about a dropped value override ends: the part now shows its module
 * default instead of the value the file asked for. The editor lists these warnings first. */
export const VALUE_DROPPED = 'it was dropped and the module default is shown'

export const DIAGRAM_FORMAT = 'circuitoon-diagram/1'

export interface PartInstance {
  uid: string
  designator: string
  module: string
  x: number
  y: number
  rotation?: Rotation
  values?: Record<string, unknown>
  /** Enumerated choices from the module's `electrical.settings` (a fuse holder's "fitted" or "absent"). */
  settings?: Record<string, string>
  /** The board this part is plugged into. Its pins join the hole groups their plug points sit on. */
  mount?: { board: string }
}
export interface Endpoint {
  part: string
  pin: string
  offset?: number
  /** Which hole of a hole group the wire ends in (default 0). */
  hole?: number
}
export interface Connection {
  uid: string
  from: Endpoint
  to: Endpoint
  color?: string
  /**
   * True when the colour was chosen on purpose (picked in the Inspector, or given by the netlist or
   * the layout); only such a colour is judged by the wire colour rules. A wire drawn in the editor
   * stores the new-wire colour without it.
   */
  colorSet?: true
  gauge?: number
  label?: string
  route?: [number, number][]
  /** What each end physically is (a Dupont pin, an alligator clip); omitted ends are bare wire. */
  ends?: WireEnds
  /**
   * True on a wire the layout added to realize a connection (a wire into a strip hole, a jumper
   * between strips, a rail wire): routing infrastructure, which verification never counts as an
   * intended component connection.
   */
  routing?: boolean
}
export interface Annotation {
  uid: string
  type: 'frame' | 'text'
  x: number
  y: number
  w?: number
  h?: number
  label?: string
  text?: string
}
export interface Diagram {
  format: typeof DIAGRAM_FORMAT
  title: string
  modules: Record<string, ModuleDef>
  parts: PartInstance[]
  connections: Connection[]
  annotations?: Annotation[]
  /**
   * The netlist (circuitoon-netlist/1) the sheet was laid out from. Kept through every edit, so a
   * later check re-verifies the circuit against it. Loaded as opaque data; `verify` parses it.
   */
  intent?: unknown
  /** Notes stored with the sheet, such as the mains notice on every exported mains sheet (spec 6). */
  notes?: string[]
}

export const NAMED_COLORS: Record<string, string> = {
  red: '#E0483E',
  black: '#2B2F36',
  blue: '#3D6FD6',
  green: '#2F9E6E',
  yellow: '#F4B400',
  orange: '#F48C06',
  white: '#FFFFFF',
  purple: '#8E5BD6',
  gray: '#9AA2AD',
  brown: '#8B5A2B',
  pink: '#F07AB0',
}

/** Two-colour insulation (the IEC earth wire): a base colour with the second one striped over it. */
export const STRIPED_COLORS: Record<string, [string, string]> = { 'green-yellow': ['#2F9E6E', '#F4B400'] }

/** Named color, two-colour name (its base) or #RRGGBB; anything else falls back to black. */
export function wireColor(c: string | undefined): string {
  if (!c) return NAMED_COLORS.black
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  const key = c.toLowerCase()
  if (Object.hasOwn(STRIPED_COLORS, key)) return STRIPED_COLORS[key][0]
  return Object.hasOwn(NAMED_COLORS, key) ? NAMED_COLORS[key] : NAMED_COLORS.black
}

/**
 * Which of the low-voltage convention's reserved colours a stored wire colour reads as: `black`
 * (ground), `red` (a positive supply) or `other`. Named black and red count, and so does a custom
 * hex a person would call black (very dark, little colour) or red (a saturated hue within 15
 * degrees of pure red, neither pale nor near black). Orange, pink and brown are `other`.
 */
export function colorFamily(c: string): 'black' | 'red' | 'other' {
  const key = c.toLowerCase()
  if (key === 'black' || key === 'red') return key
  if (!/^#[0-9a-f]{6}$/.test(key)) return 'other'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(key.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  if (l < 0.25 && (s < 0.35 || max < 0.15)) return 'black'
  if (max !== r || s < 0.5 || l < 0.25 || l > 0.7) return 'other'
  const hue = 60 * ((g - b) / (max - min))
  return Math.abs(hue) <= 15 ? 'red' : 'other'
}

/** The stripe colour of a two-colour wire, or null. */
export function wireStripe(c: string | undefined): string | null {
  const key = c?.toLowerCase()
  return key && Object.hasOwn(STRIPED_COLORS, key) ? STRIPED_COLORS[key][1] : null
}

/** Drawn width in px for an AWG gauge (16 to 30, default 22). Thicker wire, smaller number. */
export function wireWidth(gauge = 22): number {
  const g = Math.min(30, Math.max(16, gauge))
  return Math.max(1.5, 3 * Math.pow(1.1229, 22 - g))
}

export interface WireRoute {
  points: Pt[]
  /** True when no clear route exists and the wire is drawn as an orthogonal L fallback (dashed). */
  blocked: boolean
  /**
   * True when the wire runs over used holes (a wire end, a leg, a hole under a part's body) of a
   * board strip it does not end in (no route cleared them, or a hand-drawn route crosses them):
   * drawn there, it reads as plugged in. Empty holes never set it (Ruling C1). Absent otherwise.
   */
  fallback?: true
  /**
   * True when an auto-routed wire runs across a breadboard with parts mounted on it that it does not
   * end on (or past the straight run in from an edge, where it does): no route kept off the board,
   * so it crosses it rather than block (Ruling W1). Absent otherwise.
   */
  overBoard?: true
  /** True when no route kept off every earlier wire's line, so this one runs along one (Ruling W1). */
  overlap?: true
}
/** Route per connection uid; null means an endpoint names a missing part or pin. */
export type Routes = Map<string, WireRoute | null>

/**
 * The embedded module a part uses. Own keys only, so a module named "constructor" or
 * "toString" in a file is simply missing rather than an Object prototype member.
 */
export function moduleOf(d: Pick<Diagram, 'modules'>, id: string): ModuleDef | undefined {
  return Object.hasOwn(d.modules, id) ? d.modules[id] : undefined
}

/** Part bodies wires must route around. A module with `obstacle: false` (a breadboard) is not one. */
export function partObstacles(d: Diagram): Rect[] {
  return d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    // A net label is as big as its drawn flag (its two-unit body would cover the next header pin's label).
    if (m && isNetLabel(m)) return [flagRect(p, m, true)]
    return m && m.obstacle !== false ? [bodyRect(p, layoutModule(m))] : []
  })
}

/** A wire end in world px: where the wire attaches, and the way it must leave (null: any way, a hole). */
export interface ResolvedEnd {
  end: Pt
  dir: Pt | null
}

/**
 * Resolves a connection end. A pin resolves to its stub tip and outward direction; a hole group
 * resolves to the center of hole `ep.hole` (default 0), which a wire may leave in any direction.
 * A pin whose leg is validly plugged into a board (Ruling 25) resolves to that leg's hole, also
 * with no direction: a jumper to that pin goes into the same strip as the leg, and the stub tip
 * would sit over the neighbouring hole. Null when the part, pin, group or hole does not exist.
 */
export function resolveEndpoint(d: Diagram, ep: Endpoint): ResolvedEnd | null {
  const part = d.parts.find((p) => p.uid === ep.part)
  const mod = part && moduleOf(d, part.module)
  if (!part || !mod) return null
  const group = mod.holes?.find((g) => g.name === ep.pin)
  if (group) {
    const local = ep.offset === undefined ? group.at[ep.hole ?? 0] : undefined
    return local ? { end: toWorld(part, layoutModule(mod), { x: local[0], y: local[1] }), dir: null } : null
  }
  const pin = worldPins(part, mod).find((p) => p.name === ep.pin)
  if (!pin || !validOffset(ep.offset, pin.bus)) return null
  const hole = part.mount ? plugOfPin(d, part.uid, pin.name) : null
  return hole ? { end: hole, dir: null } : { end: pin.end, dir: pin.dir }
}

/**
 * Whether an endpoint `offset` names a real position: none at all, or on a bus pin a whole number
 * from 0 to bus.length - 1. An offset on a pin that is not a bus means nothing, so it is invalid too.
 */
export function validOffset(offset: number | undefined, bus: { length: number } | undefined): boolean {
  return offset === undefined || (!!bus && Number.isInteger(offset) && offset >= 0 && offset < bus.length)
}

/** Where a pin's hit target sits in world px, so pressing, hovering or dropping there picks that pin. */
export interface PinTarget {
  name: string
  label?: string
  at: Pt
}

/**
 * A part's pin hit targets: at the stub tip, or for a validly plugged leg on the leg's own hole
 * (where `resolveEndpoint` puts its wire end). The stub tip of a plugged leg sits over the
 * neighbouring hole, so a target there would catch a wire aimed at that hole's strip.
 */
export function pinTargets(d: Diagram, part: PartInstance, m: ModuleDef): PinTarget[] {
  return worldPins(part, m).map((wp) => ({
    name: wp.name,
    label: wp.label,
    at: (part.mount && plugOfPin(d, part.uid, wp.name)) || wp.end,
  }))
}

/**
 * A broken connection's one resolvable end, so the editor can still draw a short repair stub
 * there (the other end names a missing part, pin, group or hole and has no coordinate at all).
 * Null when neither end resolves.
 */
export function brokenStub(d: Diagram, c: Connection): ResolvedEnd | null {
  return resolveEndpoint(d, c.from) ?? resolveEndpoint(d, c.to)
}

/**
 * A hand-routed wire keeps its stored bends; only its end segments stretch to reach a moved
 * pin. Where a pin tip and its neighbouring bend no longer line up, a corner is added so the
 * wire still leaves the pin along its stub, and every segment stays horizontal or vertical.
 * Two stored bends that do not line up (a hand-edited file) get a corner between them too,
 * horizontal first. Collinear bends are kept (the user may have split a run to move its halves
 * separately), so this polyline is also what the editing handles work on; only spikes and
 * repeats are dropped.
 */
function manualPoints(a: ResolvedEnd, b: ResolvedEnd, route: [number, number][]): Pt[] {
  const bends = route.map(([x, y]) => ({ x, y }))
  const corner = (pin: ResolvedEnd, next: Pt | undefined): Pt[] => {
    if (!next || next.x === pin.end.x || next.y === pin.end.y) return []
    // A hole end may leave any way; it turns horizontally first, like a pin on a left or right edge.
    const horizontal = pin.dir === null || pin.dir.x !== 0
    return [horizontal ? { x: next.x, y: pin.end.y } : { x: pin.end.x, y: next.y }]
  }
  // No bends left (every one removed by hand): still one corner, never a diagonal.
  const head = corner(a, bends.length ? bends[0] : b.end)
  const tail = bends.length ? corner(b, bends[bends.length - 1]) : []
  const pts = [a.end, ...head, ...bends, ...tail, b.end]
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    if (p.x !== q.x && p.y !== q.y) out.push({ x: q.x, y: p.y })
    out.push(q)
  }
  return tidy(out)
}

/**
 * The obstacles one wire must avoid: all of them, minus any body over one of its hole ends. A
 * hole under a part (a leg's hole, a hole under a DIP body) has no exit direction and every grid
 * node around it is inside that body, so the wire may leave through the part covering it, as a
 * real jumper slides out from under one. Only this wire's obstacle list changes; every other
 * wire still routes around the part. A pin end always has an exit (its stub), so it drops nothing.
 */
export function obstaclesFor(obstacles: Rect[], a: ResolvedEnd, b: ResolvedEnd): Rect[] {
  const keep = obstacleFilter(a, b)
  return keep ? obstacles.filter(keep) : obstacles
}

/**
 * The test behind `obstaclesFor`, as a predicate (true keeps the body as an obstacle for this
 * wire), or null when the wire has no hole end and keeps every body.
 */
function obstacleFilter(a: ResolvedEnd, b: ResolvedEnd): ((r: Rect) => boolean) | null {
  // The router starts a hole end at its grid node, so that is the point a body must cover (a
  // board placed off the grid has its holes between grid lines).
  const free = [a, b].filter((e) => e.dir === null).map((e) => onGrid(e.end, GRID))
  if (!free.length) return null
  return (r) => !free.some((p) => inGrown(p, r))
}

/**
 * Stand-in for a wire with no clear route: an L leaving `a` along its stub (vertically from a top
 * or bottom pin, horizontally from a side pin or a hole), like manualPoints' corner rule.
 */
function blockedPoints(a: ResolvedEnd, b: ResolvedEnd): Pt[] {
  const vertical = a.dir !== null && a.dir.x === 0
  return tidy([a.end, vertical ? { x: a.end.x, y: b.end.y } : { x: b.end.x, y: a.end.y }, b.end])
}

/**
 * The straight run each end of `c` needs before its first bend: its connector's reach rounded up
 * to the grid, on a pin end with a connector (a hole end may leave any way, so it gets none).
 * `facing` marks two pins that face each other on one line: when nothing is in the way, the wire
 * between them is one straight run that both connectors share, even when that line is off the
 * grid. Any other route between them (a detour, a hand-shaped wire) keeps both lead-outs.
 */
function leadsOf(c: Connection, a: ResolvedEnd, b: ResolvedEnd): { leads: [number, number]; facing: boolean } {
  if (!c.ends) return { leads: [0, 0], facing: false }
  const lead = (e: ResolvedEnd, which: 'from' | 'to') =>
    e.dir ? Math.ceil(END_SIZE[endKind(c.ends, which)].reach / GRID) * GRID : 0
  let facing = false
  if (a.dir && b.dir && a.dir.x === -b.dir.x && a.dir.y === -b.dir.y) {
    const dx = b.end.x - a.end.x
    const dy = b.end.y - a.end.y
    facing = a.dir.x !== 0 ? dy === 0 && Math.sign(dx) === a.dir.x : dx === 0 && Math.sign(dy) === a.dir.y
  }
  return { leads: [lead(a, 'from'), lead(b, 'to')], facing }
}

/**
 * Makes a polyline leave its first point straight along `dir` for at least `lead` px. A shorter
 * first run is replaced by a lead-out that then turns toward the next point that is not on it:
 * across first when that point lies behind the lead-out's end, so the wire never doubles back
 * over its own lead.
 */
function withLeadOut(pts: Pt[], dir: Pt | null, lead: number): Pt[] {
  if (!dir || !lead || pts.length < 2) return pts
  const p0 = pts[0]
  const along = (p: Pt) => (p.x - p0.x) * dir.x + (p.y - p0.y) * dir.y
  const onAxis = (p: Pt) => (dir.x !== 0 ? p.y === p0.y : p.x === p0.x)
  if (onAxis(pts[1]) && along(pts[1]) >= lead) return pts
  const tip = { x: p0.x + dir.x * lead, y: p0.y + dir.y * lead }
  let k = 1
  while (k < pts.length - 1 && onAxis(pts[k]) && along(pts[k]) >= 0 && along(pts[k]) <= lead) k++
  const q = pts[k]
  if (onAxis(q)) return pts // straight back over the lead-out: nothing sensible to add
  const ahead = along(q) >= lead
  const corner = ahead ? (dir.x !== 0 ? { x: q.x, y: tip.y } : { x: tip.x, y: q.y }) : dir.x !== 0 ? { x: tip.x, y: q.y } : { x: q.x, y: tip.y }
  return tidy([p0, tip, corner, ...pts.slice(k)])
}

/**
 * The holes in use on every board on the sheet (breadboards, rail strips), by hole group, plus which
 * group each plugged leg sits in. A hole is in use when it holds a wire end or a leg, or lies under
 * a mounted part's body (`coveredHoles`). Ruling C1: an auto-routed wire may cross empty holes
 * straight, like a jumper lying flat, but never runs over a used hole of a group it does not end
 * in: drawn over it, the wire would read as plugged in there.
 */
export interface BoardHoles {
  groups: { key: string; at: Pt[] }[]
  /** Pin key ("part pin") of a plugged leg to its hole group key. */
  legGroup: Map<string, string>
}
const holeGroupKey = (board: string, group: string) => JSON.stringify([board, group])
const legKey = (part: string, pin: string) => JSON.stringify([part, pin])

export function boardHoles(d: Diagram): BoardHoles {
  const boards = new Map<string, { part: PartInstance; m: ModuleDef }>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (m && isBoard(m)) boards.set(p.uid, { part: p, m })
  }
  const legGroup = new Map<string, string>()
  if (!boards.size) return { groups: [], legGroup }
  // Board uid, then group name, to the hole indexes in use.
  const used = new Map<string, Map<string, Set<number>>>()
  const use = (board: string, group: string, hole: number) => {
    let byGroup = used.get(board)
    if (!byGroup) used.set(board, (byGroup = new Map()))
    let holes = byGroup.get(group)
    if (!holes) byGroup.set(group, (holes = new Set()))
    holes.add(hole)
  }
  for (const pl of plugsOf(d)) {
    legGroup.set(legKey(pl.part, pl.pin), holeGroupKey(pl.board, pl.group))
    use(pl.board, pl.group, pl.hole)
  }
  for (const c of coveredHoles(d)) use(c.board, c.group, c.hole)
  for (const c of d.connections)
    for (const e of [c.from, c.to]) if (boards.get(e.part)?.m.holes?.some((g) => g.name === e.pin)) use(e.part, e.pin, e.hole ?? 0)
  const groups: BoardHoles['groups'] = []
  for (const [uid, byGroup] of used) {
    const b = boards.get(uid)
    if (!b) continue
    const idx = holeIndex(b.part, b.m)
    for (const g of idx.groups) {
      const holes = byGroup.get(g.name)
      if (holes) groups.push({ key: holeGroupKey(uid, g.name), at: [...holes].sort((x, y) => x - y).flatMap((i) => (i < g.at.length ? [g.at[i]] : [])) })
    }
  }
  return { groups, legGroup }
}

/** The hole groups wire `c` may run over: those its ends are in (a hole end, or a plugged leg's). */
function ownGroups(c: Connection, legGroup: Map<string, string>): Set<string> {
  const own = new Set<string>()
  for (const e of [c.from, c.to]) {
    own.add(holeGroupKey(e.part, e.pin))
    const leg = legGroup.get(legKey(e.part, e.pin))
    if (leg) own.add(leg)
  }
  return own
}

/**
 * Text on the sheet an auto-routed wire keeps off (amendment A18.3): each part's caption and any pin names it draws past its pin tips (by part
 * uid), each frame's label tab and each text note's box (no owner), as the routing grid nodes they
 * cover, grown by LABEL_PAD so a wire on the next grid line does not graze the text either. A note
 * is opaque: a wire under it would vanish.
 */
export interface LabelPoints {
  captions: Map<string, Pt[]>
  /** Pin names drawn past the tips (a DIP chip), by part: kept off harder than captions, since a hidden pin name can cause a miswire. */
  names?: Map<string, Pt[]>
  tabs: Pt[]
}
const LABEL_PAD = 3

function gridNodesIn(r: Rect): Pt[] {
  const out: Pt[] = []
  for (let y = Math.ceil((r.y - LABEL_PAD) / GRID) * GRID; y <= r.y + r.h + LABEL_PAD; y += GRID)
    for (let x = Math.ceil((r.x - LABEL_PAD) / GRID) * GRID; x <= r.x + r.w + LABEL_PAD; x += GRID) out.push({ x, y })
  return out
}

export function labelPoints(d: Diagram): LabelPoints {
  const captions = new Map<string, Pt[]>()
  const names = new Map<string, Pt[]>()
  // A seated plug-in device and its outlet draw their captions beside the outlet (seatedLabels.ts).
  const seated = seatedLabels(d)
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!m) continue
    captions.set(p.uid, gridNodesIn(placedCaptionBox(p, m, seated.get(p.uid))))
    // Pin names past the tips (a DIP chip) are kept off too, by the same owner (Ruling C3), and give way last.
    const tips = tipLabelBoxes(p, m).flatMap(gridNodesIn)
    if (tips.length) names.set(p.uid, tips)
  }
  const tabs = (d.annotations ?? []).flatMap((a) => (a.type === 'frame' ? (a.label ? gridNodesIn(frameTab(a)) : []) : gridNodesIn(annotationRect(a))))
  return { captions, names, tabs }
}

/**
 * What every auto-routed wire keeps off, indexed once per re-route: board holes by hole group key,
 * and label text by the part whose caption it is ("" for frame tabs and notes, which no wire owns).
 * A wire skips its own groups and captions by key, so nothing is rebuilt per wire.
 */
export interface RouteAvoid {
  holes: PointIndex
  legGroup: Map<string, string>
  text: PointIndex
  /** Pin names past the tips, by part uid. */
  names: PointIndex
  /** Breadboards with parts mounted on them (Ruling W1): their bodies, which only wires ending there enter. */
  boards: { uid: string; rect: Rect }[]
  /** Board each mounted part sits on, by part uid. */
  mountOf: Map<string, string>
  /** The hole groups of each board in use, in world px, by board uid. */
  stripsOf: Map<string, BoardStrip[]>
  /** Holes in use (a wire end, a leg, a hole under a body), as `x,y`. */
  usedHole: Set<string>
  /** The empty holes of boards in use, by hole group key: a wire keeps off their lines where it can (Ruling W1). */
  empties: PointIndex
}

/**
 * Extra room, in px, kept between a wire and a populated board's edge, beyond the router's
 * clearance: the next grid line out, so a wire never reads as lying on the board's frame.
 */
export const BOARD_PAD = 6

/**
 * The boards in use (Ruling W1): with a part mounted on them, or a wire ending in one of their holes;
 * and each mounted part's board. Only a board in use by neither is a bare surface a wire may cross.
 */
export function populatedBoards(d: Diagram): { boards: { uid: string; rect: Rect }[]; mountOf: Map<string, string> } {
  const mountOf = new Map<string, string>()
  for (const p of d.parts) if (p.mount) mountOf.set(p.uid, p.mount.board)
  const hosts = new Set(mountOf.values())
  for (const c of d.connections) for (const e of [c.from, c.to]) if (e.hole !== undefined) hosts.add(e.part)
  const boards: { uid: string; rect: Rect }[] = []
  for (const p of d.parts) {
    if (!hosts.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (m && isBoard(m)) boards.push({ uid: p.uid, rect: bodyRect(p, layoutModule(m)) })
  }
  return { boards, mountOf }
}

const growRect = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })

export function routeAvoid(d: Diagram, holes: BoardHoles = boardHoles(d), labels: LabelPoints = labelPoints(d)): RouteAvoid {
  const hi = new PointIndex()
  for (const g of holes.groups) for (const p of g.at) hi.add(p.x, p.y, g.key)
  const ti = new PointIndex()
  // Part uids are never empty (validateDiagram), so "" is free for text no wire owns.
  for (const p of labels.tabs) ti.add(p.x, p.y, '')
  for (const [uid, pts] of labels.captions) for (const p of pts) ti.add(p.x, p.y, uid)
  const ni = new PointIndex()
  for (const [uid, pts] of labels.names ?? []) for (const p of pts) ni.add(p.x, p.y, uid)
  const pop = populatedBoards(d)
  const stripsOf = new Map<string, BoardStrip[]>()
  for (const b of pop.boards) {
    const part = d.parts.find((p) => p.uid === b.uid)!
    stripsOf.set(b.uid, worldHoles(part, moduleOf(d, part.module)!).map((g) => ({ id: g.name, holes: g.at, rail: !!g.rail })))
  }
  const usedHole = new Set(holes.groups.flatMap((g) => g.at.map((p) => holeSpot(p))))
  const empties = new PointIndex()
  for (const [uid, list] of stripsOf) for (const g of list) for (const p of g.holes) if (!usedHole.has(holeSpot(p))) empties.add(p.x, p.y, holeGroupKey(uid, g.id))
  // The two grid lines around each board in use, where wires ending on it leave its edge: every
  // wire keeps off them where it can (its own way in crosses them straight, from an exempt goal),
  // so no wire lies along another's way into the board.
  for (const b of pop.boards) {
    const r = growRect(b.rect, BOARD_PAD + CLEARANCE)
    for (const k of [1, 2]) {
      const x0 = Math.floor(r.x / GRID) * GRID - (k - 1) * GRID
      const y0 = Math.floor(r.y / GRID) * GRID - (k - 1) * GRID
      const x1 = Math.ceil((r.x + r.w) / GRID) * GRID + (k - 1) * GRID
      const y1 = Math.ceil((r.y + r.h) / GRID) * GRID + (k - 1) * GRID
      for (let x = x0; x <= x1; x += GRID) {
        empties.add(x, y0, ringKey(b.uid))
        empties.add(x, y1, ringKey(b.uid))
      }
      for (let y = y0 + GRID; y < y1; y += GRID) {
        empties.add(x0, y, ringKey(b.uid))
        empties.add(x1, y, ringKey(b.uid))
      }
    }
  }
  return { holes: hi, legGroup: holes.legGroup, text: ti, names: ni, ...pop, stripsOf, usedHole, empties }
}

const holeSpot = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`
const ringKey = (board: string) => `ring ${board}`
/** Two pins facing each other on one line closer than this (px) keep their lead-out runs to themselves. */
const FACING_REACH = 160
/** Most wires laid along another that one routing pass tries to repair (repairOverlaps). */
const REPAIR_MAX = 24

/** True when a straight run from `a` to `b` passes within 3 px of a point of `index` not skipped. */
function runsOver(a: Pt, b: Pt, index: PointIndex, skip: ReadonlySet<string>): boolean {
  return index.some(Math.min(a.x, b.x) - 3, Math.min(a.y, b.y) - 3, Math.max(a.x, b.x) + 3, Math.max(a.y, b.y) + 3, skip, () => true)
}

/** True when any run of the polyline `pts` passes over a point of `index` not skipped. */
function pathRunsOver(pts: Pt[], index: PointIndex, skip: ReadonlySet<string>): boolean {
  return pts.slice(1).some((p, i) => runsOver(pts[i], p, index, skip))
}

export function routeWire(
  d: Diagram,
  c: Connection,
  obstacles: Rect[],
  occupied?: Occupancy,
  avoid: RouteAvoid = routeAvoid(d),
  bundle?: Occupancy,
  shared?: Pt[],
  stubs?: Occupancy,
): WireRoute | null {
  const a = resolveEndpoint(d, c.from)
  const b = resolveEndpoint(d, c.to)
  if (!a || !b) return null
  const ownHoles = ownGroups(c, avoid.legGroup)
  // A wire keeps off every caption, its own parts' too (Ruling W1: wires never cover captions); only
  // a net label it ends on, whose flag it runs into, and its own parts' pin names are its own.
  const ownNames = new Set([c.from.part, c.to.part])
  const ownText = new Set([c.from.part, c.to.part].filter((u) => isNetLabel(moduleOf(d, d.parts.find((p) => p.uid === u)?.module ?? ''))))
  const own = obstaclesFor(obstacles, a, b)
  const { leads, facing } = leadsOf(c, a, b)
  if (c.route) {
    let points = manualPoints(a, b, c.route)
    const [fromLead, toLead] = leads
    if (fromLead || toLead) points = withLeadOut(withLeadOut(points, a.dir, fromLead).reverse(), b.dir, toLead).reverse()
    const anyHoles = avoid.holes.some(...windowOf(a, b, leads), ownHoles, () => true)
    return { points, blocked: manualRouteBlocked(points, own), ...(anyHoles && pathRunsOver(points, avoid.holes, ownHoles) ? { fallback: true as const } : {}) }
  }
  // Ruling W1: populated boards are in the way of every wire but those ending on them; a wire
  // between two holes of one board stays free to run across it.
  const boardOf = (ep: Endpoint, e: ResolvedEnd) => {
    if (e.dir !== null || !avoid.boards.length) return null
    const uid = avoid.mountOf.get(ep.part) ?? ep.part
    return avoid.boards.find((x) => x.uid === uid) ?? null
  }
  const ba = boardOf(c.from, a)
  const bb = boardOf(c.to, b)
  const inside = ba !== null && ba === bb ? ba : null
  const walls = avoid.boards.filter((x) => x !== inside).map((x) => growRect(x.rect, BOARD_PAD))
  let solved: WireRoute | null | undefined
  const plainRoute = () => (solved === undefined ? (solved = solveRoute(a, b, own, leads, facing, ownHoles, ownText, ownNames, { occupied, bundle, shared, stubs }, avoid)) : solved)
  if (!walls.length) return plainRoute() ?? { points: blockedPoints(a, b), blocked: true }
  // The route found without walls stands when it keeps to the rule anyway: off every board in use,
  // but for one straight run from each of its holes on such a board (a part right beside the board).
  // It is tried first for a wire with no end on such a board, or one whose other end is right beside
  // that board; any other wire on a board tries its edge runs first (the search without walls rarely
  // keeps to the rule there).
  const boardEnds = [ba, bb].filter((x): x is { uid: string; rect: Rect } => x !== null && x !== inside)
  const beside = (x: { rect: Rect } | null, other: Pt) => !!x && x !== inside && inGrown(other, x.rect, 40)
  const plainFirst = !boardEnds.length || beside(ba, b.end) || beside(bb, a.end)
  const stripOf = (ep: Endpoint): string | null => {
    if (avoid.stripsOf.get(ep.part)) return ep.pin
    const leg = avoid.legGroup.get(legKey(ep.part, ep.pin))
    return leg ? (JSON.parse(leg) as [string, string])[1] : null
  }
  const onLane = (p: Pt, q: Pt) => {
    if (!occupied?.size) return false
    const bit = p.y === q.y ? 1 : 2
    const n = Math.round((Math.abs(q.x - p.x) + Math.abs(q.y - p.y)) / GRID)
    const sx = Math.sign(q.x - p.x) * GRID
    const sy = Math.sign(q.y - p.y) * GRID
    const g = onGrid(p, GRID)
    for (let k = 0; k < n; k++) if (occupied.at(g.x + sx * k, g.y + sy * k) & bit && occupied.at(g.x + sx * (k + 1), g.y + sy * (k + 1)) & bit) return true
    return false
  }
  /**
   * Each straight way out from hole `p` (endpoint `ep`) of a board in use to its edge (boardEntry.ts):
   * along its strip only from the strip's outer end, else across it. How unclean each is: the holes
   * it passes over, then a run along another wire's line, then one through a part's body. Where the
   * search would start (one grid step out past the edge) is in `end`.
   */
  /** The bodies a straight run out of hole `p` must not cross: all but one the hole lies strictly inside (a leg's hole under its part). */
  const bodiesOff = (p: Pt) => obstacles.filter((r) => !(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h))
  const exitsFor = (board: { uid: string; rect: Rect }, ep: Endpoint, p: Pt) => {
    const r = growRect(board.rect, BOARD_PAD)
    const out = (v: number, lo: boolean) => (lo ? Math.floor((v - CLEARANCE - 1) / GRID) * GRID : Math.ceil((v + CLEARANCE + 1) / GRID) * GRID)
    return holeExits(board.rect, avoid.stripsOf.get(board.uid) ?? [], stripOf(ep) ?? '', p, (q) => avoid.usedHole.has(holeSpot(q))).map((x) => {
      const end = x.dir.x < 0 ? { x: out(r.x, true), y: p.y } : x.dir.x > 0 ? { x: out(r.x + r.w, false), y: p.y } : x.dir.y < 0 ? { x: p.x, y: out(r.y, true) } : { x: p.x, y: out(r.y + r.h, false) }
      const dirt = exitDirt(x) + (onLane(p, { x: end.x + x.dir.x * GRID, y: end.y + x.dir.y * GRID }) ? 100 : 0) + (manualRouteBlocked([p, end], bodiesOff(p)) ? 200 : 0)
      return { end, dir: x.dir, dirt }
    })
  }
  /** Whether the run from hole `from` toward `to` leaves its board by one of its cleanest ways out. */
  const leavesOk = (board: { uid: string; rect: Rect }, ep: Endpoint, from: Pt, to: Pt | undefined) => {
    if (!to || (from.x !== to.x && from.y !== to.y) || (from.x === to.x && from.y === to.y)) return false
    const dir = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) }
    const exits = exitsFor(board, ep, from)
    const best = Math.min(...exits.map((x) => x.dirt))
    return exits.some((x) => x.dir.x === dir.x && x.dir.y === dir.y && x.dirt === best)
  }
  const keeps = (pts: Pt[]) => {
    let body = pts
    if (ba && ba !== inside) body = body.slice(1)
    if (bb && bb !== inside) body = body.slice(0, -1)
    if (ba && ba !== inside && !leavesOk(ba, c.from, pts[0], pts[1])) return false
    if (bb && bb !== inside && !leavesOk(bb, c.to, pts[pts.length - 1], pts[pts.length - 2])) return false
    return avoid.boards.every((x) => x === inside || !runsInside(body, x.rect)) && boardEnds.length <= 2
  }
  if (plainFirst) {
    const plain = plainRoute()
    if (plain && !plain.blocked && keeps(plain.points)) return plain
  }
  // Cleanest way out first; among equals, the one that makes the shortest way to the other end.
  const ports = (e: ResolvedEnd, ep: Endpoint, board: { uid: string; rect: Rect } | null, other: Pt): { end: ResolvedEnd; run: Pt[] }[] => {
    if (!board || board === inside) return [{ end: e, run: [] }]
    const p = e.end
    const len = (end: Pt) => Math.abs(end.x - p.x) + Math.abs(end.y - p.y) + Math.abs(end.x - other.x) + Math.abs(end.y - other.y)
    return exitsFor(board, ep, p)
      .sort((u, v) => u.dirt - v.dirt || len(u.end) - len(v.end))
      .map((x) => ({ end: { end: x.end, dir: x.dir }, run: [p] }))
  }
  const pa = ports(a, c.from, ba, b.end)
  const pb = ports(b, c.to, bb, a.end)
  const walled = [...own, ...walls]
  // The two best exits of each end, best pair first.
  for (const [i, j] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    const x = pa[i]
    const y = pb[j]
    if (!x || !y) continue
    const portal = x.run.length > 0 || y.run.length > 0
    const r = solveRoute(x.end, y.end, walled, [x.run.length ? 0 : leads[0], y.run.length ? 0 : leads[1]], facing && !portal, ownHoles, ownText, ownNames, { occupied, bundle, shared, stubs }, avoid)
    if (r) return { ...r, points: simplify([...x.run, ...r.points, ...y.run]) }
  }
  // No route keeps off the boards in use: one across them, flagged, rather than a blocked wire (or,
  // tried only now, the route without walls when it keeps to the rule after all).
  const plain = plainRoute()
  if (plain && !plain.blocked && keeps(plain.points)) return plain
  return plain ? { ...plain, overBoard: true } : { points: blockedPoints(a, b), blocked: true }
}

/** Whether any run of `pts` (after its first point) passes strictly inside `r`. */
function runsInside(pts: Pt[], r: Rect): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]]
    if (p.y === q.y && p.y > r.y && p.y < r.y + r.h && Math.min(Math.max(p.x, q.x), r.x + r.w) - Math.max(Math.min(p.x, q.x), r.x) > 0) return true
    if (p.x === q.x && p.x > r.x && p.x < r.x + r.w && Math.min(Math.max(p.y, q.y), r.y + r.h) - Math.max(Math.min(p.y, q.y), r.y) > 0) return true
  }
  return false
}

/** The widest search window around both ends of a wire (lead-outs and a grid step of snapping included). */
function windowOf(a: ResolvedEnd, b: ResolvedEnd, leads: [number, number]): [number, number, number, number] {
  const reach = SEARCH_MARGIN + Math.max(leads[0], leads[1]) + 2 * GRID
  return [Math.min(a.end.x, b.end.x) - reach, Math.min(a.end.y, b.end.y) - reach, Math.max(a.end.x, b.end.x) + reach, Math.max(a.end.y, b.end.y) + reach]
}

/**
 * An auto route between two resolved ends around `own`, keeping off other strips' used holes,
 * captions and pin names where it can (they give way in that order, never blocking it). Null when
 * no route exists at all.
 */
function solveRoute(...args: Parameters<typeof solveOnce>): WireRoute | null {
  // Ruling W1: every way of keeping a wire off other wires' lines is tried before any route that
  // lies along one; such a route is flagged `overlap`.
  const [a, b, own, leads, facing, ownHoles, ownText, ownNames, lanes, avoid] = args
  // When even the freest search (no lead-outs, nothing kept off) can only lie along another wire,
  // no stricter one can do better: the route is taken in one search, keeping off what it can.
  if (lanes.occupied?.size || lanes.stubs?.size) {
    const overlapped = { hit: false }
    const free = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles: own, occupied: lanes.occupied, bundle: lanes.bundle, shared: lanes.shared, stubs: lanes.stubs, overlapped })
    if (!free) return null
    if (overlapped.hit) {
      const kept = routeOrthogonal({ from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles: own, occupied: lanes.occupied, bundle: lanes.bundle, shared: lanes.shared, stubs: lanes.stubs, avoidIn: [{ index: avoid.holes, skip: ownHoles }, { index: avoid.text, skip: ownText }, { index: avoid.names, skip: ownNames }] })
      const pts = kept ?? free
      return { points: pts, blocked: false, overlap: true, ...(pathRunsOver(pts, avoid.holes, ownHoles) ? { fallback: true as const } : {}) }
    }
  }
  // Off the lines of empty holes of boards in use too, where it can be; then over them.
  return solveOnce(a, b, own, leads, facing, ownHoles, ownText, ownNames, lanes, avoid, true) ?? solveOnce(...args)
}

function solveOnce(
  a: ResolvedEnd,
  b: ResolvedEnd,
  own: Rect[],
  [fromLead, toLead]: [number, number],
  facing: boolean,
  ownHoles: Set<string>,
  ownText: Set<string>,
  ownNames: Set<string>,
  { occupied, bundle, shared, stubs }: { occupied?: Occupancy; bundle?: Occupancy; shared?: Pt[]; stubs?: Occupancy },
  avoid: RouteAvoid,
  offEmpties = false,
): WireRoute | null {
  // Whether any point to avoid lies where a search could reach. When none does, an attempt that
  // avoids them finds exactly what one without them finds, so it is not made twice.
  const win = windowOf(a, b, [fromLead, toLead])
  const anyHoles = avoid.holes.some(...win, ownHoles, () => true)
  const anyText = avoid.text.some(...win, ownText, () => true)
  const anyNames = avoid.names.some(...win, ownNames, () => true)
  if (facing && !manualRouteBlocked([a.end, b.end], own) && !runsOver(a.end, b.end, avoid.holes, ownHoles) && !runsOver(a.end, b.end, avoid.text, ownText) && !runsOver(a.end, b.end, avoid.names, ownNames))
    return { points: [a.end, b.end], blocked: false }
  // The search starts past each lead-out, so the run from the pin out to it is checked here: a
  // route whose attachment runs cross a body is refused. A lead-out that cannot be routed (a part
  // right in front of the pin) is dropped, one end at a time, down to a plain route.
  const attached = (pts: Pt[]) => !manualRouteBlocked(pts.slice(0, 3), own) && !manualRouteBlocked(pts.slice(-3), own)
  const tries: [number, number][] = [[fromLead, toLead], [fromLead, 0], [0, toLead]]
  // A route that could only be found along another wire (Ruling W1) does not end the search: the
  // first is kept as the last resort, flagged `overlap`.
  let spare: Pt[] | null = null
  const attempt = (avoidIn: RouteRequest['avoidIn'], fullLeads = false): Pt[] | null => {
    const req = { from: a.end, fromDir: a.dir, to: b.end, toDir: b.dir, obstacles: own, avoidIn, occupied, bundle, shared, stubs }
    const one = (r: RouteRequest) => {
      const overlapped = { hit: false }
      const pts = routeOrthogonal({ ...r, overlapped })
      if (pts && overlapped.hit) {
        spare ??= pts
        return null
      }
      return pts
    }
    for (const [i, [f, t]] of (fullLeads ? tries.slice(0, 1) : tries).entries()) {
      if ((!f && !t) || tries.slice(0, i).some(([pf, pt]) => pf === f && pt === t)) continue
      const pts = one({ ...req, fromLead: f, toLead: t })
      if (pts && attached(pts)) return pts
    }
    return fullLeads ? null : one(req)
  }
  // Neither label nor hole avoidance ever blocks a wire: when no route clears the labels, one over
  // them is tried (still clear of other strips' holes), then one over the holes too; any of them
  // is better than a dashed, blocked wire. Labels give way first: a wire over a hole reads as
  // plugged in there, one over a caption only hides some text.
  // A retry without some points can only differ when a search turned away from one of them: when
  // none did, it would fail again the same way, so it is skipped.
  const holesHit = { hit: false }
  const textHit = { hit: false }
  const namesHit = { hit: false }
  const emptyHit = { hit: false }
  const holesIn = { index: avoid.holes, skip: ownHoles, refused: holesHit }
  // With `offEmpties` every attempt also keeps off the empty holes of boards in use, and nothing
  // else is tried: the caller tries again without them.
  const emptiesIn = offEmpties ? [{ index: avoid.empties, skip: ownHoles, refused: emptyHit }] : []
  if (offEmpties && !avoid.empties.some(...win, ownHoles, () => true)) return null
  const namesIn = anyNames ? [{ index: avoid.names, skip: ownNames, refused: namesHit }] : []
  // Captions give way before pin names: a wire over a caption hides a designator, one over a pin
  // name could hide which pin is which.
  // A connector keeps its full straight run before a wire keeps off its own parts' captions: when
  // only a route without the lead-outs clears them, one with the lead-outs over its own captions
  // (never another part's) is tried first.
  // The last resort (along an earlier wire's line) keeps off other strips' holes where it can,
  // and spends no more searches on text.
  let clear: Pt[] | null = null
  const lastResort = (pts: Pt[]): WireRoute => ({ points: pts, blocked: false, overlap: true, ...(pathRunsOver(pts, avoid.holes, ownHoles) ? { fallback: true as const } : {}) })
  if (anyText) {
    const strict = [holesIn, ...emptiesIn, { index: avoid.text, skip: ownText, refused: textHit }, ...namesIn]
    clear = attempt(strict, true)
    if (!clear && (fromLead || toLead)) clear = attempt([holesIn, ...emptiesIn, { index: avoid.text, skip: ownNames, refused: textHit }, ...namesIn], true)
    if (!clear) clear = attempt(strict)
  }
  // Keeping off empty holes gives way before keeping off text (Ruling W1: a wire never covers a
  // caption): with them, nothing that drops the text is tried; the caller tries again without them.
  if (offEmpties && anyText) return clear ? { points: clear, blocked: false } : null
  if (!clear && anyNames && (!anyText || textHit.hit)) {
    holesHit.hit = false
    clear = attempt([holesIn, ...emptiesIn, ...namesIn])
  }
  if (!clear && (!(anyText || anyNames) || textHit.hit || namesHit.hit)) {
    holesHit.hit = false
    clear = attempt([holesIn, ...emptiesIn])
  }
  if (clear) return { points: clear, blocked: false }
  if (offEmpties) return null
  const over = anyHoles && holesHit.hit ? attempt([]) : null
  if (over) return { points: over, blocked: false, ...(pathRunsOver(over, avoid.holes, ownHoles) ? { fallback: true as const } : {}) }
  const last: Pt[] | null = spare
  return last && lastResort(last)
}

/**
 * Routes every connection in file order, feeding each auto route the grid lanes every earlier
 * route (auto or manual) already used, so a wire whose shortest path would run alongside an
 * earlier one takes its own lane instead. With `only`, connections outside the set keep their
 * route from `prev` (used while dragging so only the moving part's or reshaped wire's routes are
 * recomputed each frame); those kept routes still seed the lanes the `only` routes see.
 * `occupancy: false` routes every wire as if it were alone on the sheet (no lanes), which is much
 * cheaper; the editor uses it for the wires it re-routes on each drag frame, and the full route
 * on drop applies lanes again.
 */
export function computeRoutes(d: Diagram, opts: { only?: Set<string>; prev?: Routes; occupancy?: boolean } = {}): Routes {
  const obstacles = partObstacles(d)
  const avoid = routeAvoid(d)
  const out: Routes = new Map()
  const occupied = opts.occupancy === false ? undefined : new Occupancy()
  // Ruling W1: wires between the same two parts (a mounted part counts as its board) form a bundle,
  // drawn as a ribbon of parallel lanes two grid steps apart.
  const bundles = occupied ? new Map<string, Occupancy>() : undefined
  const unitOf = (part: string) => avoid.mountOf.get(part) ?? part
  const bundleOf = (c: Connection) => {
    if (!bundles) return undefined
    const key = JSON.stringify([unitOf(c.from.part), unitOf(c.to.part)].sort())
    let occ = bundles.get(key)
    if (!occ) bundles.set(key, (occ = new Occupancy()))
    return occ
  }
  const record = (c: Connection, route: WireRoute | null) => {
    if (!route || !occupied) return
    addToOccupancy(occupied, route.points)
    addToOccupancy(bundleOf(c)!, route.points)
  }
  for (const c of d.connections) {
    if (opts.only && !opts.only.has(c.uid) && opts.prev?.has(c.uid)) {
      const kept = opts.prev.get(c.uid)!
      out.set(c.uid, kept)
      record(c, kept)
    }
  }
  // Wires sharing an end (two into one terminal) may meet along its stub: for such a wire the lanes
  // it may not lie along leave those wires out.
  const endKey = (e: Endpoint) => JSON.stringify([e.part, e.pin, e.hole ?? null, e.offset ?? null])
  // The lead-out run of every pin end that faces another wired pin on its own line (a resistor's
  // leg toward an LED's): another wire running out of one along that line would lie on the other's
  // lead, so no wire lies along such a run but its own.
  const stubs = occupied ? new Occupancy() : undefined
  /** The reserved runs, by the wire whose they are. */
  const stubRuns: { uid: string; run: Pt[] }[] = []
  if (stubs) {
    const ends: { uid: string; end: Pt; dir: Pt; lead: number }[] = []
    for (const c of d.connections) {
      const a = resolveEndpoint(d, c.from)
      const b = resolveEndpoint(d, c.to)
      if (!a || !b) continue
      const { leads } = leadsOf(c, a, b)
      if (a.dir) ends.push({ uid: c.uid, end: a.end, dir: a.dir, lead: leads[0] })
      if (b.dir) ends.push({ uid: c.uid, end: b.end, dir: b.dir, lead: leads[1] })
    }
    const byLine = new Map<string, typeof ends>()
    for (const e of ends) {
      const key = e.dir.x !== 0 ? `h${Math.round(e.end.y)}` : `v${Math.round(e.end.x)}`
      byLine.set(key, [...(byLine.get(key) ?? []), e])
    }
    for (const list of byLine.values())
      for (const e of list) {
        const ahead = (q: Pt) => (q.x - e.end.x) * e.dir.x + (q.y - e.end.y) * e.dir.y
        if (!list.some((o) => o.dir.x === -e.dir.x && o.dir.y === -e.dir.y && ahead(o.end) > 0 && ahead(o.end) < FACING_REACH)) continue
        const n = Math.max(GRID, e.lead)
        const g0 = onGrid(e.end, GRID)
        const run = [g0, { x: g0.x + e.dir.x * n, y: g0.y + e.dir.y * n }]
        addToOccupancy(stubs, run)
        stubRuns.push({ uid: e.uid, run })
      }
  }
  /** A wire's own reserved runs start at its pins: near them it is free (RouteRequest.shared). */
  const ownRuns = new Map<string, Pt[]>()
  for (const r of stubRuns) ownRuns.set(r.uid, [...(ownRuns.get(r.uid) ?? []), r.run[0]])
  const byEnd = new Map<string, string[]>()
  for (const c of d.connections) for (const e of [c.from, c.to]) byEnd.set(endKey(e), [...(byEnd.get(endKey(e)) ?? []), c.uid])
  for (const c of d.connections) {
    if (out.has(c.uid)) continue
    const shared = [c.from, c.to].flatMap((e) => ((byEnd.get(endKey(e)) ?? []).some((u) => u !== c.uid && out.get(u)) ? [resolveEndpoint(d, e)?.end].filter((p): p is Pt => !!p) : []))
    const free = [...shared, ...(ownRuns.get(c.uid) ?? [])]
    const route = routeWire(d, c, obstacles, occupied, avoid, bundleOf(c), free.length ? free : undefined, stubs)
    out.set(c.uid, route)
    record(c, route)
  }
  if (occupied)
    repairOverlaps(d, out, (c, occ, sh) => {
      const free = [...(sh ?? []), ...(ownRuns.get(c.uid) ?? [])]
      return routeWire(d, c, obstacles, occ, avoid, bundleOf(c), free.length ? free : undefined, stubs)
    }, byEnd, endKey, opts.only)
  return out
}

/**
 * Ruling W1: a wire that could only be laid along an earlier one (`overlap`) gets another chance once
 * every wire is down. It is routed again against all the others; failing that, the wires it lies
 * along are lifted, it is routed first, and they are routed again after it. A change is kept only
 * when nothing that was clear before lies along another wire after it. A few rounds at most.
 */
function repairOverlaps(
  d: Diagram,
  out: Routes,
  route: (c: Connection, occupied: Occupancy, shared: Pt[] | undefined) => WireRoute | null,
  byEnd: Map<string, string[]>,
  endKey: (e: Endpoint) => string,
  only: Set<string> | undefined,
) {
  const byUid = new Map(d.connections.map((c) => [c.uid, c]))
  const occupancyBut = (skip: Set<string>) => occupancyOf([...out].filter(([u, r]) => r && !skip.has(u)).map(([, r]) => r!.points))
  const sharedOf = (c: Connection) => {
    const pts = [c.from, c.to].flatMap((e) => ((byEnd.get(endKey(e)) ?? []).some((u) => u !== c.uid) ? [resolveEndpoint(d, e)?.end].filter((p): p is Pt => !!p) : []))
    return pts.length ? pts : undefined
  }
  /** The wires whose drawn lines `pts` lies along. */
  const alongOf = (uid: string, pts: Pt[]): string[] => {
    const mine = occupancyOf([pts])
    const hits: string[] = []
    for (const [u, r] of out) {
      if (u === uid || !r) continue
      const p = r.points
      for (let k = 1; k < p.length && !hits.includes(u); k++) {
        const [a, b] = [p[k - 1], p[k]]
        const bit = a.y === b.y ? 1 : 2
        const n = Math.round((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / GRID)
        const sx = Math.sign(b.x - a.x) * GRID
        const sy = Math.sign(b.y - a.y) * GRID
        const g0 = onGrid(a, GRID)
        for (let i = 0; i < n; i++)
          if (mine.at(g0.x + sx * i, g0.y + sy * i) & bit && mine.at(g0.x + sx * (i + 1), g0.y + sy * (i + 1)) & bit) {
            hits.push(u)
            break
          }
      }
    }
    return hits
  }
  for (let round = 0; round < 3; round++) {
    const flagged = [...out].filter(([u, r]) => r?.overlap && (!only || only.has(u))).map(([u]) => u)
    // Each repair rebuilds the lanes of the whole sheet: on a sheet this tangled it would cost more
    // than it could clear (the wires stay flagged and reported).
    if (!flagged.length || flagged.length > REPAIR_MAX) return
    let changed = false
    for (const uid of flagged) {
      const c = byUid.get(uid)!
      const again = route(c, occupancyBut(new Set([uid])), sharedOf(c))
      if (again && !again.overlap) {
        out.set(uid, again)
        changed = true
        continue
      }
      // Lift the wires it lies along, route it first, then them.
      const lifted = alongOf(uid, out.get(uid)!.points).filter((u) => !only || only.has(u))
      if (!lifted.length || lifted.length > 4) continue
      const before = new Map([uid, ...lifted].map((u) => [u, out.get(u)]))
      const skip = new Set([uid, ...lifted])
      const first = route(c, occupancyBut(skip), sharedOf(c))
      if (!first || first.overlap) continue
      out.set(uid, first)
      skip.delete(uid)
      let ok = true
      for (const u of lifted) {
        skip.delete(u)
        const r = route(byUid.get(u)!, occupancyBut(new Set([u, ...skip])), sharedOf(byUid.get(u)!))
        if (!r || r.overlap) {
          ok = false
          break
        }
        out.set(u, r)
      }
      if (ok) changed = true
      else for (const [u, r] of before) out.set(u, r!)
    }
    if (!changed) return
  }
}

/**
 * A key that changes exactly when some wire's routing inputs change: its uid, both endpoints (hole
 * and offset included: an invalid offset leaves the end unresolved), its stored route and its
 * cable ends. Serialized as structured tuples, so no two different sets of endpoints share a
 * key however their names are spelled (part "p.a" pin "R" and part "p" pin "a.R" differ).
 */
export function routingKey(connections: Connection[]): string {
  return JSON.stringify(
    connections.map((c) => [
      c.uid,
      c.from.part, c.from.pin, c.from.hole ?? null, c.from.offset ?? null,
      c.to.part, c.to.pin, c.to.hole ?? null, c.to.offset ?? null,
      c.route ?? null,
      // A connector sets how far the wire runs straight out of its pin (see leadsOf).
      c.ends?.from ?? null, c.ends?.to ?? null,
    ]),
  )
}

const HOP = 5

/**
 * Groups sorted crossing positions into bridges: crossings closer together than a hop's width
 * (2 * HOP) share one bridge, so arcs never overlap or join with a line running backward.
 * Returns each bridge's first and last crossing, in the order given.
 */
function bridges(hits: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && Math.abs(h - last[1]) < 2 * HOP) last[1] = h
    else out.push([h, h])
  }
  return out
}

/** Axis-aligned segments of drawn wires, kept sorted by their fixed coordinate. */
type Seg = { at: number; lo: number; hi: number }

/** Index of the first segment whose `at` is greater than `v`. */
function upper(segs: Seg[], v: number): number {
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].at <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Positions along a segment (spanning `from..to` at cross coordinate `c`) where it crosses a
 * perpendicular segment in `segs`, at least HOP away from either end so the arc fits.
 */
function crossings(segs: Seg[], from: number, to: number, c: number): number[] {
  const hits: number[] = []
  const min = Math.min(from, to)
  const max = Math.max(from, to)
  for (let i = upper(segs, min + HOP); i < segs.length && segs[i].at < max - HOP; i++) {
    const o = segs[i]
    if (c > o.lo && c < o.hi) hits.push(o.at)
  }
  return hits
}

function insert(segs: Seg[], seg: Seg) {
  segs.splice(upper(segs, seg.at), 0, seg)
}

/** True when a segment at cross-coordinate `at` spanning `lo..hi` overlaps an indexed one. */
function overlapsAt(segs: Seg[], at: number, lo: number, hi: number): boolean {
  let i = upper(segs, at)
  while (i > 0 && segs[i - 1].at === at) {
    i--
    if (Math.min(hi, segs[i].hi) - Math.max(lo, segs[i].lo) > 0) return true
  }
  return false
}

/** Perpendicular nudges tried, in order, until one clears the earlier wire (or the last allowed one is used regardless). */
const NUDGES = [4, -4, 8, -8]
const MAX_NUDGE = 8

/** Bucket size, in px, of the part-body index separation checks nudges against. */
const BUCKET = 160
/** A query or body covering more buckets than this just scans every body instead. */
const MAX_BUCKETS = 256

/**
 * Part bodies bucketed on a coarse grid, so checking a nudge against the bodies near one segment
 * does not scan every part on the sheet.
 */
class ObstacleIndex {
  private buckets = new Map<number, Rect[]>()
  private wide: Rect[] = []
  readonly all: Rect[]
  constructor(rects: Rect[]) {
    this.all = rects
    for (const r of rects) {
      const [c0, r0, c1, r1] = this.span(r.x, r.y, r.x + r.w, r.y + r.h)
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_BUCKETS) {
        this.wide.push(r)
        continue
      }
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const k = cx * 1_000_003 + cy
          const list = this.buckets.get(k)
          if (list) list.push(r)
          else this.buckets.set(k, [r])
        }
    }
  }
  private span(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    return [Math.floor(x0 / BUCKET), Math.floor(y0 / BUCKET), Math.floor(x1 / BUCKET), Math.floor(y1 / BUCKET)]
  }
  /** Bodies overlapping the box x0..x1, y0..y1 (each once). */
  near(x0: number, y0: number, x1: number, y1: number): Rect[] {
    const hit = (r: Rect) => r.x <= x1 && r.x + r.w >= x0 && r.y <= y1 && r.y + r.h >= y0
    const [c0, r0, c1, r1] = this.span(x0, y0, x1, y1)
    if (!((c1 - c0 + 1) * (r1 - r0 + 1) <= MAX_BUCKETS)) return this.all.filter(hit)
    const out = new Set<Rect>()
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) for (const r of this.buckets.get(cx * 1_000_003 + cy) ?? []) if (hit(r)) out.add(r)
    for (const r of this.wide) if (hit(r)) out.add(r)
    return [...out]
  }
}
/** Shortest the run on a pin may be left by a nudge (unless it was already shorter). */
const MIN_PIN_RUN = 2

/**
 * Nudges each interior segment (every segment but the first and last, which attach to pins and
 * never move) sideways when it runs along the same grid line as an already-drawn wire's segment,
 * so both stay visible even where the router itself left them sharing a lane (a manual route, or
 * an obstacle that forces two auto routes together). Moving a segment moves both its endpoints,
 * so the segments on either side of it stretch to keep up rather than detach from it. A nudge
 * that would turn the run on a pin back over the pin, leave it shorter than MIN_PIN_RUN px (or a
 * connector's reach, `minRuns`), or put
 * the moved segment or either stretched neighbour inside a part body (where it was clear before)
 * is skipped; when no nudge is allowed the segment stays where it is. Every segment a nudge
 * moves or stretches is checked at that point, so a wire clear before separation is still clear
 * after it. `forced` reports a nudge applied where the geometry was already blocked.
 */
function separate(
  points: Pt[],
  verticals: Seg[],
  horizontals: Seg[],
  index: ObstacleIndex,
  keepOf: () => ((r: Rect) => boolean) | null,
  /** Shortest each end's run on its pin may be left (a connector's reach), from end first. */
  minRuns: [number, number] = [MIN_PIN_RUN, MIN_PIN_RUN],
): { pts: Pt[]; forced: boolean } {
  const pts = points.map((p) => ({ ...p }))
  let forced = false
  for (let k = 2; k <= pts.length - 2; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    const horiz = a.y === b.y
    if (!horiz && a.x !== b.x) continue // not axis-aligned, so not a lane to share; leave it
    const segs = horiz ? horizontals : verticals
    const at = horiz ? a.y : a.x
    const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
    const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
    if (!overlapsAt(segs, at, lo, hi)) continue
    // The runs on the pins, when this segment touches one: pts[0]..a, and b..pts[last].
    const pinRuns: [Pt, number][] = []
    if (k === 2) pinRuns.push([pts[0], minRuns[0]])
    if (k === pts.length - 2) pinRuns.push([pts[pts.length - 1], minRuns[1]])
    // The moved segment and the two it stretches, before and after a nudge.
    const local = (moved: number): Pt[] => {
      const shift = (p: Pt): Pt => (horiz ? { x: p.x, y: moved } : { x: moved, y: p.y })
      return [pts[k - 2], shift(a), shift(b), pts[k + 1]]
    }
    const before = local(at)
    const xs = before.map((p) => p.x)
    const ys = before.map((p) => p.y)
    const near = index.near(Math.min(...xs) - MAX_NUDGE, Math.min(...ys) - MAX_NUDGE, Math.max(...xs) + MAX_NUDGE, Math.max(...ys) + MAX_NUDGE)
    // The same bodies routeWire let this wire through (see obstaclesFor) stay out of the check.
    const keep = near.length ? keepOf() : null
    const bodies = keep ? near.filter(keep) : near
    const wasBlocked = bodies.length > 0 && manualRouteBlocked(before, bodies)
    const allowed = (moved: number) =>
      pinRuns.every(([tip, min]) => {
        const before = at - (horiz ? tip.y : tip.x)
        const after = (moved - (horiz ? tip.y : tip.x)) * Math.sign(before)
        return after >= Math.min(min, Math.abs(before))
      }) && (wasBlocked || bodies.length === 0 || !manualRouteBlocked(local(moved), bodies))
    // Only to a line no earlier wire runs along there (Ruling W1: a nudge never lays one wire on
    // top of another); with none free, the segment stays.
    let pick: number | null = null
    for (const nudge of NUDGES) {
      const moved = at + nudge
      if (!allowed(moved) || overlapsAt(segs, moved, lo, hi)) continue
      pick = moved
      break
    }
    if (pick !== null) {
      if (horiz) { a.y = pick; b.y = pick } else { a.x = pick; b.x = pick }
      if (wasBlocked) forced = true
    }
  }
  return { pts, forced }
}

const cut = (v: number) => Math.round(v * 100) / 100

/**
 * A wire's connectors on its drawn polyline, and that polyline with each end cut back to where the
 * wire meets its connector: a housing's back, or where an exposed end's metal starts (plus the
 * round cap's half width, so the insulation ends there). Never cut past the end segment's room.
 * Hops use the whole housing, not the cut: a wire's own crossings are looked for only on `open`
 * (and, as always, a hop's width clear of its ends), and later wires see it as `indexed`, a hop's
 * width shorter again, so a crossing hops the same way whichever wire comes first.
 */
function cableEnds(conn: Connection, pts: Pt[]): { cables: [CableEndDraw | null, CableEndDraw | null]; drawn: Pt[]; open: Pt[]; indexed: Pt[] } {
  if (!conn.ends) return { cables: [null, null], drawn: pts, open: pts, indexed: pts }
  const drawn = pts.slice()
  // `open`: the wire outside its housings (each end moved back by the connector's drawn length).
  // `indexed`: that, a hop's width further back, as later wires see it.
  const open = pts.slice()
  const indexed = pts.slice()
  const cables = (['from', 'to'] as const).map((which): CableEndDraw | null => {
    const kind = endKind(conn.ends, which)
    if (kind === 'bare') return null
    const size = END_SIZE[kind]
    const place = endPlacement(pts, which, size.reach, END_SIZE[endKind(conn.ends, which === 'from' ? 'to' : 'from')].reach)
    if (!place) return null
    const { at, back, angle, scale, room } = place
    const trim = Math.min(room, size.trim * scale + (size.exposed ? (wireWidth(conn.gauge) + 2.2) / 2 : 0))
    const i = which === 'from' ? 0 : drawn.length - 1
    const move = (by: number): Pt => ({ x: cut(at.x + back.x * by), y: cut(at.y + back.y * by) })
    drawn[i] = move(trim)
    open[i] = move(Math.min(room, size.reach * scale))
    indexed[i] = move(Math.min(room, size.reach * scale + HOP))
    return { kind, at, back, angle, scale }
  })
  return { cables: [cables[0], cables[1]], drawn, open, indexed }
}

/**
 * SVG path data for each routed wire. Where a wire crosses a wire earlier in the file, the
 * later one gets a small hop arc, as in hand-drawn wiring sheets. Earlier wires' segments are
 * indexed by position, so each new segment only checks the ones in its span. An interior segment
 * that would otherwise run right on top of an earlier wire is nudged 4 px clear first (see
 * `separate`), so the hop and label-anchor geometry below is already the drawn, separated shape.
 * A wire with cable ends gets each connector placed on that drawn shape (`cables`, null for a
 * bare end), and its path is cut back into the connector (see `END_SIZE`), so a crossing under a
 * housing gets no hop: the housing already shows the two do not join. `points` and `ends` stay
 * the full wire, for handles, labels and end dots.
 */
export function wirePaths(d: Diagram, routes: Routes = computeRoutes(d)) {
  const index = new ObstacleIndex(partObstacles(d))
  const verticals: Seg[] = [] // at = x, lo..hi = y range
  const horizontals: Seg[] = [] // at = y, lo..hi = x range
  const out: { conn: Connection; d: string; points: Pt[]; ends: Pt[]; blocked: boolean; cables: [CableEndDraw | null, CableEndDraw | null] }[] = []
  const partsByUid = new Map(d.parts.map((p) => [p.uid, p]))
  for (const conn of d.connections) {
    const route = routes.get(conn.uid)
    if (!route) continue
    // Drawn geometry drops collinear bends: nudging one half of a split run would otherwise
    // pull the other half into a diagonal.
    const simple = simplify(route.points)
    // This wire's own obstacle list, as routeWire used it: a body over one of its hole ends (a
    // plugged leg, a DIP over its hole) is not an obstacle for it here either.
    // Resolved only when a nudge has bodies to check against, which most wires never reach.
    let keep: ((r: Rect) => boolean) | null | undefined
    const keepOf = () => {
      if (keep === undefined) {
        // Only a hole end (a hole group, or a pin whose leg is plugged) can drop a body, so a
        // wire between two unmounted parts without holes skips resolving its ends.
        const holeish = (ep: Endpoint) => {
          const p = partsByUid.get(ep.part)
          return !!p && (!!p.mount || !!moduleOf(d, p.module)?.holes?.length)
        }
        const a = holeish(conn.from) || holeish(conn.to) ? resolveEndpoint(d, conn.from) : null
        const b = a ? resolveEndpoint(d, conn.to) : null
        keep = a && b ? obstacleFilter(a, b) : null
      }
      return keep
    }
    // A connector's run keeps its full reach (routeWire gave it at least that much).
    const minRun = (which: 'from' | 'to') => Math.max(MIN_PIN_RUN, END_SIZE[endKind(conn.ends, which)].reach)
    const { pts, forced } = separate(simple, verticals, horizontals, index, keepOf, conn.ends ? [minRun('from'), minRun('to')] : undefined)
    const { cables, drawn, open, indexed } = cableEnds(conn, pts)
    let path = `M${drawn[0].x} ${drawn[0].y}`
    for (let i = 1; i < drawn.length; i++) {
      const s = drawn[i - 1]
      const e = drawn[i]
      const horiz = s.y === e.y
      const vert = s.x === e.x
      const dir = Math.sign(horiz ? e.x - s.x : e.y - s.y)
      const os = open[i - 1]
      const oe = open[i]
      const hits = horiz === vert ? [] : horiz ? crossings(verticals, os.x, oe.x, s.y) : crossings(horizontals, os.y, oe.y, s.x)
      hits.sort((p, q) => (p - q) * dir)
      for (const [first, last] of bridges(hits)) {
        const sweep = dir > 0 ? 1 : 0
        // One arc HOP high over the whole group; its half-width stretches to span every crossing.
        const rx = HOP + Math.abs(last - first) / 2
        const start = first - HOP * dir
        const end = last + HOP * dir
        if (horiz) path += ` L${start} ${s.y} A${rx} ${HOP} 0 0 ${sweep} ${end} ${s.y}`
        else path += ` L${s.x} ${start} A${HOP} ${rx} 0 0 ${sweep} ${s.x} ${end}`
      }
      path += ` L${e.x} ${e.y}`
    }
    // Indexed clear of its housings (see cableEnds), so a later wire crossing under a housing gets no
    // hop through it either, whichever wire comes first. (Separation reads the same index, so a
    // later run lying along a connector's own lane is not nudged off it; the housing covers it.)
    for (let i = 1; i < indexed.length; i++) {
      const s = indexed[i - 1]
      const e = indexed[i]
      if (s.x === e.x && s.y === e.y) continue
      if (s.x === e.x) insert(verticals, { at: s.x, lo: Math.min(s.y, e.y), hi: Math.max(s.y, e.y) })
      if (s.y === e.y) insert(horizontals, { at: s.y, lo: Math.min(s.x, e.x), hi: Math.max(s.x, e.x) })
    }
    // Blocked describes what is drawn. Separation keeps a clear wire clear (see `separate`), so
    // the drawn geometry only needs checking again when the wire started out blocked or a nudge
    // was forced through a body.
    const moved = pts.some((p, i) => p.x !== simple[i].x || p.y !== simple[i].y)
    const blocked = moved && (route.blocked || forced) ? manualRouteBlocked(pts, keepOf() ? index.all.filter(keepOf()!) : index.all) : route.blocked
    out.push({ conn, d: path, points: pts, ends: [pts[0], pts[pts.length - 1]], blocked, cables })
  }
  return out
}

/**
 * Midpoint of a routed wire's longest straight run, for placing its name tag. Ties keep the
 * first longest segment found. Null for a route with fewer than two points (nothing to anchor to).
 */
export function labelAnchor(route: Pt[]): { x: number; y: number; horizontal: boolean } | null {
  const points = simplify(route) // a run split by a collinear bend is still one run
  if (points.length < 2) return null
  let best = { i: 1, len: -1 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) // segments are axis-aligned, so Manhattan length is true length
    if (len > best.len) best = { i, len }
  }
  const a = points[best.i - 1]
  const b = points[best.i]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: a.y === b.y }
}

export function isValidColor(c: string): boolean {
  const key = c.toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(c) || Object.hasOwn(NAMED_COLORS, key) || Object.hasOwn(STRIPED_COLORS, key)
}

export type DiagramResult = { ok: true; diagram: Diagram; warnings: string[] } | { ok: false; errors: string[] }

/** Largest |x| or |y|, in px, a part position or a stored route point may have. */
export const COORD_LIMIT = 100_000
/** Most points a stored route may have. */
export const ROUTE_POINT_LIMIT = 200
/** Longest frame label and note text, in characters. */
export const ANNOTATION_LABEL_MAX = 80
export const ANNOTATION_TEXT_MAX = 500

/**
 * Checks a parsed diagram file. Structural problems refuse the load (errors); a connection
 * that names a missing part or pin still loads (warning), so no wire is silently dropped.
 */
export function validateDiagram(raw: unknown): DiagramResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['diagram must be a JSON object'] }

  if (raw.format === undefined) errors.push(`format: missing (expected "${DIAGRAM_FORMAT}")`)
  else if (raw.format !== DIAGRAM_FORMAT) errors.push(`format: unsupported "${String(raw.format)}" (expected "${DIAGRAM_FORMAT}")`)
  if (typeof raw.title !== 'string') errors.push('title: required')

  // A Map, so keys such as "__proto__" or "constructor" are ordinary names.
  const modules = new Map<string, ModuleDef>()
  if (!isObj(raw.modules)) errors.push('modules: required, an object of embedded modules')
  else
    for (const [key, m] of Object.entries(raw.modules)) {
      const r = validateModule(m)
      if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`))
      else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`)
      else modules.set(key, r.module)
    }

  const uids = new Set<string>()
  const claim = (uid: unknown, at: string) => {
    if (typeof uid !== 'string' || uid === '') errors.push(`${at}.uid: required`)
    else if (uids.has(uid)) errors.push(`${at}.uid: duplicate "${uid}"`)
    else uids.add(uid)
  }

  // Fixes applied to a loadable file (a clamped position, a dropped route), by list index. The
  // input is never mutated; the returned diagram carries fixed copies of just those entries.
  const partFixes = new Map<number, Partial<PartInstance>>()
  const fix = (i: number, patch: Partial<PartInstance>) => partFixes.set(i, { ...partFixes.get(i), ...patch })
  const droppedRoutes = new Set<number>()
  // Connections whose `ends` lost an unknown kind or key: the ends they keep (undefined: none).
  const endFixes = new Map<number, WireEnds | undefined>()

  const partModule = new Map<string, string>()
  if (!Array.isArray(raw.parts)) errors.push('parts: required list')
  else
    raw.parts.forEach((p, i) => {
      const at = `parts[${i}]`
      if (!isObj(p)) return void errors.push(`${at}: must be an object`)
      claim(p.uid, at)
      if (typeof p.designator !== 'string') errors.push(`${at}.designator: required`)
      if (typeof p.module !== 'string') errors.push(`${at}.module: required`)
      else {
        if (typeof p.uid === 'string') partModule.set(p.uid, p.module)
        if (!modules.has(p.module)) warnings.push(`${at}: module "${p.module}" is not embedded in this file`)
      }
      if (!isNum(p.x) || !isNum(p.y)) errors.push(`${at}: x and y must be numbers`)
      else if (Math.abs(p.x) > COORD_LIMIT || Math.abs(p.y) > COORD_LIMIT) {
        const clamp = (v: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, v))
        fix(i, { x: clamp(p.x), y: clamp(p.y) })
        warnings.push(`${at}: position (${p.x}, ${p.y}) is beyond +-${COORD_LIMIT}, so it was clamped to (${clamp(p.x)}, ${clamp(p.y)})`)
      }
      if (p.rotation !== undefined && ![0, 90, 180, 270].includes(p.rotation as number))
        errors.push(`${at}.rotation: must be 0, 90, 180 or 270`)
      if (p.mount !== undefined && !(isObj(p.mount) && typeof p.mount.board === 'string' && p.mount.board !== ''))
        errors.push(`${at}.mount: must be { "board": <part uid> }`)
      if (p.values !== undefined) {
        if (!isObj(p.values)) errors.push(`${at}.values: must be an object`)
        else {
          const who = typeof p.designator === 'string' && p.designator !== '' ? p.designator : `part ${i}`
          const dropped: string[] = []
          for (const [key, entry] of Object.entries(p.values)) {
            // An override of an editable value param (resistance, capacitance, voltage) that is
            // malformed, in the wrong unit or out of range is dropped with a warning, so the
            // module default is shown and the user is told, rather than a different value being
            // substituted silently.
            if (Object.hasOwn(PARAM_RULES, key)) {
              const rule = PARAM_RULES[key]
              const where = `${at}.values.${key}: ${who} has ${key}`
              const problem =
                !(isObj(entry) && isNum(entry.value) && typeof entry.unit === 'string') ? `${where} ${JSON.stringify(entry)}, which is not a number with a unit`
                : entry.unit !== rule.unit ? `${where} ${entry.value} ${entry.unit}, but ${key} must be in ${rule.unit}`
                : !validParamValue(key, entry.value) ? `${where} ${entry.value} ${entry.unit}, but ${key} must be ${rule.range}`
                : null
              if (problem) {
                dropped.push(key)
                warnings.push(`${problem}; ${VALUE_DROPPED}`)
              }
              continue
            }
            // Any other entry that looks like a number-with-unit (has a "value" key) is checked
            // for shape. Other part state (an LED's color, a switch's default) is opaque.
            if (isObj(entry) && 'value' in entry && !(isNum(entry.value) && typeof entry.unit === 'string'))
              warnings.push(`${at}.values.${key}: value must be a finite number with a string unit`)
            // A net label's name is text; anything else would silently join nothing, so it is dropped and said.
            if (key === LABEL_VALUE && typeof p.module === 'string' && isNetLabel(modules.get(p.module)) && typeof entry !== 'string') {
              dropped.push(key)
              warnings.push(`${at}.values.net: ${who}'s label name must be text, not ${JSON.stringify(entry)}; it was dropped, so the label has no name`)
            }
          }
          if (dropped.length) {
            const values = p.values
            fix(i, { values: Object.fromEntries(Object.entries(values).filter(([k]) => !dropped.includes(k))) })
          }
        }
      }
      // Settings are checked against the module's choices; a bad one is dropped with a warning,
      // so the module's first choice is used and the user is told.
      if (p.settings !== undefined) {
        const who = typeof p.designator === 'string' && p.designator !== '' ? p.designator : `part ${i}`
        const m = typeof p.module === 'string' ? modules.get(p.module) : undefined
        if (!isObj(p.settings)) {
          fix(i, { settings: undefined })
          warnings.push(`${at}.settings: must be an object of setting name to choice, so it was dropped and the defaults are used`)
        } else {
          const offered = m ? moduleSettings(m) : null
          const kept: Record<string, string> = {}
          let changed = false
          for (const [key, value] of Object.entries(p.settings)) {
            const choices = offered && Object.hasOwn(offered, key) ? offered[key] : null
            if (offered && !choices) {
              changed = true
              warnings.push(`${at}.settings.${key}: ${who} has no setting "${key}", so it was dropped`)
            } else if (typeof value !== 'string' || (choices && !choices.includes(value))) {
              changed = true
              const allowed = choices ? choices.map((c) => `"${c}"`).join(' or ') : 'a string'
              warnings.push(`${at}.settings.${key}: ${who} has ${key} ${JSON.stringify(value)}, but it must be ${allowed}; it was dropped${choices ? ` and the default "${choices[0]}" is used` : ''}`)
            } else kept[key] = value
          }
          if (changed) fix(i, { settings: Object.keys(kept).length ? kept : undefined })
        }
      }
    })

  // Mount targets are checked once every part is known, since a board may come later in the list.
  if (Array.isArray(raw.parts))
    raw.parts.forEach((p, i) => {
      if (!isObj(p) || !isObj(p.mount) || typeof p.mount.board !== 'string' || p.mount.board === '') return
      const board = p.mount.board
      const at = `parts[${i}].mount.board`
      if (board === p.uid) return void warnings.push(`${at}: a part cannot be mounted on itself`)
      const modId = partModule.get(board)
      if (modId === undefined) return void warnings.push(`${at}: no part with uid "${board}"`)
      const m = modules.get(modId)
      if (m && !isBoard(m)) warnings.push(`${at}: part "${board}" is not a board (a module with holes and "obstacle": false)`)
    })

  const checkEnd = (ep: unknown, at: string) => {
    if (!isObj(ep) || typeof ep.part !== 'string' || typeof ep.pin !== 'string')
      return void errors.push(`${at}: must be { "part": <uid>, "pin": <name> }`)
    if (ep.offset !== undefined && !isNum(ep.offset)) errors.push(`${at}.offset: must be a number`)
    if (ep.hole !== undefined && !(Number.isInteger(ep.hole) && (ep.hole as number) >= 0))
      errors.push(`${at}.hole: must be a whole number, 0 or more`)
    const modId = partModule.get(ep.part)
    if (modId === undefined) return void warnings.push(`${at}: no part with uid "${ep.part}"`)
    const m = modules.get(modId)
    if (!m) return
    const group = m.holes?.find((g) => g.name === ep.pin)
    if (group) {
      if (typeof ep.hole === 'number' && Number.isInteger(ep.hole) && ep.hole >= group.at.length)
        warnings.push(`${at}.hole: group "${ep.pin}" has ${group.at.length} holes (0 to ${group.at.length - 1})`)
    } else if (!m.pins.some((p) => 'name' in p && p.name === ep.pin)) warnings.push(`${at}: part "${ep.part}" has no pin "${ep.pin}"`)
    else if (ep.hole !== undefined) warnings.push(`${at}.hole: pin "${ep.pin}" is not a hole group`)
    // An offset resolves only on a bus pin, at a whole-number position along it (see validOffset).
    const pin = group ? undefined : m.pins.find((p) => 'name' in p && p.name === ep.pin)
    if ((group || pin) && isNum(ep.offset)) {
      const bus = pin && 'bus' in pin ? pin.bus : undefined
      if (!bus) warnings.push(`${at}.offset: "${ep.pin}" is not a bus, so an offset there is meaningless and the wire is broken`)
      else if (!validOffset(ep.offset, bus))
        warnings.push(`${at}.offset: ${ep.offset} is not a position on bus "${ep.pin}" (a whole number from 0 to ${bus.length - 1}), so the wire is broken`)
    }
  }

  if (!Array.isArray(raw.connections)) errors.push('connections: required list')
  else
    raw.connections.forEach((c, i) => {
      const at = `connections[${i}]`
      if (!isObj(c)) return void errors.push(`${at}: must be an object`)
      claim(c.uid, at)
      checkEnd(c.from, `${at}.from`)
      checkEnd(c.to, `${at}.to`)
      if (c.color !== undefined && !(typeof c.color === 'string' && isValidColor(c.color)))
        errors.push(`${at}.color: must be a named color or #RRGGBB`)
      if (c.colorSet !== undefined && c.colorSet !== true) errors.push(`${at}.colorSet: must be true when present`)
      if (c.gauge !== undefined && !(Number.isInteger(c.gauge) && (c.gauge as number) >= 16 && (c.gauge as number) <= 30))
        errors.push(`${at}.gauge: must be a whole number from 16 to 30`)
      if (c.route !== undefined && !(Array.isArray(c.route) && c.route.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))))
        errors.push(`${at}.route: must be a list of [x, y] points`)
      else if (Array.isArray(c.route) && c.route.length > ROUTE_POINT_LIMIT) {
        droppedRoutes.add(i)
        warnings.push(`${at}.route: more than ${ROUTE_POINT_LIMIT} points, so the route was dropped and the wire is routed automatically`)
      } else if (Array.isArray(c.route) && (c.route as [number, number][]).some(([x, y]) => Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT)) {
        droppedRoutes.add(i)
        warnings.push(`${at}.route: a point is beyond +-${COORD_LIMIT}, so the route was dropped and the wire is routed automatically`)
      } else if (Array.isArray(c.route))
        for (let k = 1; k < c.route.length; k++) {
          const [px, py] = c.route[k - 1] as [number, number]
          const [qx, qy] = c.route[k] as [number, number]
          if (px !== qx && py !== qy) warnings.push(`${at}.route[${k}]: diagonal step from route[${k - 1}] (each step should be horizontal or vertical)`)
        }
      if (c.label !== undefined && typeof c.label !== 'string') errors.push(`${at}.label: must be a string`)
      if (c.routing !== undefined && typeof c.routing !== 'boolean') errors.push(`${at}.routing: must be true or false`)
      // Cable ends are presentation: anything unknown is dropped with a warning, never refused.
      if (c.ends !== undefined) {
        if (!isObj(c.ends)) {
          endFixes.set(i, undefined)
          warnings.push(`${at}.ends: must be an object like { "from": "dupont-male", "to": "dupont-female" }, so it was dropped and the wire is drawn plain`)
        } else {
          const kept: WireEnds = {}
          let changed = false
          for (const [key, kind] of Object.entries(c.ends)) {
            if (key !== 'from' && key !== 'to') {
              changed = true
              warnings.push(`${at}.ends.${key}: not a wire end ("from" or "to"), so it was dropped`)
            } else if (!isEndKind(kind)) {
              changed = true
              warnings.push(`${at}.ends.${key}: unknown cable end ${JSON.stringify(kind)}, so that end is drawn as bare wire`)
            } else kept[key] = kind
          }
          const norm = normalizeEnds(kept)
          if (changed || !norm || norm.from !== kept.from || norm.to !== kept.to) endFixes.set(i, norm)
        }
      }
    })

  if (raw.annotations !== undefined) {
    if (!Array.isArray(raw.annotations)) errors.push('annotations: must be a list')
    else
      raw.annotations.forEach((a, i) => {
        const at = `annotations[${i}]`
        if (!isObj(a)) return void errors.push(`${at}: must be an object`)
        claim(a.uid, at)
        if (a.type !== 'frame' && a.type !== 'text') errors.push(`${at}.type: must be "frame" or "text"`)
        const coord = (v: unknown) => isNum(v) && Math.abs(v) <= COORD_LIMIT
        if (!coord(a.x) || !coord(a.y)) errors.push(`${at}: x and y must be numbers within +-${COORD_LIMIT}`)
        if (a.type === 'frame')
          for (const k of ['w', 'h'])
            if (!(isNum(a[k]) && (a[k] as number) > 0 && (a[k] as number) <= 2 * COORD_LIMIT))
              errors.push(`${at}.${k}: must be a number above 0, at most ${2 * COORD_LIMIT}`)
        for (const [k, max] of [['label', ANNOTATION_LABEL_MAX], ['text', ANNOTATION_TEXT_MAX]] as const) {
          if (a[k] === undefined) continue
          if (typeof a[k] !== 'string') errors.push(`${at}.${k}: must be a string`)
          else if ((a[k] as string).length > max) errors.push(`${at}.${k}: at most ${max} characters`)
        }
        if (a.type === 'text' && a.text === undefined) errors.push(`${at}.text: required on a text note`)
      })
  }

  if (raw.intent !== undefined && !isObj(raw.intent)) errors.push('intent: must be an object (a circuitoon-netlist/1 document)')

  // Notes are free text the sheet carries (the mains notice on export); a bad entry is dropped, not fatal.
  let notesFix: string[] | undefined | null = null
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) {
      notesFix = undefined
      warnings.push('notes: must be a list of strings, so it was dropped')
    } else if (raw.notes.some((n) => typeof n !== 'string')) {
      raw.notes.forEach((n, i) => typeof n !== 'string' && warnings.push(`notes[${i}]: must be a string, so it was dropped`))
      notesFix = raw.notes.filter((n): n is string => typeof n === 'string')
    }
  }

  if (errors.length) return { ok: false, errors }
  let diagram = raw as unknown as Diagram
  if (notesFix !== null) {
    const { notes: _n, ...rest } = diagram
    diagram = notesFix ? { ...rest, notes: notesFix } : rest
  }
  if (partFixes.size || droppedRoutes.size || endFixes.size)
    diagram = {
      ...diagram,
      parts: diagram.parts.map((p, i) => (partFixes.has(i) ? { ...p, ...partFixes.get(i) } : p)),
      connections: diagram.connections.map((c, i) => {
        if (!droppedRoutes.has(i) && !endFixes.has(i)) return c
        const { route, ends: _ends, ...rest } = c
        const ends = endFixes.has(i) ? endFixes.get(i) : c.ends
        return { ...rest, ...(route && !droppedRoutes.has(i) ? { route } : {}), ...(ends ? { ends } : {}) }
      }),
    }
  // Mounts that load but plug nothing, checked on the fixed diagram (clamped positions, dropped
  // routes) so the warnings describe what the editor will show. A missing target, a self mount, and a non-board target
  // whose module is embedded are already warned about above; a non-board target whose module is
  // not embedded is caught below instead (its own "not embedded" warning is separate).
  for (const { part, board, reason } of mountIssues(diagram)) {
    const i = diagram.parts.findIndex((p) => p.uid === part)
    const at = `parts[${i}].mount`
    if (reason === 'cannot-mount' && board !== part && modules.has(diagram.parts[i].module))
      warnings.push(`${at}: part "${part}" cannot mount (boards, net labels, parts with a bus pin and parts with no pins never do)`)
    else if (reason === 'not-a-board' && !modules.has(partModule.get(board)!))
      warnings.push(`${at}: part "${board}" is not a board (its module "${partModule.get(board)}" is not embedded in this file)`)
    else if (reason === 'partial') warnings.push(`${at}: not every leg of "${part}" sits on a hole of board "${board}", so it plugs into nothing`)
    else if (reason === 'obscured')
      warnings.push(`${at}: a board drawn above board "${board}" covers a leg of "${part}", so it plugs into nothing`)
    else if (reason === 'conflict') warnings.push(`${at}: a leg of "${part}" sits on a hole another mounted part already uses, so it plugs into nothing`)
    else if (reason === 'no-fit')
      warnings.push(`${at}: "${part}" does not fit board "${board}" (an outlet takes only a matching plug, and a plug fits only a matching outlet), so it plugs into nothing`)
  }
  return { ok: true, diagram, warnings }
}

/** The file text. Cable ends are written only where they are not bare, so plain wires stay unchanged. */
export function serializeDiagram(d: Diagram): string {
  const out = d.connections.some((c) => 'ends' in c)
    ? {
        ...d,
        connections: d.connections.map((c) => {
          if (!('ends' in c)) return c
          const { ends: _ends, ...rest } = c
          const ends = normalizeEnds(c.ends)
          return ends ? { ...c, ends } : rest
        }),
      }
    : d
  return JSON.stringify(out, null, 2) + '\n'
}

export function emptyDiagram(title = 'Untitled sheet'): Diagram {
  return { format: DIAGRAM_FORMAT, title, modules: {}, parts: [], connections: [] }
}
