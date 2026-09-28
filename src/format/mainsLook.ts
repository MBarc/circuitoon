// How mains wiring looks (spec 5): a wire on a mains or earth node defaults to its source region's
// colour for its identity, an energized wire is marked as a hazard, and a new wire drawn from a mains
// terminal starts in its identity's colour (the user can change it). Reads the cached analysis. Pure.
import type { Diagram, Endpoint } from './diagram.ts'
import { nodeKey } from './netlist.ts'
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
  try {
    return analyseMainsCached(d)
  } catch (e) {
    console.error('Circuitoon: the mains analysis failed, so mains wires are drawn without their look.', e)
    return null
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

/** Per wire uid, its mains look; wires off mains are left out (every wire, when the analysis failed). */
export function wireLooks(d: Diagram): Map<string, WireLook> {
  const out = new Map<string, WireLook>()
  const a = analysisForLook(d)
  if (!a) return out
  for (const c of d.connections) {
    const k = nodeKey(c.from.part, c.from.pin)
    const id = a.conductorOf(k) ?? a.conductorOf(nodeKey(c.to.part, c.to.pin))
    const hazard = a.hazardKeys.has(k)
    if (id || hazard) out.set(c.uid, { color: id ? IDENTITY_COLORS[schemeOf(id.region)][id.conductor] : null, hazard })
  }
  return out
}

/** The colour a new wire between two ends starts with: an end's identity colour, else `fallback` (the new-wire style). */
export function newWireColor(d: Diagram, from: Endpoint, to: Endpoint, fallback: string): string {
  return identityColor(d, from) ?? identityColor(d, to) ?? fallback
}

/** Resolution 30: the looks for `d`, or the ones `held` has while `busy` (a gesture is open); refreshes `held` otherwise. */
export function holdLooks(held: { current: Map<string, WireLook> }, d: Diagram, busy: boolean): Map<string, WireLook> {
  if (!busy) held.current = wireLooks(d)
  return held.current
}
