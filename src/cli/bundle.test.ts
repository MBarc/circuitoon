// The committed bundle (plugin/dist-cli/circuitoon.mjs) runs with plain Node from a copy of the
// plugin folder, with no node_modules anywhere near it, and imports nothing but Node built-ins.
import { describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { netSheet } from '../sim/testing.ts'
import { serializeDiagram } from '../format/diagram.ts'
import { piBlinkSample } from '../samples/piSamples.ts'

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
  it('renders a sheet to SVG from a copy of the plugin folder, with the production JSX runtime', () => {
    // Amendment A13: the Sheet (JSX) is in the bundle, so a build under NODE_ENV=test would carry
    // the dev runtime (jsxDEV) and fail here.
    const code = readFileSync(resolve('plugin/dist-cli/circuitoon.mjs'), 'utf8')
    expect(code).not.toContain('jsxDEV')
    expect(code).toContain('react-jsx-runtime.production')
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    const bin = join(dir, 'bin', 'circuitoon.mjs')
    writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
    expect(spawnSync(process.execPath, [bin, 'layout', 'n.json', '-o', 'sheet.json'], { encoding: 'utf8', cwd: dir }).status).toBe(0)
    const r = spawnSync(process.execPath, [bin, 'render', 'sheet.json', '--svg', 'sheet.svg', '--json'], { encoding: 'utf8', cwd: dir })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).outputs[0]).toMatchObject({ kind: 'svg', path: 'sheet.svg' })
    const svg = readFileSync(join(dir, 'sheet.svg'), 'utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('data-wire=')
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
  it('runs sim on the Spirit Typewriter sheet from a copy of the plugin folder, cold, within 2 s (spec 8)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    const n = JSON.parse(readFileSync(resolve('src/sim/fixtures/spirit-typewriter.netlist.json'), 'utf8'))
    writeFileSync(join(dir, 'spirit.json'), JSON.stringify(netSheet(n)))
    const t0 = performance.now()
    const r = spawnSync(process.execPath, [join(dir, 'bin', 'circuitoon.mjs'), 'sim', 'spirit.json'], { encoding: 'utf8', cwd: dir })
    const ms = performance.now() - t0
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).status).toBe('ok')
    expect(ms).toBeLessThanOrEqual(2000)
  }, 60_000)
  it('runs blink for 5 s from a copy of the plugin folder within 4 s, Python cached (spec 9)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuitoon-plugin-'))
    cpSync(resolve('plugin/bin'), join(dir, 'bin'), { recursive: true })
    cpSync(resolve('plugin/dist-cli'), join(dir, 'dist-cli'), { recursive: true })
    writeFileSync(join(dir, 'blink.json'), serializeDiagram(piBlinkSample))
    const args = [join(dir, 'bin', 'circuitoon.mjs'), 'run', 'blink.json', '--for', '5s', '--py-dir', resolve('node_modules/pyodide'), '--json']
    spawnSync(process.execPath, args, { encoding: 'utf8', cwd: dir }) // warm the OS file cache once
    const t0 = performance.now()
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: dir })
    const ms = performance.now() - t0
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ format: 'circuitoon-cli/run/1', simulatedSeconds: 5 })
    expect(ms).toBeLessThanOrEqual(4000)
  }, 120_000)
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
