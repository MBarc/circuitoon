// The mains analysis (spec docs/superpowers/specs/2026-09-27-mains-outlets-design.md): builds the
// conduction graph, enumerates every state of each unit's candidate contact groups (up to 16 groups
// and 10 sources per unit; a unit beyond that is not enumerated: the analysis says so and stays
// conservative there, and every other unit is still checked), runs the rules and
// hands the wiring checker and the renderer one shared result: findings, converter availability,
// dead outputs, the hazardous nets the DC rules must skip, and identity for colours. A sheet without
// mains data costs one scan of its parts.
import { type Diagram, moduleOf } from './diagram.ts'
import { plugsOf } from './breadboard.ts'
import { netlist, nodeKey } from './netlist.ts'
import { type Conductor, type MainsInfo, type Region, mainsOf } from './mainsModel.ts'
import { MAX_GROUPS, MAX_SOURCES, type MainsGraph, analyseState, buildMainsGraph, candidateGroups, masksByPopcount, plainPath, prepare, setCandidates, setState, units } from './mainsGraph.ts'
import { type ConverterStatus, type MainsDraft, UNPOWERED, absorb, conservative, mergeUnpolarized, newAcc, staticDrafts, visitState } from './mainsRules.ts'

export interface MainsAnalysis {
  graph: MainsGraph
  /** False when some unit's states were not enumerated (mains-incomplete). */
  complete: boolean
  /** Converter availability by part uid. */
  converters: Map<string, ConverterStatus>
  /** Every node key on a net that is hazardous in some state (every possibly hazardous one in a unit that was not enumerated). */
  hazardKeys: Set<string>
  /**
   * The node keys of hazardKeys that are on mains wiring (L or N identity, or energy that crossed no
   * isolation barrier): the DC rules skip these only. A secondary behind an inadequate barrier is
   * possibly live (rule 1 says so) but keeps its DC checks (final review 1).
   */
  mainsKeys: Set<string>
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

/** How many analyses have run (tests read it to prove a gesture or a redraw starts none). */
export const mainsStats = { runs: 0 }

export function analyseMains(d: Diagram): MainsAnalysis | null {
  if (!hasMainsData(d)) return null
  mainsStats.runs++
  const plugs = plugsOf(d)
  const g = buildMainsGraph(d, plugs, netlist(d, plugs))!
  const p = prepare(g)
  const cands = candidateGroups(g, p.possible)
  const acc = newAcc(p, cands, null)
  // Final review (2): the limits hold per unit (units cannot affect each other; a unit numbers its own
  // sources). In a unit past them no per-state rule runs (rules 1 to 4 among them: no voltage, short or
  // low-voltage finding is claimed there); the static rules see its conservative hazard, and its
  // mains-incomplete finding (rule 13) says the checks did not finish and lists what was not checked.
  for (const unit of units(p, cands)) {
    const over = unit.view.sources.length > MAX_SOURCES ? 'sources' : unit.cands.length > MAX_GROUPS ? 'groups' : null
    const sub = newAcc(unit.view, unit.cands, over)
    if (over) conservative(sub)
    else {
      const masks = masksByPopcount(unit.cands.length)
      setState(unit.view, unit.cands, 0)
      for (let k = 0; k < masks.length; k++) {
        const mask = masks[k]
        if (plainPath.on) setState(unit.view, unit.cands, mask)
        else setCandidates(unit.view, unit.cands, mask)
        analyseState(unit.view)
        visitState(sub, mask)
      }
    }
    absorb(acc, sub)
  }
  const complete = acc.open.length === 0
  // Ruling 37: the uncertain polarity clauses of one unpolarized outlet become its one warning, across units.
  const findings = mergeUnpolarized([...acc.finished, ...staticDrafts(acc)])
  const converters = new Map(g.converters.map((c, i): [string, ConverterStatus] => [c.part.uid, acc.converters[i] ?? UNPOWERED]))
  const deadOutputs = new Map<string, 'unpowered' | 'unknown'>()
  for (const c of g.converters) {
    const st = converters.get(c.part.uid)!
    if (st.state !== 'powered') for (const o of c.outputs) deadOutputs.set(nodeKey(c.part.uid, o), st.state)
  }
  const hazardKeys = new Set<string>()
  const mainsKeys = new Set<string>()
  acc.hazardAny.forEach((h, i) => {
    if (h) for (const k of g.members[i]) hazardKeys.add(k)
    if (acc.mainsAny[i]) for (const k of g.members[i]) mainsKeys.add(k)
  })
  const conductorOf = (key: string) => {
    const i = g.nodeOf.get(key)
    return i === undefined ? null : acc.conductors[i]
  }
  return { graph: g, complete, converters, hazardKeys, mainsKeys, deadOutputs, conductorOf, findings }
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

/** Spec section 6, verbatim. */
export const MAINS_NOTICE = 'Mains wiring: Circuitoon checks the drawn connections only. It cannot check current, insulation, enclosures or local codes. Have mains work checked by a qualified person.'

/**
 * The pins a module declares as mains by nature: a mains domain, an AC input, a mains requirement
 * (L, N, PE, line) or a mains load. Ratings and contacts alone never count: a KCD1 rocker rated for
 * AC switching is just a switch in a battery circuit.
 */
function mainsPins(i: MainsInfo): Set<string> {
  return new Set([
    ...i.domains.filter((x) => x.kind === 'mains').flatMap((x) => x.pins),
    ...(i.acInput ? [i.acInput.a, i.acInput.b] : []),
    ...i.requirement.keys(),
    ...i.conducts.filter((c) => c.kind === 'load').flatMap((c) => c.pins),
  ])
}

/** True when some part's mains pin shares a net with another part's mains terminal. */
function mainsWired(d: Diagram): boolean {
  const info = new Map<string, MainsInfo>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (m && mainsOf(m).any) info.set(p.uid, mainsOf(m))
  }
  const pinsOf = new Map([...info].map(([uid, i]) => [uid, mainsPins(i)]))
  for (const net of netlist(d).nets) {
    const ends = net.map((k) => JSON.parse(k) as [string, string])
    const own = ends.filter(([uid, pin]) => pinsOf.get(uid)?.has(pin))
    if (!own.length) continue
    for (const [uid] of own) if (ends.some(([u, pin]) => u !== uid && info.get(u)?.terminals.has(pin))) return true
  }
  return false
}

const noticeCache = new WeakMap<Diagram['connections'], { parts: Diagram['parts']; modules: Diagram['modules']; result: boolean }>()

/**
 * Spec 6's "mains sheet", which carries the notice (Problems panel, drawing footer, exported notes):
 * one with a mains source or connection point. That is an outlet (an AC source), a plug-in device
 * or cord plug (a plug profile), or a part whose mains pins (mains domain, AC input, requirement,
 * load) are wired to another part's mains terminal. A part that merely carries AC ratings (a KCD1
 * in a battery circuit), or a relay whose contacts switch nothing mains, does not make one. The
 * mains analysis itself still runs on any mains data (`hasMainsData`), so no check is hidden.
 */
export function hasMains(d: Diagram): boolean {
  let wiredOnly = false
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    if (!m) continue
    const i = mainsOf(m)
    if (!i.any) continue
    if (i.acSources.length || (i.plug && i.plug.profiles.length)) return true
    if (mainsPins(i).size) wiredOnly = true
  }
  if (!wiredOnly) return false
  const hit = noticeCache.get(d.connections)
  if (hit && hit.parts === d.parts && hit.modules === d.modules) return hit.result
  const result = mainsWired(d)
  noticeCache.set(d.connections, { parts: d.parts, modules: d.modules, result })
  return result
}

/** The sheet as exported: the notice in `notes` when it has a mains part, out of it otherwise. Same object when nothing changes. */
export function withSheetNotes(d: Diagram): Diagram {
  const notes = d.notes ?? []
  const has = notes.includes(MAINS_NOTICE)
  if (hasMains(d) === has) return d
  const next = has ? notes.filter((n) => n !== MAINS_NOTICE) : [...notes, MAINS_NOTICE]
  const { notes: _old, ...rest } = d
  return next.length ? { ...rest, notes: next } : rest
}
