// Browser check for breadboards, in the built app: loads a full 830-hole board with 20 seated
// resistors and 10 rail jumpers, then through the real UI checks hole and rail hover, leg snapping
// (red partial, green seated, mount and unmount on drop), dragging the board with its parts while
// recording frame times, rotating it, and deleting it. On fresh sheets it then checks a Parts panel
// drop mounting in one undo step, a second part on the same holes staying loose, the green and red
// drag highlight, a wire drawn from a pin into a free hole (confirmed in the exported JSON), a wire
// from a hole under a mounted part routing with square corners, the hole next to a plugged leg
// staying its own hole (hover, press and drop), a press on a hole under another wire starting a
// wire (a click between holes still selects the wire, and the selected wire's end handle still
// wins), holes of a board placed off the world grid, pads on a module that is not a board, and a
// wire to a missing hole drawn as a dashed red stub that can be selected and deleted, and the
// broken connections badge and list (select, delete, a connection with neither end on the sheet,
// where focus goes after each), the selected wire's Alt+click, bend and segment handles winning over
// the holes beneath them, and Select then Delete from the side panel for a connection with neither
// end on the sheet. Last, the Parts panel and the dark theme.
//
// Usage (repo root, after `npm run build`):
//   node scripts/perf-breadboard.mjs [--out <dir>] [--port 4191]
// Budget: median frame <= 17 ms and 95th percentile <= 33 ms while dragging the board. Exits 1
// when any check fails. Launches its own Chrome through playwright-core; never use the shared
// Playwright MCP browser.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i < 0 ? dflt : args[i + 1]
}
const out = resolve(opt('--out', join(tmpdir(), 'circuitoon-breadboard')))
const port = Number(opt('--port', '4191'))
if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

// The sheet: the full board at (0, 0); 20 resistors seated in rows a, e and h (a resistor body is
// 60 x 40 with its legs at local (0, 20) and (60, 20)); 10 jumpers from the top + rail to row c
// of columns no resistor covers.
const board = JSON.parse(readFileSync('modules/breadboard-full.json', 'utf8'))
const resistor = JSON.parse(readFileSync('modules/resistor.json', 'utf8'))
const parts = [{ uid: 'bb', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }]
let n = 0
for (const row of [60, 100, 150])
  for (let k = 0; k < 7 && n < 20; k++) {
    n++
    parts.push({ uid: `r${n}`, designator: `R${n}`, module: resistor.id, x: 30 + k * 90, y: row - 20, rotation: 0, mount: { board: 'bb' } })
  }
const freeColumns = [8, 17, 26, 35, 44, 53, 62, 9, 18, 27]
const connections = freeColumns.map((c, i) => ({
  uid: `w${i + 1}`, from: { part: 'bb', pin: 'top+', hole: i * 5 }, to: { part: 'bb', pin: `c${c}-top`, hole: 2 }, color: 'red', gauge: 22,
}))
/** Writes a diagram file into the output folder and returns its path. */
function sheetFile(name, title, sheetParts, sheetConnections, modules = { [board.id]: board, [resistor.id]: resistor }) {
  const file = join(out, `${name}.circuitoon.json`)
  writeFileSync(file, JSON.stringify({ format: 'circuitoon-diagram/1', title, modules, parts: sheetParts, connections: sheetConnections }))
  return file
}
const file = sheetFile('breadboard-check', 'Breadboard check', parts, connections)

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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('dialog', (d) => d.accept())
}
watch(page)

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const shot = async (name) => {
  await page.locator('.canvas-wrap').screenshot({ path: join(out, name) })
  console.log('saved', join(out, name))
}
/** Screen point of a world point, through the canvas SVG's own transform. */
const toScreen = (x, y) =>
  page.evaluate(([wx, wy]) => {
    const svg = document.querySelector('svg.canvas')
    const p = new DOMPoint(wx, wy).matrixTransform(svg.getScreenCTM())
    return { x: p.x, y: p.y }
  }, [x, y])
const count = (selector) => page.locator(selector).count()
const pause = (ms = 120) => page.waitForTimeout(ms)
/** How many dots the net highlight draws: it is one path, one `M` per lit point. */
const litPoints = () => page.evaluate(() => (document.querySelector('.net-hi')?.getAttribute('d')?.match(/M/g) ?? []).length)
/** Leg dot centers, as "x,y" strings, sorted. */
const legDots = () => page.evaluate(() => [...document.querySelectorAll('[data-legs] circle')].map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`).sort())
/** Uids of the parts on the sheet, in drawing order. */
const partUids = () => page.evaluate(() => [...document.querySelectorAll('[data-part]')].map((g) => g.getAttribute('data-part')))
/**
 * Wires whose drawn path has a step that is neither horizontal nor vertical. Reads the drawn path
 * data (moves, lines and the small hop arcs, which start and end on the same line).
 */
const diagonalWires = () =>
  page.evaluate(() => {
    const bad = []
    for (const hit of document.querySelectorAll('[data-wire] path.wire-hit')) {
      const d = hit.getAttribute('d') ?? ''
      let cur = null
      for (const [, cmd, rest] of d.matchAll(/([MLA])([^MLA]*)/g)) {
        const v = rest.trim().split(/[\s,]+/).map(Number)
        const next = { x: v[v.length - 2], y: v[v.length - 1] }
        if (cmd === 'L' && cur && cur.x !== next.x && cur.y !== next.y) bad.push(hit.closest('[data-wire]').getAttribute('data-wire'))
        cur = next
      }
    }
    return bad
  })
/** Drags from world point `from` by world delta (dx, dy) in `steps` pointer moves, calling `during(step)` after each. */
async function drag(from, dx, dy, steps, during) {
  const a = await toScreen(from.x, from.y)
  const b = await toScreen(from.x + dx, from.y + dy)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
    await page.waitForTimeout(8)
    if (during) await during(i)
  }
  return async () => {
    await page.mouse.up()
    await pause()
  }
}
/** Opens a fresh editor (default view) from the start screen. Leaves the page first: the same
 * #/editor URL would reuse the open editor instead of the start screen. */
async function openEditor() {
  await page.goto('about:blank')
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')
}
/** Imports a diagram file into a fresh editor and waits for part `uid`. */
async function load(path, uid) {
  await openEditor()
  await page.locator('input[type=file]').setInputFiles(path)
  await page.waitForSelector(`[data-part="${uid}"]`)
  await pause(200)
}
/** Exports the sheet through the toolbar and returns the saved JSON. */
async function exported() {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
  return JSON.parse(readFileSync(await download.path(), 'utf8'))
}
/** Drags a part from the Parts panel onto world point (wx, wy) with a real HTML drag and drop. */
async function dropFromPanel(name, wx, wy) {
  await page.getByRole('searchbox', { name: 'Search parts' }).fill(name)
  const at = await toScreen(wx, wy)
  const wrap = await page.locator('.canvas-wrap').boundingBox()
  await page
    .locator('.lib-item', { hasText: name })
    .first()
    .dragTo(page.locator('.canvas-wrap'), { targetPosition: { x: at.x - wrap.x, y: at.y - wrap.y } })
  await page.getByRole('searchbox', { name: 'Search parts' }).fill('')
  await pause()
}
/** Zooms out around the canvas center until part `uid` fits, then drags the paper to center it. */
async function frame(uid) {
  const wrap = await page.locator('.canvas-wrap').boundingBox()
  const mid = { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height / 2 }
  await page.mouse.move(mid.x, mid.y)
  for (let i = 0; i < 30; i++) {
    const b = await page.locator(`[data-part="${uid}"]`).boundingBox()
    if (b.width < wrap.width * 0.9 && b.height < wrap.height * 0.9) break
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(30)
  }
  const b = await page.locator(`[data-part="${uid}"]`).boundingBox()
  const from = { x: wrap.x + 10, y: wrap.y + wrap.height - 10 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + mid.x - (b.x + b.width / 2), from.y + mid.y - (b.y + b.height / 2), { steps: 5 })
  await page.mouse.up()
  await pause()
}
/** Presses at world `from` and releases at world `to`, moving in steps (a wire draw). */
async function stroke(from, to) {
  const release = await drag(from, to.x - from.x, to.y - from.y, 12)
  await release()
}

await openEditor()
const t0 = Date.now()
await page.locator('input[type=file]').setInputFiles(file)
await page.waitForSelector('[data-part="bb"]')
console.log(`loaded the 830-hole board with 20 parts in ${Date.now() - t0} ms`)
await pause(300)
await shot('loaded.png')
check((await count('[data-legs] circle')) === 40, 'all 40 legs plugged in on load')

// Hover row d of column 8: a free hole next to the jumper's end (row c), so no wire covers it. The
// strip is joined to the top + rail by a jumper, like the other 9 jumper strips.
const hole = await toScreen(100, 90)
await page.mouse.move(hole.x, hole.y)
await pause()
let lit = await litPoints()
check(lit === 100, `hovering a hole lights its net: rail 50 + 10 strips x 5 = 100 holes (got ${lit})`)
await shot('hover.png')

// Hover the top + rail itself, on a hole no jumper starts from: the same whole net lights.
const rail = await toScreen(300, 20)
await page.mouse.move(rail.x, rail.y)
await pause()
lit = await litPoints()
check(lit === 100, `hovering the + rail lights the whole net, rail and jumper strips (got ${lit})`)
await shot('hover-rail.png')
await page.mouse.move(5, 5)
await pause()

// Drag R1 (legs at (30, 60) and (90, 60)) down by 200 px: at +140 only its right leg meets the
// bottom - rail (red); at +200 it is off the board, and dropping there unmounts it.
const releaseOff = await drag({ x: 60, y: 60 }, 0, 200, 20, async (step) => {
  if (step !== 14) return
  await pause()
  check((await count('.seat-bad')) === 1, 'half on a rail: one red leg')
  await shot('partial.png')
})
await releaseOff()
check((await count('[data-legs] circle')) === 38, 'dropped off the board: R1 unmounted (38 legs)')

// Drag it back to where it was: both legs green, and dropping mounts it again.
const releaseBack = await drag({ x: 60, y: 260 }, 0, -200, 20)
await pause()
check((await count('.seat-ok')) === 2, 'back on its holes: two green legs')
await shot('seated.png')
await releaseBack()
check((await count('[data-legs] circle')) === 40, 'dropped seated: R1 mounted again (40 legs)')

// Drag the board by its center channel in a free column, recording frame times.
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = (t) => {
    window.__frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const f0 = await page.evaluate(() => window.__frames.length)
const releaseBoard = await drag({ x: 100, y: 115 }, 200, 0, 60)
const frames = await page.evaluate((i) => window.__frames.slice(i), f0)
await releaseBoard()
frames.sort((a, b) => a - b)
const med = frames[frames.length >> 1]
const p95 = frames[Math.floor(frames.length * 0.95)]
console.log(`board drag: ${frames.length} frames, median ${med.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`)
check(med <= 17 && p95 <= 33, 'board drag frame budget (median <= 17 ms, p95 <= 33 ms)')
const leg = await page.locator('[data-legs] circle').first()
check((await leg.getAttribute('cx')) === '290' && (await leg.getAttribute('cy')) === '60', 'the board carried R1 by 200 px (its first leg dot, pin 2 on the right, is at 290, 60)')
check((await count('[data-legs] circle')) === 40, 'all 40 legs still plugged after the board drag')
check((await diagonalWires()).length === 0, 'no jumper has a diagonal step after the board drag')
await shot('board-moved.png')

// Rotate the (selected) board: its parts turn with it and stay plugged.
await page.keyboard.press('r')
await pause(300)
check((await count('[data-legs] circle')) === 40, 'rotating the board keeps all 40 legs plugged')
check((await diagonalWires()).length === 0, 'no jumper has a diagonal step after rotating the board')
const afterRotate = await exported()
check(afterRotate.parts.filter((p) => p.mount?.board === 'bb').length === 20, 'after rotating, the saved file still has all 20 resistors mounted on the board')
// Zoom out and pan so the whole turned board is in the picture (panning clears the selection),
// then select it again with a click on the middle of its center channel, which has no holes.
await frame('bb')
const middle = await toScreen(540, 115)
await page.mouse.click(middle.x, middle.y)
await pause()
check((await count('[data-legs] circle')) === 40, 'clicking the turned board changes no mount')
await shot('board-rotated.png')

// Delete the board: the resistors stay, unmounted; the jumpers go with it.
await page.keyboard.press('Delete')
await pause(300)
check((await count('[data-part="bb"]')) === 0, 'board deleted')
check((await count('[data-part^="r"]')) === 20, 'its 20 resistors remain')
check((await count('[data-legs] circle')) === 0, 'no legs plugged after deleting the board')
const afterDelete = await exported()
check(afterDelete.parts.length === 20 && afterDelete.parts.every((p) => !p.mount) && afterDelete.connections.length === 0, 'the saved file keeps the 20 resistors, none mounted, and no jumpers')
await shot('board-deleted.png')

// --- A fresh sheet with an empty board: everything below is done through the UI. ---
await load(sheetFile('empty-board', 'Empty board', [{ uid: 'bb2', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }], []), 'bb2')

// A wire from a hole into a hole: c30-top row c (320, 80) to the top + rail over column 34 (350, 20).
await stroke({ x: 320, y: 80 }, { x: 350, y: 20 })
let saved = await exported()
const holeWire = saved.connections[0]
check(
  saved.connections.length === 1 && [holeWire.from, holeWire.to].some((e) => e.pin === 'c30-top' && e.hole === 2) && [holeWire.from, holeWire.to].some((e) => e.pin === 'top+' && e.hole === 25),
  `a wire drawn from a hole to a rail hole is saved hole to hole (${JSON.stringify(holeWire && [holeWire.from, holeWire.to])})`,
)

// Drop a resistor from the Parts panel with its center at (330, 80): it lands at (300, 60) with its
// legs on c28-top and c34-top row c, covering the wire's end at (320, 80), and mounts.
await dropFromPanel('Resistor (1/4 W)', 330, 80)
const [ra] = (await partUids()).filter((u) => u !== 'bb2')
check((await legDots()).join(' ') === '300,80 360,80', `a resistor dropped from the Parts panel onto free holes mounts (legs ${(await legDots()).join(' ')})`)
await shot('panel-drop.png')
await page.getByRole('button', { name: 'Undo' }).click()
await pause()
check((await partUids()).length === 1 && (await count('[data-legs] circle')) === 0, 'one Undo removes the dropped part and its mount together')
await page.getByRole('button', { name: 'Redo' }).click()
await pause()
check((await legDots()).length === 2, 'Redo brings it back mounted')

// The wire from the covered hole now leaves through the resistor's body: square corners only.
await page.mouse.move(5, 5)
await pause()
check((await diagonalWires()).length === 0, 'the wire from a hole under the mounted resistor has no diagonal step')
await shot('covered-hole-wire.png')

// A second resistor dropped on the same holes stays loose: only the first is mounted.
await dropFromPanel('Resistor (1/4 W)', 330, 80)
const [rb] = (await partUids()).filter((u) => u !== 'bb2' && u !== ra)
check((await legDots()).length === 2, 'a second resistor dropped on the same holes does not mount (still 2 legs)')
saved = await exported()
check(saved.parts.filter((p) => p.mount).map((p) => p.uid).join() === ra, `only the first resistor is mounted in the saved file (${saved.parts.filter((p) => p.mount).map((p) => p.uid).join()})`)
await shot('panel-drop-same-holes.png')

// Drag the second one (drawn on top) down 70 px onto free holes in row h: green; back up over
// the first one's holes: red, since those holes are taken; then down again and drop: it mounts.
const releaseB = await drag({ x: 330, y: 80 }, 0, 70, 10)
await pause()
check((await count('.seat-ok')) === 2 && (await count('.seat-bad')) === 0, 'dragged over free holes: both legs green')
await shot('drag-green.png')
const back = await toScreen(330, 80)
await page.mouse.move(back.x, back.y - 4, { steps: 4 })
await page.mouse.move(back.x, back.y, { steps: 2 })
await pause()
check((await count('.seat-bad')) >= 1 && (await count('.seat-ok')) === 0, `dragged over taken holes: red, not green (${await count('.seat-bad')} red)`)
await shot('drag-red.png')
const down = await toScreen(330, 150)
await page.mouse.move(down.x, down.y, { steps: 6 })
await pause()
await releaseB()
check((await legDots()).length === 4, 'dropped on free holes: the second resistor mounts (4 legs)')

// A wire drawn from a pin into a free hole: the second resistor's pin 1 to the top - rail over
// column 22 (230, 30).
const pin = await page.evaluate((uid) => {
  const c = document.querySelector(`[data-pin-part="${uid}"][data-pin="1"]`)
  return { x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }
}, rb)
await stroke(pin, { x: 230, y: 30 })
saved = await exported()
const pinWire = saved.connections.find((c) => c.uid !== holeWire.uid)
const ends = pinWire ? [pinWire.from, pinWire.to] : []
check(
  ends.some((e) => e.part === rb && e.pin === '1' && e.hole === undefined) && ends.some((e) => e.part === 'bb2' && e.pin === 'top-' && e.hole === 15),
  `a wire drawn from a pin into a free hole is saved pin to hole (${JSON.stringify(ends)})`,
)
check((await diagonalWires()).length === 0, 'no wire on this sheet has a diagonal step')
await page.mouse.move(5, 5)
await pause()
await shot('pin-to-hole-wire.png')

// --- The hole next to a plugged leg is its own hole. R1 at (30, 40) plugs pin 1 into c1-top row a
// (30, 60) and pin 2 into c7-top row a (90, 60); pin 2's stub tip sits 2 px from c8-top row a
// (100, 60), so a pin target left there would catch everything aimed at column 8. ---
await load(
  sheetFile('leg-neighbour', 'Leg neighbour', [
    { uid: 'bb4', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 },
    { uid: 'rl', designator: 'R1', module: resistor.id, x: 30, y: 40, rotation: 0, mount: { board: 'bb4' } },
  ], []),
  'bb4',
)
check((await legDots()).join(' ') === '30,60 90,60', `R1 plugged into c1 and c7 row a (legs ${(await legDots()).join(' ')})`)
const pinAt = await page.evaluate(() => {
  const c = document.querySelector('[data-pin-part="rl"][data-pin="2"]')
  return `${c.getAttribute('cx')},${c.getAttribute('cy')}`
})
check(pinAt === '90,60', `a plugged leg's hit target sits on its own hole (pin 2 at ${pinAt})`)
/** X of every point the net highlight lights (each dot is drawn from `M x-r y`, so this is x - r). */
const litXs = () => page.evaluate(() => [...(document.querySelector('.net-hi')?.getAttribute('d') ?? '').matchAll(/M(-?[\d.]+)/g)].map((m) => Number(m[1])))
const neighbour = await toScreen(100, 60)
await page.mouse.move(neighbour.x, neighbour.y)
await pause()
const col8 = await litXs()
const legHole = await toScreen(90, 60)
await page.mouse.move(legHole.x, legHole.y)
await pause()
const col7 = await litXs()
check(
  col8.length >= 5 && new Set(col8).size === 1 && col7.length >= 5 && new Set(col7).size === 1 && col8[0] - col7[0] === 10,
  `hovering the hole next to the leg lights column 8, hovering the leg's hole lights column 7 (x-r ${[...new Set(col8)]} vs ${[...new Set(col7)]})`,
)
await shot('leg-neighbour-hover.png')
// Press on the neighbouring hole and draw to the top + rail over column 14 (150, 20); then draw
// from the top + rail over column 25 (260, 20) and drop onto that same neighbouring hole.
await stroke({ x: 100, y: 60 }, { x: 150, y: 20 })
await stroke({ x: 260, y: 20 }, { x: 100, y: 60 })
saved = await exported()
const neighbourEnds = saved.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.pin !== 'top+')
check(
  saved.connections.length === 2 && neighbourEnds.length === 2 && neighbourEnds.every((e) => e.part === 'bb4' && e.pin === 'c8-top' && (e.hole ?? 0) === 0),
  `a wire started on, and a wire dropped on, the hole next to a plugged leg both land in that hole's own strip (${JSON.stringify(neighbourEnds)})`,
)
await page.mouse.move(5, 5)
await pause()
await shot('leg-neighbour-wires.png')

// --- A press exactly on a hole starts a wire even where another wire crosses it (Astra B3). w1
// runs straight along row a from c10 (120, 60) to c20 (220, 60), over the holes of c11 to c19. ---
await load(
  sheetFile('hole-under-wire', 'Hole under a wire', [{ uid: 'bb5', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }], [
    { uid: 'w1', from: { part: 'bb5', pin: 'c10-top', hole: 0 }, to: { part: 'bb5', pin: 'c20-top', hole: 0 }, color: 'blue', gauge: 22 },
  ]),
  'bb5',
)
const w1Path = await page.locator('[data-wire="w1"] path.wire-hit').getAttribute('d')
check(w1Path?.replace(/\s+/g, '') === 'M12060L22060', `w1 runs straight over the row a holes (${w1Path})`)
// Between two holes (175, 60) the wire's hit stroke wins: a click selects it.
let between = await toScreen(175, 60)
await page.mouse.click(between.x, between.y)
await pause()
check((await page.locator('[data-wire="w1"] path').count()) === 4, 'a click on the wire between holes selects the wire')
await page.keyboard.press('Escape')
await pause()
// Exactly on c15 row a (170, 60), under the wire: the press starts a new wire from that hole.
await stroke({ x: 170, y: 60 }, { x: 150, y: 20 })
saved = await exported()
const underEnds = saved.connections.filter((c) => c.uid !== 'w1').flatMap((c) => [c.from, c.to])
check(
  saved.connections.length === 2 && underEnds.some((e) => e.part === 'bb5' && e.pin === 'c15-top' && (e.hole ?? 0) === 0) && underEnds.some((e) => e.pin === 'top+'),
  `a press on a hole under a wire starts a wire from that hole (${JSON.stringify(underEnds)})`,
)
await shot('hole-under-wire.png')
// The selected wire's own end handle still wins over the hole beneath it: dragging w1's end at
// c20 (220, 60) onto c21 (230, 60) reconnects w1 instead of starting a wire.
between = await toScreen(205, 60)
await page.mouse.click(between.x, between.y)
await pause()
await stroke({ x: 220, y: 60 }, { x: 230, y: 60 })
saved = await exported()
const w1 = saved.connections.find((c) => c.uid === 'w1')
check(saved.connections.length === 2 && w1?.to.pin === 'c21-top', `the selected wire's end handle over a hole reconnects that wire (${JSON.stringify(w1?.to)})`)

// --- The selected wire's own edits win over the holes beneath it. w1 runs straight along row a
// from c10 (120, 60) to c20 (220, 60). Alt+click on the c12 hole (140, 60) adds a bend there;
// the bend handle then sits on that hole, and the segment bar of (140, 60)-(220, 60) sits on the
// c16 hole (180, 60). ---
await load(
  sheetFile('handles-over-holes', 'Handles over holes', [{ uid: 'bb8', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }], [
    { uid: 'w1', from: { part: 'bb8', pin: 'c10-top', hole: 0 }, to: { part: 'bb8', pin: 'c20-top', hole: 0 }, color: 'blue', gauge: 22 },
  ]),
  'bb8',
)
between = await toScreen(155, 60)
await page.mouse.click(between.x, between.y)
await pause()
check((await page.locator('[data-wire="w1"] path').count()) === 4, 'w1 is selected before the Alt+click')
const bendAt = await toScreen(140, 60)
await page.keyboard.down('Alt')
await page.mouse.click(bendAt.x, bendAt.y)
await page.keyboard.up('Alt')
await pause()
saved = await exported()
let hw1 = saved.connections.find((c) => c.uid === 'w1')
check(
  saved.connections.length === 1 && Array.isArray(hw1?.route) && hw1.route.some(([x, y]) => x === 140 && y === 60),
  `Alt+click on a hole under the selected wire adds a bend there, not a new wire (${saved.connections.length} wire(s), route ${JSON.stringify(hw1?.route)})`,
)
check((await count('.wire-bend-handle')) > 0, 'the new bend shows a bend handle')
// A press and drag starting on the bend handle (over the c12 hole) does not start a wire.
await stroke({ x: 140, y: 60 }, { x: 150, y: 20 })
saved = await exported()
check(saved.connections.length === 1, `a drag from a bend handle over a hole starts no wire (${saved.connections.length} wire(s))`)
// The segment bar over the c16 hole (180, 60) moves that segment down to row c (y = 80).
await page.mouse.click(between.x, between.y)
await pause()
const segBar = await page.evaluate(() => [...document.querySelectorAll('.wire-seg-handle')].map((r) => `${Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2},${Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2}`))
check(segBar.includes('180,60'), `a segment bar sits on the c16 hole (bars at ${segBar.join(' ')})`)
await stroke({ x: 180, y: 60 }, { x: 180, y: 80 })
saved = await exported()
hw1 = saved.connections.find((c) => c.uid === 'w1')
check(
  saved.connections.length === 1 && Array.isArray(hw1?.route) && hw1.route.some(([, y]) => y === 80),
  `dragging the segment bar over a hole moves the segment, it starts no wire (${saved.connections.length} wire(s), route ${JSON.stringify(hw1?.route)})`,
)
await shot('handles-over-holes.png')
// Double-clicking the bend handle over the c12 hole removes that bend.
const before = hw1.route.length
await page.mouse.dblclick(bendAt.x, bendAt.y)
await pause()
saved = await exported()
hw1 = saved.connections.find((c) => c.uid === 'w1')
check(saved.connections.length === 1 && (hw1.route?.length ?? 0) < before, `double-clicking a bend handle over a hole removes the bend (${before} to ${hw1.route?.length ?? 0} bends)`)
await page.keyboard.press('Escape')
await pause()

// --- A board placed off the world grid (x = 5) has clickable holes (Astra B4): c1 row a is at
// (35, 60) and the top + rail hole over column 14 at (155, 20). ---
await load(sheetFile('off-grid-board', 'Off-grid board', [{ uid: 'bb6', designator: 'BB1', module: board.id, x: 5, y: 0, rotation: 0 }], []), 'bb6')
const offHole = await toScreen(35, 60)
await page.mouse.move(offHole.x, offHole.y)
await pause()
lit = await litPoints()
check(lit === 5, `hovering a hole of an off-grid board lights its strip (got ${lit})`)
await stroke({ x: 35, y: 60 }, { x: 155, y: 20 })
saved = await exported()
const offEnds = saved.connections.flatMap((c) => [c.from, c.to])
check(
  saved.connections.length === 1 && offEnds.some((e) => e.pin === 'c1-top' && (e.hole ?? 0) === 0) && offEnds.some((e) => e.pin === 'top+'),
  `a wire drawn between holes of an off-grid board is saved hole to hole (${JSON.stringify(offEnds)})`,
)
await page.mouse.move(5, 5)
await pause()
await shot('off-grid-board-wire.png')

// --- Pads on a module that is not a board (a routing obstacle with interior pads) take wires
// (Astra B2): press pad P1 at (410, 310), drop on pad P2 at (430, 310). ---
const padHeader = {
  format: 'circuitoon-module/1', id: 'pad-header', name: 'Pad header', pins: [], size: { w: 4, h: 2 },
  holes: [{ name: 'P1', at: [[10, 10]], holeStyle: 'pad' }, { name: 'P2', at: [[30, 10]], holeStyle: 'pad' }],
}
await load(sheetFile('pad-header', 'Pad header', [{ uid: 'hd', designator: 'J1', module: 'pad-header', x: 400, y: 300, rotation: 0 }], [], { 'pad-header': padHeader }), 'hd')
const pad = await toScreen(410, 310)
await page.mouse.move(pad.x, pad.y)
await pause()
lit = await litPoints()
check(lit === 1, `hovering a pad of a non-board module lights it (got ${lit})`)
await stroke({ x: 410, y: 310 }, { x: 430, y: 310 })
saved = await exported()
const padEnds = saved.connections.flatMap((c) => [c.from, c.to]).map((e) => `${e.part}.${e.pin}`).sort().join(' ')
check(saved.connections.length === 1 && padEnds === 'hd.P1 hd.P2', `a wire starts and ends on the pads of a non-board module (${padEnds})`)
check((await exported()).parts[0].x === 400, 'pressing a pad did not drag the part')
await page.mouse.move(5, 5)
await pause()
await shot('pad-header-wire.png')

// --- A wire to a hole that does not exist (c2-top has 5 holes): a dashed red stub. ---
// w2 has neither end on the sheet, so it has nothing to draw: the broken connections notice (a
// toolbar badge and a list in the side panel) is where it is found and deleted (Astra B6).
const brokenFile = sheetFile('broken-wire', 'Broken wire', [{ uid: 'bb3', designator: 'BB1', module: board.id, x: 0, y: 0, rotation: 0 }], [
  { uid: 'w1', from: { part: 'bb3', pin: 'c1-top', hole: 0 }, to: { part: 'bb3', pin: 'c2-top', hole: 99 } },
  { uid: 'w2', from: { part: 'gone1', pin: '1' }, to: { part: 'gone2', pin: 'VCC' }, label: 'Sensor power' },
])
await load(brokenFile, 'bb3')
await page.mouse.move(5, 5)
await pause()
check((await count('.wire-broken')) === 1, 'a wire to a missing hole draws one dashed red stub')
await shot('broken-stub.png')
const badge = page.locator('.broken-badge')
check((await badge.textContent()) === '2 broken connections', `the toolbar shows a broken connections badge (${await badge.textContent()})`)
const brokenNames = await page.locator('.broken .broken-name').allTextContents()
check(brokenNames.join(' | ') === 'BB1 c1-top hole 0 to BB1 c2-top hole 99 | Sensor power', `the side panel lists both broken connections (${brokenNames.join(' | ')})`)
await page.locator('.inspector').screenshot({ path: join(out, 'broken-list-light.png') })
console.log('saved', join(out, 'broken-list-light.png'))
// The badge brings the list back while something else is selected.
await page.getByRole('button', { name: 'Select BB1 c1-top hole 0 to BB1 c2-top hole 99' }).click()
await pause()
const focusId = () => page.evaluate(() => document.activeElement?.id ?? '')
const focusSelects = () => page.evaluate(() => document.activeElement?.getAttribute('data-broken-select') ?? '')
check((await focusId()) === 'wire-title', `Select moves focus to the wire panel's heading (focus on "${await focusId()}")`)
check((await page.locator('.inspector .hint.warn').textContent())?.startsWith('Broken: BB1 c2-top hole 99 is not on the sheet'), 'Select shows the broken wire in the side panel, with no promise of handles')
check((await page.locator('[data-wire="w1"] path').count()) === 3, 'Select highlights its stub on the sheet')
await page.locator('.inspector').screenshot({ path: join(out, 'broken-wire-selected.png') })
console.log('saved', join(out, 'broken-wire-selected.png'))
await badge.click()
await pause()
check((await page.locator('.broken li').count()) === 2 && (await page.evaluate(() => document.activeElement?.id)) === 'broken-title', 'the badge clears the selection and moves focus to the list')
await page.getByRole('button', { name: 'Delete Sensor power' }).click()
await pause()
check((await focusSelects()) === 'w1', `deleting the last row moves focus to the row before it, its Select button (focus on "${await focusSelects()}")`)
const afterListDelete = await exported()
check(afterListDelete.connections.map((c) => c.uid).join() === 'w1', `Delete in the list removes the connection with no end on the sheet (${afterListDelete.connections.map((c) => c.uid).join()})`)
check((await badge.textContent()) === '1 broken connection', 'the badge counts down')
const stub = await page.evaluate(() => {
  const r = document.querySelector('.wire-broken').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.click(stub.x, stub.y)
await pause()
check((await page.locator('[data-wire="w1"] path').count()) === 3, 'clicking the stub selects it (a selection halo is drawn)')
await shot('broken-stub-selected.png')
await page.keyboard.press('Delete')
await pause()
check((await count('.wire-broken')) === 0 && (await exported()).connections.length === 0, 'Delete removes the broken wire')

// Focus after a Delete in the list, and Select then Delete from the side panel for a connection
// with neither end on the sheet (it draws nothing, so the panel is the only way to it).
await load(brokenFile, 'bb3')
await page.getByRole('button', { name: 'Delete BB1 c1-top hole 0 to BB1 c2-top hole 99' }).click()
await pause()
check((await focusSelects()) === 'w2', `deleting a row moves focus to the next row's Select button (focus on "${await focusSelects()}")`)
await page.getByRole('button', { name: 'Select Sensor power' }).click()
await pause()
check((await focusId()) === 'wire-title', 'Select on a connection with no end on the sheet opens its wire panel, focused')
await page.locator('.inspector > button.tool', { hasText: 'Delete' }).click()
await pause()
check((await exported()).connections.length === 0 && (await badge.count()) === 0, 'Delete in the wire panel removes the connection with no end on the sheet, and the badge goes away')
await load(brokenFile, 'bb3')
await page.getByRole('button', { name: 'Delete Sensor power' }).click()
await pause()
await page.getByRole('button', { name: 'Delete BB1 c1-top hole 0 to BB1 c2-top hole 99' }).click()
await pause()
check((await focusId()) === 'sheet-heading', `deleting the only row left moves focus to the panel heading (focus on "${await focusId()}")`)

// --- The Parts panel and the dark theme. ---
const heads = await page.locator('.lib-group-head').evaluateAll((els) => els.map((e) => [e.children[0].textContent, e.children[1].textContent]))
const bi = heads.findIndex(([c]) => c === 'Batteries')
check(bi >= 0 && heads[bi + 1]?.[0] === 'Prototyping' && heads[bi + 1]?.[1] === '5', `Parts panel: "Prototyping" (5) right after "Batteries" (${JSON.stringify(heads[bi + 1])})`)
await page.locator('.lib-group', { hasText: 'Prototyping' }).first().scrollIntoViewIfNeeded()
await page.locator('.library').screenshot({ path: join(out, 'parts-panel-prototyping.png') })
console.log('saved', join(out, 'parts-panel-prototyping.png'))

const dark = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
watch(dark)
await dark.goto(base + '#/editor', { waitUntil: 'networkidle' })
await dark.getByRole('button', { name: /New diagram/ }).click()
await dark.waitForSelector('.toolbar')
await dark.locator('input[type=file]').setInputFiles(file)
await dark.waitForSelector('[data-part="bb"]')
await dark.waitForTimeout(300)
await dark.screenshot({ path: join(out, 'dark-editor.png') })
console.log('saved', join(out, 'dark-editor.png'))
await dark.goto('about:blank')
await dark.goto(base + '#/editor', { waitUntil: 'networkidle' })
await dark.getByRole('button', { name: /New diagram/ }).click()
await dark.waitForSelector('.toolbar')
await dark.locator('input[type=file]').setInputFiles(brokenFile)
await dark.waitForSelector('[data-part="bb3"]')
await dark.waitForTimeout(300)
await dark.screenshot({ path: join(out, 'broken-dark-editor.png') })
await dark.locator('.inspector').screenshot({ path: join(out, 'broken-list-dark.png') })
console.log('saved', join(out, 'broken-list-dark.png'))

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await browser.close()
stopServer()
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall breadboard checks passed')
