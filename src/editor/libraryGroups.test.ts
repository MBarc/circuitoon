import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, groupLibrary, searchLibrary } from './libraryGroups.ts'
import type { ModuleDef } from '../format/module.ts'

function mod(id: string, name: string, category?: string): ModuleDef {
  return { format: 'circuitoon-module/1', id, name, category, pins: [{ name: '1', side: 'left' }] }
}

describe('searchLibrary', () => {
  const groups = groupLibrary([
    mod('rpi-pico-2-w', 'Raspberry Pi Pico 2 W', 'Microcontrollers'),
    mod('esp32-devkitc-v4', 'ESP32-DevKitC V4', 'Microcontrollers'),
    mod('resistor', 'Resistor', 'Passives'),
  ])
  const ids = (q: string) => searchLibrary(groups, q).flatMap((g) => g.modules.map((m) => m.id))
  it('matches the module id as well as its name and category, ignoring case and outer spaces', () => {
    expect(ids('devkitc')).toEqual(['esp32-devkitc-v4'])
    expect(ids(' PICO-2 ')).toEqual(['rpi-pico-2-w'])
    expect(ids('resis')).toEqual(['resistor'])
    expect(ids('passives')).toEqual(['resistor'])
  })
  it('keeps every group for an empty query and drops groups with no match', () => {
    expect(searchLibrary(groups, '  ')).toBe(groups)
    expect(searchLibrary(groups, 'rpi').map((g) => g.category)).toEqual(['Microcontrollers'])
    expect(searchLibrary(groups, 'nothing-like-this')).toEqual([])
  })
})

describe('groupLibrary', () => {
  it('fixes the category order from Batteries through Connectors', () => {
    expect(CATEGORY_ORDER).toEqual([
      'Batteries', 'Power', 'Microcontrollers', 'Sensors', 'Communication', 'Displays', 'Motors and actuators',
      'Chips', 'Semiconductors', 'Passives', 'Indicators', 'Switches', 'Connectors',
    ])
  })

  it('orders known categories by CATEGORY_ORDER, then leftovers alphabetically', () => {
    const modules = [
      mod('switch-1', 'Toggle switch', 'Switches'),
      mod('sensor-1', 'Temperature sensor', 'Sensors'),
      mod('resistor', 'Resistor', 'Passives'),
      mod('regulator', '5V regulator', 'Power'),
      mod('battery-9v', '9V battery', 'Batteries'),
      mod('servo-1', 'Servo motor', 'Motors and actuators'),
      mod('terminal-1', 'Screw terminal', 'Connectors'),
      mod('misc-1', 'Widget', 'Zeta'),
      mod('misc-2', 'Gadget', 'Alpha'),
    ]
    const groups = groupLibrary(modules)
    expect(groups.map((g) => g.category)).toEqual([
      'Batteries', 'Power', 'Sensors', 'Motors and actuators', 'Passives', 'Switches', 'Connectors', 'Alpha', 'Zeta',
    ])
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
