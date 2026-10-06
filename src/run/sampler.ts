// The sampler (firmware spec 2.3), shared by the editor and the CLI: one board's pin table becomes
// run pin states. Declared PWM (RPi.GPIO.PWM, gpiozero's PWM devices) is used as declared; a plain
// output that toggles at PWM_MIN_HZ (flicker fusion) or faster over a fixed 100 ms window becomes PWM
// with duty = high time / window; slower toggling shows the latch at the sample, so a visible blink
// stays a blink. Duty is quantised to 1/64 and only moves past a step, so jitter never re-solves.
import type { RunPinState } from '../format/simState.ts'
import { gpioPin } from './boards.ts'
import { type BoardMemory, MODE, NPINS, readAllOut } from './memory.ts'

export const PWM_MIN_HZ = 50
export const WINDOW_MS = 100
export const DUTY_STEP = 1 / 64
const INPUT_STATE: Record<number, RunPinState> = { [MODE.input]: 'input', [MODE.pullup]: 'input-pullup', [MODE.pulldown]: 'input-pulldown' }

export function quantize(prev: number | null, duty: number): number {
  const q = Math.round(duty / DUTY_STEP) * DUTY_STEP
  return prev === null || Math.abs(duty - prev) >= DUTY_STEP ? q : prev
}

/** One pin as sampled: its state, and the duty and frequency behind it (the servo model reads them, ruling R23). */
export interface SampledPin { state: RunPinState; duty: number | null; freqHz: number | null }
interface Point { tMs: number; rising: number; falling: number; highUs: number }

const asState = (d: number): RunPinState => (d <= 0 ? 'low' : d >= 1 ? 'high' : { pwm: d })

export class BoardSampler {
  private history = new Map<number, Point[]>()
  private duty = new Map<number, number>()

  /** The board's pins at run time `nowMs` (its own clock). Unused pins are left out: their saved states apply. */
  sample(m: BoardMemory, nowMs: number): { pins: Record<string, RunPinState>; detail: Record<string, SampledPin>; seq: number } {
    // One snapshot: the code sequence numbers exactly these modes (never read it separately).
    const { rows, codeSeq: seq } = readAllOut(m)
    const nowUs = Math.round(nowMs * 1000) >>> 0
    const pins: Record<string, RunPinState> = {}
    const detail: Record<string, SampledPin> = {}
    for (let bcm = 0; bcm < NPINS; bcm++) {
      const r = rows[bcm]
      const name = gpioPin(bcm)
      if (r.mode !== MODE.output) {
        this.history.delete(bcm)
        this.duty.delete(bcm)
        if (r.mode !== MODE.unused) detail[name] = { state: (pins[name] = INPUT_STATE[r.mode]), duty: null, freqHz: null }
        continue
      }
      if (r.pwmActive) {
        this.history.delete(bcm)
        const d = quantize(this.duty.get(bcm) ?? null, r.duty)
        this.duty.set(bcm, d)
        detail[name] = { state: (pins[name] = asState(d)), duty: r.duty, freqHz: r.freq }
        continue
      }
      // A plain output: the bit-bang window (high time counts the current high stretch too).
      const high = (r.highUs + (r.latch ? (nowUs - r.changedUs) >>> 0 : 0)) >>> 0
      const hist = this.history.get(bcm) ?? []
      hist.push({ tMs: nowMs, rising: r.rising, falling: r.falling, highUs: high })
      // Keep the window and the newest point at least a window old (the base).
      while (hist.length > 2 && hist[1].tMs <= nowMs - WINDOW_MS) hist.shift()
      this.history.set(bcm, hist)
      const base = hist[0].tMs <= nowMs - WINDOW_MS ? hist[0] : null
      const latch: RunPinState = r.latch ? 'high' : 'low'
      if (!base) {
        detail[name] = { state: (pins[name] = latch), duty: null, freqHz: null }
        continue
      }
      const span = nowMs - base.tMs
      const edges = ((r.rising - base.rising) >>> 0) + ((r.falling - base.falling) >>> 0)
      if (edges < ((PWM_MIN_HZ * 2 * span) / 1000) - 1e-9) {
        this.duty.delete(bcm)
        detail[name] = { state: (pins[name] = latch), duty: null, freqHz: null }
        continue
      }
      const raw = ((high - base.highUs) >>> 0) / 1000 / span
      const d = quantize(this.duty.get(bcm) ?? null, raw)
      this.duty.set(bcm, d)
      detail[name] = { state: (pins[name] = asState(d)), duty: raw, freqHz: edges / 2 / (span / 1000) }
    }
    return { pins, detail, seq }
  }

  /** A new run. */
  reset(): void {
    this.history.clear()
    this.duty.clear()
  }
}
