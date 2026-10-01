// The readability report every layout prints (agent toolkit spec 2.3): body overlaps and caption
// overlaps (both must be 0; a mounted part may overlap only its own board), wire crossings, total
// wire length, sheet size and blocked nets (must be none). `overlaps` names each overlapping pair,
// so layout can fail with them (amendment A7). Pure.
import { type Diagram, type PartInstance, type Routes, moduleOf } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { isNetLabel, layoutModule } from '../format/module.ts'
import { flagRect } from '../format/netLabels.ts'
import { placedCaptionBox } from '../render/captionBox.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { intersects, union } from './footprint.ts'
import { naturalCompare } from './order.ts'

export interface ReadabilityReport {
  bodyOverlaps: number
  captionOverlaps: number
  wireCrossings: number
  /** Sum of every routed wire's length, in px. */
  wireLength: number
  sheet: { w: number; h: number }
  blockedNets: string[]
  /** The layout's label mode and the nets it drew with net labels (layout only). */
  labels?: { mode: 'auto' | 'none' | 'all'; nets: string[]; unplaced: string[] }
  /** How many readability warnings (crowded wires, hugged parts, covered labels, many crossings) the sheet has (layout only). */
  readabilityWarnings?: number
}

/** Every overlapping pair on the sheet, as "R1 and R2" (bodies) or "R1 caption and R2 body". */
export function overlaps(d: Diagram): { body: string[]; caption: string[] } {
  const parts = d.parts.filter((p) => moduleOf(d, p.module)).sort((a, b) => naturalCompare(a.uid, b.uid))
  // A net label's body is its drawn flag, so labels on neighbouring header pins never count as overlapping.
  const seated = seatedLabels(d)
  // Each part's rectangles once (the pair loops below would otherwise rebuild them n times).
  const rects = new Map(parts.map((p) => {
    const m = moduleOf(d, p.module)!
    return [p, { body: isNetLabel(m) ? flagRect(p, m, true) : bodyRect(p, layoutModule(m)), caption: placedCaptionBox(p, m, seated.get(p.uid)) }]
  }))
  const body = (p: PartInstance) => rects.get(p)!.body
  const caption = (p: PartInstance) => rects.get(p)!.caption
  const own = (a: PartInstance, b: PartInstance) => a.mount?.board === b.uid || b.mount?.board === a.uid
  const bodies: string[] = []
  const captions: string[] = []
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const [a, b] = [parts[i], parts[j]]
      if (!own(a, b) && intersects(body(a), body(b))) bodies.push(`${a.uid} and ${b.uid}`)
      if (intersects(caption(a), caption(b))) captions.push(`${a.uid} caption and ${b.uid} caption`)
    }
  for (const a of parts) for (const b of parts) if (a !== b && !own(a, b) && intersects(caption(a), body(b))) captions.push(`${a.uid} caption and ${b.uid} body`)
  return { body: bodies, caption: captions }
}

export function readability(d: Diagram, routes: Routes, netOfWire: Map<string, string> = new Map()): ReadabilityReport {
  const parts = d.parts.filter((p) => moduleOf(d, p.module))
  const over = overlaps(d)

  const segs: { wire: number; h: boolean; at: number; lo: number; hi: number }[] = []
  let wireLength = 0
  const points: Pt[] = []
  ;[...routes.values()].forEach((r, wire) => {
    if (!r) return
    points.push(...r.points)
    for (let k = 1; k < r.points.length; k++) {
      const [a, b] = [r.points[k - 1], r.points[k]]
      wireLength += Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (a.y === b.y && a.x !== b.x) segs.push({ wire, h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
      else if (a.x === b.x && a.y !== b.y) segs.push({ wire, h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
    }
  })
  let wireCrossings = 0
  const hs = segs.filter((s) => s.h)
  const vs = segs.filter((s) => !s.h)
  for (const h of hs) for (const v of vs) if (h.wire !== v.wire && v.at > h.lo && v.at < h.hi && h.at > v.lo && h.at < v.hi) wireCrossings++

  const seated = seatedLabels(d)
  const rects: Rect[] = [
    ...parts.flatMap((p) => {
      const m = moduleOf(d, p.module)!
      return [bodyRect(p, layoutModule(m)), placedCaptionBox(p, m, seated.get(p.uid))]
    }),
    ...points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
  ]
  const all = rects.length ? rects.reduce(union) : { x: 0, y: 0, w: 0, h: 0 }
  const blockedNets = [...new Set(d.connections.filter((c) => routes.get(c.uid)?.blocked).map((c) => netOfWire.get(c.uid) ?? c.label ?? c.uid))].sort(naturalCompare)
  return { bodyOverlaps: over.body.length, captionOverlaps: over.caption.length, wireCrossings, wireLength: Math.round(wireLength), sheet: { w: Math.ceil(all.w), h: Math.ceil(all.h) }, blockedNets }
}

export function reportText(r: ReadabilityReport): string {
  return `Readability: body overlaps ${r.bodyOverlaps}, caption overlaps ${r.captionOverlaps}, wire crossings ${r.wireCrossings}, wire length ${r.wireLength} px, sheet ${r.sheet.w} x ${r.sheet.h} px, blocked nets ${r.blockedNets.length ? r.blockedNets.join(', ') : 'none'}${r.readabilityWarnings !== undefined ? `, readability warnings ${r.readabilityWarnings}` : ''}${r.labels ? `, labels ${r.labels.mode} (${r.labels.nets.length ? `nets ${r.labels.nets.join(', ')}` : 'no nets labelled'}${r.labels.unplaced.length ? `; no room for a label at some endpoints of ${r.labels.unplaced.join(', ')}, wired instead` : ''})` : ''}.`
}
