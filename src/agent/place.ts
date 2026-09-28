// Placement (agent toolkit spec 2.1): every part gets a position on the 10 px grid,
// deterministically. Boards (with the parts mounted on them, mount.ts) and microcontrollers go
// first, near the centre; every other unit goes near what it connects to, heaviest net weight
// first; repeat copies are tiled as one block and groups laid out in rows. Bodies and captions
// never overlap (mounted parts overlap only their own board). Ties always break by ref in natural
// order. Every kept position (`--keep`) stays exactly where it is, per part (amendment A6): the
// rest is placed around kept parts, and a kept position that cannot hold (a mounted part not seated
// there, or on a board that is not kept) is an error, never a silent move. With the rail module
// given, each repeat block gets rail strips of its own under its rows for its shared ground and
// power nets (amendment A18.1). Pure.
import { DIAGRAM_FORMAT, type Annotation, type Diagram, type PartInstance } from '../format/diagram.ts'
import { mountIssues } from '../format/breadboard.ts'
import type { Pt, Rect, Rotation } from '../format/geometry.ts'
import { isBoard } from '../format/module.ts'
import { annotationRect, wrapNote } from '../render/annotationGeometry.ts'
import { type Intent, terminalKey } from './netlist.ts'
import type { ModuleDef } from '../format/module.ts'
import { type LocalDistribution, netKind } from './realize.ts'
import { type NetOfPin, mountPart, stripClash } from './mount.ts'
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
  /**
   * The rail strip module (power-rail-strip). Given, each repeat block gets rail strips of its own
   * for its shared ground and power nets (amendment A18.1), added as routing infrastructure.
   */
  rail?: ModuleDef
}
export type PlaceResult =
  | {
      ok: true
      parts: PartInstance[]
      annotations: Annotation[]
      /** The intent's modules, plus the rail strip module when local strips were added. */
      modules: Record<string, ModuleDef>
      locals: LocalDistribution[]
    }
  | { ok: false; errors: string[] }

/** Step of the ring search, in px. */
const STEP = 20
/** Widest a group's row of parts grows before it wraps, in px. */
const GROUP_ROW = 640
/** Space between a frame and the parts inside it. */
const FRAME_PAD = 12
/** Where the content's top-left lands once placed (no kept parts). */
const MARGIN = 40
/** Holes of a local rail kept free for the jumpers that chain a block's strips and its trunk wire. */
const RAIL_SPARE = 4
/** Room between a row of copies and the local strips under it, and between those and the next row, in px. */
const RAIL_GAP = 20

const snap = (v: number) => Math.round(v / 10) * 10
const floor10 = (v: number) => Math.floor(v / 10) * 10
const ceil10 = (v: number) => Math.ceil(v / 10) * 10

interface Unit {
  key: string
  refs: string[]
  anchor: boolean
  fixed: boolean
  /** A part this unit is settled beside (a repeat block beside the part its bindings target). */
  near?: string
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

/**
 * The first offset near `want` (both multiples of 10) where `box` grown by `gap` clears everything
 * in `taken`. With `nearest`, the clear offset of that ring nearest `want` in a straight line wins
 * (ties in ring order), so a block settles squarely beside its target rather than at the ring's
 * top-left corner (amendment A18.2).
 */
function findSpot(box: Rect, want: Pt, taken: RectIndex, gap: number, nearest = false): Pt {
  for (let r = 0; ; r++) {
    let best: Pt | null = null
    let bestD = Infinity
    for (const o of ring(r)) {
      const at = { x: want.x + o.x * STEP, y: want.y + o.y * STEP }
      if (taken.hits(grow(shift(box, at.x, at.y), gap))) continue
      if (!nearest) return at
      const d = o.x * o.x + o.y * o.y
      if (d < bestD) {
        best = at
        bestD = d
      }
    }
    if (best) return best
  }
}

export function placeParts(intent: Intent, opts: PlaceOptions): PlaceResult {
  const keep = opts.keep ?? new Map<string, Keep>()
  const mods: Record<string, ModuleDef> = { ...intent.modules }
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
        const clash = stripClash(tried, m, ref, netOfPin)
        if (clash) {
          errors.push(`${m} is kept at (${km.x}, ${km.y}) on ${ref} but joins two different nets in strip ${clash} there.`)
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

  // Repeat copies: one row each, tiled in a near-square grid of equal cells. Copies bound to one
  // part (an expander's channels) form a block of their own, in channel order, that settles beside
  // that part (amendment A15), so each copy's wires stay short; copies with no binding form one
  // block. Kept members stay where they are; each block tiles the rest.
  const repeats = [...new Set(intent.copies.map((c) => c.repeat))]
  if (repeats.length > 1) return { ok: false, errors: [`Placement handles one repeat block, but the intent has ${repeats.length} (${repeats.join(', ')}).`] }
  const targetOf = (c: (typeof intent.copies)[number]) => {
    const ends = Object.keys(c.bindings).sort(naturalCompare).map((port) => c.bindings[port])
    return { ref: ends.length ? ends[0].split('.')[0] : '', channel: ends.join(' ') }
  }
  const blocks = new Map<string, { channel: string; refs: string[]; whole: boolean }[]>()
  for (const c of intent.copies) {
    const list = free(c.refs)
    if (!list.length) continue
    const t = targetOf(c)
    blocks.set(t.ref, [...(blocks.get(t.ref) ?? []), { channel: t.channel, refs: list, whole: list.length === c.refs.length }])
  }
  // Shared nets (A18.1): a ground or power net that reaches pins of two or more copies. A shared
  // signal net keeps the usual wiring (a rail strip is for supply nets).
  const copyOf = new Map<string, number>()
  intent.copies.forEach((c, i) => c.refs.forEach((r) => copyOf.set(r, i)))
  const shared = intent.nets.flatMap((n, ni) => {
    const terms = n.terminals.filter((t) => !t.infra && copyOf.has(t.ref))
    const kind = netKind(intent, n)
    if (kind === 'signal' || new Set(terms.map((t) => copyOf.get(t.ref))).size < 2) return []
    return [{ ni, rail: (kind === 'ground' ? '-' : '+') as '+' | '-', terms }]
  })
  const locals: LocalDistribution[] = []
  const intentRefs = new Set(intent.parts.map((p) => p.ref))
  let dpCount = 0
  const nextStrip = (): string => {
    let ref = ''
    do ref = `DP${++dpCount}`
    while (intentRefs.has(ref))
    return ref
  }
  /**
   * The local rail strips of one block (A18.1): for each row of `cols` copies, enough strips for
   * the row's pins on each shared net (ground on the - rails, power on the + rails), each rail
   * keeping RAIL_SPARE holes for jumpers. A strip that carries only ground is turned 180 degrees,
   * so its - rail faces the copies above it. Null when the block has no shared net.
   */
  const localRails = (copies: string[][], cols: number) => {
    const rail = opts.rail!
    const room = Math.min(...(rail.holes ?? []).map((g) => g.at.length)) - RAIL_SPARE
    const inBlock = new Set(copies.flat())
    const nets = shared.filter((sn) => sn.terms.filter((t) => inBlock.has(t.ref)).length >= 2)
    if (!nets.length || room < 1) return null
    mods[rail.id] = rail
    const byNet = new Map<number, LocalDistribution>()
    const rows: string[][] = []
    for (let r = 0; r * cols < copies.length; r++) {
      const inRow = new Set(copies.slice(r * cols, (r + 1) * cols).flat())
      const slots: Record<'+' | '-', number[]> = { '+': [], '-': [] }
      for (const sn of nets) {
        const need = sn.terms.filter((t) => inRow.has(t.ref)).length
        for (let k = 0; k < Math.ceil(need / room); k++) slots[sn.rail].push(sn.ni)
      }
      const list: string[] = []
      for (let k = 0; k < Math.max(slots['+'].length, slots['-'].length); k++) {
        const ref = nextStrip()
        inst.set(ref, { uid: ref, designator: ref, module: rail.id, x: 0, y: 0, rotation: k >= slots['+'].length ? 180 : 0 })
        for (const side of ['-', '+'] as const) {
          const ni = slots[side][k]
          if (ni === undefined) continue
          const l = byNet.get(ni) ?? { net: ni, strips: [], rail: side, refs: [...inBlock].sort(naturalCompare) }
          l.strips.push(ref)
          byNet.set(ni, l)
        }
        list.push(ref)
      }
      rows.push(list)
    }
    const h = Math.max(0, ...rows.flat().map((ref) => tight(ref).h))
    return { rows, h, locals: [...byNet.values()].sort((a, b) => a.net - b.net) }
  }
  for (const [target, members] of [...blocks].sort((a, b) => naturalCompare(a[0], b[0]))) {
    members.sort((a, b) => naturalCompare(a.channel, b.channel))
    const cells = members.map((m) => ({ refs: m.refs, box: row(m.refs, Infinity) }))
    const pad = opts.spacing + 2 * FRAME_PAD
    const cw = Math.max(...cells.map((c) => c.box.w)) + pad
    const ch = Math.max(...cells.map((c) => c.box.h)) + pad + 10
    const cols = Math.ceil(Math.sqrt(cells.length))
    // A partly kept copy (one of a ball's two switches kept) stays out of the local strips; its
    // pins use the net's own wiring. Its place in the rows is kept, so the other copies' strips
    // still sit under their own row.
    const rails = opts.rail ? localRails(members.map((m) => (m.whole ? m.refs : [])), cols) : null
    const rowH = rails ? ch + rails.h + 2 * RAIL_GAP : ch
    cells.forEach((c, i) => move(c.refs, snap((i % cols) * cw - c.box.x), snap(Math.floor(i / cols) * rowH - c.box.y)))
    const all = cells.flatMap((c) => c.refs)
    if (rails) {
      // Each row's strips sit under it, spread evenly across the row's width.
      const cellH = Math.max(...cells.map((c) => c.box.h))
      for (const [r, list] of rails.rows.entries()) {
        const inRow = Math.min(cols, cells.length - r * cols)
        const width = inRow * cw - pad
        for (const [k, ref] of list.entries()) {
          const t = tight(ref)
          const p = inst.get(ref)!
          const cx = (width * (k + 0.5)) / list.length
          inst.set(ref, { ...p, x: snap(cx - t.w / 2 - (t.x - p.x)), y: snap(r * rowH + cellH + RAIL_GAP - (t.y - p.y)) })
          all.push(ref)
        }
      }
      locals.push(...rails.locals)
    }
    const repeat = intent.copies[0].repeat
    units.push({ key: target ? `${repeat} ${target}` : repeat, refs: all, anchor: false, fixed: false, ...(inst.has(target) ? { near: target } : {}) })
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
  const placedRefs = new Set<string>()
  const put = (u: Unit) => {
    for (const r of u.refs) placedRefs.add(r)
    const b = boxOf(u)
    taken.add(b)
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    for (const n of netsOfUnit(u)) placedNets.set(n, [...(placedNets.get(n) ?? []), c])
  }
  const settle = (u: Unit, target: Pt, nearest = false) => {
    const b = boxOf(u)
    const at = findSpot(b, { x: snap(target.x - b.x - b.w / 2), y: snap(target.y - b.y - b.h / 2) }, taken, opts.spacing, nearest)
    move(u.refs, at.x, at.y)
    put(u)
  }
  // Repeat blocks bound to a part settle beside it (amendment A15), each one right after the unit
  // holding its target, before the next board or microcontroller is placed, so the room beside
  // every target is still free for its own block (amendment A18.2).
  const blocksOf = (u: Unit) => units.filter((x) => !x.fixed && !x.anchor && x.near && u.refs.includes(x.near) && !placedRefs.has(x.refs[0]))
  const settleBlocks = (u: Unit) => {
    for (const b of blocksOf(u)) {
      const near = tight(b.near!)
      settle(b, { x: near.x + near.w / 2, y: near.y + near.h / 2 }, true)
    }
  }
  const fixedUnits = units.filter((x) => x.fixed)
  for (const u of fixedUnits) put(u)
  for (const u of fixedUnits) settleBlocks(u)
  for (const u of units.filter((x) => !x.fixed && x.anchor).sort((a, b) => naturalCompare(a.key, b.key))) {
    settle(u, { x: 0, y: 0 })
    settleBlocks(u)
  }
  let rest = units.filter((x) => !x.fixed && !x.anchor && !placedRefs.has(x.refs[0]))
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

  const added = [...new Set(locals.flatMap((l) => l.strips))].sort(naturalCompare)

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
  for (const r of [...refs, ...added]) clear.add(tight(r))
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

  // Content to the sheet origin, unless something was kept where it was (a kept ref the intent
  // lacks keeps nothing).
  let out = annotations
  const rects = [...refs.map(fp), ...added.map(fp), ...annotations.map(annotationRect)]
  const anyKept = intent.parts.some((p) => keep.has(p.ref))
  if (!anyKept && rects.length) {
    const all = rects.reduce(union)
    const dx = ceil10(MARGIN - all.x)
    const dy = ceil10(MARGIN - all.y)
    move([...refs, ...added], dx, dy)
    out = annotations.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }))
  }
  const modules = Object.fromEntries(Object.entries(mods).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
  return { ok: true, parts: [...intent.parts.map((p) => inst.get(p.ref)!), ...added.map((r) => inst.get(r)!)], annotations: out, modules, locals }
}
