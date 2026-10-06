// PWM solves (firmware spec 4.2, plan ruling R1). PWM pins split into groups that interact (joined
// through anything other than the supply and ground nets: domain pins and returns, cell terminals).
// One baseline run sets every exact group (k <= 3 pins) all low and every larger group's pins to
// round(duty); each exact group adds a run per other combination c (weight: the product of d or
// 1 - d), each larger group one run per pin with that pin flipped (weight |d - round(d)|:
// superposition). Any reading's average is X0 + sum over runs v of w_v (X_v - X0), so the weights are
// those, with run 0 taking 1 - their sum. Exact for one group, and for groups that only share a stiff
// supply; superposition is exact for a linear group. Pure.
import { dcEdges } from './floating.ts'
import { type Circuit, type GpioDevice, netNode } from './model.ts'
import type { RawRun } from './spice.ts'

export interface PwmPin { id: string; part: string; pin: string; duty: number }
export interface PwmPlan {
  pins: PwmPin[]
  groups: PwmPin[][]
  /** Run 0 is the baseline. Each run sets every PWM pin (by device id) high or low. */
  runs: Record<string, 'high' | 'low'>[]
  /** Any reading's average is the sum of weights[r] times its value in run r. */
  weights: number[]
  /** Groups whose average assumes their pins' cycles overlap at random (ruling R6). */
  approximate: PwmPin[][]
  /** The peak corner (spec 4.2): every PWM pin high, then every PWM pin low. */
  peak: [Record<string, 'high' | 'low'>, Record<string, 'high' | 'low'>]
}
export const EXACT_MAX = 3

const pwmPins = (c: Circuit): PwmPin[] =>
  c.devices.filter((d): d is GpioDevice => d.kind === 'gpio' && d.state === 'pwm').map((d) => ({ id: d.id, part: d.part, pin: d.pin, duty: d.duty ?? 0.5 }))

export function pwmGroups(c: Circuit): PwmPin[][] {
  const pins = pwmPins(c)
  if (!pins.length) return []
  // Cut: the supply and ground nets, and the supply pins themselves.
  const tapNet = new Map(c.taps.map((t) => [t.node, netNode(t.net)]))
  const cut = new Set<string>()
  const supply = (node: string) => {
    cut.add(node)
    const net = tapNet.get(node)
    if (net) cut.add(net)
  }
  for (const dom of c.domains) supply(dom.pin), supply(dom.ret)
  for (const d of c.devices) if (d.kind === 'cell') supply(d.p), supply(d.n)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const join = (a: string, b: string) => {
    if (cut.has(a) || cut.has(b)) return
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const t of c.taps) join(t.node, netNode(t.net))
  for (const d of c.devices) if (d.kind !== 'gpio' && d.kind !== 'load' && d.kind !== 'rail' && d.kind !== 'cell') for (const [a, b] of dcEdges(d)) join(a, b)
  const byRoot = new Map<string, PwmPin[]>()
  for (const p of pins) {
    const dev = c.devices.find((d) => d.id === p.id) as GpioDevice
    const root = find(dev.node)
    byRoot.set(root, [...(byRoot.get(root) ?? []), p])
  }
  return [...byRoot.values()]
}

export function pwmPlan(c: Circuit): PwmPlan | null {
  const pins = pwmPins(c)
  if (!pins.length) return null
  const groups = pwmGroups(c)
  const base: Record<string, 'high' | 'low'> = {}
  for (const g of groups) for (const p of g) base[p.id] = g.length > EXACT_MAX && p.duty >= 0.5 ? 'high' : 'low'
  const runs = [base]
  const weights = [1]
  for (const g of groups) {
    if (g.length <= EXACT_MAX) {
      for (let k = 1; k < 1 << g.length; k++) {
        const run = { ...base }
        let w = 1
        g.forEach((p, i) => {
          const hi = (k >> i) & 1
          run[p.id] = hi ? 'high' : 'low'
          w *= hi ? p.duty : 1 - p.duty
        })
        runs.push(run)
        weights.push(w)
      }
    } else
      for (const p of g) {
        runs.push({ ...base, [p.id]: base[p.id] === 'high' ? 'low' : 'high' })
        weights.push(Math.abs(p.duty - (base[p.id] === 'high' ? 1 : 0)))
      }
  }
  weights[0] = 1 - weights.slice(1).reduce((s, w) => s + w, 0)
  const all = (level: 'high' | 'low') => Object.fromEntries(pins.map((p) => [p.id, level])) as Record<string, 'high' | 'low'>
  return { pins, groups, runs, weights, approximate: groups.filter((g) => g.length > 1), peak: [all('high'), all('low')] }
}

/** The weighted sum of raw runs (the duty-weighted average). A value missing or not finite in any run is NaN. */
export function mixRaws(raws: RawRun[], weights: number[]): RawRun {
  const mix = (get: (r: RawRun) => number | undefined) => {
    let s = 0
    for (const [i, r] of raws.entries()) {
      const x = get(r)
      if (x === undefined || !Number.isFinite(x)) return Number.NaN
      s += weights[i] * x
    }
    return s
  }
  const keys = (pick: (r: RawRun) => Record<string, unknown>) => [...new Set(raws.flatMap((r) => Object.keys(pick(r))))]
  const out: RawRun = { v: {}, pins: {}, dev: {} }
  for (const k of keys((r) => r.v)) out.v[k] = mix((r) => r.v[k])
  for (const k of keys((r) => r.dev)) out.dev[k] = mix((r) => r.dev[k])
  for (const part of keys((r) => r.pins)) {
    out.pins[part] = {}
    for (const pin of [...new Set(raws.flatMap((r) => Object.keys(r.pins[part] ?? {})))]) out.pins[part][pin] = mix((r) => r.pins[part]?.[pin])
  }
  return out
}
