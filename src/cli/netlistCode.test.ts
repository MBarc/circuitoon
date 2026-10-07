// Firmware spec 7: a netlist part may carry `code: { language, path }`; layout reads the file and
// embeds it (the path relative, inside the netlist's folder, no "..", not out through a symlink);
// `netlist -o` writes each board's code next to it as <designator>.<ext> and references it; without
// -o the code is inline (ruling R18). Round trips through netlist, layout and extract keep the code.
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { parseNetlist } from '../agent/netlist.ts'
import { libraryLookup } from '../agent/catalog.ts'

const BLINK = 'from gpiozero import LED\nLED(17).blink()\n'
const net = (code: unknown) => ({
  format: 'circuitoon-netlist/1', title: 'Pi blink',
  parts: [{ ref: 'U1', module: 'rpi-4-model-b', code }, { ref: 'R1', module: 'resistor', values: { resistance: { value: 330, unit: 'ohm' } } }, { ref: 'D1', module: 'led' }],
  nets: [{ name: 'LED_A', pins: ['U1.GPIO17', 'R1.1'] }, { name: 'LED_K', pins: ['R1.2', 'D1.A'] }, { name: 'GND', pins: ['D1.K', 'U1.GND'] }],
})

describe('code in netlists (spec 7)', () => {
  it('parses code with a path or inline source, and refuses a bad one', () => {
    expect(parseNetlist(net({ language: 'python-rpi', path: 'blink.py' }), libraryLookup)).toMatchObject({ ok: true, intent: { parts: expect.arrayContaining([expect.objectContaining({ ref: 'U1', code: { language: 'python-rpi', path: 'blink.py' } })]) } })
    expect(parseNetlist(net({ language: 'python-rpi', source: BLINK, file: 'blink.py' }), libraryLookup).ok).toBe(true)
    const errs = (code: unknown) => { const r = parseNetlist(net(code), libraryLookup); return r.ok ? [] : r.errors }
    expect(errs({ language: 'python-rpi', path: '../x.py' })).toContain('parts[0].code.path: must be a relative path inside the netlist\'s folder, with no ".."')
    expect(errs({ language: 'python-rpi', path: '/etc/x.py' })[0]).toMatch(/^parts\[0\]\.code\.path: must be a relative path/)
    expect(errs({ language: 'cobol', path: 'x.py' })).toContain('parts[0].code.language: unknown language "cobol" (python-rpi, arduino-avr, micropython)')
    expect(errs('x')).toContain('parts[0].code: must be { "language", "path" } or { "language", "source", "file" }')
  })
  it('layout embeds the file, and netlist -o writes it back out as U1.py', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'blink.py'), BLINK)
    writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', path: 'src/blink.py' })))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    expect(sheet.parts.find((p: { uid: string }) => p.uid === 'U1').code).toEqual({ language: 'python-rpi', source: BLINK, file: 'blink.py' })
    expect((await cli(['netlist', 'sheet.json', '-o', 'out/again.json'], { cwd: dir })).code).toBe(0)
    const again = JSON.parse(readFileSync(join(dir, 'out', 'again.json'), 'utf8'))
    expect(again.parts.find((p: { ref: string }) => p.ref === 'U1').code).toEqual({ language: 'python-rpi', path: 'U1.py' })
    expect(readFileSync(join(dir, 'out', 'U1.py'), 'utf8')).toBe(BLINK)
    expect((await cli(['layout', 'out/again.json', '-o', 'sheet2.json'], { cwd: dir })).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'sheet2.json'), 'utf8')).parts.find((p: { uid: string }) => p.uid === 'U1').code.source).toBe(BLINK)
  })
  it('netlist without -o inlines the code (ruling R18)', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', source: BLINK, file: 'blink.py' })))
    expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
    const r = await cli(['netlist', 'sheet.json'], { cwd: dir })
    expect(JSON.parse(r.out).parts.find((p: { ref: string }) => p.ref === 'U1').code).toEqual({ language: 'python-rpi', source: BLINK, file: 'blink.py' })
  })
  it('refuses a path out of the folder through a symlink, and a missing file, with exit 2', async () => {
    const outside = tempDir()
    writeFileSync(join(outside, 'secret.py'), 'print(1)\n')
    const dir = tempDir()
    let linked = true
    try {
      symlinkSync(join(outside, 'secret.py'), join(dir, 'link.py'))
    } catch {
      linked = false // Windows without the symlink privilege: the rule is still checked by the missing-file case
    }
    if (linked) {
      writeFileSync(join(dir, 'n.json'), JSON.stringify(net({ language: 'python-rpi', path: 'link.py' })))
      const r = await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })
      expect([r.code, r.err]).toEqual([2, "n.json: U1's code link.py leads outside the netlist's folder\n"])
    }
    writeFileSync(join(dir, 'm.json'), JSON.stringify(net({ language: 'python-rpi', path: 'nope.py' })))
    const m = await cli(['layout', 'm.json', '-o', 'sheet.json'], { cwd: dir })
    expect([m.code, m.err]).toEqual([2, "m.json: U1's code nope.py cannot be read\n"])
  })
  it('refuses bad paths, oversize and non-UTF-8 files through layout, and a junction out of the folder', async () => {
    const dir = tempDir()
    const outside = tempDir()
    writeFileSync(join(outside, 'secret.py'), 'print(1)\n')
    writeFileSync(join(dir, 'big.py'), 'x'.repeat(256 * 1024 + 1))
    writeFileSync(join(dir, 'bin.py'), Buffer.from([0xff, 0xfe, 0x00]))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'blink.py'), BLINK)
    symlinkSync(outside, join(dir, 'jct'), 'junction')
    const run = async (path: string) => {
      writeFileSync(join(dir, 'p.json'), JSON.stringify(net({ language: 'python-rpi', path })))
      const r = await cli(['layout', 'p.json', '-o', 'sheet.json'], { cwd: dir })
      return [r.code, r.err]
    }
    const away = (p: string) => [2, `p.json: U1's code ${p} leads outside the netlist's folder\n`]
    for (const p of ['sub/../blink.py', 'sub\\..\\blink.py', 'D:\\secret.py', 'C:secret.py', '\\\\host\\share\\x.py', '/etc/x.py', '\\x.py', 'jct/secret.py']) expect(await run(p), p).toEqual(away(p))
    expect(await run('sub')).toEqual([2, "p.json: U1's code sub cannot be read\n"])
    expect(await run('big.py')).toEqual([2, "p.json: U1's code big.py is over 256 KB\n"])
    expect(await run('bin.py')).toEqual([2, "p.json: U1's code bin.py is not UTF-8 text\n"])
    expect((await run('blink.py'))[0]).toBe(0)
  })
})
