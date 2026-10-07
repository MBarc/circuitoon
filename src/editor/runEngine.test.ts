// Firmware spec 2.1, 2.3, 4.5, 5.2 to 5.4 in the editor's controller, with the Node code worker and
// the Node engine standing in for the browser's: Run starts (starting, then running) after the first
// solve and refuses an unpowered board; the sampler drives run pin states the session solves; Stop
// restores the saved states and leaves the sheet and its history alone; deleting the board stops it;
// editing its code does not; turning Simulate off stops everything; input() takes a line; losing
// power stops the board; a script that never pauses while blink() waits is told so.
import { afterAll, describe, expect, it } from 'vitest'
import { libraryLookup } from '../agent/catalog.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { SimSession } from '../sim/session.ts'
import { spawnNodeCodeWorker } from '../run/node/codeWorker.ts'
import { nodePy } from '../run/testing.ts'
import { piBlink, piButton, piServo, piSwitched } from '../run/sheets.testing.ts'
import { EditorStore } from './store.ts'
import { deleteSelection, setPartCode, setSimValue } from './ops.ts'
import { followStore } from './simulation.ts'
import { RunController } from './runEngine.ts'
import { runBlocker, RELOAD_FIRST, ISOLATION_OFF, capText } from './running.ts'
import { MAX_RUNNING } from '../run/limits.ts'

/** A prefetch held until release(), and a spawn that counts workers: what happens to a board still starting. */
function held() {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const counts = { spawned: 0 }
  const deps = {
    prefetch: async () => (await gate, nodePy()),
    spawn: () => (counts.spawned++, spawnNodeCodeWorker()),
  }
  return { deps, release, counts }
}

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (ok: () => boolean, ms = 15000) => {
  for (const t0 = Date.now(); !ok(); await sleep(20)) if (Date.now() - t0 > ms) throw new Error('timed out')
}

/** An editor store simulated by the Node engine, as useSimulation does in the browser. */
function editor(d: ReturnType<typeof piBlink>, deps: Partial<ConstructorParameters<typeof RunController>[1]> = {}) {
  const store = new EditorStore(d)
  const session = new SimSession(engine, (o, c, opts) => store.setSim({ phase: 'done', outcome: o, circuit: c ?? null, runSeq: opts?.runSeq }))
  let rev = 0
  const unRun = store.subscribe(() => session.setRunning(store.activeRuns.length > 0))
  const unFollow = followStore(store, (dd, held, run) => session.request(dd, ++rev, { held, library: libraryLookup, runPins: run.pins, moving: run.moving, runSeq: run.seq }))
  const c = new RunController(store, { spawn: spawnNodeCodeWorker, prefetch: async () => nodePy(), isolated: () => true, ...deps })
  const close = () => (c.dispose(), session.stop(), unRun(), unFollow())
  return { store, c, close }
}

describe('the editor run controller (spec 2.1, 2.3, 4.5)', () => {
  it('starts after the first solve, blinks the LED through run pin states, and stops cleanly', async () => {
    const { store, c, close } = editor(piBlink())
    const states: string[] = []
    store.subscribe(() => {
      const s = store.getState().run.pins.u1?.GPIO17
      if (typeof s === 'string' && states.at(-1) !== s) states.push(s)
    })
    const started = c.run('u1')
    expect(store.getState().run.boards.u1.status).toBe('starting')
    expect(store.getState().simulate).toBe(true)
    await started
    await until(() => store.getState().run.boards.u1.status === 'running')
    await until(() => states.includes('low') && states.includes('high'), 4000)
    const d0 = store.getState().diagram
    await c.stop('u1')
    expect(store.getState().run.boards.u1.status).toBe('stopped')
    expect(store.getState().run.pins.u1).toBeUndefined()
    expect([store.getState().diagram, store.canUndo, store.dirty]).toEqual([d0, false, false])
    close()
  }, 60_000)
  it('refuses an unpowered board with the spec\'s words', async () => {
    const d = piSwitched('print(1)\n')
    const { store, c, close } = editor({ ...d, parts: d.parts.map((p) => (p.uid === 'sw1' ? { ...p, values: { 'contact.s': 'open' } } : p)) })
    await c.run('u1')
    expect(store.getState().run.boards.u1).toMatchObject({ status: 'idle', message: 'U1 has no power: connect 5V and GND' })
    close()
  }, 60_000)
  it('stops when the board is deleted, but not when its code is edited (Code changed)', async () => {
    const { store, c, close } = editor(piBlink())
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    const d = store.getState().diagram
    store.commit(setPartCode(d, 'u1', { language: 'python-rpi', source: 'print(2)\n', file: 'blink.py' }), 'code:u1')
    await sleep(200)
    expect(store.getState().run.boards.u1.status).toBe('running')
    expect(store.getState().run.boards.u1.source).not.toBe(store.getState().diagram.parts.find((p) => p.uid === 'u1')!.code!.source)
    store.commit(deleteSelection(store.getState().diagram, { parts: ['u1'], wires: [] }))
    await until(() => store.getState().run.boards.u1?.status !== 'running')
    close()
  }, 60_000)
  it('stops a running board when Open or New replaces the sheet, leaving the new sheet unrun', async () => {
    const { store, c, close } = editor(piBlink())
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.load(piBlink())
    await sleep(1500)
    expect(store.getState().run.boards.u1).toBeUndefined()
    expect(store.getState().run.pins).toEqual({})
    expect(store.activeRuns).toEqual([])
    close()
  }, 60_000)
  it('never starts a board that was still starting when the editor closed', async () => {
    const h = held()
    const { store, c, close } = editor(piBlink(), h.deps)
    const started = c.run('u1')
    expect(store.getState().run.boards.u1.status).toBe('starting')
    c.dispose()
    expect(store.getState().run.boards.u1.status).toBe('stopped')
    h.release()
    await started
    await sleep(300)
    expect([h.counts.spawned, store.getState().run.boards.u1.status]).toEqual([0, 'stopped'])
    close()
  }, 60_000)
  it('ends a starting board stopped when it is deleted, or its module changes, before it starts (spec 2.1)', async () => {
    for (const edit of [
      (d: ReturnType<typeof piBlink>) => deleteSelection(d, { parts: ['u1'], wires: [] }),
      (d: ReturnType<typeof piBlink>) => ({ ...d, modules: { ...d.modules, 'rpi-5': libraryLookup('rpi-5')! }, parts: d.parts.map((p) => (p.uid === 'u1' ? { ...p, module: 'rpi-5' } : p)) }),
    ]) {
      const h = held()
      const { store, c, close } = editor(piBlink(), h.deps)
      const started = c.run('u1')
      store.commit(edit(store.getState().diagram))
      h.release()
      await started
      expect([h.counts.spawned, store.getState().run.boards.u1.status, store.getState().run.boards.u1.message]).toEqual([0, 'stopped', null])
      close()
    }
  }, 60_000)
  it('stops every board when Simulate is turned off', async () => {
    const { store, c, close } = editor(piBlink())
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.setSimulate(false)
    await until(() => store.getState().run.boards.u1.status === 'stopped')
    close()
  }, 60_000)
  it('passes a typed line to input() and echoes it', async () => {
    const { store, c, close } = editor(piButton("print('Hi', input('Name? '))\n"))
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.prompt === 'Name? ')
    c.sendLine('u1', 'Ada')
    await until(() => store.getState().run.boards.u1.status === 'done')
    expect(store.getState().run.boards.u1.serial.map((l) => [l.stream, l.text])).toEqual([['echo', 'Name? Ada'], ['out', 'Hi Ada']])
    close()
  }, 60_000)
  it('stops a board that loses power, saying so', async () => {
    const { store, c, close } = editor(piSwitched('from gpiozero import LED\nfrom signal import pause\nLED(17).blink()\npause()\n'))
    await c.run('u1')
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.commit(setSimValue(store.getState().diagram, 'sw1', 'contact.s', 'open'))
    await until(() => store.getState().run.boards.u1.status === 'stopped')
    expect(store.getState().run.boards.u1.serial).toContainEqual({ stream: 'note', text: 'U1 lost power' })
    close()
  }, 60_000)
  it('says once that the code never pauses while blink() waits', async () => {
    const { store, c, close } = editor(piButton('from gpiozero import LED\nLED(17).blink()\nwhile True:\n    pass\n'))
    await c.run('u1')
    // Python's load does not count: the 2 s note is timed from the code starting.
    await until(() => store.getState().run.boards.u1.status === 'running')
    await until(() => store.getState().run.boards.u1.serial.some((l) => l.text.includes('never pauses')), 6000)
    expect(store.getState().run.boards.u1.serial.filter((l) => l.text.includes('never pauses'))).toEqual([
      { stream: 'note', text: "U1's code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop." },
    ])
    await c.stop('u1')
    close()
  }, 60_000)
  it("drops a board's run findings on Run and Reset, and the servo warnings when nothing runs (spec 6.3)", async () => {
    const { store, c, close } = editor(piBlink())
    const f = (code: 'floating-read' | 'servo-signal', part: string) => ({ code, severity: 'warning' as const, parts: [part], pins: [], message: code, key: `${code}|${part}` })
    store.setRun({ findings: [f('floating-read', 'u1'), f('floating-read', 'u9'), f('servo-signal', 'm1')] })
    await c.run('u1')
    expect(store.getState().run.findings.map((x) => x.key)).toEqual(['floating-read|u9'])
    await until(() => store.getState().run.boards.u1.status === 'running')
    store.setRun({ findings: [...store.getState().run.findings, f('floating-read', 'u1'), f('servo-signal', 'm1')] })
    await c.reset('u1')
    expect(store.getState().run.findings.map((x) => x.key)).toEqual(['floating-read|u9'])
    await c.stop('u1')
    close()
  }, 60_000)
  it('clears servo motion when the last board stops (spec 2.3)', async () => {
    // Swinging end to end every 0.2 s: 180 degrees takes 0.3 s, so the horn is always moving.
    const { store, c, close } = editor(piServo('from gpiozero import Servo\nfrom time import sleep\ns = Servo(18)\nwhile True:\n    s.min()\n    sleep(0.2)\n    s.max()\n    sleep(0.2)\n'))
    await c.run('u1')
    await until(() => store.getState().run.moving.includes('m1'))
    await c.stop('u1')
    await sleep(100)
    expect([store.getState().run.moving, store.getState().run.servos]).toEqual([[], {}])
    close()
  }, 60_000)
})

describe('what Run needs (spec 2.1, 2.5)', () => {
  it('needs isolation, code, a language the board runs, and room under the cap', () => {
    const s = new EditorStore(piBlink()).getState()
    expect(runBlocker(s, 'u1', { isolated: false, serviceWorkers: false })).toBe(ISOLATION_OFF)
    expect(runBlocker(s, 'u1', { isolated: false, serviceWorkers: true })).toBe(RELOAD_FIRST)
    expect(runBlocker(s, 'u1', { isolated: true, serviceWorkers: true })).toBeNull()
    expect(runBlocker(s, 'd1', { isolated: true, serviceWorkers: true })).toBe('Add code to a board first.')
    const busy = { ...s, run: { ...s.run, boards: Object.fromEntries(Array.from({ length: MAX_RUNNING }, (_, i) => [`x${i}`, { status: 'running' as const, source: '', file: '', serial: [], prompt: null, progress: null, message: null }])) } }
    expect(runBlocker(busy, 'u1', { isolated: true, serviceWorkers: true })).toBe(capText(MAX_RUNNING))
    expect(capText(2)).toBe('Stop a board first: at most 2 run at once')
  })
})
