// Firmware spec 2.7: the build copies the pinned Pyodide's core files into dist/py/<version>/ with
// py.json (names, sha256, bytes), the licences and a NOTICE; nothing is committed but the manifest;
// the deploy carries every older py/<version>/ forward from gh-pages.
import { describe, expect, it } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import PY from '../src/run/pyManifest.json' with { type: 'json' }

const node = (script: string, args: string[]) => spawnSync(process.execPath, [resolve(script), ...args], { encoding: 'utf8' })
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('Pyodide files (spec 2.7)', () => {
  it('pins the package version and lists the five core files with their hashes', () => {
    expect(PY.version).toBe(JSON.parse(readFileSync('node_modules/pyodide/package.json', 'utf8')).version)
    expect(PY.files.map((f) => f.name)).toEqual(['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
    for (const f of PY.files) expect(sha(`node_modules/pyodide/${f.name}`), f.name).toBe(f.sha256)
    expect(PY.python).toMatch(/^3\.\d+\.\d+$/)
  })
  it('copies them with py.json, the licences and the NOTICE into dist/py/<version>/', () => {
    const dist = mkdtempSync(join(tmpdir(), 'py-dist-'))
    const r = node('scripts/copy-py.mjs', ['--dist', dist])
    expect(r.status, r.stderr).toBe(0)
    const dir = join(dist, 'py', PY.version)
    for (const f of PY.files) expect(sha(join(dir, f.name))).toBe(f.sha256)
    expect(JSON.parse(readFileSync(join(dir, 'py.json'), 'utf8'))).toEqual(PY)
    for (const f of ['NOTICE.txt', 'LICENSE-MPL-2.0.txt', 'LICENSE-PSF.txt']) expect(existsSync(join(dir, f)), f).toBe(true)
    expect(readFileSync(join(dir, 'NOTICE.txt'), 'utf8')).toContain(`https://github.com/pyodide/pyodide/releases/tag/${PY.version}`)
  })
  it('carries older versions forward from gh-pages, never over the current one', () => {
    const repo = mkdtempSync(join(tmpdir(), 'py-pages-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo })
    git('init', '-q', '-b', 'gh-pages')
    mkdirSync(join(repo, 'py', '0.1.0'), { recursive: true })
    mkdirSync(join(repo, 'py', PY.version), { recursive: true })
    writeFileSync(join(repo, 'py', '0.1.0', 'pyodide.mjs'), 'old')
    writeFileSync(join(repo, 'py', PY.version, 'pyodide.mjs'), 'stale')
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'pages')
    const dist = mkdtempSync(join(tmpdir(), 'py-dist-'))
    mkdirSync(join(dist, 'py', PY.version), { recursive: true })
    writeFileSync(join(dist, 'py', PY.version, 'pyodide.mjs'), 'current')
    const r = node('scripts/carry-py.mjs', ['--remote', repo, '--dist', dist])
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(join(dist, 'py', '0.1.0', 'pyodide.mjs'), 'utf8')).toBe('old')
    expect(readFileSync(join(dist, 'py', PY.version, 'pyodide.mjs'), 'utf8')).toBe('current')
  })
  it('succeeds when the remote has no gh-pages branch yet', () => {
    const repo = mkdtempSync(join(tmpdir(), 'py-nobranch-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: repo })
    const r = node('scripts/carry-py.mjs', ['--remote', repo, '--dist', mkdtempSync(join(tmpdir(), 'py-dist-'))])
    expect(r.status, r.stderr).toBe(0)
  })
  it('fails (so the deploy aborts) when the remote cannot be reached', () => {
    const r = node('scripts/carry-py.mjs', ['--remote', join(tmpdir(), 'py-no-such-remote-dir'), '--dist', mkdtempSync(join(tmpdir(), 'py-dist-'))])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('not deploying')
  })
})
