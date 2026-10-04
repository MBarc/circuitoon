// Browser check for the Light / Dark / System theme switch, in the built app. With the device
// emulated as light: System (the default) shows Light with no data-theme; the landing header's switch
// cycles System, Light, Dark, each applying data-theme, the page colours and theme-color, with an
// accessible label and tooltip naming the mode; a Dark choice survives a reload and is on <html>
// before React mounts (no flash of the light theme); System follows the emulated device both ways and
// the switch's label follows too; a forced Light holds on a dark device; the editor's start screen
// and toolbar carry the same switch. Saves the landing page and the editor (a mains sheet, so the
// notice and badge show) in each mode, System on a dark device.
//
// Usage (after `npm run build`): npm run check:theme-ui -- [--out <dir>] [--port 4216]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-theme-ui')))
const port = Number(flagOf('--port', '4216'))
mkdirSync(out, { recursive: true })

// A small mains sheet: the toolbar badge and the Problems notice have their own dark colours.
const ids = ['outlet-schuko-cee7-3', 'plug-eu-cee7-7', 'lamp-holder-e27']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const sheetFile = join(out, 'theme-mains.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Desk lamp', modules,
  parts: [at('xs1', 'XS1', 'outlet-schuko-cee7-3', 100, 100), at('xp1', 'XP1', 'plug-eu-cee7-7', 100, 100, { mount: { board: 'xs1' } }), at('e1', 'E1', 'lamp-holder-e27', 420, 100)],
  connections: [{ uid: 'm1', from: { part: 'xp1', pin: 'L' }, to: { part: 'e1', pin: 'L' }, gauge: 18, ends: { from: 'stripped', to: 'stripped' } }],
}))

const LIGHT_BG = 'rgb(233, 238, 230)'
const DARK_BG = 'rgb(27, 29, 32)'

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' })
// Records data-theme and the page background when #root is parsed and when React first renders into
// it, so the check can show the theme is in place before anything is drawn.
await context.addInitScript(() => {
  const seen = { parsed: undefined, mounted: undefined }
  window.__themeAt = seen
  const snap = () => ({ theme: document.documentElement.getAttribute('data-theme'), bg: document.body ? getComputedStyle(document.body).backgroundColor : null })
  new MutationObserver((records, obs) => {
    const root = document.getElementById('root')
    if (!root) return
    if (!seen.parsed) seen.parsed = snap()
    if (root.firstChild && !seen.mounted) {
      seen.mounted = snap()
      obs.disconnect()
    }
  }).observe(document, { childList: true, subtree: true })
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const state = () => page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')),
  stored: localStorage.getItem('circuitoon.theme'),
}))
const sw = page.locator('.theme-switch')
const label = () => sw.first().getAttribute('aria-label')
const shot = async (name) => {
  // Off any button, so no hover tint shows.
  await page.mouse.move(5, 895)
  await page.waitForTimeout(250)
  const path = join(out, `theme-${name}.png`)
  await page.screenshot({ path })
  console.log('saved', path)
}

// Landing, device light, nothing chosen: System showing Light.
await page.goto(base, { waitUntil: 'networkidle' })
let s = await state()
check(s.theme === null && s.bg === LIGHT_BG && s.stored === null, `System by default on a light device: no data-theme, light page (${JSON.stringify(s)})`)
check(s.metas.join() === '#E9EEE6,#1B1D20', `theme-color metas keep their per-scheme colours under System (${s.metas})`)
check((await sw.count()) === 1, 'the landing header has one theme switch')
check(/^Theme: System \(Light, follows your device\)\. Switch to Light$/.test(await label()), `its label names the mode and the next one (${await label()})`)
check((await sw.getAttribute('title')) === (await label()), 'its tooltip matches the label')
check(await page.getByRole('button', { name: /^Theme: System/ }).isVisible(), 'it is reachable by role and name')
await shot('landing-system-light-os')

await sw.click()
s = await state()
check(s.theme === 'light' && s.bg === LIGHT_BG && s.stored === 'light' && s.metas.join() === '#E9EEE6,#E9EEE6', `Light applies and is stored (${JSON.stringify(s)})`)
check((await label()) === 'Theme: Light. Switch to Dark', `the label follows (${await label()})`)
await shot('landing-light')

await sw.click()
s = await state()
check(s.theme === 'dark' && s.bg === DARK_BG && s.stored === 'dark' && s.metas.join() === '#1B1D20,#1B1D20', `forced Dark applies on a light device (${JSON.stringify(s)})`)
check((await label()) === 'Theme: Dark. Switch to System', `the label follows (${await label()})`)
const stickerEdge = await page.locator('.sticker').first().evaluate((e) => getComputedStyle(e).borderTopColor)
check(stickerEdge === 'rgb(116, 123, 132)', `the sticker frame takes the card edge in Dark (${stickerEdge})`)
await shot('landing-dark')

// Persistence and no flash.
await page.reload({ waitUntil: 'networkidle' })
s = await state()
check(s.theme === 'dark' && s.bg === DARK_BG, `Dark survives a reload (${JSON.stringify(s)})`)
const at1 = await page.evaluate(() => window.__themeAt)
check(at1.parsed?.theme === 'dark', `data-theme is set when #root is parsed, before the app script runs (${JSON.stringify(at1.parsed)})`)
check(at1.mounted?.theme === 'dark' && at1.mounted?.bg === DARK_BG, `and the page is already dark when React first renders (${JSON.stringify(at1.mounted)})`)

// System follows the device, both ways, and the label with it.
await sw.click()
s = await state()
check(s.theme === null && s.stored === null && s.bg === LIGHT_BG, `System again: attribute and storage cleared, light device shows Light (${JSON.stringify(s)})`)
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(100)
s = await state()
check(s.theme === null && s.bg === DARK_BG, `System follows the device turning dark (${JSON.stringify(s)})`)
check((await label()).startsWith('Theme: System (Dark,'), `the label follows the device (${await label()})`)
await shot('landing-system')
// A forced Light holds on a dark device.
await sw.click()
s = await state()
check(s.theme === 'light' && s.bg === LIGHT_BG, `forced Light holds on a dark device (${JSON.stringify(s)})`)
await sw.click()
await sw.click()
await page.emulateMedia({ colorScheme: 'light' })
await page.waitForTimeout(100)
s = await state()
check(s.theme === null && s.bg === LIGHT_BG, `System follows the device back to light (${JSON.stringify(s)})`)

// The editor: the start screen's switch, then the toolbar's, with a mains sheet open.
async function openEditor() {
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  page.once('dialog', (d) => d.accept())
  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('[data-part="e1"]')
  await page.keyboard.press('Escape')
}
await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
check((await sw.count()) === 1, 'the editor start screen has a theme switch')
await sw.click()
await sw.click()
s = await state()
check(s.theme === 'dark' && s.bg === DARK_BG, `Dark chosen on the start screen (${JSON.stringify(s)})`)
await shot('start-dark')
await openEditor()
const tb = page.locator('.toolbar .theme-switch')
check((await tb.count()) === 1, 'the toolbar has a theme switch')
check((await tb.getAttribute('aria-label')) === 'Theme: Dark. Switch to System', `the toolbar switch shows the same choice (${await tb.getAttribute('aria-label')})`)
const rowOf = (l) => l.evaluate((e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2) })
const [swRow, undoRow] = [await rowOf(tb), await rowOf(page.getByRole('button', { name: 'Undo' }))]
check(Math.abs(swRow - undoRow) <= 2, `the toolbar switch sits on the first row with Undo (${swRow} vs ${undoRow})`)
const badge = await page.locator('.mains-badge').evaluate((e) => getComputedStyle(e).backgroundColor)
check(badge === 'rgb(58, 42, 16)', `the mains badge takes its dark colours (${badge})`)
await shot('editor-dark')
await tb.click()
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(100)
s = await state()
check(s.theme === null && s.bg === DARK_BG, `the toolbar switch goes to System, following the dark device (${JSON.stringify(s)})`)
await shot('editor-system')
await tb.click()
s = await state()
const badgeLight = await page.locator('.mains-badge').evaluate((e) => getComputedStyle(e).backgroundColor)
check(s.theme === 'light' && s.bg === LIGHT_BG && badgeLight === 'rgb(255, 244, 229)', `Light from the toolbar on a dark device, the badge light again (${JSON.stringify(s)}, ${badgeLight})`)
await shot('editor-light')
await page.emulateMedia({ colorScheme: 'light' })
await tb.click()
await tb.click()
s = await state()
check(s.theme === null, 'back to System')

check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
await browser.close()
done()
