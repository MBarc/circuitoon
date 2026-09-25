// Output shared by the module generators (gen-boards, gen-parts, gen-picos).
//
// Normally each generated file is written to modules/. With `--check` nothing is written: each file
// is built in memory and compared with the copy on disk (CRLF normalized to LF, since a Windows
// checkout may convert line endings), and the generator exits 1 listing every file that differs.
// `npm run check:gen` (scripts/check-gen.mjs) runs every generator this way; the deploy calls it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

export const CHECK = process.argv.includes('--check')
const drifted = []
let count = 0

/** Writes `content` to `path`, or in --check mode records whether the file on disk differs. */
export function emit(path, content) {
  count++
  if (!CHECK) return void writeFileSync(path, content)
  const onDisk = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
  if (onDisk !== content) drifted.push(basename(path) + (onDisk === null ? ' (missing)' : ''))
}

/** Progress line for a written file; silent in --check mode. */
export function log(...args) {
  if (!CHECK) console.log(...args)
}

/** Ends a --check run: reports the result and exits 1 when any file drifted. */
export function finish(generator) {
  if (!CHECK) return
  if (drifted.length) {
    console.error(`${generator}: ${drifted.length} of ${count} generated files differ from modules/ (re-run \`node scripts/${generator}\` and commit):\n  ${drifted.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`${generator}: ${count} generated files match modules/`)
}
