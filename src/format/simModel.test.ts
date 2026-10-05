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
    ['an efficiency above 1', (s: Record<string, unknown>) => ((s.power as { rails: { kind: string; efficiency?: unknown }[] }).rails[1].efficiency = { value: 1.2, unit: '1', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].efficiency.value: must be above 0 and at most 1'],
    // Carried from earlier reviews.
    ['an efficiency of 0', (s: Record<string, unknown>) => (rail(s, 1).efficiency = { value: 0, unit: '1', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].efficiency.value: must be above 0 and at most 1'],
    ['a rout below 1 milliohm', (s: Record<string, unknown>) => (rail(s, 1).rout = { value: 0.0005, unit: 'ohm', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].rout.value: must be at least 0.001 (1 milliohm)'],
    ['a rout of 0', (s: Record<string, unknown>) => (rail(s, 1).rout = { value: 0, unit: 'ohm', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.rails[1].rout.value: must be above 0'],
    ['a minVolts of 0', (s: Record<string, unknown>) => ((s.power as { draw: Record<string, unknown>[] }).draw[0].minVolts = { value: 0, unit: 'V', provenance: 'estimate', note: 'x' }), 'electrical.sim.power.draw[0].minVolts.value: must be above 0'],
    ['an LDO dropout at or above its vout', (s: Record<string, unknown>) => ((rail(s, 1).dropout as { value: number }).value = 3.3), 'electrical.sim.power.rails[1].dropout: must be below vout (3.3 V)'],
    ['a USB node with no usbPorts entry', (s: Record<string, unknown>) => delete s.usbPorts, 'electrical.sim.usbPorts.USB: required, electrical.sim.power uses "USB#vbus" (name the ground pin, so the return flows through the cable)'],
  ])('rejects %s', (_what, edit, message) => {
    expect(errorsOf(withSim(boardModule(), edit))).toContain(message)
  })
  it('lets a part with no ground pin of its own (a host port) use its USB nodes without usbPorts', () => {
    expect(simModelUsbPorts(hostModule())).toBeUndefined()
    expect(errorsOf(hostModule())).toEqual([])
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

function simModelUsbPorts(m: ModuleDef): unknown {
  return (m.electrical as { sim: { usbPorts?: unknown } }).sim.usbPorts
}
