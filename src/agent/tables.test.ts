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
  it('counts the parts on a sheet, marking the ones layout added', () => {
    const at = { x: 0, y: 0 }
    const sheet = {
      modules: {},
      parts: [
        { uid: 'a', designator: 'U1', module: 'esp32-devkitc-v4', ...at },
        { uid: 'b', designator: 'sw_1.S', module: 'tilt-switch-sw520d', ...at },
        { uid: 'c', designator: 'sw_2.S', module: 'tilt-switch-sw520d', ...at },
        { uid: 'd', designator: 'DP1', module: 'power-rail-strip', ...at },
        { uid: 'e', designator: 'DP2', module: 'power-rail-strip', ...at },
      ],
    }
    const refs = r.intent.parts.map((p) => p.ref)
    sheet.parts[1].designator = refs[1]
    sheet.parts[2].designator = refs[2]
    const q = quantities(r.intent, sheet)
    expect(q.map((x) => [x.module, x.count, x.added])).toEqual([
      ['esp32-devkitc-v4', 1, 0],
      ['power-rail-strip', 2, 2],
      ['tilt-switch-sw520d', 2, 0],
    ])
    expect(quantitiesText(q)).toContain('(all added by layout)')
  })
  it('lists each copy port and the endpoint it is bound to', () => {
    expect(channelTable(r.intent)).toEqual([
      { copy: 'sw_1', port: 'SIG', endpoint: 'U1.IO4' },
      { copy: 'sw_2', port: 'SIG', endpoint: 'U1.IO5' },
    ])
    expect(channelsText(channelTable(r.intent)).split('\n')[0]).toMatch(/^copy\s+port\s+bound to$/)
  })
})
