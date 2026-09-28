// Builds the agent toolkit CLI into one ES module, plugin/dist-cli/circuitoon.mjs, with Vite
// (vite.cli.config.ts). The bundle is committed so the Claude Code plugin works with no install
// step. With --check (npm run check:gen) it is built in memory and compared with the committed file
// instead, so a source or module change without `npm run build:cli` fails the check.
//
// NODE_ENV is forced to production before Vite loads (amendment A13): vitest sets it to "test",
// spawned generators inherit it, and under it the React plugin emits the dev JSX runtime, a
// different (and broken) bundle. Static imports run before this module's body, so Vite is imported
// dynamically, after the assignment.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECK, emit, finish, log } from './lib/gen-output.mjs'

process.env.NODE_ENV = 'production'
const { build } = await import('vite')

const root = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  root,
  configFile: fileURLToPath(new URL('../vite.cli.config.ts', import.meta.url)),
  logLevel: 'error',
  build: { write: false },
})
const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).filter((o) => o.type === 'chunk')
if (chunks.length !== 1 || chunks[0].fileName !== 'circuitoon.mjs') {
  console.error(`gen-cli.mjs: expected one chunk named circuitoon.mjs, got ${chunks.map((c) => c.fileName).join(', ')}`)
  process.exit(1)
}
const out = fileURLToPath(new URL('../plugin/dist-cli/circuitoon.mjs', import.meta.url))
if (!CHECK) mkdirSync(dirname(out), { recursive: true })
emit(out, chunks[0].code)
log('plugin/dist-cli/circuitoon.mjs', Math.round(chunks[0].code.length / 1024), 'KB')
finish('gen-cli.mjs')
