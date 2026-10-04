// First screen of the editor: start a new diagram, open one from a file, or try the sample.
import { useRef, useState } from 'react'
import { type Diagram, emptyDiagram } from '../format/diagram.ts'
import { buttonLed, captions } from '../samples/buttonLed.ts'
import { Sheet } from '../render/Sheet.tsx'
import { readDiagramFile } from './files.ts'
import { ThemeSwitch } from '../ThemeSwitch.tsx'

export function StartScreen({ onOpen, notice = null, busy = false }: { onOpen: (d: Diagram, warnings?: string[]) => void; notice?: string | null; busy?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function open(file: File) {
    const r = await readDiagramFile(file)
    if (!r.ok) return setError(r.message)
    onOpen(r.diagram, r.warnings)
  }

  return (
    <div className="start">
      <header className="start-bar">
        <a className="wordmark" href="#/">Circuitoon</a>
        <ThemeSwitch />
      </header>
      <main className="start-main">
        <h1>Start a wiring sheet</h1>
        <div className="start-options">
          <button type="button" className="start-card" onClick={() => onOpen(emptyDiagram())}>
            <span className="start-icon" aria-hidden="true">+</span>
            <strong>New diagram</strong>
            <span>A blank sheet. Drag parts on from the library.</span>
          </button>
          <div
            className={dragOver ? 'start-card drop over' : 'start-card drop'}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) void open(f)
            }}
          >
            <span className="start-icon" aria-hidden="true">{'↑'}</span>
            <strong>Open a diagram</strong>
            <span>Drop a <code>.circuitoon.json</code> file here, or</span>
            <button type="button" className="tool" onClick={() => fileRef.current?.click()}>Choose file</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void open(f)
                e.target.value = ''
              }}
            />
          </div>
          <button type="button" className="start-card sample" onClick={() => onOpen(structuredClone(buttonLed))}>
            <Sheet diagram={buttonLed} captions={captions} box={{ x: 20, y: -6, w: 480, h: 212 }} label="Sample sheet preview" decorative />
            <strong>Try the sample</strong>
            <span>A battery, button, resistor and LED, ready to rearrange.</span>
          </button>
        </div>
        {busy && <p className="hint" role="status">Opening the linked diagram...</p>}
        {(error ?? notice) && <p className="start-error" role="alert">{error ?? notice}</p>}
        <p className="hint">Diagrams are not saved in the browser yet. Use Export JSON in the editor to keep your work.</p>
      </main>
    </div>
  )
}
