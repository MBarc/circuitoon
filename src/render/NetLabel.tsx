// A net label drawn in the Sticker style: a pointed tag with the net's name inside, flat fill in the
// net's role colour (ground black with a small ground mark, supply red, a signal blue, mains in the
// hazard orange with a bolt, an unnamed label white and dashed), the ink outline every part has. The
// pin sits at the tag's point; a short ink lead takes the wire. Drawn in the part's own frame, so it
// rotates like any part; the name is turned to stay upright.
import type { LabelLook } from '../format/mainsLook.ts'
import { FLAG_H, FLAG_MARK, FLAG_POINT, flagText, flagWidth } from '../format/netLabels.ts'
import { LEAD } from '../format/module.ts'
import type { Rotation } from '../format/geometry.ts'

/** The Sticker ink and the mains hazard orange (Part.tsx INK, Mains.tsx HAZARD), repeated so this file imports neither: Part.tsx imports it. */
const INK = '#23282F'
const HAZARD = '#F48C06'

/** Fill, text colour and outline style per look. */
export const LABEL_LOOKS: Record<LabelLook, { fill: string; text: string; dashed?: boolean }> = {
  ground: { fill: '#2B2F36', text: '#FFFFFF' },
  supply: { fill: '#E0483E', text: '#FFFFFF' },
  signal: { fill: '#3D6FD6', text: '#FFFFFF' },
  mains: { fill: HAZARD, text: INK },
  unnamed: { fill: '#FFFFFF', text: '#7A828C', dashed: true },
}

/** The tag's outline: point at (0, mid), slanted to the body, square end with rounded corners. */
export function flagPath(w: number, mid: number): string {
  const top = mid - FLAG_H / 2
  const bot = mid + FLAG_H / 2
  const r = 2
  return `M0 ${mid}L${FLAG_POINT} ${top}H${w - r}Q${w} ${top} ${w} ${top + r}V${bot - r}Q${w} ${bot} ${w - r} ${bot}H${FLAG_POINT}Z`
}

export function NetLabelFlag({ name, look, mid, rotation = 0, outline }: {
  name: string
  look: LabelLook
  /** The pin's y in the part frame (the middle of the body). */
  mid: number
  rotation?: Rotation
  /** Outline for the dark ground tag on dark paper (the theme's outline); the Sticker ink otherwise. */
  outline?: string
}) {
  const style = LABEL_LOOKS[look]
  const ground = look === 'ground'
  const mains = look === 'mains'
  const w = flagWidth(name, ground || mains)
  const text = flagText(name)
  // The content box, right of the point; turned half a turn when the part is, so text stays upright.
  const x0 = FLAG_POINT + 1.5
  const x1 = w - (ground || mains ? FLAG_MARK - 1 : 0)
  const tx = (x0 + x1) / 2
  const gx = w - 4.5
  // Each mark turns about its own centre, so it stays where it is (the name mid-tag, the mark at the square end).
  const flip = rotation === 90 || rotation === 180
  const turn = (x: number) => (flip ? `rotate(180 ${x} ${mid})` : undefined)
  const stroke = ground && outline ? outline : INK
  return (
    <g data-net-label={name}>
      <path d={`M${-LEAD} ${mid}H0`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <path d={flagPath(w, mid)} fill={style.fill} stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" strokeDasharray={style.dashed ? '2.4 1.8' : undefined} />
      <text x={tx} y={mid} transform={turn(tx)} textAnchor="middle" dominantBaseline="central" fontSize={7} fontWeight={800} fill={style.text} letterSpacing={0.15}>
        {text}
      </text>
      {ground && (
        // A small ground mark: a stem and three shrinking bars.
        <path transform={turn(gx)} d={`M${gx} ${mid - 3.2}V${mid - 0.6}M${gx - 2.8} ${mid - 0.6}H${gx + 2.8}M${gx - 1.8} ${mid + 1.2}H${gx + 1.8}M${gx - 0.8} ${mid + 3}H${gx + 0.8}`}
          stroke={style.text} strokeWidth={0.9} strokeLinecap="round" fill="none" />
      )}
      {mains && <path transform={turn(gx)} d={`M${gx + 0.8} ${mid - 3.8}l-2.5 4.1h1.8l-0.6 3.5 3-4.7h-1.8l1.2-2.9z`} fill={INK} />}
    </g>
  )
}
