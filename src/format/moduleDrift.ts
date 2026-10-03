// How a sheet's stored copy of a built-in part differs from the current library (Ruling D1), and
// bringing such copies up to date. The library is edited without version bumps (Ruling T14), so a
// copy is compared by content. What changed decides the kind:
//
// - block: what the part connects or where its pins sit changed. Pin names, sides, types, buses or
//   order; hole groups; internal joins; a net label flag; a body or geometry that moves the pins; or
//   any other electrical field the stored copy has that the library changed or dropped (a pin's
//   capacity or mains role, a param default). Updating such a copy could rewire the sheet, so it is
//   left alone and the part must be placed again.
// - update: anything additive or descriptive. New optional pin data (caps, a pin label), I2C data,
//   settings, ratings, a footprint, art, name, source, description, category, version, or any field
//   the stored copy lacks that the library has. The sheet is right as drawn; the library only knows
//   more. `circuitoon update` and the editor's Update parts take the library copy.
//
// Pure: shared by verify, the CLI's update command and the editor.
import type { Diagram } from './diagram.ts'
import { isObj, isSpacer, layoutModule, type ModuleDef } from './module.ts'

/** JSON with object keys sorted, so two modules compare by content whatever their key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

/** Top-level fields that only describe or draw the part (the footprint changes covered holes, never connections). */
const DESCRIPTIVE = new Set(['art', 'name', 'source', 'description', 'category', 'version', 'footprint'])
/** Pin fields that are notes about a pin, never what it is or where it sits. */
const PIN_DESCRIPTIVE = new Set(['caps', 'label'])
/** Pin fields that say what a pin is and where it sits: any change blocks. */
const PIN_STRUCTURAL = ['name', 'side', 'type', 'bus']
/** `electrical` fields the library refines as data: any change is an update. */
const ELECTRICAL_DATA = new Set(['i2c', 'settings', 'ratings'])
/** Top-level fields whose any change blocks (with the pins, and the geometry test). */
const STRUCTURAL = new Set(['holes', 'internal', 'netLabel'])

const FIELD_NAMES: Record<string, string> = { holes: 'hole groups', internal: 'internal joins', electrical: 'electrical data', netLabel: 'net label flag' }
const ELECTRICAL_NAMES: Record<string, string> = { i2c: 'I2C data', settings: 'settings', ratings: 'ratings' }

export interface ModuleDriftResult {
  kind: 'block' | 'update'
  /** Block only: the body or the pins' places moved, so a kept position no longer means the same seat. */
  moved: boolean
  /** What differs, in words ("pins VP/VN", "I2C data", "footprint"): for block, what blocks. */
  what: string[]
}

/** True when everything `a` says, `b` says too: `b` may only add (an absent value in `a` is nothing said). */
function adds(a: unknown, b: unknown): boolean {
  if (a === undefined) return true
  if (isObj(a) && isObj(b)) return Object.keys(a).every((k) => adds(a[k], b[k]))
  return canonical(a) === canonical(b)
}

/** "pins A/B", or "12 pins" for a redrawn part (Ruling C2), from pin names (spacers as "spacer"). */
function pinWords(names: Set<string>): string {
  if (names.size > 8) return `${names.size} pins`
  return names.size ? `pins ${[...names].join('/')}` : 'pins'
}

const pinLabel = (p: unknown) => (isObj(p) && typeof p.name === 'string' ? p.name : 'spacer')
const typeOf = (p: Record<string, unknown>) => (p.type === undefined ? 'io' : p.type)

/**
 * Whether the part's geometry moved: a different body size, or pin positions (side and place on the
 * body, whatever their names) that differ. Its legs then land elsewhere.
 */
function movedGeometry(stored: ModuleDef, lib: ModuleDef): boolean {
  const [a, b] = [layoutModule(stored), layoutModule(lib)]
  if (a.w !== b.w || a.h !== b.h || a.pins.length !== b.pins.length) return true
  return a.pins.some((p, i) => p.side !== b.pins[i].side || p.edge.x !== b.pins[i].edge.x || p.edge.y !== b.pins[i].edge.y)
}

/** How `stored` differs from the library's `lib`, or null when they are the same by content. */
export function moduleDrift(stored: ModuleDef, lib: ModuleDef): ModuleDriftResult | null {
  if (canonical(stored) === canonical(lib)) return null
  const [s, l] = [stored as unknown as Record<string, unknown>, lib as unknown as Record<string, unknown>]
  const block: string[] = []
  const update: string[] = []

  // Pins, by place in the list (the place is where a pin sits).
  const [sp, lp] = [Array.isArray(s.pins) ? s.pins : [], Array.isArray(l.pins) ? l.pins : []]
  const pinsBlock = new Set<string>()
  const pinsUpdate = new Set<string>()
  for (let i = 0; i < Math.max(sp.length, lp.length); i++) {
    const [a, b] = [sp[i] as unknown, lp[i] as unknown]
    if (canonical(a) === canonical(b)) continue
    const names = [i < lp.length ? pinLabel(b) : null, i < sp.length ? pinLabel(a) : null].filter((x): x is string => x !== null)
    const structural =
      !isObj(a) || !isObj(b) || isSpacer(a as never) !== isSpacer(b as never) ||
      PIN_STRUCTURAL.some((k) => (k === 'type' ? typeOf(a) !== typeOf(b) : canonical(a[k]) !== canonical(b[k]))) ||
      Object.keys(a).some((k) => !PIN_STRUCTURAL.includes(k) && !PIN_DESCRIPTIVE.has(k) && !adds(a[k], b[k]))
    for (const n of names) (structural ? pinsBlock : pinsUpdate).add(n)
  }
  if (pinsBlock.size) block.push(pinWords(pinsBlock))
  if (pinsUpdate.size) update.push(`${pinWords(pinsUpdate)} (pin data)`)

  for (const k of [...new Set([...Object.keys(l), ...Object.keys(s)])]) {
    if (k === 'pins' || canonical(s[k]) === canonical(l[k])) continue
    if (DESCRIPTIVE.has(k)) update.push(k)
    else if (STRUCTURAL.has(k)) block.push(FIELD_NAMES[k] ?? k)
    else if (k === 'electrical' && isObj(l.electrical) && (s.electrical === undefined || isObj(s.electrical))) {
      const [se, le] = [(s.electrical ?? {}) as Record<string, unknown>, l.electrical]
      for (const e of [...new Set([...Object.keys(le), ...Object.keys(se)])]) {
        if (canonical(se[e]) === canonical(le[e])) continue
        if (ELECTRICAL_DATA.has(e)) update.push(ELECTRICAL_NAMES[e])
        else (adds(se[e], le[e]) ? update : block).push(`electrical ${e}`)
      }
    } else (adds(s[k], l[k]) ? update : block).push(FIELD_NAMES[k] ?? k)
  }

  const moved = movedGeometry(stored, lib)
  if (moved && !block.length) block.push('size')
  if (block.length) return { kind: 'block', moved, what: block }
  return { kind: 'update', moved: false, what: update }
}

export const UPDATE_ADVICE = 'the library has newer data for this part; run `circuitoon update` or use Update parts in the editor'

export interface PartsUpdate {
  /** The sheet with every update-kind copy replaced by the library's. The same object when nothing changed. */
  diagram: Diagram
  /** Each module brought up to date: its id, the designators of its parts and what changed. */
  updated: { id: string; parts: string[]; what: string[] }[]
  /** Each module left alone because its drift blocks: the part must be placed again. */
  blocked: { id: string; parts: string[]; what: string[] }[]
}

/**
 * Brings a sheet's stored built-in parts up to date where that is safe (Ruling D1): each copy whose
 * drift is the update kind is replaced by the library's; a copy whose drift blocks is left alone and
 * listed. `library` finds a built-in part by id.
 */
export function updateParts(d: Diagram, library: (id: string) => ModuleDef | undefined): PartsUpdate {
  const updated: PartsUpdate['updated'] = []
  const blocked: PartsUpdate['blocked'] = []
  let modules: Record<string, ModuleDef> | null = null
  for (const id of Object.keys(d.modules).sort()) {
    const lib = library(id)
    if (!lib) continue
    const drift = moduleDrift(d.modules[id], lib)
    if (!drift) continue
    const parts = d.parts.filter((p) => p.module === id).map((p) => p.designator)
    if (drift.kind === 'block') {
      blocked.push({ id, parts, what: drift.what })
      continue
    }
    modules ??= { ...d.modules }
    modules[id] = lib
    updated.push({ id, parts, what: drift.what })
  }
  return { diagram: modules ? { ...d, modules } : d, updated, blocked }
}

/** One line per change: "Updated U1 (esp32-devkit-v1-30): pins VP/VN (pin data)." (an unused copy is named by its id). */
export function updateLines(u: PartsUpdate): string[] {
  const who = (x: { id: string; parts: string[] }) => (x.parts.length ? `${x.parts.join(', ')} (${x.id})` : `${x.id} (no parts on the sheet)`)
  return [
    ...u.updated.map((x) => `Updated ${who(x)}: ${x.what.join(', ')}.`),
    ...u.blocked.map((x) => `Left ${who(x)}: ${x.what.join(', ')} changed in the library, so ${x.parts.length > 1 ? 'they' : 'it'} must be placed again.`),
  ]
}
