// How wiring looks (spec 5): a wire on a mains or earth node defaults to its source region's
// colour for its identity, an energized wire is marked as a hazard, and a new wire drawn from a mains
// terminal starts in its identity's colour (the user can change it). Low-voltage wires follow the
// colour convention the same way: a wire with no stored colour on a ground net is drawn black, on a
// positive supply red, and a new wire from such a net starts in that colour. Reads the cached
// analyses. Pure.
import type { Diagram, Endpoint } from './diagram.ts'
import { nodeKey } from './netlist.ts'
import { ROLE_COLORS, endpointRole, netRoles } from './checks.ts'
import { type MainsAnalysis, analyseMainsCached } from './mains.ts'
import type { Conductor, Region } from './mainsModel.ts'

export const IDENTITY_COLORS: Record<'us' | 'iec', Record<Conductor, string>> = {
  us: { L: 'black', N: 'white', PE: 'green' },
  iec: { L: 'brown', N: 'blue', PE: 'green-yellow' },
}

/** US and Japan wire L black, N white, PE green; Europe, the UK and AU/NZ use the IEC colours. */
export const schemeOf = (region: Region | null): 'us' | 'iec' => (region === 'us' || region === 'jp' ? 'us' : 'iec')

/**
 * The cached analysis for the renderer, or null when it fails (final review 3): the canvas draws on
 * every edit, so a checker bug must cost the mains look, never the editor. The error is logged.
 */
function analysisForLook(d: Diagram): MainsAnalysis | null {
  return lookAnalysis(d).analysis
}
/** The analysis, and whether it failed (then no wire gets a role colour either: mains nets cannot be told apart). */
function lookAnalysis(d: Diagram): { analysis: MainsAnalysis | null; failed: boolean } {
  try {
    return { analysis: analyseMainsCached(d), failed: false }
  } catch (e) {
    console.error('Circuitoon: the mains analysis failed, so mains wires are drawn without their look.', e)
    return { analysis: null, failed: true }
  }
}

/** The colour of the one conductor at a terminal, or null (off mains, several conductors, or the analysis failed). */
export function identityColor(d: Diagram, ep: Endpoint): string | null {
  const c = analysisForLook(d)?.conductorOf(nodeKey(ep.part, ep.pin))
  return c ? IDENTITY_COLORS[schemeOf(c.region)][c.conductor] : null
}

export interface WireLook {
  /** The identity colour, used when the wire stores none. */
  color: string | null
  /** The wire is on a node that is hazardous in some state. */
  hazard: boolean
}

/**
 * The low-voltage colour role of a wire end's net as a colour (ground black, supply red), or null
 * for a signal, a net off the convention, or when the analysis failed (logged, like the mains look).
 */
export function roleColor(d: Diagram, ep: Endpoint): string | null {
  try {
    const role = endpointRole(d, ep)
    return role ? ROLE_COLORS[role] : null
  } catch (e) {
    console.error('Circuitoon: the net roles failed, so wires are drawn without their role colours.', e)
    return null
  }
}

/**
 * Per wire uid, its look; wires with nothing to show are left out. A mains wire has its identity
 * and hazard (none when the analysis failed). A low-voltage wire with no stored colour on a ground
 * or supply net gets that role's colour; a wire that stores a colour is drawn in it, so it needs none.
 */
export function wireLooks(d: Diagram): Map<string, WireLook> {
  const out = new Map<string, WireLook>()
  const { analysis: a, failed } = lookAnalysis(d)
  if (failed) return out
  if (a)
    for (const c of d.connections) {
      const k = nodeKey(c.from.part, c.from.pin)
      const id = a.conductorOf(k) ?? a.conductorOf(nodeKey(c.to.part, c.to.pin))
      const hazard = a.hazardKeys.has(k)
      if (id || hazard) out.set(c.uid, { color: id ? IDENTITY_COLORS[schemeOf(id.region)][id.conductor] : null, hazard })
    }
  const plain = d.connections.filter((c) => c.color === undefined && !out.get(c.uid)?.color)
  if (!plain.length) return out
  let roles: ReturnType<typeof netRoles>
  try {
    roles = netRoles(d)
  } catch (e) {
    console.error('Circuitoon: the net roles failed, so wires are drawn without their role colours.', e)
    return out
  }
  for (const c of plain) {
    const role = roles.roleOfKey(nodeKey(c.from.part, c.from.pin))
    const color = role ? ROLE_COLORS[role] : null
    if (color) out.set(c.uid, { color, hazard: out.get(c.uid)?.hazard ?? false })
  }
  return out
}

/**
 * The colour name a wire is drawn in: its stored colour, else its look (mains identity or role
 * colour), else the default, black. The sheet, the canvas and the bill of materials all use it.
 */
export function drawnColor(c: { uid: string; color?: string }, looks: ReadonlyMap<string, { color: string | null }>): string {
  return c.color ?? looks.get(c.uid)?.color ?? 'black'
}

/** The colour a wire drawn from `ep` shows while it is dragged: its identity or role colour, else `fallback`. */
export function startColor(d: Diagram, ep: Endpoint, fallback: string): string {
  return identityColor(d, ep) ?? roleColor(d, ep) ?? fallback
}

/**
 * The colour a new wire between two ends starts with: an end's mains identity colour, else the
 * colour of an end's low-voltage role (a ground net black, a positive supply red; the start end
 * first), else `fallback` (the new-wire style).
 */
export function newWireColor(d: Diagram, from: Endpoint, to: Endpoint, fallback: string): string {
  return identityColor(d, from) ?? identityColor(d, to) ?? roleColor(d, from) ?? roleColor(d, to) ?? fallback
}

/** Resolution 30: the looks for `d`, or the ones `held` has while `busy` (a gesture is open); refreshes `held` otherwise. */
export function holdLooks(held: { current: Map<string, WireLook> }, d: Diagram, busy: boolean): Map<string, WireLook> {
  if (!busy) held.current = wireLooks(d)
  return held.current
}
