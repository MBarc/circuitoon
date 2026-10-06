// The pinned Pyodide's manifest (firmware spec 2.7): src/run/pyManifest.json names the core files the
// site serves and the CLI downloads, each with its sha256 and size, from node_modules/pyodide. The CLI
// compiles the hashes in; the build copies the files (copy-py.mjs). `npm run check:gen` runs this
// with --check, so a version bump without regenerating fails.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { emit, finish, log } from './lib/gen-output.mjs'

/** Only the core and the stdlib (spec 2.7): no packages, no micropip. */
export const PY_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const dir = fileURLToPath(new URL('../node_modules/pyodide/', import.meta.url))
const version = JSON.parse(readFileSync(`${dir}package.json`, 'utf8')).version
const python = JSON.parse(readFileSync(`${dir}pyodide-lock.json`, 'utf8')).info.python
const files = PY_FILES.map((name) => {
  const bytes = readFileSync(dir + name)
  return { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
})
const out = fileURLToPath(new URL('../src/run/pyManifest.json', import.meta.url))
emit(out, `${JSON.stringify({ version, python, source: `https://github.com/pyodide/pyodide/releases/tag/${version}`, files }, null, 2)}\n`)
log('src/run/pyManifest.json', version, `Python ${python}`)
finish('gen-py.mjs')
