// Browser check for the Inspector's value field: a number box plus a unit dropdown. Lays out three
// fresh resistors and a ceramic capacitor through the circuitoon CLI, opens them in the built
// editor, then through the real UI: a fresh 1 kOhm resistor shows 1 with kOhm picked; picking Ohm
// then typing 330 gives 330 Ohm; a bare number is read in the picked unit and switching the
// dropdown keeps the number (330 kOhm -> 330 Ohm); typed text with its own prefix or unit (4k7,
// 330R, 330 ohm, 220p) overrides the dropdown, which moves to match; Escape puts the old number
// back, bad input shows the hint and stays in the box, a standard-value suggestion is accepted; the capacitor switches
// nF and uF; undo and redo move the value and the dropdown together. Every commit is checked on
// the part's caption on the sheet. Saves light and dark screenshots of the Inspector.
//
// Usage (after `npm run build`): npm run check:values-ui -- [--out <dir>] [--port 4196]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checker, flagOf, launchChrome, startPreview } from './lib/browser-check.mjs'

const OHM = 'Ω' // ohm sign, as formatValue writes it
const MICRO = 'µ'
const out = resolve(flagOf('--out', join(tmpdir(), 'circuitoon-values-ui')))
const port = Number(flagOf('--port', '4196'))
mkdirSync(out, { recursive: true })

const netlist = {
  format: 'circuitoon-netlist/1',
  title: 'Values',
  parts: [
    { ref: 'R1', module: 'resistor' },
    { ref: 'R2', module: 'resistor' },
    { ref: 'R3', module: 'resistor' },
    { ref: 'C1', module: 'capacitor-ceramic' },
  ],
  nets: [],
}
const netlistFile = join(out, 'values.netlist.json')
const sheetFile = join(out, 'values.circuitoon.json')
writeFileSync(netlistFile, JSON.stringify(netlist, null, 2))
execFileSync(process.execPath, ['plugin/bin/circuitoon.mjs', 'layout', netlistFile, '-o', sheetFile], { stdio: 'ignore' })
const sheet = JSON.parse(readFileSync(sheetFile, 'utf8'))
const uid = Object.fromEntries(sheet.parts.map((p) => [p.designator, p.uid]))

const shots = resolve(flagOf('--shots', '.superpowers'))
mkdirSync(shots, { recursive: true })
const { base } = await startPreview(port)
const { check, done } = checker()
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
  const pause = (ms = 120) => page.waitForTimeout(ms)

  const number = page.locator('#part-value')
  const unit = page.locator('#part-value-unit')
  const hint = page.locator('.inspector .hint[role=status]')
  /** The unit shown picked in the dropdown, as its visible label ("kOhm"). */
  const picked = () => unit.evaluate((s) => s.selectedOptions[0]?.textContent ?? '')
  const caption = (ref) => page.locator(`[data-part="${uid[ref]}"] text`).allTextContents().then((t) => t.join(' '))
  /** Selects a part by clicking the middle of its largest art rectangle (its body). */
  async function select(ref) {
    const b = await page.evaluate((u) => {
      let best
      for (const r of document.querySelectorAll(`[data-part="${u}"] rect`)) {
        const x = r.getBoundingClientRect()
        if (!best || x.width * x.height > best.width * best.height) best = x
      }
      return { x: best.x + best.width / 2, y: best.y + best.height / 2 }
    }, uid[ref])
    await page.mouse.click(b.x, b.y)
    await pause()
    await number.waitFor()
  }
  /** Replaces the number box's text and presses Enter. */
  async function enter(text) {
    await number.fill(text)
    await number.press('Enter')
    await pause()
  }
  async function pick(label) {
    await unit.selectOption({ label })
    await pause()
  }
  const state = async () => ({ number: await number.inputValue(), unit: await picked() })
  async function expectField(what, n, u, ref, cap) {
    const s = await state()
    check(s.number === n && s.unit === u, `${scheme}: ${what}: field shows ${n} ${u} (got ${s.number} ${s.unit})`)
    if (ref) {
      const c = await caption(ref)
      check(c.includes(cap), `${scheme}: ${what}: ${ref} reads "${cap}" on the sheet (got "${c}")`)
    }
  }

  // A fresh resistor: 1 kOhm, shown as 1 with kOhm picked, and the dropdown is labelled.
  await select('R1')
  await expectField('fresh R1', '1', `k${OHM}`, 'R1', `R1  1 k${OHM}`)
  check((await page.getByLabel('Resistance unit').evaluate((e) => e.id)) === 'part-value-unit', `${scheme}: the dropdown is labelled "Resistance unit"`)
  check((await page.getByLabel('Resistance', { exact: true }).evaluate((e) => e.id)) === 'part-value', `${scheme}: the number box is labelled "Resistance"`)
  const labels = await unit.locator('option').allTextContents()
  check(JSON.stringify(labels) === JSON.stringify([OHM, `k${OHM}`, `M${OHM}`]), `${scheme}: resistance units are Ohm, kOhm, MOhm (got ${labels.join(', ')})`)
  // Keyboard: Tab goes from the number box to the dropdown.
  await number.focus()
  await page.keyboard.press('Tab')
  check((await page.evaluate(() => document.activeElement?.id)) === 'part-value-unit', `${scheme}: Tab moves from the number box to the unit dropdown`)

  // Setting 330 Ohm on a fresh resistor: pick Ohm, then type 330.
  await select('R2')
  await pick(OHM)
  await expectField('R2 after picking Ohm', '1', OHM, 'R2', `R2  1 ${OHM}`)
  await enter('330')
  await expectField('R2 after typing 330', '330', OHM, 'R2', `R2  330 ${OHM}`)

  // A fresh resistor, 330R typed straight in: the dropdown moves from kOhm to Ohm.
  await select('R3')
  await enter('330R')
  await expectField('R3 after typing 330R', '330', OHM, 'R3', `R3  330 ${OHM}`)
  await enter('330 ohm')
  await expectField('R3 after typing 330 ohm', '330', OHM, 'R3', `R3  330 ${OHM}`)
  check((await hint.count()) === 0, `${scheme}: 330R and 330 ohm show no hint`)

  // A bare number is read in the picked unit; switching kOhm to Ohm keeps the number.
  await select('R1')
  await enter('330')
  await expectField('R1 after typing 330 with kOhm picked', '330', `k${OHM}`, 'R1', `R1  330 k${OHM}`)
  await pick(OHM)
  await expectField('R1 after switching kOhm to Ohm', '330', OHM, 'R1', `R1  330 ${OHM}`)
  await page.locator('.inspector').screenshot({ path: join(shots, `values-resistor-${scheme}.png`) })

  // Undo and redo move the value and the dropdown together.
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Control+z')
  await pause()
  await expectField('R1 after undo', '330', `k${OHM}`, 'R1', `R1  330 k${OHM}`)
  await page.keyboard.press('Control+y')
  await pause()
  await expectField('R1 after redo', '330', OHM, 'R1', `R1  330 ${OHM}`)
  // Michael's report: at 330 kOhm, typing 330R and Enter must give 330 Ohm (it used to be rejected
  // and the field went back to 330 kOhm).
  await page.keyboard.press('Control+z')
  await pause()
  await expectField('R1 after a second undo', '330', `k${OHM}`, 'R1', `R1  330 k${OHM}`)
  await enter('330R')
  await expectField('R1 at 330 kOhm after typing 330R', '330', OHM, 'R1', `R1  330 ${OHM}`)
  check((await hint.count()) === 0, `${scheme}: 330R shows no hint`)

  // 4k7 overrides the picked Ohm; the dropdown moves to kOhm.
  await enter('4k7')
  await expectField('R1 after typing 4k7', '4.7', `k${OHM}`, 'R1', `R1  4.7 k${OHM}`)
  await pick(`M${OHM}`)
  await expectField('R1 after switching kOhm to MOhm', '4.7', `M${OHM}`, 'R1', `R1  4.7 M${OHM}`)
  await enter('4.7k')
  await expectField('R1 after typing 4.7k', '4.7', `k${OHM}`, 'R1', `R1  4.7 k${OHM}`)

  // Escape puts the old number back and commits nothing.
  await number.fill('999')
  await number.press('Escape')
  await pause()
  await expectField('R1 after Escape', '4.7', `k${OHM}`, 'R1', `R1  4.7 k${OHM}`)
  check((await page.evaluate(() => document.activeElement?.id)) === 'part-value', `${scheme}: Escape keeps focus in the number box (the part stays selected)`)
  await number.press('Enter')
  await pause()
  await expectField('R1 after Enter on the restored number', '4.7', `k${OHM}`, 'R1', `R1  4.7 k${OHM}`)

  // Bad input: the hint shows and the typed text stays, so it is clear what was rejected; nothing
  // is committed. Escape then puts the number back and clears the hint.
  await enter('abc')
  check((await hint.count()) === 1 && /4\.7k/.test(await hint.textContent()), `${scheme}: bad input shows the hint`)
  check((await number.inputValue()) === 'abc' && (await number.getAttribute('aria-invalid')) === 'true', `${scheme}: bad input stays in the box, marked invalid`)
  check((await caption('R1')).includes(`R1  4.7 k${OHM}`), `${scheme}: bad input commits nothing`)
  await page.locator('.inspector').screenshot({ path: join(shots, `values-hint-${scheme}.png`) })
  await number.focus()
  await number.press('Escape')
  await pause()
  await expectField('R1 after Escape on bad input', '4.7', `k${OHM}`, 'R1', `R1  4.7 k${OHM}`)
  check((await hint.count()) === 0, `${scheme}: Escape clears the hint`)

  // Standard-value suggestions: listed on the number box, and a picked one is accepted.
  const suggestions = await page.locator(`#${await number.getAttribute('list')} option`).evaluateAll((os) => os.map((o) => o.value))
  check(suggestions.includes(`330 ${OHM}`) && suggestions.includes(`4.7 k${OHM}`), `${scheme}: the number box suggests standard values (330 Ohm, 4.7 kOhm)`)
  await enter(`10 k${OHM}`)
  await expectField('R1 after picking the 10 kOhm suggestion', '10', `k${OHM}`, 'R1', `R1  10 k${OHM}`)
  check((await hint.count()) === 0, `${scheme}: a good value clears the hint`)

  // Capacitor: 100 nF fresh; switch to uF, type a bare number, then a pF value overrides.
  await select('C1')
  await expectField('fresh C1', '100', 'nF', 'C1', 'C1  100 nF')
  // The disc's marking is the capacitance as its 3-digit code, following the value.
  const marked = async (code) => check((await caption('C1')).split(' ').includes(code), `${scheme}: C1 is marked ${code} (${await caption('C1')})`)
  await marked('104')
  const capLabels = await unit.locator('option').allTextContents()
  check(JSON.stringify(capLabels) === JSON.stringify(['pF', 'nF', `${MICRO}F`]), `${scheme}: capacitance units are pF, nF, uF (got ${capLabels.join(', ')})`)
  check((await page.getByLabel('Capacitance unit').count()) === 1, `${scheme}: the dropdown is labelled "Capacitance unit"`)
  await pick(`${MICRO}F`)
  await expectField('C1 after switching nF to uF', '100', `${MICRO}F`, 'C1', `C1  100 ${MICRO}F`)
  await pick('nF')
  await enter('47')
  await expectField('C1 after typing 47 with nF picked', '47', 'nF', 'C1', 'C1  47 nF')
  await marked('473')
  await enter('220p')
  await expectField('C1 after typing 220p', '220', 'pF', 'C1', 'C1  220 pF')
  await marked('221')
  await enter('100n')
  await expectField('C1 after typing 100n', '100', 'nF', 'C1', 'C1  100 nF')
  await page.locator('.inspector').screenshot({ path: join(shots, `values-capacitor-${scheme}.png`) })

  check(errors.length === 0, `${scheme}: no page errors${errors.length ? ` (${errors.join('; ')})` : ''}`)
  await context.close()
}

await browser.close()
done()
