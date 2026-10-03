// Where the layout puts net labels (agent toolkit, piece B): which nets get them, and a spot for each
// labelled endpoint's label, a short stub out from the pin along its own direction (or from a free
// strip hole out past the board's nearest edge) that lands clear of every part body and pin stub,
// caption, pin name, note and label placed so far. Spots are tried nearest first; a net whose every
// endpoint cannot get one is wired as before (never blocked). Pure.
import type { Annotation, Diagram, PartInstance } from '../format/diagram.ts'
import { moduleOf } from '../format/diagram.ts'
import { type Pt, type Rect, type Rotation, bodyRect, worldPins } from '../format/geometry.ts'
import { LEAD, type ModuleDef, isBoard, layoutModule } from '../format/module.ts'
import { flagRect } from '../format/netLabels.ts'
import { placedCaptionBox, tipLabelBoxes } from '../render/captionBox.ts'
import { annotationRect, frameTab } from '../render/annotationGeometry.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { grow, intersects } from './footprint.ts'

export type LabelMode = 'auto' | 'none' | 'all'
export const LABEL_MODES: LabelMode[] = ['auto', 'none', 'all']

/** Distances, in px, from a pin tip (or a board edge) to its label's pin, nearest first. */
export const LABEL_STUBS = [20, 30, 40, 60, 80]
/**
 * Auto mode labels a net whose endpoints lie farther apart than this (px, the larger of the x and
 * y spreads). Calibrated on the examples and fixtures: at 300 the DIP-28 fixture's header nets go
 * from 278 crossings to 84, and no short net on the small examples gains a label; 250 changed
 * nothing more, 360 left the DIP fixture as it was.
 */
export const LABEL_FAR = 300
/** Room kept clear around another part's body for its pin stubs, in px. */
const STUB_ROOM = LEAD + 2

/** What auto mode weighs for one net. */
export interface NetShape {
  kind: 'ground' | 'power' | 'signal'
  /** Each endpoint's point and the group (intent group or repeat copy) its part is in, if any. */
  ends: { at: Pt; group: string | undefined }[]
}

/** Whether auto mode labels a net: power and ground with 3 or more endpoints or spread far, a signal between groups or spread far. */
export function autoLabels(s: NetShape): boolean {
  if (s.ends.length < 2) return false
  const xs = s.ends.map((e) => e.at.x)
  const ys = s.ends.map((e) => e.at.y)
  const far = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > LABEL_FAR
  if (s.kind !== 'signal') return s.ends.length >= 3 || far
  const groups = new Set(s.ends.map((e) => e.group ?? ''))
  return far || (groups.size > 1 && s.ends.some((e) => e.group !== undefined))
}

/** A stub's line as a thin rectangle, so a strict overlap test sees what it crosses. */
const line = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x) - 0.5, y: Math.min(a.y, b.y) - 0.5, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 })

export interface LabelSpot {
  /** The label part (position and rotation set, `values.net` the net's name). */
  part: PartInstance
  /** Its pin's tip, where the stub ends. */
  tip: Pt
  /** Where the stub turns aside to reach a label set off to one side (the tip itself when straight out). */
  elbow: Pt
  /** Where the stub leaves its body (the pin tip, or the body edge for a pad or hole). */
  base: Pt
}

/**
 * Spots tried for a label, nearest first: `s` px straight out from the pin (or board edge), then set
 * off `o` px to either side, so a row of header pins with a part in front of some still gets labels.
 */
const SIDE_OFFSETS = [0, 10, -10, 20, -20, 30, -30, 40, -40, 60, -60, 80, -80]
const CANDIDATES = LABEL_STUBS.flatMap((s) => SIDE_OFFSETS.map((o) => ({ s, o }))).sort((a, b) => a.s + 1.5 * Math.abs(a.o) - (b.s + 1.5 * Math.abs(b.o)))

/** A part with this many labelled pins or pads on one side gets its labels as one ordered row (`LabelPlacer.row`). */
export const FANOUT_MIN = 4

/**
 * Rectangles (each with the part it belongs to, if any) bucketed on a 100 px grid, so a test looks
 * only at its neighbours, and truncatable back to an earlier length for a rollback.
 */
class Bucketed {
  private items: { r: Rect; part?: string }[] = []
  private cells = new Map<string, number[]>()
  private keys(r: Rect): string[] {
    const out: string[] = []
    for (let cy = Math.floor(r.y / 100); cy <= Math.floor((r.y + r.h) / 100); cy++)
      for (let cx = Math.floor(r.x / 100); cx <= Math.floor((r.x + r.w) / 100); cx++) out.push(`${cx},${cy}`)
    return out
  }
  get length() {
    return this.items.length
  }
  push(...add: { r: Rect; part?: string }[]) {
    for (const it of add) {
      const i = this.items.length
      this.items.push(it)
      for (const k of this.keys(it.r)) {
        const list = this.cells.get(k)
        if (list) list.push(i)
        else this.cells.set(k, [i])
      }
    }
  }
  truncate(n: number) {
    if (n >= this.items.length) return
    for (const it of this.items.slice(n))
      for (const k of this.keys(it.r)) {
        const list = this.cells.get(k)!
        while (list.length && list[list.length - 1] >= n) list.pop()
      }
    this.items.length = n
  }
  /** Whether `r` overlaps an entry not owned by `skip`. */
  hits(r: Rect, skip?: string): boolean {
    for (const k of this.keys(r))
      for (const i of this.cells.get(k) ?? []) {
        const it = this.items[i]
        if (it.part !== undefined && it.part === skip) continue
        if (intersects(r, it.r)) return true
      }
    return false
  }
}

export class LabelPlacer {
  /** Everything a flag must stay off: bodies grown for their stubs, captions, pin names, notes, labels placed. */
  private flagsOff = new Bucketed()
  /** What a stub must not cross: bodies (boards too), captions, notes, labels placed and their stubs. */
  private stubsOff = new Bucketed()
  private used = new Set<string>()
  private seq = 0

  private readonly m: ModuleDef

  constructor(d: Diagram, m: ModuleDef, extra: { annotations?: Annotation[] } = {}) {
    this.m = m
    const seated = seatedLabels(d)
    for (const p of d.parts) {
      const pm = moduleOf(d, p.module)
      if (!pm) continue
      this.used.add(p.uid)
      const body = bodyRect(p, layoutModule(pm))
      const caption = placedCaptionBox(p, pm, seated.get(p.uid))
      this.flagsOff.push({ r: grow(body, STUB_ROOM) }, { r: caption }, ...tipLabelBoxes(p, pm).map((r) => ({ r })))
      // Boards too (Ruling W1: no wire crosses a breadboard in use); a stub from a board's own hole may leave across it.
      this.stubsOff.push({ r: body, part: p.uid })
      this.stubsOff.push({ r: caption })
    }
    for (const a of [...(d.annotations ?? []), ...(extra.annotations ?? [])]) {
      // A note's box, and a group frame's name tab (its border may be crossed).
      const r = a.type === 'text' ? annotationRect(a) : a.label ? frameTab(a) : null
      if (!r) continue
      this.flagsOff.push({ r })
      this.stubsOff.push({ r })
    }
  }

  /** The label pin's direction at each rotation, so a label can face back at its endpoint. */
  private pinAt(rotation: Rotation) {
    return worldPins({ x: 0, y: 0, rotation }, this.m)[0]
  }

  /**
   * A spot for a label named `name` whose pin tip sits `s` px out from `from` along `dir` (for each
   * s in LABEL_STUBS, from `base`, the point the distance is measured from, `from` by default), or
   * null. The stub from `from` to the tip may cross `own` (the endpoint's part: a pad inside it).
   */
  spot(name: string, from: Pt, dir: Pt, opts: { base?: Pt; own?: string } = {}): LabelSpot | null {
    const rotation = ([0, 90, 180, 270] as Rotation[]).find((r) => {
      const p = this.pinAt(r)
      return p.dir.x === -dir.x && p.dir.y === -dir.y
    })
    if (rotation === undefined) return null
    const pin = this.pinAt(rotation)
    const base = opts.base ?? from
    const side = { x: -dir.y, y: dir.x }
    // Inside a body (a pad, a hole) the wire may run to any point of the edge, so a label set aside
    // leaves the edge at its own spot; from a pin tip it goes straight out, then aside.
    const inside = opts.base !== undefined
    for (const { s, o } of CANDIDATES) {
      const exit = inside ? { x: base.x + side.x * o, y: base.y + side.y * o } : base
      const elbow = { x: exit.x + dir.x * s, y: exit.y + dir.y * s }
      const tip = inside ? elbow : { x: elbow.x + side.x * o, y: elbow.y + side.y * o }
      const part: PartInstance = { uid: '', designator: '', module: this.m.id, x: tip.x - pin.end.x, y: tip.y - pin.end.y, rotation, values: { net: name } }
      const flag = flagRect(part, this.m, true)
      if (this.flagsOff.hits(flag)) continue
      // From a pad or a hole, only the part of the stub outside the body counts: inside it the wire
      // crosses the part's own art (or its own board) whichever way it goes.
      const stub = [line(exit, elbow), line(elbow, tip)]
      if (stub.some((r) => this.stubsOff.hits(r, opts.own))) continue
      return { part, tip, elbow, base: exit }
    }
    return null
  }

  /**
   * A row of labels for a dense group of pins or pads on one side of a part (FANOUT_MIN or more):
   * one label per item, all the same distance out along `dir`, each at its item's `slot` (the item's
   * own position along the side, or its place in pad order), so the row reads in pin order and no
   * two stubs cross. The nearest distance where every flag is clear wins; null when none is. The
   * row is taken at once (later labels keep off it).
   */
  row(items: { name: string; slot: Pt }[], dir: Pt, own?: string): LabelSpot[] | null {
    const rotation = ([0, 90, 180, 270] as Rotation[]).find((r) => {
      const p = this.pinAt(r)
      return p.dir.x === -dir.x && p.dir.y === -dir.y
    })
    if (rotation === undefined) return null
    const pin = this.pinAt(rotation)
    for (const s of LABEL_STUBS) {
      const spots = items.map(({ name, slot }) => {
        const tip = { x: slot.x + dir.x * s, y: slot.y + dir.y * s }
        const part: PartInstance = { uid: '', designator: '', module: this.m.id, x: tip.x - pin.end.x, y: tip.y - pin.end.y, rotation, values: { net: name } }
        return { part, tip, elbow: tip, base: slot }
      })
      const flags = spots.map((x) => flagRect(x.part, this.m, true))
      if (flags.some((f) => this.flagsOff.hits(f))) continue
      if (spots.some((x) => this.stubsOff.hits(line(x.base, x.tip), own))) continue
      for (const x of spots) {
        const f = flagRect(x.part, this.m, true)
        this.flagsOff.push({ r: f }, { r: line(x.base, x.tip) })
        this.stubsOff.push({ r: f }, { r: line(x.base, x.tip) })
      }
      return spots
    }
    return null
  }

  /** A point to roll back to (see `rollback`), so a net that cannot label every endpoint leaves no trace. */
  mark(): { flags: number; stubs: number; seq: number; used: string[] } {
    return { flags: this.flagsOff.length, stubs: this.stubsOff.length, seq: this.seq, used: [...this.used] }
  }
  rollback(m: ReturnType<LabelPlacer['mark']>) {
    this.flagsOff.truncate(m.flags)
    this.stubsOff.truncate(m.stubs)
    this.seq = m.seq
    this.used = new Set(m.used)
  }

  /** Takes a spot: names its label (NL1, NL2, ... clear of every uid on the sheet) and keeps later labels and stubs off it. */
  commit(s: LabelSpot, from: Pt): PartInstance {
    let uid: string
    do uid = `NL${++this.seq}`
    while (this.used.has(uid))
    this.used.add(uid)
    const part = { ...s.part, uid, designator: uid }
    const flag = flagRect(part, this.m, true)
    this.flagsOff.push({ r: flag }, { r: line(s.base, s.elbow) }, { r: line(s.elbow, s.tip) })
    this.stubsOff.push({ r: flag }, { r: line(s.base, s.elbow) }, { r: line(s.elbow, s.tip) })
    return part
  }
}

/** For a hole of a board or a pad inside a body, each way out to the body's edge, nearest first: the direction and the edge point. */
export function edgeExits(board: Rect, at: Pt): { dir: Pt; base: Pt }[] {
  return [
    { dir: { x: -1, y: 0 }, base: { x: board.x, y: at.y }, g: at.x - board.x },
    { dir: { x: 1, y: 0 }, base: { x: board.x + board.w, y: at.y }, g: board.x + board.w - at.x },
    { dir: { x: 0, y: -1 }, base: { x: at.x, y: board.y }, g: at.y - board.y },
    { dir: { x: 0, y: 1 }, base: { x: at.x, y: board.y + board.h }, g: board.y + board.h - at.y },
  ].sort((a, b) => a.g - b.g).map(({ dir, base }) => ({ dir, base }))
}
