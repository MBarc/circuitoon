// Spec 6.2 and 5.1: the Supplies table: each source, rail and domain with load against limit, typical
// and peak, headroom and provenance; a source's current is "delivering"; a reading outside the model
// is shown as such, not as a number. A domain row shows the current through its pin and, apart, the
// part's own draw. About the simulator names the licence files the engine's NOTICE.txt lists.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { licenceFiles, supplyRow } from './ProbesPanel.tsx'
import type { DomainBudget } from '../sim/results.ts'

const v = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, reference: 'GND', trust })
const a = (value: number, trust: 'ok' | 'outside-model' = 'ok') => ({ kind: 'value' as const, value, trust })

describe('supplyRow', () => {
  it('formats a rail with its limit, headroom and basis', () => {
    const b: DomainBudget = { id: 'u1.rail.ldo', kind: 'rail', part: 'u1', label: 'U1 3V3 regulator', volts: { typical: v(3.29), peak: v(3.27) }, amps: { typical: a(0.12), peak: a(0.34) }, limit: { value: 0.8, kind: 'ioutMax', basis: 'datasheet' }, headroom: 0.46, basis: 'datasheet' }
    expect(supplyRow(b)).toEqual({ name: 'U1 3V3 regulator', volts: '3.29 V (peak 3.27 V)', load: '120 mA (peak 340 mA)', limit: '800 mA', headroom: '460 mA', basis: 'datasheet' })
  })
  it('says a reading outside the model is untrustworthy instead of giving a number', () => {
    const b: DomainBudget = { id: 'bt1.cell', kind: 'source', part: 'bt1', label: 'BT1', volts: { typical: v(3.1, 'outside-model'), peak: v(3.0, 'outside-model') }, amps: { typical: a(2.1, 'outside-model'), peak: a(2.4, 'outside-model') }, basis: 'estimate' }
    expect(supplyRow(b)).toMatchObject({ load: 'outside the model', limit: '-', headroom: '-', basis: 'estimate', outside: true })
  })
  it('labels a source\'s current as delivering (spec 5.1), without saying so twice', () => {
    const b: DomainBudget = { id: 'bt1.cell', kind: 'source', part: 'bt1', label: 'BT1 delivering', volts: { typical: v(3.6), peak: v(3.5) }, amps: { typical: a(0.412), peak: a(0.6) }, limit: { value: 2, kind: 'sourceCurrent', basis: 'estimate' }, headroom: 1.4, basis: 'estimate' }
    expect(supplyRow(b)).toMatchObject({ name: 'BT1', load: 'delivering 412 mA (peak 600 mA)' })
  })
  it('gives a domain the current through its pin and, apart, its own draw, so a pass-through VIN never reads as only 0 mA', () => {
    const b: DomainBudget = { id: 'u1.domain.VIN', kind: 'domain', part: 'u1', label: 'U1 VIN', volts: { typical: v(5), peak: v(4.9) }, amps: { typical: a(0), peak: a(0) }, ownDraw: { typical: a(0.08), peak: a(0.25) }, basis: 'estimate' }
    expect(supplyRow(b)).toMatchObject({ load: 'through the pin 0 A', own: 'own draw 80 mA (peak 250 mA)' })
  })
})

describe('licenceFiles', () => {
  it('lists the licence files the engine notice names, once each, in order', () => {
    expect(licenceFiles(readFileSync('public/sim/NOTICE.txt', 'utf8'))).toEqual(['LICENSE-ngspice.txt', 'LICENSE-LGPL-2.txt', 'LICENSE-emscripten.txt'])
  })
})
