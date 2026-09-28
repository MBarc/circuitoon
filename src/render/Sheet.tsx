// A diagram drawn on graph paper: group frames, boards, then parts, then wires on top with hop arcs
// and pin dots, wire name tags, and text notes last. The theme sets the paper, grid, caption and wire casing
// colors: CSS variables on the site, inline colors in a standalone export (exportSvg.tsx).
import { computeRoutes, labelAnchor, type Diagram, moduleOf, wireColor, wirePaths, wireWidth, type PartInstance } from '../format/diagram.ts'
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { partCaption } from '../format/values.ts'
import { Part } from './Part.tsx'
import { LegDots, TakenHoles } from './Boards.tsx'
import { WireLabel } from './WireLabel.tsx'
import { CableLayer } from './CableEnd.tsx'
import { FrameMark, NoteMark } from './Annotations.tsx'
import { SITE_THEME, type SheetTheme } from './theme.ts'

export function Sheet({ diagram, captions = {}, box, label, decorative = false, theme = SITE_THEME }: {
  diagram: Diagram
  captions?: Record<string, string>
  /** Visible area in diagram coordinates. */
  box: { x: number; y: number; w: number; h: number }
  label: string
  /** Hide from assistive tech, for a preview inside a control that is already labelled. */
  decorative?: boolean
  /** Paper, grid and caption colors (CSS variables on the site). */
  theme?: SheetTheme
}) {
  const routes = computeRoutes(diagram)
  const wires = wirePaths(diagram, routes)
  const { boards, others } = splitBoards(diagram)
  const plugs = plugsOf(diagram)
  const notes = diagram.annotations ?? []
  const part = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    return m ? (
      <Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={captions[p.uid] ?? partCaption(p, m)} values={p.values} ink={theme.ink} halo={theme.halo} outline={theme.outline} />
    ) : null
  }
  return (
    <svg className="sheet" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke={theme.grid} strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={theme.paper} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid)" />
      {notes.filter((a) => a.type === 'frame').map((a) => <FrameMark key={a.uid} a={a} theme={theme} />)}
      {boards.map(part)}
      <TakenHoles plugs={plugs} />
      {others.map(part)}
      <LegDots plugs={plugs} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {wires.map(({ conn, d, blocked }) => {
          const w = wireWidth(conn.gauge)
          const color = wireColor(conn.color)
          return (
            <g key={conn.uid} data-wire={conn.uid}>
              <path d={d} stroke={theme.casing} strokeWidth={w + 2.2} strokeDasharray={blocked ? '6 5' : undefined} />
              <path d={d} stroke={color} strokeWidth={w} strokeDasharray={blocked ? '6 5' : undefined} />
            </g>
          )
        })}
      </g>
      <CableLayer wires={wires} />
      {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={theme.casing} />))}
      {/* Name tags in their own layer after every wire, so a labeled wire crossing under a later
          one still shows its tag on top. Each tag keeps data-wire, matching the editor's canvas. */}
      <g>
        {wires.map(({ conn }) => {
          const anchor = conn.label ? labelAnchor(routes.get(conn.uid)?.points ?? []) : null
          return anchor ? (
            <g key={conn.uid} data-wire={conn.uid}>
              <WireLabel x={anchor.x} y={anchor.y} text={conn.label!} />
            </g>
          ) : null
        })}
      </g>
      {notes.filter((a) => a.type === 'text').map((a) => <NoteMark key={a.uid} a={a} theme={theme} />)}
    </svg>
  )
}
