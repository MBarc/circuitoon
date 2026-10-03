// `circuitoon verify <sheet.json>` and `circuitoon check <sheet.json>` (agent toolkit spec 3 and
// 4.2): findings with stable ids, rule, severity, message, parts, pins and wires, then what is not
// checked (spec 5). verify compares the sheet with its intent; check runs the wiring checker and,
// when the sheet has an intent, verify too, so it still works on any diagram. Exit 1 when an error
// blocks; a file that does not load as a sheet is invalid input (exit 2). Loader warnings go to
// stderr.
import type { Endpoint } from '../format/diagram.ts'
import { checkDiagram } from '../format/checks.ts'
import { holeKey } from '../format/breadboard.ts'
import { driftedParts, verifyDiagram } from '../agent/verify.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import { readabilityFindings } from '../agent/readabilityWarnings.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, loadSheet, printJson } from './io.ts'

export interface CliFinding {
  id: string
  rule: string
  /** `info` is a note (a parallel battery bank): printed, never blocking. */
  severity: 'error' | 'warning' | 'info'
  message: string
  parts: string[]
  pins: Endpoint[]
  wires: string[]
}

/** Only the fields every finding output carries, whatever produced it. */
export const cliFinding = (f: CliFinding): CliFinding => ({ id: f.id, rule: f.rule, severity: f.severity, message: f.message, parts: f.parts, pins: f.pins, wires: f.wires })

/**
 * verify and the checker build ids the same way (rule plus causes) and share the rule name "mount",
 * so one list could hold an id twice. A repeat gets `#n`, like each producer's own repeats.
 */
export function uniqueIds(findings: CliFinding[]): CliFinding[] {
  const used = new Set<string>()
  return findings.map((f) => {
    let id = f.id
    for (let n = 1; used.has(id); n++) id = `${f.id}#${n}`
    used.add(id)
    return id === f.id ? f : { ...f, id }
  })
}

/**
 * Verify's findings a combined report leaves out because the wiring checker (`checked`) reports the
 * same problem itself: covered-hole (a wire end or leg under a part's body) comes from one shared
 * test, and so does a board hole's capacity when the checker has hole-shared (two wire ends) or
 * leg-hole-shared (a leg and a wire end) for that hole. Verify's hole key is ["hole", board, group,
 * hole]: hole-shared uses the same key, leg-hole-shared the hole's holeKey among its causes.
 */
export function alsoChecked(f: { id: string; rule: string }, checked: { id: string; rule: string }[]): boolean {
  if (f.rule === 'covered-hole') return true
  if (f.rule !== 'capacity') return false
  const key = f.id.slice('capacity|'.length)
  let at: unknown
  try {
    at = JSON.parse(key)
  } catch {
    return false
  }
  if (!Array.isArray(at) || at[0] !== 'hole') return false
  const hole = holeKey(String(at[1]), String(at[2]), Number(at[3]))
  return checked.some((c) => (c.rule === 'hole-shared' && c.id === `hole-shared|${key}`) || (c.rule === 'leg-hole-shared' && c.id.includes(hole)))
}

/**
 * The checker's findings, less any covered-hole that involves a part whose embedded module blocks as
 * module-drift because its body or pins moved (`verified` holds verify's findings, see driftedParts):
 * that hole is covered by, or holds a leg of, the old drawing, and module-drift already blocks and
 * says to place the part again. Warning-only drift never hides a covered hole.
 */
export function withoutStale<F extends { rule: string; parts: string[] }>(checked: F[], verified: { rule: string; severity: string; parts: string[]; redraw?: true }[]): F[] {
  const stale = driftedParts(verified)
  return stale.size ? checked.filter((f) => f.rule !== 'covered-hole' || !f.parts.some((p) => stale.has(p))) : checked
}

export const findingsText = (findings: CliFinding[]): string => findings.map((f) => `${f.severity.toUpperCase()} ${f.rule}: ${f.message}`).join('\n')
export const notCheckedText = (): string => ['Not checked:', ...NOT_CHECKED.map((n) => `  - ${n}`)].join('\n')

function report(io: Io, args: Args, format: string, findings: CliFinding[]): number {
  const ok = !findings.some((f) => f.severity === 'error')
  if (args.flags.has('--json')) printJson(io, { format, ok, findings, notChecked: NOT_CHECKED })
  else io.stdout(`${findings.length ? findingsText(findings) : 'No findings.'}\n\n${notCheckedText()}\n`)
  return ok ? EXIT.ok : EXIT.blocked
}

function sheetOf(command: string, args: Args, io: Io) {
  const [input] = args.positionals
  if (!input) throw new CliError(`${command}: give a sheet file`, EXIT.input)
  const { diagram, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  return diagram
}

export function verifyCommand(args: Args, io: Io): number {
  const diagram = sheetOf('verify', args, io)
  return report(io, args, 'circuitoon-cli/verify/1', uniqueIds(verifyDiagram(diagram, libraryLookup).map(cliFinding)))
}

export function checkCommand(args: Args, io: Io): number {
  const diagram = sheetOf('check', args, io)
  // Module drift is known with or without an intent; only a sheet with one reports verify's findings.
  const all = verifyDiagram(diagram, libraryLookup)
  const checked = withoutStale(checkDiagram(diagram), all)
  const verified = diagram.intent !== undefined ? all.filter((f) => !alsoChecked(f, checked)) : []
  // Readability warnings (never blocking): crowded wires, wires hugging parts, covered labels, many crossings.
  return report(io, args, 'circuitoon-cli/check/1', uniqueIds([...verified, ...checked, ...readabilityFindings(diagram)].map(cliFinding)))
}
