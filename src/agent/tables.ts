// What the CLI prints alongside a layout: the bill of quantities (parts per module) and, for
// repeats, the channel allocation table (each copy port and the outside pin it is bound to). The
// bill of quantities is the bill of materials (format/bom.ts) summed per module, so gate.json, the
// layout report, bom.csv and the editor's panel always agree. It counts what is on the sheet, so
// the breadboards, rail strips and jumpers layout added to distribute nets are bought too: a part
// the sheet's intent does not name was added by layout.
import type { Diagram } from '../format/diagram.ts'
import { type Bom, billOfMaterials } from '../format/bom.ts'
import { type Intent, type ModuleLookup, parseNetlist } from './netlist.ts'
import { libraryLookup } from './catalog.ts'
import { intentLookup } from './netlist.ts'
import { naturalCompare } from './order.ts'

export interface QuantityRow {
  module: string
  name: string
  count: number
  /** How many of `count` layout added as routing infrastructure (parts the intent does not name). */
  added: number
  /** Embedded in the netlist: a custom part nobody has verified. */
  custom: boolean
}
export interface ChannelRow {
  copy: string
  port: string
  endpoint: string
}

/**
 * The bill of materials for a sheet. With an intent that parses, a part it does not name was added
 * by layout, and its embedded modules are custom; a sheet drawn by hand has neither.
 */
export function sheetBom(d: Diagram, library: ModuleLookup = libraryLookup): Bom {
  const parsed = d.intent !== undefined ? parseNetlist(d.intent, intentLookup(d, library)) : null
  if (!parsed?.ok) return billOfMaterials(d)
  const refs = new Set(parsed.intent.parts.map((p) => p.ref))
  return billOfMaterials(d, { added: new Set(d.parts.filter((p) => !refs.has(p.designator)).map((p) => p.designator)), custom: new Set(parsed.intent.custom) })
}

/** Parts per module, summed from the bill of materials, by name in natural order. */
export function bomQuantities(bom: Bom): QuantityRow[] {
  const rows = new Map<string, QuantityRow>()
  for (const p of bom.parts) {
    const row = rows.get(p.module)
    if (row) {
      row.count += p.count
      row.added += p.added
    } else rows.set(p.module, { module: p.module, name: p.name, count: p.count, added: p.added, custom: p.custom })
  }
  return [...rows.values()].sort((a, b) => naturalCompare(a.name, b.name))
}

export function channelTable(intent: Intent): ChannelRow[] {
  return intent.copies.flatMap((c) => Object.entries(c.bindings).map(([port, endpoint]) => ({ copy: c.id, port, endpoint })))
}

export function quantitiesText(rows: QuantityRow[]): string {
  return rows
    .map((r) => `  ${r.count} x ${r.name} [${r.module}]${r.added ? ` (${r.added === r.count ? 'all' : r.added} added by layout)` : ''}${r.custom ? ' (custom, unverified)' : ''}`)
    .join('\n')
}

export function channelsText(rows: ChannelRow[]): string {
  const w1 = Math.max(4, ...rows.map((r) => r.copy.length))
  const w2 = Math.max(4, ...rows.map((r) => r.port.length))
  return [`${'copy'.padEnd(w1)}  ${'port'.padEnd(w2)}  bound to`, ...rows.map((r) => `${r.copy.padEnd(w1)}  ${r.port.padEnd(w2)}  ${r.endpoint}`)].join('\n')
}
