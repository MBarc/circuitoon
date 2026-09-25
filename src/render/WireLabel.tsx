// A wire's name, drawn as a small sticker-style tag centered on the wire's longest straight run.
import { INK } from './Part.tsx'

const MAX_CHARS = 40

/** Text over 40 characters is shown truncated (kept at MAX_CHARS, ellipsis included); the full text still reads in a <title>. */
function shownText(text: string): string {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + '…' : text
}

export function WireLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const shown = shownText(text)
  const truncated = shown !== text
  const width = shown.length * 4.9 + 10
  const height = 13
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={4}
        fill="#FFFFFF"
        stroke={INK}
        strokeWidth={1.2}
        pointerEvents="all"
      />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight="bold" fill={INK} pointerEvents="none">
        {shown}
        {truncated && <title>{text}</title>}
      </text>
    </g>
  )
}
