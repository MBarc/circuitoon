// Built-in parts. Drag one onto the sheet, or click it to drop it in the middle of the view.
// Grouped by category (see libraryGroups.ts) with a search box and collapsible groups, so the
// panel stays organized as more parts are added. My parts (the person's custom parts, see
// myParts.ts) sit at the top with New part and Import part; each has Edit, Duplicate, Export and
// Delete (and whatever `partActions` adds, such as Submit to library).
import { type ReactNode, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { library } from '../library.ts'
import { Part, partBounds } from '../render/Part.tsx'
import { groupLibrary, searchLibrary } from './libraryGroups.ts'
import type { ModuleDef } from '../format/module.ts'
import { type MyPart, myParts } from './myParts.ts'

export const MODULE_MIME = 'application/x-circuitoon-module'

const COLLAPSED_KEY = 'circuitoon.library.collapsed'
const MY_PARTS = 'My parts'

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

function LibItem({ m, onAdd, custom = false }: { m: ModuleDef; onAdd: (moduleId: string) => void; custom?: boolean }) {
  const b = partBounds(m)
  return (
    <button
      type="button"
      className={custom ? 'lib-item mine' : 'lib-item'}
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
      <span className="lib-name">{m.name}{custom && <span className="custom-badge">custom</span>}</span>
    </button>
  )
}

export interface PartHandlers {
  onNew: () => void
  onEdit: (p: MyPart) => void
  onExport: (p: MyPart) => void
  onImport: (file: File) => void
  /** More buttons for a part's action row (Submit to library). */
  partActions?: (p: MyPart) => ReactNode
}

/** One of My parts: the part button, and a row of actions under it while it is open. */
function MyPartItem({ p, onAdd, handlers, open, onToggle }: { p: MyPart; onAdd: (id: string) => void; handlers: PartHandlers; open: boolean; onToggle: () => void }) {
  const m = p.module
  return (
    <div className="mine-item">
      <div className="mine-row">
        <LibItem m={m} onAdd={onAdd} custom />
        <button type="button" className="mine-more" aria-expanded={open} aria-label={`Actions for ${m.name}`} title="Edit, duplicate, export or delete" onClick={onToggle}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="12.5" cy="8" r="1.5" /></svg>
        </button>
      </div>
      {open && (
        <div className="mine-actions" role="group" aria-label={`${m.name} actions`}>
          <button type="button" className="tool small" onClick={() => handlers.onEdit(p)}>Edit</button>
          <button type="button" className="tool small" onClick={() => myParts.duplicate(m.id)}>Duplicate</button>
          <button type="button" className="tool small" onClick={() => handlers.onExport(p)}>Export file</button>
          {handlers.partActions?.(p)}
          <button type="button" className="tool small danger" onClick={() => {
            if (window.confirm(`Delete ${m.name} from My parts? Sheets that use it keep their own copy.`)) myParts.remove(m.id)
          }}>Delete</button>
        </div>
      )}
    </div>
  )
}

export function LibraryPanel({ onAdd, parts: handlers }: { onAdd: (moduleId: string) => void; parts?: PartHandlers }) {
  const [query, setQuery] = useState('')
  const mine = useSyncExternalStore(myParts.subscribe, myParts.getSnapshot)
  const [openPart, setOpenPart] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const q0 = query.trim().toLowerCase()
  const shownMine = q0 ? mine.filter((p) => `${p.module.name} ${p.module.id} ${p.module.category ?? ''}`.toLowerCase().includes(q0)) : mine
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
      {handlers && (
        <div className="mine-tools">
          <button type="button" className="tool small primary" onClick={handlers.onNew}>New part</button>
          <button type="button" className="tool small" onClick={() => importRef.current?.click()}>Import part</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden data-testid="import-part" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handlers.onImport(f)
            e.target.value = ''
          }} />
        </div>
      )}
      {handlers && (() => {
        const q = query.trim().toLowerCase()
        const shown = shownMine
        if (q && !shown.length) return null
        const expanded = !!q || !collapsed.has(MY_PARTS)
        return (
          <div className="lib-group mine-group">
            <button type="button" className="lib-group-head" aria-expanded={expanded} aria-disabled={q ? true : undefined} onClick={() => !q && toggle(MY_PARTS)}>
              <span>{MY_PARTS}</span>
              <span className="lib-group-count">{shown.length}</span>
            </button>
            {expanded && (
              <div className="lib-group-items">
                {shown.length ? shown.map((p) => (
                  <MyPartItem key={p.module.id} p={p} onAdd={onAdd} handlers={handlers} open={openPart === p.module.id} onToggle={() => setOpenPart(openPart === p.module.id ? null : p.module.id)} />
                )) : <p className="hint">Parts you make or import land here. Make one with New part.</p>}
                {!myParts.persisted && <p className="hint warn">This browser is not saving My parts, so they last only until the tab closes. Export them to keep them.</p>}
              </div>
            )}
          </div>
        )
      })()}
      {visibleGroups.length === 0 && (!handlers || !shownMine.length) && <p className="hint">No parts match</p>}
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
