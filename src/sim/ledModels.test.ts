// Spec 4: each colour's model gives V = forwardVoltage at 20 mA (IS refitted, N and RS held), so
// forwardVoltage stays the user's knob. One test per colour.
import { describe, expect, it } from 'vitest'
import { BODY_DIODE, LED_COLOURS, diodeVoltage, fitIs, ledHandCalc, ledModel, schottky } from './ledModels.ts'

describe('LED colour models', () => {
  for (const colour of Object.keys(LED_COLOURS))
    it(`${colour}: V = forwardVoltage at 20 mA for 1.8, 2.0 and 3.1 V`, () => {
      for (const vf of [1.8, 2.0, 3.1]) {
        const { model, known } = ledModel(colour, vf)
        expect(known).toBe(true)
        expect(diodeVoltage(model, 0.02)).toBeCloseTo(vf, 9)
      }
    })
  it('fits red at 2.0 V to the spike model (IS about 94 pA with N 3.73, RS 7.5)', () => {
    const { model } = ledModel('red', 2.0)
    expect(model.n).toBe(3.73)
    expect(model.rs).toBe(7.5)
    expect(model.is).toBeCloseTo(9.4e-11, 12)
  })
  it('uses the red curve for a colour it does not know, and says so', () => {
    const r = ledModel('ultraviolet', 3.2)
    expect(r.known).toBe(false)
    expect(r.model.n).toBe(LED_COLOURS.red.n)
    expect(diodeVoltage(r.model, 0.02)).toBeCloseTo(3.2, 9)
  })
  it('hand-calculates LED + 150 ohm + 5 V: the anode sits at forwardVoltage (2.0 V) when 3 V drops across 150 ohm', () => {
    const h = ledHandCalc(5, 150, ledModel('red', 2.0).model)
    expect(h.anode).toBeCloseTo(2.0, 6)
    expect(h.amps).toBeCloseTo(0.02, 6)
  })
  it('fits a Schottky at 0.35 V and 100 mA, and a silicon body diode', () => {
    expect(diodeVoltage(schottky(0.35), 0.1)).toBeCloseTo(0.35, 9)
    expect(diodeVoltage(BODY_DIODE, 1)).toBeGreaterThan(0.6)
    expect(fitIs(0.35, 0.1, 1.05, 0)).toBeGreaterThan(0)
  })
})
