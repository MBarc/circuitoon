// Spec 6.3: LED brightness follows current on a log scale with full brightness at its current
// limit; the shown result is the live one, or the last good one (stale) while a solve fails.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { type PartInstance } from '../format/diagram.ts'
import { bodyRect, pivot } from '../format/geometry.ts'
import { layoutModule } from '../format/module.ts'
import { currentFindings, glowLevel, hornPath, runBadges, servoPivot, servoShaft, shownResult } from './SimLayer.tsx'
import { EMPTY_RUN } from './store.ts'
import { readingText } from './ProbeLayer.tsx'
import { piBlink } from '../run/sheets.testing.ts'
import type { SimFinding, SimResult } from '../sim/results.ts'
import { RUN_TITLES, foldNotPowered } from '../sim/display.ts'

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

// Firmware spec 6.3: a running board gets a green "running" badge, one stopped by an exception a red
// "error" one, at its body's top-right corner (ruling R14); a servo's horn is drawn at its angle; probe
// tags read "avg" when PWM is in the result (ruling R7); run-time findings have titles.
describe('run marks on the sheet (spec 6.3)', () => {
  it("badges running and error boards at the body's top right, and nothing else", () => {
    const d = piBlink()
    const board = (status: 'running' | 'error' | 'done') => ({ status, source: '', file: '', serial: [], prompt: null, progress: null, message: null })
    expect(runBadges(d, EMPTY_RUN)).toEqual([])
    const [b] = runBadges(d, { ...EMPTY_RUN, boards: { u1: board('running') } })
    expect(b).toMatchObject({ uid: 'u1', kind: 'running' })
    expect(runBadges(d, { ...EMPTY_RUN, boards: { u1: board('error') } })[0].kind).toBe('error')
    expect(runBadges(d, { ...EMPTY_RUN, boards: { u1: board('done') } })).toEqual([])
  })
  it('draws a horn pointing along its angle (0 left, 90 up, 180 right)', () => {
    expect(hornPath(0, 0, 10, 90)).toMatch(/^M0 0 L-?0(\.\d+)? -10/)
    expect(hornPath(0, 0, 10, 0)).toMatch(/L-10 0/)
  })
  it('reads PWM results as averages, and titles the run-time findings', () => {
    const v = { typical: { kind: 'value' as const, value: 1.21, reference: 'GND', trust: 'ok' as const }, peak: { kind: 'value' as const, value: 3.3, reference: 'GND', trust: 'ok' as const } }
    expect(readingText(v, true)).toBe('avg 1.21 V (peak 3.3 V)')
    expect(readingText(v, false)).toBe('1.21 V (peak 3.3 V)')
    expect(RUN_TITLES).toEqual({ 'undefined-level': 'Between logic levels', 'floating-read': 'Reads a floating pin', 'servo-signal': 'Servo signal out of range' })
  })
})

describe('servoPivot (the live horn turns on the art shaft)', () => {
  const m = JSON.parse(readFileSync('modules/servo-sg90.json', 'utf8'))
  const lay = layoutModule(m)
  const art = { x: (lay.w - m.art.w) / 2, y: (lay.h - m.art.h) / 2 }
  it('is the art shaft in world coordinates at rotation 0 and 90', () => {
    expect(servoShaft(m)).toEqual({ x: 122, y: 24 })
    const at0 = servoPivot({ uid: 'm1', x: 200, y: 100, rotation: 0 } as PartInstance, m)
    expect(at0).toEqual({ x: 200 + art.x + 122, y: 100 + art.y + 24 })
    const at90 = servoPivot({ uid: 'm1', x: 200, y: 100, rotation: 90 } as PartInstance, m)
    const c = pivot(lay.w, lay.h)
    // Rotating 90 degrees clockwise about the layout pivot: (dx, dy) becomes (-dy, dx).
    const dx = art.x + 122 - c.x
    const dy = art.y + 24 - c.y
    expect(at90).toEqual({ x: 200 + c.x - dy, y: 100 + c.y + dx })
  })
  it('falls back to the body centre without a shaft', () => {
    const bare = { ...m, electrical: { ...m.electrical, sim: undefined } }
    const box = bodyRect({ x: 0, y: 0, rotation: 0 }, lay)
    expect(servoPivot({ uid: 'm1', x: 0, y: 0, rotation: 0 } as PartInstance, bare)).toEqual({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
  })
})
