// circuitoon module new|check|render: a custom part from a spec (file or standard input), the lint as
// a report and an exit code, a render of the part alone, and the round trip a custom part has to
// survive: spec to module, embedded in a netlist, laid out, gated, and opened like the editor opens it.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { EXIT, type Io } from './io.ts'
import { runGate } from './gate.ts'
import { USAGE } from './main.ts'
import { validateDiagram } from '../format/diagram.ts'
import { openLinkPayload, payloadFromHash } from '../format/link.ts'
import { checkDiagram } from '../format/checks.ts'

const browser = findBrowser(process.env)
// A made-up breakout for the tests; the URLs are placeholders.
const SPEC = {
  format: 'circuitoon-part-spec/1',
  name: 'Test humidity sensor (I2C)',
  category: 'Sensors',
  source: ['https://example.com/datasheet.pdf', 'https://example.com/pinout'],
  pins: {
    left: [{ name: 'VCC', type: 'power_in', supply: '3V3/5V' }, { name: 'GND', type: 'ground' }, { name: 'SCL', type: 'input' }, { name: 'SDA', type: 'io' }],
  },
}
const ID = 'custom-test-humidity-sensor-i2c'
const withSpec = (spec: unknown = SPEC) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec))
  return dir
}
const json = (s: string) => JSON.parse(s)

describe('circuitoon module new', () => {
  it('prints the module for a spec file, and writes it with -o', async () => {
    const dir = withSpec()
    const r = await cli(['module', 'new', '--spec', 'spec.json'], { cwd: dir })
    expect(r.code).toBe(0)
    const m = json(r.out)
    expect(m).toMatchObject({ format: 'circuitoon-module/1', id: ID, custom: true, category: 'Sensors' })
    const w = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: dir })
    expect(w.code).toBe(0)
    expect(w.out).toContain(`Wrote part.json: ${ID} (4 pins,`)
    expect(w.out).toContain('a custom part, unverified')
    expect(json(readFileSync(join(dir, 'part.json'), 'utf8'))).toEqual(m)
  })

  it('reads the spec from standard input, with --spec left out or "-"', async () => {
    const dir = tempDir()
    for (const argv of [['module', 'new'], ['module', 'new', '--spec', '-']]) {
      const r = await cli(argv, { cwd: dir, stdin: JSON.stringify(SPEC) })
      expect(r.code, argv.join(' ')).toBe(0)
      expect(json(r.out).id).toBe(ID)
    }
    const none = await cli(['module', 'new', '--json'], { cwd: dir, stdin: '' })
    expect(none.code).toBe(EXIT.input)
    expect(schemaErrors(loadSchema('error'), json(none.out))).toEqual([])
    expect(json(none.out).error.message).toContain('pipe the spec on standard input')
    const bad = await cli(['module', 'new'], { cwd: dir, stdin: '{ nope' })
    expect(bad.code).toBe(EXIT.input)
    expect(bad.err).toContain('standard input: not valid JSON')
  })

  it('reports in --json to its schema, notes and warnings included', async () => {
    const dir = withSpec({ name: 'Bare', pins: { left: ['VCC', 'GND', 'GND'] } })
    const r = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'p.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = json(r.out)
    expect(schemaErrors(loadSchema('module-new'), out)).toEqual([])
    expect(out.ok).toBe(true)
    expect(out.path).toBe('p.json')
    expect(out.notes[0]).toContain('GND -> GND 2')
    expect(out.warnings.map((w: { code: string }) => w.code)).toEqual(['power-untyped', 'power-untyped', 'power-untyped', 'no-types', 'no-source'])
  })

  it('refuses a spec that is not valid (exit 2) and writes nothing for lint errors (exit 1)', async () => {
    const dir = withSpec({ name: 'X', pins: { left: [{ name: 'A', type: 'analog' }] } })
    const bad = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'p.json'], { cwd: dir })
    expect(bad.code).toBe(EXIT.input)
    expect(bad.err).toContain('spec.json is not a valid part spec: pins.left[0].type')
    const lint = withSpec({ name: 'X', source: 'https://example.com/x', pins: { left: [{ name: 'A', type: 'input', caps: { outputOnly: true } }] } })
    const r = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'p.json', '--json'], { cwd: lint })
    expect(r.code).toBe(EXIT.blocked)
    expect(json(r.out)).toMatchObject({ ok: false, path: null, errors: [{ code: 'type-caps', pin: 'A' }] })
    expect(existsSync(join(lint, 'p.json'))).toBe(false)
    expect((await cli(['module', 'new', '--spec', 'missing.json'], { cwd: lint })).code).toBe(EXIT.input)
  })

  it('is in the usage, and rejects an unknown subcommand', async () => {
    expect(USAGE).toContain('module new [--spec <spec.json>] [-o <part.json>] [--json]')
    expect(USAGE).toContain('module check <part.json> [--json]')
    expect(USAGE).toContain('module render <part.json> -o <part.png>')
    const r = await cli(['module', 'make'])
    expect(r.code).toBe(EXIT.input)
    expect(r.err).toContain('unknown subcommand "make"')
    expect((await cli(['module'])).code).toBe(EXIT.input)
  })
})

describe('circuitoon module check', () => {
  it('passes a part from module new, to its schema', async () => {
    const dir = withSpec()
    await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: dir })
    const r = await cli(['module', 'check', 'part.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = json(r.out)
    expect(schemaErrors(loadSchema('module-check'), out)).toEqual([])
    expect(out).toMatchObject({ ok: true, id: ID, custom: true, pins: 4, errors: [], warnings: [] })
    const text = await cli(['module', 'check', 'part.json'], { cwd: dir })
    expect(text.out).toMatch(/^OK: custom-test-humidity-sensor-i2c \(Test humidity sensor \(I2C\)\), 4 pins, \d+ x \d+ px, custom \(unverified\)\n$/)
  })

  it('fails duplicate pins and an invalid module with exit 1, and a file that is not JSON with exit 2', async () => {
    const dir = tempDir()
    const dup = { format: 'circuitoon-module/1', id: 'custom-dup', custom: true, name: 'Dup', pins: [{ name: 'A', side: 'left' }, { name: 'A', side: 'right' }] }
    writeFileSync(join(dir, 'dup.json'), JSON.stringify(dup))
    const r = await cli(['module', 'check', 'dup.json', '--json'], { cwd: dir })
    expect(r.code).toBe(EXIT.blocked)
    const out = json(r.out)
    expect(schemaErrors(loadSchema('module-check'), out)).toEqual([])
    expect(out).toMatchObject({ ok: false, pins: 0, size: null, errors: [{ code: 'duplicate-pin', pin: 'A' }] })
    const text = await cli(['module', 'check', 'dup.json'], { cwd: dir })
    expect(text.out).toContain('PROBLEMS: custom-dup (Dup): 1 error\nerror [duplicate-pin]')
    writeFileSync(join(dir, 'x.json'), '{')
    expect((await cli(['module', 'check', 'x.json'], { cwd: dir })).code).toBe(EXIT.input)
  })

  it('checks a built-in part too, and says it is not marked custom', async () => {
    const r = await cli(['module', 'check', 'modules/resistor.json', '--json'])
    expect(r.code).toBe(0)
    expect(json(r.out).warnings.map((w: { code: string }) => w.code)).toContain('not-custom')
  })
})

describe('circuitoon module render', () => {
  it('draws the part alone as SVG, to the render schema', async () => {
    const dir = withSpec()
    await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: dir })
    const r = await cli(['module', 'render', 'part.json', '--svg', 'part.svg', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('render'), json(r.out))).toEqual([])
    const svg = readFileSync(join(dir, 'part.svg'), 'utf8')
    expect(svg).toContain('Test humidity sensor')
    for (const pin of ['VCC', 'GND', 'SCL', 'SDA']) expect(svg).toContain(`>${pin}<`)
  })

  it.skipIf(!browser)('draws a PNG', async () => {
    const dir = withSpec()
    await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: dir })
    const r = await cli(['module', 'render', 'part.json', '-o', 'part.png', '--dark'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(readFileSync(join(dir, 'part.png')).subarray(1, 4).toString()).toBe('PNG')
  }, 60_000)

  it('refuses an invalid module and a missing output', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ format: 'circuitoon-module/1', id: 'x', name: 'x', pins: [] }))
    expect((await cli(['module', 'render', 'bad.json', '--svg', 'b.svg'], { cwd: dir })).code).toBe(EXIT.input)
    expect((await cli(['module', 'render', 'bad.json'], { cwd: dir })).code).toBe(EXIT.input)
  })
})

describe('a custom part, round trip', () => {
  const fakePng = (_svg: unknown, _scale: number, out: string) => {
    writeFileSync(out, 'png')
    return { ok: true as const, width: 1, height: 1 }
  }

  it('goes from spec to module, into a netlist, laid out, gated and opened as the editor opens it', async () => {
    const dir = withSpec()
    expect((await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: dir })).code).toBe(0)
    const part = json(readFileSync(join(dir, 'part.json'), 'utf8'))
    const netlist = {
      format: 'circuitoon-netlist/1',
      title: 'ESP32 with a custom sensor',
      modules: { [part.id]: part },
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: part.id }],
      nets: [
        { name: '3V3', pins: ['U1.3V3', 'U2.VCC'] },
        { name: 'GND', pins: ['U1.GND', 'U2.GND'] },
        { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
        { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
      ],
      wires: { color: { '3V3': 'red', GND: 'black', SCL: 'yellow', SDA: 'blue' } },
    }
    writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
    const lay = await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })
    expect(lay.code, lay.err + lay.out).toBe(0)
    expect(lay.out).toContain(`Custom parts (unverified): ${part.id}`)

    const bytes = readFileSync(join(dir, 'sheet.json'))
    const v = validateDiagram(JSON.parse(bytes.toString()))
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.diagram.modules[part.id]).toEqual(part)
    expect(checkDiagram(v.diagram).filter((f) => f.severity === 'error')).toEqual([])

    const quiet: Io = { stdout: () => {}, stderr: () => {}, cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'none.exe') } }
    const { code, report } = await runGate(bytes, { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quiet, png: fakePng })
    expect(code, JSON.stringify(report.blocking)).toBe(EXIT.ok)
    const note = report.notes.find((n) => n.rule === 'custom-part')
    expect(note?.message).toBe(`U2: Test humidity sensor (I2C) [${part.id}] is a custom part, user-made and unverified. Its pins and pin types are as its maker gave them, and the checks rely on them; confirm them against the maker's datasheet before wiring.`)
    expect(report.notChecked.join(' ')).toContain('made in the part maker')
    expect(report.bom?.parts.find((p) => p.module === part.id)?.custom).toBe(true)

    // The link opens the sheet the way the editor opens one, custom part included.
    const url = report.link.url!
    const opened = await openLinkPayload(payloadFromHash(new URL(url).hash)!)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.diagram.modules[part.id]).toEqual(part)

    const ex = await cli(['explain', 'sheet.json', '--json'], { cwd: dir })
    expect(ex.code).toBe(0)
    const explained = json(ex.out)
    expect(schemaErrors(loadSchema('explain'), explained)).toEqual([])
    expect(explained.notes[0]).toContain('is a custom part, user-made and unverified')
    const exNet = json((await cli(['explain', 'n.json', '--json'], { cwd: dir })).out)
    expect(exNet.notes[0]).toContain(`U2: Test humidity sensor (I2C) [${part.id}]`)
  }, 60_000)
})

describe('the part spec schema', () => {
  const schema = loadSchema('part-spec')
  it('accepts the specs module new accepts', () => {
    expect(schemaErrors(schema, SPEC)).toEqual([])
    expect(schemaErrors(schema, { name: 'Gaps', style: 'chip', body: { w: 8, h: 4, color: '#1E4F8A' }, pins: { top: ['A', null, { spacer: true }, { name: 'B', label: 'b', caps: { inputOnly: true } }] }, internal: [['A', 'B']] })).toEqual([])
  })
  it('names the same fields as the spec validator', () => {
    expect(Object.keys(schema.properties!).sort()).toEqual(['body', 'category', 'format', 'id', 'internal', 'name', 'pins', 'source', 'style', 'version'])
    expect(schemaErrors(schema, { ...SPEC, colour: 'red' })).toEqual(['$.colour: not allowed'])
    expect(schemaErrors(schema, { name: 'X', pins: { left: [{ name: 'A', kind: 'io' }] } })).toEqual(['$.pins.left[0].kind: not allowed'])
  })
})
