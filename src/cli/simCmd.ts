// `circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...` (spec 7): solves the
// sheet as a DC circuit in its saved switch and GPIO state and prints the SimOutcome JSON on
// stdout, with a short summary on stderr. Simulation findings only (spec 2.1). Exit 0 clean, 1 a
// blocking finding, 2 bad input, 3 the solve failed or the engine is unavailable.
import { type Diagram, type Probe, validateDiagram } from '../format/diagram.ts'
import { isObj } from '../format/module.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { sheetNets } from '../agent/extract.ts'
import { naturalCompare } from '../agent/order.ts'
import { type Intent, intentLookup, parseNetlist } from '../agent/netlist.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { nextProbeId, probesForSheet } from '../sim/probes.ts'
import type { CurrentReading, Reading, SimFinding, SimOutcome } from '../sim/results.ts'
import { solve } from '../sim/session.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, printJson, readJson } from './io.ts'

const USAGE = 'sim: usage: circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...'
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * One --probe: "REF.PIN", "REF" or "net:NAME" on the sheet (refs as the netlist names them). A net
 * name is the sheet's (extract's: labels, GND, rails, REF_PIN), else the intent's (the netlist's own
 * names, which a laid-out sheet keeps).
 */
function probeOf(spec: string, d: Diagram, uidOf: Map<string, string>, nets: ReturnType<typeof sheetNets>['nets'], intent: Intent | null, id: string): Probe {
  if (spec.startsWith('net:')) {
    const net = nets.find((n) => n.name === spec.slice(4))
    if (net) {
      const pin = [...net.pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
      return { id, name: spec, at: { part: uidOf.get(pin.ref)!, pin: pin.name } }
    }
    const [p] = intent ? probesForSheet({ ...intent, probes: [{ id, at: spec }] }) : []
    const uid = p && (uidOf.get(p.at.part) ?? d.parts.find((x) => x.uid === p.at.part)?.uid)
    if (!uid) throw new CliError(`sim: --probe ${spec}: no net "${spec.slice(4)}"`, EXIT.input)
    return { id, name: spec, at: { part: uid, pin: p.at.pin } }
  }
  const dot = spec.indexOf('.')
  const ref = dot < 0 ? spec : spec.slice(0, dot)
  const uid = uidOf.get(ref) ?? d.parts.find((p) => p.uid === ref)?.uid
  if (!uid) throw new CliError(`sim: --probe ${spec}: no part "${ref}"`, EXIT.input)
  if (dot < 0) return { id, name: spec, at: { part: uid } }
  const pin = spec.slice(dot + 1)
  const m = d.modules[d.parts.find((p) => p.uid === uid)!.module]
  const has = m && (m.pins.some((x) => 'name' in x && x.name === pin) || (m.holes ?? []).some((h) => h.name === pin))
  if (!has) throw new CliError(`sim: --probe ${spec}: ${ref} has no pin "${pin}"`, EXIT.input)
  return { id, name: spec, at: { part: uid, pin } }
}

const volts = (r: Reading) => (r.kind === 'value' ? `${r.value.toFixed(3)} V` : r.kind)
const amps = (r: CurrentReading) => (r.kind === 'value' ? `${(r.value * 1000).toFixed(1)} mA` : r.kind)

// Ruling R30 leaves one "not powered" warning per load behind an open switch (ten on a typical
// sheet); the summary folds a run of them for the same switch into one line. The JSON keeps them all.
const OFF = /^(.+?) is not powered in the current state: (\S+) is open\./
function findingLines(findings: SimFinding[]): string[] {
  const lines: string[] = []
  for (let i = 0; i < findings.length; i++) {
    const m = findings[i].severity === 'warning' ? OFF.exec(findings[i].message) : null
    const run = [m?.[1]]
    while (m && i + 1 < findings.length && findings[i + 1].severity === 'warning') {
      const next = OFF.exec(findings[i + 1].message)
      if (next?.[2] !== m[2]) break
      run.push(next[1])
      i++
    }
    if (m && run.length > 1) lines.push(`  warning: not powered in the current state because ${m[2]} is open: ${run.join(', ')}. Set ${m[2]} to its operating position to simulate them running.`)
    else lines.push(`  ${findings[i].severity}: ${findings[i].message}`)
  }
  return lines
}

/** The stderr summary; `refOf` names parts by ref where the result keeps uids. */
export function summary(o: SimOutcome, refOf: Map<string, string> = new Map()): string {
  if (o.status === 'unavailable') return `Simulation unavailable: ${o.reason}\n`
  if (o.status === 'failed') return `Simulation failed: ${o.finding.message}\n`
  const r = o.result
  const count = (s: string) => r.findings.filter((f) => f.severity === s).length
  const lines = [`Simulation: typical and peak solved in ${Math.round(r.engine.ms)} ms (${r.engine.runs} engine runs). ${plural(count('error'), 'blocking finding')}, ${plural(count('warning'), 'warning')}, ${plural(count('note'), 'note')}.`]
  lines.push(...findingLines(r.findings))
  for (const b of r.budget) lines.push(`  budget ${b.label}: ${volts(b.volts.typical)}, ${amps(b.amps.typical)} (peak ${amps(b.amps.peak)})${b.limit ? `, limit ${(b.limit.value * 1000).toFixed(0)} mA` : ''}`)
  for (const u of r.unaccounted) lines.push(`  not in the budget: ${refOf.get(u.part) ?? u.part}: ${u.items.join('; ')}`)
  for (const p of r.probes) {
    const v = p.voltage?.typical
    if (v) lines.push(`  ${p.id} ${p.name ?? ''}: ${v.kind === 'value' ? `${v.value.toFixed(3)} V (to ${v.reference})` : v.kind}`)
  }
  return `${lines.join('\n')}\n`
}

export async function simCommand(args: Args, io: Io, opts: { engine?: Engine } = {}): Promise<number> {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError(USAGE, EXIT.input)
  if (rest.length) throw new CliError(`sim: give one sheet or netlist file, not ${args.positionals.length}`, EXIT.input)
  const raw = readJson(io, input)
  let d: Diagram
  let intent: Intent | null = null
  if (isObj(raw) && raw.format === 'circuitoon-netlist/1') {
    const r = layoutNetlist(raw, { library: libraryLookup })
    if (!r.ok) throw new CliError(`${input}: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    d = r.value.diagram
    intent = r.value.intent
    for (const w of r.value.intent.probeWarnings) io.stderr(`warning: ${w}\n`)
    // Ruling R6: a netlist probe's ref is kept, not used.
    for (const p of r.value.intent.probes) if (p.ref) io.stderr(`note: probe ${p.id} names ref ${p.ref}; readings are relative to its island's reference (differential probes come later)\n`)
  } else {
    const v = validateDiagram(raw, { library: libraryLookup })
    if (!v.ok) throw new CliError(`${input} is not a Circuitoon sheet or netlist: ${v.errors.slice(0, 5).join('; ')}`, EXIT.input)
    d = v.diagram
    const parsed = d.intent !== undefined ? parseNetlist(d.intent, intentLookup(d, libraryLookup)) : null
    if (parsed?.ok) intent = parsed.intent
    for (const w of v.warnings) io.stderr(`warning: ${w}\n`)
  }
  const sn = sheetNets(d)
  const uidOf = new Map([...sn.refOf].map(([uid, ref]) => [ref, uid]))
  let next = d
  const probes = (args.lists?.get('--probe') ?? []).map((s) => {
    const p = probeOf(s, d, uidOf, sn.nets, intent, nextProbeId(next))
    next = { ...next, probes: [...(next.probes ?? []), p] }
    return p
  })
  const engine = opts.engine ?? makeEngine(createNodeEngineHost())
  try {
    const { outcome } = await solve(d, engine, 1, { probes, library: libraryLookup })
    printJson(io, outcome)
    io.stderr(summary(outcome, sn.refOf))
    if (outcome.status !== 'ok') return EXIT.environment
    return outcome.result.findings.some((f) => f.severity === 'error') ? EXIT.blocked : EXIT.ok
  } finally {
    if (!opts.engine) engine.dispose()
  }
}
