// Spec 3.1: electrical.sim is validated in full: unknown keys, units by kind, provenance with a
// source (or a note for an estimate), and every pin, USB node and domain it names.
import { describe, expect, it } from 'vitest'
import { validateModule, type ModuleDef } from './module.ts'
import { boardModule, hostModule, ldoModule } from '../sim/testing.ts'
import { railProblem } from './simModel.ts'

const errorsOf = (m: ModuleDef) => {
  const r = validateModule(m)
  return r.ok ? [] : r.errors
}
const withSim = (m: ModuleDef, edit: (sim: Record<string, unknown>) => void): ModuleDef => {
  const copy = structuredClone(m)
  edit((copy.electrical as { sim: Record<string, unknown> }).sim)
  return copy
}
type Rails = { rails: Record<string, unknown>[] }
const rail = (s: Record<string, unknown>, i: number) => (s.power as Rails).rails[i]

describe('validateSim', () => {
  it('accepts well-formed boards, regulators and hosts', () => {
    for (const m of [boardModule(), ldoModule(), hostModule()]) expect(errorsOf(m)).toEqual([])
  })
  it.each([
    ['an unknown key', (s: Record<string, unknown>) => (s.colour = 'red'), 'electrical.sim.colour: unknown field'],
    ['a unit that does not match its kind', (s: Record<string, unknown>) => ((s.gpio as { outputResistance: { unit: string } }).outputResistance.unit = 'V'), 'electrical.sim.gpio.outputResistance.unit: must be "ohm"'],
    ['a provenance outside the list', (s: Record<string, unknown>) => ((s.gpio as { outputResistance: { provenance: string } }).outputResistance.provenance = 'measured'), 'electrical.sim.gpio.outputResistance.provenance: must be "datasheet", "representative" or "estimate"'],
    ['a datasheet value with no source', (s: Record<string, unknown>) => delete (s.gpio as { outputResistance: { source?: string } }).outputResistance.source, 'electrical.sim.gpio.outputResistance.source: required for a datasheet or representative value (a URL)'],
    ['a domain on a missing pin', (s: Record<string, unknown>) => ((s.power as { domains: { pin: string }[] }).domains[0].pin = 'VBAT'), 'electrical.sim.power.domains[0].pin: no pin, hole group or USB node "VBAT"'],
    ['#vbus on a pin that is not a USB port', (s: Record<string, unknown>) => ((s.power as { domains: { pin: string }[] }).domains[0].pin = 'VIN#vbus'), 'electrical.sim.power.domains[0].pin: no pin, hole group or USB node "VIN#vbus"'],
    ['a limit on an unknown domain', (s: Record<string, unknown>) => ((s.limits as { of: unknown }[])[2].of = { domain: '5V' }), 'electrical.sim.limits[2].of.domain: no domain "5V" in electrical.sim.power.domains'],
    ['a GPIO pin that does not exist', (s: Record<string, unknown>) => (s.gpio as { pins: string[] }).pins.push('IO9'), 'electrical.sim.gpio.pins[2]: no pin "IO9"'],
    ['a USB ground that is not a ground pin', (s: Record<string, unknown>) => (s.usbPorts = { USB: { gnd: 'VIN' } }), 'electrical.sim.usbPorts.USB.gnd: "VIN" is not a ground pin'],
    ['a peak with no note', (s: Record<string, unknown>) => delete ((s.power as { draw: { peak: { note?: string } }[] }).draw[0].peak.note), 'electrical.sim.power.draw[0].peak.note: required (what the peak is, for example "Wi-Fi transmit")'],
    ['a peak label over 32 characters', (s: Record<string, unknown>) => ((s.power as { draw: { peak: { label?: string } }[] }).draw[0].peak.label = 'Wi-Fi transmit at full power, 802.11b'), 'electrical.sim.power.draw[0].peak.label: must be a short name of 1 to 32 characters (for example "Wi-Fi transmit")'],
    ['a blank peak label', (s: Record<string, unknown>) => ((s.power as { draw: { peak: { label?: string } }[] }).draw[0].peak.label = ' '), 'electrical.sim.power.draw[0].peak.label: must be a short name of 1 to 32 characters (for example "Wi-Fi transmit")'],
    ['an efficiency above 1', (s: Record<string, unknown>) => ((s.power as { rails: { kind: string; efficiency?: unknown }[] }).rails[1].efficiency = { value: 1.2, unit: '1', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].efficiency.value: must be above 0 and at most 1'],
    // Carried from earlier reviews.
    ['an efficiency of 0', (s: Record<string, unknown>) => (rail(s, 1).efficiency = { value: 0, unit: '1', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].efficiency.value: must be above 0 and at most 1'],
    ['a rout below 1 milliohm', (s: Record<string, unknown>) => (rail(s, 1).rout = { value: 0.0005, unit: 'ohm', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].rout.value: must be at least 0.001 (1 milliohm)'],
    ['a rout of 0', (s: Record<string, unknown>) => (rail(s, 1).rout = { value: 0, unit: 'ohm', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].rout.value: must be above 0'],
    ['a minVolts of 0', (s: Record<string, unknown>) => ((s.power as { draw: Record<string, unknown>[] }).draw[0].minVolts = { value: 0, unit: 'V', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.draw[0].minVolts.value: must be above 0'],
    ['an LDO dropout at or above its vout', (s: Record<string, unknown>) => ((rail(s, 1).dropout as { value: number }).value = 3.3), 'electrical.sim.power.rails[1].dropout: must be below vout (3.3 V)'],
    ['an unaccounted list that is not strings', (s: Record<string, unknown>) => (s.unaccounted = ['power LED', '']), 'electrical.sim.unaccounted: must be a list of non-empty strings'],
    ['an unaccounted that is not a list', (s: Record<string, unknown>) => (s.unaccounted = 'power LED'), 'electrical.sim.unaccounted: must be a list of non-empty strings'],
    ['a USB node with no usbPorts entry', (s: Record<string, unknown>) => delete s.usbPorts, 'electrical.sim.usbPorts.USB: required, electrical.sim.power uses "USB#vbus" (name the ground pin, so the return flows through the cable)'],
  ])('rejects %s', (_what, edit, message) => {
    expect(errorsOf(withSim(boardModule(), edit))).toContain(message)
  })
  it('accepts an unaccounted list of words (Phase C checkpoint, finding 4)', () => {
    expect(errorsOf(withSim(boardModule(), (s) => (s.unaccounted = ['USB-UART bridge idle current'])))).toEqual([])
  })
  it('lets a part with no ground pin of its own (a host port) use its USB nodes without usbPorts', () => {
    expect((hostModule().electrical as { sim: { usbPorts?: unknown } }).sim.usbPorts).toBeUndefined()
    expect(errorsOf(hostModule())).toEqual([])
  })
  it.each([{ toString: 1 }, 'constructor', '__proto__'])('rejects a limit kind of %s without throwing', (kind) => {
    // A bad value too, so the message reaches for the kind's unit.
    const errs = errorsOf(withSim(boardModule(), (s) => Object.assign((s.limits as Record<string, unknown>[])[0], { kind, value: 0 })))
    expect(errs).toContain('electrical.sim.limits[0].kind: must be one of current, absMaxCurrent, power, vinMax, vinMin, sourceCurrent, ioTotalCurrent')
    expect(errs).toContain('electrical.sim.limits[0].value: must be above 0 (in its unit)')
  })
  it('survives hostile values in every section', () => {
    const hostile: unknown[] = [null, [], 5, { toString: 1 }]
    const paths: ((s: Record<string, unknown>, v: unknown) => void)[] = [
      (s, v) => (s.modelParams = v), (s, v) => (s.modelParams = { rInternal: v }), (s, v) => (s.limits = v), (s, v) => (s.limits = [v]),
      (s, v) => ((s.limits as Record<string, unknown>[])[0].of = v),
      (s, v) => Object.assign((s.limits as Record<string, unknown>[])[0], { kind: v, value: v }), (s, v) => (s.power = v), (s, v) => (s.gpio = v), (s, v) => (s.usbPorts = v), (s, v) => (s.unaccounted = v), (s, v) => (s.unaccounted = [v]),
      (s, v) => (s.usbPorts = { USB: v }), (s, v) => ((s.gpio as Record<string, unknown>).pins = v), (s, v) => ((s.gpio as Record<string, unknown>).domain = v),
      ...['domains', 'draw', 'rails', 'source'].flatMap((k) => [
        (s: Record<string, unknown>, v: unknown) => ((s.power as Record<string, unknown>)[k] = v),
        (s: Record<string, unknown>, v: unknown) => ((s.power as Record<string, unknown>)[k] = [v]),
      ]),
      (s, v) => (rail(s, 1).inputs = [v]), (s, v) => (rail(s, 1).minLoad = v), (s, v) => (rail(s, 1).vout = v), (s, v) => (rail(s, 1).kind = v), (s, v) => (rail(s, 1).id = v),
      (s, v) => ((s.power as { domains: Record<string, unknown>[] }).domains[0].pin = v), (s, v) => ((s.power as { domains: Record<string, unknown>[] }).domains[0].name = v),
    ]
    for (const v of hostile) for (const edit of paths) expect(() => validateModule(withSim(boardModule(), (s) => edit(s, v)))).not.toThrow()
    for (const v of hostile) expect(() => validateModule({ ...boardModule(), electrical: { sim: v } })).not.toThrow()
  })
  it('requires a note on an estimate', () => {
    const m = withSim(boardModule(), (s) => ((s.gpio as { pullup: unknown }).pullup = { value: 45000, unit: 'ohm', provenance: 'estimate' }))
    expect(errorsOf(m)).toContain('electrical.sim.gpio.pullup.note: required on an estimate (say what was assumed)')
  })
  it('lets an embedded part with an incomplete rail load, and railProblem names the gap', () => {
    const bad = ldoModule({ dropout: undefined }, 'test-bad-ldo')
    expect(errorsOf(bad)).toEqual([])
    const rail = (bad.electrical as { sim: { power: { rails: Parameters<typeof railProblem>[0][] } } }).sim.power.rails[0]
    expect(railProblem(rail)).toBe('rail ldo needs dropout')
  })
})
