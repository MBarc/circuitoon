// circuitoon gate (spec 5): passes a laid-out sheet with hashes that match every file; blocks a missing
// intent, a dropped value override and a hand edit; blocking findings win over a missing browser; a
// missing browser alone is exit 3; a missing required artifact (a failed focused render, A8) never
// passes; an oversized link falls back to the file without blocking.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_INTENT } from '../agent/verify.ts'
import { VALUE_DROPPED, validateDiagram, wirePaths } from '../format/diagram.ts'
import { bodyRect, worldHoles } from '../format/geometry.ts'
import { plugsOf } from '../format/breadboard.ts'
import { exportFileName } from '../editor/files.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { EXIT, type Io } from './io.ts'
import { gateBanner, gateEngine, runGate } from './gate.ts'
import { checkDiagram } from '../format/checks.ts'
import type { Engine } from '../sim/engine/engine.ts'
import type { EngineHost } from '../sim/engine/host.ts'
import { bomCsv } from '../format/bom.ts'
import { bomQuantities } from '../agent/tables.ts'
import { READABILITY_RULES } from '../agent/readabilityWarnings.ts'
import { captionBox } from '../render/captionBox.ts'
import { layoutModule } from '../format/module.ts'
import { ledNetlist, tiltSensors } from '../agent/fixtures.testing.ts'

const browser = findBrowser(process.env)
const noBrowser = (dir: string) => ({ CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') })
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const laidOut = async (netlist: unknown = ledNetlist(), labels = 'auto') => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json', '--labels', labels], { cwd: dir })).code).toBe(0)
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

// Gate tests that do not test simulation never start the engine (Task 31's stub seam).
const realEngine = gateEngine.make
beforeEach(() => {
  gateEngine.make = () => null
})

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
    expect(g.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual(['bom', 'focus-png', 'link', 'png', 'svg'])
    for (const a of g.artifacts) expect(sha(join(dir, 'out', a.path)), a.path).toBe(a.sha256)
    expect(g.notChecked.length).toBeGreaterThan(0)
    expect(g.quantities.length).toBeGreaterThan(0)
    expect(g.channels).toHaveLength(8)
  }, 120_000)
  it('counts the bill of quantities from the sheet, layout-added strips included and marked', async () => {
    const dir = await laidOut(tiltSensors(), 'none') // wires only: the block keeps its local rail strips
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8')) as { parts: { designator: string; module: string }[] }
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    const q = report.quantities
    expect(q.reduce((n, r) => n + r.count, 0)).toBe(sheet.parts.filter((p) => p.module !== 'net-label').length)
    const added = sheet.parts.filter((p) => /^DP\d+$/.test(p.designator))
    expect(added.length).toBeGreaterThan(0)
    const strips = q.find((r) => r.module === added[0].module)!
    expect(strips.count).toBe(sheet.parts.filter((p) => p.module === added[0].module).length)
    expect(strips.added).toBe(added.length)
    expect(q.filter((r) => r.module !== added[0].module).every((r) => r.added === 0)).toBe(true)
  }, 120_000)
  it('writes bom.csv from the same bill as gate.json, hashed, and the bill of quantities agrees with it', async () => {
    const dir = await laidOut(tiltSensors())
    const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(3)
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    const csv = readFileSync(join(dir, 'out', 'bom.csv'), 'utf8')
    expect(csv).toBe(bomCsv(g.bom))
    const entry = g.artifacts.find((a: { kind: string }) => a.kind === 'bom')
    expect(entry.path).toBe('bom.csv')
    expect(entry.sha256).toBe(sha(join(dir, 'out', 'bom.csv')))
    expect(g.quantities).toEqual(bomQuantities(g.bom))
    // Every part is in the CSV once: its Qty column adds up to the sheet's parts.
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    const qty = csv.trim().split(/\r\n/).slice(1).filter((l) => l.startsWith('"Part"')).reduce((n, l) => n + Number(l.split('","')[1]), 0)
    expect(qty).toBe(sheet.parts.filter((p: { module: string }) => p.module !== 'net-label').length)
    // A stale bom.csv never survives a run that stops before writing one.
    writeFileSync(join(dir, 'sheet.json'), '{ not json')
    expect((await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })).code).toBe(1)
    expect(existsSync(join(dir, 'out', 'bom.csv'))).toBe(false)
  })
  it('blocks a sheet with no intent (exit 1), even without a browser', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(1)
    expect(r.out).toContain('GATE FAILED')
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
    expect(g.format).toBe('circuitoon-cli/gate/4')
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(g.ok).toBe(false)
    expect(g.blocking).toEqual([])
    expect(g.warnings.some((f: { rule: string }) => f.rule === 'environment')).toBe(true)
    // The SVG, the bill of materials and the link need no browser, so they are still written and hashed.
    expect(g.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual(['bom', 'link', 'svg'])
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
    expect(report.artifacts.map((a) => a.kind).sort()).toEqual(['bom', 'link', 'png', 'svg'])
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
  /** The laid-out LED sheet with BT1 +'s wire drawn by hand through c3-top hole 0, and with `busy` another wire ending there. */
  const overC3 = async (busy: boolean) => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const v = validateDiagram(s)
      if (!v.ok) throw new Error(v.errors.join('; '))
      const bb = v.diagram.parts.find((p) => p.uid === 'BB1')!
      const w = s.connections.find((c) => (c.from as { part: string; pin: string }).part === 'BT1' && (c.from as { pin: string }).pin === '+')!
      // A strip no wire and no leg uses (never the one the wire itself ends in).
      const taken = new Set([...v.diagram.connections.flatMap((c) => [c.from.pin, c.to.pin]), ...plugsOf(v.diagram).map((pl) => pl.group)])
      const strip = ['c3-top', 'c9-top', 'c25-top'].find((g) => !taken.has(g))!
      const far = worldHoles(bb, v.diagram.modules[bb.module]).find((g) => g.name === strip)!.at[0]
      // Down through that strip's hole 0, along its row past the board's first column, up beside the
      // rails and in along its own + rail to its hole.
      const end = worldHoles(bb, v.diagram.modules[bb.module]).find((g) => g.name === (w.to as { pin: string }).pin)!.at[(w.to as { hole?: number }).hole ?? 0]
      w.route = [[far.x, far.y], [end.x - 20, far.y], [end.x - 20, end.y]]
      if (busy) s.connections.push({ uid: 'x', from: { part: 'BB1', pin: strip, hole: 0 }, to: { part: 'BB1', pin: strip, hole: 4 }, routing: true })
    })
    return runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
  }
  it('warns, without blocking, about a wire drawn over a used breadboard hole it does not use, naming the wire', async () => {
    const { code, report } = await overC3(true)
    expect(report.blocking).toEqual([])
    expect(code).toBe(EXIT.environment)
    const over = report.warnings.filter((f) => f.rule === 'wire-over-holes')
    expect(over).toHaveLength(1)
    expect(over[0].message).toMatch(/^The wire BT1 \+ to BB1 \S+ hole \d+ runs over breadboard holes/)
    expect(over[0].wires).toHaveLength(1)
  })
  it('is not ready with a wire drawn over breadboard holes in use (wire-over-holes counts)', async () => {
    const { report } = await overC3(true)
    expect(report.warnings.some((w) => w.rule === 'wire-over-holes')).toBe(true)
    expect(report.ready).toBe(false)
  })
  it('does not warn about a wire drawn over empty breadboard holes (Ruling C1)', async () => {
    const { report } = await overC3(false)
    expect(report.blocking).toEqual([])
    expect(report.warnings.filter((f) => f.rule === 'wire-over-holes')).toEqual([])
  })
  it("blocks an old DIP-28 copy with module-drift only: no covered-hole from the old drawing's body", async () => {
    const dir = tempDir()
    const dip = JSON.parse(readFileSync(join('modules', 'mcp23017-dip28.json'), 'utf8'))
    dip.pins = dip.pins.map((p: { side: string }) => ({ ...p, side: p.side === 'bottom' ? 'left' : 'right' }))
    dip.size = { w: 10, h: 19 }
    dip.art = { w: 100, h: 190, pinLabels: 'inside', shapes: [{ type: 'rect', x: 0, y: 0, w: 100, h: 190, fill: '#1E2126' }] }
    const sheet = {
      format: 'circuitoon-diagram/1', title: 'old dip',
      modules: { 'breadboard-half': JSON.parse(readFileSync(join('modules', 'breadboard-half.json'), 'utf8')), 'mcp23017-dip28': dip },
      parts: [
        { uid: 'BB1', designator: 'BB1', module: 'breadboard-half', x: 0, y: 0 },
        { uid: 'U1', designator: 'U1', module: 'mcp23017-dip28', x: 60, y: 20, rotation: 90, mount: { board: 'BB1' } },
      ],
      connections: [{ uid: 'w1', from: { part: 'BB1', pin: 'c5-top', hole: 2 }, to: { part: 'BB1', pin: 'c25-top', hole: 0 } }],
    }
    writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    const rules = report.blocking.map((f) => f.rule)
    expect(rules).toContain('module-drift')
    expect(rules).not.toContain('covered-hole')
    expect(report.blocking.find((f) => f.rule === 'module-drift')!.message).toContain('U1 must be placed again')
    const c = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(JSON.parse(c.out).findings.map((f: { rule: string }) => f.rule)).not.toContain('covered-hole')
  })
  it('blocks a part whose body covers occupied holes though its copy drifted only in its name', async () => {
    // R1's body covers D1's legs (c2-top and c6-top hole 0); only R1's module name is out of date.
    const dir = await laidOut()
    edit(dir, (s) => {
      const mods = s.modules as Record<string, Record<string, unknown>>
      mods.resistor.name = 'Resistor (old)'
      const bb = s.parts.find((p) => p.uid === 'BB1')!
      for (const p of s.parts) if (p.uid === 'R1' || p.uid === 'D1') Object.assign(p, { x: (bb.x as number) + (p.uid === 'R1' ? 30 : 40), y: (bb.y as number) + 40, rotation: 0, mount: { board: 'BB1' } })
      s.connections = s.connections.filter((c) => ![c.from, c.to].some((e) => ['R1', 'D1'].includes((e as { part: string }).part)))
    })
    const v = validateDiagram(JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8')))
    if (!v.ok) throw new Error(v.errors.join('; '))
    expect(plugsOf(v.diagram).filter((p) => p.part === 'D1')).toHaveLength(2)
    const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(report.warnings.filter((f) => f.rule === 'module-drift')).toHaveLength(1)
    expect(report.blocking.map((f) => f.rule)).toContain('covered-hole')
    expect(code).toBe(1)
    expect(report.ok).toBe(false)
    expect(report.ready).toBe(false)
  })
  it('reports blocked-route for a wire whose every way out of its breadboard hole runs through a part', async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const v = validateDiagram(s)
      if (!v.ok) throw new Error(v.errors.join('; '))
      const w = v.diagram.connections.find((c) => c.from.part === 'BT1' && c.from.pin === '+')!
      const bb = v.diagram.parts.find((p) => p.uid === 'BB1')!
      const h = worldHoles(bb, v.diagram.modules[bb.module]).find((g) => g.name === w.to.pin)!.at[w.to.hole ?? 0]
      ;(s.modules as Record<string, unknown>).resistor ??= JSON.parse(readFileSync(join('modules', 'resistor.json'), 'utf8'))
      for (const [uid, x, y] of [['X1', h.x - 75, h.y - 20], ['X2', h.x + 15, h.y - 20], ['X3', h.x - 30, h.y - 55], ['X4', h.x - 30, h.y + 15]] as const)
        s.parts.push({ uid, designator: uid, module: 'resistor', x, y })
    })
    const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(code).toBe(1)
    expect(report.blocking.filter((f) => f.rule === 'blocked-route').map((f) => f.message)).toEqual([expect.stringMatching(/^The wire BT1 \+ to BB1 c\d+-top hole \d+ has no clear route/)])
  })
  it('lists a note (info) under notes, never blocking, and prints it', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), readFileSync(new URL('../format/fixtures/battery-bank-1s4p.circuitoon.json', import.meta.url)))
    const { report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    expect(schemaErrors(loadSchema('gate'), report)).toEqual([])
    expect(report.notes.map((f) => `${f.severity} ${f.rule}`)).toEqual(['info battery-bank'])
    expect([...report.blocking, ...report.warnings].map((f) => f.rule)).not.toContain('battery-bank')
    expect(report.warnings.map((f) => f.rule)).not.toContain('supplies-parallel')
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.out).toContain('Notes (not problems; pass them on to the user):\nINFO battery-bank: BT1-BT4 form a parallel battery bank')
    expect(gateJson(dir).notes).toHaveLength(1)
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

describe('gate readiness (Ruling W1)', () => {
  const fakePng = (_svg: unknown, _scale: number, out: string) => {
    writeFileSync(out, 'png')
    return { ok: true as const, width: 1, height: 1 }
  }
  /** The laid-out LED sheet with the battery moved so its body sits on R1's caption. */
  const overCaption = async () => {
    const dir = await laidOut()
    edit(dir, (s) => {
      const v = validateDiagram(s)
      if (!v.ok) throw new Error(v.errors.join('; '))
      const r1 = v.diagram.parts.find((p) => p.uid === 'R1')!
      const bt = v.diagram.parts.find((p) => p.uid === 'BT1')!
      const cap = captionBox(r1, v.diagram.modules[r1.module])
      const body = bodyRect(bt, layoutModule(v.diagram.modules[bt.module]))
      const raw = s.parts.find((p) => p.uid === 'BT1')!
      raw.x = Math.round((bt.x + cap.x + cap.w / 2 - (body.x + body.w / 2)) / 10) * 10
      raw.y = Math.round((bt.y + cap.y + cap.h + 40 - (body.y + body.h / 2)) / 10) * 10
    })
    return dir
  }
  it('is ready when the gate passes with no readability warnings', async () => {
    const example = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples', 'esp32-bme280.netlist.json'), 'utf8'))
    const dir = await laidOut(example)
    const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir), png: fakePng })
    expect(code).toBe(EXIT.ok)
    expect(report.format).toBe('circuitoon-cli/gate/4')
    expect(report.ready).toBe(true)
    expect(schemaErrors(loadSchema('gate'), report)).toEqual([])
  })
  it('is not ready while a readability warning remains, though it still exits 0', async () => {
    const dir = await overCaption()
    const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir), png: fakePng })
    expect(report.blocking).toEqual([])
    expect(code).toBe(EXIT.ok)
    expect(report.ok).toBe(true)
    expect(report.ready).toBe(false)
    expect(report.warnings.some((w) => w.rule === 'label-covered')).toBe(true)
    expect(schemaErrors(loadSchema('gate'), report)).toEqual([])
  })
  it('says NOT READY on the first line of the summary, with the count of readability warnings', async () => {
    const dir = await overCaption()
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    const g = gateJson(dir)
    const n = g.warnings.filter((w: { rule: string }) => (READABILITY_RULES as readonly string[]).includes(w.rule)).length
    expect(n).toBeGreaterThan(0)
    expect(g.ready).toBe(false)
    expect(r.out.split('\n')[0]).toBe(`NOT READY: ${n} readability warning${n === 1 ? '' : 's'}`)
  })
})

describe('gate/4: simulation (spec 7)', () => {
  beforeEach(() => {
    gateEngine.make = realEngine
  })
  const failing = (status: 'failed' | 'unavailable'): Engine => ({
    host: { runs: 0, info: null } as unknown as EngineHost,
    init: async () => ({ name: 'ngspice', version: '45.2', build: 'fake' }),
    run: async (_c, _a, revision) => (status === 'failed' ? { status, revision, error: 'singular matrix', nodes: [] } : { status, reason: 'no engine' }),
    dispose() {},
  })
  const shorted = async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify({
      format: 'circuitoon-netlist/1', title: 'short',
      parts: [{ ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1', values: { 'contact.s': 'closed' } }],
      nets: [{ name: 'A', pins: ['BT1.+', 'S1.1'] }, { name: 'GND', pins: ['S1.2', 'BT1.-'] }],
    }))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    return dir
  }
  it('fails on a blocking simulation finding when the checker is clean of errors', async () => {
    const dir = await shorted()
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    const g = gateJson(dir)
    expect(schemaErrors(loadSchema('gate'), g)).toEqual([])
    expect(g.sim.status).toBe('ok')
    expect(g.blocking.some((f: { rule: string }) => f.rule === 'sim-short')).toBe(true)
    expect(r.code).toBe(1)
    expect(r.out).toContain('GATE FAILED (simulation): 1 blocking finding (sheet.json)')
  }, 120_000)
  it('fails with the plain banner when the checker and the simulation both block (matrix row 1)', async () => {
    const dir = await shorted()
    edit(dir, (s) => void delete s.intent)
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    const g = gateJson(dir)
    expect(r.code).toBe(1)
    expect(g.ok).toBe(false)
    expect(g.ready).toBe(false)
    expect(g.blocking.map((f: { message: string }) => f.message)).toContain(NO_INTENT)
    expect(g.blocking.some((f: { rule: string }) => f.rule === 'sim-short')).toBe(true)
    expect(r.out).toMatch(/GATE FAILED: \d+ blocking findings \(sheet\.json\)/)
  }, 120_000)
  it('is incomplete (exit 3), keeping the checker findings, when the engine throws', async () => {
    const dir = await laidOut()
    edit(dir, (s) => void delete s.intent)
    const bytes = readFileSync(join(dir, 'sheet.json'))
    const throwing: Engine = { ...failing('failed'), run: async () => { throw new Error('worker crashed') } }
    const withSim = await runGate(bytes, { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir), engine: throwing })
    const without = await runGate(bytes, { sheetPath: 'sheet.json', outDir: join(dir, 'out2'), io: quietIo(dir), engine: null })
    // The checker's verdict is untouched: the intent still blocks.
    expect(withSim.report.blocking).toEqual(without.report.blocking)
    expect(withSim.code).toBe(EXIT.blocked)
    expect(withSim.report.sim.status).toBe('failed')
    expect(withSim.report.sim.findings.map((f) => f.severity)).toEqual(['warning'])
    expect(withSim.report.sim.findings[0].raw).toContain('worker crashed')
    // With nothing blocking, the throw is exit 3 and the INCOMPLETE banner.
    const clean = await laidOut()
    const r = await runGate(readFileSync(join(clean, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(clean, 'out'), io: quietIo(clean), engine: throwing })
    expect(r.code).toBe(EXIT.environment)
    expect(r.report.blocking).toEqual([])
    expect(r.report.warnings.some((f) => f.rule === 'sim-no-convergence')).toBe(true)
    expect(gateBanner(r.code, r.report, 'sheet.json')).toContain('GATE INCOMPLETE (simulation did not converge')
  }, 120_000)
  it('says why the simulation is unavailable on stderr in text mode', async () => {
    const dir = await laidOut()
    gateEngine.make = () => failing('unavailable')
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    expect(r.code).toBe(EXIT.environment)
    expect(r.err).toContain('Simulation unavailable: no engine')
    expect(r.out).toContain('GATE INCOMPLETE (simulation unavailable): sheet.json')
  }, 120_000)
  it('folds the "not powered: S1 is open" warnings into one line in the text output (ruling R30)', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify({
      format: 'circuitoon-netlist/1', title: 'off',
      parts: [{ ref: 'BB1', module: 'breadboard-half' }, { ref: 'BT1', module: 'battery-holder-2xaa' }, { ref: 'S1', module: 'rocker-switch-kcd1' }, { ref: 'U1', module: 'esp32-devkit-v1-30' }, { ref: 'U2', module: 'esp32-devkit-v1-30' }],
      nets: [{ name: 'VB', pins: ['BT1.+', 'S1.1'] }, { name: 'V', pins: ['S1.2', 'U1.3V3', 'U2.3V3'] }, { name: 'GND', pins: ['BT1.-', 'U1.GND', 'U2.GND'] }],
    }))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const r = await cli(['gate', 'sheet.json', '-o', 'out'], { cwd: dir, env: noBrowser(dir) })
    const off = r.out.split('\n').filter((l) => l.includes('S1 is open'))
    expect(off).toEqual(['WARNING sim-brownout: not powered in the current state because S1 is open: U1 3V3, U2 3V3. Set S1 to its operating position to simulate them running.'])
    expect(gateJson(dir).warnings.filter((f: { rule: string }) => f.rule === 'sim-brownout')).toHaveLength(2)
  }, 120_000)
  it('is incomplete (exit 3) when the solve fails or the engine is unavailable, and never blocks on it', async () => {
    for (const [status, banner] of [['failed', 'simulation did not converge'], ['unavailable', 'simulation unavailable']] as const) {
      const dir = await laidOut()
      const { code, report } = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir), engine: failing(status) })
      expect(code).toBe(EXIT.environment)
      expect(report.ok).toBe(false)
      expect(report.ready).toBe(false)
      expect(report.blocking).toEqual([])
      expect(report.sim.status).toBe(status)
      expect(gateBanner(code, report, 'sheet.json')).toContain(banner)
    }
  }, 240_000)
  it('reports an unplugged board in its own group: the checker findings are what checkDiagram gives, and the sim adds its warning', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify({ format: 'circuitoon-netlist/1', title: 'devkit', parts: [{ ref: 'U1', module: 'esp32-devkit-v1-30' }, { ref: 'R1', module: 'resistor' }], nets: [{ name: 'IO', pins: ['U1.D4', 'R1.1'] }, { name: 'GND', pins: ['R1.2', 'U1.GND'] }] }))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const bytes = readFileSync(join(dir, 'sheet.json'))
    const { report } = await runGate(bytes, { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quietIo(dir) })
    const v = validateDiagram(JSON.parse(bytes.toString('utf8')))
    if (!v.ok) throw new Error('sheet')
    const checker = checkDiagram(v.diagram).map((f) => f.id).sort()
    const gated = [...report.blocking, ...report.warnings, ...report.notes].filter((f) => !f.rule.startsWith('sim-') && checker.includes(f.id)).map((f) => f.id).sort()
    expect(gated).toEqual(checker)
    expect(report.warnings.some((f) => f.rule === 'sim-brownout' && f.message.includes('is not powered'))).toBe(true)
  }, 120_000)
})
