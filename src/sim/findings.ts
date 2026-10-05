// Simulation findings (spec 5.2). Topological codes are decided from the circuit before solving;
// value codes (added in Task 28) from each solved corner. finalize applies the severity rules: at
// peak every finding is a warning labelled with the peak's note (spec 4.5); an error whose basis is
// representative or estimate is a "likely" warning that lists the uncertain inputs (uncertainty
// decides blocking). Plain words, no SPICE vocabulary. Pure.
import { formatValue } from '../format/values.ts'
import { andList } from '../format/words.ts'
import { naturalCompare } from '../agent/order.ts'
import { NO_POWER_DATA } from './estimates.ts'
import { type Classification, deviceNodes, pinState } from './floating.ts'
import { type Circuit, type Corner, type Device, type Param, netNode } from './model.ts'
import { type SimCode, type SimFinding, basisOf } from './results.ts'

export const SIM_TITLES: Record<SimCode, string> = {
  'sim-short': 'Short circuit',
  'sim-source-conflict': 'Supplies fight',
  'sim-over-abs-max': 'Over its absolute maximum',
  'sim-over-limit': 'Over its rating',
  'sim-brownout': 'Not enough voltage',
  'sim-dropout': 'Regulator out of regulation',
  'sim-converter-off': 'Converter off',
  'sim-min-load': 'Below its minimum load',
  'sim-outside-model': 'Outside the model',
  'sim-floating-input': 'Floating input',
  'sim-no-convergence': 'Could not be solved',
  'sim-incomplete': 'Not simulated',
  'sim-estimate': 'Estimates used',
}

export interface Draft {
  code: SimCode
  severity: 'error' | 'warning' | 'note'
  parts: string[]
  message: string
  inputs: Param[]
  corner?: Corner
  /** Identity across corners: the same key at peak is dropped when typical has it. */
  key: string
  raw?: string
}

export const V = (x: number) => formatValue(Number(x.toPrecision(3)), 'V')
export const A = (x: number) => formatValue(Number(x.toPrecision(3)), 'A')
export const W = (x: number) => formatValue(Number(x.toPrecision(3)), 'W')
export const refOf = (c: Circuit, uid: string) => c.refs[uid] ?? uid
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Every parameter a device was built from: what sim-estimate counts. */
export function deviceParams(d: Device): Param[] {
  switch (d.kind) {
    case 'resistor':
      return [d.ohms]
    case 'cell':
      return [d.volts, d.rInternal, ...(d.imax ? [d.imax] : [])]
    case 'load':
      return [d.typical, d.peak, d.minVolts]
    case 'switch':
      return [d.ron]
    case 'gpio': {
      const p = d.params
      return [p.outputResistance, p.pullup, p.pulldown, p.leakage].filter((x): x is Param => !!x)
    }
    case 'rail': {
      const r = d.rail
      return [r.vout, r.dropout, r.iq, r.ioutMax, r.efficiency, r.vinMin, r.vinMax, r.rout, r.minLoad?.amps].filter((p): p is Param => !!p)
    }
    default:
      return []
  }
}

/**
 * The low paths (spec 5.2): wire joins (a pin tap to its net node), closed switch contacts, jumpers
 * and fuses (`contact` resistors) and USB cable conductors, as a union-find over node ids with the
 * part each step goes through.
 */
function lowGraph(c: Circuit) {
  const parent = new Map<string, string>()
  const adj = new Map<string, { to: string; part: string | null }[]>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const link = (a: string, b: string, part: string | null) => {
    for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n)
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
    adj.set(a, [...(adj.get(a) ?? []), { to: b, part }])
    adj.set(b, [...(adj.get(b) ?? []), { to: a, part }])
  }
  for (const t of c.taps) link(netNode(t.net), t.node, null)
  for (const d of c.devices)
    if ((d.kind === 'resistor' && (d.role === 'contact' || d.role === 'cable')) || (d.kind === 'switch' && d.closed)) link(d.a, d.b, d.part)
  /** The parts a low path from a to b passes through (breadth first, so the shortest). */
  const pathParts = (a: string, b: string): string[] => {
    const seen = new Map<string, { from: string; part: string | null } | null>([[a, null]])
    const queue = [a]
    for (let q = 0; q < queue.length && !seen.has(b); q++)
      for (const e of adj.get(queue[q]) ?? []) if (!seen.has(e.to)) {
        seen.set(e.to, { from: queue[q], part: e.part })
        queue.push(e.to)
      }
    const parts: string[] = []
    for (let at = seen.get(b); at; at = seen.get(at.from)) if (at.part && !parts.includes(at.part)) parts.unshift(at.part)
    return parts
  }
  return { same: (a: string, b: string) => parent.has(a) && parent.has(b) && find(a) === find(b), pathParts }
}

interface Source { device: string; part: string; label: string; p: string; n: string; volts: Param; blocks: boolean; rail: boolean }
function sources(c: Circuit): Source[] {
  return c.devices.flatMap((d): Source[] => {
    if (d.kind === 'cell') return [{ device: d.id, part: d.part, label: refOf(c, d.part), p: d.p, n: d.n, volts: d.volts, blocks: false, rail: false }]
    if (d.kind === 'rail' && d.rail.vout) return [{ device: d.id, part: d.part, label: `${refOf(c, d.part)} ${d.rail.output}`, p: d.out, n: d.ret, volts: d.rail.vout, blocks: d.rail.reverse === 'blocks', rail: true }]
    return []
  })
}

export function topologyFindings(c: Circuit, cls: Classification): { drafts: Draft[]; shortedRails: Set<string> } {
  const drafts: Draft[] = []
  const shortedRails = new Set<string>()
  const g = lowGraph(c)
  const srcs = sources(c)
  const shorted = new Set<string>()
  for (const s of srcs) {
    if (!g.same(s.p, s.n)) continue
    shorted.add(s.device)
    const via = g.pathParts(s.p, s.n).filter((p) => p !== s.part)
    const through = andList([...via.map((p) => refOf(c, p)), 'wires'])
    if (s.rail) shortedRails.add(s.device)
    drafts.push({
      code: 'sim-short', severity: 'error', parts: [s.part, ...via], inputs: [], key: `sim-short|${s.device}`,
      message: s.rail
        ? `${s.label} output is shorted to its return through ${through}: the regulator is outside its model, so the voltages on it cannot be trusted.`
        : `${s.label} is shorted: its + and - are joined through ${through}. Nothing limits the current, so ${s.label} and the wires can overheat.`,
    })
  }
  // A closed parallel loop (spec 5.2, Astra re-review A): + to + and - to - both through low paths.
  // A rail output that blocks reverse current ORs rather than fights.
  const fighters = srcs.filter((s) => !s.blocks && !shorted.has(s.device))
  for (let i = 0; i < fighters.length; i++)
    for (let j = i + 1; j < fighters.length; j++) {
      const [a, b] = [fighters[i], fighters[j]]
      if (a.part === b.part || !g.same(a.p, b.p) || !g.same(a.n, b.n) || Math.abs(a.volts.value - b.volts.value) <= 0.1) continue
      drafts.push({
        code: 'sim-source-conflict', severity: 'error', parts: [a.part, b.part], inputs: [a.volts, b.volts], key: `sim-source-conflict|${a.device}|${b.device}`,
        message: `${a.label} (${V(a.volts.value)}) and ${b.label} (${V(b.volts.value)}) are wired in parallel, plus to plus and minus to minus: the higher one drives current into the lower one, which can damage both.`,
      })
    }
  // Floating means not defined (driven or held). Ruling R32: only an input wired to something; a spare pin reads nothing.
  for (const gp of c.gpio)
    if (gp.state === 'input' && pinState(c, cls, gp.key) === 'floating' && Object.entries(c.pinNet).some(([k, n]) => k !== gp.key && n === c.pinNet[gp.key]))
      drafts.push({
        code: 'sim-floating-input', severity: 'warning', parts: [gp.part], inputs: [], key: `sim-floating-input|${gp.part}|${gp.pin}`,
        message: `${refOf(c, gp.part)} ${gp.pin} is an input with nothing driving it: it floats, so it reads at random. Wire it to a signal, add a pull-up or pull-down resistor, or set its simulated state to input-pullup or input-pulldown.`,
      })
  const missing = [...new Set(c.unsimulated.filter((u) => u.reason === NO_POWER_DATA).map((u) => u.part))].sort(naturalCompare)
  if (missing.length) {
    const designators = missing.map((uid) => refOf(c, uid))
    drafts.push({
      code: 'sim-incomplete', severity: 'note', parts: missing, inputs: [], key: 'sim-incomplete',
      message: `${plural(missing.length, 'powered part')} ${missing.length === 1 ? 'has' : 'have'} no power data, so ${missing.length === 1 ? 'it is' : 'they are'} not simulated: ${andList(designators)}.`,
    })
  }
  const estimates = new Map<string, Param>()
  for (const p of [...c.devices.flatMap(deviceParams), ...c.limits.map((l) => l.value)]) if (p.basis === 'estimate') estimates.set(p.label, p)
  if (estimates.size)
    drafts.push({
      code: 'sim-estimate', severity: 'note', parts: [...new Set(c.devices.filter((d) => deviceParams(d).some((p) => p.basis === 'estimate')).map((d) => d.part))].sort(naturalCompare),
      inputs: [...estimates.values()], key: 'sim-estimate',
      message: `${plural(estimates.size, 'value')} in this result ${estimates.size === 1 ? 'is an estimate' : 'are estimates'}: ${[...estimates.keys()].join(', ')}.`,
    })
  return { drafts, shortedRails }
}

const ORDER = { error: 0, warning: 1, note: 2 } as const

/** The severity rules of spec 4.5 and 5.2, then one finding per key (typical wins over peak). */
export function finalize(drafts: Draft[], peakNote: string): SimFinding[] {
  const out = new Map<string, SimFinding>()
  for (const d of [...drafts].sort((a, b) => Number(a.corner === 'peak') - Number(b.corner === 'peak'))) {
    if (out.has(d.key)) continue
    const basis = basisOf(d.inputs)
    let severity = d.severity
    let message = d.message
    if (d.corner === 'peak') {
      if (severity === 'error') severity = 'warning'
      message = `At peak${peakNote ? ` (${peakNote})` : ''}: ${message}`
    }
    if (severity === 'error' && (basis === 'representative' || basis === 'estimate')) {
      severity = 'warning'
      const uncertain = d.inputs.filter((p) => p.basis === 'representative' || p.basis === 'estimate').map((p) => p.label)
      message = `Likely: ${message} This is decided on ${basis} values: ${uncertain.join(', ')}.`
    }
    out.set(d.key, {
      code: d.code, severity, parts: d.parts, message, ...(d.corner ? { corner: d.corner } : {}), basis,
      inputs: d.inputs.map((p) => `${p.label}: ${p.basis}`), ...(d.raw ? { raw: d.raw } : {}),
    })
  }
  return [...out.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || naturalCompare(a.parts.join(), b.parts.join()))
}

/**
 * A run ngspice could not solve (spec 5.2): plain words, the parts on the nodes it named (node ids,
 * as Compiled.nodesIn gives them: a net, a pin tap or a device's internal node), its text kept as raw.
 */
export function noConvergence(c: Circuit, error: string, nodes: string[]): SimFinding {
  const named = new Set(nodes)
  const parts = [
    ...new Set([
      ...c.taps.filter((t) => named.has(netNode(t.net)) || named.has(t.node)).map((t) => t.part),
      ...c.devices.filter((d) => deviceNodes(d).some((n) => named.has(n))).map((d) => d.part),
    ]),
  ].sort(naturalCompare)
  return {
    code: 'sim-no-convergence', severity: 'error', parts, basis: 'topology', inputs: [], raw: error,
    message: `The simulator could not solve this circuit; this may be our model, not your circuit.${parts.length ? ` The parts on the nets it could not solve: ${andList(parts.map((p) => refOf(c, p)))}.` : ''}`,
  }
}
