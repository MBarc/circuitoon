// Draws one module in the Sticker style: flat fills, dark ink outline on every shape (a dark body gets
// the theme's outline color instead, when the theme sets one).
import { memo } from 'react'
import { insideLabelSides, isNetLabel, type ModuleDef, type PinType, type PlacedPin, type Side, type UsbSpec, layoutModule, LEAD, usbOf } from '../format/module.ts'
import type { LabelLook } from '../format/mainsLook.ts'
import { NetLabelFlag } from './NetLabel.tsx'
import { bodyRect, pivot, worldPins, type Rect, type Rotation, type WorldPin } from '../format/geometry.ts'
import { bandFills } from '../format/values.ts'
import { CAPTION_SIZE, captionAnchor } from './captionBox.ts'

export const INK = '#23282F'
const OUTLINE = 1.6
export const METAL = '#C9CED6'

/** Relative luminance below which a body fill counts as dark (about #3A3A3A). */
const DARK_LUMINANCE = 0.05
const bodies = new WeakMap<ModuleDef, number>()

/** WCAG relative luminance of a #RRGGBB color; null for anything else. */
function luminance(hex: string | undefined): number | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Index of a module's body shape (its largest art shape), or -1 when it has no art. Cached. */
function bodyShape(m: ModuleDef): number {
  const hit = bodies.get(m)
  if (hit !== undefined) return hit
  let best = -1
  m.art?.shapes.forEach((s, i) => {
    if (best < 0 || s.w * s.h > m.art!.shapes[best].w * m.art!.shapes[best].h) best = i
  })
  bodies.set(m, best)
  return best
}

/** Whether a module's body (its largest art shape) is dark, so it needs an outline on dark paper. */
export function darkBody(m: ModuleDef): boolean {
  const i = bodyShape(m)
  const l = i < 0 ? null : luminance(m.art!.shapes[i].fill)
  return l !== null && l < DARK_LUMINANCE
}

function showLabel(m: ModuleDef, p: { label?: string; type?: PinType }) {
  return p.label !== undefined || m.pins.length > 2 || p.type === 'power_out' || p.type === 'power_in' || p.type === 'ground'
}

/**
 * A module opted into `art.pinLabels: "inside"` (the built-in dev boards, DIP chips and display
 * modules) draws its pin labels inside the body beside each pin, like silkscreen, instead of
 * beside the pin stub: at 0.1 inch pitch a label beside the stub would sit between two pins.
 * Left and right labels read horizontally, top and bottom ones bottom to top. Header art keeps its
 * strip in the outer HEADER_INSET px so the labels clear it.
 */
const HEADER_INSET = 12
function headerSides(m: ModuleDef): Set<Side> {
  return new Set(insideLabelSides(m))
}

/** Across-the-edge width and corner radius of each USB connector's glyph, in px. */
const USB_GLYPH: Record<UsbSpec['connector'], [number, number]> = { A: [12, 0.8], B: [11, 2], 'mini-B': [7.5, 1.2], 'micro-B': [7, 1.2], C: [8, 3.2] }
const USB_SLOT = '#2B2F36'
const USB_TONGUE = '#F4F6F8'

/**
 * A USB port in place of a pin stub (USB design 1.2): the connector's metal shell standing out of the
 * body edge where the wire attaches, its opening dark for a socket, or with its white contact tongue
 * for a plug. Drawn in a frame whose +x points out of the body.
 */
function UsbGlyph({ p, usb }: { p: PlacedPin; usb: UsbSpec }) {
  const [w, rx] = USB_GLYPH[usb.connector]
  const angle = p.dir.x > 0 ? 0 : p.dir.y > 0 ? 90 : p.dir.x < 0 ? 180 : 270
  const plug = usb.gender === 'plug'
  return (
    <g data-usb-port={p.name} data-usb-gender={usb.gender} transform={`translate(${p.edge.x} ${p.edge.y}) rotate(${angle})`}>
      <rect x={-3} y={-w / 2} width={LEAD + 3} height={w} rx={rx} fill={METAL} stroke={INK} strokeWidth={1.1} />
      {plug
        ? <rect x={-1} y={-w / 2 + 1.6} width={LEAD - 0.5} height={Math.max(1.4, w / 2 - 1.6)} rx={0.6} fill={USB_TONGUE} stroke={INK} strokeWidth={0.6} />
        : <rect x={LEAD - 3.2} y={-w / 2 + 1.4} width={2.6} height={w - 2.8} rx={Math.min(rx, 1)} fill={USB_SLOT} />}
    </g>
  )
}

function PinStub({ p, usb }: { p: PlacedPin; usb?: UsbSpec }) {
  if (usb) return <UsbGlyph p={p} usb={usb} />
  if (p.bus) {
    const len = p.bus.length * 10
    const horiz = p.side === 'top' || p.side === 'bottom'
    const x = horiz ? p.edge.x - len / 2 : p.side === 'left' ? p.edge.x - 5 : p.edge.x
    const y = horiz ? (p.side === 'top' ? p.edge.y - 5 : p.edge.y) : p.edge.y - len / 2
    return <rect x={x} y={y} width={horiz ? len : 5} height={horiz ? 5 : len} rx={2} fill={METAL} stroke={INK} strokeWidth={1.2} />
  }
  const horiz = p.dir.x !== 0
  const x = Math.min(p.edge.x, p.end.x) - (horiz ? 0 : 1.75)
  const y = Math.min(p.edge.y, p.end.y) - (horiz ? 1.75 : 0)
  return <rect x={x} y={y} width={horiz ? LEAD : 3.5} height={horiz ? 3.5 : LEAD} rx={1.2} fill={METAL} stroke={INK} strokeWidth={1.1} />
}

const HOLE = '#3A3F47'
const HOLE_SIZE = 3.4
const PAD = '#E0B43C'
const PAD_SIZE = 7
const PAD_HOLE = '#8A6A1E'
const PAD_HOLE_SIZE = 3

const holePaths = new WeakMap<ModuleDef, { holes: string; pads: string; padHoles: string }>()

/**
 * Every hole of a module as one path per style (breadboard holes, header pads, pad holes), in
 * module-local px, so an 830-hole board is three SVG elements rather than 830. Cached per module.
 */
export function holePathData(m: ModuleDef): { holes: string; pads: string; padHoles: string } {
  const hit = holePaths.get(m)
  if (hit) return hit
  const square = (x: number, y: number, s: number) => `M${x - s / 2} ${y - s / 2}h${s}v${s}h${-s}z`
  let holes = ''
  let pads = ''
  let padHoles = ''
  for (const g of m.holes ?? [])
    for (const [x, y] of g.at) {
      if (g.holeStyle === 'pad') {
        pads += square(x, y, PAD_SIZE)
        padHoles += square(x, y, PAD_HOLE_SIZE)
      } else holes += square(x, y, HOLE_SIZE)
    }
  const out = { holes, pads, padHoles }
  holePaths.set(m, out)
  return out
}

/** Holes and pads, drawn above the art in body coordinates (they rotate with the part). */
function Holes({ m }: { m: ModuleDef }) {
  const p = holePathData(m)
  return (
    <g data-holes="">
      {p.holes && <path d={p.holes} fill={HOLE} />}
      {p.pads && <path d={p.pads} fill={PAD} stroke={INK} strokeWidth={0.8} />}
      {p.padHoles && <path d={p.padHoles} fill={PAD_HOLE} />}
    </g>
  )
}

/**
 * A pin label, placed from the pin's rotated position so it stays upright at any rotation:
 * horizontal beside pins on a left or right edge, reading bottom to top beside pins on a top
 * or bottom edge (the pitch is too tight for horizontal text there). `box` is the rotated body.
 */
function PinLabel({ p, box, outside, tips = false, pad = 4 }: { p: WorldPin; box: Rect; outside: boolean; tips?: boolean; pad?: number }) {
  const text = p.label ?? p.name
  const common = { fontSize: 7, fontWeight: 700, fill: INK, stroke: '#FFFFFF', strokeWidth: 2.4, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }
  // Past the stub tip, along the pin: horizontal off a left or right pin, reading bottom to top off
  // a top or bottom one, so a row at 0.1 inch pitch stays readable (`art.pinLabels: "tips"`).
  if (tips) {
    const tip = { ...common, dominantBaseline: 'central' as const }
    const x = p.end.x + p.dir.x * 2
    const y = p.end.y + p.dir.y * 2
    if (p.dir.x !== 0) return <text x={x} y={y} textAnchor={p.dir.x < 0 ? 'end' : 'start'} {...tip}>{text}</text>
    return <text x={x} y={y} transform={`rotate(-90 ${x} ${y})`} textAnchor={p.dir.y < 0 ? 'start' : 'end'} {...tip}>{text}</text>
  }
  // Drawn parts keep their art clean: labels sit beside the pin stub, outside the body.
  if (outside) {
    const midX = (p.edge.x + p.end.x) / 2
    const midY = (p.edge.y + p.end.y) / 2
    if (p.dir.x !== 0) return <text x={midX} y={p.edge.y - 5} textAnchor="middle" {...common}>{text}</text>
    return <text x={p.edge.x + 4} y={midY} dominantBaseline="central" {...common}>{text}</text>
  }
  const inside = { ...common, dominantBaseline: 'central' as const }
  if (p.dir.x < 0) return <text x={box.x + pad} y={p.edge.y} {...inside}>{text}</text>
  if (p.dir.x > 0) return <text x={box.x + box.w - pad} y={p.edge.y} textAnchor="end" {...inside}>{text}</text>
  const top = p.dir.y < 0
  const y = top ? box.y + pad : box.y + box.h - pad
  return (
    <text x={p.edge.x} y={y} transform={`rotate(-90 ${p.edge.x} ${y})`} textAnchor={top ? 'end' : 'start'} {...inside}>
      {text}
    </text>
  )
}

/**
 * The label of a lead another part covers (the upper device of a duplex outlet): inside the body just
 * in from the lead, horizontal, with the white halo every pin label has so it reads on dark plastic.
 */
function CoveredLabel({ p, inset }: { p: WorldPin; inset: number }) {
  const text = p.label ?? p.name
  const x = p.edge.x - p.dir.x * inset
  const y = p.edge.y - p.dir.y * inset
  return (
    <text x={x} y={y} textAnchor={p.dir.x < 0 ? 'start' : p.dir.x > 0 ? 'end' : 'middle'} dominantBaseline="central"
      fontSize={7} fontWeight={700} fill={INK} stroke="#FFFFFF" strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke">
      {text}
    </text>
  )
}

/**
 * Memoized: props are primitives plus a module object that keeps its identity, so pan, zoom
 * and selection changes do not re-render every part.
 */
export const Part = memo(function Part({ module: m, x = 0, y = 0, rotation = 0, caption, values, captionX, captionY: seatY, captionAnchor: seatAnchor = 'start', labelInset = null, ink = INK, halo, outline, netName = '', netLook }: {
  module: ModuleDef
  x?: number
  y?: number
  rotation?: Rotation
  caption?: string
  /** A seated plug-in device's caption start, part-local (src/format/seatedLabels.ts); primitives, so the memo holds. */
  captionX?: number
  captionY?: number
  captionAnchor?: 'start' | 'middle'
  /** Another part covers the leads: their labels go inside the body, horizontal, this far in from each lead. */
  labelInset?: number | null
  /** The part instance's chosen values, for example `{ resistance: { value: 4700, unit: "ohm" } }`. */
  values?: Record<string, unknown>
  /** Caption color (the theme's ink); the Sticker ink by default. */
  ink?: string
  /** Outline color behind the caption (the theme's halo); none by default. */
  halo?: string
  /** Body outline for a dark-bodied part (the theme's outline); the Sticker ink by default. */
  outline?: string
  /** A net label's name (src/format/netLabels.ts labelName) and look (mainsLook.ts labelLook); a library preview shows NET. */
  netName?: string
  netLook?: LabelLook
}) {
  const lay = layoutModule(m)
  if (isNetLabel(m)) {
    const c0 = pivot(lay.w, lay.h)
    return (
      <g transform={`translate(${x} ${y})`}>
        <g transform={rotation ? `rotate(${rotation} ${c0.x} ${c0.y})` : undefined}>
          <NetLabelFlag name={netName || (netLook ? '' : 'NET')} look={netLook ?? 'signal'} mid={lay.pins[0]?.edge.y ?? lay.h / 2} rotation={rotation} outline={outline} />
        </g>
      </g>
    )
  }
  const art = m.art
  const ax = art ? (lay.w - art.w) / 2 : 0
  const ay = art ? (lay.h - art.h) / 2 : 0
  const c = pivot(lay.w, lay.h)
  // Only a module with band shapes (a resistor) ever gets non-null fills here.
  const bands = bandFills(m, values)
  // The rotated body and pins place the pin labels; the caption anchor comes from captionBox.ts.
  const box = bodyRect({ x: 0, y: 0, rotation }, lay)
  const pins = worldPins({ x: 0, y: 0, rotation }, m)
  const headers = headerSides(m)
  const cap = captionAnchor(m, rotation)
  const body = outline && darkBody(m) ? bodyShape(m) : -1
  const captionHalo = halo ? { stroke: halo, strokeWidth: 3, strokeLinejoin: 'round' as const, paintOrder: 'stroke' } : {}
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform={rotation ? `rotate(${rotation} ${c.x} ${c.y})` : undefined}>
        {lay.pins.map((p) => <PinStub key={p.name} p={p} usb={p.type === 'usb' ? usbOf(m, p.name) : undefined} />)}
        {art ? (
          <g transform={`translate(${ax} ${ay})`}>
            {art.shapes.map((s, i) => (
              <g key={i} className={s.horn ? 'art-horn' : undefined}>
                <rect
                  x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius ?? 0}
                  fill={s.band && bands ? bands[s.band - 1] : s.fill}
                  stroke={i === body ? outline : s.outline === false ? 'none' : INK}
                  strokeWidth={OUTLINE}
                />
                {s.label && (
                  <text
                    x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize={s.labelSize ?? 8} fontWeight={700} fill={s.labelColor ?? INK}
                  >
                    {s.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        ) : (
          <>
            <rect width={lay.w} height={lay.h} rx={4} fill="#DDE7E1" stroke={INK} strokeWidth={OUTLINE} />
            <text x={lay.w / 2} y={lay.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill={INK}>
              {m.name}
            </text>
          </>
        )}
        {m.holes?.length ? <Holes m={m} /> : null}
      </g>
      {pins.map((p, i) => {
        if (!showLabel(m, p)) return null
        if (labelInset !== null) return <CoveredLabel key={p.name} p={p} inset={labelInset} />
        const header = !!art && headers.has(lay.pins[i].side)
        return <PinLabel key={p.name} p={p} box={box} outside={!!art && !header} tips={art?.pinLabels === 'tips'} pad={header ? HEADER_INSET : 4} />
      })}
      {caption && (captionX !== undefined && seatY !== undefined ? (
        <text x={captionX} y={seatY} textAnchor={seatAnchor} dominantBaseline={seatAnchor === 'start' ? 'central' : 'auto'} fontSize={CAPTION_SIZE} fontWeight={700} fill={ink} {...captionHalo}>
          {caption}
        </text>
      ) : (
        <text x={cap.x} y={cap.y} textAnchor="middle" fontSize={CAPTION_SIZE} fontWeight={700} fill={ink} {...captionHalo}>
          {caption}
        </text>
      ))}
    </g>
  )
})

/** Bounding box of a part including pin stubs, in part-local px. */
export function partBounds(m: ModuleDef) {
  const lay = layoutModule(m)
  const hasTop = lay.pins.some((p) => p.side === 'top')
  const hasBottom = lay.pins.some((p) => p.side === 'bottom')
  const hasLeft = lay.pins.some((p) => p.side === 'left')
  const hasRight = lay.pins.some((p) => p.side === 'right')
  const x0 = hasLeft ? -LEAD : 0
  const y0 = hasTop ? -LEAD : 0
  return { x: x0, y: y0, w: lay.w + (hasRight ? LEAD : 0) - x0, h: lay.h + (hasBottom ? LEAD : 0) - y0 }
}
