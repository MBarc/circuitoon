// npm test: the timing tests (*.perf.test.ts) run on their own after the rest of the suite, one
// file at a time, because running them beside dozens of parallel test workers made their budgets
// flake and block deploys. With arguments (npm test -- src/agent) it is a plain `vitest run`.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const run = (a) => spawnSync('npx', ['vitest', 'run', ...a], { stdio: 'inherit', shell: true }).status ?? 1

if (args.length) process.exit(run(args))
const unit = run(['--exclude', '"**/*.perf.test.ts"'])
if (unit !== 0) process.exit(unit)
// Right after the main suite the machine is often still busy (and other desktop apps compete for
// the CPU), so a timing budget can miss once. Run the timing files again once before failing:
// a real slowdown fails both times; a busy moment does not.
const perf = ['--no-file-parallelism', '.perf.test.ts']
if (run(perf) === 0) process.exit(0)
console.log('\nTiming tests missed a budget; running them once more on their own.\n')
process.exit(run(perf))
