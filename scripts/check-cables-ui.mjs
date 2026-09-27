// Browser check for cable ends, in the built app. Loads a breadboard sheet with one wire per cable
// preset (every end kind, ends facing up and down), a sensor wired to a board with Dupont F-F
// leads (ends facing down and left) and a battery clipped to a resistor with alligator leads
// (ends facing left, right and up), and a vertical resistor wired to a horizontal one with banana
// and Dupont leads (every part off the grid, so every pin end needs a straight lead-out), then through the real UI checks: every connector is drawn on
// the right end of the right wire; the Cable select sets both ends in one undo step; the per-end
// selects make a Custom cable and Swap ends turns it round; several selected wires take one
// preset together; a new wire gets the last cable picked, and so does one drawn after a reload
// (remembered per browser); Export JSON writes the ends and a plain wire writes none. Saves
// screenshots of the sheet at 100% and 267% zoom, and of the Inspector, in light and dark.
//
// Usage (from the repo root, after `npm run build`):
//   npm run check:cables-ui -- [--out <dir>] [--port 4207]
//
// Starts `vite preview` on --port and stops it afterwards, drives the locally installed Chrome
// through playwright-core (never the shared Playwright MCP browser), and exits 1 on any failed
// check or page error.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i < 0 ? dflt : args[i + 1]
}
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-cables-ui')))
const port = Number(flag('--port', '4207'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

// The presets, as the Inspector lists them (src/format/cables.ts).
const PRESETS = [
  ['wire', 'bare', 'bare'],
  ['dupont-mm', 'dupont-male', 'dupont-male'],
  ['dupont-mf', 'dupont-male', 'dupont-female'],
  ['dupont-ff', 'dupont-female', 'dupont-female'],
  ['solid-jumper', 'solid-jumper', 'solid-jumper'],
  ['alligator', 'alligator', 'alligator'],
  ['alligator-dupont', 'alligator', 'dupont-male'],
  ['stripped', 'stripped', 'stripped'],
  ['ferrules', 'ferrule', 'ferrule'],
  ['jst-xh', 'jst-xh', 'jst-xh'],
  ['jst-ph', 'jst-ph', 'jst-ph'],
  ['qwiic', 'jst-sh', 'jst-sh'],
  ['grove', 'grove', 'grove'],
  ['banana', 'banana', 'banana'],
]
const COLORS = ['black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'white', 'brown', 'pink', 'blue', 'yellow', 'red']
const endsOf = (from, to) => {
  const e = {}
  if (from !== 'bare') e.from = from
  if (to !== 'bare') e.to = to
  return Object.keys(e).length ? e : undefined
}

const ids = ['breadboard-half', 'bme280-module-4pin', 'esp32-devkitc-v4', 'battery-9v', 'resistor']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y) => ({ uid, designator, module, x, y, rotation: 0 })
// The board sits at (0, 120): column N's top holes run down from (20 + 10N, 180), its bottom
// holes from (20 + 10N, 250). Preset i runs down column 2i + 1, so neighbours are 20 px apart.
const connections = PRESETS.map(([, from, to], i) => {
  const ends = endsOf(from, to)
  return {
    uid: `c${i}`,
    from: { part: 'bb', pin: `c${2 * i + 1}-top`, hole: 0 },
    to: { part: 'bb', pin: `c${2 * i + 1}-bot`, hole: 4 },
    color: COLORS[i],
    gauge: 22,
    ...(ends ? { ends } : {}),
  }
})
const ff = { from: 'dupont-female', to: 'dupont-female' }
connections.push(
  { uid: 's1', from: { part: 'u2', pin: 'VIN' }, to: { part: 'u1', pin: '3V3' }, color: 'red', gauge: 22, ends: ff },
  { uid: 's2', from: { part: 'u2', pin: 'GND' }, to: { part: 'u1', pin: 'GND' }, color: 'black', gauge: 22, ends: ff },
  { uid: 's3', from: { part: 'u2', pin: 'SCL' }, to: { part: 'u1', pin: 'IO22' }, color: 'yellow', gauge: 22, ends: ff },
  { uid: 's4', from: { part: 'u2', pin: 'SDA' }, to: { part: 'u1', pin: 'IO21' }, color: 'blue', gauge: 22, ends: ff },
  { uid: 'a1', from: { part: 'bt', pin: '+' }, to: { part: 'r1', pin: '1' }, color: 'red', gauge: 20, ends: { from: 'alligator', to: 'alligator' } },
  { uid: 'a2', from: { part: 'bt', pin: '-' }, to: { part: 'r1', pin: '2' }, color: 'black', gauge: 20, ends: { from: 'alligator', to: 'alligator' } },
  // A vertical resistor to a horizontal one: banana leads and a Dupont M-M, ends off the grid.
  { uid: 'b1', from: { part: 'r2', pin: '1' }, to: { part: 'r4', pin: '1' }, color: 'red', gauge: 20, ends: { from: 'banana', to: 'banana' } },
  { uid: 'b2', from: { part: 'r2', pin: '2' }, to: { part: 'r4', pin: '2' }, color: 'green', gauge: 22, ends: { from: 'dupont-male', to: 'dupont-male' } },
)
const file = join(out, 'cables.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Cables check', modules,
  parts: [
    at('bb', 'BB1', 'breadboard-half', 0, 120),
    at('u2', 'U2', 'bme280-module-4pin', 400, 0),
    at('u1', 'U1', 'esp32-devkitc-v4', 600, 20),
    at('bt', 'BT1', 'battery-9v', 400, 420),
    at('r1', 'R1', 'resistor', 440, 330),
    { ...at('r2', 'R2', 'resistor', 603, 334), rotation: 90 },
    at('r4', 'R4', 'resistor', 687, 465),
  ],
  connections,
}))
const expectedEnds = Object.fromEntries(connections.map((c) => [c.uid, [c.ends?.from, c.ends?.to].filter(Boolean)]))

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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, colorScheme: scheme, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 150) => page.waitForTimeout(ms)
  const shot = async (locator, name) => {
    const path = join(out, `${name}-${scheme}.png`)
    await locator.screenshot({ path })
    console.log('saved', path)
  }
  const canvas = page.locator('svg.canvas')
  /** Screen position of a world point, from the canvas viewBox. */
  const screen = (x, y) =>
    canvas.evaluate((svg, [x, y]) => {
      const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number)
      const r = svg.getBoundingClientRect()
      const s = r.width / vw
      return { x: r.left + (x - vx) * s, y: r.top + (y - vy) * s }
    }, [x, y])
  const clickWorld = async (x, y, shift = false) => {
    const p = await screen(x, y)
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.click(p.x, p.y)
    if (shift) await page.keyboard.up('Shift')
    await pause()
  }
  const kinds = (uid) => page.locator(`[data-wire="${uid}"] [data-cable-end]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-cable-end')))
  const zoomTo = async (scale, x, y) => {
    // The readout shows 100% at scale 1.5; a wheel step multiplies scale by exp(-deltaY * 0.0015).
    const now = await canvas.evaluate((svg) => svg.getBoundingClientRect().width / Number(svg.getAttribute('viewBox').split(' ')[2]))
    const p = await screen(x, y)
    const deltaY = -Math.log(scale / now) / 0.0015
    await canvas.evaluate((svg, [dy, cx, cy]) => svg.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: cx, clientY: cy, bubbles: true, cancelable: true })), [deltaY, p.x, p.y])
    await pause(250)
  }
  const load = async () => {
    await page.locator('input[type=file]').setInputFiles(file)
    await page.waitForSelector('[data-wire="a2"]')
    await pause(300)
  }
  const exported = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
    return JSON.parse(readFileSync(await download.path(), 'utf8'))
  }

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.removeItem('circuitoon.newWire.ends'))
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await load()

  // Every connector is drawn, in from/to order, on its own wire.
  let allRight = true
  for (const [uid, want] of Object.entries(expectedEnds)) {
    const got = await kinds(uid)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      allRight = false
      console.log(`  ${uid}: expected ${want.join(', ')} got ${got.join(', ')}`)
    }
  }
  check(allRight, `${scheme}: every wire draws its own connectors, from end first`)
  // Each connector sits on its wire's endpoint, facing along the wire.
  const facing = await page.evaluate(() =>
    [...document.querySelectorAll('[data-cable-end]')].map((g) => g.getAttribute('transform')),
  )
  // Connectors are one layer above every wire stroke: no later wire paints over a housing.
  const above = await page.evaluate(() => {
    const strokes = [...document.querySelectorAll('svg.canvas .wire-hit')]
    const first = document.querySelector('svg.canvas [data-cable-end]')
    return !!first && strokes.every((p) => p.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  check(above, `${scheme}: every connector draws above every wire stroke`)
  // No connector is squashed: every one sits on a straight end segment at least its own length.
  const squashed = await page.locator('[data-cable-end][data-squashed]').evaluateAll((els) => els.map((e) => e.closest('[data-wire]').getAttribute('data-wire')))
  check(squashed.length === 0, `${scheme}: every connector has its full length${squashed.length ? ` (squashed on ${squashed.join(', ')})` : ''}`)
  check(facing.some((t) => t.includes('rotate(90)')) && facing.some((t) => t.includes('rotate(270)')) && facing.some((t) => t.includes('rotate(180)')) && facing.some((t) => t.includes('rotate(0)')),
    `${scheme}: the sheet has connectors facing all four ways`)

  await zoomTo(1.5, 0, 0)
  check((await page.locator('.zoom-readout').textContent()) === '100%', `${scheme}: the sheet is at 100%`)
  await shot(canvas, 'cables-100')
  await zoomTo(4, 150, 180)
  check((await page.locator('.zoom-readout').textContent()) === '267%', `${scheme}: zoomed to 267%`)
  await shot(canvas, 'cables-267-top')
  await zoomTo(1.5, 150, 180)
  await zoomTo(4, 150, 290)
  await shot(canvas, 'cables-267-bottom')
  await zoomTo(1.5, 150, 290)
  await zoomTo(4, 520, 150)
  await shot(canvas, 'cables-267-sensor')
  await zoomTo(1.5, 520, 150)
  await zoomTo(4, 470, 380)
  await shot(canvas, 'cables-267-clips')
  await zoomTo(1.5, 470, 380)
  await zoomTo(4, 660, 430)
  await shot(canvas, 'cables-267-resistors')
  await zoomTo(1.5, 660, 430)

  // The wire's generous hit corridor reaches its endpoint, past the connector's own narrow art:
  // 5 px beside the alligator jaws of preset 5 (column 11, x=130), between holes, selects it.
  await clickWorld(135, 186)
  check((await page.locator('#wire-title').isVisible()) && (await page.locator('#wire-cable').inputValue()) === 'alligator', `${scheme}: a click beside a connector, inside the wire's hit corridor, selects the wire`)
  await clickWorld(0, 0)
  // Select the plain wire (in the channel, clear of every hole) and pick a cable.
  await clickWorld(30, 235)
  check(await page.locator('#wire-title').isVisible(), `${scheme}: clicking the plain wire selects it`)
  const cable = page.locator('#wire-cable')
  check((await cable.inputValue()) === 'wire', `${scheme}: a plain wire shows the Wire preset`)
  check((await page.locator('.inspector .hint', { hasText: 'New wires use' }).textContent()).includes('plain wire.'), `${scheme}: the new-wire hint says plain wire`)
  await shot(page.locator('.inspector'), 'inspector-wire')
  await cable.selectOption('dupont-mf')
  await pause()
  check(JSON.stringify(await kinds('c0')) === '["dupont-male","dupont-female"]', `${scheme}: the Cable select sets both ends`)
  // Clicking the connector itself still selects the wire.
  await clickWorld(0, 0)
  await clickWorld(30, 195)
  check(await page.locator('#wire-title').isVisible(), `${scheme}: clicking a connector selects its wire`)
  await page.keyboard.press('Control+z')
  await pause()
  check((await kinds('c0')).length === 0, `${scheme}: one undo takes the cable off again`)
  await page.keyboard.press('Control+y')
  await pause()
  check((await kinds('c0')).length === 2, `${scheme}: redo puts it back`)

  // The per-end selects make a Custom cable; Swap ends turns it round.
  const details = page.locator('details.cable-ends')
  if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click()
  await page.locator('#wire-end-to').selectOption('jst-ph')
  await pause()
  check((await cable.inputValue()) === 'custom', `${scheme}: ends that match no preset show Custom`)
  check(JSON.stringify(await kinds('c0')) === '["dupont-male","jst-ph"]', `${scheme}: the To select changes just that end`)
  check((await page.locator('#wire-end-from').evaluate((s) => s.closest('label').textContent)).includes('BB1 c1-top'), `${scheme}: each end names its pin or hole`)
  await shot(page.locator('.inspector'), 'inspector-custom')
  await page.getByRole('button', { name: 'Swap ends' }).click()
  await pause()
  check(JSON.stringify(await kinds('c0')) === '["jst-ph","dupont-male"]', `${scheme}: Swap ends turns the cable round`)
  await page.keyboard.press('Control+z')
  await pause()
  check(JSON.stringify(await kinds('c0')) === '["dupont-male","jst-ph"]', `${scheme}: one undo unswaps`)
  // Editing never closes the disclosure: picking a preset from Custom leaves it open.
  await cable.selectOption('dupont-mm')
  await pause()
  check(await details.evaluate((d) => d.open), `${scheme}: picking a preset while the ends are open keeps them open`)
  // Closed by hand, it stays closed while the cable changes, and a Custom pick does not reopen it.
  await details.locator('summary').click()
  await cable.selectOption('dupont-mf')
  await pause()
  check(!(await details.evaluate((d) => d.open)), `${scheme}: a disclosure closed by hand stays closed`)
  await details.locator('summary').click()
  await page.locator('#wire-end-to').selectOption('jst-ph')
  await pause()
  // Either way round, a pair that matches a preset shows it.
  await page.locator('#wire-end-to').selectOption('alligator')
  await pause()
  check((await cable.inputValue()) === 'alligator-dupont', `${scheme}: Dupont M to alligator reads as Alligator to Dupont M`)

  // Several wires take one preset together, in one undo step.
  await clickWorld(50, 235, true)
  check(await page.locator('#wires-cable').isVisible(), `${scheme}: two selected wires show one Cable select`)
  check((await page.locator('#wires-cable').inputValue()) === 'mixed', `${scheme}: different cables read Mixed`)
  await page.locator('#wires-cable').selectOption('grove')
  await pause()
  check(JSON.stringify([await kinds('c0'), await kinds('c1')]) === JSON.stringify([['grove', 'grove'], ['grove', 'grove']]), `${scheme}: both wires become Grove`)
  await shot(page.locator('.inspector'), 'inspector-multi')
  await page.keyboard.press('Control+z')
  await pause()
  check(JSON.stringify(await kinds('c1')) === '["dupont-male","dupont-male"]', `${scheme}: one undo restores both`)
  await page.keyboard.press('Control+y')
  await pause()

  // A new wire gets the last cable picked (Grove), drawn from a free hole to another.
  const drawWire = async (a, b) => {
    const p = await screen(...a)
    const q = await screen(...b)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 })
    await page.mouse.move(q.x, q.y, { steps: 4 })
    await page.mouse.up()
    await pause(250)
  }
  const before = await page.locator('[data-wire]').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-wire'))).size)
  await drawWire([310, 190], [310, 260])
  const newUid = await page.evaluate((known) => [...document.querySelectorAll('[data-wire]')].map((e) => e.getAttribute('data-wire')).find((u) => !known.includes(u)), Object.keys(expectedEnds))
  check(!!newUid && (await page.locator('[data-wire]').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-wire'))).size)) === before + 1, `${scheme}: a wire was drawn (${newUid})`)
  check(JSON.stringify(await kinds(newUid)) === '["grove","grove"]', `${scheme}: the new wire gets the last cable picked`)
  check((await page.locator('.inspector .hint', { hasText: 'New wires use' }).textContent()).includes('Grove end (per wire).'), `${scheme}: the hint names the new-wire cable`)

  // Export writes the ends, and a plain wire writes none.
  const saved = await exported()
  const byUid = Object.fromEntries(saved.connections.map((c) => [c.uid, c]))
  check(JSON.stringify(byUid.c0.ends) === '{"from":"grove","to":"grove"}' && JSON.stringify(byUid.c3.ends) === '{"from":"dupont-female","to":"dupont-female"}', `${scheme}: Export JSON writes the ends`)
  await clickWorld(70, 235)
  await cable.selectOption('wire')
  await pause()
  check(!('ends' in (await exported()).connections.find((c) => c.uid === 'c2')), `${scheme}: a wire set back to plain writes no ends`)

  // After a reload the new-wire cable is remembered (Wire now, the last pick); pick Qwiic and reload.
  await clickWorld(90, 235)
  await cable.selectOption('qwiic')
  await pause()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await load()
  check((await page.locator('.inspector .new-wires').textContent()) === 'New wires: black, 22 AWG, Qwiic / STEMMA QT end (per wire)', `${scheme}: with nothing selected the side panel shows the remembered new-wire style`)
  await shot(page.locator('.inspector'), 'inspector-sheet')
  await drawWire([310, 190], [310, 260])
  const again = await page.evaluate((known) => [...document.querySelectorAll('[data-wire]')].map((e) => e.getAttribute('data-wire')).find((u) => !known.includes(u)), Object.keys(expectedEnds))
  check(JSON.stringify(await kinds(again)) === '["jst-sh","jst-sh"]', `${scheme}: after a reload a new wire still gets the cable picked last`)
  await page.evaluate(() => localStorage.removeItem('circuitoon.newWire.ends'))

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await context.close()
}
await browser.close()
console.log(`screenshots in ${out}`)
if (failures.length) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all cable checks passed')
process.exit(0)
