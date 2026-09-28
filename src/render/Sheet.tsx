// A diagram drawn on graph paper: boards, then parts, then wires on top with hop arcs and pin dots.
import { computeRoutes, labelAnchor, type Diagram, moduleOf, wireColor, wirePaths, wireStripe, wireWidth, type PartInstance } from '../format/diagram.ts'
import { wireLooks } from '../format/mainsLook.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { partCaption } from '../format/values.ts'
import { Part, INK } from './Part.tsx'
import { LegDots, TakenHoles } from './Boards.tsx'
import { WireLabel } from './WireLabel.tsx'
import { CableLayer } from './CableEnd.tsx'
import { Bolts, HazardOutline, Stripe, boltInsets } from './Mains.tsx'

export function Sheet({ diagram, captions = {}, box, label, decorative = false }: {
  diagram: Diagram
  captions?: Record<string, string>
  /** Visible area in diagram coordinates. */
  box: { x: number; y: number; w: number; h: number }
  label: string
  /** Hide from assistive tech, for a preview inside a control that is already labelled. */
  decorative?: boolean
}) {
  const routes = computeRoutes(diagram)
  const wires = wirePaths(diagram, routes)
  const { boards, others } = splitBoards(diagram)
  const plugs = plugsOf(diagram)
  // The mains look (identity colours, hazard marks), from the analysis the checker already cached.
  const looks = wireLooks(diagram)
  const seated = seatedLabels(diagram)
  const part = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    const s = seated.get(p.uid)
    return m ? (
      <Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={captions[p.uid] ?? partCaption(p, m)} values={p.values}
        captionX={s?.caption.x} captionY={s?.caption.y} captionAnchor={s?.anchor} labelInset={s?.labelInset} />
    ) : null
  }
  return (
    <svg className="sheet" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="var(--paper)" />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid)" />
      {boards.map(part)}
      <TakenHoles plugs={plugs} />
      {others.map(part)}
      <LegDots plugs={plugs} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {wires.map(({ conn, d, blocked }) => {
          const w = wireWidth(conn.gauge)
          const look = looks.get(conn.uid)
          const name = conn.color ?? look?.color ?? undefined
          const stripe = wireStripe(name)
          return (
            <g key={conn.uid} data-wire={conn.uid}>
              {look?.hazard && <HazardOutline d={d} width={w} />}
              <path d={d} stroke={INK} strokeWidth={w + 2.2} strokeDasharray={blocked ? '6 5' : undefined} />
              <path className="wire-color" d={d} stroke={wireColor(name)} strokeWidth={w} strokeDasharray={blocked ? '6 5' : undefined} />
              {stripe && <Stripe d={d} width={w} color={stripe} />}
            </g>
          )
        })}
      </g>
      <CableLayer wires={wires} looks={looks} />
      {wires.map(({ conn, points, cables }) => (looks.get(conn.uid)?.hazard ? <Bolts key={`bolt-${conn.uid}`} points={points} insets={boltInsets(cables)} /> : null))}
      {wires.flatMap(({ conn, ends }) => ends.map((e, i) => <circle key={`${conn.uid}-${i}`} cx={e.x} cy={e.y} r={2.4} fill={INK} />))}
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
    </svg>
  )
}
