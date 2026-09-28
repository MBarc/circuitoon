// circuitoon gate (spec 5): passes a laid-out sheet with hashes that match every file; blocks a missing
// intent, a dropped value override and a hand edit; blocking findings win over a missing browser; a
// missing browser alone is exit 3; a missing required artifact (a failed focused render, A8) never
// passes; an oversized link falls back to the file without blocking.
import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { VALUE_DROPPED, validateDiagram, wirePaths } from '../format/diagram.ts'
import { worldHoles } from '../format/geometry.ts'
import { exportFileName } from '../editor/files.ts'
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
  it('counts the bill of quantities from the sheet, layout-added strips included and marked', async () => {
    const dir = await laidOut(tiltSensors())
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8')) as { parts: { designator: string; module: string }[] }
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    const q = report.quantities
    expect(q.reduce((n, r) => n + r.count, 0)).toBe(sheet.parts.length)
    const added = sheet.parts.filter((p) => /^DP\d+$/.test(p.designator))
    expect(added.length).toBeGreaterThan(0)
    const strips = q.find((r) => r.module === added[0].module)!
    expect(strips.count).toBe(sheet.parts.filter((p) => p.module === added[0].module).length)
    expect(strips.added).toBe(added.length)
    expect(q.filter((r) => r.module !== added[0].module).every((r) => r.added === 0)).toBe(true)
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
  it('blocks a wire drawn through a part (blocked-route), matching what the renderer draws', async () => {
    const dir = await laidOut({
      format: 'circuitoon-netlist/1',
      title: 'Sensor on top of the board',
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: 'bme280-module-4pin' }],
      nets: [{ name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] }, { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] }],
    })
    // Move the sensor onto the middle of the ESP32, so its wires cannot leave without crossing a body.
    edit(dir, (s) => {
      const u1 = s.parts.find((p) => p.uid === 'U1')!
      const u2 = s.parts.find((p) => p.uid === 'U2')!
      u2.x = (u1.x as number) + 20
      u2.y = (u1.y as number) + 80
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const g = gateJson(dir)
    const blockedIds = g.blocking.filter((f: { rule: string }) => f.rule === 'blocked-route').map((f: { wires: string[] }) => f.wires[0]).sort()
    expect(blockedIds.length).toBeGreaterThan(0)
    const d = validateDiagram(JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8')))
    if (!d.ok) throw new Error(d.errors.join('; '))
    expect(blockedIds).toEqual(wirePaths(d.diagram).filter((w) => w.blocked).map((w) => w.conn.uid).sort())
  })
  it('blocks a checker error on a sheet that matches its intent (a battery short)', async () => {
    const dir = await laidOut({
      format: 'circuitoon-netlist/1',
      title: 'Shorted battery',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }],
      nets: [{ name: 'SHORT', pins: ['BT1.+', 'BT1.-'] }],
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const blocking = gateJson(dir).blocking as { rule: string }[]
    expect(blocking.map((f) => f.rule)).toContain('short')
    // Only the checker objects: the sheet is exactly its intent.
    expect((await cli(['verify', 'sheet.json'], { cwd: dir })).code).toBe(0)
  })
  it('blocks an invalid intent', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      s.intent = { format: 'circuitoon-netlist/1', title: 'no parts' }
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    expect((gateJson(dir).blocking as { rule: string }[]).some((f) => f.rule === 'intent')).toBe(true)
  })
  it('blocks a stored BME280 whose SDA and SCL were swapped (module-drift), though it matches its own wiring', async () => {
    const example = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples', 'esp32-bme280.netlist.json'), 'utf8'))
    const dir = await laidOut(example)
    edit(dir, (s) => {
      const pins = (s.modules as Record<string, { pins: { name?: string }[] }>)['bme280-module-4pin'].pins
      const [a, b] = [pins.find((p) => p.name === 'SDA')!, pins.find((p) => p.name === 'SCL')!]
      ;[a.name, b.name] = ['SCL', 'SDA']
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const blocking = gateJson(dir).blocking as { rule: string; message: string }[]
    expect(blocking.map((f) => f.rule)).toEqual(['module-drift'])
    expect(blocking[0].message).toContain('bme280-module-4pin')
    expect(blocking[0].message).toContain('no longer matches the current library')
    expect(blocking[0].message).toContain('pins SCL/SDA')
    expect(blocking[0].message).toContain('Lay the sheet out again')
    expect(blocking[0].message).not.toMatch(/tamper/i)
  })
  it('only warns about a stored built-in part whose art and name alone are out of date', async () => {
    const example = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples', 'esp32-bme280.netlist.json'), 'utf8'))
    const dir = await laidOut(example)
    edit(dir, (s) => {
      const m = (s.modules as Record<string, { name: string; art: { shapes: unknown[] } }>)['bme280-module-4pin']
      m.name = 'BME280 (old)'
      m.art.shapes = m.art.shapes.slice(1)
    })
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(report.blocking.filter((f) => f.rule !== 'environment')).toEqual([])
    expect(report.warnings.filter((f) => f.rule === 'module-drift').map((f) => f.parts.length > 0)).toEqual([true])
  })
  it('finds nothing wrong with a sheet laid out now from the current library', async () => {
    const example = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples', 'esp32-bme280.netlist.json'), 'utf8'))
    const dir = await laidOut(example)
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(report.blocking.filter((f) => f.rule !== 'environment')).toEqual([])
    expect(report.warnings.filter((f) => f.rule !== 'environment')).toEqual([])
  })
  it('warns, without blocking, about a wire drawn over breadboard holes it does not use, naming the wire', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const v = validateDiagram(s)
      if (!v.ok) throw new Error(v.errors.join('; '))
      const bb = v.diagram.parts.find((p) => p.uid === 'BB1')!
      const far = worldHoles(bb, v.diagram.modules[bb.module]).find((g) => g.name === 'c3-top')!.at[0]
      const w = s.connections.find((c) => (c.from as { part: string }).part === 'BT1')!
      w.route = [[far.x, far.y]]
    })
    const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(report.blocking).toEqual([])
    expect(code).toBe(EXIT.environment)
    const over = report.warnings.filter((f) => f.rule === 'wire-over-holes')
    expect(over).toHaveLength(1)
    expect(over[0].message).toMatch(/^The wire BT1 \+ to BB1 c\d+-top hole \d runs over breadboard holes/)
    expect(over[0].wires).toHaveLength(1)
  })
  it('blocks a mounted part that no longer seats on its board', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const r1 = s.parts.find((p) => p.uid === 'R1')!
      r1.x = (r1.x as number) + 1000
      r1.y = (r1.y as number) + 1000
    })
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    expect((gateJson(dir).blocking as { rule: string }[]).some((f) => f.rule === 'mount')).toBe(true)
  })
  it('blocks when there is no link and a directory stands where the file fallback goes (link|none); a stale link.txt is gone', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      s.annotations = Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}`, type: 'text', x: 2000, y: i * 40, text: randomBytes(360).toString('base64') }))
    })
    mkdirSync(join(dir, 'out', exportFileName('LED on a breadboard')), { recursive: true })
    writeFileSync(join(dir, 'out', 'link.txt'), 'https://mbarc.github.io/circuitoon/#/editor?d=v1.stale\n')
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    const g = gateJson(dir)
    expect(g.blocking.map((f: { id: string }) => f.id)).toContain('link|none')
    expect(g.link.url).toBe(null)
    expect(existsSync(join(dir, 'out', 'link.txt'))).toBe(false)
    expect(existsSync(join(dir, 'out', exportFileName('LED on a breadboard')))).toBe(true) // a directory is never removed
  })
  it('never leaves an earlier gate.json, link or focused PNG behind a failed or different run', async () => {
    const dir = await laidOut(tiltSensors())
    const outDir = join(dir, 'out')
    // A first run leaves gate.json, link.txt and sheet.svg.
    expect((await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })).code).toBe(3)
    expect(existsSync(join(outDir, 'gate.json'))).toBe(true)
    expect(existsSync(join(outDir, 'link.txt'))).toBe(true)
    // A usage error, a missing sheet: exit 2, and nothing from the first run is left looking current.
    expect((await cli(['gate', 'sheet.json', 'extra.json', '-o', 'out'], { cwd: dir })).code).toBe(2)
    expect(existsSync(join(outDir, 'gate.json'))).toBe(false)
    writeFileSync(join(outDir, 'gate.json'), '{}')
    expect((await cli(['gate', 'missing.json', '-o', 'out'], { cwd: dir })).code).toBe(2)
    expect(existsSync(join(outDir, 'gate.json'))).toBe(false)
    // An old focused PNG, and the file fallback an old gate.json names, go before the next run writes.
    writeFileSync(join(outDir, 'focus-old_1.png'), 'old')
    writeFileSync(join(outDir, 'Old sheet.circuitoon.json'), '{}')
    writeFileSync(join(outDir, 'gate.json'), JSON.stringify({ artifacts: [{ kind: 'file', path: 'Old sheet.circuitoon.json' }, { kind: 'file', path: '../sheet.json' }] }))
    let seen: string[] = []
    const png = () => {
      seen = readdirSync(outDir)
      return { ok: false as const, message: 'no browser in this test' }
    }
    // runGate alone (the command removes gate.json first; runGate removes the renders and links).
    await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir, io: quietIo(dir), png })
    expect(seen).not.toContain('focus-old_1.png')
    expect(seen).not.toContain('link.txt')
    expect((await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })).code).toBe(3)
    expect(existsSync(join(outDir, 'Old sheet.circuitoon.json'))).toBe(false)
    expect(existsSync(join(dir, 'sheet.json'))).toBe(true) // outside the output directory: never touched
  })
  it('never removes the sheet being gated, even inside the output directory', async () => {
    const dir = await laidOut()
    const name = exportFileName('LED on a breadboard')
    copyFileSync(join(dir, 'sheet.json'), join(dir, name))
    // An old gate.json in the same folder names that very file as its fallback.
    writeFileSync(join(dir, 'gate.json'), JSON.stringify({ artifacts: [{ kind: 'file', path: name }] }))
    expect((await cli(['gate', name, '-o', '.'], { cwd: dir, env: noBrowser(dir) })).code).toBe(3)
    expect(readFileSync(join(dir, name), 'utf8')).toContain('circuitoon-diagram/1')
  })
  it('exits 2 when the sheet file is missing, and needs -o', async () => {
    const dir = tempDir()
    expect((await cli(['gate', 'missing.json', '-o', 'out'], { cwd: dir })).code).toBe(2)
    expect((await cli(['gate', 'missing.json'], { cwd: dir })).code).toBe(2)
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })
})
