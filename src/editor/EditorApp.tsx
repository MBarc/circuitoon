import { useState } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { StartScreen } from './StartScreen.tsx'
import { Editor } from './Editor.tsx'

export function EditorApp() {
  const [doc, setDoc] = useState<{ diagram: Diagram; warnings?: string[]; key: number } | null>(null)
  if (!doc) return <StartScreen onOpen={(diagram, warnings) => setDoc({ diagram, warnings, key: Date.now() })} />
  return <Editor key={doc.key} initial={doc.diagram} warnings={doc.warnings} onClose={() => setDoc(null)} />
}
