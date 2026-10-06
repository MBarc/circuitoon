// The servo model (firmware spec 3.4): the angle is a linear map of the pulse width (duty / frequency)
// from the module's pulseMin..pulseMax onto 0..180 degrees, clamped; the horn moves toward it at the
// slew rate; a signal a servo does not follow (a pulse outside 0.4 to 2.6 ms, or a frequency outside
// 40 to 330 Hz) holds the last angle and is reported. Pure.
import type { ModuleDef } from '../format/module.ts'
import { simOf } from '../format/simModel.ts'

export interface ServoLimits { pulseMin: number; pulseMax: number; slewSecPer60: number }
export const SIGNAL_PULSE_S: [number, number] = [0.0004, 0.0026]
export const SIGNAL_HZ: [number, number] = [40, 330]

export function servoLimitsOf(m: ModuleDef | undefined): ServoLimits | null {
  const s = simOf(m)?.servo
  return s ? { pulseMin: s.pulseMin.value, pulseMax: s.pulseMax.value, slewSecPer60: s.slew.value } : null
}

const round = (x: number, digits: number) => Number(x.toFixed(digits))

export function servoTarget(duty: number, freqHz: number, s: ServoLimits): { angle: number } | { why: string } {
  const pulse = duty / freqHz
  if (freqHz < SIGNAL_HZ[0] || freqHz > SIGNAL_HZ[1] || pulse < SIGNAL_PULSE_S[0] || pulse > SIGNAL_PULSE_S[1])
    return { why: `a ${round(pulse * 1000, 2)} ms pulse at ${round(freqHz, 1)} Hz` }
  const a = ((pulse - s.pulseMin) / (s.pulseMax - s.pulseMin)) * 180
  return { angle: Math.min(180, Math.max(0, a)) }
}

export function slewToward(angle: number, target: number, dtMs: number, s: ServoLimits): number {
  const step = ((60 / s.slewSecPer60) * Math.max(0, dtMs)) / 1000
  return Math.abs(target - angle) <= step ? target : angle + Math.sign(target - angle) * step
}
