import { useState } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { StartScreen } from './StartScreen.tsx'
import { Editor } from './Editor.tsx'

export function EditorApp() {
  const [doc, setDoc] = useState<{ diagram: Diagram; notice?: string; key: number } | null>(null)
  if (!doc) return <StartScreen onOpen={(diagram, notice) => setDoc({ diagram, notice, key: Date.now() })} />
  return <Editor key={doc.key} initial={doc.diagram} notice={doc.notice} onClose={() => setDoc(null)} />
}
