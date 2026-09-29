// Names the exported file where the browser has no Save As dialog of its own (no
// showSaveFilePicker): a small modal with the base name, the kind's fixed suffix after it
// (.circuitoon.json for a sheet, -bom.csv for a bill of materials), Export and Cancel. Enter exports, Escape cancels. Naming the file never renames the sheet.
import { useEffect, useId, useRef, useState } from 'react'
import { type FileKind, SHEET_FILE, cleanBaseName } from './files.ts'

export function ExportDialog({ initial, onExport, onCancel, title = 'Export JSON', kind = SHEET_FILE }: { initial: string; onExport: (base: string) => void; onCancel: () => void; title?: string; kind?: FileKind }) {
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial)
  const titleId = useId()
  const fieldId = useId()
  const noteId = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    input.current?.focus()
    input.current?.select()
  }, [])
  const saved = cleanBaseName(name, kind) + kind.suffix
  const changed = cleanBaseName(name, kind) !== name.trim()
  return (
    <dialog
      ref={ref}
      className="export-dialog"
      aria-labelledby={titleId}
      // Escape: the browser's cancel, which would close the dialog behind React's back.
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onExport(cleanBaseName(name, kind))
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <label className="export-label" htmlFor={fieldId}>File name</label>
        <div className="export-name">
          <input
            ref={input}
            id={fieldId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={noteId}
          />
          <span className="export-suffix" aria-hidden="true">{kind.suffix}</span>
        </div>
        <p id={noteId} className="hint export-note" aria-live="polite">
          {changed ? <>Saves as <strong>{saved}</strong></> : 'The sheet title stays as it is.'}
        </p>
        <div className="export-actions">
          <button type="button" className="tool" onClick={onCancel}>Cancel</button>
          <button type="submit" className="tool primary">Export</button>
        </div>
      </form>
    </dialog>
  )
}
