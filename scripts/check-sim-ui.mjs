// Browser check for live simulation (docs/superpowers/specs/2026-10-05-live-simulation-design.md,
// sections 6, 8 and 9), in the built app, light and dark:
//   1. LEDs: glow at three currents (100 ohm, 1 k, 10 k from 3 V), an LED with no resistor over its
//      absolute maximum (dark red, warning ring, badge); probes of every kind: a pin, a part, a
//      breadboard hole, a capacitor-only plate ("floating") and an outlet's live hole ("not simulated (mains)").
//   2. Brownout: a DevKit on 3 V: the brownout badge, and both finding groups in the side panel.
//   3. Supplies: the Probes panel with the Supplies table.
//   4. Failure: a solve that cannot finish (every run is swapped for the engine's debug hang text and
//      the run timeout is cut to 300 ms): the banner, stale readings.
//   5. Budgets: Simulate's cold start (at most 1.5 s, with progress shown) and a 200-part drag with
//      Simulate on (median frame at most 17.5 ms: 60 fps). Both depend on machine load: rerun on a
//      quiet machine before ship; never relax them.
// Screenshots go to --out as sim-<case>-<scheme>.png; review each one by eye.
// Usage (after `npm run build`): npm run check:sim-ui -- [--out <dir>] [--port 4212]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const out = resolve(flagOf('--out', '.superpowers/sim-ui'))
const port = Number(flagOf('--port', '4212'))
mkdirSync(out, { recursive: true })

const ids = ['battery-holder-2xaa', 'resistor', 'led', 'capacitor-ceramic', 'breadboard-mini', 'outlet-us-5-15r-duplex', 'esp32-devkit-v1-30', 'oled-ssd1306-096-i2c']
const modules = Object.fromEntries(ids.map((id) => [id, JSON.parse(readFileSync(`modules/${id}.json`, 'utf8'))]))
const at = (uid, designator, module, x, y, extra = {}) => ({ uid, designator, module, x, y, rotation: 0, ...extra })
const ohms = (v) => ({ values: { resistance: { value: v, unit: 'ohm' } } })
const file = (name, title, parts, connections, probes) => {
  const path = join(out, `sim-${name}.circuitoon.json`)
  const used = new Set(parts.map((p) => p.module))
  writeFileSync(path, JSON.stringify({ format: 'circuitoon-diagram/1', title, modules: Object.fromEntries(Object.entries(modules).filter(([id]) => used.has(id))), parts, connections, ...(probes ? { probes } : {}) }))
  return path
}
const w = (uid, a, ap, b, bp, extra = {}) => ({ uid, from: { part: a, pin: ap, ...(extra.fromHole !== undefined ? { hole: extra.fromHole } : {}) }, to: { part: b, pin: bp, ...(extra.toHole !== undefined ? { hole: extra.toHole } : {}) }, color: 'blue', gauge: 22 })

// 1. Three LEDs from 3 V at 100 ohm, 1 k and 10 k, a fourth with no resistor; a capacitor with one
// plate free; a mini breadboard column fed from the battery; an outlet (mains: undefined).
const ledParts = [at('bt1', 'BT1', 'battery-holder-2xaa', 40, 200)]
const ledWires = []
;[100, 1000, 10000].forEach((r, i) => {
  ledParts.push(at(`r${i}`, `R${i + 1}`, 'resistor', 220, 60 + i * 90, ohms(r)), at(`d${i}`, `D${i + 1}`, 'led', 380, 60 + i * 90))
  ledWires.push(w(`wa${i}`, 'bt1', '+', `r${i}`, '1'), w(`wb${i}`, `r${i}`, '2', `d${i}`, 'A'), w(`wc${i}`, `d${i}`, 'K', 'bt1', '-'))
})
ledParts.push(at('d9', 'D9', 'led', 380, 360), at('c1', 'C1', 'capacitor-ceramic', 520, 20), at('bb1', 'BB1', 'breadboard-mini', 560, 200), at('o1', 'J1', 'outlet-us-5-15r-duplex', 60, 420))
ledWires.push(w('wd', 'bt1', '+', 'd9', 'A'), w('we', 'd9', 'K', 'bt1', '-'), w('wf', 'c1', '1', 'bt1', '+'), w('wg', 'bt1', '+', 'bb1', 'c1-top', { toHole: 0 }))
const ledFile = file('leds', 'LEDs and probes', ledParts, ledWires, [
  { id: 'P1', name: 'BT1 +', at: { part: 'bt1', pin: '+' } },
  { id: 'P2', at: { part: 'd0' } },
  { id: 'P3', at: { part: 'bb1', pin: 'c1-top', hole: 3 } },
  { id: 'P4', name: 'C1 free plate', at: { part: 'c1', pin: '2' } },
  { id: 'P5', name: 'mains L', at: { part: 'o1', pin: 'L1' } },
])
// 2. A DevKit V1 fed 3 V on VIN: it browns out; the OLED shares its 3V3.
const brownFile = file('brownout', 'DevKit on 3 V', [at('bt1', 'BT1', 'battery-holder-2xaa', 40, 120), at('u1', 'U1', 'esp32-devkit-v1-30', 300, 40), at('ds1', 'DS1', 'oled-ssd1306-096-i2c', 580, 60)],
  [w('w1', 'bt1', '+', 'u1', 'VIN'), w('w2', 'bt1', '-', 'u1', 'GND'), w('w3', 'u1', '3V3', 'ds1', 'VCC'), w('w4', 'u1', 'GND 2', 'ds1', 'GND')])
// 5. 200 parts: a battery and 99 resistor-LED pairs, for the drag budget.
const bigParts = [at('bt1', 'BT1', 'battery-holder-2xaa', 0, 0)]
const bigWires = []
for (let i = 0; i < 99; i++) {
  bigParts.push(at(`r${i}`, `R${i + 1}`, 'resistor', 150 + (i % 11) * 160, 40 + Math.floor(i / 11) * 70, ohms(220 + i)), at(`d${i}`, `D${i + 1}`, 'led', 230 + (i % 11) * 160, 40 + Math.floor(i / 11) * 70))
  bigWires.push(w(`a${i}`, 'bt1', '+', `r${i}`, '1'), w(`b${i}`, `r${i}`, '2', `d${i}`, 'A'), w(`c${i}`, `d${i}`, 'K', 'bt1', '-'))
}
const bigFile = file('big', '200 parts', bigParts, bigWires)

const { base } = await startPreview(port)
const { check, done } = checker()
const budgets = {}
const browser = await launchChrome()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme })
  // The failure case: while window.__hang is set, every engine run is swapped for the debug hang
  // text, which the worker spins on until the host's timeout terminates it (host.ts DEBUG_HANG_TEXT).
  await context.addInitScript(() => {
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (m, ...rest) {
      return post.call(this, window.__hang && m?.type === 'run' ? { ...m, texts: m.texts.map(() => '* circuitoon: debug hang') } : m, ...rest)
    }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const shot = async (name) => {
    const path = join(out, `sim-${name}-${scheme}.png`)
    await page.mouse.move(5, 995)
    await page.waitForTimeout(300)
    await page.screenshot({ path })
    console.log('saved', path)
  }
  const simulate = page.locator('button.sim-toggle')
  const phase = () => simulate.getAttribute('data-sim-phase')
  const solved = async () => page.waitForFunction(() => document.querySelector('button.sim-toggle')?.getAttribute('data-sim-phase') === 'done', null, { timeout: 15000 })
  /** Imports a sheet the way check-usb-ui does (the toolbar's hidden file input), with Simulate off, so the next Simulate solves it afresh. */
  const open = async (path) => {
    if ((await phase()) !== 'off') await simulate.click()
    await page.locator('input[type=file]').setInputFiles(path)
    await page.waitForTimeout(500)
    await page.waitForSelector('svg.canvas [data-part]')
  }
  /** The middle of a part's largest art rectangle (its body), where a click or a drag grabs it. */
  const body = (uid) => page.evaluate((u) => {
    let best
    for (const r of document.querySelectorAll(`[data-part="${u}"] rect`)) {
      const x = r.getBoundingClientRect()
      if (!best || x.width * x.height > best.width * best.height) best = x
    }
    return { x: best.x + best.width / 2, y: best.y + best.height / 2 }
  }, uid)
  const simOn = async () => {
    await simulate.click()
    await solved()
  }
  await page.goto(base + '#/editor', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /New diagram/ }).click()
  await page.waitForSelector('.toolbar')

  // 1. LEDs and probes; the cold start (the engine chunk, the wasm and the first solve) is measured
  // on the first Simulate of the light pass, polling in the page so the 15 ms steps do not add up.
  await open(ledFile)
  const watch = page.evaluate(() => new Promise((res) => {
    const t0 = performance.now()
    let sawProgress = false
    const poll = () => {
      const mark = document.querySelector('button.sim-toggle')?.getAttribute('data-sim-phase')
      if (mark === 'loading' || document.querySelector('.sim-status progress')) sawProgress = true
      if (mark === 'done' || mark === 'failed' || performance.now() - t0 > 15000) res({ ms: performance.now() - t0, sawProgress, mark })
      else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  }))
  await simulate.click()
  const cold = await watch
  await solved()
  if (scheme === 'light') {
    budgets.cold = cold.ms
    check(cold.ms <= 1500, `cold start ${cold.ms.toFixed(0)} ms (budget 1500 ms)`)
    check(cold.sawProgress, 'load progress was shown')
  }
  const levels = await page.$$eval('[data-sim-led]', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-sim-led'), Number(e.getAttribute('data-sim-level'))])))
  check(levels.d0 > levels.d1 && levels.d1 > levels.d2 && levels.d2 > 0, `glow follows current: ${JSON.stringify(levels)}`)
  check((await page.locator('[data-sim-led="d9"] .sim-ring').count()) === 1, 'the LED with no resistor has the warning ring')
  check((await page.locator('[data-sim-badge]').count()) > 0, 'simulation badges are drawn')
  const tags = await page.$$eval('[data-probe] .probe-text', (els) => els.map((e) => e.textContent))
  console.log('tags', JSON.stringify(tags))
  check(tags.length === 5, `five probe tags (${tags.length})`)
  check(tags.every((t) => !/undefined/.test(t)) && tags.some((t) => /not simulated \(mains\)/.test(t)), 'the mains probe says why in words, never "undefined"')
  check(tags.some((t) => /floating/.test(t)), 'a floating tag reads "floating"')
  check(tags.some((t) => /mA/.test(t)), 'a part probe reads current')
  check(tags.filter((t) => /\d V\b|\dV\b/.test(t)).length >= 2, 'the pin and hole probes read volts')
  await shot('leds')
  // 2. Brownout, and both groups in the side panel (nothing selected shows the sheet's lists).
  await open(brownFile)
  await simOn()
  await page.keyboard.press('Escape')
  check((await page.locator('#problems-title').textContent())?.includes('Wiring checks (any switch position'), 'the checker group is titled for any switch position')
  check((await page.locator('#sim-title').textContent())?.includes('Simulation (current state)'), 'the simulation group is there')
  check((await page.locator('.sim-group li').filter({ hasText: /browns out|not enough voltage/i }).count()) > 0, 'the brownout is listed')
  check((await page.locator('[data-sim-badge~="u1"]').count()) > 0, 'the DevKit has a badge')
  await shot('brownout')
  // 3. Supplies. The toolbar's Probe button (the P key only acts with focus on the sheet).
  const probeTool = page.locator('button[title^="Place probes"]')
  await probeTool.click()
  await page.waitForSelector('.probes-panel .supplies table')
  check((await page.locator('.supplies tbody tr').count()) >= 3, 'Supplies lists the battery, the regulator and the domains')
  await shot('supplies')
  await probeTool.click()
  // 4. Failure: every run hangs from now on and times out at 300 ms; an edit re-solves and fails.
  await open(ledFile)
  await simOn()
  await page.evaluate((key) => {
    localStorage.setItem(key, '300')
    window.__hang = true
  }, 'circuitoon.simTimeoutMs')
  const r0 = await body('r0')
  await page.mouse.click(r0.x, r0.y)
  await page.locator('#part-value').fill('150')
  await page.locator('#part-value').press('Enter')
  await page.waitForSelector('.sim-status.failed', { timeout: 20000 })
  check((await page.locator('[data-sim-stale]').count()) === 1, 'the last good readings stay, dimmed and marked stale')
  const staleTag = await page.$eval('[data-probe-stale] [data-probe] .probe-box', (box) => ({ layer: getComputedStyle(box.closest('.probe-layer')).opacity, box: getComputedStyle(box).opacity, text: getComputedStyle(box.parentElement.querySelector('.probe-text')).fill }))
  check(staleTag.layer === '1' && staleTag.box === '1' && staleTag.text !== 'rgb(35, 40, 47)', `stale probe tags dim their words only, the tag stays opaque: ${JSON.stringify(staleTag)}`)
  check(!(await page.locator('.sim-status.failed details').getAttribute('open').catch(() => null)), 'the failure details start closed')
  await page.keyboard.press('Escape')
  await shot('failure')
  await page.evaluate((key) => {
    localStorage.removeItem(key)
    window.__hang = false
  }, 'circuitoon.simTimeoutMs')
  // 5. The 200-part drag with Simulate on (light pass only).
  if (scheme === 'light') {
    await open(bigFile)
    await simOn()
    const grab = await body('r0')
    await page.evaluate(() => {
      window.__frames = []
      let last = performance.now()
      const tick = (t) => {
        window.__frames.push(t - last)
        last = t
        if (!window.__stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grab.x + 300, grab.y + 120, { steps: 90 })
    await page.mouse.up()
    // Only the drag's own frames: idle frames after the drop would pull the median toward 16.7 ms.
    const frames = (await page.evaluate(() => (window.__stop = true) && window.__frames)).slice(5).sort((a, b) => a - b)
    const median = frames[Math.floor(frames.length / 2)]
    const p95 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))]
    const max = frames[frames.length - 1]
    const moved = await body('r0')
    check(Math.abs(moved.x - grab.x - 300) < 30 && Math.abs(moved.y - grab.y - 120) < 30, 'the drag moved R1 with the pointer')
    budgets.drag = median
    budgets.dragP95 = p95
    budgets.dragMax = max
    check(median <= 17.5, `200-part drag median frame ${median.toFixed(1)} ms over ${frames.length} frames (budget 17.5 ms; 60 fps is 16.7 ms); p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`)
  }
  check(errors.length === 0, `no page errors (${errors.join('; ')})`)
  await context.close()
}
await browser.close()
console.log(`budgets: cold start ${budgets.cold?.toFixed(0)} ms (<= 1500), 200-part drag median frame ${budgets.drag?.toFixed(1)} ms (<= 17.5), p95 ${budgets.dragP95?.toFixed(1)} ms, max ${budgets.dragMax?.toFixed(1)} ms; both depend on machine load`)
done()
