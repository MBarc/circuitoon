// Readability warnings for `check` and `gate` (never blocking): what makes a correct sheet hard to
// follow. Read from the wires as drawn (wirePaths, after lane separation):
// - wires-overlap: two wires (of any nets) lying on top of each other along one line for more than
//   OVERLAP px, so neither can be traced (Ruling W1; never where both end at one point);
// - wires-crowded: two wires of different nets side by side within one grid step over more than
//   CROWDED_RUN px (a row of stubs out to net labels at pin pitch is meant that way, so only two drawn
//   on top of each other count);
// - wire-hugs-part: a wire within HUG px of, or over, a body it does not connect to (boards excluded:
//   wires lie on breadboards by design);
// - label-covered: a wire or another part over a caption, a net label's flag or a DIP's pin names;
// - crossings-high: a wire that crosses more than CROSSINGS_MAX wires of other nets.
// The editor does not show them: a hand-drawn sheet's header fans are crowded by nature, and these
// need every route on every edit. Pure.
import { type Diagram, type Endpoint, type PartInstance, type Routes, computeRoutes, moduleOf, wirePaths } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { isNetLabel, layoutModule } from '../format/module.ts'
import { endpointName } from '../format/checks.ts'
import { flagRect, labelName } from '../format/netLabels.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { plugOfPin } from '../format/breadboard.ts'
import { placedCaptionBox, tipLabelBoxes } from '../render/captionBox.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { naturalCompare } from './order.ts'

export const GRID_STEP = 10
/** Side-by-side run, in px, past which two crowded wires are reported. */
export const CROWDED_RUN = 40
/** A wire this close to a body (px) hugs it. */
export const HUG = 5
/** A wire crossing more than this many other wires is reported. */
export const CROSSINGS_MAX = 8
/** A wire to a net label shorter than this (px) is a layout stub; a row of them is not crowded. */
export const LABEL_STUB = 30

/** Every rule a readability finding can have; while any is reported, a gate is not ready (Ruling W1). */
export const READABILITY_RULES = ['wires-overlap', 'wires-crowded', 'wire-hugs-part', 'label-covered', 'crossings-high', 'wire-over-board'] as const
/** Two wires sharing a run longer than this (px) on one line are drawn on top of each other. */
export const OVERLAP = 2

export interface ReadabilityFinding {
  id: string
  rule: (typeof READABILITY_RULES)[number]
  severity: 'warning'
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

interface Seg {
  wire: string
  h: boolean
  at: number
  lo: number
  hi: number
  /** On the run into a pin (a wire's first or last segment ending at a pin): that pin's part. */
  into?: string
}

function segmentsOf(wire: string, pts: Pt[], ends: [string | undefined, string | undefined] = [undefined, undefined]): Seg[] {
  const out: Seg[] = []
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]]
    const into = k === 1 ? ends[0] : k === pts.length - 1 ? ends[1] : undefined
    const tag = into !== undefined ? { into } : {}
    if (a.y === b.y && a.x !== b.x) out.push({ wire, h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), ...tag })
    else if (a.x === b.x && a.y !== b.y) out.push({ wire, h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), ...tag })
  }
  return out
}

/** Length of segment `s` that lies strictly inside `r` (0 when it does not enter it). */
function inside(s: Seg, r: Rect): number {
  const [across, from, to] = s.h ? [s.at, r.x, r.x + r.w] : [s.at, r.y, r.y + r.h]
  const [lo, hi] = s.h ? [r.y, r.y + r.h] : [r.x, r.x + r.w]
  if (!(across > lo && across < hi)) return 0
  return Math.max(0, Math.min(s.hi, to) - Math.max(s.lo, from))
}

const parts0 = (d: Diagram) => d.parts
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function readabilityFindings(d: Diagram, routes: Routes = computeRoutes(d)): ReadabilityFinding[] {
  const out: ReadabilityFinding[] = []
  const drawn = wirePaths(d, routes)
  const byUid = new Map(d.connections.map((c) => [c.uid, c]))
  const name = (uid: string) => {
    const c = byUid.get(uid)!
    return c.label || `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`
  }
  const nl = netlist(d)
  const netCache = new Map<string, number | string>()
  const netOf = (uid: string) => {
    let n = netCache.get(uid)
    if (n === undefined) {
      const c = byUid.get(uid)!
      netCache.set(uid, (n = nl.netOf.get(nodeKey(c.from.part, c.from.pin)) ?? `wire ${uid}`))
    }
    return n
  }
  // An end on a part (not a net label) tags the run into it with that part, or with its board for a
  // hole or a plugged leg: rows of holes and rails sit at a pitch of their own, like a header's pins.
  const pinEnd = (e: Endpoint) => {
    const p = d.parts.find((x) => x.uid === e.part)
    const m = p && moduleOf(d, p.module)
    if (!m || isNetLabel(m)) return undefined
    return p.mount && plugOfPin(d, p.uid, e.pin) ? p.mount.board : e.part
  }
  const segs = drawn.flatMap((w) => segmentsOf(w.conn.uid, w.points, [pinEnd(w.conn.from), pinEnd(w.conn.to)]))
  const labelParts = new Set(parts0(d).filter((p) => isNetLabel(moduleOf(d, p.module))).map((p) => p.uid))
  const lengthOf = new Map(drawn.map((w) => [w.conn.uid, w.points.slice(1).reduce((n, p, i) => n + Math.abs(p.x - w.points[i].x) + Math.abs(p.y - w.points[i].y), 0)]))
  /** A short stub out to a net label (under LABEL_STUB px): a fan-out row of them is meant that way. */
  const stub = (uid: string) => {
    const c = byUid.get(uid)!
    return (labelParts.has(c.from.part) || labelParts.has(c.to.part)) && (lengthOf.get(uid) ?? 0) < LABEL_STUB
  }
  const hs = segs.filter((s) => s.h)
  const vs = segs.filter((s) => !s.h)
  const parts = d.parts.filter((p) => moduleOf(d, p.module))
  const partName = (p: PartInstance) => {
    const m = moduleOf(d, p.module)!
    return isNetLabel(m) ? `label ${labelName(p) || p.designator}` : p.designator
  }

  // Crowded: one finding per pair of wires, its closest gap and longest side-by-side run.
  const crowded = new Map<string, { a: string; b: string; gap: number; run: number }>()
  // Segments bucketed by their line (one grid step a bucket), so each is compared only with those
  // within a grid step of it, never with every other segment on the sheet.
  for (const list of [hs, vs]) {
    const buckets = new Map<number, number[]>()
    list.forEach((x, i) => {
      const k = Math.floor(x.at / GRID_STEP)
      buckets.set(k, [...(buckets.get(k) ?? []), i])
    })
    for (let i = 0; i < list.length; i++) {
      const k = Math.floor(list[i].at / GRID_STEP)
      for (const j of [k - 1, k, k + 1].flatMap((b) => buckets.get(b) ?? [])) {
        if (j <= i) continue
        const [s, t] = [list[i], list[j]]
        if (s.wire === t.wire || Math.abs(s.at - t.at) > GRID_STEP || netOf(s.wire) === netOf(t.wire)) continue
        // A row of stubs out to net labels at the pins' own pitch is laid out that way on purpose; only
        // two of them drawn on top of each other are crowded.
        if (s.at !== t.at && stub(s.wire) && stub(t.wire)) continue
        // Neither are two wires running into neighbouring pins of one header, or holes of one board,
        // at its own pitch, as jumpers there always sit (Ruling W1).
        if (s.at !== t.at && s.into !== undefined && s.into === t.into) continue
        const run = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo)
        if (run <= CROWDED_RUN) continue
        const [a, b] = [s.wire, t.wire].sort(naturalCompare)
        const key = `${a}|${b}`
        const gap = Math.abs(s.at - t.at)
        if (gap === 0) continue // on top of each other: wires-overlap reports it
        const was = crowded.get(key)
        if (!was || gap < was.gap || (gap === was.gap && run > was.run)) crowded.set(key, { a, b, gap, run })
      }
    }
  }
  // On top of each other (Ruling W1): two wires, of any nets, sharing a run on one line. Not where
  // both end at the same point (two wires on one screw terminal) and the shared run starts there.
  const endsOf = new Map(drawn.map((w) => [w.conn.uid, [w.points[0], w.points[w.points.length - 1]]]))
  const overlap = new Map<string, { a: string; b: string; run: number }>()
  for (const list of [hs, vs]) {
    const buckets = new Map<number, number[]>()
    list.forEach((x, i) => buckets.set(x.at, [...(buckets.get(x.at) ?? []), i]))
    for (const idx of buckets.values())
      for (let i = 0; i < idx.length; i++)
        for (let j = i + 1; j < idx.length; j++) {
          const [s, t] = [list[idx[i]], list[idx[j]]]
          if (s.wire === t.wire) continue
          const lo = Math.max(s.lo, t.lo)
          const hi = Math.min(s.hi, t.hi)
          if (hi - lo <= OVERLAP) continue
          const shared = endsOf.get(s.wire)!.some((p) => endsOf.get(t.wire)!.some((q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5))
          if (shared) continue
          const [a, b] = [s.wire, t.wire].sort(naturalCompare)
          const key = `${a}|${b}`
          overlap.set(key, { a, b, run: Math.max(overlap.get(key)?.run ?? 0, hi - lo) })
        }
  }
  for (const { a, b, run } of overlap.values())
    out.push({ id: `wires-overlap|${a},${b}`, rule: 'wires-overlap', severity: 'warning', parts: [], pins: [], wires: [a, b],
      message: `The wires ${name(a)} and ${name(b)} lie on top of each other for ${Math.round(run)} px, so neither can be traced. Lay the sheet out again, or drag one of them onto its own line.` })

  for (const { a, b, gap, run } of crowded.values())
    out.push({ id: `wires-crowded|${a},${b}`, rule: 'wires-crowded', severity: 'warning', parts: [], pins: [], wires: [a, b],
      message: `The wires ${name(a)} and ${name(b)} run side by side, ${gap} px apart, for ${run} px. Move one of them at least ${2 * GRID_STEP} px away (drag its segment), or draw one of the nets with net labels.` })

  // Hugging a body: boards (breadboards, rail strips) and net labels are not bodies a wire hugs.
  const bodies = parts.flatMap((p) => {
    const m = moduleOf(d, p.module)!
    return m.obstacle === false || isNetLabel(m) ? [] : [{ p, r: bodyRect(p, layoutModule(m)) }]
  })
  const hugged = new Set<string>()
  for (const s of segs) {
    const c = byUid.get(s.wire)!
    for (const { p, r } of bodies) {
      if (c.from.part === p.uid || c.to.part === p.uid) continue
      // Over the body (a hand-shaped wire, or one nudged there) reads as connected even more than beside it.
      const over = inside(s, r) > 0
      if (!over && inside(s, grow(r, HUG)) < GRID_STEP) continue
      const key = `${s.wire}|${p.uid}`
      if (hugged.has(key)) continue
      hugged.add(key)
      out.push({ id: `wire-hugs-part|${key}`, rule: 'wire-hugs-part', severity: 'warning', parts: [p.uid], pins: [], wires: [s.wire],
        message: over
          ? `The wire ${name(s.wire)} runs over ${p.designator}'s body, which it does not connect to, so it reads as connected there. Move the wire or the part so it runs clear of the body.`
          : `The wire ${name(s.wire)} runs within ${HUG} px of ${p.designator}'s body, which it does not connect to, so it reads as touching it. Move the wire or the part so at least ${GRID_STEP} px of paper shows between them.` })
    }
  }

  // Covered labels and captions: a net label's flag, or a part's caption.
  const seated = seatedLabels(d)
  const boxes = parts.map((p) => {
    const m = moduleOf(d, p.module)!
    return { p, kind: isNetLabel(m) ? 'label' : 'caption', r: isNetLabel(m) ? flagRect(p, m, true) : placedCaptionBox(p, m, seated.get(p.uid)) }
  })
  // Pin names printed past a DIP chip's pins: a wire over one could hide which pin is which.
  const names = parts.flatMap((p) => tipLabelBoxes(p, moduleOf(d, p.module)!).map((r) => ({ p, kind: 'names', r })))
  const what = (b: { p: PartInstance; kind: string }) => (b.kind === 'label' ? partName(b.p) : b.kind === 'names' ? `${b.p.designator}'s pin names` : `${b.p.designator}'s caption`)
  const covered = new Set<string>()
  for (const s of segs)
    for (const b of [...boxes, ...names]) {
      if (inside(s, b.r) <= 0) continue
      // A wire to the chip itself leaves along its own pin, past that pin's name.
      if (b.kind === 'names') {
        const c = byUid.get(s.wire)!
        if (c.from.part === b.p.uid || c.to.part === b.p.uid) continue
      }
      const key = `${s.wire}|${b.p.uid}`
      if (covered.has(key)) continue
      covered.add(key)
      out.push({ id: `label-covered|${key}`, rule: 'label-covered', severity: 'warning', parts: [b.p.uid], pins: [], wires: [s.wire],
        message: `The wire ${name(s.wire)} covers ${what(b)}, so it is hard to read. Move the wire or the part so it reads clearly.` })
    }
  const own = (a: PartInstance, b: PartInstance) => a === b || a.mount?.board === b.uid || b.mount?.board === a.uid
  for (const b of boxes)
    for (const { p, r } of bodies) {
      if (own(p, b.p) || !meets(r, b.r)) continue
      out.push({ id: `label-covered|${p.uid}|${b.p.uid}`, rule: 'label-covered', severity: 'warning', parts: [p.uid, b.p.uid], pins: [], wires: [],
        message: `${p.designator}'s body covers ${what(b)}. Move one of the parts so it reads clearly.` })
    }

  // Over a populated board (Ruling W1): no route kept off it, so the wire was let across it.
  for (const c of d.connections)
    if (routes.get(c.uid)?.overBoard)
      out.push({ id: `wire-over-board|${c.uid}`, rule: 'wire-over-board', severity: 'warning', parts: [c.from.part, c.to.part], pins: [], wires: [c.uid],
        message: `The wire ${name(c.uid)} runs across a breadboard with parts on it, because no route around it was found, so it may read as plugged in there. Give the parts more room (layout --keep with fewer parts pinned), or move the parts it joins away from the board.` })

  // Crossings per wire.
  const crossings = new Map<string, Set<string>>()
  for (const h of hs)
    for (const v of vs) {
      // A crossing with the wire's own net joins nothing new; only other nets' wires count.
      if (h.wire === v.wire || !(v.at > h.lo && v.at < h.hi && h.at > v.lo && h.at < v.hi) || netOf(h.wire) === netOf(v.wire)) continue
      for (const [a, b] of [[h.wire, v.wire], [v.wire, h.wire]]) {
        let set = crossings.get(a)
        if (!set) crossings.set(a, (set = new Set()))
        set.add(b)
      }
    }
  for (const [uid, others] of [...crossings].sort((x, y) => naturalCompare(x[0], y[0])))
    if (others.size > CROSSINGS_MAX)
      out.push({ id: `crossings-high|${uid}`, rule: 'crossings-high', severity: 'warning', parts: [], pins: [], wires: [uid],
        message: `The wire ${name(uid)} crosses ${others.size} other wires, so it is hard to follow. Move a part it connects so the wire runs clear, or draw its net with net labels.` })

  return out.sort((a, b) => naturalCompare(a.rule, b.rule) || naturalCompare(a.id, b.id))
}
