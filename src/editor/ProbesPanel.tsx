// The Probes panel (spec 6.2): in place of the inspector while the Probe tool is on. The readings
// (rename and delete), the Supplies table (each source, rail and domain: load against limit,
// typical and peak, headroom and provenance) with what each part's data leaves out, the parts not
// simulated and the estimates, and About the simulator (ruling R9: no dialog; the engine's own
// engine.json and NOTICE.txt, fetched when opened, so nothing about the build is hardcoded here).
// Imports from src/sim are types and the small probe ops only: the readings come in the result
// (SimResult.probes), so the compute code stays out of the main bundle.
import { useState } from 'react'
import { formatValue } from '../format/values.ts'
import { SIM_TITLES } from '../sim/display.ts'
import { removeProbe, renameProbe } from '../sim/probes.ts'
import type { CurrentReading, DomainBudget, Reading } from '../sim/results.ts'
import { CommitInput } from './Inspector.tsx'
import { partText, probeColor, readingText } from './ProbeLayer.tsx'
import { currentFindings, shownResult } from './SimLayer.tsx'
import { type EditorStore, useEditorState } from './store.ts'

const OUTSIDE = 'outside the model'
const sig = (x: number) => Number(x.toPrecision(3))
type Pair = { typical: CurrentReading | Reading; peak: CurrentReading | Reading }
const isOutside = (r: Pair) => [r.typical, r.peak].some((x) => x.kind === 'value' && x.trust === 'outside-model')
const KIND = { source: 'source', rail: 'rail output', domain: 'domain' } as const
const ampsText = (r: { typical: CurrentReading; peak: CurrentReading }) => {
  const one = (x: CurrentReading) => (x.kind === 'value' ? formatValue(sig(Math.abs(x.value)), 'A') : 'not solved')
  const [t, p] = [one(r.typical), one(r.peak)]
  return t === p ? t : `${t} (peak ${p})`
}

export interface SupplyRow { name: string; volts: string; load: string; own?: string; limit: string; headroom: string; basis: string; outside?: true }

/**
 * One Supplies row. The current column says what it measures: a source's is what it delivers (spec
 * 5.1), a rail's what its output delivers to loads, a domain's what passes through its pin (which
 * can be 0 on a pass-through VIN), with the part's own draw apart. Outside the model, no numbers.
 */
export function supplyRow(b: DomainBudget): SupplyRow {
  const outside = isOutside(b.volts) || isOutside(b.amps) || (b.ownDraw !== undefined && isOutside(b.ownDraw))
  const amps = ampsText(b.amps)
  const load = outside ? OUTSIDE : b.kind === 'source' ? `delivering ${amps}` : b.kind === 'domain' ? `through the pin ${amps}` : amps
  return {
    // A source's label already ends in "delivering" (results.ts); the current column says it.
    name: b.kind === 'source' ? b.label.replace(/ delivering$/, '') : b.label,
    volts: outside ? OUTSIDE : readingText(b.volts),
    load,
    ...(b.ownDraw && !outside ? { own: `own draw ${ampsText(b.ownDraw)}` } : {}),
    limit: b.limit && !outside ? formatValue(sig(b.limit.value), 'A') : '-',
    headroom: b.headroom !== undefined && !outside ? formatValue(sig(b.headroom), 'A') : '-',
    basis: b.basis,
    ...(outside ? { outside: true as const } : {}),
  }
}

/** The licence files NOTICE.txt names (they sit beside it), once each, in the order it names them. */
export function licenceFiles(notice: string): string[] {
  return [...new Set(notice.match(/LICENSE-[\w.-]+\.txt/g) ?? [])]
}

/**
 * A Supplies cell down the column, so the narrow table fits: what the current is ("delivering",
 * "through the pin", "own draw") as a small label, the typical value, then the peak, quieter.
 */
function cellLines(text: string) {
  const kind = /^(delivering|through the pin|own draw) (.*)$/.exec(text)
  const rest = kind ? kind[2] : text
  const m = /^(.*) \(peak (.*?)\)(.*)$/.exec(rest)
  return (
    <>
      {kind && <span className="kind">{kind[1]}</span>}
      <span className="typ">{m ? `${m[1]}${m[3]}` : rest}</span>
      {m && <span className="peak">peak {m[2]}</span>}
    </>
  )
}

/** A fetched notice's text, or '' when the server answered with something else (an HTML fallback page). */
export async function noticeText(r: { headers: { get(name: string): string | null }; text(): Promise<string> }): Promise<string> {
  const text = await r.text()
  const type = r.headers.get('content-type') ?? ''
  return type.startsWith('text/plain') || !text.trimStart().startsWith('<') ? text : ''
}

type About = { engine: { ngspice?: string; build?: string; release?: string } | null; notice: string | null }

export function ProbesPanel({ store }: { store: EditorStore }) {
  const { diagram, sim, simulate } = useEditorState(store)
  const outcome = simulate && sim?.phase === 'done' ? sim.outcome : undefined
  const shown = shownResult(outcome)
  const result = shown?.result
  const probes = diagram.probes ?? []
  const base = `${import.meta.env.BASE_URL}sim/`
  const [about, setAbout] = useState<About | null>(null)
  const ref = (uid: string) => diagram.parts.find((p) => p.uid === uid)?.designator ?? uid
  const refs = (uids: string[]) => uids.map(ref).join(', ')
  const notes = currentFindings(outcome).filter((f) => f.code === 'sim-incomplete' || f.code === 'sim-estimate')
  // The sim-incomplete note already names its parts; the rest of the unsimulated list gives each reason.
  const named = new Set(notes.flatMap((f) => (f.code === 'sim-incomplete' ? f.parts : [])))
  // One line per part, its reasons together (a port expander can leave several pins out).
  const byPart = new Map<string, string[]>()
  for (const u of result?.unsimulated ?? []) if (!named.has(u.part)) byPart.set(u.part, [...(byPart.get(u.part) ?? []), u.reason])
  const unsimulated = [...byPart].map(([part, reasons]) => ({ part, reasons: reasons.join('; ') }))
  const status = !simulate
    ? 'Turn on Simulate (S) to read them.'
    : !sim || sim.phase !== 'done'
      ? 'Solving the current state.'
      : shown?.stale
        ? 'The current state could not be solved. These readings are stale, from before your last edit.'
        : !shown
          ? 'No readings: the simulator could not solve this sheet.'
          : null
  // After a delete, focus goes to the next probe's Delete (now at the same place), else the heading.
  const remove = (id: string, i: number) => {
    store.commit(removeProbe(store.getState().diagram, id))
    requestAnimationFrame(() => (document.querySelectorAll<HTMLElement>('.probe-list .danger')[i] ?? document.getElementById('probes-heading'))?.focus())
  }
  const load = (open: boolean) => {
    if (!open || about) return
    setAbout({ engine: null, notice: null })
    const get = (file: string) => fetch(`${base}${file}`, { cache: 'no-cache' }).then((r) => (r.ok ? r : Promise.reject(new Error(`HTTP ${r.status}`))))
    void Promise.all([get('engine.json').then((r) => r.json() as Promise<About['engine']>).catch(() => ({})), get('NOTICE.txt').then(noticeText).catch(() => '')])
      .then(([engine, notice]) => setAbout({ engine, notice }))
  }
  return (
    <aside className={`inspector probes-panel${shown?.stale ? ' stale' : ''}`} aria-label="Probes">
      <h2 id="probes-heading" tabIndex={-1}>Probes</h2>
      <p className="hint">Click a pin, a breadboard hole, the end of a wire or a part to place a probe. P or Escape goes back to editing.</p>
      {status && <p className={`hint${shown?.stale || (sim?.phase === 'done' && !shown) ? ' warn' : ''}`} role="status">{status}</p>}
      {probes.length === 0 ? (
        <p className="hint">No probes yet.</p>
      ) : (
        <ul className="probe-list" aria-label="Probe readings">
          {probes.map((p, i) => {
            const r = result?.probes.find((x) => x.id === p.id)
            const where = p.at.pin !== undefined ? `${ref(p.at.part)} ${p.at.pin}` : ref(p.at.part)
            const typical = r?.voltage?.typical
            return (
              <li key={p.id} data-probe-row={p.id}>
                <span className="probe-chip" style={{ background: probeColor(p.id, i) }} aria-hidden="true" />
                <div className="probe-body">
                  <div className="probe-head">
                    <strong>{p.id}</strong>
                    <span className="probe-where">{where}</span>
                  </div>
                  <p className="probe-reading">
                    <span className="probe-value">{p.at.pin === undefined ? partText(r?.part) : readingText(r?.voltage, !!result?.pwm)}</span>
                    {shown?.stale && <span className="probe-stale"> (stale)</span>}
                  </p>
                  {typical?.kind === 'value' && <p className="hint probe-ref">to {typical.reference}</p>}
                  {p.at.pin === undefined && r?.part && Object.keys(r.part.typical.pins).length > 0 && (
                    <ul className="probe-pins" aria-label={`${p.id} current per pin`}>
                      {Object.entries(r.part.typical.pins).map(([pin, x]) => (
                        <li key={pin}>{pin}: {x.kind === 'value' ? `${formatValue(sig(Math.abs(x.value)), 'A')} ${x.value >= 0 ? 'in' : 'out'}` : 'not solved'}</li>
                      ))}
                    </ul>
                  )}
                  <CommitInput id={`probe-name-${p.id}`} label="Name" value={p.name ?? ''} onCommit={(name) => store.commit(renameProbe(store.getState().diagram, p.id, name))} />
                </div>
                <button type="button" className="tool small danger" aria-label={`Delete probe ${p.id}${p.name ? `, ${p.name}` : ''}`} onClick={() => remove(p.id, i)}>Delete</button>
              </li>
            )
          })}
        </ul>
      )}
      {result && result.budget.length > 0 && (
        <section className="supplies" aria-labelledby="supplies-title">
          <h3 id="supplies-title">Supplies</h3>
          {/* Focusable so a keyboard can scroll it sideways when it is wider than the panel. */}
          <div className="supplies-scroll" tabIndex={0} role="region" aria-labelledby="supplies-title">
            <table>
              <thead>
                <tr><th scope="col">Supply</th><th scope="col">Voltage</th><th scope="col">Current</th><th scope="col">Limit</th><th scope="col">Headroom</th><th scope="col">Basis</th></tr>
              </thead>
              <tbody>
                {result.budget.map((b) => {
                  const row = supplyRow(b)
                  return (
                    <tr key={b.id} className={row.outside ? 'outside' : undefined} data-supply={b.kind}>
                      <th scope="row">{row.name}<span className="sr-only">, {KIND[b.kind]}</span></th>
                      <td>{cellLines(row.volts)}</td>
                      <td>{cellLines(row.load)}{row.own && <span className="own-draw">{cellLines(row.own)}</span>}</td>
                      <td>{row.limit}</td>
                      <td className={row.headroom.startsWith('-') && row.headroom !== '-' ? 'over' : undefined}>{row.headroom}</td>
                      <td className={`basis ${row.basis}`}>{row.basis}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">Current is typical, then peak. A source's is what it delivers, a rail's what its output delivers to loads, a domain's what passes through its pin, with the part's own draw below it.</p>
          {result.unaccounted.length > 0 && (
            <div className="unaccounted">
              <h4>Not in the budget</h4>
              <ul>
                {result.unaccounted.map((u) => (
                  <li key={u.part}><strong>{ref(u.part)}</strong>
                    <ul>{u.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {(notes.length > 0 || unsimulated.length > 0 || (result?.notes.length ?? 0) > 0) && (
        <section className="sim-notes" aria-labelledby="probes-notes-title">
          <h3 id="probes-notes-title">Notes</h3>
          <ul>
            {notes.map((f, i) => (
              <li key={`${f.code}|${f.corner ?? ''}|${i}`}>
                <strong>{SIM_TITLES[f.code]}</strong>: {f.message}
                {f.code === 'sim-estimate' && f.parts.length > 0 && <span className="note-parts">Parts: {refs(f.parts)}</span>}
              </li>
            ))}
            {unsimulated.map((u) => <li key={`u-${u.part}`}><strong>{ref(u.part)}</strong> not simulated: {u.reasons}</li>)}
            {result?.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
          </ul>
        </section>
      )}
      <details className="about-sim" onToggle={(e) => load((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>About the simulator</summary>
        {!about?.notice && about?.engine === null && <p>Loading.</p>}
        {about?.engine && (
          <p>
            Circuitoon solves the sheet with ngspice {about.engine.ngspice ?? '(version unknown)'}{about.engine.build ? `, engine build ${about.engine.build}` : ''}, compiled to WebAssembly and run in your browser. Nothing is uploaded.
          </p>
        )}
        <h4>Running code</h4>
        <p>
          A Raspberry Pi's Python runs in your browser on Pyodide, with RPi.GPIO and most of gpiozero. Pins, PWM, servos and print() reach the simulation;
          I2C and SPI devices, serial ports and threads are not simulated yet. Callbacks do not run at the same time as each other: a callback that sleeps holds
          blink() and the others until it returns. A read can lag the circuit by one solve. gpiozero's Servo defaults to 1 to 2 ms pulses, so Servo.min() turns an
          SG90 to about 47 degrees, as on many real ones.
        </p>
        {about && about.engine !== null && about.notice === '' && <p className="hint warn">The licence notice could not be loaded. Open it from the link below.</p>}
        {about?.notice && <pre className="about-notice" tabIndex={0} aria-label="Licence notice">{about.notice}</pre>}
        <ul className="about-links">
          <li><a href={`${base}NOTICE.txt`} target="_blank" rel="noopener noreferrer">NOTICE.txt</a></li>
          {licenceFiles(about?.notice ?? '').map((f) => <li key={f}><a href={`${base}${f}`} target="_blank" rel="noopener noreferrer">{f}</a></li>)}
          {about?.engine?.release && <li><a href={about.engine.release} target="_blank" rel="noopener noreferrer">Engine source and build (release)</a></li>}
        </ul>
      </details>
    </aside>
  )
}
