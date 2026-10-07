// Firmware spec 3.3 (shape only; Task 8 sources the Pi numbers): logic thresholds on sim.gpio,
// fixed pull-ups built as always-present `internal` resistors (so the pin is defined, and the
// resistor lists and limits never treat them as user resistors), and a host's USB port with no power
// domain powers nothing, so a Pi's USB-A ports stay "not simulated" once the Pi has power data.
import { describe, expect, it } from 'vitest'
import { validateModule, type ModuleDef } from '../format/module.ts'
import { buildCircuit } from './build.ts'
import { classify } from './floating.ts'
import { topologyFindings } from './findings.ts'
import { boardModule, cellModule, q, sheet } from './testing.ts'

/** The test board with thresholds and a fixed pull-up on IO1, plus a USB-A host port with no power domain. */
function piLike(o: { pullups?: unknown; low?: number; high?: number } = {}): ModuleDef {
  const b = boardModule({}, 'test-pi')
  const e = b.electrical as { sim: { gpio: Record<string, unknown> } }
  e.sim.gpio.inputLow = q(o.low ?? 0.8, 'V', 'estimate')
  e.sim.gpio.inputHigh = q(o.high ?? 2.0, 'V', 'estimate')
  e.sim.gpio.fixedPullups = o.pullups ?? [{ pin: 'IO1', ohms: q(1800, 'ohm') }]
  return { ...b, pins: [...b.pins, { name: 'USB-A', side: 'right', type: 'usb', usb: { connector: 'A', gender: 'receptacle', role: 'host', version: '2.0', source: 500 } }] }
}

describe('Pi-shaped GPIO data (spec 3.3)', () => {
  it('validates thresholds and fixed pull-ups, and refuses bad ones', () => {
    expect(validateModule(piLike()).ok).toBe(true)
    const errs = (m: ModuleDef) => { const r = validateModule(m); return r.ok ? [] : r.errors }
    expect(errs(piLike({ low: 2.5, high: 2.0 }))).toContain('electrical.sim.gpio.inputLow: must be below inputHigh')
    expect(errs(piLike({ pullups: [{ pin: 'VIN', ohms: q(1800, 'ohm') }] }))).toContain('electrical.sim.gpio.fixedPullups[0].pin: "VIN" is not one of the GPIO pins')
    expect(errs(piLike({ pullups: [{ pin: 'IO1' }] }))[0]).toMatch(/^electrical\.sim\.gpio\.fixedPullups\[0\]\.ohms/)
  })
  it('builds a fixed pull-up as an internal resistor that defines an unwired input', () => {
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: piLike() }, { uid: 'x1', module: 'resistor', values: { resistance: { value: 1000, unit: 'ohm' } } }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'x1.1'], ['u1.IO2', 'x1.2']])
    const c = buildCircuit(d)
    const pull = c.devices.find((x) => x.id === 'u1.pullup.IO1')
    expect(pull).toMatchObject({ kind: 'resistor', role: 'internal', ohms: { value: 1800 } })
    expect(c.devices.filter((x) => x.kind === 'resistor' && x.role === 'resistor').map((x) => x.id)).toEqual(['x1.r'])
    const cls = classify(c)
    expect(cls.driven.has('u1:IO1')).toBe(true)
    const floating = topologyFindings(c, cls).drafts.filter((f) => f.code === 'sim-floating-input').map((f) => f.pins)
    expect(floating).not.toContainEqual([{ part: 'u1', pin: 'IO1' }])
  })
  it('compiles no cable from a host port with no power domain, and says the device is not simulated that way', () => {
    const dev = boardModule({}, 'test-dev')
    const d = sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: piLike() }, { uid: 'u2', module: dev }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.USB-A', 'u2.USB']])
    const c = buildCircuit(d)
    expect(c.devices.some((x) => x.kind === 'resistor' && x.role === 'cable')).toBe(false)
    expect(c.usb).toEqual([])
    expect(c.unsimulated).toContainEqual({ part: 'u2', reason: 'powered from U1 USB-A, whose USB power is not simulated' })
  })
})
