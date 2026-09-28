// Sizes of group frames and text notes, shared by the renderer, the editor's hit targets and the
// layout (which must keep notes clear of parts). Pure.
import type { Annotation } from '../format/diagram.ts'
import type { Rect } from '../format/geometry.ts'

export const NOTE_SIZE = 10
export const NOTE_LINE = 13
export const NOTE_PAD = 6
/** Characters per drawn line of a note: a longer line wraps when drawn (the text keeps no break). */
export const NOTE_WRAP = 48
const NOTE_CHAR = 5.9
const TAB_CHAR = 5.6

/** A note's drawn lines: each typed line as typed, a line longer than NOTE_WRAP word-wrapped. */
export const noteLines = (text: string): string[] => text.split('\n').flatMap((line) => (line.length > NOTE_WRAP ? wrapNote(line).split('\n') : [line]))

/** A frame's label tab, straddling its top edge 10 px from the left. */
export function frameTab(a: Annotation): Rect {
  return { x: a.x + 10, y: a.y - 8, w: (a.label ?? '').length * TAB_CHAR + 12, h: 16 }
}

/** Everything an annotation draws, in world px: a frame with its tab, or a note's box. */
export function annotationRect(a: Annotation): Rect {
  if (a.type === 'frame') {
    const w = a.w ?? 0
    const h = a.h ?? 0
    if (!a.label) return { x: a.x, y: a.y, w, h }
    const t = frameTab(a)
    return { x: a.x, y: t.y, w: Math.max(a.x + w, t.x + t.w) - a.x, h: a.y + h - t.y }
  }
  const lines = noteLines(a.text ?? '')
  return { x: a.x, y: a.y, w: Math.ceil(Math.max(1, ...lines.map((l) => l.length)) * NOTE_CHAR + 2 * NOTE_PAD), h: lines.length * NOTE_LINE + 2 * NOTE_PAD }
}

/** Word-wraps each paragraph to `width` characters (a longer single word keeps its own line). */
export function wrapNote(text: string, width = NOTE_WRAP): string {
  return text
    .split('\n')
    .map((para) => {
      const lines: string[] = []
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > width) {
          lines.push(line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      if (line) lines.push(line)
      return lines.join('\n')
    })
    .join('\n')
}
