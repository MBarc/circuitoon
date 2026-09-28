// `circuitoon parts [--search text]` and `circuitoon part <id>` (agent toolkit spec 4.2): the
// built-in catalog, with canonical pin names, labels, types, supplies, capacities, hole groups and
// sources, for picking parts and writing a netlist. An untyped pin reports type null: it is never
// guessed (amendment A14).
import { library } from '../library.ts'
import { isBoard, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'
import { naturalCompare } from '../agent/order.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, printJson } from './io.ts'

export function partSummary(m: ModuleDef) {
  return {
    id: m.id,
    name: m.name,
    category: m.category ?? null,
    source: m.source ?? null,
    board: isBoard(m),
    pins: m.pins
      .filter((p): p is PinDef => !isSpacer(p))
      .map((p) => ({ name: p.name, label: p.label ?? null, type: p.type ?? null, supply: p.supply ?? null, capacity: terminalCapacity(m, p.name) })),
    holes: (m.holes ?? []).map((g) => ({ name: g.name, label: g.label ?? null, type: g.type ?? null, supply: g.supply ?? null, holes: g.at.length, rail: g.rail ?? null, capacity: terminalCapacity(m, g.name) })),
  }
}

const modules = (): ModuleDef[] => library.flatMap((e) => (e.ok ? [e.module] : [])).sort((a, b) => naturalCompare(a.id, b.id))

type Pin = ReturnType<typeof partSummary>['pins'][number]
const pinText = (p: Pin) =>
  [p.name, p.label && p.label !== p.name ? `(${p.label})` : '', p.type ?? 'untyped', p.supply ?? '', p.capacity > 1 ? `takes ${p.capacity}` : ''].filter(Boolean).join(' ')

export function partsCommand(args: Args, io: Io): number {
  const q = (flag(args, '--search') ?? '').toLowerCase()
  const list = modules().filter((m) => !q || [m.id, m.name, m.category ?? ''].some((s) => s.toLowerCase().includes(q)))
  if (args.flags.has('--json')) {
    printJson(io, { format: 'circuitoon-cli/parts/1', parts: list.map(partSummary) })
    return EXIT.ok
  }
  const blocks = list.map((m) => {
    const s = partSummary(m)
    return [
      `${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ''}`,
      s.pins.length ? `  pins: ${s.pins.map(pinText).join(', ')}` : '',
      s.holes.length ? `  hole groups: ${s.holes.map((g) => `${g.name}${g.rail ? ` (rail ${g.rail})` : ''} x${g.holes}`).join(', ')}` : '',
    ].filter(Boolean).join('\n')
  })
  io.stdout(`${blocks.join('\n')}\n`)
  return EXIT.ok
}

export function partCommand(args: Args, io: Io): number {
  const [id] = args.positionals
  if (!id) throw new CliError('part: give a module id, for example: circuitoon part resistor', EXIT.input)
  const m = modules().find((x) => x.id === id)
  if (!m) throw new CliError(`no built-in part "${id}" (search with: circuitoon parts --search <text>)`, EXIT.input)
  if (args.flags.has('--json')) {
    printJson(io, { format: 'circuitoon-cli/part/1', module: m })
    return EXIT.ok
  }
  const s = partSummary(m)
  const lines = [`${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ''}`]
  if (s.source) lines.push(`source: ${s.source}`)
  lines.push('pins (side, name, label, type, supply):')
  for (const p of m.pins) if (!isSpacer(p)) lines.push(`  ${p.side.padEnd(6)} ${pinText(s.pins.find((x) => x.name === p.name)!)}`)
  for (const g of s.holes) lines.push(`  hole group ${g.name}${g.label ? ` (${g.label})` : ''}: ${g.holes} hole${g.holes === 1 ? '' : 's'}${g.type ? `, ${g.type}` : ''}${g.supply ? ` ${g.supply}` : ''}${g.rail ? `, rail ${g.rail}` : ''}`)
  for (const group of m.internal ?? []) lines.push(`joined inside the part: ${group.join(' = ')}`)
  io.stdout(`${lines.join('\n')}\n`)
  return EXIT.ok
}
