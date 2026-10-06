// Firmware spec 5.1 and 4.4: gpiozero's digital devices on the simulated board, against real Pyodide.
// Pin names as gpiozero takes them, outputs that read their own latch (toggle, is_lit, value),
// blink from timers, Button that does not fire at start, press, release and hold callbacks at yield
// points, waits, and the errors for pins in use and names not simulated.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nfrom gpiozero import *\n'
const latches = (r: Awaited<ReturnType<typeof runScript>>, bcm: number) => r.trace.filter((x) => x.bcm === bcm && x.latch !== undefined).map((x) => [Math.round(x.t / 100) / 10, x.latch])

describe('gpiozero digital devices (spec 5.1)', () => {
  it('drives an LED and reads its own latch', async () => {
    const r = await runScript(`${head}led = LED(17)\nled.on()\nprint(led.is_lit)\nled.toggle()\nprint(led.is_lit, led.value)\n`)
    expect(r.out).toBe('True\nFalse 0\n')
    expect(latches(r, 17)).toEqual([[0, 1], [0, 0]])
  })
  it('blinks from timers: 1 s on, 1 s off', async () => {
    const r = await runScript(`${head}LED(17).blink(n=2, background=False)\n`)
    expect(latches(r, 17)).toEqual([[0, 1], [1, 0], [2, 1], [3, 0]])
  })
  it('takes every pin name gpiozero does, and refuses bad ones and pins in use', async () => {
    const r = await runScript(`${head}for spec in ['GPIO5', 'BCM6', 'BOARD13', 'J8:15', '16', 20]:\n    print(LED(spec).pin)\n`)
    expect(r.out).toBe('GPIO5\nGPIO6\nGPIO27\nGPIO22\nGPIO16\nGPIO20\n')
    const last = async (body: string) => (await runScript(head + body)).err.trim().split('\n').pop()
    expect(await last('LED(17)\nLED(17)')).toMatch(/^gpiozero\.GPIOPinInUse: pin GPIO17 is already in use by <gpiozero\.LED object on pin GPIO17/)
    expect(await last("LED('GPIO99')")).toBe("gpiozero.PinInvalidPin: 'GPIO99' is not a valid pin on a Raspberry Pi header")
    expect(await last('LED(1)')).toBe('gpiozero.PinInvalidPin: GPIO1 is reserved for the HAT ID EEPROM and is not simulated')
  })
  it('inverts an active-low output', async () => {
    const r = await runScript(`${head}d = DigitalOutputDevice(18, active_high=False)\nd.on()\nprint(d.value, d.is_active)\n`)
    expect(latches(r, 18)).toEqual([[0, 1], [0, 0]])
    expect(r.out).toBe('1 True\n')
  })
  it('does not fire a Button at start', async () => {
    const r = await runScript(`${head}b = Button(27)\nb.when_pressed = lambda: print('pressed')\nprint(b.is_pressed)\npause()\n`, { untilMs: 1000 })
    expect(r.out).toBe('False\n')
    expect(r.status).toBe('stopped')
  })
  it('calls when_pressed and when_released at yield points, and passes the device to a one-argument callback', async () => {
    const r = await runScript(`${head}b = Button(27)\nb.when_pressed = lambda d: print('pressed', d.pin, round(time.monotonic(), 1))\nb.when_released = lambda: print('released', round(time.monotonic(), 1))\ntime.sleep(2)\n`, {
      inputs: [{ atMs: 500, bcm: 27, level: 0 }, { atMs: 800, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('pressed GPIO27 0.5\nreleased 0.8\n')
  })
  it('calls when_held after hold_time while still pressed, once without hold_repeat', async () => {
    const r = await runScript(`${head}b = Button(27, hold_time=1)\nb.when_held = lambda: print('held', round(time.monotonic(), 1))\ntime.sleep(3)\n`, {
      inputs: [{ atMs: 200, bcm: 27, level: 0 }, { atMs: 2500, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('held 1.2\n')
  })
  it('waits for a press, or times out', async () => {
    const r = await runScript(`${head}b = Button(27)\nprint(b.wait_for_press(timeout=2), round(time.monotonic(), 1))\nprint(b.wait_for_release(timeout=0.3))\n`, { inputs: [{ atMs: 300, bcm: 27, level: 0 }] })
    expect(r.out).toBe('True 0.3\nFalse\n')
  })
  it('keeps blink() paused while a callback sleeps (not re-entrant, spec 5.2)', async () => {
    const r = await runScript(`${head}led = LED(17)\nled.blink(on_time=0.5, off_time=0.5)\nb = Button(27)\nb.when_pressed = lambda: time.sleep(2)\ntime.sleep(4)\n`, { inputs: [{ atMs: 1100, bcm: 27, level: 0 }] })
    const during = latches(r, 17).filter(([t]) => (t as number) > 1.1 && (t as number) < 3.1)
    expect(during).toEqual([])
  })
  it('reads line and motion sensors as gpiozero names them', async () => {
    const r = await runScript(`${head}s = LineSensor(4)\nm = MotionSensor(5)\nm.when_motion = lambda: print('motion', round(time.monotonic(), 1))\nprint(s.line_detected, m.motion_detected)\ntime.sleep(1)\n`, { inputs: [{ atMs: 400, bcm: 5, level: 1 }] })
    expect(r.out).toBe('True False\nmotion 0.4\n')
  })
  it('names what is not simulated', async () => {
    const last = async (body: string) => (await runScript(body)).err.trim().split('\n').pop()
    expect(await last('from gpiozero import MCP3008')).toBe('NotImplementedError: gpiozero.MCP3008 needs SPI devices, coming in a later update')
    expect(await last('import gpiozero\ngpiozero.Robot')).toBe('NotImplementedError: gpiozero.Robot is not in the simulator yet')
  })
})
