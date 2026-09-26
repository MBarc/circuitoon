// Checks that every module generator (scripts/gen-*.mjs) still reproduces the files in modules/.
//
// Runs each generator with `--check` (build in memory, compare, write nothing) and reports every
// generator that fails, not just the first. A generator that does not import lib/gen-output.mjs
// fails without being run: it could ignore --check and rewrite modules/ while exiting 0.
// Exit code 0 when every generator matches, 1 otherwise. `npm run check:gen` runs this; the
// deploy script calls it before building. An optional directory argument replaces scripts/ (tests).
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(process.argv[2] ?? fileURLToPath(new URL('.', import.meta.url)))
const generators = readdirSync(dir).filter((f) => /^gen-.*\.mjs$/.test(f)).sort()
if (!generators.length) {
  console.error(`check-gen: no gen-*.mjs generators found in ${dir}`)
  process.exit(1)
}

const USES_HELPER = /from\s+['"][^'"]*\/lib\/gen-output\.mjs['"]/
const failed = []
for (const file of generators) {
  const path = join(dir, file)
  if (!USES_HELPER.test(readFileSync(path, 'utf8'))) {
    failed.push(`${file}: does not import lib/gen-output.mjs, so its --check cannot be trusted`)
    continue
  }
  const r = spawnSync(process.execPath, [path, '--check'], { encoding: 'utf8' })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.status !== 0) failed.push(`${file}: exited ${r.status}${r.stderr ? `\n    ${r.stderr.trim().replace(/\n/g, '\n    ')}` : ''}`)
}

if (failed.length) {
  console.log(`check-gen: ${failed.length} of ${generators.length} generators failed:`)
  for (const f of failed) console.log(`  FAIL ${f}`)
  process.exit(1)
}
console.log(`check-gen: all ${generators.length} generators match modules/`)
