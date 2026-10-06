// Spec 7: circuitoon sim prints the SimOutcome JSON on stdout and a short summary on stderr; exit 0
// clean, 1 blocking (a failed or unavailable solve's topological findings too), 2 bad input, 3
// failed or unavailable; --probe repeats; a netlist is laid out first, else simulated from its
// connections; readings use the netlist's net names; only simulation findings are reported.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { parseArgs } from './args.ts'
import { simCommand, summary } from './simCmd.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { buildCircuit } from '../sim/build.ts'
import type { Engine } from '../sim/engine/engine.ts'
import type { EngineHost } from '../sim/engine/host.ts'
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
  it('exits 1 on an LED straight across 2xAA (more than twice its representative absolute maximum)', async () => {
    const dir = tempDir()
    write(dir, 'n.json', {
      format: 'circuitoon-netlist/1', title: 'bare LED',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'D1', module: 'led' }],
      nets: [{ name: 'A', pins: ['BT1.+', 'D1.A'] }, { name: 'GND', pins: ['D1.K', 'BT1.-'] }],
    })
    const r = await cli(['sim', 'n.json'], { cwd: dir })
    expect(r.code).toBe(1)
    const f = JSON.parse(r.out).result.findings.find((x: SimFinding) => x.code === 'sim-over-abs-max')
    expect(f).toMatchObject({ severity: 'error', basis: 'representative', parts: ['D1'] })
    expect(f.message).toContain('Add a series resistor (about ')
  }, 60_000)
  it('exits 1 when the engine is unavailable but a real short blocks (as gate), with a schema-valid outcome that names it', async () => {
    const dir = tempDir()
    write(dir, 'n.json', {
      format: 'circuitoon-netlist/1', title: 'short',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }],
      nets: [{ name: 'A', pins: ['BT1.+', 'S1.1'] }, { name: 'GND', pins: ['S1.2', 'BT1.-'] }],
    })
    const engine: Engine = {
      host: { runs: 0, info: null } as unknown as EngineHost,
      init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
      run: async () => ({ status: 'unavailable', reason: 'no engine' }),
      runAll: async () => [{ status: 'unavailable', reason: 'no engine' }],
      dispose() {},
    }
    let out = ''
    let err = ''
    const parsed = parseArgs(['sim', 'n.json'])
    if (!parsed.ok) throw new Error('args')
    const code = await simCommand(parsed.value, { stdout: (t) => void (out += t), stderr: (t) => void (err += t), cwd: dir, env: {} }, { engine })
    expect(code).toBe(1)
    const o = JSON.parse(out)
    expect(schemaErrors(loadSchema('sim'), o)).toEqual([])
    expect(o).toMatchObject({ status: 'unavailable', reason: 'no engine' })
    expect(o.findings.filter((f: SimFinding) => f.code === 'sim-short')).toEqual([expect.objectContaining({ severity: 'error', parts: ['BT1', 'S1'] })])
    expect(err.split('\n').slice(0, 2)).toEqual(['Simulation unavailable: no engine', expect.stringMatching(/^ {2}error: BT1 is shorted/)])
    // With nothing blocking, an unavailable engine is exit 3.
    write(dir, 'led.json', ledNetlist())
    const led = parseArgs(['sim', 'led.json'])
    if (!led.ok) throw new Error('args')
    expect(await simCommand(led.value, { stdout() {}, stderr() {}, cwd: dir, env: {} }, { engine })).toBe(3)
  })
  it('keys net readings by the netlist own names (VCC stays VCC), from a netlist and from its laid-out sheet; no internal node leaks', async () => {
    const dir = tempDir()
    write(dir, 'n.json', ledNetlist())
    const r = await cli(['sim', 'n.json', '--probe', 'net:VCC'], { cwd: dir })
    expect(r.code).toBe(0)
    const o = JSON.parse(r.out)
    const nets = Object.keys(o.result.corners.typical.nets)
    expect(nets).toEqual(expect.arrayContaining(['VCC', 'LED_A', 'GND']))
    expect(nets.filter((n) => n.includes('#'))).toEqual([])
    expect(o.result.corners.typical.nets.VCC).toMatchObject({ kind: 'value', reference: 'GND' })
    expect(o.result.probes[0].voltage.typical).toEqual(o.result.corners.typical.nets.VCC)
    // The laid-out sheet keeps its intent, so it reads the same names.
    const laid = layoutNetlist(ledNetlist())
    if (!laid.ok) throw new Error('layout')
    write(dir, 'sheet.json', laid.value.diagram)
    const s = await cli(['sim', 'sheet.json'], { cwd: dir })
    expect(Object.keys(JSON.parse(s.out).result.corners.typical.nets)).toEqual(nets)
    // The editor (no netNames) keeps the sheet's own names.
    const { intent: _, ...bare } = laid.value.diagram
    expect(buildCircuit(bare).nets).not.toContain('VCC')
  }, 60_000)
  it('simulates a netlist the layout cannot draw (connectivity only): the Spirit Typewriter fixture never exits 2', async () => {
    const r = await cli(['sim', join(import.meta.dirname, '../sim/fixtures/spirit-typewriter.netlist.json'), '--probe', 'D1'])
    expect([0, 1]).toContain(r.code)
    const o = JSON.parse(r.out)
    expect(o.status).toBe('ok')
    expect(Object.keys(o.result.corners.typical.nets)).toEqual(expect.arrayContaining(['BAT', 'BSW', '5V', '3V3', 'GND', 'SDA', 'SCL']))
    expect(o.result.corners.typical.nets['3V3'].value).toBeCloseTo(3.27, 1)
    // Part probes are in the summary.
    expect(r.err).toMatch(/\n {2}P1 D1: lit, [\d.]+ mW, into A [\d.]+ mA, K -[\d.]+ mA\n/)
  }, 60_000)
  it('Spirit 1-main with SW1 closed: no floating input on the I2C pins its J1 to J3 carry to the bank sheets', async () => {
    const dir = tempDir()
    const n = JSON.parse(readFileSync(join(import.meta.dirname, '../../plugin/skills/circuitoon-design/references/examples/spirit-typewriter/1-main.netlist.json'), 'utf8'))
    n.parts.find((p: { ref: string }) => p.ref === 'SW1').values = { 'contact.s': 'closed' }
    write(dir, 'n.json', n)
    const r = await cli(['sim', 'n.json'], { cwd: dir })
    expect(r.code).toBe(0)
    const floating = JSON.parse(r.out).result.findings.filter((f: SimFinding) => f.code === 'sim-floating-input').flatMap((f: SimFinding) => f.pins!.map((p) => p.pin))
    expect(floating).not.toContain('IO21')
    expect(floating).not.toContain('IO22')
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
  it('folds every "S1 is open" warning on the battery-bank sheet into one line, even when other findings sit between them (ruling R30)', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), readFileSync(join(import.meta.dirname, '../format/fixtures/battery-bank-1s4p.circuitoon.json')))
    const r = await cli(['sim', 'sheet.json'], { cwd: dir })
    const open = r.err.split('\n').filter((l) => l.includes('S1 is open'))
    expect(open).toEqual([expect.stringMatching(/^ {2}warning: not powered in the current state because S1 is open: DS1 VCC, /)])
  }, 60_000)
  it('summary: a probe with no voltage gives its reason in words, never "undefined"', () => {
    const u = { kind: 'undefined', why: 'not simulated (mains)' } as const
    const o = { status: 'ok', result: { findings: [], probes: [{ id: 'P1', name: 'L', at: { part: 'o1', pin: 'L1' }, voltage: { typical: u, peak: u } }], budget: [], unaccounted: [], engine: { ms: 5, runs: 2 } } } as unknown as SimOutcome
    expect(summary(o)).toContain('  P1 L: not simulated (mains)\n')
    expect(summary(o)).not.toContain('undefined')
  })
  it('summary: no -0.0 mA, no double space for an unnamed probe, no unpowered domain rows', () => {
    const v = { kind: 'value', value: 3.3, reference: 'GND', trust: 'ok' } as const
    const a = (x: number) => ({ kind: 'value', value: x, trust: 'ok' }) as const
    const nothing = { kind: 'indeterminate', why: 'not solved (floating)' } as const
    const src = { id: 'bt1', kind: 'source', part: 'bt1', label: 'BT1 delivering', volts: { typical: v, peak: v }, amps: { typical: a(-0.00001), peak: a(-0.00001) }, basis: 'datasheet' }
    const off = { id: 'u1.domain.3V3', kind: 'domain', part: 'u1', label: 'U1 3V3', volts: { typical: { kind: 'floating' }, peak: { kind: 'floating' } }, amps: { typical: nothing, peak: nothing }, ownDraw: { typical: nothing, peak: nothing }, basis: 'datasheet' }
    const probe = { id: 'P1', at: { part: 'u1', pin: '3V3' }, voltage: { typical: v, peak: v } }
    const out = summary({ status: 'ok', result: { findings: [], probes: [probe], budget: [src, off], unaccounted: [], engine: { ms: 5, runs: 2 } } } as unknown as SimOutcome)
    expect(out).toContain('  budget BT1 delivering: 3.300 V, 0.0 mA (peak 0.0 mA)')
    expect(out).not.toContain('-0.0')
    expect(out).not.toContain('U1 3V3')
    expect(out).toContain('  P1: 3.300 V (to GND)')
  })
  it('summary: the header counts a folded not-powered group once, matching the lines shown', () => {
    const off = (part: string): SimFinding => ({ code: 'sim-brownout', severity: 'warning', parts: [part, 'SW1'], inputs: [], basis: 'topology', message: `${part} VCC is not powered in the current state: SW1 is open. Set SW1 to its operating position to simulate ${part} running.` })
    const out = summary({ status: 'ok', result: { findings: [off('U1'), off('U2'), off('U3')], probes: [], budget: [], unaccounted: [], engine: { ms: 5, runs: 2 } } } as unknown as SimOutcome)
    expect(out.split('\n')[0]).toContain('1 warning,')
    expect(out.split('\n').filter((l) => l.startsWith('  warning:'))).toHaveLength(1)
  })
  it('summary: nothing solved says so; a domain row prints its own draw, not the pin current', () => {
    const none = { status: 'ok', result: { findings: [], probes: [], budget: [], unaccounted: [], engine: { ms: 0, runs: 0 } } } as unknown as SimOutcome
    expect(summary(none).split('\n')[0]).toBe('Simulation: nothing powered; not solved. 0 blocking findings, 0 warnings, 0 notes.')
    const v = { kind: 'value', value: 3.3, reference: 'GND', trust: 'ok' } as const
    const a = (x: number) => ({ kind: 'value', value: x, trust: 'ok' }) as const
    const row = { id: 'u1.domain.3V3', kind: 'domain', part: 'u1', label: 'U1 3V3', volts: { typical: v, peak: v }, amps: { typical: a(0.3), peak: a(0.3) }, ownDraw: { typical: a(0.1), peak: a(0.24) }, basis: 'datasheet' }
    const o = { status: 'ok', result: { findings: [], probes: [], budget: [row], unaccounted: [], engine: { ms: 5, runs: 2 } } } as unknown as SimOutcome
    expect(summary(o)).toContain('  budget U1 3V3: 3.300 V, 100.0 mA (peak 240.0 mA) own draw\n')
  })
})
