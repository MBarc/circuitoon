// Runs a script on the real Python stand-ins in-process (Pyodide from node_modules), on a test clock,
// with inputs scheduled by run time: what the stand-in tests use (firmware spec 10). One Pyodide per
// test file; each run gets a fresh board memory and fresh modules. Solves are instant: every step
// marks the board solved through its latest code sequence.
import { loadPyodide } from 'pyodide'
import type { BoardKind } from './boards.ts'
import { makeHw, testClock } from './bridge.ts'
import { H, INPUT, MODE, type PinIn, boardMemory, readOut, writeIn, writeLine } from './memory.ts'
import { PY_FILES } from './pyFiles.ts'
import { type PyodideLike, installFiles, pyValueError, resetModules, runMain } from './worker/serve.ts'

export type ScriptInput = { atMs: number; bcm: number; level: 0 | 1 } | { atMs: number; line: string }
export interface Trace { t: number; bcm: number; mode?: number; latch?: 0 | 1; pwm?: { active: boolean; duty: number; freq: number } }
export interface RunResult { status: string; out: string; err: string; trace: Trace[]; prompts: string[]; yields: { t: number; pending: boolean }[]; t: number }

let pyodide: Promise<PyodideLike> | null = null
const interruptBuffer = new Int32Array(new SharedArrayBuffer(4))
function py(): Promise<PyodideLike> {
  pyodide ??= (loadPyodide() as unknown as Promise<PyodideLike>).then((p) => {
    installFiles(p, PY_FILES)
    p.setInterruptBuffer(interruptBuffer)
    return p
  })
  return pyodide
}

export async function runScript(source: string, o: { inputs?: ScriptInput[]; untilMs?: number; board?: BoardKind; file?: string } = {}): Promise<RunResult> {
  const p = await py()
  resetModules(p)
  const m = boardMemory()
  const res: RunResult = { status: '', out: '', err: '', trace: [], prompts: [], yields: [], t: 0 }
  const events = [...(o.inputs ?? [])].sort((a, b) => a.atMs - b.atMs)
  const levels = new Map<number, PinIn>()
  const onStep = (t: number) => {
    // Instant solves: whatever the code set up has been solved.
    Atomics.store(m.i32, H.solvedThrough, Atomics.load(m.i32, H.codeSeq))
    while (events.length && events[0].atMs <= t) {
      const e = events[0]
      if ('line' in e) {
        if (Atomics.load(m.i32, H.inputState) !== INPUT.waiting) break
        events.shift()
        writeLine(m, e.line)
        continue
      }
      events.shift()
      // Like LevelTracker's first result: a pulled-up pin starts high and the first scripted level is an edge only if it differs.
      const was = levels.get(e.bcm) ?? { level: readOut(m, e.bcm).mode === MODE.pullup ? 1 : 0, rising: 0, falling: 0, status: 'value', volts: 0 }
      const row: PinIn = { level: e.level, status: 'value', volts: e.level ? 3.3 : 0, rising: was.rising + (e.level && !was.level ? 1 : 0), falling: was.falling + (!e.level && was.level ? 1 : 0) }
      levels.set(e.bcm, row)
      writeIn(m, Array.from({ length: e.bcm + 1 }, (_, b) => (b === e.bcm ? row : null)), Atomics.load(m.i32, H.codeSeq))
    }
  }
  interruptBuffer[0] = 0
  const clock = testClock({ onStep, limitMs: o.untilMs ?? 60_000, stop: () => { interruptBuffer[0] = 2; p.checkInterrupt() } })
  const hw = makeHw(m, clock, { board: o.board ?? 'pi4', onPrompt: (text) => res.prompts.push(text), flush: () => {}, fail: pyValueError(p) })
  // Record what the code does to its pins, at the run time it does it.
  const traced = {
    ...hw,
    setup(bcm: number, mode: number) { hw.setup(bcm, mode); res.trace.push({ t: clock.t, bcm, mode }) },
    output(bcm: number, v: number) {
      const before = readOut(m, bcm).latch
      hw.output(bcm, v)
      if (readOut(m, bcm).latch !== before) res.trace.push({ t: clock.t, bcm, latch: readOut(m, bcm).latch })
    },
    pwm(bcm: number, active: boolean, duty: number, freq: number) { hw.pwm(bcm, active, duty, freq); res.trace.push({ t: clock.t, bcm, pwm: { active, duty: readOut(m, bcm).duty, freq } }) },
    yielded(pending: boolean) { hw.yielded(pending); res.yields.push({ t: clock.t, pending }) },
  }
  p.registerJsModule('circuitoon_hw', traced)
  p.setStdout({ batched: (s) => void (res.out += `${s}\n`) })
  p.setStderr({ batched: (s) => void (res.err += `${s}\n`) })
  res.status = runMain(p, source, o.file ?? 'main.py')
  res.t = clock.t
  return res
}
