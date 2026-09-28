// A standalone SVG of a sheet for the CLI (agent toolkit spec 4.1): the Sheet rendered with
// react-dom/server, inline light or dark colors (no CSS variables), a stated font fallback (the
// site's Atkinson Hyperlegible when installed, else the system sans-serif) and tight content
// bounds, or a focus box around chosen parts. Pure: no DOM needed.
import { renderToStaticMarkup } from 'react-dom/server'
import { computeRoutes, type Diagram, moduleOf, type Routes } from '../format/diagram.ts'
import { type Rect, bodyRect } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { captionBox } from './captionBox.ts'
import { annotationRect } from './annotationGeometry.ts'
import { Sheet } from './Sheet.tsx'
import { DARK_THEME, LIGHT_THEME } from './theme.ts'

export const EXPORT_FONT = `'Atkinson Hyperlegible', 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif`
/** Room around each body for pin stubs and the labels beside them. */
const PIN_ROOM = 18

function boundsOf(rects: Rect[], pad: number): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 200, h: 100 }
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + 2 * pad), h: Math.ceil(y1 - y0 + 2 * pad) }
}

function partRects(d: Diagram, only?: Set<string>): Rect[] {
  const out: Rect[] = []
  for (const p of d.parts) {
    if (only && !only.has(p.uid)) continue
    const m = moduleOf(d, p.module)
    if (!m) continue
    const b = bodyRect(p, layoutModule(m))
    out.push({ x: b.x - PIN_ROOM, y: b.y - PIN_ROOM, w: b.w + 2 * PIN_ROOM, h: b.h + 2 * PIN_ROOM }, captionBox(p, m))
  }
  return out
}

const pointRects = (routes: Routes, uids?: Set<string>): Rect[] =>
  [...routes].flatMap(([uid, r]) => (r && (!uids || uids.has(uid)) ? r.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })) : []))

/** Everything drawn: parts with their stubs and captions, wires, frames and notes; 20 px of paper around. */
export function contentBounds(d: Diagram, routes: Routes = computeRoutes(d)): Rect {
  return boundsOf([...partRects(d), ...pointRects(routes), ...(d.annotations ?? []).map(annotationRect)], 20)
}

/** The given parts and every wire touching them; 30 px of paper around. */
export function focusBounds(d: Diagram, uids: string[], routes: Routes = computeRoutes(d)): Rect {
  const parts = new Set(uids)
  const wires = new Set(d.connections.filter((c) => parts.has(c.from.part) || parts.has(c.to.part)).map((c) => c.uid))
  return boundsOf([...partRects(d, parts), ...pointRects(routes, wires)], 30)
}

export function renderSheetSvg(d: Diagram, opts: { dark?: boolean; box?: Rect } = {}): { svg: string; width: number; height: number } {
  const box = opts.box ?? contentBounds(d)
  const markup = renderToStaticMarkup(<Sheet diagram={d} box={box} label={d.title} theme={opts.dark ? DARK_THEME : LIGHT_THEME} />)
  const width = Math.ceil(box.w)
  const height = Math.ceil(box.h)
  const svg = markup.replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${EXPORT_FONT}" `)
  return { svg: `${svg}\n`, width, height }
}
