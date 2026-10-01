// `circuitoon netlist <sheet> [-o file]`: a netlist extracted from a drawn sheet (agent/extract.ts),
// printed or written, that lays out again; --json wraps it in circuitoon-cli/netlist/1.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { USAGE } from './main.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}

describe('circuitoon netlist', () => {
  it('prints the netlist of a sheet, which lays out again', async () => {
    const dir = await laidOut()
    const r = await cli(['netlist', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    const n = JSON.parse(r.out)
    expect(n.format).toBe('circuitoon-netlist/1')
    expect(n.parts.map((p: { ref: string }) => p.ref).sort()).toEqual(['BB1', 'BT1', 'D1', 'R1'])
    writeFileSync(join(dir, 'again.json'), r.out)
    expect((await cli(['layout', 'again.json', '-o', 'again-sheet.json'], { cwd: dir })).code).toBe(0)
  })
  it('writes the file with -o, and --json reports it in a document matching the schema', async () => {
    const dir = await laidOut()
    const r = await cli(['netlist', 'sheet.json', '-o', 'out.netlist.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const doc = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('netlist'), doc)).toEqual([])
    expect(doc).toMatchObject({ format: 'circuitoon-cli/netlist/1', ok: true, sheet: 'sheet.json', output: 'out.netlist.json' })
    expect(JSON.parse(readFileSync(join(dir, 'out.netlist.json'), 'utf8'))).toEqual(doc.netlist)
    const text = await cli(['netlist', 'sheet.json', '-o', 'second.json'], { cwd: dir })
    expect(text.out).toMatch(/^Wrote second\.json: 4 parts, 3 nets/)
  })
  it('exits 2 on a missing or invalid sheet', async () => {
    const dir = tempDir()
    expect((await cli(['netlist', 'missing.json'], { cwd: dir })).code).toBe(2)
    writeFileSync(join(dir, 'bad.json'), '{"format":"circuitoon-diagram/1"}')
    expect((await cli(['netlist', 'bad.json'], { cwd: dir })).code).toBe(2)
    expect((await cli(['netlist'], { cwd: dir })).code).toBe(2)
  })
  it('is in the usage text', () => {
    expect(USAGE).toContain('netlist <sheet.json> [-o <netlist.json>]')
  })
})
