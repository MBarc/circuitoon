// Browser check for code on boards (firmware spec 6 and 10), in the built app, light and dark:
//   1. idle: a Pi 4 sheet with blink code opens with the dock: one tab, "Not running".
//   2. starting: Run with the Python download slowed: "Starting", with progress.
//   3. running: GPIO17's LED glow toggles; the tab says "Running".
//   4. changed: typing in the editor while it runs says "Code changed: Reset to apply"; the sheet's
//      undo stack gains the edit; the run goes on.
//   5. error: an exception stops the board ("Error"); its traceback line link moves the cursor there.
//   6. stopped: Stop restores the saved states, the file stays unchanged and undo is untouched.
//   7. collapsed: the 28 px bar still shows each board's status; Ctrl+` toggles it; Escape then Tab
//      leaves the editor.
//   8. link: code that came in a link asks once before running.
//   tabs: two boards with code from a link: a tab each, arrow keys, Home and End move between them,
//      and Run all asks first too. Then the narrow (390 px) layout, open and collapsed.
// Screenshots go to --out as code-<case>-<scheme>.png; open and look at each one.
// Usage (after `npm run build`): npm run check:code-ui -- [--out <dir>] [--port 4215]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/code-ui'))
const port = Number(flagOf('--port', '4215'))
mkdirSync(out, { recursive: true })
const ids = ['battery-holder-4xaa', 'rpi-4-model-b', 'resistor', 'led', 'push-button', 'servo-sg90']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const w = (uid, a, ap, b, bp) => ({ uid, from: { part: a, pin: ap }, to: { part: b, pin: bp }, color: 'blue', gauge: 22 })
const BLINK = 'from gpiozero import LED\nfrom signal import pause\n\nled = LED(17)\nled.blink()\npause()\n'
const BOOM = "import time\n\ntime.sleep(0.5)\nraise RuntimeError('boom')\n"
export function piSheet(name, source, extra = { parts: [], wires: [] }) {
  const parts = [
    at('bt1', 'BT1', 'battery-holder-4xaa', 40, 260, { values: { voltage: { value: 5, unit: 'V' } } }),
    at('u1', 'U1', 'rpi-4-model-b', 260, 60, { code: { language: 'python-rpi', source, file: `${name}.py` } }),
    // R1 and D1 sit under the Pi, so the LED is in view above the dock at 1600 x 1000.
    at('r1', 'R1', 'resistor', 420, 345, { values: { resistance: { value: 330, unit: 'ohm' } } }),
    at('d1', 'D1', 'led', 560, 335, { values: { color: 'red' } }),
    ...extra.parts,
  ]
  const connections = [w('w1', 'bt1', '+', 'u1', '5V'), w('w2', 'bt1', '-', 'u1', 'GND'), w('w3', 'u1', 'GPIO17', 'r1', '1'), w('w4', 'r1', '2', 'd1', 'A'), w('w5', 'd1', 'K', 'u1', 'GND 2'), ...extra.wires]
  const used = new Set(parts.map((p) => p.module))
  const path = join(out, `code-${name}.circuitoon.json`)
  writeFileSync(path, JSON.stringify({ format: 'circuitoon-diagram/1', title: name, modules: Object.fromEntries(Object.entries(modules).filter(([id]) => used.has(id))), parts, connections }))
  return path
}
const blinkFile = piSheet('blink', BLINK)
const boomFile = piSheet('boom', BOOM, { parts: [at('u2', 'U2', 'rpi-4-model-b', 900, 60, { code: { language: 'python-rpi', source: "print('hi')\n", file: 'hi.py' } })], wires: [] })
const twoFile = piSheet('two', BLINK, { parts: [at('u2', 'U2', 'rpi-4-model-b', 700, 60, { code: { language: 'python-rpi', source: "print('hello')\n", file: 'hello.py' } })], wires: [] })
const linkOf = (file) => JSON.parse(execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', 'link', file, '--json'], { encoding: 'utf8' }))

const { base } = await startPreview(port)
const { check, done } = checker()
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const shot = async (name) => {
    await page.mouse.move(5, 995)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, `code-${name}-${scheme}.png`) })
  }
  const tab = page.locator('[data-dock-tab="u1"]')
  const status = () => tab.getAttribute('data-status')
  const waitStatus = (s, timeout = 20000) => page.waitForFunction((want) => document.querySelector('[data-dock-tab="u1"]')?.getAttribute('data-status') === want, s, { timeout })
  const open = async (path) => {
    await page.locator('.toolbar input[type=file]').setInputFiles(path)
    await page.waitForSelector('svg.canvas [data-part]')
  }
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  check(await page.evaluate(() => crossOriginIsolated), `${scheme}: the preview is cross-origin isolated`)
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // 1. idle
  await open(blinkFile)
  await page.waitForSelector('#code-dock')
  check((await tab.textContent())?.includes('U1') && (await tab.textContent())?.includes('blink.py'), `${scheme}: the tab names U1 and blink.py`)
  check((await status()) === 'idle', `${scheme}: idle at first`)
  check((await tab.getAttribute('title')) === 'U1 Raspberry Pi 4 Model B blink.py, Not running', `${scheme}: the tab's title holds its full label`)
  // The editor follows the theme (its --code-* tokens): a light page in light, Graphite in dark.
  const editorBg = await page.locator('.code-editor').evaluate((el) => getComputedStyle(el).backgroundColor)
  check(editorBg === (scheme === 'dark' ? 'rgb(31, 35, 40)' : 'rgb(247, 248, 243)'), `${scheme}: the editor uses the ${scheme} code background (${editorBg})`)
  await shot('idle')

  // 2. starting (the Python download is held for 1.5 s)
  await page.route('**/py/**/pyodide.asm.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue().catch(() => {}) // unroute below may have let it through already
  })
  await page.locator('[data-run="u1"]').click()
  await waitStatus('starting')
  check(await page.waitForSelector('.code-dock progress', { timeout: 5000 }).then(() => true, () => false), `${scheme}: starting shows the download progress`)
  await shot('starting')
  await page.unroute('**/py/**/pyodide.asm.wasm')

  // 3. running: the glow toggles
  await waitStatus('running', 30000)
  const levels = new Set()
  for (let i = 0; i < 30 && levels.size < 2; i++) {
    levels.add(await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => null))
    await page.waitForTimeout(150)
  }
  check(levels.size >= 2, `${scheme}: the LED glow toggles while blink runs (${[...levels].join(', ')})`)
  check((await page.locator('[data-run-badge="u1"].running').count()) === 1, `${scheme}: the running board has a green "running" badge`)
  check((await page.locator('[data-run="u1"]').getAttribute('aria-label')) === "Stop U1's code", `${scheme}: the button's name follows the state`)
  await shot('running')

  // 4. changed
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('# edited\n')
  await waitStatus('changed')
  check((await page.locator('.code-dock').textContent())?.includes('Code changed: Reset to apply'), `${scheme}: "Code changed: Reset to apply"`)
  await shot('changed')

  // 6. stopped (before 5, on this sheet)
  const undoBefore = await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  check((await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => '0')) === '0.00' || !(await page.locator('[data-sim-led="d1"]').count()), `${scheme}: Stop restores the saved states (LED dark)`)
  check(undoBefore === false, `${scheme}: the code edit is on the undo stack`)
  await shot('stopped')

  // 7. collapsed, Ctrl+`, Escape then Tab
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => !document.activeElement?.closest('.cm-editor')), `${scheme}: Escape then Tab leaves the editor`)
  await page.locator('.code-dock-collapse').click()
  check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) <= 29, `${scheme}: collapsed to a 28 px bar`)
  check((await page.locator('#code-dock [data-dock-tab="u1"]').getAttribute('data-status')) === 'stopped', `${scheme}: the bar still shows the status`)
  await shot('collapsed')
  await page.keyboard.press('Control+`')
  check((await page.locator('#code-dock').getAttribute('data-dock-open')) === 'true', `${scheme}: Ctrl+\` opens the dock again`)

  // 5. error, with the traceback link
  await open(boomFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('error', 30000)
  const ref = page.locator('.serial-ref').first()
  check((await ref.textContent()) === 'File "boom.py", line 4', `${scheme}: the traceback names the script line`)
  await ref.click()
  check((await page.locator('.cm-activeLine').textContent())?.includes("raise RuntimeError('boom')"), `${scheme}: the link moves the cursor to line 4`)
  check((await page.locator('[data-run-badge="u1"].error').count()) === 1, `${scheme}: an error badge`)
  await shot('error')
  // The jump belongs to U1's editor: moving along the tabs keeps focus on the tablist (C20).
  await tab.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  const onTab = () => page.evaluate(() => document.activeElement?.getAttribute('data-dock-tab'))
  check((await onTab()) === 'u2', `${scheme}: after a traceback jump, ArrowRight keeps focus on the tabs`)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(500)
  check((await onTab()) === 'u1', `${scheme}: and coming back to U1 does not jump into its editor again`)

  // 12. A servo turns: AngularServo sweeps; the horn's angle follows; the run finding list stays empty.
  const servoFile = piSheet('servo', 'from gpiozero import AngularServo\nimport time\ns = AngularServo(18, min_angle=0, max_angle=180, min_pulse_width=0.0005, max_pulse_width=0.0024)\nwhile True:\n    s.angle = 0\n    time.sleep(1)\n    s.angle = 180\n    time.sleep(1)\n', {
    parts: [at('m1', 'M1', 'servo-sg90', 640, 300)],
    wires: [w('w6', 'u1', 'GPIO18', 'm1', 'PWM'), w('w7', 'bt1', '+', 'm1', 'VCC'), w('w8', 'bt1', '-', 'm1', 'GND')],
  })
  const rawServo = JSON.parse(readFileSync(servoFile, 'utf8'))
  rawServo.probes = [{ id: 'P1', at: { part: 'm1', pin: 'PWM' } }, { id: 'P2', at: { part: 'm1', pin: 'VCC' } }]
  writeFileSync(servoFile, JSON.stringify(rawServo))
  await open(servoFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  // Zoom the sheet out so the servo shows above the dock.
  await page.mouse.move(775, 300)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120)
  const horn = () => page.getAttribute('[data-servo-horn="m1"]', 'data-angle').then(Number, () => NaN)
  const angles = new Set()
  for (let i = 0; i < 40 && angles.size < 3; i++) {
    angles.add(await horn())
    await page.waitForTimeout(100)
  }
  check(angles.size >= 3, `${scheme}: the servo horn moves (${[...angles].join(', ')})`)
  for (const [name, hit] of [['low', (a) => a < 5], ['high', (a) => a > 175]]) {
    for (let i = 0; i < 60 && !hit(await horn()); i++) await page.waitForTimeout(100)
    await shot(`servo-${name}`)
  }
  // Close up, so the horn and the tags read at full size.
  const hb = await page.locator('[data-part="m1"]').first().boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120)
  for (const [name, hit] of [['low', (a) => a < 5], ['high', (a) => a > 175]]) {
    for (let i = 0; i < 60 && !hit(await horn()); i++) await page.waitForTimeout(100)
    await shot(`servo-zoom-${name}`)
    const sb = await page.locator('[data-part="m1"]').first().boundingBox()
    await page.screenshot({ path: join(out, `code-servo-crop-${name}-${scheme}.png`), clip: { x: Math.max(220, sb.x - 20), y: Math.max(50, sb.y - 40), width: Math.min(sb.width + 40, 1100), height: Math.min(sb.height + 80, 680) } })
  }
  check(((await page.locator(".probe-layer").textContent()) ?? "").includes("avg "), `${scheme}: probe tags read "avg" while PWM runs`)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')

  // 13. Run-time findings: a floating read and an out-of-range servo signal, once each.
  const findFile = piSheet('findings', 'import RPi.GPIO as GPIO\nimport time\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(5, GPIO.IN)\nGPIO.setup(18, GPIO.OUT)\np = GPIO.PWM(18, 1000)\np.start(50)\nwhile True:\n    GPIO.input(5)\n    time.sleep(0.2)\n', {
    parts: [at('m1', 'M1', 'servo-sg90', 640, 300)],
    wires: [w('w6', 'u1', 'GPIO18', 'm1', 'PWM'), w('w7', 'bt1', '+', 'm1', 'VCC'), w('w8', 'bt1', '-', 'm1', 'GND')],
  })
  await open(findFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  await page.waitForSelector('[data-run-finding="servo-signal"]', { timeout: 20000 }).catch(() => {})
  await page.waitForSelector('[data-run-finding="floating-read"]', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  check((await page.locator('[data-run-finding="servo-signal"]').count()) === 1 && (await page.locator('[data-run-finding="floating-read"]').count()) === 1, `${scheme}: one servo-signal and one floating-read finding, not repeated`)
  await page.locator('[data-run-finding="floating-read"]').scrollIntoViewIfNeeded()
  await shot('findings')
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')

  // 14. The Probes panel's About the simulator has a Running code paragraph.
  await page.getByRole('button', { name: 'Probe', exact: true }).click()
  await page.locator('summary', { hasText: 'About the simulator' }).click()
  await page.getByRole('heading', { name: 'Running code' }).scrollIntoViewIfNeeded()
  check((await page.locator('details', { hasText: 'About the simulator' }).textContent())?.includes('A read can lag the circuit by one solve'), `${scheme}: About the simulator has the Running code paragraph`)
  await shot('about')
  await page.getByRole('button', { name: 'Probe', exact: true }).click()

  // 8. link: code that came in a link asks once before running (spec 2.6)
  const link = linkOf(blinkFile)
  check(link.url !== null, `${scheme}: the CLI made a link for blink.py`)
  await page.goto(link.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('#code-dock')
  await page.locator('[data-run="u1"]').click()
  const confirm = page.locator('.code-confirm')
  check((await confirm.textContent())?.includes('This code came with the link. Run runs it in your browser, with no access to other sites.'), `${scheme}: the first Run of linked code asks`)
  check((await status()) === 'idle', `${scheme}: nothing runs before the answer`)
  await shot('link')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  check((await confirm.count()) === 0 && (await status()) === 'idle', `${scheme}: Cancel closes the question and runs nothing`)
  await page.locator('[data-run="u1"]').click()
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  await waitStatus('running', 30000)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  check((await confirm.count()) === 0, `${scheme}: it asks once, not on the next Run`)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')

  // tabs: two coded boards from a link; the tablist's keys (spec 6.4); Run all asks first too
  const two = linkOf(twoFile)
  await page.goto(two.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-dock-tab="u2"]')
  check((await page.locator('#code-dock [role=tab]').count()) === 2, `${scheme}: one tab per coded board`)
  await tab.focus()
  await page.keyboard.press('ArrowRight')
  const focusedTab = () => page.evaluate(() => document.activeElement?.getAttribute('data-dock-tab'))
  check((await focusedTab()) === 'u2' && (await page.locator('[data-dock-tab="u2"]').getAttribute('aria-selected')) === 'true', `${scheme}: ArrowRight selects and focuses the next tab`)
  await page.keyboard.press('Home')
  check((await focusedTab()) === 'u1', `${scheme}: Home goes to the first tab`)
  await page.keyboard.press('End')
  check((await focusedTab()) === 'u2', `${scheme}: End goes to the last tab`)
  check((await page.locator('[data-dock-tab="u1"]').getAttribute('tabindex')) === '-1', `${scheme}: only the selected tab is in the Tab order`)
  await page.getByRole('button', { name: 'Run all', exact: true }).click()
  check((await confirm.count()) === 1, `${scheme}: Run all of linked code asks first`)
  // Zoom the sheet out so both boards show above the dock.
  await page.mouse.move(775, 300)
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120)
  await shot('tabs')
  await confirm.getByRole('button', { name: 'Cancel' }).click()

  // A tall dock saved in a tall window still leaves the sheet room in a short one (at most 70 %).
  const grip = await page.locator('.code-dock-handle').boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 4)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, 40, { steps: 5 })
  await page.mouse.up()
  await page.setViewportSize({ width: 1600, height: 600 })
  check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) <= 420.5, `${scheme}: the dock stays within 70 % of a shorter window`)
  await page.locator('.code-dock-handle').focus()
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
  // At the smallest dock the editor and the serial log keep room to be used (at least 40 px each).
  const tall = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height)
  check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) >= 200, `${scheme}: the dock never shrinks below 200 px`)
  check((await tall('#code-dock .cm-content')) >= 40 && (await tall('#code-dock .serial-log')) >= 40, `${scheme}: at the minimum height the editor and serial log are each 40 px or more`)
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp') // back to 260 for the shots below

  // narrow: 390 px, the dock under the sheet, then collapsed
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-dock-tab="u1"]').click()
  await page.locator('#code-dock').scrollIntoViewIfNeeded()
  check(await page.evaluate(() => [document.documentElement, document.querySelector('.editor'), document.querySelector('#code-dock')].every((el) => el.scrollWidth <= el.clientWidth)), `${scheme}: no sideways scroll at 390 px`)
  await page.locator('#code-dock').screenshot({ path: join(out, `code-narrow-${scheme}.png`) })
  await page.screenshot({ path: join(out, `code-narrow-page-${scheme}.png`) })
  await page.locator('.code-dock-collapse').click()
  await page.screenshot({ path: join(out, `code-narrow-collapsed-${scheme}.png`) })

  // 9. The Inspector's Code section: Write code opens the dock with the starter; Remove code is undoable.
  await page.setViewportSize({ width: 1600, height: 1000 })
  const plain = piSheet('plain', '')
  const raw = JSON.parse(readFileSync(plain, 'utf8'))
  raw.parts = raw.parts.map((p) => (p.uid === 'u1' ? { ...p, code: undefined } : p))
  writeFileSync(plain, JSON.stringify(raw))
  await open(plain)
  check((await page.locator('#code-dock').count()) === 0, `${scheme}: no dock on a sheet with no code`)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  await page.waitForSelector('.code-section')
  await shot('inspector-empty')
  await page.getByRole('button', { name: 'Write code' }).click()
  await page.waitForSelector('#code-dock .cm-content')
  check((await page.locator('.cm-content').textContent())?.includes('# Code for U1'), `${scheme}: Write code starts from the starter comment`)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  check((await page.locator('.code-section').textContent())?.match(/main\.py.*Raspberry Pi Python.*\d+ lines/s) !== null, `${scheme}: the section shows the file, language and line count`)
  await shot('inspector-code')
  await page.getByRole('button', { name: 'Remove code' }).click()
  check((await page.locator('#code-dock').count()) === 0 && (await page.locator('.code-section button', { hasText: 'Write code' }).count()) === 1, `${scheme}: Remove code removes it and the dock closes`)
  await page.keyboard.press('Control+z')
  check((await page.locator('.code-section').textContent())?.includes('main.py'), `${scheme}: Remove code is undone by Undo`)
  // 10. An upload with the wrong extension is refused with the reason.
  const ino = join(out, 'blink.ino')
  writeFileSync(ino, 'void setup() {}\n')
  await page.locator('.code-section input[type=file]').setInputFiles(ino)
  check((await page.locator('.code-section [role=alert]').textContent()) === 'blink.ino is not Raspberry Pi Python code: it needs a .py file', `${scheme}: a .ino upload is refused with the reason`)
  await shot('inspector-refused')

  // 11. The section follows a run: Stop while it runs, the Error status after a traceback.
  await open(blinkFile)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  await page.locator('.code-section').getByRole('button', { name: /^Run U1/ }).click()
  await waitStatus('running', 30000)
  check((await page.locator('.code-section').textContent())?.includes('Running') && (await page.locator('.code-section').getByRole('button', { name: /^Stop U1/ }).count()) === 1, `${scheme}: the section shows Running and Stop`)
  await shot('inspector-running')
  await page.locator('.code-section').getByRole('button', { name: /^Stop U1/ }).click()
  await waitStatus('stopped')
  await open(boomFile)
  await page.locator('[data-part="u1"]').first().click({ position: { x: 40, y: 40 } })
  await page.locator('.code-section').getByRole('button', { name: /^Run U1/ }).click()
  await waitStatus('error', 30000)
  check((await page.locator('.code-section').textContent())?.includes('Error'), `${scheme}: the section shows the Error status`)
  await shot('inspector-error')

  check(!errors.length, `${scheme}: no page errors (${errors.join(' | ')})`)
  await context.close()
}
await browser.close()
done()
