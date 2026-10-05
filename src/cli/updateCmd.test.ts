// `circuitoon update` (Ruling D1): takes the library copy of each stored built-in part whose drift
// is only added or descriptive data, leaves blocking drift alone and lists it, and prints what
// changed per part; --json matches its schema.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { USAGE } from './main.ts'

const fixture = () => readFileSync(new URL('../format/fixtures/battery-bank-1s4p.circuitoon.json', import.meta.url), 'utf8')
const lib = (id: string) => JSON.parse(readFileSync(join('modules', `${id}.json`), 'utf8'))
const findings = async (dir: string, file: string) => JSON.parse((await cli(['check', file, '--json'], { cwd: dir })).out).findings as { rule: string; severity: string }[]

describe('circuitoon update', () => {
  it("brings Michael's battery-bank sheet up to date in place, saying what changed per part", async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), fixture())
    expect((await findings(dir, 'sheet.json')).filter((f) => f.rule === 'module-drift').map((f) => f.severity)).toEqual(Array(8).fill('warning'))
    const r = await cli(['update', 'sheet.json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^Updated U\d+ \(esp32-devkit-v1-30\): USB port USB, pins VP\/VN\/D34\/D35\/D12\/D5\/D2\/D15 \(pin data\), electrical sim\.$/m)
    expect(r.out).toMatch(/^Updated U\d+ \(ip5306-usbc-module\): USB port USB-C\.$/m)
    expect(r.out).toMatch(/^Updated \S+ \(oled-ssd1306-096-i2c\): .*footprint.*I2C data, electrical sim\.$/m)
    expect(r.out).toContain('Updated oled-ssd1306-096-i2c-vcc-gnd (no parts on the sheet): ')
    expect(r.out).toContain('Wrote sheet.json.')
    const after = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    expect(after.modules['esp32-devkit-v1-30']).toEqual(lib('esp32-devkit-v1-30'))
    // Only the modules change: parts and wires are as they were.
    const before = JSON.parse(fixture())
    expect(after.parts).toEqual(before.parts)
    expect(after.connections).toEqual(before.connections)
    expect((await findings(dir, 'sheet.json')).filter((f) => f.rule === 'module-drift')).toEqual([])
    // Again: nothing left to do.
    const again = await cli(['update', 'sheet.json'], { cwd: dir })
    expect(again.out).toBe('Every part is up to date with the library.\n')
  })
  it('writes to -o and leaves the input alone; --json matches the schema', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sheet.json'), fixture())
    const r = await cli(['update', 'sheet.json', '-o', 'new.json', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    const doc = JSON.parse(r.out)
    expect(schemaErrors(loadSchema('update'), doc)).toEqual([])
    expect(doc).toMatchObject({ format: 'circuitoon-cli/update/1', ok: true, sheet: 'sheet.json', output: 'new.json', blocked: [] })
    expect(doc.updated.map((x: { id: string }) => x.id)).toEqual(['battery-18650-holder', 'esp32-devkit-v1-30', 'ip5306-usbc-module', 'lcd-st7796s-4in-spi-touch', 'oled-ssd1306-096-i2c', 'oled-ssd1306-096-i2c-vcc-gnd', 'resistor', 'rocker-switch-kcd1'])
    expect(readFileSync(join(dir, 'sheet.json'), 'utf8')).toBe(fixture())
    expect(JSON.parse(readFileSync(join(dir, 'new.json'), 'utf8')).modules['oled-ssd1306-096-i2c']).toEqual(lib('oled-ssd1306-096-i2c'))
  })
  it('leaves a copy whose pins changed alone, lists it and exits 1', async () => {
    const dir = tempDir()
    const sheet = JSON.parse(fixture())
    const esp = sheet.modules['esp32-devkit-v1-30']
    const [a, b] = [esp.pins.find((p: { name?: string }) => p.name === 'D21'), esp.pins.find((p: { name?: string }) => p.name === 'D22')]
    ;[a.name, b.name] = ['D22', 'D21']
    writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sheet))
    const r = await cli(['update', 'sheet.json', '--json'], { cwd: dir })
    expect(r.code).toBe(1)
    const doc = JSON.parse(r.out)
    expect(doc.ok).toBe(false)
    expect(doc.blocked.map((x: { id: string }) => x.id)).toEqual(['esp32-devkit-v1-30'])
    expect(doc.updated.map((x: { id: string }) => x.id)).toEqual(['battery-18650-holder', 'ip5306-usbc-module', 'lcd-st7796s-4in-spi-touch', 'oled-ssd1306-096-i2c', 'oled-ssd1306-096-i2c-vcc-gnd', 'resistor', 'rocker-switch-kcd1'])
    expect(JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8')).modules['esp32-devkit-v1-30']).toEqual(esp)
    const text = await cli(['update', 'sheet.json'], { cwd: dir })
    expect(text.out).toMatch(/^Left U\d+ \(esp32-devkit-v1-30\): pins D22\/D21 changed in the library, so it must be placed again\.$/m)
  })
  it('exits 2 on a missing or invalid sheet, and is in the usage', async () => {
    const dir = tempDir()
    expect((await cli(['update'], { cwd: dir })).code).toBe(2)
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ format: 'nope' }))
    expect((await cli(['update', 'x.json'], { cwd: dir })).code).toBe(2)
    expect(USAGE).toContain('update <sheet.json> [-o <out.json>] [--json]')
  })
})
