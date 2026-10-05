// npm run engine:build (spec 2.2): builds the ngspice WASM in Docker from engine/ngspice, copies
// ngspice.mjs and ngspice.wasm into public/sim/ (the site) and plugin/dist-cli/ (the CLI), writes
// engine.json (what the loaders read, with the wasm size for progress, ruling R25) and NOTICE.txt,
// and runs the engine smoke tests. `--mode exe` builds the fallback executable (ruling R28).
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(join(root, 'engine/ngspice/versions.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)),
)
const i = process.argv.indexOf('--mode')
const mode = i > 0 ? process.argv[i + 1] : env.BUILD_MODE
if (!['shared', 'shared-noxspice', 'exe'].includes(mode)) {
  console.error(`engine: unknown mode '${mode}' (shared, shared-noxspice or exe)`)
  process.exit(2)
}
const out = join(root, 'engine/out')
mkdirSync(out, { recursive: true })
// MSYS_NO_PATHCONV: from Git Bash, keep /out a container path.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
run('docker', ['build', '--build-arg', `EMSDK_IMAGE=${env.EMSDK_IMAGE}`, '-t', 'circuitoon-ngspice', 'engine/ngspice'])
run('docker', ['run', '--rm', '-e', `BUILD_MODE_OVERRIDE=${mode}`, '-v', `${out}:/out`, 'circuitoon-ngspice'])

const wasm = readFileSync(join(out, 'ngspice.wasm'))
const manifest = {
  ngspice: env.NGSPICE_VERSION,
  build: env.BUILD,
  mode,
  emsdk: env.EMSDK_VERSION,
  wasmBytes: wasm.length,
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  release: `https://github.com/MBarc/circuitoon/releases/tag/${env.RELEASE_TAG}`,
}
// The licence texts build.sh copies beside the binary; NOTICE.txt names them.
const LICENCES = ['LICENSE-ngspice.txt', 'LICENSE-LGPL-2.txt', 'LICENSE-emscripten.txt']
const scan = readFileSync(join(out, 'licence-scan.txt'), 'utf8').trim()
const notice = readFileSync(join(root, 'engine/ngspice/NOTICE.template.txt'), 'utf8')
  .replaceAll('{{VERSION}}', env.NGSPICE_VERSION)
  .replaceAll('{{BUILD}}', env.BUILD)
  .replaceAll('{{RELEASE}}', manifest.release)
  .replace('{{SCAN}}', scan || '(none found)')
for (const dir of ['public/sim', 'plugin/dist-cli']) {
  mkdirSync(join(root, dir), { recursive: true })
  for (const f of ['ngspice.mjs', 'ngspice.wasm', ...LICENCES]) copyFileSync(join(out, f), join(root, dir, f))
  writeFileSync(join(root, dir, 'engine.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(root, dir, 'NOTICE.txt'), notice)
}
const gz = gzipSync(wasm, { level: 9 }).length
console.log(`engine: ${mode} build ${env.BUILD}, wasm ${wasm.length} bytes (${(gz / 1048576).toFixed(2)} MB gzip)`)
// XSPICE makes the binary bigger. Over budget never fails silently: it is printed here, written
// beside the build, and recorded in the ledger (Step 6) as a budget miss for the checkpoint.
if (gz > 2.5 * 1048576) {
  console.error(`engine: BUDGET MISS: ${(gz / 1048576).toFixed(2)} MB gzip is over the 2.5 MB download budget (spec 8); record it in the ledger`)
  writeFileSync(join(out, 'BUDGET-MISS.txt'), `${gz} bytes gzip > 2.5 MB (spec 8)\n`)
}
process.exit(spawnSync('npx', ['vitest', 'run', 'src/sim/engine/smoke.test.ts', 'src/sim/engine/wasm.test.ts'], { stdio: 'inherit', shell: true, cwd: root }).status ?? 1)
