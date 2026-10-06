// Carries every previously released py/<version>/ from the gh-pages branch into dist/ (firmware spec
// 2.7), so a plugin pinned to an older Pyodide keeps working after a deploy (deploy.sh force-pushes
// dist/). The version this build copied is never overwritten. Usage:
//   node scripts/carry-py.mjs --remote <git url or path> [--dist dist]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1]
}
const remote = arg('--remote')
const dist = arg('--dist', 'dist')
if (!remote) {
  console.error('carry-py: --remote <git url or path> is required')
  process.exit(2)
}
const tmp = mkdtempSync(join(tmpdir(), 'carry-py-'))
try {
  try {
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'gh-pages', remote, tmp], { stdio: 'pipe' })
  } catch {
    console.log('carry-py: no gh-pages branch yet; nothing to carry')
    process.exit(0)
  }
  const old = existsSync(join(tmp, 'py')) ? readdirSync(join(tmp, 'py')) : []
  const carried = old.filter((v) => !existsSync(join(dist, 'py', v)))
  for (const v of carried) cpSync(join(tmp, 'py', v), join(dist, 'py', v), { recursive: true })
  console.log(`carry-py: carried ${carried.length ? carried.join(', ') : 'nothing'} forward`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
