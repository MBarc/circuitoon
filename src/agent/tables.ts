// What the CLI prints alongside a layout: the bill of quantities (parts per module) and, for
// repeats, the channel allocation table (each copy port and the outside pin it is bound to).
// Given the realized sheet, the bill counts what is on it, so the breadboards, rail strips and
// jumpers layout added to distribute nets are bought too; `added` says how many of each it added.
import type { Diagram } from '../format/diagram.ts'
import type { Intent } from './netlist.ts'
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

/** Parts per module: on `sheet` when given (what gets built), else in the intent. */
export function quantities(intent: Intent, sheet?: Pick<Diagram, 'parts' | 'modules'>): QuantityRow[] {
  const refs = new Set(intent.parts.map((p) => p.ref))
  const rows = new Map<string, { count: number; added: number }>()
  const parts = sheet ? sheet.parts.map((p) => ({ module: p.module, added: !refs.has(p.designator) })) : intent.parts.map((p) => ({ module: p.module, added: false }))
  for (const p of parts) {
    const row = rows.get(p.module) ?? { count: 0, added: 0 }
    row.count++
    if (p.added) row.added++
    rows.set(p.module, row)
  }
  const nameOf = (module: string) => intent.modules[module]?.name ?? sheet?.modules[module]?.name ?? module
  return [...rows]
    .map(([module, r]) => ({ module, name: nameOf(module), count: r.count, added: r.added, custom: intent.custom.includes(module) }))
    .sort((a, b) => naturalCompare(a.name, b.name))
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
