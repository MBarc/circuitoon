// `circuitoon netlist <sheet.json> [-o <netlist.json>] [--json]`: the netlist (circuitoon-netlist/1)
// of any drawn sheet, extracted from what actually conducts on it (agent/extract.ts), so a user's
// hand-drawn sheet is laid out again from its real circuit, never from a hand copy (Ruling W1).
// Without -o the netlist is printed; with it, written, and a one-line summary printed. A sheet that
// does not load is invalid input (exit 2).
import { extractNetlist } from '../agent/extract.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, printJson, writeFile } from './io.ts'

export const NETLIST_CMD_FORMAT = 'circuitoon-cli/netlist/1'

export function netlistCommand(args: Args, io: Io): number {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('netlist: give a sheet file', EXIT.input)
  if (rest.length) throw new CliError(`netlist: give one sheet file, not ${args.positionals.length}`, EXIT.input)
  const { diagram, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const netlist = extractNetlist(diagram, (w) => io.stderr(`warning: ${w}\n`)) as { parts: unknown[]; nets: unknown[] }
  const out = flag(args, '--out') ?? null
  const text = `${JSON.stringify(netlist, null, 2)}\n`
  if (out) writeFile(io, out, text)
  if (args.flags.has('--json')) printJson(io, { format: NETLIST_CMD_FORMAT, ok: true, sheet: input, output: out, netlist })
  else if (out) io.stdout(`Wrote ${out}: ${netlist.parts.length} parts, ${netlist.nets.length} nets. Lay it out with: circuitoon layout ${out} -o <sheet.json>\n`)
  else io.stdout(text)
  return EXIT.ok
}
