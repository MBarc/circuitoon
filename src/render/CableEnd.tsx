// One end of a cable, drawn in the Sticker style at the wire's endpoint: a Dupont housing, an
// alligator clip, a JST plug. Drawn in a local frame whose +x runs from the endpoint back along
// the wire, so every connector is one set of shapes turned to the end segment's direction.
// Sizes follow the 10 px (0.1 inch) grid, nudged up where a true-scale part would be unreadable.
import { memo } from 'react'
import type { EndKind } from '../format/cables.ts'
import { INK, METAL } from './Part.tsx'

const DUPONT = '#30353C'
const GLINT = '#5C646E'
const NYLON = '#F6F3EA' // JST-XH and Grove housings
const PH_BEIGE = '#E7D9B6'
const TIN = '#E4E7EB'
const STRAND = '#8C939D'
const SHADE = '#9DA4AE'
const EDGE = 1.2

export interface CableEndProps {
  kind: EndKind
  x: number
  y: number
  /** Degrees the local frame turns: 0 when the wire runs off to the right of the endpoint. */
  angle: number
  /** Squash along the wire for a short end segment (see endPlacement). */
  scale: number
  /** The wire's drawn color, for boots, sleeves and collars. */
  color: string
  /** The wire's drawn width, for a tinned tip the same size as the wire. */
  width: number
}

export const CableEnd = memo(function CableEnd({ kind, x, y, angle, scale: s, color, width }: CableEndProps) {
  // A rounded rect from x0 to x1 along the wire, h across it, centered on the wire (or offset by dy).
  const box = (x0: number, x1: number, h: number, fill: string, rx: number, sw = EDGE, dy = 0) => (
    <rect x={x0 * s} y={dy - h / 2} width={(x1 - x0) * s} height={h} rx={Math.min(rx, ((x1 - x0) * s) / 2)} fill={fill} stroke={sw ? INK : 'none'} strokeWidth={sw} />
  )
  // A stroke line along the wire, from x0 to x1 at dy.
  const line = (x0: number, x1: number, dy: number, stroke: string, sw: number, opacity?: number) => (
    <path d={`M${x0 * s} ${dy}H${x1 * s}`} stroke={stroke} strokeWidth={sw} strokeOpacity={opacity} strokeLinecap="round" fill="none" />
  )
  // A line across the wire at x, h long.
  const rib = (at: number, h: number, opacity = 0.35) => (
    <path d={`M${at * s} ${-h / 2}V${h / 2}`} stroke={INK} strokeWidth={0.9} strokeOpacity={opacity} fill="none" />
  )
  let body: React.ReactNode = null
  switch (kind) {
    case 'dupont-male':
      body = (
        <>
          {box(0, 7, 1.9, METAL, 0.6, 1)}
          {box(5, 21, 7, DUPONT, 1.4)}
          {line(7, 19, -2, GLINT, 1.1)}
        </>
      )
      break
    case 'dupont-female':
      body = (
        <>
          {box(1, 17, 7, DUPONT, 1.4)}
          {line(4.5, 15, -2, GLINT, 1.1)}
          {/* The socket mouth, with its contact showing. */}
          {box(1.6, 3.8, 3, METAL, 0.5, 0.9)}
        </>
      )
      break
    case 'solid-jumper':
      body = (
        <>
          {box(0, 8.4, 1.9, METAL, 0.6, 1)}
          {/* Where the leg bends down into the hole. */}
          {box(0, 2, 2.6, SHADE, 0.8, 1)}
        </>
      )
      break
    case 'stripped': {
      // Tinned strands: a bright tip with the twist showing as short diagonal lines.
      const w = Math.max(2, width * 0.8)
      const twist = [1.4, 2.9, 4.4, 5.9].map((at) => `M${at * s} ${w / 2 - 0.3}L${(at + 0.9) * s} ${-w / 2 + 0.3}`).join('')
      body = (
        <>
          {box(0, 6.8, w, TIN, w / 2, 0.9)}
          <path d={twist} stroke={STRAND} strokeWidth={0.6} fill="none" />
        </>
      )
      break
    }
    case 'ferrule':
      body = (
        <>
          {box(0, 8, 2.8, METAL, 0.8, 1)}
          {line(1.5, 6.5, 0, SHADE, 0.6)}
          <path
            d={`M${6.5 * s} -2.3L${9 * s} -3.1H${14 * s}V3.1H${9 * s}L${6.5 * s} 2.3Z`}
            fill={color} stroke={INK} strokeWidth={EDGE} strokeLinejoin="round"
          />
        </>
      )
      break
    case 'alligator': {
      // Two long jaws seen from above, their teeth meshing down the middle, then the spring
      // hinge and the rubber boot.
      const teeth = Array.from({ length: 5 }, (_, i) => `L${(1.6 + i * 1.9 + 0.95) * s} ${i % 2 ? 0.9 : -0.9}L${(1.6 + (i + 1) * 1.9) * s} 0`).join('')
      body = (
        <>
          <path
            d={`M${0.6 * s} -2.1H${12 * s}V2.1H${0.6 * s}Q0 2.1 0 1.2V-1.2Q0 -2.1 ${0.6 * s} -2.1Z`}
            fill={METAL} stroke={INK} strokeWidth={1.1} strokeLinejoin="round"
          />
          <path d={`M${1.6 * s} 0${teeth}`} stroke={INK} strokeWidth={0.7} fill="none" strokeLinejoin="round" />
          {box(10.5, 14.5, 6.4, METAL, 1, 1)}
          {box(13.5, 29, 9, color, 2.4)}
          {rib(17.5, 6.4)}
          {rib(20.5, 6.4)}
          {rib(23.5, 6.4)}
        </>
      )
      break
    }
    case 'banana':
      body = (
        <>
          {box(0, 10, 3.4, METAL, 1.5, 1)}
          {/* The sprung lamella bulge. */}
          {box(2.2, 7.2, 4.6, METAL, 2.2, 1)}
          {line(2.8, 6.6, 0, SHADE, 0.6)}
          {box(9, 28, 6.6, color, 2.2)}
          {box(9, 12, 8.4, color, 1.4)}
          {rib(17, 4.4)}
          {rib(20, 4.4)}
          {rib(23, 4.4)}
        </>
      )
      break
    case 'jst-xh':
      body = (
        <>
          {box(1, 13, 9, NYLON, 1.4)}
          {/* The locking ramp on top, and the contact window at the front. */}
          {box(4.5, 9, 2, NYLON, 0.6, 1, -5.3)}
          {box(1.6, 3.6, 2.6, SHADE, 0.5, 0.8)}
        </>
      )
      break
    case 'jst-ph':
      body = (
        <>
          {box(1, 11, 7.5, PH_BEIGE, 1.2)}
          {box(3.8, 7.6, 1.8, PH_BEIGE, 0.5, 1, -4.5)}
          {box(1.6, 3.2, 2.2, SHADE, 0.4, 0.8)}
        </>
      )
      break
    case 'jst-sh':
      body = (
        <>
          {box(1, 8.5, 6, DUPONT, 1)}
          {line(2.8, 7, -1.5, GLINT, 0.9)}
          {box(1.5, 2.9, 1.8, METAL, 0.3, 0.7)}
        </>
      )
      break
    case 'grove':
      body = (
        <>
          {box(1, 14, 10.5, NYLON, 1.6)}
          {/* The long latch lever along one side, hooked at the front. */}
          {box(2.8, 12.5, 2.2, NYLON, 0.8, 1, -6.4)}
          {box(2.8, 4.6, 3.6, NYLON, 0.6, 1, -5.9)}
          {box(1.6, 3.8, 3, SHADE, 0.5, 0.8)}
        </>
      )
      break
    case 'bare':
      return null
  }
  return (
    <g data-cable-end={kind} data-squashed={s < 1 || undefined} transform={`translate(${x} ${y}) rotate(${angle})`}>
      {body}
    </g>
  )
})
