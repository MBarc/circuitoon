// A diagram drawn on graph paper: parts, then wires on top with hop arcs and pin dots.
import { type Diagram, wireColor, wirePaths, wireWidth } from '../format/diagram.ts'
import { Part, INK } from './Part.tsx'

export function Sheet({ diagram, captions = {}, box, label }: {
  diagram: Diagram
  captions?: Record<string, string>
  /** Visible area in diagram coordinates. */
  box: { x: number; y: number; w: number; h: number }
  label: string
}) {
  const wires = wirePaths(diagram)
  return (
    <svg className="sheet" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label={label}>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="var(--paper)" />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid)" />
      {diagram.parts.map((p) => {
        const m = diagram.modules[p.module]
        return m ? <Part key={p.uid} module={m} x={p.x} y={p.y} caption={captions[p.uid] ?? p.designator} /> : null
      })}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {wires.map(({ conn, d }) => {
          const w = wireWidth(conn.gauge)
          return (
            <g key={conn.uid}>
              <path d={d} stroke={INK} strokeWidth={w + 2.2} />
              <path d={d} stroke={wireColor(conn.color)} strokeWidth={w} />
            </g>
          )
        })}
      </g>
      {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
    </svg>
  )
}
