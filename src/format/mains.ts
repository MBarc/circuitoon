// The mains analysis (spec docs/superpowers/specs/2026-09-27-mains-outlets-design.md): builds the
// conduction graph, enumerates every state of each unit's candidate contact groups (up to 16 groups
// and 10 sources on the sheet; beyond that it says so and stays conservative), runs the rules and
// hands the wiring checker and the renderer one shared result: findings, converter availability,
// dead outputs, the hazardous nets the DC rules must skip, and identity for colours. A sheet without
// mains data costs one scan of its parts.
import { type Diagram, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import { type Conductor, type Region, mainsOf } from './mainsModel.ts'
import { MAX_GROUPS, MAX_SOURCES, type MainsGraph, analyseState, buildMainsGraph, candidateGroups, decodeSingle, masksByPopcount, prepare, setState, units } from './mainsGraph.ts'
import { type ConverterStatus, type MainsDraft, UNPOWERED, absorb, conservative, mergeUnpolarized, newAcc, staticDrafts, visitState } from './mainsRules.ts'

export interface MainsAnalysis {
  graph: MainsGraph
  /** False when the states were not all enumerated (mains-incomplete). */
  complete: boolean
  /** Converter availability by part uid. */
  converters: Map<string, ConverterStatus>
  /** Every node key on a net that is hazardous in some state (every possibly hazardous one when incomplete). */
  hazardKeys: Set<string>
  /** Output pin keys of converters that are not powered. */
  deadOutputs: Map<string, 'unpowered' | 'unknown'>
  /** Resolution 19: the one conductor a node key carries in every state that gives it any identity, with its source's region; null otherwise. */
  conductorOf: (key: string) => { conductor: Conductor; region: Region | null } | null
  findings: MainsDraft[]
}

/** True when some part's module declares mains data. */
export function hasMainsData(d: Pick<Diagram, 'parts' | 'modules'>): boolean {
  return d.parts.some((p) => {
    const m = moduleOf(d, p.module)
    return !!m && mainsOf(m).any
  })
}

export function analyseMains(d: Diagram): MainsAnalysis | null {
  if (!hasMainsData(d)) return null
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))!
  const p = prepare(g)
  const cands = candidateGroups(g, p.possible)
  const incomplete = g.sources.length > MAX_SOURCES ? 'sources' : cands.length > MAX_GROUPS ? 'groups' : null
  const acc = newAcc(p, cands, incomplete)
  // On an incomplete sheet no per-state rule runs (rules 1 to 4 among them: no voltage, short or
  // low-voltage finding is claimed); only the static rules run, on the conservative hazard. The
  // mains-incomplete finding (rule 13) says the checks did not finish and lists what was not checked.
  if (incomplete) conservative(acc)
  else
    for (const unit of units(p, cands)) {
      const sub = newAcc(unit.view, unit.cands, null)
      for (const mask of masksByPopcount(unit.cands.length)) {
        setState(unit.view, unit.cands, mask)
        analyseState(unit.view)
        visitState(sub, mask)
      }
      absorb(acc, sub)
    }
  // Ruling 37: the uncertain polarity clauses of one unpolarized outlet become its one warning, across units.
  const findings = mergeUnpolarized(g, [...acc.finished, ...staticDrafts(acc)])
  const converters = new Map(g.converters.map((c, i): [string, ConverterStatus] => [c.part.uid, acc.converters[i] ?? UNPOWERED]))
  const deadOutputs = new Map<string, 'unpowered' | 'unknown'>()
  for (const c of g.converters) {
    const st = converters.get(c.part.uid)!
    if (st.state !== 'powered') for (const o of c.outputs) deadOutputs.set(nodeKey(c.part.uid, o), st.state)
  }
  const hazardKeys = new Set<string>()
  acc.hazardAny.forEach((h, i) => {
    if (h) for (const k of g.members[i]) hazardKeys.add(k)
  })
  const conductorOf = (key: string) => {
    const i = g.nodeOf.get(key)
    const x = i === undefined || incomplete ? 0 : acc.identUnion[i]
    if (!x || (x & (x - 1)) !== 0) return null
    const { s, c } = decodeSingle(x)
    return { conductor: c, region: g.sources[s].region }
  }
  return { graph: g, complete: !incomplete, converters, hazardKeys, deadOutputs, conductorOf, findings }
}

const cache = new WeakMap<Diagram['connections'], { parts: Diagram['parts']; modules: Diagram['modules']; result: MainsAnalysis | null }>()

/** `analyseMains` once per parts, connections and modules: the checker, the canvas and the sheet share it, so one edit enumerates once. */
export function analyseMainsCached(d: Diagram): MainsAnalysis | null {
  const hit = cache.get(d.connections)
  if (hit && hit.parts === d.parts && hit.modules === d.modules) return hit.result
  const result = analyseMains(d)
  cache.set(d.connections, { parts: d.parts, modules: d.modules, result })
  return result
}
