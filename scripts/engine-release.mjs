// npm run engine:release: packs what spec 2.2 asks the release to carry (the exact ngspice tarball,
// our patches, the build files with the emsdk version, RELINK.md) and publishes it as a GitHub
// release asset with gh. Re-running for an existing tag replaces the asset (--clobber).
// --dry-run builds and prints the tarball but makes no gh calls.
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(join(root, 'engine/ngspice/versions.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)),
)
const name = `circuitoon-ngspice-${env.BUILD}-source`
const parent = mkdtempSync(join(tmpdir(), 'engine-release-'))
const dir = join(parent, name)
cpSync(join(root, 'engine/ngspice'), dir, { recursive: true })
const tarball = join(dir, `ngspice-${env.NGSPICE_VERSION}.tar.gz`)
execFileSync('curl', ['-fsSL', '-o', tarball, env.NGSPICE_URL], { stdio: 'inherit' })
const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex')
if (sum !== env.NGSPICE_SHA256) throw new Error(`engine-release: tarball hash ${sum} does not match versions.env`)
copyFileSync(join(root, 'public/sim/engine.json'), join(dir, 'engine.json'))
writeFileSync(join(dir, 'README.txt'), `Circuitoon engine build ${env.BUILD}: ngspice ${env.NGSPICE_VERSION}, emsdk ${env.EMSDK_VERSION} (${env.EMSDK_IMAGE}).\nSee RELINK.md to rebuild and replace ngspice.wasm.\n`)
const tar = join(parent, `${name}.tar.gz`)
// relative paths with cwd=parent: Git Bash's GNU tar reads a drive letter as host:path
execFileSync('tar', ['czf', `${name}.tar.gz`, name], { cwd: parent, stdio: 'inherit' })
if (dryRun) {
  console.log(`engine-release: dry run, ${tar} (${statSync(tar).size} bytes); nothing published`)
  process.exit(0)
}
const notes = `ngspice ${env.NGSPICE_VERSION} compiled to WebAssembly for Circuitoon's simulator (engine build ${env.BUILD}). The asset holds the exact ngspice source tarball, our patches, the build script and emsdk version, and relinking instructions.`
let exists = true
try {
  execFileSync('gh', ['release', 'view', env.RELEASE_TAG, '-R', 'MBarc/circuitoon'], { stdio: 'ignore' })
} catch {
  exists = false
}
if (exists) execFileSync('gh', ['release', 'upload', env.RELEASE_TAG, tar, '--clobber', '-R', 'MBarc/circuitoon'], { stdio: 'inherit' })
else execFileSync('gh', ['release', 'create', env.RELEASE_TAG, tar, '-R', 'MBarc/circuitoon', '--title', `Simulation engine ${env.BUILD}`, '--notes', notes], { stdio: 'inherit' })
console.log(`engine-release: ${env.RELEASE_TAG} has ${name}.tar.gz`)
