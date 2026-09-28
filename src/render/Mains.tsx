// The mains look on a sheet (spec 5): a thin hazard outline under an energized wire, a small lightning
// marker near each of its ends, and the second colour of a two-colour wire.
import type { Pt } from '../format/geometry.ts'
import { INK } from './Part.tsx'

export const HAZARD = '#F48C06'

/** Drawn under the wire's ink outline, so it shows as a thin orange rim. */
export function HazardOutline({ d, width }: { d: string; width: number }) {
  return <path className="wire-hazard" d={d} stroke={HAZARD} strokeWidth={width + 5.2} />
}

/** The stripe of a two-colour wire (green-yellow earth), over its base colour. */
export function Stripe({ d, width, color }: { d: string; width: number; color: string }) {
  return <path d={d} stroke={color} strokeWidth={width} strokeDasharray="7 7" />
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

/** A small lightning marker 16 px in from each end of an energized wire. */
export function Bolts({ points }: { points: Pt[] }) {
  const at = [along(points, 16), along([...points].reverse(), 16)].filter((p): p is Pt => p !== null)
  return (
    <g data-bolt="" pointerEvents="none">
      {at.map((p, i) => (
        <path key={i} d={`M${p.x + 1} ${p.y - 7}l-4 7h3l-1 6 5-8h-3l2-5z`} fill={HAZARD} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      ))}
    </g>
  )
}
