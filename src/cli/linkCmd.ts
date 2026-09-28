// `circuitoon link <sheet.json> [-o <dir>]` (agent toolkit spec 6): a URL that opens the sheet in
// Circuitoon. When the sheet breaks a link limit (64 KB of payload, 5 MB of JSON, 2,000 parts or
// 10,000 connections, the check the site applies when opening one: amendment A9) no link is made;
// the sheet is written as <title>.circuitoon.json in the output directory (default: next to the
// sheet) for the user to open with Import JSON. Either way the exit code is 0.
import { dirname, join, resolve } from 'node:path'
import { type Diagram, serializeDiagram } from '../format/diagram.ts'
import { type LinkLimit, LINK_NOTICE, diagramLink, limitText } from '../format/link.ts'
import { exportFileName } from '../editor/files.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, loadSheet, pathIn, printJson, writeFile } from './io.ts'

/** Why no link was made, in plain words. */
export function refusalText(l: LinkLimit): string {
  if (l.limit === 'chars') return `The link would be ${l.count.toLocaleString('en')} characters, more than the ${l.max.toLocaleString('en')} a link may carry, so no link was made.`
  return `The sheet has ${limitText(l)}, so no link was made.`
}

/**
 * The link for `d`, or the file written instead when it breaks a limit. `from` is the sheet's own
 * path: when the file would be the sheet itself, it is left as it is (it already imports).
 */
export async function linkFor(d: Diagram, dir: string, io: Io, from?: string): Promise<{ url: string | null; file: string | null; chars: number; reason: string | null }> {
  const r = await diagramLink(d)
  if (r.ok) return { url: r.url, file: null, chars: r.chars, reason: null }
  const file = join(dir, exportFileName(d.title))
  if (from === undefined || resolve(pathIn(io, file)) !== resolve(pathIn(io, from))) writeFile(io, file, serializeDiagram(d))
  return { url: null, file, chars: r.chars, reason: refusalText(r.limit) }
}

export async function linkCommand(args: Args, io: Io): Promise<number> {
  const [input, ...rest] = args.positionals
  if (!input) throw new CliError('link: give a sheet file', EXIT.input)
  if (rest.length) throw new CliError(`link: give one sheet file, not ${args.positionals.length}`, EXIT.input)
  const { diagram, warnings } = loadSheet(io, input)
  for (const w of warnings) io.stderr(`warning: ${w}\n`)
  const r = await linkFor(diagram, flag(args, '--out') ?? dirname(input), io, input)
  if (args.flags.has('--json')) printJson(io, { format: 'circuitoon-cli/link/1', ok: r.url !== null, url: r.url, chars: r.chars, file: r.file, reason: r.reason, notice: LINK_NOTICE })
  else if (r.url) io.stdout(`${r.url}\n${LINK_NOTICE}\n`)
  else io.stdout(`${r.reason} Wrote ${r.file}: open it in Circuitoon with Import JSON.\n`)
  return EXIT.ok
}
