// Firmware spec 2.3, 3.4, 4.4: RunCore samples every running board into run pin states (changed only
// when a quantised state or a servo's moving flag changes), writes each solve's thresholded levels and
// edges into the boards' input tables "solved through" the sampled sequence, raises the run-time
// findings once, and turns a PWM signal on a servo's net into an angle that slews.
import { afterAll, describe, expect, it } from 'vitest'
import { makeHw, type RunClock } from './bridge.ts'
import { type CoreBoard, RunCore } from './core.ts'
import { H, MODE, boardMemory, readIn } from './memory.ts'
import { load } from '../format/builtinModules.testing.ts'
import { nodeKey } from '../format/netlist.ts'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import { cellModule, sheet } from '../sim/testing.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const pi = load('rpi-4-model-b')

function board() {
  const memory = boardMemory()
  const clock: RunClock & { t: number } = { t: 0, epochMs: 0, now: () => clock.t, block() {}, poll() {} }
  const hw = makeHw(memory, clock, { board: 'pi4', onPrompt() {}, flush() {} })
  const b: CoreBoard = { uid: 'u1', ref: 'U1', memory, module: pi }
  return { b, hw, clock }
}
const at = () => 0
const powered = () => sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }], [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND']])
const withButton = () =>
  sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 's1', module: 'push-button' }], [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['u1.GPIO27', 's1.1'], ['s1.2', 'u1.GND 2']])

describe('RunCore (spec 2.3, 4.4)', () => {
  it('samples run pin states, changed only when a quantised state moves', () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(17, MODE.output)
    hw.output(17, 1)
    const first = core.sample(at)
    expect(first.pins).toEqual({ u1: { GPIO17: 'high' } })
    expect(first.changed).toBe(true)
    expect(core.sample(at).changed).toBe(false)
    // The same mode again bumps the code sequence but changes no state: store.run is not written.
    hw.setup(17, MODE.output)
    expect(core.sample(at).changed).toBe(false)
    hw.setup(27, MODE.pullup)
    expect(core.sample(at)).toMatchObject({ changed: true, pins: { u1: { GPIO17: 'high', GPIO27: 'input-pullup' } } })
  })
  it('writes a solve back as levels and edges, solved through the sampled sequence', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(27, MODE.pullup)
    const d = withButton()
    const s = core.sample(at)
    const up = await solve(d, engine, 1, { runPins: s.pins })
    core.apply(up.outcome, up.circuit, s.seq, at)
    expect(readIn(b.memory, 27)).toMatchObject({ level: 1, status: 'value', rising: 0, falling: 0 })
    expect(Atomics.load(b.memory.i32, H.solvedThrough)).toBe(s.seq.u1)
    const down = await solve(d, engine, 2, { runPins: s.pins, held: { part: 's1', group: 's' } })
    const r = core.apply(down.outcome, down.circuit, s.seq, at)
    expect(readIn(b.memory, 27)).toMatchObject({ level: 0, falling: 1 })
    expect(r.power.u1.powered).toBe(true)
  }, 60_000)
  it('applies a solve with the modes it was sampled with: a pin set up while it was in flight waits for the next', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    const d = withButton()
    const s = core.sample(at)
    const flight = await solve(d, engine, 1, { runPins: s.pins })
    hw.setup(27, MODE.pullup) // Button(27) while the solve was in flight
    expect(core.apply(flight.outcome, flight.circuit, s.seq, at).findings).toEqual([])
    expect(readIn(b.memory, 27).status).toBe('none')
    expect(Atomics.load(b.memory.i32, H.solvedThrough)).toBe(s.seq.u1)
    expect(Atomics.load(b.memory.i32, H.codeSeq)).toBeGreaterThan(s.seq.u1)
    const s2 = core.sample(at)
    const next = await solve(d, engine, 2, { runPins: s2.pins })
    expect(core.apply(next.outcome, next.circuit, s2.seq, at).findings).toEqual([])
    // No fake edge, so no when_released at start.
    expect(readIn(b.memory, 27)).toMatchObject({ level: 1, status: 'value', rising: 0, falling: 0 })
  }, 60_000)
  it('marks a failed solve solved through the sampled sequence, so no read waits on it', () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(27, MODE.pullup)
    const s = core.sample(at)
    expect(s.seq.u1).toBeGreaterThan(0)
    const r = core.apply({ status: 'unavailable', reason: 'no engine', findings: [] }, null, s.seq, at)
    expect(r).toEqual({ findings: [], power: {} })
    expect(Atomics.load(b.memory.i32, H.solvedThrough)).toBe(s.seq.u1)
    expect(readIn(b.memory, 27).status).toBe('none')
  })
  it('raises floating-read once for an unpulled input that nothing drives', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(4, MODE.input)
    const d = powered()
    const s = core.sample(at)
    const r1 = await solve(d, engine, 1, { runPins: s.pins })
    expect(core.apply(r1.outcome, r1.circuit, s.seq, at).findings.map((f) => [f.code, f.message])).toEqual([
      ['floating-read', 'U1 GPIO4 is read by the code but nothing drives it: it floats, so each read is random. Turn on a pull-up or pull-down in the code, or wire it to a signal.'],
    ])
    expect(core.apply(r1.outcome, r1.circuit, s.seq, at).findings).toEqual([])
  }, 60_000)
  it('raises undefined-level once for an input that dwells between the thresholds for more than 100 ms', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(17, MODE.input)
    let t = 0
    const now = () => t
    const s = core.sample(now)
    const r = await solve(powered(), engine, 1, { runPins: s.pins })
    if (r.outcome.status !== 'ok') throw new Error('solve failed')
    const net = r.circuit.pinNet[nodeKey('u1', 'GPIO17')]
    r.outcome.result.corners.typical.nets[net] = { kind: 'value', value: 1.4, reference: 'GND', trust: 'ok' }
    core.apply(r.outcome, r.circuit, s.seq, now)
    t = 100
    expect(core.sample(now).findings).toEqual([])
    t = 101
    expect(core.sample(now).findings.map((f) => [f.code, f.key, f.message])).toEqual([['undefined-level', 'undefined-level|u1|GPIO17', 'U1 GPIO17 reads 1.4 V, between the low and high thresholds']])
    t = 500
    expect(core.sample(now).findings).toEqual([])
  }, 60_000)
  it('turns a servo PWM signal into an angle that slews, and reports a signal it does not follow', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(18, MODE.output)
    hw.pwm(18, true, 0.0005 * 50, 50)
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'm1', module: 'servo-sg90' }],
      [['bt1.+', 'u1.5V'], ['bt1.-', 'u1.GND'], ['u1.GPIO18', 'm1.PWM'], ['bt1.+', 'm1.VCC'], ['bt1.-', 'm1.GND']])
    core.sample(at)
    const { circuit } = await solve(d, engine, 1, {})
    expect(core.servos(d, circuit, 0).views.m1).toEqual({ angle: 0, target: 0, moving: false })
    hw.pwm(18, true, 0.0024 * 50, 50)
    core.sample(at)
    const mid = core.servos(d, circuit, 100)
    expect(mid.views.m1.target).toBe(180)
    expect(mid.views.m1.angle).toBeCloseTo(60, 6)
    expect(mid.moving).toEqual(['m1'])
    // The moving flag is part of the run state (spec 2.3): starting and stopping each sample as changed.
    expect(core.sample(at).changed).toBe(true)
    expect(core.sample(at).changed).toBe(false)
    expect(core.servos(d, circuit, 400).views.m1).toEqual({ angle: 180, target: 180, moving: false })
    expect(core.sample(at).changed).toBe(true)
    hw.pwm(18, true, 0.003 * 50, 50)
    core.sample(at)
    const bad = core.servos(d, circuit, 500)
    expect(bad.views.m1.angle).toBe(180)
    expect(bad.findings.map((f) => f.message)).toEqual(["M1's signal is a 3 ms pulse at 50 Hz, which a servo does not follow (0.4 to 2.6 ms pulses at 40 to 330 Hz): it holds its last angle."])
    expect(core.servos(d, circuit, 600).findings).toEqual([])
  }, 60_000)
  it('warns once about a servo whose first signal it does not follow', async () => {
    const { b, hw } = board()
    const core = new RunCore()
    core.add(b)
    hw.setup(18, MODE.output)
    hw.pwm(18, true, 0.003 * 50, 50)
    const d = sheet([{ uid: 'u1', module: 'rpi-4-model-b' }, { uid: 'm1', module: 'servo-sg90' }], [['u1.GPIO18', 'm1.PWM']])
    core.sample(at)
    const { circuit } = await solve(d, engine, 1, {})
    const first = core.servos(d, circuit, 0)
    expect(first.views).toEqual({})
    expect(first.findings.map((f) => f.code)).toEqual(['servo-signal'])
    expect(core.servos(d, circuit, 100).findings).toEqual([])
    core.forgetServoWarnings()
    expect(core.servos(d, circuit, 200).findings.map((f) => f.code)).toEqual(['servo-signal'])
  }, 60_000)
})
