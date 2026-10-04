// KiCad netlist export (PRD "KiCad netlist export"): a sheet, or a netlist (circuitoon-netlist/1),
// written as a KiCad .net file (the S-expression netlist Eeschema writes, version "E", KiCad 7 to 9)
// for Pcbnew's File > Import > Netlist. Every part becomes a component with a footprint from its
// module's `kicad` mapping; nets come from what conducts on the sheet (wires, breadboard strips and
// rails, internal joins, net labels), named from net labels, then roles (GND, 5V, 3V3), then a pin.
// Breadboards, rail strips and net labels have no PCB meaning and are left out: a join through a
// strip becomes a direct join between the component pins. A part without a mapping still comes in,
// on a generic pin header with a pad per pin, and a warning says so. Pure; the caller passes the
// library so a sheet saved before the library had a part's mapping still exports with it.
import { type Diagram, moduleOf } from './diagram.ts'
import { type HoleGroup, type KicadDef, type ModuleDef, type PinDef, type PinType, isBoard, isCustom, isNetLabel, isSpacer } from './module.ts'
import { netlist } from './netlist.ts'
import { plugsOf } from './breadboard.ts'
import { labelName } from './netLabels.ts'
import { partValue } from './values.ts'
import { type NamedPin, nameNets } from './netNames.ts'

export type ModuleLibrary = (id: string) => ModuleDef | undefined

export interface KicadOptions {
  /** The built-in parts: a stored copy without a mapping (or an older one) takes the library's when its pins are the same. */
  library?: ModuleLibrary
  /** The file the netlist came from, for the design header. */
  source?: string
}

/** A part as the export sees it, from a sheet or a netlist. */
export interface KicadPart {
  /** The part's key in `nets` (a sheet part's uid, a netlist ref). */
  key: string
  designator: string
  module: ModuleDef
  values?: Record<string, unknown>
}
/** A net as the export sees it: its nodes (part key and pin or hole group name) and the name it was given, if any. */
export interface KicadNet {
  nodes: [string, string][]
  name?: string
}
export interface KicadSource {
  title: string
  parts: KicadPart[]
  nets: KicadNet[]
}

export interface KicadExport {
  /** The .net file. */
  text: string
  /** What needs attention in KiCad, one sentence each: unmapped parts, placeholder footprints, pins with no pad. */
  warnings: string[]
  /** Components written (a part with several headers counts once per header). */
  components: number
  nets: number
  /** Parts on a generic header because their module has no KiCad mapping. */
  unmapped: { ref: string; module: string }[]
  /** Parts whose footprint is a stand-in (a terminal block for an outlet). */
  placeholders: { ref: string; module: string }[]
  /** What to know about a mapped part's footprint ("each header is its own socket strip"), with the parts it is about. */
  notes: string[]
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const natural = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)

/** A string as a KiCad S-expression atom: always quoted, with `\` and `"` escaped and line breaks as `\n`. */
export const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`

/** A reference KiCad takes: letters, digits and `_`, starting with a letter ("R1", "DS1", "U2_2"). */
export function kicadRef(designator: string): string {
  const base = designator.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'X'
  return /^[A-Za-z]/.test(base) ? base : `X${base}`
}

/** A net name KiCad takes: letters, digits and `_ + - . ( )`, anything else (spaces, `/`, `~`) as `_`. */
export const kicadNetName = (name: string): string => name.trim().replace(/[^A-Za-z0-9_+\-.()]/g, '_') || 'N'

const PREFIX: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p']]
/** A number the way KiCad values read: 330, 4.7k, 100n, 10u (3 significant digits, ASCII prefixes). */
export function siValue(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  let i = PREFIX.findIndex(([f]) => abs >= f * 0.9995)
  if (i < 0) i = PREFIX.length - 1
  let n = Number((v / PREFIX[i][0]).toPrecision(3))
  // 999.9k rounds to 1000k: one prefix up.
  if (Math.abs(n) >= 1000 && i > 0) {
    i--
    n = Number((v / PREFIX[i][0]).toPrecision(3))
  }
  return `${n}${PREFIX[i][1]}`
}

/** The module's name up to the first " (": "ESP32 DevKit V1 (30 pin, DOIT)" is "ESP32 DevKit V1". */
const shortName = (m: ModuleDef): string => m.name.split(' (')[0]

/** The KiCad value: a resistance or capacitance (330, 100n), else the mapping's value, else the part's short name. */
export function kicadValue(part: { values?: Record<string, unknown> }, m: ModuleDef, k?: KicadDef): string {
  const v = partValue(part, m)
  if (v && (v.name === 'resistance' || v.name === 'capacitance')) return siValue(v.value)
  return (k?.value ?? shortName(m)).replace(/\s+/g, ' ').trim()
}

/** Pin names with their sides, then hole group names, in order: what a mapping by name relies on. */
const terminalKey = (m: ModuleDef): string =>
  // USB ports are left out: they come in as USB connectors of their own, never on the mapping (a copy
  // saved before the library added them still names the same header pins).
  JSON.stringify([m.pins.filter((p): p is PinDef => !isSpacer(p) && p.type !== 'usb').map((p) => [p.name, p.side]), (m.holes ?? []).map((g) => g.name)])

/**
 * The mapping to export a part with: the library's, when the part is built in and its stored copy
 * has the same pins in the same order (the mapping is export data the library refines, and a copy
 * saved before the library had it, or with older pin data, still names the same pins); else the
 * stored copy's own. `stale` is set when the library has a mapping the copy cannot use because its
 * pins changed.
 */
export function mappingOf(stored: ModuleDef, library?: ModuleLibrary): { kicad?: KicadDef; stale?: true } {
  // A custom part (the part maker, or an imported file) is unverified, its mapping too: the generic header.
  if (isCustom(stored)) return {}
  const lib = library?.(stored.id)
  if (lib?.kicad) {
    if (lib === stored || terminalKey(stored) === terminalKey(lib)) return { kicad: lib.kicad }
    if (!stored.kicad) return { stale: true }
  }
  return stored.kicad ? { kicad: stored.kicad } : {}
}

/** Breadboards, rail strips and net labels: no PCB meaning. A board with a mapping (an outlet) is a real part. */
const isInfrastructure = (m: ModuleDef, k?: KicadDef) => isNetLabel(m) || (isBoard(m) && !k)

/** A sheet as the export sees it: its parts and its nets, from what conducts on it. */
export function sheetSource(d: Diagram): KicadSource {
  const parts: KicadPart[] = d.parts.flatMap((p) => {
    const m = moduleOf(d, p.module)
    return m ? [{ key: p.uid, designator: p.designator, module: m, ...(p.values ? { values: p.values } : {}) }] : []
  })
  const byUid = new Map(d.parts.map((p) => [p.uid, p]))
  const nets: KicadNet[] = netlist(d, plugsOf(d)).nets.map((keys) => {
    const nodes = keys.map((k) => JSON.parse(k) as [string, string])
    // A net label names its net; of several, the first in natural order.
    const labels = nodes.flatMap(([uid]) => {
      const p = byUid.get(uid)
      const m = p && moduleOf(d, p.module)
      return p && isNetLabel(m) && labelName(p) ? [labelName(p)] : []
    }).sort(natural)
    return { nodes, ...(labels.length ? { name: labels[0] } : {}) }
  })
  return { title: d.title, parts, nets }
}

/** The intent of a parsed netlist as the export sees it: its nets joined where a part joins pins inside itself. */
export function intentSource(intent: { title: string; parts: { ref: string; module: string; values?: Record<string, unknown> }[]; nets: { name: string; terminals: { ref: string; name: string }[] }[]; modules: Record<string, ModuleDef> }): KicadSource {
  const parts: KicadPart[] = intent.parts.flatMap((p) => {
    const m = Object.hasOwn(intent.modules, p.module) ? intent.modules[p.module] : undefined
    return m ? [{ key: p.ref, designator: p.ref, module: m, ...(p.values ? { values: p.values } : {}) }] : []
  })
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(k, r)
    return r
  }
  const add = (k: string) => void (parent.has(k) || parent.set(k, k))
  const join = (a: string, b: string) => {
    add(a)
    add(b)
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }
  const key = (ref: string, name: string) => JSON.stringify([ref, name])
  const nameOf = new Map<string, string>()
  for (const net of intent.nets) {
    const keys = net.terminals.map((t) => key(t.ref, t.name))
    keys.forEach((k) => add(k))
    for (let i = 1; i < keys.length; i++) join(keys[0], keys[i])
    if (keys.length && !nameOf.has(keys[0])) nameOf.set(keys[0], net.name)
  }
  for (const p of parts)
    for (const g of p.module.internal ?? []) if (g.some((n) => parent.has(key(p.key, n)))) for (let i = 1; i < g.length; i++) join(key(p.key, g[0]), key(p.key, g[i]))
  const groups = new Map<string, string[]>()
  for (const k of parent.keys()) {
    const r = find(k)
    groups.set(r, [...(groups.get(r) ?? []), k])
  }
  const nets: KicadNet[] = [...groups.values()].map((keys) => {
    const names = keys.flatMap((k) => (nameOf.has(k) ? [nameOf.get(k)!] : [])).sort(natural)
    return { nodes: keys.sort().map((k) => JSON.parse(k) as [string, string]), ...(names.length ? { name: names[0] } : {}) }
  })
  return { title: intent.title, parts, nets }
}

/** KiCad's electrical pin type for a Circuitoon pin type. */
const PIN_TYPE: Record<PinType, string> = {
  power_in: 'power_in', power_out: 'power_out', ground: 'power_in', input: 'input', output: 'output', io: 'bidirectional', passive: 'passive', nc: 'no_connect', usb: 'passive',
}

/** Every pin and pad group of a module, in order: pins (no spacers), then hole groups. */
function terminalsOf(m: ModuleDef): (PinDef | HoleGroup)[] {
  return [...m.pins.filter((p): p is PinDef => !isSpacer(p)), ...(m.holes ?? [])]
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** The generic footprint an unmapped part comes in on: a 0.1 in pin header with a pad per pin. */
export function genericFootprint(pins: number): string {
  if (pins <= 40) return `Connector_PinHeader_2.54mm:PinHeader_1x${pad2(Math.max(1, pins))}_P2.54mm_Vertical`
  return `Connector_PinHeader_2.54mm:PinHeader_2x${pad2(Math.min(40, Math.ceil(pins / 2)))}_P2.54mm_Vertical`
}

/**
 * A stable UUID from a string (a part's uid, plus the header): the same part keeps its UUID from
 * export to export, so Pcbnew can link footprints by it. Four 32-bit FNV-style hashes, shaped as
 * a version 8 (custom) UUID.
 */
export function stableUuid(seed: string): string {
  const h = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  const mul = [0x01000193, 0x5bd1e995, 0x27d4eb2d, 0x165667b1]
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    for (let j = 0; j < 4; j++) h[j] = Math.imul(h[j] ^ c, mul[j])
  }
  for (let j = 0; j < 4; j++) {
    let x = h[j] ^ h[(j + 1) % 4]
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
    h[j] = x ^ (x >>> 16)
  }
  const hex = h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

interface Comp {
  ref: string
  value: string
  footprint: string
  lib: string
  part: string
  description: string
  uuid: string
  module: string
  /** Pad number to its pin names and KiCad pin type, in pad order. */
  pads: Map<string, { names: string[]; type: string }>
}

/** Writes a sheet as a KiCad netlist. */
export function toKicadNetlist(d: Diagram, opts: KicadOptions = {}): KicadExport {
  return writeKicad(sheetSource(d), opts)
}

/** Writes an export source (a sheet's or a netlist's) as a KiCad netlist. */
export function writeKicad(src: KicadSource, opts: KicadOptions = {}): KicadExport {
  const warnings: string[] = []
  const unmapped: KicadExport['unmapped'] = []
  const placeholders: KicadExport['placeholders'] = []
  /** Each mapping note, with the parts it is about. */
  const noteRefs = new Map<string, string[]>()
  const taken = new Set<string>()
  const claimRef = (base: string): string => {
    let ref = base
    for (let k = 2; taken.has(ref); k++) ref = `${base}_${k}`
    taken.add(ref)
    return ref
  }

  // Parts in designator order, so references and the file are stable.
  const kept = src.parts
    .map((p) => ({ p, map: mappingOf(p.module, opts.library) }))
    .filter(({ p, map }) => !isInfrastructure(p.module, map.kicad))
    .sort((a, b) => natural(a.p.designator, b.p.designator) || natural(a.p.key, b.p.key))
  const comps: Comp[] = []
  /** Part key and pin name to the component and pad it lands on. */
  const padOf = new Map<string, { comp: Comp; pad: string }>()
  /** Part key to its reference (a part's own, before any header letter), for naming nets. */
  const partRef = new Map<string, string>()
  const modOf = new Map(kept.map(({ p }) => [p.key, p.module]))

  for (const { p, map } of kept) {
    const m = p.module
    const ref = claimRef(kicadRef(p.designator || p.key))
    partRef.set(p.key, ref)
    const k = map.kicad
    const value = kicadValue(p, m, k)
    const terms = new Map(terminalsOf(m).map((t) => [t.name, t]))
    const typeOf = (name: string) => {
      const t = terms.get(name)
      return t ? PIN_TYPE[t.type ?? ('side' in t ? 'io' : 'passive')] : 'passive'
    }
    const describe = (extra?: string) => `${m.name}${extra ? `, ${extra}` : ''} (Circuitoon part ${m.id})`
    const make = (cref: string, footprint: string, pins: Record<string, string>, lib: string, part: string, description: string, seed: string): Comp => {
      const pads = new Map<string, { names: string[]; type: string }>()
      for (const [name, pad] of Object.entries(pins)) {
        const entry = pads.get(pad)
        if (entry) entry.names.push(name)
        else pads.set(pad, { names: [name], type: typeOf(name) })
      }
      const c: Comp = { ref: cref, value, footprint, lib, part, description, uuid: stableUuid(seed), module: m.id, pads: new Map([...pads].sort((a, b) => natural(a[0], b[0]))) }
      for (const [name, pad] of Object.entries(pins)) padOf.set(JSON.stringify([p.key, name]), { comp: c, pad })
      comps.push(c)
      return c
    }
    const [symLib, symPart] = k?.symbol ? k.symbol.split(':') : ['Circuitoon', m.id]
    if (!k) {
      const names = terminalsOf(m).map((t) => t.name)
      const pins = Object.fromEntries(names.map((n, i) => [n, String(i + 1)]))
      const fp = genericFootprint(names.length)
      make(ref, fp, pins, 'Circuitoon', m.id, describe(), p.key)
      unmapped.push({ ref, module: m.id })
      warnings.push(isCustom(m)
        ? `${ref} (${m.id}): a custom part, unverified, so it comes in on a generic ${fp.split(':')[1]} with a pad per pin in Circuitoon's order. Choose its real footprint in KiCad.`
        : map.stale
        ? `${ref} (${m.id}): its pins differ from the library's part, so the library's KiCad footprint does not fit it; it comes in on a generic ${fp.split(':')[1]}. Place the part again, or choose its footprint in KiCad.`
        : `${ref} (${m.id}): no KiCad footprint is known for this part, so it comes in on a generic ${fp.split(':')[1]} with a pad per pin in Circuitoon's order. Choose its real footprint in KiCad.`)
      continue
    }
    if (k.headers) {
      k.headers.forEach((h, i) => {
        // U1A, U1B; after a reference that ends in a letter, Front_Display_A.
        const letter = String.fromCharCode(65 + (i % 26))
        const cref = claimRef(/\d$/.test(ref) ? `${ref}${letter}` : `${ref}_${letter}`)
        const n = new Set(Object.values(h.pins)).size
        make(cref, h.footprint, h.pins, 'Connector_Generic', `Conn_01x${pad2(n)}`, describe(h.name), `${p.key}#${i}`)
      })
      // The part's own reference stays reserved, so no other part takes it.
    } else {
      const pins = k.pins ?? Object.fromEntries(terminalsOf(m).map((t) => [t.name, t.name]))
      make(ref, k.footprint!, pins, symLib, symPart, describe(), p.key)
    }
    if (k.placeholder) {
      placeholders.push({ ref, module: m.id })
      warnings.push(`${ref} (${m.id}): ${k.note ?? 'the footprint is a placeholder, not the part\'s own.'}`)
    } else if (k.note) noteRefs.set(k.note, [...(noteRefs.get(k.note) ?? []), ref])
  }
  const notes = [...noteRefs].map(([note, refs]) => `${refs.join(', ')}: ${note}`)

  // Nets: each source net's component pins, on the pads they land on; infrastructure drops out.
  const built: { nodes: { comp: Comp; pad: string }[]; label?: string; pins: NamedPin[] }[] = []
  for (const net of src.nets) {
    const nodes: { comp: Comp; pad: string }[] = []
    const pins: NamedPin[] = []
    const seen = new Set<string>()
    for (const [key, pin] of net.nodes) {
      const m = modOf.get(key)
      if (!m) continue
      const at = padOf.get(JSON.stringify([key, pin]))
      if (!at) {
        // An internal node (a plug's prong) is no pin; a real pin without a pad is worth a warning.
        if (terminalsOf(m).some((t) => t.name === pin)) warnings.push(`${partRef.get(key)} ${pin} (${m.id}) has no pad on its KiCad footprint, so it is left out of its net.`)
        continue
      }
      pins.push({ ref: partRef.get(key)!, name: pin, m })
      const id = `${at.comp.ref}\u0000${at.pad}`
      if (seen.has(id)) continue
      seen.add(id)
      nodes.push(at)
    }
    // An unnamed net is left out only when it joins nothing on the board: a single pad, or pads of one
    // footprint that the part joins inside itself (a tactile switch's leg pair, a terminal block's
    // wire and board sides). Two pads of one part that the part does not join (a jumper across a
    // terminal block) and pads on two footprints of one part (an ESP32's left and right strips) are
    // real traces.
    const footprints = new Set(nodes.map((n) => n.comp))
    const names = [...new Set(pins.map((p) => p.name))]
    const internalOnly = footprints.size === 1 && (pins[0]?.m.internal ?? []).some((g) => names.every((n) => g.includes(n)))
    if (!nodes.length || (net.name === undefined && (nodes.length < 2 || internalOnly))) continue
    pins.sort((a, b) => natural(a.ref, b.ref) || natural(a.name, b.name))
    built.push({ nodes, pins, ...(net.name !== undefined ? { label: net.name } : {}) })
  }
  const rawNames = nameNets(built)
  const used = new Set<string>()
  const names = rawNames.map((n) => {
    const base = kicadNetName(n)
    let name = base
    for (let k = 2; used.has(name); k++) name = `${base}_${k}`
    used.add(name)
    return name
  })
  const order = built.map((_, i) => i).sort((a, b) => natural(names[a], names[b]))

  // The file.
  const out: string[] = []
  out.push('(export (version "E")')
  out.push('  (design')
  out.push(`    (source ${quote(opts.source ?? `${src.title || 'Untitled sheet'}.circuitoon.json`)})`)
  out.push('    (tool "Circuitoon"))')
  out.push('  (components')
  for (const c of comps) {
    out.push(`    (comp (ref ${quote(c.ref)})`)
    out.push(`      (value ${quote(c.value)})`)
    out.push(`      (footprint ${quote(c.footprint)})`)
    out.push(`      (libsource (lib ${quote(c.lib)}) (part ${quote(c.part)}) (description ${quote(c.description)}))`)
    out.push(`      (fields (field (name "Footprint") ${quote(c.footprint)}) (field (name "Description") ${quote(c.description)}))`)
    out.push(`      (property (name "Circuitoon part") (value ${quote(c.module)}))`)
    out.push('      (sheetpath (names "/") (tstamps "/"))')
    out.push(`      (tstamps ${quote(c.uuid)}))`)
  }
  out.push('  )')
  // One library part per symbol, with the pads its components use.
  out.push('  (libparts')
  const libparts = new Map<string, Comp>()
  for (const c of comps) if (!libparts.has(`${c.lib}:${c.part}`)) libparts.set(`${c.lib}:${c.part}`, c)
  for (const c of [...libparts.values()].sort((a, b) => natural(`${a.lib}:${a.part}`, `${b.lib}:${b.part}`))) {
    // A Circuitoon part is described by itself; a KiCad library symbol (shared by several parts) by its
    // pin numbers only, as its pin names are the symbol's, and a header as the generic connector it is.
    const own = c.lib === 'Circuitoon'
    const header = c.lib === 'Connector_Generic'
    out.push(`    (libpart (lib ${quote(c.lib)}) (part ${quote(c.part)})`)
    out.push(`      (description ${quote(header ? `Generic connector, single row, ${c.part.slice(5)}` : own ? c.description : `KiCad symbol ${c.lib}:${c.part}`)})`)
    out.push('      (pins')
    for (const [pad, { names: pn, type }] of c.pads)
      out.push(`        (pin (num ${quote(pad)}) (name ${quote(own ? pn.join('/') : header ? `Pin_${pad}` : '~')}) (type ${quote(header ? 'passive' : type)}))`)
    out.push('      ))')
  }
  out.push('  )')
  out.push('  (nets')
  order.forEach((i, code) => {
    out.push(`    (net (code ${quote(String(code + 1))}) (name ${quote(names[i])})`)
    const nodes = [...built[i].nodes].sort((a, b) => natural(a.comp.ref, b.comp.ref) || natural(a.pad, b.pad))
    for (const { comp, pad } of nodes) {
      const info = comp.pads.get(pad)!
      out.push(`      (node (ref ${quote(comp.ref)}) (pin ${quote(pad)}) (pinfunction ${quote(info.names.join('/'))}) (pintype ${quote(info.type)}))`)
    }
    out[out.length - 1] += ')'
  })
  out.push('  )')
  out.push(')')
  return { text: `${out.join('\n')}\n`, warnings, components: comps.length, nets: built.length, unmapped, placeholders, notes }
}
