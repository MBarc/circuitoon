// Browser check for net labels. Opens an ESP32-C3 SuperMini and a BME280 (no wires) in the built
// editor, then through the real UI: places two net labels from the Parts panel, wires the C3's pin
// 8 to one and the BME280's SDA to the other, names both SDA in the Inspector and confirms they
// connect (the checker's "connects to nothing else" warning goes once the second label is named,
// and hovering pin 8 lights the BME280's SDA through both labels), renames one to SCL (they part,
// both warn), undoes that in one step (they join again), and checks the highlight: hovering or
// selecting a label lights every label of its name, and the Inspector lists the other one. Saves
// light and dark screenshots of the editor, and renders a small sheet with GND, 5V, SDA and SCL
// labels through the CLI (light and dark) to .superpowers/labels-*.png.
//
// Usage (after `npm run build` and `npm run build:cli`): npm run check:labels-ui -- [--out <dir>] [--port 4199] [--shots <dir>]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'
import { worldPins } from '../src/format/geometry.ts'

const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-labels-ui')))
const port = Number(flagOf('--port', '4199'))
const shots = resolve(flagOf('--shots', '.superpowers'))
mkdirSync(out, { recursive: true })
mkdirSync(shots, { recursive: true })

const mod = (id) => JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))
const modules = Object.fromEntries(['esp32-c3-supermini', 'bme280-module-4pin', 'net-label', 'oled-ssd1306-096-i2c'].map((id) => [id, mod(id)]))

// ---- The editor sheet: two boards, no wires, room for labels between them. ----
const start = {
  format: 'circuitoon-diagram/1', title: 'Labels', modules: { 'esp32-c3-supermini': modules['esp32-c3-supermini'], 'bme280-module-4pin': modules['bme280-module-4pin'] },
  parts: [
    { uid: 'u1', designator: 'U1', module: 'esp32-c3-supermini', x: 0, y: 0, rotation: 0 },
    { uid: 'u2', designator: 'U2', module: 'bme280-module-4pin', x: 520, y: 20, rotation: 0 },
  ],
  connections: [],
}
const sheetFile = join(out, 'labels.circuitoon.json')
writeFileSync(sheetFile, JSON.stringify(start, null, 2))

// ---- The screenshot sheet: every pin a label stands for, its label 30 px out, pointing back. ----
/** A label for `pin` of `part`, its point facing the pin, 30 px out along the pin. */
function labelFor(uid, part, pin, name) {
  const m = modules[part.module]
  const p = worldPins(part, m).find((x) => x.name === pin)
  const lab = modules['net-label']
  for (const rotation of [0, 90, 180, 270]) {
    const at0 = worldPins({ x: 0, y: 0, rotation }, lab)[0]
    if (at0.dir.x !== -p.dir.x || at0.dir.y !== -p.dir.y) continue
    const want = { x: p.end.x + p.dir.x * 30, y: p.end.y + p.dir.y * 30 }
    return { part: { uid, designator: uid.toUpperCase(), module: 'net-label', x: want.x - at0.end.x, y: want.y - at0.end.y, rotation, values: { net: name } }, wire: { uid: `w-${uid}`, from: { part: part.uid, pin }, to: { part: uid, pin: 'NET' } } }
  }
  throw new Error(`no rotation faces ${pin}`)
}
const c3 = { uid: 'u1', designator: 'U1', module: 'esp32-c3-supermini', x: 40, y: 40, rotation: 0 }
const oled = { uid: 'u2', designator: 'U2', module: 'oled-ssd1306-096-i2c', x: 330, y: 70, rotation: 0 }
const wanted = [
  ['n1', c3, '5V', '5V'], ['n2', c3, 'G', 'GND'], ['n3', c3, '8', 'SDA'], ['n4', c3, '9', 'SCL'],
  ['n5', oled, 'GND', 'GND'], ['n6', oled, 'VCC', '5V'], ['n7', oled, 'SCL', 'SCL'], ['n8', oled, 'SDA', 'SDA'],
]
const placed = wanted.map(([uid, part, pin, name]) => labelFor(uid, part, pin, name))
const demo = {
  format: 'circuitoon-diagram/1', title: 'Net labels', modules,
  parts: [c3, oled, ...placed.map((x) => x.part)],
  connections: placed.map((x) => x.wire),
}
const demoFile = join(out, 'labels-demo.circuitoon.json')
writeFileSync(demoFile, JSON.stringify(demo, null, 2))

const { base } = await startPreview(port)
const { check, done } = checker()

// The demo sheet through the CLI: no findings (every label has a partner), drawn light and dark.
const cli = (args) => execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', ...args], { encoding: 'utf8' })
let findings = []
try {
  findings = JSON.parse(cli(['check', demoFile, '--json'])).findings
} catch (e) {
  findings = JSON.parse(e.stdout).findings ?? [{ message: String(e) }]
}
check(findings.length === 0, `the GND/5V/SDA/SCL sheet checks clean through the CLI${findings.length ? ` (got ${findings.map((f) => f.message).join(' | ')})` : ''}`)
cli(['render', demoFile, '-o', join(shots, 'labels-sheet-light.png')])
cli(['render', demoFile, '-o', join(shots, 'labels-sheet-dark.png'), '--dark'])

const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}#/editor`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(sheetFile)
  await page.waitForSelector('.editor')
  const pause = (ms = 150) => page.waitForTimeout(ms)
  const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

  /** Screen centre of an element. */
  const centre = async (sel) => {
    const b = await page.locator(sel).first().boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const pinAt = (part, pin) => centre(`circle[data-pin="${pin}"][data-pin-part="${part}"]`)
  /** The middle of a label's flag (its outline path). */
  const flagAt = async (uid) => {
    const b = await page.locator(`[data-part="${uid}"] [data-net-label] path`).nth(1).boundingBox()
    return { x: b.x + b.width * 0.6, y: b.y + b.height / 2 }
  }
  async function drawWire(a, b) {
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
    await page.mouse.move(b.x, b.y, { steps: 4 })
    await page.mouse.up()
    await pause()
  }
  async function selectLabel(uid) {
    const at = await flagAt(uid)
    await page.mouse.click(at.x, at.y)
    await pause()
    await page.locator('#label-name').waitFor()
  }
  async function rename(uid, name) {
    await selectLabel(uid)
    await page.locator('#label-name').fill(name)
    await page.locator('#label-name').press('Enter')
    await pause()
  }
  /** The checker's messages, read from the Problems list with nothing selected. */
  async function problems() {
    await blur()
    await page.keyboard.press('Escape')
    await pause()
    return page.locator('.problem-message').allTextContents()
  }
  /** How many points light up while hovering a pin (the net highlight is one path of circles). */
  async function litFrom(part, pin) {
    const at = await pinAt(part, pin)
    await page.mouse.move(at.x, at.y)
    await pause()
    const d = (await page.locator('path.net-hi').getAttribute('d').catch(() => null)) ?? ''
    await page.mouse.move(5, 5)
    return (d.match(/M/g) ?? []).length
  }
  const lit = () => page.locator('[data-label-lit]').count()

  // Place two labels from the Parts panel (each lands mid-view, selected), nudged apart.
  const libItem = page.locator('.lib-item', { hasText: 'Net label' })
  check((await libItem.count()) === 1, `${scheme}: the Parts panel lists Net label`)
  const group = await page.locator('.lib-group', { has: libItem }).locator('.lib-group-head span').first().textContent()
  check(group === 'Wiring', `${scheme}: Net label sits in the Wiring group (got ${group})`)
  await libItem.click()
  await pause()
  await blur()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowUp')
  await libItem.click()
  await pause()
  await blur()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown')
  await pause()
  const labels = await page.locator('svg.canvas [data-net-label]').count()
  check(labels === 2, `${scheme}: two labels are on the sheet (got ${labels})`)
  const uids = await page.locator('g[data-part]').evaluateAll((gs) => gs.filter((g) => g.querySelector('[data-net-label]')).map((g) => g.getAttribute('data-part')))
  const [a, b] = uids

  // Wire the C3's pin 8 to label a, the BME280's SDA to label b.
  await drawWire(await pinAt('u1', '8'), await pinAt(a, 'NET'))
  await drawWire(await pinAt('u2', 'SDA'), await pinAt(b, 'NET'))
  check((await page.locator('g[data-wire]').count()) >= 2, `${scheme}: both wires are drawn`)
  const unnamed = await problems()
  check(unnamed.filter((m) => /net label with no name/.test(m)).length === 2, `${scheme}: two unnamed labels are errors (got ${unnamed.join(' | ')})`)

  // Name both SDA: they join.
  await rename(a, 'SDA')
  const alone = await problems()
  check(alone.some((m) => m.startsWith('Label SDA connects to nothing else')), `${scheme}: one label SDA warns it connects to nothing else`)
  await rename(b, 'SDA')
  const joined = await problems()
  check(!joined.some((m) => /Label SDA|net label with no name/.test(m)), `${scheme}: with two labels SDA the warning is gone (got ${joined.join(' | ')})`)
  const four = await litFrom('u1', '8')
  check(four === 4, `${scheme}: hovering U1 pin 8 lights its net through both labels to U2 SDA (4 points, got ${four})`)

  // Rename one to SCL: they part; undo is one step and they join again.
  await rename(b, 'SCL')
  const parted = await problems()
  check(parted.some((m) => m.startsWith('Label SDA connects')) && parted.some((m) => m.startsWith('Label SCL connects')), `${scheme}: renamed SCL, both labels warn`)
  check((await litFrom('u1', '8')) === 2, `${scheme}: renamed SCL, pin 8 reaches only its own label`)
  await page.keyboard.press('Control+z')
  await pause()
  const undone = await problems()
  check(!undone.some((m) => /Label S/.test(m)), `${scheme}: one undo puts SDA back`)
  check((await litFrom('u1', '8')) === 4, `${scheme}: after undo pin 8 reaches U2 SDA again`)
  await selectLabel(b)
  check((await page.locator('#label-name').inputValue()) === 'SDA', `${scheme}: the Inspector shows SDA after undo`)

  // Highlight: selecting a label lights both and lists the other; hovering does too.
  await selectLabel(a)
  check((await lit()) === 2, `${scheme}: a selected label lights both labels named SDA`)
  const mates = await page.locator('.label-mates').textContent()
  check(/Also named SDA/.test(mates) && mates.includes('NL2'), `${scheme}: the Inspector lists the other SDA label (got "${mates}")`)
  await page.locator('.inspector').screenshot({ path: join(shots, `labels-inspector-${scheme}.png`) })
  await page.locator('.canvas-wrap').screenshot({ path: join(shots, `labels-ui-${scheme}.png`) })
  await blur()
  await page.keyboard.press('Escape')
  await page.mouse.move(5, 5)
  await pause()
  check((await lit()) === 0, `${scheme}: nothing is lit with nothing selected or hovered`)
  const over = await flagAt(b)
  await page.mouse.move(over.x, over.y)
  await pause()
  check((await lit()) === 2, `${scheme}: hovering a label lights both labels named SDA`)
  await page.mouse.move(5, 5)
  await pause()
  check((await lit()) === 0, `${scheme}: moving off clears the light`)

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? ` (${errors.join('; ')})` : ''}`)
  await context.close()
}

await browser.close()
done()
