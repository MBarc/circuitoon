// Browser check for the Parts panel's closest-match search, in the built app. A part described in
// words ("a touch display for the rpi") has no exact match, so Closest matches lists the Raspberry Pi
// touch displays, with each part's description as its tooltip, and clicking one places it; a typo
// still finds displays; an exact name keeps today's exact results and Closest matches leaves them out;
// nonsense says No parts match. A custom part's own description and uses are searched too. Saves the
// panel for the described, typo and no-result queries, light and dark, at 1440 and 390 px wide, to
// .superpowers/search-*.png.
//
// Usage (after `npm run build`): npm run check:search-ui -- [--shots <dir>] [--port 4233]
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4233'))
mkdirSync(shots, { recursive: true })

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
const errors = []

const QUERIES = { described: 'a touch display for the rpi', typo: 'dispaly', none: 'zebra quantum' }

for (const [width, height] of [[1440, 900], [390, 844]]) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /New diagram/ }).click()
    await page.waitForSelector('.library')
    const lib = page.locator('.library')
    const search = lib.getByRole('searchbox', { name: 'Search parts' })
    const closest = lib.locator('.closest-group')
    const closestIds = () => closest.locator('.lib-item .lib-name').allTextContents()
    const tag = `${width}px ${scheme}`

    for (const [name, q] of Object.entries(QUERIES)) {
      await search.fill(q)
      await page.waitForTimeout(150)
      const path = join(shots, `search-${name}-${width}-${scheme}.png`)
      await lib.screenshot({ path })
      console.log('saved', path)
      // At phone width the panel is a short scroller: shoot it again scrolled down to the matches.
      if (width < 900 && (await closest.count())) {
        await lib.evaluate((el) => el.scrollTo(0, el.querySelector('.closest-group').getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8))
        const scrolled = join(shots, `search-${name}-${width}-${scheme}-scrolled.png`)
        await lib.screenshot({ path: scrolled })
        console.log('saved', scrolled)
        await lib.evaluate((el) => el.scrollTo(0, 0))
      }
    }

    await search.fill(QUERIES.described)
    const names = await closestIds()
    check(names.length === 5 && names.slice(0, 3).every((n) => n.startsWith('Raspberry Pi Touch Display')), `${tag}: "${QUERIES.described}" lists the three Pi touch displays first under Closest matches (${names.join(' | ')})`)
    check((await lib.locator('.hint', { hasText: 'No exact matches' }).count()) === 1, `${tag}: with no exact result the panel says No exact matches`)
    const tip = await closest.locator('.lib-item').first().getAttribute('title')
    check(!!tip && /Raspberry Pi Touch Display 2/.test(tip), `${tag}: a part's description is its tooltip (${tip})`)

    await search.fill(QUERIES.typo)
    check((await closestIds()).some((n) => /Display/.test(n)), `${tag}: a typo still finds displays`)

    await search.fill(QUERIES.none)
    check((await closest.count()) === 0 && (await lib.locator('.hint', { hasText: 'No parts match' }).count()) === 1, `${tag}: nonsense says No parts match and shows no Closest matches`)

    await search.fill('servo')
    const exact = await lib.locator('.lib-group:not(.closest-group) .lib-name').allTextContents()
    check(exact.includes('Micro servo SG90') && !(await closestIds()).includes('Micro servo SG90'), `${tag}: an exact result stays where it was and is not repeated under Closest matches`)

    if (width === 1440 && scheme === 'light') {
      await search.fill(QUERIES.described)
      await closest.locator('.lib-item').first().click()
      await page.waitForTimeout(200)
      check((await page.locator('svg.canvas [data-part]').count()) === 1, 'clicking a closest match places it on the sheet')

      // A custom part's own description and uses are searched, and it keeps its custom badge.
      await search.fill('')
      await lib.getByRole('button', { name: 'New part' }).click()
      const dialog = page.locator('dialog.pm-dialog')
      await dialog.waitFor()
      await dialog.locator('[data-testid=pm-name]').fill('Gizmo board')
      await dialog.getByLabel(/^Description/).fill('A flux capacitor board for the bench.')
      await dialog.getByLabel(/^Typical uses/).fill('time travel, demos')
      await dialog.getByLabel('Name of pin 1').fill('VCC')
      await dialog.locator('.pm-about').screenshot({ path: join(shots, 'search-partmaker-fields.png') })
      await dialog.getByRole('button', { name: 'Save and place' }).click()
      await dialog.waitFor({ state: 'detached' })
      await search.fill('time travel machine')
      const mine = closest.locator('.lib-item.mine')
      check((await mine.count()) === 1 && (await mine.getAttribute('title')) === 'A flux capacitor board for the bench.', 'a custom part is found by its own uses, with its description as the tooltip')
      const path = join(shots, `search-custom-${width}-${scheme}.png`)
      await lib.screenshot({ path })
      console.log('saved', path)
    }
    await context.close()
  }
}

check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
await browser.close()
done()
