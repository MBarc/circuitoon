// circuitoon module new|check|render: a custom part from a spec (file or standard input), the lint as
// a report and an exit code, a render of the part alone, and the round trip a custom part has to
// survive: spec to module, embedded in a netlist, laid out, gated, and opened like the editor opens it.
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { findBrowser } from './png.ts'
import { EXIT, type Io } from './io.ts'
import { gateEngine, runGate } from './gate.ts'
import { USAGE } from './main.ts'
import { validateDiagram } from '../format/diagram.ts'
import { openLinkPayload, payloadFromHash } from '../format/link.ts'
import { checkDiagram } from '../format/checks.ts'

// Gate tests that do not test simulation never start the engine (Task 31's stub seam).
beforeEach(() => {
  gateEngine.make = () => null
})

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
const PHOTO = 'https://example.com/humidity.jpg'
const GENERIC_TODO = "find the maker's product photo, draw its art per the art guide (references/art.md in the circuitoon-custom-part skill), record the photo URL in `photo`, rebuild the part with `module new`, embed it and lay out again."
const PHOTO_TODO = 'record the product photo URL you drew it from in `photo`, or "none: <why>" if no photo of this part exists anywhere.'
/** SPEC drawn with art of its own (one extra chip on the generated board) and a photo, so it looks real to the gate. */
const realSpec = async (extra: object = {}) => {
  const plain = json((await cli(['module', 'new', '--spec', 'spec.json'], { cwd: withSpec() })).out)
  return { ...SPEC, photo: PHOTO, art: { ...plain.art, shapes: [...plain.art.shapes, { type: 'rect', x: 30, y: 20, w: 12, h: 12, fill: '#1B1F24', radius: 2 }] }, ...extra }
}

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

  it('carries a description and typical uses onto the part', async () => {
    const spec = { ...SPEC, description: 'Measures humidity on the bench.', uses: ['greenhouse monitor', 'weather station'] }
    expect(schemaErrors(loadSchema('part-spec'), spec)).toEqual([])
    const r = await cli(['module', 'new'], { cwd: tempDir(), stdin: JSON.stringify(spec) })
    expect(r.code).toBe(0)
    expect(json(r.out)).toMatchObject({ description: spec.description, uses: spec.uses })
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
    expect(out.warnings.map((w: { code: string }) => w.code)).toEqual(['power-untyped', 'power-untyped', 'power-untyped', 'no-types', 'no-source', 'custom-part-look'])
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
    expect(USAGE).toContain('module render <part.json|built-in id> -o <part.png>')
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
    expect(out).toMatchObject({ ok: true, id: ID, custom: true, pins: 4, errors: [], warnings: [{ code: 'custom-part-look' }] })
    expect(out.warnings[0].message).toBe(`Test humidity sensor (I2C) is drawn as the generic box and has no \`photo\`: ${GENERIC_TODO}`)
    const text = await cli(['module', 'check', 'part.json'], { cwd: dir })
    expect(text.out).toMatch(/^OK: custom-test-humidity-sensor-i2c \(Test humidity sensor \(I2C\)\), 4 pins, \d+ x \d+ px, custom \(unverified\)\nwarning \[custom-part-look\] Test humidity sensor \(I2C\) is drawn as the generic box .*\n$/)
  })

  it('warns, never fails, on a part with its own art but no photo, and on "photo": "none: <why>"', async () => {
    const own = await realSpec()
    delete (own as { photo?: string }).photo
    const r = await cli(['module', 'new', '--spec', 'spec.json', '--json'], { cwd: withSpec(own) })
    expect(r.code).toBe(0)
    expect(json(r.out).warnings).toEqual([{ code: 'custom-part-look', message: `Test humidity sensor (I2C) has no \`photo\`: ${PHOTO_TODO}` }])
    const none = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json'], { cwd: withSpec({ ...own, photo: 'none: a sensor made for this test only' }) })
    expect(none.code).toBe(0)
    expect(none.out).toContain('warning [custom-part-no-photo] Test humidity sensor (I2C) has no photo ("a sensor made for this test only")')
  })

  it('says nothing about the look of a part with its own art and a photo', async () => {
    const spec = await realSpec()
    const dir = withSpec(spec)
    const r = await cli(['module', 'new', '--spec', 'spec.json', '-o', 'part.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(json(r.out).notes).toEqual([])
    expect(json(r.out).warnings).toEqual([])
    expect(json(r.out).module.photo).toBe(PHOTO)
    expect(json(r.out).module.art.shapes).toEqual(spec.art.shapes)
    const c = json((await cli(['module', 'check', 'part.json', '--json'], { cwd: dir })).out)
    expect(schemaErrors(loadSchema('module-check'), c)).toEqual([])
    expect(c.warnings).toEqual([])
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

  it('draws a built-in part by its id, so its art can be studied', async () => {
    const dir = tempDir()
    const r = await cli(['module', 'render', 'ip5306-usbc-module', '--svg', 'p.svg', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(readFileSync(join(dir, 'p.svg'), 'utf8')).toContain('<svg')
    const none = await cli(['module', 'render', 'no-such-part', '--svg', 'p.svg'], { cwd: dir })
    expect(none.code).toBe(EXIT.input)
    expect(none.err).toContain('no-such-part: not a part file or a built-in part id')
  })

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
    const dir = withSpec(await realSpec())
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

describe('the gate on how custom parts look', () => {
  const fakePng = (_svg: unknown, _scale: number, out: string) => {
    writeFileSync(out, 'png')
    return { ok: true as const, width: 1, height: 1 }
  }
  /** A sheet with an ESP32 and two custom sensors (U2 from `a`, U3 from `b`), laid out and gated. */
  const sheetWith = async (a: object, b: object) => {
    const dir = tempDir()
    const make = async (spec: object) => json((await cli(['module', 'new'], { cwd: dir, stdin: JSON.stringify(spec) })).out)
    const ma = await make(a)
    const mb = await make(b)
    const netlist = {
      format: 'circuitoon-netlist/1',
      title: 'Two custom sensors',
      modules: { [ma.id]: ma, [mb.id]: mb },
      parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }, { ref: 'U2', module: ma.id }, { ref: 'U3', module: mb.id }],
      nets: [
        { name: '3V3', pins: ['U1.3V3', 'U2.VCC'] },
        { name: 'GND', pins: ['U1.GND', 'U1.GND 2', 'U2.GND', 'U3.GND'] },
        { name: 'SCL', pins: ['U1.IO22', 'U2.SCL'] },
        { name: 'SDA', pins: ['U1.IO21', 'U2.SDA'] },
        { name: '5V', pins: ['U1.5V', 'U3.VCC'] },
        { name: 'SCL B', pins: ['U1.IO19', 'U3.SCL'] },
        { name: 'SDA B', pins: ['U1.IO18', 'U3.SDA'] },
      ],
    }
    writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
    const lay = await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })
    expect(lay.code, lay.err + lay.out).toBe(0)
    const quiet: Io = { stdout: () => {}, stderr: () => {}, cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'none.exe') } }
    const gate = await runGate(readFileSync(join(dir, 'sheet.json')), { sheetPath: 'sheet.json', outDir: join(dir, 'out'), io: quiet, png: fakePng })
    return { dir, ma, mb, ...gate }
  }

  it('blocks on a custom part drawn as the generic box, naming the part and what to do', async () => {
    const { dir, ma, mb, code, report } = await sheetWith(await realSpec({ name: 'Real sensor' }), { ...SPEC, name: 'Boxy sensor', photo: PHOTO })
    expect(code).toBe(EXIT.blocked)
    expect(report.blocking.map((f) => f.rule)).toEqual(['custom-part-look'])
    expect(report.blocking[0]).toMatchObject({ id: `custom-part-look|${mb.id}`, severity: 'error', message: `U3: Boxy sensor [${mb.id}] is drawn as the generic box: ${GENERIC_TODO}` })
    expect(report.blocking[0].parts).toHaveLength(1)
    expect([...report.blocking, ...report.warnings].some((f) => f.message.includes(ma.id))).toBe(false)
    expect(schemaErrors(loadSchema('gate'), report)).toEqual([])
    const check = await cli(['check', 'sheet.json', '--json'], { cwd: dir })
    expect(check.code).toBe(EXIT.blocked)
    expect(json(check.out).findings.filter((f: { rule: string }) => f.rule.startsWith('custom-part')).map((f: { rule: string }) => f.rule)).toEqual(['custom-part-look'])
    const ex = json((await cli(['explain', 'sheet.json', '--json'], { cwd: dir })).out)
    expect(ex.notes.join('\n')).toContain(`U3: Boxy sensor [${mb.id}] is drawn as the generic box`)
    const exNet = json((await cli(['explain', 'n.json', '--json'], { cwd: dir })).out)
    expect(exNet.notes.join('\n')).toContain(`U3: Boxy sensor [${mb.id}] is drawn as the generic box`)
  }, 60_000)

  it('blocks the same on an embedded part not marked custom: every part outside the library counts', async () => {
    const { dir, mb } = await sheetWith(await realSpec({ name: 'Real sensor' }), { ...SPEC, name: 'Boxy sensor', photo: PHOTO })
    const sheet = json(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    for (const m of Object.values(sheet.modules) as { custom?: true }[]) delete m.custom
    writeFileSync(join(dir, 'plain.json'), JSON.stringify(sheet))
    const check = await cli(['check', 'plain.json', '--json'], { cwd: dir })
    expect(check.code).toBe(EXIT.blocked)
    expect(json(check.out).findings.filter((f: { rule: string }) => f.rule === 'custom-part-look').map((f: { message: string }) => f.message)).toEqual([`U3: Boxy sensor [${mb.id}] is drawn as the generic box: ${GENERIC_TODO}`])
    const quiet: Io = { stdout: () => {}, stderr: () => {}, cwd: dir, env: { CIRCUITOON_BROWSER: join(dir, 'none.exe') } }
    const gate = await runGate(readFileSync(join(dir, 'plain.json')), { sheetPath: 'plain.json', outDir: join(dir, 'out2'), io: quiet, png: fakePng })
    expect(gate.code).toBe(EXIT.blocked)
    expect(gate.report.blocking.map((f) => f.rule)).toEqual(['custom-part-look'])
    // module check looks at a hand-made module too, and never at a built-in one.
    writeFileSync(join(dir, 'plain-part.json'), JSON.stringify(sheet.modules[mb.id]))
    expect(json((await cli(['module', 'check', 'plain-part.json', '--json'], { cwd: dir })).out).warnings.map((w: { code: string }) => w.code)).toContain('custom-part-look')
    expect(json((await cli(['module', 'check', 'modules/resistor.json', '--json'])).out).warnings.map((w: { code: string }) => w.code)).not.toContain('custom-part-look')
  }, 60_000)

  it('blocks on a custom part with no photo, and warns on "photo": "none: <why>" with art of its own', async () => {
    const noPhoto = await sheetWith(await realSpec({ name: 'Real sensor' }), { ...(await realSpec({ name: 'Unsourced sensor' })), photo: undefined })
    expect(noPhoto.code).toBe(EXIT.blocked)
    expect(noPhoto.report.blocking.map((f) => f.message)).toEqual([expect.stringMatching(/^U3: Unsourced sensor \[custom-unsourced-sensor\] has no `photo`: record /)])
    const { code, report } = await sheetWith(await realSpec({ name: 'Real sensor' }), await realSpec({ name: 'No photo sensor', photo: 'none: a sensor made for this test only' }))
    expect(code, JSON.stringify(report.blocking)).toBe(EXIT.ok)
    expect(report.warnings.filter((f) => f.rule.startsWith('custom-part')).map((f) => [f.rule, f.message])).toEqual([
      ['custom-part-no-photo', expect.stringMatching(/^U3: No photo sensor \[custom-no-photo-sensor\] has no photo \("a sensor made for this test only"\)/)],
    ])
  }, 60_000)
})

describe('the part spec schema', () => {
  const schema = loadSchema('part-spec')
  it('accepts the specs module new accepts', () => {
    expect(schemaErrors(schema, SPEC)).toEqual([])
    expect(schemaErrors(schema, { name: 'Gaps', style: 'chip', body: { w: 8, h: 4, color: '#1E4F8A' }, pins: { top: ['A', null, { spacer: true }, { name: 'B', label: 'b', caps: { inputOnly: true } }] }, internal: [['A', 'B']] })).toEqual([])
  })
  it('names the same fields as the spec validator', () => {
    expect(Object.keys(schema.properties!).sort()).toEqual(['art', 'body', 'category', 'description', 'format', 'id', 'internal', 'name', 'photo', 'pins', 'source', 'style', 'uses', 'version'])
    expect(schemaErrors(schema, { ...SPEC, colour: 'red' })).toEqual(['$.colour: not allowed'])
    expect(schemaErrors(schema, { name: 'X', pins: { left: [{ name: 'A', kind: 'io' }] } })).toEqual(['$.pins.left[0].kind: not allowed'])
    expect(Object.keys((schema.properties!.art as { properties: object }).properties).sort()).toEqual(['h', 'pinLabels', 'shapes', 'w'])
  })
})
