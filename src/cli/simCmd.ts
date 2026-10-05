// `circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...` (spec 7): solves the
// sheet as a DC circuit in its saved switch and GPIO state and prints the SimOutcome JSON on
// stdout, with a short summary on stderr. Simulation findings only (spec 2.1). Exit 0 clean, 1 a
// blocking finding (a failed or unavailable solve's topological ones too, as gate), 2 bad input, 3
// the solve failed or the engine is unavailable. Given a netlist (or a sheet with its intent), net
// readings are keyed by the netlist's own net names. Connectivity only: a netlist the layout cannot
// draw is still simulated (Phase D ruling).
import { DIAGRAM_FORMAT, type Connection, type Diagram, type Probe, validateDiagram } from '../format/diagram.ts'
import { nodeKey } from '../format/netlist.ts'
import { isObj } from '../format/module.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { sheetNets } from '../agent/extract.ts'
import { naturalCompare } from '../agent/order.ts'
import { type Intent, intentLookup, parseNetlist } from '../agent/netlist.ts'
import { type Engine, makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { nextProbeId, probesForSheet } from '../sim/probes.ts'
import type { CurrentReading, Reading, SimOutcome } from '../sim/results.ts'
import { solve } from '../sim/session.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, printJson, readJson } from './io.ts'

const USAGE = 'sim: usage: circuitoon sim <sheet.json|netlist.json> [--probe <ref[.pin]|net:NAME>]...'
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * One --probe: "REF.PIN", "REF" or "net:NAME" on the sheet (refs as the netlist names them). A net
 * name is the intent's (the netlist's own names, which the readings use), else the sheet's
 * (extract's: labels, GND, rails, REF_PIN).
 */
function probeOf(spec: string, d: Diagram, uidOf: Map<string, string>, nets: ReturnType<typeof sheetNets>['nets'], intent: Intent | null, id: string): Probe {
  if (spec.startsWith('net:')) {
    const [p] = intent ? probesForSheet({ ...intent, probes: [{ id, at: spec }] }) : []
    const uid = p && (uidOf.get(p.at.part) ?? d.parts.find((x) => x.uid === p.at.part)?.uid)
    if (uid) return { id, name: spec, at: { part: uid, pin: p.at.pin } }
    const net = nets.find((n) => n.name === spec.slice(4))
    if (!net) throw new CliError(`sim: --probe ${spec}: no net "${spec.slice(4)}"`, EXIT.input)
    const pin = [...net.pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
    return { id, name: spec, at: { part: uidOf.get(pin.ref)!, pin: pin.name } }
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
const watts = (r: Reading) => (r.kind === 'value' ? `${(r.value * 1000).toFixed(1)} mW` : r.kind === 'undefined' ? `power ${r.why}` : r.kind)

/**
 * Phase D ruling: sim checks connectivity, not layout readability. A netlist the layout cannot draw
 * (a net that needs a distribution point) is simulated from a sheet with each net wired pin to pin;
 * uids are the refs, as on a laid-out sheet, and board strips are left out (they only join pins the
 * net already lists).
 */
// ponytail: `on` mounts are dropped (a mount joins pins by where they sit, and nothing is placed here); a plug-in supply mounted in an outlet reads as unplugged. Lay it out if that ever matters.
function connectionSheet(intent: Intent, raw: unknown): Diagram {
  const connections: Connection[] = intent.nets.flatMap((n) => {
    const pins = n.terminals.filter((t) => !t.infra)
    return pins.slice(1).map((t, i) => ({ uid: '', from: { part: pins[i].ref, pin: pins[i].name }, to: { part: t.ref, pin: t.name } }))
  })
  const probes = probesForSheet(intent)
  return {
    format: DIAGRAM_FORMAT,
    title: intent.title,
    modules: intent.modules,
    parts: intent.parts.map((p, i) => ({ uid: p.ref, designator: p.ref, module: p.module, x: (i % 8) * 400, y: Math.floor(i / 8) * 400, ...(p.values ? { values: p.values } : {}), ...(p.settings ? { settings: p.settings } : {}) })),
    connections: connections.map((c, i) => ({ ...c, uid: `w${i + 1}` })),
    intent: structuredClone(raw),
    ...(probes.length ? { probes } : {}),
  }
}

// Ruling R30 leaves one "not powered" warning per load behind an open switch (ten on a typical
// sheet); the summary folds a run of them for the same switch into one line. The JSON keeps them all.
const OFF = /^(.+?) is not powered in the current state: (\S+) is open\./
// `line` formats one line from a finding and its (possibly folded) message; gate passes its own.
export function findingLines<F extends { severity: string; message: string }>(findings: F[], line: (f: F, message: string) => string = (f, m) => `  ${f.severity}: ${m}`): string[] {
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
    if (m && run.length > 1) lines.push(line(findings[i], `not powered in the current state because ${m[2]} is open: ${run.join(', ')}. Set ${m[2]} to its operating position to simulate them running.`))
    else lines.push(line(findings[i], findings[i].message))
  }
  return lines
}

/** The stderr summary; `refOf` names parts by ref where the result keeps uids. */
export function summary(o: SimOutcome, refOf: Map<string, string> = new Map()): string {
  // The topological findings decided before the engine ran still stand.
  if (o.status !== 'ok') return `${[o.status === 'failed' ? `Simulation failed: ${o.finding.message}` : `Simulation unavailable: ${o.reason}`, ...findingLines(o.findings)].join('\n')}\n`
  const r = o.result
  const count = (s: string) => r.findings.filter((f) => f.severity === s).length
  // No engine run: nothing on the sheet is driven, so there was nothing to solve.
  const solved = r.engine.runs ? `typical and peak solved in ${Math.round(r.engine.ms)} ms (${r.engine.runs} engine runs)` : 'nothing powered; not solved'
  const lines = [`Simulation: ${solved}. ${plural(count('error'), 'blocking finding')}, ${plural(count('warning'), 'warning')}, ${plural(count('note'), 'note')}.`]
  lines.push(...findingLines(r.findings))
  // A domain row reads its own draw (what the part takes); its amps are whatever passes through the pin.
  for (const b of r.budget) {
    const a = b.kind === 'domain' && b.ownDraw ? b.ownDraw : b.amps
    lines.push(`  budget ${b.label}: ${volts(b.volts.typical)}, ${amps(a.typical)} (peak ${amps(a.peak)})${b.kind === 'domain' ? ' own draw' : ''}${b.limit ? `, limit ${(b.limit.value * 1000).toFixed(0)} mA` : ''}`)
  }
  for (const u of r.unaccounted) lines.push(`  not in the budget: ${refOf.get(u.part) ?? u.part}: ${u.items.join('; ')}`)
  for (const p of r.probes) {
    const v = p.voltage?.typical
    const part = p.part?.typical
    if (v) lines.push(`  ${p.id} ${p.name ?? ''}: ${v.kind === 'value' ? `${v.value.toFixed(3)} V (to ${v.reference})` : v.kind}`)
    else if (part) {
      const pins = Object.entries(part.pins).map(([pin, i]) => `${pin} ${amps(i)}`)
      lines.push(`  ${p.id} ${p.name ?? ''}: ${[...(part.state ? [part.state] : []), watts(part.power), ...(pins.length ? [`into ${pins.join(', ')}`] : [])].join(', ')}`)
    }
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
    // Only a netlist that breaks the contract is bad input; a layout that fails is not sim's business.
    if (!r.ok && r.stage === 'input') throw new CliError(`${input}: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    const parsed = r.ok ? ({ ok: true, intent: r.value.intent } as const) : parseNetlist(raw, libraryLookup)
    if (!parsed.ok) throw new CliError(`${input}: ${parsed.errors.slice(0, 5).join('; ')}`, EXIT.input)
    intent = parsed.intent
    d = r.ok ? r.value.diagram : connectionSheet(intent, raw)
    for (const w of intent.probeWarnings) io.stderr(`warning: ${w}\n`)
    // Ruling R6: a netlist probe's ref is kept, not used.
    for (const p of intent.probes) if (p.ref) io.stderr(`note: probe ${p.id} names ref ${p.ref}; readings are relative to its island's reference (differential probes come later)\n`)
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
  // Readings keyed by the netlist's own net names (Phase D ruling); board strips are left out.
  const netNames = intent?.nets.map((n) => ({ name: n.name, keys: n.terminals.flatMap((t) => (t.infra || !uidOf.has(t.ref) ? [] : [nodeKey(uidOf.get(t.ref)!, t.name)])) }))
  const engine = opts.engine ?? makeEngine(createNodeEngineHost())
  try {
    const { outcome } = await solve(d, engine, 1, { probes, library: libraryLookup, ...(netNames ? { netNames } : {}) })
    printJson(io, outcome)
    io.stderr(summary(outcome, sn.refOf))
    // A failed or unavailable solve still blocks on its topological findings (a real short), as gate does.
    const findings = outcome.status === 'ok' ? outcome.result.findings : outcome.findings
    if (findings.some((f) => f.severity === 'error')) return EXIT.blocked
    return outcome.status === 'ok' ? EXIT.ok : EXIT.environment
  } finally {
    if (!opts.engine) engine.dispose()
  }
}
