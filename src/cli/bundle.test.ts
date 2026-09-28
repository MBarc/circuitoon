// The committed bundle (plugin/dist-cli/circuitoon.mjs) runs with plain Node from a copy of the
// plugin folder, with no node_modules anywhere near it, and imports nothing but Node built-ins.
import { describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Module specifiers of real import and export statements and dynamic imports (amendment A12): the
 * patterns are anchored to the start of a line, so string text inside the bundle never matches.
 */
export function importSpecifiers(code: string): string[] {
  const patterns = [
    /^\s*import\s[^'"]*from\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /^\s*export\s[^'"]*from\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ]
  return patterns.flatMap((p) => [...code.matchAll(p)].map((m) => m[1]))
}

describe('CLI bundle', () => {
  it('runs parts --json from a copy of the plugin folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    const r = spawnSync(process.execPath, [join(dir, 'bin', 'circuitoon.mjs'), 'parts', '--search', 'resistor', '--json'], { encoding: 'utf8', cwd: dir })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).parts.map((p: { id: string }) => p.id)).toContain('resistor')
  }, 60_000)
  it('exits quietly when its reader closes early (parts --json | head)', async () => {
    const child = spawn(process.execPath, [resolve('plugin/bin/circuitoon.mjs'), 'parts', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.stdout.once('data', () => child.stdout.destroy())
    const code = await new Promise<number | null>((done) => child.on('close', done))
    expect(err).toBe('')
    expect(code).toBe(0)
  }, 60_000)
  it('finds real imports and ignores import-like text inside strings', () => {
    const code = [
      `import { a } from "node:fs";`,
      `import "./side-effect.js";`,
      `export { b } from 'react';`,
      `const c = await import("node:path");`,
      `const help = "run: import x from 'not-a-module'";`,
      `  const s = 'export * from "nor-this"';`,
    ].join('\n')
    expect(importSpecifiers(code)).toEqual(['node:fs', './side-effect.js', 'react', 'node:path'])
  })
  it('imports only Node built-ins', () => {
    const code = readFileSync(resolve('plugin/dist-cli/circuitoon.mjs'), 'utf8')
    const specs = importSpecifiers(code)
    expect(specs.length).toBeGreaterThan(0)
    expect(specs.filter((s) => !s.startsWith('node:') && !builtinModules.includes(s))).toEqual([])
  })
})
