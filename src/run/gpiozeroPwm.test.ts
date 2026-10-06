// Firmware spec 5.1 and 2.2: gpiozero's PWM devices declare duty and frequency; nothing toggles the
// pin. Values map as gpiozero maps them: PWMLED duty, RGBLED per channel, Servo pulse widths (1 to
// 2 ms in a 20 ms frame by default), AngularServo angles, Motor forward and backward.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nfrom gpiozero import *\n'
const pwms = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => r.trace.filter((x) => x.bcm === bcm && x.pwm).map((x) => x.pwm!)
const last = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => pwms(r, bcm).at(-1)

describe('gpiozero PWM devices (spec 5.1, 2.2)', () => {
  it('declares a PWMLED\'s duty at 100 Hz, and never writes its latch', async () => {
    const r = await runScript(`${head}led = PWMLED(18)\nled.value = 0.5\nprint(led.value, led.is_lit)\n`)
    expect(last(r, 18)).toEqual({ active: true, duty: 0.5, freq: 100 })
    expect(r.out).toBe('0.5 True\n')
    expect(r.trace.some((x) => x.bcm === 18 && x.latch !== undefined)).toBe(false)
  })
  it('pulses: 25 rising steps over the fade-in second, then falling', async () => {
    const r = await runScript(`${head}PWMLED(18).pulse(n=1, background=False)\n`)
    const d = pwms(r, 18).map((p) => p.duty)
    const peak = d.indexOf(1)
    expect(peak).toBeGreaterThanOrEqual(25)
    expect(d.slice(1, peak).every((x, i) => x >= d[i])).toBe(true)
    expect(d.at(-1)).toBe(0)
    expect(r.t).toBeGreaterThanOrEqual(2000)
  })
  it('sets an RGBLED per channel, and blinks between colours', async () => {
    const r = await runScript(`${head}c = RGBLED(17, 27, 22)\nc.color = (1, 0.5, 0)\nprint(c.value)\nc.blink(on_time=0.5, off_time=0.5, on_color=(0, 0, 1), n=1, background=False)\nprint(c.value)\n`)
    expect([last(r, 17), last(r, 27), last(r, 22)].map((p) => p!.duty)).toEqual([0, 0, 0])
    expect(r.out).toBe('(1.0, 0.5, 0.0)\n(0.0, 0.0, 0.0)\n')
    expect(pwms(r, 22).some((p) => p.duty === 1)).toBe(true)
  })
  it('maps Servo values to pulse widths in a 20 ms frame, and detaches', async () => {
    const r = await runScript(`${head}s = Servo(18)\ns.min()\ns.max()\ns.detach()\n`)
    const p = pwms(r, 18)
    expect(p.map((x) => [x.active, Number(x.duty.toFixed(4)), x.freq])).toEqual([[true, 0.075, 50], [true, 0.05, 50], [true, 0.1, 50], [false, 0, 50]])
  })
  it('maps AngularServo angles across its range', async () => {
    const r = await runScript(`${head}s = AngularServo(18, min_angle=-90, max_angle=90)\ns.angle = 45\nprint(s.angle, s.value)\n`)
    expect(Number(last(r, 18)!.duty.toFixed(5))).toBe(0.0875)
    expect(r.out).toBe('45.0 0.5\n')
  })
  it('drives a Motor forward, backward and stopped on its two pins', async () => {
    const r = await runScript(`${head}m = Motor(17, 27)\nm.forward(0.6)\nprint(m.value)\nm.backward()\nprint(m.value)\nm.stop()\nprint(m.value)\n`)
    expect(r.out).toBe('0.6\n-1.0\n0.0\n')
    expect([last(r, 17)!.duty, last(r, 27)!.duty]).toEqual([0, 0])
    expect((await runScript(`${head}Motor(17, 27, enable=22)\n`)).err).toContain("NotImplementedError: Motor's enable pin is not simulated yet; wire it high and leave enable out")
  })
  it('refuses values out of range', async () => {
    expect((await runScript(`${head}PWMLED(18).value = 1.5\n`)).err).toContain('gpiozero.OutputDeviceBadValue: PWM value must be between 0 and 1')
    expect((await runScript(`${head}Servo(18).value = 2\n`)).err).toContain('gpiozero.OutputDeviceBadValue: Servo value must be between -1 and 1, or None')
  })
  it('does not leak the pin when a constructor refuses its arguments', async () => {
    const bad = ['PWMLED(18, initial_value=2)', 'Servo(18, initial_value=2)', 'Servo(18, min_pulse_width=0.003)', 'RGBLED(17, 27, 22, initial_value=(2, 0, 0))', 'RGBLED(17, 27, 22, initial_value=(1, 0))', 'RGBLED(17, 27, 22, pwm=False, initial_value=(0.5, 0, 0))']
    const r = await runScript(`${head}for make in (${bad.map((b) => `lambda: ${b}`).join(', ')}):\n    try:\n        make()\n    except Exception:\n        pass\nPWMLED(18)\nPWMLED(17)\nPWMLED(27)\nPWMLED(22)\nprint('ok')\n`)
    expect(r.out).toBe('ok\n')
  })
})
