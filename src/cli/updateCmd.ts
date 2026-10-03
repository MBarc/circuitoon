// `circuitoon update <sheet.json> [-o <out.json>] [--json]` (Ruling D1): brings the sheet's stored
// built-in parts up to date where the library only adds or describes data (pin caps, I2C data, a
// footprint, art), and prints what changed per part. A copy whose drift blocks (pins, holes,
// internal joins, geometry) is left alone and listed: that part must be placed again. The sheet is
// written back in place, or to -o; only the changed modules are replaced, the rest of the file is
// kept as it was. Exit 0, or 1 when blocking drift remains; 2 for a file that is not a sheet.
import { libraryLookup } from '../agent/catalog.ts'
import { updateLines, updateParts } from '../format/moduleDrift.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, printJson, readJson, writeFile } from './io.ts'

export const UPDATE_CMD_FORMAT = 'circuitoon-cli/update/1'

export function updateCommand(args: Args, io: Io): number {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('update: give a sheet file', EXIT.input)
  if (rest.length) throw new CliError(`update: give one sheet file, not ${args.positionals.length}`, EXIT.input)
  const { diagram, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const u = updateParts(diagram, libraryLookup)
  const out = flag(args, '--out') ?? input
  const changed = u.updated.length > 0
  if (changed || out !== input) {
    // The file as written, with only the updated modules replaced.
    const raw = readJson(io, input) as { modules: Record<string, unknown> }
    for (const x of u.updated) raw.modules[x.id] = u.diagram.modules[x.id]
    writeFile(io, out, `${JSON.stringify(raw, null, 2)}\n`)
  }
  const ok = u.blocked.length === 0
  if (args.flags.has('--json')) printJson(io, { format: UPDATE_CMD_FORMAT, ok, sheet: input, output: changed || out !== input ? out : null, updated: u.updated, blocked: u.blocked })
  else {
    const lines = updateLines(u)
    if (!lines.length) io.stdout('Every part is up to date with the library.\n')
    else io.stdout(`${lines.join('\n')}\n`)
    if (changed || out !== input) io.stdout(`Wrote ${out}.\n`)
  }
  return ok ? EXIT.ok : EXIT.blocked
}
