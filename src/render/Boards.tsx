// Breadboard overlays drawn from the diagram: taken holes darken slightly, and every plugged leg
// gets a metal dot on its hole center. Neither takes pointer events, so holes and parts below
// stay clickable.
import type { Plug } from '../format/breadboard.ts'
import { INK, METAL } from './Part.tsx'

const TAKEN = '#15181C'

/** Darkens every hole a mounted leg sits in; drawn above the boards and below the parts. */
export function TakenHoles({ plugs }: { plugs: Plug[] }) {
  if (!plugs.length) return null
  const d = plugs.map((p) => `M${p.at.x - 2} ${p.at.y - 2}h4v4h-4z`).join('')
  return <path d={d} fill={TAKEN} pointerEvents="none" />
}

/** One metal leg dot per plugged pin, drawn above the parts so it shows where each leg goes in. */
export function LegDots({ plugs }: { plugs: Plug[] }) {
  return (
    <g data-legs="" pointerEvents="none">
      {plugs.map((p) => (
        <circle key={`${p.part}:${p.pin}`} cx={p.at.x} cy={p.at.y} r={2.2} fill={METAL} stroke={INK} strokeWidth={1} />
      ))}
    </g>
  )
}
