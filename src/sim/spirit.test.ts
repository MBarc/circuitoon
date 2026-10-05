// Spec 1 and 9: the Spirit Typewriter. Every powered part has power data with honest provenance;
// the rail voltages match hand calculations made here from the same module data; the findings are
// the expected ones. The hand calculations use the sourced numbers read from the modules, so this
// file carries no datasheet number of its own (the expected sums in comments are for the reader).
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from '../format/builtinModules.testing.ts'
import { nodeKey } from '../format/netlist.ts'
import { simOf } from '../format/simModel.ts'
import { MIN_VOLTS_FRACTION, NO_POWER_DATA, RAIL_DIRECT_OHMS, ROUT_DEFAULT } from './estimates.ts'
import { makeEngine } from './engine/engine.ts'
import { createNodeEngineHost } from './engine/nodeEngine.ts'
import { deviceParams } from './findings.ts'
import { ledHandCalc, ledModel } from './ledModels.ts'
import type { Circuit, Corner } from './model.ts'
import type { SimOutcome } from './results.ts'
import { solve } from './session.ts'
import { FEEDBACK_LOAD } from './spice.ts'
import { netSheet } from './testing.ts'

const n = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'spirit-typewriter.netlist.json'), 'utf8'))
const d = netSheet(n)
const engine = makeEngine(createNodeEngineHost())
let solved: { outcome: SimOutcome; circuit: Circuit }
beforeAll(async () => {
  solved = await solve(d, engine, 1)
}, 60_000)
afterAll(() => engine.dispose())

const sim = (id: string) => simOf(load(id))!
const ESP = 'esp32-devkit-v1-30'
const OLED = 'oled-ssd1306-096-i2c'
const LCD = 'lcd-st7796s-4in-spi-touch'
const MCP = 'mcp23017-cjmcu-2317'
const IP = 'ip5306-usbc-module'
/** A domain's draw at a corner: the peak where the data gives one, else the typical (spec 4.5). */
const draw = (id: string, domain: string, corner: Corner) => {
  const x = sim(id).power!.draw!.find((dr) => dr.domain === domain)!
  return corner === 'peak' ? (x.peak?.value ?? x.typical.value) : x.typical.value
}

/** The hand calculation, from the module data alone (no solver number goes in). */
function handCalc(corner: Corner) {
  // The 3V3 rail's loads. Typical: ESP32 100 + OLED 10 + 2 x (LCD VCC 67 + LCD LED 2.5) + 3 x MCP23017 1
  // = 252 mA. Peak: 240 + 20 + 2 x (87 + 2.5) + 3 x 1 = 442 mA (LED and MCP23017 give no peak).
  const i3 = draw(ESP, '3V3', corner) + draw(OLED, 'VCC', corner) + 2 * (draw(LCD, 'VCC', corner) + draw(LCD, 'LED', corner)) + 3 * draw(MCP, 'VCC', corner)
  // The DevKit's LDO (NCP1117: vout 3.3 V, dropout 1.01 V, iq 6 mA; no rout given, so the 0.1 ohm
  // default) holds vout less its output current through rout. The output current is the loads plus
  // the 1 mA internal feedback load (Phase C ruling), which sits inside the output:
  // typical 3.3 - (0.252 + 0.001) x 0.1 = 3.2747 V; peak 3.3 - 0.443 x 0.1 = 3.2557 V.
  const ldo = sim(ESP).power!.rails!.find((r) => r.kind === 'ldo')!
  const ldoRout = ldo.rout?.value ?? ROUT_DEFAULT.value
  const v3 = ldo.vout!.value - (i3 + FEEDBACK_LOAD) * ldoRout
  // Its input (VIN, on the 5 V net) pays the output, the feedback load and iq:
  // typical 0.252 + 0.001 + 0.006 = 0.259 A; peak 0.449 A.
  const iVin = i3 + FEEDBACK_LOAD + ldo.iq!.value
  // The IP5306 boost (vout 5.0 V, efficiency 0.88, no rout given: 0.1 ohm) feeds VIN and R1 + D1. The
  // LED is a red 2.0 V one (the module's defaults), so the LED current is Newton on
  // V5 = I x 330 + Vd(I), and V5 = 5 - (iVin + I_led + 1 mA feedback) x 0.1. Fixed point:
  // typical I_led 9.47 mA, V5 = 5 - 0.26947 x 0.1 = 4.97305 V, LED anode 4.97305 - 9.47 mA x 330 = 1.8488 V.
  const boost = sim(IP).power!.rails!.find((r) => r.kind === 'boost')!
  const boostRout = boost.rout?.value ?? ROUT_DEFAULT.value
  const led = load('led').electrical as { params: { color: { default: string }; forwardVoltage: { default: number } } }
  const ledM = ledModel(led.params.color.default, led.params.forwardVoltage.default).model
  const ohms = (n.parts.find((p: { ref: string }) => p.ref === 'R1').values.resistance.value) as number
  let v5 = boost.vout!.value
  let iLed = 0
  for (let k = 0; k < 50; k++) {
    iLed = ledHandCalc(v5, ohms, ledM).amps
    v5 = boost.vout!.value - (iVin + iLed + FEEDBACK_LOAD) * boostRout
  }
  const i5 = iVin + iLed
  // The bank (spec 1): four cells (3.7 V, rInternal 0.1 ohm each) in parallel, then SW1 (KCD1 contact
  // 0.05 ohm), then the IP5306's B+. The boost draws P = vout x (i5 + 1 mA feedback) / efficiency at
  // its input, which sits behind the 1 milliohm direct-input resistor (ruling R17); the chip's 50 uA
  // standby draw sits on B+ itself. Typical: 5 x 0.26947 / 0.88 = 1.5311 W, so about 417.4 mA at
  // 3.668 V; the bank sags 0.4174 x 0.1 / 4 = 10.4 mV to 3.6896 V and SW1 drops 20.9 mV more.
  const r4 = sim('battery-18650-holder').modelParams!.rInternal.value / 4
  const volts = load('battery-18650-holder').electrical as { params: { voltage: { default: number } } }
  const vCell = volts.params.voltage.default
  const rc = sim('rocker-switch-kcd1').modelParams!.contactResistance.value
  const standby = draw(IP, 'BAT', corner)
  let vbat = vCell
  let vb = vCell
  let iBoost = 0
  let iBank = 0
  for (let k = 0; k < 100; k++) {
    iBoost = (boost.vout!.value * (i5 + FEEDBACK_LOAD)) / (boost.efficiency!.value * (vb - iBoost * RAIL_DIRECT_OHMS))
    iBank = iBoost + standby
    vbat = vCell - iBank * r4
    vb = vbat - iBank * rc
  }
  return { i3, v3, iVin, v5, iLed, anode: v5 - iLed * ohms, vbat, vb, iBank, ldo, boost }
}

describe('the Spirit Typewriter (spec 1)', () => {
  it('has power data for every powered part, with honest provenance', () => {
    const { circuit } = solved
    expect(circuit.unsimulated.filter((u) => u.reason === NO_POWER_DATA)).toEqual([])
    // Every powered part in the fixture has a load or a rail device.
    for (const ref of ['U1', 'U5', 'DS1', 'DS2', 'DS3', 'U2', 'U3', 'U4']) expect(circuit.devices.some((dv) => dv.part === ref && (dv.kind === 'load' || dv.kind === 'rail')), ref).toBe(true)
    for (const p of [...circuit.devices.flatMap(deviceParams), ...circuit.limits.map((l) => l.value)]) {
      expect(['datasheet', 'representative', 'estimate', 'user']).toContain(p.basis)
      if (p.basis === 'estimate') expect(p.note, p.label).toBeTruthy()
    }
  })

  for (const corner of ['typical', 'peak'] as const) {
    it(`puts each rail where the hand calculation from the module data says (${corner})`, () => {
      const { outcome, circuit } = solved
      if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome))
      const run = outcome.result.corners[corner]
      const volts = (ref: string, pin: string) => {
        const r = run.nets[circuit.pinNet[nodeKey(ref, pin)]]
        return r?.kind === 'value' ? r.value : Number.NaN
      }
      const h = handCalc(corner)
      // The hand calculation's own preconditions: the LDO regulates (input above vout + dropout), the
      // boost is fully enabled (input inside vinMin..vinMax), and every load sits above its minimum
      // voltage (so the fold-back is 1): the 3V3 loads' highest minVolts is 3.0 V, the standby's 3.33 V.
      expect(h.v5 - h.iVin * RAIL_DIRECT_OHMS - h.ldo.dropout!.value).toBeGreaterThan(h.ldo.vout!.value + 0.1)
      expect(h.vb).toBeGreaterThan(h.boost.vinMin!.value + 0.1)
      expect(h.vb).toBeLessThan(h.boost.vinMax!.value - 0.1)
      expect(h.v3).toBeGreaterThan(3.0 + 0.1)
      expect(h.vb).toBeGreaterThan(MIN_VOLTS_FRACTION * 3.7 + 0.1)

      expect(Math.abs(volts('U1', '3V3') - h.v3)).toBeLessThan(1e-3)
      expect(Math.abs(volts('U5', '5V+') - h.v5)).toBeLessThan(1e-3)
      expect(Math.abs(volts('D1', 'A') - h.anode)).toBeLessThan(1e-3)
      expect(Math.abs(volts('BT1', '+') - h.vbat)).toBeLessThan(1e-3)
      expect(Math.abs(volts('U5', 'B+') - h.vb)).toBeLessThan(1e-3)
      // Each cell carries a quarter of the bank's current (typical about 104.4 mA).
      const cell = outcome.result.budget.find((b) => b.id === 'BT1.cell')!.amps[corner]
      expect(cell.kind === 'value' && Math.abs(cell.value - h.iBank / 4)).toBeLessThan(1e-4)
    })
  }

  it('lists the expected findings: nothing blocks, nothing warns, the estimates are noted', () => {
    const { outcome } = solved
    if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome))
    // The IP5306's 45 mA light-load shutdown (sim-min-load) stays quiet: the boost delivers about
    // 268 mA typical. The LDO and boost run far inside ioutMax (1 A, 2.4 A), so no over-limit.
    expect(outcome.result.findings.filter((f) => f.severity !== 'note')).toEqual([])
    expect(outcome.result.findings.map((f) => f.code)).toEqual(['sim-estimate'])
  })
})
