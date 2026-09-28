// What the CLI prints alongside a layout: the bill of quantities (parts per module) and, for
// repeats, the channel allocation table (each copy port and the outside pin it is bound to).
import type { Intent } from './netlist.ts'
import { naturalCompare } from './order.ts'

export interface QuantityRow {
  module: string
  name: string
  count: number
  /** Embedded in the netlist: a custom part nobody has verified. */
  custom: boolean
}
export interface ChannelRow {
  copy: string
  port: string
  endpoint: string
}

export function quantities(intent: Intent): QuantityRow[] {
  const count = new Map<string, number>()
  for (const p of intent.parts) count.set(p.module, (count.get(p.module) ?? 0) + 1)
  return [...count]
    .map(([module, n]) => ({ module, name: intent.modules[module].name, count: n, custom: intent.custom.includes(module) }))
    .sort((a, b) => naturalCompare(a.name, b.name))
}

export function channelTable(intent: Intent): ChannelRow[] {
  return intent.copies.flatMap((c) => Object.entries(c.bindings).map(([port, endpoint]) => ({ copy: c.id, port, endpoint })))
}

export function quantitiesText(rows: QuantityRow[]): string {
  return rows.map((r) => `  ${r.count} x ${r.name} [${r.module}]${r.custom ? ' (custom, unverified)' : ''}`).join('\n')
}

export function channelsText(rows: ChannelRow[]): string {
  const w1 = Math.max(4, ...rows.map((r) => r.copy.length))
  const w2 = Math.max(4, ...rows.map((r) => r.port.length))
  return [`${'copy'.padEnd(w1)}  ${'port'.padEnd(w2)}  bound to`, ...rows.map((r) => `${r.copy.padEnd(w1)}  ${r.port.padEnd(w2)}  ${r.endpoint}`)].join('\n')
}
