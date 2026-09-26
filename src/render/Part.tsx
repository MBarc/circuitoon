// Draws one module in the Sticker style: flat fills, dark ink outline on every shape.
import { memo } from 'react'
import { insideLabelSides, type ModuleDef, type PinType, type PlacedPin, type Side, layoutModule, LEAD } from '../format/module.ts'
import { bodyRect, pivot, worldPins, type Rect, type Rotation, type WorldPin } from '../format/geometry.ts'
import { bandFills } from '../format/values.ts'

export const INK = '#23282F'
const OUTLINE = 1.6
export const METAL = '#C9CED6'

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

function PinStub({ p }: { p: PlacedPin }) {
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
function PinLabel({ p, box, outside, pad = 4 }: { p: WorldPin; box: Rect; outside: boolean; pad?: number }) {
  const text = p.label ?? p.name
  const common = { fontSize: 7, fontWeight: 700, fill: INK, stroke: '#FFFFFF', strokeWidth: 2.4, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }
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
 * Memoized: props are primitives plus a module object that keeps its identity, so pan, zoom
 * and selection changes do not re-render every part.
 */
export const Part = memo(function Part({ module: m, x = 0, y = 0, rotation = 0, caption, values }: {
  module: ModuleDef
  x?: number
  y?: number
  rotation?: Rotation
  caption?: string
  /** The part instance's chosen values, for example `{ resistance: { value: 4700, unit: "ohm" } }`. */
  values?: Record<string, unknown>
}) {
  const lay = layoutModule(m)
  const art = m.art
  const ax = art ? (lay.w - art.w) / 2 : 0
  const ay = art ? (lay.h - art.h) / 2 : 0
  const c = pivot(lay.w, lay.h)
  // Only a module with band shapes (a resistor) ever gets non-null fills here.
  const bands = bandFills(m, values)
  // Caption goes under the rotated body, below any pin stubs that now point down.
  const box = bodyRect({ x: 0, y: 0, rotation }, lay)
  const pins = worldPins({ x: 0, y: 0, rotation }, m)
  const stubsDown = pins.some((p) => p.dir.y > 0)
  const headers = headerSides(m)
  const captionY = box.y + box.h + (stubsDown ? LEAD : 0) + 15
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform={rotation ? `rotate(${rotation} ${c.x} ${c.y})` : undefined}>
        {lay.pins.map((p) => <PinStub key={p.name} p={p} />)}
        {art ? (
          <g transform={`translate(${ax} ${ay})`}>
            {art.shapes.map((s, i) => (
              <g key={i}>
                <rect
                  x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius ?? 0}
                  fill={s.band && bands ? bands[s.band - 1] : s.fill}
                  stroke={s.outline === false ? 'none' : INK}
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
        const header = !!art && headers.has(lay.pins[i].side)
        return <PinLabel key={p.name} p={p} box={box} outside={!!art && !header} pad={header ? HEADER_INSET : 4} />
      })}
      {caption && (
        <text x={box.x + box.w / 2} y={captionY} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={INK}>
          {caption}
        </text>
      )}
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
