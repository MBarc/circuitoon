// Captures docs/brand/editor.png and editor-dark.png: the real editor with a sheet that has a short,
// so the Problems panel shows the wiring checker at work. Needs the dev server running:
//
//   npx vite --port 5291 --strictPort        (from the repo root, in another terminal)
//   cd docs/brand/src && node capture-editor.mjs
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = here('../../../')
const link = execFileSync(process.execPath, [join(ROOT, 'plugin/bin/circuitoon.mjs'), 'link', here('./editor-short.circuitoon.json')], { encoding: 'utf8' })
  .split(/\r?\n/)[0].trim()
const url = 'http://localhost:5291/circuitoon/' + link.slice(link.indexOf('#'))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 700 }, colorScheme: scheme })
  await page.goto(url)
  await page.getByText('Short circuit').first().waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: here(`../editor${scheme === 'dark' ? '-dark' : ''}.png`) })
  await page.close()
}
await browser.close()
