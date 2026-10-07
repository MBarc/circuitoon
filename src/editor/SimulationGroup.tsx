// The "Simulation (current state)" group (spec 2.1, 6.3): the simulation's findings in their own
// group after the checker's, errors first, each with Select (its parts, panned into view); the
// "not powered: SW1 is open" warnings for one switch are one row (ruling R30, as the CLI folds it);
// notes below. Hovering or focusing a row lights its parts and pins. After a failed solve it lists
// the failure and the findings decided before solving, and says the sheet's readings are stale.
import { useEffect } from 'react'
import { foldNotPowered, RUN_TITLES, SIM_TITLES } from '../sim/display.ts'
import type { RunFinding } from '../run/core.ts'
import type { SimFinding } from '../sim/results.ts'
import { SeverityMark } from './SeverityMark.tsx'
import { currentFindings } from './SimLayer.tsx'
import { type EditorStore, useEditorState } from './store.ts'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const RANK = { error: 0, warning: 1, note: 2 } as const

export function SimulationGroup({ store }: { store: EditorStore }) {
  const { sim, diagram, run } = useEditorState(store)
  // The canvas light belongs to this list too: it goes out when the group does.
  useEffect(() => () => store.setHighlight(null), [store])
  const o = sim?.phase === 'done' ? sim.outcome : undefined
  const findings = [...currentFindings(o)].sort((a, b) => RANK[a.severity] - RANK[b.severity])
  const groups = foldNotPowered(findings).map((g) => ({
    ...g,
    head: g.members[0],
    parts: [...new Set(g.members.flatMap((f) => f.parts))],
    pins: g.members.flatMap((f) => f.pins ?? []),
  }))
  const problems = groups.filter((g) => g.head.severity !== 'note')
  const hasProblems = problems.length > 0 || run.findings.length > 0
  const notes = groups.filter((g) => g.head.severity === 'note')
  const errors = problems.filter((g) => g.head.severity === 'error').length
  const runFindings = run.findings
  const warnings = problems.reduce((n, g) => n + (g.head.severity === 'warning' ? g.members.length : 0), 0) + runFindings.length
  const status = !o
    ? 'Solving the current state.'
    : o.status === 'unavailable'
      ? 'The simulator could not load. These were found before solving.'
      : o.status === 'failed'
        ? `The current state could not be solved.${o.lastGood ? ' The readings on the sheet are stale (from before your last edit).' : ''}`
        : null
  const refs = (parts: string[]) => parts.map((uid) => diagram.parts.find((p) => p.uid === uid)?.designator ?? uid).join(', ')
  const light = (g: (typeof groups)[number]) =>
    store.setHighlight({ severity: g.head.severity === 'note' ? 'info' : g.head.severity, parts: g.parts, pins: g.pins, wires: [] })
  const row = (g: (typeof groups)[number], i: number) => {
    const f: SimFinding = g.head
    const sev = f.severity === 'note' ? 'info' : f.severity
    return (
      <li
        key={`${f.code}-${i}`}
        className={sev}
        data-sim-finding={f.code}
        onMouseEnter={() => light(g)}
        onFocus={() => light(g)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) store.setHighlight(null)
        }}
      >
        <SeverityMark severity={sev} />
        <div className="problem-text">
          <span className="problem-title">
            <span className="sr-only">{f.severity === 'error' ? 'Error: ' : f.severity === 'warning' ? 'Warning: ' : 'Note: '}</span>
            {SIM_TITLES[f.code]}
            {g.members.length > 1 && <span className="sim-fold"> ({g.members.length})</span>}
          </span>
          <span className="problem-message" id={`sim-message-${i}`}>{g.message.charAt(0).toUpperCase() + g.message.slice(1)}</span>
        </div>
        {g.parts.length > 0 && (
          <div className="problem-actions">
            <button
              type="button"
              className="tool small"
              aria-label={`Select ${refs(g.parts)}, ${SIM_TITLES[f.code].toLowerCase()}`}
              aria-describedby={`sim-message-${i}`}
              onClick={() => {
                store.setHighlight(null)
                store.select({ parts: g.parts, wires: [] })
                store.reveal()
                requestAnimationFrame(() => document.getElementById('selection-title')?.focus())
              }}
            >
              Select
            </button>
          </div>
        )}
      </li>
    )
  }
  // Run-time findings (firmware spec 4.3): already one per pin per run (RunFinding.key), shown as warnings.
  const runRow = (f: RunFinding, i: number) => {
    const parts = f.parts
    const light = () => store.setHighlight({ severity: 'warning', parts: f.parts, pins: f.pins, wires: [] })
    return (
      <li
        key={f.key}
        className="warning"
        data-run-finding={f.code}
        onMouseEnter={light}
        onFocus={light}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) store.setHighlight(null)
        }}
      >
        <SeverityMark severity="warning" />
        <div className="problem-text">
          <span className="problem-title">
            <span className="sr-only">Warning: </span>
            {RUN_TITLES[f.code]}
          </span>
          <span className="problem-message" id={`run-message-${i}`}>{f.message.charAt(0).toUpperCase() + f.message.slice(1)}</span>
        </div>
        {parts.length > 0 && (
          <div className="problem-actions">
            <button
              type="button"
              className="tool small"
              aria-label={`Select ${refs(parts)}, ${RUN_TITLES[f.code].toLowerCase()}`}
              aria-describedby={`run-message-${i}`}
              onClick={() => {
                store.setHighlight(null)
                store.select({ parts, wires: [] })
                store.reveal()
                requestAnimationFrame(() => document.getElementById('selection-title')?.focus())
              }}
            >
              Select
            </button>
          </div>
        )}
      </li>
    )
  }
  return (
    <section className={`problems sim-group ${errors ? 'has-errors' : hasProblems ? 'has-warnings' : 'clean'}`} aria-labelledby="sim-title" data-sim-group="">
      <h3 id="sim-title" tabIndex={-1}>
        {o?.status === 'ok' && !hasProblems && <SeverityMark severity="ok" />}
        Simulation (current state)
        {hasProblems && <span className="problems-count">{[errors && plural(errors, 'error'), warnings && plural(warnings, 'warning')].filter(Boolean).join(', ')}</span>}
      </h3>
      {status && <p className={`hint${o && o.status !== 'ok' ? ' warn' : ''}`}>{status}</p>}
      {o?.status === 'ok' && !hasProblems && <p className="hint">Nothing to report in the saved switch and GPIO state.</p>}
      {hasProblems && <ul onMouseLeave={() => store.setHighlight(null)}>{problems.map(row)}{runFindings.map(runRow)}</ul>}
      {notes.length > 0 && (
        <div className="problem-notes" role="group" aria-labelledby="sim-notes-title">
          <h4 id="sim-notes-title">
            Notes
            <span className="problems-count">{plural(notes.length, 'note')}</span>
          </h4>
          <ul onMouseLeave={() => store.setHighlight(null)}>{notes.map((g, i) => row(g, problems.length + i))}</ul>
        </div>
      )}
    </section>
  )
}
