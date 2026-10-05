// The SPICE compiler (spec 2, 4): Circuit + classification + analysis to text and a map back. Pure
// and deterministic: elements in part-uid order (each part's devices by id, then its pin senses by
// pin); nodes renamed n1..nN, nets first, each in code-point order, node 0 the first island's
// reference, so no user name reaches the parser; element names sanitised and lowercase (ngspice
// lowercases); R never 0. Elements whose nodes are all floating are omitted, so an element stays
// when it touches any defined node (driven, or held by a return: grounds and pull-downs are
// defined, never driven); a floating node that still touches one, and every other island's
// reference, get 1 G to node 0 for numerics only (spec 4.4). Reducing a part for DC happens here: a
// capacitor is emitted and ngspice opens it in `op`; a closed contact is its resistance and an open
// one no element at all (spec 4 table: the classification treats it as absent, so no 1e12 Roff
// joins what it calls separate islands); a GPIO is the one resistor its state selects (gpioBranch).
import { naturalCompare } from '../agent/order.ts'
import type { Classification } from './floating.ts'
import { BODY_DIODE, schottky } from './ledModels.ts'
import { type Analysis, type Circuit, type Device, type DiodeModel, type Param, type PinTap, gpioBranch, netNode } from './model.ts'

/** Smoothing (ruling R18): k = 5 mV on volts, 0.005 on ratios. */
const KV = 0.005
const KR = 0.005
/** The smallest resistance ever written: R is never 0 (spec 2). */
const R_MIN = 1e-6
/** A rail's smallest rout: measured in our ngspice, an LDO with rout 0 or 1e-6 fails op ("Timestep too small"), 1 mOhm solves. */
const ROUT_MIN = 1e-3
/** Divisor guards; Task 16 validation rejects such values anyway, these only keep the text finite. */
const MIN_VOLTS_MIN = 1e-3
const EFFICIENCY_MIN = 0.01
/** The numerical join of floating nodes and second islands (spec 4.4). */
const R_TIE = 1e9
/** A boost's pass-through diode (spec 4.2), Schottky at 100 mA: a modelling choice. */
const OFF_PATH_VF = 0.35

export interface RawRun { v: Record<string, number>; pins: Record<string, Record<string, number>>; dev: Record<string, number> }
export interface Compiled { text: string; empty: boolean; read(vectors: Record<string, number>): RawRun; nodesIn(error: string): string[] }

export const num = (x: number): string => {
  if (!Number.isFinite(x)) throw new Error(`spice: not a finite number (${x})`)
  return String(Number(x.toPrecision(12)))
}
/** softplus(x) = k ln(1 + e^(x/k)), written so exp never overflows: max(x, 0) + k ln(1 + e^(-|x|/k)). */
const sp = (x: string, k = KV) => `(max(${x},0)+${num(k)}*ln(1+exp(-abs(${x})/${num(k)})))`
const smax = (a: string, b: string, k = KV) => `(${b}+${sp(`(${a})-(${b})`, k)})`
const smin = (a: string, b: string, k = KV) => `(${a}-${sp(`(${a})-(${b})`, k)})`
/**
 * A smooth max(x, 0) that is exactly 0 at x = 0: softplus less its k ln 2 floor. Every gate of
 * something that must be off at 0 (a load, iq) uses it, else a dead rail still draws or supplies.
 */
const pos = (x: string, k = KV) => `(${sp(x, k)}-${num(k * Math.LN2)})`
/** The load fold-back f(V): 1 above minVolts, falling smoothly to exactly 0 at 0 V (spec 4 table). */
const fold = (v: string, minVolts: number) => smin('1', `${pos(v)}/${num(Math.max(minVolts, MIN_VOLTS_MIN))}`, KR)
const step = (a: number, b: number, x: string) => {
  const t = `min(max((${x}-${num(a)})/${num(b - a)},0),1)`
  return `(${t}*${t}*(3-2*${t}))`
}
/** A buck or boost's enable (spec 4.2). */
const enable = (vin: string, lo: number, hi: number) => `(${step(lo - 0.05, lo, vin)}*(1-${step(hi, hi + 0.05, vin)}))`

/** The same functions on numbers, for results and findings. */
export const softplus = (x: number, k = KV): number => Math.max(x, 0) + k * Math.log1p(Math.exp(-Math.abs(x) / k))
export const foldValue = (v: number, minVolts: number): number => 1 - softplus(1 - (softplus(v) - KV * Math.LN2) / Math.max(minVolts, MIN_VOLTS_MIN), KR)
const stepValue = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
export const enableValue = (vin: number, lo: number, hi: number): number => stepValue(lo - 0.05, lo, vin) * (1 - stepValue(hi, hi + 0.05, vin))

type N = (node: string) => string
interface El { nodes: string[]; lines: (n: N) => string[]; read?: { tap: PinTap; name: string } | { dev: string; name: string; sign: 1 | -1 } }

export function compile(c: Circuit, cls: Classification, a: Analysis): Compiled {
  const used = new Set<string>()
  const name = (prefix: string, id: string) => {
    const base = `${prefix}_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
    let n = base
    for (let k = 2; used.has(n); k++) n = `${base}_${k}`
    used.add(n)
    return n
  }
  const diode = (id: string, an: string, kn: string, m: DiodeModel): El => {
    const d = name('d', id)
    return { nodes: [an, kn], lines: (n) => [`.model m_${d} d(is=${num(m.is)} n=${num(m.n)} rs=${num(m.rs)})`, `${d} ${n(an)} ${n(kn)} m_${d}`] }
  }
  let taps = 0
  const tapEl = (t: PinTap): El => {
    const v = `vs_${++taps}`
    const net = netNode(t.net)
    return { nodes: [net, t.node], lines: (n) => [`${v} ${n(net)} ${n(t.node)} dc 0`], read: { tap: t, name: v } }
  }
  const resistor = (id: string, x: string, y: string, ohms: Param): El => {
    const r = name('r', id)
    return { nodes: [x, y], lines: (n) => [`${r} ${n(x)} ${n(y)} ${num(Math.max(ohms.value, R_MIN))}`] }
  }
  const devEls = (d: Device): El[] => {
    switch (d.kind) {
      case 'resistor':
        return [resistor(d.id, d.a, d.b, d.ohms)]
      case 'switch':
        return d.closed ? [resistor(d.id, d.a, d.b, d.ron)] : []
      case 'gpio': {
        const g = gpioBranch(d)
        return g ? [resistor(d.id, g.a, g.b, g.ohms)] : []
      }
      case 'capacitor': {
        const cn = name('c', d.id)
        return [{ nodes: [d.a, d.b], lines: (n) => [`${cn} ${n(d.a)} ${n(d.b)} ${num(d.farads)}`] }]
      }
      case 'diode':
        return [diode(d.id, d.a, d.k, d.model)]
      case 'cell': {
        const v = name('v', d.id)
        const r = name('r', `${d.id}.int`)
        return [{
          nodes: [d.p, d.int, d.n],
          lines: (n) => [`${v} ${n(d.p)} ${n(d.int)} dc ${num(d.volts.value)}`, `${r} ${n(d.int)} ${n(d.n)} ${num(Math.max(d.rInternal.value, R_MIN))}`],
          read: { dev: d.id, name: v, sign: -1 },
        }]
      }
      case 'load': {
        const b = name('b', d.id)
        const amps = a.corner === 'peak' ? d.peak.value : d.typical.value
        return [{ nodes: [d.p, d.n], lines: (n) => [`${b} ${n(d.p)} ${n(d.n)} i=${num(amps)}*${fold(`v(${n(d.p)},${n(d.n)})`, d.minVolts.value)}`] }]
      }
      case 'rail': {
        const r = d.rail
        const [bctl, bout, vo, fin, bin, biq] = ['ctl', 'out', 'o', 'in', 'in', 'iq'].map((s, i) => name(i === 3 ? 'f' : i === 2 ? 'v' : 'b', `${d.id}.${s}`))
        const els: El[] = [{
          nodes: [d.in, d.inRet, d.out, d.ret, d.ctl, d.o],
          read: { dev: d.id, name: vo, sign: 1 },
          lines: (n) => {
            const vin = `v(${n(d.in)},${n(d.inRet)})`
            const vctl = r.kind === 'ldo' ? smin(num(r.vout!.value), smax(`${vin}-${num(r.dropout!.value)}`, '0')) : `${enable(vin, r.vinMin!.value, r.vinMax!.value)}*${num(r.vout!.value)}`
            // softplus(Vctl - Vout) - softplus(-Vout): exactly 0 at Vctl = 0, so a dead rail supplies nothing (ruling, Task 15).
            const iout = `(${sp(`v(${n(d.ctl)},${n(d.ret)})-v(${n(d.o)},${n(d.ret)})`)}-${sp(`-v(${n(d.o)},${n(d.ret)})`)})/${num(Math.max(r.rout.value, ROUT_MIN))}`
            const out = [
              `${bctl} ${n(d.ctl)} ${n(d.ret)} v=${vctl}`,
              `${bout} ${n(d.ret)} ${n(d.o)} i=${iout}`,
              `${vo} ${n(d.o)} ${n(d.out)} dc 0`,
              // A buck or boost input repeats the output expression instead of reading i(vo): measured, the
              // i(vo) form fails op on a weak cell with a boost's pass-through diode (fix wave, finding 2).
              r.kind === 'ldo'
                ? `${fin} ${n(d.in)} ${n(d.inRet)} ${vo} 1`
                : `${bin} ${n(d.in)} ${n(d.inRet)} i=v(${n(d.ctl)},${n(d.ret)})*(${iout})/(${num(Math.max(r.efficiency!.value, EFFICIENCY_MIN))}*max(${vin},0.5))`,
            ]
            // iq folds back below a 1 V knee on the input (smin(1, Vin)), so a dead input draws 0.
            if (r.iq.value > 0) out.push(`${biq} ${n(d.in)} ${n(d.inRet)} i=${num(r.iq.value)}*${smin('1', pos(vin), KR)}`)
            return out
          },
        }]
        if (r.reverse === 'body-diode') els.push(diode(`${d.id}.body`, d.out, d.in, BODY_DIODE))
        if (r.kind !== 'ldo' && r.offPath === 'diode') els.push(diode(`${d.id}.off`, d.in, d.out, schottky(OFF_PATH_VF)))
        return els
      }
    }
  }
  // Part order (natural), each part's devices (by id) before its senses (by pin), in code-point order.
  const cp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  const entries = [...c.devices.map((dev) => ({ part: dev.part, rank: 0, key: dev.id, dev })), ...c.taps.map((tap) => ({ part: tap.part, rank: 1, key: tap.pin, tap }))]
    .sort((x, y) => naturalCompare(x.part, y.part) || x.rank - y.rank || cp(x.key, y.key))
  const els = entries.flatMap((e) => ('dev' in e && e.dev ? devEls(e.dev) : [tapEl((e as { tap: PinTap }).tap)]))
  const live = els.filter((e) => e.nodes.some((n) => cls.defined.has(n)))
  const ground = cls.islands[0]?.reference
  if (!ground || !live.length) return { text: '', empty: true, read: () => ({ v: {}, pins: {}, dev: {} }), nodesIn: () => [] }

  // Nets first, then pin and internal nodes, each in code-point order.
  const isNet = (node: string) => (node.startsWith(netNode('')) ? 0 : 1)
  const touched = [...new Set(live.flatMap((e) => e.nodes))].sort((x, y) => isNet(x) - isNet(y) || cp(x, y))
  const spice = new Map<string, string>([[ground, '0']])
  let k = 0
  for (const node of touched) if (!spice.has(node)) spice.set(node, `n${++k}`)
  const n: N = (node) => spice.get(node)!
  const ties: string[] = []
  let f = 0
  for (const node of touched) if (!cls.defined.has(node)) ties.push(`r_float_${++f} ${n(node)} 0 ${num(R_TIE)}`)
  let j = 0
  for (const isl of cls.islands.slice(1)) if (spice.has(isl.reference)) ties.push(`r_join_${++j} ${n(isl.reference)} 0 ${num(R_TIE)}`)
  const text = ['* circuitoon', ...live.flatMap((e) => e.lines(n)), ...ties, '.end', ''].join('\n')
  const back = new Map([...spice].map(([node, s]) => [s, node]))
  return {
    text,
    empty: false,
    read(vectors) {
      const raw: RawRun = { v: {}, pins: {}, dev: {} }
      for (const node of touched) raw.v[node] = spice.get(node) === '0' ? 0 : (vectors[spice.get(node)!] ?? Number.NaN)
      for (const e of live) {
        if (!e.read) continue
        const amps = vectors[`${e.read.name}#branch`] ?? Number.NaN
        if ('tap' in e.read) (raw.pins[e.read.tap.part] ??= {})[e.read.tap.pin] = amps
        else raw.dev[e.read.dev] = e.read.sign * amps
      }
      return raw
    },
    nodesIn(error) {
      return [...new Set([...error.matchAll(/\bn\d+\b/g)].map((m) => back.get(m[0])).filter((x): x is string => !!x))]
    },
  }
}
