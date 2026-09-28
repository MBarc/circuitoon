// The circuitoon CLI (agent toolkit spec section 4): one entry for every command. Plain text by
// default; --json prints one JSON document on stdout; diagnostics go to stderr. Exit codes: 0 ok,
// 1 findings that block, 2 invalid input, 3 environment problem (such as no browser). In --json mode
// every failure that has no command result (a usage error, an unknown command, a CliError, an
// unexpected exception) prints one error envelope, circuitoon-cli/error/1, and keeps its exit code
// (amendment A10).
import { type Args, parseArgs } from './args.ts'
import { CliError, EXIT, type Io, printJson } from './io.ts'
import { partCommand, partsCommand } from './parts.ts'
import { layoutCommand } from './layoutCmd.ts'

export const USAGE = `circuitoon <command> [options]

  parts [--search text] [--json]            built-in parts: pins, labels, types, supplies, hole groups
  part <id> [--json]                        one part in full
  layout <netlist.json> -o <sheet.json>     lay out a netlist; or layout --keep <partial.json> -o <sheet.json>
  verify <sheet.json> [--json]              the sheet against its intent
  check <sheet.json> [--json]               the wiring checker, plus verify when the sheet has an intent
  render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus <copy or group>]
  link <sheet.json> [-o <dir>] [--json]     a link that opens the sheet in Circuitoon
  gate <sheet.json> -o <dir> [--json]       every check, the renders and the link; exits 0 only when nothing blocks

Exit codes: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (such as no browser).
`

export type Command = (args: Args, io: Io) => number | Promise<number>
export const COMMANDS: Record<string, Command> = { parts: partsCommand, part: partCommand, layout: layoutCommand }

type ErrorCode = 'usage' | 'input' | 'blocked' | 'environment' | 'internal'
const CODE_OF: Record<number, ErrorCode> = { [EXIT.blocked]: 'blocked', [EXIT.input]: 'input', [EXIT.environment]: 'environment' }

export async function main(argv: string[], io: Io): Promise<number> {
  // Known before parsing, so even a usage error answers in JSON when --json was asked for.
  const json = argv.includes('--json')
  const fail = (exit: number, code: ErrorCode, message: string, usage = false): number => {
    if (json) printJson(io, { format: 'circuitoon-cli/error/1', ok: false, exit, error: { code, message } })
    else io.stderr(`${message}\n${usage ? `\n${USAGE}` : ''}`)
    return exit
  }
  const parsed = parseArgs(argv)
  if (!parsed.ok) return fail(EXIT.input, 'usage', parsed.error, true)
  const args = parsed.value
  if (args.command === undefined || args.command === 'help' || args.flags.has('--help')) {
    io.stdout(USAGE)
    return EXIT.ok
  }
  const command = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined
  if (!command) return fail(EXIT.input, 'usage', `unknown command "${args.command}"`, true)
  try {
    return await command(args, io)
  } catch (err) {
    if (err instanceof CliError) return fail(err.code, CODE_OF[err.code] ?? 'internal', err.message)
    if (!json) throw err
    return fail(EXIT.blocked, 'internal', `internal error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Runs the CLI on this process; plugin/bin/circuitoon.mjs calls it. A reader that closes early
 * (`circuitoon parts --json | head`) ends the run quietly instead of with an EPIPE stack trace.
 */
export function run(argv: string[]): Promise<number> {
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') throw e
    process.exit()
  })
  return main(argv, {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    cwd: process.cwd(),
    env: process.env,
  })
}
