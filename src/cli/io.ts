// What every CLI command shares: where output goes (so tests capture it), exit codes, files relative
// to the working directory, and loading a sheet the way the site does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { type Diagram, validateDiagram } from '../format/diagram.ts'
import type { Args } from './args.ts'

/** Spec 4.2: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (no browser). */
export const EXIT = { ok: 0, blocked: 1, input: 2, environment: 3 } as const

export interface Io {
  stdout(text: string): void
  stderr(text: string): void
  cwd: string
  env: Record<string, string | undefined>
}

export class CliError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

export const pathIn = (io: Io, path: string): string => resolve(io.cwd, path)

export function readJson(io: Io, path: string): unknown {
  let text: string
  try {
    text = readFileSync(pathIn(io, path), 'utf8')
  } catch {
    throw new CliError(`${path}: cannot read the file`, EXIT.input)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new CliError(`${path}: not valid JSON (${(e as Error).message})`, EXIT.input)
  }
}

export function writeFile(io: Io, path: string, content: string | Uint8Array): void {
  const full = pathIn(io, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export const printJson = (io: Io, value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`)

export function flag(args: Args, name: string): string | undefined {
  const v = args.flags.get(name)
  return typeof v === 'string' ? v : undefined
}

/** A sheet loaded like the site loads it; one that does not load is invalid input (exit 2). */
export function loadSheet(io: Io, path: string): { diagram: Diagram; warnings: string[] } {
  const r = validateDiagram(readJson(io, path))
  if (!r.ok) throw new CliError(`${path} is not a Circuitoon sheet: ${r.errors.slice(0, 5).join('; ')}`, EXIT.input)
  return { diagram: r.diagram, warnings: r.warnings }
}
