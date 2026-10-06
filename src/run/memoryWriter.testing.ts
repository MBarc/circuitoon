// Test worker, until the main thread sets the wake word to -1. Default: writes pin 5's rising,
// falling, highUs and duty to the same counter k under the out seqlock as fast as it can. With
// `setup`: the k-th call is the real setup() of pin 6, pull-up when k is odd, input when even, so
// the code sequence k and the mode it numbers must always be read together.
import { workerData } from 'node:worker_threads'
import { makeHw } from './bridge.ts'
import { H, MODE, boardMemory, setOut, writeLocked } from './memory.ts'

const m = boardMemory(workerData.sab as SharedArrayBuffer)
if (workerData.setup) {
  const hw = makeHw(m, { epochMs: 0, now: () => 0, block() {}, poll() {} }, { board: 'pi4', onPrompt() {}, flush() {} })
  for (let k = 1; Atomics.load(m.i32, H.wake) !== -1; k++) hw.setup(6, k % 2 ? MODE.pullup : MODE.input)
} else {
  for (let k = 1; Atomics.load(m.i32, H.wake) !== -1; k++) writeLocked(m, H.outSeq, () => setOut(m, 5, { rising: k, falling: k, highUs: k, duty: k }))
}
