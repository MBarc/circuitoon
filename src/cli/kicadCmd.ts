// `circuitoon kicad <sheet|netlist> [-o <out.net>] [--json]`: the design as a KiCad netlist
// (format/kicad.ts), for KiCad's PCB Editor (File > Import > Netlist). A sheet is exported from what
// conducts on it, a netlist (circuitoon-netlist/1) from its nets. Without -o the netlist is printed;
// with it, written, and a one-line summary printed. Parts without a KiCad footprint, placeholder
// footprints and pins without a pad are warnings (on stderr, and in the JSON report): exporting never
// blocks, so it exits 0, or 2 for input that is neither a sheet nor a netlist.
import { validateDiagram } from '../format/diagram.ts'
import { type KicadExport, intentSource, sheetSource, writeKicad } from '../format/kicad.ts'
import { NETLIST_FORMAT, parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, printJson, readJson, writeFile } from './io.ts'

export const KICAD_FORMAT = 'circuitoon-cli/kicad/1'

export function kicadCommand(args: Args, io: Io): number {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('kicad: give a sheet or netlist file', EXIT.input)
  if (rest.length) throw new CliError(`kicad: give one sheet or netlist file, not ${args.positionals.length}`, EXIT.input)
  const raw = readJson(io, input)
  const name = input.split(/[\\/]/).pop()!
  let source: 'sheet' | 'netlist'
  let x: KicadExport
  if ((raw as { format?: unknown } | null)?.format === NETLIST_FORMAT) {
    const r = parseNetlist(raw, libraryLookup)
    if (!r.ok) throw new CliError(`${input} is not a valid netlist: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    source = 'netlist'
    x = writeKicad(intentSource(r.intent), { library: libraryLookup, source: name })
  } else {
    const r = validateDiagram(raw)
    if (!r.ok) throw new CliError(`${input} is neither a Circuitoon sheet nor a netlist: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
    for (const w of r.warnings) io.stderr(`warning: ${w}\n`)
    source = 'sheet'
    x = writeKicad(sheetSource(r.diagram), { library: libraryLookup, source: name })
  }
  const out = flag(args, '--out') ?? null
  if (out) writeFile(io, out, x.text)
  if (args.flags.has('--json')) {
    printJson(io, {
      format: KICAD_FORMAT, ok: true, input, source, output: out,
      components: x.components, nets: x.nets, unmapped: x.unmapped, placeholders: x.placeholders, warnings: x.warnings, notes: x.notes,
      ...(out ? {} : { netlist: x.text }),
    })
    return EXIT.ok
  }
  for (const w of x.warnings) io.stderr(`warning: ${w}\n`)
  for (const n of x.notes) io.stderr(`note: ${n}\n`)
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  if (out) io.stdout(`Wrote ${out}: ${plural(x.components, 'component')}, ${plural(x.nets, 'net')}${x.unmapped.length ? `, ${x.unmapped.length} on a generic footprint` : ''}. Open it in KiCad's PCB Editor with File > Import > Netlist.\n`)
  else io.stdout(x.text)
  return EXIT.ok
}
