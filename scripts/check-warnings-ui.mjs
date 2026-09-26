// Browser check for the load-warnings panel: a file that opens with 100 replaced resistor values
// plus a few other warnings must leave the canvas most of the viewport, keep the panel's list
// height-bounded and scrolling, and let Show all -> Show fewer -> Dismiss work. Saves light and
// dark screenshots (collapsed and expanded) so they can be looked at.
//
// Usage (from the repo root, after `npm run build`):
//   npm run check:warnings-ui -- [--out <dir>] [--port 4192]
//   (or node scripts/check-warnings-ui.mjs ...)
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
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-warnings-ui')))
const port = Number(flag('--port', '4192'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

// 100 resistors stored in farads (each dropped with a value warning) and 3 parts whose module is
// not embedded: 103 warnings, 100 of them value replacements.
const VALUES = 100, OTHERS = 3, TOTAL = VALUES + OTHERS
const resistor = JSON.parse(readFileSync('modules/resistor.json', 'utf8'))
const parts = Array.from({ length: VALUES }, (_, i) => ({
  uid: `r${i}`, designator: `R${i + 1}`, module: resistor.id, x: (i % 10) * 90, y: Math.floor(i / 10) * 60, rotation: 0,
  values: { resistance: { value: 220, unit: 'F' } },
}))
for (let i = 0; i < OTHERS; i++) parts.push({ uid: `u${i}`, designator: `U${i + 1}`, module: `missing-module-${i + 1}`, x: i * 90, y: 700, rotation: 0 })
const file = join(out, 'many-warnings.circuitoon.json')
writeFileSync(file, JSON.stringify({ format: 'circuitoon-diagram/1', title: 'Warnings check', modules: { [resistor.id]: resistor }, parts, connections: [] }))

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
  const vh = 900
  const page = await browser.newPage({ viewport: { width: 1400, height: vh }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(file)
  await page.waitForSelector('.load-warnings')

  const panel = page.locator('.load-warnings')
  const list = page.locator('.lw-list')
  const measure = async () => ({
    panel: (await panel.boundingBox()).height,
    canvas: (await page.locator('.canvas-wrap').boundingBox())?.height ?? 0,
    rows: await list.locator('li').count(),
    scroll: await list.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight })),
  })
  /** Scrolls the list to its end and reports whether its last row is then inside the list box. */
  const lastRowReachable = async () => {
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const box = await list.boundingBox()
    const last = await list.locator('li').last().boundingBox()
    return last.y + last.height <= box.y + box.height + 1
  }

  const c = await measure()
  check(c.canvas >= vh * 0.5, `${scheme} collapsed: canvas keeps most of the viewport (${Math.round(c.canvas)} px of ${vh})`)
  check(c.panel <= vh * 0.4, `${scheme} collapsed: panel height bounded (${Math.round(c.panel)} px)`)
  check(c.rows >= VALUES, `${scheme} collapsed: every value replacement is listed (${c.rows} rows)`)
  check(c.scroll.height > c.scroll.client, `${scheme} collapsed: list scrolls (${c.scroll.height} > ${c.scroll.client})`)
  check(await lastRowReachable(), `${scheme} collapsed: last row reachable by scrolling`)
  await list.evaluate((el) => { el.scrollTop = 0 })
  await page.screenshot({ path: join(out, `warnings-${scheme}-collapsed.png`) })

  const showAll = page.getByRole('button', { name: `Show all ${TOTAL}` })
  check((await showAll.count()) === 1, `${scheme}: "Show all ${TOTAL}" offered while ${TOTAL - c.rows} warnings are not shown`)
  if (await showAll.count()) {
    await showAll.click()
    const e = await measure()
    check(e.rows === TOTAL, `${scheme} expanded: all ${TOTAL} warnings listed (${e.rows})`)
    check(e.canvas >= vh * 0.5, `${scheme} expanded: canvas keeps most of the viewport (${Math.round(e.canvas)} px)`)
    check(e.panel <= vh * 0.6, `${scheme} expanded: panel height bounded (${Math.round(e.panel)} px)`)
    check(e.scroll.height > e.scroll.client, `${scheme} expanded: list scrolls`)
    check(await lastRowReachable(), `${scheme} expanded: last row reachable by scrolling`)
    await page.screenshot({ path: join(out, `warnings-${scheme}-expanded.png`) })
    const fewer = page.getByRole('button', { name: 'Show fewer' })
    check((await fewer.count()) === 1, `${scheme}: "Show fewer" offered when expanded`)
    if (await fewer.count()) {
      await fewer.click()
      check((await showAll.count()) === 1 && (await measure()).rows === c.rows, `${scheme}: Show fewer collapses back`)
    }
  }
  await page.getByRole('button', { name: 'Dismiss' }).click()
  check((await panel.count()) === 0, `${scheme}: Dismiss closes the panel`)
  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await page.close()
}
await browser.close()
console.log(`screenshots in ${out}`)
if (failures.length) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all warnings-panel checks passed')
process.exit(0)
