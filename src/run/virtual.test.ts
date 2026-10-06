// Firmware spec 7 and ruling R16, the worker's half: on the virtual clock a wait reports where the
// board is and until when, and moves on only when the driver says; time and pin reads step 10 us, so
// a busy-wait ends; a polling loop syncs at the driver's horizon and sees an input written there; a
// read after setup gets its solve at the same instant. The driver here is a minimal test driver
// (Task 30 has the real one).
import { describe, expect, it } from 'vitest'
import { F, H, type PinIn, wake, writeIn } from './memory.ts'
import type { BoardRun } from './host.ts'
import type { FromCode } from './protocol.ts'
import { runNode } from './testing.ts'

/**
 * A one-board test driver: grants each block up to its until, the next event or the end; applies the
 * events due by then; solves instantly; sets the horizon to the next 16 ms step or event.
 */
function driver(endMs: number, events: { atMs: number; run: (run: BoardRun) => void }[] = []) {
  return (m: FromCode, run: BoardRun) => {
    if (m.type !== 'block') return
    const t = Math.max(m.nowMs, Math.min(m.untilMs, endMs, events[0]?.atMs ?? Infinity))
    while (events.length && events[0].atMs <= t) events.shift()!.run(run)
    // Solves are instant here: whatever the code set up is solved.
    Atomics.store(run.memory.i32, H.solvedThrough, Atomics.load(run.memory.i32, H.codeSeq))
    run.memory.f64[F.clockMs] = t
    run.memory.f64[F.horizonMs] = Math.min(t + 16, events[0]?.atMs ?? Infinity, endMs)
    if (t >= endMs) void run.stop()
    else wake(run.memory)
  }
}
const printed = (r: { messages: FromCode[] }) => r.messages.flatMap((m) => (m.type === 'out' ? [m.text] : [])).join('')

describe('the virtual clock (spec 7, ruling R16)', () => {
  it('jumps a sleep straight to its end, far faster than real time', async () => {
    const t0 = performance.now()
    const r = runNode('import time\ntime.sleep(30)\nprint(round(time.monotonic(), 2))\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(printed(r)).toBe('30.0\n')
    expect(performance.now() - t0).toBeLessThan(15_000)
  }, 60_000)
  it('ends a busy-wait on time.time(), each call a 10 us step', async () => {
    const r = runNode('import time\nend = time.time() + 0.05\nn = 0\nwhile time.time() < end:\n    n += 1\nprint(n > 1000)\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(printed(r)).toBe('True\n')
  }, 60_000)
  it('syncs a polling loop at the horizon, so it sees an input written there', async () => {
    const low: PinIn = { level: 0, rising: 0, falling: 1, status: 'value', volts: 0 }
    const press = { atMs: 1500, run: (run: BoardRun) => writeIn(run.memory, Array.from({ length: 28 }, (_, b) => (b === 27 ? low : null)), Atomics.load(run.memory.i32, H.codeSeq)) }
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile GPIO.input(27):\n    pass\nprint(round(time.monotonic(), 2))\n', { mode: 'virtual', on: driver(10_000, [press]) })
    expect(await r.exited).toBe('done')
    expect(Number(printed(r))).toBeGreaterThanOrEqual(1.5)
    expect(Number(printed(r))).toBeLessThan(1.52)
  }, 60_000)
  it('gives a read after setup its solve at the same instant (no 200 ms wait)', async () => {
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nt = time.monotonic()\nGPIO.input(27)\nprint(round(time.monotonic() - t, 3))\n', { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(r.messages.some((m) => m.type === 'out' && m.text === '0.0\n')).toBe(true)
  }, 60_000)
})
