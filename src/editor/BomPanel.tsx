// The Bill of materials view: a modal sticker card, like Export JSON's naming dialog, listing what the
// sheet takes to build (the bill `circuitoon bom` and the gate write, from the same function): parts
// grouped by module and value with their designators, wires by cable, gauge and colour, and
// connectors. Each wire row shows a short length of that wire. Export CSV saves the bill through the
// browser's Save As dialog where there is one, else names it in the editor's own dialog. Escape
// and Close close it.
import { useEffect, useId, useMemo, useRef } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { wireColor, wireStripe, wireWidth } from '../format/diagram.ts'
import { type Bom, type BomPart } from '../format/bom.ts'
import { sheetBom } from '../agent/tables.ts'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A short straight length of the wire, in its colour and at its gauge's thickness, with its stripe, on sheet paper. */
function WireSample({ color, gauge }: { color: string; gauge: number }) {
  const w = wireWidth(gauge) * 1.6
  const stripe = wireStripe(color)
  return (
    <svg className="bom-wire" viewBox="0 0 44 12" aria-hidden="true">
      <line x1="4" y1="6" x2="40" y2="6" stroke="#23282F" strokeWidth={w + 2.4} strokeLinecap="round" />
      <line x1="4" y1="6" x2="40" y2="6" stroke={wireColor(color)} strokeWidth={w} strokeLinecap="round" />
      {stripe && <line x1="4" y1="6" x2="40" y2="6" stroke={stripe} strokeWidth={w * 0.45} strokeDasharray="4 4" />}
    </svg>
  )
}

function Added({ count, added }: { count: number; added: number }) {
  if (!added) return null
  return <span className="bom-tag" title="The layout added these to carry nets between parts">{added === count ? 'added by layout' : `${added} added by layout`}</span>
}

function PartRow({ p }: { p: BomPart }) {
  const [first] = p.source
  return (
    <tr>
      <td className="bom-qty">{p.count}</td>
      <td>
        <span className="bom-name">{p.name}</span>
        {p.value && <span className="bom-value">{p.value}</span>}
        <Added count={p.count} added={p.added} />
        {p.custom && <span className="bom-tag warn">custom, unverified</span>}
      </td>
      <td className="bom-refs">{p.refs}</td>
      <td className="bom-muted bom-cat">{p.category ?? ''}</td>
      <td>
        {first ? (
          <a href={first} target="_blank" rel="noreferrer noopener" title={p.source.join('\n')}>
            Source{p.source.length > 1 ? ` (${p.source.length})` : ''}
          </a>
        ) : null}
      </td>
    </tr>
  )
}

export function BomTables({ bom }: { bom: Bom }) {
  const parts = bom.parts.reduce((n, p) => n + p.count, 0)
  const wires = bom.wires.reduce((n, w) => n + w.count, 0)
  return (
    <>
      <section aria-labelledby="bom-parts">
        <h3 id="bom-parts">Parts <span className="bom-count">{plural(parts, 'part')}</span></h3>
        {bom.parts.length ? (
          <table className="bom-table">
            <thead>
              <tr><th scope="col" className="bom-qty">Qty</th><th scope="col">Part</th><th scope="col">Designators</th><th scope="col" className="bom-cat">Category</th><th scope="col"><span className="sr-only">Source</span></th></tr>
            </thead>
            <tbody>{bom.parts.map((p) => <PartRow key={`${p.module}|${p.value}`} p={p} />)}</tbody>
          </table>
        ) : <p className="hint">No parts yet: drag one from the library onto the sheet.</p>}
      </section>
      <section aria-labelledby="bom-wires">
        <h3 id="bom-wires">Wires <span className="bom-count">{plural(wires, 'wire')}</span></h3>
        {bom.wires.length ? (
          <table className="bom-table">
            <thead>
              <tr><th scope="col" className="bom-qty">Qty</th><th scope="col">Cable</th><th scope="col">Gauge</th><th scope="col">Color</th></tr>
            </thead>
            <tbody>
              {bom.wires.map((w) => (
                <tr key={`${w.cable}|${w.gauge}|${w.color}`}>
                  <td className="bom-qty">{w.count}</td>
                  <td><span className="bom-name">{w.cable}</span><Added count={w.count} added={w.added} /></td>
                  <td className="bom-muted">{w.gauge} AWG</td>
                  <td><span className="bom-color"><WireSample color={w.color} gauge={w.gauge} />{w.color}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">No wires yet.</p>}
      </section>
      {bom.connectors.length > 0 && (
        <section aria-labelledby="bom-connectors">
          <h3 id="bom-connectors">Connectors</h3>
          <table className="bom-table">
            <thead><tr><th scope="col" className="bom-qty">Qty</th><th scope="col">Connector</th></tr></thead>
            <tbody>{bom.connectors.map((c) => <tr key={c.kind}><td className="bom-qty">{c.count}</td><td>{c.name}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  )
}

export function BomPanel({ diagram, onExport, onClose }: { diagram: Diagram; onExport: (bom: Bom) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const bom = useMemo(() => sheetBom(diagram), [diagram])
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="bom-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header className="bom-head">
        <h2 id={titleId}>Bill of materials</h2>
        <p className="bom-sheet">{diagram.title}</p>
      </header>
      <div className="bom-body">
        <BomTables bom={bom} />
      </div>
      <div className="bom-actions">
        <p className="hint">Wires are counted in the color they are drawn in.</p>
        <button type="button" className="tool" onClick={onClose}>Close</button>
        <button type="button" className="tool primary" onClick={() => onExport(bom)} disabled={!bom.parts.length && !bom.wires.length}>Export CSV</button>
      </div>
    </dialog>
  )
}
