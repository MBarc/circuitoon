// Browser check for diagram links (agent toolkit spec 6): a link opens its diagram; the payload
// leaves the address bar; an edit made after loading survives a same-route hashchange with the
// editor still mounted (the App keys on the route); reload shows the start screen; damaged,
// oversized and too-many-parts payloads show the usual load error and never crash the page. Over an
// open sheet with unsaved changes a link asks first (declining keeps the sheet and its edit,
// accepting opens the link), and a damaged link shows an alert and keeps the sheet. Saves light and
// dark screenshots of the opened link.
//
// Usage (after `npm run build`): npm run check:link-ui -- [--out <dir>] [--port 4193]
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { encodePayload } from '../src/format/link.ts'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-link-ui')))
const port = Number(flagOf('--port', '4193'))
mkdirSync(out, { recursive: true })
const mod = (id) => JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))
const diagram = {
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
}
const payload = await encodePayload(JSON.stringify(diagram))
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
// Reads text without waiting the default 30 s for an element a failed check never shows.
const textOf = (loc) => loc.textContent({ timeout: 3000 }).catch(() => '')
// Clicks a point that really hits the part: the centre of its box can be empty (between a
// resistor's leads), where the canvas grid takes the click.
async function clickPart(page, uid) {
  const at = await page.evaluate((uid) => {
    const g = document.querySelector(`[data-part="${uid}"]`)
    const r = g.getBoundingClientRect()
    for (let fy = 0.5; fy < 1; fy += 0.05)
      for (const s of [1, -1]) {
        const y = r.top + r.height * (s > 0 ? fy : 1 - fy)
        for (let fx = 0.5; fx < 1; fx += 0.05)
          for (const t of [1, -1]) {
            const x = r.left + r.width * (t > 0 ? fx : 1 - fx)
            if (g.contains(document.elementFromPoint(x, y))) return { x, y }
          }
      }
    return null
  }, uid)
  if (at) await page.mouse.click(at.x, at.y)
  return at !== null
}

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor?d=${payload}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.editor')
  check((await textOf(page.locator('.toolbar .title'))) === 'Linked LED', `${scheme}: the link opens its diagram`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${scheme}: the payload left the address bar`)
  check((await page.locator('[data-part]').count()) === 3, `${scheme}: all three parts are on the canvas`)
  await page.screenshot({ path: join(out, `link-${scheme}.png`) })
  await page.evaluate(() => {
    window.__editor = document.querySelector('.editor')
  })
  check(await clickPart(page, 'p2'), `${scheme}: R1 can be clicked`)
  await page.keyboard.press('r')
  check((await textOf(page.locator('.inspector'))).includes('Rotation: 90 degrees'), `${scheme}: an edit can be made after loading`)
  await page.evaluate(() => {
    history.pushState(null, '', '#/editor')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  check(await page.evaluate(() => document.querySelector('.editor') === window.__editor), `${scheme}: a same-route hashchange keeps the editor mounted`)
  check((await textOf(page.locator('.inspector'))).includes('Rotation: 90 degrees'), `${scheme}: the edit made after loading survives`)
  await page.reload({ waitUntil: 'networkidle' })
  check((await page.locator('.start').count()) === 1, `${scheme}: reload shows the start screen (no autosave yet)`)
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await page.close()
}

// A link opened over a sheet with unsaved changes asks first; declining keeps the open sheet and
// its edit. A damaged link opened over a sheet says so in an alert and keeps the sheet too.
{
  const other = await encodePayload(JSON.stringify({ ...diagram, title: 'Other sheet' }))
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const dialogs = []
  let answer = 'dismiss'
  page.on('dialog', (d) => {
    dialogs.push({ type: d.type(), message: d.message() })
    void (answer === 'accept' ? d.accept() : d.dismiss())
  })
  const openLink = async (p) => {
    const before = dialogs.length
    await page.evaluate((p) => {
      location.hash = `#/editor?d=${p}`
    }, p)
    await page.waitForFunction(() => location.hash === '#/editor')
    // The dialog (when there is one) comes after the payload is decoded and left the address bar.
    for (let i = 0; i < 40 && dialogs.length === before; i++) await page.waitForTimeout(50)
    return dialogs.slice(before)
  }
  await page.goto(`${base}#/editor?d=${payload}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.editor')
  check(await clickPart(page, 'p2'), 'unsaved: R1 can be clicked')
  await page.keyboard.press('r')
  check((await textOf(page.locator('.inspector'))).includes('Rotation: 90 degrees'), 'unsaved: an edit is made')

  answer = 'dismiss'
  const asked = await openLink(other)
  check(asked.length === 1 && asked[0].type === 'confirm' && asked[0].message.includes('Discard unsaved changes to Linked LED'), `unsaved: opening another link asks to discard (${JSON.stringify(asked)})`)
  check((await textOf(page.locator('.toolbar .title'))) === 'Linked LED', 'unsaved: declining keeps the open sheet')
  check((await page.locator('[data-part]').count()) === 3, 'unsaved: declining keeps every part')
  check(await clickPart(page, 'p2'), 'unsaved: R1 can be clicked again')
  check((await textOf(page.locator('.inspector'))).includes('Rotation: 90 degrees'), 'unsaved: declining keeps the edit')

  const damaged = await openLink('v1.@@@')
  check(damaged.length === 1 && damaged[0].type === 'alert' && /damaged/.test(damaged[0].message), `open sheet: a damaged link shows an alert (${JSON.stringify(damaged)})`)
  check((await textOf(page.locator('.toolbar .title'))) === 'Linked LED', 'open sheet: a damaged link keeps the open sheet')
  check((await page.locator('.editor').count()) === 1 && (await page.locator('.start').count()) === 0, 'open sheet: a damaged link does not drop to the start screen')
  check((await textOf(page.locator('.inspector'))).includes('Rotation: 90 degrees'), 'open sheet: a damaged link keeps the edit')

  answer = 'accept'
  const accepted = await openLink(other)
  check(accepted.length === 1 && accepted[0].type === 'confirm', 'unsaved: accepting the confirm')
  await page.waitForFunction(() => document.querySelector('.toolbar .title')?.textContent === 'Other sheet', null, { timeout: 5000 }).catch(() => {})
  check((await textOf(page.locator('.toolbar .title'))) === 'Other sheet', 'unsaved: accepting opens the linked diagram')
  check(errors.length === 0, `unsaved: no page errors ${errors.join('; ')}`)
  await page.close()
}

const many = { ...diagram, parts: Array.from({ length: 2001 }, (_, i) => ({ uid: `q${i}`, designator: `R${i}`, module: 'resistor', x: 0, y: 0 })) }
const bad = [
  ['damaged', 'v1.@@@', /damaged/],
  ['over 5 MB', `v1.${deflateRawSync(Buffer.alloc(6 * 1024 * 1024, 32)).toString('base64url')}`, /larger than 5 MB/],
  ['over 2,000 parts', await encodePayload(JSON.stringify(many)), /2,001 parts/],
]
for (const [name, p, message] of bad) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}#/editor?d=${p}`, { waitUntil: 'networkidle' })
  const alert = page.locator('.start-error')
  await alert.waitFor()
  check(message.test(await alert.textContent()), `${name}: the usual load error is shown`)
  check((await page.evaluate(() => location.hash)) === '#/editor', `${name}: the payload left the address bar`)
  check((await page.locator('.editor').count()) === 0 && (await page.locator('.start').count()) === 1, `${name}: the start screen stays, no blank editor`)
  check(errors.length === 0, `${name}: the page did not crash`)
  await page.screenshot({ path: join(out, `link-${name.replace(/\W+/g, '-')}.png`) })
  await page.close()
}
await browser.close()
done()
