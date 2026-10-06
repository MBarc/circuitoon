// One running board's shared memory (firmware spec 2.2): a SharedArrayBuffer the code worker and the
// editor (or the CLI's driver) both map. Two tables, each written by one side only and guarded by a
// seqlock (odd while the writer is mid-update; readers retry until they read the same even value
// before and after): the pin table (mode, latch, declared PWM, bit-bang counters; the worker writes
// it) and the input table (levels, edge counters, voltages; the editor writes it). The header holds
// the wake word every wait blocks on, Pyodide's interrupt buffer, the code and solved sequence
// numbers, the input() line state and the clock doubles. Counters are wrapping uint32: read them as
// differences, `(now - then) >>> 0`. Worker side too: nothing Vite-specific.
//
// Byte layout: header ints 0..35, header doubles 64..95, pin table ints 128..1023 (8 per pin), pin
// doubles 1024..1471 (duty, freq per pin), input ints 2048..2495 (4 per pin), input doubles
// 2560..2783 (volts per pin), the input line 4096..8191.
export const NPINS = 28
export const MODE = { unused: 0, input: 1, pullup: 2, pulldown: 3, output: 4 } as const
export type ModeCode = (typeof MODE)[keyof typeof MODE]
export const IN_STATUS = { none: 0, value: 1, floating: 2, undefined: 3 } as const
export type InStatus = keyof typeof IN_STATUS
export const INPUT = { idle: 0, waiting: 1, ready: 2 } as const
/** Header Int32 slots. `interrupt` is Pyodide's interrupt buffer (2 = SIGINT). */
export const H = { wake: 0, interrupt: 1, outSeq: 2, inSeq: 3, solvedThrough: 4, codeSeq: 5, inputState: 6, inputLen: 7, pending: 8 } as const
/** Header Float64 slots: the virtual clock and the driver's horizon (ms of run time), the last yield (epoch ms, real time) and the run's start (epoch ms). */
export const F = { clockMs: 8, horizonMs: 9, lastYieldMs: 10, startMs: 11 } as const
const OUT_I = 32
const OUT_W = 8
const OUT_F = 128
const IN_I = 512
const IN_W = 4
const IN_F = 320
export const LINE_AT = 4096
export const LINE_MAX = 4096
export const SAB_BYTES = 8192
const STATUS_OF = Object.keys(IN_STATUS) as InStatus[]

export interface BoardMemory { sab: SharedArrayBuffer; i32: Int32Array; f64: Float64Array; line: Uint8Array }
export interface PinOut { mode: ModeCode; latch: 0 | 1; pwmActive: boolean; duty: number; freq: number; rising: number; falling: number; highUs: number; changedUs: number }
export interface PinIn { level: 0 | 1; rising: number; falling: number; status: InStatus; volts: number }

export function boardMemory(sab: SharedArrayBuffer = new SharedArrayBuffer(SAB_BYTES)): BoardMemory {
  return { sab, i32: new Int32Array(sab), f64: new Float64Array(sab), line: new Uint8Array(sab, LINE_AT, LINE_MAX) }
}

/** The writer's half of a seqlock: odd while `fn` runs, even after. One writer per table. */
export function writeLocked(m: BoardMemory, seq: number, fn: () => void): void {
  Atomics.add(m.i32, seq, 1)
  try {
    fn()
  } finally {
    Atomics.add(m.i32, seq, 1)
  }
}

/** The reader's half: retries until the sequence is the same even value before and after `fn`. */
export function readLocked<T>(m: BoardMemory, seq: number, fn: () => T): T {
  for (;;) {
    const a = Atomics.load(m.i32, seq)
    if (a & 1) continue
    const v = fn()
    // An RMW, not a load: earlier plain loads (the Float64 fields) cannot be reordered past it on weakly ordered CPUs.
    if (Atomics.compareExchange(m.i32, seq, a, a) === a) return v
  }
}

export function readOut(m: BoardMemory, bcm: number): PinOut {
  const i = OUT_I + bcm * OUT_W
  const f = OUT_F + bcm * 2
  const v = m.i32
  return { mode: Atomics.load(v, i) as ModeCode, latch: Atomics.load(v, i + 1) ? 1 : 0, pwmActive: Atomics.load(v, i + 2) !== 0, duty: m.f64[f], freq: m.f64[f + 1], rising: Atomics.load(v, i + 3) >>> 0, falling: Atomics.load(v, i + 4) >>> 0, highUs: Atomics.load(v, i + 5) >>> 0, changedUs: Atomics.load(v, i + 6) >>> 0 }
}

export function setOut(m: BoardMemory, bcm: number, p: Partial<PinOut>): void {
  const i = OUT_I + bcm * OUT_W
  const f = OUT_F + bcm * 2
  const v = m.i32
  if (p.mode !== undefined) Atomics.store(v, i, p.mode)
  if (p.latch !== undefined) Atomics.store(v, i + 1, p.latch)
  if (p.pwmActive !== undefined) Atomics.store(v, i + 2, p.pwmActive ? 1 : 0)
  if (p.rising !== undefined) Atomics.store(v, i + 3, p.rising | 0)
  if (p.falling !== undefined) Atomics.store(v, i + 4, p.falling | 0)
  if (p.highUs !== undefined) Atomics.store(v, i + 5, p.highUs | 0)
  if (p.changedUs !== undefined) Atomics.store(v, i + 6, p.changedUs | 0)
  if (p.duty !== undefined) m.f64[f] = p.duty
  if (p.freq !== undefined) m.f64[f + 1] = p.freq
}

export function readIn(m: BoardMemory, bcm: number): PinIn {
  const i = IN_I + bcm * IN_W
  const v = m.i32
  return { level: Atomics.load(v, i) ? 1 : 0, rising: Atomics.load(v, i + 1) >>> 0, falling: Atomics.load(v, i + 2) >>> 0, status: STATUS_OF[Atomics.load(v, i + 3)] ?? 'none', volts: m.f64[IN_F + bcm] }
}

export function setIn(m: BoardMemory, bcm: number, p: PinIn): void {
  const i = IN_I + bcm * IN_W
  const v = m.i32
  Atomics.store(v, i, p.level)
  Atomics.store(v, i + 1, p.rising | 0)
  Atomics.store(v, i + 2, p.falling | 0)
  Atomics.store(v, i + 3, IN_STATUS[p.status])
  m.f64[IN_F + bcm] = p.volts
}

/** Every pin's row, read under the seqlock. */
export function readAllOut(m: BoardMemory): PinOut[] {
  return readLocked(m, H.outSeq, () => Array.from({ length: NPINS }, (_, b) => readOut(m, b)))
}

/** The editor's write (spec 4.4): the rows it has, "solved through code sequence N", then a wake. */
export function writeIn(m: BoardMemory, rows: (PinIn | null)[], solvedThrough: number): void {
  writeLocked(m, H.inSeq, () => rows.forEach((r, bcm) => r && setIn(m, bcm, r)))
  Atomics.store(m.i32, H.solvedThrough, solvedThrough)
  wake(m)
}

/** Wakes every wait (spec 5.2): a new result, a line of input, Stop. */
export function wake(m: BoardMemory): void {
  Atomics.add(m.i32, H.wake, 1)
  Atomics.notify(m.i32, H.wake)
}

/** Stop (spec 5.4): KeyboardInterrupt at the next check, and a wake so a wait checks now. */
export function interrupt(m: BoardMemory): void {
  Atomics.store(m.i32, H.interrupt, 2)
  wake(m)
}

/** A line for input() (spec 5.3), cut to the buffer. */
export function writeLine(m: BoardMemory, text: string): void {
  const bytes = new TextEncoder().encode(text).slice(0, LINE_MAX)
  m.line.set(bytes)
  Atomics.store(m.i32, H.inputLen, bytes.length)
  Atomics.store(m.i32, H.inputState, INPUT.ready)
  wake(m)
}

export function takeLine(m: BoardMemory): string {
  const text = new TextDecoder().decode(m.line.slice(0, Atomics.load(m.i32, H.inputLen)))
  Atomics.store(m.i32, H.inputState, INPUT.idle)
  return text
}
