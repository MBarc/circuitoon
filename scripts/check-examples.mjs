// End to end for the skill's worked examples (agent toolkit spec 10): each example is laid out and
// linked by the built CLI (the Spirit Typewriter sheets from their partials, with --keep), and the
// link opens in the editor with its title and every part, the payload gone from the address bar.
// Saves a screenshot per example.
//
// Usage (after `npm run build` and `npm run build:cli`): npm run check:examples -- [--out <dir>] [--port 4195]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-examples')))
const port = Number(flagOf('--port', '4195'))
mkdirSync(out, { recursive: true })
const dir = 'plugin/skills/circuitoon-design/references/examples'
const tw = join(dir, 'spirit-typewriter')
const cliRun = (...args) => execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', ...args], { encoding: 'utf8' })
const examples = [
  ...readdirSync(dir).filter((f) => f.endsWith('.netlist.json')).sort().map((f) => ({ name: f.replace('.netlist.json', ''), layout: ['layout', join(dir, f)] })),
  ...readdirSync(tw).filter((f) => f.endsWith('.partial.json')).sort().map((f) => ({ name: `typewriter-${f.replace('.partial.json', '')}`, layout: ['layout', '--keep', join(tw, f)] })),
]
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const { name, layout } of examples) {
  const sheetPath = join(out, `${name}.json`)
  cliRun(...layout, '-o', sheetPath)
  const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'))
  const link = JSON.parse(cliRun('link', sheetPath, '--json'))
  check(link.url !== null, `${name}: the CLI made a link`)
  if (!link.url) continue
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(link.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('.editor')
  check((await page.locator('.toolbar .title').textContent({ timeout: 3000 }).catch(() => '')) === sheet.title, `${name}: opens with its title`)
  check((await page.locator('[data-part]').count()) === sheet.parts.length, `${name}: every part is on the canvas (${sheet.parts.length})`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${name}: the payload left the address bar`)
  check(errors.length === 0, `${name}: no page errors ${errors.join('; ')}`)
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}
await browser.close()
done()
