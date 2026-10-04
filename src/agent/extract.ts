// A netlist (circuitoon-netlist/1) extracted from any drawn sheet, so a user's hand-drawn sheet can be
// laid out again without copying it by hand (Ruling W1). Parts keep their module, values, settings and mount
// (`on`); nets come from what actually conducts on the sheet: wires, breadboard strips, mounted legs,
// a part's internal joins and net labels. Component pins are listed, then the strips and rails the
// sheet wires each net through, so it lays out again with wires (a leg in a strip alone does not
// list the strip: the layout seats the part itself). Of the pins a part joins
// inside itself, only those with a connection of their own are listed (an ESP32's spare GND 3 is
// not). Net names come from net labels, then roles (GND, and a supply rail such as 5V or 3V3), then
// `<ref>_<pin>`. A sheet laid out from an intent leaves out the boards the layout added for routing
// (local rail strips), since its intent never named them. Pure.
import { type Diagram, type PartInstance, moduleOf } from '../format/diagram.ts'
import { isBoard, isNetLabel, type ModuleDef, moduleSettings } from '../format/module.ts'
import { plugsOf } from '../format/breadboard.ts'
import { netlist, nodeKey } from '../format/netlist.ts'
import { labelName } from '../format/netLabels.ts'
import { nameNets } from '../format/netNames.ts'
import { NETLIST_FORMAT, REF_PATTERN, parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { naturalCompare } from './order.ts'

/** A valid, unique netlist ref for a designator: other characters become `_`, and a leading non-letter gets a `P`. */
function refMaker() {
  const taken = new Set<string>()
  return (designator: string): string => {
    let base = designator.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'P'
    if (!/^[A-Za-z]/.test(base)) base = `P${base}`
    let ref = base
    for (let k = 2; taken.has(ref) || !REF_PATTERN.test(ref); k++) ref = `${base}_${k}`
    taken.add(ref)
    return ref
  }
}

/** A part's setting choices its module offers (an OLED's address, a fuse holder's fuse), or undefined when it stores none. */
function settingsOf(p: PartInstance, m: ModuleDef): Record<string, string> | undefined {
  const offered = moduleSettings(m)
  const kept = Object.entries(p.settings ?? {}).filter(([k, v]) => Object.hasOwn(offered, k) && offered[k].includes(v))
  return kept.length ? Object.fromEntries(kept) : undefined
}

export function extractNetlist(d: Diagram): Record<string, unknown> {
  const modOf = (uid: string) => {
    const p = d.parts.find((x) => x.uid === uid)
    return p ? moduleOf(d, p.module) : undefined
  }
  // A sheet laid out from an intent: boards it never named were added by the layout for routing.
  const intent = d.intent !== undefined ? parseNetlist(d.intent, (id) => moduleOf(d, id) ?? libraryLookup(id)) : null
  // Intent refs are designators (as verify reads them), never uids: a cut and paste gives a part a
  // new uid but keeps its designator. A board that hosts a mounted part stays whatever the intent
  // says, so that part keeps its mount (`on`).
  const intentRefs = intent?.ok ? new Set(intent.intent.parts.map((p) => p.ref)) : null
  const hosts = new Set(d.parts.flatMap((p) => (p.mount && !isNetLabel(moduleOf(d, p.module)) ? [p.mount.board] : [])))
  const kept = d.parts.filter((p) => {
    const m = moduleOf(d, p.module)
    return m && !isNetLabel(m) && !(intentRefs && isBoard(m) && !intentRefs.has(p.designator) && !hosts.has(p.uid))
  })
  const make = refMaker()
  const refOf = new Map(kept.map((p) => [p.uid, make(p.designator || p.uid)]))

  // Nodes with a connection of their own: a wire end, a plugged leg or a net label's pin.
  const direct = new Set<string>()
  for (const c of d.connections) for (const e of [c.from, c.to]) direct.add(nodeKey(e.part, e.pin))
  for (const pl of plugsOf(d)) if (!pl.mechanical) direct.add(nodeKey(pl.part, pl.pin))
  const n = netlist(d)

  type Pin = { ref: string; name: string; m: ModuleDef }
  const nets: { pins: Pin[]; label?: string }[] = []
  for (const keys of n.nets) {
    const pins: Pin[] = []
    const strips: Pin[] = []
    let label: string | undefined
    for (const k of keys) {
      const [uid, name] = JSON.parse(k) as [string, string]
      const m = modOf(uid)
      if (!m) continue
      if (isNetLabel(m)) {
        const lp = d.parts.find((p) => p.uid === uid)!
        const ln = labelName(lp)
        if (ln && (label === undefined || naturalCompare(ln, label) < 0)) label = ln
        continue
      }
      const ref = refOf.get(uid)
      if (ref && isBoard(m) && direct.has(k)) strips.push({ ref, name, m })
      if (!ref || isBoard(m) || !direct.has(k)) continue
      pins.push({ ref, name, m })
    }
    // The strips and rails of kept boards that the sheet wires this net through (a wire end in one of
    // their holes) stay endpoints: they are where the net is shared, so
    // laid out again with wires it still has its distribution point (a power net on BB1's top+ rail),
    // and a net with one component pin keeps its name (Michael's VIN).
    if (!pins.length || pins.length + strips.length < 2) continue
    const order = (a: Pin, b: Pin) => naturalCompare(a.ref, b.ref) || naturalCompare(a.name, b.name)
    nets.push({ pins: [...pins, ...strips].sort(order), ...(label !== undefined ? { label } : {}) })
  }

  const named = nameNets(nets)

  // One color per net when all its wires agree, and the cable ends when every wire has the same both ends.
  const nodeNet = new Map<string, number>()
  nets.forEach((net, i) => net.pins.forEach((p) => nodeNet.set(JSON.stringify([p.ref, p.name]), i)))
  const netOfKey = (k: string) => {
    const at = n.netOf.get(k)
    if (at === undefined) return undefined
    for (const kk of n.nets[at]) {
      const [uid, name] = JSON.parse(kk) as [string, string]
      const ref = refOf.get(uid)
      const i = ref ? nodeNet.get(JSON.stringify([ref, name])) : undefined
      if (i !== undefined) return i
    }
    return undefined
  }
  const colors = new Map<number, Set<string>>()
  const endKinds = new Set<string>()
  let wires = 0
  for (const c of d.connections) {
    const labelEnd = [c.from.part, c.to.part].some((u) => isNetLabel(modOf(u)))
    const i = netOfKey(nodeKey(c.from.part, c.from.pin))
    if (i !== undefined && c.color) colors.set(i, (colors.get(i) ?? new Set<string>()).add(c.color))
    if (labelEnd) continue
    wires++
    endKinds.add(c.ends?.from && c.ends.from === c.ends.to ? c.ends.from : '')
  }
  const color: Record<string, string> = {}
  nets.forEach((_, i) => {
    const set = colors.get(i)
    if (set?.size === 1) color[named[i]!] = [...set][0]
  })
  const ends = wires && endKinds.size === 1 && !endKinds.has('') ? [...endKinds][0] : undefined

  // Embedded parts that are not built in travel with the netlist.
  const custom: Record<string, ModuleDef> = {}
  for (const p of kept) if (!libraryLookup(p.module)) custom[p.module] = moduleOf(d, p.module)!

  const order = nets.map((_, i) => i).sort((a, b) => naturalCompare(named[a]!, named[b]!))
  return {
    format: NETLIST_FORMAT,
    title: d.title.trim() || 'Untitled sheet',
    ...(Object.keys(custom).length ? { modules: custom } : {}),
    parts: kept.map((p) => {
      const board = p.mount?.board
      const on = board !== undefined ? refOf.get(board) : undefined
      const settings = settingsOf(p, moduleOf(d, p.module)!)
      return { ref: refOf.get(p.uid)!, module: p.module, ...(p.values && Object.keys(p.values).length ? { values: p.values } : {}), ...(settings ? { settings } : {}), ...(on ? { on } : {}) }
    }),
    nets: order.map((i) => ({ name: named[i]!, pins: nets[i].pins.map((p) => `${p.ref}.${p.name}`) })),
    ...(Object.keys(color).length || ends ? { wires: { ...(Object.keys(color).length ? { color } : {}), ...(ends ? { ends } : {}) } } : {}),
  }
}
