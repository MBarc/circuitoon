// Probes on the sheet (spec 6.2): each probe is a coloured lead from its pin, hole or part to a
// reading tag. Tags are placed by the existing label placement (ruling R8: LabelPlacer with the
// net-label module, keeping a box of the tag's size clear), so they keep off parts, captions and
// each other, level first. A tag shows typical, with peak when it differs; "floating", the reason
// a node has no voltage in plain words ("not simulated (mains)", never "undefined") or "-"
// (Simulate off); a reading outside the model says so (and its tag is dashed). Every tag reserves the room of a long reading, so turning Simulate on or off never moves
// it. Colours come from a fixed order of eight, each at least 3:1 on the sheet paper in both themes
// (light in both). Stale readings (the last good result while a solve fails) are dimmed and say so,
// as in SimLayer. Imports from src/sim are types only: the readings come in the result (SimResult.probes).
import { memo } from 'react'
import { type Diagram, type Probe, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { type Pt, type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { formatValue } from '../format/values.ts'
import { LabelPlacer, edgeExits } from '../agent/labelling.ts'
import { modulesById } from '../library.ts'
import type { PartRun, ProbeReading, Reading } from '../sim/results.ts'

export const PROBE_COLORS = ['#C2185B', '#1565C0', '#2E7D32', '#6A1B9A', '#B34700', '#00695C', '#5D4037', '#283593'] as const
const sig = (x: number) => Number(x.toPrecision(3))

/** Tag metrics (editor.css .probe-text, 9 px bold): a character's width, a little generous, and the tag's height. */
export const TAG_CHAR_W = 5.6
export const TAG_H = 13
/** The colour bar and the padding around the words. */
const TAG_PAD = 13
export const tagWidth = (text: string) => Math.ceil(TAG_PAD + text.length * TAG_CHAR_W)
/** The reading every tag reserves room for, so a tag keeps its place whatever it reads. */
export const TAG_RESERVE = '-00.00 V (peak -00.00 V)'
/** Longest probe name a tag shows whole (a name may be 40 characters); the title has it all. */
const NAME_CHARS = 16

function one(r: Reading): string {
  return r.kind === 'value' ? formatValue(sig(r.value), 'V') : r.kind === 'undefined' ? r.why : r.kind
}
const outside = (...rs: Reading[]) => rs.some((r) => r.kind === 'value' && r.trust === 'outside-model')
export function readingText(r: { typical: Reading; peak: Reading } | undefined): string {
  if (!r) return '-'
  const t = one(r.typical)
  const p = one(r.peak)
  return `${t}${p !== t ? ` (peak ${p})` : ''}${outside(r.typical, r.peak) ? ', outside model' : ''}`
}
export function partText(p: { typical: PartRun; peak: PartRun } | undefined): string {
  if (!p) return '-'
  const amps = Math.max(0, ...Object.values(p.typical.pins).map((x) => (x.kind === 'value' ? Math.abs(x.value) : 0)))
  const power = p.typical.power.kind === 'value' ? `, ${formatValue(sig(Math.abs(p.typical.power.value)), 'W')}` : ''
  return Object.keys(p.typical.pins).length ? `${formatValue(sig(amps), 'A')}${power}` : p.typical.power.kind === 'undefined' ? p.typical.power.why : 'floating'
}
/** The tag's words: the probe's name (a long one cut) and its whole reading. */
export function tagText(name: string, reading: string): string {
  return `${name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name} ${reading}`
}

type Tag = { id: string; from: Pt; exit: Pt; elbow: Pt; tip: Pt; box: Rect; vertical: boolean }

/**
 * Where each probe's tag goes: LabelPlacer spots, taken one by one so later tags keep off earlier
 * ones. Each keeps clear the room of `reserve` (its text when longer); `box` is the tag drawn for
 * `text`, inside that room at the lead's end. The lead runs from, exit, elbow, tip.
 */
export function placeTags(d: Diagram, items: { id: string; text: string; reserve?: string }[]): Tag[] {
  const label = moduleOf(d, 'net-label') ?? modulesById['net-label']
  if (!label) return []
  const placer = new LabelPlacer(d, label)
  const out: Tag[] = []
  for (const it of items) {
    const p = (d.probes ?? []).find((x) => x.id === it.id)
    const anchor = p && anchorOf(d, p)
    if (!anchor) continue
    const w = tagWidth(it.text)
    const size = { w: Math.max(w, tagWidth(it.reserve ?? '')), h: TAG_H }
    let placed = false
    for (const e of anchor.exits) {
      // Past a board's top or bottom edge, the tag sets off level from a point just outside it.
      const spot = e.via ? placer.spot(it.text, e.via, e.dir, { own: anchor.own, size }) : placer.spot(it.text, anchor.at, e.dir, { base: e.base, own: anchor.own, size })
      if (!spot?.flag) continue
      placer.commit(spot, anchor.at)
      const f = spot.flag
      const vertical = e.dir.y !== 0
      // The drawn tag starts at the end of the room its lead reaches.
      const box = vertical
        ? { ...f, y: Math.abs(spot.tip.y - f.y) <= Math.abs(spot.tip.y - f.y - f.h) ? f.y : f.y + f.h - w, h: w }
        : { ...f, x: Math.abs(spot.tip.x - f.x) <= Math.abs(spot.tip.x - f.x - f.w) ? f.x : f.x + f.w - w, w }
      out.push({ id: it.id, from: anchor.at, exit: spot.base, elbow: spot.elbow, tip: spot.tip, box, vertical })
      placed = true
      break
    }
    // ponytail: no clear spot on a crowded sheet; the tag still shows above and right of its point, maybe over something.
    if (!placed) {
      const box = { x: anchor.at.x + 10, y: anchor.at.y - 24, w, h: TAG_H }
      const tip = { x: box.x, y: box.y + TAG_H / 2 }
      out.push({ id: it.id, from: anchor.at, exit: anchor.at, elbow: tip, tip, box, vertical: false })
    }
  }
  return out
}

const ASIDE: Pt[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]

/** How far outside a board's edge a hole probe's lead turns level, in px. */
const BOARD_CLEAR = 12
/** Level first: a tag reads best level, so it stands on end only where no level spot fits. */
const level = (e: { dir: Pt }) => (e.dir.y !== 0 ? 1 : 0)

/**
 * A probe's point and the ways its lead may leave, level ones first: a pin straight out along its
 * stub, else aside, else back; a hole (or a pin plugged into a board) out past the nearest edge of
 * that board, then level; a part from the middle of its body out past each edge. `own` is the body
 * the lead may cross on its way out.
 */
function anchorOf(d: Diagram, p: Probe): { at: Pt; exits: { dir: Pt; base: Pt; via?: Pt }[]; own: string } | null {
  const part = d.parts.find((x) => x.uid === p.at.part)
  const m = part && moduleOf(d, part.module)
  if (!part || !m) return null
  const body = bodyRect(part, layoutModule(m))
  if (p.at.pin === undefined) {
    const at = { x: body.x + body.w / 2, y: body.y + body.h / 2 }
    return { at, exits: edgeExits(body, at).sort((a, b) => level(a) - level(b)), own: part.uid }
  }
  const r = resolveEndpoint(d, { part: p.at.part, pin: p.at.pin, ...(p.at.hole !== undefined ? { hole: p.at.hole } : {}) })
  if (!r) return null
  const out = r.dir
  if (out) {
    const ways = [out, ...ASIDE.filter((d) => (d.x !== out.x || d.y !== out.y) && (d.x !== -out.x || d.y !== -out.y)), { x: -out.x, y: -out.y }]
    return { at: r.end, exits: ways.map((dir) => ({ dir, base: r.end })).sort((a, b) => level(a) - level(b)), own: part.uid }
  }
  // A hole of this part, or a plugged pin's hole on the board it sits in.
  const board = part.mount ? d.parts.find((x) => x.uid === part.mount!.board) : part
  const bm = board && moduleOf(d, board.module)
  if (!board || !bm) return null
  // Nearest edge first: past a top or bottom edge the lead turns level just outside the board (so
  // it never runs along a row of holes to a far side edge); standing on end comes last.
  const edges = edgeExits(bodyRect(board, layoutModule(bm)), r.end)
  const levelOut = edges.flatMap((e) => {
    if (!e.dir.y) return [e]
    const via = { x: e.base.x, y: e.base.y + e.dir.y * BOARD_CLEAR }
    return [{ dir: { x: 1, y: 0 }, base: e.base, via }, { dir: { x: -1, y: 0 }, base: e.base, via }]
  })
  return { at: r.end, exits: [...levelOut, ...edges.filter((e) => e.dir.y)], own: board.uid }
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
    return { id: p.id, full: `${name}: ${reading}`, text: tagText(name, reading), reserve: tagText(name, TAG_RESERVE), off }
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
            <g transform={t.vertical ? `rotate(-90 ${t.box.x} ${t.box.y + t.box.h})` : undefined}>
              <rect x={t.box.x} y={t.box.y + (t.vertical ? t.box.h : 0)} width={4} height={TAG_H} rx={1.5} fill={colour} />
              <text x={t.box.x + 8} y={t.box.y + (t.vertical ? t.box.h : 0) + TAG_H / 2} dominantBaseline="central" className="probe-text">{x.text}</text>
            </g>
          </g>
        )
      })}
    </g>
  )
})
