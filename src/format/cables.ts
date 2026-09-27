// Cable ends: what each end of a wire physically is (a Dupont pin, an alligator clip, a JST plug),
// so a hobbyist can see which lead to reach for. A wire with no `ends` is a plain wire.
import type { Pt } from './geometry.ts'

export const END_KINDS = [
  'bare',
  'dupont-male',
  'dupont-female',
  'solid-jumper',
  'alligator',
  'stripped',
  'ferrule',
  'jst-xh',
  'jst-ph',
  'jst-sh',
  'grove',
  'banana',
] as const
export type EndKind = (typeof END_KINDS)[number]

/** A connection's two ends; a missing end is bare. */
export interface WireEnds {
  from?: EndKind
  to?: EndKind
}

export function isEndKind(v: unknown): v is EndKind {
  return typeof v === 'string' && (END_KINDS as readonly string[]).includes(v)
}

/** Names for the per-end selects. */
export const END_NAMES: Record<EndKind, string> = {
  bare: 'Bare wire',
  'dupont-male': 'Dupont male',
  'dupont-female': 'Dupont female',
  'solid-jumper': 'Solid-core leg',
  alligator: 'Alligator clip',
  stripped: 'Stripped, tinned',
  ferrule: 'Ferrule',
  'jst-xh': 'JST-XH plug',
  'jst-ph': 'JST-PH plug',
  'jst-sh': 'JST-SH (Qwiic)',
  grove: 'Grove plug',
  banana: 'Banana plug',
}

/** A named pair of ends, as sold. Presets exist only in the editor; the file stores the ends. */
export interface CablePreset {
  id: string
  name: string
  from: EndKind
  to: EndKind
}

const preset = (id: string, name: string, from: EndKind, to: EndKind = from): CablePreset => ({ id, name, from, to })

export const CABLE_PRESETS: CablePreset[] = [
  preset('wire', 'Wire', 'bare'),
  preset('dupont-mm', 'Dupont M-M', 'dupont-male'),
  preset('dupont-mf', 'Dupont M-F', 'dupont-male', 'dupont-female'),
  preset('dupont-ff', 'Dupont F-F', 'dupont-female'),
  preset('solid-jumper', 'Solid-core jumper', 'solid-jumper'),
  preset('alligator', 'Alligator leads', 'alligator'),
  preset('alligator-dupont', 'Alligator to Dupont M', 'alligator', 'dupont-male'),
  preset('stripped', 'Stripped hookup wire', 'stripped'),
  preset('ferrules', 'Ferrules', 'ferrule'),
  preset('jst-xh', 'JST-XH lead', 'jst-xh'),
  preset('jst-ph', 'JST-PH lead', 'jst-ph'),
  preset('qwiic', 'Qwiic / STEMMA QT', 'jst-sh'),
  preset('grove', 'Grove', 'grove'),
  preset('banana', 'Banana leads', 'banana'),
]

export function endKind(ends: WireEnds | undefined, which: 'from' | 'to'): EndKind {
  return ends?.[which] ?? 'bare'
}

/** The ends as stored: bare ends left out, and undefined when both are bare. */
export function normalizeEnds(ends: WireEnds | undefined): WireEnds | undefined {
  const out: WireEnds = {}
  if (ends?.from && ends.from !== 'bare') out.from = ends.from
  if (ends?.to && ends.to !== 'bare') out.to = ends.to
  return out.from || out.to ? out : undefined
}

/** The preset these ends match, either way round, or null when they match none (Custom). */
export function presetOf(ends: WireEnds | undefined): CablePreset | null {
  const a = endKind(ends, 'from')
  const b = endKind(ends, 'to')
  return CABLE_PRESETS.find((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a)) ?? null
}

/** A preset's ends, normalized (undefined for Wire or an unknown id). */
export function presetEnds(id: string): WireEnds | undefined {
  const p = CABLE_PRESETS.find((q) => q.id === id)
  return p ? normalizeEnds({ from: p.from, to: p.to }) : undefined
}

/**
 * What one Cable select shows for several wires: their preset when they share one, 'custom' when
 * they share one pair that matches no preset (either way round), else 'mixed'.
 */
export function sharedCable(list: (WireEnds | undefined)[]): string {
  const keys = new Set(
    list.map((ends) => presetOf(ends)?.id ?? `custom:${[endKind(ends, 'from'), endKind(ends, 'to')].sort().join('+')}`),
  )
  if (keys.size !== 1) return 'mixed'
  const [key] = keys
  return key.startsWith('custom:') ? 'custom' : key
}

export function swapEnds(ends: WireEnds | undefined): WireEnds | undefined {
  return normalizeEnds({ from: ends?.to, to: ends?.from })
}

/**
 * How much of the wire each end's connector takes, in px back from the endpoint at full size:
 * `reach` is the connector's whole length, and `trim` is where the drawn wire stops, so the wire
 * runs into a housing's back or up to a bare metal end. An `exposed` end (a bare leg, a tinned
 * tip) shows the wire's own insulation ending there, so the wire is cut back a further half its
 * drawn width to keep its round cap off the metal.
 */
export const END_SIZE: Record<EndKind, { reach: number; trim: number; exposed: boolean }> = {
  bare: { reach: 0, trim: 0, exposed: false },
  'dupont-male': { reach: 21, trim: 15, exposed: false },
  'dupont-female': { reach: 17, trim: 12, exposed: false },
  'solid-jumper': { reach: 8, trim: 8, exposed: true },
  alligator: { reach: 29, trim: 24, exposed: false },
  stripped: { reach: 6, trim: 6, exposed: true },
  ferrule: { reach: 14, trim: 11, exposed: false },
  'jst-xh': { reach: 13, trim: 9, exposed: false },
  'jst-ph': { reach: 11, trim: 7, exposed: false },
  'jst-sh': { reach: 8, trim: 5, exposed: false },
  grove: { reach: 14, trim: 10, exposed: false },
  banana: { reach: 28, trim: 22, exposed: false },
}

/** Smallest a connector is squashed to on a short end segment; below that it overhangs the corner. */
export const MIN_END_SCALE = 0.6

/** One end's connector as drawn: its kind and where it sits (see endPlacement). */
export interface CableEndDraw {
  kind: EndKind
  at: Pt
  back: Pt
  angle: number
  scale: number
}

/**
 * Where one end's connector sits on a drawn wire: at the endpoint, facing `back` along the segment
 * the end sits on (a unit vector pointing away from the endpoint, into the wire), turned `angle`
 * degrees from +x. `scale` squashes a connector of length `reach` along the wire when that segment
 * is shorter (a single straight segment is shared, half each end), down to MIN_END_SCALE; `room` is
that length, the most the drawn wire may be cut back at this end. Null
 * when the polyline has no length at that end or the end segment is not horizontal or vertical.
 */
export function endPlacement(points: Pt[], which: 'from' | 'to', reach: number): { at: Pt; back: Pt; angle: number; scale: number; room: number } | null {
  const pts = which === 'from' ? points : [...points].reverse()
  if (pts.length < 2) return null
  const at = pts[0]
  let i = 1
  while (i < pts.length && pts[i].x === at.x && pts[i].y === at.y) i++
  if (i === pts.length) return null
  const next = pts[i]
  if (next.x !== at.x && next.y !== at.y) return null
  const dx = Math.sign(next.x - at.x)
  const dy = Math.sign(next.y - at.y)
  const len = Math.abs(next.x - at.x) + Math.abs(next.y - at.y)
  // Only this segment and the far end: a straight wire's other connector sits on it too.
  const single = pts.slice(i + 1).every((p) => (dx !== 0 ? p.y === at.y : p.x === at.x))
  const room = single ? len / 2 : len
  const scale = reach > 0 ? Math.min(1, Math.max(MIN_END_SCALE, room / reach)) : 1
  const angle = dx === 1 ? 0 : dy === 1 ? 90 : dx === -1 ? 180 : 270
  return { at: { x: at.x, y: at.y }, back: { x: dx + 0, y: dy + 0 }, angle, scale, room }
}
