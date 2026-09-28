// Runs the CLI in-process with captured output, in a throwaway working directory. Test helper.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './main.ts'

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'circuitoon-cli-'))

export async function cli(argv: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  let out = ''
  let err = ''
  const code = await main(argv, { stdout: (s) => void (out += s), stderr: (s) => void (err += s), cwd: opts.cwd ?? process.cwd(), env: opts.env ?? process.env })
  return { code, out, err }
}
