// Serial (firmware spec 5.3, 6.1, 6.4): one board's output, newest at the bottom (it follows the end
// unless scrolled up), errors in the error colour, the simulator's notes set apart, typed lines
// echoed; the input box while input() waits; Clear. The log itself is not live; a visually hidden
// polite region announces new lines at most once a second. A traceback's `File "blink.py", line 12`
// is a button that moves the editor to that line.
import { useEffect, useRef, useState } from 'react'
import { createAnnouncer, lineRef } from './codeFile.ts'
import { runAction } from './running.ts'
import { type EditorStore, useEditorState } from './store.ts'

export function SerialPanel({ store, uid, onGoto }: { store: EditorStore; uid: string; onGoto: (line: number) => void }) {
  const { run } = useEditorState(store)
  const b = run.boards[uid]
  const lines = b?.serial ?? []
  const file = b?.file ?? 'main.py'
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [said, setSaid] = useState('')
  const latest = useRef({ lines, total: b?.serialSeq ?? lines.length })
  latest.current = { lines, total: b?.serialSeq ?? lines.length }
  const announcer = useRef<ReturnType<typeof createAnnouncer> | undefined>(undefined)
  const [entry, setEntry] = useState('')
  useEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])
  // At most one announcement a second (spec 6.4): a throttle, one timer that new lines do not restart.
  useEffect(() => {
    announcer.current = createAnnouncer(() => latest.current, setSaid)
    return () => announcer.current?.stop()
  }, [uid])
  useEffect(() => announcer.current?.poke(), [lines])
  return (
    <section className="serial" aria-labelledby={`serial-${uid}`}>
      <div className="serial-head">
        <h3 id={`serial-${uid}`}>Serial</h3>
        <button type="button" className="tool small" disabled={!lines.length} onClick={() => store.setBoardRun(uid, { serial: [] })}>Clear</button>
      </div>
      <div
        ref={log}
        className="serial-log"
        role="log"
        aria-live="off"
        tabIndex={0}
        aria-label="Serial output"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
        }}
      >
        {!lines.length && <p className="serial-empty">Output from print() shows here.</p>}
        {lines.map((l, i) => {
          const ref = l.stream === 'err' ? lineRef(l.text, file) : null
          return (
            <div key={i} className={`serial-line ${l.stream}`}>
              {ref ? (
                <>
                  {ref.before}
                  <button type="button" className="serial-ref" onClick={() => onGoto(ref.line)}>{ref.ref}</button>
                  {ref.after}
                </>
              ) : (
                l.text
              )}
            </div>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite">{said}</p>
      {b?.prompt !== null && b?.prompt !== undefined && (
        <form
          className="serial-input"
          onSubmit={(e) => {
            e.preventDefault()
            runAction(store, 'line', uid, entry)
            setEntry('')
          }}
        >
          <label htmlFor={`serial-in-${uid}`}>{b.prompt.trim() || 'The code is waiting for input'}</label>
          <input id={`serial-in-${uid}`} autoFocus autoComplete="off" value={entry} onChange={(e) => setEntry(e.target.value)} />
          <button type="submit" className="tool small">Send</button>
        </form>
      )}
    </section>
  )
}
