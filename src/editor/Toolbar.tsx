import { useRef, useState } from 'react'
import { type EditorStore, useEditorState } from './store.ts'
import type { Diagram } from '../format/diagram.ts'
import { deleteSelection, EMPTY_SELECTION, rotateParts } from './ops.ts'
import { isProblem, severityCounts, useProblems } from './problems.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { emptyDiagram, serializeDiagram } from '../format/diagram.ts'
import { BOM_FILE, EXPORT_SUFFIX, KICAD_FILE, defaultBaseName, downloadText, readDiagramFile, saveWithPicker, type SavePicker } from './files.ts'
import { type KicadExport, toKicadNetlist } from '../format/kicad.ts'
import { modulesById } from '../library.ts'
import { BomPanel } from './BomPanel.tsx'
import { type Bom, bomCsv } from '../format/bom.ts'
import { ExportDialog } from './ExportDialog.tsx'
import { LoadWarnings } from './LoadWarnings.tsx'
import { MAINS_NOTICE, hasMains, withSheetNotes } from '../format/mains.ts'
import { ThemeSwitch } from '../ThemeSwitch.tsx'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function Toolbar({ store, warnings, onClose }: { store: EditorStore; warnings?: string[]; onClose: () => void }) {
  const { diagram, selection, snapObjects } = useEditorState(store)
  const fileRef = useRef<HTMLInputElement>(null)
  // The sheet the user agreed to replace when they chose Import, and the latest import request.
  const importBase = useRef<Diagram | null>(null)
  const importSeq = useRef(0)
  const [error, setError] = useState<string | null>(null)
  // The file name base last chosen on Export for the open sheet, offered next time; the in-app
  // naming dialog, when the browser has no Save As dialog, is open while this holds its first name.
  const lastName = useRef<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  // The Bill of materials panel, the base name last chosen for its CSV, and its naming dialog.
  const [bomOpen, setBomOpen] = useState(false)
  const lastBomName = useRef<string | null>(null)
  const [namingBom, setNamingBom] = useState<{ base: string; text: string } | null>(null)
  // The base name last chosen for the KiCad netlist, its naming dialog, and what the last export reported.
  const lastKicadName = useRef<string | null>(null)
  const [namingKicad, setNamingKicad] = useState<{ base: string; x: KicadExport } | null>(null)
  const [kicadNotice, setKicadNotice] = useState<{ name: string; summary: string; check: string[]; attention: boolean } | null>(null)
  // Warnings the open sheet was loaded with; every one stays reachable until dismissed.
  const [loadWarnings, setLoadWarnings] = useState<{ list: string[]; key: number } | null>(warnings?.length ? { list: warnings, key: 0 } : null)
  const hasSel = selection.parts.length + selection.wires.length + (selection.annotations?.length ?? 0) > 0
  // The badge counts problems only: a note (a parallel battery bank) is not one.
  const findings = useProblems(store).filter(isProblem)
  const errors = findings.filter((f) => f.severity === 'error').length
  const mains = hasMains(diagram)

  /** True when there is nothing to lose, or the user agrees to discard it. */
  const okToDiscard = () => !store.dirty || window.confirm(`Discard unsaved changes to ${diagram.title}?`)

  /** A new or imported sheet starts with its own file name again. */
  function loaded() {
    lastName.current = null
    lastKicadName.current = null
    setError(null)
    setKicadNotice(null)
  }

  const exportText = () => serializeDiagram(withSheetNotes(store.getState().diagram))

  /**
   * Export JSON: the browser's own Save As dialog where there is one (showSaveFilePicker), else the
   * in-app naming dialog, then a download. Cancelling either saves nothing.
   */
  async function exportJson() {
    const base = defaultBaseName(store.getState().diagram.title, lastName.current)
    const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker) {
      const r = await saveWithPicker(picker.bind(window), base, exportText())
      if (r.status === 'saved') {
        lastName.current = r.base
        setError(null)
        store.markSaved()
      }
      if (r.status === 'failed') setError(r.message)
      if (r.status !== 'unavailable') return
    }
    setNaming(base)
  }

  /**
   * Export CSV (the Bill of materials panel): the same Save As dialog or in-app naming dialog as
   * Export JSON, named `<base>-bom.csv`, where the base is the one last chosen for the bill, else
   * the sheet's export name.
   */
  async function exportBom(bom: Bom) {
    const text = bomCsv(bom)
    const base = defaultBaseName(store.getState().diagram.title, lastBomName.current ?? lastName.current)
    const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker) {
      const r = await saveWithPicker(picker.bind(window), base, text, BOM_FILE)
      if (r.status === 'saved') {
        lastBomName.current = r.base
        setError(null)
      }
      if (r.status === 'failed') setError(r.message)
      if (r.status !== 'unavailable') return
    }
    setNamingBom({ base, text })
  }

  /** Says what the KiCad export saved, and what needs a look in KiCad (its warnings, then its notes). */
  function kicadSaved(name: string, x: KicadExport) {
    setKicadNotice({ name, summary: `${plural(x.components, 'footprint')}, ${plural(x.nets, 'net')}`, check: [...x.warnings, ...x.notes], attention: x.warnings.length > 0 })
  }

  /**
   * Export KiCad: the sheet as a KiCad netlist (`<base>.net`), through the same Save As dialog or
   * in-app naming dialog as Export JSON. A sheet saved before a part had a KiCad footprint takes the
   * library's.
   */
  async function exportKicad() {
    const d = store.getState().diagram
    const x = toKicadNetlist(d, { library: (id) => (Object.hasOwn(modulesById, id) ? modulesById[id] : undefined) })
    const base = defaultBaseName(d.title, lastKicadName.current ?? lastName.current)
    const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker) {
      const r = await saveWithPicker(picker.bind(window), base, x.text, KICAD_FILE)
      if (r.status === 'saved') {
        lastKicadName.current = r.base
        setError(null)
        kicadSaved(r.base + KICAD_FILE.suffix, x)
      }
      if (r.status === 'failed') setError(r.message)
      if (r.status !== 'unavailable') return
    }
    setNamingKicad({ base, x })
  }

  async function importFile(file: File) {
    const seq = ++importSeq.current
    const base = importBase.current
    const r = await readDiagramFile(file)
    // A newer import has started since this one; its result wins.
    if (seq !== importSeq.current) return
    if (!r.ok) return setError(r.message)
    // The sheet was edited while the file was being read: ask again before replacing that work.
    const now = store.getState().diagram
    if (now !== base && store.dirty && !window.confirm(`Discard unsaved changes to ${now.title}?`)) return
    store.load(r.diagram)
    loaded()
    setLoadWarnings(r.warnings.length ? { list: r.warnings, key: seq } : null)
  }

  return (
    <header className="toolbar">
      <button type="button" className="wordmark" onClick={() => okToDiscard() && onClose()} title="Back to the start screen">Circuitoon</button>
      <span className="title" title={diagram.title}>{diagram.title}</span>
      <ThemeSwitch />
      <button type="button" className="tool" disabled={!store.canUndo} onClick={() => store.undo()}>Undo</button>
      <button type="button" className="tool" disabled={!store.canRedo} onClick={() => store.redo()}>Redo</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" disabled={!selection.parts.length} onClick={() => store.commit(rotateParts(diagram, selection.parts))}>Rotate</button>
      <button type="button" className="tool" disabled={!hasSel} onClick={() => store.commit(deleteSelection(diagram, selection))}>Delete</button>
      <span className="sep" aria-hidden="true" />
      <button
        type="button"
        className="tool toggle"
        aria-pressed={snapObjects}
        title="While dragging, line up with other parts' edges and centers, wired pins and equal gaps. Hold Ctrl (Cmd on a Mac) to drag without it."
        onClick={() => store.setSnapObjects(!snapObjects)}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <rect x="4" y="2.5" width="9" height="5" rx="1.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.4" />
          <rect x="4" y="10.5" width="12" height="5" rx="1.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.4" />
          <path className="snap-line" d="M4 0.5V17.5" stroke="var(--guide)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Snap to objects
      </button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" onClick={() => {
        if (!okToDiscard()) return
        store.load(emptyDiagram())
        loaded()
        setLoadWarnings(null)
      }}>New sheet</button>
      <button type="button" className="tool" onClick={() => {
        if (!okToDiscard()) return
        importBase.current = store.getState().diagram
        fileRef.current?.click()
      }}>Import JSON</button>
      <button type="button" className="tool" aria-haspopup="dialog" onClick={() => void exportJson()}>Export JSON</button>
      <button type="button" className="tool" aria-haspopup="dialog" title="Save the sheet as a KiCad netlist (.net) for KiCad's PCB Editor: File > Import > Netlist" onClick={() => void exportKicad()}>Export KiCad</button>
      <button type="button" className="tool" aria-haspopup="dialog" onClick={() => setBomOpen(true)}>Bill of materials</button>
      {findings.length > 0 && (
        <button
          type="button"
          className={`tool problems-badge ${errors ? 'error' : 'warning'}`}
          title="Show the wiring problems in the side panel"
          aria-label={`${findings.length === 1 ? '1 problem' : `${findings.length} problems`}: ${severityCounts(findings)}. Show them in the side panel`}
          onClick={() => {
            // With nothing selected the side panel lists them; move focus to that list.
            store.select(EMPTY_SELECTION)
            requestAnimationFrame(() => document.getElementById('problems-title')?.focus())
          }}
        >
          <SeverityMark severity={errors ? 'error' : 'warning'} />
          {findings.length === 1 ? '1 problem' : `${findings.length} problems`}
        </button>
      )}
      {mains && <span className="mains-badge" role="note" title={MAINS_NOTICE} aria-label={MAINS_NOTICE}>Mains: drawn connections only</span>}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importFile(f)
          e.target.value = ''
        }}
      />
      {error && <p className="message error" role="alert">{error}</p>}
      {kicadNotice && (
        <section className={`kicad-notice${kicadNotice.attention ? ' attention' : ''}`} role="status" aria-label="KiCad export">
          <p className="kn-head">
            <strong>Saved {kicadNotice.name}</strong>
            <span>{kicadNotice.summary}. In KiCad's PCB Editor: File &gt; Import &gt; Netlist.</span>
          </p>
          <button type="button" className="tool" onClick={() => setKicadNotice(null)}>Dismiss</button>
          {kicadNotice.check.length > 0 && (
            <>
              <p className="kn-check">{kicadNotice.attention ? 'Check in KiCad:' : 'Good to know in KiCad:'}</p>
              <ul className="kn-list">{kicadNotice.check.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}
        </section>
      )}
      {loadWarnings && <LoadWarnings key={loadWarnings.key} warnings={loadWarnings.list} onDismiss={() => setLoadWarnings(null)} />}
      {mains && <p className="print-notice">{MAINS_NOTICE}</p>}
      {naming !== null && (
        <ExportDialog
          initial={naming}
          onCancel={() => setNaming(null)}
          onExport={(base) => {
            setNaming(null)
            lastName.current = base
            downloadText(base + EXPORT_SUFFIX, exportText())
            store.markSaved()
          }}
        />
      )}
      {namingKicad !== null && (
        <ExportDialog
          title="Export KiCad netlist"
          kind={KICAD_FILE}
          initial={namingKicad.base}
          onCancel={() => setNamingKicad(null)}
          onExport={(base) => {
            lastKicadName.current = base
            downloadText(base + KICAD_FILE.suffix, namingKicad.x.text, 'text/plain')
            kicadSaved(base + KICAD_FILE.suffix, namingKicad.x)
            setNamingKicad(null)
          }}
        />
      )}
      {bomOpen && <BomPanel diagram={diagram} onClose={() => setBomOpen(false)} onExport={(bom) => void exportBom(bom)} />}
      {namingBom !== null && (
        <ExportDialog
          title="Export CSV"
          kind={BOM_FILE}
          initial={namingBom.base}
          onCancel={() => setNamingBom(null)}
          onExport={(base) => {
            lastBomName.current = base
            downloadText(base + BOM_FILE.suffix, namingBom.text, 'text/csv')
            setNamingBom(null)
          }}
        />
      )}
    </header>
  )
}
