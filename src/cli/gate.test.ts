// circuitoon gate (spec 5): passes a laid-out sheet with hashes that match every file; blocks a missing
// intent, a dropped value override and a hand edit; blocking findings win over a missing browser; a
// missing browser alone is exit 3; a missing required artifact (a failed focused render, A8) never
// passes; an oversized link falls back to the file without blocking.
import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { VALUE_DROPPED } from '../format/diagram.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { EXIT, type Io } from './io.ts'
import { runGate } from './gate.ts'
import { ledNetlist, tiltSensors } from '../agent/fixtures.testing.ts'

const browser = findBrowser(process.env)
const noBrowser = (dir: string) => ({ CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') })
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const laidOut = async (netlist: unknown = ledNetlist()) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
type Sheet = Record<string, unknown> & { parts: Record<string, unknown>[]; connections: Record<string, unknown>[] }
const edit = (dir: string, change: (s: Sheet) => void) => {
  const s = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
  change(s)
  writeFileSync(join(dir, 'sheet.json'), JSON.stringify(s))
}
const gateJson = (dir: string) => JSON.parse(readFileSync(join(dir, 'out', 'gate.json'), 'utf8'))
const quietIo = (dir: string): Io => ({ stdout: () => {}, stderr: () => {}, cwd: dir, env: noBrowser(dir) })

describe('circuitoon gate', () => {
  it.skipIf(!browser)('passes a laid-out sheet, and every hash in gate.json matches its file', async () => {
    const dir = await laidOut(tiltSensors())
    const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(JSON.parse(r.out)).toEqual(g)
    expect(g.ok).toBe(true)
    expect(g.diagram.sha256).toBe(sha(join(dir, 'sheet.json')))
    expect(g.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual(['focus-png', 'link', 'png', 'svg'])
    for (const a of g.artifacts) expect(sha(join(dir, 'out', a.path)), a.path).toBe(a.sha256)
    expect(g.notChecked.length).toBeGreaterThan(0)
    expect(g.quantities.length).toBeGreaterThan(0)
    expect(g.channels).toHaveLength(8)
  }, 120_000)
  it('blocks a sheet with no intent (exit 1), even without a browser', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    expect(r.out).toContain('GATE BLOCKED')
    const g = gateJson(dir)
    expect(g.ok).toBe(false)
    expect(g.blocking.map((f: { message: string }) => f.message)).toContain(NO_INTENT)
  })
  it('blocks a dropped value override and a second wire on a header pin', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const r1 = s.parts.find((p) => p.uid === 'R1')!
      r1.values = { resistance: { value: 220, unit: 'F' } }
      const w = s.connections.find((c) => (c.from as { part: string }).part === 'BT1')!
      s.connections.push({ ...w, uid: 'hand' })
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const blocking = gateJson(dir).blocking as { rule: string; message: string }[]
    expect(blocking.some((f) => f.rule === 'load' && f.message.includes(VALUE_DROPPED))).toBe(true)
    expect(blocking.some((f) => f.rule === 'capacity')).toBe(true)
    expect(blocking.some((f) => f.rule === 'value-drift')).toBe(true)
  })
  it('blocks a sheet that does not load (exit 1, not 2), and writes gate.json saying why', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), '{ not json')
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(g.blocking[0].rule).toBe('load')
    writeFileSync(join(dir, 'sheet.json'), '{"format":"circuitoon-diagram/1"}')
    expect((await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })).code).toBe(1)
    expect(gateJson(dir).blocking.some((f: { message: string }) => f.message.includes('title'))).toBe(true)
  })
  it('is an environment problem (exit 3) when only the browser is missing', async () => {
    const dir = await laidOut()
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(3)
    expect(r.out).toContain('GATE INCOMPLETE')
    expect(r.err).toContain('No Chrome or Edge found')
    const g = gateJson(dir)
    expect(g.format).toBe('circuitoon-cli/gate/1')
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(g.ok).toBe(false)
    expect(g.blocking).toEqual([])
    expect(g.warnings.some((f: { rule: string }) => f.rule === 'environment')).toBe(true)
    // The SVG and the link need no browser, so they are still written and hashed.
    expect(g.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual(['link', 'svg'])
  })
  it('in --json mode prints the report on exit 3, and an error envelope on a usage error (A10)', async () => {
    const dir = await laidOut()
    const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(3)
    expect(JSON.parse(r.out)).toEqual(gateJson(dir))
    expect(r.err).toContain('No Chrome or Edge found')
    const u = await cli(['gate', 'sheet.json', '--json'], { cwd: dir })
    expect(u.code).toBe(2)
    const env = JSON.parse(u.out)
    expect(schemaErrors(loadSchema('error'), env)).toEqual([])
    expect(env).toMatchObject({ ok: false, exit: 2, error: { code: 'input' } })
  })
  it('does not pass when the full render works but the focused render fails (A8)', async () => {
    const dir = await laidOut(tiltSensors())
    const bytes = readFileSync(join(dir, 'sheet.json'))
    const outDir = join(dir, 'out')
    const shots: string[] = []
    // A browser that writes the full PNG and fails the focused one.
    const png = (_svg: unknown, _scale: number, out: string) => {
      shots.push(out)
      if (out.endsWith('sheet.png')) {
        writeFileSync(out, 'png bytes')
        return { ok: true as const, width: 1, height: 1 }
      }
      return { ok: false as const, message: 'the browser crashed' }
    }
    const { code, report } = await runGate(bytes, { sheetPath: 'sheet.json', outDir, io: quietIo(dir), png })
    expect(shots.map((s) => s.slice(outDir.length + 1))).toEqual(['sheet.png', 'focus-tilt_1.png'])
    expect(code).toBe(EXIT.environment)
    expect(report.ok).toBe(false)
    expect(report.artifacts.map((a) => a.kind).sort()).toEqual(['link', 'png', 'svg'])
    expect(report.warnings.find((w) => w.rule === 'environment')?.message).toContain('the browser crashed')
    // Blocking findings still win over it.
    const blocked = JSON.parse(bytes.toString())
    delete blocked.intent
    const b = await runGate(new TextEncoder().encode(JSON.stringify(blocked)), { sheetPath: 'sheet.json', outDir, io: quietIo(dir), png })
    expect(b.code).toBe(EXIT.blocked)
  })
  it.skipIf(!browser)('writes the file instead of an oversized link, as a warning, not a block', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      s.annotations = Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}`, type: 'text', x: 2000, y: i * 40, text: randomBytes(360).toString('base64') }))
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir })
    expect(r.code).toBe(0)
    const g = gateJson(dir)
    expect(g.link.url).toBe(null)
    expect(existsSync(join(dir, 'out', g.link.file))).toBe(true)
    expect(g.artifacts.find((a: { kind: string }) => a.kind === 'file').path).toBe(g.link.file)
    expect(g.warnings.some((f: { rule: string }) => f.rule === 'link')).toBe(true)
  }, 120_000)
  it('exits 2 when the sheet file is missing, and needs -o', async () => {
    const dir = tempDir()
    expect((await cli(['gate', 'missing.json', '-o', 'out'], { cwd: dir })).code).toBe(2)
    expect((await cli(['gate', 'missing.json'], { cwd: dir })).code).toBe(2)
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })
})
