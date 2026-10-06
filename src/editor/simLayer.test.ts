// Spec 6.3: LED brightness follows current on a log scale with full brightness at its current
// limit; the shown result is the live one, or the last good one (stale) while a solve fails.
import { describe, expect, it } from 'vitest'
import { currentFindings, glowLevel, shownResult } from './SimLayer.tsx'
import type { SimFinding, SimResult } from '../sim/results.ts'
import { foldNotPowered } from '../sim/display.ts'

describe('glowLevel', () => {
  it('is dark at 0.1 mA and below, full at the limit, and log-scaled between', () => {
    expect(glowLevel(1e-4, 0.02)).toBe(0)
    expect(glowLevel(0.02, 0.02)).toBe(1)
    expect(glowLevel(0.05, 0.02)).toBe(1)
    expect(glowLevel(Math.sqrt(1e-4 * 0.02), 0.02)).toBeCloseTo(0.5, 9)
  })
})

describe('shownResult', () => {
  const r = { revision: 1 } as SimResult
  it('shows the live result, the last good one marked stale after a failure, and nothing otherwise', () => {
    expect(shownResult({ status: 'ok', result: r })).toEqual({ result: r, stale: false })
    expect(shownResult({ status: 'failed', revision: 2, finding: {} as never, findings: [], lastGood: { revision: 1, result: r } })).toEqual({ result: r, stale: true })
    expect(shownResult({ status: 'failed', revision: 2, finding: {} as never, findings: [] })).toBeNull()
    expect(shownResult({ status: 'unavailable', reason: 'x', findings: [] })).toBeNull()
    expect(shownResult(undefined)).toBeNull()
  })
})

describe('currentFindings', () => {
  const f = (message: string) => ({ code: 'sim-brownout', severity: 'warning', parts: [], message, basis: 'topology', inputs: [] }) as SimFinding
  it('is the live result findings, or the failure and the findings decided before solving', () => {
    const a = f('a')
    const b = f('b')
    expect(currentFindings({ status: 'ok', result: { findings: [a] } as SimResult })).toEqual([a])
    expect(currentFindings({ status: 'failed', revision: 2, finding: a, findings: [b], lastGood: { revision: 1, result: { findings: [] } as unknown as SimResult } })).toEqual([a, b])
    expect(currentFindings({ status: 'unavailable', reason: 'x', findings: [b] })).toEqual([b])
    expect(currentFindings(undefined)).toEqual([])
  })
  it('folds a run of "not powered: SW1 is open" warnings into one entry, as the CLI does (ruling R30)', () => {
    const groups = foldNotPowered([f('DS1 VCC is not powered in the current state: SW1 is open. x'), f('DS2 VCC is not powered in the current state: SW1 is open. x'), f('U1 is low')])
    expect(groups.map((g) => g.members.length)).toEqual([2, 1])
    expect(groups[0].message).toBe('not powered in the current state because SW1 is open: DS1 VCC, DS2 VCC. Set SW1 to its operating position to simulate them running.')
  })
  it('folds the warnings for one switch wherever they sit, placing the group where its first one was', () => {
    const groups = foldNotPowered([f('U1 is low'), f('DS1 VCC is not powered in the current state: SW1 is open. x'), f('U2 is low'), f('DS3 VCC is not powered in the current state: SW2 is open. x'), f('DS2 VCC is not powered in the current state: SW1 is open. x')])
    expect(groups.map((g) => g.message)).toEqual(['U1 is low', 'not powered in the current state because SW1 is open: DS1 VCC, DS2 VCC. Set SW1 to its operating position to simulate them running.', 'U2 is low', 'DS3 VCC is not powered in the current state: SW2 is open. x'])
  })
})
