// The editor's simulation (spec 6.1): the engine and the session load the first time Simulate is
// turned on (simEngine.ts, a lazy chunk), with determinate progress; a session per Simulate
// period; a solve on every connectivity, value or probe change, never on a pure move (the key
// ignores positions), and never per drag frame (the drop solves); results for older revisions or
// after Simulate is turned off are dropped by the session. Glow and readings are never saved.
import { useEffect, useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { netlist } from '../format/netlist.ts'
import type { EditorState, EditorStore } from './store.ts'

/** A debug knob for the visual check (Task 38): a run timeout in ms, read before every run. Unset in normal use. */
export const SIM_TIMEOUT_KEY = 'circuitoon.simTimeoutMs'

const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => {
  let v = ids.get(o)
  if (v === undefined) ids.set(o, (v = ++nextId))
  return v
}
/** What decides a solve: connectivity (mounts included), values, settings, module identity, probes and a held button. Never positions. */
export function solveKey(d: Diagram, held: unknown): string {
  return JSON.stringify([
    netlist(d).nets,
    d.parts.map((p) => [p.uid, p.module, p.values ?? null, p.settings ?? null]),
    Object.entries(d.modules).map(([k, m]) => [k, idOf(m)]).sort(),
    d.probes ?? null,
    held,
  ])
}

/**
 * Calls `request` now and after every store change that changes the solve key, except on drag
 * frames (the drop solves) unless a button is pressed or released (a still part drag). Returns the unsubscribe.
 */
export function followStore(store: EditorStore, request: (d: Diagram, held: EditorState['held']) => void): () => void {
  let key = ''
  // The inputs last keyed: an unchanged diagram (a selection, a highlight) skips the netlist.
  let seen: unknown[] | null = null
  const check = () => {
    const { diagram: d, held, simulate } = store.getState()
    // A press and its release both solve, even mid-drag (the release may come before the drop).
    if (!simulate || (store.dragging && !held && !seen?.[4])) return
    const now = [d.parts, d.connections, d.modules, d.probes, held]
    if (seen && now.every((x, i) => x === seen![i])) return
    seen = now
    const next = solveKey(d, held)
    if (next === key) return
    key = next
    request(d, held)
  }
  const unsubscribe = store.subscribe(check)
  check()
  return unsubscribe
}

/**
 * Runs the simulation while Simulate is on. It follows the store through a subscription rather
 * than a render, so the Editor around it never re-renders on a drag frame.
 */
export function useSimulation(store: EditorStore): void {
  const simulate = useSyncExternalStore(store.subscribe, () => store.getState().simulate)
  useEffect(() => {
    if (!simulate) return
    let cancelled = false
    let stop = () => {}
    store.setSim({ phase: 'solving' })
    import('./simEngine.ts').then(
      ({ startSession }) => {
        if (cancelled) return
        const session = startSession(
          (outcome, circuit) => store.setSim({ phase: 'done', outcome, circuit: circuit ?? null }),
          (loaded, total) => store.getState().sim?.phase !== 'done' && store.setSim({ phase: 'loading', loaded, total }),
        )
        let revision = 0
        const unsubscribe = followStore(store, (d, held) => session.request(d, ++revision, held))
        stop = () => {
          session.stop()
          unsubscribe()
        }
      },
      (e: unknown) => {
        if (!cancelled) store.setSim({ phase: 'done', circuit: null, outcome: { status: 'unavailable', reason: `the simulator's code could not load (${String(e)})`, findings: [] } })
      },
    )
    return () => {
      cancelled = true
      stop()
      if (store.getState().sim) store.setSim(null)
    }
  }, [simulate, store])
}
