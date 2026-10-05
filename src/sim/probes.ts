// Probes (spec 6.2): the mapping between a sheet's probes (part uids and pins) and a netlist's (refs
// and net names). Task 25b adds the sheet's editing ops. Pure.
import type { Probe } from '../format/diagram.ts'
import type { Intent, NetlistProbe } from '../agent/netlist.ts'
import { naturalCompare } from '../agent/order.ts'
import { nodeKey } from '../format/netlist.ts'

/** Layout (spec 6.2): netlist probes on the laid-out sheet, whose uids are the refs. net: picks a pin of the part the probe's name starts with, else the lowest ref. */
export function probesForSheet(intent: Intent): Probe[] {
  return intent.probes.map((p): Probe => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    if (p.at.startsWith('net:')) {
      const net = intent.nets.find((n) => n.name === p.at.slice(4))!
      const pins = net.terminals.some((t) => !t.infra) ? net.terminals.filter((t) => !t.infra) : net.terminals
      const named = p.name?.trim().split(/\s+/)[0]
      const pick = pins.find((t) => t.ref === named) ?? [...pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
      return { ...base, at: { part: pick.ref, pin: pick.name } }
    }
    const dot = p.at.indexOf('.')
    return { ...base, at: dot < 0 ? { part: p.at } : { part: p.at.slice(0, dot), pin: p.at.slice(dot + 1) } }
  })
}

/** Extract (spec 6.2): sheet probes in ref form; a pin probe on a part the netlist leaves out becomes net:<its net>; a part probe there is dropped with a warning. */
export function probesForNetlist(probes: Probe[], refOf: Map<string, string>, nets: { name: string; keys: string[] }[], warn?: (m: string) => void): NetlistProbe[] {
  return probes.flatMap((p): NetlistProbe[] => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    const ref = refOf.get(p.at.part)
    if (ref) return [{ ...base, at: p.at.pin ? `${ref}.${p.at.pin}` : ref }]
    const key = p.at.pin !== undefined ? nodeKey(p.at.part, p.at.pin) : null
    const net = key ? nets.find((n) => n.keys.includes(key)) : undefined
    if (net) return [{ ...base, at: `net:${net.name}` }]
    warn?.(`probe ${p.id} sat on a part the netlist leaves out (${p.at.part}), so it was dropped`)
    return []
  })
}
