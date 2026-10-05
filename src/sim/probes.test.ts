// Spec 6.2: probes are saved in the sheet anchored to part uids and pins; in a netlist they are refs
// and net names; layout resolves net: to a pin, extract writes them back (a probe on a part extract
// removes becomes net:<name>), and a sheet -> netlist -> layout -> sheet round trip keeps them,
// a breadboard hole included. A dangling or malformed probe is dropped with a warning.
import { describe, expect, it } from 'vitest'
import { validateDiagram } from '../format/diagram.ts'
import { layoutNetlist } from '../agent/layout.ts'
import { extractNetlist } from '../agent/extract.ts'
import { ledNetlist } from '../agent/fixtures.testing.ts'
import { probesForNetlist } from './probes.ts'

const withProbes = () => ({
  ...ledNetlist(),
  probes: [
    { id: 'P1', name: 'BT1 plus', at: 'BT1.+' },
    { id: 'P2', at: 'D1' },
    { id: 'P3', at: 'net:LED_A' },
    { id: 'P4', at: 'BB1.top+' },
  ],
})
const laid = (n: unknown) => {
  const r = layoutNetlist(n)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value
}

describe('probes', () => {
  it('lays netlist probes onto the sheet: net: picks the lowest ref on the net', () => {
    expect(laid(withProbes()).diagram.probes).toEqual([
      { id: 'P1', name: 'BT1 plus', at: { part: 'BT1', pin: '+' } },
      { id: 'P2', at: { part: 'D1' } },
      { id: 'P3', at: { part: 'D1', pin: 'A' } },
      { id: 'P4', at: { part: 'BB1', pin: 'top+' } },
    ])
  })
  it('prefers the part the probe is named after on a net: probe', () => {
    const n = { ...ledNetlist(), probes: [{ id: 'P1', name: 'R1 output', at: 'net:LED_A' }] }
    expect(laid(n).diagram.probes).toEqual([{ id: 'P1', name: 'R1 output', at: { part: 'R1', pin: '2' } }])
  })
  it('round-trips sheet -> netlist -> layout -> sheet, a breadboard hole included', () => {
    const s1 = laid(withProbes()).diagram
    const n2 = extractNetlist(s1) as { probes: unknown[] }
    expect(n2.probes).toEqual([
      { id: 'P1', name: 'BT1 plus', at: 'BT1.+' },
      { id: 'P2', at: 'D1' },
      { id: 'P3', at: 'D1.A' },
      { id: 'P4', at: 'BB1.top+' },
    ])
    expect(laid(n2).diagram.probes).toEqual(s1.probes)
  })
  it('remaps a probe on a part extract leaves out to net:<name>, and drops a part probe there with a warning', () => {
    const warnings: string[] = []
    const out = probesForNetlist(
      [{ id: 'P1', at: { part: 'rail9', pin: '+' } }, { id: 'P2', at: { part: 'rail9' } }],
      new Map([['u1', 'U1']]),
      [{ name: 'VCC', keys: [JSON.stringify(['rail9', '+']), JSON.stringify(['u1', 'VIN'])] }],
      (w) => warnings.push(w),
    )
    expect(out).toEqual([{ id: 'P1', at: 'net:VCC' }])
    expect(warnings).toEqual(['probe P2 sat on a part the netlist leaves out (rail9), so it was dropped'])
  })
  it('drops a dangling or malformed probe on load, with a warning, never an error', () => {
    const s = laid(withProbes()).diagram
    const r = validateDiagram({ ...s, probes: [...(s.probes ?? []), { id: 'P5', at: { part: 'nope' } }, { id: 'P1', at: { part: 'D1' } }, { id: 'X', at: { part: 'D1' } }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diagram.probes).toHaveLength(4)
    expect(r.warnings.filter((w) => w.startsWith('probes['))).toEqual([
      'probes[4]: no part "nope", so the probe was dropped',
      'probes[5]: its id P1 is used twice, so the probe was dropped',
      'probes[6]: its id must be P and a number (P1, P2, ...), so the probe was dropped',
    ])
  })
  it('drops a netlist probe that names nothing, with a warning in the intent', () => {
    const r = layoutNetlist({ ...ledNetlist(), probes: [{ id: 'P1', at: 'Q9.1' }, { id: 'P2', at: 'net:NOPE' }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.diagram.probes).toBeUndefined()
    expect(r.value.intent.probeWarnings).toEqual(['probes[0]: no part "Q9", so the probe was dropped', 'probes[1]: no net "NOPE", so the probe was dropped'])
  })
})
