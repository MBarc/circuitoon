// The bill of materials for a sheet, shared by the editor's Bill of materials panel and the CLI
// (`circuitoon bom`, and bom.csv beside gate.json). Parts are grouped by module plus value, with
// natural-order designator ranges, the module's category and source links; wires are counted by
// cable (its ends, either way round), gauge and the colour they are drawn in; connectors by kind.
// Net labels are left out (not physical). What the layout added (breadboards and rail strips it claimed, `routing` wires) is marked. The
// CSV is RFC 4180 (every field quoted, CRLF) and no cell starts a spreadsheet formula. Pure.
import { type Connection, type Diagram, moduleOf } from './diagram.ts'
import { conductors, nodeKey } from './netlist.ts'
import { labelsOf } from './netLabels.ts'
import { END_KINDS, END_NAMES, END_SIZE, type EndKind, endKind, isEndKind, presetOf } from './cables.ts'
import { editableParams, formatValue, paramValue } from './values.ts'
import { drawnColor, wireLooks } from './mainsLook.ts'
import { natural } from './words.ts'
import { isNetLabel, isObj } from './module.ts'

export interface BomPart {
  module: string
  /** The module's name (its id when the sheet does not embed it). */
  name: string
  /** The part values that set it apart ("330 Ω"), or null when the module has none. */
  value: string | null
  category: string | null
  /** The module's source links, in order. */
  source: string[]
  count: number
  /** How many of `count` the layout added as routing infrastructure. */
  added: number
  /** Designators in natural order, and as ranges ("BT1-BT4"). */
  designators: string[]
  refs: string
  /** An embedded part nobody has verified (the netlist's custom modules). */
  custom: boolean
}
export interface BomWire {
  /** The cable as bought ("Dupont M-M jumper", "Hookup wire"). */
  cable: string
  /** Its two ends, in END_KINDS order. */
  ends: [EndKind, EndKind]
  gauge: number
  /** The colour it is drawn in: its stored colour, else its mains identity or role colour, else black. */
  color: string
  count: number
  /** How many of `count` the layout added (`routing: true`). */
  added: number
  /**
   * Wires for nets drawn with net labels (rule V3): not drawn on the sheet, so their length is not
   * known. A net whose labels join `n` separate pieces takes `n - 1` of them.
   */
  labelled: boolean
}
export interface BomConnector {
  kind: EndKind
  name: string
  count: number
}
export interface Bom {
  title: string
  parts: BomPart[]
  wires: BomWire[]
  connectors: BomConnector[]
}

export interface BomOptions {
  /** Designators of parts the layout added (not in the sheet's intent). */
  added?: ReadonlySet<string>
  /** Module ids that are custom and unverified. */
  custom?: ReadonlySet<string>
}

/**
 * Designators in natural order, a run of three or more with one prefix and consecutive numbers
 * joined as "BT1-BT4": "R1-R3, R9, R10". A run whose designators hold a hyphen or a space is joined
 * with " to " ("J1-1 to J1-3", "MCP Breadboard 1 to MCP Breadboard 3"), so it never reads as one name.
 */
export function designatorRanges(names: string[]): string {
  const sorted = [...names].sort(natural.compare)
  const parsed = sorted.map((n) => /^(.*?)(\d+)$/.exec(n))
  const out: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    const m = parsed[i]
    while (m && j + 1 < sorted.length && parsed[j + 1]?.[1] === m[1] && Number(parsed[j + 1]![2]) === Number(parsed[j]![2]) + 1) j++
    if (j - i >= 2) out.push(`${sorted[i]}${/[- ]/.test(sorted[i] + sorted[j]) ? ' to ' : '-'}${sorted[j]}`)
    else for (let k = i; k <= j; k++) out.push(sorted[k])
    i = j + 1
  }
  return out.join(', ')
}

/** What a cable is called in a bill, from its ends. */
const CABLE_NAMES: Record<string, string> = { wire: 'Hookup wire', 'dupont-mm': 'Dupont M-M jumper', 'dupont-mf': 'Dupont M-F jumper', 'dupont-ff': 'Dupont F-F jumper' }

function cableOf(a: EndKind, b: EndKind): string {
  const preset = presetOf({ from: a, to: b })
  if (preset) return CABLE_NAMES[preset.id] ?? preset.name
  return `${END_NAMES[a]} to ${END_NAMES[b]} lead`
}
/** Ends a connector is fitted to: not a bare, stripped or solid-core end. */
const isConnector = (k: EndKind) => k !== 'bare' && !END_SIZE[k].exposed

const byOrder = (a: EndKind, b: EndKind) => END_KINDS.indexOf(a) - END_KINDS.indexOf(b)

/** The bill of materials for `d`. */
export function billOfMaterials(d: Diagram, opts: BomOptions = {}): Bom {
  const parts = new Map<string, BomPart>()
  for (const p of d.parts) {
    const m = moduleOf(d, p.module)
    // A net label is a drawing convention, not something to buy.
    if (isNetLabel(m)) continue
    const text = m ? editableParams(m).flatMap((q) => { const v = paramValue(p, m, q.name); return v === null ? [] : [formatValue(v, q.unit)] }).join(', ') || null : null
    const key = JSON.stringify([p.module, text])
    let row = parts.get(key)
    if (!row) {
      row = { module: p.module, name: m?.name ?? p.module, value: text, category: m?.category ?? null, source: (m?.source ?? '').split(/\s+/).filter(Boolean), count: 0, added: 0, designators: [], refs: '', custom: !!opts.custom?.has(p.module) }
      parts.set(key, row)
    }
    row.count++
    if (opts.added?.has(p.designator)) row.added++
    row.designators.push(p.designator)
  }
  for (const r of parts.values()) {
    r.designators.sort(natural.compare)
    r.refs = designatorRanges(r.designators)
  }
  const cat = (c: string | null) => c ?? '￿'
  const partRows = [...parts.values()].sort((a, b) =>
    natural.compare(cat(a.category), cat(b.category)) || natural.compare(a.name, b.name) || natural.compare(a.designators[0] ?? '', b.designators[0] ?? ''))

  const looks = d.connections.some((c) => c.color === undefined) ? wireLooks(d) : new Map()
  const wires = new Map<string, BomWire>()
  const connectors = new Map<EndKind, number>()
  const add = (ends: [EndKind, EndKind], gauge: number, color: string, n: number, added: number, labelled: boolean) => {
    const cable = cableOf(ends[0], ends[1])
    const key = JSON.stringify([cable, ends, gauge, color, labelled])
    let row = wires.get(key)
    if (!row) wires.set(key, (row = { cable, ends, gauge, color, count: 0, added: 0, labelled }))
    row.count += n
    row.added += added
    for (const k of ends) if (isConnector(k)) connectors.set(k, (connectors.get(k) ?? 0) + n)
  }
  // A wire to a net label is a drawing convention, never a wire to buy (rule V3, below).
  const labelUids = new Set(labelsOf(d).map((l) => l.part.uid))
  const toLabel = (c: Connection) => labelUids.has(c.from.part) || labelUids.has(c.to.part)
  for (const c of d.connections) {
    if (toLabel(c)) continue
    const ends = [endKind(c.ends, 'from'), endKind(c.ends, 'to')].sort(byOrder) as [EndKind, EndKind]
    add(ends, c.gauge ?? 22, drawnColor(c, looks), 1, c.routing ? 1 : 0, false)
  }
  for (const v of labelledWires(d, toLabel)) {
    const stub = v.stubs[0]
    add(v.ends, stub.gauge ?? 22, drawnColor(stub, looks), v.count, 0, true)
  }
  const wireRows = [...wires.values()].sort((a, b) => Number(a.labelled) - Number(b.labelled) || natural.compare(a.cable, b.cable) || a.gauge - b.gauge || natural.compare(a.color, b.color))
  const connectorRows = [...connectors].map(([kind, count]) => ({ kind, name: END_NAMES[kind], count })).sort((a, b) => natural.compare(a.name, b.name))
  return { title: d.title, parts: partRows, wires: wireRows, connectors: connectorRows }
}

/**
 * Rule V3: the real wires a sheet's labelled nets need. Per label name, the pieces the labels join
 * are the nodes the wires to those labels start from, grouped by what joins them without labels
 * (wires, strips, internal joins, plugged legs): a breadboard strip is one piece, two pins on one
 * label are two. A name joining `n` pieces takes `n - 1` wires, with the netlist's cable ends (its
 * `wires.ends`, else bare) and the gauge and colour of the wires drawn to its labels.
 */
function labelledWires(d: Diagram, toLabel: (c: Connection) => boolean): { ends: [EndKind, EndKind]; count: number; stubs: Connection[] }[] {
  const labels = labelsOf(d).filter((l) => l.name)
  if (!labels.length) return []
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const byUid = new Map(d.connections.map((c) => [c.uid, c]))
  for (const j of conductors(d).joins) {
    if (j.label !== undefined || (j.wire !== undefined && toLabel(byUid.get(j.wire)!))) continue
    const [a, b] = [find(j.a), find(j.b)]
    if (a !== b) parent.set(a, b)
  }
  const nameOf = new Map(labels.map((l) => [l.part.uid, l.name]))
  const byName = new Map<string, { roots: Set<string>; stubs: Connection[] }>()
  for (const c of d.connections) {
    const [lab, end] = nameOf.has(c.to.part) ? [c.to, c.from] : nameOf.has(c.from.part) ? [c.from, c.to] : [null, null]
    if (!lab || !end || nameOf.has(end.part)) continue
    const name = nameOf.get(lab.part)!
    let g = byName.get(name)
    if (!g) byName.set(name, (g = { roots: new Set(), stubs: [] }))
    g.roots.add(find(nodeKey(end.part, end.pin)))
    g.stubs.push(c)
  }
  const raw = isObj(d.intent) && isObj(d.intent.wires) ? d.intent.wires.ends : undefined
  const kind: EndKind = isEndKind(raw) ? raw : 'bare'
  return [...byName.values()].filter((g) => g.roots.size > 1).map((g) => ({ ends: [kind, kind], count: g.roots.size - 1, stubs: g.stubs }))
}

/** "(added by layout)", "(1 added by layout)", "(custom, unverified)", or nothing. */
function notes(count: number, added: number, custom = false): string[] {
  const out: string[] = []
  if (added) out.push(added === count ? 'added by layout' : `${added} added by layout`)
  if (custom) out.push('custom, unverified')
  return out
}

const LABELLED_NOTE = 'for labelled nets (length not drawn)'
const wireNotes = (w: BomWire) => [...(w.labelled ? [LABELLED_NOTE] : []), ...notes(w.count, w.added)]
const suffix = (n: string[]) => (n.length ? ` (${n.join('; ')})` : '')

/** The bill as lines: "4 x 18650 holder (1 cell), BT1-BT4", "12 x Dupont M-M jumper, 22 AWG, red". */
export function bomLines(bom: Bom): string[] {
  return [
    ...bom.parts.map((p) => `${p.count} x ${p.name}${p.value ? `, ${p.value}` : ''}, ${p.refs}${suffix(notes(p.count, p.added, p.custom))}`),
    ...bom.wires.map((w) => `${w.count} x ${w.cable}, ${w.gauge} AWG, ${w.color}${w.labelled ? `, ${LABELLED_NOTE}` : ''}${suffix(notes(w.count, w.added))}`),
    ...bom.connectors.map((c) => `${c.count} x ${c.name}`),
  ]
}

/**
 * One CSV field: always quoted, quotes doubled (RFC 4180). A value a spreadsheet would run as a
 * formula (starting with =, +, -, @, a tab or a carriage return) gets a leading apostrophe.
 */
export function csvField(v: string | number): string {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Units in plain ASCII for a CSV any spreadsheet reads: "4.7 kΩ" is "4.7 kohm", "100 µF" "100 uF". */
const ascii = (s: string) => s.replace(/[\u2126\u03a9]/g, 'ohm').replace(/[\u00b5\u03bc]/g, 'u')

export const BOM_CSV_HEADER = ['Type', 'Qty', 'Description', 'Value', 'Designators', 'Category', 'Source', 'Notes']

/** The bill as CSV: a header, then a row per part group, wire group and connector kind; CRLF line ends. */
export function bomCsv(bom: Bom): string {
  const rows: (string | number)[][] = [
    BOM_CSV_HEADER,
    ...bom.parts.map((p) => ['Part', p.count, p.name, ascii(p.value ?? ''), p.refs, p.category ?? '', p.source.join(' '), notes(p.count, p.added, p.custom).join('; ')]),
    ...bom.wires.map((w) => ['Wire', w.count, w.cable, `${w.gauge} AWG, ${w.color}`, '', '', '', wireNotes(w).join('; ')]),
    ...bom.connectors.map((c) => ['Connector', c.count, c.name, '', '', '', '', '']),
  ]
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}
