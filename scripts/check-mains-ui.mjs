// Browser check for mains wiring on the editor canvas, in the built app (Resolution 30, spec 5 and 6).
//
// Part 1, the wire look while a plug is dragged: loads a Schuko outlet with a CEE 7/7 cord plug seated
// in it and an E27 lamp wired from the plug's L lead, then checks: the L wire takes its identity colour
// (brown) and the hazard outline; a wire drawn from the plug's N lead takes its identity colour (blue)
// although the new-wire style is purple (set through a wire's swatch, then undone); while the plug is dragged off the outlet, the canvas holds the
// wire looks it had when the drag began (no re-analysis per frame); after the drop the looks follow the
// sheet again (the unplugged L wire is plain, the new wire keeps the blue it was given).
//
// Part 2, Task 23: loads a sheet with a US duplex outlet (a cord plug seated, a fused lamp wired with no
// stored colours), a Schuko outlet with a Schuko plug seated the other way up, and a UK charger over the
// US outlet's lower socket; then through the real UI checks the notice in the Problems panel and the
// toolbar badge, identity colours and the hazard look on the wires, a wrong plug (red outline,
// plug-mismatch), a plug dragged onto a matching socket (green, seated, one undo step), turned a
// quarter (unseated, plug-mismatch), a new wire from a lead that carries L on the Schuko outlet taking
// brown, the notice in exported JSON and in print, and the empty state of a clean mains sheet.
// Saves light and dark screenshots of each step.
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
import { exportDownload, noSavePicker } from './lib/browser-check.mjs'
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

// Part 2 fixtures. Placements follow the modules: the US duplex outlet XS1 at (0, 0) has its upper
// socket's holes at L (50, 40), N (30, 40), PE (40, 60) and the lower one's 60 lower; the 60 x 60 US
// plug's prongs are at L (40, 30), N (20, 30), PE (30, 50), so it sits at (10, 10) on the upper socket
// and at (10, 70) on the lower one. The UK charger (80 x 80, unmounted) at (10, 70) covers the lower
// socket. The Schuko outlet XS2 at (600, 0) is 80 x 80 with L at (20, 40); the 80 x 80 Schuko plug at
// (600, 0) turned 180 puts its L prong in the N hole, so its L lead carries N and its N lead carries L.
const NOTICE = 'Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.'
const mainsIds = ['outlet-us-5-15r-duplex', 'outlet-schuko-cee7-3', 'plug-us-5-15p', 'plug-eu-cee7-7', 'charger-usb-5v-uk', 'fuse-holder-5x20-inline', 'lamp-holder-e26', 'lamp-holder-e27']
const mainsModules = Object.fromEntries(mainsIds.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const sheetFile = join(out, 'mains.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Mains check', modules: mainsModules,
  parts: [
    at('xs1', 'XS1', 'outlet-us-5-15r-duplex', 0, 0), at('xp1', 'XP1', 'plug-us-5-15p', 10, 10, { mount: { board: 'xs1' } }),
    at('ps1', 'PS1', 'charger-usb-5v-uk', 10, 70),
    at('f1', 'F1', 'fuse-holder-5x20-inline', 200, 200, { values: { fuseRating: { value: 2, unit: 'A' } } }), at('e1', 'E1', 'lamp-holder-e26', 400, 180),
    at('xs2', 'XS2', 'outlet-schuko-cee7-3', 600, 0), at('xp2', 'XP2', 'plug-eu-cee7-7', 600, 0, { rotation: 180, mount: { board: 'xs2' } }),
    at('e2', 'E2', 'lamp-holder-e27', 800, 180),
    at('xp3', 'XP3', 'plug-us-5-15p', 200, 400),
  ],
  connections: [
    { uid: 'w1', from: { part: 'xp1', pin: 'L' }, to: { part: 'f1', pin: '1' }, gauge: 18, ends: { from: 'ferrule', to: 'ferrule' } },
    { uid: 'w2', from: { part: 'f1', pin: '2' }, to: { part: 'e1', pin: 'L' }, gauge: 18 },
    { uid: 'w3', from: { part: 'e1', pin: 'N' }, to: { part: 'xp1', pin: 'N' }, gauge: 18 },
    { uid: 'w4', from: { part: 'xp2', pin: 'L' }, to: { part: 'e2', pin: 'L' }, gauge: 18 },
    { uid: 'w5', from: { part: 'xp2', pin: 'N' }, to: { part: 'e2', pin: 'N' }, gauge: 18 },
  ],
}))
const cleanFile = join(out, 'mains-clean.circuitoon.json')
writeFileSync(cleanFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Mains clean', modules: mainsModules,
  parts: [at('xs1', 'XS1', 'outlet-us-5-15r-duplex', 0, 0), at('xp1', 'XP1', 'plug-us-5-15p', 10, 10, { mount: { board: 'xs1' } })],
  connections: [],
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
const WHITE = NAMED_COLORS.white

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  await noSavePicker(page)
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

  // The new-wire style starts blue, N's own identity colour, so set it to purple first: pick purple on
  // the L wire (which makes it the style), then undo the wire's recolour (the style stays).
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).startsWith('New wires: blue'), `${scheme}: the new-wire style starts blue`)
  const onM1 = await page.evaluate(() => {
    const path = document.querySelector('svg.canvas g[data-wire="m1"] .wire-color')
    const p = path.getPointAtLength(path.getTotalLength() / 2)
    const svg = path.ownerSVGElement
    const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number)
    const box = svg.getBoundingClientRect()
    const k = box.width / vw
    return { x: box.left + (p.x - vx) * k, y: box.top + (p.y - vy) * k }
  })
  await page.mouse.click(onM1.x, onM1.y)
  await page.locator('.inspector .swatch[title="purple"]').click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.mouse.click(5, 5)
  await pause(200)
  check(JSON.stringify(await look('m1')) === JSON.stringify({ color: BROWN, hazard: true }), `${scheme}: undo gives the L wire back its identity colour`)
  // A new wire from the plug's N lead takes N's identity colour, not the purple new-wire style.
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).includes('purple for signals'), `${scheme}: the new-wire style is purple`)
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

  // ---- Part 2 (Task 23) ----
  const panelShot = async (name) => {
    const path = join(out, `mains-${name}-${scheme}.png`)
    await page.locator('.inspector').screenshot({ path })
    console.log('saved', path)
  }
  /** Screen position of a world point on the canvas. */
  const screen = (x, y) =>
    page.evaluate(([x, y]) => {
      const svg = document.querySelector('svg.canvas')
      const p = svg.createSVGPoint()
      p.x = x
      p.y = y
      const s = p.matrixTransform(svg.getScreenCTM())
      return { x: s.x, y: s.y }
    }, [x, y])
  const messages = () => page.locator('.problem-message').allTextContents()
  const legs = () => page.locator('[data-legs] circle').count()
  const partBox = (uid) => page.locator(`[data-part="${uid}"]`).boundingBox()
  /** Where a part is, by one of its pin tips (its box also takes in the selection frame and the caption, which move with seating). */
  const pinAt = (uid, pin) => center(`[data-pin-part="${uid}"][data-pin="${pin}"]`)
  const near = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1

  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('[data-part="xp3"]')
  await pause(400)
  // Zoom out one wheel step at the canvas's top-left corner so the whole sheet (world 0 to about 880
  // across) is in view; every position below is taken from the canvas's own transform.
  {
    const c = await page.locator('svg.canvas').boundingBox()
    await page.mouse.move(c.x + 1, c.y + 1)
    await page.mouse.wheel(0, 300)
    await pause(300)
    const e2 = await partBox('e2')
    check(e2.x + e2.width < c.x + c.width && e2.y + e2.height < c.y + c.height, `${scheme}: the whole mains sheet is in view`)
  }

  // The notice: Problems panel (in full, never collapsed) and toolbar badge.
  await page.mouse.click(5, 5)
  await pause()
  const panelNotice = page.locator('.inspector .mains-notice')
  check((await panelNotice.count()) === 1 && (await panelNotice.textContent()) === NOTICE, `${scheme}: the Problems panel shows the mains notice, verbatim`)
  check((await panelNotice.count()) === 1 && (await panelNotice.isVisible()), `${scheme}: the notice is visible, not collapsed`)
  check((await page.locator('.mains-badge').count()) === 1 && (await page.locator('.mains-badge').isVisible()), `${scheme}: the toolbar shows the mains badge`)
  await panelShot('panel')

  // Identity colours and the hazard look, on wires stored with no colour.
  const w1 = await look('w1')
  check(w1?.color === BLACK && w1.hazard, `${scheme}: the US L wire is black with the hazard outline (${JSON.stringify(w1)})`)
  const w3 = await look('w3')
  check(w3?.color === WHITE, `${scheme}: the US N wire is white (${JSON.stringify(w3)})`)
  const w4 = await look('w4')
  check(w4?.color === BLUE, `${scheme}: the reversed Schuko plug's L lead carries N, so its wire is blue (${JSON.stringify(w4)})`)
  const w5 = await look('w5')
  check(w5?.color === BROWN, `${scheme}: the reversed Schuko plug's N lead carries L, so its wire is brown (${JSON.stringify(w5)})`)
  const bolts = await page.locator('svg.canvas [data-bolt] path').count()
  check(bolts >= 2, `${scheme}: energized wires have lightning markers (${bolts})`)
  await shot('sheet')

  // A wrong plug: plug-mismatch in the list, red outline while dragging it over the outlet.
  const mm = await messages()
  const ukMismatch = mm.find((m) => m.startsWith('PS1') && m.includes('XS1'))
  check(!!ukMismatch, `${scheme}: the UK charger over the US outlet is a plug mismatch (${ukMismatch ?? `${mm.length} other findings`})`)
  const psPin = await pinAt('ps1', '5V')
  // PS1's right half: the leads from XP1 run down its left side.
  const grabPs = await screen(75, 125)
  const underPs = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-part]')?.getAttribute('data-part'), grabPs)
  check(underPs === 'ps1', `${scheme}: the grab point is on PS1's body (${underPs})`)
  await page.mouse.move(grabPs.x, grabPs.y)
  await page.mouse.down()
  await page.mouse.move(grabPs.x + 4, grabPs.y + 6, { steps: 3 })
  await page.mouse.move(grabPs.x, grabPs.y + 10, { steps: 3 })
  await pause()
  const bad = await page.locator('svg.canvas rect.seat-bad').count()
  check(bad === 1, `${scheme}: dragging the wrong plug over the outlet shows a red outline (${bad})`)
  await shot('wrong-plug')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await pause()
  const psPinAfter = await pinAt('ps1', '5V')
  check(near(psPinAfter, psPin), `${scheme}: Escape leaves the wrong plug where it was (${JSON.stringify(psPin)} to ${JSON.stringify(psPinAfter)})`)

  // Clear the lower socket: delete PS1.
  await page.mouse.click(grabPs.x, grabPs.y)
  await page.keyboard.press('Delete')
  await pause(300)
  check((await page.locator('[data-part="ps1"]').count()) === 0, `${scheme}: PS1 is deleted, the lower socket is free`)

  // A matching plug dragged onto the lower socket: three green contacts while dragging, seated on drop.
  const legsBefore = await legs()
  const xp3Before = await pinAt('xp3', 'L')
  const from3 = await screen(230, 425)
  const to3 = await screen(40, 95)
  const under3 = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-part]')?.getAttribute('data-part'), from3)
  check(under3 === 'xp3', `${scheme}: the grab point is on XP3's body (${under3})`)
  await page.mouse.move(from3.x, from3.y)
  await page.mouse.down()
  await page.mouse.move(to3.x, to3.y, { steps: 12 })
  await pause()
  const ok = await page.locator('svg.canvas circle.seat-ok').count()
  const badHoles = await page.locator('svg.canvas .seat-bad').count()
  check(ok === 3 && badHoles === 0, `${scheme}: a US plug over the free US socket shows three green contacts and no red (${ok} green, ${badHoles} red)`)
  await shot('seat')
  await page.mouse.up()
  await pause(300)
  check((await legs()) === legsBefore + 3, `${scheme}: the dropped plug is seated, three more contact dots (${legsBefore} to ${await legs()})`)
  const seatedPin = await pinAt('xp3', 'L')
  await shot('seated-lower')

  // A quarter turn is not an orientation any US plug fits: it unseats and says why (Ruling 40, 41).
  await page.keyboard.press('r')
  await pause(300)
  await page.keyboard.press('Escape')
  await pause()
  check((await legs()) === legsBefore, `${scheme}: a quarter turn unseats the plug (${await legs()} dots)`)
  const turned = (await messages()).find((m) => m.startsWith('XP3') && m.includes('XS1'))
  check(!!turned, `${scheme}: the turned plug is a plug mismatch (${turned ?? 'no XP3 finding'})`)
  await shot('turned')

  // Undo: one step takes back the turn (seated again), one more takes back the drop (XP3 back where it was).
  await page.keyboard.press('Control+z')
  await pause(300)
  check((await legs()) === legsBefore + 3 && near(await pinAt('xp3', 'L'), seatedPin), `${scheme}: one undo takes back the turn, the plug is seated again`)
  // Nothing selected, so the side panel lists the findings.
  await page.keyboard.press('Escape')
  await pause()
  const xp3Findings = (await messages()).filter((m) => m.startsWith('XP3'))
  check((await page.locator('#problems-title').count()) === 1 && xp3Findings.length === 0, `${scheme}: the seated plug has no plug-mismatch finding (${xp3Findings.join(' | ') || 'none'})`)
  await page.keyboard.press('Control+z')
  await pause(300)
  const undoDrop = await pinAt('xp3', 'L')
  check((await legs()) === legsBefore && near(undoDrop, xp3Before), `${scheme}: one more undo takes back the drop as one step, XP3 is back where it was (${await legs()} dots)`)
  check((await page.locator('[data-part="ps1"]').count()) === 0, `${scheme}: the delete before the drag is still in place (the drop was a single undo step)`)

  // A new wire from the reversed Schuko plug's N lead, which carries L, takes brown. W5 is that
  // wire already, so delete it first (click it, Delete) and draw it again: the lamp stays on the
  // plug's L and N, so the sheet gains no short that would blur the colours.
  await page.keyboard.press('Escape')
  const midW5 = await page.evaluate(() => {
    const path = document.querySelector('svg.canvas g[data-wire="w5"] .wire-color')
    const p = path.getPointAtLength(path.getTotalLength() / 2)
    const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM())
    return { x: s.x, y: s.y }
  })
  await page.mouse.click(midW5.x, midW5.y)
  await pause()
  await page.keyboard.press('Delete')
  await pause(300)
  check((await look('w5')) === null, `${scheme}: W5 is deleted`)
  const before2 = await wireUids()
  const lead = await center('[data-pin-part="xp2"][data-pin="N"]')
  const lampL = await center('[data-pin-part="e2"][data-pin="N"]')
  await page.mouse.move(lead.x, lead.y)
  await page.mouse.down()
  await page.mouse.move((lead.x + lampL.x) / 2, (lead.y + lampL.y) / 2 + 40, { steps: 5 })
  await page.mouse.move(lampL.x, lampL.y, { steps: 5 })
  await page.mouse.up()
  await pause(300)
  const newWire = (await wireUids()).find((u) => !before2.includes(u))
  const newLook = newWire ? await look(newWire) : null
  check(newLook?.color === BROWN && newLook.hazard, `${scheme}: a new wire from a lead that carries L on a Schuko outlet is brown (${newWire}: ${JSON.stringify(newLook)})`)
  check((await look('w4'))?.color === BLUE, `${scheme}: the plug's other wire stays blue`)
  await shot('new-wire-brown')

  // Export JSON carries the notice as a sheet note.
  const download = await exportDownload(page)
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  check(Array.isArray(saved.notes) && saved.notes.includes(NOTICE), `${scheme}: exported JSON stores the notice as a sheet note (${JSON.stringify(saved.notes)})`)

  // Print shows the notice.
  await page.emulateMedia({ media: 'print' })
  await pause()
  check(await page.locator('.print-notice').isVisible(), `${scheme}: the notice is on the printed page`)
  check((await page.locator('.print-notice').textContent()) === NOTICE, `${scheme}: the printed notice is verbatim`)
  {
    const n = await page.locator('.print-notice').boundingBox()
    const ed = await page.locator('.editor').boundingBox()
    check(n.y >= ed.y + ed.height, `${scheme}: in print the notice sits below the editor, covering none of it (notice top ${Math.round(n.y)}, editor bottom ${Math.round(ed.y + ed.height)})`)
  }
  {
    const path = join(out, `mains-print-${scheme}.png`)
    await page.screenshot({ path })
    console.log('saved', path)
  }
  await page.emulateMedia({ media: 'screen' })
  await pause()
  check(!(await page.locator('.print-notice').isVisible()), `${scheme}: the print notice is hidden on screen`)

  // A clean mains sheet: the empty state speaks only of drawn connections, and the notice stays.
  await page.locator('input[type=file]').setInputFiles(cleanFile)
  await page.waitForFunction(() => !document.querySelector('[data-part="xp3"]'))
  await pause(400)
  await page.mouse.click(5, 5)
  await pause()
  const title = await page.locator('#problems-title').textContent()
  check(title?.includes('No problems found in the drawn connections.'), `${scheme}: the empty state says no problems found in the drawn connections (${title})`)
  check((await page.locator('.mains-notice').count()) === 1 && (await page.locator('.mains-notice').isVisible()), `${scheme}: the notice stays on a clean mains sheet`)
  check((await page.locator('.mains-badge').count()) === 1, `${scheme}: the badge stays on a clean mains sheet`)
  await panelShot('clean')

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await page.close()
}
await browser.close()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall mains checks passed')
process.exit(0)
