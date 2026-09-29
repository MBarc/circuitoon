// Browser check for the wiring checker's Problems list, in the built app. Loads a sheet that
// breaks several rules (a 5 V supply into an ESP32 3V3 pin, a cell's + wired to a board ground
// that leads back to its -, a sensor with no power or ground, a wire in the hole a resistor leg fills, a broken wire), then through
// the real UI checks the toolbar badge, the list (errors first), hover lighting the parts, pins
// and wires on the canvas, Select (selection, pan into view, focus; a hole problem selects only
// its wire), the badge bringing the list back and naming the counts by severity, each Select
// button's unique name and description, Delete on the broken row (focus to the next row), undo
// putting a stale light out, the empty state, and a sheet whose only finding is a note (a battery
// bank: no badge, still "No problems found", the note under Notes). Saves light and
// dark screenshots of each state.
//
// Usage (from the repo root, after `npm run build`):
//   npm run check:problems-ui -- [--out <dir>] [--port 4206]
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
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-problems-ui')))
const port = Number(flag('--port', '4206'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const ids = ['esp32-devkitc-v4', 'ip5306-usbc-module', 'battery-18650-holder', 'bme280-module-6pin', 'breadboard-half', 'resistor']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const file = join(out, 'problems.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Problems check', modules,
  parts: [
    at('bb', 'BB1', 'breadboard-half', 0, 300),
    // Legs at (30, 360) and (90, 360): c1-top and c7-top, hole 0.
    at('r1', 'R1', 'resistor', 30, 340, { mount: { board: 'bb' } }),
    at('bt1', 'BT1', 'battery-18650-holder', 140, 40),
    at('u1', 'U1', 'esp32-devkitc-v4', 420, 0),
    at('u2', 'U2', 'ip5306-usbc-module', 720, 40),
    at('u3', 'U3', 'bme280-module-6pin', 700, 330),
  ],
  connections: [
    { uid: 'w1', from: { part: 'u2', pin: '5V+' }, to: { part: 'u1', pin: '3V3' }, color: 'red' },
    { uid: 'w2', from: { part: 'u2', pin: '5V-' }, to: { part: 'u1', pin: 'GND' }, color: 'black' },
    { uid: 'w3', from: { part: 'bt1', pin: '+' }, to: { part: 'u1', pin: 'GND' }, color: 'red' },
    { uid: 'w7', from: { part: 'bt1', pin: '-' }, to: { part: 'u1', pin: 'GND 2' }, color: 'black' },
    { uid: 'w4', from: { part: 'u3', pin: 'SCL' }, to: { part: 'u1', pin: 'IO22' }, color: 'yellow' },
    { uid: 'w5', from: { part: 'bb', pin: 'c1-top', hole: 0 }, to: { part: 'u3', pin: 'SDA' }, color: 'blue' },
    { uid: 'w6', from: { part: 'u1', pin: 'IO23' }, to: { part: 'gone', pin: 'VCC' }, label: 'Sensor power' },
  ],
}))

// Only warnings: a sensor wired to a board by one data line, with no power and no shared ground.
const warnFile = join(out, 'warnings-only.circuitoon.json')
writeFileSync(warnFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Warnings only', modules,
  parts: [at('u1', 'U1', 'esp32-devkitc-v4', 0, 0), at('u3', 'U3', 'bme280-module-6pin', 300, 60)],
  connections: [{ uid: 'w1', from: { part: 'u3', pin: 'SCL' }, to: { part: 'u1', pin: 'IO22' }, color: 'yellow' }],
}))

// Only a note: four matching 18650 cells in parallel on an IP5306 (Ruling V1).
// Michael's 1S4P sheet, less its one doubled hole: w9 and w11 both end in c2-top hole 2 (a
// hole-shared error), so w9's end moves to hole 3 of that strip, which is free.
const bankFile = join(out, 'battery-bank-1s4p.circuitoon.json')
{
  const bank = JSON.parse(readFileSync('src/format/fixtures/battery-bank-1s4p.circuitoon.json', 'utf8'))
  bank.connections.find((c) => c.uid === 'w9').from.hole = 3
  writeFileSync(bankFile, JSON.stringify(bank))
}

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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 150) => page.waitForTimeout(ms)
  const saved = async (locator, name) => {
    await locator.screenshot({ path: join(out, `${name}-${scheme}.png`) })
    console.log('saved', join(out, `${name}-${scheme}.png`))
  }
  const focus = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('data-problem-select') || '')

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  // The empty sheet: no badge, the clean line in the side panel.
  check((await page.locator('.problems-badge').count()) === 0, `${scheme}: an empty sheet shows no badge`)
  check((await page.locator('#problems-title').textContent()) === 'No problems found in the drawn connections.', `${scheme}: the empty state speaks only of the drawn connections`)
  await saved(page.locator('.inspector'), 'problems-empty')

  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('[data-part="u3"]')
  await pause(300)
  const badge = page.locator('.problems-badge')
  const rows = page.locator('.problems li')
  const n = await rows.count()
  const badgeText = (await badge.textContent())?.trim()
  check(n >= 6 && badgeText === `${n} problems`, `${scheme}: the badge counts every row (${badgeText}, ${n} rows)`)
  check(await badge.evaluate((el) => el.classList.contains('error')), `${scheme}: the badge is red when there is an error`)
  const badgeName = await badge.getAttribute('aria-label')
  check(/^\d+ problems: \d+ errors?, \d+ warnings?\. /.test(badgeName ?? ''), `${scheme}: the badge's name gives the counts by severity ("${badgeName}")`)
  const selects = await rows.evaluateAll((els) => els.map((e) => {
    const b = e.querySelector('[data-problem-select]')
    const desc = document.getElementById(b.getAttribute('aria-describedby') ?? '')
    return { name: b.getAttribute('aria-label'), described: desc?.textContent === e.querySelector('.problem-message').textContent }
  }))
  check(new Set(selects.map((x) => x.name)).size === n, `${scheme}: every Select button has its own name (${selects.map((x) => x.name).join(' | ')})`)
  check(selects.every((x) => x.described), `${scheme}: every Select button is described by its message`)
  const titles = await page.locator('.problem-title').allTextContents()
  const severities = await rows.evaluateAll((els) => els.map((e) => e.className))
  check(severities.indexOf('warning') > 0 && !severities.slice(severities.indexOf('warning')).includes('error'), `${scheme}: errors are listed first (${severities.join(' ')})`)
  for (const t of ['Error: Short circuit', 'Error: Supplies fight', 'Error: Broken connection', 'Warning: No power', 'Warning: No ground', 'Error: Two in one hole'])
    check(titles.includes(t), `${scheme}: the list has "${t}"`)
  const messages = await page.locator('.problem-message').allTextContents()
  check(messages.includes('U2 5V+ (5 V) and U1 3V3 (3.3 V) are wired together: the two supplies fight, and the higher one drives current into the lower one, which can damage both. Remove the wire from U2 5V+ to U1 3V3.'), `${scheme}: the supplies-fight message names both pins`)
  check(messages.includes('BT1 + is wired to U1 GND, which leads back to BT1 -: short circuit. Nothing limits the current, so BT1 and the wires can overheat. Remove the wire from BT1 + to U1 GND.'), `${scheme}: the short message names the way back and the wire to remove`)
  await saved(page.locator('.toolbar'), 'problems-badge')
  await saved(page.locator('.inspector'), 'problems-list')

  // Hover the short circuit row: its parts get a halo and a sticker, its pins a ring, its wires a glow.
  const shortRow = rows.filter({ hasText: 'Short circuit' })
  await shortRow.hover()
  await pause()
  const lit = async () => ({
    halos: await page.locator('.problem-hi .problem-halo').count(),
    pins: await page.locator('.problem-hi .problem-pin').count(),
    glow: await page.locator('.problem-glow path').count(),
  })
  const l = await lit()
  check(l.halos === 2 && l.pins >= 3 && l.glow === 3, `${scheme}: hovering the short lights its parts, pins and wires (${JSON.stringify(l)})`)
  await page.screenshot({ path: join(out, `problems-hover-${scheme}.png`) })
  console.log('saved', join(out, `problems-hover-${scheme}.png`))
  await page.mouse.move(700, 450)
  await pause()
  check((await lit()).halos === 0, `${scheme}: leaving the list puts the light out`)

  // Keyboard focus lights a row too.
  await rows.filter({ hasText: 'Two in one hole' }).getByRole('button', { name: /^Select/ }).focus()
  await pause()
  check((await lit()).halos === 2, `${scheme}: focusing a row's Select lights its parts`)

  // Select: the parts and wires are selected, brought into view, and focus goes to the panel heading.
  await page.mouse.wheel(0, 0)
  await page.locator('svg.canvas').evaluate((svg) => svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, clientX: 900, clientY: 700, bubbles: true, cancelable: true })))
  await pause()
  await rows.filter({ hasText: 'No power' }).getByRole('button', { name: /^Select/ }).click()
  await pause(250)
  check((await focus()) === 'selection-title', `${scheme}: Select moves focus to the panel heading (focus on "${await focus()}")`)
  const inView = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect()
    const r = document.querySelector('[data-part="u3"]').getBoundingClientRect()
    return r.left >= wrap.left && r.top >= wrap.top && r.right <= wrap.right && r.bottom <= wrap.bottom
  })
  check(inView, `${scheme}: Select pans the selected part into view`)
  await page.screenshot({ path: join(out, `problems-selected-${scheme}.png`) })
  console.log('saved', join(out, `problems-selected-${scheme}.png`))

  // The badge brings the list back, focused.
  await badge.click()
  await pause()
  check((await focus()) === 'problems-title' && (await rows.count()) === n, `${scheme}: the badge clears the selection and focuses the list (focus on "${await focus()}")`)

  // Select on a hole problem selects only the wire, never the board.
  await rows.filter({ hasText: 'Two in one hole' }).getByRole('button', { name: /^Select/ }).click()
  await pause(250)
  check((await focus()) === 'wire-title', `${scheme}: Select on a hole problem selects just its wire (focus on "${await focus()}")`)
  await badge.click()
  await pause()

  // Delete on the broken row removes the wire; focus moves to the next row's Select.
  const brokenRow = rows.filter({ hasText: 'Broken connection' })
  const nextId = await rows.nth((await rows.evaluateAll((els) => els.findIndex((e) => e.textContent.includes('Broken connection')))) + 1).locator('[data-problem-select]').getAttribute('data-problem-select')
  await brokenRow.getByRole('button', { name: 'Delete Sensor power' }).click()
  await pause(250)
  check((await rows.count()) === n - 1 && (await badge.textContent())?.trim() === `${n - 1} problems`, `${scheme}: Delete removes the broken row and the badge counts down`)
  check((await focus()) === nextId, `${scheme}: after Delete focus is on the next row's Select (focus on "${await focus()}")`)

  // A light whose problem an undo brings back or takes away goes out: hover a row, undo.
  await rows.filter({ hasText: 'Two in one hole' }).hover()
  await pause()
  check((await lit()).halos === 2, `${scheme}: hovering lights the hole problem before the undo`)
  await page.keyboard.press('Control+z')
  await pause(250)
  check((await lit()).halos === 0 && (await rows.count()) === n, `${scheme}: undo puts the light out and brings the broken row back`)
  await page.mouse.move(700, 450)

  // A sheet with only warnings: a yellow badge.
  await page.locator('input[type=file]').setInputFiles(warnFile)
  await page.waitForSelector('text=Warnings only')
  await pause(300)
  check(await badge.evaluate((el) => el.classList.contains('warning')) && (await badge.textContent())?.trim() === '3 problems', `${scheme}: a sheet with only warnings has a yellow badge (${(await badge.textContent())?.trim()})`)
  await saved(page.locator('.toolbar'), 'problems-badge-warnings')
  await saved(page.locator('.inspector'), 'problems-list-warnings')

  // A sheet whose only finding is a note (a 1S4P battery bank): no badge, the clean line, and the
  // note under Notes, lit in blue on hover.
  await page.locator('input[type=file]').setInputFiles(bankFile)
  await page.waitForSelector('[data-part="p7"]')
  await pause(300)
  check((await badge.count()) === 0, `${scheme}: a sheet with only a note shows no problems badge`)
  check((await page.locator('#problems-title').textContent()) === 'No problems found in the drawn connections.', `${scheme}: a sheet with only a note still reads "No problems found"`)
  const noteRows = page.locator('.problem-notes li')
  check((await noteRows.count()) === 1 && (await noteRows.first().getAttribute('class')) === 'info', `${scheme}: the note is one info row under Notes`)
  check((await noteRows.first().locator('.problem-title').textContent()) === 'Note: Parallel battery bank', `${scheme}: the note row says it is a note`)
  check((await page.locator('.problem-notes .problems-count').textContent()) === '1 note', `${scheme}: Notes counts one note`)
  await noteRows.first().hover()
  await pause()
  const noteLit = { halos: await page.locator('.problem-hi.info .problem-halo').count(), pins: await page.locator('.problem-hi.info .problem-pin').count() }
  check(noteLit.halos === 4 && noteLit.pins === 8, `${scheme}: hovering the note lights the four cells in blue (${JSON.stringify(noteLit)})`)
  await page.mouse.move(700, 450)
  await pause()
  await saved(page.locator('.inspector'), 'problems-notes')

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await page.close()
}
await browser.close()
console.log(`screenshots in ${out}`)
if (failures.length) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all problems-list checks passed')
process.exit(0)
