// Browser check for USB (docs/superpowers/specs/2026-10-04-usb-design.md), in the built app. Three
// sheets through the real UI:
//   1. A Raspberry Pi 4 and an ESP32 DevKit V1: a wire drawn by mouse from the ESP32's micro-B port
//      to the Pi's first USB 2.0 port becomes an A to micro-B cable in a black jacket, with USB plug
//      ends drawn on it; the Inspector says it is a USB cable; the Problems list notes the unknown
//      draw and has no error; a jumper from a GPIO to a USB port is the usb-to-pin error.
//   2. A hub tree: a computer's port feeding the generic hub with no DC adapter (bus-powered) and two
//      RTL-SDRs plugged into it: both bus-powered-hub warnings and the over-budget warning on the
//      computer's port are listed.
//   3. An RTL-SDR plugged straight into the Pi 4: drawn as a dotted plug-in link with no cable ends,
//      the Inspector says it plugs straight in, and the bill of materials buys no wire for it.
// Every USB port draws its socket or plug glyph. Screenshots of each sheet in light and dark go to
// --out (default .superpowers/, as usb-<name>-<scheme>.png).
//
// Usage (from the repo root, after `npm run build`):
//   npm run check:usb-ui -- [--out <dir>] [--port 4211]
//
// Starts `vite preview` on --port and stops it afterwards, drives the locally installed Chrome
// through playwright-core (never the shared Playwright MCP browser), and exits 1 on any failed
// check or page error.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, fileItem, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers'))
const port = Number(flagOf('--port', '4211'))
mkdirSync(out, { recursive: true })

const ids = ['rpi-4-model-b', 'esp32-devkit-v1-30', 'rtl-sdr-blog-v4', 'computer-usb-port', 'usb-hub-powered-4port']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, rotation = 0) => ({ uid, designator, module, x, y, rotation })
const sheetFile = (name, title, parts, connections) => {
  const file = join(out, `usb-${name}.circuitoon.json`)
  const used = new Set(parts.map((p) => p.module))
  writeFileSync(file, JSON.stringify({ format: 'circuitoon-diagram/1', title, modules: Object.fromEntries(Object.entries(modules).filter(([id]) => used.has(id))), parts, connections }))
  return file
}
// The ESP32 stands left of the Pi with its micro USB at the bottom; the Pi's USB 2.0 ports face right.
const cableFile = sheetFile('cable', 'ESP32 on a Pi 4 by USB', [at('u1', 'U1', 'rpi-4-model-b', 300, 60), at('u2', 'U2', 'esp32-devkit-v1-30', 60, 60)], [])
const hubFile = sheetFile('hub', 'Bus-powered hub tree', [
  at('j1', 'J1', 'computer-usb-port', 40, 100), at('h1', 'H1', 'usb-hub-powered-4port', 300, 60),
  at('u1', 'U1', 'rtl-sdr-blog-v4', 520, 70), at('u2', 'U2', 'rtl-sdr-blog-v4', 520, 160),
], [
  { uid: 'w1', from: { part: 'j1', pin: 'USB' }, to: { part: 'h1', pin: 'UP' }, color: 'black', gauge: 22, ends: { from: 'usb-a', to: 'usb-b' } },
  { uid: 'w2', from: { part: 'h1', pin: 'P1' }, to: { part: 'u1', pin: 'USB' }, color: 'black', gauge: 22 },
  { uid: 'w3', from: { part: 'h1', pin: 'P2' }, to: { part: 'u2', pin: 'USB' }, color: 'black', gauge: 22 },
])
// The dongle's plug faces the Pi's USB 3.0 port across a short gap, as if just pushed in.
const plugFile = sheetFile('plugged', 'RTL-SDR in a Pi 4', [at('u1', 'U1', 'rpi-4-model-b', 60, 60), at('u2', 'U2', 'rtl-sdr-blog-v4', 430, 140)], [
  { uid: 'w1', from: { part: 'u1', pin: 'USB3-1' }, to: { part: 'u2', pin: 'USB' }, color: 'black', gauge: 22 },
])

// A jumper from the Pi's GPIO14 to the ESP32's USB port: the usb-to-pin error.
const pinsFile = sheetFile('pins', 'USB on jumper wires', [at('u1', 'U1', 'rpi-4-model-b', 300, 60), at('u2', 'U2', 'esp32-devkit-v1-30', 60, 60)], [
  { uid: 'w1', from: { part: 'u1', pin: 'GPIO14' }, to: { part: 'u2', pin: 'USB' }, color: 'blue', gauge: 22 },
])

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 200) => page.waitForTimeout(ms)
  const canvas = page.locator('svg.canvas')
  const shot = async (name) => {
    const path = join(out, `usb-${name}-${scheme}.png`)
    await page.screenshot({ path })
    console.log('saved', path)
  }
  /** Screen position of a world point, from the canvas viewBox. */
  const screen = (x, y) =>
    canvas.evaluate((svg, [x, y]) => {
      const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number)
      const r = svg.getBoundingClientRect()
      const s = r.width / vw
      return { x: r.left + (x - vx) * s, y: r.top + (y - vy) * s }
    }, [x, y])
  /** The centre of a pin's hit target (`[data-pin-part][data-pin]`), on screen. */
  const pinAt = async (uid, pin) => {
    const b = await page.locator(`[data-pin-part="${uid}"][data-pin="${pin}"]`).first().boundingBox()
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
  }
  /** Clicks halfway along a drawn wire to select it. */
  const clickWire = async (uid) => {
    const mid = await page.evaluate((uid) => {
      const path = document.querySelector(`svg.canvas g[data-wire="${uid}"] path`)
      const p = path.getPointAtLength(path.getTotalLength() / 2)
      const svg = path.ownerSVGElement
      const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number)
      const box = svg.getBoundingClientRect()
      const k = box.width / vw
      return { x: box.left + (p.x - vx) * k, y: box.top + (p.y - vy) * k }
    }, uid)
    await page.mouse.click(mid.x, mid.y)
    await pause()
  }
  const load = async (file) => {
    await page.locator('input[type=file]').setInputFiles(file)
    await pause(500)
  }
  // Each row's title, without the severity word before it ("Error: ").
  const problemTitles = async () => (await page.locator('.problem-title').allTextContents()).map((t) => t.replace(/^(Error|Warning|Note): /, ''))
  const problemMessages = () => page.locator('.problem-message').allTextContents()
  const clearSelection = async () => {
    await page.keyboard.press('Escape')
    await pause()
  }

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // ---- 1. Draw a USB cable between the ESP32 and the Pi 4 ----
  await load(cableFile)
  const glyphs = await page.locator('svg.canvas [data-usb-port]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-usb-port')}:${e.getAttribute('data-usb-gender')}`))
  check(glyphs.includes('USB:receptacle') && glyphs.filter((g) => g.endsWith(':receptacle')).length === 6, `${scheme}: every USB port draws its socket glyph (${glyphs.length})`)
  const from = await pinAt('u2', 'USB')
  const to = await pinAt('u1', 'USB2-1')
  check(!!from && !!to, `${scheme}: the ESP32's and the Pi's ports are on screen`)
  if (from && to) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2 + 30, { steps: 6 })
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    await pause(400)
  }
  const kinds = await page.locator('svg.canvas [data-cable-end]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cable-end')).sort())
  check(JSON.stringify(kinds) === '["usb-a","usb-micro-b"]', `${scheme}: the drawn wire is an A to micro-B USB cable (${kinds.join(', ') || 'no ends'})`)
  await clearSelection()
  const titles1 = await problemTitles()
  check(!titles1.some((t) => /USB wired to pins|USB plug does not fit|USB roles clash/.test(t)), `${scheme}: the cable raises no USB error (${titles1.join(' | ')})`)
  check(titles1.includes('USB current not known'), `${scheme}: the unknown ESP32 draw is noted`)
  const wireUid = await page.locator('svg.canvas [data-wire]').first().getAttribute('data-wire')
  await clickWire(wireUid)
  check((await page.locator('[data-usb-link="cable"]').count()) === 1 && (await page.locator('#wire-cable').inputValue()) === 'usb-a-micro-b', `${scheme}: the Inspector shows the USB A to micro-B cable and says it is a USB cable`)
  await shot('cable')
  await clearSelection()

  // A jumper from a GPIO to a USB port is the usb-to-pin error.
  await load(pinsFile)
  const titles0 = await problemTitles()
  check(titles0.includes('USB wired to pins'), `${scheme}: a jumper from GPIO14 to the ESP32's USB port is an error (${titles0.join(' | ')})`)
  await shot('pins')

  // ---- 2. A bus-powered hub tree over budget ----
  await load(hubFile)
  const titles2 = await problemTitles()
  const messages2 = await problemMessages()
  check(titles2.filter((t) => t === 'Bus-powered hub overloaded').length === 2, `${scheme}: both bus-powered hub ports are flagged (${titles2.join(' | ')})`)
  check(messages2.some((m) => /^J1 USB supplies 500 mA, but H1 UP and the devices on its hub draw 540 mA/.test(m)), `${scheme}: the computer's port is over budget`)
  check((await page.locator('svg.canvas [data-plugged]').count()) === 2, `${scheme}: the two dongles are drawn plugged into the hub`)
  await shot('hub')

  // ---- 3. An RTL-SDR plugged straight into the Pi ----
  await load(plugFile)
  check((await page.locator('svg.canvas [data-plugged]').count()) === 1 && (await page.locator('svg.canvas [data-cable-end]').count()) === 0, `${scheme}: the RTL-SDR is drawn plugged in, with no cable ends`)
  check((await page.locator('svg.canvas [data-usb-gender="plug"]').count()) === 1, `${scheme}: the dongle draws a plug glyph`)
  const titles3 = await problemTitles()
  check(!titles3.some((t) => /^USB/.test(t)), `${scheme}: plugging the dongle in raises no USB problem (${titles3.join(' | ')})`)
  const link = await page.locator('svg.canvas [data-plugged]').first().boundingBox()
  if (link) await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2)
  await pause()
  check((await page.locator('[data-usb-link="plugged"]').count()) === 1, `${scheme}: the Inspector says the plug goes straight in`)
  await shot('plugged')
  await clearSelection()
  // The bill of materials buys no wire for a plug-in.
  await fileItem(page, 'Bill of materials').click()
  const dialog = page.getByRole('dialog', { name: 'Bill of materials' })
  const rows = await dialog.locator('tbody tr').allTextContents()
  check(rows.some((r) => r.includes('Raspberry Pi 4 Model B')) && !rows.some((r) => /Hookup wire|cable/i.test(r)), `${scheme}: the bill of materials lists the parts and no wire for the plug-in`)
  await page.keyboard.press('Escape')
  await pause()

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await context.close()
}
await browser.close()
done()
