// Firmware spec 7 and ruling R16, the worker's half: on the virtual clock a wait reports where the
// board is and until when, and moves on only when the driver grants a clock (H.grant), never on a
// stray wake from an input write or a line; time and pin reads step 10 us, so a busy-wait ends; a
// polling loop syncs at the driver's horizon and sees an input written there; a read after setup gets
// its solve at the same instant, inside the horizon too. The driver here is a minimal test driver
// (Task 30 has the real one).
import { describe, expect, it } from 'vitest'
import { H, NPINS, type PinIn, grant, writeIn, writeLine } from './memory.ts'
import type { BoardRun } from './host.ts'
import type { FromCode } from './protocol.ts'
import { runNode } from './testing.ts'

/**
 * A one-board test driver: grants each block up to its until, the next event or the end; applies the
 * events due by then; solves instantly; sets the horizon to the next 16 ms step or event. With
 * `lagMs`, a grant that follows an event comes that much later (real time), as a slow driver's would.
 */
function driver(endMs: number, events: { atMs: number; run: (run: BoardRun) => void }[] = [], o: { lagMs?: number } = {}) {
  return (m: FromCode, run: BoardRun) => {
    if (m.type !== 'block') return
    const t = Math.max(m.nowMs, Math.min(m.untilMs, endMs, events[0]?.atMs ?? Infinity))
    let ran = false
    while (events.length && events[0].atMs <= t) {
      events.shift()!.run(run)
      ran = true
    }
    // Solves are instant here: whatever the code set up is solved.
    Atomics.store(run.memory.i32, H.solvedThrough, Atomics.load(run.memory.i32, H.codeSeq))
    const go = () => (t >= endMs ? void run.stop() : grant(run.memory, t, Math.min(t + 16, events[0]?.atMs ?? Infinity, endMs)))
    if (ran && o.lagMs) setTimeout(go, o.lagMs)
    else go()
  }
}
const printed = (r: { messages: FromCode[] }) => r.messages.flatMap((m) => (m.type === 'out' ? [m.text] : [])).join('')
const pressAt = (atMs: number) => {
  const low: PinIn = { level: 0, rising: 0, falling: 1, status: 'value', volts: 0 }
  return { atMs, run: (run: BoardRun) => writeIn(run.memory, Array.from({ length: NPINS }, (_, b) => (b === 27 ? low : null)), Atomics.load(run.memory.i32, H.codeSeq)) }
}

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
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile GPIO.input(27):\n    pass\nprint(round(time.monotonic(), 2))\n', { mode: 'virtual', on: driver(10_000, [pressAt(1500)]) })
    expect(await r.exited).toBe('done')
    expect(Number(printed(r))).toBeGreaterThanOrEqual(1.5)
    expect(Number(printed(r))).toBeLessThan(1.52)
  }, 60_000)
  it('gives a read after setup its solve at the same instant (no 200 ms wait), inside the horizon too', async () => {
    const read = (bcm: number) => `GPIO.setup(${bcm}, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nt = time.monotonic()\nGPIO.input(${bcm})\nprint(round(time.monotonic() - t, 3))\n`
    const r = runNode(`import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\n${read(27)}${read(22)}`, { mode: 'virtual', on: driver(60_000) })
    expect(await r.exited).toBe('done')
    expect(printed(r)).toBe('0.0\n0.0\n')
  }, 60_000)
  it('moves only on a grant: an input write or a line wakes the board but does not move it', async () => {
    let blocks = 0
    let atGrant = -1
    const rest = driver(60_000)
    const r = runNode('import time\ntime.sleep(1)\nprint(round(time.monotonic(), 2))\n', {
      mode: 'virtual',
      on: (m, run) => {
        if (m.type !== 'block') return
        if (++blocks > 1) return rest(m, run)
        writeIn(run.memory, [], 0)
        writeLine(run.memory, 'stray')
        setTimeout(() => {
          atGrant = blocks
          grant(run.memory, 1000, 1016)
        }, 100)
      },
    })
    expect(await r.exited).toBe('done')
    // A stray wake taken as a grant would have sent a second block before the grant.
    expect(atGrant).toBe(1)
    expect(printed(r)).toBe('1.0\n')
  }, 60_000)
  it('runs a press callback at the press time even when the grant comes 20 ms after the input write', async () => {
    const script = 'import time\nfrom gpiozero import Button\nb = Button(27)\nb.when_pressed = lambda: print(round(time.monotonic(), 2))\ntime.sleep(3)\n'
    const runs = Array.from({ length: 4 }, () => runNode(script, { mode: 'virtual', on: driver(10_000, [pressAt(1500)], { lagMs: 20 }) }))
    for (const r of runs) {
      expect(await r.exited).toBe('done')
      expect(printed(r)).toBe('1.5\n')
    }
  }, 120_000)
  it('stops a board blocked in a sleep under a driver that never grants', async () => {
    let blocked!: () => void
    const waiting = new Promise<void>((r) => (blocked = r))
    const r = runNode('import time\ntime.sleep(30)\nprint("woke")\n', { mode: 'virtual', on: (m) => m.type === 'block' && blocked() })
    await waiting
    expect(await r.run.stop()).toBe('stopped')
    expect(await r.exited).toBe('stopped')
    expect(printed(r)).toBe('')
  }, 60_000)
})
