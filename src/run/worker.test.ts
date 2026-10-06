// Firmware spec 2.6, 5.3, 5.4 in a real Node worker with real Pyodide: Serial output batched,
// tracebacks with the file name, input() resumed by a line, Stop as KeyboardInterrupt within 100 ms
// even mid-sleep(10), a worker that ignores Stop terminated after 1 s, a read after setup waiting for
// a solve (at most 200 ms), and the sandbox: no fetch, WebSocket or importScripts for user code.
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { realClock } from './bridge.ts'
import { F, H, INPUT, boardMemory, readOut, writeIn, writeLine } from './memory.ts'
import { sandbox } from './worker/sandbox.ts'
import { runNode } from './testing.ts'

const out = (ms: { type: string; text?: string; stream?: string }[], stream = 'out') => ms.filter((m) => m.type === 'out' && m.stream === stream).map((m) => m.text).join('')

describe('sandbox (spec 2.6)', () => {
  it('removes the network, storage and workers from the scope and its prototypes', () => {
    const proto = { fetch() {}, indexedDB: {}, other: 1 }
    const scope = Object.assign(Object.create(proto), { WebSocket: class {}, importScripts() {} })
    expect(sandbox(scope).sort()).toEqual(['WebSocket', 'fetch', 'importScripts', 'indexedDB'])
    expect([scope.fetch, scope.WebSocket, scope.importScripts, scope.indexedDB, scope.other]).toEqual([undefined, undefined, undefined, undefined, 1])
  })
})

describe('the code worker (spec 5.3, 5.4)', () => {
  it('runs a script and batches its Serial output', async () => {
    const r = runNode("for i in range(100):\n    print('line', i)\n")
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe(Array.from({ length: 100 }, (_, i) => `line ${i}\n`).join(''))
    expect(r.messages.filter((m) => m.type === 'out').length).toBeLessThan(100)
    expect(r.messages[0]).toEqual({ type: 'ready' })
  }, 60_000)
  it('prints a traceback with the script file name and ends with error', async () => {
    const r = runNode("x = 1\nraise ValueError('bad')\n", { file: 'blink.py' })
    expect(await r.exited).toBe('error')
    expect(out(r.messages, 'err')).toContain('File "blink.py", line 2, in <module>')
  }, 60_000)
  it('resumes input() with a line from the host', async () => {
    const r = runNode("print('Hi', input('Name? '))\n", { on: (m, run) => m.type === 'prompt' && writeLine(run.memory, 'Ada') })
    expect(await r.exited).toBe('done')
    expect(r.messages).toContainEqual({ type: 'prompt', text: 'Name? ' })
    expect(out(r.messages)).toBe('Hi Ada\n')
  }, 60_000)
  it('stops a sleep(10) with KeyboardInterrupt within 100 ms, running finally', async () => {
    let started = 0
    const r = runNode("import time\ntry:\n    print('sleeping')\n    time.sleep(10)\nfinally:\n    print('cleaned up')\n", {
      on: (m, run) => {
        if (m.type === 'out' && m.text?.includes('sleeping')) setTimeout(() => { started = performance.now(); void run.stop() }, 200)
      },
    })
    expect(await r.exited).toBe('stopped')
    expect(performance.now() - started).toBeLessThan(100)
    expect(out(r.messages)).toBe('sleeping\ncleaned up\n')
  }, 60_000)
  it('terminates a worker that ignores Stop after 1 s', async () => {
    let result: Promise<string> | null = null
    const t0 = { at: 0 }
    const r = runNode("import time\nprint('go')\nwhile True:\n    try:\n        time.sleep(1)\n    except KeyboardInterrupt:\n        pass\n", {
      on: (m, run) => {
        if (m.type === 'out' && !result) {
          t0.at = performance.now()
          result = run.stop()
        }
      },
    })
    await r.exited
    expect(await result).toBe('terminated')
    expect(performance.now() - t0.at).toBeGreaterThanOrEqual(990)
  }, 60_000)
  it('waits up to 200 ms for a solve after setup, then reads the pull level', async () => {
    const r = runNode('import time\nimport RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nt = time.monotonic()\nv = GPIO.input(27)\nprint(v, round(time.monotonic() - t, 1))\n')
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('1 0.2\n')
  }, 60_000)
  it('reads the level as soon as a solve through the latest setup lands', async () => {
    const r = runNode('import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nprint(GPIO.input(27))\n', {
      on: (m, run) => {
        if (m.type !== 'ready') return
        setTimeout(() => writeIn(run.memory, Array.from({ length: 28 }, (_, b) => (b === 27 ? { level: 0, rising: 0, falling: 1, status: 'value', volts: 0 } : null)), 1_000), 50)
      },
    })
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('0\n')
  }, 60_000)
  it('gives user code no network: js has no fetch, and the worker scope has none either', async () => {
    // run_js needs js.eval, which the curated jsglobals leave out. A registered function's constructor
    // (Function) still evaluates in the worker's global scope (in the browser the CSP refuses it): the
    // backstop must have emptied that scope too.
    const r = runNode(
      "import js\nprint(hasattr(js, 'fetch'))\ntry:\n    from pyodide.code import run_js\n    run_js('1')\nexcept ImportError:\n    print('no run_js')\nimport circuitoon_hw\nf = circuitoon_hw.read.constructor\nprint(f('return typeof fetch')(), f('return typeof WebSocket')(), f('return typeof importScripts')())\n",
    )
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('False\nno run_js\nundefined undefined undefined\n')
  }, 60_000)
  it('leaves every pin unused at the end', async () => {
    const r = runNode('import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.output(17, 1)\n')
    await r.exited
    expect(readOut(r.run.memory, 17).mode).toBe(0)
    expect(Atomics.load(r.run.memory.i32, H.inputState)).toBe(INPUT.idle)
  }, 60_000)
})

describe('the real clock (spec 5.2)', () => {
  const started = () => {
    const m = boardMemory()
    m.f64[F.startMs] = performance.timeOrigin + performance.now()
    let checks = 0
    return { m, clock: realClock(m, () => void checks++), checks: () => checks }
  }
  it('waits at most 50 ms at a time, then checks for Stop', () => {
    const { clock, checks } = started()
    const t0 = performance.now()
    clock.block(Infinity)
    const took = performance.now() - t0
    expect(took).toBeGreaterThanOrEqual(45)
    expect(took).toBeLessThan(150)
    expect(checks()).toBe(1)
  })
  it('checks for Stop without waiting when the time has passed', () => {
    const { clock, checks } = started()
    const t0 = performance.now()
    clock.block(0)
    expect(performance.now() - t0).toBeLessThan(10)
    expect(checks()).toBe(1)
  })
  it('returns early on a wake from another thread', async () => {
    const { m, clock, checks } = started()
    const w = new Worker(
      "const { parentPort, workerData } = require('node:worker_threads'); const i32 = new Int32Array(workerData); parentPort.on('message', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); Atomics.add(i32, 0, 1); Atomics.notify(i32, 0) }); parentPort.postMessage('up')",
      { eval: true, workerData: m.sab },
    )
    await new Promise((r) => w.once('message', r))
    w.postMessage('go')
    const t0 = performance.now()
    clock.block(Infinity)
    const took = performance.now() - t0
    await w.terminate()
    expect(Atomics.load(m.i32, H.wake)).toBe(1)
    expect(took).toBeLessThan(40)
    expect(checks()).toBe(1)
  })
})

describe('the host (spec 5.2, ruling R28)', () => {
  it('counts the never-pauses time from the start, not from time 0', async () => {
    const before = performance.timeOrigin + performance.now()
    const r = runNode('pass\n')
    expect(r.run.memory.f64[F.lastYieldMs]).toBeGreaterThanOrEqual(before)
    expect(await r.exited).toBe('done')
  }, 60_000)
})
