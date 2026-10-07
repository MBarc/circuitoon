// The code dock (firmware spec 6.1, 6.4; mockup option B): under the sheet, resizable (its height is
// remembered), collapsible to a 28 px bar that still shows each board's status. One tab per board
// with code, plus the selected board's while its code is being written. Left: the code editor (a lazy
// chunk); right: Serial. One Run/Stop button whose name follows the state (changes are announced
// politely), Reset, Upload, Download and the language. Run all and Stop all with two or more coded
// boards. Code that came in a link asks once before it runs (spec 2.6).
import { Suspense, lazy, useRef, useState } from 'react'
import { LANGUAGE_EXT, LANGUAGE_NAMES, type PartCode, languagesOf } from '../format/code.ts'
import { withLibraryData } from '../format/simModel.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { downloadName, readCodeFile } from './codeFile.ts'
import { downloadText } from './files.ts'
import { setPartCode } from './ops.ts'
import { codeBoards, runAction, runBlocker } from './running.ts'
import { SerialPanel } from './SerialPanel.tsx'
import { type BoardRunView, type EditorState, type EditorStore, useEditorState } from './store.ts'
import './codeDock.css'

const CodeEditor = lazy(() => import('./CodeEditor.tsx'))
const STATUS_TEXT = { idle: 'Not running', starting: 'Starting', running: 'Running', error: 'Error', changed: 'Code changed', stopped: 'Stopped', done: 'Finished' } as const
type StatusKey = keyof typeof STATUS_TEXT
const MIN_HEIGHT = 120
const maxHeight = () => Math.round(window.innerHeight * 0.7)
const clampHeight = (h: number) => Math.min(maxHeight(), Math.max(MIN_HEIGHT, h))

export function tabStatus(b: BoardRunView | undefined, code: PartCode | undefined): { key: StatusKey; text: string } {
  const live = b?.status === 'starting' || b?.status === 'running'
  const key: StatusKey = live && code && b!.source !== code.source ? 'changed' : ((b?.status ?? 'idle') as StatusKey)
  return { key, text: STATUS_TEXT[key] }
}

/** The tabs (spec 6.1): every board with code, plus the dock's own tab when it is a board being written. */
export function dockTabs(s: EditorState): string[] {
  const tabs = codeBoards(s)
  const t = s.dock.tab
  if (t && !tabs.includes(t) && s.diagram.parts.some((p) => p.uid === t)) tabs.push(t)
  return tabs
}

const Chevron = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 12 8" aria-hidden="true">
    <path d={up ? 'M1.5 6.5 6 2l4.5 4.5' : 'M1.5 1.5 6 6l4.5-4.5'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function CodeDock({ store }: { store: EditorStore }) {
  const s = useEditorState(store)
  const tabs = dockTabs(s)
  const [goto, setGoto] = useState<{ line: number; at: number } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [asking, setAsking] = useState<'run' | 'runAll' | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const uid = tabs.includes(s.dock.tab ?? '') ? s.dock.tab! : (tabs[0] ?? null)
  // A traceback jump, a refused upload and the link question belong to the board shown in this
  // opening of the dock: switching tabs or collapsing drops them, so a remounted editor never
  // grabs focus for an old jump (it would pull focus out of the tablist).
  const view = `${uid}:${s.dock.open}`
  const [shown, setShown] = useState(view)
  if (shown !== view) {
    setShown(view)
    setGoto(null)
    setRefused(null)
    setAsking(null)
  }
  if (!uid) return null
  const part = s.diagram.parts.find((p) => p.uid === uid)!
  const stored = s.diagram.modules[part.module]
  const m = stored && withLibraryData(stored, libraryLookup)
  const language = part.code?.language ?? languagesOf(m)[0] ?? 'python-rpi'
  const b = s.run.boards[uid]
  const st = tabStatus(b, part.code)
  const live = b?.status === 'starting' || b?.status === 'running'
  const blocker = live ? null : runBlocker(s, uid)
  const many = codeBoards(s).length >= 2
  const run = () => {
    if (live) return runAction(store, 'stop', uid)
    if (s.linkCode) return setAsking('run')
    runAction(store, 'run', uid)
  }
  // Clamped here too: a height saved in a taller window must not leave a short one without a sheet.
  const height = s.dock.open ? clampHeight(s.dock.height) : 28
  return (
    <section id="code-dock" className="code-dock" data-dock-open={s.dock.open} style={{ height }} aria-label="Code">
      <div
        className="code-dock-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the code dock"
        aria-valuenow={Math.round(height)}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maxHeight()}
        tabIndex={s.dock.open ? 0 : -1}
        onPointerDown={(e) => {
          if (!s.dock.open) return
          drag.current = { y: e.clientY, h: height }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => drag.current && store.setDock({ height: clampHeight(drag.current.h + drag.current.y - e.clientY) })}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowUp' ? 20 : e.key === 'ArrowDown' ? -20 : 0
          if (!step) return
          e.preventDefault()
          store.setDock({ height: clampHeight(height + step) })
        }}
      />
      <div className="code-dock-bar">
        <div
          role="tablist"
          aria-label="Boards with code"
          className="code-dock-tabs"
          onKeyDown={(e) => {
            // A proper tablist (spec 6.4): arrows, Home and End select and focus the neighbour; only the selected tab is in the Tab order.
            const i = tabs.indexOf(uid)
            const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
            if (to < 0) return
            e.preventDefault()
            store.setDock({ tab: tabs[to] })
            e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[to]?.focus()
          }}
        >
          {tabs.map((t) => {
            const p = s.diagram.parts.find((x) => x.uid === t)!
            const ts = tabStatus(s.run.boards[t], p.code)
            const name = s.diagram.modules[p.module]?.name ?? p.module
            return (
              <button key={t} type="button" role="tab" aria-selected={t === uid} aria-controls={s.dock.open ? 'code-dock-body' : undefined} tabIndex={t === uid ? 0 : -1} data-dock-tab={t} data-status={ts.key} className="code-dock-tab" title={`${p.designator} ${name} ${p.code?.file ?? 'main.py'}, ${ts.text}`} onClick={() => store.setDock({ tab: t, open: true })}>
                <span className={`code-dot ${ts.key}`} aria-hidden="true" />
                <span className="code-tab-name">{p.designator}</span>
                <span className="code-tab-board">{name}</span>
                <span className="code-tab-file">{p.code?.file ?? 'main.py'}</span>
                <span className="sr-only">, {ts.text}</span>
              </button>
            )
          })}
        </div>
        {many && s.dock.open && (
          <div className="code-dock-all">
            <button type="button" className="tool small" onClick={() => (s.linkCode ? setAsking('runAll') : runAction(store, 'runAll'))}>Run all</button>
            <button type="button" className="tool small" onClick={() => runAction(store, 'stopAll')}>Stop all</button>
          </div>
        )}
        <button type="button" className="code-dock-collapse" aria-expanded={s.dock.open} aria-controls="code-dock-body" title="Ctrl+`" onClick={() => store.setDock({ open: !s.dock.open })}>
          <Chevron up={!s.dock.open} />
          <span className="code-dock-collapse-text">{s.dock.open ? 'Collapse' : 'Expand'}</span>
        </button>
      </div>
      {s.dock.open && (
        <div id="code-dock-body" className="code-dock-body" role="tabpanel" aria-label={`${part.designator} code`}>
          <div className="code-pane">
            <div className="code-toolbar">
              <button type="button" className={`tool run-button ${live ? 'stop' : ''}`} data-run={uid} aria-label={live ? `Stop ${part.designator}'s code` : `Run ${part.designator}'s code`} disabled={!live && !!blocker} title={blocker ?? undefined} onClick={run}>
                <svg viewBox="0 0 12 12" aria-hidden="true">{live ? <rect x="2" y="2" width="8" height="8" rx="1.5" /> : <path d="M3 1.8v8.4L10.2 6z" />}</svg>
                {live ? 'Stop' : 'Run'}
              </button>
              <button type="button" className="tool small" disabled={!live && b?.status !== 'error' && b?.status !== 'stopped' && b?.status !== 'done'} onClick={() => runAction(store, 'reset', uid)}>Reset</button>
              <span className="code-toolbar-sep" aria-hidden="true" />
              <button type="button" className="tool small" onClick={() => upload.current?.click()}>Upload</button>
              <input
                ref={upload}
                type="file"
                hidden
                accept={(LANGUAGE_EXT[language] ?? []).join(',')}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const r = readCodeFile(f.name, new Uint8Array(await f.arrayBuffer()), language)
                  setRefused(r.ok ? null : r.why)
                  if (r.ok) store.commit(setPartCode(store.getState().diagram, uid, r.code))
                }}
              />
              <button type="button" className="tool small" disabled={!part.code} onClick={() => part.code && downloadText(downloadName(part.code, part.designator), part.code.source, 'text/x-python')}>Download</button>
              <span className={`code-status ${st.key}`} role="status" aria-live="polite">
                <span className={`code-dot ${st.key}`} aria-hidden="true" />
                {st.key === 'changed' ? 'Code changed: Reset to apply' : st.text}
              </span>
              {/* Outside the live region, so download progress is not announced on every step. */}
              {st.key === 'starting' && (
                <span className="code-progress">
                  {b?.progress ? (
                    <>
                      <progress max={b.progress.total} value={b.progress.loaded} aria-label="Python download" />
                      <span className="code-progress-pct">{Math.round((100 * b.progress.loaded) / Math.max(1, b.progress.total))}%</span>
                    </>
                  ) : (
                    <progress aria-label="Python download" />
                  )}
                </span>
              )}
            </div>
            {asking && (
              <div className="code-confirm" role="alertdialog" aria-label="Run code from a link" aria-describedby="code-confirm-text">
                <p id="code-confirm-text">This code came with the link. Run runs it in your browser, with no access to other sites.</p>
                <div className="code-confirm-actions">
                  <button type="button" className="tool small primary" autoFocus onClick={() => (setAsking(null), store.confirmLinkCode(), runAction(store, asking, uid))}>Run</button>
                  <button type="button" className="tool small" onClick={() => setAsking(null)}>Cancel</button>
                </div>
              </div>
            )}
            {(refused || b?.message || blocker) && <p className="code-message" role="alert">{refused ?? b?.message ?? blocker}</p>}
            <Suspense fallback={<div className="code-editor loading"><p className="hint">Loading the editor.</p></div>}>
              <CodeEditor
                key={uid}
                value={part.code?.source ?? ''}
                label={`${part.designator} code`}
                goto={goto}
                onChange={(v) => {
                  const d = store.getState().diagram
                  const now = d.parts.find((p) => p.uid === uid)?.code
                  store.commit(setPartCode(d, uid, { language, source: v, ...(now?.file ? { file: now.file } : {}) }), `code:${uid}`)
                }}
              />
            </Suspense>
            <div className="code-foot">
              <p className="hint code-help">Tab indents. Press Escape, then Tab, to leave the editor.</p>
              <span className="code-language">{LANGUAGE_NAMES[language] ?? language}</span>
            </div>
          </div>
          <SerialPanel store={store} uid={uid} onGoto={(line) => setGoto({ line, at: Date.now() })} />
        </div>
      )}
    </section>
  )
}
