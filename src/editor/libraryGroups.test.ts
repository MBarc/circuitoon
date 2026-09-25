import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, groupLibrary } from './libraryGroups.ts'
import type { ModuleDef } from '../format/module.ts'

function mod(id: string, name: string, category?: string): ModuleDef {
  return { format: 'circuitoon-module/1', id, name, category, pins: [{ name: '1', side: 'left' }] }
}

describe('groupLibrary', () => {
  it('fixes the category order as Batteries, Power, Microcontrollers, Displays, Chips, Passives, Indicators, Switches', () => {
    expect(CATEGORY_ORDER).toEqual([
      'Batteries', 'Power', 'Microcontrollers', 'Displays', 'Chips', 'Passives', 'Indicators', 'Switches',
    ])
  })

  it('orders known categories Batteries, Power, Passives, Switches, then leftovers alphabetically', () => {
    const modules = [
      mod('switch-1', 'Toggle switch', 'Switches'),
      mod('sensor-1', 'Temperature sensor', 'Sensors'),
      mod('resistor', 'Resistor', 'Passives'),
      mod('regulator', '5V regulator', 'Power'),
      mod('battery-9v', '9V battery', 'Batteries'),
      mod('actuator-1', 'Servo motor', 'Actuators'),
    ]
    const groups = groupLibrary(modules)
    expect(groups.map((g) => g.category)).toEqual(['Batteries', 'Power', 'Passives', 'Switches', 'Actuators', 'Sensors'])
  })

  it('omits a category from CATEGORY_ORDER that has no modules', () => {
    expect(CATEGORY_ORDER).toContain('Microcontrollers')
    const groups = groupLibrary([mod('resistor', 'Resistor', 'Passives')])
    expect(groups.map((g) => g.category)).toEqual(['Passives'])
  })

  it('sorts modules within a group by name', () => {
    const groups = groupLibrary([
      mod('capacitor-tantalum', 'Tantalum capacitor', 'Passives'),
      mod('resistor', 'Resistor (1/4 W)', 'Passives'),
      mod('capacitor-film', 'Film capacitor', 'Passives'),
    ])
    expect(groups[0].modules.map((m) => m.name)).toEqual(['Film capacitor', 'Resistor (1/4 W)', 'Tantalum capacitor'])
  })

  it('groups modules with no category as "Uncategorized" at the end when nothing else is unknown', () => {
    const groups = groupLibrary([mod('mystery', 'Mystery part', undefined)])
    expect(groups).toEqual([{ category: 'Uncategorized', modules: [expect.objectContaining({ id: 'mystery' })] }])
  })

  it('returns no groups for an empty library', () => {
    expect(groupLibrary([])).toEqual([])
  })
})
