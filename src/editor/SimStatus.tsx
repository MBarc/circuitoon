// The simulation's status under the toolbar (spec 6.1): determinate progress while the engine
// first loads, and a banner naming a failure (with the engine's text in a details disclosure) while
// the last good readings stay up, dimmed and marked stale.
import { type EditorState, type EditorStore, useEditorState } from './store.ts'

/** The Simulate toggle's state, as a mark (data-sim-phase) and as words. */
export function simPhase({ simulate, sim }: Pick<EditorState, 'simulate' | 'sim'>): { mark: 'off' | 'loading' | 'solving' | 'done' | 'failed'; text: string } {
  if (!simulate) return { mark: 'off', text: 'Off' }
  if (!sim || sim.phase === 'solving') return { mark: 'solving', text: 'Simulating' }
  if (sim.phase === 'loading') return { mark: 'loading', text: 'Simulating' }
  const s = sim.outcome.status
  return s === 'ok' ? { mark: 'done', text: 'Solved' } : { mark: 'failed', text: s === 'failed' ? 'Could not solve' : 'Simulator unavailable' }
}

export function SimStatus({ store }: { store: EditorStore }) {
  const { simulate, sim } = useEditorState(store)
  if (!simulate || !sim) return null
  if (sim.phase === 'loading') {
    const pct = Math.round((100 * sim.loaded) / Math.max(1, sim.total))
    return (
      <section className="sim-status loading" role="status" aria-label="Loading the simulator">
        <strong>Loading the simulator</strong>
        <progress max={sim.total} value={sim.loaded} aria-label="Simulator download" />
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
        <span>Check the connection and turn Simulate on again.</span>
        <button type="button" className="tool small" onClick={() => store.setSimulate(false)}>Turn Simulate off</button>
        <details>
          <summary>What went wrong</summary>
          <pre>{o.reason}</pre>
        </details>
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
