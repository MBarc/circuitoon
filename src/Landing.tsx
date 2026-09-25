import { useState } from 'react'
import { library, type LibraryEntry } from './library.ts'
import { Part, partBounds } from './render/Part.tsx'
import { Sheet } from './render/Sheet.tsx'
import { buttonLed, captions } from './samples/buttonLed.ts'
import { isSpacer } from './format/module.ts'
import { downloadText } from './editor/files.ts'

const REPO = 'https://github.com/MBarc/circuitoon'

function PartCard({ entry }: { entry: LibraryEntry }) {
  const [open, setOpen] = useState(false)
  if (!entry.ok)
    return (
      <article className="card card-error">
        <h3>{entry.file}</h3>
        <p>This file isn't a valid module:</p>
        <ul>{entry.errors.map((e) => <li key={e}><code>{e}</code></li>)}</ul>
      </article>
    )
  const m = entry.module
  const b = partBounds(m)
  const pad = 16
  const pinCount = m.pins.filter((p) => !isSpacer(p)).length
  return (
    <article className="card">
      <svg
        className="preview" viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`}
        role="img" aria-label={`${m.name} drawing`}
      >
        <Part module={m} />
      </svg>
      <div className="card-body">
        <h3>{m.name}</h3>
        <p className="meta">{m.category ?? 'Uncategorized'}, {pinCount} {pinCount === 1 ? 'pin' : 'pins'}</p>
        <div className="actions">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide JSON' : 'Show JSON'}
          </button>
          <button type="button" onClick={() => downloadText(entry.file, JSON.stringify(entry.raw, null, 2) + '\n')}>Download JSON</button>
        </div>
        {open && <pre className="json">{JSON.stringify(entry.raw, null, 2)}</pre>}
      </div>
    </article>
  )
}

export function Landing() {
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="./" aria-label="Circuitoon home">Circuitoon</a>
        <nav className="top-links">
          <a className="gh" href="#/editor">Open the editor</a>
          <a className="gh" href={REPO}>Source on GitHub</a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-text">
            <h1>Wiring diagrams you can drag around.</h1>
            <p>
              Circuitoon turns parts and pins into a clean wiring sheet. Drop modules on the page, wire pin to pin,
              and the wires follow when you move things.
            </p>
            <p className="status">
              Early build. The editor works for placing parts and drawing wires; saving in the browser, the art studio
              and PDF export come next.
            </p>
            <p><a className="cta" href="#/editor">Open the editor</a></p>
          </div>
          <figure className="sticker">
            <Sheet diagram={buttonLed} captions={captions} box={{ x: 20, y: -6, w: 480, h: 212 }} label="Sample sheet: a 9 volt battery, push button, 220 ohm resistor and red LED wired in a loop" />
            <figcaption>{buttonLed.title}. Wire thickness follows gauge: the orange wire is 24 AWG, the rest 22 AWG.</figcaption>
          </figure>
        </section>

        <section className="parts-library" aria-labelledby="lib-h">
          <div className="section-head">
            <h2 id="lib-h">Parts library</h2>
            <p>
              Each part is one JSON file in the <a href={`${REPO}/tree/main/modules`}><code>modules</code> folder</a>: a
              name, its pins, and which side each pin sits on. Pins on a side appear in list order.
            </p>
          </div>
          <div className="grid">
            {library.map((e) => <PartCard key={e.file} entry={e} />)}
          </div>
        </section>
      </main>
      <footer>
        <p>Circuitoon is open source. <a href={REPO}>View the code and the product plan on GitHub.</a></p>
      </footer>
    </>
  )
}
