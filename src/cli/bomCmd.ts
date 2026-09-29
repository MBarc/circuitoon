// `circuitoon bom <sheet.json> [-o <bom.csv>] [--json]`: the sheet's bill of materials (format/bom.ts),
// the same bill `gate` writes as bom.csv and the editor shows. Text mode prints one line per row; -o
// writes the CSV. A bill never blocks: exit 0, or 2 for input that does not load as a sheet.
import { bomCsv, bomLines } from '../format/bom.ts'
import { sheetBom } from '../agent/tables.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, printJson, writeFile } from './io.ts'

export const BOM_FORMAT = 'circuitoon-cli/bom/1'

export function bomCommand(args: Args, io: Io): number {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('bom: give a sheet file', EXIT.input)
  if (rest.length) throw new CliError(`bom: give one sheet file, not ${args.positionals.length}`, EXIT.input)
  const { diagram, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const bom = sheetBom(diagram)
  const out = flag(args, '--out') ?? null
  if (out) writeFile(io, out, bomCsv(bom))
  const lines = bomLines(bom)
  if (args.flags.has('--json')) printJson(io, { format: BOM_FORMAT, ok: true, sheet: input, output: out, bom, lines })
  else io.stdout([`Bill of materials: ${diagram.title}`, ...lines.map((l) => `  ${l}`), ...(out ? [`Wrote ${out}`] : [])].join('\n') + '\n')
  return EXIT.ok
}
