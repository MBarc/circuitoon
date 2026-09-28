// The mains look on a sheet (spec 5): a thin hazard outline under an energized wire, a small lightning
// marker near each of its ends, and the second colour of a two-colour wire.
import type { Pt } from '../format/geometry.ts'
import { INK } from './Part.tsx'
import { END_SIZE } from '../format/cables.ts'

export const HAZARD = '#F48C06'

/** Drawn under the wire's ink outline, so it shows as a thin orange rim. */
export function HazardOutline({ d, width }: { d: string; width: number }) {
  return <path className="wire-hazard" d={d} stroke={HAZARD} strokeWidth={width + 5.2} />
}

/** The dash of a blocked wire (a route that runs through a part): 6 px drawn, 5 px gap. */
export const BLOCKED_DASH = '6 5'

/**
 * The stripe of a two-colour wire (green-yellow earth), over its base colour. On a blocked wire it
 * keeps the blocked dash's 11 px period and covers only the first half of each dash, so the gaps
 * still read as blocked and the wire still reads as two-colour.
 */
export function Stripe({ d, width, color, blocked = false }: { d: string; width: number; color: string; blocked?: boolean }) {
  return <path d={d} stroke={color} strokeWidth={width} strokeDasharray={blocked ? '3 8' : '7 7'} />
}

/** The point `dist` px along a polyline from its first point, or null when it is shorter. */
export function along(points: Pt[], dist: number): Pt | null {
  let left = dist
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (len >= left) {
      const t = len ? left / len : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= len
  }
  return null
}

/**
 * A small lightning marker near each end of an energized wire: `insets` px in from each end (16, plus
 * the end connector's reach, so a bolt never sits on a connector). A wire too short for two gets one,
 * at its middle.
 */
export function Bolts({ points, insets = [16, 16] }: { points: Pt[]; insets?: [number, number] }) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
  const at = (total < insets[0] + insets[1] + 24 ? [along(points, total / 2)] : [along(points, insets[0]), along([...points].reverse(), insets[1])])
    .filter((p): p is Pt => p !== null)
  return (
    <g data-bolt="" pointerEvents="none">
      {at.map((p, i) => (
        <path key={i} d={`M${p.x + 1} ${p.y - 7}l-4 7h3l-1 6 5-8h-3l2-5z`} fill={HAZARD} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      ))}
    </g>
  )
}

/** The bolt insets of a wire whose ends may carry connectors (wirePaths' `cables`). */
export function boltInsets(cables: readonly ({ kind: keyof typeof END_SIZE; scale: number } | null)[]): [number, number] {
  const one = (c: { kind: keyof typeof END_SIZE; scale: number } | null) => 16 + (c ? END_SIZE[c.kind].reach * c.scale : 0)
  return [one(cables[0] ?? null), one(cables[1] ?? null)]
}

export const MAINS_NOTICE_FONT = 9
const LINE = 12
/** Conservative width of one bold glyph, in em: a line measured with it never overruns its band. */
const GLYPH = 0.62

/** Resolution 29: the notice band is never narrower than this; a narrower sheet widens its viewBox for the footer. */
export const NOTICE_MIN_WIDTH = 320

/** Greedy word wrap of `text` into lines no wider than `width` px at `fontSize`; a word longer than a line is split, each piece but the last ending in a hyphen. */
export function noticeLines(text: string, width: number, fontSize = MAINS_NOTICE_FONT): string[] {
  const max = Math.max(2, Math.floor(width / (GLYPH * fontSize)))
  const words = text.split(' ').flatMap((wd) => {
    if (wd.length <= max) return [wd]
    const pieces: string[] = []
    for (let k = 0; k < wd.length; k += max - 1) pieces.push(k + max - 1 < wd.length ? `${wd.slice(k, k + max - 1)}-` : wd.slice(k))
    return pieces
  })
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= max || !cur) cur = next
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** The footer band a notice of `lines` lines needs, in px. */
export const noticeHeight = (lines: number) => lines * LINE + 20

/** The mains notice in the footer band the sheet reserves below `box` (spec 6: every export shows it, whole). */
export function MainsNotice({ box, text }: { box: { x: number; y: number; w: number; h: number }; text: string }) {
  const band = Math.max(box.w, NOTICE_MIN_WIDTH)
  const lines = noticeLines(text, band - 32)
  const top = box.y + box.h
  return (
    <g data-mains-notice="" pointerEvents="none">
      <rect x={box.x + 8} y={top + 4} width={band - 16} height={noticeHeight(lines.length) - 8} rx={4} fill="#FFF4E5" stroke={HAZARD} strokeWidth={1.2} />
      {lines.map((l, i) => (
        <text key={i} x={box.x + 16} y={top + 18 + i * LINE} fontSize={MAINS_NOTICE_FONT} fontWeight={700} fill={INK}>{l}</text>
      ))}
    </g>
  )
}
