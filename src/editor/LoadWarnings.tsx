// The warnings a diagram file opened with, under the toolbar. Every warning is reachable: the
// first few show, "Show all N" lists the rest in a scrolling list, and value replacements (a
// resistance, capacitance or voltage the file asked for, now shown as the part default) come
// first and are tagged, so they are never among the hidden ones.
import { useId, useState } from 'react'
import { orderWarnings, shownWarnings } from './warningList.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function LoadWarnings({ warnings, onDismiss, initiallyExpanded = false }: {
  warnings: string[]
  onDismiss: () => void
  /** For tests and screenshots; the editor always opens collapsed. */
  initiallyExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const listId = useId()
  const all = orderWarnings(warnings)
  const shown = shownWarnings(all, expanded)
  const values = all.filter((w) => w.valueReplaced).length
  const canExpand = all.length > shownWarnings(all, false).length
  return (
    <section className="load-warnings" aria-label="Warnings from opening the file">
      <div className="lw-head" role="status">
        <strong>Opened with {plural(all.length, 'warning', 'warnings')}</strong>
        {values > 0 && <span className="lw-values">{plural(values, 'value was', 'values were')} replaced by the part default</span>}
      </div>
      <div className="lw-actions">
        {canExpand && (
          <button type="button" className="tool" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show fewer' : `Show all ${all.length}`}
          </button>
        )}
        <button type="button" className="tool" onClick={onDismiss}>Dismiss</button>
      </div>
      <ul id={listId} className={expanded ? 'lw-list expanded' : 'lw-list'}>
        {shown.map((w, i) => (
          <li key={i} className={w.valueReplaced ? 'value' : undefined}>
            {w.valueReplaced && <span className="lw-tag">Value replaced</span>}
            <span className="lw-text">{w.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
