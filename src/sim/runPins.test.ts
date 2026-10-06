// Firmware spec 4.1 and 4.2: a running board's run pin states override its saved GPIO states for the
// solve, transiently (the sheet is untouched); a PWM pin is a GPIO device in state `pwm` that each
// analysis compiles at the level `Analysis.pins` gives; classification treats it as driven at both
// levels, so classifyCached stays per analysis kind.
import { describe, expect, it } from 'vitest'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { compile } from './spice.ts'
import { boardModule, cellModule, sheet } from './testing.ts'

const d = sheet(
  [{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule(), values: { 'gpio.IO1': 'high' } }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 1000, unit: 'ohm' } } }],
  [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']],
)
const gpio = (c: ReturnType<typeof buildCircuit>, pin: string) => c.devices.find((x) => x.kind === 'gpio' && x.pin === pin)

describe('run pin states in the build (spec 4.1, 4.2)', () => {
  it('overrides the saved state for the solve and leaves the sheet as it was', () => {
    const before = JSON.stringify(d)
    expect(gpio(buildCircuit(d, { runPins: { u1: { IO1: 'low' } } }), 'IO1')).toMatchObject({ state: 'low' })
    expect(gpio(buildCircuit(d), 'IO1')).toMatchObject({ state: 'high' })
    expect(JSON.stringify(d)).toBe(before)
  })
  it('builds a PWM pin with its duty, driven like a high or low pin', () => {
    const c = buildCircuit(d, { runPins: { u1: { IO1: { pwm: 0.3 } } } })
    expect(gpio(c, 'IO1')).toMatchObject({ state: 'pwm', duty: 0.3 })
    expect(c.gpio.find((g) => g.pin === 'IO1')?.state).toBe('pwm')
    expect(classify(c).driven.has('u1:IO1')).toBe(true)
  })
  it('compiles a PWM pin at the level each analysis gives, high when none', () => {
    const c = buildCircuit(d, { runPins: { u1: { IO1: { pwm: 0.3 } } } })
    const cls = classify(c)
    const text = (pins?: Record<string, 'high' | 'low'>) => compile(c, cls, { kind: 'op', corner: 'typical', ...(pins ? { pins } : {}) }).text
    const line = (t: string) => t.split('\n').find((l) => l.startsWith('r_u1_gpio_io1'))!
    const high = buildCircuit(d, { runPins: { u1: { IO1: 'high' } } })
    const low = buildCircuit(d, { runPins: { u1: { IO1: 'low' } } })
    expect(line(text())).toBe(line(compile(high, classify(high), { kind: 'op', corner: 'typical' }).text))
    expect(line(text({ 'u1.gpio.IO1': 'low' }))).toBe(line(compile(low, classify(low), { kind: 'op', corner: 'typical' }).text))
  })
})
