// Browser check for one wire end or leg per breadboard hole, in the built editor. On a half
// breadboard with a mounted resistor and two wires into holes, through the real UI: a new wire
// dropped on a hole that holds a wire end, or on a leg's hole, is refused and the used hole under
// the pointer shows the red seat mark, while the free hole next to it takes the wire; pressing a
// used hole starts no wire; a wire end moved onto a used hole is refused, never blocks its own
// hole, and lands on a free one; a part dragged so a leg lands on a wire end's hole does not
// mount. A copy of a real sheet with two wire ends in one hole loads and lists the error. Saves
// light and dark screenshots of the red mark while dragging over a used hole.
//
// Usage (after `npm run build`): npm run check:holes-ui -- [--out <dir>] [--shots <dir>] [--port 4212] [--sheet <file>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, exportDownload, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-holes-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4212'))
// A copy of a real sheet with two wire ends in one hole (never the original); skipped when absent.
const realSheet = flagOf('--sheet', '.superpowers/hole1-sheet.json')
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const ids = ['breadboard-half', 'resistor']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
// Board at (0, 300): strip cN-top is x = 20 + 10 N, hole k at y = 360 + 10 k.
const hole = (n, k) => ({ x: 20 + 10 * n, y: 360 + 10 * k })
const file = join(out, 'holes.circuitoon.json')
writeFileSync(file, JSON.stringify({
  format: 'circuitoon-diagram/1', title: 'Holes check', modules,
  parts: [
    at('bb', 'BB1', 'breadboard-half', 0, 300),
    // Legs in c1-top and c7-top, hole 0.
    at('r1', 'R1', 'resistor', 30, 340, { mount: { board: 'bb' } }),
    at('r2', 'R2', 'resistor', 420, 120),
  ],
  connections: [
    { uid: 'w1', from: { part: 'r2', pin: '1' }, to: { part: 'bb', pin: 'c10-top', hole: 0 }, color: 'red' },
    { uid: 'w2', from: { part: 'r2', pin: '2' }, to: { part: 'bb', pin: 'c20-top', hole: 0 }, color: 'blue' },
  ],
}))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  const pause = (ms = 120) => page.waitForTimeout(ms)
  const toScreen = (p) =>
    page.evaluate(([wx, wy]) => {
      const q = new DOMPoint(wx, wy).matrixTransform(document.querySelector('svg.canvas').getScreenCTM())
      return { x: q.x, y: q.y }
    }, [p.x, p.y])
  /** Presses at world point `a`, moves to `b` in steps (and runs `mid` there), releases. */
  const stroke = async (a, b, mid) => {
    const s = await toScreen(a)
    const e = await toScreen(b)
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move((s.x + e.x) / 2, (s.y + e.y) / 2, { steps: 4 })
    await page.mouse.move(e.x, e.y, { steps: 4 })
    await pause()
    if (mid) await mid()
    await page.mouse.up()
    await pause(200)
  }
  const saved = async () => {
    const download = await exportDownload(page)
    return JSON.parse(readFileSync(await download.path(), 'utf8'))
  }
  const endsIn = (d, n, k) => d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.part === 'bb' && e.pin === `c${n}-top` && (e.hole ?? 0) === k).length
  const usedMark = () => page.locator('[data-used-hole]').count()
  const load = async (f) => {
    await page.locator('input[type=file]').setInputFiles(f)
    await pause(400)
  }

  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
  await load(file)
  await page.waitForSelector('[data-part="r2"]')
  const wires0 = (await saved()).connections.length

  // A new wire from a free hole dropped on c10-top hole 0, which holds w1's end: refused, marked red.
  let marked = -1
  let target = -1
  await stroke(hole(12, 2), hole(10, 0), async () => {
    marked = await usedMark()
    target = await page.locator('.hole-target').count()
    // The sheet itself stays paper-white in dark mode; the whole window shows the dark chrome.
    await page.screenshot({ path: join(shots, `hole1-used-${scheme}.png`) })
    const c = await toScreen(hole(10, 0))
    await page.screenshot({ path: join(shots, `hole1-used-zoom-${scheme}.png`), clip: { x: c.x - 120, y: c.y - 70, width: 240, height: 140 } })
    console.log('saved', join(shots, `hole1-used-${scheme}.png`), 'and -zoom')
  })
  check(marked === 1 && target === 0, `${scheme}: dragging a new wire over a hole with a wire end shows the red mark, no target (${marked} marks, ${target} targets)`)
  let d = await saved()
  check(d.connections.length === wires0 && endsIn(d, 10, 0) === 1, `${scheme}: dropping it there adds no wire (${d.connections.length} wires, ${endsIn(d, 10, 0)} ends in c10-top hole 0)`)
  check((await usedMark()) === 0, `${scheme}: the red mark goes when the drag ends`)

  // The free hole next to it, in the same strip, takes the wire.
  await stroke(hole(12, 2), hole(10, 1), async () => {
    marked = await usedMark()
    target = await page.locator('.hole-target').count()
  })
  check(marked === 0 && target === 1, `${scheme}: over the free neighbouring hole there is a target and no red mark (${marked} marks, ${target} targets)`)
  d = await saved()
  check(d.connections.length === wires0 + 1 && endsIn(d, 10, 1) === 1 && endsIn(d, 12, 2) === 1, `${scheme}: dropping on the free neighbouring hole adds the wire (${d.connections.length} wires)`)

  // Over R1's leg in c1-top hole 0 the leg's pin takes the wire (a wire to a plugged pin, by
  // design), never a second end in the hole itself.
  await stroke(hole(9, 4), hole(1, 0))
  d = await saved()
  const toLeg = d.connections.find((c) => [c.from, c.to].some((e) => e.pin === 'c9-top' && e.hole === 4))
  check(!!toLeg && [toLeg.from, toLeg.to].some((e) => e.part === 'r1') && endsIn(d, 1, 0) === 0, `${scheme}: a wire dropped on a leg ends on the leg's pin, not in its hole (${JSON.stringify(toLeg && [toLeg.from, toLeg.to])})`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await pause()

  // Pressing a used hole starts no wire from it.
  await stroke(hole(10, 1), hole(14, 4))
  d = await saved()
  check(d.connections.length === wires0 + 1 && endsIn(d, 14, 4) === 0, `${scheme}: a press on a used hole starts no second wire there (${d.connections.length} wires)`)
  await page.keyboard.press('Escape')

  // Moving w2's end: its own hole never blocks it, a used hole refuses it, a free hole takes it.
  // w2 runs up the right-hand side at x = 490, off the board.
  const onW2 = await toScreen({ x: 490, y: 250 })
  const selectW2 = async () => {
    await page.mouse.click(onW2.x, onW2.y)
    await pause()
  }
  await selectW2()
  const handle = page.locator('[data-wire-end="to"][data-wire-uid="w2"]')
  check((await handle.count()) === 1, `${scheme}: selecting w2 shows its end handle`)
  const home = hole(20, 0)
  const s0 = await toScreen(home)
  await page.mouse.move(s0.x, s0.y)
  await page.mouse.down()
  const away = await toScreen(hole(20, 3))
  await page.mouse.move(away.x, away.y, { steps: 4 })
  await page.mouse.move(s0.x, s0.y, { steps: 4 })
  await pause()
  marked = await usedMark()
  target = await page.locator('.hole-target').count()
  check(marked === 0 && target === 1, `${scheme}: a moved wire end never blocks its own hole (${marked} marks, ${target} targets)`)
  const used = await toScreen(hole(10, 0))
  await page.mouse.move(used.x, used.y, { steps: 6 })
  await pause()
  marked = await usedMark()
  await page.mouse.up()
  await pause(200)
  d = await saved()
  let w2 = d.connections.find((c) => c.uid === 'w2')
  check(marked === 1 && w2.to.pin === 'c20-top' && w2.to.hole === 0 && endsIn(d, 10, 0) === 1, `${scheme}: w2's end dropped on a used hole is refused (${marked} marks, end at ${w2.to.pin} ${w2.to.hole})`)
  await selectW2()
  await stroke(home, hole(20, 3))
  d = await saved()
  w2 = d.connections.find((c) => c.uid === 'w2')
  check(w2.to.pin === 'c20-top' && w2.to.hole === 3, `${scheme}: w2's end moves to a free hole (${w2.to.pin} ${w2.to.hole})`)

  // Drag R1 so its left leg lands in c10-top hole 0 (w1's end): it does not mount.
  await page.keyboard.press('Escape')
  await stroke({ x: 60, y: 355 }, { x: 150, y: 355 }, async () => {
    marked = await page.locator('.seat-bad').count()
  })
  d = await saved()
  const r1 = d.parts.find((p) => p.uid === 'r1')
  check(r1.x === 120 && !r1.mount && marked >= 1, `${scheme}: a part whose leg lands on a wire end's hole shows red and does not mount (at ${r1.x}, mount ${JSON.stringify(r1.mount)}, ${marked} red marks)`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await pause()
  d = await saved()
  check(d.parts.find((p) => p.uid === 'r1').mount?.board === 'bb', `${scheme}: undo puts R1 back mounted`)

  // A copy of a real sheet with two wire ends in one hole loads and lists the new error.
  if (existsSync(realSheet)) {
    await load(realSheet)
    const titles = await page.locator('.problem-title').allTextContents()
    const messages = await page.locator('.problem-message').allTextContents()
    check(titles.includes('Error: Two wires in one hole') && messages.some((m) => /^2 wire ends share .+ hole 2: /.test(m)), `${scheme}: the real sheet loads and lists "Two wires in one hole" (${messages.find((m) => m.includes('share')) ?? 'none'})`)
    await page.locator('.inspector').screenshot({ path: join(shots, `hole1-problem-${scheme}.png`) })
    console.log('saved', join(shots, `hole1-problem-${scheme}.png`))
  } else console.log(`skip: no ${realSheet}`)

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await context.close()
}
await browser.close()
done()
