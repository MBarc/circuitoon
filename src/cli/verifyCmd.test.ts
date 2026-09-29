// circuitoon verify and check: exit codes, stable finding ids, JSON schema, the not-checked list,
// check working on a sheet without an intent, and the --json error envelope (amendment A10).
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { NOT_CHECKED } from '../agent/notChecked.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { validateDiagram } from '../format/diagram.ts'
import { coveredHoles } from '../format/breadboard.ts'
import { type CliFinding, cliFinding, findingsText, notCheckedText, uniqueIds } from './verifyCmd.ts'

const laidOut = async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(ledNetlist()))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const edit = (dir: string, change: (sheet: Record<string, unknown> & { connections: Record<string, unknown>[] }) => void) => {
  const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
  change(sheet)
  writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
}
/** A second wire on the battery's header pin: a capacity error for verify. */
const doubleWire = (dir: string) =>
  edit(dir, (s) => {
    const bt = (s.parts as { uid: string; designator: string }[]).find((p) => p.designator === 'BT1')!
    const w = s.connections.find((c) => (c.from as { part: string }).part === bt.uid)!
    s.connections.push({ ...w, uid: 'hand' })
  })

describe('circuitoon verify and check', () => {
  it('passes a laid-out sheet, with JSON matching the schema and the not-checked list', async () => {
    const dir = await laidOut()
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(0)
    const out = JSON.parse(v.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out).toMatchObject({ format: 'circuitoon-cli/verify/1', ok: true, findings: [] })
    expect(out.notChecked.join(' ')).toContain('I2C and SPI addresses')
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const cout = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), cout)).toEqual([])
    expect(cout).toMatchObject({ format: 'circuitoon-cli/check/1', ok: true })
    const text = await cli(['verify', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(0)
    expect(text.out).toContain('No findings.')
    expect(text.out).toContain('Not checked:')
    expect((await cli(['check', 'sheet.json'], { cwd: dir })).out).toContain('Not checked:')
  })

  it('blocks a second wire on a header pin (exit 1) with a stable id', async () => {
    const dir = await laidOut()
    doubleWire(dir)
    const a = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    const b = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(a.code).toBe(1)
    const out = JSON.parse(a.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.ok).toBe(false)
    const ids = out.findings.map((f: { id: string }) => f.id)
    expect(ids.some((id: string) => id.startsWith('capacity|'))).toBe(true)
    expect(JSON.parse(b.out).findings.map((f: { id: string }) => f.id)).toEqual(ids)
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const cids = JSON.parse(c.out).findings.map((f: { id: string }) => f.id)
    expect(cids.some((id: string) => id.startsWith('capacity|'))).toBe(true)
    expect(new Set(cids).size).toBe(cids.length)
    const text = await cli(['verify', 'sheet.json'], { cwd: dir })
    expect(text.code).toBe(1)
    expect(text.out).toMatch(/^ERROR capacity: /m)
    expect(text.out).toContain('Not checked:')
  })

  it("blocks a wire end under R1's body in verify and check, reported once by check", async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const r = validateDiagram(s)
      if (!r.ok) throw new Error(r.errors.join('; '))
      const c = coveredHoles(r.diagram).find((h) => r.diagram.parts.find((p) => p.uid === h.by)!.designator === 'R1')!
      const w = s.connections.find((x) => (x.to as { hole?: number }).hole !== undefined)!
      w.to = { part: c.board, pin: c.group, hole: c.hole }
    })
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(1)
    expect(JSON.parse(v.out).findings.filter((f: CliFinding) => f.rule === 'covered-hole').map((f: CliFinding) => f.message)).toEqual([expect.stringMatching(/, under R1's body: /)])
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    expect(JSON.parse(c.out).findings.filter((f: CliFinding) => f.rule === 'covered-hole')).toHaveLength(1)
  })

  it('verify needs an intent; check still works without one', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const v = await cli(['verify', 'sheet.json', '--json'], { cwd: dir })
    expect(v.code).toBe(1)
    expect(JSON.parse(v.out).findings.map((f: { message: string }) => f.message)).toEqual([NO_INTENT])
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(0)
    const cout = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), cout)).toEqual([])
    expect(cout.findings.some((f: { message: string }) => f.message === NO_INTENT)).toBe(false)
  })

  it('check reports the wiring checker findings on a sheet without an intent', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      delete s.intent
      // Short the battery: a wire straight from + to -.
      const bt = (s.parts as { uid: string; designator: string }[]).find((p) => p.designator === 'BT1')!
      s.connections.push({ uid: 'short', from: { part: bt.uid, pin: '+' }, to: { part: bt.uid, pin: '-' } })
    })
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(c.code).toBe(1)
    const out = JSON.parse(c.out)
    expect(schemaErrors(loadSchema('findings'), out)).toEqual([])
    expect(out.findings.some((f: { rule: string; severity: string }) => f.rule === 'short' && f.severity === 'error')).toBe(true)
  })

  it('exits 2 on a file that is not a sheet, with the JSON error envelope under --json', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'x.json'), '{"format":"nope"}')
    expect((await cli(['verify', 'x.json'], { cwd: dir })).code).toBe(2)
    expect((await cli(['check', 'missing.json'], { cwd: dir })).code).toBe(2)
    for (const argv of [['verify', 'x.json', '--json'], ['check', 'missing.json', '--json'], ['verify', '--json'], ['check', '--json']]) {
      const r = await cli(argv, { cwd: dir })
      expect(r.code).toBe(2)
      const out = JSON.parse(r.out)
      expect(schemaErrors(loadSchema('error'), out)).toEqual([])
      expect(out).toMatchObject({ format: 'circuitoon-cli/error/1', ok: false, exit: 2, error: { code: 'input' } })
    }
  })

  it('keeps only the finding fields, prints plain text, and makes every id unique', () => {
    const f: CliFinding = { id: 'mount|a', rule: 'mount', severity: 'warning', message: 'm', parts: ['p'], pins: [], wires: [] }
    expect(cliFinding({ ...f, subject: 'x', target: 'y' } as CliFinding)).toEqual(f)
    expect(findingsText([f])).toBe('WARNING mount: m')
    expect(notCheckedText().split('\n')).toEqual(['Not checked:', ...NOT_CHECKED.map((n) => `  - ${n}`)])
    expect(uniqueIds([f, f, { ...f, id: 'mount|a#1' }]).map((x) => x.id)).toEqual(['mount|a', 'mount|a#1', 'mount|a#1#1'])
  })
})
