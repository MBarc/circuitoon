// Reading pins (firmware spec 4.4), the one function the editor and the CLI share: an input pin's
// solved voltage becomes a level with hysteresis (Pi inputs have Schmitt triggers), edges are counted
// from successive levels (so a press and release while the code sleeps still fire), a level between
// the thresholds for more than 100 ms warns once (`undefined-level`), and a floating input reads a
// random level per result (seeded from the board, ruling R21) and warns once (`floating-read`).
import type { ModuleDef } from '../format/module.ts'
import { simOf } from '../format/simModel.ts'
import type { Reading } from '../sim/results.ts'
import type { PinIn } from './memory.ts'

export interface Thresholds { low: number; high: number }
export const DWELL_MS = 100

/** inputLow and inputHigh from the board's data; without them, 30 and 70 percent of its GPIO domain (a generic CMOS estimate). */
export function thresholdsOf(m: ModuleDef | undefined): Thresholds {
  const sim = simOf(m)
  const g = sim?.gpio
  const nominal = sim?.power?.domains.find((d) => d.name === g?.domain)?.nominal ?? 3.3
  return { low: g?.inputLow?.value ?? 0.3 * nominal, high: g?.inputHigh?.value ?? 0.7 * nominal }
}

/** A small, seeded PRNG (mulberry32): the same run reads the same floating levels. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export class LevelTracker {
  private rows = new Map<string, PinIn>()
  private since = new Map<string, number>()
  private warned = new Set<string>()
  private rand: () => number
  private seed: string

  constructor(seed: string) {
    this.seed = seed
    this.rand = mulberry32(seedOf(seed))
  }

  /** One solved reading of one input pin at run time `nowMs`. */
  update(pin: string, r: Reading | undefined, th: Thresholds, nowMs: number): { row: PinIn; finding: 'undefined-level' | 'floating-read' | null } {
    const prev = this.rows.get(pin)
    let level: 0 | 1 = prev?.level ?? 0
    let status: PinIn['status'] = 'value'
    let volts = Number.NaN
    let finding: 'undefined-level' | 'floating-read' | null = null
    if (!r || r.kind === 'floating') {
      status = 'floating'
      level = this.rand() < 0.5 ? 0 : 1
      this.since.delete(pin)
      if (!this.warned.has(`f|${pin}`)) {
        this.warned.add(`f|${pin}`)
        finding = 'floating-read'
      }
    } else if (r.kind === 'undefined') {
      status = 'undefined'
      this.since.delete(pin)
    } else {
      volts = r.value
      if (volts >= th.high) level = 1
      else if (volts <= th.low) level = 0
      if (volts > th.low && volts < th.high) {
        if (!this.since.has(pin)) this.since.set(pin, nowMs)
      } else this.since.delete(pin)
    }
    // The first result sets the level; edges count from then on.
    const row: PinIn = {
      level, status, volts,
      rising: (prev?.rising ?? 0) + (prev && level === 1 && prev.level === 0 ? 1 : 0),
      falling: (prev?.falling ?? 0) + (prev && level === 0 && prev.level === 1 ? 1 : 0),
    }
    this.rows.set(pin, row)
    return { row, finding }
  }

  /** Pins that have now dwelt between the thresholds for more than 100 ms: each named once per run. */
  check(nowMs: number): string[] {
    const out: string[] = []
    for (const [pin, t] of this.since)
      if (nowMs - t > DWELL_MS && !this.warned.has(`u|${pin}`)) {
        this.warned.add(`u|${pin}`)
        out.push(pin)
      }
    return out
  }

  /** A pin's last row (its voltage names the undefined-level warning). */
  get(pin: string): PinIn | undefined {
    return this.rows.get(pin)
  }

  /** A new run: levels, edges and warnings start over, and the PRNG restarts. */
  reset(): void {
    this.rows.clear()
    this.since.clear()
    this.warned.clear()
    this.rand = mulberry32(seedOf(this.seed))
  }
}
