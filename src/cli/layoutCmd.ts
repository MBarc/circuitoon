// `circuitoon layout <netlist.json> -o <sheet.json>` and `layout --keep <partial.json> -o <sheet.json>`,
// with `--labels none|auto|all` (which nets get net labels: by default none but the nets that ask,
// Ruling W1; the report records the mode and the nets)
// (agent toolkit spec 2 and 4.2). Prints the readability report, the bill of quantities and, for
// repeats, the channel allocation table. An invalid netlist exits 2; one that cannot be laid out
// (no seat, needs a distribution point, strip full, blocked routes) exits 1. A partial that names a
// part its intent lacks is laid out anyway, with a warning (stderr, or `warnings` in --json).
import { dirname } from 'node:path'
import { serializeDiagram } from '../format/diagram.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { SPACINGS, layoutNetlist } from '../agent/layout.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { naturalCompare } from '../agent/order.ts'
import { loadPartial } from '../agent/partial.ts'
import type { KeepMap } from '../agent/place.ts'
import { reportText } from '../agent/readability.ts'
import { LABEL_MODES, type LabelMode } from '../agent/labelling.ts'
import { bomQuantities, channelTable, channelsText, quantitiesText, sheetBom } from '../agent/tables.ts'
import type { Args } from './args.ts'
import { embedCode } from './codeFiles.ts'
import { CliError, EXIT, type Io, flag, pathIn, printJson, readJson, writeFile } from './io.ts'

/** Designators the partial keeps that are not parts of its intent (after repeat expansion). */
function unknownKept(path: string, intent: unknown, keep: KeepMap): string[] {
  const parsed = parseNetlist(intent, libraryLookup)
  if (!parsed.ok) return [] // layout reports the invalid intent itself
  const refs = new Set(parsed.intent.parts.map((p) => p.ref))
  return [...keep.keys()]
    .filter((ref) => !refs.has(ref))
    .sort(naturalCompare)
    .map((ref) => `${path} names ${ref}, which is not a part of its intent; its position is ignored`)
}

export function layoutCommand(args: Args, io: Io): number {
  const json = args.flags.has('--json')
  const out = flag(args, '--out')
  const keepPath = flag(args, '--keep')
  const labels = (flag(args, '--labels') ?? 'none') as LabelMode
  if (!LABEL_MODES.includes(labels)) throw new CliError(`layout: --labels must be ${LABEL_MODES.join(', ')}`, EXIT.input)
  const [input] = args.positionals
  if (!out) throw new CliError('layout: -o <sheet.json> is required', EXIT.input)
  if (!input === !keepPath) throw new CliError('layout: give a netlist file, or --keep <partial.json>, but not both', EXIT.input)
  let raw: unknown
  let keep: KeepMap | undefined
  let warnings: string[] = []
  if (keepPath) {
    const p = loadPartial(readJson(io, keepPath))
    if (!p.ok) throw new CliError(`${keepPath}: ${p.errors.join('; ')}`, EXIT.input)
    raw = p.intent
    keep = p.keep
    warnings = unknownKept(keepPath, raw, keep)
  } else raw = embedCode(readJson(io, input!), dirname(pathIn(io, input!)), input!)
  if (!json) for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const r = layoutNetlist(raw, { keep, labels })
  if (!r.ok) {
    if (json) printJson(io, { format: 'circuitoon-cli/layout/1', ok: false, output: null, attempts: 0, report: null, quantities: [], channels: [], warnings, errors: r.errors })
    else io.stderr(`${r.stage === 'input' ? 'The netlist is not valid' : 'The netlist cannot be laid out'}:\n${r.errors.map((e) => `  - ${e}`).join('\n')}\n`)
    return r.stage === 'input' ? EXIT.input : EXIT.blocked
  }
  const { diagram, report, intent, attempts } = r.value
  warnings = [...warnings, ...intent.probeWarnings]
  if (!json) for (const w of intent.probeWarnings) io.stderr(`warning: ${w}\n`)
  writeFile(io, out, serializeDiagram(diagram))
  const q = bomQuantities(sheetBom(diagram))
  const ch = channelTable(intent)
  if (json) {
    printJson(io, { format: 'circuitoon-cli/layout/1', ok: true, output: out, attempts, report, quantities: q, channels: ch, warnings, errors: [] })
    return EXIT.ok
  }
  io.stdout(
    [
      `Laid out "${diagram.title}" into ${out}: ${diagram.parts.length} parts, ${diagram.connections.length} wires (placement ${attempts} of ${SPACINGS.length}).`,
      reportText(report),
      'Bill of quantities:',
      quantitiesText(q),
      ...(ch.length ? ['Channel allocation:', channelsText(ch)] : []),
      ...(intent.custom.length ? [`Custom parts (unverified): ${intent.custom.join(', ')}`] : []),
    ].join('\n') + '\n',
  )
  return EXIT.ok
}
