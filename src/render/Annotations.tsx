// Group frames and text notes: drawn in the Sheet (so in SVG and PNG exports) and on the editor
// canvas, where `interactive` adds the hit targets and `selected` the selection outline.
import type { Annotation } from '../format/diagram.ts'
import { NOTE_LINE, NOTE_PAD, NOTE_SIZE, annotationRect, frameTab, noteLines } from './annotationGeometry.ts'
import { SITE_THEME, type SheetTheme } from './theme.ts'

type MarkProps = { a: Annotation; theme?: SheetTheme; selected?: boolean; interactive?: boolean }

export function FrameMark({ a, theme = SITE_THEME, selected = false, interactive = false }: MarkProps) {
  const w = a.w ?? 0
  const h = a.h ?? 0
  const tab = frameTab(a)
  return (
    <g data-annotation={a.uid}>
      <rect x={a.x} y={a.y} width={w} height={h} rx={10} fill="none" stroke={theme.ink} strokeWidth={1.4} strokeDasharray="7 5" pointerEvents="none" />
      {interactive && <rect className="annotation-hit" x={a.x} y={a.y} width={w} height={h} rx={10} strokeWidth={10} />}
      {a.label && (
        <g className={interactive ? 'annotation-grab' : undefined}>
          <rect x={tab.x} y={tab.y} width={tab.w} height={tab.h} rx={5} fill={theme.note} stroke={theme.ink} strokeWidth={1.2} />
          <text x={tab.x + 6} y={tab.y + tab.h / 2} dominantBaseline="central" fontSize={9} fontWeight={700} fill={theme.ink}>
            {a.label}
          </text>
        </g>
      )}
      {selected && <rect className="annotation-selected" x={a.x - 5} y={tab.y - 5} width={w + 10} height={a.y + h - tab.y + 10} rx={12} />}
    </g>
  )
}

export function NoteMark({ a, theme = SITE_THEME, selected = false, interactive = false }: MarkProps) {
  const r = annotationRect(a)
  return (
    <g data-annotation={a.uid} className={interactive ? 'annotation-grab' : undefined}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill={theme.note} stroke={theme.ink} strokeWidth={1.2} />
      <text x={r.x + NOTE_PAD} y={r.y + NOTE_PAD + 9} fontSize={NOTE_SIZE} fill={theme.ink}>
        {noteLines(a.text ?? '').map((line, i) => (
          <tspan key={i} x={r.x + NOTE_PAD} dy={i ? NOTE_LINE : 0}>
            {line}
          </tspan>
        ))}
      </text>
      {selected && <rect className="annotation-selected" x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} rx={8} />}
    </g>
  )
}
