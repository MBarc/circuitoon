// Engine (spec 2): run(c, analysis, revision) compiles the circuit, runs the text on the worker
// host and maps the vectors back; runAll sends several analyses (a solve's two corners) in one
// worker message. A circuit with nothing driven needs no engine run.
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
  /** Several analyses of one circuit in one worker round trip: one outcome each, up to and including the first that is not ok. */
  runAll(c: Circuit, analyses: Analysis[], revision: number): Promise<RunOutcome[]>
  dispose(): void
}

export function makeEngine(host: EngineHost): Engine {
  const runAll = async (c: Circuit, analyses: Analysis[], revision: number): Promise<RunOutcome[]> => {
    const compiled = analyses.map((a) => compile(c, classifyCached(c, a), a))
    // Only the texts that need the engine go to the worker; an empty circuit reads as solved.
    const texts = compiled.filter((x) => !x.empty).map((x) => x.text)
    const answers = texts.length ? await host.runTexts(texts) : []
    const out: RunOutcome[] = []
    let next = 0
    for (const x of compiled) {
      if (x.empty) {
        out.push({ status: 'ok', revision, raw: x.read({}), ms: 0 })
        continue
      }
      const r = answers[next++]
      if (!r) break
      if (r.status === 'unavailable') return [...out, r]
      if (r.status === 'failed') return [...out, { status: 'failed', revision, error: r.error, nodes: x.nodesIn(r.error) }]
      out.push({ status: 'ok', revision, raw: x.read(r.vectors), ms: r.ms })
    }
    return out
  }
  return {
    host,
    init: () => host.init(),
    run: async (c, a, revision) => (await runAll(c, [a], revision))[0],
    runAll,
    dispose: () => host.dispose(),
  }
}
