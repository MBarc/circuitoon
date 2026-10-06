// Ruling D1: a stored copy of a built-in part is classified by what changed. Pins, holes, internal
// joins and geometry block; data the library only adds or describes is an update.
import { describe, expect, it } from 'vitest'
import type { Diagram } from './diagram.ts'
import type { ModuleDef } from './module.ts'
import { load } from './builtinModules.testing.ts'
import { moduleDrift, updateLines, updateParts } from './moduleDrift.ts'

type Raw = Record<string, unknown> & { pins: Record<string, unknown>[] }
/** The library's `id`, as an older copy made by `change`. */
const older = (id: string, change: (m: Raw) => void): ModuleDef => {
  const m = structuredClone(load(id)) as unknown as Raw
  change(m)
  return m as unknown as ModuleDef
}
const kindOf = (id: string, change: (m: Raw) => void) => moduleDrift(older(id, change), load(id))?.kind
const pin = (m: Raw, name: string) => m.pins.find((p) => p.name === name)!
/** Swaps the names of pins `a` and `b`. */
const swap = (m: Raw, a: string, b: string) => {
  const [x, y] = [pin(m, a), pin(m, b)]
  ;[x.name, y.name] = [b, a]
}

describe('moduleDrift', () => {
  it('is null for a copy equal to the library', () => {
    expect(moduleDrift(load('esp32-devkitc-v4'), load('esp32-devkitc-v4'))).toBeNull()
  })
  it('is null for a copy saved before the library had its sim data, which the simulator reads from the library like kicad', () => {
    expect(kindOf('esp32-devkitc-v4', (m) => void delete (m.electrical as Record<string, unknown>).sim)).toBeUndefined()
  })
  it('is an update for data the library adds or describes', () => {
    const cases: [string, (m: Raw) => void][] = [
      ['esp32-devkitc-v4', (m) => m.pins.forEach((p) => delete p.caps)],
      ['esp32-devkitc-v4', (m) => void (pin(m, 'IO12').caps = { strapping: 'either' })],
      ['oled-ssd1306-096-i2c', (m) => void delete (m.electrical as Record<string, unknown>).i2c],
      ['oled-ssd1306-096-i2c', (m) => void delete (m.electrical as Record<string, unknown>).settings],
      ['oled-ssd1306-096-i2c', (m) => void delete m.footprint],
      ['led', (m) => void (m.name = 'LED (old)')],
      ['led', (m) => void (m.art = { ...(m.art as object), shapes: [] })],
      ['led', (m) => void (m.source = 'https://example.com/old')],
      ['led', (m) => void delete m.electrical],
    ]
    for (const [id, change] of cases) expect(kindOf(id, change), `${id} ${String(change)}`).toBe('update')
  })
  it('blocks on pin names, sides, types and order, holes, internal joins, and changed electrical data', () => {
    const cases: [string, (m: Raw) => void][] = [
      ['led', (m) => swap(m, 'A', 'K')],
      ['led', (m) => void (pin(m, 'A').type = 'power_in')],
      ['led', (m) => void (pin(m, 'A').side = 'top')],
      ['led', (m) => void m.pins.reverse()],
      ['led', (m) => void (m.holes = [])],
      ['led', (m) => void (m.internal = [['A', 'K']])],
      ['led', (m) => void (pin(m, 'A').capacity = 2)],
      ['led', (m) => void (pin(m, 'A').mains = 'L')],
      ['led', (m) => void (m.electrical = { ...(m.electrical as object), model: 'resistor' })],
    ]
    for (const [id, change] of cases) expect(kindOf(id, change), String(change)).toBe('block')
  })
  it('says the body moved when the pins sit elsewhere', () => {
    const d = moduleDrift(older('mcp23017-dip28', (m) => void (m.size = { w: 10, h: 19 })), load('mcp23017-dip28'))
    expect(d).toMatchObject({ kind: 'block', moved: true })
  })
  it('names what changed: pins with pin data, I2C data, footprint', () => {
    expect(moduleDrift(older('esp32-devkitc-v4', (m) => void delete pin(m, 'IO12').caps), load('esp32-devkitc-v4'))!.what).toEqual(['pins IO12 (pin data)'])
    expect(moduleDrift(older('oled-ssd1306-096-i2c', (m) => {
      delete (m.electrical as Record<string, unknown>).i2c
      delete m.footprint
    }), load('oled-ssd1306-096-i2c'))!.what.sort()).toEqual(['I2C data', 'footprint'])
  })
})

describe('updateParts', () => {
  const sheet = (modules: Record<string, ModuleDef>, parts: [string, string][]): Diagram => ({
    format: 'circuitoon-diagram/1', title: 't', modules,
    parts: parts.map(([uid, module], i) => ({ uid, designator: uid, module, x: i * 200, y: 0 })), connections: [],
  })
  it('takes the library copy for update-kind drift and leaves blocking drift alone, saying which is which', () => {
    const esp = older('esp32-devkitc-v4', (m) => m.pins.forEach((p) => delete p.caps))
    const led = older('led', (m) => swap(m, 'A', 'K'))
    const d = sheet({ 'esp32-devkitc-v4': esp, led, resistor: load('resistor') }, [['U1', 'esp32-devkitc-v4'], ['D1', 'led'], ['D2', 'led'], ['R1', 'resistor']])
    const u = updateParts(d, (id) => load(id))
    expect(u.diagram.modules['esp32-devkitc-v4']).toEqual(load('esp32-devkitc-v4'))
    expect(u.diagram.modules.led).toBe(led)
    expect(u.diagram.modules.resistor).toBe(d.modules.resistor)
    expect(u.updated.map((x) => [x.id, x.parts])).toEqual([['esp32-devkitc-v4', ['U1']]])
    expect(u.blocked.map((x) => [x.id, x.parts])).toEqual([['led', ['D1', 'D2']]])
    expect(updateLines(u)).toEqual([
      expect.stringMatching(/^Updated U1 \(esp32-devkitc-v4\): \d+ pins \(pin data\)\.$/),
      'Left D1, D2 (led): pins A/K changed in the library, so they must be placed again.',
    ])
  })
  it('returns the same sheet when nothing is out of date', () => {
    const d = sheet({ led: load('led') }, [['D1', 'led']])
    expect(updateParts(d, (id) => load(id)).diagram).toBe(d)
  })
})
