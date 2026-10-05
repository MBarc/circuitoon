// Boards and modules with electrical.sim.power (spec 3.2, 3.3, 4, 4.6, 4.7): each domain's pin and
// return, the board's own draw as a voltage-aware load per domain, its rails (LDO, buck, boost,
// load switch or diode) with the spec's defaults, its GPIO states hanging off the real IO domain
// node, an external source (an AC-DC converter only when powered in the saved state), and USB
// links as two cable conductors between the port nets. Node references are pins or `<usbPin>#vbus`
// / `<usbPin>#gnd` (ruling R5), each tapped like a pin.
import type { Diagram, PartInstance } from '../format/diagram.ts'
import type { ModuleDef } from '../format/module.ts'
import { mainsOf } from '../format/mainsModel.ts'
import { nodeKey } from '../format/netlist.ts'
import { type Draw, type Quantity, type Rail, simOf } from '../format/simModel.ts'
import { gpioState, simOverride } from '../format/simState.ts'
import { DEFAULT_SOURCE, usbLink, usbSides } from '../format/usb.ts'
import { paramValue } from '../format/values.ts'
import type { Builder } from './build.ts'
import { CABLE_OHMS, IQ_DEFAULT, MIN_VOLTS_FRACTION, NO_POWER_DATA, OR_DIODE_VF, PLUG_OHMS, RAIL_DIRECT_OHMS, ROUT_DEFAULT, loadEstimate } from './estimates.ts'
import { schottky } from './ledModels.ts'
import type { Param, ResolvedRail } from './model.ts'

const REQUIRED: Record<Rail['kind'], (keyof Rail)[]> = {
  ldo: ['vout', 'dropout', 'ioutMax'],
  buck: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  boost: ['vout', 'efficiency', 'vinMin', 'vinMax', 'ioutMax'],
  switch: [],
}

/** The required fields a rail lacks (spec 3.2 table) in words, or null. */
export function railProblem(r: Rail): string | null {
  const missing: string[] = REQUIRED[r.kind].filter((k) => r[k] === undefined)
  if (r.kind === 'switch' && r.ron === undefined && r.vf === undefined) missing.push('ron or vf')
  return missing.length ? `rail ${r.id} needs ${missing.join(', ')}` : null
}

/**
 * The pin a USB port's simulation node is on: `<port>#gnd` is the board's ground pin when
 * `sim.usbPorts` names it; else `<port>#vbus` / `<port>#gnd` is a pin of its own, tapped like any
 * other, so the current the port carries is sensed and the part's pin currents sum to 0.
 */
function usbPin(m: ModuleDef, port: string, side: 'vbus' | 'gnd'): string {
  const gnd = simOf(m)?.usbPorts?.[port]?.gnd
  return side === 'gnd' && gnd ? gnd : `${port}#${side}`
}
/** The node a `sim` node reference names on part `uid`: a pin's tap (a USB port's node included). */
function nodeRef(b: Builder, uid: string, m: ModuleDef, ref: string): string | null {
  const usb = /^(.+)#(vbus|gnd)$/.exec(ref)
  return b.tap(uid, usb ? usbPin(m, usb[1], usb[2] as 'vbus' | 'gnd') : ref)
}

export function powerPart(b: Builder, p: PartInstance, m: ModuleDef): void {
  const sim = simOf(m)!
  const power = sim.power!
  const ref = b.ref(p.uid)
  const L = (path: string) => `${m.id}.${ref}.${path}`
  const P = (x: Quantity, path: string): Param => b.param(x, L(path))
  const bad = (power.rails ?? []).map(railProblem).find((x) => x !== null)
  if (bad) return b.skip(p.uid, `incomplete power data: ${bad}`)

  const domains = new Map<string, { pin: string; ret: string; nominal: number }>()
  for (const dom of power.domains) {
    const pin = nodeRef(b, p.uid, m, dom.pin)
    const ret = nodeRef(b, p.uid, m, dom.ret)
    if (!pin || !ret) continue
    domains.set(dom.name, { pin, ret, nominal: dom.nominal })
    b.domain({ part: p.uid, name: dom.name, pin, ret, nominal: dom.nominal })
  }

  // The board's own consumption: a voltage-aware load per domain (spec 4 table), or the category
  // estimate when it states no draw (spec 3.4), on the GPIO domain, else the output of a rail that
  // feeds no other rail, else any rail's output, else the first domain, so an estimate never
  // bypasses the board's regulator. A part that only converts or
  // supplies (rails or a source) draws through its rails' iq; anything else with no draw and no
  // estimate is listed, never a silent 0 A.
  let list: Draw[] = power.draw ?? []
  if (!list.length) {
    const est = loadEstimate(m)
    if (est && !power.domains.length) return b.skip(p.uid, NO_POWER_DATA)
    if (est) {
      const names = power.domains.map((x) => x.name)
      const rails = power.rails ?? []
      const outs = rails.map((r) => r.output)
      const last = outs.filter((o) => !rails.some((r) => r.inputs.some((x) => x.domain === o)))
      const domain = [sim.gpio?.domain, ...last, ...outs].find((x) => x !== undefined && names.includes(x)) ?? names[0]
      list = [{ domain, typical: est.typical, peak: est.peak }]
    } else if (!power.rails?.length && !power.source) b.unsimulated(p.uid, NO_POWER_DATA)
  }
  for (const dr of list) {
    const dn = domains.get(dr.domain)
    if (!dn) continue
    const tOver = simOverride(p, `sim.draw.${dr.domain}.typical`)
    const pOver = simOverride(p, `sim.draw.${dr.domain}.peak`)
    const typical = tOver !== null ? b.user(tOver, L(`draw.${dr.domain}.typical`)) : P(dr.typical, `draw.${dr.domain}.typical`)
    const peak = pOver !== null ? b.user(pOver, L(`draw.${dr.domain}.peak`)) : dr.peak ? P(dr.peak, `draw.${dr.domain}.peak`) : typical
    const minVolts = 'minVolts' in dr && dr.minVolts ? P(dr.minVolts, `draw.${dr.domain}.minVolts`)
      : { value: MIN_VOLTS_FRACTION * dn.nominal, basis: 'estimate' as const, label: L(`draw.${dr.domain}.minVolts`), note: '90 % of the domain nominal (spec 3.2)' }
    b.add({ kind: 'load', id: `${p.uid}.draw.${dr.domain}`, part: p.uid, p: dn.pin, n: dn.ret, domain: dr.domain, typical, peak, ...(dr.peak?.note ? { peakNote: dr.peak.note } : {}), minVolts })
  }

  for (const r of power.rails ?? []) {
    const out = domains.get(r.output)
    const ins = r.inputs.map((x) => ({ ...x, d: domains.get(x.domain) })).filter((x) => {
      if (!x.d) b.note(`${ref}: rail ${r.id}: input domain ${x.domain} is not simulated, so that input is left out`)
      return x.d
    })
    if (!out) b.note(`${ref}: rail ${r.id}: output domain ${r.output} is not simulated, so the rail is left out`)
    else if (!ins.length) b.note(`${ref}: rail ${r.id} has no simulated input, so the rail is left out`)
    if (!out || !ins.length) continue
    const id = `${p.uid}.rail.${r.id}`
    // Ruling R17: one internal input node, a Schottky per diode input, 1 milliohm per direct one.
    const inNode = `${id}#in`
    for (const x of ins) {
      if (x.via === 'diode') b.add({ kind: 'diode', id: `${id}.in.${x.domain}`, part: p.uid, a: x.d!.pin, k: inNode, model: schottky(OR_DIODE_VF.value), role: 'rail-input' })
      else b.add({ kind: 'resistor', id: `${id}.in.${x.domain}`, part: p.uid, a: x.d!.pin, b: inNode, ohms: b.param({ value: RAIL_DIRECT_OHMS, unit: 'ohm', provenance: 'estimate', note: 'direct rail input (ruling R17)' }, L(`rails.${r.id}.input`)), role: 'rail-input' })
    }
    if (r.kind === 'switch') {
      // ponytail: a `ron` switch conducts both ways whatever `reverse` says; add a blocking diode in series when a sheet needs reverse blocking.
      if (r.ron) b.add({ kind: 'resistor', id, part: p.uid, a: inNode, b: out.pin, ohms: P(r.ron, `rails.${r.id}.ron`), role: 'switch-rail' })
      else b.add({ kind: 'diode', id, part: p.uid, a: inNode, k: out.pin, model: schottky(r.vf!.value), role: 'switch-rail' })
      continue
    }
    const opt = (x: Quantity | undefined, key: string): Param | undefined => (x ? P(x, `rails.${r.id}.${key}`) : undefined)
    const rail: ResolvedRail = {
      id: r.id, kind: r.kind, output: r.output, inputs: r.inputs.map((x) => x.domain),
      vout: opt(r.vout, 'vout'), dropout: opt(r.dropout, 'dropout'), ioutMax: opt(r.ioutMax, 'ioutMax'), efficiency: opt(r.efficiency, 'efficiency'),
      vinMin: opt(r.vinMin, 'vinMin'), vinMax: opt(r.vinMax, 'vinMax'),
      iq: P(r.iq ?? IQ_DEFAULT, `rails.${r.id}.iq`), rout: P(r.rout ?? ROUT_DEFAULT, `rails.${r.id}.rout`),
      reverse: r.reverse, offPath: r.offPath ?? 'open',
      ...(r.minLoad ? { minLoad: { amps: P(r.minLoad.amps, `rails.${r.id}.minLoad`), note: r.minLoad.note } } : {}),
    }
    b.add({ kind: 'rail', id, part: p.uid, rail, in: inNode, inRet: ins[0].d!.ret, out: out.pin, ret: out.ret, ctl: `${id}#ctl`, o: `${id}#o`, outDomain: r.output })
  }

  const s = power.source
  const sd = s && domains.get(s.domain)
  let imaxOver: number | null = null
  if (s && sd) {
    // An AC-DC converter is a source only when its mains input is powered in the saved state.
    if (mainsOf(m).acInput && !b.converterPowered(p.uid)) b.note(`${ref}: its mains input is off in the saved switch state, so its output is off`)
    else {
      const rOver = simOverride(p, 'sim.rInternal')
      const iOver = simOverride(p, 'sim.imax')
      imaxOver = iOver
      let volts: Param
      if (s.voltage === 'param:voltage') {
        // As for a battery (Task 10): a voltage that is a part value, with none set, is not simulated.
        const v = paramValue(p, m, 'voltage')
        if (v === null) return b.skip(p.uid, 'no voltage value')
        volts = b.user(v, L('voltage'))
      } else volts = P(s.voltage, 'source.voltage')
      const imax = iOver !== null ? b.user(iOver, L('imax')) : s.imax ? P(s.imax, 'source.imax') : undefined
      const id = `${p.uid}.source`
      b.add({ kind: 'cell', id, part: p.uid, p: sd.pin, n: sd.ret, int: `${id}#int`, volts, rInternal: rOver !== null ? b.user(rOver, L('rInternal')) : P(s.rInternal, 'source.rInternal'), ...(imax ? { imax } : {}), role: 'external', domain: s.domain })
    }
  }

  const g = sim.gpio
  const io = g && domains.get(g.domain)
  if (g && io)
    for (const pin of g.pins) {
      const state = gpioState(p, m, pin)
      b.gpio({ part: p.uid, pin, state, domain: g.domain, key: nodeKey(p.uid, pin) })
      if (state === null) {
        b.unsimulated(p.uid, `pin ${pin}: output-only pin with no state set`)
        continue
      }
      const R = (x: Quantity, key: string) => P(x, `gpio.${key}`)
      const node = b.tap(p.uid, pin)
      // One device per pin whatever its state (gpioBranch picks the resistor). Input leakage is the
      // resistance that leaks that current at the domain's nominal voltage.
      if (node)
        b.add({
          kind: 'gpio', id: `${p.uid}.gpio.${pin}`, part: p.uid, pin, node, vdd: io.pin, ret: io.ret, domain: g.domain, state,
          params: {
            outputResistance: R(g.outputResistance, 'outputResistance'),
            ...(g.pullup ? { pullup: R(g.pullup, 'pullup') } : {}),
            ...(g.pulldown ? { pulldown: R(g.pulldown, 'pulldown') } : {}),
            ...(g.inputLeakage && g.inputLeakage.value > 0 ? { leakage: { ...R(g.inputLeakage, 'inputLeakage'), value: io.nominal / g.inputLeakage.value, note: 'derived: domain nominal / inputLeakage' } } : {}),
          },
        })
    }
  // Spec 3.5, as for a battery: the imax override replaces the module's sourceCurrent limit.
  if (imaxOver === null) return b.partLimits(p, m)
  b.partLimits(p, m, ['sourceCurrent'])
  b.limit({ part: p.uid, of: { part: true }, kind: 'sourceCurrent', value: b.user(imaxOver, L('imax')) })
}

/** Each USB link that carries power: both conductors as cable resistances (spec 4.7). */
export function usbLinks(b: Builder, d: Diagram): void {
  for (const c of [...d.connections].sort((x, y) => (x.uid < y.uid ? -1 : 1))) {
    const link = usbLink(d, c)
    if (!link) continue
    // No clear host and device (two hosts, two devices): usb-role reports it; nothing to compile.
    const sides = usbSides(link.from, link.to)
    if (!sides) continue
    const [host, dev] = sides
    // A device that is not simulated has nothing for the cable to feed.
    if (!b.simulated(dev.part.uid)) continue
    if (host.usb.hub === 'downstream') {
      b.unsimulated(dev.part.uid, 'powered through a hub: not simulated yet')
      continue
    }
    if (!simOf(host.module)?.power) {
      b.unsimulated(dev.part.uid, `powered from ${b.ref(host.part.uid)} over USB, which has no power data`)
      continue
    }
    if (!b.simulated(host.part.uid)) {
      b.unsimulated(dev.part.uid, `powered over USB from ${b.ref(host.part.uid)}, which is not simulated`)
      continue
    }
    const ohms = link.direct ? PLUG_OHMS : CABLE_OHMS
    const label = `${link.direct ? 'plug' : 'cable'}.${c.uid}`
    // The cable is outside both parts: it joins the port nets, so each port's sense carries its current.
    const hv = b.node(host.part.uid, usbPin(host.module, host.name, 'vbus'))
    const dv = b.node(dev.part.uid, usbPin(dev.module, dev.name, 'vbus'))
    const hg = b.node(host.part.uid, usbPin(host.module, host.name, 'gnd'))
    const dg = b.node(dev.part.uid, usbPin(dev.module, dev.name, 'gnd'))
    if (!hv || !dv || !hg || !dg) continue
    const vbus = `usb.${c.uid}.vbus`
    const gnd = `usb.${c.uid}.gnd`
    b.add({ kind: 'resistor', id: vbus, part: host.part.uid, a: hv, b: dv, ohms: b.param(ohms, `${label}.vbus`), role: 'cable' })
    b.add({ kind: 'resistor', id: gnd, part: host.part.uid, a: hg, b: dg, ohms: b.param(ohms, `${label}.gnd`), role: 'cable' })
    const declared = host.usb.source
    const limit: Param = declared !== undefined
      ? { value: declared / 1000, basis: 'datasheet', label: `${host.module.id}.${b.ref(host.part.uid)}.usb.${host.name}.source` }
      : { value: DEFAULT_SOURCE[host.usb.version ?? '2.0'] / 1000, basis: 'representative', label: `usb-default.${host.usb.version ?? '2.0'}`, note: 'the USB default for the port version' }
    b.usbPath({ host: host.part.uid, hostPort: host.name, device: dev.part.uid, devicePort: dev.name, vbus, gnd, limit })
  }
}
