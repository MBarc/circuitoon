// Simulation findings (spec 5.2). Topological codes are decided from the circuit before solving;
// value codes (added in Task 28) from each solved corner. finalize applies the severity rules: at
// peak every finding is a warning labelled with the peak's note (spec 4.5); an error whose basis is
// representative or estimate is a "likely" warning that lists the uncertain inputs (uncertainty
// decides blocking). Plain words, no SPICE vocabulary. Pure.
import { formatValue } from '../format/values.ts'
import { andList } from '../format/words.ts'
import { naturalCompare } from '../agent/order.ts'
import { NO_POWER_DATA } from './estimates.ts'
import { type Classification, deviceNodes, openSwitchFor, pinState, powered } from './floating.ts'
import { type Circuit, type Corner, type Device, type Param, type ResolvedLimit, netNode } from './model.ts'
import { type Outside, type SimCode, type SimFinding, basisOf } from './results.ts'
import { type RawRun, enableValue } from './spice.ts'

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
    const path = g.pathParts(s.p, s.n)
    const via = path.filter((p) => p !== s.part)
    // A contact or jumper inside the source's own part is named too ("BT1 itself").
    const through = andList([...path.map((p) => (p === s.part ? `${refOf(c, p)} itself` : refOf(c, p))), 'wires'])
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
      // Two outputs of one part are paired only when they are different pins (a 5 V and a 3.3 V output wired together).
      if ((a.part === b.part && a.p === b.p) || !g.same(a.p, b.p) || !g.same(a.n, b.n) || Math.abs(a.volts.value - b.volts.value) <= 0.1) continue
      drafts.push({
        code: 'sim-source-conflict', severity: 'error', parts: [a.part, b.part], inputs: [a.volts, b.volts], key: `sim-source-conflict|${a.device}|${b.device}`,
        message: `${a.label} (${V(a.volts.value)}) and ${b.label} (${V(b.volts.value)}) are wired in parallel, plus to plus and minus to minus: the higher one drives current into the lower one, which can damage both.`,
      })
    }
  // Floating means not defined (driven or held). Ruling R32: only an input wired to something; a spare pin reads nothing.
  // Fix-round ruling: an input sharing a net with a pin of another part that is not (fully) simulated
  // is unknown, not floating; sim-incomplete lists that part. Boards, net labels and connectors are
  // in neither c.parts nor c.unsimulated, so they never hide a floating input.
  const unknown = new Set(c.unsimulated.map((u) => u.part))
  for (const gp of c.gpio) {
    if (gp.state !== 'input' || pinState(c, cls, gp.key) !== 'floating') continue
    const others = Object.entries(c.pinNet).filter(([k, n]) => k !== gp.key && n === c.pinNet[gp.key]).map(([k]) => (JSON.parse(k) as [string, string])[0])
    if (others.length && !others.some((uid) => uid !== gp.part && unknown.has(uid)))
      drafts.push({
        code: 'sim-floating-input', severity: 'warning', parts: [gp.part], inputs: [], key: `sim-floating-input|${gp.part}|${gp.pin}`,
        message: `${refOf(c, gp.part)} ${gp.pin} is an input with nothing driving it: it floats, so it reads at random. Wire it to a signal, add a pull-up or pull-down resistor, or set its simulated state to input-pullup or input-pulldown.`,
      })
  }
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

type Load = Extract<Device, { kind: 'load' }>
type RailDev = Extract<Device, { kind: 'rail' }>
/** A node's net in node form (netNode of a pin tap's net), else the node itself (an internal node). */
const netOfNode = (c: Circuit) => {
  const m = new Map(c.taps.map((t) => [t.node, netNode(t.net)]))
  return (node: string) => m.get(node) ?? node
}

/** The value findings of one solved corner (spec 5.2), and the rails that ran outside their model. */
export function runDrafts(c: Circuit, cls: Classification, raw: RawRun, corner: Corner): { drafts: Draft[]; outside: Set<string> } {
  const drafts: Draft[] = []
  const outside = new Set<string>()
  const add = (d: Omit<Draft, 'corner'>) => void drafts.push({ ...d, corner })
  const solved = (n: string) => Number.isFinite(raw.v[n])
  const v = (n: string) => raw.v[n]
  // Drive is directed reach: a return is never driven, only defined (plan amendment), so a domain is
  // checked when its pin is driven and its return defined, both solved.
  const on = (pin: string, ret: string) => powered(c, cls, pin, ret) && solved(pin) && solved(ret)
  const pinI = (part: string, pin: string) => {
    const i = raw.pins[part]?.[pin]
    return i !== undefined && Number.isFinite(i) ? i : undefined
  }
  const taps = (part: string) => c.taps.filter((t) => t.part === part)
  const netOf = netOfNode(c)
  const ref = (uid: string) => refOf(c, uid)
  const fmt = (x: number, unit: 'A' | 'V' | 'W') => (unit === 'A' ? A(x) : unit === 'V' ? V(x) : W(x))
  const cond = (l: ResolvedLimit) => (l.conditions ? ` (${l.conditions})` : '')
  const delivered = (part: string, domain?: string) => {
    const src = c.devices.find((x) => x.kind === 'cell' && x.part === part && (domain === undefined || x.domain === domain))
    const x = src ? raw.dev[src.id] : undefined
    return x === undefined || !Number.isFinite(x) ? null : { value: Math.abs(x), what: `${ref(part)} delivers ${A(Math.abs(x))}`, unit: 'A' as const }
  }

  const measure = (l: ResolvedLimit): { value: number; what: string; unit: 'A' | 'V' | 'W' } | null => {
    const r = ref(l.part)
    if ('pin' in l.of) {
      const i = pinI(l.part, l.of.pin)
      return i === undefined ? null : { value: Math.abs(i), what: `${r} ${l.of.pin} carries ${A(Math.abs(i))}`, unit: 'A' }
    }
    if ('domain' in l.of) {
      const name = l.of.domain
      const dom = c.domains.find((x) => x.part === l.part && x.name === name)
      if (!dom) return null
      if (l.kind === 'vinMax' || l.kind === 'vinMin') {
        if (!on(dom.pin, dom.ret)) return null
        const x = v(dom.pin) - v(dom.ret)
        return { value: x, what: `${r} ${name} is at ${V(x)}`, unit: 'V' }
      }
      if (l.kind === 'ioTotalCurrent') {
        const sum = c.gpio.filter((g) => g.part === l.part && g.domain === name && (g.state === 'high' || g.state === 'low')).reduce((s, g) => s + Math.abs(pinI(g.part, g.pin) ?? 0), 0)
        return { value: sum, what: `${r}'s GPIO pins on ${name} carry ${A(sum)} in all`, unit: 'A' }
      }
      return delivered(l.part, name)
    }
    if (l.kind === 'power') {
      const p = Math.abs(taps(l.part).reduce((s, t) => s + (solved(t.node) ? v(t.node) : 0) * (pinI(l.part, t.pin) ?? 0), 0))
      return { value: p, what: `${r} dissipates ${W(p)}`, unit: 'W' }
    }
    if (l.kind === 'sourceCurrent') return delivered(l.part)
    if (l.kind === 'vinMax' || l.kind === 'vinMin') return null
    const i = Math.max(0, ...taps(l.part).map((t) => Math.abs(pinI(l.part, t.pin) ?? 0)))
    return { value: i, what: `${r} carries ${A(i)}`, unit: 'A' }
  }

  // Limits: an absolute maximum is sim-over-abs-max; any other rating is sim-over-limit, unless the
  // same subject is over an absolute maximum (then that one says it).
  const subject = (l: ResolvedLimit) => `${l.part}|${JSON.stringify(l.of)}`
  const overAbs = new Set<string>()
  for (const l of c.limits) {
    if (l.kind !== 'absMaxCurrent' && l.kind !== 'vinMax') continue
    const m = measure(l)
    if (!m || m.value <= l.value.value) continue
    overAbs.add(subject(l))
    add({ code: 'sim-over-abs-max', severity: 'error', parts: [l.part], inputs: [l.value], key: `abs|${subject(l)}|${l.kind}`, message: `${m.what}, above its ${fmt(l.value.value, m.unit)} absolute maximum${cond(l)}: damage is likely.` })
  }
  for (const l of c.limits) {
    if (l.kind === 'absMaxCurrent' || l.kind === 'vinMax' || overAbs.has(subject(l))) continue
    const m = measure(l)
    if (!m) continue
    const under = l.kind === 'vinMin'
    if (under ? m.value >= l.value.value : m.value <= l.value.value) continue
    const advice = c.parts[l.part]?.model === 'led' ? ' Add a series resistor, or a larger one, to bring it under the rating.' : ''
    add({ code: 'sim-over-limit', severity: 'warning', parts: [l.part], inputs: [l.value], key: `limit|${subject(l)}|${l.kind}`, message: `${m.what}, ${under ? 'below' : 'above'} its ${fmt(l.value.value, m.unit)} ${under ? 'minimum' : 'rating'}${cond(l)}.${advice}` })
  }
  for (const d of c.devices)
    if (d.kind === 'cell' && d.role === 'external' && d.imax && (raw.dev[d.id] ?? 0) > d.imax.value)
      add({ code: 'sim-over-limit', severity: 'warning', parts: [d.part], inputs: [d.imax], key: `imax|${d.id}`, message: `${ref(d.part)} delivers ${A(raw.dev[d.id])}, above the ${A(d.imax.value)} it can supply.` })
  for (const u of c.usb) {
    // The cable joins the two port nets (net nodes).
    const cable = c.devices.find((x) => x.id === u.vbus)
    if (cable?.kind !== 'resistor' || !cls.driven.has(cable.a) || !solved(cable.a) || !solved(cable.b)) continue
    const i = (v(cable.a) - v(cable.b)) / Math.max(cable.ohms.value, 1e-6)
    if (i > u.limit.value)
      add({ code: 'sim-over-limit', severity: 'warning', parts: [u.host, u.device], inputs: [u.limit], key: `usb|${u.vbus}`, message: `${ref(u.host)} ${u.hostPort} supplies ${A(i)} over USB to ${ref(u.device)}, above the ${A(u.limit.value)} the port gives.` })
  }

  // Rails (spec 4.1, 4.2): outside the model past ioutMax (a shorted output too: the model does not
  // limit it, so its current is huge and its voltages untrusted); dropout; a converter off or at the
  // edge of its enable; minimum load. Checked only while the rail's input is powered. `iout` is what
  // the rail delivers: the 1 mA internal feedback load sits inside the output sense.
  for (const d of c.devices) {
    if (d.kind !== 'rail' || !on(d.in, d.inRet) || !solved(d.out)) continue
    const r = d.rail
    const iout = raw.dev[d.id] ?? 0
    const name = `${ref(d.part)} ${r.output} ${r.kind === 'ldo' ? 'regulator' : r.kind}`
    const outNet = netOf(d.out)
    const loads = c.devices.filter((x): x is Load => x.kind === 'load' && netOf(x.p) === outNet)
    const expecting = c.devices.filter((x) => (x.kind === 'load' && netOf(x.p) === outNet) || ((x.kind === 'resistor' || x.kind === 'diode') && x.role === 'rail-input' && netOf(x.a) === outNet))
    if (r.ioutMax && iout > r.ioutMax.value) {
      outside.add(d.id)
      add({ code: 'sim-outside-model', severity: 'warning', parts: [d.part], inputs: [r.ioutMax], key: `outside|${d.id}`, message: `${name} supplies ${A(iout)}, beyond the ${A(r.ioutMax.value)} its model covers: its voltages, and the readings upstream of it, cannot be trusted.` })
      add({ code: 'sim-over-limit', severity: 'warning', parts: [d.part], inputs: [r.ioutMax], key: `iout|${d.id}`, message: `${name} supplies ${A(iout)}, above its ${A(r.ioutMax.value)} rating.` })
    }
    const vin = v(d.in) - v(d.inRet)
    if (r.kind === 'ldo' && solved(d.ctl)) {
      const vctl = v(d.ctl) - v(d.ret)
      // An output held more than 10 mV above Vctl is backfed by another supply (a DevKit's own LDO
      // behind its 3V3 pin fed from outside): the regulator delivers nothing, so it is not in dropout.
      if (vctl < r.vout!.value - 0.01 && v(d.out) - v(d.ret) <= vctl + 0.01)
        add({ code: 'sim-dropout', severity: 'error', parts: [d.part], inputs: [r.vout!, r.dropout!, ...loads.map((l) => (corner === 'peak' ? l.peak : l.typical))], key: `dropout|${d.id}`, message: `${name} cannot hold ${V(r.vout!.value)}: its input is too low (${V(vin)}), so its output follows it down to about ${V(vctl)}.` })
    }
    let enabled = true
    if (r.kind === 'buck' || r.kind === 'boost') {
      const e = enableValue(vin, r.vinMin!.value, r.vinMax!.value)
      enabled = e >= 0.5
      if (e > 0.01 && e < 0.99) {
        outside.add(d.id)
        add({ code: 'sim-converter-off', severity: 'error', parts: [d.part], inputs: [r.vinMin!, r.vinMax!], key: `edge|${d.id}`, message: `${name}'s input (${V(vin)}) is at the edge of its range; it would cycle on and off, so its output and the readings upstream of it cannot be trusted.` })
      } else if (!enabled && expecting.length) {
        const users = [...new Set(expecting.map((x) => x.part))].filter((p) => p !== d.part)
        add({
          code: 'sim-converter-off', severity: 'error', parts: [d.part, ...users], inputs: [r.vinMin!, r.vinMax!], key: `off|${d.id}`,
          message: `${name} is off: its input (${V(vin)}) is ${vin < r.vinMin!.value ? `below its ${V(r.vinMin!.value)} minimum` : `above its ${V(r.vinMax!.value)} maximum`}, but ${andList(users.map(ref))} ${users.length === 1 ? 'expects' : 'expect'} power from it.`,
        })
      }
    }
    if (r.minLoad && enabled && iout < r.minLoad.amps.value)
      add({ code: 'sim-min-load', severity: 'warning', parts: [d.part], inputs: [r.minLoad.amps], key: `minload|${d.id}`, message: `${name} supplies ${A(iout)}, below the ${A(r.minLoad.amps.value)} it needs to stay on: ${r.minLoad.note}.` })
  }

  // Loads (spec 5.2 sim-brownout).
  // Ruling R30 (spec 5.2 revision 5): a load whose domain is not powered in the current state is a
  // sim-brownout warning with basis topology ("not powered in the current state"), never an error:
  // the checker's "external power assumed" view covers an undrawn supply, so blocking on it would
  // answer the checker's question, not the simulator's (spec 2.1). When an open switch is what
  // separates it from a source (openSwitchFor, with the return so a low-side switch is named too),
  // the message names it. It triggers the same way for an unplugged board and for one behind an open
  // switch with its ground shared, because loads and returns are not DC paths. A board back-powered
  // through another board's GPIO (phantom power) is powered, so a low voltage there is a brownout.
  for (const l of c.devices) {
    if (l.kind !== 'load') continue
    if (!on(l.p, l.n)) {
      if (corner === 'typical') {
        const sw = openSwitchFor(c, l.p, l.n)
        add({
          code: 'sim-brownout', severity: 'warning', parts: sw ? [l.part, sw] : [l.part], inputs: [], key: `unpowered|${l.id}`,
          message: sw
            ? `${ref(l.part)} ${l.domain} is not powered in the current state: ${ref(sw)} is open. Set ${ref(sw)} to its operating position to simulate ${ref(l.part)} running.`
            : `${ref(l.part)} ${l.domain} is not powered in the current state: nothing on the sheet supplies it. Draw its supply (a battery, an adapter, or a computer USB port on its USB socket) to simulate it.`,
        })
      }
      continue
    }
    const x = v(l.p) - v(l.n)
    if (x < l.minVolts.value)
      add({ code: 'sim-brownout', severity: 'error', parts: [l.part], inputs: [corner === 'peak' ? l.peak : l.typical, l.minVolts], key: `brownout|${l.id}`, message: `${ref(l.part)} ${l.domain} is at ${V(x)}, below the ${V(l.minVolts.value)} it needs: it browns out.` })
  }
  return { drafts, outside }
}

/**
 * Spec 4.2: a rail outside its model marks its output and input nets, and every rail, path and
 * source feeding them, transitively. Paths are rail inputs, switch rails, cables, closed contacts,
 * jumpers and fuses (plain resistors are loads, not supply paths). Nets come back as display names,
 * as readings key them; parts are the marked rails', the paths' and the sources'.
 */
export function propagate(c: Circuit, rails: Set<string>): Outside {
  const netOf = netOfNode(c)
  const marked = new Set(rails)
  const nodes = new Set<string>()
  const parts = new Set<string>()
  const railDevs = c.devices.filter((d): d is RailDev => d.kind === 'rail')
  const mark = (d: RailDev) => {
    nodes.add(netOf(d.out)).add(netOf(d.in))
    parts.add(d.part)
  }
  const paths = c.devices.flatMap((d): { part: string; a: string; b: string }[] => {
    if ((d.kind === 'resistor' || d.kind === 'diode') && (d.role === 'rail-input' || d.role === 'switch-rail' || d.role === 'cable')) return [{ part: d.part, a: netOf(d.a), b: netOf(d.kind === 'resistor' ? d.b : d.k) }]
    if ((d.kind === 'resistor' && d.role === 'contact') || (d.kind === 'switch' && d.closed)) return [{ part: d.part, a: netOf(d.a), b: netOf(d.b) }]
    return []
  })
  for (const d of railDevs) if (marked.has(d.id)) mark(d)
  for (let changed = true; changed; ) {
    changed = false
    for (const d of railDevs)
      if (!marked.has(d.id) && nodes.has(netOf(d.out))) {
        marked.add(d.id)
        mark(d)
        changed = true
      }
    for (const p of paths)
      if (nodes.has(p.a) !== nodes.has(p.b)) {
        nodes.add(p.a).add(p.b)
        parts.add(p.part)
        changed = true
      }
  }
  for (const d of c.devices) if (d.kind === 'cell' && nodes.has(netOf(d.p))) parts.add(d.part)
  const NET = netNode('')
  const nets = new Set([...nodes].filter((n) => n.startsWith(NET)).map((n) => n.slice(NET.length)))
  return { nets, parts, rails: marked }
}

/** Every finding of a solve, and what is outside the model (spec 4.1, 4.2, 4.5, 5.2). */
export function analyseFindings(c: Circuit, cls: Classification, raws: Record<Corner, RawRun>): { findings: SimFinding[]; outside: Outside } {
  const topo = topologyFindings(c, cls)
  const typical = runDrafts(c, cls, raws.typical, 'typical')
  const peak = runDrafts(c, cls, raws.peak, 'peak')
  const outside = propagate(c, new Set([...topo.shortedRails, ...typical.outside, ...peak.outside]))
  const peakNote = [...new Set(c.devices.flatMap((d) => (d.kind === 'load' && d.peakNote ? [d.peakNote] : [])))].join(', ')
  return { findings: finalize([...topo.drafts, ...typical.drafts, ...peak.drafts], peakNote), outside }
}
