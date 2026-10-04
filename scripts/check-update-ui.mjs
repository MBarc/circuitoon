// Browser check for Update parts to current library (Ruling D1). Opens Michael's 1S4P battery-bank
// sheet, whose ESP32, IP5306 and OLED copies predate the library's pin, USB port and I2C data, in the built editor,
// then through the real UI: the Problems list shows each out-of-date part as a warning ("Part data
// out of date") with an Update parts button, and the sheet Inspector offers "Update parts to current
// library"; the row's button updates every such part as one step and reports what changed (the
// warnings and the offer go, the wiring stays); Undo brings them back in one step and hides the
// report; the Inspector's button does the same. A copy whose pins changed is listed as an error
// with no update offered. Saves light and dark screenshots of the offer and of the report.
//
// Usage (after `npm run build`): npm run check:update-ui -- [--out <dir>] [--port 4215]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-update-ui')))
const port = Number(flagOf('--port', '4215'))
mkdirSync(out, { recursive: true })

const bank = JSON.parse(readFileSync('src/format/fixtures/battery-bank-1s4p.circuitoon.json', 'utf8'))
const bankFile = join(out, 'battery-bank-1s4p.circuitoon.json')
writeFileSync(bankFile, JSON.stringify(bank))
// The same sheet with the ESP32's D21 and D22 swapped in its copy: drift that must not be updated.
const swapped = structuredClone(bank)
{
  const pins = swapped.modules['esp32-devkit-v1-30'].pins
  const [a, b] = [pins.find((p) => p.name === 'D21'), pins.find((p) => p.name === 'D22')]
  ;[a.name, b.name] = ['D22', 'D21']
}
const swappedFile = join(out, 'battery-bank-swapped.circuitoon.json')
writeFileSync(swappedFile, JSON.stringify(swapped))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 200) => page.waitForTimeout(ms)
  const saved = async (locator, name) => {
    await locator.screenshot({ path: join(out, `${name}-${scheme}.png`) })
    console.log('saved', join(out, `${name}-${scheme}.png`))
  }
  const driftRows = page.locator('.problems li').filter({ hasText: 'Part data out of date' })
  const rowButtons = page.locator('[data-update-parts]')
  const offer = page.getByRole('button', { name: 'Update parts to current library', exact: true }).and(page.locator('[data-update-parts-sheet]'))
  const report = page.locator('#update-parts-report')
  /** Every drawn wire's uid and path, to show the wiring is unchanged. */
  const wiring = () => page.evaluate(() => [...document.querySelectorAll('[data-wire]')].map((w) => `${w.getAttribute('data-wire')}:${[...w.querySelectorAll('path')].map((p) => p.getAttribute('d')).join(' ')}`).sort().join(' | '))

  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await page.locator('input[type=file]').setInputFiles(bankFile)
  await page.waitForSelector('[data-part="p7"]')
  await pause(400)

  // The offer: one warning per out-of-date part, each with its button, and the sheet's own.
  check((await driftRows.count()) === 3, `${scheme}: the Problems list has a warning per out-of-date part (${await driftRows.count()})`)
  check((await driftRows.evaluateAll((els) => els.every((e) => e.className === 'warning'))), `${scheme}: they are warnings`)
  check((await rowButtons.count()) === 3, `${scheme}: each has an Update parts button`)
  check((await rowButtons.first().getAttribute('aria-label')) === 'Update parts to current library', `${scheme}: the row button is named Update parts to current library`)
  check((await offer.count()) === 1 && (await offer.isVisible()), `${scheme}: the sheet Inspector offers Update parts to current library`)
  const wiresBefore = await wiring()
  await saved(page.locator('.inspector'), 'update-offer')
  await saved(driftRows.first(), 'update-row')

  // The row's button: every part updated in one step, reported.
  await rowButtons.first().click()
  await pause(400)
  check((await report.isVisible()) && (await report.getAttribute('role')) === 'status', `${scheme}: a report says what changed`)
  const lines = await report.locator('li').allTextContents()
  check(lines.some((l) => /^Updated U\d+ \(esp32-devkit-v1-30\): USB port USB, pins .* \(pin data\)\.$/.test(l)), `${scheme}: the report names the ESP32 and its new pin data (${lines.join(' | ')})`)
  check(lines.some((l) => l.includes('(oled-ssd1306-096-i2c)') && l.includes('I2C data')), `${scheme}: the report names the OLED and its I2C data`)
  check((await driftRows.count()) === 0 && (await offer.count()) === 0, `${scheme}: the warnings and the offer are gone`)
  check((await wiring()) === wiresBefore, `${scheme}: the wiring is as drawn`)
  check(await page.evaluate(() => document.activeElement?.id === 'update-parts-report'), `${scheme}: focus moves to the report`)
  await saved(page.locator('.inspector'), 'update-report')

  // Undo: one step back, the report hides.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await pause(400)
  check((await driftRows.count()) === 3 && (await offer.count()) === 1, `${scheme}: one Undo brings the old copies back`)
  check((await report.count()) === 0, `${scheme}: and hides the report`)

  // The Inspector's button does the same.
  await offer.click()
  await pause(400)
  check((await report.isVisible()) && (await driftRows.count()) === 0, `${scheme}: the Inspector's button updates the parts too`)

  // A copy whose pins changed: an error, with no update offered for it.
  await page.locator('input[type=file]').setInputFiles(swappedFile)
  await page.waitForSelector('[data-part="p7"]')
  await pause(400)
  const errorRow = page.locator('.problems li.error').filter({ hasText: 'Part data out of date' })
  check((await errorRow.count()) === 1 && (await errorRow.locator('[data-update-parts]').count()) === 0, `${scheme}: a part whose pins changed is an error with no update button`)
  check((await errorRow.locator('.problem-message').textContent())?.includes('place it again from the Parts panel'), `${scheme}: it says to place the part again`)
  await offer.click()
  await pause(400)
  const swappedLines = await report.locator('li').allTextContents()
  check(swappedLines.some((l) => l.startsWith('Left ') && l.includes('(esp32-devkit-v1-30)')), `${scheme}: the update leaves that part alone and says so (${swappedLines.join(' | ')})`)
  check((await errorRow.count()) === 1, `${scheme}: its error stays`)

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await page.close()
}
await browser.close()
console.log(`screenshots in ${out}`)
done()
