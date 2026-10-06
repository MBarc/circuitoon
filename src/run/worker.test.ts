// Firmware spec 2.6, 5.3, 5.4 in a real Node worker with real Pyodide: Serial output batched,
// tracebacks with the file name, input() resumed by a line, Stop as KeyboardInterrupt within 100 ms
// even mid-sleep(10), a worker that ignores Stop terminated after 1 s, a read after setup waiting for
// a solve (at most 200 ms), and the sandbox: no fetch, WebSocket or importScripts for user code.
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { realClock } from './bridge.ts'
import { F, H, INPUT, boardMemory, readOut, writeIn, writeLine } from './memory.ts'
import { sandbox } from './worker/sandbox.ts'
import { BoardRun } from './host.ts'
import { spawnNodeCodeWorker } from './node/codeWorker.ts'
import { PY_FILES } from './pyFiles.ts'
import { nodePy, runNode } from './testing.ts'

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
    expect(r.messages[0]).toMatchObject({ type: 'ready' })
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
  it('gives user code no host access: no fetch, no pyodide_js, no mounts, an empty scope', async () => {
    // jsglobals is curated and pyodide_js (Node file system mounts and sockets) is unregistered. A JS
    // function's constructor still evaluates in the Node worker's global scope (in the browser the CSP
    // refuses it; blocking it in Node awaits a ruling), so the backstop must have emptied that scope.
    // The stand-ins still work afterwards.
    const r = runNode(`import js
print(hasattr(js, 'fetch'))
try:
    import pyodide_js
    print('pyodide_js')
except ImportError:
    print('no pyodide_js')
import sys
def has(o):
    try:
        return hasattr(o, 'mountNodeFS') or hasattr(o, 'useNodeSockFS')
    except Exception:
        return False
print([n for n, mod in list(sys.modules.items()) if has(mod)] + [f'{n}.{a}' for n, mod in list(sys.modules.items()) for a in dir(mod) if has(getattr(mod, a, None))])
import circuitoon_hw
f = circuitoon_hw.read.constructor
print(f('return typeof fetch')(), f('return typeof WebSocket')(), f('return typeof importScripts')())
from gpiozero import LED
LED(17).on()
print('gpiozero ok')
`)
    expect(await r.exited).toBe('done')
    expect(out(r.messages)).toBe('False\nno pyodide_js\n[]\nundefined undefined undefined\ngpiozero ok\n')
    // The JS side: what left the worker's scope (Node has fetch and WebSocket, no importScripts).
    const ready = r.messages.find((m) => m.type === 'ready')
    expect(ready && 'sandboxed' in ready && [...ready.sandboxed].sort()).toEqual(expect.arrayContaining(['WebSocket', 'fetch']))
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

describe('the host (spec 5.2, 5.4, ruling R28)', () => {
  it('counts the never-pauses time from when the code starts, not from the spawn', async () => {
    let atReady = 0
    let stamped = 0
    const spawned = performance.timeOrigin + performance.now()
    // No yield point in this script, so nothing rewrites the stamp after 'ready'.
    const r = runNode('x = sum(range(10))\n', {
      on: (m, run) => {
        if (m.type !== 'ready') return
        atReady = performance.timeOrigin + performance.now()
        stamped = run.memory.f64[F.lastYieldMs]
      },
    })
    expect(r.run.memory.f64[F.lastYieldMs]).toBe(0)
    expect(await r.exited).toBe('done')
    // Stamped by the worker just before 'ready': after Pyodide loaded, not at the spawn.
    expect(stamped).toBeGreaterThan(spawned + 100)
    expect(stamped).toBeLessThanOrEqual(atReady + 1)
    expect(atReady - stamped).toBeLessThan(100)
  }, 60_000)
  it('terminates the worker once the run has finished', async () => {
    let gone = ''
    const run = new BoardRun({
      board: 'pi4', source: "print('hi')\n", file: 'main.py', mode: 'real', py: nodePy(), files: PY_FILES, on: () => {},
      spawn: () => {
        const w = spawnNodeCodeWorker()
        w.onError((why) => (gone = why))
        return w
      },
    })
    run.start()
    await run.done
    expect(run.status).toBe('done')
    await expect.poll(() => gone, { timeout: 2000 }).toMatch(/exited/)
  }, 60_000)
})
