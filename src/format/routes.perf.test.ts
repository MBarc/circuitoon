// Re-route budget for the editor (final review of the agent toolkit): computeRoutes on a sheet of
// 68 parts and 120 wires stays within 1.3x of main's router (no hole or label avoidance), and what
// every wire keeps off is indexed once per re-route, never rebuilt per wire.
import { describe, expect, it } from 'vitest'
import { type Connection, type Diagram, type PartInstance, type Routes, computeRoutes, partObstacles, routeAvoid, routeWire } from './diagram.ts'
import { Occupancy, addToOccupancy } from './router.ts'
import { load } from './builtinModules.testing.ts'

const modules = Object.fromEntries(['breadboard-full', 'breadboard-half', 'resistor', 'led', 'esp32-devkitc-v4', 'bme280-module-4pin'].map((id) => [id, load(id)]))
const GPIO = ['IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'IO13', 'IO23', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'EN', 'VP', 'VN', 'D2']

/**
 * `k` blocks of 17 parts and 30 wires, 1,100 px apart, alternating two kinds. A: an ESP32, a full
 * breadboard with 12 plugged-in resistors wired to its GPIOs, and 3 BME280s on its 3V3 and GND.
 * B: a half breadboard with 4 plugged-in resistors, 12 resistors and LEDs off the board wired in a
 * chain, and 2 wires to the board's rails.
 */
function sheet(k: number): Diagram {
  const parts: PartInstance[] = []
  const connections: Connection[] = []
  const part = (uid: string, module: string, x: number, y: number, board?: string) =>
    parts.push({ uid, designator: uid, module, x, y, ...(board ? { mount: { board } } : {}) })
  for (let b = 0; b < k; b++) {
    const ox = b * 1100
    const n = b + 1
    if (b % 2 === 0) {
      part(`U${n}`, 'esp32-devkitc-v4', ox, 0)
      part(`BB${n}`, 'breadboard-full', ox + 250, 0)
      for (let i = 0; i < 12; i++) {
        const uid = `R${n}_${i + 1}`
        part(uid, 'resistor', ox + 280 + 70 * (i % 9), 40 + 70 * Math.floor(i / 9), `BB${n}`)
        for (const [j, pin] of ['1', '2'].entries()) connections.push({ uid: `w${uid}.${pin}`, from: { part: uid, pin }, to: { part: `U${n}`, pin: GPIO[i * 2 + j] } })
      }
      for (let j = 0; j < 3; j++) {
        const uid = `S${n}_${j + 1}`
        part(uid, 'bme280-module-4pin', ox + 300 + 200 * j, 400)
        connections.push({ uid: `w${uid}.VIN`, from: { part: uid, pin: 'VIN' }, to: { part: `U${n}`, pin: '3V3' } })
        connections.push({ uid: `w${uid}.GND`, from: { part: uid, pin: 'GND' }, to: { part: `U${n}`, pin: 'GND' } })
      }
    } else {
      const bb = `BB${n}`
      part(bb, 'breadboard-half', ox, 0)
      for (let i = 0; i < 4; i++) part(`M${n}_${i}`, 'resistor', ox + 30 + 70 * i, 40, bb)
      const off: string[] = []
      for (let i = 0; i < 12; i++) {
        off.push(`P${n}_${i}`)
        part(`P${n}_${i}`, i % 2 ? 'led' : 'resistor', ox + 20 + 100 * (i % 6), 330 + 110 * Math.floor(i / 6))
      }
      const led = (uid: string) => uid.startsWith('P') && Number(uid.split('_')[1]) % 2 === 1
      const pin = (uid: string, end: boolean) => ({ part: uid, pin: led(uid) ? (end ? 'K' : 'A') : end ? '2' : '1' })
      const chain = [...off, ...[0, 1, 2, 3].map((i) => `M${n}_${i}`)]
      let w = 0
      for (let i = 0; i + 1 < chain.length; i++) connections.push({ uid: `w${n}_${w++}`, from: pin(chain[i], true), to: pin(chain[i + 1], false) })
      for (let i = 0; w < 28; i++) connections.push({ uid: `w${n}_${w++}`, from: pin(chain[i], false), to: pin(chain[i + 2], true) })
      connections.push({ uid: `w${n}_${w++}`, from: pin(off[0], false), to: { part: bb, pin: 'top+', hole: 2 } })
      connections.push({ uid: `w${n}_${w++}`, from: pin(off[11], true), to: { part: bb, pin: 'top-', hole: 20 } })
    }
  }
  return { format: 'circuitoon-diagram/1', title: 'perf', modules, parts, connections }
}

function median(fn: () => void, runs = 21): number {
  for (let i = 0; i < 5; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[runs >> 1]
}

/**
 * Main's re-route, run here: every wire in file order with lanes, as computeRoutes does, but with
 * nothing to keep off, which is what main's router did (commit 113dae1). Measured in the same run,
 * so a busy machine slows both alike. On the development machine (2026-09-28) main itself took a
 * median 48 ms on this fixture under vitest, this baseline about the same, and the branch before
 * the one-index change 59.5 ms.
 */
function mainRoutes(d: Diagram): Routes {
  const obstacles = partObstacles(d)
  const nothing = routeAvoid(d, { groups: [], legGroup: new Map() }, { captions: new Map(), tabs: [] })
  const occupied = new Occupancy()
  const out: Routes = new Map()
  for (const c of d.connections) {
    const r = routeWire(d, c, obstacles, occupied, nothing)
    out.set(c.uid, r)
    if (r) addToOccupancy(occupied, r.points)
  }
  return out
}

describe('re-route cost', () => {
  it('routes 68 parts and 120 wires within 1.3x of main', { retry: 2, timeout: 60_000 }, () => {
    const d = sheet(4)
    expect([d.parts.length, d.connections.length]).toEqual([68, 120])
    const main = median(() => mainRoutes(d))
    const ms = median(() => computeRoutes(d))
    console.log(`computeRoutes, 68 parts / 120 wires: ${ms.toFixed(1)} ms (main's router ${main.toFixed(1)} ms)`)
    expect(ms).toBeLessThanOrEqual(1.3 * main)
  })
  it('indexes what wires keep off once: 20 idle breadboards far away barely change the cost', { retry: 2, timeout: 60_000 }, () => {
    // 16,600 holes and 20 captions no wire comes near. Rebuilt per wire (and per attempt), their
    // lists cost more than the routing itself; indexed once, only the build is added.
    const d = sheet(2)
    const idle: Diagram = {
      ...d,
      parts: [...d.parts, ...Array.from({ length: 20 }, (_, i): PartInstance => ({ uid: `X${i}`, designator: `X${i}`, module: 'breadboard-full', x: 20_000 + 800 * (i % 5), y: 20_000 + 300 * Math.floor(i / 5) }))],
    }
    const base = median(() => computeRoutes(d))
    const more = median(() => computeRoutes(idle))
    console.log(`computeRoutes, 34 parts / 60 wires: ${base.toFixed(1)} ms; with 20 idle boards: ${more.toFixed(1)} ms`)
    expect(more).toBeLessThanOrEqual(base * 1.3 + 2)
  })
})
