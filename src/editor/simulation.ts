// The editor's simulation (spec 6.1): the engine and the session load the first time Simulate is
// turned on (simEngine.ts, a lazy chunk), with determinate progress; a session per Simulate
// period; a solve on every connectivity, value or probe change, never on a pure move (the key
// ignores positions), and never per drag frame (the drop solves); results for older revisions or
// after Simulate is turned off are dropped by the session. Glow and readings are never saved.
import { useEffect, useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { netlist } from '../format/netlist.ts'
import type { RunPins } from '../format/simState.ts'
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
const netKeys = new WeakMap<object, { parts: unknown; key: string }>()
/** The connectivity part of the key, cached by the diagram's connections and parts (firmware spec 4.1: per-sample keys stay cheap). */
function netsKey(d: Diagram): string {
  const hit = netKeys.get(d.connections)
  if (hit && hit.parts === d.parts) return hit.key
  const key = JSON.stringify(netlist(d).nets)
  netKeys.set(d.connections, { parts: d.parts, key })
  return key
}
const NO_RUN = { pins: {}, moving: [] as string[], seq: {} }

/** What decides a solve: connectivity (mounts included), values, settings, module identity, probes, a held button, run pin states, moving servos and each board's code sequence. Never positions, never frequencies. */
export function solveKey(d: Diagram, held: unknown, run: { pins: RunPins; moving: string[]; seq: Record<string, number> } = NO_RUN): string {
  return JSON.stringify([
    netsKey(d),
    d.parts.map((p) => [p.uid, p.module, p.values ?? null, p.settings ?? null]),
    Object.entries(d.modules).map(([k, m]) => [k, idOf(m)]).sort(),
    d.probes ?? null,
    held,
    run.pins,
    run.moving,
    run.seq,
  ])
}

/**
 * Calls `request` now and after every store change that changes the solve key, except on drag frames
 * (the drop solves), unless a button is pressed or released (a still part drag) or a running board's
 * pins changed (firmware spec 2.1: run-state solves continue during drags). Returns the unsubscribe.
 */
export function followStore(store: EditorStore, request: (d: Diagram, held: EditorState['held'], run: { pins: RunPins; moving: string[]; seq: Record<string, number> }) => void): () => void {
  let key = ''
  // The inputs last keyed: an unchanged diagram (a selection, a highlight) skips the netlist.
  let seen: unknown[] | null = null
  const check = () => {
    const { diagram: d, held, simulate, run } = store.getState()
    if (!simulate) return
    const now = [d.parts, d.connections, d.modules, d.probes, held, run.pins, run.moving, run.seq]
    const runMoved = !seen || now[5] !== seen[5] || now[6] !== seen[6] || now[7] !== seen[7]
    // A press and its release both solve, even mid-drag (the release may come before the drop).
    if (store.dragging && !held && !seen?.[4] && !runMoved) return
    if (seen && now.every((x, i) => x === seen![i])) return
    seen = now
    const next = solveKey(d, held, run)
    if (next === key) return
    key = next
    request(d, held, { pins: run.pins, moving: run.moving, seq: run.seq })
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
          (outcome, circuit, runSeq) => store.setSim({ phase: 'done', outcome, circuit: circuit ?? null, runSeq }),
          (loaded, total) => store.getState().sim?.phase !== 'done' && store.setSim({ phase: 'loading', loaded, total }),
        )
        let revision = 0
        // Running mode (spec 2.4) while any board starts or runs.
        const running = () => session.setRunning(store.activeRuns.length > 0)
        const unRunning = store.subscribe(running)
        running()
        const unsubscribe = followStore(store, (d, held, run) => session.request(d, ++revision, held, run))
        stop = () => {
          session.stop()
          unsubscribe()
          unRunning()
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
