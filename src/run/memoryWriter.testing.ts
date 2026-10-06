// Test worker: writes pin 5's rising, falling, highUs and duty to the same counter k under the out
// seqlock as fast as it can, until the main thread sets the wake word to -1.
import { workerData } from 'node:worker_threads'
import { H, boardMemory, setOut, writeLocked } from './memory.ts'

const m = boardMemory(workerData.sab as SharedArrayBuffer)
for (let k = 1; Atomics.load(m.i32, H.wake) !== -1; k++) writeLocked(m, H.outSeq, () => setOut(m, 5, { rising: k, falling: k, highUs: k, duty: k }))
