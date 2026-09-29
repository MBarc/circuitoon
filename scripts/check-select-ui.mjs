// Browser check for the selection rectangle and cut, copy and paste on the editor canvas. Lays out
// a small netlist (two groups, a note, parts mounted on a breadboard) through the circuitoon CLI,
// opens it in the built editor, then through the real UI: a drag on empty paper draws the
// rectangle and selects what lies fully inside (live, while dragging), Shift+drag adds, a plain
// drag replaces, Escape mid-drag puts the old selection back, a click without a drag clears it;
// a middle-button drag and Space+drag pan and keep the selection, the middle press starts no
// autoscroll, and the wheel still zooms. Delete removes everything selected as one undo step.
// Ctrl+C puts a circuitoon-clip/1 on the clipboard; Ctrl+V pastes under the pointer with new uids
// and designators, mounts and wires kept, selected, as one undo step, and a repeat steps on; off
// the sheet a paste lands one grid step from the source; Ctrl+X then Ctrl+V puts a part back
// where it was; a clip pastes into a new sheet; in the title field Ctrl+C and Ctrl+V stay text.
// Saves light and dark screenshots of the rectangle mid-drag and of a paste.
//
// Usage (after `npm run build`): npm run check:select-ui -- [--out <dir>] [--port 4195]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, exportDownload, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-select-ui')))
const port = Number(flagOf('--port', '4195'))
mkdirSync(out, { recursive: true })

const netlist = {
  format: 'circuitoon-netlist/1',
  title: 'Night light',
  parts: [
    { ref: 'BT1', module: 'battery-holder-2xaa' },
    { ref: 'BB1', module: 'breadboard-half' },
    { ref: 'S1', module: 'push-button', on: 'BB1' },
    { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
    { ref: 'D1', module: 'led', on: 'BB1' },
  ],
  nets: [
    { name: 'VCC', pins: ['BT1.+', 'S1.1'] },
    { name: 'SW', pins: ['S1.2', 'R1.1'] },
    { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'BT1.-'] },
  ],
  groups: [
    { name: 'Power', parts: ['BT1'] },
    { name: 'Light', parts: ['BB1', 'S1', 'R1', 'D1'] },
  ],
  notes: [{ text: 'Press S1 to light D1.', near: 'BT1' }],
  wires: { color: { VCC: 'red', GND: 'black' } },
}
const netlistFile = join(out, 'night-light.netlist.json')
const sheetFile = join(out, 'night-light.circuitoon.json')
writeFileSync(netlistFile, JSON.stringify(netlist, null, 2))
execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', 'layout', netlistFile, '-o', sheetFile], { stdio: 'ignore' })
const sheet = JSON.parse(readFileSync(sheetFile, 'utf8'))
const nParts = sheet.parts.length
const nWires = sheet.connections.length
const nNotes = sheet.annotations.length
const bt = sheet.parts.find((p) => p.designator === 'BT1')
const note = sheet.annotations.find((a) => a.type === 'text')
if (!bt || !note) {
  console.error('The laid-out sheet lacks BT1 or its note.')
  process.exit(1)
}

const shots = resolve(flagOf('--shots', '.superpowers'))
mkdirSync(shots, { recursive: true })
const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await noSavePicker(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('.editor')
  const pause = (ms = 120) => page.waitForTimeout(ms)
  /** What the canvas shows selected: parts, wires and marks with the selection outline. */
  const selected = () =>
    page.evaluate(() => {
      const uids = (sel, attr) => [...new Set([...document.querySelectorAll(sel)].map((e) => e.closest(`[${attr}]`).getAttribute(attr)))].sort()
      return {
        parts: uids('[data-part] > rect[stroke="var(--focus)"]', 'data-part'),
        wires: uids('[data-wire] > path[stroke="var(--focus)"]', 'data-wire'),
        notes: uids('[data-annotation] .annotation-selected', 'data-annotation'),
      }
    })
  const count = (s) => s.parts.length + s.wires.length + s.notes.length
  const viewBox = () => page.evaluate(() => document.querySelector('svg.canvas').getAttribute('viewBox'))
  const box = (uid) => page.locator(`[data-part="${uid}"], [data-annotation="${uid}"]`).first().boundingBox()
  const partCount = () => page.locator('[data-part]').count()
  // Whether a screen point is bare paper (no part, wire, mark or handle under it).
  const bare = (x, y) =>
    page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return !!el && el.closest('svg.canvas') !== null && !el.closest('[data-part], [data-wire], [data-annotation], [data-pin], [data-wire-end]')
    }, { x, y })
  /** A left drag from a to b (screen px); `mid` runs with the button still down. */
  async function drag(a, b, { shift = false, button = 'left', mid } = {}) {
    await page.mouse.move(a.x, a.y)
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down({ button })
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 })
    await page.mouse.move(b.x, b.y, { steps: 6 })
    if (mid) await mid()
    await page.mouse.up({ button })
    if (shift) await page.keyboard.up('Shift')
    await pause()
  }
  /** A drag around part or mark `uid`'s box with 12 screen px to spare, starting top left. */
  async function around(uid, opts) {
    const b = await box(uid)
    const a = { x: b.x - 12, y: b.y - 12 }
    check(await bare(a.x, a.y), `${scheme}: the rectangle around ${uid} starts on bare paper`)
    await drag(a, { x: b.x + b.width + 12, y: b.y + b.height + 12 }, opts)
  }

  // Zoom out so the whole sheet fits with paper all round.
  const wrap = await page.locator('.canvas-wrap').boundingBox()
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2)
  const vb0 = await viewBox()
  await page.mouse.wheel(0, 250)
  await pause()
  check((await viewBox()) !== vb0 && Number((await viewBox()).split(' ')[2]) > Number(vb0.split(' ')[2]), `${scheme}: the wheel still zooms`)
  // The screen box round every part and mark.
  const bounds = () =>
    page.evaluate(() => {
      const rs = [...document.querySelectorAll('[data-part], [data-annotation]')].map((e) => e.getBoundingClientRect())
      return { x0: Math.min(...rs.map((r) => r.left)), y0: Math.min(...rs.map((r) => r.top)), x1: Math.max(...rs.map((r) => r.right)), y1: Math.max(...rs.map((r) => r.bottom)) }
    })
  const all = await bounds()
  const from = { x: all.x0 - 20, y: all.y0 - 20 }
  const to = { x: all.x1 + 20, y: all.y1 + 20 }
  check(from.x > wrap.x && from.y > wrap.y && to.x < wrap.x + wrap.width && to.y < wrap.y + wrap.height && (await bare(from.x, from.y)), `${scheme}: the sheet fits in view with bare paper round it`)

  // The rectangle, over everything: drawn while dragging, selecting live; everything on release.
  let midSel = null
  await drag(from, to, {
    mid: async () => {
      await pause()
      const r = page.locator('rect.marquee')
      check((await r.count()) === 1, `${scheme}: mid-drag, the selection rectangle is drawn`)
      const style = await r.evaluate((el) => {
        const s = getComputedStyle(el)
        return { dash: s.strokeDasharray, fillOpacity: s.fillOpacity, stroke: s.stroke }
      })
      check(style.dash.includes('5') && Number(style.fillOpacity) < 0.2 && style.stroke !== 'none', `${scheme}: it is dashed with a faint fill (${JSON.stringify(style)})`)
      midSel = await selected()
      await page.screenshot({ path: join(shots, `marquee-drag-${scheme}.png`) })
    },
  })
  check(midSel && midSel.parts.length === nParts, `${scheme}: mid-drag, the parts inside already show selected (${midSel?.parts.length})`)
  check((await page.locator('rect.marquee').count()) === 0, `${scheme}: the rectangle goes on release`)
  let s = await selected()
  check(s.parts.length === nParts && s.wires.length === nWires && s.notes.length === nNotes, `${scheme}: a drag over the whole sheet selects every part, wire and mark (${s.parts.length}/${nParts}, ${s.wires.length}/${nWires}, ${s.notes.length}/${nNotes})`)
  check((await page.locator('#selection-title').textContent()) === `${nParts + nWires + nNotes} items selected`, `${scheme}: the Inspector counts them`)

  // Delete removes everything selected as one undo step.
  await page.keyboard.press('Delete')
  check((await partCount()) === 0 && (await page.locator('[data-wire]').count()) === 0 && (await page.locator('[data-annotation]').count()) === 0, `${scheme}: Delete removes every selected part, wire and mark`)
  await page.keyboard.press('Control+z')
  check((await partCount()) === nParts && (await page.locator('[data-annotation]').count()) === nNotes, `${scheme}: one undo brings them all back`)

  // A plain drag replaces the selection; Shift+drag adds to it; only whole parts count.
  await around(bt.uid)
  s = await selected()
  check(JSON.stringify(s.parts) === JSON.stringify([bt.uid]) && s.notes.length === 0, `${scheme}: a drag round BT1 selects BT1 alone (${s.parts})`)
  await around(note.uid, { shift: true })
  s = await selected()
  check(JSON.stringify(s.parts) === JSON.stringify([bt.uid]) && JSON.stringify(s.notes) === JSON.stringify([note.uid]), `${scheme}: Shift+drag round the note adds it (${s.parts}, ${s.notes})`)
  await around(note.uid)
  s = await selected()
  check(s.parts.length === 0 && JSON.stringify(s.notes) === JSON.stringify([note.uid]), `${scheme}: a plain drag round the note replaces the selection (${s.parts}, ${s.notes})`)
  const bb = await box(bt.uid)
  await drag({ x: bb.x - 12, y: bb.y - 12 }, { x: bb.x + bb.width / 2, y: bb.y + bb.height + 12 })
  check((await selected()).parts.length === 0, `${scheme}: a rectangle over half of BT1 selects nothing`)

  // Escape mid-drag puts the selection back; a click without a drag clears it.
  await around(bt.uid)
  await drag(from, to, { mid: () => page.keyboard.press('Escape') })
  s = await selected()
  check(JSON.stringify(s.parts) === JSON.stringify([bt.uid]) && (await page.locator('rect.marquee').count()) === 0, `${scheme}: Escape mid-drag cancels the rectangle and keeps BT1 selected (${s.parts})`)
  await page.keyboard.down('Shift')
  await page.mouse.click(from.x, from.y)
  await page.keyboard.up('Shift')
  check(JSON.stringify((await selected()).parts) === JSON.stringify([bt.uid]), `${scheme}: Shift+click on the paper keeps the selection`)
  await drag(from, { x: from.x + 2, y: from.y + 1 })
  check(count(await selected()) === 0, `${scheme}: a press on the paper that moves under 3 px clears the selection, like a click`)

  // Middle drag and Space+drag pan and keep the selection; the middle press starts no autoscroll.
  await around(bt.uid)
  await page.evaluate(() => {
    window.__middle = null
    window.addEventListener('mousedown', (e) => {
      if (e.button === 1) window.__middle = e.defaultPrevented
    })
  })
  const vb1 = await viewBox()
  const bt0 = await box(bt.uid)
  await drag({ x: to.x - 40, y: to.y - 40 }, { x: to.x - 140, y: to.y - 90 }, { button: 'middle' })
  const bt1 = await box(bt.uid)
  check((await viewBox()) !== vb1 && Math.round(bt1.x - bt0.x) === -100 && Math.round(bt1.y - bt0.y) === -50, `${scheme}: a middle-button drag pans the sheet (${Math.round(bt1.x - bt0.x)}, ${Math.round(bt1.y - bt0.y)})`)
  check((await page.evaluate(() => window.__middle)) === true, `${scheme}: the middle press is default-prevented, so no autoscroll starts`)
  check(JSON.stringify((await selected()).parts) === JSON.stringify([bt.uid]), `${scheme}: panning keeps the selection`)
  await page.keyboard.down('Space')
  await drag({ x: to.x - 140, y: to.y - 90 }, { x: to.x - 40, y: to.y - 40 }, {
    mid: async () => check((await page.locator('rect.marquee').count()) === 0, `${scheme}: Space+drag draws no rectangle`),
  })
  await page.keyboard.up('Space')
  const bt2 = await box(bt.uid)
  check(Math.round(bt2.x - bt0.x) === 0 && Math.round(bt2.y - bt0.y) === 0, `${scheme}: Space+drag pans the sheet back (${Math.round(bt2.x - bt0.x)}, ${Math.round(bt2.y - bt0.y)})`)
  check(JSON.stringify((await selected()).parts) === JSON.stringify([bt.uid]), `${scheme}: Space+drag keeps the selection`)

  // Copy everything and paste under the pointer, zoomed out so the copy has room beside the sheet.
  const centre = { x: wrap.x + wrap.width / 2, y: wrap.y + wrap.height / 2 }
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.wheel(0, 450)
  await pause()
  const small = await bounds()
  await drag({ x: small.x0 - 10, y: small.y0 - 10 }, { x: small.x1 + 10, y: small.y1 + 10 })
  check(count(await selected()) === nParts + nWires + nNotes, `${scheme}: zoomed out, a drag still selects the whole sheet`)
  await page.keyboard.press('Control+c')
  const clipText = await page.evaluate(() => navigator.clipboard.readText())
  let clip = null
  try {
    clip = JSON.parse(clipText)
  } catch {
    // checked below
  }
  check(clip?.format === 'circuitoon-clip/1' && clip.parts.length === nParts && clip.connections.length === nWires && clip.annotations.length === nNotes && Object.keys(clip.modules).length > 0,
    `${scheme}: Ctrl+C puts a circuitoon-clip/1 with the parts, wires, marks and modules on the system clipboard`)
  const target = { x: small.x0 - (small.x1 - small.x0) / 2 - 25, y: (small.y0 + small.y1) / 2 + 40 }
  await page.mouse.move(target.x, target.y)
  await page.keyboard.press('Control+v')
  await pause()
  check((await partCount()) === 2 * nParts && (await page.locator('[data-annotation]').count()) === 2 * nNotes, `${scheme}: Ctrl+V pastes a second copy of every part and mark`)
  s = await selected()
  const original = new Set(sheet.parts.map((p) => p.uid))
  check(s.parts.length === nParts && s.parts.every((u) => !original.has(u)) && s.wires.length === nWires && s.notes.length === nNotes, `${scheme}: the pasted items, with new uids, are the selection`)
  // The centre of the boxes of the given parts, in screen px.
  const centreOf = (uids) =>
    page.evaluate((uids) => {
      const r = uids.map((u) => document.querySelector(`[data-part="${u}"]`).getBoundingClientRect())
      return { cx: (Math.min(...r.map((q) => q.left)) + Math.max(...r.map((q) => q.right))) / 2, cy: (Math.min(...r.map((q) => q.top)) + Math.max(...r.map((q) => q.bottom))) / 2 }
    }, uids)
  const pasted = await centreOf(s.parts)
  check(Math.abs(pasted.cx - target.x) < 60 && Math.abs(pasted.cy - target.y) < 60, `${scheme}: the paste lands centred under the pointer (${Math.round(pasted.cx - target.x)}, ${Math.round(pasted.cy - target.y)} px off)`)
  await page.screenshot({ path: join(shots, `marquee-paste-${scheme}.png`) })
  const download = await exportDownload(page)
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const news = saved.parts.filter((p) => !original.has(p.uid))
  const newBoard = news.find((p) => p.module === 'breadboard-half')
  check(new Set(saved.parts.map((p) => p.designator)).size === saved.parts.length && news.some((p) => p.designator === 'BT2') && news.some((p) => p.designator === 'D2'), `${scheme}: pasted parts take the next free designators (${news.map((p) => p.designator).join(' ')})`)
  check(news.filter((p) => p.mount).length === sheet.parts.filter((p) => p.mount).length && news.filter((p) => p.mount).every((p) => p.mount.board === newBoard?.uid), `${scheme}: pasted parts stay mounted, on the pasted board`)
  const newUids = new Set(news.map((p) => p.uid))
  const newWires = saved.connections.filter((c) => newUids.has(c.from.part) && newUids.has(c.to.part))
  check(newWires.length === nWires && saved.connections.length === 2 * nWires, `${scheme}: the pasted wires join the pasted parts (${newWires.length})`)
  // Back under the same spot (the Export click took the pointer off the sheet).
  await page.mouse.move(target.x, target.y)
  await page.keyboard.press('Control+v')
  await pause()
  // The battery of each pasted copy (a board's box would also take in its seated labels).
  const battery = (uids) => page.evaluate((uids) => uids.find((u) => document.querySelector(`[data-part="${u}"]`).textContent.includes('BT')), uids)
  // Measured on its first text: the part's own box would take in the selection outline too.
  const textBox = async (uid) => page.locator(`[data-part="${uid}"] text`).first().boundingBox()
  const first = await textBox(await battery(s.parts))
  const again = await textBox(await battery((await selected()).parts))
  const step = await page.evaluate(() => 10 * document.querySelector('svg.canvas').getScreenCTM().a)
  const moved = { x: again.x - first.x, y: again.y - first.y }
  check((await partCount()) === 3 * nParts && Math.abs(moved.x - step) < 1.5 && Math.abs(moved.y - step) < 1.5, `${scheme}: a repeated paste steps one grid step further instead of stacking (${moved.x.toFixed(2)}, ${moved.y.toFixed(2)} px, step ${step.toFixed(2)})`)
  await page.keyboard.press('Control+z')
  check((await partCount()) === 2 * nParts, `${scheme}: one undo takes the repeated paste away`)
  await page.keyboard.press('Control+z')
  check((await partCount()) === nParts, `${scheme}: another undo takes the first paste away`)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.wheel(0, -450)
  await pause()

  // Off the sheet, a paste lands one grid step from its source.
  await around(bt.uid)
  await page.keyboard.press('Control+c')
  const d0 = await box(bt.uid)
  await page.mouse.move(wrap.x + wrap.width / 2, 20)
  await page.keyboard.press('Control+v')
  await pause()
  const copyUid = (await selected()).parts[0]
  const dc = await box(copyUid)
  const grid = await page.evaluate(() => 10 * document.querySelector('svg.canvas').getScreenCTM().a)
  check(copyUid !== bt.uid && Math.abs(dc.x - d0.x - grid) < 1.5 && Math.abs(dc.y - d0.y - grid) < 1.5, `${scheme}: with the pointer off the sheet, the paste lands one grid step from BT1 (${Math.round(dc.x - d0.x)}, ${Math.round(dc.y - d0.y)} px, grid ${Math.round(grid)})`)
  await page.keyboard.press('Control+z')

  // Cut: gone in one step, back with undo; Ctrl+V after a cut puts it back where it was.
  await around(bt.uid)
  const b0 = await box(bt.uid)
  await page.keyboard.press('Control+x')
  check((await page.locator(`[data-part="${bt.uid}"]`).count()) === 0, `${scheme}: Ctrl+X removes BT1`)
  const cut = await page.evaluate(() => navigator.clipboard.readText())
  check(cut.includes('"circuitoon-clip/1"') && cut.includes('"BT1"'), `${scheme}: Ctrl+X puts BT1 on the clipboard`)
  await page.keyboard.press('Control+z')
  check((await page.locator(`[data-part="${bt.uid}"]`).count()) === 1, `${scheme}: one undo brings the cut part back`)
  await around(bt.uid)
  await page.keyboard.press('Control+x')
  await page.mouse.move(wrap.x + wrap.width / 2, 20)
  await page.keyboard.press('Control+v')
  await pause()
  const back = (await selected()).parts[0]
  const b1 = back && (await box(back))
  check(!!b1 && Math.abs(b1.x - b0.x) < 1 && Math.abs(b1.y - b0.y) < 1 && (await page.locator(`[data-part="${back}"] text`).allTextContents()).some((t) => t.includes('BT1')),
    `${scheme}: pasting right after a cut puts BT1 back where it was`)

  // Text copy and paste in the title field stay text.
  await page.mouse.click(from.x, from.y)
  const title = page.locator('#sheet-title')
  await title.click()
  await title.press('Control+a')
  await page.keyboard.press('Control+c')
  check((await page.evaluate(() => navigator.clipboard.readText())) === 'Night light', `${scheme}: Ctrl+C in the title field copies its text`)
  await title.press('End')
  await page.keyboard.press('Control+v')
  const parts0 = await partCount()
  check((await title.inputValue()) === 'Night lightNight light' && parts0 === nParts, `${scheme}: Ctrl+V in the title field pastes text and no parts (${await title.inputValue()})`)
  await title.press('Escape')

  // A clip pastes into another sheet, modules and all.
  await page.mouse.click(from.x, from.y)
  await around(back)
  await page.keyboard.press('Control+c')
  await page.getByRole('button', { name: 'New sheet' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-part]').length === 0)
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2)
  await page.keyboard.press('Control+v')
  await pause()
  check((await partCount()) === 1 && (await page.locator('[data-part] text').allTextContents()).some((t) => t.includes('BT1')), `${scheme}: the clip pastes into a new sheet, with its module`)

  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await context.close()
}
await browser.close()
done()
