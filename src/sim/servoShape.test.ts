// Firmware spec 3.4 (shape only; Task 9 sources the SG90's numbers): a servo is a load on VCC that
// draws its idle current, or its moving current while the horn travels (BuildOptions.moving), and its
// signal pin is an input load (an internal resistor to its ground).
import { describe, expect, it } from 'vitest'
import { validateModule } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { cellModule, servoModule, sheet } from './testing.ts'

const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'm1', module: servoModule() }], [['bt1.+', 'm1.VCC'], ['bt1.-', 'm1.GND']])

describe('servo shape (spec 3.4)', () => {
  it('validates, and refuses a pulse range the wrong way round or a bad signal pin', () => {
    expect(validateModule(servoModule()).ok).toBe(true)
    const m = servoModule()
    const sim = (m.electrical as { sim: { servo: Record<string, unknown> } }).sim.servo
    const errs = (patch: Record<string, unknown>) => { const r = validateModule({ ...m, electrical: { ...(m.electrical as object), sim: { ...(m.electrical as { sim: object }).sim, servo: { ...sim, ...patch } } } }); return r.ok ? [] : r.errors }
    expect(errs({ pulseMin: sim.pulseMax })).toContain('electrical.sim.servo.pulseMin: must be below pulseMax')
    expect(errs({ signal: 'NOPE' })).toContain('electrical.sim.servo.signal: no pin "NOPE"')
    expect(errs({ slew: { ...(sim.slew as object), unit: 'V' } })).toContain('electrical.sim.servo.slew.unit: must be "s"')
  })
  it('draws idle current at rest and moving current while moving', () => {
    const at = (moving: string[]) => buildCircuit(d, { moving }).devices.find((x) => x.kind === 'load')
    expect(at([])).toMatchObject({ typical: { value: 0.01 } })
    expect(at(['m1'])).toMatchObject({ typical: { value: 0.2, label: 'servo-sg90-test.M1.servo.moving' } })
  })
  it('loads the signal pin with an internal resistor to the servo ground', () => {
    const r = buildCircuit(d).devices.find((x) => x.id === 'm1.signal')
    expect(r).toMatchObject({ kind: 'resistor', role: 'internal', a: 'm1:PWM', b: 'm1:GND', ohms: { value: 20000 } })
  })
})
