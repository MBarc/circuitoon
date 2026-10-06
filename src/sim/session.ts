// The solve loop the editor and the CLI share (spec 2): build the circuit, run the typical and peak
// corners (2 engine runs; with PWM pins, every run of the plan, firmware spec 4.2), and assemble the
// SimResult. SimSession keeps at most one solve in flight and one pending (a newer request replaces the pending one); a result for an older revision, or
// one that arrives after stop(), is discarded; a failure carries the last good result.
import type { Diagram, Probe } from '../format/diagram.ts'
import { type BuildOptions, buildCircuit } from './build.ts'
import type { Engine } from './engine/engine.ts'
import { classifyCached } from './floating.ts'
import { analyseRuns, finalize, noConvergence, topologyFindings } from './findings.ts'
import type { Analysis, Circuit, Corner } from './model.ts'
import { mixRaws, pwmPlan } from './pwm.ts'
import { type SimOutcome, type SimResult, budget, probeReadings, readRun } from './results.ts'
import type { RawRun } from './spice.ts'

/** BuildOptions (held group, library) plus probes beyond the diagram's saved ones (the CLI's). */
export interface SolveOptions extends BuildOptions { probes?: Probe[] }

export async function solve(d: Diagram, engine: Engine, revision: number, opts: SolveOptions = {}): Promise<{ outcome: SimOutcome; circuit: Circuit }> {
  const c = buildCircuit(d, opts)
  const cls = classifyCached(c, { kind: 'op' })
  // Decided before the engine runs, so a failed or unavailable outcome still names a real short.
  const topo = topologyFindings(c, cls)
  // PWM pins (spec 4.2): the plan's typical runs and the two peak runs, every text in one runAll.
  const plan = pwmPlan(c)
  const typical: Analysis[] = plan ? plan.runs.map((pins) => ({ kind: 'op', corner: 'typical', pins })) : [{ kind: 'op', corner: 'typical' }]
  const peak: Analysis[] = plan ? plan.peak.map((pins) => ({ kind: 'op', corner: 'peak', pins })) : [{ kind: 'op', corner: 'peak' }]
  const analyses = [...typical, ...peak]
  const before = engine.host.runs
  let ms = 0
  const runs = await engine.runAll(c, analyses, revision)
  const got: RawRun[] = []
  for (const [i, a] of analyses.entries()) {
    const r = runs[i]
    if (!r) throw new Error(`the engine gave no answer for the ${a.corner} corner`)
    if (r.status === 'unavailable') return { circuit: c, outcome: { status: 'unavailable', reason: r.reason, findings: finalize(topo.drafts, '') } }
    if (r.status === 'failed') return { circuit: c, outcome: { status: 'failed', revision, finding: noConvergence(c, r.error, r.nodes), findings: finalize(topo.drafts, '') } }
    got.push(r.raw)
    ms += r.ms
  }
  const typRaws = got.slice(0, typical.length)
  const peakRaws = got.slice(typical.length)
  // Readings, glow and budget use the duty-weighted average; the peak corner reads the all-high run.
  const raws: Record<Corner, RawRun> = { typical: plan ? mixRaws(typRaws, plan.weights) : typRaws[0], peak: peakRaws[0] }
  const { findings, outside } = analyseRuns(c, cls, { typical: typRaws, peak: peakRaws }, topo, plan)
  const read = { typical: readRun(c, cls, raws.typical, outside), peak: readRun(c, cls, raws.peak, outside) }
  const info = engine.host.info
  const result: SimResult = {
    format: 'circuitoon-sim/1',
    revision,
    corners: read,
    budget: budget(c, cls, raws, outside),
    findings,
    unsimulated: c.unsimulated,
    probes: probeReadings([...(d.probes ?? []), ...(opts.probes ?? [])], c, read),
    unaccounted: c.unaccounted,
    notes: c.notes,
    engine: { name: 'ngspice', version: info?.version ?? '', build: info?.build ?? '', runs: engine.host.runs - before, ms },
    ...(plan ? { pwm: { pins: plan.pins.map((p) => ({ part: p.part, pin: p.pin, duty: p.duty })), runs: analyses.length, approximate: plan.approximate.length > 0 } } : {}),
  }
  return { circuit: c, outcome: { status: 'ok', result } }
}

/**
 * One Simulate-on period. `stop()` is permanent: a stopped session ignores every later request, so
 * the editor creates a new session each time Simulate is turned on.
 */
export class SimSession {
  private engine: Engine
  /** The circuit is absent when the solve threw before one was built. */
  private onOutcome: (o: SimOutcome, c?: Circuit) => void
  private pending: { d: Diagram; revision: number; opts: SolveOptions } | null = null
  private running = false
  private latest = 0
  private stopped = false
  private lastGood: { revision: number; result: SimResult } | null = null

  constructor(engine: Engine, onOutcome: (o: SimOutcome, c?: Circuit) => void) {
    this.engine = engine
    this.onOutcome = onOutcome
  }

  request(d: Diagram, revision: number, opts: SolveOptions = {}): void {
    if (this.stopped) return
    this.latest = Math.max(this.latest, revision)
    this.pending = { d, revision, opts }
    if (!this.running) void this.loop()
  }

  private async loop(): Promise<void> {
    this.running = true
    while (this.pending && !this.stopped) {
      const job = this.pending
      this.pending = null
      let outcome: SimOutcome
      let circuit: Circuit | undefined
      try {
        ;({ outcome, circuit } = await solve(job.d, this.engine, job.revision, job.opts))
      } catch (e) {
        // A throw (building the circuit, compiling it, the engine) is a failed solve, never an
        // unhandled rejection, and the loop goes on to any request that arrived meanwhile.
        outcome = { status: 'failed', revision: job.revision, finding: noConvergence(null, String(e), []), findings: [] }
      }
      if (this.stopped || job.revision !== this.latest) continue
      if (outcome.status === 'ok') this.lastGood = { revision: job.revision, result: outcome.result }
      try {
        this.onOutcome(outcome.status === 'failed' && this.lastGood ? { ...outcome, lastGood: this.lastGood } : outcome, circuit)
      } catch (e) {
        // A throwing callback is the caller's bug: logged, never allowed to wedge the loop.
        console.error('SimSession: onOutcome threw', e)
      }
    }
    this.running = false
  }

  /** Permanent: results still in flight are dropped and later requests are ignored. */
  stop(): void {
    this.stopped = true
    this.pending = null
  }
}
