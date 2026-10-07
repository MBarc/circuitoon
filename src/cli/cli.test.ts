// The CLI in-process: outputs, JSON schemas and exit codes for parts, part and layout, and the JSON
// error envelope every failure prints in --json mode (amendment A10), and the Task 9 review follow-ups
// (file write errors, crashes as exit 3, help as JSON, CliError exit codes).
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateDiagram } from '../format/diagram.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { COMMANDS, USAGE } from './main.ts'
import { CliError, writeError } from './io.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'

const withFile = (name: string, value: unknown) => {
  const dir = tempDir()
  writeFileSync(join(dir, name), JSON.stringify(value))
  return dir
}

/** One JSON error envelope on stdout, matching error.schema.json, with the exit code it reports. */
function expectEnvelope(r: { code: number; out: string }, exit: number, code: string, message: RegExp | string) {
  expect(r.code).toBe(exit)
  const out = JSON.parse(r.out)
  expect(schemaErrors(loadSchema('error'), out)).toEqual([])
  expect(out).toMatchObject({ format: 'circuitoon-cli/error/1', ok: false, exit, error: { code } })
  if (typeof message === 'string') expect(out.error.message).toContain(message)
  else expect(out.error.message).toMatch(message)
}

describe('the schema checker', () => {
  it('reports a wrong const, a missing field, an extra field and a wrong item type', () => {
    const errs = schemaErrors(loadSchema('parts'), { format: 'nope', parts: [{ id: 1 }], extra: true })
    expect(errs).toContain('$.format: must be "circuitoon-cli/parts/1"')
    expect(errs).toContain('$.parts[0].name: required')
    expect(errs).toContain('$.parts[0].id: must be string, got integer')
    expect(errs).toContain('$.extra: not allowed')
  })
})

describe('circuitoon parts and part', () => {
  it('lists every built-in part as JSON matching its schema', async () => {
    const r = await cli(['parts', '--json'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('parts'), out)).toEqual([])
    expect(out.parts.map((p: { id: string }) => p.id)).toContain('esp32-devkitc-v4')
  })
  it('lists the net label, flagged, and says how a netlist asks for one', async () => {
    const out = JSON.parse((await cli(['parts', '--search', 'label', '--json'])).out)
    const label = out.parts.find((p: { id: string }) => p.id === 'net-label')
    expect(label).toMatchObject({ category: 'Wiring', netLabel: true, board: false })
    expect(out.parts.find((p: { id: string }) => p.id !== 'net-label')?.netLabel ?? false).toBe(false)
    const text = (await cli(['parts', '--search', 'net-label'])).out
    expect(text).toContain('net-label: Net label [Wiring]')
    expect(text).toContain('not a part to list: set "label": true on a net')
  })
  it('reports an untyped pin as type null, never a guess (amendment A14)', async () => {
    const out = JSON.parse((await cli(['parts', '--search', 'mcp23017', '--json'])).out)
    const pins = out.parts.find((p: { id: string }) => p.id === 'mcp23017-dip28').pins
    expect(pins.find((p: { name: string }) => p.name === 'GPA0').type).toBeNull()
    expect(pins.find((p: { name: string }) => p.name === 'VDD').type).toBe('power_in')
  })
  it('filters with --search and prints plain text by default', async () => {
    const r = await cli(['parts', '--search', 'tilt'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('tilt-switch-sw520d')
    expect(r.out).not.toContain('esp32-devkitc-v4')
  })
  it('lists the closest matches after the exact ones for a part described in words', async () => {
    const r = await cli(['parts', '--search', 'a touch display for the rpi'])
    expect(r.code).toBe(0)
    const [exact, closest] = r.out.split('closest matches')
    expect(exact.trim()).toBe('')
    expect(closest).toMatch(/^[^\n]*\n(lcd-rpi-touch-display-[^\n]+\n(\s[^\n]*\n)*){3}/)
    const out = JSON.parse((await cli(['parts', '--search', 'servo', '--json'])).out)
    expect(schemaErrors(loadSchema('parts'), out)).toEqual([])
    expect(out.parts.map((p: { id: string }) => p.id)).toEqual(['servo-sg90'])
    expect(out.parts[0]).toMatchObject({ description: expect.stringMatching(/servo/), uses: expect.arrayContaining([expect.any(String)]) })
    expect(out.closest.every((p: { id: string; score: number }) => p.id !== 'servo-sg90' && p.score > 0)).toBe(true)
    const charger = JSON.parse((await cli(['parts', '--search', 'usb-c charger for an 18650', '--json'])).out)
    expect(schemaErrors(loadSchema('parts'), charger)).toEqual([])
    expect(charger.parts).toEqual([])
    expect(charger.closest[0]).toMatchObject({ id: 'ip5306-usbc-module', description: expect.any(String) })
  })
  it('shows one part in full, and exits 2 on an unknown id', async () => {
    const r = await cli(['part', 'mcp23017-dip28', '--json'])
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('part'), JSON.parse(r.out))).toEqual([])
    expect((await cli(['part', 'mcp23017-dip28'])).out).toContain('GPA0')
    const bad = await cli(['part', 'no-such-part'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('no built-in part "no-such-part"')
  })
})

describe('circuitoon layout', () => {
  it('writes a sheet the site opens and prints the report as JSON', async () => {
    const dir = withFile('led.netlist.json', ledNetlist())
    const r = await cli(['layout', 'led.netlist.json', '-o', 'led.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('layout'), out)).toEqual([])
    expect(out.report).toMatchObject({ bodyOverlaps: 0, captionOverlaps: 0, blockedNets: [] })
    expect(out.warnings).toEqual([])
    expect(validateDiagram(JSON.parse(readFileSync(join(dir, 'led.json'), 'utf8'))).ok).toBe(true)
    const text = await cli(['layout', 'led.netlist.json', '-o', 'led2.json'], { cwd: dir })
    expect(text.out).toContain('Readability: body overlaps 0, caption overlaps 0')
    expect(text.out).toContain('Bill of quantities:')
  })
  it('exits 2 on an invalid netlist and 1 on one that cannot be laid out, with JSON that matches the schema', async () => {
    const dir = withFile('bad.json', { format: 'circuitoon-netlist/1', parts: [], nets: [] })
    const bad = await cli(['layout', 'bad.json', '-o', 'out.json'], { cwd: dir })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('title: required')
    const badJson = await cli(['layout', 'bad.json', '-o', 'out.json', '--json'], { cwd: dir })
    expect(badJson.code).toBe(2)
    expect(schemaErrors(loadSchema('layout'), JSON.parse(badJson.out))).toEqual([])
    expect(JSON.parse(badJson.out).errors.join('\n')).toContain('title: required')
    const crowded = {
      format: 'circuitoon-netlist/1', title: 'Crowded',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }, { ref: 'U3', module: 'bme280-module-4pin' }],
      nets: [{ name: '3V3', pins: ['U1.3V3', 'U2.VIN', 'U3.VIN'] }],
    }
    writeFileSync(join(dir, 'crowded.json'), JSON.stringify(crowded))
    // Drawn with labels (--labels auto), three header pins need no distribution point; with wires (the default) they do.
    const labelled = JSON.parse((await cli(['layout', 'crowded.json', '-o', 'out.json', '--json', '--labels', 'auto'], { cwd: dir })).out)
    expect(labelled.ok).toBe(true)
    expect(labelled.report.labels).toEqual({ mode: 'auto', nets: ['3V3'], unplaced: [] })
    expect(schemaErrors(loadSchema('layout'), labelled)).toEqual([])
    const r = await cli(['layout', 'crowded.json', '-o', 'out.json', '--json', '--labels', 'none'], { cwd: dir })
    expect(r.code).toBe(1)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('layout'), out)).toEqual([])
    expect(out.errors[0]).toMatch(/^needs a distribution point: net 3V3/)
  })
  it('re-lays out from a partial with --keep', async () => {
    const dir = withFile('p.json', { format: 'circuitoon-partial/1', intent: ledNetlist(), parts: [{ designator: 'BT1', x: 600, y: 300 }] })
    const r = await cli(['layout', '--keep', 'p.json', '-o', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    expect(sheet.parts.find((p: { uid: string }) => p.uid === 'BT1')).toMatchObject({ x: 600, y: 300 })
  })
  it('warns when a partial names a part the intent does not have', async () => {
    const dir = withFile('p.json', { format: 'circuitoon-partial/1', intent: ledNetlist(), parts: [{ designator: 'BT1', x: 600, y: 300 }, { designator: 'Q9', x: 0, y: 0 }] })
    const text = await cli(['layout', '--keep', 'p.json', '-o', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.err).toContain('warning: p.json names Q9, which is not a part of its intent; its position is ignored')
    const r = await cli(['layout', '--keep', 'p.json', '-o', 'sheet.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('layout'), out)).toEqual([])
    expect(out.warnings).toEqual(['p.json names Q9, which is not a part of its intent; its position is ignored'])
    expect(r.err).toBe('')
  })
  it('prints usage and exits 2 on an unknown command or option', async () => {
    expect((await cli(['frobnicate'])).code).toBe(2)
    expect((await cli(['parts', '--nope'])).err).toContain('unknown option --nope')
    const help = await cli([])
    expect(help.code).toBe(0)
    expect(help.out).toContain('circuitoon <command>')
  })
})

describe('--json failures print one error envelope on stdout (amendment A10)', () => {
  afterEach(() => {
    delete COMMANDS.boom
    delete COMMANDS.nobrowser
  })
  it('an unknown option, a flag without its value, and an unknown command', async () => {
    expectEnvelope(await cli(['parts', '--nope', '--json']), 2, 'usage', 'unknown option --nope')
    expectEnvelope(await cli(['parts', '--json', '--search']), 2, 'usage', '--search needs a value')
    expectEnvelope(await cli(['frobnicate', '--json']), 2, 'usage', 'unknown command "frobnicate"')
  })
  it('invalid input from a command: unknown part, missing id, missing -o, unreadable and malformed files, a bad partial', async () => {
    expectEnvelope(await cli(['part', 'no-such-part', '--json']), 2, 'input', 'no built-in part "no-such-part"')
    expectEnvelope(await cli(['part', '--json']), 2, 'input', 'part: give a module id')
    const dir = withFile('led.netlist.json', ledNetlist())
    expectEnvelope(await cli(['layout', 'led.netlist.json', '--json'], { cwd: dir }), 2, 'input', '-o <sheet.json> is required')
    expectEnvelope(await cli(['layout', '-o', 'x.json', '--json'], { cwd: dir }), 2, 'input', 'give a netlist file, or --keep')
    expectEnvelope(await cli(['layout', 'missing.json', '-o', 'x.json', '--json'], { cwd: dir }), 2, 'input', 'missing.json: cannot read the file')
    writeFileSync(join(dir, 'broken.json'), '{ nope')
    expectEnvelope(await cli(['layout', 'broken.json', '-o', 'x.json', '--json'], { cwd: dir }), 2, 'input', /^broken\.json: not valid JSON/)
    writeFileSync(join(dir, 'p.json'), JSON.stringify({ format: 'circuitoon-partial/1', intent: ledNetlist(), parts: [{ designator: 'BT1', x: 1, y: 0 }] }))
    expectEnvelope(await cli(['layout', '--keep', 'p.json', '-o', 'x.json', '--json'], { cwd: dir }), 2, 'input', 'p.json: parts[0]: x and y must be on the 10 px grid')
  })
  it('a CliError with another exit code keeps it', async () => {
    COMMANDS.nobrowser = () => {
      throw new CliError('no Chrome or Edge found', 3)
    }
    expectEnvelope(await cli(['nobrowser', '--json']), 3, 'environment', 'no Chrome or Edge found')
    const text = await cli(['nobrowser'])
    expect(text.code).toBe(3)
    expect(text.out).toBe('')
    expect(text.err).toBe('no Chrome or Edge found\n')
  })
  it('an unexpected exception', async () => {
    COMMANDS.boom = () => {
      throw new Error('kaboom')
    }
    // Ruling T8: a crash is an environment-class failure (exit 3), never read as a blocked design.
    expectEnvelope(await cli(['boom', '--json']), 3, 'internal', 'kaboom')
    const text = await cli(['boom'])
    expect(text.code).toBe(3)
    expect(text.err).toMatch(/^internal error: kaboom\n/)
  })
  it('an unhandled rejection after a run exits 3 as an internal error (bundled run())', () => {
    const bundle = pathToFileURL(resolve('plugin/dist-cli/circuitoon.mjs')).href
    const script = `const m = await import(${JSON.stringify(bundle)}); await m.run(['--help']); Promise.reject(new Error('late failure'))`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/^internal error: late failure\n/)
    const j = spawnSync(process.execPath, ['--input-type=module', '-e', script.replace("['--help']", "['--help', '--json']")], { encoding: 'utf8' })
    expect(j.status).toBe(3)
    const docs = j.stdout.trim().split(/\n(?=\{)/).map((d) => JSON.parse(d))
    expect(docs.at(-1)).toMatchObject({ format: 'circuitoon-cli/error/1', exit: 3, error: { code: 'internal', message: 'internal error: late failure' } })
  }, 60_000)
})

describe('Task 9 follow-ups', () => {
  it('a sheet written to a directory, or under a file, is invalid input (exit 2)', async () => {
    const dir = withFile('led.netlist.json', ledNetlist())
    mkdirSync(join(dir, 'out'))
    expectEnvelope(await cli(['layout', 'led.netlist.json', '-o', 'out', '--json'], { cwd: dir }), 2, 'input', 'out: cannot write')
    writeFileSync(join(dir, 'plain.txt'), 'x')
    expectEnvelope(await cli(['layout', 'led.netlist.json', '-o', 'plain.txt/sheet.json', '--json'], { cwd: dir }), 2, 'input', 'plain.txt/sheet.json: cannot write')
    const text = await cli(['layout', 'led.netlist.json', '-o', 'out'], { cwd: dir })
    expect(text.code).toBe(2)
    expect(text.err).toContain('out: cannot write')
  })
  it('a render written to a directory is invalid input (exit 2)', async () => {
    const dir = withFile('led.netlist.json', ledNetlist())
    expect((await cli(['layout', 'led.netlist.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    mkdirSync(join(dir, 'out.svg'))
    expectEnvelope(await cli(['render', 'sheet.json', '--svg', 'out.svg', '--json'], { cwd: dir }), 2, 'input', 'out.svg: cannot write')
    mkdirSync(join(dir, 'out.png'))
    expectEnvelope(await cli(['render', 'sheet.json', '-o', 'out.png', '--json'], { cwd: dir, env: { CIRCUITOON_BROWSER: process.execPath } }), 2, 'input', 'out.png: cannot write')
  })
  it('maps file system errors: a bad path is exit 2, no permission or no space is exit 3', () => {
    const err = (code: string) => Object.assign(new Error(`${code}: boom`), { code })
    for (const code of ['EISDIR', 'ENOTDIR', 'EEXIST', 'ENOENT', 'EINVAL']) expect(writeError('x.json', err(code)).code, code).toBe(2)
    for (const code of ['EACCES', 'EPERM', 'ENOSPC', 'EROFS']) expect(writeError('x.json', err(code)).code, code).toBe(3)
    expect(writeError('x.json', err('EACCES')).message).toBe('x.json: cannot write the file (permission denied)')
    expect(writeError('x.json', err('ENOSPC')).message).toBe('x.json: cannot write the file (no space left on the device)')
    expect(writeError('x.json', err('EISDIR')).message).toBe('x.json: cannot write the file (it is a directory)')
  })
  it('--json and --help --json print one help document', async () => {
    for (const argv of [['--json'], ['--help', '--json'], ['help', '--json'], ['parts', '--help', '--json']]) {
      const r = await cli(argv)
      expect(r.code, argv.join(' ')).toBe(0)
      const doc = JSON.parse(r.out)
      expect(schemaErrors(loadSchema('help'), doc)).toEqual([])
      expect(doc).toEqual({ format: 'circuitoon-cli/help/1', usage: USAGE })
    }
  })
  it('a CliError carries exit code 1, 2 or 3 and nothing else', () => {
    for (const code of [1, 2, 3] as const) expect(new CliError('x', code).code).toBe(code)
    // @ts-expect-error 0 is success, never an error's exit code
    expect(() => new CliError('x', 0)).toThrow('CliError exit code must be 1, 2 or 3, not 0')
    // @ts-expect-error 4 is not an exit code the CLI uses
    expect(() => new CliError('x', 4)).toThrow(RangeError)
  })
})

describe('layout --labels', () => {
  it('refuses a mode that is not auto, none or all, with exit 2', async () => {
    const dir = withFile('n.json', ledNetlist())
    const r = await cli(['layout', 'n.json', '-o', 'out.json', '--labels', 'some'], { cwd: dir })
    expect(r.code).toBe(2)
    expect(r.err).toContain('--labels must be auto, none, all')
  })
  it('records the mode in the report', async () => {
    const dir = withFile('n.json', ledNetlist())
    const out = JSON.parse((await cli(['layout', 'n.json', '-o', 'out.json', '--labels', 'all', '--json'], { cwd: dir })).out)
    expect(out.report.labels.mode).toBe('all')
    expect(out.report.labels.nets.length).toBeGreaterThan(0)
    expect((await cli(['layout', 'n.json', '-o', 'out2.json', '--labels', 'all'], { cwd: dir })).out).toMatch(/labels all \(nets /)
  })
})
