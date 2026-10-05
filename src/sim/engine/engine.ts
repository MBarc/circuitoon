// Engine (spec 2): run(c, analysis, revision) compiles the circuit, runs the text on the worker
// host and maps the vectors back. A circuit with nothing driven needs no engine run.
import type { Analysis, Circuit } from '../model.ts'
import { classifyCached } from '../floating.ts'
import { type RawRun, compile } from '../spice.ts'
import type { EngineHost, EngineInfo } from './host.ts'

export type RunOutcome =
  | { status: 'ok'; revision: number; raw: RawRun; ms: number }
  | { status: 'failed'; revision: number; error: string; nodes: string[] }
  | { status: 'unavailable'; reason: string }

export interface Engine {
  host: EngineHost
  init(): Promise<EngineInfo>
  run(c: Circuit, a: Analysis, revision: number): Promise<RunOutcome>
  dispose(): void
}

export function makeEngine(host: EngineHost): Engine {
  return {
    host,
    init: () => host.init(),
    async run(c, a, revision) {
      const compiled = compile(c, classifyCached(c), a)
      if (compiled.empty) return { status: 'ok', revision, raw: compiled.read({}), ms: 0 }
      const r = await host.runText(compiled.text)
      if (r.status === 'unavailable') return r
      if (r.status === 'failed') return { status: 'failed', revision, error: r.error, nodes: compiled.nodesIn(r.error) }
      return { status: 'ok', revision, raw: compiled.read(r.vectors), ms: r.ms }
    },
    dispose: () => host.dispose(),
  }
}
