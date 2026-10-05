// Spec 7: circuitoon sim prints the SimOutcome JSON on stdout and a short summary on stderr; exit 0
// clean, 1 blocking, 2 bad input, 3 failed or unavailable; --probe repeats; a netlist is laid out
// first; only simulation findings are reported.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { parseArgs } from './args.ts'
import { summary } from './simCmd.ts'
import type { SimFinding, SimOutcome } from '../sim/results.ts'

const write = (dir: string, name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value))

describe('circuitoon sim', () => {
  it('lays out a netlist, solves it and prints a schema-valid outcome; two --probe flags read two points', async () => {
    const dir = tempDir()
    write(dir, 'n.json', ledNetlist())
    const r = await cli(['sim', 'n.json', '--probe', 'D1.A', '--probe', 'net:VCC'], { cwd: dir })
    expect(r.code).toBe(0)
    const o = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('sim'), o)).toEqual([])
    expect(o.status).toBe('ok')
    expect(o.result.probes.map((p: { name: string }) => p.name)).toEqual(['D1.A', 'net:VCC'])
    expect(o.result.probes[0].voltage.typical.kind).toBe('value')
    expect(o.result.findings.every((f: { code: string }) => f.code.startsWith('sim-'))).toBe(true)
    expect(r.err).toMatch(/^Simulation: /)
  }, 60_000)
  it('exits 1 on a blocking finding (a battery shorted through a closed switch)', async () => {
    const dir = tempDir()
    write(dir, 'n.json', {
      format: 'circuitoon-netlist/1', title: 'short',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }],
      nets: [{ name: 'A', pins: ['BT1.+', 'S1.1'] }, { name: 'GND', pins: ['S1.2', 'BT1.-'] }],
    })
    const r = await cli(['sim', 'n.json'], { cwd: dir })
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).result.findings[0]).toMatchObject({ code: 'sim-short', severity: 'error' })
  }, 60_000)
  it('exits 2 on bad input: no file, not a sheet, an unknown probe', async () => {
    const dir = tempDir()
    expect((await cli(['sim'], { cwd: dir })).code).toBe(2)
    write(dir, 'x.json', { hello: 1 })
    expect((await cli(['sim', 'x.json'], { cwd: dir })).code).toBe(2)
    write(dir, 'n.json', ledNetlist())
    expect((await cli(['sim', 'n.json', '--probe', 'Q9.1'], { cwd: dir })).code).toBe(2)
  }, 60_000)
  it('collects repeated --probe flags (ruling R26)', () => {
    const r = parseArgs(['sim', 'a.json', '--probe', 'D1', '--probe', 'net:GND'])
    expect(r.ok && r.value.lists?.get('--probe')).toEqual(['D1', 'net:GND'])
  })
  it('groups consecutive "not powered: S1 is open" warnings into one summary line (ruling R30)', () => {
    const off = (part: string, sw: string): SimFinding => ({ code: 'sim-brownout', severity: 'warning', parts: [part, sw], inputs: [], basis: 'topology', message: `${part} VCC is not powered in the current state: ${sw} is open. Set ${sw} to its operating position to simulate ${part} running.` })
    const o = { status: 'ok', result: { findings: [off('U1', 'S1'), off('U2', 'S1'), off('U3', 'S2')], probes: [], budget: [], unaccounted: [], engine: { ms: 5, runs: 2 } } } as unknown as SimOutcome
    const lines = summary(o).split('\n')
    expect(lines.filter((l) => l.includes('S1 is open'))).toEqual(['  warning: not powered in the current state because S1 is open: U1 VCC, U2 VCC. Set S1 to its operating position to simulate them running.'])
    expect(lines.filter((l) => l.includes('S2 is open'))).toHaveLength(1)
  })
})
