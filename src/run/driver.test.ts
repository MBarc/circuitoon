// Firmware spec 7 and 10 (integration on the virtual clock): blink toggles GPIO17 at exactly 1 Hz for
// 3 s and the LED's averaged current is half its on current; --press fires when_pressed, even a press
// shorter than a solve; a busy-wait on time.time() ends and a polling loop sees a press; a script that
// never yields is stopped after the real-time limit; cutting the supply stops the board ("lost power");
// an unpowered board does not start. Every run is deterministic.
import { afterAll, describe, expect, it } from 'vitest'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { type DriveOptions, drive } from './driver.ts'
import { libraryLookup } from '../agent/catalog.ts'
import { nodePy } from './testing.ts'
import { PY_FILES } from './pyFiles.ts'
import { piBlink, piButton, piSwitched } from './sheets.testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const run = (o: Partial<DriveOptions> & Pick<DriveOptions, 'diagram'>) => drive({ boards: ['u1'], forMs: 5000, inputs: [], presses: [], engine, py: nodePy(), library: libraryLookup, files: PY_FILES, ...o })
const serial = (r: Awaited<ReturnType<typeof run>>) => r.boards[0].serial.map((s) => s.text).join('')

describe('circuitoon run on the virtual clock (spec 7, 10)', () => {
  it('toggles GPIO17 at exactly 1 Hz for 3 s, with the LED averaging half its on current', async () => {
    const r = await run({ diagram: piBlink(), forMs: 3500 })
    expect(r.timeline.filter((e) => e.pin === 'GPIO17').map((e) => [Math.round(e.t), e.state])).toEqual([[0, 'high'], [1000, 'low'], [2000, 'high'], [3000, 'low']])
    // The LED's current over 0..3 s, piecewise from each solve.
    const led = (o: (typeof r.solves)[number]['outcome']) => (o.status === 'ok' && o.result.corners.typical.parts.d1.pins.A.kind === 'value' ? (o.result.corners.typical.parts.d1.pins.A as { value: number }).value : 0)
    const steps = r.solves.filter((s) => s.t <= 3000)
    let charge = 0
    steps.forEach((s, i) => (charge += led(s.outcome) * ((steps[i + 1]?.t ?? 3000) - s.t)))
    const on = Math.max(...steps.map((s) => led(s.outcome)))
    expect(charge / 3000 / on).toBeCloseTo(2 / 3, 2)
    expect(r.boards[0].status).toBe('stopped')
    expect(r.simulatedMs).toBe(3500)
  }, 120_000)
  it('repeats exactly', async () => {
    const a = await run({ diagram: piBlink(), forMs: 2500 })
    const b = await run({ diagram: piBlink(), forMs: 2500 })
    expect(b.timeline).toEqual(a.timeline)
  }, 120_000)
  it('fires when_pressed on --press, even for a press shorter than a solve', async () => {
    const code = "from gpiozero import Button\nfrom signal import pause\nimport time\nb = Button(27)\nb.when_pressed = lambda: print('pressed', round(time.monotonic(), 2))\npause()\n"
    expect(serial(await run({ diagram: piButton(code), forMs: 3000, presses: [{ uid: 's1', atMs: 1500, forMs: 200 }] }))).toBe('pressed 1.5\n')
    expect(serial(await run({ diagram: piButton(code), forMs: 3000, presses: [{ uid: 's1', atMs: 1500, forMs: 1 }] }))).toBe('pressed 1.5\n')
  }, 120_000)
  it('ends a busy-wait on time.time(), and lets a polling loop see a press', async () => {
    const busy = await run({ diagram: piButton("import time\nend = time.time() + 1\nwhile time.time() < end:\n    pass\nprint('done', round(time.monotonic(), 1))\n") })
    expect([serial(busy), busy.boards[0].status]).toEqual(['done 1.0\n', 'done'])
    const poll = await run({ diagram: piButton("import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile GPIO.input(27):\n    pass\nprint('seen', round(time.monotonic(), 2))\n"), presses: [{ uid: 's1', atMs: 1500, forMs: 200 }] })
    expect(serial(poll)).toBe('seen 1.5\n')
    const long = await run({ diagram: piButton("import time\nend = time.time() + 20\nwhile time.time() < end:\n    pass\nprint('done', round(time.monotonic(), 1))\n") })
    expect([serial(long), long.boards[0].status, long.simulatedMs]).toEqual(['', 'stopped', 5000])
  }, 120_000)
  it('stops a script that never yields after the real-time limit', async () => {
    const r = await run({ diagram: piButton('while True:\n    pass\n'), realLimitMs: 2000 })
    expect(r.neverPauses).toEqual(['u1'])
    expect(r.boards[0].status).toBe('error')
    expect(serial(r)).toContain("U1's code never pauses")
  }, 120_000)
  it('stops a board that loses power, and does not start one with none', async () => {
    const cut = await run({ diagram: piSwitched(BLINK_FOREVER), forMs: 3000, presses: [{ uid: 'sw1', atMs: 1000, forMs: 0 }] })
    expect(cut.lostPower).toEqual(['u1'])
    expect(cut.boards[0].serial.some((s) => s.stream === 'note' && s.text === 'U1 lost power\n')).toBe(true)
    const open = { ...piSwitched(BLINK_FOREVER) }
    open.parts = open.parts.map((p) => (p.uid === 'sw1' ? { ...p, values: { 'contact.s': 'open' } } : p))
    const none = await run({ diagram: open })
    expect(none.incomplete).toEqual([{ uid: 'u1', why: 'U1 has no power: connect 5V and GND' }])
    expect(none.boards[0].status).toBe('not-started')
  }, 120_000)
})

const BLINK_FOREVER = 'from gpiozero import LED\nfrom signal import pause\nLED(17).blink()\npause()\n'
