// Browser check for the mains look on the editor canvas, in the built app (Resolution 30, spec 5).
// Loads a Schuko outlet with a CEE 7/7 cord plug seated in it and an E27 lamp wired from the plug's
// L lead, then through the real UI checks: the L wire takes its identity colour (brown) and the
// hazard outline; a wire drawn from the plug's N lead takes its identity colour (blue) although the
// new-wire style is black; while the plug is dragged off the outlet, the canvas holds the wire looks
// it had when the drag began (no re-analysis per frame, so the L wire stays brown and outlined even
// though the plug no longer sits in the socket); after the drop the looks follow the sheet again
// (the unplugged L wire is plain, the new wire keeps the blue it was given). Saves light and dark
// screenshots of each step.
//
// Usage (from the repo root, after `npm run build`):
//   npm run check:mains-ui -- [--out <dir>] [--port 4208]
//
// Starts `vite preview` on --port and stops it afterwards, drives the locally installed Chrome
// through playwright-core (never the shared Playwright MCP browser), and exits 1 on any failed
// check or page error.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'
import { NAMED_COLORS } from '../src/format/diagram.ts'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i < 0 ? dflt : args[i + 1]
}
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-mains-ui')))
const port = Number(flag('--port', '4208'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const ids = ['outlet-schuko-cee7-3', 'plug-eu-cee7-7', 'lamp-holder-e27']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const file = join(out, 'mains-look.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Mains look check', modules,
  parts: [
    at('xs1', 'XS1', 'outlet-schuko-cee7-3', 100, 100),
    // The plug's contacts sit on the outlet's holes at the same origin (both follow src/format/plugging.ts).
    at('xp1', 'XP1', 'plug-eu-cee7-7', 100, 100, { mount: { board: 'xs1' } }),
    at('e1', 'E1', 'lamp-holder-e27', 420, 100),
  ],
  connections: [{ uid: 'm1', from: { part: 'xp1', pin: 'L' }, to: { part: 'e1', pin: 'L' }, gauge: 18, ends: { from: 'stripped', to: 'stripped' } }],
}))

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' })
const stopServer = () => {
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    else server.kill('SIGTERM')
  } catch {
    // already gone
  }
}
process.on('exit', stopServer)
const base = `http://localhost:${port}/circuitoon/`
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base)).ok) break
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500))
}

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const BROWN = NAMED_COLORS.brown
const BLUE = NAMED_COLORS.blue
const BLACK = NAMED_COLORS.black

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 150) => page.waitForTimeout(ms)
  const shot = async (name) => {
    const path = join(out, `mains-${name}-${scheme}.png`)
    await page.locator('svg.canvas').screenshot({ path })
    console.log('saved', path)
  }
  /** The drawn look of one wire on the canvas: its colour stroke, and whether the hazard outline is under it. */
  const look = (uid) =>
    page.evaluate((uid) => {
      const g = document.querySelector(`svg.canvas g[data-wire="${uid}"]`)
      return g ? { color: g.querySelector('.wire-color')?.getAttribute('stroke') ?? null, hazard: !!g.querySelector('.wire-hazard') } : null
    }, uid)
  const center = async (sel) => {
    const b = await page.locator(sel).first().boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const wireUids = () => page.evaluate(() => [...new Set([...document.querySelectorAll('svg.canvas [data-wire]')].map((e) => e.getAttribute('data-wire')))])

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('[data-part="xp1"]')
  await pause(300)
  check(JSON.stringify(await look('m1')) === JSON.stringify({ color: BROWN, hazard: true }), `${scheme}: the L wire from the seated plug is brown with the hazard outline (${JSON.stringify(await look('m1'))})`)
  check(await page.locator('.mains-badge').isVisible(), `${scheme}: the toolbar shows the mains badge`)

  // A new wire from the plug's N lead takes N's identity colour, not the black new-wire style.
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).includes('black'), `${scheme}: the new-wire style is black`)
  const from = await center('[data-pin-part="xp1"][data-pin="N"]')
  const to = await center('[data-pin-part="e1"][data-pin="N"]')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2 + 40, { steps: 5 })
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  await pause(300)
  const added = (await wireUids()).find((u) => u !== 'm1')
  check(!!added, `${scheme}: a wire was drawn from XP1 N to E1 N (${added})`)
  check(JSON.stringify(await look(added)) === JSON.stringify({ color: BLUE, hazard: true }), `${scheme}: the new wire takes N's identity colour, blue (${JSON.stringify(await look(added))})`)
  await shot('seated')

  // Drag the plug off the outlet; hold the pointer down and look while the drag is open.
  await page.mouse.click(5, 5)
  const plug = await page.locator('[data-part="xp1"]').boundingBox()
  const grab = { x: plug.x + plug.width * 0.3, y: plug.y + plug.height * 0.8 }
  const partAt = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-part]')?.getAttribute('data-part'), grab)
  check(partAt === 'xp1', `${scheme}: the grab point is on XP1's body (${partAt})`)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + 150, { steps: 8 })
  await page.mouse.move(grab.x, grab.y + 300, { steps: 8 })
  await pause(250)
  const moved = await page.locator('[data-part="xp1"]').boundingBox()
  check(moved.y > plug.y + 200, `${scheme}: mid-drag, XP1 has left the outlet (${Math.round(plug.y)} to ${Math.round(moved.y)})`)
  check(JSON.stringify(await look('m1')) === JSON.stringify({ color: BROWN, hazard: true }), `${scheme}: mid-drag, the canvas holds the L wire's look (${JSON.stringify(await look('m1'))})`)
  check(JSON.stringify(await look(added)) === JSON.stringify({ color: BLUE, hazard: true }), `${scheme}: mid-drag, the new wire keeps its look`)
  await shot('dragging')
  await page.mouse.up()
  await pause(400)
  check(JSON.stringify(await look('m1')) === JSON.stringify({ color: BLACK, hazard: false }), `${scheme}: after the drop the unplugged L wire is plain (${JSON.stringify(await look('m1'))})`)
  check(JSON.stringify(await look(added)) === JSON.stringify({ color: BLUE, hazard: false }), `${scheme}: after the drop the new wire keeps the blue it was given, without the hazard (${JSON.stringify(await look(added))})`)
  await shot('unplugged')

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await page.close()
}
await browser.close()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall mains look checks passed')
process.exit(0)
