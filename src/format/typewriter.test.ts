// Regression test for the Spirit Typewriter parts (scripts/gen-typewriter.mjs): tilt switches,
// the ESP32 screw terminal adapter, tactile switches, the panel pot, USB panel-mount cables, JST-XH
// headers and Dupont housings. Every pin must sit in the physical order transcribed from the
// sources in each module's `source`. A wrong pin is worse than a missing part, so a change here
// must be re-checked against the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSpacer, layoutModule, validateModule, type ModuleDef, type PinDef, type Side } from './module.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (file: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (!r.ok) throw new Error(`${file}: ${r.errors.join('; ')}`)
  return r.module
}
const pinsOf = (m: ModuleDef): PinDef[] => m.pins.filter((p): p is PinDef => !isSpacer(p))
const pin = (m: ModuleDef, name: string) => pinsOf(m).find((p) => p.name === name)

// Each side lists its slots in array order; null is a spacer (a physical gap).
type Want = { category: string; sides: Partial<Record<Side, (string | null)[]>>; internal: string[][] }
const parts: Record<string, Want> = {
  // Both leads out of one end, 2.4 mm apart.
  'tilt-switch-sw520d.json': { category: 'Sensors', sides: { bottom: ['1', '2'] }, internal: [] },
  // Axial: silver end 1 at the left, gold end 2 at the right.
  'tilt-switch-sw460d.json': { category: 'Sensors', sides: { left: ['1'], right: ['2'] }, internal: [] },
  // Component side, silkscreen upright: the DevKitC headers read right to left.
  'esp32-terminal-board-38.json': {
    category: 'Microcontrollers',
    sides: {
      top: ['5V', 'CMD', 'SD3', 'SD2', 'P13', 'GND', 'P12', 'P14', 'P27', 'P26', 'P25', 'P33', 'P32', 'P35', 'P34', 'SVN', 'SVP', 'EN', '3V3'],
      bottom: ['CLK', 'SD0', 'SD1', 'P15', 'P2', 'P0', 'P4', 'P16', 'P17', 'P5', 'P18', 'P19', 'GND 2', 'P21', 'RX', 'TX', 'P22', 'P23', 'GND 3'],
    },
    internal: [['GND', 'GND 2', 'GND 3']],
  },
  // Omron B3F top view: 4 top left, 3 top right, 2 bottom left, 1 bottom right; 4-3 and 2-1 joined.
  'tactile-switch-12mm-4pin.json': { category: 'Switches', sides: { left: ['4', null, '2'], right: ['3', null, '1'] }, internal: [['4', '3'], ['2', '1']] },
  'tactile-switch-6mm-4pin.json': { category: 'Switches', sides: { left: ['4', null, '2'], right: ['3', null, '1'] }, internal: [['4', '3'], ['2', '1']] },
  // WH148 front view: lugs 1, 2 (wiper), 3 left to right, 5 mm pitch.
  'potentiometer-panel-10k.json': { category: 'Passives', sides: { bottom: ['1', null, '2', null, '3'] }, internal: [] },
  // Plug conductors in USB cable order; micro-B's ID (pin 4) is a gap.
  'usb-panel-mount-microusb.json': { category: 'Connectors', sides: { right: ['VBUS', 'D-', 'D+', null, 'GND'] }, internal: [] },
  'usb-panel-mount-usbc.json': { category: 'Connectors', sides: { right: ['VBUS', 'D-', 'D+', 'GND', null, 'CC'] }, internal: [] },
  'jst-xh-2.json': { category: 'Connectors', sides: { bottom: ['1', '2'] }, internal: [] },
  'jst-xh-3.json': { category: 'Connectors', sides: { bottom: ['1', '2', '3'] }, internal: [] },
  'jst-xh-4.json': { category: 'Connectors', sides: { bottom: ['1', '2', '3', '4'] }, internal: [] },
  'dupont-1x2.json': { category: 'Connectors', sides: { bottom: ['1', '2'] }, internal: [] },
  'dupont-1x3.json': { category: 'Connectors', sides: { bottom: ['1', '2', '3'] }, internal: [] },
  'dupont-1x4.json': { category: 'Connectors', sides: { bottom: ['1', '2', '3', '4'] }, internal: [] },
}

describe('Spirit Typewriter parts keep the physical pin order', () => {
  for (const [file, want] of Object.entries(parts)) {
    const m = load(file)
    it(`${file}: every side matches the source, slot for slot, on pitch`, () => {
      expect(m.category).toBe(want.category)
      expect(m.source).toMatch(/^https:\/\/\S+ https:\/\//)
      expect([...new Set(m.pins.map((p) => p.side))].sort()).toEqual(Object.keys(want.sides).sort())
      for (const [side, slots] of Object.entries(want.sides)) {
        const got = m.pins.filter((p) => p.side === side).map((p) => (isSpacer(p) ? null : p.name))
        expect(got).toEqual(slots)
      }
      for (const p of layoutModule(m).pins) expect((p.side === 'top' || p.side === 'bottom' ? p.edge.x : p.edge.y) % 10).toBe(0)
    })
    it(`${file}: nets joined inside the part are internal, nothing else`, () => {
      const norm = (g: string[][]) => g.map((x) => [...x].sort()).sort()
      expect(norm(m.internal ?? [])).toEqual(norm(want.internal))
    })
  }

  it('the terminal adapter types its rails like the DevKitC it carries', () => {
    const m = load('esp32-terminal-board-38.json')
    expect(m.art?.pinLabels).toBe('inside')
    expect(pin(m, '3V3')).toMatchObject({ type: 'power_out', supply: '3V3' })
    expect(pin(m, '5V')).toMatchObject({ type: 'power_in', supply: '5V' })
    for (const n of ['GND', 'GND 2', 'GND 3']) expect(pin(m, n)).toMatchObject({ type: 'ground' })
    expect(pin(m, 'GND 2')?.label).toBe('GND')
    for (const n of ['EN', 'SVP', 'SVN', 'P34', 'P35']) expect(pin(m, n)?.type).toBe('input')
  })

  it('switches switch between the right pins', () => {
    for (const f of ['tilt-switch-sw520d.json', 'tilt-switch-sw460d.json'])
      expect(load(f).electrical).toMatchObject({ model: 'switch', terminals: { a: '1', b: '2' } })
    // 1 and 3 sit on the two different internal nets, so the switch really bridges them.
    for (const f of ['tactile-switch-12mm-4pin.json', 'tactile-switch-6mm-4pin.json'])
      expect(load(f).electrical).toMatchObject({ model: 'switch', terminals: { a: '1', b: '3' } })
  })

  it('the panel pot is 10 k with 2 as the wiper, labeled W', () => {
    const m = load('potentiometer-panel-10k.json')
    expect(pin(m, '2')?.label).toBe('W')
    expect(m.electrical).toMatchObject({ model: 'potentiometer', terminals: { a: '1', wiper: '2', b: '3' }, params: { resistance: { unit: 'ohm', default: 10000 } } })
  })

  it('connector positions are labeled so pin 1 always shows, even on 2-way parts', () => {
    for (const f of ['jst-xh-2.json', 'dupont-1x2.json']) for (const p of pinsOf(load(f))) expect(p.label).toBe(p.name)
    expect(pin(load('usb-panel-mount-usbc.json'), 'GND')?.type).toBe('ground')
  })
})
