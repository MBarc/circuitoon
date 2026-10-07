// `circuitoon gate <sheet.json> -o <dir>` (agent toolkit spec 4.2 and 5): the one command an agent
// runs before showing anything to a person. Load, verify, check, render (full, plus one focused copy
// when the intent has repeats), the bill of materials (bom.csv) and link; write the artifacts and gate.json with a SHA-256 of the
// diagram and of each artifact. Blocking: loader errors, a missing module or dropped value override,
// any verify error (missing or invalid intent included), any checker error, any blocked route, and
// no link with no file fallback written, and a custom part that does not look like the real part
// (custom-part-look: generic box art or no photo). A wire drawn over used breadboard holes (a wire end, a leg,
// a hole under a part's body) that it does not use warns (wire-over-holes); empty holes never do. Every required artifact must exist before the gate passes
// (amendment A8): one that could not be made (no browser, a failed render) is an environment problem.
// Exit 0 only when nothing blocks and every artifact is there; blocking findings win over a missing
// browser (1 before 3). A sheet file that cannot be read is invalid input (2); one that reads but
// does not load as a sheet blocks (1), with gate.json saying why. Nothing stale survives a run: the
// old gate.json and the file fallback it names go first, before the arguments are even checked, and
// the old renders, link and focused PNGs go before new ones are written, so a failed run never leaves
// an earlier pass (or the previous diagram's link) beside it.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { VALUE_DROPPED, computeRoutes, moduleOf, validateDiagram, wirePaths } from '../format/diagram.ts'
import { checkDiagram, endpointName } from '../format/checks.ts'
import { LINK_NOTICE } from '../format/link.ts'
import { focusBounds, renderSheetSvg } from '../render/exportSvg.tsx'
import { verifyDiagram } from '../agent/verify.ts'
import { intentLookup } from '../agent/netlist.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { codeFindings } from './codeFindings.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import { customPartNote, lookFindings, sheetCustomParts } from '../agent/customParts.ts'
import { READABILITY_RULES, readabilityFindings } from '../agent/readabilityWarnings.ts'
import { type ChannelRow, type QuantityRow, bomQuantities, channelTable, sheetBom } from '../agent/tables.ts'
import { type Bom, bomCsv } from '../format/bom.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, pathIn, printJson, writeError, writeFile } from './io.ts'
import { type CliFinding, alsoChecked, cliFinding, findingsText, notCheckedText, uniqueIds, withoutStale } from './verifyCmd.ts'
import { writePng } from './png.ts'
import { linkFor } from './linkCmd.ts'
import { focusParts } from './render.ts'
import { findingLines } from './simCmd.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import type { DomainBudget, SimFinding, SimOutcome } from '../sim/results.ts'
import { noConvergence } from '../sim/findings.ts'
import type { Basis } from '../sim/model.ts'

export const GATE_FORMAT = 'circuitoon-cli/gate/4'

export interface GateSim {
  status: 'ok' | 'failed' | 'unavailable' | 'not-run'
  findings: SimFinding[]
  budget: DomainBudget[]
  provenanceCounts: Record<Basis, number>
  reason?: string
}

export interface GateArtifact {
  kind: 'svg' | 'png' | 'focus-png' | 'link' | 'file' | 'bom'
  /** Relative to the output directory. */
  path: string
  sha256: string
  bytes: number
}
export interface GateReport {
  format: typeof GATE_FORMAT
  ok: boolean
  /**
   * Ready to present as it is (Ruling W1): the gate passed and no readability warning remains. A
   * sheet that is ok but not ready may be shown only with each remaining readability warning listed
   * to the user, with why it could not be cleared.
   */
  ready: boolean
  diagram: { path: string; sha256: string }
  artifacts: GateArtifact[]
  blocking: CliFinding[]
  warnings: CliFinding[]
  /** Notes (severity info): never blocking, for the user to read. */
  notes: CliFinding[]
  /** The DC simulation (spec 7); its findings are also filed in blocking, warnings and notes. */
  sim: GateSim
  notChecked: string[]
  link: { url: string | null; file: string | null; chars: number }
  /** The bill of materials bom.csv is written from (null when the sheet did not load); `quantities` sums its parts per module. */
  bom: Bom | null
  quantities: QuantityRow[]
  channels: ChannelRow[]
}

/** How a PNG is made; tests pass their own to fail one render on purpose. */
export type PngWriter = (svg: { svg: string; width: number; height: number }, scale: number, out: string, env: Io['env']) => ReturnType<typeof writePng>

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
/** The loader's warning for a part whose module the file does not embed (a missing module blocks). */
const MISSING_MODULE = 'is not embedded in this file'
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Removes `path` when it is a file inside `dir` and not `keep` (the sheet being gated); anything else stays. */
function removeStale(dir: string, path: string, keep?: string) {
  const full = resolve(dir, path)
  const rel = relative(resolve(dir), full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || (keep !== undefined && full === resolve(keep))) return
  try {
    if (!statSync(full).isFile()) return
  } catch {
    return // not there
  }
  try {
    rmSync(full)
  } catch (err) {
    throw writeError(full, err)
  }
}

/** The artifacts of an earlier run in `outDir` that a new run replaces: renders, focused PNGs, the link. */
function clearArtifacts(outDir: string, keep: string) {
  let names: string[] = []
  try {
    names = readdirSync(outDir)
  } catch {
    return // no directory yet
  }
  for (const name of names) if (/^focus-.*\.png$/.test(name)) removeStale(outDir, name, keep)
  for (const name of ['sheet.svg', 'sheet.png', 'link.txt', 'bom.csv']) removeStale(outDir, name, keep)
}

/** Removes an earlier gate.json, and the file fallback it names, before anything else runs. */
function clearReport(outDir: string, keep?: string) {
  const path = join(outDir, 'gate.json')
  let old: unknown
  try {
    old = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // missing or unreadable: removed below if it is a file
  }
  removeStale(outDir, 'gate.json', keep)
  const artifacts = (old as { artifacts?: unknown } | undefined)?.artifacts
  if (Array.isArray(artifacts))
    for (const a of artifacts) if (a && typeof a === 'object' && (a as GateArtifact).kind === 'file' && typeof (a as GateArtifact).path === 'string') removeStale(outDir, (a as GateArtifact).path, keep)
}

/** Where gate gets its engine when the caller passes none. Tests that do not test simulation set `make` to `() => null`. */
export const gateEngine: { make: () => Engine | null } = { make: () => makeEngine(createNodeEngineHost()) }

export async function runGate(bytes: Uint8Array, opts: { sheetPath: string; outDir: string; io: Io; png?: PngWriter; engine?: Engine | null }): Promise<{ code: number; report: GateReport }> {
  const { io, outDir } = opts
  const png = opts.png ?? writePng
  const keep = pathIn(io, opts.sheetPath)
  // Old renders and links never survive into this run, whatever becomes of it.
  clearArtifacts(outDir, keep)
  const found: CliFinding[] = []
  const note = (rule: string, cause: string, severity: 'error' | 'warning', message: string, more: { parts?: string[]; wires?: string[] } = {}) =>
    found.push({ id: `${rule}|${cause}`, rule, severity, message, parts: more.parts ?? [], pins: [], wires: more.wires ?? [] })
  const artifacts: GateArtifact[] = []
  const artifact = (kind: GateArtifact['kind'], path: string) => {
    const content = readFileSync(join(outDir, path))
    artifacts.push({ kind, path, sha256: sha256(content), bytes: content.length })
  }
  // Each artifact the gate must produce, and what made it fail when it could not.
  const required: { kind: GateArtifact['kind'] | 'link-or-file'; path: string }[] = []
  let link: GateReport['link'] = { url: null, file: null, chars: 0 }
  let rows: Pick<GateReport, 'bom' | 'quantities' | 'channels'> = { bom: null, quantities: [], channels: [] }
  let sim: GateSim = { status: 'not-run', findings: [], budget: [], provenanceCounts: { datasheet: 0, representative: 0, estimate: 0, user: 0, topology: 0 } }

  const finish = (): { code: number; report: GateReport } => {
    const have = new Set(artifacts.map((a) => a.kind))
    const missing = required.filter((r) => (r.kind === 'link-or-file' ? !have.has('link') && !have.has('file') : !have.has(r.kind)))
    if (missing.length) note('environment', 'incomplete', 'warning', `The gate is incomplete: ${missing.map((m) => m.path).join(', ')} could not be made, so the gate cannot pass.`)
    const all = uniqueIds(found)
    const blocking = all.filter((f) => f.severity === 'error')
    // Spec 7 matrix: blocking wins, then an incomplete gate (a missing render, or a simulation that
    // failed or could not run). A sim finding blocks on its severity alone, never on its corner:
    // finalize leaves only blocking-eligible ones at error, and topological ones carry no corner.
    const simIncomplete = sim.status === 'failed' || sim.status === 'unavailable'
    const code = blocking.length ? EXIT.blocked : missing.length || simIncomplete ? EXIT.environment : EXIT.ok
    const report: GateReport = {
      format: GATE_FORMAT,
      ok: code === EXIT.ok,
      ready: code === EXIT.ok && all.every((f) => f.severity !== 'warning' || !(READABILITY_RULES as readonly string[]).includes(f.rule)),
      diagram: { path: opts.sheetPath, sha256: sha256(bytes) },
      artifacts,
      blocking,
      warnings: all.filter((f) => f.severity === 'warning'),
      notes: all.filter((f) => f.severity === 'info'),
      sim,
      notChecked: NOT_CHECKED,
      link,
      ...rows,
    }
    return { code, report }
  }

  // Load, as the site loads a file.
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    note('load', 'json', 'error', `${opts.sheetPath} is not valid JSON (${(e as Error).message})`)
    return finish()
  }
  const v = validateDiagram(raw, { library: libraryLookup })
  if (!v.ok) {
    v.errors.forEach((e, i) => note('load', String(i), 'error', `${opts.sheetPath} is not a Circuitoon sheet: ${e}`))
    return finish()
  }
  const d = v.diagram
  // The loader's "won't run" warning is codeFindings' `code-language` error; it is not reported twice.
  v.warnings.forEach((w, i) => w.endsWith("won't run") || note('load', String(i), w.includes(VALUE_DROPPED) || w.includes(MISSING_MODULE) ? 'error' : 'warning', w))

  // Verify against the intent, the wiring checker, and routes.
  const verified = verifyDiagram(d, libraryLookup)
  const checked = withoutStale(checkDiagram(d), verified)
  found.push(...verified.filter((f) => !alsoChecked(f, checked)).map(cliFinding))
  found.push(...checked.map(cliFinding))
  found.push(...codeFindings(d, libraryLookup))
  const routes = computeRoutes(d)
  // Blocked as drawn: wirePaths re-checks a wire that separation nudged, so a route that was clear
  // but was pushed through a body (drawn dashed) blocks too.
  for (const { conn: c, blocked } of wirePaths(d, routes))
    if (blocked)
      note('blocked-route', c.uid, 'error', `The wire ${c.label ?? `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`} has no clear route: it runs through a part.`, { parts: [c.from.part, c.to.part], wires: [c.uid] })
  // Over used holes it does not use: the router found no route around them (or the route was drawn
  // by hand across them). Electrically nothing changes, but in the picture the wire reads as plugged in.
  for (const c of d.connections)
    if (routes.get(c.uid)?.fallback)
      note('wire-over-holes', c.uid, 'warning', `The wire ${c.label ?? `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`} runs over breadboard holes in use that it is not plugged into, so in the picture it may look plugged in there.`, { parts: [c.from.part, c.to.part], wires: [c.uid] })
  // Readability (never blocking): the agent clears these or explains each one that remains.
  found.push(...readabilityFindings(d, routes).map(cliFinding))
  // Custom parts: user-made and unverified, named so the user knows which to check (a note), and
  // blocking when one does not look like the real part (generic box art, no photo).
  const custom = sheetCustomParts(d, libraryLookup)
  for (const c of custom) found.push({ id: `custom-part|${c.module}`, rule: 'custom-part', severity: 'info', message: customPartNote(c), parts: c.parts, pins: [], wires: [] })
  found.push(...lookFindings(custom, (id) => moduleOf(d, id)))
  // Simulation (spec 7): its own findings, never suppressing or suppressed by the checker (2.1).
  // No engine (the tests' stub, or a caller's null): not run, which the matrix ignores.
  const engine = opts.engine !== undefined ? opts.engine : gateEngine.make()
  if (engine)
    try {
      // A throwing solve is a failed outcome, as in the session: the checker's findings still stand.
      const outcome: SimOutcome = await solve(d, engine, 1, { library: libraryLookup }).then(
        (s) => s.outcome,
        (e) => ({ status: 'failed', revision: 1, finding: noConvergence(null, String(e), []), findings: [] }),
      )
      // Filed with the gate's findings; a failed or unavailable solve still carries the topological
      // ones (a short blocks with no engine), which block on the same rule as an ok solve's.
      const file = (findings: SimFinding[]) => {
        for (const f of findings) {
          sim.provenanceCounts[f.basis]++
          found.push({ id: `${f.code}|${f.parts.join(',')}|${f.corner ?? ''}`, rule: f.code, severity: f.severity === 'note' ? 'info' : f.severity, message: f.message, parts: f.parts, pins: f.pins ?? [], wires: [] })
        }
      }
      if (outcome.status === 'ok') {
        const r = outcome.result
        sim = { ...sim, status: 'ok', findings: r.findings, budget: r.budget }
        file(r.findings)
      } else if (outcome.status === 'failed') {
        // A failed solve never blocks (it may be our model, not the circuit): a warning, here and in sim.
        sim = { ...sim, status: 'failed', findings: [{ ...outcome.finding, severity: 'warning' }, ...outcome.findings], reason: outcome.finding.message }
        found.push({ id: 'sim-no-convergence', rule: 'sim-no-convergence', severity: 'warning', message: outcome.finding.message, parts: outcome.finding.parts, pins: [], wires: [] })
        file(outcome.findings)
      } else {
        sim = { ...sim, status: 'unavailable', findings: outcome.findings, reason: outcome.reason }
        file(outcome.findings)
      }
    } finally {
      if (opts.engine === undefined) engine.dispose()
    }
  const parsed = d.intent !== undefined ? parseNetlist(d.intent, intentLookup(d, libraryLookup)) : null
  // The bill of materials: bom.csv and gate.json's bill of quantities both come from this one bill.
  const bom = sheetBom(d, libraryLookup)
  rows = { bom, quantities: bomQuantities(bom), channels: parsed?.ok ? channelTable(parsed.intent) : [] }
  required.push({ kind: 'bom', path: 'bom.csv' })
  writeFile(io, join(outDir, 'bom.csv'), bomCsv(bom))
  artifact('bom', 'bom.csv')

  // Renders: the full sheet, and the first repeat copy when there is one. A PNG that could not be
  // made is recorded here and counted as missing in finish().
  const shoot = (drawn: { svg: string; width: number; height: number }, kind: 'png' | 'focus-png', name: string) => {
    required.push({ kind, path: name })
    let shot: ReturnType<typeof writePng>
    try {
      shot = png(drawn, 2, join(outDir, name), io.env)
    } catch (err) {
      throw writeError(join(outDir, name), err)
    }
    if (shot.ok) artifact(kind, name)
    else note('environment', name, 'warning', shot.message)
    return shot.ok
  }
  required.push({ kind: 'svg', path: 'sheet.svg' })
  const full = renderSheetSvg(d)
  writeFile(io, join(outDir, 'sheet.svg'), full.svg)
  artifact('svg', 'sheet.svg')
  const fullOk = shoot(full, 'png', 'sheet.png')
  const copy = parsed?.ok ? parsed.intent.copies[0] : undefined
  if (copy) {
    const name = `focus-${copy.id}.png`
    const uids = focusParts(d, copy.id)
    // After a failed full render (no browser) the focused one would fail the same way, and a copy
    // with no parts on the sheet (which verify blocks) has nothing to frame: either way it is missing.
    if (uids && fullOk) shoot(renderSheetSvg(d, { box: focusBounds(d, uids, routes) }), 'focus-png', name)
    else required.push({ kind: 'focus-png', path: name })
  }

  // The link, or the file when the link would break a limit.
  required.push({ kind: 'link-or-file', path: 'link.txt' })
  try {
    const l = await linkFor(d, outDir, io, pathIn(io, opts.sheetPath))
    const file = l.file ? relative(outDir, pathIn(io, l.file)) : null
    link = { url: l.url, file, chars: l.chars }
    if (l.url) {
      writeFile(io, join(outDir, 'link.txt'), `${l.url}\n`)
      artifact('link', 'link.txt')
    } else {
      artifact('file', file!)
      note('link', 'file', 'warning', `${l.reason} ${file} was written instead: open it in Circuitoon with Import JSON.`)
    }
  } catch (err) {
    note('link', 'none', 'error', `No link could be made and the file fallback could not be written: ${err instanceof Error ? err.message : String(err)}`)
  }
  return finish()
}

/** The readability warnings in a gate report (the rules readabilityFindings raises). */
export function readabilityCount(report: GateReport): number {
  return report.warnings.filter((w) => (READABILITY_RULES as readonly string[]).includes(w.rule)).length
}

/** The gate's verdict line (spec 7 matrix, ruling R15). */
export function gateBanner(code: number, report: GateReport, input: string): string {
  if (code === EXIT.ok) return `${report.warnings.length ? 'GATE PASSED, with warnings' : 'GATE PASSED'}: ${input} (sha256 ${report.diagram.sha256})`
  if (code === EXIT.environment) {
    if (report.sim.status === 'failed') return `GATE INCOMPLETE (simulation did not converge; this may be our model, not your circuit): ${input}`
    if (report.sim.status === 'unavailable') return `GATE INCOMPLETE (simulation unavailable): ${input}`
    return `GATE INCOMPLETE: nothing blocks, but not every render could be made (${input})`
  }
  const simOnly = report.blocking.every((f) => f.rule.startsWith('sim-'))
  return `${simOnly ? 'GATE FAILED (simulation)' : 'GATE FAILED'}: ${plural(report.blocking.length, 'blocking finding')} (${input})`
}

export async function gateCommand(args: Args, io: Io): Promise<number> {
  const [input, ...rest] = args.positionals
  const out = flag(args, '--out')
  // First of all, so that no failure below (a bad argument, an unreadable sheet, a crash) leaves an
  // earlier run's gate.json in place, looking like the result of this one. The sheet itself is
  // never removed, even when it sits in the output directory.
  if (out) clearReport(pathIn(io, out), input ? pathIn(io, input) : undefined)
  if (!input || !out) throw new CliError('gate: usage: circuitoon gate <sheet.json> -o <dir>', EXIT.input)
  if (rest.length) throw new CliError(`gate: give one sheet file, not ${args.positionals.length}`, EXIT.input)
  let bytes: Uint8Array
  try {
    bytes = readFileSync(pathIn(io, input))
  } catch {
    throw new CliError(`${input}: cannot read the file`, EXIT.input)
  }
  const { code, report } = await runGate(bytes, { sheetPath: input, outDir: pathIn(io, out), io })
  writeFile(io, join(out, 'gate.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (code === EXIT.environment)
    for (const w of report.warnings) if (w.rule === 'environment') io.stderr(`${w.message}\n`)
  if (args.flags.has('--json')) printJson(io, report)
  else {
    if (report.sim.status === 'unavailable') io.stderr(`Simulation unavailable: ${report.sim.reason}\n`)
    const head = gateBanner(code, report, input)
    // Ruling W1: a sheet with readability warnings left is not ready, whatever the exit code says.
    const notReady = readabilityCount(report)
    const lines = [...(notReady ? [`NOT READY: ${plural(notReady, 'readability warning')}`] : []), head]
    if (report.blocking.length) lines.push('', 'Blocking:', findingsText(report.blocking))
    if (report.warnings.length) lines.push('', 'Warnings (report these to the user):', ...findingLines(report.warnings, (f, m) => `${f.severity.toUpperCase()} ${f.rule}: ${m}`))
    if (report.notes.length) lines.push('', 'Notes (not problems; pass them on to the user):', findingsText(report.notes))
    lines.push('', `Artifacts in ${out}:`, ...report.artifacts.map((a) => `  ${a.path}  sha256 ${a.sha256}`), `  gate.json`)
    if (report.link.url) lines.push('', `Link: ${report.link.url}`, LINK_NOTICE)
    lines.push('', notCheckedText())
    io.stdout(`${lines.join('\n')}\n`)
  }
  return code
}
