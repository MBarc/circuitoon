// Firmware spec 2.2: one SharedArrayBuffer per board with two seqlocked tables. Fields never overlap;
// counters wrap as uint32; a reader never sees a half-written row while the writer races it.
import { describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { F, H, IN_STATUS, INPUT, MODE, NPINS, boardMemory, readAllOut, readIn, readLocked, readOut, setOut, takeLine, writeIn, writeLine, writeLocked } from './memory.ts'
import { bcmOf, boardKindOf, gpioPin } from './boards.ts'
import { load } from '../format/builtinModules.testing.ts'

describe('board memory (spec 2.2)', () => {
  it('keeps every field of every pin apart from the header and each other', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => {
      for (let b = 0; b < NPINS; b++) setOut(m, b, { mode: MODE.output, latch: (b % 2) as 0 | 1, pwmActive: b % 3 === 0, duty: b / 100, freq: 50 + b, rising: 1000 + b, falling: 2000 + b, highUs: 3000 + b, changedUs: 4000 + b })
    })
    writeIn(m, Array.from({ length: NPINS }, (_, b) => ({ level: (b % 2) as 0 | 1, rising: 10 + b, falling: 20 + b, status: 'value' as const, volts: b / 10 })), 7)
    m.f64[F.clockMs] = 1.5
    m.f64[F.startMs] = 99
    for (let b = 0; b < NPINS; b++) {
      expect(readOut(m, b)).toEqual({ mode: MODE.output, latch: b % 2, pwmActive: b % 3 === 0, duty: b / 100, freq: 50 + b, rising: 1000 + b, falling: 2000 + b, highUs: 3000 + b, changedUs: 4000 + b })
      expect(readIn(m, b)).toEqual({ level: b % 2, rising: 10 + b, falling: 20 + b, status: 'value', volts: b / 10 })
    }
    expect([Atomics.load(m.i32, H.solvedThrough), m.f64[F.clockMs], m.f64[F.startMs], Atomics.load(m.i32, H.outSeq) % 2, Atomics.load(m.i32, H.inSeq) % 2]).toEqual([7, 1.5, 99, 0, 0])
    expect(readAllOut(m)).toHaveLength(NPINS)
  })
  it('wraps counters as uint32, so differences stay right across the wrap', () => {
    const m = boardMemory()
    writeLocked(m, H.outSeq, () => setOut(m, 3, { rising: 0xffffffff }))
    const before = readOut(m, 3).rising
    writeLocked(m, H.outSeq, () => setOut(m, 3, { rising: before + 2 }))
    expect(before).toBe(0xffffffff)
    expect((readOut(m, 3).rising - before) >>> 0).toBe(2)
  })
  it('wakes waiters on writeIn and passes the input line', () => {
    const m = boardMemory()
    const w0 = Atomics.load(m.i32, H.wake)
    writeIn(m, [], 1)
    expect(Atomics.load(m.i32, H.wake)).toBe(w0 + 1)
    writeLine(m, 'héllo')
    expect(Atomics.load(m.i32, H.inputState)).toBe(INPUT.ready)
    expect(takeLine(m)).toBe('héllo')
    expect(Atomics.load(m.i32, H.inputState)).toBe(INPUT.idle)
    expect(readIn(m, 0).status).toBe('none')
    expect(IN_STATUS.none).toBe(0)
  })
  it('never lets a reader see a torn row while a worker writes (seqlock)', async () => {
    const m = boardMemory()
    const w = new Worker(new URL('./memoryWriter.testing.ts', import.meta.url), { workerData: { sab: m.sab } })
    // Wait for the worker's first write: its start-up (loading the .ts) takes longer than any fixed sleep we could trust.
    while (readOut(m, 5).rising === 0) await new Promise((r) => setTimeout(r, 5))
    let torn = 0
    const seen = new Set<number>()
    for (let i = 0; i < 200_000; i++) {
      const o = readLocked(m, H.outSeq, () => readOut(m, 5))
      if (o.rising !== o.falling || o.rising !== o.highUs || o.duty !== o.rising) torn++
      seen.add(o.rising)
    }
    Atomics.store(m.i32, H.wake, -1)
    await w.terminate()
    // The writer must have advanced through the loop, or torn === 0 would prove nothing.
    expect(seen.size).toBeGreaterThan(100)
    expect(torn).toBe(0)
  })
})

describe('board kinds', () => {
  it('names the three Pis and their header pins', () => {
    expect(['rpi-4-model-b', 'rpi-5', 'rpi-zero-2-w', 'rpi-pico'].map((id) => boardKindOf(load(id)))).toEqual(['pi4', 'pi5', 'zero2w', null])
    expect([gpioPin(17), bcmOf('GPIO17'), bcmOf('GND'), bcmOf('GPIO2/SDA')]).toEqual(['GPIO17', 17, null, null])
  })
})
