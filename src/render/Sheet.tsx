// A diagram drawn on graph paper: group frames, boards, then parts, then wires on top with hop arcs
// and pin dots, wire name tags, and text notes last; a mains sheet adds the notice in a footer band.
// The theme sets the paper, grid, caption and wire casing colors: CSS variables on the site, inline
// colors in a standalone export (exportSvg.tsx). The mains look (identity colours, hazard rim, bolts,
// the green-yellow stripe) is drawn in every theme.
import { computeRoutes, labelAnchor, type Diagram, moduleOf, wireColor, wirePaths, wireStripe, wireWidth, type PartInstance } from '../format/diagram.ts'
import { drawnColor, labelLooks, wireLooks } from '../format/mainsLook.ts'
import { labelName } from '../format/netLabels.ts'
import { isNetLabel } from '../format/module.ts'
import { seatedLabels } from '../format/seatedLabels.ts'
import { plugsOf, splitBoards } from '../format/breadboard.ts'
import { partCaption } from '../format/values.ts'
import { Part } from './Part.tsx'
import { LegDots, TakenHoles } from './Boards.tsx'
import { WireLabel } from './WireLabel.tsx'
import { CableLayer } from './CableEnd.tsx'
import { FrameMark, NoteMark } from './Annotations.tsx'
import { SITE_THEME, type SheetTheme } from './theme.ts'
import { BLOCKED_STROKE, Bolts, PluggedLink, HazardOutline, MainsNotice, NOTICE_MIN_WIDTH, Stripe, boltInsets, noticeHeight, noticeLines } from './Mains.tsx'
import { MAINS_NOTICE, hasMains } from '../format/mains.ts'
import { isPluggedIn } from '../format/usb.ts'

/**
 * The sheet's viewBox: `box`, plus on a mains sheet the footer band for the notice (spec 6), at least
 * NOTICE_MIN_WIDTH wide. A standalone export sizes its SVG from this, so the band is never squeezed.
 */
export function sheetFrame(diagram: Diagram, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (!hasMains(diagram)) return box
  const band = Math.max(box.w, NOTICE_MIN_WIDTH)
  return { x: box.x, y: box.y, w: band, h: box.h + noticeHeight(noticeLines(MAINS_NOTICE, band - 32).length) }
}

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
  // The mains look (identity colours, hazard marks), from the analysis the checker already cached.
  const looks = wireLooks(diagram)
  const seated = seatedLabels(diagram)
  const flags = labelLooks(diagram)
  // Spec 6: a mains sheet carries the notice in a footer band reserved below the drawing (never over it),
  // at least NOTICE_MIN_WIDTH wide, so every export that renders the sheet shows it whole.
  const mains = hasMains(diagram)
  const frame = sheetFrame(diagram, box)
  const part = (p: PartInstance) => {
    const m = moduleOf(diagram, p.module)
    const s = seated.get(p.uid)
    // A net label carries its name in its flag, never a caption.
    const label = isNetLabel(m)
    return m ? (
      <Part key={p.uid} module={m} x={p.x} y={p.y} rotation={p.rotation} caption={label ? undefined : (captions[p.uid] ?? partCaption(p, m))} values={p.values}
        netName={label ? labelName(p) : undefined} netLook={flags.get(p.uid)}
        captionX={s?.caption.x} captionY={s?.caption.y} captionAnchor={s?.anchor} labelInset={s?.labelInset}
        ink={theme.ink} halo={theme.halo} outline={theme.outline} />
    ) : null
  }
  return (
    <svg className="sheet" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}>
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke={theme.grid} strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={theme.paper} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid)" />
      {notes.filter((a) => a.type === 'frame').map((a) => <FrameMark key={a.uid} a={a} theme={theme} />)}
      {boards.map(part)}
      <TakenHoles plugs={plugs} />
      {others.map(part)}
      <LegDots plugs={plugs} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {wires.map(({ conn, d, blocked }) => {
          const w = wireWidth(conn.gauge)
          const look = looks.get(conn.uid)
          const name = drawnColor(conn, looks)
          const stripe = wireStripe(name)
          if (isPluggedIn(diagram, conn)) return <g key={conn.uid} data-wire={conn.uid}><PluggedLink d={d} casing={theme.casing} /></g>
          return (
            <g key={conn.uid} data-wire={conn.uid}>
              {look?.hazard && <HazardOutline d={d} width={w} />}
              <path d={d} stroke={theme.casing} strokeWidth={w + 2.2} {...(blocked ? BLOCKED_STROKE : {})} />
              <path className="wire-color" d={d} stroke={wireColor(name)} strokeWidth={w} {...(blocked ? BLOCKED_STROKE : {})} />
              {stripe && <Stripe d={d} width={w} color={stripe} blocked={blocked} />}
            </g>
          )
        })}
      </g>
      <CableLayer wires={wires} looks={looks} />
      {wires.map(({ conn, points, cables }) => (looks.get(conn.uid)?.hazard ? <Bolts key={`bolt-${conn.uid}`} points={points} insets={boltInsets(cables)} /> : null))}
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
      {mains && <MainsNotice box={box} text={MAINS_NOTICE} />}
    </svg>
  )
}
