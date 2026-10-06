// Probes on the sheet (spec 6.2): each probe is a coloured lead from its pin, hole or part to a
// reading tag. Tags are placed by the existing label placement (ruling R8: LabelPlacer with the
// net-label module, the tag text as the flag name), so they keep off parts, captions and each
// other. A tag shows typical, with peak when it differs; "floating", "undefined" or "-" (Simulate
// off) in words; a reading outside the model says so (and its tag is dashed). Colours come from a
// fixed order of eight, each at least 3:1 on the sheet paper in both themes (light in both).
// Stale readings (the last good result while a solve fails) are dimmed and say so, as in SimLayer.
// Imports from src/sim are types only: the readings come computed in the result (SimResult.probes).
import { memo } from 'react'
import { type Diagram, type Probe, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { FLAG_MAX_CHARS, flagRect, flagText } from '../format/netLabels.ts'
import { formatValue } from '../format/values.ts'
import { LabelPlacer, edgeExits } from '../agent/labelling.ts'
import { modulesById } from '../library.ts'
import type { PartRun, ProbeReading, Reading } from '../sim/results.ts'

export const PROBE_COLORS = ['#C2185B', '#1565C0', '#2E7D32', '#6A1B9A', '#B34700', '#00695C', '#5D4037', '#283593'] as const
const sig = (x: number) => Number(x.toPrecision(3))

function one(r: Reading): string {
  return r.kind === 'value' ? formatValue(sig(r.value), 'V') : r.kind
}
const outside = (...rs: Reading[]) => rs.some((r) => r.kind === 'value' && r.trust === 'outside-model')
export function readingText(r: { typical: Reading; peak: Reading } | undefined): string {
  if (!r) return '-'
  const t = one(r.typical)
  const p = one(r.peak)
  return `${t}${p !== t ? ` (peak ${p})` : ''}${outside(r.typical, r.peak) ? ' (outside the model)' : ''}`
}
export function partText(p: { typical: PartRun; peak: PartRun } | undefined): string {
  if (!p) return '-'
  const amps = Math.max(0, ...Object.values(p.typical.pins).map((x) => (x.kind === 'value' ? Math.abs(x.value) : 0)))
  const power = p.typical.power.kind === 'value' ? `, ${formatValue(sig(Math.abs(p.typical.power.value)), 'W')}` : ''
  return Object.keys(p.typical.pins).length ? `${formatValue(sig(amps), 'A')}${power}` : p.typical.power.kind === 'undefined' ? 'undefined' : 'floating'
}

/** Where each probe's tag goes: LabelPlacer spots, taken one by one so later tags keep off earlier ones. The lead runs from, exit, elbow, tip. */
export function placeTags(d: Diagram, items: { id: string; text: string }[]): { id: string; from: Pt; exit: Pt; elbow: Pt; tip: Pt; box: Rect }[] {
  const label = moduleOf(d, 'net-label') ?? modulesById['net-label']
  if (!label) return []
  const placer = new LabelPlacer(d, label)
  const out: { id: string; from: Pt; exit: Pt; elbow: Pt; tip: Pt; box: Rect }[] = []
  for (const it of items) {
    const p = (d.probes ?? []).find((x) => x.id === it.id)
    const anchor = p && anchorOf(d, p)
    if (!anchor) continue
    let placed = false
    for (const e of anchor.exits) {
      const spot = placer.spot(it.text, anchor.at, e.dir, { base: e.base, own: anchor.own })
      if (!spot) continue
      placer.commit(spot, anchor.at)
      out.push({ id: it.id, from: anchor.at, exit: spot.base, elbow: spot.elbow, tip: spot.tip, box: flagRect(spot.part, label, true) })
      placed = true
      break
    }
    // ponytail: no clear spot on a crowded sheet; the tag still shows above and right of its point, maybe over something.
    if (!placed) {
      const box = { x: anchor.at.x + 10, y: anchor.at.y - 24, w: 4.6 * flagText(it.text).length + 12, h: 10 }
      out.push({ id: it.id, from: anchor.at, exit: anchor.at, elbow: { x: box.x, y: box.y + 5 }, tip: { x: box.x, y: box.y + 5 }, box })
    }
  }
  return out
}

const ASIDE: Pt[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]

/**
 * A probe's point and the ways its lead may leave: a pin straight out along its stub (else aside, else back); a hole (or a
 * pin plugged into a board) out past each edge of that board, nearest first; a part from the
 * middle of its body out past each edge. `own` is the body the lead may cross on its way out.
 */
function anchorOf(d: Diagram, p: Probe): { at: Pt; exits: { dir: Pt; base: Pt }[]; own: string } | null {
  const part = d.parts.find((x) => x.uid === p.at.part)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return null
  const body = bodyRect(part, layoutModule(m))
  if (p.at.pin === undefined) {
    const at = { x: body.x + body.w / 2, y: body.y + body.h / 2 }
    return { at, exits: edgeExits(body, at), own: part.uid }
  }
  const r = resolveEndpoint(d, { part: p.at.part, pin: p.at.pin })
  if (!r) return null
  // Straight out first; then aside (left, right) or back, where a crowded side leaves no room.
  const out = r.dir
  if (out) return { at: r.end, exits: [out, ...ASIDE.filter((d) => d.x !== out.x || d.y !== out.y)].map((dir) => ({ dir, base: r.end })), own: part.uid }
  // A hole of this part, or a plugged pin's hole on the board it sits in.
  const board = part.mount ? d.parts.find((x) => x.uid === part.mount!.board) : part
  const bm = board && moduleOf(d, board.module)
  if (!board || !bm) return null
  return { at: r.end, exits: edgeExits(bodyRect(board, layoutModule(bm)), r.end), own: board.uid }
}

/** The tag's words: a long name is cut so the reading shows whole (a flag shows FLAG_MAX_CHARS), unless the reading alone is too long. */
function tagText(name: string, reading: string): string {
  const room = FLAG_MAX_CHARS - reading.length - 1
  return `${name.length > room && room >= 4 ? `${name.slice(0, room - 1)}…` : name} ${reading}`
}

/** The colour of probe `id` ("P3" is the third): stable when another probe is removed. */
export function probeColor(id: string, index: number): string {
  const n = Number(id.slice(1))
  return PROBE_COLORS[((Number.isInteger(n) && n > 0 ? n - 1 : index) % PROBE_COLORS.length)]
}

export const ProbeLayer = memo(function ProbeLayer({ diagram, readings, stale = false }: { diagram: Diagram; readings: ProbeReading[] | null; stale?: boolean }) {
  const probes = diagram.probes ?? []
  const texts = probes.map((p) => {
    const r = readings?.find((x) => x.id === p.id)
    const reading = p.at.pin === undefined ? partText(r?.part) : readingText(r?.voltage)
    const name = p.name ?? p.id
    const off = !!r?.voltage && outside(r.voltage.typical, r.voltage.peak)
    return { id: p.id, full: `${name}: ${reading}`, text: tagText(name, reading), off }
  })
  const tags = placeTags(diagram, texts)
  const staleWord = stale ? ' (stale, from before your last edit)' : ''
  return (
    <g className={stale ? 'probe-layer stale' : 'probe-layer'} data-probe-stale={stale || undefined} pointerEvents="none">
      {tags.map((t) => {
        const i = probes.findIndex((p) => p.id === t.id)
        const colour = probeColor(t.id, i)
        const x = texts[i]
        // Square from the point to the exit: across, then out along the lead's direction.
        const corner = t.exit.x === t.elbow.x ? { x: t.exit.x, y: t.from.y } : { x: t.from.x, y: t.exit.y }
        return (
          <g key={t.id} className={x.off ? 'probe-tag outside' : 'probe-tag'} data-probe={t.id}>
            <title>{`Probe ${x.full}${staleWord}`}</title>
            <polyline points={`${t.from.x},${t.from.y} ${corner.x},${corner.y} ${t.exit.x},${t.exit.y} ${t.elbow.x},${t.elbow.y} ${t.tip.x},${t.tip.y}`} fill="none" stroke={colour} strokeWidth={1.6} strokeDasharray="3 2" />
            <circle cx={t.from.x} cy={t.from.y} r={3} fill={colour} stroke="#FFFFFF" strokeWidth={1} />
            <rect className="probe-box" x={t.box.x} y={t.box.y} width={t.box.w} height={t.box.h} rx={3} stroke={colour} />
            {/* A tag going up or down from its point stands on end, read bottom to top, as a net label does. */}
            <g transform={t.box.h > t.box.w ? `rotate(-90 ${t.box.x} ${t.box.y + t.box.h})` : undefined}>
              <rect x={t.box.x} y={t.box.y + (t.box.h > t.box.w ? t.box.h : 0)} width={4} height={Math.min(t.box.w, t.box.h)} rx={1.5} fill={colour} />
              <text x={t.box.x + 7} y={t.box.y + (t.box.h > t.box.w ? t.box.h : 0) + Math.min(t.box.w, t.box.h) / 2} dominantBaseline="central" className="probe-text">{flagText(x.text)}</text>
            </g>
          </g>
        )
      })}
    </g>
  )
})
