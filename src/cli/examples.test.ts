// Every worked example shipped with the circuitoon-design skill (spec 8 and 10) lays out, has nothing
// blocking, passes the gate where a browser exists, and yields a link. The Spirit Typewriter example
// (amendment A20) is four sheets, each laid out from its partial with `layout --keep`; each partial's
// intent is exactly its netlist, so the two files cannot drift.
import { describe, expect, it } from 'vitest'
import { copyFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { libraryLookup } from '../agent/catalog.ts'
import { cli, tempDir } from './cliHarness.testing.ts'
import { findBrowser } from './png.ts'

const DIR = join(import.meta.dirname, '..', '..', 'plugin', 'skills', 'circuitoon-design', 'references', 'examples')
const TW = join(DIR, 'spirit-typewriter')
const netlists = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.netlist.json')).sort()
const files = netlists(DIR)
const sheets = netlists(TW).map((f) => f.replace('.netlist.json', ''))
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const browser = findBrowser(process.env)
const noBrowser = (dir: string) => ({ CIRCUITOON_BROWSER: join(dir, 'none.exe') })

// Copies the input into a fresh folder and lays it out there, from the netlist or (--keep) the partial.
const laidOut = async (from: string, file: string, keep: boolean) => {
  const dir = tempDir()
  copyFileSync(join(from, file), join(dir, file))
  const r = await cli(keep ? ['layout', '--keep', file, '-o', 'sheet.json'] : ['layout', file, '-o', 'sheet.json'], { cwd: dir })
  expect(r.code, r.err + r.out).toBe(0)
  return dir
}
const cases = [
  ...files.map((f) => ({ name: f, from: DIR, file: f, keep: false })),
  ...sheets.map((s) => ({ name: `spirit-typewriter/${s}`, from: TW, file: `${s}.partial.json`, keep: true })),
]

describe('worked examples', () => {
  it('ships the four the spec names, built from built-in modules only', () => {
    expect(files).toEqual(['battery-switch.netlist.json', 'esp32-bme280.netlist.json', 'led-breadboard.netlist.json', 'tilt-sensors-8.netlist.json'])
    for (const f of files) {
      const n = read(join(DIR, f))
      expect(n.modules, f).toBeUndefined()
      for (const p of n.parts) expect(libraryLookup(p.module), `${f} ${p.module}`).toBeDefined()
    }
    expect(read(join(DIR, 'tilt-sensors-8.netlist.json')).repeat.count).toBe(8)
  })
  it('ships the Spirit Typewriter as a main sheet and three bank sheets of 14 balls, each partial holding its netlist', () => {
    expect(sheets).toEqual(['1-main', '2-bank-a', '3-bank-b', '4-bank-c'])
    let balls = 0
    for (const s of sheets) {
      const n = read(join(TW, `${s}.netlist.json`))
      const partial = read(join(TW, `${s}.partial.json`))
      expect(partial.format).toBe('circuitoon-partial/1')
      expect(partial.intent, s).toEqual(n)
      expect(n.modules, s).toBeUndefined()
      for (const p of [...n.parts, ...(n.repeat?.template.parts ?? [])]) expect(libraryLookup(p.module), `${s} ${p.module}`).toBeDefined()
      // Every kept position names a part of the netlist: nothing kept is silently ignored.
      for (const p of partial.parts) expect(n.parts.map((q: { ref: string }) => q.ref), `${s} ${p.designator}`).toContain(p.designator)
      if (n.repeat) {
        balls += n.repeat.count
        // GPA7 and GPB7 are output only on the MCP23017: no ball is bound to them.
        for (const b of n.repeat.bindings) expect(b.CH, s).not.toMatch(/\.GP[AB]7$/)
        expect(n.parts.find((p: { module: string }) => p.module === 'mcp23017-cjmcu-2317'), s).toBeDefined()
      }
    }
    expect(balls).toBe(42)
  })
  it('gives each bank its own I2C address, ties RESET high, and wires every connector in the same pin order', () => {
    type Net = { name: string; pins: string[] }
    const netOf = (nets: Net[], pin: string) => nets.find((n) => n.pins.includes(pin))?.name
    const order = (nets: Net[], ref: string) => [1, 2, 3, 4].map((i) => netOf(nets, `${ref}.${i}`))
    const main: Net[] = read(join(TW, '1-main.netlist.json')).nets
    const addresses = new Set<number>()
    for (const s of sheets.slice(1)) {
      const n = read(join(TW, `${s}.netlist.json`))
      const u = n.parts.find((p: { module: string }) => p.module === 'mcp23017-cjmcu-2317').ref
      expect(netOf(n.nets, `${u}.RESET`), `${s} RESET`).toBe('3V3')
      // A0 to A2 strapped: each to 3V3 (1) or GND (0), never floating.
      let address = 0x20
      for (const [bit, pin] of ['A0', 'A1', 'A2'].entries()) {
        const net = netOf(n.nets, `${u}.${pin}`)
        expect(['3V3', 'GND'], `${s} ${pin}`).toContain(net)
        if (net === '3V3') address |= 1 << bit
      }
      addresses.add(address)
      expect(order(n.nets, 'J1'), s).toEqual(['GND', '3V3', 'SDA', 'SCL'])
    }
    expect([...addresses].sort()).toEqual([0x20, 0x21, 0x22])
    for (const j of ['J1', 'J2', 'J3']) expect(order(main, j), `1-main ${j}`).toEqual(['GND', '3V3', 'SDA', 'SCL'])
  })
  for (const c of cases) {
    it(`${c.name}: nothing blocks`, async () => {
      const dir = await laidOut(c.from, c.file, c.keep)
      const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir, env: noBrowser(dir) })
      const g = JSON.parse(r.out)
      expect(g.blocking, JSON.stringify(g.blocking, null, 2)).toEqual([])
      // The layout colours wires by role, so no example breaks the colour convention.
      expect(g.warnings.filter((w: { rule: string }) => w.rule.startsWith('wire-color'))).toEqual([])
      expect(r.code).toBe(3)
    }, 60_000)
    it.skipIf(!browser)(`${c.name}: passes the gate with renders and a link`, async () => {
      const dir = await laidOut(c.from, c.file, c.keep)
      const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir })
      expect(r.code, r.out).toBe(0)
      expect(JSON.parse(r.out).link.url).toMatch(/^https:\/\/mbarc\.github\.io\/circuitoon\/#\/editor\?d=v1\./)
    }, 120_000)
  }
})
