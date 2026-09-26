// Broken connections for the editor's notice: every wire the netlist leaves out because an end
// names a missing part, pin, group or hole. A connection with neither end resolving has nothing
// to draw on the sheet, so this list is how the user still finds, selects and deletes it.
import { useMemo } from 'react'
import { type Connection, type Diagram, type Endpoint, moduleOf, resolveEndpoint } from '../format/diagram.ts'
import { isSpacer } from '../format/module.ts'

export interface BrokenConnection {
  uid: string
  /** The wire's label, or its two ends ("R1 Anode to BB1 c2-top hole 9"). */
  name: string
  /** The ends that do not resolve, named the same way. */
  missing: string[]
}

/** A wire end as the user reads it: the part's designator (its uid when missing), the pin label or name, and the hole or bus offset. */
export function endpointName(d: Diagram, ep: Endpoint): string {
  const part = d.parts.find((p) => p.uid === ep.part)
  const m = part && moduleOf(d, part.module)
  const pin = m?.pins.find((p) => !isSpacer(p) && p.name === ep.pin)
  const label = pin && !isSpacer(pin) ? (pin.label ?? pin.name) : ep.pin
  const at = ep.hole !== undefined ? ` hole ${ep.hole}` : ep.offset !== undefined ? `[${ep.offset}]` : ''
  return `${part?.designator ?? ep.part} ${label}${at}`
}

/** The same test the netlist applies: a wire conducts only when both ends resolve. */
const broken = (d: Diagram, c: Connection): Endpoint[] => [c.from, c.to].filter((ep) => !resolveEndpoint(d, ep))

/** Every connection in `netlist(d).broken`, in file order, named for the notice. */
export function brokenConnections(d: Diagram): BrokenConnection[] {
  const out: BrokenConnection[] = []
  for (const c of d.connections) {
    const ends = broken(d, c)
    if (!ends.length) continue
    out.push({ uid: c.uid, name: c.label || `${endpointName(d, c.from)} to ${endpointName(d, c.to)}`, missing: ends.map((ep) => endpointName(d, ep)) })
  }
  return out
}

/**
 * `brokenConnections`, rebuilt only when the connections, the modules, or which parts exist (and
 * their modules) change. Whether an end resolves does not depend on positions or mounts, so a
 * drag, which replaces the parts every frame, reuses the list.
 */
export function useBrokenConnections(d: Diagram): BrokenConnection[] {
  const partsKey = d.parts.map((p) => JSON.stringify([p.uid, p.module, p.designator])).join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => brokenConnections(d), [d.connections, d.modules, partsKey])
}
