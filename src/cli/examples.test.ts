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
  for (const c of cases) {
    it(`${c.name}: nothing blocks`, async () => {
      const dir = await laidOut(c.from, c.file, c.keep)
      const r = await cli(['gate', 'sheet.json', '-o', 'out', '--json'], { cwd: dir, env: noBrowser(dir) })
      const g = JSON.parse(r.out)
      expect(g.blocking, JSON.stringify(g.blocking, null, 2)).toEqual([])
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
