// Probes (spec 6.2): the mapping between a sheet's probes (part uids and pins) and a netlist's (refs
// and net names), and the sheet's probe editing ops (add, remove, rename). Pure.
import type { Diagram, Probe, ProbeAnchor } from '../format/diagram.ts'
import type { Intent, NetlistProbe } from '../agent/netlist.ts'
import { naturalCompare } from '../agent/order.ts'
import { nodeKey } from '../format/netlist.ts'

/** Layout (spec 6.2): netlist probes on the laid-out sheet, whose uids are the refs. net: picks a pin of the part the probe's name starts with, else the lowest ref. */
export function probesForSheet(intent: Intent): Probe[] {
  return intent.probes.flatMap((p): Probe[] => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    if (p.at.startsWith('net:')) {
      const net = intent.nets.find((n) => n.name === p.at.slice(4))
      if (!net?.terminals.length) return [] // parseNetlist already refuses nets of under 2 pins; a hand-built Intent is skipped, not crashed on
      const pins = net.terminals.some((t) => !t.infra) ? net.terminals.filter((t) => !t.infra) : net.terminals
      const named = p.name?.trim().split(/\s+/)[0]
      const pick = pins.find((t) => t.ref === named) ?? [...pins].sort((a, b) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name))[0]
      return [{ ...base, at: { part: pick.ref, pin: pick.name } }]
    }
    const dot = p.at.indexOf('.')
    return [{ ...base, at: dot < 0 ? { part: p.at } : { part: p.at.slice(0, dot), pin: p.at.slice(dot + 1) } }]
  })
}

/** Extract (spec 6.2): sheet probes in ref form; a pin probe on a part the netlist leaves out becomes net:<its net>; a part probe there is dropped with a warning. */
export function probesForNetlist(probes: Probe[], refOf: Map<string, string>, nets: { name: string; keys: string[] }[], warn?: (m: string) => void): NetlistProbe[] {
  return probes.flatMap((p): NetlistProbe[] => {
    const base = { id: p.id, ...(p.name ? { name: p.name } : {}) }
    const ref = refOf.get(p.at.part)
    if (ref) return [{ ...base, at: p.at.pin !== undefined ? `${ref}.${p.at.pin}` : ref }]
    const key = p.at.pin !== undefined ? nodeKey(p.at.part, p.at.pin) : null
    const net = key ? nets.find((n) => n.keys.includes(key)) : undefined
    if (net) return [{ ...base, at: `net:${net.name}` }]
    warn?.(`probe ${p.id} sat on a part the netlist leaves out (${p.at.part}), so it was dropped`)
    return []
  })
}

export function nextProbeId(d: Diagram): string {
  const n = Math.max(0, ...(d.probes ?? []).map((p) => Number(p.id.slice(1))))
  return `P${n + 1}`
}
/** A probe name as saved: trimmed, at most 40 characters; blank is no name. */
const probeName = (name: string | undefined) => name?.trim().slice(0, 40) || undefined
export function addProbe(d: Diagram, at: ProbeAnchor, name?: string): { diagram: Diagram; id: string } {
  const id = nextProbeId(d)
  const clean = probeName(name)
  return { id, diagram: { ...d, probes: [...(d.probes ?? []), { id, ...(clean ? { name: clean } : {}), at }] } }
}
export function removeProbe(d: Diagram, id: string): Diagram {
  const probes = (d.probes ?? []).filter((p) => p.id !== id)
  const { probes: _p, ...rest } = d
  return probes.length ? { ...rest, probes } : rest
}
export function renameProbe(d: Diagram, id: string, name: string): Diagram {
  if (!d.probes?.some((p) => p.id === id)) return d
  const clean = probeName(name)
  return { ...d, probes: (d.probes ?? []).map((p) => (p.id !== id ? p : clean ? { ...p, name: clean } : { id: p.id, at: p.at })) }
}
