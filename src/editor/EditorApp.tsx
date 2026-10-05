// The editor route: the start screen or an open sheet. A link (#/editor?d=...) opens its diagram;
// the payload then leaves the address bar with history.replaceState, which fires no hashchange, and
// App keys on the route, so nothing remounts and the open document stays.
import { useEffect, useRef, useState } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { openLinkPayload, payloadFromHash } from '../format/link.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { StartScreen } from './StartScreen.tsx'
import { Editor } from './Editor.tsx'

type Doc = { diagram: Diagram; warnings?: string[]; key: number }

/** Back to `#/editor`, keeping the path and query, without a navigation. */
function clearPayload() {
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/editor`)
}

export function EditorApp() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const docRef = useRef<Doc | null>(null)
  docRef.current = doc
  const dirty = useRef(false)

  useEffect(() => {
    let seq = 0
    const check = () => {
      const payload = payloadFromHash(location.hash)
      if (payload === null) return
      const mine = ++seq
      setOpening(true)
      void openLinkPayload(payload, libraryLookup).then((r) => {
        if (mine !== seq) return
        setOpening(false)
        clearPayload()
        if (!r.ok) {
          // With a sheet open the start screen's error line is not visible, so say it in a dialog.
          if (docRef.current) window.alert(r.message)
          else setLinkError(r.message)
          return
        }
        const open = docRef.current
        if (open && dirty.current && !window.confirm(`Discard unsaved changes to ${open.diagram.title} and open the linked diagram?`)) return
        dirty.current = false
        setLinkError(null)
        setDoc({ diagram: r.diagram, warnings: r.warnings, key: Date.now() })
      })
    }
    check()
    window.addEventListener('hashchange', check)
    return () => {
      seq++
      window.removeEventListener('hashchange', check)
    }
  }, [])

  if (!doc)
    return (
      <StartScreen
        notice={linkError}
        busy={opening}
        onOpen={(diagram, warnings) => {
          setLinkError(null)
          setDoc({ diagram, warnings, key: Date.now() })
        }}
      />
    )
  return (
    <Editor
      key={doc.key}
      initial={doc.diagram}
      warnings={doc.warnings}
      onClose={() => setDoc(null)}
      onDirty={(v) => {
        dirty.current = v
      }}
    />
  )
}
