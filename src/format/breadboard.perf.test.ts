// Budget and real-part tests on the built-in full breadboard: seated detection for 20 parts and a
// board drag frame stay well inside a 60 fps frame, and the boards fit the real parts they should.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plugsOf, seatOf } from './breadboard.ts'
import { netlist } from './netlist.ts'
import type { Diagram, PartInstance } from './diagram.ts'
import type { Rotation } from './geometry.ts'
import { validateModule, type ModuleDef } from './module.ts'
import { moveParts, settleMounts, settleSeats } from '../editor/ops.ts'

const dir = join(import.meta.dirname, '..', '..', 'modules')
const load = (id: string): ModuleDef => {
  const r = validateModule(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')))
  if (!r.ok) throw new Error(`${id}: ${r.errors.join('; ')}`)
  return r.module
}
/** Two-lead part, body 40 x 30 (pivot 20, 10): L edge at local (0, 20), R edge at local (40, 20), stubs 8 px out. */
const two: ModuleDef = { format: 'circuitoon-module/1', id: 'two', name: 'Two', pins: [{ name: 'L', side: 'left' }, { name: 'R', side: 'right' }] }
const full = load('breadboard-full')
const board: PartInstance = { uid: 'bb', designator: 'BB1', module: full.id, x: 0, y: 0 }

/** The full board with 20 two-lead parts whose legs sit in rows a-j, columns 1/5 and 8/12, and 10 rail jumpers. */
function loaded(mounted: boolean): Diagram {
  const parts: PartInstance[] = [board]
  const rows = [60, 70, 80, 90, 100, 130, 140, 150, 160, 170]
  let n = 0
  for (const row of rows)
    for (const x of [30, 100]) {
      n++
      parts.push({ uid: `r${n}`, designator: `R${n}`, module: 'two', x, y: row - 20, ...(mounted ? { mount: { board: 'bb' } } : {}) })
    }
  const connections = Array.from({ length: 10 }, (_, i) => ({
    uid: `w${i + 1}`, from: { part: 'bb', pin: 'top+', hole: i * 5 }, to: { part: 'bb', pin: `c${20 + i * 4}-top`, hole: 0 },
  }))
  return { format: 'circuitoon-diagram/1', title: 'perf', modules: { [full.id]: full, two }, parts, connections }
}

function median(fn: () => void, runs = 15): number {
  for (let i = 0; i < 3; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

describe('full breadboard with 20 parts', () => {
  const uids = Array.from({ length: 20 }, (_, i) => `r${i + 1}`)

  it('seats all 20 parts, and dropping them mounts all 40 legs', () => {
    const d = loaded(false)
    for (const u of uids) expect(seatOf(d, u, [])?.status).toBe('seated')
    expect(plugsOf(settleMounts(d, uids))).toHaveLength(40)
  })
  it('detects seats for 20 parts in 4 ms or less (median)', () => {
    const d = loaded(true)
    const ms = median(() => {
      const plugs = plugsOf(d)
      for (const u of uids) seatOf(d, u, plugs)
    })
    expect(ms).toBeLessThanOrEqual(4)
  })
  it('runs the drag highlight check (settleSeats) for 20 dragged mounted parts in 4 ms or less (median)', () => {
    const d = loaded(true)
    let seated = 0
    const ms = median(() => {
      seated = [...settleSeats(d, uids).seats.values()].filter((s) => s?.status === 'seated').length
    })
    expect(seated).toBe(20)
    expect(ms).toBeLessThanOrEqual(4)
  })
  // Skipped until Task 9 makes moveParts carry mounted parts; Task 9 Step 5 removes the .skip.
  it.skip('moves the board with its 20 parts and re-plugs them in 4 ms or less per frame (median)', () => {
    const d = loaded(true)
    let dx = 0
    const ms = median(() => {
      dx += 10
      expect(plugsOf(moveParts(d, ['bb'], dx, 0))).toHaveLength(40)
    })
    expect(ms).toBeLessThanOrEqual(4)
  })
  it('builds the netlist in 5 ms or less (median)', () => {
    const d = loaded(true)
    expect(median(() => netlist(d))).toBeLessThanOrEqual(5)
  })
})

describe('real parts on the full breadboard', () => {
  /** Grid positions near the board where the part is seated at this rotation. */
  function seatedSpots(m: ModuleDef, rotation: Rotation): number {
    let n = 0
    for (let x = -100; x <= 700; x += 10)
      for (let y = -100; y <= 300; y += 10) {
        const d: Diagram = {
          format: 'circuitoon-diagram/1', title: 't', modules: { [full.id]: full, [m.id]: m }, connections: [],
          parts: [board, { uid: 'u', designator: 'U1', module: m.id, x, y, rotation }],
        }
        if (seatOf(d, 'u', [])?.status === 'seated') n++
      }
    return n
  }
  it('seats a XIAO and a DIP-28 across the channel once turned, not before', () => {
    for (const id of ['xiao-esp32c3', 'mcp23017-dip28']) {
      expect(seatedSpots(load(id), 0), id).toBe(0)
      expect(seatedSpots(load(id), 90), id).toBeGreaterThan(0)
    }
  })
  it('cannot seat the 120 px wide ESP32 DevKit V1: its rows are wider than rows a to j (110 px)', () => {
    expect(seatedSpots(load('esp32-devkit-v1-30'), 90)).toBe(0)
  })
})
