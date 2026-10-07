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
//      and Run all asks first too.
// Every case runs at 1600 x 1000 and at 390 x 844 (the dock stacks the editor over Serial, the page
// scrolls, nothing scrolls sideways). After the light 1600 pass, the budgets of spec 9: starting to
// running with the files cached, the code worker's memory, run-state change to glow, and a first
// visit on a 50 Mbit/s line (with the Python transfer as GitHub Pages serves it, ruling R15). Once per
// scheme at 1600, the sandbox: user code reaches no network (spec 2.6, 10).
// Screenshots go to --out as code-<case>-<scheme>-<width>.png; open and look at each one.
// With --sw the built site is served with no headers, so the service worker isolates the page and
// adds the code worker's CSP, as on GitHub Pages.
// Usage (after `npm run build`): npm run check:code-ui -- [--out <dir>] [--port 4215] [--sw]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { checker, flagOf, launchChrome, startPreview, underSw } from './lib/browser-check.mjs'

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
// Waits, across the service worker's one reload of a first visit, until the page is isolated.
async function isolated(page, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    if (await page.evaluate(() => crossOriginIsolated && document.readyState === 'complete').catch(() => false)) return true
  }
  return false
}
for (const width of [1600, 390])
for (const scheme of ['light', 'dark']) {
  const height = width === 1600 ? 1000 : 844
  const narrow = width < 900
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  // At 390 px the editor page scrolls (the sheet, then the dock, the Inspector and the parts): each
  // state is shot from the top (the sheet and the dock's bar), the dock whole as code-<case>-dock-*,
  // and the Inspector's states with its Code section in view. Nothing may scroll sideways or overlap.
  // `focus` (a locator) is what a 390 px shot scrolls into view instead of the top of the page.
  const shot = async (name, focus) => {
    await page.mouse.move(5, height - 5)
    if (narrow) {
      const inspector = name.startsWith('inspector')
      if (inspector) focus = page.locator((await page.locator('.code-section').count()) ? '.code-section' : '.inspector')
      if (focus) await focus.first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
      else await page.evaluate(() => (document.querySelector('.editor').scrollTop = 0))
      check(await page.evaluate(() => [document.documentElement, document.querySelector('.editor'), document.querySelector('#code-dock')].every((el) => !el || el.scrollWidth <= el.clientWidth)), `${scheme} ${width}: ${name}: no sideways scroll`)
      // The page ends with its last panel (nothing hidden stretches it into blank space).
      const slack = await page.evaluate(() => {
        const e = document.querySelector('.editor')
        const end = Math.max(...[...e.children].map((c) => c.getBoundingClientRect().bottom)) - e.getBoundingClientRect().top + e.scrollTop
        return e.scrollHeight - end
      })
      check(slack <= 1, `${scheme} ${width}: ${name}: the page ends at its last panel (${slack.toFixed(0)} px past it)`)
      const stack = await page.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect()
        // The whole code pane (toolbar, any question or message, the editor, its foot) above all of Serial.
        const ed = box('#code-dock .code-pane'), se = box('#code-dock .serial')
        return ed && se && ed.height > 0 ? { edBottom: ed.bottom, edWidth: ed.width, seTop: se.top, seWidth: se.width } : null
      })
      if (stack) check(stack.seTop >= stack.edBottom && stack.edWidth <= width && stack.seWidth <= width, `${scheme} ${width}: ${name}: Serial sits under the editor`)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(out, `code-${name}-${scheme}-${width}.png`) })
      if (!inspector && !focus && (await page.locator('#code-dock').count())) await page.locator('#code-dock').screenshot({ path: join(out, `code-${name}-dock-${scheme}-${width}.png`) })
      return
    }
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, `code-${name}-${scheme}-${width}.png`) })
  }
  // The middle of the sheet's visible part (from the top of the page at 390 px), where the wheel zooms.
  const sheetMiddle = async () => {
    await page.evaluate(() => (document.querySelector('.editor').scrollTop = 0))
    const b = await page.locator('svg.canvas').boundingBox()
    return { x: b.x + b.width / 2, y: b.y + (Math.min(b.y + b.height, height) - b.y) / 2 }
  }
  // Selects U1 by clicking a point of the sheet that really hits it (at 390 px the page is scrolled to
  // the top first, and the sheet zoomed out until U1 shows in it).
  const selectU1 = async () => {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => (document.querySelector('.editor').scrollTop = 0))
      const hit = await page.evaluate(() => {
        const g = document.querySelector('[data-part="u1"]')
        const r = g.getBoundingClientRect(), c = document.querySelector('svg.canvas').getBoundingClientRect()
        for (let y = Math.max(r.top, c.top) + 6; y < Math.min(r.bottom, c.bottom, innerHeight); y += 8)
          for (let x = Math.max(r.left, c.left) + 6; x < Math.min(r.right, c.right, innerWidth); x += 8)
            if (g.contains(document.elementFromPoint(x, y))) return { x, y }
        return null
      })
      if (hit) return page.mouse.click(hit.x, hit.y)
      const m = await sheetMiddle()
      await page.mouse.move(m.x, m.y)
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(200)
    }
    throw new Error('U1 is not in view')
  }
  const tab = page.locator('[data-dock-tab="u1"]')
  const status = () => tab.getAttribute('data-status')
  const waitStatus = (s, timeout = 20000) => page.waitForFunction((want) => document.querySelector('[data-dock-tab="u1"]')?.getAttribute('data-status') === want, s, { timeout })
  // At 390 px the sheet opens at 100 % with most parts out of view: zoom out around the sheet's top
  // left corner, so the circuit shrinks into view.
  // Zooms around the sheet's top left corner until every part shows in the sheet's visible part
  // (the view keeps its zoom from one file to the next, so this zooms in as well as out).
  const fitNarrow = async () => {
    if (!narrow) return
    await page.evaluate(() => (document.querySelector('.editor').scrollTop = 0))
    const b = await page.locator('svg.canvas').boundingBox()
    await page.mouse.move(b.x + 10, b.y + 10)
    const fit = () =>
      page.evaluate(() => {
        const c = document.querySelector('svg.canvas').getBoundingClientRect()
        const boxes = [...document.querySelectorAll('svg.canvas [data-part]')].map((el) => el.getBoundingClientRect())
        const u = { l: Math.min(...boxes.map((r) => r.left)), t: Math.min(...boxes.map((r) => r.top)), r: Math.max(...boxes.map((r) => r.right)), b: Math.max(...boxes.map((r) => r.bottom)) }
        const bottom = Math.min(c.bottom, innerHeight)
        return { fits: u.l >= c.left && u.t >= c.top && u.r <= c.right && u.b <= bottom, roomy: u.r - c.left < 0.6 * c.width && u.b - c.top < 0.6 * (bottom - c.top) }
      })
    for (let i = 0, zoomedIn = false; i < 16; i++) {
      const f = await fit()
      if (f.fits && !f.roomy) break
      if (!f.fits && zoomedIn) {
        await page.mouse.wheel(0, 120) // one step too far in: back out
        break
      }
      zoomedIn ||= f.fits
      await page.mouse.wheel(0, f.fits ? -120 : 120)
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(200)
  }
  const open = async (path) => {
    await page.locator('.toolbar input[type=file]').setInputFiles(path)
    await page.waitForSelector('svg.canvas [data-part]')
    await fitNarrow()
  }
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  check(await isolated(page), `${scheme} ${width}: the preview is cross-origin isolated`)
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // 1. idle
  await open(blinkFile)
  await page.waitForSelector('#code-dock')
  check((await tab.textContent())?.includes('U1') && (await tab.textContent())?.includes('blink.py'), `${scheme} ${width}: the tab names U1 and blink.py`)
  check((await status()) === 'idle', `${scheme} ${width}: idle at first`)
  check((await tab.getAttribute('title')) === 'U1 Raspberry Pi 4 Model B blink.py, Not running', `${scheme} ${width}: the tab's title holds its full label`)
  // The editor follows the theme (its --code-* tokens): a light page in light, Graphite in dark.
  const editorBg = await page.locator('.code-editor').evaluate((el) => getComputedStyle(el).backgroundColor)
  check(editorBg === (scheme === 'dark' ? 'rgb(31, 35, 40)' : 'rgb(247, 248, 243)'), `${scheme} ${width}: the editor uses the ${scheme} code background (${editorBg})`)
  await shot('idle')

  // 2. starting (the Python download is held for 1.5 s)
  await page.route('**/py/**/pyodide.asm.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue().catch(() => {}) // unroute below may have let it through already
  })
  await page.locator('[data-run="u1"]').click()
  await waitStatus('starting')
  check(await page.waitForSelector('.code-dock progress', { timeout: 5000 }).then(() => true, () => false), `${scheme} ${width}: starting shows the download progress`)
  await shot('starting')
  await page.unroute('**/py/**/pyodide.asm.wasm')

  // 3. running: the glow toggles
  await waitStatus('running', 30000)
  const levels = new Set()
  for (let i = 0; i < 30 && levels.size < 2; i++) {
    levels.add(await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => null))
    await page.waitForTimeout(150)
  }
  check(levels.size >= 2, `${scheme} ${width}: the LED glow toggles while blink runs (${[...levels].join(', ')})`)
  check((await page.locator('[data-run-badge="u1"].running').count()) === 1, `${scheme} ${width}: the running board has a green "running" badge`)
  check((await page.locator('[data-run="u1"]').getAttribute('aria-label')) === "Stop U1's code", `${scheme} ${width}: the button's name follows the state`)
  await shot('running')

  // 4. changed
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('# edited\n')
  await waitStatus('changed')
  check((await page.locator('.code-dock').textContent())?.includes('Code changed: Reset to apply'), `${scheme} ${width}: "Code changed: Reset to apply"`)
  await shot('changed')

  // 6. stopped (before 5, on this sheet)
  const undoBefore = await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  check((await page.getAttribute('[data-sim-led="d1"]', 'data-sim-level').catch(() => '0')) === '0.00' || !(await page.locator('[data-sim-led="d1"]').count()), `${scheme} ${width}: Stop restores the saved states (LED dark)`)
  check(undoBefore === false, `${scheme} ${width}: the code edit is on the undo stack`)
  await shot('stopped')

  // 7. collapsed, Ctrl+`, Escape then Tab
  await page.locator('.code-editor .cm-content').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => !document.activeElement?.closest('.cm-editor')), `${scheme} ${width}: Escape then Tab leaves the editor`)
  await page.locator('.code-dock-collapse').click()
  check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) <= 29, `${scheme} ${width}: collapsed to a 28 px bar`)
  check((await page.locator('#code-dock [data-dock-tab="u1"]').getAttribute('data-status')) === 'stopped', `${scheme} ${width}: the bar still shows the status`)
  await shot('collapsed')
  await page.keyboard.press('Control+`')
  check((await page.locator('#code-dock').getAttribute('data-dock-open')) === 'true', `${scheme} ${width}: Ctrl+\` opens the dock again`)

  // 5. error, with the traceback link
  await open(boomFile)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('error', 30000)
  const ref = page.locator('.serial-ref').first()
  check((await ref.textContent()) === 'File "boom.py", line 4', `${scheme} ${width}: the traceback names the script line`)
  await ref.click()
  check((await page.locator('.cm-activeLine').textContent())?.includes("raise RuntimeError('boom')"), `${scheme} ${width}: the link moves the cursor to line 4`)
  check((await page.locator('[data-run-badge="u1"].error').count()) === 1, `${scheme} ${width}: an error badge`)
  await shot('error')
  // The jump belongs to U1's editor: moving along the tabs keeps focus on the tablist (C20).
  await tab.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  const onTab = () => page.evaluate(() => document.activeElement?.getAttribute('data-dock-tab'))
  check((await onTab()) === 'u2', `${scheme} ${width}: after a traceback jump, ArrowRight keeps focus on the tabs`)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(500)
  check((await onTab()) === 'u1', `${scheme} ${width}: and coming back to U1 does not jump into its editor again`)

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
  // Zoom the sheet out so the servo shows above the dock (at 390 px opening did that already).
  if (!narrow) {
    const m = await sheetMiddle()
    await page.mouse.move(m.x, m.y)
  }
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120)
  const horn = () => page.getAttribute('[data-servo-horn="m1"]', 'data-angle').then(Number, () => NaN)
  const angles = new Set()
  for (let i = 0; i < 40 && angles.size < 3; i++) {
    angles.add(await horn())
    await page.waitForTimeout(100)
  }
  check(angles.size >= 3, `${scheme} ${width}: the servo horn moves (${[...angles].join(', ')})`)
  for (const [name, hit] of [['low', (a) => a < 5], ['high', (a) => a > 175]]) {
    for (let i = 0; i < 60 && !hit(await horn()); i++) await page.waitForTimeout(100)
    await shot(`servo-${name}`)
  }
  // Close up, so the horn and the tags read at full size (at 1600 px; the 390 px shots above show the
  // same horn at the narrow layout's zoom).
  if (!narrow) {
    const hb = await page.locator('[data-part="m1"]').first().boundingBox()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120)
    for (const [name, hit] of [['low', (a) => a < 5], ['high', (a) => a > 175]]) {
      for (let i = 0; i < 60 && !hit(await horn()); i++) await page.waitForTimeout(100)
      await shot(`servo-zoom-${name}`)
      const sb = await page.locator('[data-part="m1"]').first().boundingBox()
      const cx = Math.max(220, sb.x - 20), cy = Math.max(50, sb.y - 40)
      await page.screenshot({ path: join(out, `code-servo-crop-${name}-${scheme}-${width}.png`), clip: { x: cx, y: cy, width: Math.min(sb.width + 40, 1100), height: Math.min(sb.height + 80, 680) } })
    }
  }
  check(((await page.locator(".probe-layer").textContent()) ?? "").includes("avg "), `${scheme} ${width}: probe tags read "avg" while PWM runs`)
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
  check((await page.locator('[data-run-finding="servo-signal"]').count()) === 1 && (await page.locator('[data-run-finding="floating-read"]').count()) === 1, `${scheme} ${width}: one servo-signal and one floating-read finding, not repeated`)
  await page.locator('[data-run-finding="floating-read"]').scrollIntoViewIfNeeded()
  await shot('findings', page.locator('[data-run-finding]'))
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')

  // 14. The Probes panel's About the simulator has a Running code paragraph.
  await page.getByRole('button', { name: 'Probe', exact: true }).click()
  await page.locator('summary', { hasText: 'About the simulator' }).click()
  await page.getByRole('heading', { name: 'Running code' }).scrollIntoViewIfNeeded()
  check((await page.locator('details', { hasText: 'About the simulator' }).textContent())?.includes('A read can lag the circuit by one solve'), `${scheme} ${width}: About the simulator has the Running code paragraph`)
  await shot('about', page.getByRole('heading', { name: 'Running code' }))
  await page.getByRole('button', { name: 'Probe', exact: true }).click()

  // 8. link: code that came in a link asks once before running (spec 2.6)
  const link = linkOf(blinkFile)
  check(link.url !== null, `${scheme} ${width}: the CLI made a link for blink.py`)
  await page.goto(link.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('#code-dock')
  await fitNarrow()
  await page.locator('[data-run="u1"]').click()
  const confirm = page.locator('.code-confirm')
  check((await confirm.textContent())?.includes('This code came with the link. Run runs it in your browser, with no access to other sites.'), `${scheme} ${width}: the first Run of linked code asks`)
  check((await status()) === 'idle', `${scheme} ${width}: nothing runs before the answer`)
  await shot('link')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  check((await confirm.count()) === 0 && (await status()) === 'idle', `${scheme} ${width}: Cancel closes the question and runs nothing`)
  await page.locator('[data-run="u1"]').click()
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  await waitStatus('running', 30000)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')
  await page.locator('[data-run="u1"]').click()
  await waitStatus('running', 30000)
  check((await confirm.count()) === 0, `${scheme} ${width}: it asks once, not on the next Run`)
  await page.locator('[data-run="u1"]').click()
  await waitStatus('stopped')

  // tabs: two coded boards from a link; the tablist's keys (spec 6.4); Run all asks first too
  const two = linkOf(twoFile)
  await page.goto(two.url.replace('https://mbarc.github.io/circuitoon/', base), { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-dock-tab="u2"]')
  check((await page.locator('#code-dock [role=tab]').count()) === 2, `${scheme} ${width}: one tab per coded board`)
  await tab.focus()
  await page.keyboard.press('ArrowRight')
  const focusedTab = () => page.evaluate(() => document.activeElement?.getAttribute('data-dock-tab'))
  check((await focusedTab()) === 'u2' && (await page.locator('[data-dock-tab="u2"]').getAttribute('aria-selected')) === 'true', `${scheme} ${width}: ArrowRight selects and focuses the next tab`)
  await page.keyboard.press('Home')
  check((await focusedTab()) === 'u1', `${scheme} ${width}: Home goes to the first tab`)
  await page.keyboard.press('End')
  check((await focusedTab()) === 'u2', `${scheme} ${width}: End goes to the last tab`)
  check((await page.locator('[data-dock-tab="u1"]').getAttribute('tabindex')) === '-1', `${scheme} ${width}: only the selected tab is in the Tab order`)
  await page.getByRole('button', { name: 'Run all', exact: true }).click()
  check((await confirm.count()) === 1, `${scheme} ${width}: Run all of linked code asks first`)
  // Zoom the sheet out so both boards show above the dock.
  if (narrow) await fitNarrow()
  else {
    const m = await sheetMiddle()
    await page.mouse.move(m.x, m.y)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120)
  }
  await shot('tabs')
  if (narrow) check((await page.locator('.code-dock-tabs').evaluate((el) => getComputedStyle(el).overflowX)) === 'auto', `${scheme} ${width}: the tabs scroll sideways inside the dock`)
  await confirm.getByRole('button', { name: 'Cancel' }).click()

  // A tall dock saved in a tall window still leaves the sheet room in a short one (at most 70 %).
  // At 390 px the dock takes its natural height and has no grip.
  if (!narrow) {
    const grip = await page.locator('.code-dock-handle').boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 4)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, 40, { steps: 5 })
    await page.mouse.up()
    await page.setViewportSize({ width: 1600, height: 600 })
    check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) <= 420.5, `${scheme} ${width}: the dock stays within 70 % of a shorter window`)
    await page.locator('.code-dock-handle').focus()
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
    // At the smallest dock the editor and the serial log keep room to be used (at least 40 px each).
    const tall = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height)
    check((await page.locator('#code-dock').evaluate((el) => el.getBoundingClientRect().height)) >= 200, `${scheme} ${width}: the dock never shrinks below 200 px`)
    check((await tall('#code-dock .cm-content')) >= 40 && (await tall('#code-dock .serial-log')) >= 40, `${scheme} ${width}: at the minimum height the editor and serial log are each 40 px or more`)
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp') // back to 260 for the shots below
    await page.setViewportSize({ width, height })
  }

  // 9. The Inspector's Code section: Write code opens the dock with the starter; Remove code is undoable.
  const plain = piSheet('plain', '')
  const raw = JSON.parse(readFileSync(plain, 'utf8'))
  raw.parts = raw.parts.map((p) => (p.uid === 'u1' ? { ...p, code: undefined } : p))
  writeFileSync(plain, JSON.stringify(raw))
  await open(plain)
  check((await page.locator('#code-dock').count()) === 0, `${scheme} ${width}: no dock on a sheet with no code`)
  await selectU1()
  await page.waitForSelector('.code-section')
  await shot('inspector-empty')
  await page.getByRole('button', { name: 'Write code' }).click()
  await page.waitForSelector('#code-dock .cm-content')
  check((await page.locator('.cm-content').textContent())?.includes('# Code for U1'), `${scheme} ${width}: Write code starts from the starter comment`)
  await selectU1()
  check((await page.locator('.code-section').textContent())?.match(/main\.py.*Raspberry Pi Python.*\d+ lines/s) !== null, `${scheme} ${width}: the section shows the file, language and line count`)
  await shot('inspector-code')
  await page.getByRole('button', { name: 'Remove code' }).click()
  check((await page.locator('#code-dock').count()) === 0 && (await page.locator('.code-section button', { hasText: 'Write code' }).count()) === 1, `${scheme} ${width}: Remove code removes it and the dock closes`)
  await page.keyboard.press('Control+z')
  check((await page.locator('.code-section').textContent())?.includes('main.py'), `${scheme} ${width}: Remove code is undone by Undo`)
  // 10. An upload with the wrong extension is refused with the reason.
  const ino = join(out, 'blink.ino')
  writeFileSync(ino, 'void setup() {}\n')
  await page.locator('.code-section input[type=file]').setInputFiles(ino)
  check((await page.locator('.code-section [role=alert]').textContent()) === 'blink.ino is not Raspberry Pi Python code: it needs a .py file', `${scheme} ${width}: a .ino upload is refused with the reason`)
  await shot('inspector-refused')

  // 11. The section follows a run: Stop while it runs, the Error status after a traceback.
  await open(blinkFile)
  await selectU1()
  await page.locator('.code-section').getByRole('button', { name: /^Run U1/ }).click()
  await waitStatus('running', 30000)
  check((await page.locator('.code-section').textContent())?.includes('Running') && (await page.locator('.code-section').getByRole('button', { name: /^Stop U1/ }).count()) === 1, `${scheme} ${width}: the section shows Running and Stop`)
  await shot('inspector-running')
  await page.locator('.code-section').getByRole('button', { name: /^Stop U1/ }).click()
  await waitStatus('stopped')
  await open(boomFile)
  await selectU1()
  await page.locator('.code-section').getByRole('button', { name: /^Run U1/ }).click()
  await waitStatus('error', 30000)
  check((await page.locator('.code-section').textContent())?.includes('Error'), `${scheme} ${width}: the section shows the Error status`)
  await shot('inspector-error')

  if (!narrow) {
    // The worker sandbox (spec 2.6, 10): user code cannot reach the network through js, run_js or the
    // worker's prototypes; the CSP blocks eval, so the Function constructor escape fails too.
    const probe = piSheet('sandbox', [
      'import js',
      "print('fetch in js:', hasattr(js, 'fetch'))",
      'from pyodide.code import run_js',
      "for src in ['fetch(\"https://example.com/\")', 'self.constructor.constructor(\"return fetch\")()', 'Object.getPrototypeOf(self).fetch']:",
      '    try:',
      '        run_js(src)',
      "        print('ran', src)",
      '    except Exception as e:',
      "        print('blocked:', type(e).__name__)",
      // run_js stops at its own `from js import eval` (js is the curated scope), so the escapes are
      // tried again from the one JS object user code can reach without js, the hardware bridge (and
      // pyodide_js, which Pyodide registers, must be gone).
      "for go in [lambda: __import__('pyodide_js'), lambda: __import__('circuitoon_hw').constructor.constructor('return fetch')()('https://example.com/'), lambda: __import__('circuitoon_hw').constructor.constructor('return globalThis')().fetch('https://example.com/'), lambda: __import__('circuitoon_hw').constructor.prototype.fetch('https://example.com/')]:",
      '    try:',
      '        go()',
      "        print('ran')",
      '    except Exception as e:',
      "        print('blocked:', type(e).__name__, str(e).splitlines()[0][:70] if str(e) else '')",
    ].join('\n') + '\n')
    const foreign = []
    const origin = base.slice(0, base.indexOf('/circuitoon/'))
    const onRequest = (r) => !r.url().startsWith(origin) && foreign.push(r.url())
    page.on('request', onRequest)
    await open(probe)
    await page.locator('[data-run="u1"]').click()
    const ended = await waitStatus('done', 30000).then(() => true, () => false)
    const said = await page.$$eval('.serial-line', (els) => els.map((e) => e.textContent))
    check(ended && said[0] === 'fetch in js: False' && said.length === 8 && said.slice(1).every((l) => l.startsWith('blocked:')), `${scheme} ${width}: user code reaches no network (status ${await status()}: ${said.join(' | ')})`)
    check(!foreign.some((u) => u.includes('example.com')), `${scheme} ${width}: no request left the origin (${foreign.join(', ') || 'none'})`)
    page.off('request', onRequest)
    await shot('sandbox')
  }

  if (scheme === 'light' && width === 1600) {
    // Starting to running with the files cached (spec 9: 2.5 s): Reset reuses the fetched files.
    await open(blinkFile)
    await page.locator('[data-run="u1"]').click()
    await waitStatus('running', 30000)
    await page.locator('[data-run="u1"]').click()
    await waitStatus('stopped')
    const t0 = Date.now()
    await page.locator('[data-run="u1"]').click()
    await waitStatus('running', 30000)
    const warm = Date.now() - t0
    check(warm <= 2500, `budget: starting to running, files cached: ${warm} ms (budget 2500 ms)`)
    // Memory per running board (spec 9: 120 MB): the code worker's share.
    const mem = await page.evaluate(async () => {
      const r = await performance.measureUserAgentSpecificMemory()
      return r.breakdown.filter((b) => b.attribution.some((a) => a.scope === 'DedicatedWorkerGlobalScope')).reduce((s, b) => s + b.bytes, 0)
    })
    check(mem / 1048576 <= 120, `budget: code worker memory ${(mem / 1048576).toFixed(1)} MB (budget 120 MB)`)
    await page.locator('[data-run="u1"]').click()
    await waitStatus('stopped')
    // Run-state change to re-solved glow (spec 9): the code prints time.time() at each toggle; the
    // glow's change is timed in the page; p95 of the delay at most 50 ms with no PWM.
    const toggles = piSheet('toggles', 'import time\nfrom gpiozero import LED\nled = LED(17)\nfor i in range(24):\n    led.toggle()\n    print(repr(time.time()))\n    time.sleep(0.4)\n')
    await open(toggles)
    await page.evaluate(() => {
      window.__glow = []
      new MutationObserver(() => window.__glow.push(Date.now())).observe(document.querySelector('svg.canvas'), { subtree: true, attributes: true, attributeFilter: ['data-sim-level'] })
    })
    await page.locator('[data-run="u1"]').click()
    await waitStatus('done', 60000)
    const printed = await page.$$eval('.serial-line.out', (els) => els.map((e) => Number(e.textContent) * 1000))
    const glow = await page.evaluate(() => window.__glow)
    const delays = printed.map((t) => (glow.find((g) => g >= t) ?? Infinity) - t).sort((a, b) => a - b)
    const p95 = delays[Math.floor(delays.length * 0.95)]
    check(printed.length === 24 && p95 <= 50, `budget: run-state change to glow, no PWM: p95 ${p95.toFixed(0)} ms over ${printed.length} toggles, median ${delays[delays.length >> 1]?.toFixed(0)} ms (budget 50 ms)`)
    // First visit on a 50 Mbit/s line with nothing cached (spec 9: 6 s, with progress). Not under
    // --sw: the page's network emulation does not reach the service worker's own fetches, so the
    // Python files would arrive unthrottled.
    if (underSw) console.log('skip budget: first visit, 50 Mbit/s (the throttle does not reach the service worker; run without --sw)')
    else {
      const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
      const fp = await fresh.newPage()
      const pyFiles = new Set()
      fp.on('response', (r) => r.url().includes('/py/') && pyFiles.add(r.url().slice(r.url().lastIndexOf('/') + 1)))
      let pyDone = 0
      fp.on('requestfinished', (r) => r.url().includes('/py/') && (pyDone = Date.now()))
      const cdp = await fresh.newCDPSession(fp)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 50e6 / 8, uploadThroughput: 10e6 / 8 })
      await fp.goto(base + '#/editor', { waitUntil: 'networkidle' })
      await isolated(fp)
      await fp.getByRole('button', { name: /New diagram/ }).click()
      await fp.locator('.toolbar input[type=file]').setInputFiles(blinkFile)
      await fp.waitForSelector('[data-run="u1"]')
      const t1 = Date.now()
      await fp.locator('[data-run="u1"]').click()
      await fp.waitForFunction(() => document.querySelector('[data-dock-tab="u1"]')?.getAttribute('data-status') === 'running', null, { timeout: 60000 })
      const cold = Date.now() - t1
      check(cold <= 6000, `budget: first visit, 50 Mbit/s, starting to running: ${cold} ms, the last Python file in at ${pyDone - t1} ms, as served here uncompressed (budget 6000 ms)`)
      // The Python transfer of that first Run as GitHub Pages serves it (ruling R15: gzip where Pages
      // compresses the type, .wasm, .mjs and .json; the stdlib zip raw).
      const dir = join('dist', 'py', JSON.parse(readFileSync('src/run/pyManifest.json', 'utf8')).version)
      const served = [...pyFiles].reduce((sum, f) => {
        const bytes = readFileSync(join(dir, f))
        return sum + (f.endsWith('.zip') ? bytes.length : gzipSync(bytes, { level: 6 }).length)
      }, 0)
      check(pyFiles.has('pyodide.asm.wasm') && served <= 8 * 1048576, `budget: first-Run Python transfer as Pages serves it ${(served / 1048576).toFixed(2)} MB (budget 8 MB; ${[...pyFiles].join(', ')})`)
      await fresh.close()
    }
  }

  check(!errors.length, `${scheme} ${width}: no page errors (${errors.join(' | ')})`)
  await context.close()
}
await browser.close()
done()
