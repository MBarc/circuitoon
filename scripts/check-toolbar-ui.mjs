// Browser check for the editor toolbar. At 1400 px wide it stays one row with the Problems badge
// showing (the sheet does not move down when the badge appears). The File menu is a button with
// aria-haspopup="menu" holding New sheet, Import JSON, Export JSON, Export KiCad and Bill of
// materials; ArrowDown opens it on the first item, arrows and Home/End move, Escape closes and
// returns focus to the button, a click outside closes it. Saves light and dark screenshots of the
// toolbar with the menu closed and open to --shots (default .superpowers/toolbar-*.png).
//
// Usage (after `npm run build`): npm run check:toolbar-ui -- [--out <dir>] [--shots <dir>] [--port 4210]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-toolbar-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4210'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

// A sensor wired to a board by one data line, with no power or shared ground: warnings, so the badge shows.
const modules = Object.fromEntries(['esp32-devkitc-v4', 'bme280-module-6pin'].map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const file = join(out, 'badge.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Toolbar check with a rather long sheet title', modules,
  parts: [
    { uid: 'u1', designator: 'U1', module: 'esp32-devkitc-v4', x: 0, y: 0, rotation: 0 },
    { uid: 'u3', designator: 'U3', module: 'bme280-module-6pin', x: 300, y: 60, rotation: 0 },
  ],
  connections: [{ uid: 'w1', from: { part: 'u3', pin: 'SCL' }, to: { part: 'u1', pin: 'IO22' }, color: 'yellow' }],
}))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('.editor')
  const badge = page.locator('.problems-badge')
  await badge.waitFor()
  const bar = page.locator('.toolbar')
  const menuButton = page.getByRole('button', { name: 'File', exact: true })
  const items = page.getByRole('menuitem')

  // One row: every direct child sits at the same top (within the tools' height), and the toolbar is one tool tall.
  const rows = await bar.evaluate((el) => {
    const tops = [...el.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => Math.round(c.getBoundingClientRect().top))
    return { distinct: new Set(tops).size, height: Math.round(el.getBoundingClientRect().height), sheetTop: Math.round(document.querySelector('.canvas-wrap').getBoundingClientRect().top) }
  })
  check(rows.height < 60 && rows.sheetTop === rows.height, `${scheme}: the toolbar is one row (${rows.height} px) at 1400 px with the Problems badge showing, the sheet just under it`)
  check(await badge.isVisible(), `${scheme}: the Problems badge shows`)
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check(scrolls, `${scheme}: no horizontal overflow`)

  // The menu: closed, then open.
  check((await menuButton.getAttribute('aria-haspopup')) === 'menu' && (await menuButton.getAttribute('aria-expanded')) === 'false' && (await items.count()) === 0, `${scheme}: File is a menu button, closed`)
  await bar.screenshot({ path: join(shots, `toolbar-closed-${scheme}.png`) })
  await menuButton.click()
  const labels = await items.allTextContents()
  check(JSON.stringify(labels) === JSON.stringify(['New sheet', 'Import JSON', 'Export JSON', 'Export KiCad', 'Bill of materials']), `${scheme}: the menu lists the file actions (${labels.join(', ')})`)
  check((await menuButton.getAttribute('aria-expanded')) === 'true', `${scheme}: aria-expanded is true while open`)
  const focused = () => page.evaluate(() => document.activeElement?.textContent ?? '')
  check((await focused()) === 'New sheet', `${scheme}: opening focuses the first item`)
  await page.screenshot({ path: join(shots, `toolbar-open-${scheme}.png`), clip: { x: 0, y: 0, width: 1400, height: 300 } })
  await page.keyboard.press('ArrowDown')
  check((await focused()) === 'Import JSON', `${scheme}: ArrowDown moves to the next item`)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  check((await focused()) === 'Bill of materials', `${scheme}: ArrowUp from the first item wraps to the last`)
  await page.keyboard.press('Home')
  check((await focused()) === 'New sheet', `${scheme}: Home goes to the first item`)
  await page.keyboard.press('End')
  check((await focused()) === 'Bill of materials', `${scheme}: End goes to the last item`)
  await page.keyboard.press('Escape')
  check((await items.count()) === 0 && (await focused()) === 'File', `${scheme}: Escape closes the menu and returns focus to File`)
  await menuButton.focus()
  await page.keyboard.press('ArrowDown')
  check((await items.count()) === 5 && (await focused()) === 'New sheet', `${scheme}: ArrowDown on the button opens the menu`)
  await page.mouse.click(700, 600)
  check((await items.count()) === 0, `${scheme}: a click outside closes the menu`)
  await page.keyboard.press('Escape')
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()
}
await browser.close()
done()
