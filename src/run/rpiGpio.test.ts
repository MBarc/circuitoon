// Firmware spec 5.1: RPi.GPIO's calls on the simulated board, against real Pyodide. BCM and BOARD
// numbering (the 40-pin map), pulls, outputs that read their latch, edge detection from the editor's
// edge counters (callbacks at yield points), wait_for_edge, PWM as a declared descriptor, the
// messages RPi.GPIO 0.7 gives, and the Pi 5 warning.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

const head = 'import time\nimport RPi.GPIO as GPIO\n'

describe('RPi.GPIO (spec 5.1)', () => {
  it('drives an output in BCM numbering and reads its own latch', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.output(17, GPIO.HIGH)\nprint(GPIO.input(17))\ntime.sleep(1)\nGPIO.output(17, 0)\nprint(GPIO.input(17))\n`)
    expect(r.out).toBe('1\n0\n')
    expect(r.trace.filter((x) => x.bcm === 17 && x.latch !== undefined).map((x) => [Math.round(x.t / 100) / 10, x.latch])).toEqual([[0, 1], [1, 0]])
  })
  it('maps BOARD pin numbers to BCM through the 40-pin header', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BOARD)\nGPIO.setup([11, 13, 40], GPIO.OUT, initial=GPIO.HIGH)\n`)
    expect(r.trace.filter((x) => x.latch === 1).map((x) => x.bcm)).toEqual([17, 27, 21])
  })
  it('reads a pulled input at its pull before any result, and the editor\'s level after', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nGPIO.setup(22, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)\nprint(GPIO.input(27), GPIO.input(22))\ntime.sleep(1)\nprint(GPIO.input(27))\n`, { inputs: [{ atMs: 500, bcm: 27, level: 0 }] })
    expect(r.out).toBe('1 0\n0\n')
  })
  it('gives RPi.GPIO 0.7\'s errors', async () => {
    const err = async (body: string) => (await runScript(head + body)).err.trim().split('\n').pop()
    expect(await err('GPIO.setup(17, GPIO.OUT)')).toBe('RuntimeError: Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.output(17, 1)')).toBe('RuntimeError: The GPIO channel has not been set up as an OUTPUT')
    expect(await err('GPIO.setmode(GPIO.BOARD)\nGPIO.setup(2, GPIO.OUT)')).toBe('ValueError: The channel sent is invalid on a Raspberry Pi')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setmode(GPIO.BOARD)')).toBe('ValueError: A different mode has already been set!')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setup(0, GPIO.OUT)')).toBe('ValueError: GPIO0 is reserved for the HAT ID EEPROM and is not simulated')
    expect(await err('GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT, pull_up_down=GPIO.PUD_UP)')).toBe('ValueError: pull_up_down parameter is not valid for outputs')
  })
  it('warns when a channel is set up twice, pointing at the user\'s line', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.setup(17, GPIO.OUT)\n`, { file: 'blink.py' })
    expect(r.err).toContain('blink.py:5: RuntimeWarning: This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.')
    expect((await runScript(`${head}GPIO.setwarnings(False)\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.setup(17, GPIO.OUT)\n`)).err).toBe('')
  })
  it('calls an edge callback at a yield point with the channel in the script\'s numbering', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BOARD)\nGPIO.setup(13, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nGPIO.add_event_detect(13, GPIO.FALLING, callback=lambda ch: print('pressed', ch, round(time.monotonic(), 1)))\ntime.sleep(2)\n`, { inputs: [{ atMs: 500, bcm: 27, level: 0 }, { atMs: 700, bcm: 27, level: 1 }] })
    expect(r.out).toBe('pressed 13 0.5\n')
  })
  it('remembers event_detected once, and honours bouncetime', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN)\nGPIO.add_event_detect(27, GPIO.RISING, bouncetime=200)\nGPIO.add_event_callback(27, lambda ch: print('edge', round(time.monotonic(), 1)))\ntime.sleep(1)\nprint(GPIO.event_detected(27), GPIO.event_detected(27))\n`, {
      inputs: [{ atMs: 100, bcm: 27, level: 1 }, { atMs: 150, bcm: 27, level: 0 }, { atMs: 200, bcm: 27, level: 1 }, { atMs: 600, bcm: 27, level: 0 }, { atMs: 680, bcm: 27, level: 1 }],
    })
    expect(r.out).toBe('edge 0.1\nedge 0.7\nTrue False\n')
  })
  it('waits for an edge, or times out with None', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nprint(GPIO.wait_for_edge(27, GPIO.FALLING, timeout=2000), round(time.monotonic(), 1))\nprint(GPIO.wait_for_edge(27, GPIO.FALLING, timeout=300))\n`, { inputs: [{ atMs: 400, bcm: 27, level: 0 }] })
    expect(r.out).toBe('27 0.4\nNone\n')
  })
  it('declares PWM (duty and frequency) without toggling the pin', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(18, GPIO.OUT)\np = GPIO.PWM(18, 50)\np.start(7.5)\np.ChangeDutyCycle(10)\np.ChangeFrequency(100)\np.stop()\n`)
    expect(r.trace.filter((x) => x.pwm).map((x) => x.pwm)).toEqual([
      { active: true, duty: 0.075, freq: 50 }, { active: true, duty: 0.1, freq: 50 }, { active: true, duty: 0.1, freq: 100 }, { active: false, duty: 0.1, freq: 100 },
    ])
    expect(r.trace.some((x) => x.bcm === 18 && x.latch !== undefined)).toBe(false)
    expect((await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(18, GPIO.OUT)\nGPIO.PWM(18, 50).start(120)\n`)).err).toContain('ValueError: dutycycle must have a value from 0.0 to 100.0')
  })
  it('cleans up to unused, and reports the board and its warning', async () => {
    const r = await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nprint(GPIO.gpio_function(17) == GPIO.OUT)\nGPIO.cleanup()\nprint(GPIO.getmode(), GPIO.RPI_INFO['PROCESSOR'])\n`)
    expect(r.out).toBe('True\nNone BCM2711\n')
    expect(r.trace.filter((x) => x.bcm === 17 && x.mode !== undefined).map((x) => x.mode).slice(0, 2)).toEqual([4, 0])
    const five = await runScript('import RPi.GPIO as GPIO\n', { board: 'pi5' })
    expect(five.err).toBe('RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio\n')
    expect((await runScript('import RPi.GPIO as GPIO\n')).err).toBe('')
  })
  it('refuses a PWM frequency that is not a number above 0', async () => {
    const err = async (body: string) => (await runScript(`${head}GPIO.setmode(GPIO.BCM)\nGPIO.setup(18, GPIO.OUT)\n${body}`)).err.trim().split('\n').pop()
    expect(await err("GPIO.PWM(18, float('nan')).start(50)")).toBe('ValueError: PWM frequency must be a number greater than 0, not nan')
    expect(await err("GPIO.PWM(18, float('inf')).start(50)")).toBe('ValueError: PWM frequency must be a number greater than 0, not inf')
    expect(await err("p = GPIO.PWM(18, 50)\np.start(50)\np.ChangeFrequency(float('nan'))")).toBe('ValueError: PWM frequency must be a number greater than 0, not nan')
    expect(await err('GPIO.PWM(18, 0)')).toBe('ValueError: frequency must be greater than 0.0')
    expect(await err('GPIO.PWM(18, -5)')).toBe('ValueError: frequency must be greater than 0.0')
    expect(await err("GPIO.PWM(18, 50).start(float('nan'))")).toBe('ValueError: dutycycle must have a value from 0.0 to 100.0')
  })
})
