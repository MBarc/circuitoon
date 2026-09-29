// Browser check for naming the exported file. Where the browser has a Save As dialog of its own
// (showSaveFilePicker, stubbed here), Export JSON uses it: the suggested name comes from the title,
// the .circuitoon.json type is passed, the file is written through the handle, the chosen name is
// offered next time, and a cancel saves nothing and says nothing. Without it (removed from the
// page), Export JSON opens the editor's naming dialog: the base name is prefilled from the title,
// focused and selected, with the fixed suffix after it; Enter exports under the cleaned name,
// which is offered next time; Cancel and Escape save nothing; the sheet title never changes; a new
// sheet starts from its own title again. Saves light and dark screenshots of the dialog.
//
// Usage (after `npm run build`): npm run check:export-ui -- [--out <dir>] [--shots <dir>] [--port 4196]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-export-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4196'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const TITLE = 'Night light: v2'
const sheetFile = join(out, 'night-light.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify({ format: 'circuitoon-diagram/1', title: TITLE, modules: {}, parts: [], connections: [] }))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

async function open(context) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('.editor')
  await page.waitForFunction((t) => document.querySelector('.toolbar .title')?.textContent === t, TITLE)
  return { page, errors }
}
/** Whether a download starts within `ms`. */
const downloads = (page, ms = 800) => page.waitForEvent('download', { timeout: ms }).then(() => true, () => false)

for (const scheme of ['light', 'dark']) {
  // --- Without a Save As dialog: the editor's own naming dialog. ---
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(context)
  const { page, errors } = await open(context)
  const exportButton = page.getByRole('button', { name: 'Export JSON' })
  const dialog = page.getByRole('dialog', { name: 'Export JSON' })
  const field = dialog.getByLabel('File name')

  await exportButton.click()
  check(await dialog.isVisible(), `${scheme}: Export JSON opens the naming dialog`)
  check((await field.inputValue()) === 'Night light- v2', `${scheme}: the name is prefilled from the title, made safe (${await field.inputValue()})`)
  const focus = await field.evaluate((el) => ({ focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd, length: el.value.length }))
  check(focus.focused && focus.start === 0 && focus.end === focus.length, `${scheme}: the field has focus with the whole name selected (${JSON.stringify(focus)})`)
  check((await dialog.locator('.export-suffix').textContent()) === '.circuitoon.json', `${scheme}: the .circuitoon.json suffix shows after the field`)
  await page.screenshot({ path: join(shots, `export-dialog-${scheme}.png`) })

  await field.fill(' bench/copy?  ')
  check((await dialog.locator('.export-note').textContent()) === 'Saves as benchcopy.circuitoon.json', `${scheme}: the dialog shows the cleaned name before saving`)
  await page.screenshot({ path: join(shots, `export-dialog-cleaned-${scheme}.png`) })
  const [download] = await Promise.all([page.waitForEvent('download'), field.press('Enter')])
  check(download.suggestedFilename() === 'benchcopy.circuitoon.json', `${scheme}: Enter exports as benchcopy.circuitoon.json (${download.suggestedFilename()})`)
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  check(saved.title === TITLE, `${scheme}: the saved sheet keeps its title (${saved.title})`)
  check((await dialog.count()) === 0, `${scheme}: the dialog closes after exporting`)
  check((await page.locator('.toolbar .title').textContent()) === TITLE, `${scheme}: naming the file does not rename the sheet`)

  await exportButton.click()
  check((await field.inputValue()) === 'benchcopy', `${scheme}: the next export offers the name chosen last (${await field.inputValue()})`)
  const cancelled = downloads(page)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  check(!(await cancelled) && (await dialog.count()) === 0, `${scheme}: Cancel closes the dialog and saves nothing`)

  await exportButton.click()
  const escaped = downloads(page)
  await page.keyboard.press('Escape')
  check(!(await escaped) && (await dialog.count()) === 0, `${scheme}: Escape closes the dialog and saves nothing`)

  await exportButton.click()
  await field.fill('***')
  const [empty] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export', exact: true }).click()])
  check(empty.suggestedFilename() === 'circuitoon.circuitoon.json', `${scheme}: a name with nothing usable left saves as circuitoon.circuitoon.json (${empty.suggestedFilename()})`)

  await page.getByRole('button', { name: 'New sheet' }).click()
  await exportButton.click()
  check((await field.inputValue()) === 'Untitled sheet', `${scheme}: a new sheet starts from its own title again (${await field.inputValue()})`)
  await page.keyboard.press('Escape')
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()

  // --- With a Save As dialog (stubbed): the browser's own dialog, no in-app dialog. ---
  const picking = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await picking.addInitScript(() => {
    window.__picks = []
    window.__written = []
    window.__abort = false
    window.showSaveFilePicker = async (opts) => {
      window.__picks.push(opts)
      if (window.__abort) throw new DOMException('The user aborted a request.', 'AbortError')
      return { name: 'picked.circuitoon.json', createWritable: async () => ({ write: async (t) => void window.__written.push(t), close: async () => {} }) }
    }
  })
  const p = await open(picking)
  const pb = p.page.getByRole('button', { name: 'Export JSON' })
  const noDownload = downloads(p.page)
  await pb.click()
  await p.page.waitForFunction(() => window.__written.length === 1)
  const picks = await p.page.evaluate(() => window.__picks)
  const written = JSON.parse(await p.page.evaluate(() => window.__written[0]))
  check(picks[0]?.suggestedName === 'Night light- v2.circuitoon.json', `${scheme}: the Save As dialog suggests the name from the title (${picks[0]?.suggestedName})`)
  check(JSON.stringify(picks[0]?.types?.[0]?.accept) === '{"application/json":[".circuitoon.json"]}', `${scheme}: it is given the .circuitoon.json type (${JSON.stringify(picks[0]?.types)})`)
  check(written.title === TITLE && written.format === 'circuitoon-diagram/1', `${scheme}: the sheet is written through the file handle`)
  check(!(await noDownload) && (await p.page.getByRole('dialog').count()) === 0, `${scheme}: with a Save As dialog there is no in-app dialog and no download`)
  await pb.click()
  await p.page.waitForFunction(() => window.__picks.length === 2)
  check((await p.page.evaluate(() => window.__picks[1].suggestedName)) === 'picked.circuitoon.json', `${scheme}: the next Save As suggests the name chosen last`)
  await p.page.evaluate(() => (window.__abort = true))
  const aborted = downloads(p.page)
  await pb.click()
  await p.page.waitForFunction(() => window.__picks.length === 3)
  check(!(await aborted) && (await p.page.getByRole('dialog').count()) === 0 && (await p.page.locator('.toolbar .message.error').count()) === 0 && (await p.page.evaluate(() => window.__written.length)) === 2,
    `${scheme}: cancelling the Save As dialog saves nothing and shows no error`)
  check(p.errors.length === 0, `${scheme}: no page errors with the Save As dialog ${p.errors.join('; ')}`)
  await picking.close()
}
await browser.close()
done()
