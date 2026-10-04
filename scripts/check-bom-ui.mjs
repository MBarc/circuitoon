// Browser check for the bill of materials and the wire colour convention in the editor. A sheet
// with a blue ground wire and a red signal wire (colours chosen on purpose) shows both colour
// warnings in the Problems list; an old black signal wire with no colorSet raises none. Fixing the
// ground wire to black clears its warning and leaves the new-wire default blue.
// The new-wire style starts blue, so a plain signal wire never reads as power or ground.
// With the new-wire style set to yellow, a wire drawn from a GND pin is drawn black, one from a 5 V
// output red, and a signal wire yellow. The Bill of materials button opens a dialog listing the
// parts grouped with designator ranges, the wires by cable and colour, and Export CSV saves
// <name>-bom.csv through the in-app naming dialog (no Save As dialog) or the browser's Save As
// dialog (stubbed), with the CSV type. Saves light and dark screenshots to .superpowers/bom-*.png.
//
// Usage (after `npm run build`): npm run check:bom-ui -- [--out <dir>] [--shots <dir>] [--port 4197]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, noSavePicker, startPreview, fileItem } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-bom-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4197'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const NAMED = { black: '#2B2F36', red: '#E0483E', yellow: '#F4B400', blue: '#3D6FD6' }
const mod = (id) => JSON.parse(readFileSync(join('modules', `${id}.json`), 'utf8'))
const ids = ['battery-18650-holder', 'esp32-devkit-v1-30', 'resistor', 'led', 'ip5306-usbc-module']
const TITLE = 'Bench: lamp'
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const w = (uid, a, b, color, chosen = true) => {
  const end = (s) => {
    const [part, pin] = s.split('|')
    return { part, pin }
  }
  return { uid, from: end(a), to: end(b), color, gauge: 22, ...(chosen ? { colorSet: true } : {}) }
}
const sheetFile = join(out, 'bom-bench.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify({
  format: 'circuitoon-diagram/1', title: TITLE,
  modules: Object.fromEntries(ids.map((id) => [id, mod(id)])),
  parts: [
    at('bt1', 'BT1', 'battery-18650-holder', 40, 40), at('bt2', 'BT2', 'battery-18650-holder', 40, 200),
    at('u1', 'U1', 'esp32-devkit-v1-30', 240, 40), at('r1', 'R1', 'resistor', 440, 60, { values: { resistance: { value: 330, unit: 'ohm' } } }),
    at('d1', 'D1', 'led', 460, 260), at('u2', 'U2', 'ip5306-usbc-module', 20, 330),
  ],
  // w3 is how every wire drawn before colorSet was stored: black, not chosen on purpose. It is never judged.
  connections: [w('w1', 'bt1|-', 'u1|GND', 'blue'), w('w2', 'u1|D2', 'r1|1', 'red'), w('w3', 'u1|D5', 'r1|2', 'black', false)],
}))

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
  await page.waitForSelector('[data-part="u2"]')
  await page.waitForFunction((t) => document.querySelector('.toolbar .title')?.textContent === t, TITLE)
  await page.waitForTimeout(200)
  return { page, errors }
}
const center = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
/** Clicks halfway along a drawn wire (its bounding box's centre may be off an L-shaped route) to select it. */
async function clickWire(page, uid) {
  const mid = await page.evaluate((uid) => {
    const path = document.querySelector(`svg.canvas g[data-wire="${uid}"] .wire-color`)
    const p = path.getPointAtLength(path.getTotalLength() / 2)
    const svg = path.ownerSVGElement
    const [vx, vy, vw] = svg.getAttribute('viewBox').split(' ').map(Number)
    const box = svg.getBoundingClientRect()
    const k = box.width / vw
    return { x: box.left + (p.x - vx) * k, y: box.top + (p.y - vy) * k }
  }, uid)
  await page.mouse.click(mid.x, mid.y)
  await page.waitForTimeout(200)
}
const stroke = (page, uid) => page.evaluate((uid) => document.querySelector(`svg.canvas g[data-wire="${uid}"] .wire-color`)?.getAttribute('stroke') ?? null, uid)
const wireUids = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('svg.canvas [data-wire]')].map((e) => e.getAttribute('data-wire')))])
/** Draws a wire from one pin tip to another and returns the new wire's uid. */
async function draw(page, from, to) {
  const before = new Set(await wireUids(page))
  const a = await center(page, `[data-pin-part="${from[0]}"][data-pin="${from[1]}"]`)
  const b = await center(page, `[data-pin-part="${to[0]}"][data-pin="${to[1]}"]`)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 30, { steps: 6 })
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  return (await wireUids(page)).find((u) => !before.has(u))
}

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(context)
  const { page, errors } = await open(context)

  // --- Colour warnings in the Problems list. ---
  const problems = page.locator('.inspector')
  check(await problems.getByText('Ground wire not black').isVisible(), `${scheme}: the blue ground wire shows "Ground wire not black"`)
  check(await problems.getByText('Signal wire in a power color').isVisible(), `${scheme}: the red signal wire shows "Signal wire in a power color"`)
  check((await problems.textContent()).includes('set it to black'), `${scheme}: the ground warning says the fix`)
  await page.screenshot({ path: join(shots, `bom-warnings-${scheme}.png`) })

  // --- New wires take their net's role colour; a signal takes the style colour. ---
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).startsWith('New wires: blue for signals (black for ground, red for supply)'), `${scheme}: the new-wire style starts blue for signals`)
  check(!(await problems.textContent()).includes('U1 D5'), `${scheme}: the old black signal wire with no colorSet raises no warning`)
  // Fix the ground wire to black (select it by clicking along it: a warning's Select pans the view).
  await clickWire(page, 'w1')
  await page.locator('.inspector .swatch[title="black"]').click()
  await page.waitForTimeout(200)
  check(!(await problems.getByText('Ground wire not black').count()), `${scheme}: the ground warning is gone once the wire is black`)
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).includes('blue for signals'), `${scheme}: fixing a ground wire to black leaves the new-wire default blue`)
  const blue = await draw(page, ['u1', 'D19'], ['r1', '2'])
  check(!!blue && (await stroke(page, blue)) === NAMED.blue, `${scheme}: the next signal wire comes out blue (${await stroke(page, blue)})`)
  // Recolour the red signal wire yellow: a signal colour, so it becomes the new-wire default.
  await clickWire(page, 'w2')
  await page.locator('.inspector .swatch[title="yellow"]').click()
  await page.waitForTimeout(200)
  check(await stroke(page, 'w2') === NAMED.yellow, `${scheme}: the signal wire is recoloured yellow, which becomes the new-wire style`)
  await page.mouse.click(5, 5)
  check((await page.locator('.inspector .hint', { hasText: 'New wires' }).textContent()).includes('yellow'), `${scheme}: the new-wire style is yellow`)
  const gnd = await draw(page, ['u1', 'GND 2'], ['d1', 'K'])
  check(!!gnd && (await stroke(page, gnd)) === NAMED.black, `${scheme}: a wire from a GND pin is drawn black (${await stroke(page, gnd)})`)
  const five = await draw(page, ['u2', '5V+'], ['u1', 'VIN'])
  check(!!five && (await stroke(page, five)) === NAMED.red, `${scheme}: a wire from the 5 V output is drawn red (${await stroke(page, five)})`)
  const sig = await draw(page, ['u1', 'D4'], ['d1', 'A'])
  check(!!sig && (await stroke(page, sig)) === NAMED.yellow, `${scheme}: a signal wire takes the style colour, yellow (${await stroke(page, sig)})`)
  check(!(await problems.getByText('Signal wire in a power color').count()), `${scheme}: the signal warning is gone once the wire is yellow`)

  // --- The Bill of materials dialog. ---
  await fileItem(page, 'Bill of materials').click()
  const dialog = page.getByRole('dialog', { name: 'Bill of materials' })
  check(await dialog.isVisible(), `${scheme}: Bill of materials opens a dialog`)
  const rows = await dialog.locator('tbody tr').allTextContents()
  check(rows.some((r) => r.startsWith('2') && r.includes('18650 holder (1 cell)') && r.includes('3.7 V') && r.includes('BT1, BT2')), `${scheme}: the two holders are one row, 2 x, BT1, BT2`)
  check(rows.some((r) => r.includes('Resistor (1/4 W)') && r.includes('330') && r.includes('R1')), `${scheme}: the resistor row shows its value`)
  check(rows.some((r) => r.startsWith('1') && r.includes('Hookup wire') && r.includes('red')) && rows.some((r) => r.startsWith('2') && r.includes('Hookup wire') && r.includes('yellow')), `${scheme}: wires are counted by the colour they are drawn in: 1 red, 2 yellow`)
  check(await dialog.getByRole('link', { name: 'Source' }).count() > 0, `${scheme}: a module with a source links to it`)
  await page.screenshot({ path: join(shots, `bom-panel-${scheme}.png`) })

  const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
    await dialog.getByRole('button', { name: 'Export CSV' }).click()
    const naming = page.getByRole('dialog', { name: 'Export CSV' })
    check(await naming.isVisible(), `${scheme}: without a Save As dialog, Export CSV opens the naming dialog`)
    check((await naming.locator('.export-suffix').textContent()) === '-bom.csv', `${scheme}: the naming dialog shows the -bom.csv suffix`)
    check((await naming.getByLabel('File name').inputValue()) === 'Bench- lamp', `${scheme}: the name comes from the export-name logic (${await naming.getByLabel('File name').inputValue()})`)
    await page.screenshot({ path: join(shots, `bom-export-${scheme}.png`) })
    await naming.getByRole('button', { name: 'Export', exact: true }).click()
  })()])
  check(download.suggestedFilename() === 'Bench- lamp-bom.csv', `${scheme}: the CSV downloads as Bench- lamp-bom.csv (${download.suggestedFilename()})`)
  const csv = readFileSync(await download.path(), 'utf8')
  check(csv.startsWith('"Type","Qty","Description","Value","Designators","Category","Source","Notes"\r\n'), `${scheme}: the CSV starts with its quoted header and CRLF`)
  check(csv.includes('"Part","2","18650 holder (1 cell)","3.7 V","BT1, BT2","Batteries"'), `${scheme}: the CSV has the holders row`)
  check(csv.includes('"Part","1","Resistor (1/4 W)","330 ohm","R1"'), `${scheme}: the CSV has the resistor in ASCII units`)
  check(await dialog.isVisible(), `${scheme}: the bill stays open after exporting`)
  await page.keyboard.press('Escape')
  check(!(await page.getByRole('dialog').count()), `${scheme}: Escape closes the bill`)
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()

  // --- With a Save As dialog (stubbed): the CSV type and name, written through the handle. ---
  const picking = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await picking.addInitScript(() => {
    window.__picks = []
    window.__written = []
    window.showSaveFilePicker = async (opts) => {
      window.__picks.push(opts)
      return { name: 'bench-bom.csv', createWritable: async () => ({ write: async (t) => void window.__written.push(t), close: async () => {} }) }
    }
  })
  const p = await open(picking)
  await fileItem(p.page, 'Bill of materials').click()
  await p.page.getByRole('dialog', { name: 'Bill of materials' }).getByRole('button', { name: 'Export CSV' }).click()
  await p.page.waitForFunction(() => window.__written.length === 1)
  const pick = await p.page.evaluate(() => window.__picks[0])
  check(pick.suggestedName === 'Bench- lamp-bom.csv', `${scheme}: the Save As dialog suggests Bench- lamp-bom.csv (${pick.suggestedName})`)
  check(JSON.stringify(pick.types[0].accept) === '{"text/csv":[".csv"]}', `${scheme}: it is given the CSV type (${JSON.stringify(pick.types[0].accept)})`)
  check((await p.page.evaluate(() => window.__written[0])).includes('"18650 holder (1 cell)"'), `${scheme}: the bill is written through the file handle`)
  check((await p.page.getByRole('dialog', { name: 'Export CSV' }).count()) === 0, `${scheme}: no in-app naming dialog with a Save As dialog`)
  check(p.errors.length === 0, `${scheme}: no page errors with the Save As dialog ${p.errors.join('; ')}`)
  await picking.close()
}
await browser.close()
done()
