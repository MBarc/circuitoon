// Spec 4.0, 4.6 and 6.3: clicking a switch while simulating flips and saves it; a button is
// momentary (found, never saved); clicking a GPIO pin cycles input, high, low, skipping what its
// caps and the module's sim.gpio forbid. A built-in part reads the library's sim (withLibrarySim).
import { describe, expect, it } from 'vitest'
import { cycleGpio, flipContact, gpioChoices, momentaryGroup, setSimValue, simModule } from './ops.ts'
import { boardModule, sheet } from '../sim/testing.ts'
import { load } from '../format/builtinModules.testing.ts'
import type { Diagram } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'

const cycle = (d: Diagram, uid: string, pin: string, n: number) => {
  const seen: unknown[] = []
  for (let i = 0; i < n; i++) {
    d = cycleGpio(d, uid, pin)!
    seen.push(d.parts[0].values?.[`gpio.${pin}`])
  }
  return seen
}

/** A built-in module as an old sheet stored it: no embedded sim. */
const withoutSim = (id: string): ModuleDef => {
  const m = load(id)
  const { sim: _sim, ...electrical } = m.electrical as Record<string, unknown>
  return { ...m, electrical }
}

describe('simulation state ops', () => {
  it('flips a latching switch between open and closed, saving contact.<group>', () => {
    const d = sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], [])
    const on = flipContact(d, 's1')!
    expect(on.parts[0].values).toEqual({ 'contact.s': 'closed' })
    expect(flipContact(on, 's1')!.parts[0].values).toEqual({ 'contact.s': 'open' })
    expect(flipContact(sheet([{ uid: 'b1', module: 'push-button' }], []), 'b1')).toBeNull()
    expect(flipContact(sheet([{ uid: 'k1', module: 'relay-module-1ch-5v' }], []), 'k1')).toBeNull()
  })
  it('finds a momentary group to hold', () => {
    expect(momentaryGroup(sheet([{ uid: 'b1', module: 'push-button' }], []), 'b1')).toBe('s')
    expect(momentaryGroup(sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], []), 's1')).toBeNull()
  })
  it('cycles a GPIO input, high, low and back, and leaves a non-GPIO pin alone', () => {
    const d = sheet([{ uid: 'u1', module: boardModule() }], [])
    expect(cycle(d, 'u1', 'IO1', 3)).toEqual(['high', 'low', 'input'])
    expect(cycleGpio(d, 'u1', 'VIN')).toBeNull()
  })
  it('starts an output-only pin (MCP23017 GPA7) at high and never offers an input', () => {
    const d = sheet([{ uid: 'u1', module: 'mcp23017-cjmcu-2317' }], [])
    expect(cycle(d, 'u1', 'GPA7', 3)).toEqual(['high', 'low', 'high'])
    expect(gpioChoices(simModule(d, d.parts[0].module)!, 'GPA7')).toEqual(['high', 'low'])
  })
  it('leaves an input-only pin as it is, and offers no pull it has not got', () => {
    const d = sheet([{ uid: 'u1', module: 'esp32-devkit-v1-30' }], [])
    expect(cycleGpio(d, 'u1', 'D34')).toBeNull()
    const esp = simModule(d, d.parts[0].module)!
    expect(gpioChoices(esp, 'D34')).toEqual(['input'])
    expect(gpioChoices(esp, 'D13')).toEqual(['input', 'input-pullup', 'input-pulldown', 'high', 'low'])
    const uno = sheet([{ uid: 'u1', module: 'arduino-uno-r3' }], [])
    expect(gpioChoices(simModule(uno, uno.parts[0].module)!, 'D2')).toEqual(['input', 'input-pullup', 'high', 'low'])
  })
  it("reads a built-in part's sim from the library when the sheet's copy has none", () => {
    const d = sheet([{ uid: 'u1', module: withoutSim('esp32-devkit-v1-30') }], [])
    expect(cycle(d, 'u1', 'D13', 3)).toEqual(['high', 'low', 'input'])
    expect(gpioChoices(simModule(d, d.parts[0].module)!, 'D13')).toContain('input-pulldown')
    // A custom part keeps its own (here: none), so its pins are not GPIO.
    const custom = sheet([{ uid: 'u1', module: { ...withoutSim('esp32-devkit-v1-30'), id: 'my-esp', custom: true } as ModuleDef }], [])
    expect(cycleGpio(custom, 'u1', 'D13')).toBeNull()
  })
  it('sets and clears one value', () => {
    const d = sheet([{ uid: 's1', module: 'rocker-switch-kcd1' }], [])
    expect(setSimValue(setSimValue(d, 's1', 'contact.s', 'closed'), 's1', 'contact.s', undefined).parts[0].values).toBeUndefined()
    expect(setSimValue(d, 's1', 'contact.s', undefined)).toBe(d)
  })
})
