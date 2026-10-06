// Firmware spec 3.4: angle is a linear map of pulse width (duty / frequency) from pulseMin..pulseMax
// to 0..180 degrees, clamped; the horn moves toward it at the slew rate; a pulse outside 0.4 to 2.6 ms
// or a frequency outside 40 to 330 Hz holds the last angle. gpiozero's Servo.min() (1 ms) draws at
// about 47 degrees on an SG90.
import { describe, expect, it } from 'vitest'
import { load } from '../format/builtinModules.testing.ts'
import { servoLimitsOf, servoTarget, slewToward } from './servo.ts'

const sg90 = servoLimitsOf(load('servo-sg90'))!
const at = (pulseMs: number, hz = 50) => servoTarget((pulseMs / 1000) * hz, hz, sg90)

describe('the servo model (spec 3.4)', () => {
  it('reads the SG90 data', () => expect(sg90).toEqual({ pulseMin: 0.0005, pulseMax: 0.0024, slewSecPer60: 0.1 }))
  it('maps pulse width to angle, clamped', () => {
    expect(at(0.5)).toEqual({ angle: 0 })
    expect(at(2.4)).toEqual({ angle: 180 })
    expect((at(1) as { angle: number }).angle).toBeCloseTo(47.37, 2)
    expect(at(2.5)).toEqual({ angle: 180 })
  })
  it('holds for a pulse or frequency a servo does not follow, and says why', () => {
    expect(at(0.3)).toEqual({ why: 'a 0.3 ms pulse at 50 Hz' })
    expect(at(1.5, 20)).toEqual({ why: 'a 1.5 ms pulse at 20 Hz' })
  })
  it('slews at 0.1 s per 60 degrees', () => {
    expect(slewToward(0, 90, 50, sg90)).toBeCloseTo(30, 9)
    expect(slewToward(85, 90, 50, sg90)).toBe(90)
    expect(slewToward(90, 0, 100, sg90)).toBeCloseTo(30, 9)
  })
})
