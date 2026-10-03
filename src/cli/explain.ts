// `circuitoon explain <sheet|netlist> [--json]`: the design read back in plain English, so an agent
// (and the person it works for) can check it against what was asked. Every connection, grouped by
// net ("SDA: ESP32 DevKit V1 (U2) D21 -> 0.96" OLED (DS1) SDA"); then, per part, what each pin in
// use does (its type, its I2C role and the pin capabilities from the datasheet: input only,
// strapping, flash ...); then the parts nothing connects to; then the pin-rule findings (pin-* and
// i2c-*). A sheet is explained from its real connectivity (wires, breadboard strips, labels), a
// netlist (or a partial's intent) from its nets. Explaining never blocks: exit 0, or 2 for input
// that is not a sheet, a netlist or a partial.
import { type Diagram, moduleOf, validateDiagram } from '../format/diagram.ts'
import { checkDiagram, RULES } from '../format/checks.ts'
import { plugsOf } from '../format/breadboard.ts'
import { netlist } from '../format/netlist.ts'
import { labelsOf } from '../format/netLabels.ts'
import { type ModuleDef, addressText, i2cOf, isBoard, isNetLabel } from '../format/module.ts'
import { type PinEnd, type PinModel, type PinPart, type Role, buildPinModel, endName, i2cAddress, pinDoes, pinFindings, roleOf } from '../format/pinRules.ts'
import { natural } from '../format/words.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { verifyDiagram } from '../agent/verify.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, printJson, readJson } from './io.ts'
import { type CliFinding, cliFinding, findingsText, uniqueIds } from './verifyCmd.ts'

export const EXPLAIN_FORMAT = 'circuitoon-cli/explain/1'

/** The rules explain reports: the pin-capability and I2C rules. */
const isPinRule = (rule: string) => /^(pin|i2c)-/.test(rule)

/** A module's short name: its name up to the first " (" ("ESP32 DevKit V1 (30 pin, DOIT)" is "ESP32 DevKit V1"). */
export const shortName = (m: ModuleDef): string => m.name.split(' (')[0]
const model = (m: ModuleDef) => (m.electrical as { model?: string } | undefined)?.model
/** Explain lists real parts only: no breadboards, rail strips or net labels. */
const listed = (m: ModuleDef) => !isBoard(m) && !isNetLabel(m)

interface Explained {
  source: 'sheet' | 'netlist'
  title: string
  model: PinModel
  /** The caller's name for each net (a netlist's net name, a sheet's label name), or null. */
  names: (string | null)[]
  findings: CliFinding[]
  /** What the reader should know about the explanation itself (a sheet's stale part copies). */
  notes: string[]
}

function fromSheet(d: Diagram): Explained {
  const nl = netlist(d, plugsOf(d))
  const parts: PinPart[] = d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    return m ? [{ id: p.uid, designator: p.designator, module: m, settings: p.settings }] : []
  })
  const pm = buildPinModel(parts, nl.nets.map((keys) => keys.map((k) => JSON.parse(k) as [string, string])))
  const names: (string | null)[] = nl.nets.map(() => null)
  for (const l of labelsOf(d)) {
    const i = nl.netOf.get(JSON.stringify([l.part.uid, l.pin]))
    if (i !== undefined && l.name && names[i] === null) names[i] = l.name
  }
  const findings = uniqueIds(checkDiagram(d).filter((f) => isPinRule(f.rule)).map(cliFinding))
  // A sheet carries its own copy of each part; one saved before the library learned a pin's
  // capabilities is explained (and checked) without them, so say so.
  const notes = verifyDiagram(d, libraryLookup).filter((f) => f.rule === 'module-drift').map((f) => `${f.message} Until then, its pin capabilities and I2C data are the old copy's.`)
  return { source: 'sheet', title: d.title, model: pm, names, findings, notes }
}

function fromNetlist(raw: unknown, path: string): Explained {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new CliError(`${path} is not a valid netlist: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
  const intent = r.intent
  const parts: PinPart[] = intent.parts.flatMap((p) => {
    const m = intent.modules[p.module]
    return m ? [{ id: p.ref, designator: p.ref, module: m, ...(p.settings ? { settings: p.settings } : {}) }] : []
  })
  const pm = buildPinModel(parts, intent.nets.map((n) => n.terminals.map((t): [string, string] => [t.ref, t.name])))
  const findings = uniqueIds(pinFindings(pm).map((f) => ({
    id: `${f.rule}|${[...new Set(f.causes)].sort().join(',')}`, rule: f.rule, severity: RULES[f.rule].severity, message: f.message, parts: f.parts, pins: f.pins, wires: [],
  })))
  return { source: 'netlist', title: intent.title, model: pm, names: intent.nets.map((n) => n.name), findings, notes: [] }
}

/** A net's ends in reading order: the MCU first, then by designator and pin. */
const ordered = (net: PinEnd[]) => [...net].sort((a, b) =>
  Number(model(b.part.module) === 'mcu') - Number(model(a.part.module) === 'mcu') || natural.compare(a.part.designator, b.part.designator) || natural.compare(a.label, b.label) || natural.compare(a.pin, b.pin))

/** A sheet net's name when no label names it: GND, the supply pin's label, else a pin of the first part that is not the MCU. */
function autoName(net: PinEnd[], role: Role): string {
  const ends = ordered(net)
  if (role === 'ground') return 'GND'
  if (role === 'supply') {
    const e = ends.find((x) => x.type === 'power_out' || x.external) ?? ends.find((x) => x.type === 'power_in') ?? ends[0]
    // A rail label names it ("3V3", "VIN"); a bare "+" needs its part ("BT1 +").
    return /[A-Za-z0-9]/.test(e.label) ? e.label : endName(e)
  }
  const other = ends.find((e) => model(e.part.module) !== 'mcu') ?? ends[0]
  return endName(other)
}

const endText = (e: PinEnd) => `${shortName(e.part.module)} (${e.part.designator}) ${e.label}`

export function explain(x: Explained) {
  const pm = x.model
  // Nets that join two or more parts (a part's own internal joins alone are not a connection).
  const used = new Set<string>()
  const taken = new Map<string, number>()
  const all = Array.from({ length: pm.count }, (_, i) => pm.net(i))
  const nets = all.flatMap((net, i) => {
    // One end per electrical node of a part: GND, GND 2 and GND 3 joined inside a board are one pin here.
    const seen = new Set<string>()
    const ends = ordered(net.filter((e) => listed(e.part.module))).filter((e) => {
      const k = JSON.stringify([e.part.id, (e.part.module.internal ?? []).find((g) => g.includes(e.pin))?.[0] ?? e.pin])
      return !seen.has(k) && !!seen.add(k)
    })
    if (new Set(ends.map((e) => e.part)).size < 2) return []
    for (const e of ends) used.add(JSON.stringify([e.part.id, e.pin]))
    const role = roleOf(ends)
    let name = x.names[i] ?? autoName(ends, role)
    const n = (taken.get(name) ?? 0) + 1
    taken.set(name, n)
    if (n > 1) name = `${name} (${n})`
    return [{ name, role, text: `${name}: ${ends.map(endText).join(' -> ')}`, ends: ends.map((e) => ({ part: e.part.id, designator: e.part.designator, module: e.part.module.id, pin: e.pin, label: e.label })) }]
  })
  const parts = pm.parts.filter((p) => listed(p.module)).sort((a, b) => natural.compare(a.designator, b.designator))
  const connected = new Set([...used].map((k) => (JSON.parse(k) as [string, string])[0]))
  const perPart = parts.filter((p) => connected.has(p.id)).map((p) => {
    const pins = all.flat().filter((e) => e.part === p && used.has(JSON.stringify([p.id, e.pin])))
      .sort((a, b) => natural.compare(a.label, b.label))
    const addr = i2cOf(p.module) ? i2cAddress(pm, p) : null
    return {
      part: p.id, designator: p.designator, module: p.module.id, name: p.module.name,
      i2cAddress: addr ? { address: addr.address === null ? null : addressText(addr.address), how: addr.how } : null,
      pins: pins.map((e) => ({ pin: e.pin, label: e.label, does: pinDoes(e), caps: e.caps ?? null })),
    }
  })
  const unconnected = parts.filter((p) => !connected.has(p.id)).map((p) => ({ part: p.id, designator: p.designator, module: p.module.id, name: p.module.name }))
  return { format: EXPLAIN_FORMAT, source: x.source, title: x.title, ok: !x.findings.some((f) => f.severity === 'error'), notes: x.notes, nets, parts: perPart, unconnected, findings: x.findings }
}

export function explainText(r: ReturnType<typeof explain>): string {
  const lines = [`Explain: ${r.title} (${r.source})`, '']
  if (r.notes.length) lines.push('Notes:', ...r.notes.map((n) => `  ${n}`), '')
  lines.push('Connections, by net:')
  lines.push(...(r.nets.length ? r.nets.map((n) => `  ${n.text}`) : ['  none']))
  lines.push('', 'Pins in use, by part:')
  for (const p of r.parts) {
    const addr = p.i2cAddress ? `: I2C address ${p.i2cAddress.address ?? 'undefined'} (${p.i2cAddress.how})` : ''
    lines.push(`  ${p.designator} ${p.name} [${p.module}]${addr}`)
    for (const pin of p.pins) lines.push(`    ${p.designator} ${pin.label}: ${pin.does}`)
  }
  if (!r.parts.length) lines.push('  none')
  lines.push('', 'Not connected:')
  lines.push(...(r.unconnected.length ? r.unconnected.map((p) => `  ${p.designator} ${p.name} [${p.module}]`) : ['  none']))
  lines.push('', 'Pin rule findings:')
  lines.push(r.findings.length ? findingsText(r.findings).split('\n').map((l) => `  ${l}`).join('\n') : '  none')
  return `${lines.join('\n')}\n`
}

export function explainCommand(args: Args, io: Io): number {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('explain: give a sheet or a netlist file', EXIT.input)
  if (rest.length) throw new CliError(`explain: give one file, not ${args.positionals.length}`, EXIT.input)
  const raw = readJson(io, input)
  const format = (raw as { format?: unknown } | null)?.format
  let x: Explained
  if (format === 'circuitoon-netlist/1') x = fromNetlist(raw, input)
  else if (format === 'circuitoon-partial/1') x = fromNetlist((raw as { intent?: unknown }).intent, input)
  else {
    const r = validateDiagram(raw)
    if (!r.ok) throw new CliError(`${input} is not a Circuitoon sheet or netlist: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    for (const w of r.warnings) io.stderr(`warning: ${w}\n`)
    x = fromSheet(r.diagram)
  }
  const result = explain(x)
  if (args.flags.has('--json')) printJson(io, result)
  else io.stdout(explainText(result))
  return EXIT.ok
}
