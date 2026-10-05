// The editor's simulation (spec 6.1): one browser engine for the page, loaded the first time
// Simulate is turned on (with determinate progress); a session per Simulate period; a solve on
// every connectivity or value change, never on a pure move (the key ignores positions), and never
// per drag frame (the drop solves); results for older revisions or after Simulate is turned off are
// dropped by the session. Glow and readings are never saved.
import { useEffect, useSyncExternalStore } from 'react'
import type { Diagram } from '../format/diagram.ts'
import { netlist } from '../format/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { createBrowserEngineHost } from '../sim/engine/browserEngine.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { RUN_TIMEOUT_MS } from '../sim/engine/host.ts'
import { SimSession } from '../sim/session.ts'
import type { EditorState, EditorStore } from './store.ts'

/** A debug knob for the visual check (Task 38): a run timeout in ms, read before every run. Unset in normal use. */
export const SIM_TIMEOUT_KEY = 'circuitoon.simTimeoutMs'
const timeout = () => {
  try {
    const v = Number(localStorage.getItem(SIM_TIMEOUT_KEY))
    return v > 0 ? v : RUN_TIMEOUT_MS
  } catch {
    return RUN_TIMEOUT_MS
  }
}
let engine: Engine | null = null
const listeners = new Set<(loaded: number, total: number) => void>()
/** The page's one engine; its worker is spawned on the first solve, never at import. */
export function browserEngine(): Engine {
  engine ??= makeEngine(createBrowserEngineHost({ timeoutMs: timeout, onProgress: (l, t) => listeners.forEach((f) => f(l, t)) }))
  return engine
}

const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => {
  let v = ids.get(o)
  if (v === undefined) ids.set(o, (v = ++nextId))
  return v
}
/** What decides a solve: connectivity (mounts included), values, settings, module identity and a held button. Never positions. */
export function solveKey(d: Diagram, held: unknown): string {
  return JSON.stringify([
    netlist(d).nets,
    d.parts.map((p) => [p.uid, p.module, p.values ?? null, p.settings ?? null]),
    Object.entries(d.modules).map(([k, m]) => [k, idOf(m)]).sort(),
    held,
  ])
}

/**
 * Runs the simulation while Simulate is on. It follows the store through a subscription rather
 * than a render, so the Editor around it never re-renders on a drag frame.
 */
export function useSimulation(store: EditorStore): void {
  const simulate = useSyncExternalStore(store.subscribe, () => store.getState().simulate)
  useEffect(() => {
    if (!simulate) return
    const onProgress = (loaded: number, total: number) => {
      if (store.getState().sim?.phase !== 'done') store.setSim({ phase: 'loading', loaded, total })
    }
    listeners.add(onProgress)
    const session = new SimSession(browserEngine(), (outcome, circuit) => store.setSim({ phase: 'done', outcome, circuit: circuit ?? null }))
    let revision = 0
    let key = ''
    // The inputs last keyed: an unchanged diagram (a selection, a highlight) skips the netlist.
    let seen: [unknown, unknown, unknown, EditorState['held']] | null = null
    const check = () => {
      const { diagram: d, held, simulate: on } = store.getState()
      // Never per drag frame: the drop solves. A held button (a still part drag) is the exception.
      if (!on || (store.dragging && !held)) return
      if (seen && seen[0] === d.parts && seen[1] === d.connections && seen[2] === d.modules && seen[3] === held) return
      seen = [d.parts, d.connections, d.modules, held]
      const next = solveKey(d, held)
      if (next === key) return
      key = next
      session.request(d, ++revision, { held, library: libraryLookup })
    }
    const unsubscribe = store.subscribe(check)
    store.setSim({ phase: 'solving' })
    check()
    return () => {
      session.stop()
      unsubscribe()
      listeners.delete(onProgress)
      if (store.getState().sim) store.setSim(null)
    }
  }, [simulate, store])
}
