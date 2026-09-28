// Placement (agent toolkit spec 2.1): every part gets a position on the 10 px grid,
// deterministically. Boards (with the parts mounted on them, mount.ts) and microcontrollers go
// first, near the centre; every other unit goes near what it connects to, heaviest net weight
// first; repeat copies are tiled as one block and groups laid out in rows. Bodies and captions
// never overlap (mounted parts overlap only their own board). Ties always break by ref in natural
// order. Every kept position (`--keep`) stays exactly where it is, per part (amendment A6): the
// rest is placed around kept parts, and a kept position that cannot hold (a mounted part not seated
// there, or on a board that is not kept) is an error, never a silent move. Pure.
import { DIAGRAM_FORMAT, type Annotation, type Diagram, type PartInstance } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import type { Pt, Rect, Rotation } from '../format/geometry.ts'
import { isBoard } from '../format/module.ts'
import { annotationRect, wrapNote } from '../render/annotationGeometry.ts'
import { type Intent, terminalKey } from './netlist.ts'
import { type NetOfPin, mountPart } from './mount.ts'
import { RectIndex, footprint, grow, shift, tightFootprint, union } from './footprint.ts'
import { naturalCompare } from './order.ts'

export interface Keep {
  x: number
  y: number
  rotation: Rotation
}
export type KeepMap = Map<string, Keep>
export interface PlaceOptions {
  /** Least gap, in px, between the footprints of two placed units (grows on each retry). */
  spacing: number
  keep?: KeepMap
}
export type PlaceResult = { ok: true; parts: PartInstance[]; annotations: Annotation[] } | { ok: false; errors: string[] }

/** Step of the ring search, in px. */
const STEP = 20
/** Widest a group's row of parts grows before it wraps, in px. */
const GROUP_ROW = 640
/** Space between a frame and the parts inside it. */
const FRAME_PAD = 12
/** Where the content's top-left lands once placed (no kept parts). */
const MARGIN = 40

const snap = (v: number) => Math.round(v / 10) * 10
const floor10 = (v: number) => Math.floor(v / 10) * 10
const ceil10 = (v: number) => Math.ceil(v / 10) * 10

interface Unit {
  key: string
  refs: string[]
  anchor: boolean
  fixed: boolean
}

/** Ring r around (0, 0), in a fixed order: top edge left to right, right edge down, bottom edge right to left, left edge up. */
function ring(r: number): Pt[] {
  if (r === 0) return [{ x: 0, y: 0 }]
  const out: Pt[] = []
  for (let x = -r; x <= r; x++) out.push({ x, y: -r })
  for (let y = -r + 1; y <= r; y++) out.push({ x: r, y })
  for (let x = r - 1; x >= -r; x--) out.push({ x, y: r })
  for (let y = r - 1; y > -r; y--) out.push({ x: -r, y })
  return out
}

/** The first offset near `want` (both multiples of 10) where `box` grown by `gap` clears everything in `taken`. */
function findSpot(box: Rect, want: Pt, taken: RectIndex, gap: number): Pt {
  for (let r = 0; ; r++)
    for (const o of ring(r)) {
      const at = { x: want.x + o.x * STEP, y: want.y + o.y * STEP }
      if (!taken.hits(grow(shift(box, at.x, at.y), gap))) return at
    }
}

export function placeParts(intent: Intent, opts: PlaceOptions): PlaceResult {
  const keep = opts.keep ?? new Map<string, Keep>()
  const mods = intent.modules
  const inst = new Map<string, PartInstance>()
  for (const p of intent.parts) inst.set(p.ref, { uid: p.ref, designator: p.ref, module: p.module, x: 0, y: 0, rotation: 0, ...(p.values ? { values: p.values } : {}) })
  const modOf = (ref: string) => mods[inst.get(ref)!.module]
  const fp = (ref: string) => footprint(inst.get(ref)!, modOf(ref))
  const tight = (ref: string) => tightFootprint(inst.get(ref)!, modOf(ref))
  const move = (refs: string[], dx: number, dy: number) => {
    for (const r of refs) {
      const p = inst.get(r)!
      inst.set(r, { ...p, x: p.x + dx, y: p.y + dy })
    }
  }
  const pinNet = new Map<string, number>()
  const netsOf = new Map<string, Set<number>>()
  intent.nets.forEach((n, i) =>
    n.terminals.forEach((t) => {
      pinNet.set(terminalKey(t.ref, t.name), i)
      netsOf.set(t.ref, (netsOf.get(t.ref) ?? new Set<number>()).add(i))
    }),
  )
  const netOfPin: NetOfPin = (part, pin) => pinNet.get(terminalKey(part, pin))
  const refs = intent.parts.map((p) => p.ref).sort(naturalCompare)
  const units: Unit[] = []
  const grouped = new Set<string>()

  // Each board with the parts mounted on it. A kept board stays put. Kept mounted parts are seated
  // first, exactly where they were (an error if they are not seated there or their board moves),
  // then the search finds a spot for each of the others.
  const errors: string[] = []
  for (const ref of refs) {
    if (!isBoard(modOf(ref))) continue
    const k = keep.get(ref)
    if (k) inst.set(ref, { ...inst.get(ref)!, ...k })
    let local: Diagram = { format: DIAGRAM_FORMAT, title: '', modules: mods, parts: [inst.get(ref)!], connections: [] }
    const mounted = intent.parts.filter((q) => q.on === ref).map((q) => q.ref).sort(naturalCompare)
    const keptFirst = [...mounted.filter((m) => keep.has(m)), ...mounted.filter((m) => !keep.has(m))]
    for (const m of keptFirst) {
      const km = keep.get(m)
      if (km) {
        if (!k) {
          errors.push(`${m} is kept but its board ${ref} is not: keep ${ref} too, or drop ${m}'s position.`)
          continue
        }
        const trial: PartInstance = { ...inst.get(m)!, ...km, mount: { board: ref } }
        const tried: Diagram = { ...local, parts: [...local.parts, trial] }
        const issue = mountIssues(tried).find((i) => i.part === m)
        if (issue) {
          errors.push(`${m} is kept at (${km.x}, ${km.y}) but is not seated on ${ref} there (${issue.reason}).`)
          continue
        }
        inst.set(m, trial)
        local = tried
        continue
      }
      if (errors.length) break
      const r = mountPart({ ...local, parts: [...local.parts, inst.get(m)!] }, m, ref, netOfPin)
      if (!r.ok) return { ok: false, errors: [r.error] }
      inst.set(m, r.part)
      local = { ...local, parts: [...local.parts, r.part] }
    }
    // One more pass, in the same order: a part mounted before its neighbours could not see their
    // nets (D1 before R1), so each unkept part moves when a spot now scores better (net affinity).
    if (!errors.length)
      for (const m of mounted) {
        if (keep.has(m)) continue
        const r = mountPart(local, m, ref, netOfPin, inst.get(m)!)
        const was = inst.get(m)!
        if (!r.ok || (r.part.x === was.x && r.part.y === was.y && r.part.rotation === was.rotation)) continue
        inst.set(m, r.part)
        local = { ...local, parts: local.parts.map((p) => (p.uid === m ? r.part : p)) }
      }
    units.push({ key: ref, refs: [ref, ...mounted], anchor: true, fixed: !!k })
    for (const r of [ref, ...mounted]) grouped.add(r)
  }
  if (errors.length) return { ok: false, errors }
  /** A kept part outside a board is a unit of its own that never moves; `free` drops it from `list`. */
  const free = (list: string[]) => {
    for (const r of list)
      if (keep.has(r) && !grouped.has(r)) {
        units.push({ key: r, refs: [r], anchor: modOf(r).category === 'Microcontrollers', fixed: true })
        grouped.add(r)
      }
    return list.filter((r) => !grouped.has(r))
  }

  /** Lays refs out left to right from (0, 0), wrapping past `width`; returns their footprint box. */
  const row = (list: string[], width: number): Rect => {
    let x = 0
    let y = 0
    let rowH = 0
    let box: Rect | null = null
    for (const ref of list) {
      const f0 = fp(ref)
      const p = inst.get(ref)!
      if (x > 0 && x + f0.w > width) {
        x = 0
        y += rowH + 10
        rowH = 0
      }
      inst.set(ref, { ...p, x: snap(x + p.x - f0.x), y: snap(y + p.y - f0.y) })
      const f = fp(ref)
      box = box ? union(box, f) : f
      x = f.x + f.w + 10
      rowH = Math.max(rowH, f.h)
    }
    return box ?? { x: 0, y: 0, w: 0, h: 0 }
  }

  // Repeat copies: one row each, tiled in a near-square grid of equal cells. Kept members stay
  // where they are; the block tiles the rest.
  const copies = intent.copies.map((c) => free(c.refs)).filter((list) => list.length)
  if (copies.length) {
    const cells = copies.map((list) => ({ refs: list, box: row(list, Infinity) }))
    const pad = opts.spacing + 2 * FRAME_PAD
    const cw = Math.max(...cells.map((c) => c.box.w)) + pad
    const ch = Math.max(...cells.map((c) => c.box.h)) + pad + 10
    const cols = Math.ceil(Math.sqrt(cells.length))
    cells.forEach((c, i) => move(c.refs, snap((i % cols) * cw - c.box.x), snap(Math.floor(i / cols) * ch - c.box.y)))
    const all = cells.flatMap((c) => c.refs)
    units.push({ key: intent.copies[0].repeat, refs: all, anchor: false, fixed: false })
    for (const r of all) grouped.add(r)
  }
  for (const g of intent.groups) {
    const left = free(g.refs.filter((r) => !grouped.has(r)))
    if (!left.length) continue
    row(left, GROUP_ROW)
    units.push({ key: `group ${g.name}`, refs: left, anchor: left.some((r) => modOf(r).category === 'Microcontrollers'), fixed: false })
    for (const r of left) grouped.add(r)
  }
  for (const ref of refs) {
    if (grouped.has(ref)) continue
    row([ref], Infinity)
    units.push({ key: ref, refs: [ref], anchor: modOf(ref).category === 'Microcontrollers', fixed: keep.has(ref) })
  }
  for (const u of units)
    if (u.fixed)
      for (const r of u.refs) {
        const k = keep.get(r)
        if (k && !inst.get(r)!.mount) inst.set(r, { ...inst.get(r)!, ...k })
      }

  // Fixed units first, then anchors near the centre, then the rest by net weight.
  const taken = new RectIndex()
  const placedNets = new Map<number, Pt[]>()
  const boxOf = (u: Unit) => u.refs.map(fp).reduce(union)
  const netsOfUnit = (u: Unit) => new Set(u.refs.flatMap((r) => [...(netsOf.get(r) ?? [])]))
  const put = (u: Unit) => {
    const b = boxOf(u)
    taken.add(b)
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    for (const n of netsOfUnit(u)) placedNets.set(n, [...(placedNets.get(n) ?? []), c])
  }
  const settle = (u: Unit, target: Pt) => {
    const b = boxOf(u)
    const at = findSpot(b, { x: snap(target.x - b.x - b.w / 2), y: snap(target.y - b.y - b.h / 2) }, taken, opts.spacing)
    move(u.refs, at.x, at.y)
    put(u)
  }
  for (const u of units) if (u.fixed) put(u)
  for (const u of units.filter((x) => !x.fixed && x.anchor).sort((a, b) => naturalCompare(a.key, b.key))) settle(u, { x: 0, y: 0 })
  let rest = units.filter((x) => !x.fixed && !x.anchor)
  while (rest.length) {
    let best = rest[0]
    let bestWeight = -1
    for (const u of rest) {
      const w = [...netsOfUnit(u)].filter((n) => placedNets.has(n)).length
      if (w > bestWeight || (w === bestWeight && naturalCompare(u.key, best.key) < 0)) {
        best = u
        bestWeight = w
      }
    }
    const pts = [...netsOfUnit(best)].flatMap((n) => placedNets.get(n) ?? [])
    settle(best, pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : { x: 0, y: 0 })
    rest = rest.filter((u) => u !== best)
  }

  // Frames around each group and each copy, then notes below their target.
  const annotations: Annotation[] = []
  const frames = new Map<string, Annotation>()
  const frameOf = (list: string[], label: string) => {
    const r = grow(list.map(tight).reduce(union), FRAME_PAD)
    const x = floor10(r.x)
    const y = floor10(r.y)
    const a: Annotation = { uid: `a${annotations.length + 1}`, type: 'frame', x, y, w: ceil10(r.x + r.w) - x, h: ceil10(r.y + r.h) - y, label }
    annotations.push(a)
    return a
  }
  for (const g of intent.groups) if (g.refs.length) frames.set(g.name, frameOf(g.refs, g.name))
  for (const c of intent.copies) frameOf(c.refs, `${c.repeat} ${c.index}`)
  const clear = new RectIndex()
  for (const r of refs) clear.add(tight(r))
  for (const a of annotations) clear.add(annotationRect(a))
  for (const n of intent.notes) {
    const frame = frames.get(n.near)
    const target = frame ? annotationRect(frame) : tight(n.near)
    const probe: Annotation = { uid: `a${annotations.length + 1}`, type: 'text', x: 0, y: 0, text: wrapNote(n.text) }
    const at = findSpot(annotationRect(probe), { x: snap(target.x), y: snap(target.y + target.h + 10) }, clear, 6)
    const note = { ...probe, x: at.x, y: at.y }
    annotations.push(note)
    clear.add(annotationRect(note))
  }

  // Content to the sheet origin, unless something was kept where it was.
  let out = annotations
  const rects = [...refs.map(fp), ...annotations.map(annotationRect)]
  if (!keep.size && rects.length) {
    const all = rects.reduce(union)
    const dx = ceil10(MARGIN - all.x)
    const dy = ceil10(MARGIN - all.y)
    move(refs, dx, dy)
    out = annotations.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }))
  }
  return { ok: true, parts: intent.parts.map((p) => inst.get(p.ref)!), annotations: out }
}
