// First screen of the editor: start a new diagram, open one from a file, or try the sample.
import { useRef, useState } from 'react'
import { type Diagram, emptyDiagram } from '../format/diagram.ts'
import { buttonLed, captions } from '../samples/buttonLed.ts'
import { Sheet } from '../render/Sheet.tsx'
import { readDiagramFile } from './files.ts'

export function StartScreen({ onOpen }: { onOpen: (d: Diagram, notice?: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function open(file: File) {
    const r = await readDiagramFile(file)
    if (!r.ok) return setError(r.message)
    onOpen(r.diagram, r.warnings.length ? `Opened with warnings: ${r.warnings.slice(0, 3).join('; ')}` : undefined)
  }

  return (
    <div className="start">
      <header className="start-bar">
        <a className="wordmark" href="#/">Circuitoon</a>
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
            onDragLeave={() => setDragOver(false)}
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
            <Sheet diagram={buttonLed} captions={captions} box={{ x: 20, y: -6, w: 480, h: 212 }} label="Sample sheet preview" />
            <strong>Try the sample</strong>
            <span>A battery, button, resistor and LED, ready to rearrange.</span>
          </button>
        </div>
        {error && <p className="start-error" role="alert">{error}</p>}
        <p className="hint">Diagrams are not saved in the browser yet. Use Export JSON in the editor to keep your work.</p>
      </main>
    </div>
  )
}
