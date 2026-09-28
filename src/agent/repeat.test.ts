// Repeat expansion: refs, bindings, shared ports and every binding rule of spec 1.1.
import { describe, expect, it } from 'vitest'
import { endpointText, expandRepeat } from './repeat.ts'

const ball = (bindings: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'ball',
  count: bindings.length,
  template: {
    parts: [{ ref: 'SA', module: 'tilt-switch-sw520d' }, { ref: 'SB', module: 'tilt-switch-sw520d' }],
    nets: [{ name: 'CH', pins: ['SA.1', 'SB.1'] }, { name: 'GND', pins: ['SA.2', 'SB.2'] }],
    ports: ['CH', 'GND'],
  },
  bindings,
  shared: { GND: 'GND' },
  ...extra,
})

describe('expandRepeat', () => {
  it('expands every copy as <ref>_<copy>, binds its channel and joins the shared GND to the outside net', () => {
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }, { CH: { ref: 'U2', pin: 'GPA1' } }]), new Set(['U2']), ['GND'])
    expect(r.errors).toEqual([])
    expect(r.parts.map((p) => (p.p as { ref: string }).ref)).toEqual(['SA_1', 'SB_1', 'SA_2', 'SB_2'])
    expect(r.nets.map((n) => [n.name, n.pins.map((p) => p.ep)])).toEqual([
      ['ball_1.CH', ['SA_1.1', 'SB_1.1', 'U2.GPA0']],
      ['ball_2.CH', ['SA_2.1', 'SB_2.1', { ref: 'U2', pin: 'GPA1' }]],
    ])
    expect(r.shared.get('GND')!.map((p) => p.ep)).toEqual(['SA_1.2', 'SB_1.2', 'SA_2.2', 'SB_2.2'])
    expect(r.copies).toEqual([
      { id: 'ball_1', repeat: 'ball', index: 1, refs: ['SA_1', 'SB_1'], bindings: { CH: 'U2.GPA0' } },
      { id: 'ball_2', repeat: 'ball', index: 2, refs: ['SA_2', 'SB_2'], bindings: { CH: 'U2.GPA1' } },
    ])
  })
  it('rejects a channel bound by two copies', () => {
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }, { CH: 'U2.GPA0' }]), new Set(['U2']), ['GND'])
    expect(r.errors).toEqual(['repeat.bindings[1].CH: U2.GPA0 is already bound by copy 1 port CH'])
  })
  it('rejects a copy that leaves a port unbound, or binds a shared or unknown port', () => {
    const r = expandRepeat(ball([{}, { CH: 'U2.GPA1', GND: 'U1.GND', X: 'U1.IO4' }]), new Set(['U1', 'U2']), ['GND'])
    expect(r.errors).toEqual([
      'repeat.bindings[0]: port CH is not bound',
      'repeat.bindings[1].GND: not a port that takes a binding (CH)',
      'repeat.bindings[1].X: not a port that takes a binding (CH)',
    ])
  })
  it('rejects an expanded ref that collides with another part, and honours a refs pattern', () => {
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }]), new Set(['U2', 'SA_1']), ['GND']).errors).toEqual([
      'repeat.template.parts[0].ref: copy 1 ref "SA_1" collides with another part',
    ])
    const r = expandRepeat(ball([{ CH: 'U2.GPA0' }], { refs: 'B{copy}{ref}' }), new Set(['U2']), ['GND'])
    expect(r.copies[0].refs).toEqual(['B1SA', 'B1SB'])
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }], { refs: 'B{ref}' }), new Set(), ['GND']).errors).toEqual([
      'repeat.refs: must contain {ref} and {copy}, for example "{ref}_{copy}"',
    ])
  })
  it('rejects a binding list of the wrong length, a shared port to an unknown net and a mounted template part', () => {
    expect(expandRepeat({ ...ball([{ CH: 'U2.GPA0' }]), count: 2 }, new Set(), ['GND']).errors).toEqual([
      'repeat.bindings: must list 2 entries, one per copy',
    ])
    expect(expandRepeat(ball([{ CH: 'U2.GPA0' }]), new Set(), []).errors).toEqual(['repeat.shared.GND: no outside net "GND"'])
    const mounted = ball([{ CH: 'U2.GPA0' }])
    mounted.template.parts[0] = { ...mounted.template.parts[0], on: 'BB1' } as { ref: string; module: string }
    expect(expandRepeat(mounted, new Set(), ['GND']).errors).toEqual(['repeat.template.parts[0].on: a repeated part cannot be mounted'])
  })
  it('names endpoints the way the channel table shows them', () => {
    expect(endpointText('U2.GPA0')).toBe('U2.GPA0')
    expect(endpointText({ ref: 'U2', pin: 'GPA0' })).toBe('U2.GPA0')
    expect(endpointText({ ref: 'BB1', group: 'c5-top', hole: 2 })).toBe('BB1.c5-top hole 2')
    expect(endpointText(5)).toBe(null)
  })
})
