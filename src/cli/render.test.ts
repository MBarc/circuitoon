// circuitoon render: standalone SVG, PNG at scale through an installed browser (not blank, not
// clipped: amendment A11), the missing-browser path (exit 3, guidance, --svg offered, a JSON error
// envelope under --json: A10) and --focus on a repeat copy or a group.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, tempDir } from './cliHarness.testing.ts'
import { loadSchema, schemaErrors } from './jsonSchema.testing.ts'
import { decodePng, greyDeviation, inkBox, pixelAt, type Pixels } from './pngDecode.testing.ts'
import { PNG_MAX_SIDE, browserCandidates, findBrowser, writePng } from './png.ts'
import { ledNetlist, tiltSensors } from '../agent/fixtures.testing.ts'
import { DARK_THEME, LIGHT_THEME } from '../render/theme.ts'

const browser = findBrowser(process.env)
const sheetFrom = async (netlist: unknown) => {
  const dir = tempDir()
  writeFileSync(join(dir, 'n.json'), JSON.stringify(netlist))
  expect((await cli(['layout', 'n.json', '-o', 'sheet.json'], { cwd: dir })).code).toBe(0)
  return dir
}
const svgSize = (svg: string) => {
  const m = /^<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg)!
  return { w: Number(m[1]), h: Number(m[2]) }
}
const near = (actual: string, want: string, tolerance = 6) => {
  const c = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
  const [a, b] = [c(actual), c(want)]
  return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) <= tolerance
}

/**
 * A11: a PNG that shows the drawing, whole. Not blank (the grey level varies), every corner is the
 * theme's paper (so the page behind the SVG never shows and the SVG fills the shot), and the drawing
 * stays clear of every edge (a clipped shot would cut it at the right or bottom).
 */
function expectWholeDrawing(p: Pixels, theme: { paper: string; grid: string }, scale: number) {
  expect(greyDeviation(p)).toBeGreaterThan(8)
  for (const [x, y] of [[0, 0], [p.width - 1, 0], [0, p.height - 1], [p.width - 1, p.height - 1]]) {
    const at = pixelAt(p, x, y)
    expect(near(at, theme.paper) || near(at, theme.grid), `corner ${x},${y} is ${at}`).toBe(true)
  }
  const ink = inkBox(p, [theme.paper, theme.grid])!
  expect(ink).not.toBeNull()
  const margins = { left: ink.x0, top: ink.y0, right: p.width - 1 - ink.x1, bottom: p.height - 1 - ink.y1 }
  for (const m of Object.values(margins)) expect(m, JSON.stringify(margins)).toBeGreaterThanOrEqual(5 * scale)
  // Most of the picture is drawing, not an empty sheet with a speck in one corner.
  expect((ink.x1 - ink.x0) * (ink.y1 - ink.y0)).toBeGreaterThan(0.25 * p.width * p.height)
}

describe('circuitoon render', () => {
  it('writes a standalone SVG and reports it as JSON matching the schema', async () => {
    const dir = await sheetFrom(ledNetlist())
    const r = await cli(['render', 'sheet.json', '--svg', 'sheet.svg', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('render'), JSON.parse(r.out))).toEqual([])
    const svg = readFileSync(join(dir, 'sheet.svg'), 'utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).not.toContain('var(--')
    expect(svg).toContain(LIGHT_THEME.paper)
    await cli(['render', 'sheet.json', '--svg', 'dark.svg', '--dark'], { cwd: dir })
    expect(readFileSync(join(dir, 'dark.svg'), 'utf8')).toContain(DARK_THEME.paper)
  })
  it('exits 3 with install guidance and --svg offered when no browser is found', async () => {
    const dir = await sheetFrom(ledNetlist())
    const env = { CIRCUITOON_BROWSER: join(dir, 'no-such-browser.exe') }
    const r = await cli(['render', 'sheet.json', '-o', 'sheet.png'], { cwd: dir, env })
    expect(r.code).toBe(3)
    expect(r.err).toContain('No Chrome or Edge found')
    expect(r.err).toContain('--svg')
    expect(existsSync(join(dir, 'sheet.png'))).toBe(false)
    const j = await cli(['render', 'sheet.json', '-o', 'sheet.png', '--json'], { cwd: dir, env })
    expect(j.code).toBe(3)
    const envelope = JSON.parse(j.out)
    expect(schemaErrors(loadSchema('error'), envelope)).toEqual([])
    expect(envelope).toMatchObject({ ok: false, exit: 3, error: { code: 'environment' } })
    expect(envelope.error.message).toContain('--svg')
  })
  it('refuses bad arguments with exit 2', async () => {
    const dir = await sheetFrom(ledNetlist())
    for (const argv of [['render'], ['render', 'sheet.json'], ['render', 'sheet.json', '--svg', 'x.svg', '--scale', '0'], ['render', 'sheet.json', '--svg', 'x.svg', '--scale', 'big'], ['render', 'sheet.json', '--svg', 'x.svg', '--scale', '9']]) {
      const r = await cli([...argv, '--json'], { cwd: dir })
      expect(r.code, argv.join(' ')).toBe(2)
      expect(schemaErrors(loadSchema('error'), JSON.parse(r.out))).toEqual([])
    }
    const missing = await cli(['render', 'nope.json', '--svg', 'x.svg'], { cwd: dir })
    expect(missing.code).toBe(2)
  })
  it.skipIf(!browser)('writes a PNG at the requested scale that shows the whole drawing', async () => {
    const dir = await sheetFrom(ledNetlist())
    const r = await cli(['render', 'sheet.json', '-o', 'sheet.png', '--svg', 'sheet.svg', '--scale', '2', '--json'], { cwd: dir })
    expect(r.code).toBe(0)
    expect(schemaErrors(loadSchema('render'), JSON.parse(r.out))).toEqual([])
    const png = readFileSync(join(dir, 'sheet.png'))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const { w, h } = svgSize(readFileSync(join(dir, 'sheet.svg'), 'utf8'))
    expect({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }).toEqual({ w: w * 2, h: h * 2 })
    expect(JSON.parse(r.out).outputs.find((o: { kind: string }) => o.kind === 'png')).toMatchObject({ width: w * 2, height: h * 2 })
    expectWholeDrawing(decodePng(png), LIGHT_THEME, 2)
  }, 120_000)
  it.skipIf(!browser)('draws the dark theme on dark paper, whole', async () => {
    const dir = await sheetFrom(ledNetlist())
    expect((await cli(['render', 'sheet.json', '-o', 'dark.png', '--dark', '--scale', '1'], { cwd: dir })).code).toBe(0)
    expectWholeDrawing(decodePng(readFileSync(join(dir, 'dark.png'))), DARK_THEME, 1)
  }, 120_000)
  it.skipIf(!browser)('keeps the longest side at most PNG_MAX_SIDE, lowering the scale', () => {
    const dir = tempDir()
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="40"><rect width="5000" height="40" fill="${LIGHT_THEME.paper}"/><rect x="100" y="10" width="4800" height="20" fill="#23282F"/></svg>\n`
    const r = writePng({ svg, width: 5000, height: 40 }, 4, join(dir, 'wide.png'), process.env)
    expect(r).toEqual({ ok: true, width: PNG_MAX_SIDE, height: 64 })
    const p = decodePng(readFileSync(join(dir, 'wide.png')))
    expect({ w: p.width, h: p.height }).toEqual({ w: PNG_MAX_SIDE, h: 64 })
    expect(pixelAt(p, PNG_MAX_SIDE - 200, 32)).toBe('#23282F')
    expect(near(pixelAt(p, PNG_MAX_SIDE - 1, 63), LIGHT_THEME.paper)).toBe(true)
  }, 120_000)
  it('frames one repeat copy with --focus, and exits 2 on a name the intent does not have', async () => {
    const dir = await sheetFrom(tiltSensors())
    expect((await cli(['render', 'sheet.json', '--svg', 'full.svg'], { cwd: dir })).code).toBe(0)
    expect((await cli(['render', 'sheet.json', '--svg', 'focus.svg', '--focus', 'tilt_3'], { cwd: dir })).code).toBe(0)
    const full = svgSize(readFileSync(join(dir, 'full.svg'), 'utf8'))
    const focus = svgSize(readFileSync(join(dir, 'focus.svg'), 'utf8'))
    expect(focus.w * focus.h).toBeLessThan(full.w * full.h)
    const bad = await cli(['render', 'sheet.json', '--svg', 'x.svg', '--focus', 'nothing'], { cwd: dir })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('no repeat copy or group named "nothing"')
  })
  it('frames a group with --focus', async () => {
    const netlist = { ...ledNetlist(), groups: [{ name: 'Supply', parts: ['BT1'] }] }
    const dir = await sheetFrom(netlist)
    expect((await cli(['render', 'sheet.json', '--svg', 'full.svg'], { cwd: dir })).code).toBe(0)
    expect((await cli(['render', 'sheet.json', '--svg', 'supply.svg', '--focus', 'Supply'], { cwd: dir })).code).toBe(0)
    const full = svgSize(readFileSync(join(dir, 'full.svg'), 'utf8'))
    const supply = svgSize(readFileSync(join(dir, 'supply.svg'), 'utf8'))
    expect(supply.w * supply.h).toBeLessThan(full.w * full.h)
  })
  it('exits 2 for --focus on a sheet without an intent', async () => {
    const dir = await sheetFrom(ledNetlist())
    const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'))
    delete sheet.intent
    writeFileSync(join(dir, 'bare.json'), JSON.stringify(sheet))
    const r = await cli(['render', 'bare.json', '--svg', 'x.svg', '--focus', 'tilt_1'], { cwd: dir })
    expect(r.code).toBe(2)
    expect(r.err).toContain('no intent')
  })
})

describe('browser detection', () => {
  it('lists Chrome and Edge where each platform installs them', () => {
    const win = browserCandidates({ PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32')
    expect(win.some((p) => p.endsWith(join('Google', 'Chrome', 'Application', 'chrome.exe')))).toBe(true)
    expect(win.some((p) => p.endsWith(join('Microsoft', 'Edge', 'Application', 'msedge.exe')))).toBe(true)
    expect(browserCandidates({}, 'darwin')[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(browserCandidates({}, 'linux')).toContain('/usr/bin/microsoft-edge')
  })
  it('uses CIRCUITOON_BROWSER when it names a file, and finds nothing when that file is missing', () => {
    const dir = tempDir()
    const exe = join(dir, 'my-browser')
    writeFileSync(exe, '')
    expect(findBrowser({ CIRCUITOON_BROWSER: exe })).toBe(exe)
    expect(findBrowser({ CIRCUITOON_BROWSER: join(dir, 'missing') })).toBeNull()
    expect(findBrowser({ PROGRAMFILES: join(dir, 'none') }, 'win32')).toBeNull()
  })
})
