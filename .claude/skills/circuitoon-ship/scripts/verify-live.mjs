// Confirms the deployed site serves this build and works.
//
// Usage (repo root, after `npm run deploy`):
//   node .claude/skills/circuitoon-ship/scripts/verify-live.mjs [--expect-parts N] [--shot <file.png>]
//
// 1. Waits (up to ~5 minutes) until https://mbarc.github.io/circuitoon/ references the same JS asset
//    as the local dist/index.html, so it never checks a stale copy.
// 2. Opens #/editor in the locally installed Chrome (playwright-core), checks the start screen,
//    opens the sample, checks every sample wire is drawn, counts library parts (optionally against
//    --expect-parts), and reports page errors.
// Exit code 0 when everything passed, 1 otherwise (including any page error).
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const expectParts = opt('--expect-parts') ? Number(opt('--expect-parts')) : undefined
const shot = opt('--shot')
const LIVE = 'https://mbarc.github.io/circuitoon/'
// The connection uids of src/samples/buttonLed.ts (the sample "Try the sample" opens). Hardcoded
// because that module imports the Vite-only library loader; update it when the sample changes.
const SAMPLE_WIRES = ['w1', 'w2', 'w3', 'w4']

const localHtml = readFileSync('dist/index.html', 'utf8')
const asset = localHtml.match(/assets\/index-[\w-]+\.js/)?.[0]
if (!asset) {
  console.error('Could not find the built JS asset in dist/index.html; run `npm run build` (or deploy) first.')
  process.exit(1)
}

let live = false
for (let i = 0; i < 30; i++) {
  try {
    const html = await (await fetch(`${LIVE}?v=${Date.now()}`, { cache: 'no-store' })).text()
    if (html.includes(asset)) {
      live = true
      break
    }
  } catch {
    // network hiccup, retry
  }
  await new Promise((r) => setTimeout(r, 10000))
}
if (!live) {
  console.error(`The live site does not serve ${asset} yet. If a gh-pages push happened, kick a build: gh api repos/MBarc/circuitoon/pages/builds -X POST`)
  process.exit(1)
}
console.log(`live site serves ${asset}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
let ok = true

await page.goto(`${LIVE}?v=${Date.now()}#/editor`, { waitUntil: 'networkidle' })
const hasStart = await page.getByRole('button', { name: /Try the sample/ }).count()
console.log(hasStart ? 'start screen ok' : 'start screen MISSING')
ok &&= hasStart > 0
if (hasStart) {
  await page.getByRole('button', { name: /Try the sample/ }).click()
  await page.waitForSelector('[data-part]', { timeout: 15000 }).catch(() => {})
  const parts = await page.locator('[data-part]').count()
  // Count each wire once, by the group holding its drawn path (name tags also carry data-wire).
  const wires = await page.evaluate(() => [
    ...new Set([...document.querySelectorAll('g[data-wire]')].filter((g) => g.querySelector(':scope > path.wire-hit')).map((g) => g.getAttribute('data-wire'))),
  ])
  const missing = SAMPLE_WIRES.filter((id) => !wires.includes(id))
  console.log(`sample: ${parts} parts, wires drawn: ${wires.join(', ') || 'none'}${missing.length ? ` (MISSING ${missing.join(', ')})` : ''}`)
  ok &&= parts > 0 && missing.length === 0
  const lib = await page.locator('.lib-item').count()
  console.log(`library: ${lib} parts`)
  if (expectParts !== undefined && lib !== expectParts) {
    console.log(`expected ${expectParts} library parts`)
    ok = false
  }
  if (shot) {
    await page.screenshot({ path: shot })
    console.log('saved', shot)
  }
}
await browser.close()
console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors')
ok &&= errors.length === 0
process.exit(ok ? 0 : 1)
