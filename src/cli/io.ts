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

/** The exit codes a failure can carry: never 0, which is success. */
export type ErrorExit = typeof EXIT.blocked | typeof EXIT.input | typeof EXIT.environment

export class CliError extends Error {
  code: ErrorExit
  constructor(message: string, code: ErrorExit) {
    if (code !== EXIT.blocked && code !== EXIT.input && code !== EXIT.environment) throw new RangeError(`CliError exit code must be 1, 2 or 3, not ${String(code)}`)
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

/** Why a write failed, by Node error code: the path is at fault (exit 2) or the machine is (exit 3). */
const WRITE_ERRORS: Record<string, { why: string; exit: ErrorExit }> = {
  EISDIR: { why: 'it is a directory', exit: EXIT.input },
  ERR_FS_EISDIR: { why: 'it is a directory', exit: EXIT.input },
  ENOTDIR: { why: 'a folder on its path is a file', exit: EXIT.input },
  EEXIST: { why: 'a folder on its path is a file', exit: EXIT.input },
  ENOENT: { why: 'its folder cannot be created', exit: EXIT.input },
  EINVAL: { why: 'not a valid path', exit: EXIT.input },
  ENAMETOOLONG: { why: 'the path is too long', exit: EXIT.input },
  EACCES: { why: 'permission denied', exit: EXIT.environment },
  EPERM: { why: 'permission denied', exit: EXIT.environment },
  EROFS: { why: 'the file system is read-only', exit: EXIT.environment },
  ENOSPC: { why: 'no space left on the device', exit: EXIT.environment },
  EDQUOT: { why: 'the disk quota is used up', exit: EXIT.environment },
}

/** A failed write as a CliError that names the path; an unknown cause is an environment problem. */
export function writeError(path: string, err: unknown): CliError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  const known = code !== undefined && Object.hasOwn(WRITE_ERRORS, code) ? WRITE_ERRORS[code] : undefined
  const why = known?.why ?? (err instanceof Error ? err.message : String(err))
  return new CliError(`${path}: cannot write the file (${why})`, known?.exit ?? EXIT.environment)
}

export function writeFile(io: Io, path: string, content: string | Uint8Array): void {
  const full = pathIn(io, path)
  try {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  } catch (err) {
    throw writeError(path, err)
  }
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
