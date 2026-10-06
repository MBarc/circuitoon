// circuitoon_hw (firmware spec 5.1, 5.2): the small JS module the Python stand-ins call, registered
// with pyodide.registerJsModule, and the clocks it runs on. It reads and writes the board's shared
// memory and blocks; the scheduler and the stand-ins are Python (src/run/py). Worker side: nothing
// Vite-specific (Node runs this file directly in its worker).
import type { BoardKind } from './boards.ts'
import { type BoardMemory, F, H, INPUT, MODE, type ModeCode, NPINS, readIn, readLocked, readOut, setOut, takeLine, writeLocked } from './memory.ts'

/** Run time for one board. */
export interface RunClock {
  /** Run time in ms since the start. In virtual time every call is a 10 us step (spec 7). */
  now(): number
  /** Epoch ms of run time 0 (time.time()). */
  readonly epochMs: number
  /** Blocks until run time `untilMs` (Infinity: until woken), a wake, or (real time) 50 ms; then checks for Stop. */
  block(untilMs: number): void
  /** Every pin read: in virtual time, syncs with the driver once past its horizon (ruling R16). */
  poll(): void
}

const nowAbs = () => performance.timeOrigin + performance.now()

/** The editor's clock (spec 5.2): Atomics.wait on the wake word for at most 50 ms at a time, then checkInterrupt. */
export function realClock(m: BoardMemory, checkInterrupt: () => void): RunClock {
  const start = m.f64[F.startMs]
  return {
    epochMs: start,
    now: () => nowAbs() - start,
    block(untilMs) {
      const seen = Atomics.load(m.i32, H.wake)
      const left = untilMs - (nowAbs() - start)
      if (left > 0) Atomics.wait(m.i32, H.wake, seen, Math.min(50, left))
      checkInterrupt()
    },
    poll() {},
  }
}

/**
 * A clock for in-process tests (pyHarness.testing.ts): no other thread exists, so block() jumps
 * straight to its time; `onStep` runs on every step (scheduled inputs, instant solves); past
 * `limitMs` it calls `stop` once (a KeyboardInterrupt, as the worker sets it once), so a script that
 * waits forever ends and its finally blocks may still sleep.
 */
export function testClock(o: { onStep: (tMs: number) => void; limitMs: number; stop: () => void }): RunClock & { t: number } {
  let stopped = false
  const c = {
    t: 0,
    epochMs: Date.UTC(2026, 0, 1),
    now() {
      c.t += 0.01
      o.onStep(c.t)
      return c.t
    },
    block(untilMs: number) {
      if (c.t >= o.limitMs + 10_000) throw new Error('test clock ran past its limit')
      c.t = Math.max(c.t, Math.min(untilMs, c.t + 50))
      o.onStep(c.t)
      if (c.t >= o.limitMs && !stopped) {
        stopped = true
        o.stop()
      }
    },
    poll() {},
  }
  return c
}

/** The JS functions Python's stand-ins call (spec 5.1). Pins are BCM numbers 0..27. */
export function makeHw(m: BoardMemory, clock: RunClock, o: { board: BoardKind; onPrompt: (text: string) => void; flush: () => void }) {
  const pin = (bcm: number) => {
    if (!(Number.isInteger(bcm) && bcm >= 0 && bcm < NPINS)) throw new RangeError(`there is no GPIO${bcm}`)
  }
  const nowUs = () => Math.round(clock.now() * 1000) >>> 0
  return {
    /** A mode or pull change (spec 2.2): bumps the code sequence; leaving output drops the latch and the PWM descriptor. */
    setup(bcm: number, mode: number) {
      pin(bcm)
      writeLocked(m, H.outSeq, () => setOut(m, bcm, { mode: mode as ModeCode, ...(mode !== MODE.output ? { latch: 0, pwmActive: false } : {}) }))
      Atomics.add(m.i32, H.codeSeq, 1)
    },
    /** A plain write: the latch, and the bit-bang counters (edges, high time) the sampler reads. */
    output(bcm: number, value: number) {
      pin(bcm)
      const v = value ? 1 : 0
      const t = nowUs()
      writeLocked(m, H.outSeq, () => {
        const was = readOut(m, bcm)
        if (was.latch === v) return
        setOut(m, bcm, v ? { latch: 1, changedUs: t, rising: was.rising + 1 } : { latch: 0, changedUs: t, falling: was.falling + 1, highUs: was.highUs + ((t - was.changedUs) >>> 0) })
      })
    },
    /**
     * A pin read (spec 4.4): an output reads its own latch; an input waits (at most 200 ms of run
     * time) for a result solved through the latest mode change, then reads the editor's level, or its
     * pull level before any result.
     */
    read(bcm: number): number {
      pin(bcm)
      clock.poll()
      const own = readLocked(m, H.outSeq, () => readOut(m, bcm))
      if (own.mode === MODE.output) return own.latch
      const want = Atomics.load(m.i32, H.codeSeq)
      const t0 = clock.now()
      while (Atomics.load(m.i32, H.solvedThrough) < want && clock.now() - t0 < 200) clock.block(t0 + 200)
      const r = readLocked(m, H.inSeq, () => readIn(m, bcm))
      if (r.status !== 'none') return r.level
      return own.mode === MODE.pullup ? 1 : 0
    },
    /** The declared PWM descriptor (spec 2.2): nothing toggles the pin. */
    pwm(bcm: number, active: boolean, duty: number, freq: number) {
      pin(bcm)
      writeLocked(m, H.outSeq, () => setOut(m, bcm, { pwmActive: !!active, duty: Math.min(1, Math.max(0, duty)), freq }))
    },
    rising: (bcm: number) => readLocked(m, H.inSeq, () => readIn(m, bcm).rising),
    falling: (bcm: number) => readLocked(m, H.inSeq, () => readIn(m, bcm).falling),
    volts(bcm: number): number | null {
      const r = readLocked(m, H.inSeq, () => readIn(m, bcm))
      return r.status === 'value' ? r.volts : null
    },
    monotonic: () => clock.now() / 1000,
    epoch: () => (clock.epochMs + clock.now()) / 1000,
    /** Python's scheduler: wait until run time `untilS` seconds (negative: until woken). */
    block(untilS: number) {
      clock.block(untilS < 0 ? Infinity : untilS * 1000)
    },
    /** A yield point: real time of the last one (the never-pauses check), whether timers or callbacks wait, and an output flush. */
    yielded(pending: boolean) {
      m.f64[F.lastYieldMs] = nowAbs()
      Atomics.store(m.i32, H.pending, pending ? 1 : 0)
      o.flush()
    },
    /** A timer, callback or poller now waits (the never-pauses check reads it with the last yield). */
    pending(on: boolean) {
      Atomics.store(m.i32, H.pending, on ? 1 : 0)
    },
    input_begin(prompt: string) {
      Atomics.store(m.i32, H.inputState, INPUT.waiting)
      o.onPrompt(String(prompt))
    },
    input_ready: () => Atomics.load(m.i32, H.inputState) === INPUT.ready,
    input_take: () => takeLine(m),
    board: () => o.board,
  }
}
