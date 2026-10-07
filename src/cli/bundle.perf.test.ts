// Spec 9's CLI run budget for the committed bundle, timed in npm test's timing stage (on its own, not
// beside the parallel suite): blink for 5 s of simulated time from a copy of the plugin folder.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { serializeDiagram } from '../format/diagram.ts'
import { piBlinkSample } from '../samples/piSamples.ts'

describe('CLI bundle timing', () => {
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
})
