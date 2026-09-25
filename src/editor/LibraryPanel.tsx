// Built-in parts. Drag one onto the sheet, or click it to drop it in the middle of the view.
import { library } from '../library.ts'
import { Part, partBounds } from '../render/Part.tsx'

export const MODULE_MIME = 'application/x-circuitoon-module'

export function LibraryPanel({ onAdd }: { onAdd: (moduleId: string) => void }) {
  return (
    <aside className="library" aria-label="Parts library">
      <h2>Parts</h2>
      <p className="hint">Drag onto the sheet, or click to add.</p>
      {library.flatMap((e) => {
        if (!e.ok) return []
        const m = e.module
        const b = partBounds(m)
        return [
          <button
            key={m.id}
            type="button"
            className="lib-item"
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData(MODULE_MIME, m.id)
              ev.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAdd(m.id)}
          >
            <svg viewBox={`${b.x - 4} ${b.y - 4} ${b.w + 8} ${b.h + 8}`} aria-hidden="true">
              <Part module={m} />
            </svg>
            {m.name}
          </button>,
        ]
      })}
    </aside>
  )
}
