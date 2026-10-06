// Firmware spec 5.2 and 5.3 against real Pyodide (node_modules/pyodide), on a test clock: every wait
// is ours (sleep advances run time), timers and callbacks run at yield points and never inside a
// callback, exceptions in callbacks are printed and the script goes on (ruling R10), tracebacks list
// only the user's frames (R11), input() waits for a line (R12), threads and unsupported modules fail
// with the spec's words, Stop is a KeyboardInterrupt that runs finally blocks.
import { describe, expect, it } from 'vitest'
import { runScript } from './pyHarness.testing.ts'

describe('the Python run-time (spec 5.2, 5.3)', () => {
  it('sleeps on the run clock and reads time from it', async () => {
    const r = await runScript('import time\nt0 = time.monotonic()\ntime.sleep(1.5)\nprint(round(time.monotonic() - t0, 2))\nprint(int(time.time()))\n')
    expect(r.status).toBe('done')
    expect(r.out).toBe('1.5\n1767225601\n')
  })
  it('runs timers at yield points, and never one callback inside another', async () => {
    const r = await runScript([
      'import time, _circuitoon as rt',
      "def a():\n    print('a start', round(rt.now(), 1))\n    time.sleep(1)\n    print('a end', round(rt.now(), 1))",
      "rt.call_later(0.1, a)\nrt.call_later(0.2, lambda: print('b', round(rt.now(), 1)))",
      'time.sleep(3)',
    ].join('\n'))
    expect(r.out).toBe('a start 0.1\na end 1.1\nb 1.1\n')
  })
  it('prints an exception in a callback and goes on (ruling R10)', async () => {
    const r = await runScript("import time, _circuitoon as rt\ndef bad():\n    raise ValueError('oops')\nrt.call_later(0.1, bad)\ntime.sleep(0.5)\nprint('still here')\n", { file: 'blink.py' })
    expect(r.status).toBe('done')
    expect(r.err).toContain('File "blink.py", line 3, in bad')
    expect(r.err).toContain('ValueError: oops')
    expect(r.out).toBe('still here\n')
  })
  it('lists only the user\'s frames in a traceback, and ends with status error (R11)', async () => {
    const r = await runScript("import time\ndef f():\n    time.sleep(0.1)\n    raise RuntimeError('boom')\n\nf()\n", { file: 'blink.py' })
    expect(r.status).toBe('error')
    expect(r.err).toContain('File "blink.py", line 6, in <module>')
    expect(r.err).toContain('File "blink.py", line 4, in f')
    expect(r.err).not.toContain('_circuitoon')
  })
  it('refuses threads and unsupported modules in the spec\'s words', async () => {
    const t = await runScript('import threading\nthreading.Thread(target=print).start()\n')
    expect(t.err).toContain("RuntimeError: Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()")
    const s = await runScript('import smbus\n')
    expect(s.err).toContain('ImportError: smbus needs I2C devices, coming in a later update')
    expect(s.status).toBe('error')
  })
  it('waits in input() for a line, with the prompt in the box (R12)', async () => {
    const r = await runScript("name = input('Name? ')\nprint('Hi', name)\n", { inputs: [{ atMs: 500, line: 'Ada' }] })
    expect(r.prompts).toEqual(['Name? '])
    expect(r.out).toBe('Hi Ada\n')
    expect(r.t).toBeGreaterThanOrEqual(500)
  })
  it('stops with KeyboardInterrupt, running finally blocks (spec 5.4)', async () => {
    const r = await runScript("import time\ntry:\n    time.sleep(10)\nfinally:\n    print('cleaned up')\n", { untilMs: 1000 })
    expect(r.status).toBe('stopped')
    expect(r.out).toBe('cleaned up\n')
  })
  it('reports a pending timer at yield points, for the never-pauses warning', async () => {
    const r = await runScript("import time, _circuitoon as rt\nrt.call_later(5, print)\ntime.sleep(0.1)\n")
    expect(r.yields.some((y) => y.pending)).toBe(true)
  })
  it('ends cleanly on sys.exit(0) and puts every pin back to unused', async () => {
    const r = await runScript('import sys\nsys.exit(0)\n')
    expect(r.status).toBe('done')
    expect(r.trace.filter((x) => x.mode === 0)).toHaveLength(28)
  })
  it('waits in signal.pause() as gpiozero examples do, until Stop', async () => {
    const r = await runScript("from signal import pause\nimport _circuitoon as rt\nrt.call_later(0.2, lambda: print('tick'))\npause()\n", { untilMs: 500 })
    expect([r.status, r.out]).toEqual(['stopped', 'tick\n'])
  })
  it('lets a finally block sleep after Stop, interrupting only once (spec 5.4)', async () => {
    const r = await runScript("import time\ntry:\n    time.sleep(10)\nfinally:\n    time.sleep(0.1)\n    print('cleaned')\n", { untilMs: 1000 })
    expect([r.status, r.out]).toEqual(['stopped', 'cleaned\n'])
  })
  it('fails a test whose finally block waits forever after Stop, instead of hanging', async () => {
    const r = await runScript('from signal import pause\ntry:\n    pause()\nfinally:\n    pause()\n', { untilMs: 500 })
    expect(r.status).toBe('error')
    expect(r.err).toContain('test clock ran past its limit')
  })
  it('prints an exception in a poller and goes on (ruling R10)', async () => {
    const r = await runScript("import time, _circuitoon as rt\nn = []\ndef p():\n    if not n:\n        n.append(1)\n        raise ValueError('poll oops')\nrt.add_poller(p)\ntime.sleep(0.5)\nprint('still here')\n", { file: 'blink.py' })
    expect(r.status).toBe('done')
    expect(r.err).toContain('ValueError: poll oops')
    expect(r.out).toBe('still here\n')
  })
  it('raises ValueError for anything circuitoon_hw cannot store, and stores nothing', async () => {
    const calls = ['hw.setup(17, 99)', 'hw.setup(17, -1)', 'hw.setup(17, 1.5)', "hw.setup(17, '4')", 'hw.setup(99, 4)', "hw.pwm(18, True, float('nan'), 50)", "hw.pwm(18, True, float('inf'), 50)", "hw.pwm(18, True, 0.5, float('nan'))", 'hw.pwm(18, True, 0.5, 0)', "hw.block(float('nan'))", "hw.block(float('inf'))"]
    const r = await runScript(`import circuitoon_hw as hw\nfor call in (${calls.map((c) => `lambda: ${c}`).join(', ')}):\n    try:\n        call()\n        print('stored')\n    except ValueError as e:\n        print(e)\n`)
    expect(r.out.split('\n').slice(0, -1)).toEqual([
      'pin mode must be a whole number from 0 to 4, not 99', 'pin mode must be a whole number from 0 to 4, not -1', 'pin mode must be a whole number from 0 to 4, not 1.5', 'pin mode must be a whole number from 0 to 4, not 4', 'there is no GPIO99',
      'PWM duty cycle must be a number, not nan', 'PWM duty cycle must be a number, not inf', 'PWM frequency must be a number greater than 0, not nan', 'PWM frequency must be a number greater than 0, not 0',
      'wait time must be a finite number, not nan', 'wait time must be a finite number, not inf',
    ])
    // Only the end of run's reset to unused: nothing the calls above tried was stored.
    expect(r.trace.filter((x) => x.mode !== 0)).toEqual([])
  })
  it('refuses time.sleep(inf) with a ValueError (sleep(nan) is sleep(0): wait clamps it)', async () => {
    expect((await runScript("import time\ntime.sleep(float('inf'))\n")).err).toContain('ValueError: wait time must be a finite number, not inf')
  })
})
