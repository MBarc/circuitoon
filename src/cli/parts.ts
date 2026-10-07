// `circuitoon parts [--search text]` and `circuitoon part <id>` (agent toolkit spec 4.2): the
// built-in catalog, with canonical pin names, labels, types, supplies, capacities, hole groups and
// sources, for picking parts and writing a netlist. An untyped pin reports type null: it is never
// guessed (amendment A14).
import { library, partText } from '../library.ts'
import { partTextOf, rankParts } from '../format/partSearch.ts'
import { type I2cSpec, addressText, i2cOf, isBoard, isNetLabel, isSpacer, type ModuleDef, type PinDef, terminalCapacity } from '../format/module.ts'

/** How a device's I2C address is set, in words. */
function i2cAddressText(i2c: I2cSpec): string {
  const a = i2c.address
  if (!a) return 'not known'
  if ('fixed' in a) return `${addressText(a.fixed)} (fixed)`
  if ('setting' in a) return `set on the board (part setting "${a.setting}")`
  return `${addressText(a.base)} plus ${a.pins.map((p) => `${p.pin} (+${p.add}${p.floating !== undefined ? `, ${p.floating} when not connected` : ''})`).join(', ')}`
}
import { naturalCompare } from '../agent/order.ts'
import { capsText } from '../format/pinRules.ts'
import { usbWords } from '../format/usb.ts'
import type { Args } from './args.ts'
import { CliError, EXIT, type Io, flag, printJson } from './io.ts'

export function partSummary(m: ModuleDef) {
  const text = partTextOf(m, partText)
  return {
    id: m.id,
    name: m.name,
    category: m.category ?? null,
    source: m.source ?? null,
    /** What the part is and its typical uses, from src/format/partText.json (null and [] until written). */
    description: text?.description || null,
    uses: text?.uses ?? [],
    board: isBoard(m),
    /** A net label (a named flag, not a physical part): a netlist asks for one with "label": true on a net. */
    netLabel: isNetLabel(m),
    pins: m.pins
      .filter((p): p is PinDef => !isSpacer(p))
      .map((p) => ({ name: p.name, label: p.label ?? null, type: p.type ?? null, supply: p.supply ?? null, capacity: terminalCapacity(m, p.name), caps: p.caps ?? null, usb: p.usb ?? null })),
    holes: (m.holes ?? []).map((g) => ({ name: g.name, label: g.label ?? null, type: g.type ?? null, supply: g.supply ?? null, holes: g.at.length, rail: g.rail ?? null, capacity: terminalCapacity(m, g.name), caps: g.caps ?? null })),
  }
}

const modules = (): ModuleDef[] => library.flatMap((e) => (e.ok ? [e.module] : [])).sort((a, b) => naturalCompare(a.id, b.id))

type Pin = ReturnType<typeof partSummary>['pins'][number]
const pinText = (p: Pin) =>
  [p.name, p.label && p.label !== p.name ? `(${p.label})` : '', p.usb ? `[${usbWords(p.usb)}]` : p.type ?? 'untyped', p.supply ?? '', p.capacity > 1 ? `takes ${p.capacity}` : '',
    capsText(p.caps ?? undefined).length ? `[${capsText(p.caps ?? undefined).join('; ')}]` : ''].filter(Boolean).join(' ')

/** How many ranked closest matches `parts --search` adds after the exact ones. */
const CLOSEST = 8

export function partsCommand(args: Args, io: Io): number {
  const search = flag(args, '--search') ?? ''
  const q = search.trim().toLowerCase()
  const all = modules()
  const list = all.filter((m) => !q || [m.id, m.name, m.category ?? ''].some((s) => s.toLowerCase().includes(q)))
  // A part described in words ("a touch display for the rpi"): the closest matches, ranked, after the exact ones.
  const exact = new Set(list.map((m) => m.id))
  const closest = q ? rankParts(all.filter((m) => !exact.has(m.id)), search, partText, CLOSEST) : []
  if (args.flags.has('--json')) {
    printJson(io, { format: 'circuitoon-cli/parts/1', parts: list.map(partSummary), ...(q ? { closest: closest.map((r) => ({ ...partSummary(r.module), score: r.score })) } : {}) })
    return EXIT.ok
  }
  const block = (m: ModuleDef) => {
    const s = partSummary(m)
    return [
      `${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ''}`,
      s.description ? `  ${s.description}` : '',
      s.uses.length ? `  uses: ${s.uses.join('; ')}` : '',
      s.pins.length ? `  pins: ${s.pins.map(pinText).join(', ')}` : '',
      s.netLabel ? `  not a part to list: set "label": true on a net and the layout draws its labels` : '',
      s.holes.length ? `  hole groups: ${s.holes.map((g) => `${g.name}${g.rail ? ` (rail ${g.rail})` : ''} x${g.holes}`).join(', ')}` : '',
    ].filter(Boolean).join('\n')
  }
  const blocks = list.map(block)
  if (closest.length) blocks.push(`closest matches (ranked, best first${list.length ? ', not listed above' : ''}):`, ...closest.map((r) => block(r.module)))
  else if (!list.length) blocks.push(`no parts match "${search.trim()}"`)
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
  for (const p of [...m.pins.filter((x): x is PinDef => !isSpacer(x)), ...(m.holes ?? [])]) if (p.caps?.note) lines.push(`note on ${p.label ?? p.name}: ${p.caps.note}`)
  const i2c = i2cOf(m)
  if (i2c) lines.push(`I2C device: SDA ${i2c.sda}, SCL ${i2c.scl}; address ${i2cAddressText(i2c)}; pull-ups on board: ${i2c.pullups === undefined ? 'not known' : i2c.pullups ? 'yes' : 'no'}`)
  io.stdout(`${lines.join('\n')}\n`)
  return EXIT.ok
}
