// The bill of quantities and the channel allocation table the CLI prints for a netlist.
import { describe, expect, it } from 'vitest'
import { parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { bomQuantities, channelTable, channelsText, quantitiesText, sheetBom } from './tables.ts'
import type { Diagram } from '../format/diagram.ts'

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
  it('counts the parts on a sheet per module, from its bill of materials, marking the ones layout added', () => {
    const at = { x: 0, y: 0 }
    const refs = r.intent.parts.map((p) => p.ref)
    const sheet: Diagram = {
      format: 'circuitoon-diagram/1', title: 't', modules: {}, connections: [], intent: raw,
      parts: [
        { uid: 'a', designator: 'U1', module: 'esp32-devkitc-v4', ...at },
        { uid: 'b', designator: refs[1], module: 'tilt-switch-sw520d', ...at },
        { uid: 'c', designator: refs[2], module: 'tilt-switch-sw520d', ...at },
        { uid: 'd', designator: 'DP1', module: 'power-rail-strip', ...at },
        { uid: 'e', designator: 'DP2', module: 'power-rail-strip', ...at },
      ],
    }
    const bom = sheetBom(sheet)
    const q = bomQuantities(bom)
    expect(q.map((x) => [x.module, x.count, x.added, x.custom])).toEqual([
      ['esp32-devkitc-v4', 1, 0, false],
      ['power-rail-strip', 2, 2, false],
      ['tilt-switch-sw520d', 2, 0, false],
    ])
    expect(quantitiesText(q)).toContain('(all added by layout)')
    expect(bom.parts.find((p) => p.module === 'power-rail-strip')!.added).toBe(2)
  })
  it('a sheet with no intent (drawn in the editor) counts every part, none added', () => {
    const at = { x: 0, y: 0 }
    const sheet: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: {}, connections: [], parts: [{ uid: 'd', designator: 'DP1', module: 'power-rail-strip', ...at }] }
    expect(bomQuantities(sheetBom(sheet)).map((x) => [x.count, x.added])).toEqual([[1, 0]])
  })
  it('marks a custom part the netlist embeds', () => {
    const custom = { format: 'circuitoon-module/1', id: 'my-sensor', name: 'My sensor', source: 'https://example.com/ds.pdf', pins: [{ name: 'A', side: 'left', type: 'io' }] }
    const withCustom = { ...raw, modules: { 'my-sensor': custom }, parts: [...raw.parts, { ref: 'X1', module: 'my-sensor' }] }
    const sheet: Diagram = { format: 'circuitoon-diagram/1', title: 't', modules: {}, connections: [], intent: withCustom,
      parts: [{ uid: 'x', designator: 'X1', module: 'my-sensor', x: 0, y: 0 }] }
    expect(bomQuantities(sheetBom(sheet))).toEqual([{ module: 'my-sensor', name: 'my-sensor', count: 1, added: 0, custom: true }])
  })
  it('lists each copy port and the endpoint it is bound to', () => {
    expect(channelTable(r.intent)).toEqual([
      { copy: 'sw_1', port: 'SIG', endpoint: 'U1.IO4' },
      { copy: 'sw_2', port: 'SIG', endpoint: 'U1.IO5' },
    ])
    expect(channelsText(channelTable(r.intent)).split('\n')[0]).toMatch(/^copy\s+port\s+bound to$/)
  })
})
