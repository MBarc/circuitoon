// Screenshots built-in parts in the real editor, one image per part, zoomed so pin labels read.
//
// Usage (from the repo root, after `npm run build`):
//   node .claude/skills/circuitoon-add-part/scripts/shoot-parts.mjs <module-id> [more ids...]
//        [--out <dir>] [--port 4190] [--dark] [--panel] [--rotate 90] [--fill 0.55]
//
// For each id it imports a one-part diagram into #/editor, zooms onto the part and saves
// <out>/<id>.png (and <id>-rot<N>.png with --rotate). --panel also saves the Parts panel, filtered by
// the search box to the given ids' names so their group is in view. --fill sets how much of the canvas
// width the part should fill (0.55 default; raise it for tall boards to get larger labels).
// --dark switches the app chrome to dark mode; the sheet paper stays light by design, so the part
// itself should look the same. The designator is always "X1" here; the real prefix comes from
// src/editor/ops.ts and is covered by tests, not by these screenshots.
// It starts `vite preview` on --port and stops it afterwards, drives the locally installed
// Chrome through playwright-core (a devDependency), and prints any page errors; it exits 1 when
// there were any, so a broken part never passes as a clean run.
// Never use the shared Playwright MCP browser for this.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  if (i < 0) return dflt
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const bool = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return false
  args.splice(i, 1)
  return true
}
const out = resolve(flag('--out', join(tmpdir(), 'circuitoon-shots')))
const port = Number(flag('--port', '4190'))
const rotate = Number(flag('--rotate', '0'))
const fill = Number(flag('--fill', '0.55'))
const dark = bool('--dark')
const panel = bool('--panel')
const ids = args
if (!ids.length && !panel) {
  console.error('Give at least one module id (the file name in modules/ without .json), or --panel.')
  process.exit(2)
}
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

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
    const r = await fetch(base)
    if (r.ok) break
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

// The editor asks before discarding unsaved work; accept so each part starts on a fresh sheet.
page.on('dialog', (d) => d.accept())

async function openEditor() {
  // Leave the page first: the same #/editor URL would reuse the open editor instead of the start screen.
  await page.goto('about:blank')
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
}

if (panel) {
  await openEditor()
  // Filter to the first given part's name so its group is on screen.
  if (ids.length && existsSync(join('modules', `${ids[0]}.json`))) {
    const first = JSON.parse(readFileSync(join('modules', `${ids[0]}.json`), 'utf8'))
    const word = String(first.name).split(/[\s(]/)[0]
    await page.getByPlaceholder('Search parts').fill(word)
  }
  await page.locator('.library').screenshot({ path: join(out, 'parts-panel.png') })
  console.log('saved', join(out, 'parts-panel.png'))
}

for (const id of ids) {
  const file = join('modules', `${id}.json`)
  if (!existsSync(file)) {
    console.error(`skip ${id}: ${file} not found`)
    continue
  }
  const m = JSON.parse(readFileSync(file, 'utf8'))
  const diagram = {
    format: 'circuitoon-diagram/1',
    title: m.name,
    modules: { [m.id]: m },
    parts: [{ uid: 'p1', designator: 'X1', module: m.id, x: 0, y: 0, rotation: rotate || 0 }],
    connections: [],
  }
  const tmp = join(out, `${id}.circuitoon.json`)
  writeFileSync(tmp, JSON.stringify(diagram))
  await openEditor()
  await page.locator('input[type=file]').setInputFiles(tmp)
  await page.waitForSelector('[data-part]')
  const wrap = await page.locator('.canvas-wrap').boundingBox()
  for (let step = 0; step < 40; step++) {
    const b = await page.locator('[data-part]').first().boundingBox()
    if (!b || !wrap) break
    const fits = b.width < wrap.width * fill && b.height < wrap.height * 0.85
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    await page.mouse.move(cx, cy)
    if (fits && b.height < wrap.height * 0.6 && b.width < wrap.width * (fill - 0.15)) await page.mouse.wheel(0, -120)
    else if (!fits) await page.mouse.wheel(0, 120)
    else break
    await page.waitForTimeout(30)
  }
  // Center the part by panning the paper.
  const b = await page.locator('[data-part]').first().boundingBox()
  if (b && wrap) {
    const dx = wrap.x + wrap.width / 2 - (b.x + b.width / 2)
    const dy = wrap.y + wrap.height / 2 - (b.y + b.height / 2)
    await page.mouse.move(wrap.x + 20, wrap.y + wrap.height - 20)
    await page.mouse.down()
    await page.mouse.move(wrap.x + 20 + dx, wrap.y + wrap.height - 20 + dy, { steps: 5 })
    await page.mouse.up()
  }
  const name = rotate ? `${id}-rot${rotate}.png` : `${id}.png`
  await page.locator('.canvas-wrap').screenshot({ path: join(out, name) })
  console.log('saved', join(out, name))
}

await browser.close()
stopServer()
console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors')
process.exit(errors.length ? 1 : 0)
