// Firmware spec 4.5: a board is powered when every one of its loads solves (typical corner, the
// duty-weighted average) at or above its minVolts. A PWM combination that browns out is reported
// (the union) but, averaged at 10 % duty, does not stop the board. The 5V input below 4.63 V gives a
// note. The words are the spec's.
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeEngine } from '../sim/engine/engine.ts'
import { createNodeEngineHost } from '../sim/engine/nodeEngine.ts'
import { solve } from '../sim/session.ts'
import { boardModule, cellModule, sheet } from '../sim/testing.ts'
import { LOST_POWER, NO_POWER, PI_UNDER_VOLTAGE, boardPower, underVoltage, underVoltageNote } from './power.ts'

const engine = makeEngine(createNodeEngineHost())
afterAll(() => engine.dispose())
const on = async (d: ReturnType<typeof sheet>, runPins = {}) => {
  const r = await solve(d, engine, 1, { runPins })
  if (r.outcome.status !== 'ok') throw new Error('solve failed')
  return { c: r.circuit, result: r.outcome.result }
}

describe('power while running (spec 4.5)', () => {
  it('is powered from 5 V, and unpowered with nothing on its supply', async () => {
    const good = await on(sheet([{ uid: 'bt1', module: cellModule(5, 0.05) }, { uid: 'u1', module: boardModule({ minVolts: 2.9 }) }], [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND']]))
    expect(boardPower(good.c, good.result, 'u1')).toMatchObject({ powered: true })
    const none = await on(sheet([{ uid: 'u1', module: boardModule({ minVolts: 2.9 }) }], []))
    expect(boardPower(none.c, none.result, 'u1')).toMatchObject({ powered: false, lowest: { domain: '3V3', volts: null, minVolts: 2.9 } })
  }, 60_000)
  it('reports a brownout in the high run but stays powered on the 10 % average', async () => {
    // A weak supply (12 ohm) and IO1 driving 10 ohm: the high run pulls the 3V3 rail under 2.9 V.
    const d = sheet(
      [{ uid: 'bt1', module: cellModule(5, 12) }, { uid: 'u1', module: boardModule({ minVolts: 2.9 }) }, { uid: 'r1', module: 'resistor', values: { resistance: { value: 10, unit: 'ohm' } } }],
      [['bt1.+', 'u1.VIN'], ['bt1.-', 'u1.GND'], ['u1.IO1', 'r1.1'], ['r1.2', 'u1.GND']],
    )
    const { c, result } = await on(d, { u1: { IO1: { pwm: 0.1 } } })
    expect(result.findings.some((f) => f.code === 'sim-brownout' && f.severity === 'error' && f.parts.includes('u1'))).toBe(true)
    expect(boardPower(c, result, 'u1').powered).toBe(true)
  }, 60_000)
  it('notes a 5V input under 4.63 V, in plain words', () => {
    expect(PI_UNDER_VOLTAGE).toBe(4.63)
    expect(underVoltage({ powered: true, inputVolts: 4.5, lowest: null })).toBe(true)
    expect(underVoltage({ powered: true, inputVolts: 5.0, lowest: null })).toBe(false)
    expect(underVoltageNote('U1', 4.5)).toBe("U1's 5V input is at 4.5 V, below the 4.63 V where a real Raspberry Pi warns of under-voltage.")
    expect([NO_POWER('U1'), LOST_POWER('U1')]).toEqual(['U1 has no power: connect 5V and GND', 'U1 lost power'])
  }, 60_000)
  it('cites the source URL that Task 8 recorded in the Pi 4 patch notes', () => {
    const note = (JSON.parse(readFileSync('scripts/sim-data/rpi-4-model-b.json', 'utf8')).notes as string[]).find((n) => n.includes('PI_UNDER_VOLTAGE'))
    const url = note?.match(/https:\/\/\S+/)?.[0].replace(/[.,;)]+$/, '')
    expect(url).toBeDefined()
    expect(readFileSync('src/run/power.ts', 'utf8')).toContain(`Source: ${url}`)
  })
})
