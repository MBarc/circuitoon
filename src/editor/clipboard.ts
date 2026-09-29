// Copy and paste of parts, wires, frames and notes. Pure: the editor moves the clip text through
// the system clipboard (with an in-memory fallback). A clip carries the modules its parts use, so a
// paste into another sheet, or another tab, works.
import { DIAGRAM_FORMAT, moduleOf, validateDiagram, type Annotation, type Connection, type Diagram, type Endpoint, type PartInstance } from '../format/diagram.ts'
import { bodyRect, type Pt } from '../format/geometry.ts'
import { layoutModule, type ModuleDef } from '../format/module.ts'
import { annotationRect } from '../render/annotationGeometry.ts'
import { designatorPrefix, withinLimit, type Selection } from './ops.ts'

export const CLIP_FORMAT = 'circuitoon-clip/1'
/** Clip text longer than this is never parsed (a pasted novel, not a clip). */
const CLIP_TEXT_MAX = 20_000_000
const GRID = 10

export interface Clip {
  format: typeof CLIP_FORMAT
  modules: Record<string, ModuleDef>
  parts: PartInstance[]
  connections: Connection[]
  annotations: Annotation[]
}

/**
 * The selected parts, frames and notes, the wires whose two ends are both on copied parts (a
 * selected wire to a part left behind is not copied), and the modules those parts use. Null when
 * nothing copyable is selected.
 */
export function copySelection(d: Diagram, sel: Selection): Clip | null {
  const uids = new Set(sel.parts)
  const notes = new Set(sel.annotations ?? [])
  const parts = d.parts.filter((p) => uids.has(p.uid))
  const annotations = (d.annotations ?? []).filter((a) => notes.has(a.uid))
  if (!parts.length && !annotations.length) return null
  const connections = d.connections.filter((c) => uids.has(c.from.part) && uids.has(c.to.part))
  const modules: Record<string, ModuleDef> = {}
  for (const p of parts) {
    const m = moduleOf(d, p.module)
    if (m) modules[p.module] = m
  }
  return { format: CLIP_FORMAT, modules, parts, connections, annotations }
}

export const clipText = (clip: Clip): string => JSON.stringify(clip)

/**
 * A clip from clipboard text, or null for anything else: only the clip format tag is accepted, and
 * the body must pass the same checks as a diagram file (modules, parts, wires, frames and notes).
 */
export function parseClip(text: string): Clip | null {
  if (!text || text.length > CLIP_TEXT_MAX) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.format !== CLIP_FORMAT || !Array.isArray(r.annotations)) return null
  const checked = validateDiagram({ format: DIAGRAM_FORMAT, title: 'clip', modules: r.modules, parts: r.parts, connections: r.connections, annotations: r.annotations })
  if (!checked.ok) return null
  const { modules, parts, connections, annotations } = checked.diagram
  return { format: CLIP_FORMAT, modules, parts, connections, annotations: annotations ?? [] }
}

/** The box around everything a clip draws (part bodies, frame and note boxes), or null if empty. */
function clipBounds(clip: Clip): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const take = (r: { x: number; y: number; w: number; h: number }) => {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  for (const p of clip.parts) {
    const m = moduleOf(clip, p.module)
    if (m) take(bodyRect(p, layoutModule(m)))
  }
  for (const a of clip.annotations) take(annotationRect(a))
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

const snap = (v: number) => Math.round(v / GRID) * GRID

/**
 * How far the `step`th paste in a row moves the clip (step counts from 1): one grid step further
 * from its source each time, or, with the pointer over the sheet, the clip centred under the
 * pointer on the grid and each repeat one grid step on from there.
 */
export function pasteDelta(clip: Clip, step: number, pointer: Pt | null): [number, number] {
  const b = pointer && clipBounds(clip)
  if (!pointer || !b) return [GRID * step, GRID * step]
  const on = GRID * (step - 1)
  return [snap(pointer.x - (b.x0 + b.x1) / 2) + on, snap(pointer.y - (b.y0 + b.y1) / 2) + on]
}

/** Hands out uids with `prefix` not in `used`, lowest first, claiming each. */
function uidMaker(used: Set<string>) {
  return (prefix: string) => {
    let n = 1
    while (used.has(prefix + n)) n++
    used.add(prefix + n)
    return prefix + n
  }
}

/**
 * Pastes a clip moved by (wantDx, wantDy), stopped at the coordinate limit so the pasted block
 * stays rigid. Every pasted part, wire and mark gets a new uid, and every part the next free
 * designator for its prefix. Wires keep their shape; a part keeps its mount only when its board is
 * pasted too. Modules the sheet lacks are added (a module the sheet already has is kept as is), and
 * a part whose module is in neither is skipped with its wires. Returns the pasted items as the new
 * selection.
 */
export function pasteClip(d: Diagram, clip: Clip, wantDx: number, wantDy: number): { diagram: Diagram; selection: Selection } {
  const modules = { ...d.modules }
  for (const [id, m] of Object.entries(clip.modules)) if (!Object.hasOwn(modules, id)) modules[id] = m
  const parts = clip.parts.filter((p) => Object.hasOwn(modules, p.module))
  const kept = new Set(parts.map((p) => p.uid))
  const wires = clip.connections.filter((c) => kept.has(c.from.part) && kept.has(c.to.part))

  const points: [number, number][] = [
    ...parts.map((p): [number, number] => [p.x, p.y]),
    ...wires.flatMap((c) => c.route ?? []),
    ...clip.annotations.map((a): [number, number] => [a.x, a.y]),
  ]
  const [dx, dy] = withinLimit(points, wantDx, wantDy)

  // Taken uids include wire ends and mount targets, as in nextUid, so nothing latches onto a stray reference.
  const uid = uidMaker(new Set([
    ...d.parts.flatMap((p) => (p.mount ? [p.uid, p.mount.board] : [p.uid])),
    ...d.connections.flatMap((c) => [c.uid, c.from.part, c.to.part]),
    ...(d.annotations ?? []).map((a) => a.uid),
  ]))
  const designators = new Set(d.parts.map((p) => p.designator))
  const designator = (m: ModuleDef) => {
    const prefix = designatorPrefix(m)
    let n = 1
    while (designators.has(prefix + n)) n++
    designators.add(prefix + n)
    return prefix + n
  }

  const renamed = new Map<string, string>()
  for (const p of parts) renamed.set(p.uid, uid('p'))
  const newParts = parts.map((p): PartInstance => {
    const { mount, ...rest } = p
    const board = mount && renamed.get(mount.board)
    return { ...rest, uid: renamed.get(p.uid)!, designator: designator(modules[p.module]), x: p.x + dx, y: p.y + dy, ...(board ? { mount: { board } } : {}) }
  })
  const end = (e: Endpoint): Endpoint => ({ ...e, part: renamed.get(e.part)! })
  const newWires = wires.map((c): Connection => ({
    ...c,
    uid: uid('w'),
    from: end(c.from),
    to: end(c.to),
    ...(c.route ? { route: c.route.map(([x, y]): [number, number] => [x + dx, y + dy]) } : {}),
  }))
  const newNotes = clip.annotations.map((a): Annotation => ({ ...a, uid: uid('a'), x: a.x + dx, y: a.y + dy }))

  const diagram: Diagram = {
    ...d,
    modules,
    parts: [...d.parts, ...newParts],
    connections: [...d.connections, ...newWires],
    ...(newNotes.length ? { annotations: [...(d.annotations ?? []), ...newNotes] } : {}),
  }
  const selection: Selection = { parts: newParts.map((p) => p.uid), wires: newWires.map((c) => c.uid) }
  return { diagram, selection: newNotes.length ? { ...selection, annotations: newNotes.map((a) => a.uid) } : selection }
}
