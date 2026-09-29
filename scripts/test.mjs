// npm test: the timing tests (*.perf.test.ts) run on their own after the rest of the suite, one
// file at a time, because running them beside dozens of parallel test workers made their budgets
// flake and block deploys. With arguments (npm test -- src/agent) it is a plain `vitest run`.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const run = (a) => spawnSync('npx', ['vitest', 'run', ...a], { stdio: 'inherit', shell: true }).status ?? 1

if (args.length) process.exit(run(args))
const unit = run(['--exclude', '"**/*.perf.test.ts"'])
if (unit !== 0) process.exit(unit)
process.exit(run(['--no-file-parallelism', '.perf.test.ts']))
