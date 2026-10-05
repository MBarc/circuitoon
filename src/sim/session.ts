// The solve loop the editor and the CLI share (spec 2): build the circuit, run the typical and peak
// corners (2 engine runs), and assemble the SimResult. SimSession keeps at most one solve in flight
// and one pending (a newer request replaces the pending one); a result for an older revision, or
// one that arrives after stop(), is discarded; a failure carries the last good result.
import type { Diagram, Probe } from '../format/diagram.ts'
import { type BuildOptions, buildCircuit } from './build.ts'
import type { Engine } from './engine/engine.ts'
import { classifyCached } from './floating.ts'
import { analyseFindings, noConvergence } from './findings.ts'
import type { Circuit, Corner } from './model.ts'
import { type SimOutcome, type SimResult, budget, probeReadings, readRun } from './results.ts'
import type { RawRun } from './spice.ts'

/** BuildOptions (held group, library) plus probes beyond the diagram's saved ones (the CLI's). */
export interface SolveOptions extends BuildOptions { probes?: Probe[] }

export async function solve(d: Diagram, engine: Engine, revision: number, opts: SolveOptions = {}): Promise<{ outcome: SimOutcome; circuit: Circuit }> {
  const c = buildCircuit(d, opts)
  const cls = classifyCached(c, { kind: 'op' })
  const raws = {} as Record<Corner, RawRun>
  const before = engine.host.runs
  let ms = 0
  for (const corner of ['typical', 'peak'] as const) {
    const r = await engine.run(c, { kind: 'op', corner }, revision)
    if (r.status === 'unavailable') return { circuit: c, outcome: { status: 'unavailable', reason: r.reason } }
    if (r.status === 'failed') return { circuit: c, outcome: { status: 'failed', revision, finding: noConvergence(c, r.error, r.nodes) } }
    raws[corner] = r.raw
    ms += r.ms
  }
  const { findings, outside } = analyseFindings(c, cls, raws)
  const corners = { typical: readRun(c, cls, raws.typical, outside), peak: readRun(c, cls, raws.peak, outside) }
  const info = engine.host.info
  const result: SimResult = {
    format: 'circuitoon-sim/1',
    revision,
    corners,
    budget: budget(c, cls, raws, outside),
    findings,
    unsimulated: c.unsimulated,
    probes: probeReadings([...(d.probes ?? []), ...(opts.probes ?? [])], c, corners),
    unaccounted: c.unaccounted,
    notes: c.notes,
    engine: { name: 'ngspice', version: info?.version ?? '', build: info?.build ?? '', runs: engine.host.runs - before, ms },
  }
  return { circuit: c, outcome: { status: 'ok', result } }
}

export class SimSession {
  private engine: Engine
  private onOutcome: (o: SimOutcome, c: Circuit) => void
  private pending: { d: Diagram; revision: number; opts: SolveOptions } | null = null
  private running = false
  private latest = 0
  private stopped = false
  private lastGood: { revision: number; result: SimResult } | null = null

  constructor(engine: Engine, onOutcome: (o: SimOutcome, c: Circuit) => void) {
    this.engine = engine
    this.onOutcome = onOutcome
  }

  request(d: Diagram, revision: number, opts: SolveOptions = {}): void {
    if (this.stopped) return
    this.latest = revision
    this.pending = { d, revision, opts }
    if (!this.running) void this.loop()
  }

  private async loop(): Promise<void> {
    this.running = true
    try {
      while (this.pending && !this.stopped) {
        const job = this.pending
        this.pending = null
        const { outcome, circuit } = await solve(job.d, this.engine, job.revision, job.opts)
        if (this.stopped || job.revision !== this.latest) continue
        if (outcome.status === 'ok') this.lastGood = { revision: job.revision, result: outcome.result }
        this.onOutcome(outcome.status === 'failed' && this.lastGood ? { ...outcome, lastGood: this.lastGood } : outcome, circuit)
      }
    } finally {
      // A throwing solve must not wedge the session: the next request starts a fresh loop.
      this.running = false
    }
  }

  stop(): void {
    this.stopped = true
    this.pending = null
  }
}
