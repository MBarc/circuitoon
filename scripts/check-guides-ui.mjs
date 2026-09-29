// Browser check for smart guides, Align, Distribute and arrow-key nudges on the editor canvas. Opens
// a small hand-built sheet in the built editor and, through the real UI: a part dragged near
// another's edge snaps there (past where the grid alone would put it) and a guide shows mid-drag,
// then goes on drop; the same drag with Ctrl held stays on the grid with no guide, and releasing
// Ctrl mid-drag turns snapping back on; a part dragged so its pin is nearly level with the pin it is
// wired to snaps level and the wire comes out straight; a part seated in breadboard holes stays
// seated even when an edge nearby would pull it away; Align left and Distribute horizontally move
// the selection as one undo step; arrow keys nudge (Shift for five steps) as one undo step, and not
// from a text field; the toolbar's Snap to objects toggle turns snapping off and is remembered
// after a reload. Saves light and dark screenshots of a drag showing an edge guide, a pin guide and
// equal-spacing markers at once, and of the Arrange panel, as .superpowers/guides-*.png.
//
// Usage (after `npm run build`): npm run check:guides-ui -- [--out <dir>] [--shots <dir>] [--port 4213]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, exportDownload, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-guides-ui')))
const shots = resolve(flagOf('--shots', '.superpowers'))
const port = Number(flagOf('--port', '4213'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const mod = (id) => JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))
const modules = Object.fromEntries(['resistor', 'led', 'servo-sg90', 'breadboard-half'].map((id) => [id, mod(id)]))

// A resistor pair on one strip of the breadboard: holes (hx, hy) and (hx + 60, hy), both in groups.
const board = modules['breadboard-half']
const holeSet = new Set(board.holes.flatMap((g) => g.at.map(([x, y]) => `${x},${y}`)))
const strip = board.holes.flatMap((g) => g.at).find(([x, y]) => y > 50 && holeSet.has(`${x + 60},${y}`))
const BB = { x: 600, y: 500 }
// Resistor pins plug in at their body edge points, (0, 20) and (60, 20).
const seat = { x: BB.x + strip[0], y: BB.y + strip[1] - 20 }
// The leftmost hole of the board's top row: a resistor whose right leg sits one step left of it
// lands no leg (off holes), but one step right it lands that leg (a partial seat).
const topRow = Math.min(...board.holes.flatMap((g) => g.at.map(([, y]) => y)))
const firstX = Math.min(...board.holes.flatMap((g) => g.at.filter(([, y]) => y === topRow).map(([x]) => x)))
if (holeSet.has(`${firstX - 10},${topRow}`)) throw new Error('the top row has a hole left of its first')
const offBoard = { x: BB.x + firstX - 70, y: BB.y + topRow - 20 }

const part = (uid, designator, module, x, y) => ({ uid, designator, module, x, y, rotation: 0 })
const sheet = {
  format: 'circuitoon-diagram/1',
  title: 'Guides',
  modules,
  parts: [
    part('bb', 'BB1', 'breadboard-half', BB.x, BB.y),
    part('r1', 'R1', 'resistor', 0, 0),
    part('r2', 'R2', 'resistor', 200, 0),
    part('r3', 'R3', 'resistor', 0, 200),
    part('d1', 'D1', 'led', 300, 300),
    part('r4', 'R4', 'resistor', 510, 200),
    part('m1', 'M1', 'servo-sg90', 300, 370),
    part('r5', 'R5', 'resistor', 1000, 300),
    // An edge one grid step right of the seat, far below the board: close enough to pull R5.
    part('r6', 'R6', 'resistor', seat.x + 10, 800),
    part('r7', 'R7', 'resistor', 100, 900),
    // An edge that would pull R7 one step right, onto the board's first hole.
    part('r8', 'R8', 'resistor', offBoard.x + 10, 1100),
  ],
  connections: [
    { uid: 'w1', from: { part: 'r3', pin: '2' }, to: { part: 'd1', pin: 'A' }, color: 'red', gauge: 22 },
    { uid: 'w2', from: { part: 'r4', pin: '2' }, to: { part: 'm1', pin: 'PWM' }, color: 'blue', gauge: 22 },
  ],
}
const sheetFile = join(out, 'guides.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify(sheet, null, 2))
const size = { resistor: { w: 60, h: 40 }, led: { w: 40, h: 40 } }

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
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  const pause = (ms = 120) => page.waitForTimeout(ms)

  const wrap = () => page.locator('.canvas-wrap').boundingBox()
  /** Opens the sheet afresh and sets the zoom to `scale` (1.5 is the editor's 100%), anchored top left. */
  async function load(scale) {
    // A new sheet first, so the wait below cannot see the previous copy's parts.
    if (await page.locator('.editor').count()) {
      await page.getByRole('button', { name: 'New sheet' }).click()
      await page.waitForFunction(() => document.querySelectorAll('[data-part]').length === 0)
    }
    await page.locator('input[type=file]').setInputFiles(sheetFile)
    await page.waitForFunction(() => document.querySelectorAll('[data-part]').length === 11)
    const w = await wrap()
    await page.mouse.move(w.x + 1, w.y + 1)
    const now = await view()
    await page.mouse.wheel(0, Math.log(now.s / scale) / 0.0015)
    await pause()
  }
  /** The canvas transform: world (x, y) shows at screen (left + (x - vx) * s, top + (y - vy) * s). */
  const view = () =>
    page.evaluate(() => {
      const svg = document.querySelector('svg.canvas')
      const r = svg.getBoundingClientRect()
      const [x, y, w] = svg.getAttribute('viewBox').split(' ').map(Number)
      return { left: r.left, top: r.top, vx: x, vy: y, s: r.width / w }
    })
  const screen = async (p) => {
    const v = await view()
    return { x: v.left + (p.x - v.vx) * v.s, y: v.top + (p.y - v.vy) * v.s }
  }
  /** The body centre (world) of a part in the loaded sheet. */
  const centre = (uid) => {
    const p = sheet.parts.find((q) => q.uid === uid)
    const s = size[p.module]
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 }
  }
  /** The sheet as saved now, through Export JSON. */
  async function saved() {
    const download = await exportDownload(page)
    return JSON.parse(readFileSync(await download.path(), 'utf8'))
  }
  const at = (d, uid) => {
    const p = d.parts.find((q) => q.uid === uid)
    return { x: p.x, y: p.y, mount: p.mount?.board ?? null }
  }
  const guideCount = (sel = '[data-guide]') => page.locator(sel).count()
  /**
   * Drags part `uid` by `raw` world px from its body centre; `mid` runs with the button still down
   * after the last move. With `ctrl`, Control is held from before the press.
   */
  async function dragPart(uid, raw, { ctrl = false, mid } = {}) {
    const c = centre(uid)
    const a = await screen(c)
    const b = await screen({ x: c.x + raw.x, y: c.y + raw.y })
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-part]')?.getAttribute('data-part'), a)
    check(hit === uid, `${scheme}: the press lands on ${uid} (${hit})`)
    await page.mouse.move(a.x, a.y)
    if (ctrl) await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 })
    await page.mouse.move(b.x, b.y, { steps: 5 })
    await pause(60)
    if (mid) await mid()
    await page.mouse.up()
    if (ctrl) await page.keyboard.up('Control')
    await pause()
  }
  const toggle = () => page.getByRole('button', { name: 'Snap to objects' })

  // 1. Edge snap. At a third of the default zoom a 6 px reach is 12 world px: R3 dragged 192 right
  // lands with its left edge on R2's (200); the grid alone would stop at 190.
  await load(0.5)
  check(Math.abs((await view()).s - 0.5) < 0.01, `${scheme}: zoomed to 33% (${(await view()).s.toFixed(3)})`)
  check((await toggle().getAttribute('aria-pressed')) === 'true', `${scheme}: Snap to objects starts on`)
  let midGuides = 0
  await dragPart('r3', { x: 192, y: 0 }, { mid: async () => (midGuides = await guideCount('[data-guide="edge"][data-axis="x"]')) })
  check(midGuides > 0, `${scheme}: mid-drag, a vertical edge guide shows (${midGuides})`)
  check((await guideCount('[data-guides]')) === 0, `${scheme}: the guides go on drop`)
  let d = await saved()
  check(at(d, 'r3').x === 200 && at(d, 'r3').y === 200, `${scheme}: R3 snapped to R2's left edge at 200 (${JSON.stringify(at(d, 'r3'))})`)

  // 2. The same drag with Ctrl held: the grid alone, no guide.
  await load(0.5)
  let ctrlGuides = -1
  await dragPart('r3', { x: 192, y: 0 }, { ctrl: true, mid: async () => (ctrlGuides = await guideCount()) })
  check(ctrlGuides === 0, `${scheme}: Ctrl-drag shows no guide (${ctrlGuides})`)
  d = await saved()
  check(at(d, 'r3').x === 190, `${scheme}: Ctrl-drag stays on the grid at 190 (${at(d, 'r3').x})`)
  // Releasing Ctrl mid-drag snaps again at once.
  await load(0.5)
  let released = 0
  await dragPart('r3', { x: 192, y: 0 }, {
    ctrl: true,
    mid: async () => {
      await page.keyboard.up('Control')
      await pause(60)
      released = await guideCount('[data-guide="edge"]')
    },
  })
  d = await saved()
  check(released > 0 && at(d, 'r3').x === 200, `${scheme}: releasing Ctrl mid-drag snaps again (${released} guides, x ${at(d, 'r3').x})`)

  // 3. Pin alignment: D1 dragged up 92 lines its A pin up with R3's pin 2 (100 up), ahead of the
  // board's middle 2 px away; the grid alone says 90 up and leaves a kink. The wire then runs level.
  await load(0.5)
  let pinGuides = 0
  await dragPart('d1', { x: 0, y: -92 }, { mid: async () => (pinGuides = await guideCount('[data-guide="pin"]')) })
  check(pinGuides > 0, `${scheme}: mid-drag, a pin guide joins R3.2 and D1.A (${pinGuides})`)
  d = await saved()
  check(at(d, 'd1').y === 200, `${scheme}: D1 snapped level with its wired pin (y ${at(d, 'd1').y})`)
  const flat = await page.evaluate(() => document.querySelector('[data-wire="w1"] .wire-color').getBBox().height)
  check(flat < 0.5, `${scheme}: the R3 to D1 wire is straight (height ${flat.toFixed(2)})`)

  // 4. Seating wins: R5 dragged to 3 px right of a strip seat, where R6's edge is 7 px away, plugs
  // into the holes and shows no guide.
  await load(0.5)
  let seatGuides = -1
  const r5 = sheet.parts.find((p) => p.uid === 'r5')
  await dragPart('r5', { x: seat.x - r5.x + 3, y: seat.y - r5.y }, { mid: async () => (seatGuides = await guideCount()) })
  d = await saved()
  check(seatGuides === 0, `${scheme}: no guide while a part is being seated (${seatGuides})`)
  check(at(d, 'r5').x === seat.x && at(d, 'r5').y === seat.y && at(d, 'r5').mount === 'bb', `${scheme}: R5 is seated in the breadboard (${JSON.stringify(at(d, 'r5'))})`)

  // 4b. A snap never seats a part: R7 dropped 4 px right of a spot just off the board, where an
  // edge 6 px on would put its right leg in the first hole, stays off the board on the grid.
  await load(0.5)
  const r7 = sheet.parts.find((p) => p.uid === 'r7')
  let offGuides7 = -1
  await dragPart('r7', { x: offBoard.x - r7.x + 4, y: offBoard.y - r7.y }, { mid: async () => (offGuides7 = await guideCount()) })
  d = await saved()
  check(at(d, 'r7').x === offBoard.x && at(d, 'r7').y === offBoard.y && !at(d, 'r7').mount && offGuides7 === 0, `${scheme}: a snap never pulls R7 onto the board (${JSON.stringify(at(d, 'r7'))}, want x ${offBoard.x}, ${offGuides7} guides)`)

  // 5. Align left: R1, R3 and D1 selected, one click, one undo step.
  await load(1.5)
  const click = async (uid, shift = false) => {
    const p = await screen(centre(uid))
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.click(p.x, p.y)
    if (shift) await page.keyboard.up('Shift')
    await pause(60)
  }
  await click('r1')
  await click('r3', true)
  await click('d1', true)
  check((await page.locator('#selection-title').textContent()) === '3 items selected', `${scheme}: three parts selected`)
  check((await page.locator('[data-align]').count()) === 6 && (await page.locator('[data-distribute]').count()) === 2, `${scheme}: the Arrange panel offers six Align and two Distribute buttons`)
  if (scheme === 'light' || scheme === 'dark') {
    const panel = await page.locator('.inspector').boundingBox()
    await page.screenshot({ path: join(shots, `guides-arrange-${scheme}.png`), clip: { x: panel.x - 8, y: panel.y, width: panel.width + 8, height: Math.min(panel.height, 330) } })
  }
  await page.getByRole('button', { name: 'Align left edges' }).click()
  await pause()
  d = await saved()
  check(['r1', 'r3', 'd1'].every((u) => at(d, u).x === 0) && at(d, 'd1').y === 300, `${scheme}: Align left lines R1, R3 and D1 up at x 0 (${['r1', 'r3', 'd1'].map((u) => at(d, u).x)})`)
  await page.keyboard.press('Control+z')
  await pause()
  d = await saved()
  check(at(d, 'd1').x === 300 && at(d, 'r3').x === 0, `${scheme}: one undo puts D1 back (${at(d, 'd1').x})`)

  // 6. Distribute horizontally: R1 (0..60), R2 (200..260) and D1 (300..340): R2 goes to 150.
  await load(1.5)
  await click('r1')
  await click('r2', true)
  await click('d1', true)
  await page.getByRole('button', { name: 'Distribute horizontally (equal gaps)' }).click()
  await pause()
  d = await saved()
  check(at(d, 'r2').x === 150 && at(d, 'r1').x === 0 && at(d, 'd1').x === 300, `${scheme}: Distribute spaces R1, R2 and D1 with equal gaps (R2 at ${at(d, 'r2').x})`)
  await page.keyboard.press('Control+z')
  await pause()
  d = await saved()
  check(at(d, 'r2').x === 200, `${scheme}: one undo puts R2 back (${at(d, 'r2').x})`)

  // 7. Arrow keys: two steps right and five down, undone at once; never from a text field.
  await load(1.5)
  await click('r1')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await pause()
  d = await saved()
  check(at(d, 'r1').x === 20 && at(d, 'r1').y === 50, `${scheme}: arrows nudge R1 to (20, 50) (${JSON.stringify(at(d, 'r1'))})`)
  await page.keyboard.press('Control+z')
  await pause()
  d = await saved()
  check(at(d, 'r1').x === 0 && at(d, 'r1').y === 0, `${scheme}: one undo takes back the run of nudges (${JSON.stringify(at(d, 'r1'))})`)
  await click('r1')
  const field = page.locator('.inspector input').first()
  await field.click()
  await field.press('ArrowLeft')
  await field.press('Shift+ArrowLeft')
  await field.press('Escape')
  d = await saved()
  check(at(d, 'r1').x === 0, `${scheme}: arrows in a text field move no part (${at(d, 'r1').x})`)
  // Nor from a button in the Inspector or the Parts list, where arrows scroll and navigate.
  await click('r1')
  await page.getByRole('button', { name: 'Rotate 90 degrees' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.locator('.lib-group-head').first().focus()
  await page.keyboard.press('ArrowDown')
  await pause()
  d = await saved()
  check(at(d, 'r1').x === 0 && at(d, 'r1').y === 0, `${scheme}: arrows in the Inspector or the Parts list move no part (${JSON.stringify(at(d, 'r1'))})`)
  // Nor during a pan: Space held, then a middle-button drag.
  await click('r1')
  await page.keyboard.down('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Space')
  const paper = await screen({ x: 450, y: 150 })
  await page.mouse.move(paper.x, paper.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(paper.x + 5, paper.y + 5)
  await page.keyboard.press('ArrowDown')
  await page.mouse.up({ button: 'middle' })
  await pause()
  d = await saved()
  check(at(d, 'r1').x === 0 && at(d, 'r1').y === 0, `${scheme}: arrows move no part during a Space or middle-button pan (${JSON.stringify(at(d, 'r1'))})`)
  // And from the sheet they still nudge.
  await click('r1')
  await page.keyboard.press('ArrowRight')
  await pause()
  d = await saved()
  check(at(d, 'r1').x === 10, `${scheme}: back on the sheet, an arrow nudges again (${at(d, 'r1').x})`)

  // 8. The toggle: off, the edge drag stays on the grid; remembered after a reload; back on.
  await load(0.5)
  await toggle().click()
  check((await toggle().getAttribute('aria-pressed')) === 'false', `${scheme}: Snap to objects turns off`)
  let offGuides = -1
  await dragPart('r3', { x: 192, y: 0 }, { mid: async () => (offGuides = await guideCount()) })
  d = await saved()
  check(offGuides === 0 && at(d, 'r3').x === 190, `${scheme}: with snapping off the drag stays on the grid (${at(d, 'r3').x}, ${offGuides} guides)`)
  await page.reload({ waitUntil: 'networkidle' })
  await load(0.5)
  check((await toggle().getAttribute('aria-pressed')) === 'false', `${scheme}: the setting is remembered after a reload`)
  await toggle().click()
  check((await toggle().getAttribute('aria-pressed')) === 'true', `${scheme}: Snap to objects turns back on`)

  // 9. The screenshot: R4 dragged to (0, 400) lines up under R1 and R3 (edge guides), its pin 2 level
  // with M1's PWM pin (a pin guide), and the gap above it equal to the gap between R1 and R3.
  await load(1.5)
  await dragPart('r4', { x: -510, y: 200 }, {
    mid: async () => {
      const edge = await guideCount('[data-guide="edge"]')
      const pin = await guideCount('[data-guide="pin"]')
      const gap = await guideCount('[data-gap]')
      check(edge > 0 && pin > 0 && gap >= 2, `${scheme}: mid-drag, edge, pin and equal-spacing guides all show (${edge}, ${pin}, ${gap})`)
      const w = await wrap()
      await page.screenshot({ path: join(shots, `guides-drag-${scheme}.png`), clip: { x: w.x, y: w.y, width: Math.min(w.width, 760), height: Math.min(w.height, 760) } })
      await page.screenshot({ path: join(shots, `guides-drag-full-${scheme}.png`) })
    },
  })
  d = await saved()
  check(at(d, 'r4').x === 0 && at(d, 'r4').y === 400, `${scheme}: R4 lands at (0, 400) (${JSON.stringify(at(d, 'r4'))})`)

  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()
}
await browser.close()
done()
