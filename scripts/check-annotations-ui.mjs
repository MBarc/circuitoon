// Browser check for group frames and text notes on the editor canvas (agent toolkit spec 7). Lays
// out a small netlist with two groups and a note through the circuitoon CLI, opens the sheet in the
// built editor, then through the real UI: a note is selected and dragged on the grid as one undo
// step, and Escape mid-drag puts it back; moved onto the breadboard, pressing it right over a hole
// drags the note and never starts a wire; its text is edited in the Inspector; a frame is selected
// by its label tab, its label edited, and moved onto a wire, which re-routes around the label on
// the drop (and back on undo, and around it again on redo); Shift+click selects a frame and a note
// together and Delete removes both, undo brings them back; the exported file carries every change.
// Saves light and dark screenshots of a selected frame and of a note being edited.
//
// Usage (after `npm run build`): npm run check:annotations-ui -- [--out <dir>] [--port 4194]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, exportDownload, flagOf, launchChrome, noSavePicker, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-annotations-ui')))
const port = Number(flagOf('--port', '4194'))
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
  wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
}
const netlistFile = join(out, 'night-light.netlist.json')
const sheetFile = join(out, 'night-light.circuitoon.json')
writeFileSync(netlistFile, JSON.stringify(netlist, null, 2))
execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', 'layout', netlistFile, '-o', sheetFile], { stdio: 'ignore' })
const sheet = JSON.parse(readFileSync(sheetFile, 'utf8'))
const frameOf = (label) => sheet.annotations.find((a) => a.type === 'frame' && a.label === label)
const power = frameOf('Power')
const light = frameOf('Light')
const note = sheet.annotations.find((a) => a.type === 'text')
const vcc = sheet.connections.find((c) => c.color === 'red')
if (!power || !light || !note || !vcc) {
  console.error('The laid-out sheet lacks its frames, note or VCC wire.')
  process.exit(1)
}

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
const textOf = (loc) => loc.textContent({ timeout: 3000 }).catch(() => '')
const GRID = 10
const snap = (v) => Math.round(v / GRID) * GRID

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, acceptDownloads: true })
  await noSavePicker(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('.editor')
  const title = () => textOf(page.locator('.inspector h2'))
  const mark = (uid) => page.locator(`[data-annotation="${uid}"]`)
  // World units per screen pixel come from the canvas transform (the zoom).
  const scale = await page.evaluate(() => document.querySelector('svg.canvas').getScreenCTM().a)
  const worldOf = async (uid) =>
    page.evaluate((uid) => {
      const r = document.querySelector(`[data-annotation="${uid}"] rect`)
      return { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')) }
    }, uid)
  // Press on a mark's text (a frame's label tab, a note's box) and move by `dx, dy` world px.
  async function dragMark(uid, dx, dy, { escape = false } = {}) {
    const box = await mark(uid).locator('text').first().boundingBox()
    const x = box.x + 4
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 8 })
    if (escape) await page.keyboard.press('Escape')
    await page.mouse.up()
  }
  const clickMark = async (uid, { shift = false } = {}) => {
    const box = await mark(uid).locator('text').first().boundingBox()
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.click(box.x + 4, box.y + box.height / 2)
    if (shift) await page.keyboard.up('Shift')
  }
  // Points along the VCC wire's whole polyline, every 2 world px, in world coordinates.
  const wirePoints = () =>
    page.evaluate((uid) => {
      const path = document.querySelector(`[data-wire="${uid}"] path.wire-hit`)
      const n = path.getTotalLength()
      const pts = []
      for (let l = 0; l <= n; l += 2) {
        const p = path.getPointAtLength(l)
        pts.push({ x: p.x, y: p.y })
      }
      return { d: path.getAttribute('d'), pts }
    }, vcc.uid)
  const inside = (pts, r) => pts.filter((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h).length

  check((await mark(power.uid).count()) === 1 && (await mark(light.uid).count()) === 1 && (await mark(note.uid).count()) === 1, `${scheme}: both frames and the note are on the canvas`)

  // A note: select, drag on the grid (one undo step), Escape mid-drag puts it back.
  const n0 = await worldOf(note.uid)
  await dragMark(note.uid, -17, 38)
  const n1 = await worldOf(note.uid)
  check(n1.x === n0.x - 20 && n1.y === n0.y + 40, `${scheme}: dragging a note moves it on the 10 px grid (${n1.x - n0.x}, ${n1.y - n0.y})`)
  check((await title()) === 'Note', `${scheme}: the Inspector shows the note`)
  check((await mark(note.uid).locator('.annotation-selected').count()) === 1, `${scheme}: the note shows the selection outline`)
  await page.keyboard.press('Control+z')
  const n2 = await worldOf(note.uid)
  check(n2.x === n0.x && n2.y === n0.y, `${scheme}: one undo puts the dragged note back`)
  await page.keyboard.press('Control+y')
  await dragMark(note.uid, 60, 60, { escape: true })
  const n3 = await worldOf(note.uid)
  check(n3.x === n1.x && n3.y === n1.y, `${scheme}: Escape mid-drag leaves the note where it was`)

  // Over a breadboard, pressing the note drags the note: it never starts a wire from the hole under it.
  const bb = sheet.parts.find((p) => p.uid === 'BB1')
  const overBoard = { x: bb.x + 20, y: bb.y + 190 }
  await dragMark(note.uid, overBoard.x - n1.x, overBoard.y - n1.y)
  const onBoard = await worldOf(note.uid)
  check(onBoard.x === overBoard.x && onBoard.y === overBoard.y, `${scheme}: the note moved onto the breadboard (${onBoard.x}, ${onBoard.y})`)
  const wires = await page.locator('[data-wire]').count()
  const press = await mark(note.uid).locator('text').first().boundingBox()
  const hit = await page.evaluate(
    ({ uid, x, y }) => {
      const el = document.elementFromPoint(x, y)
      const p = new DOMPoint(x, y).matrixTransform(document.querySelector('svg.canvas').getScreenCTM().inverse())
      return { note: !!el?.closest(`[data-annotation="${uid}"]`), world: { x: p.x, y: p.y } }
    },
    { uid: note.uid, x: press.x + 4, y: press.y + press.height / 2 },
  )
  // Board holes (unrotated board) within 6 world px of the press.
  const holesNear = sheet.modules[bb.module].holes.flatMap((g) => g.at).filter(([hx, hy]) => Math.abs(bb.x + hx - hit.world.x) <= 6 && Math.abs(bb.y + hy - hit.world.y) <= 6).length
  check(hit.note && holesNear > 0, `${scheme}: the press lands on the note, right over the board's holes (${holesNear} within 6 px)`)
  await dragMark(note.uid, 30, 20)
  const dragged = await worldOf(note.uid)
  check(dragged.x === onBoard.x + 30 && dragged.y === onBoard.y + 20, `${scheme}: pressing the note over the board drags the note (${dragged.x - onBoard.x}, ${dragged.y - onBoard.y})`)
  check((await page.locator('[data-wire]').count()) === wires, `${scheme}: no wire was drawn from the hole under the note`)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  const back = await worldOf(note.uid)
  check(back.x === n1.x && back.y === n1.y, `${scheme}: two undos put the note back`)

  // Its text, in the Inspector: screenshot while it is being edited, then commit on blur.
  await clickMark(note.uid)
  const field = page.locator('#note-text')
  check((await field.inputValue()) === note.text, `${scheme}: the Text field holds the note`)
  await field.fill('Press S1 to light D1.\nRelease to switch it off.')
  await page.screenshot({ path: join(out, `note-edit-${scheme}.png`) })
  await field.press('Tab')
  const noteText = await textOf(mark(note.uid))
  check(noteText.includes('Release to switch it off.'), `${scheme}: editing the text updates the note on the canvas`)
  check((await mark(note.uid).locator('tspan').count()) === 2, `${scheme}: a two-line note draws two lines`)

  // A frame, by its label tab: rename it in the Inspector.
  await clickMark(power.uid)
  check((await title()) === 'Group frame', `${scheme}: clicking a frame's label tab selects the frame`)
  await page.locator('#frame-label').fill('Battery')
  await page.locator('#frame-label').press('Enter')
  check((await textOf(mark(power.uid))) === 'Battery', `${scheme}: editing the label updates the frame's tab`)
  await page.screenshot({ path: join(out, `frame-selected-${scheme}.png`) })

  // Move the frame so its label tab lands on the VCC wire: the drop re-routes the wire around it.
  const before = await wirePoints()
  const at = before.pts[Math.floor(before.pts.length / 2)]
  const p0 = await worldOf(power.uid)
  const tabW = 'Battery'.length * 5.6 + 12
  const target = { x: snap(at.x - 10 - tabW / 2), y: snap(at.y) }
  await dragMark(power.uid, target.x - p0.x, target.y - p0.y)
  const p1 = await worldOf(power.uid)
  check(p1.x === target.x && p1.y === target.y, `${scheme}: the frame moved to (${p1.x}, ${p1.y})`)
  const tab = await page.evaluate((uid) => {
    const r = document.querySelector(`[data-annotation="${uid}"] .annotation-grab rect`)
    return { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), w: Number(r.getAttribute('width')), h: Number(r.getAttribute('height')) }
  }, power.uid)
  check(inside(before.pts, tab) > 0, `${scheme}: before the move the wire ran where the label now sits`)
  const after = await wirePoints()
  await page.screenshot({ path: join(out, `frame-moved-${scheme}.png`) })
  check(after.d !== before.d && inside(after.pts, tab) === 0, `${scheme}: after moving the frame, the wire re-routes around its label`)
  await page.keyboard.press('Control+z')
  check((await wirePoints()).d === before.d, `${scheme}: undo puts the frame back and the wire on its old route`)
  await page.keyboard.press('Control+y')
  const redone = await wirePoints()
  check(redone.d === after.d && inside(redone.pts, tab) === 0, `${scheme}: redo re-routes the wire around the label again`)
  await page.keyboard.press('Control+z')

  // Shift+click selects a frame and a note together; Delete removes both, undo brings them back.
  await clickMark(light.uid)
  await clickMark(note.uid, { shift: true })
  check((await title()) === '2 items selected', `${scheme}: Shift+click adds the note to the frame's selection`)
  check(await page.getByRole('button', { name: 'Delete' }).first().isEnabled(), `${scheme}: the toolbar Delete is enabled for frames and notes`)
  await page.keyboard.press('Delete')
  check((await mark(light.uid).count()) === 0 && (await mark(note.uid).count()) === 0, `${scheme}: Delete removes the selected frame and note`)
  check((await title()) === 'Sheet', `${scheme}: the deleted marks leave the selection`)
  await page.keyboard.press('Control+z')
  check((await mark(light.uid).count()) === 1 && (await mark(note.uid).count()) === 1, `${scheme}: undo brings them back`)

  const download = await exportDownload(page)
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const byUid = (uid) => saved.annotations.find((a) => a.uid === uid)
  check(
    byUid(power.uid)?.label === 'Battery' && byUid(power.uid)?.x === p0.x &&
      byUid(note.uid)?.text === 'Press S1 to light D1.\nRelease to switch it off.' && byUid(note.uid)?.x === n1.x && byUid(note.uid)?.y === n1.y &&
      !!byUid(light.uid),
    `${scheme}: the exported file carries the moved and edited frames and notes`,
  )
  check(errors.length === 0, `${scheme}: no page errors ${errors.join('; ')}`)
  await page.close()
}
await browser.close()
done()
