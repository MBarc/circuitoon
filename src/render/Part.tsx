// Draws one module in the Sticker style: flat fills, dark ink outline on every shape.
import { type ModuleDef, type PlacedPin, layoutModule, LEAD } from '../format/module.ts'

export const INK = '#23282F'
const OUTLINE = 1.6
const METAL = '#C9CED6'

function showLabel(m: ModuleDef, p: PlacedPin) {
  return p.label !== undefined || m.pins.length > 2 || p.type === 'power_out' || p.type === 'power_in' || p.type === 'ground'
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

function PinLabel({ p, h, w, outside }: { p: PlacedPin; w: number; h: number; outside: boolean }) {
  const text = p.label ?? p.name
  const common = { fontSize: 7, fontWeight: 700, fill: INK, stroke: '#FFFFFF', strokeWidth: 2.4, paintOrder: 'stroke' }
  // Drawn parts keep their art clean: labels sit beside the pin stub, outside the body.
  if (outside) {
    const midX = (p.edge.x + p.end.x) / 2
    const midY = (p.edge.y + p.end.y) / 2
    if (p.dir.x !== 0) return <text x={midX} y={p.edge.y - 5} textAnchor="middle" {...common}>{text}</text>
    return <text x={p.edge.x + 4} y={midY} dominantBaseline="central" {...common}>{text}</text>
  }
  const pad = 4
  const inside = { ...common, dominantBaseline: 'central' as const }
  if (p.side === 'left') return <text x={pad} y={p.edge.y} {...inside}>{text}</text>
  if (p.side === 'right') return <text x={w - pad} y={p.edge.y} textAnchor="end" {...inside}>{text}</text>
  const y = p.side === 'top' ? pad : h - pad
  return (
    <text x={p.edge.x} y={y} transform={`rotate(-90 ${p.edge.x} ${y})`} textAnchor={p.side === 'top' ? 'end' : 'start'} {...inside}>
      {text}
    </text>
  )
}

export function Part({ module: m, x = 0, y = 0, caption }: { module: ModuleDef; x?: number; y?: number; caption?: string }) {
  const lay = layoutModule(m)
  const art = m.art
  // Art is centered in the body when the body grew larger than the drawing.
  const ax = art ? (lay.w - art.w) / 2 : 0
  const ay = art ? (lay.h - art.h) / 2 : 0
  return (
    <g transform={`translate(${x} ${y})`}>
      {lay.pins.map((p) => <PinStub key={p.name} p={p} />)}
      {art ? (
        <g transform={`translate(${ax} ${ay})`}>
          {art.shapes.map((s, i) => (
            <g key={i}>
              <rect
                x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius ?? 0}
                fill={s.fill}
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
      {lay.pins.filter((p) => showLabel(m, p)).map((p) => <PinLabel key={p.name} p={p} w={lay.w} h={lay.h} outside={!!art} />)}
      {caption && (
        <text
          x={lay.w / 2} y={lay.h + (lay.pins.some((p) => p.side === 'bottom') ? LEAD : 0) + 15}
          textAnchor="middle" fontSize={8.5} fontWeight={700} fill={INK}
        >
          {caption}
        </text>
      )}
    </g>
  )
}

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
