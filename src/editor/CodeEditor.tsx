// The code editor (firmware spec 6.1, 6.4): CodeMirror 6 with Python highlighting, line numbers and
// both themes (token colours are CSS, codeDock.css), in a lazy chunk (spec 9: at most 150 KB gzip).
// Tab indents; Escape then Tab leaves the editor (CodeMirror's own tab-focus mode: after Escape, Tab
// moves focus for two seconds), as the dock's help text says. Changes from outside (undo on the
// sheet, an upload) replace the text; `goto` moves the cursor to a line.
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'

export default function CodeEditor({ value, onChange, label, goto }: { value: string; onChange: (v: string) => void; label: string; goto: { line: number; at: number } | null }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  // True while the text is replaced from outside, so that replacement is not reported back as an edit.
  const outside = useRef(false)
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(), indentOnInput(), bracketMatching(),
          syntaxHighlighting(classHighlighter), python(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => u.docChanged && !outside.current && change.current(u.state.doc.toString())),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // The view is made once; value updates arrive through the effect below (the dock keys it by board).
  }, [])
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    outside.current = true
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    outside.current = false
  }, [value])
  useEffect(() => {
    const v = view.current
    if (!v || !goto) return
    const line = v.state.doc.line(Math.min(Math.max(1, goto.line), v.state.doc.lines))
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    v.focus()
  }, [goto])
  return <div ref={host} className="code-editor" />
}
