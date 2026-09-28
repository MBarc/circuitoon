// The bill of quantities and the channel allocation table the CLI prints for a netlist.
import { describe, expect, it } from 'vitest'
import { parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { channelTable, channelsText, quantities, quantitiesText } from './tables.ts'

const raw = {
  format: 'circuitoon-netlist/1', title: 'Two switches',
  parts: [{ ref: 'U1', module: 'esp32-devkitc-v4' }],
  nets: [{ name: 'GND', pins: ['U1.GND', 'U1.GND 2'] }],
  repeat: {
    name: 'sw', count: 2,
    template: { parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }], nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }], ports: ['SIG', 'GND'] },
    bindings: [{ SIG: 'U1.IO4' }, { SIG: 'U1.IO5' }], shared: { GND: 'GND' },
  },
}

describe('tables', () => {
  const r = parseNetlist(raw, libraryLookup)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  it('counts parts per module', () => {
    expect(quantities(r.intent).map((q) => [q.module, q.count, q.custom])).toEqual([
      ['esp32-devkitc-v4', 1, false],
      ['tilt-switch-sw520d', 2, false],
    ])
    expect(quantitiesText(quantities(r.intent))).toContain('2 x ')
  })
  it('lists each copy port and the endpoint it is bound to', () => {
    expect(channelTable(r.intent)).toEqual([
      { copy: 'sw_1', port: 'SIG', endpoint: 'U1.IO4' },
      { copy: 'sw_2', port: 'SIG', endpoint: 'U1.IO5' },
    ])
    expect(channelsText(channelTable(r.intent)).split('\n')[0]).toMatch(/^copy\s+port\s+bound to$/)
  })
})
