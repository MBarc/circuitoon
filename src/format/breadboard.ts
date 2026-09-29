// Breadboards on a diagram: which world grid point is which hole, which parts sit validly on a
// board, and which mounted legs plug into which holes. Pure; per-board hole lookups are cached
// by part object identity, and parts are replaced (never mutated) on every edit, so a moved
// board simply gets a fresh index.
import { type Diagram, type Endpoint, type PartInstance, moduleOf } from './diagram.ts'
import { type PlugPoint, type Pt, type Rect, type Rotation, type WorldHoleGroup, bodyRect, pivot, plugPoints, rotateVec, toWorld, worldHoles } from './geometry.ts'
import { type PlugDef, type PlugFamily, type SocketFamily, mainsOf } from './mainsModel.ts'
import { GRID, type ModuleDef, isBoard, isSpacer, layoutModule } from './module.ts'
import { entriesFor, orientationOf } from './plugging.ts'

const OFF = 2 ** 25
const NONE_SET: ReadonlySet<string> = new Set()
/**
 * One number per world grid point. Unique only for whole-number x and y within +-2^25 px, so
 * lookups go through `holeAt`, which checks both and compares the found hole exactly.
 */
export const pointKey = (x: number, y: number): number => (x + OFF) * 2 ** 26 + (y + OFF)
const inRange = (n: number) => Number.isInteger(n) && n > -OFF && n < OFF

export interface HoleIndex {
  groups: WorldHoleGroup[]
  /** Point key to [group index, hole index]. Look up through `holeAt`. */
  byPoint: Map<number, [number, number]>
}

const indexCache = new WeakMap<PartInstance, { m: ModuleDef; index: HoleIndex }>()

/** World hole positions of a part with hole groups, and a lookup from grid point to hole. */
export function holeIndex(part: PartInstance, m: ModuleDef): HoleIndex {
  const hit = indexCache.get(part)
  if (hit && hit.m === m) return hit.index
  const groups = worldHoles(part, m)
  const byPoint = new Map<number, [number, number]>()
  groups.forEach((g, gi) =>
    g.at.forEach((p, hi) => {
      if (inRange(p.x) && inRange(p.y)) byPoint.set(pointKey(p.x, p.y), [gi, hi])
    }),
  )
  const index = { groups, byPoint }
  indexCache.set(part, { m, index })
  return index
}

/** The [group index, hole index] whose center is exactly `pt`, or null. A fractional or out-of-range point never matches. */
export function holeAt(index: HoleIndex, pt: Pt): [number, number] | null {
  if (!inRange(pt.x) || !inRange(pt.y)) return null
  const hit = index.byPoint.get(pointKey(pt.x, pt.y))
  if (!hit) return null
  const at = index.groups[hit[0]].at[hit[1]]
  return at.x === pt.x && at.y === pt.y ? hit : null
}

export interface HoleRef {
  board: string
  group: string
  hole: number
}

/** Module-local hole centers ("x,y") to [group index, hole index], per module. */
const localCache = new WeakMap<ModuleDef, Map<string, [number, number]>>()

function localHoles(m: ModuleDef): Map<string, [number, number]> {
  let map = localCache.get(m)
  if (!map) {
    map = new Map()
    for (const [gi, g] of (m.holes ?? []).entries()) for (const [hi, [x, y]] of g.at.entries()) map.set(`${x},${y}`, [gi, hi])
    localCache.set(m, map)
  }
  return map
}

const UNDO: Record<Rotation, Rotation> = { 0: 0, 90: 270, 180: 180, 270: 90 }

/**
 * The hole of `part` whose center is within `radius` px of pointer `p`, or null. The pointer is
 * mapped into the part's own coordinates (the inverse of its placement), where every hole sits on
 * the 10 px grid, so a board placed off the world grid still has clickable holes. Picking only:
 * electrical matching (`holeAt`) stays exact.
 */
export function holeAtPoint(part: PartInstance, m: ModuleDef, p: Pt, radius = 3.5): HoleRef | null {
  if (!m.holes?.length) return null
  const lay = layoutModule(m)
  const c = pivot(lay.w, lay.h)
  const v = rotateVec({ x: p.x - part.x - c.x, y: p.y - part.y - c.y }, UNDO[part.rotation ?? 0])
  const local = { x: v.x + c.x, y: v.y + c.y }
  const gx = Math.round(local.x / GRID) * GRID
  const gy = Math.round(local.y / GRID) * GRID
  // Rotation keeps distances, so the radius is the same in local and world px.
  if (Math.hypot(local.x - gx, local.y - gy) > radius) return null
  const hit = localHoles(m).get(`${gx},${gy}`)
  return hit ? { board: part.uid, group: m.holes[hit[0]].name, hole: hit[1] } : null
}

/**
 * The wire end a pointer at `p` picks on part `uid`: a hole or pad of any module with hole groups
 * (a breadboard, or an interior header whose pads are routing obstacles), within the hole target
 * radius. Mounting is a board-only matter; wiring is not. Null for a missing part or module, or no
 * hole near `p`. Hover, pressing and dropping a wire end all pick through this.
 */
export function holeEndAt(d: Diagram, uid: string, p: Pt): Endpoint | null {
  const part = d.parts.find((q) => q.uid === uid)
  const m = part && moduleOf(d, part.module)
  const hit = part && m ? holeAtPoint(part, m, p) : null
  return hit && { part: hit.board, pin: hit.group, hole: hit.hole }
}

export interface Plug {
  part: string
  pin: string
  board: string
  group: string
  hole: number
  /** The hole center, which is also the pin's plug point. */
  at: Pt
  /**
   * A plug contact that fills its socket contact but carries no conductor (Ruling 39: the insulated
   * earth pin of a class II BS 1363 plug). It takes its hole like any leg and joins nothing.
   */
  mechanical?: true
}

/** Where a part's legs land on one board: all of them on free holes (seated), or only some. */
export interface Seat {
  status: 'seated' | 'partial'
  board: string
  /** The hole centers the legs land on, in plug point order (taken ones included). */
  holes: Pt[]
  /** A plug-in device over an outlet it does not seat in: its body, drawn red while dragging. */
  outline?: Rect
  /**
   * Holes that keep the part from seating because of a body: a leg's hole under another part's
   * body, then a hole this part's body would cover that holds another part's leg or a wire end.
   * Drawn red while dragging. Absent when there are none.
   */
  blocked?: Pt[]
}

/** One key per hole on the sheet; JSON keeps any character in a uid or group name unambiguous. */
export const holeKey = (board: string, group: string, hole: number): string => JSON.stringify([board, group, hole])

/** Holes holding a leg of a part outside `ignore`. */
const takenBy = (plugs: Plug[], ignore: ReadonlySet<string>): Set<string> =>
  new Set(plugs.filter((p) => !ignore.has(p.part)).map((p) => holeKey(p.board, p.group, p.hole)))

/** A plug point, and for a plug contact whether it is mechanical only. */
interface Point extends PlugPoint {
  mechanical?: true
}

interface Me {
  part: PartInstance
  m: ModuleDef
  /** Its pin edge points, or for a plug-in device every contact of every profile (each pin and spot once). */
  pts: Point[]
  plug: PlugDef | null
}

/**
 * A part that may mount, with its plug points: its pin edge points, or for a plug-in device every
 * contact of every profile (seating then picks the profile the socket takes). Null for a missing
 * part or module, a board, and a part with a bus pin or no pins.
 */
function mountable(d: Diagram, uid: string): Me | null {
  const part = d.parts.find((p) => p.uid === uid)
  const m = part && moduleOf(d, part.module)
  if (!part || !m || isBoard(m) || m.pins.some((p) => !isSpacer(p) && p.bus)) return null
  const pts = allPlugPoints(part, m)
  return pts.length ? { part, m, pts, plug: mainsOf(m).plug } : null
}

/** A part's pin edge points, or for a plug-in device every contact of every profile (each pin and spot once). */
function allPlugPoints(part: PartInstance, m: ModuleDef): Point[] {
  const plug = mainsOf(m).plug
  if (!plug) return plugPoints(part, m)
  const lay = layoutModule(m)
  const seen = new Set<string>()
  const pts: Point[] = []
  for (const pr of plug.profiles)
    for (const c of pr.contacts) {
      const at = toWorld(part, lay, c.at)
      const k = JSON.stringify([c.pin, at.x, at.y])
      if (!seen.has(k)) {
        seen.add(k)
        pts.push(c.mains === 'mechanical' ? { pin: c.pin, at, mechanical: true } : { pin: c.pin, at })
      }
    }
  return pts
}

// ---- Holes under a part's body ----

/** Widest a drawn lead is, in px, to count as a lead rather than body (the built-in leads are 3 px). */
const LEAD_WIDTH = 4

const shapeCache = new WeakMap<ModuleDef, Rect[]>()

/**
 * A module's drawn body, as part-local rectangles: every art shape except its leads, or the whole
 * layout body when the module has no art. A lead is a shape at most LEAD_WIDTH px across that
 * reaches one of the module's own pin edge points, where the leg plugs in: the bare wire from the
 * body out to the leg, which lies over holes without hiding them. Everything else the art draws
 * (a resistor's barrel, an LED's dome and rim, a chip's package) hides the holes under it. The
 * shapes are what the user sees, so a hole is covered exactly when it is drawn under the part.
 */
export function bodyShapes(m: ModuleDef): Rect[] {
  const hit = shapeCache.get(m)
  if (hit) return hit
  const lay = layoutModule(m)
  let rects: Rect[]
  if (!m.art?.shapes.length) rects = [{ x: 0, y: 0, w: lay.w, h: lay.h }]
  else {
    const edges = lay.pins.filter((p) => !p.bus).map((p) => p.edge)
    const lead = (s: Rect) => Math.min(s.w, s.h) <= LEAD_WIDTH && edges.some((e) => e.x >= s.x && e.x <= s.x + s.w && e.y >= s.y && e.y <= s.y + s.h)
    rects = m.art.shapes.filter((s) => !lead(s)).map(({ x, y, w, h }) => ({ x, y, w, h }))
  }
  shapeCache.set(m, rects)
  return rects
}

/** A board hole a mounted part's body lies over. */
export interface CoveredHole {
  board: string
  group: string
  hole: number
  at: Pt
  /** The uid of the part whose body covers it. */
  by: string
}

/** A part-local rectangle in world px, turned with the part. */
function worldRect(part: PartInstance, lay: { w: number; h: number }, r: Rect): Rect {
  const a = toWorld(part, lay, { x: r.x, y: r.y })
  const b = toWorld(part, lay, { x: r.x + r.w, y: r.y + r.h })
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

const coverCache = new WeakMap<PartInstance, { board: PartInstance; m: ModuleDef; bm: ModuleDef; cover: CoveredHole[] }>()

/**
 * The holes of `board` whose centers lie strictly inside one of part's body shapes (bodyShapes,
 * turned with the part), in group and hole order, except the holes its own legs (every plug point)
 * land on. A hole on the edge of a shape is only half hidden and stays free. Cached per part, board
 * and module objects.
 */
function coverOf(part: PartInstance, m: ModuleDef, board: PartInstance, bm: ModuleDef): CoveredHole[] {
  const hit = coverCache.get(part)
  if (hit && hit.board === board && hit.m === m && hit.bm === bm) return hit.cover
  const idx = holeIndex(board, bm)
  const lay = layoutModule(m)
  const own = new Set(allPlugPoints(part, m).map((pp) => pointKey(pp.at.x, pp.at.y)))
  const found = new Map<number, [number, number]>()
  const first = idx.groups.find((g) => g.at.length)?.at[0]
  if (first) {
    // Every hole sits on the board's own 10 px lattice, so only lattice points inside a shape are looked up.
    const ox = ((first.x % GRID) + GRID) % GRID
    const oy = ((first.y % GRID) + GRID) % GRID
    for (const s of bodyShapes(m)) {
      const r = worldRect(part, lay, s)
      for (let y = oy + GRID * (Math.floor((r.y - oy) / GRID) + 1); y < r.y + r.h; y += GRID)
        for (let x = ox + GRID * (Math.floor((r.x - ox) / GRID) + 1); x < r.x + r.w; x += GRID) {
          const h = holeAt(idx, { x, y })
          if (h && !own.has(pointKey(x, y))) found.set(h[0] * 1e6 + h[1], h)
        }
    }
  }
  const cover = [...found.keys()].sort((a, b) => a - b).map((k) => {
    const [gi, hi] = found.get(k)!
    return { board: board.uid, group: idx.groups[gi].name, hole: hi, at: idx.groups[gi].at[hi], by: part.uid }
  })
  coverCache.set(part, { board, m, bm, cover })
  return cover
}

/**
 * The holes covered by the bodies of the parts that `plugs` plug in (each part on the board its
 * legs are in), parts in `ignore` left out. A hole two bodies cover is listed once, for the part
 * whose legs come first in `plugs`.
 */
function coversOf(d: Diagram, plugs: Plug[], ignore: ReadonlySet<string> = new Set()): CoveredHole[] {
  const out = new Map<string, CoveredHole>()
  const done = new Set<string>()
  let byUid: Map<string, PartInstance> | null = null
  for (const pl of plugs) {
    if (ignore.has(pl.part) || done.has(pl.part)) continue
    done.add(pl.part)
    byUid ??= new Map(d.parts.map((p) => [p.uid, p]))
    const part = byUid.get(pl.part)
    const board = byUid.get(pl.board)
    const m = part && moduleOf(d, part.module)
    const bm = board && moduleOf(d, board.module)
    if (!part || !board || !m || !bm) continue
    for (const c of coverOf(part, m, board, bm)) {
      const k = holeKey(c.board, c.group, c.hole)
      if (!out.has(k)) out.set(k, c)
    }
  }
  return [...out.values()]
}

/** Hole keys of every wire end in a board hole (a hole end on a board's hole group). */
function wireEndHoles(d: Diagram): Set<string> {
  const out = new Set<string>()
  if (!d.connections.length) return out
  const boards = new Map<string, ModuleDef>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (m && isBoard(m)) boards.set(p.uid, m)
  }
  for (const c of d.connections)
    for (const ep of [c.from, c.to]) {
      const m = boards.get(ep.part)
      if (m?.holes?.some((g) => g.name === ep.pin)) out.add(holeKey(ep.part, ep.pin, ep.hole ?? 0))
    }
  return out
}

/** What already holds holes where a part is seated: other parts' legs and bodies, and wire ends. */
interface Busy {
  /** Holes holding a leg of another part. */
  taken: ReadonlySet<string>
  /** Holes under another part's body. */
  covered: ReadonlySet<string>
  /** Holes holding a wire end. */
  ends: () => ReadonlySet<string>
}

function busyOf(d: Diagram, plugs: Plug[], ignore: ReadonlySet<string>): Busy {
  let ends: Set<string> | null = null
  return {
    taken: takenBy(plugs, ignore),
    covered: new Set(coversOf(d, plugs, ignore).map((c) => holeKey(c.board, c.group, c.hole))),
    ends: () => (ends ??= wireEndHoles(d)),
  }
}

interface Fit {
  board: PartInstance
  bm: ModuleDef
  groups: WorldHoleGroup[]
  /** The plug points this fit uses: every leg, or the contacts of the profile an outlet's socket took. */
  pts: Point[]
  /** Per plug point, the [group, hole] it lands on, or null. */
  hits: ([number, number] | null)[]
  landed: number
  /** A board drawn above this one covers at least one plug point, so this board may not take the part. */
  obscured: boolean
  /** False when this board never takes this part as it lies (Resolution 6 and spec 2: only a matching plug, turned and placed as the table allows, seats on an outlet, and a plug seats nowhere else). */
  seatable: boolean
  /** A plug-in device's body where it overlaps an outlet, for the red outline. */
  outline: Rect | null
  /** The board never takes this kind of part (a plug on anything but an outlet, anything but a plug on an outlet), however its legs land. */
  categorical: boolean
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Whether a board drawn above `board` (a later board in `d.parts`; boards draw in list order)
 * covers any of `pts` with its body. A leg there looks as if it sits in the upper board, so the
 * lower board's hole under it is not the one the user sees.
 */
function obscuredOn(d: Diagram, board: PartInstance, pts: PlugPoint[]): boolean {
  for (let i = d.parts.indexOf(board) + 1; i < d.parts.length; i++) {
    const q = d.parts[i]
    const qm = moduleOf(d, q.module)
    if (!qm || !isBoard(qm)) continue
    const r = bodyRect(q, layoutModule(qm))
    if (pts.some(({ at }) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h)) return true
  }
  return false
}

/**
 * How a part lands on one board; null when that part is not a board. A plug seats only on an
 * outlet and only through the compatibility table (spec 2): a table entry for the plug and one
 * socket, an allowed orientation, and every contact of that entry's profile on a contact of that
 * socket, each conducting contact on the socket contact the entry maps it to and a mechanical one
 * on any contact of the same socket. Contacts are never collected across sockets.
 */
function fitOn(d: Diagram, board: PartInstance, me: Me): Fit | null {
  const bm = moduleOf(d, board.module)
  if (!bm || !isBoard(bm)) return null
  const idx = holeIndex(board, bm)
  const sockets = mainsOf(bm).sockets
  const body = me.plug && sockets.length ? bodyRect(me.part, layoutModule(me.m)) : null
  const outline = body && intersects(body, bodyRect(board, layoutModule(bm))) ? body : null
  const fit = (pts: Point[], seatable: (hits: ([number, number] | null)[]) => boolean): Fit => {
    const hits = pts.map((pp) => holeAt(idx, pp.at))
    const landed = hits.filter(Boolean).length
    return { board, bm, groups: idx.groups, pts, hits, landed, obscured: landed > 0 && obscuredOn(d, board, pts), seatable: seatable(hits), outline, categorical }
  }
  const categorical = !me.plug !== !sockets.length
  // A plain part on a plain board seats as it always has; a plain part on an outlet, or a plug on
  // anything but an outlet, never does (no-fit).
  if (!me.plug || !sockets.length) return fit(me.pts, () => !me.plug && !sockets.length)
  const lay = layoutModule(me.m)
  const orientation = orientationOf(me.part, board)
  let best: Fit | null = null
  for (const socket of sockets)
    for (const e of entriesFor(me.plug.family, socket.family)) {
      const profile = me.plug.profiles.find((p) => p.id === e.profile)
      if (!profile) continue
      const map = e.map[orientation]
      const pts: Point[] = profile.contacts.map((c) => {
        const at = toWorld(me.part, lay, c.at)
        return c.mains === 'mechanical' ? { pin: c.pin, at, mechanical: true } : { pin: c.pin, at }
      })
      const f = fit(pts, (hits) => !!map && hits.every((h, i) => {
        // Only this socket's own contacts count: seating never collects contacts across sockets.
        const sc = h && socket.contacts.find((c) => c.group === idx.groups[h[0]].name)
        const role = profile.contacts[i].mains
        // A mechanical pin (Ruling 39) may land on any contact of its socket: the L and N contacts
        // already fix the orientation, and it joins nothing, so which contact it fills never matters.
        return !!sc && (role === 'mechanical' || sc.role === map[role])
      }))
      if (!best || (f.seatable && !best.seatable) || (f.seatable === best.seatable && f.landed > best.landed)) best = f
    }
  return best ?? fit(me.pts, () => false)
}

/**
 * An obscured board never seats: its fit shows as partial (red), so a drop does not mount. With
 * `me` and `busy` (seating a part, not re-checking a stored mount) bodies count too: a leg in a
 * hole under another part's body, or a body over a hole that holds another part's leg or a wire
 * end, keeps the part from seating, and those holes come back as `blocked`.
 */
function seatFrom(fit: Fit, busy: Busy, me?: Me): Seat | null {
  if (!fit.landed && !fit.outline) return null
  const key = (h: [number, number]) => holeKey(fit.board.uid, fit.groups[h[0]].name, h[1])
  const blocked: Pt[] = []
  if (me) {
    fit.hits.forEach((h, i) => {
      if (h && busy.covered.has(key(h))) blocked.push(fit.pts[i].at)
    })
    for (const c of coverOf(me.part, me.m, fit.board, fit.bm)) {
      const k = holeKey(c.board, c.group, c.hole)
      if (busy.taken.has(k) || busy.ends().has(k)) blocked.push(c.at)
    }
  }
  const seated = fit.seatable && !fit.obscured && !blocked.length && fit.hits.every((h) => h && !busy.taken.has(key(h)))
  return {
    status: seated ? 'seated' : 'partial', board: fit.board.uid, holes: fit.pts.filter((_, i) => fit.hits[i]).map((pp) => pp.at),
    ...(fit.outline && !seated ? { outline: fit.outline } : {}),
    ...(blocked.length ? { blocked } : {}),
  }
}

/**
 * Where part `uid` would mount as it stands. Seated: every plug point lands exactly on a hole of
 * one board and none of those holes holds a leg (in `plugs`) of a part outside `ignore`, which
 * defaults to the part itself; a plug-in device must also fit that board's socket (see `fitOn`).
 * Partial: some legs land, or land on taken holes, or the part does not fit (a plug-in device over
 * an outlet it does not fit then carries its body as `outline`). Null: no leg lands on any board
 * and no plug overlaps an outlet, or the part cannot mount (a board, a part with a bus pin or no
 * pins). A board the part fits outranks one it does not; then the board with the most landed legs
 * is the candidate; a tie goes to the board later in `d.parts`, which is drawn on top (boards draw
 * in `d.parts` order), so the board whose holes the user sees, hovers and wires is the one the part
 * plugs into. A board that a board drawn above it covers at any plug point is obscured: it ranks
 * below every unobscured board and, if still the candidate, is only partial, so a leg never plugs
 * into a hidden hole under a visibly different strip.
 */
export function seatOf(d: Diagram, uid: string, plugs: Plug[], ignore: ReadonlySet<string> = new Set([uid])): Seat | null {
  const me = mountable(d, uid)
  if (!me) return null
  let best: Fit | null = null
  for (const b of d.parts) {
    const fit = b === me.part ? null : fitOn(d, b, me)
    if (!fit || (!fit.landed && !fit.outline)) continue
    if (!best || (best.obscured && !fit.obscured) || (best.obscured === fit.obscured && ((fit.seatable && !best.seatable) || (fit.seatable === best.seatable && fit.landed >= best.landed))))
      best = fit
  }
  return best && seatFrom(best, busyOf(d, plugs, ignore), me)
}

/** `seatOf` on one given board (a part's own mount), whatever other board also fits. Null when `board` is missing or not a board. */
export function seatOn(d: Diagram, uid: string, board: string, plugs: Plug[], ignore: ReadonlySet<string> = new Set([uid])): Seat | null {
  const me = mountable(d, uid)
  const b = me && d.parts.find((p) => p.uid === board)
  const fit = me && b && b !== me.part ? fitOn(d, b, me) : null
  return fit && seatFrom(fit, busyOf(d, plugs, ignore), me!)
}

export interface MountIssue {
  part: string
  board: string
  /**
   * partial covers any fit short of every leg on a hole, including no leg at all. no-fit: an outlet
   * takes only a matching plug, and a plug fits only a matching outlet.
   */
  reason: 'missing-board' | 'not-a-board' | 'cannot-mount' | 'partial' | 'no-fit' | 'obscured' | 'conflict'
}

/**
 * Walks mounted parts in `d.parts` order. A mount is valid when its part is seated on its own
 * `mount.board` given the holes earlier valid mounts took; only valid mounts plug. An invalid
 * mount keeps its data (for repair) and is reported with the reason it plugs nothing.
 */
function mounts(d: Diagram): { plugs: Plug[]; issues: MountIssue[] } {
  const plugs: Plug[] = []
  const issues: MountIssue[] = []
  const taken = new Set<string>()
  for (const p of d.parts) {
    if (!p.mount) continue
    const at = p.mount.board
    const issue = (reason: MountIssue['reason']) => void issues.push({ part: p.uid, board: at, reason })
    const board = d.parts.find((b) => b.uid === at)
    if (!board) {
      issue('missing-board')
      continue
    }
    if (!isBoard(moduleOf(d, board.module))) {
      issue('not-a-board')
      continue
    }
    const me = board === p ? null : mountable(d, p.uid)
    if (!me) {
      issue('cannot-mount')
      continue
    }
    const fit = fitOn(d, board, me)!
    // A categorical mismatch is no-fit however many legs land; otherwise a leg off its hole comes first.
    if (fit.categorical) issue('no-fit')
    else if (fit.landed < fit.pts.length) issue('partial')
    else if (!fit.seatable) issue('no-fit')
    else if (fit.obscured) issue('obscured')
    else if (seatFrom(fit, { taken, covered: NONE_SET, ends: () => NONE_SET })!.status !== 'seated') issue('conflict')
    else
      fit.pts.forEach((pp, i) => {
        const [gi, hi] = fit.hits[i]!
        const group = fit.groups[gi].name
        taken.add(holeKey(board.uid, group, hi))
        plugs.push({ part: p.uid, pin: pp.pin, board: board.uid, group, hole: hi, at: pp.at, ...(pp.mechanical ? { mechanical: true as const } : {}) })
      })
  }
  return { plugs, issues }
}

interface MountCache {
  /** Each part with the module it resolved to when this entry was built, to spot an in-place edit. */
  seen: [PartInstance, ModuleDef | undefined][]
  result: { plugs: Plug[]; issues: MountIssue[] }
  /** Plug point per plugged pin (key from pinKey), built on first use. */
  byPin?: Map<string, Pt>
  /** Holes under the bodies of validly mounted parts, built on first use. */
  covered?: CoveredHole[]
}

/**
 * `mounts` depends only on the parts and their modules, so it is cached per parts array (a new
 * array on every edit). The entry is rechecked part by part (identity of each part and its
 * module), which is cheap next to the fit itself, so an array or module map edited in place never
 * serves a stale answer. Each drag frame builds one entry that the renderer, the router and
 * `resolveEndpoint` all share.
 */
const mountCache = new WeakMap<PartInstance[], MountCache>()

function cachedMounts(d: Diagram): MountCache {
  const hit = mountCache.get(d.parts)
  if (hit && hit.seen.length === d.parts.length && hit.seen.every(([p, m], i) => d.parts[i] === p && moduleOf(d, p.module) === m))
    return hit
  const entry: MountCache = { seen: d.parts.map((p) => [p, moduleOf(d, p.module)]), result: mounts(d) }
  mountCache.set(d.parts, entry)
  return entry
}

const pinKey = (part: string, pin: string): string => JSON.stringify([part, pin])

/**
 * Every plugged leg on the sheet, from each part's `mount` and positions: each pin of a validly
 * mounted part plugs into the hole its plug point sits on. An invalid mount plugs nothing (see
 * `mountIssues`). Cached per diagram parts: the array is shared, so callers must not mutate it.
 */
export function plugsOf(d: Diagram): Plug[] {
  return cachedMounts(d).result.plugs
}

/**
 * The hole center pin `pin` of part `part` is plugged into, or null when that leg is not validly
 * plugged. A map lookup after the first call per diagram parts.
 */
export function plugOfPin(d: Diagram, part: string, pin: string): Pt | null {
  const entry = cachedMounts(d)
  if (!entry.byPin) entry.byPin = new Map(entry.result.plugs.map((pl) => [pinKey(pl.part, pl.pin), pl.at]))
  return entry.byPin.get(pinKey(part, pin)) ?? null
}

/**
 * Every hole a validly mounted part's body lies over (see `bodyShapes`), on the board it is mounted
 * on, apart from its own leg holes; a hole two bodies cover is listed once. Nothing may plug into
 * one: a wire end or another part's leg there is a finding (the checker's covered-hole). A mount
 * that plugs nothing covers nothing. Cached per diagram parts, like `plugsOf`: do not mutate it.
 */
export function coveredHoles(d: Diagram): CoveredHole[] {
  const entry = cachedMounts(d)
  return (entry.covered ??= coversOf(d, entry.result.plugs))
}

/**
 * Every mount that plugs nothing, and why: its board is missing or not a board, the part cannot
 * mount, not every leg lands on a hole, a board drawn above its board covers a leg (obscured), or
 * a hole is already taken by an earlier valid mount.
 */
export function mountIssues(d: Diagram): MountIssue[] {
  return cachedMounts(d).result.issues
}

/** Boards first, so parts on a board draw above it whatever the file order; file order is kept within each list. */
export function splitBoards(d: Diagram): { boards: PartInstance[]; others: PartInstance[] } {
  const boards: PartInstance[] = []
  const others: PartInstance[] = []
  for (const p of d.parts) (isBoard(moduleOf(d, p.module)) ? boards : others).push(p)
  return { boards, others }
}

export interface PlugMismatch {
  part: string
  board: string
  /**
   * family: no socket of that outlet takes this plug. fit: one would, but the plug does not sit in it
   * as it lies (moved off, turned the wrong way, contacts spread across two sockets). unplugged: it
   * lies where it fits but is not plugged in (not mounted, or its socket is already taken).
   */
  kind: 'family' | 'fit' | 'unplugged'
  plug: PlugFamily
  /** The socket families of that outlet: every one for `family`, those that take the plug otherwise. */
  sockets: SocketFamily[]
}

/**
 * Plug-in devices over an outlet they are not validly plugged into (spec rule 10, Ruling 40): each
 * such device and outlet once, with the real cause.
 */
export function plugMismatches(d: Diagram): PlugMismatch[] {
  const out: PlugMismatch[] = []
  let plugged: Set<string> | null = null
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    const plug = m ? mainsOf(m).plug : null
    if (!m || !plug) continue
    plugged ??= new Set(plugsOf(d).map((pl) => pl.part))
    if (plugged.has(p.uid)) continue
    const body = bodyRect(p, layoutModule(m))
    for (const b of d.parts) {
      const bm = b === p ? undefined : moduleOf(d, b.module)
      const sockets = bm ? mainsOf(bm).sockets : []
      if (!bm || !sockets.length || !intersects(body, bodyRect(b, layoutModule(bm)))) continue
      const families = [...new Set(sockets.map((s) => s.family))]
      const taking = families.filter((f) => entriesFor(plug.family, f).length > 0)
      // Seated on this outlet with no other plug in the way: it fits, it just is not plugged in.
      const kind = !taking.length ? 'family' : seatOn(d, p.uid, b.uid, [])?.status === 'seated' ? 'unplugged' : 'fit'
      out.push({ part: p.uid, board: b.uid, kind, plug: plug.family, sockets: taking.length ? taking : families })
    }
  }
  return out
}
