// Copies the pinned Pyodide into the built site (firmware spec 2.7): dist/py/<version>/ gets the core
// files (checked against src/run/pyManifest.json), py.json and the licences. `npm run build` runs it
// after vite build. Usage: node scripts/copy-py.mjs [--dist dist]
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const at = process.argv.indexOf('--dist')
const dist = at < 0 ? 'dist' : process.argv[at + 1]
const PY = JSON.parse(readFileSync('src/run/pyManifest.json', 'utf8'))
const dir = join(dist, 'py', PY.version)
mkdirSync(dir, { recursive: true })
for (const f of PY.files) {
  const bytes = readFileSync(join('node_modules', 'pyodide', f.name))
  if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) {
    console.error(`copy-py: node_modules/pyodide/${f.name} is not the file in src/run/pyManifest.json; run node scripts/gen-py.mjs after changing the Pyodide version`)
    process.exit(1)
  }
  writeFileSync(join(dir, f.name), bytes)
}
writeFileSync(join(dir, 'py.json'), `${JSON.stringify(PY, null, 2)}\n`)
const notice = readFileSync('py/NOTICE.txt', 'utf8')
if (!notice.includes(PY.source)) {
  console.error(`copy-py: py/NOTICE.txt does not name ${PY.source}; update it for the new version`)
  process.exit(1)
}
for (const f of ['NOTICE.txt', 'LICENSE-MPL-2.0.txt', 'LICENSE-PSF.txt']) copyFileSync(join('py', f), join(dir, f))
console.log(`copy-py: ${dir} (${PY.files.length} files, Python ${PY.python})`)
