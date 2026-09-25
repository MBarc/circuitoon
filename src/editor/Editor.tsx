import { useMemo } from 'react'
import { EditorStore } from './store.ts'
import { Canvas } from './Canvas.tsx'
import { buttonLed } from '../samples/buttonLed.ts'
import './editor.css'

export function Editor() {
  // Opens on the sample sheet so the first view shows what the editor does.
  const store = useMemo(() => new EditorStore(structuredClone(buttonLed)), [])
  return (
    <div className="editor">
      <header className="toolbar">
        <a className="wordmark" href="#/">Circuitoon</a>
      </header>
      <aside className="library" aria-label="Parts library" />
      <Canvas store={store} />
      <aside className="inspector" aria-label="Properties" />
    </div>
  )
}
