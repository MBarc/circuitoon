// Browser check for the toolbar's Export KiCad. Without a Save As dialog of its own (removed from
// the page), it opens the editor's naming dialog titled "Export KiCad netlist", the base name
// prefilled from the sheet title with the fixed .net suffix after it; Enter downloads <name>.net,
// a KiCad netlist the strict reader accepts (the battery-bank sheet: its ESP32 as two socket strips,
// the breadboards left out), and a notice says what was saved; the chosen name is offered next time.
// With a Save As dialog (stubbed), the dialog suggests <title>.net with the .net type and the file is
// written through the handle. A sheet with a part that has no KiCad footprint (an L298N) says to check
// it in KiCad. Saves light and dark screenshots of the dialog and the notices.
//
// Usage (after `npm run build`): npm run check:kicad-ui -- [--out <dir>] [--shots <dir>] [--port 4199]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, noSavePicker, startPreview, fileItem } from './lib/browser-check.mjs'
import { checkKicadNetlist } from '../src/format/sexpr.testing.ts'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-kicad-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4199'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const TITLE = 'Battery bank'
const bank = JSON.parse(readFileSync('src/format/fixtures/battery-bank-1s4p.circuitoon.json', 'utf8'))
const bankFile = join(out, 'bank.circuitoon.json')
writeFileSync(bankFile, JSON.stringify({ ...bank, title: TITLE }))
const l298n = JSON.parse(readFileSync('modules/l298n-module.json', 'utf8'))
const resistor = JSON.parse(readFileSync('modules/resistor.json', 'utf8'))
const motorFile = join(out, 'motor.circuitoon.json')
writeFileSync(motorFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Motor', modules: { 'l298n-module': l298n, resistor },
  parts: [{ uid: 'u', designator: 'U1', module: 'l298n-module', x: 100, y: 100 }, { uid: 'r', designator: 'R1', module: 'resistor', x: 400, y: 100 }],
  connections: [{ uid: 'w', from: { part: 'u', pin: 'ENA' }, to: { part: 'r', pin: '1' } }],
}))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

async function open(context, file, title) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('.editor')
  await page.waitForFunction((t) => document.querySelector('.toolbar .title')?.textContent === t, title)
  return { page, errors }
}

for (const scheme of ['light', 'dark']) {
  // --- Without a Save As dialog: the editor's naming dialog, then a download. ---
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(context)
  const { page, errors } = await open(context, bankFile, TITLE)
  const button = fileItem(page, 'Export KiCad')
  const dialog = page.getByRole('dialog', { name: 'Export KiCad netlist' })
  const field = dialog.getByLabel('File name')
  await button.click()
  check(await dialog.isVisible(), `${scheme}: Export KiCad opens the naming dialog`)
  check((await field.inputValue()) === TITLE, `${scheme}: the name is prefilled from the title (${await field.inputValue()})`)
  check((await dialog.locator('.export-suffix').textContent()) === '.net', `${scheme}: the .net suffix shows after the field`)
  await page.screenshot({ path: join(shots, `kicad-dialog-${scheme}.png`) })
  await field.fill('spirit board')
  const [download] = await Promise.all([page.waitForEvent('download'), field.press('Enter')])
  check(download.suggestedFilename() === 'spirit board.net', `${scheme}: Enter downloads spirit board.net (${download.suggestedFilename()})`)
  const text = readFileSync(await download.path(), 'utf8')
  let parsed = null
  try {
    parsed = checkKicadNetlist(text)
  } catch (e) {
    check(false, `${scheme}: the file is a KiCad netlist (${e.message})`)
  }
  if (parsed) {
    const refs = parsed.comps.map((c) => c.ref)
    check(refs.includes('U2A') && refs.includes('U2B'), `${scheme}: the ESP32 comes in as two socket strips, U2A and U2B`)
    check(!refs.some((r) => /Breadboard/.test(r)), `${scheme}: the breadboards are left out (${refs.join(' ')})`)
    check(parsed.nets.some((n) => n.name === 'GND' && n.nodes.length > 5), `${scheme}: the GND net joins its pins through the breadboard rails`)
  }
  const notice = page.locator('.toolbar .kicad-notice')
  check((await notice.locator('strong').textContent()) === 'Saved spirit board.net' && (await notice.locator('.kn-head span').textContent()).startsWith(`${parsed?.comps.length} footprints, ${parsed?.nets.length} nets.`), `${scheme}: a notice says what was saved (${await notice.textContent()})`)
  check(!(await notice.getAttribute('class')).includes('attention') && (await notice.locator('.kn-list li').allTextContents()).some((t) => t.startsWith('U2: Each header is its own socket strip')), `${scheme}: with nothing to fix it stays green and lists the notes (the ESP32's socket strips)`)
  await page.screenshot({ path: join(shots, `kicad-saved-${scheme}.png`) })
  await button.click()
  check((await field.inputValue()) === 'spirit board', `${scheme}: the next export offers the name chosen last (${await field.inputValue()})`)
  await page.keyboard.press('Escape')
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  check((await notice.count()) === 0, `${scheme}: Dismiss puts the notice away`)
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()

  // --- A part without a KiCad footprint: the notice says to check it in KiCad. ---
  const mctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(mctx)
  const m = await open(mctx, motorFile, 'Motor')
  await fileItem(m.page, 'Export KiCad').click()
  const [md] = await Promise.all([m.page.waitForEvent('download'), m.page.getByRole('dialog', { name: 'Export KiCad netlist' }).getByRole('button', { name: 'Export', exact: true }).click()])
  check(md.suggestedFilename() === 'Motor.net', `${scheme}: the motor sheet downloads Motor.net`)
  const mnotice = m.page.locator('.toolbar .kicad-notice')
  const mitems = await mnotice.locator('.kn-list li').allTextContents()
  check((await mnotice.getAttribute('class')).includes('attention') && (await mnotice.locator('.kn-check').textContent()) === 'Check in KiCad:' && mitems[0]?.startsWith('U1 (l298n-module): no KiCad footprint is known'), `${scheme}: the notice turns yellow and names the part without a footprint (${mitems.join(' | ')})`)
  check((await mnotice.locator('.kn-head span').textContent()).startsWith('2 footprints, 1 net.'), `${scheme}: counts read 2 footprints, 1 net`)
  await m.page.screenshot({ path: join(shots, `kicad-unmapped-${scheme}.png`) })
  check(m.errors.length === 0, `${scheme}: no page errors ${m.errors.join('; ')}`)
  await mctx.close()

  // --- With a Save As dialog (stubbed). ---
  const picking = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  await picking.addInitScript(() => {
    window.__picks = []
    window.__written = []
    window.showSaveFilePicker = async (opts) => {
      window.__picks.push(opts)
      return { name: 'picked.net', createWritable: async () => ({ write: async (t) => void window.__written.push(t), close: async () => {} }) }
    }
  })
  const p = await open(picking, bankFile, TITLE)
  await fileItem(p.page, 'Export KiCad').click()
  await p.page.waitForFunction(() => window.__written.length === 1)
  const picks = await p.page.evaluate(() => window.__picks)
  check(picks[0]?.suggestedName === `${TITLE}.net`, `${scheme}: the Save As dialog suggests ${TITLE}.net (${picks[0]?.suggestedName})`)
  check(JSON.stringify(picks[0]?.types?.[0]?.accept) === '{"text/plain":[".net"]}', `${scheme}: it is given the .net type (${JSON.stringify(picks[0]?.types)})`)
  check((await p.page.evaluate(() => window.__written[0])).startsWith('(export (version "E")'), `${scheme}: the netlist is written through the file handle`)
  check((await p.page.getByRole('dialog').count()) === 0, `${scheme}: no in-app dialog with a Save As dialog`)
  check((await p.page.locator('.toolbar .kicad-notice strong').textContent()) === 'Saved picked.net', `${scheme}: the notice names the picked file`)
  check(p.errors.length === 0, `${scheme}: no page errors with the Save As dialog ${p.errors.join('; ')}`)
  await picking.close()
}
await browser.close()
done()
