// The smart guides of a drag (snap.ts), drawn over the sheet in the guide accent: a thin line for
// each lined-up edge or center, a line with a ringed dot on each pin for a wired pin pair that is
// level, and a dimension bar with end caps and a size tag on each of the equal gaps. Sizes are in
// screen px at the current zoom. Edge lines and gap bars sit on a paper-coloured halo so they read
// over parts and wires; a pin guide has none, since it runs right along the wire it straightens.
import type { SnapResult } from './snap.ts'

/** How far (screen px) an edge guide runs past the objects it joins. */
const OVERHANG = 7
/** Half the length (screen px) of a spacing bar's end cap. */
const CAP = 4.5
/** Radius (screen px) of the ring on each pin of a pin guide. */
const RING = 3.5
/** The gap size tag: font size and height (screen px), and width per digit. */
const TAG_FONT = 11
const TAG_H = 16
const TAG_CHAR = 7

export function GuideLayer({ snap, scale }: { snap: SnapResult; scale: number }) {
  const k = 1 / scale
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number; className: string; data: Record<string, string>; halo: boolean }[] = []
  snap.guides.forEach((g, i) => {
    const over = g.kind === 'edge' ? OVERHANG * k : 0
    const [a, b] = [g.from - over, g.to + over]
    const data: Record<string, string> = { 'data-guide': g.kind, 'data-axis': g.axis, 'data-at': String(g.at) }
    const halo = g.kind === 'edge'
    lines.push(g.axis === 'x'
      ? { key: `g${i}`, x1: g.at, y1: a, x2: g.at, y2: b, className: `guide ${g.kind}`, data, halo }
      : { key: `g${i}`, x1: a, y1: g.at, x2: b, y2: g.at, className: `guide ${g.kind}`, data, halo })
  })
  snap.gaps.forEach((s, i) => {
    const data: Record<string, string> = { 'data-gap': s.axis, 'data-size': String(s.to - s.from) }
    const halo = true
    if (s.axis === 'x') {
      lines.push({ key: `s${i}`, x1: s.from, y1: s.at, x2: s.to, y2: s.at, className: 'guide gap', data, halo })
      lines.push({ key: `s${i}a`, x1: s.from, y1: s.at - CAP * k, x2: s.from, y2: s.at + CAP * k, className: 'guide gap-cap', data: {}, halo })
      lines.push({ key: `s${i}b`, x1: s.to, y1: s.at - CAP * k, x2: s.to, y2: s.at + CAP * k, className: 'guide gap-cap', data: {}, halo })
    } else {
      lines.push({ key: `s${i}`, x1: s.at, y1: s.from, x2: s.at, y2: s.to, className: 'guide gap', data, halo })
      lines.push({ key: `s${i}a`, x1: s.at - CAP * k, y1: s.from, x2: s.at + CAP * k, y2: s.from, className: 'guide gap-cap', data: {}, halo })
      lines.push({ key: `s${i}b`, x1: s.at - CAP * k, y1: s.to, x2: s.at + CAP * k, y2: s.to, className: 'guide gap-cap', data: {}, halo })
    }
  })
  // Each equal gap is tagged with its size in the middle of its bar, so a bar that happens to lie
  // on a center guide still reads as a gap.
  const tags = snap.gaps.map((s, i) => {
    const text = String(Math.round(s.to - s.from))
    const w = (text.length * TAG_CHAR + 8) * k
    const h = TAG_H * k
    const mid = (s.from + s.to) / 2
    const c = s.axis === 'x' ? { x: mid, y: s.at } : { x: s.at, y: mid }
    return { key: `t${i}`, text, x: c.x - w / 2, y: c.y - h / 2, w, h, cx: c.x, cy: c.y }
  })
  const rings = snap.guides.flatMap((g, i) => (g.ends ?? []).map((p, j) => ({ key: `r${i}-${j}`, ...p })))
  return (
    <g className="snap-guides" pointerEvents="none" data-guides="">
      {lines.map(({ key, x1, y1, x2, y2, halo }) => (halo ? <line key={`h-${key}`} className="guide-halo" x1={x1} y1={y1} x2={x2} y2={y2} /> : null))}
      {lines.map(({ key, x1, y1, x2, y2, className, data }) => <line key={key} className={className} x1={x1} y1={y1} x2={x2} y2={y2} {...data} />)}
      {rings.map((r) => <circle key={r.key} className="guide-ring" cx={r.x} cy={r.y} r={RING * k} />)}
      {tags.map((t) => (
        <g key={t.key} className="guide-tag">
          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.h / 2} />
          <text x={t.cx} y={t.cy} fontSize={TAG_FONT * k} dominantBaseline="central" textAnchor="middle">{t.text}</text>
        </g>
      ))}
    </g>
  )
}
