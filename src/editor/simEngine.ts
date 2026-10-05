// The simulator's compute side for the editor, loaded with import() the first time Simulate is
// turned on, so the circuit builder, the SPICE compiler, the findings and the engine host stay out
// of the main bundle (spec 8). One browser engine for the page; a session per Simulate period.
import type { Diagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { createBrowserEngineHost } from '../sim/engine/browserEngine.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { RUN_TIMEOUT_MS } from '../sim/engine/host.ts'
import type { Circuit } from '../sim/model.ts'
import type { SimOutcome } from '../sim/results.ts'
import { SimSession } from '../sim/session.ts'
import { SIM_TIMEOUT_KEY } from './simulation.ts'

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
/** The page's one engine; its worker is spawned on the first solve. */
export function browserEngine(): Engine {
  engine ??= makeEngine(createBrowserEngineHost({ timeoutMs: timeout, onProgress: (l, t) => listeners.forEach((f) => f(l, t)) }))
  return engine
}

/** A session on the page's engine, with the engine's load progress while it lasts; stop() ends both. */
export function startSession(onOutcome: (o: SimOutcome, c?: Circuit) => void, onProgress: (loaded: number, total: number) => void) {
  listeners.add(onProgress)
  const session = new SimSession(browserEngine(), onOutcome)
  return {
    request: (d: Diagram, revision: number, held: { part: string; group: string } | null) => session.request(d, revision, { held, library: libraryLookup }),
    stop: () => {
      session.stop()
      listeners.delete(onProgress)
    },
  }
}
