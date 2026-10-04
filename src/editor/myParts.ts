// My parts: the custom parts a person made in the part maker or imported, kept in this browser
// (localStorage) and shown at the top of the Parts panel. Storage can fail (private browsing, a full
// quota, a disabled API): every access is wrapped, and the list then just lives for this tab. Entries
// are validated on load, so a hand-edited or stale store never breaks the panel.
import { CUSTOM_PREFIX, type ModuleDef, isObj, validateModule } from '../format/module.ts'
import { slugify } from '../format/partMaker.ts'
import { type Diagram, moduleOf } from '../format/diagram.ts'
import { modulesById } from '../library.ts'

export const MY_PARTS_KEY = 'circuitoon.myParts'
const STORE_FORMAT = 'circuitoon-my-parts/1'

export interface MyPart {
  module: ModuleDef
  /** Maker or model, for a library submission; not part of the module. */
  maker?: string
  /** When it was last saved (ms since the epoch). */
  saved: number
}

/** The part of the Web Storage API My parts uses; tests pass their own. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): KeyValue | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Reads the stored list; anything unreadable or invalid is left out and counted, never thrown. Each
 * entry is checked on its own, so one tampered entry costs only itself.
 */
export function readMyPartsReport(storage: KeyValue | null = defaultStorage()): { parts: MyPart[]; skipped: number } {
  let raw: unknown
  try {
    const text = storage?.getItem(MY_PARTS_KEY)
    if (!text) return { parts: [], skipped: 0 }
    raw = JSON.parse(text)
  } catch {
    return { parts: [], skipped: 0 }
  }
  const list = isObj(raw) && raw.format === STORE_FORMAT && Array.isArray(raw.parts) ? raw.parts : []
  const seen = new Set<string>()
  const parts: MyPart[] = []
  let skipped = 0
  for (const e of list) {
    try {
      const v = isObj(e) ? validateModule(e.module) : null
      if (!v || !v.ok || v.module.custom !== true) {
        skipped++
        continue
      }
      if (seen.has(v.module.id)) continue
      seen.add(v.module.id)
      parts.push({ module: v.module, ...(typeof e.maker === 'string' && e.maker ? { maker: e.maker } : {}), saved: typeof e.saved === 'number' ? e.saved : 0 })
    } catch {
      skipped++
    }
  }
  return { parts, skipped }
}

/** The stored parts that could be read (see readMyPartsReport). */
export const readMyParts = (storage: KeyValue | null = defaultStorage()): MyPart[] => readMyPartsReport(storage).parts

/** What the Parts panel says when stored entries could not be read. */
export const skippedNotice = (n: number): string =>
  `${n} saved ${n === 1 ? 'part' : 'parts'} in this browser could not be read (damaged or from a newer version), so ${n === 1 ? 'it was' : 'they were'} left out. Saving My parts again drops ${n === 1 ? 'it' : 'them'}.`

/** Writes the list; false when storage refused it (the list still lives for this tab). */
export function writeMyParts(parts: MyPart[], storage: KeyValue | null = defaultStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(MY_PARTS_KEY, JSON.stringify({ format: STORE_FORMAT, parts }))
    return true
  } catch {
    return false
  }
}

/** An id no part in `taken` and no built-in part uses: `id`, else `id-2`, `id-3` ... */
export function freeId(id: string, taken: Set<string>): string {
  const free = (x: string) => !taken.has(x) && !Object.hasOwn(modulesById, x)
  if (free(id)) return id
  let n = 2
  while (!free(`${id}-${n}`)) n++
  return `${id}-${n}`
}

/** A copy of `p` under a new id and the name "<name> (copy)". */
export function duplicatePart(p: MyPart, parts: MyPart[]): MyPart {
  const id = freeId(`${p.module.id}-copy`, new Set(parts.map((x) => x.module.id)))
  return { ...p, module: { ...p.module, id, name: `${p.module.name} (copy)` }, saved: Date.now() }
}

export type ImportResult = { ok: true; part: MyPart; note: string | null } | { ok: false; message: string }

/**
 * A part from a `.circuitoon-part.json` file (a module). A valid module that is not marked custom is
 * made one (a part from outside the library is unverified, whoever made it); an id that is already
 * taken by a different part gets a free one, so an import never overwrites a part.
 */
export function importPart(text: string, parts: MyPart[], fileName = 'The file'): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: `${fileName} is not valid JSON, so nothing was imported.` }
  }
  if (isObj(raw) && raw.format === 'circuitoon-diagram/1') return { ok: false, message: `${fileName} is a sheet, not a part. Open sheets with Import JSON.` }
  if (isObj(raw) && typeof raw.id === 'string' && raw.custom !== true) {
    const base = slugify(raw.id)
    raw = { ...raw, custom: true, id: base.startsWith(CUSTOM_PREFIX) ? base : CUSTOM_PREFIX + base }
  }
  let v: ReturnType<typeof validateModule>
  try {
    v = validateModule(raw)
  } catch {
    v = { ok: false, errors: ['it could not be read'] }
  }
  if (!v.ok) return { ok: false, message: `${fileName} is not a Circuitoon part: ${v.errors.slice(0, 3).join('; ')}` }
  const m = v.module
  const same = parts.find((p) => p.module.id === m.id)
  if (same && JSON.stringify(same.module) === JSON.stringify(m)) return { ok: true, part: same, note: `${m.name} is already in My parts.` }
  const id = freeId(m.id, new Set(parts.map((p) => p.module.id)))
  const part = { module: id === m.id ? m : { ...m, id }, saved: Date.now() }
  return { ok: true, part, note: id === m.id ? null : `You already have a different part with this id, so it was imported as ${id}.` }
}

/** The text of a part file: the module, as a netlist's `modules` takes it. */
export const partFileText = (p: MyPart): string => `${JSON.stringify(p.module, null, 2)}\n`

/**
 * The sheet with `m` as its copy of that module: wires to pins the new copy no longer has are
 * removed (they would point at nothing). Returns the sheet unchanged when it does not use `m.id`.
 */
export function replaceSheetModule(d: Diagram, m: ModuleDef): Diagram {
  const old = moduleOf(d, m.id)
  if (!old || JSON.stringify(old) === JSON.stringify(m)) return d
  const names = new Set([...m.pins.flatMap((p) => ('name' in p && typeof p.name === 'string' ? [p.name] : [])), ...(m.holes ?? []).map((g) => g.name)])
  const users = new Set(d.parts.filter((p) => p.module === m.id).map((p) => p.uid))
  const keeps = (ep: { part: string; pin: string }) => !users.has(ep.part) || names.has(ep.pin)
  return { ...d, modules: { ...d.modules, [m.id]: m }, connections: d.connections.filter((c) => keeps(c.from) && keeps(c.to)) }
}

type Listener = () => void

/** My parts for the page: one list shared by the Parts panel, the canvas and the dialogs. */
export class MyPartsStore {
  private parts: MyPart[]
  private listeners = new Set<Listener>()
  /** False after a write storage refused: the panel says the parts last only for this tab. */
  persisted = true
  /** Stored entries that could not be read on the last load: the panel says so. */
  skipped = 0
  private storage: () => KeyValue | null

  constructor(storage: () => KeyValue | null = defaultStorage) {
    this.storage = storage
    const r = readMyPartsReport(storage())
    this.parts = r.parts
    this.skipped = r.skipped
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = (): MyPart[] => this.parts

  get(id: string): MyPart | undefined {
    return this.parts.find((p) => p.module.id === id)
  }

  private set(parts: MyPart[]) {
    this.parts = parts
    this.persisted = writeMyParts(parts, this.storage())
    if (this.persisted) this.skipped = 0
    this.listeners.forEach((fn) => fn())
  }

  /** Adds a part, or replaces the one with its id; newest first. */
  save(p: MyPart) {
    this.set([p, ...this.parts.filter((x) => x.module.id !== p.module.id)])
  }
  /** Replaces the part stored as `oldId` (its id may change), keeping its place in the list. */
  replace(oldId: string, p: MyPart) {
    const i = this.parts.findIndex((x) => x.module.id === oldId)
    if (i < 0) return this.save(p)
    const next = this.parts.filter((x, j) => j === i || x.module.id !== p.module.id)
    next[next.findIndex((x) => x.module.id === oldId)] = p
    this.set(next)
  }
  remove(id: string) {
    this.set(this.parts.filter((p) => p.module.id !== id))
  }
  duplicate(id: string): MyPart | undefined {
    const p = this.get(id)
    if (!p) return undefined
    const copy = duplicatePart(p, this.parts)
    const i = this.parts.indexOf(p)
    this.set([...this.parts.slice(0, i + 1), copy, ...this.parts.slice(i + 1)])
    return copy
  }
  /** Re-reads storage (another tab saved). */
  reload() {
    const r = readMyPartsReport(this.storage())
    this.parts = r.parts
    this.skipped = r.skipped
    this.listeners.forEach((fn) => fn())
  }
}

export const myParts = new MyPartsStore()
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === MY_PARTS_KEY) myParts.reload()
  })

/** A part by id for placing it: the library first, then My parts. */
export function lookupModule(id: string): ModuleDef | undefined {
  return Object.hasOwn(modulesById, id) ? modulesById[id] : myParts.get(id)?.module
}
