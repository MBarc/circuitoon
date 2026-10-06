// Browser check for cross-origin isolation (firmware spec 2.5 and 10), on a static server that sends
// NO isolation headers, so the service worker is what isolates the page, as on GitHub Pages:
//   1. A first visit reloads once and is then crossOriginIsolated. The worker script is served late,
//      so the app boots and reads a share link before that reload; the link's diagram still shows.
//   2. The page loads nothing cross-origin; the self-hosted fonts are used.
//   3. The code worker's script gets its CSP from the service worker, and the CSP is enforced.
//   4. A first visit that holds an unsaved diagram when the worker arrives is never reloaded. (Once a
//      page is controlled and isolated the worker's page script returns early, so a later worker
//      update never reloads it at all: the first visit is the only reload the guard has to stop.)
//   5. A window that bypasses the service worker reloads at most once (no reload loop).
//   6. The kill switch (scripts/rollback/coi-serviceworker.js) unregisters cleanly and reloads.
// Usage (after `npm run build`): npm run check:isolation-ui -- [--out <dir>] [--port 4213]
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { encodePayload } from '../src/format/link.ts'
import { checker, flagOf, launchChrome } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/isolation-ui'))
const port = Number(flagOf('--port', '4213'))
mkdirSync(out, { recursive: true })
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' }
// A stand-in code worker script (the real one comes in a later task): it reports whether eval runs,
// which the CSP's script-src (no 'unsafe-eval') forbids.
const CODE_WORKER = "let r\ntry { eval('1'); r = 'eval ran' } catch { r = 'eval blocked' }\npostMessage(r)\n"
// The service worker file can be swapped for the kill switch mid-check, and its registration fetch
// (header `Service-Worker: script`, not the page's own <script> load) held back until `swHold` settles.
let swFile = 'dist/coi-serviceworker.js'
let swHold = null
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!path.startsWith('/circuitoon/')) return void res.writeHead(404).end()
  const rel = path.slice('/circuitoon/'.length) || 'index.html'
  if (rel === 'assets/codeWorker-check.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(CODE_WORKER)
  if (req.headers['service-worker'] === 'script' && swHold) await swHold
  const file = rel === 'coi-serviceworker.js' ? swFile : join('dist', rel)
  if (!existsSync(file)) return void res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
  res.end(readFileSync(file))
}).listen(port)
const base = `http://localhost:${port}/circuitoon/`

const mod = (id) => JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))
const link = `${base}#/editor?d=${await encodePayload(
  JSON.stringify({
    format: 'circuitoon-diagram/1',
    title: 'Linked LED',
    modules: { 'battery-9v': mod('battery-9v'), resistor: mod('resistor'), led: mod('led') },
    parts: [
      { uid: 'p1', designator: 'BT1', module: 'battery-9v', x: 40, y: 90 },
      { uid: 'p2', designator: 'R1', module: 'resistor', x: 200, y: 30 },
      { uid: 'p3', designator: 'D1', module: 'led', x: 340, y: 30 },
    ],
    connections: [
      { uid: 'w1', from: { part: 'p1', pin: '+' }, to: { part: 'p2', pin: '1' }, color: 'red' },
      { uid: 'w2', from: { part: 'p2', pin: '2' }, to: { part: 'p3', pin: 'A' }, color: 'yellow' },
      { uid: 'w3', from: { part: 'p3', pin: 'K' }, to: { part: 'p1', pin: '-' }, color: 'black' },
    ],
  }),
)}`

// Polls `fn` in the page until it is true, across reloads (an evaluate in a closing page throws).
async function until(page, fn, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    if (await page.evaluate(fn).catch(() => false)) return true
  }
  return false
}
const opened = (page) => until(page, () => document.querySelector('.toolbar .title')?.textContent === 'Linked LED', 10000)
const shows = async (page) => (await opened(page)) && (await page.locator('[data-part]').count()) === 3

/** A fresh context (no service worker yet) whose page counts document loads, not hash edits. */
async function freshPage(scheme) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  const page = await context.newPage()
  const seen = { loads: 0, foreign: [], errors: [] }
  page.on('load', () => seen.loads++)
  page.on('request', (r) => !r.url().startsWith(`http://localhost:${port}/`) && !r.url().startsWith('data:') && seen.foreign.push(r.url()))
  page.on('pageerror', (e) => seen.errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  return { context, page, seen }
}

const { check, done } = checker()
// Whatever isolation headers or CSP the page sees below came from the service worker.
check(!(await fetch(base)).headers.has('cross-origin-embedder-policy'), 'the server itself sends no isolation headers')
check(!(await fetch(`${base}assets/codeWorker-check.js`)).headers.has('content-security-policy'), 'the server itself sends no CSP')
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const { context, page, seen } = await freshPage(scheme)

  // 1. First visit with a share link, the worker script held back 2 s: the app boots and reads the
  // link (taking the payload out of the address bar), then the one reload restores it.
  swHold = new Promise((r) => setTimeout(r, 2000))
  await page.goto(link, { waitUntil: 'domcontentloaded' })
  const booted = await until(page, () => document.querySelector('.toolbar .title')?.textContent === 'Linked LED' && location.hash === '#/editor' && !navigator.serviceWorker.controller, 10000)
  check(booted, `${scheme}: the app opened the link before the worker arrived`)
  if (booted) await page.evaluate(() => (window.__beforeReload = true)).catch(() => {})
  check(await until(page, () => window.crossOriginIsolated === true && !window.__beforeReload), `${scheme}: the reloaded page is crossOriginIsolated`)
  swHold = null
  check(await shows(page), `${scheme}: the share link's diagram survived the reload`)
  await page.waitForLoadState('networkidle')
  check(seen.loads === 2, `${scheme}: the first visit reloaded exactly once (${seen.loads} loads)`)
  check(await page.evaluate(() => typeof SharedArrayBuffer === 'function'), `${scheme}: SharedArrayBuffer is available`)
  await page.screenshot({ path: join(out, `isolation-link-${scheme}.png`) })

  // 2. Nothing cross-origin; the fonts are ours and in use; a controlled load is isolated at once.
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
  check(faces.some((f) => f.includes('Atkinson')) && faces.some((f) => f.includes('Fredoka')), `${scheme}: self-hosted faces loaded: ${faces.join(', ')}`)
  check(seen.foreign.length === 0, `${scheme}: nothing cross-origin was requested (${seen.foreign.join(', ') || 'none'})`)
  check(seen.loads === 3 && (await page.evaluate(() => window.crossOriginIsolated === true)), `${scheme}: a controlled load is isolated without a reload`)
  await page.screenshot({ path: join(out, `isolation-landing-${scheme}.png`) })

  // 3. The code worker script's response carries the CSP through the service worker, and it holds.
  const csp = await page.evaluate(() => fetch('assets/codeWorker-check.js').then((r) => r.headers.get('content-security-policy')))
  check(csp === "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'", `${scheme}: the code worker script carries the CSP (${csp})`)
  const ran = await page.evaluate(
    () =>
      new Promise((ok) => {
        const w = new Worker('assets/codeWorker-check.js')
        w.onmessage = (e) => ok(e.data)
        w.onerror = (e) => ok(`error ${e.message}`)
      }),
  )
  check(ran === 'eval blocked', `${scheme}: the CSP is enforced in the code worker (${ran})`)

  // 4. A first visit with an unsaved edit when the worker arrives is not reloaded (and stays not
  // isolated, so Run will say to reload, ruling R27).
  {
    const fresh = await freshPage(scheme)
    let release
    swHold = new Promise((r) => (release = r))
    await fresh.page.goto(link, { waitUntil: 'domcontentloaded' })
    check(await opened(fresh.page), `${scheme}: unsaved: the link opened before the worker arrived`)
    // Clicks a point that really hits R1 (the centre of its box, between the leads, is the canvas
    // grid), again until it is selected: the sheet may still be settling into view just after boot.
    for (let i = 0; i < 20 && !(await fresh.page.locator('.inspector').textContent()).includes('Rotation'); i++) {
      const at = await fresh.page.evaluate(() => {
        const g = document.querySelector('[data-part="p2"]')
        const r = g.getBoundingClientRect()
        for (let fy = 0; fy < 1; fy += 0.05)
          for (let fx = 0; fx < 1; fx += 0.05) {
            const p = { x: r.left + r.width * fx, y: r.top + r.height * fy }
            if (g.contains(document.elementFromPoint(p.x, p.y))) return p
          }
        return null
      })
      if (at) await fresh.page.mouse.click(at.x, at.y)
      await fresh.page.waitForTimeout(100)
    }
    await fresh.page.keyboard.press('r')
    check(await until(fresh.page, () => window.__circuitoonUnsaved === true, 3000), `${scheme}: unsaved: an edit sets the unsaved flag`)
    release()
    swHold = null
    check(await until(fresh.page, () => navigator.serviceWorker.getRegistration().then((r) => !!r?.active), 10000), `${scheme}: unsaved: the worker installed`)
    await fresh.page.waitForTimeout(1500)
    check(fresh.seen.loads === 1, `${scheme}: unsaved: no reload over the unsaved diagram (${fresh.seen.loads} loads)`)
    check(await fresh.page.evaluate(() => window.crossOriginIsolated === false), `${scheme}: unsaved: the page stays not isolated until the next load`)
    check((await fresh.page.locator('.inspector').textContent()).includes('Rotation: 90 degrees'), `${scheme}: unsaved: the edit is kept`)
    await fresh.page.screenshot({ path: join(out, `isolation-unsaved-${scheme}.png`) })
    check(fresh.seen.errors.length === 0, `${scheme}: unsaved: no page errors ${fresh.seen.errors.join('; ')}`)
    await fresh.context.close()
  }

  // 5. A window that bypasses the worker (DevTools "Bypass for network") is never controlled, so every
  // load finds an active worker not controlling it; the reload guard allows one reload per 10 s, not a loop.
  {
    const fresh = await freshPage(scheme)
    const cdp = await fresh.context.newCDPSession(fresh.page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setBypassServiceWorker', { bypass: true })
    // Counts document requests: in a loop, pages are replaced before their load event fires.
    let docs = 0
    fresh.page.on('request', (r) => r.isNavigationRequest() && r.frame() === fresh.page.mainFrame() && docs++)
    // 'commit' and no throw: in a reload loop the first document never settles.
    await fresh.page.goto(base, { waitUntil: 'commit' }).catch(() => {})
    await fresh.page.waitForTimeout(5000)
    check(docs <= 2, `${scheme}: bypass: at most one reload (${docs} page loads in 5 s)`)
    const usable = await fresh.page.getByRole('link', { name: 'Open the editor' }).first().isVisible().catch(() => false)
    check(usable && (await fresh.page.evaluate(() => !navigator.serviceWorker.controller)), `${scheme}: bypass: the page is usable, uncontrolled`)
    await fresh.page.screenshot({ path: join(out, `isolation-bypass-${scheme}.png`) })
    await fresh.context.close()
  }

  // 6. The kill switch unregisters and reloads into an uncontrolled page. As a page script it does
  // nothing, so the reloaded page registers nothing again (no reload loop).
  swFile = 'scripts/rollback/coi-serviceworker.js'
  const killed = seen.loads
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  for (const end = Date.now() + 15000; seen.loads === killed && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100))
  check(seen.loads > killed, `${scheme}: the kill switch reloaded the page`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  check(await page.evaluate(() => !navigator.serviceWorker.controller), `${scheme}: the page is no longer controlled`)
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
  check(regs === 0, `${scheme}: the kill switch left no registration (${regs})`)
  check(await page.evaluate(() => window.crossOriginIsolated === false), `${scheme}: the page is no longer isolated`)
  check(seen.loads === killed + 1, `${scheme}: one reload, no loop (${seen.loads - killed})`)
  await page.screenshot({ path: join(out, `isolation-killed-${scheme}.png`) })
  check(seen.errors.length === 0, `${scheme}: no page errors ${seen.errors.join('; ')}`)
  swFile = 'dist/coi-serviceworker.js'
  await context.close()
}
await browser.close()
server.close()
done()
