import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RUNNER = resolve('scripts/check-gen.mjs')
const LIB = pathToFileURL(resolve('scripts/lib/gen-output.mjs')).href
const run = (dir?: string) => spawnSync(process.execPath, dir ? [RUNNER, dir] : [RUNNER], { encoding: 'utf8' })

describe('check-gen runner', () => {
  it('passes on the committed generators and modules', () => {
    const r = run()
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/gen-boards\.mjs/)
    expect(r.stdout).toMatch(/gen-picos\.mjs/)
  }, 30_000)

  it('reports every drifted generator, and fails one that does not use the output helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-gen-'))
    try {
      // Uses the helper and matches: passes.
      writeFileSync(join(dir, 'gen-a.mjs'), `import { emit, finish } from '${LIB}'\nfinish('gen-a.mjs')\n`)
      // Uses the helper but drifts: its check fails.
      writeFileSync(join(dir, 'gen-b.mjs'), `import { emit, finish } from '${LIB}'\nemit(${JSON.stringify(join(dir, 'missing.json'))}, '{}')\nfinish('gen-b.mjs')\n`)
      writeFileSync(join(dir, 'gen-c.mjs'), `import { emit, finish } from '${LIB}'\nemit(${JSON.stringify(join(dir, 'missing2.json'))}, '{}')\nfinish('gen-c.mjs')\n`)
      // Ignores --check entirely (would rewrite files) and exits 0: must still fail.
      writeFileSync(join(dir, 'gen-d.mjs'), `process.exit(0)\n`)
      // Not a generator: ignored.
      writeFileSync(join(dir, 'helper.mjs'), `process.exit(1)\n`)
      const r = run(dir)
      expect(r.status).toBe(1)
      const out = r.stdout + r.stderr
      expect(out).not.toMatch(/FAIL gen-a\.mjs/)
      expect(out).toMatch(/FAIL gen-b\.mjs/)
      expect(out).toMatch(/FAIL gen-c\.mjs/)
      expect(out).toMatch(/FAIL gen-d\.mjs: does not import lib\/gen-output\.mjs/)
      expect(out).not.toMatch(/helper/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('fails when it finds no generators at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-gen-'))
    try {
      expect(run(dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
