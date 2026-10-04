// The circuitoon CLI (agent toolkit spec section 4): one entry for every command. Plain text by
// default; --json prints one JSON document on stdout; diagnostics go to stderr. Exit codes: 0 ok,
// 1 findings that block, 2 invalid input, 3 environment problem (such as no browser). In --json mode
// every failure that has no command result (a usage error, an unknown command, a CliError, an
// unexpected exception) prints one error envelope, circuitoon-cli/error/1, and keeps its exit code
// (amendment A10). An unexpected exception, or a rejection nothing handled, exits 3 with the code
// "internal" (Ruling T8), so an agent never reads a crash of the tool as a design that is blocked.
// Help under --json is one document too, circuitoon-cli/help/1.
import { type Args, parseArgs } from './args.ts'
import { CliError, EXIT, type Io, printJson } from './io.ts'
import { partCommand, partsCommand } from './parts.ts'
import { gateCommand } from './gate.ts'
import { layoutCommand } from './layoutCmd.ts'
import { linkCommand } from './linkCmd.ts'
import { renderCommand } from './render.ts'
import { checkCommand, verifyCommand } from './verifyCmd.ts'
import { bomCommand } from './bomCmd.ts'
import { explainCommand } from './explain.ts'
import { netlistCommand } from './netlistCmd.ts'
import { updateCommand } from './updateCmd.ts'
import { moduleCommand } from './moduleCmd.ts'
import { readFileSync } from 'node:fs'

export const USAGE = `circuitoon <command> [options]

  parts [--search text] [--json]            built-in parts: pins, labels, types, supplies, hole groups
  part <id> [--json]                        one part in full
  layout <netlist.json> -o <sheet.json>     lay out a netlist; or layout --keep <partial.json> -o <sheet.json>
                                            [--labels none|auto|all]: which nets get net labels (default none: wires, labels only on nets marked "label": true)
  verify <sheet.json> [--json]              the sheet against its intent
  check <sheet.json> [--json]               the wiring checker, plus verify when the sheet has an intent
  update <sheet.json> [-o <out.json>] [--json]
                                            bring stored parts up to date where the library only adds data; blocking drift is listed
  explain <sheet.json|netlist.json> [--json]
                                            every connection in plain English by net, what each pin in use does,
                                            unconnected parts and the pin-rule findings
  render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus <copy or group>]
                                            [--tiles <px>]: also zoomed tiles of the sheet, <px> square each, as <sheet>-tile-<row>-<col>.png
  link <sheet.json> [-o <dir>] [--json]     a link that opens the sheet in Circuitoon
  bom <sheet.json> [-o <bom.csv>] [--json]  the bill of materials: parts, wires and connectors; -o writes CSV
  netlist <sheet.json> [-o <netlist.json>] [--json]
                                            the netlist of any drawn sheet, from what conducts on it; lay it out again with layout
  gate <sheet.json> -o <dir> [--json]       every check, the renders, the bill and the link; exits 0 only when nothing blocks
  module new [--spec <spec.json>] [-o <part.json>] [--json]
                                            a custom part from a part spec (or the spec on standard input), with Sticker art
  module check <part.json> [--json]         lint a part: duplicate pins, art against pins, impossible caps, untyped power pins
  module render <part.json> -o <part.png> [--svg <part.svg>] [--dark] [--scale n]
                                            draw one part alone, to look at it

Exit codes: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (such as no browser)
or an internal error of the tool.
`

export type Command = (args: Args, io: Io) => number | Promise<number>
export const COMMANDS: Record<string, Command> = { parts: partsCommand, part: partCommand, layout: layoutCommand, render: renderCommand, link: linkCommand, bom: bomCommand, netlist: netlistCommand, verify: verifyCommand, check: checkCommand, explain: explainCommand, update: updateCommand, gate: gateCommand, module: moduleCommand }

type ErrorCode = 'usage' | 'input' | 'blocked' | 'environment' | 'internal'
const CODE_OF: Record<number, ErrorCode> = { [EXIT.blocked]: 'blocked', [EXIT.input]: 'input', [EXIT.environment]: 'environment' }

function fail(io: Io, json: boolean, exit: number, code: ErrorCode, message: string, usage = false): number {
  if (json) printJson(io, { format: 'circuitoon-cli/error/1', ok: false, exit, error: { code, message } })
  else io.stderr(`${message}\n${usage ? `\n${USAGE}` : ''}`)
  return exit
}

/**
 * An unexpected exception: exit 3 with the code "internal" (Ruling T8). Text mode adds the stack
 * after the message, for a bug report.
 */
export function internalFailure(io: Io, json: boolean, err: unknown): number {
  const message = `internal error: ${err instanceof Error ? err.message : String(err)}`
  if (json) return fail(io, json, EXIT.environment, 'internal', message)
  io.stderr(`${message}\n${err instanceof Error && err.stack ? `${err.stack}\n` : ''}`)
  return EXIT.environment
}

export async function main(argv: string[], io: Io): Promise<number> {
  // Known before parsing, so even a usage error answers in JSON when --json was asked for.
  const json = argv.includes('--json')
  const parsed = parseArgs(argv)
  if (!parsed.ok) return fail(io, json, EXIT.input, 'usage', parsed.error, true)
  const args = parsed.value
  if (args.command === undefined || args.command === 'help' || args.flags.has('--help')) {
    if (json) printJson(io, { format: 'circuitoon-cli/help/1', usage: USAGE })
    else io.stdout(USAGE)
    return EXIT.ok
  }
  const command = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined
  if (!command) return fail(io, json, EXIT.input, 'usage', `unknown command "${args.command}"`, true)
  try {
    return await command(args, io)
  } catch (err) {
    if (err instanceof CliError) return fail(io, json, err.code, CODE_OF[err.code], err.message)
    return internalFailure(io, json, err)
  }
}

/**
 * Runs the CLI on this process; plugin/bin/circuitoon.mjs calls it. A reader that closes early
 * (`circuitoon parts --json | head`) ends the run quietly instead of with an EPIPE stack trace. An
 * exception or a rejection that escapes the command exits 3 as an internal error, like one it throws.
 */
export function run(argv: string[]): Promise<number> {
  const io: Io = {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    cwd: process.cwd(),
    env: process.env,
    // Only a pipe or a file: an interactive terminal would wait for typing.
    stdin: () => (process.stdin.isTTY ? '' : readFileSync(0, 'utf8')),
  }
  const crash = (err: unknown) => {
    process.exitCode = internalFailure(io, argv.includes('--json'), err)
  }
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') return crash(e)
    process.exit()
  })
  process.on('unhandledRejection', crash)
  process.on('uncaughtException', crash)
  return main(argv, io)
}
