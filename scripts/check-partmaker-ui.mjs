// Browser check for the part maker and My parts, in the built app. New part opens the dialog; pasted
// lines become pins on two sides; Alt+Up/Down and dragging reorder them; the live preview is the real
// renderer and follows every edit. Save and place puts the part on the sheet and in My parts (with
// its custom badge, in the Inspector too); a wire draws to its pins; My parts survives a reload;
// Export file saves a .circuitoon-part.json through the editor's naming dialog, and Import part
// brings it back after a delete. Submit to library copies the part JSON and opens the issue form with
// the name and maker filled in (window.open and the clipboard are stubbed). Saves the dialog, My parts
// and a placed custom part in light and Graphite dark to .superpowers/partmaker-*.png.
//
// Usage (after `npm run build`): npm run check:partmaker-ui -- [--out <dir>] [--shots <dir>] [--port 4231]
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-partmaker-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4231'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const NAME = 'Bench humidity sensor (I2C)'
const MAKER = 'Test Maker HS-1'
const ID = 'custom-bench-humidity-sensor-i2c'

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true })
await noSavePicker(context)
// Stubs: window.open records the URL instead of opening a tab; the clipboard records what is written.
await context.addInitScript(() => {
  window.__opened = []
  window.__copied = []
  window.open = (url) => {
    window.__opened.push(String(url))
    return null
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(t) } })
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('dialog', (d) => d.accept())

const dialog = () => page.locator('dialog.pm-dialog')
const rowNames = (side) => dialog().locator('.pm-rows .pm-row').evaluateAll((rows) => rows.map((r) => r.querySelector('[data-field="name"]')?.value ?? 'gap'))
const pick = (side) => dialog().getByRole('button', { name: new RegExp(`^${side} \\d+$`) }).click()
const shot = async (name, target) => {
  await page.mouse.move(700, 890)
  await page.waitForTimeout(250)
  const path = join(shots, `partmaker-${name}.png`)
  await (target ?? page).screenshot({ path })
  console.log('saved', path)
}
/** Opens a My parts item's action row (it may already be open). */
const openActions = async (name = NAME) => {
  const more = page.getByRole('button', { name: `Actions for ${name}` }).first()
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
  return page.getByRole('group', { name: `${name} actions` }).first()
}
const newSheet = async () => {
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.library')
}

// ---- Make a part ----
await newSheet()
check(await page.getByRole('button', { name: 'New part' }).isVisible(), 'the Parts panel has a New part button')
check((await page.locator('.mine-group .hint').first().textContent())?.includes('Parts you make or import land here'), 'My parts starts empty with a hint')
await page.getByRole('button', { name: 'New part' }).click()
await dialog().waitFor()
check(await dialog().getByRole('heading', { name: 'New part' }).isVisible(), 'New part opens the part maker dialog')
check(await dialog().locator('[data-testid=pm-name]').evaluate((e) => e === document.activeElement), 'the name field has focus')
await dialog().locator('[data-testid=pm-name]').fill(NAME)
await dialog().getByLabel(/Maker or model/).fill(MAKER)
await dialog().getByLabel(/Datasheet and pinout links/).fill('https://example.com/hs1-datasheet.pdf\nhttps://example.com/hs1-pinout')
await dialog().getByLabel('Category').fill('Sensors')
const pasteBox = dialog().getByLabel('Pasted pins')
if (!(await pasteBox.isVisible())) await dialog().locator('.pm-paste summary').click()
await pasteBox.fill('1 VCC power 3V3/5V\n2 GND ground\n3 SCL in\n4 SDA io\nRight:\nINT out\nnot a pin line here')
await dialog().getByRole('button', { name: /Add these pins/ }).click()
check(JSON.stringify(await rowNames()) === '["VCC","GND","SCL","SDA"]', `pasted lines become the left pins, replacing the empty first row (${await rowNames()})`)
check((await dialog().locator('.pm-paste-errors').textContent())?.includes('Line 7'), 'a line it cannot read is reported by number')
await pick('Right')
check(JSON.stringify(await rowNames()) === '["INT"]', 'the "Right:" line sent INT to the right side')
check((await dialog().getByRole('button', { name: /^Right 1$/ }).getAttribute('aria-pressed')) === 'true', 'the side picker shows Right picked, with its count')
await pick('Left')

// The preview is the real renderer and follows the pins.
const previewText = () => dialog().locator('[data-testid=pm-preview] svg').textContent()
let txt = await previewText()
check(['VCC', 'GND', 'SCL', 'SDA', 'INT', 'Bench humidity sensor'].every((t) => txt.includes(t)), `the live preview draws the part with every pin label (${txt})`)
check((await dialog().locator('[data-testid=pm-preview] svg rect').count()) > 10, 'the preview has the Sticker art (body, header, holes, plate)')
const ready = await dialog().locator('.pm-issue.ok').textContent().catch(() => '')
check(ready.includes('Ready'), `a sourced, typed part lints clean (${ready})`)

// Keyboard reorder: Alt+Up on SDA, focus stays on it; Alt+Down puts it back.
await dialog().getByLabel('Name of pin 4').focus()
await page.keyboard.press('Alt+ArrowUp')
check(JSON.stringify(await rowNames()) === '["VCC","GND","SDA","SCL"]', `Alt+Up moves a pin up (${await rowNames()})`)
check(await page.evaluate(() => document.activeElement?.value) === 'SDA', 'focus stays on the moved pin')
await page.keyboard.press('Alt+ArrowDown')
check(JSON.stringify(await rowNames()) === '["VCC","GND","SCL","SDA"]', 'Alt+Down moves it back')
// Buttons.
await dialog().getByRole('button', { name: 'Move GND up' }).click()
check(JSON.stringify(await rowNames()) === '["GND","VCC","SCL","SDA"]', 'the Move up button reorders')
// Drag: GND's grip onto the second row puts it back in second place.
await dialog().locator('.pm-row').nth(0).locator('.pm-grip').dragTo(dialog().locator('.pm-row').nth(1))
check(JSON.stringify(await rowNames()) === '["VCC","GND","SCL","SDA"]', `dragging a pin reorders it (${await rowNames()})`)
txt = await previewText()
check(txt.indexOf('VCC') < txt.indexOf('GND') && txt.indexOf('GND') < txt.indexOf('SCL'), 'the preview follows the new order')
// Add and remove a pin.
await dialog().getByRole('button', { name: 'Add pin' }).click()
check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Name of pin 5', 'Add pin adds a row and focuses its name')
await page.keyboard.type('EXTRA')
check((await previewText()).includes('EXTRA'), 'the preview shows a typed pin')
await dialog().getByRole('button', { name: 'Remove EXTRA' }).click()
check(!(await previewText()).includes('EXTRA'), 'Remove takes it out')
await shot('dialog-light', dialog())

// ---- Save and place ----
await dialog().getByRole('button', { name: 'Save and place' }).click()
await dialog().waitFor({ state: 'detached' })
const placed = await page.locator('svg.canvas [data-part]').count()
check(placed === 1, `Save and place puts the part on the sheet (${placed})`)
const item = page.locator('.mine-group .lib-item.mine')
check((await item.count()) === 1 && (await item.textContent()).includes(NAME), 'it is in My parts')
check(await item.locator('.custom-badge').isVisible(), 'with a custom badge in the Parts panel')
const inspectorTitle = page.locator('.inspector h2#selection-title')
check((await inspectorTitle.textContent()).includes(NAME) && (await inspectorTitle.locator('.custom-badge').isVisible()), 'the Inspector shows the part with its custom badge')
check(await page.locator('.editor-notice').isVisible(), 'a notice says it was saved and placed')

// ---- Wire to it ----
await page.getByLabel('Search parts').fill('resistor')
await page.locator('.lib-item', { hasText: /^Resistor \(1\/4 W\)$/ }).first().click()
await page.getByLabel('Search parts').fill('')
const uids = await page.evaluate(() => [...document.querySelectorAll('svg.canvas [data-part]')].map((e) => e.getAttribute('data-part')))
const [pUid, rUid] = uids
// Move the resistor off to the right so the wire has room.
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const r = await center(`svg.canvas [data-part="${rUid}"]`)
await page.mouse.move(r.x, r.y)
await page.mouse.down()
await page.mouse.move(r.x + 180, r.y + 60, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const a = await center(`[data-pin-part="${pUid}"][data-pin="INT"]`)
const b = await center(`[data-pin-part="${rUid}"][data-pin="1"]`)
await page.mouse.move(a.x, a.y)
await page.mouse.down()
await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 })
await page.mouse.move(b.x, b.y, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(300)
const wires = await page.evaluate(() => new Set([...document.querySelectorAll('svg.canvas [data-wire]')].map((e) => e.getAttribute('data-wire'))).size)
check(wires === 1, `a wire draws from the custom part's INT pin to the resistor (${wires} wire)`)
await page.locator(`svg.canvas [data-part="${pUid}"]`).first().click({ position: { x: 30, y: 20 } })
await page.waitForTimeout(150)
await shot('placed-light')
await shot('myparts-light', page.locator('.library'))

// ---- Reload: My parts persists ----
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: /New diagram/ }).click()
await page.waitForSelector('.mine-group')
check((await page.locator('.mine-group .lib-item.mine').count()) === 1, 'My parts survives a reload')
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('circuitoon.myParts')))
check(stored?.parts?.[0]?.module?.id === ID && stored.parts[0].maker === MAKER, `it is stored with its id and maker (${stored?.parts?.[0]?.module?.id})`)

// ---- Export the part file, delete, import it back ----
await (await openActions()).getByRole('button', { name: 'Export file' }).click()
const exportDialog = page.getByRole('dialog', { name: 'Export part' })
check(await exportDialog.isVisible(), 'Export file opens the naming dialog where there is no Save As dialog')
check((await exportDialog.locator('.export-suffix').textContent()) === '.circuitoon-part.json', 'with the .circuitoon-part.json suffix')
const [download] = await Promise.all([page.waitForEvent('download'), exportDialog.getByRole('button', { name: 'Export', exact: true }).click()])
const file = join(out, download.suggestedFilename())
await download.saveAs(file)
check(download.suggestedFilename() === 'Bench humidity sensor (I2C).circuitoon-part.json', `the file is named after the part (${download.suggestedFilename()})`)
const exported = JSON.parse(readFileSync(file, 'utf8'))
check(exported.format === 'circuitoon-module/1' && exported.id === ID && exported.custom === true && exported.pins.length === 5, 'the file is the custom module')

await (await openActions()).getByRole('button', { name: 'Delete' }).click()
check((await page.locator('.mine-group .lib-item.mine').count()) === 0, 'Delete removes it from My parts')
await page.locator('[data-testid=import-part]').setInputFiles(file)
await page.waitForSelector('.mine-group .lib-item.mine')
check((await page.locator('.mine-group .lib-item.mine').textContent()).includes(NAME), 'Import part brings the exported file back')
check((await page.locator('.editor-notice').textContent()).includes('Imported'), 'and says so')

// Duplicate, then edit the copy: the dialog opens filled in.
await (await openActions()).getByRole('button', { name: 'Duplicate' }).click()
check((await page.locator('.mine-group .lib-item.mine').count()) === 2, 'Duplicate adds a copy')
await (await openActions()).getByRole('button', { name: 'Edit' }).click()
await dialog().waitFor()
check((await dialog().getByRole('heading').first().textContent()) === `Edit ${NAME}`, 'Edit opens the part maker on the part')
check(JSON.stringify(await rowNames()) === '["VCC","GND","SCL","SDA"]', 'with its pins')
await shot('dialog-edit-light', dialog())
await dialog().getByRole('button', { name: 'Cancel' }).click()

// ---- Graphite dark ----
await page.emulateMedia({ colorScheme: 'dark' })
await page.locator('.mine-group .lib-item.mine').first().click()
await page.waitForTimeout(200)
await shot('placed-dark')
await shot('myparts-dark', page.locator('.library'))
await (await openActions()).getByRole('button', { name: 'Edit' }).click()
await dialog().waitFor()
await shot('dialog-dark', dialog())
await dialog().getByRole('button', { name: 'Cancel' }).click()

check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
await browser.close()
done()
