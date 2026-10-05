// The simulation's status under the toolbar (spec 6.1): determinate progress while the engine
// first loads, and a banner naming a failure (with the engine's text in a details disclosure) while
// the last good readings stay up, dimmed and marked stale.
import { type EditorStore, useEditorState } from './store.ts'

export function SimStatus({ store }: { store: EditorStore }) {
  const { simulate, sim } = useEditorState(store)
  if (!simulate || !sim) return null
  if (sim.phase === 'loading') {
    const pct = Math.round((100 * sim.loaded) / Math.max(1, sim.total))
    return (
      <section className="sim-status loading" role="status" aria-label="Loading the simulator">
        <strong>Loading the simulator</strong>
        <progress max={sim.total} value={sim.loaded} aria-label={`${pct} percent`} />
        <span className="sim-pct">{pct} %</span>
      </section>
    )
  }
  if (sim.phase !== 'done') return null
  const o = sim.outcome
  if (o.status === 'unavailable')
    return (
      <section className="sim-status failed" role="alert">
        <strong>The simulator could not load.</strong>
        <span>{o.reason}</span>
        <button type="button" className="tool small" onClick={() => store.setSimulate(false)}>Turn Simulate off</button>
      </section>
    )
  if (o.status === 'failed')
    return (
      <section className="sim-status failed" role="alert">
        <strong>The simulation could not be solved.</strong>
        <span>{o.finding.message}</span>
        {o.lastGood && <span className="sim-note">The readings shown are stale (from before your last edit).</span>}
        {o.finding.raw && (
          <details>
            <summary>What the simulator said</summary>
            <pre>{o.finding.raw}</pre>
          </details>
        )}
      </section>
    )
  return null
}
