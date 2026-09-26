// Built-in parts. Drag one onto the sheet, or click it to drop it in the middle of the view.
// Grouped by category (see libraryGroups.ts) with a search box and collapsible groups, so the
// panel stays organized as more parts are added.
import { useMemo, useState } from 'react'
import { library } from '../library.ts'
import { Part, partBounds } from '../render/Part.tsx'
import { groupLibrary, searchLibrary } from './libraryGroups.ts'
import type { ModuleDef } from '../format/module.ts'

export const MODULE_MIME = 'application/x-circuitoon-module'

const COLLAPSED_KEY = 'circuitoon.library.collapsed'

/** Which groups the person collapsed last time, remembered per browser. Storage can fail
 * (private browsing, a full quota, a disabled API) and the panel must still work: every access
 * is wrapped so a storage error just leaves every group expanded. */
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((c): c is string => typeof c === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function saveCollapsed(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  } catch {
    // Storage unavailable: collapse state just won't persist across reloads.
  }
}

function LibItem({ m, onAdd }: { m: ModuleDef; onAdd: (moduleId: string) => void }) {
  const b = partBounds(m)
  return (
    <button
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
    </button>
  )
}

export function LibraryPanel({ onAdd }: { onAdd: (moduleId: string) => void }) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed())

  const modules = useMemo(() => library.flatMap((e) => (e.ok ? [e.module] : [])), [])
  const groups = useMemo(() => groupLibrary(modules), [modules])

  const searching = query.trim() !== ''
  const visibleGroups = useMemo(() => searchLibrary(groups, query), [groups, query])

  function toggle(category: string) {
    const next = new Set(collapsed)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    setCollapsed(next)
    saveCollapsed(next)
  }

  return (
    <aside className="library" aria-label="Parts library">
      <h2>Parts</h2>
      <p className="hint">Drag onto the sheet, or click to add.</p>
      <input
        type="search"
        className="lib-search"
        placeholder="Search parts"
        aria-label="Search parts"
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
      />
      {visibleGroups.length === 0 && <p className="hint">No parts match</p>}
      {visibleGroups.map((g) => {
        const expanded = searching || !collapsed.has(g.category)
        return (
          <div className="lib-group" key={g.category}>
            <button
              type="button"
              className="lib-group-head"
              aria-expanded={expanded}
              aria-disabled={searching || undefined}
              onClick={() => {
                if (!searching) toggle(g.category)
              }}
            >
              <span>{g.category}</span>
              <span className="lib-group-count">{g.modules.length}</span>
            </button>
            {expanded && (
              <div className="lib-group-items">
                {g.modules.map((m) => <LibItem key={m.id} m={m} onAdd={onAdd} />)}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
